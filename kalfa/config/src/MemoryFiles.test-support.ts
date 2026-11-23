/**
 * A file system held in memory, for the laws of `SettingGroup.layer`: the files are a record of path to text, a path
 * that is not there answers `NotFound` as a real disk does, and a path named in `broken` fails with the error planted
 * there in place of its text. A law that wants the calls watches this service with `Recorder` (see SettingGroup.test.ts),
 * which lint keeps out of this file, since the package's own files import no workspace package. R1 checks this stand-in
 * against a real temp folder, so a law that reads from it is as true as one on a disk.
 */
import { Effect, FileSystem, Layer, Path, type PlatformError, Queue, Schema, Stream } from "effect";

export interface Disk {
  /** The text of each file, by the path the program reads it from. */
  readonly files: Readonly<Record<string, string>>;
  /** A path whose read fails with the error given here, whatever else the disk holds at that path. */
  readonly broken?: Readonly<Record<string, PlatformError.PlatformError>>;
}

// The platform's own refusal for a path that is not there: what `makeNoop` answers for a method it was not given.
const noop = FileSystem.makeNoop({});

/** The file system on a disk. */
export const make = (disk: Disk): FileSystem.FileSystem =>
  FileSystem.makeNoop({
    exists: (path) => {
      const fault = disk.broken?.[path];

      return fault === undefined ? Effect.succeed(disk.files[path] !== undefined) : Effect.fail(fault);
    },
    readFileString: (path) => {
      const fault = disk.broken?.[path];
      const text = disk.files[path];

      return fault !== undefined
        ? Effect.fail(fault)
        : text === undefined
          ? noop.readFileString(path)
          : Effect.succeed(text);
    },
    readFile: (path) => {
      const fault = disk.broken?.[path];
      const text = disk.files[path];

      return fault !== undefined
        ? Effect.fail(fault)
        : text === undefined
          ? noop.readFile(path)
          : Effect.succeed(new TextEncoder().encode(text));
    },
  });

/** The file system on a disk, and the path service. */
export const layer = (disk: Disk): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
  Layer.merge(Layer.succeed(FileSystem.FileSystem)(make(disk)), Path.layer);

// ---------------------------------------------------------------------------------------------
// A live disk: files and folders that change while a program runs, and a watch that tells the program.
// Ticket 1841's laws (SettingGroup.live.test.ts) run on it, and R3 (SettingGroup.live.integration.test.ts) checks it
// against a real temp folder, as R1 checks `make`. The watch copies what Node's `fs.watch` does, as Effect's Node
// backend reports it: `watch` stats the path first, so a missing one fails `NotFound`; each event names the child
// relative to the watched folder; a write in place is an `Update`; a rename is a `Remove` of the old name and a
// `Create` of the new one, whatever the new name replaced; a watch follows the inode it was made on, so a watch on a
// file's own path hears nothing of the file that replaces it, and a watched folder that is removed says so once, with
// its own name, and then goes quiet, as Node's "Inodes" note says.
// ---------------------------------------------------------------------------------------------

/** What a live disk starts with: files by path, and folders that stand empty. Every folder above a file or a folder is made too. */
export interface LiveSeed {
  readonly files?: Readonly<Record<string, string>> | undefined;
  readonly folders?: ReadonlyArray<string> | undefined;
}

interface Held {
  readonly id: number;
  readonly text: string;
}

interface Watcher {
  /** Whether the watch is on a folder: else it is on one file. */
  readonly folder: boolean;
  readonly path: string;
  /** The inode the watch was made on, a folder's or a file's. */
  readonly id: number;
  /** Events given to the watch that its reader has not taken yet. */
  owed: number;
  /** Whether the watch still hears: a removed folder and a replaced file go quiet but stay open. */
  alive: boolean;
  give: (event: FileSystem.WatchEvent) => void;
}

/** The disk, and what a law does to it while a program runs. */
export interface LiveDisk {
  readonly fileSystem: FileSystem.FileSystem;
  /** The file system and the path service, as `layer` gives them. */
  readonly layer: Layer.Layer<FileSystem.FileSystem | Path.Path>;
  /** Writes a file in place when it is there (an `Update`), else makes it (a `Create`). Its folder must be there. */
  readonly write: (path: string, text: string) => Effect.Effect<void>;
  /** Moves a file over what is at `to`: a `Remove` of the old name, a `Create` of the new one. */
  readonly rename: (from: string, to: string) => Effect.Effect<void>;
  /** Removes a file. */
  readonly remove: (path: string) => Effect.Effect<void>;
  /** Makes a folder, and each folder above it. */
  readonly makeFolder: (path: string) => Effect.Effect<void>;
  /** Removes a folder with all it holds. A watch on it says so once and goes quiet. */
  readonly removeFolder: (path: string) => Effect.Effect<void>;
  /** The text of a file now, or none. */
  readonly text: (path: string) => Effect.Effect<string | undefined>;
  /** Makes each later read of `path` fail with `fault`, or stop failing when none is given. */
  readonly breakRead: (path: string, fault?: PlatformError.PlatformError) => Effect.Effect<void>;
  /** Makes each later watch of `path` fail with `fault`, or stop failing when none is given. */
  readonly plant: (path: string, fault?: PlatformError.PlatformError) => Effect.Effect<void>;
  /** Runs `hook` with the path at the start of each `watch` call, before the watch is installed and before it calls `onReady`. */
  readonly beforeReady: (hook: (path: string) => Effect.Effect<void>) => Effect.Effect<void>;
  /** How many watches are open now: started, and not yet closed. */
  readonly open: Effect.Effect<number>;
  /** How many events were given to a watch that its reader has not taken yet. */
  readonly owed: Effect.Effect<number>;
  /** The path of each watch that reached `onReady`, in order. */
  readonly ready: Effect.Effect<ReadonlyArray<string>>;
}

const dirname = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 1));

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** `/a/b/c` gives `/a`, `/a/b` and `/a/b/c`. */
const above = (path: string): ReadonlyArray<string> => {
  const words = path.split("/").filter((word) => word !== "");

  return words.map((_, n) => `/${words.slice(0, n + 1).join("/")}`);
};

/** The events a watch gives, each made by its maker. */
const Event = Schema.TaggedUnion({
  Create: { path: Schema.String },
  Update: { path: Schema.String },
  Remove: { path: Schema.String },
});

/** A live disk, made with the files and folders it starts with. */
export const live = (seed: LiveSeed = {}): Effect.Effect<LiveDisk> =>
  Effect.sync(() => {
    let next = 1;
    const files = new Map<string, Held>();
    const folders = new Map<string, number>();
    const broken = new Map<string, PlatformError.PlatformError>();
    const planted = new Map<string, PlatformError.PlatformError>();
    const watchers = new Set<Watcher>();
    const readied: Array<string> = [];
    let hook: (path: string) => Effect.Effect<void> = () => Effect.void;

    const hear = (watcher: Watcher, event: FileSystem.WatchEvent) => {
      if (watcher.alive) {
        watcher.owed += 1;
        watcher.give(event);
      }
    };

    /** An event in a folder: heard by each live watch on that folder as it stands now. */
    const inFolder = (place: string, event: FileSystem.WatchEvent) => {
      for (const watcher of watchers) {
        if (watcher.folder && watcher.path === place && watcher.id === folders.get(place)) {
          hear(watcher, event);
        }
      }
    };

    /** An event on one file: heard by each watch on that very file, wherever its name has gone since. */
    const onFile = (id: number, event: FileSystem.WatchEvent) => {
      for (const watcher of watchers) {
        if (!watcher.folder && watcher.id === id) {
          hear(watcher, event);
        }
      }
    };

    const folder = (path: string) => {
      for (const one of above(path)) {
        if (!folders.has(one)) {
          folders.set(one, next++);
          inFolder(dirname(one), Event.cases.Create.make({ path: basename(one) }));
        }
      }
    };

    for (const path of Object.keys(seed.files ?? {})) {
      folder(dirname(path));
    }

    for (const path of seed.folders ?? []) {
      folder(path);
    }

    for (const [path, text] of Object.entries(seed.files ?? {})) {
      files.set(path, { id: next++, text });
    }

    const read = (path: string) => {
      const fault = broken.get(path);
      const held = files.get(path);

      return fault !== undefined
        ? Effect.fail(fault)
        : held === undefined
          ? noop.readFileString(path)
          : Effect.succeed(held.text);
    };

    const watch = (path: string, options?: FileSystem.WatchOptions) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* hook(path);

          const fault = planted.get(path);
          const id = folders.get(path) ?? files.get(path)?.id;

          if (fault !== undefined || id === undefined) {
            return fault === undefined ? noop.watch(path) : Stream.fail(fault);
          }

          const watcher: Watcher = { folder: folders.has(path), path, id, owed: 0, alive: true, give: () => {} };

          return Stream.callback<FileSystem.WatchEvent, PlatformError.PlatformError>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                watcher.give = (event) => {
                  Queue.offerUnsafe(queue, event);
                };

                watchers.add(watcher);
                readied.push(path);
                options?.onReady?.();
              }),
              () => Effect.sync(() => void watchers.delete(watcher)),
            ),
          ).pipe(
            Stream.tap(() =>
              Effect.sync(() => {
                watcher.owed -= 1;
              }),
            ),
          );
        }),
      );

    const fileSystem = FileSystem.makeNoop({
      exists: (path) => Effect.succeed(files.has(path) || folders.has(path)),
      readFileString: read,
      readFile: (path) => Effect.map(read(path), (text) => new TextEncoder().encode(text)),
      watch,
    });

    /** A watch on a file that is gone or replaced hears that once and goes quiet. */
    const gone = (held: Held, path: string) => {
      onFile(held.id, Event.cases.Remove.make({ path: basename(path) }));

      for (const watcher of watchers) {
        if (!watcher.folder && watcher.id === held.id) {
          watcher.alive = false;
        }
      }
    };

    return {
      fileSystem,
      layer: Layer.merge(Layer.succeed(FileSystem.FileSystem)(fileSystem), Path.layer),
      write: (path, text) =>
        Effect.sync(() => {
          const held = files.get(path);

          if (!folders.has(dirname(path))) {
            throw new Error(`the stand-in disk has no folder ${dirname(path)}`);
          }

          if (held === undefined) {
            files.set(path, { id: next++, text });
            inFolder(dirname(path), Event.cases.Create.make({ path: basename(path) }));
          } else {
            files.set(path, { id: held.id, text });
            inFolder(dirname(path), Event.cases.Update.make({ path: basename(path) }));
            onFile(held.id, Event.cases.Update.make({ path: basename(path) }));
          }
        }),
      rename: (from, to) =>
        Effect.sync(() => {
          const moving = files.get(from);

          if (moving === undefined) {
            throw new Error(`the stand-in disk has no file ${from}`);
          }

          const replaced = files.get(to);

          files.delete(from);
          files.set(to, moving);
          inFolder(dirname(from), Event.cases.Remove.make({ path: basename(from) }));
          inFolder(dirname(to), Event.cases.Create.make({ path: basename(to) }));

          if (replaced !== undefined) {
            gone(replaced, to);
          }
        }),
      remove: (path) =>
        Effect.sync(() => {
          const held = files.get(path);

          if (held !== undefined) {
            files.delete(path);
            inFolder(dirname(path), Event.cases.Remove.make({ path: basename(path) }));
            gone(held, path);
          }
        }),
      makeFolder: (path) => Effect.sync(() => folder(path)),
      removeFolder: (path) =>
        Effect.sync(() => {
          const id = folders.get(path);

          if (id === undefined) {
            return;
          }

          for (const [at, held] of [...files]) {
            if (at.startsWith(`${path}/`)) {
              files.delete(at);
              gone(held, at);
            }
          }

          // A watch on the folder hears its own name once, then nothing more: it keeps the inode that is gone.
          inFolder(path, Event.cases.Remove.make({ path: basename(path) }));

          for (const watcher of watchers) {
            if (watcher.folder && watcher.id === id) {
              watcher.alive = false;
            }
          }

          for (const [at] of [...folders]) {
            if (at === path || at.startsWith(`${path}/`)) {
              folders.delete(at);
            }
          }

          inFolder(dirname(path), Event.cases.Remove.make({ path: basename(path) }));
        }),
      text: (path) => Effect.sync(() => files.get(path)?.text),
      breakRead: (path, fault) =>
        Effect.sync(() => {
          if (fault === undefined) {
            broken.delete(path);
          } else {
            broken.set(path, fault);
          }
        }),
      plant: (path, fault) =>
        Effect.sync(() => {
          if (fault === undefined) {
            planted.delete(path);
          } else {
            planted.set(path, fault);
          }
        }),
      beforeReady: (before) =>
        Effect.sync(() => {
          hook = before;
        }),
      open: Effect.sync(() => watchers.size),
      owed: Effect.sync(() => [...watchers].reduce((sum, watcher) => sum + watcher.owed, 0)),
      ready: Effect.sync(() => [...readied]),
    };
  });

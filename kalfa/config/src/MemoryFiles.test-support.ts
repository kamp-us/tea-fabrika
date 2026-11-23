/**
 * A file system held in memory, for the laws of `SettingGroup.layer`: the files are a record of path to text, a path
 * that is not there answers `NotFound` as a real disk does, and a path named in `broken` fails with the error planted
 * there in place of its text. A law that wants the calls watches this service with `Recorder` (see SettingGroup.test.ts),
 * which lint keeps out of this file, since the package's own files import no workspace package. R1 checks this stand-in
 * against a real temp folder, so a law that reads from it is as true as one on a disk.
 */
import { Effect, FileSystem, Layer, Match, Path, PlatformError, Queue, Schema, Stream } from "effect";

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

// ---------------------------------------------------------------------------------------------
// A writable disk: files, folders and links that a program changes, as the disk calls of `SettingGroup` do (ticket 1843,
// slice 3). `writable` is a small POSIX in the calls those use: a write with the `"w"` and `"wx"` flags, `rename`, `remove`
// with `force`, `makeDirectory`, `realPath` over links, and a fault planted per call and path. SettingGroup.disk.test.ts
// runs on it, and R2 (SettingGroup.disk.integration.test.ts) checks it against a real temp folder, as R1 checks `make`.
// What it copies from the real disk, as Effect's Node backend reports it:
// - a write with `"wx"` fails `AlreadyExists` when anything is at the path, a link included, and a write with `"w"` goes
//   through a link to its target;
// - `rename` puts the old entry at the new path and replaces what was there, a link included, without following it;
// - `remove` takes a link itself out, and `force` makes a missing path no failure;
// - `makeDirectory` without `recursive` fails `AlreadyExists` for a path that is there and `NotFound` for a missing parent;
// - `realPath` follows every link and fails `NotFound` for a path that is not there.
// ---------------------------------------------------------------------------------------------

/** The calls a fault may name. */
export type Call =
  | "exists"
  | "makeDirectory"
  | "readDirectory"
  | "readDirectoryEntries"
  | "readFile"
  | "readFileString"
  | "readLink"
  | "realPath"
  | "remove"
  | "rename"
  | "symlink"
  | "writeFile"
  | "writeFileString";

/** The calls that read a file's text: a fault on a file's read names both. */
export const READS: ReadonlyArray<Call> = ["readFile", "readFileString"];

/** The calls that write a file's text: a fault on a file's write names both. */
export const WRITES: ReadonlyArray<Call> = ["writeFile", "writeFileString"];

/** A call that fails with `error`, in place of its work. */
export interface Fault {
  readonly method: Call | ReadonlyArray<Call>;
  /** The path as the program gives it. For `rename`, the path it moves from. */
  readonly path: string;
  /** For a write: `"wx"` is the exclusive create, `"w"` is any other write. None names both. */
  readonly flag?: "w" | "wx" | undefined;
  readonly error: PlatformError.PlatformError;
}

/** What a writable disk starts with. Every folder above a file, a link or a folder is made too. */
export interface Seed {
  readonly files?: Readonly<Record<string, string>> | undefined;
  readonly folders?: ReadonlyArray<string> | undefined;
  /** Each link's path, and the path it points to. */
  readonly links?: Readonly<Record<string, string>> | undefined;
  readonly faults?: ReadonlyArray<Fault> | undefined;
}

/** A disk a program changes, and what a law reads back from it. */
export interface Writable {
  readonly fileSystem: FileSystem.FileSystem;
  /** The file system and the path service, as `layer` gives them. */
  readonly layer: Layer.Layer<FileSystem.FileSystem | Path.Path>;
  /** The text of every file now, by path. A link is not a file. */
  readonly files: Effect.Effect<Readonly<Record<string, string>>>;
  /** Every folder now, but the root. */
  readonly folders: Effect.Effect<ReadonlyArray<string>>;
  /** Every link now, and the path it points to. */
  readonly links: Effect.Effect<Readonly<Record<string, string>>>;
}

type Entry =
  | { readonly kind: "file"; readonly text: string }
  | { readonly kind: "folder" }
  | { readonly kind: "link"; readonly target: string };

const up = (path: string) => (path.lastIndexOf("/") <= 0 ? "/" : path.slice(0, path.lastIndexOf("/")));

const words = (path: string) => path.split("/").filter((word) => word !== "");

const joined = (parts: ReadonlyArray<string>) => (parts.length === 0 ? "/" : `/${parts.join("/")}`);

/** A disk with `seed` on it. */
export const writable = (seed: Seed = {}): Writable => {
  const entries = new Map<string, Entry>();
  const faults = seed.faults ?? [];

  const failure = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
    // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect PlatformError requires its own system error tag
    PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });

  /** Every path of a folder's ancestors, root first. */
  const above = (path: string) => words(path).map((_, n) => joined(words(path).slice(0, n + 1)));

  const makeFolders = (path: string) => {
    for (const one of above(path)) {
      if (!entries.has(one)) {
        entries.set(one, { kind: "folder" });
      }
    }
  };

  for (const [path, text] of Object.entries(seed.files ?? {})) {
    makeFolders(up(path));
    entries.set(path, { kind: "file", text });
  }

  for (const path of seed.folders ?? []) {
    makeFolders(path);
  }

  for (const [path, target] of Object.entries(seed.links ?? {})) {
    makeFolders(up(path));
    entries.set(path, { kind: "link", target });
  }

  /** Where a path leads once every link in it is followed: the last one only when `last` says so. */
  const resolve = (path: string, last = true, hops = 0): string => {
    const parts = words(path);
    let at = "";

    for (const [n, part] of parts.entries()) {
      at = `${at}/${part}`;
      const entry = entries.get(at);

      if (entry?.kind === "link" && (last || n < parts.length - 1) && hops < 32) {
        const target = entry.target.startsWith("/") ? entry.target : `${up(at)}/${entry.target}`;

        return resolve(joined([...words(target), ...parts.slice(n + 1)]), last, hops + 1);
      }
    }

    return joined(parts);
  };

  const planted = (method: Call, path: string, flag?: "w" | "wx") =>
    faults.find(
      (fault) =>
        fault.path === path &&
        (Array.isArray(fault.method) ? fault.method.includes(method) : fault.method === method) &&
        (fault.flag === undefined || fault.flag === flag),
    )?.error;

  /** A call: the fault planted for it, or its work. */
  const call = <A>(
    method: Call,
    path: string,
    work: () => Effect.Effect<A, PlatformError.PlatformError>,
    flag?: "w" | "wx",
  ): Effect.Effect<A, PlatformError.PlatformError> =>
    Effect.suspend(() => {
      const fault = planted(method, path, flag);

      return fault === undefined ? work() : Effect.fail(fault);
    });

  /** The folder a new entry goes in: it must be there, and be a folder. */
  const parent = (method: string, path: string): Effect.Effect<void, PlatformError.PlatformError> => {
    const folder = resolve(up(path));
    const entry = folder === "/" ? { kind: "folder" } : entries.get(folder);

    return entry === undefined
      ? Effect.fail(failure("NotFound", method, path))
      : entry.kind === "folder"
        ? Effect.void
        : Effect.fail(failure("BadResource", method, path));
  };

  const read = (method: Call, path: string) =>
    call(method, path, () => {
      const entry = entries.get(resolve(path));

      return entry === undefined
        ? Effect.fail(failure("NotFound", method, path))
        : entry.kind === "file"
          ? Effect.succeed(entry.text)
          : Effect.fail(failure("BadResource", method, path));
    });

  const write = (method: Call, path: string, text: string, flag: "w" | "wx") =>
    call(
      method,
      path,
      () =>
        Effect.gen(function* () {
          yield* parent(method, resolve(path, false));

          const at = flag === "wx" ? resolve(path, false) : resolve(path);
          const held = entries.get(at);

          if (flag === "wx" && held !== undefined) {
            return yield* Effect.fail(failure("AlreadyExists", method, path));
          }

          if (held !== undefined && held.kind !== "file") {
            return yield* Effect.fail(failure("BadResource", method, path));
          }

          yield* parent(method, at);
          entries.set(at, { kind: "file", text });
        }),
      flag,
    );

  const flagged = (flag: FileSystem.OpenFlag | undefined) => {
    if (flag !== undefined && flag !== "w" && flag !== "wx") {
      throw new Error(`the stand-in disk writes only with "w" and "wx", not ${flag}`);
    }

    return flag ?? "w";
  };

  const below = (path: string) => [...entries.keys()].filter((at) => at.startsWith(`${path}/`));

  const listing = (method: Call, path: string) =>
    call(method, path, () => {
      const folder = resolve(path);
      const entry = folder === "/" ? { kind: "folder" } : entries.get(folder);

      return entry === undefined
        ? Effect.fail(failure("NotFound", method, path))
        : entry.kind === "folder"
          ? Effect.succeed(
              [...entries.entries()]
                .filter(([at]) => at !== "/" && up(at) === folder)
                .map(([at, held]) => ({ name: at.slice(at.lastIndexOf("/") + 1), held })),
            )
          : Effect.fail(failure("BadResource", method, path));
    });

  const type = (held: Entry): FileSystem.File.Type =>
    Match.value(held).pipe(
      Match.when({ kind: "file" }, () => "File" as const),
      Match.when({ kind: "folder" }, () => "Directory" as const),
      Match.orElse(() => "SymbolicLink" as const),
    );

  const fileSystem = FileSystem.makeNoop({
    exists: (path) => call("exists", path, () => Effect.succeed(entries.has(resolve(path)))),
    readFileString: (path) => read("readFileString", path),
    readFile: (path) => Effect.map(read("readFile", path), (text) => new TextEncoder().encode(text)),
    writeFileString: (path, text, options) => write("writeFileString", path, text, flagged(options?.flag)),
    writeFile: (path, data, options) =>
      write("writeFile", path, new TextDecoder().decode(data), flagged(options?.flag)),
    rename: (from, to) =>
      call("rename", from, () =>
        Effect.gen(function* () {
          const old = resolve(from, false);
          const moving = entries.get(old);

          if (moving === undefined) {
            return yield* Effect.fail(failure("NotFound", "rename", from));
          }

          yield* parent("rename", resolve(to, false));
          const at = resolve(to, false);
          const replaced = entries.get(at);

          if (replaced?.kind === "folder" || (moving.kind === "folder" && replaced !== undefined)) {
            return yield* Effect.fail(failure("BadResource", "rename", to));
          }

          if (old === at) {
            return;
          }

          // A folder takes everything below it along.
          const carried = moving.kind === "folder" ? below(old).map((path) => [path, entries.get(path)] as const) : [];

          entries.delete(old);

          for (const [path] of carried) {
            entries.delete(path);
          }

          entries.set(at, moving);

          for (const [path, held] of carried) {
            if (held !== undefined) {
              entries.set(`${at}${path.slice(old.length)}`, held);
            }
          }
        }),
      ),
    remove: (path, options) =>
      call("remove", path, () => {
        const at = resolve(path, false);
        const held = entries.get(at);

        if (held === undefined) {
          return options?.force === true ? Effect.void : Effect.fail(failure("NotFound", "remove", path));
        }

        if (held.kind === "folder" && options?.recursive !== true) {
          return Effect.fail(failure("BadResource", "remove", path));
        }

        for (const inside of below(at)) {
          entries.delete(inside);
        }

        entries.delete(at);

        return Effect.void;
      }),
    makeDirectory: (path, options) =>
      call("makeDirectory", path, () =>
        Effect.gen(function* () {
          const at = resolve(path, false);
          const held = entries.get(at);

          if (options?.recursive === true) {
            if (held !== undefined && held.kind !== "folder") {
              return yield* Effect.fail(failure("AlreadyExists", "makeDirectory", path));
            }

            makeFolders(at);

            return;
          }

          yield* parent("makeDirectory", at);

          if (held !== undefined) {
            return yield* Effect.fail(failure("AlreadyExists", "makeDirectory", path));
          }

          entries.set(at, { kind: "folder" });
        }),
      ),
    realPath: (path) =>
      call("realPath", path, () => {
        const at = resolve(path);

        return at === "/" || entries.has(at) ? Effect.succeed(at) : Effect.fail(failure("NotFound", "realPath", path));
      }),
    readLink: (path) =>
      call("readLink", path, () => {
        const held = entries.get(resolve(path, false));

        return held === undefined
          ? Effect.fail(failure("NotFound", "readLink", path))
          : held.kind === "link"
            ? Effect.succeed(held.target)
            : Effect.fail(failure("Unknown", "readLink", path));
      }),
    symlink: (target, path) =>
      call("symlink", path, () =>
        Effect.gen(function* () {
          const at = resolve(path, false);

          yield* parent("symlink", at);

          if (entries.has(at)) {
            return yield* Effect.fail(failure("AlreadyExists", "symlink", path));
          }

          entries.set(at, { kind: "link", target });
        }),
      ),
    readDirectory: (path) => Effect.map(listing("readDirectory", path), (found) => found.map(({ name }) => name)),
    readDirectoryEntries: (path) =>
      Effect.map(listing("readDirectoryEntries", path), (found) =>
        found.map(({ name, held }) => ({ name, type: type(held) })),
      ),
  });

  return {
    fileSystem,
    layer: Layer.merge(Layer.succeed(FileSystem.FileSystem)(fileSystem), Path.layer),
    files: Effect.sync(() =>
      Object.fromEntries([...entries].flatMap(([path, held]) => (held.kind === "file" ? [[path, held.text]] : []))),
    ),
    folders: Effect.sync(() => [...entries].flatMap(([path, held]) => (held.kind === "folder" ? [path] : [])).sort()),
    links: Effect.sync(() =>
      Object.fromEntries([...entries].flatMap(([path, held]) => (held.kind === "link" ? [[path, held.target]] : []))),
    ),
  };
};

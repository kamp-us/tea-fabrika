// P39 slice 4b, next/: a file system in memory for the node client's merge-line laws (C1 to C3, K1,
// K2), over Effect's own `FileSystem.layerNoop`. It keeps POSIX's facts the laws lean on: a mode
// set only when a file is made, `wx` and `link` refuse a name that exists, a hard link shares its
// file, `rename` replaces, and `stat` reports the type bits with the permission bits, as Node does.
// Nothing here touches the disk. A call it does not model fails, as `layerNoop` makes it.
import type { Layer, Scope } from "effect";
import { Effect, FileSystem, Option, PlatformError } from "effect";
import { ByteSize } from "effect";

type FileNode = { readonly type: "File"; bytes: Uint8Array; mode: number; mtime: Date };

type DirectoryNode = { readonly type: "Directory"; mode: number; mtime: Date };

type Entry = FileNode | DirectoryNode;

/** The disk the laws read: each path's entry. A hard link is the same object under two names. */
export type Disk = {
  readonly entries: Map<string, Entry>;
  /** Every call, by method and path, in order, so a law can say what was touched. */
  readonly calls: Array<{ readonly method: string; readonly path: string }>;
};

/** A time as a `Date`, outside any Effect code. */
const dateAt = (ms: number): Date => new Date(ms);

const S_IFREG = 0o100000;

const S_IFDIR = 0o040000;

const fail = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
  Effect.fail(
    // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect's PlatformError takes its system error tag as `_tag`
    PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path }),
  );

/** A path as the disk keys it: no doubled or trailing slash, and `.` segments dropped. */
export const normal = (path: string): string => {
  const parts = path.split("/").filter((p) => p !== "" && p !== ".");
  const kept: Array<string> = [];

  for (const part of parts) {
    if (part === "..") {
      kept.pop();
    } else {
      kept.push(part);
    }
  }

  return `${path.startsWith("/") ? "/" : ""}${kept.join("/")}`;
};

const parent = (path: string): string => {
  const at = path.lastIndexOf("/");

  return at <= 0 ? "/" : path.slice(0, at);
};

/** A new empty disk with the root and the folders given, each mode 0755. */
export const disk = (folders: ReadonlyArray<string> = []): Disk => {
  const entries = new Map<string, Entry>([["/", { type: "Directory", mode: 0o755, mtime: new Date(0) }]]);

  for (const folder of folders) {
    let at = "";

    for (const part of normal(folder)
      .split("/")
      .filter((p) => p !== "")) {
      at = `${at}/${part}`;

      if (!entries.has(at)) {
        entries.set(at, { type: "Directory", mode: 0o755, mtime: new Date(0) });
      }
    }
  }

  return { entries, calls: [] };
};

/** Puts a file on the disk as a person or another program would, with its mode. */
export const put = (d: Disk, path: string, bytes: Uint8Array, mode: number): void => {
  d.entries.set(normal(path), { type: "File", bytes: new Uint8Array(bytes), mode: mode & 0o7777, mtime: new Date(0) });
};

/** A file's bytes and permission bits, or null when the path holds no file. */
export const read = (d: Disk, path: string): { readonly bytes: Uint8Array; readonly mode: number } | null => {
  const entry = d.entries.get(normal(path));

  return entry?.type === "File" ? { bytes: new Uint8Array(entry.bytes), mode: entry.mode } : null;
};

const info = (entry: Entry): FileSystem.File.Info => ({
  type: entry.type,
  mtime: Option.some(entry.mtime),
  atime: Option.some(entry.mtime),
  birthtime: Option.some(entry.mtime),
  dev: 1n,
  ino: Option.none(),
  mode: (entry.type === "File" ? S_IFREG : S_IFDIR) | entry.mode,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.bytes(entry.type === "File" ? entry.bytes.length : 0),
  blksize: Option.none(),
  blocks: Option.none(),
});

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);

  return out;
};

const isWrite = (flag: FileSystem.OpenFlag): boolean => flag !== "r";

const isExclusive = (flag: FileSystem.OpenFlag): boolean => flag.includes("x");

const isTruncate = (flag: FileSystem.OpenFlag): boolean => flag.startsWith("w");

/** Effect's `FileSystem` over the disk. Each call is recorded in `calls`. */
export const layer = (d: Disk): Layer.Layer<FileSystem.FileSystem> => {
  let temp = 0;
  let clock = 0;
  /** The disk's own clock: each change is one tick later, so no law reads the wall clock. */
  const tick = () => new Date(++clock * 1000);
  const seen = (method: string, path: string) => d.calls.push({ method, path });

  const stat = (method: string) => (raw: string) =>
    Effect.suspend(() => {
      const path = normal(raw);
      seen(method, path);
      const entry = d.entries.get(path);

      return entry === undefined ? fail("NotFound", method, path) : Effect.succeed(info(entry));
    });

  /** Makes or opens a file for writing, as `open(2)` with O_CREAT does: the mode counts only when it is made. */
  const create = (method: string, path: string, flag: FileSystem.OpenFlag, mode: number | undefined) =>
    Effect.suspend((): Effect.Effect<FileNode, PlatformError.PlatformError> => {
      const known = d.entries.get(path);

      if (known?.type === "Directory") {
        return fail("BadResource", method, path);
      }

      if (known !== undefined && isExclusive(flag)) {
        return fail("AlreadyExists", method, path);
      }

      if (known === undefined && !isWrite(flag)) {
        return fail("NotFound", method, path);
      }

      if (known === undefined) {
        if (d.entries.get(parent(path))?.type !== "Directory") {
          return fail("NotFound", method, path);
        }

        const made: FileNode = { type: "File", bytes: new Uint8Array(), mode: (mode ?? 0o666) & 0o7777, mtime: tick() };
        d.entries.set(path, made);

        return Effect.succeed(made);
      }

      if (isTruncate(flag)) {
        known.bytes = new Uint8Array();
      }

      return Effect.succeed(known);
    });

  const writeFile =
    (method: string) =>
    (
      raw: string,
      data: Uint8Array,
      options?: { readonly flag?: FileSystem.OpenFlag | undefined; readonly mode?: number | undefined },
    ) =>
      Effect.gen(function* () {
        const path = normal(raw);
        seen(method, path);
        const flag = options?.flag ?? "w";
        const file = yield* create(method, path, flag, options?.mode);
        file.bytes = flag.startsWith("a") ? concat(file.bytes, data) : new Uint8Array(data);
        file.mtime = tick();
      });

  const readFile = (method: string) => (raw: string) =>
    Effect.suspend(() => {
      const path = normal(raw);
      seen(method, path);
      const entry = d.entries.get(path);

      return entry === undefined
        ? fail("NotFound", method, path)
        : entry.type === "Directory"
          ? fail("BadResource", method, path)
          : Effect.succeed(new Uint8Array(entry.bytes));
    });

  const makeDirectory = (
    raw: string,
    options?: { readonly recursive?: boolean | undefined; readonly mode?: number | undefined },
  ) =>
    Effect.suspend((): Effect.Effect<void, PlatformError.PlatformError> => {
      const path = normal(raw);
      seen("makeDirectory", path);
      const known = d.entries.get(path);

      if (known !== undefined) {
        return options?.recursive === true && known.type === "Directory"
          ? Effect.void
          : fail("AlreadyExists", "makeDirectory", path);
      }

      if (d.entries.get(parent(path))?.type !== "Directory") {
        if (options?.recursive !== true) {
          return fail("NotFound", "makeDirectory", path);
        }

        return makeDirectory(parent(path), options).pipe(Effect.andThen(makeDirectory(path, options)));
      }

      d.entries.set(path, { type: "Directory", mode: (options?.mode ?? 0o777) & 0o7777, mtime: tick() });

      return Effect.void;
    });

  const remove = (
    raw: string,
    options?: { readonly recursive?: boolean | undefined; readonly force?: boolean | undefined },
  ) =>
    Effect.suspend((): Effect.Effect<void, PlatformError.PlatformError> => {
      const path = normal(raw);
      seen("remove", path);
      const known = d.entries.get(path);

      if (known === undefined) {
        return options?.force === true ? Effect.void : fail("NotFound", "remove", path);
      }

      const below = [...d.entries.keys()].filter((k) => k.startsWith(`${path}/`));

      if (known.type === "Directory" && below.length > 0 && options?.recursive !== true) {
        return fail("Busy", "remove", path);
      }

      for (const k of [path, ...below]) {
        d.entries.delete(k);
      }

      return Effect.void;
    });

  const tempName = (directory: string | undefined, prefix: string | undefined, suffix = "") =>
    normal(`${directory ?? "/tmp"}/${prefix ?? "tmp-"}${++temp}${suffix}`);

  const open = (
    raw: string,
    options?: {
      readonly flag?: FileSystem.OpenFlag | undefined;
      readonly mode?: number | undefined;
      readonly noFollow?: boolean | undefined;
    },
  ) =>
    Effect.gen(function* () {
      const path = normal(raw);
      seen("open", path);
      const flag = options?.flag ?? "r";
      const file = yield* create("open", path, flag, options?.mode);
      let position = flag.startsWith("a") ? BigInt(file.bytes.length) : 0n;
      yield* Effect.addFinalizer(() => Effect.sync(() => seen("close", path)));

      const write = (buffer: Uint8Array) =>
        Effect.sync(() => {
          const at = Number(position);
          const out = new Uint8Array(Math.max(file.bytes.length, at + buffer.length));
          out.set(file.bytes, 0);
          out.set(buffer, at);
          file.bytes = out;
          file.mtime = tick();
          position += BigInt(buffer.length);

          return buffer.length;
        });

      const handle: FileSystem.File = {
        [FileSystem.FileTypeId]: FileSystem.FileTypeId,
        stat: Effect.sync(() => info(file)),
        seek: (offset, from) =>
          Effect.sync(() => {
            position = from === "start" ? offset : position + offset;

            return position;
          }),
        sync: Effect.sync(() => seen("sync", path)),
        read: (buffer, readOptions) =>
          Effect.sync(() => {
            const at = Number(readOptions?.position ?? position);
            const chunk = file.bytes.subarray(at, at + buffer.length);
            buffer.set(chunk);
            position = BigInt(at + chunk.length);

            return chunk.length;
          }),
        readAlloc: (size, readOptions) =>
          Effect.sync(() => {
            const at = Number(readOptions?.position ?? position);
            const chunk = file.bytes.slice(at, at + Number(size));
            position = BigInt(at + chunk.length);

            return chunk.length === 0 ? Option.none() : Option.some(chunk);
          }),
        truncate: (length) =>
          Effect.sync(() => {
            file.bytes = file.bytes.slice(0, Number(length ?? 0));
          }),
        write,
        writeAll: (buffer) => Effect.asVoid(write(buffer)),
      };

      return handle;
    });

  return FileSystem.layerNoop({
    access: (raw) => stat("access")(raw).pipe(Effect.asVoid),
    exists: (raw) =>
      Effect.sync(() => {
        seen("exists", normal(raw));

        return d.entries.has(normal(raw));
      }),
    stat: stat("stat"),
    lstat: stat("lstat"),
    realPath: (raw) => stat("realPath")(raw).pipe(Effect.as(normal(raw))),
    readFile: readFile("readFile"),
    readFileString: (raw) =>
      readFile("readFileString")(raw).pipe(Effect.map((bytes) => new TextDecoder().decode(bytes))),
    writeFile: writeFile("writeFile"),
    writeFileString: (raw, data, options) => writeFile("writeFileString")(raw, new TextEncoder().encode(data), options),
    makeDirectory,
    remove,
    open,
    chmod: (raw, mode) =>
      Effect.suspend(() => {
        const path = normal(raw);
        seen("chmod", path);
        const entry = d.entries.get(path);

        if (entry === undefined) {
          return fail("NotFound", "chmod", path);
        }

        entry.mode = mode & 0o7777;

        return Effect.void;
      }),
    link: (rawFrom, rawTo) =>
      Effect.suspend(() => {
        const from = normal(rawFrom),
          to = normal(rawTo);

        seen("link", to);
        const entry = d.entries.get(from);

        if (entry === undefined) {
          return fail("NotFound", "link", from);
        }

        if (d.entries.has(to)) {
          return fail("AlreadyExists", "link", to);
        }

        d.entries.set(to, entry);

        return Effect.void;
      }),
    rename: (rawFrom, rawTo) =>
      Effect.suspend(() => {
        const from = normal(rawFrom),
          to = normal(rawTo);

        seen("rename", to);
        const entry = d.entries.get(from);

        if (entry === undefined) {
          return fail("NotFound", "rename", from);
        }

        d.entries.delete(from);
        d.entries.set(to, entry);

        return Effect.void;
      }),
    copyFile: (rawFrom, rawTo) =>
      readFile("copyFile")(rawFrom).pipe(Effect.flatMap((bytes) => writeFile("copyFile")(rawTo, bytes))),
    readDirectory: (raw) =>
      Effect.suspend(() => {
        const path = normal(raw);
        seen("readDirectory", path);

        if (d.entries.get(path)?.type !== "Directory") {
          return fail("NotFound", "readDirectory", path);
        }

        const prefix = path === "/" ? "/" : `${path}/`;

        return Effect.succeed(
          [...d.entries.keys()]
            .filter((k) => k.startsWith(prefix) && k !== path && !k.slice(prefix.length).includes("/"))
            .map((k) => k.slice(prefix.length)),
        );
      }),
    makeTempFile: (options) =>
      Effect.gen(function* () {
        const path = tempName(options?.directory, options?.prefix, options?.suffix);
        yield* writeFile("makeTempFile")(path, new Uint8Array(), { flag: "wx", mode: 0o600 });

        return path;
      }),
    makeTempFileScoped: (options) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const path = tempName(options?.directory, options?.prefix, options?.suffix);
          yield* writeFile("makeTempFile")(path, new Uint8Array(), { flag: "wx", mode: 0o600 });

          return path;
        }),
        (path) => remove(path, { force: true }).pipe(Effect.ignore),
      ),
    makeTempDirectory: (options) =>
      Effect.gen(function* () {
        const path = tempName(options?.directory, options?.prefix);
        yield* makeDirectory(path, { mode: 0o700 });

        return path;
      }),
    makeTempDirectoryScoped: (options): Effect.Effect<string, PlatformError.PlatformError, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const path = tempName(options?.directory, options?.prefix);
          yield* makeDirectory(path, { mode: 0o700 });

          return path;
        }),
        (path) => remove(path, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    truncate: (raw, length) =>
      Effect.suspend(() => {
        const entry = d.entries.get(normal(raw));

        if (entry?.type !== "File") {
          return fail("NotFound", "truncate", normal(raw));
        }

        entry.bytes = entry.bytes.slice(0, Number(length ?? 0));

        return Effect.void;
      }),
    utimes: (raw, _atime, mtime) =>
      Effect.suspend(() => {
        const entry = d.entries.get(normal(raw));

        if (entry === undefined) {
          return fail("NotFound", "utimes", normal(raw));
        }

        entry.mtime = typeof mtime === "number" ? dateAt(mtime) : mtime;

        return Effect.void;
      }),
  });
};

// Today's tooling. keepruns.sh's laws, kept with their titles and assertions, now on its port: the
// Runs service's real layer on the file system, `box/RunsFs.ts`, run here on a disk in memory over
// Effect's own `FileSystem.layerNoop`, so no case touches the real disk or starts a process (0113).
// The rm suite's real-git world (`box/BoxTestGit.ts`) runs the same layer on the real disk.
//
// The disk keeps the facts the laws lean on: a symlink is its own entry that `lstat` and `readLink`
// see and `stat`, `exists` and `realPath` follow; `rename` moves a whole tree and never replaces a
// folder that holds anything; `makeDirectory` without `recursive` refuses a name that exists. A
// call it does not model fails, as `layerNoop` makes it.
import { Effect, FileSystem, Layer, Option, Path, PlatformError } from "effect";
import { ByteSize } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Runs } from "./box/Runs.ts";
import * as RunsFs from "./box/RunsFs.ts";

type Entry =
  | { readonly _tag: "folder" }
  | { readonly _tag: "file"; readonly bytes: Uint8Array }
  | { readonly _tag: "link"; readonly to: string };

/** The disk: each absolute path's entry. The root is always there. */
type Disk = Map<string, Entry>;

const ROOT = "/disk";

const fail = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
  Effect.fail(PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path }));

/** A path as the disk keys it: absolute, no doubled or trailing slash, `.` and `..` read. */
const normal = (path: string): string => {
  const kept: Array<string> = [];

  for (const part of path.split("/")) {
    if (part === "..") {
      kept.pop();
    } else if (part !== "" && part !== ".") {
      kept.push(part);
    }
  }

  return `/${kept.join("/")}`;
};

const folderAbove = (path: string): string => normal(`${path}/..`);

const lastName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const under = (path: string, folder: string): boolean => path.startsWith(folder === "/" ? "/" : `${folder}/`);

/**
 * Where `path` really is: every link on the way read, the last one only when `follow`. Null when a
 * folder on the way is missing or is not a folder; the last name itself may be missing.
 */
const locate = (disk: Disk, path: string, follow: boolean, depth = 0): string | null => {
  if (depth > 40) {
    return null;
  }

  const parts = normal(path).split("/").filter(Boolean);
  let at = "/";

  for (const [i, part] of parts.entries()) {
    const next = normal(`${at}/${part}`);
    const entry = disk.get(next);
    const last = i === parts.length - 1;

    if (entry?._tag === "link" && (!last || follow)) {
      const target = entry.to.startsWith("/") ? entry.to : `${at}/${entry.to}`;
      const rest = parts.slice(i + 1).join("/");

      return locate(disk, rest === "" ? target : `${target}/${rest}`, follow, depth + 1);
    }

    if (!last && entry?._tag !== "folder") {
      return null;
    }

    at = next;
  }

  return at;
};

const info = (entry: Entry): FileSystem.File.Info => ({
  type: entry._tag === "folder" ? "Directory" : entry._tag === "file" ? "File" : "SymbolicLink",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 1n,
  ino: Option.none(),
  mode: entry._tag === "folder" ? 0o040755 : entry._tag === "file" ? 0o100644 : 0o120777,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.bytes(entry._tag === "file" ? entry.bytes.length : 0),
  blksize: Option.none(),
  blocks: Option.none(),
});

/** The names right under a folder on the disk. */
const children = (disk: Disk, folder: string): Array<string> =>
  [...disk.keys()].filter((p) => p !== folder && folderAbove(p) === folder).map(lastName);

/** Effect's `FileSystem` over the disk. With `refuse`, every write fails, as a full or read-only disk does. */
const layer = (disk: Disk, refuse = false): Layer.Layer<FileSystem.FileSystem> => {
  const found = (method: string, path: string, follow: boolean) =>
    Effect.suspend(() => {
      const at = locate(disk, path, follow);
      const entry = at === null ? undefined : disk.get(at);

      return at === null || entry === undefined ? fail("NotFound", method, path) : Effect.succeed({ at, entry });
    });

  const folder = (method: string, path: string) =>
    Effect.flatMap(found(method, path, true), ({ at, entry }) =>
      entry._tag === "folder" ? Effect.succeed(at) : fail("BadResource", method, path),
    );

  /** Where a new entry goes: its parent must be a folder, and the name must be free unless `replace`. */
  const room = (method: string, path: string) =>
    Effect.suspend(() => {
      const at = locate(disk, path, false);
      const parent = at === null ? undefined : disk.get(folderAbove(at));

      return at === null || parent?._tag !== "folder" ? fail("NotFound", method, path) : Effect.succeed(at);
    });

  const moveTree = (from: string, to: string, keep: boolean) => {
    for (const [p, entry] of [...disk.entries()]) {
      if (p === from || under(p, from)) {
        disk.set(`${to}${p.slice(from.length)}`, entry);

        if (!keep) {
          disk.delete(p);
        }
      }
    }
  };

  const impl: Partial<FileSystem.FileSystem> = {
    access: (path) => Effect.asVoid(found("access", path, true)),
    exists: (path) => Effect.sync(() => locate(disk, path, true) !== null && disk.has(locate(disk, path, true) ?? "")),
    stat: (path) => Effect.map(found("stat", path, true), ({ entry }) => info(entry)),
    lstat: (path) => Effect.map(found("lstat", path, false), ({ entry }) => info(entry)),
    readLink: (path) =>
      Effect.flatMap(found("readLink", path, false), ({ entry }) =>
        entry._tag === "link" ? Effect.succeed(entry.to) : fail("InvalidData", "readLink", path),
      ),
    realPath: (path) => Effect.map(found("realPath", path, true), ({ at }) => at),
    readDirectory: (path, options) =>
      Effect.map(folder("readDirectory", path), (at) =>
        options?.recursive === true
          ? [...disk.keys()].filter((p) => under(p, at)).map((p) => p.slice(at.length + 1))
          : children(disk, at),
      ),
    readDirectoryEntries: (path) =>
      Effect.map(folder("readDirectoryEntries", path), (at) =>
        children(disk, at).map((name) => ({ name, type: info(disk.get(`${at}/${name}`) ?? { _tag: "folder" }).type })),
      ),
    makeDirectory: (path, options) =>
      Effect.suspend(() => {
        if (options?.recursive !== true) {
          return Effect.flatMap(room("makeDirectory", path), (at) =>
            disk.has(at)
              ? fail("AlreadyExists", "makeDirectory", path)
              : Effect.sync(() => disk.set(at, { _tag: "folder" })),
          );
        }

        let at = "/";

        for (const part of normal(path).split("/").filter(Boolean)) {
          const real = locate(disk, `${at}/${part}`, true);

          if (real === null) {
            return fail("NotFound", "makeDirectory", path);
          }

          const entry = disk.get(real);

          if (entry === undefined) {
            disk.set(real, { _tag: "folder" });
          } else if (entry._tag !== "folder") {
            return fail("AlreadyExists", "makeDirectory", path);
          }

          at = real;
        }

        return Effect.void;
      }),
    rename: (from, to) =>
      Effect.flatMap(
        Effect.all([found("rename", from, false), room("rename", to)], { concurrency: 1 }),
        ([{ at, entry }, dest]) =>
          Effect.suspend(() => {
            const there = disk.get(dest);

            if (dest === at) {
              return Effect.void;
            }

            if (under(dest, at)) {
              return fail("BadResource", "rename", to);
            }

            if (there !== undefined) {
              const empty = there._tag === "folder" && children(disk, dest).length === 0;

              if (entry._tag === "folder" ? !empty : there._tag === "folder") {
                return fail("AlreadyExists", "rename", to);
              }

              disk.delete(dest);
            }

            moveTree(at, dest, false);

            return Effect.void;
          }),
      ),
    copy: (from, to, options) =>
      Effect.flatMap(Effect.all([found("copy", from, true), room("copy", to)], { concurrency: 1 }), ([{ at }, dest]) =>
        disk.has(dest) && options?.overwrite !== true
          ? fail("AlreadyExists", "copy", to)
          : Effect.sync(() => moveTree(at, dest, true)),
      ),
    remove: (path, options) =>
      Effect.suspend(() => {
        const at = locate(disk, path, false);
        const entry = at === null ? undefined : disk.get(at);

        if (at === null || entry === undefined) {
          return options?.force === true ? Effect.void : fail("NotFound", "remove", path);
        }

        if (entry._tag === "folder" && children(disk, at).length > 0 && options?.recursive !== true) {
          return fail("BadResource", "remove", path);
        }

        for (const p of [...disk.keys()]) {
          if (p === at || under(p, at)) {
            disk.delete(p);
          }
        }

        return Effect.void;
      }),
    readFile: (path) =>
      Effect.flatMap(found("readFile", path, true), ({ entry }) =>
        entry._tag === "file" ? Effect.succeed(new Uint8Array(entry.bytes)) : fail("BadResource", "readFile", path),
      ),
    writeFile: (path, data) =>
      Effect.flatMap(room("writeFile", locate(disk, path, true) ?? path), (at) =>
        disk.get(at)?._tag === "folder"
          ? fail("BadResource", "writeFile", path)
          : Effect.sync(() => disk.set(at, { _tag: "file", bytes: new Uint8Array(data) })),
      ),
    symlink: (target, path) =>
      Effect.flatMap(room("symlink", path), (at) =>
        disk.has(at)
          ? fail("AlreadyExists", "symlink", path)
          : Effect.sync(() => disk.set(at, { _tag: "link", to: target })),
      ),
  };

  const refused = (method: string) => (path: string) => fail("PermissionDenied", method, path);

  return FileSystem.layerNoop(
    refuse
      ? {
          ...impl,
          makeDirectory: refused("makeDirectory"),
          rename: refused("rename"),
          copy: refused("copy"),
          copyFile: refused("copyFile"),
          remove: refused("remove"),
          writeFile: refused("writeFile"),
          symlink: refused("symlink"),
        }
      : impl,
  );
};

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/** Every file under a folder, as its relative path and content. */
const filesIn = (disk: Disk, root: string): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const [path, entry] of disk) {
    if (entry._tag === "file" && under(path, root)) {
      out[path.slice(root.length + 1)] = decoder.decode(entry.bytes);
    }
  }

  return out;
};

const mkdir = (disk: Disk, path: string) => {
  let at = "";

  for (const part of path.split("/").filter(Boolean)) {
    at = `${at}/${part}`;

    if (!disk.has(at)) {
      disk.set(at, { _tag: "folder" });
    }
  }
};

const write = (disk: Disk, root: string, files: Record<string, string>) => {
  mkdir(disk, root);

  for (const [path, text] of Object.entries(files)) {
    mkdir(disk, folderAbove(`${root}/${path}`));
    disk.set(normal(`${root}/${path}`), { _tag: "file", bytes: encoder.encode(text) });
  }
};

const existsOn = (disk: Disk, path: string): boolean => disk.has(normal(path));

const tree = fc.dictionary(
  fc.array(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 3 }).map((parts) => `${parts.join("/")}.json`),
  fc.stringMatching(/^[a-z0-9 ]{0,12}$/),
  { maxKeys: 5 },
);

/** A fresh disk with MAIN at `<root>/main`; `body` gets the disk, MAIN and the root. */
const withHome = (body: (disk: Disk, main: string, root: string) => void) => {
  const disk: Disk = new Map([["/", { _tag: "folder" }]]);
  const root = `${ROOT}/home`;
  const main = `${root}/main`;
  mkdir(disk, main);
  body(disk, main, root);
};

/** One keep through RunsFs on the disk, read as the old script's exit and stdout were. */
const run = (disk: Disk, main: string, folder: string, refuse = false) => {
  const kept = Effect.gen(function* () {
    const runs = yield* Runs;

    return yield* runs.keep(folder);
  }).pipe(
    Effect.provide(RunsFs.layer(main).pipe(Layer.provide(Layer.mergeAll(layer(disk, refuse), Path.layer)))),
    Effect.runSync,
  );

  return { code: kept.kept ? 0 : 1, out: kept.said.trim() };
};

describe("keepruns.sh, today's tooling", () => {
  // Plants: drop the move (the folder's runs/ is lost with it), overwrite a taken name, or move
  // into MAIN's runs/ without the folder's name. Field note 2026-11-09: a removed worktree took
  // experiment 244's raw answers with it.
  it("moves every file of a folder's runs/ into MAIN's runs/<name>/ and never overwrites one there", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}( x)?$/),
        tree,
        fc.array(tree, { maxLength: 2 }),
        (name, runs, taken) =>
          withHome((disk, main, root) => {
            const folder = `${root}/${name}`;
            mkdir(disk, folder);
            write(disk, `${folder}/runs`, runs);

            // Names already taken under MAIN's runs/: <name>, then <name>-1.
            const before = taken.map((files, i) => {
              const at = `${main}/runs/${i === 0 ? name : `${name}-${i}`}`;
              write(disk, at, files);

              return [at, filesIn(disk, at)] as const;
            });

            const got = run(disk, main, folder);
            expect(got.code).toBe(0);

            for (const [at, files] of before) {
              expect(filesIn(disk, at)).toEqual(files);
            }

            if (Object.keys(runs).length === 0) {
              expect(got.out).toBe("");

              return;
            }

            const dest = `${main}/runs/${taken.length === 0 ? name : `${name}-${taken.length}`}`;
            expect(got.out).toBe(`kept runs of ${name} at runs/${dest.split("/").at(-1)}`);
            expect(filesIn(disk, dest)).toEqual(runs);
            expect(existsOn(disk, `${folder}/runs`)).toBe(false);
          }),
      ),
      { seed: 119120, numRuns: 40 },
    );
  });

  it("scenario: a folder with no runs/ is left alone, and a runs/ symlink or MAIN itself fails", () => {
    // scenario: the three exits the callers read; a failure keeps the folder.
    withHome((disk, main, root) => {
      const plain = `${root}/plain`;
      mkdir(disk, plain);
      expect(run(disk, main, plain)).toEqual({ code: 0, out: "" });
      expect(existsOn(disk, `${main}/runs`)).toBe(false);
      const linked = `${root}/linked`;
      write(disk, `${root}/elsewhere`, { "a.json": "a" });
      mkdir(disk, linked);
      disk.set(`${linked}/runs`, { _tag: "link", to: `${root}/elsewhere` });
      expect(run(disk, main, linked).code).toBe(1);
      expect(filesIn(disk, `${root}/elsewhere`)).toEqual({ "a.json": "a" });
      write(disk, `${main}/runs`, { "own.json": "own" });
      expect(run(disk, main, main).code).toBe(1);
      expect(filesIn(disk, `${main}/runs`)).toEqual({ "own.json": "own" });
    });
  });

  // keepruns.sh's own comment names three refusals no law above pins: a runs/ that is a file, a
  // runs/ link whose target is gone (`[ -L ]` counts it as there), and a move that failed. Each
  // keeps the folder, and nothing on the disk changes. Plants: read a dangling link as "no runs/";
  // answer kept after a refused write; move a runs/ that is a file.
  it("property: a runs/ that is a file, any runs/ link, MAIN's own runs/ or a refused write keeps the folder and changes nothing", () => {
    const cases = ["file", "link", "dangling", "main", "refused"] as const;
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}( x)?$/),
        fc.constantFrom(...cases),
        tree.filter((runs) => Object.keys(runs).length > 0),
        fc.boolean(),
        (name, kind, runs, taken) =>
          withHome((disk, main, root) => {
            reached.add(`${kind} ${taken ? "taken" : "free"}`);
            const folder = kind === "main" ? main : `${root}/${name}`;
            mkdir(disk, folder);

            if (taken) {
              write(disk, `${main}/runs/${name}`, { "taken.json": "taken" });
            }

            if (kind === "file") {
              disk.set(`${folder}/runs`, { _tag: "file", bytes: encoder.encode("a file, not a folder") });
            } else if (kind === "link") {
              write(disk, `${root}/elsewhere`, runs);
              disk.set(`${folder}/runs`, { _tag: "link", to: `${root}/elsewhere` });
            } else if (kind === "dangling") {
              disk.set(`${folder}/runs`, { _tag: "link", to: `${root}/gone` });
            } else {
              write(disk, `${folder}/runs`, runs);
            }

            const before = JSON.stringify([...disk.entries()]);
            const got = run(disk, main, folder, kind === "refused");
            expect(got.code, kind).toBe(1);
            expect(JSON.stringify([...disk.entries()]), kind).toBe(before);
          }),
      ),
      { seed: 119120, numRuns: 100 },
    );
    // Every kind is reached both with its name free under MAIN's runs/ and with it taken.
    expect([...reached].toSorted()).toEqual(cases.flatMap((kind) => [`${kind} free`, `${kind} taken`]).toSorted());
  });
});

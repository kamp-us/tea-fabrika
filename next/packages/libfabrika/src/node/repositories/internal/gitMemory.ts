import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import type * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { String as Str, pipe } from "effect";

type Format = "sha1" | "sha256";

type Mode = "100644" | "100755" | "120000" | "040000" | "160000";

type Entry = { readonly mode: Mode; readonly id: string };

type Commit = {
  readonly tree: string;
  readonly parents: ReadonlyArray<string>;
  readonly author: string;
  readonly committer: string;
  readonly message: string;
};

type GitObject =
  | { readonly type: "blob"; readonly bytes: Uint8Array }
  | { readonly type: "tree"; readonly entries: ReadonlyMap<string, Entry> }
  | ({ readonly type: "commit" } & Commit);

/** What HEAD names, as git's own `HEAD` file holds it: a ref, or a commit when detached. */
type Head = { readonly ref: string } | { readonly commit: string };

/** One Git directory: its objects, refs and config, shared by every worktree of the clone. */
interface Store {
  readonly directory: string;
  readonly bare: boolean;
  readonly format: Format;
  readonly objects: Map<string, GitObject>;
  readonly refs: Map<string, string>;
  readonly config: Map<string, string>;
  /** HEAD of a bare repository, which has no worktree. */
  head: Head;
}

/** One checkout of a store: its root, its own HEAD and its index. */
interface Worktree {
  readonly root: string;
  readonly store: Store;
  head: Head;
  index: Map<string, Entry>;
}

/** Where one command runs: the objects it reads and writes, the refs and config it sees. */
interface Place {
  readonly store: Store;
  readonly refs: Map<string, string>;
  readonly config: Map<string, string>;
  readonly worktree: Worktree | null;
  readonly head: Head | null;
}

type Answer = { readonly code: number; readonly stdout: Uint8Array; readonly stderr: string };

const encoder = new TextEncoder();

const answer = (code: number, stdout: string | Uint8Array = "", stderr = ""): Answer => ({
  code,
  stdout: typeof stdout === "string" ? encoder.encode(stdout) : stdout,
  stderr,
});

const fatal = (message: string, code = 128) => answer(code, "", `fatal: ${message}\n`);

const NOT_A_REPOSITORY = "not a git repository (or any of the parent directories): .git";

const SAFE_GLOBALS = new Set(["--no-replace-objects", "--literal-pathspecs", "--no-pager"]);

const concat = (parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
};

const hexBytes = (hex: string) =>
  Uint8Array.from(
    Option.getOrElse(pipe(hex, Str.match(/../g)), (): Array<string> => []),
    (pair) => Number.parseInt(pair, 16),
  );

const isUrl = (remote: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(remote) || /^[^/]+:/.test(remote);

const objectType = (mode: Mode) => (mode === "040000" ? "tree" : mode === "160000" ? "commit" : "blob");

/** Git sorts tree entries by name, a tree's name read as if it ended in a slash. */
const treeOrder = (a: readonly [string, Entry], b: readonly [string, Entry]) => {
  const left = a[0] + (a[1].mode === "040000" ? "/" : ""),
    right = b[0] + (b[1].mode === "040000" ? "/" : "");

  return left < right ? -1 : left > right ? 1 : 0;
};

const sameEntry = (a: Entry | undefined, b: Entry | undefined) => a?.mode === b?.mode && a?.id === b?.id;

/**
 * Builds the `git` part of the in-memory spawner: one world of stores and worktrees, keyed by their
 * canonical locations on disk. Working trees stay on the real file system, so a checkout's files
 * are what a test writes; objects, refs, the index and config live only here.
 *
 * @internal
 */
export const make = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const digest = yield* Digest.Digest;
  const below = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stores = new Map<string, Store>();
  const worktrees = new Map<string, Worktree>();
  let clock = 1_700_000_000;
  let pid = 1;

  // Paths: everything is keyed by its real path, as git reports it.
  const canonical: (location: string) => Effect.Effect<string> = Effect.fnUntraced(function* (location: string) {
    const real = yield* fs.realPath(location).pipe(Effect.option);

    if (real._tag === "Some") {
      return real.value;
    }

    const parent = path.dirname(location);

    return parent === location ? location : path.join(yield* canonical(parent), path.basename(location));
  });

  // Objects.
  const hash = (format: Format, type: string, body: Uint8Array) =>
    digest.digestHex(
      format === "sha1" ? Digest.sha1 : Digest.sha256,
      concat([encoder.encode(`${type} ${body.length}\0`), body]),
    );

  const write = Effect.fnUntraced(function* (store: Store, object: GitObject) {
    const body =
      object.type === "blob"
        ? object.bytes
        : object.type === "tree"
          ? concat(
              [...object.entries]
                .sort(treeOrder)
                .flatMap(([name, entry]) => [
                  encoder.encode(`${entry.mode === "040000" ? "40000" : entry.mode} ${name}\0`),
                  hexBytes(entry.id),
                ]),
            )
          : encoder.encode(
              [
                `tree ${object.tree}`,
                ...object.parents.map((parent) => `parent ${parent}`),
                `author ${object.author}`,
                `committer ${object.committer}`,
                "",
                object.message,
              ].join("\n"),
            );

    const id = yield* hash(store.format, object.type, body);
    store.objects.set(id, object);

    return id;
  });

  const readCommit = (store: Store, id: string | null | undefined) => {
    const found = id === null || id === undefined ? undefined : store.objects.get(id);

    return found?.type === "commit" ? found : null;
  };

  const readTree = (store: Store, id: string) => {
    const found = store.objects.get(id);

    return found?.type === "tree" ? found.entries : new Map<string, Entry>();
  };

  const flatten = (store: Store, tree: string, prefix = "", into = new Map<string, Entry>()) => {
    for (const [name, entry] of readTree(store, tree)) {
      if (entry.mode === "040000") {
        flatten(store, entry.id, `${prefix}${name}/`, into);
      } else {
        into.set(`${prefix}${name}`, entry);
      }
    }

    return into;
  };

  const build: (store: Store, index: ReadonlyMap<string, Entry>) => Effect.Effect<string> = Effect.fnUntraced(
    function* (store: Store, index: ReadonlyMap<string, Entry>) {
      const entries = new Map<string, Entry>();
      const folders = new Map<string, Map<string, Entry>>();

      for (const [file, entry] of index) {
        const slash = pipe(file, Str.indexOf("/"));

        if (Option.isNone(slash)) {
          entries.set(file, entry);
        } else {
          const name = pipe(file, Str.slice(0, slash.value));
          const folder = folders.get(name) ?? new Map<string, Entry>();
          folder.set(pipe(file, Str.slice(slash.value + 1)), entry);
          folders.set(name, folder);
        }
      }

      for (const [name, inner] of folders) {
        entries.set(name, { mode: "040000", id: yield* build(store, inner) });
      }

      return yield* write(store, { type: "tree", entries });
    },
  );

  const lookup = (store: Store, tree: string, file: string): Entry | null => {
    const parts = Str.split(file, "/");
    let entries = readTree(store, tree);

    for (const [n, part] of parts.entries()) {
      const entry = entries.get(part);

      if (entry === undefined) {
        return null;
      }

      if (n === parts.length - 1) {
        return entry;
      }

      if (entry.mode !== "040000") {
        return null;
      }

      entries = readTree(store, entry.id);
    }

    return null;
  };

  const copy = (from: Store, to: Store, id: string) => {
    const pending = [id];

    while (pending.length > 0) {
      const next = pending.pop();
      const object = next === undefined || to.objects.has(next) ? undefined : from.objects.get(next);

      if (next === undefined || object === undefined) {
        continue;
      }

      to.objects.set(next, object);

      if (object.type === "commit") {
        pending.push(object.tree, ...object.parents);
      } else if (object.type === "tree") {
        pending.push(...[...object.entries.values()].filter((e) => e.mode !== "160000").map((e) => e.id));
      }
    }
  };

  const descends = (store: Store, ancestor: string, from: string) => {
    const seen = new Set<string>();
    const pending = [from];

    while (pending.length > 0) {
      const next = pending.pop();

      if (next === undefined || seen.has(next)) {
        continue;
      }

      if (next === ancestor) {
        return true;
      }

      seen.add(next);
      pending.push(...(readCommit(store, next)?.parents ?? []));
    }

    return false;
  };

  // Revisions: HEAD, a branch, a full ref or a full id, then `^`, `^N`, `~N` and `^{commit}`.
  const headCommit = (place: Place) =>
    place.head === null ? null : "ref" in place.head ? (place.refs.get(place.head.ref) ?? null) : place.head.commit;

  const revision = (place: Place, spelled: string): string | null => {
    const match = /^(.*?)((?:\^\{commit\}|\^[0-9]*|~[0-9]*)*)$/.exec(spelled);
    const base = match?.[1] ?? spelled;

    let id =
      base === "HEAD"
        ? headCommit(place)
        : (place.refs.get(base) ??
          place.refs.get(`refs/heads/${base}`) ??
          (place.store.objects.has(base) && base.length === (place.store.format === "sha1" ? 40 : 64) ? base : null));

    const steps = pipe(match?.[2] ?? "", Str.match(/\^\{commit\}|\^[0-9]*|~[0-9]*/g));

    for (const step of Option.getOrElse(steps, (): Array<string> => [])) {
      if (id === null) {
        return null;
      }

      if (step === "^{commit}") {
        id = readCommit(place.store, id) === null ? null : id;
      } else if (pipe(step, Str.startsWith("~"))) {
        for (let n = Number(pipe(step, Str.slice(1)) || "1"); n > 0 && id !== null; n--) {
          id = readCommit(place.store, id)?.parents[0] ?? null;
        }
      } else {
        const n = Number(pipe(step, Str.slice(1)) || "1");
        id = n === 0 ? id : (readCommit(place.store, id)?.parents[n - 1] ?? null);
      }
    }

    return id;
  };

  // The working tree, on disk.
  const scan: (
    root: string,
    folder: string,
    into: Map<string, Entry>,
    store: Store,
  ) => Effect.Effect<void, PlatformError.PlatformError> = Effect.fnUntraced(function* (
    root: string,
    folder: string,
    into: Map<string, Entry>,
    store: Store,
  ) {
    for (const name of yield* fs.readDirectory(path.join(root, folder))) {
      if (name === ".git") {
        continue;
      }

      const file = folder === "" ? name : `${folder}/${name}`;
      const location = path.join(root, file);
      const stat = yield* fs.lstat(location);

      if (stat.type === "SymbolicLink") {
        const target = encoder.encode(yield* fs.readLink(location));
        into.set(file, { mode: "120000", id: yield* write(store, { type: "blob", bytes: target }) });
      } else if (stat.type === "Directory") {
        yield* scan(root, file, into, store);
      } else if (stat.type === "File") {
        const bytes = yield* fs.readFile(location);
        into.set(file, {
          mode: (stat.mode & 0o100) === 0 ? "100644" : "100755",
          id: yield* write(store, { type: "blob", bytes }),
        });
      }
    }
  });

  const onDisk = Effect.fnUntraced(function* (worktree: Worktree, file: string) {
    const location = path.join(worktree.root, file);
    const stat = yield* fs.lstat(location).pipe(Effect.option);

    if (stat._tag === "None" || stat.value.type === "Directory") {
      return null;
    }

    if (stat.value.type === "SymbolicLink") {
      const target = encoder.encode(yield* fs.readLink(location));

      return { mode: "120000" as const, id: yield* hash(worktree.store.format, "blob", target) };
    }

    return {
      mode: (stat.value.mode & 0o100) === 0 ? ("100644" as const) : ("100755" as const),
      id: yield* hash(worktree.store.format, "blob", yield* fs.readFile(location)),
    };
  });

  const remove = Effect.fnUntraced(function* (root: string, file: string) {
    yield* fs.remove(path.join(root, file), { force: true });
    let folder = path.dirname(path.join(root, file));

    // Git drops the folders a removal empties, up to the worktree's root.
    while (folder !== root && pipe(folder, Str.startsWith(root))) {
      const left = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => ["?"]));

      if (left.length > 0) {
        break;
      }

      yield* fs.remove(folder, { recursive: true });
      folder = path.dirname(folder);
    }
  });

  const restore = Effect.fnUntraced(function* (worktree: Worktree, file: string, entry: Entry) {
    const location = path.join(worktree.root, file);
    yield* fs.remove(location, { force: true, recursive: true });
    yield* fs.makeDirectory(path.dirname(location), { recursive: true });
    const object = worktree.store.objects.get(entry.id);

    if (entry.mode === "160000") {
      yield* fs.makeDirectory(location);
    } else if (object?.type === "blob" && entry.mode === "120000") {
      yield* fs.symlink(new TextDecoder().decode(object.bytes), location);
    } else if (object?.type === "blob") {
      yield* fs.writeFile(location, object.bytes);
      yield* fs.chmod(location, entry.mode === "100755" ? 0o755 : 0o644);
    }
  });

  /** Moves a worktree from the tree it holds to `next`; `force` also discards changes on disk. */
  const switchTree = Effect.fnUntraced(function* (
    worktree: Worktree,
    next: ReadonlyMap<string, Entry>,
    force: boolean,
  ) {
    const current = flatten(worktree.store, readCommit(worktree.store, checkedOut(worktree))?.tree ?? "");

    for (const file of new Set([...worktree.index.keys(), ...current.keys()])) {
      if (!next.has(file) && (force || !sameEntry(current.get(file), next.get(file)))) {
        yield* remove(worktree.root, file);
        worktree.index.delete(file);
      }
    }

    for (const [file, entry] of next) {
      if (force || !sameEntry(current.get(file), entry)) {
        yield* restore(worktree, file, entry);
        worktree.index.set(file, entry);
      }
    }
  });

  const checkedOut = (worktree: Worktree) =>
    "ref" in worktree.head ? (worktree.store.refs.get(worktree.head.ref) ?? null) : worktree.head.commit;

  // Locations.
  const locate = Effect.fnUntraced(function* (cwd: string, env: Record<string, string | undefined>) {
    const objects = env.GIT_OBJECT_DIRECTORY;

    if (objects !== undefined) {
      const store = [...stores.values()].find((s) => path.join(s.directory, "objects") === objects);

      // A borrowed object store in a throwaway bare folder: no refs, no config of its own.
      return store === undefined
        ? null
        : { store, refs: new Map<string, string>(), config: new Map<string, string>(), worktree: null, head: null };
    }

    let location = yield* canonical(cwd);

    for (;;) {
      const worktree = worktrees.get(location);
      const store = stores.get(location);

      if (worktree !== undefined) {
        return {
          store: worktree.store,
          refs: worktree.store.refs,
          config: worktree.store.config,
          worktree,
          head: worktree.head,
        };
      }

      if (store !== undefined) {
        return { store, refs: store.refs, config: store.config, worktree: null, head: store.head };
      }

      if (path.dirname(location) === location) {
        return null;
      }

      location = path.dirname(location);
    }
  });

  /** The store a remote names: a path to a bare repository or to a clone's root. */
  const remoteStore = Effect.fnUntraced(function* (cwd: string, remote: string) {
    if (isUrl(remote)) {
      return null;
    }

    const location = yield* canonical(path.resolve(cwd, remote));

    return stores.get(location) ?? worktrees.get(location)?.store ?? null;
  });

  const remoteHead = (store: Store) =>
    store.bare ? store.head : ([...worktrees.values()].find((w) => w.store === store)?.head ?? store.head);

  /** A remote's configured address; a name with none is read as a path, as git reads it. */
  const resolveRemote = (place: Place | null, remote: string) => place?.config.get(`remote.${remote}.url`) ?? remote;

  // Commands. Each answers like git: an exit code, standard output and standard error.
  type Run = (
    args: ReadonlyArray<string>,
    cwd: string,
    env: Record<string, string | undefined>,
    here: Place | null,
  ) => Effect.Effect<Answer, PlatformError.PlatformError>;

  const flags = (args: ReadonlyArray<string>, known: ReadonlyArray<string>) => {
    const set = new Set<string>(),
      rest: Array<string> = [];

    for (const arg of args) {
      if (known.includes(arg)) {
        set.add(arg);
      } else {
        rest.push(arg);
      }
    }

    return { set, rest };
  };

  const unsupported = (args: ReadonlyArray<string>) =>
    Effect.die(new Error(`git memory: unsupported command: git ${args.join(" ")}`));

  const signature = (env: Record<string, string | undefined>, role: "AUTHOR" | "COMMITTER") =>
    `${env[`GIT_${role}_NAME`] ?? "fixture"} <${env[`GIT_${role}_EMAIL`] ?? "fixture@example.invalid"}> ${clock} +0000`;

  const commitNow = Effect.fnUntraced(function* (
    store: Store,
    tree: string,
    parents: ReadonlyArray<string>,
    message: string,
    env: Record<string, string | undefined>,
  ) {
    clock++;

    return yield* write(store, {
      type: "commit",
      tree,
      parents,
      author: signature(env, "AUTHOR"),
      committer: signature(env, "COMMITTER"),
      message: `${message}\n`,
    });
  });

  const advance = (worktree: Worktree, id: string) => {
    if ("ref" in worktree.head) {
      worktree.store.refs.set(worktree.head.ref, id);
    } else {
      worktree.head = { commit: id };
    }
  };

  const commands: Record<string, Run> = {
    init: Effect.fnUntraced(function* (args, cwd) {
      const { set, rest } = flags(args, ["--bare", "-q", "--quiet"]);
      const format = pipe(
        Option.fromNullishOr(rest.find((a) => pipe(a, Str.startsWith("--object-format=")))),
        Option.map(Str.slice(16)),
        Option.getOrElse(() => "sha1"),
      );
      const branch = pipe(
        Option.fromNullishOr(rest.find((a) => pipe(a, Str.startsWith("--initial-branch=")))),
        Option.map(Str.slice(17)),
        Option.getOrElse(() => "master"),
      );
      const target = rest.filter((a) => !pipe(a, Str.startsWith("--")));

      if (!set.has("--bare") || target.length !== 1 || (format !== "sha1" && format !== "sha256")) {
        return yield* unsupported(["init", ...args]);
      }

      yield* fs.makeDirectory(path.resolve(cwd, target[0] ?? ""), { recursive: true });
      const directory = yield* canonical(path.resolve(cwd, target[0] ?? ""));
      stores.set(directory, {
        directory,
        bare: true,
        format,
        objects: new Map(),
        refs: new Map(),
        config: new Map(),
        head: { ref: `refs/heads/${branch}` },
      });

      return answer(0, set.has("-q") ? "" : `Initialized empty Git repository in ${directory}/\n`);
    }),
    clone: Effect.fnUntraced(function* (args, cwd) {
      const { rest } = flags(args, ["-q", "--quiet"]);

      if (rest.length !== 2 || rest.some((a) => pipe(a, Str.startsWith("-")))) {
        return yield* unsupported(["clone", ...args]);
      }

      const [source = "", target = ""] = rest;
      const origin = yield* remoteStore(cwd, source);

      if (origin === null) {
        return fatal(`repository '${source}' does not exist`);
      }

      const root = path.resolve(cwd, target);

      if ((yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []))).length > 0) {
        return fatal(`destination path '${target}' already exists and is not an empty directory.`);
      }

      yield* fs.makeDirectory(path.join(root, ".git"), { recursive: true });
      const real = yield* canonical(root);
      const head = remoteHead(origin);
      const branch = "ref" in head ? head.ref : "refs/heads/master";

      const store: Store = {
        directory: path.join(real, ".git"),
        bare: false,
        format: origin.format,
        objects: new Map(),
        refs: new Map(),
        config: new Map([["remote.origin.url", isUrl(source) ? source : path.resolve(cwd, source)]]),
        head: { ref: branch },
      };

      for (const [ref, id] of origin.refs) {
        copy(origin, store, id);

        if (pipe(ref, Str.startsWith("refs/heads/"))) {
          store.refs.set(`refs/remotes/origin/${pipe(ref, Str.slice(11))}`, id);
        }
      }

      const tip = origin.refs.get(branch);

      if (tip !== undefined) {
        store.refs.set(branch, tip);
      }

      stores.set(store.directory, store);
      const worktree: Worktree = { root: real, store, head: { ref: branch }, index: new Map() };
      worktrees.set(real, worktree);
      yield* switchTree(worktree, flatten(store, readCommit(store, tip)?.tree ?? ""), true);

      return answer(
        0,
        "",
        `Cloning into '${target}'...\n${tip === undefined ? "warning: You appear to have cloned an empty repository.\n" : ""}`,
      );
    }),
    add: Effect.fnUntraced(function* (args, cwd, _env, here) {
      const { set, rest } = flags(args, ["-A", "--all", "-u", "--update"]);
      const worktree = here?.worktree;

      if (worktree === undefined || worktree === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      const under = Str.split(path.relative(worktree.root, yield* canonical(cwd)), path.sep).join("/");
      const inside = (file: string) => under === "" || file === under || pipe(file, Str.startsWith(`${under}/`));

      if (rest.length > 1 || (rest.length === 1 && rest[0] !== ".") || (rest.length === 0 && set.size === 0)) {
        return yield* unsupported(["add", ...args]);
      }

      if (set.has("-u") || set.has("--update")) {
        for (const file of [...worktree.index.keys()].filter(inside)) {
          const found = yield* onDisk(worktree, file);

          if (found === null) {
            worktree.index.delete(file);
          } else {
            const bytes =
              found.mode === "120000"
                ? encoder.encode(yield* fs.readLink(path.join(worktree.root, file)))
                : yield* fs.readFile(path.join(worktree.root, file));

            worktree.index.set(file, {
              mode: found.mode,
              id: yield* write(worktree.store, { type: "blob", bytes }),
            });
          }
        }

        return answer(0);
      }

      const scanned = new Map<string, Entry>();
      yield* scan(worktree.root, under, scanned, worktree.store);

      for (const file of [...worktree.index.keys()].filter(inside)) {
        worktree.index.delete(file);
      }

      for (const [file, entry] of scanned) {
        worktree.index.set(file, entry);
      }

      return answer(0);
    }),
    rm: Effect.fnUntraced(function* (args, cwd, _env, here) {
      const { set, rest } = flags(args, ["-q", "--quiet", "--cached"]);
      const worktree = here?.worktree;

      if (worktree === undefined || worktree === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      const under = Str.split(path.relative(worktree.root, yield* canonical(cwd)), path.sep).join("/");
      const files = rest.map((file) => (under === "" ? file : `${under}/${file}`));
      const missing = files.find((file) => !worktree.index.has(file));

      if (missing !== undefined) {
        return fatal(`pathspec '${missing}' did not match any files`);
      }

      const committed = flatten(worktree.store, readCommit(worktree.store, checkedOut(worktree))?.tree ?? "");

      // Git keeps a file whose staged or unstaged changes the removal would lose.
      for (const file of files) {
        const staged = !sameEntry(worktree.index.get(file), committed.get(file));
        // A file already gone from disk has nothing left to lose.
        const disk = yield* onDisk(worktree, file);
        const changed = disk !== null && !sameEntry(disk, worktree.index.get(file));

        if (set.has("--cached") ? staged && changed : staged || changed) {
          return answer(1, "", `error: the following file has local modifications:\n    ${file}\n`);
        }
      }

      for (const file of files) {
        worktree.index.delete(file);

        if (!set.has("--cached")) {
          yield* remove(worktree.root, file);
        }
      }

      return answer(0, set.has("-q") ? "" : files.map((file) => `rm '${file}'\n`).join(""));
    }),
    commit: Effect.fnUntraced(function* (args, _cwd, env, here) {
      const worktree = here?.worktree;
      const { set, rest } = flags(args, ["-q", "--quiet", "--allow-empty"]);

      if (worktree === undefined || worktree === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      if (rest.length !== 2 || rest[0] !== "-m") {
        return yield* unsupported(["commit", ...args]);
      }

      const parent = checkedOut(worktree);
      const tree = yield* build(worktree.store, worktree.index);
      const before = readCommit(worktree.store, parent)?.tree ?? (yield* build(worktree.store, new Map()));

      if (!set.has("--allow-empty") && tree === before) {
        return answer(1, "nothing to commit, working tree clean\n");
      }

      const id = yield* commitNow(worktree.store, tree, parent === null ? [] : [parent], rest[1] ?? "", env);
      advance(worktree, id);
      const name =
        "ref" in worktree.head ? pipe(worktree.head.ref, Str.replace(/^refs\/heads\//, "")) : "detached HEAD";
      return answer(0, set.has("-q") ? "" : `[${name} ${pipe(id, Str.slice(0, 7))}] ${rest[1] ?? ""}\n`);
    }),
    revert: Effect.fnUntraced(function* (args, _cwd, env, here) {
      const worktree = here?.worktree;
      const { rest } = flags(args, ["--no-edit", "-q", "--quiet"]);

      if (worktree === undefined || worktree === null || here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      if (rest.length !== 1) {
        return yield* unsupported(["revert", ...args]);
      }

      const target = revision(here, rest[0] ?? "");
      const commit = readCommit(worktree.store, target);

      if (target === null || commit === null) {
        return fatal(`bad revision '${rest[0]}'`);
      }

      // Only a revert of HEAD itself, whose result is its parent's tree.
      if (target !== checkedOut(worktree) || commit.parents.length > 1) {
        return yield* unsupported(["revert", ...args]);
      }

      const tree = readCommit(worktree.store, commit.parents[0])?.tree ?? (yield* build(worktree.store, new Map()));
      const subject = Str.split(commit.message, "\n")[0];
      const current = flatten(worktree.store, commit.tree);
      const next = flatten(worktree.store, tree);

      // Git refuses a revert over staged changes, or over a changed file the revert would rewrite.
      if ((yield* build(worktree.store, worktree.index)) !== commit.tree) {
        return fatal("revert failed: your local changes would be overwritten by revert.");
      }

      for (const file of new Set([...current.keys(), ...next.keys()])) {
        const disk = (yield* onDisk(worktree, file)) ?? undefined;

        // A change on disk that already matches the result loses nothing.
        if (
          !sameEntry(current.get(file), next.get(file)) &&
          !sameEntry(disk, current.get(file)) &&
          !sameEntry(disk, next.get(file))
        ) {
          return fatal("revert failed: your local changes would be overwritten by revert.");
        }
      }

      // A revert that changes nothing stops, as git's does.
      if (tree === commit.tree) {
        return answer(1, "nothing to commit, working tree clean\n");
      }

      yield* switchTree(worktree, next, false);

      const id = yield* commitNow(
        worktree.store,
        tree,
        [target],
        `Revert "${subject}"\n\nThis reverts commit ${target}.`,
        env,
      );

      advance(worktree, id);
      return answer(0, `[${pipe(id, Str.slice(0, 7))}] Revert "${subject}"\n`);
    }),
    checkout: Effect.fnUntraced(function* (args, _cwd, _env, here) {
      const worktree = here?.worktree;

      if (worktree === undefined || worktree === null || here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      const { set, rest } = flags(args, ["-q", "--quiet", "--force", "-f", "--detach"]);
      const force = set.has("--force") || set.has("-f");
      const create = rest[0] === "-b" || rest[0] === "-B" ? rest[0] : null;
      const name = create === null ? null : (rest[1] ?? null);
      const spelled = create === null ? rest[0] : rest[2];

      if ((create !== null && name === null) || rest.length > (create === null ? 1 : 3)) {
        return yield* unsupported(["checkout", ...args]);
      }

      const target = spelled === undefined ? checkedOut(worktree) : revision(here, spelled);

      // On an unborn HEAD, a new branch only renames what HEAD will name.
      if (target === null && create !== null && name !== null && spelled === undefined) {
        worktree.head = { ref: `refs/heads/${name}` };

        return answer(0);
      }

      if (target === null) {
        return fatal(`invalid reference: ${spelled ?? "HEAD"}`);
      }

      if (create === "-b" && worktree.store.refs.has(`refs/heads/${name}`)) {
        return fatal(`a branch named '${name}' already exists`);
      }

      if (!force) {
        // Refuse, as git does, when a file that would change on disk holds changes.
        const current = flatten(worktree.store, readCommit(worktree.store, checkedOut(worktree))?.tree ?? "");
        const next = flatten(worktree.store, readCommit(worktree.store, target)?.tree ?? "");

        for (const file of new Set([...current.keys(), ...next.keys()])) {
          const disk = (yield* onDisk(worktree, file)) ?? undefined;

          if (
            !sameEntry(current.get(file), next.get(file)) &&
            !sameEntry(disk, worktree.index.get(file)) &&
            !sameEntry(disk, next.get(file))
          ) {
            return answer(
              1,
              "",
              `error: Your local changes to the following files would be overwritten by checkout:\n\t${file}\n`,
            );
          }
        }
      }

      yield* switchTree(worktree, flatten(worktree.store, readCommit(worktree.store, target)?.tree ?? ""), force);

      if (create !== null && name !== null) {
        worktree.store.refs.set(`refs/heads/${name}`, target);
        worktree.head = { ref: `refs/heads/${name}` };
      } else if (!set.has("--detach") && spelled !== undefined && worktree.store.refs.has(`refs/heads/${spelled}`)) {
        worktree.head = { ref: `refs/heads/${spelled}` };
      } else if (spelled !== undefined || set.has("--detach")) {
        worktree.head = { commit: target };
      }

      return answer(0);
    }),
    worktree: Effect.fnUntraced(function* (args, cwd, _env, here) {
      const worktree = here?.worktree;
      const { set, rest } = flags(args, ["--detach", "-q", "--quiet"]);

      if (worktree === undefined || worktree === null || here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      if (rest[0] !== "add" || !set.has("--detach") || rest.length < 2 || rest.length > 3) {
        return yield* unsupported(["worktree", ...args]);
      }

      const target = revision(here, rest[2] ?? "HEAD");

      if (target === null) {
        return fatal(`invalid reference: ${rest[2] ?? "HEAD"}`);
      }

      const location = path.resolve(cwd, rest[1] ?? "");

      if ((yield* fs.readDirectory(location).pipe(Effect.orElseSucceed(() => []))).length > 0) {
        return fatal(`'${rest[1]}' already exists`);
      }

      yield* fs.makeDirectory(location, { recursive: true });
      const root = yield* canonical(location);
      const linked: Worktree = { root, store: worktree.store, head: { commit: target }, index: new Map() };
      worktrees.set(root, linked);
      yield* switchTree(linked, flatten(worktree.store, readCommit(worktree.store, target)?.tree ?? ""), true);
      return answer(0, "", `Preparing worktree (detached HEAD ${pipe(target, Str.slice(0, 7))})\n`);
    }),
    push: Effect.fnUntraced(function* (args, cwd, _env, here) {
      const { set, rest } = flags(args, ["-q", "--quiet", "--force", "-f"]);

      if (here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      if (rest.length !== 2 || rest.some((a) => pipe(a, Str.startsWith("-")) || pipe(a, Str.includes(":")))) {
        return yield* unsupported(["push", ...args]);
      }

      const [remote = "", branch = ""] = rest;
      const ref = pipe(branch, Str.startsWith("refs/")) ? branch : `refs/heads/${branch}`;
      const id = here.refs.get(ref);

      // Git reads the local refspec before it reaches the remote.
      if (id === undefined) {
        return answer(1, "", `error: src refspec ${branch} does not match any\n`);
      }

      const url = resolveRemote(here, remote);
      const target = yield* remoteStore(cwd, url);

      if (target === null) {
        return fatal(`'${remote}' does not appear to be a git repository`);
      }

      const old = target.refs.get(ref);

      if (old === id) {
        return answer(0, "", "Everything up-to-date\n");
      }

      copy(here.store, target, id);

      if (old !== undefined && !set.has("--force") && !set.has("-f") && !descends(target, old, id)) {
        return answer(1, "", ` ! [rejected]        ${branch} -> ${branch} (non-fast-forward)\n`);
      }

      target.refs.set(ref, id);

      if (url !== remote) {
        here.refs.set(`refs/remotes/${remote}/${pipe(ref, Str.slice(11))}`, id);
      }

      return answer(0, "", `To ${url}\n`);
    }),
    fetch: Effect.fnUntraced(function* (args, cwd, _env, here) {
      const { rest } = flags(args, [
        "--no-tags",
        "--no-recurse-submodules",
        "--no-write-fetch-head",
        "-q",
        "--quiet",
        "--",
      ]);

      if (here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      if (rest.length !== 2 || !pipe(rest[1] ?? "", Str.startsWith("refs/"))) {
        return yield* unsupported(["fetch", ...args]);
      }

      const [remote = "", ref = ""] = rest;
      const url = resolveRemote(here, remote);
      const source = yield* remoteStore(cwd, url);

      if (source === null) {
        return fatal(`'${remote}' does not appear to be a git repository`);
      }

      const id = source.refs.get(ref);

      if (id === undefined) {
        return fatal(`couldn't find remote ref ${ref}`);
      }

      copy(source, here.store, id);

      return answer(0, "", `From ${url}\n`);
    }),
    "ls-remote": Effect.fnUntraced(function* (args, cwd, _env, here) {
      const { set, rest } = flags(args, ["--get-url", "--symref", "--"]);

      if (set.has("--get-url") && rest.length === 1) {
        return answer(0, `${resolveRemote(here, rest[0] ?? "")}\n`);
      }

      if (!set.has("--symref") || rest.length !== 2 || rest[1] !== "HEAD") {
        return yield* unsupported(["ls-remote", ...args]);
      }

      const url = resolveRemote(here, rest[0] ?? "");
      const source = yield* remoteStore(cwd, url);

      if (source === null) {
        return fatal(`'${rest[0]}' does not appear to be a git repository`);
      }

      const head = remoteHead(source);
      const id = "ref" in head ? source.refs.get(head.ref) : head.commit;

      return answer(0, id === undefined ? "" : `${"ref" in head ? `ref: ${head.ref}\tHEAD\n` : ""}${id}\tHEAD\n`);
    }),
    "rev-parse": Effect.fnUntraced(function* (args, _cwd, _env, here) {
      if (here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      const { set, rest } = flags(args, ["--verify", "--path-format=absolute"]);
      const lines: Array<string> = [];

      for (const arg of rest) {
        if (arg === "--show-toplevel") {
          if (here.worktree === null) {
            return fatal("this operation must be run in a work tree");
          }

          lines.push(here.worktree.root);
        } else if (arg === "--git-common-dir" && set.has("--path-format=absolute")) {
          lines.push(here.store.directory);
        } else if (arg === "--show-object-format") {
          lines.push(here.store.format);
        } else if (pipe(arg, Str.startsWith("-"))) {
          return yield* unsupported(["rev-parse", ...args]);
        } else {
          const id = revision(here, arg);

          if (id === null) {
            return set.has("--verify")
              ? fatal("Needed a single revision")
              : answer(
                  128,
                  `${arg}\n`,
                  `fatal: ambiguous argument '${arg}': unknown revision or path not in the working tree.\n`,
                );
          }

          lines.push(id);
        }
      }

      return answer(0, lines.map((line) => `${line}\n`).join(""));
    }),
    config: Effect.fnUntraced(function* (args, _cwd, _env, here) {
      const { set, rest } = flags(args, ["--local", "--no-includes", "--get"]);

      if (here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      if (set.has("--get") && rest.length === 1) {
        const value = here.config.get(rest[0] ?? "");

        return value === undefined ? answer(1) : answer(0, `${value}\n`);
      }

      if (!set.has("--get") && rest.length === 2) {
        here.config.set(rest[0] ?? "", rest[1] ?? "");

        return answer(0);
      }

      return yield* unsupported(["config", ...args]);
    }),
    remote: Effect.fnUntraced(function* (args, _cwd, _env, here) {
      if (here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      const [verb, name = "", url] = args;
      const key = `remote.${name}.url`;

      if (!here.config.has(key) && (verb === "remove" || verb === "set-url")) {
        return answer(2, "", `error: No such remote: '${name}'\n`);
      }

      if (verb === "remove" && args.length === 2) {
        for (const known of [...here.config.keys()].filter((k) => pipe(k, Str.startsWith(`remote.${name}.`)))) {
          here.config.delete(known);
        }

        for (const ref of [...here.refs.keys()].filter((r) => pipe(r, Str.startsWith(`refs/remotes/${name}/`)))) {
          here.refs.delete(ref);
        }

        return answer(0);
      }

      if (verb === "set-url" && url !== undefined && args.length === 3) {
        here.config.set(key, url);

        return answer(0);
      }

      return yield* unsupported(["remote", ...args]);
    }),
    "ls-tree": Effect.fnUntraced(function* (args, _cwd, _env, here) {
      if (here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      const { set, rest } = flags(args, ["-z", "--"]);
      const [spelled = "", ...files] = rest;
      const id = revision(here, spelled);
      const object = id === null ? undefined : here.store.objects.get(id);
      const tree = object?.type === "commit" ? object.tree : object?.type === "tree" ? id : null;

      if (tree === null) {
        return fatal(`Not a valid object name ${spelled}`);
      }

      if (files.length > 1 || files.some((file) => pipe(file, Str.endsWith("/")) || file === "")) {
        return yield* unsupported(["ls-tree", ...args]);
      }

      const end = set.has("-z") ? "\0" : "\n";

      const listed =
        files.length === 0
          ? [...readTree(here.store, tree)].sort(treeOrder)
          : (() => {
              const entry = lookup(here.store, tree, files[0] ?? "");

              return entry === null ? [] : [[files[0] ?? "", entry] as const];
            })();

      return answer(
        0,
        listed.map(([file, entry]) => `${entry.mode} ${objectType(entry.mode)} ${entry.id}\t${file}${end}`).join(""),
      );
    }),
    "cat-file": Effect.fnUntraced(function* (args, _cwd, _env, here) {
      if (here === null) {
        return fatal(NOT_A_REPOSITORY);
      }

      if (args.length !== 2 || args[0] !== "blob") {
        return yield* unsupported(["cat-file", ...args]);
      }

      const object = here.store.objects.get(args[1] ?? "");

      return object?.type === "blob" ? answer(0, object.bytes) : fatal(`git cat-file ${args[1]}: bad file`);
    }),
  };

  const run = Effect.fnUntraced(function* (command: ChildProcess.StandardCommand) {
    const words = command.args.filter(Predicate.isString);

    const env = Object.fromEntries(
      Object.entries(command.options.env ?? {}).filter(
        (pair): pair is [string, string | undefined] => Predicate.isString(pair[1]) || pair[1] === undefined,
      ),
    );

    // Memory git reads no secret: a redacted word or variable stays unread, and the law that sent
    // one belongs on real git.
    if (
      words.length !== command.args.length ||
      Object.keys(env).length !== Object.keys(command.options.env ?? {}).length
    ) {
      return yield* Effect.die(new Error("git memory: unsupported command: a redacted argument or variable"));
    }

    const cwd = command.options.cwd ?? (yield* fs.realPath("."));
    // A missing working folder fails the spawn itself, as a real child process does.
    yield* fs.stat(cwd);
    let start = 0;

    while (start < words.length) {
      if (SAFE_GLOBALS.has(words[start] ?? "")) {
        start++;
      } else if (words[start] === "-c" && pipe(words[start + 1] ?? "", Str.includes("="))) {
        start += 2;
      } else {
        break;
      }
    }

    const [name = "", ...args] = words.slice(start);
    const handler = commands[name];

    if (handler === undefined) {
      return yield* unsupported(words);
    }

    return yield* handler(args, cwd, env, yield* locate(cwd, env));
  });

  return ChildProcessSpawner.make((command) => {
    if (command._tag !== "StandardCommand" || command.command !== "git") {
      return below.spawn(command);
    }

    return run(command).pipe(
      Effect.map((done) =>
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(pid++),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(done.code)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.make(done.stdout),
          stderr: Stream.make(encoder.encode(done.stderr)),
          all: Stream.make(done.stdout, encoder.encode(done.stderr)),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      ),
    );
  });
});

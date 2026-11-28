/**
 * The in-memory adapter of `Repository`: a store held as a plain value of commits, trees, blobs, refs and shallow commits.
 *
 * **Details**
 *
 * A commit's id and a tree's id are computed as git computes them, so the same commit with the same files has the same id here and in a real repository. The store holds only what git's format can hold: a message is a `string`, so a commit that is not UTF-8 cannot be put in memory, and a path is a `Path`, so one git refuses cannot be put in a tree.
 */
import { Context, Effect, Layer, Option, Predicate, Ref as Cell, Result, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as Commit from "./Commit.ts";
import { CommitId } from "./CommitId.ts";
import * as Diff from "./Diff.ts";
import { joined } from "./internal/bytes.ts";
import * as Lines from "./internal/lines.ts";
import * as Lookup from "./internal/lookup.ts";
import { byBytes, bytes, FOLDER, hashed, treeBytes, type Line } from "./internal/object.ts";
import * as Ref from "./Ref.ts";
import * as Remote from "./Remote.ts";
import * as Repository from "./Repository.ts";
import type * as Settings from "./Settings.ts";
import * as Tree from "./Tree.ts";

/**
 * A file to put in a tree: its kind and its bytes, kept exactly and never read as text.
 *
 * @category models
 */
export interface File {
  readonly mode: Tree.Mode;
  readonly content: Uint8Array;
}

/**
 * What a repository in memory holds.
 *
 * **Details**
 *
 * `trees` holds each root tree's files, flat by path: a folder's own tree is hashed and not kept. `blobs` holds each file's bytes by id, one blob for every file with the same bytes. `shallow` lists the commits whose parents this store lacks, as git's `shallow` file does.
 *
 * @category models
 */
export interface Store {
  readonly commits: ReadonlyMap<CommitId, Commit.Commit>;
  readonly trees: ReadonlyMap<Tree.TreeId, ReadonlyMap<Tree.Path, Tree.Entry>>;
  readonly blobs: ReadonlyMap<Tree.BlobId, Uint8Array>;
  readonly refs: ReadonlyMap<Ref.RefName, CommitId>;
  readonly shallow: ReadonlySet<CommitId>;
}

// The tree of no files, which git knows without any object written.
const EMPTY_TREE = Schema.decodeSync(Tree.TreeId)("4b825dc642cb6eb9a060e54bf8d69288fbee4904");

/**
 * A store with nothing in it but git's empty tree, so a commit with no files needs no `tree` call.
 *
 * @category constructors
 */
export const empty: Store = {
  commits: new Map(),
  trees: new Map([[EMPTY_TREE, new Map()]]),
  blobs: new Map(),
  refs: new Map(),
  shallow: new Set(),
};

/**
 * Builds a commit and computes its id as git does.
 *
 * **Details**
 *
 * The id is the sha-1 of `commit <size>`, a NUL byte and the object's bytes, whose first line names the tree.
 *
 * @category constructors
 */
export const commit = (
  fields: Pick<Commit.Commit, "tree" | "parents" | "author" | "committer" | "message">,
): Effect.Effect<Commit.Commit, never, Digest.Digest> =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest;
    const id = yield* digest.digestHex(Digest.sha1, hashed("commit", bytes(fields)));

    return new Commit.Commit({ ...fields, id: Schema.decodeSync(CommitId)(id) });
  });

/**
 * A store that git would refuse: a commit whose parent or tree is missing, a ref at a missing commit, a ref beside a ref below it, or a file beside a file below it.
 *
 * @category errors
 */
export class BadStore extends Schema.TaggedError<BadStore, { readonly brand: unique symbol }>()("BadStore", {
  reason: Schema.Literals(["missing-parent", "missing-commit", "ref-conflict", "missing-tree", "path-conflict"]),
}) {}

// A folder as it is built: each name holds a file's line or a folder, in a Map so a name like `__proto__` is a name.
interface Folder {
  readonly files: Map<string, Tree.Entry>;
  readonly folders: Map<string, Folder>;
}

const folderAt = (root: Folder, names: ReadonlyArray<string>): Folder => {
  let folder = root;

  for (const name of names) {
    const next = folder.folders.get(name) ?? { files: new Map(), folders: new Map() };
    folder.folders.set(name, next);
    folder = next;
  }

  return folder;
};

// A path that is a folder of another path, such as a file `a` beside a file `a/b` or `a/b/c`: git cannot hold both.
const hasFolderOfAnother = (paths: Iterable<string>): boolean => {
  const taken = new Set(paths);

  return [...taken].some((path) => {
    const names = path.split("/");

    return names.slice(0, -1).some((_, at) => taken.has(names.slice(0, at + 1).join("/")));
  });
};

// A tree's id: each folder below is hashed first, as its entry in the folder above needs its id.
const treeId = (folder: Folder): Effect.Effect<Tree.TreeId, never, Digest.Digest> =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest;
    const lines: Array<Line> = [...folder.files].map(([name, entry]) => ({ mode: entry.mode, name, id: entry.blob }));

    for (const [name, below] of folder.folders) {
      lines.push({ mode: FOLDER, name, id: yield* treeId(below) });
    }

    return Schema.decodeSync(Tree.TreeId)(yield* digest.digestHex(Digest.sha1, hashed("tree", treeBytes(lines))));
  });

// A tree's id from the entries it holds, with each folder hashed first. The one place the folders of a tree are built.
const entriesTree = (entries: ReadonlyMap<Tree.Path, Tree.Entry>): Effect.Effect<Tree.TreeId, never, Digest.Digest> => {
  const root: Folder = { files: new Map(), folders: new Map() };

  for (const [path, entry] of entries) {
    const names = path.split("/");
    folderAt(root, names.slice(0, -1)).files.set(names.at(-1) ?? path, entry);
  }

  return treeId(root);
};

/**
 * Puts files and their blobs in a store and gives the id of the tree they make, as git computes it.
 *
 * **Details**
 *
 * One blob is made for each content, so two paths with the same bytes share one. Each folder is a tree of its own, with its entries in git's order, a folder sorting as if its name ended in `/`. A `Map` goes in, never a plain object, so a path named `__proto__` is a path like any other. It fails `path-conflict` when one path is a folder of another, a file `a` beside a file `a/b`, and the store is then as it was. No files make git's empty tree.
 *
 * @category combinators
 */
export const tree = (
  store: Store,
  files: ReadonlyMap<Tree.Path, File>,
): Effect.Effect<{ readonly store: Store; readonly id: Tree.TreeId }, BadStore, Digest.Digest> =>
  Effect.gen(function* () {
    if (hasFolderOfAnother(files.keys())) {
      return yield* new BadStore({ reason: "path-conflict" });
    }

    const digest = yield* Digest.Digest;
    const entries = new Map<Tree.Path, Tree.Entry>();
    const blobs = new Map(store.blobs);

    for (const [path, file] of files) {
      const id = Schema.decodeSync(Tree.BlobId)(yield* digest.digestHex(Digest.sha1, hashed("blob", file.content)));

      entries.set(path, new Tree.Entry({ mode: file.mode, blob: id }));
      blobs.set(id, file.content.slice());
    }

    const id = yield* entriesTree(entries);

    return { store: { ...store, trees: new Map(store.trees).set(id, entries), blobs }, id };
  });

/**
 * Puts a commit in a store.
 *
 * **Details**
 *
 * Its parents are in the store, unless the commit is one of the store's shallow commits, and then its tree is in the store. The parents are checked first.
 *
 * @category combinators
 */
export const add = (store: Store, added: Commit.Commit): Result.Result<Store, BadStore> => {
  if (!added.parents.every((parent) => store.commits.has(parent)) && !store.shallow.has(added.id)) {
    return Result.fail(new BadStore({ reason: "missing-parent" }));
  }

  return store.trees.has(added.tree)
    ? Result.succeed({ ...store, commits: new Map(store.commits).set(added.id, added) })
    : Result.fail(new BadStore({ reason: "missing-tree" }));
};

// git refuses `refs/heads/a/b` beside `refs/heads/a`: a ref is a file, and a folder cannot be one too.
const isBeside = (a: string, b: string): boolean => a !== b && (a.startsWith(`${b}/`) || b.startsWith(`${a}/`));

/**
 * Points a ref at a commit of the store, making the ref or moving it.
 *
 * **Details**
 *
 * It follows git: the commit is in the store, and no ref in the store is a folder of this one or sits in its folder.
 *
 * @category combinators
 */
export const point = (store: Store, ref: Ref.RefName, id: CommitId): Result.Result<Store, BadStore> => {
  if (!store.commits.has(id)) {
    return Result.fail(new BadStore({ reason: "missing-commit" }));
  }

  if ([...store.refs.keys()].some((other) => isBeside(other, ref))) {
    return Result.fail(new BadStore({ reason: "ref-conflict" }));
  }

  return Result.succeed({ ...store, refs: new Map(store.refs).set(ref, id) });
};

/**
 * The remotes of a repository in memory: the names its config holds, each with a URL, and what each URL reaches, which is another store, read as it is at each fetch.
 *
 * @category models
 */
export interface Remotes {
  readonly names: ReadonlyMap<Remote.Name, Remote.Url>;
  readonly stores: ReadonlyMap<Remote.Url, Effect.Effect<Store>>;
}

const NO_REMOTES: Remotes = { names: new Map(), stores: new Map() };

/**
 * Service that holds the store of a memory repository, so a test can read it and move a ref between two reads.
 *
 * @category services
 */
export class MemoryStore extends Context.Service<
  MemoryStore,
  {
    readonly get: Effect.Effect<Store>;
    readonly set: (store: Store) => Effect.Effect<void>;
  }
>()("@kalfa/git/MemoryRepository.MemoryStore") {}

const found = (store: Store, id: CommitId): Result.Result<Commit.Commit, Repository.NoSuchCommit> => {
  const held = store.commits.get(id);

  return held === undefined ? Result.fail(new Repository.NoSuchCommit({ id })) : Result.succeed(held);
};

// Every commit the tips reach, themselves included.
const reach = (store: Store, tips: ReadonlyArray<CommitId>): Set<CommitId> => {
  const seen = new Set<CommitId>();
  const todo = [...tips];

  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    if (!seen.has(next)) {
      seen.add(next);
      todo.push(...(store.commits.get(next)?.parents ?? []));
    }
  }

  return seen;
};

// The commits of `wanted` with each one after its parents, walking from each tip in order and each commit's parents in order.
const parentsFirst = (store: Store, tips: ReadonlyArray<CommitId>, wanted: ReadonlySet<CommitId>): Array<CommitId> => {
  const order: Array<CommitId> = [];
  const seen = new Set<CommitId>();

  for (const tip of tips) {
    if (wanted.has(tip) && !seen.has(tip)) {
      seen.add(tip);
      const stack = [{ id: tip, next: 0 }];

      for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
        const parent = store.commits.get(frame.id)?.parents[frame.next++];

        if (parent === undefined) {
          order.push(frame.id);
          stack.pop();
        } else if (wanted.has(parent) && !seen.has(parent)) {
          seen.add(parent);
          stack.push({ id: parent, next: 0 });
        }
      }
    }
  }

  return order;
};

// A call that reads history knows its commits and a repository that is not shallow, in that order.
const history = (
  store: Store,
  ids: ReadonlyArray<CommitId>,
): Result.Result<void, Repository.NoSuchCommit | Repository.HistoryTooShort> =>
  Result.gen(function* () {
    for (const id of ids) {
      yield* found(store, id);
    }

    if (store.shallow.size > 0) {
      return yield* Result.fail(new Repository.HistoryTooShort());
    }
  });

const limit = (commits: number, most: number): Result.Result<void, Repository.TooMany> =>
  commits > most ? Result.fail(new Repository.TooMany({ limit: "commits", most })) : Result.succeed(undefined);

const readCommit = (
  store: Store,
  limits: Settings.Settings["limits"],
  id: CommitId,
): Result.Result<Commit.Commit, Repository.NoSuchCommit | Repository.TooLarge> =>
  Result.flatMap(found(store, id), (held) =>
    bytes(held).length > limits.bytes
      ? Result.fail(new Repository.TooLarge({ id, most: limits.bytes }))
      : Result.succeed(held),
  );

// The ref `under` and every ref below `under/`, sorted by UTF-8 bytes. A ref that only shares text with `under` is not one.
const refsAt = (store: Store, under: Ref.RefName): ReadonlyArray<Ref.Ref> =>
  [...store.refs]
    .filter(([name]) => name === under || name.startsWith(`${under}/`))
    .sort(([a], [b]) => byBytes(a, b))
    .map(([name, id]) => new Ref.Ref({ name, commit: id }));

const readRefs = (
  store: Store,
  limits: Settings.Settings["limits"],
  under: Ref.RefName,
): Result.Result<ReadonlyArray<Ref.Ref>, Repository.TooMany> => {
  const refs = refsAt(store, under);

  return refs.length > limits.refs
    ? Result.fail(new Repository.TooMany({ limit: "refs", most: limits.refs }))
    : Result.succeed(refs);
};

// The store with every commit the tips reach in `there` that it lacks, each with its tree's files and blobs.
const copied = (here: Store, there: Store, tips: ReadonlyArray<CommitId>): Store => {
  const commits = new Map(here.commits);
  const trees = new Map(here.trees);
  const blobs = new Map(here.blobs);

  for (const id of reach(there, tips)) {
    const commit = there.commits.get(id);

    if (commit === undefined || commits.has(id)) {
      continue;
    }

    commits.set(id, commit);
    const files = there.trees.get(commit.tree);

    if (files !== undefined && !trees.has(commit.tree)) {
      trees.set(commit.tree, files);

      for (const entry of files.values()) {
        const content = there.blobs.get(entry.blob);

        if (content !== undefined) {
          blobs.set(entry.blob, content);
        }
      }
    }
  }

  return { ...here, commits, trees, blobs };
};

const walk = (
  store: Store,
  limits: Settings.Settings["limits"],
  range: { readonly include: ReadonlyArray<CommitId>; readonly exclude: ReadonlyArray<CommitId> },
): Result.Result<
  ReadonlyArray<Commit.Commit>,
  Repository.NoSuchCommit | Repository.TooMany | Repository.TooLarge | Repository.HistoryTooShort
> =>
  Result.gen(function* () {
    yield* history(store, [...range.include, ...range.exclude]);
    const hidden = reach(store, range.exclude);
    const wanted = new Set([...reach(store, range.include)].filter((id) => !hidden.has(id)));
    yield* limit(wanted.size, limits.commits);
    const commits = parentsFirst(store, range.include, wanted).flatMap((id) => store.commits.get(id) ?? []);

    for (const held of commits) {
      if (bytes(held).length > limits.bytes) {
        return yield* Result.fail(new Repository.TooLarge({ id: held.id, most: limits.bytes }));
      }
    }

    return commits;
  });

// The best common ancestors: the commits both reach that no other commit both reach has among its ancestors.
const mergeBases = (
  store: Store,
  limits: Settings.Settings["limits"],
  a: CommitId,
  b: CommitId,
): Result.Result<ReadonlyArray<CommitId>, Repository.NoSuchCommit | Repository.TooMany | Repository.HistoryTooShort> =>
  Result.gen(function* () {
    yield* history(store, [a, b]);
    const fromA = reach(store, [a]);
    const common = [...reach(store, [b])].filter((id) => fromA.has(id));

    const covered = reach(
      store,
      common.flatMap((id) => store.commits.get(id)?.parents ?? []),
    );

    const bases = common.filter((id) => !covered.has(id)).sort();
    yield* limit(bases.length, limits.commits);

    return bases;
  });

const isAncestor = (
  store: Store,
  ancestor: CommitId,
  descendant: CommitId,
): Result.Result<boolean, Repository.NoSuchCommit | Repository.HistoryTooShort> =>
  Result.map(history(store, [ancestor, descendant]), () => reach(store, [descendant]).has(ancestor));

// A file changed between two trees: where it is, and what it was and is, with the bytes of each side. A file has at least one side.
type Changed =
  | { readonly path: Tree.Path; readonly before: Held; readonly after?: Held }
  | { readonly path: Tree.Path; readonly before?: undefined; readonly after: Held };

interface Held {
  readonly entry: Tree.Entry;
  readonly content: Uint8Array;
}

const NO_BYTES = new Uint8Array();

const filesAt = (store: Store, id: CommitId): ReadonlyMap<Tree.Path, Tree.Entry> =>
  store.trees.get(store.commits.get(id)?.tree ?? EMPTY_TREE) ?? new Map();

const held = (store: Store, entry: Tree.Entry | undefined): Held | undefined =>
  entry === undefined ? undefined : { entry, content: store.blobs.get(entry.blob) ?? NO_BYTES };

// The files that differ between two commits' trees, in path byte order: new, gone, or with another mode or other bytes.
const changed = (store: Store, from: CommitId, to: CommitId): ReadonlyArray<Changed> => {
  const before = filesAt(store, from);
  const after = filesAt(store, to);

  return [...new Set([...before.keys(), ...after.keys()])]
    .sort(byBytes)
    .filter((path) => {
      const was = before.get(path);
      const now = after.get(path);

      return was === undefined || now === undefined || was.mode !== now.mode || was.blob !== now.blob;
    })
    .flatMap((path): ReadonlyArray<Changed> => {
      const was = held(store, before.get(path));
      const now = held(store, after.get(path));

      if (was === undefined) {
        return now === undefined ? [] : [{ path, after: now }];
      }

      return [{ path, before: was, ...(now === undefined ? {} : { after: now }) }];
    });
};

const patchLimits = (
  files: ReadonlyArray<Changed>,
  limits: Settings.Settings["limits"],
): Result.Result<void, Repository.TooMany | Repository.DiffTooLarge> => {
  if (files.length > limits.files) {
    return Result.fail(new Repository.TooMany({ limit: "files", most: limits.files }));
  }

  const content = files.reduce(
    (total, file) => total + (file.before?.content.length ?? 0) + (file.after?.content.length ?? 0),
    0,
  );

  return content > limits.diff
    ? Result.fail(new Repository.DiffTooLarge({ most: limits.diff }))
    : Result.succeed(undefined);
};

const encoder = new TextEncoder();

// A field of what a patch id hashes: a letter for what it is, its length and its bytes, so no two changes write the same bytes.
const field = (kind: string, octets: Uint8Array): Uint8Array =>
  joined([encoder.encode(`${kind}${octets.length}:`), octets]);

const word = (kind: string, text: string): Uint8Array => field(kind, encoder.encode(text));

const isLink = (side: Held): boolean => side.entry.mode === "120000";

type Kind = "new" | "deleted" | "kind" | "modified";

const changeKind = ({ before, after }: Changed): Kind => {
  if (before === undefined) {
    return "new";
  }

  if (after === undefined) {
    return "deleted";
  }

  return isLink(before) === isLink(after) ? "modified" : "kind";
};

// A mode goes into the id where it is new, gone or changed, and not where it stays the same: a file that is executable on two
// bases and edited the same way has one id.
const modes = (file: Changed, kind: Kind): ReadonlyArray<Uint8Array> => {
  const sides = [file.before, file.after].flatMap((side) => (side === undefined ? [] : [side.entry.mode]));

  return kind === "modified" && sides[0] === sides[1] ? [] : sides.map((mode) => word("m", mode));
};

// What a commit's files hold at a path: an entry is a link or a file, and a path that is the start of another is a folder.
const kindAt =
  (files: ReadonlyMap<string, Tree.Entry>): Lookup.At =>
  (path) => {
    const entry = files.get(path);

    if (entry !== undefined) {
      return entry.mode === "120000" ? "link" : "file";
    }

    return [...files.keys()].some((name) => name.startsWith(`${path}/`)) ? "folder" : undefined;
  };

// The bytes of the file at a path, a copy the caller owns, or none. The checks in order: the commit, what the path holds, the size.
const readFile = (
  store: Store,
  limits: Settings.Settings["limits"],
  commit: CommitId,
  path: Tree.Path,
): Result.Result<Option.Option<Uint8Array>, Repository.NoSuchCommit | Repository.NotAFile | Repository.FileTooLarge> =>
  Result.gen(function* () {
    yield* found(store, commit);
    const files: ReadonlyMap<string, Tree.Entry> = filesAt(store, commit);
    yield* Lookup.find(path, kindAt(files));
    const entry = files.get(path);

    if (entry === undefined) {
      return Option.none();
    }

    const content = store.blobs.get(entry.blob) ?? NO_BYTES;

    if (content.length > limits.blob) {
      return yield* Result.fail(new Repository.FileTooLarge({ path, most: limits.blob }));
    }

    return Option.some(content.slice());
  });

// Whether a file's bytes are the same on both sides, so only its mode changed: no line is printed for it, binary or not. A file
// that changes kind is never the same, since git prints it as a deleted file and a new one.
const isModeOnly = (before: Held | undefined, after: Held | undefined, kind: Kind): boolean =>
  kind !== "kind" && before !== undefined && before.entry.blob === after?.entry.blob;

// What a changed file's bytes add to the id. A binary file counts by its blobs on both sides, as git names it. A text file
// counts by its removed and added lines, each with its own end, and where a line sits and the lines around it count for nothing.
// A file that changed kind has every old line removed and every new line added, as git prints it. A file with the same bytes on
// both sides and a new mode, but the same kind, adds nothing.
const edits = ({ before, after }: Changed, kind: Kind): ReadonlyArray<Uint8Array> => {
  const old = before?.content ?? NO_BYTES;
  const next = after?.content ?? NO_BYTES;

  if (isModeOnly(before, after, kind)) {
    return [];
  }

  if (Lines.isBinary(old) || Lines.isBinary(next)) {
    return [word("b", before?.entry.blob ?? "-"), word("b", after?.entry.blob ?? "-")];
  }

  if (kind === "kind") {
    return [...Lines.split(old).map((line) => field("-", line)), ...Lines.split(next).map((line) => field("+", line))];
  }

  return Lines.blocks(old, next).flatMap((block) => [
    ...block.removed.map((line) => field("-", line)),
    ...block.added.map((line) => field("+", line)),
  ]);
};

// One changed file as bytes to hash: what kind of change, its path, its modes, its edits.
const section = (file: Changed): ReadonlyArray<Uint8Array> => {
  const kind = changeKind(file);

  return [word("k", kind), word("p", file.path), ...modes(file, kind), ...edits(file, kind)];
};

// UTF-8 or nothing: a byte that is not valid is a failure, never a replacement character. A leading BOM is kept.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const decoded = (octets: Uint8Array): Result.Result<string, unknown> => Result.try(() => utf8.decode(octets));

// The lines of a changed text file as a diff holds them, or the first line that is not UTF-8. Removed lines come first in each
// block and count from 1 in the old file, added lines count from 1 in the new one. A file that changed kind has every old line
// removed and every new line added.
const lineChanges = (file: Changed, kind: Kind): Result.Result<ReadonlyArray<Diff.Line>, unknown> => {
  const old = file.before?.content ?? NO_BYTES;
  const next = file.after?.content ?? NO_BYTES;

  const blocks =
    kind === "kind"
      ? [{ removedAt: 0, removed: Lines.split(old), addedAt: 0, added: Lines.split(next) }]
      : Lines.blocks(old, next);

  return Result.all(
    blocks.flatMap((block) => [
      ...block.removed.map((line, at) =>
        Result.map(decoded(line), (text) => Diff.Removed.make({ at: block.removedAt + at + 1, text })),
      ),
      ...block.added.map((line, at) =>
        Result.map(decoded(line), (text) => Diff.Added.make({ at: block.addedAt + at + 1, text })),
      ),
    ]),
  );
};

// One changed file as a diff holds it, or `NotUtf8` naming it when a line of it is not text.
const fileChange = (file: Changed): Result.Result<Diff.FileChange, Repository.NotUtf8> => {
  const kind = changeKind(file);
  const { path, before, after } = file;

  const content: Result.Result<Diff.Content, Repository.NotUtf8> = isModeOnly(before, after, kind)
    ? Result.succeed(Diff.Text.make({ lines: [] }))
    : Lines.isBinary(before?.content ?? NO_BYTES) || Lines.isBinary(after?.content ?? NO_BYTES)
      ? Result.succeed(Diff.Binary.make({}))
      : Result.match(lineChanges(file, kind), {
          onFailure: () => Result.fail(new Repository.NotUtf8({ path })),
          onSuccess: (lines) => Result.succeed(Diff.Text.make({ lines })),
        });

  return Result.map(content, (read) => {
    if (before === undefined) {
      return Diff.New.make({ path, after: after.entry, content: read });
    }

    return after === undefined
      ? Diff.Deleted.make({ path, before: before.entry, content: read })
      : Diff.Modified.make({ path, before: before.entry, after: after.entry, content: read });
  });
};

// What a write to the store answers, and the store after it: a call that fails leaves the store as it was.
type Step<A, E> = readonly [Result.Result<A, E>, Store];

// A commit put in the store. Its tree is in the store, then each parent is, in order: the error names the first that is not.
const withCommit = (
  store: Store,
  made: Commit.Commit,
): Step<Commit.Commit, Repository.NoSuchTree | Repository.NoSuchCommit> => {
  if (!store.trees.has(made.tree)) {
    return [Result.fail(new Repository.NoSuchTree({ id: made.tree })), store];
  }

  const lacking = made.parents.find((parent) => !store.commits.has(parent));

  if (lacking !== undefined) {
    return [Result.fail(new Repository.NoSuchCommit({ id: lacking })), store];
  }

  return [Result.succeed(made), { ...store, commits: new Map(store.commits).set(made.id, made) }];
};

// A ref pointed at a commit of the store, checked as git's `update-ref` checks: the commit is in the store, the ref is at
// `from` now (none means it is not there), and no other ref is a folder of it or sits in its folder.
const withRef = (
  store: Store,
  move: { readonly ref: Ref.RefName; readonly from: Option.Option<CommitId>; readonly to: CommitId },
): Step<void, Repository.NoSuchCommit | Repository.RefMoved | Repository.RefInTheWay> => {
  if (!store.commits.has(move.to)) {
    return [Result.fail(new Repository.NoSuchCommit({ id: move.to })), store];
  }

  if (Option.getOrUndefined(move.from) !== store.refs.get(move.ref)) {
    return [Result.fail(new Repository.RefMoved({ ref: move.ref })), store];
  }

  const other = [...store.refs.keys()].filter((name) => isBeside(name, move.ref)).sort(byBytes)[0];

  if (other !== undefined) {
    return [Result.fail(new Repository.RefInTheWay({ ref: move.ref, other })), store];
  }

  return [Result.succeed(undefined), { ...store, refs: new Map(store.refs).set(move.ref, move.to) }];
};

// The files of a commit, by path.
const commitFiles = (
  store: Store,
  id: CommitId,
): Result.Result<ReadonlyMap<Tree.Path, Tree.Entry>, Repository.NoSuchCommit> =>
  Result.flatMap(found(store, id), (held) => {
    const files = store.trees.get(held.tree);

    // A commit whose files the store lacks is no commit a merge can read.
    return files === undefined ? Result.fail(new Repository.NoSuchCommit({ id })) : Result.succeed(files);
  });

const isSame = (a: Tree.Entry | undefined, b: Tree.Entry | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.mode === b.mode && a.blob === b.blob;

// What a path holds after a merge, by whole file: if ours and theirs are the same, that is the answer; if theirs is the
// merge base's, ours is; if ours is the merge base's, theirs is; else the path conflicts.
const settle = (
  base: Tree.Entry | undefined,
  ours: Tree.Entry | undefined,
  theirs: Tree.Entry | undefined,
): Tree.Entry | undefined | "conflict" => {
  if (isSame(ours, theirs) || isSame(theirs, base)) {
    return ours;
  }

  return isSame(ours, base) ? theirs : "conflict";
};

// The files of the merge of two commits over their merge base, or each path that cannot be combined. A merged path that
// is a folder of another merged path, a file `a` beside a file `a/b`, conflicts on both.
const merged = (
  store: Store,
  merge: { readonly mergeBase: CommitId; readonly ours: CommitId; readonly theirs: CommitId },
): Result.Result<ReadonlyMap<Tree.Path, Tree.Entry>, Repository.NoSuchCommit | Repository.Conflict> =>
  Result.gen(function* () {
    const base = yield* commitFiles(store, merge.mergeBase);
    const ours = yield* commitFiles(store, merge.ours);
    const theirs = yield* commitFiles(store, merge.theirs);
    const kept = new Map<Tree.Path, Tree.Entry>();
    const conflicts = new Set<Tree.Path>();

    for (const path of new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])) {
      const settled = settle(base.get(path), ours.get(path), theirs.get(path));

      if (settled === "conflict") {
        conflicts.add(path);
      } else if (settled !== undefined) {
        kept.set(path, settled);
      }
    }

    const keptByName = new Map<string, Tree.Path>();

    for (const path of kept.keys()) {
      keptByName.set(path, path);
    }

    for (const path of kept.keys()) {
      const names = path.split("/");

      for (let depth = 1; depth < names.length; depth++) {
        const folder = keptByName.get(names.slice(0, depth).join("/"));

        if (folder !== undefined) {
          conflicts.add(folder);
          conflicts.add(path);
        }
      }
    }

    const [first, ...rest] = [...conflicts].sort(byBytes);

    return first === undefined ? kept : yield* Result.fail(new Repository.Conflict({ paths: [first, ...rest] }));
  });

/**
 * Layer that provides `Repository` over a store held in memory, and `MemoryStore` to read it and move it.
 *
 * **Details**
 *
 * Each call reads the store as it is then. The calls answer as git does and fail as the shared laws say. A write is one step on the store, so two writes never interleave. A merge works file by file: a path changed on both sides to different things is a conflict, even where git would merge the lines. It needs a `Digest`, which gives a written commit its id. A fetch reads another store named by `remotes`, as it is at that fetch, and copies what this store lacks; it has no tags and no transport.
 *
 * @category layers
 */
export const layer = (
  store: Store,
  settings: Settings.Settings,
  remotes: Remotes = NO_REMOTES,
): Layer.Layer<Repository.Repository | MemoryStore, never, Digest.Digest> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const digest = yield* Digest.Digest;
      const cell = yield* Cell.make(store);
      const { limits } = settings;

      const read = <A, E>(call: (held: Store) => Result.Result<A, E>): Effect.Effect<A, E> =>
        Effect.flatMap(Cell.get(cell), (held) => Effect.fromResult(call(held)));

      const patchId = Effect.fnUntraced(function* (from: CommitId, to: CommitId) {
        const store = yield* Cell.get(cell);
        yield* Effect.fromResult(found(store, from));
        yield* Effect.fromResult(found(store, to));
        const files = changed(store, from, to);
        yield* Effect.fromResult(patchLimits(files, limits));

        if (files.length === 0) {
          return Option.none();
        }

        const hex = yield* digest.digestHex(Digest.sha1, joined(files.flatMap(section)));

        return Option.some(Schema.decodeSync(Diff.PatchId)(hex));
      });

      // The checks in order: both commits, the files limit, the size limit, and only then the lines, so a diff is never cut.
      const diff = Effect.fnUntraced(function* (from: CommitId, to: CommitId) {
        const store = yield* Cell.get(cell);
        yield* Effect.fromResult(found(store, from));
        yield* Effect.fromResult(found(store, to));
        const files = changed(store, from, to);
        yield* Effect.fromResult(patchLimits(files, limits));

        // The first file in path order whose lines are not UTF-8 names the failure.
        return yield* Effect.fromResult(Result.all(files.map(fileChange)));
      });

      // The checks in order, as the shared rule gives them: the commit, then each changed path, and only then is anything written.
      const editTree = Effect.fnUntraced(function* (base: CommitId, changes: Repository.Edit) {
        const store = yield* Cell.get(cell);
        yield* Effect.fromResult(found(store, base));
        yield* Effect.fromResult(Lookup.check(changes, kindAt(filesAt(store, base))));

        const files = new Map(filesAt(store, base));
        const blobs = new Map<Tree.BlobId, Uint8Array>();

        for (const [path, change] of changes) {
          if (change === "absent") {
            files.delete(path);
          } else {
            const blob = Schema.decodeSync(Tree.BlobId)(yield* digest.digestHex(Digest.sha1, hashed("blob", change)));
            files.set(path, new Tree.Entry({ mode: files.get(path)?.mode ?? "100644", blob }));
            blobs.set(blob, change.slice());
          }
        }

        const id = yield* entriesTree(files).pipe(Effect.provideService(Digest.Digest, digest));

        // The tree and its blobs join the store as it is now, so a write that came between is kept.
        yield* Cell.update(cell, (now) => ({
          ...now,
          trees: now.trees.has(id) ? now.trees : new Map(now.trees).set(id, files),
          blobs: new Map([...now.blobs, ...blobs]),
        }));

        return id;
      });

      // A name is looked up in the remotes this layer was given; a URL is answered as it is.
      const remoteUrl = Effect.fnUntraced(function* (remote: Remote.Remote) {
        if (Predicate.isTagged(remote, "Url")) {
          return remote.url;
        }

        const url = remotes.names.get(remote.name);

        return url === undefined ? yield* new Remote.NoSuchRemote({ remote: remote.name }) : url;
      });

      // The remote's store is read as it is now, and what this store lacks is copied into it as it is by then, so a write that came between is kept.
      const fetch = Effect.fnUntraced(function* (request: { readonly url: Remote.Url; readonly under: Ref.RefName }) {
        if ((yield* Cell.get(cell)).shallow.size > 0) {
          return yield* new Repository.HistoryTooShort();
        }

        const source = remotes.stores.get(request.url);

        if (source === undefined) {
          return yield* new Remote.FetchFailed({ url: request.url, code: 128, stderr: "no repository at that URL" });
        }

        const there = yield* source;
        const refs = refsAt(there, request.under);
        const tips = refs.map((ref) => ref.commit);

        if ([...reach(there, tips)].some((id) => there.shallow.has(id))) {
          return yield* new Repository.HistoryTooShort();
        }

        if (refs.length > limits.refs) {
          return yield* new Repository.TooMany({ limit: "refs", most: limits.refs });
        }

        // Only a good answer adds commits, as the process adapter renames its pack in only after one.
        yield* Cell.update(cell, (now) => copied(now, there, tips));

        return refs;
      });

      const write = <A, E>(call: (held: Store) => Step<A, E>): Effect.Effect<A, E> =>
        Effect.flatMap(Cell.modify(cell, call), Effect.fromResult);

      return Context.make(
        Repository.Repository,
        Repository.make(
          {
            readCommit: (id) => read((held) => readCommit(held, limits, id)),
            readRefs: (under) => read((held) => readRefs(held, limits, under)),
            walk: (range) => read((held) => walk(held, limits, range)),
            mergeBases: (a, b) => read((held) => mergeBases(held, limits, a, b)),
            isAncestor: (ancestor, descendant) => read((held) => isAncestor(held, ancestor, descendant)),
            patchId,
            readFile: (commit, path) => read((held) => readFile(held, limits, commit, path)),
            diff,
            editTree,
            writeCommit: (fields) =>
              commit(fields).pipe(
                Effect.provideService(Digest.Digest, digest),
                Effect.flatMap((made) => write((held) => withCommit(held, made))),
              ),
            moveRef: (move) => write((held) => withRef(held, move)),
            remoteUrl,
            fetch,
            mergeTrees: Effect.fnUntraced(function* (merge) {
              const held = yield* Cell.get(cell);
              const files = yield* Effect.fromResult(merged(held, merge));
              const id = yield* entriesTree(files).pipe(Effect.provideService(Digest.Digest, digest));

              // The merged tree joins the store as it is now, so a write that came between is kept.
              yield* Cell.update(cell, (now) =>
                now.trees.has(id) ? now : { ...now, trees: new Map(now.trees).set(id, files) },
              );

              return id;
            }),
          },
          settings,
        ),
      ).pipe(Context.add(MemoryStore, { get: Cell.get(cell), set: (next) => Cell.set(cell, next) }));
    }),
  );

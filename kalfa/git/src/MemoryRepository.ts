/**
 * The in-memory adapter of `Repository`: a store held as a plain value of commits, refs and shallow commits.
 *
 * **Details**
 *
 * A commit's id is computed as git computes it, so the same commit has the same id here and in a real repository. The store holds only what git's format can hold: a message is a `string`, so a commit that is not UTF-8 cannot be put in memory.
 */
import { Context, Effect, Layer, Ref as Cell, Result, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as Commit from "./Commit.ts";
import { CommitId } from "./CommitId.ts";
import { bytes, hashed } from "./internal/object.ts";
import * as Ref from "./Ref.ts";
import * as Repository from "./Repository.ts";
import type * as Settings from "./Settings.ts";

/**
 * What a repository in memory holds.
 *
 * **Details**
 *
 * `shallow` lists the commits whose parents this store lacks, as git's `shallow` file does.
 *
 * @category models
 */
export interface Store {
  readonly commits: ReadonlyMap<CommitId, Commit.Commit>;
  readonly refs: ReadonlyMap<Ref.RefName, CommitId>;
  readonly shallow: ReadonlySet<CommitId>;
}

/**
 * A store with nothing in it.
 *
 * @category constructors
 */
export const empty: Store = { commits: new Map(), refs: new Map(), shallow: new Set() };

/**
 * Builds a commit and computes its id as git does.
 *
 * **Details**
 *
 * The id is the sha-1 of `commit <size>`, a NUL byte and the object's bytes, with git's empty tree until trees come.
 *
 * @category constructors
 */
export const commit = (
  fields: Pick<Commit.Commit, "parents" | "author" | "committer" | "message">,
): Effect.Effect<Commit.Commit, never, Digest.Digest> =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest;
    const id = yield* digest.digestHex(Digest.sha1, hashed(bytes(fields)));

    return new Commit.Commit({ ...fields, id: Schema.decodeSync(CommitId)(id) });
  });

/**
 * A store that git would refuse: a commit whose parent is missing, a ref at a missing commit, or a ref beside a ref below it.
 *
 * @category errors
 */
export class BadStore extends Schema.TaggedError<BadStore, { readonly brand: unique symbol }>()("BadStore", {
  reason: Schema.Literals(["missing-parent", "missing-commit", "ref-conflict"]),
}) {}

/**
 * Puts a commit in a store.
 *
 * **Details**
 *
 * Its parents are in the store, unless the commit is one of the store's shallow commits.
 *
 * @category combinators
 */
export const add = (store: Store, added: Commit.Commit): Result.Result<Store, BadStore> =>
  added.parents.every((parent) => store.commits.has(parent)) || store.shallow.has(added.id)
    ? Result.succeed({ ...store, commits: new Map(store.commits).set(added.id, added) })
    : Result.fail(new BadStore({ reason: "missing-parent" }));

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

const encoder = new TextEncoder();

// git sorts refs by their UTF-8 bytes. JavaScript's `<` sorts by UTF-16 units, which differ past U+E000.
const byBytes = (a: string, b: string): number => {
  const x = encoder.encode(a);
  const y = encoder.encode(b);

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const delta = (x[i] ?? 0) - (y[i] ?? 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return x.length - y.length;
};

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

const readRefs = (
  store: Store,
  limits: Settings.Settings["limits"],
  under: Ref.RefName,
): Result.Result<ReadonlyArray<Ref.Ref>, Repository.TooMany> => {
  const refs = [...store.refs]
    .filter(([name]) => name === under || name.startsWith(`${under}/`))
    .sort(([a], [b]) => byBytes(a, b))
    .map(([name, id]) => new Ref.Ref({ name, commit: id }));

  return refs.length > limits.refs
    ? Result.fail(new Repository.TooMany({ limit: "refs", most: limits.refs }))
    : Result.succeed(refs);
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

/**
 * Layer that provides `Repository` over a store held in memory, and `MemoryStore` to read it and move it.
 *
 * **Details**
 *
 * Each call reads the store as it is then. The calls answer as git does and fail as the shared laws say.
 *
 * @category layers
 */
export const layer = (store: Store, settings: Settings.Settings): Layer.Layer<Repository.Repository | MemoryStore> =>
  Layer.effectContext(
    Effect.map(Cell.make(store), (cell) => {
      const { limits } = settings;

      const read = <A, E>(call: (held: Store) => Result.Result<A, E>): Effect.Effect<A, E> =>
        Effect.flatMap(Cell.get(cell), (held) => Effect.fromResult(call(held)));

      return Context.make(
        Repository.Repository,
        Repository.make(
          {
            readCommit: (id) => read((held) => readCommit(held, limits, id)),
            readRefs: (under) => read((held) => readRefs(held, limits, under)),
            walk: (range) => read((held) => walk(held, limits, range)),
            mergeBases: (a, b) => read((held) => mergeBases(held, limits, a, b)),
            isAncestor: (ancestor, descendant) => read((held) => isAncestor(held, ancestor, descendant)),
          },
          settings,
        ),
      ).pipe(Context.add(MemoryStore, { get: Cell.get(cell), set: (next) => Cell.set(cell, next) }));
    }),
  );

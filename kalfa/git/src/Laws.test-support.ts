// What the shared laws of Repository and the laws of the merge commit helper share: reading a drawn history's ids, trees
// and refs back, seeding a history for each shape, the failure a call must give, the clock a written commit reads, the spans
// a call ends, and what a merge case must answer. RepositoryTest.ts is `/test`, so these are not exported from there.
import { expect } from "@effect/vitest";
import { Effect, Result, Schema, Tracer } from "effect";
import { TestClock } from "effect/testing";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import {
  refQueries,
  refsModel,
  toPlain,
  type Committer,
  type FlatSignature,
  type History,
  type MergeCase,
  type Shape,
  type Texture,
} from "./History.test-support.ts";
import * as Ref from "./Ref.ts";
import * as Repository from "./Repository.ts";
import type { Seeded, Subject } from "./RepositoryTest.ts";
import type * as Settings from "./Settings.ts";
import type * as Tree from "./Tree.ts";

export const commitIdFrom = (text: string): CommitId.CommitId => Schema.decodeUnknownSync(CommitId.CommitId)(text);

export const refNameFrom = (text: string): Ref.RefName => Schema.decodeUnknownSync(Ref.RefName)(text);

export const idAt = (ids: ReadonlyArray<CommitId.CommitId>, index: number): CommitId.CommitId => {
  const id = ids[index];

  if (id === undefined) {
    throw new Error(`the seeder gave no id for commit ${index}`);
  }

  return id;
};

export const treeAt = (trees: ReadonlyArray<Tree.TreeId>, index: number): Tree.TreeId => {
  const tree = trees[index];

  if (tree === undefined) {
    throw new Error(`the seeder gave no tree for commit ${index}`);
  }

  return tree;
};

export const encodeCommit = (commit: Commit.Commit): typeof Commit.Commit.Encoded =>
  Schema.encodeSync(Commit.Commit)(commit);

export const plainRefs = (refs: ReadonlyArray<Ref.Ref>): ReadonlyArray<typeof Ref.Ref.Encoded> =>
  refs.map((ref) => ({ name: ref.name, commit: ref.commit }));

export const expectedRefs = (
  history: History,
  ids: ReadonlyArray<CommitId.CommitId>,
  under: string,
): ReadonlyArray<typeof Ref.Ref.Encoded> =>
  refsModel(history, under).map((ref) => ({ name: ref.name, commit: idAt(ids, ref.commit) }));

export const seedEach = <A, E>(
  subject: Subject,
  histories: ReadonlyArray<Shape>,
  config: Settings.Settings,
  check: (seeded: Seeded, shape: Shape) => Effect.Effect<A, E>,
): Effect.Effect<ReadonlyArray<A>, E> =>
  Effect.forEach(
    histories,
    (shape) => Effect.scoped(Effect.flatMap(subject.seed(shape.history, config), (seeded) => check(seeded, shape))),
    { concurrency: 1 },
  );

export const readRefsBack = (seeded: Seeded, history: History, label: string): Effect.Effect<void, unknown> =>
  Effect.forEach(
    refQueries(history),
    (under) =>
      Effect.map(seeded.repository.readRefs(refNameFrom(under)), (refs) => {
        expect(plainRefs(refs), `${label}: refs under ${under}`).toEqual(expectedRefs(history, seeded.ids, under));
      }),
    { concurrency: 1 },
  );

export const isTooShort = Schema.is(Repository.HistoryTooShort);

export const toSignature = (flat: FlatSignature): Commit.Signature =>
  new Commit.Signature({ name: flat.name, email: flat.email, at: { seconds: flat.seconds, offset: flat.offset } });

export const flatAt = (texture: Texture, k: number): FlatSignature => {
  const flat = texture.signatures[k % texture.signatures.length];

  if (flat === undefined) {
    throw new Error("the texture holds no signature");
  }

  return flat;
};

export const numAt = (texture: Texture, k: number): number => texture.nums[k % texture.nums.length] ?? 0;

/** The `k`th item of a list that is read round and round. */
export const cycle = <A>(items: ReadonlyArray<A>, k: number): A => {
  const item = items[k % items.length];

  if (item === undefined) {
    throw new Error("a drawn list holds nothing");
  }

  return item;
};

/** The clock at a whole second and a drawn part of the next, so a committer's second is the one below, never rounded up. */
export const clockAt = (seconds: number, texture: Texture, k: number): Effect.Effect<void> =>
  TestClock.setTime(seconds * 1000 + (numAt(texture, k) % 1000));

/** The failure of a call that must fail: an answer is a defect with the law's words. */
export const failed = <A, E>(effect: Effect.Effect<A, E>, place: string): Effect.Effect<E, never> =>
  Effect.flatMap(Effect.result(effect), (result) =>
    Result.isFailure(result)
      ? Effect.succeed(result.failure)
      : Effect.die(new Error(`${place}: the call answered, and it must fail`)),
  );

export interface Fields {
  readonly tree: Tree.TreeId;
  readonly parents: ReadonlyArray<CommitId.CommitId>;
  readonly author: FlatSignature;
  readonly message: string;
}

/** What a commit written at `seconds` must read back as, for the settings' committer: its fields, and the committer at +0000. */
export const expectedWrite = (
  id: CommitId.CommitId,
  fields: Fields,
  committer: Committer,
  seconds: number,
): typeof Commit.Commit.Encoded => ({
  id,
  tree: fields.tree,
  parents: fields.parents,
  author: toPlain(fields.author),
  committer: { name: committer.name, email: committer.email, at: { seconds, offset: "+0000" } },
  message: fields.message,
});

export const traced = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<{ answer: A; spans: Array<Tracer.NativeSpan> }, E> =>
  Effect.gen(function* () {
    const spans: Array<Tracer.NativeSpan> = [];

    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);

        return span;
      },
    });

    const answer = yield* effect.pipe(Effect.withTracer(tracer));

    return { answer, spans };
  });

/** The three commits of a merge case, as ids: `swapped` makes theirs the line the merge is made on. */
export const mergeArgs = (seeded: Seeded, merge: MergeCase, swapped: boolean) => ({
  mergeBase: idAt(seeded.ids, merge.base),
  ours: idAt(seeded.ids, swapped ? merge.theirs : merge.ours),
  theirs: idAt(seeded.ids, swapped ? merge.ours : merge.theirs),
});

/** The tree a clean merge case must give: the tree of the commit the carrier made for its files. */
export const mergedTree = (seeded: Seeded, merge: MergeCase): Tree.TreeId => {
  if (merge.tree === undefined) {
    throw new Error(`${merge.label}: the merge is no clean one`);
  }

  return treeAt(seeded.trees, merge.tree);
};

/** The paths a conflicting merge case must name. */
export const conflictPaths = (merge: MergeCase): ReadonlyArray<string> => {
  if (merge.expected.kind !== "conflict") {
    throw new Error(`${merge.label}: the merge is no conflict`);
  }

  return merge.expected.paths;
};

/** One span of the given name, ended, with the attributes, and none of the keys in `absent`; no git span holds a secret. */
export const expectNamedSpan = (
  place: string,
  spans: ReadonlyArray<Tracer.NativeSpan>,
  name: string,
  expected: Record<string, unknown>,
  absent: ReadonlyArray<string>,
  secrets: ReadonlyArray<string>,
): void => {
  const named = spans.filter((span) => span.name === name);
  expect(named.length, `${place}: one span named ${name}`).toBe(1);
  expect(named[0]?.status._tag, `${place}: the span ended`).toBe("Ended");
  const attributes = Object.fromEntries(named[0]?.attributes ?? []);
  expect(attributes, `${place}: the attributes`).toMatchObject(expected);

  for (const key of absent) {
    expect(Object.keys(attributes), `${place}: no ${key}`).not.toContain(key);
  }

  for (const span of spans.filter((each) => each.name.startsWith("git."))) {
    const text = JSON.stringify([...span.attributes.values()]);

    for (const secret of secrets) {
      expect(text.includes(secret), `${place}: no attribute of ${span.name} holds ${secret}`).toBe(false);
    }
  }
};

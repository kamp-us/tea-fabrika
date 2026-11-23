// The laws every adapter of `Repository` passes (S1 to S13), exported as `/test`. A runner gives a
// `Subject`: how to seed a history into its own kind of store. The suite draws a texture, makes one
// history for each shape class from it, seeds each, and compares every answer with the model in
// History.test-support.ts. A subject that passes these laws answers as every other one does.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Result, Schema, type Scope, Tracer } from "effect";
import { TestClock } from "effect/testing";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import {
  MESSAGE_CLASSES,
  SIGNATURE_CLASSES,
  asWritten,
  basesModel,
  committerAccepted,
  committerFrom,
  edgeMessages,
  messageVariants,
  MOVE,
  moveCarrier,
  NUL_CLASSES,
  nulMessages,
  signatureVariants,
  writeSpecs,
  WRITE_SHAPE_CLASSES,
  writtenSize,
  withCanary,
  CARRIER_CLASSES,
  carrier,
  isAncestorModel,
  lineOrder,
  missingId,
  objectSize,
  PAIR_KINDS,
  drawPairs,
  parentsFirst,
  RANGE_CLASSES,
  drawRanges,
  refsModel,
  CANARY,
  SHAPE_CLASSES,
  cutShallow,
  sameFiles,
  shapes,
  textureArb,
  toPlain,
  TREE_CARRIER_CLASSES,
  TREE_ID,
  treeCarrier,
  refQueries,
  walkModel,
  CRISS,
  type Committer,
  type FlatSignature,
  type History,
  type Shape,
  type Texture,
} from "./History.test-support.ts";
import * as Ref from "./Ref.ts";
import { COMMITTER, expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import * as Settings from "./Settings.ts";
import * as Tree from "./Tree.ts";

/** A seeded store: the service to ask, the id each history commit got, and what the laws may look at. */
export interface Seeded {
  readonly repository: Repository.Repository["Service"];
  /** The id of each commit of the history, by index. */
  readonly ids: ReadonlyArray<CommitId.CommitId>;
  /** The tree id of each commit of the history, by index, as the seeder's own store has it. */
  readonly trees: ReadonlyArray<Tree.TreeId>;
  /** Anything that changes when the store changes: a call must never change it (S10). */
  readonly fingerprint: Effect.Effect<unknown>;
  /** Text that must never appear in a span, such as the repository's path. */
  readonly hidden: ReadonlyArray<string>;
}

export interface Subject {
  readonly seed: (history: History, settings: Settings.Settings) => Effect.Effect<Seeded, never, Scope.Scope>;
}

export interface SuiteOptions {
  /** How many drawn textures each law checks. */
  readonly runs: number;
  /** The most one law may take, in milliseconds. */
  readonly timeout: number;
}

/** Settings with generous limits, the ones a law wants to push set, and the committer every written commit names. */
export const settings = (
  limits: { readonly commits?: number; readonly refs?: number; readonly bytes?: number } = {},
  committer: Committer = COMMITTER,
): Settings.Settings =>
  Schema.decodeUnknownSync(Settings.Settings)({
    limits: { commits: 1000, refs: 1000, bytes: 1_000_000, time: "10 seconds", ...limits },
    committer,
  });

const commitIdFrom = (text: string): CommitId.CommitId => Schema.decodeUnknownSync(CommitId.CommitId)(text);

const refNameFrom = (text: string): Ref.RefName => Schema.decodeUnknownSync(Ref.RefName)(text);

const idAt = (ids: ReadonlyArray<CommitId.CommitId>, index: number): CommitId.CommitId => {
  const id = ids[index];

  if (id === undefined) {
    throw new Error(`the seeder gave no id for commit ${index}`);
  }

  return id;
};

const nodeAt = (history: History, i: number): History["nodes"][number] => {
  const node = history.nodes[i];

  if (node === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return node;
};

const nonEmpty = <A>(items: ReadonlyArray<A>): readonly [A, ...Array<A>] => {
  const [first, ...rest] = items;

  if (first === undefined) {
    throw new Error("a range needs one include");
  }

  return [first, ...rest];
};

const treeAt = (trees: ReadonlyArray<Tree.TreeId>, index: number): Tree.TreeId => {
  const tree = trees[index];

  if (tree === undefined) {
    throw new Error(`the seeder gave no tree for commit ${index}`);
  }

  return tree;
};

const encodeCommit = (commit: Commit.Commit): typeof Commit.Commit.Encoded => Schema.encodeSync(Commit.Commit)(commit);

/** What `readCommit` of commit `i` must answer, as plain data. */
const expectedCommit = (
  history: History,
  ids: ReadonlyArray<CommitId.CommitId>,
  trees: ReadonlyArray<Tree.TreeId>,
  i: number,
): typeof Commit.Commit.Encoded => {
  const node = history.nodes[i];

  if (node === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return {
    id: idAt(ids, i),
    tree: treeAt(trees, i),
    parents: node.parents.map((parent) => idAt(ids, parent)),
    author: toPlain(node.author),
    committer: toPlain(node.committer),
    message: node.message,
  };
};

const plainRefs = (refs: ReadonlyArray<Ref.Ref>): ReadonlyArray<typeof Ref.Ref.Encoded> =>
  refs.map((ref) => ({ name: ref.name, commit: ref.commit }));

const expectedRefs = (
  history: History,
  ids: ReadonlyArray<CommitId.CommitId>,
  under: string,
): ReadonlyArray<typeof Ref.Ref.Encoded> =>
  refsModel(history, under).map((ref) => ({ name: ref.name, commit: idAt(ids, ref.commit) }));

const seedEach = <A, E>(
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

const sorted = (numbers: ReadonlyArray<number>): ReadonlyArray<number> => [...numbers].sort((a, b) => a - b);

const everyShape = (texture: Texture): ReadonlyArray<Shape> => {
  const all = shapes(texture);
  expect(
    all.map((shape) => shape.label),
    "the generator reaches every shape class",
  ).toEqual(SHAPE_CLASSES);

  return all;
};

const DEFAULT = settings();

/** The refusals S12 reaches in every run, one for each check a write passes before the store is touched. */
const REFUSAL_CLASSES = [
  ...NUL_CLASSES,
  "a tree the store lacks",
  "a commit's id given as the tree",
  "a parent the store lacks",
  "a tree's id given as a parent",
  "a parent the store lacks, second of two",
  "a parent the store lacks, first of two",
];

/** What S13 reaches in every run: the moves that succeed, then the moves refused. */
const MOVE_CLASSES = [
  "making a candidate ref",
  "making a remote ref",
  "moving a branch forward",
  "moving a branch back to an older commit",
  "moving a branch to the commit it is at",
  "from none while the ref exists",
  "from a commit while the ref is at another",
  "from a commit while the ref is gone",
  "making a ref inside a ref's name",
  "making a ref above a ref",
  "to a commit the store lacks",
  "to a tree's id",
];

// ---------------------------------------------------------------------------------------------------------
// The checks a few laws share
// ---------------------------------------------------------------------------------------------------------

const readBack = (seeded: Seeded, history: History, label: string): Effect.Effect<void, unknown> =>
  Effect.forEach(
    history.nodes,
    (_, i) =>
      Effect.map(seeded.repository.readCommit(idAt(seeded.ids, i)), (commit) => {
        expect(encodeCommit(commit), `${label}: commit ${i}`).toEqual(
          expectedCommit(history, seeded.ids, seeded.trees, i),
        );
      }),
    { concurrency: 1 },
  );

const readRefsBack = (seeded: Seeded, history: History, label: string): Effect.Effect<void, unknown> =>
  Effect.forEach(
    refQueries(history),
    (under) =>
      Effect.map(seeded.repository.readRefs(refNameFrom(under)), (refs) => {
        expect(plainRefs(refs), `${label}: refs under ${under}`).toEqual(expectedRefs(history, seeded.ids, under));
      }),
    { concurrency: 1 },
  );

const isMissing = Schema.is(Repository.NoSuchCommit);

const isTooShort = Schema.is(Repository.HistoryTooShort);

const failure = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<E, never> => Effect.flip(effect).pipe(Effect.orDie);

// ---------------------------------------------------------------------------------------------------------
// The checks the write laws share
// ---------------------------------------------------------------------------------------------------------

const treeIdFrom = (text: string): Tree.TreeId => Schema.decodeUnknownSync(Tree.TreeId)(text);

const toSignature = (flat: FlatSignature): Commit.Signature =>
  new Commit.Signature({ name: flat.name, email: flat.email, at: { seconds: flat.seconds, offset: flat.offset } });

const flatAt = (texture: Texture, k: number): FlatSignature => {
  const flat = texture.signatures[k % texture.signatures.length];

  if (flat === undefined) {
    throw new Error("the texture holds no signature");
  }

  return flat;
};

const numAt = (texture: Texture, k: number): number => texture.nums[k % texture.nums.length] ?? 0;

/** The clock at a whole second and a drawn part of the next, so a committer's second is the one below, never rounded up. */
const clockAt = (seconds: number, texture: Texture, k: number): Effect.Effect<void> =>
  TestClock.setTime(seconds * 1000 + (numAt(texture, k) % 1000));

/** The failure of a call that must fail: an answer is a defect with the law's words. */
const failed = <A, E>(effect: Effect.Effect<A, E>, place: string): Effect.Effect<E, never> =>
  Effect.flatMap(Effect.result(effect), (result) =>
    Result.isFailure(result)
      ? Effect.succeed(result.failure)
      : Effect.die(new Error(`${place}: the call answered, and it must fail`)),
  );

interface Fields {
  readonly tree: Tree.TreeId;
  readonly parents: ReadonlyArray<CommitId.CommitId>;
  readonly author: FlatSignature;
  readonly message: string;
}

const writeCall = (repo: Repository.Repository["Service"], fields: Fields) =>
  repo.writeCommit({
    tree: fields.tree,
    parents: fields.parents,
    author: toSignature(fields.author),
    message: fields.message,
  });

/** What a commit written at `seconds` must read back as, for the settings' committer: its fields, and the committer at +0000. */
const expectedWrite = (
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

/** Writes a commit and reads it back: the answer and the read both hold the fields and the committer of the settings. */
const writeAndRead = (
  repo: Repository.Repository["Service"],
  fields: Fields,
  committer: Committer,
  seconds: number,
  place: string,
) =>
  Effect.gen(function* () {
    const commit = yield* writeCall(repo, fields);
    const expected = expectedWrite(commit.id, fields, committer, seconds);
    expect(encodeCommit(commit), `${place}: what was written`).toEqual(expected);
    expect(encodeCommit(yield* repo.readCommit(commit.id)), `${place}: read back`).toEqual(expected);

    return commit;
  });

/** A write that fails with `kind` holding `held`, and leaves the store as it was. */
const refusedWrite = (
  seeded: Seeded,
  fields: Fields,
  kind: abstract new (...args: never[]) => object,
  held: object,
  place: string,
) =>
  Effect.gen(function* () {
    const before = yield* seeded.fingerprint;
    expectFailure(yield* failed(writeCall(seeded.repository, fields), place), kind, held, place);
    expect(yield* seeded.fingerprint, `${place}: nothing was written`).toEqual(before);
  });

/** Every ref the model holds, asked for in every way a caller asks: each ref, each folder, and the places a wrong move would leave one. */
const readModelBack = (
  seeded: Seeded,
  history: History,
  model: ReadonlyMap<string, number>,
  extra: ReadonlyArray<string>,
  place: string,
): Effect.Effect<void, unknown> => {
  const now: History = { ...history, refs: [...model].map(([name, commit]) => ({ name, commit })) };

  return Effect.forEach(
    [...new Set([...refQueries(now), ...extra])],
    (under) =>
      Effect.map(seeded.repository.readRefs(refNameFrom(under)), (refs) => {
        expect(plainRefs(refs), `${place}: refs under ${under}`).toEqual(expectedRefs(now, seeded.ids, under));
      }),
    { concurrency: 1 },
  );
};

const traced = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<{ answer: A; spans: Array<Tracer.NativeSpan> }, E> =>
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

/** One span named `git.<call>`, ended, with the attributes, none of them a bare key and none holding a secret. */
const expectSpan = (
  place: string,
  spans: ReadonlyArray<Tracer.NativeSpan>,
  call: string,
  expected: Record<string, unknown>,
  secrets: ReadonlyArray<string>,
): Record<string, unknown> => {
  const gits = spans.filter((span) => span.name.startsWith("git."));
  expect(
    gits.map((span) => span.name),
    `${place}: one span`,
  ).toEqual([`git.${call}`]);
  const span = gits[0];
  expect(span?.status._tag, `${place}: the span ended`).toBe("Ended");
  const attributes = Object.fromEntries(span?.attributes ?? []);
  expect(attributes, `${place}: the attributes`).toMatchObject(expected);

  for (const key of Object.keys(attributes)) {
    expect(["id", "ref", "count"], `${place}: the key ${key} is not bare`).not.toContain(key);
  }

  const text = JSON.stringify(Object.values(attributes));

  for (const secret of secrets) {
    expect(text.includes(secret), `${place}: no attribute holds ${secret}`).toBe(false);
  }

  return attributes;
};

// ---------------------------------------------------------------------------------------------------------
// The laws
// ---------------------------------------------------------------------------------------------------------

export const suite = (name: string, subject: Subject, options: SuiteOptions): void => {
  const run = { arbitrary: { runs: options.runs, seed: 119120 }, timeout: options.timeout };

  describe(`${name}: the shared laws of Repository`, () => {
    // Plant: each of G4's plants (trim the message, store the offset as a number, refuse an empty name or a
    // space at either end of a name) turns this red too; and in `/process`, take the name up to the last
    // space before `<`: a name with a trailing space comes back short. Trees: `commit` leaves `tree` out of the
    // value it returns, so it reads back as the empty tree; in the parser, read the tree from the second header line.
    it.effect.prop(
      "S1 read back: readCommit gives its tree, parents in order, author, committer and message byte for byte",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const made = carrier(texture);
          expect(made.classes, "the generator reaches every message and signature class").toEqual(CARRIER_CLASSES);
          const trees = treeCarrier(texture);
          expect(trees.classes, "the generator reaches every tree class").toEqual(TREE_CARRIER_CLASSES);

          const histories: ReadonlyArray<Shape> = [
            ...everyShape(texture),
            { label: "carrier", history: made.history },
            { label: "tree carrier", history: trees.history },
          ];

          yield* seedEach(subject, histories, DEFAULT, (seeded, shape) => readBack(seeded, shape.history, shape.label));
        }),
      run,
    );

    // Plant: answer `false` or `[]` for an unknown id in `isAncestor`; drop unknown excludes in `walk`; in `/process`'s
    // `known`, accept an object of any type, so a seeded commit's own tree id is read as a commit.
    it.effect.prop(
      "S2 unknown and wrong-type ids fail with NoSuchCommit naming one of them, never [] or false",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.gen(function* () {
            const taken = seeded.ids;
            const first = commitIdFrom(missingId(texture, 0, taken));
            const second = commitIdFrom(missingId(texture, 1, [...taken, first]));
            const tree = commitIdFrom(TREE_ID);
            const known = seeded.ids[0] ?? second;
            // A real tree with files, which the repository holds as an object, and which is no commit.
            const real = seeded.trees.find((id) => id !== TREE_ID);

            if (shape.history.nodes.length > 0) {
              expect(real, `${shape.label}: a seeded history has a tree with files`).toBeDefined();
            }

            const missing = [first, second, tree, ...(real === undefined ? [] : [commitIdFrom(real)])];
            const repo = seeded.repository;
            const gone = seeded.ids.length === 0 ? missing : undefined;

            for (const absent of missing) {
              const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
                repo.readCommit(absent),
                repo.walk({ include: [absent], exclude: [] }),
                repo.walk({ include: [known], exclude: [absent] }),
                repo.mergeBases(absent, known),
                repo.mergeBases(known, absent),
                repo.isAncestor(absent, known),
                repo.isAncestor(known, absent),
              ];

              for (const [k, call] of calls.entries()) {
                const error = yield* failure(call);
                expect(isMissing(error), `${shape.label}: call ${k} on ${absent} fails with NoSuchCommit`).toBe(true);

                if (isMissing(error)) {
                  expect(gone ?? [absent], `${shape.label}: call ${k} names an id it was asked for`).toContain(
                    error.id,
                  );
                }
              }
            }
          }),
        ),
      run,
    );

    // Plant: sort with JavaScript's `<` (U+E000 to U+FFFF against the astral class); match by text
    // prefix, so `refs/heads/main-2` comes in under `refs/heads/main`.
    it.effect.prop(
      "S3 refs: readRefs answers the ref and every ref below it, sorted by UTF-8 bytes",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.gen(function* () {
            yield* readRefsBack(seeded, shape.history, shape.label);

            if (shape.history.nodes.length > 0) {
              const heads = yield* seeded.repository.readRefs(refNameFrom("refs/heads"));
              const names: ReadonlyArray<string> = heads.map((ref) => ref.name);

              const positions = ["refs/heads/z-\u8BBE", "refs/heads/z-\uFF5A", "refs/heads/z-\u{1F600}"].map((n) =>
                names.indexOf(n),
              );

              expect(positions, `${shape.label}: the three trap refs are there`).not.toContain(-1);
              expect(positions, `${shape.label}: byte order puts U+8BBE, then U+FF5A, then U+1F600`).toEqual(
                [...positions].sort((x, y) => x - y),
              );
              const main = yield* seeded.repository.readRefs(refNameFrom("refs/heads/main"));
              expect(
                main.map((ref) => ref.name),
                `${shape.label}: a ref that only shares text is not below it`,
              ).toEqual(["refs/heads/main"]);
            }
          }),
        ),
      run,
    );

    // Plant: answer newest first; leave out the include commits themselves; stop at the first merge.
    it.effect.prop(
      "S4 walk: the set is what include reaches and exclude does not, parents first, each entry is readCommit's",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const reached = new Set<string>();
          yield* seedEach(
            subject,
            everyShape(texture).filter((s) => s.history.nodes.length > 0),
            DEFAULT,
            (seeded, shape) =>
              Effect.forEach(
                [0, 1],
                (k) =>
                  Effect.forEach(
                    drawRanges(shape.history, texture, k),
                    (range) =>
                      Effect.gen(function* () {
                        reached.add(range.label);
                        const place = `${shape.label}, ${range.label}`;

                        const answer = yield* seeded.repository.walk({
                          include: nonEmpty(range.include.map((i) => idAt(seeded.ids, i))),
                          exclude: range.exclude.map((i) => idAt(seeded.ids, i)),
                        });

                        const got = answer.map((commit) => seeded.ids.indexOf(commit.id));
                        const model = walkModel(shape.history, range.include, range.exclude);
                        expect(sorted(got), `${place}: the set`).toEqual(model);
                        expect(parentsFirst(shape.history, got), `${place}: each commit comes after its parents`).toBe(
                          true,
                        );
                        const line = lineOrder(shape.history, model);

                        if (line !== undefined) {
                          expect(got, `${place}: a line of commits has one order`).toEqual(line);
                        }

                        if (range.label === "include equal to exclude") {
                          expect(answer, `${place}: nothing is left`).toEqual([]);
                        }

                        for (const commit of answer) {
                          const again = yield* seeded.repository.readCommit(commit.id);
                          expect(encodeCommit(commit), `${place}: ${commit.id} as readCommit gives it`).toEqual(
                            encodeCommit(again),
                          );
                        }
                      }),
                    { concurrency: 1 },
                  ),
                { concurrency: 1 },
              ),
          );
          expect([...reached].sort(), "the generator reaches every range class").toEqual([...RANGE_CLASSES].sort());
        }),
      run,
    );

    // Plant: answer every common ancestor, not only the best; keep only one of a criss-cross's two.
    it.effect.prop(
      "S5 merge bases: the best common ancestors sorted by id, the same both ways round",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const kinds = new Set<string>();
          yield* seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
            Effect.forEach(
              [0, 1],
              (k) =>
                Effect.forEach(
                  drawPairs(shape, texture, k),
                  ({ kind, a, b }) =>
                    Effect.gen(function* () {
                      kinds.add(kind);
                      const place = `${shape.label}, ${kind} pair ${a} ${b}`;

                      const expected = basesModel(shape.history, a, b)
                        .map((i) => idAt(seeded.ids, i))
                        .sort();

                      const forward = yield* seeded.repository.mergeBases(idAt(seeded.ids, a), idAt(seeded.ids, b));
                      const backward = yield* seeded.repository.mergeBases(idAt(seeded.ids, b), idAt(seeded.ids, a));
                      expect(forward, `${place}: the model`).toEqual(expected);
                      expect(backward, `${place}: the other way round`).toEqual(expected);

                      if (kind === "unrelated") {
                        expect(forward, `${place}: no common history`).toEqual([]);
                      }

                      if (kind === "ancestor") {
                        expect(forward, `${place}: an ancestor is its own best base`).toEqual([idAt(seeded.ids, a)]);
                      }

                      if (kind === "criss-cross") {
                        expect(forward, `${place}: both bases`).toEqual(
                          [CRISS.left, CRISS.right].map((i) => idAt(seeded.ids, i)).sort(),
                        );
                      }
                    }),
                  { concurrency: 1 },
                ),
              { concurrency: 1 },
            ),
          );
          expect([...kinds].sort(), "the generator reaches every pair class").toEqual([...PAIR_KINDS].sort());
        }),
      run,
    );

    // Plant: answer false for `x, x`.
    it.effect.prop(
      "S6 ancestors: isAncestor is the model's reachability, a commit is its own ancestor",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.forEach(
            [0, 1],
            (k) =>
              Effect.forEach(
                drawPairs(shape, texture, k),
                ({ kind, a, b }) =>
                  Effect.gen(function* () {
                    const place = `${shape.label}, ${kind} pair ${a} ${b}`;
                    const forward = yield* seeded.repository.isAncestor(idAt(seeded.ids, a), idAt(seeded.ids, b));
                    const backward = yield* seeded.repository.isAncestor(idAt(seeded.ids, b), idAt(seeded.ids, a));
                    expect(forward, `${place}: the model`).toBe(isAncestorModel(shape.history, a, b));
                    expect(backward, `${place}: the other way round`).toBe(isAncestorModel(shape.history, b, a));

                    if (a !== b) {
                      expect(
                        forward && backward,
                        `${place}: two different commits are never each other's ancestor`,
                      ).toBe(false);
                    } else {
                      expect(forward, `${place}: a commit is its own ancestor`).toBe(true);
                    }

                    if (kind === "unrelated") {
                      expect(forward, `${place}: unrelated commits`).toBe(false);
                    }
                  }),
                { concurrency: 1 },
              ),
            { concurrency: 1 },
          ),
        ),
      run,
    );

    // Plant: answer the first `commits` items; count `>=` for `>`, so the exact-size answer fails.
    it.effect.prop(
      "S7 limits never cut: at the answer's exact size it answers, at one less it fails with TooMany or TooLarge",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const all = everyShape(texture);
          const line = all.find((shape) => shape.label === "a line");
          const criss = all.find((shape) => shape.label === "a criss-cross");

          if (line === undefined || criss === undefined) {
            return yield* Effect.die("the generator made no line or criss-cross");
          }

          const history = line.history;
          const last = history.nodes.length - 1;
          const first = yield* Effect.scoped(Effect.map(subject.seed(history, DEFAULT), (seeded) => seeded.ids));

          const objectBytes = (i: number): number =>
            objectSize(
              nodeAt(history, i),
              nodeAt(history, i).parents.map((p) => idAt(first, p)),
            );

          const biggest = Math.max(...history.nodes.map((_, i) => objectBytes(i)));
          const target = texture.nums[0] ?? 0;
          const one = target % history.nodes.length;
          const include = nonEmpty([idAt(first, last)]);

          // bytes: readCommit and walk
          for (const [limit, fails] of [
            [objectBytes(one), false],
            [objectBytes(one) - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ bytes: limit }));
                const read = seeded.repository.readCommit(idAt(seeded.ids, one));

                if (fails) {
                  expectFailure(
                    yield* failure(read),
                    Repository.TooLarge,
                    { id: idAt(seeded.ids, one), most: limit },
                    `readCommit at ${limit} bytes`,
                  );
                } else {
                  expect((yield* read).id, `readCommit at ${limit} bytes answers`).toBe(idAt(seeded.ids, one));
                }
              }),
            );
          }

          for (const [limit, fails] of [
            [biggest, false],
            [biggest - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ bytes: limit }));
                const walk = seeded.repository.walk({ include, exclude: [] });

                if (fails) {
                  expectFailure(yield* failure(walk), Repository.TooLarge, { most: limit }, `walk at ${limit} bytes`);
                } else {
                  expect((yield* walk).length, `walk at ${limit} bytes answers`).toBe(history.nodes.length);
                }
              }),
            );
          }

          // commits: walk
          for (const [limit, fails] of [
            [history.nodes.length, false],
            [history.nodes.length - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ commits: limit }));
                const walk = seeded.repository.walk({ include, exclude: [] });

                if (fails) {
                  expectFailure(
                    yield* failure(walk),
                    Repository.TooMany,
                    { limit: "commits", most: limit },
                    `walk of ${history.nodes.length} at ${limit}`,
                  );
                } else {
                  expect((yield* walk).length, `walk at ${limit} answers`).toBe(history.nodes.length);
                }
              }),
            );
          }

          // commits: merge bases of a criss-cross, which has two
          for (const [limit, fails] of [
            [2, false],
            [1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(criss.history, settings({ commits: limit }));

                const bases = seeded.repository.mergeBases(
                  idAt(seeded.ids, CRISS.first),
                  idAt(seeded.ids, CRISS.second),
                );

                if (fails) {
                  expectFailure(
                    yield* failure(bases),
                    Repository.TooMany,
                    { limit: "commits", most: limit },
                    `merge bases at ${limit}`,
                  );
                } else {
                  expect((yield* bases).length, `merge bases at ${limit} answers`).toBe(2);
                }
              }),
            );
          }

          // refs: readRefs of everything under refs/heads
          const wanted = refsModel(history, "refs/heads").length;

          for (const [limit, fails] of [
            [wanted, false],
            [wanted - 1, true],
          ] as const) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(history, settings({ refs: limit }));
                const refs = seeded.repository.readRefs(refNameFrom("refs/heads"));

                if (fails) {
                  expectFailure(
                    yield* failure(refs),
                    Repository.TooMany,
                    { limit: "refs", most: limit },
                    `readRefs of ${wanted} at ${limit}`,
                  );
                } else {
                  expect((yield* refs).length, `readRefs at ${limit} answers`).toBe(wanted);
                }
              }),
            );
          }
        }),
      run,
    );

    // Plant: answer the walk from what is there; fail `readRefs` and `readCommit` too.
    it.effect.prop(
      "S8 shallow: walk, mergeBases and isAncestor fail with HistoryTooShort; readCommit and readRefs answer",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const cut = everyShape(texture).flatMap((shape) => {
            const history = cutShallow(shape.history);

            return history === undefined ? [] : [{ label: `${shape.label}, shallow`, history }];
          });

          expect(cut.length, "most shape classes have a commit with parents").toBeGreaterThan(5);
          yield* seedEach(subject, cut, DEFAULT, (seeded, shape) =>
            Effect.gen(function* () {
              const last = shape.history.nodes.length - 1;
              const tip = idAt(seeded.ids, last);
              const repo = seeded.repository;

              const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
                repo.walk({ include: [tip], exclude: [] }),
                repo.mergeBases(tip, idAt(seeded.ids, 0)),
                repo.isAncestor(idAt(seeded.ids, 0), tip),
              ];

              for (const call of calls) {
                expect(isTooShort(yield* failure(call)), `${shape.label}: a call that reads history`).toBe(true);
              }

              yield* readBack(seeded, shape.history, shape.label);
              yield* readRefsBack(seeded, shape.history, shape.label);
            }),
          );
        }),
      run,
    );

    // Plant: name a span `Repository.walk`; annotate the author's name; put the walk's ids under a bare `include`; name
    // the span of `writeCommit` `Repository.writeCommit`; annotate the written message or the settings' committer;
    // leave `kalfa.git.from` out of `moveRef`, or put it in when `from` is none.
    it.effect.prop(
      "S9 spans: each call, the write calls too, ends one span named git.<call> with the attributes the plan gives, and leaks nothing",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const seen = everyShape(texture)
            .filter((shape) => shape.history.nodes.length > 0)
            .map((shape) => ({ label: shape.label, history: withCanary(shape.history) }));

          // The committer of the settings is a canary too, so a span that names the committer is seen.
          const config = settings({}, { name: `${CANARY}-bot`, email: `${CANARY}-bot@example.test` });

          yield* seedEach(subject, seen, config, (seeded, shape) =>
            Effect.gen(function* () {
              const ids = seeded.ids;
              const a = idAt(ids, 0);
              const b = idAt(ids, ids.length - 1);

              const calls: ReadonlyArray<{
                readonly call: string;
                readonly run: Effect.Effect<unknown, unknown>;
                readonly expected: Record<string, unknown>;
              }> = [
                {
                  call: "readCommit",
                  run: seeded.repository.readCommit(b),
                  expected: { "vcs.ref.head.revision": b },
                },
                {
                  call: "readRefs",
                  run: seeded.repository.readRefs(refNameFrom("refs/heads/main")),
                  expected: { "kalfa.git.under": "refs/heads/main", "kalfa.git.refs": 1 },
                },
                {
                  call: "walk",
                  run: seeded.repository.walk({ include: [b], exclude: [] }),
                  expected: {
                    "kalfa.git.include": [b],
                    "kalfa.git.exclude": [],
                    "kalfa.git.commits": walkModel(shape.history, [ids.length - 1], []).length,
                  },
                },
                {
                  call: "mergeBases",
                  run: seeded.repository.mergeBases(a, b),
                  expected: {
                    "vcs.ref.head.revision": a,
                    "vcs.ref.base.revision": b,
                    "kalfa.git.bases": basesModel(shape.history, 0, ids.length - 1).length,
                  },
                },
                {
                  call: "isAncestor",
                  run: seeded.repository.isAncestor(a, b),
                  expected: {
                    "vcs.ref.base.revision": a,
                    "vcs.ref.head.revision": b,
                    "kalfa.git.ancestor": isAncestorModel(shape.history, 0, ids.length - 1),
                  },
                },
              ];

              const secrets = [CANARY, ...seeded.hidden];

              for (const { call, run: effect, expected } of calls) {
                const { spans } = yield* traced(effect);
                expectSpan(`${shape.label}, ${call}`, spans, call, expected, secrets);
              }

              // The write calls: a commit written and a ref made and moved, each ending one span.
              const tree = treeAt(seeded.trees, 0);

              const author = new Commit.Signature({
                name: `${CANARY}-writer`,
                email: `${CANARY}-writer@example.test`,
                at: { seconds: 1, offset: "+0000" },
              });

              const wrote = yield* traced(
                seeded.repository.writeCommit({ tree, parents: [a], author, message: `${CANARY}-new\n` }),
              );

              expectSpan(
                `${shape.label}, writeCommit`,
                wrote.spans,
                "writeCommit",
                { "kalfa.git.tree": tree, "kalfa.git.parents": [a], "kalfa.git.commit": wrote.answer.id },
                secrets,
              );

              const ref = refNameFrom("refs/remotes/origin/s9");
              const made = yield* traced(seeded.repository.moveRef({ ref, from: Option.none(), to: b }));

              const madeAttributes = expectSpan(
                `${shape.label}, moveRef making a ref`,
                made.spans,
                "moveRef",
                { "vcs.ref.head.name": ref, "vcs.ref.head.revision": b },
                secrets,
              );

              expect(Object.keys(madeAttributes), `${shape.label}: a move from none has no expected id`).not.toContain(
                "kalfa.git.from",
              );

              const moved = yield* traced(seeded.repository.moveRef({ ref, from: Option.some(b), to: a }));

              expectSpan(
                `${shape.label}, moveRef moving a ref`,
                moved.spans,
                "moveRef",
                { "vcs.ref.head.name": ref, "vcs.ref.head.revision": a, "kalfa.git.from": b },
                secrets,
              );
            }),
          );
        }),
      run,
    );

    // Plant: add a `head` key to the service; let `readRefs` pack refs, so the object count changes; let `writeCommit`
    // point `refs/heads/main` at the commit it wrote.
    it.effect.prop(
      "S10 no working copy: the service has the five read calls and the two write calls, no list of reads changes the store, and no list of writes moves a ref",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.gen(function* () {
            expect(Object.keys(seeded.repository).sort(), `${shape.label}: the keys`).toEqual([
              "isAncestor",
              "mergeBases",
              "moveRef",
              "readCommit",
              "readRefs",
              "walk",
              "writeCommit",
            ]);
            const before = yield* seeded.fingerprint;
            const n = shape.history.nodes.length;

            const pick = (k: number): CommitId.CommitId =>
              n === 0 ? commitIdFrom(missingId(texture, k, [])) : idAt(seeded.ids, (texture.nums[k] ?? 0) % n);

            for (let k = 0; k < 24; k++) {
              const x = pick(k);
              const y = pick(k + 24);

              const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
                seeded.repository.readCommit(x),
                seeded.repository.readRefs(
                  refNameFrom(refQueries(shape.history)[k % refQueries(shape.history).length] ?? "refs/heads/main"),
                ),
                seeded.repository.walk({ include: [x], exclude: [y] }),
                seeded.repository.mergeBases(x, y),
                seeded.repository.isAncestor(x, y),
              ];

              yield* Effect.exit(calls[(texture.nums[k + 48] ?? 0) % calls.length] ?? Effect.void);
            }

            expect(yield* seeded.fingerprint, `${shape.label}: the store is as it was`).toEqual(before);

            // Writes, some of them refused: a commit is made, and no ref is moved by it.
            const lacking = treeIdFrom(missingId(texture, 5, []));

            for (let k = 0; k < 12; k++) {
              yield* Effect.exit(
                writeCall(seeded.repository, {
                  tree: k % 4 === 3 ? lacking : n === 0 ? treeIdFrom(TREE_ID) : treeAt(seeded.trees, k % n),
                  parents: n === 0 ? [] : [pick(k + 12)],
                  author: flatAt(texture, k),
                  message: `write ${k}\n`,
                }),
              );
            }

            yield* readRefsBack(seeded, shape.history, `${shape.label}: after writes`);
          }),
        ),
      run,
    );

    // Plant: mix a commit's parents into its tree's id; leave the mode out of a tree's bytes; give every commit the
    // empty tree.
    it.effect.prop(
      "S11 same files, same tree: two commits have one tree id exactly when their paths, modes and bytes are equal",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const made = treeCarrier(texture);
          expect(made.classes, "the generator reaches every tree class").toEqual(TREE_CARRIER_CLASSES);
          let same = 0;
          let apart = 0;

          const histories: ReadonlyArray<Shape> = [
            ...everyShape(texture),
            { label: "tree carrier", history: made.history },
          ];

          yield* seedEach(subject, histories, DEFAULT, (seeded, shape) =>
            Effect.sync(() => {
              const nodes = shape.history.nodes;

              nodes.forEach((node, i) => {
                if (node.files.length === 0) {
                  expect(treeAt(seeded.trees, i), `${shape.label}: commit ${i} has no files, so git's empty tree`).toBe(
                    TREE_ID,
                  );
                }

                nodes.slice(i + 1).forEach((other, k) => {
                  const j = i + 1 + k;
                  const equal = sameFiles(node.files, other.files);

                  if (equal) {
                    same += 1;
                  } else {
                    apart += 1;
                  }

                  expect(
                    treeAt(seeded.trees, i) === treeAt(seeded.trees, j),
                    `${shape.label}: commits ${i} and ${j} ${equal ? "hold the same files" : "differ in their files"}`,
                  ).toBe(equal);
                });
              });

              if (shape.label === "tree carrier") {
                const first = treeAt(seeded.trees, 0);
                const place = (label: string): number => made.classes.indexOf(label);

                expect(
                  treeAt(seeded.trees, place("the same files on another parent")),
                  "the same files, another parent",
                ).toBe(first);

                for (const label of [
                  "one byte differs",
                  "one path differs",
                  "one folder level differs",
                  "one mode differs",
                ]) {
                  expect(treeAt(seeded.trees, place(label)), `${label}: a tree one change apart`).not.toBe(first);
                }
              }
            }),
          );

          expect(same, "the generator reaches commits with equal files").toBeGreaterThan(0);
          expect(apart, "the generator reaches commits with different files").toBeGreaterThan(0);
        }),
      run,
    );

    // Plant: delete the NUL check in `make`, so memory writes the message; delete the size check; count the object's
    // characters and not its bytes, so the wide row passes at one byte over; delete the check of the tree; check only
    // the first parent; take the committer from the author; round the clock's second up; write the offset as the
    // machine's zone; trim the message; let `writeCommit` point `refs/heads/main` at the commit.
    it.effect.prop(
      "S12 write a commit: it reads back field for field with the settings' committer at the clock's second and +0000, a seeded commit's own fields give its id, a refusal writes nothing, no ref moves",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const committer = committerFrom(flatAt(texture, 4));
          const config = settings({}, committer);
          const word = texture.words[0] ?? "w";
          const reached = new Set<string>();
          const refused = new Set<string>();

          const histories = [
            ...everyShape(texture).filter((shape) => shape.history.nodes.length > 0),
            { label: "tree carrier", history: treeCarrier(texture).history },
          ].map(({ label, history }) => ({ label, history: asWritten(history, committer) }));

          // Every shape: each class of write, a seeded commit's own fields, and each class of refusal.
          yield* seedEach(subject, histories, config, (seeded, shape) =>
            Effect.gen(function* () {
              const { ids, trees, repository } = seeded;
              const history = shape.history;
              const n = history.nodes.length;
              const author = flatAt(texture, 1);

              for (const [k, spec] of writeSpecs(history, texture).entries()) {
                reached.add(spec.label);
                const seconds = 1_000_000 + numAt(texture, k);
                yield* clockAt(seconds, texture, k + 20);

                yield* writeAndRead(
                  repository,
                  {
                    tree: spec.tree === "empty" ? treeIdFrom(TREE_ID) : treeAt(trees, spec.tree),
                    parents: spec.parents.map((parent) => idAt(ids, parent)),
                    author,
                    message: `${spec.label}\n`,
                  },
                  committer,
                  seconds,
                  `${shape.label}, ${spec.label}`,
                );
              }

              // The first, the last and two drawn commits, written from their own fields: the same commit, so the same id.
              for (const i of new Set([0, n - 1, numAt(texture, 30) % n, numAt(texture, 31) % n])) {
                const node = nodeAt(history, i);
                yield* clockAt(node.committer.seconds, texture, 32 + i);

                const commit = yield* writeCall(repository, {
                  tree: treeAt(trees, i),
                  parents: node.parents.map((parent) => idAt(ids, parent)),
                  author: node.author,
                  message: node.message,
                });

                expect(encodeCommit(commit), `${shape.label}: commit ${i} written from its own fields`).toEqual(
                  expectedCommit(history, ids, trees, i),
                );
              }

              // Each refusal has a sound tree, sound parents and a small message but the one thing it breaks, so each
              // check is reached; nothing is written, and the clock is whatever it was.
              const sound: Fields = {
                tree: treeAt(trees, 0),
                parents: [idAt(ids, 0)],
                author,
                message: `${word}\n`,
              };

              const lacking = treeIdFrom(missingId(texture, 0, [...ids, ...trees]));
              const gone = commitIdFrom(missingId(texture, 1, [...ids, ...trees]));
              const place = (label: string): string => `${shape.label}, ${label}`;

              for (const [label, message] of nulMessages(word)) {
                refused.add(label);
                yield* refusedWrite(seeded, { ...sound, message }, Repository.NulInMessage, {}, place(label));
              }

              for (const [label, bad] of [
                ["a tree the store lacks", lacking],
                ["a commit's id given as the tree", treeIdFrom(idAt(ids, n - 1))],
              ] as const) {
                refused.add(label);
                yield* refusedWrite(seeded, { ...sound, tree: bad }, Repository.NoSuchTree, { id: bad }, place(label));
              }

              for (const [label, parents, bad] of [
                ["a parent the store lacks", [gone], gone],
                [
                  "a tree's id given as a parent",
                  [commitIdFrom(treeAt(trees, n - 1))],
                  commitIdFrom(treeAt(trees, n - 1)),
                ],
                ["a parent the store lacks, second of two", [idAt(ids, 0), gone], gone],
                ["a parent the store lacks, first of two", [gone, idAt(ids, 0)], gone],
              ] as const) {
                refused.add(label);
                yield* refusedWrite(seeded, { ...sound, parents }, Repository.NoSuchCommit, { id: bad }, place(label));
              }

              yield* readRefsBack(seeded, history, `${shape.label}: after every write and refusal`);
            }),
          );

          expect([...reached].sort(), "the generator reaches every write class").toEqual(
            [...WRITE_SHAPE_CLASSES].sort(),
          );
          expect([...refused].sort(), "the generator reaches every refusal class").toEqual([...REFUSAL_CLASSES].sort());

          const root = everyShape(texture).find((shape) => shape.label === "one root");

          if (root === undefined) {
            return yield* Effect.die("the generator made no root");
          }

          // The committer is the settings' one, whatever it holds, at each clock: the start of time, a drawn day, a second past 2^32.
          const clocks = [0, 1_700_000_000 + numAt(texture, 40), 4_294_967_296 + numAt(texture, 41)];
          expect(committerAccepted(flatAt(texture, 2)).length, "the committer classes").toBeGreaterThan(8);

          for (const [label, person] of committerAccepted(flatAt(texture, 2))) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(root.history, settings({}, person));

                for (const [k, seconds] of clocks.entries()) {
                  yield* clockAt(seconds, texture, 50 + k);

                  yield* writeAndRead(
                    seeded.repository,
                    {
                      tree: treeAt(seeded.trees, 0),
                      parents: [idAt(seeded.ids, 0)],
                      author: flatAt(texture, 3),
                      message: `${word}\n`,
                    },
                    person,
                    seconds,
                    `committer ${label}, second ${seconds}`,
                  );
                }
              }),
            );
          }

          // Every class of message and of author goes in and comes back whole (a NUL is the refusal above).
          expect(
            messageVariants(word).map(([label]) => label),
            "the generator reaches every message class",
          ).toEqual(MESSAGE_CLASSES);
          expect(
            signatureVariants(flatAt(texture, 1)).map(([label]) => label),
            "the generator reaches every signature class",
          ).toEqual(SIGNATURE_CLASSES);

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(root.history, config);
              const second = 1_700_000_000;
              const target = { tree: treeAt(seeded.trees, 0), parents: [idAt(seeded.ids, 0)] };
              yield* clockAt(second, texture, 60);

              for (const [label, message] of messageVariants(word)) {
                if (label !== "a NUL") {
                  yield* writeAndRead(
                    seeded.repository,
                    { ...target, author: flatAt(texture, 1), message },
                    committer,
                    second,
                    `message ${label}`,
                  );
                }
              }

              for (const [label, author] of signatureVariants(flatAt(texture, 1))) {
                yield* writeAndRead(
                  seeded.repository,
                  { ...target, author, message: `${word}\n` },
                  committer,
                  second,
                  `author ${label}`,
                );
              }
            }),
          );

          // The limit is on the object's bytes: exactly `limits.bytes` is written and read back, one byte more is refused,
          // with a one-byte, a three-byte and a four-byte character at the edge.
          const second = 1_700_000_000;
          const author = flatAt(texture, 1);

          for (const [label, message] of edgeMessages(word)) {
            const exact = writtenSize({
              tree: TREE_ID,
              parents: ["0".repeat(40)],
              author,
              committer,
              seconds: second,
              message,
            });

            for (const [limit, over] of [
              [exact, false],
              [exact - 1, true],
            ] as const) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const seeded = yield* subject.seed(root.history, settings({ bytes: limit }, committer));
                  const fields = { tree: treeAt(seeded.trees, 0), parents: [idAt(seeded.ids, 0)], author, message };
                  const at = `${label}, a limit of ${limit} bytes`;
                  yield* clockAt(second, texture, 61);

                  if (over) {
                    yield* refusedWrite(seeded, fields, Repository.TooLargeToWrite, { most: limit }, at);
                  } else {
                    yield* writeAndRead(seeded.repository, fields, committer, second, at);
                  }
                }),
              );
            }
          }
        }),
      run,
    );

    // Plant: refuse a ref outside `refs/heads/`; refuse a move that drops commits; delete the compare with `from`;
    // compare only when `from` is some; delete the check of a ref in the way; delete the check on `to`; read `to` as
    // a commit when it is a tree's id; move the ref before the compare; keep the first `from` for a second move.
    it.effect.prop(
      "S13 move a ref: each move that succeeds leaves the ref at `to` and every other ref as it was, each stale move, ref in the way or missing commit fails with its error and leaves every ref as it was",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const { history, names } = moveCarrier(texture);
          const classes = new Set<string>();
          const extra = [...Object.values(names), "refs/heads", "refs/kalfa/candidates", "refs/remotes/origin"];

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(history, DEFAULT);
              const repo = seeded.repository;
              const model = new Map<string, number>(history.refs.map((ref) => [ref.name, ref.commit]));
              const check = (place: string) => readModelBack(seeded, history, model, extra, place);
              const at = (index: number): CommitId.CommitId => idAt(seeded.ids, index);

              const move = (ref: string, from: Option.Option<number>, to: number) =>
                repo.moveRef({ ref: refNameFrom(ref), from: Option.map(from, at), to: at(to) });

              // Refused moves first, on the store as the history made it.
              for (const [label, ref, from, to] of [
                ["from none while the ref exists", names.side, Option.none(), MOVE.three],
                ["from a commit while the ref is at another", names.side, Option.some(MOVE.three), MOVE.merge],
                ["from a commit while the ref is gone", names.gone, Option.some(MOVE.three), MOVE.merge],
              ] as const) {
                classes.add(label);
                expectFailure(yield* failed(move(ref, from, to), label), Repository.RefMoved, { ref }, label);
                yield* check(`${label}: no ref moved`);
              }

              for (const [label, ref, other] of [
                ["making a ref inside a ref's name", `${names.main}/x`, names.main],
                ["making a ref above a ref", "refs/kalfa/candidates", names.candidate],
              ] as const) {
                classes.add(label);

                expectFailure(
                  yield* failed(move(ref, Option.none(), MOVE.merge), label),
                  Repository.RefInTheWay,
                  { ref, other },
                  label,
                );
                yield* check(`${label}: no ref moved`);
              }

              for (const [label, to] of [
                ["to a commit the store lacks", missingId(texture, 5, [...seeded.ids, ...seeded.trees])],
                ["to a tree's id", treeAt(seeded.trees, 1)],
              ] as const) {
                classes.add(label);

                expectFailure(
                  yield* failed(
                    repo.moveRef({ ref: refNameFrom(names.branch), from: Option.none(), to: commitIdFrom(to) }),
                    label,
                  ),
                  Repository.NoSuchCommit,
                  { id: to },
                  label,
                );
                yield* check(`${label}: no ref moved`);
              }

              // Moves that succeed, one after the other: each leaves the ref at `to`, and no other ref moves.
              for (const [label, ref, from, to] of [
                ["making a candidate ref", names.fresh, Option.none(), MOVE.merge],
                ["making a remote ref", names.remote, Option.none(), MOVE.side],
                ["moving a branch forward", names.main, Option.some(MOVE.main), MOVE.merge],
                ["moving a branch back to an older commit", names.main, Option.some(MOVE.merge), MOVE.one],
                ["moving a branch to the commit it is at", names.main, Option.some(MOVE.one), MOVE.one],
              ] as const) {
                classes.add(label);
                yield* move(ref, from, to);
                model.set(ref, to);
                expect(
                  plainRefs(yield* repo.readRefs(refNameFrom(ref))),
                  `${label}: the ref is at its new commit`,
                ).toEqual([{ name: ref, commit: at(to) }]);
                yield* check(`${label}: every other ref is as it was`);
              }

              expect([...classes].sort(), "the generator reaches every move class").toEqual([...MOVE_CLASSES].sort());

              // A walk: each step reads where its ref is now, and a third of the steps ask from a commit that is wrong.
              const pool = [
                names.main,
                names.side,
                names.candidate,
                names.fresh,
                names.remote,
                names.branch,
                names.gone,
              ];

              const count = history.nodes.length;

              for (let k = 0; k < 18; k++) {
                const ref = pool[numAt(texture, 3 * k) % pool.length] ?? names.main;
                const to = numAt(texture, 3 * k + 1) % count;
                const current = model.get(ref);

                const wrong: Option.Option<number> =
                  current === undefined
                    ? Option.some((to + 1) % count)
                    : numAt(texture, 3 * k + 2) % 2 === 1
                      ? Option.none()
                      : Option.some((current + 1) % count);

                const place = `walk ${k}, ${ref}`;

                if (k % 3 === 0) {
                  expectFailure(yield* failed(move(ref, wrong, to), place), Repository.RefMoved, { ref }, place);
                } else {
                  yield* move(ref, Option.fromNullishOr(current), to);
                  model.set(ref, to);
                }

                yield* check(place);
              }
            }),
          );
        }),
      run,
    );
  });
};

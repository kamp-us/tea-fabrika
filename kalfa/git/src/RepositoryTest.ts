// The laws every adapter of `Repository` passes (S1 to S10), exported as `/test`. A runner gives a
// `Subject`: how to seed a history into its own kind of store. The suite draws a texture, makes one
// history for each shape class from it, seeds each, and compares every answer with the model in
// HistoryTest.ts. A subject that passes these laws answers as every other one does.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema, type Scope, Tracer } from "effect";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import {
  basesModel,
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
  shapes,
  textureArb,
  toPlain,
  TREE_ID,
  refQueries,
  walkModel,
  CRISS,
  type History,
  type Shape,
  type Texture,
} from "./HistoryTest.ts";
import * as Ref from "./Ref.ts";
import * as Repository from "./Repository.ts";
import * as Settings from "./Settings.ts";

export type Config = typeof Settings.Settings.Type;

/** A seeded store: the service to ask, the id each history commit got, and what the laws may look at. */
export interface Seeded {
  readonly repository: Repository.Repository["Service"];
  /** The id of each commit of the history, by index. */
  readonly ids: ReadonlyArray<CommitId.CommitId>;
  /** Anything that changes when the store changes: a call must never change it (S10). */
  readonly fingerprint: Effect.Effect<unknown>;
  /** Text that must never appear in a span, such as the repository's path. */
  readonly hidden: ReadonlyArray<string>;
}

export interface Subject {
  readonly seed: (history: History, settings: Config) => Effect.Effect<Seeded, never, Scope.Scope>;
}

export interface SuiteOptions {
  /** How many drawn textures each law checks. */
  readonly runs: number;
  /** The most one law may take, in milliseconds. */
  readonly timeout: number;
}

/** Settings with generous limits, and the ones a law wants to push set. */
export const settings = (
  limits: { readonly commits?: number; readonly refs?: number; readonly bytes?: number } = {},
): Config =>
  Schema.decodeUnknownSync(Settings.Settings)({
    limits: { commits: 1000, refs: 1000, bytes: 1_000_000, time: "10 seconds", ...limits },
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

export const encodeCommit = (commit: Commit.Commit): typeof Commit.Commit.Encoded =>
  Schema.encodeSync(Commit.Commit)(commit);

/** What `readCommit` of commit `i` must answer, as plain data. */
export const expectedCommit = (
  history: History,
  ids: ReadonlyArray<CommitId.CommitId>,
  i: number,
): typeof Commit.Commit.Encoded => {
  const node = history.nodes[i];

  if (node === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return {
    id: idAt(ids, i),
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
  config: Config,
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

// ---------------------------------------------------------------------------------------------------------
// The checks a few laws share
// ---------------------------------------------------------------------------------------------------------

const readBack = (seeded: Seeded, history: History, label: string): Effect.Effect<void, unknown> =>
  Effect.forEach(
    history.nodes,
    (_, i) =>
      Effect.map(seeded.repository.readCommit(idAt(seeded.ids, i)), (commit) => {
        expect(encodeCommit(commit), `${label}: commit ${i}`).toEqual(expectedCommit(history, seeded.ids, i));
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

/** `error` is an instance of the failure class `kind` and holds `fields`: never its text, only what it says. */
export const expectFailure = <E>(
  error: E,
  kind: abstract new (...args: never[]) => object,
  fields: object,
  message: string,
): void => {
  expect(error, message).toBeInstanceOf(kind);
  expect(error, message).toMatchObject(fields);
};

const failure = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<E, never> => Effect.flip(effect).pipe(Effect.orDie);

// ---------------------------------------------------------------------------------------------------------
// The laws
// ---------------------------------------------------------------------------------------------------------

export const suite = (name: string, subject: Subject, options: SuiteOptions): void => {
  const run = { arbitrary: { runs: options.runs, seed: 119120 }, timeout: options.timeout };

  describe(`${name}: the shared laws of Repository`, () => {
    // Plant: each of G4's plants (trim the message, store the offset as a number, refuse an empty name or a
    // space at either end of a name) turns this red too; and in `/process`, take the name up to the last
    // space before `<`: a name with a trailing space comes back short.
    it.effect.prop(
      "S1 read back: readCommit gives parents in order, author, committer and message byte for byte",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const made = carrier(texture);
          expect(made.classes, "the generator reaches every message and signature class").toEqual(CARRIER_CLASSES);
          const histories: ReadonlyArray<Shape> = [...everyShape(texture), { label: "carrier", history: made.history }];
          yield* seedEach(subject, histories, DEFAULT, (seeded, shape) => readBack(seeded, shape.history, shape.label));
        }),
      run,
    );

    // Plant: answer `false` or `[]` for an unknown id in `isAncestor`; drop unknown excludes in `walk`.
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
            const missing = [first, second, tree];
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

    // Plant: name a span `Repository.walk`; annotate the author's name; put the walk's ids under a bare `include`.
    it.effect.prop(
      "S9 spans: each call ends one span named git.<call> with the attributes the plan gives, and leaks nothing",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const seen = everyShape(texture)
            .filter((shape) => shape.history.nodes.length > 0)
            .map((shape) => ({ label: shape.label, history: withCanary(shape.history) }));

          yield* seedEach(subject, seen, DEFAULT, (seeded, shape) =>
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

              for (const { call, run: effect, expected } of calls) {
                const spans: Array<Tracer.NativeSpan> = [];

                const tracer = Tracer.make({
                  span: (options) => {
                    const span = new Tracer.NativeSpan(options);
                    spans.push(span);

                    return span;
                  },
                });

                yield* effect.pipe(Effect.withTracer(tracer));
                const place = `${shape.label}, ${call}`;
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

                for (const secret of [CANARY, ...seeded.hidden]) {
                  expect(text.includes(secret), `${place}: no attribute holds ${secret}`).toBe(false);
                }
              }
            }),
          );
        }),
      run,
    );

    // Plant: add a `head` key to the service; let `readRefs` pack refs, so the object count changes.
    it.effect.prop(
      "S10 no working copy: the service has five keys, and no list of calls changes the store",
      { texture: textureArb },
      ({ texture }) =>
        seedEach(subject, everyShape(texture), DEFAULT, (seeded, shape) =>
          Effect.gen(function* () {
            expect(Object.keys(seeded.repository).sort(), `${shape.label}: the keys`).toEqual([
              "isAncestor",
              "mergeBases",
              "readCommit",
              "readRefs",
              "walk",
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
          }),
        ),
      run,
    );
  });
};

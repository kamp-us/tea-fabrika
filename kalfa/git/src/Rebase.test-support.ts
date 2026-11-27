// The laws of `rebase` (S37 to S41), run on each adapter's store. `RepositoryTest.suite` calls `laws`, so every adapter that runs
// `/test` runs them: a call written once over the raw calls must give one answer on both adapters. Each law draws one carrier history
// (`rebaseCarrier`) whose every class is reached in every run, seeds it, and holds each answer to `rebaseModel` and to the tree ids of
// the nodes the carrier made for it.
import { expect, it } from "@effect/vitest";
import { Clock, Effect, Result } from "effect";
import type * as Commit from "./Commit.ts";
import type * as CommitId from "./CommitId.ts";
import {
  CANARY,
  cutShallow,
  missingId,
  committerFrom,
  REBASE_CLASSES,
  rebaseCarrier,
  textureArb,
  TREE_ID,
  walkModel,
  withCanary,
  writtenSize,
  type Committer,
  type History,
  type RebaseCarrier,
  type RebaseCase,
  type Texture,
} from "./History.test-support.ts";
import {
  commitIdFrom,
  encodeCommit,
  expectedWrite,
  expectNamedSpan,
  failed,
  flatAt,
  idAt,
  numAt,
  readRefsBack,
  seedEach,
  traced,
  treeAt,
} from "./Laws.test-support.ts";
import { expectFailure, settings } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import type { Seeded, Subject } from "./RepositoryTest.ts";
import type * as Settings from "./Settings.ts";

/** What `it.effect.prop` is given: the case count and seed, and the longest a law may take. */
interface Run {
  readonly arbitrary: { readonly runs: number; readonly seed: number };
  readonly timeout: number;
}

/** The three commits of a case, as the call takes them. */
const asked = (seeded: Seeded, each: RebaseCase) => ({
  upstream: idAt(seeded.ids, each.upstream),
  commit: idAt(seeded.ids, each.commit),
  onto: idAt(seeded.ids, each.onto),
});

const rebasing = (seeded: Seeded, each: RebaseCase) => seeded.repository.rebase(asked(seeded, each));

/**
 * A clock that moves a whole second at each read of the time in milliseconds, from `start`. A call that reads the clock once for the
 * commits of one rebase gives them all the second of the first read; one that reads it for each commit gives each its own.
 */
const ticking = (real: Clock.Clock, start: number): Clock.Clock => {
  let reads = 0;
  const read = (): number => start + 1000 * reads++;

  return {
    currentTimeMillisUnsafe: read,
    currentTimeMillis: Effect.sync(read),
    currentTimeNanosUnsafe: () => real.currentTimeNanosUnsafe(),
    currentTimeNanos: real.currentTimeNanos,
    monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: real.monotonicTimeNanos,
    sleep: (duration) => real.sleep(duration),
  };
};

const underTicking = <A, E>(effect: Effect.Effect<A, E>, start: number): Effect.Effect<A, E> =>
  Effect.flatMap(Clock.clockWith(Effect.succeed), (real) =>
    Effect.provideService(effect, Clock.Clock, ticking(real, start)),
  );

/** A time for case `k`: a whole second past 1.8 billion and a drawn part of a second, in milliseconds. */
const startAt = (texture: Texture, k: number): number =>
  (1_800_000_000 + (numAt(texture, k) % 1_000_000)) * 1000 + (numAt(texture, k + 1) % 1000);

/** Every commit of the history, read in one walk from every tip: what the old commits hold, which no rebase may change. */
const everyCommit = (seeded: Seeded, history: History) =>
  Effect.map(
    seeded.repository.walk({ include: [idAt(seeded.ids, history.nodes.length - 1), ...seeded.ids], exclude: [] }),
    (commits) => commits.map(encodeCommit),
  );

/** The own commits of a case, by index, as the model finds them. */
const ownCommits = (history: History, each: RebaseCase): ReadonlyArray<number> =>
  walkModel(history, [each.commit], [each.upstream, each.onto]);

/** What new commit `i` of an answer must read back as: the model's tree, the old commit's author and message, the settings' committer. */
const expectedFor = (
  seeded: Seeded,
  history: History,
  each: RebaseCase,
  answer: ReadonlyArray<Commit.Commit>,
  committer: Committer,
  seconds: number,
  place: string,
  made: Commit.Commit,
  i: number,
): typeof Commit.Commit.Encoded => {
  const step = each.expected.kind === "commits" ? each.expected.steps[i] : undefined;
  const old = step === undefined ? undefined : history.nodes[step.own];

  if (step === undefined || old === undefined) {
    throw new Error(`${place}: no step ${i}`);
  }

  return expectedWrite(
    made.id,
    {
      tree: treeAt(seeded.trees, step.tree),
      parents: [i === 0 ? idAt(seeded.ids, each.onto) : (answer[i - 1]?.id ?? idAt(seeded.ids, each.onto))],
      author: old.author,
      message: old.message,
    },
    committer,
    seconds,
  );
};

/**
 * The call's answer for a case the model says is clean, checked against the model: one new commit for each own commit, oldest first,
 * each with the parents `[the one before, or onto]`, the tree of the node the carrier made, the old commit's author and message byte
 * for byte, and the settings' committer at `seconds`; and the store holds the new commits as the answer gives them, on `onto` alone.
 */
const expectClean = (
  seeded: Seeded,
  history: History,
  each: RebaseCase,
  answer: ReadonlyArray<Commit.Commit>,
  committer: Committer,
  seconds: number,
  place: string,
) =>
  Effect.gen(function* () {
    if (each.expected.kind !== "commits") {
      return yield* Effect.die(new Error(`${place}: the model makes no commits`));
    }

    const { steps } = each.expected;
    expect(answer.length, `${place}: one new commit for each own commit`).toBe(steps.length);
    expect(
      steps.map((step) => step.own),
      `${place}: the model keeps the own commits`,
    ).toEqual(ownCommits(history, each));

    const written = answer.map((made, i) =>
      expectedFor(seeded, history, each, answer, committer, seconds, place, made, i),
    );

    expect(answer.map(encodeCommit), `${place}: the new commits`).toEqual(written);

    // Read back from the store, the new commits are the ones the call gave, on `onto` and nothing else.
    const last = answer.at(-1);

    if (last !== undefined) {
      const held = yield* seeded.repository.walk({ include: [last.id], exclude: [idAt(seeded.ids, each.onto)] });
      expect(held.map(encodeCommit), `${place}: read back`).toEqual(written);
    }
  });

/** The cases of a carrier the model answers with commits, apart from those another law holds. */
const cleanCases = (
  made: RebaseCarrier,
  skip: (each: RebaseCase) => boolean = () => false,
): ReadonlyArray<RebaseCase> => made.cases.filter((each) => each.expected.kind === "commits" && !skip(each));

const everyClass = (made: RebaseCarrier): void =>
  expect(
    made.cases.map((each) => each.label),
    "the generator reaches every rebase class",
  ).toEqual(REBASE_CLASSES);

const findCase = (made: RebaseCarrier, prefix: string): RebaseCase => {
  const found = made.cases.find((each) => each.label.startsWith(prefix));

  if (found === undefined) {
    throw new Error(`the carrier holds no case that starts with ${prefix}`);
  }

  return found;
};

/** Seeds the history under `config` and runs `check` once, for a law that needs a store of its own. */
const seeding = <A, E>(
  subject: Subject,
  label: string,
  history: History,
  config: Settings.Settings,
  check: (seeded: Seeded) => Effect.Effect<A, E>,
) => seedEach(subject, [{ label, history }], config, (seeded) => check(seeded));

export const laws = (subject: Subject, run: Run): void => {
  // Plant: give each commit `onto` as its parent, (a) red; merge over `onto` and not over the old parent, (a) red; take the
  // committer from the old commit, (d) red; drop a commit whose tree is its tip's tree, (c) red; exclude only `upstream`, (n) red;
  // answer `[commit]` when there is nothing to do, (b) red; read the clock once for each commit while the clock moves, (d) red.
  it.effect.prop(
    "S37 rebase: for every clean case, one new commit for each own commit, oldest first, each with parents the one before or onto, the model's tree, the old commit's author and message byte for byte, and the settings' committer at the clock's second, the same second for all; [] when there are none; the old commits read back as before and no ref moves",
    { texture: textureArb },
    ({ texture }) =>
      Effect.gen(function* () {
        const made = rebaseCarrier(texture);
        everyClass(made);
        const committer = committerFrom(flatAt(texture, 4));
        const cases = cleanCases(made, (each) => each.label.startsWith("(f)"));
        expect(cases.length, "the generator reaches clean cases of every group").toBeGreaterThan(15);

        yield* seeding(subject, "rebases", made.history, settings({}, committer), (seeded) =>
          Effect.gen(function* () {
            const before = yield* everyCommit(seeded, made.history);
            let kept = 0;

            for (const [k, each] of cases.entries()) {
              const start = startAt(texture, k);
              const answer = yield* underTicking(rebasing(seeded, each), start);
              yield* expectClean(seeded, made.history, each, answer, committer, Math.floor(start / 1000), each.label);
              kept += answer.length;
            }

            expect(kept, "the generator reaches many commits").toBeGreaterThan(30);
            expect(
              cases.filter((each) => each.expected.kind === "commits" && each.expected.steps.length === 0).length,
              "the generator reaches a branch the call has nothing to do for",
            ).toBeGreaterThan(1);

            expect(yield* everyCommit(seeded, made.history), "the old commits read back as before").toEqual(before);
            yield* readRefsBack(seeded, made.history, "after every rebase");
          }),
        );
      }),
    run,
  );

  // Plant: return the commits made before the conflict as an answer, (e) red; name only the first path, (e) red; merge the third
  // commit over the first commit's parent, (e) red.
  it.effect.prop(
    "S38 conflicts: each conflict case fails Conflict with the model's paths, sorted by bytes and each once, at the first conflict only; no ref moves and the old commits read back as before",
    { texture: textureArb },
    ({ texture }) =>
      Effect.gen(function* () {
        const made = rebaseCarrier(texture);
        everyClass(made);
        const cases = made.cases.filter((each) => each.expected.kind === "conflict");
        expect(cases.length, "the generator reaches every conflict class").toBe(7);

        yield* seeding(subject, "conflicts", made.history, settings({}, committerFrom(flatAt(texture, 4))), (seeded) =>
          Effect.gen(function* () {
            const before = yield* everyCommit(seeded, made.history);

            for (const each of cases) {
              const expected = each.expected;

              if (expected.kind !== "conflict") {
                return yield* Effect.die(new Error("the cases are conflicts"));
              }

              expectFailure(
                yield* failed(rebasing(seeded, each), each.label),
                Repository.Conflict,
                { paths: expected.paths },
                each.label,
              );
            }

            expect(yield* everyCommit(seeded, made.history), "the old commits read back as before").toEqual(before);
            yield* readRefsBack(seeded, made.history, "after every conflict");
          }),
        );
      }),
    run,
  );

  // Plant: delete the merge check, so its first parent is used, (f) red; name the merges in walk order, (f) red; check the root before
  // the merge, (g) red; delete the root check, so a root merges over nothing, (g) red; read merge commits below `upstream`, (f) red.
  it.effect.prop(
    "S39 cannot rebase: a merge commit among the own commits fails CannotRebase merge naming every one sorted by id, a root fails it with root, both name the merges, a merge below the upstream rebases, and each refusal leaves the store as it was",
    { texture: textureArb },
    ({ texture }) =>
      Effect.gen(function* () {
        const made = rebaseCarrier(texture);
        everyClass(made);
        const committer = committerFrom(flatAt(texture, 4));
        const refused = made.cases.filter((each) => each.expected.kind === "merge" || each.expected.kind === "root");
        expect(refused.length, "the generator reaches every refusal").toBe(5);

        yield* seeding(subject, "refusals", made.history, settings({}, committer), (seeded) =>
          Effect.gen(function* () {
            for (const each of refused) {
              const expected = each.expected;

              if (expected.kind !== "merge" && expected.kind !== "root") {
                return yield* Effect.die(new Error("the cases are refusals"));
              }

              const quiet = yield* seeded.fingerprint;

              expectFailure(
                yield* failed(rebasing(seeded, each), each.label),
                Repository.CannotRebase,
                { reason: expected.kind, commits: expected.commits.map((i) => idAt(seeded.ids, i)).toSorted() },
                each.label,
              );

              expect(yield* seeded.fingerprint, `${each.label}: nothing was written`).toEqual(quiet);
            }

            // A merge commit that the upstream reaches is no own commit: the rebase goes on from it.
            const below = findCase(made, "(f) a merge commit below the upstream");
            const start = startAt(texture, 90);
            const answer = yield* underTicking(rebasing(seeded, below), start);
            yield* expectClean(seeded, made.history, below, answer, committer, Math.floor(start / 1000), below.label);
            yield* readRefsBack(seeded, made.history, "after every refusal");
          }),
        );
      }),
    run,
  );

  // Plant: leave `onto` out of the walk, so an unknown `onto` fails later or not at all, (h) red; check the size after the first
  // write, (k) red; count `>=` for `>`, (k) red; let the NUL reach `writeCommit` after two commits were written, (l) red; check
  // sizes with the old committer, (k) red; walk before the shallow check, (i) red; answer a cut list at the limit, (j) red.
  it.effect.prop(
    "S40 the order of the checks: unknown ids fail NoSuchCommit naming the first missing of commit, upstream, onto; a shallow store fails HistoryTooShort; one commit past limits.commits fails TooMany and exactly the limit rebases; a NUL fails NulInMessage; one byte past limits.bytes fails TooLargeToWrite and exactly the limit rebases; each writes nothing",
    { texture: textureArb },
    ({ texture }) =>
      Effect.gen(function* () {
        const made = rebaseCarrier(texture);
        everyClass(made);
        const committer = committerFrom(flatAt(texture, 4));
        const base = settings({}, committer);
        const one = findCase(made, "(a) one commit");
        const merging = findCase(made, "(f) one merge commit");
        const nul = made.cases.filter((each) => each.expected.kind === "nul");

        // (h) Unknown ids: the first missing of `commit`, `upstream` and `onto` is named, before anything else is asked.
        yield* seeding(subject, "unknown ids", made.history, base, (seeded) =>
          Effect.gen(function* () {
            const quiet = yield* seeded.fingerprint;
            const given = asked(seeded, one);
            const [a, b, c] = [0, 1, 2].map((k) => commitIdFrom(missingId(texture, k, seeded.ids)));

            if (a === undefined || b === undefined || c === undefined) {
              return yield* Effect.die(new Error("no ids"));
            }

            const tree = commitIdFrom(treeAt(seeded.trees, one.commit));
            const known = asked(seeded, merging);

            const asks: ReadonlyArray<
              readonly [string, Parameters<typeof seeded.repository.rebase>[0], CommitId.CommitId]
            > = [
              ["commit", { ...given, commit: a }, a],
              ["upstream", { ...given, upstream: a }, a],
              ["onto", { ...given, onto: a }, a],
              ["commit and upstream", { ...given, commit: a, upstream: b }, a],
              ["upstream and onto", { ...given, upstream: b, onto: c }, b],
              ["all three", { commit: a, upstream: b, onto: c }, a],
              ["a tree's id as onto", { ...given, onto: tree }, tree],
              ["onto, with a merge commit among the own commits", { ...known, onto: a }, a],
            ];

            for (const [label, ask, named] of asks) {
              expectFailure(
                yield* failed(seeded.repository.rebase(ask), label),
                Repository.NoSuchCommit,
                { id: named },
                label,
              );
              expect(yield* seeded.fingerprint, `${label}: nothing was written`).toEqual(quiet);
            }
          }),
        );

        // (i) A shallow store cannot tell what is new: it fails before any other check, and an unknown id comes first.
        const shallow = cutShallow(made.history);

        if (shallow === undefined) {
          return yield* Effect.die(new Error("the carrier has no commit with a parent"));
        }

        yield* seeding(subject, "a shallow store", shallow, base, (seeded) =>
          Effect.gen(function* () {
            const quiet = yield* seeded.fingerprint;

            for (const each of [one, merging]) {
              expect(
                yield* Effect.map(failed(rebasing(seeded, each), each.label), (error) => error._tag),
                `${each.label}: a shallow store`,
              ).toBe("HistoryTooShort");
            }

            const gone = commitIdFrom(missingId(texture, 0, seeded.ids));

            expectFailure(
              yield* failed(seeded.repository.rebase({ ...asked(seeded, one), onto: gone }), "shallow, unknown"),
              Repository.NoSuchCommit,
              { id: gone },
              "an unknown id comes before the shallow check",
            );
            expect(yield* seeded.fingerprint, "a shallow store: nothing was written").toEqual(quiet);
          }),
        );

        // (j) The commits limit: exactly the own commits rebases, one less fails TooMany, and a refusal comes after it.
        const edges = findCase(made, "(k)");
        const owned = ownCommits(made.history, edges).length;
        const many = findCase(made, "(f) three merge commits");
        const manyOwn = ownCommits(made.history, many).length;
        expect(owned, "the branch holds three own commits").toBe(3);

        for (const [limit, each, own] of [
          [owned, edges, owned],
          [owned - 1, edges, owned],
          [manyOwn - 1, many, manyOwn],
        ] as const) {
          yield* seeding(
            subject,
            `a limit of ${limit} commits`,
            made.history,
            settings({ commits: limit }, committer),
            (seeded) =>
              Effect.gen(function* () {
                const quiet = yield* seeded.fingerprint;
                const place = `${each.label}, a limit of ${limit} commits`;

                if (limit >= own) {
                  const start = startAt(texture, 91);
                  const answer = yield* underTicking(rebasing(seeded, each), start);
                  yield* expectClean(seeded, made.history, each, answer, committer, Math.floor(start / 1000), place);
                } else {
                  expectFailure(
                    yield* failed(rebasing(seeded, each), place),
                    Repository.TooMany,
                    { limit: "commits", most: limit },
                    place,
                  );
                  expect(yield* seeded.fingerprint, `${place}: nothing was written`).toEqual(quiet);
                }
              }),
          );
        }

        // (l) A NUL in any own commit's message is found before any commit is made, even after a commit that conflicts.
        expect(nul.length, "the generator reaches both NUL cases").toBe(2);

        yield* seeding(subject, "a NUL", made.history, base, (seeded) =>
          Effect.gen(function* () {
            for (const each of nul) {
              const quiet = yield* seeded.fingerprint;
              expectFailure(yield* failed(rebasing(seeded, each), each.label), Repository.NulInMessage, {}, each.label);
              expect(yield* seeded.fingerprint, `${each.label}: nothing was written`).toEqual(quiet);
            }
          }),
        );

        // (k) The bytes limit, with a committer longer than the old one: a new commit of exactly the limit is written, one byte more
        // is not, and the commits before it are not written either.
        const longer: Committer = { name: `b${"b".repeat(30)}`, email: `${"b".repeat(30)}@example.test` };
        const start = startAt(texture, 92);
        const seconds = Math.floor(start / 1000);
        const edge = findCase(made, "(k)");

        const sizes = ownCommits(made.history, edge).map((i) => newSize(made.history, i, longer, seconds));

        const most = Math.max(...sizes);
        const oldest = Math.max(...ownCommits(made.history, edge).map((i) => objectSize(made.history, i)));
        expect(oldest, "the old commits are within the limit by more than a byte").toBeLessThan(most - 1);
        expect(sizes.at(-1), "the last commit is the largest, so the others are written first").toBe(most);

        for (const limit of [most, most - 1]) {
          yield* seeding(
            subject,
            `a limit of ${limit} bytes`,
            made.history,
            settings({ bytes: limit }, longer),
            (seeded) =>
              Effect.gen(function* () {
                const quiet = yield* seeded.fingerprint;
                const place = `${edge.label}, a limit of ${limit} bytes`;

                if (limit === most) {
                  const answer = yield* underTicking(rebasing(seeded, edge), start);
                  yield* expectClean(seeded, made.history, edge, answer, longer, seconds, place);
                } else {
                  expectFailure(
                    yield* failed(underTicking(rebasing(seeded, edge), start), place),
                    Repository.TooLargeToWrite,
                    { most: limit },
                    place,
                  );
                  expect(yield* seeded.fingerprint, `${place}: nothing was written`).toEqual(quiet);
                }
              }),
          );
        }
      }),
    run,
  );

  // Plant: call the wrapped `walk`, so a child span shows: red; annotate the first conflict path, (e) red; leave `kalfa.git.commit`
  // out: red; annotate a message, a name or an email, or a path: red.
  it.effect.prop(
    "S41 the span: each call ends one git.rebase span with the commits it was asked with, how many it made and the last one, or how many paths conflicted, and no child span of a raw call; no attribute holds a message, a name, an email or a path",
    { texture: textureArb },
    ({ texture }) =>
      Effect.gen(function* () {
        const made = rebaseCarrier(texture, CANARY);
        const config = settings({}, { name: `${CANARY}-bot`, email: `${CANARY}-bot@example.test` });

        yield* seeding(subject, "spans", withCanary(made.history), config, (seeded) =>
          Effect.gen(function* () {
            const secrets = [CANARY, ...seeded.hidden];
            const clean = findCase(made, "(a) three commits");
            const nothing = findCase(made, "(b) the commit is reached by the upstream");
            const conflicting = findCase(made, "(e) both change a one-line file to different lines");

            for (const each of [clean, nothing, conflicting]) {
              const ran = yield* traced(Effect.result(rebasing(seeded, each)));
              const place = each.label;
              const args = asked(seeded, each);

              const named = ran.spans.filter((span) => span.name.startsWith("git.")).map((span) => span.name);
              expect(named, `${place}: no span of a raw call`).toEqual(["git.rebase"]);

              const expected: Record<string, unknown> = {
                "vcs.ref.base.revision": args.upstream,
                "vcs.ref.head.revision": args.commit,
                "kalfa.git.onto": args.onto,
              };

              if (each.expected.kind === "conflict") {
                expect(Result.isFailure(ran.answer), `${place}: the rebase conflicts`).toBe(true);
                expectNamedSpan(
                  place,
                  ran.spans,
                  "git.rebase",
                  { ...expected, "kalfa.git.conflicts": each.expected.paths.length },
                  ["kalfa.git.commit"],
                  secrets,
                );
              } else {
                const answer = Result.isSuccess(ran.answer) ? ran.answer.success : [];
                expect(Result.isSuccess(ran.answer), `${place}: the rebase answers`).toBe(true);
                const last = answer.at(-1);

                expectNamedSpan(
                  place,
                  ran.spans,
                  "git.rebase",
                  {
                    ...expected,
                    "kalfa.git.commits": answer.length,
                    ...(last === undefined ? {} : { "kalfa.git.commit": last.id }),
                  },
                  ["kalfa.git.conflicts", ...(last === undefined ? ["kalfa.git.commit"] : [])],
                  secrets,
                );
              }
            }

            expect(
              clean.expected.kind === "commits" ? clean.expected.steps.length : 0,
              "the clean case makes commits",
            ).toBe(3);
          }),
        );
      }),
    run,
  );
};

/** The size of an old commit as stored, with git's empty tree and a parent id of the same length. */
const objectSize = (history: History, i: number): number => {
  const old = history.nodes[i];

  if (old === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return writtenSize({
    tree: TREE_ID,
    parents: old.parents.map(() => TREE_ID),
    author: old.author,
    committer: { name: old.committer.name, email: old.committer.email },
    seconds: old.committer.seconds,
    message: old.message,
  });
};

/** The size of the new commit for old commit `i`: git's empty tree, one parent id of the same length, and the committer given. */
const newSize = (history: History, i: number, committer: Committer, seconds: number): number => {
  const old = history.nodes[i];

  if (old === undefined) {
    throw new Error(`no commit ${i}`);
  }

  return writtenSize({
    tree: TREE_ID,
    parents: [TREE_ID],
    author: old.author,
    committer,
    seconds,
    message: old.message,
  });
};

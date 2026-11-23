// The laws of the merge commit helper (S15 and S16), run on each adapter's store. A runner gives the same `Subject` the
// shared laws of Repository take. The helper is written once over the service, so these laws hold the two adapters to one
// answer: the commit a merge makes, the merges it refuses, the spans it ends. They sit beside RepositoryTest.ts, which is
// `/test`, and not in it: a law of the helper needs the helper's own module, and a runner that did not run them would
// never load it.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import type * as CommitId from "./CommitId.ts";
import {
  CANARY,
  cutShallow,
  committerFrom,
  messageVariants,
  MERGE_CLASSES,
  MESSAGE_CLASSES,
  mergeCarrier,
  signatureVariants,
  textureArb,
  withCanary,
  type FlatSignature,
  type MergeCase,
} from "./History.test-support.ts";
import {
  clockAt,
  conflictPaths,
  cycle,
  encodeCommit,
  expectedWrite,
  expectNamedSpan,
  failed,
  flatAt,
  idAt,
  isTooShort,
  mergeArgs,
  mergedTree,
  numAt,
  readRefsBack,
  seedEach,
  toSignature,
  traced,
  treeAt,
} from "./Laws.test-support.ts";
import * as MergeCommit from "./MergeCommit.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import { settings, type Seeded, type Subject, type SuiteOptions } from "./RepositoryTest.ts";

/** Makes the merge commit of two commits of a seeded store, as a caller does: the helper asks the service for the rest. */
const merging = (
  seeded: Seeded,
  merge: {
    readonly ours: CommitId.CommitId;
    readonly theirs: CommitId.CommitId;
    readonly author: FlatSignature;
    readonly message: string;
  },
) =>
  MergeCommit.mergeCommit({ ...merge, author: toSignature(merge.author) }).pipe(
    Effect.provideService(Repository.Repository, seeded.repository),
  );

export const suite = (name: string, subject: Subject, options: SuiteOptions): void => {
  const run = { arbitrary: { runs: options.runs, seed: 119120 }, timeout: options.timeout };

  describe(`${name}: the laws of the merge commit helper`, () => {
    // Plant: put the parents in the other order; take the first of several bases, so the criss-cross merges; delete the
    // check for no base, so unrelated roots merge; give the merge ours' tree whatever the sides hold, or make no commit
    // when theirs is already in ours; take the author from the settings; drop the last newline of the message; move
    // `refs/heads/main` to the merge commit; read no history, so a shallow store merges.
    it.effect.prop(
      "S15 merge commit: a clean merge makes a commit with parents ours then theirs, the merge's tree, the caller's author and message byte for byte and the settings' committer, one whose theirs ours reaches still makes one, unrelated roots and a criss-cross are refused, a conflict is a Conflict, a shallow store is HistoryTooShort, and no ref moves",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const made = mergeCarrier(texture);

          expect(
            made.cases.map((each) => each.label),
            "the generator reaches every merge class",
          ).toEqual([...MERGE_CLASSES]);

          const committer = committerFrom(flatAt(texture, 4));
          const word = texture.words[0] ?? "w";
          const messages = messageVariants(word).filter(([label]) => label !== "a NUL");
          const authors = signatureVariants(flatAt(texture, 1));
          expect(messages.length, "every message class but the NUL").toBe(MESSAGE_CLASSES.length - 1);
          const shallow = cutShallow(made.history);

          if (shallow === undefined) {
            return yield* Effect.die("the carrier has no commit with a parent");
          }

          yield* seedEach(
            subject,
            [{ label: "merges", history: made.history }],
            settings({}, committer),
            (seeded, shape) =>
              Effect.gen(function* () {
                const { ids, trees, repository } = seeded;
                const parents = (ours: number, theirs: number) => [idAt(ids, ours), idAt(ids, theirs)];

                // Each merge class, with a message and an author of its own: a clean one makes the commit, a conflict does not.
                for (const [k, each] of made.cases.entries()) {
                  const place = `${shape.label}, ${each.label}`;
                  const seconds = 1_000_000 + numAt(texture, k);
                  const [, message] = cycle(messages, k);
                  const [, author] = cycle(authors, k);
                  const merge = { ours: idAt(ids, each.ours), theirs: idAt(ids, each.theirs), author, message };
                  yield* clockAt(seconds, texture, k + 20);

                  if (each.expected.kind === "clean") {
                    const commit = yield* merging(seeded, merge);

                    const expected = expectedWrite(
                      commit.id,
                      { tree: mergedTree(seeded, each), parents: parents(each.ours, each.theirs), author, message },
                      committer,
                      seconds,
                    );

                    expect(encodeCommit(commit), `${place}: the merge commit`).toEqual(expected);
                    expect(encodeCommit(yield* repository.readCommit(commit.id)), `${place}: read back`).toEqual(
                      expected,
                    );
                  } else {
                    expectFailure(
                      yield* failed(merging(seeded, merge), place),
                      Repository.Conflict,
                      { paths: conflictPaths(each) },
                      place,
                    );
                  }
                }

                // Theirs is already in ours: the merge still makes a commit, with ours' tree.
                const { inside } = made;
                const seconds = 2_000_000 + numAt(texture, 70);
                yield* clockAt(seconds, texture, 71);
                const author = flatAt(texture, 3);

                const reached = yield* merging(seeded, {
                  ours: idAt(ids, inside.ours),
                  theirs: idAt(ids, inside.theirs),
                  author,
                  message: `${word}\n`,
                });

                expect(
                  encodeCommit(reached),
                  "theirs already in ours: a commit with ours' tree and both parents",
                ).toEqual(
                  expectedWrite(
                    reached.id,
                    {
                      tree: treeAt(trees, inside.ours),
                      parents: parents(inside.ours, inside.theirs),
                      author,
                      message: `${word}\n`,
                    },
                    committer,
                    seconds,
                  ),
                );

                // Refused before anything is merged, whichever commit is ours: nothing is written.
                const quiet = yield* seeded.fingerprint;

                for (const [label, pair] of [
                  ["two unrelated roots", made.unrelated],
                  ["a criss-cross", made.criss],
                ] as const) {
                  for (const swapped of [false, true]) {
                    const place = `${label}${swapped ? ", ours and theirs swapped" : ""}`;
                    const [ours, theirs] = swapped ? [pair.theirs, pair.ours] : [pair.ours, pair.theirs];

                    const refusal = yield* failed(
                      merging(seeded, { ours: idAt(ids, ours), theirs: idAt(ids, theirs), author, message: "m\n" }),
                      place,
                    );

                    if (label === "two unrelated roots") {
                      expectFailure(refusal, MergeCommit.UnrelatedHistories, {}, place);
                    } else {
                      expectFailure(
                        refusal,
                        MergeCommit.SeveralMergeBases,
                        { bases: made.criss.bases.map((i) => idAt(ids, i)).toSorted() },
                        place,
                      );
                    }

                    expect(yield* seeded.fingerprint, `${place}: nothing was written`).toEqual(quiet);
                  }
                }

                yield* readRefsBack(seeded, made.history, `${shape.label}: after every merge`);
              }),
          );

          // A shallow store cannot know its merge bases: the merge fails with HistoryTooShort and writes nothing.
          yield* seedEach(
            subject,
            [{ label: "merges, shallow", history: shallow }],
            settings({}, committer),
            (seeded) =>
              Effect.gen(function* () {
                const first: MergeCase | undefined = made.cases[0];

                if (first === undefined) {
                  return yield* Effect.die("the carrier holds no merge");
                }

                const before = yield* seeded.fingerprint;

                const error = yield* failed(
                  merging(seeded, {
                    ours: idAt(seeded.ids, first.ours),
                    theirs: idAt(seeded.ids, first.theirs),
                    author: flatAt(texture, 1),
                    message: "m\n",
                  }),
                  "a shallow store",
                );

                expect(isTooShort(error), "a shallow store: HistoryTooShort").toBe(true);
                expect(yield* seeded.fingerprint, "a shallow store: nothing was written").toEqual(before);
              }),
          );
        }),
      run,
    );

    // Plant: name the span `Repository.mergeCommit`; leave `kalfa.git.commit` out; annotate the caller's message, name or
    // email, the settings' committer or a path.
    it.effect.prop(
      "S16 merge commit spans: mergeCommit ends one span named git.mergeCommit with the two commits and the commit made, and no span of the merge holds a message, a name, an email, a path or the repository path",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const merging_ = mergeCarrier(texture, CANARY);
          const config = settings({}, { name: `${CANARY}-bot`, email: `${CANARY}-bot@example.test` });

          yield* seedEach(
            subject,
            [{ label: "merges", history: withCanary(merging_.history) }],
            config,
            (seeded, shape) =>
              Effect.gen(function* () {
                const secrets = [CANARY, ...seeded.hidden];
                const clean = merging_.cases.find((each) => each.expected.kind === "clean");

                if (clean === undefined) {
                  return yield* Effect.die("the carrier holds no clean merge");
                }

                const { ours, theirs } = mergeArgs(seeded, clean, false);

                const author = {
                  ...flatAt(texture, 1),
                  name: `${CANARY}-writer`,
                  email: `${CANARY}-writer@example.test`,
                };

                const merged = yield* traced(
                  Effect.result(merging(seeded, { ours, theirs, author, message: `${CANARY}-merge\n` })),
                );

                expect(Result.isSuccess(merged.answer), `${shape.label}: the merge commit was made`).toBe(true);

                expectNamedSpan(
                  `${shape.label}, mergeCommit`,
                  merged.spans,
                  "git.mergeCommit",
                  {
                    "vcs.ref.base.revision": ours,
                    "vcs.ref.head.revision": theirs,
                    "kalfa.git.commit": Result.isSuccess(merged.answer) ? merged.answer.success.id : "",
                  },
                  [],
                  secrets,
                );
              }),
          );
        }),
      run,
    );
  });
};

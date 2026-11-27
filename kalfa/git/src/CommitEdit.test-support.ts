// The laws of the commit edit helper (S34 and S35), run on each adapter's store. A runner gives the same `Subject` the shared laws of
// Repository take. The helper is written once over the service, so these laws hold the two adapters to one answer: the commit an
// edit makes, the edits it refuses, the spans it ends. They sit beside RepositoryTest.ts, which is `/test`, and not in it: a law of
// the helper needs the helper's own module, and a runner that did not run them would never load it.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import * as CommitEdit from "./CommitEdit.ts";
import type * as CommitId from "./CommitId.ts";
import {
  CANARY,
  committerFrom,
  editModel,
  everyTreeEditClassNames,
  messageVariants,
  MESSAGE_CLASSES,
  missingId,
  signatureVariants,
  textureArb,
  treeEditCarrier,
  withCanary,
  type ChangeList,
  type FlatSignature,
  type TreeEditCarrier,
  type TreeEditCase,
} from "./History.test-support.ts";
import {
  clockAt,
  commitIdFrom,
  cycle,
  editFrom,
  encodeCommit,
  expectedWrite,
  expectNamedSpan,
  failed,
  flatAt,
  idAt,
  readRefsBack,
  seedEach,
  toSignature,
  traced,
  treeAt,
} from "./Laws.test-support.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import { settings, type Seeded, type Subject, type SuiteOptions } from "./RepositoryTest.ts";

/** Makes the commit of an edit, as a caller does: the helper asks the service for the rest. */
const committing = (
  seeded: Seeded,
  edit: {
    readonly parent: CommitId.CommitId;
    readonly changes: Repository.Edit;
    readonly author: FlatSignature;
    readonly message: string;
  },
) =>
  CommitEdit.commitEdit({ ...edit, author: toSignature(edit.author) }).pipe(
    Effect.provideService(Repository.Repository, seeded.repository),
  );

/** Why a commit of an edit fails: every failure `commitEdit` names. */
export type CommitFailure = Effect.Error<ReturnType<typeof CommitEdit.commitEdit>>;

/** The edit's failure, as `editTree` gives it, under a limit on a file's size. */
const expectRefusal = (
  place: string,
  error: CommitFailure,
  carrier: TreeEditCarrier,
  each: TreeEditCase,
  limit: number,
): void => {
  const model = editModel(carrier.history.nodes[each.base]?.files ?? [], each.changes, limit);

  if (model.kind === "too-large") {
    expectFailure(error, Repository.FileTooLarge, { path: model.path, most: model.most }, place);
  } else if (model.kind === "not-a-file") {
    expectFailure(error, Repository.NotAFile, { path: model.path, holds: model.holds }, place);
  } else if (model.kind === "in-the-way") {
    expectFailure(error, Repository.PathInTheWay, { path: model.path, other: model.other }, place);
  } else {
    expect.unreachable(`${place}: the edit is no refusal`);
  }
};

export const suite = (name: string, subject: Subject, options: SuiteOptions): void => {
  const run = { arbitrary: { runs: options.runs, seed: 119120 }, timeout: options.timeout };

  describe(`${name}: the laws of the commit edit helper`, () => {
    // Plant: take the committer from the author, (r) red; give the commit no parent, (r) red; write the commit before the no-change check,
    // (s) red; check the message before no change, (s) red; read the parent after `editTree`, (t) red; move `refs/heads/main` to the
    // commit; drop the last newline of the message; give an edit that is refused a commit.
    it.effect.prop(
      "S34 commit an edit: a real change makes a commit with parents [parent], editTree's tree, the caller's author and message byte for byte and the settings' committer at the clock's second, and no ref moves; no change fails NoChange and leaves the store as it was, before a NUL in the message is checked; an unknown parent fails NoSuchCommit before the size check; a refused edit and a NUL in the message pass through",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = treeEditCarrier(texture);
          expect(everyTreeEditClassNames(carrier), "the generator reaches every edit class").toBe(true);

          const committer = committerFrom(flatAt(texture, 4));
          const word = texture.words[0] ?? "w";
          const messages = messageVariants(word).filter(([label]) => label !== "a NUL");
          const authors = signatureVariants(flatAt(texture, 1));
          expect(messages.length, "every message class but the NUL").toBe(MESSAGE_CLASSES.length - 1);
          const whole = settings({}, committer);

          yield* seedEach(subject, [{ label: "edits", history: carrier.history }], whole, (seeded, shape) =>
            Effect.gen(function* () {
              const { ids, trees, repository } = seeded;
              let made = 0;
              let still = 0;
              let refusals = 0;

              for (const [k, each] of carrier.cases.entries()) {
                const place = `${shape.label}, ${each.label}`;
                const seconds = 1_000_000 + k;
                const [, message] = cycle(messages, k);
                const [, author] = cycle(authors, k);
                const parent = idAt(ids, each.base);
                yield* clockAt(seconds, texture, k + 20);

                if (each.intent === "tree" && k % 4 === 0) {
                  made += 1;

                  const commit = yield* committing(seeded, {
                    parent,
                    changes: editFrom(each.changes, k % 2 === 1),
                    author,
                    message,
                  });

                  const expected = expectedWrite(
                    commit.id,
                    { tree: treeAt(trees, each.node ?? each.base), parents: [parent], author, message },
                    committer,
                    seconds,
                  );

                  expect(encodeCommit(commit), `${place}: the commit`).toEqual(expected);
                  expect(encodeCommit(yield* repository.readCommit(commit.id)), `${place}: read back`).toEqual(
                    expected,
                  );
                } else if (each.intent === "no change" && k % 2 === 0) {
                  // Nothing changes, so nothing is written, and the NUL in the message is never looked at.
                  still += 1;
                  const before = yield* seeded.fingerprint;

                  for (const text of [message, `${word}\u0000${word}\n`]) {
                    const error = yield* failed(
                      committing(seeded, { parent, changes: editFrom(each.changes, false), author, message: text }),
                      place,
                    );

                    expectFailure(error, CommitEdit.NoChange, {}, `${place}: NoChange`);
                    expect(yield* seeded.fingerprint, `${place}: nothing was written`).toEqual(before);
                  }
                } else if ((each.intent === "not-a-file" || each.intent === "in-the-way") && k % 2 === 0) {
                  // A refusal of the edit is the commit's refusal, whatever the message.
                  refusals += 1;
                  const before = yield* seeded.fingerprint;

                  const error = yield* failed(
                    committing(seeded, { parent, changes: editFrom(each.changes, false), author, message }),
                    place,
                  );

                  expectRefusal(place, error, carrier, each, whole.limits.blob);
                  expect(yield* seeded.fingerprint, `${place}: nothing was written`).toEqual(before);
                }
              }

              expect(made, "the generator reaches edits that change").toBeGreaterThan(4);
              expect(still, "the generator reaches edits that change nothing").toBeGreaterThan(3);
              expect(refusals, "the generator reaches refused edits").toBeGreaterThan(3);

              // A real change with a NUL in the message is NulInMessage, and no ref moves.
              const changing = carrier.cases.find((each) => each.intent === "tree");

              if (changing === undefined) {
                return yield* Effect.die("the generator reaches no edit that changes");
              }

              const nul = yield* failed(
                committing(seeded, {
                  parent: idAt(ids, changing.base),
                  changes: editFrom(changing.changes, false),
                  author: flatAt(texture, 1),
                  message: `${word}\u0000${word}\n`,
                }),
                "a NUL in the message",
              );

              expectFailure(nul, Repository.NulInMessage, {}, "a real change with a NUL in the message");

              // An id the store lacks, or a tree's id, is NoSuchCommit naming it, and with a content over the limit still.
              for (const absent of [commitIdFrom(missingId(texture, 5, ids)), commitIdFrom(treeAt(trees, 0))]) {
                const error = yield* failed(
                  committing(seeded, {
                    parent: absent,
                    changes: editFrom(changing.changes, false),
                    author: flatAt(texture, 1),
                    message: "m\n",
                  }),
                  `an unknown parent ${absent}`,
                );

                expectFailure(error, Repository.NoSuchCommit, { id: absent }, `an unknown parent ${absent}`);
              }

              yield* readRefsBack(seeded, carrier.history, `${shape.label}: after every commit`);
            }),
          );

          // Under a limit the largest content passes, the parent is looked up first: an unknown parent with a content over the limit is
          // NoSuchCommit, and a known one is FileTooLarge.
          const tight = carrier.cases.find((each) => each.tight !== undefined);
          const limit = tight?.tight;

          if (tight === undefined || limit === undefined) {
            return yield* Effect.die("the generator reaches no case that is too large first");
          }

          yield* seedEach(
            subject,
            [{ label: "edits, a tight limit", history: carrier.history }],
            settings({ blob: limit }, committer),
            (seeded) =>
              Effect.gen(function* () {
                const absent = commitIdFrom(missingId(texture, 6, seeded.ids));
                const before = yield* seeded.fingerprint;

                const unknown = yield* failed(
                  committing(seeded, {
                    parent: absent,
                    changes: editFrom(tight.changes, false),
                    author: flatAt(texture, 1),
                    message: "m\n",
                  }),
                  "an unknown parent",
                );

                expectFailure(
                  unknown,
                  Repository.NoSuchCommit,
                  { id: absent },
                  "an unknown parent with a content over the limit",
                );

                const large = yield* failed(
                  committing(seeded, {
                    parent: idAt(seeded.ids, tight.base),
                    changes: editFrom(tight.changes, false),
                    author: flatAt(texture, 1),
                    message: "m\n",
                  }),
                  "a content over the limit",
                );

                expectRefusal("a known parent with a content over the limit", large, carrier, tight, limit);
                expect(yield* seeded.fingerprint, "nothing was written").toEqual(before);
              }),
          );
        }),
      run,
    );

    // Plant: name the span `git.commit`; annotate a changed path, a changed content, the message, a name or an email, the committer or the
    // repository path; leave `kalfa.git.commit` out, so a made commit has none; leave `kalfa.git.changes` out.
    it.effect.prop(
      "S35 commit edit spans: commitEdit ends one span named git.commitEdit with the parent, how many changes and the commit made, and no span of the edit holds a path, a content, a message, a name, an email or the repository path",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = treeEditCarrier(texture);
          const config = settings({}, { name: `${CANARY}-bot`, email: `${CANARY}-bot@example.test` });
          const history = withCanary(carrier.history);
          const encoder = new TextEncoder();

          // Every changed path and every content holds the canary, so a span that holds any of them is seen: an edit that adds two files
          // and one that removes a file that is not there.
          const changing: ChangeList = [
            [`${CANARY}-edit/${CANARY}-new`, encoder.encode(`${CANARY}-content\n`)],
            [`${CANARY}-top`, encoder.encode(`${CANARY}-more\n`)],
          ];

          const still: ChangeList = [[`${CANARY}-nothing`, "absent"]];

          yield* seedEach(subject, [{ label: "edits", history }], config, (seeded, shape) =>
            Effect.gen(function* () {
              const secrets = [CANARY, ...seeded.hidden];

              const author = {
                ...flatAt(texture, 1),
                name: `${CANARY}-writer`,
                email: `${CANARY}-writer@example.test`,
              };

              const parent = idAt(seeded.ids, carrier.bases.mixed);

              const made = yield* traced(
                Effect.result(
                  committing(seeded, {
                    parent,
                    changes: editFrom(changing, false),
                    author,
                    message: `${CANARY}-edit\n`,
                  }),
                ),
              );

              expect(Result.isSuccess(made.answer), `${shape.label}: the commit was made`).toBe(true);

              expectNamedSpan(
                `${shape.label}, commitEdit`,
                made.spans,
                "git.commitEdit",
                {
                  "vcs.ref.base.revision": parent,
                  "kalfa.git.changes": changing.length,
                  "kalfa.git.commit": Result.isSuccess(made.answer) ? made.answer.success.id : "",
                },
                [],
                secrets,
              );

              // An edit that changes nothing is NoChange: the span ends with the parent and the count and no commit.
              const quiet = yield* traced(
                Effect.result(
                  committing(seeded, { parent, changes: editFrom(still, false), author, message: `${CANARY}-edit\n` }),
                ),
              );

              expect(Result.isFailure(quiet.answer), `${shape.label}: no change fails`).toBe(true);

              expectNamedSpan(
                `${shape.label}, commitEdit with no change`,
                quiet.spans,
                "git.commitEdit",
                { "vcs.ref.base.revision": parent, "kalfa.git.changes": still.length },
                ["kalfa.git.commit"],
                secrets,
              );
            }),
          );
        }),
      run,
    );
  });
};

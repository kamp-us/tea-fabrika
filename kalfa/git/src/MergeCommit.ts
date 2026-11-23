/**
 * Makes a merge commit: the commit that joins two lines of history, written with no working copy.
 *
 * **Details**
 *
 * It is written once over the `Repository` service, so every adapter makes the same commit. It merges the two commits' trees over their merge base and writes a commit on the result with `ours` as the first parent and `theirs` as the second. It moves no ref: the caller points one at the commit, with `moveRef`, only if it is still where the caller read it.
 */
import { Effect, Schema } from "effect";
import type * as Commit from "./Commit.ts";
import { CommitId } from "./CommitId.ts";
import * as Repository from "./Repository.ts";

/**
 * The two commits share no history, so there is no merge base to merge over.
 *
 * @category errors
 */
export class UnrelatedHistories extends Schema.TaggedError<UnrelatedHistories, { readonly brand: unique symbol }>()(
  "UnrelatedHistories",
  {},
) {}

/**
 * The two commits have more than one best common ancestor, a criss-cross, so the merge is not made.
 *
 * **Details**
 *
 * git's own merge first merges the bases into a virtual one. The memory adapter could not match what git writes there when the bases conflict, so the helper refuses. `bases` holds the bases, sorted by id.
 *
 * @category errors
 */
export class SeveralMergeBases extends Schema.TaggedError<SeveralMergeBases, { readonly brand: unique symbol }>()(
  "SeveralMergeBases",
  { bases: Schema.Array(CommitId) },
) {}

/**
 * Writes the merge commit of `ours` and `theirs` and answers it.
 *
 * **When to use**
 *
 * Use to build a candidate for a change request: merge the change's tip into the line it lands on, then move a ref to the answer.
 *
 * **Details**
 *
 * `ours` is the line the merge is made on, and `theirs` is the line that joins it. The commit has parents `[ours, theirs]`, the merged tree, the caller's `author` and `message` as given, and the settings' committer at the clock's time. A `theirs` that `ours` already reaches still makes a commit, on `ours`' tree. A merge with no common history fails `UnrelatedHistories`, one with several merge bases fails `SeveralMergeBases`, and a path changed on both sides fails `Conflict`. Nothing is written when it fails.
 *
 * @category constructors
 */
export const mergeCommit = Effect.fn("git.mergeCommit")(function* (merge: {
  readonly ours: CommitId;
  readonly theirs: CommitId;
  readonly author: Commit.Signature;
  readonly message: string;
}) {
  yield* Effect.annotateCurrentSpan({ "vcs.ref.base.revision": merge.ours, "vcs.ref.head.revision": merge.theirs });
  const repo = yield* Repository.Repository;
  const bases = yield* repo.mergeBases(merge.ours, merge.theirs);
  const [mergeBase, ...others] = bases;

  if (mergeBase === undefined) {
    return yield* new UnrelatedHistories();
  }

  if (others.length > 0) {
    return yield* new SeveralMergeBases({ bases });
  }

  const tree = yield* repo.mergeTrees({ mergeBase, ours: merge.ours, theirs: merge.theirs });

  const commit = yield* repo.writeCommit({
    tree,
    parents: [merge.ours, merge.theirs],
    author: merge.author,
    message: merge.message,
  });

  yield* Effect.annotateCurrentSpan({ "kalfa.git.commit": commit.id });

  return commit;
});

/**
 * Commits an edit: the commit that replaces or removes files of one commit, written with no working copy.
 *
 * **Details**
 *
 * It is written once over the `Repository` service, as `MergeCommit.mergeCommit` is, so every adapter makes the same commit and the committer rule stays in `writeCommit`. It moves no ref: the caller points one at the commit, with `moveRef`, only if it is still where the caller read it.
 */
import { Effect, Schema } from "effect";
import type * as Commit from "./Commit.ts";
import type { CommitId } from "./CommitId.ts";
import * as Repository from "./Repository.ts";

/**
 * The edit changes no file, so there is nothing to commit.
 *
 * @category errors
 */
export class NoChange extends Schema.TaggedError<NoChange, { readonly brand: unique symbol }>()("NoChange", {}) {}

/**
 * Writes the commit of an edit on `parent` and answers it.
 *
 * **When to use**
 *
 * Use to adopt a live value as a new commit: read a file at main, then commit the changed file on top of main and move a ref to the answer.
 *
 * **Details**
 *
 * The commit has one parent, the tree `editTree` makes, the caller's `author` and `message` as given, and the settings' committer at the clock's time. It fails `NoChange`, and writes nothing, when the edit changes no file: no blob is new and no folder is made again. `NoChange` comes before the message is checked, so a NUL in the message of an edit that changes nothing is still `NoChange`. An edit `editTree` refuses fails with its error. A failure after `editTree`, such as a NUL in the message, can leave the edit's unreachable objects behind, as a refused merge commit can.
 *
 * @category constructors
 */
export const commitEdit = Effect.fn("git.commitEdit")(function* (edit: {
  readonly parent: CommitId;
  readonly changes: Repository.Edit;
  readonly message: string;
  readonly author: Commit.Signature;
}) {
  yield* Effect.annotateCurrentSpan({ "vcs.ref.base.revision": edit.parent, "kalfa.git.changes": edit.changes.size });
  const repo = yield* Repository.Repository;
  const parent = yield* repo.readCommit(edit.parent);
  const tree = yield* repo.editTree(edit.parent, edit.changes);

  if (tree === parent.tree) {
    return yield* new NoChange();
  }

  const commit = yield* repo.writeCommit({
    tree,
    parents: [edit.parent],
    author: edit.author,
    message: edit.message,
  });

  yield* Effect.annotateCurrentSpan({ "kalfa.git.commit": commit.id });

  return commit;
});

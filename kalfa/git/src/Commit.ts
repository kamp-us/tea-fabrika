/**
 * What a commit holds: its id, its tree, its parents in git's order, who wrote it and who made it, each with a time, and its message.
 *
 * **Details**
 *
 * The values keep what git wrote, so nothing is lost on the way through: the offset of a time as text (`-0000` and `+0000` are two values) and the message byte for byte. A commit names its tree by id, and nothing else here reads the tree's files.
 */
import { Schema } from "effect";
import { CommitId } from "./CommitId.ts";
import { TreeId } from "./Tree.ts";

/**
 * Schema for a time zone offset as git writes it, `+0530`: a sign, two digits of hours and two of minutes.
 *
 * **Details**
 *
 * It is kept as text, because `-0000` and `+0000` differ, and a commit's id depends on which one.
 *
 * @category models
 */
export const Offset = Schema.String.check(Schema.isPattern(/^[+-][0-9]{2}[0-5][0-9]$/));

/**
 * Schema for a time as git writes it: whole seconds since 1970 and an offset.
 *
 * @category models
 */
export const Time = Schema.Struct({
  seconds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  offset: Offset,
});

/**
 * Schema for a name in a signature: what git's commit format can hold, so no "<", ">", line break or NUL.
 *
 * **Details**
 *
 * It may be empty, and it keeps a space at either end.
 *
 * @category models
 */
export const Name = Schema.String.check(Schema.isPattern(/^[^<>\n\0]*$/));

/**
 * Schema for an email in a signature: what git's commit format can hold, so no ">", line break or NUL.
 *
 * @category models
 */
export const Email = Schema.String.check(Schema.isPattern(/^[^>\n\0]*$/));

/**
 * Who wrote a commit, or who made it, with a time: a name, an email and the time with its offset.
 *
 * **Details**
 *
 * It is git's own word for a commit's author and committer line. It is not a cryptographic signature. A name or an email may be empty, and a name keeps a space at either end.
 *
 * @category models
 */
export class Signature extends Schema.Class<Signature, { readonly brand: unique symbol }>("@kalfa/git/Signature")({
  name: Name,
  email: Email,
  at: Time,
}) {}

/**
 * One commit as git holds it.
 *
 * **Details**
 *
 * `tree` is the files of the commit, by its id, git's first header line. `parents` are in git's order, so a merge commit's first parent is the line it was made on. `message` is the text after the blank line, with no trim and its trailing newline kept.
 *
 * @category models
 */
export class Commit extends Schema.Class<Commit, { readonly brand: unique symbol }>("@kalfa/git/Commit")({
  id: CommitId,
  tree: TreeId,
  parents: Schema.Array(CommitId),
  author: Signature,
  committer: Signature,
  message: Schema.String,
}) {}

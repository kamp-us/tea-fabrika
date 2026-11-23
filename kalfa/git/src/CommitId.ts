/**
 * What a commit id is: the name git gives a commit from its content, as 40 lowercase hex digits.
 *
 * **Details**
 *
 * The length lives in one place, `FORMATS`. A sha-256 repository adds its length there and nothing else changes.
 */
import { Result, Schema } from "effect";

const FORMATS = { sha1: 40 } as const;

const ID = new RegExp(
  `^(?:${Object.values(FORMATS)
    .map((length) => `[0-9a-f]{${length}}`)
    .join("|")})$`,
);

/**
 * Schema for a commit id: lowercase hex of a length git uses, with nothing around it.
 *
 * **Details**
 *
 * Only lowercase is accepted, since git prints lowercase and one form makes equality plain string equality. The text is never trimmed.
 *
 * @category models
 */
export const CommitId = Schema.String.check(Schema.isPattern(ID)).pipe(Schema.brand("@kalfa/git/CommitId"));

export type CommitId = typeof CommitId.Type;

/**
 * The failure of `from`: the text is not a commit id.
 *
 * @category errors
 */
export class BadCommitId extends Schema.TaggedError<BadCommitId, { readonly brand: unique symbol }>()("BadCommitId", {
  text: Schema.String,
}) {}

/**
 * Reads a commit id from text.
 *
 * **When to use**
 *
 * Use when the text comes from outside, such as a person or a file.
 *
 * @category constructors
 */
export const from = (text: string): Result.Result<CommitId, BadCommitId> =>
  Result.mapError(Schema.decodeUnknownResult(CommitId)(text), () => new BadCommitId({ text }));

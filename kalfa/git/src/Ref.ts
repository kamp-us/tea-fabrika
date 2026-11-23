/**
 * What a ref is: a full name that points at one commit, and the branch names that sit under `refs/heads/`.
 *
 * **Details**
 *
 * A name is checked by git's own rules for `git check-ref-format`, written out here. A checked name holds well-formed text, so it always has UTF-8 bytes.
 */
import { Option, Result, Schema } from "effect";
import { CommitId } from "./CommitId.ts";

const HEADS = "refs/heads/";

// Characters git refuses anywhere in a name: space, "~ ^ : ? * [ \", DEL and every control character.
const FORBIDDEN = new Set([" ", "~", "^", ":", "?", "*", "[", "\\", "\u007F"]);

const isForbidden = (character: string): boolean => FORBIDDEN.has(character) || (character.codePointAt(0) ?? 0) < 0x20;

// A lone surrogate has no UTF-8 bytes. A pair is one code point and never matches.
const LONE_SURROGATE = /\p{Surrogate}/u;

// A part of a name: not empty, not "." or "..", not starting with ".", not ending ".lock".
const isPart = (part: string): boolean =>
  part !== "" && !part.startsWith(".") && !part.endsWith(".lock") && ![...part].some(isForbidden);

const isRefName = (text: string): boolean => {
  const parts = text.split("/");

  return (
    parts[0] === "refs" &&
    parts.length >= 2 &&
    parts.every(isPart) &&
    !text.includes("..") &&
    !text.includes("@{") &&
    !text.endsWith(".") &&
    !LONE_SURROGATE.test(text)
  );
};

const isBranchName = (text: string): boolean =>
  isRefName(`${HEADS}${text}`) && !text.startsWith("-") && text !== "HEAD";

/**
 * Schema for a ref's full name, such as `refs/heads/main`, by the rules of `git check-ref-format`.
 *
 * **Details**
 *
 * The name starts with `refs/` and has two parts or more. No part is empty, `.` or `..`, starts with `.` or ends with `.lock`. The name has no `..`, `@{` or `//`, does not end with `/` or `.`, and holds no control character, space, `~ ^ : ? * [ \` or lone surrogate.
 *
 * @category models
 */
export const RefName = Schema.String.check(Schema.makeFilter(isRefName, { title: "a git ref name" })).pipe(
  Schema.brand("@kalfa/git/RefName"),
);

export type RefName = typeof RefName.Type;

/**
 * Schema for a branch's own name, the text after `refs/heads/`, such as `main`.
 *
 * **Details**
 *
 * With `refs/heads/` in front it is a `RefName`. It does not start with `-` and is not `HEAD`.
 *
 * @category models
 */
export const BranchName = Schema.String.check(Schema.makeFilter(isBranchName, { title: "a git branch name" })).pipe(
  Schema.brand("@kalfa/git/BranchName"),
);

export type BranchName = typeof BranchName.Type;

/**
 * A name that points at one commit.
 *
 * @category models
 */
export class Ref extends Schema.Class<Ref, { readonly brand: unique symbol }>("@kalfa/git/Ref")({
  name: RefName,
  commit: CommitId,
}) {}

/**
 * The failure of `from`: the text is not a ref name.
 *
 * @category errors
 */
export class BadRefName extends Schema.TaggedError<BadRefName, { readonly brand: unique symbol }>()("BadRefName", {
  text: Schema.String,
}) {}

/**
 * The failure of `branch`: the text is not a branch name.
 *
 * @category errors
 */
export class BadBranchName extends Schema.TaggedError<BadBranchName, { readonly brand: unique symbol }>()(
  "BadBranchName",
  { text: Schema.String },
) {}

/**
 * Reads a ref name from text.
 *
 * @category constructors
 */
export const from = (text: string): Result.Result<RefName, BadRefName> =>
  Result.mapError(Schema.decodeUnknownResult(RefName)(text), () => new BadRefName({ text }));

/**
 * Reads a branch name from text.
 *
 * @category constructors
 */
export const branch = (text: string): Result.Result<BranchName, BadBranchName> =>
  Result.mapError(Schema.decodeUnknownResult(BranchName)(text), () => new BadBranchName({ text }));

/**
 * The ref of a branch: `main` is `refs/heads/main`.
 *
 * **Details**
 *
 * A branch named like a ref, `refs/heads/x`, has the ref `refs/heads/refs/heads/x`.
 *
 * @category conversions
 */
export const toRef = (name: BranchName): RefName => Schema.decodeSync(RefName)(`${HEADS}${name}`);

/**
 * The branch a ref names, or none when the ref sits outside `refs/heads/` or its rest cannot be a branch name.
 *
 * **Details**
 *
 * Only the first `refs/heads/` is a prefix.
 *
 * @category conversions
 */
export const fromRef = (name: RefName): Option.Option<BranchName> =>
  name.startsWith(HEADS)
    ? Option.getSuccess(Schema.decodeUnknownResult(BranchName)(name.slice(HEADS.length)))
    : Option.none();

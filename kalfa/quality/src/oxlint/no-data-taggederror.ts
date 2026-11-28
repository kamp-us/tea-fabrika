/**
 * Bans `class ... extends Data.TaggedError(...)` and asks for `Schema.TaggedError`.
 *
 * An error class is a `Schema.TaggedError`, so it is a schema that can be encoded, decoded and annotated;
 * `Data.TaggedError` has nowhere to put an annotation. The ban applies to every error class.
 *
 * It matches the member `Data.TaggedError` (the extends clause is a call `Data.TaggedError("Tag")<Shape>`), the stable
 * shape across its arity and type-argument variants, in values and in types.
 */
import type { CreateRule } from "@oxlint/plugins";
import { banNames } from "./internal/Syntax.ts";

/**
 * Refuses `Data.TaggedError`, in values and in types.
 *
 * @category rules
 */
export const noDataTaggederror: CreateRule = {
  create: banNames((id) => ({
    "Data.TaggedError": `\`class ... extends Data.TaggedError\` is banned: an error is a \`Schema.TaggedError\`, so it is a schema that can be encoded, decoded and annotated. Fix: \`class MyError extends Schema.TaggedError<MyError>()('MyError', { ...fields }) {}\`. Exception: // oxlint-disable-next-line ${id} -- <reason>.`,
  })),
};

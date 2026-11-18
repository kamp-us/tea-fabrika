/**
 * tea adds this failure to every settled error: a reply whose value fails its own schema. The shape
 * is tea's `MalformedResult`, written once here for every program that declares its answers.
 */
import * as Schema from "effect/Schema";

/**
 * The `malformed_result` error a Cmd's settled answer can carry.
 *
 * @category schemas
 */
export const Malformed = Schema.TaggedStruct("malformed_result", {
  issues: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
});

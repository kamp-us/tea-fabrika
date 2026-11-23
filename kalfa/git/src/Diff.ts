/**
 * What two commits differ by: the name of that change, a patch id.
 *
 * **Details**
 *
 * A patch id is comparable only with ids the same adapter gave. `/process` takes its ids from git's own `patch-id` and `/memory` hashes the change itself, so the two never match.
 */
import { Schema } from "effect";
import { OBJECT_ID } from "./internal/object.ts";

/**
 * Schema for a patch id: the name of a change, as lowercase hex with nothing around it.
 *
 * **Details**
 *
 * Two changes have one patch id when they add and remove the same lines, each with its own line end, at the same paths, and make the same mode changes. Where a line sits and the lines around it do not count, and whitespace does.
 *
 * @category models
 */
export const PatchId = Schema.String.check(Schema.isPattern(OBJECT_ID)).pipe(Schema.brand("@kalfa/git/PatchId"));

export type PatchId = typeof PatchId.Type;

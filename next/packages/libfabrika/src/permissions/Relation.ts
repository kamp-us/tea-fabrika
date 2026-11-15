/**
 * Relation rows: every permission fact as one ledger row `(subject, relation, object)`, on
 * Zanzibar's model (0526).
 *
 * @stability unstable
 */
import { Schema } from "effect";
import type { TuplesTypeId } from "./internal/relationsTable.ts";

/**
 * The ledger stream the relation rows live on. Only the brain's own rows count.
 *
 * @stability unstable
 * @category constants
 */
export const STREAM = "permissions/relations";

const Tuple = { subject: Schema.NonEmptyString, relation: Schema.NonEmptyString, object: Schema.NonEmptyString };

/**
 * Schema for one relation row: `related` writes a tuple, `unrelated` removes it. A subject and an
 * object are refs, `type:id`, such as `person:person_01jc…` and `fabrika:demo`.
 *
 * @stability unstable
 * @category schemas
 */
export const Row = Schema.TaggedUnion({ related: Tuple, unrelated: Tuple });

/**
 * One write: its entry id, chosen by the writer so a resend is one line, and its row.
 *
 * @stability unstable
 * @category models
 */
export interface Change {
  readonly id: string;
  readonly row: typeof Row.Type;
}

/**
 * The live tuples, folded in the referee's order. Opaque: only a right's check reads them.
 *
 * @stability unstable
 * @category models
 */
export interface Tuples {
  readonly [TuplesTypeId]: ReadonlySet<string>;
}

/**
 * The two failures a store's side has: a store that cannot answer, and a recorder that cannot write.
 *
 * **Details**
 *
 * Each keeps the cause it was made with, as it came, and has no message of its own: what a cause holds is for the code that reads
 * it, and a rendering of the error shows none of it.
 */
import { Schema } from "effect";

/**
 * A secret store could not answer, such as a store whose backend was unreachable. It says nothing of any value.
 *
 * @category errors
 */
export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * A recorder could not write a fact.
 *
 * @category errors
 */
export class RecordFailed extends Schema.TaggedError<RecordFailed, { readonly brand: unique symbol }>()(
  "RecordFailed",
  { cause: Schema.Defect() },
) {}

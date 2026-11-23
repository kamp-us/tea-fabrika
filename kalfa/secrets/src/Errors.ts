/**
 * The two failures a store's side has: a store that cannot answer, and a recorder that cannot write.
 *
 * **Details**
 *
 * A cause may quote a value, as a store's own client does when it reports what it read. So each failure holds its cause as a
 * `Redacted`, which no rendering shows: a caller makes it with `Redacted.make(cause)`, and code that needs the cause reads it on
 * purpose, with `Redacted.value(error.cause)`. A cause that is not hidden does not compile.
 */
import { Schema } from "effect";

/**
 * A secret store could not answer, such as a store whose backend was unreachable. It says nothing of any value, and its cause is
 * hidden.
 *
 * @category errors
 */
export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
  cause: Schema.Redacted(Schema.Defect()),
}) {}

/**
 * A recorder could not write a fact. It says nothing of any value, and its cause is hidden.
 *
 * @category errors
 */
export class RecordFailed extends Schema.TaggedError<RecordFailed, { readonly brand: unique symbol }>()(
  "RecordFailed",
  { cause: Schema.Redacted(Schema.Defect()) },
) {}

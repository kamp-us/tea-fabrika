/**
 * The two failures a store's side has: a store that cannot answer, and a recorder that cannot write.
 *
 * **Details**
 *
 * A cause may quote a value, as a store's own client does when it reports what it read. So each failure is made with its cause and
 * keeps it as a `Redacted` in `held`, which no rendering shows, while `cause` is a plain error that stands for it, with none of its
 * text. Code that needs the cause reads it on purpose, with `Redacted.value(error.held)`.
 */
import { Redacted, Schema } from "effect";

// The error `cause` gives in place of the real one: it says what was done and holds nothing of the cause's text.
const standingFor = (): Error =>
  new Error("The cause is held back, since it may quote a value. Read it on purpose with Redacted.value on `held`.");

/**
 * A secret store could not answer, such as a store whose backend was unreachable. It says nothing of any value, and none of its
 * cause: that is in `held`.
 *
 * @category errors
 */
export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
  held: Schema.Redacted(Schema.Unknown),
}) {
  // The cause must never reach the error's base class, which keeps what it is given where an inspector lists it.
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off -- a failure is never decoded from text, which is what an overridden constructor breaks
  constructor(made: { readonly cause: unknown }) {
    super({ held: Redacted.make(made.cause) });
  }

  /** An error that stands for the cause and shows none of it. */
  override get cause(): Error {
    return standingFor();
  }
}

/**
 * A recorder could not write a fact. It says nothing of any value, and none of its cause: that is in `held`.
 *
 * @category errors
 */
export class RecordFailed extends Schema.TaggedError<RecordFailed, { readonly brand: unique symbol }>()(
  "RecordFailed",
  { held: Schema.Redacted(Schema.Unknown) },
) {
  // As for `StoreFailed`: the cause is hidden before the base class sees it.
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off -- a failure is never decoded from text, which is what an overridden constructor breaks
  constructor(made: { readonly cause: unknown }) {
    super({ held: Redacted.make(made.cause) });
  }

  /** An error that stands for the cause and shows none of it. */
  override get cause(): Error {
    return standingFor();
  }
}

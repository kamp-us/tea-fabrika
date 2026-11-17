/**
 * Who sent the input behind a write, as a right's check takes it. This file holds the contract only
 * (0095): the gateway's one signing service answers it (0262), through
 * `access/SessionSenders.ts`.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Schema for the sender of an input, both its ids kept (0261): a person's window, or an agent let
 * in for a person. Both are checked as `person:<for>`, so an agent is capped by its person (0526).
 *
 * @category schemas
 */
export const Sender = Schema.TaggedUnion({
  person: { key: Schema.NonEmptyString, for: Schema.NonEmptyString },
  agent: { key: Schema.NonEmptyString, for: Schema.NonEmptyString },
});

/**
 * The decoded type of `Sender`.
 *
 * @category models
 */
export type Sender = typeof Sender.Type;

/**
 * Error for a sender that cannot be checked.
 *
 * **Details**
 *
 * `removed`: the sender's key no longer belongs. `ended`: the process the input was delivered to is
 * over. `storage`: the gateway's store failed, with its cause kept.
 *
 * @category errors
 */
export class SendersError extends Schema.TaggedError<SendersError, { readonly brand: unique symbol }>()(
  "SendersError",
  {
    reason: Schema.Literals(["removed", "ended", "storage"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * Service that answers who sent an input delivered to a process.
 *
 * **Details**
 *
 * `sender(parent, process)` answers the sender of `parent` when it is an input delivered to
 * `process`, and none when no member's input delivered there is behind it: a `null` parent, or an
 * input delivered to another process. It writes nothing.
 *
 * @category services
 */
export class Senders extends Context.Service<
  Senders,
  {
    readonly sender: (parent: string | null, process: string) => Effect.Effect<Option.Option<Sender>, SendersError>;
  }
>()("@kampus/libfabrika/permissions/Senders") {}

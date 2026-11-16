/**
 * The `Senders` port, answered by the gateway's one signing service (0262): who sent an input
 * delivered to a process, as a right's check takes it.
 */
import { Effect, Result, Schema } from "effect";
import { Sender, type Senders, SendersError } from "../permissions/Senders.ts";
import { NotGranted, SigningRefused, type Writer } from "./SessionManager.ts";

const decodeSender = Schema.decodeUnknownResult(Sender);
const isNotGranted = Schema.is(NotGranted);
const isRefused = Schema.is(SigningRefused);

/** A refusal or a failure of the signing service, as the port answers it. */
const refused = (cause: unknown) => {
  if (isRefused(cause) && cause.reason === "not_delivered") {
    return Effect.succeedNone;
  }

  if (isNotGranted(cause)) {
    return Effect.fail(new SendersError({ reason: "removed" }));
  }

  return Effect.fail(
    isRefused(cause) && cause.reason === "ended"
      ? new SendersError({ reason: "ended" })
      : new SendersError({ reason: "storage", cause }),
  );
};

/** A writer as the `Sender` with the same case and both its ids. */
const decoded = (writer: Writer) =>
  Result.match(decodeSender(writer), {
    onSuccess: (sender) => Effect.succeedSome(sender),
    onFailure: (cause) => Effect.fail(new SendersError({ reason: "storage", cause })),
  });

/**
 * Makes the `Senders` service from a `sender` function, such as `SessionManager`'s or the
 * gateway's.
 *
 * **Details**
 *
 * A `null` parent asks nothing and is none. `not_delivered` is none: no member's input delivered to
 * that process is behind the write. `NotGranted` is `removed`, `ended` is `ended`, and any other
 * failure, a ledger or session store failure included, is `storage` with its cause kept.
 *
 * @category constructors
 */
export const make = (
  sender: (parent: string, process: string) => Effect.Effect<Writer, unknown>,
): Senders["Service"] => ({
  sender: (parent, process) =>
    parent === null
      ? Effect.succeedNone
      : sender(parent, process).pipe(Effect.matchEffect({ onFailure: refused, onSuccess: decoded })),
});

/**
 * The `MailDelivery` layer over program mail and wakeups.
 */
import { Effect, Layer } from "effect";
import { ProgramMail } from "../processes/ProgramMail.ts";
import { MailDelivery, MailDeliveryError, type Mail } from "./MailDelivery.ts";
import { MailWakeups } from "./MailWakeups.ts";
import { Queued } from "./Send.ts";

/**
 * Layer that provides `MailDelivery` over `ProgramMail` and `MailWakeups`.
 *
 * **Details**
 *
 * Both steps repeat safely: the receipt is saved once per command, and a wake only schedules.
 * `queued` comes only after both, so a lost wake leaves the Send dispatched, and its retry finds
 * the same receipt. A failure keeps the lower error's reason, with that error as its cause.
 *
 * A `full` inbox wakes its recipient before the Send fails: a reader whose ack was lost reads
 * again and acks, so its writer is never left waiting on an inbox that is already read.
 *
 * @category layers
 */
export const layer: Layer.Layer<MailDelivery, never, ProgramMail | MailWakeups> = Layer.effect(
  MailDelivery,
  Effect.gen(function* () {
    const mail = yield* ProgramMail;
    const wakeups = yield* MailWakeups;

    return MailDelivery.of({
      send: Effect.fn("mail_delivery.send")(
        function* (sent: Mail) {
          const receipt = yield* mail
            .deliver(sent)
            .pipe(Effect.tapError((error) => (error.reason._tag === "full" ? wakeups.wake(sent.to) : Effect.void)));

          yield* Effect.annotateCurrentSpan({ "fab.mail.receipt": receipt.id, "fab.mail.to": receipt.to.name });
          yield* wakeups.wake(receipt.to.name);

          return Queued.make({ id: receipt.id });
        },
        Effect.mapError(
          (error) =>
            new MailDeliveryError({
              // A mail failure's reason is its case; a wake's is already a word.
              reason: error._tag === "ProgramMailError" ? error.reason._tag : error.reason,
              cause: error,
            }),
        ),
      ),
    });
  }),
);

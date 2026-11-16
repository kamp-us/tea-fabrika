import { Effect, Layer, Option, Schema } from "effect";
import { ProgramMail, ProgramMailError } from "../processes/ProgramMail.ts";
import type { MailDelivery } from "../runtime/MailDelivery.ts";
import * as MailDeliveryLive from "../runtime/MailDeliveryLive.ts";
import { MailWakeups, MailWakeupsError } from "../runtime/MailWakeups.ts";
import { MailReplies } from "./bindings.ts";
import { ProcessClient, ProjectClient } from "./platform.ts";
import { type Env, processStub, projectStub, rpc } from "./runtime.ts";

const fromMailReply = Effect.fnUntraced(function* (reply: unknown) {
  const checked = yield* Schema.decodeUnknownEffect(MailReplies)(reply).pipe(
    // The decode error shows the reply, which may hold mail; the reason alone is kept.
    Effect.mapError(() => ProgramMailError.storage()),
  );

  if (checked._tag === "refused") {
    return yield* ProgramMailError.refused(checked.reason);
  }

  if (checked._tag === "full") {
    yield* Effect.annotateCurrentSpan({ "fab.mail.unread": checked.unread, "fab.mail.cap": checked.cap });
    return yield* ProgramMailError.full(checked.unread);
  }

  return checked.receipt;
});

/** Save mail through the Project, then await the target object's saved alarm. */
export const mailLayer = (env: Env, project: string): Layer.Layer<MailDelivery> =>
  MailDeliveryLive.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProgramMail, {
          deliver: Effect.fn("process.mail")(function* (delivery) {
            const span = yield* Effect.currentSpan.pipe(Effect.orDie);
            // RPC failures can echo mail; keep only the reason before the RPC span records them.
            const reply = yield* rpc(
              ProjectClient.make(projectStub(env, project))
                .mail(delivery, {
                  traceId: span.traceId,
                  spanId: span.spanId,
                })
                .pipe(Effect.mapError(() => ProgramMailError.storage())),
            );
            return yield* fromMailReply(reply);
          }),
        }),
        wakeups(env, project),
      ),
    ),
  );

/**
 * Layer that wakes a registered name: its Process object saves the alarm that reads its inbox. Mail
 * and the gateway's wake after a task finish both use it.
 *
 * **Details**
 *
 * The wake carries the caller's current span as its trace, and no trace when the caller has none:
 * `wake(name)` asks nothing of its caller. The gateway wakes a finished task's requester inside its
 * `gateway.route` span, so the wake joins the finish's trace.
 *
 * @stability unstable
 * @category layers
 */
export const wakeups = (env: Pick<Env, "PROCESS">, project: string): Layer.Layer<MailWakeups> =>
  Layer.succeed(MailWakeups, {
    wake: Effect.fnUntraced(function* (name) {
      const span = yield* Effect.option(Effect.currentSpan);
      yield* rpc(
        ProcessClient.make(processStub(env, project, name))
          .mailed(Option.isSome(span) ? { traceId: span.value.traceId, spanId: span.value.spanId } : undefined)
          .pipe(Effect.mapError(() => MailWakeupsError.make({ reason: "unavailable" }))),
      );
    }),
  });

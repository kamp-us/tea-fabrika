// The raw gateway the laws of the platform's rules (M1 to M5) run against, on both worlds: a `Gateway` that only accepts, answers
// commands and reports what the platform did to it. It is its own file because the real Worker bundles it
// (`platform-gateway-worker.test-support.ts`), and a Worker bundle holds no test tool. It imports packages, the product's two
// services and the wire words only.
import { WebSocketAttachmentError } from "@alchemy.run/cloudflare";
import { Cause, Effect, Exit, Latch, Layer, Predicate, Result, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { Gateway } from "./Gateway.ts";
import { Hibernation } from "./Hibernation.ts";
import { GateCommand, GateCommandText, GateReport, GateReportText } from "./platform-gate-wire.test-support.ts";
import { Attachment } from "./platform-wire.test-support.ts";

/** A JSON value: what an attachment or a body holds in these laws. */
type Json = typeof Schema.Json.Type;

type Report = typeof GateReport.Type;

type SlotSocket = Parameters<Gateway["Service"]["webSocketMessage"]>[0];

/** The attachment `answerClose` stores: the sign, read in the close event, that this gateway answers the client's close with its own. */
const Answering = Schema.Struct({ answerClose: Schema.Literal(true) });

/**
 * The raw gateway the laws run against, on both worlds. It names no frame, no note and no handler: it stores and reads attachments as
 * a client tells it, holds a slot call open until released, sends numbered frames, closes when told, and says what the platform did to
 * it. `report` is where it says what has no socket to be said on (an upgrade, a close the client can no longer hear, a close event);
 * the world decides where that goes, because a slot cannot keep it in memory across a sleep.
 */
export const rawGateway = (report: (made: Report) => Effect.Effect<void>): Layer.Layer<Gateway, never, Hibernation> =>
  Layer.effect(
    Gateway,
    Effect.gen(function* () {
      const hibernation = yield* Hibernation;
      const wake = yield* (yield* SecureRandom.SecureRandom).uuidV4();
      const latch = yield* Latch.make(false);
      // The platform wraps the socket anew for each event, so no socket is seen twice: this is what the law reads of it.
      const seen = new WeakSet<object>();
      let seq = 0;
      let active = 0;
      // How many `close()` calls of this gateway are running now. The platform's close event is an event of its own, so it never comes
      // inside one, and the report of the event says how many there were.
      let closing = 0;

      const closeSocket = (socket: SlotSocket, code: number, reason: string) =>
        Effect.suspend(() => {
          closing += 1;

          return socket.close(code, reason);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              closing -= 1;
            }),
          ),
        );

      const attachmentHeld = (socket: SlotSocket) =>
        Effect.match(socket.getAttachment(Schema.Json), {
          onSuccess: (value) => Attachment.cases.kept.make({ value }),
          onFailure: (error) =>
            error.reason === "missing"
              ? Attachment.cases.gone.make({})
              : Attachment.cases.threw.make({ name: error.reason }),
        });

      const say = (socket: SlotSocket, text: typeof GateReport.Type) =>
        Effect.flatMap(Effect.orDie(Schema.encodeEffect(GateReportText)(text)), (encoded) => socket.send(encoded));

      // What `send` threw, as the defect Alchemy's `Effect.sync` makes of it.
      const thrownName = (cause: Cause.Cause<never>): string => {
        const found = Cause.findDefect(cause);

        return Result.isSuccess(found) && found.success instanceof Error ? found.success.name : "unknown";
      };

      return Gateway.of({
        upgrade: (options) =>
          Effect.gen(function* () {
            yield* report(GateReport.cases.Upgraded.make({ wake, options: options ?? null }));
            const [response] = yield* hibernation.upgrade;

            return response;
          }),
        webSocketMessage: (socket, message) =>
          Effect.gen(function* () {
            const at = (seq += 1);
            const fresh = !seen.has(socket);
            seen.add(socket);
            active += 1;

            const command = yield* Schema.decodeUnknownEffect(GateCommandText)(message).pipe(Effect.orDie);

            const answer = (body: Json) =>
              say(socket, GateReport.cases.Reply.make({ wake, seq: at, fresh, active, body }));

            const refusal = (error: WebSocketAttachmentError): Json => ({
              refused: error.reason,
              alchemy: error instanceof WebSocketAttachmentError,
            });

            const stored = (value: Json | object | undefined) =>
              Effect.match(socket.setAttachment(Schema.Unknown, value), {
                onSuccess: (): Json => ({ stored: true }),
                onFailure: refusal,
              });

            // Closes the socket as a client's Close frame is not yet back, and says what the platform did to the next send and to the
            // attachment. The platform's close event is an event of its own and may be delivered at any point after `close`, before or after
            // this report; the law reads both reports in either order.
            const closed = (code: number, reason: string, again: boolean) =>
              Effect.gen(function* () {
                yield* closeSocket(socket, code, reason);

                if (again) {
                  // Whether a second close throws is the platform's own answer; the law holds only what is the same either way.
                  yield* Effect.exit(closeSocket(socket, 1000, "again"));
                }

                // The platform says `send` throws once the server has sent its Close frame.
                const sent = yield* Effect.exit(socket.send("after the close"));

                yield* report(
                  GateReport.cases.ClosedByServer.make({
                    wake,
                    sent: Exit.isSuccess(sent) ? null : thrownName(sent.cause),
                    attachment: yield* attachmentHeld(socket),
                  }),
                );
              });

            // Read when it runs, not when it is made: a law changes the stored object between the two.
            const read = Effect.suspend(() =>
              Effect.match(socket.getAttachment(Schema.Json), {
                onSuccess: (value): Json => ({ value }),
                onFailure: refusal,
              }),
            );

            yield* GateCommand.match(command, {
              put: ({ value }) => Effect.flatMap(stored(value), answer),
              putMutated: ({ value }) =>
                Effect.gen(function* () {
                  const object: Record<string, unknown> = { value };
                  const outcome = yield* stored(object);

                  // The object is changed after the write: the platform stores a clone, so a read does not see it.
                  object.changedAfter = true;

                  yield* answer({ outcome, read: yield* read });
                }),
              putFunction: () => Effect.flatMap(stored({ call: () => "a function cannot be cloned" }), answer),
              putUndefined: () => Effect.flatMap(stored(undefined), answer),
              putWhole: ({ value }) =>
                Effect.flatMap(
                  Effect.match(socket.setAttachment(Schema.Int, value), {
                    onSuccess: (): Json => ({ stored: true }),
                    onFailure: refusal,
                  }),
                  answer,
                ),
              answerClose: () => Effect.flatMap(stored({ answerClose: true }), answer),
              get: () => Effect.flatMap(read, answer),
              getWhole: () =>
                Effect.flatMap(
                  Effect.match(socket.getAttachment(Schema.Int), {
                    onSuccess: (value): Json => ({ value }),
                    onFailure: refusal,
                  }),
                  answer,
                ),
              getChanged: () =>
                Effect.gen(function* () {
                  const first = yield* Effect.orDie(socket.getAttachment(Schema.Unknown));
                  const changed = Predicate.isObject(first);

                  // What was read is changed, and the attachment is read again: the platform gave a clone, so the change is not seen.
                  if (Predicate.isObject(first)) {
                    first.changedAfterRead = true;
                  }

                  yield* answer({ changed, again: yield* read });
                }),
              hold: () => Effect.andThen(latch.await, answer({ held: true })),
              release: () => Effect.andThen(latch.open, answer({ released: true })),
              ping: () => answer({ ping: at }),
              burst: ({ n }) =>
                Effect.forEach(
                  Array.from({ length: n }, (_, index) => `burst-${index}`),
                  (frame) => socket.send(frame),
                  { concurrency: 1, discard: true },
                ),
              close: ({ code, reason }) => closed(code, reason, false),
              closeTwice: ({ code, reason }) => closed(code, reason, true),
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  active -= 1;
                }),
              ),
            );
          }),
        webSocketClose: (socket, code, reason, wasClean) =>
          Effect.gen(function* () {
            const attachment = yield* attachmentHeld(socket);

            yield* report(GateReport.cases.CloseEvent.make({ wake, code, reason, wasClean, attachment, closing }));

            // The platform's WebSocket page tells a handler to answer the peer's close with `close()`. The platform gives no second close
            // event for it, and whether the call throws is its own answer, so the outcome is not read.
            if (Attachment.guards.kept(attachment) && Schema.is(Answering)(attachment.value)) {
              yield* Effect.exit(closeSocket(socket, code, ""));
            }
          }),
        webSocketError: (socket) =>
          Effect.gen(function* () {
            yield* report(GateReport.cases.ErrorEvent.make({ wake, attachment: yield* attachmentHeld(socket) }));
          }),
      });
    }),
  ).pipe(Layer.provide(SecureRandom.layerWebCrypto));

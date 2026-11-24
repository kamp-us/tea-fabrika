// The raw gateway the laws of the platform's rules (M1 to M5) run against, on both worlds: a `Gateway` that only accepts, answers
// commands and reports what the platform did to it. It is its own file because the real Worker bundles it
// (`platform-gateway-worker.test-support.ts`), and a Worker bundle holds no test tool. It imports packages, the product's two
// services and the wire words only.
import { WebSocketAttachmentError } from "@alchemy.run/cloudflare";
import { Cause, Effect, Exit, Latch, Layer, Result, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { Gateway } from "./Gateway.ts";
import { Hibernation } from "./Hibernation.ts";
import { GateCommand, GateCommandText, GateReport, GateReportText } from "./platform-gate-wire.test-support.ts";
import { Attachment } from "./platform-wire.test-support.ts";

/** A JSON value: what an attachment or a body holds in these laws. */
type Json = typeof Schema.Json.Type;

type Report = typeof GateReport.Type;

type SlotSocket = Parameters<Gateway["Service"]["webSocketMessage"]>[0];

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

            const stored = (value: Json | object) =>
              Effect.match(socket.setAttachment(Schema.Unknown, value), {
                onSuccess: (): Json => ({ stored: true }),
                onFailure: (error): Json => ({
                  refused: error.reason,
                  alchemy: error instanceof WebSocketAttachmentError,
                }),
              });

            // Read when it runs, not when it is made: a law changes the stored object between the two.
            const read = Effect.suspend(() =>
              Effect.match(socket.getAttachment(Schema.Json), {
                onSuccess: (value): Json => ({ value }),
                onFailure: (error): Json => ({
                  refused: error.reason,
                  alchemy: error instanceof WebSocketAttachmentError,
                }),
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
              get: () => Effect.flatMap(read, answer),
              hold: () => Effect.andThen(latch.await, answer({ held: true })),
              release: () => Effect.andThen(latch.open, answer({ released: true })),
              ping: () => answer({ ping: at }),
              burst: ({ n }) =>
                Effect.forEach(
                  Array.from({ length: n }, (_, index) => `burst-${index}`),
                  (frame) => socket.send(frame),
                  { concurrency: 1, discard: true },
                ),
              close: ({ code, reason }) =>
                Effect.gen(function* () {
                  yield* socket.close(code, reason);
                  // The platform says `send` throws once the server has sent its Close frame.
                  const sent = yield* Effect.exit(socket.send("after the close"));

                  yield* report(
                    GateReport.cases.ClosedByServer.make({
                      wake,
                      sent: Exit.isSuccess(sent) ? null : thrownName(sent.cause),
                      attachment: yield* attachmentHeld(socket),
                    }),
                  );
                }),
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
            yield* report(
              GateReport.cases.CloseEvent.make({
                wake,
                code,
                reason,
                wasClean,
                attachment: yield* attachmentHeld(socket),
              }),
            );
          }),
        webSocketError: (socket) =>
          Effect.gen(function* () {
            yield* report(GateReport.cases.ErrorEvent.make({ wake, attachment: yield* attachmentHeld(socket) }));
          }),
      });
    }),
  ).pipe(Layer.provide(SecureRandom.layerWebCrypto));

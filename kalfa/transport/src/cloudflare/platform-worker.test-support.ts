// The Worker that R0 and the real runs of the platform laws (M1 to M5) run against: one Durable Object class that accepts
// hibernatable sockets and does exactly what a client tells it, and reports what the platform did to it. It is raw on purpose:
// it names no gateway, no frame and no note, so what a run shows is the platform and not `serve`. It is bundled by Alchemy
// and run by workerd, so its imports are packages, and the wire words of `platform-wire.test-support.ts`.
//
// Two sockets reach one object. The `main` socket is the one under test: the client tells it to write, read or close. The
// `log` socket is a sink: every slot call the object gets, on any wake, is reported there, because after a server close the
// `main` socket can carry nothing more. Both are told apart by the path the client connects to, `/<object>/<role>`.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Cause, Effect, Exit, Layer, Predicate, Result, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { Attachment, Command, Report, ReportText } from "./platform-wire.test-support.ts";

const CommandText = Schema.fromJsonString(Command);

const Role = Schema.Literals(["main", "log"]);

interface ProbeShape {
  readonly fetch: NonNullable<Cloudflare.DurableObjectShape["fetch"]>;
  readonly webSocketMessage: NonNullable<Cloudflare.DurableObjectShape["webSocketMessage"]>;
  readonly webSocketClose: NonNullable<Cloudflare.DurableObjectShape["webSocketClose"]>;
  readonly webSocketError: NonNullable<Cloudflare.DurableObjectShape["webSocketError"]>;
}

/** What the platform threw when the attachment was read. */
class ReadThrew extends Schema.TaggedError<ReadThrew, { readonly brand: unique symbol }>()("ReadThrew", {
  thrown: Schema.String,
}) {}

class Probe extends Cloudflare.DurableObject<Probe, ProbeShape>()("PlatformProbe") {}

export class Host extends Cloudflare.Worker<Host, Record<never, never>, Probe>()("PlatformHost") {}

const ProbeLive = Probe.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const runtime = yield* RuntimeContext;
      const wake = yield* (yield* SecureRandom.SecureRandom).uuidV4();
      let seq = 0;

      // The name of what `send` threw, as the defect `Effect.sync` made of it.
      const thrownName = (cause: Cause.Cause<never>): string => {
        const found = Cause.findDefect(cause);

        return Result.isSuccess(found) && found.success instanceof Error ? found.success.name : "unknown";
      };

      // What the attachment of a socket holds now.
      const attachmentHeld = (socket: Cloudflare.WebSocket) =>
        Effect.try({
          try: () => socket.deserializeAttachment<typeof Schema.Json.Type>(),
          catch: (cause) => new ReadThrew({ thrown: cause instanceof Error ? cause.name : "unknown" }),
        }).pipe(
          Effect.map((value) =>
            value === null || value === undefined
              ? Attachment.cases.gone.make({})
              : Attachment.cases.kept.make({ value }),
          ),
          Effect.catch(({ thrown }) => Effect.succeed(Attachment.cases.threw.make({ name: thrown }))),
        );

      const text = (made: typeof Report.Type) => Effect.orDie(Schema.encodeEffect(ReportText)(made));

      // Says it on every `log` socket the object holds, which is how a later wake reaches the client.
      const report = (made: typeof Report.Type) =>
        Effect.gen(function* () {
          const written = yield* text(made);

          for (const sink of yield* state.getWebSockets("log").pipe(Effect.provideService(RuntimeContext, runtime))) {
            yield* sink.send(written);
          }
        });

      // The tags say which socket an event is about, and are kept when the attachment is not.
      const isMain = (socket: Cloudflare.WebSocket) =>
        Effect.map(
          state.getTags(socket.ws).pipe(Effect.provideService(RuntimeContext, runtime)),
          (tags) => !tags.includes("log"),
        );

      return {
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;

          const role = yield* Schema.decodeUnknownEffect(Role)(new URL(request.url).pathname.split("/").at(-1)).pipe(
            Effect.orDie,
          );

          const [response] = yield* Cloudflare.upgrade({ tags: [role] });

          return response;
        }),
        webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
          Effect.gen(function* () {
            const at = (seq += 1);

            if (!Predicate.isString(message) || !(yield* isMain(socket))) {
              return;
            }

            const command = yield* Schema.decodeUnknownEffect(CommandText)(message).pipe(Effect.orDie);

            const answer = Effect.gen(function* () {
              yield* socket.send(
                yield* text(Report.cases.Answered.make({ wake, seq: at, attachment: yield* attachmentHeld(socket) })),
              );
            });

            yield* Command.match(command, {
              write: ({ value }) =>
                Effect.andThen(
                  Effect.sync(() => socket.serializeAttachment(value)),
                  answer,
                ),
              read: () => answer,
              close: ({ code, reason }) =>
                Effect.gen(function* () {
                  yield* socket.close(code, reason);
                  // The platform says `send` throws once the server has sent its Close frame; Alchemy's `send` makes it a defect.
                  const sent = yield* Effect.exit(socket.send("after the close"));

                  yield* report(
                    Report.cases.ClosedByServer.make({
                      wake,
                      seq: at,
                      sent: Exit.isSuccess(sent) ? null : thrownName(sent.cause),
                      attachment: yield* attachmentHeld(socket),
                    }),
                  );
                }),
            });
          }),
        webSocketClose: (socket: Cloudflare.WebSocket, code: number, reason: string, wasClean: boolean) =>
          Effect.gen(function* () {
            const at = (seq += 1);

            if (yield* isMain(socket)) {
              yield* report(
                Report.cases.CloseEvent.make({
                  wake,
                  seq: at,
                  code,
                  reason,
                  wasClean,
                  attachment: yield* attachmentHeld(socket),
                }),
              );
            }
          }),
        webSocketError: (socket: Cloudflare.WebSocket) =>
          Effect.gen(function* () {
            const at = (seq += 1);

            if (yield* isMain(socket)) {
              yield* report(Report.cases.ErrorEvent.make({ wake, seq: at, attachment: yield* attachmentHeld(socket) }));
            }
          }),
      };
    }).pipe(Effect.provide(SecureRandom.layerWebCrypto));
  }),
);

// oxlint-disable-next-line import/no-default-export -- edge: Alchemy runs this Worker from main: import.meta.url, and workerd loads a Worker by its default export (0058)
export default Host.make(
  {
    main: import.meta.url,
    dev: { host: "127.0.0.1", port: Number(process.env.PLATFORM_PORT), strictPort: true },
    compatibility: { date: "2026-10-12" },
  },
  Effect.gen(function* () {
    const probes = yield* Probe.from(Host);

    return {
      // `/<object>/<role>`: the first segment names the object, so each case has an object of its own.
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const name = decodeURIComponent(new URL(request.url).pathname.split("/")[1] ?? "");

        return yield* probes.getByName(name).fetch(request);
      }).pipe(
        Effect.catchCause((cause) => Effect.succeed(HttpServerResponse.text(Cause.pretty(cause), { status: 500 }))),
      ),
    };
  }).pipe(Effect.provide(Layer.mergeAll(ProbeLive))),
);

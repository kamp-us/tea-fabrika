/**
 * A stand-in Durable Object for tests: it holds a gateway as the platform does, in memory, and sleeps when told to.
 *
 * **Details**
 *
 * It keeps the platform's rules, each one proved on real workerd by the same laws. Each socket's client end is one end of `MemorySocket.pair`. A message is delivered as soon as the client writes it, even while an earlier slot call still runs. An attachment is stored as a `structuredClone` of its value and refused above 16,384 bytes of its JSON text in UTF-8. Attachments live through `sleep`, and memory does not. A socket is a new object for each event. `send` throws once the server has sent its Close frame, and the close event that comes after a server close is the one real workerd gave: it comes later, in an event of its own, with the code of the server's own Close frame, no reason, and the attachment still readable.
 */
import { WebSocketAttachmentError } from "@alchemy.run/cloudflare";
import type { Scope } from "effect";
import { Context, Duration, Effect, Layer, LayerRef, Option, Predicate, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { Socket } from "effect/socket";
import * as MemorySocket from "../MemorySocket.ts";
import { Gateway } from "./Gateway.ts";
import { Hibernation } from "./Hibernation.ts";
import type { HeldSocket } from "./Hibernation.ts";

/** The most bytes of JSON text, in UTF-8, the platform keeps for one socket's attachment. */
const ATTACHMENT_LIMIT = 16_384;

const encoder = new TextEncoder();

/** Alchemy's own error for a failed attachment call, with the message Alchemy gives it, made for a given reason. */
const refused = (reason: WebSocketAttachmentError["reason"]) => (cause: unknown) =>
  new WebSocketAttachmentError({ reason, message: `Could not ${reason} WebSocket attachment`, cause });

/**
 * The server's end of one socket the object accepted, and what the platform keeps for it: its attachment, and whether the server has sent
 * its Close frame.
 */
class Accepted {
  readonly server: Socket.Socket;
  readonly write: Socket.Writer["write"];
  attachment: Option.Option<unknown> = Option.none();
  closed = false;

  constructor(server: Socket.Socket, write: Socket.Writer["write"]) {
    this.server = server;
    this.write = write;
  }

  /** Keeps a clone of `encoded`. A value the platform cannot clone or holds too many bytes of is refused, and the value kept before stays. */
  keep<A>(encoded: A): Effect.Effect<void, WebSocketAttachmentError> {
    return Effect.try({ try: () => structuredClone(encoded), catch: refused("write") }).pipe(
      Effect.filterOrFail(
        (clone) => encoder.encode(JSON.stringify(clone)).length <= ATTACHMENT_LIMIT,
        () => refused("write")(new RangeError(`an attachment holds at most ${ATTACHMENT_LIMIT} bytes`)),
      ),
      Effect.flatMap((clone) =>
        Effect.sync(() => {
          this.attachment = Option.some(clone);
        }),
      ),
    );
  }
}

/** The socket the request being handled brought, which the platform gives to `fetch` and this gives to `Hibernation.upgrade`. */
class Incoming extends Context.Service<Incoming, Accepted>()("@kalfa/transport/cloudflare/MemoryGateway.Incoming") {}

/**
 * One client connecting, one socket accepted outside the gateway, the object sleeping, and a socket the platform reports broken: what a test
 * does to a Durable Object that holds a gateway.
 *
 * @category models
 */
export interface MemoryGateway {
  /** One client connecting, as the app's route would call `gateway.upgrade(options)`; the client's end is a socket. */
  readonly connect: (options?: { readonly traceFrames?: boolean }) => Effect.Effect<Socket.Socket, never, Scope.Scope>;
  /** A socket accepted outside the gateway, with no attachment of its own, as another part of the class would hold. */
  readonly stranger: Effect.Effect<Socket.Socket, never, Scope.Scope>;
  /** The object sleeps: the gateway's Layer and all its memory are dropped, and built again on the next event. Sockets and attachments stay. */
  readonly sleep: Effect.Effect<void>;
  /** The platform reports the client's socket broken: the object gets an error event, and the client's end closes abnormally. Only this stand-in can say it. */
  readonly drop: (socket: Socket.Socket) => Effect.Effect<void>;
}

/**
 * Holds a gateway in a stand-in Durable Object, until the scope ends.
 *
 * **Details**
 *
 * The gateway's Layer is built when the first event comes and again after each `sleep`. Its `Hibernation` is the stand-in's, which accepts the socket of the `connect` that is running `upgrade`. It makes one span, `transport.upgrade`, as the Cloudflare Layer does.
 *
 * @category constructors
 */
export const make = (
  gateway: Layer.Layer<Gateway, never, Hibernation>,
): Effect.Effect<MemoryGateway, never, Scope.Scope> =>
  Effect.gen(function* () {
    const object = yield* Effect.scope;
    // The clients' ends, so that `drop` finds the server's end of the one it is given.
    const clients = new WeakMap<Socket.Socket, Accepted>();

    const accepting = (server: Socket.Socket) =>
      Effect.map(server.writer, (writer) => new Accepted(server, writer.write));

    /** One event of the platform, handled by the gateway as it is now built. */
    const event = (use: (gateway: Gateway["Service"]) => Effect.Effect<void>) =>
      Effect.flatMap(Gateway, use).pipe(Effect.provide(wake.get));

    /** Starts an effect as its own event, which the platform runs apart from the call that caused it. */
    const later = (effect: Effect.Effect<void>) => Effect.asVoid(Effect.forkIn(effect, object));

    /** A socket as an event gets it: a new object each time, over the one the object accepted. */
    const held = (accepted: Accepted): HeldSocket => ({
      send: (data) =>
        accepted.closed
          ? Effect.die(new TypeError("send() after the server sent its Close frame"))
          : Effect.orDie(accepted.write(data)),
      close: (code, reason) =>
        Effect.suspend(() => {
          if (accepted.closed) {
            return Effect.void;
          }

          accepted.closed = true;

          // The client's Close frame comes back later, as an event of its own: with the server's code and no reason, whatever the server sent.
          return Effect.andThen(
            Effect.orDie(accepted.write(new Socket.CloseEvent(code, reason))),
            later(
              Effect.andThen(
                Effect.yieldNow,
                event((gateway) => gateway.webSocketClose(held(accepted), code, "", true)),
              ),
            ),
          );
        }),
      setAttachment: (schema, value) =>
        Schema.encodeEffect(schema)(value).pipe(
          Effect.mapError(refused("encode")),
          Effect.flatMap((encoded) => accepted.keep(encoded)),
        ),
      getAttachment: (schema) =>
        Option.match(accepted.attachment, {
          onNone: () =>
            Effect.fail(
              new WebSocketAttachmentError({ reason: "missing", message: "WebSocket attachment is missing" }),
            ),
          onSome: (kept) =>
            Schema.decodeUnknownEffect(schema)(structuredClone(kept)).pipe(Effect.mapError(refused("decode"))),
        }),
    });

    /** Reads the server's end until it closes, and gives each message to the gateway at once, as its own event. */
    const listen = (accepted: Accepted) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { pull } = yield* accepted.server.reader;

          return yield* Effect.forever(
            Effect.gen(function* () {
              for (const chunk of yield* pull) {
                yield* later(
                  event((gateway) =>
                    gateway.webSocketMessage(
                      held(accepted),
                      Predicate.isString(chunk) ? chunk : Uint8Array.from(chunk).buffer,
                    ),
                  ),
                );
              }
            }),
          );
        }),
      ).pipe(
        // The client closed: the one close event, with its code and reason. A close the server sent has its own event, above.
        Effect.catchReason("SocketError", "SocketCloseError", ({ code, closeReason }) =>
          accepted.closed
            ? Effect.void
            : event((gateway) => gateway.webSocketClose(held(accepted), code, closeReason ?? "", true)),
        ),
        Effect.orDie,
        Effect.forkIn(object),
        Effect.asVoid,
      );

    const hibernation = Hibernation.of({
      upgrade: Effect.gen(function* () {
        const accepted = yield* Effect.orDie(Effect.flatMap(Effect.serviceOption(Incoming), Effect.fromOption));

        yield* listen(accepted);

        return [HttpServerResponse.empty({ status: 101 }), held(accepted)] as const;
      }).pipe(Effect.withSpan("transport.upgrade")),
    });

    const wake = yield* LayerRef.make(Layer.provide(gateway, Layer.succeed(Hibernation, hibernation)), {
      idleTimeToLive: Duration.infinity,
    });

    const open = Effect.gen(function* () {
      const [client, server] = yield* MemorySocket.pair;
      const accepted = yield* accepting(server);

      clients.set(client, accepted);

      return [client, accepted] as const;
    });

    return {
      connect: (options) =>
        Effect.gen(function* () {
          const [client, accepted] = yield* open;

          yield* Effect.flatMap(Gateway, (gateway) => gateway.upgrade(options)).pipe(
            Effect.provideService(Incoming, accepted),
            Effect.provide(wake.get),
          );

          return client;
        }),
      stranger: Effect.gen(function* () {
        const [client, accepted] = yield* open;

        yield* listen(accepted);

        return client;
      }),
      sleep: wake.invalidate,
      drop: (client) =>
        Effect.gen(function* () {
          const accepted = yield* Effect.orDie(Effect.fromNullishOr(clients.get(client)));

          accepted.closed = true;
          yield* Effect.orDie(accepted.write(new Socket.CloseEvent(1006, "")));
          yield* later(event((gateway) => gateway.webSocketError(held(accepted), new Error("the connection broke"))));
        }),
    };
  });

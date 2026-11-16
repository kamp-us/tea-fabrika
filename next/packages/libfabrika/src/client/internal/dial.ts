/**
 * The socket Sub every client start shares: one dial is one constructor call, one reader and one
 * writer in the dial's own scope. Each socket event becomes a Msg; the machine that asked decides
 * what it means. Moved out of the window start so the hands start dials the same way.
 *
 * @internal
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import type { Identity } from "../../transport/ClientKey.ts";
import { ErrorClass } from "../../transport/ClientRows.ts";
import { backoff, CAP } from "../../transport/Link.ts";

/**
 * One dial's open socket: its writer, the key it dialed with, and when each call id was written.
 *
 * @internal
 */
export type Handle = {
  readonly writer: Socket.Writer;
  readonly key: Identity;
  readonly written: Map<number, number>;
};

/**
 * What one dial's socket saw: it opened, the door sent a text frame, it closed, or it failed to open.
 *
 * @internal
 */
export type DialMsg =
  | { readonly type: "socket_opened"; readonly dial: number; readonly at: number }
  | { readonly type: "frame"; readonly dial: number; readonly text: string; readonly at: number; readonly ms?: number }
  | { readonly type: "socket_closed"; readonly dial: number; readonly code: number; readonly at: number }
  | { readonly type: "socket_failure"; readonly dial: number; readonly op: "connect"; readonly error: ErrorClass };

/** The id of a frame that answers a call, read only to time the answer. */
const answerId = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ id: Schema.Finite })));

/** The class of a socket that failed to open: the thrown error's own class, or a network failure. */
const openFailure = (error: Socket.SocketError): ErrorClass => {
  const reason = error.reason;

  if (reason._tag === "SocketOpenError" && reason.kind === "Timeout") {
    return "TimeoutError";
  }

  const cause = "cause" in reason ? reason.cause : undefined;
  const name = Predicate.hasProperty(cause, "name") ? cause.name : null;

  return Schema.is(ErrorClass)(name) ? name : "NetworkError";
};

/** The close code a reader's failure carries, or 1006 when the socket ended without one. */
const closeCode = (error: Socket.SocketError): number =>
  error.reason._tag === "SocketCloseError" ? error.reason.code : 1006;

/** One socket for `url`, from the platform's constructor. A throwing constructor is an open failure. */
const acquire = (make: Socket.WebSocketConstructor["Service"], url: string) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => make(url),
      catch: (cause) => Socket.SocketError.make({ reason: Socket.SocketOpenError.make({ kind: "Unknown", cause }) }),
    }),
    (ws) => Effect.sync(() => ws.close(1000)),
  );

/** The retry timer already waited the backoff. Only the socket adds jitter. */
const dialWait = Effect.fn("dial.wait")(function* (tries: number) {
  if (tries === 0) {
    return;
  }

  const base = backoff(tries);
  const bound = Math.min(1000, base / 2, CAP - base);

  if (bound > 0) {
    const ms = yield* Random.nextIntBetween(0, bound);
    yield* Effect.sleep(ms);
  }
});

/**
 * Writes one text on the dial's open socket, or fails at once when it has none.
 *
 * @internal
 */
export const send = (
  handles: ReadonlyMap<number, Handle>,
  dial: number,
  text: string,
): Effect.Effect<void, "none" | Socket.SocketError> =>
  Effect.suspend((): Effect.Effect<void, "none" | Socket.SocketError> => {
    const handle = handles.get(dial);

    return handle === undefined ? Effect.fail("none" as const) : handle.writer.write(text);
  });

/**
 * The socket Sub for one client: `dial(n, key, tries)` opens dial `n` with the key `key` gives, at
 * `<origin>/client/<fingerprint>/<tab>`, keeps its handle in `handles` while it is open, and emits
 * what the socket sees.
 *
 * @internal
 */
export const dialer =
  (options: {
    readonly sockets: Socket.WebSocketConstructor["Service"];
    readonly origin: string;
    readonly tab: string;
    readonly handles: Map<number, Handle>;
  }) =>
  (dial: number, identity: Effect.Effect<Identity>, tries: number): Stream.Stream<DialMsg> =>
    Stream.callback<DialMsg>((queue) =>
      Effect.gen(function* () {
        const emit = (m: DialMsg): void => {
          Queue.offerUnsafe(queue, m);
        };

        const key = yield* identity;
        yield* dialWait(tries);
        const url = `${pipe(options.origin, Str.replace(/^http/, "ws"))}/client/${encodeURIComponent(key.fingerprint)}/${encodeURIComponent(options.tab)}`;
        const connection = yield* Socket.fromWebSocket(acquire(options.sockets, url));

        const pull = yield* Socket.readerString(connection).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const at = yield* Clock.currentTimeMillis;

              if (error.reason._tag !== "SocketCloseError") {
                emit({ type: "socket_failure", dial, op: "connect", error: openFailure(error) });
              }

              emit({ type: "socket_closed", dial, code: closeCode(error), at });

              return yield* Effect.never;
            }),
          ),
        );

        const writer = yield* connection.writer;
        const written = new Map<number, number>();
        yield* Effect.acquireRelease(
          Effect.sync(() => options.handles.set(dial, { writer, key, written })),
          () => Effect.sync(() => options.handles.delete(dial)),
        );
        emit({ type: "socket_opened", dial, at: yield* Clock.currentTimeMillis });

        return yield* pull.pipe(
          Effect.flatMap((texts) =>
            Effect.map(Clock.currentTimeMillis, (at) => {
              for (const text of texts) {
                // A call's write time lives until its answer comes, so the map only holds calls in
                // flight.
                const sent = Option.flatMap(answerId(text), ({ id }) => {
                  const at = Option.fromUndefinedOr(written.get(id));
                  written.delete(id);

                  return at;
                });

                emit({
                  type: "frame",
                  dial,
                  text,
                  at,
                  ...Option.match(sent, { onNone: () => ({}), onSome: (t) => ({ ms: Math.max(0, at - t) }) }),
                });
              }
            }),
          ),
          Effect.forever,
          Effect.catch((error) =>
            Effect.gen(function* () {
              options.handles.delete(dial);
              emit({ type: "socket_closed", dial, code: closeCode(error), at: yield* Clock.currentTimeMillis });

              return yield* Effect.never;
            }),
          ),
        );
      }),
    );

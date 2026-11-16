import { Cause, Clock, Context, Effect, Layer, Option, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { Waited } from "../ledger/Log.ts";
import { ProcessIdGenerator } from "../processes/ProcessIdGenerator.ts";
import { RecordedStart } from "../settings/RecordedStart.ts";
import { targetStream } from "../tasks/Tasks.ts";
import { causeClass, REFUSED, SinkError } from "../telemetry/Trace.ts";
import { connection } from "../transport/Connection.ts";
import { Answer, Attached, Hello, RateCountFailure } from "../transport/Wire.ts";
import type { ConnectionId } from "./bindings.ts";
import { cloudflareSql } from "./CloudflareSql.ts";
import { ProjectClient, rejected } from "./platform.ts";
import {
  complete,
  projectStub,
  recordedLayer,
  recordingLayer,
  rpc,
  SettingsRuntime,
  type BrainOptions,
  type Env,
  type ProjectOptions,
} from "./runtime.ts";

// A route's answer, its rate failures counted as storage and its refusals tagged on the span.
const routed = Effect.fnUntraced(function* (work: Effect.Effect<typeof Answer.Type, LedgerError>) {
  return yield* work.pipe(
    Effect.mapError((error) => {
      const failure = rejected(error);
      return Schema.is(RateCountFailure)(failure)
        ? new SinkError({ reason: "storage", held: 0, message: failure.message, cause: error })
        : error;
    }),
    Effect.tap((answer) =>
      answer._tag === "refused" && ["reserved", "rate_limited"].includes(answer.reason)
        ? Effect.annotateCurrentSpan(REFUSED, answer.reason)
        : Effect.void,
    ),
    Effect.tapError((error) =>
      Schema.is(RateCountFailure)(error) ? Effect.annotateCurrentSpan(REFUSED, "rate_limited") : Effect.void,
    ),
  );
});

// One wait the gateway asks its project for, read from the project's answer: `ready` at a rev, or
// `parked`. A hands key's own `target:` stream is asked again as its `tasks.wait`: it may not call
// `ledger.wait`, and the gateway names that stream from its key alone. Either way the ring goes to
// `reader`, the object where the socket is. A ready answer whose rev does not decode is a
// `LedgerError` of reason `bad_row`, in the typed channel.
const waitOn = (p: ProjectClient["Service"]) =>
  Effect.fnUntraced(function* (client: ConnectionId, stream: string, after: number, reader: string) {
    const asked = stream.startsWith(targetStream(""))
      ? p.route(client, "tasks.wait", { after }, reader)
      : p.route(client, "ledger.wait", { stream, after }, reader);
    const answer = yield* rpc(routed(asked));

    if (answer._tag === "parked") {
      return Waited.cases.parked.make({});
    }

    if (answer._tag !== "ok") {
      return yield* Effect.fail(answer);
    }

    const ready = yield* Schema.decodeUnknownEffect(Schema.Struct({ rev: Schema.Int }))(answer.result).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
    return Waited.cases.ready.make(ready);
  });

/**
 * The gateway's waits on its project: `wait(client, stream, after, reader)` asks the project for one
 * wait and answers `ready` at a rev or `parked`. A ready answer that does not decode fails with a
 * `LedgerError` of reason `bad_row`. `GatewayWaits.layer(env)` asks the project named by the
 * recorded start.
 *
 * @category services
 */
export class GatewayWaits extends Context.Service<
  GatewayWaits,
  {
    readonly wait: (
      client: ConnectionId,
      stream: string,
      after: number,
      reader: string,
    ) => Effect.Effect<Waited, LedgerError | SinkError | typeof Answer.cases.refused.Type>;
  }
>()("@kampus/libfabrika/cloudflare/connection.GatewayWaits") {
  static readonly layer = (env: Env) =>
    Layer.effect(
      GatewayWaits,
      Effect.gen(function* () {
        const checked = yield* RecordedStart;
        return { wait: waitOn(ProjectClient.make(projectStub(env, checked.input.name))) };
      }),
    );
}

const gatewayLogic = Effect.fnUntraced(function* (ctx: DurableObjectState, env: Env) {
  const checked = yield* RecordedStart;
  const port = checked.values.port;
  const config = checked.input;
  const p = ProjectClient.make(projectStub(env, config.name)),
    ids = yield* ProcessIdGenerator,
    waits = yield* GatewayWaits;
  const gateway = yield* Schema.decodeUnknownEffect(Schema.String)(ctx.id.name).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
  );
  const recording = yield* Layer.build(
    recordingLayer(cloudflareSql(ctx.storage), env, config.name, `connection:${gateway}`),
  ).pipe(Effect.provideService(RecordedStart, checked));
  const recorded = <A, E>(work: Effect.Effect<A, E>, counted?: (value: A) => boolean) =>
    complete(work, counted).pipe(Effect.provideContext(recording));
  yield* recorded(Effect.void);
  const connections = new Map<WebSocket, ReturnType<typeof connection>>();
  const attached = Effect.fnUntraced(function* (ws: WebSocket) {
    return yield* Schema.decodeUnknownEffect(Attached)(ws.deserializeAttachment()).pipe(
      Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    );
  });
  const make = Effect.fnUntraced(function* (ws: WebSocket) {
    const [session, tab, key] = yield* Schema.decodeUnknownEffect(
      Schema.Tuple([Schema.String, Schema.String, Schema.String]),
    )(ctx.getTags(ws)).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    const c = connection({
      reader: gateway,
      session,
      read: () => attached(ws),
      save: (a) => ws.serializeAttachment(a),
      send: (text) => ws.send(text),
      close: (code) => ws.close(code, "reconnect"),
      ping: () => ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null,
      wait: Effect.fnUntraced(function* (stream, after, reader) {
        const client = (yield* attached(ws)).client as ConnectionId;
        return yield* waits.wait(client, stream, after, reader);
      }),
      call: Effect.fnUntraced(
        function* (method, params) {
          const client = (yield* attached(ws)).client as ConnectionId;

          if (method === "initialize") {
            const hello = Schema.decodeUnknownResult(Hello)(params);
            const result = yield* rpc(
              p.initialize(client, params, {
                url: `http://127.0.0.1:${port}`,
                tab,
                name: key,
                session,
              }),
            );

            if (result._tag === "refused") {
              if (Result.isSuccess(hello)) {
                ws.serializeAttachment(
                  Attached.cases.waiting.make({
                    client,
                    key: hello.success.key,
                    hello: hello.success,
                    nonce: hello.success.nonce,
                  }),
                );
              }

              return result;
            }

            ws.serializeAttachment(
              Attached.cases.online.make({
                client,
                identity: result.identity,
                version: result.version,
                waits: [],
                watching: false,
                busy: false,
                has: result.hello.has,
                ...(result.hello.build === undefined ? {} : { build: result.hello.build }),
              }),
            );
            const at = yield* Clock.currentTimeMillis;
            yield* rpc(p.join({ client, key: result.identity.key, gateway, session, at }));
            return Answer.cases.ok.make({
              result: { identity: result.identity, version: result.version, ping: result.ping },
            });
          }

          if (method === "gateway.knock") {
            const input = yield* Schema.decodeUnknownEffect(
              Schema.Struct({
                label: Schema.String,
                as: Schema.optionalKey(Schema.Literals(["window", "agent", "hands"])),
              }),
            )(params).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
            const result = yield* rpc(p.knock(client, input));

            if (result._tag === "ok") {
              const waiting = yield* Schema.decodeUnknownEffect(
                Schema.Struct({ code: Schema.String, until: Schema.Number }),
              )(result.result).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
              yield* rpc(p.publish(client, { method: "gateway.waiting", params: waiting }));
              return Answer.cases.ok.make({ result: waiting });
            }

            return result;
          }

          // A call the door parks, such as a hands key's first `tasks.wait`, is rung at this object,
          // the one the socket lives on, never at an object named by the connection id.
          return yield* rpc(routed(p.route(client, method, params, gateway)));
        },
        // A failed or defective call still answers its request without exposing error details. It is
        // kept on a failed span, as runner.throw does: `error.type` names the class that was thrown, and
        // the span fails with the typed error, so stored content keeps its tag and reason, never the
        // thrown text, which may hold a bearer or a raw frame.
        Effect.catchCause((cause) => {
          if (Option.exists(Cause.findErrorOption(cause), Schema.is(RateCountFailure))) {
            return Effect.failCause(cause);
          }

          return Effect.exit(
            Effect.failCause(cause).pipe(
              Effect.withSpan("gateway.refused", {
                attributes: { "error.type": causeClass(Cause.map(cause, rejected)) },
              }),
            ),
          ).pipe(Effect.as(Answer.cases.refused.make({ reason: "unreachable" })));
        }),
      ),
    });
    connections.set(ws, c);
    return c;
  });
  const connected = Effect.fnUntraced(function* (ws: WebSocket) {
    return connections.get(ws) ?? (yield* make(ws));
  });
  const close = Effect.fn("connection.close")(function* (ws: WebSocket) {
    const state = yield* attached(ws),
      [session] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(
        ctx.getTags(ws),
      ).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
    yield* rpc(p.leave(state.client, session));
    yield* rpc(p.disconnect(state.client as ConnectionId));
    connections.delete(ws);
  });
  // The runtime leaves a peer's close frame unanswered, and a browser then keeps its socket closing
  // for 10 s before it reports the close. One close frame back ends it at once (RFC 6455, 5.5.1). It
  // carries the peer's code, or 1000 for a code no frame may carry (1005, 1006). A socket that is
  // already gone refuses the frame, and nothing is left to answer.
  const answerClose = (ws: WebSocket, code: number) =>
    Effect.try({
      try: () => ws.close(code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000, "closed"),
      catch: (cause) => new LedgerError({ reason: "unreachable", cause }),
    }).pipe(Effect.ignore);
  const ring = Effect.fn("connection.ring")(function* (stream: string, rev: number) {
    const span = yield* Effect.currentSpan;
    const onRefused = (reason: string) => Effect.sync(() => span.attribute(REFUSED, reason));

    for (const ws of ctx.getWebSockets()) {
      if ((yield* attached(ws))._tag === "online") {
        yield* (yield* connected(ws)).ring(stream, rev, onRefused);
      }
    }

    return span.attributes.has(REFUSED);
  });
  const probe = Effect.fn("connection.probe")(function* (session: string) {
    for (const ws of ctx.getWebSockets(session)) {
      if ((yield* attached(ws))._tag === "online") {
        return yield* (yield* connected(ws)).probe(session);
      }
    }

    return yield* new LedgerError({ reason: "unreachable" });
  });
  const notify = Effect.fn("connection.notify")(function* (client: string, news: unknown) {
    for (const ws of ctx.getWebSockets()) {
      if ((yield* attached(ws)).client === client) {
        yield* Effect.try({
          try: () => {
            if (typeof news === "object" && news !== null && "close" in news && typeof news.close === "number") {
              ws.close(news.close, "permission changed");
            } else {
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  ...(typeof news === "object" && news !== null ? news : {}),
                }),
              );
            }
          },
          catch: (cause) => new LedgerError({ reason: "unreachable", cause }),
        });
      }
    }
  });

  for (const ws of ctx.getWebSockets()) {
    const work = (yield* make(ws)).wake();
    yield* (yield* attached(ws))._tag === "online" ? recorded(work) : work;
  }

  return {
    fetch: Effect.fnUntraced(function* (request: Request) {
      const path = new URL(request.url).pathname.split("/");

      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const segments = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String]))(
        path.slice(2, 4),
      ).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
      const [key, tab] = yield* Effect.try({
        try: () => [decodeURIComponent(segments[0]), decodeURIComponent(segments[1])] as const,
        catch: (cause) => new LedgerError({ reason: "bad_row", cause }),
      });
      const client = yield* rpc(p.clientConnect()),
        nonce = yield* rpc(p.challenge(client)),
        session = yield* ids.next;
      const pair = new WebSocketPair(),
        server = pair[1];
      ctx.acceptWebSocket(server, [session, tab, key]);
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
      server.serializeAttachment(Attached.cases.new.make({ client, nonce }));
      yield* rpc(p.register(client, gateway, session));
      yield* make(server);
      server.send(JSON.stringify({ jsonrpc: "2.0", method: "challenge", params: { nonce } }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }),
    message: Effect.fnUntraced(function* (ws: WebSocket, text: string | ArrayBuffer) {
      const state = yield* attached(ws);

      if (typeof text !== "string") {
        return;
      }

      const work = (yield* connected(ws)).frame(text);
      yield* state._tag === "online" ? recorded(work) : work;
    }),
    close: Effect.fnUntraced(function* (ws: WebSocket, code?: number) {
      if (code !== undefined) {
        yield* answerClose(ws, code);
      }

      return yield* (yield* attached(ws))._tag === "online" ? recorded(close(ws)) : close(ws);
    }),
    ring: (stream: string, rev: number) => recorded(ring(stream, rev), (counted) => counted).pipe(Effect.asVoid),
    probe: (session: string) => recorded(probe(session)),
    notify: Effect.fnUntraced(function* (client: string, news: unknown) {
      const states = yield* Effect.forEach(ctx.getWebSockets(), attached, { concurrency: 1 });
      const online = states.some((state) => state.client === client && state._tag === "online");
      return yield* online ? recorded(notify(client, news)) : notify(client, news);
    }),
  };
});

export class ConnectionService extends Context.Service<
  ConnectionService,
  {
    readonly fetch: (request: Request) => Effect.Effect<Response, LedgerError>;
    // A frame, a ring and a probe go through the socket's connection, whose calls are door calls. A door
    // fails with `unknown`, which takes in every other failure.
    readonly message: (ws: WebSocket, text: string | ArrayBuffer) => Effect.Effect<void, unknown>;
    readonly close: (ws: WebSocket, code?: number) => Effect.Effect<void, LedgerError | SinkError>;
    readonly ring: (stream: string, rev: number) => Effect.Effect<void, unknown>;
    readonly probe: (session: string) => Effect.Effect<number | null, unknown>;
    readonly notify: (client: string, news: unknown) => Effect.Effect<void, LedgerError | SinkError>;
  }
>()("@kampus/libfabrika/cloudflare/connection.ConnectionService") {}

/**
 * The gateway's `ConnectionService`, over the `GatewayWaits` and the recorded start its caller
 * provides. `connectionLayer` provides the real ones.
 *
 * @category layers
 */
export const gatewayLayer = (ctx: DurableObjectState, env: Env) =>
  Layer.effect(ConnectionService, gatewayLogic(ctx, env)).pipe(Layer.provide(ProcessIdGenerator.layer));

export const connectionLayer = (
  ctx: DurableObjectState,
  env: Env,
  _config?: BrainOptions,
  input?: ProjectOptions["input"],
) =>
  gatewayLayer(ctx, env).pipe(
    Layer.provide(GatewayWaits.layer(env)),
    Layer.provide(input === undefined ? recordedLayer(env) : recordedLayer(env, input)),
  );

export const connectionRuntime = (
  ctx: DurableObjectState,
  env: Env,
  config?: BrainOptions,
  input?: ProjectOptions["input"],
) => SettingsRuntime.runtime(connectionLayer(ctx, env, config, input));

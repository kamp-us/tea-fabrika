// The Worker the laws of the platform's rules (M1 to M5) run against on real workerd: one Durable Object class that mounts the raw gateway
// of `platform-gateway.test-support.ts` through the product's `Hibernation` Layer, the way any class mounts a gateway, and spreads the
// gateway's four slots into its shape. Three sockets reach one object, told apart by the path the client connects to,
// `/<object>/<role>`: `main` is accepted by the gateway's `upgrade` (its options ride in the query as JSON), `stranger` is accepted
// by the class itself and so is no gateway socket, and `log` is the sink the gateway's reports are sent to, because after a sleep a slot
// has no other way to reach the client. Bundled by Alchemy and run by workerd.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Cause, Context, Effect, Layer, Option, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { Gateway } from "./Gateway.ts";
import { Hibernation } from "./Hibernation.ts";
import { GateReportText } from "./platform-gate-wire.test-support.ts";
import type { GateReport } from "./platform-gate-wire.test-support.ts";
import { rawGateway } from "./platform-gateway.test-support.ts";
import { route } from "./platform-wire.test-support.ts";

interface GateShape {
  readonly fetch: NonNullable<Cloudflare.DurableObjectShape["fetch"]>;
  readonly webSocketMessage: NonNullable<Cloudflare.DurableObjectShape["webSocketMessage"]>;
  readonly webSocketClose: NonNullable<Cloudflare.DurableObjectShape["webSocketClose"]>;
  readonly webSocketError: NonNullable<Cloudflare.DurableObjectShape["webSocketError"]>;
}

class Gate extends Cloudflare.DurableObject<Gate, GateShape>()("PlatformGate") {}

export class GateHost extends Cloudflare.Worker<GateHost, Record<never, never>, Gate>()("PlatformGateHost") {}

/** The options a client gave `upgrade`, as the JSON in the query says; none when the query has none. */
const OptionsText = Schema.fromJsonString(Schema.Struct({ traceFrames: Schema.optionalKey(Schema.Boolean) }));

const GateLive = Gate.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const runtime = yield* RuntimeContext;

      const inRuntime = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>) =>
        Effect.provideService(effect, RuntimeContext, runtime);

      // The gateway's reports go to every `log` socket the object holds, which is how a later wake reaches the client.
      const report = (made: typeof GateReport.Type) =>
        Effect.gen(function* () {
          const text = yield* Effect.orDie(Schema.encodeEffect(GateReportText)(made));

          for (const sink of yield* inRuntime(state.getWebSockets("log"))) {
            yield* sink.send(text);
          }
        });

      const context = yield* Layer.build(
        rawGateway(report).pipe(
          Layer.provide(Hibernation.layer),
          Layer.provide(
            Layer.mergeAll(Layer.succeed(Cloudflare.DurableObjectState, state), Layer.succeed(RuntimeContext, runtime)),
          ),
        ),
      );

      const gateway = Context.get(context, Gateway);

      const isLog = (socket: Cloudflare.WebSocket) =>
        Effect.map(inRuntime(state.getTags(socket.ws)), (tags) => tags.includes("log"));

      return {
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const found = route(request.url);

          if (Option.isNone(found)) {
            return yield* Effect.die(new Error("the Worker sends only routes the object can read"));
          }

          if (found.value.role === "main") {
            const query = new URL(request.url, "http://probe.invalid").searchParams.get("options");

            const options =
              query === null ? undefined : yield* Effect.orDie(Schema.decodeUnknownEffect(OptionsText)(query));

            return yield* gateway.upgrade(options);
          }

          const [response] = yield* Cloudflare.upgrade({ tags: [found.value.role] });

          return response;
        }),
        webSocketMessage: (socket, message) =>
          Effect.flatMap(isLog(socket), (log) => (log ? Effect.void : gateway.webSocketMessage(socket, message))),
        webSocketClose: (socket, code, reason, wasClean) =>
          Effect.flatMap(isLog(socket), (log) =>
            log ? Effect.void : gateway.webSocketClose(socket, code, reason, wasClean),
          ),
        webSocketError: (socket, error) =>
          Effect.flatMap(isLog(socket), (log) => (log ? Effect.void : gateway.webSocketError(socket, error))),
      };
    });
  }),
);

// oxlint-disable-next-line import/no-default-export -- edge: Alchemy runs this Worker from main: import.meta.url, and workerd loads a Worker by its default export (0058)
export default GateHost.make(
  {
    main: import.meta.url,
    dev: { host: "127.0.0.1", port: Number(process.env.PLATFORM_PORT), strictPort: true },
    compatibility: { date: "2026-10-12" },
  },
  Effect.gen(function* () {
    const gates = yield* Gate.from(GateHost);

    return {
      // `/<object>/<role>`: the first segment names the object, so each run has an object of its own.
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const found = route(request.url);

        // A path that names no object and role is no gate's: say so, which is also how the readiness request is answered.
        if (Option.isNone(found)) {
          return HttpServerResponse.text("no such route", { status: 404 });
        }

        return yield* gates.getByName(found.value.object).fetch(request);
      }).pipe(
        Effect.catchCause((cause) => Effect.succeed(HttpServerResponse.text(Cause.pretty(cause), { status: 500 }))),
      ),
    };
  }).pipe(Effect.provide(Layer.mergeAll(GateLive))),
);

/**
 * Where a checked JSON-RPC frame's request goes, the one service `answerFrame` asks for.
 *
 * @stability unstable
 */
import { Context, type Effect, Schema } from "effect";
import type { Answer, RateCountFailure, Who } from "./Wire.ts";

/**
 * A route that could not answer, with what it failed with kept as the cause.
 *
 * @stability unstable
 * @category errors
 */
export class RouteError extends Schema.TaggedError<RouteError>()("RouteError", {
  cause: Schema.Defect(),
}) {}

/**
 * Answers one request by its method and params. `identity` is the connection's checked identity
 * when it is online, and `null` for a connection not yet online.
 *
 * @stability unstable
 * @category services
 */
export class Routes extends Context.Service<
  Routes,
  {
    readonly route: (
      method: string,
      params: unknown,
      identity: typeof Who.Type | null,
    ) => Effect.Effect<typeof Answer.Type, RouteError | typeof RateCountFailure.Type>;
  }
>()("@kampus/libfabrika/transport/Routes") {}

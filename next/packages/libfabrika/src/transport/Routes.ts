/**
 * Where a checked JSON-RPC frame's request goes, the one service `answerFrame` asks for.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Answer, RateCountFailure, Who } from "./Wire.ts";

/**
 * A route that could not answer, with what it failed with kept as the cause.
 *
 * @category errors
 */
export class RouteError extends Schema.TaggedError<RouteError, { readonly brand: unique symbol }>()("RouteError", {
  cause: Schema.Defect(),
}) {}

/**
 * Answers one request by its method and params. `identity` is the connection's checked identity
 * when it is online, and `null` for a connection not yet online.
 *
 * @category services
 */
export class Routes extends Context.Service<
  Routes,
  {
    readonly route: (
      method: string,
      params: Schema.Json | undefined,
      identity: typeof Who.Type | null,
    ) => Effect.Effect<typeof Answer.Type, RouteError | typeof RateCountFailure.Type>;
  }
>()("@kampus/libfabrika/transport/Routes") {}

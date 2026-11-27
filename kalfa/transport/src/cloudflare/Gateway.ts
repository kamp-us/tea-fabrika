/**
 * The gateway: the four calls a Durable Object class hands to the platform to hold sockets that sleep.
 *
 * **Details**
 *
 * The slots have Alchemy's own signatures, so a class's shape takes them as they are, and nothing here names a class. A gateway that handles frames is built on top of this service; this file holds only its type.
 */
import { Context } from "effect";
import type { Effect } from "effect";
import type { HttpServerResponse } from "effect/http";
import type { HeldSocket } from "./Hibernation.ts";

/**
 * The service a Durable Object class mounts to hold sockets: one slot for each thing the platform calls.
 *
 * **Details**
 *
 * `upgrade(options)` is for the class's `fetch`, once the app has routed and checked the request; `traceFrames: false` says the connection carries spans, whose frames make no span of their own. `webSocketMessage`, `webSocketClose` and `webSocketError` are for the class's slots of the same names. The platform wraps the socket anew for each event, so a gateway never keys on a socket's identity.
 *
 * @category services
 */
export class Gateway extends Context.Service<
  Gateway,
  {
    readonly upgrade: (options?: {
      readonly traceFrames?: boolean;
    }) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
    readonly webSocketMessage: (socket: HeldSocket, message: string | ArrayBuffer) => Effect.Effect<void>;
    readonly webSocketClose: (
      socket: HeldSocket,
      code: number,
      reason: string,
      wasClean: boolean,
    ) => Effect.Effect<void>;
    readonly webSocketError: (socket: HeldSocket, cause: unknown) => Effect.Effect<void>;
  }
>()("@kalfa/transport/cloudflare/Gateway") {}

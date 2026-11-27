/**
 * The seam between a gateway and the platform: how a Durable Object accepts a socket that may sleep while it stays open, and what a gateway needs of that socket.
 *
 * **Details**
 *
 * This is the one file of the package that calls Alchemy. `Hibernation.layer` is the Cloudflare Layer, and `@kalfa/transport/cloudflare/memory` is a stand-in that keeps the same rules, so a gateway runs on either.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Context, Effect, Layer } from "effect";
import type { HttpServerResponse } from "effect/http";

/**
 * What a gateway needs of a held socket: four calls of Alchemy's `Cloudflare.WebSocket`, and nothing of the platform's raw socket.
 *
 * **Details**
 *
 * An Alchemy socket fits every slot as it is, and the stand-in's socket is a plain object with the same four calls.
 *
 * @category models
 */
export type HeldSocket = Pick<Cloudflare.WebSocket, "send" | "close" | "getAttachment" | "setAttachment">;

/**
 * The service that accepts a socket the object may sleep with.
 *
 * **Details**
 *
 * `upgrade` accepts the socket of the request being handled and gives the `101` response to return from `fetch`, with the server's end of the socket. Its Cloudflare Layer is `Hibernation.layer`; the stand-in's is made by `@kalfa/transport/cloudflare/memory`. The platform delivers no message to the object until `fetch` returns, so what a gateway sends before that is sent before any frame can arrive.
 *
 * @category services
 */
export class Hibernation extends Context.Service<
  Hibernation,
  {
    readonly upgrade: Effect.Effect<readonly [HttpServerResponse.HttpServerResponse, HeldSocket]>;
  }
>()("@kalfa/transport/cloudflare/Hibernation") {
  /**
   * Layer that accepts a hibernatable socket with Alchemy's `Cloudflare.upgrade`.
   *
   * **Details**
   *
   * The object's state and the instance's `RuntimeContext` are taken when the Layer is built, as Alchemy's own socket for its RPC does, since a later event runs `upgrade` outside the call that made them. It makes one span, `transport.upgrade`.
   */
  static readonly layer: Layer.Layer<Hibernation, never, Cloudflare.DurableObjectState | RuntimeContext> = Layer.effect(
    Hibernation,
    Effect.gen(function* () {
      const context = yield* Effect.context<Cloudflare.DurableObjectState | RuntimeContext>();

      return Hibernation.of({
        upgrade: Cloudflare.upgrade().pipe(Effect.provideContext(context), Effect.withSpan("transport.upgrade")),
      });
    }),
  );
}

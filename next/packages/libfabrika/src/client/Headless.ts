/**
 * The window client for a program with no DOM: the same window parent and the same start as a
 * browser tab, on the platform's own global `WebSocket`.
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import { Socket } from "effect/socket";
import * as WindowStart from "./WindowStart.ts";

/** A headless client's facts, as its hello and its knock state them. */
const HEADLESS: typeof WindowStart.ClientInfo.Type = {
  platform: "headless",
  os: "unknown",
  has: [],
  label: "Headless",
};

/**
 * Boots a window parent for a program with no DOM.
 *
 * **Details**
 *
 * It is `WindowStart.start` with the headless client's facts and the global `WebSocket` constructor
 * (Node has one). The caller provides `ClientKey`, `ClientRows`, `Id.Generator` and the `Scope`
 * that owns the run: it invents no key store and no disk path. The constructor's layer is built in
 * that same `Scope`, so it lives exactly as long as the run.
 *
 * @stability unstable
 * @category constructors
 */
export const start = Effect.fn("Headless.start")(function* (options: Omit<WindowStart.StartOptions, "client">) {
  const sockets = yield* Layer.build(Socket.layerWebSocketConstructorGlobal);
  return yield* WindowStart.start({ ...options, client: HEADLESS }).pipe(Effect.provideContext(sockets));
});

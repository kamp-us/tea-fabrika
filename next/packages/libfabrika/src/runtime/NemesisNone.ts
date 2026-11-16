/**
 * The disabled implementation, with no live fault dependencies.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Nemesis, NemesisError, Off } from "./Nemesis.ts";

/**
 * Refuses both operations with the service's typed Off error.
 *
 * @stability unstable
 * @category layers
 */
export const layer: Layer.Layer<Nemesis> = Layer.succeed(Nemesis, {
  fire: Effect.fn("nemesis.off.fire")(function* () {
    return yield* NemesisError.make({ reason: Off.make({ cause: null }) });
  }),
  check: Effect.fn("nemesis.off.check")(function* () {
    return yield* NemesisError.make({ reason: Off.make({ cause: null }) });
  }),
});

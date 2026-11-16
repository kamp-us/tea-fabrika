/**
 * The disabled implementation, with no live fault dependencies.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Nemesis, NemesisError, Off } from "./Nemesis.ts";

/**
 * Refuses both operations with the service's typed Off error.
 *
 * @category layers
 */
export const layer: Layer.Layer<Nemesis> = Layer.succeed(Nemesis, {
  fire: Effect.fn("nemesis.off.fire")(function* () {
    return yield* new NemesisError({ reason: new Off({ cause: null }) });
  }),
  check: Effect.fn("nemesis.off.check")(function* () {
    return yield* new NemesisError({ reason: new Off({ cause: null }) });
  }),
});

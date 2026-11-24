// depth.arbitrary.ts: `effect/Arbitrary` with `checkEffect` capped to `MUTATE_RUNS` cases (ticket 1306). Today's
// lead tooling. depth.ts says why and how it is swapped in; nothing imports this file but the config it builds.
import * as Real from "effect-real/Arbitrary";
import { cap, depthFrom } from "./depth.ts";

export * from "effect-real/Arbitrary";

const to = depthFrom(process.env.MUTATE_RUNS);

/** The real `checkEffect`, drawing at most `MUTATE_RUNS` cases; the real one when it is unset. */
export const checkEffect: typeof Real.checkEffect = (self, property, options) =>
  Real.checkEffect(self, property, to === undefined ? options : cap(options, to));

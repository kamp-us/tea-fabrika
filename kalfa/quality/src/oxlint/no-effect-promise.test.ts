// Law O4 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-effect-promise` refuses `Effect.promise` and every
// `Effect.tryPromise` that is not one plain object literal: an arrow, a name, a parenthesized object, no argument, two
// arguments. A `pinned:` law, the plan's reason: each call shape is named once, so there is nothing to generate.
//
// Plants, each run once on no-effect-promise.ts and undone:
// - drop the `grouped` check: `Effect.tryPromise(({ try: p, catch: c }))` stops firing;
// - take two arguments when the first is an object: `Effect.tryPromise({ try: p, catch: c }, 1)` stops firing.
import { it } from "@effect/vitest";
import { noEffectPromise } from "./no-effect-promise.ts";
import { check } from "./Tester.test-support.ts";

it("O4 pinned: no-effect-promise refuses Effect.promise and each tryPromise that is not one plain object", () => {
  check("no-effect-promise", noEffectPromise, [
    ['import { Effect } from "effect";', 0],
    ["declare const p: () => Promise<number>;", 0],
    ["declare const c: () => string;", 0],
    ["export const a = Effect.promise(p);", 1],
    ["export const b = Effect.tryPromise(p);", 1],
    ["export const d = Effect.tryPromise(() => p());", 1],
    ["export const e = Effect.tryPromise(({ try: p, catch: c }));", 1],
    ["export const f = Effect.tryPromise();", 1],
    ["export const g = Effect.tryPromise({ try: p, catch: c }, 1);", 1],
    // What passes: the object form, and another module's `promise`.
    ["export const h = Effect.tryPromise({ try: p, catch: c });", 0],
    ["export const i = Effect.tryPromise({ try: p, catch: c },);", 0],
    ["export const j = Other.promise(p);", 0],
  ]);
});

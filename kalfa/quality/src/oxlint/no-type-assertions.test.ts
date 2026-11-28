// Law O11 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-type-assertions` refuses `as any`, `as unknown as T` and
// `as never as T` with at most one pair of parentheses around the inner cast, and `<T>x`; it passes `as const`, one
// `as T` and `as (any)`. A `pinned:` law, the plan's reason: each form is named once, so there is nothing to generate.
//
// Plants, each run once on no-type-assertions.ts and undone:
// - make `grouped(source, inner) <= 1` into `=== 0`: `(x as unknown) as T` stops firing;
// - drop the `TSTypeAssertion` visitor: `<string>x` stops firing.
import { it } from "@effect/vitest";
import { noTypeAssertions } from "./no-type-assertions.ts";
import { check } from "./Tester.test-support.ts";

it("O11 pinned: no-type-assertions refuses as any, the double casts and angle brackets, and passes as const and one cast", () => {
  check("no-type-assertions", noTypeAssertions, [
    ["declare const x: number;", 0],
    ["export const a = x as any;", 1],
    ["export const b = x as unknown as string;", 1],
    ["export const c = x as never as string;", 1],
    ["export const d = (x as unknown) as string;", 1],
    ["export const e = (x as never) as string;", 1],
    ["export const f = <string>x;", 1],
    // What passes: `as const`, one narrowing cast, `as (any)`, and two pairs around the inner cast.
    ['export const g = ["a"] as const;', 0],
    ["export const h = x as number;", 0],
    ["export const i = x as (any);", 0],
    ["export const j = ((x as unknown)) as string;", 0],
  ]);
});

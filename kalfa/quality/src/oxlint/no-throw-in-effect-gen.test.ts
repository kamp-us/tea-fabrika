// Law O10 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-throw-in-effect-gen` refuses a `throw` at any depth inside
// `Effect.gen(...)`, `Effect.fn(...)` and `Effect.fn("name")(...)`, and passes one outside any Effect body. The depth is
// drawn from 0 to 4 levels of `if` blocks and nested arrows. The rule reads `Effect` as written, so no other spelling is drawn.
//
// Plants, each run once on no-throw-in-effect-gen.ts and undone:
// - look at the nearest call only: a `throw` inside a nested arrow stops firing;
// - drop the curried form: `Effect.fn("n")(function* ...)` stops firing.
import { it } from "@effect/vitest";
import { Array as Arr } from "effect";
import * as fc from "fast-check";
import { noThrowInEffectGen } from "./no-throw-in-effect-gen.ts";
import { check, type Line } from "./Tester.test-support.ts";

/** The ways an Effect body is opened: the call and the text that closes it. */
const BODIES: ReadonlyArray<(inside: string) => string> = [
  (inside) => `Effect.gen(function* () { ${inside} })`,
  (inside) => `Effect.fn(function* () { ${inside} })`,
  (inside) => `Effect.fn("name")(function* () { ${inside} })`,
  (inside) => `Effect.gen(function* () { yield* Effect.void; ${inside} })`,
];

/** One level of nesting around a statement: an `if` block, or an arrow called at once. */
const LEVELS: ReadonlyArray<(inside: string) => string> = [
  (inside) => `if (x) { ${inside} }`,
  (inside) => `(() => { ${inside} })();`,
];

const THROW = 'throw new Error("a");';

/** Lines that throw outside any Effect body, or in a call that only looks like one. None is reported. */
const PASSES: ReadonlyArray<string> = [
  `export const p = () => { ${THROW} };`,
  `export const p = Other.gen(function* () { ${THROW} });`,
  `export const p = gen(function* () { ${THROW} });`,
  `export const p = Effect.succeed(() => { ${THROW} });`,
  `export const p = Effect.gen(function* () { yield* Effect.void; });`,
];

const generated = fc.record({
  body: fc.constantFrom(...BODIES),
  levels: fc.array(fc.constantFrom(...LEVELS), { maxLength: 4 }),
  pass: fc.nat({ max: PASSES.length - 1 }),
});

it("O10 no-throw-in-effect-gen: refuses a throw at any depth inside an Effect body, and passes one outside", () => {
  fc.assert(
    fc.property(generated, ({ body, levels, pass }) => {
      const inside = Arr.reduce(levels, THROW, (text, level) => level(text));

      const lines: ReadonlyArray<Line> = [
        ['import { Effect } from "effect";', 0],
        ["declare const x: boolean;", 0],
        [`export const a = ${body(inside)};`, 1],
        [PASSES[pass]!, 0],
      ];

      check("no-throw-in-effect-gen", noThrowInEffectGen, lines);
    }),
    { seed: 119120, numRuns: 100 },
  );
});

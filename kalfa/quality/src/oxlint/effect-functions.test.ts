// Law O1 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `effect-functions` refuses a span wrapper that a named function
// returns, and passes a span inside the body, a consumed `Stream.withSpan`, `Effect.fn` and an unnamed callback. Each
// case is one generated file in process through oxlint's RuleTester, with the way the file reaches Effect drawn from the
// spellings the rule resolves: the named import, a renamed named import and the module as a namespace.
//
// Plants, each run once on effect-functions.ts and undone:
// - match the written name `Effect` only: the renamed import and the namespace stop firing;
// - read only the pipe's last argument: a span first or second in the pipe stops firing.
import { it } from "@effect/vitest";
import { Array as Arr } from "effect";
import * as fc from "fast-check";
import { effectFunctions } from "./effect-functions.ts";
import { check, type Line } from "./Tester.test-support.ts";

/** How a file reaches Effect: the import line and the name `Effect.withSpan` is then written with. */
const SPELLINGS: ReadonlyArray<(alias: string) => { readonly header: string; readonly local: string }> = [
  () => ({ header: 'import { Effect } from "effect";', local: "Effect" }),
  (alias) => ({ header: `import { Effect as ${alias} } from "effect";`, local: alias }),
  (alias) => ({ header: `import * as ${alias} from "effect/Effect";`, local: alias }),
];

/** Where a named function holds its body: every place the rule counts as named. */
const PLACES: ReadonlyArray<(body: string) => string> = [
  (body) => `export const a = () => ${body};`,
  (body) => `export function a() { return ${body}; }`,
  (body) => `export const a = function () { return ${body}; };`,
  (body) => `export const a = { m: () => ${body} };`,
  (body) => `export class A { m() { return ${body}; } }`,
  (body) => `export class A { m = () => ${body}; }`,
  // The curried form: the inner arrow is returned by a named one.
  (body) => `export const a = (job: string) => (work: unknown) => ${body};`,
];

/** Every way a span wraps what a function returns, as the body's text. `at` is the span's place among three pipe steps. */
const WRAPPERS: ReadonlyArray<(local: string, at: number) => string> = [
  (local) => `${local}.withSpan(append(), "s")`,
  (local, at) => {
    const steps = Arr.map([0, 1, 2], (i) => (i === at ? `${local}.withSpan("s")` : `${local}.asVoid`));

    return `append().pipe(${Arr.join(steps, ", ")})`;
  },
  (local) => `append().pipe(${local}.withSpan("s")).pipe(${local}.asVoid)`,
  (local) => `append().pipe(${local}.withSpan("s"), ${local}.catchCause(() => ${local}.void))`,
];

/** Lines that return no span of a function's own, or call another module's. None is reported. */
const PASSES: ReadonlyArray<(local: string, i: number) => string> = [
  // A span on a step inside the body.
  (local, i) =>
    `export const p${i} = ${local}.fnUntraced(function* () { yield* append().pipe(${local}.withSpan("part")); yield* append(); });`,
  (local, i) =>
    `export const p${i} = () => ${local}.gen(function* () { yield* append().pipe(${local}.withSpan("part")); });`,
  // `Effect.fn` names the span itself.
  (local, i) => `export const p${i} = ${local}.fn("n")(function* () { return yield* append(); });`,
  // An unnamed callback, and a function that returns more than its one expression.
  (local, i) => `export const p${i} = ${local}.forEach([], () => append().pipe(${local}.withSpan("item")));`,
  (local, i) => `export const p${i} = [1].map(() => append().pipe(${local}.withSpan("item")));`,
  (local, i) => `export function p${i}() { const x = 1; return append().pipe(${local}.withSpan("s")); }`,
  // Spans of another module, a consumed stream, and no span.
  (_, i) => `export const p${i} = () => append().pipe(Mine.withSpan("s"));`,
  (_, i) => `export const p${i} = () => Stream.runCollect(Stream.empty.pipe(Stream.withSpan("m")));`,
  (_, i) => `export const p${i} = () => append();`,
];

const generated = fc.record({
  spelling: fc.constantFrom(...SPELLINGS),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((word) => `K${word}`),
  place: fc.constantFrom(...PLACES),
  wrapper: fc.constantFrom(...WRAPPERS),
  at: fc.nat({ max: 2 }),
  passes: fc.array(fc.nat({ max: PASSES.length - 1 }), { minLength: 1, maxLength: 4 }),
});

it("O1 effect-functions: refuses a span wrapper a named function returns, in every spelling it reads, and passes an inner span", () => {
  fc.assert(
    fc.property(generated, ({ spelling, alias, place, wrapper, at, passes }) => {
      const { header, local } = spelling(alias);

      const lines: ReadonlyArray<Line> = [
        [header, 0],
        ['import { Stream } from "effect";', 0],
        ['import { Mine } from "./mine.ts";', 0],
        ["declare const append: () => unknown;", 0],
        [place(wrapper(local, at)), 1],
        ...Arr.map(passes, (form, i): Line => [PASSES[form]!(local, i), 0]),
      ];

      check("effect-functions", effectFunctions, lines);
    }),
    { seed: 119120, numRuns: 100 },
  );
});

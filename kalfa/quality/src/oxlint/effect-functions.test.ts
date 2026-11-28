// Law O1 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `effect-functions` refuses a span wrapper that a named function
// returns, and passes a span inside the body, a consumed `Stream.withSpan`, `Effect.fn` and an unnamed callback. Each
// case is one generated file in process through oxlint's RuleTester, with the way the file reaches Effect drawn from the
// spellings the rule resolves: the named import, a renamed named import and the module as a namespace.
//
// A file draws one to three of those spellings at once, and a returned wrapper takes its span from one binding and its
// other steps from another. The returned body is also drawn from calls that are not a pipe, and from other modules' spans.
//
// Plants, each run once on effect-functions.ts and undone:
// - match the written name `Effect` only: the renamed import and the namespace stop firing;
// - read only the pipe's last argument: a span first or second in the pipe stops firing;
// - read every call with a member callee as a pipe (`callee.property.name !== "pipe"` into `false`): a span argument of
//   `Effect.zip(...)` fires;
// - take any name imported from `effect` as Effect (`dotted(spec.imported) === "Effect"` into `true`): `Stream.withSpan` in a
//   returned pipe fires;
// - require a span to be every binding's (`Arr.some` into `Arr.every`): a file with two bindings stops firing;
// - drop the `callee.property.type !== "Identifier"` check: `this.#pipe(Effect.withSpan("s"))` fires;
// - take a body that has code after its `return` for a single returned expression (`length === 1` into `true`): it fires.
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

/**
 * Every way a span wraps what a function returns, as the body's text. `span` is the binding the span is written
 * through, `base` the binding the other steps are, and `at` the span's place among three pipe steps.
 */
const WRAPPERS: ReadonlyArray<(span: string, base: string, at: number) => string> = [
  (span) => `${span}.withSpan(append(), "s")`,
  (span, base, at) => {
    const steps = Arr.map([0, 1, 2], (i) => (i === at ? `${span}.withSpan("s")` : `${base}.asVoid`));

    return `append().pipe(${Arr.join(steps, ", ")})`;
  },
  (span, base) => `append().pipe(${span}.withSpan("s")).pipe(${base}.asVoid)`,
  (span, base) => `append().pipe(${span}.withSpan("s"), ${base}.catchCause(() => ${base}.void))`,
  (span, base) => `${base}.void.pipe(${span}.withSpan("s"))`,
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
  (_, i) => `export const p${i} = () => append().pipe(Foreign.withSpan("s"));`,
  (_, i) => `export const p${i} = () => append().pipe(Q.withSpan("s"));`,
  (_, i) => `export const p${i} = () => Stream.make(1).pipe(Stream.withSpan("m"));`,
  (_, i) => `export const p${i} = () => Stream.runCollect(Stream.empty.pipe(Stream.withSpan("m")));`,
  (_, i) => `export const p${i} = () => append();`,
  // A call that is not a pipe returns what it makes, so a span in its arguments or inside its object is a step of the body.
  (local, i) => `export const p${i} = () => ${local}.zip(append(), ${local}.withSpan("s"));`,
  (local, i) => `export const p${i} = () => ${local}.zip(${local}.void, ${local}.void.pipe(${local}.withSpan("s")));`,
  (local, i) => `export const p${i} = () => append().pipe(${local}.withSpan("s")).asVoid();`,
  // A private member is not a plain name, whatever it is called.
  (local, i) =>
    `export class P${i} { #pipe(_: unknown) { return 1; } m() { return this.#pipe(${local}.withSpan("s")); } }`,
  // Code after the `return`: the body is not one returned expression.
  (local, i) => `export function p${i}() { return append().pipe(${local}.withSpan("s")); append(); }`,
];

const generated = fc.record({
  // One to three bindings of Effect in one file.
  spellings: fc.array(fc.constantFrom(...SPELLINGS), { minLength: 1, maxLength: 3 }),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((word) => `K${word}`),
  place: fc.constantFrom(...PLACES),
  wrapper: fc.constantFrom(...WRAPPERS),
  // Which binding the span is written through, and which the other steps are.
  span: fc.nat(),
  base: fc.nat(),
  at: fc.nat({ max: 2 }),
  passes: fc.array(fc.nat({ max: PASSES.length - 1 }), { minLength: 1, maxLength: 4 }),
});

it("O1 effect-functions: refuses a span wrapper a named function returns, in every spelling it reads, and passes an inner span", () => {
  fc.assert(
    fc.property(generated, ({ spellings, alias, place, wrapper, span, base, at, passes }) => {
      const bindings = Arr.dedupeWith(
        Arr.map(spellings, (spelling, i) => spelling(`${alias}${i}`)),
        (a, b) => a.header === b.header,
      );

      const local = (n: number) => bindings[n % bindings.length]!.local;

      const lines: ReadonlyArray<Line> = [
        ...Arr.map(bindings, ({ header }): Line => [header, 0]),
        ['import { Stream } from "effect";', 0],
        ['import * as Q from "effect/Stream";', 0],
        ['import { Effect as Foreign } from "./foreign.ts";', 0],
        ['import { Mine } from "./mine.ts";', 0],
        ["declare const append: () => unknown;", 0],
        [place(wrapper(local(span), local(base), at)), 1],
        ...Arr.map(passes, (form, i): Line => [PASSES[form]!(local(span + i), i), 0]),
      ];

      check("effect-functions", effectFunctions, lines);
    }),
    { seed: 119120, numRuns: 100 },
  );
});

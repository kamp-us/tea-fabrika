// The laws of reporting (Diagnostics.ts) under the test Layer (TestDiagnostics.ts): what `report` collects, in
// order, what it refuses, and that each build of the Layer starts empty. They are laws D5 to D7 of the
// approved plan for ticket 1917.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Cause, Effect, Exit, Result, Schema } from "effect";
import { between, blank, brokenPlace, type Break, goodCode, goodFields, SEED } from "./Diagnostic.test-support.ts";
import * as Diagnostic from "./Diagnostic.ts";
import * as Diagnostics from "./Diagnostics.ts";
import * as TestDiagnostics from "./TestDiagnostics.ts";

type Fields = Parameters<typeof Diagnostics.report>[1];

// One thing a handler reports: a code, which `make` declares, and good fields.
interface Item {
  readonly code: string;
  readonly fields: Fields;
}

const declare = (code: string): Diagnostic.Declared => Diagnostic.make(code, { explain: "A long text." });

const reportAll = (items: ReadonlyArray<Item>) =>
  Effect.forEach(items, ({ code, fields }) => Diagnostics.report(declare(code), fields), {
    concurrency: 1,
    discard: true,
  });

// What the test Layer should have collected for these items: each one's code and fields, in order.
const expected = (items: ReadonlyArray<Item>) => items.map(({ code, fields }) => ({ code, ...fields }));

// Reports the items under a fresh test Layer and reads back what it collected.
const collected = (items: ReadonlyArray<Item>) =>
  reportAll(items).pipe(Effect.andThen(TestDiagnostics.reported), Effect.provide(TestDiagnostics.layer));

// Up to four things, from a pool of three codes so a code repeats, each once or twice in a row so a whole
// report repeats too.
const items: Arbitrary.Arbitrary<ReadonlyArray<Item>> = Arbitrary.all({
  pool: Arbitrary.all([goodCode, goodCode, goodCode]),
  entries: Arbitrary.array(Arbitrary.all({ which: between(0, 2), fields: goodFields, times: between(1, 2) }), {
    maxLength: 4,
  }),
}).pipe(
  Arbitrary.map(({ pool, entries }) =>
    entries.flatMap(({ which, fields, times }) =>
      Array.from({ length: times }, () => ({ code: Arr.getUnsafe(pool, which), fields })),
    ),
  ),
);

// One thing, and another with the same code and other fields, to build the lists every run must hold.
const pair = Arbitrary.all({ code: goodCode, first: goodFields, second: goodFields });

// D5. Plant: keep only the last report, or drop a report that repeats the one before it.
describe("D5, report collects in order", () => {
  it.effect.prop(
    "reporting each of a list under the test Layer reads back the same list, in order, repeats kept",
    { list: items, pair },
    ({ list, pair: { code, first, second } }) =>
      Effect.gen(function* () {
        const a: Item = { code, fields: first };
        const b: Item = { code, fields: second };

        // Each run holds the cases a random list may miss: none, one, a code twice, a whole report twice.
        for (const each of [list, [], [a], [a, b], [a, a], [a, b, a]]) {
          expect(yield* collected(each)).toEqual(expected(each));
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// What is wrong with a report's fields: a blank message, a blank hint or a place the rules refuse.
interface Wrongs {
  readonly fields: Fields;
  readonly blanks: string;
  readonly place: Fields["place"];
}

const BAD_FIELDS: ReadonlyArray<Break<Wrongs, Fields>> = [
  { name: "a blank message", apply: ({ fields, blanks }) => ({ ...fields, message: blanks }) },
  { name: "a blank hint", apply: ({ fields, blanks }) => ({ ...fields, hint: blanks }) },
  { name: "a bad place", apply: ({ fields, place }) => ({ ...fields, place }) },
];

// The good things, a spot among them, and what a bad one is made of.
const withABadOne = Arbitrary.all({
  list: items,
  spot: between(0, 1000),
  code: goodCode,
  fields: goodFields,
  blanks: blank,
  place: brokenPlace,
});

// Whether an exit is a defect holding a SchemaError and no typed failure.
const diedOfSchemaError = <A, E>(exit: Exit.Exit<A, E>): boolean =>
  Exit.isFailure(exit) &&
  !Cause.hasFails(exit.cause) &&
  Result.match(Cause.findDefect(exit.cause), { onSuccess: Schema.isSchemaError, onFailure: () => false });

// D6. Plant: append the report before it is checked, and the bad one is collected; or fail with the error
// instead of dying, and the exit holds a typed failure.
describe("D6, bad fields die and report nothing", () => {
  it.effect.prop(
    "a report with a blank message or hint, or a bad place, dies with a SchemaError and collects nothing",
    { shape: withABadOne },
    ({ shape }) =>
      Effect.gen(function* () {
        const before = shape.list.slice(0, shape.spot % (shape.list.length + 1));

        // Each run puts every kind of bad fields at the spot, one after the other, each under its own Layer.
        for (const broken of BAD_FIELDS) {
          const bad: Item = {
            code: shape.code,
            fields: broken.apply({ fields: shape.fields, blanks: shape.blanks, place: shape.place }),
          };

          // The exit and what the Layer holds are read in one provide: the Layer is gone after it.
          const run = yield* reportAll([...before, bad]).pipe(
            Effect.exit,
            Effect.flatMap((exit) => Effect.map(TestDiagnostics.reported, (seen) => ({ exit, seen }))),
            Effect.provide(TestDiagnostics.layer),
          );

          expect(diedOfSchemaError(run.exit), broken.name).toBe(true);
          // The reports before the spot stay, and the bad one is not among them.
          expect(run.seen, broken.name).toEqual(expected(before));
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// D7. Plant: keep the Ref at the module's top level, and the second run sees the first run's reports.
describe("D7, each build starts empty", () => {
  it.effect.prop(
    "two runs, each with its own test Layer, each read only what they reported",
    { first: items, second: items },
    ({ first, second }) =>
      Effect.gen(function* () {
        const seenByFirst = yield* collected(first);

        const startOfSecond = yield* TestDiagnostics.reported.pipe(Effect.provide(TestDiagnostics.layer));

        const seenBySecond = yield* collected(second);

        expect(seenByFirst).toEqual(expected(first));
        expect(startOfSecond).toEqual([]);
        expect(seenBySecond).toEqual(expected(second));
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

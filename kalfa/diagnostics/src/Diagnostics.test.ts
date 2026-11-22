// The laws of reporting (Diagnostics.ts) under the test Layer (TestDiagnostics.ts): what `report` collects, in
// order, what it refuses, that each build of the Layer starts empty, and the span a report makes. They are
// laws D5 to D7 and D17.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Cause, Effect, Exit, Result, Schema } from "effect";
import {
  between,
  blank,
  blanksFrom,
  brokenPlaces,
  fieldVariants,
  goodCode,
  goodFields,
  goodFieldsAndParts,
  type Item,
  observed,
  placeParts,
  SEED,
} from "./Diagnostic.test-support.ts";
import * as Diagnostic from "./Diagnostic.ts";
import * as Diagnostics from "./Diagnostics.ts";
import * as TestDiagnostics from "./TestDiagnostics.ts";

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

// One item for each kind of odd good field: the message and hint into each kind of text, and the place into each
// class of each of the four kinds.
const oddItems = Arbitrary.all({ code: goodCode, drawn: goodFieldsAndParts }).pipe(
  Arbitrary.map(({ code, drawn }): ReadonlyArray<Item> => fieldVariants(drawn).map((fields) => ({ code, fields }))),
);

// D5. Plant: keep only the last report, or drop a report that repeats the one before it; drop `line` from a home
// place in the test Layer's append. Each plant of D2, D3, D18, D19 and D20 that refuses a good class turns this law
// red too: that report dies and is not collected.
describe("D5, report collects in order", () => {
  it.effect.prop(
    "reporting each of a list under the test Layer reads back the same list, in order, repeats kept",
    { list: items, pair, odd: oddItems },
    ({ list, pair: { code, first, second }, odd }) =>
      Effect.gen(function* () {
        const a: Item = { code, fields: first };
        const b: Item = { code, fields: second };

        // Each run holds the cases a random list may miss: none, one, a code twice, a whole report twice, and
        // one report for each kind of odd place, message and hint.
        for (const each of [list, [], [a], [a, b], [a, a], [a, b, a], odd]) {
          expect(yield* collected(each)).toEqual(expected(each));
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// Every bad set of fields a run tries: each kind of blank in the message and in the hint, and each bad place.
const badFields = ({
  fields,
  blanks,
  parts,
}: {
  readonly fields: Item["fields"];
  readonly blanks: string;
  readonly parts: Parameters<typeof brokenPlaces>[0];
}): ReadonlyArray<{ readonly name: string; readonly fields: object }> => [
  ...blanksFrom(blanks).flatMap((each) => [
    { name: `a blank message ${JSON.stringify(each)}`, fields: { ...fields, message: each } },
    { name: `a blank hint ${JSON.stringify(each)}`, fields: { ...fields, hint: each } },
  ]),
  ...brokenPlaces(parts).map(({ name, value }) => ({
    name: `a bad place, ${name}: ${JSON.stringify(value)}`,
    fields: { ...fields, place: value },
  })),
];

// The good things (a sample of the odd good ones first), a spot among them, and what a bad one is made of.
const withABadOne = Arbitrary.all({
  list: items,
  odd: oddItems,
  spot: between(0, 1000),
  code: goodCode,
  fields: goodFields,
  blanks: blank,
  parts: placeParts,
});

// Whether an exit is a defect holding a SchemaError and no typed failure.
const diedOfSchemaError = <A, E>(exit: Exit.Exit<A, E>): boolean =>
  Exit.isFailure(exit) &&
  !Cause.hasFails(exit.cause) &&
  Result.match(Cause.findDefect(exit.cause), { onSuccess: Schema.isSchemaError, onFailure: () => false });

// D6. Plant: append the report before it is checked, and the bad one is collected; or fail with the error
// instead of dying, and the exit holds a typed failure; or count only space, tab and line feed as blank, and a
// hint of a no-break space is collected; or drop the first-part rule from `isRepoPath`, and a repo place that
// starts with `~/` is collected. A plant of D2, D3, D18, D19 or D20 that refuses a kind of odd good report can
// make it die before the spot, so the list before the spot is short.
describe("D6, bad fields die and report nothing", () => {
  it.effect.prop(
    "a report with a blank message or hint, or a bad place of any kind, dies with a SchemaError and collects nothing",
    { shape: withABadOne },
    ({ shape }) =>
      Effect.gen(function* () {
        // Every eighth odd good report, so each run holds a spread of kinds and classes without a long list.
        const good = [...shape.odd.filter((_, index) => index % 8 === shape.spot % 8), ...shape.list];
        // The reports before the spot: those up to a drawn spot, and then all of them.
        const befores = [good.slice(0, shape.spot % (good.length + 1)), good];

        // Each run puts every kind of bad fields at the spot, one after the other, each under its own Layer.
        const bads = badFields({ fields: shape.fields, blanks: shape.blanks, parts: shape.parts });

        for (const before of befores) {
          for (const { name, fields } of bads) {
            // The exit and what the Layer holds are read in one provide: the Layer is gone after it.
            const run = yield* observed(shape.code, fields, before);

            expect(diedOfSchemaError(run.exit), name).toBe(true);
            // The reports before the spot stay, and the bad one is not among them.
            expect(run.reported, name).toEqual(expected(before));
          }
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

// D17 [secrets]. Plant: name the span `Diagnostics.report`; annotate a bare `code` or `severity`; add the message or
// the hint as an attribute; add `kalfa.diagnostics.place` with `formatPlace`'s text; put the path in
// `kalfa.diagnostics.place.type`; leave out `kalfa.diagnostics.place.type`.
describe("D17, the span", () => {
  it.effect.prop(
    "a report of any kind of place ends one span named diagnostics.report, with exactly the code, the severity and the kind of place under kalfa.diagnostics.*, and nothing of the message, the hint or the place",
    { code: goodCode, drawn: goodFieldsAndParts },
    ({ code, drawn }) =>
      Effect.gen(function* () {
        // The drawn fields, and the fields with the place made into each class of each kind.
        for (const fields of [drawn.fields, ...fieldVariants(drawn)]) {
          const { exit, spans } = yield* observed(code, fields);

          expect(Exit.isSuccess(exit)).toBe(true);
          expect(spans.map((span) => span.name)).toEqual(["diagnostics.report"]);

          const [span] = spans;

          expect(span?.status._tag).toBe("Ended");
          // Exactly these three attributes, so no other holds the message, the hint or any part of the place.
          expect(Object.fromEntries(span?.attributes ?? [])).toEqual({
            "kalfa.diagnostics.code": code,
            "kalfa.diagnostics.severity": fields.severity,
            "kalfa.diagnostics.place.type": fields.place._tag,
          });
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

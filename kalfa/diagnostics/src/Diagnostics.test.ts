// The laws of reporting (Diagnostics.ts) under the test Layer (TestDiagnostics.ts): what `report` collects, in
// order, what it refuses, that each build of the Layer starts empty, and the span a report makes. They are
// laws D5 to D7 and D17.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Cause, Effect, Exit, Result, Schema, Tracer } from "effect";
import {
  between,
  blank,
  blanksFrom,
  brokenPlace,
  fieldVariants,
  goodCode,
  goodFields,
  goodFieldsAndParts,
  SEED,
} from "./Diagnostic.test-support.ts";
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

// One item for each kind of odd good field: the message and hint into each kind of text, the place into each
// kind of path segment.
const oddItems = Arbitrary.all({ code: goodCode, drawn: goodFieldsAndParts }).pipe(
  Arbitrary.map(({ code, drawn }): ReadonlyArray<Item> => fieldVariants(drawn).map((fields) => ({ code, fields }))),
);

// D5. Plant: keep only the last report, or drop a report that repeats the one before it. Each plant of D2 and D3
// that refuses a kind of odd path or text turns this law red too: that report dies and is not collected.
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

// What is wrong with a report's fields: a blank message, a blank hint or a place the rules refuse.
interface Wrongs {
  readonly fields: Fields;
  readonly blanks: string;
  readonly place: Fields["place"];
}

// Every bad set of fields a run tries: each kind of blank in the message and in the hint, and the bad place.
const badFields = ({ fields, blanks, place }: Wrongs): ReadonlyArray<{ name: string; fields: Fields }> => [
  ...blanksFrom(blanks).flatMap((each) => [
    { name: `a blank message ${JSON.stringify(each)}`, fields: { ...fields, message: each } },
    { name: `a blank hint ${JSON.stringify(each)}`, fields: { ...fields, hint: each } },
  ]),
  { name: "a bad place", fields: { ...fields, place } },
];

// The good things (the odd good ones first), a spot among them, and what a bad one is made of.
const withABadOne = Arbitrary.all({
  list: items,
  odd: oddItems,
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
// instead of dying, and the exit holds a typed failure; or count only space, tab and line feed as blank, and a
// hint of a no-break space is collected. A plant of D2 or D3 that refuses a kind of odd good report makes it die
// before the spot, so the list before the spot is short.
describe("D6, bad fields die and report nothing", () => {
  it.effect.prop(
    "a report with a blank message or hint, or a bad place, dies with a SchemaError and collects nothing",
    { shape: withABadOne },
    ({ shape }) =>
      Effect.gen(function* () {
        const good = [...shape.odd, ...shape.list];
        // The reports before the spot: those up to a drawn spot, and then all of them.
        const befores = [good.slice(0, shape.spot % (good.length + 1)), good];

        // Each run puts every kind of bad fields at the spot, one after the other, each under its own Layer.
        const bads = badFields({ fields: shape.fields, blanks: shape.blanks, place: shape.place });

        for (const before of befores) {
          for (const { name, fields } of bads) {
            const bad: Item = { code: shape.code, fields };

            // The exit and what the Layer holds are read in one provide: the Layer is gone after it.
            const run = yield* reportAll([...before, bad]).pipe(
              Effect.exit,
              Effect.flatMap((exit) => Effect.map(TestDiagnostics.reported, (seen) => ({ exit, seen }))),
              Effect.provide(TestDiagnostics.layer),
            );

            expect(diedOfSchemaError(run.exit), name).toBe(true);
            // The reports before the spot stay, and the bad one is not among them.
            expect(run.seen, name).toEqual(expected(before));
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

// Reports one thing under a recording tracer, and answers the spans the tracer was asked to make.
const recordedSpans = ({ code, fields }: Item) =>
  Effect.gen(function* () {
    const delegate = yield* Tracer.Tracer;
    const spans: Array<Tracer.Span> = [];

    const tracer = Tracer.make({
      span(options) {
        const span = delegate.span(options);
        spans.push(span);

        return span;
      },
    });

    yield* Diagnostics.report(declare(code), fields).pipe(
      Effect.withTracer(tracer),
      Effect.provide(TestDiagnostics.layer),
    );

    return spans;
  });

// D17. Plant: name the span `Diagnostics.report`; annotate a bare `code` or `severity`; add the message or the
// hint as an attribute.
describe("D17, the span", () => {
  it.effect.prop(
    "a report ends one span named diagnostics.report, with the code and the severity under kalfa.diagnostics.* and no message or hint",
    { code: goodCode, fields: goodFields },
    ({ code, fields }) =>
      Effect.gen(function* () {
        const spans = yield* recordedSpans({ code, fields });

        expect(spans.map((span) => span.name)).toEqual(["diagnostics.report"]);

        const [span] = spans;

        expect(span?.status._tag).toBe("Ended");
        expect(span?.attributes.get("kalfa.diagnostics.code")).toBe(code);
        expect(span?.attributes.get("kalfa.diagnostics.severity")).toBe(fields.severity);
        expect(span?.attributes.has("code")).toBe(false);
        expect(span?.attributes.has("severity")).toBe(false);

        const others = [...(span?.attributes ?? [])]
          .filter(([key]) => key !== "kalfa.diagnostics.code" && key !== "kalfa.diagnostics.severity")
          .map(([, value]) => value);

        expect(others).not.toContain(fields.message);
        expect(others).not.toContain(fields.hint);
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// The laws of reporting (Diagnostics.ts) under the test Layer (TestDiagnostics.ts): what `report` collects, in
// order, what it refuses, that each build of the Layer starts empty, and the span a report makes. They are
// laws D5 to D7 and D17.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Effect, Exit, Option } from "effect";
import {
  badHeld,
  between,
  blank,
  blanksFrom,
  brokenPlaces,
  CarryingError,
  carriers,
  diedOfSchemaError,
  everyClass,
  fieldVariants,
  goodCode,
  goodFields,
  goodFieldsAndParts,
  goodText,
  type Item,
  leftBehind,
  observed,
  observedCarried,
  placeParts,
  readWatched,
  expectedReport,
  type Failure,
  rootedAtLogin,
  SEED,
  schemaErrorIn,
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

// What one drawn entry of a list is: a code, fields (drawn or made odd), and the pieces the values that carry nothing
// are made from. `kind` picks which class of value it stands for.
const entry = Arbitrary.all({
  code: goodCode,
  drawn: goodFieldsAndParts,
  variant: between(0, 1000000),
  kind: between(0, 1000000),
  text: goodText,
  count: between(-100000, 100000),
});

type Entry = typeof entry extends Arbitrary.Arbitrary<infer Drawn> ? Drawn : never;

/** A value to hand the handler, and the reports it must make of it: none unless the value carries. */
interface Step {
  readonly value: Failure;
  readonly reports: ReadonlyArray<ReturnType<typeof expectedReport>>;
}

// The one value an entry stands for.
const toStep = ({ code, drawn, variant, kind, text, count }: Entry): Step => {
  const declared = declare(code);
  const choices = [drawn.fields, ...fieldVariants(drawn)];
  const spread = Arr.getUnsafe(choices, variant % choices.length);
  const every = everyClass(declared, spread, { text, count });
  const one = Arr.getUnsafe(every, kind % every.length);

  return { value: one.value, reports: one.carries ? [expectedReport(declared, spread)] : [] };
};

// One value of each class (a) to (f), made from an entry.
const everyOnce = ({ code, drawn, text, count }: Entry): ReadonlyArray<Step> => {
  const declared = declare(code);

  return everyClass(declared, drawn.fields, { text, count }).map((one) => ({
    value: one.value,
    reports: one.carries ? [expectedReport(declared, drawn.fields)] : [],
  }));
};

const carriedRun = Arbitrary.all({
  list: Arbitrary.array(entry, { maxLength: 6 }),
  once: entry,
  bad: Arbitrary.all({ code: goodCode, fields: goodFields, blanks: blank, parts: placeParts }),
  spot: between(0, 1000),
});

// D30. Plant: (j) widen the carried severity to whatever the fields hold, and a smuggled "warning" is collected as a
// warning; (h) drop a home place's column in `carry`, and the collected place differs; (i) answer none from
// `fromError` when the fields would not decode, and the bad one is skipped and the run does not die.
describe("D30, carried, then reported", () => {
  it.effect.prop(
    "a handler that reads each value with fromError and reports what is carried collects exactly the carried ones, in order, as errors; a carrier of bad fields kills the run with a SchemaError after the good reports before it",
    { run: carriedRun },
    ({ run }) =>
      Effect.gen(function* () {
        const drawn = run.list.map(toStep);
        const once = everyOnce(run.once);

        // The drawn list, and one value of each class (a) to (f).
        for (const steps of [drawn, once]) {
          const handled = yield* observedCarried(steps.map(({ value }) => value));

          expect(Exit.isSuccess(handled.exit)).toBe(true);
          expect(handled.reported).toEqual(steps.flatMap(({ reports }) => reports));
        }

        // Each bad set of fields, carried by each class of carrier in turn, at a spot among the good values.
        const good = [...drawn, ...once];
        const before = good.slice(0, run.spot % (good.length + 1));
        const after = good.slice(before.length);
        const declared = declare(run.bad.code);

        for (const [index, { name, held }] of badHeld(run.bad).entries()) {
          const carrier = Arr.getUnsafe(carriers(declared, { ...held, severity: run.bad.fields.severity }), index % 3);

          const handled = yield* observedCarried([
            ...before.map(({ value }) => value),
            carrier.value,
            ...after.map(({ value }) => value),
          ]);

          expect(diedOfSchemaError(handled.exit), name).toBe(true);
          // The reports before the spot stay, and the bad one is not among them.
          expect(handled.reported, name).toEqual(before.flatMap(({ reports }) => reports));
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// A code a login's path is carried under. It holds no digit, so a login that holds one is never in it by chance.
const LEAK = declare("demo/leak");

// D31 [secrets]. A login holds a digit, so no fixed word of a message can hold it by chance. Each login in each root
// (k) is carried as a repo place and as a home place, on a class getter, with a fixed message and hint.
// Plant: check the place in `carry` and throw `new Error(JSON.stringify(fields.place))` on a bad one, and the thrown
// message holds the login.
describe("D31, a carried login goes nowhere", () => {
  it.effect.prop(
    "a path under any machine's home root, carried as a repo place or a home place, is read and carried with no throw and no span, and reporting it dies with a SchemaError that holds the login in no output",
    { drawn: placeParts },
    ({ drawn }) =>
      Effect.gen(function* () {
        for (const rooted of rootedAtLogin(drawn)) {
          for (const { name, value } of rooted.places) {
            const label = `${rooted.name}, ${name}`;

            const error = new CarryingError({
              declared: LEAK,
              message: "m",
              place: value,
              hint: "h",
              severity: "error",
            });

            // Reading it throws nothing and makes no span: only a report makes one.
            const read = yield* readWatched(error);

            expect(Option.isSome(read.found), label).toBe(true);
            expect(read.spans, label).toEqual([]);

            const run = yield* observedCarried([error]);
            const refusal = schemaErrorIn(run.exit);

            expect(refusal, label).toBeDefined();
            expect(run.reported, label).toEqual([]);
            expect(
              run.spans.map((span) => span.name),
              label,
            ).toEqual(["diagnostics.report"]);

            const outputs = [
              ...leftBehind(refusal),
              JSON.stringify(run.reported),
              JSON.stringify(run.spans.flatMap((span) => [...span.attributes])),
            ];

            for (const output of outputs) {
              expect(output, label).not.toContain(rooted.login);
            }
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

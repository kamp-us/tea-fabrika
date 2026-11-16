// Decision 0580: a law's plant and label are options of its declaration, carried in vitest's own
// `meta`; and the package's `it` runs a property on fast-check inputs too, each case in its own Scope
// (0579, docs/plan/quests/law-options-0580-PLAN.md). Written before `Law.ts`, against the shape the
// plan gives: `it`, `it.effect`, `it.live`, `it.prop` and `it.effect.prop`, each taking its options
// last, and `toTestOptions`, which turns them into vitest's. A property's body is called with its
// values and the test's context, as `@effect/vitest`'s is.
//
// The laws that must see a law fail, time out or run twice run it in a vitest of their own:
// Law.integration.test.ts.
import { describe, expect } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import type { TestContext } from "vitest";
import { it, type LawOptions, toTestOptions } from "./Law.ts";

const SEED = 119120;
const LABELS = ["vector", "format", "scenario", "type", "pinned"] as const;

/** One label with its reason, or none: the five keys of 0580, a pinned law naming a ticket. */
const label = fc.option(
  fc.oneof(
    fc
      .constantFrom("vector", "format", "scenario", "type")
      .chain((name) => fc.string({ minLength: 1, maxLength: 12 }).map((reason) => ({ name, reason }))),
    fc.integer({ min: 1, max: 9999 }).map((reason) => ({ name: "pinned" as const, reason })),
  ),
  { nil: null },
);

/** vitest's own options that the package passes through unchanged. */
const passed = fc.record(
  {
    timeout: fc.integer({ min: 1, max: 60_000 }),
    retry: fc.integer({ min: 0, max: 3 }),
    repeats: fc.integer({ min: 0, max: 3 }),
    concurrent: fc.boolean(),
    tags: fc.array(fc.constantFrom("db", "slow", "ledger"), { maxLength: 2 }),
  },
  { requiredKeys: [] },
);

// Plant: drop `retry` from what passes through.
it("toTestOptions puts the plant and the label in meta, with its tag and reason, and passes every other vitest option through unchanged", () => {
  fc.assert(
    fc.property(fc.option(fc.string({ maxLength: 20 }), { nil: null }), label, passed, (plant, named, rest) => {
      const options: LawOptions = {
        ...rest,
        ...(plant === null ? {} : { plant }),
        ...(named === null ? {} : named.name === "pinned" ? { pinned: named.reason } : { [named.name]: named.reason }),
      };
      const { meta, ...vitest } = toTestOptions(options);
      expect(vitest).toEqual(rest);
      expect(meta ?? {}).toEqual({
        ...(plant === null ? {} : { plant }),
        ...(named === null ? {} : { label: { _tag: named.name, reason: named.reason } }),
      });
    }),
    {
      seed: SEED,
      numRuns: 100,
      examples: [
        ["", null, {}],
        [null, { name: "pinned", reason: 1497 }, { retry: 0 }],
      ],
    },
  );
});

/** What a law registered with `{ plant, [label]: reason }` must find in its own task's meta. */
const reads = (ctx: TestContext, plant: string, tag: (typeof LABELS)[number], reason: string | number) => {
  expect(ctx.task.meta.plant).toBe(plant);
  expect(ctx.task.meta.label).toEqual({ _tag: tag, reason });
};

// scenario: registration happens once per member at collection, so there is nothing to generate.
// Each member registers one law with its own plant and label, and that law reads them back from its
// own task. Plant: leave `meta` off in the `it.effect.prop` member.
describe("scenario: a law registered through each member reads its own plant and label from ctx.task.meta", () => {
  it("scenario: it carries its options", (ctx) => reads(ctx, "plant it", "vector", "the row on main"), {
    plant: "plant it",
    vector: "the row on main",
  });
  it.effect(
    "scenario: it.effect carries its options",
    (ctx) => Effect.sync(() => reads(ctx, "plant effect", "format", "the JSON line")),
    { plant: "plant effect", format: "the JSON line" },
  );
  it.live(
    "scenario: it.live carries its options",
    (ctx) => Effect.sync(() => reads(ctx, "plant live", "pinned", 1497)),
    { plant: "plant live", pinned: 1497 },
  );
  it.prop(
    "it.prop carries its options, on Effect inputs",
    { n: Schema.Int },
    (_, ctx) => {
      reads(ctx, "plant prop", "scenario", "one case per run");
    },
    { plant: "plant prop", scenario: "one case per run", arbitrary: { runs: 3 } },
  );
  it.effect.prop(
    "it.effect.prop carries its options, on fast-check inputs",
    { n: fc.nat() },
    (_, ctx) => Effect.sync(() => reads(ctx, "plant effect prop", "type", "the compiler")),
    { plant: "plant effect prop", type: "the compiler", fastCheck: { numRuns: 3 } },
  );
});

// Plant: run the cases in one `Effect.scoped` around the whole run.
describe("with fast-check inputs, each case runs in its own Scope, closed before the next case opens", () => {
  // The case counts, drawn once from the shared seed: each is one law, run for that many cases.
  const counts = fc.sample(fc.integer({ min: 3, max: 30 }), { seed: SEED, numRuns: 30 });
  const seen = counts.map(() => ({ opened: 0, closed: 0 }));

  counts.forEach((count, at) => {
    const tally = seen[at] ?? { opened: 0, closed: 0 };
    it.effect.prop(
      `a run of ${count} cases (law ${at}) closes each case's scope before the next opens`,
      { n: fc.integer() },
      () =>
        Effect.gen(function* () {
          // Every case before this one has closed its scope.
          expect(tally.closed).toBe(tally.opened);
          tally.opened += 1;
          yield* Effect.addFinalizer(() => Effect.sync(() => (tally.closed += 1)));
        }),
      { fastCheck: { numRuns: count } },
    );
  });

  // Coverage, after the laws above in this describe, which run in order: each ran every case it was
  // given, each in a scope that closed. A law that ran no case would leave its count at zero.
  it("scenario: every law above ran each of its cases, and closed each case's scope", () => {
    expect(seen).toEqual(counts.map((count) => ({ opened: count, closed: count })));
  });
});

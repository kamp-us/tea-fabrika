// One setting, `KALFA_QUALITY_VITEST_DEPTH`, picks how many cases a law over real input and output runs.
// `fast` is the default, `full` is the schedule's word, and a `fast` count is held between `LEAST` and the
// law's full count. V1 holds that the setting is read from that variable only, and at load.
import { expect, it, vi } from "@effect/vitest";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import { decodeDepth, depth, LEAST, runsAt, runsFor } from "./Depth.ts";

const SEED = 119120;

/** A law's two counts, inside what `runsAt` takes. */
const Counts = fc
  .integer({ min: 1, max: 1000 })
  .chain((full) => fc.record({ fast: fc.integer({ min: Math.min(LEAST, full), max: full }), full: fc.constant(full) }));

it.effect("pinned: unset is fast, the two words name themselves, and this run reads KALFA_QUALITY_VITEST_DEPTH", () =>
  Effect.gen(function* () {
    expect(decodeDepth(undefined)).toBe("fast");
    expect(decodeDepth("fast")).toBe("fast");
    expect(decodeDepth("full")).toBe("full");
    const set = yield* Config.option(Config.String("KALFA_QUALITY_VITEST_DEPTH"));
    expect(depth).toBe(decodeDepth(Option.getOrUndefined(set)));
  }),
);

it("any other value fails the run rather than falling back to a depth", () => {
  fc.assert(
    fc.property(
      fc.string().filter((value) => value !== "fast" && value !== "full"),
      (value) => {
        expect(() => decodeDepth(value)).toThrow();
      },
    ),
    { seed: SEED, numRuns: 100, examples: [["Full"], [""], ["ful"], ["FAST"]] },
  );
});

it("fast runs its own count, full runs the law's count, and runsFor follows this run's depth", () => {
  fc.assert(
    fc.property(Counts, (runs) => {
      expect(runsAt("fast", runs)).toBe(runs.fast);
      expect(runsAt("full", runs)).toBe(runs.full);
      expect(runsFor(runs)).toBe(runsAt(depth, runs));
    }),
    { seed: SEED, numRuns: 100, examples: [[{ fast: 10, full: 100 }], [{ fast: 1, full: 1 }], [{ fast: 3, full: 3 }]] },
  );
});

it("a fast count above full, under LEAST, not whole, or a full under one fails at both depths", () => {
  const Bad = fc.oneof(
    Counts.map(({ full }) => ({ fast: full + 1, full })),
    fc.integer({ min: LEAST, max: 1000 }).map((full) => ({ fast: LEAST - 1, full })),
    Counts.map(({ fast, full }) => ({ fast: fast + 0.5, full })),
    Counts.map(({ fast, full }) => ({ fast, full: full + 0.5 })),
    fc.integer({ min: -5, max: 0 }).map((full) => ({ fast: full, full })),
  );

  fc.assert(
    fc.property(Bad, fc.constantFrom("fast" as const, "full" as const), (runs, at) => {
      expect(() => runsAt(at, runs)).toThrow(/runsFor/);
    }),
    {
      seed: SEED,
      numRuns: 100,
      examples: [
        [{ fast: 2, full: 100 }, "full"],
        [{ fast: 0, full: 1 }, "fast"],
      ],
    },
  );
});

const NEW = "KALFA_QUALITY_VITEST_DEPTH";

const OLD = "FABRIKA_TEST_DEPTH";

/** A word that is neither depth, the empty string and a wrong case included. */
const Other = Schema.Union([
  Schema.Literals(["Full", "FAST", "", " full", "ful"]),
  Schema.String.check(Schema.makeFilter((word) => word !== "fast" && word !== "full")),
]);

/** What a variable may hold in a run: unset, a depth, or another word. */
const Setting = Schema.Union([Schema.Undefined, Schema.Literals(["fast", "full"]), Other]);

/** The load of `Depth.ts` threw: the one kind of failure the law reads. */
class LoadFailed extends Schema.TaggedError<LoadFailed, { readonly brand: unique symbol }>()("LoadFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * Loads a fresh `Depth.ts` while the two variables hold what is given (unset is `undefined`), and puts them back as
 * they were. Resetting the module registry first makes the import run the file again, so its top-level read of the
 * environment runs again on each call. The exit is the answer: the depth it read, or the failure the load threw.
 */
const loaded = (env: { readonly next: string | undefined; readonly old: string | undefined }) =>
  Effect.exit(
    Effect.acquireUseRelease(
      Effect.sync(() => {
        vi.stubEnv(NEW, env.next);
        vi.stubEnv(OLD, env.old);
        vi.resetModules();
      }),
      () =>
        Effect.map(
          Effect.tryPromise({ try: () => import("./Depth.ts"), catch: (cause) => LoadFailed.make({ cause }) }),
          (module) => module.depth,
        ),
      () =>
        Effect.sync(() => {
          vi.unstubAllEnvs();
        }),
    ),
  );

// V1. Five kinds of pair, each built in every case, so no seed and no capped run leaves one unread: (a) the new variable
// unset and the old one `full`; (b) the new `full`, the old anything; (c) the new `fast` and the old `full`; (d) the new
// another word, the old anything; (e) both unset. The drawn pair is read once more as it came.
// Plants: read FABRIKA_TEST_DEPTH in place of the new name (a); fall back to it when the new one is unset (a); ignore the
// environment and answer fast (b); read the old variable first (c); answer fast for an unknown word (d); make full the
// default (e). Each is red on its own kind.
it.effect.prop(
  "V1 property: the depth is read only from KALFA_QUALITY_VITEST_DEPTH, at load: unset is fast, the two words name themselves, any other word fails the load, and FABRIKA_TEST_DEPTH is never read",
  { next: Setting, old: Setting, other: Other },
  ({ next, old, other }) =>
    Effect.gen(function* () {
      expect(yield* loaded({ next: undefined, old: "full" }), "a: unset, the old one full").toEqual(
        Exit.succeed("fast"),
      );
      expect(yield* loaded({ next: "full", old }), "b: full, the old one anything").toEqual(Exit.succeed("full"));
      expect(yield* loaded({ next: "fast", old: "full" }), "c: fast, the old one full").toEqual(Exit.succeed("fast"));
      expect(
        Exit.isFailure(yield* loaded({ next: other, old })),
        `d: ${JSON.stringify(other)}, the old one anything`,
      ).toBe(true);
      expect(yield* loaded({ next: undefined, old: undefined }), "e: both unset").toEqual(Exit.succeed("fast"));

      const drawn = yield* loaded({ next, old });
      expect(Exit.isSuccess(drawn), "the drawn pair loads exactly when the new variable is unset or a depth").toBe(
        next === undefined || next === "fast" || next === "full",
      );

      if (Exit.isSuccess(drawn)) {
        expect(drawn.value).toBe(next === "full" ? "full" : "fast");
      }
    }),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// Decision 0535: one setting picks how many cases a law over real IO runs. `fast` is the default, the
// 3-hour schedule says `full`, and a `fast` count is held between `LEAST` and the law's full count.
import { expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { decodeDepth, depth, LEAST, runsAt, runsFor } from "./TestDepth.test-support.ts";

const SEED = 119120;

/** A law's two counts, inside what `runsAt` takes. */
const Counts = fc
  .integer({ min: 1, max: 1000 })
  .chain((full) => fc.record({ fast: fc.integer({ min: Math.min(LEAST, full), max: full }), full: fc.constant(full) }));

it("pinned: unset is fast, the two words name themselves, and this run reads FABRIKA_TEST_DEPTH", () => {
  expect(decodeDepth(undefined)).toBe("fast");
  expect(decodeDepth("fast")).toBe("fast");
  expect(decodeDepth("full")).toBe("full");
  expect(depth).toBe(decodeDepth(process.env.FABRIKA_TEST_DEPTH));
});

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

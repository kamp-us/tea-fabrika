import { Array as Arr } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Git, MAX_RELATED, narrow, PLAIN, plan, usable } from "./range.ts";

// Today's lead tooling. Covers range.ts: the range is cut to what the container can finish.
const options = { seed: 119120, numRuns: 300 };

/** A chain of `n + 1` commits (the base at 0, the head at n) with each one's related-file count, falling to 0 at the head. */
const chain = fc
  .array(fc.integer({ min: 0, max: 900 }), { minLength: 0, maxLength: 60 })
  .map((counts) => counts.toSorted((a, b) => b - a))
  .map((counts) => [...counts, 0]);

const names = (counts: ReadonlyArray<number>) => counts.map((_, i) => `c${i}`);

/** The related-file count of the commit called `c<i>`. */
const related = (counts: ReadonlyArray<number>, commit: string) => counts[Number(commit.slice(1))] ?? Infinity;

describe("the mutation range, today's tooling: the cap", () => {
  it("the new base holds at most the cap of related files, and is the oldest commit that does, unless it is the last one before the head", () => {
    fc.assert(
      fc.property(chain, fc.integer({ min: 1, max: 40 }), (counts, max) => {
        const commits = names(counts);
        const calls: string[] = [];

        const at = narrow(
          commits,
          (c) => {
            calls.push(c);

            return related(counts, c);
          },
          max,
        );

        const last = Math.max(commits.length - 2, 0);

        expect(at).toBeLessThanOrEqual(last);
        expect(at === last || (counts[at] ?? Infinity) <= max).toBe(true);

        // The oldest: the commit before it holds more than the cap (counts only fall along the chain).
        if (at > 0) {
          expect(counts[at - 1] ?? 0).toBeGreaterThan(max);
        }

        // A binary search, never a walk: at most log2 of the chain, plus one.
        expect(calls.length).toBeLessThanOrEqual(Math.ceil(Math.log2(commits.length)) + 1);
      }),
      options,
    );
  });

  it("a range already within the cap is left whole", () => {
    fc.assert(
      fc.property(chain, (counts) => {
        const within = Arr.map(counts, (c) => Math.min(c, MAX_RELATED));
        expect(narrow(names(within), (c) => related(within, c), MAX_RELATED)).toBe(0);
      }),
      options,
    );
  });

  // vector: 2026-11-26, 667 commits and 824 related test files after the run died; the last commit alone is within the cap.
  it("vector: a 667-commit range of 824 files is cut to a base with at most 12", () => {
    const counts = Array.from({ length: 668 }, (_, i) => Math.round((824 * (667 - i)) / 667));
    const at = narrow(names(counts), (c) => related(counts, c), 12);
    expect(counts[at]).toBeLessThanOrEqual(12);
    expect(counts[at - 1]).toBeGreaterThan(12);
    expect(at).toBeGreaterThan(600);
  });

  // vector: a single commit with more files than the cap is still mutated, never skipped forever.
  it("vector: one commit over the cap is the range, not nothing", () => {
    expect(narrow(["base", "head"], () => 50, 12)).toBe(0);
    expect(narrow(["head"], () => 0, 12)).toBe(0);
    expect(narrow(["a", "b", "head"], (c) => (c === "head" ? 0 : 50), 12)).toBe(1);
  });

  it("the default cap is 12", () => {
    expect(MAX_RELATED).toBe(12);
  });
});

describe("the mutation range, today's tooling: the related tests", () => {
  it("scenario: only a plain test path that exists at the head is used", () => {
    const tracked = ["a/x.ts", "a/x.test.ts", "a/y.ts", "a/z.ts", "a/z.test.ts", "a/z.laws.test.ts", "b/w.ts"];

    expect(usable(["a/x.ts", "a/y.ts", "a/z.ts", "b/w.ts"], tracked)).toEqual([
      "a/x.test.ts",
      "a/z.laws.test.ts",
      "a/z.test.ts",
    ]);
  });

  it("scenario: a path mutbox would refuse is left out", () => {
    expect(PLAIN.test("a/x.test.ts")).toBe(true);
    expect(PLAIN.test("-a/x.test.ts")).toBe(false);
    expect(PLAIN.test("a/x;rm.test.ts")).toBe(false);
  });
});

describe("the mutation range, today's tooling: the pick it hands to mutbox", () => {
  // Plant: take `PLAIN.test(t)` out of `usable`.
  it("scenario: a test path mutbox would refuse is left out even when it exists at the head", () => {
    expect(usable(["-a/x.ts"], ["-a/x.ts", "-a/x.test.ts"])).toEqual([]);
    expect(usable(["a/x.ts"], ["a/x.ts", "a/x.test.ts"])).toEqual(["a/x.test.ts"]);
  });

  // Plant: take the `/../` filter out of `usable`.
  it("scenario: a path that climbs out of its folder is left out", () => {
    expect(usable(["a/../b/x.ts"], ["a/../b/x.ts", "a/../b/x.test.ts"])).toEqual([]);
  });

  /** A history c0 (the base) to c5 (the head), each commit changing `f<i>.ts` with its test at the head. */
  const history = (calls: string[][]): Git => {
    const commits = ["c0", "c1", "c2", "c3", "c4", "c5"];
    const files = commits.flatMap((_, i) => (i === 0 ? [] : [`f${i}.ts`, `f${i}.test.ts`]));

    return (args) => {
      calls.push([...args]);
      const [verb, ...rest] = args;
      const key = args.join(" ");

      if (verb === "ls-tree") {
        return files.join("\n");
      }

      if (key === "rev-list --first-parent --reverse c0..c5") {
        return commits.slice(1).join("\n");
      }

      if (verb === "diff") {
        const from = commits.indexOf(rest[2] ?? "");

        return commits
          .slice(from + 1)
          .map((_, i) => `f${from + 1 + i}.ts`)
          .join("\n");
      }

      const cut = /^rev-list c0\.\.(c\d)$/.exec(key)?.[1];

      if (cut !== undefined) {
        return commits.slice(1, commits.indexOf(cut) + 1).join("\n");
      }

      throw new Error(`unexpected git call: ${key}`);
    };
  };

  it("scenario: the plan names the new base, its related tests, the files wanted and the commits left out, counted from the base to the new base", () => {
    const calls: string[][] = [];

    expect(plan("c0", "c5", 2, history(calls))).toEqual({
      base: "c3",
      related: "f4.test.ts,f5.test.ts",
      wanted: 5,
      left: 3,
    });
    expect(calls).toContainEqual(["rev-list", "c0..c3"]);
  });

  it("scenario: a range within the cap is whole, with nothing left out", () => {
    expect(plan("c0", "c5", 9, history([]))).toEqual({
      base: "c0",
      related: "f1.test.ts,f2.test.ts,f3.test.ts,f4.test.ts,f5.test.ts",
      wanted: 5,
      left: 0,
    });
  });
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll } from "@effect/vitest";
import { Effect, Record as Rec, Schema } from "effect";
import { Config, Effect } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { readers } from "./changes.mjs";
import {
  budgetOf,
  fewest,
  type Legs,
  limits,
  outputs,
  room,
  type Run,
  SETUP,
  shards,
  size,
  split,
  withReaders,
} from "./legs.ts";
import { nextFiles, visualFiles } from "./shard-rows.ts";
import { e2eLegs, nextMinutes, vitestLegs } from "./workflow-lint.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

// Today's CI, next/. Covers legs.ts, which sizes the next job's matrix on the merge line: a pull
// request, a merge queue group and a push to main (0534). Paths are the real next/ files Vitest
// selects; seconds come from a scratch table, so a law holds for any table, not only today's. Each
// plant was run once on legs.ts and restored; each turned its law red.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const workflow = readFileSync(join(ROOT, ".github/workflows/check.yaml"), "utf8");

const full: Legs = { vitest: vitestLegs(workflow).length, e2e: e2eLegs(workflow).length };

// The size step's BUDGET setting, as check.yaml declares it once and the step passes it.
const budget = budgetOf(String(workflow.match(/^ {10}BUDGET: (.*)$/m)?.[1]));

const limit = limits(nextMinutes(workflow), budget);

const options = { seed: 119120, numRuns: 100 };

const base = "b".repeat(40);

// A pull request that asked for its visual tests with the `visual` label, and one that did not (0536).
const pr: Run = { event: "pull_request", scope: "all", base, visual: true };

const plainPr: Run = { ...pr, visual: false };

// A merge line run that tests all of next/ from a base commit, the runs legs.ts sizes (0534), with
// the visual flag either way: only a pull request's counts (0536).
const line = fc
  .tuple(fc.constantFrom("pull_request", "merge_group", "push"), fc.stringMatching(/^[a-f0-9]{40}$/), fc.boolean())
  .filter(([, sha]) => !/^0+$/.test(sha))
  .map(([event, sha, visual]): Run => ({ event, scope: "all", base: sha, visual }));

let vitest: string[] = [];

let e2e: string[] = [];

beforeAll(() =>
  Effect.gen(function* () {
    [vitest, e2e] = yield* promised(() => Promise.all([nextFiles(ROOT), visualFiles(ROOT)]));
  }),
);

/** Some of the real files, with a scratch table that gives each a row or none. */
const picked = () =>
  fc
    .tuple(
      fc.subarray(vitest),
      fc.subarray(e2e),
      fc.array(fc.option(fc.double({ min: 0, max: 600, noNaN: true }), { nil: undefined }), {
        minLength: vitest.length + e2e.length,
        maxLength: vitest.length + e2e.length,
      }),
    )
    .map(([some, ends, seconds]) => {
      const table: Record<string, number> = {};

      for (const [i, path] of [...vitest, ...e2e].entries()) {
        if (seconds[i] !== undefined) {
          table[path] = seconds[i];
        }
      }

      return { selected: { vitest: some, e2e: ends }, table };
    });

/** A file's seconds as legs.ts counts them: its row, else the table's median. */
const total = (files: readonly string[], table: Readonly<Record<string, number>>) => {
  const rows = Rec.values(table).toSorted((a, b) => a - b);
  const unmeasured = rows[Math.floor((rows.length - 1) / 2)] ?? 1;

  return files.reduce((sum, path) => sum + (Rec.has(table, path) ? table[path]! : unmeasured), 0);
};

it("property: no selection gives no legs, so next skips", () => {
  // Plant: `Math.min(most, files.length)` as `most` (red: no file gave a leg of each kind).
  fc.assert(
    fc.property(picked(), ({ table }) => {
      const legs = size(pr, { vitest: [], e2e: [] }, full, limit, table);
      expect(legs).toEqual({ vitest: 0, e2e: 0 });
      expect(shards(legs)).toEqual([]);
    }),
    options,
  );
});

it("property: a selection whose seconds fit the budget gives one leg", () => {
  // Up to 6 real files of either kind, each with a row of at most a sixth of that kind's limit or
  // none, so the total is at most the limit. Plant: start the count search at 2 legs (red here, and
  // in the full-selection scenario).
  const small = fc
    .tuple(
      fc.constantFrom("vitest", "e2e"),
      fc.integer({ min: 1, max: 6 }),
      fc.array(fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }), {
        minLength: 6,
        maxLength: 6,
      }),
      fc.nat(),
    )
    .map(([kind, count, shares, at]) => {
      const pool = kind === "vitest" ? vitest : e2e;
      const most = (kind === "vitest" ? limit.vitest : limit.e2e) / 6;
      const files = Array.from(new Set(Array.from({ length: count }, (_, i) => pool[(at + i * 7) % pool.length]!)));

      const table = Rec.fromEntries(
        files.flatMap((path, i) => (shares[i] === undefined ? [] : [[path, shares[i] * most]])),
      );

      return { kind, files, table };
    });

  fc.assert(
    fc.property(small, ({ kind, files, table }) => {
      expect(total(files, table)).toBeLessThanOrEqual(kind === "vitest" ? limit.vitest : limit.e2e);

      const legs = size(
        pr,
        kind === "vitest" ? { vitest: files, e2e: [] } : { vitest: [], e2e: files },
        full,
        limit,
        table,
      );

      expect(legs).toEqual(kind === "vitest" ? { vitest: 1, e2e: 0 } : { vitest: 0, e2e: 1 });
      expect(shards(legs)).toEqual(kind === "vitest" ? ["1"] : ["e2e-1"]);
    }),
    options,
  );
});

it("scenario: every next/ file selected, with today's table, gives exactly today's legs", () => {
  // The real file sets, measured table and check.yaml: a big pull request runs every leg, as now.
  // Plant: the budget doubled (red: fewer legs than today's).
  expect(shards(size(pr, { vitest, e2e }, full, limit))).toEqual(["e2e-1", "e2e-2", "1", "2", "3", "4", "5"]);
  expect(shards(full)).toEqual([...e2eLegs(workflow), ...vitestLegs(workflow)]);
});

// 0534 narrowed this law: the merge queue and a push to main left it. They size their legs as a pull
// request does, so none of the three runs the whole suite; the schedule does. Ticket 997 narrowed it
// again: a run of the reader tests alone left it, and is sized (the law below).
it("property: a run of all of next/ with no base commit, or an event off the merge line, gives the full vitest legs, and visual legs only where asked", () => {
  // Plant: drop the base check (red on no base). 0536, plants, each run once on legs.ts and
  // restored: `visual` always true (red: the merge queue got e2e legs); `visual` without the pull
  // request check (red: a push with the flag got them).
  fc.assert(
    fc.property(
      picked(),
      fc.oneof(
        fc
          .tuple(
            fc.constantFrom("pull_request", "merge_group", "push"),
            fc.constantFrom("", "0".repeat(40), "main", "b".repeat(39), "B".repeat(40)),
            fc.boolean(),
          )
          .map(([event, sha, visual]): Run => ({ event, scope: "all", base: sha, visual })),
        fc
          .tuple(
            fc.constantFrom("workflow_dispatch", "schedule", ""),
            fc.constantFrom<Run["scope"]>("all", "readers"),
            fc.boolean(),
          )
          .map(([event, scope, visual]): Run => ({ event, scope, base, visual })),
      ),
      ({ selected, table }, run) => {
        const asked = run.event === "pull_request" && run.visual;
        expect(size(run, selected, full, limit, table)).toEqual({ vitest: full.vitest, e2e: asked ? full.e2e : 0 });
      },
    ),
    {
      ...options,
      // pinned: a first push to main, whose `before` is all zeros; and the same push with the flag,
      // which only a pull request's label can set.
      examples: [
        [
          { selected: { vitest: [], e2e: [] }, table: {} },
          { event: "push", scope: "all", base: "0".repeat(40), visual: false },
        ],
        [
          { selected: { vitest: [], e2e: [] }, table: {} },
          { event: "push", scope: "all", base: "0".repeat(40), visual: true },
        ],
      ],
    },
  );
});

it("property: a merge queue group and a push to main size their legs as a pull request without the visual label does", () => {
  // Plant: the old `run.event === "pull_request"` in `sizes` (red on merge_group and push). 0536,
  // plant, run once on legs.ts and restored: `visual` without the pull request check (red: a queue
  // group with the flag got e2e legs).
  fc.assert(
    fc.property(
      picked(),
      line.filter((run) => run.event !== "pull_request"),
      ({ selected, table }, run) => {
        expect(size(run, selected, full, limit, table)).toEqual(size(plainPr, selected, full, limit, table));
        expect(outputs(run, size(run, selected, full, limit, table), selected)).toEqual(
          outputs({ ...plainPr, base: run.base }, size(plainPr, selected, full, limit, table), selected),
        );
      },
    ),
    {
      ...options,
      // pinned: an empty selection in the queue, which ran seven machines on nothing before 0534.
      examples: [
        [
          { selected: { vitest: [], e2e: [] }, table: {} },
          { event: "merge_group", scope: "all", base, visual: false },
        ],
      ],
    },
  );
});

it("property: a sized pull request without the visual label starts no end-to-end leg, whatever it selected", () => {
  // 0536. Plant, run once on legs.ts and restored: size e2e as if every pull request asked (red).
  fc.assert(
    fc.property(picked(), ({ selected, table }) => {
      const legs = size(plainPr, selected, full, limit, table);
      expect(legs.e2e).toBe(0);
      expect(legs.vitest).toBe(size(pr, selected, full, limit, table).vitest);
      expect(shards(legs).some((leg) => leg.startsWith("e2e-"))).toBe(false);
    }),
    options,
  );
});

it("property: every selected file lands on exactly one leg, on any count up to the full one", () => {
  // `split` is the cut `Shards` keeps on each leg (vitest.shards.test.ts, E6). Plant: keep a file on
  // every leg at or after its own (red: a file on two legs).
  fc.assert(
    fc.property(picked(), fc.integer({ min: 1, max: full.vitest }), ({ selected, table }, count) => {
      const files = [...selected.vitest, ...selected.e2e];
      const legs = split(files, count, table);
      expect(legs).toHaveLength(count);
      expect(legs.flat().toSorted()).toEqual(files.toSorted());
      const sized = fewest(selected.vitest, full.vitest, limit.vitest, table);
      expect(split(selected.vitest, sized, table).flat().toSorted()).toEqual(selected.vitest.toSorted());
    }),
    options,
  );
});

// Ticket 997: the leg budget is the size step's BUDGET setting, declared once in check.yaml. Each
// law sets it as the step does, through `limits`, with any budget, so it holds for every setting
// and not only today's. Each plant was run once on legs.ts and restored; each turned its law red.

/** Any budget a person might set, and the vitest limit legs.ts makes of it. */
const budgets = fc.double({ min: 1, max: 1200, noNaN: true }).map((seconds) => ({
  seconds,
  limit: limits(nextMinutes(workflow), seconds).vitest,
}));

/** The longest of `count` legs' table seconds when `split` cuts `files`. */
const longestOf = (files: readonly string[], count: number, table: Readonly<Record<string, number>>) =>
  Math.max(0, ...split(files, count, table).map((leg) => total(leg, table)));

/**
 * A budget, and either some of the real files with a scratch table, or up to 12 real vitest files
 * whose rows are each up to 1.2 times the budget's limit, so the full count often fits and one leg
 * often does not: the selections where the count matters.
 */
const budgeted = () =>
  budgets.chain((budget) =>
    fc.tuple(
      fc.constant(budget),
      fc.oneof(
        picked(),
        fc
          .tuple(
            fc.uniqueArray(fc.integer({ min: 0, max: vitest.length - 1 }), { minLength: 1, maxLength: 12 }),
            // Whole hundredths: fast-check's doubles lean on tiny values, which fit any count.
            fc.array(fc.integer({ min: 0, max: 120 }), { minLength: 12, maxLength: 12 }),
          )
          .map(([at, shares]) => {
            const files = at.map((i) => vitest[i]!);
            const table = Rec.fromEntries(files.map((path, i) => [path, (shares[i]! / 100) * budget.limit]));

            return { selected: { vitest: files, e2e: [] }, table };
          }),
      ),
    ),
  );

it("property: sized legs never exceed the full matrix, and fit the budget whenever the full count does", () => {
  // Ticket 997 widened it from today's budget to any budget, with selections sized to it
  // (`budgeted`). Plant, run once on legs.ts and restored: the vitest kind sized to the end-to-end
  // limit (red: legs past the budget).
  fc.assert(
    fc.property(budgeted(), ([{ seconds, limit: most }, { selected, table }]) => {
      const legs = size(pr, selected, full, limits(nextMinutes(workflow), seconds), table);
      expect(legs.vitest).toBeLessThanOrEqual(Math.min(full.vitest, selected.vitest.length));
      expect(legs.e2e).toBeLessThanOrEqual(Math.min(full.e2e, selected.e2e.length));

      if (longestOf(selected.vitest, full.vitest, table) <= most) {
        expect(longestOf(selected.vitest, legs.vitest, table)).toBeLessThanOrEqual(most);
      }
    }),
    options,
  );
});

it("property: a vitest leg's limit is the budget, never past its room in the job's limit, and no budget moves the end-to-end limit", () => {
  // Plants: `vitest: budget` with no cap (red: a budget of 1200 passed the room); the end-to-end
  // limit from the budget too (red).
  fc.assert(
    fc.property(budgets, fc.integer({ min: 1, max: 60 }), ({ seconds }, minutes) => {
      const both = limits(minutes, seconds);
      expect(both.vitest).toBe(Math.min(seconds, room(minutes, SETUP)));
      expect(both.vitest).toBeLessThanOrEqual(room(minutes, SETUP));
      expect(both.e2e).toBe(limits(minutes, 1).e2e);
    }),
    options,
  );
});

it("property: a sized run's vitest legs pass the budget by at most its longest file, whenever the full matrix could hold its seconds", () => {
  // `assign` places the heaviest file first on the least loaded leg, so no leg passes an even share
  // by more than one file. Plant: `fewest` falls back to one leg when no count fits, not to the
  // shortest share (red: a leg passed the budget by more than one file).
  fc.assert(
    fc.property(budgeted(), ([{ seconds, limit: most }, { selected, table }]) => {
      fc.pre(total(selected.vitest, table) <= full.vitest * most);
      const legs = size(pr, selected, full, limits(nextMinutes(workflow), seconds), table);
      const heaviest = Math.max(0, ...selected.vitest.map((path) => total([path], table)));
      expect(longestOf(selected.vitest, legs.vitest, table)).toBeLessThanOrEqual(most + heaviest + 1e-9);
    }),
    options,
  );
});

it("property: a sized run starts no vitest leg its budget does not need", () => {
  // One leg fewer always passes the budget, so a small run starts few legs and none for a few
  // seconds of tests. Plant: start the count search at 2 legs (red: one file got two legs);
  // `Math.min(most, files.length)` as `most` (red: an empty run got legs).
  fc.assert(
    fc.property(
      picked(),
      budgets,
      fc.constantFrom(pr, plainPr),
      ({ selected, table }, { seconds, limit: most }, run) => {
        const legs = size(run, selected, full, limits(nextMinutes(workflow), seconds), table);
        expect(legs.vitest === 0).toBe(selected.vitest.length === 0);

        if (legs.vitest > 1) {
          expect(longestOf(selected.vitest, legs.vitest - 1, table)).toBeGreaterThan(most);
        }
      },
    ),
    options,
  );
});

it("property: a run of the reader tests alone is sized as a run of all of next/ with a base, whatever its own base", () => {
  // Plants: the scope check back in `sizes` (red: the reader tests got the full matrix); the base
  // check without the reader tests' exception (red: a queue group of reader tests with no base got
  // the full matrix).
  fc.assert(
    fc.property(picked(), readersRun, ({ selected, table }, run) => {
      expect(size(run, selected, full, limit, table)).toEqual(
        size({ ...run, scope: "all", base }, selected, full, limit, table),
      );
    }),
    options,
  );
});

it("scenario: the reader tests alone, with today's table and budget, start one vitest leg", () => {
  // The real reader files and table: a queue group of them started all five legs, four for 12 s of
  // tests or less (run 43656691809). Plant: the scope check back in `sizes` (red: five legs).
  const files = readerFiles().filter((path) => !/\.(?:integration|visual)\.test\.tsx?$/.test(path));
  expect(files.length).toBeGreaterThan(0);
  const run: Run = { event: "merge_group", scope: "readers", base: "", visual: false };
  expect(size(run, { vitest: files, e2e: [] }, full, limit)).toEqual({ vitest: 1, e2e: 0 });
});

it("property: the size step's BUDGET is a positive number of seconds, and anything else throws, so the step prints nothing", () => {
  // Plant: `Number(value)` returned as it is (red: "", "0", "-5" and "x" gave a budget).
  fc.assert(
    fc.property(
      fc.double({ min: 0.001, max: 1e6, noNaN: true }),
      fc.constantFrom("", " ", "0", "-5", "x", "Infinity", "NaN", undefined),
      (seconds, bad) => {
        expect(budgetOf(String(seconds))).toBe(seconds);
        expect(() => budgetOf(bad)).toThrow(/BUDGET/);
      },
    ),
    options,
  );
});

it("scenario: the main prints the full matrix to GITHUB_OUTPUT in the merge queue with no base commit, with no list", () => {
  // scenario: no BASE, so nothing to diff with; the list step would need git and an install.
  const output = join(mkdtempSync(join(tmpdir(), "legs-test-")), "out");

  const done = spawnSync(process.execPath, [fileURLToPath(new URL("./legs.ts", import.meta.url))], {
    encoding: "utf8",
    env: {
      PATH: Effect.runSync(Config.String("PATH")),
      EVENT: "merge_group",
      FILTER: "next/",
      BUDGET: String(budget),
      GITHUB_OUTPUT: output,
    },
  });

  expect(done.status).toBe(0);
  // 0536: the merge queue never starts the visual legs.
  expect(readFileSync(output, "utf8")).toBe('shards=["1","2","3","4","5"]\nvitest=5\ne2e=0\nnext=true\n');
});

// PR 1235: the reader tests (changes.mjs's `readers`) read source as text, so `--changed` misses
// them. A sized run adds them to the vitest files, each once, and every vitest leg runs that list.
// Each plant was run once on legs.ts and restored; each turned its law red.

/** The real reader test files, as Vitest matches changes' paths: the file's path holds one. */
const readerFiles = () => vitest.filter((path) => readers.some((reader) => path.includes(reader)));

it("property: a sized run's vitest files are what --changed picked and every reader test, each once", () => {
  // Plants: `[...changed].toSorted()` (red: a reader --changed missed is gone); the two lists joined
  // with no Set (red: a reader --changed picked too is there twice).
  expect(readerFiles().length).toBeGreaterThan(0);
  fc.assert(
    fc.property(fc.subarray(vitest), (changed) => {
      const files = withReaders(changed, readerFiles());
      expect(new Set(files).size).toBe(files.length);
      expect(files).toEqual([...new Set([...changed, ...readerFiles()])].toSorted());
    }),
    options,
  );
});

it("property: on a sized run each reader test lands on exactly one leg, whatever --changed picked", () => {
  // The leg split is `Shards`'s on each leg, over the one list every leg runs. Plant: the two lists
  // joined with no Set (red: a reader on two legs, or twice on one).
  fc.assert(
    fc.property(picked(), ({ selected, table }) => {
      const files = withReaders(selected.vitest, readerFiles());
      const legs = size(pr, { vitest: files, e2e: selected.e2e }, full, limit, table);
      expect(legs.vitest).toBeGreaterThan(0);
      const placed = split(files, legs.vitest, table);

      for (const reader of readerFiles()) {
        expect(placed.flat().filter((path) => path === reader)).toHaveLength(1);
      }
    }),
    options,
  );
});

it("scenario: a change that picks every next/ file runs each reader once, on today's legs", () => {
  // A forceRerunTrigger (a .github/ change, as 1235's own run) picks every file: the readers add
  // nothing, so no file runs twice and the legs are today's five. Plant: no Set (red: 40 more files).
  const files = withReaders(vitest, readerFiles());
  expect(files).toEqual(vitest.toSorted());
  expect(size(pr, { vitest: files, e2e: [] }, full, limit).vitest).toBe(full.vitest);
});

// A run legs.ts never sizes: all of next/ with no base commit to diff with, or off the merge line.
const unsized = fc.constantFrom<Run>(
  { event: "merge_group", scope: "all", base: "", visual: false },
  { event: "push", scope: "all", base: "0".repeat(40), visual: false },
  { event: "workflow_dispatch", scope: "readers", base, visual: true },
);

// A run of the reader tests alone on the merge line, with any base or none (ticket 997).
const readersRun = fc
  .tuple(
    fc.constantFrom("pull_request", "merge_group", "push"),
    fc.constantFrom(base, "", "0".repeat(40), "main"),
    fc.boolean(),
  )
  .map(([event, sha, visual]): Run => ({ event, scope: "readers", base: sha, visual }));

it("property: the size step prints files only on a sized run with a vitest leg, as the one list", () => {
  // Plants: drop `sizes(run) &&` from `listed` (red: a run with no base printed a list, so its legs
  // would run it and not every file); drop the files line (red: a sized run printed none).
  fc.assert(
    fc.property(picked(), fc.oneof(line, unsized, readersRun), ({ selected, table }, run) => {
      const legs = size(run, selected, full, limit, table);
      const lines = outputs(run, legs, selected);
      const files = lines.filter((line) => line.startsWith("files="));
      const onLine = ["pull_request", "merge_group", "push"].includes(run.event);

      const listed =
        onLine &&
        (run.scope === "readers" || (/^[a-f0-9]{40}$/.test(run.base) && !/^0+$/.test(run.base))) &&
        legs.vitest > 0;

      expect(files).toEqual(listed ? [`files=${selected.vitest.join(" ")}`] : []);
    }),
    options,
  );
});

it("property: the size step prints the base only on a sized run with an end-to-end leg, so no other run narrows them", () => {
  // 0534: the end-to-end legs narrow with `--changed` from changes' `base`, the commit they were
  // sized from. Plants: print `base` on every run (red: a run with no base, and the reader tests,
  // narrowed); drop the line (red: a sized run's end-to-end legs ran every file). Ticket 997, plant,
  // run once on legs.ts and restored: drop `run.scope === "all"` from `narrowed` (red: a sized
  // run of the reader tests narrowed its end-to-end legs to a base it never diffed).
  fc.assert(
    fc.property(picked(), fc.oneof(line, unsized, readersRun), ({ selected, table }, run) => {
      const legs = size(run, selected, full, limit, table);
      const printed = outputs(run, legs, selected).filter((out) => out.startsWith("base="));
      const sized = run.scope === "all" && /^[a-f0-9]{40}$/.test(run.base) && !/^0+$/.test(run.base);
      expect(printed).toEqual(sized && legs.e2e > 0 ? [`base=${run.base}`] : []);
    }),
    options,
  );
});

it("scenario: a vitest file whose path holds a space throws, so the step prints nothing", () => {
  // `files` is passed unquoted, one path per word. Plant: drop the space check (red: no throw).
  const selected = { vitest: ["next/a b.test.ts"], e2e: [] };
  expect(() => outputs(pr, { vitest: 1, e2e: 0 }, selected)).toThrow(/space/);
  // A run legs.ts does not size prints no list, so the space never reaches one (ticket 997: the
  // reader tests alone are sized now, so this is a queue group with no base).
  expect(outputs({ event: "merge_group", scope: "all", base: "", visual: false }, full, selected)).not.toContain(
    "files=next/a b.test.ts",
  );
});

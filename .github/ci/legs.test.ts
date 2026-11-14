import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { beforeAll, expect, it } from "vitest";
import { readers } from "./changes.mjs";
import { budget, fewest, type Legs, outputs, type Run, shards, size, split, withReaders } from "./legs.ts";
import { e2eFiles, nextFiles } from "./shard-rows.ts";
import { e2eLegs, nextMinutes, vitestLegs } from "./workflow-lint.ts";

// Today's CI, next/. Covers legs.ts, which sizes the next job's matrix on the merge line: a pull
// request, a merge queue group and a push to main (0534). Paths are the real next/ files Vitest
// selects; seconds come from a scratch table, so a law holds for any table, not only today's. Each
// plant was run once on legs.ts and restored; each turned its law red.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const workflow = readFileSync(join(ROOT, ".github/workflows/check.yaml"), "utf8");
const full: Legs = { vitest: vitestLegs(workflow).length, e2e: e2eLegs(workflow).length };
const limit = budget(nextMinutes(workflow));
const options = { seed: 119120, numRuns: 100 };
const base = "b".repeat(40);
const pr: Run = { event: "pull_request", scope: "all", base };

// A merge line run that tests all of next/ from a base commit, the runs legs.ts sizes (0534).
const line = fc
  .tuple(fc.constantFrom("pull_request", "merge_group", "push"), fc.stringMatching(/^[a-f0-9]{40}$/))
  .filter(([, sha]) => !/^0+$/.test(sha))
  .map(([event, sha]): Run => ({ event, scope: "all", base: sha }));

let vitest: string[] = [];
let e2e: string[] = [];

beforeAll(async () => {
  [vitest, e2e] = await Promise.all([nextFiles(ROOT), e2eFiles(ROOT)]);
});

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
  const rows = Object.values(table).toSorted((a, b) => a - b);
  const unmeasured = rows[Math.floor((rows.length - 1) / 2)] ?? 1;
  return files.reduce((sum, path) => sum + (Object.hasOwn(table, path) ? table[path]! : unmeasured), 0);
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
  // Up to 6 real files of either kind, each with a row of at most 70 s or none, so the total is at
  // most 420 s, under the budget. Plant: start the count search at 2 legs (red here, and in the full-selection scenario).
  expect(6 * 70).toBeLessThanOrEqual(limit);
  const small = fc
    .tuple(
      fc.constantFrom("vitest", "e2e"),
      fc.integer({ min: 1, max: 6 }),
      fc.array(fc.option(fc.double({ min: 0, max: 70, noNaN: true }), { nil: undefined }), {
        minLength: 6,
        maxLength: 6,
      }),
      fc.nat(),
    )
    .map(([kind, count, seconds, at]) => {
      const pool = kind === "vitest" ? vitest : e2e;
      const files = Array.from(new Set(Array.from({ length: count }, (_, i) => pool[(at + i * 7) % pool.length]!)));
      const table = Object.fromEntries(
        files.flatMap((path, i) => (seconds[i] === undefined ? [] : [[path, seconds[i]]])),
      );
      return { kind, files, table };
    });
  fc.assert(
    fc.property(small, ({ kind, files, table }) => {
      expect(total(files, table)).toBeLessThanOrEqual(limit);
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
// request does, so none of the three runs the whole suite; the schedule does.
it("property: the reader tests, a run with no base commit, or an event off the merge line give the full matrix", () => {
  // Plants: drop the scope check from `sizes` (red on readers); drop the base check (red on no base).
  fc.assert(
    fc.property(
      picked(),
      fc.oneof(
        fc
          .tuple(fc.constantFrom("pull_request", "merge_group", "push"), fc.constant(base))
          .map(([event, sha]): Run => ({ event, scope: "readers", base: sha })),
        fc
          .tuple(
            fc.constantFrom("pull_request", "merge_group", "push"),
            fc.constantFrom("", "0".repeat(40), "main", "b".repeat(39), "B".repeat(40)),
          )
          .map(([event, sha]): Run => ({ event, scope: "all", base: sha })),
        fc.constantFrom("workflow_dispatch", "schedule", "").map((event): Run => ({ event, scope: "all", base })),
      ),
      ({ selected, table }, run) => {
        expect(size(run, selected, full, limit, table)).toEqual(full);
      },
    ),
    {
      ...options,
      // pinned: a first push to main, whose `before` is all zeros.
      examples: [
        [
          { selected: { vitest: [], e2e: [] }, table: {} },
          { event: "push", scope: "all", base: "0".repeat(40) },
        ],
      ],
    },
  );
});

it("property: a merge queue group and a push to main size their legs as a pull request does", () => {
  // Plant: the old `run.event === "pull_request"` in `sizes` (red on merge_group and push).
  fc.assert(
    fc.property(picked(), line, ({ selected, table }, run) => {
      expect(size(run, selected, full, limit, table)).toEqual(size(pr, selected, full, limit, table));
      expect(outputs(run, size(run, selected, full, limit, table), selected)).toEqual(
        outputs({ ...pr, base: run.base }, size(pr, selected, full, limit, table), selected),
      );
    }),
    {
      ...options,
      // pinned: an empty selection in the queue, which ran seven machines on nothing before 0534.
      examples: [
        [
          { selected: { vitest: [], e2e: [] }, table: {} },
          { event: "merge_group", scope: "all", base },
        ],
      ],
    },
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
      const sized = fewest(selected.vitest, full.vitest, limit, table);
      expect(split(selected.vitest, sized, table).flat().toSorted()).toEqual(selected.vitest.toSorted());
    }),
    options,
  );
});

it("property: sized legs never exceed the full matrix, and fit the budget whenever the full count does", () => {
  fc.assert(
    fc.property(picked(), ({ selected, table }) => {
      const legs = size(pr, selected, full, limit, table);
      expect(legs.vitest).toBeLessThanOrEqual(Math.min(full.vitest, selected.vitest.length));
      expect(legs.e2e).toBeLessThanOrEqual(Math.min(full.e2e, selected.e2e.length));
      const longest = (files: readonly string[], count: number) =>
        Math.max(0, ...split(files, count, table).map((leg) => total(leg, table)));

      if (longest(selected.vitest, full.vitest) <= limit) {
        expect(longest(selected.vitest, legs.vitest)).toBeLessThanOrEqual(limit);
      }
    }),
    options,
  );
});

it("scenario: the main prints the full matrix to GITHUB_OUTPUT in the merge queue with no base commit, with no list", () => {
  // scenario: no BASE, so nothing to diff with; the list step would need git and an install.
  const output = join(mkdtempSync(join(tmpdir(), "legs-test-")), "out");
  const done = spawnSync(process.execPath, [fileURLToPath(new URL("./legs.ts", import.meta.url))], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"], EVENT: "merge_group", FILTER: "next/", GITHUB_OUTPUT: output },
  });
  expect(done.status).toBe(0);
  expect(readFileSync(output, "utf8")).toBe(
    'shards=["e2e-1","e2e-2","1","2","3","4","5"]\nvitest=5\ne2e=2\nnext=true\n',
  );
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

// A run legs.ts never sizes: the reader tests, or no base commit to diff with.
const unsized = fc.constantFrom<Run>(
  { event: "pull_request", scope: "readers", base },
  { event: "merge_group", scope: "readers", base },
  { event: "merge_group", scope: "all", base: "" },
  { event: "push", scope: "all", base: "0".repeat(40) },
);

it("property: the size step prints files only on a sized run with a vitest leg, as the one list", () => {
  // Plants: drop `sizes(run) &&` from `listed` (red: a run with no base printed a list, so its legs
  // would run it and not every file); drop the files line (red: a sized run printed none).
  fc.assert(
    fc.property(picked(), fc.oneof(line, unsized), ({ selected, table }, run) => {
      const legs = size(run, selected, full, limit, table);
      const lines = outputs(run, legs, selected);
      const files = lines.filter((line) => line.startsWith("files="));
      const listed =
        run.scope === "all" && /^[a-f0-9]{40}$/.test(run.base) && !/^0+$/.test(run.base) && legs.vitest > 0;
      expect(files).toEqual(listed ? [`files=${selected.vitest.join(" ")}`] : []);
    }),
    options,
  );
});

it("property: the size step prints the base only on a sized run with an end-to-end leg, so no other run narrows them", () => {
  // 0534: the end-to-end legs narrow with `--changed` from changes' `base`, the commit they were
  // sized from. Plants: print `base` on every run (red: a run with no base, and the reader tests,
  // narrowed); drop the line (red: a sized run's end-to-end legs ran every file).
  fc.assert(
    fc.property(picked(), fc.oneof(line, unsized), ({ selected, table }, run) => {
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
  expect(outputs({ event: "merge_group", scope: "readers", base }, full, selected)).not.toContain(
    "files=next/a b.test.ts",
  );
});

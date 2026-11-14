import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { beforeAll, expect, it } from "vitest";
import { budget, fewest, type Legs, type Run, shards, size, split } from "./legs.ts";
import { e2eFiles, nextFiles } from "./shard-rows.ts";
import { e2eLegs, nextMinutes, vitestLegs } from "./workflow-lint.ts";

// Today's CI, next/. Covers legs.ts, which sizes the next job's matrix on a pull request. Paths are
// the real next/ files Vitest selects; seconds come from a scratch table, so a law holds for any
// table, not only today's. Each plant was run once on legs.ts and restored; each turned its law red.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const workflow = readFileSync(join(ROOT, ".github/workflows/check.yaml"), "utf8");
const full: Legs = { vitest: vitestLegs(workflow).length, e2e: e2eLegs(workflow).length };
const limit = budget(nextMinutes(workflow));
const options = { seed: 119120, numRuns: 100 };
const pr: Run = { event: "pull_request", scope: "all" };

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

it("property: the merge queue, a push and the reader tests always give the full matrix", () => {
  // Plant: drop the event check from `size` (red on merge_group and push, here and in the main's scenario).
  fc.assert(
    fc.property(
      picked(),
      fc.constantFrom<Run>(
        { event: "merge_group", scope: "all" },
        { event: "push", scope: "all" },
        { event: "merge_group", scope: "readers" },
        { event: "push", scope: "readers" },
        { event: "pull_request", scope: "readers" },
      ),
      ({ selected, table }, run) => {
        expect(size(run, selected, full, limit, table)).toEqual(full);
      },
    ),
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

it("scenario: the main prints the full matrix to GITHUB_OUTPUT in the merge queue, with no list", () => {
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

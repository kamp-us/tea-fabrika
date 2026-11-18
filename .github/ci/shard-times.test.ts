import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { LIMIT, reportRows, staleRows, rowLine, type Row } from "./shard-times.ts";
import { markdown, readFiles, type Timings } from "./time-table.ts";

const options = { seed: 119120, numRuns: 100 };

it("L10: report times advise exactly for stale rows, including unmeasured files", () => {
  // Plant: require a table entry before comparing, losing new slow files.
  const path = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}\.test\.ts$/);
  fc.assert(
    fc.property(
      fc.dictionary(
        path,
        fc.record({
          row: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
          real: fc.integer({ min: 0, max: 1000 }),
          start: fc.integer({ min: 0, max: 1000000 }),
        }),
      ),
      (entries) => {
        const root = resolve("timing-fixture");

        const report = {
          testResults: Object.entries(entries).map(([path, value]) => ({
            name: resolve(root, path),
            startTime: value.start,
            endTime: value.start + value.real * 1000,
          })),
        };

        const rows: Row[] = Object.entries(entries).map(([path, value]) => ({ path, seconds: value.real }));
        expect(reportRows(report, root)).toEqual(rows);

        const table = Object.fromEntries(
          Object.entries(entries).flatMap(([path, value]) => (value.row === undefined ? [] : [[path, value.row]])),
        );

        table["not-run.test.ts"] = 10000;

        const expected = rows
          .filter((row) => Math.abs(row.seconds - (entries[row.path]!.row ?? 1)) > LIMIT)
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

        expect(staleRows(table, rows)).toEqual(expected);
      },
    ),
    {
      ...options,
      examples: [
        [{ "new.test.ts": { row: undefined, real: LIMIT + 2, start: 17 } }],
        [{ "edge.test.ts": { row: 0, real: LIMIT, start: 41 } }],
      ],
    },
  );
});

it("L11: printed rows round-trip paths and real seconds to one decimal", () => {
  // Plant: print a fixed old table time instead of the report's seconds.
  fc.assert(
    fc.property(fc.string(), fc.double({ min: 0, max: 1e6, noNaN: true }), (path, seconds) => {
      const row: Row = { path, seconds };
      expect(rowLine(row)).toBe(`  ${JSON.stringify(path)}: ${seconds.toFixed(1)},`);
      expect(JSON.parse(`{${rowLine(row).trim().slice(0, -1)}}`)).toEqual({ [path]: Number(seconds.toFixed(1)) });
    }),
    options,
  );
});

it.prop(
  "T1: a report's seconds per file are the same in the time table and in reportRows, to the same one decimal",
  {
    entries: Schema.Array(
      Schema.Tuple([
        Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,20}\.test\.ts$/)),
        Schema.Struct({
          start: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
          real: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 900_000 })),
        }),
      ]),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(10), Schema.isUniqueKey()),
  },
  ({ entries }) => {
    // The fullSamples of vitest.shards.test.ts are read from job logs' time tables, because the
    // reports' artifacts were out of reach; the table's seconds must be the ones `shard-times` reads
    // from the report. Up to ten files, so each is among the table's slowest.
    // Plant, run once and restored: `reportRows` rounds its seconds to whole seconds (red).
    const root = resolve("timing-fixture");

    const files = entries.map(([name, file]) => ({ name, ...file }));

    const report = {
      testResults: files.map((file) => ({
        name: resolve(root, file.name),
        status: "passed",
        startTime: file.start,
        endTime: file.start + file.real,
        assertionResults: [],
      })),
    };

    const read = readFiles(report, root);
    expect(read._tag).toBe("read");
    const table = read._tag === "read" ? read.rows : [];
    const rows = reportRows(report, root);
    expect(rows.map((each) => each.path)).toEqual(table.map((each) => each.path));
    expect(rows.map((each) => each.seconds)).toEqual(table.map((each) => each.seconds));

    const timings: Timings = {
      run: "1",
      attempt: "1",
      workflow: "scheduled",
      event: "schedule",
      sha: "0",
      job: "tests",
      leg: "1",
      steps: { _tag: "read", rows: [] },
      files: read,
    };

    const printed = markdown(timings).split("\n");

    for (const each of rows) {
      const cells = printed.find((line) => line.startsWith(`| ${each.path} | `))?.split(" | ");
      expect(cells?.[1], `${each.path} is in the printed table`).toBeDefined();
      expect(cells?.[1]).toBe(rowLine(each).slice(rowLine(each).lastIndexOf(": ") + 2, -1));
    }
  },
);

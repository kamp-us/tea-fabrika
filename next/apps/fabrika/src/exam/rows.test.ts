// The laws of the row reader (`rows.ts`): which rows of `layer-rules.json` claim a file, as
// code-graph picks them. The lead's move checker (`movecheck.ts`) reads rows through it. These laws
// moved here from `layers.test.ts` when the layer checks became `pnpm lint` (ticket 987).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Schema, pipe } from "effect";
import fc from "fast-check";
import { type Row, rowsAt } from "./rows.ts";

const RuleFile = Schema.Struct({
  layers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      paths: Schema.Array(Schema.String),
      layer: Schema.optionalKey(Schema.Number),
    }),
  ),
});

/** The rule file's rows, as `pnpm lint:layers` reads them. Their paths start at the top of the repo. */
const REAL: ReadonlyArray<Row> = Schema.decodeUnknownSync(RuleFile)(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../../layer-rules.json"), "utf8")),
).layers;

// Ticket 477, PR 0. Fixed seed, as the lead scripts' laws use.
const options = { seed: 119120, numRuns: 500 };

describe("the rule file's rows give a file its row", () => {
  // The tool's rule, written a second way, by segments and with no regex over the whole path, so
  // the reader is checked against the rule and not against itself.
  const one = (segment: string, name: string): boolean => {
    const [head = "", ...rest] = segment.split("*");

    if (rest.length === 0) {
      return head === name;
    }

    let at = head.length;

    if (!name.startsWith(head)) {
      return false;
    }

    for (const piece of rest.slice(0, -1)) {
      const next = name.indexOf(piece, at);

      if (next < 0) {
        return false;
      }

      at = next + piece.length;
    }

    const tail = rest.at(-1) ?? "";
    return name.length - tail.length >= at && name.endsWith(tail) && name.length > 0;
  };
  const claims = (pattern: ReadonlyArray<string>, path: ReadonlyArray<string>): boolean => {
    const [segment, ...rest] = pattern;

    if (segment === undefined) {
      return true;
    }

    if (segment === "**") {
      return claims(rest, path) || (path.length > 0 && claims(pattern, path.slice(1)));
    }

    const [name, ...below] = path;
    return name !== undefined && one(segment, name) && claims(rest, below);
  };
  const weight = (pattern: string): number => {
    const segments = pattern.split("/");
    const count = (keep: (segment: string) => boolean) => Arr.filter(segments, keep).length;
    // Three numbers compared in order. Each is under 1,000 here, so one number holds them.
    return (
      count((s) => s !== "**") * 1_000_000 +
      count((s) => !s.includes("*")) * 1_000 +
      Arr.filter([...pattern], (c) => c !== "*" && c !== "/").length
    );
  };
  const expected = (rows: ReadonlyArray<Row>, path: string): ReadonlyArray<string> => {
    const found = Arr.flatMap(rows, (row) =>
      pipe(
        row.paths,
        Arr.filter((pattern) => claims(pattern.split("/"), path.split("/"))),
        Arr.map((pattern) => ({ name: row.name, weight: weight(pattern) })),
      ),
    );
    const top = Math.max(...Arr.map(found, (f) => f.weight));
    return [
      ...new Set(
        pipe(
          found,
          Arr.filter((f) => f.weight === top),
          Arr.map((f) => f.name),
        ),
      ),
    ].sort();
  };

  const folder = fc.constantFrom("src", "app", "data", "door", "runtime", "internal");
  const file = fc.constantFrom("Log.ts", "log.ts", "index.ts", "ProcessStore.ts", "Log.test.ts");
  const segment = fc.oneof(
    { arbitrary: folder, weight: 6 },
    { arbitrary: fc.constantFrom("*", "**", "d*", "*a", "*t*"), weight: 2 },
  );
  const pattern = fc
    .tuple(
      fc.array(segment, { minLength: 1, maxLength: 4 }),
      fc.option(fc.oneof(file, fc.constantFrom("*.ts", "ProcessStore*", "*.test.ts")), {
        nil: undefined,
      }),
    )
    .map(([folders, last]) => Arr.join([...folders, ...(last === undefined ? [] : [last])], "/"));
  const rows: fc.Arbitrary<ReadonlyArray<Row>> = fc
    .array(fc.array(pattern, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 6 })
    .map((each) => Arr.map(each, (paths, n) => ({ name: `row-${n}`, paths })));
  const path = fc
    .tuple(fc.array(folder, { minLength: 1, maxLength: 4 }), file)
    .map(([folders, last]) => Arr.join([...folders, last], "/"));

  // Plant: pick the first row whose pattern matches, in the rule file's order, and not the most
  // specific. Then `src/runtime/ProcessStore*` in a later row loses to `src/runtime` in an earlier
  // one, and a file the plan keeps in coordination reads as app.
  it("the rows for a file are the ones code-graph's rule gives, for any rows and any path", () => {
    fc.assert(
      fc.property(fc.tuple(rows, path), ([given, at]) => {
        expect([...rowsAt(given, at)].sort()).toEqual(expected(given, at));
      }),
      {
        ...options,
        numRuns: 3000,
        examples: [
          // pinned: the plan's own case (ticket 477, PR 5). The longer pattern is in the later row.
          [
            [
              [
                { name: "row-0", paths: ["src/runtime"] },
                { name: "row-1", paths: ["src/runtime/ProcessStore*"] },
              ],
              "src/runtime/ProcessStore.ts",
            ],
          ],
        ],
      },
    );
  });

  // Plant: the same as above. The order of the rows, and of the paths in a row, changes nothing.
  it("the answer does not depend on the order of the rows", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(rows, path)
          .chain(([given, at]) =>
            fc.tuple(fc.constant(given), fc.shuffledSubarray([...given], { minLength: given.length }), fc.constant(at)),
          ),
        ([given, shuffled, at]) => {
          expect([...rowsAt(shuffled, at)].sort()).toEqual([...rowsAt(given, at)].sort());
        },
      ),
      options,
    );
  });

  // vector: answers of code-graph 0.15.0 on the real rule file, worked out from its built source
  // (`src/layers/classify.ts`), since `pnpm lint:layers` runs that tool on these same rows and the
  // exam must name the same row. A file pattern beats its folder, a deeper folder beats a higher
  // one, and a folder claims only at a `/`.
  it("vector: the real rule file gives the rows code-graph gives", () => {
    expect(rowsAt(REAL, "packages/fabrika/src/agents/claude.ts")).toEqual(["fabrika-entry"]);
    expect(rowsAt(REAL, "packages/fabrika/src/agents/claude/rules.ts")).toEqual(["fabrika-agents"]);
    expect(rowsAt(REAL, "packages/pipeline/src/laws/explore.ts")).toEqual(["own-search"]);
    expect(rowsAt(REAL, "packages/pipeline/src/laws/walk.ts")).toEqual(["pipeline"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/Testing.ts")).toEqual(["next-runtime"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/runtime/Runner.ts")).toEqual(["next-runtime"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/runtime/ProcessStore.ts")).toEqual(["next-runtime-coordination"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/runtime/ProcessStore.test.ts")).toEqual(["next-runtime"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/coordination/index.ts")).toEqual(["next-runtime-coordination"]);
    expect(rowsAt(REAL, "next/programs/counter/src/window.tsx")).toEqual(["next-program-windows"]);
    expect(rowsAt(REAL, "next/programs/counter/src/program.ts")).toEqual(["next-programs"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/gateway/internal/waiting.ts")).toEqual(["next-door"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/cloudflare/runtime.ts")).toEqual(["next-workers"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/telemetry/internal/measurements.ts")).toEqual(["next-telemetry"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/tasks/internal/task.ts")).toEqual(["next-tasks"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/data/index.ts")).toEqual([]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/apple/runner.ts")).toEqual([]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/testing.tsx")).toEqual([]);
  });
});

// `pnpm lint:dead` runs code-graph's `--unreachable` pass with the root `node-kinds.json`. These laws
// run the real tool, version 0.15.0, on planted trees with that real file, so what the file makes
// code-graph see as test support is seen before it is trusted on the repo (0524, 0538).
//
// How code-graph 0.15.0 reads the setting (node_modules/@demlik/code-graph/dist/index.js):
//   - `testSupportFilePatterns` is a record of named groups, each a list of regular expressions
//     (not globs), tested against a file's path from the scanned root (`NodeKindRulesSchema`,
//     `matchingRules`). A file that matches is test support: its exports are withheld with reason
//     `test-support-surface` and are never `dead` or `only-called-from-tests` (`judge`).
//   - A key set in `--node-kinds` replaces that key's default whole (`loadOverrides` spreads the
//     file over the defaults), so the default groups stay only if the file writes them again.
//
// Each run plants a fresh tree, so a generated name or folder meets the tool, never a fixed list.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const bin = resolve(ROOT, "node_modules", ".bin", "code-graph");

// A planter owns every tree its test plants. The test's scope removes them when the test ends (0061).
const planter = Effect.acquireRelease(
  Effect.sync(() => {
    const roots: Array<string> = [];
    const plant = (files: Readonly<Record<string, string>>): string => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "next-dead-")));
      roots.push(root);
      const base = {
        "package.json": JSON.stringify({ name: "plant", private: true }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, module: "nodenext", allowImportingTsExtensions: true, noEmit: true },
          include: ["next/**/*.ts"],
        }),
        // The real file, read fresh each run, so a plant in it is seen.
        "node-kinds.json": readFileSync(join(ROOT, "node-kinds.json"), "utf8"),
      };

      for (const [path, body] of Object.entries({ ...base, ...files })) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), body);
      }

      return root;
    };
    return { plant, roots };
  }),
  ({ roots }) =>
    Effect.sync(() => {
      for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
      }
    }),
);

const Report = Schema.fromJsonString(
  Schema.Struct({
    unreachable: Schema.Array(Schema.Struct({ id: Schema.String, category: Schema.String })),
    unusedExports: Schema.Array(Schema.Struct({ id: Schema.String })),
  }),
);

/** Every export the pass reports, by id, as `pnpm lint:dead` would gate it, with the run's status. */
const flagged = (root: string) => {
  const run = spawnSync(bin, [".", "--unreachable", "--json", "--node-kinds", "node-kinds.json"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  const report = Schema.decodeUnknownSync(Report)(run.stdout);
  return [...report.unreachable.map((u) => u.id), ...report.unusedExports.map((u) => u.id)].sort();
};

/** A folder name code-graph's defaults read as a test folder, which would hide a product file. */
const TEST_PLACE = /^(tests?|fixtures?|e2e.*|test-.*)$/;
const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/).filter((s) => !TEST_PLACE.test(s));
/** A folder under next/: from none to three generated segments deep. */
const folder = fc.array(segment, { maxLength: 3 }).map((parts) => ["next", ...parts].join("/"));
/** Distinct export names, each with a prefix so no two kinds of name collide. */
const names = fc.uniqueArray(fc.stringMatching(/^[a-z][a-zA-Z0-9]{1,8}$/), { minLength: 1, maxLength: 4 });

const source = (name: string) => `export const ${name} = (n: number) => n + 1;\n`;

const user = (path: string, name: string) =>
  `import { ${name} } from "./${path}";\nexport const used${name} = ${name}(1);\n`;

describe("node-kinds.json on the --unreachable pass (lint:dead)", () => {
  // Law 1. An export of a `*.test-support.ts` file (0538) that only tests use is test support, not
  // dead code. Red on main: code-graph's defaults hold no `.test-support.` pattern, so each one is
  // `only-called-from-tests`. Green once node-kinds.json names the pattern.
  // Plant: the real node-kinds.json as on main (no testSupportFilePatterns). Each helper is flagged.
  it.effect("an export of a .test-support.ts file that only tests use is not flagged", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const reached = { root: 0, nested: 0, many: 0 };
      fc.assert(
        fc.property(folder, names, segment, (dir, helpers, base) => {
          reached[dir === "next" ? "root" : "nested"]++;

          if (helpers.length > 1) {
            reached.many++;
          }

          const support = `${base}.test-support.ts`;
          const tree = plant({
            [`${dir}/${support}`]: helpers.map((h) => source(`h${h}`)).join(""),
            [`${dir}/${base}.test.ts`]: helpers.map((h) => user(support, `h${h}`)).join(""),
          });
          expect(flagged(tree)).toEqual([]);
        }),
        { seed: 119120, numRuns: runsFor({ fast: 4, full: 12 }) },
      );
      // The cases the law must meet: a helper at next/'s top, one deeper, and a file of several.
      expect(reached.root, "no run planted a helper at next/'s top").toBeGreaterThan(0);
      expect(reached.nested, "no run planted a helper in a nested folder").toBeGreaterThan(0);
      expect(reached.many, "no run planted a file of several helpers").toBeGreaterThan(0);
    }),
  );

  // Law 2. The pattern hides test support only: an export in a product file that nothing uses, no
  // test and no product file, is still `dead`, beside a test-support file in the same folder.
  // Plant: an over-wide group in node-kinds.json, `"testSupportFilePatterns": {"plant": ["\\.ts$"]}`.
  // Each dead export is then withheld as test support, and the law fails.
  it.effect("an export nothing uses is still flagged as dead beside test support", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const reached = { root: 0, nested: 0 };
      fc.assert(
        fc.property(folder, names, segment, (dir, deads, base) => {
          reached[dir === "next" ? "root" : "nested"]++;
          const product = `${base}.ts`;
          const tree = plant({
            [`${dir}/${product}`]: deads.map((d) => source(`d${d}`)).join(""),
            [`${dir}/${base}.test-support.ts`]: "export const helper = 1;\n",
            [`${dir}/${base}.test.ts`]: user(`${base}.test-support.ts`, "helper"),
          });
          const found = flagged(tree);
          expect(found).toEqual(expect.arrayContaining(deads.map((d) => `${dir}/${product}:d${d}`)));
        }),
        { seed: 119120, numRuns: runsFor({ fast: 4, full: 12 }) },
      );
      expect(reached.root, "no run planted a dead export at next/'s top").toBeGreaterThan(0);
      expect(reached.nested, "no run planted a dead export in a nested folder").toBeGreaterThan(0);
    }),
  );

  // Law 3. Naming the new pattern keeps code-graph's default test-helper places: setting the key
  // replaces its default whole, so node-kinds.json must write the defaults again. A helper in a
  // fixtures, test-utils, test-helpers, __tests__ or e2e folder that only tests use stays unflagged.
  // Plant: `"testSupportFilePatterns": {"test-support-module": ["\\.test-support\\.tsx?$"]}` alone,
  // without the default groups. Each helper in a default place is then flagged.
  it.effect("an export in a default test-helper folder that only tests use is not flagged", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const places = ["fixtures", "fixture", "test-utils", "test-helpers", "__tests__", "e2e", "tests"] as const;
      const reached = new Set<string>();
      fc.assert(
        fc.property(folder, fc.constantFrom(...places), names, segment, (dir, place, helpers, base) => {
          reached.add(place);
          const tree = plant({
            [`${dir}/${place}/${base}.ts`]: helpers.map((h) => source(`h${h}`)).join(""),
            [`${dir}/${base}.test.ts`]: helpers.map((h) => user(`${place}/${base}.ts`, `h${h}`)).join(""),
          });
          expect(flagged(tree)).toEqual([]);
        }),
        {
          seed: 119120,
          numRuns: runsFor({ fast: places.length, full: 14 }),
          // Each default place once, so a pull request meets them all.
          examples: places.map((place): [string, (typeof places)[number], string[], string] => [
            "next/lib",
            place,
            ["one"],
            "helper",
          ]),
        },
      );
      expect([...reached].sort(), "a default test-helper place was never planted").toEqual([...places].sort());
    }),
  );
});

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
// Each case plants a fresh tree from Schema-generated names and folders, so a generated name meets
// the tool, never a fixed list. Each tree holds every case its law must meet, and the law checks
// that it did, so no case rests on what a seed happens to draw (0579: no seed in the law).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const bin = resolve(ROOT, "node_modules", ".bin", "code-graph");

// A planter owns every tree its case plants. The case's scope removes them when the case ends (0061).
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
          include: ["next/**/*.ts", "next/**/*.tsx"],
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

// Names where code-graph 0.15.0 never judges a planted file, so law 2 would be false by its design:
//   - `index`: a file `index.ts` or `.tsx` is a barrel (`isBarrel`, `BARREL_SUFFIXES` in
//     dist/index.js), so its exports are withheld as `public-entry-surface`, never `dead`.
//   - The folders the file walk prunes (`WALK_PRUNE`) and the segments a source file may not hold
//     (`EXCLUDED_SEGMENTS`, `isSourceFile`), both in dist/chunk-HQJ7I5LA.js: such files are not read.
// Of these names, the pattern below can draw only `index`, `dist` and `vendor`; the rest guard a
// wider pattern. Plant: drop this set and force the pattern to `^(index|dist|vendor)$`; law 2 fails.
const NEVER_JUDGED = new Set([
  "index",
  ".claude",
  ".git",
  ".next",
  ".turbo",
  ".wrangler",
  "__generated__",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

const Segment = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9]{0,6}$/),
  Schema.makeFilter((s) => !TEST_PLACE.test(s) && !NEVER_JUDGED.has(s)),
);

/** A folder below next/: one to three generated segments deep. */
const Folder = Schema.Array(Segment).check(Schema.isMinLength(1), Schema.isMaxLength(3));
const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-zA-Z0-9]{1,8}$/));
/** Distinct export names. Each use gives them a prefix, so no two kinds of name collide. */
const Names = Schema.UniqueArray(Name).check(Schema.isMinLength(1), Schema.isMaxLength(4));
/** As `Names`, with at least two, for a file of several. */
const Several = Schema.UniqueArray(Name).check(Schema.isMinLength(2), Schema.isMaxLength(4));

// code-graph 0.15.0 counts a use by the export's name, so an export that shares its name with one in
// another file can read as used by that file. Every planted file names its exports apart.
const source = (names: ReadonlyArray<string>) =>
  names.map((n) => `export const ${n} = (n: number) => n + 1;\n`).join("");

/** A test file's body that calls each `[path, name]` once, each path relative to the test file. */
const user = (uses: ReadonlyArray<readonly [string, string]>) =>
  uses
    .map(([path, name], i) => `import { ${name} as a${i} } from "./${path}";\nexport const b${i} = a${i}(1);\n`)
    .join("");

const runs = { arbitrary: { runs: runsFor({ fast: 3, full: 12 }) } };

// code-graph 0.15.0's own default groups (dist/index.js, `NodeKindRulesSchema`), written here as the
// spec law 3 holds node-kinds.json to. Each spelling below is one alternative of one pattern: both
// forms of an optional `s`, a bare `e2e` folder and one with a suffix, and both `.ts` and `.tsx`.
const DEFAULTS = {
  "test-directory": ["(^|/)tests?/", "(^|/)__tests__/", "(^|/)e2e[^/]*/"],
  "test-helper-module": [
    "(^|/)test-helpers?/",
    "(^|/)test-utils?/",
    "(^|/)fixtures?/",
    "(^|/)test-helper\\.tsx?$",
    "(^|/)test-db\\.tsx?$",
    "\\.fixture\\.tsx?$",
  ],
} as const;

const EXTENSIONS = ["ts", "tsx"] as const;

/** Each spelling of a default test-helper place, as a path below a folder, for a base and extension. */
const spellings = (base: string, suffix: string, ext: string): ReadonlyArray<string> => [
  ...["test", "tests", "__tests__", "e2e", `e2e${suffix}`].map((d) => `${d}/${base}.${ext}`),
  ...["test-helper", "test-helpers", "test-util", "test-utils", "fixture", "fixtures"].map(
    (d) => `${d}/${base}.${ext}`,
  ),
  `test-helper.${ext}`,
  `test-db.${ext}`,
  `${base}.fixture.${ext}`,
];

describe("node-kinds.json on the --unreachable pass (lint:dead)", () => {
  // Law 1. An export of a `*.test-support.ts` file (0538) that only tests use is test support, not
  // dead code. Red on main: code-graph's defaults hold no `.test-support.` pattern, so each one is
  // `only-called-from-tests`. Green once node-kinds.json names the pattern.
  // Plant: the real node-kinds.json as on main (no testSupportFilePatterns). Each helper is flagged.
  it.effect.prop(
    "an export of a .test-support.ts file that only tests use is not flagged",
    { folder: Folder, helpers: Several, one: Name, base: Segment },
    ({ folder, helpers, one, base }) =>
      Effect.gen(function* () {
        const { plant } = yield* planter;
        const nested = ["next", ...folder].join("/");
        const support = `${base}.test-support.ts`;
        // One helper at next/'s top, and a file of several in a nested folder, each used by its test.
        const files = {
          [`next/${support}`]: source([`t${one}`]),
          [`next/${base}.test.ts`]: user([[support, `t${one}`]]),
          [`${nested}/${support}`]: source(helpers.map((h) => `h${h}`)),
          [`${nested}/${base}.test.ts`]: user(helpers.map((h) => [support, `h${h}`])),
        };
        const supports = Object.keys(files).filter((path) => path.endsWith(".test-support.ts"));
        // The cases the law must meet: a helper at next/'s top, one deeper, and a file of several.
        expect(supports, "no case planted a helper at next/'s top").toContain(`next/${support}`);
        expect(
          supports.some((path) => path.split("/").length > 2),
          "no case planted a helper in a nested folder",
        ).toBe(true);
        expect(
          supports.some((path) => (files[path] ?? "").split("export ").length > 2),
          "no case planted a file of several helpers",
        ).toBe(true);
        expect(flagged(plant(files))).toEqual([]);
      }),
    runs,
  );

  // Law 2. The pattern hides test support only: an export in a product file that nothing uses, no
  // test and no product file, is still `dead`, beside a test-support file in the same folder.
  // Plant: an over-wide group in node-kinds.json, `"testSupportFilePatterns": {"plant": ["\\.ts$"]}`.
  // Each dead export is then withheld as test support, and the law fails.
  it.effect.prop(
    "an export nothing uses is still flagged as dead beside test support",
    { folder: Folder, deads: Names, base: Segment },
    ({ folder, deads, base }) =>
      Effect.gen(function* () {
        const { plant } = yield* planter;
        // The cases the law must meet: dead exports at next/'s top and in a nested folder.
        const dirs = ["next", ["next", ...folder].join("/")];
        expect(
          dirs.filter((dir) => dir !== "next"),
          "no case planted a dead export in a nested folder",
        ).not.toEqual([]);
        const files = Object.fromEntries(
          dirs.flatMap((dir, i) => [
            [`${dir}/${base}.ts`, source(deads.map((d) => `d${i}${d}`))],
            [`${dir}/${base}.test-support.ts`, source([`helper${i}`])],
            [`${dir}/${base}.test.ts`, user([[`${base}.test-support.ts`, `helper${i}`]])],
          ]),
        );
        const found = flagged(plant(files));
        expect(found).toEqual(
          expect.arrayContaining(dirs.flatMap((dir, i) => deads.map((d) => `${dir}/${base}.ts:d${i}${d}`))),
        );
      }),
    runs,
  );

  // Law 3. Naming the new pattern keeps code-graph's default test-helper places: setting the key
  // replaces its default whole, so node-kinds.json must write the defaults again. A helper in every
  // spelling of every default pattern (DEFAULTS above), in `.ts` and `.tsx`, that only tests use
  // stays unflagged.
  // Plant: `"testSupportFilePatterns": {"test-support-module": ["\\.test-support\\.tsx?$"]}` alone,
  // without the default groups. Each helper in a default place is then flagged. A second plant drops
  // only the three file-name patterns from `test-helper-module`; the test-helper, test-db and
  // .fixture helpers are then flagged.
  it.effect.prop(
    "an export in each default test-helper place that only tests use is not flagged",
    { folder: Folder, helpers: Names, base: Segment, suffix: Segment },
    ({ folder, helpers, base, suffix }) =>
      Effect.gen(function* () {
        const { plant } = yield* planter;
        const dir = ["next", ...folder].join("/");
        // Each extension in a folder of its own, so `test-helper.ts` and `test-helper.tsx` never meet.
        const places = EXTENSIONS.flatMap((ext) => spellings(base, suffix, ext).map((path) => `${dir}/${ext}/${path}`));
        const test = `${dir}/${base}.test.ts`;
        const named = (i: number) => helpers.map((h) => `h${i}${h}`);
        const files = {
          ...Object.fromEntries(places.map((path, i) => [path, source(named(i))])),
          [test]: user(places.flatMap((path, i) => named(i).map((n) => [relative(dirname(test), path), n] as const))),
        };

        // Coverage: every default pattern, and both extensions, is met by a planted helper.
        for (const pattern of Object.values(DEFAULTS).flat()) {
          expect(
            places.some((path) => new RegExp(pattern).test(path)),
            `no helper was planted where ${pattern} reads it`,
          ).toBe(true);
        }

        for (const ext of EXTENSIONS) {
          expect(
            places.some((path) => path.endsWith(`.${ext}`)),
            `no helper was planted as .${ext}`,
          ).toBe(true);
        }

        // And no spelling is a place the defaults do not read, so each one tests a default.
        for (const path of places) {
          expect(
            Object.values(DEFAULTS)
              .flat()
              .some((pattern) => new RegExp(pattern).test(path)),
            `${path} is no default test-helper place`,
          ).toBe(true);
        }

        expect(flagged(plant(files))).toEqual([]);
      }),
    runs,
  );
});

// Ticket 1029, next/: R1 of the approved plan. A next/ test file, shared suite or test kit opens a
// SQLite file through `TestDatabase`, so `fabrika/test-database` fires exactly on
// `new DatabaseSync(arg)` from `node:sqlite` with `arg` not the literal `":memory:"`. Each generated
// file runs in process through oxlint's RuleTester. Plants, each run once on test-database.ts and
// restored: read the named import only (red: the namespace and default forms stopped firing); skip
// the `":memory:"` check (red: the in-memory cases fired); read every file (red: product code and
// files outside next/ fired).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { testDatabase } from "./test-database.ts";

const root = join(import.meta.dirname, "..");

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: root });

/** How the file names the constructor: its import line, and the callee it writes. */
const FORMS = [
  { name: "named", line: (from: string) => `import { DatabaseSync } from "${from}";`, callee: "DatabaseSync" },
  { name: "alias", line: (from: string) => `import { DatabaseSync as Db } from "${from}";`, callee: "Db" },
  { name: "namespace", line: (from: string) => `import * as sqlite from "${from}";`, callee: "sqlite.DatabaseSync" },
  { name: "default", line: (from: string) => `import sqlite from "${from}";`, callee: "sqlite.DatabaseSync" },
] as const;

/** The module it comes from: SQLite's, with or without `node:`, or a look-alike of ours. */
const FROM = fc.constantFrom(
  { from: "node:sqlite", sqlite: true },
  { from: "sqlite", sqlite: true },
  { from: "./sqlite.ts", sqlite: false },
  { from: "@kampus/vitest/TestDatabase", sqlite: false },
);

/** What the constructor is handed, and whether that stays in the process. */
const ARGUMENT = fc.oneof(
  fc.constantFrom(
    { code: '":memory:"', memory: true },
    { code: "`:memory:`", memory: true },
    { code: '":memory:", { readOnly: false }', memory: true },
    { code: "file", memory: false },
    { code: "file, { readOnly: true, timeout: 5000 }", memory: false },
    // A path built at run time: the code is a template literal, so its `${` is escaped here.
    { code: `\`\${dir}/store.db\``, memory: false },
    { code: '""', memory: false },
    { code: '":memory"', memory: false },
  ),
  fc.stringMatching(/^\/[a-z][a-z0-9/-]{0,20}\.(?:db|sqlite)$/).map((path) => ({ code: `"${path}"`, memory: false })),
);

const where = fc.constantFrom("next/apps/fabrika/src", "next/packages/libfabrika/src/node", "next/programs/inbox/src");
const stem = fc.stringMatching(/^[a-z][A-Za-z]{0,7}$/);

/** Each kind of path, and whether the rule holds a file there. */
const PATH = fc.oneof(
  fc
    .tuple(where, stem, fc.constantFrom(".test.ts", ".test.tsx", ".integration.test.ts", ".laws.integration.test.ts"))
    .map(([folder, name, end]) => ({ kind: "test", path: `${folder}/${name}${end}`, held: true })),
  fc.tuple(where, stem).map(([folder, name]) => ({ kind: "suite", path: `${folder}/${name}Test.ts`, held: true })),
  fc
    .tuple(where, stem)
    .map(([folder, name]) => ({ kind: "test kit", path: `${folder}/${name}.test-support.ts`, held: true })),
  fc.tuple(where, stem).map(([folder, name]) => ({ kind: "product", path: `${folder}/${name}.ts`, held: false })),
  fc
    .tuple(
      fc.constantFrom("packages/fabrika/src", "apps/fabrika/src", ".agents/skills/lead/scripts", "oxlint-plugins"),
      stem,
    )
    .map(([folder, name]) => ({ kind: "outside next/", path: `${folder}/${name}.test.ts`, held: false })),
);

it('R1: new DatabaseSync(arg) from node:sqlite fires in a next/ test, suite or test kit unless arg is ":memory:", under any name, and nowhere else', () => {
  fc.assert(
    fc.property(
      fc.record({ form: fc.constantFrom(...FORMS), from: FROM, argument: ARGUMENT, path: PATH }),
      ({ form, from, argument, path }) => {
        const code = [
          "declare const file: string, dir: string, TestDatabase: { make: (file: string) => unknown };",
          form.line(from.from),
          `export const db = new ${form.callee}(${argument.code});`,
          // Never: the module's own call, and a local class that shadows the import's name.
          "export const made = TestDatabase.make(file);",
          "export const local = () => { class DatabaseSync { constructor(_file: string) {} } return new DatabaseSync(file); };",
          "",
        ].join("\n");
        const filename = join(root, path.path);
        const fires = from.sqlite && !argument.memory && path.held;
        tester.run("test-database", testDatabase, {
          valid: fires ? [] : [{ code, filename }],
          invalid: fires ? [{ code, filename, errors: [{ line: 3, message: /TestDatabase\.make\(file\)/ }] }] : [],
        });
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

/** The test-database fires oxlint finds with the repo's own config, by file from the repo's top, as lines. */
const fires = (paths: readonly string[]) => {
  const out = spawnSync(join(root, "node_modules/.bin/oxlint"), ["--format=json", ...paths], {
    cwd: root,
    encoding: "utf8",
    // The whole tree's report passes Node's 1 MiB default on CI, which cut it mid-string (run 43799861377).
    maxBuffer: 2 ** 28,
  });
  const report = JSON.parse(out.stdout) as {
    diagnostics: Array<{ code: string; filename: string; labels: Array<{ span: { line: number } }> }>;
  };
  const found = new Map<string, number[]>();

  for (const d of report.diagnostics.filter((each) => each.code === "fabrika(test-database)")) {
    found.set(d.filename, [...(found.get(d.filename) ?? []), d.labels[0]!.span.line]);
  }

  return found;
};

it("scenario: the repo's .oxlintrc.json wires the rule for next/'s tests, suites and test kits", () => {
  // R4's wiring: a hand-opened file is refused in each kind of file the rule holds, while `":memory:"`
  // and `TestDatabase.make` pass beside it, and the same line in product code passes.
  const folder = mkdtempSync(join(root, "next/.t1029-database-"));

  try {
    const code = [
      'import { DatabaseSync } from "node:sqlite";',
      'import * as TestDatabase from "@kampus/vitest/TestDatabase";',
      "declare const file: string;",
      "export const hand = new DatabaseSync(file);",
      'export const memory = new DatabaseSync(":memory:");',
      "export const made = TestDatabase.make(file);",
      "",
    ].join("\n");
    const held = ["src/opens.integration.test.ts", "src/OpensTest.ts", "src/opens.test-support.ts"];
    const files = [...held, "src/opens.ts"].map((name) => join(folder, name));

    for (const file of files) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, code);
    }

    const found = fires([relative(root, folder)]);
    expect(Object.fromEntries(found)).toEqual(
      Object.fromEntries(held.map((name) => [relative(root, join(folder, name)), [4]])),
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

it("scenario: next/'s tree is at zero, so the rule blocks from the start (0523)", () => {
  // The real tree is the input: 62 calls in 53 files fired on `86a7668d6`, and ticket 1029 moved
  // each one to `TestDatabase.make` or `TestDatabase.open`.
  expect(Object.fromEntries(fires(["next"]))).toEqual({});
});

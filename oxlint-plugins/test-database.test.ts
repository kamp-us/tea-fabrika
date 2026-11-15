// Ticket 1029, next/: R1 of the approved plan. A next/ test file, shared suite or test kit opens a
// SQLite file through `TestDatabase`, so `fabrika/test-database` fires exactly on
// `new DatabaseSync(arg)` from `node:sqlite` with `arg` not the literal `":memory:"`. Each generated
// file runs in process through oxlint's RuleTester. Plants, each run once on test-database.ts and
// restored: read the named import only (red: the namespace and default forms stopped firing); skip
// the `":memory:"` check (red: the in-memory cases fired); read every file (red: product code and
// files outside next/ fired).
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { it } from "vitest";
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

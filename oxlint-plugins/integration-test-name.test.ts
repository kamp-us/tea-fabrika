// 0536, next/. A test file whose own code drives a real resource carries the integration or visual
// name. Each generated case runs in process through oxlint's RuleTester; one oxlint run over planted
// files proves the repo's own .oxlintrc.json wires the rule, and one over the real tree that it is at
// zero there. Plants, each run once on integration-test-name.ts and restored: drop the `:memory:`
// check (red: the memory cases fired); match the method name without its import (red: the fake
// FileSystem's and the local `spawn`'s cases fired); skip `.visual.` in NAMED (red: the visual files
// fired).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Record as Rec } from "effect";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { integrationTestName } from "./integration-test-name.ts";

const root = join(import.meta.dirname, "..");

RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: root });

/** A snippet that drives a real resource: its imports, the line that opens it, and what it drives. */
const REAL = [
  ['import { spawnSync } from "node:child_process";', 'spawnSync("git", ["init"]);', /a spawned process/],
  ['import * as cp from "child_process";', 'cp.spawn("node", []);', /a spawned process/],
  ['import { createServer } from "node:net";', "createServer().listen(0);", /a socket/],
  ['import { DatabaseSync } from "node:sqlite";', 'new DatabaseSync("/tmp/x.db");', /a SQLite file/],
  ['import { DatabaseSync } from "node:sqlite";', "new DatabaseSync(path);", /a SQLite file/],
  ['import { rolldown } from "rolldown";', "await rolldown({ input: 'a.ts' });", /a bundler/],
  ['import { chromium } from "playwright";', "await chromium.launch();", /a browser or Electron/],
  ['import { _electron } from "playwright";', "await _electron.launch({});", /a browser or Electron/],
  ['import { localInstance } from "./local-instance.ts";', "localInstance(home);", /the local instance/],
] as const;

/** Snippets that stay in the process: they must never fire, whatever the file's name. */
const MEMORY = [
  'import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:");',
  "const spawn = () => 0;\nspawn();",
  "const fake = { makeTempDirectory: () => 0, spawnSync: () => 0 };\nfake.spawnSync();\nfake.makeTempDirectory();",
  'import { readFileSync } from "node:fs";\nreadFileSync("a.txt", "utf8");',
  'import { chromium } from "playwright";\nconst kind = chromium.name();',
  'import { ChildProcessSpawner } from "effect/process";\nChildProcessSpawner.make(() => 0);',
] as const;

const where = fc.constantFrom("next/apps/fabrika/src", "next/packages/libfabrika/src/node", "next/programs/inbox/src");
const stem = fc.stringMatching(/^[a-z][A-Za-z]{0,7}(?:\.laws)?$/);
const end = fc.constantFrom(".ts", ".tsx");

it("L1: a real resource's call fires in a plain next/ test file, at its line, and never under the integration or visual name", () => {
  fc.assert(
    fc.property(fc.constantFrom(...REAL), where, stem, end, ([imports, line, drives], folder, name, ext) => {
      const code = `${imports}\nconst setup = () => 1;\n${line}\n`;
      tester.run("integration-test-name", integrationTestName, {
        valid: [
          { code, filename: join(root, folder, `${name}.integration.test${ext}`) },
          { code, filename: join(root, folder, `${name}.visual.test${ext}`) },
          // Only next/'s test files: product code, today's tests and support files are not this rule's.
          { code, filename: join(root, folder, `${name}${ext}`) },
          { code, filename: join(root, folder, `${name}.test-support.ts`) },
          { code, filename: join(root, "apps/fabrika/src", `${name}.test${ext}`) },
        ],
        invalid: [
          {
            code,
            filename: join(root, folder, `${name}.test${ext}`),
            errors: [{ line: 3, message: new RegExp(`${drives.source}.*\\.integration\\.test\\.ts`) }],
          },
        ],
      });
    }),
    { seed: 119120, numRuns: 60 },
  );
});

it("L2: code that stays in the process never fires, through an import or a look-alike name", () => {
  fc.assert(
    fc.property(fc.constantFrom(...MEMORY), where, stem, (code, folder, name) => {
      tester.run("integration-test-name", integrationTestName, {
        valid: [{ code, filename: join(root, folder, `${name}.test.ts`) }],
        invalid: [],
      });
    }),
    { seed: 119120, numRuns: 30 },
  );
});

/** The integration-test-name fires oxlint finds, by file from the repo's top, as lines. */
const fires = (paths: readonly string[]) => {
  const out = spawnSync(join(root, "node_modules/.bin/oxlint"), ["--format=json", ...paths], {
    cwd: root,
    encoding: "utf8",
  });
  const report = JSON.parse(out.stdout) as {
    diagnostics: Array<{ code: string; filename: string; labels: Array<{ span: { line: number } }> }>;
  };
  const found = new Map<string, number[]>();

  for (const d of report.diagnostics.filter((each) => each.code === "fabrika(integration-test-name)")) {
    found.set(d.filename, [...(found.get(d.filename) ?? []), d.labels[0]!.span.line]);
  }

  return found;
};

it("scenario: the repo's .oxlintrc.json wires the rule for next/'s test files", () => {
  const folder = mkdtempSync(join(root, "next/.p0536-names-"));

  try {
    const plain = join(folder, "src/opens.test.ts");
    const named = join(folder, "src/opens.integration.test.ts");
    const code = 'import { spawnSync } from "node:child_process";\nspawnSync("git", ["init"]);\n';

    for (const file of [plain, named]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, code);
    }

    const found = fires([relative(root, folder)]);
    expect(Rec.fromEntries(found)).toEqual({ [relative(root, plain)]: [2] });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

it("scenario: next/'s tree is at zero, so the rule blocks from the start (0523)", () => {
  // The real tree is the input: 73 files fired on experiment 292's tree, 72 of them drive a resource;
  // the one false alarm, exam/node-kinds.test.ts reading `git ls-files`, carries its reasoned line.
  expect(Rec.fromEntries(fires(["next"]))).toEqual({});
});

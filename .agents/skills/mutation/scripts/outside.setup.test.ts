import { spawnSync } from "node:child_process"; // edge: the setup is tried the way the box uses it, in a vitest run of its own
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"; // edge: that run's folder
import { tmpdir } from "node:os"; // edge: the folder's place
import { join } from "node:path"; // edge: the folder's paths
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

// Ticket 1314, today's tooling: outside.setup.ts, tried in a vitest run of its own with the settings Stryker's runner gives it
// (`provide`), in a folder that holds one rule file, as Stryker leaves it instrumented, and the test named after it.
const ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const SETUP = join(import.meta.dirname, "outside.setup.ts");

/** Stryker's own setup file, which runs first: it puts the active mutant on the namespace. */
const STRYKER = `import { inject } from "vitest";
if (inject("mode") === "mutant") globalThis.__stryker__ = { activeMutant: inject("activeMutant") };
`;

/** The rule file as Stryker instruments it: two mutants, ids 5 and 6. */
const RULE = 'export const rule = (a) => (stryMutAct_9fa48("5") ? a : stryMutAct_9fa48("6") ? !a : a);\n';

/** What a child process started as the file loads, and one started in a test, print of the variable; and the test's coverage. */
const PROBE = `import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { afterAll, it } from "vitest";
const seen = () => spawnSync(process.execPath, ["-p", "process.env.__STRYKER_ACTIVE_MUTANT__ ?? 'none'"], { encoding: "utf8" }).stdout.trim();
const atLoad = seen();
let inTest = "";
it("probe", () => { inTest = seen(); });
afterAll(() => {
  writeFileSync(process.env.PROBE_OUT, JSON.stringify({ atLoad, inTest, perTest: globalThis.__stryker__?.mutantCoverage?.perTest ?? {} }));
});
`;

const readSeen = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      atLoad: Schema.String,
      inTest: Schema.String,
      perTest: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)),
    }),
  ),
);

/** Runs the probe under the setup with these settings, and answers what it saw. */
const probe = (provide: Readonly<Record<string, string>>) => {
  const folder = mkdtempSync(join(tmpdir(), "outside-"));
  const out = join(folder, "seen.json");
  mkdirSync(join(folder, "oxlint-plugins"));
  symlinkSync(join(ROOT, "node_modules"), join(folder, "node_modules"));
  writeFileSync(join(folder, "oxlint-plugins", "probe.ts"), RULE);
  writeFileSync(join(folder, "oxlint-plugins", "probe.test.ts"), PROBE);
  writeFileSync(join(folder, "stryker.setup.ts"), STRYKER);

  writeFileSync(
    join(folder, "vitest.config.ts"),
    `export default { test: { include: ["oxlint-plugins/probe.test.ts"], setupFiles: [${JSON.stringify(join(folder, "stryker.setup.ts"))}, ${JSON.stringify(SETUP)}], provide: ${JSON.stringify(provide)} } };\n`,
  );

  const { __STRYKER_ACTIVE_MUTANT__: _kept, ...env } = process.env;

  const ran = spawnSync(
    join(ROOT, "node_modules", ".bin", "vitest"),
    ["run", "--config", join(folder, "vitest.config.ts"), "--root", folder],
    {
      cwd: folder,
      env: { ...env, PROBE_OUT: out },
      encoding: "utf8",
    },
  );

  expect(existsSync(out), `${ran.stdout}${ran.stderr}`).toBe(true);

  return readSeen(readFileSync(out, "utf8"));
};

describe("outside.setup, a child process of a test", () => {
  // Plants: never hand the variable to the child; hand it in the test only, so a rule linted as the file loads runs no mutant.
  it("scenario: sees the active mutant's id, as the test file loads and in a test, when Stryker runs a mutant", () => {
    const seen = probe({ globalNamespace: "__stryker__", mode: "mutant", activeMutant: "7" });

    expect(seen.atLoad).toBe("7");
    expect(seen.inTest).toBe("7");
    expect(seen.perTest).toEqual({});
  });

  // Plant: hand the child a mutant with no Stryker run.
  it("scenario: sees no mutant in a plain run, with no Stryker namespace", () => {
    const seen = probe({});

    expect(seen.atLoad).toBe("none");
    expect(seen.inTest).toBe("none");
    expect(seen.perTest).toEqual({});
  });

  // Plants: never cover the rule's mutants; hand the child a mutant in the dry run.
  it("scenario: sees no mutant in the dry run, and the rule's own test covers each mutant of its rule file", () => {
    const seen = probe({ globalNamespace: "__stryker__", mode: "dry-run", testNameSeparator: " " });

    expect(seen.atLoad).toBe("none");
    expect(seen.inTest).toBe("none");
    expect(Object.values(seen.perTest)).toEqual([{ "5": 1, "6": 1 }]);
  });
});

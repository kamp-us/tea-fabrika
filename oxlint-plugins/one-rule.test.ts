// The one-rule config (one-rule.test-support.ts) says what the repo's whole config says about its rule, on every file. It is built from the config's text, so
// a block field it forgot would change a law that reads it without any law failing: a block's `excludeFiles` once went missing, and every law over it stayed
// green. Plants (each run once, restored): drop each block's `excludeFiles` from the written config (red: a planted `process.stdout` in a client test file
// fires in the one-rule config and not in the real one); reverse the order of the blocks (red: the later block no longer decides).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { expect, it } from "vitest";
import { oneRuleConfig } from "./one-rule.test-support.ts";

const ROOT = join(import.meta.dirname, "..");

const OXLINT = join(ROOT, "node_modules/.bin/oxlint");

/** One planted file: where it sits, and what it holds. */
interface Sample {
  readonly path: string;
  readonly text: string;
}

const BANNED =
  'export const a = JSON.parse("1");\nexport const b = process.stdout;\nexport const c = Reflect.get({}, "x");\n';

const DATABASE =
  'import { DatabaseSync } from "node:sqlite";\n\nexport const db = (file: string) => new DatabaseSync(file);\n';

const SRC = "next/packages/libfabrika/src";

/** Where a `no-restricted-properties` block begins or ends: the client folder (whose test files a later block leaves out), other folders, tests and kalfa. */
const PROPERTY_PATHS: ReadonlyArray<Sample> = [
  `${SRC}/client/zz-planted.test.ts`,
  `${SRC}/client/zz-planted.ts`,
  `${SRC}/client/inner/zz-planted.test.ts`,
  `${SRC}/transport/zz-planted.ts`,
  `${SRC}/transport/zz-planted.test.ts`,
  "next/apps/fabrika/src/zz-planted.ts",
  "kalfa/config/src/zz-planted.ts",
  "next/zz-new-folder/zz-planted.ts",
].map((path) => ({ path, text: BANNED }));

const DATABASE_PATHS: ReadonlyArray<Sample> = [
  "next/apps/fabrika/src/zz-planted.test.ts",
  "next/apps/fabrika/src/zz-planted.ts",
  "kalfa/config/src/zz-planted.test.ts",
  "next/packages/libfabrika/src/zz-plantedTest.ts",
  "next/packages/libfabrika/src/zz-planted.test-support.ts",
].map((path) => ({ path, text: DATABASE }));

/** What oxlint says of one rule's fires on the planted files under a config, each as file, line, level and message, sorted. */
const fires = (at: string, config: string, code: string, samples: ReadonlyArray<Sample>): ReadonlyArray<string> => {
  const ran = spawnSync(
    OXLINT,
    [`--config=${config}`, "--disable-nested-config", "--no-ignore", "--format=json", ...samples.map((s) => s.path)],
    { cwd: at, encoding: "utf8", maxBuffer: 2 ** 28 },
  );

  const report = JSON.parse(ran.stdout) as {
    diagnostics: Array<{
      code: string;
      filename: string;
      severity: string;
      message: string;
      labels: Array<{ span: { line: number } }>;
    }>;
  };

  return report.diagnostics
    .filter((d) => d.code === code)
    .map((d) => `${d.filename}:${d.labels[0]?.span.line}:${d.severity}:${d.message}`)
    .sort();
};

/** A folder holding the repo's config and the planted files, as plant.ts makes one. */
const folderWith = (samples: ReadonlyArray<Sample>) => {
  // The real path: on a Mac the temp folder is behind a link, and oxlint matches globs on the real one.
  const at = realpathSync(mkdtempSync(join(tmpdir(), "one-rule-law-")));
  copyFileSync(join(ROOT, ".oxlintrc.json"), join(at, ".oxlintrc.json"));
  symlinkSync(join(ROOT, "oxlint-plugins"), join(at, "oxlint-plugins"));
  symlinkSync(join(ROOT, "vendor"), join(at, "vendor"));

  for (const { path, text } of samples) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }

  return at;
};

const same = (rule: string, js: boolean, code: string, all: ReadonlyArray<Sample>, seed: number) => {
  const at = folderWith(all);
  const one = oneRuleConfig(at, rule, js);

  try {
    // An empty answer from both would pass: the planted files together fire under the whole config.
    expect(fires(at, join(at, ".oxlintrc.json"), code, all).length).toBeGreaterThan(0);

    fc.assert(
      fc.property(fc.subarray(all as Sample[], { minLength: 1 }), (samples) => {
        const whole = fires(at, join(at, ".oxlintrc.json"), code, samples);
        expect(fires(at, one, code, samples)).toEqual(whole);
      }),
      // The first example is every path at once, so each run of the law may not be the one that draws the excluded path.
      { seed, numRuns: 6, examples: [[all as Sample[]]] },
    );
  } finally {
    rmSync(at, { recursive: true, force: true });
    rmSync(dirname(one), { recursive: true, force: true });
  }
};

it("a built-in rule in the one-rule config fires on each planted file exactly as under the whole config, a block's excluded paths included", () => {
  same("eslint/no-restricted-properties", false, "eslint(no-restricted-properties)", PROPERTY_PATHS, 119120);
});

it("a plugin rule in the one-rule config fires on each planted file exactly as under the whole config", () => {
  same("fabrika/test-database", true, "fabrika(test-database)", DATABASE_PATHS, 119121);
});

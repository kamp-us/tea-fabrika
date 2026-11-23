// The check is the only thing holding the rule, so a clash is planted and seen to fail. Each runs the real script on a
// small git tree of its own, and its exit code and words are what is read.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";

const SCRIPT = join(import.meta.dirname, "law-ids.ts");

const home = mkdtempSync(join(tmpdir(), "law-ids-"));

afterAll(() => rmSync(home, { recursive: true, force: true }));

let trees = 0;

/** Runs the check on a new git tree holding these files, all staged. */
const run = (files: Readonly<Record<string, string>>) => {
  trees += 1;
  const tree = join(home, String(trees));
  mkdirSync(tree);
  spawnSync("git", ["init", "-q"], { cwd: tree });

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
    spawnSync("git", ["add", path], { cwd: tree });
  }

  const ran = spawnSync("node", [SCRIPT, tree], { encoding: "utf8" });

  return { status: ran.status, said: ran.stdout + ran.stderr };
};

const PACKAGE = { "kalfa/one/package.json": "{}" };

describe("law ids", () => {
  it("refuses two different laws with one id, naming both places", () => {
    const { status, said } = run({
      ...PACKAGE,
      "kalfa/one/src/A.test.ts": `it("S9 first law: a", () => {});\n`,
      "kalfa/one/src/B.test.ts": `\n\nit.effect.prop(\n  "S9 another law: b",\n  {},\n);\n`,
    });

    expect(status).toBe(1);
    expect(said).toContain("kalfa/one|S9");
    expect(said).toContain("kalfa/one/src/A.test.ts:1");
    expect(said).toContain("kalfa/one/src/B.test.ts:4");
  });

  it("allows one law named from a support file and from a test file", () => {
    const { status } = run({
      ...PACKAGE,
      "kalfa/one/src/A.test-support.ts": `it("S9 the law: a", () => {});\n`,
      "kalfa/one/src/A.test.ts": `it("S9 the law: a", () => {});\n`,
    });

    expect(status).toBe(0);
  });

  it("allows the same id in two packages", () => {
    const { status } = run({
      ...PACKAGE,
      "kalfa/two/package.json": "{}",
      "kalfa/one/src/A.test.ts": `it("S9 a", () => {});\n`,
      "kalfa/two/src/A.test.ts": `it("S9 b", () => {});\n`,
    });

    expect(status).toBe(0);
  });
});

// Decision 0580: a plant's record is printed by plant.ts from the law's own options, never typed by
// hand. `node .agents/skills/tests/scripts/plant.ts <file> "<title>"` runs that one law and prints
// `{ file, law, plant, result }`, and refuses with exit 1 a title that matches no law or two, and a
// law with no plant, so a record is never made up. Each law runs the script as a child process on
// the fixture beside it.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE = ".agents/skills/tests/scripts/fixtures/plant/laws.fixture.ts";

const plant = (title: string) => {
  const ran = spawnSync(process.execPath, [".agents/skills/tests/scripts/plant.ts", FIXTURE, title], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: ran.status, stdout: ran.stdout, said: ran.stdout + ran.stderr };
};

// scenario: the script's two kinds of answer. First the records it prints, one for a law its break
// turns red and one it leaves green; then its refusal exits, one per way a record could be made up:
// a title that matches no law, one that matches two, and a law with no plant. The records come
// first, so a missing or broken script, which also exits 1, cannot pass as a refusal.
// Plants, after build: pick the first of two matches; write `green` for a failed law.
it("scenario: plant.ts prints one record for a law that matches once, red or green, and refuses a title that matches no law or two, and a law with no plant", () => {
  const records = [
    ["the planted law breaks", "add one too many", "red"],
    ["the planted law holds", "answer the old sum", "green"],
  ] as const;

  for (const [law, planted, result] of records) {
    const ran = plant(law);
    expect(ran.status, ran.said).toBe(0);
    expect(JSON.parse(ran.stdout.trim())).toEqual({ file: FIXTURE, law, plant: planted, result });
  }

  for (const title of ["a law nobody wrote", "a title written twice", "a law with no plant"]) {
    const ran = plant(title);
    expect(ran.status, `${title}: ${ran.said}`).toBe(1);
    expect(ran.stdout).not.toMatch(/"result"/);
  }
}, 300_000);

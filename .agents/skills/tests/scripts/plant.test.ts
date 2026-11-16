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
const SHARED = ".agents/skills/tests/scripts/fixtures/plant/shared.fixture.ts";
const RUNS_SHARED = ".agents/skills/tests/scripts/fixtures/plant/runs-shared.fixture.ts";

const plant = (title: string, file = FIXTURE) => {
  const ran = spawnSync(process.execPath, [".agents/skills/tests/scripts/plant.ts", file, title], {
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

// scenario: where a law is declared is one fact of the module graph, not a value to generate. A
// shared suite declares its law in one file (shared.fixture.ts) and a runner file runs it
// (runs-shared.fixture.ts), as libfabrika's `*Test.ts` suites are run from their
// `*.integration.test.ts` files. plant.ts is given the runner, and its record names the file that
// declares the law, which is the file the CI plant check keys a law by (0580, the plan's slice 2
// amendment).
// Plant, after build: record the running file in place of the declaring one (`Plants.records` reads
// `file.filepath` and leaves `meta.file` unread).
it("scenario: plant.ts, run on a file that runs a shared suite, records the suite's law under the file that declares it, not the file it ran", () => {
  const ran = plant("the shared law breaks", RUNS_SHARED);
  expect(ran.status, ran.said).toBe(0);
  expect(JSON.parse(ran.stdout.trim())).toEqual({
    file: SHARED,
    law: "the shared law breaks",
    plant: "add one too many in the suite",
    result: "red",
  });
}, 120_000);

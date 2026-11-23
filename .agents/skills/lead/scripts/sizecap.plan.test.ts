import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { expect, it } from "vitest";

// Lead tooling: plancheck.sh runs `sizecap.plan.ts` on every draft call, in place of `sizecap.ts plan`, because it starts 0.35 s sooner. It must say what
// `sizecap.ts plan` says. Plants (each run once, restored): print the table total without the slices' count; skip the advice lines; exit 0 on an unreadable plan.
const options = { seed: 119120, numRuns: 12 };

const light = join(import.meta.dirname, "sizecap.plan.ts");

const whole = join(import.meta.dirname, "sizecap.ts");

const run = (script: string, args: ReadonlyArray<string>) => {
  const ran = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 30_000 });

  return { code: ran.status, out: ran.stdout, err: ran.stderr };
};

const LINES = [
  "## Files",
  "| file | owner | Product lines expected |",
  "|---|---|---|",
  "| src/a.ts | build | 120 |",
  "| src/b.ts | build | tests |",
  "| src/c.ts | build | 1,200 |",
  "## Size",
  "1. First slice, 40 lines.",
  "2. Second slice: no estimate",
  "3. Third slice, 7 product lines",
  "   continued over a line",
  "```",
  "| fenced | Product lines expected |",
  "```",
  "Estimate: 3 steps, $2",
  "",
];

it("property: sizecap.plan.ts prints and exits as `sizecap.ts plan` does, on any plan", () => {
  const folder = mkdtempSync(join(tmpdir(), "sizecap-plan-"));

  try {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...LINES), { maxLength: 14 }), (lines) => {
        const plan = join(folder, "plan.md");
        writeFileSync(plan, lines.join("\n"));

        expect(run(light, [plan])).toEqual(run(whole, ["plan", plan]));
      }),
      options,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

it("property: an unreadable plan is named on stderr and exits 2, as `sizecap.ts plan` does", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z]{3,8}$/), (name) => {
      const missing = join(tmpdir(), `sizecap-plan-missing-${name}`);
      const got = run(light, [missing]);

      expect(got.code).toBe(2);
      expect(got).toEqual(run(whole, ["plan", missing]));
    }),
    { seed: 119120, numRuns: 5 },
  );
});

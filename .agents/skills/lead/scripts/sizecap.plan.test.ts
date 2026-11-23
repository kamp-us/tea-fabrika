import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { expect, it } from "vitest";
import { planReport } from "./sizecap.plan.ts";

// Lead tooling: plancheck.sh runs `sizecap.plan.ts` on every draft call, and `sizecap.ts plan` prints the same report from the same function. The run of the
// file says `planReport` of the plan, line for line. Plants (each run once, restored): print the table total without the slices' count; skip the advice lines;
// exit 0 on an unreadable plan.
const options = { seed: 119120, numRuns: 12 };

const light = join(import.meta.dirname, "sizecap.plan.ts");

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

it("property: sizecap.plan.ts prints the plan report, one line each, and exits 0, on any plan", () => {
  const folder = mkdtempSync(join(tmpdir(), "sizecap-plan-"));

  try {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...LINES), { maxLength: 14 }), (lines) => {
        const plan = join(folder, "plan.md");
        writeFileSync(plan, lines.join("\n"));

        expect(run(light, [plan])).toEqual({ code: 0, out: `${planReport(lines.join("\n")).join("\n")}\n`, err: "" });
      }),
      options,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

it("property: an unreadable plan is named on stderr, prints nothing and exits 2", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z]{3,8}$/), (name) => {
      const missing = join(tmpdir(), `sizecap-plan-missing-${name}`);
      const got = run(light, [missing]);

      expect(got).toEqual({ code: 2, out: "", err: `sizecap: cannot read ${missing}\n` });
    }),
    { seed: 119120, numRuns: 5 },
  );
});

it("pinned: a plan with a table total of 1,320 lines and three slices, one with no estimate, prints the size line and one advice line", () => {
  const folder = mkdtempSync(join(tmpdir(), "sizecap-plan-"));

  try {
    const plan = join(folder, "plan.md");
    writeFileSync(plan, LINES.filter((line) => !line.includes("fenced") && !line.startsWith("```")).join("\n"));

    expect(run(light, [plan])).toEqual({
      code: 0,
      out: [
        "size: 1320 product lines in the files table, 3 slices, the largest 40",
        'size: slice 2 (Second slice) gives no "<n> lines" estimate (advice only, no number caps the size of a pull request)',
        "",
      ].join("\n"),
      err: "",
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

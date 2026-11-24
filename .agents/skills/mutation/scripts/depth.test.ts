import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { cap, capped, depthConfig, depthFrom } from "./depth.ts";

// Today's lead tooling: how the mutation box caps the cases a property law draws (ticket 1306).
const options = { seed: 119120, numRuns: 200 };

const count = fc.integer({ min: 1, max: 5000 });

describe("the run depth, its pure parts", () => {
  // Plants: take the cap and not the smaller count (a law of 3 cases would draw more); take the law's count when it is over the cap;
  // a law with no count draws the library's 100.
  it("a law draws its own count when that is under the cap, else the cap, and a law with no count draws the cap", () => {
    fc.assert(
      fc.property(count, count, (own, to) => {
        expect(capped(own, to)).toBe(own < to ? own : to);
        expect(capped(undefined, to)).toBe(to);
        expect(cap({ runs: own, seed: 7 }, to)).toEqual({ runs: capped(own, to), seed: 7 });
        expect(cap(undefined, to)).toEqual({ runs: to });
      }),
      options,
    );
  });

  // Plants: let 0, a fraction, a negative, a word or a sign through; or refuse an unset or empty value.
  it("MUTATE_RUNS is a whole number from 1, unset or empty is no depth, and anything else is refused", () => {
    expect(depthFrom(undefined)).toBeUndefined();
    expect(depthFrom("")).toBeUndefined();
    fc.assert(
      fc.property(count, (n) => {
        expect(depthFrom(String(n))).toBe(n);
      }),
      options,
    );

    for (const bad of ["0", "-3", "2.5", "ten", "+4", "07", " 5", "5 ", "1e3", "full"]) {
      expect(() => depthFrom(bad), bad).toThrow(/MUTATE_RUNS must be a whole number/);
    }
  });

  // Plant: always give the aliases, which would send every run through the cap.
  it("with no depth the config adds nothing, and with one it swaps effect/Arbitrary and has vitest load @effect/vitest", () => {
    expect(depthConfig(undefined)).toEqual({});

    const set = depthConfig(6);
    expect(set.server).toEqual({ deps: { inline: ["@effect/vitest"] } });
    expect(set.alias?.map((a) => String(a.find))).toEqual(["/^effect\\/Arbitrary$/", "/^effect-real\\/Arbitrary$/"]);
  });
});

// The whole path, in a real vitest: a law that writes one byte for each case it draws, run through depth.config's own pieces. Plants:
// leave the alias out (every count is the law's own), cap with `runs ?? 100`, set the counts after the cap, load the real
// `@effect/vitest` outside vitest (its import never sees the swap).
describe("the run depth, through a real vitest", () => {
  const here = import.meta.dirname;
  const scratch = join(here, "fixtures");
  mkdirSync(scratch, { recursive: true });
  const folder = mkdtempSync(join(scratch, "depth-"));

  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });

    // The folder holds nothing else here: leave none behind.
    if (readdirSync(scratch).length === 0) {
      rmdirSync(scratch);
    }
  });

  writeFileSync(
    join(folder, "config.ts"),
    [
      'import { defineConfig } from "vitest/config";',
      `import { depth, depthConfig } from ${JSON.stringify(join(here, "depth.ts"))};`,
      'export default defineConfig({ test: { include: ["law.test.ts"], ...depthConfig(depth) } });',
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(folder, "law.test.ts"),
    [
      'import { it } from "@effect/vitest";',
      'import { Effect, Schema } from "effect";',
      'import { appendFileSync } from "node:fs";',
      "const own = process.env.ASK === undefined ? {} : { runs: Number(process.env.ASK) };",
      'it.effect.prop("draws", { n: Schema.Int }, () => Effect.sync(() => appendFileSync(process.env.DRAWN ?? "", "x")), { arbitrary: { ...own, seed: 1 } });',
      "",
    ].join("\n"),
  );

  const drawn = (depth: string | undefined, ask: number | undefined) => {
    const file = join(folder, "drawn.txt");
    writeFileSync(file, "");

    const ran = spawnSync(
      process.execPath,
      [
        join(here, "../../../../node_modules/vitest/vitest.mjs"),
        "run",
        "--root",
        folder,
        "--config",
        join(folder, "config.ts"),
      ],
      {
        encoding: "utf8",
        timeout: 50_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DRAWN: file,
          ...(depth === undefined ? {} : { MUTATE_RUNS: depth }),
          ...(ask === undefined ? {} : { ASK: String(ask) }),
        },
      },
    );

    expect(ran.status, ran.stdout + ran.stderr).toBe(0);

    return readFileSync(file, "utf8").length;
  };

  it("caps a law's count to MUTATE_RUNS, leaves a smaller one alone, and with none set leaves every count", () => {
    expect(drawn("7", 100), "a law of 100 draws the cap").toBe(7);
    expect(drawn("7", 3), "a law of 3 keeps 3").toBe(3);
    expect(drawn("7", undefined), "a law with no count draws the cap").toBe(7);
    expect(drawn(undefined, 20), "no depth: the law's own 20").toBe(20);
  });
});

// The two scripts that start vitest in the box are shell, and the box starts Docker, so they are read as text. Plants: drop `$depth`
// from either vitest run of the entry script (a baseline at full depth), drop the exit 73 guard (a build with no config fails as a
// failed baseline), name another config, drop the depth from run.sh's own config (Stryker's dry run at full depth).
describe("the box's scripts carry the depth", () => {
  const here = import.meta.dirname;
  const entry = readFileSync(join(here, "../../lead/scripts/mutbox-entry.sh"), "utf8");
  const runSh = readFileSync(join(here, "run.sh"), "utf8");
  const config = ".agents/skills/mutation/scripts/depth.config.ts";

  it("each vitest run of the entry script reads the depth config, a build without it exits 73, and run.sh caps its own config", () => {
    const runs = entry.split("\n").filter((line) => line.includes("node_modules/.bin/vitest run"));

    expect(runs).toHaveLength(2);

    for (const line of runs) {
      expect(line).toContain("$depth");
    }

    expect(existsSync(join(here, "../../../../", config))).toBe(true);
    expect(entry).toContain(`[ -f ${config} ] || exit 73`);
    expect(entry).toContain(`depth=--config=${config}`);
    expect(runSh).toContain("...depthConfig(depth)");
  });

  // Plants: run arm c under the cap (the recheck would repeat the capped run), leave the cap on for arm a after it, read no plan, or let run.sh
  // ignore RANGES or TEST_NAMES (the recheck would run the sample again, and every law).
  it("the recheck is arm c: in a subshell with no MUTATE_RUNS, from recheck.ts's plan, and run.sh takes its ranges and test names", () => {
    expect(entry).toMatch(/\(\n\t+unset MUTATE_RUNS\n[\s\S]*?arm c "\$\{T\}c" ""\n\t+\)/);
    expect(entry).toContain("recheck.ts");
    expect(entry.indexOf(`arm c "\${T}c"`)).toBeLessThan(entry.indexOf("# Arm a:"));
    expect(runSh).toContain(`if [ -n "\${RANGES:-}" ]; then ranges=$RANGES`);
    expect(runSh).toContain("testNamePattern: names");
    expect(runSh).toContain("TEST_LIMIT=" + "$" + "{TEST_LIMIT:-10000}");
  });
});

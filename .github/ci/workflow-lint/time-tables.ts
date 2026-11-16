import * as Rec from "effect/Record";
// Today's CI, serving both versions. TT1 and TT2: each test leg's time table (time-table.ts) and
// its timings upload, in check.yaml and scheduled.yaml.
import { fileName, STEP } from "../time-table.ts";
import { compact, env, map, type Rule, sameEntries, steps, TOKEN, uses } from "./shared.ts";

// Each test leg's time table (time-table.ts): its steps' seconds from GitHub's jobs API, read with
// the workflow's token, and its slowest test files from its report, in the job summary. Then the same
// numbers as one JSON file, uploaded with the run attempt in its name, so a rerun keeps both.
export const TIME_TABLE = "node .github/ci/time-table.ts";

export const timeTableEnv = (report: string) => ({
  GITHUB_TOKEN: TOKEN,
  JOB_ID: `\${{ job.check_run_id }}`,
  HEAD: env.HEAD,
  LEG: `\${{ matrix.shard }}`,
  REPORT: `\${{ runner.temp }}/${report}`,
});

// check.yaml's test jobs, each with the Vitest report its time table reads: next alone, since 0539
// took the tooling tests' job off the merge line.
export const TIMED_LEGS = [["next", "next.json"]] as const;

// A timings upload's `with:`, whole. `retention-days` is a setting (0069), so only its being there is
// held, as for the record's upload. Its name starts `timings-`, so it can never be taken for a
// tested-tree record, which `matched` (changes.mjs) finds by its `tested-<tree>-<base>` name (Q1).
const TIMINGS = {
  name: `timings-\${{ github.job }}-\${{ matrix.shard }}-attempt-\${{ github.run_attempt }}`,
  path: `\${{ runner.temp }}/${fileName({ job: `\${{ github.job }}`, leg: `\${{ matrix.shard }}` })}`,
  "if-no-files-found": "warn",
};

/** TT2 and Q1: an upload of exactly a leg's timings file, under its own name, and nothing else. */
export const isTimings = (step: Record<string, unknown>): boolean => {
  const given = map(step["with"]);
  const kept = given["retention-days"];
  return (
    uses(step, "actions/upload-artifact") &&
    sameEntries(
      Rec.toEntries(given).filter(([key]) => key !== "retention-days"),
      Rec.toEntries(TIMINGS),
    ) &&
    typeof kept === "number" &&
    kept >= 1
  );
};

/**
 * TT1 and TT2, for one test leg whose Vitest report is `$RUNNER_TEMP/<report>`. The time table is
 * the job's last command, so it times every step before it; it runs on every result, a red or
 * canceled leg too, and never fails the job. Its timings file is uploaded after it, the same way.
 */
export const timed = (name: string, job: Record<string, unknown>, report: string): string[] => {
  const list = steps(job);
  const tables = list.filter((s) => s["run"] === TIME_TABLE);
  const uploads = list.filter((s) => uses(s, "actions/upload-artifact") && map(s["with"])["path"] === TIMINGS.path);
  const [table] = tables,
    [upload] = uploads;
  const errors: string[] = [];

  if (
    !(
      tables.length === 1 &&
      table?.["name"] === STEP &&
      compact(table["if"]) === "always()" &&
      table["continue-on-error"] === true &&
      table["timeout-minutes"] === 1 &&
      JSON.stringify(table["env"]) === JSON.stringify(timeTableEnv(report)) &&
      list.filter((s) => "run" in s).at(-1) === table
    )
  ) {
    errors.push(
      `TT1: ${name} ends its commands with the ${STEP} step once, on every result, never failing the job, reading ${report}`,
    );
  }

  if (
    !(
      uploads.length === 1 &&
      upload !== undefined &&
      isTimings(upload) &&
      compact(upload?.["if"]) === "always()" &&
      upload?.["continue-on-error"] === true &&
      upload["timeout-minutes"] === 1 &&
      table !== undefined &&
      list.indexOf(upload ?? {}) > list.indexOf(table)
    )
  ) {
    errors.push(
      `TT2: ${name} uploads its timings file once, after the ${STEP} step, on every result, never failing the job, within a minute`,
    );
  }

  return errors;
};

// TT1 and TT2: every test leg writes its time table and uploads its timings file.
export const timeTables: Rule = ({ jobs }, require) => {
  for (const [name, report] of TIMED_LEGS) {
    for (const reason of timed(name, map(jobs[name]), report)) {
      require(false, reason);
    }
  }
};

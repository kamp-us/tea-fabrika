// Today's lead tooling. The gate of the hourly mutation run and of its heartbeat: does this workflow run do its
// work? The same shape as the full run's gate (gate.mjs), with two ways to pace it.
//
//   node .github/ci/mutation-gate.mjs --workflow mutation.yaml --job mutation --head SHA
//   node .github/ci/mutation-gate.mjs --workflow mutation-heartbeat.yaml --job heartbeat --paced
//
// The mutation run is not paced by a gap. Its workflow's `concurrency` group keeps one run going and only the newest
// waiting one, so a burst of merges costs one more run up to the newest head, and a merge waits only for the run in
// progress and its own (about 44 runs a day on the real history, with no merge waiting more than 16 minutes at the
// 90th percentile). What the gate adds there is the tested-head skip and a backoff for a run that keeps failing:
//
//   the run's event      the head was tested   the last runs                              the gate says
//   workflow_dispatch    either                any                                        start, by_hand
//   push or schedule     yes                   any                                        skip, tested
//   push or schedule     no                    `MUTATION_FAIL_STREAK` failed in a row,    skip, backoff
//                                              the last start within `MUTATION_FAIL_GAP_MINUTES`
//   push or schedule     no                    anything else                              start, due
//
// So a broken image cannot burn a slot all day: after the streak, a push starts the work only when none started within
// the fail gap, and a pass ends the streak. The heartbeat's check is paced (`--paced`): a push or the cron starts it
// only when no check started within `MUTATION_GAP_MINUTES` (default 60), so it does not install on every push.
//
// A head is tested when it is the commit the newest passing run of the job ended at (`--head` names the head; the
// heartbeat gives none, so it is never tested). It writes `start=true|false`, `reason=` and `base=` (the commit the
// last passing run ended at, empty when none) as the step's outputs, and one line for the run's summary.
//
// It runs while its own run holds the workflow's concurrency group, so every run ahead of it has ended and the last
// start is read, not guessed. A gate that cannot read GitHub fails the step: the work job is then skipped and the run
// ends red, never a quiet `skip`. No installed dependency and no type stripping, so the job runs on the runner's own
// Node after `setup-node`.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { passedRun, realGh, recent } from "./mutation-runs.mjs";

const MINUTE = 60_000;

/** The default gap of the paced heartbeat, in minutes: one check an hour. */
export const GAP_MINUTES = 60;

/** The default failed runs in a row before the mutation gate backs off. */
export const FAIL_STREAK = 3;

/** The default gap, in minutes, between two starts while it backs off. */
export const FAIL_GAP_MINUTES = 60;

/**
 * What the gate read: the run's event, the time, the paced gap in ms (0 when not paced), when the last run's job
 * started (ms, or null), whether the head was already covered by a passing run, how many runs failed in a row, and
 * the backoff's streak and gap in ms.
 * @typedef {{
 *   event: string, now: number, gap: number, last: number | null, tested: boolean,
 *   streak: number, streakLimit: number, failGap: number,
 * }} Seen
 */

/**
 * @typedef {{ start: boolean, reason: "by_hand" | "tested" | "too_soon" | "backoff" | "due" }} Decision
 */

/**
 * The rule, by the table at the top. A paced gate (`gap` above 0) skips a start within the gap, `too_soon`.
 * @param {Seen} seen
 * @returns {Decision}
 */
export const decide = ({ event, now, gap, last, tested, streak, streakLimit, failGap }) => {
  if (event === "workflow_dispatch") {
    return { start: true, reason: "by_hand" };
  }

  if (tested) {
    return { start: false, reason: "tested" };
  }

  if (last !== null && now - last < gap) {
    return { start: false, reason: "too_soon" };
  }

  return streak >= streakLimit && last !== null && now - last < failGap
    ? { start: false, reason: "backoff" }
    : { start: true, reason: "due" };
};

/** @typedef {import("./mutation-runs.mjs").Gh} Gh */

/**
 * Reads the runs and decides. `env` holds the run's own settings: `GITHUB_EVENT_NAME`, `GITHUB_RUN_ID`,
 * `MUTATION_GAP_MINUTES` (read only when `paced`), `MUTATION_FAIL_STREAK` and `MUTATION_FAIL_GAP_MINUTES`.
 * @param {Record<string, string | undefined>} env
 * @param {Gh} gh
 * @param {number} now
 * @param {string} workflow
 * @param {string} job
 * @param {string | null} head
 * @param {boolean} paced
 * @returns {Decision & { base: string, line: string }}
 */
export const gate = (env, gh, now, workflow, job, head, paced) => {
  /** @param {string} name @param {number} fallback */
  const minutes = (name, fallback) => {
    const value = Number(env[name] || fallback);

    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`gate: ${name} must be a whole number, at least 1: ${env[name]}`);
    }

    return value;
  };

  const gap = paced ? minutes("MUTATION_GAP_MINUTES", GAP_MINUTES) : 0;
  const streakLimit = minutes("MUTATION_FAIL_STREAK", FAIL_STREAK);
  const failGap = minutes("MUTATION_FAIL_GAP_MINUTES", FAIL_GAP_MINUTES);
  const run = Number(env["GITHUB_RUN_ID"]);
  const passed = passedRun(gh, workflow, job);
  const { last, streak } = recent(gh, workflow, job, Number.isInteger(run) && run > 0 ? run : null, streakLimit);
  const event = env["GITHUB_EVENT_NAME"] ?? "";

  const decision = decide({
    event,
    now,
    gap: gap * MINUTE,
    last,
    tested: head !== null && passed?.headSha === head,
    streak,
    streakLimit,
    failGap: failGap * MINUTE,
  });

  return {
    ...decision,
    base: passed?.headSha ?? "",
    line: `gate: ${decision.start ? "start" : "skip"}, ${decision.reason} (event ${event}, ${
      paced ? `gap ${gap} min` : "no gap"
    }, ${streak} failed in a row, last start ${last === null ? "none" : new Date(last).toISOString()})`,
  };
};

/** @param {string} name */
const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);

  return at < 0 ? null : (process.argv[at + 1] ?? null);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workflow = flag("workflow");
  const job = flag("job");

  if (workflow === null || job === null) {
    throw new Error("gate: --workflow and --job are required");
  }

  const answer = gate(process.env, realGh, Date.now(), workflow, job, flag("head"), process.argv.includes("--paced"));
  const outputs = `start=${answer.start}\nreason=${answer.reason}\nbase=${answer.base}\n`;

  if (process.env["GITHUB_OUTPUT"] !== undefined) {
    appendFileSync(process.env["GITHUB_OUTPUT"], outputs);
  }

  if (process.env["GITHUB_STEP_SUMMARY"] !== undefined) {
    appendFileSync(process.env["GITHUB_STEP_SUMMARY"], `${answer.line}\n`);
  }

  console.log(answer.line);
}

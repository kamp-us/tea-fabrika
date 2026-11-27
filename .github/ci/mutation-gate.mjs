// Today's lead tooling. The gate of the hourly mutation run and of its heartbeat: does this workflow run do its
// work? The same shape as the full run's gate (gate.mjs): a push to main starts the work only when no earlier run
// of this workflow started its job within the gap, and the hourly cron is the catch-up. So there are at most 24
// runs of the work a day, and a busy day of merges does not install and run on each push.
//
//   node .github/ci/mutation-gate.mjs --workflow mutation.yaml --job mutation [--head SHA]
//
//   the run's event      the head was tested   the last job started   the gate says
//   workflow_dispatch    either                any time               start, by_hand
//   push or schedule     yes                   any time               skip, tested
//   push or schedule     no                    within the gap         skip, too_soon
//   push or schedule     no                    before it, or never    start, due
//
// A head is tested when it is the commit the newest passing run of the job ended at (`--head` names the head; the
// heartbeat gives none, so it is never tested). The gap is `MUTATION_GAP_MINUTES`, a setting beside the cron line in
// the workflow (default 60). It writes `start=true|false`, `reason=` and `base=` (the commit the last passing run
// ended at, empty when none) as the step's outputs, and one line for the run's summary.
//
// It runs while its own run holds the workflow's concurrency group, so every run ahead of it has ended and the last
// start is read, not guessed. A gate that cannot read GitHub fails the step: the work job is then skipped and the run
// ends red, never a quiet `skip`. No installed dependency and no type stripping, so the job runs on the runner's own
// Node after `setup-node`.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { passedRun, realGh, startedAt } from "./mutation-runs.mjs";

const MINUTE = 60_000;

/** The default gap, in minutes: one run of the work an hour. */
export const GAP_MINUTES = 60;

/**
 * What the gate read: the run's event, the time, the gap in ms, when the last run's job started (ms, or null), and
 * whether the head was already covered by a passing run.
 * @typedef {{ event: string, now: number, gap: number, last: number | null, tested: boolean }} Seen
 */

/**
 * @typedef {{ start: boolean, reason: "by_hand" | "tested" | "too_soon" | "due" }} Decision
 */

/**
 * The rule, by the table at the top.
 * @param {Seen} seen
 * @returns {Decision}
 */
export const decide = ({ event, now, gap, last, tested }) => {
  if (event === "workflow_dispatch") {
    return { start: true, reason: "by_hand" };
  }

  if (tested) {
    return { start: false, reason: "tested" };
  }

  return last !== null && now - last < gap ? { start: false, reason: "too_soon" } : { start: true, reason: "due" };
};

/** @typedef {import("./mutation-runs.mjs").Gh} Gh */

/**
 * Reads the runs and decides. `env` holds the run's own settings: `GITHUB_EVENT_NAME`, `GITHUB_RUN_ID` and
 * `MUTATION_GAP_MINUTES`.
 * @param {Record<string, string | undefined>} env
 * @param {Gh} gh
 * @param {number} now
 * @param {string} workflow
 * @param {string} job
 * @param {string | null} head
 * @returns {Decision & { base: string, line: string }}
 */
export const gate = (env, gh, now, workflow, job, head) => {
  const gap = Number(env["MUTATION_GAP_MINUTES"] || GAP_MINUTES);

  if (!Number.isInteger(gap) || gap < 1) {
    throw new Error(
      `gate: MUTATION_GAP_MINUTES must be a whole number of minutes, at least 1: ${env["MUTATION_GAP_MINUTES"]}`,
    );
  }

  const run = Number(env["GITHUB_RUN_ID"]);
  const passed = passedRun(gh, workflow, job);
  const last = startedAt(gh, workflow, job, Number.isInteger(run) && run > 0 ? run : null);
  const event = env["GITHUB_EVENT_NAME"] ?? "";
  const decision = decide({ event, now, gap: gap * MINUTE, last, tested: head !== null && passed?.headSha === head });

  return {
    ...decision,
    base: passed?.headSha ?? "",
    line: `gate: ${decision.start ? "start" : "skip"}, ${decision.reason} (event ${event}, gap ${gap} min, last start ${
      last === null ? "none" : new Date(last).toISOString()
    })`,
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

  const answer = gate(process.env, realGh, Date.now(), workflow, job, flag("head"));
  const outputs = `start=${answer.start}\nreason=${answer.reason}\nbase=${answer.base}\n`;

  if (process.env["GITHUB_OUTPUT"] !== undefined) {
    appendFileSync(process.env["GITHUB_OUTPUT"], outputs);
  }

  if (process.env["GITHUB_STEP_SUMMARY"] !== undefined) {
    appendFileSync(process.env["GITHUB_STEP_SUMMARY"], `${answer.line}\n`);
  }

  console.log(answer.line);
}

// Today's lead tooling. What the hourly mutation run's gate reads about earlier runs of a workflow: which
// run last passed, and when a run last started. Plain Node with no installed package, like gate.mjs, so a
// gate job needs `setup-node` and nothing else. heartbeat.ts reads the last pass the same way (its test
// holds the two to one answer).
//
// A run counts only when its own job ran. A push to main starts a workflow run, and the gate may then skip
// the real work: that run ends `success` in seconds with its work job `skipped`. Reading run conclusions
// alone would take such a run for a pass, and a dead mutation run would hide behind the skipped ones. So each
// run's jobs are read: a run passed when its job `<job>` concluded `success`, and started when that job has a
// start time and did not end `skipped` (a skipped job carries a start time too).
//
// Reads go through `gh` (a `Gh`), so a law can hand in a fake that records the exact arguments. The scan
// reads at most `SCAN` runs, newest first: past that, a pass is as good as none.
import { execFileSync } from "node:child_process";

/**
 * One `gh` call: its stdout, or a throw with its stderr.
 * @typedef {(args: ReadonlyArray<string>) => string} Gh
 */

/** @type {Gh} */
export const realGh = (args) =>
  execFileSync("gh", [...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });

/** The most runs one read looks at. */
export const SCAN = 30;

const REPO = "repos/{owner}/{repo}";

/** @typedef {{ createdAt: number, headSha: string }} Passed */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isMap = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {string} text
 * @param {string} key
 * @returns {Record<string, unknown>[]}
 */
const items = (text, key) => {
  const body = JSON.parse(text);
  const list = isMap(body) ? body[key] : undefined;

  return Array.isArray(list) ? list.filter(isMap) : [];
};

/**
 * @param {Gh} gh
 * @param {string} workflow
 * @param {string} query
 */
const listRuns = (gh, workflow, query) =>
  items(gh(["api", `${REPO}/actions/workflows/${workflow}/runs?${query}&per_page=${SCAN}`]), "workflow_runs").flatMap(
    (run) =>
      typeof run["id"] === "number" && typeof run["created_at"] === "string" && typeof run["head_sha"] === "string"
        ? [{ id: run["id"], createdAt: Date.parse(run["created_at"]), headSha: run["head_sha"] }]
        : [],
  );

/**
 * The job called `name` in a run, or null when that run has no such job.
 * @param {Gh} gh
 * @param {number} id
 * @param {string} name
 */
const findJob = (gh, id, name) => {
  const found = items(gh(["api", `${REPO}/actions/runs/${id}/jobs?per_page=100`]), "jobs").find(
    (job) => job["name"] === name,
  );

  return found === undefined
    ? null
    : {
        startedAt: typeof found["started_at"] === "string" ? Date.parse(found["started_at"]) : null,
        conclusion: typeof found["conclusion"] === "string" ? found["conclusion"] : null,
      };
};

/**
 * The newest run on main of `workflow` whose job `job` concluded `success`, or null.
 * @param {Gh} gh
 * @param {string} workflow
 * @param {string} job
 * @returns {Passed | null}
 */
export const passedRun = (gh, workflow, job) => {
  for (const run of listRuns(gh, workflow, "status=success&branch=main")) {
    if (findJob(gh, run.id, job)?.conclusion === "success") {
      return { createdAt: run.createdAt, headSha: run.headSha };
    }
  }

  return null;
};

/**
 * When the newest run on main of `workflow`, other than run `except`, started its job `job` (ms), or null.
 * @param {Gh} gh
 * @param {string} workflow
 * @param {string} job
 * @param {number | null} except
 * @returns {number | null}
 */
export const startedAt = (gh, workflow, job, except) => {
  for (const run of listRuns(gh, workflow, "branch=main")) {
    const found = run.id === except ? null : findJob(gh, run.id, job);

    if (found !== null && found.conclusion !== "skipped" && found.startedAt !== null) {
      return found.startedAt;
    }
  }

  return null;
};

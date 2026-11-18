import { Predicate, Record as Rec, Result } from "effect";
// Today's CI, serving both versions. ci-speed.yaml's shape (K1 to K7), the daily speed measure.
import { parse } from "yaml";
import { allSteps, compact, isMap, map } from "./shared.ts";

/** The token ci-speed.yaml's one job gets: what its measure reads, and the one issue it writes. */
export const CI_SPEED_TOKEN = { actions: "read", contents: "read", issues: "write", "pull-requests": "read" };

/** ci-speed.yaml's install: the script's own dependencies, with no install scripts. */
const CI_SPEED_INSTALL = "pnpm install --frozen-lockfile --ignore-scripts";

/** The command of ci-speed.yaml's measure step: the script, its issue, and the job summary. */
export const CI_SPEED_RUN =
  'node .agents/skills/lead/scripts/ci-speed.ts --issue --repo "$GITHUB_REPOSITORY" | tee -a "$GITHUB_STEP_SUMMARY"';

/**
 * ci-speed.yaml, the daily measure (experiment 293). K1: it starts once a day and by hand, nothing
 * else. K2: one job, main's copy alone, with a time limit. K3: the workflow's token grants nothing
 * and the job's grants CI_SPEED_TOKEN, so the issue write lives on that job only. K4: its checkout
 * keeps no token. K5: the measure step runs CI_SPEED_RUN with the job's token, under pipefail. K6:
 * no step cancels the run: check.yaml's stop step frees the other jobs' runners, and one job has
 * none to free, so its token keeps actions: read. K7 (0541): its steps are the checkout, the pnpm
 * setup, its install and the measure alone, so it runs no test. lintIssues holds that this job and
 * scheduled.yaml's report are the two that may touch issues.
 */
export const lintCiSpeed = (text: string): string[] => {
  const errors: string[] = [];

  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`ci-speed.yaml: ${reason}`);
    }
  };

  const parsed = Result.try(() => map(parse(text)));

  if (Result.isFailure(parsed)) {
    return ["ci-speed.yaml: not valid YAML"];
  }

  const workflow = parsed.success;

  const on = map(workflow["on"]);
  const crons = Array.isArray(on["schedule"]) ? on["schedule"].filter(isMap) : [];
  require(JSON.stringify(Rec.keys(on).toSorted()) === JSON.stringify(["schedule", "workflow_dispatch"]) &&
    crons.length === 1 &&
    /^\d+ \d+ \* \* \*$/.test(
      String(crons[0]?.["cron"]),
    ), "K1: it runs on one daily schedule and by hand, nothing else");

  const jobs = Rec.values(map(workflow["jobs"]));
  const job = map(jobs[0]);
  require(jobs.length === 1, "K2: it has one job");
  require(compact(job["if"]) === "github.ref=='refs/heads/main'", "K2: the job runs main's copy only");
  const limit = job["timeout-minutes"];
  require(Predicate.isNumber(limit) && limit > 0 && limit <= 30, "K2: the job sets timeout-minutes, at most 30");

  require(JSON.stringify(workflow["permissions"]) === "{}", "K3: the workflow's token grants nothing");
  require(JSON.stringify(job["permissions"]) ===
    JSON.stringify(
      CI_SPEED_TOKEN,
    ), "K3: the job's token reads actions, contents and pull requests and writes issues, nothing more");

  const list = allSteps(job);
  const checkouts = list.filter((s) => Predicate.isString(s["uses"]) && s["uses"].startsWith("actions/checkout@"));
  require(checkouts.length > 0 &&
    checkouts.every(
      (s) => map(s["with"])["persist-credentials"] === false,
    ), "K4: its checkout sets persist-credentials: false");

  const measure = list.find((s) => s["name"] === "measure");
  require(measure?.["run"] === CI_SPEED_RUN &&
    measure["shell"] === "bash" &&
    JSON.stringify(measure["env"]) ===
      JSON.stringify({
        GH_TOKEN: `\${{ github.token }}`,
      }), "K5: the measure step runs ci-speed.ts --issue into the job summary, with the job's token, under bash");

  const cancels = list.filter((s) => Predicate.isString(s["run"]) && s["run"].includes("run cancel"));
  require(cancels.length === 0, "K6: no step cancels the run: one job has nothing to cancel");

  // K7 (0541): it reads runs and writes its summary and its one issue, so its steps are the
  // checkout, the pnpm setup, the install and the measure, and no other: no test, no other action.
  // A cancel step is K6's alone, and the measure step's command K5's, so here it is only its name.
  const work = list
    .filter((s) => !cancels.includes(s))
    .map((s) => {
      if (s === measure) {
        return "measure";
      }

      return Predicate.isString(s["run"]) ? s["run"] : String(s["uses"]).replace(/@.*$/, "@");
    });

  require(JSON.stringify(work) ===
    JSON.stringify([
      "actions/checkout@",
      "./.github/actions/pnpm",
      CI_SPEED_INSTALL,
      "measure",
    ]), "K7: its steps are the checkout, the pnpm setup, its install and the measure, nothing else");

  return errors;
};

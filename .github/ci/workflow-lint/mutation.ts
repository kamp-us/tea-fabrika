// Today's CI, serving both versions. The hourly mutation run starts itself, and its heartbeat
// watches the outcome: mutation.yaml's triggers and its one-at-a-time rule, and
// mutation-heartbeat.yaml's triggers, grants and settings (heartbeat.ts holds the alarm's own laws).
import { Predicate, Result } from "effect";
import { parse } from "yaml";
import { allSteps, isMap, map } from "./shared.ts";

const read = (text: string) => Result.try(() => map(parse(text)));

const sameKeys = (value: unknown, keys: readonly string[]) =>
  isMap(value) && JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify(keys.toSorted());

/** A trigger map that starts on a push to main alone (the branch list is exactly `main`), a cron and by hand. */
const startsLike = (on: Record<string, unknown>) =>
  sameKeys(on, ["push", "schedule", "workflow_dispatch"]) &&
  JSON.stringify(map(on["push"])["branches"]) === JSON.stringify(["main"]) &&
  Array.isArray(on["schedule"]) &&
  on["schedule"].length === 1;

/** `concurrency` holds one run at a time and cuts none short. */
const oneAtATime = (workflow: Record<string, unknown>, group: string) => {
  const concurrency = map(workflow["concurrency"]);

  return concurrency["group"] === group && concurrency["cancel-in-progress"] === false;
};

const touchesIssues = (grant: unknown) => grant === "write-all" || (isMap(grant) && "issues" in grant);

/**
 * The laws on the hourly mutation run and its heartbeat. Each message starts with its workflow's
 * file name and a law's number, MU1 to MU8.
 */
export const lintMutation = (runText: string, heartbeatText: string): string[] => {
  const errors: string[] = [];
  const run = read(runText);
  const beat = read(heartbeatText);

  if (Result.isFailure(run) || Result.isFailure(beat)) {
    return ["mutation.yaml or mutation-heartbeat.yaml: invalid YAML"];
  }

  const require = (file: string, law: string, holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`${file}: ${law}: ${reason}`);
    }
  };

  const mutation = run.success;
  const dispatch = map(map(mutation["on"])["workflow_dispatch"]);

  require("mutation.yaml", "MU1", startsLike(
    map(mutation["on"]),
  ), "the run starts on a push to main, an hourly cron and by hand, and on nothing else (a pull request or the merge queue never waits on it)");

  require("mutation.yaml", "MU2", oneAtATime(
    mutation,
    "mutation",
  ), "one run at a time in the group `mutation`, and a running one is never cut short");

  require("mutation.yaml", "MU3", map(map(dispatch["inputs"])["base"])["required"] !==
    true, "the base is optional: a push or the cron gives none, and the `range` step reads the last passing run's");

  const watcher = beat.success;
  const job = map(map(watcher["jobs"])["heartbeat"]);

  require("mutation-heartbeat.yaml", "MU4", startsLike(
    map(watcher["on"]),
  ), "the heartbeat starts on every push to main, an hourly cron (GitHub's cron fires only about 3 times a day here) and by hand, and on nothing else");

  require("mutation-heartbeat.yaml", "MU5", !touchesIssues(watcher["permissions"]) &&
    map(job["permissions"])["issues"] === "write" &&
    allSteps(job).some(
      (step) => Predicate.isString(step["run"]) && /heartbeat\.ts --issue\b/.test(step["run"]),
    ), "the issue grant is the job `heartbeat`'s alone, and that job runs heartbeat.ts with --issue");

  require("mutation-heartbeat.yaml", "MU6", oneAtATime(
    watcher,
    "mutation-heartbeat",
  ), "one heartbeat at a time, so two runs never open two issues");

  require("mutation-heartbeat.yaml", "MU7", !JSON.stringify(watcher).includes(
    "ci-scheduled",
  ), "its issue never takes the `ci-scheduled` label, which switches on a sev1");

  require("mutation-heartbeat.yaml", "MU8", "MUTATION_PAUSE" in
    map(job["env"]), "the pause is a setting: the job's `env` names MUTATION_PAUSE");

  return errors;
};

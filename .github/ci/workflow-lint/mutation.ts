// Today's CI, serving both versions. The hourly mutation run starts itself, and its heartbeat
// watches the outcome: mutation.yaml's triggers and its one-at-a-time rule, and
// mutation-heartbeat.yaml's triggers, grants and settings (heartbeat.ts holds the alarm's own laws).
import { Predicate, Result } from "effect";
import { parse } from "yaml";
import { allSteps, isMap, map } from "./shared.ts";

const read = (text: string) => Result.try(() => map(parse(text)));

const sameKeys = (value: unknown, keys: readonly string[]) =>
  isMap(value) && JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify(keys.toSorted());

/** An hourly cron: one minute of the hour and a star for everything else, never every few minutes. */
const HOURLY = /^\d{1,2} \* \* \* \*$/;

/**
 * A trigger map that starts on a push to main alone (the push holds only the branch list, exactly
 * `main`: no tags, no paths-ignore), one hourly cron and by hand.
 */
const startsLike = (on: Record<string, unknown>) =>
  sameKeys(on, ["push", "schedule", "workflow_dispatch"]) &&
  sameKeys(on["push"], ["branches"]) &&
  JSON.stringify(map(on["push"])["branches"]) === JSON.stringify(["main"]) &&
  Array.isArray(on["schedule"]) &&
  on["schedule"].length === 1 &&
  Predicate.isString(map(on["schedule"][0])["cron"]) &&
  HOURLY.test(String(map(on["schedule"][0])["cron"]));

/** The longest each job may run, in minutes: the work job's own limit, and a cheap gate or check's. */
const CAPS = { mutation: 45, gate: 5, heartbeat: 10 } as const;

/** The sane range of each setting a workflow may set, in minutes or files. heartbeat.ts holds `LATE_RANGE`. */
const RANGES = {
  MUTATION_LATE_MINUTES: [105, 24 * 60],
  MUTATION_GAP_MINUTES: [10, 240],
  MUTATION_FAIL_STREAK: [1, 10],
  MUTATION_FAIL_GAP_MINUTES: [10, 240],
  MUTATION_MAX_RELATED: [1, 50],
} as const;

/** The settings a workflow sets, in its top-level `env` or a job's: each a whole number in its range. */
const settingsInRange = (workflow: Record<string, unknown>) => {
  const places = [map(workflow["env"]), ...Object.values(map(workflow["jobs"])).map((job) => map(map(job)["env"]))];

  return places.every((env) =>
    Object.entries(RANGES).every(([name, [least, most]]) => {
      const value = env[name];

      return value === undefined || (/^\d+$/.test(String(value)) && Number(value) >= least && Number(value) <= most);
    }),
  );
};

/** A job runs only on main: its `if` names `refs/heads/main`. */
const onlyMain = (job: Record<string, unknown>) =>
  Predicate.isString(job["if"]) && job["if"].includes("github.ref == 'refs/heads/main'");

const reads = (job: Record<string, unknown>) => map(job["permissions"])["actions"] === "read";

/** A work job starts only when its gate said so. */
const startsOnGate = (job: Record<string, unknown>) =>
  Predicate.isString(job["if"]) && job["if"].includes("needs.gate.outputs.start == 'true'");

/** What a job's step called `id` runs, or an empty string. */
const runOf = (job: Record<string, unknown>, id: string) => {
  const run = allSteps(job).find((step) => step["id"] === id)?.["run"];

  return Predicate.isString(run) ? run : "";
};

/** `concurrency` holds one run at a time and cuts none short. */
const oneAtATime = (workflow: Record<string, unknown>, group: string) => {
  const concurrency = map(workflow["concurrency"]);

  return concurrency["group"] === group && concurrency["cancel-in-progress"] === false;
};

const touchesIssues = (grant: unknown) => grant === "write-all" || (isMap(grant) && "issues" in grant);

/**
 * The laws on the hourly mutation run and its heartbeat. Each message starts with its workflow's
 * file name and a law's number, MU1 to MU12.
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
  const gateJob = map(map(mutation["jobs"])["gate"]);
  const workJob = map(map(mutation["jobs"])["mutation"]);
  const rangeBase = map(map(allSteps(workJob).find((step) => step["id"] === "range"))["env"])["BASE"];

  require("mutation.yaml", "MU1", startsLike(
    map(mutation["on"]),
  ), "the run starts on a push to main, an hourly cron and by hand, and on nothing else (a pull request or the merge queue never waits on it)");

  require("mutation.yaml", "MU2", oneAtATime(
    mutation,
    "mutation",
  ), "one run at a time in the group `mutation`, and a running one is never cut short");

  require("mutation.yaml", "MU3", map(map(dispatch["inputs"])["base"])["required"] !== true &&
    Predicate.isString(rangeBase) &&
    rangeBase.includes("needs.gate.outputs.base") &&
    "base" in
      map(
        gateJob["outputs"],
      ), "the dispatch's base is optional, and the `range` step falls back to the base the gate read (the last passing run's commit)");

  require("mutation.yaml", "MU9", map(mutation["permissions"])["actions"] === "read" &&
    reads(gateJob) &&
    onlyMain(gateJob) &&
    onlyMain(workJob) &&
    startsOnGate(workJob) &&
    JSON.stringify(workJob["needs"]) ===
      JSON.stringify([
        "gate",
      ]), "the run list is readable (`actions: read` on the workflow and the gate), both jobs run only on main, and the work job needs the gate and starts only when it says so");

  require("mutation.yaml", "MU10", Number(workJob["timeout-minutes"]) <= CAPS.mutation &&
    Number(gateJob["timeout-minutes"]) <=
      CAPS.gate, `the work job runs at most ${CAPS.mutation} minutes and the gate ${CAPS.gate}`);

  require("mutation.yaml", "MU11", settingsInRange(
    mutation,
  ), "each setting is a whole number in its range (fail streak 1 to 10, fail gap 10 to 240 minutes, related files 1 to 50)");

  require("mutation.yaml", "MU12", /--workflow mutation\.yaml --job mutation\b/.test(runOf(gateJob, "gate")) &&
    !runOf(gateJob, "gate").includes("--paced") &&
    /scripts\/range\.ts --base "\$base" --head "\$head"/.test(
      runOf(workJob, "range"),
    ), "the gate reads this workflow's job `mutation`, with no gap (concurrency paces it), and the `range` step runs range.ts");

  const watcher = beat.success;
  const job = map(map(watcher["jobs"])["heartbeat"]);
  const beatGate = map(map(watcher["jobs"])["gate"]);

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

  require("mutation-heartbeat.yaml", "MU9", reads(beatGate) &&
    reads(job) &&
    onlyMain(beatGate) &&
    onlyMain(job) &&
    startsOnGate(job) &&
    JSON.stringify(job["needs"]) ===
      JSON.stringify([
        "gate",
      ]), "the run list is readable (`actions: read` on the gate and the check), both jobs run only on main, and the check needs the gate and starts only when it says so");

  require("mutation-heartbeat.yaml", "MU10", Number(job["timeout-minutes"]) <= CAPS.heartbeat &&
    Number(beatGate["timeout-minutes"]) <=
      CAPS.gate, `the check runs at most ${CAPS.heartbeat} minutes and the gate ${CAPS.gate}`);

  require("mutation-heartbeat.yaml", "MU11", settingsInRange(
    watcher,
  ), "each setting is a whole number in its range (limit 105 to 1440 minutes, gap 10 to 240)");

  require("mutation-heartbeat.yaml", "MU12", /--workflow mutation-heartbeat\.yaml --job heartbeat\b/.test(
    runOf(beatGate, "gate"),
  ) &&
    runOf(beatGate, "gate").includes(
      "--paced",
    ), "the gate reads this workflow's job `heartbeat`, paced by a gap (the check installs, so a push may not start one each time)");

  return errors;
};

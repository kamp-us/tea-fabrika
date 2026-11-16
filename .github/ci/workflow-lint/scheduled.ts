// Today's CI, serving both versions. scheduled.yaml's shape (SC1 to SC16).
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import { parse } from "yaml";
import {
  allSteps,
  cancels,
  chromium,
  compact,
  ends,
  legs,
  map,
  nextJob,
  numbered,
  ON_E2E,
  steps,
  TOKEN,
  uses,
  VISUAL_FILES,
} from "./shared.ts";
import { TIME_TABLE, timed } from "./time-tables.ts";

// Today's version is frozen (0525, 0533), so the schedule's vitest call of the tooling tests runs the
// `tooling` project alone: next/ and the three trees of today's tests are projects of their own, and
// a project ignores `--exclude` (vitest.config.ts; merge-line.test.ts holds the tooling project's
// globs). No call in check.yaml runs it (0539).
const TOOLING_PROJECT = "--project tooling";

// The full run (0534, 0581): scheduled.yaml runs all of next/ and every tooling test on main, and a
// red run opens one `ci-scheduled` issue. Half of the organization's 20 runners at most, so pull
// requests keep theirs.
const RUNNERS = 10;
// What the workflow's token may do: read runs (the time tables) and the checkout. Canceling a run takes
// `actions: write`, and a run anything canceled ends `cancelled`, never `failure`.
const READS = { actions: "read", contents: "read" };
export const VERDICT = "report";
// The one job that holds every test leg, next's and tooling's, so one `fail-fast` stops them all
// (SC6). A tooling leg's shard starts TOOLING_LEG, which is how scheduled.mjs's `suiteOf` reads it.
const TESTS_JOB = "tests";
const TOOLING_LEG = "tooling-";
const ON_TOOLING = `startsWith(matrix.shard, '${TOOLING_LEG}')`;
// On every branch: the report job fails unless the run is green, so a red run with no failed job
// still ends `failure`. scheduled.mjs writes the issue on main alone.
// A run whose gate said `false` skips the report too, so it leaves the issue as it was; a gate that
// failed leaves `start` empty, and the report judges that run red (0581).
const REPORT_IF = "always() && needs.gate.outputs.start != 'false'";
const REPORT = "node .github/ci/scheduled.mjs";
// The gate (0581): the first job, which says whether this run starts the tests. A push to main or
// the hourly catch-up starts them only when no full run on main started within the gap, and the
// catch-up only on a head that has had none; a hand start always does.
const GATE_JOB = "gate";
const GATE = "node .github/ci/gate.mjs";
const GATE_STEP = "decide";
const GATE_OUTPUTS = { start: `\${{ steps.${GATE_STEP}.outputs.start }}` };
const TESTS_IF = `needs.${GATE_JOB}.outputs.start == 'true'`;
// The gap (0581, 0069): a setting in the workflow's own env, beside the cron line. 0581's binding
// constraint is an hour at least.
const GAP = "GAP_MINUTES";
const LEAST_GAP = 60;
// The hourly catch-up: a fixed minute of every hour, never minute 0, which GitHub's docs name as
// the busiest ("Events that trigger workflows", schedule).
const HOURLY = /^([1-9]|[1-5][0-9]) \* \* \* \*$/;

const REPORT_ENV = {
  NEEDS: `\${{ toJSON(needs) }}`,
  RESULTS: `\${{ runner.temp }}/results`,
  GITHUB_TOKEN: TOKEN,
};

const RESULTS = '--outputFile.json="$RUNNER_TEMP/results.json"';
const REPORTERS = `--reporter=default --reporter=json --reporter=github-actions ${RESULTS}`;
// Every layer of next/ (0536): the vitest legs run the in-memory and the real-resource projects, and
// the e2e legs the visual one. A project, not a path, picks the files: `next/` as a path would start
// `next-visual` on legs with no Chromium, and a project ignores `--exclude`.
const WHOLE_NEXT = `pnpm exec vitest run --project next --project next-integration --shard "$SHARD" ${REPORTERS}`;
const WHOLE_E2E = `pnpm exec vitest run --project next-visual --shard "\${SHARD#e2e-}" ${REPORTERS}`;
const WHOLE_TOOLING = `pnpm exec vitest run ${TOOLING_PROJECT} --shard "\${SHARD#${TOOLING_LEG}}" --passWithNoTests ${REPORTERS}`;
// The schedule's test depth (pull request 1274): its laws run their full case count.
const DEPTH = "full";
// Each suite's test commands, which carry its time limit on their own steps (SC13). The report reads
// each limit as `LIMIT_<SUITE>` (SC5).
const SUITES = { next: [WHOLE_NEXT, WHOLE_E2E], tooling: [WHOLE_TOOLING] } as const;
// The test job's own limit is a leg's test step limit and this many minutes more. In green runs
// 43765797242, 43734956911 and 43734841211 the steps before a test step took at most 56 s in all
// and the three after it at most 7 s, against their 2 minutes of step limits.
const BACKSTOP = 3;

/**
 * A suite's time limit: the one `timeout-minutes` its test steps in the test job all set, or
 * undefined when one sets none or they differ. A step that runs into it ends `failure`, and so does
 * the run; a job that runs into its own limit ends `cancelled`, and so does the run, whatever fails
 * after it.
 */
const limitOf = (jobs: Record<string, unknown>, suite: keyof typeof SUITES): unknown => {
  const commands: readonly string[] = SUITES[suite];
  const found = steps(map(jobs[TESTS_JOB])).filter((s) => typeof s["run"] === "string" && commands.includes(s["run"]));
  const limits = new Set(found.map((s) => s["timeout-minutes"]));
  return found.length > 0 && limits.size === 1 ? [...limits][0] : undefined;
};

/** The test job's own limit, a backstop past each suite's: a tooling leg's, else a next leg's. */
const backstop = (next: number, tooling: number) =>
  `\${{ ${ON_TOOLING} && ${tooling + BACKSTOP} || ${next + BACKSTOP} }}`;

/** A matrix job's legs, as the workflow lists them: a plain list, never an expression. */
const listed = (job: Record<string, unknown>): unknown[] => {
  const shard = map(map(job["strategy"])["matrix"])["shard"];
  return Array.isArray(shard) ? shard : [];
};

/**
 * A job's step of the `needs` chain: 0 for a job that needs nothing, else one past the deepest job
 * it needs. A job that needs one that is not there, or a loop, counts as 0: GitHub refuses such a
 * workflow, and the other rules name what is wrong.
 */
const depth = (jobs: Record<string, unknown>, name: string, seen: readonly string[] = []): number => {
  const needs = map(jobs[name])["needs"];
  const list = typeof needs === "string" ? [needs] : Array.isArray(needs) ? needs : [];
  const known = list.filter(
    (need): need is string => typeof need === "string" && need in jobs && !seen.includes(need) && need !== name,
  );
  return known.length === 0 ? 0 : 1 + Math.max(...known.map((need) => depth(jobs, need, [...seen, name])));
};

/**
 * scheduled.yaml's shape. `check` is check.yaml's text: the schedule runs next on its full matrix
 * of legs, so the measured split (vitest.shards.ts) and each leg's `/N` hold for both.
 */
export const lintScheduled = (text: string, check: string): string[] => {
  const source = Result.try((): unknown => parse(text));

  if (Result.isFailure(source)) {
    return ["scheduled.yaml: invalid YAML"];
  }

  const workflow = map(source.success),
    on = map(workflow["on"]),
    jobs = map(workflow["jobs"]);
  const errors: string[] = [];
  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`scheduled.yaml: ${reason}`);
    }
  };

  // SC1. A push to main, the hourly catch-up and a hand start, nothing else (0581): no pull request
  // or queue runs the whole suite, and a push to any other branch does not either. The push takes
  // every path, since the gate, not a path filter, decides. The catch-up is hourly at a fixed minute.
  const crons = Array.isArray(on["schedule"]) ? on["schedule"] : [];
  require(JSON.stringify(Rec.keys(on).toSorted()) === JSON.stringify(["push", "schedule", "workflow_dispatch"]) &&
    JSON.stringify(on["push"]) === JSON.stringify({ branches: ["main"] }) &&
    crons.length === 1 &&
    Rec.keys(map(crons[0])).length === 1 &&
    typeof map(crons[0])["cron"] === "string" &&
    HOURLY.test(
      String(map(crons[0])["cron"]),
    ), "SC1: it runs on a push to main, on one hourly schedule at a minute from 1 to 59, and by hand, on no other event");
  // SC16. The gap is the workflow's one env value, a whole number of minutes, an hour at least
  // (0581's binding constraint), so a person changes it in one line beside the cron line.
  const gap = map(workflow["env"])[GAP];
  require(JSON.stringify(Rec.keys(map(workflow["env"]))) === JSON.stringify([GAP]) &&
    typeof gap === "number" &&
    Number.isInteger(gap) &&
    gap >= LEAST_GAP, `SC16: the workflow's env is ${GAP} alone, a whole number of minutes, ${LEAST_GAP} or more`);
  // SC2. One run at a time, and a running one is never cut short.
  const concurrency = map(workflow["concurrency"]);
  require(typeof concurrency["group"] === "string" &&
    !concurrency["group"].includes("${{") &&
    concurrency["cancel-in-progress"] === false, "SC2: one run at a time, in one fixed group, and none cut short");

  // SC3. The token reads runs (the time tables) and the checkout, and no more: `actions: write`
  // is what canceling a run takes. Only the report may write issues, and it may read runs to find
  // the last green one.
  require(JSON.stringify(workflow["permissions"]) ===
    JSON.stringify(READS), "SC3: the workflow's token grants actions: read and contents: read, nothing more");
  require(JSON.stringify(map(jobs[VERDICT])["permissions"]) ===
    JSON.stringify({
      actions: "read",
      contents: "read",
      issues: "write",
    }), "SC3: the report job's token reads actions and contents and writes issues, nothing more");

  for (const [name, job] of Rec.toEntries(jobs).filter(([name]) => name !== VERDICT)) {
    require(!("permissions" in map(job)), `SC3: ${name} keeps the workflow's token, which cannot cancel a run`);
  }

  // SC4. The same rules as check.yaml's F1, F2 and F4, with the report job as the verdict: no step
  // cancels the run (a canceled run ends `cancelled`, never `failure`), no other job runs on
  // `always()`, every job has a time limit, and no checkout keeps the token in .git/config. The test
  // job's limit is an expression by its leg's suite, and SC13 pins it exactly.
  for (const [name, job] of Rec.toEntries(jobs)) {
    const limit = map(job)["timeout-minutes"];
    require((typeof limit === "number" && limit > 0 && limit < 360) ||
      (name === TESTS_JOB && typeof limit === "string"), `SC4: ${name} sets timeout-minutes`);

    for (const step of steps(map(job)).filter((s) => uses(s, "actions/checkout"))) {
      require(map(step["with"])["persist-credentials"] ===
        false, `SC4: ${name}'s checkout sets persist-credentials: false, so the token stays out of .git/config`);
    }

    require(!allSteps(map(job)).some(
      cancels,
    ), `SC4: no step of ${name} cancels the run: a canceled run ends cancelled, never failure`);

    if (name === VERDICT) {
      continue;
    }

    require(!compact(map(job)["if"]).includes(
      "always()",
    ), `SC4: ${name} stops with its run: only the report runs on always()`);
  }

  // SC5. The report judges every other job, after any result, on every branch, with scheduled.mjs,
  // and its failure shows: it is the job that fails for a red run. It skips only a run whose gate
  // said `false`, so a skipped run neither judges nor closes the issue, and a gate that failed is
  // judged red. It, the gate's step and the time tables are the steps that get the token.
  const report = map(jobs[VERDICT]),
    others = Rec.keys(jobs).filter((name) => name !== VERDICT);
  const needed = Array.isArray(report["needs"]) ? report["needs"] : [];
  require(needed.length === others.length &&
    others.every((name) => needed.includes(name)) &&
    compact(report["if"]) ===
      compact(
        REPORT_IF,
      ), "SC5: the report needs every other job, and runs after any result, on every branch, unless the gate said false");
  const judged = steps(report).filter((s) => "run" in s);
  // Each suite's limit, as `LIMIT_<SUITE>`, equal to its test steps' `timeout-minutes` (SC13):
  // scheduled.mjs tells a timed-out leg from a red or a canceled one by it, and reads a leg's suite
  // from its name's shard, so no job sets a `name` of its own.
  const env = {
    ...REPORT_ENV,
    ...Rec.fromEntries(
      (Rec.keys(SUITES) as (keyof typeof SUITES)[]).map((suite) => [
        `LIMIT_${suite.toUpperCase()}`,
        limitOf(jobs, suite),
      ]),
    ),
  };
  require(Rec.values(jobs).every(
    (job) => !("name" in map(job)),
  ), "SC5: no job sets a name, so a leg's name is its job's id and its shard");
  require(judged.length === 1 &&
    judged[0]?.["run"] === REPORT &&
    JSON.stringify(judged[0]?.["env"]) === JSON.stringify(env) &&
    !("if" in (judged[0] ?? {})) &&
    judged[0]?.["continue-on-error"] ===
      undefined, `SC5: the report runs ${REPORT} once, with the needs, the results, the token and each suite's time limit, and its failure shows`);
  // The legs' time tables read their own job's steps with it too (TT1 pins their env), and the
  // gate's step reads the run list (SC14 pins its env).
  const gateJob = map(jobs[GATE_JOB]);
  const gateRuns = steps(gateJob).filter((s) => "run" in s);
  require(Rec.values(jobs).every((job) =>
    steps(map(job)).every(
      (s) =>
        s === judged[0] ||
        s["run"] === TIME_TABLE ||
        (gateRuns.length === 1 && s === gateRuns[0]) ||
        !/github\.token|secrets\./.test(JSON.stringify(s)),
    ),
  ), "SC5: only the report step, the gate's step and the time tables get the token, and no step a secret");

  // SC14. The gate is the first job: it needs nothing and runs on every run, its one command is
  // gate.mjs, with the token alone, in a step whose `start` is the job's one output, after a
  // checkout of .github/ci alone, as the report's.
  const gateCheckouts = steps(gateJob).filter((s) => uses(s, "actions/checkout"));
  require(GATE_JOB in jobs &&
    !("needs" in gateJob) &&
    !("if" in gateJob) &&
    gateRuns.length === 1 &&
    gateRuns[0]?.["id"] === GATE_STEP &&
    gateRuns[0]?.["run"] === GATE &&
    JSON.stringify(gateRuns[0]?.["env"]) === JSON.stringify({ GITHUB_TOKEN: TOKEN }) &&
    JSON.stringify(gateJob["outputs"]) === JSON.stringify(GATE_OUTPUTS) &&
    gateCheckouts.length === 1 &&
    map(gateCheckouts[0]?.["with"])["sparse-checkout"] ===
      ".github/ci", `SC14: the ${GATE_JOB} job needs nothing, runs ${GATE} once with the token alone, and gives its start as its one output`);
  // Every way the gate ends with no `start` ends its job `failure`, so the report judges the run
  // red: each of its steps has a whole time limit of its own, which ends that step `failure`, and
  // the job's own limit is a backstop past their sum, since a job that hits its own limit ends
  // `cancelled`, which the report reads as a run a person stopped (the review of pull request 1404).
  // No `continue-on-error` on the job or a step, which would turn a failed read into a success with
  // an empty `start`, and no `if` on a step, since a skipped step ends the job `success` with no
  // `start` too (the recheck of pull request 1404).
  const gateLimits = steps(gateJob).map((s) => s["timeout-minutes"]);
  const gateLimit = gateJob["timeout-minutes"];
  require(gateLimits.length > 0 &&
    gateLimits.every((limit) => typeof limit === "number" && Number.isInteger(limit) && limit > 0) &&
    typeof gateLimit === "number" &&
    (gateLimits as number[]).reduce((sum, limit) => sum + limit, 0) < gateLimit &&
    !("continue-on-error" in gateJob) &&
    steps(gateJob).every(
      (s) => !("if" in s) && !("continue-on-error" in s),
    ), `SC14: every step of the ${GATE_JOB} job runs on every run, with a whole timeout-minutes of its own inside the job's, and neither the job nor a step continues on error, so a gate that gives no start fails`);

  // SC15. The tests run only when the gate said `true`: a gate that said `false` or failed starts
  // none.
  const testsJob = map(jobs[TESTS_JOB]);
  require(JSON.stringify(testsJob["needs"]) === JSON.stringify([GATE_JOB]) &&
    compact(testsJob["if"]) ===
      compact(TESTS_IF), `SC15: ${TESTS_JOB} needs the ${GATE_JOB} and runs only when it said start=true`);

  // SC6. Every test leg is in one matrix, the test job, and the gate and the report are the only
  // other jobs: GitHub's fail-fast stops only the legs of the red leg's own matrix (probe run
  // 43778347612), so a second matrix would run on to its end after a red leg, as the stop step never
  // let it. At most RUNNERS machines at once: jobs run together only at the same step of the `needs`
  // chain, so each step counts its jobs, a matrix its `max-parallel` and any other job one. The
  // matrix sets it, runs no more at once than it has legs, and stops its other legs once one failed,
  // which leaves the run's conclusion `failure`.
  require(JSON.stringify(others.toSorted()) === JSON.stringify([GATE_JOB, TESTS_JOB].toSorted()) &&
    Rec.toEntries(jobs).every(
      ([name, job]) => name === TESTS_JOB || !("strategy" in map(job)),
    ), `SC6: every test leg is in one matrix, the ${TESTS_JOB} job, so its first red leg stops all the others`);
  const atOnce = new Map<number, number>();

  for (const [name, job] of Rec.toEntries(jobs).map(([name, job]) => [name, map(job)] as const)) {
    const strategy = map(job["strategy"]);
    const most = strategy["max-parallel"];

    if ("strategy" in job) {
      require(typeof most === "number" &&
        Number.isInteger(most) &&
        most >= 1 &&
        most <= listed(job).length &&
        strategy["fail-fast"] ===
          true, `SC6: ${name} sets max-parallel to at most its legs, and its first red leg stops the others`);
    }

    const at = depth(jobs, name);
    atOnce.set(at, (atOnce.get(at) ?? 0) + ("strategy" in job && typeof most === "number" ? most : 1));
  }

  require([...atOnce.values()].every(
    (machines) => machines <= RUNNERS,
  ), `SC6: its jobs take at most ${RUNNERS} machines at once, half of the 20 runners`);

  // SC7. All of next/ on check.yaml's full matrix, each leg's `/N` its kind's count, nothing
  // narrowed. A `--changed`, a `$FILTER` or a list would make it the merge line's selection again.
  // The test job lists check.yaml's legs first, then the tooling legs (SC8).
  const tests = map(jobs[TESTS_JOB]),
    testSteps = steps(tests),
    shards = listed(tests),
    toolingLegs = shards.filter((shard) => typeof shard === "string" && shard.startsWith(TOOLING_LEG)),
    nextLegs = shards.filter((shard) => !toolingLegs.includes(shard)),
    legsOfCheck = legs(nextJob(check)),
    e2eCount = ends(legsOfCheck).length,
    vitestCount = numbered(legsOfCheck).length;
  require(legsOfCheck.length > 0 &&
    JSON.stringify(shards.slice(0, nextLegs.length)) === JSON.stringify(nextLegs) &&
    JSON.stringify(nextLegs) ===
      JSON.stringify(legsOfCheck), "SC7: the test job's next legs are check.yaml's full matrix of next legs, first");
  const vitest = testSteps.filter((s) => s["run"] === WHOLE_NEXT);
  const e2e = testSteps.filter((s) => s["run"] === WHOLE_E2E);
  require(vitest.length === 1 &&
    compact(vitest[0]?.["if"]) === compact(`!${ON_E2E} && !${ON_TOOLING}`) &&
    map(vitest[0]?.["env"])["SHARD"] ===
      `\${{ matrix.shard }}/${vitestCount}`, "SC7: next runs vitest over the next and next-integration projects once, on the numbered legs, each its share of them");
  require(e2e.length === 1 &&
    compact(e2e[0]?.["if"]) === ON_E2E &&
    map(e2e[0]?.["env"])["SHARD"] ===
      `\${{ matrix.shard }}/${e2eCount}`, "SC7: next runs every visual file once, on the e2e legs, each its share of them");
  require(testSteps.some(
    (s) => s["run"] === chromium && compact(s["if"]) === compact(`${ON_E2E} && ${VISUAL_FILES}`),
  ), "SC7: next fetches chromium on the e2e legs, once a visual file exists");

  // SC8. Every tooling test on the tooling legs, `tooling-1` to `tooling-N` after the next legs,
  // nothing narrowed.
  const toolingRuns = testSteps.filter((s) => s["run"] === WHOLE_TOOLING);
  require(toolingRuns.length === 1 &&
    compact(toolingRuns[0]?.["if"]) === ON_TOOLING &&
    map(toolingRuns[0]?.["env"])["SHARD"] === `\${{ matrix.shard }}/${toolingLegs.length}` &&
    toolingLegs.length > 0 &&
    JSON.stringify(shards.slice(nextLegs.length)) ===
      JSON.stringify(
        Array.from({ length: toolingLegs.length }, (_, i) => `${TOOLING_LEG}${i + 1}`),
      ), "SC8: the tooling legs run every tooling test once, legs tooling-1 to tooling-N, each its share of them");

  // SC9. The commands are only these: no step runs another test command or narrows one.
  const commandsOf = (job: Record<string, unknown>) =>
    steps(job).flatMap((s) => (typeof s["run"] === "string" ? [s["run"]] : []));
  require(JSON.stringify(commandsOf(tests).toSorted()) ===
    JSON.stringify(
      ["pnpm install --frozen-lockfile", WHOLE_NEXT, chromium, WHOLE_E2E, WHOLE_TOOLING, TIME_TABLE].toSorted(),
    ), "SC9: the test job runs only its install, its whole-suite commands and its time table");

  // SC10. The test job keeps each leg's Vitest report after a red step, so the report job can name
  // the failing tests.
  const kept = testSteps.filter(
    (s) => uses(s, "actions/upload-artifact") && map(s["with"])["path"] === `\${{ runner.temp }}/results.json`,
  );
  const last = testSteps.findLastIndex((s) => typeof s["run"] === "string" && s["run"].includes(RESULTS));
  require(kept.length === 1 &&
    compact(kept[0]?.["if"]) === "!cancelled()" &&
    testSteps.indexOf(kept[0] ?? {}) >
      last, `SC10: ${TESTS_JOB} uploads its report after its tests, even after a red one`);
  // TT1 and TT2, as in check.yaml.
  errors.push(...timed(TESTS_JOB, tests, "results.json").map((reason) => `scheduled.yaml: ${reason}`));

  // SC11. Every test leg runs at full depth: a law that reads FABRIKA_TEST_DEPTH runs its full case
  // count here, and unset means `fast`, as on the merge line (pull request 1274).
  for (const command of [WHOLE_NEXT, WHOLE_E2E, WHOLE_TOOLING]) {
    const found = Rec.values(jobs).flatMap((job) => steps(map(job)).filter((s) => s["run"] === command));
    require(found.length > 0 &&
      found.every(
        (s) => map(s["env"])["FABRIKA_TEST_DEPTH"] === DEPTH,
      ), `SC11: every step that runs ${command.split(" --shard")[0]} sets FABRIKA_TEST_DEPTH: ${DEPTH}`);
  }

  // SC12. SC2's one group holds main's schedule and every hand-started run, so a waiting run is
  // never replaced: GitHub's default queue keeps one waiting and cancels it when a newer run queues.
  require(map(workflow["concurrency"])["queue"] === "max", "SC12: a newer run never cancels a waiting one: queue: max");

  // SC13. The time limit sits on each test step, and the job's own is a backstop BACKSTOP minutes
  // past its leg's suite's. A step that runs into its limit ends `failure`, and so does the run; a
  // job that runs into its own ends `cancelled`, and so does the run, even when the report fails
  // after it (probe runs 43778586135 and 43778355238 on a throwaway copy of this workflow). The
  // job's limit may read `matrix` (GitHub's docs, "Contexts reference").
  const whole = (limit: unknown): limit is number =>
    typeof limit === "number" && Number.isInteger(limit) && limit > 0 && limit + BACKSTOP < 360;
  const nextLimit = limitOf(jobs, "next"),
    toolingLimit = limitOf(jobs, "tooling");

  for (const [suite, limit] of [
    ["next", nextLimit],
    ["tooling", toolingLimit],
  ] as const) {
    require(whole(limit), `SC13: ${suite}'s test steps share one whole timeout-minutes`);
  }

  require(whole(nextLimit) &&
    whole(toolingLimit) &&
    compact(tests["timeout-minutes"]) ===
      compact(
        backstop(nextLimit, toolingLimit),
      ), `SC13: ${TESTS_JOB}'s own timeout-minutes is each leg's suite limit and ${BACKSTOP} minutes more`);

  return errors;
};

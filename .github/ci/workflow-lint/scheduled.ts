// Today's CI, serving both versions. scheduled.yaml's shape (SC1 to SC13).
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

// The schedule (0534): scheduled.yaml runs all of next/ and every tooling test on main, and a red run
// opens one `ci-scheduled` issue. Half of the organization's 20 runners at most, so pull requests
// keep theirs.
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
const REPORT_IF = "always()";
const REPORT = "node .github/ci/scheduled.mjs";

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
 * scheduled.yaml's shape. `check` is check.yaml's text: the schedule runs next on its full matrix
 * of legs, so the measured split (vitest.shards.ts) and each leg's `/N` hold for both.
 */
export const lintScheduled = (text: string, check: string): string[] => {
  let source: unknown;

  try {
    source = parse(text);
  } catch {
    return ["scheduled.yaml: invalid YAML"];
  }

  const workflow = map(source),
    on = map(workflow["on"]),
    jobs = map(workflow["jobs"]);
  const errors: string[] = [];
  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`scheduled.yaml: ${reason}`);
    }
  };

  // SC1. A schedule and a hand start, nothing else: no pull request, queue or push runs the whole
  // suite (0534's binding constraint). The cron line is the interval, a setting.
  const crons = Array.isArray(on["schedule"]) ? on["schedule"] : [];
  require(JSON.stringify(Object.keys(on).toSorted()) === JSON.stringify(["schedule", "workflow_dispatch"]) &&
    crons.length === 1 &&
    typeof map(crons[0])["cron"] === "string", "SC1: it runs on one schedule and by hand, on no other event");
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

  for (const [name, job] of Object.entries(jobs).filter(([name]) => name !== VERDICT)) {
    require(!("permissions" in map(job)), `SC3: ${name} keeps the workflow's token, which cannot cancel a run`);
  }

  // SC4. The same rules as check.yaml's F1, F2 and F4, with the report job as the verdict: no step
  // cancels the run (a canceled run ends `cancelled`, never `failure`), no other job runs on
  // `always()`, every job has a time limit, and no checkout keeps the token in .git/config. The test
  // job's limit is an expression by its leg's suite, and SC13 pins it exactly.
  for (const [name, job] of Object.entries(jobs)) {
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
  // and its failure shows: it is the job that fails for a red run. It and the time tables are the
  // steps that get the token.
  const report = map(jobs[VERDICT]),
    others = Object.keys(jobs).filter((name) => name !== VERDICT);
  const needed = Array.isArray(report["needs"]) ? report["needs"] : [];
  require(needed.length === others.length &&
    others.every((name) => needed.includes(name)) &&
    compact(report["if"]) ===
      REPORT_IF, "SC5: the report needs every other job, and runs after any result, on every branch");
  const judged = steps(report).filter((s) => "run" in s);
  // Each suite's limit, as `LIMIT_<SUITE>`, equal to its test steps' `timeout-minutes` (SC13):
  // scheduled.mjs tells a timed-out leg from a red or a canceled one by it, and reads a leg's suite
  // from its name's shard, so no job sets a `name` of its own.
  const env = {
    ...REPORT_ENV,
    ...Object.fromEntries(
      (Object.keys(SUITES) as (keyof typeof SUITES)[]).map((suite) => [
        `LIMIT_${suite.toUpperCase()}`,
        limitOf(jobs, suite),
      ]),
    ),
  };
  require(Object.values(jobs).every(
    (job) => !("name" in map(job)),
  ), "SC5: no job sets a name, so a leg's name is its job's id and its shard");
  require(judged.length === 1 &&
    judged[0]?.["run"] === REPORT &&
    JSON.stringify(judged[0]?.["env"]) === JSON.stringify(env) &&
    !("if" in (judged[0] ?? {})) &&
    judged[0]?.["continue-on-error"] ===
      undefined, `SC5: the report runs ${REPORT} once, with the needs, the results, the token and each suite's time limit, and its failure shows`);
  // The legs' time tables read their own job's steps with it too (TT1 pins their env).
  require(Object.values(jobs).every((job) =>
    steps(map(job)).every(
      (s) => s === judged[0] || s["run"] === TIME_TABLE || !/github\.token|secrets\./.test(JSON.stringify(s)),
    ),
  ), "SC5: only the report step and the time tables get the token, and no step a secret");

  // SC6. Every test leg is in one matrix, the test job, and the report is the only other job: GitHub's
  // fail-fast stops only the legs of the red leg's own matrix (probe run 43778347612), so a second
  // matrix would run on to its end after a red leg, as the stop step never let it. At most RUNNERS
  // machines: the matrix counts its `max-parallel`, the report one. The matrix sets it, runs no
  // more at once than it has legs, and stops its other legs once one failed, which leaves the run's
  // conclusion `failure`.
  require(JSON.stringify(others) === JSON.stringify([TESTS_JOB]) &&
    Object.entries(jobs).every(
      ([name, job]) => name === TESTS_JOB || !("strategy" in map(job)),
    ), `SC6: every test leg is in one matrix, the ${TESTS_JOB} job, so its first red leg stops all the others`);
  let machines = 0;

  for (const [name, job] of Object.entries(jobs).map(([name, job]) => [name, map(job)] as const)) {
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

    machines += "strategy" in job && typeof most === "number" ? most : 1;
  }

  require(machines <= RUNNERS, `SC6: its jobs take at most ${RUNNERS} machines at once, half of the 20 runners`);

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
    const found = Object.values(jobs).flatMap((job) => steps(map(job)).filter((s) => s["run"] === command));
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

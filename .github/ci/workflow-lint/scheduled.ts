// Today's CI, serving both versions. scheduled.yaml's shape (SC1 to SC20).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Predicate, Record as Rec, Result, Schema } from "effect";
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
  type Require,
  steps,
  TOKEN,
  uses,
  VISUAL_FILES,
} from "./shared.ts";
import { TIME_TABLE, timed } from "./time-tables.ts";

// The full run (0534, 0581): scheduled.yaml runs all of next/ and every tooling test on main, and a
// red run opens one `ci-scheduled` issue. Half of the organization's 20 runners at most, so pull
// requests keep theirs (0595). The ten jobs are MAIN_SLOTS groups for main's full run, PROOF_SLOTS for
// branch proofs and one control group (0598); the merge line, check.yaml, holds none.
const BUDGET = 10;

const CONTROL_GROUP = "scheduled-control";

const MAIN_GROUP = "scheduled-main-";

const PROOF_GROUP = "scheduled-proof-";

// 0595's names, which no group of this workflow holds any more.
const OLD_GROUP = "scheduled-test-";

// The two counts (0069): how many groups main's full run takes and how many a branch proof takes.
// GitHub allows no `env` in `strategy` or a job's `concurrency`, so the copies are held equal here.
const MAIN_SLOTS = "MAIN_SLOTS";

const PROOF_SLOTS = "PROOF_SLOTS";

const ON_MAIN = "github.ref == 'refs/heads/main'";

/** A count: a whole number of 1 or more, written as a number, never as text. */
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;

const decodePins = Schema.decodeResult(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite]))),
);

type Pins = Readonly<Record<string, string>>;

/** The expression with every space outside a quoted string gone: spacing never changes its meaning. */
const squash = (value: string) => value.replace(/'(?:[^']|'')*'|\s+/g, (match) => (match.startsWith("'") ? match : ""));

const pinsFrom = (text: string | undefined): Pins | undefined => {
  const decoded = Result.getOrUndefined(decodePins(text ?? ""));

  return decoded === undefined
    ? undefined
    : Object.fromEntries(Object.entries(decoded).map(([leg, group]) => [leg, String(group)]));
};

/**
 * The two closed maps of `tests`'s group, each leg's number in its group, one for main and one for a
 * branch proof; or none. Only the exact ref-conditional form reads: the prefix chosen by the ref, and
 * the same condition choosing the map.
 */
const pinsOf = (group: unknown): { readonly main: Pins; readonly proof: Pins } | undefined => {
  const match =
    typeof group === "string"
      ? /^\$\{\{github\.ref=='refs\/heads\/main'&&'scheduled-main-'\|\|'scheduled-proof-'\}\}\$\{\{fromJSON\(github\.ref=='refs\/heads\/main'&&'([^']*)'\|\|'([^']*)'\)\[matrix\.shard\]\}\}$/i.exec(
          squash(group),
        )
      : null;

  const main = pinsFrom(match?.[1]);
  const proof = pinsFrom(match?.[2]);

  return main === undefined || proof === undefined ? undefined : { main, proof };
};

/** Only a closed identity lookup over the proof groups may turn a selected leg's group into a name. */
const rotationOf = (value: unknown): Pins | undefined => {
  const match =
    typeof value === "string"
      ? /^scheduled-proof-\$\{\{\s*fromJSON\('([^']*)'\)\[fromJSON\(needs\.select\.outputs\.slots\)\[matrix\.shard\]\]\s*\|\|\s*'1'\s*\}\}$/i.exec(
          value,
        )
      : null;

  return pinsFrom(match?.[1]);
};

/** The numbers 1 to `most`, as text. */
const upTo = (most: number | undefined) =>
  most === undefined ? [] : Array.from({ length: most }, (_, index) => String(index + 1));

/** Every pin of `legs`, and the groups they reach exactly 1 to `most`. */
const covers = (pins: Pins | undefined, shards: readonly unknown[], most: number | undefined) =>
  pins !== undefined &&
  most !== undefined &&
  Object.keys(pins).length === shards.length &&
  shards.every((shard) => typeof shard === "string" && Object.hasOwn(pins, shard)) &&
  JSON.stringify(upTo(most)) ===
    JSON.stringify([...new Set(Object.values(pins))].toSorted((a, b) => Number(a) - Number(b)));

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

const STARTED = `needs.${GATE_JOB}.outputs.start == 'true'`;

// A branch's proof run (0590): `select` runs proof.ts on a hand start on a branch other than main
// alone, so main's push, catch-up and hand start run the full set on `tests` (SC15, SC17). It says
// `full` or `changed`, and a changed set runs on `changed`'s legs, each its own list (SC18).
const SELECT_JOB = "select";

const SELECT = "node .github/ci/proof.ts";

const SELECT_STEP = "set";

const SELECT_IF = `${STARTED} && github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'`;

const SELECT_OUTPUTS = Object.fromEntries(
  ["scope", "legs", "files"].map((key) => [key, `\${{ steps.${SELECT_STEP}.outputs.${key} }}`]),
);

const SLOT_OUTPUT = `\${{ steps.${SELECT_STEP}.outputs.slots }}`;

const RUN_NUMBER = `\${{ github.run_number }}`;

const RECORD = `\${{ runner.temp }}/proof-set.json`;

// `tests` runs after a skipped `select`, on main, or after one that said `full`.
const TESTS_IF = `\${{ !cancelled() && ${STARTED} && (needs.${SELECT_JOB}.result == 'skipped' || needs.${SELECT_JOB}.outputs.scope == 'full') }}`;

const CHANGED_JOB = "changed";

const CHANGED_IF = `${STARTED} && needs.${SELECT_JOB}.outputs.scope == 'changed' && needs.${SELECT_JOB}.outputs.legs != '[]'`;

const CHANGED_LEGS = `\${{ fromJSON(needs.${SELECT_JOB}.outputs.legs) }}`;

const LEG_FILES = `fromJSON(needs.${SELECT_JOB}.outputs.files)[matrix.shard]`;

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

const REPORTERS = `--reporter=default --reporter=json --reporter=github-actions --reporter=./.github/ci/progress-reporter.ts ${RESULTS}`;

// Every layer of next/ (0536): the vitest legs run the in-memory and the real-resource projects, and
// the e2e legs the visual one. A project, not a path, picks the files: `next/` as a path would start
// `next-visual` on legs with no Chromium, and a project ignores `--exclude`. The vitest legs read
// their projects from the ref (NEXT_PROJECTS): main's full run never drops a real-resource law, and
// a branch's full set, a proof run, starts none (0602).
const WHOLE_NEXT = `pnpm exec vitest run $PROJECTS --shard "$SHARD" ${REPORTERS}`;

const NEXT_PROJECTS = `\${{ ${ON_MAIN} && '--project next --project next-integration' || '--project next' }}`;

const WHOLE_E2E = `pnpm exec vitest run --project next-visual --shard "\${SHARD#e2e-}" ${REPORTERS}`;

// Today's version is frozen (0525, 0533), so the schedule's vitest call of the tooling tests runs the
// tooling projects alone: next/ and the three trees of today's tests are projects of their own, and
// a project ignores `--exclude` (vitest.config.ts; merge-line.test.ts holds the tooling projects'
// globs). The tooling legs read their projects from the ref (TOOLING_PROJECTS), as the vitest legs
// do: main's full run runs `tooling` and `tooling-integration`, the tooling laws that start a
// process (0584), and a branch's full set, a proof run, runs `tooling` alone (0602).
const WHOLE_TOOLING = `pnpm exec vitest run $PROJECTS --shard "\${SHARD#${TOOLING_LEG}}" --passWithNoTests ${REPORTERS}`;

const TOOLING_PROJECTS = `\${{ ${ON_MAIN} && '--project tooling --project tooling-integration' || '--project tooling' }}`;

// A changed leg's one command: its own list, `$FILES` from `select`, over every project proof.ts
// lists: today's left out (0533), and `next-integration`, which only main's full run runs (0602). No
// `--changed` and no `--shard`: the list is the leg.
const CHANGED_RUN = `pnpm exec vitest run --project next --project next-visual --project tooling $FILES ${REPORTERS}`;

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
  const found = steps(map(jobs[TESTS_JOB])).filter((s) => Predicate.isString(s["run"]) && commands.includes(s["run"]));
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

/** The shared scheduled job budget, independent of the workflow admission queue. */
const jobSlots = (workflow: Record<string, unknown>, require: Require): void => {
  const jobs = map(workflow["jobs"]);
  const concurrency = map(workflow["concurrency"]);

  const selectRuns = steps(map(jobs[SELECT_JOB])).filter(
    (s) => "run" in s && s["run"] !== "pnpm install --frozen-lockfile",
  );

  const selectEnv = map(selectRuns[0]?.["env"]);

  const names = [GATE_JOB, SELECT_JOB, VERDICT, TESTS_JOB, CHANGED_JOB];
  require(Object.keys(jobs).length === names.length &&
    names.every((name) =>
      Object.hasOwn(jobs, name),
    ), "SC19: every admitted job is one of the five jobs with shared slots");

  // SC16, the counts. Two settings, whole numbers of 1 or more, that with the control group make the
  // budget (0598); the workflow's env holds them beside the gap.
  const settings = map(workflow["env"]);
  const main = count(settings[MAIN_SLOTS]);
  const proof = count(settings[PROOF_SLOTS]);
  require(main !== undefined &&
    proof !==
      undefined, `SC16: ${MAIN_SLOTS} and ${PROOF_SLOTS} are each a whole number of 1 or more, written as a number`);

  // SC19. The two counts and the control group are the whole budget (0595, 0598).
  require(main !== undefined &&
    proof !== undefined &&
    main + proof + 1 ===
      BUDGET, `SC19: ${MAIN_SLOTS} and ${PROOF_SLOTS} with the one control group add up to the budget of ${BUDGET} jobs`);

  // Fixed job groups reserve main's groups, the branch proofs' groups and one control group
  // across participating scheduled workflows, even when their refs have separate workflow queues.
  const pins = pinsOf(map(map(jobs[TESTS_JOB])["concurrency"])["group"]);
  const fullShards = listed(map(jobs[TESTS_JOB]));
  const fullMatrix = map(map(map(jobs[TESTS_JOB])["strategy"])["matrix"]);
  const changedStrategy = map(map(jobs[CHANGED_JOB])["strategy"]);
  const changedMatrix = map(changedStrategy["matrix"]);
  const rotation = rotationOf(map(map(jobs[CHANGED_JOB])["concurrency"])["group"]);

  const rotated =
    proof !== undefined &&
    rotation !== undefined &&
    Object.keys(rotation).length === proof &&
    upTo(proof).every((slot) => Object.hasOwn(rotation, slot) && rotation[slot] === slot) &&
    selectRuns.length === 1 &&
    selectRuns[0]?.["id"] === SELECT_STEP &&
    selectRuns[0]?.["run"] === SELECT &&
    selectEnv["RUN_NUMBER"] === RUN_NUMBER &&
    map(map(jobs[SELECT_JOB])["outputs"])["slots"] === SLOT_OUTPUT;

  const fullGroup =
    Object.keys(fullMatrix).length === 1 &&
    new Set(fullShards).size === fullShards.length &&
    covers(pins?.main, fullShards, main) &&
    covers(pins?.proof, fullShards, proof);

  for (const name of names) {
    const held = map(map(jobs[name])["concurrency"]);
    const group = held["group"];

    const shared =
      name === TESTS_JOB
        ? fullGroup
        : name === CHANGED_JOB
          ? rotated &&
            count(selectEnv["MOST"]) === proof &&
            changedStrategy["max-parallel"] === selectEnv["MOST"] &&
            Object.keys(changedMatrix).length === 1 &&
            changedMatrix["shard"] === CHANGED_LEGS
          : typeof group === "string" && group.toLowerCase() === CONTROL_GROUP;

    require(Object.keys(held).length === 3 &&
      held["queue"] === "max" &&
      held["cancel-in-progress"] === false &&
      shared, `SC19: ${name} shares its fixed job slots across runs, keeps every waiting job and cancels none`);
  }

  const reserved = [
    CONTROL_GROUP,
    ...upTo(main).map((slot) => `${MAIN_GROUP}${slot}`),
    ...upTo(proof).map((slot) => `${PROOF_GROUP}${slot}`),
  ];

  require(typeof concurrency["group"] === "string" &&
    !reserved.includes(concurrency["group"].toLowerCase()), "SC19: the workflow group never holds a shared job group");

  // 0595's groups are gone: no job group of this workflow, nor its own, starts with their prefix.
  require(![concurrency, ...names.map((name) => map(map(jobs[name])["concurrency"]))].some(
    (held) => typeof held["group"] === "string" && held["group"].toLowerCase().includes(OLD_GROUP),
  ), `SC19: no group holds 0595's ${OLD_GROUP} names`);

  // SC20. The matrix lists the legs in the order they should start. A group is a first in, first out
  // queue and the matrix makes its jobs in list order, so the first MAIN_SLOTS legs take main's groups
  // 1 to MAIN_SLOTS in order, and the first PROOF_SLOTS legs the proof groups 1 to PROOF_SLOTS, so no
  // group sits empty while another has a leg waiting.
  const firstOnes = (map_: Pins | undefined, most: number | undefined) =>
    map_ !== undefined &&
    most !== undefined &&
    upTo(most).every((slot, index) => {
      const leg = fullShards[index];

      return typeof leg === "string" && map_[leg] === slot;
    });

  require(fullShards.every((shard) => typeof shard === "string") &&
    new Set(fullShards).size === fullShards.length &&
    firstOnes(pins?.main, main) &&
    firstOnes(
      pins?.proof,
      proof,
    ), `SC20: the test job's first ${MAIN_SLOTS} legs take main's groups 1 to ${MAIN_SLOTS} in order, and its first ${PROOF_SLOTS} legs the proof groups 1 to ${PROOF_SLOTS}, each leg once, so no group waits empty`);
};

/**
 * A job's step of the `needs` chain: 0 for a job that needs nothing, else one past the deepest job
 * it needs. A job that needs one that is not there, or a loop, counts as 0: GitHub refuses such a
 * workflow, and the other rules name what is wrong.
 */
const depth = (jobs: Record<string, unknown>, name: string, seen: readonly string[] = []): number => {
  const needs = map(jobs[name])["needs"];
  const list = Predicate.isString(needs) ? [needs] : Array.isArray(needs) ? needs : [];

  const known = list.filter(
    (need): need is string => Predicate.isString(need) && need in jobs && !seen.includes(need) && need !== name,
  );

  return known.length === 0 ? 0 : 1 + Math.max(...known.map((need) => depth(jobs, need, [...seen, name])));
};

/**
 * scheduled.yaml's shape. `check` is check.yaml's text: the schedule runs next on its full matrix
 * of legs, so the measured split (vitest.shards.ts) and each leg's `/N` hold for both.
 */
export const lintScheduled = (text: string, check: string): string[] => {
  const parsed = Result.try((): unknown => parse(text));

  if (Result.isFailure(parsed)) {
    return ["scheduled.yaml: invalid YAML"];
  }

  const workflow = map(parsed.success),
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
    Predicate.isString(map(crons[0])["cron"]) &&
    HOURLY.test(
      String(map(crons[0])["cron"]),
    ), "SC1: it runs on a push to main, on one hourly schedule at a minute from 1 to 59, and by hand, on no other event");
  // SC16. The workflow's env is its three settings, nothing else: the gap, a whole number of
  // minutes, an hour at least (0581's binding constraint), and the two group counts (0598, checked in
  // jobSlots). A person changes each in one line beside the cron line.
  const gap = map(workflow["env"])[GAP];
  require(JSON.stringify(Rec.keys(map(workflow["env"])).toSorted()) ===
    JSON.stringify([GAP, MAIN_SLOTS, PROOF_SLOTS].toSorted()) &&
    Predicate.isNumber(gap) &&
    Number.isInteger(gap) &&
    gap >=
      LEAST_GAP, `SC16: the workflow's env is ${GAP}, ${MAIN_SLOTS} and ${PROOF_SLOTS}, nothing else, the gap a whole number of minutes, ${LEAST_GAP} or more`);
  // SC2. One run per ref at a time. Main's triggers share a queue; branch proofs have their own.
  const concurrency = map(workflow["concurrency"]);
  require(Predicate.isString(concurrency["group"]) &&
    /^scheduled-\$\{\{\s*github\.ref\s*\}\}$/i.test(concurrency["group"]) &&
    concurrency["cancel-in-progress"] ===
      false, "SC2: one run per ref at a time, in the shared per-ref group, and none cut short");

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
    require((Predicate.isNumber(limit) && limit > 0 && limit < 360) ||
      (name === TESTS_JOB && Predicate.isString(limit)), `SC4: ${name} sets timeout-minutes`);

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
      // SAFETY: `Rec.keys` of the `as const` SUITES object answers exactly its keys, as strings.
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
    gateLimits.every((limit) => Predicate.isNumber(limit) && Number.isInteger(limit) && limit > 0) &&
    Predicate.isNumber(gateLimit) &&
    // SAFETY: the `every` two lines up proved each gate limit is a whole number above zero.
    (gateLimits as number[]).reduce((sum, limit) => sum + limit, 0) < gateLimit &&
    !("continue-on-error" in gateJob) &&
    steps(gateJob).every(
      (s) => !("if" in s) && !("continue-on-error" in s),
    ), `SC14: every step of the ${GATE_JOB} job runs on every run, with a whole timeout-minutes of its own inside the job's, and neither the job nor a step continues on error, so a gate that gives no start fails`);

  // SC15. The tests run only when the gate said `true`: a gate that said `false` or failed starts
  // none. They run the full set wherever `select` did not run, which is every run on main, and on a
  // branch whose `select` said `full` (0590). A select that failed starts no full set.
  const testsJob = map(jobs[TESTS_JOB]);
  require(JSON.stringify(testsJob["needs"]) === JSON.stringify([GATE_JOB, SELECT_JOB]) &&
    compact(testsJob["if"]) ===
      compact(
        TESTS_IF,
      ), `SC15: ${TESTS_JOB} needs the ${GATE_JOB} and ${SELECT_JOB}, and runs only when the gate said start=true and ${SELECT_JOB} was skipped or said full`);

  // SC17. `select` runs only on a hand start on a branch other than main, after the gate said
  // `true` (0590): a push to main, the catch-up and a hand start on main skip it, so SC15's `tests`
  // runs every test there. It runs proof.ts once, in a step whose outputs are the job's,
  // with the most legs at once (`MOST`, the `changed` matrix's `max-parallel` and PROOF_SLOTS, SC6, SC19), the legs' test
  // step limit (`LIMIT`, next's, SC18) and where its record goes, and no token. It checks out the
  // whole history, to diff the branch with origin/main from their merge base, and keeps the record
  // as `proof-set` after a red step too.
  const commandsOf = (job: Record<string, unknown>) =>
    steps(job).flatMap((s) => (Predicate.isString(s["run"]) ? [s["run"]] : []));

  const select = map(jobs[SELECT_JOB]);
  const selectSteps = steps(select);
  const selectRuns = selectSteps.filter((s) => "run" in s && s["run"] !== "pnpm install --frozen-lockfile");
  const selectEnv = map(selectRuns[0]?.["env"]);
  const selectOutputs = { ...SELECT_OUTPUTS, slots: SLOT_OUTPUT };
  const selectKeys = ["MOST", "LIMIT", "RECORD", "RUN_NUMBER"];
  const selectCheckouts = selectSteps.filter((s) => uses(s, "actions/checkout"));
  const records = selectSteps.filter((s) => uses(s, "actions/upload-artifact") && map(s["with"])["path"] === RECORD);
  require(SELECT_JOB in jobs &&
    JSON.stringify(select["needs"]) === JSON.stringify([GATE_JOB]) &&
    compact(select["if"]) === compact(SELECT_IF) &&
    JSON.stringify(select["outputs"]) === JSON.stringify(selectOutputs) &&
    selectRuns.length === 1 &&
    selectRuns[0]?.["id"] === SELECT_STEP &&
    selectRuns[0]?.["run"] === SELECT &&
    !("if" in (selectRuns[0] ?? {})) &&
    JSON.stringify(Object.keys(selectEnv)) === JSON.stringify(selectKeys) &&
    selectEnv["RUN_NUMBER"] === RUN_NUMBER &&
    selectEnv["RECORD"] === RECORD &&
    selectCheckouts.length === 1 &&
    map(selectCheckouts[0]?.["with"])["fetch-depth"] === 0 &&
    records.length === 1 &&
    map(records[0]?.["with"])["name"] === "proof-set" &&
    compact(records[0]?.["if"]) === "!cancelled()" &&
    selectSteps.indexOf(records[0] ?? {}) >
      selectSteps.indexOf(
        selectRuns[0] ?? {},
      ), `SC17: ${SELECT_JOB} runs ${SELECT} once, only on a hand start on a branch other than main, after the gate said start=true, with the whole history, and keeps its record as proof-set`);

  // SC18. `changed` runs a changed set's legs (0590): only when `select` said `changed` with a leg,
  // so it and `tests` never run in one run, each leg exactly its own list over every project
  // proof.ts lists, `next-integration` not among them (0602), at next's test step limit with the
  // same backstop, chromium first when its list holds a visual file, and nothing else.
  const changed = map(jobs[CHANGED_JOB]);
  const changedSteps = steps(changed);
  const changedRuns = changedSteps.filter((s) => s["run"] === CHANGED_RUN);
  const nextLimitHere = limitOf(jobs, "next");
  require(CHANGED_JOB in jobs &&
    JSON.stringify(changed["needs"]) === JSON.stringify([GATE_JOB, SELECT_JOB]) &&
    compact(changed["if"]) === compact(CHANGED_IF) &&
    map(map(changed["strategy"])["matrix"])["shard"] === CHANGED_LEGS &&
    Object.keys(map(map(changed["strategy"])["matrix"])).length === 1 &&
    changedRuns.length === 1 &&
    JSON.stringify(map(changedRuns[0]?.["env"])) ===
      JSON.stringify({ FILES: `\${{ ${LEG_FILES} }}`, LEG: `\${{ matrix.shard }}`, FABRIKA_TEST_DEPTH: DEPTH }) &&
    !("if" in (changedRuns[0] ?? {})) &&
    Predicate.isNumber(nextLimitHere) &&
    changedRuns[0]?.["timeout-minutes"] === nextLimitHere &&
    selectEnv["LIMIT"] === nextLimitHere &&
    changed["timeout-minutes"] === nextLimitHere + BACKSTOP &&
    changedSteps.some(
      (s) => s["run"] === chromium && compact(s["if"]) === compact(`contains(${LEG_FILES}, '.visual.test.')`),
    ) &&
    JSON.stringify(commandsOf(changed).toSorted()) ===
      JSON.stringify(
        ["pnpm install --frozen-lockfile", chromium, CHANGED_RUN, TIME_TABLE].toSorted(),
      ), `SC18: ${CHANGED_JOB} runs only when ${SELECT_JOB} said changed with a leg, each leg its own list over proof.ts's projects, none of them next-integration (0602), at next's limit and backstop, select's LIMIT that limit, chromium first for a visual file, and nothing else`);

  const changedKept = changedSteps.filter(
    (s) => uses(s, "actions/upload-artifact") && map(s["with"])["path"] === `\${{ runner.temp }}/results.json`,
  );

  require(changedKept.length === 1 &&
    compact(changedKept[0]?.["if"]) === "!cancelled()" &&
    changedSteps.indexOf(changedKept[0] ?? {}) >
      changedSteps.indexOf(
        changedRuns[0] ?? {},
      ), `SC10: ${CHANGED_JOB} uploads its report after its tests, even after a red one`);
  errors.push(...timed(CHANGED_JOB, changed, "results.json").map((reason) => `scheduled.yaml: ${reason}`));

  // SC6. Every test leg a run starts is in one matrix: the test job's, or on a branch's changed set
  // the `changed` job's, which SC15 and SC18 keep from running in one run. The gate, `select` and
  // the report are the only other jobs: GitHub's fail-fast stops only the legs of the red leg's own
  // matrix (probe run 43778347612), so a second matrix in one run would run on to its end after a red
  // leg, as the stop step never let it. At most BUDGET machines at once: jobs run together only at
  // the same step of the `needs` chain, so each step counts its jobs, a matrix its `max-parallel` and
  // any other job one, and the two test matrices, which never run together, count as the larger.
  // A matrix sets it, runs no more at once than it has legs (the `changed` legs: no more than proof.ts
  // makes, its `MOST`, PROOF_SLOTS), and stops its other legs once one failed, which leaves the run's conclusion
  // `failure`.
  const MATRICES = [TESTS_JOB, CHANGED_JOB];
  require(JSON.stringify(others.toSorted()) === JSON.stringify([GATE_JOB, SELECT_JOB, ...MATRICES].toSorted()) &&
    Rec.toEntries(jobs).every(
      ([name, job]) => MATRICES.includes(name) || !("strategy" in map(job)),
    ), `SC6: every test leg a run starts is in one matrix, the ${TESTS_JOB} job or the ${CHANGED_JOB} job, so its first red leg stops all the others`);
  const atOnce = new Map<number, number>();
  const matrixAt = new Map<number, number>();
  const main = count(map(workflow["env"])[MAIN_SLOTS]);
  const proof = count(map(workflow["env"])[PROOF_SLOTS]);

  // The test job runs MAIN_SLOTS legs at once on main and PROOF_SLOTS on any other ref. GitHub allows no
  // `env` in `strategy`, so its `max-parallel` is that expression with the two numbers written in,
  // and the lint holds them equal to the two settings.
  const BY_REF = /^github\.ref=='refs\/heads\/main'&&(\d+)\|\|(\d+)$/.exec(
    compact(map(map(jobs[TESTS_JOB])["strategy"])["max-parallel"]),
  );

  const byRef = BY_REF === null ? undefined : { main: Number(BY_REF[1]), proof: Number(BY_REF[2]) };

  require(main !== undefined &&
    proof !== undefined &&
    byRef?.main === main &&
    byRef.proof ===
      proof, `SC6: ${TESTS_JOB}'s max-parallel is \${{ ${ON_MAIN} && ${MAIN_SLOTS} || ${PROOF_SLOTS} }}, the count of its ref's groups, with the two settings' numbers written in`);

  for (const [name, job] of Rec.toEntries(jobs).map(([name, job]) => [name, map(job)] as const)) {
    const strategy = map(job["strategy"]);
    const most = strategy["max-parallel"];
    const legsHere = listed(job).length;

    if (name === TESTS_JOB) {
      require(main !== undefined &&
        proof !== undefined &&
        Math.max(main, proof) <= legsHere &&
        strategy["fail-fast"] ===
          true, `SC6: ${name} sets max-parallel to at most its legs, and its first red leg stops the others`);
    } else if ("strategy" in job) {
      const cap = selectEnv["MOST"];
      require(Predicate.isNumber(most) &&
        Number.isInteger(most) &&
        most >= 1 &&
        Predicate.isNumber(cap) &&
        most === cap &&
        strategy["fail-fast"] ===
          true, `SC6: ${name} sets max-parallel to at most its legs, and its first red leg stops the others`);
    }

    const at = depth(jobs, name);

    const machines =
      name === TESTS_JOB
        ? Math.max(byRef?.main ?? legsHere, byRef?.proof ?? legsHere)
        : "strategy" in job && Predicate.isNumber(most)
          ? most
          : 1;

    if (MATRICES.includes(name)) {
      matrixAt.set(at, Math.max(matrixAt.get(at) ?? 0, machines));
    } else {
      atOnce.set(at, (atOnce.get(at) ?? 0) + machines);
    }
  }

  for (const [at, machines] of matrixAt) {
    atOnce.set(at, (atOnce.get(at) ?? 0) + machines);
  }

  require([...atOnce.values()].every(
    (machines) => machines <= BUDGET,
  ), `SC6: its jobs take at most ${BUDGET} machines at once, half of the 20 runners`);

  jobSlots(workflow, require);

  // SC7. All of next/ on check.yaml's full matrix, each leg's `/N` its kind's count, nothing
  // narrowed. A `--changed`, a `$FILTER` or a list would make it the merge line's selection again.
  // The test job lists check.yaml's legs, each once, among the tooling legs (SC8); their order is
  // SC20's, the start order, and no longer check.yaml's.
  const tests = map(jobs[TESTS_JOB]),
    testSteps = steps(tests),
    shards = listed(tests),
    toolingLegs = shards.filter((shard) => Predicate.isString(shard) && shard.startsWith(TOOLING_LEG)),
    nextLegs = shards.filter((shard) => !toolingLegs.includes(shard)),
    legsOfCheck = legs(nextJob(check)),
    e2eCount = ends(legsOfCheck).length,
    vitestCount = numbered(legsOfCheck).length;

  require(legsOfCheck.length > 0 &&
    JSON.stringify(nextLegs.toSorted()) ===
      JSON.stringify(
        legsOfCheck.toSorted(),
      ), "SC7: the test job's next legs are check.yaml's full matrix of next legs, each once");
  const vitest = testSteps.filter((s) => s["run"] === WHOLE_NEXT);
  const e2e = testSteps.filter((s) => s["run"] === WHOLE_E2E);
  require(vitest.length === 1 &&
    compact(vitest[0]?.["if"]) === compact(`!${ON_E2E} && !${ON_TOOLING}`) &&
    map(vitest[0]?.["env"])["SHARD"] ===
      `\${{ matrix.shard }}/${vitestCount}`, "SC7: next runs vitest once, on the numbered legs, each its share of them");
  require(compact(map(vitest[0]?.["env"])["PROJECTS"]) ===
    compact(
      NEXT_PROJECTS,
    ), "SC7: next's vitest legs run the next and next-integration projects on main, and next alone on a branch's full set, which runs no real-resource law (0602)");
  require(e2e.length === 1 &&
    compact(e2e[0]?.["if"]) === ON_E2E &&
    map(e2e[0]?.["env"])["SHARD"] ===
      `\${{ matrix.shard }}/${e2eCount}`, "SC7: next runs every visual file once, on the e2e legs, each its share of them");
  require(testSteps.some(
    (s) => s["run"] === chromium && compact(s["if"]) === compact(`${ON_E2E} && ${VISUAL_FILES}`),
  ), "SC7: next fetches chromium on the e2e legs, once a visual file exists");

  // SC8. Every tooling test on the tooling legs, `tooling-1` to `tooling-N`, nothing narrowed.
  const toolingRuns = testSteps.filter((s) => s["run"] === WHOLE_TOOLING);
  require(toolingRuns.length === 1 &&
    compact(toolingRuns[0]?.["if"]) === ON_TOOLING &&
    map(toolingRuns[0]?.["env"])["SHARD"] === `\${{ matrix.shard }}/${toolingLegs.length}` &&
    toolingLegs.length > 0 &&
    JSON.stringify(toolingLegs.toSorted()) ===
      JSON.stringify(
        Array.from({ length: toolingLegs.length }, (_, i) => `${TOOLING_LEG}${i + 1}`),
      ), "SC8: the tooling legs run every tooling test once, legs tooling-1 to tooling-N, each its share of them");
  require(compact(map(toolingRuns[0]?.["env"])["PROJECTS"]) ===
    compact(
      TOOLING_PROJECTS,
    ), "SC8: the tooling legs run the tooling and tooling-integration projects on main, and tooling alone on a branch's full set, which runs no tooling law that starts a process (0602)");

  // SC9. The commands are only these: no step runs another test command or narrows one.
  require(JSON.stringify(commandsOf(tests).toSorted()) ===
    JSON.stringify(
      ["pnpm install --frozen-lockfile", WHOLE_NEXT, chromium, WHOLE_E2E, WHOLE_TOOLING, TIME_TABLE].toSorted(),
    ), "SC9: the test job runs only its install, its whole-suite commands and its time table");

  // SC10. The test job keeps each leg's Vitest report after a red step, so the report job can name
  // the failing tests.
  const kept = testSteps.filter(
    (s) => uses(s, "actions/upload-artifact") && map(s["with"])["path"] === `\${{ runner.temp }}/results.json`,
  );

  const last = testSteps.findLastIndex((s) => Predicate.isString(s["run"]) && s["run"].includes(RESULTS));
  require(kept.length === 1 &&
    compact(kept[0]?.["if"]) === "!cancelled()" &&
    testSteps.indexOf(kept[0] ?? {}) >
      last, `SC10: ${TESTS_JOB} uploads its report after its tests, even after a red one`);
  // TT1 and TT2, as in check.yaml.
  errors.push(...timed(TESTS_JOB, tests, "results.json").map((reason) => `scheduled.yaml: ${reason}`));

  // SC11. Every test leg runs at full depth: a law that reads FABRIKA_TEST_DEPTH runs its full case
  // count here, and unset means `fast`, as on the merge line (pull request 1274).
  for (const [legs, command] of [
    ["next's vitest legs", WHOLE_NEXT],
    ["the e2e legs", WHOLE_E2E],
    ["the tooling legs", WHOLE_TOOLING],
  ] as const) {
    const found = Rec.values(jobs).flatMap((job) => steps(map(job)).filter((s) => s["run"] === command));
    require(found.length > 0 &&
      found.every(
        (s) => map(s["env"])["FABRIKA_TEST_DEPTH"] === DEPTH,
      ), `SC11: every step of ${legs} sets FABRIKA_TEST_DEPTH: ${DEPTH}`);
  }

  // SC12. SC2's group holds every run on the same ref, so a waiting run is
  // never replaced: GitHub's default queue keeps one waiting and cancels it when a newer run queues.
  require(map(workflow["concurrency"])["queue"] === "max", "SC12: a newer run never cancels a waiting one: queue: max");

  // SC13. The time limit sits on each test step, and the job's own is a backstop BACKSTOP minutes
  // past its leg's suite's. A step that runs into its limit ends `failure`, and so does the run; a
  // job that runs into its own ends `cancelled`, and so does the run, even when the report fails
  // after it (probe runs 43778586135 and 43778355238 on a throwaway copy of this workflow). The
  // job's limit may read `matrix` (GitHub's docs, "Contexts reference").
  const whole = (limit: unknown): limit is number =>
    Predicate.isNumber(limit) && Number.isInteger(limit) && limit > 0 && limit + BACKSTOP < 360;

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

// Proof preflight reads the workflow at its exact source head, without executing that source.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--job-slots") {
    console.error("usage: scheduled.ts --job-slots < scheduled.yaml");
    process.exitCode = 2;
  } else {
    const input = Result.try((): unknown => parse(readFileSync(0, "utf8")));
    const errors: string[] = [];

    if (Result.isFailure(input)) {
      errors.push("scheduled.yaml: invalid YAML");
    } else {
      jobSlots(map(input.success), (holds, reason) => {
        if (!holds) {
          errors.push(`scheduled.yaml: ${reason}`);
        }
      });
    }

    if (errors.length === 0) {
      console.log("scheduled job slots conform");
    } else {
      for (const error of errors) {
        console.error(error);
      }

      process.exitCode = 1;
    }
  }
}

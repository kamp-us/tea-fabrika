// The CI workflow's shape. Static workflow shape belongs in lint. Today's version is frozen
// (0525), so no job, step or shard runs only for it.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { gated } from "./required.mjs";

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const map = (value: unknown): Record<string, unknown> => (isMap(value) ? value : {});

const steps = (job: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(job["steps"]) ? job["steps"].filter(isMap) : [];

const commands = (job: Record<string, unknown>) =>
  steps(job).flatMap((step) =>
    typeof step["run"] === "string" ? step["run"].split("\n").map((line) => line.trim()) : [],
  );

const compact = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const expression = trimmed.startsWith("${{") && trimmed.endsWith("}}") ? trimmed.slice(3, -2).trim() : trimmed;
  // Keep quoted strings and names intact. Only operator spacing cannot change meaning.
  return expression.replace(
    /'(?:[^']|'')*'|\s*(==|!=|&&|\|\|)\s*/g,
    (match, operator: string | undefined) => operator ?? match,
  );
};

const env = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}`,
  HEAD: `\${{ github.event.pull_request.head.sha || github.sha }}`,
  EVENT: `\${{ github.event_name }}`,
};

// The classifier also reads whether the pull request is a draft (0134's amendment of 2026-11-11).
const classifier = { ...env, DRAFT: `\${{ github.event.pull_request.draft }}` };

// A draft's check and ci-required carry their own names, so a draft's green answer on a head never
// stands in for the ready run's on the same head (catchup.sh reads `check`, the ruleset
// `ci-required`).
const DRAFT_NAMES = {
  check: "github.event.pull_request.draft&&'lint'||'check'",
  "ci-required": "github.event.pull_request.draft&&'ci-required (draft)'||'ci-required'",
};

// Marking a draft ready starts the full run; only a new head cancels the run before it.
const TYPES = ["opened", "synchronize", "reopened", "ready_for_review"];
const CANCEL = "github.event_name=='pull_request'&&github.event.action=='synchronize'";
// The commit a run's change starts from, for vitest's `--changed`: a pull request's base, a merge
// queue group's base, or what main held before a push. All zeros (a first push) is no base.
const TEST_BASE = `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`;
// The jobs ci-required judges, by the names it and the branch ruleset know (0525 keeps them).
const JOBS = ["changes", "field", "check", "typecheck", "e2e", "test", "next", "ci-required"];
const RATCHET = 'node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"';

// Chromium's OS packages come from apt, so the step first finds a mirror that answers (apt.sh).
const chromium =
  "sudo sh .github/ci/apt.sh update\n" + "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium\n";

// The next job's machines. Each is a string, so a workflow `if` compares a string with a string.
// The end-to-end legs `e2e-1` to `e2e-N` come first; the lint pins their shape, and the count law in
// vitest.shards.test.ts (E4) pins N from measured seconds.
const E2E_PREFIX = "e2e-";
const VITEST_LEGS = ["1", "2", "3", "4", "5"];
const ON_E2E = `startsWith(matrix.shard, '${E2E_PREFIX}')`;

/** A job's matrix legs as the workflow wrote them, numbers and strings kept apart. */
const legs = (job: Record<string, unknown>): unknown[] => {
  const shard = map(map(job["strategy"])["matrix"])["shard"];
  return Array.isArray(shard) ? shard : [];
};

/** The legs that run vitest: the ones written as a quoted whole number. */
const numbered = (all: readonly unknown[]): string[] =>
  all.filter((leg): leg is string => typeof leg === "string" && /^[1-9]\d*$/.test(leg));

/** The legs that run the end-to-end files: the ones written as `e2e-` and a whole number. */
const ends = (all: readonly unknown[]): string[] =>
  all.filter((leg): leg is string => typeof leg === "string" && /^e2e-[1-9]\d*$/.test(leg));

const nextJob = (text: string) => map(map(map(parse(text))["jobs"])["next"]);

/** The next job's vitest legs in a workflow's text, for the law on how the table splits. */
export const vitestLegs = (text: string): string[] => numbered(legs(nextJob(text)));

/** The next job's end-to-end legs in a workflow's text, for the law on how many there are. */
export const e2eLegs = (text: string): string[] => ends(legs(nextJob(text)));

/** The next job's `timeout-minutes` in a workflow's text, for the same law: a leg gets half of it. */
export const nextMinutes = (text: string): number => Number(nextJob(text)["timeout-minutes"]);

export const lintWorkflow = (text: string): string[] => {
  let source: unknown;

  try {
    source = parse(text);
  } catch {
    return ["check.yaml: invalid YAML"];
  }

  const workflow = map(source),
    on = map(workflow["on"]),
    jobs = map(workflow["jobs"]);
  const errors: string[] = [];
  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`check.yaml: ${reason}`);
    }
  };
  const push = map(on["push"]),
    pr = map(on["pull_request"]),
    queue = map(on["merge_group"]);
  require("pull_request" in on &&
    "push" in on &&
    JSON.stringify(push["branches"]) === '["main"]', "run every PR and main push");

  for (const trigger of [on, push, pr, queue]) {
    require(!["paths", "paths-ignore", "branches-ignore", "tags", "tags-ignore"].some(
      (key) => key in trigger,
    ), "no workflow path or branch exclusions");
  }

  require(!("branches" in pr), "all PR bases remain enabled");
  // A merge queue takes a required check only from a `merge_group` run, so without this trigger
  // `ci-required` never reports there and nothing can merge.
  require(JSON.stringify(queue["types"]) === '["checks_requested"]', "the merge queue's group runs the checks");
  const types = pr["types"];
  require(Array.isArray(types) &&
    types.length === TYPES.length &&
    TYPES.every((type) => types.includes(type)), "pull requests run on open, push, reopen and ready for review");
  require(compact(map(workflow["concurrency"])["cancel-in-progress"]) === CANCEL, "only a new head cancels a run");

  for (const [job, expected] of Object.entries(DRAFT_NAMES)) {
    require(compact(map(jobs[job])["name"]) === expected, `${job} has its own name on a draft`);
  }

  // D4: the jobs keep their names, which ci-required and the branch ruleset read.
  require(JOBS.every((name) => isMap(jobs[name])), "the jobs keep their names");

  // D6: check is lint and its ledger steps, with nothing of today's version: no promises gate, no
  // build of today's packages and no dead-export ledger. None of its steps skips.
  const checkSteps = steps(map(jobs["check"]));
  require(checkSteps.every((step) => !("if" in step)), "every check step runs, a draft's lint too");
  require(!checkSteps.some(
    (step) =>
      step["name"] === "promises" ||
      step["name"] === "dead exports ledger committed" ||
      (typeof step["run"] === "string" &&
        /\bpnpm (?:-s )?(?:promises|build)\b|unreachable-ledger\.json/.test(step["run"])),
  ), "D6: check runs no promises gate, no build and no dead-export ledger step");

  // D7: today's end-to-end tests are gone (0525). e2e runs only when changes failed, and then its
  // one step fails with its reason; it starts no app, no browser and no script of today's app.
  const e2eSteps = steps(map(jobs["e2e"]));
  const e2eRun = e2eSteps[0]?.["run"];
  require(e2eSteps.length === 1 &&
    typeof e2eRun === "string" &&
    !("uses" in (e2eSteps[0] ?? {})) &&
    !("if" in (e2eSteps[0] ?? {})) &&
    e2eSteps[0]?.["continue-on-error"] === undefined &&
    /\becho\b/.test(e2eRun) &&
    e2eRun.trim().split("\n").at(-1)?.trim() === "exit 1" &&
    !/playwright|electron|fabrika-app-old|pnpm|node /i.test(
      e2eRun,
    ), "D7: e2e's one step fails with its reason and starts nothing");

  // 0524: a list file only shrinks. Without its one step a pull request could drop the ratchet and
  // pass with a grown list; a first push's zeros map to no base, as for the test steps.
  const ratchets = checkSteps.filter(
    (step) => typeof step["run"] === "string" && step["run"].includes("next/apps/fabrika/src/exam/ratchet"),
  );
  require(ratchets.length === 1 &&
    ratchets[0]?.["run"] === RATCHET &&
    compact(map(ratchets[0]?.["env"])["BASE"]) === compact(TEST_BASE) &&
    !("if" in (ratchets[0] ?? {})) &&
    ratchets[0]?.["continue-on-error"] ===
      undefined, `check runs ${RATCHET} once, on the test base, and its failure blocks`);

  for (const name of gated) {
    const job = map(jobs[name]);
    const needs = job["needs"];
    require(needs === "changes" ||
      (Array.isArray(needs) && needs.length === 1 && needs[0] === "changes"), `${name} needs changes`);
    require(compact(job["if"]) ===
      compact(
        `!cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${name} != 'false')`,
      ), `${name} must run after classifier failure and skip only its false flag`);
  }

  // A job with no limit runs for GitHub's 360 minute default when a step hangs (ticket 496).
  for (const [name, job] of Object.entries(jobs)) {
    const limit = map(job)["timeout-minutes"];
    require(typeof limit === "number" && limit > 0 && limit < 360, `${name} sets timeout-minutes`);
  }

  // The one required check: it waits on every other job, never skips, and judges them all.
  const summary = map(jobs["ci-required"]),
    others = Object.keys(jobs).filter((name) => name !== "ci-required");
  const needed = Array.isArray(summary["needs"]) ? summary["needs"] : [];
  require(needed.length === others.length &&
    others.every((name) => needed.includes(name)), "ci-required needs every other job");
  require(compact(summary["if"]) === "always()" &&
    summary["continue-on-error"] === undefined, "ci-required runs after any result and its failure blocks");
  const judged = steps(summary).filter((s) => "run" in s);
  require(judged.length === 1 &&
    judged[0]?.["run"] === "node .github/ci/required.mjs" &&
    compact(map(judged[0]?.["env"])["NEEDS"]) === "toJSON(needs)" &&
    !("if" in (judged[0] ?? {})) &&
    judged[0]?.["continue-on-error"] === undefined, "ci-required judges toJSON(needs) with required.mjs");

  const changes = map(jobs["changes"]),
    outputs = map(changes["outputs"]);
  require(!("if" in changes) && !("needs" in changes), "changes starts on every event");

  for (const name of ["check", "typecheck", "test", "e2e", "field"]) {
    require(compact(outputs[name]) === `steps.diff.outputs.${name}`, `changes exposes ${name}`);
  }

  // The five flags above, plus `next` and `filter` below: no flag of today's version (0525).
  require(Object.keys(outputs).length === 7, "changes exposes no flag of today's version");

  // The plan for CI paths, slice 2: the parser's pass (`--same`) prints `next` and `filter` again
  // when it proved a next/ file is the same program, and the first pass's stand when it printed
  // nothing. Its install and its run may fail without failing changes, which would run everything
  // and turn ci-required red.
  for (const name of ["next", "filter"]) {
    require(compact(outputs[name]) ===
      `steps.same.outputs.${name}||steps.diff.outputs.${name}`, `changes exposes ${name} from the parser's pass, else the first`);
  }

  const changeSteps = steps(changes);
  const same = changeSteps.find((s) => s["id"] === "same");
  require(same?.["run"] === "node .github/ci/changes.mjs --same" &&
    same["continue-on-error"] === true, "changes runs the parser's pass, and its failure fails nothing");

  for (const [key, expected] of Object.entries(classifier)) {
    require(map(same?.["env"])[key] === expected, `the parser's pass gets event ${key} through env`);
  }

  for (const step of changeSteps.filter(
    (s) =>
      (typeof s["uses"] === "string" && /^(pnpm\/action-setup|actions\/setup-node)@/.test(s["uses"])) ||
      (typeof s["run"] === "string" && s["run"].startsWith("pnpm install")),
  )) {
    require(step["continue-on-error"] === true &&
      same !== undefined &&
      changeSteps.indexOf(step) <
        changeSteps.indexOf(same), "the parser's setup comes before its pass, and its failure fails nothing");
  }

  require(changeSteps.some(
    (s) => typeof s["run"] === "string" && s["run"].startsWith("pnpm install"),
  ), "changes installs the parser for its pass");

  // The typecheck is its own job, so its answer comes as soon as it ends and a lane can read it
  // alone (0133). check runs no second one.
  require(commands(map(jobs["typecheck"])).includes("pnpm typecheck"), "the typecheck job runs pnpm typecheck");
  require(!commands(map(jobs["check"])).includes("pnpm typecheck"), "check leaves the typecheck to its own job");

  require(commands(changes).includes("sh .agents/skills/lead/scripts/skillscheck.sh"), "changes runs the skills check");
  require(commands(changes).includes(
    "node oxlint-plugins/gitignore.mjs",
  ), "changes runs the shared tracked-file check");

  for (const command of ["sh .agents/skills/lead/scripts/skillscheck.sh", "node oxlint-plugins/gitignore.mjs"]) {
    require(steps(changes).some(
      (s) => s["run"] === command && compact(s["if"]) === "!cancelled()",
    ), "small scans still run after classifier failure");
  }

  // F8: the freeze guard (0525) runs on every event, after a classifier failure too, and reads the
  // same diff: the same BASE, HEAD and EVENT as the classifier's own step.
  const guards = steps(changes).filter((s) => s["run"] === "node .github/ci/freeze.mjs");
  const diffEnv = map(steps(changes).find((s) => s["id"] === "diff")?.["env"]);
  require(guards.length === 1 &&
    compact(guards[0]?.["if"]) === "!cancelled()" &&
    guards[0]?.["continue-on-error"] === undefined &&
    Object.entries(env).every(
      ([key, expected]) => map(guards[0]?.["env"])[key] === expected && diffEnv[key] === expected,
    ), "changes runs the freeze guard on the classifier's diff");

  const field = map(jobs["field"]);
  require(!("needs" in field) && !("if" in field), "field starts independently on every event");
  require(field["continue-on-error"] !== true, "field failures block");

  for (const [name, job] of [
    ["changes", changes],
    ["field", field],
  ] as const) {
    const list = steps(job);
    require(list.some(
      (s) =>
        typeof s["uses"] === "string" &&
        s["uses"].startsWith("actions/checkout@") &&
        map(s["with"])["fetch-depth"] === 0 &&
        !("if" in s),
    ), `${name} checks out history`);
    const diff = list.find((s) => s["id"] === "diff");
    require(diff?.["run"] === "node .github/ci/changes.mjs" && !("if" in (diff ?? {})), `${name} calls the classifier`);

    for (const [key, expected] of Object.entries(classifier)) {
      require(map(diff?.["env"])[key] === expected, `${name} passes event ${key} through env`);
    }
  }

  const fieldSteps = steps(field),
    flag = compact("steps.diff.outputs.field == 'true'");
  const install = fieldSteps.find((s) => typeof s["run"] === "string" && s["run"].startsWith("pnpm install "));
  require(typeof install?.["run"] === "string" &&
    install["run"].includes("--frozen-lockfile") &&
    install["run"].includes("--filter @tea-fabrika/ci") &&
    !install["run"].includes("--ignore-workspace"), "field installs the workspace package with its frozen lockfile");
  const check = fieldSteps.find((s) => s["run"] === "node .github/ci/field-check.ts");
  require(check !== undefined, "field runs the row checker");
  require(check?.["continue-on-error"] !== true, "row checker failures block");

  for (const action of ["pnpm/action-setup@", "actions/setup-node@"]) {
    require(fieldSteps.some(
      (s) => typeof s["uses"] === "string" && s["uses"].startsWith(action),
    ), `field includes ${action} setup`);
  }

  for (const [key, expected] of Object.entries(env)) {
    require(map(check?.["env"])[key] === expected, `field check passes ${key} through env`);
  }

  for (const step of fieldSteps.filter(
    (s) =>
      s === install ||
      s === check ||
      (typeof s["uses"] === "string" && /^(pnpm\/action-setup|actions\/setup-node)@/.test(s["uses"])),
  )) {
    require(compact(step["if"]) === flag, "field setup, install and validation skip without changed JSONL");
  }

  // D5: one test step and its shard times, over every test but next/'s, which has its own job.
  // No apt step, since only today's tests needed its packages, and no step on today's flag.
  const test = map(jobs["test"]),
    scripts = commands(test);
  require(JSON.stringify(map(map(test["strategy"])["matrix"])["shard"]) === "[1,2,3,4,5,6]", "keep six shards");
  const testSteps = steps(test);
  const rest = testSteps.filter((s) => commands({ steps: [s] }).some((line) => /\bvitest\b/.test(line)));
  const times = testSteps.find((s) => s["name"] === "shard times");
  const runs = scripts.filter((line) => /\bvitest\b/.test(line));
  require(rest.length === 1 && rest[0]?.["name"] === "test", "D5: the test job has one vitest step");
  require(times !== undefined &&
    rest[0] !== undefined &&
    testSteps.indexOf(rest[0]) < testSteps.indexOf(times) &&
    compact(times["if"]) === "!cancelled()", "D5: shard times follow the tests, after a failure too");
  require(!testSteps.some(
    (s) =>
      /apt/.test(String(s["name"] ?? "")) ||
      /\bapt(?:-get)?\b|apt\.sh/.test(String(s["run"] ?? "")) ||
      /outputs\.today/.test(compact(s["if"])),
  ), "D5: the test job has no apt step and no step on today's flag");
  require(compact(map(rest[0]?.["env"])["BASE"]) ===
    compact(TEST_BASE), "T4: the test step takes its base from the pull request, the merge queue's group or the push");
  require(runs.length === 2 &&
    runs.every(
      (line) =>
        line.startsWith("pnpm exec vitest run ") &&
        line.includes('--shard "$SHARD"') &&
        line.includes("--passWithNoTests") &&
        /--exclude\s+['"]next\/\*\*['"](?:\s|$)/.test(line),
    ) &&
    runs.filter((line) => line.includes('--changed "$BASE"')).length ===
      1, "D5: every test command shards and excludes next/**, on a pull request and on main");
  require(scripts.includes('if [ -n "$BASE" ]; then') &&
    scripts.includes("else"), "PR and main branches remain separate");
  const nextJob = map(jobs["next"]),
    strategy = map(nextJob["strategy"]),
    matrix = map(strategy["matrix"]),
    nextSteps = steps(nextJob);
  require(!("name" in nextJob), "next keeps the default matrix check names");
  // E1. The end-to-end legs `e2e-1` to `e2e-N`, in order, then the vitest legs "1" to "5", all
  // strings. The count N is E4's, in vitest.shards.test.ts; here only its shape and its `/N`.
  // Plants (T967), each run once on check.yaml and restored, each exit 1: drop e2e-2 and keep `/2`
  // (E2's count error); `e2e-2, e2e-1` (E1); a leg named plain `e2e` (E1 and E2); `/3` with two legs
  // (E2); the end-to-end step's guard dropped (E2); `--shard` dropped (E2's command); shard times back
  // before the end-to-end step (E3); chromium on every leg (E3); the vitest step on the old
  // `matrix.shard != 'e2e'` (E3).
  const allLegs = legs(nextJob),
    e2eCount = ends(allLegs).length;
  const expectedLegs = [...Array.from({ length: e2eCount }, (_, i) => `${E2E_PREFIX}${i + 1}`), ...VITEST_LEGS];
  require(e2eCount >= 1 &&
    JSON.stringify(allLegs) === JSON.stringify(expectedLegs) &&
    Object.keys(matrix).length ===
      1, "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries");
  require(strategy["fail-fast"] === false, "next lets every shard finish");
  // The plan for CI paths, slice 2: the path is `filter` from changes, the reader tests or `next/`,
  // unquoted so each reader path is its own argument. A missing filter runs all of next/.
  // On a pull request CHANGED is `--changed=<base> --passWithNoTests`, so only the tests a change
  // reaches run; on the merge queue and main it is empty, so the whole suite runs as the backstop.
  const nextCommand =
    'pnpm exec vitest run $FILTER $CHANGED --shard "$SHARD" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"';
  // The leg `e2e-k` with SHARD `e2e-k/N` asks Vitest for shard `k/N` of the end-to-end files. It
  // takes no filter, so under the reader filter the e2e legs still run every end-to-end file a
  // pull request's change reaches, and every one in the queue and on main.
  const e2eCommand = `node next/apps/fabrika/e2e.ts $CHANGED --shard "\${SHARD#e2e-}" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"`;
  const changedOnPullRequests = `\${{ github.event_name == 'pull_request' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;
  // The vitest step's own: empty when the filter names the reader tests too. They read files as
  // text, so `--changed`, which follows imports, would drop them; there the filter alone decides.
  const changedUnlessReaders = `\${{ github.event_name == 'pull_request' && (needs.changes.outputs.filter || 'next/') == 'next/' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;
  const adviceCommand = 'node .github/ci/shard-times.ts "$RUNNER_TEMP/next.json"';
  // Only these whole scripts are allowed; shell aliases and alternate paths cannot add work.
  const allowed = [
    "pnpm install --frozen-lockfile",
    nextCommand,
    adviceCommand,
    chromium,
    e2eCommand,
    'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
  ];
  const nextRuns = nextSteps.filter((s) => "run" in s).map((s) => s["run"]);
  require(nextRuns.length === allowed.length &&
    allowed.every(
      (command) => nextRuns.filter((run) => run === command).length === 1,
    ), "next runs exactly its install and five approved commands once each");
  const testStep = nextSteps.find((s) => s["run"] === nextCommand);
  require(testStep !== undefined, "next runs all its own tests with --shard and no exclusions");
  const shard = map(testStep?.["env"])["SHARD"];
  // E3. The one `if` the vitest step may carry. Without it an e2e leg asks vitest for `e2e-1/5`.
  require(compact(testStep?.["if"]) ===
    compact(`!${ON_E2E}`), "next's vitest step runs only on the numbered legs, and has no other guard");
  // A larger denominator leaves a share of the files on no machine; a smaller one fails a leg.
  require(typeof shard === "string" &&
    new RegExp(`^\\$\\{\\{\\s*matrix\\.shard\\s*\\}\\}/${VITEST_LEGS.length}$`).test(
      shard,
    ), "next's vitest step passes --shard <leg>/<the count of numbered legs>");
  require(compact(map(testStep?.["env"])["FILTER"]) ===
    "needs.changes.outputs.filter||'next/'", "next takes its path from filter, with the fallback next/");
  // E2. The same for the end-to-end step, over the count of e2e legs.
  const e2eStep = nextSteps.find((s) => s["run"] === e2eCommand);
  const e2eShard = map(e2eStep?.["env"])["SHARD"];
  require(typeof e2eShard === "string" &&
    new RegExp(`^\\$\\{\\{\\s*matrix\\.shard\\s*\\}\\}/${e2eCount}$`).test(
      e2eShard,
    ), "next's end-to-end step passes --shard <leg>/<the count of e2e legs>");

  // Both test steps narrow to the changed files on a pull request only. Any other value could narrow
  // the merge queue or main, where the whole suite is the backstop for what the import graph misses.
  // The vitest step also leaves it empty when the filter names the reader tests.
  for (const [step, name, expected] of [
    [testStep, "vitest", changedUnlessReaders],
    [e2eStep, "end-to-end", changedOnPullRequests],
  ] as const) {
    require(map(step?.["env"])["CHANGED"] ===
      expected, `next's ${name} step narrows with --changed on pull requests only`);
  }

  // E3. Both kinds of leg write next.json, so the advice comes after both test steps.
  const advice = nextSteps.find((s) => s["run"] === adviceCommand);
  require(testStep !== undefined &&
    e2eStep !== undefined &&
    advice !== undefined &&
    nextSteps.indexOf(testStep) < nextSteps.indexOf(advice) &&
    nextSteps.indexOf(e2eStep) < nextSteps.indexOf(advice) &&
    compact(advice["if"]) ===
      "!cancelled()", "next timing advice follows both test steps even after failure, unless cancelled");

  // E2 and E3. Chromium and the end-to-end runner only on the e2e legs, edges only on leg 1.
  for (const [command, leg, condition] of [
    [chromium, "the e2e legs", `${ON_E2E} && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''`],
    [e2eCommand, "the e2e legs", ON_E2E],
    [
      'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
      "leg 1",
      "matrix.shard == '1' && github.event_name == 'pull_request'",
    ],
  ] as const) {
    const matches = nextSteps.filter((s) => s["run"] === command);
    require(matches.length === 1 &&
      compact(matches[0]?.["if"]) ===
        compact(condition), `next runs ${command} once, only on ${leg}, with its pinned condition`);
  }

  return errors;
};

/** The root `package.json`'s lint script: it runs this check, and nothing of today's version (D6). */
export const lintManifest = (text: string): string[] => {
  let manifest: unknown;

  try {
    manifest = JSON.parse(text);
  } catch {
    return ["package.json: invalid JSON"];
  }

  const scripts = map(map(manifest)["scripts"]);
  const lint = String(scripts["lint"]);
  const errors: string[] = [];

  if (!lint.includes("node .github/ci/workflow-lint.ts")) {
    errors.push("pnpm lint must run workflow-lint.ts");
  }

  if (/lint:browser|browser-check|promises/.test(lint) || "lint:browser" in scripts || "promises" in scripts) {
    errors.push("D6: pnpm lint runs nothing of today's version: no lint:browser and no promises gate");
  }

  return errors;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const errors = lintWorkflow(read(".github/workflows/check.yaml"));

    errors.push(...lintManifest(read("package.json")));

    if (!read("oxlint-plugins/lint.ts").includes('import { checkTracked } from "./gitignore.mjs"')) {
      errors.push("full lint must use the shared tracked-file check");
    }

    if (existsSync(new URL("./pnpm-lock.yaml", import.meta.url))) {
      errors.push("CI uses the workspace lockfile, never a second one");
    }

    for (const error of errors) {
      console.error(error);
    }

    console.log(`workflow-lint: ${errors.length} errors`);
    process.exitCode = errors.length === 0 ? 0 : 1;
  } catch {
    console.error("workflow-lint: input could not be read");
    process.exitCode = 2;
  }
}

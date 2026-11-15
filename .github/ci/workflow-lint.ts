// Today's CI, serving both versions. Static workflow shape belongs in lint.
import { existsSync, readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ignored } from "./changes.mjs";
import { gated, gates } from "./required.mjs";

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const map = (value: unknown): Record<string, unknown> => (isMap(value) ? value : {});

/** Every step of a job, in order, the stop step included. */
const allSteps = (job: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(job["steps"]) ? job["steps"].filter(isMap) : [];

// Fail fast (ticket 990): every job but ci-required ends with this step. Once an earlier step
// failed, on a pull request or a merge queue group, it cancels the job's own run, so the jobs still
// running free their runners and ci-required, which a normal cancel leaves running, answers at once.
// A push to main runs to the end.
const STOP = {
  name: "stop the run",
  if: "failure()&&github.event_name!='push'",
  env: { GH_TOKEN: `\${{ github.token }}` },
  run: 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"',
};

/** The stop step exactly as STOP writes it, its `if` spaced any way, with nothing else on it. */
const isStop = (step: Record<string, unknown>) =>
  step["name"] === STOP.name &&
  compact(step["if"]) === STOP.if &&
  JSON.stringify(step["env"]) === JSON.stringify(STOP.env) &&
  step["run"] === STOP.run &&
  Object.keys(step).length === Object.keys(STOP).length;

/** A job's own work: its steps less the stop step, which the fail-fast law judges alone. */
const steps = (job: Record<string, unknown>): Record<string, unknown>[] =>
  allSteps(job).filter((step) => !isStop(step));

const commands = (job: Record<string, unknown>) =>
  steps(job).flatMap((step) =>
    typeof step["run"] === "string" ? step["run"].split("\n").map((line) => line.trim()) : [],
  );

const lines = (value: unknown) =>
  typeof value === "string"
    ? value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
    : [];

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

// Marking a draft ready starts the full run; only a new head cancels the run before it. Adding the
// `visual` label starts the same run with the visual legs (0536), and it cancels the one it repeats.
const TYPES = ["opened", "synchronize", "reopened", "ready_for_review", "labeled"];

const CANCEL =
  "github.event_name=='pull_request'&&(github.event.action=='synchronize'||(github.event.action=='labeled'&&github.event.label.name=='visual'))";

// A pull request that asked for its visual tests (0536). Only a pull request has labels, so this is
// false in the merge queue and on main.
const VISUAL_LABEL = "contains(github.event.pull_request.labels.*.name, 'visual')";
const BUILD = "needs.changes.outputs.build!='false'";
// The commit a run's change starts from, for vitest's `--changed`: a pull request's base, a merge
// queue group's base, or what main held before a push. All zeros (a first push) is no base.
const TEST_BASE = `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`;
const RATCHET = 'node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"';
// The token changes' classify step reads.
const TOKEN = `\${{ github.token }}`;
// The test job's two machines, for the tooling tests alone (check.yaml gives the seconds).
const TOOLING_LEGS = [1, 2];
// Today's version is frozen (0525, 0533), so every vitest call of the tooling tests, in the test job
// and on the schedule, runs the `tooling` project alone: next/ and the three trees of today's tests
// are projects of their own, and a project ignores `--exclude` (vitest.config.ts;
// workflow-lint.test.ts holds the tooling project's globs).
const TOOLING_PROJECT = "--project tooling";
const TOOLING_REPORT = '--reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/tooling.json"';

// The test job's one test step, whole: the tests that reach the change with a base, all of them
// without one, each on its machine's share. It runs on a pull request alone (0534).
const TOOLING = [
  'if [ -n "$BASE" ]; then',
  `pnpm exec vitest run ${TOOLING_PROJECT} --changed "$BASE" --shard "$SHARD" --passWithNoTests ${TOOLING_REPORT}`,
  "else",
  `pnpm exec vitest run ${TOOLING_PROJECT} --shard "$SHARD" --passWithNoTests ${TOOLING_REPORT}`,
  "fi",
];

const TEST_TIMES = 'node .github/ci/shard-times.ts "$RUNNER_TEMP/tooling.json"';
// Today's app: its package name, or its folder outside next/. No command in check.yaml runs it.
const TODAYS_APP = /fabrika-app-old|(?<!next\/)apps\/fabrika\b/;
// Today's promise checks: `pnpm promises`, however spelled, or its program by path. Their checks
// and planted breaks test today's pipeline code, so no command in check.yaml runs them (0533).
const TODAYS_PROMISES = /\bpnpm\s+(?:-\S+\s+|run\s+)*promises\b|packages\/promises\//;

// Chromium's OS packages come from apt, so the step first finds a mirror that answers (apt.sh).
const chromium =
  "sudo sh .github/ci/apt.sh update\n" + "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium\n";

// The next job's machines. Each is a string, so a workflow `if` compares a string with a string.
// The end-to-end legs `e2e-1` to `e2e-N` come first; the lint pins their shape, and the count law in
// vitest.shards.test.ts (E4) pins N from measured seconds. The matrix is changes' size step's
// `shards`, else its fallback: the full matrix on a pull request with the `visual` label, and the
// vitest legs alone everywhere else, the merge queue and main among them (0536, legs.ts).
const E2E_PREFIX = "e2e-";
const VITEST_LEGS = ["1", "2", "3", "4", "5"];
const ON_E2E = `startsWith(matrix.shard, '${E2E_PREFIX}')`;
// Chromium is fetched only once a visual file exists.
const VISUAL_FILES = "hashFiles('next/**/*.visual.test.ts', 'next/**/*.visual.test.tsx') != ''";
const FALLBACKS = /^fromJSON\(needs\.changes\.outputs\.shards\|\|\((.*)&&'(.*)'\|\|'(.*)'\)\)$/s;

const parsed = (text: string | undefined): unknown[] => {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

/**
 * next's matrix, `fromJSON(needs.changes.outputs.shards || (<when> && '<full>' || '<vitest legs>'))`:
 * when the full fallback runs, the full legs, and the other legs, numbers and strings kept apart.
 */
const fallbacks = (job: Record<string, unknown>) => {
  const found = FALLBACKS.exec(compact(map(map(job["strategy"])["matrix"])["shard"]));
  return { when: found?.[1] ?? "", full: parsed(found?.[2]), plain: parsed(found?.[3]) };
};

/** The full fallback's legs: what a pull request with the `visual` label runs unsized. */
const legs = (job: Record<string, unknown>): unknown[] => fallbacks(job).full;

/** The legs that run vitest: the ones written as a quoted whole number. */
const numbered = (all: readonly unknown[]): string[] =>
  all.filter((leg): leg is string => typeof leg === "string" && /^[1-9]\d*$/.test(leg));

/** The legs that run the end-to-end files: the ones written as `e2e-` and a whole number. */
const ends = (all: readonly unknown[]): string[] =>
  all.filter((leg): leg is string => typeof leg === "string" && /^e2e-[1-9]\d*$/.test(leg));

// When changes' size step sizes next: any run that tests all of next/, as the parser's pass left
// next and filter, a pull request, a merge queue group and a push to main alike (0534); legs.ts
// itself prints the full matrix for a run with no base commit. The setup also runs for the parser's
// pass, and reads the first pass alone.
const SIZED =
  "(steps.same.outputs.next||steps.diff.outputs.next)!='false'&&(steps.same.outputs.filter||steps.diff.outputs.filter)=='next/'";

const PROBE = "steps.diff.outputs.probe=='true'";
const SETUP = `${PROBE}||(steps.diff.outputs.next!='false'&&steps.diff.outputs.filter=='next/')`;

// changes' outputs from its size step, each beside the name legs.ts prints it under. `next` joins
// changes' own; `files` is a sized run's vitest list, the reader tests included, and `base` the
// commit its end-to-end legs narrow from (legs.ts).
const LEGS_OUTPUTS = [
  ["shards", "shards"],
  ["files", "files"],
  ["vitest-legs", "vitest"],
  ["e2e-legs", "e2e"],
  ["base", "base"],
] as const;

// The size step's base is the run's own: the pull request's, the merge queue group's, or what main
// held before the push (0534), the classify step's BASE.
const SIZE_ENV = {
  EVENT: `\${{ github.event_name }}`,
  FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/' }}`,
  BASE: env.BASE,
  VISUAL: `\${{ ${VISUAL_LABEL} }}`,
};

// The check job's flags (ticket 985): lint on check, field rows on field, the CI package's install
// when only rows changed.
const CHECK = "needs.changes.outputs.check!='false'";
// changes' flags from its first pass, each a job's or a step's.
// No flag starts today's tests or its app end to end, which run on no event (0525, 0533).
const FLAGS = ["check", "typecheck", "test", "field", "build"];
const ROWS = "!cancelled()&&needs.changes.outputs.field!='false'";
const ROWS_ALONE = "needs.changes.outputs.check=='false'";
const ROW_INSTALL = "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts";

// A leg's `--shard`: `${{ matrix.shard }}/${{ needs.changes.outputs.<kind>-legs || <full count> }}`, so a sized
// run divides by its own count of that kind, and every other run by the full matrix's.
const SHARD_OF = String.raw`\$\{\{\s*matrix\.shard\s*\}\}`;

const denominator = (kind: "vitest" | "e2e", full: number) =>
  String.raw`\$\{\{\s*needs\.changes\.outputs\.${kind}-legs\s*\|\|\s*${full}\s*\}\}`;

const nextJob = (text: string) => map(map(map(parse(text))["jobs"])["next"]);

/** The next job's full vitest legs in a workflow's text, for the law on how the table splits. */
export const vitestLegs = (text: string): string[] => numbered(legs(nextJob(text)));

/** The next job's full end-to-end legs in a workflow's text, for the law on how many there are. */
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

  // A pull request's one exclusion is changes.mjs's `ignored`: plan files and rows alone start no
  // run. GitHub compares the whole pull request with its base, so one more path starts it again.
  for (const trigger of [on, push, pr, queue]) {
    require(!["paths", "branches-ignore", "tags", "tags-ignore"].some((key) => key in trigger) &&
      (trigger === pr || !("paths-ignore" in trigger)), "no workflow path or branch exclusions");
  }

  require(JSON.stringify(pr["paths-ignore"]) ===
    JSON.stringify(ignored), "pull requests ignore exactly changes.mjs's ignored paths");
  // Each `*` is a name without a `/`, and no other wildcard is used, so the test's reading of a
  // pattern is GitHub's (its filter pattern cheat sheet).
  const skipped = pr["paths-ignore"];
  require(Array.isArray(skipped) &&
    skipped.every(
      (pattern) => typeof pattern === "string" && /^[\w.-]+(?:\/[\w.*-]+)+$/.test(pattern) && !pattern.includes("**"),
    ), "ignored paths use no wildcard but a single *");

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

  // A draft's check is lint alone: the build skips on changes' build flag.
  // F1. check also holds the field row check (ticket 985): its setup runs on any flag, its full
  // install and lint on the check flag, the CI package's install when only rows changed, and the
  // row check last, after any failure, on the field flag, so a red lint never hides red rows.
  const checkSteps = steps(map(jobs["check"]));
  const rows = checkSteps.filter((s) => s["run"] === "node .github/ci/field-check.ts");
  const rowInstall = checkSteps.filter((s) => s["run"] === ROW_INSTALL);

  for (const step of checkSteps) {
    const slow = step["run"] === "pnpm build";
    const setup = typeof step["uses"] === "string";
    const expected = slow ? BUILD : rows.includes(step) ? ROWS : rowInstall.includes(step) ? ROWS_ALONE : CHECK;
    require(setup
      ? !("if" in step)
      : compact(step["if"]) ===
          expected, "F1: check's lint steps run on the check flag, the build on build, the rows on field, its setup on every run");
  }

  require(rows.length === 1 &&
    rows[0] === checkSteps.at(-1) &&
    rows[0]?.["continue-on-error"] === undefined &&
    JSON.stringify(rows[0]?.["env"]) ===
      JSON.stringify(
        env,
      ), "F1: check runs the row check once, last, with the run's base, head and event, and its failure blocks");
  require(rowInstall.length === 1 &&
    checkSteps.some(
      (s) => s["run"] === "pnpm install --frozen-lockfile",
    ), "F1: check installs everything for lint, and only the CI package for rows alone");
  const checkout = checkSteps.find((s) => typeof s["uses"] === "string" && s["uses"].startsWith("actions/checkout@"));
  require(map(checkout?.["with"])["fetch-depth"] === 0, "F1: check checks out history, which the row check diffs");

  // 0524: a list file only shrinks. Without its one step a pull request could drop the ratchet and
  // pass with a grown list; a first push's zeros map to no base, as for the test steps.
  const ratchets = checkSteps.filter(
    (step) => typeof step["run"] === "string" && step["run"].includes("next/apps/fabrika/src/exam/ratchet"),
  );
  require(ratchets.length === 1 &&
    ratchets[0]?.["run"] === RATCHET &&
    compact(map(ratchets[0]?.["env"])["BASE"]) === compact(TEST_BASE) &&
    compact(ratchets[0]?.["if"]) === CHECK &&
    ratchets[0]?.["continue-on-error"] ===
      undefined, `check runs ${RATCHET} once, on the test base, and its failure blocks`);

  // Each gated job needs changes alone, and runs unless every flag it runs on is false
  // (required.mjs's `gates`): check on check or field rows, next on next, which already holds the
  // sizing.
  for (const name of gated) {
    const job = map(jobs[name]);
    const flags = gates[name].map((flag) => `needs.changes.outputs.${flag} != 'false'`).join(" || ");
    require(job["needs"] === "changes", `${name} needs changes`);
    require(compact(job["if"]) ===
      compact(
        `!cancelled() && (needs.changes.result != 'success' || ${flags})`,
      ), `${name} must run after classifier failure and skip only when its flags are false`);
  }

  // F3. legs and field are steps of changes and check now, so no job of either name comes back.
  require(!("legs" in jobs) &&
    !("field" in jobs), "F3: no legs or field job: changes sizes next, and check checks the rows");

  // A job with no limit runs for GitHub's 360 minute default when a step hangs (ticket 496).
  for (const [name, job] of Object.entries(jobs)) {
    const limit = map(job)["timeout-minutes"];
    require(typeof limit === "number" && limit > 0 && limit < 360, `${name} sets timeout-minutes`);
  }

  // Fail fast (ticket 990). F3: the stop step's token may cancel the run, and reads no more than
  // the checkout needs. ci-required never cancels, so its own map drops `actions`.
  require(JSON.stringify(workflow["permissions"]) ===
    JSON.stringify({
      actions: "write",
      contents: "read",
    }), "F3: the workflow's token grants actions: write and contents: read, nothing more");
  require(JSON.stringify(map(jobs["ci-required"])["permissions"]) ===
    JSON.stringify({ contents: "read" }), "F3: ci-required's token reads contents alone");

  for (const [name, job] of Object.entries(jobs).filter(([name]) => name !== "ci-required")) {
    const list = allSteps(map(job));
    const cancels = list.filter((step) => typeof step["run"] === "string" && step["run"].includes("run cancel"));
    // F1. Last, so `failure()` has seen every other step of the job. The one step that cancels, so
    // no second one can stop a push to main.
    require(list.length > 0 &&
      isStop(list.at(-1) ?? {}) &&
      cancels.length === 1, `F1: ${name} ends with the stop step, its one step that cancels the run`);
    // F2. A job on `always()` survives the cancel and holds its runner to the end. Only ci-required,
    // which gives the verdict, may.
    require(!compact(map(job)["if"]).includes(
      "always()",
    ), `F2: ${name} stops with its run: only ci-required runs on always()`);
    // F3. A job's own `permissions` replaces the workflow's whole map, and its stop step needs that one.
    require(!("permissions" in map(job)), `F3: ${name} keeps the workflow's token, which its stop step needs`);
  }

  // F4. A checkout keeps the token in .git/config unless told not to, where any test or install
  // script could read it, and that token may cancel and re-run this workflow. No job pushes, and the
  // fetches read a public repository, so no checkout needs it.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of allSteps(map(job)).filter(
      (s) => typeof s["uses"] === "string" && s["uses"].startsWith("actions/checkout@"),
    )) {
      require(map(step["with"])["persist-credentials"] ===
        false, `F4: ${name}'s checkout sets persist-credentials: false, so the token stays out of .git/config`);
    }
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

  for (const name of FLAGS) {
    require(compact(outputs[name]) === `steps.diff.outputs.${name}`, `changes exposes ${name}`);
  }

  // The plan for CI paths, slice 2: the parser's pass (`--same`) prints `next` and `filter` again
  // when it proved a next/ file is the same program, and the first pass's stand when it printed
  // nothing. Its install and its run may fail without failing changes, which would run everything
  // and turn ci-required red.
  require(compact(outputs["filter"]) ===
    "steps.same.outputs.filter||steps.diff.outputs.filter", "changes exposes filter from the parser's pass, else the first");
  // S1. The size step's `next` first: false when it picked no next/ test file, so next skips.
  require(compact(outputs["next"]) ===
    "steps.size.outputs.next||steps.same.outputs.next||steps.diff.outputs.next", "S1: changes exposes next from the size step, else the parser's pass, else the first");

  for (const [name, from] of LEGS_OUTPUTS) {
    require(compact(outputs[name]) === `steps.size.outputs.${from}`, `S1: changes exposes ${name} from the size step`);
  }

  const exposed = [...FLAGS, "next", "filter", ...LEGS_OUTPUTS.map(([name]) => name)].toSorted();
  require(JSON.stringify(Object.keys(outputs).toSorted()) ===
    JSON.stringify(exposed), "S1: changes exposes its flags, filter and the size step's outputs, and nothing else");

  const changeSteps = steps(changes);
  const same = changeSteps.find((s) => s["id"] === "same");
  require(same?.["run"] === "node .github/ci/changes.mjs --same" &&
    same["continue-on-error"] === true, "changes runs the parser's pass, and its failure fails nothing");

  for (const [key, expected] of Object.entries(classifier)) {
    require(map(same?.["env"])[key] === expected, `the parser's pass gets event ${key} through env`);
  }

  const sizing = changeSteps.find((s) => s["id"] === "size");

  for (const step of changeSteps.filter(
    (s) =>
      (typeof s["uses"] === "string" && /^(pnpm\/action-setup|actions\/setup-node)@/.test(s["uses"])) ||
      (typeof s["run"] === "string" && s["run"].startsWith("pnpm install")),
  )) {
    const forSizing = step["run"] === "pnpm install --frozen-lockfile --ignore-scripts";
    const before = forSizing ? sizing : same;
    require(step["continue-on-error"] === true &&
      before !== undefined &&
      changeSteps.indexOf(step) <
        changeSteps.indexOf(
          before,
        ), "the parser's setup comes before its pass, sizing's install before its size step, and their failure fails nothing");
    require(compact(step["if"]) ===
      (forSizing
        ? SIZED
        : compact(
            String(step["run"] ?? "").includes("--filter") ? PROBE : SETUP,
          )), "S1: changes' setup runs for the parser or for sizing, each install on its own guard");
  }

  // S1. The size step (legs.ts) runs after the parser's pass, on every run that tests all of next/:
  // a pull request, a merge queue group and a push to main (0534), so none of them runs the whole
  // suite. Under the reader filter it does not run, and next runs the reader tests. Its install and
  // its sizing may fail without failing changes, so a failure there is the full matrix, never a
  // skipped next.
  require(sizing !== undefined &&
    same !== undefined &&
    changeSteps.indexOf(same) < changeSteps.indexOf(sizing) &&
    sizing["run"] === "node .github/ci/legs.ts" &&
    sizing["continue-on-error"] === true &&
    compact(sizing["if"]) ===
      SIZED, "S1: changes sizes next with legs.ts after the parser's pass, on every run that tests all of next/, and fails open");

  for (const [key, expected] of Object.entries(SIZE_ENV)) {
    require(map(sizing?.["env"])[key] === expected, `S1: the size step gets ${key} through env`);
  }

  // The parser's own install: sizing's full install comes after the parser's pass, so it cannot
  // stand in for it.
  require(changeSteps.some(
    (s) => s["run"] === ROW_INSTALL && compact(s["if"]) === PROBE,
  ), "changes installs the parser for its pass");

  // M1. A push that a merge queue run already tested skips next (changes.mjs's
  // `tested`). The classify step asks GitHub with the job's own token, the workflow's (F3 holds
  // that map to actions and contents, and changes' stop step needs it whole), and it is the one step
  // in the workflow but the stop steps that gets the token.
  const classify = changeSteps.find((s) => s["id"] === "diff");
  require(map(classify?.["env"])["GITHUB_TOKEN"] === TOKEN, "M1: changes' classify step gets the token");
  require(Object.entries(jobs).every(([, job]) =>
    steps(map(job)).every((s) => s === classify || !/github\.token|secrets\.GITHUB_TOKEN/.test(JSON.stringify(s))),
  ), "M1: only changes' classify step gets the token");

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

  const list = steps(changes);
  require(list.some(
    (s) =>
      typeof s["uses"] === "string" &&
      s["uses"].startsWith("actions/checkout@") &&
      map(s["with"])["fetch-depth"] === 0 &&
      !("if" in s),
  ), "changes checks out history");
  require(classify?.["run"] === "node .github/ci/changes.mjs" &&
    !("if" in (classify ?? {})), "changes calls the classifier");

  for (const [key, expected] of Object.entries(classifier)) {
    require(map(classify?.["env"])[key] === expected, `changes passes event ${key} through env`);
  }

  // The test job runs the tooling tests alone, on two machines, on a pull request alone (0534).
  // Today's version is frozen (0525, 0533), so its tests run on no event: T1, with the outputs law
  // above and the app law below.
  const test = map(jobs["test"]),
    testSteps = steps(test);
  require(JSON.stringify(map(map(test["strategy"])["matrix"])["shard"]) ===
    JSON.stringify(TOOLING_LEGS), `T5: the test job runs on ${TOOLING_LEGS.length} machines, a plain list`);
  const tooling = testSteps.find((s) => s["name"] === "tooling tests");
  const times = testSteps.find((s) => s["name"] === "shard times");
  // T1. Only these whole scripts, each once: no step, flag or spelling adds today's tests.
  // Each script as its trimmed lines, so the shell's indenting is no part of it.
  const testAllowed = ["pnpm install --frozen-lockfile", TOOLING.join("\n"), TEST_TIMES];
  const testRuns = testSteps.filter((s) => "run" in s).map((s) => lines(s["run"]).join("\n"));
  require(testRuns.length === testAllowed.length &&
    testAllowed.every(
      (command) => testRuns.filter((run) => run === command).length === 1,
    ), "T1: the test job runs exactly its install, the tooling tests and shard times, once each");
  require(tooling !== undefined &&
    !("if" in tooling) &&
    map(tooling["env"])["SHARD"] === `\${{ matrix.shard }}/${TOOLING_LEGS.length}` &&
    compact(map(tooling["env"])["BASE"]) ===
      compact(
        TEST_BASE,
      ), "T4: the tooling tests run on every test run, their shard of two, on the pull request's, the group's or the push's base");
  require(times !== undefined &&
    times["run"] === TEST_TIMES &&
    compact(times["if"]) === "!cancelled()" &&
    tooling !== undefined &&
    testSteps.indexOf(tooling) <
      testSteps.indexOf(times), "T3: shard times follow the tooling tests, even after a failure");

  // T2 (0525, 0533). No job runs today's app, end to end or otherwise. T6 (0533): no step runs
  // today's promise checks.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of steps(map(job))) {
      require(![step["run"], step["working-directory"]].some(
        (text) => typeof text === "string" && TODAYS_APP.test(text),
      ), `T2: ${name} runs nothing of today's app`);
      require(!(
        typeof step["run"] === "string" && TODAYS_PROMISES.test(step["run"])
      ), `T6: ${name} runs no promise check of today's version`);
    }
  }

  const nextJob = map(jobs["next"]),
    strategy = map(nextJob["strategy"]),
    matrix = map(strategy["matrix"]),
    nextSteps = steps(nextJob);
  require(!("name" in nextJob), "next keeps the default matrix check names");
  // E1. The matrix is `fromJSON(needs.changes.outputs.shards || (<when> && '<full>' || '<vitest>'))`:
  // on a run that tests all of next/ from a base, changes' sized legs, else a fallback (E10). The
  // full one is the end-to-end legs
  // `e2e-1` to `e2e-N`, in order, then the vitest legs "1" to "5", all strings. The count N is E4's,
  // in vitest.shards.test.ts; here only its shape and its `/N`. The sized legs are legs.ts's
  // `shards`, the same shape cut shorter (legs.test.ts).
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
  // E10 (0536). The visual tests never start unasked: the full fallback runs only on a pull request
  // with the `visual` label, and every other unsized run, the merge queue and main among them, gets
  // the vitest legs alone; the schedule runs the visual tests. Plants, each run once on check.yaml
  // and restored: the full fallback alone, as before (red); `github.event_name == 'push' ||` beside
  // the label (red); the vitest fallback with e2e-1 (red).
  const { when, plain } = fallbacks(nextJob);
  require(compact(when) === compact(VISUAL_LABEL) &&
    JSON.stringify(plain) ===
      JSON.stringify(
        VITEST_LEGS,
      ), "E10: next's full fallback runs only with the visual label, else the vitest legs 1 to 5 alone");
  require(strategy["fail-fast"] === false, "next lets every shard finish");
  // The vitest step's paths, unquoted so each path is its own argument. On a sized run (a pull
  // request, a merge queue group or a push to main, 0534) changes' `files`: what `--changed` picked
  // and every reader test, each once (legs.ts), so the step takes no `--changed` of its own, which
  // would drop the readers again. Else the plan for CI paths, slice 2: `filter` from changes, the
  // reader tests or `next/`, and a missing filter runs all of next/.
  const nextCommand =
    'pnpm exec vitest run --project next $FILTER --shard "$SHARD" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"';
  // E11 (0536). The vitest step tests the `next` project alone, on every event: the merge line runs
  // the in-memory layer, and the schedule runs the real-resource one. A path filter alone finds a
  // file in any project, so the flag is what keeps `next-integration` out. Plants, each run once on
  // check.yaml and restored: `--project next` dropped (red); `--project next-integration` beside it
  // (red).
  // The leg `e2e-k` with SHARD `e2e-k/N` asks Vitest for shard `k/N` of the visual files, the
  // `next-visual` project. It takes no filter, so under the reader filter the e2e legs still run every
  // visual file the change reaches.
  const e2eCommand = `pnpm exec vitest run --project next-visual $CHANGED --shard "\${SHARD#e2e-}" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"`;
  const changedFromBase = `\${{ needs.changes.outputs.base && format('--changed={0} --passWithNoTests', needs.changes.outputs.base) || '' }}`;
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
  require(testStep !==
    undefined, "E11: next's vitest step runs the next project alone, with --shard and no exclusions");
  const shard = map(testStep?.["env"])["SHARD"];
  // E3. The one `if` the vitest step may carry. Without it an e2e leg asks vitest for `e2e-1/5`.
  require(compact(testStep?.["if"]) ===
    compact(`!${ON_E2E}`), "next's vitest step runs only on the numbered legs, and has no other guard");
  // A larger denominator leaves a share of the files on no machine; a smaller one fails a leg.
  require(typeof shard === "string" &&
    new RegExp(`^${SHARD_OF}/${denominator("vitest", VITEST_LEGS.length)}$`).test(
      shard,
    ), "next's vitest step passes --shard <leg>/<the count of numbered legs>");
  // The size step's list first, so a sized run runs the files it was sized with; changes' filter
  // after, so every other run keeps it. SHARD and FILTER are its whole env: a CHANGED here would
  // narrow the list again, past the readers.
  require(compact(map(testStep?.["env"])["FILTER"]) ===
    "needs.changes.outputs.files||needs.changes.outputs.filter||'next/'", "next's vitest step takes changes' files, else filter, with the fallback next/");
  require(JSON.stringify(Object.keys(map(testStep?.["env"])).toSorted()) ===
    JSON.stringify(["FILTER", "SHARD"]), "next's vitest step's env is SHARD and FILTER alone");
  // E2. The same for the end-to-end step, over the count of e2e legs.
  const e2eStep = nextSteps.find((s) => s["run"] === e2eCommand);
  const e2eShard = map(e2eStep?.["env"])["SHARD"];
  require(typeof e2eShard === "string" &&
    new RegExp(`^${SHARD_OF}/${denominator("e2e", e2eCount)}$`).test(
      e2eShard,
    ), "next's end-to-end step passes --shard <leg>/<the count of e2e legs>");

  // The end-to-end step narrows to the changed files from changes' `base`, the commit the size step
  // sized these legs from, and from nothing else: a run the size step did not size has no `base` and
  // runs every end-to-end file, so a failed sizing never narrows. The schedule runs them all.
  require(map(e2eStep?.["env"])["CHANGED"] ===
    changedFromBase, "next's end-to-end step narrows with --changed from changes' base alone");

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
    [chromium, "the e2e legs", `${ON_E2E} && ${VISUAL_FILES}`],
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

// The schedule (0534): scheduled.yaml runs all of next/ and every tooling test on main, and a red run
// opens one `ci-scheduled` issue. Half of the organization's 20 runners at most, so pull requests
// keep theirs.
const RUNNERS = 10;
const VERDICT = "report";
const REPORT_IF = "always()&&github.ref=='refs/heads/main'";
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
const WHOLE_TOOLING = `pnpm exec vitest run ${TOOLING_PROJECT} --shard "$SHARD" --passWithNoTests ${REPORTERS}`;
// The schedule's test depth (pull request 1274): its laws run their full case count.
const DEPTH = "full";

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

  // SC3. The stop steps' token may cancel the run; only the report may write issues, and it may
  // read runs to find the last green one.
  require(JSON.stringify(workflow["permissions"]) ===
    JSON.stringify({
      actions: "write",
      contents: "read",
    }), "SC3: the workflow's token grants actions: write and contents: read, nothing more");
  require(JSON.stringify(map(jobs[VERDICT])["permissions"]) ===
    JSON.stringify({
      actions: "read",
      contents: "read",
      issues: "write",
    }), "SC3: the report job's token reads actions and contents and writes issues, nothing more");

  for (const [name, job] of Object.entries(jobs).filter(([name]) => name !== VERDICT)) {
    require(!("permissions" in map(job)), `SC3: ${name} keeps the workflow's token, which its stop step needs`);
  }

  // SC4. The same fail-fast and token rules as check.yaml's F1, F2 and F4, with the report job as
  // the verdict: every other job ends with the stop step and runs on no `always()`, every job has a
  // time limit, and no checkout keeps the token in .git/config.
  for (const [name, job] of Object.entries(jobs)) {
    const limit = map(job)["timeout-minutes"];
    require(typeof limit === "number" && limit > 0 && limit < 360, `SC4: ${name} sets timeout-minutes`);

    for (const step of allSteps(map(job)).filter((s) => uses(s, "actions/checkout"))) {
      require(map(step["with"])["persist-credentials"] ===
        false, `SC4: ${name}'s checkout sets persist-credentials: false, so the token stays out of .git/config`);
    }

    if (name === VERDICT) {
      continue;
    }

    const list = allSteps(map(job));
    const cancels = list.filter((step) => typeof step["run"] === "string" && step["run"].includes("run cancel"));
    require(list.length > 0 &&
      isStop(list.at(-1) ?? {}) &&
      cancels.length === 1, `SC4: ${name} ends with the stop step, its one step that cancels the run`);
    require(!compact(map(job)["if"]).includes(
      "always()",
    ), `SC4: ${name} stops with its run: only the report runs on always()`);
  }

  // SC5. The report judges every other job, after any result, on main alone, with scheduled.mjs.
  // It is the one step but the stop steps that gets the token.
  const report = map(jobs[VERDICT]),
    others = Object.keys(jobs).filter((name) => name !== VERDICT);
  const needed = Array.isArray(report["needs"]) ? report["needs"] : [];
  require(needed.length === others.length &&
    others.every((name) => needed.includes(name)) &&
    compact(report["if"]) ===
      REPORT_IF, "SC5: the report needs every other job, and runs after any result, on main alone");
  const judged = steps(report).filter((s) => "run" in s);
  require(judged.length === 1 &&
    judged[0]?.["run"] === REPORT &&
    JSON.stringify(judged[0]?.["env"]) === JSON.stringify(REPORT_ENV) &&
    !("if" in (judged[0] ?? {})) &&
    judged[0]?.["continue-on-error"] ===
      undefined, `SC5: the report runs ${REPORT} once, with the needs, the results and the token, and its failure shows`);
  require(Object.values(jobs).every((job) =>
    steps(map(job)).every((s) => s === judged[0] || !/github\.token|secrets\./.test(JSON.stringify(s))),
  ), "SC5: only the report step and the stop steps get the token, and no step a secret");

  // SC6. At most RUNNERS machines: a matrix job counts its `max-parallel`, any other job one. Each
  // matrix sets it, lets every leg finish, and runs no more at once than it has legs.
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
          false, `SC6: ${name} sets max-parallel to at most its legs, and lets every leg finish`);
    }

    machines += "strategy" in job && typeof most === "number" ? most : 1;
  }

  require(machines <= RUNNERS, `SC6: its jobs take at most ${RUNNERS} machines at once, half of the 20 runners`);

  // SC7. All of next/ on check.yaml's full matrix, each leg's `/N` its kind's count, nothing
  // narrowed. A `--changed`, a `$FILTER` or a list would make it the merge line's selection again.
  const next = map(jobs["next"]),
    nextSteps = steps(next),
    legsOfCheck = legs(nextJob(check)),
    e2eCount = ends(legsOfCheck).length,
    vitestCount = numbered(legsOfCheck).length;
  require(legsOfCheck.length > 0 &&
    JSON.stringify(listed(next)) ===
      JSON.stringify(legsOfCheck), "SC7: next's legs are check.yaml's full matrix of next legs");
  const vitest = nextSteps.filter((s) => s["run"] === WHOLE_NEXT);
  const e2e = nextSteps.filter((s) => s["run"] === WHOLE_E2E);
  require(vitest.length === 1 &&
    compact(vitest[0]?.["if"]) === compact(`!${ON_E2E}`) &&
    map(vitest[0]?.["env"])["SHARD"] ===
      `\${{ matrix.shard }}/${vitestCount}`, "SC7: next runs vitest over the next and next-integration projects once, on the numbered legs, each its share of them");
  require(e2e.length === 1 &&
    compact(e2e[0]?.["if"]) === ON_E2E &&
    map(e2e[0]?.["env"])["SHARD"] ===
      `\${{ matrix.shard }}/${e2eCount}`, "SC7: next runs every visual file once, on the e2e legs, each its share of them");
  require(nextSteps.some(
    (s) => s["run"] === chromium && compact(s["if"]) === compact(`${ON_E2E} && ${VISUAL_FILES}`),
  ), "SC7: next fetches chromium on the e2e legs, once a visual file exists");

  // SC8. Every tooling test on the tooling job's legs, nothing narrowed.
  const tooling = map(jobs["tooling"]),
    toolingRuns = steps(tooling).filter((s) => s["run"] === WHOLE_TOOLING);
  require(toolingRuns.length === 1 &&
    map(toolingRuns[0]?.["env"])["SHARD"] === `\${{ matrix.shard }}/${listed(tooling).length}` &&
    JSON.stringify(listed(tooling)) ===
      JSON.stringify(
        Array.from({ length: listed(tooling).length }, (_, i) => i + 1),
      ), "SC8: tooling runs every tooling test once, its legs 1 to N, each its share of them");

  // SC9. The commands are only these: no step runs another test command or narrows one.
  const commandsOf = (job: Record<string, unknown>) =>
    steps(job).flatMap((s) => (typeof s["run"] === "string" ? [s["run"]] : []));
  require(JSON.stringify(commandsOf(next).toSorted()) ===
    JSON.stringify(["pnpm install --frozen-lockfile", WHOLE_NEXT, chromium, WHOLE_E2E].toSorted()) &&
    JSON.stringify(commandsOf(tooling).toSorted()) ===
      JSON.stringify(
        ["pnpm install --frozen-lockfile", WHOLE_TOOLING].toSorted(),
      ), "SC9: next and tooling run only their install and their whole-suite commands");

  // SC10. Each test job keeps its Vitest report after a red step, before its stop step, so the
  // report job can name the failing tests.
  for (const name of ["next", "tooling"]) {
    const list = steps(map(jobs[name]));
    const kept = list.filter(
      (s) => uses(s, "actions/upload-artifact") && map(s["with"])["path"] === `\${{ runner.temp }}/results.json`,
    );
    const last = list.findLastIndex((s) => typeof s["run"] === "string" && s["run"].includes(RESULTS));
    require(kept.length === 1 &&
      compact(kept[0]?.["if"]) === "!cancelled()" &&
      list.indexOf(kept[0] ?? {}) > last, `SC10: ${name} uploads its report after its tests, even after a red one`);
  }

  // SC11. Every test leg runs at full depth: a law that reads FABRIKA_TEST_DEPTH runs its full case
  // count here, and unset means `fast`, as on the merge line (pull request 1274).
  for (const command of [WHOLE_NEXT, WHOLE_E2E, WHOLE_TOOLING]) {
    const found = Object.values(jobs).flatMap((job) => steps(map(job)).filter((s) => s["run"] === command));
    require(found.length > 0 &&
      found.every(
        (s) => map(s["env"])["FABRIKA_TEST_DEPTH"] === DEPTH,
      ), `SC11: every step that runs ${command.split(" --shard")[0]} sets FABRIKA_TEST_DEPTH: ${DEPTH}`);
  }

  return errors;
};

/**
 * 0534's binding constraint: the only issues automation opens here are the scheduled report's. No
 * workflow but scheduled.yaml grants `issues` (or `write-all`), at the top or on a job; that one
 * grants it on its report job alone, which lintScheduled holds.
 */
export const lintIssues = (workflows: Readonly<Record<string, string>>): string[] =>
  Object.entries(workflows).flatMap(([path, text]) => {
    if (path.endsWith("/scheduled.yaml")) {
      return [];
    }

    let workflow: Record<string, unknown>;

    try {
      workflow = map(parse(text));
    } catch {
      return [`${path}: invalid YAML`];
    }

    const grants = [
      workflow["permissions"],
      ...Object.values(map(workflow["jobs"])).map((job) => map(job)["permissions"]),
    ];
    return grants.some((grant) => grant === "write-all" || (isMap(grant) && "issues" in grant))
      ? [`${path}: only scheduled.yaml's report job may touch issues (0534)`]
      : [];
  });

/** The files the cache lint reads, each as its text. */
export interface CacheFiles {
  /** Each workflow by its path, check.yaml among them. */
  readonly workflows: Readonly<Record<string, string>>;
  /** .github/actions/pnpm/action.yml, the one setup every pnpm job uses. */
  readonly action: string;
  readonly workspace: string;
  readonly typecheck: string;
}

// A cache is saved on main only: a pull request runs on refs/pull/<n>/merge and a merge queue group
// on gh-readonly-queue/main/..., so only a push to main has this ref here. Any ref can restore
// main's, and a copy per pull request or group filled the repository's 10 GB
// (.github/actions/pnpm/action.yml says when).
const ON_MAIN = "github.ref=='refs/heads/main'";
// scripts/typecheck.sh's buildinfo path, relative to each package.
const BUILDINFO = /"--tsBuildInfoFile",\s*"([^"]+)"/;
const TSC_HASH = "git ls-files -s pnpm-lock.yaml '*tsconfig*.json' | git hash-object --stdin";
const TSC_PREFIX = `tsc-\${{ runner.os }}-\${{ steps.tsc-key.outputs.hash }}-`;
const TSC_SAVED = `\${{ steps.tsc.outputs.cache-primary-key }}`;

const uses = (step: Record<string, unknown>, action: string) =>
  typeof step["uses"] === "string" && step["uses"].startsWith(`${action}@`);

export const lintCaches = (files: CacheFiles): string[] => {
  const errors: string[] = [];
  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(reason);
    }
  };
  let action: Record<string, unknown>, workspace: Record<string, unknown>;
  const workflows: [string, Record<string, unknown>][] = [];

  try {
    action = map(parse(files.action));
    workspace = map(parse(files.workspace));

    for (const [path, text] of Object.entries(files.workflows)) {
      workflows.push([path, map(parse(text))]);
    }
  } catch {
    return ["cache lint: a file is not valid YAML"];
  }

  const actionSteps = steps(map(action["runs"]));
  // Only a workflow that runs for a pull request or a merge queue group saves on a ref of its own.
  // mutation.yaml runs by hand on main, so its setup-node cache saves on main.
  const perRef = workflows.filter(([, workflow]) => {
    const on = workflow["on"];
    return ["pull_request", "merge_group"].some((event) =>
      Array.isArray(on) ? on.includes(event) : on === event || event in map(on),
    );
  });
  const everyStep: [string, Record<string, unknown>][] = [
    ...actionSteps.map((step) => [".github/actions/pnpm/action.yml", step] as [string, Record<string, unknown>]),
    ...perRef.flatMap(([path, workflow]) =>
      Object.values(map(workflow["jobs"])).flatMap((job) =>
        steps(map(job)).map((step) => [path, step] as [string, Record<string, unknown>]),
      ),
    ),
  ];

  // C1. Neither of these can be told to restore only: each saves from whatever ref it runs on.
  for (const [path, step] of everyStep) {
    require(!uses(step, "actions/cache"), `${path}: use actions/cache/restore, and actions/cache/save on main only`);
    require(!(
      uses(step, "actions/setup-node") && "cache" in map(step["with"])
    ), `${path}: setup-node's cache saves on every ref; use .github/actions/pnpm`);
  }

  // C2. The shared setup caches nothing: a restored pnpm store cost more than its download
  // (action.yml gives the seconds). Each save anywhere is on main.
  require(!actionSteps.some((step) =>
    String(step["uses"]).startsWith("actions/cache"),
  ), "the pnpm action caches nothing: a restored pnpm store cost more than its download");

  for (const [path, step] of everyStep.filter(([, s]) => uses(s, "actions/cache/save"))) {
    const condition = compact(step["if"]);
    require(condition === ON_MAIN ||
      condition.startsWith(`${ON_MAIN}&&`), `${path}: a cache save runs on main only, its if starting ${ON_MAIN}`);
  }

  const check = map(workflows.find(([path]) => path.endsWith("check.yaml"))?.[1]),
    jobs = map(check["jobs"]);

  // C3. A full-history checkout fetches every commit and tree, and only the head's files.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of steps(map(job)).filter((s) => uses(s, "actions/checkout"))) {
      const options = map(step["with"]);
      require(options["fetch-depth"] !== 0 ||
        options["filter"] ===
          "blob:none", `check.yaml: ${name}'s full-history checkout is blobless (filter: blob:none)`);
    }
  }

  // C4. The typecheck job's buildinfo cache. Its key and restore prefix both hold the lockfile and
  // every tsconfig, so a change to the compiler or its settings never starts from old answers; its
  // paths are where scripts/typecheck.sh writes, one per workspace package glob.
  const typecheckSteps = steps(map(jobs["typecheck"]));
  const buildinfo = BUILDINFO.exec(files.typecheck)?.[1];
  const folder = buildinfo?.slice(0, buildinfo.lastIndexOf("/"));
  const globs = Array.isArray(workspace["packages"]) ? workspace["packages"] : [];
  const paths = globs.map((glob) => `${String(glob)}/${folder}`);
  const keyStep = typecheckSteps.find((s) => s["id"] === "tsc-key");
  const restore = typecheckSteps.find((s) => s["id"] === "tsc");
  const save = typecheckSteps.find((s) => uses(s, "actions/cache/save") && map(s["with"])["key"] === TSC_SAVED);
  const at = (step: Record<string, unknown> | undefined) => (step === undefined ? -1 : typecheckSteps.indexOf(step));
  const install = typecheckSteps.find((s) => s["run"] === "pnpm install --frozen-lockfile");
  const run = typecheckSteps.find((s) => s["run"] === "pnpm typecheck");
  require(folder !== undefined && folder !== "", "scripts/typecheck.sh passes --tsBuildInfoFile under a folder");
  require(keyStep?.["run"] ===
    `echo "hash=$(${TSC_HASH})" >> "$GITHUB_OUTPUT"`, `check.yaml: the typecheck job's tsc-key step hashes ${TSC_HASH}`);
  require(restore !== undefined &&
    uses(restore, "actions/cache/restore") &&
    map(restore["with"])["key"] === `${TSC_PREFIX}\${{ github.sha }}` &&
    map(restore["with"])["restore-keys"] ===
      TSC_PREFIX, `check.yaml: the tsc cache's key is ${TSC_PREFIX}<sha>, and it restores only that prefix`);
  require(JSON.stringify(lines(map(restore?.["with"])["path"])) === JSON.stringify(paths) &&
    JSON.stringify(lines(map(save?.["with"])["path"])) ===
      JSON.stringify(
        paths,
      ), `check.yaml: the tsc cache restores and saves ${folder} in each pnpm-workspace.yaml package glob, in its order`);
  require(at(install) >= 0 &&
    at(install) < at(keyStep) &&
    at(keyStep) < at(restore) &&
    at(restore) < at(run) &&
    at(run) < at(save), "check.yaml: the typecheck job installs, restores the tsc cache, typechecks, then saves");

  return errors;
};

/** The checked-in files lintCaches reads, through a reader of repo-relative paths. */
export const cacheFiles = (read: (path: string) => string): CacheFiles => ({
  workflows: Object.fromEntries(
    globSync([".github/workflows/*.yaml", ".github/workflows/*.yml"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
    })
      .toSorted()
      .map((path) => [path, read(path)]),
  ),
  action: read(".github/actions/pnpm/action.yml"),
  workspace: read("pnpm-workspace.yaml"),
  typecheck: read("scripts/typecheck.sh"),
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const check = read(".github/workflows/check.yaml");
    const files = cacheFiles(read);
    const errors = [
      ...lintWorkflow(check),
      ...lintScheduled(read(".github/workflows/scheduled.yaml"), check),
      ...lintIssues(files.workflows),
      ...lintCaches(files),
    ];

    const manifest: unknown = JSON.parse(read("package.json"));

    const lint = String(map(map(manifest)["scripts"])["lint"]);

    if (!lint.includes("node .github/ci/workflow-lint.ts")) {
      errors.push("pnpm lint must run workflow-lint.ts");
    }

    // A pull request of ignored paths starts no run, so its rows are checked only here.
    if (!lint.includes("node .github/ci/field-check.ts --local")) {
      errors.push("pnpm lint must run field-check.ts --local: a pull request of rows alone starts no CI run");
    }

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

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { projects } from "../../vitest.config.ts";
import { ignored, jobs } from "./changes.mjs";
import { isFieldPath } from "./field-check.ts";
import { cacheFiles, lintCaches, lintWorkflow as lint } from "./workflow-lint.ts";

// Today's CI for both versions. Covers workflow-lint.ts. Each generated valid workflow
// also receives every listed plant, one at a time, so an unrelated error cannot mask it.
// T342: all 24 input plants were rejected in each of 100 generated workflows.
// A source plant ignoring next's required job condition failed this property too.
const options = { seed: 119120, numRuns: 100 };

const guard = (job: string) =>
  `\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${job} != 'false') }}`;

const env = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}`,
  HEAD: `\${{ github.event.pull_request.head.sha || github.sha }}`,
  EVENT: `\${{ github.event_name }}`,
};

const diff = {
  name: "classify",
  id: "diff",
  env: { ...env, DRAFT: `\${{ github.event.pull_request.draft }}` },
  run: "node .github/ci/changes.mjs",
};

// M1: only changes' classify step asks GitHub, with the job's token.
const token = `\${{ github.token }}`;
const classify = { ...diff, env: { ...diff.env, GITHUB_TOKEN: token } };

const build = `\${{ needs.changes.outputs.build != 'false' }}`;

// The test job's steps: a plant may give one an `if` or add one with no name.
type TestStep = { name?: string; if?: string; env?: Record<string, string>; run: string };
const testSteps = (list: TestStep[]) => list;

// The next job's steps: a plant may add one with no name, such as a second Vitest call.
type NextStep = {
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run: string;
  "working-directory"?: string;
};

// A test leg's time table and its timings upload, with the keys a plain step leaves out. The wiring
// below adds both to each test job, last before the stop step.
type Timed = Record<string, unknown> & {
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

const nextSteps = (list: NextStep[]) => list;

type StepOf<T> = T extends { steps: readonly (infer S)[] } ? S : never;

/**
 * The one step of `job` named `name`, so a plant never depends on where a step sits. Lookups by
 * position broke three times on 2026-11-14, each time a job gained a step. Throws when no step or
 * more than one has the name.
 */
const step = <W extends { jobs: object }, J extends keyof W["jobs"] & string>(
  w: W,
  job: J,
  name: string,
): StepOf<W["jobs"][J]> => {
  const steps = (w.jobs as Record<string, { steps: StepOf<W["jobs"][J]>[] }>)[job]!.steps;
  const found = steps.filter((s) => (s as { name?: unknown }).name === name);

  if (found.length !== 1) {
    throw new Error(`${job} has ${found.length} steps named "${name}"; a lookup needs exactly one`);
  }

  return found[0]!;
};

/** Where `job`'s step named `name` sits, for a plant that moves or removes it. */
const place = <W extends { jobs: object }, J extends keyof W["jobs"] & string>(w: W, job: J, name: string) =>
  (w.jobs as Record<string, { steps: unknown[] }>)[job]!.steps.indexOf(step(w, job, name));

// T5 before 0533: six machines for today's tests, two when only the tooling tests ran.
const todayLegs = `\${{ fromJSON(needs.changes.outputs.today == 'false' && '[1, 2]' || '[1, 2, 3, 4, 5, 6]') }}`;

const testEnv = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`,
};

// 0524, ticket 933 (L7): the check job's one ratchet step, which holds every list file to shrinking.
const ratchet = 'node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"';

// 0536: the tooling tests are the `tooling` project; next/ and today's trees are projects of their
// own, and a project ignores `--exclude`.
const toolingProject = "--project tooling";
const toolingReport = '--reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/tooling.json"';

// 0533: the test job's one test step, the tooling tests, on two machines and no flag.
const tooling = [
  'if [ -n "$BASE" ]; then',
  `  pnpm exec vitest run ${toolingProject} --changed "$BASE" --shard "$SHARD" --passWithNoTests ${toolingReport}`,
  "else",
  `  pnpm exec vitest run ${toolingProject} --shard "$SHARD" --passWithNoTests ${toolingReport}`,
  "fi",
  "",
].join("\n");

const testTimes = 'node .github/ci/shard-times.ts "$RUNNER_TEMP/tooling.json"';

// What changes exposed before 0533: the flags that started today's tests and its app end to end.
const todayFlags = ["today", "e2e"] as const;

// The e2e job as it was before 0533, with its own place in ci-required's needs and its stop step
// last (F1), so T2 alone names it.
const todaysE2e = (run: Record<string, string>) => (w: Workflow) => {
  Object.assign(w.jobs, {
    e2e: { needs: "changes", if: guard("e2e"), "timeout-minutes": 25, steps: [run, stop] },
  });
  w.jobs["ci-required"].needs.push("e2e");
};

const probe = "steps.diff.outputs.probe == 'true'";
// The check job's steps, each on its own flag (ticket 985): lint on check, the rows on field.
const checkFlag = `\${{ needs.changes.outputs.check != 'false' }}`;
const rowsFlag = `\${{ !cancelled() && needs.changes.outputs.field != 'false' }}`;
const rowsAlone = `\${{ needs.changes.outputs.check == 'false' }}`;
const rowInstall = "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts";

const name = fc.string({ maxLength: 20 });

// T967: the next job's legs are `e2e-1` to `e2e-N`, then "1" to "5". Only the shape is the lint's;
// N is E4's, in vitest.shards.test.ts, so the generated workflows below vary it.
const onE2e = "startsWith(matrix.shard, 'e2e-')";

const e2eCommand = `pnpm exec vitest run --project next-visual $CHANGED --shard "\${SHARD#e2e-}" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"`;

// 0536: the vitest step tests the `next` project alone, on every event.
const vitestCommand =
  'pnpm exec vitest run --project next $FILTER --shard "$SHARD" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"';

// 0536: a pull request that asked for its visual tests.
const visualLabel = "contains(github.event.pull_request.labels.*.name, 'visual')";

// Chromium is fetched only once a visual file exists.
const visualFiles = "hashFiles('next/**/*.visual.test.ts', 'next/**/*.visual.test.tsx') != ''";

// 0534: the end-to-end legs narrow from changes' `base`, the commit the size step sized them from, on
// every run it sized: a pull request, a merge queue group and a push to main alike.
const changedFromBase = `\${{ needs.changes.outputs.base && format('--changed={0} --passWithNoTests', needs.changes.outputs.base) || '' }}`;

// Before 0534: on a pull request only, so the merge queue and main ran every end-to-end file.
const changedOnPullRequests = `\${{ github.event_name == 'pull_request' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;

// The vitest step's paths: changes' size step's list on a sized run, reader tests included, else changes'
// filter (the plan for CI paths, slice 2), else all of next/.
const vitestFilter = `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'next/' }}`;

// What 1230 gave the vitest step: `--changed` on a pull request whose filter is all of next/.
const changedUnlessReaders = `\${{ github.event_name == 'pull_request' && (needs.changes.outputs.filter || 'next/') == 'next/' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;

const nextLegs = (count: number) => [
  ...Array.from({ length: count }, (_, i) => `e2e-${i + 1}`),
  "1",
  "2",
  "3",
  "4",
  "5",
];

// S1: the matrix is changes' `shards`, else a fallback (legs.ts): the full matrix on a pull request
// with the `visual` label, the vitest legs alone everywhere else (0536, E10).
const sizedLegs = (legs: readonly unknown[], plain: readonly unknown[] = ["1", "2", "3", "4", "5"]) =>
  `\${{ fromJSON(needs.changes.outputs.shards || (${visualLabel} && '${JSON.stringify(legs)}' || '${JSON.stringify(plain)}')) }}`;

/** The full matrix a workflow's next job falls back to, as `sizedLegs` wrote it. */
const legsOf = (w: { jobs: { next: { strategy: { matrix: { shard: string } } } } }): unknown[] =>
  JSON.parse(/&& '(.*?)' \|\|/s.exec(w.jobs.next.strategy.matrix.shard)?.[1] ?? "[]");

const setLegs = (w: { jobs: { next: { strategy: { matrix: { shard: string } } } } }, legs: readonly unknown[]) => {
  w.jobs.next.strategy.matrix.shard = sizedLegs(legs);
};

// A leg's `--shard`: its own kind's count from changes' size step, else the full matrix's.
const vitestShard = (gap = " ") =>
  `\${{${gap}matrix.shard${gap}}}/\${{${gap}needs.changes.outputs.vitest-legs || 5${gap}}}`;

const e2eShard = (count: number | string, gap = " ") =>
  `\${{${gap}matrix.shard${gap}}}/\${{${gap}needs.changes.outputs.e2e-legs || ${count}${gap}}}`;

// S1: changes' sizing install and size step run only when it sizes next; its setup also for the parser.
const sized =
  "(steps.same.outputs.next || steps.diff.outputs.next) != 'false' && (steps.same.outputs.filter || steps.diff.outputs.filter) == 'next/'";

const toolsFor = `${probe} || (steps.diff.outputs.next != 'false' && steps.diff.outputs.filter == 'next/')`;

// Fail fast (ticket 990, F1 to F3): the step every job but ci-required ends with. On a pull request
// or a merge queue group, once an earlier step failed, it cancels the run; ci-required's `always()`
// keeps it running through a normal cancel. A push to main runs to the end.
const stop = {
  name: "stop the run",
  if: `\${{ failure() && github.event_name != 'push' }}`,
  env: { GH_TOKEN: `\${{ github.token }}` },
  run: 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"',
};

// Every job that carries the stop step: all of them but ci-required.
const stopping = ["changes", "check", "typecheck", "test", "next"] as const;

// TT1 and TT2: each test leg's time table, the job's last command, reading its own report and its
// own job's steps with the token; then its timings file's upload. Both on every result, and neither
// fails the job.
const timeTable = (report: string): Timed => ({
  name: "time table",
  if: "always()",
  "continue-on-error": true,
  "timeout-minutes": 1,
  env: {
    GITHUB_TOKEN: token,
    JOB_ID: `\${{ job.check_run_id }}`,
    HEAD: env.HEAD,
    LEG: `\${{ matrix.shard }}`,
    REPORT: `\${{ runner.temp }}/${report}`,
  },
  run: "node .github/ci/time-table.ts",
});

// M1: a step outside the test jobs with the time table's command, the token and a loader that runs
// any file first. Only the test jobs' exact table step may have the token.
const loader = "--import ./x.mjs";

const tableElsewhere = (): Timed => ({
  run: "node .github/ci/time-table.ts",
  env: { GITHUB_TOKEN: token, NODE_OPTIONS: loader },
});

const timings = (): Timed => ({
  name: "timings",
  if: "always()",
  "continue-on-error": true,
  "timeout-minutes": 1,
  uses: "actions/upload-artifact@v7",
  with: {
    name: `timings-\${{ github.job }}-\${{ matrix.shard }}-attempt-\${{ github.run_attempt }}`,
    path: `\${{ runner.temp }}/timings-\${{ github.job }}-\${{ matrix.shard }}.json`,
    "if-no-files-found": "warn",
    "retention-days": 90,
  },
});

const valid = (label: string, extra: string) => ({
  name: label,
  permissions: { actions: "write", contents: "read" } as unknown,
  on: {
    push: { branches: ["main"] },
    pull_request: {
      types: ["opened", "synchronize", "reopened", "ready_for_review", "labeled"],
      "paths-ignore": [...ignored] as string[] | undefined,
    },
    merge_group: { types: ["checks_requested"] },
  },
  concurrency: {
    group: `check-\${{ github.event.pull_request.number || github.sha }}`,
    "cancel-in-progress": `\${{ github.event_name == 'pull_request' && (github.event.action == 'synchronize' || (github.event.action == 'labeled' && github.event.label.name == 'visual')) }}`,
  },
  jobs: {
    changes: {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 5,
      outputs: {
        ...Object.fromEntries(
          ["check", "typecheck", "test", "field", "build"].map((key) => [key, `\${{ steps.diff.outputs.${key} }}`]),
        ),
        // The plan for CI paths, slice 2: the parser's pass prints these two again, and the size step
        // prints next once more.
        next: `\${{ steps.size.outputs.next || steps.same.outputs.next || steps.diff.outputs.next }}`,
        filter: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter }}`,
        shards: `\${{ steps.size.outputs.shards }}`,
        files: `\${{ steps.size.outputs.files }}`,
        "vitest-legs": `\${{ steps.size.outputs.vitest }}`,
        "e2e-legs": `\${{ steps.size.outputs.e2e }}`,
        base: `\${{ steps.size.outputs.base }}`,
      } as Record<string, string>,
      steps: [
        { name: "checkout", uses: "actions/checkout@v7", with: { "fetch-depth": 0, "persist-credentials": false } },
        classify,
        { name: "skills check", run: "sh .agents/skills/lead/scripts/skillscheck.sh", if: "!cancelled()" },
        { name: "tracked files", run: "node oxlint-plugins/gitignore.mjs", if: "!cancelled()" },
        { name: extra, run: "echo checked" },
        // The parser's setup and pass, only when every changed line looks like a comment.
        {
          name: "parser pnpm",
          uses: "pnpm/action-setup@v6",
          if: toolsFor,
          "continue-on-error": true,
          with: { run_install: false },
        },
        {
          name: "parser node",
          uses: "actions/setup-node@v7",
          if: toolsFor,
          "continue-on-error": true,
          with: { "node-version": "26.13.0" },
        },
        {
          name: "parser install",
          run: "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts",
          if: probe,
          "continue-on-error": true,
        },
        {
          ...diff,
          name: "parser pass",
          id: "same",
          if: probe,
          "continue-on-error": true,
          run: "node .github/ci/changes.mjs --same",
        },
        {
          name: "install for sizing",
          run: "pnpm install --frozen-lockfile --ignore-scripts",
          if: sized,
          "continue-on-error": true,
        },
        {
          name: "size",
          id: "size",
          if: sized,
          "continue-on-error": true,
          env: {
            EVENT: `\${{ github.event_name }}`,
            FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/' }}`,
            BASE: env.BASE,
            VISUAL: `\${{ ${visualLabel} }}`,
          },
          run: "node .github/ci/legs.ts",
        },
        // Q1: a ready pull request run's record of the tree it tests, for the merge queue.
        {
          name: "record",
          id: "record",
          if: "github.event_name == 'pull_request' && !github.event.pull_request.draft",
          "continue-on-error": true,
          env: {
            ...diff.env,
            TESTED: `\${{ github.sha }}`,
            ...Object.fromEntries(
              ["check", "typecheck", "test", "field", "build"].map((key) => [
                key.toUpperCase(),
                `\${{ steps.diff.outputs.${key} }}`,
              ]),
            ),
            NEXT: `\${{ steps.size.outputs.next || steps.same.outputs.next || steps.diff.outputs.next }}`,
            FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter }}`,
          } as Record<string, string>,
          run: "node .github/ci/changes.mjs --record",
        },
        {
          name: "upload the record",
          if: "steps.record.outputs.name != ''",
          "continue-on-error": true,
          uses: "actions/upload-artifact@v7",
          with: {
            name: `\${{ steps.record.outputs.name }}`,
            path: `\${{ runner.temp }}/tested.json`,
            "retention-days": 1,
            overwrite: true,
            "if-no-files-found": "error",
          } as Record<string, unknown>,
        },
      ] as Record<string, unknown>[],
    },
    check: {
      name: `\${{ github.event.pull_request.draft && 'lint' || 'check' }}`,
      needs: "changes",
      if: `${guard("check").slice(0, -4)} || needs.changes.outputs.field != 'false') }}`,
      "timeout-minutes": 10,
      steps: [
        { name: "checkout", uses: "actions/checkout@v7", with: { "fetch-depth": 0, "persist-credentials": false } },
        { name: "install", if: checkFlag, run: "pnpm install --frozen-lockfile" },
        { name: "install the row check", if: rowsAlone, run: rowInstall },
        { name: "lint", if: checkFlag, run: "pnpm lint" },
        { name: "build", run: "pnpm build", if: build },
        { name: "lists only shrink", if: checkFlag, env: testEnv, run: ratchet },
        { name: "field rows", if: rowsFlag, env, run: "node .github/ci/field-check.ts" },
      ] as Record<string, unknown>[],
    },
    typecheck: {
      needs: "changes",
      if: guard("typecheck"),
      "timeout-minutes": 10,
      steps: [
        { name: "install", run: "pnpm install --frozen-lockfile" },
        { name: "typecheck", run: "pnpm typecheck" },
      ],
    },
    test: {
      needs: "changes",
      if: guard("test"),
      "timeout-minutes": 30,
      strategy: { "fail-fast": false, matrix: { shard: [1, 2] as unknown } },
      steps: testSteps([
        { name: "install", run: "pnpm install --frozen-lockfile" },
        { name: "tooling tests", env: { ...testEnv, SHARD: `\${{ matrix.shard }}/2` }, run: tooling },
        { name: "shard times", if: "!cancelled()", run: testTimes },
      ]),
    },
    next: {
      needs: "changes" as string | string[],
      if: guard("next"),
      "timeout-minutes": 17,
      strategy: { "fail-fast": false, matrix: { shard: sizedLegs(nextLegs(2)) } },
      steps: nextSteps([
        {
          name: "vitest",
          run: vitestCommand,
          if: `!${onE2e}`,
          env: { SHARD: vitestShard(), FILTER: vitestFilter },
        },
        {
          name: "chromium",
          if: `${onE2e} && ${visualFiles}`,
          run:
            "sudo sh .github/ci/apt.sh update\n" +
            "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium\n",
        },
        {
          name: "end to end",
          run: e2eCommand,
          if: onE2e,
          env: { SHARD: e2eShard(2), CHANGED: changedFromBase },
        },
        {
          name: "edges",
          if: "matrix.shard == '1' && github.event_name == 'pull_request'",
          env: { BASE: `\${{ github.event.pull_request.base.sha }}` },
          run: 'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
        },
        { name: "install", run: "pnpm install --frozen-lockfile" },
        { name: "shard times", if: "!cancelled()", run: 'node .github/ci/shard-times.ts "$RUNNER_TEMP/next.json"' },
      ]),
    },
    "ci-required": {
      name: `\${{ github.event.pull_request.draft && 'ci-required (draft)' || 'ci-required' }}`,
      needs: ["changes", "check", "typecheck", "test", "next"],
      if: "always()",
      "timeout-minutes": 5,
      permissions: { contents: "read" } as unknown,
      steps: [
        {
          name: "checkout",
          uses: "actions/checkout@v7",
          with: { "sparse-checkout": ".github/ci", "persist-credentials": false },
        },
        { name: "judge", env: { NEEDS: `\${{ toJSON(needs) }}` }, run: "node .github/ci/required.mjs" },
      ] as Record<string, unknown>[],
    },
  },
});

type Workflow = ReturnType<typeof valid>;

/** A job's steps as one plain list, whatever its own step type. */
const stepsOf = (w: Workflow, job: (typeof stopping)[number] | "ci-required"): Record<string, unknown>[] =>
  w.jobs[job].steps as Record<string, unknown>[];

const wiring = fc
  .tuple(name, name, fc.boolean(), fc.constantFrom("", " ", "  ", "\t", "\n"), fc.integer({ min: 1, max: 4 }))
  .map(([label, extra, whitespace, gap, e2es]) => {
    const clean = valid(label, extra);
    // E1 and E2: any count of e2e legs is the lint's shape, with its own `/N` on the end-to-end step.
    setLegs(clean, nextLegs(e2es));
    step(clean, "next", "end to end").env!.SHARD = e2eShard(e2es);

    if (whitespace) {
      step(clean, "next", "vitest").env!.SHARD = vitestShard(gap);
      step(clean, "next", "end to end").env!.SHARD = e2eShard(e2es, gap);

      // The vitest step's guard and the three leg conditions, respaced around each operator.
      for (const guarded of ["vitest", "chromium", "end to end", "edges"].map((n) => step(clean, "next", n))) {
        guarded.if = `\${{${gap}${guarded.if?.replace(/ *(==|!=|&&) */g, `${gap}$1${gap}`)}${gap}}}`;
      }

      step(clean, "next", "shard times").if = `\${{${gap}!cancelled()${gap}}}`;
    }

    // TT1 and TT2: each test job ends its commands with its time table, then uploads its timings.
    stepsOf(clean, "test").push(timeTable("tooling.json"), timings());
    stepsOf(clean, "next").push(timeTable("next.json"), timings());

    // F1: the stop step comes last in every job but ci-required, after every step added above, its
    // `if` spaced as the rest.
    for (const job of stopping) {
      const step = structuredClone(stop);

      if (whitespace) {
        step.if = `\${{${gap}failure()${gap}&&${gap}github.event_name${gap}!=${gap}'push'${gap}}}`;
      }

      stepsOf(clean, job).push(step);
    }

    return clean;
  });

// Pinned T376 second-review bypasses, also applied to every generated valid workflow.
const extraCommands = [
  { run: "pnpm test next/" },
  { run: "pnpm run test" },
  { run: 'pnpm exec vi""test run next/' },
  { run: "cd next/apps/fabrika && node e2e.ts" },
  { run: "node e2e.ts", "working-directory": "next/apps/fabrika" },
  { run: "pnpm --filter @kampus/fabrika exec node e2e.ts" },
  { run: 'node next/apps/fabrika/src/exam/../exam/edges.ts --base "$BASE"' },
  { run: 'cd next/apps/fabrika/src/exam && node edges.ts --base "$BASE"' },
  { run: "npx playwright@latest install chromium" },
  { run: "pnpm --filter @kampus/fabrika exec playwright -- install chromium" },
];

it.each(extraCommands)("pinned: T376 review extra command in real workflow: $run", (added) => {
  const workflow = parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(workflow))).toEqual([]);
  workflow.jobs.next.steps.push(added);
  expect(lint(JSON.stringify(workflow))).not.toEqual([]);
});

/** changes' record step's env, for a plant that changes one value. */
const recordEnv = (w: Workflow) => step(w, "changes", "record")["env"] as Record<string, string>;

/** changes' upload of the record, for a plant that changes one input. */
const uploadWith = (w: Workflow) => step(w, "changes", "upload the record")["with"] as Record<string, unknown>;

const plants: [string, (workflow: Workflow) => void][] = [
  // Q1: a ready pull request run records the tree it tests and what changes printed, and uploads it
  // under the name it printed, and neither step fails the run. Each plant here would let the record
  // say more than the run tested, or let a broken record fail a pull request. Each of Q1's checks in
  // workflow-lint.ts was also planted out once and turned these red; dropping the record env's key
  // set survived until the "one more value" plant.
  ["Q1: the record step is gone", (w) => w.jobs.changes.steps.splice(place(w, "changes", "record"), 1)],
  [
    "Q1: the record step runs on drafts too",
    (w) => (step(w, "changes", "record")["if"] = "github.event_name == 'pull_request'"),
  ],
  ["Q1: the record step runs on every event", (w) => Reflect.deleteProperty(step(w, "changes", "record"), "if")],
  [
    "Q1: a failed record fails the run",
    (w) => Reflect.deleteProperty(step(w, "changes", "record"), "continue-on-error"),
  ],
  [
    "Q1: the record step runs before the size step",
    (w) => {
      const [moved] = w.jobs.changes.steps.splice(place(w, "changes", "record"), 1);
      w.jobs.changes.steps.splice(place(w, "changes", "size"), 0, moved!);
    },
  ],
  ["Q1: the record names the branch's head, not the merge commit", (w) => (recordEnv(w)["TESTED"] = env.HEAD)],
  [
    "Q1: the record reads next from the first pass, not the size step",
    (w) => (recordEnv(w)["NEXT"] = `\${{ steps.diff.outputs.next }}`),
  ],
  [
    "Q1: the record reads filter from the first pass, not the parser's",
    (w) => (recordEnv(w)["FILTER"] = `\${{ steps.diff.outputs.filter }}`),
  ],
  ["Q1: the record says check ran", (w) => (recordEnv(w)["CHECK"] = "true")],
  ["Q1: the record loses its build flag", (w) => Reflect.deleteProperty(recordEnv(w), "BUILD")],
  ["Q1: the record step gets the token", (w) => (recordEnv(w)["GITHUB_TOKEN"] = token)],
  [
    "Q1: the record step reads one more value than changes exposes",
    (w) => (recordEnv(w)["RUNNER_TEMP"] = `\${{ github.workspace }}`),
  ],
  ["Q1: the record's upload is gone", (w) => w.jobs.changes.steps.splice(place(w, "changes", "upload the record"), 1)],
  [
    "Q1: the upload comes before the record",
    (w) => {
      const [moved] = w.jobs.changes.steps.splice(place(w, "changes", "upload the record"), 1);
      w.jobs.changes.steps.splice(place(w, "changes", "record"), 0, moved!);
    },
  ],
  ["Q1: the upload runs with no name", (w) => Reflect.deleteProperty(step(w, "changes", "upload the record"), "if")],
  [
    "Q1: a failed upload fails the run",
    (w) => Reflect.deleteProperty(step(w, "changes", "upload the record"), "continue-on-error"),
  ],
  ["Q1: the upload takes a fixed name", (w) => (uploadWith(w)["name"] = "tested")],
  ["Q1: the upload keeps the record forever", (w) => Reflect.deleteProperty(uploadWith(w), "retention-days")],
  ["Q1: a rerun's upload fails on the name its first attempt left", (w) => (uploadWith(w)["overwrite"] = false)],
  [
    "Q1: a second upload of the record",
    (w) => {
      const upload = structuredClone(step(w, "changes", "upload the record"));
      w.jobs.changes.steps.splice(place(w, "changes", "upload the record") + 1, 0, upload);
    },
  ],
  // Q1: every job tests the tree the record names, `github.sha`'s, so no checkout is told another
  // commit or repository; and the record's upload is the only upload, since `matched` trusts any
  // artifact of the record's name.
  ...(
    [
      ["changes", "ref", `\${{ github.event.pull_request.head.sha }}`],
      ["check", "ref", `\${{ github.event.pull_request.head.ref }}`],
      ["check", "repository", `\${{ github.event.pull_request.head.repo.full_name }}`],
      ["ci-required", "ref", "main"],
    ] as const
  ).map(([job, key, value]): [string, (w: Workflow) => void] => [
    `Q1: ${job}'s checkout is told its ${key}`,
    (w) => {
      const checkout = stepsOf(w, job).find((s) => String(s["uses"]).startsWith("actions/checkout@"))!;
      (checkout["with"] as Record<string, unknown>)[key] = value;
    },
  ]),
  ...(["typecheck", "test", "next"] as const).map((job): [string, (w: Workflow) => void] => [
    `Q1: ${job} checks out the branch's head`,
    (w) => {
      stepsOf(w, job).unshift({
        name: "checkout",
        uses: "actions/checkout@v7",
        with: { ref: `\${{ github.event.pull_request.head.sha }}`, "persist-credentials": false },
      });
    },
  ]),
  [
    "Q1: next uploads an artifact too",
    (w) => {
      const upload = { name: "results", uses: "actions/upload-artifact@v7", with: { name: "next", path: "next.json" } };
      stepsOf(w, "next").splice(place(w, "next", "shard times"), 0, upload);
    },
  ],
  [
    "Q1: check uploads an artifact with another owner's action",
    (w) => {
      const upload = { name: "upload", uses: "someone/upload-artifact@v1", with: { name: "tested-a-b", path: "x" } };
      stepsOf(w, "check").splice(place(w, "check", "field rows"), 0, upload);
    },
  ],
  // M1: a push the merge queue already tested asks GitHub from changes' classify step alone. The
  // token is the workflow's (F3's plants hold its map), since changes' stop step needs it whole.
  [
    "M1: classify has no token",
    (w) => delete (step(w, "changes", "classify").env as Record<string, string>)["GITHUB_TOKEN"],
  ],
  [
    "M1: classify takes the token from secrets",
    (w) =>
      ((step(w, "changes", "classify").env as Record<string, string>)["GITHUB_TOKEN"] = `\${{ secrets.GITHUB_TOKEN }}`),
  ],
  [
    "M1: the parser's pass gets the token too",
    (w) => ((step(w, "changes", "parser pass").env as Record<string, string>)["GITHUB_TOKEN"] = token),
  ],
  [
    "M1: the row check gets the token too",
    (w) => ((step(w, "check", "field rows").env as Record<string, string>)["GITHUB_TOKEN"] = token),
  ],
  // 0134's amendment (2026-11-11): a draft runs the fast jobs, and marking it ready runs the rest.
  // 0536: `labeled` is how the `visual` label starts the visual legs.
  ...["opened", "synchronize", "reopened", "ready_for_review", "labeled"].map(
    (type): [string, (w: Workflow) => void] => [
      `pull requests lose the ${type} trigger`,
      (w) => {
        w.on.pull_request.types = w.on.pull_request.types.filter((t) => t !== type);
      },
    ],
  ),
  // Ticket 988: a pull request ignores exactly changes.mjs's `ignored`, and no other trigger ignores
  // a path.
  [
    "pull requests ignore one more path",
    (w) => {
      w.on.pull_request["paths-ignore"] = [...ignored, "apps/**"];
    },
  ],
  [
    "pull requests ignore one path fewer",
    (w) => {
      w.on.pull_request["paths-ignore"] = ignored.slice(1);
    },
  ],
  [
    "pull requests lose the ignore list",
    (w) => {
      // JSON.stringify leaves an undefined key out, as a deleted one.
      w.on.pull_request["paths-ignore"] = undefined;
    },
  ],
  [
    "pull requests ignore every plan file, a brief folder's included",
    (w) => {
      w.on.pull_request["paths-ignore"] = ["docs/plan/**", ...ignored.slice(2)];
    },
  ],
  [
    "a push to main ignores the same paths",
    (w) => {
      Object.assign(w.on.push, { "paths-ignore": [...ignored] });
    },
  ],
  [
    "the merge queue's group ignores the same paths",
    (w) => {
      Object.assign(w.on.merge_group, { "paths-ignore": [...ignored] });
    },
  ],
  [
    "the merge queue's group stops running the checks",
    (w) => {
      delete (w.on as Record<string, unknown>)["merge_group"];
    },
  ],
  [
    "every pull request event cancels the run before it",
    (w) => {
      w.concurrency["cancel-in-progress"] = `\${{ github.event_name == 'pull_request' }}`;
    },
  ],
  [
    "a draft's check keeps the name check",
    (w) => {
      w.jobs.check.name = "check";
    },
  ],
  [
    "a draft's ci-required keeps the name ci-required",
    (w) => {
      w.jobs["ci-required"].name = "ci-required";
    },
  ],
  [
    "the build runs on a draft",
    (w) => {
      delete step(w, "check", "build")["if"];
    },
  ],
  [
    "the build skips on the check flag",
    (w) => {
      step(w, "check", "build")["if"] = `\${{ needs.changes.outputs.check != 'false' }}`;
    },
  ],
  // 0533: the promises gate tests today's pipeline code, so no step runs it, under any spelling or
  // flag. Source plant, run once on workflow-lint.ts and restored: drop T6's check (red: the five
  // check plants with no `if`, and the real-file scenario below). The one on the build flag and the
  // test job's are also held by the build-flag law and T1.
  ...[
    { name: "promises", if: build, run: "pnpm promises gate" },
    { name: "promises", run: 'pnpm promises gate --base "$BASE"' },
    { name: "promises", run: "pnpm -s promises gate" },
    { name: "promises", run: "pnpm run promises confirm ship" },
    { name: "promises", run: "node packages/promises/src/main.ts gate" },
    { name: "promises", run: 'if [ -n "$BASE" ]; then\n  pnpm promises gate --base "$BASE"\nfi\n' },
  ].map((planted): [string, (w: Workflow) => void] => [
    `T6: check runs today's promise checks again: ${planted.run.split("\n")[0]}`,
    (w) => {
      // Before the stop step, which stays last (F1).
      w.jobs.check.steps.splice(-1, 0, planted);
    },
  ]),
  [
    "T6: the test job runs today's promise checks",
    (w) => {
      w.jobs.test.steps.splice(place(w, "test", "shard times"), 0, { name: "promises", run: "pnpm promises" });
    },
  ],
  [
    "lint skips on a draft",
    (w) => {
      step(w, "check", "lint")["if"] = build;
    },
  ],
  [
    "changes hides the build flag",
    (w) => {
      delete (w.jobs.changes.outputs as Record<string, string>)["build"];
    },
  ],
  [
    "the classifier is not told the draft",
    (w) => {
      Object.assign(step(w, "changes", "classify"), { env });
    },
  ],
  // 0533: no event runs the tests of today's version or its app end to end. T1: no output
  // of changes can start them, and the test job runs only its three whole scripts. T2: no job runs
  // today's app. Each plant puts back one way today's tests ran before, or a new spelling of one.
  // Source plants, each run once on workflow-lint.ts and restored: drop T1's outputs check (red:
  // the today and e2e flags back), drop T2's loop (red: every e2e plant), let T1's allowlist take
  // any step that holds an allowed script (red: today's tests in a step of their own, the lane
  // tests, today's tests after the tooling tests in one step, and the tooling step twice).
  ...todayFlags.map((flag): [string, (w: Workflow) => void] => [
    `T1: changes exposes the ${flag} flag again`,
    (w) => {
      w.jobs.changes.outputs[flag] = `\${{ steps.diff.outputs.${flag} }}`;
    },
  ]),
  [
    "T1: today's tests are back in the test job, on the today flag",
    (w) => {
      w.jobs.test.steps.splice(place(w, "test", "tooling tests"), 0, {
        name: "test",
        if: `\${{ !cancelled() && needs.changes.outputs.today != 'false' }}`,
        env: { ...testEnv, SHARD: `\${{ matrix.shard }}/6` },
        run: "pnpm exec vitest run --shard \"$SHARD\" --exclude 'next/**'",
      });
    },
  ],
  [
    "T1: the lane tests are back, one file at a time",
    (w) => {
      w.jobs.test.steps.unshift({
        name: "lane tests, one file at a time",
        env: testEnv,
        run: "pnpm exec vitest run packages/pipeline/src/stages/pipeline/lane. --maxWorkers=1 --exclude 'next/**'",
      });
    },
  ],
  // 0536: today's tests and next/'s are projects of their own, so a second `--project`, or none at
  // all, runs them in the tooling step.
  ...["today", "next", "next-integration", "next-visual"].map((project): [string, (w: Workflow) => void] => [
    `T1: the tooling tests run the ${project} project's tests`,
    (w) => {
      const found = step(w, "test", "tooling tests");
      found.run = found.run.replaceAll("--project tooling", `--project tooling --project ${project}`);
    },
  ]),
  [
    "T1: the tooling tests run every project",
    (w) => {
      const found = step(w, "test", "tooling tests");
      found.run = found.run.replaceAll("--project tooling ", "");
    },
  ],
  [
    "T1: the tooling step runs today's tests after its own",
    (w) => {
      const found = step(w, "test", "tooling tests");
      found.run += "pnpm exec vitest run packages/\n";
    },
  ],
  [
    "T1: the tooling step runs twice",
    (w) => {
      w.jobs.test.steps.splice(place(w, "test", "shard times"), 0, {
        ...step(w, "test", "tooling tests"),
        name: "again",
      });
    },
  ],
  [
    "T1: the tooling tests are gone",
    (w) => {
      w.jobs.test.steps.splice(place(w, "test", "tooling tests"), 1);
    },
  ],
  [
    "T1: shard times read today's reports again",
    (w) => {
      step(w, "test", "shard times").run =
        'node .github/ci/shard-times.ts "$RUNNER_TEMP/lanes.json" "$RUNNER_TEMP/rest.json" "$RUNNER_TEMP/tooling.json"';
    },
  ],
  ["T2: the e2e job is back", todaysE2e({ name: "e2e", run: "pnpm --filter @kampus/fabrika-app-old e2e" })],
  ["T2: the e2e job is back, from the app's folder", todaysE2e({ name: "e2e", run: "cd apps/fabrika && node e2e.ts" })],
  [
    "T2: the ruler's end to end is back, with the folder as its working directory",
    todaysE2e({ name: "ruler", run: "node ruler-e2e.ts", "working-directory": "apps/fabrika" }),
  ],
  [
    "T2: check runs today's app end to end",
    (w) => {
      // Before the stop step, which stays last (F1).
      w.jobs.check.steps.splice(-1, 0, { run: "pnpm --filter @kampus/fabrika-app-old e2e -- --aria" });
    },
  ],
  [
    "T3: shard times skip after a failure",
    (w) => {
      step(w, "test", "shard times").if = "";
    },
  ],
  [
    "T3: shard times run before the tooling tests",
    (w) => {
      const [times] = w.jobs.test.steps.splice(place(w, "test", "shard times"), 1);
      w.jobs.test.steps.splice(place(w, "test", "tooling tests"), 0, times!);
    },
  ],
  [
    "T4: the tooling tests run on the old today flag",
    (w) => {
      step(w, "test", "tooling tests").if = `\${{ !cancelled() && needs.changes.outputs.today == 'false' }}`;
    },
  ],
  [
    "T4: the tooling tests divide by six on two machines",
    (w) => {
      step(w, "test", "tooling tests").env!.SHARD = `\${{ matrix.shard }}/6`;
    },
  ],
  [
    "T4: the tooling tests read their base from a pull request alone",
    (w) => {
      step(w, "test", "tooling tests").env!.BASE = `\${{ github.event.pull_request.base.sha }}`;
    },
  ],
  ...(
    [
      ["six machines on the old today flag", todayLegs],
      ["six machines", [1, 2, 3, 4, 5, 6]],
      ["two machines as strings", ["1", "2"]],
    ] as const
  ).map(([label, legs]): [string, (w: Workflow) => void] => [
    `T5: ${label}`,
    (w) => {
      w.jobs.test.strategy.matrix.shard = legs;
    },
  ]),
  ...extraCommands.map((added): [string, (w: Workflow) => void] => [
    `review2 extra command: ${added.run}`,
    (w) => {
      w.jobs.next.steps.push(added);
    },
  ]),
  ...["missing", "duplicate"].map((fault): [string, (w: Workflow) => void] => [
    `next ${fault} install`,
    (w) => {
      if (fault === "missing") {
        w.jobs.next.steps.splice(place(w, "next", "install"), 1);
      } else {
        w.jobs.next.steps.push({ ...step(w, "next", "install") });
      }
    },
  ]),
  [
    "review: extra exec Vitest invocation",
    (w) => {
      const vitest = step(w, "next", "vitest");
      w.jobs.next.steps.push({ ...vitest, run: `exec ${vitest.run}` });
    },
  ],
  ...[
    "vitest run next/",
    "pnpm vitest run next/",
    "npx vitest run next/",
    "./node_modules/.bin/vitest run next/",
    'pnpm exec "vitest" run next/',
    'env CI=true pnpm exec vitest run next/ --shard "$SHARD"',
    'echo before; pnpm exec vitest run next/ --shard "$SHARD"; echo after',
    'echo before\npnpm exec vitest run next/ --shard "$SHARD"\necho after',
    "pnpm exec vitest run next/; pnpm exec vitest run next/",
  ].map((run): [string, (w: Workflow) => void] => [
    `extra Vitest spelling: ${run}`,
    (w) => {
      w.jobs.next.steps.push({ ...step(w, "next", "vitest"), run });
    },
  ]),
  ...(
    [
      ["chromium", "Chromium"],
      ["end to end", "e2e"],
      ["edges", "edges"],
    ] as const
  ).map(([named, label]): [string, (w: Workflow) => void] => [
    `review: extra multiline ${label} invocation`,
    (w) => {
      const found = step(w, "next", named);
      w.jobs.next.steps.push({ ...found, run: `echo before\n${found.run}\necho after` });
    },
  ]),
  [
    "review: SHARD matrix.sha rd",
    (w) => {
      step(w, "next", "vitest").env!.SHARD = vitestShard().replace("matrix.shard", "matrix.sha rd");
    },
  ],
  ...(
    [
      ["chromium", "Chromium"],
      ["end to end", "e2e"],
      ["edges", "edges"],
    ] as const
  ).map(([named, label]): [string, (w: Workflow) => void] => [
    `review: ${label} guard matrix.sha rd`,
    (w) => {
      const found = step(w, "next", named);
      found.if = found.if!.replace("matrix.shard", "matrix.sha rd");
    },
  ]),
  [
    "review: Chromium path next/ **",
    (w) => {
      const chromium = step(w, "next", "chromium");
      chromium.if = chromium.if!.replace("next/**", "next/ **");
    },
  ],
  // 0536, E10 and E11. Each plant was run once on the real check.yaml too, and restored.
  [
    "E10: the full fallback alone, as before 0536, so the merge queue starts the visual legs",
    (w) => {
      w.jobs.next.strategy.matrix.shard = `\${{ fromJSON(needs.changes.outputs.shards || '${JSON.stringify(nextLegs(2))}') }}`;
    },
  ],
  [
    "E10: the full fallback runs on main too, as before the schedule",
    (w) => {
      w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.replace(
        visualLabel,
        `(github.event_name == 'push' || ${visualLabel})`,
      );
    },
  ],
  [
    "E10: the full fallback runs in the merge queue",
    (w) => {
      w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.replace(
        visualLabel,
        `(github.event_name == 'merge_group' || ${visualLabel})`,
      );
    },
  ],
  [
    "E10: the full fallback runs on any pull request",
    (w) => {
      w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.replace(
        visualLabel,
        "github.event_name == 'pull_request'",
      );
    },
  ],
  [
    "E10: the plain fallback holds a visual leg",
    (w) => {
      w.jobs.next.strategy.matrix.shard = sizedLegs(nextLegs(2), ["e2e-1", "1", "2", "3", "4", "5"]);
    },
  ],
  [
    "E11: the vitest step runs next-integration too",
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = String(found.run).replace("--project next ", "--project next --project next-integration ");
    },
  ],
  [
    "E11: the vitest step loses its project, so it runs every one",
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = String(found.run).replace("--project next ", "");
    },
  ],
  [
    "E11: main runs next-integration through an env, as the bridge before the schedule did",
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = String(found.run).replace("--project next ", "$PROJECTS ");
      (found["env"] as Record<string, string>)["PROJECTS"] =
        `\${{ github.event_name == 'push' && '--project next --project next-integration' || '--project next' }}`;
    },
  ],
  [
    "the visual label's run no longer cancels the run it repeats",
    (w) => {
      w.concurrency["cancel-in-progress"] =
        `\${{ github.event_name == 'pull_request' && github.event.action == 'synchronize' }}`;
    },
  ],
  [
    "every label's run cancels the run before it",
    (w) => {
      w.concurrency["cancel-in-progress"] =
        `\${{ github.event_name == 'pull_request' && (github.event.action == 'synchronize' || github.event.action == 'labeled') }}`;
    },
  ],
  [
    "changes' size step is not told the visual label",
    (w) => {
      Reflect.deleteProperty(step(w, "changes", "size")["env"] as Record<string, string>, "VISUAL");
    },
  ],
  [
    "review: edges event pull_ request",
    (w) => {
      const edges = step(w, "next", "edges");
      edges.if = edges.if!.replace("pull_request", "pull_ request");
    },
  ],
  // E1's legs (T967, after LE1). Each list is one fault, and the end-to-end step's `/N` is set to the
  // list's count of `e2e-k` legs, so only the legs' shape is wrong: a vitest leg gone or added, no
  // e2e leg, e2e legs out of order, after the numbered ones, from 0, or a plain `e2e`, and numbers
  // for strings. Source plants, each run once on workflow-lint.ts and restored: accept any end-to-end
  // `/N` (red: the e2e leg added or dropped, the denominators 1, -1 and 0, and LE2's one-more case);
  // drop the advice-after-the-end-to-end-step check (red: both advice-before cases).
  ...(
    [
      ["drops leg 5", ["e2e-1", "e2e-2", "1", "2", "3", "4"]],
      ["drops every e2e leg", ["1", "2", "3", "4", "5"]],
      ["adds leg 6", ["e2e-1", "e2e-2", "1", "2", "3", "4", "5", "6"]],
      ["numbers six legs with no e2e", ["1", "2", "3", "4", "5", "6"]],
      ["writes its numbered legs as numbers", ["e2e-1", "e2e-2", 1, 2, 3, 4, 5]],
      ["keeps the old six numbers", [1, 2, 3, 4, 5, 6]],
      ["puts its e2e legs last", ["1", "2", "3", "4", "5", "e2e-1", "e2e-2"]],
      ["writes e2e-2 before e2e-1", ["e2e-2", "e2e-1", "1", "2", "3", "4", "5"]],
      ["names a leg plain e2e", ["e2e", "e2e-1", "1", "2", "3", "4", "5"]],
      ["keeps the old plain e2e leg alone", ["e2e", "1", "2", "3", "4", "5"]],
      ["numbers its e2e legs from 0", ["e2e-0", "e2e-1", "1", "2", "3", "4", "5"]],
      ["skips e2e-2", ["e2e-1", "e2e-3", "1", "2", "3", "4", "5"]],
      ["repeats e2e-1", ["e2e-1", "e2e-1", "1", "2", "3", "4", "5"]],
      ["puts a vitest leg between its e2e legs", ["e2e-1", "1", "e2e-2", "2", "3", "4", "5"]],
    ] as const
  ).map(([fault, legs]): [string, (w: Workflow) => void] => [
    `next ${fault}`,
    (w) => {
      setLegs(w, legs);
      const count = legs.filter((leg) => typeof leg === "string" && /^e2e-[1-9]\d*$/.test(leg)).length;
      step(w, "next", "end to end").env!.SHARD = e2eShard(count);
    },
  ]),
  // E1 and E2: one e2e leg fewer or more than the end-to-end step's `/N`.
  [
    "next drops its last e2e leg and keeps its /N",
    (w) => {
      setLegs(
        w,
        legsOf(w).filter(
          (leg, _, all) => leg !== all.filter((l) => typeof l === "string" && l.startsWith("e2e-")).at(-1),
        ),
      );
    },
  ],
  [
    "next adds an e2e leg and keeps its /N",
    (w) => {
      const legs = legsOf(w);
      const count = legs.filter((leg) => typeof leg === "string" && leg.startsWith("e2e-")).length;
      legs.splice(count, 0, `e2e-${count + 1}`);
      setLegs(w, legs);
    },
  ],
  // E2's denominator, the end-to-end step's own: its full count one more or one fewer than its legs,
  // or not a count; no denominator. S1: the plain full count, which ignores a sized run's own count;
  // the sized count with no full count for a run that is not sized; the vitest legs' count.
  ...([1, -1, "", "x", "0", "plain", "sized only", "vitest's"] as const).map(
    (fault): [string, (w: Workflow) => void] => [
      `next end-to-end denominator ${fault === "" ? "absent" : fault}`,
      (w) => {
        const env = step(w, "next", "end to end").env!;
        const count = Number(/\|\| (\d+)\s*\}\}$/.exec(env.SHARD ?? "")?.[1]);
        const wrong: Record<string, string> = {
          "": `\${{ matrix.shard }}`,
          x: e2eShard("x"),
          "0": e2eShard(`0${count}`),
          plain: `\${{ matrix.shard }}/${count}`,
          "sized only": `\${{ matrix.shard }}/\${{ needs.legs.outputs.e2e }}`,
          "vitest's": `\${{ matrix.shard }}/\${{ needs.legs.outputs.vitest || ${count} }}`,
        };
        env.SHARD = typeof fault === "number" ? e2eShard(count + fault) : wrong[fault]!;
      },
    ],
  ),
  [
    "next end-to-end step loses its SHARD",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "end to end"), "env");
    },
  ],
  // E2's command: each part the leg needs, dropped alone, so the run is no longer the pinned one.
  ...[
    ` --shard "\${SHARD#e2e-}"`,
    " --reporter=verbose",
    " --reporter=json",
    " --reporter=github-actions",
    ' --outputFile.json="$RUNNER_TEMP/next.json"',
  ].map((flag): [string, (w: Workflow) => void] => [
    `next end-to-end step loses ${flag}`,
    (w) => {
      const e2e = step(w, "next", "end to end");
      e2e.run = e2e.run.replace(flag, "");
    },
  ]),
  [
    "next end-to-end step passes the whole leg name",
    (w) => {
      const e2e = step(w, "next", "end to end");
      e2e.run = e2e.run.replace(`"\${SHARD#e2e-}"`, '"$SHARD"');
    },
  ],
  // E2's guard: exactly `startsWith(matrix.shard, 'e2e-')`.
  [
    "next end-to-end step loses its guard",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "end to end"), "if");
    },
  ],
  ...["matrix.shard == 'e2e-1'", "matrix.shard == 'e2e'", `${onE2e} && false`, `${onE2e} || true`].map(
    (condition): [string, (w: Workflow) => void] => [
      `next end-to-end guard ${condition}`,
      (w) => {
        step(w, "next", "end to end").if = condition;
      },
    ],
  ),
  // E3: shard times after both test steps, so an e2e leg's next.json is read too.
  [
    "next timing advice before the end-to-end step",
    (w) => {
      const [advice] = w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
      w.jobs.next.steps.splice(place(w, "next", "end to end"), 0, advice!);
    },
  ],
  [
    "next chromium on every leg",
    (w) => {
      step(w, "next", "chromium").if = "hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''";
    },
  ],
  // LE1's denominator: `/6` leaves a sixth of the files on no machine, and a smaller one fails a leg.
  // S1: the plain `/5`, which ignores a sized run's own count; the sized count alone; the e2e count.
  ...[
    `/\${{ needs.legs.outputs.vitest || 6 }}`,
    `/\${{ needs.legs.outputs.vitest || 3 }}`,
    `/\${{ needs.legs.outputs.vitest || 4 }}`,
    "",
    `/\${{ needs.legs.outputs.vitest || 05 }}`,
    `/\${{ needs.legs.outputs.vitest || 5 }} `,
    "/5",
    `/\${{ needs.legs.outputs.vitest }}`,
    `/\${{ needs.legs.outputs.e2e || 5 }}`,
  ].map((denominator): [string, (w: Workflow) => void] => [
    `next wrong denominator ${denominator || "absent"}`,
    (w) => {
      step(w, "next", "vitest").env!.SHARD = `\${{ matrix.shard }}${denominator}`;
    },
  ]),
  // E3's vitest guard (after LE1): exactly one `if`, and it is `!startsWith(matrix.shard, 'e2e-')`.
  [
    "next vitest step loses its guard",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "vitest"), "if");
    },
  ],
  ...[
    `!${onE2e} && false`,
    onE2e,
    `!${onE2e} || true`,
    "matrix.shard != 'e2e'",
    "matrix.shard != 'e2e-1'",
    "matrix.shard != 1",
  ].map((condition): [string, (w: Workflow) => void] => [
    `next vitest guard ${condition}`,
    (w) => {
      step(w, "next", "vitest").if = condition;
    },
  ]),
  // E2 and E3's leg steps: chromium and the end-to-end runner only on the e2e legs, edges only on 1.
  ...(
    [
      [
        "Chromium back on leg 1",
        "chromium",
        "matrix.shard == '1' && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''",
      ],
      [
        "Chromium on the old e2e leg",
        "chromium",
        "matrix.shard == 'e2e' && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''",
      ],
      ["e2e back on leg 1", "end to end", "matrix.shard == '1'"],
      ["e2e back on the number 1", "end to end", "matrix.shard == 1"],
      ["e2e on every numbered leg", "end to end", `!${onE2e}`],
      ["edges on the e2e legs", "edges", `${onE2e} && github.event_name == 'pull_request'`],
      ["edges on the number 1", "edges", "matrix.shard == 1 && github.event_name == 'pull_request'"],
    ] as const
  ).map(([fault, named, condition]): [string, (w: Workflow) => void] => [
    `next ${fault}`,
    (w) => {
      step(w, "next", named).if = condition;
    },
  ]),
  [
    "next fail fast",
    (w) => {
      w.jobs.next.strategy["fail-fast"] = true;
    },
  ],
  [
    "next extra axis",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { os: ["ubuntu"] });
    },
  ],
  [
    "next include",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { include: [{ shard: 7 }] });
    },
  ],
  [
    "next exclude",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { exclude: [{ shard: 6 }] });
    },
  ],
  [
    "next custom name",
    (w) => {
      Object.assign(w.jobs.next, { name: "next" });
    },
  ],
  [
    "next duplicate command",
    (w) => {
      w.jobs.next.steps.push({ ...step(w, "next", "vitest") });
    },
  ],
  ...[
    " --reporter=verbose",
    " --reporter=json",
    " --reporter=github-actions",
    ' --outputFile.json="$RUNNER_TEMP/next.json"',
  ].map((flag): [string, (w: Workflow) => void] => [
    `next loses ${flag}`,
    (w) => {
      const vitest = step(w, "next", "vitest");
      vitest.run = vitest.run.replace(flag, "");
    },
  ]),
  ...["missing", "duplicate", "before tests", "wrong report"].map((fault): [string, (w: Workflow) => void] => [
    `next timing advice ${fault}`,
    (w) => {
      const advice = step(w, "next", "shard times");

      if (fault === "missing") {
        w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
      } else if (fault === "duplicate") {
        w.jobs.next.steps.push({ ...advice });
      } else if (fault === "before tests") {
        w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
        w.jobs.next.steps.unshift(advice);
      } else {
        advice.run = 'node .github/ci/shard-times.ts "$RUNNER_TEMP/other.json"';
      }
    },
  ]),
  ...[
    "",
    "success()",
    "always()",
    "false",
    "matrix.shard == '1' && !cancelled()",
    "matrix.shard != 'e2e'",
    `!${onE2e}`,
  ].map((condition): [string, (w: Workflow) => void] => [
    `next timing advice condition ${condition || "absent"}`,
    (w) => {
      step(w, "next", "shard times").if = condition;
    },
  ]),
  ...[" --changed main", " --passWithNoTests", " file.test.ts"].map((suffix): [string, (w: Workflow) => void] => [
    suffix,
    (w) => {
      step(w, "next", "vitest").run += suffix;
    },
  ]),
  [
    "next test command inside a longer step",
    (w) => {
      step(w, "next", "vitest").run = `echo before\n${step(w, "next", "vitest").run}`;
    },
  ],
  [
    "next no shard flag",
    (w) => {
      step(w, "next", "vitest").run = "pnpm exec vitest run next/";
    },
  ],
  [
    "next guarded test",
    (w) => {
      Object.assign(step(w, "next", "vitest"), { if: "false" });
    },
  ],
  // S1, changes' size step and next's sized matrix (legs.ts), once the legs job (ticket 985). Each
  // is red alone in every generated workflow. The size step without its event check would size the
  // merge queue and main. Source plants, each run once on workflow-lint.ts and restored: drop the
  // rule that the size step follows the parser's pass (red: sizing, install and all, before it);
  // each gated job on its own flag alone (red: every generated workflow).
  ...(
    [
      ["next needs legs too", (w) => (w.jobs.next.needs = ["changes", "legs"])],
      [
        "next waits on a legs answer",
        (w) => (w.jobs.next.if = `${guard("next").slice(0, -3)} && needs.legs.outputs.next != 'false' }}`),
      ],
      [
        "next matrix with no fallback",
        (w) => (w.jobs.next.strategy.matrix.shard = `\${{ fromJSON(needs.changes.outputs.shards) }}`),
      ],
      [
        "next matrix from another output",
        (w) => (w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.replace(".shards", ".files")),
      ],
      [
        "next matrix from the old legs job",
        (w) =>
          (w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.replace(
            "needs.changes",
            "needs.legs",
          )),
      ],
      ["next matrix as a plain list", (w) => Object.assign(w.jobs.next.strategy.matrix, { shard: nextLegs(2) })],
      ["changes loses a sizing output", (w) => Reflect.deleteProperty(w.jobs.changes.outputs, "e2e-legs")],
      ["changes adds an output", (w) => (w.jobs.changes.outputs["more"] = `\${{ steps.size.outputs.more }}`)],
      [
        "changes takes shards from another step",
        (w) => (w.jobs.changes.outputs["shards"] = `\${{ steps.diff.outputs.shards }}`),
      ],
      [
        "changes' next ignores the size step",
        (w) => (w.jobs.changes.outputs["next"] = `\${{ steps.same.outputs.next || steps.diff.outputs.next }}`),
      ],
      // 0534: the merge queue and main size their legs too, from their own base, so none of the three
      // runs the whole suite. Each plant puts back a piece of the pull-request-only shape.
      [
        "the size step sizes pull requests alone, so the queue and main run the whole suite",
        (w) =>
          (step(w, "changes", "size")["if"] = String(step(w, "changes", "size")["if"]).replace(
            " && (steps.same",
            " && github.event_name == 'pull_request' && (steps.same",
          )),
      ],
      [
        "the sizing install runs on pull requests alone",
        (w) =>
          (step(w, "changes", "install for sizing")["if"] = String(
            step(w, "changes", "install for sizing")["if"],
          ).replace(" && (steps.same", " && github.event_name == 'pull_request' && (steps.same")),
      ],
      [
        "the size step's base is a pull request's alone",
        (w) =>
          ((step(w, "changes", "size").env as Record<string, string>)["BASE"] =
            `\${{ github.event.pull_request.base.sha }}`),
      ],
      [
        "the size step's base skips the merge queue's group",
        (w) =>
          ((step(w, "changes", "size").env as Record<string, string>)["BASE"] =
            `\${{ github.event.pull_request.base.sha || github.event.before }}`),
      ],
      ["changes drops the size step's base", (w) => Reflect.deleteProperty(w.jobs.changes.outputs, "base")],
      [
        "changes takes the base from the classify step",
        (w) => (w.jobs.changes.outputs["base"] = `\${{ steps.diff.outputs.base }}`),
      ],
      [
        "the end-to-end legs narrow on pull requests alone, so the queue and main run every end-to-end file",
        (w) => ((step(w, "next", "end to end").env as Record<string, string>)["CHANGED"] = changedOnPullRequests),
      ],
      [
        "the end-to-end legs narrow from the event's base, even when the size step did not size them",
        (w) =>
          ((step(w, "next", "end to end").env as Record<string, string>)["CHANGED"] =
            `\${{ format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before) }}`),
      ],
      [
        "the end-to-end legs never narrow",
        (w) => ((step(w, "next", "end to end").env as Record<string, string>)["CHANGED"] = ""),
      ],
      [
        "the size step sizes the reader tests",
        (w) =>
          (step(w, "changes", "size")["if"] = String(step(w, "changes", "size")["if"]).replace(
            " && (steps.same.outputs.filter || steps.diff.outputs.filter) == 'next/'",
            "",
          )),
      ],
      [
        "the size step reads the first pass alone",
        (w) =>
          (step(w, "changes", "size")["if"] = String(step(w, "changes", "size")["if"]).replaceAll(
            "steps.same.outputs.next || ",
            "",
          )),
      ],
      ["sizing installs on every run", (w) => Reflect.deleteProperty(step(w, "changes", "install for sizing"), "if")],
      ["the size step fails the job", (w) => Reflect.deleteProperty(step(w, "changes", "size"), "continue-on-error")],
      [
        "sizing's install fails the job",
        (w) => Reflect.deleteProperty(step(w, "changes", "install for sizing"), "continue-on-error"),
      ],
      [
        "the size step runs another script",
        (w) => (step(w, "changes", "size")["run"] = "node .github/ci/legs.ts --all"),
      ],
      ["the size step renamed", (w) => (step(w, "changes", "size")["id"] = "sizes")],
      [
        "sizing installs with scripts",
        (w) => (step(w, "changes", "install for sizing")["run"] = "pnpm install --frozen-lockfile"),
      ],
      [
        "the size step before the parser's pass",
        (w) => {
          const [size] = w.jobs.changes.steps.splice(place(w, "changes", "size"), 1);
          w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 0, size!);
        },
      ],
      [
        "sizing, install and all, before the parser's pass",
        (w) => {
          const moved = w.jobs.changes.steps.splice(place(w, "changes", "install for sizing"), 2);
          w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 0, ...moved);
        },
      ],
      [
        "the size step on the merge queue's base",
        (w) =>
          Object.assign(step(w, "changes", "size")["env"] as Record<string, string>, {
            BASE: `\${{ github.event.merge_group.base_sha }}`,
          }),
      ],
      [
        "the size step without its filter",
        (w) => Reflect.deleteProperty(step(w, "changes", "size")["env"] as Record<string, string>, "FILTER"),
      ],
      [
        "the size step on the first pass's filter",
        (w) =>
          Object.assign(step(w, "changes", "size")["env"] as Record<string, string>, {
            FILTER: `\${{ steps.diff.outputs.filter || 'next/' }}`,
          }),
      ],
      ["the setup skips sizing", (w) => (step(w, "changes", "parser pnpm")["if"] = probe)],
      [
        "a legs job comes back",
        (w) => {
          Object.assign(w.jobs, {
            legs: { needs: "changes", "timeout-minutes": 5, steps: [{ run: "node .github/ci/legs.ts" }] },
          });
          w.jobs["ci-required"].needs.push("legs");
        },
      ],
    ] as [string, (w: Workflow) => unknown][]
  ).map(([fault, mutate]): [string, (w: Workflow) => void] => [
    fault,
    (w) => {
      mutate(w);
    },
  ]),
  [
    "next classifier failure skips",
    (w) => {
      w.jobs.next.if = "needs.changes.outputs.next == 'true'";
    },
  ],
  ...["chromium", "end to end", "edges"].flatMap((named, at): [string, (w: Workflow) => void][] => [
    [
      `next missing step ${at + 1}`,
      (w) => {
        w.jobs.next.steps.splice(place(w, "next", named), 1);
      },
    ],
    [
      `next duplicate step ${at + 1}`,
      (w) => {
        w.jobs.next.steps.push({ ...step(w, "next", named) });
      },
    ],
    [
      `next false step ${at + 1}`,
      (w) => {
        step(w, "next", named).if = "false";
      },
    ],
  ]),
  [
    "next e2e everywhere",
    (w) => {
      step(w, "next", "end to end").if = "true";
    },
  ],
  [
    "next chromium without file guard",
    (w) => {
      step(w, "next", "chromium").if = onE2e;
    },
  ],
  [
    "next edges without event guard",
    (w) => {
      step(w, "next", "edges").if = "matrix.shard == '1'";
    },
  ],
  [
    "scan skips after failure",
    (w) => {
      Object.assign(step(w, "changes", "skills check"), { if: "success()" });
    },
  ],
  [
    "changes skips",
    (w) => {
      Object.assign(w.jobs.changes, { if: "false" });
    },
  ],
  // F1 to F3, the field row check inside check (ticket 985). Source plants, each run once on
  // workflow-lint.ts and restored: the rows anywhere in check (red: before lint); F3 dropped (red: a legs job, a field job comes back).
  ...(
    [
      [
        "the row check ignores failure",
        (w) => Object.assign(step(w, "check", "field rows"), { "continue-on-error": true }),
      ],
      [
        "the row check runs before lint",
        (w) => {
          const [rows] = w.jobs.check.steps.splice(place(w, "check", "field rows"), 1);
          w.jobs.check.steps.splice(place(w, "check", "lint"), 0, rows!);
        },
      ],
      [
        "the row check skips after a failure",
        (w) => (step(w, "check", "field rows")["if"] = `\${{ needs.changes.outputs.field != 'false' }}`),
      ],
      ["the row check runs on the check flag", (w) => (step(w, "check", "field rows")["if"] = checkFlag)],
      [
        "the row check without its base",
        (w) => Reflect.deleteProperty(step(w, "check", "field rows")["env"] as Record<string, string>, "BASE"),
      ],
      ["the row check bypassed", (w) => (step(w, "check", "field rows")["run"] = "echo passed")],
      ["the row check twice", (w) => w.jobs.check.steps.push({ ...step(w, "check", "field rows") })],
      ["check runs only on the check flag", (w) => (w.jobs.check.if = guard("check"))],
      [
        "rows alone install everything",
        (w) => w.jobs.check.steps.splice(place(w, "check", "install the row check"), 1),
      ],
      ["the row install runs with lint", (w) => (step(w, "check", "install the row check")["if"] = checkFlag)],
      ["the full install runs for rows alone", (w) => Reflect.deleteProperty(step(w, "check", "install"), "if")],
      ["lint runs for rows alone", (w) => Reflect.deleteProperty(step(w, "check", "lint"), "if")],
      ["the ratchet runs for rows alone", (w) => Reflect.deleteProperty(step(w, "check", "lists only shrink"), "if")],
      ["check checks out no history", (w) => (step(w, "check", "checkout")["with"] = {})],
      [
        "a field job comes back",
        (w) => {
          Object.assign(w.jobs, {
            field: { "timeout-minutes": 5, steps: [{ run: "node .github/ci/field-check.ts" }] },
          });
          w.jobs["ci-required"].needs.push("field");
        },
      ],
    ] as [string, (w: Workflow) => unknown][]
  ).map(([fault, mutate]): [string, (w: Workflow) => void] => [
    fault,
    (w) => {
      mutate(w);
    },
  ]),
  [
    "unconditional check",
    (w) => {
      w.jobs.check.if = "true";
    },
  ],
  [
    "missing next condition",
    (w) => {
      w.jobs.next.if = "";
    },
  ],
  [
    "failure skips tests",
    (w) => {
      w.jobs.test.if = "needs.changes.outputs.test == 'true'";
    },
  ],
  [
    "classifier bypass",
    (w) => {
      Object.assign(step(w, "changes", "classify"), { run: "echo check=false" });
    },
  ],
  [
    "missing skills scan",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "skills check"), 1);
    },
  ],
  [
    "missing ignore scan",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "tracked files"), 1);
    },
  ],
  [
    "missing output",
    (w) => {
      delete w.jobs.changes.outputs["next"];
    },
  ],
  // The plan for CI paths, slice 2, law 21: the next job's path comes from filter with the fallback
  // next/, and the changes job's parser steps carry continue-on-error.
  [
    "next loses its path fallback",
    (w) => {
      step(w, "next", "vitest").env!.FILTER = `\${{ needs.changes.outputs.filter }}`;
    },
  ],
  [
    "next runs all of next/ whatever filter says",
    (w) => {
      step(w, "next", "vitest").run = step(w, "next", "vitest").run.replace("$FILTER", "next/");
    },
  ],
  [
    "next quotes its path, so the reader paths are one argument",
    (w) => {
      step(w, "next", "vitest").run = step(w, "next", "vitest").run.replace("$FILTER", '"$FILTER"');
    },
  ],
  [
    "next has no filter",
    (w) => {
      delete (step(w, "next", "vitest").env as Record<string, string>)["FILTER"];
    },
  ],
  // After PR 1230: under the reader filter, `--changed` would drop the reader tests, which reach a
  // changed file by reading it, not by importing it. So the vitest step's CHANGED is empty there.
  [
    "next narrows the reader tests with --changed",
    (w) => {
      (step(w, "next", "vitest").env as Record<string, string>)["CHANGED"] = changedOnPullRequests;
    },
  ],
  // PR 1235: a sized run's vitest legs run the legs job's `files`, which hold every reader test, and
  // nothing narrows that list again. 1230's own `--changed` back on the step drops the readers; the
  // legs list ignored or read after filter runs the import graph's files alone or the whole suite;
  // 1235's first shape, a readers step on leg 1, runs a reader twice and loads leg 1 alone.
  [
    "next's vitest step ignores legs's files",
    (w) => {
      w.jobs.next.steps[0]!.env!.FILTER = `\${{ needs.changes.outputs.filter || 'next/' }}`;
    },
  ],
  [
    "next's vitest step reads legs's files after filter",
    (w) => {
      w.jobs.next.steps[0]!.env!.FILTER = `\${{ needs.changes.outputs.filter || needs.legs.outputs.files || 'next/' }}`;
    },
  ],
  [
    "next's vitest step narrows legs's files with 1230's --changed",
    (w) => {
      const step = w.jobs.next.steps[0]!;
      step.run = step.run.replace("$FILTER ", "$FILTER $CHANGED ");
      (step.env as Record<string, string>)["CHANGED"] = changedUnlessReaders;
    },
  ],
  [
    "next's vitest step takes another env key",
    (w) => {
      (w.jobs.next.steps[0]!.env as Record<string, string>)["READERS"] = `\${{ needs.changes.outputs.readers }}`;
    },
  ],
  [
    "next runs the reader tests again in a step of their own on leg 1",
    (w) => {
      w.jobs.next.steps.splice(1, 0, {
        name: "readers",
        if: "!cancelled() && matrix.shard == '1'",
        run: 'pnpm exec vitest run $READERS --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/readers.json"',
      });
    },
  ],
  ["changes hides its files", (w) => Reflect.deleteProperty(w.jobs.changes.outputs, "files")],
  [
    "changes takes its files from another step",
    (w) => (w.jobs.changes.outputs["files"] = `\${{ steps.diff.outputs.files }}`),
  ],
  ...(["next", "filter"] as const).flatMap((key): [string, (w: Workflow) => void][] => [
    [
      `changes exposes ${key} from the first pass alone`,
      (w) => {
        w.jobs.changes.outputs[key] = `\${{ steps.diff.outputs.${key} }}`;
      },
    ],
    [
      `changes exposes ${key} from the parser's pass alone`,
      (w) => {
        w.jobs.changes.outputs[key] = `\${{ steps.same.outputs.${key} }}`;
      },
    ],
    [
      `changes hides ${key}`,
      (w) => {
        delete w.jobs.changes.outputs[key];
      },
    ],
  ]),
  ...["parser pnpm", "parser node", "parser install", "parser pass"].map(
    (named, at): [string, (w: Workflow) => void] => [
      `the parser's step ${at + 5} fails changes`,
      (w) => {
        delete step(w, "changes", named)["continue-on-error"];
      },
    ],
  ),
  [
    "the parser's pass is gone",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 1);
    },
  ],
  [
    "the parser's install is gone",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "parser install"), 1);
    },
  ],
  [
    "the parser's pass runs before its install",
    (w) => {
      const [pass] = w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 1);
      w.jobs.changes.steps.splice(place(w, "changes", "parser install"), 0, pass!);
    },
  ],
  [
    "the parser's pass is not told the draft",
    (w) => {
      step(w, "changes", "parser pass")["env"] = env;
    },
  ],
  [
    "workflow path filter",
    (w) => {
      Object.assign(w.on, { pull_request: { paths: ["next/**"] } });
    },
  ],
  [
    "main filter",
    (w) => {
      w.on.push.branches = ["other"];
    },
  ],
  [
    "next job excludes next",
    (w) => {
      step(w, "next", "vitest").run += " --exclude 'next/**'";
    },
  ],
  // The ci-required job: it waits on every job, never skips, and its judge cannot be bypassed.
  ...(["changes", "check", "typecheck", "test", "next"] as const).map((job): [string, (w: Workflow) => void] => [
    `ci-required does not need ${job}`,
    (w) => {
      w.jobs["ci-required"].needs = w.jobs["ci-required"].needs.filter((name) => name !== job);
    },
  ]),
  // The lane reads the typecheck job's answer alone (0133), so the typecheck lives there only.
  [
    "the typecheck job runs no typecheck",
    (w) => {
      w.jobs.typecheck.steps = [{ name: "install", run: "pnpm install --frozen-lockfile" }];
    },
  ],
  [
    "check runs the typecheck again",
    (w) => {
      w.jobs.check.steps.unshift({ run: "pnpm typecheck" });
    },
  ],
  [
    "a new job ci-required does not need",
    (w) => {
      Object.assign(w.jobs, { lint: { "timeout-minutes": 5, steps: [{ run: "pnpm lint" }] } });
    },
  ],
  ...["!cancelled()", "success()", ""].map((condition): [string, (w: Workflow) => void] => [
    `ci-required runs only on ${condition || "no condition"}`,
    (w) => {
      w.jobs["ci-required"].if = condition;
    },
  ]),
  [
    "ci-required ignores its failure",
    (w) => {
      Object.assign(w.jobs["ci-required"], { "continue-on-error": true });
    },
  ],
  [
    "ci-required judge ignores its failure",
    (w) => {
      Object.assign(step(w, "ci-required", "judge"), { "continue-on-error": true });
    },
  ],
  [
    "ci-required bypassed",
    (w) => {
      step(w, "ci-required", "judge")["run"] = "echo pass";
    },
  ],
  [
    "ci-required reads needs.*.result only",
    (w) => {
      step(w, "ci-required", "judge")["env"] = { NEEDS: `\${{ toJSON(needs.*.result) }}` };
    },
  ],
  [
    "ci-required second step",
    (w) => {
      w.jobs["ci-required"].steps.push({ run: "exit 0" });
    },
  ],
  // T496: a job with no time limit, one plant per job, and one limit past GitHub's default.
  ...(["changes", "check", "typecheck", "test", "next", "ci-required"] as const).map(
    (job): [string, (w: Workflow) => void] => [
      `${job} without a time limit`,
      (w) => {
        Object.assign(w.jobs[job], { "timeout-minutes": undefined });
      },
    ],
  ),
  [
    "a time limit past the default",
    (w) => {
      w.jobs.test["timeout-minutes"] = 360;
    },
  ],
  // 0524, ticket 933 (L7): a pull request that drops or mutes the ratchet would pass with a grown list.
  [
    "L7: the ratchet step is deleted",
    (w) => {
      w.jobs.check.steps.splice(place(w, "check", "lists only shrink"), 1);
    },
  ],
  [
    "L7: the ratchet step skips on a condition",
    (w) => {
      step(w, "check", "lists only shrink")["if"] = build;
    },
  ],
  [
    "L7: the ratchet step's failure does not block",
    (w) => {
      step(w, "check", "lists only shrink")["continue-on-error"] = true;
    },
  ],
  [
    "L7: the ratchet step takes a base that keeps a first push's zeros",
    (w) => {
      step(w, "check", "lists only shrink")["env"] = { BASE: env.BASE };
    },
  ],
  [
    "L7: the ratchet step runs twice, once muted",
    (w) => {
      w.jobs.check.steps.push({ ...step(w, "check", "lists only shrink"), "continue-on-error": true });
    },
  ],
  [
    "L7: the ratchet command swallows its exit",
    (w) => {
      step(w, "check", "lists only shrink")["run"] = `${ratchet} || true`;
    },
  ],
  // Fail fast (ticket 990). F1: each job that drops its stop step would hold its run's other jobs
  // to the end after it failed, as merge queue group 1199 did (run 43633120187).
  // Plants, each run once on workflow-lint.ts and restored, each red on its plant below: F1's
  // last-step check dropped; F1's one-cancel count dropped; F2 dropped; F3's per-job check dropped.
  ...stopping.map((job): [string, (w: Workflow) => void] => [
    `F1: ${job} drops its stop step`,
    (w) => {
      stepsOf(w, job).pop();
    },
  ]),
  [
    "F1: the stop step cancels a push to main too",
    (w) => {
      stepsOf(w, "check").at(-1)!["if"] = `\${{ failure() }}`;
    },
  ],
  [
    "F1: the stop step runs on every result, cancelling green runs",
    (w) => {
      stepsOf(w, "typecheck").at(-1)!["if"] = `\${{ always() && github.event_name != 'push' }}`;
    },
  ],
  [
    "F1: the stop step force-cancels, which takes ci-required down with the run",
    (w) => {
      stepsOf(w, "check").at(-1)!["run"] =
        'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/force-cancel"';
    },
  ],
  [
    "F1: the stop step comes before the job's last step, so that step's failure stops nothing",
    (w) => {
      const list = stepsOf(w, "test");
      list.splice(-2, 2, list.at(-1)!, list.at(-2)!);
    },
  ],
  [
    "F1: a second cancel step, with no guard for main",
    (w) => {
      stepsOf(w, "test").splice(-1, 0, { if: `\${{ failure() }}`, run: stop.run });
    },
  ],
  // Every job here pins its own `if`, so F2 is for a job added later; this one is right in all else.
  [
    "F2: a new job runs on always(), so a canceled run waits for it",
    (w) => {
      Object.assign(w.jobs, {
        extra: { if: "always()", "timeout-minutes": 5, steps: [{ run: "echo extra" }, structuredClone(stop)] },
      });
      w.jobs["ci-required"].needs.push("extra");
    },
  ],
  [
    "F3: ci-required keeps actions: write",
    (w) => {
      w.jobs["ci-required"].permissions = { actions: "write", contents: "read" };
    },
  ],
  [
    "F3: the workflow's token is write-all",
    (w) => {
      w.permissions = "write-all";
    },
  ],
  [
    "F3: the workflow's token loses actions: write, so every stop step is refused",
    (w) => {
      w.permissions = { contents: "read" };
    },
  ],
  [
    "F3: a job sets its own token, which drops the workflow's actions: write",
    (w) => {
      Object.assign(w.jobs.changes, { permissions: { actions: "read", contents: "read" } });
    },
  ],
  // F4: a checkout that keeps the token in .git/config hands the `actions: write` token to every
  // test and install script after it. One plant per job with a checkout, and one that sets it true.
  // Plant, run once on workflow-lint.ts and restored: F4 dropped (red on each of these).
  ...(["changes", "check", "ci-required"] as const).map((job): [string, (w: Workflow) => void] => [
    `F4: ${job}'s checkout keeps the token in .git/config`,
    (w) => {
      const checkout = stepsOf(w, job).find((s) => String(s["uses"]).startsWith("actions/checkout@"))!;
      Reflect.deleteProperty(checkout["with"] as Record<string, unknown>, "persist-credentials");
    },
  ]),
  [
    "F4: a checkout sets persist-credentials to true",
    (w) => {
      const checkout = stepsOf(w, "check")[0]!;
      (checkout["with"] as Record<string, unknown>)["persist-credentials"] = true;
    },
  ],
  // TT1 and TT2: every test leg writes its time table and uploads its timings file. Each plant was
  // also run once on workflow-lint.ts with its rule dropped, and that turned it red.
  ...(["test", "next"] as const).flatMap((job): [string, (w: Workflow) => void][] => {
    const steps = (w: Workflow) => stepsOf(w, job) as Timed[];
    const named = (w: Workflow, name: string) => steps(w).find((s) => s["name"] === name)!;
    const table = (w: Workflow) => named(w, "time table");
    const upload = (w: Workflow) => named(w, "timings");
    return [
      [`TT1: ${job} drops its time table`, (w) => void steps(w).splice(place(w, job, "time table"), 1)],
      [`TT1: ${job}'s time table skips a red leg`, (w) => (table(w).if = "success()")],
      [`TT1: ${job}'s time table skips a canceled leg`, (w) => (table(w).if = "!cancelled()")],
      [`TT1: ${job}'s time table can fail the job`, (w) => Reflect.deleteProperty(table(w), "continue-on-error")],
      [`TT1: ${job}'s time table has no time limit`, (w) => Reflect.deleteProperty(table(w), "timeout-minutes")],
      [`TT1: ${job}'s time table has no job id`, (w) => Reflect.deleteProperty(table(w).env!, "JOB_ID")],
      [
        `TT1: ${job}'s time table reads the other leg's report`,
        (w) => (table(w).env!["REPORT"] = `\${{ runner.temp }}/${job === "test" ? "next" : "tooling"}.json`),
      ],
      [
        `TT1: ${job}'s time table comes before shard times, so it misses that step`,
        (w) => {
          const [moved] = steps(w).splice(place(w, job, "time table"), 1);
          steps(w).splice(place(w, job, "shard times"), 0, moved!);
        },
      ],
      [`TT1: ${job} runs its time table twice`, (w) => void steps(w).splice(-1, 0, structuredClone(table(w)))],
      [`TT2: ${job} drops its timings upload`, (w) => void steps(w).splice(place(w, job, "timings"), 1)],
      [
        `TT2: ${job}'s timings lose the attempt, so a rerun's upload clashes`,
        (w) => (upload(w).with!["name"] = `timings-\${{ github.job }}-\${{ matrix.shard }}`),
      ],
      [`TT2: ${job}'s timings skip a red leg`, (w) => (upload(w).if = "success()")],
      [`TT2: ${job}'s timings can fail the job`, (w) => Reflect.deleteProperty(upload(w), "continue-on-error")],
      [`TT2: ${job}'s timings have no time limit`, (w) => Reflect.deleteProperty(upload(w), "timeout-minutes")],
      [
        `TT2: ${job}'s timings upload before the time table writes them`,
        (w) => {
          const [moved] = steps(w).splice(place(w, job, "timings"), 1);
          steps(w).splice(place(w, job, "time table"), 0, moved!);
        },
      ],
    ];
  }),
  // M1: the time table's exact step, in a test job, is the one test step that gets the token. The
  // same command elsewhere, or with one more variable, does not. The typecheck plant passed the M1
  // that let any step whose command is the time table's have the token.
  ["M1: shard times gets the token too", (w) => (step(w, "test", "shard times").env = { GITHUB_TOKEN: token })],
  [
    "M1: typecheck runs the time table's command with the token and a loader beside it",
    (w) => stepsOf(w, "typecheck").splice(-1, 0, tableElsewhere()),
  ],
  [
    "M1: test's time table carries a loader beside the token",
    (w) => ((stepsOf(w, "test").find((s) => s["name"] === "time table") as Timed).env!["NODE_OPTIONS"] = loader),
  ],
];

it("accepts generated valid wiring", () => {
  fc.assert(
    fc.property(wiring, (clean) => {
      expect(lint(JSON.stringify(clean))).toEqual([]);
    }),
    options,
  );
});

it.each(plants)("rejects isolated wiring plant: %s", (plant, mutate) => {
  fc.assert(
    fc.property(wiring, (clean) => {
      expect(lint(JSON.stringify(clean))).toEqual([]);
      const broken = structuredClone(clean);
      mutate(broken);
      expect(lint(JSON.stringify(broken)), plant).not.toEqual([]);
    }),
    options,
  );
});

it("names the next command whose step or condition is wrong", () => {
  fc.assert(
    fc.property(
      wiring,
      fc.constantFrom("chromium", "end to end", "edges"),
      fc.boolean(),
      (broken, named, missingGuard) => {
        const found = step(broken, "next", named);
        found.if = missingGuard
          ? named === "end to end"
            ? "true"
            : named === "chromium"
              ? onE2e
              : "matrix.shard == '1'"
          : "false";
        expect(lint(JSON.stringify(broken))).toEqual([
          `check.yaml: next runs ${found.run} once, only on ${named === "edges" ? "leg 1" : "the e2e legs"}, with its pinned condition`,
        ]);
      },
    ),
    options,
  );
});

// LE2, today's CI. LE1's four faults, each planted alone in every generated valid workflow, and the
// one error the lint must give for it. An error list of exactly one line shows that the fault is
// named and that nothing else hides behind it.
// Plants, each run once on workflow-lint.ts and restored: accept any `if` on the vitest step (red:
// the `if` taken off went unnamed); accept any denominator (red: `/6` went unnamed).
const faults: [string, (workflow: Workflow) => void, string][] = [
  [
    "a /6 denominator",
    (w) => {
      // Keeps the generated spacing; LE2's one-error check fails if there is no SHARD to change.
      const env = step(w, "next", "vitest").env!;

      if (env.SHARD !== undefined) {
        env.SHARD = env.SHARD.replace(/\|\| 5(\s*\}\})$/, "|| 6$1");
      }
    },
    "next's vitest step passes --shard <leg>/<the count of numbered legs>",
  ],
  [
    "leg 5 dropped",
    (w) => {
      setLegs(w, legsOf(w).slice(0, -1));
    },
    "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries",
  ],
  [
    "the end-to-end step back on leg 1",
    (w) => {
      step(w, "next", "end to end").if = step(w, "next", "end to end").if!.replace(onE2e, "matrix.shard == '1'");
    },
    `next runs ${e2eCommand} once, only on the e2e legs, with its pinned condition`,
  ],
  [
    "the `if` taken off the vitest step",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "vitest"), "if");
    },
    "next's vitest step runs only on the numbered legs, and has no other guard",
  ],
  // T967. E1's `e2e-2, e2e-1` order, E2's `/N` one more than the e2e legs, and E3's advice before
  // the end-to-end step, each planted alone; each names itself and nothing else.
  [
    "the e2e legs written out of order",
    (w) => {
      const legs = legsOf(w);
      const count = legs.filter((leg) => typeof leg === "string" && leg.startsWith("e2e-")).length;
      legs.splice(0, count, ...legs.slice(0, count).toReversed());

      // One e2e leg cannot be out of order, so a second one comes first.
      if (count === 1) {
        legs.unshift("e2e-2");
        step(w, "next", "end to end").env!.SHARD = e2eShard(2);
      }

      setLegs(w, legs);
    },
    "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries",
  ],
  [
    "an end-to-end /N one more than the e2e legs",
    (w) => {
      const env = step(w, "next", "end to end").env!;
      env.SHARD = (env.SHARD ?? "").replace(
        /\|\| (\d+)(\s*\}\})$/,
        (_, count: string, end: string) => `|| ${Number(count) + 1}${end}`,
      );
    },
    "next's end-to-end step passes --shard <leg>/<the count of e2e legs>",
  ],
  [
    "the timing advice before the end-to-end step",
    (w) => {
      const [advice] = w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
      w.jobs.next.steps.splice(place(w, "next", "end to end"), 0, advice!);
    },
    "next timing advice follows both test steps even after failure, unless cancelled",
  ],
];

it.each(faults)("LE2: names %s when it alone is planted", (_fault, mutate, error) => {
  fc.assert(
    fc.property(wiring, (clean) => {
      expect(lint(JSON.stringify(clean))).toEqual([]);
      const broken = structuredClone(clean);
      mutate(broken);
      expect(lint(JSON.stringify(broken))).toEqual([`check.yaml: ${error}`]);
    }),
    options,
  );
});

it("L7: a check job without its ratchet step is named by that one error", () => {
  fc.assert(
    fc.property(wiring, (broken) => {
      broken.jobs.check.steps.splice(place(broken, "check", "lists only shrink"), 1);
      const errors = lint(JSON.stringify(broken));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("ratchet.ts");
    }),
    options,
  );
});

it("L7 scenario: the checked-in check.yaml fails with its ratchet step deleted, given an if, or given another base", () => {
  const real = () => parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(real()))).toEqual([]);

  for (const mutate of [
    (w: Workflow) => {
      w.jobs.check.steps.splice(place(w, "check", "lists only shrink"), 1);
    },
    (w: Workflow) => {
      step(w, "check", "lists only shrink")["if"] = build;
    },
    (w: Workflow) => {
      step(w, "check", "lists only shrink")["env"] = { BASE: env.BASE };
    },
  ]) {
    const broken = real();
    mutate(broken);
    expect(lint(JSON.stringify(broken))).not.toEqual([]);
  }
});

// Ticket 988. A pull request whose every path matches check.yaml's `paths-ignore` starts no run, so
// each such path must be one changes.mjs already runs no heavy job for: every job changes.mjs
// names stays off, on a draft and on a ready pull request. Only the field flag
// may be on, for a row, and `pnpm lint` checks rows (field-check.ts --local). The paths are made
// from each pattern, each `*` any name without a `/` as in GitHub's filters (the lint allows no
// other wildcard), with the repo's own tracked files that match. Plants, each run once on
// changes.mjs and restored: `plan` as a folder a program reads (red); `docs/` as a read tree (red).
const globOf = (glob: string) =>
  new RegExp(
    `^${glob
      .split("*")
      .map((part) => part.replace(/[.^$+?()[\]{}|\\]/g, String.raw`\$&`))
      .join("[^/]*")}$`,
  );

const ignoredBy = (path: string) => ignored.some((glob) => globOf(glob).test(path));
const fill = fc.string({ maxLength: 12 }).filter((text) => !text.includes("/") && !text.includes("\0"));

const fromGlob = fc.constantFrom(...ignored).chain((glob) => {
  const [first = "", ...rest] = glob.split("*");
  return fc
    .array(fill, { minLength: rest.length, maxLength: rest.length })
    .map((fills) => rest.reduce((path, part, i) => `${path}${fills[i]}${part}`, first));
});

const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .stdout.split("\0")
  .filter((path) => path !== "" && ignoredBy(path));

it("ticket 988: every path a pull request ignores runs no heavy job in changes.mjs, on a draft and a ready one", () => {
  expect(tracked.length).toBeGreaterThan(0);
  fc.assert(
    fc.property(
      fc.array(fc.oneof(fromGlob, fc.constantFrom(...tracked)), { minLength: 1, maxLength: 4 }),
      fc.boolean(),
      (paths, draft) => {
        expect(paths.every(ignoredBy)).toBe(true);
        // Every job but the field rows' is off, whatever jobs changes.mjs grows or drops.
        const { field, ...heavy } = jobs(paths, "pull_request", draft);
        expect(Object.keys(heavy).length).toBeGreaterThan(0);
        expect(Object.entries(heavy).filter(([, on]) => on)).toEqual([]);
        expect(field).toBe(paths.some(isFieldPath));
      },
    ),
    {
      ...options,
      examples: [
        // Pull request 1248, the waste ticket 988 names: one lane plan and two finding rows.
        [
          [
            "docs/plan/lanes/t290-s2-PLAN.md",
            "field/findings/2026-11-14-a-row.json",
            "field/findings/2026-11-14-another-row.json",
          ],
          true,
        ],
        [["docs/plan/.md", "field/runs/.json"], false],
      ],
    },
  );
});

it("pinned: ticket 988's list leaves out what changes.mjs or a reader still checks", () => {
  // A folder a program reads, skill prose, the old logs, a row of the wrong kind and a nested plan
  // folder all start the run: each is outside the list.
  for (const path of [
    "docs/plan/brief/x.md",
    "docs/plan/lanes/prompts/x.md",
    ".agents/skills/lead/SKILL.md",
    "field/runs.jsonl",
    "field/findings/x.md",
    "field/findings/a/b.json",
    "docs/plan/x.ts",
    "AGENTS.md",
  ]) {
    expect(ignoredBy(path), path).toBe(false);
  }
});

// F1, ticket 990. The stop step is invisible to every other law, so a job without it gets exactly
// the one error that names that job, and a job that has it gains no error from the others.
it.each(stopping)("F1: %s without its stop step is named by that one error", (job) => {
  fc.assert(
    fc.property(wiring, (broken) => {
      stepsOf(broken, job).pop();
      expect(lint(JSON.stringify(broken))).toEqual([
        `check.yaml: F1: ${job} ends with the stop step, its one step that cancels the run`,
      ]);
    }),
    options,
  );
});

it("F1 scenario: in the checked-in check.yaml every job but ci-required ends with the stop step, and loses it alone", () => {
  // The YAML anchor `&stop` in changes and its aliases elsewhere, read as GitHub reads them. Each
  // job's last step taken off gives that job's one error, so each alias lands where the law looks.
  const real = () => parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
  const jobs = Object.keys(real().jobs).filter((job) => job !== "ci-required");
  expect(jobs.length).toBeGreaterThan(0);

  for (const job of jobs) {
    const broken = real();
    expect(broken.jobs[job].steps.at(-1)).toEqual(stop);
    broken.jobs[job].steps.pop();
    expect(lint(JSON.stringify(broken))).toEqual([
      `check.yaml: F1: ${job} ends with the stop step, its one step that cancels the run`,
    ]);
  }
});

it("format: the checked-in workflow passes the same wiring lint", () => {
  // A fixed file read is a format check. Structural decisions live in the linter.
  expect(lint(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"))).toEqual([]);
});

// The caches: saved on main only, the shared setup never saves, full-history checkouts are
// blobless, and the typecheck's buildinfo cache keys on the lockfile and every tsconfig.
type Step = Record<string, unknown> & { with?: Record<string, unknown> };

type Jobs = Record<
  string,
  {
    steps: Step[];
    strategy?: { matrix: Record<string, unknown> };
    outputs?: Record<string, string>;
    needs?: string | string[];
  }
>;

type Files = { workflows: Record<string, Parsed>; action: Parsed; workspace: Parsed; typecheck: string };
type Parsed = Record<string, unknown> & { jobs: Jobs; runs: { steps: Step[] } };

const realFiles = (): Files => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const files = cacheFiles(read);
  return {
    workflows: Object.fromEntries(Object.entries(files.workflows).map(([path, text]) => [path, parse(text)])),
    action: parse(files.action),
    workspace: parse(files.workspace),
    typecheck: files.typecheck,
  };
};

const text = (files: Files) => ({
  workflows: Object.fromEntries(Object.entries(files.workflows).map(([path, w]) => [path, JSON.stringify(w)])),
  action: JSON.stringify(files.action),
  workspace: JSON.stringify(files.workspace),
  typecheck: files.typecheck,
});

const checkYaml = (files: Files) => files.workflows[".github/workflows/check.yaml"]!;
const typecheckStep = (files: Files, name: string) => step(checkYaml(files), "typecheck", name);
// The shared setup's steps, read as the one job of a workflow.
const setup = (files: Files) => ({ jobs: { setup: files.action.runs } });

it("C0: the checked-in workflows, setup, workspace and typecheck pass the cache lint", () => {
  expect(lintCaches(text(realFiles()))).toEqual([]);
});

it("C0 state: a workflow that runs by hand on main may keep setup-node's cache", () => {
  const files = realFiles();
  const mutation = files.workflows[".github/workflows/mutation.yaml"];
  expect(mutation?.["on"]).not.toHaveProperty("pull_request");
  expect(JSON.stringify(mutation)).toContain('"cache":"pnpm"');
  expect(lintCaches(text(files))).toEqual([]);
});

// Each plant on the checked-in files, one at a time, and the one error it must give.
for (const [name, plant, error] of [
  [
    "C1: actions/cache, which saves on every ref",
    (f: Files) => {
      step(f.workflows[".github/workflows/host.yaml"]!, "launchd", "restore electron")["uses"] = "actions/cache@v6";
    },
    ".github/workflows/host.yaml: use actions/cache/restore, and actions/cache/save on main only",
  ],
  [
    "C1: setup-node's own cache in the shared setup",
    (f: Files) => {
      step(setup(f), "setup", "node").with!["cache"] = "pnpm";
    },
    ".github/actions/pnpm/action.yml: setup-node's cache saves on every ref; use .github/actions/pnpm",
  ],
  [
    "C2: the shared setup saving on main",
    (f: Files) => {
      f.action.runs.steps.push({ uses: "actions/cache/save@v6", if: `\${{ github.ref == 'refs/heads/main' }}` });
    },
    "the pnpm action caches nothing: a restored pnpm store cost more than its download",
  ],
  [
    "C2: the shared setup restoring the store",
    (f: Files) => {
      f.action.runs.steps.push({ uses: "actions/cache/restore@v6", with: { path: "~/.local/share/pnpm/store" } });
    },
    "the pnpm action caches nothing: a restored pnpm store cost more than its download",
  ],
  [
    "C2: a save with no if",
    (f: Files) => {
      delete typecheckStep(f, "save the tsc cache")["if"];
    },
    ".github/workflows/check.yaml: a cache save runs on main only, its if starting github.ref=='refs/heads/main'",
  ],
  [
    "C2: a save on every ref after a failure",
    (f: Files) => {
      typecheckStep(f, "save the tsc cache")["if"] = `\${{ always() }}`;
    },
    ".github/workflows/check.yaml: a cache save runs on main only, its if starting github.ref=='refs/heads/main'",
  ],
  [
    "C3: a full-history checkout with every blob",
    (f: Files) => {
      delete step(checkYaml(f), "test", "checkout").with!["filter"];
    },
    "check.yaml: test's full-history checkout is blobless (filter: blob:none)",
  ],
  [
    "C4: a restore prefix without the lockfile and tsconfig hash",
    (f: Files) => {
      typecheckStep(f, "restore the tsc cache").with!["restore-keys"] = `tsc-\${{ runner.os }}-`;
    },
    `check.yaml: the tsc cache's key is tsc-\${{ runner.os }}-\${{ steps.tsc-key.outputs.hash }}-<sha>, and it restores only that prefix`,
  ],
  [
    "C4: a hash that leaves the tsconfigs out",
    (f: Files) => {
      typecheckStep(f, "tsc key")["run"] =
        'echo "hash=$(git ls-files -s pnpm-lock.yaml | git hash-object --stdin)" >> "$GITHUB_OUTPUT"';
    },
    "check.yaml: the typecheck job's tsc-key step hashes git ls-files -s pnpm-lock.yaml '*tsconfig*.json' | git hash-object --stdin",
  ],
  [
    "C4: a workspace package glob the cache does not hold",
    (f: Files) => {
      (f.workspace["packages"] as string[]).push("tools/*");
    },
    "check.yaml: the tsc cache restores and saves node_modules/.cache/tsc in each pnpm-workspace.yaml package glob, in its order",
  ],
  [
    "C4: a buildinfo folder the cache does not hold",
    (f: Files) => {
      f.typecheck = f.typecheck.replace("node_modules/.cache/tsc/", "node_modules/.cache/tsc-old/");
    },
    "check.yaml: the tsc cache restores and saves node_modules/.cache/tsc-old in each pnpm-workspace.yaml package glob, in its order",
  ],
  [
    "C4: a restore after the typecheck",
    (f: Files) => {
      const workflow = checkYaml(f);
      const list = workflow.jobs["typecheck"]!.steps;
      const [restore] = list.splice(place(workflow, "typecheck", "restore the tsc cache"), 1);
      list.splice(place(workflow, "typecheck", "typecheck") + 1, 0, restore!);
    },
    "check.yaml: the typecheck job installs, restores the tsc cache, typechecks, then saves",
  ],
] as const) {
  it(`${name} is named by its one error`, () => {
    const files = realFiles();
    plant(files);
    expect(lintCaches(text(files))).toEqual([error]);
  });
}

// T1 to T5 on the checked-in check.yaml: each plant puts back one piece of how today's tests ran
// before 0533, and gives its one error.
const testError =
  "check.yaml: T1: the test job runs exactly its install, the tooling tests, shard times and its time table, once each";

for (const [name, plant, error] of [
  [
    "T1: the today flag back on changes",
    (w: Parsed) => {
      w.jobs["changes"]!.outputs = { ...w.jobs["changes"]!.outputs, today: `\${{ steps.diff.outputs.today }}` };
    },
    "check.yaml: S1: changes exposes its flags, filter and the size step's outputs, and nothing else",
  ],
  [
    "T1: today's six-machine test step back beside the tooling tests",
    (w: Parsed) => {
      w.jobs["test"]!.steps.splice(place(w, "test", "tooling tests"), 0, {
        name: "test",
        run: "pnpm exec vitest run --shard \"$SHARD\" --exclude 'next/**'",
      });
    },
    testError,
  ],
  [
    "T2: the e2e job back, with its place in ci-required's needs",
    (w: Parsed) => {
      // With the stop step last, as every job but ci-required ends (F1).
      const run = { run: "pnpm --filter @kampus/fabrika-app-old e2e" };
      Object.assign(w.jobs, {
        e2e: { needs: "changes", "timeout-minutes": 25, steps: [run, w.jobs["check"]!.steps.at(-1)] },
      });
      w.jobs["ci-required"]!.needs = [...[w.jobs["ci-required"]!.needs ?? []].flat(), "e2e"];
    },
    "check.yaml: T2: e2e runs nothing of today's app",
  ],
  [
    "T6: the promises gate back in check, on the check flag, before the field rows",
    (w: Parsed) => {
      // On the check flag like every lint step, and before the rows, so check's own step law (F1)
      // has nothing to say.
      w.jobs["check"]!.steps.splice(place(w, "check", "field rows"), 0, {
        name: "promises",
        if: checkFlag,
        env: { BASE: `\${{ github.event.pull_request.base.sha }}` },
        run: 'if [ -n "$BASE" ]; then\n  pnpm promises gate --base "$BASE"\nelse\n  pnpm promises gate\nfi\n',
      });
    },
    "check.yaml: T6: check runs no promise check of today's version",
  ],
  [
    "T5: six machines",
    (w: Parsed) => {
      w.jobs["test"]!.strategy!.matrix["shard"] = [1, 2, 3, 4, 5, 6];
    },
    "check.yaml: T5: the test job runs on 2 machines, a plain list",
  ],
  [
    "T4: the tooling step dividing by six on two machines",
    (w: Parsed) => {
      (step(w, "test", "tooling tests")["env"] as Record<string, string>)["SHARD"] = `\${{ matrix.shard }}/6`;
    },
    "check.yaml: T4: the tooling tests run on every test run, their shard of two, on the pull request's, the group's or the push's base",
  ],
] as const) {
  it(`scenario: ${name} is named by its one error`, () => {
    // scenario: the real workflow with one of the old pieces planted back, so the lint's own words
    // for each are read here.
    const workflow: Parsed = parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
    plant(workflow);
    expect(lint(JSON.stringify(workflow))).toEqual([error]);
  });
}

it("T1 (0536): the tooling project, the test job's one project, holds no glob of today's trees or of next/", () => {
  // A project ignores `--exclude`, so the project's own globs are what keeps today's tests and next/'s
  // out of the test job. Plant, run once on vitest.config.ts and restored: add
  // "apps/*/src/**/*.test.ts" to the tooling project (red).
  const tooling = projects.find((project) => project.test.name === "tooling");
  expect(tooling).toBeDefined();
  expect(tooling!.test.include.length).toBeGreaterThan(0);
  expect(tooling!.test.include.filter((glob) => /^(?:apps|packages|programs|next)\//.test(glob))).toEqual([]);
});

// TT1 and TT2 on the checked-in check.yaml: the lint's own words for each, one error each.
for (const [name, plant, error] of [
  [
    "TT1: next's time table skips a red leg",
    (w: Parsed) => {
      step(w, "next", "time table")["if"] = "success()";
    },
    "check.yaml: TT1: next ends its commands with the time table step once, on every result, never failing the job, reading next.json",
  ],
  [
    "TT2: the test job's timings lose the attempt",
    (w: Parsed) => {
      // The upload is one YAML alias in both test jobs, so the plant takes this job's own copy.
      const list = w.jobs["test"]!.steps;
      const at = place(w, "test", "timings");
      list[at] = structuredClone(list[at]!);
      (list[at]["with"] as Record<string, unknown>)["name"] = `timings-\${{ github.job }}-\${{ matrix.shard }}`;
    },
    "check.yaml: TT2: test uploads its timings file once, after the time table step, on every result, never failing the job, within a minute",
  ],
  [
    "M1: typecheck runs the time table's command with the token and a loader beside it",
    (w: Parsed) => {
      // Before its stop step, which stays last (F1).
      w.jobs["typecheck"]!.steps.splice(-1, 0, tableElsewhere());
    },
    "check.yaml: M1: only changes' classify step and the test jobs' time tables get the token",
  ],
] as const) {
  it(`scenario: ${name} is named by its one error`, () => {
    const workflow: Parsed = parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
    plant(workflow);
    expect(lint(JSON.stringify(workflow))).toEqual([error]);
  });
}

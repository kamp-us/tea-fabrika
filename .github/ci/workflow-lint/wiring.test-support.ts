// Today's CI, serving both versions. What the workflow-lint tests share: `wiring`, a generated
// valid check.yaml, lookups of a step by its name, and `rejects`, which gives each listed plant to
// every generated valid workflow, one at a time, so an unrelated error cannot mask it.
// T342: all 24 input plants were rejected in each of 100 generated workflows.
// A source plant ignoring next's required job condition failed this property too.
import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { ignored } from "../changes.mjs";
import { lintWorkflow as lint } from "../workflow-lint.ts";

export const options = { seed: 119120, numRuns: 100 };

export const guard = (job: string) =>
  `\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${job} != 'false') }}`;

export const env = {
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
export const token = `\${{ github.token }}`;

const classify = { ...diff, env: { ...diff.env, GITHUB_TOKEN: token } };

export const build = `\${{ needs.changes.outputs.build != 'false' }}`;

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
export type Timed = Record<string, unknown> & {
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
export const step = <W extends { jobs: object }, J extends keyof W["jobs"] & string>(
  w: W,
  job: J,
  name: string,
): StepOf<W["jobs"][J]> => {
  // SAFETY: every workflow `valid` builds has a `jobs` map whose jobs each hold a `steps` list of the job's own step type.
  const steps = (w.jobs as Record<string, { steps: StepOf<W["jobs"][J]>[] } | undefined>)[job]?.steps ?? [];
  // SAFETY: a step is any object here; `name` is only probed, and compared with a string, so a missing name reads as no match.
  const [found, ...more] = steps.filter((s) => (s as { name?: unknown }).name === name);

  if (found === undefined || more.length > 0) {
    throw new Error(
      `${job} has ${more.length + (found === undefined ? 0 : 1)} steps named "${name}"; a lookup needs exactly one`,
    );
  }

  return found;
};

/** Where `job`'s step named `name` sits, for a plant that moves or removes it. */
export const place = <W extends { jobs: object }, J extends keyof W["jobs"] & string>(w: W, job: J, name: string) => {
  const found = step(w, job, name);

  // SAFETY: `jobs` in a `valid` workflow maps each job to an object with a `steps` list.
  return (w.jobs as Record<string, { steps: unknown[] }>)[job]?.steps.indexOf(found) ?? -1;
};

export const testEnv = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`,
};

// 0524, ticket 933 (L7): the check job's one ratchet step, which holds every list file to shrinking.
export const ratchet = 'node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"';

export const probe = "steps.diff.outputs.probe == 'true'";

// The check job's steps, each on its own flag (ticket 985): lint on check, the rows on field.
export const checkFlag = `\${{ needs.changes.outputs.check != 'false' }}`;

const rowsFlag = `\${{ !cancelled() && needs.changes.outputs.field != 'false' }}`;

const rowsAlone = `\${{ needs.changes.outputs.check == 'false' }}`;

const rowInstall = "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts";

const name = fc.string({ maxLength: 20 });

// T967: the next job's legs are `e2e-1` to `e2e-N`, then "1" to "5". Only the shape is the lint's;
// N is E4's, in vitest.shards.test.ts, so the generated workflows below vary it.
export const onE2e = "startsWith(matrix.shard, 'e2e-')";

export const e2eCommand = `pnpm exec vitest run --project next-visual $CHANGED --shard "\${SHARD#e2e-}" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"`;

// 0536: the vitest step tests the `next` project alone, on every event.
const vitestCommand =
  'pnpm exec vitest run --project next $FILTER --shard "$SHARD" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"';

// 0536: a pull request that asked for its visual tests.
export const visualLabel = "contains(github.event.pull_request.labels.*.name, 'visual')";

export const visualRoute =
  "(github.event_name == 'pull_request' || github.event_name == 'merge_group' || github.event_name == 'push')";

const automatic = parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));

// Chromium is fetched only once a visual file exists.
const visualFiles = "hashFiles('next/**/*.visual.test.ts', 'next/**/*.visual.test.tsx') != ''";

// 0534: the end-to-end legs narrow from changes' `base`, the commit the size step sized them from, on
// every run it sized: a pull request, a merge queue group and a push to main alike.
const changedFromBase = `\${{ needs.changes.outputs.base && format('--changed={0} --passWithNoTests', needs.changes.outputs.base) || '' }}`;

// Before 0534: on a pull request only, so the merge queue and main ran every end-to-end file.
export const changedOnPullRequests = `\${{ github.event_name == 'pull_request' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;

// The vitest step's paths: changes' size step's list on a sized run, reader tests included, else changes'
// filter (the plan for CI paths, slice 2), else both roots of the `next` project, next/ and kalfa/ (O4).
const vitestFilter = `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'next/ kalfa/' }}`;

export const nextLegs = (count: number) => [
  ...Array.from({ length: count }, (_, i) => `e2e-${i + 1}`),
  "1",
  "2",
  "3",
  "4",
  "5",
];

// S1: the matrix is changes' `shards`, else a fallback (legs.ts): the full matrix on a pull request
// with the `visual` label, the vitest legs alone everywhere else (0536, E10).
export const sizedLegs = (legs: readonly unknown[], plain: readonly unknown[] = ["1", "2", "3", "4", "5"]) =>
  `\${{ fromJSON(needs.changes.outputs.shards || (${visualRoute} && '${JSON.stringify(legs)}' || '${JSON.stringify(plain)}')) }}`;

/** The full matrix a workflow's next job falls back to, as `sizedLegs` wrote it. */
export const legsOf = (w: { jobs: { next: { strategy: { matrix: { shard: string } } } } }): unknown[] =>
  JSON.parse(/&& '(.*?)' \|\|/s.exec(w.jobs.next.strategy.matrix.shard)?.[1] ?? "[]");

export const setLegs = (
  w: { jobs: { next: { strategy: { matrix: { shard: string } } } } },
  legs: readonly unknown[],
) => {
  w.jobs.next.strategy.matrix.shard = sizedLegs(legs);
};

// A leg's `--shard`: its own kind's count from changes' size step, else the full matrix's.
export const vitestShard = (gap = " ") =>
  `\${{${gap}matrix.shard${gap}}}/\${{${gap}needs.changes.outputs.vitest-legs || 5${gap}}}`;

export const e2eShard = (count: number | string, gap = " ") =>
  `\${{${gap}matrix.shard${gap}}}/\${{${gap}needs.changes.outputs.e2e-legs || ${count}${gap}}}`;

// S1: changes' sizing install and size step run only when it sizes next, all of it or the reader
// tests alone; its setup also for the parser.
const sized = "(steps.same.outputs.next || steps.diff.outputs.next) != 'false'";

const toolsFor = `${probe} || steps.diff.outputs.next != 'false'`;

// Fail fast (ticket 990, F1 to F3): the step every job but ci-required ends with. On a pull request
// or a merge queue group, once an earlier step failed, it cancels the run; ci-required's `always()`
// keeps it running through a normal cancel. A push to main runs to the end.
export const stop = {
  name: "stop the run",
  if: `\${{ failure() && github.event_name != 'push' }}`,
  env: { GH_TOKEN: `\${{ github.token }}` },
  run: 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"',
};

// Every job that carries the stop step: all of them but ci-required.
export const stopping = ["changes", "check", "typecheck", "next"] as const;

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
export const loader = "--import ./x.mjs";

export const tableElsewhere = (): Timed => ({
  run: "node .github/ci/time-table.ts",
  env: { GITHUB_TOKEN: token, NODE_OPTIONS: loader },
});

export const timings = (): Timed => ({
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
  // SAFETY: the top-level grant is widened to unknown on purpose, so a plant can set it to any shape GitHub might read.
  permissions: { actions: "write", contents: "read" } as unknown,
  on: {
    push: { branches: ["main"] },
    pull_request: {
      types: ["opened", "synchronize", "reopened", "ready_for_review", "labeled"],
      // SAFETY: widened from a fixed tuple so a plant can drop paths-ignore or set its own list.
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
      // SAFETY: every value below is a string, and the wider map type lets a plant add or remove an output.
      outputs: {
        ...Object.fromEntries(
          ["check", "typecheck", "field", "build"].map((key) => [key, `\${{ steps.diff.outputs.${key} }}`]),
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
        related: automatic.jobs.changes.outputs.related,
      } as Record<string, string>,
      // SAFETY: changes' steps are object literals, widened to plain maps so a plant can add, move or retype a field.
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
            FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/ kalfa/' }}`,
            BASE: env.BASE,
            VISUAL: `\${{ ${visualLabel} }}`,
            BUDGET: 240,
          },
          run: "node .github/ci/legs.ts",
        },
        // Q1: a ready pull request run's record of the tree it tests, for the merge queue.
        {
          name: "record",
          id: "record",
          if: "github.event_name == 'pull_request' && !github.event.pull_request.draft",
          "continue-on-error": true,
          // SAFETY: each key below maps to a string, and the map type lets a plant add or delete one.
          env: {
            ...diff.env,
            TESTED: `\${{ github.sha }}`,
            ...Object.fromEntries(
              ["check", "typecheck", "field", "build"].map((key) => [
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
          // SAFETY: the upload's inputs, widened to a map so a plant can set any input to any value.
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
      // SAFETY: check's steps are object literals, widened to plain maps so plants can edit any field.
      steps: [
        { name: "checkout", uses: "actions/checkout@v7", with: { "fetch-depth": 0, "persist-credentials": false } },
        { name: "install", if: checkFlag, run: "pnpm install --frozen-lockfile" },
        { name: "install the row check", if: rowsAlone, run: rowInstall },
        {
          name: "copies (advice)",
          if: checkFlag,
          "continue-on-error": true,
          env: { BASE: `\${{ github.event.pull_request.base.sha }}` },
          run: 'node .github/ci/copies.ts --base "$BASE"',
        },
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
    select: structuredClone(automatic.jobs.select),
    related: structuredClone(automatic.jobs.related),
    next: {
      // SAFETY: widened from the one string so a plant can give next a list of needs, as GitHub allows.
      needs: "changes" as string | string[],
      if: guard("next"),
      "timeout-minutes": 17,
      strategy: { "fail-fast": false, matrix: { shard: sizedLegs(nextLegs(2)) } },
      steps: nextSteps([
        {
          name: "vitest",
          run: vitestCommand,
          if: `!${onE2e}`,
          env: { SHARD: vitestShard(), FILTER: vitestFilter, FABRIKA_TEST_DEPTH: "full" },
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
          env: { SHARD: e2eShard(2), CHANGED: changedFromBase, FABRIKA_TEST_DEPTH: "full" },
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
      needs: ["changes", "check", "typecheck", "next", "select", "related"],
      if: "always()",
      "timeout-minutes": 5,
      // SAFETY: ci-required's grant is widened to unknown so a plant can set any shape there.
      permissions: { contents: "read" } as unknown,
      // SAFETY: ci-required's steps are literals, widened to plain maps so a plant can edit them.
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

export type Workflow = ReturnType<typeof valid>;

/** A job's steps as one plain list, whatever its own step type. */
export const stepsOf = (w: Workflow, job: (typeof stopping)[number] | "ci-required"): Record<string, unknown>[] =>
  // SAFETY: each job's steps in `valid` are object literals, and every object literal is a map of fields.
  w.jobs[job].steps as Record<string, unknown>[];

/** Sets a next step's SHARD, kept in its place among the step's env keys. */
const setShard = (found: NextStep, shard: string) => {
  found.env = { ...found.env, SHARD: shard };
};

export const wiring = fc
  .tuple(name, name, fc.boolean(), fc.constantFrom("", " ", "  ", "\t", "\n"), fc.integer({ min: 1, max: 4 }))
  .map(([label, extra, whitespace, gap, e2es]) => {
    const clean = valid(label, extra);
    // E1 and E2: any count of e2e legs is the lint's shape, with its own `/N` on the end-to-end step.
    setLegs(clean, nextLegs(e2es));
    setShard(step(clean, "next", "end to end"), e2eShard(e2es));

    if (whitespace) {
      setShard(step(clean, "next", "vitest"), vitestShard(gap));
      setShard(step(clean, "next", "end to end"), e2eShard(e2es, gap));

      // The vitest step's guard and the three leg conditions, respaced around each operator.
      for (const guarded of ["vitest", "chromium", "end to end", "edges"].map((n) => step(clean, "next", n))) {
        guarded.if = `\${{${gap}${guarded.if?.replace(/ *(==|!=|&&) */g, `${gap}$1${gap}`)}${gap}}}`;
      }

      step(clean, "next", "shard times").if = `\${{${gap}!cancelled()${gap}}}`;
    }

    // TT1 and TT2: each test job ends its commands with its time table, then uploads its timings.
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

// The caches and the scenarios on the checked-in workflows read them as parsed YAML.
export type Parsed = Record<string, unknown> & { jobs: Jobs; runs: { steps: Step[] } };

/** One way to break a valid workflow, with its name. */
export type Plant = [string, (workflow: Workflow) => void];

/** Each plant alone, on every generated valid workflow: the clean one passes, the planted one fails. */
export const rejects = (plants: readonly Plant[]) =>
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

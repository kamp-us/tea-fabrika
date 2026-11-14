import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint, lintManifest } from "./workflow-lint.ts";

// The CI workflow's shape. Covers workflow-lint.ts. Each generated valid workflow
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
  id: "diff",
  env: { ...env, DRAFT: `\${{ github.event.pull_request.draft }}` },
  run: "node .github/ci/changes.mjs",
};

const testEnv = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`,
};

// 0524, ticket 933 (L7): the check job's one ratchet step, which holds every list file to shrinking.
const ratchet = 'node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"';

const fieldIf = "steps.diff.outputs.field == 'true'";
const probe = "steps.diff.outputs.probe == 'true'";
const name = fc.string({ maxLength: 20 });

// T967: the next job's legs are `e2e-1` to `e2e-N`, then "1" to "5". Only the shape is the lint's;
// N is E4's, in vitest.shards.test.ts, so the generated workflows below vary it.
const onE2e = "startsWith(matrix.shard, 'e2e-')";

const e2eCommand = `node next/apps/fabrika/e2e.ts $CHANGED --shard "\${SHARD#e2e-}" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"`;

// On a pull request only: the merge queue and main run the whole suite.
const changedOnPullRequests = `\${{ github.event_name == 'pull_request' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;

// The vitest step's: also empty when changes' filter names the reader tests, which read files as
// text, so the import graph would drop them (the plan for CI paths, slice 2).
const changedUnlessReaders = `\${{ github.event_name == 'pull_request' && (needs.changes.outputs.filter || 'next/') == 'next/' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;

const nextLegs = (count: number) => [
  ...Array.from({ length: count }, (_, i) => `e2e-${i + 1}`),
  "1",
  "2",
  "3",
  "4",
  "5",
];

const valid = (label: string, extra: string) => ({
  name: label,
  on: {
    push: { branches: ["main"] },
    pull_request: { types: ["opened", "synchronize", "reopened", "ready_for_review"] },
    merge_group: { types: ["checks_requested"] },
  },
  concurrency: {
    group: `check-\${{ github.event.pull_request.number || github.sha }}`,
    "cancel-in-progress": `\${{ github.event_name == 'pull_request' && github.event.action == 'synchronize' }}`,
  },
  jobs: {
    changes: {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 5,
      outputs: {
        ...Object.fromEntries(
          ["check", "typecheck", "test", "e2e", "field"].map((key) => [key, `\${{ steps.diff.outputs.${key} }}`]),
        ),
        // The plan for CI paths, slice 2: the parser's pass prints these two again.
        next: `\${{ steps.same.outputs.next || steps.diff.outputs.next }}`,
        filter: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter }}`,
      } as Record<string, string>,
      steps: [
        { uses: "actions/checkout@v7", with: { "fetch-depth": 0 } },
        diff,
        { run: "sh .agents/skills/lead/scripts/skillscheck.sh", if: "!cancelled()" },
        { run: "node oxlint-plugins/gitignore.mjs", if: "!cancelled()" },
        { run: "node .github/ci/freeze.mjs", if: `\${{ !cancelled() }}`, env },
        { name: extra, run: "echo checked" },
        // The parser's setup and pass, only when every changed line looks like a comment.
        { uses: "pnpm/action-setup@v6", if: probe, "continue-on-error": true, with: { run_install: false } },
        {
          uses: "actions/setup-node@v7",
          if: probe,
          "continue-on-error": true,
          with: { "node-version": "26.13.0" },
        },
        {
          run: "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts",
          if: probe,
          "continue-on-error": true,
        },
        { ...diff, id: "same", if: probe, "continue-on-error": true, run: "node .github/ci/changes.mjs --same" },
      ] as Record<string, unknown>[],
    },
    check: {
      name: `\${{ github.event.pull_request.draft && 'lint' || 'check' }}`,
      needs: "changes",
      if: guard("check"),
      "timeout-minutes": 10,
      steps: [
        { run: "pnpm lint" },
        { name: "next ledger committed", run: "git diff --exit-code -- next-ledger.json" },
        { name: "lists only shrink", env: testEnv, run: ratchet },
      ] as Record<string, unknown>[],
    },
    typecheck: {
      needs: "changes",
      if: guard("typecheck"),
      "timeout-minutes": 10,
      steps: [{ run: "pnpm install --frozen-lockfile" }, { run: "pnpm typecheck" }],
    },
    test: {
      needs: "changes",
      if: guard("test"),
      "timeout-minutes": 30,
      strategy: { matrix: { shard: [1, 2, 3, 4, 5, 6] } },
      steps: [
        { run: "pnpm install --frozen-lockfile" },
        {
          name: "test",
          env: testEnv,
          run: [
            'if [ -n "$BASE" ]; then',
            'pnpm exec vitest run --changed "$BASE" --shard "$SHARD" --passWithNoTests --exclude \'next/**\'',
            "else",
            "pnpm exec vitest run --shard \"$SHARD\" --passWithNoTests --exclude 'next/**'",
            "fi",
          ].join("\n"),
        },
        { name: "shard times", if: "!cancelled()", run: 'node .github/ci/shard-times.ts "$RUNNER_TEMP/test.json"' },
      ] as Record<string, unknown>[],
    },
    next: {
      needs: "changes",
      if: guard("next"),
      "timeout-minutes": 17,
      strategy: { "fail-fast": false, matrix: { shard: nextLegs(2) as (string | number)[] } },
      steps: [
        {
          run: 'pnpm exec vitest run $FILTER $CHANGED --shard "$SHARD" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"',
          if: `!${onE2e}`,
          env: {
            SHARD: `\${{ matrix.shard }}/5`,
            FILTER: `\${{ needs.changes.outputs.filter || 'next/' }}`,
            CHANGED: changedUnlessReaders,
          },
        },
        {
          name: "chromium",
          if: `${onE2e} && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''`,
          run:
            "sudo sh .github/ci/apt.sh update\n" +
            "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium\n",
        },
        { run: e2eCommand, if: onE2e, env: { SHARD: `\${{ matrix.shard }}/2`, CHANGED: changedOnPullRequests } },
        {
          name: "edges",
          if: "matrix.shard == '1' && github.event_name == 'pull_request'",
          env: { BASE: `\${{ github.event.pull_request.base.sha }}` },
          run: 'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
        },
        { run: "pnpm install --frozen-lockfile" },
        { name: "shard times", if: "!cancelled()", run: 'node .github/ci/shard-times.ts "$RUNNER_TEMP/next.json"' },
      ],
    },
    e2e: {
      needs: "changes",
      if: guard("e2e"),
      "timeout-minutes": 5,
      steps: [{ name: "e2e", run: 'echo "today\'s end-to-end tests are removed (0525)"\nexit 1\n' }] as Record<
        string,
        unknown
      >[],
    },
    field: {
      "timeout-minutes": 5,
      steps: [
        { uses: "actions/checkout@v7", with: { "fetch-depth": 0 } },
        diff,
        { uses: "pnpm/action-setup@v6", if: fieldIf },
        { uses: "actions/setup-node@v7", if: fieldIf, with: { "node-version": "26.13.0" } },
        {
          run: "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts",
          if: fieldIf,
        },
        { run: "node .github/ci/field-check.ts", if: fieldIf, env },
      ],
    },
    "ci-required": {
      name: `\${{ github.event.pull_request.draft && 'ci-required (draft)' || 'ci-required' }}`,
      needs: ["changes", "field", "check", "typecheck", "e2e", "test", "next"],
      if: "always()",
      "timeout-minutes": 5,
      steps: [
        { uses: "actions/checkout@v7", with: { "sparse-checkout": ".github/ci" } },
        { env: { NEEDS: `\${{ toJSON(needs) }}` }, run: "node .github/ci/required.mjs" },
      ] as Record<string, unknown>[],
    },
  },
});

type Workflow = ReturnType<typeof valid>;

const wiring = fc
  .tuple(name, name, fc.boolean(), fc.constantFrom("", " ", "  ", "\t", "\n"), fc.integer({ min: 1, max: 4 }))
  .map(([label, extra, whitespace, gap, e2es]) => {
    const clean = valid(label, extra);
    // E1 and E2: any count of e2e legs is the lint's shape, with its own `/N` on the end-to-end step.
    clean.jobs.next.strategy.matrix.shard = nextLegs(e2es);
    clean.jobs.next.steps[2]!.env!.SHARD = `\${{ matrix.shard }}/${e2es}`;

    if (whitespace) {
      clean.jobs.next.steps[0]!.env!.SHARD = `\${{${gap}matrix.shard${gap}}}/5`;
      clean.jobs.next.steps[2]!.env!.SHARD = `\${{${gap}matrix.shard${gap}}}/${e2es}`;

      // The vitest step's guard and the three leg conditions, respaced around each operator.
      for (const step of clean.jobs.next.steps.slice(0, 4)) {
        step.if = `\${{${gap}${step.if?.replace(/ *(==|!=|&&) */g, `${gap}$1${gap}`)}${gap}}}`;
      }

      clean.jobs.next.steps[5]!.if = `\${{${gap}!cancelled()${gap}}}`;
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

it.each(extraCommands)("pinned: T376 review extra command in real workflow: $run", (step) => {
  const workflow = parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(workflow))).toEqual([]);
  workflow.jobs.next.steps.push(step);
  expect(lint(JSON.stringify(workflow))).not.toEqual([]);
});

const plants: [string, (workflow: Workflow) => void][] = [
  // 0134's amendment (2026-11-11): a draft runs the fast jobs, and marking it ready runs the rest.
  ...["opened", "synchronize", "reopened", "ready_for_review"].map((type): [string, (w: Workflow) => void] => [
    `pull requests lose the ${type} trigger`,
    (w) => {
      w.on.pull_request.types = w.on.pull_request.types.filter((t) => t !== type);
    },
  ]),
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
  // D6: check runs nothing of today's version, and none of its steps skips on a draft.
  [
    "D6: the promises gate comes back",
    (w) => {
      w.jobs.check.steps.push({ name: "promises", run: "pnpm promises gate" });
    },
  ],
  [
    "D6: the build of today's packages comes back",
    (w) => {
      w.jobs.check.steps.push({ run: "pnpm build" });
    },
  ],
  [
    "D6: the dead exports ledger step comes back",
    (w) => {
      w.jobs.check.steps.push({
        name: "dead exports ledger committed",
        run: "git diff --exit-code -- unreachable-ledger.json",
      });
    },
  ],
  [
    "lint skips on a draft",
    (w) => {
      w.jobs.check.steps[0]!["if"] = `\${{ needs.changes.outputs.check != 'false' }}`;
    },
  ],
  ...(["build", "today"] as const).map((flag): [string, (w: Workflow) => void] => [
    `D3: changes exposes today's ${flag} flag again`,
    (w) => {
      (w.jobs.changes.outputs as Record<string, string>)[flag] = `\${{ steps.diff.outputs.${flag} }}`;
    },
  ]),
  [
    "the classifier is not told the draft",
    (w) => {
      for (const step of [w.jobs.changes.steps[1]!, w.jobs.field.steps[1]!]) {
        Object.assign(step, { env });
      }
    },
  ],
  // D5: one test step over everything but next/, and its shard times.
  [
    "D5: the lane step comes back",
    (w) => {
      w.jobs.test.steps.splice(1, 0, {
        name: "lane tests, one file at a time",
        env: testEnv,
        run: "pnpm exec vitest run packages/pipeline/src/stages/pipeline/lane. --shard \"$SHARD\" --maxWorkers=1 --passWithNoTests --exclude 'next/**'",
      });
    },
  ],
  [
    "D5: the apt step comes back",
    (w) => {
      w.jobs.test.steps.splice(0, 0, {
        name: "apt packages",
        run: "sudo sh .github/ci/apt.sh install expect zsh bubblewrap socat ripgrep",
      });
    },
  ],
  [
    "D5: the test step runs on today's flag",
    (w) => {
      w.jobs.test.steps[1]!["if"] = `\${{ !cancelled() && needs.changes.outputs.today != 'false' }}`;
    },
  ],
  [
    "D5: a second vitest step",
    (w) => {
      w.jobs.test.steps.splice(2, 0, { ...w.jobs.test.steps[1]!, name: "tooling tests" });
    },
  ],
  [
    "D5: the shard times are gone",
    (w) => {
      w.jobs.test.steps.splice(2, 1);
    },
  ],
  [
    "D5: a failure skips the shard times",
    (w) => {
      w.jobs.test.steps[2]!["if"] = "";
    },
  ],
  [
    "D5: the shard times come before the tests",
    (w) => {
      w.jobs.test.steps.reverse();
    },
  ],
  [
    "T4: the test step reads its base from a pull request alone",
    (w) => {
      w.jobs.test.steps[1]!["env"] = { BASE: `\${{ github.event.pull_request.base.sha }}` };
    },
  ],
  ...[1, 3].map((line): [string, (w: Workflow) => void] => [
    `D5: test command ${line} runs next/'s tests`,
    (w) => {
      const step = w.jobs.test.steps[1]!;
      const lines = String(step["run"]).split("\n");
      lines[line] = lines[line]!.replace(" --exclude 'next/**'", "");
      step["run"] = lines.join("\n");
    },
  ]),
  [
    "D5: main loses its full shard command",
    (w) => {
      const step = w.jobs.test.steps[1]!;
      step["run"] = String(step["run"]).replace(
        "pnpm exec vitest run --shard",
        'pnpm exec vitest run --changed "$BASE" --shard',
      );
    },
  ],
  // D7: e2e's one step fails with its reason and starts nothing of today's app.
  [
    "D7: e2e runs today's app's end-to-end tests again",
    (w) => {
      w.jobs.e2e.steps.push({ run: "pnpm --filter @kampus/fabrika-app-old e2e" });
    },
  ],
  [
    "D7: e2e's one step runs today's app",
    (w) => {
      w.jobs.e2e.steps[0]!["run"] = "pnpm --filter @kampus/fabrika-app-old e2e";
    },
  ],
  [
    "D7: e2e's step passes",
    (w) => {
      w.jobs.e2e.steps[0]!["run"] = 'echo "removed"\nexit 0\n';
    },
  ],
  [
    "D7: e2e's failure is ignored",
    (w) => {
      w.jobs.e2e.steps[0]!["continue-on-error"] = true;
    },
  ],
  [
    "D7: e2e fetches Playwright",
    (w) => {
      w.jobs.e2e.steps[0]!["run"] = 'pnpm exec playwright install chromium\necho "removed"\nexit 1\n';
    },
  ],
  // D4: the jobs keep the names ci-required and the branch ruleset read.
  ...(["e2e", "test", "check"] as const).map((job): [string, (w: Workflow) => void] => [
    `D4: ${job} is renamed`,
    (w) => {
      const jobs = w.jobs as Record<string, unknown>;
      jobs[`${job}-old`] = jobs[job];
      delete jobs[job];
      w.jobs["ci-required"].needs = w.jobs["ci-required"].needs.map((name) => (name === job ? `${job}-old` : name));
    },
  ]),
  ...extraCommands.map((step): [string, (w: Workflow) => void] => [
    `review2 extra command: ${step.run}`,
    (w) => {
      w.jobs.next.steps.push(step);
    },
  ]),
  ...["missing", "duplicate"].map((fault): [string, (w: Workflow) => void] => [
    `next ${fault} install`,
    (w) => {
      if (fault === "missing") {
        w.jobs.next.steps.splice(4, 1);
      } else {
        w.jobs.next.steps.push({ ...w.jobs.next.steps[4]! });
      }
    },
  ]),
  [
    "review: extra exec Vitest invocation",
    (w) => {
      w.jobs.next.steps.push({ ...w.jobs.next.steps[0]!, run: `exec ${w.jobs.next.steps[0]!.run}` });
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
      w.jobs.next.steps.push({ ...w.jobs.next.steps[0]!, run });
    },
  ]),
  ...[1, 2, 3].map((index): [string, (w: Workflow) => void] => [
    `review: extra multiline ${["", "Chromium", "e2e", "edges"][index]} invocation`,
    (w) => {
      w.jobs.next.steps.push({
        ...w.jobs.next.steps[index]!,
        run: `echo before\n${w.jobs.next.steps[index]!.run}\necho after`,
      });
    },
  ]),
  [
    "review: SHARD matrix.sha rd",
    (w) => {
      w.jobs.next.steps[0]!.env!.SHARD = `\${{ matrix.sha rd }}/5`;
    },
  ],
  ...[1, 2, 3].map((index): [string, (w: Workflow) => void] => [
    `review: ${["", "Chromium", "e2e", "edges"][index]} guard matrix.sha rd`,
    (w) => {
      w.jobs.next.steps[index]!.if = w.jobs.next.steps[index]!.if!.replace("matrix.shard", "matrix.sha rd");
    },
  ]),
  [
    "review: Chromium path next/ apps",
    (w) => {
      w.jobs.next.steps[1]!.if = w.jobs.next.steps[1]!.if!.replace("next/apps", "next/ apps");
    },
  ],
  [
    "review: edges event pull_ request",
    (w) => {
      w.jobs.next.steps[3]!.if = w.jobs.next.steps[3]!.if!.replace("pull_request", "pull_ request");
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
      w.jobs.next.strategy.matrix.shard = [...legs];
      const count = legs.filter((leg) => typeof leg === "string" && /^e2e-[1-9]\d*$/.test(leg)).length;
      w.jobs.next.steps[2]!.env!.SHARD = `\${{ matrix.shard }}/${count}`;
    },
  ]),
  // E1 and E2: one e2e leg fewer or more than the end-to-end step's `/N`.
  [
    "next drops its last e2e leg and keeps its /N",
    (w) => {
      w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.filter(
        (leg, _, all) => leg !== all.filter((l) => typeof l === "string" && l.startsWith("e2e-")).at(-1),
      );
    },
  ],
  [
    "next adds an e2e leg and keeps its /N",
    (w) => {
      const legs = w.jobs.next.strategy.matrix.shard;
      const count = legs.filter((leg) => typeof leg === "string" && leg.startsWith("e2e-")).length;
      legs.splice(count, 0, `e2e-${count + 1}`);
    },
  ],
  // E2's denominator, the end-to-end step's own: one more or one fewer than its legs, or not a count.
  ...([1, -1, "", "/x", "0"] as const).map((fault): [string, (w: Workflow) => void] => [
    `next end-to-end denominator ${fault === "" ? "absent" : fault}`,
    (w) => {
      const env = w.jobs.next.steps[2]!.env!;
      const count = Number(/\/(\d+)$/.exec(env.SHARD ?? "")?.[1]);
      env.SHARD =
        typeof fault === "number"
          ? `\${{ matrix.shard }}/${count + fault}`
          : fault === "0"
            ? `\${{ matrix.shard }}/0${count}`
            : `\${{ matrix.shard }}${fault}`;
    },
  ]),
  [
    "next end-to-end step loses its SHARD",
    (w) => {
      Reflect.deleteProperty(w.jobs.next.steps[2]!, "env");
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
      const step = w.jobs.next.steps[2]!;
      step.run = step.run.replace(flag, "");
    },
  ]),
  [
    "next end-to-end step passes the whole leg name",
    (w) => {
      const step = w.jobs.next.steps[2]!;
      step.run = step.run.replace(`"\${SHARD#e2e-}"`, '"$SHARD"');
    },
  ],
  // E2's guard: exactly `startsWith(matrix.shard, 'e2e-')`.
  [
    "next end-to-end step loses its guard",
    (w) => {
      Reflect.deleteProperty(w.jobs.next.steps[2]!, "if");
    },
  ],
  ...["matrix.shard == 'e2e-1'", "matrix.shard == 'e2e'", `${onE2e} && false`, `${onE2e} || true`].map(
    (condition): [string, (w: Workflow) => void] => [
      `next end-to-end guard ${condition}`,
      (w) => {
        w.jobs.next.steps[2]!.if = condition;
      },
    ],
  ),
  // E3: shard times after both test steps, so an e2e leg's next.json is read too.
  [
    "next timing advice before the end-to-end step",
    (w) => {
      const [advice] = w.jobs.next.steps.splice(5, 1);
      w.jobs.next.steps.splice(2, 0, advice!);
    },
  ],
  [
    "next chromium on every leg",
    (w) => {
      w.jobs.next.steps[1]!.if = "hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''";
    },
  ],
  // LE1's denominator: `/6` leaves a sixth of the files on no machine, and a smaller one fails a leg.
  ...["/6", "/3", "/4", "", "/05", "/5 "].map((denominator): [string, (w: Workflow) => void] => [
    `next wrong denominator ${denominator || "absent"}`,
    (w) => {
      w.jobs.next.steps[0]!.env!.SHARD = `\${{ matrix.shard }}${denominator}`;
    },
  ]),
  // E3's vitest guard (after LE1): exactly one `if`, and it is `!startsWith(matrix.shard, 'e2e-')`.
  [
    "next vitest step loses its guard",
    (w) => {
      Reflect.deleteProperty(w.jobs.next.steps[0]!, "if");
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
      w.jobs.next.steps[0]!.if = condition;
    },
  ]),
  // E2 and E3's leg steps: chromium and the end-to-end runner only on the e2e legs, edges only on 1.
  ...(
    [
      ["Chromium back on leg 1", 1, "matrix.shard == '1' && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''"],
      ["Chromium on the old e2e leg", 1, "matrix.shard == 'e2e' && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''"],
      ["e2e back on leg 1", 2, "matrix.shard == '1'"],
      ["e2e back on the number 1", 2, "matrix.shard == 1"],
      ["e2e on every numbered leg", 2, `!${onE2e}`],
      ["edges on the e2e legs", 3, `${onE2e} && github.event_name == 'pull_request'`],
      ["edges on the number 1", 3, "matrix.shard == 1 && github.event_name == 'pull_request'"],
    ] as const
  ).map(([fault, index, condition]): [string, (w: Workflow) => void] => [
    `next ${fault}`,
    (w) => {
      w.jobs.next.steps[index]!.if = condition;
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
      w.jobs.next.steps.push({ ...w.jobs.next.steps[0]! });
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
      const step = w.jobs.next.steps[0]!;
      step.run = step.run.replace(flag, "");
    },
  ]),
  ...["missing", "duplicate", "before tests", "wrong report"].map((fault): [string, (w: Workflow) => void] => [
    `next timing advice ${fault}`,
    (w) => {
      const advice = w.jobs.next.steps[5]!;

      if (fault === "missing") {
        w.jobs.next.steps.splice(5, 1);
      } else if (fault === "duplicate") {
        w.jobs.next.steps.push({ ...advice });
      } else if (fault === "before tests") {
        w.jobs.next.steps.splice(5, 1);
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
      w.jobs.next.steps[5]!.if = condition;
    },
  ]),
  ...[" --changed main", " --passWithNoTests", " file.test.ts"].map((suffix): [string, (w: Workflow) => void] => [
    suffix,
    (w) => {
      w.jobs.next.steps[0]!.run += suffix;
    },
  ]),
  [
    "next test command inside a longer step",
    (w) => {
      w.jobs.next.steps[0]!.run = `echo before\n${w.jobs.next.steps[0]!.run}`;
    },
  ],
  [
    "next no shard flag",
    (w) => {
      w.jobs.next.steps[0]!.run = "pnpm exec vitest run next/";
    },
  ],
  [
    "next guarded test",
    (w) => {
      Object.assign(w.jobs.next.steps[0]!, { if: "false" });
    },
  ],
  [
    "next classifier failure skips",
    (w) => {
      w.jobs.next.if = "needs.changes.outputs.next == 'true'";
    },
  ],
  ...[1, 2, 3].flatMap((index): [string, (w: Workflow) => void][] => [
    [
      `next missing step ${index}`,
      (w) => {
        w.jobs.next.steps.splice(index, 1);
      },
    ],
    [
      `next duplicate step ${index}`,
      (w) => {
        w.jobs.next.steps.push({ ...w.jobs.next.steps[index]! });
      },
    ],
    [
      `next false step ${index}`,
      (w) => {
        w.jobs.next.steps[index]!.if = "false";
      },
    ],
  ]),
  [
    "next e2e everywhere",
    (w) => {
      w.jobs.next.steps[2]!.if = "true";
    },
  ],
  [
    "next chromium without file guard",
    (w) => {
      w.jobs.next.steps[1]!.if = onE2e;
    },
  ],
  [
    "next edges without event guard",
    (w) => {
      w.jobs.next.steps[3]!.if = "matrix.shard == '1'";
    },
  ],
  // F8: the freeze guard (0525) runs on every event and reads the classifier's own diff.
  [
    "F8: the changes job loses the freeze guard",
    (w) => {
      w.jobs.changes.steps.splice(4, 1);
    },
  ],
  [
    "F8: the freeze guard runs only when the classifier succeeded",
    (w) => {
      w.jobs.changes.steps[4]!["if"] = `\${{ steps.diff.outcome == 'success' }}`;
    },
  ],
  [
    "F8: the freeze guard skips a failure before it",
    (w) => {
      w.jobs.changes.steps[4]!["if"] = "success()";
    },
  ],
  [
    "F8: the freeze guard's failure is ignored",
    (w) => {
      w.jobs.changes.steps[4]!["continue-on-error"] = true;
    },
  ],
  ...(["BASE", "HEAD", "EVENT"] as const).map((key): [string, (w: Workflow) => void] => [
    `F8: the freeze guard reads another ${key} than the classifier`,
    (w) => {
      w.jobs.changes.steps[4]!["env"] = { ...env, [key]: `\${{ github.sha }}` };
    },
  ]),
  [
    "F8: the freeze guard runs twice",
    (w) => {
      w.jobs.changes.steps.push({ ...w.jobs.changes.steps[4]! });
    },
  ],
  [
    "scan skips after failure",
    (w) => {
      Object.assign(w.jobs.changes.steps[2]!, { if: "success()" });
    },
  ],
  [
    "changes skips",
    (w) => {
      Object.assign(w.jobs.changes, { if: "false" });
    },
  ],
  [
    "field ignores failure",
    (w) => {
      Object.assign(w.jobs.field, { "continue-on-error": true });
    },
  ],
  [
    "checker ignores failure",
    (w) => {
      Object.assign(w.jobs.field.steps[5]!, { "continue-on-error": true });
    },
  ],
  [
    "missing field setup",
    (w) => {
      w.jobs.field.steps.splice(2, 1);
    },
  ],
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
    "missing e2e dependency",
    (w) => {
      w.jobs.e2e.needs = "";
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
      Object.assign(w.jobs.changes.steps[1]!, { run: "echo check=false" });
    },
  ],
  [
    "missing skills scan",
    (w) => {
      w.jobs.changes.steps.splice(2, 1);
    },
  ],
  [
    "missing ignore scan",
    (w) => {
      w.jobs.changes.steps.splice(3, 1);
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
      w.jobs.next.steps[0]!.env!.FILTER = `\${{ needs.changes.outputs.filter }}`;
    },
  ],
  [
    "next runs all of next/ whatever filter says",
    (w) => {
      w.jobs.next.steps[0]!.run = w.jobs.next.steps[0]!.run.replace("$FILTER", "next/");
    },
  ],
  [
    "next quotes its path, so the reader paths are one argument",
    (w) => {
      w.jobs.next.steps[0]!.run = w.jobs.next.steps[0]!.run.replace("$FILTER", '"$FILTER"');
    },
  ],
  [
    "next has no filter",
    (w) => {
      delete (w.jobs.next.steps[0]!.env as Record<string, string>)["FILTER"];
    },
  ],
  // After PR 1230: under the reader filter, `--changed` would drop the reader tests, which reach a
  // changed file by reading it, not by importing it. So the vitest step's CHANGED is empty there.
  [
    "next narrows the reader tests with --changed",
    (w) => {
      (w.jobs.next.steps[0]!.env as Record<string, string>)["CHANGED"] = changedOnPullRequests;
    },
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
  // The parser's four steps are 6 to 9 of changes', after the freeze guard (4) and the extra step (5).
  ...[6, 7, 8, 9].map((index): [string, (w: Workflow) => void] => [
    `the parser's step ${index} fails changes`,
    (w) => {
      delete w.jobs.changes.steps[index]!["continue-on-error"];
    },
  ]),
  [
    "the parser's pass is gone",
    (w) => {
      w.jobs.changes.steps.splice(9, 1);
    },
  ],
  [
    "the parser's install is gone",
    (w) => {
      w.jobs.changes.steps.splice(8, 1);
    },
  ],
  [
    "the parser's pass runs before its install",
    (w) => {
      w.jobs.changes.steps.splice(8, 0, w.jobs.changes.steps.splice(9, 1)[0]!);
    },
  ],
  [
    "the parser's pass is not told the draft",
    (w) => {
      w.jobs.changes.steps[9]!["env"] = env;
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
    "field waits",
    (w) => {
      Object.assign(w.jobs.field, { needs: "changes" });
    },
  ],
  [
    "field unconditional install",
    (w) => {
      Object.assign(w.jobs.field.steps[4]!, { if: "true" });
    },
  ],
  [
    "field bypass",
    (w) => {
      Object.assign(w.jobs.field.steps[5]!, { run: "echo passed" });
    },
  ],
  [
    "next job excludes next",
    (w) => {
      w.jobs.next.steps[0]!.run += " --exclude 'next/**'";
    },
  ],
  // The ci-required job: it waits on every job, never skips, and its judge cannot be bypassed.
  ...(["changes", "field", "check", "typecheck", "test", "next", "e2e"] as const).map(
    (job): [string, (w: Workflow) => void] => [
      `ci-required does not need ${job}`,
      (w) => {
        w.jobs["ci-required"].needs = w.jobs["ci-required"].needs.filter((name) => name !== job);
      },
    ],
  ),
  // The lane reads the typecheck job's answer alone (0133), so the typecheck lives there only.
  [
    "the typecheck job runs no typecheck",
    (w) => {
      w.jobs.typecheck.steps = [{ run: "pnpm install --frozen-lockfile" }];
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
      Object.assign(w.jobs["ci-required"].steps[1]!, { "continue-on-error": true });
    },
  ],
  [
    "ci-required bypassed",
    (w) => {
      w.jobs["ci-required"].steps[1]!["run"] = "echo pass";
    },
  ],
  [
    "ci-required reads needs.*.result only",
    (w) => {
      w.jobs["ci-required"].steps[1]!["env"] = { NEEDS: `\${{ toJSON(needs.*.result) }}` };
    },
  ],
  [
    "ci-required second step",
    (w) => {
      w.jobs["ci-required"].steps.push({ run: "exit 0" });
    },
  ],
  // T496: a job with no time limit, one plant per job, and one limit past GitHub's default.
  ...(["changes", "field", "check", "typecheck", "test", "next", "e2e", "ci-required"] as const).map(
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
  // The check job's steps are lint, the next ledger and the ratchet, so the ratchet is step 2.
  [
    "L7: the ratchet step is deleted",
    (w) => {
      w.jobs.check.steps = w.jobs.check.steps.filter((s) => s["run"] !== ratchet);
    },
  ],
  [
    "L7: the ratchet step skips on a condition",
    (w) => {
      w.jobs.check.steps[2]!["if"] = guard("check");
    },
  ],
  [
    "L7: the ratchet step's failure does not block",
    (w) => {
      w.jobs.check.steps[2]!["continue-on-error"] = true;
    },
  ],
  [
    "L7: the ratchet step takes a base that keeps a first push's zeros",
    (w) => {
      w.jobs.check.steps[2]!["env"] = { BASE: env.BASE };
    },
  ],
  [
    "L7: the ratchet step runs twice, once muted",
    (w) => {
      w.jobs.check.steps.push({ ...w.jobs.check.steps[2]!, "continue-on-error": true });
    },
  ],
  [
    "L7: the ratchet command swallows its exit",
    (w) => {
      w.jobs.check.steps[2]!["run"] = `${ratchet} || true`;
    },
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
    fc.property(wiring, fc.constantFrom(1, 2, 3), fc.boolean(), (broken, index, missingGuard) => {
      const step = broken.jobs.next.steps[index]!;
      step.if = missingGuard ? (index === 2 ? "true" : index === 1 ? onE2e : "matrix.shard == '1'") : "false";
      expect(lint(JSON.stringify(broken))).toEqual([
        `check.yaml: next runs ${step.run} once, only on ${index === 3 ? "leg 1" : "the e2e legs"}, with its pinned condition`,
      ]);
    }),
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
      const env = w.jobs.next.steps[0]!.env!;

      if (env.SHARD !== undefined) {
        env.SHARD = env.SHARD.replace(/\/5$/, "/6");
      }
    },
    "next's vitest step passes --shard <leg>/<the count of numbered legs>",
  ],
  [
    "leg 5 dropped",
    (w) => {
      w.jobs.next.strategy.matrix.shard.pop();
    },
    "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries",
  ],
  [
    "the end-to-end step back on leg 1",
    (w) => {
      w.jobs.next.steps[2]!.if = w.jobs.next.steps[2]!.if!.replace(onE2e, "matrix.shard == '1'");
    },
    `next runs ${e2eCommand} once, only on the e2e legs, with its pinned condition`,
  ],
  [
    "the `if` taken off the vitest step",
    (w) => {
      Reflect.deleteProperty(w.jobs.next.steps[0]!, "if");
    },
    "next's vitest step runs only on the numbered legs, and has no other guard",
  ],
  // T967. E1's `e2e-2, e2e-1` order, E2's `/N` one more than the e2e legs, and E3's advice before
  // the end-to-end step, each planted alone; each names itself and nothing else.
  [
    "the e2e legs written out of order",
    (w) => {
      const legs = w.jobs.next.strategy.matrix.shard;
      const count = legs.filter((leg) => typeof leg === "string" && leg.startsWith("e2e-")).length;
      legs.splice(0, count, ...legs.slice(0, count).toReversed());

      // One e2e leg cannot be out of order, so a second one comes first.
      if (count === 1) {
        legs.unshift("e2e-2");
        w.jobs.next.steps[2]!.env!.SHARD = `\${{ matrix.shard }}/2`;
      }
    },
    "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries",
  ],
  [
    "an end-to-end /N one more than the e2e legs",
    (w) => {
      const env = w.jobs.next.steps[2]!.env!;
      env.SHARD = (env.SHARD ?? "").replace(/\/(\d+)$/, (_, count: string) => `/${Number(count) + 1}`);
    },
    "next's end-to-end step passes --shard <leg>/<the count of e2e legs>",
  ],
  [
    "the timing advice before the end-to-end step",
    (w) => {
      const [advice] = w.jobs.next.steps.splice(5, 1);
      w.jobs.next.steps.splice(2, 0, advice!);
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
      broken.jobs.check.steps = broken.jobs.check.steps.filter((s) => s["run"] !== ratchet);
      const errors = lint(JSON.stringify(broken));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("ratchet.ts");
    }),
    options,
  );
});

it("L7 scenario: the checked-in check.yaml fails with its ratchet step deleted, given an if, or given another base", () => {
  const real = () => parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
  const step = (w: Workflow) => w.jobs.check.steps.find((s) => s["run"] === ratchet)!;
  expect(lint(JSON.stringify(real()))).toEqual([]);

  for (const mutate of [
    (w: Workflow) => {
      w.jobs.check.steps = w.jobs.check.steps.filter((s) => s["run"] !== ratchet);
    },
    (w: Workflow) => {
      step(w)["if"] = guard("check");
    },
    (w: Workflow) => {
      step(w)["env"] = { BASE: env.BASE };
    },
  ]) {
    const broken = real();
    mutate(broken);
    expect(lint(JSON.stringify(broken))).not.toEqual([]);
  }
});

it("format: the checked-in workflow passes the same wiring lint", () => {
  // A fixed file read is a format check. Structural decisions live in the linter.
  expect(lint(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"))).toEqual([]);
});

it("D6: format: the root package.json's lint runs workflow-lint.ts and nothing of today's version", () => {
  // format: the real manifest, read as `pnpm lint` reads it, and one plant per script that left.
  const text = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
  expect(lintManifest(text)).toEqual([]);
  const manifest = JSON.parse(text) as { scripts: Record<string, string> };

  for (const plant of [
    { lint: `${manifest.scripts["lint"]} && pnpm -s lint:browser` },
    { "lint:browser": "node packages/fabrika/browser-check.ts" },
    { promises: "node packages/promises/src/main.ts" },
    { lint: "node oxlint-plugins/lint.ts" },
  ]) {
    expect(lintManifest(JSON.stringify({ ...manifest, scripts: { ...manifest.scripts, ...plant } }))).not.toEqual([]);
  }
});

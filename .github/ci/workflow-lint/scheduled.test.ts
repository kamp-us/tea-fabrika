import { readFileSync } from "node:fs";
import * as Rec from "effect/Record";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintScheduled } from "./scheduled.ts";

// Today's CI, serving both versions. Covers scheduled.ts's laws on scheduled.yaml, the schedule
// that runs all of next/ and every tooling test on main (0534). Each generated workflow is the real
// one with what does not change its meaning varied, and each plant is applied to it alone, so an
// unrelated error cannot mask it. Each plant was also run once on workflow-lint.ts with its rule
// dropped, and that turned this law red.
const options = { seed: 119120, numRuns: 100 };
const read = (path: string) => readFileSync(new URL(`../../workflows/${path}`, import.meta.url), "utf8");
const check = read("check.yaml");

type Step = Record<string, unknown> & { env?: Record<string, unknown>; with?: Record<string, unknown> };

type Job = Record<string, unknown> & {
  steps: Step[];
  strategy?: { "fail-fast"?: unknown; "max-parallel"?: unknown; matrix: { shard: unknown } };
  permissions?: unknown;
  needs?: unknown;
};

type Workflow = Record<string, unknown> & {
  on: Record<string, unknown>;
  concurrency: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, Job>;
};

const real = (): Workflow => parse(read("scheduled.yaml"));

/**
 * Moves the legs whose shard `leaves` picks out of the test job into a job of their own, `split`,
 * with the same steps, as two matrices were before 2026-11-15, and has the report wait on it too.
 */
const split = (w: Workflow, leaves: (shard: string) => boolean) => {
  const tests = w.jobs["tests"]!;
  const all = tests.strategy!.matrix.shard as string[];
  const apart = structuredClone(tests);
  apart.strategy!.matrix.shard = all.filter(leaves);
  apart.strategy!["max-parallel"] = 1;
  tests.strategy!.matrix.shard = all.filter((shard) => !leaves(shard));
  tests.strategy!["max-parallel"] = 1;
  w.jobs["split"] = apart;
  (w.jobs["report"]!.needs as string[]).push("split");
};

/** The one step of `job` named `name`, so a plant never depends on where a step sits. */
const step = (w: Workflow, job: string, name: string): Step => {
  const found = w.jobs[job]!.steps.filter((s) => s["name"] === name);

  if (found.length !== 1) {
    throw new Error(`${job} has ${found.length} steps named "${name}"`);
  }

  return found[0]!;
};

// What may change without changing what the schedule runs: the cron line (a setting, 0069), the
// concurrency group's name, how many legs run at once within the cap, and the spacing in an `if`.
const scheduled = fc
  .tuple(
    fc.stringMatching(/^[0-9*/ ,-]{1,20}$/),
    fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
    fc.integer({ min: 1, max: 9 }),
    fc.constantFrom("", " ", "  "),
  )
  .map(([cron, group, most, gap]) => {
    const w = real();
    w.on["schedule"] = [{ cron }];
    w.concurrency["group"] = group;
    w.jobs["tests"]!.strategy!["max-parallel"] = most;

    for (const job of Rec.values(w.jobs)) {
      for (const s of job.steps) {
        if (typeof s["if"] === "string") {
          s["if"] = s["if"].replace(/ *(==|!=|&&|\|\|) */g, `${gap}$1${gap}`);
        }
      }
    }

    return w;
  });

const lint = (w: Workflow) => lintScheduled(JSON.stringify(w), check);

it("pinned: the real scheduled.yaml passes, against the real check.yaml", () => {
  expect(lintScheduled(read("scheduled.yaml"), check)).toEqual([]);
});

it("property: a schedule varied only where its meaning holds passes", () => {
  fc.assert(
    fc.property(scheduled, (w) => {
      expect(lint(w)).toEqual([]);
    }),
    options,
  );
});

// The step that ended each test job until 2026-11-15: after a failure it canceled the job's own
// run, and GitHub ended that run `cancelled`, never `failure`.
const stop = {
  name: "stop the run",
  if: `\${{ failure() && github.event_name != 'push' }}`,
  env: { GH_TOKEN: `\${{ github.token }}` },
  run: 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"',
};

const plants: [string, (w: Workflow) => void][] = [
  // SC1: no merge line event runs the whole suite (0534's binding constraint).
  ["SC1: a push to main starts the schedule", (w) => (w.on["push"] = { branches: ["main"] })],
  ["SC1: a pull request starts the schedule", (w) => (w.on["pull_request"] = {})],
  ["SC1: the merge queue starts the schedule", (w) => (w.on["merge_group"] = { types: ["checks_requested"] })],
  ["SC1: no schedule", (w) => Reflect.deleteProperty(w.on, "schedule")],
  ["SC1: two cron lines", (w) => (w.on["schedule"] = [{ cron: "0 * * * *" }, { cron: "30 * * * *" }])],
  // SC2: one run at a time, never cut short.
  ["SC2: a newer run cancels the running one", (w) => (w.concurrency["cancel-in-progress"] = true)],
  ["SC2: one group per commit, so runs overlap", (w) => (w.concurrency["group"] = `scheduled-\${{ github.sha }}`)],
  // SC12: a newer run never cancels a waiting one.
  ["SC12: no queue, so a newer run cancels the waiting one", (w) => Reflect.deleteProperty(w.concurrency, "queue")],
  ["SC12: one waiting run at most", (w) => (w.concurrency["queue"] = "single")],
  // SC3: the token.
  [
    "SC3: the workflow's token writes issues",
    (w) => (w.permissions = { actions: "read", contents: "read", issues: "write" }),
  ],
  ["SC3: the workflow's token is write-all", (w) => (w.permissions = "write-all")],
  [
    "SC3: the workflow's token writes actions, so a step could cancel the run again",
    (w) => (w.permissions = { actions: "write", contents: "read" }),
  ],
  [
    "SC3: the workflow's token loses actions: read, so no time table reads its job",
    (w) => (w.permissions = { contents: "read" }),
  ],
  [
    "SC3: the report's token writes contents",
    (w) => (w.jobs["report"]!.permissions = { actions: "read", contents: "write", issues: "write" }),
  ],
  [
    "SC3: the report cannot write issues",
    (w) => (w.jobs["report"]!.permissions = { actions: "read", contents: "read" }),
  ],
  [
    "SC3: a test job takes issues: write",
    (w) => (w.jobs["tests"]!.permissions = { actions: "read", contents: "read", issues: "write" }),
  ],
  ["SC3: a test job's own token writes actions", (w) => (w.jobs["tests"]!.permissions = { actions: "write" })],
  // SC4: no step cancels the run, time limits, the token out of .git/config.
  [
    "SC4: a step calls the REST API's cancel",
    (w) =>
      void w.jobs["tests"]!.steps.push({
        if: "failure()",
        run: 'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/cancel"',
      }),
  ],
  [
    "SC4: a step force-cancels",
    (w) =>
      void w.jobs["tests"]!.steps.push({
        run: 'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/force-cancel"',
      }),
  ],
  [
    "SC4: an action cancels the run",
    (w) => void w.jobs["tests"]!.steps.push({ uses: "someone/cancel-workflow-action@v1" }),
  ],
  ["SC4: the test job runs on always()", (w) => (w.jobs["tests"]!["if"] = "always()")],
  ["SC4: the test job has no time limit", (w) => Reflect.deleteProperty(w.jobs["tests"]!, "timeout-minutes")],
  ["SC4: the report's time limit is an expression", (w) => (w.jobs["report"]!["timeout-minutes"] = `\${{ 5 }}`)],
  ["SC4: the report has no time limit", (w) => Reflect.deleteProperty(w.jobs["report"]!, "timeout-minutes")],
  [
    "SC4: next's checkout keeps the token in .git/config",
    (w) => Reflect.deleteProperty(w.jobs["tests"]!.steps[0]!.with!, "persist-credentials"),
  ],
  [
    "SC4: the report's checkout keeps the token in .git/config",
    (w) => (w.jobs["report"]!.steps[0]!.with!["persist-credentials"] = true),
  ],
  // SC5: the report.
  ["SC5: the report skips after a red leg", (w) => (w.jobs["report"]!["if"] = "github.ref == 'refs/heads/main'")],
  [
    "SC5: the report runs on main alone, so a branch's run with a timed-out leg ends cancelled",
    (w) => (w.jobs["report"]!["if"] = `\${{ always() && github.ref == 'refs/heads/main' }}`),
  ],
  ["SC5: the report waits on nothing", (w) => (w.jobs["report"]!.needs = [])],
  ["SC5: the report's failure is hidden", (w) => (step(w, "report", "report")["continue-on-error"] = true)],
  ["SC5: the report runs another script", (w) => (step(w, "report", "report")["run"] = "node .github/ci/required.mjs")],
  ["SC5: the report is not told the needs", (w) => Reflect.deleteProperty(step(w, "report", "report").env!, "NEEDS")],
  ["SC5: the report takes a secret", (w) => (step(w, "report", "report").env!["GITHUB_TOKEN"] = `\${{ secrets.BOT }}`)],
  [
    "SC5: a test step gets the token",
    (w) => (step(w, "tests", "vitest").env!["GITHUB_TOKEN"] = `\${{ github.token }}`),
  ],
  // The report tells a timed-out leg by its test steps' limit: a missing or stale one reads a
  // time-out as a red test or a leg canceled by hand (run 43723335863 opened no issue).
  [
    "SC5: the report is not told next's limit",
    (w) => Reflect.deleteProperty(step(w, "report", "report").env!, "LIMIT_NEXT"),
  ],
  [
    "SC5: next's test steps' limit is raised, and the report's is not",
    (w) => {
      step(w, "tests", "vitest")["timeout-minutes"] = 19;
      step(w, "tests", "end to end")["timeout-minutes"] = 19;
      w.jobs["tests"]!["timeout-minutes"] = `\${{ startsWith(matrix.shard, 'tooling-') && 33 || 22 }}`;
    },
  ],
  // SC13: the limit on the test steps, the job's own a backstop past it.
  [
    "SC13: next's vitest step has no limit",
    (w) => Reflect.deleteProperty(step(w, "tests", "vitest"), "timeout-minutes"),
  ],
  ["SC13: next's two test steps differ", (w) => (step(w, "tests", "end to end")["timeout-minutes"] = 16)],
  [
    "SC13: tooling's tests step has no limit",
    (w) => Reflect.deleteProperty(step(w, "tests", "tooling tests"), "timeout-minutes"),
  ],
  [
    "SC13: the job's limit equals a next step's, so a hung next test ends the run cancelled",
    (w) => (w.jobs["tests"]!["timeout-minutes"] = `\${{ startsWith(matrix.shard, 'tooling-') && 33 || 17 }}`),
  ],
  [
    "SC13: tooling's backstop is not 3 minutes",
    (w) => (w.jobs["tests"]!["timeout-minutes"] = `\${{ startsWith(matrix.shard, 'tooling-') && 40 || 20 }}`),
  ],
  ["SC13: one backstop for both suites", (w) => (w.jobs["tests"]!["timeout-minutes"] = 33)],
  [
    "SC13: the backstop asks the other suite first",
    (w) => (w.jobs["tests"]!["timeout-minutes"] = `\${{ !startsWith(matrix.shard, 'tooling-') && 20 || 33 }}`),
  ],
  [
    "SC13: a test step's limit is not a whole number",
    (w) => {
      step(w, "tests", "tooling tests")["timeout-minutes"] = "30";
      step(w, "report", "report").env!["LIMIT_TOOLING"] = "30";
    },
  ],
  [
    "SC5: the report's tooling limit is its own number",
    (w) => (step(w, "report", "report").env!["LIMIT_TOOLING"] = 25),
  ],
  [
    "SC5: the test job names its legs, so a leg's name loses its shard",
    (w) => (w.jobs["tests"]!["name"] = "full suite"),
  ],
  // SC6: one matrix for every test leg, at most half the runners.
  ["SC6: one more leg at once than the cap holds", (w) => (w.jobs["tests"]!.strategy!["max-parallel"] = 10)],
  ["SC6: the test job has no max-parallel", (w) => Reflect.deleteProperty(w.jobs["tests"]!.strategy!, "max-parallel")],
  // GitHub's own fail fast stops a job's other legs and leaves the run's conclusion `failure`.
  ["SC6: a red leg holds the others' runners", (w) => (w.jobs["tests"]!.strategy!["fail-fast"] = false)],
  // GitHub's fail fast reaches only the red leg's own matrix, so a second matrix runs on after a red
  // leg in the first: a red tooling leg would leave next's legs running, and the other way round.
  ["SC6: the tooling legs in a job of their own", (w) => split(w, (shard) => shard.startsWith("tooling-"))],
  ["SC6: the next legs in a job of their own", (w) => split(w, (shard) => !shard.startsWith("tooling-"))],
  [
    "SC6: a new job, in the cap",
    (w) => {
      w.jobs["tests"]!.strategy!["max-parallel"] = 8;
      w.jobs["extra"] = { "runs-on": "ubuntu-latest", "timeout-minutes": 5, steps: [{ run: "true" }] };
      (w.jobs["report"]!.needs as string[]).push("extra");
    },
  ],
  // SC7 to SC9: the whole suite, nothing narrowed.
  [
    "SC7: next drops a leg",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4", "tooling-1", "tooling-2"]),
  ],
  [
    "SC7: the legs come from an expression",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = `\${{ fromJSON('["1"]') }}`),
  ],
  [
    "SC7: vitest runs on the tooling legs too",
    (w) => (step(w, "tests", "vitest")["if"] = `\${{ !startsWith(matrix.shard, 'e2e-') }}`),
  ],
  // SC8: the tooling legs, after next's.
  [
    "SC8: a tooling leg comes before the next legs",
    (w) =>
      (w.jobs["tests"]!.strategy!.matrix.shard = ["tooling-1", "e2e-1", "e2e-2", "1", "2", "3", "4", "5", "tooling-2"]),
  ],
  [
    "SC8: the tooling legs are numbered like next's",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4", "5", "6", "7"]),
  ],
  [
    "SC8: no tooling legs",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4", "5"]),
  ],
  ["SC8: the tooling tests run on every leg", (w) => Reflect.deleteProperty(step(w, "tests", "tooling tests"), "if")],
  [
    "SC8: the tooling tests take the leg's whole name as their shard",
    (w) =>
      (step(w, "tests", "tooling tests")["run"] = String(step(w, "tests", "tooling tests")["run"]).replace(
        `"\${SHARD#tooling-}"`,
        '"$SHARD"',
      )),
  ],
  [
    "SC7: next's vitest legs each take a fourth",
    (w) => (step(w, "tests", "vitest").env!["SHARD"] = `\${{ matrix.shard }}/4`),
  ],
  [
    "SC7: next's end-to-end legs each take a third",
    (w) => (step(w, "tests", "end to end").env!["SHARD"] = `\${{ matrix.shard }}/3`),
  ],
  [
    "SC7: next narrows to what changed",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace("--shard", '--changed "$BASE" --shard');
    },
  ],
  [
    "SC7: next runs a list",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace("--shard", "$FILTER --shard");
    },
  ],
  [
    "SC7: the end-to-end legs narrow",
    (w) => {
      const s = step(w, "tests", "end to end");
      s["run"] = String(s["run"]).replace("--project next-visual ", "--project next-visual --changed=main ");
    },
  ],
  // 0536: a project, not a path, picks each leg's files. Each plant was run once on the real
  // scheduled.yaml too, and restored.
  [
    "SC7: next runs next/ as a path, so next-visual starts on legs with no Chromium",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace("--project next --project next-integration ", "next/ ");
    },
  ],
  [
    "SC7: next drops next-integration, so the real-resource tests run nowhere",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace(" --project next-integration", "");
    },
  ],
  [
    "SC7: the end-to-end legs lose their project, so they run every next/ test",
    (w) => {
      const s = step(w, "tests", "end to end");
      s["run"] = String(s["run"]).replace("--project next-visual ", "");
    },
  ],
  [
    "SC7: the end-to-end legs run the old runner, which 0536 removed",
    (w) => {
      const s = step(w, "tests", "end to end");
      s["run"] = String(s["run"]).replace(
        "pnpm exec vitest run --project next-visual ",
        "node next/apps/fabrika/e2e.ts ",
      );
    },
  ],
  [
    "SC7: chromium waits on the old end-to-end folder",
    (w) => {
      const s = step(w, "tests", "chromium");
      s["if"] = "startsWith(matrix.shard, 'e2e-') && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''";
    },
  ],
  ["SC7: vitest runs on the e2e legs too", (w) => Reflect.deleteProperty(step(w, "tests", "vitest"), "if")],
  [
    "SC7: no chromium",
    (w) => w.jobs["tests"]!.steps.splice(w.jobs["tests"]!.steps.indexOf(step(w, "tests", "chromium")), 1),
  ],
  [
    "SC8: tooling narrows to what changed",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace("--shard", '--changed "$BASE" --shard');
    },
  ],
  [
    "SC8: tooling runs today's tests too",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace("--project tooling", "--project tooling --project today");
    },
  ],
  [
    "SC8: tooling loses its project, so it runs every project",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace("--project tooling ", "");
    },
  ],
  [
    "SC8: tooling leaves the trees out with --exclude, which a project ignores",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace(
        "--project tooling ",
        "--exclude 'next/**' --exclude 'apps/**' --exclude 'packages/**' --exclude 'programs/**' ",
      );
    },
  ],
  [
    "SC8: tooling's two legs each take a third",
    (w) => (step(w, "tests", "tooling tests").env!["SHARD"] = `\${{ matrix.shard }}/3`),
  ],
  [
    "SC9: next runs one more command",
    (w) => w.jobs["tests"]!.steps.splice(3, 0, { run: "pnpm exec vitest run next/apps" }),
  ],
  ["SC9: tooling runs one more command", (w) => w.jobs["tests"]!.steps.splice(3, 0, { run: "pnpm test" })],
  // SC11: every test leg at full depth (pull request 1274). Each plant was run once on workflow-lint.ts
  // with SC11 dropped, and that turned this law red.
  [
    "SC11: next's vitest legs run at the merge line's depth",
    (w) => Reflect.deleteProperty(step(w, "tests", "vitest").env!, "FABRIKA_TEST_DEPTH"),
  ],
  ["SC11: the end-to-end legs run fast", (w) => (step(w, "tests", "end to end").env!["FABRIKA_TEST_DEPTH"] = "fast")],
  [
    "SC11: tooling runs at the merge line's depth",
    (w) => Reflect.deleteProperty(step(w, "tests", "tooling tests").env!, "FABRIKA_TEST_DEPTH"),
  ],
  // SC10: the reports the issue names its tests from.
  ["SC10: next's report is dropped after a red step", (w) => (step(w, "tests", "results")["if"] = "success()")],
  [
    "SC10: tooling uploads no report",
    (w) => w.jobs["tests"]!.steps.splice(w.jobs["tests"]!.steps.indexOf(step(w, "tests", "results")), 1),
  ],
  [
    "SC10: the upload comes before the tests",
    (w) => {
      const list = w.jobs["tests"]!.steps;
      const upload = step(w, "tests", "results");
      list.splice(list.indexOf(upload), 1);
      list.splice(2, 0, upload);
    },
  ],
  // TT1 and TT2, as in check.yaml: each leg's time table and its timings file. A leg's steps are
  // copied before a plant, so a plant on one leg leaves the other's alias as it was.
  ...(["tests"] as const).flatMap((job): [string, (w: Workflow) => void][] => {
    const own = (w: Workflow, name: string) => {
      const list = w.jobs[job]!.steps;
      const at = list.indexOf(step(w, job, name));
      list[at] = structuredClone(list[at]!);
      return list[at]!;
    };
    return [
      [
        `TT1: ${job} drops its time table`,
        (w) => void w.jobs[job]!.steps.splice(w.jobs[job]!.steps.indexOf(step(w, job, "time table")), 1),
      ],
      [`TT1: ${job}'s time table skips a red leg`, (w) => (own(w, "time table")["if"] = "success()")],
      [
        `TT1: ${job}'s time table reads another report`,
        (w) => (own(w, "time table").env!["REPORT"] = `\${{ runner.temp }}/next.json`),
      ],
      [
        `TT1: ${job}'s time table can fail the job`,
        (w) => Reflect.deleteProperty(own(w, "time table"), "continue-on-error"),
      ],
      [
        `TT2: ${job} drops its timings upload`,
        (w) => void w.jobs[job]!.steps.splice(w.jobs[job]!.steps.indexOf(step(w, job, "timings")), 1),
      ],
      [
        `TT2: ${job}'s timings lose the attempt`,
        (w) => (own(w, "timings").with!["name"] = `timings-\${{ github.job }}-\${{ matrix.shard }}`),
      ],
      [`TT2: ${job}'s timings skip a red leg`, (w) => (own(w, "timings")["if"] = "success()")],
    ];
  }),
  // SC5: the time table's exact step is the one test step that gets the token.
  [
    "SC5: the results upload gets the token",
    (w) => (step(w, "tests", "results").env = { GITHUB_TOKEN: `\${{ github.token }}` }),
  ],
];

// SC4, 2026-11-15: a red run on a branch that had canceled itself ended `cancelled`, was read as cut
// off, and its pull request merged with two red laws. The old step also takes the token, which SC5
// names too, so this looks for SC4's own error on the job that gained it.
// Plant, run once on scheduled.ts and restored: SC4's cancel check dropped (red on each job).
it.each(["tests", "report"])("SC4: %s with the old stop step back is named by SC4's error for that job", (job) => {
  fc.assert(
    fc.property(scheduled, (broken) => {
      broken.jobs[job]!.steps.push(structuredClone(stop));
      expect(lint(broken)).toContain(
        `scheduled.yaml: SC4: no step of ${job} cancels the run: a canceled run ends cancelled, never failure`,
      );
    }),
    { ...options, numRuns: 20 },
  );
});

it("SC3, SC5 and SC6 scenario: on the real scheduled.yaml, what ends a red run as failure is each held by its one error", () => {
  // Plants, each run once on scheduled.ts and restored: SC3's map check dropped; SC5's `if` check
  // dropped; SC6's fail-fast check dropped.
  const writes = real();
  writes.permissions = { actions: "write", contents: "read" };
  expect(lint(writes)).toEqual([
    "scheduled.yaml: SC3: the workflow's token grants actions: read and contents: read, nothing more",
  ]);

  const mainOnly = real();
  mainOnly.jobs["report"]!["if"] = `\${{ always() && github.ref == 'refs/heads/main' }}`;
  expect(lint(mainOnly)).toEqual([
    "scheduled.yaml: SC5: the report needs every other job, and runs after any result, on every branch",
  ]);

  const slow = real();
  slow.jobs["tests"]!.strategy!["fail-fast"] = false;
  expect(lint(slow)).toEqual([
    "scheduled.yaml: SC6: tests sets max-parallel to at most its legs, and its first red leg stops the others",
  ]);
});

it("SC6 scenario: on the real scheduled.yaml, the tooling legs or the next legs in a job of their own is named by SC6, so a red leg of either suite stops the other's legs", () => {
  // The review of pull request 1383: GitHub's fail fast stops only the red leg's own matrix (probe
  // run 43778347612), so with two matrices a red tooling leg left next's 7 legs running, up to about
  // 59 runner minutes, and a red next leg left the 2 tooling legs, up to about 14. Plant, run once
  // on scheduled.ts and restored: SC6's one-matrix check dropped (red on both splits).
  const ONE =
    "scheduled.yaml: SC6: every test leg is in one matrix, the tests job, so its first red leg stops all the others";

  const toolingApart = real();
  split(toolingApart, (shard) => shard.startsWith("tooling-"));
  expect(lint(toolingApart)).toContain(ONE);

  const nextApart = real();
  split(nextApart, (shard) => !shard.startsWith("tooling-"));
  expect(lint(nextApart)).toContain(ONE);

  // One more job beside the test job, even with no matrix, is not the one-matrix shape either.
  const beside = real();
  beside.jobs["tests"]!.strategy!["max-parallel"] = 8;
  beside.jobs["extra"] = { "runs-on": "ubuntu-latest", "timeout-minutes": 5, steps: [{ run: "true" }] };
  (beside.jobs["report"]!.needs as string[]).push("extra");
  expect(lint(beside)).toEqual([ONE]);
});

it("SC13 scenario: on the real scheduled.yaml, a test step with no limit of its own, or a job limit that is no backstop, is named by SC13", () => {
  // A job that runs into its own limit ends `cancelled`, and its run with it, even when the report
  // fails after it (probe run 43778355238); a test step that runs into its own ends `failure` (probe
  // run 43778586135). Plant, run once on scheduled.ts and restored: SC13 dropped (red on each case).
  const STEPS = (suite: string) => `scheduled.yaml: SC13: ${suite}'s test steps share one whole timeout-minutes`;
  const JOB = "scheduled.yaml: SC13: tests's own timeout-minutes is each leg's suite limit and 3 minutes more";
  const LIMIT_TEXT =
    "scheduled.yaml: SC5: the report runs node .github/ci/scheduled.mjs once, with the needs, the results, the token and each suite's time limit, and its failure shows";
  const backstop = (tooling: number, next: number) =>
    `\${{ startsWith(matrix.shard, 'tooling-') && ${tooling} || ${next} }}`;

  // The shape before 2026-11-15: the limit on the job alone, which a hung leg ran into.
  const onJob = real();
  Reflect.deleteProperty(step(onJob, "tests", "vitest"), "timeout-minutes");
  Reflect.deleteProperty(step(onJob, "tests", "end to end"), "timeout-minutes");
  onJob.jobs["tests"]!["timeout-minutes"] = 17;
  expect(lint(onJob)).toEqual([LIMIT_TEXT, STEPS("next"), JOB]);

  for (const [tooling, next] of [
    [30, 20],
    [32, 20],
    [34, 20],
    [33, 17],
    [33, 19],
    [33, 21],
  ] as const) {
    const near = real();
    near.jobs["tests"]!["timeout-minutes"] = backstop(tooling, next);
    expect(lint(near)).toEqual([JOB]);
  }

  // The backstop keeps its meaning however it is spaced.
  const spaced = real();
  spaced.jobs["tests"]!["timeout-minutes"] = `\${{startsWith(matrix.shard, 'tooling-')&&33||20}}`;
  expect(lint(spaced)).toEqual([]);

  const apart = real();
  step(apart, "tests", "end to end")["timeout-minutes"] = 16;
  expect(lint(apart)).toEqual([LIMIT_TEXT, STEPS("next"), JOB]);
});

it.each(plants)("rejects the schedule's plant: %s", (plant, mutate) => {
  fc.assert(
    fc.property(scheduled, (clean) => {
      const broken = structuredClone(clean);
      mutate(broken);
      expect(lint(broken), plant).not.toEqual([]);
    }),
    { ...options, numRuns: 20 },
  );
});

it("property: the schedule's legs follow check.yaml's full matrix, so a new leg there fails here until both agree", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 4 }), (e2es) => {
      const legs = [...Array.from({ length: e2es }, (_, i) => `e2e-${i + 1}`), "1", "2", "3", "4", "5"];
      const otherCheck = check.replace(`'["e2e-1","e2e-2","1","2","3","4","5"]'`, `'${JSON.stringify(legs)}'`);
      expect(otherCheck.includes(JSON.stringify(legs)), "the plant found check.yaml's fallback").toBe(true);
      const errors = lintScheduled(read("scheduled.yaml"), otherCheck);
      expect(errors.length === 0).toBe(e2es === 2);
    }),
    options,
  );
});

import { readFileSync } from "node:fs";
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
    fc.integer({ min: 1, max: 7 }),
    fc.integer({ min: 1, max: 2 }),
    fc.constantFrom("", " ", "  "),
  )
  .map(([cron, group, next, tooling, gap]) => {
    const w = real();
    w.on["schedule"] = [{ cron }];
    w.concurrency["group"] = group;
    w.jobs["next"]!.strategy!["max-parallel"] = next;
    w.jobs["tooling"]!.strategy!["max-parallel"] = tooling;

    for (const job of Object.values(w.jobs)) {
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
    (w) => (w.jobs["next"]!.permissions = { actions: "read", contents: "read", issues: "write" }),
  ],
  ["SC3: a test job's own token writes actions", (w) => (w.jobs["tooling"]!.permissions = { actions: "write" })],
  // SC4: no step cancels the run, time limits, the token out of .git/config.
  [
    "SC4: a step calls the REST API's cancel",
    (w) =>
      void w.jobs["tooling"]!.steps.push({
        if: "failure()",
        run: 'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/cancel"',
      }),
  ],
  [
    "SC4: a step force-cancels",
    (w) =>
      void w.jobs["next"]!.steps.push({
        run: 'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/force-cancel"',
      }),
  ],
  [
    "SC4: an action cancels the run",
    (w) => void w.jobs["next"]!.steps.push({ uses: "someone/cancel-workflow-action@v1" }),
  ],
  ["SC4: a test job runs on always()", (w) => (w.jobs["tooling"]!["if"] = "always()")],
  ["SC4: next has no time limit", (w) => Reflect.deleteProperty(w.jobs["next"]!, "timeout-minutes")],
  ["SC4: the report has no time limit", (w) => Reflect.deleteProperty(w.jobs["report"]!, "timeout-minutes")],
  [
    "SC4: next's checkout keeps the token in .git/config",
    (w) => Reflect.deleteProperty(w.jobs["next"]!.steps[0]!.with!, "persist-credentials"),
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
  ["SC5: the report waits on next alone", (w) => (w.jobs["report"]!.needs = ["next"])],
  ["SC5: the report's failure is hidden", (w) => (step(w, "report", "report")["continue-on-error"] = true)],
  ["SC5: the report runs another script", (w) => (step(w, "report", "report")["run"] = "node .github/ci/required.mjs")],
  ["SC5: the report is not told the needs", (w) => Reflect.deleteProperty(step(w, "report", "report").env!, "NEEDS")],
  ["SC5: the report takes a secret", (w) => (step(w, "report", "report").env!["GITHUB_TOKEN"] = `\${{ secrets.BOT }}`)],
  ["SC5: a test step gets the token", (w) => (step(w, "next", "vitest").env!["GITHUB_TOKEN"] = `\${{ github.token }}`)],
  // The report tells a timed-out leg by its test steps' limit: a missing or stale one reads a
  // time-out as a red test or a leg canceled by hand (run 43723335863 opened no issue).
  [
    "SC5: the report is not told next's limit",
    (w) => Reflect.deleteProperty(step(w, "report", "report").env!, "LIMIT_NEXT"),
  ],
  [
    "SC5: next's test steps' limit is raised, and the report's is not",
    (w) => {
      step(w, "next", "vitest")["timeout-minutes"] = 19;
      step(w, "next", "end to end")["timeout-minutes"] = 19;
      w.jobs["next"]!["timeout-minutes"] = 22;
    },
  ],
  // SC12: the limit on the test steps, the job's own a backstop past it.
  [
    "SC12: next's vitest step has no limit",
    (w) => Reflect.deleteProperty(step(w, "next", "vitest"), "timeout-minutes"),
  ],
  ["SC12: next's two test steps differ", (w) => (step(w, "next", "end to end")["timeout-minutes"] = 16)],
  [
    "SC12: tooling's tests step has no limit",
    (w) => Reflect.deleteProperty(step(w, "tooling", "tooling tests"), "timeout-minutes"),
  ],
  [
    "SC12: next's job limit equals its steps', so a hung test ends the run cancelled",
    (w) => (w.jobs["next"]!["timeout-minutes"] = 17),
  ],
  ["SC12: tooling's backstop is not 3 minutes", (w) => (w.jobs["tooling"]!["timeout-minutes"] = 40)],
  [
    "SC12: a test step's limit is not a whole number",
    (w) => {
      step(w, "tooling", "tooling tests")["timeout-minutes"] = "30";
      step(w, "report", "report").env!["LIMIT_TOOLING"] = "30";
    },
  ],
  [
    "SC5: the report's tooling limit is its own number",
    (w) => (step(w, "report", "report").env!["LIMIT_TOOLING"] = 25),
  ],
  ["SC5: next names its legs, so a leg's name loses its job id", (w) => (w.jobs["next"]!["name"] = "next/ tests")],
  // SC6: at most half the runners.
  [
    "SC6: next runs every leg at once and tooling three",
    (w) => {
      w.jobs["next"]!.strategy!["max-parallel"] = 7;
      w.jobs["tooling"]!.strategy!["max-parallel"] = 3;
    },
  ],
  ["SC6: next has no max-parallel", (w) => Reflect.deleteProperty(w.jobs["next"]!.strategy!, "max-parallel")],
  // GitHub's own fail fast stops a job's other legs and leaves the run's conclusion `failure`.
  ["SC6: a red tooling leg holds the other's runner", (w) => (w.jobs["tooling"]!.strategy!["fail-fast"] = false)],
  ["SC6: a red next leg holds the others' runners", (w) => (w.jobs["next"]!.strategy!["fail-fast"] = false)],
  [
    "SC6: a new job past the cap",
    (w) => {
      w.jobs["next"]!.strategy!["max-parallel"] = 7;
      w.jobs["tooling"]!.strategy!["max-parallel"] = 2;
      w.jobs["extra"] = structuredClone(w.jobs["tooling"]!);
      (w.jobs["report"]!.needs as string[]).push("extra");
      w.jobs["extra"].strategy!["max-parallel"] = 1;
    },
  ],
  // SC7 to SC9: the whole suite, nothing narrowed.
  ["SC7: next drops a leg", (w) => (w.jobs["next"]!.strategy!.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4"])],
  [
    "SC7: next's legs come from an expression",
    (w) => (w.jobs["next"]!.strategy!.matrix.shard = `\${{ fromJSON('["1"]') }}`),
  ],
  [
    "SC7: next's vitest legs each take a fourth",
    (w) => (step(w, "next", "vitest").env!["SHARD"] = `\${{ matrix.shard }}/4`),
  ],
  [
    "SC7: next's end-to-end legs each take a third",
    (w) => (step(w, "next", "end to end").env!["SHARD"] = `\${{ matrix.shard }}/3`),
  ],
  [
    "SC7: next narrows to what changed",
    (w) => {
      const s = step(w, "next", "vitest");
      s["run"] = String(s["run"]).replace("--shard", '--changed "$BASE" --shard');
    },
  ],
  [
    "SC7: next runs a list",
    (w) => {
      const s = step(w, "next", "vitest");
      s["run"] = String(s["run"]).replace("--shard", "$FILTER --shard");
    },
  ],
  [
    "SC7: the end-to-end legs narrow",
    (w) => {
      const s = step(w, "next", "end to end");
      s["run"] = String(s["run"]).replace("--project next-visual ", "--project next-visual --changed=main ");
    },
  ],
  // 0536: a project, not a path, picks each leg's files. Each plant was run once on the real
  // scheduled.yaml too, and restored.
  [
    "SC7: next runs next/ as a path, so next-visual starts on legs with no Chromium",
    (w) => {
      const s = step(w, "next", "vitest");
      s["run"] = String(s["run"]).replace("--project next --project next-integration ", "next/ ");
    },
  ],
  [
    "SC7: next drops next-integration, so the real-resource tests run nowhere",
    (w) => {
      const s = step(w, "next", "vitest");
      s["run"] = String(s["run"]).replace(" --project next-integration", "");
    },
  ],
  [
    "SC7: the end-to-end legs lose their project, so they run every next/ test",
    (w) => {
      const s = step(w, "next", "end to end");
      s["run"] = String(s["run"]).replace("--project next-visual ", "");
    },
  ],
  [
    "SC7: the end-to-end legs run the old runner, which 0536 removed",
    (w) => {
      const s = step(w, "next", "end to end");
      s["run"] = String(s["run"]).replace(
        "pnpm exec vitest run --project next-visual ",
        "node next/apps/fabrika/e2e.ts ",
      );
    },
  ],
  [
    "SC7: chromium waits on the old end-to-end folder",
    (w) => {
      const s = step(w, "next", "chromium");
      s["if"] = "startsWith(matrix.shard, 'e2e-') && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''";
    },
  ],
  ["SC7: vitest runs on the e2e legs too", (w) => Reflect.deleteProperty(step(w, "next", "vitest"), "if")],
  [
    "SC7: no chromium",
    (w) => w.jobs["next"]!.steps.splice(w.jobs["next"]!.steps.indexOf(step(w, "next", "chromium")), 1),
  ],
  [
    "SC8: tooling narrows to what changed",
    (w) => {
      const s = step(w, "tooling", "tooling tests");
      s["run"] = String(s["run"]).replace("--shard", '--changed "$BASE" --shard');
    },
  ],
  [
    "SC8: tooling runs today's tests too",
    (w) => {
      const s = step(w, "tooling", "tooling tests");
      s["run"] = String(s["run"]).replace("--project tooling", "--project tooling --project today");
    },
  ],
  [
    "SC8: tooling loses its project, so it runs every project",
    (w) => {
      const s = step(w, "tooling", "tooling tests");
      s["run"] = String(s["run"]).replace("--project tooling ", "");
    },
  ],
  [
    "SC8: tooling leaves the trees out with --exclude, which a project ignores",
    (w) => {
      const s = step(w, "tooling", "tooling tests");
      s["run"] = String(s["run"]).replace(
        "--project tooling ",
        "--exclude 'next/**' --exclude 'apps/**' --exclude 'packages/**' --exclude 'programs/**' ",
      );
    },
  ],
  [
    "SC8: tooling's two legs each take a third",
    (w) => (step(w, "tooling", "tooling tests").env!["SHARD"] = `\${{ matrix.shard }}/3`),
  ],
  [
    "SC9: next runs one more command",
    (w) => w.jobs["next"]!.steps.splice(3, 0, { run: "pnpm exec vitest run next/apps" }),
  ],
  ["SC9: tooling runs one more command", (w) => w.jobs["tooling"]!.steps.splice(3, 0, { run: "pnpm test" })],
  // SC11: every test leg at full depth (pull request 1274). Each plant was run once on workflow-lint.ts
  // with SC11 dropped, and that turned this law red.
  [
    "SC11: next's vitest legs run at the merge line's depth",
    (w) => Reflect.deleteProperty(step(w, "next", "vitest").env!, "FABRIKA_TEST_DEPTH"),
  ],
  ["SC11: the end-to-end legs run fast", (w) => (step(w, "next", "end to end").env!["FABRIKA_TEST_DEPTH"] = "fast")],
  [
    "SC11: tooling runs at the merge line's depth",
    (w) => Reflect.deleteProperty(step(w, "tooling", "tooling tests").env!, "FABRIKA_TEST_DEPTH"),
  ],
  // SC10: the reports the issue names its tests from.
  ["SC10: next's report is dropped after a red step", (w) => (step(w, "next", "results")["if"] = "success()")],
  [
    "SC10: tooling uploads no report",
    (w) => w.jobs["tooling"]!.steps.splice(w.jobs["tooling"]!.steps.indexOf(step(w, "tooling", "results")), 1),
  ],
  [
    "SC10: the upload comes before the tests",
    (w) => {
      const list = w.jobs["tooling"]!.steps;
      const upload = step(w, "tooling", "results");
      list.splice(list.indexOf(upload), 1);
      list.splice(2, 0, upload);
    },
  ],
  // TT1 and TT2, as in check.yaml: each leg's time table and its timings file. A leg's steps are
  // copied before a plant, so a plant on one leg leaves the other's alias as it was.
  ...(["next", "tooling"] as const).flatMap((job): [string, (w: Workflow) => void][] => {
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
    (w) => (step(w, "tooling", "results").env = { GITHUB_TOKEN: `\${{ github.token }}` }),
  ],
];

// SC4, 2026-11-15: a red run on a branch that had canceled itself ended `cancelled`, was read as cut
// off, and its pull request merged with two red laws. The old step also takes the token, which SC5
// names too, so this looks for SC4's own error on the job that gained it.
// Plant, run once on scheduled.ts and restored: SC4's cancel check dropped (red on each job).
it.each(["next", "tooling", "report"])(
  "SC4: %s with the old stop step back is named by SC4's error for that job",
  (job) => {
    fc.assert(
      fc.property(scheduled, (broken) => {
        broken.jobs[job]!.steps.push(structuredClone(stop));
        expect(lint(broken)).toContain(
          `scheduled.yaml: SC4: no step of ${job} cancels the run: a canceled run ends cancelled, never failure`,
        );
      }),
      { ...options, numRuns: 20 },
    );
  },
);

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

  for (const job of ["next", "tooling"]) {
    const slow = real();
    slow.jobs[job]!.strategy!["fail-fast"] = false;
    expect(lint(slow)).toEqual([
      `scheduled.yaml: SC6: ${job} sets max-parallel to at most its legs, and its first red leg stops the others`,
    ]);
  }
});

it("SC12 scenario: on the real scheduled.yaml, a test step with no limit of its own, or a job limit that is no backstop, is named by SC12", () => {
  // A job that runs into its own limit ends `cancelled`, and its run with it, even when the report
  // fails after it (probe run 43778355238); a test step that runs into its own ends `failure` (probe
  // run 43778586135). Plant, run once on scheduled.ts and restored: SC12 dropped (red on each case).
  const SC12 = (job: string) =>
    `scheduled.yaml: SC12: ${job}'s test steps share one timeout-minutes, and the job's own is 3 minutes more`;
  const LIMIT_TEXT =
    "scheduled.yaml: SC5: the report runs node .github/ci/scheduled.mjs once, with the needs, the results, the token and each test job's time limit, and its failure shows";

  // The shape before this change: the limit on the job alone, which a hung leg ran into.
  const onJob = real();
  Reflect.deleteProperty(step(onJob, "next", "vitest"), "timeout-minutes");
  Reflect.deleteProperty(step(onJob, "next", "end to end"), "timeout-minutes");
  onJob.jobs["next"]!["timeout-minutes"] = 17;
  expect(lint(onJob)).toEqual([LIMIT_TEXT, SC12("next")]);

  for (const minutes of [30, 32, 34]) {
    const near = real();
    near.jobs["tooling"]!["timeout-minutes"] = minutes;
    expect(lint(near)).toEqual([SC12("tooling")]);
  }

  const apart = real();
  step(apart, "next", "end to end")["timeout-minutes"] = 16;
  expect(lint(apart)).toEqual([LIMIT_TEXT, SC12("next")]);
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

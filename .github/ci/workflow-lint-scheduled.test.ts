import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintIssues, lintScheduled } from "./workflow-lint.ts";

// Today's CI, serving both versions. Covers workflow-lint.ts's laws on scheduled.yaml, the schedule
// that runs all of next/ and every tooling test on main (0534), and on who may touch issues. Each
// generated workflow is the real one with what does not change its meaning varied, and each plant is
// applied to it alone, so an unrelated error cannot mask it. Each plant was also run once on
// workflow-lint.ts with its rule dropped, and that turned this law red.
const options = { seed: 119120, numRuns: 100 };
const read = (path: string) => readFileSync(new URL(`../workflows/${path}`, import.meta.url), "utf8");
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

const stopOf = (w: Workflow, job: string) => w.jobs[job]!.steps.at(-1)!;

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
  // SC3: the token.
  [
    "SC3: the workflow's token writes issues",
    (w) => (w.permissions = { actions: "write", contents: "read", issues: "write" }),
  ],
  ["SC3: the workflow's token is write-all", (w) => (w.permissions = "write-all")],
  [
    "SC3: the workflow's token loses actions: write, so no stop step can cancel",
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
    (w) => (w.jobs["next"]!.permissions = { actions: "write", contents: "read", issues: "write" }),
  ],
  // SC4: fail fast, time limits, the token out of .git/config.
  ["SC4: next drops its stop step", (w) => void w.jobs["next"]!.steps.pop()],
  ["SC4: tooling drops its stop step", (w) => void w.jobs["tooling"]!.steps.pop()],
  [
    "SC4: the stop step comes before the upload",
    (w) => {
      const list = w.jobs["tooling"]!.steps;
      list.splice(-2, 2, list.at(-1)!, list.at(-2)!);
    },
  ],
  [
    "SC4: the stop step force-cancels",
    (w) =>
      (stopOf(w, "next")["run"] = 'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/force-cancel"'),
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
  ["SC5: the report runs on a branch too", (w) => (w.jobs["report"]!["if"] = "always()")],
  ["SC5: the report waits on next alone", (w) => (w.jobs["report"]!.needs = ["next"])],
  ["SC5: the report's failure is hidden", (w) => (step(w, "report", "report")["continue-on-error"] = true)],
  ["SC5: the report runs another script", (w) => (step(w, "report", "report")["run"] = "node .github/ci/required.mjs")],
  ["SC5: the report is not told the needs", (w) => Reflect.deleteProperty(step(w, "report", "report").env!, "NEEDS")],
  ["SC5: the report takes a secret", (w) => (step(w, "report", "report").env!["GITHUB_TOKEN"] = `\${{ secrets.BOT }}`)],
  ["SC5: a test step gets the token", (w) => (step(w, "next", "vitest").env!["GITHUB_TOKEN"] = `\${{ github.token }}`)],
  // SC6: at most half the runners.
  [
    "SC6: next runs every leg at once and tooling three",
    (w) => {
      w.jobs["next"]!.strategy!["max-parallel"] = 7;
      w.jobs["tooling"]!.strategy!["max-parallel"] = 3;
    },
  ],
  ["SC6: next has no max-parallel", (w) => Reflect.deleteProperty(w.jobs["next"]!.strategy!, "max-parallel")],
  ["SC6: a red leg stops the matrix's other legs", (w) => (w.jobs["tooling"]!.strategy!["fail-fast"] = true)],
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
      s["run"] = String(s["run"]).replace("next/ ", 'next/ --changed "$BASE" ');
    },
  ],
  [
    "SC7: next runs a list",
    (w) => {
      const s = step(w, "next", "vitest");
      s["run"] = String(s["run"]).replace("next/ ", "$FILTER ");
    },
  ],
  [
    "SC7: the end-to-end legs narrow",
    (w) => {
      const s = step(w, "next", "end to end");
      s["run"] = String(s["run"]).replace("e2e.ts ", "e2e.ts --changed=main ");
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
      s["run"] = String(s["run"]).replace(" --exclude 'packages/**'", "");
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
];

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

// 0534's binding constraint: the only issues automation opens here are the scheduled report's.
const grant = fc.constantFrom<unknown>(
  "write-all",
  { issues: "write" },
  { issues: "read" },
  { contents: "read", issues: "write" },
);

const other = fc.constantFrom(
  ".github/workflows/check.yaml",
  ".github/workflows/host.yaml",
  ".github/workflows/mutation.yaml",
  ".github/workflows/new.yaml",
);

it("pinned: the real workflows grant issues nowhere but scheduled.yaml", () => {
  const workflows = Object.fromEntries(
    ["check.yaml", "host.yaml", "mutation.yaml", "scheduled.yaml"].map((name) => [
      `.github/workflows/${name}`,
      read(name),
    ]),
  );
  expect(lintIssues(workflows)).toEqual([]);
});

it("property: any other workflow that grants issues, at the top or on a job, is named", () => {
  fc.assert(
    fc.property(other, grant, fc.boolean(), (path, given, onJob) => {
      const workflow: Record<string, unknown> = {
        on: { push: {} },
        jobs: { a: { "runs-on": "ubuntu-latest", steps: [] } },
      };

      if (onJob) {
        (workflow["jobs"] as Record<string, Record<string, unknown>>)["a"]!["permissions"] = given;
      } else {
        workflow["permissions"] = given;
      }

      const files = { [path]: JSON.stringify(workflow), ".github/workflows/scheduled.yaml": read("scheduled.yaml") };
      expect(lintIssues(files)).toEqual([`${path}: only scheduled.yaml's report job may touch issues (0534)`]);
      // The same workflow with a grant that leaves issues alone is fine.
      const clean = structuredClone(workflow);

      if (onJob) {
        (clean["jobs"] as Record<string, Record<string, unknown>>)["a"]!["permissions"] = { contents: "read" };
      } else {
        clean["permissions"] = { contents: "read" };
      }

      expect(lintIssues({ [path]: JSON.stringify(clean) })).toEqual([]);
    }),
    options,
  );
});

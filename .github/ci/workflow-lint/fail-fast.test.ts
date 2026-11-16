import { readFileSync } from "node:fs";
import * as Rec from "effect/Record";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint } from "../workflow-lint.ts";
import { options, type Plant, rejects, stepsOf, stop, stopping, wiring, type Workflow } from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers fail-fast.ts (ticket 990, F1 to F4). Each plant is
// given to every generated valid workflow alone (wiring.test-support.ts), so an unrelated error
// cannot mask it.

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
  const real = () => parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
  const jobs = Rec.keys(real().jobs).filter((job) => job !== "ci-required");
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

const plants: Plant[] = [
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
      const list = stepsOf(w, "next");
      list.splice(-2, 2, list.at(-1)!, list.at(-2)!);
    },
  ],
  [
    "F1: a second cancel step, with no guard for main",
    (w) => {
      stepsOf(w, "next").splice(-1, 0, { if: `\${{ failure() }}`, run: stop.run });
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
];

rejects(plants);

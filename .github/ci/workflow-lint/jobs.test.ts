import { type Plant, rejects, type Workflow } from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers jobs.ts: when each gated job runs, the jobs that may
// not come back, and every job's time limit. Each plant is given to every generated valid workflow
// alone (wiring.test-support.ts), so an unrelated error cannot mask it.

const plants: Plant[] = [
  [
    "next classifier failure skips",
    (w) => {
      w.jobs.next.if = "needs.changes.outputs.next == 'true'";
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
  // T496: a job with no time limit, one plant per job, and one limit past GitHub's default.
  ...(["changes", "check", "typecheck", "next", "ci-required"] as const).map((job): [string, (w: Workflow) => void] => [
    `${job} without a time limit`,
    (w) => {
      Object.assign(w.jobs[job], { "timeout-minutes": undefined });
    },
  ]),
  [
    "a time limit past the default",
    (w) => {
      w.jobs.next["timeout-minutes"] = 360;
    },
  ],
];

rejects(plants);

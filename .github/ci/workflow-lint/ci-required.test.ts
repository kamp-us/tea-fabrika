import { type Plant, rejects, step, type Workflow } from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers ci-required.ts, the one required check. Each plant is
// given to every generated valid workflow alone (wiring.test-support.ts), so an unrelated error
// cannot mask it.

const plants: Plant[] = [
  // The ci-required job: it waits on every job, never skips, and its judge cannot be bypassed.
  ...(["changes", "check", "typecheck", "next"] as const).map((job): [string, (w: Workflow) => void] => [
    `ci-required does not need ${job}`,
    (w) => {
      w.jobs["ci-required"].needs = w.jobs["ci-required"].needs.filter((name) => name !== job);
    },
  ]),
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
];

rejects(plants);

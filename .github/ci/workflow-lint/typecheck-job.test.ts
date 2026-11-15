import { type Plant, rejects } from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers typecheck-job.ts: the one place `pnpm typecheck` runs.
// Each plant is given to every generated valid workflow alone (wiring.test-support.ts), so an
// unrelated error cannot mask it.

const plants: Plant[] = [
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
];

rejects(plants);

import { place, type Plant, rejects, step } from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers classify.ts: changes' small scans, its checkout and its
// classify step. Each plant is given to every generated valid workflow alone
// (wiring.test-support.ts), so an unrelated error cannot mask it.

const plants: Plant[] = [
  [
    "scan skips after failure",
    (w) => {
      Object.assign(step(w, "changes", "skills check"), { if: "success()" });
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
];

rejects(plants);

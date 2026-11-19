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
  // The classifier's pinned Node and its link to @kalfa/ci: each is red alone in every generated workflow.
  [
    "the classifier's Node setup is gone",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "setup node for the classifier"), 1);
    },
  ],
  [
    "the classifier's link is gone",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "link @kalfa/ci"), 1);
    },
  ],
  [
    "the classifier runs on another Node",
    (w) => {
      Object.assign(step(w, "changes", "setup node for the classifier"), { with: { "node-version": "24" } });
    },
  ],
  [
    "the classifier's Node setup may fail",
    (w) => {
      Object.assign(step(w, "changes", "setup node for the classifier"), { "continue-on-error": true });
    },
  ],
  [
    "the classifier's link is conditional",
    (w) => {
      Object.assign(step(w, "changes", "link @kalfa/ci"), { if: "success()" });
    },
  ],
  [
    "the classifier's link points elsewhere",
    (w) => {
      Object.assign(step(w, "changes", "link @kalfa/ci"), {
        run: "mkdir -p .github/ci/node_modules/@kalfa && ln -s ../../../kalfa/ci .github/ci/node_modules/@kalfa/ci",
      });
    },
  ],
  [
    "the classifier's link comes after the classify step",
    (w) => {
      const [link] = w.jobs.changes.steps.splice(place(w, "changes", "link @kalfa/ci"), 1);
      w.jobs.changes.steps.splice(place(w, "changes", "classify") + 1, 0, link!);
    },
  ],
];

rejects(plants);

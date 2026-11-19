import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint } from "../workflow-lint.ts";
import {
  build,
  env,
  guard,
  options,
  place,
  type Plant,
  ratchet,
  rejects,
  step,
  wiring,
  type Workflow,
} from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers check-job.ts: the check job's steps and flags (F1,
// ticket 985) and its ratchet step (L7). Each plant is given to every generated valid workflow
// alone (wiring.test-support.ts), so an unrelated error cannot mask it.

it("L7: a check job without its ratchet step is named by that one error", () => {
  fc.assert(
    fc.property(wiring, (broken) => {
      broken.jobs.check.steps.splice(place(broken, "check", "lists only shrink"), 1);
      const errors = lint(JSON.stringify(broken));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("ratchet.ts");
    }),
    options,
  );
});

it("L7 scenario: the checked-in check.yaml fails with its ratchet step deleted, given an if, or given another base", () => {
  const real = () => parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(real()))).toEqual([]);

  for (const mutate of [
    (w: Workflow) => {
      w.jobs.check.steps.splice(place(w, "check", "lists only shrink"), 1);
    },
    (w: Workflow) => {
      step(w, "check", "lists only shrink")["if"] = build;
    },
    (w: Workflow) => {
      step(w, "check", "lists only shrink")["env"] = { BASE: env.BASE };
    },
  ]) {
    const broken = real();
    mutate(broken);
    expect(lint(JSON.stringify(broken))).not.toEqual([]);
  }
});

const plants: Plant[] = [
  [
    "the build runs on a draft",
    (w) => {
      delete step(w, "check", "build")["if"];
    },
  ],
  [
    "the build skips on the check flag",
    (w) => {
      step(w, "check", "build")["if"] = `\${{ needs.changes.outputs.check != 'false' }}`;
    },
  ],
  [
    "lint skips on a draft",
    (w) => {
      step(w, "check", "lint")["if"] = build;
    },
  ],
  // F1: the check job's flags. Plants on the check job's own steps.
  ...(
    [
      [
        "check skips when the classifier failed",
        (w) => (w.jobs.check.if = "${{ !cancelled() && needs.changes.outputs.check != 'false' }}"),
      ],
      ["the full install runs for no flag", (w) => (step(w, "check", "install")["if"] = build)],
      ["lint runs for no flag", (w) => (step(w, "check", "lint")["if"] = build)],
      ["the ratchet runs for no flag", (w) => Reflect.deleteProperty(step(w, "check", "lists only shrink"), "if")],
      ["check checks out no history", (w) => (step(w, "check", "checkout")["with"] = {})],
    ] as [string, (w: Workflow) => void][]
  ).map(([fault, mutate]): [string, (w: Workflow) => void] => [
    fault,
    (w) => {
      mutate(w);
    },
  ]),
  // 0587 (C1): jscpd is advice only, so a step that can fail the job, or that is gone, is refused.
  [
    "C1: the copies step can fail the job",
    (w) => Reflect.deleteProperty(step(w, "check", "copies (advice)"), "continue-on-error"),
  ],
  [
    "C1: the copies step is deleted",
    (w) => {
      w.jobs.check.steps.splice(place(w, "check", "copies (advice)"), 1);
    },
  ],
  [
    "C1: the copies step runs after lint",
    (w) => {
      const [copies] = w.jobs.check.steps.splice(place(w, "check", "copies (advice)"), 1);
      w.jobs.check.steps.push(copies!);
    },
  ],
  [
    "C1: the copies step has no base",
    (w) => {
      step(w, "check", "copies (advice)")["env"] = {};
    },
  ],
  // 0524, ticket 933 (L7): a pull request that drops or mutes the ratchet would pass with a grown list.
  [
    "L7: the ratchet step is deleted",
    (w) => {
      w.jobs.check.steps.splice(place(w, "check", "lists only shrink"), 1);
    },
  ],
  [
    "L7: the ratchet step skips on a condition",
    (w) => {
      step(w, "check", "lists only shrink")["if"] = build;
    },
  ],
  [
    "L7: the ratchet step's failure does not block",
    (w) => {
      step(w, "check", "lists only shrink")["continue-on-error"] = true;
    },
  ],
  [
    "L7: the ratchet step takes a base that keeps a first push's zeros",
    (w) => {
      step(w, "check", "lists only shrink")["env"] = { BASE: env.BASE };
    },
  ],
  [
    "L7: the ratchet step runs twice, once muted",
    (w) => {
      w.jobs.check.steps.push({ ...step(w, "check", "lists only shrink"), "continue-on-error": true });
    },
  ],
  [
    "L7: the ratchet command swallows its exit",
    (w) => {
      step(w, "check", "lists only shrink")["run"] = `${ratchet} || true`;
    },
  ],
];

rejects(plants);

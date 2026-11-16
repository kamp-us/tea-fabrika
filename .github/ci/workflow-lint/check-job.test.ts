import { readFileSync } from "node:fs";
import * as Arr from "effect/Array";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint } from "../workflow-lint.ts";
import {
  build,
  checkFlag,
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
  // F1 to F3, the field row check inside check (ticket 985). Source plants, each run once on
  // workflow-lint.ts and restored: the rows anywhere in check (red: before lint); F3 dropped (red: a legs job, a field job comes back).
  ...Arr.map(
    [
      [
        "the row check ignores failure",
        (w) => Object.assign(step(w, "check", "field rows"), { "continue-on-error": true }),
      ],
      [
        "the row check runs before lint",
        (w) => {
          const [rows] = w.jobs.check.steps.splice(place(w, "check", "field rows"), 1);
          w.jobs.check.steps.splice(place(w, "check", "lint"), 0, rows!);
        },
      ],
      [
        "the row check skips after a failure",
        (w) => (step(w, "check", "field rows")["if"] = `\${{ needs.changes.outputs.field != 'false' }}`),
      ],
      ["the row check runs on the check flag", (w) => (step(w, "check", "field rows")["if"] = checkFlag)],
      [
        "the row check without its base",
        (w) => Reflect.deleteProperty(step(w, "check", "field rows")["env"] as Record<string, string>, "BASE"),
      ],
      ["the row check bypassed", (w) => (step(w, "check", "field rows")["run"] = "echo passed")],
      ["the row check twice", (w) => w.jobs.check.steps.push({ ...step(w, "check", "field rows") })],
      ["check runs only on the check flag", (w) => (w.jobs.check.if = guard("check"))],
      [
        "rows alone install everything",
        (w) => w.jobs.check.steps.splice(place(w, "check", "install the row check"), 1),
      ],
      ["the row install runs with lint", (w) => (step(w, "check", "install the row check")["if"] = checkFlag)],
      ["the full install runs for rows alone", (w) => Reflect.deleteProperty(step(w, "check", "install"), "if")],
      ["lint runs for rows alone", (w) => Reflect.deleteProperty(step(w, "check", "lint"), "if")],
      ["the ratchet runs for rows alone", (w) => Reflect.deleteProperty(step(w, "check", "lists only shrink"), "if")],
      ["check checks out no history", (w) => (step(w, "check", "checkout")["with"] = {})],
      [
        "a field job comes back",
        (w) => {
          Object.assign(w.jobs, {
            field: { "timeout-minutes": 5, steps: [{ run: "node .github/ci/field-check.ts" }] },
          });
          w.jobs["ci-required"].needs.push("field");
        },
      ],
    ] as [string, (w: Workflow) => unknown][],
    ([fault, mutate]): [string, (w: Workflow) => void] => [
      fault,
      (w) => {
        mutate(w);
      },
    ],
  ),
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

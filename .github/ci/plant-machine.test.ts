import { arbGuidedSequence } from "@demlik/tea/pbt";
import { step } from "@demlik/tea/testing";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as fc from "fast-check";
import { machine, Model, Observation, phase } from "./plant-machine.ts";

const details = {
  title: "selected law",
  file: "selected.test.ts",
  exit: 0 as const,
  ms: 1,
  duration: 1,
  suites: { total: 1, passed: 1, failed: 0, pending: 0, todo: 0 },
  counts: { total: 1, passed: 1, failed: 0, pending: 0, todo: 0 },
};

const results = fc.oneof(
  fc.constant(Observation.cases.passed.make(details)),
  fc.constant(
    Observation.cases.failed.make({
      ...details,
      exit: 1,
      category: "assertion",
      assertion: null,
      diagnostic: "assertion mismatch",
    }),
  ),
  fc.string().map((reason) => Observation.cases.incomplete.make({ reason })),
);

const lists = arbGuidedSequence(
  machine,
  {},
  {
    answers: {
      phase: {
        draw: fc.oneof({ weight: 6, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: results }),
        make: (cmd, value) =>
          phase.ok(
            cmd,
            value ??
              (cmd.phase === "broken"
                ? Observation.cases.failed.make({
                    ...details,
                    exit: 1,
                    category: "assertion",
                    assertion: null,
                    diagnostic: "assertion mismatch",
                  })
                : Observation.cases.passed.make(details)),
            0,
          ),
      },
    },
  },
  { maxLength: 12 },
);

// tea's guided queue uses fast-check Arbitrary; installed Effect's it.prop accepts only its native
// Arbitrary. Use tea's generator directly so shrinking still follows outstanding commands.
it(
  "phase walks record only pass, failure, pass and keep incomplete answers terminal",
  { meta: { plant: "advance on an incomplete phase" } },
  () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(lists, (messages) => {
        let [model, commands] = machine.init(null, {});
        const seen: Observation[] = [];

        for (const msg of messages) {
          const previous = model;
          const terminal = Model.isAnyOf(["recorded", "incomplete"])(previous);
          [model, commands] = step(machine, model, msg, {});
          reached.add(model._tag);

          if (terminal) {
            expect(model).toEqual(previous);
          } else {
            seen.push(msg.value);
          }

          if (Model.isAnyOf(["recorded"])(model)) {
            expect(seen.map((value) => value._tag)).toEqual(["passed", "failed", "passed"]);
            expect(commands).toEqual([]);
          }

          if (Model.isAnyOf(["incomplete"])(model)) {
            expect(commands).toEqual([]);
          }

          if (Model.isAnyOf(["recorded", "incomplete"])(model)) {
            expect(step(machine, model, msg, {})[0]).toEqual(model);
          }
        }

        const [initial, pending] = machine.init(null, {});
        const cmd = pending[0]!;

        const [missing] = step(
          machine,
          initial,
          phase.ok(cmd, Observation.cases.incomplete.make({ reason: "unknown" }), 0),
          {},
        );

        expect(Model.isAnyOf(["incomplete"])(missing)).toBe(true);
      }),
      { numRuns: runsFor({ fast: 100, full: 100 }) },
    );
    expect([...reached].sort()).toEqual(["broken", "incomplete", "recorded", "restored"]);
  },
);

import { arbGuidedSequence, propertyTrace } from "@demlik/tea/pbt";
import { step } from "@demlik/tea/testing";
import { it, expect } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Schema } from "effect";
import fc from "fast-check";
import { cached, Request } from "./l11-cases.ts";
import { machine, Model, Outcome, perform, type Phase } from "./l11-machine.ts";

const options = { arbitrary: { runs: runsFor({ fast: 100, full: 100 }), size: 30, concurrency: 1 } };

const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

// Pure machine walks. No files, child processes, signals or runtime adapters.

const success = (phase: Phase): Outcome => {
  switch (phase) {
    case "inspect":
      return Outcome.cases.ready.make({});
    case "measurement":
      return Outcome.cases.timing.make({ failed: true, timeout: true });
    case "diagnostic":
      return Outcome.cases.equal.make({});
    case "baseline":
    case "restored":
      return Outcome.cases.passed.make({});
    case "broken":
      return Outcome.cases.leaked.make({});
    case "restore":
      return Outcome.cases.restored.make({});
  }
};

it.prop(
  "case-specific phase walks preserve timing failures and require plant restoration",
  { name: Request.fields.case, fail: Schema.Boolean },
  ({ name, fail }) => {
    // Effect Arbitrary cannot draw outstanding tea command answers. Plant: accept a timeout as a red output assertion.

    const request: Request = { case: name, sha: cached };
    const ctx = { request };

    const lists = arbGuidedSequence(
      machine,
      ctx,
      {
        answers: {
          l11_phase: {
            draw: fc.boolean(),
            make: (cmd, bad) =>
              perform.ok(
                cmd,
                {
                  phase: cmd.phase,
                  outcome: bad && fail ? Outcome.cases.incomplete.make({ reason: "timeout" }) : success(cmd.phase),
                },
                0,
              ),
          },
        },
      },
      { maxLength: 16 },
    );

    propertyTrace(
      machine,
      ctx,
      lists,
      (steps, final) => {
        expect(Model.make(final)).toEqual(final);

        for (const frame of steps) {
          if (frame.msg.type !== "l11_phase_ok") {
            continue;
          }

          const phase = frame.msg.value.phase;

          if (phase === "broken") {
            expect(frame.prev._tag).toBe("broken");
          }

          if (phase === "restored") {
            expect(frame.prev.history.map((observation) => observation.phase)).toEqual([
              "inspect",
              "baseline",
              "broken",
              "restore",
            ]);
          }
        }

        if (Model.isAnyOf(["observed"])(final)) {
          const phases = final.history.map((observation) => observation.phase);

          if (name === "l11-compare" || name === "l11-batch") {
            expect(phases).toEqual(["inspect", "measurement", "restore"]);
          } else if (name === "l11-inputs") {
            expect(phases).toEqual(["inspect", "diagnostic", "restore"]);
          } else {
            expect(phases).toEqual(["inspect", "baseline", "broken", "restore", "restored"]);
          }

          expect(final.history.some((observation) => Outcome.isAnyOf(["incomplete"])(observation.outcome))).toBe(false);
        }

        return true;
      },
      { numRuns: 1 },
    );
  },
  options,
);

it.prop(
  "a plant timeout cannot complete while a measurement timeout remains an observation",
  { name: Request.fields.case, failure: integer(0, 6) },
  ({ name, failure }) => {
    // Plant: treat broken timing as leaked. Generated failure point includes every phase boundary.

    const ctx = { request: Request.make({ case: name, sha: cached }) };
    let [model, commands] = machine.init(null, ctx);
    let count = 0;

    while (commands.length > 0) {
      const cmd = commands[0]!;

      const outcome =
        count++ === failure ? Outcome.cases.timing.make({ failed: true, timeout: true }) : success(cmd.phase);

      [model, commands] = step(machine, model, perform.ok(cmd, { phase: cmd.phase, outcome }, 0), ctx);
      expect(count).toBeLessThan(8);
    }

    if (name === "l11-row") {
      expect(model._tag).toBe("incomplete");
    }

    if (name !== "l11-compare" && name !== "l11-batch" && count > failure) {
      expect(model._tag).toBe("incomplete");
    }

    const [restarted, repeated] = machine.init(model, ctx);
    expect(restarted).toEqual(model);
    expect(repeated).toEqual([]);
  },
  options,
);

// Pure machine walks. No files, child processes, signals or runtime adapters.
import { arbGuidedSequence, propertyTrace } from "@demlik/tea/pbt";
import { step } from "@demlik/tea/testing";
import fc from "fast-check";
import { expect, it } from "vitest";
import { cached, cases, Request } from "./l11-cases.ts";
import { machine, Model, Outcome, perform, type Phase } from "./l11-machine.ts";

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

it("case-specific phase walks preserve timing failures and require plant restoration", () => {
  // Effect Arbitrary cannot draw outstanding tea command answers. Plant: accept a timeout as a red output assertion.
  fc.assert(
    fc.property(fc.constantFrom(...cases), fc.boolean(), (name, fail) => {
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

            expect(final.history.some((observation) => Outcome.isAnyOf(["incomplete"])(observation.outcome))).toBe(
              false,
            );
          }

          return true;
        },
        { numRuns: 1 },
      );
    }),
    { numRuns: 100 },
  );
});

it("a plant timeout cannot complete while a measurement timeout remains an observation", () => {
  // Plant: treat broken timing as leaked. Generated failure point includes every phase boundary.
  fc.assert(
    fc.property(fc.constantFrom(...cases), fc.integer({ min: 0, max: 6 }), (name, failure) => {
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
    }),
    { numRuns: 100 },
  );
});

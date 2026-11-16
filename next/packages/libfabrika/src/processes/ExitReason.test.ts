// P34c slice 1, next/: the exit reason's own boundary. L1 and L7 decode generated reasons and
// mutations of them against the fixture's independent copy of the schema; L9 is checked by tsc on
// the uncalled cases below. The real-store halves of L1 and L7 are in ExitReasonTest.ts.
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { ExitReason } from "./ExitReason.ts";
import {
  copied,
  ERROR_CLASS_MAX,
  fcBadReason,
  fcExitReason,
  ExitReason as Fixture,
  PHASES,
} from "./Process.test-support.ts";
import { NoProc } from "./Process.ts";
import type { ProcessCalls, ProcessManager } from "./ProcessManager.ts";

const decode = Schema.decodeUnknownResult(ExitReason);
const fixture = Schema.is(Fixture);

describe("P34c slice 1: the exit reason schema", () => {
  it("L1 / p112: every fixed reason decodes to an equal value after serialization; text and unknown tags are refused", () => {
    fc.assert(
      fc.property(
        fcExitReason.chain((reason) => fc.tuple(fc.constant(reason), fcBadReason(reason))),
        ([reason, bad]) => {
          const decoded = decode(copied(reason));
          expect(Result.isSuccess(decoded), "a valid reason decodes").toBe(true);
          expect(Result.getOrThrow(decoded)).toEqual(reason);
          expect(Schema.encodeSync(ExitReason)(Result.getOrThrow(decoded))).toEqual(reason);
          expect(fixture(bad), "the mutation is invalid by the fixture's own schema").toBe(false);
          expect(Result.isFailure(decode(bad)), `invalid input is refused: ${JSON.stringify(bad)}`).toBe(true);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });

  it("L7: a crash needs a known phase, and its class is refused past the bound, never truncated", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PHASES),
        fc.integer({ min: 0, max: ERROR_CLASS_MAX + 64 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (phase, length, word) => {
          const error = "E".repeat(length);
          // A crash made whole, then given a class of any length, inside the bound or past it.
          const answer = decode({ ...Fixture.cases.crashed.make({ phase }), error });

          if (length >= 1 && length <= ERROR_CLASS_MAX) {
            expect(Result.getOrThrow(answer), "a class inside the bound is kept whole").toEqual(
              ExitReason.cases.crashed.make({ phase, error }),
            );
          } else {
            expect(Result.isFailure(answer), `a class of ${length} characters is refused`).toBe(true);
          }

          expect(Result.getOrThrow(decode(Fixture.cases.crashed.make({ phase }))), "the class is optional").toEqual(
            ExitReason.cases.crashed.make({ phase }),
          );
          const { phase: _phase, ...phaseless } = Fixture.cases.crashed.make({ phase, error: "Error" });
          expect(Result.isFailure(decode(phaseless)), "the phase is required").toBe(true);
          const unknown = (PHASES as ReadonlyArray<string>).includes(word) ? `${word}_` : word;
          const unknownPhase = { ...Fixture.cases.crashed.make({ phase }), phase: unknown };
          expect(Result.isFailure(decode(unknownPhase)), "an unknown phase").toBe(true);
          expect(Result.isFailure(decode(NoProc.make({}))), "noproc is a monitor result, never an exit").toBe(true);
        },
      ),
      {
        seed: 119120,
        numRuns: 100,
        examples: [
          ["step", ERROR_CLASS_MAX, "x"],
          ["interrupted", ERROR_CLASS_MAX + 1, "x"],
        ],
      },
    );
  });
});

// L9: a structured reason cannot be replaced by text at a typed exit call site. tsc checks these
// uncalled cases; each rejection has a valid neighbor.
function exitTypeErrors(
  manager: ProcessManager["Service"],
  calls: ProcessCalls,
  from: Parameters<ProcessCalls["exit"]>[2],
) {
  const crash = manager.exit(
    "process_0000000000e008000000000000",
    ExitReason.cases.crashed.make({ phase: "step", error: "TypeError" }),
    from,
  );
  // @ts-expect-error An exit reason is the closed union, not text.
  const crashText = manager.exit("process_0000000000e008000000000000", "crashed", from);
  const shutdown = calls.exit("process_0000000000e008000000000000", ExitReason.cases.shutdown.make({}), from);
  // @ts-expect-error The remote calls keep the same closed union.
  const shutdownText = calls.exit("process_0000000000e008000000000000", "shutdown", from);
  const { phase: _phase, ...phaseless } = ExitReason.cases.crashed.make({ phase: "step" });
  // @ts-expect-error A crash names its phase.
  const noPhase = manager.exit("process_0000000000e008000000000000", phaseless, from);
  // @ts-expect-error noproc is a monitor result, not an exit reason.
  const noproc = manager.exit("process_0000000000e008000000000000", NoProc.make({}), from);
  const reason: typeof ExitReason.Type = ExitReason.cases.normal.make({});
  // @ts-expect-error The exported type is the union too.
  const text: typeof ExitReason.Type = "normal";
  return [crash, crashText, shutdown, shutdownText, noPhase, noproc, reason, text];
}

void exitTypeErrors;

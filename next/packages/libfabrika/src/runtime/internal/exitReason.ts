import { ExitReason } from "../../processes/ExitReason.ts";
import { Failure } from "./recovery.ts";

/**
 * The exit reason for one captured failure: its phase, and the class the runner already captured.
 * A class past the bound is kept whole, never cut to fit, so the exit boundary refuses it.
 * @internal
 */
export const fromFailure = (failure: Failure): ExitReason =>
  Failure.match(failure, {
    interrupted: () => ExitReason.cases.crashed.make({ phase: "interrupted" }),
    fresh: ({ error }) => ExitReason.cases.crashed.make({ phase: "step", error }, { disableChecks: true }),
    saved: ({ error }) => ExitReason.cases.crashed.make({ phase: "saved_letter", error }, { disableChecks: true }),
  });

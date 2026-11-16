/**
 * The runner's quota guard: a name with a saved reserve fault does no work until a person
 * restarts it.
 */
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import { NotGranted, Writer } from "../access/SessionManager.ts";
import { QuotasError, type Accounting, type RecoveryReserveExhausted } from "../processes/Quotas.ts";
import type { ProgramRunner } from "./Runner.ts";

/**
 * Error the runner raises inside a turn when its own message, a timer's or a command answer's, is
 * refused for quota. The turn catches it, keeps the saved wake or command and sets an alarm to
 * try again.
 *
 * @category errors
 */
export class QuotaWaiting extends Schema.TaggedError<QuotaWaiting>()("QuotaWaiting", {}) {}

/**
 * Returns the reserve fault an error names: its own, or the one a lower module kept as its
 * `cause` when it translated the error into its own type, as the ledger does for a throw inside a
 * Project turn and the recovery store does for a refused save. The guard and the runner read it
 * here, so a fault is met by name on every path.
 *
 * @category getters
 */
export const reserveFault = (error: unknown): RecoveryReserveExhausted | undefined => {
  if (error instanceof QuotasError) {
    return Match.value(error.reason).pipe(
      Match.tag("RecoveryReserveExhausted", (reason) => reason),
      Match.orElse(() => undefined),
    );
  }

  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  // An error with a reason keeps the fault from below under that reason, as the recovery store does.
  const below = "cause" in error ? reserveFault(error.cause) : undefined;
  return below ?? ("reason" in error ? reserveFault(error.reason) : undefined);
};

/**
 * Wraps a runner so every entry first checks the name's saved reserve fault, and records a
 * reserve fault that the entry itself meets.
 *
 * **Details**
 *
 * On a stopped name `open`, `msg`, `init`, `restart` and `swap` fail with the fault. `due` and `mailed`
 * end without doing work. A fault that reaches the guard inside another module's error is saved
 * the same way, and the call fails with the fault itself.
 *
 * @category combinators
 */
export const guard = (runner: ProgramRunner["Service"], accounting: Accounting): ProgramRunner["Service"] => {
  const checked = <A, E>(work: Effect.Effect<A, E>) =>
    Effect.andThen(accounting.check, work).pipe(
      Effect.catch((error): Effect.Effect<never, E | QuotasError> => {
        const fault = reserveFault(error);
        return fault === undefined
          ? Effect.fail(error)
          : Effect.andThen(
              accounting.recordFault(fault),
              Effect.fail(error instanceof QuotasError ? error : new QuotasError({ reason: fault })),
            );
      }),
    );
  const automatic = (work: ReturnType<ProgramRunner["Service"]["due"]>) =>
    checked(work).pipe(Effect.catchReason("QuotasError", "RecoveryReserveExhausted", () => Effect.void));
  return {
    open: (client) => checked(runner.open(client)),
    msg: (input) => checked(runner.msg(input)),
    due: (at) => automatic(runner.due(at)),
    mailed: automatic(runner.mailed),
    init: () => checked(runner.init()),
    restart: (request) => checked(runner.restart(request)),
    swap: (request) => checked(runner.swap(request)),
  };
};

/**
 * Restarts a stopped name for a person: clears its saved reserve fault once the pending charge
 * fits, then runs the runner's restart. The caller is the person's gate: it calls this only for a
 * restart it has checked is the person's.
 *
 * @category combinators
 */
export const personRestart = Effect.fn("quota_runner.restart")(function* (
  runner: ProgramRunner["Service"],
  accounting: Accounting,
  request: { readonly id: string; readonly build: string },
) {
  yield* accounting.resume;
  return yield* runner.restart({ id: request.id, build: request.build });
});

/**
 * Restarts a stopped name for the checked writer `by`, as `personRestart` does for a person. Any
 * other writer fails with `NotGranted`.
 *
 * @category combinators
 */
export const restart = (
  runner: ProgramRunner["Service"],
  accounting: Accounting,
  request: { readonly id: string; readonly build: string; readonly by: Writer },
) =>
  Writer.isAnyOf(["person"])(request.by)
    ? personRestart(runner, accounting, { id: request.id, build: request.build })
    : Effect.fail(new NotGranted({}));

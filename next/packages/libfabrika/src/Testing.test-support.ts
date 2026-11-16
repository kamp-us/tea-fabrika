// Shared by libfabrika's own laws: a fast-check property whose check is a scoped Effect, run as one
// Effect from the shared seed, so a law file does not paste its own runner and failure type.
import { Effect, Schema, type Scope } from "effect";
import * as fc from "fast-check";

/** The shared fixed seed every law runs from. */
const SEED = 119120;

/** fast-check's own failure report, with its counterexample, as a law's typed failure. */
class PropertyFailed extends Schema.TaggedError<PropertyFailed>()("PropertyFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * The first step of each property run: once the law's `signal` has aborted, it ends the whole
 * fast-check run, shrinking included, before anything opens.
 *
 * **Details**
 *
 * A law's abort (its timeout) fails the run in flight, and fast-check would then shrink: run the
 * property again on smaller values. Effect starts a run up to its first wait even with an aborted
 * signal, so each of those runs would still open what it needs. Past the abort this step fails
 * synchronously with fast-check's own interruption, `PreconditionFailure(true)`, which ends the
 * run there. A run that starts before the abort passes through unchanged.
 *
 * @category testing
 */
export const stopOnAbort = (signal: AbortSignal) =>
  Effect.suspend(() => (signal.aborted ? Effect.fail(new fc.PreconditionFailure(true)) : Effect.void));

/**
 * Checks `law` on values from `arbitrary`, each in a scope of its own, from the shared seed. `parameters`
 * are fast-check's own, such as `numRuns` and `examples`; a failure is `PropertyFailed` with fast-check's
 * report, the law's own error included.
 *
 * Each run happens under the law's own signal. When the law is interrupted (its timeout), the run in
 * flight is interrupted too, so its scope closes, and `stopOnAbort` ends the fast-check run, so no
 * shrink starts another run that would go on into later laws.
 */
export const property = <A>(
  arbitrary: fc.Arbitrary<A>,
  law: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>,
  parameters: fc.Parameters<[A]>,
): Effect.Effect<void, PropertyFailed> => {
  const run = (signal: AbortSignal, value: A) => stopOnAbort(signal).pipe(Effect.andThen(Effect.scoped(law(value))));

  const checked = (signal: AbortSignal) =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each scoped check
    fc.asyncProperty(arbitrary, (value) => Effect.runPromise(Effect.asVoid(run(signal, value)), { signal }));

  const options = { seed: SEED, includeErrorInReport: true, ...parameters };
  const assert = (signal: AbortSignal) => fc.assert(checked(signal), options);

  // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
  return Effect.tryPromise({ try: assert, catch: (cause) => new PropertyFailed({ cause }) });
};

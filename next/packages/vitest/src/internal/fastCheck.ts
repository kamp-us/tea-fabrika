/**
 * The fast-check path of the package's property members (decisions 0579 and 0580): the property
 * runner libfabrika's laws shared, moved here unchanged in what it does. Each case runs in a `Scope`
 * of its own, from the shared seed the package sets when `Law.ts` loads, under the law's own signal,
 * and a case past the law's abort ends the whole fast-check run, shrinking included.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as fc from "fast-check";

/**
 * A property's fast-check inputs, by name: each value is one of the property's arbitraries, in key
 * order, so one input `{ log: Log }` runs `fc.asyncProperty(Log, ...)` as the old runner did.
 *
 * @stability unstable
 * @category models
 */
export type Inputs = { readonly [name: string]: fc.Arbitrary<unknown> };

/**
 * The values one case draws, by the input's name.
 *
 * @stability unstable
 * @category models
 */
export type Values<Arbs> = { [K in keyof Arbs]: Arbs[K] extends fc.Arbitrary<infer A> ? A : never };

/** The values one case draws, as the path hands them on: by name, each from its own input. */
type Drawn = { readonly [name: string]: unknown };

/**
 * fast-check's own failure report, with its counterexample and the law's own error, as a law's
 * typed failure. Its message is the report, so vitest prints it as the law's error.
 *
 * @stability unstable
 * @category errors
 */
export class PropertyFailed extends Schema.TaggedError<PropertyFailed>()("PropertyFailed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * The first step of each case: once the law's `signal` has aborted, it ends the whole fast-check
 * run, shrinking included, before anything opens.
 *
 * **Details**
 *
 * A law's abort (its timeout) fails the case in flight, and fast-check would then shrink: run the
 * property again on smaller values. Effect starts a run up to its first wait even with an aborted
 * signal, so each of those runs would still open what it needs. Past the abort this step fails
 * synchronously with fast-check's own interruption, `PreconditionFailure(true)`, which ends the run
 * there. A case that starts before the abort passes through unchanged.
 *
 * @stability unstable
 * @category testing
 */
const stopOnAbort = (signal: AbortSignal) =>
  Effect.suspend(() => (signal.aborted ? Effect.fail(new fc.PreconditionFailure(true)) : Effect.void));

/** The message of what `fc.assert` threw: its report, or the thrown value as text. */
const report = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * Checks `law` on the values `inputs` draw, each case in a scope of its own, with the services of
 * the Effect it runs in. `parameters` are fast-check's own, such as `numRuns`, `examples` and
 * `endOnFailure`. The law's answer is never its verdict: a case fails only when its Effect fails.
 *
 * **Details**
 *
 * Each case runs under the law's own `signal`. When the law is interrupted (its timeout), the case
 * in flight is interrupted too, so its scope closes, and `stopOnAbort` ends the fast-check run, so
 * no shrink starts another case that would go on into later laws.
 *
 * @stability unstable
 * @category testing
 */
export const check = Effect.fnUntraced(function* <R>(
  inputs: Inputs,
  law: (values: Drawn) => Effect.Effect<unknown, unknown, R | Scope.Scope>,
  signal: AbortSignal,
  parameters: fc.Parameters<unknown> | undefined,
) {
  const services = yield* Effect.context<Exclude<R, Scope.Scope>>();
  const names = Object.keys(inputs);
  const arbitraries = names.flatMap((name) => inputs[name] ?? []);
  const values = (drawn: ReadonlyArray<unknown>): Drawn =>
    Object.fromEntries(names.map((name, at) => [name, drawn[at]]));
  const run = (drawn: ReadonlyArray<unknown>) =>
    stopOnAbort(signal).pipe(Effect.andThen(Effect.scoped(law(values(drawn)))), Effect.asVoid);
  const [first, ...rest] = arbitraries;

  if (first === undefined) {
    return yield* Effect.die(new Error("a property needs at least one input"));
  }

  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each scoped case
  const property = fc.asyncProperty(first, ...rest, (...v) => Effect.runPromiseWith(services)(run(v), { signal }));
  const options = { includeErrorInReport: true, ...parameters };
  const failed = (cause: unknown) => new PropertyFailed({ message: report(cause), cause });
  // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
  yield* Effect.tryPromise({ try: () => fc.assert(property, options), catch: failed });
});

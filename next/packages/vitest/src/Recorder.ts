/**
 * The one typed way a law watches a service's calls (decision 0579): a test spy, in Fowler's and
 * Meszaros's words. `Recorder.layer(Service, impl, { fails })` provides the service from `impl` and
 * records each run of its effectful members as `{ method, args }`, in run order. A law reads them
 * with `yield* Recorder.calls(Service)`, or one method's argument lists with
 * `yield* Recorder.calls(Service, "push")`, inside the Effect the layer is provided to.
 *
 * It is Effect's own `Layer.mock` with a record beside it: `impl` is a part of the service, typed
 * the way `Layer.mock` types it, and a member it leaves out dies with `UnimplementedError` when used.
 * The record keeps no answer, as Effect's `TestConsole` keeps none: the law wrote the
 * implementation, so it knows what it answers.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

/** A member the Recorder watches: an Effect, or a function that answers an Effect or a Stream. */
type Watched =
  | Effect.Effect<unknown, unknown, unknown>
  | ((...args: never) => Effect.Effect<unknown, unknown, unknown>)
  | ((...args: never) => Stream.Stream<unknown, unknown, unknown>);

/**
 * A method's name: a string key of the service whose member the Recorder watches. Plain data, a
 * `Sink` and a symbol key are not methods.
 *
 * @stability unstable
 * @category models
 */
export type Method<S> = { [K in keyof S]-?: S[K] extends Watched ? K : never }[keyof S] & string;

/**
 * What one call of a method was handed: its own parameter list, made readonly, and `[]` for an
 * Effect member.
 *
 * @stability unstable
 * @category models
 */
export type Args<S, M extends Method<S>> = S[M] extends (...args: infer A) => unknown ? Readonly<A> : readonly [];

/**
 * The error a method fails with, read from its own type: `never` for a method that cannot fail.
 *
 * @stability unstable
 * @category models
 */
export type Failure<S, M extends Method<S>> =
  S[M] extends Effect.Effect<unknown, infer E, unknown>
    ? E
    : S[M] extends (...args: never) => Effect.Effect<unknown, infer E, unknown>
      ? E
      : S[M] extends (...args: never) => Stream.Stream<unknown, infer E, unknown>
        ? E
        : never;

/**
 * One recorded call. It is a union over the methods, so a check on `method` narrows `args` to that
 * method's own list.
 *
 * @stability unstable
 * @category models
 */
export type Call<S> = { [M in Method<S>]: { readonly method: M; readonly args: Args<S, M> } }[Method<S>];

/**
 * The methods that fail, each with an error value of its own error type. A method that cannot fail
 * has `Failure` of `never`, so it cannot be named.
 *
 * @stability unstable
 * @category models
 */
export type Fails<S> = { readonly [M in Method<S>]?: Failure<S, M> };

declare const RecordedId: unique symbol;

/**
 * The record a Recorder layer adds beside its service, so `calls` can find it. Only its type is
 * read: it names, in an Effect's environment, the service whose calls are kept.
 *
 * @stability unstable
 * @category models
 */
export interface Recorded<in out I> {
  readonly [RecordedId]: I;
}

/** One call as the store keeps it, before `calls` reads it back in the service's own types. */
interface Entry {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

/** The store of one service's calls, found by that service's key. */
const store = <I, S>(service: Context.Key<I, S>) =>
  Context.Service<Recorded<I>, Ref.Ref<ReadonlyArray<Entry>>>(`@kampus/vitest/Recorder/${service.key}`);

/**
 * `impl`, with each effectful member wrapped so that its run is written to `kept` first. A member in
 * `fails` is written, then fails with its value, and its own Effect or Stream is never run. Whether a
 * method answers an Effect or a Stream is read from what `impl`'s function answers, so a method
 * `impl` leaves out is left out here too, and `Layer.mock` answers it with `UnimplementedError`.
 */
const watch = <S extends object>(
  impl: Layer.PartialEffectful<S> & object,
  kept: Ref.Ref<ReadonlyArray<Entry>>,
  fails: object,
): Layer.PartialEffectful<S> & object =>
  new Proxy(impl, {
    get: (target, prop) => {
      const member = Predicate.hasProperty(target, prop) ? target[prop] : undefined;

      if (typeof prop === "symbol") {
        return member;
      }

      const failure = Predicate.hasProperty(fails, prop) ? Option.some(fails[prop]) : Option.none();
      const write = (args: ReadonlyArray<unknown>) => Ref.update(kept, (list) => [...list, { method: prop, args }]);
      const effect = (out: Effect.Effect<unknown, unknown, unknown>, args: ReadonlyArray<unknown>) =>
        Effect.andThen(
          write(args),
          Option.match(failure, { onNone: () => out, onSome: (error) => Effect.fail(error) }),
        );

      if (Effect.isEffect(member)) {
        return effect(member, []);
      }

      if (!Predicate.isFunction(member)) {
        return member;
      }

      return (...args: Array<unknown>) => {
        const out: unknown = member.apply(target, args);

        if (Effect.isEffect(out)) {
          return effect(out, args);
        }

        return Stream.isStream(out)
          ? Stream.unwrap(Effect.as(write(args), Option.match(failure, { onNone: () => out, onSome: Stream.fail })))
          : out;
      };
    },
  });

/**
 * Provides `service` from `impl`, records each run of its effectful members as `{ method, args }`,
 * and fails each method named in `fails` with the value given there. A call is a run: an Effect
 * built and never run is not recorded, one run twice is recorded twice, and one that never ends is
 * recorded at its start. A Stream method is recorded when its stream starts. Each build of the layer
 * starts with no calls.
 *
 * @stability unstable
 * @category constructors
 */
export const layer = <I, S extends object>(
  service: Context.Key<I, S>,
  impl: Layer.PartialEffectful<S> & object,
  options?: { readonly fails?: Fails<S> },
): Layer.Layer<I | Recorded<I>> =>
  Layer.unwrap(
    Effect.map(Ref.make<ReadonlyArray<Entry>>([]), (kept) =>
      Layer.merge(Layer.mock(service, watch(impl, kept, options?.fails ?? {})), Layer.succeed(store(service), kept)),
    ),
  );

/**
 * The calls recorded so far, in the order they ran: all of them, or the argument lists of one
 * method. It needs the record a Recorder layer provides, so reading the calls of a service no
 * Recorder provides does not compile.
 *
 * @stability unstable
 * @category getters
 */
export function calls<I, S>(service: Context.Key<I, S>): Effect.Effect<ReadonlyArray<Call<S>>, never, Recorded<I>>;
export function calls<I, S, M extends Method<S>>(
  service: Context.Key<I, S>,
  method: M,
): Effect.Effect<ReadonlyArray<Args<S, M>>, never, Recorded<I>>;
// The store keeps each call as plain data, and the two forms above give it back in the service's
// own types. That holds because `watch` writes a member's own name and the args it was called with.
export function calls<I, S>(
  service: Context.Key<I, S>,
  method?: string,
): Effect.Effect<ReadonlyArray<Entry> | ReadonlyArray<ReadonlyArray<unknown>>, never, Recorded<I>> {
  return Effect.map(Effect.flatMap(store(service), Ref.get), (list) =>
    method === undefined ? list : list.flatMap((entry) => (entry.method === method ? [entry.args] : [])),
  );
}

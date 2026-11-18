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
 * Its types hold what it records: a method's args are its own parameter list, an optional member
 * counts as if it were there, and `fails` names only a method `impl` gives, since a left-out one
 * dies before it is recorded. A service with an overloaded method does not compile as a Recorder
 * layer: TypeScript's `infer` reads only an overload's last signature, so no one argument list is
 * true of every call, and the layer refuses it rather than type its records wrong.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

/** What a watched method answers: an Effect or a Stream. */
type Answer = Effect.Effect<unknown, unknown, unknown> | Stream.Stream<unknown, unknown, unknown>;

/** A member the Recorder watches: an Effect, or a function that answers an Effect or a Stream. */
type Watched =
  | Effect.Effect<unknown, unknown, unknown>
  | ((...args: never) => Effect.Effect<unknown, unknown, unknown>)
  | ((...args: never) => Stream.Stream<unknown, unknown, unknown>);

/**
 * A method's name: a string key of the service whose member the Recorder watches. Plain data, a
 * `Sink` and a symbol key are not methods. An optional member is read without its `undefined`, so
 * an optional method is a method too, as `watch` records it.
 *
 * @category models
 */
export type Method<S> = { [K in keyof S]-?: NonNullable<S[K]> extends Watched ? K : never }[keyof S] & string;

/**
 * What one call of a method was handed: its own parameter list, made readonly, and `[]` for an
 * Effect member. For a union of names, it is each name's own list.
 *
 * @category models
 */
export type Args<S, M extends Method<S>> = M extends unknown
  ? NonNullable<S[M]> extends (...args: infer A) => Answer
    ? Readonly<A>
    : readonly []
  : never;

/** The error a member fails with: `never` for one that cannot fail. */
type Raised<F> =
  F extends Effect.Effect<unknown, infer E, unknown>
    ? E
    : F extends (...args: never) => Effect.Effect<unknown, infer E, unknown>
      ? E
      : F extends (...args: never) => Stream.Stream<unknown, infer E, unknown>
        ? E
        : never;

/**
 * The error a method fails with, read from its own type: `never` for a method that cannot fail.
 *
 * @category models
 */
export type Failure<S, M extends Method<S>> = M extends unknown ? Raised<NonNullable<S[M]>> : never;

/**
 * One recorded call. It is a union over the methods, so a check on `method` narrows `args` to that
 * method's own list.
 *
 * @category models
 */
export type Call<S> = { [M in Method<S>]: { readonly method: M; readonly args: Args<S, M> } }[Method<S>];

/**
 * The methods that fail, each with an error value of its own error type. A method that cannot fail
 * has `Failure` of `never`, so it cannot be named, and nor can a method outside `Given`: the methods
 * `impl` gives, when `layer` reads it.
 *
 * @category models
 */
export type Fails<S, Given extends Method<S> = Method<S>> = {
  readonly [M in Method<S>]?: M extends Given ? Failure<S, M> : never;
};

/** A function's last two call signatures, which are the same one when it has only one. */
type LastTwo<F> = F extends { (...args: infer A1): infer R1; (...args: infer A2): infer R2 }
  ? readonly [readonly [A1, R1], readonly [A2, R2]]
  : never;

/** Whether two types are each assignable to the other. */
type Same<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

/** The methods of `S` with more than one call signature. */
type Overloaded<S> = {
  [M in Method<S>]: LastTwo<NonNullable<S[M]>> extends readonly [infer P, infer Q]
    ? Same<P, Q> extends true
      ? never
      : M
    : never;
}[Method<S>];

/**
 * Nothing for a service with no overloaded method. For one with one, a member no `impl` has, so the
 * layer does not compile and its error names the method.
 */
type Single<S> = [Overloaded<S>] extends [never]
  ? unknown
  : { readonly "an overloaded method, which the Recorder cannot type": Overloaded<S> };

/**
 * The keys `impl` gives, read from its keys alone. Its values are not read: an inline `impl` widens a
 * unique symbol member to `symbol`, so the type of the whole `impl` would not fit the service, and
 * TypeScript would then read every key as given.
 */
type Gives<K extends PropertyKey> = { readonly [M in K]?: unknown };

declare const RecordedId: unique symbol;

/**
 * The record a Recorder layer adds beside its service, so `calls` can find it. Only its type is
 * read: it names, in an Effect's environment, the service whose calls are kept.
 *
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

      if (Predicate.isSymbol(prop)) {
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
 * and fails each method named in `fails` with the value given there, which may name only a method
 * `impl` gives. A service with an overloaded method does not compile here. A call is a run: an Effect
 * built and never run is not recorded, one run twice is recorded twice, and one that never ends is
 * recorded at its start. A Stream method is recorded when its stream starts. Each build of the layer
 * starts with no calls.
 *
 * @category constructors
 */
export const layer = <I, S extends object, K extends keyof S = keyof S>(
  service: Context.Key<I, S>,
  impl: Layer.PartialEffectful<S> & object & Single<S> & Gives<K>,
  options?: { readonly fails?: Fails<S, Method<S> & K> },
): Layer.Layer<I | Recorded<I>> =>
  Layer.unwrap(
    Effect.map(Ref.make<ReadonlyArray<Entry>>([]), (kept) =>
      Layer.merge(Layer.mock(service, watch<S>(impl, kept, options?.fails ?? {})), Layer.succeed(store(service), kept)),
    ),
  );

/**
 * The calls recorded so far, in the order they ran: all of them, or the argument lists of one
 * method. It needs the record a Recorder layer provides, so reading the calls of a service no
 * Recorder provides does not compile.
 *
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

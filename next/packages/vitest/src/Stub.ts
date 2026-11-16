/**
 * The one stand-in for a platform object (decision 0554): a Durable Object stub, its storage, a
 * bucket. `Stub.make(rest, own)` answers a member of `own` as given, and any other method name
 * with `rest(name)`. `then` and every symbol key answer undefined, so awaiting a stub gives the
 * stub back and never hangs.
 *
 * @stability unstable
 */
import * as Function from "effect/Function";
import * as Predicate from "effect/Predicate";

/**
 * A stub of `A`. A name in `own` answers as `own` has it, `then` and symbol keys answer undefined,
 * and every other name answers `rest(name)`.
 *
 * @stability unstable
 * @category constructors
 */
export const make: {
  <A extends object>(own?: Partial<A>): (rest: (method: string) => A[keyof A]) => A;
  <A extends object>(rest: (method: string) => A[keyof A], own?: Partial<A>): A;
} = Function.dual(
  // A direct call starts with `rest`, a function; a piped one with `own`, an object or nothing.
  (args) => Predicate.isFunction(args[0]),
  <A extends object>(rest: (method: string) => A[keyof A], own: Partial<A> = {}): A => {
    const members: Readonly<Record<string, unknown>> = own;
    // SAFETY: the one cast. It holds for calls only: reads go through the `get` trap below, but key
    // listing, `in` and spread see this empty null-prototype object, so a stub stands in for calls and
    // nothing more.
    const target = Object.create(null) as A;
    return new Proxy<A>(target, {
      get: (_target, key) => {
        if (Predicate.isSymbol(key) || key === "then") {
          return undefined;
        }

        return Object.hasOwn(members, key) ? members[key] : rest(key);
      },
    });
  },
);

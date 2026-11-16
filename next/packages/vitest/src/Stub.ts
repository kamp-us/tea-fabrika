/**
 * The one stand-in for a platform object (decision 0554): a Durable Object stub, its storage, a
 * bucket. `Stub.make(rest, own)` answers a member of `own` as given, and any other method name
 * with `rest(name)`. `then` and every symbol key answer undefined, so awaiting a stub gives the
 * stub back and never hangs.
 *
 * @stability unstable
 */
import * as Predicate from "effect/Predicate";

/**
 * A stub of `A`. A name in `own` answers as `own` has it, `then` and symbol keys answer undefined,
 * and every other name answers `rest(name)`.
 *
 * @stability unstable
 * @category constructors
 */
export const make = <A extends object>(
  rest: (method: string) => (...args: ReadonlyArray<unknown>) => unknown,
  own: Partial<A> = {},
): A => {
  const members: object = own;
  return new Proxy<A>(Object.create(null), {
    get: (_target, key) => {
      if (typeof key === "symbol" || key === "then") {
        return undefined;
      }

      return Predicate.hasProperty(members, key) ? members[key] : rest(key);
    },
  });
};

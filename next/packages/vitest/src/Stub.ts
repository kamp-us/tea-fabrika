/**
 * The one stand-in for a platform object (decision 0554): a Durable Object stub, its storage, a
 * bucket. `Stub.make(rest, own)` answers a member of `own` as given, and any other method name
 * with `rest(name)`. `then` and every symbol key answer undefined, so awaiting a stub gives the
 * stub back and never hangs.
 *
 * @stability unstable
 */
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
  const members: Readonly<Record<string, unknown>> = own;
  // Sound: the Proxy answers every key through the trap below, and a test uses a stub only through
  // the members it names, so the empty target never shows through as an `A`.
  const target = Object.create(null) as A;
  return new Proxy<A>(target, {
    get: (_target, key) => {
      if (typeof key === "symbol" || key === "then") {
        return undefined;
      }

      return Object.hasOwn(members, key) ? members[key] : rest(key);
    },
  });
};

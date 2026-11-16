// A stand-in WebCrypto for the transport's laws, next/ (ticket 1067, slice 1): a platform object,
// not a call watcher. `crypto(method, failure)` is the real `globalThis.crypto` with one change:
// `subtle[method]` rejects with `failure`. A law hands it to Effect's own `WebCrypto.layer`, so the
// edge in `binary.ts` reads it in place of the global and nothing is spied on (0555).
//
// Each member is read from the real object and bound to it, since Node's WebCrypto refuses a call
// whose `this` is not its own object.
import * as Predicate from "effect/Predicate";

/**
 * The WebCrypto calls the transport's edge makes, the ones a law may make reject.
 *
 * @internal
 */
export type Method = "digest" | "importKey" | "verify";

/** A member of `target` by name, bound to `target` when it is a function. */
const bound = (target: object, prop: PropertyKey): unknown => {
  const member = Predicate.hasProperty(target, prop) ? target[prop] : undefined;
  return Predicate.isFunction(member) ? member.bind(target) : member;
};

/**
 * The real `globalThis.crypto`, except that `subtle[method]` answers a Promise that rejects with
 * that very `failure`. Every other member, `subtle`'s other methods included, is the real one.
 *
 * @internal
 */
export const crypto = (method: Method, failure: unknown): typeof globalThis.crypto => {
  const real = globalThis.crypto;
  // oxlint-disable-next-line fabrika/no-promises -- edge: a WebCrypto stand-in answers only with a Promise
  const reject = () => Promise.reject(failure);
  const subtle = new Proxy(real.subtle, {
    get: (target, prop) => (prop === method ? reject : bound(target, prop)),
  });
  return new Proxy(real, {
    get: (target, prop) => (prop === "subtle" ? subtle : bound(target, prop)),
  });
};

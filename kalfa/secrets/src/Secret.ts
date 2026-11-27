/**
 * A secret a name points to: declared once, in code, and fetched by yielding it.
 *
 * **Details**
 *
 * A declaration is plain data and an `Effect`. Yielding it asks the app's proof key for the proof its permission check made, then asks
 * the `Secrets` service for the value. The proof key is the one the app's Permissions makes, and Secrets reads only its `object`, which
 * must be the one `secret:<name>` names, so an allowance for another secret gets nothing.
 */
import { type Context, Effect, Effectable, type Redacted, Schema } from "effect";
import type * as Errors from "./Errors.ts";
import * as Name from "./Name.ts";
import * as Secrets from "./Secrets.ts";

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * A name as written in code: `N` itself when it is one text, and `never` when it is plain text, a union of names, a template with a hole
 * of plain text, or `any`, since a name that is not written cannot be compared with a route.
 *
 * @category models
 */
export type Literal<N extends string> = 0 extends 1 & N
  ? never
  : string extends N
    ? never
    : Record<never, never> extends Record<N, 1>
      ? never
      : IsUnion<N> extends true
        ? never
        : N;

/**
 * A declared secret. Yielding it fetches the value, hidden, and needs the proof key `I` and the `Secrets` service.
 *
 * @category models
 */
export interface Secret<N extends string, A, I> extends Effect.Effect<
  Redacted.Redacted<A>,
  Errors.SecretMissing | Errors.SecretsUnavailable,
  I | Secrets.Secrets
> {
  readonly name: N;
  readonly object: `secret:${N}`;
}

/**
 * Any declared secret, whatever its name and proof key.
 *
 * @category models
 */
export type Any = Secret<string, any, any>;

/**
 * Declares a secret. `fetch` is the proof key of the app's permission to fetch it.
 *
 * **Gotchas**
 *
 * Throws an `Error` for a name `SecretName` refuses, naming the name, when the module that declares it loads. A name is written in
 * code: a name typed as plain text, as a union or with a hole does not compile.
 *
 * @category constructors
 */
export const make = <const N extends string, I>(
  name: N & Literal<N>,
  options: { readonly fetch: Context.Key<I, Name.Proof> },
): Secret<N, string, I> => {
  if (!Schema.is(Name.SecretName)(name)) {
    throw new Error(
      `${name} is not a secret name: lowercase segments of letters and digits with single hyphens, joined by "/", a part of at most 64 characters, the whole name of at most 256`,
    );
  }

  const declaration = Effectable.Prototype<Secret<N, string, I>>({
    label: "Secret",
    evaluate: () =>
      Effect.gen(function* () {
        const proof = yield* options.fetch;
        const secrets = yield* Secrets.Secrets;

        return yield* secrets.fetch(secret, proof);
      }),
  });

  const secret: Secret<N, string, I> = Object.assign(Object.create(declaration), { name, object: Name.object(name) });

  return secret;
};

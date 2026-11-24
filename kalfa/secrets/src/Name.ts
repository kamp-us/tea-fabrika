/**
 * The names of the package: a secret's name, a store's id and a version, and the object a proof of a secret names.
 *
 * **Details**
 *
 * Each name is a branded text a Schema checks, so a name written in a route or a declaration is refused before anything reads a store. A
 * refusal's message holds no part of the text it refused.
 */
import { Schema } from "effect";

// A part of a name, between two slashes: at most 64 characters, which the look-ahead counts before the part is read.
const SEGMENT = "(?=[a-z0-9-]{1,64}(?:/|$))[a-z0-9]+(?:-[a-z0-9]+)*";

/**
 * A secret's name, such as `transport/turn-key`: segments of lowercase letters and digits with single hyphens, joined by `/`, a part at most
 * 64 characters and the whole name at most 256.
 *
 * @category models
 */
export const SecretName = Schema.String.check(
  Schema.isPattern(new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`, "u")),
  Schema.isMaxLength(256),
).pipe(Schema.brand("@kalfa/secrets/SecretName"));

/**
 * A store's id in a route, such as `memory` or `env`: one lowercase word, hyphens allowed.
 *
 * @category models
 */
export const StoreId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u)).pipe(
  Schema.brand("@kalfa/secrets/StoreId"),
);

/**
 * A store's own label for one value, or one signing key, that a name has held: not empty, at most 128 characters.
 *
 * @category models
 */
export const Version = Schema.NonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("@kalfa/secrets/Version"),
);

/**
 * What Secrets reads from a proof: the object its permission check was for. Any value with this text counts, so a proof is whatever the
 * app's Permissions makes.
 *
 * @category models
 */
export interface Proof {
  readonly object: string;
}

/**
 * The object a permission check names for the secret `name`: `secret:` and the name.
 *
 * @category models
 */
export const object = <N extends string>(name: N): `secret:${N}` => `secret:${name}`;

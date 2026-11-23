/**
 * The three names of the package: a secret's name, a store's id and a version.
 *
 * **Details**
 *
 * Each is a branded text a Schema checks, so a name written in a route or a declaration is refused before anything reads a store. A
 * refusal's message holds no part of the text it refused.
 */
import { Schema } from "effect";

const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";

/**
 * A secret's name, such as `transport/turn-key`: segments of lowercase letters and digits with single hyphens, joined by `/`, at most
 * 256 characters.
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

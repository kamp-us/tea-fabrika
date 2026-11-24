/**
 * The failures of a secret's use and of an app's start. A store that cannot answer and a recorder that cannot write come first, as the
 * store's side has them. A caller then meets a secret that is missing, a secret that is unavailable, and a route that stops the start.
 *
 * **Details**
 *
 * A cause may quote a value, as a store's own client does when it reports what it read. So each failure holds its cause as a
 * `Redacted`, which no rendering shows: a caller makes it with `Redacted.make(cause)`, and code that needs the cause reads it on
 * purpose, with `Redacted.value(error.cause)`. A cause that is not hidden does not compile.
 */
import { Schema } from "effect";
import * as Name from "./Name.ts";

/**
 * A secret store could not answer, such as a store whose backend was unreachable. It says nothing of any value, and its cause is
 * hidden.
 *
 * @category errors
 */
export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
  cause: Schema.Redacted(Schema.Defect()),
}) {}

/**
 * A recorder could not write a fact. It says nothing of any value, and its cause is hidden.
 *
 * @category errors
 */
export class RecordFailed extends Schema.TaggedError<RecordFailed, { readonly brand: unique symbol }>()(
  "RecordFailed",
  { cause: Schema.Redacted(Schema.Defect()) },
) {}

/**
 * A secret's store answered, and there is nothing to give: nothing is held at the item, or what is held is the other kind. It names the
 * secret, the store and the item, which are public, and says why. It holds no value.
 *
 * @category errors
 */
export class SecretMissing extends Schema.TaggedError<SecretMissing, { readonly brand: unique symbol }>()(
  "SecretMissing",
  {
    secret: Name.SecretName,
    store: Name.StoreId,
    item: Schema.String,
    reason: Schema.Literals(["absent", "kind", "algorithm"]),
  },
) {}

/**
 * A secret could not be used now: its store could not answer, or the use could not be recorded. The reason is that failure, whose
 * cause is hidden, and no value is given.
 *
 * @category errors
 */
export class SecretsUnavailable extends Schema.TaggedError<SecretsUnavailable, { readonly brand: unique symbol }>()(
  "SecretsUnavailable",
  {
    secret: Name.SecretName,
    store: Name.StoreId,
    reason: Schema.Union([StoreFailed, RecordFailed]),
  },
) {}

/**
 * The app declares a secret that no route points anywhere. It stops the start, naming the secret.
 *
 * @category errors
 */
export class RouteMissing extends Schema.TaggedError<RouteMissing, { readonly brand: unique symbol }>()(
  "RouteMissing",
  { secret: Name.SecretName },
) {}

/**
 * A route that cannot work, found when the app starts. The reason says what is wrong: `store` for a store no one listed, `item` for an
 * item the store does not read, and `port` for a store that cannot do what the secret needs, which the `port` names.
 *
 * @category errors
 */
export class RouteRefused extends Schema.TaggedError<RouteRefused, { readonly brand: unique symbol }>()(
  "RouteRefused",
  {
    secret: Name.SecretName,
    store: Name.StoreId,
    reason: Schema.Literals(["store", "item", "port"]),
    port: Schema.optional(Schema.Literals(["holds"])),
  },
) {}

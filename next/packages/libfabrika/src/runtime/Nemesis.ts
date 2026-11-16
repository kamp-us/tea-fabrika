/**
 * The trusted fault and history-check contract. Layers live in sibling files.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Fire, Fired, Report, Target } from "./Chaos.ts";

/**
 * Chaos is disabled.
 *
 * @stability unstable
 * @category errors
 */
export class Off extends Schema.TaggedError<Off, { readonly brand: unique symbol }>()("Off", {
  cause: Schema.Defect(),
}) {}

/**
 * The requested target cannot be used.
 *
 * @stability unstable
 * @category errors
 */
export class BadTarget extends Schema.TaggedError<BadTarget, { readonly brand: unique symbol }>()("BadTarget", {
  cause: Schema.Defect(),
}) {}

/**
 * The caller lacks the required grant.
 *
 * @stability unstable
 * @category errors
 */
export class NotGranted extends Schema.TaggedError<NotGranted, { readonly brand: unique symbol }>()("NotGranted", {
  cause: Schema.Defect(),
}) {}

/**
 * The operation did not reach its destination.
 *
 * @stability unstable
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable, { readonly brand: unique symbol }>()("Unreachable", {
  cause: Schema.Defect(),
}) {}

/**
 * History contained an undecodable known row or invalid position.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow, { readonly brand: unique symbol }>()("BadRow", {
  cause: Schema.Defect(),
}) {}

/**
 * Storage failed while reading the check's snapshot.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage, { readonly brand: unique symbol }>()("Storage", {
  cause: Schema.Defect(),
}) {}

/**
 * The service's own error, retaining the original cause in its reason.
 *
 * @stability unstable
 * @category errors
 */
export class NemesisError extends Schema.TaggedError<NemesisError, { readonly brand: unique symbol }>()(
  "NemesisError",
  {
    reason: Schema.Union([Off, BadTarget, NotGranted, Unreachable, BadRow, Storage]),
  },
) {}

/**
 * Performs trusted faults and checks bounded history.
 *
 * @stability unstable
 * @category services
 */
export class Nemesis extends Context.Service<
  Nemesis,
  {
    readonly fire: (request: Fire) => Effect.Effect<Fired, NemesisError>;
    readonly check: (target: Target) => Effect.Effect<Report, NemesisError>;
  }
>()("@kampus/libfabrika/runtime/Nemesis") {}

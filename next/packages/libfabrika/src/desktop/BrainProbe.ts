/**
 * Instance readiness and owned-resource checks.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a readiness answer about the expected instance: still waiting, or ready.
 *
 * @category schemas
 */
export const Readiness = Schema.TaggedUnion({ waiting: {}, ready: {} });
/**
 * Schema for an owned-resource answer: still waiting, or every owned group and the listener gone.
 *
 * @category schemas
 */
export const Children = Schema.TaggedUnion({ waiting: {}, gone: {} });

/**
 * Readiness could not be checked.
 *
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable, { readonly brand: unique symbol }>()("Unreachable", {
  cause: Schema.Defect(),
}) {}

/**
 * Another instance owns the fixed address.
 *
 * @category errors
 */
export class Foreign extends Schema.TaggedError<Foreign, { readonly brand: unique symbol }>()("Foreign", {
  cause: Schema.Defect(),
}) {}

/**
 * Owned resources could not be checked.
 *
 * @category errors
 */
export class Cleanup extends Schema.TaggedError<Cleanup, { readonly brand: unique symbol }>()("Cleanup", {
  cause: Schema.Defect(),
}) {}

/**
 * Probe failure with its protected cause.
 *
 * @category errors
 */
export class BrainProbeError extends Schema.TaggedError<BrainProbeError, { readonly brand: unique symbol }>()(
  "BrainProbeError",
  {
    reason: Schema.Union([Unreachable, Foreign, Cleanup]),
  },
) {}

/**
 * Probes supplied by the client that owns the instance.
 *
 * @category services
 */
export class BrainProbe extends Context.Service<
  BrainProbe,
  {
    readonly ready: Effect.Effect<typeof Readiness.Type, BrainProbeError>;
    readonly cleanup: Effect.Effect<typeof Children.Type, BrainProbeError>;
  }
>()("@kampus/libfabrika/desktop/BrainProbe") {}

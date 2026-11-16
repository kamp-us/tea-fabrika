/**
 * Delivery of a view to one client: the contract, and the two ways a delivery can fail.
 */
import { Context, type Effect, Schema } from "effect";
import type { Update } from "./Entry.ts";

/**
 * Schema for a delivery's result: `sent` or `gone`. A normal notify return is sent, not a browser
 * acknowledgement.
 *
 * @category schemas
 */
export const Publication = Schema.TaggedUnion({ sent: {}, gone: {} });

/**
 * Error for a client that is confirmed absent: the project has no route to it. It ends that
 * client's watch.
 *
 * @category errors
 */
export class Gone extends Schema.TaggedError<Gone, { readonly brand: unique symbol }>()("Gone", {
  cause: Schema.Defect(),
}) {}

/**
 * Error for a delivery whose outcome is unknown: the call failed, or its reply did not decode. The
 * client's watch is kept.
 *
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable, { readonly brand: unique symbol }>()("Unreachable", {
  cause: Schema.Defect(),
}) {}

/**
 * Error for a view update that did not reach its client. Its `reason` says whether the client is
 * `Gone` or only `Unreachable`, and keeps the original cause.
 *
 * @category errors
 */
export class WatcherManagerError extends Schema.TaggedError<WatcherManagerError, { readonly brand: unique symbol }>()(
  "WatcherManagerError",
  {
    reason: Schema.Union([Gone, Unreachable]),
  },
) {}

/**
 * Service that delivers a view update to one client. A failed delivery is a `WatcherManagerError`:
 * its reason is `Gone` when the client is confirmed absent, which ends the watch, or `Unreachable`,
 * which keeps it.
 *
 * @category services
 */
export class WatcherManager extends Context.Service<
  WatcherManager,
  {
    readonly publish: (client: string, update: Update) => Effect.Effect<void, WatcherManagerError>;
  }
>()("@kampus/libfabrika/runtime/WatcherManager") {}

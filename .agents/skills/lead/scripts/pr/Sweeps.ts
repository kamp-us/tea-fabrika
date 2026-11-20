// Sweeps: the box cleanup's sweep, as the landing path starts one after a merge (box cleanup runs on a timer and after a merge, never on a step's start path). This file
// is the contract only (a service file holds only its contract, and each layer is its own file): `SweepsProcess.layer` runs `gcloop.ts kick`, `SweepsTest.layer`
// counts. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** No sweep was started. The timer's next sweep still runs. */
export class SweepsError extends Schema.TaggedError<SweepsError, { readonly brand: unique symbol }>()("SweepsError", {
  reason: Schema.String,
}) {}

export class Sweeps extends Context.Service<
  Sweeps,
  {
    /** Starts one sweep in the background, marked as started by a merge, and returns at once. */
    readonly kick: Effect.Effect<void, SweepsError>;
  }
>()("lead/pr/Sweeps") {}

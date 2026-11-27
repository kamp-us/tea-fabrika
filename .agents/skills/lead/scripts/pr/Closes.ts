// Closes: the record of each ticket this tooling closed after a merge, one line each, so the timer's
// ticket pass never closes one twice. The tracker can be written to but not read (Tickets.ts), so this
// record is the only memory of a close: a ticket a person reopened on purpose stays open. This file is
// the contract only (a service file holds only its contract, and each layer is its own file):
// `ClosesFs.layer` keeps the lines in BOXES/state/closes.jsonl, `ClosesTest.layer` keeps them in memory.
// Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** The record could not be read or written. The reason never holds a local path. */
export class ClosesError extends Schema.TaggedError<ClosesError, { readonly brand: unique symbol }>()("ClosesError", {
  reason: Schema.String,
}) {}

/** One ticket this tooling closed: the merged pull request that named it, the commit it merged at, and when. */
export const Close = Schema.Struct({
  at: Schema.String,
  pr: Schema.Finite,
  ticket: Schema.Finite,
  commit: Schema.String,
});

export type Close = typeof Close.Type;

export class Closes extends Context.Service<
  Closes,
  {
    /** Every ticket closed so far, oldest first. */
    readonly all: Effect.Effect<ReadonlyArray<Close>, ClosesError>;
    /** Records a ticket this tooling has just closed. */
    readonly record: (close: Close) => Effect.Effect<void, ClosesError>;
  }
>()("lead/pr/Closes") {}

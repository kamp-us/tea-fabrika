// Checks: what a quest asks GitHub about one CI job at one head. This file is the contract only
// (a service file holds only its contract, and each layer is its own file): `ChecksGh.layer` asks GitHub through `gh api`, `ChecksTest.layer` answers from a list in
// memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

/** GitHub could not be asked, or its answer did not parse. A poll tries again; the reason is kept. */
export class ChecksError extends Schema.TaggedError<ChecksError, { readonly brand: unique symbol }>()("ChecksError", {
  reason: Schema.String,
}) {}

/**
 * One job's check run, as GitHub reports it: its id (an Actions job's check run id is its job id),
 * `queued`, `in_progress` or `completed`, and once completed its conclusion (`success`, `failure`,
 * `cancelled`, `skipped`, `timed_out` and the rest).
 */
export const Job = Schema.Struct({
  id: Schema.Finite,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
});

export type Job = typeof Job.Type;

export class Checks extends Context.Service<
  Checks,
  {
    /** The latest Actions check run named `name` at `head`; none before GitHub has made it. */
    readonly job: (head: string, name: string) => Effect.Effect<Option.Option<Job>, ChecksError>;
    /**
     * Whether GitHub Actions has made any check run at `head`, of any name and any status: the push's
     * own run has registered, so the head is past the seconds right after a push, when a ready event
     * starts a second run beside it (and leaves the required check "expected").
     */
    readonly started: (head: string) => Effect.Effect<boolean, ChecksError>;
    /** The whole log of the job with this id, as GitHub serves it. */
    readonly log: (id: number) => Effect.Effect<string, ChecksError>;
  }
>()("lead/ci/Checks") {}

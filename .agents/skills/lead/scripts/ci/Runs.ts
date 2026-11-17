// Runs: what the lead tooling asks GitHub about one workflow's runs on one branch, and the jobs and
// steps of one run. It reads; it never writes. This file is the contract only (0095): `RunsGh.layer`
// asks GitHub through `gh api`, `RunsTest.layer` answers from lists in memory. Today's lead
// tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** GitHub could not be asked, refused, or answered in a shape we do not read. */
export class RunsError extends Schema.TaggedError<RunsError, { readonly brand: unique symbol }>()("RunsError", {
  reason: Schema.String,
}) {}

/**
 * One workflow run as GitHub lists it: its id, the commit it ran on, `queued`, `in_progress`,
 * `waiting` or `completed`, and once completed its conclusion.
 */
export const Run = Schema.Struct({
  id: Schema.Finite,
  head: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
});

export type Run = typeof Run.Type;

/** One step of a job, as the run's jobs list gives it. */
export const Step = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
});

export type Step = typeof Step.Type;

/** One job of a run, latest attempt: its id (its log's id too), its name and its steps. */
export const Job = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  steps: Schema.Array(Step),
});

export type Job = typeof Job.Type;

export class Runs extends Context.Service<
  Runs,
  {
    /** The runs of workflow file `workflow` on `branch`, newest first; the newest few only. */
    readonly on: (workflow: string, branch: string) => Effect.Effect<ReadonlyArray<Run>, RunsError>;
    /** The jobs of run `id`, of its latest attempt. */
    readonly jobs: (id: number) => Effect.Effect<ReadonlyArray<Job>, RunsError>;
    /** Before suggesting a new proof: the branch still holds `head`, whose workflow shares the ten job groups. */
    readonly preflight: (branch: string, head: string) => Effect.Effect<void, RunsError>;
  }
>()("lead/ci/Runs") {}

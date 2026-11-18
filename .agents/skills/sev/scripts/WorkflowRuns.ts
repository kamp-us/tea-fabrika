// WorkflowRuns: what a sev0 asks GitHub Actions about its workflow runs, and the one write it makes,
// a cancel. It holds no rerun on purpose: a run the freeze canceled and a red run that stopped
// itself both end `cancelled`, and a rerun tests old code, so leaving a sev0 asks for none.
//
// This file is the contract only (0095): `WorkflowRunsGh.layer` asks GitHub through `gh`,
// `WorkflowRunsTest.layer` answers from a list in memory. Today's lead tooling, run on our own
// laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/**
 * GitHub could not be asked, refused, or answered in a shape we do not read. `status` is the HTTP
 * status GitHub answered with; `null` when no answer came back, as when gh could not start or the
 * network failed.
 */
export class WorkflowRunsError extends Schema.TaggedError<WorkflowRunsError, { readonly brand: unique symbol }>()(
  "WorkflowRunsError",
  {
    reason: Schema.String,
    status: Schema.NullOr(Schema.Int),
  },
) {}

/**
 * GitHub refused the call for its rate limit, which every agent on the login shares. It takes calls
 * again at `until`; one asked before then only spends more of the next hour's.
 */
export class RateLimited extends Schema.TaggedError<RateLimited, { readonly brand: unique symbol }>()("RateLimited", {
  until: Schema.DateTimeUtc,
  reason: Schema.String,
}) {}

/** One workflow run, as GitHub lists it. */
export const Run = Schema.Struct({
  /** GitHub's run id, the one `gh run cancel` takes. */
  id: Schema.Int,
  /** The workflow's name, such as `check`. */
  workflow: Schema.String,
  /** What started it: `pull_request`, `merge_group`, `push`, `workflow_dispatch` and the rest. */
  event: Schema.String,
  /** The branch it ran on; a queue run's is GitHub's own `gh-readonly-queue/...` branch. */
  branch: Schema.String,
  /** The commit it ran on. */
  sha: Schema.String,
  /** `queued`, `in_progress`, `waiting`, `requested`, `pending` or `completed`. */
  status: Schema.String,
  /** Once completed: `success`, `failure`, `cancelled` and the rest; `null` before. */
  conclusion: Schema.NullOr(Schema.String),
  /** When GitHub made it, as GitHub wrote it (ISO 8601). */
  created: Schema.String,
});

export type Run = typeof Run.Type;

export class WorkflowRuns extends Context.Service<
  WorkflowRuns,
  {
    /** Every run of the repo that has not completed yet. */
    readonly unfinished: Effect.Effect<ReadonlyArray<Run>, WorkflowRunsError | RateLimited>;
    /** Asks GitHub to cancel run `id`. */
    readonly cancel: (id: number) => Effect.Effect<void, WorkflowRunsError | RateLimited>;
  }
>()("sev/WorkflowRuns") {}

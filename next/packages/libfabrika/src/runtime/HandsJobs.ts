/**
 * Hands jobs: how the runner hands a program's `hands` Cmd to the Project and reads its answer.
 * One idempotent `ask` saves the job request the first time, and collects the job's result once it
 * is finished, so a lost reply is only ever "ask again". This file holds the contract only (0095);
 * `HandsJobsLive.layer` runs it over `Jobs`.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import { Request, Result } from "../jobs/Job.ts";
import type { From } from "../processes/Mailbox.ts";
import { Rev } from "../Rev.ts";

/**
 * Schema for one dispatched hands Cmd, as the runner gives it: the job request's own facts. `id` is
 * the Cmd's id, `<process>/<pos>/<index>`, and the job's too; `name` is the registered name a
 * finish wakes. The Project adds the command's needs, the target and the settings hash.
 *
 * @stability unstable
 * @category schemas
 */
export const Ask = Request.mapFields(({ needs: _needs, target: _target, settings: _settings, ...fields }) => fields);

/**
 * Schema for why an ask is refused, each for good: `no_hands`, the person set no `hands.target`, so
 * no job was made; `conflict`, the job saved under the Cmd's id is not this process's.
 *
 * @stability unstable
 * @category schemas
 */
export const Refusal = Schema.Literals(["no_hands", "conflict"]);

/**
 * Schema for what an ask answers: `waiting` with the request's receipt while the job has no
 * result, `finished` with the result and the receipt of its collect by this process, or `refused`
 * with a refusal no retry can change, which the program reads as its answer.
 *
 * @stability unstable
 * @category schemas
 */
export const Reply = Schema.TaggedUnion({
  waiting: { rev: Rev, arrivedAt: Schema.Int },
  finished: { result: Result, rev: Rev, arrivedAt: Schema.Int },
  refused: { reason: Refusal },
});

/**
 * Error for an ask that answered nothing. Each reason may pass, so the Cmd stays dispatched, to ask
 * again.
 *
 * @stability unstable
 * @category errors
 */
export class HandsJobsError extends Schema.TaggedError<HandsJobsError>()("HandsJobsError", {
  /** `storage`: a job read or write failed. `unavailable`: the call did not come back. */
  reason: Schema.Literals(["storage", "unavailable"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that keeps one hands Cmd's job: `ask` saves its request, or reads it back, and collects
 * its result once the hands finished it.
 *
 * **Details**
 *
 * `ask` reads the saved job first and requests it only when there is none, so a retry never sends
 * other bytes under the same id, whatever the person changed since. The writer's facts are `from`.
 *
 * @stability unstable
 * @category services
 */
export class HandsJobs extends Context.Service<
  HandsJobs,
  { readonly ask: (ask: typeof Ask.Type, from: From) => Effect.Effect<typeof Reply.Type, HandsJobsError> }
>()("@kampus/libfabrika/runtime/HandsJobs") {}

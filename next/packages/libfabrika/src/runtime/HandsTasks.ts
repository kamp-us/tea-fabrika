/**
 * Hands tasks: how the runner hands a program's `hands` Cmd to the Project and reads its answer.
 * One idempotent `ask` saves the task request the first time, and collects the task's result once it
 * is finished, so a lost reply is only ever "ask again". This file holds the contract only (0095);
 * `HandsTasksLive.layer` runs it over `Tasks`.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { From } from "../processes/Mailbox.ts";
import { Rev } from "../Rev.ts";
import { Request, Result } from "../tasks/Task.ts";

/**
 * Schema for one dispatched hands Cmd, as the runner gives it: the task request's own facts. `id` is
 * the Cmd's id, `<process>/<pos>/<index>`, and the task's too; `name` is the registered name a
 * finish wakes. The Project adds the command's needs, the target and the settings hash.
 *
 * @stability unstable
 * @category schemas
 */
export const Ask = Request.mapFields(({ needs: _needs, target: _target, settings: _settings, ...fields }) => fields);

/**
 * Schema for why an ask is refused, each for good: `no_hands`, the person set no `hands.target`, so
 * no task was made; `id_reused`, the task saved under the Cmd's id is not this process's.
 *
 * @stability unstable
 * @category schemas
 */
export const Refusal = Schema.Literals(["no_hands", "id_reused"]);

/**
 * Schema for what an ask answers: `waiting` with the request's receipt while the task has no
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
export class HandsTasksError extends Schema.TaggedError<HandsTasksError>()("HandsTasksError", {
  /** `storage`: a task read or write failed. `unavailable`: the call did not come back. */
  reason: Schema.Literals(["storage", "unavailable"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that keeps one hands Cmd's task: `ask` saves its request, or reads it back, and collects
 * its result once the hands finished it.
 *
 * **Details**
 *
 * `ask` reads the saved task first and requests it only when there is none, so a retry never sends
 * other bytes under the same id, whatever the person changed since. The writer's facts are `from`.
 *
 * @stability unstable
 * @category services
 */
export class HandsTasks extends Context.Service<
  HandsTasks,
  { readonly ask: (ask: typeof Ask.Type, from: From) => Effect.Effect<typeof Reply.Type, HandsTasksError> }
>()("@kampus/libfabrika/runtime/HandsTasks") {}

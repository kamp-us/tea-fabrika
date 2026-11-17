/**
 * The durable task service: record, take, start, finish and read one task. This file is the contract
 * only (0095); `TasksLedger.layer` keeps each task as its own ledger stream.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import type { ProcessId } from "../ProcessId.ts";
import type { Rev } from "../Rev.ts";
import type { Collection, Executor, Task, Recorded, Request, Result } from "./Task.ts";

/**
 * A task call failed. The `reason` says why. `cause` keeps the decode or ledger error underneath,
 * when there is one.
 *
 * @category errors
 */
export class TasksError extends Schema.TaggedError<TasksError, { readonly brand: unique symbol }>()("TasksError", {
  /** `not_found`: no task has that id. `conflict`: other bytes than the saved ones under that id.
   *  `not_target`: a key the request did not select. `lacks_capability`: a need the take did not
   *  advertise. `wrong_execution`: not the saved execution identity. `wrong_state`: a call out of
   *  order. `wrong_process`: a collect by a process the request does not name. `bad_input`: a value
   *  that does not decode. `storage`: the transaction failed. */
  reason: Schema.Literals([
    "not_found",
    "conflict",
    "not_target",
    "lacks_capability",
    "wrong_execution",
    "wrong_state",
    "wrong_process",
    "bad_input",
    "storage",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Where the referee placed an accepted call, and when it arrived. A repeat answers the first.
 *
 * @category models
 */
export type Receipt = { readonly rev: Rev; readonly arrivedAt: number };

/**
 * A take's receipt, with the execution identity it allocated once.
 *
 * @category models
 */
export type Taken = Receipt & { readonly execution: string };

/**
 * The name of the stream that indexes the tasks one hands key is asked for: one line `{ id, process }`
 * per accepted request whose target is `key`, written in the request's own transaction.
 *
 * @category names
 */
export const targetStream = (key: string): string => `target:${key}`;

/**
 * Service that keeps tasks: `request` records one, `take` assigns it to an executor, `started` and
 * `finish` report its progress, and `read` answers its state and events.
 *
 * **Details**
 *
 * Each write takes the writer's `Recorded` facts and answers a `Receipt`. A repeat of an accepted
 * call answers the first receipt, and a call the task's state does not allow writes nothing and
 * fails with `TasksError`. `take` answers the execution identity, which `started` and `finish` must
 * then present. `read` fails with `not_found` for an unknown id.
 *
 * @category services
 */
export class Tasks extends Context.Service<
  Tasks,
  {
    readonly request: (request: Request, recorded: Recorded) => Effect.Effect<Receipt, TasksError>;
    readonly take: (id: string, executor: Executor, recorded: Recorded) => Effect.Effect<Taken, TasksError>;
    readonly started: (id: string, execution: string, recorded: Recorded) => Effect.Effect<Receipt, TasksError>;
    readonly finish: (
      id: string,
      execution: string,
      result: Result,
      recorded: Recorded,
    ) => Effect.Effect<Receipt, TasksError>;
    readonly read: (id: string) => Effect.Effect<Task, TasksError>;
    /** The requesting process took a finished task's result, in the answer letter the collection names. */
    readonly collected: (
      id: string,
      collection: typeof Collection.Type,
      recorded: Recorded,
    ) => Effect.Effect<Receipt, TasksError>;
    /** Tasks whose saved requests name this exact process generation. */
    readonly forProcess: (process: typeof ProcessId.Type) => Stream.Stream<Task, TasksError>;
    /** The open tasks (requested, assigned or started) whose target is `key`, read through its
     *  `targetStream`, and that stream's last rev, 0 before its first line. */
    readonly forTarget: (key: string) => Effect.Effect<{ tasks: ReadonlyArray<Task>; rev: Rev }, TasksError>;
  }
>()("@kampus/libfabrika/tasks/Tasks") {}

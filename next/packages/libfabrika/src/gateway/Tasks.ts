/**
 * Task methods over an authenticated connection, called inside the shared write turn.
 *
 * @stability unstable
 */
import { Effect, Result, Schema, Stream } from "effect";
import { ProcessId } from "../ProcessId.ts";
import { Rev } from "../Rev.ts";
import { Task, Result as TaskResult, type Recorded } from "../tasks/Task.ts";
import { type Tasks, targetStream } from "../tasks/Tasks.ts";
import { Answer, type Attached } from "../transport/Wire.ts";
import * as TaskAccess from "./TaskAccess.ts";

const Meta = { sentAt: Schema.String, seen: Rev };

const Take = Schema.Struct({ process: ProcessId, ...Meta });

const Read = Schema.Struct({ process: ProcessId, task: Schema.NonEmptyString });

const Started = Schema.Struct({ ...Read.fields, execution: Schema.NonEmptyString, ...Meta });

const Finish = Schema.Struct({ ...Started.fields, result: TaskResult });

/** `tasks.list` takes nothing: the stream it reads comes from the caller's own key. An empty
 *  `Struct` lets any field through even when strict, so no field at all is a record of nothing. */
const List = Schema.Record(Schema.String, Schema.Never);

/** `tasks.wait` takes only the rev it waits past, never a stream or a key. */
const Wait = Schema.Struct({ after: Rev });

const TakeReply = Schema.TaggedUnion({
  idle: {},
  assigned: { task: Task },
  refused: { reason: Schema.String },
});

const strict = { onExcessProperty: "error" } as const;

/** What one task call answers, and the registered name to wake once the write turn is free: the
 *  requester's, after a finish was accepted or repeated, so its program collects the result. */
type Routed = { readonly answer: typeof Answer.Type; readonly wake: string | null };

const no = (reason: string): Routed => ({ answer: Answer.cases.refused.make({ reason }), wake: null });

/** The refusal a call from someone other than a hands client that said hello gets, or null. */
const refusal = (attached: typeof Attached.cases.online.Type): string | null =>
  attached.identity.as !== "hands"
    ? "not_allowed"
    : attached.has === undefined || attached.build === undefined
      ? "no_hello"
      : null;

/**
 * What one `tasks.wait` parks on: the caller's own `target:` stream past `after`, or the reason it is
 * refused. The stream comes from the authenticated key, never from the params, which hold `after`
 * and nothing else. The gateway parks it outside the write turn, on the path `ledger.wait` takes.
 *
 * @stability unstable
 * @category routing
 */
export const waitOn = (
  attached: typeof Attached.cases.online.Type,
  input: unknown,
): Result.Result<{ readonly stream: string; readonly after: Rev }, string> => {
  const refused = refusal(attached);

  if (refused !== null) {
    return Result.fail(refused);
  }

  const decoded = Schema.decodeUnknownResult(Wait, strict)(input);

  return Result.isFailure(decoded)
    ? Result.fail("bad_input")
    : Result.succeed({ stream: targetStream(attached.identity.key), after: decoded.success.after });
};

const ok = (result: Schema.Json, wake: string | null = null): Routed => ({
  answer: Answer.cases.ok.make({ result }),
  wake,
});

/**
 * Routes one task call after fresh authentication inside the Project's shared write turn. A taken
 * finish names its requester to wake; the caller wakes it after the turn and before it answers.
 *
 * @stability unstable
 * @category routing
 */
export const route = Effect.fn("gateway.tasks")(
  function* (tasks: Tasks["Service"], attached: typeof Attached.cases.online.Type, method: string, input: unknown) {
    const { identity, has, build, client } = attached;
    const refused = refusal(attached);

    if (refused !== null || has === undefined || build === undefined) {
      return no(refused ?? "no_hello");
    }

    if (method === "tasks.list") {
      if (Result.isFailure(Schema.decodeUnknownResult(List)(input))) {
        return no("bad_input");
      }

      // Pointers only: the command stays behind `tasks.take`, the one door work reaches a machine by.
      const listed = yield* tasks.forTarget(identity.key);

      const pointers = listed.tasks.flatMap(({ state }) =>
        state._tag === "absent" ? [] : [{ id: state.request.id, process: state.request.process }],
      );

      return ok({ tasks: pointers, rev: listed.rev });
    }

    const subject = { key: identity.key };

    const record = Effect.fnUntraced(function* (task: Task, meta: typeof Take.Type): Effect.fn.Return<Recorded> {
      // `route` is a named `Effect.fn`, so a span is always here: its absence is a defect.
      const span = yield* Effect.currentSpan.pipe(Effect.orDie);

      return {
        by: identity.key,
        for: identity.person,
        sentAt: meta.sentAt,
        seen: meta.seen,
        parent: task.state._tag === "absent" ? null : task.state.request.parent,
        traceId: span.traceId,
        build,
        connection: client,
        has,
      };
    });

    if (method === "tasks.take") {
      const decoded = Schema.decodeUnknownResult(Take, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      const params = decoded.success;
      const values = yield* Stream.runCollect(tasks.forProcess(params.process));
      const selected = TaskAccess.select(values, { ...subject, process: params.process });

      if (Result.isFailure(selected)) {
        return ok(TakeReply.cases.refused.make({ reason: selected.failure }));
      }

      const task = selected.success;

      if (task === null) {
        return ok(TakeReply.cases.idle.make({}));
      }

      if (!TaskAccess.owns(task, { ...subject, process: params.process }) || task.state._tag === "absent") {
        return no("not_allowed");
      }

      if (!task.state.request.needs.every((need) => has.includes(need))) {
        return no("lacks_capability");
      }

      yield* tasks.take(
        task.state.request.id,
        { key: identity.key, connection: client, has, build },
        yield* record(task, params),
      );

      return ok(TakeReply.cases.assigned.make({ task: yield* tasks.read(task.state.request.id) }));
    }

    if (method === "tasks.read") {
      const decoded = Schema.decodeUnknownResult(Read, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      const params = decoded.success;
      const task = yield* tasks.read(params.task);

      return TaskAccess.owns(task, { ...subject, process: params.process }) ? ok(task) : no("not_allowed");
    }

    if (method === "tasks.started" || method === "tasks.finish") {
      const decoded =
        method === "tasks.started"
          ? Schema.decodeUnknownResult(Started, strict)(input)
          : Schema.decodeUnknownResult(Finish, strict)(input);

      if (Result.isFailure(decoded)) {
        return no("bad_input");
      }

      // Only a finish carries a result: `Started` refuses one as an excess property.
      const params: typeof Started.Type & { readonly result?: TaskResult } = decoded.success;
      const task = yield* tasks.read(params.task);

      if (
        !TaskAccess.owns(task, { ...subject, process: params.process, execution: params.execution }) ||
        task.state._tag === "absent"
      ) {
        return no("not_allowed");
      }

      if (!task.state.request.needs.every((need) => has.includes(need))) {
        return no("lacks_capability");
      }

      const recorded = yield* record(task, params);

      if (params.result === undefined) {
        return ok(yield* tasks.started(params.task, params.execution, recorded));
      }

      return ok(yield* tasks.finish(params.task, params.execution, params.result, recorded), task.state.request.name);
    }

    return no("unknown_method");
  },
  Effect.catchTag("TasksError", (error) => Effect.succeed(no(error.reason))),
);

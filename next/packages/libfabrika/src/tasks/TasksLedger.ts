/**
 * Tasks on the ledger (0095): each task is its own stream, named from its command id. One call is one
 * transaction: read the stream, fold it through the task machine, step the call, and append it only
 * when the machine accepts it. A repeat answers the first event's receipt; a refusal writes nothing.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import { Effect, Layer, Result as R, Schema, Stream } from "effect";
import * as Id from "../Id.ts";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerStreams } from "../ledger/LedgerStreams.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { lineFor, valueFor } from "../ledger/Log.ts";
import { ProcessId } from "../ProcessId.ts";
import { task, Msg } from "./internal/task.ts";
import { Collection, Event, Executor, type Task, Recorded, Request, Result } from "./Task.ts";
import { Tasks, TasksError, targetStream } from "./Tasks.ts";

/** The execution identity a take allocates, once per task. */
const Execution = Id.make("execution");

/** An accepted call as its entry keeps it: the event's case, and the facts it brought. */
const Stored = Schema.TaggedUnion({
  requested: { request: Request, recorded: Schema.optionalKey(Recorded) },
  taken: { executor: Executor, execution: Schema.NonEmptyString, recorded: Schema.optionalKey(Recorded) },
  started: { execution: Schema.NonEmptyString, recorded: Schema.optionalKey(Recorded) },
  finished: { execution: Schema.NonEmptyString, result: Result, recorded: Schema.optionalKey(Recorded) },
  collected: { collection: Collection, recorded: Schema.optionalKey(Recorded) },
});
type Stored = typeof Stored.Type;

/** One line of a `target:` stream: the task a hands key was asked for, as a pointer. */
const Pointer = Schema.TaggedStruct("requested", { id: Schema.NonEmptyString, process: ProcessId });
const encodePointer = Schema.encodeSync(Pointer);
const decodePointer = Schema.decodeUnknownSync(Pointer);

const decodeStored = Schema.decodeUnknownSync(Stored);
const encodeStored = Schema.encodeSync(Stored);
const decodeEvent = Schema.decodeUnknownSync(Event);
const decodeCall = Schema.decodeUnknownResult(Schema.Struct({ msg: Msg, recorded: Recorded }));

/** A task's stream prefix. It keeps the word it was first written with, `job:`, since a saved
 *  ledger may hold streams under it (0545). */
const PREFIX = "job:";

const stream = (id: string) => `${PREFIX}${id}`;

const toMsg = (stored: Stored): Msg => {
  if (stored._tag === "requested") {
    return Msg.cases.request.make({ request: stored.request });
  }

  if (stored._tag === "taken") {
    return Msg.cases.take.make({ executor: stored.executor, execution: stored.execution });
  }

  if (stored._tag === "collected") {
    return Msg.cases.collect.make({ collection: stored.collection });
  }

  return stored._tag === "started"
    ? Msg.cases.start.make({ execution: stored.execution })
    : Msg.cases.finish.make({ execution: stored.execution, result: stored.result });
};

const toStored = (msg: Msg): Stored => {
  if (msg._tag === "request") {
    return Stored.cases.requested.make({ request: msg.request });
  }

  if (msg._tag === "take") {
    return Stored.cases.taken.make({ executor: msg.executor, execution: msg.execution });
  }

  if (msg._tag === "collect") {
    return Stored.cases.collected.make({ collection: msg.collection });
  }

  return msg._tag === "start"
    ? Stored.cases.started.make({ execution: msg.execution })
    : Stored.cases.finished.make({ execution: msg.execution, result: msg.result });
};

type Model = (typeof task)["model"]["Type"];

const step = (model: Model, msg: Msg): Model => applyCell(task, model, msg)[0];

const fold = (events: ReadonlyArray<Stored>): Model =>
  events.reduce((model, event) => step(model, toMsg(event)), task.init(null, undefined)[0]);

/** The tasks a target index names that are still open: requested, assigned or started. */
const OPEN: ReadonlySet<Task["state"]["_tag"]> = new Set(["requested", "assigned", "started"]);

/** A ledger failure as the tasks module's: a line the referee refused is the caller's input. */
const translated = (cause: LedgerError) =>
  new TasksError({ reason: cause.reason === "refused" ? "bad_input" : "storage", cause });

/** One task as its stream holds it, read inside a turn: its state and its events. */
const saved = (turn: LedgerTurn, id: string): Task => {
  const entries = [...turn.read(stream(id), 0)].map((entry) => ({ entry, stored: decodeStored(valueFor(entry)) }));
  const events = entries.map(({ entry, stored }) => decodeEvent({ ...entry, ...stored.recorded, event: entry._tag }));
  return { state: fold(entries.map(({ stored }) => stored)).state, events };
};

/**
 * Layer that supplies `Tasks` from the ledger. It needs `LedgerTransaction` and an `Id.Generator`.
 *
 * **Details**
 *
 * A ledger refusal of a line becomes a `bad_input` error and any other ledger failure becomes
 * `storage`, each keeping its cause.
 *
 * @stability unstable
 * @category layers
 */
export const layer = Layer.effect(
  Tasks,
  Effect.gen(function* () {
    const ledger = yield* LedgerTransaction;
    const ids = yield* Id.Generator;
    const streams = yield* LedgerStreams;

    const read = Effect.fn("tasks.read")(function* (id: string) {
      const found = yield* ledger.transact((turn) => saved(turn, id)).pipe(Effect.mapError(translated));

      if (found.state._tag === "absent") {
        return yield* new TasksError({ reason: "not_found" });
      }

      return found satisfies Task;
    });

    /** One call in one transaction. It answers the receipt of the call's event and the task after it. */
    const call = Effect.fnUntraced(function* (id: string, input: Msg, said: Recorded) {
      const decoded = decodeCall({ msg: input, recorded: said });

      if (R.isFailure(decoded)) {
        return yield* new TasksError({ reason: "bad_input", cause: decoded.failure });
      }

      const { msg, recorded } = decoded.success;
      const stored = toStored(msg);
      const answer = yield* ledger
        .transact((turn) => {
          const model = step(fold([...turn.read(stream(id), 0)].map((entry) => decodeStored(valueFor(entry)))), msg);

          if (model.answer._tag === "refused") {
            return R.fail(model.answer.reason);
          }

          if (model.answer._tag === "accepted") {
            // JSON preserves the writer's UTF-16 strings, including lone surrogates that SQL text replaces.
            // Older events have no saved record and keep reading their ledger metadata.
            const { connection: _connection, has: _has, ...writer } = recorded;
            turn.append(stream(id), `${id}/${stored._tag}`, lineFor(writer, encodeStored({ ...stored, recorded })));

            // An accepted request is also indexed under its target, in the same turn: a repeat or a
            // refusal never reaches here, so it writes no second line.
            if (msg._tag === "request") {
              const pointer = encodePointer(Pointer.make({ id, process: msg.request.process }));
              turn.append(targetStream(msg.request.target), id, lineFor(writer, pointer));
            }
          }

          const entry = [...turn.read(stream(id), 0)].find((e) => e._tag === stored._tag);

          // An accepted or repeated call has its event in the stream; a stream without one is a broken store.
          return entry === undefined
            ? R.fail("storage" as const)
            : R.succeed({ receipt: { rev: entry.rev, arrivedAt: entry.arrivedAt }, state: model.state });
        })
        .pipe(Effect.mapError(translated));

      if (R.isFailure(answer)) {
        return yield* new TasksError({ reason: answer.failure });
      }

      return answer.success;
    });

    return {
      request: Effect.fn("tasks.request")(function* (request: Request, recorded: Recorded) {
        return (yield* call(request.id, Msg.cases.request.make({ request }), recorded)).receipt;
      }),
      take: Effect.fn("tasks.take")(function* (id: string, executor: Executor, recorded: Recorded) {
        const proposed = yield* ids
          .next(Execution)
          .pipe(Effect.mapError((cause) => new TasksError({ reason: "storage", cause })));
        const { receipt, state } = yield* call(id, Msg.cases.take.make({ executor, execution: proposed }), recorded);
        // An accepted or repeated take leaves the task owned, so the saved assignment is there.
        const execution = state._tag === "absent" || state._tag === "requested" ? proposed : state.assignment.execution;
        return { ...receipt, execution };
      }),
      started: Effect.fn("tasks.started")(function* (id: string, execution: string, recorded: Recorded) {
        return (yield* call(id, Msg.cases.start.make({ execution }), recorded)).receipt;
      }),
      finish: Effect.fn("tasks.finish")(function* (id: string, execution: string, result: Result, recorded: Recorded) {
        return (yield* call(id, Msg.cases.finish.make({ execution, result }), recorded)).receipt;
      }),
      collected: Effect.fn("tasks.collected")(function* (
        id: string,
        collection: typeof Collection.Type,
        recorded: Recorded,
      ) {
        return (yield* call(id, Msg.cases.collect.make({ collection }), recorded)).receipt;
      }),
      read,
      forTarget: Effect.fn("tasks.forTarget")(function* (key: string) {
        return yield* ledger
          .transact((turn) => {
            const index = targetStream(key);
            const tasks = [...turn.read(index, 0)]
              .map((entry) => saved(turn, decodePointer(valueFor(entry)).id))
              .filter((found) => OPEN.has(found.state._tag));
            return { tasks, rev: turn.head(index) };
          })
          .pipe(Effect.mapError(translated));
      }),
      forProcess: (process: typeof ProcessId.Type) =>
        streams.list(PREFIX).pipe(
          Stream.mapError((cause) => new TasksError({ reason: "storage", cause })),
          Stream.mapEffect((name) => read(name.slice(PREFIX.length))),
          Stream.filter((task) => task.state._tag !== "absent" && task.state.request.process === process),
        ),
    };
  }),
);

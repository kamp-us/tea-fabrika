/**
 * The process manager: the one writer of process lifecycle events, after OTP's process calls.
 *
 * It starts and ends processes, keeps watches and writes their `DOWN` letters. Every line it
 * writes carries the brain's own writer key, and the process table trusts no other.
 *
 * @stability unstable
 */
import { Context, Effect, Layer, Option, Result, Schema, Stream } from "effect";
import { type Ledger, LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { lineFor } from "../ledger/Log.ts";
import * as Relation from "../permissions/Relation.ts";
import type { Sender } from "../permissions/Senders.ts";
import { Rev } from "../Rev.ts";
import { short } from "../telemetry/Trace.ts";
import { decodeExitReason, type ExitReason } from "./ExitReason.ts";
import { PipeTable } from "./internal/pipeTable.ts";
import { processMail } from "./internal/processMail.ts";
import { type From, inbox, type Letter, letterLine, Mailbox } from "./Mailbox.ts";
import { PipeEvent, STREAM as PIPES } from "./Pipes.ts";
import {
  Acked,
  acked,
  ackedPos,
  type Caller,
  clientInbox,
  Dead,
  DeadInput,
  Down,
  NoProc,
  ProcessError,
  ProcessEvent,
  type ProcessInfo,
  ProcessTable,
  Recipient,
  signalId,
  type Start,
  type StartAnswer,
  type State,
} from "./Process.ts";

const tag = (word: string): string => `fab.process.${word}`;
const id = (...parts: ReadonlyArray<Schema.Json>): string => JSON.stringify(parts);
const Send = Schema.TaggedStruct("send", { m: Down });
type Policy = { readonly reason: string; readonly crashes: number; readonly until: number };
type Failure = ProcessError | LedgerError;
/**
 * Trusted wiring, never decoded from public params: who calls, and `by`, the brain's own writer
 * key. Every event this manager writes carries that `by`, and its fold trusts no other.
 */
type Wiring = Caller & { readonly by: string };
/** A folded process table and the log rev it was folded through. */
type Folded = { readonly table: ProcessTable; readonly rev: Rev };

/**
 * Trusted, and passed only by a brain-side service: the process a watch is for, in place of the
 * wiring's own recipient. `name` is the registered name the watch was asked by, `member` the member
 * it was checked against, and `answer` the watch Cmd's answer letter, written in the watch's own
 * turn before any `noproc` DOWN. A watch the brain writes itself, as a pipe's, has no Cmd to answer.
 */
type Watcher = {
  readonly to: typeof Recipient.cases.process.Type;
  readonly name: string;
  readonly member?: Sender;
  readonly answer?: { readonly id: string; readonly m: Schema.Json };
};

/**
 * Trusted, and passed only by `PipesLedger`: the `piped` row to write, and the requester's answer
 * letter, written in the pipe's own turn.
 */
type PipeWrite = {
  readonly piped: typeof PipeEvent.cases.piped.Type;
  readonly answer: { readonly id: string; readonly m: Schema.Json };
};

/** Trusted, and passed only by `ChildrenLedger`: the process whose `stop_child` ends this life. */
type Stopper = { readonly requester: string };

const failed = Effect.fnUntraced(function* (error: Failure) {
  yield* Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason });
});

/**
 * Service that starts, ends and watches processes, and writes every process lifecycle event.
 *
 * **Details**
 *
 * Each call reads the process table and writes what it decides in one ledger turn, so no decision
 * rests on a read that has gone stale. A call repeated after it was saved answers the same and
 * adds no second line. A refusal fails with `ProcessError` and writes nothing; a ledger fault
 * fails with `LedgerError`.
 *
 * **Gotchas**
 *
 * The caller is trusted wiring, fixed when the layer is built. `exit`, `down`, `dead`, `status`,
 * `resolve` and a restart are refused `not_parent` unless that caller's `owner` registered the
 * name. A watch delivers to that caller's `recipient`, unless a brain-side service passes the
 * trusted `as` for a program's watch.
 *
 * @stability unstable
 * @category services
 */
export class ProcessManager extends Context.Service<
  ProcessManager,
  {
    /**
     * Places a new process: the first under a free name, or the next after one that ended. `first`
     * is a child's first letter, written in the start's own turn, at `["start", id]`. `guard` runs
     * in the turn that would write, after the table's own checks: when it says no, the start fails
     * `forbidden` and nothing is written. A saved start answers without it.
     */
    readonly start: (
      request: Start,
      from: From,
      first?: { readonly m: Schema.Json },
      guard?: (turn: LedgerTurn) => boolean,
    ) => Effect.Effect<StartAnswer, Failure>;
    /**
     * Ends a live process with `reason`, writes a `DOWN` to each of its watchers, and ends the
     * watches the process itself held. With `stop`, the trusted process whose `stop_child` ends it,
     * the same turn ends each live pipe that process asked for with this name as an end: its
     * `unpiped` row, the end of its mail right, and its live watch.
     */
    readonly exit: (process: string, reason: ExitReason, from: From, stop?: Stopper) => Effect.Effect<void, Failure>;
    /**
     * Writes a pipe in one turn: its `piped` row, the writer name's right to mail the reader's name,
     * the requester's answer and, if both ends already have live lives, the reader's watch on the
     * writer's. A pipe saved under the id writes nothing again. A name that went live since the
     * caller's checks is refused `name_taken`, with nothing written.
     */
    readonly pipe: (write: PipeWrite, from: From) => Effect.Effect<void, Failure>;
    /** The brain's pipe rows inside one ledger turn, trusting only the brain's lines. */
    readonly pipes: (turn: LedgerTurn) => PipeTable;
    /** Every live process. */
    readonly info: Effect.Effect<ReadonlyArray<ProcessInfo>, LedgerError>;
    /** A name's current state and its restart times, with `at`, the clock when the answer was made. */
    readonly status: (name: string) => Effect.Effect<
      {
        readonly name: string;
        readonly state: typeof State.Type;
        readonly at: number;
        readonly restarts: ReadonlyArray<number>;
      },
      Failure
    >;
    /**
     * The name a process id belongs to, with that name's current state, which may already be a
     * newer process than the one asked about.
     */
    readonly resolve: (
      process: string,
    ) => Effect.Effect<{ readonly name: string; readonly state: typeof State.Type }, Failure>;
    /** Writes a letter that reached its delivery limit to `<process>/dead`, once per letter. */
    readonly dead: (process: string, dead: typeof DeadInput.Type, from: From) => Effect.Effect<void, Failure>;
    /**
     * Records that `process` has read its name's inbox through `pos`, after its checkpoint was
     * saved. The name is bound from the live process. An ack from a life that is not its name's
     * live process, or at or behind the newest ack, writes nothing, so the ack only moves forward.
     */
    readonly ack: (process: string, pos: Rev, from: From) => Effect.Effect<void, Failure>;
    readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
    /**
     * Watches `process` under the caller's own `ref`. A target that is not live gets its `DOWN`,
     * with `noproc`, in the same turn. With `as`, the watch is that process's instead: its row
     * keeps the name and member, its answer letter lands in its inbox in the same turn, and before
     * the `noproc` DOWN.
     */
    readonly monitor: (ref: string, process: string, from: From, as?: Watcher) => Effect.Effect<void, Failure>;
    /**
     * Cancels the caller's own live watch under `ref`, or with `as` that process's. With no such
     * watch it writes nothing.
     */
    readonly demonitor: (ref: string, from: From, as?: Pick<Watcher, "to">) => Effect.Effect<void, Failure>;
    /**
     * Ends every live watch whose recipient is the client session `session`, as a watcher's exit
     * ends its watches: each gets `demonitored {reason: "watcher_exited"}`. With none it writes
     * nothing. It never refuses.
     */
    readonly leave: (session: string, from: From) => Effect.Effect<void, LedgerError>;
    /**
     * A live process's letters past the log rev `after`, oldest first. A `DOWN` signal whose watch
     * was canceled, or that is for another recipient, is left out.
     */
    readonly receive: (process: string, after: Rev) => Stream.Stream<Letter, Failure>;
    /**
     * Writes that a supervisor gave up on a process that is no longer live: the reason, the crash
     * count, and the time it waits until.
     */
    readonly down: (process: string, policy: Policy, from: From) => Effect.Effect<void, Failure>;
    /**
     * The process table inside one ledger turn, trusting only the brain's lines, for a caller that
     * decides and writes in that turn, as a child's start does.
     */
    readonly table: (turn: LedgerTurn) => ProcessTable;
    /**
     * The newest inbox pos `name`'s reader acked, or 0 before any ack, inside one ledger turn and
     * trusting only the brain's lines. One index read, however many acks the name has.
     */
    readonly ackedPos: (turn: LedgerTurn, name: string) => Rev;
  }
>()("@kampus/libfabrika/processes/ProcessManager") {
  static readonly layer = (
    caller: Wiring,
    nextId: Effect.Effect<string>,
  ): Layer.Layer<ProcessManager, never, LedgerTransaction> =>
    Layer.effect(
      ProcessManager,
      Effect.gen(function* () {
        const tx = yield* LedgerTransaction;
        // The table this layer last folded from committed entries, and the log rev it was folded
        // through: a read model of the ledger, kept in memory for the layer's life, as an informer's
        // cache. Only a fold made before its own turn appends anything replaces it, so it holds only
        // committed entries, and the ledger never changes or drops one: its `entries` table takes
        // only INSERTs. So the saved table stays true below its rev, and a fold past that rev gives
        // every answer a fold from rev 0 gives.
        let folded: Folded | undefined;
        const fromZero = (turn: LedgerTurn): Folded => {
          const entries = ProcessTable.entries(turn.read, caller.by);
          return { table: new ProcessTable(entries, caller.by), rev: entries.at(-1)?.rev ?? 0 };
        };
        const forward = (turn: LedgerTurn): Folded => {
          if (folded === undefined) {
            return fromZero(turn);
          }

          const fresh = folded.table.after(turn.read, folded.rev);
          const last = fresh.at(-1);
          return last === undefined ? folded : { table: folded.table.fold(fresh), rev: last.rev };
        };
        // The table inside a turn that may already have appended: folded forward, never saved.
        const fold = (turn: LedgerTurn) => forward(turn).table;
        // The table at the start of a turn, before it appends: folded forward and saved.
        const committed = (turn: LedgerTurn) => {
          folded = forward(turn);
          return folded.table;
        };
        // The brain writes every line here; `from` keeps the call's person, parent and trace, and
        // `asked` keeps the caller's own key. The fold trusts `by` alone and never reads `asked`.
        const line = (from: From, event: Parameters<typeof lineFor>[1]) =>
          lineFor({ ...from, by: caller.by }, { ...event, asked: from.by });
        // A pipe's rows and relation rows are the brain's facts: they keep the call's person, parent
        // and trace, and no `asked`, so each body is exactly its schema's.
        const fact = (from: From, event: Parameters<typeof lineFor>[1]) => lineFor({ ...from, by: caller.by }, event);
        const encodePipe = Schema.encodeSync(PipeEvent);
        const checked = Effect.fnUntraced(function* <A>(
          step: (table: ProcessTable, turn: LedgerTurn) => Result.Result<A, ProcessError>,
        ) {
          return yield* Effect.fromResult(yield* tx.transact((turn) => step(committed(turn), turn)));
        });
        const signal = (
          table: ProcessTable,
          turn: LedgerTurn,
          watch: { readonly ref: string; readonly round: number; readonly name?: string | undefined },
          process: string,
          reason: (typeof Down.Type)["reason"],
          to: (typeof Down.Type)["to"],
          from: From,
        ) => {
          const { ref, round, name } = watch;
          const inbox =
            to._tag === "client" ? clientInbox(to.client) : `${Option.getOrThrow(table.life(to.process)).name}/inbox`;
          const letter = signalId(to, ref, round);

          // A retried call may find this signal already written. Only the brain's own row counts;
          // another writer's row at this id makes the append refuse, and the whole turn with it.
          if ([...turn.read(inbox, 0)].some((entry) => entry.id === letter && entry.by === caller.by)) {
            return;
          }

          const down = Down.make({ ref, process, ...(name === undefined ? {} : { name }), reason, to });
          turn.append(inbox, letter, line(from, Send.make({ m: down })));
        };
        /** Writes one watch in a turn already open, on the table folded through that turn. */
        const watchIn = (
          turn: LedgerTurn,
          ref: string,
          process: string,
          as: Watcher,
          from: From,
        ): Result.Result<void, ProcessError> => {
          const table = fold(turn);
          const to = as.to;
          const round = table.monitor(ref, process, to);

          if (Result.isFailure(round)) {
            return Result.fail(round.failure);
          }

          if (Option.isNone(round.success)) {
            return Result.succeed(undefined);
          }

          const watch = { ref, round: round.success.value, name: as.name };
          turn.append(
            ProcessTable.stream,
            id("monitored", to, ref, watch.round),
            line(
              from,
              ProcessEvent.cases.monitored.make({
                ref,
                process,
                to,
                name: as.name,
                ...(as.member === undefined ? {} : { member: as.member }),
              }),
            ),
          );

          // The answer comes first, so the watcher reads it before any DOWN for this watch.
          if (as.answer !== undefined) {
            const watcher = Option.getOrThrow(table.life(as.to.process)).name;
            turn.append(inbox(watcher), as.answer.id, letterLine(from, as.answer.m));
          }

          if (!table.isLive(process)) {
            signal(table, turn, watch, process, NoProc.make({}), to, from);
          }

          return Result.succeed(undefined);
        };
        /**
         * The watches a start or restart of `name` owes, in that turn: for each live pipe it is an end
         * of, the reader's live life watches the writer's live life, under a ref that names that
         * writer life, so a watch binds one life and the pipe follows the name.
         */
        const pipeWatches = (turn: LedgerTurn, name: string, from: From): Result.Result<void, ProcessError> => {
          const table = fold(turn);

          for (const pipe of PipeTable.read(turn, caller.by).touching(name)) {
            const writer = Option.getOrUndefined(table.whereis(pipe.from.name));
            const reader = Option.getOrUndefined(table.whereis(pipe.to.name));

            // The other end has no life yet: its own start writes the watch.
            if (writer?.state._tag !== "live" || reader?.state._tag !== "live") {
              continue;
            }

            const watched = watchIn(
              turn,
              `${pipe.pipe}/${writer.state.process}`,
              writer.state.process,
              {
                to: Recipient.cases.process.make({ process: reader.state.process }),
                name: pipe.from.name,
                member: pipe.member,
              },
              from,
            );

            if (Result.isFailure(watched)) {
              return watched;
            }
          }

          return Result.succeed(undefined);
        };
        /**
         * The pipes a requester's stop of `name` ends, in the stop's own turn: each live one the
         * requester's name asked for with `name` as an end. Each gets `unpiped` and the end of its mail
         * right, and, when the reader is the life that ends, its watch is canceled. Answers the refs
         * canceled here, so the watcher's own end does not write them again.
         */
        const unpipe = (table: ProcessTable, turn: LedgerTurn, name: string, stop: Stopper, from: From) => {
          const requester = Option.getOrUndefined(table.life(stop.requester))?.name;
          const canceled = new Set<string>();

          if (requester === undefined) {
            return canceled;
          }

          for (const pipe of PipeTable.read(turn, caller.by).touching(name)) {
            if (pipe.requester.name !== requester) {
              continue;
            }

            turn.append(
              PIPES,
              id("unpiped", pipe.pipe),
              fact(from, encodePipe(PipeEvent.cases.unpiped.make({ pipe: pipe.pipe, reason: "stopped" }))),
            );
            turn.append(
              Relation.STREAM,
              id("unrelated", "pipes_to", pipe.pipe),
              fact(
                from,
                Relation.Row.cases.unrelated.make({
                  subject: `name:${pipe.from.name}`,
                  relation: "pipes_to",
                  object: `name:${pipe.to.name}`,
                }),
              ),
            );

            const reader = Option.getOrUndefined(table.whereis(pipe.to.name));

            if (reader?.state._tag !== "live" || pipe.to.name !== name) {
              continue;
            }

            const to = Recipient.cases.process.make({ process: reader.state.process });

            for (const watch of table.outbound(reader.state.process)) {
              if (!watch.ref.startsWith(`${pipe.pipe}/`)) {
                continue;
              }

              turn.append(
                ProcessTable.stream,
                id("demonitored", to, watch.ref, watch.round),
                line(from, ProcessEvent.cases.demonitored.make({ ref: watch.ref, to, reason: "canceled" })),
              );
              canceled.add(watch.ref);
            }
          }

          return canceled;
        };
        // A watcher that ends takes its watches with it, as OTP's monitors go with a dead process.
        const watcherExited = (turn: LedgerTurn, watches: ReturnType<ProcessTable["held"]>, from: From) => {
          for (const watch of watches) {
            turn.append(
              ProcessTable.stream,
              id("demonitored", watch.to, watch.ref, watch.round),
              line(
                from,
                ProcessEvent.cases.demonitored.make({ ref: watch.ref, to: watch.to, reason: "watcher_exited" }),
              ),
            );
          }
        };
        const start = Effect.fn("process.start")(function* (
          request: Start,
          from: From,
          first?: { readonly m: Schema.Json },
          guard?: (turn: LedgerTurn) => boolean,
        ) {
          yield* Effect.annotateCurrentSpan(
            short({
              [tag("name")]: request.name,
              [tag("program")]: request.code.program,
              [tag("hash")]: request.code.hash,
            }),
          );
          const saved = yield* checked((table) => table.start(request, caller, from));
          const answer = Option.isSome(saved)
            ? saved.value
            : yield* Effect.gen(function* () {
                const process = yield* nextId;
                return yield* checked((table, turn) => {
                  const current = table.start(request, caller, from);

                  if (Result.isFailure(current)) {
                    return Result.fail(current.failure);
                  }

                  if (Option.isSome(current.success)) {
                    return Result.succeed(current.success.value);
                  }

                  if (guard !== undefined && !guard(turn)) {
                    return Result.fail(new ProcessError({ reason: "forbidden" }));
                  }

                  if (table.collision(process)) {
                    return Result.fail(new ProcessError({ reason: "id_collision" }));
                  }

                  if (request._tag === "first") {
                    turn.append(
                      ProcessTable.stream,
                      id("registered", request.name),
                      line(
                        from,
                        ProcessEvent.cases.registered.make({
                          name: request.name,
                          program: request.code.program,
                          owner: caller.owner,
                        }),
                      ),
                    );
                  }

                  const placed = turn.append(
                    ProcessTable.events(request.name),
                    request.id,
                    line(
                      from,
                      ProcessEvent.cases.started.make({
                        process,
                        name: request.name,
                        ...request.code,
                        ...(request._tag === "first" && request.requester !== undefined
                          ? { requester: request.requester }
                          : {}),
                        ...(request._tag === "first" && request.member !== undefined ? { member: request.member } : {}),
                      }),
                    ),
                  );

                  // The first letter keeps the caller's own `from`: it is the requester's mail, not the brain's.
                  if (first !== undefined) {
                    turn.append(inbox(request.name), id("start", request.id), letterLine(from, first.m));
                  }

                  if (request._tag === "again") {
                    turn.append(
                      ProcessTable.events(request.name),
                      id("restarted", process),
                      line(
                        from,
                        ProcessEvent.cases.restarted.make({
                          process,
                          after: request.after,
                          name: request.name,
                          reason: request.reason,
                          build: request.code.hash,
                        }),
                      ),
                    );
                  }

                  // In the very turn of the start, so a writer life that crashes at once still gives
                  // its own reason, never noproc.
                  const watched = pipeWatches(turn, request.name, from);

                  if (Result.isFailure(watched)) {
                    return Result.fail(watched.failure);
                  }

                  return Result.succeed({ process, rev: placed.rev });
                });
              });
          yield* Effect.annotateCurrentSpan({
            "fab.process": answer.process,
            [tag("answer")]: "placed",
            [tag("rev")]: answer.rev,
          });
          return answer;
        }, Effect.tapError(failed));
        const exit = Effect.fn("process.exit")(function* (
          process: string,
          input: ExitReason,
          from: From,
          stop?: Stopper,
        ) {
          yield* Effect.annotateCurrentSpan({ "fab.process": process });
          // The reason is decoded before the turn opens: text, an unknown tag or noproc writes nothing.
          const reason = yield* Effect.fromResult(decodeExitReason(input)).pipe(
            Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
          );
          yield* checked((table, turn) => {
            const life = table.exit(process, reason, caller.owner);

            if (Result.isFailure(life)) {
              return Result.fail(life.failure);
            }

            if (life.success.state._tag !== "live") {
              return Result.succeed(undefined);
            }

            turn.append(
              ProcessTable.events(life.success.name),
              id("exited", process),
              line(from, ProcessEvent.cases.exited.make({ process, reason })),
            );

            for (const watch of table.inbound(process)) {
              signal(table, turn, watch, process, reason, watch.to, from);
            }

            const canceled =
              stop === undefined ? new Set<string>() : unpipe(table, turn, life.success.name, stop, from);
            watcherExited(
              turn,
              table.outbound(process).filter((watch) => !canceled.has(watch.ref)),
              from,
            );
            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const leave = Effect.fn("process.leave")(function* (session: string, from: From) {
          yield* Effect.annotateCurrentSpan({ [tag("session")]: session });
          yield* tx.transact((turn) => watcherExited(turn, committed(turn).held(session), from));
        }, Effect.tapError(failed));
        const monitor = Effect.fn("process.monitor")(function* (
          ref: string,
          process: string,
          from: From,
          as?: Watcher,
        ) {
          yield* Effect.annotateCurrentSpan({
            "fab.process": process,
            ...short({ [tag("ref")]: ref }),
          });
          const to = caller.recipient;
          yield* checked((table, turn) => {
            if (as !== undefined) {
              return watchIn(turn, ref, process, as, from);
            }

            const round = table.monitor(ref, process, to);

            if (Result.isFailure(round)) {
              return Result.fail(round.failure);
            }

            if (Option.isNone(round.success)) {
              return Result.succeed(undefined);
            }

            const watch = { ref, round: round.success.value };
            turn.append(
              ProcessTable.stream,
              id("monitored", to, ref, watch.round),
              line(from, ProcessEvent.cases.monitored.make({ ref, process, to })),
            );

            if (!table.isLive(process)) {
              signal(table, turn, watch, process, NoProc.make({}), to, from);
            }

            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const pipe = Effect.fn("process.pipe")(function* (write: PipeWrite, from: From) {
          const { piped, answer } = write;
          yield* Effect.annotateCurrentSpan(short({ [tag("pipe")]: piped.pipe }));
          yield* checked((table, turn) => {
            if (Option.isSome(PipeTable.read(turn, caller.by).saved(piped.pipe))) {
              return Result.succeed(undefined);
            }

            const live = (name: string) => Option.exists(table.whereis(name), ({ state }) => state._tag === "live");

            if (live(piped.from.name) || live(piped.to.name)) {
              return Result.fail(new ProcessError({ reason: "name_taken" }));
            }

            const requester = Option.getOrUndefined(table.life(piped.requester.process));

            if (requester === undefined || !table.isLive(piped.requester.process)) {
              return Result.fail(new ProcessError({ reason: "ended" }));
            }

            turn.append(PIPES, id("piped", piped.pipe), fact(from, encodePipe(piped)));
            turn.append(
              Relation.STREAM,
              id("related", "pipes_to", piped.pipe),
              fact(
                from,
                Relation.Row.cases.related.make({
                  subject: `name:${piped.from.name}`,
                  relation: "pipes_to",
                  object: `name:${piped.to.name}`,
                }),
              ),
            );
            turn.append(inbox(requester.name), answer.id, letterLine(from, answer.m));
            return pipeWatches(turn, piped.from.name, from);
          });
        }, Effect.tapError(failed));
        const demonitor = Effect.fn("process.demonitor")(function* (ref: string, from: From, as?: Pick<Watcher, "to">) {
          yield* Effect.annotateCurrentSpan(short({ [tag("ref")]: ref }));
          const to = as?.to ?? caller.recipient;
          yield* checked((table, turn) => {
            const watch = table.demonitor(ref, to);

            if (Option.isSome(watch)) {
              turn.append(
                ProcessTable.stream,
                id("demonitored", to, ref, watch.value.round),
                line(from, ProcessEvent.cases.demonitored.make({ ref, to, reason: "canceled" })),
              );
            }

            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const down = Effect.fn("process.down")(function* (process: string, policy: Policy, from: From) {
          yield* Effect.annotateCurrentSpan({ "fab.process": process });
          yield* checked((table, turn) => {
            const life = table.down(process, policy.reason, caller.owner);

            if (Result.isFailure(life)) {
              return Result.fail(life.failure);
            }

            turn.append(
              ProcessTable.events(life.success.name),
              id("down", process, policy),
              line(from, ProcessEvent.cases.down.make({ process, ...policy })),
            );
            return Result.succeed(undefined);
          });
        }, Effect.tapError(failed));
        const ack = Effect.fn("process.ack")(
          function* (process: string, input: Rev, from: From) {
            yield* Effect.annotateCurrentSpan({ "fab.process": process });
            const pos = yield* Schema.decodeUnknownEffect(Rev)(input).pipe(
              Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
            );
            yield* Effect.annotateCurrentSpan({ [tag("pos")]: pos });
            yield* checked((table, turn) => {
              const life = table.life(process);

              if (Option.isNone(life) || !table.isLive(process) || pos <= ackedPos(turn, life.value.name, caller.by)) {
                return Result.succeed(undefined);
              }

              turn.append(acked(life.value.name), `${process}/acked/${pos}`, line(from, Acked.make({ process, pos })));
              return Result.succeed(undefined);
            });
          },
          // The ack's own ledger turn is the reader's work too: the sink files it in the reader's job,
          // so the span says whose it is, as every span in a job does.
          (effect, process) => Effect.annotateSpans(effect, { "fab.process": process }),
          Effect.tapError(failed),
        );
        const receive = (process: string, after: Rev): Stream.Stream<Letter, Failure> =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* Effect.annotateCurrentSpan({ "fab.process": process, [tag("after")]: after });
              const mail = yield* checked((table, turn) => {
                const life = table.life(process);

                if (Option.isNone(life) || !table.isLive(process)) {
                  return Result.fail(new ProcessError({ reason: "ended" }));
                }

                return Result.succeed(processMail(table, process, turn.read(`${life.value.name}/inbox`, after)));
              });
              const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
              yield* Effect.annotateCurrentSpan({
                [tag("letters")]: mail.length,
                ...(mail.length === 0
                  ? {}
                  : { [tag("lag")]: Math.max(...mail.map(({ arrivedAt }) => now - arrivedAt)) }),
              });
              return Stream.fromIterable(mail.map(({ letter }) => letter));
            }).pipe(Effect.tapError(failed)),
          ).pipe(Stream.withSpan("process.receive"));
        const info = Effect.fn("process.info")(function* () {
          return yield* tx.transact((turn) => committed(turn).info);
        });
        return {
          resolve: Effect.fn("process.resolve")(function* (process: string) {
            return yield* checked((table) => {
              const old = table.parent(process, caller.owner);
              return Result.isFailure(old) ? Result.fail(old.failure) : table.status(old.success.name, caller.owner);
            });
          }),
          status: Effect.fn("process.status")(function* (name: string) {
            const status = yield* checked((table) => table.status(name, caller.owner));
            return { ...status, at: yield* Effect.clockWith((clock) => clock.currentTimeMillis) };
          }),
          dead: Effect.fn("process.dead")(function* (process: string, dead: typeof DeadInput.Type, from: From) {
            const input = yield* Schema.decodeUnknownEffect(DeadInput)(dead).pipe(
              Effect.mapError((cause) => new ProcessError({ reason: "bad_text", cause })),
            );
            yield* checked((table, turn) => {
              const life = table.parent(process, caller.owner);

              if (Result.isFailure(life)) {
                return Result.fail(life.failure);
              }

              const value = Dead.make({
                ...input,
                process: life.success.state.process,
                program: life.success.state.code.program,
                name: life.success.name,
              });
              const stream = `${process}/dead`;
              const key = id("dead", process, value.m);
              const prior = [...turn.read(stream, 0)].find((entry) => entry.id === key && entry.by === caller.by);

              if (prior === undefined) {
                turn.append(stream, key, line(from, value));
              }

              return Result.succeed(undefined);
            });
          }),
          start,
          exit,
          ack,
          monitor,
          demonitor,
          pipe,
          pipes: (turn) => PipeTable.read(turn, caller.by),
          leave,
          down,
          receive,
          table: fold,
          ackedPos: (turn, name) => ackedPos(turn, name, caller.by),
          info: info(),
          isLive: Effect.fn("process.isLive")(function* (process: string) {
            return yield* tx.transact((turn) => committed(turn).isLive(process));
          }),
        };
      }),
    );
}

/**
 * The manager's calls as plain Effects, for a manager another object owns, such as the Worker's
 * Project.
 *
 * **Details**
 *
 * A receive collects its letters so the call can cross an RPC; `remoteProcessManager` rebuilds the
 * Stream. Refusals keep their `ProcessError`; a transport failure stays the caller's
 * `LedgerError`. A start takes no guard: a guard runs inside the owner's own turn, which no call
 * across an RPC reaches. A watch takes no `as`, so no object across an RPC names another recipient.
 * There is no `leave`: a session ends where its socket closes, in the owner itself.
 *
 * @stability unstable
 * @category models
 */
export type ProcessCalls = Omit<
  Context.Service.Shape<typeof ProcessManager>,
  "receive" | "table" | "ackedPos" | "start" | "leave" | "monitor" | "demonitor" | "exit" | "pipe" | "pipes"
> & {
  readonly exit: (process: string, reason: ExitReason, from: From) => Effect.Effect<void, Failure>;
  readonly start: (
    request: Start,
    from: From,
    first?: { readonly m: Schema.Json },
  ) => Effect.Effect<StartAnswer, Failure>;
  readonly monitor: (ref: string, process: string, from: From) => Effect.Effect<void, Failure>;
  readonly demonitor: (ref: string, from: From) => Effect.Effect<void, Failure>;
  readonly receive: (process: string, after: Rev) => Effect.Effect<ReadonlyArray<Letter>, Failure>;
};

/**
 * Layer that provides `ProcessManager` from calls another object owns.
 *
 * **Details**
 *
 * `by` is the brain's own writer key: a turn this side is given folds as the brain's does. A start
 * with a guard is refused `forbidden` and asks nothing: this side cannot run the guard in the turn
 * that writes, and a check it cannot make never lets a start through. A watch or its end with `as`
 * is refused `forbidden` the same way: those calls cannot carry it, and dropping it would watch for
 * the wrong recipient. A `leave` fails `refused` and writes nothing: only the owner, where the
 * socket closed, ends a session.
 *
 * @stability unstable
 * @category layers
 */
export const remoteProcessManager = (calls: ProcessCalls, by: string): Layer.Layer<ProcessManager> =>
  Layer.succeed(ProcessManager, {
    ...calls,
    start: (request, from, first, guard) =>
      guard === undefined ? calls.start(request, from, first) : Effect.fail(new ProcessError({ reason: "forbidden" })),
    monitor: (ref, process, from, as) =>
      as === undefined ? calls.monitor(ref, process, from) : Effect.fail(new ProcessError({ reason: "forbidden" })),
    demonitor: (ref, from, as) =>
      as === undefined ? calls.demonitor(ref, from) : Effect.fail(new ProcessError({ reason: "forbidden" })),
    exit: (process, reason, from, stop) =>
      stop === undefined ? calls.exit(process, reason, from) : Effect.fail(new ProcessError({ reason: "forbidden" })),
    pipe: () => Effect.fail(new ProcessError({ reason: "forbidden" })),
    pipes: (turn) => PipeTable.read(turn, by),
    leave: () => Effect.fail(new LedgerError({ reason: "refused" })),
    table: (turn) => ProcessTable.read(turn.read, by),
    ackedPos: (turn, name) => ackedPos(turn, name, by),
    receive: (process, after) =>
      Stream.unwrap(Effect.map(calls.receive(process, after), (letters) => Stream.fromIterable(letters))),
  });

/**
 * Layer that provides `Mailbox` and `ProcessManager` together, over one ledger.
 *
 * **Details**
 *
 * `caller` is trusted wiring: who calls, and the brain's own writer key. `nextId` makes the id of
 * each new process.
 *
 * @stability unstable
 * @category layers
 */
export const CoordinationLayer = (
  caller: Wiring,
  nextId: Effect.Effect<string>,
): Layer.Layer<Mailbox | ProcessManager, never, Ledger | LedgerTransaction> =>
  Layer.mergeAll(Mailbox.layer, ProcessManager.layer(caller, nextId));

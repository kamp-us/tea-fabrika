/**
 * The `Monitors` layer that watches on the ledger.
 *
 * A watch is judged in one ledger turn, from the watch's ref, the process table and the relation
 * rows, and written in `ProcessManager.monitor`'s own turn: the `monitored` row, the watcher's
 * answer letter and, for a life that already ended, its `noproc` DOWN. A saved ref answers again
 * and writes nothing, so a retried Cmd is one watch.
 *
 * @stability unstable
 */
import { Clock, Data, Effect, Layer, Option, Result, Schema } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { WatchProcess } from "../permissions/Model.ts";
import type * as Rebac from "../permissions/Rebac.ts";
import { Relations, type RelationsError } from "../permissions/Relations.ts";
import { type Sender, Senders, type SendersError } from "../permissions/Senders.ts";
import { short } from "../telemetry/Trace.ts";
import { pick, recorded } from "./internal/member.ts";
import type { From } from "./Mailbox.ts";
import { Monitors, MonitorsError, type Unwatch, type Watch, Watched } from "./Monitors.ts";
import { ProcessError, ProcessName, type ProcessTable } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

const tag = (word: string): string => `fab.monitors.${word}`;

const isName = Schema.is(ProcessName);
const encodeWatched = Schema.encodeSync(Watched);

const refuse = (reason: Exclude<MonitorsError["reason"], "storage">) => MonitorsError.make({ reason });

const storage = (cause: LedgerError | ProcessError | RelationsError | SendersError) =>
  MonitorsError.make({ reason: "storage", cause });

/**
 * What the look turn found: a saved watch, answered again, or a fresh one to write, bound to the
 * name's current life, with the member its permission step checked, none for a related pair.
 */
type Found = Data.TaggedEnum<{
  saved: { readonly watched: typeof Watched.Type };
  fresh: { readonly watched: typeof Watched.Type; readonly member: Option.Option<Sender> };
}>;

const Found = Data.taggedEnum<Found>();

/** Whether `member` holds `watch` on this fabrika, on the relation rows of `turn`. */
type May = (turn: LedgerTurn, member: Sender) => Result.Result<boolean, RelationsError>;

/** A child and the program that started it may watch each other with no member, read by name, as
 *  program mail reads the pair: a restart under either name keeps it. */
const related = (table: ProcessTable, watcher: string, name: string): boolean =>
  Option.exists(table.starter(name), (starter) => starter === watcher) ||
  Option.exists(table.starter(watcher), (starter) => starter === name);

/**
 * The checks after the name, in one turn and in this order: a saved watch, a live watcher, the
 * permission step, then whereis. A refused watcher never learns whether a name exists.
 */
const look = (
  table: ProcessTable,
  turn: LedgerTurn,
  watch: Watch,
  sender: Result.Result<Option.Option<Sender>, SendersError>,
  may: May,
): Result.Result<Found, MonitorsError> => {
  const saved = Option.getOrUndefined(table.watch(watch.id, watch.watcher));

  if (saved !== undefined) {
    const watched = Watched.make({ ref: watch.id, process: saved.process, name: saved.name ?? watch.name });
    return Result.succeed(Found.saved({ watched }));
  }

  const watcher = Option.getOrUndefined(table.life(watch.watcher.process));

  if (watcher === undefined || !table.isLive(watch.watcher.process)) {
    return Result.fail(refuse("stale_sender"));
  }

  // The permission step: the cause's sender, else the watcher's recorded member, else a related pair.
  const picked = pick(sender, recorded(watcher));

  if (Result.isFailure(picked)) {
    const { reason } = picked.failure;
    return Result.fail(
      reason === "storage" ? storage(picked.failure) : refuse(reason === "ended" ? "stale_sender" : "forbidden"),
    );
  }

  const member = picked.success;
  const allowed = Option.match(member, {
    onNone: () => Result.succeed(related(table, watcher.name, watch.name)),
    onSome: (checked) => may(turn, checked),
  });

  if (Result.isFailure(allowed)) {
    return Result.fail(storage(allowed.failure));
  }

  if (!allowed.success) {
    return Result.fail(refuse("forbidden"));
  }

  return Option.match(table.whereis(watch.name), {
    onNone: () => Result.fail(refuse("no_name")),
    onSome: ({ state }) =>
      Result.succeed(
        Found.fresh({ watched: Watched.make({ ref: watch.id, process: state.process, name: watch.name }), member }),
      ),
  });
};

/** The monitor Cmd's `ok` answer letter, in the shape the runner gives every host Cmd's answer. */
const answered = (watch: Watch, watched: typeof Watched.Type, at: number) => ({
  id: `${watch.id}/answer`,
  m: { type: "monitor_ok", cmd: { type: "monitor", name: watch.name }, value: encodeWatched(watched), at },
});

/**
 * Layer that provides `Monitors` on the ledger, through `LedgerTransaction`, `ProcessManager`,
 * `Relations` and `Senders`.
 *
 * **Details**
 *
 * `fabrika` is this fabrika's object in the permission model. Before any turn, a watch asks
 * `Senders` who sent `from.parent` to the watcher. Then it is judged in this order: the name, a
 * saved watch under the ref, a live watcher, the permission step, then whereis. The permission step
 * checks the cause's sender, else the watcher's recorded member, with `WatchProcess` on `fabrika`:
 * `Denied` and a removed key are `forbidden`, and a cause delivered to a process that ended is
 * `stale_sender`. With no member, only the watcher's own child or its starter may be watched. A
 * fresh watch binds the name's current life, whether it is live, ended or down, and writes `member`
 * and `name` on its `monitored` row.
 *
 * **Gotchas**
 *
 * The permission step reads the rows of the look turn, and the write turn does not check them
 * again, as a start's does: a relation removed between the two turns does not stop that watch.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (config: {
  readonly fabrika: Rebac.Ref<"fabrika">;
}): Layer.Layer<Monitors, never, LedgerTransaction | ProcessManager | Relations | Senders> =>
  Layer.effect(
    Monitors,
    Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      const manager = yield* ProcessManager;
      const relations = yield* Relations;
      const senders = yield* Senders;
      const may: May = (turn, member) =>
        Result.map(relations.within(turn), (tuples) =>
          Result.isSuccess(WatchProcess.within(tuples, member, config.fabrika)),
        );

      /** The write turn: the row, the answer letter and any noproc DOWN, as the watcher. */
      const bind = Effect.fnUntraced(function* (
        watch: Watch,
        watched: typeof Watched.Type,
        member: Option.Option<Sender>,
        from: From,
      ) {
        yield* manager
          .monitor(watch.id, watched.process, from, {
            to: watch.watcher,
            name: watch.name,
            ...Option.match(member, { onNone: () => ({}), onSome: (checked) => ({ member: checked }) }),
            answer: answered(watch, watched, yield* Clock.currentTimeMillis),
          })
          .pipe(
            Effect.catch((error) =>
              error instanceof ProcessError
                ? error.reason === "ended"
                  ? Effect.fail(refuse("stale_sender"))
                  : Effect.die(new Error(`a watch's write was refused: ${error.reason}`))
                : Effect.fail(storage(error)),
            ),
          );
      });

      const monitor = Effect.fn("monitors.monitor")(
        function* (watch: Watch, from: From) {
          yield* Effect.annotateCurrentSpan(short({ [tag("name")]: watch.name, [tag("ref")]: watch.id }));

          if (!isName(watch.name)) {
            return yield* refuse("bad_name");
          }

          // Outside any turn, and kept as it came: it decides nothing before the saved-ref check.
          const sender = yield* senders.sender(from.parent, watch.watcher.process).pipe(Effect.result);
          const found = yield* tx
            .transact((turn) => look(manager.table(turn), turn, watch, sender, may))
            .pipe(Effect.mapError(storage), Effect.flatMap(Effect.fromResult));

          if (found._tag === "fresh") {
            yield* bind(watch, found.watched, found.member, from);
          }

          return found.watched;
        },
        Effect.tap((watched) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "monitored", "fab.process": watched.process }),
        ),
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason }),
        ),
      );

      const demonitor = Effect.fn("monitors.demonitor")(
        function* (unwatch: Unwatch, from: From) {
          yield* Effect.annotateCurrentSpan(short({ [tag("ref")]: unwatch.ref }));
          yield* manager.demonitor(unwatch.ref, from, { to: unwatch.watcher }).pipe(Effect.mapError(storage));
        },
        Effect.tapError((error) => Effect.annotateCurrentSpan({ [tag("reason")]: error.reason })),
      );

      return Monitors.of({ monitor, demonitor });
    }),
  );

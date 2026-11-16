/**
 * The `Pipes` layer that keeps pipes on the ledger.
 *
 * A pipe is judged in one ledger turn, from its id, the pipe rows, the process table and the relation
 * rows, and written in `ProcessManager.pipe`'s own turn: the `piped` row, the writer name's right to
 * mail the reader's name and the requester's answer. A saved id answers again and writes nothing, so
 * a retried Cmd is one pipe. An unfit pipe writes only its answer.
 *
 * @stability unstable
 */
import { Clock, Data, Effect, Layer, Option, Result, Schema } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { PipePrograms } from "../permissions/Model.ts";
import type * as Rebac from "../permissions/Rebac.ts";
import { Relations, type RelationsError } from "../permissions/Relations.ts";
import { type Sender, Senders, type SendersError } from "../permissions/Senders.ts";
import { short } from "../telemetry/Trace.ts";
import * as Fit from "./Fit.ts";
import { pick, recorded } from "./internal/member.ts";
import type { PipeTable } from "./internal/pipeTable.ts";
import { type From, inbox, letterLine } from "./Mailbox.ts";
import { type Ask, PipeEvent, Piped, Pipes, PipesError } from "./Pipes.ts";
import { ProcessError, ProcessName, type ProcessTable } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

const tag = (word: string): string => `fab.pipes.${word}`;

const isName = Schema.is(ProcessName);
const encodePiped = Schema.encodeSync(Piped);

type Refusal = Exclude<PipesError["reason"], "storage">;

const refuse = (reason: Refusal) => new PipesError({ reason });

const storage = (cause: LedgerError | ProcessError | RelationsError | SendersError) =>
  new PipesError({ reason: "storage", cause });

/** What the look turn found: a saved pipe, answered again; an unfit one, answered and not made; or a
 *  fresh one to write, with the member its permission step checked. */
type Found = Data.TaggedEnum<{
  saved: { readonly pipe: string };
  unfit: { readonly fit: typeof Fit.Unfit.Type };
  fresh: { readonly member: Sender };
}>;

const Found = Data.taggedEnum<Found>();

/** Whether `member` holds `pipe` on this fabrika, on the relation rows of `turn`. */
type May = (turn: LedgerTurn, member: Sender) => Result.Result<boolean, RelationsError>;

/** The two ends as a program asked for them: what the answer echoes, without a hash or a shape. */
const asked = (ask: Ask) => ({
  type: "pipe",
  from: { name: ask.from.name, program: ask.from.program, output: ask.from.output },
  to: { name: ask.to.name, program: ask.to.program, input: ask.to.input },
});

/** The pipe Cmd's `ok` answer letter, in the shape the runner gives every host Cmd's answer. */
const answered = (ask: Ask, answer: typeof Piped.Type, at: number) => ({
  id: `${ask.id}/answer`,
  m: { type: "pipe_ok", cmd: asked(ask), value: encodePiped(answer), at },
});

const live = (table: ProcessTable, name: string): boolean =>
  Option.exists(table.whereis(name), ({ state }) => state._tag === "live");

/**
 * The checks after the names, in one turn and in this order: a saved pipe, a live requester, the
 * member, the two ports, neither name live, a free input, then the fit. A caller refused before the
 * ports never learns whether the two shapes fit.
 */
const look = (
  table: ProcessTable,
  pipes: PipeTable,
  turn: LedgerTurn,
  ask: Ask,
  sender: Result.Result<Option.Option<Sender>, SendersError>,
  may: May,
): Result.Result<Found, PipesError> => {
  if (Option.isSome(pipes.saved(ask.id))) {
    return Result.succeed(Found.saved({ pipe: ask.id }));
  }

  const requester = Option.getOrUndefined(table.life(ask.requester.process));

  if (requester === undefined || !table.isLive(ask.requester.process)) {
    return Result.fail(refuse("stale_sender"));
  }

  // The member behind the Cmd: the cause's sender, else the requester's recorded member (0531). A
  // pipe has no related-pair exception, so no member is `forbidden` (0551).
  const picked = pick(sender, recorded(requester));

  if (Result.isFailure(picked)) {
    const { reason } = picked.failure;
    return Result.fail(
      reason === "storage" ? storage(picked.failure) : refuse(reason === "ended" ? "stale_sender" : "forbidden"),
    );
  }

  const member = Option.getOrUndefined(picked.success);

  if (member === undefined) {
    return Result.fail(refuse("forbidden"));
  }

  const allowed = may(turn, member);

  if (Result.isFailure(allowed)) {
    return Result.fail(storage(allowed.failure));
  }

  if (!allowed.success) {
    return Result.fail(refuse("forbidden"));
  }

  // The runner leaves `shape` out for a port the program does not declare.
  if (!("shape" in ask.from) || ask.from.shape === undefined) {
    return Result.fail(refuse("no_output"));
  }

  if (!("shape" in ask.to) || ask.to.shape === undefined) {
    return Result.fail(refuse("no_input"));
  }

  // A pipe is made before its ends start (0550).
  if (live(table, ask.from.name) || live(table, ask.to.name)) {
    return Result.fail(refuse("name_taken"));
  }

  // A pipe never fans in.
  if (Option.isSome(pipes.into(ask.to.name, ask.to.input))) {
    return Result.fail(refuse("taken"));
  }

  const fit = Fit.fits(ask.from.shape, ask.to.shape);
  return Fit.Fit.match(fit, {
    fits: () => Result.succeed(Found.fresh({ member })),
    does_not_fit: (unfit) => Result.succeed(Found.unfit({ fit: unfit })),
    cannot_tell: (unfit) => Result.succeed(Found.unfit({ fit: unfit })),
  });
};

/**
 * Layer that provides `Pipes` on the ledger, through `LedgerTransaction`, `ProcessManager`,
 * `Relations` and `Senders`.
 *
 * **Details**
 *
 * `fabrika` is this fabrika's object in the permission model. Before any turn, a pipe asks `Senders`
 * who sent `from.parent` to the requester. Then it is judged in this order: the names, a saved pipe
 * under the id, a live requester, the member (the cause's sender, else the requester's recorded
 * member) with `PipePrograms` on `fabrika`, the two ports, neither name live, a free input, then
 * `Fit.fits` on the two declared shapes. A fresh pipe is written with both shapes, the rule that
 * judged it and the member checked.
 *
 * **Gotchas**
 *
 * The permission step reads the rows of the look turn, and the write turn does not check them again,
 * as a watch's does: a relation removed between the two turns does not stop that pipe. The write
 * turn checks the names again, so a name that went live in between is still `name_taken`.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (config: {
  readonly fabrika: Rebac.Ref<"fabrika">;
}): Layer.Layer<Pipes, never, LedgerTransaction | ProcessManager | Relations | Senders> =>
  Layer.effect(
    Pipes,
    Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      const manager = yield* ProcessManager;
      const relations = yield* Relations;
      const senders = yield* Senders;
      const may: May = (turn, member) =>
        Result.map(relations.within(turn), (tuples) =>
          Result.isSuccess(PipePrograms.within(tuples, member, config.fabrika)),
        );

      /** An unfit pipe's one turn: its answer in the requester's inbox, once. */
      const answer = (ask: Ask, value: typeof Piped.Type, from: From) =>
        Effect.gen(function* () {
          const letter = answered(ask, value, yield* Clock.currentTimeMillis);
          yield* tx
            .transact((turn) => {
              const life = Option.getOrUndefined(manager.table(turn).life(ask.requester.process));
              const to = inbox(life?.name ?? ask.requester.name);

              if (![...turn.read(to, 0)].some((entry) => entry.id === letter.id)) {
                turn.append(to, letter.id, letterLine(from, letter.m));
              }
            })
            .pipe(Effect.mapError(storage));
        });

      /** A fresh pipe's write turn, through the manager, which writes every brain row in it. */
      const write = Effect.fnUntraced(function* (ask: Ask, member: Sender, from: From) {
        const shape = (end: { readonly shape?: Fit.Shape }) => end.shape ?? null;
        const piped = PipeEvent.cases.piped.make({
          pipe: ask.id,
          from: { ...ask.from, shape: shape(ask.from) },
          to: { ...ask.to, shape: shape(ask.to) },
          rule: Fit.RULE,
          requester: ask.requester,
          member,
        });
        const letter = answered(ask, Piped.cases.piped.make({ pipe: ask.id }), yield* Clock.currentTimeMillis);
        yield* manager
          .pipe({ piped, answer: letter }, from)
          .pipe(
            Effect.catch((error) =>
              error instanceof ProcessError
                ? error.reason === "name_taken"
                  ? Effect.fail(refuse("name_taken"))
                  : error.reason === "ended"
                    ? Effect.fail(refuse("stale_sender"))
                    : Effect.die(new Error(`a pipe's write was refused: ${error.reason}`))
                : Effect.fail(storage(error)),
            ),
          );
      });

      const pipe = Effect.fn("pipes.pipe")(
        function* (ask: Ask, from: From) {
          yield* Effect.annotateCurrentSpan(
            short({ [tag("id")]: ask.id, [tag("from")]: ask.from.name, [tag("to")]: ask.to.name }),
          );

          if (!isName(ask.from.name) || !isName(ask.to.name) || ask.from.name === ask.to.name) {
            return yield* refuse("bad_name");
          }

          // Outside any turn, and kept as it came: it decides nothing before the saved-id check.
          const sender = yield* senders.sender(from.parent, ask.requester.process).pipe(Effect.result);
          const found = yield* tx
            .transact((turn) => look(manager.table(turn), manager.pipes(turn), turn, ask, sender, may))
            .pipe(Effect.mapError(storage), Effect.flatMap(Effect.fromResult));

          return yield* Found.$match(found, {
            saved: ({ pipe }) => Effect.succeed(Piped.cases.piped.make({ pipe })),
            unfit: ({ fit }) => {
              const value = Piped.cases.unfit.make({ fit });
              return Effect.as(answer(ask, value, from), value);
            },
            fresh: ({ member }) => Effect.as(write(ask, member, from), Piped.cases.piped.make({ pipe: ask.id })),
          });
        },
        Effect.tap((answer) => Effect.annotateCurrentSpan({ [tag("answer")]: answer._tag })),
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason }),
        ),
      );

      const list = Effect.fn("pipes.list")(function* (name: string) {
        yield* Effect.annotateCurrentSpan(short({ [tag("name")]: name }));
        return yield* tx.transact((turn) => manager.pipes(turn).list(name)).pipe(Effect.mapError(storage));
      });

      return Pipes.of({ pipe, list });
    }),
  );

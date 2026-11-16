/**
 * The `Children` layer that starts and stops a child on the ledger.
 *
 * The answer is a function of the start id's state, the process table and the relation rows, read
 * in one ledger turn: a saved id answers its `started` forever, and an unsaved one is asked afresh.
 * Only the write turn writes, and it is `ProcessManager.start`'s own: the name's registration, its
 * `started` line at the start's id and its first letter, in one turn. A start checked against a
 * member writes only under that check's proof, and its write turn checks the proof again on the
 * rows of that turn. Whatever that turn answers, the start reads again once. A stop is checked in
 * one turn and ended in `ProcessManager.exit`'s own.
 */
import { Cause, Data, Effect, Equal, Exit, Layer, Option, Result, Schema, Tracer } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { StartProgram } from "../permissions/Model.ts";
import * as Rebac from "../permissions/Rebac.ts";
import type { Tuples } from "../permissions/Relation.ts";
import { Relations, type RelationsError } from "../permissions/Relations.ts";
import { type Sender, Senders, type SendersError } from "../permissions/Senders.ts";
import { short } from "../telemetry/Trace.ts";
import { Child, Children, ChildrenError, type ChildStop, INPUT_BYTES, type StartGrant, Started } from "./Children.ts";
import { ExitReason } from "./ExitReason.ts";
import { pick, recorded } from "./internal/member.ts";
import { type From, inbox, letterLine } from "./Mailbox.ts";
import { ProcessError, ProcessName, type ProcessTable, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

const tag = (word: string): string => `fab.children.${word}`;
const permissions = (word: string): string => `fab.permissions.${word}`;

const decodeChild = Schema.decodeUnknownResult(Child);
const isName = Schema.is(ProcessName);
const decodeLetter = Schema.decodeUnknownOption(Schema.Struct({ m: Schema.Json }));

const refuse = (reason: Exclude<ChildrenError["reason"], "storage">) => new ChildrenError({ reason });
const storage = (cause: LedgerError | RelationsError | SendersError) => new ChildrenError({ reason: "storage", cause });

type Asked = Result.Result<Option.Option<Sender>, SendersError>;

/** A storage failure fails the start; any other answer, a refusal included, is kept as it came. */
const unlessStorage = (asked: Asked): Result.Result<Asked, SendersError> =>
  Result.isFailure(asked) && asked.failure.reason === "storage" ? Result.fail(asked.failure) : Result.succeed(asked);

/** The proof a start's write needs. */
type Proof = (typeof StartProgram)["Service"];

/**
 * How the permission step judged a start: `allowed` and `denied` through the model, for the member
 * checked; `granted` and `ungranted` by the host's `StartGrant`, with no member behind the start.
 */
type Judged = Data.TaggedEnum<{
  allowed: { readonly proof: Proof };
  /** The check's refusal, or none when the sender's key was removed before it could be checked. */
  denied: { readonly denied: Option.Option<Rebac.Denied> };
  granted: Record<never, never>;
  ungranted: Record<never, never>;
}>;

const Judged = Data.taggedEnum<Judged>();

/**
 * What a look turn found: the start's answer now, or a free name the write turn may take. A free
 * name always comes with the permission step's judgment, which let it through.
 */
type Found = Data.TaggedEnum<{
  answered: { readonly answer: Result.Result<Started, ChildrenError>; readonly judged: Option.Option<Judged> };
  free: { readonly judged: Judged };
}>;

const Found = Data.taggedEnum<Found>();

/** The first letter's id in the child's inbox. */
const letterId = (id: string): string => JSON.stringify(["start", id]);

const encoder = new TextEncoder();

/** Whether the first letter's row fits, counted as the ledger counts it, so it is judged at decode. */
const fits = (child: Child, from: From, m: Schema.Json): boolean => {
  const line = letterLine(from, m);
  const texts = [inbox(child.name), letterId(child.id), line.by, line.for, line.sentAt, line.parent];
  return (
    [...texts, line.traceId, line.build, line._tag, JSON.stringify(line.body)].reduce(
      (n, text) => n + (text === null ? 0 : encoder.encode(text).length),
      0,
    ) <= INPUT_BYTES
  );
};

/** What the permission step reads besides the turn: the host's grants, the rows and this fabrika. */
type Rules = {
  readonly granted: (source: string, to: string) => boolean;
  readonly tuples: (turn: LedgerTurn) => Result.Result<Tuples, RelationsError>;
  readonly fabrika: Rebac.Ref<"fabrika">;
};

/**
 * The permission step (0170, with the owner's answer (c) to its open question). The member checked
 * is `pick`'s, shared with a watch: the sender of the input that caused the start, else the
 * requester's recorded member, its process owner (0172). A member is checked with `StartProgram` on
 * this fabrika, and `StartGrant` is not read. With no member behind the start, the host's
 * `StartGrant` rule judges it, as before.
 */
const judge = (
  rules: Rules,
  turn: LedgerTurn,
  requester: { readonly program: string; readonly member: Sender | undefined },
  child: Child,
  sender: Result.Result<Option.Option<Sender>, SendersError>,
): Result.Result<Judged, Found> => {
  const picked = pick(sender, requester.member);

  if (Result.isFailure(picked)) {
    return picked.failure.reason === "ended"
      ? Result.fail(Found.answered({ answer: Result.fail(refuse("stale_sender")), judged: Option.none() }))
      : Result.fail(
          Found.answered({
            answer: Result.fail(refuse("forbidden")),
            judged: Option.some(Judged.denied({ denied: Option.none() })),
          }),
        );
  }

  const member = Option.getOrUndefined(picked.success);

  if (member === undefined) {
    return rules.granted(requester.program, child.code.program)
      ? Result.succeed(Judged.granted())
      : Result.fail(
          Found.answered({ answer: Result.fail(refuse("forbidden")), judged: Option.some(Judged.ungranted()) }),
        );
  }

  const tuples = rules.tuples(turn);

  if (Result.isFailure(tuples)) {
    return Result.fail(Found.answered({ answer: Result.fail(storage(tuples.failure)), judged: Option.none() }));
  }

  const checked = StartProgram.within(tuples.success, member, rules.fabrika);
  return Result.isSuccess(checked)
    ? Result.succeed(Judged.allowed({ proof: checked.success }))
    : Result.fail(
        Found.answered({
          answer: Result.fail(refuse("forbidden")),
          judged: Option.some(Judged.denied({ denied: Option.some(checked.failure) })),
        }),
      );
};

/**
 * The checks after decoding, in one turn and in this order: a saved start, the requester, the
 * permission step, then whereis.
 */
const answer = (
  table: ProcessTable,
  turn: LedgerTurn,
  child: Child,
  rules: Rules,
  sender: Result.Result<Option.Option<Sender>, SendersError>,
): Found => {
  const saved = Option.getOrUndefined(table.saved(child.id));

  if (saved !== undefined) {
    const letter = [...turn.read(inbox(saved.name), 0)].find((e) => e.id === letterId(child.id));
    const m = letter === undefined ? Option.none() : Option.map(decodeLetter(letter.body), (body) => body.m);
    // The caller fields: name, program, requester and input, never the hash, so a rebuild retries alike.
    const same =
      saved.request._tag === "first" &&
      saved.name === child.name &&
      saved.request.code.program === child.code.program &&
      saved.request.requester?._tag === "process" &&
      saved.request.requester.process === child.requester.process &&
      (child.input === undefined ? Option.isNone(m) : Option.exists(m, (value) => Equal.equals(value, child.input)));
    return Found.answered({
      answer: same
        ? Result.succeed(Started.cases.started.make({ process: saved.state.process, name: saved.name, rev: saved.rev }))
        : Result.fail(refuse("id_reused")),
      judged: Option.none(),
    });
  }

  const requester = Option.getOrUndefined(table.life(child.requester.process));

  if (requester === undefined || !table.isLive(child.requester.process)) {
    return Found.answered({ answer: Result.fail(refuse("stale_sender")), judged: Option.none() });
  }

  // A refused start learns nothing of a name, its own included.
  const judged = judge(
    rules,
    turn,
    { program: requester.state.code.program, member: recorded(requester) },
    child,
    sender,
  );

  if (Result.isFailure(judged)) {
    return judged.failure;
  }

  return Option.match(table.whereis(child.name), {
    onNone: () => Found.free({ judged: judged.success }),
    onSome: ({ program, state }) => {
      const life = { process: state.process, name: child.name };
      return Found.answered({
        answer:
          program !== child.code.program
            ? Result.fail(refuse("name_taken"))
            : Result.succeed(
                state._tag === "live"
                  ? Started.cases.already_started.make(life)
                  : Started.cases.already_present.make(life),
              ),
        judged: Option.some(judged.success),
      });
    },
  });
};

/** The span's record of the permission step: who was checked, for what, on which object, and how. */
const shown = (judged: Judged): Record<string, string> =>
  Judged.$match(judged, {
    allowed: ({ proof }) => ({
      [permissions("subject")]: `person:${proof.sender.for}`,
      [permissions("permission")]: proof.permission,
      [permissions("object")]: proof.object,
      [permissions("outcome")]: "allowed",
    }),
    denied: ({ denied }) =>
      Option.match(denied, {
        onNone: () => ({ [permissions("outcome")]: "denied" }),
        onSome: ({ subject, permission, object }) => ({
          [permissions("subject")]: subject,
          [permissions("permission")]: permission,
          [permissions("object")]: object,
          [permissions("outcome")]: "denied",
        }),
      }),
    granted: () => ({ [permissions("outcome")]: "granted" }),
    ungranted: () => ({ [permissions("outcome")]: "ungranted" }),
  });

/**
 * A stop's checks, in one turn: the name must be a child the requester's name started, then live.
 * Answers the child's life to end.
 */
const stopped = (table: ProcessTable, stop: ChildStop): Result.Result<string, ChildrenError> => {
  const requester = Option.getOrUndefined(table.life(stop.requester.process));
  const own =
    isName(stop.name) &&
    requester !== undefined &&
    Option.exists(table.starter(stop.name), (name) => name === requester.name);
  const current = own ? Option.getOrUndefined(table.whereis(stop.name)) : undefined;

  if (current === undefined) {
    return Result.fail(refuse("not_child"));
  }

  return current.state._tag === "live" ? Result.succeed(current.state.process) : Result.fail(refuse("noproc"));
};

/** Keeps a storage failure's cause with the caller: every nested span records only the safe reason,
 *  and a defect is replaced by a plain one with no detail. */
const guarded = <A>(work: Effect.Effect<A, ChildrenError>, defect: string) =>
  Effect.gen(function* () {
    const tracer = yield* Tracer.Tracer;
    const safe = Tracer.make({
      context: tracer.context,
      span(options) {
        const span = tracer.span(options);
        const attribute = span.attribute.bind(span);
        span.attribute = (key, value) => {
          if (key !== "fab.ledger.code") {
            attribute(key, key === "error.type" ? "ChildrenError" : value);
          }
        };
        const end = span.end.bind(span);
        span.end = (time, exit) => {
          const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
          end(
            time,
            Exit.isSuccess(exit)
              ? exit
              : Exit.fail(
                  new ChildrenError({
                    reason:
                      Option.isSome(error) && error.value instanceof ChildrenError ? error.value.reason : "storage",
                  }),
                ),
          );
        };
        return span;
      },
    });
    return yield* work.pipe(
      Effect.withTracer(safe),
      Effect.catchCauseIf(Cause.hasDies, () => Effect.die(new Error(defect))),
    );
  });

/**
 * Layer that provides `Children` on the ledger, through `LedgerTransaction`, `ProcessManager`,
 * `Relations` and `Senders`.
 *
 * **Details**
 *
 * `fabrika` is this fabrika's object in the permission model. `grants` is the host's closed list of
 * which program may start which, read only for a start with no member behind it. Before any turn,
 * a start asks `Senders` who sent `from.parent` to the requester; a `storage` failure fails the
 * start. Then it is judged in this order: the name, the rest of the request, a saved `id`, a live
 * requester, the permission step, then the name's current holder. The permission step checks the
 * sender, else the requester's recorded member, with `StartProgram` on `fabrika`: `Denied` and a
 * removed key are `forbidden`, and a cause delivered to a process that ended is `stale_sender`. With
 * no member, a requester with no grant is `forbidden`. A refusal comes before the requester can
 * learn whether a name exists. A member's start writes `member` on its `started` line, and its write
 * turn checks the proof again on that turn's rows: a relation removed in between refuses it
 * `forbidden`, with nothing written.
 *
 * A stop ends the child with `shutdown` through `ProcessManager.exit`, which writes each watcher's
 * `DOWN`. A child that ends between the check and the exit is `noproc`.
 *
 * **Gotchas**
 *
 * A storage failure's cause goes to the caller only. The spans of a start record the reason and
 * the permission step's ids, never the cause, and a defect inside a start is replaced by a plain
 * one with no detail. A key removed after `Senders` answered is not seen by that start.
 *
 * @category layers
 */
export const layer = (config: {
  readonly grants: ReadonlyArray<typeof StartGrant.Type>;
  readonly fabrika: Rebac.Ref<"fabrika">;
}): Layer.Layer<Children, never, LedgerTransaction | ProcessManager | Relations | Senders> =>
  Layer.effect(
    Children,
    Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      const manager = yield* ProcessManager;
      const relations = yield* Relations;
      const senders = yield* Senders;
      const rules: Rules = {
        granted: (source, to) => config.grants.some((g) => g.source === source && g.to === to),
        tuples: relations.within,
        fabrika: config.fabrika,
      };
      const look = (child: Child, sender: Result.Result<Option.Option<Sender>, SendersError>) =>
        tx.transact((turn) => answer(manager.table(turn), turn, child, rules, sender)).pipe(Effect.mapError(storage));
      const first = (child: Child) => (child.input === undefined ? undefined : { m: child.input });

      /** A member's start: its write needs the proof, names the member, and checks the proof again in its turn. */
      const place = Effect.fnUntraced(function* (child: Child, from: From) {
        const proof = yield* StartProgram;
        return yield* manager.start(
          Start.cases.first.make({
            id: child.id,
            name: child.name,
            code: child.code,
            requester: child.requester,
            member: proof.sender,
          }),
          from,
          first(child),
          (turn) =>
            Result.match(relations.within(turn), {
              onSuccess: (tuples) => Rebac.recheck(proof, tuples),
              onFailure: () => false,
            }),
        );
      });

      /** The write turn, under the proof when a member was checked, else as the host's grant allows. */
      const write = (child: Child, from: From, judged: Judged) =>
        judged._tag === "allowed"
          ? place(child, from).pipe(Rebac.provide(judged.proof))
          : manager.start(
              Start.cases.first.make({ id: child.id, name: child.name, code: child.code, requester: child.requester }),
              from,
              first(child),
            );

      const start = Effect.fn("children.start")(
        function* (input: Child, from: From) {
          // Decode first: the name is judged before any other field.
          if (!isName((input as { readonly name?: unknown } | undefined)?.name)) {
            return yield* refuse("bad_name");
          }

          const decoded = decodeChild(input);

          if (
            Result.isFailure(decoded) ||
            (decoded.success.input !== undefined && !fits(decoded.success, from, decoded.success.input))
          ) {
            return yield* refuse("bad_input");
          }

          const child = decoded.success;
          yield* Effect.annotateCurrentSpan(
            short({
              [tag("name")]: child.name,
              [tag("program")]: child.code.program,
              [tag("hash")]: child.code.hash,
            }),
          );
          // Outside any turn, and kept as it came: it decides nothing before the saved-id check.
          const sender = yield* senders
            .sender(from.parent, child.requester.process)
            .pipe(Effect.result, Effect.filterMapOrFail(unlessStorage, storage));

          // Two passes at most: after the write turn the id is saved, the name is taken, or the
          // requester has ended, so the second pass always answers.
          for (let pass = 1; ; pass++) {
            const found = yield* look(child, sender);
            const judged = found._tag === "free" ? Option.some(found.judged) : found.judged;

            if (Option.isSome(judged)) {
              yield* Effect.annotateCurrentSpan(shown(judged.value));
            }

            if (found._tag === "answered") {
              return yield* Effect.fromResult(found.answer);
            }

            if (pass > 1) {
              return yield* Effect.die(new Error("a start found its name free after its write turn"));
            }

            // Placed or refused, the next pass reads what the write turn left; a guard that said no
            // is the answer now.
            const refused = yield* write(child, from, found.judged).pipe(
              Effect.as(false),
              Effect.catch((error) =>
                error instanceof ProcessError
                  ? Effect.succeed(error.reason === "forbidden")
                  : // The ledger refuses a first letter over its row limit, and the whole turn with it.
                    Effect.fail(error.reason === "refused" ? refuse("bad_input") : storage(error)),
              ),
            );

            if (refused) {
              yield* Effect.annotateCurrentSpan({ [permissions("outcome")]: "denied" });
              return yield* refuse("forbidden");
            }
          }
        },
        Effect.tap((started) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: started._tag, "fab.process": started.process }),
        ),
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason }),
        ),
      );
      const stop = Effect.fn("children.stop")(
        function* (asked: ChildStop, from: From) {
          yield* Effect.annotateCurrentSpan(short({ [tag("name")]: asked.name }));
          const child = yield* tx
            .transact((turn) => stopped(manager.table(turn), asked))
            .pipe(Effect.mapError(storage), Effect.flatMap(Effect.fromResult));
          yield* manager
            .exit(child, ExitReason.cases.shutdown.make({}), from)
            .pipe(
              Effect.catch((error) =>
                error instanceof ProcessError
                  ? error.reason === "ended"
                    ? Effect.fail(refuse("noproc"))
                    : Effect.die(new Error(`a stop's exit was refused: ${error.reason}`))
                  : Effect.fail(storage(error)),
              ),
            );
        },
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: error.reason }),
        ),
      );
      return Children.of({
        start: (input, from) => guarded(start(input, from), "children.start failed"),
        stop: (asked, from) => guarded(stop(asked, from), "children.stop failed"),
      });
    }),
  );

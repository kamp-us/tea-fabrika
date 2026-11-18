// Slice 1 of the kalfa program plan, next/. Laws P1 and P2: the local patch on tea 0.29.0
// (`patches/@demlik__tea@0.29.0.patch`) carries demlik pulls 982 and 983 as demlik main has them
// (kamp-us/demlik 48b1058, packages/tea/src). The law walks a real Effect engine on a logged store
// over one memory journal, restarted between moves. Its moves come from a Schema (0579), and each
// one is played only when what is owed then allows it, as fast-check's `fc.commands` plays a command
// only when its `check` holds.
//
// P1, after pull 982: `owed` and `Owed` are root exports (index.ts:56, :108). A Cmd handler that
// answers `owed()` marks its call owed (internal/engine/loop.ts:845-856), so the delivery is never
// confirmed (:969). It stays in the logged store's ledger, and the next start hands it out again
// with its first delivery id (:920-923, runDeliveries).
// P2, after pull 983: `dispatch(answer, { answerTo: id })` writes one message record that carries
// `answerTo`, and that record is the receipt (durable-log/format.ts:84-85, projection.ts:264), so
// the owed entry clears with no `confirmed` record. A second answer to the same id is a repeat
// (durable-log/operations.ts:34, :217): it resolves, writes nothing and folds nothing, in the same
// process or after a restart. An id that was never owed is refused before any write (:30-32,
// `unknown_answer`). demlik's own law for both: per-call-host.fixture.ts:633.
//
// Plants, each run once against the installed tea and undone (the run row records them):
// (a) the plain 0.29.0 dist in place of the patched one, so `owed` is no export;
// (b) the completion confirms an owed call (`!own.owed` dropped from loop.ts:969's line);
// (c) boot hands no surviving delivery out (`publishLogged` given `[]` in place of the ledger's list);
// (d) the answer's message record loses `answerTo`, so nothing clears the entry;
// (e) a repeat answer is refused (`atomic` decided as `unknown_answer`);
// (f) an id never owed is taken as a repeat (`missing` with no delivery decided as `repeat`).
import { deliveryIdOf, logLedger, owed, type Owed } from "@demlik/tea";
import { Cmd, Machine, run } from "@demlik/tea/effect";
import { memoryJournal } from "@demlik/tea/mem";
import { eventSourcedStore } from "@demlik/tea/persistence";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Cause, Effect, Exit, Match, Predicate, Result, Schema, Scope, type Types } from "effect";

const Model = Schema.Struct({ started: Schema.Array(Schema.Int), settled: Schema.Array(Schema.String) });

const Msg = Schema.TaggedUnion({ start: { value: Schema.Int } });

const Unavailable = Schema.TaggedStruct("unavailable", {});

const job = Cmd.make("job", { input: Schema.Struct({ value: Schema.Int }), ok: Schema.Int, err: ["unavailable"] });

const Job = Schema.TaggedStruct("job", { value: Schema.Int });

/** Every Msg the log admits: the fresh `start`, and the answers the engine or a later call writes. */
const Logged = Schema.Union([
  Msg.cases.start,
  Schema.TaggedStruct("job_ok", { cmd: Job, value: Schema.Int, at: Schema.Number }),
  Schema.TaggedStruct("job_err", { cmd: Job, error: Schema.Struct({ _tag: Schema.String }), at: Schema.Number }),
]);

/** tea's store reads a schema through `safeParse`; this reads an Effect Schema that way. */
const teaSchema = <A>(schema: Schema.Codec<A, unknown>) => ({
  safeParse: (raw: unknown) =>
    Result.match(Schema.decodeUnknownResult(schema)(raw), {
      onSuccess: (data) => ({ success: true as const, data }),
      onFailure: () => ({ success: false as const }),
    }),
});

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [job],
  init: (loaded) => [loaded ?? { started: [], settled: [] }, []],
  update: {
    start: (s, m) => [{ ...s, started: [...s.started, m.value] }, [job({ value: m.value })]],
    job_ok: (s, m) => [{ ...s, settled: [...s.settled, `ok:${m.cmd.value}:${m.value}`] }, []],
    job_err: (s, m) => [{ ...s, settled: [...s.settled, `err:${m.cmd.value}:${m.error._tag}`] }, []],
  },
});

const Reply = {
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  err: Schema.Boolean,
  value: Schema.Int.check(Schema.isBetween({ minimum: -1000, maximum: 1000 })),
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 ** 40 })),
};

/**
 * One move of a walk. A start's handler ends with its value or owed for a later call; a repeat
 * picks among the three newest answers, so one in the same start is as likely as one after a restart.
 */
const Move = Schema.TaggedUnion({
  start: { ending: Schema.Literals(["done", "owed"]) },
  restart: {},
  answer: Reply,
  again: { ...Reply, pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })) },
  stranger: { offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })) },
});

type Move = typeof Move.Type;

/** A walk of 10 to 40 moves: long enough to owe, answer, restart and repeat in one case. */
const Moves = Schema.Array(Move).check(Schema.isMinLength(10), Schema.isMaxLength(40));

/** One delivery the handler was handed: its id and the Cmd's value. */
interface Handed {
  readonly id: number;
  readonly value: number;
}

/** A promise the law waits on rejected: the law's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise of tea's store or journal inside the law's Effect. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

const storeOn = (journal: ReturnType<typeof memoryJournal>) =>
  eventSourcedStore(journal, { state: teaSchema(Model), message: teaSchema(Logged), command: teaSchema(Job) });

/** One start of the engine on `store`, in a scope of its own, run until it is idle. */
const boot = (
  store: ReturnType<typeof storeOn>,
  handle: (cmd: { readonly value: number }, ctx: unknown) => Effect.Effect<number | Owed>,
  errors: unknown[],
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();

    const booting = yield* run(machine, {
      store,
      onError: (error) => {
        errors.push(error);
      },
      interpret: { job: handle },
    }).pipe(Scope.provide(scope));

    const live = yield* booting.ready;
    yield* live.idle();

    return { scope, live };
  });

type Started = Effect.Success<ReturnType<typeof boot>>;

/** The real engine and its journal. One store per start, as a host that ends each call has. */
class World {
  readonly journal = memoryJournal();
  readonly plan = new Map<number, "done" | "owed">();
  readonly handed: Handed[] = [];
  readonly errors: unknown[] = [];
  store = storeOn(this.journal);
  started: Started | undefined;

  /** The handler: a `done` job answers its value times ten, an `owed` one answers `owed()`. */
  readonly handle = (cmd: { readonly value: number }, ctx: unknown): Effect.Effect<number | Owed> => {
    const id = deliveryIdOf(ctx);
    expect(id, "a logged call carries its delivery id").toBeTypeOf("number");
    this.handed.push({ id: id ?? -1, value: cmd.value });

    return Effect.succeed(this.plan.get(cmd.value) === "done" ? cmd.value * 10 : owed());
  };

  boot() {
    return Effect.map(boot(this.store, this.handle, this.errors), (started) => {
      this.started = started;
    });
  }

  stop() {
    return Effect.suspend(() => {
      const started = this.started;
      this.started = undefined;

      return started === undefined
        ? Effect.void
        : Effect.andThen(started.live.stop(), Scope.close(started.scope, Exit.void));
    });
  }

  get live() {
    expect(this.started, "the world has a started engine").toBeDefined();

    return this.started!.live;
  }

  /** Runs one engine call, then waits until the engine is idle. */
  send(effect: Effect.Effect<void, unknown>) {
    return Effect.tap(Effect.exit(effect), () => this.live.idle());
  }

  surviving() {
    return Effect.map(
      promised(() => this.store.readLog()),
      (log) => logLedger(log).surviving(),
    );
  }

  records() {
    return Effect.map(
      promised(() => this.store.readLog()),
      (log) => log.records.map(({ record }) => record),
    );
  }
}

/** What the law expects, folded from the moves alone. */
interface Expected {
  next: number;
  readonly settled: string[];
  owed: Handed[];
  readonly answered: Array<Handed & { cold: boolean }>;
}

const ids = (list: ReadonlyArray<{ readonly id: number }>) => list.map(({ id }) => id);

/** The refusal tags a failed call carries: tea refuses an admission with an Error whose `cause` is
 *  the refusal (loop.ts:1110-1113), and the Effect engine hands that Error back as a defect. */
const refusals = (exit: Exit.Exit<void, unknown>): ReadonlyArray<unknown> =>
  Exit.isFailure(exit)
    ? exit.cause.reasons.flatMap((reason) => {
        const thrown = Cause.isDieReason(reason) ? reason.defect : Cause.isFailReason(reason) ? reason.error : null;

        return Predicate.hasProperty(thrown, "cause") && Predicate.hasProperty(thrown.cause, "_tag")
          ? [thrown.cause._tag]
          : [];
      })
    : [];

/** The cases the walks must reach, filled by the walks and read by the coverage law after them. */
const reached = new Set<string>();

const start = (m: Expected, w: World, ending: "done" | "owed") =>
  Effect.gen(function* () {
    const value = m.next++;
    w.plan.set(value, ending);
    const before = w.handed.length;
    expect(Exit.isSuccess(yield* w.send(w.live.dispatch(Msg.cases.start.make({ value }))))).toBe(true);
    const fresh = w.handed.slice(before);
    expect(
      fresh.map((h) => h.value),
      "the start hands its job out once",
    ).toEqual([value]);

    if (ending === "owed") {
      m.owed.push(fresh[0]!);
      reached.add("owed");
    } else {
      m.settled.push(`ok:${value}:${value * 10}`);
    }

    expect(ids(yield* w.surviving()), "P1: an owed job stays in the ledger").toEqual(ids(m.owed));
    expect(w.live.getState().settled).toEqual(m.settled);
  });

const restart = (m: Expected, w: World) =>
  Effect.gen(function* () {
    yield* w.stop();
    w.store = storeOn(w.journal);
    const before = w.handed.length;
    yield* w.boot();
    expect(w.handed.slice(before), "P1: the next start hands each owed job out again, with its first id").toEqual(
      m.owed,
    );
    expect(ids(yield* w.surviving())).toEqual(ids(m.owed));
    expect(w.live.getState().settled).toEqual(m.settled);

    if (m.owed.length > 0) {
      reached.add("handed again");
    }

    for (const a of m.answered) {
      a.cold = true;
    }
  });

const answer = (m: Expected, w: World, { pick, err, value, at }: Types.ExtractTag<Move, "answer">) =>
  Effect.gen(function* () {
    const entry = m.owed[pick % m.owed.length]!;
    const persisted = (yield* w.surviving()).find((d) => d.id === entry.id);
    expect(persisted, `delivery ${entry.id} is owed`).toBeDefined();
    const cmd = persisted!.effect;
    const before = (yield* w.records()).length;
    const reply = err ? job.err(cmd, Unavailable.make({}), at) : job.ok(cmd, value, at);
    expect(
      Exit.isSuccess(yield* w.send(w.live.dispatch(reply, { answerTo: entry.id }))),
      "P2: the answer is admitted",
    ).toBe(true);
    m.owed = m.owed.filter((h) => h.id !== entry.id);
    m.answered.push({ ...entry, cold: false });
    m.settled.push(err ? `err:${entry.value}:unavailable` : `ok:${entry.value}:${value}`);
    reached.add("answered");
    expect(w.live.getState().settled, "P2: the answer folds once").toEqual(m.settled);
    expect(ids(yield* w.surviving()), "P2: the answer clears its owed entry").toEqual(ids(m.owed));
    const added = (yield* w.records()).slice(before);
    expect(
      added.filter((r) => r._tag === "message" && r.answerTo === entry.id),
      "P2: one message record carries the answer and its receipt",
    ).toHaveLength(1);
    expect(
      added.filter((r) => r._tag === "confirmed"),
      "P2: no separate confirmation is written",
    ).toEqual([]);
  });

const again = (m: Expected, w: World, { pick, err, value, at }: Types.ExtractTag<Move, "again">) =>
  Effect.gen(function* () {
    // Newest first, so a repeat in the same start is as likely as one after a restart.
    const entry = m.answered[m.answered.length - 1 - (pick % m.answered.length)]!;
    const before = yield* w.records();
    const cmd = job({ value: entry.value });
    const reply = err ? job.err(cmd, Unavailable.make({}), at) : job.ok(cmd, value, at);
    expect(Exit.isSuccess(yield* w.send(w.live.dispatch(reply, { answerTo: entry.id }))), "P2: a repeat resolves").toBe(
      true,
    );
    expect(yield* w.records(), "P2: a repeat answer writes nothing").toEqual(before);
    expect(w.live.getState().settled, "P2: a repeat answer folds nothing").toEqual(m.settled);
    reached.add(entry.cold ? "repeat after restart" : "repeat");
  });

const stranger = (m: Expected, w: World, offset: number) =>
  Effect.gen(function* () {
    const id = Math.max(0, ...ids(w.handed)) + 1 + offset;
    const before = yield* w.records();
    const exit = yield* w.send(w.live.dispatch(job.ok(job({ value: 0 }), 1, 1), { answerTo: id }));
    expect(refusals(exit), "P2: an id never owed is refused as unknown_answer").toEqual(["unknown_answer"]);
    expect(yield* w.records(), "P2: a refused answer writes nothing").toEqual(before);
    expect(w.live.getState().settled).toEqual(m.settled);
    reached.add("refused");
  });

/** Plays one move, or skips it when nothing is owed or answered for it to act on. */
const play = (m: Expected, w: World, move: Move) =>
  Match.value(move).pipe(
    Match.tagsExhaustive({
      start: ({ ending }) => start(m, w, ending),
      restart: () => restart(m, w),
      answer: (a) => (m.owed.length > 0 ? answer(m, w, a) : Effect.void),
      again: (a) => (m.answered.length > 0 ? again(m, w, a) : Effect.void),
      stranger: ({ offset }) => stranger(m, w, offset),
    }),
  );

describe("P1 and P2 the patched tea hands owed work out again and takes its answer later", () => {
  it.effect.prop(
    "P1 and P2: owed work stays owed and is handed out again with its first id; one answer clears it, a repeat writes nothing, a stranger is refused",
    { moves: Moves },
    ({ moves }) =>
      Effect.gen(function* () {
        expectTypeOf(owed()).toEqualTypeOf<Owed>();
        const world = new World();
        const expected: Expected = { next: 1, settled: [], owed: [], answered: [] };
        yield* Effect.addFinalizer(() =>
          world.stop().pipe(Effect.andThen(promised(() => world.journal.close())), Effect.orDie),
        );
        yield* world.boot();

        for (const move of moves) {
          yield* play(expected, world, move);
        }

        expect(world.errors, "no handler or store error reached onError").toEqual([]);
      }),
    { arbitrary: { runs: runsFor({ fast: 20, full: 100 }) } },
  );

  // Coverage: the walks above must reach each case at least once, or the law proved less than it says.
  it("scenario: P1 and P2's generated walks reached an owed job, a second hand-out, an answer, a repeat in the same start and after a restart, and a refusal", () => {
    for (const name of ["owed", "handed again", "answered", "repeat", "repeat after restart", "refused"]) {
      expect(reached, `no run reached: ${name}`).toContain(name);
    }
  });
});

// Slice 1 of the kalfa program plan, next/. Laws P1 and P2: the local patch on tea 0.29.0
// (`patches/@demlik__tea@0.29.0.patch`) carries demlik pulls 982 and 983 as demlik main has them
// (kamp-us/demlik 48b1058, packages/tea/src). The law walks a real Effect engine on a logged store
// over one memory journal, restarted between moves, and picks each move from what is owed then.
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
import { Cause, Effect, Exit, Predicate, Result, Schema, Scope } from "effect";
import * as fc from "fast-check";

const CHECK = { seed: 119120, numRuns: runsFor({ fast: 20, full: 100 }) };

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

/** The way a started job's handler ends: with its value, or owed for a later call to answer. */
type Ending = "done" | "owed";

/** One delivery the handler was handed: its id and the Cmd's value. */
interface Handed {
  readonly id: number;
  readonly value: number;
}

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
  readonly plan = new Map<number, Ending>();
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

  async boot() {
    this.started = await Effect.runPromise(boot(this.store, this.handle, this.errors));
  }

  async stop() {
    const started = this.started;
    this.started = undefined;

    if (started !== undefined) {
      await Effect.runPromise(started.live.stop());
      await Effect.runPromise(Scope.close(started.scope, Exit.void));
    }
  }

  get live() {
    expect(this.started, "the world has a started engine").toBeDefined();

    return this.started!.live;
  }

  /** Runs one engine call, then waits until the engine is idle. */
  async send(effect: Effect.Effect<void, unknown>) {
    const exit = await Effect.runPromiseExit(effect);
    await Effect.runPromise(this.live.idle());

    return exit;
  }

  async surviving() {
    return logLedger(await this.store.readLog()).surviving();
  }

  async records() {
    return (await this.store.readLog()).records.map(({ record }) => record);
  }
}

/** What the law expects, folded from the moves alone. */
interface Expected {
  next: number;
  readonly settled: string[];
  owed: Handed[];
  readonly answered: Array<Handed & { cold: boolean }>;
  readonly reached: Set<string>;
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

const start = (ending: Ending): fc.AsyncCommand<Expected, World> => ({
  check: () => true,
  toString: () => `start ${ending}`,
  run: async (m, w) => {
    const value = m.next++;
    w.plan.set(value, ending);
    const before = w.handed.length;
    expect(Exit.isSuccess(await w.send(w.live.dispatch(Msg.cases.start.make({ value }))))).toBe(true);
    const fresh = w.handed.slice(before);
    expect(
      fresh.map((h) => h.value),
      "the start hands its job out once",
    ).toEqual([value]);

    if (ending === "owed") {
      m.owed.push(fresh[0]!);
      m.reached.add("owed");
    } else {
      m.settled.push(`ok:${value}:${value * 10}`);
    }

    expect(ids(await w.surviving()), "P1: an owed job stays in the ledger").toEqual(ids(m.owed));
    expect(w.live.getState().settled).toEqual(m.settled);
  },
});

const restart: fc.AsyncCommand<Expected, World> = {
  check: () => true,
  toString: () => "restart",
  run: async (m, w) => {
    await w.stop();
    w.store = storeOn(w.journal);
    const before = w.handed.length;
    await w.boot();
    expect(w.handed.slice(before), "P1: the next start hands each owed job out again, with its first id").toEqual(
      m.owed,
    );
    expect(ids(await w.surviving())).toEqual(ids(m.owed));
    expect(w.live.getState().settled).toEqual(m.settled);

    if (m.owed.length > 0) {
      m.reached.add("handed again");
    }

    for (const a of m.answered) {
      a.cold = true;
    }
  },
};

const answer = (pick: number, err: boolean, value: number, at: number): fc.AsyncCommand<Expected, World> => ({
  check: (m) => m.owed.length > 0,
  toString: () => `answer ${pick} ${err ? "err" : value}`,
  run: async (m, w) => {
    const entry = m.owed[pick % m.owed.length]!;
    const persisted = (await w.surviving()).find((d) => d.id === entry.id);
    expect(persisted, `delivery ${entry.id} is owed`).toBeDefined();
    const cmd = persisted!.effect;
    const before = (await w.records()).length;
    const reply = err ? job.err(cmd, Unavailable.make({}), at) : job.ok(cmd, value, at);
    expect(
      Exit.isSuccess(await w.send(w.live.dispatch(reply, { answerTo: entry.id }))),
      "P2: the answer is admitted",
    ).toBe(true);
    m.owed = m.owed.filter((h) => h.id !== entry.id);
    m.answered.push({ ...entry, cold: false });
    m.settled.push(err ? `err:${entry.value}:unavailable` : `ok:${entry.value}:${value}`);
    m.reached.add("answered");
    expect(w.live.getState().settled, "P2: the answer folds once").toEqual(m.settled);
    expect(ids(await w.surviving()), "P2: the answer clears its owed entry").toEqual(ids(m.owed));
    const added = (await w.records()).slice(before);
    expect(
      added.filter((r) => r._tag === "message" && r.answerTo === entry.id),
      "P2: one message record carries the answer and its receipt",
    ).toHaveLength(1);
    expect(
      added.filter((r) => r._tag === "confirmed"),
      "P2: no separate confirmation is written",
    ).toEqual([]);
  },
});

const again = (pick: number, err: boolean, value: number, at: number): fc.AsyncCommand<Expected, World> => ({
  check: (m) => m.answered.length > 0,
  toString: () => `answer again ${pick} ${err ? "err" : value}`,
  run: async (m, w) => {
    // Newest first, so a repeat in the same start is as likely as one after a restart.
    const entry = m.answered[m.answered.length - 1 - (pick % m.answered.length)]!;
    const before = await w.records();
    const cmd = job({ value: entry.value });
    const reply = err ? job.err(cmd, Unavailable.make({}), at) : job.ok(cmd, value, at);
    expect(Exit.isSuccess(await w.send(w.live.dispatch(reply, { answerTo: entry.id }))), "P2: a repeat resolves").toBe(
      true,
    );
    expect(await w.records(), "P2: a repeat answer writes nothing").toEqual(before);
    expect(w.live.getState().settled, "P2: a repeat answer folds nothing").toEqual(m.settled);
    m.reached.add(entry.cold ? "repeat after restart" : "repeat");
  },
});

const stranger = (offset: number): fc.AsyncCommand<Expected, World> => ({
  check: () => true,
  toString: () => `answer a stranger +${offset}`,
  run: async (m, w) => {
    const id = Math.max(0, ...ids(w.handed)) + 1 + offset;
    const before = await w.records();
    const exit = await w.send(w.live.dispatch(job.ok(job({ value: 0 }), 1, 1), { answerTo: id }));
    expect(refusals(exit), "P2: an id never owed is refused as unknown_answer").toEqual(["unknown_answer"]);
    expect(await w.records(), "P2: a refused answer writes nothing").toEqual(before);
    expect(w.live.getState().settled).toEqual(m.settled);
    m.reached.add("refused");
  },
});

const answers = (pick: fc.Arbitrary<number>) =>
  fc.tuple(pick, fc.boolean(), fc.integer({ min: -1000, max: 1000 }), fc.nat({ max: 2 ** 40 }));

// Starts and answers are listed twice, so a walk owes and answers more often than it restarts.
const moves = fc.commands(
  [
    fc.constantFrom<Ending>("done", "owed", "owed").map(start),
    fc.constantFrom<Ending>("owed").map(start),
    fc.constant(restart),
    answers(fc.nat()).map((a) => answer(...a)),
    answers(fc.nat()).map((a) => answer(...a)),
    answers(fc.nat({ max: 2 })).map((a) => again(...a)),
    answers(fc.nat({ max: 2 })).map((a) => again(...a)),
    fc.nat({ max: 50 }).map(stranger),
  ],
  { maxCommands: 40, size: "large" },
);

describe("P1 and P2 the patched tea hands owed work out again and takes its answer later", () => {
  it("P1 and P2: owed work stays owed and is handed out again with its first id; one answer clears it, a repeat writes nothing, a stranger is refused", async () => {
    expectTypeOf(owed()).toEqualTypeOf<Owed>();
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(moves, async (list) => {
        const world = new World();
        const expected: Expected = { next: 1, settled: [], owed: [], answered: [], reached };
        await world.boot();

        try {
          await fc.asyncModelRun(() => ({ model: expected, real: world }), list);
          expect(world.errors, "no handler or store error reached onError").toEqual([]);
        } finally {
          await world.stop();
          await world.journal.close();
        }
      }),
      CHECK,
    );

    for (const name of ["owed", "handed again", "answered", "repeat", "repeat after restart", "refused"]) {
      expect(reached, `no run reached: ${name}`).toContain(name);
    }
  });
});

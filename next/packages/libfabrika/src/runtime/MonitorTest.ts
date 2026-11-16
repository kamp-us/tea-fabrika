// Program watch (docs/plan/quests/watch-PLAN.md), next/: the built-in `monitor` and `demonitor` Cmds on
// real runners, laws M2, M3, M7, M8, M9, M10 and M15, and no driver. A runner in the module that owns a
// driver calls `MonitorTest.suite(open)`; `open` acquires real stores in a scope and gives them back
// when that scope closes (0061, 0062).
//
// The runner, ledger, process table, mailbox, program mail, the brain's `Monitors` service and the
// reader program are real. The watched processes have no runner: the walk plays them through the
// brain's own calls, as their runners would make them. A watched life mails a reader through
// `ProgramMail.deliver`, and its supervision ends it with `ProcessManager.exit`, with any reason.
// Every cut lands at a reachable boundary, through a test layer around `Monitors`:
//
//   race         the brain's monitor turn commits, and the watched life ends before the runner goes on
//   lose_after   the brain's monitor turn commits, its reply is lost, and the call reaches the brain
//                again under the same id, one to three times
//   overtake     the brain's monitor turn commits, and another call's catch-up folds the saved answer
//                before the runner's own settle does
//   gate         a demonitor is held after it was dispatched, while the watched life ends
//   cut          the ledger fails the write of a DOWN once, and with it the exit's turn
//   reopen       the host goes away and comes back on the same stores
//
// The contract these laws pin, from the plan:
//   Monitor.ts: `monitor`, `Cmd.make("monitor", { input: {name}, ok: Monitored, err: MonitorRefusal })`,
//     and `demonitor`, `Cmd.make("demonitor", { input: {ref}, ok: null, err: [] })`.
//   Monitors.ts: the `Monitors` service and `MonitorsError`; MonitorsLedger.ts: `layer({ fabrika })`.
//   Runner.ts: a runner given `Monitors` performs both Cmds itself: this life is the watcher, the Cmd's
//     id is the ref, and the brain writes the answer message `<cmd id>/answer` in the watch's own turn.
//   Process.ts: `Down` gains `name`, the registered name the watch was made by.
// The oracle is the walk's own record of what it asked and ended, the reader's saved model read from
// its checkpoint, and the ledger's raw rows read with SQL; it never calls the product's fold.
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { type Runs, runsFor } from "@kampus/vitest";
import {
  Arbitrary,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Result,
  Schedule,
  Schema,
  Scope,
} from "effect";
import * as fc from "fast-check";
import { InputId, Writer } from "../coordination/index.ts";
import { Model as FabrikaModel } from "../permissions/Model.ts";
import * as Relation from "../permissions/Relation.ts";
import * as RelationsMemory from "../permissions/RelationsMemory.ts";
import { Sender, Senders } from "../permissions/Senders.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { type From, Mailbox } from "../processes/Mailbox.ts";
import { Monitors, MonitorsError } from "../processes/Monitors.ts";
import * as MonitorsLedger from "../processes/MonitorsLedger.ts";
import { data as ledger, ids, PIDS } from "../processes/Process.test-support.ts";
import { NoProc, Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { ProgramMail } from "../processes/ProgramMail.ts";
import * as ProgramMailLedger from "../processes/ProgramMailLedger.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { ANY_CHUNK } from "./internal/chunk.test-support.ts";
import * as Monitor from "./Monitor.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Program } from "./Program.ts";
import { ProgramRunner } from "./Runner.ts";

/**
 * Real stores: `sql(part)` is one database per part, and `reopen` closes and reopens every part.
 * `entries(streams)` reads those streams of the `ledger` part through the ledger, in the order it took
 * them; the module that owns the ledger reads them (0062).
 */
export type Store = {
  readonly sql: (part: string) => Sql;
  readonly reopen: Effect.Effect<void>;
  readonly entries: (streams: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Row>>;
};

const SEED = 119120;
const BUILD = "watch-build-a";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
/** A call that does not answer in this long is held behind something it must never wait on. */
const LIMIT = "10 seconds";
const READERS = ["reader:1", "reader:2"] as const;
const TARGETS = ["writer:1", "writer:2"] as const;
const FABRIKA = FabrikaModel.ref("fabrika", "watch");

// ---------------------------------------------------------------------------------------------
// The reader: it watches and forgets on its inputs, and keeps every message it folds, in order.

const ReaderModel = Schema.Struct({ log: Schema.Array(Schema.Json) });
type ReaderModel = typeof ReaderModel.Type;

const ReaderMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("watch"), name: Schema.String }),
  Schema.Struct({ type: Schema.Literal("forget"), ref: Schema.String }),
  Schema.Struct({ type: Schema.Literal("rows"), life: Schema.String, n: Schema.Int }),
  Schema.Struct({
    type: Schema.Literal("DOWN"),
    ref: Schema.String,
    process: Schema.String,
    name: Schema.optionalKey(Schema.String),
    reason: Schema.Json,
  }),
]);

const logged = (s: ReaderModel, entry: Schema.Json): ReaderModel => ({ log: [...s.log, entry] });

/** M15's follow-up: a Cmd the reader's own handler runs, so the walk sees every run. */
const ping = Cmd.make("ping", { input: Schema.Struct({ ref: Schema.String }), ok: Schema.String, err: [] });

/**
 * A reader program. `reader` returns nothing on `monitor_ok`; `chaser` returns a `ping` for the
 * watch's ref there, the follow-up M15 counts.
 */
const reading = (name: "reader" | "chaser") =>
  Program.make({
    name,
    machine: Machine.make({
      model: ReaderModel,
      msg: ReaderMsg,
      cmds: [Monitor.monitor, Monitor.demonitor, ping],
      init: (loaded) => [loaded ?? { log: [] }, []],
      update: {
        watch: (s, m) => [s, [Monitor.monitor({ name: m.name })]],
        forget: (s, m) => [s, [Monitor.demonitor({ ref: m.ref })]],
        rows: (s, m) => [logged(s, { type: "rows", life: m.life, n: m.n }), []],
        DOWN: (s, m) => [
          logged(s, { type: "DOWN", ref: m.ref, process: m.process, name: m.name ?? null, reason: m.reason }),
          [],
        ],
        monitor_ok: (s, m) => [
          logged(s, { type: "monitor_ok", ref: m.value.ref, process: m.value.process, name: m.value.name }),
          name === "chaser" ? [ping({ ref: m.value.ref })] : [],
        ],
        monitor_err: (s, m) => [logged(s, { type: "monitor_err", reason: m.error._tag }), []],
        demonitor_ok: (s) => [logged(s, { type: "demonitor_ok" }), []],
        demonitor_err: (s) => [logged(s, { type: "demonitor_err" }), []],
        ping_ok: (s, m) => [logged(s, { type: "ping_ok", ref: m.value }), []],
        ping_err: (s) => [logged(s, { type: "ping_err" }), []],
      },
    }),
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: {
      watch: "Watch a registered name",
      forget: "End a watch",
      rows: "A message from a process this program reads",
      DOWN: "A process this program monitors has ended",
    },
    outputs: {},
    writes: {},
    wake: () => null,
  });

type Reading = ReturnType<typeof reading>;
const readerProgram = reading("reader");
const chaserProgram = reading("chaser");

const PROGRAMS = {
  [readerProgram.name]: readerProgram,
  [chaserProgram.name]: chaserProgram,
};

/** One entry of the reader's log, as the walk reads it back. */
type Logged = {
  readonly type: string;
  readonly ref?: string;
  readonly process?: string;
  readonly name?: string | null;
  readonly reason?: unknown;
  readonly life?: string;
};

const decodeModel = Schema.decodeUnknownOption(ReaderModel);
const person = Writer.cases.person.make({ key: "SHA256:person", for: PERSON });
/** The member each reader was started by: the founder, who owns the fabrika. */
const MEMBER = Sender.cases.person.make({ key: "SHA256:person", for: PERSON });

const ROWS: ReadonlyArray<Relation.Change> = [
  {
    id: "owner",
    row: Relation.Row.cases.related.make({ subject: `person:${PERSON}`, relation: "owner", object: FABRIKA }),
  },
];

/** Each writer may mail each reader. */
const GRANTS = Object.fromEntries(TARGETS.map((t) => [t, [...READERS]]));

const brainFrom = (): From => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-15T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
});

const writerFrom = (): From => ({
  by: "SHA256:writer",
  for: PERSON,
  sentAt: "2026-11-15T00:30:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
});

const inputId = (n: number) =>
  Schema.decodeUnknownSync(InputId)(`input_0000000000e00a${n.toString(16).padStart(12, "0")}`);

const letter = (n: number, input: unknown): Incoming => ({
  id: `letter-${n}`,
  envelope: { id: inputId(n), by: person, arrivedAt: 1794099600000 + n, input },
  sentAt: "2026-11-15T01:00:00Z",
  seen: 0,
  span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
});

// Effect Arbitrary has no fast-check adapter: one seed draws one value from the schema's own Arbitrary.
const generated = <S extends Schema.Top>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's map takes a plain value, so one sample is drawn here
    const [value] = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }));
    return value as S["Type"];
  });

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

// ---------------------------------------------------------------------------------------------
// The world: what the walk knows from its own moves.

type Life = { pid: string; live: boolean; readonly lives: Array<string> };

/** One watch the brain answered, and what the walk knows of it since. */
type Watch = {
  readonly ref: string;
  readonly reader: string;
  /** The reader life that asked: the watcher. */
  readonly watcher: string;
  readonly target: string;
  /** The life the answer bound. */
  readonly process: string;
  /** The name's current life when the watch was asked: the one it must bind. */
  readonly current: string;
  /** The bound life had ended before the watch's turn, so its DOWN says noproc. */
  readonly noproc: boolean;
  state: "live" | "canceled" | "watcher_exited";
  /** DOWNs for this ref the reader had folded when its demonitor's turn committed. */
  downsAtCancel?: number;
};

type World = {
  readonly targets: Map<string, Life>;
  readonly readers: Map<string, Life>;
  /** Every monitor ask the brain was given, by Cmd id, with the reader life that made it. */
  readonly asked: Map<string, { readonly reader: string; readonly watcher: string; tries: number }>;
  readonly watches: Map<string, Watch>;
  /** Each watched life that ended, and its reason. */
  readonly ends: Map<string, ExitReason>;
  /** Each forget a reader life asked, and what its ref was to that life. */
  readonly forgets: Array<{
    readonly watcher: string;
    readonly ref: string;
    readonly kind: "own" | "foreign" | "unknown";
  }>;
  readonly fault: {
    /** The next monitor turn commits, then this life ends with this reason before the runner goes on. */
    race: ExitReason | undefined;
    /** The next monitor's reply is lost after its turn committed, and the call is retried this many times. */
    lose: number;
    /** Hold the next demonitor after its dispatch. */
    gate: { readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> } | undefined;
    /** The next write of a DOWN fails once, and the turn that holds it with it. */
    cut: boolean;
    /** After the next monitor's turn commits, another call's catch-up folds its answer first. */
    overtake: ((ref: string) => Effect.Effect<void>) | undefined;
  };
  /** The ref of each `ping` the readers' handler ran, one entry per run. */
  readonly pings: Array<string>;
  readonly done: Set<string>;
  n: number;
};

/** A process's saved log, read from its checkpoint without asking the runner. */
const savedLog = Effect.fnUntraced(function* (
  store: Store,
  context: Context.Context<Layer.Success<ReturnType<typeof ledger>>>,
  name: string,
  pid: string,
) {
  const saved = yield* ProcessStore.use((s) => s.load).pipe(
    Effect.provide(ProcessStore.layer(store.sql(`process-${name}`), { process: pid })),
    Effect.provide(context),
  );
  const model = Option.getOrUndefined(decodeModel(saved?.saved.model ?? null));
  return (model?.log ?? []) as ReadonlyArray<Logged>;
});

/** One ledger row: its global rev, stream, id, tag and body. */
export type Row = {
  readonly rev: number;
  readonly stream: string;
  readonly id: string;
  readonly tag: string;
  readonly body: { readonly ref?: unknown; readonly to?: { readonly process?: unknown }; readonly reason?: unknown };
};

/** The ledger's Sql with one cut: the next INSERT of a DOWN fails, so its whole turn fails. */
const cutting = (sql: Sql, world: World): Sql => ({
  exec: (query, ...params) => {
    if (
      world.fault.cut &&
      /^\s*INSERT\b/i.test(query) &&
      params.some((p) => typeof p === "string" && p.startsWith('["DOWN",'))
    ) {
      world.fault.cut = false;
      world.done.add("cut:fired");
      throw new Error("SQLITE_IOERR planted at a DOWN");
    }

    return sql.exec(query, ...params);
  },
  transaction: (step) => sql.transaction(step),
  size: () => sql.size(),
});

/**
 * One life of the whole host: the ledger, process table, mailbox, program mail, the brain's watch
 * service behind the cut layer, and one runner per reader, all in `scope`. Closing the scope is the
 * host going away; the stores keep their rows.
 */
const host = Effect.fnUntraced(function* (
  store: Store,
  world: World,
  next: Effect.Effect<string>,
  scope: Scope.Scope,
  program: Reading,
) {
  const shared = Layer.mergeAll(
    ProgramMailLedger.layer({ grants: GRANTS, cap: 16_384 }),
    MonitorsLedger.layer({ fabrika: FABRIKA }).pipe(
      Layer.provide(RelationsMemory.layer(ROWS)),
      // No reader input here carries a member's sender: each watch is checked against the reader's own member.
      Layer.provide(Layer.succeed(Senders, { sender: () => Effect.succeed(Option.none()) })),
    ),
  ).pipe(
    Layer.provideMerge(
      ProcessManager.layer(
        {
          by: "SHA256:brain",
          owner: Owner.cases.brain.make({}),
          recipient: Recipient.cases.client.make({ client: "brain", session: PIDS.at(-1) ?? "" }),
        },
        next,
      ),
    ),
    Layer.provideMerge(Mailbox.layer),
    Layer.provideMerge(ledger(cutting(store.sql("ledger"), world))),
  );
  const context = yield* Layer.buildWithScope(shared, scope);
  const manager = Context.get(context, ProcessManager);
  const real = Context.get(context, Monitors);
  // The test layer around the brain's watch service: it ends a life, loses a reply or holds a call.
  const cut = Layer.succeed(Monitors, {
    monitor: (watch, from) =>
      Effect.gen(function* () {
        const reader = [...world.readers].find(([, r]) => r.pid === watch.watcher.process)?.[0] ?? "";
        const asked = world.asked.get(watch.id) ?? { reader, watcher: watch.watcher.process, tries: 0 };
        asked.tries++;
        world.asked.set(watch.id, asked);
        const ended = new Set(world.ends.keys());
        const current = world.targets.get(watch.name)?.pid ?? "";
        const answer = yield* real.monitor(watch, from);

        if (!world.watches.has(watch.id)) {
          world.watches.set(watch.id, {
            ref: answer.ref,
            reader,
            watcher: watch.watcher.process,
            target: watch.name,
            process: answer.process,
            current,
            noproc: ended.has(answer.process),
            state: "live",
          });
          world.done.add(ended.has(answer.process) ? "noproc" : "watch:live");
        }

        const race = world.fault.race;
        const target = world.targets.get(watch.name);

        if (race !== undefined && target?.live === true) {
          // The watched life ends after the brain's turn and before the runner places or folds anything.
          world.fault.race = undefined;
          yield* manager.exit(target.pid, race, brainFrom()).pipe(Effect.orDie);
          target.live = false;
          world.ends.set(target.pid, race);
          world.done.add("race");
        }

        const overtake = world.fault.overtake;

        if (overtake !== undefined) {
          // The answer is saved: another call's catch-up folds it before this call's settle can.
          world.fault.overtake = undefined;
          yield* overtake(watch.id);
        } else if (world.fault.lose === 0) {
          world.done.add("settle");
        }

        if (world.fault.lose > 0) {
          // The reply is lost after the brain's turn committed, and the call reaches the brain again
          // under the same id, as a retried call between the objects would: each answers the same.
          const again = world.fault.lose;
          world.fault.lose = 0;

          for (let k = 0; k < again; k++) {
            asked.tries++;
            const retried = yield* real.monitor(watch, from);
            expect(retried, `M7: a retried watch ${watch.id} answers the same`).toEqual(answer);
          }

          world.done.add("lose_after");
          return yield* new MonitorsError({ reason: "storage" });
        }

        return answer;
      }),
    demonitor: (unwatch, from) =>
      Effect.gen(function* () {
        const gate = world.fault.gate;

        if (gate !== undefined) {
          world.fault.gate = undefined;
          yield* Deferred.succeed(gate.entered, undefined);
          yield* Deferred.await(gate.release);
        }

        yield* real.demonitor(unwatch, from);
        const watch = world.watches.get(unwatch.ref);

        if (watch !== undefined && watch.watcher === unwatch.watcher.process && watch.state === "live") {
          // What the reader had folded when the cancel committed: no DOWN for this ref may fold after it.
          const log = yield* savedLog(store, context, watch.reader, watch.watcher).pipe(Effect.orDie);
          watch.state = "canceled";
          watch.downsAtCancel = log.filter((e) => e.type === "DOWN" && e.ref === watch.ref).length;
        }
      }),
  });
  const boot = Effect.fnUntraced(function* (name: string, member: boolean) {
    const status = yield* manager.status(name).pipe(Effect.result);

    if (Result.isSuccess(status)) {
      return status.success.state.process;
    }

    const started = yield* manager
      .start(
        Start.cases.first.make({
          id: `boot:${name}`,
          name,
          code: { program: name.split(":")[0] ?? "", hash: BUILD },
          ...(member ? { member: MEMBER } : {}),
        }),
        brainFrom(),
      )
      .pipe(Effect.orDie);
    return started.process;
  });

  for (const name of TARGETS) {
    const pid = yield* boot(name, false);

    if (!world.targets.has(name)) {
      world.targets.set(name, { pid, live: true, lives: [pid] });
    }
  }

  const runners = new Map<string, ProgramRunner["Service"]>();

  for (const name of READERS) {
    const pid = yield* boot(name, true);

    if (!world.readers.has(name)) {
      world.readers.set(name, { pid, live: true, lives: [pid] });
    }

    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        return {
          append: (i: Incoming) =>
            mailbox.send(name, i.id, i.envelope.input, {
              by: i.envelope.by.key,
              for: i.envelope.by.for,
              sentAt: i.sentAt,
              seen: i.seen,
              parent: i.envelope.id,
              traceId: i.span.traceId,
              build: BUILD,
            }),
          commit: () => Effect.die("no write declared"),
          own: () => Effect.die("no write declared"),
        };
      }),
    );
    const own = Layer.mergeAll(
      ProgramLoader.layer(PROGRAMS, {
        ping: (cmd: unknown) =>
          Effect.sync(() => {
            const ref = typeof cmd === "object" && cmd !== null && "ref" in cmd ? String(cmd.ref) : "";
            world.pings.push(ref);
            return Outcome.ok(ref);
          }),
      }),
      ProcessStore.layer(store.sql(`process-${name}`), { process: pid }),
      Layer.succeed(Alarm, { set: () => Effect.void }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      cut,
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(context)));
    const runner = ProgramRunner.layer(
      { id: pid, name, program: program.name, build: BUILD, owner: person },
      { recovery: { sql: store.sql(`recovery-${name}`), name, capacity: 1024 ** 3 }, chunk: ANY_CHUNK },
    ).pipe(Layer.provide(own));
    runners.set(name, Context.get(yield* Layer.buildWithScope(runner, scope), ProgramRunner));
  }

  return { context, manager, runners };
});

/** A call that may fail at a planted cut; it must still answer, never hang. */
const answers = <A, E>(effect: Effect.Effect<A, E>, label: string) =>
  effect.pipe(
    Effect.result,
    Effect.timeoutOption(LIMIT),
    Effect.map((answer) => {
      expect(Option.isSome(answer), `${label} answers: nothing holds it`).toBe(true);
      return Option.getOrThrow(answer);
    }),
  );

type Move =
  | "watch"
  | "watch_race"
  | "watch_lost"
  | "watch_overtake"
  | "end_cut"
  | "send"
  | "send_stale"
  | "end"
  | "restart"
  | "wake"
  | "forget"
  | "forget_race"
  | "watcher_end"
  | "reopen";

const Cell = fc.record({ move: fc.nat(), pick: fc.nat(), alt: fc.nat(), reason: generated(ExitReason) });
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/**
 * Folds one tape through real runners. Each cell reads the world the fold has reached and picks a
 * move possible there; once every reader has read its inbox to the end, each watch has the end the
 * walk's record gives it.
 */
const walk = (
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  done: Set<string>,
  program: Reading,
) =>
  Effect.fnUntraced(function* (cells: ReadonlyArray<Cell>) {
    const store = yield* open;
    const next = ids(...PIDS);
    const world: World = {
      targets: new Map(),
      readers: new Map(),
      asked: new Map(),
      watches: new Map(),
      ends: new Map(),
      forgets: [],
      fault: { race: undefined, lose: 0, gate: undefined, cut: false, overtake: undefined },
      pings: [],
      done,
      n: 0,
    };
    let scope = yield* Scope.make();
    let life = yield* host(store, world, next.next, scope, program);
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const runner = (name: string) => life.runners.get(name) ?? expect.fail(`no runner for ${name}`);
    const now = Clock.currentTimeMillis;
    const wake = Effect.fnUntraced(function* (name: string) {
      yield* answers(runner(name).due(yield* now), `${name}'s wake`);
    });
    const say = Effect.fnUntraced(function* (name: string, input: unknown) {
      return yield* answers(runner(name).msg(letter(++world.n, input)), `${name}'s ${JSON.stringify(input)}`);
    });
    /** Supervision ends a watched life; a retried exit, with the same reason, answers again. */
    const end = Effect.fnUntraced(function* (name: string, reason: ExitReason, again = false) {
      const target = world.targets.get(name) ?? expect.fail(`no target ${name}`);
      const first = yield* life.manager.exit(target.pid, reason, brainFrom()).pipe(Effect.result);

      if (Result.isFailure(first)) {
        // A failed exit wrote nothing, or it wrote the end and its DOWN together: the life the brain
        // now holds says which, and a life that ended owes each watcher its DOWN.
        expect(world.done.has("cut:fired"), `an exit fails only at the planted cut: ${String(first.failure)}`).toBe(
          true,
        );
        world.fault.cut = false;
        done.add("end:cut");
        const now = yield* life.manager.status(name).pipe(Effect.orDie);

        if (now.state._tag === "live" && now.state.process === target.pid) {
          return;
        }
      }

      if (again) {
        yield* life.manager.exit(target.pid, reason, brainFrom()).pipe(Effect.orDie);
        done.add("end:retried");
      }

      target.live = false;
      world.ends.set(target.pid, reason);
      done.add("end");
    });
    const readerLife = Effect.fnUntraced(function* (name: string) {
      const status = yield* life.manager.status(name).pipe(Effect.orDie);
      return status.state.process;
    });

    for (const cell of cells) {
      const live = TARGETS.filter((t) => world.targets.get(t)?.live === true);
      const ended = TARGETS.filter((t) => world.targets.get(t)?.live === false);
      const watching = [...world.watches.values()].filter(
        (w) => w.state === "live" && world.readers.get(w.reader)?.pid === w.watcher,
      );
      const possible = moves.filter(
        (move) =>
          (move !== "watch_race" || live.length > 0) &&
          ((move !== "end" && move !== "end_cut") || live.length > 0) &&
          (move !== "restart" || ended.length > 0) &&
          (move !== "send_stale" || [...world.targets.values()].some((t) => t.lives.length > 1 || !t.live)) &&
          (move !== "forget_race" || watching.some((w) => world.targets.get(w.target)?.live === true)),
      );
      const move = choose(possible, cell.move);
      const reader = choose(READERS, cell.pick);

      switch (move) {
        case "watch":
        case "watch_race":
        case "watch_lost":
        case "watch_overtake": {
          const name = move === "watch_race" ? choose(live, cell.alt) : choose(TARGETS, cell.alt);
          const lives = world.targets.get(name)?.lives.length ?? 1;
          const overtaking: Array<Fiber.Fiber<unknown>> = [];

          if (move === "watch_race") {
            world.fault.race = cell.reason;
          }

          if (move === "watch_lost") {
            world.fault.lose = 1 + (cell.alt % 3);
          }

          if (move === "watch_overtake") {
            const pid = world.readers.get(reader)?.pid ?? "";
            const held = scope;
            world.fault.overtake = (ref) =>
              Effect.gen(function* () {
                // A wake's catch-up takes the permit the monitor's perform does not hold, and folds the
                // saved answer; its Cmds wait for this call's Cmds to finish.
                overtaking.push(yield* Effect.forkIn(wake(reader), held));
                const folded = yield* savedLog(store, life.context, reader, pid).pipe(
                  Effect.orDie,
                  Effect.repeat({
                    until: (log) => log.some((e) => e.type === "monitor_ok" && e.ref === ref),
                    schedule: Schedule.spaced("2 millis"),
                  }),
                  Effect.timeoutOption(LIMIT),
                );
                expect(Option.isSome(folded), `M15: a catch-up folds ${ref}'s answer before the settle`).toBe(true);
                world.done.add("overtake");
              });
          }

          const before = new Set(world.asked.keys());
          yield* say(reader, { type: "watch", name });
          world.fault.race = undefined;
          world.fault.overtake = undefined;

          for (const fiber of overtaking) {
            yield* Fiber.join(fiber);
          }

          if (lives > 1) {
            done.add("rewatch");
          }

          if (move === "watch_lost") {
            // The lost reply failed the call; the next read finds the answer the brain already saved.
            world.fault.lose = 0;
            yield* wake(reader);
            const id = [...world.asked.keys()].find((k) => !before.has(k));

            if (id !== undefined && (world.asked.get(id)?.tries ?? 0) > 1) {
              done.add("lose_after:retried");
            }
          }

          break;
        }
        case "send":
        case "send_stale": {
          const name = choose(TARGETS, cell.alt);
          const target = world.targets.get(name) ?? expect.fail("a target");
          const from = move === "send" ? target.pid : choose(target.lives, cell.alt);
          const stale = from !== target.pid || !target.live;
          const n = ++world.n;
          const sent = yield* ProgramMail.use((mail) =>
            mail.deliver({
              command: `${from}/${n}/0`,
              source: { name, process: from },
              to: reader,
              m: { type: "rows", life: from, n },
              from: writerFrom(),
            }),
          ).pipe(Effect.provide(life.context), Effect.result);

          if (stale) {
            // A life that ended can no longer save a message: nothing of it lands after its DOWN.
            const refusal = Result.isFailure(sent) ? sent.failure.reason._tag : "queued";
            expect(refusal, "M2: an ended life's send is refused").toBe("stale_sender");
            done.add("send_stale");
          } else {
            expect(Result.isSuccess(sent), "a live writer's message is saved").toBe(true);
            done.add("send");
          }

          break;
        }
        case "end":
          yield* end(choose(live, cell.alt), cell.reason, cell.pick % 2 === 0);
          break;
        case "end_cut":
          world.fault.cut = true;
          yield* end(choose(live, cell.alt), cell.reason);
          world.fault.cut = false;
          break;
        case "restart": {
          const name = choose(ended, cell.alt);
          const target = world.targets.get(name) ?? expect.fail("a target");
          const placed = yield* life.manager
            .start(
              Start.cases.again.make({
                id: `again:${name}:${++world.n}`,
                name,
                code: { program: "writer", hash: BUILD },
                after: target.pid,
                reason: "crashed",
              }),
              brainFrom(),
            )
            .pipe(Effect.orDie);
          target.pid = placed.process;
          target.live = true;
          target.lives.push(placed.process);
          done.add("restart");
          break;
        }
        case "wake":
          yield* wake(reader);
          done.add("wake");
          break;
        case "forget": {
          const watcher = world.readers.get(reader)?.pid ?? "";
          const own = watching.filter((w) => w.watcher === watcher);
          const foreign = watching.filter((w) => w.watcher !== watcher);
          const kind = choose(["own", "foreign", "unknown"] as const, cell.alt);
          const ref =
            kind === "own" && own.length > 0
              ? choose(own, cell.alt).ref
              : kind === "foreign" && foreign.length > 0
                ? choose(foreign, cell.alt).ref
                : `${watcher}/${90_000 + world.n}/0`;
          const actual = own.some((w) => w.ref === ref)
            ? "own"
            : foreign.some((w) => w.ref === ref)
              ? "foreign"
              : "unknown";
          world.forgets.push({ watcher, ref, kind: actual });
          yield* say(reader, { type: "forget", ref });
          done.add(`forget:${actual}`);
          break;
        }
        case "forget_race": {
          // The demonitor is dispatched and held; the watched life ends, so its DOWN is saved but unread.
          const held = watching.filter((w) => world.targets.get(w.target)?.live === true);
          const watch = choose(held, cell.alt);
          const gate = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
          world.fault.gate = gate;
          world.forgets.push({ watcher: watch.watcher, ref: watch.ref, kind: "own" });
          const fiber = yield* Effect.forkChild(say(watch.reader, { type: "forget", ref: watch.ref }));
          const entered = yield* Deferred.await(gate.entered).pipe(Effect.timeoutOption(LIMIT));
          expect(Option.isSome(entered), "the demonitor reached the brain").toBe(true);
          yield* end(watch.target, cell.reason);
          yield* Deferred.succeed(gate.release, undefined);
          yield* Fiber.join(fiber);
          done.add("forget:saved_down");
          break;
        }
        case "watcher_end": {
          // The watcher's own life ends and a new one starts under its name.
          const old = world.readers.get(reader) ?? expect.fail("a reader");
          const held = [...world.watches.values()].filter((w) => w.watcher === old.pid && w.state === "live");
          yield* answers(runner(reader).restart({ id: `restart-${++world.n}`, build: BUILD }), `${reader}'s restart`);
          const fresh = yield* readerLife(reader);
          expect(fresh, "a restart is a new process").not.toBe(old.pid);
          old.pid = fresh;
          old.lives.push(fresh);

          for (const w of held) {
            w.state = "watcher_exited";
          }

          done.add(held.length > 0 ? "watcher_end:held" : "watcher_end");
          break;
        }
        case "reopen": {
          // The host goes away and comes back on the same stores, as a restarted brain would.
          yield* Scope.close(scope, Exit.void);
          yield* store.reopen;
          scope = yield* Scope.make();
          life = yield* host(store, world, next.next, scope, program);

          for (const name of READERS) {
            yield* answers(runner(name).init(), `${name}'s init after the reopen`);
          }

          done.add("reopen");
          break;
        }
      }

      if (
        move === "end" &&
        [...world.watches.values()].some((w) => w.state === "watcher_exited" && world.ends.has(w.process))
      ) {
        done.add("watcher_end:then_end");
      }
    }

    // Every reader reads its inbox to the end, and every Cmd a cut left dispatched is asked again.
    world.fault.lose = 0;

    for (let round = 0; round < 3; round++) {
      for (const name of READERS) {
        yield* wake(name);
      }
    }

    const rows = yield* store.entries(["processes", ...READERS.map((name) => `${name}/inbox`)]);
    const logs = new Map<string, ReadonlyArray<Logged>>();

    for (const name of READERS) {
      for (const pid of world.readers.get(name)?.lives ?? []) {
        logs.set(pid, yield* savedLog(store, life.context, name, pid).pipe(Effect.orDie));
      }
    }

    const logFor = (pid: string) => logs.get(pid) ?? [];

    // M7: each monitor Cmd the brain answered, however often it was asked, is one watch, one answer
    // and one fold; a refused one is one refusal and writes no watch.
    for (const [id, asked] of world.asked) {
      const label = `M7: the monitor ${id}, asked ${asked.tries} times`;
      const monitored = rows.filter((r) => r.stream === "processes" && r.tag === "monitored" && r.body.ref === id);
      const placed = rows.filter((r) => r.stream === `${asked.reader}/inbox` && r.id === `${id}/answer`);
      const log = logFor(asked.watcher);

      if (!world.watches.has(id)) {
        expect(monitored, `${label}: a refused watch writes no monitored row`).toEqual([]);
        expect(log.filter((e) => e.type === "monitor_err").length, `${label}: is folded as a refusal`).toBeGreaterThan(
          0,
        );
        continue;
      }

      expect(monitored.length, `${label}: one monitored row`).toBe(1);
      expect(placed.length, `${label}: one answer message`).toBe(1);
      const folded = log.filter((e) => e.type === "monitor_ok" && e.ref === id);
      expect(folded.length, `${label}: the watcher folds one answer, with the Cmd's id as its ref`).toBe(1);
    }

    // M15: the Cmds a watch's `monitor_ok` step made run exactly once, whichever call folded the
    // answer the brain saved: a chaser's `ping` once per watch, a reader's nothing.
    for (const watch of world.watches.values()) {
      const owed = program.name === "chaser" ? 1 : 0;
      const label = `M15: ${watch.reader} (${watch.watcher}) watching ${watch.target} as ${watch.ref}`;
      const runs = world.pings.filter((ref) => ref === watch.ref).length;
      const folded = logFor(watch.watcher).filter((e) => e.type === "ping_ok" && e.ref === watch.ref).length;
      expect(runs, `${label}: its follow-up runs ${owed} times`).toBe(owed);
      expect(folded, `${label}: the follow-up's answer folds ${owed} times`).toBe(owed);
    }

    // M3: in every reader life, a watch's answer folds before any DOWN for it.
    for (const [pid, log] of logs) {
      log.forEach((entry, index) => {
        if (entry.type === "DOWN") {
          const answered = log.findIndex((e) => e.type === "monitor_ok" && e.ref === entry.ref);
          expect(answered, `M3: in ${pid}, the answer for ${entry.ref} folds before its DOWN`).toBeGreaterThanOrEqual(
            0,
          );
          expect(answered < index, `M3: in ${pid}, monitor_ok before DOWN for ${entry.ref}`).toBe(true);
        }
      });
    }

    for (const watch of world.watches.values()) {
      const log = logFor(watch.watcher);
      const downs = log.flatMap((e, index) => (e.type === "DOWN" && e.ref === watch.ref ? [{ e, index }] : []));
      const label = `${watch.reader} (${watch.watcher}) watching ${watch.target} as ${watch.ref}`;
      // M10: a watch binds the name's life when it was asked, and never follows the name.
      expect(watch.process, `M10: ${label} binds the name's current life`).toBe(watch.current);

      if (watch.state === "canceled") {
        // M8: no DOWN for a canceled ref folds after its cancel, including one already saved.
        expect(downs.length, `M8: ${label}: no DOWN folds after its demonitor`).toBe(watch.downsAtCancel ?? 0);
        const canceled = rows.filter(
          (r) =>
            r.tag === "demonitored" &&
            r.body.ref === watch.ref &&
            r.body.to?.process === watch.watcher &&
            r.body.reason === "canceled",
        );
        expect(canceled.length, `M8: ${label}: one demonitored row`).toBe(1);
        continue;
      }

      if (watch.state === "watcher_exited") {
        // M9: the watcher's end ends its watches, and no later life under its name folds their DOWN.
        const exited = rows.filter(
          (r) =>
            r.tag === "demonitored" &&
            r.body.ref === watch.ref &&
            r.body.to?.process === watch.watcher &&
            r.body.reason === "watcher_exited",
        );
        expect(exited.length, `M9: ${label}: demonitored watcher_exited`).toBe(1);

        for (const pid of world.readers.get(watch.reader)?.lives ?? []) {
          if (pid !== watch.watcher) {
            const later = logFor(pid).filter((e) => e.type === "DOWN" && e.ref === watch.ref);
            expect(later, `M9: ${label}: the new life ${pid} folds no DOWN for it`).toEqual([]);
          }
        }

        continue;
      }

      const reason = watch.noproc ? NoProc.make({}) : world.ends.get(watch.process);

      if (reason === undefined) {
        expect(downs, `M2: ${label}: a live life gives no DOWN`).toEqual([]);
        continue;
      }

      // M2 and M10: one DOWN for the bound life, with its reason and the name, and nothing about a new life.
      expect(downs.length, `M2: ${label}: exactly one DOWN`).toBe(1);
      expect(downs[0]?.e, `M2: ${label}: the DOWN names the life, the name and the reason`).toEqual({
        type: "DOWN",
        ref: watch.ref,
        process: watch.process,
        name: watch.target,
        reason,
      });
      const last = log.findLastIndex((e) => e.type === "rows" && e.life === watch.process);
      expect(last < (downs[0]?.index ?? -1), `M2: ${label}: no message from the ended life folds after its DOWN`).toBe(
        true,
      );
    }

    // M8: a demonitor of a ref the life never got, or another life's, answers ok and writes nothing.
    for (const forget of world.forgets) {
      if (forget.kind !== "own") {
        const touched = rows.filter(
          (r) => r.tag === "demonitored" && r.body.ref === forget.ref && r.body.to?.process === forget.watcher,
        );
        expect(touched, `M8: ${forget.watcher}'s demonitor of a ${forget.kind} ref writes nothing`).toEqual([]);
      }
    }

    for (const [pid, log] of logs) {
      const asked = world.forgets.filter((f) => f.watcher === pid).length;
      expect(
        log.filter((e) => e.type === "demonitor_ok").length,
        `M8: ${pid} folds demonitor_ok for every forget`,
      ).toBe(asked);
    }
  });

const Tape = fc.array(Cell, { minLength: 8, maxLength: 24, size: "max" });

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  options: {
    readonly moves: ReadonlyArray<Move>;
    readonly required: ReadonlyArray<string>;
    readonly runs: Runs;
    readonly program?: Reading;
  },
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<string>();
        const law = walk(open, options.moves, done, options.program ?? readerProgram);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
        const check = { seed: SEED, numRuns: runsFor(options.runs), includeErrorInReport: true, endOnFailure: true };
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, check));
        // An empty walk cannot pass: every move and every cut the law is about happened at least once.
        expect([...done].sort()).toEqual(expect.arrayContaining([...options.required].sort()));
      }),
    600_000,
  );

const RUNS: Runs = { fast: 10, full: 100 };

/** Runs the laws on the stores `open` gives. */
export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("Program watch: a program monitors a name and folds one DOWN when that life ends", () => {
    // Plants: write the DOWN in a turn after `exited` (red through the cut: the end is saved and its
    // DOWN is not); write the DOWN twice on a retried exit.
    prop(
      "M2: the watcher folds exactly one DOWN with the life's reason, its name and ref, and no message from that life folds after it",
      open,
      {
        moves: ["watch", "send", "send_stale", "end", "end_cut", "wake"],
        required: ["watch:live", "send", "send_stale", "end", "end:retried", "end:cut"],
        runs: RUNS,
      },
    );
    // Plant: let the runner place the answer after the brain's turn, as other host Cmds do.
    prop(
      "M3: whatever the race between the end, the brain's turn and the answer's placement, monitor_ok folds before its DOWN, noproc included",
      open,
      {
        moves: ["watch", "watch_race", "end", "restart", "wake"],
        required: ["race", "noproc", "watch:live"],
        runs: RUNS,
      },
    );
    // Plants: drop the catch-up's handling of its own answer to a still-pending monitor Cmd (the
    // follow-up never runs); run the follow-up twice, once from each order.
    prop(
      "M15: the Cmds a monitor_ok step returns run exactly once, whether a catch-up folds the brain's saved answer before the runner's settle or the settle folds it",
      open,
      {
        moves: ["watch", "watch_overtake", "watch_lost", "end", "restart", "wake"],
        required: ["overtake", "settle", "lose_after", "noproc"],
        runs: RUNS,
        program: chaserProgram,
      },
    );
    // Plant: write a new round on each retry.
    prop(
      "M7: a monitor asked again after its reply was lost, any number of times, is one monitored row, one answer and the same ref",
      open,
      {
        moves: ["watch", "watch_lost", "reopen", "wake", "end"],
        required: ["lose_after", "lose_after:retried", "reopen"],
        runs: RUNS,
      },
    );
    // Plants: cancel by ref alone, not (watcher, ref); skip the receive filter.
    prop(
      "M8: after demonitor no DOWN for its ref folds, a saved one included; a ref the life never got answers ok and writes nothing; another life's watch stays",
      open,
      {
        moves: ["watch", "forget", "forget_race", "end", "wake"],
        required: ["forget:own", "forget:foreign", "forget:unknown", "forget:saved_down"],
        runs: RUNS,
      },
    );
    // Plant: keep the watch on the watcher's name.
    prop(
      "M9: when the watcher ends, its watches end with watcher_exited, and a new life under its name folds none of their DOWNs",
      open,
      {
        moves: ["watch", "watcher_end", "end", "restart", "wake"],
        required: ["watcher_end:held", "watcher_end:then_end"],
        runs: RUNS,
      },
    );
    // Plant: bind the watch to the name and move it on `restarted`.
    prop(
      "M10: a restart under the watched name gives one DOWN for the old life and nothing about the new one; a new monitor binds the new life under a new ref",
      open,
      { moves: ["watch", "end", "restart", "wake", "send"], required: ["restart", "rewatch", "end"], runs: RUNS },
    );
  });

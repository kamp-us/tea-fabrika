// T753 L16 full-depth fix, next/. The runner's lifecycle laws on in-memory SQLite (0062): the real runner,
// process table and ledger, with only the platform's alarm and the program loader's handler doubled.
import { DatabaseSync } from "node:sqlite";
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Writer } from "../access/SessionManager.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { InputId, Row, valueFor } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Model as FabrikaModel } from "../permissions/Model.ts";
import * as RelationsMemory from "../permissions/RelationsMemory.ts";
import { Senders } from "../permissions/Senders.ts";
import * as ChildrenLedger from "../processes/ChildrenLedger.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, ProcessEvent, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import { ProgramRunner } from "../runtime/Runner.ts";
import * as RunnerLifecycleTest from "../runtime/RunnerLifecycleTest.ts";
import { exit, startChild, stopChild } from "../runtime/StartChild.ts";
import { mailChunk } from "../settings/Declarations.ts";
import type { Sql } from "../Sql.ts";

const NAME = "counter:1";

const PROGRAM = "sample/counter";

const BRAIN = "SHA256:brain";

const from = () => ({
  by: BRAIN,
  for: "test-person",
  sentAt: "2099-01-01T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "test",
});

const person = Writer.cases.person.make({ key: "SHA256:input", for: "test-person" });

const Model = Schema.Struct({ count: Schema.Int, replies: Schema.Int, wake: Schema.NullOr(Schema.Finite) });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("work") }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("crash") }),
  Schema.Struct({ type: Schema.Literal("schedule") }),
  Schema.Struct({ type: Schema.Literal("start_child"), name: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stop_child"), name: Schema.String }),
]);

const work = Cmd.make("work", { input: Schema.Struct({}), ok: Schema.Null, err: ["failed"] });

const program = {
  name: PROGRAM,
  machine: Machine.make({
    model: Model,
    msg: Msg,
    cmds: [work, exit, startChild, stopChild],
    init: (saved) => [saved ?? { count: 0, replies: 0, wake: null }, []],
    update: {
      inc: (s) => [{ ...s, count: s.count + 1 }, []],
      // The program asks for a timer, so a runner that thinks its life is live arms the alarm.
      schedule: (s) => [{ ...s, wake: 50 }, []],
      work: (s) => [s, [work({})]],
      // The Cmd after the exit is one the ended life still owed, which never runs.
      stop: (s) => [s, [exit({}), work({})]],
      crash: () => {
        throw new TypeError("lifecycle fixture");
      },
      // This life is the requester: it starts a child by name and stops it by the same name.
      start_child: (s, m) => [s, [startChild({ program: PROGRAM, name: m.name })]],
      stop_child: (s, m) => [s, [stopChild({ name: m.name })]],
      work_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
      work_err: (s) => [{ ...s, replies: s.replies + 1 }, []],
      start_child_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
      start_child_err: (s) => [{ ...s, replies: s.replies + 1 }, []],
      stop_child_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
      stop_child_err: (s) => [{ ...s, replies: s.replies + 1 }, []],
      exit_ok: (s) => [s, []],
      exit_err: (s) => [s, []],
    },
  }),
  maxDeliveries: 3,
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: () => null,
  inputs: Object.fromEntries(
    ["inc", "work", "stop", "crash", "schedule", "start_child", "stop_child"].map((key) => [
      key,
      { ...Schema.TaggedStruct("write", {}).make({}), schema: Msg, personOnly: false, description: key },
    ]),
  ),
  outputs: {},
  writes: {},
  wake: (s: typeof Model.Type) => s.wake,
};

interface Hold {
  readonly entered: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
  /** Succeeds once the held call has run. */
  readonly done: Deferred.Deferred<void>;
}

const hold = Effect.all(
  {
    entered: Deferred.make<void>(),
    release: Deferred.make<void>(),
    done: Deferred.make<void>(),
  },
  { concurrency: 1 },
);

const open = Effect.fnUntraced(function* () {
  const memory = (): Sql => {
    const db = new DatabaseSync(":memory:");

    return nodeSql(db);
  };

  const project = memory();
  const state = memory();
  let sequence = 0;
  let alarm: number | null = null;
  const armings: Array<{ at: number | null; state: string; reason: string | null }> = [];
  let worked = 0;
  let input = 0;
  /** The children the runner's lives have asked for: each has its own name, `child:1` and on. */
  let children = 0;
  const reads = { status: 0, isLive: 0 };
  // A hold stops the runner's next call of its kind until the law lets it go, as a slow platform call would.
  const holds: { exit: Hold | null; read: Hold | null; work: Hold | null } = { exit: null, read: null, work: null };
  const pid = Effect.sync(() => `process_0000000000e008${(++sequence).toString(16).padStart(12, "0")}`);

  const caller = {
    by: BRAIN,
    owner: Owner.cases.brain.make({}),
    recipient: Recipient.cases.client.make({ client: "test", session: "process_0000000000e008000000000099" }),
  };

  const data = Layer.mergeAll(
    LedgerSql.layer(project, { reader: "lifecycle-test" }),
    LedgerTransactionSql.layer(project),
  ).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })));

  const base = Layer.mergeAll(Mailbox.layer, ProcessManager.layer(caller, pid)).pipe(Layer.provideMerge(data));

  // The runner starts and stops children through the real `Children` on the same ledger. No letter has a member
  // behind it, so the start grant below judges each start.
  const withChildren = ChildrenLedger.layer({
    grants: [{ source: PROGRAM, to: PROGRAM }],
    fabrika: FabrikaModel.ref("fabrika", "lifecycle"),
  }).pipe(
    Layer.provide(RelationsMemory.layer([])),
    Layer.provide(Layer.succeed(Senders, { sender: () => Effect.succeedNone })),
    Layer.provideMerge(base),
  );

  const real = yield* Layer.build(withChildren);
  const manager = Context.get(real, ProcessManager);

  // The runner's manager counts the lifecycle reads it makes. The law's own reads use the real one.
  const counted = Context.add(real, ProcessManager, {
    ...manager,
    status: (name: string) =>
      Effect.gen(function* () {
        reads.status++;
        const answer = yield* manager.status(name);
        const hold = holds.read;

        if (hold !== null) {
          holds.read = null;
          yield* Deferred.succeed(hold.entered, undefined);
          yield* Deferred.await(hold.release);
        }

        return answer;
      }),
    exit: (process: string, reason: ExitReason, origin: Parameters<typeof manager.exit>[2]) =>
      Effect.gen(function* () {
        const hold = holds.exit;

        if (hold !== null) {
          holds.exit = null;
          yield* Deferred.succeed(hold.entered, undefined);
          yield* Deferred.await(hold.release);
        }

        const answer = yield* manager.exit(process, reason, origin);

        if (hold !== null) {
          yield* Deferred.succeed(hold.done, undefined);
        }

        return answer;
      }),
    isLive: (process: string) =>
      Effect.suspend(() => {
        reads.isLive++;

        return manager.isLive(process);
      }),
  });

  yield* manager.start(
    Start.cases.first.make({ id: `start:${NAME}`, name: NAME, code: { program: PROGRAM, hash: "test" } }),
    from(),
  );

  const table = Effect.gen(function* () {
    const status = yield* manager.status(NAME);

    const { state } = status;

    return state._tag === "live"
      ? { state: "live" as const, process: state.process, reason: null }
      : {
          state: "ended" as const,
          process: state.process,
          reason: state._tag === "ended" ? state.reason._tag : state._tag,
        };
  });

  const runner = Effect.fnUntraced(function* () {
    const now = yield* table;
    const descriptor = { id: now.process, name: NAME, program: PROGRAM, build: "test", owner: person };

    const checked = Layer.effect(
      CheckedWriter,
      Effect.map(Mailbox, (mailbox) => ({
        append: (incoming: Parameters<CheckedWriter["Service"]["append"]>[0]) =>
          mailbox.send(NAME, incoming.id, incoming.envelope.input, {
            ...from(),
            parent: incoming.envelope.id,
            by: incoming.envelope.by.key,
          }),
        sign: () => Effect.die("no program write"),
        commit: () => Effect.die("no program write"),
        own: () => Effect.die("no program write"),
      })),
    );

    const layer = ProgramRunner.layer(descriptor, {
      recovery: { sql: state, name: NAME, capacity: 1_000_000_000 },
      chunk: mailChunk.default,
    }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ProgramLoader.layer(
            { [PROGRAM]: program },
            {
              work: () =>
                Effect.gen(function* () {
                  const gate = holds.work;

                  if (gate !== null) {
                    holds.work = null;
                    yield* Deferred.succeed(gate.entered, undefined);
                    yield* Deferred.await(gate.release);
                  }

                  worked++;

                  return Outcome.ok(null);
                }),
            },
          ),
          ProcessStore.layer(state, { process: now.process }),
          checked,
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Recording, { flush: Effect.void }),
          Layer.succeed(Alarm, {
            // Each arming is logged with what the table said at that moment, read outside the runner.
            set: (at: number | null) =>
              Effect.gen(function* () {
                const seen = yield* Effect.orDie(table);
                armings.push({ at, state: seen.state, reason: seen.reason });
                alarm = at;
              }),
          }),
        ).pipe(Layer.provideMerge(Layer.succeedContext(counted))),
      ),
      Layer.provide(Digest.layerWebCrypto),
    );

    return yield* ProgramRunner.pipe(Effect.provide(layer));
  });

  let current = yield* runner();

  const send = Effect.fnUntraced(function* (
    asked:
      | "inc"
      | "work"
      | "stop"
      | "crash"
      | "schedule"
      | { readonly type: "start_child" | "stop_child"; readonly name: string },
  ) {
    input += 1;
    const message = typeof asked === "string" ? { type: asked } : asked;

    return yield* current.msg({
      id: `letter-${input}`,
      envelope: {
        id: Schema.decodeSync(InputId)(`input_0000000000e008${input.toString(16).padStart(12, "0")}`),
        by: person,
        arrivedAt: yield* Clock.currentTimeMillis,
        input: message,
      },
      sentAt: from().sentAt,
      seen: 0,
      span: { traceId: from().traceId, spanId: "00f067aa0ba902b7" },
    });
  });

  const call = Effect.fnUntraced(function* (move: RunnerLifecycleTest.Move) {
    switch (move) {
      case "inc":
      case "work":
      case "stop":
      case "schedule":
        return yield* send(move);
      // The latest name is the child the last start made, or none the program started: `child:0` is no child.
      case "start_child":
        return yield* send({ type: "start_child", name: `child:${++children}` });
      case "stop_child":
        return yield* send({ type: "stop_child", name: `child:${children}` });
      // The program throws, so the call fails with `ProgramDown`: the failure is the move's answer.
      case "crash":
        return yield* Effect.exit(send("crash"));
      case "due":
        return yield* current.due(alarm ?? (yield* Clock.currentTimeMillis));
      case "open":
        return yield* current.open("test");
      case "restart":
        return yield* current.restart({ id: `restart-${++sequence}`, build: "test" });
      case "shutdown": {
        const now = yield* table;

        return now.state === "live"
          ? yield* manager.exit(now.process, ExitReason.cases.shutdown.make({}), from())
          : undefined;
      }

      // A stop Cmd runs its exit outside the lock while another input's step holds it: the input's first
      // lifecycle read comes before the exit, and its checks after. Both calls answer.
      case "overlap": {
        const exitHold = yield* hold;
        holds.exit = exitHold;
        const stopper = yield* Effect.forkChild(send("stop"));
        yield* Effect.race(Deferred.await(exitHold.entered), Fiber.await(stopper));
        const readHold = yield* hold;
        holds.read = readHold;
        const writer = yield* Effect.forkChild(current.due(alarm ?? (yield* Clock.currentTimeMillis)));
        yield* Effect.race(Deferred.await(readHold.entered), Fiber.await(writer));
        holds.read = null;
        yield* Deferred.succeed(exitHold.release, undefined);
        yield* Effect.race(Deferred.await(exitHold.done), Fiber.await(stopper));
        yield* Deferred.succeed(readHold.release, undefined);
        const incAnswer = yield* Fiber.join(writer);

        return { stop: yield* Fiber.join(stopper), due: incAnswer };
      }

      // A `work` Cmd is in its handler when a writer outside the runner ends its process and starts the
      // name's next one. The runner finishes the Cmd for a life the table no longer calls live.
      case "replaced": {
        const workHold = yield* hold;
        holds.work = workHold;
        const worker = yield* Effect.forkChild(send("work"));
        yield* Effect.race(Deferred.await(workHold.entered), Fiber.await(worker));
        const now = yield* table;

        if (now.state === "live") {
          yield* manager.exit(now.process, ExitReason.cases.shutdown.make({}), from());
          yield* manager.start(
            Start.cases.again.make({
              id: `again-${++sequence}`,
              name: NAME,
              code: { program: PROGRAM, hash: "test" },
              after: now.process,
              reason: "shutdown",
            }),
            from(),
          );
        }

        yield* Deferred.succeed(workHold.release, undefined);

        return yield* Fiber.join(worker);
      }

      // A writer outside the runner starts the name's next process, as another object's supervisor would.
      case "successor": {
        const now = yield* table;

        return yield* manager.start(
          Start.cases.again.make({
            id: `again-${++sequence}`,
            name: NAME,
            code: { program: PROGRAM, hash: "test" },
            after: now.process,
            reason: "shutdown",
          }),
          from(),
        );
      }

      case "wake":
        current = yield* runner();

        return undefined;
    }
  });

  return {
    call,
    table,
    exits: Effect.sync(() =>
      project
        .exec("SELECT * FROM entries ORDER BY rev")
        .map((row) => Schema.decodeUnknownSync(Row)(row))
        .flatMap((entry) => {
          const event = Schema.decodeUnknownOption(ProcessEvent)(valueFor(entry));

          return Option.isSome(event) && event.value._tag === "exited"
            ? [{ process: event.value.process, reason: event.value.reason._tag, by: entry.by }]
            : [];
        }),
    ),
    worked: Effect.sync(() => worked),
    alarm: Effect.sync(() => alarm),
    armings: Effect.sync(() => [...armings]),
    reads: Effect.sync(() => ({ ...reads })),
    reset: Effect.sync(() => {
      armings.length = 0;
      reads.status = 0;
      reads.isLive = 0;
    }),
  } satisfies RunnerLifecycleTest.World;
});

RunnerLifecycleTest.suite(open());

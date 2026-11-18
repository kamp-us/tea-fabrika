// T753 L16 full-depth fix, next/. The runner's lifecycle laws on in-memory SQLite (0062): the real runner,
// process table and ledger, with only the platform's alarm and the program loader's handler doubled.
import { DatabaseSync } from "node:sqlite";
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Writer } from "../access/SessionManager.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { InputId, Row, valueFor } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, ProcessEvent, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import { ProgramRunner } from "../runtime/Runner.ts";
import * as RunnerLifecycleTest from "../runtime/RunnerLifecycleTest.ts";
import { exit } from "../runtime/StartChild.ts";
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

const Model = Schema.Struct({ count: Schema.Int, replies: Schema.Int });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("work") }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("crash") }),
]);

const work = Cmd.make("work", { input: Schema.Struct({}), ok: Schema.Null, err: ["failed"] });

const program = {
  name: PROGRAM,
  machine: Machine.make({
    model: Model,
    msg: Msg,
    cmds: [work, exit],
    init: (saved) => [saved ?? { count: 0, replies: 0 }, []],
    update: {
      inc: (s) => [{ ...s, count: s.count + 1 }, []],
      work: (s) => [s, [work({})]],
      // The Cmd after the exit is one the ended life still owed, which never runs.
      stop: (s) => [s, [exit({}), work({})]],
      crash: () => {
        throw new TypeError("lifecycle fixture");
      },
      work_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
      work_err: (s) => [{ ...s, replies: s.replies + 1 }, []],
    },
  }),
  maxDeliveries: 3,
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: () => null,
  inputs: Object.fromEntries(
    ["inc", "work", "stop", "crash"].map((key) => [
      key,
      { ...Schema.TaggedStruct("write", {}).make({}), schema: Msg, personOnly: false, description: key },
    ]),
  ),
  outputs: {},
  writes: {},
  wake: () => null,
};

const open = Effect.fnUntraced(function* () {
  const memory = (): Sql => {
    const db = new DatabaseSync(":memory:");

    return nodeSql(db);
  };

  const project = memory();
  const state = memory();
  let sequence = 0;
  let alarm: number | null = null;
  let worked = 0;
  let input = 0;
  const reads = { status: 0, isLive: 0 };
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
  const real = yield* Layer.build(base);
  const manager = Context.get(real, ProcessManager);

  // The runner's manager counts the lifecycle reads it makes. The law's own reads use the real one.
  const counted = Context.add(real, ProcessManager, {
    ...manager,
    status: (name: string) =>
      Effect.suspend(() => {
        reads.status++;

        return manager.status(name);
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

    return status.state._tag === "live"
      ? { state: "live" as const, process: status.state.process, reason: null }
      : { state: "ended" as const, process: status.state.process, reason: status.state.reason._tag };
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
                Effect.sync(() => {
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
            set: (at: number | null) =>
              Effect.sync(() => {
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

  const send = Effect.fnUntraced(function* (type: "inc" | "work" | "stop" | "crash") {
    input += 1;

    return yield* current.msg({
      id: `letter-${input}`,
      envelope: {
        id: Schema.decodeSync(InputId)(`input_0000000000e008${input.toString(16).padStart(12, "0")}`),
        by: person,
        arrivedAt: yield* Clock.currentTimeMillis,
        input: { type },
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
        return yield* send(move);
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
    reads: Effect.sync(() => ({ ...reads })),
    reset: Effect.sync(() => {
      reads.status = 0;
      reads.isLive = 0;
    }),
  } satisfies RunnerLifecycleTest.World;
});

RunnerLifecycleTest.suite(open());

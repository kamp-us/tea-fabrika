// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: the pipe on real runners, laws S1, W1, W2, O1,
// O2, O3, X2, N1, A1, B1 and G1, written before the build, and no driver. A runner in the module that
// owns a driver calls `PipeTest.suite(open)`; `open` acquires real stores in a scope and gives them
// back when that scope closes (0061, 0062).
//
// The runner, ledger, process table, mailbox, program mail, the brain's `Children` and `Pipes`
// services and every program here are real. A parent test program, `lab`, asks for the pipe and
// starts both ends with `start_child`, the no-shell case 0109 names. Time moves only when a saved
// alarm fires: the walk fires them, as the platform would.
//
// The contract these laws pin, from the plan:
//   Pipe.ts: `pipe`, `Cmd.make("pipe", { input: {from, to}, ok: Piped, err: PipeRefusal })`; `Piped`
//     answers `{_tag: "piped", pipe}` or `{_tag: "unfit", fit}`.
//   Piped.ts: `input(type, shape)` and `ports(type, shape, description)`, what a reader declares.
//   Program.ts: `Output.make(schema, select)`, what a writer declares.
//   PipesLedger.ts: `layer({ fabrika })`, the brain's `Pipes`, as `PipesTest.ts` pins it.
//   Runner.ts: a runner whose context holds `Pipes` performs `pipe` itself; after each step it owes
//     one `send_chunks` of each changed output with a live pipe, under the id
//     `<process>/<pos>/out/<output>`, newest wins; a life's first load sends each piped output that
//     is not `null`; `exit` waits behind an owed send; an owed send's answer is recorded as
//     `cmd.answered` in the writer life's stream and never steps the writer. The reader's runner
//     folds the chunk messages and steps the reader's program once per whole value with
//     `{type, value}`, unwrapped by the writer's declared shape.
//   ProcessManager.ts: the start and restart turns write the reader's watch on the writer's live
//     life, ref `<pipe>/<writer process>`, so the reader gets one `DOWN` per writer life.
// The oracle is the walk's own record of what it set, crashed and started, the programs' saved
// models read from their checkpoints, and the ledger's raw rows; it never calls the product's fold.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { type Runs, runsFor } from "@kampus/vitest";
import {
  Arbitrary,
  ByteSize,
  Clock,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Scope,
} from "effect";
import * as fc from "fast-check";
import { InputId, Writer } from "../coordination/index.ts";
import { Model as FabrikaModel } from "../permissions/Model.ts";
import * as Relation from "../permissions/Relation.ts";
import * as RelationsMemory from "../permissions/RelationsMemory.ts";
import { Sender, Senders } from "../permissions/Senders.ts";
import * as ChildrenLedger from "../processes/ChildrenLedger.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { type From, Mailbox } from "../processes/Mailbox.ts";
import * as PipesLedger from "../processes/PipesLedger.ts";
import { data as ledger } from "../processes/Process.test-support.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import * as ProgramMailLedger from "../processes/ProgramMailLedger.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import * as MailDeliveryLive from "./MailDeliveryLive.ts";
import { MailWakeups, MailWakeupsError } from "./MailWakeups.ts";
import * as Pipe from "./Pipe.ts";
import * as Piped from "./Piped.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Output, Program } from "./Program.ts";
import { ProgramRunner } from "./Runner.ts";
import * as StartChild from "./StartChild.ts";

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

/** One ledger row: its global rev, stream, id, tag and body. */
export type Row = {
  readonly rev: number;
  readonly stream: string;
  readonly id: string;
  readonly tag: string;
  readonly body: unknown;
};

const SEED = 119120;
const BUILD = "pipe-build-a";
const FOUNDER = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const OUTSIDER = "person_01m6v5270hf3c8x2q7w9z4k5zz";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const FABRIKA = FabrikaModel.ref("fabrika", "pipe");
const LAB = "lab:1";
/** A call that does not answer in this long is held behind something it must never wait on. */
const LIMIT = "20 seconds";

const PIDS: ReadonlyArray<string> = Array.from(
  { length: 80 },
  (_, n) => `process_0000000000e00c00${String(n).padStart(10, "0")}`,
);

type Built = Schema.Codec<unknown, unknown>;

// ---------------------------------------------------------------------------------------------
// The programs. Each is made by a factory from the shapes a law draws, so one run builds one pair.

const Json = Schema.Json;
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Json));
/** A value as a message carries it: JSON text, back to JSON. */
const copied = (value: unknown): Schema.Json => decodeJson(JSON.stringify(value));

/** The writer: its value is JSON in its model, and its one output is that value read by its shape. */
const WriterModel = Schema.Struct({ value: Schema.NullOr(Json), seen: Schema.Array(Schema.String) });
type WriterModel = typeof WriterModel.Type;

const WriterMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("set"), value: Schema.NullOr(Json) }),
  Schema.Struct({ type: Schema.Literal("crash") }),
  Schema.Struct({ type: Schema.Literal("quit") }),
]);

const writerProgram = (name: string, shape: Built, initial: Schema.Json | null) => {
  const decode = Schema.decodeUnknownOption(shape);
  return Program.make({
    name,
    machine: Machine.make({
      model: WriterModel,
      msg: WriterMsg,
      cmds: [StartChild.exit],
      init: (loaded) => [loaded ?? { value: initial, seen: [] }, []],
      update: {
        set: (s, m) => [{ value: m.value, seen: [...s.seen, "set"] }, []],
        crash: () => {
          throw new TypeError("planted writer crash");
        },
        quit: (s) => [{ ...s, seen: [...s.seen, "quit"] }, [StartChild.exit({})]],
        exit_ok: (s) => [{ ...s, seen: [...s.seen, "exit_ok"] }, []],
        exit_err: (s) => [{ ...s, seen: [...s.seen, "exit_err"] }, []],
      },
    }),
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { set: "Set the value", crash: "Crash", quit: "Exit" },
    // A null value, or one its shape does not take, is nothing to send (0260).
    outputs: {
      out: Output.make(shape, (m: WriterModel) => (m.value === null ? null : Option.getOrNull(decode(m.value)))),
    },
    writes: {},
    wake: () => null,
  });
};

/** The reader: it keeps each Msg its runner hands it, the value encoded back to JSON by its own shape. */
const ReaderModel = Schema.Struct({ log: Schema.Array(Json) });
type ReaderModel = typeof ReaderModel.Type;

const DownMsg = Schema.Struct({
  type: Schema.Literal("DOWN"),
  ref: Schema.String,
  process: Schema.String,
  name: Schema.optionalKey(Schema.String),
  reason: Json,
});

const CrashMsg = Schema.Struct({ type: Schema.Literal("crash") });

const logged = (s: ReaderModel, entry: unknown): ReaderModel => ({ log: [...s.log, copied(entry)] });

const readerProgram = (name: string, shape: Built) => {
  const encode = Schema.encodeUnknownSync(shape);
  return Program.make({
    name,
    machine: Machine.make({
      model: ReaderModel,
      msg: Schema.Union([Piped.input("in", shape), DownMsg, CrashMsg]),
      cmds: [],
      init: (loaded) => [loaded ?? { log: [] }, []],
      update: {
        in: (s, m) => [logged(s, { type: "in", value: encode(m.value) }), []],
        DOWN: (s, m) => [
          logged(s, { type: "DOWN", ref: m.ref, process: m.process, name: m.name ?? null, reason: m.reason }),
          [],
        ],
        crash: () => {
          throw new TypeError("planted reader crash");
        },
      },
    }),
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { ...Piped.ports("in", shape, "The value this program reads"), crash: "Crash" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};

/** The parent: it asks for pipes, starts and stops children, and keeps every answer it folds. */
const End = Schema.Struct({ name: Schema.String, program: Schema.String });

const LabMsg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pipe"),
    from: Schema.Struct({ ...End.fields, output: Schema.String }),
    to: Schema.Struct({ ...End.fields, input: Schema.String }),
  }),
  Schema.Struct({ type: Schema.Literal("start"), ...End.fields }),
  Schema.Struct({ type: Schema.Literal("stop"), name: Schema.String }),
]);

const labProgram = () =>
  Program.make({
    name: "pipe-lab",
    machine: Machine.make({
      model: ReaderModel,
      msg: LabMsg,
      cmds: [Pipe.pipe, StartChild.startChild, StartChild.stopChild],
      init: (loaded) => [loaded ?? { log: [] }, []],
      update: {
        pipe: (s, m) => [s, [Pipe.pipe({ from: m.from, to: m.to })]],
        start: (s, m) => [s, [StartChild.startChild({ program: m.program, name: m.name })]],
        stop: (s, m) => [s, [StartChild.stopChild({ name: m.name })]],
        pipe_ok: (s, m) => [logged(s, { type: "pipe_ok", value: m.value }), []],
        pipe_err: (s, m) => [logged(s, { type: "pipe_err", reason: m.error._tag }), []],
        start_child_ok: (s, m) => [logged(s, { type: "start_child_ok", value: m.value }), []],
        start_child_err: (s, m) => [logged(s, { type: "start_child_err", reason: m.error._tag }), []],
        stop_child_ok: (s) => [logged(s, { type: "stop_child_ok" }), []],
        stop_child_err: (s, m) => [logged(s, { type: "stop_child_err", reason: m.error._tag }), []],
      },
    }),
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { pipe: "Pipe two programs", start: "Start a child", stop: "Stop a child" },
    outputs: {},
    writes: {},
    wake: () => null,
  });

// ---------------------------------------------------------------------------------------------
// The host: real stores and services, and one runner per registered name.

/** One pipe a world sets up: the writer's and the reader's declared shapes, and the writer's first value. */
type Pair = { readonly writer: Built; readonly reader: Built; readonly initial?: Schema.Json | null };

type Config = {
  readonly pairs: ReadonlyArray<Pair>;
  /** `mail.unread`: the most unread messages a reader's inbox holds. */
  readonly cap: number;
  /** `mail.chunk`: the most bytes in one chunk message. */
  readonly chunk: number;
};

const writerName = (k: number) => `tracker:${k + 1}`;
const readerName = (k: number) => `outline:${k + 1}`;
const writerCode = (k: number) => `pipe-writer-${k}`;
const readerCode = (k: number) => `pipe-reader-${k}`;

const person = (id: string) => Writer.cases.person.make({ key: `SHA256:${id}`, for: id });

const brainFrom = (): From => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-15T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
});

const inputId = (n: number) =>
  Schema.decodeUnknownSync(InputId)(`input_0000000000e00c${n.toString(16).padStart(12, "0")}`);

const ids = (values: ReadonlyArray<string>) => {
  let calls = 0;
  return Effect.sync(() => {
    const value = values[calls++];

    if (value === undefined) {
      throw new Error("test exhausted its process IDs");
    }

    return value;
  });
};

/** A call that may fail, yet must answer, never hang. */
const answers = <A, E>(effect: Effect.Effect<A, E>, label: string) =>
  effect.pipe(
    Effect.result,
    Effect.timeoutOption(LIMIT),
    Effect.map((answer) => {
      expect(Option.isSome(answer), `${label} answers: nothing holds it`).toBe(true);
      return Option.getOrThrow(answer);
    }),
  );

const decodeReader = Schema.decodeUnknownOption(ReaderModel);
const decodeWriter = Schema.decodeUnknownOption(WriterModel);

/** A logged entry, read back. */
type Logged = {
  readonly type: string;
  readonly value?: unknown;
  readonly reason?: unknown;
  readonly ref?: string;
  readonly process?: string;
  readonly name?: string | null;
};

const asLogged = (entry: Schema.Json): Logged =>
  Option.getOrElse(
    Schema.decodeUnknownOption(
      Schema.Struct({
        type: Schema.String,
        value: Schema.optionalKey(Schema.Unknown),
        reason: Schema.optionalKey(Schema.Unknown),
        ref: Schema.optionalKey(Schema.String),
        process: Schema.optionalKey(Schema.String),
        name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    )(entry),
    (): Logged => ({ type: "unknown" }),
  );

/**
 * One walk's world: the host on real stores, and what a caller can see of it. A reopen closes the
 * host and opens it again on the same stores, as a host that went away does.
 */
const pipeWorld = Effect.fnUntraced(function* (open: Effect.Effect<Store, never, Scope.Scope>, config: Config) {
  const store = yield* open;
  const next = ids(PIDS);
  const senders = new Map<string, typeof Sender.Type>();
  const alarms = new Map<string, number>();
  const programs: Record<string, unknown> = {
    "pipe-lab": labProgram(),
    ...Object.fromEntries(
      config.pairs.flatMap((pair, k) => [
        [writerCode(k), writerProgram(writerCode(k), pair.writer, pair.initial ?? null)],
        [readerCode(k), readerProgram(readerCode(k), pair.reader)],
      ]),
    ),
  };
  /** Each runner by name, and the scope it lives in, so an outside restart can give the name a new one. */
  const runners = new Map<string, { readonly runner: ProgramRunner["Service"]; readonly scope: Scope.Closeable }>();

  const hostLife = Effect.fnUntraced(function* (scope: Scope.Scope) {
    const owner = Relation.Row.cases.related.make({ subject: `person:${FOUNDER}`, relation: "owner", object: FABRIKA });
    const gateway = Layer.succeed(Senders, {
      sender: (parent: string | null) =>
        Effect.succeed(Option.fromUndefinedOr(parent === null ? undefined : senders.get(parent))),
    });
    const wakeups = Layer.succeed(MailWakeups, {
      wake: (name: string) =>
        Effect.suspend(() => {
          const held = runners.get(name);
          return held === undefined
            ? Effect.void
            : held.runner.mailed.pipe(
                Effect.mapError((cause) => new MailWakeupsError({ reason: "unavailable", cause })),
              );
        }),
    });
    const brainSide = Layer.mergeAll(
      ProgramMailLedger.layer({ grants: {}, cap: config.cap }),
      ChildrenLedger.layer({ grants: [], fabrika: FABRIKA }),
      PipesLedger.layer({ fabrika: FABRIKA }),
    ).pipe(Layer.provideMerge(RelationsMemory.layer([{ id: "owner", row: owner }])), Layer.provideMerge(gateway));
    const shared = MailDeliveryLive.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(brainSide, wakeups)),
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
      Layer.provideMerge(ledger(store.sql("ledger"))),
    );
    return yield* Layer.buildWithScope(shared, scope);
  });

  let scope = yield* Scope.make();
  let context = yield* hostLife(scope);
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const inContext = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(context));
  /** The program each name runs: the lab, and each pair's two ends. A refused pipe's reader is `board:1`. */
  const programFor = (name: string): string => {
    if (name === LAB) {
      return "pipe-lab";
    }

    const k = config.pairs.findIndex((_, n) => name === writerName(n) || name === readerName(n));
    return k < 0 ? readerCode(1) : name === writerName(k) ? writerCode(k) : readerCode(k);
  };
  const status = (name: string) => inContext(ProcessManager.use((p) => p.status(name)));
  const liveLife = (name: string) =>
    status(name).pipe(
      Effect.map((s) => (s.state._tag === "live" ? Option.some(s.state.process) : Option.none<string>())),
      Effect.orElseSucceed(() => Option.none<string>()),
    );
  const processFor = (name: string) =>
    status(name).pipe(
      Effect.map((s) => s.state.process),
      Effect.orDie,
    );

  /** Builds the runner for `name`'s current life and runs its first turn, OTP's init/1. */
  const build = Effect.fnUntraced(function* (name: string) {
    const pid = yield* processFor(name);
    const program = programFor(name);
    const own = yield* Scope.fork(scope);
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
    const services = Layer.mergeAll(
      ProgramLoader.layer(programs, {}),
      ProcessStore.layer(store.sql(`process-${name}`), { process: pid }),
      Layer.succeed(Alarm, {
        set: (at: number | null) => Effect.sync(() => (at === null ? alarms.delete(name) : alarms.set(name, at))),
      }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(context)));
    const layer = ProgramRunner.layer(
      { id: pid, name, program, build: BUILD, owner: person(FOUNDER) },
      {
        recovery: { sql: store.sql(`recovery-${name}`), name, capacity: 1024 ** 3 },
        chunk: ByteSize.bytes(config.chunk),
        policy: { intensity: 40, periodMs: 600_000, backoff: { minMs: 1, maxMs: 2, resetAfterMs: 5_000 } },
      },
    ).pipe(Layer.provide(services));
    const runner = Context.get(yield* Layer.buildWithScope(layer, own), ProgramRunner);
    runners.set(name, { runner, scope: own });
    yield* answers(runner.init(), `${name}'s first turn`);
    return runner;
  });

  /** The runner of `name`, built on first use. */
  const runner = Effect.fnUntraced(function* (name: string) {
    const held = runners.get(name);
    return held === undefined ? yield* build(name) : held.runner;
  });

  /** Gives `name` a new runner for its current life, as a host does for a life the brain restarted. */
  const rebuild = Effect.fnUntraced(function* (name: string) {
    const held = runners.get(name);

    if (held !== undefined) {
      runners.delete(name);
      yield* Scope.close(held.scope, Exit.void);
    }

    return yield* build(name);
  });

  let letters = 0;
  /** A person's input to `name`, as the door delivers it: recorded with its sender, then handed in. */
  const say = Effect.fnUntraced(function* (name: string, input: unknown, by: string = FOUNDER) {
    const n = ++letters;
    const id = inputId(n);
    senders.set(id, Sender.cases.person.make({ key: `SHA256:${by}`, for: by }));
    const r = yield* runner(name);
    return yield* answers(
      r.msg({
        id: `letter-${n}`,
        envelope: { id, by: person(by), arrivedAt: 1794099600000 + n, input },
        sentAt: "2026-11-15T01:00:00Z",
        seen: 0,
        span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
      } satisfies Incoming),
      `${name}'s ${JSON.stringify(input).slice(0, 80)}`,
    );
  });

  /** Fires the saved alarms of `names` once each, waiting out a backoff first; true when one fired. */
  const fire = Effect.fnUntraced(function* (names: ReadonlyArray<string>) {
    let fired = false;

    for (const name of names) {
      const at = alarms.get(name);

      if (at === undefined) {
        continue;
      }

      alarms.delete(name);
      const now = yield* Clock.currentTimeMillis;

      if (at > now) {
        yield* Effect.sleep(at - now + 1);
      }

      const r = yield* runner(name);
      yield* answers(r.due(Math.max(at, yield* Clock.currentTimeMillis)), `${name}'s alarm`);
      fired = true;
    }

    return fired;
  });

  /** Every name with a runner, and the children the lab may have started since. */
  const known = Effect.fnUntraced(function* () {
    for (const k of config.pairs.keys()) {
      for (const name of [writerName(k), readerName(k)]) {
        if (!runners.has(name) && Option.isSome(yield* liveLife(name))) {
          yield* build(name);
        }
      }
    }

    return [...runners.keys()];
  });

  /** Fires alarms of `only` (every name when left out) until none is left. */
  const settle = Effect.fnUntraced(function* (only?: ReadonlyArray<string>) {
    for (let round = 0; round < 400; round++) {
      const names = only ?? (yield* known());

      if (!(yield* fire(names))) {
        return;
      }
    }

    expect.fail("the alarms never settled");
  });

  const checkpoint = Effect.fnUntraced(function* (name: string, pid?: string) {
    const process = pid ?? (yield* processFor(name));
    return yield* inContext(
      ProcessStore.use((s) => s.load).pipe(
        Effect.provide(ProcessStore.layer(store.sql(`process-${name}`), { process })),
      ),
    ).pipe(Effect.orDie);
  });
  /** The entries a reader's or the lab's program logged, read from its checkpoint. */
  const log = Effect.fnUntraced(function* (name: string) {
    const saved = yield* checkpoint(name);
    return Option.match(decodeReader(saved?.saved.model ?? null), { onNone: () => [], onSome: (m) => m.log }).map(
      asLogged,
    );
  });
  /** The values a reader's program was handed, in order. */
  const handed = (name: string) =>
    Effect.map(log(name), (entries) => entries.filter((e) => e.type === "in").map((e) => e.value));
  const downs = (name: string) => Effect.map(log(name), (entries) => entries.filter((e) => e.type === "DOWN"));
  const writerModel = Effect.fnUntraced(function* (name: string) {
    const saved = yield* checkpoint(name);
    return Option.getOrUndefined(decodeWriter(saved?.saved.model ?? null));
  });
  const rows = (streams: ReadonlyArray<string>) => store.entries(streams);

  /** Asks the lab for pair `k`'s pipe, and answers the lab's logged answer. */
  const pipe = Effect.fnUntraced(function* (
    k: number,
    over: { readonly to?: { name: string; program: string }; readonly by?: string } = {},
  ) {
    const before = (yield* log(LAB)).length;
    yield* say(
      LAB,
      {
        type: "pipe",
        from: { name: writerName(k), program: writerCode(k), output: "out" },
        to: { ...(over.to ?? { name: readerName(k), program: readerCode(k) }), input: "in" },
      },
      over.by,
    );
    yield* settle([LAB]);
    return (yield* log(LAB)).slice(before);
  });
  /** The lab starts `name` as a child, and the host gives it a runner. */
  const start = Effect.fnUntraced(function* (name: string, program: string) {
    yield* say(LAB, { type: "start", name, program });
    yield* settle([LAB]);
    yield* known();
  });

  const reopen = Effect.fnUntraced(function* () {
    runners.clear();
    yield* Scope.close(scope, Exit.void);
    yield* store.reopen;
    scope = yield* Scope.make();
    context = yield* hostLife(scope);
  });

  /** Supervision ends a life from outside its runner, with any reason. */
  const end = Effect.fnUntraced(function* (name: string, reason: ExitReason) {
    const pid = yield* processFor(name);
    yield* inContext(ProcessManager.use((p) => p.exit(pid, reason, brainFrom()))).pipe(Effect.orDie);
    return pid;
  });
  /** The brain starts the name again after its life ended, and the host gives the new life a runner. */
  const restart = Effect.fnUntraced(function* (name: string, after: string, program: string) {
    yield* inContext(
      ProcessManager.use((p) =>
        p.start(
          Start.cases.again.make({
            id: `again:${name}:${after}`,
            name,
            code: { program, hash: BUILD },
            after,
            reason: "crashed",
          }),
          brainFrom(),
        ),
      ),
    ).pipe(Effect.orDie);
    return yield* rebuild(name);
  });

  /** Boots the lab, the founder's own program. */
  const placed = yield* inContext(
    ProcessManager.use((p) =>
      p.start(
        Start.cases.first.make({
          id: `boot:${LAB}`,
          name: LAB,
          code: { program: "pipe-lab", hash: BUILD },
          member: Sender.cases.person.make({ key: `SHA256:${FOUNDER}`, for: FOUNDER }),
        }),
        brainFrom(),
      ),
    ),
  ).pipe(Effect.orDie);
  yield* runner(LAB);

  return {
    lab: placed.process,
    say,
    fire,
    settle,
    log,
    handed,
    downs,
    writerModel,
    rows,
    pipe,
    start,
    reopen,
    end,
    restart,
    processFor,
    liveLife,
    status,
    checkpoint,
  };
});

type World = Effect.Success<ReturnType<typeof pipeWorld>>;

/** Pipes pair `k` and starts its reader, then its writer, as the plan's trace does. Answers the pipe's id. */
const connect = Effect.fnUntraced(function* (w: World, k: number) {
  const answer = (yield* w.pipe(k))[0];
  expect(answer?.type, `pair ${k}: the lab's pipe is answered`).toBe("pipe_ok");
  expect(Predicate.isTagged(answer?.value, "piped"), `pair ${k}: the lab's pipe is made`).toBe(true);
  const id = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Struct({ pipe: Schema.String }) }))(answer).value
    .pipe;
  yield* w.start(readerName(k), readerCode(k));
  yield* w.start(writerName(k), writerCode(k));
  yield* w.settle();
  return id;
});

/** Runs `law` on generated values, each in a fresh scope, from the shared seed. */
const property = <A>(
  arbitrary: fc.Arbitrary<A>,
  law: (value: A) => Effect.Effect<void, unknown, Scope.Scope>,
  runs: Runs,
  examples: ReadonlyArray<[A]> = [],
) =>
  Effect.gen(function* () {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each generated walk
    const checked = fc.asyncProperty(arbitrary, (value) => Effect.runPromise(Effect.scoped(law(value))));
    // Each run starts real runners. Shrinking would run hundreds more, so the first failing case is reported.
    const options = {
      seed: SEED,
      numRuns: runsFor(runs),
      includeErrorInReport: true,
      endOnFailure: true,
      examples: [...examples],
    };
    // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
    yield* Effect.promise(() => fc.assert(checked, options));
  });

/** Whether `got` is a subsequence of `all`, value by value, in order. */
const inOrder = (got: ReadonlyArray<unknown>, all: ReadonlyArray<unknown>): boolean => {
  let at = 0;

  for (const value of got) {
    const found = all.findIndex((v, n) => n >= at && JSON.stringify(v) === JSON.stringify(value));

    if (found < 0) {
      return false;
    }

    at = found + 1;
  }

  return true;
};

// ---------------------------------------------------------------------------------------------
// Shapes and values.

const Str = Schema.String;
const Row3 = Schema.Struct({ id: Str, title: Str, state: Str });
const Row2 = Schema.Struct({ id: Str, title: Str });
const pad = (n: number) => "x".repeat(n);

/** `count` rows of about 180 bytes each, as the plan's trace has them, tagged with `tag`. */
const rows3 = (tag: string, count: number) =>
  Array.from({ length: count }, (_, n) => ({ id: `${tag}-${n}`, title: pad(140), state: "open" }));

/** X1's declared shapes: X2, A1 and N1 draw from them. */
const SHAPES: ReadonlyArray<readonly [string, Built]> = [
  ["a number", Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))],
  ["a string", Schema.String],
  ["a struct", Row2],
  ["a struct with a null field", Schema.Struct({ id: Str, note: Schema.NullOr(Str) })],
  ["a list", Schema.Array(Row2)],
  ["a list of lists", Schema.Array(Schema.Array(Schema.Int))],
];

/** A value of `schema`, encoded and through JSON, and not `null` at the top (0260). */
const drawValue = (schema: Built) =>
  fc.nat().map((seed) => {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's map takes a plain value, so one sample is drawn here
    const [value] = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }));
    const encoded = Schema.encodeUnknownResult(schema)(value);
    return Result.isSuccess(encoded) ? copied(encoded.success) : null;
  });

/** X2's cases: a shape and a value of it, and the plan's edges. */
const ValueCase = fc
  .oneof(
    {
      weight: 3,
      arbitrary: fc.nat({ max: SHAPES.length - 1 }).chain((at) => {
        const [label, schema] = SHAPES[at] ?? expect.fail("a shape");
        return drawValue(schema).map((value) => ({ label, schema, value }));
      }),
    },
    {
      weight: 2,
      arbitrary: fc.constantFrom(
        { label: "an empty list", schema: Schema.Array(Row2), value: copied([]) },
        { label: "a list of one", schema: Schema.Array(Row2), value: copied([{ id: "a", title: "one" }]) },
        { label: "a list that needs several chunks", schema: Schema.Array(Row3), value: copied(rows3("many", 30)) },
        { label: "a list of lists", schema: Schema.Array(Schema.Array(Schema.Int)), value: copied([[1, 2], [], [3]]) },
      ),
    },
  )
  .filter((c): c is { label: string; schema: Built; value: Schema.Json } => c.value !== null);

// ---------------------------------------------------------------------------------------------
// The laws.

/** S1 on one pair: the whole pipe with no shell. */
const s1 = (open: Effect.Effect<Store, never, Scope.Scope>, kind: "list" | "struct") =>
  Effect.gen(function* () {
    const list = kind === "list";
    const pair: Pair = list
      ? { writer: Schema.Array(Row3), reader: Schema.Array(Row2) }
      : { writer: Row3, reader: Row2 };
    // A third program the lab may pipe to: board needs a `column` no tracker row has.
    const Column = Schema.Struct({ id: Str, column: Str });
    const board: Pair = list
      ? { writer: Schema.Array(Row3), reader: Schema.Array(Column) }
      : { writer: Row3, reader: Column };
    const w = yield* pipeWorld(open, { pairs: [pair, board], cap: 1, chunk: 1_024 });
    const label = `S1 (${kind})`;
    const value = (tag: string, count: number) =>
      copied(list ? rows3(tag, count) : { id: tag, title: pad(40), state: "open" });
    // What the reader declares: its own struct decode keeps only the fields it needs.
    const seen = (v: Schema.Json) =>
      copied(Schema.encodeUnknownSync(pair.reader)(Schema.decodeUnknownSync(pair.reader)(v)));

    // 1. The pipe, then the reader, then the writer.
    const pipeId = yield* connect(w, 0);
    const reader = readerName(0);
    const writer = writerName(0);
    const first = yield* w.processFor(writer);

    // 2. The first value arrives whole, in the reader's own shape.
    const v1 = value("v1", 6);
    yield* w.say(writer, { type: "set", value: v1 });
    yield* w.settle();
    expect(yield* w.handed(reader), `${label}: the reader is handed the first value whole, in its own shape`).toEqual([
      seen(v1),
    ]);

    // 3. Three changes while the reader's inbox is full: the newest wins.
    const v2 = value("v2", 6);
    const v3 = value("v3", 6);
    const v4 = value("v4", 6);

    for (const v of [v2, v3, v4]) {
      yield* w.say(writer, { type: "set", value: v });
    }

    yield* w.settle();
    const after = (yield* w.handed(reader)).slice(1);
    expect(after.at(-1), `${label}: the reader ends on the newest value`).toEqual(seen(v4));
    expect(after, `${label}: a value replaced before it started is never handed`).not.toContainEqual(seen(v3));
    expect(inOrder(after, [v2, v3, v4].map(seen)), `${label}: each value handed is one whole value, in order`).toBe(
      true,
    );

    // 4. The writer crashes mid-send: the reader keeps the value it had, and gets one DOWN. A list is
    // cut between its chunks; a single value is one message, so it is owed behind a full inbox.
    const v5a = value("v5a", 1);
    const v5 = value("v5", list ? 12 : 1);

    if (!list) {
      yield* w.say(writer, { type: "set", value: v5a });
    }

    yield* w.say(writer, { type: "set", value: v5 });
    yield* w.say(writer, { type: "crash" });
    yield* w.settle([reader]);
    const mid = yield* w.log(reader);
    const lastIn = mid.filter((e) => e.type === "in").at(-1);
    const had = list ? seen(v4) : seen(v5a);
    expect(lastIn?.value, `${label}: a writer that crashed mid-send leaves the reader on the value it had`).toEqual(
      had,
    );
    expect(
      mid.filter((e) => e.type === "DOWN").map((e) => e.ref),
      `${label}: one DOWN for the life that crashed`,
    ).toEqual([`${pipeId}/${first}`]);

    // 5. Supervision restarts the writer: the reader is handed the new life's first whole value.
    yield* w.settle();
    const second = yield* w.processFor(writer);
    expect(second, `${label}: the writer is a new life`).not.toBe(first);
    expect((yield* w.handed(reader)).at(-1), `${label}: the new life's first value arrives whole`).toEqual(seen(v5));
    const crash = yield* w.end(writer, ExitReason.cases.crashed.make({ phase: "step" }));
    yield* w.settle([reader]);
    const ends = (yield* w.downs(reader)).map((e) => e.ref);
    expect(ends, `${label}: exactly one DOWN per writer life`).toEqual([`${pipeId}/${first}`, `${pipeId}/${crash}`]);

    // 6. A pipe that does not fit, and one the member may not make: refused, nothing written, nothing started.
    const before = yield* w.rows(["pipes", Relation.STREAM]);
    const unfit = yield* w.pipe(1, { to: { name: "board:1", program: readerCode(1) } });
    expect(
      unfit.map((e) => e.type),
      `${label}: a pipe that does not fit is answered`,
    ).toEqual(["pipe_ok"]);
    const verdict = unfit[0]?.value;
    expect(Predicate.isTagged(verdict, "unfit"), `${label}: a pipe that does not fit is refused unfit`).toBe(true);
    expect(
      Predicate.hasProperty(verdict, "fit") && Predicate.isTagged(verdict.fit, "does_not_fit"),
      `${label}: board's missing column is does_not_fit`,
    ).toBe(true);
    const outsider = yield* w.pipe(1, { by: OUTSIDER });
    expect(outsider, `${label}: a member who may not pipe is refused`).toMatchObject([
      { type: "pipe_err", reason: "forbidden" },
    ]);
    expect(
      yield* w.rows(["pipes", Relation.STREAM]),
      `${label}: a refused pipe writes nothing on either stream`,
    ).toEqual(before);
    expect(Option.isNone(yield* w.liveLife("board:1")), `${label}: nothing starts`).toBe(true);
  });

/** W1's moves: each picks what is possible from the walk's own record. */
type WMove = "send" | "end" | "read";

const WCell = fc.record({
  move: fc.constantFrom<WMove>("send", "send", "end", "read"),
  reason: fc.nat().map((seed) => {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's map takes a plain value, so one sample is drawn here
    const [value] = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(ExitReason), { seed, count: 1 }));
    return value ?? ExitReason.cases.normal.make({});
  }),
  size: fc.integer({ min: 1, max: 10 }),
});
type WCell = typeof WCell extends fc.Arbitrary<infer A> ? A : never;

const encodeReason = Schema.encodeSync(ExitReason);

const decodeChunk = Schema.decodeUnknownOption(
  Schema.Struct({
    m: Schema.Struct({ part: Schema.Struct({ id: Schema.String, seq: Schema.Int, last: Schema.Boolean }) }),
  }),
);

const decodeDownRow = Schema.decodeUnknownOption(Schema.Struct({ m: Schema.Struct({ ref: Schema.String }) }));

/** W1 on one walk: one DOWN per writer life, with that life's reason, after its last saved message. */
const w1 = (open: Effect.Effect<Store, never, Scope.Scope>, reached: Set<string>) =>
  Effect.fnUntraced(function* (cells: ReadonlyArray<WCell>) {
    const w = yield* pipeWorld(open, {
      pairs: [{ writer: Schema.Array(Row3), reader: Schema.Array(Row3) }],
      cap: 2,
      chunk: 1_024,
    });
    const pipeId = yield* connect(w, 0);
    const writer = writerName(0);
    const reader = readerName(0);
    const ended = new Map<string, ExitReason>();
    let fresh = true;
    let n = 0;

    for (const cell of cells) {
      switch (cell.move) {
        case "send": {
          yield* w.say(writer, { type: "set", value: copied(rows3(`w${++n}`, cell.size)) });
          fresh = false;
          reached.add(cell.size > 6 ? "send:chunked" : "send");
          break;
        }
        case "end": {
          const pid = yield* w.end(writer, cell.reason);
          ended.set(pid, cell.reason);
          reached.add(fresh ? "end:right after start" : "end");
          yield* w.restart(writer, pid, writerCode(0));
          fresh = true;
          break;
        }
        case "read": {
          yield* w.settle([reader]);
          reached.add("read");
          break;
        }
      }
    }

    yield* w.settle();
    const downs = yield* w.downs(reader);
    const inbox = yield* w.rows([`${reader}/inbox`]);

    for (const [pid, reason] of ended) {
      const mine = downs.filter((d) => d.ref === `${pipeId}/${pid}`);
      expect(mine.length, `W1: one DOWN for ${pid}`).toBe(1);
      expect(mine[0], `W1: ${pid}'s DOWN names the writer and that life's reason`).toMatchObject({
        name: writer,
        process: pid,
        reason: encodeReason(reason),
      });
      // After that life's last saved message: no chunk of that life lands after its DOWN.
      const downAt =
        inbox.find((r) => Option.exists(decodeDownRow(r.body), (b) => b.m.ref === `${pipeId}/${pid}`))?.rev ?? -1;
      const chunks = inbox.filter((r) => Option.exists(decodeChunk(r.body), (b) => b.m.part.id.startsWith(`${pid}/`)));
      expect(
        chunks.every((r) => r.rev < downAt),
        `W1: ${pid}'s chunks all land before its DOWN`,
      ).toBe(true);

      if (chunks.length > 0 && !chunks.some((r) => Option.exists(decodeChunk(r.body), (b) => b.m.part.last))) {
        reached.add("end:mid-send");
      }
    }

    expect(downs.length, "W1: no DOWN for a life that did not end").toBe(ended.size);
  });

/** W2: a new reader life gets a watch on the writer's live life in its restart turn. */
const w2 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.gen(function* () {
    const w = yield* pipeWorld(open, {
      pairs: [{ writer: Schema.Array(Row3), reader: Schema.Array(Row3) }],
      cap: 4,
      chunk: 1_024,
    });
    const pipeId = yield* connect(w, 0);
    const writer = writerName(0);
    const reader = readerName(0);
    const readerLife = yield* w.processFor(reader);
    yield* w.say(reader, { type: "crash" });
    yield* w.settle();
    expect(yield* w.processFor(reader), "W2: the reader is a new life").not.toBe(readerLife);
    const writerLife = yield* w.processFor(writer);
    yield* w.say(writer, { type: "crash" });
    yield* w.settle();
    expect(
      (yield* w.downs(reader)).map((d) => d.ref),
      "W2: the new reader life gets the writer's DOWN",
    ).toContain(`${pipeId}/${writerLife}`);
  });

/** O1's moves. */
type OMove = "change" | "read" | "retry";

const OCell = fc.record({
  move: fc.constantFrom<OMove>("change", "change", "read", "retry"),
  size: fc.integer({ min: 1, max: 9 }),
});
type OCell = typeof OCell extends fc.Arbitrary<infer A> ? A : never;

/** O1 on one walk: newest wins, and every value handed is one whole writer value, in order. */
const o1 = (open: Effect.Effect<Store, never, Scope.Scope>, list: boolean, reached: Set<string>) =>
  Effect.fnUntraced(function* (cells: ReadonlyArray<OCell>) {
    const shape = list ? Schema.Array(Row3) : Row3;
    const w = yield* pipeWorld(open, { pairs: [{ writer: shape, reader: shape }], cap: 1, chunk: 1_024 });
    yield* connect(w, 0);
    const writer = writerName(0);
    const reader = readerName(0);
    const values: Array<Schema.Json> = [];

    for (const [n, cell] of cells.entries()) {
      switch (cell.move) {
        case "change": {
          const v = copied(
            list ? rows3(`o${n}`, cell.size) : { id: `o${n}`, title: pad(cell.size * 10), state: "open" },
          );
          values.push(v);
          yield* w.say(writer, { type: "set", value: v });
          break;
        }
        case "read":
          yield* w.fire([reader]);
          break;
        case "retry":
          yield* w.fire([writer]);
          break;
      }
    }

    yield* w.settle();
    const got = yield* w.handed(reader);
    const label = `O1 (${list ? "list" : "single"}) after ${values.length} changes`;
    expect(inOrder(got, values), `${label}: each value handed is one whole writer value, in the writer's order`).toBe(
      true,
    );

    if (values.length > 0) {
      expect(got.at(-1), `${label}: the last value handed is the writer's last`).toEqual(values.at(-1));
      reached.add(got.length < values.length ? "dropped" : "all");
    }
  });

/** The chunk messages of `pid` in a reader's inbox. */
const chunksFrom = (inbox: ReadonlyArray<Row>, pid: string) =>
  inbox.flatMap((r) => Option.toArray(decodeChunk(r.body))).filter((b) => b.m.part.id.startsWith(`${pid}/`));

/** O2: a life's first value is sent once, a wake sends nothing new, a restart sends again, null sends nothing. */
const o2 = (open: Effect.Effect<Store, never, Scope.Scope>, list: boolean) =>
  Effect.gen(function* () {
    const shape = list ? Schema.Array(Row3) : Row3;
    const v0 = copied(list ? rows3("first", 8) : { id: "first", title: pad(30), state: "open" });
    const w = yield* pipeWorld(open, {
      pairs: [
        { writer: shape, reader: shape, initial: v0 },
        { writer: shape, reader: shape, initial: null },
      ],
      cap: 16,
      chunk: 1_024,
    });
    const label = `O2 (${list ? "list" : "single"})`;
    yield* connect(w, 0);
    const reader = readerName(0);
    const writer = writerName(0);
    const life = yield* w.processFor(writer);
    expect(yield* w.handed(reader), `${label}: a life's first value is sent once`).toEqual([v0]);
    const inbox = () => w.rows([`${reader}/inbox`]);
    const sent = chunksFrom(yield* inbox(), life).length;
    // The host goes away and comes back: the same life wakes, and sends nothing new.
    yield* w.reopen();
    yield* w.settle();
    expect(chunksFrom(yield* inbox(), life).length, `${label}: a wake of the same life sends nothing`).toBe(sent);
    expect(yield* w.handed(reader), `${label}: a wake hands nothing new`).toEqual([v0]);
    // A crash and a restart: the new life sends its value again, from seq 0.
    yield* w.say(writer, { type: "crash" });
    yield* w.settle();
    const again = yield* w.processFor(writer);
    const resent = chunksFrom(yield* inbox(), again);
    expect(resent[0]?.m.part.seq, `${label}: a restart sends again from seq 0`).toBe(0);
    expect(yield* w.handed(reader), `${label}: the restarted life's value is handed`).toEqual([v0, v0]);
    // A writer whose value is null sends nothing, at its first load and after.
    yield* connect(w, 1);
    const empty = yield* w.processFor(writerName(1));
    yield* w.say(writerName(1), { type: "set", value: null });
    yield* w.settle();
    expect(
      chunksFrom(yield* w.rows([`${readerName(1)}/inbox`]), empty),
      `${label}: a null value sends nothing`,
    ).toEqual([]);
    expect(yield* w.handed(readerName(1)), `${label}: a null value hands nothing`).toEqual([]);
  });

/** O3: exit flushes an owed send before its DOWN; a kill mid-send leaves the reader on its value. */
const o3 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.gen(function* () {
    const shape = Schema.Array(Row3);
    const w = yield* pipeWorld(open, {
      pairs: [
        { writer: shape, reader: shape },
        { writer: shape, reader: shape },
      ],
      cap: 1,
      chunk: 1_024,
    });
    const pipeId = yield* connect(w, 0);
    const writer = writerName(0);
    const reader = readerName(0);
    const life = yield* w.processFor(writer);
    const v1 = copied(rows3("e1", 2));
    const v2 = copied(rows3("e2", 2));
    yield* w.say(writer, { type: "set", value: v1 });
    yield* w.say(writer, { type: "set", value: v2 });
    yield* w.say(writer, { type: "quit" });
    yield* w.settle();
    const entries = yield* w.log(reader);
    const lastIn = entries.findLastIndex((e) => e.type === "in");
    const down = entries.findIndex((e) => e.type === "DOWN" && e.ref === `${pipeId}/${life}`);
    expect(entries[lastIn]?.value, "O3: a writer that exits gets its last value to the reader").toEqual(v2);
    expect(lastIn < down, "O3: the last value comes before the DOWN").toBe(true);
    expect(entries[down]?.reason, "O3: the DOWN says normal").toEqual(encodeReason(ExitReason.cases.normal.make({})));

    // A kill between two chunks of a list leaves the reader on the value it had.
    const kept = yield* connect(w, 1);
    const killed = yield* w.processFor(writerName(1));
    const k1 = copied(rows3("k1", 2));
    yield* w.say(writerName(1), { type: "set", value: k1 });
    yield* w.settle();
    yield* w.say(writerName(1), { type: "set", value: copied(rows3("k2", 14)) });
    yield* w.end(writerName(1), ExitReason.cases.kill.make({}));
    yield* w.settle([readerName(1)]);
    expect((yield* w.handed(readerName(1))).at(-1), "O3: a kill mid-send leaves the reader on its value").toEqual(k1);
    expect(
      (yield* w.downs(readerName(1))).map((d) => d.ref),
      "O3: and one DOWN",
    ).toEqual([`${kept}/${killed}`]);
  });

/** X2 on one case: through real runners, the reader is handed the value once, as it was given. */
const x2 = (open: Effect.Effect<Store, never, Scope.Scope>, reached: Set<string>) =>
  Effect.fnUntraced(function* (c: { readonly label: string; readonly schema: Built; readonly value: Schema.Json }) {
    const w = yield* pipeWorld(open, { pairs: [{ writer: c.schema, reader: c.schema }], cap: 4, chunk: 1_024 });
    yield* connect(w, 0);
    yield* w.say(writerName(0), { type: "set", value: c.value });
    yield* w.settle();
    expect(yield* w.handed(readerName(0)), `X2: ${c.label} arrives once, as it was given`).toEqual([c.value]);
    reached.add(c.label);
  });

/** N1's values: a list of nullable integers, and a struct with a nullable field. */
const N1_LIST = [null, [], [null], [null, null], [7]] as const;
const N1_STRUCT = [null, { note: null }] as const;

const N1Case = fc.oneof(
  fc.record({
    list: fc.constant(true),
    values: fc.array(fc.constantFrom(...N1_LIST), { minLength: 1, maxLength: 12 }),
  }),
  fc.record({
    list: fc.constant(false),
    values: fc.array(fc.constantFrom(...N1_STRUCT), { minLength: 1, maxLength: 12 }),
  }),
);
type N1Case = typeof N1Case extends fc.Arbitrary<infer A> ? A : never;

/** N1 on one walk: a selector's null sends nothing; a null inside a value is data. */
const n1 = (open: Effect.Effect<Store, never, Scope.Scope>, reached: Set<string>) =>
  Effect.fnUntraced(function* (c: N1Case) {
    const shape: Built = c.list
      ? Schema.Array(Schema.NullOr(Schema.Int))
      : Schema.Struct({ note: Schema.NullOr(Schema.String) });
    const w = yield* pipeWorld(open, { pairs: [{ writer: shape, reader: shape }], cap: 16, chunk: 1_024 });
    yield* connect(w, 0);
    const expected: Array<unknown> = [];
    let was: unknown = null;

    for (const v of c.values) {
      yield* w.say(writerName(0), { type: "set", value: copied(v) });
      yield* w.settle();

      // An output owes a send only when its value changed, and a null is nothing to send.
      if (JSON.stringify(v) !== JSON.stringify(was) && v !== null) {
        expected.push(copied(v));
      }

      was = v;
      reached.add(JSON.stringify(v));
    }

    expect(yield* w.handed(readerName(0)), `N1: ${JSON.stringify(c)}`).toEqual(expected);
  });

/** A1 on one case: a reader of anything is handed the writer's value as the writer declared it. */
const a1 = (open: Effect.Effect<Store, never, Scope.Scope>, reached: Set<string>) =>
  Effect.fnUntraced(function* (c: { readonly label: string; readonly schema: Built; readonly value: Schema.Json }) {
    const w = yield* pipeWorld(open, { pairs: [{ writer: c.schema, reader: Schema.Unknown }], cap: 4, chunk: 1_024 });
    yield* connect(w, 0);
    yield* w.say(writerName(0), { type: "set", value: c.value });
    yield* w.settle();
    expect(yield* w.handed(readerName(0)), `A1: ${c.label} into a reader of anything`).toEqual([c.value]);
    reached.add(c.label);
  });

const B1Case = fc.record({
  chunk: fc.integer({ min: 1_024, max: 4_096 }),
  over: fc.integer({ min: 1, max: 600 }),
  list: fc.boolean(),
  index: fc.nat({ max: 4 }),
});
type B1Case = typeof B1Case extends fc.Arbitrary<infer A> ? A : never;

const decodeAnswered = Schema.decodeUnknownOption(
  Schema.Struct({
    m: Schema.Struct({
      type: Schema.Literal("send_chunks_err"),
      error: Schema.TaggedStruct("too_big", {}),
    }),
  }),
);

/** B1 on one case: an item whose message alone is over `mail.chunk` is refused too_big, and nothing is sent. */
const b1 = (open: Effect.Effect<Store, never, Scope.Scope>, reached: Set<string>) =>
  Effect.fnUntraced(function* (c: B1Case) {
    const shape: Built = c.list ? Schema.Array(Row2) : Row2;
    const w = yield* pipeWorld(open, { pairs: [{ writer: shape, reader: shape }], cap: 16, chunk: c.chunk });
    yield* connect(w, 0);
    const writer = writerName(0);
    const reader = readerName(0);
    const small = (id: string) => ({ id, title: "small" });
    const before = copied(c.list ? [small("a")] : small("a"));
    yield* w.say(writer, { type: "set", value: before });
    yield* w.settle();
    const life = yield* w.processFor(writer);
    const inboxBefore = (yield* w.rows([`${reader}/inbox`])).length;
    // One item whose message alone is over the chunk size.
    const big = { id: "big", title: pad(c.chunk + c.over) };
    const value = copied(
      c.list ? [...Array.from({ length: c.index }, (_, n) => small(`s${n}`)), big, small("t")] : big,
    );
    yield* w.say(writer, { type: "set", value });
    yield* w.settle();
    const label = `B1: ${JSON.stringify({ ...c })}`;
    expect((yield* w.rows([`${reader}/inbox`])).length, `${label}: no message is saved`).toBe(inboxBefore);
    expect(yield* w.handed(reader), `${label}: the reader keeps the value it had`).toEqual([before]);
    const records = (yield* w.rows([life])).filter(
      (r) => r.tag === "cmd.answered" && Option.isSome(decodeAnswered(r.body)),
    );
    expect(records.length, `${label}: the writer life's stream records one too_big answer`).toBe(1);
    expect(yield* w.processFor(writer), `${label}: the writer stays up`).toBe(life);
    expect(
      (yield* w.writerModel(writer))?.seen,
      `${label}: the writer's program is not stepped with the answer`,
    ).toEqual(["set", "set"]);
    // Its next value under the size arrives whole.
    const after = copied(c.list ? [small("b"), small("c")] : small("b"));
    yield* w.say(writer, { type: "set", value: after });
    yield* w.settle();
    expect(yield* w.handed(reader), `${label}: the next value arrives whole`).toEqual([before, after]);
    reached.add(c.list ? (c.index === 0 ? "list:first" : "list:later") : "single");
  });

/** G1: a piped input is a plain input; a chunk message with no pipe hands nothing. */
const g1 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.gen(function* () {
    const shape = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
    const w = yield* pipeWorld(open, { pairs: [{ writer: shape, reader: shape }], cap: 16, chunk: 1_024 });
    // The reader alone: no pipe was ever made into its input.
    yield* w.start(readerName(0), readerCode(0));
    const reader = readerName(0);
    yield* w.say(reader, { type: "in", value: 1041 });
    yield* w.settle();
    expect(yield* w.handed(reader), "G1: a direct message steps the program as any write port").toEqual([1041]);
    yield* w.say(reader, { type: "in", items: [7], part: { id: "process_X/1/out/out", seq: 0, last: true } });
    yield* w.settle();
    expect(yield* w.handed(reader), "G1: a chunk message for an input with no pipe hands nothing").toEqual([1041]);
    yield* w.say(reader, { type: "in", value: 12 });
    yield* w.settle();
    expect(yield* w.handed(reader), "G1: and the inbox moves on past it").toEqual([1041, 12]);
  });

/** Runs the laws on the stores `open` gives. */
export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("Pipe slice 1: a program pipes one program's output to another's input, on real runners", () => {
    // Plants: (a) send every value, not the newest; (b) hand the reader a value at the first chunk;
    // (c) watch only the first writer life; (d) write the piped row before checking that the pipe
    // fits; (e) hand the reader's program the items in place of the value: S1 red.
    it.live(
      "S1 scenario: a parent pipes a writer to a reader and starts both; the newest whole value wins, a crash mid-send leaves the reader on its value, a restart sends the new life's value with one DOWN per life, and an unfit or forbidden pipe writes nothing",
      () => Effect.andThen(Effect.scoped(s1(open, "list")), Effect.scoped(s1(open, "struct"))),
      600_000,
    );

    // Plants: (a) write the watch in a turn after started; (b) reuse the pipe id as the ref: W1 red.
    it.effect(
      "W1: over writer starts, crashes, restarts and chunked sends, the reader is handed one DOWN per writer life, with ref <pipe>/<process>, that life's reason and the writer's name, after its last saved message",
      () => {
        const reached = new Set<string>();
        return Effect.andThen(
          property(fc.array(WCell, { minLength: 2, maxLength: 10 }), w1(open, reached), { fast: 10, full: 100 }, [
            // pinned: a life that ends in the turn after its start gives its own reason, never noproc.
            [
              [
                { move: "end", reason: ExitReason.cases.crashed.make({ phase: "step" }), size: 1 },
                { move: "end", reason: ExitReason.cases.kill.make({}), size: 1 },
              ],
            ],
            // pinned: a life that ends between two chunks of a send.
            [
              [
                { move: "send", reason: ExitReason.cases.normal.make({}), size: 10 },
                { move: "end", reason: ExitReason.cases.crashed.make({ phase: "step" }), size: 1 },
              ],
            ],
          ]),
          Effect.sync(() => {
            for (const required of ["send", "end", "end:right after start", "read"]) {
              expect(reached, `W1 reached ${required}`).toContain(required);
            }
          }),
        );
      },
      600_000,
    );

    // Plant: write the watch only on writer starts: W2 red.
    it.live(
      "W2 scenario: a new reader life gets a watch on the writer's live life in its restart turn, and gets the next DOWN",
      () => Effect.scoped(w2(open)),
      600_000,
    );

    // Plants: (a) append a newer value to an owed one; (b) drop a send that already saved seq 0: O1 red.
    it.effect(
      "O1: against a slow reader with a small cap, each value the reader is handed is one whole writer value, in the writer's order, and the last one is the writer's last, for a list and a single value",
      () => {
        const reached = new Set<string>();
        return Effect.andThen(
          Effect.andThen(
            property(fc.array(OCell, { minLength: 1, maxLength: 12 }), o1(open, true, reached), { fast: 10, full: 50 }),
            property(fc.array(OCell, { minLength: 1, maxLength: 12 }), o1(open, false, reached), {
              fast: 10,
              full: 50,
            }),
          ),
          Effect.sync(() => expect(reached, "O1 reached a run where newest wins dropped a value").toContain("dropped")),
        );
      },
      600_000,
    );

    // Plant: send on every load: O2 red.
    it.live(
      "O2 scenario: a life's first value is sent once, a wake of the same life sends nothing, a restart sends again from seq 0, and a null value sends nothing, for a list and a single value",
      () => Effect.andThen(Effect.scoped(o2(open, true)), Effect.scoped(o2(open, false))),
      600_000,
    );

    // Plant: let exit pass an owed send: O3 red.
    it.live(
      "O3 scenario: a writer that exits with an owed send gets its last value to the reader before its DOWN normal; one killed between two chunks leaves the reader on the value it had",
      () => Effect.scoped(o3(open)),
      600_000,
    );

    // Plants: (a) hand the reader the items ([1041] for 1041); (b) step the reader at every chunk;
    // (c) send an empty list as no message: X2 red.
    it.effect(
      "X2: through real runners with mail.chunk at 1 KiB, the Msg the reader's update is handed holds the writer's value, compared as JSON, once",
      () => {
        const reached = new Set<string>();
        return Effect.andThen(
          property(ValueCase, x2(open, reached), { fast: 10, full: 30 }),
          Effect.sync(() => {
            for (const required of ["an empty list", "a list that needs several chunks", "a number"]) {
              expect(reached, `X2 reached ${required}`).toContain(required);
            }
          }),
        );
      },
      600_000,
    );

    // Plants: (a) send a selector's null as an empty send; (b) hand nothing when the items are
    // empty; (c) drop an item that is null: N1 red.
    it.effect(
      "N1: a selector's null saves no message and hands nothing; [], [null] and {note: null} are each handed as they are; the reader's log is the writer's values that are not null, at each change, in order",
      () => {
        const reached = new Set<string>();
        return Effect.andThen(
          property(N1Case, n1(open, reached), { fast: 10, full: 50 }, [
            [{ list: true, values: [[7], null, [], [null], [null, null]] }],
            [{ list: false, values: [{ note: null }, null, { note: null }] }],
          ]),
          Effect.sync(() => {
            for (const v of [...N1_LIST, ...N1_STRUCT]) {
              expect(reached, `N1 reached ${JSON.stringify(v)}`).toContain(JSON.stringify(v));
            }
          }),
        );
      },
      600_000,
    );

    // Plants: (a) unwrap by the reader's declared shape; (b) refuse a list writer into a reader of
    // anything: A1 red.
    it.effect(
      "A1: a writer of any shape piped to a reader of Schema.Unknown fits, and the reader is handed the value as the writer declared it, a single value unwrapped and a list as a list",
      () => {
        const reached = new Set<string>();
        return Effect.andThen(
          property(ValueCase, a1(open, reached), { fast: 10, full: 30 }),
          Effect.sync(() => {
            for (const required of ["a number", "a list of one"]) {
              expect(reached, `A1 reached ${required}`).toContain(required);
            }
          }),
        );
      },
      600_000,
    );

    // Plants: (a) step the writer's program with the answer; (b) save the chunks before the item that
    // is too big: B1 red.
    it.effect(
      "B1: a value holding one item whose message alone is over mail.chunk saves no message, hands nothing, records one cmd.answered too_big, keeps the writer up and unstepped, and its next value under the size arrives whole",
      () => {
        const reached = new Set<string>();
        return Effect.andThen(
          property(B1Case, b1(open, reached), { fast: 10, full: 30 }, [
            [{ chunk: 1_024, over: 1, list: false, index: 0 }],
            [{ chunk: 4_096, over: 300, list: true, index: 3 }],
            [{ chunk: 2_048, over: 50, list: true, index: 0 }],
          ]),
          Effect.sync(() => expect(reached).toEqual(new Set(["single", "list:first", "list:later"]))),
        );
      },
      600_000,
    );

    // Plant: unwrap a chunk message with no pipe as a list: G1 red.
    it.live(
      "G1 scenario: a {type, value} message sent straight to a piped input steps the program as any write port; a chunk message for an input that never had a pipe is acked and hands nothing",
      () => Effect.scoped(g1(open)),
      600_000,
    );
  });

// P8, next/. The world, program and checks runner-contract.test.ts and
// runner-contract-replay.test.ts share, moved out of runner-contract.test.ts unchanged so each
// file stays under about 60 s on a CI leg. The tiny program below is exam code, not real notes.
// Source: next/packages/libfabrika/src/app/runner.test.ts at 9b48d622b5d4.
import { DatabaseSync } from "node:sqlite";
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { expect } from "@effect/vitest";
import {
  Alarm,
  CheckedWriter,
  Id,
  Input,
  Program,
  ProgramLoader,
  ProgramRunner,
  Recording,
  WatcherManager,
  type Incoming,
  type Refusal,
  type Update,
} from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { Doorbell, Ledger } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { Appended } from "@kampus/libfabrika/ledger/Log";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { ProcessStore } from "@kampus/libfabrika/runtime/ProcessStore";
import { mailChunk } from "@kampus/libfabrika/settings/Declarations";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { String as Str, pipe, Array as Arr, Arbitrary, Effect, Layer, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  save: {},
});

export const opts = { arbitrary: { seed: 119120, runs: 300, size: 4096, concurrency: 1 }, timeout: 60_000 };

export const number = (min: number, max: number) => Schema.Int.check(Schema.isBetween({ minimum: min, maximum: max }));

export const text = (max: number) => Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(max));

export const Body = Schema.Union([
  text(4096),
  Schema.Literals(["مرحبا 🌱", "\n  trailing  \n", "# heading\n```ts\nconst n = 1;\n```", ""]),
]);

export const RefusalCases = Arbitrary.schema(
  Schema.Struct({
    reason: text(96),
    now: Schema.optionalKey(number(-4096, 4096)),
    most: Schema.optionalKey(number(-4096, 4096)),
    body: Body,
  }),
);

export const ReplayCases = Arbitrary.array(Arbitrary.schema(Body), { minLength: 0, maxLength: 32 });

const Model = Schema.Struct({ body: Schema.String, version: Schema.Int });

type Model = typeof Model.Type;

export const Msg = Schema.TaggedUnion({
  save: { body: Schema.String, base: Schema.Finite, work: Schema.Boolean },
  // A person-only write port, so the runner's person-only refusal has a real port to guard.
  guard: { body: Schema.String },
});

type Msg = typeof Msg.Type;

const probe = Cmd.make("probe", { input: Schema.Struct({}), ok: Schema.Null, err: [] });

export const empty = { body: "", version: 0 };

export const makeProgram = (refuse: (s: Model, m: Msg) => Refusal | null, throws = false) => {
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [probe],
    init: (loaded) => [loaded ?? empty, []],
    update: {
      save: (s, m) => {
        if (throws) {
          throw new Error("exam saved fold failed");
        }

        return [{ body: m.body, version: s.version + 1 }, m.work ? [probe({})] : []];
      },
      guard: (s, m) => [{ body: m.body, version: s.version + 1 }, [probe({})]],
      probe_ok: (s) => [s, []],
      probe_err: (s) => [s, []],
    },
  });

  return Program.make({
    name: "notes-exam",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse,
    inputs: {
      save: "Exam save",
      guard: { description: "Exam person-only save", personOnly: true },
      // A read port: never a write, so a fresh input naming it is bad_msg.
      peek: Input.cases.read.make({
        schema: Schema.TaggedStruct("peek", {}),
        description: "Exam read",
        answer: (v: Model) => v.version,
      }),
    },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};

export const person = "person_0000000000e008000000000001";

export const process = Schema.decodeSync(Id.Process)("process_0000000000e008000000000001");

export const writer = Writer.cases.agent.make({ key: "SHA256:exam-agent", for: person });

const name = "notes-exam:1";

export const build = "p8-exam";

export const id = (prefix: "input" | "letter", n: number) =>
  `${prefix}_0000000000e008${pipe(n.toString(16), Str.padStart(12, "0"))}`;

export const incoming = (n: number, body: string, base = 0, work = false): Incoming => ({
  id: id("letter", n),
  envelope: {
    id: Schema.decodeSync(Id.InputId)(id("input", n)),
    by: writer,
    arrivedAt: n,
    input: { ...Tag.cases.save.make({}), body, base, work },
  },
  sentAt: "2030-01-01T00:00:00Z",
  seen: 0,
  span: { traceId: "00000000000000000000000000000001", spanId: "0000000000000001" },
});

export const world = Effect.fnUntraced(function* (program: ReturnType<typeof makeProgram>) {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );

  const sql = nodeSql(db);
  const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

  const ledger = Layer.mergeAll(LedgerSql.layer(sql, { reader: "p8" }), LedgerTransactionSql.layer(sql)).pipe(
    Layer.provide(quiet),
  );

  let nextProcess = 0;

  const manager = ProcessManager.layer(
    {
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "exam", session: process }),
      by: "SHA256:exam-brain",
    },
    Effect.sync(() => `process_0000000000e008${pipe((++nextProcess).toString(16), Str.padStart(12, "0"))}`),
  ).pipe(Layer.provide(ledger));

  const shared = Layer.mergeAll(Mailbox.layer, ProcessStore.layer(sql, { process })).pipe(Layer.provideMerge(ledger));
  const mail = yield* Mailbox.pipe(Effect.provide(shared));
  const store = yield* ProcessStore.pipe(Effect.provide(shared));
  const log = yield* Ledger.pipe(Effect.provide(ledger));

  const updates: Update[] = [],
    calls: string[] = [];

  let blockAppend = false;
  let alarmAt: number | null = null;

  const append = (i: Incoming) =>
    mail.send(name, i.id, i.envelope.input, {
      by: i.envelope.by.key,
      for: i.envelope.by.for,
      parent: i.envelope.id,
      sentAt: i.sentAt,
      seen: i.seen,
      traceId: i.span.traceId,
      build,
    });

  const wiring = Layer.mergeAll(
    shared,
    ProgramLoader.layer(
      { "notes-exam": program },
      {
        probe: () =>
          Effect.sync(() => {
            calls.push("cmd");

            return Outcome.ok(null);
          }),
      },
    ),
    Layer.succeed(CheckedWriter, {
      append: (i) => {
        calls.push("append");

        return blockAppend ? Effect.succeed(Appended.cases.refused.make({ reason: "seen_ahead" })) : append(i);
      },
      commit: () => Effect.die("exam has no writes"),
      own: () => Effect.die("exam has no own writes"),
    }),
    Layer.succeed(WatcherManager, {
      publish: (_client, update) =>
        Effect.sync(() => {
          updates.push(update);
        }),
    }),
    Layer.succeed(Alarm, {
      set: (at) =>
        Effect.sync(() => {
          alarmAt = at;
        }),
    }),
    Layer.succeed(Recording, { flush: Effect.void }),
  );

  // P34 (PR 760): every runner is supervised, so recovery and the ProcessManager are always wired,
  // and its process is started first, as libfabrika's runner.test.ts boots it.
  const boot = ProcessManager.use((p) =>
    p.status(name).pipe(
      Effect.catch(() =>
        p.start(Start.cases.first.make({ id: "p8-start", name, code: { program: program.name, hash: build } }), {
          by: writer.key,
          for: person,
          sentAt: "2026-11-09T00:00:00Z",
          seen: 0,
          parent: null,
          traceId: "00000000000000000000000000000001",
          build,
        }),
      ),
    ),
  ).pipe(Effect.provide(manager));

  const runner = () =>
    boot.pipe(
      Effect.andThen(
        ProgramRunner.pipe(
          Effect.provide(
            ProgramRunner.layer(
              { id: process, name, program: program.name, build, owner: writer },
              { recovery: { sql, name, capacity: 1024 ** 3 }, chunk: mailChunk.default },
            ).pipe(Layer.provide(Layer.mergeAll(wiring, manager))),
          ),
        ),
      ),
    );

  return {
    runner,
    // The Gateway law's door reads these (runner-contract-replay.test.ts).
    sql,
    ledger,
    store,
    append,
    updates,
    calls,
    block: () => {
      blockAppend = true;
    },
    rows: () => Stream.runCollect(log.read(`${name}/inbox`, 0)),
    boot,
    recover: (runner: typeof ProgramRunner.Service) =>
      Effect.gen(function* () {
        if (alarmAt === null) {
          return yield* Effect.die("crash has no restart alarm");
        }

        const at = alarmAt;
        yield* TestClock.setTime(at);
        yield* runner.due(at);
      }),
    receipts: () =>
      Arr.map(sql.exec("SELECT value FROM process_receipts WHERE name=?", name), (row) =>
        JSON.parse(String(row.value)),
      ),
    dead: () => sql.exec("SELECT * FROM entries WHERE stream LIKE '%/dead'"),
    down: () => sql.exec("SELECT * FROM entries WHERE \"_tag\"='down'"),
  };
});

export const unchanged = <A>(before: A, after: A) => expect(after).toEqual(before);

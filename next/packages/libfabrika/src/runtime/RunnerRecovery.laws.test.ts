// P12, next/. Real runner, mailbox, checkpoint and SQLite. Only Worker RPC can fail.
// Ticket 1181: S1 runs the runner's code swap on the same in-memory stand-ins.
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Layer, Match, Option, Result, Schema } from "effect";
import * as Arr from "effect/Array";
import * as fc from "fast-check";
import { Mailbox, ProcessManager, ProcessStore, Writer } from "../coordination/index.ts";
import { processId } from "../Id.test-support.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { InputId } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { mailChunk } from "../settings/Declarations.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Alarm, CheckedWriter, type Loaded, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { workerExecution } from "./Execution.ts";
import { Supervision } from "./internal/supervisor.ts";
import { ProgramDown, type Step, stepper } from "./Program.ts";
import { recoveryStore } from "./RecoveryStore.ts";
import { ProgramRunner, Swapped } from "./Runner.ts";
import { Saved } from "./State.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  inc: {},
  put: {},
  boom: {},
});

const PID = Effect.runSync(processId);

const Model = Schema.Struct({ count: Schema.Int });

const Msg = Schema.TaggedStruct("inc", {});

const program = {
  name: "counter",
  machine: Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: (saved) => [saved ?? { count: 0 }, []],
    update: { inc: (s) => [{ count: s.count + 1 }, []] },
  }),
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: () => null,
  inputs: { inc: { _tag: "write", schema: Msg, description: "Increment", personOnly: false } },
  outputs: {},
  writes: {},
  wake: () => null,
} as const;

describe("P12 saved mail recovery", () => {
  for (const point of ["admit", "step"] as const) {
    it(`a temporary ${point} RPC failure preserves the cursor and retries saved mail`, async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.string(), (total, letter) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const db = new DatabaseSync(":memory:");
              // Ticket 402: the brain's process table lives in its own ledger.
              const managerDb = new DatabaseSync(":memory:");

              try {
                const sql = nodeSql(db),
                  pure = yield* Effect.fromResult(stepper(program));

                let down = false;

                const execution = workerExecution({
                  init: async (saved) => pure.init(saved),
                  fresh: async (model, msg) => {
                    if (down && point === "step") {
                      return Promise.reject(new Error("temporary RPC loss"));
                    }

                    return Result.getOrThrow(pure.fresh(model, msg));
                  },
                  update: async (model, msg) => Result.getOrThrow(pure.update(model, msg)),
                  audit: async () => ({ _tag: "ok", value: Tag.cases.inc.make({}) }),
                  admit: async () => {
                    if (down && point === "admit") {
                      return Promise.reject(new Error("temporary RPC loss"));
                    }

                    return true;
                  },
                  step: async (model, msg) => {
                    if (down && point === "step") {
                      return Promise.reject(new Error("temporary RPC loss"));
                    }

                    return pure.step(model, msg);
                  },
                  fold: async (model, msg) => pure.fold(model, msg),
                  upgrade: async (saved) => ({ saved, ran: [] }),
                  reply: async () => null,
                });

                const base = Layer.mergeAll(
                  LedgerSql.layer(sql, { reader: PID }).pipe(
                    Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
                  ),
                  RecordManager.memory(1_000_000_000),
                  Archive.memory,
                  SpanSink.layer(sql, { object: PID }),
                );

                const dependencies = Layer.mergeAll(
                  Mailbox.layer,
                  ProcessStore.layer(sql, { process: PID }),
                  Layer.succeed(ProgramLoader, {
                    load: () =>
                      Effect.succeed({
                        stepper: pure,
                        execution,
                        declaration: {
                          name: "counter",
                          v: 1,
                          inputs: { inc: { write: true, personOnly: false } },
                          writes: {},
                          cmds: [],
                        },
                        handler: () => Option.none(),
                      }),
                  }),
                  Layer.succeed(Alarm, { set: () => Effect.void }),
                  Layer.succeed(WatcherManager, { publish: () => Effect.void }),
                  Layer.succeed(Recording, { flush: Effect.void }),
                  Layer.succeed(CheckedWriter, {
                    sign: () => Effect.die("no write declared"),
                    append: () => Effect.die("no fresh input"),
                    commit: () => Effect.die("no write declared"),
                    own: () => Effect.die("no write declared"),
                  }),
                ).pipe(Layer.provideMerge(base));

                // Ticket 402: every runner is supervised. The real manager's first start names
                // PID, and receipts live in the same Sql as ProcessStore.
                const manager = Layer.effectDiscard(
                  ProcessManager.use((m) =>
                    m.start(
                      Start.cases.first.make({
                        id: "boot:counter:1",
                        name: "counter:1",
                        code: { program: "counter", hash: "test" },
                      }),
                      {
                        by: "SHA256:brain",
                        for: "brain",
                        sentAt: "2026-11-08T00:00:00Z",
                        seen: 0,
                        parent: null,
                        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                        build: "test",
                      },
                    ),
                  ).pipe(Effect.orDie),
                ).pipe(
                  Layer.provideMerge(
                    ProcessManager.layer(
                      {
                        by: "SHA256:brain",
                        owner: Owner.cases.brain.make({}),
                        recipient: Recipient.cases.client.make({ client: "brain", session: PID }),
                      },
                      Effect.succeed(PID),
                    ),
                  ),
                  Layer.provide(
                    LedgerTransactionSql.layer(nodeSql(managerDb)).pipe(
                      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
                    ),
                  ),
                );

                const layer = ProgramRunner.layer(
                  {
                    id: PID,
                    name: "counter:1",
                    program: "counter",
                    build: "test",
                    owner: Writer.cases.person.make({ key: "SHA256:fixture", for: "person-test" }),
                  },
                  { recovery: { sql, name: "counter:1", capacity: 1024 ** 3 }, chunk: mailChunk.default },
                ).pipe(Layer.provideMerge(Layer.mergeAll(dependencies, manager)));

                yield* Effect.gen(function* () {
                  const runner = yield* ProgramRunner,
                    mailbox = yield* Mailbox,
                    store = yield* ProcessStore;

                  /** Every counted program failure: a fresh receipt's errors, or a saved-mail observation. */
                  const spent = recoveryStore(sql, {
                    name: "counter:1",
                    capacity: 1024 ** 3,
                    schema: Supervision,
                  }).load.pipe(
                    Effect.map((saved) => [
                      ...Arr.filter(saved?.receipts ?? [], (r) => r.tries > 0 || r.errors.length > 0),
                      ...(saved?.observations ?? []),
                    ]),
                  );

                  expect(yield* runner.open("before")).toMatchObject({ rev: 0, view: { count: 0 } });

                  for (let n = 0; n < total; n++) {
                    yield* mailbox.send("counter:1", `${letter}-${n}`, Tag.cases.inc.make({}), {
                      by: "SHA256:fixture",
                      for: "person-test",
                      sentAt: "2026-11-08T00:00:00Z",
                      seen: 0,
                      parent: null,
                      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                      build: "test",
                    });
                  }

                  down = true;
                  const failed = yield* Effect.exit(runner.open("during-loss"));
                  expect.soft(Exit.isFailure(failed), "RPC loss must fail this attempt").toBe(true);
                  expect.soft((yield* store.load)?.saved.after).toBe(0);
                  // Ticket 402: a transport fault is not a program throw; it spends no delivery.
                  expect.soft(yield* spent, "RPC loss spends no delivery").toEqual([]);
                  down = false;
                  expect(yield* runner.open("recovered")).toMatchObject({
                    rev: total,
                    view: { count: total },
                  });
                  expect((yield* store.load)?.saved.after).toBe(total);
                  expect(yield* spent, "recovered mail spent no delivery").toEqual([]);
                  expect(yield* runner.open("again")).toMatchObject({
                    rev: total,
                    view: { count: total },
                  });
                }).pipe(Effect.provide(layer));
              } finally {
                db.close();
                managerDb.close();
              }
            }),
          ),
        ),
        { seed: 119120, numRuns: runsFor({ fast: 3, full: 25 }), examples: [[1, "saved-letter"]] },
      );
    });
  }
});

// Ticket 402: the runner's own id_reused refusal, on both paths that know a letter.
const Reuse = Schema.TaggedUnion({ inc: { n: Schema.Int }, boom: { n: Schema.Int } });

const ReuseModel = Schema.Struct({ count: Schema.Int });

const reuseProgram = {
  ...program,
  machine: Machine.make({
    model: ReuseModel,
    msg: Reuse,
    cmds: [],
    init: (saved) => [saved ?? { count: 0 }, []],
    update: {
      inc: (s, m) => [{ count: s.count + m.n }, []],
      boom: () => {
        throw new RangeError("poison");
      },
    },
  }),
  state: { v: 1, schema: ReuseModel, upgrades: [] },
  msg: Reuse,
  view: { data: ReuseModel, select: (s: typeof ReuseModel.Type) => s },
  inputs: {
    inc: { _tag: "write", schema: Reuse, description: "Increment", personOnly: false },
    boom: { _tag: "write", schema: Reuse, description: "Throw", personOnly: false },
  },
} as const;

describe("P34 id reuse at the runner", () => {
  for (const path of ["placed", "receipt"] as const) {
    it(`a ${path} letter resent with a different input is refused id_reused and steps nothing`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          (id, first, other) =>
            Effect.runPromise(
              Effect.gen(function* () {
                const db = new DatabaseSync(":memory:");
                const managerDb = new DatabaseSync(":memory:");

                try {
                  const sql = nodeSql(db),
                    pure = yield* Effect.fromResult(stepper(reuseProgram));

                  let steps = 0;

                  const execution = workerExecution({
                    init: async (saved) => pure.init(saved),
                    admit: async () => true,
                    fresh: async (model, msg) => Result.getOrThrow(pure.fresh(model, msg)),
                    update: async (model, msg) => {
                      steps++;

                      return Result.getOrThrow(pure.update(model, msg));
                    },
                    audit: async () => ({ _tag: "ok", value: Tag.cases.put.make({}) }),
                    step: async (model, msg) => {
                      steps++;

                      return pure.step(model, msg);
                    },
                    fold: async (model, msg) => pure.fold(model, msg),
                    upgrade: async (saved) => ({ saved, ran: [] }),
                    reply: async () => null,
                  });

                  const base = Layer.mergeAll(
                    LedgerSql.layer(sql, { reader: PID }).pipe(
                      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
                    ),
                    RecordManager.memory(1_000_000_000),
                    Archive.memory,
                    SpanSink.layer(sql, { object: PID }),
                  );

                  const dependencies = Layer.mergeAll(
                    Mailbox.layer,
                    ProcessStore.layer(sql, { process: PID }),
                    Layer.succeed(ProgramLoader, {
                      load: () =>
                        Effect.succeed({
                          stepper: pure,
                          execution,
                          declaration: {
                            name: "counter",
                            v: 1,
                            inputs: {
                              inc: { write: true, personOnly: false },
                              boom: { write: true, personOnly: false },
                            },
                            writes: {},
                            cmds: [],
                          },
                          handler: () => Option.none(),
                        }),
                    }),
                    Layer.succeed(Alarm, { set: () => Effect.void }),
                    Layer.succeed(WatcherManager, { publish: () => Effect.void }),
                    Layer.succeed(Recording, { flush: Effect.void }),
                    Layer.effect(
                      CheckedWriter,
                      Effect.gen(function* () {
                        const mailbox = yield* Mailbox;

                        return CheckedWriter.of({
                          sign: () => Effect.die("no write declared"),
                          // The door's append: a fresh letter is saved in the inbox before it is stepped.
                          append: (i) =>
                            mailbox.send("counter:1", i.id, i.envelope.input, {
                              by: i.envelope.by.key,
                              for: "person-test",
                              sentAt: i.sentAt,
                              seen: 0,
                              parent: i.envelope.id,
                              traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                              build: "test",
                            }),
                          commit: () => Effect.die("no write declared"),
                          own: () => Effect.die("no write declared"),
                        });
                      }),
                    ).pipe(Layer.provide(Mailbox.layer)),
                  ).pipe(Layer.provideMerge(base));

                  const manager = Layer.effectDiscard(
                    ProcessManager.use((m) =>
                      m.start(
                        Start.cases.first.make({
                          id: "boot:counter:1",
                          name: "counter:1",
                          code: { program: "counter", hash: "test" },
                        }),
                        {
                          by: "SHA256:brain",
                          for: "brain",
                          sentAt: "2026-11-08T00:00:00Z",
                          seen: 0,
                          parent: null,
                          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                          build: "test",
                        },
                      ),
                    ).pipe(Effect.orDie),
                  ).pipe(
                    Layer.provideMerge(
                      ProcessManager.layer(
                        {
                          by: "SHA256:brain",
                          owner: Owner.cases.brain.make({}),
                          recipient: Recipient.cases.client.make({ client: "brain", session: PID }),
                        },
                        Effect.succeed(PID),
                      ),
                    ),
                    Layer.provide(
                      LedgerTransactionSql.layer(nodeSql(managerDb)).pipe(
                        Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
                      ),
                    ),
                  );

                  const layer = ProgramRunner.layer(
                    {
                      id: PID,
                      name: "counter:1",
                      program: "counter",
                      build: "test",
                      owner: Writer.cases.person.make({ key: "SHA256:fixture", for: "person-test" }),
                    },
                    { recovery: { sql, name: "counter:1", capacity: 1024 ** 3 }, chunk: mailChunk.default },
                  ).pipe(Layer.provideMerge(Layer.mergeAll(dependencies, manager)));

                  const letter = (type: "inc" | "boom", n: number) => ({
                    id,
                    envelope: {
                      id: Schema.decodeUnknownSync(InputId)("input_0000000000e008000000000001"),
                      by: Writer.cases.person.make({ key: "SHA256:fixture", for: "person-test" }),
                      arrivedAt: 0,
                      input: { ...Tag.cases[type].make({}), n },
                    },
                    sentAt: "2026-11-08T00:00:00Z",
                    seen: 0,
                    span: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" },
                  });

                  const type = path === "placed" ? "inc" : "boom";
                  yield* Effect.gen(function* () {
                    const runner = yield* ProgramRunner;
                    const sent = yield* Effect.exit(runner.msg(letter(type, first)));
                    expect(Exit.isFailure(sent), "only a throwing letter fails its send").toBe(type === "boom");
                    const before = steps;
                    const changed = other === first ? other + 1 : other;
                    expect(yield* runner.msg(letter(type, changed))).toMatchObject({
                      _tag: "refused",
                      reason: "id_reused",
                    });
                    expect(steps, "a refused reuse steps nothing").toBe(before);
                  }).pipe(Effect.provide(layer));
                } finally {
                  db.close();
                  managerDb.close();
                }
              }),
            ),
        ),
        { seed: 119120, numRuns: runsFor({ fast: 3, full: 25 }) },
      );
    });
  }
});

// Ticket 1181: a code swap's new build answers for itself, and the journal keeps only what fits.
// The answer's own kind is its `_tag` (0214).
const Answer = Schema.TaggedUnion({
  /** The new build's init answers a wake that is not a whole number. */
  fractional: { wake: Schema.Number },
  /** The new build's init answers a wake below 0. */
  negative: { wake: Schema.Number },
  /** The new build's upgrade names the upgrades it ran, one of them empty. */
  empty_ran: { ran: Schema.Array(Schema.String) },
  /** The new build's upgrade answers a saved `v` one below the process's own. */
  lower_v: {},
  /** An answer the journal keeps. */
  fits: { wake: Schema.NullOr(Schema.Int), ran: Schema.Array(Schema.String) },
});

type Answer = typeof Answer.Type;

const answer: fc.Arbitrary<Answer> = fc.oneof(
  fc
    .double({ min: -1e9, max: 1e9, noNaN: true })
    .filter((wake) => !Number.isInteger(wake))
    .map((wake) => Answer.cases.fractional.make({ wake })),
  fc.integer({ min: -1e9, max: -1 }).map((wake) => Answer.cases.negative.make({ wake })),
  fc.tuple(fc.array(fc.string({ minLength: 1 })), fc.nat()).map(([names, at]) => {
    const i = at % (names.length + 1);

    return Answer.cases.empty_ran.make({ ran: [...names.slice(0, i), "", ...names.slice(i)] });
  }),
  fc.constant(Answer.cases.lower_v.make({})),
  fc
    .record({
      wake: fc.option(fc.nat(), { nil: null }),
      ran: fc.array(fc.string({ minLength: 1 })),
    })
    .map(({ wake, ran }) => Answer.cases.fits.make({ wake: wake, ran })),
);

/** The process runs at `v` 2, so an upgrade can answer a saved `v` of 1 that the journal refuses. */
const swapProgram = {
  ...program,
  state: { v: 2, schema: Model, upgrades: [{ name: "one_to_two", from: 1, run: (m: unknown) => m }] },
} as const;

const FROM = {
  by: "SHA256:fixture",
  for: "person-test",
  sentAt: "2026-11-08T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "test",
};

const withWake = (step: Step, wake: number | null): Step =>
  Match.value(step).pipe(
    Match.tag("stepped", (stepped) => ({ ...stepped, wake })),
    Match.orElse((other) => other),
  );

const acquireDatabase = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

/**
 * A real supervised runner on in-memory stand-ins, whose loader answers by build: "test" is the
 * counter the process boots on, "next" is the same counter whose init and upgrade hand back
 * `answered`, and "good" is the same counter answering plainly. The walk runs inside the runner's
 * layer and reads the ledger and the process's saved state through the one `sql`.
 */
const inSwapWorld = <A, E>(
  answered: Answer,
  walk: (sql: ReturnType<typeof nodeSql>) => Effect.Effect<A, E, ProgramRunner | Mailbox | ProcessStore>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* acquireDatabase;
      // Ticket 402: the brain's process table lives in its own ledger.
      const managerDb = yield* acquireDatabase;
      const sql = nodeSql(db);
      const pure = yield* Effect.fromResult(stepper(swapProgram));

      const plain = workerExecution({
        init: async (saved) => pure.init(saved),
        fresh: async (model, msg) => Result.getOrThrow(pure.fresh(model, msg)),
        update: async (model, msg) => Result.getOrThrow(pure.update(model, msg)),
        audit: async () => ({ _tag: "ok", value: Tag.cases.inc.make({}) }),
        admit: async () => true,
        step: async (model, msg) => pure.step(model, msg),
        fold: async (model, msg) => pure.fold(model, msg),
        upgrade: async (saved) => ({ saved, ran: [] }),
        reply: async () => null,
      });

      const next = workerExecution({
        init: async (saved) =>
          withWake(
            pure.init(saved),
            Match.value(answered).pipe(
              Match.tag("fractional", ({ wake }) => wake),
              Match.tag("negative", ({ wake }) => wake),
              Match.tag("fits", ({ wake }) => wake),
              Match.orElse(() => null),
            ),
          ),
        fresh: async (model, msg) => Result.getOrThrow(pure.fresh(model, msg)),
        update: async (model, msg) => Result.getOrThrow(pure.update(model, msg)),
        audit: async () => ({ _tag: "ok", value: Tag.cases.inc.make({}) }),
        admit: async () => true,
        step: async (model, msg) => pure.step(model, msg),
        fold: async (model, msg) => pure.fold(model, msg),
        upgrade: async (saved) => {
          const row = Schema.decodeUnknownSync(Saved)(saved);

          return Match.value(answered).pipe(
            Match.tag("empty_ran", ({ ran }) => ({ saved: row, ran })),
            Match.tag("lower_v", () => ({ saved: { ...row, v: 1 }, ran: [] })),
            Match.tag("fits", ({ ran }) => ({ saved: row, ran })),
            Match.orElse(() => ({ saved: row, ran: [] })),
          );
        },
        reply: async () => null,
      });

      const loaded = (execution: Loaded["execution"]): Loaded => ({
        stepper: pure,
        execution,
        declaration: {
          name: "counter",
          v: 2,
          inputs: { inc: { write: true, personOnly: false } },
          writes: {},
          cmds: [],
        },
        handler: () => Option.none(),
      });

      const builds = { test: loaded(plain), next: loaded(next), good: loaded(plain) };

      const base = Layer.mergeAll(
        LedgerSql.layer(sql, { reader: PID }).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
        RecordManager.memory(1_000_000_000),
        Archive.memory,
        SpanSink.layer(sql, { object: PID }),
      );

      const dependencies = Layer.mergeAll(
        Mailbox.layer,
        ProcessStore.layer(sql, { process: PID }),
        Layer.succeed(ProgramLoader, {
          load: (_name, build = "test") =>
            build === "next" || build === "good" || build === "test"
              ? Effect.succeed(builds[build])
              : Effect.fail(new ProgramDown({ reason: "no_program" })),
        }),
        Layer.succeed(Alarm, { set: () => Effect.void }),
        Layer.succeed(WatcherManager, { publish: () => Effect.void }),
        Layer.succeed(Recording, { flush: Effect.void }),
        Layer.succeed(CheckedWriter, {
          sign: () => Effect.die("no write declared"),
          append: () => Effect.die("no fresh input"),
          commit: () => Effect.die("no write declared"),
          own: () => Effect.die("no write declared"),
        }),
      ).pipe(Layer.provideMerge(base));

      // Ticket 402: every runner is supervised. The real manager's first start names PID.
      const manager = Layer.effectDiscard(
        ProcessManager.use((m) =>
          m.start(
            Start.cases.first.make({
              id: "boot:counter:1",
              name: "counter:1",
              code: { program: "counter", hash: "test" },
            }),
            { ...FROM, by: "SHA256:brain", for: "brain" },
          ),
        ).pipe(Effect.orDie),
      ).pipe(
        Layer.provideMerge(
          ProcessManager.layer(
            {
              by: "SHA256:brain",
              owner: Owner.cases.brain.make({}),
              recipient: Recipient.cases.client.make({ client: "brain", session: PID }),
            },
            Effect.succeed(PID),
          ),
        ),
        Layer.provide(
          LedgerTransactionSql.layer(nodeSql(managerDb)).pipe(
            Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
          ),
        ),
      );

      const layer = ProgramRunner.layer(
        {
          id: PID,
          name: "counter:1",
          program: "counter",
          build: "test",
          owner: Writer.cases.person.make({ key: "SHA256:fixture", for: "person-test" }),
        },
        { recovery: { sql, name: "counter:1", capacity: 1024 ** 3 }, chunk: mailChunk.default },
      ).pipe(Layer.provideMerge(Layer.mergeAll(dependencies, manager)));

      return yield* walk(sql).pipe(Effect.provide(layer));
    }),
  );

/** The two columns of a ledger row these laws read: its id, and its body, kept as JSON text. */
const decodeRow = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.String, body: Schema.fromJsonString(Schema.Json) }),
);

describe("ticket 1181 a code swap answers for the new build", () => {
  // S1. Plant: after build, decode only the wake; answer refuse("load"); fail with LedgerError bad_row;
  // refuse a change that decodes; or complete the change before decoding it.
  it("ticket 1181: a swap whose new build answers a wake or an upgrade the journal cannot keep is refused shape, and the process keeps its old build", async () => {
    const seen = new Set<string>();

    await fc.assert(
      fc.asyncProperty(answer, fc.integer({ min: 0, max: 3 }), (answered, before) =>
        Effect.runPromise(
          inSwapWorld(answered, (sql) =>
            Effect.gen(function* () {
              const runner = yield* ProgramRunner,
                mailbox = yield* Mailbox,
                store = yield* ProcessStore;

              seen.add(answered._tag);

              let sent = 0;

              /** One more inc in the inbox, stepped by the runner's open, and the count it shows. */
              const press = Effect.gen(function* () {
                yield* mailbox.send("counter:1", `press-${sent}`, Tag.cases.inc.make({}), FROM);
                sent++;

                const opened = yield* runner.open(`walk-${sent}`);

                return opened.view;
              });

              /** The refusals this process wrote, read from the ledger the way the reload suite reads it. */
              const refusals = () =>
                Arr.filter(
                  Arr.map(sql.exec("SELECT id, body FROM entries WHERE stream=? ORDER BY rev", PID), (raw) =>
                    decodeRow(raw),
                  ),
                  (row) => row.id.startsWith("code.refused:"),
                );

              const journal = recoveryStore(sql, {
                name: "counter:1",
                capacity: 1024 ** 3,
                schema: Supervision,
              }).load.pipe(Effect.map((saved) => saved?.journal));

              yield* runner.open("before");

              for (let n = 0; n < before; n++) {
                yield* press;
              }

              const request = { load: "install_next", program: "counter", hash: "next" };
              const swapped = yield* Effect.exit(runner.swap(request));

              yield* Match.value(answered).pipe(
                Match.tag("fits", () =>
                  Effect.gen(function* () {
                    expect(swapped, "a fitting answer swaps").toEqual(
                      Exit.succeed(Swapped.cases.swapped.make({ was: "test" })),
                    );
                    expect((yield* store.load)?.saved.build).toBe("next");
                    expect(refusals(), "a swap writes no refusal").toHaveLength(0);
                    expect(yield* press, "the new build steps the next letter").toMatchObject({
                      count: before + 1,
                    });
                  }),
                ),
                Match.orElse(() =>
                  Effect.gen(function* () {
                    expect(swapped, "the new build's answer is refused shape, never a defect or a failure").toEqual(
                      Exit.succeed(Swapped.cases.refused.make({ was: "test", reason: "shape" })),
                    );
                    // No letter stepped yet means no checkpoint: the process is still on its descriptor's build.
                    expect((yield* store.load)?.saved.build ?? "test", "the process keeps its old build").toBe("test");
                    expect(yield* journal, "nothing was journaled").toMatchObject({ _tag: "idle" });

                    const written = refusals();
                    expect(written, "one refusal is written").toHaveLength(1);
                    expect(written[0]?.id).toBe("code.refused:install_next");
                    expect(written[0]?.body).toEqual({
                      program: "counter",
                      hash: "next",
                      was: "test",
                      reason: "shape",
                    });

                    expect(yield* press, "the old build steps the next letter").toMatchObject({ count: before + 1 });
                    expect(yield* Effect.exit(runner.swap(request)), "a repeated swap answers the same").toEqual(
                      Exit.succeed(Swapped.cases.refused.make({ was: "test", reason: "shape" })),
                    );
                    expect(refusals(), "a repeated swap writes no second refusal").toHaveLength(1);

                    expect(
                      yield* Effect.exit(runner.swap({ load: "install_good", program: "counter", hash: "good" })),
                      "a fitting swap after the refusal swaps",
                    ).toEqual(Exit.succeed(Swapped.cases.swapped.make({ was: "test" })));
                    expect((yield* store.load)?.saved.build).toBe("good");
                  }),
                ),
              );
            }),
          ),
        ),
      ),
      {
        seed: 119120,
        numRuns: runsFor({ fast: 5, full: 25 }),
        examples: [
          [Answer.cases.fractional.make({ wake: 0.5 }), 0],
          [Answer.cases.negative.make({ wake: -1 }), 1],
          [Answer.cases.empty_ran.make({ ran: [""] }), 0],
          [Answer.cases.lower_v.make({}), 2],
          [Answer.cases.fits.make({ wake: null, ran: [] }), 1],
        ],
      },
    );

    for (const kind of ["fractional", "negative", "empty_ran", "lower_v", "fits"]) {
      expect(seen.has(kind), `the walk reaches ${kind}`).toBe(true);
    }
  });
});

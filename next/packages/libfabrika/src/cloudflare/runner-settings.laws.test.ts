// Ticket 1042, next/ (a new tile opens the shell, through the setting `tezgah.new`): law N4 of the
// approved plan (docs/plan/lanes/t1042-PLAN.md). Real runner, mailbox, checkpoint and process table on
// in-memory SQLite, and for the Worker path the real `programBox` over its RPC methods, as
// `runner-reply.laws.test.ts` runs them. Written before the runner hands a program its pack's
// settings. The plan names `runtime/RunnerSettings.laws.test.ts`; a runtime/ file may not import the
// ledger (0043, rule 11), which a runner on SQLite needs, so the law lives here beside the box.
//
// The shape this law holds the library to, from the plan (the build may add more):
// - `Program.make` takes an optional `settings`, a schema of the part of its pack's settings the
//   program reads, as Elm's flags and OTP's init/1 args. The stepper's `init(saved, settings)` decodes
//   what it is handed with it and passes the result to the machine's `init(loaded, ctx)`; a program
//   that declares none gets `{}`. A value the schema refuses downs the load (`ProgramDown` `load`),
//   never a default.
// - Both executions' `init` take the settings, and the box's call carries them across.
// - The runner is handed every pack's settings in its options, as `settings: {<pack>: <json>}`, and
//   hands a process the settings of its program's pack (`pack/program`, 0083) at every init: a fresh
//   start, a wake from its checkpoint, a wake that climbs its saved model through an upgrade, and a
//   live swap to new code, OTP's code_change, which runs the new code's init on the climbed model.
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { runsFor } from "@kampus/vitest";
import { Cause, Effect, Exit, Layer, Option, Result, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { Mailbox, ProcessManager, ProcessStore, Writer } from "../coordination/index.ts";
import { processId } from "../Id.test-support.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { nodeExecution, workerExecution } from "../runtime/Execution.ts";
import { Program, stepper } from "../runtime/Program.ts";
import { ProgramRunner, type Swapped } from "../runtime/Runner.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { programBox } from "./box.ts";

// Only the platform base class is fake. Every RPC method runs the real programBox.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const PID = Effect.runSync(processId);
const NAME = "probe:1";
const PACK = "demo";
const PROGRAM = `${PACK}/probe`;

/** The part of its pack's settings the probe reads. */
const Settings = Schema.Struct({ limit: Schema.Int });

/** The probe's model: a count an upgrade moves, and the settings its last init was handed. */
const Model = Schema.Struct({ count: Schema.Int, got: Schema.Json });
type Model = typeof Model.Type;
const Msg = Schema.Struct({ type: Schema.Literal("inc") });

/** The probe at version `v`: its init keeps what it was handed, so the view shows each init's
 *  settings; v2 climbs a v1 model by adding 100 to its count, so a climbed wake shows. */
const probe = (v: 1 | 2, declares: boolean) =>
  Program.make({
    name: PROGRAM,
    machine: Machine.make({
      model: Model,
      msg: Msg,
      cmds: [],
      init: (loaded, ctx) => [{ count: loaded?.count ?? 0, got: Schema.decodeUnknownSync(Schema.Json)(ctx) }, []],
      update: { inc: (s) => [{ ...s, count: s.count + 1 }, []] },
    }),
    ...(declares ? { settings: Settings } : {}),
    state: {
      v,
      upgrades:
        v === 1
          ? []
          : [
              {
                name: "count from 100",
                from: 1,
                run: (raw: unknown) => ({ ...(raw as Model), count: (raw as Model).count + 100 }),
              },
            ],
    },
    view: (s: Model) => s,
    refuse: () => null,
    inputs: { inc: "Increment" },
    outputs: {},
    writes: {},
    wake: () => null,
  });

/** The Worker path: the real program box, called over its RPC methods as the Worker Loader calls it.
 *  The runner's side passes init's two arguments as the plan's `call("init", [saved, settings])`. */
const boxed = (program: unknown, v: number) => {
  const Box = programBox(program, `build-v${v}`);
  const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
  return workerExecution({
    init: (saved: unknown, settings: unknown) => Reflect.apply(box.init, box, [saved, settings]),
    step: (s, m) => box.step(s, m),
    fresh: (s, m) => box.fresh(s, m),
    update: (s, m) => box.update(s, m),
    fold: (s, m) => box.fold(s, m),
    reply: (c, o) => box.reply(c, o),
    upgrade: (s) => box.upgrade(s),
    audit: (m) => box.audit(m),
    admit: (m) => box.admit(m),
  });
};

/** One build's program, as a loader answers it, over the in-process stepper or the real box's RPC. */
const loaded = (program: unknown, execution: "node" | "worker", v: number) => ({
  stepper: Result.getOrThrow(stepper(program)),
  execution: execution === "node" ? nodeExecution(program, `build-v${v}`) : boxed(program, v),
  declaration: { name: PROGRAM, v, inputs: { inc: { write: true, personOnly: false } }, writes: {}, cmds: [] },
  handler: () => Option.none(),
});

/** One life's loader: `program` at version `v`, and `swapTo` as build-v2 when a swap asks for it. */
const loader = (program: unknown, execution: "node" | "worker", v: number, swapTo?: unknown) => {
  const now = loaded(program, execution, v);
  const next = swapTo === undefined ? now : loaded(swapTo, execution, 2);
  return Layer.succeed(ProgramLoader, {
    load: (_name: string, build?: string) => Effect.succeed(build === "build-v2" ? next : now),
  });
};

const meta = {
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-15T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "build-v1",
} as const;

/** One process's world: its object's database and the brain's, kept across lives. */
const world = () => {
  const db = new DatabaseSync(":memory:");
  const managerDb = new DatabaseSync(":memory:");
  const sql = nodeSql(db);
  let started = false;

  /** One life of the object, handed `handed` as every pack's settings: `open` answers its view, or
   *  the failure its load ended in. Building it again is a wake with no memory. */
  const life = (
    program: unknown,
    execution: "node" | "worker",
    v: 1 | 2,
    handed: Readonly<Record<string, unknown>>,
    swapTo?: unknown,
  ) => {
    const base = Layer.mergeAll(
      LedgerSql.layer(sql, { reader: PID }).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
      RecordManager.memory(1_000_000_000),
      Archive.memory,
      SpanSink.layer(sql, { object: PID }),
    );
    const dependencies = Layer.mergeAll(
      Mailbox.layer,
      ProcessStore.layer(sql, { process: PID }),
      loader(program, execution, v, swapTo),
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
    const first = started;
    started = true;
    const manager = Layer.effectDiscard(
      first
        ? Effect.void
        : ProcessManager.use((m) =>
            m.start(
              Start.cases.first.make({ id: `boot:${NAME}`, name: NAME, code: { program: PROGRAM, hash: "build-v1" } }),
              meta,
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
        name: NAME,
        program: PROGRAM,
        build: `build-v${v}`,
        owner: Writer.cases.person.make({ key: "SHA256:fixture", for: "person-test" }),
      },
      { recovery: { sql, name: NAME, capacity: 1024 ** 3 }, settings: handed },
    ).pipe(Layer.provideMerge(Layer.mergeAll(dependencies, manager)));
    return Effect.gen(function* () {
      // A first life folds one letter, so its checkpoint is saved and the next life is a real wake.
      if (!first) {
        yield* Mailbox.use((m) =>
          m.send(NAME, "letter-1", { type: "inc" }, { ...meta, by: "SHA256:fixture", for: "person-test" }),
        );
      }

      return yield* Effect.exit(
        ProgramRunner.use((r) =>
          Effect.gen(function* () {
            const opened = yield* r.open(`client-${v}-${execution}`);

            if (swapTo === undefined) {
              return { view: opened.view, swapped: null };
            }

            // A swap, as a deploy asks for one: the live v1 process takes build-v2 in place.
            const swapped: Swapped = yield* r.swap({ load: "swap-1", program: PROGRAM, hash: "build-v2" });
            return { view: (yield* r.open(`client-swapped-${execution}`)).view, swapped };
          }),
        ),
      );
    }).pipe(Effect.provide(layer));
  };

  const close = () => {
    db.close();
    managerDb.close();
  };
  return { life, close };
};

/** The view an open answered, or the failure it ended in, as the law reads them. */
const read = (exit: Exit.Exit<{ readonly view: unknown; readonly swapped: Swapped | null }, unknown>) =>
  Exit.isSuccess(exit)
    ? { _tag: "opened" as const, view: Schema.decodeUnknownSync(Model)(exit.value.view), swapped: exit.value.swapped }
    : { _tag: "down" as const, error: Option.getOrUndefined(Cause.findErrorOption(exit.cause)) };

type Path = "fresh" | "wake" | "upgrade" | "swap";
type Kind = "takes" | "refuses" | "none";
const PATHS: ReadonlyArray<Path> = ["fresh", "wake", "upgrade", "swap"];
const KINDS: ReadonlyArray<Kind> = ["takes", "refuses", "none"];

/** Values the probe's `Settings` takes and refuses, and another pack's, which no probe may see. */
const Draw = fc.record({
  limit: fc.integer(),
  later: fc.integer(),
  bad: fc.constantFrom<unknown>("ten", null, 1.5, { limit: "ten" }, [], {}),
  other: fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), fc.integer(), { maxKeys: 3 }),
  execution: fc.constantFrom<"node" | "worker">("node", "worker"),
});

describe("Ticket 1042 N4: the runner hands each process its pack's settings at every init", () => {
  it("N4: a fresh start, a wake, a wake through an upgrade and a live swap each hand the process its pack's settings as handed now; a program that declares none gets {}; a value its settings refuse downs the load with load, never a default", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(Draw, async (d) => {
        // Every path and kind each run, so no case waits on the draw to be reached.
        for (const path of PATHS) {
          for (const kind of KINDS) {
            const declares = kind !== "none";
            const handedNow = (limit: number) => ({
              ...d.other,
              [PACK]: kind === "refuses" ? d.bad : { limit },
            });
            const w = world();

            try {
              const opened = await Effect.runPromise(
                Effect.gen(function* () {
                  if (path === "fresh") {
                    return read(yield* w.life(probe(1, declares), d.execution, 1, handedNow(d.limit)));
                  }

                  // A swap in one life: v1 boots, then takes build-v2 in place. For a refused value v1
                  // declares no settings, so it boots, and the swap to a v2 that declares them is refused.
                  if (path === "swap") {
                    const v1 = probe(1, kind === "refuses" ? false : declares);
                    return read(yield* w.life(v1, d.execution, 1, handedNow(d.limit), probe(2, declares)));
                  }

                  // The first life takes a good value; the wake is handed the value now, which a
                  // restart reads, never the one the checkpoint saved.
                  const before = read(
                    yield* w.life(probe(1, declares), d.execution, 1, { ...d.other, [PACK]: { limit: d.limit } }),
                  );
                  expect(before._tag, `N4 ${path}/${kind}: the first life opens`).toBe("opened");
                  const v = path === "upgrade" ? 2 : 1;
                  return read(yield* w.life(probe(v, declares), d.execution, v, handedNow(d.later)));
                }),
              );
              const want = path === "fresh" || path === "swap" ? d.limit : d.later;
              const label = `N4 ${path}/${kind} (${d.execution})`;
              seen.add(`${path}/${kind}/${d.execution}`);

              if (path === "swap" && kind === "refuses") {
                expect(opened, `${label}: a refused value refuses the swap, and v1 runs on`).toMatchObject({
                  _tag: "opened",
                  swapped: { _tag: "refused" },
                  view: { count: 1, got: {} },
                });
                continue;
              }

              if (kind === "refuses") {
                expect(opened, `${label}: a refused value downs the load with load`).toMatchObject({
                  _tag: "down",
                  error: { _tag: "ProgramDown", reason: "load" },
                });
                continue;
              }

              expect(opened._tag, `${label}: the process opens`).toBe("opened");
              const { view, swapped } = opened as Extract<typeof opened, { _tag: "opened" }>;
              expect(
                swapped?._tag ?? null,
                `${label}: ${path === "swap" ? "the swap takes" : "no swap was asked"}`,
              ).toBe(path === "swap" ? "swapped" : null);
              expect(view.got, `${label}: init is handed ${declares ? "its pack's settings" : "{}"}`).toEqual(
                declares ? { limit: want } : {},
              );
              // The first life's one letter is in the count: a wake read its checkpoint; 100 more, the
              // climb of the saved v1 model ran, on a wake or in the swap.
              expect(
                view.count,
                `${label}: ${path === "fresh" ? "a fresh start" : path === "wake" ? "the wake read its checkpoint" : path === "upgrade" ? "the wake climbed its v1 checkpoint" : "the swap climbed the live v1 model"}`,
              ).toBe(path === "fresh" ? 1 : path === "wake" ? 1 : 101);
            } finally {
              w.close();
            }
          }
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 10, full: 100 }) },
    );
    expect([...seen].sort(), "N4: the runs reached every path and kind on both executions").toEqual(
      PATHS.flatMap((p) => KINDS.flatMap((k) => (["node", "worker"] as const).map((e) => `${p}/${k}/${e}`))).sort(),
    );
  });
});

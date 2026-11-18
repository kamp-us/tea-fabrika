// T753 L16 full-depth fix, next/. A6 of the plan (docs/plan/quests/t753-l16-full-depth-PLAN.md): a call
// into an object commits the spans it ended together, before it answers. A real Project and a real Process
// object run on in-memory SQLite and in-memory platform handles; only Cloudflare's handles, the Worker
// Loader transport and the Record stub are doubled. The laws count the sink's transactions that landed spans
// on the object a call entered: they never read the sink's state, only the rows it commits.
import { createHash, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { runsFor, Stub } from "@kampus/vitest";
import { Deferred, Effect, Option, Predicate, Schema } from "effect";
import { vi } from "vitest";
import { Writer } from "../access/SessionManager.ts";
import { InputId } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { programBox } from "./box.ts";
import {
  configureProcess,
  processDescriptor,
  processRuntime,
  ProcessService,
  projectRuntime,
  ProjectService,
  type Env,
} from "./runtime.ts";

// Only the platform base class is fake. Every RPC method runs the real programBox.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const NAME = "counter:1";
const PROGRAM = "test/counter";
const CODE = { hash: createHash("sha256").update("call-spans").digest("hex"), source: "call-spans" };
const PERSON = "test-person";
const SENT = "2026-11-18T00:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("inc") });

const counter = {
  name: PROGRAM,
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
  inputs: { inc: { _tag: "write", schema: Msg, description: "Count", personOnly: false } },
  outputs: {},
  writes: {},
  wake: () => null,
} as const;

const START = StartsTest.fixture(
  {
    name: "project-test",
    person: PERSON,
    founder: generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x ?? "",
    window: null,
    port: 18787,
    build: CODE.hash,
  },
  (algorithm, data) => createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
);

/** An object's platform handles over in-memory SQLite. `landings` is the number of spans each sink
 *  transaction wrote, oldest first: a transaction that wrote no span is not in it. */
const handles = (db: DatabaseSync) => {
  const sql = nodeSql(db);
  const landings: Array<number> = [];
  const values = new Map<string, unknown>();
  let inserts = 0;

  return {
    landings,
    storage: {
      sql: {
        exec: (query: string, ...args: ReadonlyArray<string | number | null>) => {
          if (/INSERT INTO unsent/i.test(query)) {
            inserts += 1;
          }

          return sql.exec(query, ...args);
        },
        get databaseSize() {
          return sql.size();
        },
      },
      transactionSync: <A>(step: () => A): A => {
        inserts = 0;
        const done = sql.transaction(step);

        if (inserts > 0) {
          landings.push(inserts);
        }

        return done;
      },
      get: (key: string) => Promise.resolve(values.get(key)),
      put: (key: string, value: unknown) => {
        values.set(key, value);

        return Promise.resolve();
      },
      delete: (key: string) => Promise.resolve(values.delete(key)),
      sync: () => Promise.resolve(),
      setAlarm: () => Promise.resolve(),
      deleteAlarm: () => Promise.resolve(),
    },
  };
};

/** A call on an object stub rejected. */
class CallFailure extends Schema.TaggedError<CallFailure>()("CallFailure", { cause: Schema.Defect() }) {}

/** A Durable Object stub's calls, by the RPC's own name. */
type Calls = { readonly [method: string]: (...args: ReadonlyArray<unknown>) => Promise<unknown> };

/** The member of `service` named `method`, run: a member is an Effect or a function that answers one. */
const member = (service: object, method: string, args: ReadonlyArray<unknown>) => {
  const found = Object.entries(service).find(([key]) => key === method)?.[1];

  if (Effect.isEffect(found)) {
    return found;
  }

  if (Predicate.isFunction(found)) {
    return Reflect.apply(found, service, args) as Effect.Effect<unknown, unknown>;
  }

  return Effect.die(new Error(`no member ${method}`));
};

/** A real Project and a real Process, joined as the platform joins them: each stub runs the other's
 *  service. Every `count` call goes through the stub the entering object's own caller would use. */
const open = Effect.fnUntraced(function* () {
  const projectHandles = handles(new DatabaseSync(":memory:"));
  const processDb = new DatabaseSync(":memory:");
  const processHandles = handles(processDb);
  const entered = yield* Deferred.make<void>();
  const deliveries: Array<Promise<void>> = [];
  const Box = programBox(counter, CODE.hash);
  const programs = { [PROGRAM]: CODE };

  // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node supplies only the platform handles the real Project reads
  const projectCtx = {
    id: { name: "project-test" },
    storage: projectHandles.storage,
    exports: { IsolateTail: () => ({ fetch: () => Promise.resolve(new Response()) }) },
  } as unknown as DurableObjectState;

  // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node supplies only the platform handles the real Process reads
  const processCtx = {
    id: { name: JSON.stringify(["project-test", NAME]) },
    storage: processHandles.storage,
    exports: { IsolateTail: () => ({ fetch: () => Promise.resolve(new Response()) }) },
  } as unknown as DurableObjectState;

  // The runtimes need `env`, and the stubs in `env` need the runtimes: each stub reads its runtime when called.
  const runtimes: { project?: ReturnType<typeof projectRuntime>; process?: ReturnType<typeof processRuntime> } = {};

  const projectStub = Stub.make<Calls>((method) => (...args) => {
    const runtime = Option.getOrThrow(Option.fromUndefinedOr(runtimes.project));

    if (method === "settingsStart" || method === "settingsRead") {
      return Effect.runPromise(member(runtime, method, args));
    }

    return runtime.runPromise(
      ProjectService.use((service) => member(service, method === "clientConnect" ? "connect" : method, args)),
    );
  });

  const processStub = Stub.make<Calls>((method) => (...args) => {
    const runtime = Option.getOrThrow(Option.fromUndefinedOr(runtimes.process));

    if (method === "configure") {
      const done = Effect.runPromise(
        configureProcess(processCtx, args[0] as Parameters<typeof configureProcess>[1], runtime),
      );
      deliveries.push(done);
      Effect.runSync(Deferred.succeed(entered, undefined));

      return done;
    }

    if (method === "descriptor") {
      return Effect.runPromise(processDescriptor(processCtx));
    }

    return runtime.runPromise(ProcessService.use((service) => member(service, method, args)));
  });

  // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node namespaces call the real services but have no workerd brands
  const env = {
    INSTANCE: JSON.stringify(START),
    PROJECT: { getByName: () => projectStub },
    PROCESS: { getByName: () => processStub },
    CONNECTION: {
      getByName: () => ({
        ring: () => Promise.resolve(),
        notify: () => Promise.resolve(),
        probe: () => Promise.resolve(0),
      }),
    },
    RECORD: { getByName: () => ({ write: () => Promise.resolve({ _tag: "written" }) }) },
    MEASUREMENTS: {},
    LOADER: { get: () => ({ getEntrypoint: () => Reflect.construct(Box, []) }) },
  } as unknown as Env;

  const project = projectRuntime(projectCtx, env, {
    programs,
    // The Project boots the counter itself, as an instance boots its programs.
    bootstrap: [{ id: NAME, name: NAME, program: PROGRAM }],
    // No gateway runs here: the door's two calls a Process makes, the check of a letter and the retiring of an
    // ended process's session, accept at once.
    door: () => Effect.succeed({ checkDelivery: () => Effect.void, retire: () => Effect.void } as never),
  });
  const process = processRuntime(processCtx, env, programs);
  runtimes.project = project;
  runtimes.process = process;

  yield* Effect.addFinalizer(() =>
    Effect.tryPromise({
      try: async () => {
        await process.dispose();
        await project.dispose();
        processDb.close();
      },
      catch: (cause) => new CallFailure({ cause }),
    }).pipe(Effect.orDie),
  );

  // The first Project call builds it, and the build starts its bootstrap without waiting on its delivery.
  const call = (stub: Calls, method: string, ...args: ReadonlyArray<unknown>) =>
    Effect.tryPromise({
      try: () => stub[method]?.(...args) ?? Promise.resolve(undefined),
      catch: (cause) => new CallFailure({ cause }),
    });

  yield* call(projectStub, "info");
  yield* Deferred.await(entered);
  yield* Effect.tryPromise({ try: () => Promise.all(deliveries), catch: (cause) => new CallFailure({ cause }) });

  return { projectHandles, processHandles, projectStub, processStub, call };
});

type World = Effect.Success<ReturnType<typeof open>>;

const input = (id: number) => ({
  id: `letter-${id}`,
  envelope: {
    id: Schema.decodeSync(InputId)(`input_0000000000e008${id.toString(16).padStart(12, "0")}`),
    by: Writer.cases.person.make({ key: "SHA256:input", for: PERSON }),
    arrivedAt: 0,
    input: { type: "inc" },
  },
  sentAt: SENT,
  seen: 0,
  span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
});

const Move = Schema.Literals([
  "process.open",
  "process.msg",
  "process.due",
  "process.alarm",
  "process.init",
  "process.restart",
  "process.mailed",
  "project.info",
  "project.processStatus",
  "project.processIsLive",
  "project.processResolve",
]);

type Move = typeof Move.Type;

/** The most sink transactions a call may use. A Process call's runner flushes inside its call: that commits
 *  the batch so far, and the call's end commits what ended after the flush. A Project call's batch ends before
 *  its flush. */
const MOST = { process: 2, project: 1 } as const;

const REQUIRED = [...Move.literals, "a call that ended more spans than its bound"];

const reached = new Set<string>();

describe("T753 L16 a call commits its spans together", () => {
  // Plants (run once, not kept): remove the batch from `attributed` and from `wrapped`, so each span commits
  // as it ends and the bound is passed; and batch outside the runner's flush with no flush commit, so the
  // call's own flush ships nothing of what it ended (a Process call that ships fewer spans than it ended).
  it.effect.prop(
    "A6 every Process call and wrapped Project call commits the spans it ended in at most one transaction before it flushes, and the call's end in one more",
    { moves: Schema.Array(Move).check(Schema.isMinLength(3), Schema.isMaxLength(10)) },
    ({ moves }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w: World = yield* open();
          // The first call builds the object's services, which is outside any call's spans.
          yield* w.call(w.processStub, "open", "warm");
          let letter = 0;
          let restarts = 0;

          // The generated moves come first, then each kind once, so no run leaves a kind unreached.
          for (const move of [...moves, ...Move.literals]) {
            reached.add(move);
            const side = move.startsWith("process.") ? "process" : "project";
            const object = side === "process" ? w.processHandles : w.projectHandles;
            const before = object.landings.length;
            const spans = object.landings.reduce((total, n) => total + n, 0);

            switch (move) {
              case "process.open":
                yield* w.call(w.processStub, "open", "client");
                break;
              case "process.msg":
                yield* w.call(w.processStub, "msg", input(++letter));
                break;
              case "process.due":
                yield* w.call(w.processStub, "due", 0);
                break;
              case "process.alarm":
                yield* w.call(w.processStub, "alarm");
                break;
              case "process.init":
                yield* w.call(w.processStub, "init");
                break;
              case "process.restart":
                yield* w.call(w.processStub, "restart", { id: `restart-${++restarts}`, build: CODE.hash });
                break;
              case "process.mailed":
                yield* w.call(w.processStub, "mailed");
                break;
              case "project.info":
                yield* w.call(w.projectStub, "info");
                break;
              case "project.processStatus":
                yield* w.call(w.projectStub, "processStatus", NAME);
                break;
              case "project.processIsLive":
                yield* w.call(w.projectStub, "processIsLive", NAME);
                break;
              case "project.processResolve":
                yield* w.call(w.projectStub, "processResolve", NAME);
                break;
            }

            const used = object.landings.length - before;
            const ended = object.landings.reduce((total, n) => total + n, 0) - spans;

            if (ended > MOST[side]) {
              reached.add("a call that ended more spans than its bound");
            }

            expect(
              used,
              `${move} ended ${ended} spans in ${used} sink transactions, over ${MOST[side]}`,
            ).toBeLessThanOrEqual(MOST[side]);
          }
        }),
      ),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 40 }) } },
  );
  it("scenario: every call the law names was reached by its generated walks", () => {
    expect(
      REQUIRED.filter((kind) => !reached.has(kind)),
      "calls the walk never reached",
    ).toEqual([]);
  });
});

// P14 slice 2, next/ (ticket 828): laws L13 (notices name their process) and L21 (the boot list) of the
// approved plan, on the app's real Project and Process wiring over SQLite. Written before the boot
// list and the `pid` on view notices. Only Cloudflare's handles and the Worker Loader transport are
// supplied by this Node fixture, as `runtime-recovery.laws.test.ts` supplies them; each program runs in
// the real `programBox`. Every world is acquired in a scope and closed by it (0061).
//
// The shape these laws hold the code to, from the plan:
// - The app's `projectRuntime` boots `bootstrap: [counter:1 as fabrika/counter, checklist:1 as
//   fabrika/checklist]`: on a fresh brain each entry starts once, in that order; a reopen starts none
//   again and reads each entry's own first placing (`processes/<name>`); an entry whose program the
//   table lacks fails the boot with a typed error and starts no entry.
// - `src/table.ts` lists `fabrika/checklist`.
// - Every `view.whole` and `view.patch` the brain sends a client for `checklist:1` carries `pid`, the
//   process it is about, beside the update its Process published, which reaches the client unchanged.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { applyCell } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { checklist, checklistMachine, checklistView } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
import { counter } from "@kampus/counter";
import type { Descriptor } from "@kampus/libfabrika";
import { programBox } from "@kampus/libfabrika/box";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { fcExitReason } from "@kampus/libfabrika/processes/Process.test-support";
import { News, Published } from "@kampus/libfabrika/runtime/News";
import * as SettingsStart from "@kampus/libfabrika/settings/Start";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { tezgahName } from "@kampus/libfabrika/tezgah/Workspace";
import type { ProcessBinding, ProjectBinding } from "@kampus/libfabrika/workers/bindings";
import {
  configureProcess,
  processDescriptor,
  processRuntime,
  ProcessService,
  ProjectService,
  signingReply,
  commitReply,
} from "@kampus/libfabrika/workers/runtime";
import { tezgah } from "@kampus/tezgah";
import { runsFor, Stub } from "@kampus/vitest";
import { Cause, Deferred, Effect, Exit, Predicate, Schema } from "effect";
import * as fc from "fast-check";
import { programs as built } from "virtual:fabrika-built";
import { assert, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { projectRuntime, type Env } from "./runtime.ts";

// Each built-in program's hash is the SHA-256 of its source, as `BuiltProgram` requires.
const CODE = {
  counter: { hash: "efe899c74558f20b08bbc19bf0228c0c25bddb7871d80bd34ac8b33c030b3698", source: "counter" },
  checklist: { hash: "6da624dba5235ba1f3901c904a78ea41debbfb0d8a488aeba7063dba508d9211", source: "checklist" },
  tezgah: { hash: "a789b5dbd2d82dbed50bc81e9689731dfbb2e3a068c8373ee22182129a7ceb41", source: "tezgah" },
};

const table = vi.hoisted(() => ({ programs: {} as Record<string, { hash: string; source: string }> }));

vi.mock("./table.ts", () => table);

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

vi.mock("virtual:fabrika-built", () => ({ ...table, assets: {} }));

const SEED = 119120;

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const SENT = "2026-11-11T04:00:00.000Z";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

// Desk S2a: the founder's tezgah boots third, from the boot list like every other entry (plan
// amendment after S2a's first review), named by libfabrika's one name function.
const BOOT = ["counter:1", "checklist:1", tezgahName(PERSON)] as const;

// L20 is checked by CI's typecheck, beside the app that may import both Tuval and a program.
// The program type links the decoder and child's press without adding a program to saved state.
it("pinned: L20 windowMachineFor checks the registration's decoder and tile presses against the program", () => {
  const parent = windowMachineFor<typeof checklist>({
    decode: () => Schema.decodeUnknownSync(checklistWindow.data),
    tile: () => checklistWindow.tile,
  });

  expect(parent.init).toBeTypeOf("function");

  type Checks = Parameters<typeof windowMachineFor<typeof checklist>>[0];

  type Decode = ReturnType<NonNullable<Checks["decode"]>>;

  expectTypeOf<ReturnType<Decode>>().toEqualTypeOf<typeof checklistWindow.data.Type>();

  // @ts-expect-error a decoder for unknown does not check the program's view
  windowMachineFor<typeof checklist>({ decode: () => Schema.decodeUnknownSync(Schema.Unknown) });
  // @ts-expect-error another program's view does not match this registration
  windowMachineFor<typeof checklist>({ decode: () => Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Int })) });

  const wrongPress = Cmd.make("press", {
    input: Schema.Struct({ m: Schema.Struct({ type: Schema.Literal("unrelated") }) }),
    ok: Schema.Null,
    err: [],
  });

  const wrongTile = Machine.make({
    model: Schema.Struct({}),
    msg: Schema.Struct({ type: Schema.Literal("submit") }),
    cmds: [wrongPress],
    init: () => [{}, []],
    update: {
      submit: (s) => [s, [wrongPress({ m: { type: "unrelated" } })]],
      press_ok: (s) => [s, []],
      press_err: (s) => [s, []],
    },
  });

  // @ts-expect-error the parent may not erase an incompatible tile's press Msg to AnyTile
  windowMachineFor<typeof checklist>({ tile: () => wrongTile });
});

type ProjectCalls = (typeof ProjectService)["Service"];

type ProcessCalls = (typeof ProcessService)["Service"];

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    size = Buffer.alloc(4);

  size.writeUInt32BE(body.length);

  return Buffer.concat([size, body]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    bytes = Buffer.from(pair.publicKey.export({ format: "jwk" }).x!, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);

  return {
    raw: bytes.toString("base64url"),
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);

      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);

      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
      ]);

      return `-----BEGIN SSH SIGNATURE-----\n${packet
        .toString("base64")
        .match(/.{1,70}/g)!
        .join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const storage = (db: DatabaseSync, alarm?: (at: number | null) => void) => {
  const sql = nodeSql(db),
    values = new Map<string, unknown>();

  return {
    values,
    sql: {
      exec: sql.exec,
      get databaseSize() {
        return sql.size();
      },
    },
    transactionSync: sql.transaction,
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    delete: async (key: string) => values.delete(key),
    sync: async () => {},
    setAlarm: async (at: number) => alarm?.(at),
    deleteAlarm: async () => alarm?.(null),
  };
};

/**
 * The call `method` names on a service, as the platform's RPC reaches it: any own or inherited
 * member, which must be a function, called on the service with `args`.
 */
const callByName = (service: object, method: string, args: ReadonlyArray<unknown>): unknown => {
  const member = Predicate.hasProperty(service, method) ? service[method] : undefined;
  assert(Predicate.isFunction(member), `the service has no ${method} call`);
  return Reflect.apply(member, service, args);
};

const projectObject = (ctx: DurableObjectState, env: Env) => {
  const runtime = projectRuntime(ctx, env);
  const run = <A, E>(use: (p: ProjectCalls) => Effect.Effect<A, E>) => runtime.runPromise(ProjectService.use(use));

  return { runtime, run, exit: () => runtime.runPromiseExit(ProjectService) };
};

const processObject = (ctx: DurableObjectState, env: Env) => {
  const runtime = processRuntime(ctx, env, built);
  const run = <A, E>(use: (p: ProcessCalls) => Effect.Effect<A, E>) => runtime.runPromise(ProcessService.use(use));

  return {
    runtime,
    configure: (descriptor: Descriptor) => Effect.runPromise(configureProcess(ctx, descriptor, runtime)),
    descriptor: () => Effect.runPromise(processDescriptor(ctx)),
    call: (method: string, args: ReadonlyArray<unknown>) =>
      run((p) => callByName(p, method, args) as Effect.Effect<unknown, unknown>),
  };
};

const proof = () => ({ cases: 0, moves: 0, started: 0, completed: 0, canceled: 0, future: 0 });

type Proof = ReturnType<typeof proof>;

class AlarmFailure extends Schema.TaggedError<AlarmFailure>()("AlarmFailure", { cause: Schema.Defect() }) {}

type AlarmWork = {
  readonly at: number;
  readonly done: Deferred.Deferred<void, AlarmFailure>;
};

type Entry = {
  object: ReturnType<typeof processObject>;
  readonly db: DatabaseSync;
  readonly ctx: DurableObjectState;
  scheduled: { readonly timer: ReturnType<typeof setTimeout>; readonly work: AlarmWork } | undefined;
};

/** What a client was sent, and what each Process published for it, in order. */
type Heard = { readonly client: string; readonly news: unknown };

/** One brain on fresh stores: the real Project, a real Process per started name, and the loader. */
const world = (options: { readonly lacks?: string; readonly proof?: Proof } = {}) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      // In place: the mocked modules hold this very object, so a new one would never reach them.
      Object.assign(table.programs, {
        "fabrika/counter": CODE.counter,
        "fabrika/checklist": CODE.checklist,
        "fabrika/tezgah": CODE.tezgah,
      });

      if (options.lacks !== undefined) {
        delete table.programs[options.lacks];
      }

      const key = identity(),
        db = new DatabaseSync(":memory:");

      const loopbacks = { IsolateTail: () => ({ fetch: async () => new Response() }) };

      // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies only the platform handles the real Project reads
      const ctx = {
        id: { name: "project-test" },
        storage: storage(db),
        exports: loopbacks,
      } as unknown as DurableObjectState;

      const counts = options.proof ?? proof();
      counts.cases++;

      const processes = new Map<string, Entry>(),
        configured: Array<Descriptor> = [],
        heard: Array<Heard> = [],
        published: Array<Heard> = [],
        alarms = new Set<AlarmWork>(),
        running = new Set<AlarmWork>();

      const cancel = (entry: Entry) => {
        const pending = entry.scheduled;

        if (pending !== undefined) {
          clearTimeout(pending.timer);
          counts.canceled++;
          Deferred.doneUnsafe(pending.work.done, Effect.void);
          alarms.delete(pending.work);
          entry.scheduled = undefined;
        }
      };

      // Finished records stay until read, so a failure before settled starts cannot disappear.
      const settled = Effect.gen(function* () {
        while (true) {
          const due = [...alarms].filter((work) => work.at <= Date.now() || running.has(work));

          if (due.length === 0) {
            return;
          }

          yield* Effect.forEach(due, (work) => Deferred.await(work.done), { concurrency: "unbounded" });

          for (const work of due) {
            alarms.delete(work);
          }
        }
      });

      let closed = false;
      let project: ReturnType<typeof projectObject>;

      const projectCall = (method: string) => (args: ReadonlyArray<unknown>) => {
        if (method === "publish") {
          published.push({ client: String(args[0]), news: structuredClone(args[1]) });
        }

        // The instance's recorded settings live in the Project object, beside its services.
        if (method === "settingsStart") {
          return Effect.runPromise(
            project.runtime.settingsStart(Schema.decodeUnknownSync(SettingsStart.Input)(args[0])),
          );
        }

        if (method === "settingsRead") {
          return Effect.runPromise(project.runtime.settingsRead(String(args[0])));
        }

        return project.run((p) => {
          const work = callByName(p, method, args) as Effect.Effect<unknown, unknown>;
          return method === "sign"
            ? signingReply(work as never)
            : method === "commit"
              ? commitReply(work as never)
              : work;
        });
      };

      // oxlint-disable-next-line fabrika/no-type-assertions -- Node namespaces call the real services but lack workerd's nominal brands
      const env = {
        INSTANCE: JSON.stringify(
          RecordWireTest.settingsFixture({
            name: "project-test",
            person: PERSON,
            founder: key.line,
            window: key.raw,
            port: 18787,
            build: "brain-test",
          }),
        ),
        PROJECT: {
          getByName: () =>
            Stub.make<ProjectBinding>(
              (method) =>
                (...args: ReadonlyArray<unknown>) =>
                  projectCall(method)(args),
            ),
        },
        PROCESS: {
          getByName: (name: string) => {
            const [, storageKey] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String]))(
              JSON.parse(name),
            );

            const made = (): Entry => {
              const processDb = new DatabaseSync(":memory:");
              let entry: Entry | undefined;

              // The platform alarm: a past time fires at once, as the Process object's alarm does.
              const handles = storage(processDb, (at) => {
                if (entry === undefined) {
                  return;
                }

                cancel(entry);

                if (at !== null && !closed) {
                  const current = entry;
                  const work: AlarmWork = { at, done: Deferred.makeUnsafe<void, AlarmFailure>() };
                  alarms.add(work);

                  const timer = setTimeout(
                    () => {
                      current.scheduled = undefined;
                      running.add(work);
                      counts.started++;
                      // The existing platform Promise ends after publish and notify have been awaited.
                      void Effect.runPromise(
                        Deferred.complete(
                          work.done,
                          Effect.tryPromise({
                            try: () => current.object.call("alarm", []),
                            catch: (cause) => new AlarmFailure({ cause }),
                          }).pipe(
                            Effect.asVoid,
                            Effect.ensuring(
                              Effect.sync(() => {
                                running.delete(work);
                                counts.completed++;
                              }),
                            ),
                          ),
                        ),
                      );
                    },
                    Math.max(0, at - Date.now()),
                  );

                  current.scheduled = { timer, work };
                }
              });

              // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies the handles the real Process reads
              const processCtx = {
                id: { name },
                storage: handles,
                exports: loopbacks,
              } as unknown as DurableObjectState;

              entry = { db: processDb, ctx: processCtx, scheduled: undefined, object: processObject(processCtx, env) };
              processes.set(storageKey, entry);

              return entry;
            };

            const current = processes.get(storageKey) ?? made();
            return Stub.make<ProcessBinding>(
              (method) =>
                (...args: ReadonlyArray<unknown>) =>
                  current.object.call(method, args),
              {
                configure: (descriptor: Descriptor) => {
                  configured.push(structuredClone(descriptor));
                  return current.object.configure(descriptor);
                },
                descriptor: () => current.object.descriptor(),
              },
            );
          },
        },
        CONNECTION: {
          getByName: () => ({
            ring: async () => {},
            notify: async (client: string, news: unknown) => {
              heard.push({ client, news: structuredClone(news) });
            },
            probe: async () => 42,
          }),
        },
        RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
        MEASUREMENTS: {},
        LOADER: {
          get: (id: string) => ({
            getEntrypoint: () => {
              const Box = programBox(
                id.startsWith(`${CODE.checklist.hash}/`)
                  ? checklist
                  : id.startsWith(`${CODE.tezgah.hash}/`)
                    ? tezgah
                    : counter,
                id,
              );

              return Reflect.construct(Box, []);
            },
          }),
        },
      } as unknown as Env;

      project = projectObject(ctx, env);

      const from = {
        by: key.fingerprint,
        for: PERSON,
        sentAt: SENT,
        seen: 0,
        parent: null,
        traceId: TRACE,
        build: "brain-test",
      };

      return {
        key,
        env,
        configured,
        startsPending: () => db.prepare("SELECT process FROM dev_descriptors WHERE pending>0").all().length,
        heard,
        published,
        settled,
        from,
        get project() {
          return project;
        },
        reopen: Effect.promise(async () => {
          await project.runtime.dispose();
          project = projectObject(ctx, env);

          return project.exit();
        }),
        close: async () => {
          closed = true;
          counts.future += [...alarms].filter((work) => work.at > Date.now() && !running.has(work)).length;

          for (const p of processes.values()) {
            cancel(p);
          }

          // Calls already started keep their own records when another alarm replaces theirs.
          await Effect.runPromise(
            Effect.forEach([...running], (work) => Effect.exit(Deferred.await(work.done)), {
              concurrency: "unbounded",
            }),
          );

          for (const p of processes.values()) {
            await p.object.runtime.dispose();
            p.db.close();
          }

          await project.runtime.dispose();
          db.close();
        },
      };
    }),
    (w) => Effect.promise(() => w.close()),
  );

type World = Effect.Success<ReturnType<typeof world>>;

const call = <A>(w: World, use: (p: ProjectCalls) => Effect.Effect<A, unknown>) =>
  Effect.promise(() => w.project.run(use));

const Started = Schema.TaggedStruct("started", { body: Schema.Struct({ process: Schema.String }) });

/** The live process each boot entry placed first, read from its own `processes/<name>`. */
const placings = (w: World) =>
  Effect.forEach(
    BOOT,
    (name) =>
      call(w, (p) => p.read(`processes/${name}`, 0, "audit")).pipe(
        Effect.map((entries) => entries.filter(Schema.is(Started)).map((e) => e.body.process)),
      ),
    { concurrency: 1 },
  );

const admit = (w: World) =>
  Effect.gen(function* () {
    const client = yield* call(w, (p) => p.connect());
    yield* call(w, (p) => p.register(client, "test-connection", "test-session"));
    const nonce = yield* call(w, (p) => p.challenge(client));
    const tab = "checklist-instance";

    const admitted = yield* call(w, (p) =>
      p.initialize(
        client,
        {
          versions: [1],
          has: ["seal"],
          ping: "30s",
          key: w.key.raw,
          tab,
          nonce,
          platform: "headless",
          os: "linux",
          sentAt: SENT,
          signed: w.key.proof(`fabrika-hello\nhttp://127.0.0.1:18787\n${tab}\n${nonce}`),
        },
        { url: "http://127.0.0.1:18787", tab, name: w.key.fingerprint },
      ),
    );

    expect(admitted).toMatchObject({ _tag: "online" });

    return client;
  });

describe("L21: the boot list", () => {
  it("each entry starts once, in order; a reopen starts none again and reads each entry's first placing", async () => {
    const seen = { reopen: 0, exit: 0, input: 0 };
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ move: fc.nat(), pick: fc.nat(), reason: fcExitReason }), { minLength: 1, maxLength: 6 }),
        (moves) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const w = yield* world();
                expect(Exit.isSuccess(yield* Effect.promise(() => w.project.exit())), "the boot failed").toBe(true);
                yield* Effect.promise(() => vi.waitFor(() => expect(w.startsPending()).toBe(0), { timeout: 2_000 }));
                expect(
                  w.configured.map((d) => d.name),
                  "the boot list started once each, in order",
                ).toEqual([...BOOT]);
                const first = yield* placings(w);
                expect(first.map((p) => p.length)).toEqual([1, 1, 1]);
                const live = new Set(first.flat());
                const client = yield* admit(w);

                for (const m of moves) {
                  const pids = [...live];
                  const options = ["reopen", ...(pids.length > 0 ? (["exit", "input"] as const) : [])] as const;
                  const move = options[m.move % options.length]!;
                  const pid = pids[m.pick % Math.max(1, pids.length)];

                  if (move === "reopen") {
                    seen.reopen++;
                    const before = w.configured.length;
                    const reopened = yield* w.reopen;
                    expect(Exit.isSuccess(reopened), "a reopen failed").toBe(true);
                    yield* Effect.promise(() =>
                      vi.waitFor(() => expect(w.startsPending()).toBe(0), { timeout: 2_000 }),
                    );
                    expect(w.configured.length, "a reopen started an entry again").toBe(before);
                    expect(yield* placings(w), "a reopen changed a first placing").toEqual(first);
                    yield* call(w, (p) => p.register(client, "test-connection", "test-session"));
                  } else if (move === "exit") {
                    seen.exit++;
                    yield* call(w, (p) => p.exit(pid!, m.reason, w.from));
                    live.delete(pid!);
                  } else {
                    seen.input++;
                    const isChecklist = pid === first[1]![0];
                    yield* call(w, (p) =>
                      p.route(client, "process.send", {
                        pid,
                        letter: `letter_${seen.input}_${m.pick}`,
                        m: isChecklist ? { type: "add", name: `item ${m.pick}` } : { type: "inc" },
                        sentAt: SENT,
                        seen: 0,
                      }),
                    );
                  }
                }
              }),
            ),
          ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 5, full: 50 }) },
    );
    expect(seen.reopen).toBeGreaterThan(0);
    expect(seen.exit).toBeGreaterThan(0);
    expect(seen.input).toBeGreaterThan(0);
  });

  // Desk S2a: tezgah is a boot entry like the checklist, so a table without it fails the boot too.
  for (const lacks of ["fabrika/checklist", "fabrika/tezgah"]) {
    it(`scenario: an entry whose program the table lacks (${lacks}) stops the boot with a typed error and starts no entry`, async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world({ lacks });
            const exit = yield* Effect.promise(() => w.project.exit());
            expect(Exit.isFailure(exit), `a boot without ${lacks} succeeded`).toBe(true);
            const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;
            expect(failure?._tag, "the failure is a typed error, not a defect").toBe("Some");
            expect(w.configured, "a half-started boot list").toEqual([]);
          }),
        ),
      );
    });
  }
});

describe("L13: notices name their process", () => {
  it("successive sends land and a client joining after the first send opens the current checklist", async () => {
    const counts = proof();
    const started = performance.now();
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,12}$/), { minLength: 2, maxLength: 5 }), (names) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* world({ proof: counts });
              expect(Exit.isSuccess(yield* Effect.promise(() => w.project.exit()))).toBe(true);

              const [, [pid]] = Schema.decodeUnknownSync(
                Schema.Tuple([Schema.Array(Schema.String), Schema.Array(Schema.String), Schema.Array(Schema.String)]),
              )(yield* placings(w));

              const client = yield* admit(w);
              yield* call(w, (p) => p.route(client, "view.open", { pid }));
              let model = checklistMachine.init(null, {})[0];

              for (const [n] of names.entries()) {
                counts.moves++;
                const name = names.filter((candidate) => !model.items.some((item) => item.name === candidate))[0]!;
                const msg = { type: "add" as const, name };

                const answer = yield* call(w, (p) =>
                  p.route(client, "process.send", {
                    pid,
                    letter: `progress_${n}`,
                    m: msg,
                    sentAt: SENT,
                    seen: 0,
                  }),
                );

                expect(answer, `send ${n + 1} reaches the same live process`).toMatchObject({
                  result: { _tag: "accepted" },
                });
                model = applyCell(checklistMachine, model, msg)[0];
                // Plant: finish the alarm record before a Deferred-held Process call.
                yield* w.settled;
                const late = yield* admit(w);
                const opened = yield* call(w, (p) => p.route(late, "view.open", { pid }));

                const { result } = Schema.decodeUnknownSync(
                  Schema.Struct({ result: Schema.Struct({ rev: Schema.Int, view: checklistView }) }),
                )(opened);

                // Ticket 866 saves wake 0 and delivers timer {at: 0}. That is a requested wake,
                // not today's time: an item added just now must not already be a day old.
                expect(
                  result.view.items.find((item) => item.name === name)?.state,
                  "a fresh item's immediate wake leaves it open, never late",
                ).toBe("open");
                expect(
                  result.view.items.map((item) => item.name),
                  "a late subscriber gets the current view",
                ).toEqual(model.items.map((item) => item.name));
              }
            }),
          ),
        ),
      ),
      {
        seed: SEED,
        numRuns: runsFor({ fast: 10, full: 100 }),
        // pinned: the host's first add succeeded, then every send and late view.open was unreachable.
        examples: [[["milk", "bread"]]],
      },
    );
    console.info("L13 successive sends proof", { ...counts, ms: performance.now() - started });
  });

  // Plants: remove pid, alter the body, or drop notify at the real delivery adapter.
  it("each view.whole and view.patch for checklist:1 carries its pid and the update its Process published", async () => {
    const counts = proof();
    const started = performance.now();
    const seen = { whole: 0, patch: 0, arrays: 0, refused: 0 };
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ move: fc.nat(), pick: fc.nat(), name: fc.constantFrom("milk", "bread", "eggs", "tea") }), {
          minLength: 1,
          maxLength: 12,
        }),
        (moves) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const w = yield* world({ proof: counts });
                expect(Exit.isSuccess(yield* Effect.promise(() => w.project.exit()))).toBe(true);

                const [, [pid]] = Schema.decodeUnknownSync(
                  Schema.Tuple([Schema.Array(Schema.String), Schema.Array(Schema.String), Schema.Array(Schema.String)]),
                )(yield* placings(w));

                const client = yield* admit(w);
                const opened = yield* call(w, (p) => p.route(client, "view.open", { pid }));
                expect(opened, "view.open answered").toBeDefined();
                // The walk's own fold of the list's names and boxes, from each answer the brain gave.
                const items = new Map<string, boolean>();
                let n = 0;

                for (const m of moves) {
                  counts.moves++;
                  const names = [...items.keys()];
                  const held = names.length === 0 ? null : names[m.pick % names.length]!;

                  const options: Array<{ readonly type: string; readonly name: string } | null> = [
                    { type: "add", name: m.name },
                    null, // a timer: the alarm the program asked for fires on its own
                    ...(held === null
                      ? []
                      : [
                          { type: "add", name: held },
                          { type: items.get(held) ? "uncheck" : "check", name: held },
                          { type: "remove", name: held },
                        ]),
                  ];

                  const input = options[m.move % options.length]!;

                  if (input !== null) {
                    const answer = yield* call(w, (p) =>
                      p.route(client, "process.send", {
                        pid,
                        letter: `letter_${++n}`,
                        m: input,
                        sentAt: SENT,
                        seen: 0,
                      }),
                    );

                    const refused = JSON.stringify(answer).includes('"refused"');
                    seen.refused += refused ? 1 : 0;

                    if (!refused) {
                      if (input.type === "add") {
                        items.set(input.name, false);
                      } else if (input.type === "remove") {
                        items.delete(input.name);
                      } else {
                        items.set(input.name, input.type === "check");
                      }
                    }
                  }

                  yield* w.settled;
                }

                yield* w.settled;
                // Read as the Connection object reads them: a view news, and the Published it holds.
                const views = w.heard.map((h) => h.news).filter(News.guards.view);
                const theirs = w.published.map((h) => h.news).filter(Schema.is(Published));
                expect(views.length, "the client heard the checklist's views").toBeGreaterThan(0);
                expect(views.length).toBe(theirs.length);

                for (const [i, { update }] of views.entries()) {
                  expect(update.pid, "a notice names its process").toBe(pid);
                  expect(update, "the update its Process published reached the client unchanged").toEqual(theirs[i]);
                  seen[update.type]++;
                  seen.arrays +=
                    update.type === "patch" && update.patch.some((op) => op.path.startsWith("/items/")) ? 1 : 0;
                }
              }),
            ),
          ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 10, full: 100 }) },
    );
    console.info("L13 forwarding proof", { ...counts, ms: performance.now() - started });
    expect(seen.patch).toBeGreaterThan(0);
    expect(seen.arrays, "array ops reached the client").toBeGreaterThan(0);
    expect(seen.refused, "some inputs were refused").toBeGreaterThan(0);
  });
});

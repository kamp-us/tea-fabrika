// Program watch (docs/plan/quests/watch-PLAN.md, amendment A-Workerd), next/: laws M13 and M16 on real
// workerd, sockets, object storage and the private local instance capability, set up the way
// worker-mail.integration.test.ts sets up its two Process objects. M13: a program in one Process
// object monitors a program in another by its registered name, is refused for a name nobody
// registered, ends one of its watches, and when the other exits folds one `DOWN`, for the watch it
// kept. M16: that `DOWN` folds with no call into the watcher's object after its watch is set, when
// the watched program exits and when its parent stops it with `stop_child`.
// Host-only: it starts a real instance, so it runs in CI's full run only, never on the laptop
// (0536, 0178).
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { ExitReason } from "@kampus/libfabrika/processes/ExitReason";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Sent } from "@kampus/libfabrika/runtime/Runner";
import { Array as Arr, String as Str } from "effect";
import { SecureRandom } from "effect/crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { expect, it } from "vitest";
import { noTracking, scopedEnv } from "./env.test-support.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const SENT = "2026-11-15T04:00:00.000Z";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const PROJECT = "m13-watch";

/** Bounded waits tied to observable facts. */
const WAIT = 25_000;

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    n = Buffer.alloc(4);

  n.writeUInt32BE(body.length);

  return Buffer.concat([n, body]);
};

/** The founder's key, and its signature over the door's hello. */
const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    raw = pair.publicKey.export({ format: "jwk" }).x!;

  const bytes = Buffer.from(raw, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);

  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${Str.replace(/=+$/, "")(createHash("sha256").update(bytes).digest("base64"))}`,
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);

      const v = Buffer.alloc(4);
      v.writeUInt32BE(1);

      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        v,
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

type Key = ReturnType<typeof identity>;

// The two programs, as source the real app build bundles. The reader watches the name it is told,
// ends the watch it is told to forget, and keeps every answer and DOWN it folds, in order; the writer
// ends itself with the built-in `exit`.
const READER = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {demonitor, monitor} from "@kampus/libfabrika/runtime/Monitor";
const Model = Schema.Struct({log: Schema.Array(Schema.Json)});
const Msg = Schema.Union([
 Schema.Struct({type: Schema.Literal("watch"), name: Schema.String}),
 Schema.Struct({type: Schema.Literal("forget"), ref: Schema.String}),
 Schema.Struct({type: Schema.Literal("DOWN"), ref: Schema.String, process: Schema.String, name: Schema.optionalKey(Schema.String), reason: Schema.Json})
]);
const logged = (s, entry) => ({log: [...s.log, entry]});
const machine = Machine.make({model: Model, msg: Msg, cmds: [monitor, demonitor],
 init: (loaded) => [loaded ?? {log: []}, []],
 update: {
  watch: (s, m) => [s, [monitor({name: m.name})]],
  monitor_ok: (s, m) => [logged(s, {type: "monitor_ok", ref: m.value.ref, process: m.value.process, name: m.value.name}), []],
  monitor_err: (s, m) => [logged(s, {type: "monitor_err", reason: m.error._tag}), []],
  forget: (s, m) => [s, [demonitor({ref: m.ref})]],
  demonitor_ok: (s) => [logged(s, {type: "demonitor_ok"}), []],
  demonitor_err: (s) => [logged(s, {type: "demonitor_err"}), []],
  DOWN: (s, m) => [logged(s, {type: "DOWN", ref: m.ref, process: m.process, name: m.name ?? null, reason: m.reason}), []]
 }});
export const program = Program.make({name: "m13/reader", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {watch: "Watch a registered name", forget: "End a watch", DOWN: "A process this program monitors has ended"},
 outputs: {}, writes: {}, wake: () => null});
`;

const WRITER = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {exit} from "@kampus/libfabrika/runtime/StartChild";
const Model = Schema.Struct({quit: Schema.Boolean});
const Msg = Schema.Struct({type: Schema.Literal("quit")});
const machine = Machine.make({model: Model, msg: Msg, cmds: [exit],
 init: (loaded) => [loaded ?? {quit: false}, []],
 update: {
  quit: () => [{quit: true}, [exit({})]],
  exit_ok: (s) => [s, []]
 }});
export const program = Program.make({name: "m13/writer", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {quit: "End this process"}, outputs: {}, writes: {}, wake: () => null});
`;

// The parent starts the writer as its own child and stops it, as a supervisor's terminate_child, and
// keeps each answer it folds, in order.
const PARENT = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {startChild, stopChild} from "@kampus/libfabrika/runtime/StartChild";
const Model = Schema.Struct({log: Schema.Array(Schema.Json)});
const Msg = Schema.Union([
 Schema.Struct({type: Schema.Literal("start"), program: Schema.String, name: Schema.String}),
 Schema.Struct({type: Schema.Literal("stop"), name: Schema.String})
]);
const logged = (s, entry) => ({log: [...s.log, entry]});
const why = (m) => m.reason ?? m.error ?? null;
const machine = Machine.make({model: Model, msg: Msg, cmds: [startChild, stopChild],
 init: (loaded) => [loaded ?? {log: []}, []],
 update: {
  start: (s, m) => [s, [startChild({program: m.program, name: m.name})]],
  start_child_ok: (s, m) => [logged(s, {type: "started", process: m.value.process, name: m.value.name}), []],
  start_child_err: (s, m) => [logged(s, {type: "start_refused", reason: why(m)}), []],
  stop: (s, m) => [s, [stopChild({name: m.name})]],
  stop_child_ok: (s) => [logged(s, {type: "stopped"}), []],
  stop_child_err: (s, m) => [logged(s, {type: "stop_refused", reason: why(m)}), []]
 }});
export const program = Program.make({name: "m13/parent", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {start: "Start a child", stop: "Stop a child"}, outputs: {}, writes: {}, wake: () => null});
`;

// The instance's private local capability, read call by call as worker-mail's test reads it.
type Instance = any;

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(message: string, look: () => Promise<A>, done: (value: A) => boolean): Promise<A> => {
  const end = Date.now() + WAIT;
  let last: { value: A } | { error: string } | null = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = { value };

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = { error: String(error) };
    }

    await pause();
  }

  throw new Error(`${message}: no answer in ${WAIT} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door, initialized with a signed hello. */
const wire = async (instance: Instance, key: Key, tab: string, socket: WebSocket) => {
  const frames: any[] = [];

  let closeCode: number | undefined,
    serial = 0;

  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      frames.push(JSON.parse(String(event.data)));
    }
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  socket.addEventListener("error", () => {
    closeCode ??= 1006;
  });

  const next = async (match: (frame: any) => boolean) => {
    const end = Date.now() + WAIT;

    while (Date.now() < end) {
      const index = Arr.findFirstIndex(frames, match);

      if (Option.isSome(index)) {
        return frames.splice(index.value, 1)[0];
      }

      if (closeCode !== undefined) {
        throw new Error(`closed ${closeCode}`);
      }

      await pause(20);
    }

    throw new Error(`no frame in ${WAIT} ms; last frames ${JSON.stringify(frames.slice(-3))}`);
  };

  const call = async (method: string, params: unknown) => {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

    return next((frame) => frame.id === id);
  };

  const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
  expect(
    (
      await call("initialize", {
        versions: [1],
        has: ["seal"],
        ping: "30s",
        key: key.raw,
        tab,
        nonce,
        platform: "headless",
        os: "linux",
        sentAt: SENT,
        signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
      })
    ).error,
  ).toBeUndefined();

  return { call, next };
};

type Fixture = {
  readonly start: (name: string) => Promise<string>;
  readonly connect: (tab: string) => ReturnType<typeof wire>;
};

/** One local instance on workerd in a temp home, with the reader and the writer built into it. */
const world = async (test: (instance: Instance, fixture: Fixture) => Promise<void>) => {
  noTracking();
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localInstance } = await import("./local-instance.ts");

  return Effect.runPromise(
    Effect.gen(function* () {
      const home = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "m13w-"))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );

      const key = identity();
      yield* scopedEnv({ FABRIKA_HOME: home });
      symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
      const selections: Record<string, string> = {};

      for (const [role, source] of [
        ["reader", READER],
        ["writer", WRITER],
        ["parent", PARENT],
      ] as const) {
        const path = join(home, `${role}.ts`);
        writeFileSync(path, source);
        selections[`m13/${role}`] = path;
      }

      const built = yield* build({ out: join(home, "dist"), programs: selections });

      yield* Effect.gen(function* () {
        // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
        const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);

        const instance = yield* localInstance(
          built,
          RecordWireTest.startupFixture({
            home,
            name: PROJECT,
            person: PERSON,
            founder: key.line,
            window: key.raw,
            port: at.port,
            starts: [{ source: "m13/parent", to: "m13/writer" }],
          }),
        );

        const scope = yield* Effect.scope;

        const from: From = {
          by: key.fingerprint,
          for: PERSON,
          sentAt: SENT,
          seen: 0,
          parent: null,
          traceId: TRACE,
          build: built.build,
        };

        yield* Effect.promise(() =>
          test(instance, {
            connect: (tab) =>
              Effect.runPromise(
                Effect.gen(function* () {
                  const socket = yield* Effect.acquireRelease(
                    Effect.sync(
                      () =>
                        new WebSocket(
                          `${Str.replace("http", "ws")(instance.url)}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
                        ),
                    ),
                    (socket) => Effect.sync(() => socket.close()),
                  );

                  return yield* Effect.promise(() => wire(instance, key, tab, socket));
                }).pipe(Effect.provideService(Scope.Scope, scope)),
              ),
            start: async (name) => {
              const program = `m13/${Str.split(name, ":")[0]}`;
              const code = built.programs[program];
              expect(code).toBeDefined();

              const started = await Reflect.get(instance.project(PROJECT), "start")(
                { _tag: "first", id: `start-${name}`, name, code: { program, hash: code!.hash } },
                from,
              );

              return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
            },
          }),
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(localState()),
        Effect.provide(SecureRandom.layerWebCrypto),
        Effect.provide(NodeServices.layer),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
};

/** One letter from the door's client to a process. */
const letter = (pid: string, id: string, m: unknown) => ({ pid, letter: id, m, sentAt: SENT, seen: 0 });

/** Whether a pushed view update carries a log row of this type, however the update is cut. */
const carries = (value: unknown, type: string): boolean =>
  Arr.isArray(value)
    ? Arr.some(value, (item) => carries(item, type))
    : typeof value === "object" &&
      value !== null &&
      (Reflect.get(value, "type") === type || Arr.some(Object.values(value), (item) => carries(item, type)));

/** The next view update the brain pushes for `pid` whose rows hold one of this type. It asks nothing. */
const pushed = (client: Awaited<ReturnType<typeof wire>>, pid: string, type: string) =>
  client.next(
    (frame) =>
      (frame.method === "view.patch" || frame.method === "view.whole") &&
      frame.params?.pid === pid &&
      carries(frame.params, type),
  );

// scenario: only workerd runs two Process objects whose watch crosses the Project's real RPC.
it("scenario: M13, a program in one Process object is refused a watch on a name nobody registered, monitors a program in another by name twice, ends the first watch, and when the other exits folds one DOWN, for the watch it kept", async () => {
  await world(async (_instance, fixture) => {
    const reader = await fixture.start("reader:1");
    const writer = await fixture.start("writer:1");
    const client = await fixture.connect("watch");
    const log = async () => ((await client.call("view.open", { pid: reader })).result?.view?.log ?? []) as any[];

    const send = async (pid: string, id: string, m: unknown) =>
      expect(await client.call("process.send", letter(pid, id, m))).toMatchObject({ result: { _tag: "accepted" } });

    // The refusal is reply data across the Project's RPC, and the reader folds it as the Cmd's error.
    await send(reader, "watch-0", { type: "watch", name: "absent:1" });
    const refused = await until("the reader folds its refusal", log, (rows) => rows.length > 0);
    expect(refused, "M13: a name nobody registered is refused no_name").toEqual([
      { type: "monitor_err", reason: "no_name" },
    ]);

    await send(reader, "watch-1", { type: "watch", name: "writer:1" });
    await send(reader, "watch-2", { type: "watch", name: "writer:1" });
    const answered = await until("the reader folds both monitor answers", log, (rows) => rows.length > 2);
    const watched = (ref: unknown) => ({ type: "monitor_ok", ref, process: writer, name: "writer:1" });
    expect(answered, "M13: each watch is answered monitor_ok, bound to the writer's life").toEqual([
      ...refused,
      watched(expect.stringMatching(new RegExp(`^${reader}/`))),
      watched(expect.stringMatching(new RegExp(`^${reader}/`))),
    ]);
    const [dropped, kept] = [answered[1].ref, answered[2].ref];
    expect(kept, "M13: each watch has its own ref").not.toBe(dropped);

    // The demonitor crosses the same RPC: the first watch ends before the writer does.
    await send(reader, "forget-1", { type: "forget", ref: dropped });
    const forgotten = await until("the reader folds its demonitor answer", log, (rows) => rows.length > 3);
    expect(forgotten, "M13: the demonitor is answered").toEqual([...answered, { type: "demonitor_ok" }]);

    // The writer's own step ends it with the built-in exit; the law reads only what the reader folds.
    // The exit's turn writes each live watch's DOWN in the order the watches were made, so a DOWN
    // for the dropped watch would fold before the kept one's.
    await client.call("process.send", letter(writer, "quit-1", { type: "quit" }));

    const folded = await until("the reader folds the writer's DOWN", log, (rows) =>
      Arr.some(rows, (r) => r.type === "DOWN" && r.ref === kept),
    );

    expect(
      folded,
      "M13: exactly one DOWN, for the kept ref, the writer's life, its name and normal; none for the dropped ref",
    ).toEqual([
      ...forgotten,
      { type: "DOWN", ref: kept, process: writer, name: "writer:1", reason: { _tag: "normal" } },
    ]);
  });
}, 180_000);

// scenario: only workerd has a Process object that stays asleep until something calls it or its alarm fires.
it("scenario: M16, a watcher that only waits folds the DOWN with no call into its object after the watch is set", async () => {
  await world(async (_instance, fixture) => {
    const reader = await fixture.start("reader:1");
    const writer = await fixture.start("writer:1");
    const client = await fixture.connect("asleep");
    // The one open: from here the brain pushes the reader's view, and the law only listens.
    expect((await client.call("view.open", { pid: reader })).result?.view, "M16: the reader starts empty").toEqual({
      log: [],
    });

    expect(
      await client.call("process.send", letter(reader, "watch-1", { type: "watch", name: "writer:1" })),
    ).toMatchObject({ result: { _tag: "accepted" } });
    await pushed(client, reader, "monitor_ok");

    // Nothing below calls the reader's object: the quit goes to the writer's, and the reader has no
    // timer. Polling view.open here would itself catch the reader's inbox up and hide a missing wake.
    await client.call("process.send", letter(writer, "quit-1", { type: "quit" }));
    await pushed(client, reader, "DOWN");

    expect(
      (await client.call("view.open", { pid: reader })).result?.view?.log,
      "M16: monitor_ok, then exactly one DOWN for the same ref, the writer's life, its name and normal",
    ).toEqual([
      {
        type: "monitor_ok",
        ref: expect.stringMatching(new RegExp(`^${reader}/`)),
        process: writer,
        name: "writer:1",
      },
      {
        type: "DOWN",
        ref: expect.stringMatching(new RegExp(`^${reader}/`)),
        process: writer,
        name: "writer:1",
        reason: { _tag: "normal" },
      },
    ]);
  });
}, 180_000);

// scenario: only workerd has a Process object that stays asleep until something calls it or its alarm fires.
// Plant: delete the Project's wake after a child stop (`stopChild` in
// next/packages/libfabrika/src/cloudflare/runtime.ts): no DOWN is pushed, and the wait for it fails.
it("scenario: M16, a watcher that only waits folds one DOWN with shutdown when the watched program's parent stops it, with no call into its object after the watch is set", async () => {
  await world(async (_instance, fixture) => {
    const parent = await fixture.start("parent:1");
    const reader = await fixture.start("reader:1");
    const client = await fixture.connect("stopped");

    const send = async (pid: string, id: string, m: unknown) => {
      const answer = await client.call("process.send", letter(pid, id, m));
      expect(Sent.guards.accepted(answer.result), `M16: ${id} is accepted, got ${JSON.stringify(answer)}`).toBe(true);
    };

    // The parent starts the writer as its child; reading the parent's view never calls the reader.
    await send(parent, "start-1", { type: "start", program: "m13/writer", name: "writer:2" });
    const parentLog = async () => (await client.call("view.open", { pid: parent })).result?.view?.log ?? [];
    const [started] = await until("the parent folds its child's start", parentLog, (rows) => rows.length > 0);
    expect(started, "M16: the parent started the writer as its child").toEqual({
      type: "started",
      process: expect.any(String),
      name: "writer:2",
    });
    const child = String(started.process);

    // The one open of the reader: from here the brain pushes its view, and the law only listens.
    expect((await client.call("view.open", { pid: reader })).result?.view, "M16: the reader starts empty").toEqual({
      log: [],
    });
    await send(reader, "watch-1", { type: "watch", name: "writer:2" });
    await pushed(client, reader, "monitor_ok");

    // Nothing below calls the reader's object: the stop goes to the parent's, and the reader has no
    // timer. The DOWN reaches the reader only if the Project wakes it after the stop's turn.
    await send(parent, "stop-1", { type: "stop", name: "writer:2" });
    await pushed(client, reader, "DOWN");

    const watched = { ref: expect.stringMatching(new RegExp(`^${reader}/`)), process: child, name: "writer:2" };
    expect(
      (await client.call("view.open", { pid: reader })).result?.view?.log,
      "M16: monitor_ok, then exactly one DOWN for the child's life, its name and shutdown",
    ).toEqual([
      { type: "monitor_ok", ...watched },
      { type: "DOWN", ...watched, reason: ExitReason.cases.shutdown.make({}) },
    ]);
  });
}, 180_000);

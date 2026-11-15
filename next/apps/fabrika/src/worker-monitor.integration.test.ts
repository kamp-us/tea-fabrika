// Program watch (docs/plan/lanes/watch-PLAN.md, amendment A-Workerd), next/: law M13 on real workerd,
// sockets, object storage and the private local instance capability, set up the way
// worker-mail.integration.test.ts sets up its two Process objects. A program in one Process object
// monitors a program in another by its registered name, the other exits, and the first folds
// `monitor_ok` and then one `DOWN`. Host-only: it starts a real instance, so it runs in CI's full run
// only, never on the laptop (0536, 0178).
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Effect, Schema, Scope } from "effect";
import { SecureRandom } from "effect/crypto";
import { expect, it } from "vitest";
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
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
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

// The two programs, as source the real app build bundles. The reader watches the name it is told and
// keeps every answer and DOWN it folds, in order; the writer ends itself with the built-in `exit`.
const READER = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {monitor} from "@kampus/libfabrika/runtime/Monitor";
const Model = Schema.Struct({log: Schema.Array(Schema.Json)});
const Msg = Schema.Union([
 Schema.Struct({type: Schema.Literal("watch"), name: Schema.String}),
 Schema.Struct({type: Schema.Literal("DOWN"), ref: Schema.String, process: Schema.String, name: Schema.optionalKey(Schema.String), reason: Schema.Json})
]);
const logged = (s, entry) => ({log: [...s.log, entry]});
const machine = Machine.make({model: Model, msg: Msg, cmds: [monitor],
 init: (loaded) => [loaded ?? {log: []}, []],
 update: {
  watch: (s, m) => [s, [monitor({name: m.name})]],
  monitor_ok: (s, m) => [logged(s, {type: "monitor_ok", ref: m.value.ref, process: m.value.process, name: m.value.name}), []],
  monitor_err: (s, m) => [logged(s, {type: "monitor_err", reason: m.error._tag}), []],
  DOWN: (s, m) => [logged(s, {type: "DOWN", ref: m.ref, process: m.process, name: m.name ?? null, reason: m.reason}), []]
 }});
export const program = Program.make({name: "m13/reader", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {watch: "Watch a registered name", DOWN: "A process this program monitors has ended"},
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
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
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
  return { call };
};

type Fixture = {
  readonly start: (name: string) => Promise<string>;
  readonly connect: (tab: string) => ReturnType<typeof wire>;
};

/** One local instance on workerd in a temp home, with the reader and the writer built into it. */
const world = async (test: (instance: Instance, fixture: Fixture) => Promise<void>) => {
  process.env.DO_NOT_TRACK = "1";
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
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = process.env.FABRIKA_HOME;
          process.env.FABRIKA_HOME = home;
          return previous;
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env.FABRIKA_HOME;
            } else {
              process.env.FABRIKA_HOME = previous;
            }
          }),
      );
      symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
      const selections: Record<string, string> = {};

      for (const [role, source] of [
        ["reader", READER],
        ["writer", WRITER],
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
                          `${instance.url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
                        ),
                    ),
                    (socket) => Effect.sync(() => socket.close()),
                  );
                  return yield* Effect.promise(() => wire(instance, key, tab, socket));
                }).pipe(Effect.provideService(Scope.Scope, scope)),
              ),
            start: async (name) => {
              const program = `m13/${name.split(":")[0]}`;
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

// scenario: only workerd runs two Process objects whose watch crosses the Project's real RPC.
it("scenario: M13, a program in one Process object monitors a program in another by name, the other exits, and the first folds monitor_ok then one DOWN", async () => {
  await world(async (_instance, fixture) => {
    const reader = await fixture.start("reader:1");
    const writer = await fixture.start("writer:1");
    const client = await fixture.connect("watch");
    const log = async () => ((await client.call("view.open", { pid: reader })).result?.view?.log ?? []) as any[];

    expect(
      await client.call("process.send", letter(reader, "watch-1", { type: "watch", name: "writer:1" })),
    ).toMatchObject({ result: { _tag: "accepted" } });
    const answered = await until("the reader folds its monitor answer", log, (rows) => rows.length > 0);
    expect(answered, "M13: the watch is answered monitor_ok, bound to the writer's life").toEqual([
      { type: "monitor_ok", ref: expect.stringMatching(new RegExp(`^${reader}/`)), process: writer, name: "writer:1" },
    ]);
    const ref = answered[0].ref;

    // The writer's own step ends it with the built-in exit; the law reads only what the reader folds.
    await client.call("process.send", letter(writer, "quit-1", { type: "quit" }));
    const folded = await until("the reader folds the writer's DOWN", log, (rows) =>
      rows.some((r) => r.type === "DOWN"),
    );
    expect(
      folded,
      "M13: monitor_ok, then exactly one DOWN for the same ref, the writer's life, its name and normal",
    ).toEqual([
      { type: "monitor_ok", ref, process: writer, name: "writer:1" },
      { type: "DOWN", ref, process: writer, name: "writer:1", reason: { _tag: "normal" } },
    ]);
  });
}, 180_000);

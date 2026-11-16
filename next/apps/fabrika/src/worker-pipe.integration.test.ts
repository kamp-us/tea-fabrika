// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: law H1 on real workerd, sockets, object storage
// and the private local instance capability, set up the way worker-monitor.integration.test.ts sets
// up its Process objects. A parent program pipes a writer to a reader and starts both as its
// children, each in its own Process object: the reader's program is handed the writer's whole
// value, the writer crashes once, and the reader gets one DOWN and the restarted writer's value.
// The contract it pins: the app's Project answers `programPipe` and `programPipesList`, so the pipe
// Cmd reaches the brain's `PipesLedger` across the Project's RPC, never a Process object's own
// manager.
// Host-only: it starts a real instance, so it runs in CI's full run only, never on the laptop
// (0536, 0178), and runs before the first review.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Sent } from "@kampus/libfabrika/runtime/Runner";
import { Effect, Schema, Scope } from "effect";
import { SecureRandom } from "effect/crypto";
import { expect, it } from "vitest";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-15T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PROJECT = "h1-pipe";
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

// The three programs, as source the real app build bundles. The parent pipes and starts its
// children and keeps every answer; the writer's `rows` output is its model's rows; the reader keeps
// every value and DOWN its runner hands it.
const PARENT = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {pipe} from "@kampus/libfabrika/runtime/Pipe";
import {startChild} from "@kampus/libfabrika/runtime/StartChild";
const End = {name: Schema.String, program: Schema.String};
const Model = Schema.Struct({log: Schema.Array(Schema.Json)});
const Msg = Schema.Union([
 Schema.Struct({type: Schema.Literal("pipe"), from: Schema.Struct({...End, output: Schema.String}), to: Schema.Struct({...End, input: Schema.String})}),
 Schema.Struct({type: Schema.Literal("start"), program: Schema.String, name: Schema.String})
]);
const logged = (s, entry) => ({log: [...s.log, JSON.parse(JSON.stringify(entry))]});
const machine = Machine.make({model: Model, msg: Msg, cmds: [pipe, startChild],
 init: (loaded) => [loaded ?? {log: []}, []],
 update: {
  pipe: (s, m) => [s, [pipe({from: m.from, to: m.to})]],
  pipe_ok: (s, m) => [logged(s, {type: "pipe_ok", value: m.value}), []],
  pipe_err: (s, m) => [logged(s, {type: "pipe_err", reason: m.error._tag}), []],
  start: (s, m) => [s, [startChild({program: m.program, name: m.name})]],
  start_child_ok: (s, m) => [logged(s, {type: "started", process: m.value.process, name: m.value.name}), []],
  start_child_err: (s, m) => [logged(s, {type: "start_refused", reason: m.error._tag}), []]
 }});
export const program = Program.make({name: "h1/parent", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {pipe: "Pipe two programs", start: "Start a child"}, outputs: {}, writes: {}, wake: () => null});
`;

const WRITER = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Output, Program} from "@kampus/libfabrika/runtime/Program";
const Row = Schema.Struct({id: Schema.String, title: Schema.String});
const Model = Schema.Struct({rows: Schema.NullOr(Schema.Array(Row))});
const Msg = Schema.Union([
 Schema.Struct({type: Schema.Literal("set"), rows: Schema.Array(Row)}),
 Schema.Struct({type: Schema.Literal("crash")})
]);
const machine = Machine.make({model: Model, msg: Msg, cmds: [],
 init: (loaded) => [loaded ?? {rows: null}, []],
 update: {
  set: (s, m) => [{rows: m.rows}, []],
  crash: () => { throw new TypeError("planted writer crash"); }
 }});
export const program = Program.make({name: "h1/writer", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {set: "Set the rows", crash: "Crash"}, outputs: {rows: Output.make(Schema.Array(Row), (m) => m.rows)}, writes: {}, wake: () => null});
`;

const READER = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {input, ports} from "@kampus/libfabrika/runtime/Piped";
const Row = Schema.Struct({id: Schema.String, title: Schema.String});
const Model = Schema.Struct({log: Schema.Array(Schema.Json)});
const Msg = Schema.Union([
 input("rows", Schema.Array(Row)),
 Schema.Struct({type: Schema.Literal("DOWN"), ref: Schema.String, process: Schema.String, name: Schema.optionalKey(Schema.String), reason: Schema.Json})
]);
const logged = (s, entry) => ({log: [...s.log, JSON.parse(JSON.stringify(entry))]});
const machine = Machine.make({model: Model, msg: Msg, cmds: [],
 init: (loaded) => [loaded ?? {log: []}, []],
 update: {
  rows: (s, m) => [logged(s, {type: "rows", value: m.value}), []],
  DOWN: (s, m) => [logged(s, {type: "DOWN", ref: m.ref, process: m.process, name: m.name ?? null, reason: m.reason}), []]
 }});
export const program = Program.make({name: "h1/reader", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {...ports("rows", Schema.Array(Row), "The rows to show")}, outputs: {}, writes: {}, wake: () => null});
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
  return { call, next };
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
        Effect.sync(() => mkdtempSync(join(tmpdir(), "h1p-"))),
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
        ["parent", PARENT],
      ] as const) {
        const path = join(home, `${role}.ts`);
        writeFileSync(path, source);
        selections[`h1/${role}`] = path;
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
            starts: [
              { source: "h1/parent", to: "h1/writer" },
              { source: "h1/parent", to: "h1/reader" },
            ],
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
              const program = `h1/${name.split(":")[0]}`;
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

// scenario: only workerd runs the writer and the reader in two Process objects, with the pipe's Cmd
// crossing the Project's real RPC to the brain.
// Plant, run once after the build, at review: route `programPipe` to the object's own manager: no
// piped row, H1 red.
it("H1 scenario: a parent pipes a writer to a reader and starts both in their own Process objects; the reader is handed the whole value, and after one crash one DOWN and the restarted writer's value", async () => {
  await world(async (_instance, fixture) => {
    const parent = await fixture.start("parent:1");
    const client = await fixture.connect("pipe");
    const send = async (pid: string, id: string, m: unknown) => {
      const answer = await client.call("process.send", letter(pid, id, m));
      expect(Sent.guards.accepted(answer.result), `H1: ${id} is accepted, got ${JSON.stringify(answer)}`).toBe(true);
    };
    const view = async (pid: string) => ((await client.call("view.open", { pid })).result?.view?.log ?? []) as any[];

    await send(parent, "pipe-1", {
      type: "pipe",
      from: { name: "writer:1", program: "h1/writer", output: "rows" },
      to: { name: "reader:1", program: "h1/reader", input: "rows" },
    });
    const [piped] = await until(
      "the parent folds the pipe's answer",
      () => view(parent),
      (rows) => rows.length > 0,
    );
    expect(piped, "H1: the brain made the pipe").toMatchObject({ type: "pipe_ok", value: { _tag: "piped" } });
    const pipeId = String(piped.value.pipe);

    await send(parent, "start-reader", { type: "start", program: "h1/reader", name: "reader:1" });
    await send(parent, "start-writer", { type: "start", program: "h1/writer", name: "writer:1" });
    const starts = await until(
      "the parent folds both starts",
      () => view(parent),
      (rows) => rows.length > 2,
    );
    const startedProcess = (name: string) =>
      String(starts.find((r) => r.type === "started" && r.name === name)?.process);
    const reader = startedProcess("reader:1");
    const writer = startedProcess("writer:1");

    const rows = Array.from({ length: 40 }, (_, n) => ({ id: `row-${n}`, title: "x".repeat(120) }));
    await send(writer, "set-1", { type: "set", rows });
    const handed = await until(
      "the reader is handed the rows",
      () => view(reader),
      (log) => log.some((r) => r.type === "rows"),
    );
    expect(handed, "H1: the reader's program is handed the whole value, once").toEqual([{ type: "rows", value: rows }]);

    await client.call("process.send", letter(writer, "crash-1", { type: "crash" }));
    const after = await until(
      "the reader gets the DOWN and the restarted writer's value",
      () => view(reader),
      (log) => log.filter((r) => r.type === "rows").length > 1,
    );
    expect(
      after.filter((r) => r.type === "DOWN"),
      "H1: one DOWN for the life that crashed",
    ).toEqual([
      {
        type: "DOWN",
        ref: `${pipeId}/${writer}`,
        process: writer,
        name: "writer:1",
        reason: expect.objectContaining({ _tag: "crashed" }),
      },
    ]);
    expect(after.at(-1), "H1: the restarted writer's first value arrives whole").toEqual({ type: "rows", value: rows });
  });
}, 240_000);

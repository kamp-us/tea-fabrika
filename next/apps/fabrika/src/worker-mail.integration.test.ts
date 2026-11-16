// P41 slice 2, next/. Real workerd, sockets, object storage,
// alarms and the private local instance capability, set up the way P12's instance-records test is.
// No directly constructed runner and no raw Miniflare stands in for the instance.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Array as Arr, String as Str } from "effect";
import { SecureRandom } from "effect/crypto";
import * as Effect from "effect/Effect";
import * as Formatter from "effect/Formatter";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { rolldown } from "rolldown";
import { expect, it } from "vitest";
import { noTracking, scopedEnv } from "./env.test-support.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const SENT = "2026-11-09T04:00:00.000Z";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const PROJECT = "p41-workers";

// Bounded waits tied to observable facts. Backoff is 100 to 800 ms, so this is generous.
const WAIT = 25_000;

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    n = Buffer.alloc(4);

  n.writeUInt32BE(body.length);

  return Buffer.concat([n, body]);
};

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

// The fixtures use the same Send/ref exchange as slice 1. Source is bundled by the real app build.
const source = (role: "requester" | "responder", pair: number, braked = false) => `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {send} from "@kampus/libfabrika/runtime/Send";
const Model = Schema.Struct({phase: Schema.Literals(["idle", "waiting", "answered", "failed"]), ref: Schema.String, value: Schema.Int, count: Schema.Int, reason: Schema.String});
const Msg = Schema.Union([
 Schema.Struct({type: Schema.Literal("start"), ref: Schema.String, value: Schema.Int}),
 Schema.Struct({type: Schema.Literal("request"), ref: Schema.String, value: Schema.Int, reply: Schema.String}),
 Schema.Struct({type: Schema.Literal("answer"), ref: Schema.String, value: Schema.Int}),
 Schema.Struct({type: Schema.Literal("crash")})
]);
const machine = Machine.make({model: Model, msg: Msg, cmds: [send],
 init: (loaded) => [loaded ?? {phase: "idle", ref: "", value: 0, count: 0, reason: ""}, []],
 update: {
  start: (s,m) => [{...s, phase: "waiting", ref: m.ref}, [send({to: "responder:${pair}", m: {type: "request", ref: m.ref, value: m.value, reply: "requester:${pair}"}})]],
  request: (s,m) => [{...s, count: s.count+1}, [send({to: m.reply, m: {type: "answer", ref: m.ref, value: m.value+1}})]],
  answer: (s,m) => s.phase === "waiting" && s.ref === m.ref ? [{...s, phase: "answered", value: m.value}, []] : [s, []],
  send_ok: (s) => [s, []],
  send_err: (s,m) => s.phase === "waiting" ? [{...s, phase: "failed", reason: m.error._tag}, []] : [s, []],
  crash: () => { throw new TypeError("fixture crash"); }
 }});
export const program = Program.make({name: "p41/${role}-${pair}", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 ${braked ? "policy: {maxDeliveries: 3, intensity: 5, periodMs: 120_000, backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5_000}}," : ""}
 inputs: ${role === "requester" ? '{start: "Ask", answer: "Answer"}' : '{request: "Request", crash: "Crash"}'},
 outputs: {}, writes: {}, wake: () => null});
`;

type Instance = any;

// Private control only. Reading these rows must not load the runner or deliver mail.
const instrumentMailBrain = async (brain: string, home: string) => {
  const entry = join(home, "mail-diagnostics.mjs");
  writeFileSync(
    entry,
    `
import * as Brain from ${JSON.stringify(brain)};
export default Brain.default;
export const Connection = Brain.Connection;
export const IsolateTail = Brain.IsolateTail;
export const Project = Brain.Project;
export const RecordPart = Brain.RecordPart;
export class Process extends Brain.Process {
  async testState() {
    const at = Date.now();
    const tables = Array.from(this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
    const rows = table => tables.includes(table) ? Array.from(this.ctx.storage.sql.exec('SELECT * FROM "'+table+'" ORDER BY rowid')) : null;
    const snapshot = {
      name: this.ctx.id.name, at, tables,
      wake: await this.ctx.storage.get("wake") ?? null,
      armed: await this.ctx.storage.getAlarm(),
      activity: await this.ctx.storage.get("activity") ?? null,
      checkpoint: rows("process_state"), recovery: rows("process_recovery"),
      receipts: rows("process_receipts"), letters: rows("process_letters"),
      unsent: rows("unsent"), parts: rows("parts")
    };
    return {...snapshot, end: Date.now()};
  }
}
export class Control extends Brain.Control {
  async fetch(request) {
    if (request.headers.get("authorization") !== "Bearer "+this.ctx.props.token) return super.fetch(request);
    const q = await request.clone().json();
    if (q.target !== "process" || q.method !== "testState") return super.fetch(request);
    try {
      const name = await this.env.PROJECT.getByName(q.project).processObject(q.name);
      const stub = this.env.PROCESS.getByName(JSON.stringify([q.project, name]));
      return Response.json({value: await stub.testState()});
    } catch { return Response.json({error:{reason:"unreachable"}}, {status:500}); }
  }
}`,
  );
  await Effect.runPromise(
    Effect.acquireRelease(
      Effect.promise(() => rolldown({ input: entry, platform: "browser", external: ["cloudflare:workers"] })),
      (bundle) => Effect.promise(() => bundle.close()),
    ).pipe(
      Effect.flatMap((bundle) => Effect.promise(() => bundle.generate({ format: "esm", codeSplitting: false }))),
      Effect.tap((out) =>
        Effect.sync(() =>
          writeFileSync(
            brain,
            Arr.join(
              Arr.map(
                Arr.filter(out.output, (item) => item.type === "chunk"),
                (item) => item.code,
              ),
              "\n",
            ),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );
};

const mailDiagnostics = () => {
  const frames: Array<{ at: number; elapsed: number; raw: string }> = [];
  const events: Array<{ at: number; elapsed: number; event: string; value: unknown }> = [];
  const stamp = () => ({ at: Date.now(), elapsed: performance.now() });
  const note = (event: string, value: unknown = null) => events.push({ ...stamp(), event, value });
  note("start");

  const read = async (label: string, call: () => Promise<unknown>) => {
    const start = stamp();
    let value: unknown = null;

    try {
      value = await call();
      console.error("T880 observation", JSON.stringify({ label, start, end: stamp(), value }, null, 2));
    } catch (error) {
      console.error(
        "T880 observation",
        JSON.stringify({ label, start, end: stamp(), error: error instanceof Error ? error.name : "unknown" }),
      );
    }

    return value;
  };

  return {
    note,
    frame: (raw: string) => frames.push({ ...stamp(), raw }),
    capture: async (instance: Instance, requester: string, responder: string) => {
      const frozen = frames.slice();
      note("failure", { requester, responder });
      console.error("T880 diagnostics", JSON.stringify({ version: "next", frozen, events }, null, 2));

      for (const name of ["requester:1", "responder:1"]) {
        for (const stream of [`${name}/inbox`, `${name}/outbox`, `processes/${name}`]) {
          await read(stream, () => instance.project(PROJECT).read(stream, 0, "audit"));
        }
      }

      for (const pid of [requester, responder]) {
        await read(`state/${pid}`, () => instance.process(pid).testState());
      }

      for (const pid of [requester, responder]) {
        await read(`runtime/${pid}`, () => instance.project(PROJECT).read(pid, 0, "audit"));
        let part = 0;
        let after = 0;

        for (;;) {
          const page = await read(`spans/${pid}/${part}/${after}`, () =>
            instance.record(PROJECT, `job/${pid}/${part}`).read({ _tag: "job", process: pid }, part, after),
          );

          const decoded = Schema.decodeUnknownSync(
            Schema.NullOr(
              Schema.Struct({ after: Schema.Int, rolled: Schema.Boolean, spans: Schema.Array(Schema.Json) }),
            ),
          )(page);

          if (decoded === null) {
            break;
          }

          if (decoded.spans.length > 0) {
            after = decoded.after;
          } else if (decoded.rolled) {
            part++;
            after = 0;
          } else {
            break;
          }
        }
      }
    },
  };
};

type Fixture = {
  readonly from: From;
  readonly hash: string;
  readonly start: (name: string) => Promise<string>;
  readonly connect: (tab: string) => ReturnType<typeof wire>;
  readonly diagnostics?: ReturnType<typeof mailDiagnostics> | undefined;
};

const world = async (
  test: (instance: Instance, key: Key, fixture: Fixture) => Promise<void>,
  granted = true,
  braked = false,
  diagnose = false,
) => {
  noTracking();
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localInstance } = await import("./local-instance.ts");

  return Effect.runPromise(
    Effect.gen(function* () {
      const home = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "p41w-"))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );

      const key = identity();
      yield* scopedEnv({ FABRIKA_HOME: home });
      symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
      const selections: Record<string, string> = {};

      for (const pair of [1, 2]) {
        for (const role of ["requester", "responder"] as const) {
          const name = `${role}-${pair}`;
          const path = join(home, `${name}.ts`);
          writeFileSync(path, source(role, pair, braked && role === "responder" && pair === 1));
          selections[`p41/${name}`] = path;
        }
      }

      const built = yield* build({ out: join(home, "dist"), programs: selections });
      let diagnostics: ReturnType<typeof mailDiagnostics> | undefined;

      if (diagnose) {
        diagnostics = mailDiagnostics();
        yield* Effect.promise(() => instrumentMailBrain(built.brain, home));
      }

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
            mail: {
              grants: granted
                ? {
                    "requester:1": ["responder:1"],
                    "responder:1": ["requester:1"],
                    "requester:2": ["responder:2"],
                    "responder:2": ["requester:2"],
                  }
                : {},
            },
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
          test(instance, key, {
            from,
            hash: built.build,
            diagnostics,
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

                  return yield* Effect.promise(() => wire(instance, key, tab, socket, diagnostics));
                }).pipe(Effect.provideService(Scope.Scope, scope)),
              ),
            start: async (name) => {
              const program = `p41/${Str.replace(":", "-")(name)}`;
              const code = built.programs[program];
              expect(code).toBeDefined();

              const started = await Reflect.get(instance.project(PROJECT), "start")(
                {
                  _tag: "first",
                  id: `start-${name}`,
                  name,
                  code: { program, hash: code!.hash },
                },
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

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(
  message: string,
  look: () => Promise<A>,
  done: (value: A) => boolean,
  ms = WAIT,
): Promise<A> => {
  const end = Date.now() + ms;
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

  throw new Error(`${message}: no answer in ${ms} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door, initialized with a signed hello. */
const wire = async (
  instance: Instance,
  key: Key,
  tab: string,
  socket: WebSocket,
  diagnostics?: ReturnType<typeof mailDiagnostics>,
) => {
  const frames: any[] = [];
  let initialized = false;

  let closeCode: number | undefined,
    serial = 0;

  socket.addEventListener("message", (event) => {
    if (diagnostics !== undefined) {
      const raw = String(event.data);
      // Only incoming frames are recorded. The handshake's public key and nonce stay out too.
      diagnostics.frame(
        initialized || raw === "pong"
          ? raw
          : JSON.stringify(Schema.decodeSync(Schema.fromJsonString(Schema.Json))(raw), (name, value) =>
              ["key", "nonce", "signed", "token"].includes(name) ? "[redacted]" : value,
            ),
      );
    }

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
    diagnostics?.note("wait.start", { end });

    while (Date.now() < end) {
      const index = Arr.findFirstIndex(frames, match);

      if (Option.isSome(index)) {
        diagnostics?.note("consumed", { id: frames[index.value].id, method: frames[index.value].method });
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
  initialized = true;

  return { call, next };
};

const facts = async (instance: Instance, stream: string) =>
  Arr.map((await instance.project(PROJECT).read(stream, 0, "audit")) as Array<any>, (row) => ({
    ...row.body,
    _tag: row._tag,
    rev: row.rev,
  }));

const request = (pid: string, ref: string) => ({
  pid,
  letter: `start-${ref}`,
  m: { type: "start", ref, value: 7 },
  sentAt: SENT,
  seen: 0,
});

const answer = async (instance: Instance, name = "requester:1", ref = "exchange") =>
  until(
    "answer letter",
    () => facts(instance, `${name}/inbox`),
    (rows) => Arr.some(rows, (r) => r.m?.type === "answer" && r.m.ref === ref),
  );

// Read the view notifications; polling view.open would itself drain the requester's inbox.
const changed = async (client: Awaited<ReturnType<typeof wire>>, phase: string) =>
  client.next(
    (frame) =>
      frame.method === "view.patch" && frame.params.patch.some((p: any) => p.path === "/phase" && p.value === phase),
  );

// scenario: only workerd runs these two Process objects, real RPC and platform alarms.
it("scenario: W1 and W6, the door receives waiting then answered 8 and both objects release their alarms", async () => {
  await world(async (instance, _key, fixture) => {
    const requester = await fixture.start("requester:1");
    const responder = await fixture.start("responder:1");
    const client = await fixture.connect("exchange");
    await client.call("view.open", { pid: requester });
    expect(await client.call("process.send", request(requester, "exchange"))).toMatchObject({
      result: { _tag: "accepted" },
    });
    await changed(client, "waiting");
    const patch = await changed(client, "answered");
    expect(patch.params.patch).toEqual(expect.arrayContaining([{ op: "replace", path: "/value", value: 8 }]));
    await until(
      "idle alarms",
      async () => [await instance.process(requester).savedAlarm(), await instance.process(responder).savedAlarm()],
      (alarms) => Arr.every(alarms, (at) => at == null),
    );
  });
}, 180_000);

// scenario: abort is workerd's real eviction. Either alarm/abort order must keep exactly one exchange.
it("scenario: W2, aborting the target after its wake preserves one request and one answer", async () => {
  await world(
    async (instance, _key, fixture) => {
      const requester = await fixture.start("requester:1");
      const responder = await fixture.start("responder:1");
      const client = await fixture.connect("evict-target");

      try {
        await client.call("view.open", { pid: requester });
        fixture.diagnostics?.note("send.start", { requester, responder });
        expect(await client.call("process.send", request(requester, "eviction"))).toMatchObject({
          result: { _tag: "accepted" },
        });
        fixture.diagnostics?.note("accepted");

        // The accepted Send has awaited the target's mailed RPC. No target call precedes the abort.
        if (fixture.diagnostics === undefined) {
          await instance
            .process(responder)
            .abort()
            .catch(() => undefined);
        } else {
          fixture.diagnostics.note("abort.start");
          await instance
            .process(responder)
            .abort()
            .then((value: unknown) => {
              fixture.diagnostics?.note("abort.result", { status: "fulfilled", value: value ?? null });
            })
            .catch((error: unknown) => {
              fixture.diagnostics?.note("abort.result", {
                status: "rejected",
                error: error instanceof Error ? error.name : "unknown",
              });
            });
          fixture.diagnostics.note("abort.end");
        }

        await changed(client, "answered");
        await answer(instance, "requester:1", "eviction");
        expect(Arr.filter(await facts(instance, "requester:1/outbox"), (r) => r.ref === "eviction")).toHaveLength(1);
        const inbox = await facts(instance, "responder:1/inbox");
        expect(Arr.filter(inbox, (r) => r.m?.type === "request" && r.m.ref === "eviction")).toHaveLength(1);
        const answers = await facts(instance, "requester:1/inbox");
        expect(Arr.filter(answers, (r) => r.m?.type === "answer" && r.m.ref === "eviction")).toHaveLength(1);
        await until(
          "the requester has drained its answer",
          () => instance.process(requester).savedAlarm(),
          (at) => at == null,
        );
        expect(await client.call("view.open", { pid: requester })).toMatchObject({
          result: { view: { phase: "answered", ref: "eviction", value: 8 } },
        });
        fixture.diagnostics?.note("complete");
      } catch (error) {
        if (fixture.diagnostics !== undefined) {
          await fixture.diagnostics.capture(instance, requester, responder).catch(() => {
            console.error("T880 diagnostic capture failed; rethrowing the original W2 failure");
          });
        }

        throw error;
      }
    },
    true,
    false,
    true,
  );
}, 180_000);

// scenario: the host's instance composition supplies grants to the actual Project object.
it("scenario: W4, no host grant refuses the requester and leaves the target inbox empty", async () => {
  await world(async (instance, _key, fixture) => {
    const requester = await fixture.start("requester:1");
    await fixture.start("responder:1");
    const client = await fixture.connect("no-grant");
    await client.call("process.send", request(requester, "denied"));
    expect(await client.call("view.open", { pid: requester })).toMatchObject({
      result: { view: { phase: "failed", reason: "forbidden" } },
    });
    expect(await facts(instance, "responder:1/inbox")).toEqual([]);
  }, false);
}, 180_000);

// scenario: only real object recovery establishes the Worker's restart brake and its saved wait.
it("scenario: W5, mail respects a target's brake while another pair completes", async () => {
  await world(
    async (instance, _key, fixture) => {
      const requester = await fixture.start("requester:1");
      let responder = await fixture.start("responder:1");
      const other = await fixture.start("requester:2");
      await fixture.start("responder:2");
      const client = await fixture.connect("brake");
      let down: any;

      for (let n = 0; n < 20 && down === undefined; n++) {
        await client.call("process.send", {
          pid: responder,
          letter: `crash-${n}`,
          m: { type: "crash" },
          sentAt: SENT,
          seen: 0,
        });

        const rows = await until(
          "restart or brake",
          () => facts(instance, "processes/responder:1"),
          (rows) =>
            Arr.some(rows, (r) => r._tag === "down") ||
            Arr.some(rows, (r) => r._tag === "restarted" && r.after === responder),
        );
        down = Option.getOrUndefined(Arr.findFirst(rows, (r) => r._tag === "down"));

        if (down === undefined) {
          responder = Option.getOrUndefined(
            Arr.findFirst(rows, (r) => r._tag === "restarted" && r.after === responder),
          ).process;
        }
      }

      expect(down, "the real restart brake must be reached").toBeDefined();
      await client.call("process.send", request(requester, "braked"));
      await client.call("view.open", { pid: other });
      await client.call("process.send", request(other, "healthy"));
      await changed(client, "answered");
      const healthy = Arr.filter(
        await answer(instance, "requester:2", "healthy"),
        (r) => r.m?.type === "answer" && r.m.ref === "healthy",
      );

      expect(healthy).toHaveLength(1);
      expect(healthy[0].m.value).toBe(8);
      expect(down.rev).toBeLessThan(healthy[0].rev);
      expect(Arr.filter(await facts(instance, "responder:1/inbox"), (r) => r.m?.ref === "braked")).toHaveLength(1);
      expect(Arr.filter(await facts(instance, "requester:1/inbox"), (r) => r.m?.type === "answer")).toEqual([]);
      expect(await client.call("view.open", { pid: requester })).toMatchObject({
        result: { view: { phase: "waiting", ref: "braked" } },
      });
      expect(await instance.process(responder).savedAlarm()).toBe(down.until);
      const lifecycle = await facts(instance, "processes/responder:1");
      expect(
        Arr.filter(lifecycle, (r) => r._tag === "restarted" && r.rev > down.rev && r.rev < healthy[0].rev),
      ).toEqual([]);
      expect(Arr.filter(lifecycle, (r) => r._tag === "restarted" && r.rev > down.rev)).toEqual([]);
    },
    true,
    true,
  );
}, 180_000);

// Private H1 setup stays separate so the existing mail scenarios keep their build and start inputs.
const checklistWorld = async (
  test: (fixture: {
    readonly start: (name: string, program?: string) => Promise<string>;
    readonly connect: () => ReturnType<typeof wire>;
  }) => Promise<void>,
) => {
  const { FileSystem } = await import("effect");
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localInstance } = await import("./local-instance.ts");
  await Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "alarm866-" });
      yield* scopedEnv({ FABRIKA_HOME: home });
      yield* fs.symlink(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
      const wrapper = join(home, "checklist.ts");
      yield* fs.writeFileString(
        wrapper,
        `export { checklist as program } from ${Formatter.formatJson(resolve(import.meta.dirname, "../../../programs/checklist/src/program.ts"))};\n`,
      );
      const built = yield* build({ out: join(home, "dist"), programs: { "fabrika/checklist": wrapper } });
      const key = identity();
      const held = yield* Effect.acquireRelease(heldPort(), (port) => port.release);

      const instance = yield* localInstance(
        built,
        RecordWireTest.startupFixture({
          home,
          name: PROJECT,
          person: PERSON,
          founder: key.line,
          window: key.raw,
          port: held.port,
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
        test({
          start: async (name, program = "fabrika/checklist") => {
            const code = built.programs[program];
            expect(code).toBeDefined();

            const started = await Reflect.get(instance.project(PROJECT), "start")(
              {
                _tag: "first",
                id: `start-${name}`,
                name,
                code: { program, hash: code!.hash },
              },
              from,
            );

            return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
          },
          connect: () =>
            Effect.runPromise(
              Effect.gen(function* () {
                const tab = "immediate-wake";

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
        }),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(localState()),
      Effect.provide(SecureRandom.layerWebCrypto),
      Effect.provide(NodeServices.layer),
    ),
  );
};

// scenario: H1 checks actual workerd alarm acceptance through the signed client path.
it("scenario: H1, two checklist adds with an immediate wake both land on the same fresh process", async () => {
  await checklistWorld(async (fixture) => {
    const pid = await fixture.start("checklist:866", "fabrika/checklist");
    const client = await fixture.connect();
    expect(
      await client.call("process.send", {
        pid,
        letter: "add-first",
        m: { type: "add", name: "first item" },
        sentAt: SENT,
        seen: 0,
      }),
    ).toMatchObject({ result: { _tag: "accepted" } });
    expect(
      await client.call("process.send", {
        pid,
        letter: "add-second",
        m: { type: "add", name: "second item" },
        sentAt: SENT,
        seen: 0,
      }),
    ).toMatchObject({ result: { _tag: "accepted" } });
    expect(await client.call("view.open", { pid })).toMatchObject({
      result: { view: { items: [{ name: "first item" }, { name: "second item" }], left: 2 } },
    });
  });
}, 180_000);

// --- T1041 L14: a repo file's `mail.unread` reaches the Project's cap --------------------------
//
// Written before the build (docs/plan/quests/t1041-PLAN.md). The repo's file says `mail.unread = 2`;
// the settings load reads it, the start hands its snapshot to the instance, and the Project's
// program mail answers the third unread letter `full`. Nothing reads while the writer sends: the
// reader crashes on a `crash` letter, and its own supervisor holds the successor for the policy's
// backoff, as the runtime does after any crash inside its restart budget. Once the backoff ends the
// runtime starts the successor, which reads and acks, and a resend of the third letter lands. No
// call from outside ends or starts the reader: the Project sets up a name's object only on a first
// start, the trusted restart needs a live process, and the runner moves to a new life only when
// its own supervisor waits for one.
const BACKOFF = 8_000;

const capSource = (role: "writer" | "reader") =>
  role === "writer"
    ? `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
import {send} from "@kampus/libfabrika/runtime/Send";
const Answer = Schema.Struct({n: Schema.Int, answer: Schema.String});
const Model = Schema.Struct({answers: Schema.Array(Answer)});
const Msg = Schema.Struct({type: Schema.Literal("letter"), n: Schema.Int});
const nOf = (cmd) => cmd.m.n;
const machine = Machine.make({model: Model, msg: Msg, cmds: [send],
 init: (loaded) => [loaded ?? {answers: []}, []],
 update: {
  letter: (s, m) => [s, [send({to: "reader:1", m: {type: "letter", n: m.n}})]],
  send_ok: (s, m) => [{answers: [...s.answers, {n: nOf(m.cmd), answer: "queued"}]}, []],
  send_err: (s, m) => [{answers: [...s.answers, {n: nOf(m.cmd), answer: m.error._tag}]}, []]
 }});
export const program = Program.make({name: "t1041/writer", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 inputs: {letter: "Send a letter"}, outputs: {}, writes: {}, wake: () => null});
`
    : `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program} from "@kampus/libfabrika/runtime/Program";
const Model = Schema.Struct({read: Schema.Array(Schema.Int)});
const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("letter"), n: Schema.Int}), Schema.Struct({type: Schema.Literal("crash")})]);
const machine = Machine.make({model: Model, msg: Msg, cmds: [],
 init: (loaded) => [loaded ?? {read: []}, []],
 update: { letter: (s, m) => [{read: [...s.read, m.n]}, []], crash: () => { throw new TypeError("fixture crash"); } }});
export const program = Program.make({name: "t1041/reader", machine, state: {v: 1, upgrades: []}, view: (s) => s, refuse: () => null,
 policy: {maxDeliveries: 2, intensity: 5, periodMs: 120_000, backoff: {minMs: ${BACKOFF}, maxMs: ${BACKOFF}, resetAfterMs: 120_000}},
 inputs: {letter: "A letter", crash: "Crash"}, outputs: {}, writes: {}, wake: () => null});
`;

it("scenario: T1041 L14, a repo file's mail.unread = 2 makes the third unread letter between two real programs answer full, and once the reader reads a resend lands", async () => {
  noTracking();
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localInstance } = await import("./local-instance.ts");
  const Declarations = await import("@kampus/libfabrika/settings/Declarations");
  const Snapshot = await import("@kampus/libfabrika/settings/Snapshot");
  const Sources = await import("@kampus/libfabrika/settings/Sources");
  const { Digest } = await import("effect/crypto");
  await Effect.runPromise(
    Effect.gen(function* () {
      const home = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "t1041-"))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );

      yield* scopedEnv({ FABRIKA_HOME: home });
      symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
      const selections: Record<string, string> = {};

      for (const role of ["writer", "reader"] as const) {
        const path = join(home, `${role}.ts`);
        writeFileSync(path, capSource(role));
        selections[`t1041/${role}`] = path;
      }

      const built = yield* build({ out: join(home, "dist"), programs: selections });
      const key = identity();
      const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);

      // The repo's own file, `[mail] unread = 2`, as its parse gives it (only the settings module
      // and start code read TOML, lint L15), resolved in the common source order and saved as the
      // start's snapshot.
      const resolved = yield* Sources.resolve(Declarations.all, {
        flags: Sources.flags({
          "instance.port": String(at.port),
          "gateway.limit": "100000",
          "gateway.window": "60000",
        }),
        env: Sources.env({}),
        repo: Sources.file(".fabrika/fabrika.toml", {
          value: { mail: { unread: 2 } },
          spans: [{ path: ["mail", "unread"], line: 2 }],
        }),
        person: Sources.file("~/.fabrika/fabrika.toml", { value: {}, spans: [] }),
      });

      const loaded = {
        snapshot: yield* Snapshot.make(Declarations.all, resolved).pipe(Effect.provide(Digest.layerWebCrypto)),
      };

      expect(resolved.values.mailUnread, "the repo file's value is read").toBe(2);

      const instance = yield* localInstance(built, {
        ...RecordWireTest.startupFixture({
          home,
          name: PROJECT,
          person: PERSON,
          founder: key.line,
          window: key.raw,
          port: at.port,
          mail: { grants: { "writer:1": ["reader:1"] } },
        }),
        settings: loaded.snapshot,
      });

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

      yield* Effect.promise(async () => {
        const project = instance.project(PROJECT);

        const start = async (request: object) =>
          Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(
            await Reflect.get(project, "start")(request, from),
          ).process;

        const code = (role: string) => ({ program: `t1041/${role}`, hash: built.programs[`t1041/${role}`]!.hash });

        const writer = await start({
          _tag: "first",
          id: "start-writer",
          name: "writer:1",
          code: code("writer"),
        });

        const reader = await start({
          _tag: "first",
          id: "start-reader",
          name: "reader:1",
          code: code("reader"),
        });

        const client = await Effect.runPromise(
          Effect.gen(function* () {
            const socket = yield* Effect.acquireRelease(
              Effect.sync(
                () =>
                  new WebSocket(
                    `${Str.replace("http", "ws")(instance.url)}/client/${encodeURIComponent(key.fingerprint)}/cap`,
                  ),
              ),
              (socket) => Effect.sync(() => socket.close()),
            );

            return yield* Effect.promise(() => wire(instance, key, "cap", socket));
          }).pipe(Effect.provideService(Scope.Scope, scope)),
        );

        let sent = 0;

        // One send at a time: the writer's newest answer is this letter's.
        const send = async (n: number) => {
          sent += 1;
          expect(
            await client.call("process.send", {
              pid: writer,
              letter: `letter-${sent}`,
              m: { type: "letter", n },
              sentAt: SENT,
              seen: 0,
            }),
          ).toMatchObject({ result: { _tag: "accepted" } });

          const view = await until(
            `the writer's answer for send ${sent}`,
            async () => (await client.call("view.open", { pid: writer })).result?.view,
            (v) => v?.answers?.length === sent,
          );

          return view.answers.at(-1).answer;
        };

        const lifecycle = () => facts(instance, "processes/reader:1");

        const letters = async () =>
          Arr.map(
            Arr.filter(await facts(instance, "reader:1/inbox"), (r) => r.m?.type === "letter"),
            (r) => r.m.n,
          );
        const last = async (stream: string) =>
          Math.max(
            0,
            ...Arr.map(
              (await (instance as Instance).project(PROJECT).read(stream, 0, "audit")) as Array<any>,
              (row) => row.body.pos ?? row.pos,
            ),
          );

        // The reader crashes inside the door's call, and its supervisor holds the successor for
        // BACKOFF ms: nothing reads while the writer sends.
        expect(
          (
            await client.call("process.send", {
              pid: reader,
              letter: "crash",
              m: { type: "crash" },
              sentAt: SENT,
              seen: 0,
            })
          ).result,
          "the crash is not accepted",
        ).toBeUndefined();
        await until("the reader's crash", lifecycle, (rows) =>
          Arr.some(rows, (r) => r._tag === "exited" && r.process === reader),
        );
        expect(await send(1), "the first letter is saved").toBe("queued");
        expect(await send(2), "the second letter is saved").toBe("queued");
        expect(await send(3), "L14: the repo file's cap of 2 unread answers the third letter full").toBe("full");
        expect(
          Arr.filter(await lifecycle(), (r) => r._tag === "restarted"),
          "the reader had not started again, so the full answer is the cap's and no read had happened",
        ).toEqual([]);
        expect(await letters(), "L14: the full letter was not saved").toEqual([1, 2]);
        // The runtime starts the successor itself once the backoff ends; it reads both letters and acks.
        await until(
          "the reader's successor",
          lifecycle,
          (rows) => Arr.some(rows, (r) => r._tag === "restarted" && r.after === reader),
          BACKOFF * 3,
        );
        const end = await last("reader:1/inbox");
        await until(
          "the successor's ack of the whole inbox",
          () => last("processes/reader:1/acked"),
          (acked) => acked >= end,
        );
        expect(await send(3), "L14: once the reader read, a resend of the third letter lands").toBe("queued");
        expect(await letters(), "the resend is saved").toEqual([1, 2, 3]);
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(localState()),
      Effect.provide(SecureRandom.layerWebCrypto),
      Effect.provide(NodeServices.layer),
    ),
  );
}, 180_000);

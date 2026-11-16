// edge: node:sqlite is the in-memory store the real gateway runs on here; nothing else touches Node.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import * as ClientManagerLedger from "@kampus/libfabrika/access/ClientManagerLedger";
import { grantText } from "@kampus/libfabrika/access/Text";
import {
  crashed,
  cutJournal,
  expectedResults,
  fakeCommands,
  seen,
  type Seen,
} from "@kampus/libfabrika/client/Commands.test-support";
import { start } from "@kampus/libfabrika/client/HandsStart";
import * as JournalStore from "@kampus/libfabrika/client/JournalStore";
import { MemorySocket } from "@kampus/libfabrika/client/WindowStart.test-support";
import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { Doorbell } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import * as LedgerStreamsSql from "@kampus/libfabrika/ledger/LedgerStreamsSql";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { Waited } from "@kampus/libfabrika/ledger/Log";
import { Referee } from "@kampus/libfabrika/ledger/Referee";
import * as RefereeSql from "@kampus/libfabrika/ledger/RefereeSql";
import { MailWakeups } from "@kampus/libfabrika/runtime/MailWakeups";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Command, type Result } from "@kampus/libfabrika/tasks/Task";
import { Tasks } from "@kampus/libfabrika/tasks/Tasks";
import * as TasksLedger from "@kampus/libfabrika/tasks/TasksLedger";
import { fcTypeId } from "@kampus/libfabrika/tasks/TasksTest";
import { Archive } from "@kampus/libfabrika/telemetry/Archive";
import { RecordManager } from "@kampus/libfabrika/telemetry/Records";
import { SpanSink } from "@kampus/libfabrika/telemetry/Sink";
import { ClientKey, ClientKeyError } from "@kampus/libfabrika/transport/ClientKey";
import { connection } from "@kampus/libfabrika/transport/Connection";
import { KeyLine, writeSshsig } from "@kampus/libfabrika/transport/Sshsig";
import { Answer, Attached } from "@kampus/libfabrika/transport/Wire";
// P39 slice 4a, next/: E1 and S1, the hands client end to end in one process. The real hands start
// (`client/HandsStart.ts`) dials over the in-memory socket the window laws use
// (`client/WindowStart.test-support.ts`) into the real transport driver (`transport/Connection.ts`)
// and the real `Gateway` and `Tasks` on node:sqlite at `:memory:`. Its journal is the real
// `JournalStore.layer` on a string store this file keeps across restarts, and its `Commands` is the
// fake, the only one in 4a. No port, no real socket, no process and no container: it runs on the
// merge line (0536).
//
// The door's glue here is the test's own, as `cloudflare/connection.ts` is the Worker's: each socket
// gets a connection id and a challenge from the gateway, `initialize` saves the online attachment,
// every other call goes to `Gateway.route` naming this one object as the reader its rings reach,
// and each ring the ledger asks for this object is handed to every connection's `ring`; a ring for
// any other name reaches nobody, as on the Worker. A parked wait on a `target:` stream is asked again as the hands' own
// `tasks.wait`, since a hands key may not call `ledger.wait`.
//
// E1: a requested task ends finished with the fake's result, or `unknown interrupted` where a crash
// fell between the command and its saved result, and its command ran at most once, through socket
// drops, lost answers and client restarts at points the walk picks from what is happening. Plant
// (after build): leave `tasks.list` answering an empty list.
// S1 [secrets]: the hands key's private bytes, in every encoding a leak could take, never appear in
// a frame the client writes, a journal value, a ledger row or a span. Plant (after build): put the
// private key's armored text in the hello's `build`.
import { Effect, Exit, Layer, Queue, Schema, Scope, Semaphore, Tracer } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { KeyValueStore, RateLimiter } from "effect/persistence";
import { Socket } from "effect/socket";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { type ConnectionId, Gateway } from "./door.ts";

const SEED = 119120;

const ORIGIN = "http://127.0.0.1:18787";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const SENT = "2026-11-15T10:00:00.000Z";

/** The one connection object every socket of the door lives on, and the name its rings reach. */
const READER = "hands-e1";

const text = (s: string) => new TextEncoder().encode(s);

const field = (bytes: Uint8Array) => {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);

  return out;
};

const join = (...parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;

  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }

  return out;
};

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// A shared test's failures are tagged like product code's, never thrown.
class CryptoFailed extends Schema.TaggedError<CryptoFailed>()("CryptoFailed", { cause: Schema.Defect() }) {}

/** fast-check's report, with its counterexample, as the law's typed failure. */
class PropertyFailed extends Schema.TaggedError<PropertyFailed>()("PropertyFailed", { cause: Schema.Defect() }) {}

/** PKCS#8's fixed prefix for an Ed25519 seed (RFC 8410): a generated seed becomes a WebCrypto key. */
const PKCS8 = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

/** A key pair from a generated seed, with its public forms and every encoding of its private half. */
const keyFrom = Effect.fnUntraced(function* (seed: Uint8Array) {
  const s = crypto.subtle;
  const pkcs8 = join(PKCS8, seed);
  const fail = (cause: unknown) => new CryptoFailed({ cause });

  const signer = yield* Effect.tryPromise({
    try: () => s.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]),
    catch: fail,
  });

  const jwk = yield* Effect.tryPromise({ try: () => s.exportKey("jwk", signer), catch: fail });
  const raw = yield* Effect.fromResult(Base64Url.decode(jwk.x ?? "")).pipe(Effect.mapError(fail));
  // The public half only: WebCrypto exports the private half to no one here but the sentinels below.
  const blob = join(field(text("ssh-ed25519")), field(raw));

  const fingerprint = Effect.fnUntraced(function* (bytes: Uint8Array) {
    const hash = yield* Effect.tryPromise({ try: () => s.digest("SHA-256", new Uint8Array(bytes)), catch: fail });

    return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
  });

  const sign = (bytes: Uint8Array) =>
    Effect.tryPromise({ try: () => s.sign("Ed25519", signer, new Uint8Array(bytes)), catch: fail }).pipe(
      Effect.map((b) => new Uint8Array(b)),
    );

  return {
    raw: Base64Url.encode(raw),
    line: Schema.decodeSync(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`),
    fingerprint: yield* fingerprint(raw),
    sshFingerprint: yield* fingerprint(blob),
    sign,
    /** Every form the private half could leak in: the seed and PKCS#8 bytes as base64, base64url and
     *  hex. An armored key's body is the PKCS#8 base64, one 64-column line for Ed25519, so it is here too. */
    secrets: [seed, pkcs8].flatMap((b) => [Base64.encode(b), Base64Url.encode(b), hex(b)]),
  };
});

type Key = Effect.Success<ReturnType<typeof keyFrom>>;

/** One flow: the keys' seeds, the processes that ask, and the cells the walk reads. */
const Flow = fc.record({
  root: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  hands: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  processes: fc.uniqueArray(fcTypeId("process"), { minLength: 2, maxLength: 4 }),
  cells: fc.array(fc.record({ move: fc.nat(), ms: fc.integer({ min: 0, max: 20_000 }) }), {
    minLength: 10,
    maxLength: 40,
    size: "max",
  }),
});

type Flow = typeof Flow extends fc.Arbitrary<infer A> ? A : never;

/** The brain: the real gateway and tasks on one in-memory database, its rings queued for the door. */
const brain = Effect.fnUntraced(function* (root: Key, hands: Key) {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (held) => Effect.sync(() => held.isOpen && held.close()),
  );

  const sql = nodeSql(db);
  const rings = yield* Queue.unbounded<{ readonly to: string; readonly stream: string; readonly rev: number }>();

  const bell = Layer.succeed(Doorbell, {
    ring: (to: string, stream: string, rev: number) =>
      Effect.sync(() => void Queue.offerUnsafe(rings, { to, stream, rev })),
  });

  // The referee the Worker's Project gives the gateway as its `wait`, so a parked wait is rung at
  // the reader the call names, as on the Worker (runtime.ts), never at this object by default.
  const referee = yield* Referee.pipe(Effect.provide(RefereeSql.layer(sql).pipe(Layer.provide(bell))));

  const data = Layer.mergeAll(
    LedgerSql.layer(sql, { reader: "hands-e1" }),
    LedgerTransactionSql.layer(sql),
    LedgerStreamsSql.layer(sql),
  ).pipe(Layer.provide(bell));

  const turn = yield* Semaphore.make(1);

  const founder = {
    name: "hands-e1",
    person: PERSON,
    keys: [root.line],
    window: null,
    by: root.sshFingerprint,
    build: "brain-build",
  };

  const services = Layer.mergeAll(
    data,
    TasksLedger.layer.pipe(Layer.provide(data), Layer.provide(Id.Generator.layer)),
    ClientManagerLedger.layer(founder).pipe(Layer.provide(data)),
    SpanSink.layer(sql, { object: "hands-e1" }),
    RecordManager.memory(4 * 1024 * 1024),
    Archive.memory,
    Id.Generator.layer,
    RateLimiter.layer.pipe(
      Layer.provide(RateLimiterSql.layer(sql, { build: "brain-build", policy: { limit: 100_000, window: 60_000 } })),
    ),
    Layer.succeed(MailWakeups, { wake: () => Effect.void }),
  );

  const gateway = Gateway.layer({
    sql,
    founder,
    name: "hands-e1",
    url: ORIGIN,
    origins: [ORIGIN],
    versions: [1],
    location: "test",
    build: "brain-build",
    waiting: { most: 64, ttl: 600_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 1_000_000,
    spentCap: 100_000,
    rateLimit: { limit: 100_000, window: 60_000 },
    turn,
    write: (work) => work.pipe(turn.withPermit),
    nextProcess: () => Effect.succeed("process_01m6v5270hetdrt4r8h9vvjwjs"),
    open: () => Effect.succeed(null),
    deliver: () => Effect.void,
    notify: () => Effect.void,
    wait: referee.wait,
    inputs: { schema: Schema.Json, personOnly: [], raw: [] },
    events: { personOnly: [] },
  }).pipe(Layer.provideMerge(services), Layer.orDie);

  const life = yield* Layer.build(gateway);
  const d = yield* Gateway.pipe(Effect.provide(life));

  const value = grantText({
    id: "grant-hands",
    key: hands.raw,
    for: PERSON,
    to: "hands-e1",
    as: "hands",
    sentAt: SENT,
    saw: { label: "hands", location: "test", code: "1234", method: "command", check: "touch", has: ["git"] },
  });

  const armored = yield* writeSshsig({ text: value, space: "fabrika-client", line: root.line, sign: root.sign });
  expect((yield* d.grant({ text: value, armored }))._tag, "the founder grants the hands key").toBe("applied");

  return {
    sql,
    d,
    rings,
    tasks: <A, E>(f: (j: Tasks["Service"]) => Effect.Effect<A, E>) => Tasks.use(f).pipe(Effect.provide(life)),
  };
});

/** The door: one gateway connection and one transport driver per socket the client opens. */
const door = Effect.fnUntraced(function* (b: Effect.Success<ReturnType<typeof brain>>) {
  const work = yield* Queue.unbounded<Effect.Effect<void>>();
  const drivers = new Set<ReturnType<typeof connection>>();
  const sockets: Array<MemorySocket> = [];
  const lose = { next: 0 };
  /** Each ring the referee sent, by the name it was sent to: only `READER` reaches a socket. */
  const rung: Array<{ readonly to: string; readonly stream: string }> = [];
  // One fiber runs the door's work in order: each socket's setup, each frame, each ring.
  yield* Effect.forkScoped(Effect.forever(Queue.take(work).pipe(Effect.flatten, Effect.ignore)));
  yield* Effect.forkScoped(
    Effect.forever(
      Queue.take(b.rings).pipe(
        // A ring reaches only the object its `to` names, as `CONNECTION.getByName(to)` does on the
        // Worker: every socket here lives on the one object named `READER`.
        Effect.flatMap(({ to, stream, rev }) => {
          rung.push({ to, stream });

          return to === READER
            ? Effect.forEach([...drivers], (c) => Effect.ignore(c.ring(stream, rev)), { discard: true, concurrency: 1 })
            : Effect.void;
        }),
      ),
    ),
  );

  const make = (url: string): MemorySocket => {
    // The client dials `<origin>/client/<fingerprint>/<tab>`, as the Worker's door reads it.
    const [name = "", tab = ""] = (new URL(url).pathname.split("/client/")[1] ?? "").split("/").map(decodeURIComponent);
    // The gateway's own connection id, once its `connect` has made one; nothing reaches the gateway before.
    const client: { id: ConnectionId | null } = { id: null };

    const connected = Effect.suspend(() =>
      client.id === null ? Effect.fail(Answer.cases.refused.make({ reason: "no_session" })) : Effect.succeed(client.id),
    );

    const made: MemorySocket = new MemorySocket(url, {
      send: (frame) => Queue.offerUnsafe(work, Effect.ignore(Effect.suspend(() => c.frame(frame)))),
      closed: () => Queue.offerUnsafe(work, Effect.ignore(Effect.flatMap(connected, (id) => b.d.disconnect(id)))),
    });

    sockets.push(made);
    let attached: typeof Attached.Type = Attached.cases.new.make({ client: "", nonce: "" });

    const c = connection({
      reader: READER,
      session: url,
      ping: () => 30_000,
      read: () => attached,
      save: (a) => {
        attached = a;
      },
      send: (body) => {
        if (lose.next > 0 && body.startsWith("{") && body.includes('"id"')) {
          lose.next--;

          return;
        }

        made.receive(body);
      },
      close: (code) => made.drop(code),
      wait: (stream, after, reader) =>
        Effect.gen(function* () {
          const id = yield* connected;

          const answer = stream.startsWith("target:")
            ? yield* b.d.route(id, "tasks.wait", { after }, reader)
            : yield* b.d.route(id, "ledger.wait", { stream, after }, reader);

          if (answer._tag === "parked") {
            return Waited.cases.parked.make({});
          }

          if (answer._tag === "ok") {
            const { rev } = yield* Schema.decodeUnknownEffect(Schema.Struct({ rev: Schema.Int }))(answer.result);

            return Waited.cases.ready.make({ rev });
          }

          return yield* Effect.fail(answer);
        }),
      call: (method, params) =>
        method === "initialize"
          ? Effect.flatMap(connected, (id) =>
              Effect.map(b.d.initialize(id, params, { url: ORIGIN, tab, name }), (checked) => ({ id, checked })),
            ).pipe(
              Effect.map(({ id, checked }) => {
                if (checked._tag === "refused") {
                  return checked;
                }

                attached = Attached.cases.online.make({
                  client: id,
                  identity: checked.identity,
                  version: checked.version,
                  waits: [],
                  watching: false,
                  busy: false,
                  has: checked.hello.has,
                  ...(checked.hello.build === undefined ? {} : { build: checked.hello.build }),
                });

                return Answer.cases.ok.make({
                  result: { identity: checked.identity, version: checked.version, ping: checked.ping },
                });
              }),
              Effect.catchCause(() => Effect.succeed(Answer.cases.refused.make({ reason: "unreachable" }))),
            )
          : Effect.flatMap(connected, (id) => b.d.route(id, method, params, READER)).pipe(
              Effect.catchCause(() => Effect.succeed(Answer.cases.refused.make({ reason: "unreachable" }))),
            ),
    });

    made.open();
    Queue.offerUnsafe(
      work,
      Effect.gen(function* () {
        const id = yield* b.d.connect();
        client.id = id;
        const nonce = yield* b.d.challenge(id);
        attached = Attached.cases.new.make({ client: id, nonce });
        drivers.add(c);
        made.receive(JSON.stringify({ jsonrpc: "2.0", method: "challenge", params: { nonce } }));
      }).pipe(Effect.ignore),
    );

    return made;
  };

  return {
    socket: Layer.succeed(Socket.WebSocketConstructor, make),
    sockets,
    lose,
    rung,
    /** The door closes the socket open now, as a network or a restart of the brain would. */
    drop: () => sockets.at(-1)?.drop(1006),
  };
});

/** A string store the journal writes through, kept across restarts, whose every value a law can read. */
const strings = () => {
  const values = new Map<string, string>();

  const store = KeyValueStore.makeStringOnly({
    get: (key) => Effect.sync(() => values.get(key)),
    set: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
    clear: Effect.sync(() => values.clear()),
    size: Effect.sync(() => values.size),
    keys: Effect.sync(() => [...values.keys()]),
  });

  return { values, layer: Layer.succeed(KeyValueStore.KeyValueStore, store) };
};

/** Lets the run go on: virtual time moves `ms`, and real work (WebCrypto, the door's queue) gets its turn. */
const pass = (ms: number) =>
  TestClock.adjust(ms).pipe(
    Effect.andThen(TestClock.withLive(Effect.sleep("2 millis"))),
    Effect.andThen(Effect.yieldNow),
  );

const flow = (f: Flow, focus: "E1" | "S1", done: Set<string>) =>
  Effect.gen(function* () {
    const root = yield* keyFrom(f.root);
    const hands = yield* keyFrom(f.hands);
    const b = yield* brain(root, hands);
    const d = yield* door(b);
    const s: Seen = seen();
    const kept = strings();
    // Every span the client makes, kept as the tracer under it makes it.
    const spans: Array<Tracer.Span> = [];
    const delegate = yield* Effect.tracer;

    const tracer = Tracer.make({
      span: (init) => {
        const span = delegate.span(init);
        spans.push(span);

        return span;
      },
    });

    const keys = Layer.succeed(ClientKey, {
      current: () =>
        Effect.succeed({
          fingerprint: hands.fingerprint,
          raw: hands.raw,
          line: hands.line,
          found: "reused" as const,
          sign: (bytes: Uint8Array) =>
            hands.sign(bytes).pipe(Effect.mapError(() => new ClientKeyError({ op: "sign", error: "OperationError" }))),
        }),
      claimPersist: Effect.succeed(false),
      persist: Effect.succeed(true),
    });

    const layers = Layer.mergeAll(
      d.socket,
      keys,
      fakeCommands(s),
      cutJournal(s).pipe(Layer.provide(JournalStore.layer), Layer.provide(kept.layer)),
      Id.Generator.layer,
    );

    const boot = Effect.gen(function* () {
      const scope = yield* Scope.make();

      const booting = yield* start({ origin: ORIGIN, build: "hands-build", label: "hands" }).pipe(
        Effect.provide(layers),
        Effect.withTracer(tracer),
        Scope.provide(scope),
      );

      yield* booting.ready;

      return scope;
    });

    let scope = yield* boot;
    const requested: Array<string> = [];
    let n = 0;

    for (const cell of f.cells) {
      yield* pass(0);

      // A new task is asked for a process only when that process has no open task (0093): two open
      // tasks of one process wedge `tasks.take` (finding 2026-11-15-jobs-take-ambiguous-wedges).
      const tasks = yield* Effect.forEach(requested, (id) => b.tasks((j) => j.read(id)).pipe(Effect.orDie), {
        concurrency: 1,
      });

      const busy = new Set(
        tasks.flatMap((task) =>
          task.state._tag === "absent" || task.state._tag === "finished" || task.state._tag === "collected"
            ? []
            : [task.state.request.process],
        ),
      );

      const free = f.processes.filter((p) => !busy.has(p));
      const moves = [...(free.length > 0 ? ["request"] : []), "run", "run", "drop", "lose", "restart"];
      const move = moves[cell.move % moves.length] ?? "run";
      done.add(move);

      if (move === "request") {
        const process = free[cell.ms % free.length] ?? "process_01m6v5270hetdrt4r8h9vvjwjs";
        const id = `${process}/${++n}/0`;
        yield* b.tasks((j) =>
          j.request(
            {
              id,
              process,
              name: `counter:${n}`,
              program: "fabrika/counter",
              command: Command.cases.git_version.make({}),
              needs: ["git"],
              target: hands.fingerprint,
              build: "brain-build",
              settings: null,
              parent: null,
              traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            },
            {
              by: "brain",
              for: PERSON,
              sentAt: SENT,
              seen: 0,
              parent: null,
              traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
              build: "brain-build",
            },
          ),
        );
        requested.push(id);
      } else if (move === "run") {
        yield* pass(cell.ms);
      } else if (move === "drop") {
        d.drop();
      } else if (move === "lose") {
        d.lose.next++;
      } else {
        yield* Scope.close(scope, Exit.void);
        crashed(s);
        scope = yield* boot;
      }
    }

    // Quiet now: nothing lost, nothing dropped, until every task the brain was asked for is finished.
    d.lose.next = 0;

    const finished = () =>
      Effect.forEach(requested, (id) => b.tasks((j) => j.read(id)).pipe(Effect.orDie), { concurrency: 1 }).pipe(
        Effect.map((tasks) => tasks.every((task) => task.state._tag === "finished")),
      );

    for (let i = 0; i < 300 && !(yield* finished()); i++) {
      yield* pass(i % 10 === 9 ? 30_000 : 1_000);
    }

    const { runs, results } = expectedResults(s.events);

    for (const id of focus === "E1" ? requested : []) {
      const task = yield* b.tasks((j) => j.read(id)).pipe(Effect.orDie);
      expect(task.state._tag, `E1: ${id} ends finished`).toBe("finished");
      const result: Result | null = task.state._tag === "finished" ? task.state.result : null;
      expect(result, `E1: ${id} ends with the result its journal held`).toEqual(results.get(id));
      expect(runs.get(id) ?? 0, `E1: ${id}'s command ran at most once`).toBeLessThanOrEqual(1);
      done.add(result?._tag === "unknown" ? "ended:unknown" : "ended:result");
    }

    // E1: every parked wait was rung at the object its socket lives on. A wait that names another
    // reader is never answered on the Worker, so the hands would sleep through new work.
    expect(
      d.rung.filter((r) => r.to !== READER),
      "E1: every ring names the object the sockets live on",
    ).toEqual([]);

    if (d.rung.some((r) => r.stream.startsWith("target:"))) {
      done.add("ring:target");
    }

    // S1: every output a leak could reach, read whole, and every encoding of the private key.
    done.add(requested.length > 0 && (yield* finished()) ? "finished" : "unfinished");
    // The secrets law reads every stored row, as A12 does.
    const tables = b.sql.exec("SELECT name FROM sqlite_master WHERE type='table'").map((row) => String(row.name));

    const outputs: Record<string, unknown> = {
      frames: d.sockets.map((socket) => socket.sent),
      journal: [...kept.values.entries()],
      ledger: tables.map((table) => b.sql.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`)),
      spans: spans.map((span) => ({ name: span.name, attributes: [...span.attributes] })),
    };

    for (const [name, value] of focus === "S1" ? Object.entries(outputs) : []) {
      const encoded = JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? String(item) : item));

      for (const secret of hands.secrets) {
        for (const form of [secret, encodeURIComponent(secret), Base64.encode(text(secret))]) {
          expect(encoded.includes(form), `S1: the hands key's private half is not in ${name}`).toBe(false);
        }
      }
    }

    expect(
      d.sockets.some((socket) => socket.sent.length > 0),
      "S1 read frames the client really wrote",
    ).toBe(true);
    yield* Scope.close(scope, Exit.void);
  });

const law = (name: string, focus: "E1" | "S1", required: ReadonlyArray<string>, runs: number) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<string>();
        const context = yield* Effect.context();

        // Each flow still gets its own fresh test clock.
        const check = (f: Flow) =>
          Effect.runPromiseWith(context)(flow(f, focus, done).pipe(Effect.scoped, Effect.provide(TestClock.layer())));

        yield* Effect.tryPromise({
          try: () =>
            fc.assert(fc.asyncProperty(Flow, check), { seed: SEED, numRuns: runs, includeErrorInReport: true }),
          catch: (cause) => new PropertyFailed({ cause }),
        });
        // An empty flow cannot pass: every move the law is about ran at least once.
        expect([...done]).toEqual(expect.arrayContaining([...required]));
      }),
    600_000,
  );

describe("P39 slice 4a: the hands client end to end", () => {
  law(
    "E1: a requested task ends finished with the fake's result through the real client start, the in-memory socket, the real Gateway and Tasks on :memory:, with sockets dropped and answers lost; execute runs once; every parked wait is rung at the object its socket lives on",
    "E1",
    ["request", "drop", "lose", "restart", "ended:result", "ring:target"],
    60,
  );
  law(
    "S1 [secrets]: the hands key's private bytes never appear in a frame the client writes, a journal entry, a ledger row or a span",
    "S1",
    ["request", "drop", "lose", "restart", "finished"],
    60,
  );
});

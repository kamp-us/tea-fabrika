// T714, next/. A4 and A6-A12 walk the real authenticated gateway and durable Tasks.
// The Node runner supplies its layers and scoped SQL; this module imports no driver or ledger.
// A4 and A6-A12 plant trials, including A-Kept's reconnect metadata, are in the tests-step report.
// Temporary edits are restored after each trial. A14 runs on the lead's host.
// P39 slice 3 (ticket 1040), W1: an accepted or repeated `tasks.finish` wakes the requester's name
// after the shared write turn and before it answers; a failed wake answers `refused unavailable`
// and leaves the task finished, so the same finish sent again repeats and wakes again. The suite
// supplies the gateway's `MailWakeups` itself and records every wake. Plants (after build): wake
// only on the first finish, or wake inside the write turn.
// W2, on W1's walk: every wake a taken finish causes carries the trace of that same call's
// `gateway.tasks` span, its `spanId` that span's parent, and a first finish's wake the `traceId` the
// `finished` event saved; no two calls' wakes share a trace. W2b: each tasks call that reaches the tasks branch has one
// `gateway.route` span holding `fab.gateway.outcome` with the answer's tag, and a rate-refused tasks
// call has only `refuseRate`'s. Plants: today's code (no span around the branch: W2 red), a span
// around the wake only (W2 red), and after build, the outcome annotation dropped (W2b red).
//
// P39 slice 4a, G1 (the list half) and G2. `tasks.list {}` answers a hands key exactly the open
// tasks whose target is its own key, as pointers `{ id, process }`, and the `target:<key>` stream's
// last rev; `tasks.wait { after }` answers `{ rev }` when that stream is past `after` and else parks
// on that stream, which the first request for that key, and only that key, whose line lands past
// `after` rings once, at that line's rev. A window or agent
// key is refused `not_allowed`, and params with any other field are `bad_input`. The driver keeps
// every ring its ledger's doorbell was asked for, in `Store.rings`. Plants (after build): leave `tasks.list`
// answering every open task of every key (G1), and take the stream name from the params (G2).
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import {
  Arbitrary,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Redacted,
  Result as R,
  Schema,
  type Scope,
  Semaphore,
  Tracer,
} from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { grantText, revokeText } from "../access/Text.ts";
import * as Id from "../Id.ts";
import { MailWakeups, MailWakeupsError } from "../runtime/MailWakeups.ts";
import type { News } from "../runtime/News.ts";
import type { Sql } from "../Sql.ts";
import { Task, State, type Request, Request as RequestSchema, Result as TaskResult } from "../tasks/Task.ts";
import { Tasks, targetStream } from "../tasks/Tasks.ts";
import { Chain, REFUSED } from "../telemetry/Trace.ts";
import { connection } from "../transport/Connection.ts";
import { Answer, Attached } from "../transport/Wire.ts";
import { Gateway, type ConnectionId } from "./Gateway.ts";

/** The gateway over one real store. It needs the `MailWakeups` the suite gives it, which records each
 *  wake. `rings` is every ring the store's ledger asked its doorbell for, in order (G2). */
export type Store = {
  readonly sql: Sql;
  readonly reopen: Effect.Effect<void>;
  readonly gateway: (
    options: Parameters<typeof Gateway.layer<Schema.Json, never, never, never>>[0],
  ) => Layer.Layer<Gateway | Tasks, never, MailWakeups>;
  readonly rings: ReadonlyArray<{ readonly to: string; readonly stream: string; readonly rev: number }>;
};

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const URL = "https://fabrika.test/tasks";

const SENT = "2026-11-12T10:00:00.000Z";

const pick = <A>(values: ReadonlyArray<A>, n: number): A =>
  values[n % values.length] ?? expect.fail("a state-derived choice requires a candidate");

const text = (s: string) => new TextEncoder().encode(s);

const join = (...parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;

  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }

  return out;
};

const u32 = (n: number) => {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n);

  return a;
};

const field = (a: string | Uint8Array) => {
  const bytes = typeof a === "string" ? text(a) : a;

  return join(u32(bytes.length), bytes);
};

// A shared suite is not a `*.test.ts` file, so its failures are tagged like product code's.
class CryptoFailed extends Schema.TaggedError<CryptoFailed, { readonly brand: unique symbol }>()("CryptoFailed", {
  cause: Schema.Defect(),
}) {}

const fail = (cause: unknown) => new CryptoFailed({ cause });

const key = Effect.fnUntraced(function* () {
  const s = crypto.subtle;
  const ed = "Ed25519";
  const sign: KeyUsage[] = ["sign"];
  const uses = ["sign", "verify"] as const;
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto generates test keys
  const pair = yield* Effect.tryPromise({ try: () => s.generateKey(ed, true, uses), catch: fail });
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports the generated public key
  const raw = yield* Effect.tryPromise({ try: () => s.exportKey("raw", pair.publicKey), catch: fail });
  const bytes = new Uint8Array(raw);
  // WebCrypto exports only these generated test keys, never a key from a file or account.
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports a generated test key into Redacted
  const exported = yield* Effect.tryPromise({ try: () => s.exportKey("pkcs8", pair.privateKey), catch: fail });
  const stored = Redacted.make(Base64.encode(new Uint8Array(exported)));
  const blob = join(field("ssh-ed25519"), field(bytes));

  const fingerprint = Effect.fnUntraced(function* (value: Uint8Array) {
    const bytes = new Uint8Array(value);
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes a generated public key
    const hash = yield* Effect.tryPromise({ try: () => s.digest("SHA-256", bytes), catch: fail });

    return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
  });

  return {
    stored,
    raw: Base64Url.encode(bytes),
    line: `ssh-ed25519 ${Base64.encode(blob)}`,
    fingerprint: yield* fingerprint(bytes),
    sshFingerprint: yield* fingerprint(blob),
    sign: Effect.fnUntraced(function* (value: string) {
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes the signed test message
      const digest = yield* Effect.tryPromise({ try: () => s.digest("SHA-512", text(value)), catch: fail });
      const hash = new Uint8Array(digest);
      const body = join(text("SSHSIG"), field("fabrika-client"), field(""), field("sha512"), field(hash));
      // oxlint-disable-next-line fabrika/no-redacted-value -- edge: the generated key-store value goes only to WebCrypto
      const bytes = new Uint8Array(R.getOrThrow(Base64.decode(Redacted.value(stored))));
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto imports the generated signing key
      const signer = yield* Effect.tryPromise({ try: () => s.importKey("pkcs8", bytes, ed, false, sign), catch: fail });
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs the test message
      const signature = yield* Effect.tryPromise({ try: () => s.sign(ed, signer, body), catch: fail });
      const signed = new Uint8Array(signature);

      const packed = join(
        text("SSHSIG"),
        u32(1),
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(join(field("ssh-ed25519"), field(signed))),
      );

      return `-----BEGIN SSH SIGNATURE-----\n${Base64.encode(packed)
        .match(/.{1,70}/g)
        ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    }),
  };
});

type Key = Effect.Success<ReturnType<typeof key>>;

type Client = {
  readonly client: ConnectionId;
  readonly key: Key;
  readonly has: ReadonlyArray<string>;
  readonly build: string | undefined;
  readonly role: "hands" | "window" | "agent";
  live: boolean;
};

type Cell = {
  readonly move: number;
  readonly pick: number;
  readonly variant: number;
  readonly has: ReadonlyArray<string>;
  readonly build: string;
  readonly sentAt: string;
  readonly seen: number;
  readonly result: TaskResult;
};

const Cell = Schema.Struct({
  move: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  pick: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  variant: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  has: Schema.Array(Schema.Literals(["git", "node", "docker"])),
  build: Schema.NonEmptyString,
  sentAt: Schema.String,
  seen: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  result: TaskResult,
});

const Tape = Schema.Struct({
  request: Schema.Struct({ ...RequestSchema.fields, process: Id.Process }),
  cells: Schema.Array(Cell).check(Schema.isMinLength(60), Schema.isMaxLength(100)),
  secret: Schema.String.check(Schema.isPattern(/^[a-z]{12,24}$/)),
});

type Tape = typeof Tape.Type;

const last = <A>(values: ReadonlyArray<A>): A => values.at(-1) ?? expect.fail("an accepted transition has an event");

const TakeReply = Schema.TaggedUnion({ idle: {}, refused: { reason: Schema.String } });

type Saved = { request: Request; task: Task; starts?: unknown; finish?: unknown };

const phase = (s: Saved) => s.task.state._tag;

const assignment = (s: Saved) => {
  const state = s.task.state;

  if (state._tag === "absent" || state._tag === "requested") {
    return expect.fail("a saved assignment is required");
  }

  return state.assignment;
};

const accepted = (answer: typeof Answer.Type) => {
  if (answer._tag !== "ok") {
    return expect.fail(`task call refused: ${JSON.stringify(answer)}`);
  }

  return answer.result;
};

const refused = (answer: typeof Answer.Type) => {
  expect(answer._tag).toBe("refused");
};

const taskReply = (answer: typeof Answer.Type) => Schema.decodeUnknownSync(Task)(accepted(answer));

const world = Effect.fnUntraced(function* (open: Effect.Effect<Store, never, Scope.Scope>) {
  const store = yield* open;
  const root = yield* key();
  const backup = yield* key();
  const stranger = yield* key();
  const keys = yield* Effect.forEach([0, 1, 2, 3], () => key(), { concurrency: 1 });
  const turn = yield* Semaphore.make(1);

  const logs: Array<unknown> = [],
    spans: Array<Tracer.Span> = [],
    attachments: Array<unknown> = [];

  const logger = Logger.layer([
    Logger.map(Logger.formatStructured, (entry) => {
      logs.push(entry);
    }),
  ]);

  const urls: Array<string> = [URL];

  const notices: Array<{ client: string; news: News }> = [],
    delivered: Array<unknown> = [],
    opened: Array<unknown> = [],
    frames: Array<string> = [];

  const controls: { pause: null | { entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> } } = {
    pause: null,
  };

  /**
   * W1: every wake the gateway asked for, the name it named, and whether the shared turn was free then.
   * W2: the span current when it asked, which the real layer sends on as the requester's parent.
   */
  const wakes: Array<{
    readonly name: string;
    readonly free: boolean;
    readonly trace: { readonly traceId: string; readonly spanId: string } | undefined;
  }> = [];

  /** W2b: every routed call, its answer and the spans it opened at the door. */
  const calls: Array<{
    readonly method: string;
    readonly answer: typeof Answer.Type;
    readonly spans: ReadonlyArray<Tracer.Span>;
  }> = [];

  const wakeFault = { fail: false };

  const wakeups = Layer.succeed(MailWakeups, {
    wake: (name: string) =>
      Effect.gen(function* () {
        // A wake inside the write turn would hold every other task call behind the recipient's alarm.
        const free = Option.isSome(yield* turn.withPermitsIfAvailable(1)(Effect.void));
        const span = yield* Effect.option(Effect.currentSpan);
        const trace = Option.isSome(span) ? { traceId: span.value.traceId, spanId: span.value.spanId } : undefined;
        wakes.push({ name, free, trace });

        if (wakeFault.fail) {
          wakeFault.fail = false;

          return yield* new MailWakeupsError({ reason: "unavailable" });
        }
      }),
  });

  const gatewayFor = () => store.gateway(options).pipe(Layer.provide(wakeups));

  const options: Parameters<typeof Gateway.layer<Schema.Json, never, never, never>>[0] = {
    sql: store.sql,
    founder: {
      name: "tasks-law",
      person: PERSON,
      keys: [root.line, backup.line],
      window: null,
      by: root.sshFingerprint,
      build: "gateway-build",
    },
    name: "tasks-law",
    url: URL,
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "test",
    build: "gateway-build",
    waiting: { most: 64, ttl: 600_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 1_000_000,
    spentCap: 100_000,
    rateLimit: { limit: 100_000, window: 60_000 },
    turn,
    write: (work) =>
      Effect.gen(function* () {
        const pause = controls.pause;

        if (pause !== null) {
          controls.pause = null;
          yield* Deferred.succeed(pause.entered, undefined);
          yield* Deferred.await(pause.release);
        }

        return yield* work.pipe(turn.withPermit);
      }),
    nextProcess: () => Effect.succeed("process_01m6v5270hetdrt4r8h9vvjwjs"),
    open: (process, client) =>
      Effect.sync(() => {
        opened.push({ process, client });

        return null;
      }),
    deliver: (_p, envelope) =>
      Effect.sync(() => {
        delivered.push(envelope);
      }),
    notify: (client, news) =>
      Effect.sync(() => {
        notices.push({ client, news });
      }),
    inputs: { schema: Schema.Json, personOnly: [], raw: [] },
    events: { personOnly: [] },
  };

  let life = yield* Layer.build(gatewayFor());
  const delegate = yield* Effect.tracer.pipe(Effect.provide(life));

  const tracer = Tracer.make({
    span: (init) => {
      const span = delegate.span(init);
      spans.push(span);

      return span;
    },
  });

  const trace = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(Effect.withTracer(tracer), Effect.provide(logger));
  const door = () => Gateway.pipe(Effect.provide(life));
  let d = yield* door();
  const j = <A, E>(f: (tasks: Tasks["Service"]) => Effect.Effect<A, E>) => Tasks.use(f).pipe(Effect.provide(life));
  const clients: Array<Client> = [];

  const grant = Effect.fnUntraced(function* (k: Key, role: Client["role"], id: string) {
    const value = grantText({
      id,
      key: k.raw,
      for: PERSON,
      to: "tasks-law",
      as: role,
      sentAt: SENT,
      saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: [] },
    });

    expect((yield* d.grant({ text: value, armored: yield* root.sign(value) }))._tag).toBe("applied");
  });

  const hello = Effect.fnUntraced(function* (
    k: Key,
    role: Client["role"],
    has: ReadonlyArray<string>,
    build: string | undefined,
  ) {
    const client = yield* d.connect();
    const nonce = yield* d.challenge(client);
    const tab = String(client);
    urls.push(`${URL}/client/${encodeURIComponent(k.fingerprint)}/${encodeURIComponent(tab)}`);

    const checked = yield* d.initialize(
      client,
      {
        versions: [1],
        has,
        ...(build === undefined ? {} : { build }),
        ping: "30s",
        key: k.raw,
        tab,
        nonce,
        platform: "headless",
        os: "linux",
        sentAt: SENT,
        signed: yield* k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
      },
      { url: URL, tab, name: k.fingerprint },
    );

    expect(checked._tag).toBe("online");
    const c: Client = { client, key: k, role, has, build, live: true };
    clients.push(c);

    return c;
  });

  const revoke = Effect.fnUntraced(function* (c: Client, id: string, ancestor = false) {
    const value = revokeText({
      id,
      key: ancestor ? root.line : c.key.raw,
      for: PERSON,
      to: "tasks-law",
      sentAt: SENT,
      saw: { label: "test", location: "test", method: "command", check: "touch" },
    });

    // A second gateway over the same store takes the membership write before a held call.
    const b = yield* Gateway.pipe(Effect.provide(gatewayFor()));
    expect((yield* b.grant({ text: value, armored: yield* (ancestor ? backup : root).sign(value) }))._tag).toBe(
      "applied",
    );

    for (const old of clients.filter((x) => ancestor || x.key.raw === c.key.raw)) {
      old.live = false;
    }
  });

  const tryGrant = Effect.fnUntraced(function* (c: Client, id: string) {
    const value = grantText({
      id,
      key: stranger.raw,
      for: PERSON,
      to: "tasks-law",
      as: "hands",
      sentAt: SENT,
      saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: ["git"] },
    });

    const answer = yield* trace(d.grant({ text: value, armored: yield* c.key.sign(value) }));
    expect(answer._tag).toBe("refused");
  });

  const route = Effect.fnUntraced(function* (c: Client, method: string, params: unknown) {
    // oxlint-disable-next-line fabrika/no-ledger-sql -- edge: this security law audits persisted input records
    const inputRows = () => store.sql.exec("SELECT * FROM entries WHERE stream='gateway/inputs'");
    const beforeInputs = inputRows();
    const spanned = spans.length;
    const answer = yield* trace(d.route(c.client, method, params));
    calls.push({ method, answer, spans: spans.slice(spanned) });

    if (method.startsWith("tasks.")) {
      expect(inputRows()).toEqual(beforeInputs);
    }

    let saved = Attached.cases.online.make({
      client: c.client,
      identity: { key: c.key.fingerprint, person: PERSON, as: c.role },
      version: 1,
      waits: [],
      busy: false,
      watching: false,
      has: c.has,
      ...(c.build === undefined ? {} : { build: c.build }),
    });

    const transport = connection({
      reader: c.client,
      session: c.client,
      ping: () => 30_000,
      read: () => saved,
      save: (a) => {
        if (a._tag === "online") {
          saved = a;
          attachments.push(a);
        }
      },
      send: (f) => {
        frames.push(f);
      },
      close: () => {},
      wait: () => (answer._tag === "refused" ? Effect.fail(answer) : Effect.die("hands ledger.wait must be refused")),
      call: () => Effect.succeed(answer),
    });

    yield* trace(transport.frame(JSON.stringify({ jsonrpc: "2.0", id: frames.length, method, params })));

    return answer;
  });

  /**
   * W2b: two calls through a second door over the same store whose budget is one call a minute; a
   * new budget starts a new window, so the first spends it and the second is over it.
   */
  const routeLimited = Effect.fnUntraced(function* (c: Client, method: string, params: unknown) {
    const tight = store.gateway({ ...options, rateLimit: { limit: 1, window: 60_000 } }).pipe(Layer.provide(wakeups));

    return yield* Gateway.use((g) =>
      Effect.gen(function* () {
        yield* trace(g.route(c.client, method, params));
        const spanned = spans.length;
        const answer = yield* trace(g.route(c.client, method, params));

        return { answer, spans: spans.slice(spanned) };
      }),
    ).pipe(Effect.provide(tight));
  });

  for (const [n, k] of keys.entries()) {
    yield* grant(k, n < 2 ? "hands" : n === 2 ? "window" : "agent", `grant-${n}`);
  }

  const primary = yield* hello(pick(keys, 0), "hands", ["git", "node", "docker"], "first-build");
  const other = yield* hello(pick(keys, 1), "hands", ["git", "node", "docker"], "other-build");
  yield* hello(pick(keys, 2), "window", ["git", "node", "docker"], "window-build");
  yield* hello(pick(keys, 3), "agent", ["git", "node", "docker"], "agent-build");

  return {
    store,
    root,
    privateKeys: [root.stored, backup.stored, stranger.stored, ...keys.map((key) => key.stored)],
    primary,
    other,
    clients,
    notices,
    delivered,
    opened,
    frames,
    urls,
    logs,
    spans,
    attachments,
    controls,
    wakes,
    calls,
    wakeFault,
    rings: store.rings,
    /** One call straight at the door, as a connection's `call` makes it, with no frame around it. */
    door: (c: Client, method: string, params: unknown) => trace(d.route(c.client, method, params)),
    keys,
    grant,
    hello,
    revoke,
    tryGrant,
    route,
    routeLimited,
    j,
    reopen: Effect.gen(function* () {
      yield* store.reopen;
      life = yield* Layer.build(gatewayFor());
      d = yield* door();
    }),
  };
});

type Focus = "A4" | "A6" | "A7" | "A8" | "A9" | "A10" | "A11" | "A12" | "W1";

const moves: Record<Focus, ReadonlyArray<string>> = {
  A4: ["advance", "take", "capabilities", "role", "reconnect"],
  A6: ["advance", "take", "add", "ambiguous", "reopen"],
  A7: ["advance", "take", "wrong", "reconnect"],
  A8: ["advance", "take", "revoke", "race", "reconnect"],
  A9: ["advance", "take", "forbidden", "grant"],
  A10: ["advance", "take", "retry", "reconnect", "reopen"],
  A11: ["advance", "take", "malformed", "reserved"],
  A12: ["advance", "take", "retry", "malformed", "reserved", "reconnect", "reopen", "forbidden", "role", "grant"],
  W1: ["advance", "take", "retry", "fail_wake", "reopen"],
};

const walk = (open: Effect.Effect<Store, never, Scope.Scope>, focus: Focus, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: Tape) {
    const w = yield* world(open);
    const saved: Array<Saved> = [];
    let current = w.primary;
    let sequence = 0;

    const said = (cell: Cell) => ({
      sentAt: cell.sentAt,
      seen: cell.seen % (Math.max(0, ...saved.flatMap((s) => s.task.events.map((event) => event.rev))) + 1),
    });

    const add = Effect.fnUntraced(function* (process: string, cell: Cell) {
      const request = {
        ...tape.request,
        process,
        id: `opaque-${sequence++}`,
        target: w.primary.key.fingerprint,
        needs: ["git"],
      };

      yield* w.j((j) =>
        j.request(request, {
          by: "trusted-program",
          for: PERSON,
          sentAt: cell.sentAt,
          seen: 0,
          parent: request.parent,
          traceId: request.traceId,
          build: request.build,
        }),
      );
      const task = yield* w.j((j) => j.read(request.id));
      expect(task.state).toEqual(State.cases.requested.make({ request }));
      saved.push({ request, task });
    });

    yield* add(tape.request.process, pick(tape.cells, 0));
    const beforeHello = JSON.stringify(saved.map((s) => s.task));
    expect(w.notices.filter((n) => JSON.stringify(n).includes("tasks."))).toEqual([]);
    expect(JSON.stringify(yield* w.j((j) => j.read(pick(saved, 0).request.id)))).toBe(
      JSON.stringify(pick(saved, 0).task),
    );
    expect(beforeHello).not.toBe("");

    const unchanged = Effect.fnUntraced(function* () {
      for (const s of saved) {
        expect(yield* w.j((j) => j.read(s.request.id))).toEqual(s.task);
      }
    });

    const snapshot = (s: Saved) => ({ process: s.request.process, task: s.request.id });

    const checkEvent = (s: Saved, c: Client, cell: Cell, seen: number) => {
      const event = last(s.task.events);
      expect(event.by).toBe(c.key.fingerprint);
      expect(event.for).toBe(PERSON);
      expect(event.sentAt).toBe(cell.sentAt);
      expect(event.seen).toBe(seen);
      expect(event.build).toBe(c.build);

      if (focus === "A10" && (event.event === "started" || event.event === "finished")) {
        expect(event).toMatchObject({ connection: c.client, has: c.has });
      }

      expect(s.task.state).toMatchObject({ request: s.request });
      expect(event.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(event.arrivedAt).toBeGreaterThanOrEqual(0);
    };

    /** W2: the trace of every wake so far, so no two calls' wakes share one. */
    const traces = new Set<string>();

    /**
     * W1: a finish the gateway took woke its requester's name once, outside the turn; any other call
     * woke nobody. W2: that wake carries the trace of the call's own `gateway.tasks` span, and its
     * `spanId` is that span's parent. Returns the wake's `traceId`, for the first finish's saved one.
     */
    const woke = (s: Saved, before: number, finished: boolean) => {
      const fresh = w.wakes.slice(before);

      if (!finished) {
        expect(fresh, "W1: a refused call wakes nobody").toEqual([]);

        return undefined;
      }

      expect(
        fresh.map(({ name, free }) => ({ name, free })),
        "W1: a taken finish wakes the requester's name once, after the write turn",
      ).toEqual([{ name: s.request.name, free: true }]);
      done.add("woke");
      const trace = pick(fresh, 0).trace ?? expect.fail("W2: a taken finish's wake carries a trace");
      const tasks = last(w.calls).spans.filter((span) => span.name === "gateway.tasks");
      expect(tasks, "W2: the finish ran in one gateway.tasks span").toHaveLength(1);
      const span = pick(tasks, 0);
      expect(trace.traceId, "W2: the wake joins the trace of the call's gateway.tasks span").toBe(span.traceId);
      expect(
        Option.getOrUndefined(span.parent)?.spanId,
        "W2: the span that woke is the gateway.tasks span's parent",
      ).toBe(trace.spanId);
      expect(traces.has(trace.traceId), "W2: two calls' wakes never share a trace").toBe(false);
      traces.add(trace.traceId);

      return trace.traceId;
    };

    /** W2b: each tasks call that reaches the tasks branch has one `gateway.route` span, and it holds the answer's tag as its outcome. */
    const outcomes = (from: number) => {
      for (const call of w.calls.slice(from).filter((call) => call.method.startsWith("tasks."))) {
        const routes = call.spans.filter((span) => span.name === "gateway.route");
        expect(routes, `W2b: ${call.method} opens one gateway.route span`).toHaveLength(1);
        expect(
          pick(routes, 0).attributes.get("fab.gateway.outcome"),
          `W2b: ${call.method}'s gateway.route span holds the answer's tag`,
        ).toBe(call.answer._tag);
      }
    };

    const take = Effect.fnUntraced(function* (s: Saved, cell: Cell) {
      const before = s.task;

      const candidates = saved.filter(
        (other) => other.request.process === s.request.process && phase(other) !== "finished",
      );

      const metadata = said(cell);
      const answer = yield* w.route(current, "tasks.take", { process: s.request.process, ...metadata });
      const able = current.live && current.role === "hands" && current.build !== undefined;

      if (!able || (candidates.length === 1 && !current.has.includes("git"))) {
        refused(answer);

        return;
      }

      const result = accepted(answer);

      if (candidates.length === 0) {
        expect(result).toEqual(TakeReply.cases.idle.make({}));
        done.add("idle");
      } else if (candidates.length > 1) {
        expect(result).toEqual(TakeReply.cases.refused.make({ reason: "ambiguous" }));
        done.add("ambiguous");
      } else {
        const selected = pick(candidates, 0);
        const task = Schema.decodeUnknownSync(Schema.TaggedStruct("assigned", { task: Task }))(result).task;
        expect(task).toEqual(yield* w.j((j) => j.read(selected.request.id)));

        if (phase(selected) === "requested") {
          expect(task.state).toMatchObject({
            request: selected.request,
            assignment: {
              executor: {
                key: current.key.fingerprint,
                connection: current.client,
                has: current.has,
                build: current.build,
              },
            },
          });
          selected.task = task;
          checkEvent(selected, current, cell, metadata.seen);
          done.add("assigned");
        } else {
          expect(task).toEqual(selected.task);
          done.add(`take@${phase(selected)}`);
        }
      }

      if (candidates.length !== 1) {
        expect(s.task).toBe(before);
      }
    });

    for (const cell of tape.cells) {
      const called = w.calls.length;
      const s = pick(saved, cell.pick);
      const p = phase(s);

      const available = moves[focus].filter((move) =>
        move === "race"
          ? current.live && current.build !== undefined && current.has.includes("git") && p !== "requested"
          : move === "revoke"
            ? current.live && p !== "requested"
            : move === "retry"
              ? p === "started" || p === "finished"
              : move === "wrong"
                ? p !== "requested"
                : true,
      );

      const move = pick(available, cell.move);
      done.add(move);

      if (move === "add") {
        const process = yield* Id.Generator.use((g) => g.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer));
        yield* add(process, cell);
      } else if (move === "ambiguous") {
        yield* add(s.request.process, cell);
      } else if (move === "take") {
        yield* take(s, cell);
      } else if (move === "advance") {
        if (p === "requested" || p === "finished") {
          yield* take(s, cell);
        } else {
          if (current.live && focus === "A10") {
            current = yield* w.hello(current.key, "hands", ["git", ...cell.has], `${cell.build}-${sequence++}`);
            expect(current.client).not.toBe(assignment(s).executor.connection);
            done.add(`reconnect@${p}`);
          } else if (current.live && (current.build === undefined || !current.has.includes("git"))) {
            current = yield* w.hello(current.key, "hands", ["git"], cell.build);
          }

          const method = p === "assigned" ? "tasks.started" : "tasks.finish";

          const params = {
            ...snapshot(s),
            execution: assignment(s).execution,
            ...said(cell),
            ...(method === "tasks.finish" ? { result: cell.result } : {}),
          };

          const failing = w.wakeFault.fail;
          const woken = w.wakes.length;
          const answer = yield* w.route(current, method, params);
          const able = current.live && current.build !== undefined && current.has.includes("git");

          const wake = focus === "W1" ? woke(s, woken, able && method === "tasks.finish") : undefined;

          /** W2: a first finish's wake carries the trace its `finished` event saved. */
          const traced = () => {
            if (wake !== undefined) {
              expect(last(s.task.events).traceId, "W2: the first finish's wake carries the trace it saved").toBe(wake);
              done.add("traced");
            }
          };

          if (!able) {
            refused(answer);
          } else if (focus === "W1" && method === "tasks.finish" && failing) {
            // The finish is saved before the wake: a failed wake answers `unavailable`, never an ok.
            expect(answer, "W1: a failed wake answers refused unavailable").toEqual(
              Answer.cases.refused.make({ reason: "unavailable" }),
            );
            const first = s.task;
            s.task = yield* w.j((j) => j.read(s.request.id));
            checkEvent(s, current, cell, params.seen);
            expect(s.task.events).toHaveLength(first.events.length + 1);
            expect(s.task.state._tag, "W1: a failed wake leaves the task finished").toBe("finished");
            expect(s.task.state).toMatchObject({ result: cell.result });
            traced();
            s.finish = { rev: last(s.task.events).rev, arrivedAt: last(s.task.events).arrivedAt };
            done.add("finished");
            done.add("wake_failed");
          } else {
            const receipt = accepted(answer);
            const first = s.task;
            s.task = yield* w.j((j) => j.read(s.request.id));
            checkEvent(s, current, cell, params.seen);

            if (focus === "A10") {
              expect(assignment(s)).toEqual(assignment({ ...s, task: first }));
            }

            expect(s.task.events).toHaveLength(first.events.length + 1);
            expect(receipt).toMatchObject({ rev: last(s.task.events).rev, arrivedAt: last(s.task.events).arrivedAt });

            if (method === "tasks.started") {
              s.starts = receipt;
              done.add("started");
            } else {
              s.finish = receipt;
              expect(s.task.state._tag).toBe("finished");
              expect(s.task.state).toMatchObject({ result: cell.result });
              traced();
              done.add("finished");
            }
          }
        }
      } else if (move === "reconnect" || move === "capabilities") {
        const has =
          focus === "A7" ? ["git"] : move === "capabilities" ? (cell.variant % 2 === 0 ? [] : ["git"]) : cell.has;

        if (current.live) {
          current = yield* w.hello(
            current.key,
            "hands",
            has,
            focus !== "A7" && cell.variant % 5 === 0 ? undefined : cell.build,
          );
          done.add(`hello:${current.build === undefined ? "old" : current.has.includes("git") ? "able" : "lacking"}`);
          yield* take(s, cell);
        }
      } else if (move === "role") {
        const c = pick(
          w.clients.filter((x) => x.role !== "hands"),
          cell.pick,
        );

        for (const method of ["tasks.take", "tasks.read", "tasks.started", "tasks.finish"]) {
          const params =
            method === "tasks.take"
              ? { process: s.request.process, ...said(cell) }
              : method === "tasks.read"
                ? snapshot(s)
                : {
                    ...snapshot(s),
                    execution: p === "requested" ? "unknown" : assignment(s).execution,
                    ...said(cell),
                    ...(method === "tasks.finish" ? { result: cell.result } : {}),
                  };

          refused(yield* w.route(c, method, params));
        }

        done.add(c.role);
      } else if (move === "wrong") {
        const params = { ...snapshot(s), execution: assignment(s).execution, ...said(cell) };

        const wrongProcess = yield* Id.Generator.use((g) => g.next(Id.Process)).pipe(
          Effect.provide(Id.Generator.layer),
        );

        const methods = ["tasks.read", "tasks.started", "tasks.finish"];

        for (const method of methods) {
          const base =
            method === "tasks.read"
              ? snapshot(s)
              : { ...params, ...(method === "tasks.finish" ? { result: cell.result } : {}) };

          refused(yield* w.route(w.other, method, base));
          refused(yield* w.route(current, method, { ...base, process: wrongProcess }));

          if (method !== "tasks.read") {
            refused(yield* w.route(current, method, { ...base, execution: `${params.execution}x` }));
          }
        }

        expect(taskReply(yield* w.route(w.primary, "tasks.read", snapshot(s)))).toEqual(s.task);
        done.add(`wrong@${p}`);
      } else if (move === "retry") {
        if (current.live && (current.build === undefined || !current.has.includes("git"))) {
          current = yield* w.hello(current.key, "hands", ["git"], cell.build);
        }

        const changed = { ...said(cell), sentAt: `${cell.sentAt}-retry` };
        const woken = w.wakes.length;

        const start = yield* w.route(current, "tasks.started", {
          ...snapshot(s),
          execution: assignment(s).execution,
          ...changed,
        });

        const able = current.live && current.build !== undefined && current.has.includes("git");

        if (able) {
          expect(accepted(start)).toEqual(s.starts);
        } else {
          refused(start);
        }

        if (focus === "W1") {
          // A start, first or repeated, wakes nobody: only a finish has a result to deliver.
          expect(w.wakes.length, "W1: a start wakes nobody").toBe(woken);
        }

        if (p === "finished" && s.task.state._tag === "finished") {
          const failing = w.wakeFault.fail;
          const before = w.wakes.length;

          const finish = yield* w.route(current, "tasks.finish", {
            ...snapshot(s),
            execution: assignment(s).execution,
            ...changed,
            result: s.task.state.result,
          });

          if (focus === "W1" && woke(s, before, able) !== undefined) {
            done.add("traced@repeat");
          }

          if (able && focus === "W1" && failing) {
            expect(finish, "W1: a repeated finish whose wake failed answers unavailable").toEqual(
              Answer.cases.refused.make({ reason: "unavailable" }),
            );
            done.add("wake_failed@repeat");
          } else if (able) {
            expect(accepted(finish)).toEqual(s.finish);
            done.add("woke@repeat");
          } else {
            refused(finish);
          }

          // The task stays as the first finish left it, whatever the wake did.
          expect(yield* w.j((j) => j.read(s.request.id))).toEqual(s.task);
        }

        done.add(`retry@${p}`);
      } else if (move === "reopen") {
        yield* w.reopen;

        if (focus === "A10") {
          for (const kept of saved) {
            expect(taskReply(yield* w.route(w.primary, "tasks.read", snapshot(kept)))).toEqual(kept.task);
            done.add(`reopen@${phase(kept)}`);
          }
        }
      } else if (move === "revoke") {
        yield* w.revoke(current, `revoke-${sequence++}`);
      } else if (move === "race") {
        const entered = yield* Deferred.make<void>(),
          release = yield* Deferred.make<void>();

        w.controls.pause = { entered, release };

        const method = pick(
          p === "finished"
            ? ["tasks.read", "tasks.finish"]
            : ["tasks.take", "tasks.read", "tasks.started", ...(p === "started" ? ["tasks.finish"] : [])],
          cell.variant,
        );

        const params =
          method === "tasks.take"
            ? { process: s.request.process, ...said(cell) }
            : method === "tasks.read"
              ? snapshot(s)
              : {
                  ...snapshot(s),
                  execution: assignment(s).execution,
                  ...said(cell),
                  ...(method === "tasks.finish"
                    ? { result: s.task.state._tag === "finished" ? s.task.state.result : cell.result }
                    : {}),
                };

        const pending = yield* Effect.forkScoped(w.route(current, method, params));
        yield* Effect.raceFirst(
          Deferred.await(entered),
          Fiber.join(pending).pipe(
            Effect.andThen(Effect.die("the queued call answered without entering the shared turn")),
          ),
        );
        yield* w.revoke(current, `race-${sequence++}`, cell.variant % 2 === 1);
        yield* Deferred.succeed(release, undefined);
        refused(yield* Fiber.join(pending));
        done.add(`race:${method}`);
      } else if (move === "fail_wake") {
        w.wakeFault.fail = true;
      } else if (move === "grant") {
        yield* w.tryGrant(current, `hands-grant-${sequence++}`);
      } else if (move === "forbidden") {
        const method = pick(
          [
            "view.open",
            "process.send",
            "ledger.read",
            "ledger.wait",
            "gateway.watch",
            "gateway.deny",
            "spans.read",
            "spans.content",
            "spans.deleteContent",
            "tasks.request",
            "project.sign",
          ],
          cell.variant,
        );

        const before = [w.delivered.length, w.opened.length];
        refused(
          yield* w.route(current, method, {
            pid: s.request.process,
            stream: "gateway/access",
            after: 0,
            letter: `letter-${sequence++}`,
            m: { type: "input" },
            sentAt: SENT,
            seen: 0,
            key: w.other.key.raw,
            saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: [] },
            chain: Chain.cases.spans.make({}),
            spanId: "known",
            reason: "test",
          }),
        );
        expect([w.delivered.length, w.opened.length]).toEqual(before);
        done.add(`forbidden:${method}`);
      } else if (move === "malformed" || move === "reserved") {
        const method = pick(["tasks.take", "tasks.read", "tasks.started", "tasks.finish"], cell.pick);

        const base =
          method === "tasks.take"
            ? { process: s.request.process, ...said(cell) }
            : method === "tasks.read"
              ? snapshot(s)
              : {
                  ...snapshot(s),
                  execution: p === "requested" ? "unknown" : assignment(s).execution,
                  ...said(cell),
                  ...(method === "tasks.finish" ? { result: cell.result } : {}),
                };

        const field = pick(
          move === "reserved"
            ? ["id", "by", "for", "arrivedAt"]
            : ["target", "as", "has", "build", "connection", "extra"],
          cell.variant,
        );

        // oxlint-disable-next-line fabrika/no-ledger-sql -- edge: the security law audits raw output without granting hands ledger access
        const inputs = () => w.store.sql.exec("SELECT * FROM entries WHERE stream='gateway/inputs'");
        const beforeInputs = inputs();

        const storedRows = () =>
          ["entries", "measurements", "unsent"].map((table) => w.store.sql.exec(`SELECT * FROM "${table}"`));

        const beforeStored = move === "reserved" ? storedRows() : [];
        const answer = yield* w.route(current, method, { ...base, [field]: tape.secret });

        if (move === "reserved") {
          expect(inputs()).toEqual(beforeInputs);
          expect(storedRows()).toEqual(beforeStored);
          const sums = w.store.sql.exec("SELECT * FROM sums WHERE refused='reserved'");
          expect(sums.length).toBeGreaterThan(0);
          expect(new Set(sums.map((row) => JSON.stringify([row.piece, row.hour]))).size).toBe(sums.length);
          expect(sums.every((row) => Number(row.count) > 0)).toBe(true);
        }

        refused(answer);

        if (move === "reserved") {
          expect(answer).toMatchObject({ reason: "reserved" });
        }

        if (method === "tasks.finish") {
          refused(
            yield* w.route(current, method, {
              ...base,
              result: { ...TaskResult.cases.exited.make({ code: 0, version: "x" }), code: "bad" },
            }),
          );
        }

        done.add(`${move}:${field}`);
      }

      if (focus === "W1") {
        outcomes(called);
      }

      yield* unchanged();
      expect(w.notices.filter((n) => JSON.stringify(n).includes("tasks."))).toEqual([]);
    }

    if (focus === "W1") {
      // W2b: a tasks call over its budget is refused before the tasks branch, in `refuseRate`'s span only.
      const s = last(saved);
      const limited = yield* w.routeLimited(current, "tasks.read", snapshot(s));
      expect(limited.answer, "W2b: a tasks call over its budget is rate refused").toMatchObject({
        reason: "rate_limited",
      });
      const routes = limited.spans.filter((span) => span.name === "gateway.route");
      expect(routes, "W2b: a rate-refused tasks call opens only refuseRate's span").toHaveLength(1);
      expect(pick(routes, 0).attributes.get(REFUSED)).toBe("rate_limited");
      expect(pick(routes, 0).attributes.has("fab.gateway.outcome")).toBe(false);
      expect(limited.spans.filter((span) => span.name === "gateway.tasks")).toEqual([]);
      expect(yield* w.j((j) => j.read(s.request.id))).toEqual(s.task);
    }

    if (focus === "A12") {
      // These generated key-store sentinels never enter a protocol parameter.
      const sentinels = [`private-${tape.secret}-key`, `pass-${tape.secret}`, `recovery-${tape.secret}`];

      for (const privateKey of w.privateKeys) {
        // oxlint-disable-next-line fabrika/no-redacted-value -- edge: this test compares generated sentinels to public output without printing or sending them
        sentinels.push(Redacted.value(privateKey));
      }

      const outputs: Record<string, unknown> = {
        frames: w.frames,
        urls: w.urls.flatMap((url) => [url, encodeURIComponent(url), decodeURIComponent(url)]),
        logs: w.logs,
        spans: w.spans.map((span) => ({
          name: span.name,
          attributes: [...span.attributes],
          // The `Span` contract names no `events`; the native span keeps them, so read them when there.
          events: "events" in span ? span.events : undefined,
          status: span.status,
        })),
        measurements: [],
        attachments: w.attachments,
        ledger: [],
      };

      const tables = w.store.sql
        .exec("SELECT name FROM sqlite_master WHERE type='table'")
        .map((row) => String(row.name));

      for (const table of tables) {
        const rows = w.store.sql.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`);

        if (table === "entries") {
          outputs.ledger = rows;

          for (const row of rows.filter((row) => row._tag === "initialized")) {
            const { url } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))(
              row.body,
            );

            outputs.urls = [outputs.urls, url, encodeURIComponent(url), decodeURIComponent(url)];
          }
        } else if (table === "gateway_state") {
          outputs.attachments = [w.attachments, rows];
        } else if (/measure|refusal|sums|summary/.test(table)) {
          outputs.measurements = [outputs.measurements, rows];
        } else if (table === "unsent" || /span|content/.test(table)) {
          outputs.spans = [outputs.spans, rows];
        }
      }

      for (const [name, value] of Object.entries(outputs)) {
        const encoded = JSON.stringify(value, (_key, item: unknown) =>
          typeof item === "bigint"
            ? String(item)
            : item instanceof Map
              ? [...item]
              : item instanceof Error
                ? { name: item.name, message: item.message, cause: item.cause }
                : item,
        );

        for (const sentinel of sentinels) {
          for (const form of [
            sentinel,
            encodeURIComponent(sentinel),
            encodeURIComponent(encodeURIComponent(sentinel)),
            Base64.encode(text(sentinel)),
            Base64Url.encode(text(sentinel)),
          ]) {
            expect(encoded.includes(form), name).toBe(false);
          }
        }
      }
    }
  });

const required: Record<Focus, ReadonlyArray<string>> = {
  A4: [
    "assigned",
    "started",
    "finished",
    "window",
    "agent",
    "hello:old",
    "hello:lacking",
    "take@assigned",
    "take@started",
  ],
  A6: ["assigned", "started", "finished", "idle", "ambiguous", "reopen"],
  A7: ["wrong@assigned", "wrong@started", "wrong@finished"],
  A8: ["race:tasks.take", "race:tasks.read", "race:tasks.started", "race:tasks.finish"],
  A9: [
    "grant",
    "forbidden:view.open",
    "forbidden:process.send",
    "forbidden:ledger.read",
    "forbidden:ledger.wait",
    "forbidden:gateway.watch",
    "forbidden:gateway.deny",
    "forbidden:spans.read",
    "forbidden:spans.content",
    "forbidden:spans.deleteContent",
    "forbidden:tasks.request",
    "forbidden:project.sign",
  ],
  A10: [
    "assigned",
    "started",
    "finished",
    "retry@started",
    "retry@finished",
    "reopen",
    "reconnect",
    "reconnect@assigned",
    "reconnect@started",
    "reopen@started",
    "reopen@finished",
  ],
  A11: [
    "assigned",
    "started",
    "finished",
    "reserved:id",
    "reserved:by",
    "reserved:for",
    "reserved:arrivedAt",
    "malformed:target",
    "malformed:as",
    "malformed:has",
    "malformed:build",
    "malformed:connection",
    "malformed:extra",
  ],
  A12: ["assigned", "started", "finished", "retry", "malformed", "reserved", "reconnect", "reopen"],
  W1: [
    "assigned",
    "started",
    "finished",
    "woke",
    "wake_failed",
    "woke@repeat",
    "wake_failed@repeat",
    "reopen",
    "traced",
    "traced@repeat",
  ],
};

// --- P39 slice 4a: G1's list half and G2 ------------------------------------------------------------

const Pointer = Schema.Struct({ id: Schema.String, process: Schema.String });

const Listed = Schema.Struct({ tasks: Schema.Array(Pointer), rev: Schema.Int });

const Ready = Schema.Struct({ rev: Schema.Int });

/** One task the walk asked for and has not finished: which phase it is in, and its execution once taken. */
type Asked = { readonly request: Request; phase: "requested" | "assigned" | "started"; execution?: string };

type TargetFocus = "G1" | "G2";

const targetMoves: Record<TargetFocus, ReadonlyArray<string>> = {
  G1: ["request", "repeat", "conflict", "advance", "list", "list_bad", "role", "reopen"],
  G2: ["request", "advance", "wait", "wait_bad", "role", "reopen"],
};

const targetRequired: Record<TargetFocus, ReadonlyArray<string>> = {
  G1: [
    "list:hands-1",
    "list:hands-2",
    "list:open",
    "list:empty",
    "list:after-finish",
    "repeat",
    "conflict",
    "list_bad",
    "role:window",
    "role:agent",
    "reopen",
  ],
  G2: ["wait:ready", "wait:parked", "rung", "not_rung", "wait_bad:stream", "wait_bad:key", "role:window", "reopen"],
};

/**
 * A walk of hands keys asking the gateway for their own work. Every move is picked from what the
 * world holds now: a repeat or a conflict names a saved request, an advance names an open task of the
 * calling key, and a wait starts after a rev the same key's list just answered. The oracle is this
 * walk's own record of what each key was asked for and what it has finished.
 */
const targetWalk = (open: Effect.Effect<Store, never, Scope.Scope>, focus: TargetFocus, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: Tape) {
    const w = yield* world(open);
    const hands = [w.primary, w.other];
    const strangers = w.clients.filter((c) => c.role !== "hands");
    const asked = new Map<string, Array<Asked>>();
    const saved: Array<Request> = [];
    /** The rev each key's last list answered, and how many requests for it were accepted since. */
    const seen = new Map<string, { rev: number; since: number }>();
    /**
     * A key whose `tasks.wait` parked after `after`, until a ring for it is seen. The ledger keeps one
     * ring row per stream, at the lowest `after` parked on it, in the store's own file, so a reopen
     * keeps it. Revs count every line of the ledger, so a wait parked past the stream's end is rung
     * only by the first request whose line lands past `after`, never by an earlier one.
     */
    const parked = new Map<string, number>();
    let sequence = 0;
    const said = (cell: Cell) => ({ sentAt: cell.sentAt, seen: 0 });
    const mine = (c: Client) => asked.get(c.key.fingerprint) ?? [];

    /** `tasks.list` by a hands key: exactly its open tasks as pointers, and a cursor that moved only for its own requests. */
    const list = Effect.fnUntraced(function* (c: Client) {
      const listed = Schema.decodeUnknownSync(Listed)(accepted(yield* w.door(c, "tasks.list", {})));
      const wanted = mine(c).map((a) => ({ id: a.request.id, process: a.request.process }));
      const order = (all: ReadonlyArray<{ readonly id: string }>) => [...all].sort((a, b) => a.id.localeCompare(b.id));
      expect(order(listed.tasks), "G1: tasks.list answers exactly the caller's open tasks, as pointers").toEqual(
        order(wanted),
      );
      const before = seen.get(c.key.fingerprint) ?? { rev: 0, since: 0 };
      expect(
        before.since > 0 ? listed.rev > before.rev : listed.rev === before.rev,
        `G1: the cursor moves only when a request for this key was accepted (was ${before.rev}, ${before.since} since, now ${listed.rev})`,
      ).toBe(true);
      expect(listed.rev === 0, "G1: the cursor is 0 only before the key's first request").toBe(
        saved.every((r) => r.target !== c.key.fingerprint),
      );
      seen.set(c.key.fingerprint, { rev: listed.rev, since: 0 });
      done.add(`list:${c === w.primary ? "hands-1" : "hands-2"}`);
      done.add(wanted.length > 0 ? "list:open" : "list:empty");

      return listed;
    });

    for (const cell of tape.cells) {
      const c = pick(hands, cell.pick);
      const pending = mine(c);

      const available = targetMoves[focus].filter((move) =>
        move === "repeat" || move === "conflict" ? saved.length > 0 : move === "advance" ? pending.length > 0 : true,
      );

      const move = pick(available, cell.move);
      done.add(move);

      if (move === "request") {
        const process = yield* Id.Generator.use((g) => g.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer));

        const request = {
          ...tape.request,
          process,
          id: `target-${sequence++}`,
          target: c.key.fingerprint,
          needs: ["git"],
        };

        const before = w.rings.length;
        yield* w.j((j) =>
          j.request(request, {
            by: "trusted-program",
            for: PERSON,
            sentAt: cell.sentAt,
            seen: 0,
            parent: request.parent,
            traceId: request.traceId,
            build: request.build,
          }),
        );
        saved.push(request);
        asked.set(c.key.fingerprint, [...pending, { request, phase: "requested" }]);
        const count = seen.get(c.key.fingerprint) ?? { rev: 0, since: 0 };
        seen.set(c.key.fingerprint, { ...count, since: count.since + 1 });
        const rung = w.rings.slice(before);

        for (const h of hands.filter((h) => h !== c)) {
          expect(
            rung.filter((r) => r.stream === targetStream(h.key.fingerprint)),
            "G2: a request for one key rings no other key's stream",
          ).toEqual([]);
        }

        const after = parked.get(c.key.fingerprint);
        const own = rung.filter((r) => r.stream === targetStream(c.key.fingerprint));
        // The request's pointer is now the last line of the key's stream.
        const { rev } = yield* w.j((j) => j.forTarget(c.key.fingerprint));
        const due = after !== undefined && rev > after;
        expect(
          own.map((r) => r.rev),
          `G2: a request for a parked key rings its stream once, at its new line's rev, when that line is past the parked rev (parked ${after}, line ${rev}); else it rings nothing`,
        ).toEqual(due ? [rev] : []);

        if (due) {
          parked.delete(c.key.fingerprint);
          done.add("rung");
        } else {
          done.add("not_rung");
        }
      } else if (move === "repeat" || move === "conflict") {
        const first = pick(saved, cell.variant);
        const changed = move === "repeat" ? first : { ...first, name: `${first.name}-changed` };

        const answer = yield* Effect.result(
          w.j((j) =>
            j.request(changed, {
              by: "trusted-program",
              for: PERSON,
              sentAt: cell.sentAt,
              seen: 0,
              parent: first.parent,
              traceId: first.traceId,
              build: first.build,
            }),
          ),
        );

        expect(R.isSuccess(answer), `G1: a ${move} answers as the tasks service always did`).toBe(move === "repeat");
        // Nothing new for the key: its next list must answer the same cursor.
      } else if (move === "advance") {
        const a = pick(pending, cell.variant);
        const meta = said(cell);

        if (a.phase === "requested") {
          const answer = accepted(yield* w.door(c, "tasks.take", { process: a.request.process, ...meta }));
          const task = Schema.decodeUnknownSync(Schema.TaggedStruct("assigned", { task: Task }))(answer).task;
          a.phase = "assigned";
          a.execution = assignment({ request: a.request, task }).execution;
        } else {
          const method = a.phase === "assigned" ? "tasks.started" : "tasks.finish";

          const params = {
            process: a.request.process,
            task: a.request.id,
            execution: a.execution ?? expect.fail("a taken task has its execution"),
            ...meta,
            ...(method === "tasks.finish" ? { result: cell.result } : {}),
          };

          accepted(yield* w.door(c, method, params));

          if (a.phase === "assigned") {
            a.phase = "started";
          } else {
            asked.set(
              c.key.fingerprint,
              pending.filter((o) => o !== a),
            );
            done.add("finished");
          }
        }
      } else if (move === "list") {
        const finished = saved.some(
          (r) => r.target === c.key.fingerprint && !pending.some((o) => o.request.id === r.id),
        );

        yield* list(c);

        if (finished) {
          done.add("list:after-finish");
        }
      } else if (move === "list_bad") {
        const field = pick(["stream", "key", "target", "after", "process"], cell.variant);
        expect(yield* w.door(c, "tasks.list", { [field]: tape.secret }), "G1: tasks.list takes no field").toEqual(
          Answer.cases.refused.make({ reason: "bad_input" }),
        );
      } else if (move === "wait") {
        const { rev } = yield* list(c);
        const after = pick([rev, rev, Math.max(0, rev - 1), 0, rev + 1 + (cell.seen % 5)], cell.variant);
        const answer = yield* w.door(c, "tasks.wait", { after });

        if (after < rev) {
          expect(
            Schema.decodeUnknownSync(Ready)(accepted(answer)),
            "G2: a stream past `after` answers at once",
          ).toEqual({
            rev,
          });
          done.add("wait:ready");
        } else {
          expect(answer, "G2: a wait at or past the stream's end parks on the caller's own stream").toEqual(
            Answer.cases.parked.make({ stream: targetStream(c.key.fingerprint), after }),
          );
          parked.set(c.key.fingerprint, Math.min(after, parked.get(c.key.fingerprint) ?? after));
          done.add("wait:parked");
        }
      } else if (move === "wait_bad") {
        const field = pick(["stream", "key", "target", "process"], cell.variant);
        const other = pick(hands, cell.pick + 1);
        const value = field === "stream" ? targetStream(other.key.fingerprint) : other.key.fingerprint;
        const rings = w.rings.length;
        expect(
          yield* w.door(c, "tasks.wait", { after: 0, [field]: value }),
          "G2: tasks.wait takes `after` and nothing else",
        ).toEqual(Answer.cases.refused.make({ reason: "bad_input" }));
        expect(yield* w.door(c, "tasks.wait", {}), "G2: tasks.wait without `after` is bad_input").toEqual(
          Answer.cases.refused.make({ reason: "bad_input" }),
        );
        expect(w.rings.length).toBe(rings);
        done.add(`wait_bad:${field}`);
      } else if (move === "role") {
        const s = pick(strangers, cell.variant);

        for (const [method, params] of [
          ["tasks.list", {}],
          ["tasks.wait", { after: 0 }],
        ] as const) {
          expect(yield* w.door(s, method, params), `${method} by a ${s.role} key`).toEqual(
            Answer.cases.refused.make({ reason: "not_allowed" }),
          );
        }

        done.add(`role:${s.role}`);
      } else if (move === "reopen") {
        // The ledger's ring row lives in the store's file and outlives the gateway, so `parked` stays.
        yield* w.reopen;
      }
    }
  });

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) => {
  for (const focus of ["G1", "G2"] as const) {
    it.effect(
      focus === "G1"
        ? "G1: tasks.list answers exactly the open tasks whose target is the caller's key and the target stream's last rev; a window or agent key is refused"
        : "G2: tasks.wait answers { rev } when the key's stream is past after, else parks and is rung by the next request for that key only; params with any other field are bad_input",
      () =>
        Effect.gen(function* () {
          const done = new Set<string>();
          const law = targetWalk(open, focus, done);

          const result = yield* Arbitrary.checkEffect(
            Arbitrary.schema(Tape),
            (tape) =>
              Effect.scoped(law(tape)).pipe(
                Effect.as(true),
                Effect.catchCause((cause) => Effect.fail(cause)),
              ),
            { seed: 119120, runs: runsFor({ fast: 10, full: focus === "G1" ? 100 : 60 }), concurrency: 1 },
          );

          expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");
          expect([...done]).toEqual(expect.arrayContaining([...targetRequired[focus]]));
        }),
      120_000,
    );
  }

  for (const focus of Object.keys(moves) as Array<Focus>) {
    it.effect(
      focus === "W1"
        ? "W1: an accepted or repeated tasks.finish wakes the requester's name after the write turn and before it answers; a failed wake answers refused unavailable and leaves the task finished; W2 and W2b: that wake joins the finish's trace, and each tasks call that reaches the tasks branch has one gateway.route span with its outcome"
        : `${focus}${focus === "A12" ? " [secrets]" : ""}: authenticated task histories preserve authority and durable facts`,
      () =>
        Effect.gen(function* () {
          const done = new Set<string>();
          const law = walk(open, focus, done);

          const result = yield* Arbitrary.checkEffect(
            Arbitrary.schema(Tape),
            (tape) =>
              Effect.scoped(law(tape)).pipe(
                Effect.as(true),
                Effect.catchCause((cause) => Effect.fail(cause)),
              ),
            {
              seed: 119120,
              // A8 at 15 walks never races a read or a finish at this seed, so A8 and A10 run 30.
              runs: runsFor(
                focus === "A12"
                  ? { fast: 10, full: 40 }
                  : focus === "W1"
                    ? { fast: 10, full: 60 }
                    : focus === "A8" || focus === "A10"
                      ? { fast: 30, full: 60 }
                      : { fast: 25, full: 100 },
              ),
              concurrency: 1,
            },
          );

          expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");
          expect([...done]).toEqual(expect.arrayContaining([...required[focus]]));
        }),
      120_000,
    );
  }
};

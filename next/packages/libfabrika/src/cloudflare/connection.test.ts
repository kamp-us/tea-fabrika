import { createHash } from "node:crypto";
// next/, 0140. Only the platform and project answer are fake. The call handler and sink are real.
// node:sqlite is the edge: Effect has no synchronous in-memory SQLite handle.
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import { TestClock } from "effect/testing";
import type * as Tracer from "effect/Tracer";
import { vi } from "vitest";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { hash } from "../runtime/Built.ts";
import { ProgramLoader } from "../runtime/Entry.ts";
import { News, Published } from "../runtime/News.ts";
import { Program } from "../runtime/Program.ts";
import type { Descriptor } from "../runtime/Runner.ts";
import { Publication } from "../runtime/WatcherManager.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { targetStream } from "../tasks/Tasks.ts";
import type { SpanRow } from "../telemetry/Trace.ts";
import * as Trace from "../telemetry/Trace.ts";
import { Answer, Attached, type Wait } from "../transport/Wire.ts";
import type { GatewayCalls } from "./bindings.ts";
import { ConnectionService, connectionLayer } from "./connection.ts";
import { ProjectClient } from "./platform.ts";
import type { BrainOptions, Env } from "./runtime.ts";
import * as SettingsRecorded from "./SettingsRecorded.ts";
import * as SettingsStartsLedger from "./SettingsStartsLedger.ts";

import { runsFor } from "@kampus/vitest";
import { Arbitrary, Cause, Clock, Context, Exit, Layer, Option, Scope, Stream } from "effect";
import * as fc from "fast-check";
import { LedgerError } from "../ledger/Ledger.ts";
import { PAGE as DOOR_PAGE } from "../ledger/Log.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager, Written } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Chain } from "../telemetry/Trace.ts";
import { PAGE as WINDOW_PAGE } from "../transport/Wire.ts";
import * as Runtime from "./runtime.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

// The door (gateway/Gateway.ts) cuts every read answer by the ledger's `PAGE`, and the window
// (client/WindowMachine.ts) takes a page as full by the wire's. This platform may import both.
it("pinned: the page size the door cuts by is the page size the window reads, so a full page means the same on both ends", () => {
  expect(DOOR_PAGE).toBe(WINDOW_PAGE);
});

/** The codes a close frame from an endpoint may carry: the WebSocket API's `close(code)` takes 1000 or
 *  3000 to 4999 and throws for any other (WHATWG WebSockets, `close`; RFC 6455, 7.4.2). */
const sendable = (code: number) => code === 1000 || (code >= 3000 && code <= 4999);

const HOUR = 3_600_000;

const H = 1_790_002_800_000;

const fake = <A>(value: object): A => value as A;

const database = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

const world = (db: DatabaseSync, archiveFailure: "unreachable" | "mismatch" = "unreachable") => {
  const base = nodeSql(db);
  let settingsReads = 0;

  const sql = {
    ...base,
    exec: (query: string, ...args: Parameters<typeof base.exec> extends [string, ...infer A] ? A : never) => {
      if (/SELECT \* FROM entries WHERE stream = \? AND rev > \?/i.test(query)) {
        settingsReads++;
      }

      return base.exec(query, ...args);
    },
  };

  const input = StartsTest.fixture({ name: "test-project", port: 8787 }, (algorithm, data) =>
    createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );

  let attached: typeof Attached.Type = Attached.cases.online.make({
    client: "test-client",
    identity: { key: "test-key", person: "test-person", as: "window" },
    version: 1,
    waits: [],
    watching: false,
    busy: false,
  });

  const frames: Array<string> = [];
  const closes: Array<number> = [];
  const left: Array<string> = [];
  /** What the Connection object handed the Project's `publish`, in order. */
  const published: Array<{ client: string; update: unknown }> = [];
  let gone = false;

  const socket = fake<WebSocket>({
    deserializeAttachment: () => attached,
    serializeAttachment: (next: typeof Attached.Type) => {
      attached = next;
    },
    send: (frame: string) => frames.push(frame),
    // As the platform's socket: it throws for a code no close frame may carry, and once it is gone.
    close: (code: number) => {
      if (gone || !sendable(code)) {
        throw new Error("the socket takes no such close frame");
      }

      closes.push(code);
    },
  });
  const sockets = [socket];
  /** One more online socket on this object, for another client. It keeps what it is sent. */
  const join = (client: string) => {
    const mine = { frames: new Array<string>(), closes: new Array<number>() };
    const other = Attached.cases.online.make({
      client,
      identity: { key: `${client}-key`, person: `${client}-person`, as: "window" },
      version: 1,
      waits: [],
      watching: false,
      busy: false,
    });
    sockets.push(
      fake<WebSocket>({
        deserializeAttachment: () => other,
        serializeAttachment: () => {},
        send: (frame: string) => mine.frames.push(frame),
        close: (code: number) => mine.closes.push(code),
      }),
    );
    return mine;
  };
  const state = fake<DurableObjectState>({
    id: { name: "test-connection" },
    storage: {
      sql: {
        exec: sql.exec,
        get databaseSize() {
          return sql.size();
        },
      },
      transactionSync: sql.transaction,
    },
    getWebSockets: () => sockets,
    getTags: () => ["test-session", "test-tab", "test-key"],
    getWebSocketAutoResponseTimestamp: () => null,
  });

  let answer: typeof Answer.Type = Answer.cases.refused.make({ reason: "reserved" });
  const calls: Array<{ method: string; params: unknown }> = [];
  /** The object each routed call names as the one a parked wait rings, by method. */
  const readers: Array<{ method: string; reader: string | undefined }> = [];
  const saved: Array<SpanRow> = [];
  const stats = { writes: 0, archives: 0 };

  const env = fake<Env>({
    INSTANCE: JSON.stringify(input),
    PROJECT: {
      getByName: () => ({
        settingsStart: async () => StartsTest.reply(input),
        route: (_client: string, method: string, params: unknown, reader?: string) => {
          calls.push({ method, params });
          readers.push({ method, reader });

          // edge: the platform RPC returns a Promise
          return Promise.resolve(answer);
        },
        // A knock is answered as any routed call is here: with the answer the law set.
        knock: () => Promise.resolve(answer),
        publish: (client: string, update: unknown) => {
          published.push({ client, update });
          // edge: the platform RPC returns a Promise
          return Promise.resolve(Publication.cases.sent.make({}));
        },
        leave: (client: string) => {
          left.push(`leave ${client}`);

          // edge: the platform RPC returns a Promise
          return Promise.resolve();
        },
        disconnect: (client: string) => {
          left.push(`disconnect ${client}`);

          // edge: the platform RPC returns a Promise
          return Promise.resolve();
        },
      }),
    },
    RECORD: {
      getByName: () => ({
        write: (_chain: unknown, _part: number, rows: ReadonlyArray<{ span: SpanRow }>) => {
          stats.writes++;
          saved.push(...rows.map((row) => row.span));

          // edge: the platform record RPC returns a Promise
          return Promise.resolve({ _tag: "written" });
        },
      }),
    },
    MEASUREMENTS: {
      put: () => {
        stats.archives++;

        // edge: the platform bucket returns a Promise
        return archiveFailure === "unreachable" ? Promise.reject(new Error("archive unavailable")) : Promise.resolve();
      },
      // edge: a missing bucket object answers through a Promise
      head: () => Promise.resolve(null),
    },
  });

  const config = fake<BrainOptions>(input);
  const recorded = SettingsRecorded.layer(input).pipe(Layer.provide(SettingsStartsLedger.layer(sql)));

  return {
    socket,
    frames,
    closes,
    left,
    published,
    join,
    /** From now on the socket is already closed: it takes no frame. */
    lose: () => {
      gone = true;
    },
    calls,
    readers,
    saved,
    stats,
    settingsReads: () => settingsReads,
    answer: (value: typeof Answer.Type) => {
      answer = value;
    },
    layer: connectionLayer(state, env, config).pipe(Layer.provide(recorded), Layer.provide(Digest.layerWebCrypto)),
  };
};

const tableCounts = (db: DatabaseSync) =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map(({ name }) => [
        name,
        db.prepare(`SELECT count(*) AS n FROM "${String(name).replaceAll('"', '""')}"`).get()?.n,
      ]),
  );

StartsTest.law(
  "T753 L11 counted refusals stay bounded across hours and Connection reopens",
  fc.tuple(
    fc.array(fc.nat(), { minLength: 15, maxLength: 60 }),
    fc.constantFrom<"unreachable" | "mismatch">("unreachable", "mismatch"),
  ),
  ([choices, archiveFailure]) =>
    Effect.gen(function* () {
      const db = yield* database;
      let hour = H;
      yield* TestClock.setTime(hour - 16 * 24 * HOUR);

      const open = Effect.fnUntraced(function* () {
        const scope = yield* Effect.acquireRelease(Scope.make(), (owned) => Scope.close(owned, Exit.void));
        const w = world(db, archiveFailure);
        const context = yield* Layer.build(w.layer).pipe(Effect.provideService(Scope.Scope, scope));

        return { scope, w, context, service: Context.get(context, ConnectionService) };
      });

      let owner = yield* open();
      owner.w.answer(Answer.cases.ok.make({ result: { delivered: true } }));

      const accepted = () =>
        owner.service
          .message(owner.w.socket, JSON.stringify({ jsonrpc: "2.0", id: "prime", method: "process.send", params: {} }))
          .pipe(Effect.provideContext(owner.context));

      yield* accepted();
      yield* TestClock.setTime(hour + 1000);
      yield* accepted();
      expect(owner.w.stats.archives).toBeGreaterThan(0);
      owner.w.answer(Answer.cases.refused.make({ reason: "reserved" }));
      const firstInHour = new Map<number, ReturnType<typeof tableCounts>>();
      const totals = new Map<number, number>();

      for (const [index, choice] of choices.entries()) {
        const moves = totals.size === 0 ? ["refuse"] : ["refuse", "refuse", "reopen", "hour"];
        const move = moves[choice % moves.length];

        if (move === "reopen") {
          yield* Scope.close(owner.scope, Exit.void);
          owner = yield* open();
          firstInHour.delete(hour);
          continue;
        }

        if (move === "hour") {
          hour += (1 + (choice % 4)) * HOUR;
          yield* TestClock.setTime(hour);
          continue;
        }

        const writes = owner.w.stats.writes;
        const archives = owner.w.stats.archives;
        const reads = owner.w.settingsReads();
        const starts = db.prepare("SELECT count(*) AS n FROM entries").get()?.n;
        yield* owner.service
          .message(
            owner.w.socket,
            JSON.stringify({ jsonrpc: "2.0", id: index, method: "process.send", params: { by: `forged-${index}` } }),
          )
          .pipe(Effect.provideContext(owner.context));
        expect(owner.w.stats.writes).toBe(writes);
        expect(owner.w.stats.archives).toBe(archives);
        expect(owner.w.settingsReads()).toBe(reads);
        expect(db.prepare("SELECT count(*) AS n FROM entries").get()?.n).toBe(starts);
        const rows = tableCounts(db);

        if (firstInHour.has(hour)) {
          expect(rows).toEqual(firstInHour.get(hour));
        } else {
          firstInHour.set(hour, rows);
        }

        const count = (totals.get(hour) ?? 0) + 1;
        totals.set(hour, count);
        expect(
          db
            .prepare("SELECT piece,count FROM sums WHERE hour=? AND refused='reserved' ORDER BY piece")
            .all(hour)
            .map((row) => ({ ...row })),
        ).toEqual([
          { piece: "connection.frame", count },
          { piece: "runtime.rpc", count },
        ]);
      }
    }).pipe(Effect.provide(TestClock.layer())),
);

it.effect.prop(
  "T843 RPC: ordinary and parked rate refusals keep delay and bounded frame/RPC sums (50 runs)",
  {
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    retryAfter: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60_000 })),
    parked: Schema.Boolean,
  },
  ({ count, retryAfter, parked }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db);
      yield* TestClock.setTime(H + 1000);
      w.answer({ ...Answer.cases.refused.make({ reason: "rate_limited" }), retryAfter });
      yield* Effect.gen(function* () {
        const service = yield* ConnectionService;
        const startupSpans = [...w.saved];
        let first: ReturnType<typeof tableCounts> | undefined;

        for (let id = 0; id < count; id++) {
          yield* service.message(
            w.socket,
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: parked ? "ledger.wait" : "process.send",
              params: parked ? { stream: "empty", after: 0 } : {},
            }),
          );
          expect(JSON.parse(w.frames.at(-1)!)).toMatchObject({
            id,
            error: { data: { reason: "rate_limited", retryAfter } },
          });
          const counts = tableCounts(db);
          first ??= counts;
          expect(counts).toEqual(first);
          expect(w.saved).toEqual(startupSpans);
          expect(w.closes).toEqual([]);
        }

        expect(
          db
            .prepare("SELECT piece,hour,refused,count FROM sums ORDER BY piece")
            .all()
            .map((r) => ({ ...r })),
        ).toEqual([
          { piece: "connection.frame", hour: H, refused: "rate_limited", count },
          { piece: "runtime.rpc", hour: H, refused: "rate_limited", count },
        ]);
      }).pipe(Effect.provide(w.layer));
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 50 }) } },
);

it.effect.prop(
  "0140 bound A2: failed archives add no rows per reserved completion, and sums count every refusal",
  {
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
    archiveFailure: Schema.Literals(["unreachable", "mismatch"]),
  },
  ({ count, archiveFailure }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db, archiveFailure);
      yield* TestClock.setTime(H - 16 * 24 * HOUR);
      yield* Effect.gen(function* () {
        const service = yield* ConnectionService;

        const send = (id: number, params: unknown) =>
          service.message(w.socket, JSON.stringify({ jsonrpc: "2.0", id, method: "process.send", params }));

        w.answer(Answer.cases.ok.make({ result: { delivered: true } }));
        yield* send(0, {});
        yield* TestClock.setTime(H + 1000);
        // An ordinary completion tries the now-due archive before the refused calls begin.
        yield* send(1, {});
        expect(w.stats.archives).toBeGreaterThan(0);
        expect(db.prepare("SELECT * FROM archived").all()).toEqual([]);
        expect(
          db.prepare("SELECT count(*) AS n FROM measurements WHERE at < ?").get(H - 15 * 24 * HOUR)?.n,
        ).toBeGreaterThan(0);
        expect(
          db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='sink.archive' AND ok=0").get()?.n,
        ).toBeGreaterThan(0);
        w.answer(Answer.cases.refused.make({ reason: "reserved" }));
        let first: ReturnType<typeof tableCounts> | undefined;
        const saved = w.saved.length;
        const writes = w.stats.writes;

        for (let i = 0; i < count; i++) {
          yield* send(i + 2, { by: `t844-forged-${i}`, m: { _tag: "comment" } });
          expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!)).toMatchObject({
            id: i + 2,
            error: { data: { reason: "reserved" } },
          });
          const rows = tableCounts(db);
          first ??= rows;
          expect(rows).toEqual(first);
          expect(w.saved).toHaveLength(saved);
          expect(w.stats.writes).toBe(writes);
          expect(
            db
              .prepare("SELECT piece,hour,refused,count FROM sums ORDER BY piece")
              .all()
              .map((row) => ({ ...row })),
          ).toEqual([
            { piece: "connection.frame", hour: H, refused: "reserved", count: i + 1 },
            { piece: "runtime.rpc", hour: H, refused: "reserved", count: i + 1 },
          ]);
        }

        expect(w.calls).toHaveLength(count + 2);
        expect(w.closes).toEqual([]);
      }).pipe(Effect.provide(w.layer));
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 50 }) } },
);

it.effect("scenario: reserved is counted, other refusals and ok keep rpc spans, the three fixed answer shapes", () =>
  Effect.gen(function* () {
    const db = yield* database;
    const w = world(db);
    const { socket, calls, frames, saved, stats, closes } = w;
    yield* TestClock.setTime(H + 1000);
    yield* Effect.gen(function* () {
      const service = yield* ConnectionService;
      // Layer startup saves connection.wake. It is outside the three calls under test.
      const baseline = saved.length;
      const baselineWrites = stats.writes;
      const beforeMeasurements = Number(db.prepare("SELECT count(*) AS n FROM measurements").get()?.n);
      const params = { by: "t844-forged", m: { _tag: "comment" } };
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "process.send", params }));
      expect(calls).toEqual([{ method: "process.send", params }]);
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 1,
        error: { data: { reason: "reserved" } },
      });
      expect(saved.slice(baseline)).toEqual([]);
      expect(stats.writes).toBe(baselineWrites);
      expect(Number(db.prepare("SELECT count(*) AS n FROM measurements").get()?.n)).toBe(beforeMeasurements);
      expect(db.prepare("SELECT * FROM unsent").all()).toEqual([]);
      expect(
        db
          .prepare("SELECT piece,hour,refused,count FROM sums ORDER BY piece")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([
        { piece: "connection.frame", hour: H, refused: "reserved", count: 1 },
        { piece: "runtime.rpc", hour: H, refused: "reserved", count: 1 },
      ]);

      w.answer(Answer.cases.refused.make({ reason: "bad_input" }));
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "process.send", params: {} }));
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 2,
        error: { data: { reason: "bad_input" } },
      });
      w.answer(Answer.cases.ok.make({ result: { delivered: true } }));
      yield* service.message(socket, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "process.send", params: {} }));
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(frames.at(-1)!)).toMatchObject({
        id: 3,
        result: { delivered: true },
      });
      expect(calls).toHaveLength(3);
      expect(closes).toEqual([]);
      expect(saved.slice(baseline).map((row) => row.name)).toEqual([
        "runtime.rpc",
        "connection.frame",
        "runtime.rpc",
        "connection.frame",
      ]);
      expect(db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='runtime.rpc'").get()?.n).toBe(2);
      expect(db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='connection.frame'").get()?.n).toBe(2);
      expect(
        db
          .prepare("SELECT count FROM sums WHERE piece='runtime.rpc'")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([{ count: 1 }]);
      expect(
        db
          .prepare("SELECT count FROM sums WHERE piece='connection.frame'")
          .all()
          .map((row) => ({ ...row })),
      ).toEqual([{ count: 1 }]);
      yield* TestClock.setTime(H + HOUR);
    }).pipe(Effect.provide(w.layer));
  }),
);

const T864_DAY = 24 * HOUR;

const T864Draw = Schema.Struct({
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  value: Schema.Json,
});

const t864Draws = Arbitrary.array(Arbitrary.schema(T864Draw), { minLength: 4, maxLength: 12 });

const T864Due = Schema.Array(Schema.Struct({ day: Schema.String, rows: Schema.Int, part: Schema.Int }));

const t864Pending = (db: DatabaseSync) =>
  db
    .prepare("SELECT spanId FROM unsent ORDER BY rowid")
    .all()
    .map((row) => String(row.spanId));

const t864Due = (db: DatabaseSync, now: number) =>
  Schema.decodeUnknownSync(T864Due)(
    db
      .prepare(`SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day, count(*) AS rows,
      1 + coalesce((SELECT max(part) FROM archived
        WHERE day = strftime('%Y-%m-%d', measurements.at / 1000, 'unixepoch')), 0) AS part
      FROM measurements WHERE at < ? GROUP BY day ORDER BY day`)
      .all(Math.floor((now - 15 * T864_DAY) / T864_DAY) * T864_DAY),
  );

const t864Tables = (db: DatabaseSync) =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map(({ name }) => [
        name,
        db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`).all(),
      ]),
  );

const t864Delivered = Effect.gen(function* () {
  const records = yield* RecordManager;
  const spans = yield* Stream.runCollect(records.read(Chain.cases.spans.make({})));

  return Array.from(spans, (span) => span.spanId);
});

const t864Prepare = Effect.fnUntraced(function* (db: DatabaseSync, draw: typeof T864Draw.Type) {
  const now = yield* Clock.currentTimeMillis;

  if (
    !db.prepare("SELECT name FROM sqlite_schema WHERE name='unsent'").get() ||
    t864Pending(db).length === 0 ||
    t864Due(db, now).length === 0
  ) {
    for (let i = 0; i <= draw.pick % 3; i++) {
      yield* Effect.void.pipe(Effect.withSpan("t864.pending", { attributes: { value: JSON.stringify(draw.value) } }));
    }

    yield* TestClock.adjust(17 * T864_DAY + draw.pick);
    yield* Effect.void.pipe(Effect.withSpan("t864.current"));
  }

  const pending = t864Pending(db);
  const due = t864Due(db, yield* Clock.currentTimeMillis);
  expect(pending.length).toBeGreaterThan(0);
  expect(due.length).toBeGreaterThan(0);
  expect(
    db
      .prepare(`SELECT count(*) AS n FROM measurements WHERE at < ?
    AND (at / ${HOUR}) * ${HOUR} NOT IN (SELECT hour FROM aggregated)`)
      .get(Math.floor(((yield* Clock.currentTimeMillis) - 15 * T864_DAY) / T864_DAY) * T864_DAY)?.n,
  ).toBe(0);

  return { pending, due };
});

const t864Layer = (db: DatabaseSync, pick: number) =>
  Layer.mergeAll(
    SpanSink.layer(nodeSql(db), { object: "t864" }),
    RecordManager.memory(1 + (pick % 2048)),
    Archive.memory,
  );

it.effect.prop(
  "T864 reserved completion does not flush",
  { draws: t864Draws },
  ({ draws }) =>
    Effect.gen(function* () {
      const db = yield* database;
      yield* TestClock.setTime(H);
      yield* Effect.gen(function* () {
        for (const draw of draws) {
          const { pending, due } = yield* t864Prepare(db, draw);
          const tables = t864Tables(db);
          const delivered = yield* t864Delivered;
          const answer = Answer.cases.refused.make({ reason: "reserved" });
          expect(yield* Runtime.complete(Effect.succeed(answer))).toBe(answer);
          expect(t864Tables(db)).toEqual(tables);
          expect(t864Pending(db)).toEqual(pending);
          expect(t864Due(db, yield* Clock.currentTimeMillis)).toEqual(due);
          const after = yield* t864Delivered;
          expect(after).toEqual(delivered);
          expect(after).not.toContain(pending[draw.pick % pending.length]);
          expect(
            db
              .prepare("SELECT * FROM archived WHERE day=? AND part=?")
              .get(due[draw.pick % due.length]!.day, due[draw.pick % due.length]!.part),
          ).toBeUndefined();
        }
      }).pipe(Effect.provide(t864Layer(db, draws[0]!.pick)));
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 50 }) } },
);

it.effect.prop(
  "T864 ordinary success and failure both flush",
  { draws: t864Draws },
  ({ draws }) =>
    Effect.gen(function* () {
      const db = yield* database;
      yield* TestClock.setTime(H);
      yield* Effect.gen(function* () {
        const counts = { success: 0, failure: 0 };

        for (const draw of draws) {
          const { pending, due } = yield* t864Prepare(db, draw);
          const unvisited = (["success", "failure"] as const).filter((outcome) => counts[outcome] === 0);
          const choices = unvisited.length > 0 ? unvisited : (["success", "failure"] as const);
          const outcome = choices[draw.pick % choices.length]!;
          const answer = Answer.cases.ok.make({ result: draw.value });
          const failure = new LedgerError({ reason: "unreachable" });

          const exit = yield* Effect.exit(
            Runtime.complete(outcome === "success" ? Effect.succeed(answer) : Effect.fail(failure)),
          );

          const delivered = yield* t864Delivered;

          for (const id of pending) {
            expect(delivered, "complete delivers each pending span").toContain(id);
            expect(t864Pending(db)).not.toContain(id);
          }

          for (const day of due) {
            expect(db.prepare("SELECT * FROM archived WHERE day=? AND part=?").get(day.day, day.part)).toMatchObject({
              ...day,
              key: expect.stringContaining(`measurements/t864/${day.day}`),
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            });
            expect(
              db
                .prepare("SELECT count(*) AS n FROM measurements WHERE strftime('%Y-%m-%d', at / 1000, 'unixepoch')=?")
                .get(day.day)?.n,
            ).toBe(0);
          }

          expect(t864Due(db, yield* Clock.currentTimeMillis)).toEqual([]);
          expect(
            db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='sink.archive' AND ok=1").get()?.n,
          ).toBeGreaterThan(0);

          if (outcome === "success") {
            expect(Exit.isSuccess(exit)).toBe(true);

            if (Exit.isSuccess(exit)) {
              expect(exit.value).toBe(answer);
            }
          } else {
            expect(Exit.isFailure(exit)).toBe(true);

            if (Exit.isFailure(exit)) {
              expect(Cause.squash(exit.cause)).toBe(failure);
            }
          }

          counts[outcome]++;
        }

        expect(counts.success).toBeGreaterThan(0);
        expect(counts.failure).toBeGreaterThan(0);
        expect(counts.success + counts.failure).toBe(draws.length);
      }).pipe(Effect.provide(t864Layer(db, draws[0]!.pick)));
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 50 }) } },
);

/** Enough calls to reach every answer category once, then to fill the waits with one more full one. */
const AnswerWalk = Schema.Struct({
  count: Schema.Int.check(Schema.isBetween({ minimum: 6, maximum: 20 })),
  seed: Schema.Int,
});

const EarlyFrameWalk = Schema.Struct({
  fresh: Attached.cases.new,
  waiting: Attached.cases.waiting,
  count: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 8 })),
  seed: Schema.Int,
});

const answerCases = {
  ok: Answer.cases.ok,
  parked: Answer.cases.parked,
  parked_full: Answer.cases.parked,
  reserved: Answer.cases.refused.mapFields((fields) => ({ ...fields, reason: Schema.Literal("reserved") })),
  bad_input: Answer.cases.refused.mapFields((fields) => ({ ...fields, reason: Schema.Literal("bad_input") })),
};

const answerCategories = ["ok", "parked", "parked_full", "reserved", "bad_input"] as const;

/**
 * The limits a connection keeps waits under, as `transport/Connection.ts` states them: 64 waits,
 * and 16,384 bytes of saved attachment as UTF-8 JSON. L1 keeps its own count against them.
 */
const MAX_WAITS = 64;

const MAX_BYTES = 16_384;

/** A parked answer whose stream is this long fits once, and two of them never fit. */
const FULL = 9_000;

const sample = Effect.fnUntraced(function* <S extends Schema.Constraint>(schema: S, seed: number) {
  return (yield* Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }))[0]!;
});

const readAttachment = (w: ReturnType<typeof world>) =>
  Schema.decodeUnknownSync(Attached)(w.socket.deserializeAttachment());

const ordinaryFrame = Effect.fnUntraced(function* (state: typeof Attached.Type, seed: number, index: number) {
  const input = yield* sample(Schema.Struct({ id: Schema.String, params: Schema.Json }), seed);

  return {
    jsonrpc: "2.0",
    id: `${state.client}:${index}:${input.id}`,
    method: "process.send",
    params: { state: state._tag, value: input.params },
  };
});

const observeRpc = Effect.fnUntraced(function* (spans: Array<Tracer.Span>) {
  const make = ProjectClient.make;
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vi.spyOn(ProjectClient, "make").mockImplementation((stub) => {
        const client = make(stub);

        return {
          ...client,
          route: (...args) =>
            Effect.gen(function* () {
              spans.push(yield* Effect.currentSpan.pipe(Effect.orDie));

              return yield* client.route(...args);
            }),
        };
      }),
    ),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );
});

const recordingSnapshot = (db: DatabaseSync, w: ReturnType<typeof world>) => ({
  tables: tableCounts(db),
  saved: [...w.saved],
  writes: w.stats.writes,
  archives: w.stats.archives,
});

it.effect.prop(
  "t863 L1: only reserved answers tag the ended RPC span as refused",
  { walk: AnswerWalk },
  ({ walk }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db);
      const spans: Array<Tracer.Span> = [];
      yield* observeRpc(spans);
      yield* TestClock.setTime(H + 1000);
      yield* Effect.gen(function* () {
        const service = yield* ConnectionService;
        const reached = new Set<keyof typeof answerCases | "too_many_waits">();
        // The law's own model of the waits it parked on this connection, never the product's: the
        // world's attachment before any call, and each wait L1 expects kept since.
        const start = readAttachment(w);
        const kept: Array<typeof Wait.Type> = [];

        // A wait is saved while the call is out, so the attachment it must fit in is marked busy.
        const fits = (wait: typeof Wait.Type) =>
          kept.length + 1 <= MAX_WAITS &&
          new TextEncoder().encode(JSON.stringify({ ...start, waits: [...kept, wait], busy: true })).length <=
            MAX_BYTES;

        for (let i = 0; i < walk.count; i++) {
          const state = readAttachment(w);
          expect(state._tag).toBe("online");
          const remaining = answerCategories.filter((key) => !reached.has(key));

          // Every category once, then a full wait until one has no room left.
          const category: keyof typeof answerCases =
            remaining.length === 0 && !reached.has("too_many_waits")
              ? "parked_full"
              : yield* sample(Schema.Literals(remaining.length > 0 ? remaining : answerCategories), walk.seed + i * 3);

          const sampled = yield* sample(answerCases[category], walk.seed + i * 3 + 1);

          const answer =
            category === "parked_full" && sampled._tag === "parked"
              ? { ...sampled, stream: sampled.stream.padEnd(FULL, "s") }
              : sampled;

          const request = yield* ordinaryFrame(state, walk.seed + i * 3 + 2, i);
          w.answer(answer);
          const replies = w.frames.length;
          const before = w.calls.length;
          const wait = answer._tag === "parked" ? { id: request.id, stream: answer.stream, after: answer.after } : null;
          const keeps = wait !== null && fits(wait);
          yield* service.message(w.socket, JSON.stringify(request));

          // Under the limits, a call answered parked is kept as a wait on the stream the answer
          // names and registered again through the wait path, as a parked ledger.wait is (P39 slice
          // 4a): one more routed call. At them, it is refused `too_many_waits` and nothing more.
          const again =
            wait === null || !keeps
              ? []
              : [
                  wait.stream.startsWith(targetStream(""))
                    ? { method: "tasks.wait", params: { after: wait.after } }
                    : { method: "ledger.wait", params: { stream: wait.stream, after: wait.after } },
                ];

          expect(w.calls.slice(before)).toEqual([{ method: request.method, params: request.params }, ...again]);
          expect(spans).toHaveLength(w.calls.length);

          for (const [n, span] of spans.slice(before).entries()) {
            const refused = n === 0 && category === "reserved";
            expect(span.name).toBe("runtime.rpc");
            expect(span.status._tag).toBe("Ended");
            expect(span.attributes.has(Trace.REFUSED)).toBe(refused);
            expect(span.attributes.get(Trace.REFUSED)).toBe(refused ? "reserved" : undefined);
          }

          if (wait !== null && keeps) {
            kept.push(wait);
            expect(w.frames, "a parked call with room gets no reply yet").toHaveLength(replies);
          } else {
            expect(w.frames).toHaveLength(replies + 1);
            const reply = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!);
            expect(reply).toMatchObject(
              answer._tag === "ok"
                ? { id: request.id, result: answer.result }
                : {
                    id: request.id,
                    error: { data: { reason: answer._tag === "parked" ? "too_many_waits" : answer.reason } },
                  },
            );

            if (answer._tag === "parked") {
              reached.add("too_many_waits");
            }
          }

          const after = readAttachment(w);
          expect(after._tag).toBe("online");
          // The product keeps exactly the waits the law's own count says it must.
          expect("waits" in after ? after.waits : null, "the waits kept are the ones with room").toEqual(kept);
          reached.add(category);
        }

        expect([...reached].sort()).toEqual([...Object.keys(answerCases), "too_many_waits"].sort());
      }).pipe(Effect.provide(w.layer));
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 50 }) } },
);

it.effect.prop(
  "t863 L2: new and waiting frames leave all recording unchanged until online",
  { walk: EarlyFrameWalk },
  ({ walk }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const initial of [walk.fresh, walk.waiting]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const db = yield* database;
            const w = world(db);
            const online = readAttachment(w);
            w.socket.serializeAttachment(initial);
            yield* TestClock.setTime(H + 1000);
            yield* Effect.gen(function* () {
              const service = yield* ConnectionService;
              const baseline = recordingSnapshot(db, w);

              for (let i = 0; i < walk.count; i++) {
                const state = readAttachment(w);
                expect(state._tag).toBe(initial._tag);
                const request = yield* ordinaryFrame(state, walk.seed + i, i);
                const replies = w.frames.length;
                yield* service.message(w.socket, JSON.stringify(request));
                expect(w.frames).toHaveLength(replies + 1);
                expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!)).toMatchObject({
                  id: request.id,
                  error: { data: { reason: "no_hello" } },
                });
                expect(w.calls).toEqual([]);
                expect(readAttachment(w)).toEqual(state);
                expect(recordingSnapshot(db, w)).toEqual(baseline);
                reached.add(state._tag);
              }

              w.socket.serializeAttachment(online);
              const state = readAttachment(w);
              const answer = yield* sample(Answer.cases.ok, walk.seed + walk.count);
              const request = yield* ordinaryFrame(state, walk.seed + walk.count + 1, walk.count);
              w.answer(answer);
              yield* service.message(w.socket, JSON.stringify(request));
              expect(w.calls).toEqual([{ method: request.method, params: request.params }]);
              expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!)).toMatchObject({
                id: request.id,
                result: answer.result,
              });
              expect(w.saved.slice(baseline.saved.length).map((span) => span.name)).toContain("runtime.rpc");
              expect(w.stats.writes).toBeGreaterThan(baseline.writes);
              expect(tableCounts(db)).not.toEqual(baseline.tables);
            }).pipe(Effect.provide(w.layer));
          }),
        );
      }

      expect([...reached].sort()).toEqual(["new", "waiting"]);
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 50 }) } },
);

// The codes a peer's close arrives with: the ones a browser really reports (1001 on leaving a page,
// 1005 for a frame with no code, 1006 for a socket that dropped), any code an app may send, and any
// 16-bit number at all.
const PeerClose = Schema.Union([
  Schema.Literals([1000, 1001, 1005, 1006, 1011]),
  Schema.Int.check(Schema.isBetween({ minimum: 3000, maximum: 4999 })),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65_535 })),
]);

it.effect.prop(
  "T828 L25: a peer's close frame is answered once, with its own code when a frame may carry it and 1000 when not, and the connection leaves even when the socket is already gone (200 runs)",
  { code: PeerClose, gone: Schema.Boolean },
  ({ code, gone }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db);

      if (gone) {
        w.lose();
      }

      yield* ConnectionService.use((service) => service.close(w.socket, code)).pipe(Effect.provide(w.layer));
      // Without this answer a browser keeps its socket closing for 10 s and then reports 1006.
      expect(w.closes, "one close frame back, never a code the socket refuses").toEqual(
        gone ? [] : [sendable(code) ? code : 1000],
      );
      expect(w.left, "the connection leaves and is disconnected once").toEqual([
        "leave test-client",
        "disconnect test-client",
      ]);
      expect(w.frames, "a close is answered by a close frame, never a message").toEqual([]);
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 20, full: 200 }) } },
);

const Rev = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }));

it.effect.prop(
  "P39 4a W2: a hands key's tasks.wait names this connection object as the one its ring reaches, for the first parked wait and for each wait asked again after a ring that does not pass it",
  { after: Rev, rings: Schema.Array(Rev).check(Schema.isMaxLength(6)) },
  ({ after, rings }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db);
      const stream = targetStream("test-key");
      yield* TestClock.setTime(H + 1000);
      w.answer(Answer.cases.parked.make({ stream, after }));
      yield* Effect.gen(function* () {
        const service = yield* ConnectionService;
        yield* service.message(
          w.socket,
          JSON.stringify({ jsonrpc: "2.0", id: "j1.1", method: "tasks.wait", params: { after } }),
        );

        // Rings at or before `after` do not pass the wait: each asks the door again.
        for (const rev of rings) {
          yield* service.ring(stream, Math.min(rev, after));
        }

        const waits = w.readers.filter((r) => r.method === "tasks.wait");
        // The frame is routed once, and its parked answer is registered once, then once per ring.
        expect(waits).toHaveLength(2 + rings.length);
        // The referee rings the object a wait names (runtime.ts, CONNECTION.getByName), and the
        // hands' socket lives on this one (fetch.ts, by its URL path).
        expect(
          waits.map((r) => r.reader),
          "every tasks.wait rings this object",
        ).toEqual(waits.map(() => "test-connection"));
        expect(w.frames, "a parked wait answers nothing yet").toEqual([]);

        // A ring past `after` answers the parked call on this socket.
        yield* service.ring(stream, after + 1);
        expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(w.frames.at(-1)!)).toMatchObject({
          id: "j1.1",
          result: { rev: after + 1 },
        });
      }).pipe(Effect.provide(w.layer));
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 60 }) } },
);

// Ticket 1053 slice 1, next/: L2, L8 and L9 of the plan (docs/plan/quests/t1053-PLAN.md), written
// before the build. What a client's socket is told is one Schema, `News` (runtime/News.ts), and the
// Connection object's `notify` is its door: it decodes the value once and tells the cases apart
// once.
//
// The contract these laws pin, in cloudflare/connection.ts:
//   `notify(client, news)` decodes `news` as `News`, and fails with `LedgerError` `bad_row` when it
//     is not one, with nothing sent and nothing closed
//   `close`   closes each of the client's sockets with its code, and sends nothing
//   `granted` sends `{"jsonrpc":"2.0","method":"client.granted","params":{"nonce"}}`
//   `view`    sends method `view.whole` or `view.patch`, by the update's `type`, with the update as
//             its params, pid included
//   the `connection.notify` span carries `fab.gateway.news`, the name of the case
// and in cloudflare/runtime.ts: the Project's `publish` decodes its update as `Published` and fails
// the same way when it is not one.
//
// Generator contract: every run draws one news of each case from the case's own Schema, and one
// update of each `type`, so each case reaches the door in every run and none can go unreached.
const anyPublished = Arbitrary.schema(Published);

const EachNews = {
  close: News.cases.close,
  granted: News.cases.granted,
  whole: anyPublished.pipe(Arbitrary.filter((u) => u.type === "whole")),
  patch: anyPublished.pipe(Arbitrary.filter((u) => u.type === "patch")),
};

/** A frame's text as the JSON value a client reads. */
const read = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
/** A value as it is once it has been a frame: what `JSON.stringify` keeps of it. */
const wired = (value: unknown) => read(JSON.stringify(value));

/**
 * The door as another object's call reaches it. The type says `News`, and the platform's RPC hands
 * over whatever the caller sent: a caller on an older build sends an older shape.
 */
const overWire = (service: ConnectionService["Service"], client: string, news: unknown) =>
  // SAFETY: the law hands the door a value that may not be News on purpose, as an RPC from an object
  // on another build may; the door decodes it and must refuse it.
  service.notify(client, news as News);

/** One Connection object with the test client's socket and another client's, told one news. */
const told = Effect.fnUntraced(function* (news: unknown) {
  const db = yield* database;
  const w = world(db);
  yield* TestClock.setTime(H + 1000);
  const context = yield* Layer.build(w.layer);
  const other = w.join("other-client");
  const before = w.saved.length;
  const exit = yield* Effect.exit(overWire(Context.get(context, ConnectionService), "test-client", news));
  return { w, other, exit, spans: w.saved.slice(before).filter((row) => row.name === "connection.notify") };
});

// Plant: send a patch as `view.whole`.
it.effect.prop(
  "L2: the frame a socket is sent is today's wire JSON: granted is client.granted with params holding only the nonce, a whole view is view.whole and a patch is view.patch, each with params equal to the update, pid included",
  EachNews,
  ({ granted, whole, patch }) =>
    Effect.gen(function* () {
      const frames = new Array<Schema.Json>();

      for (const news of [granted, ...[whole, patch].map((update) => News.cases.view.make({ update }))]) {
        const { w, exit } = yield* told(news);
        expect(Exit.isSuccess(exit), "a News is taken").toBe(true);
        expect(w.frames, "one frame for one news").toHaveLength(1);
        frames.push(read(w.frames[0]!));
      }

      expect(frames).toEqual([
        { jsonrpc: "2.0", method: "client.granted", params: { nonce: granted.nonce } },
        wired({ jsonrpc: "2.0", method: "view.whole", params: whole }),
        wired({ jsonrpc: "2.0", method: "view.patch", params: patch }),
      ]);
      // The pid is on the wire: a client finds the tile an update belongs to by it.
      expect(frames.slice(1)).toMatchObject([{ params: { pid: whole.pid } }, { params: { pid: patch.pid } }]);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }) } },
);

// Plant: send a frame for a `close` too.
it.effect.prop(
  "L8: a close closes the client's sockets with its code and sends nothing, any other news sends exactly one text frame and closes nothing, another client's socket gets nothing, and the span carries fab.gateway.news with the case",
  EachNews,
  ({ close, granted, whole, patch }) =>
    Effect.gen(function* () {
      const closed = yield* told(close);
      expect(Exit.isSuccess(closed.exit), "a close is taken").toBe(true);
      expect(closed.w.closes, "the client's socket is closed with the news's code").toEqual([close.code]);
      expect(closed.w.frames, "a close sends no frame").toEqual([]);
      expect([closed.other.frames, closed.other.closes], "another client's socket is left alone").toEqual([[], []]);
      expect(
        closed.spans.map((row) => row.attributes["fab.gateway.news"]),
        "the span names the case",
      ).toEqual([close._tag]);

      for (const news of [granted, ...[whole, patch].map((update) => News.cases.view.make({ update }))]) {
        const sent = yield* told(news);
        expect(Exit.isSuccess(sent.exit), "a News is taken").toBe(true);
        expect(sent.w.frames, "exactly one frame").toHaveLength(1);
        expect(typeof sent.w.frames[0], "a text frame").toBe("string");
        expect(sent.w.closes, "nothing is closed").toEqual([]);
        expect([sent.other.frames, sent.other.closes], "another client's socket is left alone").toEqual([[], []]);
        expect(
          sent.spans.map((row) => row.attributes["fab.gateway.news"]),
          "the span names the case",
        ).toEqual([news._tag]);
      }
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 50 }) } },
);

/** No Schema.Json value: what a field holds once a caller got its type wrong. */
const WRONG = 1n;

/**
 * Every way to break one field of a value: each of its fields removed, and each one holding the
 * wrong type. Every field of News, Published and Update is required, so none of these is the value's
 * Schema any more, whatever the Schema says: a law refuses all of them without asking it.
 */
const damaged = (value: object): Array<object> => {
  const fields = Object.entries(value);
  return fields.flatMap(([name]) =>
    (["removed", "retyped"] as const).map((mode) =>
      Object.fromEntries(
        fields.flatMap(([key, held]) => (key !== name ? [[key, held]] : mode === "removed" ? [] : [[key, WRONG]])),
      ),
    ),
  );
};

/** How many broken values `damaged` makes of a value: two per field. */
const damages = (...values: Array<object>) => values.reduce((sum, value) => sum + 2 * Object.keys(value).length, 0);

/**
 * Close codes no News may carry, one of each kind in every run: a whole number below 4000, one above
 * 4999, and a number between them that is not whole.
 */
const BadCodes = {
  below: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3999 })),
  above: Schema.Int.check(Schema.isBetween({ minimum: 5000, maximum: 65_535 })),
  fraction: Schema.Number.check(
    Schema.isBetween({ minimum: 4000.25, maximum: 4999.75 }),
    Schema.makeFilter((n) => !Number.isInteger(n)),
  ),
};

// Plant: forward the raw value when the decode fails.
it.effect.prop(
  "L9: a value that is not News fails the Connection's notify with LedgerError bad_row, and nothing is sent or closed on any socket",
  { ...EachNews, ...BadCodes, json: Schema.Json },
  ({ close, granted, whole, patch, below, above, fraction, json }) =>
    Effect.gen(function* () {
      const views = [whole, patch].map((update) => News.cases.view.make({ update }));
      const made = [
        // A News with each field removed or retyped in turn, its tag included.
        ...[close, granted, ...views].flatMap(damaged),
        // A view whose update has each field removed or retyped in turn. Its pid removed is the update
        // a watcher is sent, before the Project adds one.
        ...[whole, patch].flatMap((update) => damaged(update).map((broken) => ({ ...views[0]!, update: broken }))),
        // A close whose code no app may send.
        ...[below, above, fraction].map((code) => ({ ...close, code })),
        // A value that holds what the old door read by hand.
        { close: close.code },
        { method: "client.granted", params: { nonce: granted.nonce } },
      ];
      expect(made, "every broken field, the three codes and the two old shapes are reached").toHaveLength(
        damages(close, granted, ...views, whole, patch) + 5,
      );
      // Only the freely drawn JSON is asked whether it happens to be News: every other value is no
      // News by construction, so a loosened Schema cannot drop one.
      const bad = Schema.is(News)(json) ? made : [json, ...made];

      for (const value of bad) {
        const { w, other, exit, spans } = yield* told(value);
        const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
        expect(Option.getOrNull(failure), "the door refuses it as a bad row").toBeInstanceOf(LedgerError);
        expect(Option.getOrNull(failure)).toMatchObject({ reason: "bad_row" });
        expect([w.frames, w.closes, other.frames, other.closes], "nothing is sent or closed").toEqual([[], [], [], []]);
        expect(
          spans.map((row) => row.ok),
          "the refused notify is a failed span",
        ).toEqual([false]);
      }
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 50 }) } },
);

/**
 * One booted Project over in-memory SQLite, as the Process object reaches it. Only the platform's
 * handles are doubles: the Connection binding keeps each `notify` the Project makes, and the door
 * is not under test, so the Project boots with no program and no door call.
 */
const PROGRAM = "fabrika/counter";
/** The program as Worker Loader would run it. */
const SOURCE = "export default {};\n";

/** The boot list's one program, as leave.laws.test.ts declares it: a boot needs one entry. */
const declaration = () => {
  const machine = Machine.make({
    model: Schema.Struct({ count: Schema.Int }),
    msg: Schema.Struct({ type: Schema.Literal("inc") }),
    cmds: [],
    init: (kept) => [kept ?? { count: 0 }, []],
    update: { inc: (s) => [{ count: s.count + 1 }, []] },
  });
  const program = Program.make({
    name: PROGRAM,
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { inc: "Add" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
  return ProgramLoader.use((loader) => loader.load(PROGRAM)).pipe(
    Effect.provide(ProgramLoader.layer<never>({ [PROGRAM]: program }, {})),
    Effect.map((loaded) => loaded.declaration),
  );
};

const project = Effect.fnUntraced(function* () {
  const db = yield* database;
  const sql = nodeSql(db);
  const values = new Map<string, unknown>();
  const start = StartsTest.fixture(
    {
      name: "project-test",
      person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
      // A public key line made from 32 fixed bytes: no private key exists for it.
      founder: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH",
      window: null,
      port: 18787,
      build: "brain-build-test",
    },
    (algorithm, data) => createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );
  const notified: Array<{ connection: string; client: string; news: unknown }> = [];
  const descriptors = new Map<string, Pick<Descriptor, "id" | "name" | "build" | "program">>();
  const ctx = fake<DurableObjectState>({
    id: { name: "project-test" },
    storage: {
      sql: {
        exec: sql.exec,
        get databaseSize() {
          return sql.size();
        },
      },
      transactionSync: sql.transaction,
      // edge: the platform's key-value storage answers through a Promise
      get: (key: string) => Promise.resolve(values.get(key)),
      put: (key: string, value: unknown) => {
        values.set(key, value);
        // edge: the platform's key-value storage answers through a Promise
        return Promise.resolve();
      },
    },
    exports: { IsolateTail: () => ({ fetch: () => Promise.resolve(new Response()) }) },
  });
  const env = fake<Env>({
    INSTANCE: JSON.stringify(start),
    PROJECT: { getByName: () => ({}) },
    PROCESS: {
      getByName: (key: string) => ({
        configure: (d: Pick<Descriptor, "id" | "name" | "build" | "program">) => {
          descriptors.set(key, d);
          // edge: the platform RPC returns a Promise
          return Promise.resolve();
        },
        descriptor: (pid?: string) => {
          const d = descriptors.get(key)!;
          // edge: the platform RPC returns a Promise
          return Promise.resolve({ ...d, id: pid ?? d.id });
        },
      }),
    },
    CONNECTION: {
      getByName: (connection: string) => ({
        notify: (client: string, news: unknown) => {
          notified.push({ connection, client, news });
          // edge: the platform RPC returns a Promise
          return Promise.resolve();
        },
      }),
    },
    RECORD: { getByName: () => ({ write: () => Promise.resolve(Written.cases.written.make({})) }) },
    MEASUREMENTS: {},
    LOADER: { get: () => ({ getEntrypoint: () => ({ describe: () => Effect.runPromise(declaration()) }) }) },
  });
  const context = yield* Layer.build(
    Runtime.projectLayer(ctx, env, {
      programs: { [PROGRAM]: { hash: yield* hash(SOURCE), source: SOURCE } },
      bootstrap: [{ name: "counter:1", id: "counter:1", program: PROGRAM }],
      door: () => Effect.succeed(fake<GatewayCalls>({ retire: () => Effect.void })),
    }),
  );
  return { service: Context.get(context, Runtime.ProjectService), notified };
});

/**
 * The Project's `publish` as the Process object's call reaches it: the type says `Published`, and
 * the platform's RPC hands over whatever the caller sent.
 */
const publishOverWire = (service: Runtime.ProjectService["Service"], client: string, update: unknown) =>
  // SAFETY: the law hands the Project a value that may not be Published on purpose, as an RPC from a
  // Process object on another build may; the Project decodes it and must refuse it.
  service.publish(client, update as Published);

// Plant: forward the raw value when the decode fails.
it.live.prop(
  "L9: a value that is not Published fails the Project's publish with LedgerError bad_row and no Connection object is told, while a Published reaches the client's Connection object as one view news",
  { whole: EachNews.whole, patch: EachNews.patch, json: Schema.Json, granted: News.cases.granted },
  ({ whole, patch, json, granted }) =>
    Effect.gen(function* () {
      const { service, notified } = yield* project();
      yield* service.register("test-client", "test-connection", "test-session");
      const made = [
        // An update with each field removed or retyped in turn. Its pid removed is the update a
        // watcher is sent: the Project is handed it with one.
        ...[whole, patch].flatMap(damaged),
        // A News is not a view update: only `notify` carries one.
        granted,
        News.cases.view.make({ update: whole }),
        // What the old `publish` passed on by hand.
        { method: "client.granted", params: { nonce: granted.nonce } },
      ];
      expect(made, "every broken field and the three other shapes are reached").toHaveLength(damages(whole, patch) + 3);
      // Only the freely drawn JSON is asked whether it happens to be Published: every other value is
      // no Published by construction, so a loosened Schema cannot drop one.
      const bad = Schema.is(Published)(json) ? made : [json, ...made];

      for (const value of bad) {
        const exit = yield* Effect.exit(publishOverWire(service, "test-client", value));
        const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
        expect(Option.getOrNull(failure), "the Project refuses it as a bad row").toBeInstanceOf(LedgerError);
        expect(Option.getOrNull(failure)).toMatchObject({ reason: "bad_row" });
        expect(notified, "no Connection object is told").toEqual([]);
      }

      // The route is live: the same call with a Published is sent on, so the refusals above are the decode's.
      for (const update of [whole, patch]) {
        notified.length = 0;
        expect(yield* service.publish("test-client", update)).toEqual(Publication.cases.sent.make({}));
        expect(notified).toEqual([
          { connection: "test-connection", client: "test-client", news: News.cases.view.make({ update }) },
        ]);
      }
    }).pipe(Effect.scoped),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 50 }) } },
);

// The plan's gap, named in the tests step's report: the waiting room's notice. A knock the door
// answers `ok` is told `gateway.waiting` today by handing `{ method, params }` to the Project's
// `publish` (cloudflare/connection.ts, the `gateway.knock` branch), which now takes only a
// `Published`. The wire stays as it is: the knocking socket is sent the notice, and `publish` is
// handed nothing that is not a view update.
//
// Generator contract: the label, the code and the time are drawn from their Schemas in every run.
// Plant: drop the waiting notice from the knock branch.
it.effect.prop(
  "L10: a knock the door lets wait sends the knocking socket gateway.waiting with params holding its code and until, beside the answer, and hands the Project's publish no value that is not a view update",
  {
    label: Schema.String,
    code: Schema.String,
    until: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4_102_444_800_000 })),
  },
  ({ label, code, until }) =>
    Effect.gen(function* () {
      const db = yield* database;
      const w = world(db);
      yield* TestClock.setTime(H + 1000);
      const service = Context.get(yield* Layer.build(w.layer), ConnectionService);
      w.answer(Answer.cases.ok.make({ result: { code, until } }));
      yield* service.message(
        w.socket,
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gateway.knock", params: { label } }),
      );
      const frames = w.frames.map((frame) => read(frame));
      expect(frames, "the waiting notice, once, as today's wire JSON").toContainEqual({
        jsonrpc: "2.0",
        method: "gateway.waiting",
        params: { code, until },
      });
      expect(
        frames.filter(Schema.is(Schema.Struct({ method: Schema.Literal("gateway.waiting") }))),
        "once",
      ).toHaveLength(1);
      expect(frames, "the knock is answered with the same code and time").toContainEqual(
        expect.objectContaining({ id: 1, result: { code, until } }),
      );
      expect(
        w.published.filter((one) => !Schema.is(Published)(one.update)),
        "publish carries only view updates",
      ).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }) } },
);

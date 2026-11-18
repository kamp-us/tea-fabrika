// L15 / ticket 1163, next/. A knock that lands after a grant's drain is woken by `granted` news.
// These laws live beside door-spans.test.ts and not in libfabrika's gateway/: a gateway/ file may not
// import ledger/ (0043, rule 11; next-ledger.json only shrinks), and the world needs its SQL layers.
// The gateway runs on an in-memory SQLite, a stand-in, so they run on every pull request. The world
// is the shape of libfabrika's `GatewayRevocation.integration.test.ts` `world()`, without its file.
//
// The bug: a tab's hello reads the members and is refused, a grant applies and drains the waiting
// rows, and only then does the tab's knock write a fresh row for a key that is already granted.
// Nothing wakes that tab. The fix registers the row first and then checks the members, on both sides.
//
// Plants, each run once and not kept:
// - W1: the knock never checks the members after it writes its row (today's code). The order
//   hello(A), grant, knock(A) leaves A with no `granted` news.
// - W2: a release that notifies the rows it found and takes them afterwards, so the knock's and the
//   grant's releases both reach one row. A client of it is told twice.
// - W2, held read: a knock that reads the members before it writes its row (check, then register).
//   A knock held right after that read, until the grant has drained, then writes a row nobody wakes.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import * as ClientManagerLedger from "@kampus/libfabrika/access/ClientManagerLedger";
import { grantText } from "@kampus/libfabrika/access/Text";
import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { Doorbell, Ledger } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { MailWakeups } from "@kampus/libfabrika/runtime/MailWakeups";
import type { News } from "@kampus/libfabrika/runtime/News";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Tasks } from "@kampus/libfabrika/tasks/Tasks";
import { Archive } from "@kampus/libfabrika/telemetry/Archive";
import { RecordManager } from "@kampus/libfabrika/telemetry/Records";
import { SpanSink } from "@kampus/libfabrika/telemetry/Sink";
import * as SshsigTest from "@kampus/libfabrika/transport/Sshsig.test-support";
import { runsFor } from "@kampus/vitest";
import { Array as Arr, Context, Deferred, Effect, Layer, Order, Schema, Stream } from "effect";
import { RateLimiter } from "effect/persistence";
import { Gateway } from "./door.ts";

const url = "https://fabrika.test/entry/l15",
  sentAt = "2026-11-18T04:00:00.000Z",
  person = "person_01m6v5270hf3c8x2q7w9z4k5mn",
  process = "process_01m6v5270hetdrt4r8h9vvjwjs";

const checks = { arbitrary: { seed: 119120, runs: runsFor({ fast: 100, full: 100 }) } };

/**
 * Three clients. A and B are two tabs of one key that a person grants; C is a tab of a key that is
 * never granted, so a grant must neither wake it nor take its row.
 */
type Peer = "A" | "B" | "C";

type Step =
  | { readonly move: "hello"; readonly peer: Peer }
  | { readonly move: "knock"; readonly peer: Peer }
  | { readonly move: "grant"; readonly peer: null };

const steps: ReadonlyArray<Step> = [
  { move: "hello", peer: "A" },
  { move: "knock", peer: "A" },
  { move: "hello", peer: "B" },
  { move: "knock", peer: "B" },
  { move: "hello", peer: "C" },
  { move: "knock", peer: "C" },
  { move: "grant", peer: null },
];

const named = (step: Step) => `${step.move}(${step.peer ?? "key"})`;

/** One generated draw per step: where it sorts, and whether the order holds it at all. */
const Draw = Schema.Struct({
  rank: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
  keep: Schema.Boolean,
});

const draws = Schema.Array(Draw).check(Schema.isMinLength(steps.length), Schema.isMaxLength(steps.length));

/**
 * Some of the steps in the order the draws sort them, with the grant always in, repaired so each
 * knock comes after its own hello: a knock whose hello is missing or later gets that hello put right
 * before it.
 */
const ordered = (drawn: ReadonlyArray<typeof Draw.Type>): ReadonlyArray<Step> => {
  const chosen = Arr.sort(
    Arr.filter(
      Arr.map(steps, (step, index) => ({
        step,
        rank: drawn[index]?.rank ?? 0,
        index,
        keep: drawn[index]?.keep ?? true,
      })),
      (entry) => entry.keep || entry.step.move === "grant",
    ),
    Order.combine(
      Order.mapInput(Order.Number, (entry: { rank: number; index: number }) => entry.rank),
      Order.mapInput(Order.Number, (entry) => entry.index),
    ),
  );

  const said = new Set<Peer>(),
    repaired: Array<Step> = [];

  for (const { step } of chosen) {
    if (step.peer === null) {
      repaired.push(step);
    } else if (step.move === "hello") {
      if (!said.has(step.peer)) {
        said.add(step.peer);
        repaired.push(step);
      }
    } else {
      if (!said.has(step.peer)) {
        said.add(step.peer);
        repaired.push({ move: "hello", peer: step.peer });
      }

      repaired.push(step);
    }
  }

  return repaired;
};

/** How many times each read of the membership stream yields, in the order the reads happen. */
const pauses = Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))).check(
  Schema.isMinLength(12),
  Schema.isMaxLength(24),
);

/**
 * One draw per client for a race: whether its knock waits for the grant to be applied, how many
 * times it yields before it knocks, and whether its read of the members is held, right after the
 * read returns, until the grant has finished its drain.
 */
const Lag = Schema.Struct({
  late: Schema.Boolean,
  wait: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 12 })),
  held: Schema.Boolean,
});

const lags = Schema.Array(Lag).check(Schema.isMinLength(3), Schema.isMaxLength(3));

/**
 * The gate a fiber's reads of the membership stream wait at, once each read has returned. Only the
 * fiber that `act` set it on is held; every other fiber reads straight through.
 */
const Hold = Context.Reference<Deferred.Deferred<void> | null>("@kampus/fabrika/door-waiting.Hold", {
  defaultValue: () => null,
});

const world = Effect.fnUntraced(function* (gaps: ReadonlyArray<number>, reached: Set<string>) {
  const root = yield* SshsigTest.identity,
    window = yield* SshsigTest.identity,
    granted = yield* SshsigTest.identity,
    bystander = yield* SshsigTest.identity;

  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (opened) => Effect.sync(() => opened.close()),
  );

  const sql = nodeSql(db);
  const notices: Array<{ readonly client: string; readonly news: News }> = [];

  const founder = {
    name: "L15",
    person,
    keys: [root.line],
    window: window.raw,
    by: root.sshFingerprint,
    build: "test",
  };

  // Opens when a membership write lands while the grant runs: from then on the grant is applied and
  // has not drained yet, the window a knock can fall into.
  const applied = yield* Deferred.make<void>();
  const granting = { now: false };
  // Opens when the grant has returned, its drain included: what a held read waits for.
  const drained = yield* Deferred.make<void>();

  const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

  // Every read of the membership stream yields before and after it, a generated number of times, so
  // a hello, a knock and a grant meet at the points where each looks at peer is a member.
  let reads = 0;

  const gap = Effect.suspend(() => {
    const times = gaps[reads++ % gaps.length] ?? 0;

    return Effect.forEach(Arr.range(1, times), () => Effect.yieldNow, { concurrency: 1, discard: true });
  });

  // A held fiber stops right after its read of the members returned, so what it read stays what it
  // knows while a grant applies and drains. The knock that reads before it registers is the one this
  // catches: its row lands after the drain.
  const hold = Effect.gen(function* () {
    const gate = yield* Hold;

    if (gate !== null) {
      reached.add(
        (yield* Deferred.isDone(applied))
          ? "a read held after the grant applied"
          : "a read held before the grant applied",
      );
      yield* Deferred.await(gate);
    }
  });

  const ledger = Layer.effect(
    Ledger,
    Ledger.pipe(
      Effect.map((actual) => ({
        ...actual,
        append: (...args: Parameters<typeof actual.append>) =>
          actual
            .append(...args)
            .pipe(
              Effect.tap(() =>
                args[0] === "gateway/access" && granting.now ? Deferred.succeed(applied, undefined) : Effect.void,
              ),
            ),
        read: (stream: string, after: Parameters<typeof actual.read>[1]) =>
          stream === "gateway/access"
            ? Stream.unwrap(
                gap.pipe(
                  Effect.as(
                    Stream.concat(actual.read(stream, after), Stream.fromEffectDrain(hold.pipe(Effect.andThen(gap)))),
                  ),
                ),
              )
            : actual.read(stream, after),
      })),
    ),
  ).pipe(Layer.provide(LedgerSql.layer(sql, { reader: "l15" })), Layer.provide(quiet));

  const transaction = LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet));

  const env = Layer.mergeAll(
    ledger,
    transaction,
    ClientManagerLedger.layer(founder).pipe(Layer.provide(ledger)),
    SpanSink.layer(sql, { object: process }),
    RecordManager.memory(4 * 1024 * 1024),
    Archive.memory,
    Layer.succeed(MailWakeups, { wake: () => Effect.die("unexpected wake in a knock law") }),
    Layer.succeed(Tasks, {
      request: () => Effect.die("unexpected task request in a knock law"),
      take: () => Effect.die("unexpected task take in a knock law"),
      started: () => Effect.die("unexpected task start in a knock law"),
      finish: () => Effect.die("unexpected task finish in a knock law"),
      read: () => Effect.die("unexpected task read in a knock law"),
      forProcess: () => Stream.die("unexpected task lookup in a knock law"),
      collected: () => Effect.die("unexpected task collect in a knock law"),
      forTarget: () => Effect.die("unexpected task index read in a knock law"),
    }),
    Id.Generator.layer,
    RateLimiter.layer.pipe(
      Layer.provide(RateLimiterSql.layer(sql, { build: "test", policy: { limit: 100_000, window: 60_000 } })),
    ),
  );

  const layer = Gateway.layer({
    sql,
    founder,
    name: "l15",
    url,
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "test",
    build: "test",
    waiting: { most: 20, ttl: 600_000 },
    rateLimit: { limit: 100_000, window: 60_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 1000,
    spentCap: 1000,
    nextProcess: () => Effect.succeed(process),
    open: () => Effect.succeed(null),
    deliver: () => Effect.void,
    notify: (client, news) =>
      Effect.sync(() => {
        notices.push({ client, news });
      }),
    inputs: { schema: Schema.TaggedStruct("noop", {}), personOnly: [], raw: [] },
    audit: () => Effect.succeed(null),
    events: { personOnly: [] },
  }).pipe(Layer.provideMerge(env));

  return { root, window, keys: { A: granted, B: granted, C: bystander }, notices, layer, applied, granting, drained };
});

type World = Effect.Success<ReturnType<typeof world>>;

type Door = typeof Gateway.Service;

const hello = Effect.fnUntraced(function* (door: Door, key: SshsigTest.Identity, tab: string) {
  const client = yield* door.connect(),
    nonce = yield* door.challenge(client);

  return {
    client,
    result: yield* door.initialize(
      client,
      {
        versions: [1],
        has: [],
        ping: "30s",
        key: key.raw,
        tab,
        nonce,
        platform: "browser",
        os: "ios",
        sentAt,
        signed: yield* key.proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
      },
      { url, tab, name: key.fingerprint },
    ),
  };
});

const grant = Effect.fnUntraced(function* (door: Door, w: World) {
  const text = grantText({
    id: "grant-l15",
    key: w.keys.A.raw,
    for: person,
    to: "l15",
    as: "window",
    sentAt,
    saw: { code: "123456", label: "Two tabs", location: "test", method: "compare", check: "touch", has: [] },
  });

  expect((yield* door.grant({ text, armored: yield* w.root.proof(text) }))._tag).toBe("applied");
});

/** What one play of an order left behind. */
type Played = {
  /** The clients whose knock was answered `ok`: they sit in a waiting row until woken. */
  readonly knocked: ReadonlySet<Peer>;
  /** How many `granted` news each client got. */
  readonly woken: Readonly<Record<Peer, number>>;
  /** The keys that still hold a waiting row, read through a watching window. */
  readonly rows: ReadonlyArray<{ readonly key: string; readonly clients: ReadonlyArray<string> }>;
  readonly ids: Readonly<Record<Peer, string | null>>;
  /** The key a person grants: A's and B's. */
  readonly granted: string;
};

/**
 * Plays an order against a real gateway. In a sequence each step finishes before the next starts;
 * raced, each client's hello then knock is its own fiber, beside the grant's.
 */
const play = Effect.fnUntraced(function* (
  order: ReadonlyArray<Step>,
  gaps: ReadonlyArray<number>,
  mode: "in a sequence" | { readonly raced: ReadonlyArray<typeof Lag.Type> },
  reached: Set<string>,
) {
  const w = yield* world(gaps, reached);

  return yield* Effect.gen(function* () {
    const door = yield* Gateway;
    const watcher = yield* hello(door, w.window, "watcher");
    expect(watcher.result._tag).toBe("online");

    const ids: Record<Peer, string | null> = { A: null, B: null, C: null };
    const clients = new Map<Peer, Effect.Success<ReturnType<typeof door.connect>>>();
    const knocked = new Set<Peer>();
    const grantTime = { started: false, done: false };

    const act = Effect.fnUntraced(function* (step: Step) {
      if (step.peer === null) {
        grantTime.started = true;
        w.granting.now = true;
        yield* grant(door, w).pipe(Effect.ensuring(Deferred.succeed(w.applied, undefined)));
        grantTime.done = true;
        yield* Deferred.succeed(w.drained, undefined);

        return;
      }

      const peer = step.peer;

      if (step.move === "hello") {
        const said = yield* hello(door, w.keys[peer], `tab-${peer}`);
        clients.set(peer, said.client);
        ids[peer] = String(said.client);

        return;
      }

      const client = clients.get(peer);

      if (client === undefined) {
        return yield* Effect.die(`the order ${Arr.join(Arr.map(order, named), ", ")} knocks before ${peer}'s hello`);
      }

      const knocking = door.knock(client, { label: `tab ${peer}` }),
        held = mode !== "in a sequence" && mode.raced[{ A: 0, B: 1, C: 2 }[peer]]?.held === true;

      const answer = yield* held ? Effect.provideService(knocking, Hold, w.drained) : knocking;

      if (answer._tag === "ok") {
        knocked.add(peer);
        reached.add(grantTime.done ? "knock answered after the grant" : "knock answered before the grant");
      }
    });

    if (mode === "in a sequence") {
      yield* Effect.forEach(order, act, { concurrency: 1, discard: true });
    } else {
      // Every hello first, one by one, so each tab is refused and waiting. Then the knocks and the
      // grant start together, a knock that waits for the grant to be applied among them.
      const lagFor = (peer: Peer) => mode.raced[{ A: 0, B: 1, C: 2 }[peer]];
      yield* Effect.forEach(
        Arr.filter(order, (step) => step.move === "hello"),
        act,
        { concurrency: 1, discard: true },
      );
      yield* Effect.all(
        Arr.map(
          Arr.filter(order, (step) => step.move !== "hello"),
          (step) =>
            Effect.gen(function* () {
              const lag = step.peer === null ? undefined : lagFor(step.peer);

              if (lag?.late === true) {
                yield* Deferred.await(w.applied);
              }

              yield* Effect.forEach(Arr.range(1, lag?.wait ?? 0), () => Effect.yieldNow, {
                concurrency: 1,
                discard: true,
              });
              yield* act(step);
            }),
        ),
        { concurrency: "unbounded", discard: true },
      );
    }

    const watching = yield* door.watch(watcher.client);

    expect(watching._tag).toBe("watching");

    const woken = (peer: Peer) =>
      Arr.filter(w.notices, (n) => n.client === ids[peer] && n.news._tag === "granted" && ids[peer] !== null).length;

    const played: Played = {
      knocked,
      woken: { A: woken("A"), B: woken("B"), C: woken("C") },
      rows: Arr.map(watching.rows, (row) => ({ key: row.key, clients: row.clients })),
      ids,
      granted: w.keys.A.raw,
    };

    return played;
  }).pipe(Effect.provide(w.layer), Effect.scoped);
});

/** What every play must leave, however the steps fell. `times` is how often a woken client may hear. */
const holds = (w: Played, times: "at least once" | "exactly once", order: ReadonlyArray<Step>) => {
  const story = Arr.join(Arr.map(order, named), ", ");

  for (const peer of ["A", "B"] as const) {
    if (w.knocked.has(peer)) {
      const heard = w.woken[peer];

      expect(
        times === "exactly once" ? heard === 1 : heard >= 1,
        `after ${story}: client ${peer} knocked and heard ${heard} granted news, not ${times}`,
      ).toBe(true);
    } else {
      expect(w.woken[peer], `after ${story}: client ${peer} never knocked and was woken`).toBe(0);
    }
  }

  expect(w.woken.C, `after ${story}: a client of a key nobody granted was woken`).toBe(0);
  expect(
    w.rows.some((row) => row.key === w.granted),
    `after ${story}: a waiting row still holds the granted key`,
  ).toBe(false);

  if (w.knocked.has("C")) {
    expect(
      w.rows.some((row) => row.clients.includes(w.ids.C ?? "")),
      `after ${story}: the grant took a row of a key it did not grant`,
    ).toBe(true);
  }
};

describe("L15, a knock that lands after a grant is woken", () => {
  const reachedInSequence = new Set<string>();

  // W1. Plant: the knock never checks the members after it writes its row.
  it.effect.prop(
    "W1: in every order of hello, knock and grant, every client that knocked ends with granted news and no waiting row holds the granted key",
    { drawn: draws },
    ({ drawn }) =>
      Effect.gen(function* () {
        const order = ordered(drawn);
        const played = yield* play(order, [0], "in a sequence", reachedInSequence);
        holds(played, "at least once", order);
      }),
    checks,
  );

  it("W1 scenario: the generated orders reach a knock that lands before the grant and one that lands after it", () => {
    expect([...reachedInSequence].sort()).toEqual([
      "knock answered after the grant",
      "knock answered before the grant",
    ]);
  });

  const reachedRaced = new Set<string>();

  // W2. Plant: the knock and the grant both notify the rows they find without taking them first.
  it.effect.prop(
    "W2: when knocks and the grant race, each knocked client is woken exactly once",
    { drawn: draws, gaps: pauses, lag: lags },
    ({ drawn, gaps, lag }) =>
      Effect.gen(function* () {
        const order = ordered(drawn);
        const played = yield* play(order, gaps, { raced: lag }, reachedRaced);
        holds(played, "exactly once", order);
      }),
    checks,
  );

  it("W2 scenario: the races reach a knock answered before the grant, one answered after it, and a knock whose read of the members is held before the grant applied", () => {
    expect([...reachedRaced].sort()).toEqual([
      "a read held after the grant applied",
      "a read held before the grant applied",
      "knock answered after the grant",
      "knock answered before the grant",
    ]);
  });
});

// P8, next/. Real P11/P12 regressions: p25's replay, saved-failure and delivery laws. The
// refusal laws are in runner-contract.test.ts; both share runner-contract.test-support.ts.
// Source: next/packages/libfabrika/src/app/runner.test.ts at 9b48d622b5d4.
import { expect, it } from "@effect/vitest";
import { Gateway, Id, type ProgramRunner } from "@kampus/libfabrika";
import * as ClientManagerLedger from "@kampus/libfabrika/access/ClientManagerLedger";
import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import { MailWakeups } from "@kampus/libfabrika/runtime/MailWakeups";
import { Tasks } from "@kampus/libfabrika/tasks/Tasks";
import { Archive } from "@kampus/libfabrika/telemetry/Archive";
import { RecordManager } from "@kampus/libfabrika/telemetry/Records";
import { SpanSink } from "@kampus/libfabrika/telemetry/Sink";
import { KeyLine, writeSshsig } from "@kampus/libfabrika/transport/Sshsig";
import * as Arbitrary from "effect/Arbitrary";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { String as Str, pipe, Array as Arr } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { RateLimiter } from "effect/persistence";
import {
  Body,
  build,
  empty,
  id,
  incoming,
  makeProgram,
  Msg,
  opts,
  person,
  process,
  ReplayCases,
  text,
  unchanged,
  world,
} from "./runner-contract.test-support.ts";

const replayRefuse = (spy: { calls: number }): never => {
  spy.calls++;
  throw new Error("refuse must not run on accepted history");
};

const failedAs = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "ProgramDown", reason });
  }
};

type World = Effect.Success<ReturnType<typeof world>>;

// The real Gateway in front of a world's runner, for the delivery law below. Moved out of the
// world unchanged; it reads the world's SQL and ledger.
const openDoor = Effect.fnUntraced(function* (w: World, runner: typeof ProgramRunner.Service) {
  const { sql, ledger } = w;
  // Ephemeral signing material only. This helper reads no key file.
  const web = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: () => new Error("test crypto failed") });
  const pair = yield* web(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  const raw = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const fingerprint = `SHA256:${pipe(Base64.encode(new Uint8Array(yield* web(() => crypto.subtle.digest("SHA-256", raw)))), Str.replace(/=+$/, ""))}`;
  const blob = new Uint8Array(51);
  new DataView(blob.buffer).setUint32(0, 11);
  blob.set(new TextEncoder().encode("ssh-ed25519"), 4);
  new DataView(blob.buffer).setUint32(15, 32);
  blob.set(raw, 19);
  const line = Schema.decodeSync(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`);

  const founder = {
    name: "P8",
    person,
    keys: [line],
    window: Base64Url.encode(raw),
    by: "SHA256:exam-founder",
    build,
  };

  const env = Layer.mergeAll(
    ledger,
    ClientManagerLedger.layer(founder).pipe(Layer.provide(ledger)),
    SpanSink.layer(sql, { object: process }),
    RecordManager.memory(4 * 1024 * 1024),
    Archive.memory,
    Layer.succeed(MailWakeups, { wake: () => Effect.die("unexpected wake in legacy gateway law") }),
    Layer.succeed(Tasks, {
      request: () => Effect.die("unexpected task request in legacy gateway law"),
      take: () => Effect.die("unexpected task take in legacy gateway law"),
      started: () => Effect.die("unexpected task start in legacy gateway law"),
      finish: () => Effect.die("unexpected task finish in legacy gateway law"),
      read: () => Effect.die("unexpected task read in legacy gateway law"),
      forProcess: () => Stream.die("unexpected task lookup in legacy gateway law"),
      collected: () => Effect.die("unexpected task collect in legacy gateway law"),
      forTarget: () => Effect.die("unexpected task index read in legacy gateway law"),
    }),
    Id.Generator.layer,
    ProcessIdGenerator.layer,
    RateLimiter.layer.pipe(
      Layer.provide(RateLimiterSql.layer(sql, { build, policy: { limit: 100_000, window: 60_000 } })),
    ),
  );

  let deliveries = 0;

  const layer = Gateway.layer({
    sql,
    founder,
    name: "p8",
    url: "https://fabrika.test/p8",
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "exam",
    build,
    waiting: { most: 20, ttl: 600000 },
    rateLimit: { limit: 100_000, window: 60_000 },
    ping: { min: 10000, max: 60000 },
    inputCap: 4096,
    spentCap: 4096,
    nextProcess: () => Id.Generator.use((g) => g.next(Id.Process)).pipe(Effect.orDie),
    deliver: (_p, _envelope, _span, input) =>
      Effect.suspend(() => {
        deliveries++;

        return runner.msg(input);
      }),
    notify: () => Effect.void,
    inputs: {
      schema: Msg,
      personOnly: [],
      raw: [],
      name: (m) => m.type,
    },
    events: { personOnly: [] },
  }).pipe(Layer.provide(env));

  const connect = Effect.gen(function* () {
    const door = yield* Gateway.pipe(Effect.provide(layer)),
      client = yield* door.connect(),
      nonce = yield* door.challenge(client);

    const signed = yield* writeSshsig({
      text: `fabrika-hello\nhttps://fabrika.test/p8\nexam\n${nonce}`,
      line,
      space: "fabrika-client",
      sign: (bytes) =>
        web(() => crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes))).pipe(
          Effect.map((a) => new Uint8Array(a)),
        ),
    });

    expect(
      (yield* door.initialize(
        client,
        {
          versions: [1],
          has: [],
          ping: "30s",
          key: Base64Url.encode(raw),
          tab: "exam",
          nonce,
          platform: "browser",
          os: "ios",
          sentAt: "2030-01-01T00:00:00Z",
          as: "window",
          signed,
        },
        { url: "https://fabrika.test/p8", tab: "exam", name: fingerprint },
      ))._tag,
    ).toBe("online");

    return { door, client };
  });

  return {
    connect,
    deliveries: () => deliveries,
    bindings: () => Arr.map(sql.exec("SELECT value FROM gateway_bindings"), (r) => JSON.parse(String(r.value))),
  };
});

it.effect.prop(
  "p25: accepted replay never calls refuse and original retries survive later saves",
  { bodies: ReplayCases },
  ({ bodies }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };
      const w = yield* world(makeProgram(() => replayRefuse(spy)));
      const placed = [];

      for (const [i, body] of bodies.entries()) {
        const m = incoming(i + 1, body, i);
        const saved = yield* w.append(m);

        if (saved._tag !== "placed") {
          return yield* Effect.die("exam seed did not append");
        }

        placed.push({ id: m.id, rev: saved.rev, pos: saved.pos });
      }

      // Mail alone is not acceptance. Persist accepted placings and the checkpoint before them.
      yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, placed);
      const runner = yield* w.runner();
      expect((yield* runner.open("watcher")).view).toEqual({
        body: bodies.at(-1) ?? "",
        version: bodies.length,
      });

      for (const [i, body] of bodies.entries()) {
        const result = yield* runner.msg(incoming(i + 1, body, i));
        expect(result).toEqual({ _tag: "accepted", rev: placed[i]?.rev, pos: placed[i]?.pos });
      }

      expect(spy.calls).toBe(0);
      expect(yield* w.rows()).toHaveLength(bodies.length);
      expect(w.calls).toEqual([]);
    }),
  { ...opts, timeout: 60_000 },
);

it.effect.prop(
  "p25: a saved fold failure crashes and retains every accepted input",
  { body: Arbitrary.schema(text(4096)) },
  ({ body }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };
      const w = yield* world(makeProgram(() => replayRefuse(spy), true));

      const m = incoming(1, body),
        placed = yield* w.append(m);

      if (placed._tag !== "placed") {
        return yield* Effect.die("seed append refused");
      }

      yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, [
        { id: m.id, rev: placed.rev, pos: placed.pos },
      ]);

      const before = yield* w.rows(),
        runner = yield* w.runner();

      failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
      unchanged(before, yield* w.rows());
      expect(w.updates).toEqual([]);
      // Amendment 4: the crash re-refuses no saved letter.
      expect(spy.calls).toBe(0);
    }),
  opts,
);

// Source: next/packages/libfabrika/src/workers/supervision.laws.test.ts at 9b48d622b5d4.
it.effect.prop(
  "p25: default delivery limit counts three fresh failures, then returns dead",
  { body: Arbitrary.schema(Body) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null, true));
      yield* w.boot;

      const runner = yield* w.runner(),
        input = incoming(1, body);

      for (let tries = 1; tries <= 3; tries++) {
        const result = yield* Effect.exit(runner.msg(input));

        if (tries === 3) {
          expect(result).toEqual(Exit.succeed({ _tag: "refused", reason: "dead" }));
        } else {
          failedAs(result, "step");
        }

        expect(w.receipts()).toMatchObject([
          {
            tries,
            errors: Array.from({ length: tries }, () => "Error"),
            result: tries === 3 ? { _tag: "refused", reason: "dead" } : null,
          },
        ]);
        expect(yield* w.rows()).toEqual([]);
        expect(w.dead()).toHaveLength(tries === 3 ? 1 : 0);

        if (tries < 3) {
          yield* w.recover(runner);
        }
      }
    }),
  opts,
);

const terminalAnswer = (actual: unknown) => expect(actual).toEqual({ _tag: "refused", reason: "dead" });

it.effect.prop(
  "p25: the real Gateway answers dead on terminal delivery and its saved settled retry",
  { body: Arbitrary.schema(Body) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null, true));
      yield* w.boot;

      const runner = yield* w.runner(),
        sender = yield* openDoor(w, runner),
        first = yield* sender.connect;

      const request = {
        pid: process,
        letter: id("letter", 1),
        m: { type: "save", body, base: 0, work: false },
        sentAt: "2030-01-01T00:00:00Z",
        seen: 0,
      };

      for (let tries = 1; tries <= 3; tries++) {
        const answer = yield* Effect.exit(first.door.route(first.client, "process.send", request));

        if (tries < 3) {
          failedAs(answer, "step");
          yield* w.recover(runner);
        } else {
          expect(Exit.isSuccess(answer)).toBe(true);

          if (Exit.isSuccess(answer)) {
            terminalAnswer(answer.value);
          }
        }
      }

      expect(sender.deliveries()).toBe(3);
      expect(sender.bindings()).toMatchObject([
        { state: { _tag: "settled", result: { _tag: "refused", reason: "dead" } } },
      ]);
      // A new real Gateway layer reads the saved binding; the runner must not receive a fourth delivery.
      const restarted = yield* sender.connect;
      terminalAnswer(yield* restarted.door.route(restarted.client, "process.send", request));
      expect(sender.deliveries()).toBe(3);
      expect(w.dead()).toHaveLength(1);
      expect(yield* w.rows()).toEqual([]);

      for (const bad of [
        { _tag: "ok", result: { _tag: "refused", reason: "dead" } },
        { _tag: "ok", result: body },
      ]) {
        expect(() => terminalAnswer(bad)).toThrow();
      }
    }),
  { arbitrary: { seed: 119120, runs: 20, size: 4096, concurrency: 1 } },
);

it.effect.prop(
  "p25: saved failure restarts with backoff, no dead move and no down before the brake",
  { body: Arbitrary.schema(Body) },
  ({ body }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };
      const w = yield* world(makeProgram(() => replayRefuse(spy), true));
      yield* w.boot;

      const input = incoming(1, body),
        placed = yield* w.append(input);

      if (placed._tag !== "placed") {
        return yield* Effect.die("seed append refused");
      }

      yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, [
        { id: input.id, rev: placed.rev, pos: placed.pos },
      ]);

      const before = yield* w.rows(),
        runner = yield* w.runner();

      failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
      expect(spy.calls).toBe(0);
      expect(w.down()).toEqual([]);
      expect(w.dead()).toEqual([]);
      unchanged(before, yield* w.rows());
      yield* w.recover(runner).pipe(Effect.exit);
      // Amendment 4: the restart re-refuses no saved letter either.
      expect(spy.calls).toBe(0);
      unchanged(before, yield* w.rows());
      expect(w.dead()).toEqual([]);
      expect(w.down()).toEqual([]);
      expect(Arr.every(w.receipts(), (r) => r.tries === 0)).toBe(true);
    }),
  opts,
);

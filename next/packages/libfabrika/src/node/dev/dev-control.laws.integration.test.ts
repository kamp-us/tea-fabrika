// T708, next/. The real instance, walked through its lifecycle callbacks, its control plugin and its calls.
// Only platform calls, the clock and the pending-file rename are supplied. Each move is chosen from the
// state the walk has reached (0093), and every check reads calls, saved rows and spans, never a selector.
// The memory restart plan (docs/plan/quests/memory-restart-PLAN.md) makes a memory kill a replace, which
// the old process ends by its exit, and makes a call that meets a pending replacement wait for it.
import { RuntimeLifecycle, type RuntimeEvent } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { String as Str, pipe } from "effect";
import { vi } from "vitest";
import { ProcessIdGenerator } from "../../processes/ProcessIdGenerator.ts";
import type { BrainEvent } from "../../runtime/BrainEvent.ts";
import { ControlPlugin } from "./ControlPlugin.ts";
import { bodyText, fetchClient } from "./dev-client.test-support.ts";
import { rssLayer } from "./dev.fixture.ts";
import { startDev } from "./dev.ts";
import { brainOutbox } from "./local-dev.ts";

const SEED = 119120;

const NAME = "control-test";

// The brain's two settings as these laws start it: 0292's 500 MB mark and OTP's 5 s grace.
const BRAIN = { memory: 500_000_000, grace: 5000 };

// The driver gives Alchemy its control plugin as a plain config with a `start`. The deploy's context
// is typed as holding nothing, and Alchemy's contract also allows an Effect that builds a plugin,
// which the driver never gives, so a missing plugin or start is a defect.
const listenOn = (local: Context.Context<never>, port: number) =>
  Effect.gen(function* () {
    const found = Context.getOption(local, ControlPlugin);
    const plugin = Option.isSome(found) && !Effect.isEffect(found.value) ? found.value : undefined;

    if (plugin?.start === undefined) {
      return yield* Effect.die(new Error("the driver's control plugin has no start"));
    }

    return yield* plugin.start({ "fabrika-control": port }).pipe(Effect.scoped, Effect.orDie);
  });

const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

const Move = Schema.Struct({
  pick: between(0, 9_999),
  // One listener in four reports port zero.
  zero: between(0, 3),
  port: between(40_000, 49_999),
  exitCode: Schema.NullOr(between(0, 255)),
  signal: Schema.NullOr(Schema.Literals(["SIGTERM", "SIGKILL"])),
  delay: between(0, 10_000),
  // ps reports KiB; these are at or over the 500 MB memory limit.
  rss: between(488_282, 900_000),
  tick: between(1, 30),
  answer: Schema.Literals(["value", "remote"]),
  reason: Schema.Literals(["intensity", "restart_failed"]),
});

type Move = typeof Move.Type;

const Walk = Schema.Struct({
  base: between(1_000_000_000, 1_999_999_999),
  port: between(40_000, 49_999),
  pid: between(30_000, 39_000),
  moves: Schema.Array(Move).check(Schema.isMaxLength(14)),
});

type Walk = typeof Walk.Type;

type Row = typeof BrainEvent.Type;

type Cause = { readonly reason: "open" | "crash" | "memory"; readonly bytes?: number };

// What a row must say, before its start ids are known.
type Fact =
  | { readonly _tag: "started"; readonly at: number; readonly pid: number; readonly cause: Cause }
  | { readonly _tag: "replacing"; readonly at: number; readonly pid: number; readonly bytes: number }
  | { readonly _tag: "exited" | "restarting"; readonly at: number; readonly cause: Cause; readonly exit: Exit }
  | { readonly _tag: "braked"; readonly at: number; readonly reason: string; readonly exit: Exit }
  | { readonly _tag: "stopped"; readonly at: number };

type Exit = { readonly exitCode: number | null; readonly signal: string | null };

type Call = {
  readonly url: string;
  readonly body: { target: string; project: string; name: string; method: string; args: Array<unknown> };
};

type Answer = { readonly _tag: "value"; readonly value: unknown } | { readonly _tag: "error"; readonly error: unknown };

type Span = { readonly span: { name: string; ok: boolean; attributes: Record<string, unknown> } };

// `replacing`: the sampler sent the old process its SIGTERM, and the walk's process ends by its exit.
type Phase = "up" | "replacing" | "exited" | "waiting" | "braked";

type Kind = "exit" | "restart" | "start" | "brake" | "kill" | "listen" | "call" | "block" | "release";

// The walk's own view of the platform: what Alchemy and workerd did, never the instance's model.
type World = {
  phase: Phase;
  port: number;
  pid: number;
  now: number;
  cause: Cause;
  // Events sent while the pending-file rename is held; null when writes flow.
  held: number | null;
  // A replacement waits for its listener.
  waiting: boolean;
  // A call now waits: from a replace or an exit until a listener, a brake or the stop.
  pending: boolean;
  completed: number;
  failed: number;
};

const legal = (world: World): ReadonlyArray<readonly [Kind, number]> => {
  const flowing = world.held === null;
  const gate: ReadonlyArray<readonly [Kind, number]> = flowing ? [["block", 1]] : [["release", 2]];
  // A listener or a memory kill waits for every queued event, so its effect has one order.
  const quiet = (moves: ReadonlyArray<readonly [Kind, number]>) => (flowing ? moves : []);

  if (world.phase === "up") {
    return [
      ["exit", 4],
      ["call", 2],
      // A memory kill also comes while a replacement is pending: a new process that grew too big
      // before its listener was heard.
      ...quiet([
        ["kill", 2],
        ["listen", 2],
      ]),
      ...gate,
    ];
  }

  if (world.phase === "replacing") {
    return [["exit", 4], ["call", 2], ...gate];
  }

  if (world.phase === "exited") {
    return [["restart", 4], ["start", 2], ["brake", 1], ["call", 2], ...quiet([["listen", 3]]), ...gate];
  }

  if (world.phase === "waiting") {
    return [["start", 4], ["brake", 1], ["call", 2], ...quiet([["listen", 2]]), ...gate];
  }

  return [["call", 2], ...quiet([["listen", 1]]), ...(flowing ? [] : gate)];
};

const choose = (world: World, move: Move): Kind => {
  const moves = legal(world);
  const total = moves.reduce((sum, [, weight]) => sum + weight, 0);
  let left = move.pick % total;

  for (const [kind, weight] of moves) {
    if (left < weight) {
      return kind;
    }

    left -= weight;
  }

  return moves[0]![0];
};

// What ended a call's wait for a replacement: the listener, at its port and with the process up or
// not, a brake, or the stop. A call that met no pending replacement has none.
type Woken =
  | { readonly by: "listen"; readonly port: number; readonly up: boolean }
  | { readonly by: "brake" }
  | { readonly by: "stop" };

type Seen = {
  readonly port: number;
  readonly up: boolean;
  readonly answer: Move["answer"];
  readonly name: string;
  readonly sent: ReadonlyArray<Call>;
  readonly got: Answer;
  readonly woken: Woken | null;
};

const run = Effect.fnUntraced(function* (walk: Walk) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t708-" });
  const clock = yield* Clock.Clock;
  const acks = yield* Queue.unbounded<void>();
  const killed = yield* Queue.unbounded<number>();
  const sleeps = yield* Queue.unbounded<void>();
  const reads = { total: 0 };
  let gate: Deferred.Deferred<void> | null = null;
  let mode: "startup" | "walk" = "startup";
  const sent: Array<Call> = [];
  const calls: Array<Seen> = [];
  const facts: Array<Fact> = [];
  const restartReads: Array<number> = [];
  const kills: Array<readonly [number, number]> = [];
  const platform = { rss: 0 };
  // When the sampler's current 1-second sleep ends: the moment a memory sample is taken.
  const sampler = { due: 0 };
  // Each call's chosen answer, by its name, so a call answered later still gets its own.
  const answers = new Map<string, Move["answer"]>();
  // Calls that met a pending replacement, with their answers still to come.
  const waiting: Array<{ readonly index: number; readonly answered: Promise<Answer> }> = [];

  const world: World = {
    phase: "up",
    port: walk.port,
    pid: walk.pid,
    now: walk.base,
    cause: { reason: "open" },
    held: null,
    waiting: false,
    pending: false,
    completed: 0,
    failed: 0,
  };

  // Count the instance's wall-clock reads, and tell the walk when the 1-second sampler sleeps again.
  const counted = new Proxy(clock, {
    get: (target, key) => {
      if (key === "currentTimeMillis") {
        return Effect.sync(() => {
          reads.total++;

          return target.currentTimeMillisUnsafe();
        });
      }

      if (key === "currentTimeMillisUnsafe") {
        return () => {
          reads.total++;

          return target.currentTimeMillisUnsafe();
        };
      }

      if (key === "sleep") {
        return (duration: Duration.Duration) => {
          if (Duration.toMillis(duration) === 1000) {
            sampler.due = target.currentTimeMillisUnsafe() + 1000;
            Queue.offerUnsafe(sleeps, undefined);
          }

          return target.sleep(duration);
        };
      }

      const value: unknown = Reflect.get(target, key);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  // Hold each pending-file rename, and acknowledge the write once its folder sync has closed: the
  // instance then runs to its next queue take without another file step.
  let synced = false;

  const gated = new Proxy(fs, {
    get: (target, key) => {
      if (key === "rename") {
        return (from: string, to: string) =>
          Effect.gen(function* () {
            const held = pipe(to, Str.endsWith("brain.pending.jsonl")) ? gate : null;

            if (held !== null) {
              yield* Deferred.await(held);
            }

            yield* target.rename(from, to);
            // The startup flush rewrites the file too; only the walk's own writes are counted.
            synced = pipe(to, Str.endsWith("brain.pending.jsonl")) && mode === "walk";
          });
      }

      if (key === "open") {
        return (path: string, options?: Parameters<FileSystem.FileSystem["open"]>[1]) => {
          if (!synced || path !== home) {
            return target.open(path, options);
          }

          synced = false;

          // Registered first, so it runs after the folder handle's own release.
          return Effect.addFinalizer(() => Effect.sync(() => Queue.offerUnsafe(acks, undefined))).pipe(
            Effect.andThen(target.open(path, options)),
          );
        };
      }

      const value: unknown = Reflect.get(target, key);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
        const body = JSON.parse(bodyText(options)) as Call["body"];
        // The address as `fetch` parses it, given as a string or as the client's URL object.
        sent.push({ url: new URL(String(url)).href, body });

        if (mode === "startup") {
          return Response.json({ value: body.method === "write" ? { _tag: "written" } : null });
        }

        if (body.method === "brain") {
          // Keep lifecycle rows in the real outbox so the walk can read every one.
          return Response.json({ error: { reason: "offline" } });
        }

        if (body.target === "record") {
          return Response.json({ value: body.method === "write" ? { _tag: "written" } : null });
        }

        if (world.phase !== "up") {
          throw new Error("connection refused");
        }

        const answer = answers.get(body.name) ?? "value";

        return Response.json(
          answer === "value" ? { value: { echo: body.name } } : { error: { reason: `remote-${body.name}` } },
        );
      }),
    ),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vi.spyOn(process, "kill").mockImplementation((pid) => {
        Queue.offerUnsafe(killed, Number(pid));

        return true;
      }),
    ),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );

  let observe: (event: RuntimeEvent) => void = () => {};

  let listen: (port: number) => Effect.Effect<unknown> = () => Effect.void;

  const startup = yield* Effect.scoped(
    Effect.gen(function* () {
      yield* TestClock.setTime(walk.base);

      const dev = yield* startDev({ name: NAME, port: 18787, build: "test", home, ...BRAIN }, (local) =>
        Effect.gen(function* () {
          observe = Context.get(local, RuntimeLifecycle);

          const plugin = [...local.mapUnsafe.values()].find(
            (value) => typeof value === "object" && value !== null && "sockets" in value,
          ) as { start: (ports: Record<string, unknown>) => Effect.Effect<unknown> };

          listen = (port) => plugin.start({ "fabrika-control": port });
          observe({ type: "start", worker: NAME, pid: walk.pid });
          yield* listen(walk.port);
        }),
      );

      // The startup flush delivered the first started row; its brain call keeps what it said.
      const startup = sent.find((call) => call.body.method === "brain")!.body.args[0] as Row;
      facts.push({ _tag: "started", at: walk.base, pid: walk.pid, cause: { reason: "open" } });
      world.cause = { reason: "crash" };
      mode = "walk";
      let ready = false;

      // Every call that waited gets its answer before the walk moves on, so no answer races a move.
      const wake = Effect.fnUntraced(function* (woken: Woken) {
        for (const { index, answered } of waiting.splice(0)) {
          const got = yield* Effect.promise(() => answered);
          calls[index] = { ...calls[index]!, got, woken };
        }
      });

      const lifecycle = Effect.fnUntraced(function* (event: RuntimeEvent, move: Move) {
        if (world.held === null) {
          world.now += move.tick;
          yield* TestClock.setTime(world.now);
        }

        // The callback's own snapshot: a new child starts with a clean cause before any write yields.
        const cause = world.cause;

        if (event.type === "start") {
          world.cause = { reason: "crash" };
        }

        const before = reads.total;
        observe(event);

        if (world.held !== null) {
          world.held++;

          return cause;
        }

        yield* Queue.take(acks);

        if (event.type === "restart") {
          restartReads.push(reads.total - before);
        }

        return cause;
      });

      for (const [index, move] of walk.moves.entries()) {
        const kind = choose(world, move);
        const exit = { exitCode: move.exitCode, signal: move.signal, stderr: "" };
        const ended = { exitCode: move.exitCode, signal: move.signal };

        if (kind === "exit") {
          const at = world.now + (world.held === null ? move.tick : 0);
          const cause = yield* lifecycle({ type: "exit", worker: NAME, exit }, move);
          facts.push({ _tag: "exited", at, cause, exit: ended });
          world.phase = "exited";
          world.waiting = true;
          world.pending = true;
        } else if (kind === "restart") {
          const at = world.now + (world.held === null ? move.tick : 0);
          const cause = yield* lifecycle({ type: "restart", worker: NAME, exit, delay: move.delay }, move);
          facts.push({ _tag: "restarting", at, cause, exit: ended });
          world.phase = "waiting";
        } else if (kind === "start") {
          const at = world.now + (world.held === null ? move.tick : 0);
          world.pid++;
          const cause = yield* lifecycle({ type: "start", worker: NAME, pid: world.pid }, move);
          facts.push({ _tag: "started", at, pid: world.pid, cause });
          world.phase = "up";
        } else if (kind === "brake") {
          const at = world.now + (world.held === null ? move.tick : 0);
          yield* lifecycle({ type: "stop", worker: NAME, exit, reason: move.reason }, move);
          facts.push({ _tag: "braked", at, reason: move.reason, exit: ended });
          world.phase = "braked";

          if (world.waiting) {
            world.failed++;
          }

          world.waiting = false;
          world.pending = false;
          yield* wake({ by: "brake" });
        } else if (kind === "kill") {
          platform.rss = move.rss;

          if (!ready) {
            yield* Queue.take(sleeps);
          }

          const at = sampler.due;
          yield* TestClock.adjust("1 second");
          world.now += 1000;
          kills.push([yield* Queue.take(killed), world.pid]);
          // The replace wrote its fact before the SIGTERM; that write's acknowledgement is not a lifecycle's.
          yield* Queue.poll(acks);
          facts.push({ _tag: "replacing", at, pid: world.pid, bytes: move.rss * 1024 });
          // The sampler's next sleep comes once its turn ends, after the replace for a waiting call.
          ready = false;
          platform.rss = 0;
          world.cause = { reason: "memory", bytes: move.rss * 1024 };
          world.phase = "replacing";
          world.pending = true;
        } else if (kind === "listen") {
          const port = move.zero === 0 ? 0 : move.port;
          yield* listen(port);
          world.port = port;

          if (world.waiting) {
            world.completed++;
            // Let the woken restart end its span before the walk can close the scope.
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;
          }

          world.waiting = false;
          world.pending = false;
          yield* wake({ by: "listen", port, up: world.phase === "up" });
        } else if (kind === "call") {
          const name = `p-${index}`;
          answers.set(name, move.answer);
          calls.push({
            port: world.port,
            up: world.phase === "up",
            answer: move.answer,
            name,
            sent: [],
            got: { _tag: "value", value: undefined },
            woken: null,
          });

          const answered = (Reflect.get(dev.process(name), "ping")() as Promise<unknown>).then(
            (value): Answer => ({ _tag: "value", value }),
            (error: unknown): Answer => ({ _tag: "error", error }),
          );

          if (world.pending) {
            // It waits for the replacement; the move that ends the wait collects its answer.
            waiting.push({ index: calls.length - 1, answered });
          } else {
            const got = yield* Effect.promise(() => answered);
            calls[calls.length - 1] = { ...calls.at(-1)!, got };
          }
        } else if (kind === "block") {
          gate = yield* Deferred.make<void>();
          world.held = 0;
        } else {
          yield* Deferred.succeed(gate!, undefined);
          gate = null;

          for (let n = 0; n < world.held!; n++) {
            yield* Queue.take(acks);
          }

          world.held = null;
        }
      }

      if (world.held !== null) {
        yield* Deferred.succeed(gate!, undefined);
        gate = null;

        for (let n = 0; n < world.held; n++) {
          yield* Queue.take(acks);
        }

        world.held = null;
      }

      // Spans reach the record sink through the control port, so the walk ends on a known one.
      if (world.port === 0) {
        yield* listen(walk.port);
        world.port = walk.port;

        if (world.waiting) {
          world.completed++;
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
        }

        world.waiting = false;
        world.pending = false;
        yield* wake({ by: "listen", port: walk.port, up: world.phase === "up" });
      }

      world.now += 1;
      yield* TestClock.setTime(world.now);
      facts.push({ _tag: "stopped", at: world.now });

      return startup;
    }),
  ).pipe(
    Effect.provideService(Clock.Clock, counted),
    Effect.provideService(FileSystem.FileSystem, gated),
    Effect.provide(rssLayer(() => platform.rss)),
  );

  // The stop wakes every call still waiting.
  for (const { index, answered } of waiting.splice(0)) {
    calls[index] = { ...calls[index]!, got: yield* Effect.promise(() => answered), woken: { by: "stop" } };
  }

  const outbox = yield* brainOutbox(home);
  const rows = yield* outbox.pending;
  // A braked brain reaches no runtime, so the spans it could not send wait in its home for the next
  // start, which delivers them on a platform that answers every call.
  mode = "startup";
  yield* Effect.scoped(
    startDev({ name: NAME, port: 18787, build: "test", home, ...BRAIN }, (local) =>
      Effect.gen(function* () {
        Context.get(local, RuntimeLifecycle)({ type: "start", worker: NAME, pid: walk.pid + 1000 });
        yield* listenOn(local, walk.port);
      }),
    ),
  ).pipe(Effect.provide(rssLayer(() => 0)));

  for (const [index, call] of calls.entries()) {
    calls[index] = { ...call, sent: sent.filter((c) => c.body.target === "process" && c.body.name === call.name) };
  }

  const spans = sent
    .filter((call) => call.body.target === "record" && call.body.method === "write")
    .flatMap((call) => (call.body.args[2] as ReadonlyArray<Span> | undefined) ?? []);

  return { startup, rows, facts, calls, restartReads, spans, world, kills };
});

// Each run gets its own clock, file system, process ids and secrets.
const walked = (walk: Walk) =>
  run(walk).pipe(
    Effect.provide(fetchClient),
    Effect.provide(ProcessIdGenerator.layer),
    Effect.provide(SecureRandom.layerWebCrypto),
    Effect.provide(NodeServices.layer),
    Effect.provide(TestClock.layer()),
  );

describe("T708 dev control laws", () => {
  // Plant (the memory restart plan's L8, crash path): dial `address` in place of `reachable`: a call
  // after an exit or a brake reaches the old port.
  it.effect.prop(
    "calls go only to a listener with no pending replacement: they wait for one, and are offline without one",
    { walk: Walk },
    ({ walk }) =>
      Effect.gen(function* () {
        const { calls } = yield* walked(walk);

        for (const call of calls) {
          // Where the call was finally sent: the port it met, or the listener that ended its wait.
          const woken = call.woken;
          const port = woken === null ? call.port : woken.by === "listen" ? woken.port : 0;
          const up = woken === null ? call.up : woken.by === "listen" && woken.up;

          if (port === 0 || !up) {
            // No listener of a live process: offline, and nothing is sent, after an exit or a brake too.
            expect(call.sent).toEqual([]);
            expect(call.got).toMatchObject({ _tag: "error", error: { _tag: "ControlError", reason: "offline" } });
            continue;
          }

          expect(call.sent).toHaveLength(1);
          expect(call.sent[0]!.url).toBe(`http://127.0.0.1:${port}/`);
          expect(call.sent[0]!.body).toEqual({
            target: "process",
            project: NAME,
            name: call.name,
            method: "ping",
            args: [],
          });

          if (call.answer === "remote") {
            expect(call.got).toMatchObject({
              _tag: "error",
              error: { _tag: "ControlError", reason: `remote-${call.name}` },
            });
          } else {
            expect(call.got).toEqual({ _tag: "value", value: { echo: call.name } });
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: runsFor({ fast: 10, full: 100 }) } },
  );

  it.effect.prop(
    "six timestamp sites use the supplied clock, including both restart reads",
    { walk: Walk },
    ({ walk }) =>
      Effect.gen(function* () {
        const { startup, rows, facts, restartReads } = yield* walked(walk);
        expect([startup, ...rows].map((row) => [row._tag, row.at])).toEqual(facts.map((fact) => [fact._tag, fact.at]));

        // The restart deadline and the restarting row read the clock separately.
        for (const count of restartReads) {
          expect(count).toBeGreaterThanOrEqual(2);
        }
      }),
    { arbitrary: { seed: SEED, runs: runsFor({ fast: 10, full: 100 }) } },
  );

  it.effect.prop(
    "start links, reason, RSS and exit facts survive delayed writes and callback ordering",
    { walk: Walk },
    ({ walk }) =>
      Effect.gen(function* () {
        const { startup, rows, facts, spans, world, kills } = yield* walked(walk);
        const all = [startup, ...rows];
        expect(all.map((row) => row._tag)).toEqual(facts.map((fact) => fact._tag));
        expect(new Set(all.map((row) => row.id)).size).toBe(all.length);
        let start: string | null = null;

        for (const [index, row] of all.entries()) {
          const fact = facts[index]!;
          const bytes = (cause: Cause) => (cause.bytes === undefined ? {} : { bytes: cause.bytes });

          if (row._tag === "started" && fact._tag === "started") {
            // Each start links to the one before it; the first had no durable predecessor.
            expect(row).toMatchObject({ after: start, pid: fact.pid, build: "test", reason: fact.cause.reason });
            expect(row.bytes).toBe(fact.cause.bytes);
            start = row.start;
            continue;
          }

          expect(row.start).toBe(start);

          if (row._tag === "exited" && fact._tag === "exited") {
            expect(row).toMatchObject({ reason: fact.cause.reason, ...fact.exit, ...bytes(fact.cause) });
            expect(row.bytes).toBe(fact.cause.bytes);
          } else if (row._tag === "restarting" && fact._tag === "restarting") {
            expect(row).toMatchObject({ reason: fact.cause.reason, ...fact.exit });
            expect(row.bytes).toBe(fact.cause.bytes);
          } else if (row._tag === "braked" && fact._tag === "braked") {
            expect(row).toMatchObject({ reason: fact.reason, ...fact.exit });
          } else if (row._tag === "replacing" && fact._tag === "replacing") {
            // The replace names the process it signaled and the size the sampler saw.
            expect(row).toMatchObject({ reason: "memory", pid: fact.pid, bytes: fact.bytes, limit: BRAIN.memory });
          } else {
            expect(row).toMatchObject({ _tag: "stopped", reason: "stop" });
          }
        }

        // A memory kill names the running process, and only then.
        for (const [pid, live] of kills) {
          expect(pid).toBe(live);
        }

        // The listener completes a waiting replacement; a brake fails it with ControlError.
        const restarts = spans.filter(({ span }) => span.name === "brain.restart");
        expect(restarts.filter(({ span }) => span.ok)).toHaveLength(world.completed);
        expect(
          restarts.filter(({ span }) => !span.ok && span.attributes["error.type"] === "ControlError"),
        ).toHaveLength(world.failed);
      }),
    { arbitrary: { seed: SEED, runs: runsFor({ fast: 10, full: 100 }) } },
  );
});

// P12, next/. Real instance, durable outbox and recording; only platform calls are supplied. The
// memory restart plan (docs/plan/quests/memory-restart-PLAN.md) adds L7 and L8, the bounded replace.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeLifecycle, type RuntimeEvent } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { NodeServices } from "@effect/platform-node";
import { it as effectIt } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Cause, Clock, Context, Effect, Exit, Fiber, FileSystem, Option, Predicate, Schema, Scope } from "effect";
import { SecureRandom } from "effect/crypto";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { ProcessIdGenerator } from "../../processes/ProcessIdGenerator.ts";
import type { BrainEvent } from "../../runtime/BrainEvent.ts";
import type { Install } from "../../runtime/Code.ts";
import { ControlPlugin } from "./ControlPlugin.ts";
import { bodyText, fetchClient } from "./dev-client.test-support.ts";
import { rssLayer } from "./dev.fixture.ts";
import { startDev } from "./dev.ts";
import { brainOutbox } from "./local-dev.ts";

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

const step = fc.record({
  // A crash has no RSS; a memory kill carries the measured bytes, including the cap.
  rss: fc.option(fc.integer({ min: 488_282, max: 900_000 }), { nil: null }),
  exitCode: fc.option(fc.integer({ min: 0, max: 255 }), { nil: null }),
  signal: fc.option(fc.constantFrom<NodeJS.Signals | number>("SIGTERM", "SIGKILL", 15), {
    nil: null,
  }),
  delay: fc.integer({ min: 0, max: 10_000 }),
});

it("the control plugin returns a typed error for malformed platform port data", () =>
  fc.assert(
    fc.asyncProperty(
      fc.jsonValue().filter((raw) => !Schema.is(Schema.Int)(raw)),
      async (raw) => {
        const home = mkdtempSync(join(tmpdir(), "p12-port-"));
        vi.stubEnv("FABRIKA_HOME", home);

        try {
          const exit = await Effect.runPromiseExit(
            Effect.scoped(
              startDev({ name: "port-test", port: 18787, build: "test", home, ...BRAIN }, (local) =>
                Effect.suspend(() => {
                  const plugin = [...local.mapUnsafe.values()].find(
                    (value) => typeof value === "object" && value !== null && "sockets" in value,
                  ) as { start: (ports: Record<string, unknown>) => Effect.Effect<unknown> };
                  return plugin.start({ "fabrika-control": raw });
                }),
              ),
            ).pipe(
              Effect.provide(fetchClient),
              Effect.provide(ProcessIdGenerator.layer),
              Effect.provide(SecureRandom.layerWebCrypto),
              Effect.provide(rssLayer(() => 0)),
              Effect.provide(NodeServices.layer),
            ),
          );
          expect(Exit.isFailure(exit)).toBe(true);
          const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
          expect(Cause.hasDies(cause)).toBe(false);
          expect(Cause.hasFails(cause)).toBe(true);
          // Alchemy beta.84's PluginConfig.start fails with RuntimeError. A bad
          // platform port is its SystemError case, not our private ControlError.
          expect(Cause.findErrorOption(cause)).toMatchObject({
            _tag: "Some",
            value: { _tag: "SystemError", subtag: "control_port" },
          });
        } finally {
          vi.unstubAllEnvs();
          rmSync(home, { recursive: true, force: true });
        }
      },
    ),
    { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [[null], [{}], [1.5]] },
  ));

type Step = ReturnType<typeof step.generate>["value"];
const memoryBrake: Step = { rss: 600_000, exitCode: null, signal: "SIGTERM", delay: 250 };
const crashBrake: Step = { rss: null, exitCode: 1, signal: null, delay: 0 };

const sequence = fc.record({
  restarts: fc.array(step, { maxLength: 4 }),
  final: step,
  reason: fc.constantFrom<"intensity" | "restart_failed">("intensity", "restart_failed"),
});

it("every observed exit is durable once across restart or brake, with its reason and RSS", ({ signal }) =>
  fc.assert(
    fc.asyncProperty(sequence, async ({ restarts, final, reason }) => {
      const platform = { rss: 0, samples: 0 };
      type Call = { target: string; project: string; name: string; method: string; args: unknown[] };
      const calls: Call[] = [];
      const spawned: Array<{ command: string; args: ReadonlyArray<unknown> }> = [];
      const home = mkdtempSync(join(tmpdir(), "p12-exit-"));
      vi.stubEnv("FABRIKA_HOME", home);
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
        const call = JSON.parse(bodyText(options)) as { method: string };
        // Keep lifecycle events in the real outbox while the real record sink still flushes.
        return Response.json(
          call.method === "brain" ? { error: { reason: "offline" } } : { value: { _tag: "written" } },
        );
      });

      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              let observe: (event: RuntimeEvent) => void = () => {};
              let listen: Effect.Effect<unknown> = Effect.void;
              platform.rss = 0;
              // The first info call succeeds. Startup flush has no events until deployment yields.
              fetch.mockImplementation(async (_url, options) => {
                const call = JSON.parse(bodyText(options)) as { method: string };
                return Response.json({ value: call.method === "write" ? { _tag: "written" } : null });
              });
              yield* startDev({ name: "life-test", port: 18787, build: "test", home, ...BRAIN }, (local) =>
                Effect.gen(function* () {
                  observe = Context.get(local, RuntimeLifecycle);
                  // Alchemy pins the ports, so every replacement listens on the first one's port.
                  listen = listenOn(local, 27002);
                  observe({ type: "start", worker: "life-test", pid: 27001 });
                  yield* listen;
                }),
              );
              fetch.mockImplementation(async (_url, options) => {
                const call = JSON.parse(bodyText(options)) as Call;
                calls.push(call);
                return Response.json(
                  call.method === "brain" ? { error: { reason: "offline" } } : { value: { _tag: "written" } },
                );
              });
              const outbox = yield* brainOutbox(home);
              const waitForEvent = (ready: (event: typeof BrainEvent.Type) => boolean) =>
                Effect.gen(function* () {
                  // The event queue writes files asynchronously, outside the supplied clock.
                  // The enclosing test's abort signal bounds this wait.
                  for (;;) {
                    const rows = yield* outbox.pending;

                    if (rows.some(ready)) {
                      return rows;
                    }

                    yield* TestClock.withLive(Effect.sleep("10 millis"));
                  }
                });
              const expected: Array<{
                start: string;
                reason: string;
                exitCode: number | null;
                signal: string | null;
                bytes?: number;
              }> = [];
              const assertExits = Effect.gen(function* () {
                const rows = yield* outbox.pending;
                const exits = rows.filter((event) => event._tag === "exited");
                expect(exits).toHaveLength(expected.length);
                expect(new Set(exits.map((event) => event.id)).size).toBe(expected.length);
                expect(
                  exits.map(({ start, reason, exitCode, signal, bytes }) => ({
                    start,
                    reason,
                    exitCode,
                    signal,
                    ...(bytes === undefined ? {} : { bytes }),
                  })),
                ).toEqual(expected);
              });

              for (const [index, item] of [...restarts, final].entries()) {
                // Run the real memory sampler and replacement request on a supplied clock.
                platform.rss = item.rss ?? 0;
                const samples = platform.samples;

                for (;;) {
                  yield* TestClock.adjust("1 second");

                  if (platform.samples > samples) {
                    break;
                  }

                  // The previous sample's file flush must finish before it sleeps again.
                  yield* TestClock.withLive(Effect.sleep("10 millis"));
                }

                if (item.rss !== null) {
                  // The replace records its fact before the SIGTERM goes out, so the signal may follow
                  // the sample by a file write. The enclosing test's abort signal bounds this wait.
                  while (!kill.mock.calls.some(([pid, sent]) => pid === 27001 + index && sent === "SIGTERM")) {
                    yield* TestClock.withLive(Effect.sleep("10 millis"));
                  }
                }

                const rows = yield* outbox.pending;
                // Startup may already be acknowledged; last remains durable in either case.
                const start = rows.filter((event) => event._tag === "started").at(-1)?.start ?? (yield* outbox.last)!;
                const exit = { exitCode: item.exitCode, signal: item.signal, stderr: "" };
                expected.push({
                  start,
                  exitCode: item.exitCode,
                  signal: item.signal === null ? null : String(item.signal),
                  reason: item.rss === null ? "crash" : "memory",
                  ...(item.rss === null ? {} : { bytes: item.rss * 1024 }),
                });
                observe({ type: "exit", worker: "life-test", exit });

                if (index < restarts.length) {
                  observe({ type: "restart", worker: "life-test", exit, delay: item.delay });
                  yield* waitForEvent((event) => event._tag === "restarting" && event.start === start);
                  expect(
                    (yield* outbox.pending).find((event) => event._tag === "restarting" && event.start === start),
                  ).toMatchObject({ reason: item.rss === null ? "crash" : "memory" });
                  yield* assertExits;
                  observe({ type: "start", worker: "life-test", pid: 27002 + index });
                  yield* waitForEvent((event) => event._tag === "started" && event.after === start);
                  // The replacement listens, so calls that waited for it are answered.
                  yield* listen;
                  expect(
                    (yield* outbox.pending).find((event) => event._tag === "started" && event.after === start),
                  ).toMatchObject({ reason: item.rss === null ? "crash" : "memory" });
                } else {
                  observe({ type: "stop", worker: "life-test", exit, reason });
                  const pending = yield* waitForEvent((event) => event._tag === "braked" && event.start === start);
                  expect(pending.filter((event) => event._tag === "braked")).toMatchObject([
                    { start, reason, exitCode: exit.exitCode, signal: expected.at(-1)!.signal },
                  ]);
                  // Review 5: HEAD keeps braked but loses the final exited event and its RSS.
                  yield* assertExits;
                }
              }

              const memoryPids = [...restarts, final].flatMap((item, i) => (item.rss === null ? [] : [27001 + i]));
              expect(kill.mock.calls).toEqual(memoryPids.map((pid) => [pid, "SIGTERM"]));
            }),
          ).pipe(
            Effect.provide(fetchClient),
            Effect.provide(ProcessIdGenerator.layer),
            Effect.provide(SecureRandom.layerWebCrypto),
            Effect.provide(
              rssLayer(
                () => {
                  platform.samples++;
                  return platform.rss;
                },
                (command, args) => spawned.push({ command, args }),
              ),
            ),
            Effect.provide(NodeServices.layer),
            Effect.provide(TestClock.layer()),
          ),
          { signal },
        );
        const pending = await Effect.runPromise(
          brainOutbox(home).pipe(
            Effect.flatMap((outbox) => outbox.pending),
            Effect.provide(NodeServices.layer),
          ),
        );
        expect(pending.filter((event) => event._tag === "stopped")).toMatchObject([{ reason: "stop" }]);
        // A braked brain reaches no runtime, so what it could not send waits in this home for the next
        // start, which delivers it. The next start's own platform answers every call.
        fetch.mockImplementation(async (_url, options) => {
          const call = JSON.parse(bodyText(options)) as Call;
          calls.push(call);
          return Response.json({ value: call.method === "write" ? { _tag: "written" } : null });
        });
        await Effect.runPromise(
          Effect.scoped(
            startDev({ name: "life-test", port: 18787, build: "test", home, ...BRAIN }, (local) =>
              Effect.gen(function* () {
                Context.get(local, RuntimeLifecycle)({ type: "start", worker: "life-test", pid: 28001 });
                yield* listenOn(local, 28002);
              }),
            ),
          ).pipe(
            Effect.provide(fetchClient),
            Effect.provide(ProcessIdGenerator.layer),
            Effect.provide(SecureRandom.layerWebCrypto),
            Effect.provide(rssLayer(() => 0)),
            Effect.provide(NodeServices.layer),
          ),
          { signal },
        );
        // The memory sampler asks ps for one runtime's RSS, never another command.
        const pids = new Set([...restarts, final].map((_, i) => String(27001 + i)));
        expect(spawned.length).toBeGreaterThan(0);

        for (const { command, args } of spawned) {
          expect(command).toBe("ps");
          expect(args.slice(0, 3)).toEqual(["-o", "rss=", "-p"]);
          expect(args).toHaveLength(4);
          expect(pids.has(String(args[3]))).toBe(true);
        }

        // Lifecycle events go to the project object's own brain method, with no name.
        const brainCalls = calls.filter((call) => call.method === "brain");
        expect(brainCalls.length).toBeGreaterThan(0);

        for (const call of brainCalls) {
          expect({ target: call.target, project: call.project, name: call.name }).toEqual({
            target: "project",
            project: "life-test",
            name: "",
          });
        }

        // A stop while a replacement waits fails that replacement, and the failure is recorded.
        const failed = calls
          .filter((call) => call.target === "record" && call.method === "write")
          .flatMap(
            (call) =>
              (call.args[2] as Array<{
                span: { name: string; ok: boolean; attributes: Record<string, unknown> };
              }>) ?? [],
          )
          .filter(
            ({ span }) => span.name === "brain.restart" && !span.ok && span.attributes["error.type"] === "ControlError",
          );
        expect(failed.length).toBeGreaterThan(0);
      } finally {
        fetch.mockRestore();
        kill.mockRestore();
        vi.unstubAllEnvs();
        rmSync(home, { recursive: true, force: true });
      }
    }),
    {
      seed: 119120,
      numRuns: runsFor({ fast: 5, full: 20 }),
      examples: [
        // Review 5: final memory kill, no replacement to carry the RSS.
        [{ restarts: [], final: memoryBrake, reason: "intensity" }],
        [{ restarts: [memoryBrake, crashBrake], final: crashBrake, reason: "restart_failed" }],
        // Review 5: a pending start write resets the next memory kill's reason and RSS.
        [{ restarts: [crashBrake], final: memoryBrake, reason: "intensity" }],
      ],
    },
  ));

// L7 and L8: one replace, driven through the real driver. The stand-in runtime is the walk's own:
// the process that grew too big (pid 27001, control port 27002) and its replacement (27003 on 27004).
// Like workerd with a WebSocket open, the old process closes its control port on SIGTERM; whether it
// then ends by itself is generated. The sampler, the grace and every call run on the test clock.
const OLD = { pid: 27001, port: 27002 };
const NEW = { pid: 27003, port: 27004 };
const REPLACE = "replace-test";
const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const install: Install = { id: "install-1", program: "p/replace", hash: "a".repeat(64), source: "", from: "watch" };

const Body = Schema.fromJsonString(Schema.Struct({ method: Schema.String }));

// How the runtime reports a process's end, as Alchemy's exit event carries it.
type Ended = Extract<RuntimeEvent, { readonly type: "exit" }>["exit"];

type Sent = { readonly pid: number; readonly signal: string; readonly at: number };
type Request = { readonly port: number; readonly method: string; readonly at: number };

// A fact the driver writes to disk or a signal it sends after a write: polled on the real clock while
// the test clock stands still, and failed with what was seen once five seconds pass.
const until = Effect.fnUntraced(function* <A>(label: string, look: Effect.Effect<A>, done: (value: A) => boolean) {
  for (let tries = 0; tries < 500; tries++) {
    const value = yield* look;

    if (done(value)) {
      return value;
    }

    yield* TestClock.withLive(Effect.sleep("10 millis"));
  }

  return yield* Effect.die(new Error(`${label}: not seen; last ${JSON.stringify(yield* look)}`));
});

const replaceWorld = Effect.fnUntraced(function* (c: {
  readonly limit: number;
  readonly kib: number;
  readonly grace: number;
  readonly honors: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "mr-" });
  const clock = yield* Clock.Clock;
  const signals: Array<Sent> = [];
  const requests: Array<Request> = [];
  const world: { startup: boolean; ended: string | null; asked: number } = { startup: true, ended: null, asked: 0 };

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
        const body = Schema.decodeUnknownSync(Body)(bodyText(options));
        const port = Number(new URL(String(url)).port);
        requests.push({ port, method: body.method, at: clock.currentTimeMillisUnsafe() });

        if (port === OLD.port && signals.length > 0) {
          // The old workerd closed its control socket on the SIGTERM.
          throw new TypeError("fetch failed", {
            cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
          });
        }

        if (body.method === "brain" && !world.startup) {
          // Keep lifecycle rows in the real outbox so the law reads every one.
          return Response.json({ error: { reason: "offline" } });
        }

        if (body.method === "codeInstall") {
          return Response.json({ value: { _tag: "same" } });
        }

        return Response.json({ value: body.method === "write" ? { _tag: "written" } : null });
      }),
    ),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        signals.push({ pid: Number(pid), signal: String(signal), at: clock.currentTimeMillisUnsafe() });
        const ends = signal === "SIGKILL" || (signal === "SIGTERM" && c.honors);

        if (Number(pid) === OLD.pid && ends && world.ended === null) {
          world.ended = String(signal);
        }

        return true;
      }),
    ),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );

  let observe: (event: RuntimeEvent) => void = () => {};
  let listen: (port: number) => Effect.Effect<unknown> = () => Effect.void;
  // Its own scope, so a law can stop the brain in the middle of a replace.
  const life = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(life, Exit.void));
  const dev = yield* startDev(
    { name: REPLACE, port: 18787, build: "test", home, memory: c.limit, grace: c.grace },
    (local) =>
      Effect.gen(function* () {
        observe = Context.get(local, RuntimeLifecycle);
        listen = (port) => listenOn(local, port);
        observe({ type: "start", worker: REPLACE, pid: OLD.pid });
        yield* listen(OLD.port);
      }),
  ).pipe(
    Scope.provide(life),
    // `ps` answers the generated size for the old process only; its replacement is small.
    Effect.provide(
      rssLayer(
        () => (world.asked === OLD.pid ? c.kib : 0),
        (_command, args) => {
          world.asked = Number(args[3]);
        },
      ),
    ),
  );
  world.startup = false;
  const outbox = yield* brainOutbox(home);
  const first = (yield* outbox.last)!;
  const rows = outbox.pending.pipe(Effect.orDie);
  // The stand-in ends, Alchemy reports it, waits its backoff and starts the replacement.
  // A process that drains on SIGTERM exits by itself, as workerd does, so its exit names no signal.
  const replaced = Effect.fnUntraced(function* (signal: "SIGTERM" | "SIGKILL") {
    const exit: Ended =
      signal === "SIGKILL" ? { exitCode: null, signal, stderr: "" } : { exitCode: 0, signal: null, stderr: "" };
    observe({ type: "exit", worker: REPLACE, exit });
    observe({ type: "restart", worker: REPLACE, exit, delay: 250 });
    observe({ type: "start", worker: REPLACE, pid: NEW.pid });
    yield* until("the replacement's started row", rows, (all) =>
      all.some((row) => row._tag === "started" && row.after === first),
    );
  });
  // Ticks the 1-second sampler until it sends its first signal, the start of the replace.
  const term = Effect.fnUntraced(function* () {
    // The sampler's first sleep may begin a tick late, so a few ticks bound the first sample.
    for (let tick = 0; tick < 3 && world.asked === 0; tick++) {
      yield* TestClock.adjust("1 second");
      yield* TestClock.withLive(Effect.sleep("20 millis"));
    }

    // The test clock stands still from the sample to its signal, which may follow a file write.
    yield* until(
      "the first signal",
      Effect.sync(() => signals.length),
      (n) => n > 0,
    ).pipe(Effect.ignore);
    expect(signals[0], "the sampler signals the old process").toMatchObject({ pid: OLD.pid, signal: "SIGTERM" });
    return signals[0]!;
  });
  // What the runtime reports, as Alchemy's lifecycle hook hears it.
  const report = (event: RuntimeEvent) => observe(event);
  return { dev, life, home, signals, requests, world, first, rows, replaced, term, listen, observe: report };
});

const replaced = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  work.pipe(
    Effect.scoped,
    Effect.provide(fetchClient),
    Effect.provide(ProcessIdGenerator.layer),
    Effect.provide(SecureRandom.layerWebCrypto),
    Effect.provide(NodeServices.layer),
    Effect.provide(TestClock.layer()),
  );

// L7. Plant: main's dev.ts, with no `replacing`: SIGTERM goes out every second, no SIGKILL comes, and
// L7 fails on the signals.
effectIt.effect.prop(
  "L7 a memory replace sends SIGTERM once and SIGKILL once at the grace, and records replacing, killed, exited, restarting, started in order",
  {
    limit: between(100_000_000, 900_000_000),
    // KiB over the limit, as ps reports a process's size; zero is the limit itself, rounded up.
    over: between(0, 400_000),
    grace: between(1, 10_000),
    // Seconds the old process keeps sampling over the limit after the grace.
    seconds: between(1, 20),
    honors: Schema.Boolean,
  },
  ({ limit, over, grace, seconds, honors }) =>
    replaced(
      Effect.gen(function* () {
        const kib = Math.ceil(limit / 1024) + over;
        const w = yield* replaceWorld({ limit, kib, grace, honors });
        const sent = yield* w.term();

        if (honors) {
          yield* w.replaced("SIGTERM");
        }

        if (grace > 1) {
          yield* TestClock.setTime(sent.at + grace - 1);
          yield* TestClock.withLive(Effect.sleep("20 millis"));
        }

        // Nothing but the first SIGTERM before the grace runs out.
        expect(w.signals.map(({ signal }) => signal)).toEqual(["SIGTERM"]);
        yield* TestClock.setTime(sent.at + grace);

        if (!honors) {
          // The kill is recorded first, so the SIGKILL follows a file write.
          const seen = yield* until(
            "a SIGKILL",
            Effect.sync(() => w.signals.length),
            (n) => n > 1,
          ).pipe(Effect.option);

          if (seen._tag === "Some" && w.world.ended === "SIGKILL") {
            yield* w.replaced("SIGKILL");
          }
        }

        for (let n = 0; n < seconds; n++) {
          yield* TestClock.adjust("1 second");
          yield* TestClock.withLive(Effect.sleep("10 millis"));
        }

        expect(w.signals).toEqual(
          honors
            ? [{ pid: OLD.pid, signal: "SIGTERM", at: sent.at }]
            : [
                { pid: OLD.pid, signal: "SIGTERM", at: sent.at },
                { pid: OLD.pid, signal: "SIGKILL", at: sent.at + grace },
              ],
        );
        const rows = yield* w.rows;
        expect(rows.map((row) => row._tag)).toEqual(
          honors
            ? ["replacing", "exited", "restarting", "started"]
            : ["replacing", "killed", "exited", "restarting", "started"],
        );
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
        const bytes = kib * 1024;
        expect(rows.find((row) => row._tag === "replacing")).toMatchObject({
          start: w.first,
          at: sent.at,
          reason: "memory",
          pid: OLD.pid,
          bytes,
          limit,
          grace,
        });
        expect(rows.filter((row) => row._tag === "killed")).toEqual(
          honors ? [] : [expect.objectContaining({ start: w.first, at: sent.at + grace, pid: OLD.pid })],
        );
        expect(rows.find((row) => row._tag === "exited")).toMatchObject({
          start: w.first,
          reason: "memory",
          bytes,
          signal: honors ? null : "SIGKILL",
        });
        expect(rows.find((row) => row._tag === "started")).toMatchObject({
          after: w.first,
          pid: NEW.pid,
          reason: "memory",
          bytes,
        });
      }),
    ),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 20 }) } },
);

type Called = { readonly at: number; readonly fiber: Fiber.Fiber<unknown, unknown> };

// L8. Plant: dial `address` in place of `reachable`: the fetch stand-in sees a request to the old
// port. Or clear the waiters on stop without waking them: a call outlives the stop. Or let a call
// ignore the `stopping` state and wait only for `stopped`: a stop whose write fails holds the call
// to its bound.
effectIt.effect.prop(
  "L8 during a replace no control call dials the old port: each waits for the new listener or fails offline, and a stop ends every waiting call as offline at once with no SIGKILL, even when its own write fails",
  {
    grace: between(1, 10_000),
    // After the SIGKILL, how long the replacement takes to listen, past the call's bound included.
    delay: between(0, 60_000),
    // Each call's moment as a share of the time from the SIGTERM to the new listener, in ten-thousandths.
    calls: Schema.Array(between(0, 9_999)).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
    stop: Schema.NullOr(between(0, 9_999)),
    // The stop's own fact write fails before it reaches `stopped`.
    broken: Schema.Boolean,
  },
  ({ grace, delay, calls, stop, broken }) =>
    replaced(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const limit = 500_000_000;
        const w = yield* replaceWorld({ limit, kib: 600_000, grace, honors: false });
        const sent = yield* w.term();
        const heard = grace + delay;
        const bound = grace + 30_000;
        const share = (part: number) => Math.floor((part * heard) / 10_000);
        const ending = stop === null ? null : share(stop);
        // A call after the stop meets a stopped brain, which the stop law already covers.
        const moments = calls.map(share).filter((at) => ending === null || at < ending);
        const kills = ending === null || grace <= ending;
        type Move = { readonly at: number; readonly move: "call" | "kill" | "listen" | "stop" };
        const moves: Array<Move> = [
          ...moments.map((at): Move => ({ at, move: "call" })),
          ...(kills ? [{ at: grace, move: "kill" } satisfies Move] : []),
          ...(ending === null
            ? [{ at: heard, move: "listen" } satisfies Move]
            : [{ at: ending, move: "stop" } satisfies Move]),
        ]
          // At one moment a call goes first, then the kill, then the listener, then the stop.
          .sort(
            (a, b) =>
              a.at - b.at ||
              ["call", "kill", "listen", "stop"].indexOf(a.move) - ["call", "kill", "listen", "stop"].indexOf(b.move),
          );
        const made: Array<Called> = [];
        const ended = new Map<Called, { readonly at: number; readonly exit: Exit.Exit<unknown, unknown> }>();

        for (const { at, move } of moves) {
          yield* TestClock.setTime(sent.at + at);

          if (move === "call") {
            const fiber = yield* Effect.forkScoped(w.dev.install(install));
            const called: Called = { at, fiber };
            made.push(called);
            yield* Effect.forkScoped(
              Fiber.await(fiber).pipe(
                Effect.flatMap((exit) =>
                  Clock.currentTimeMillis.pipe(Effect.map((now) => ended.set(called, { at: now - sent.at, exit }))),
                ),
              ),
            );
            yield* Effect.yieldNow;
          } else if (move === "kill") {
            yield* until(
              "a SIGKILL at the grace",
              Effect.sync(() => w.world.ended),
              (end) => end === "SIGKILL",
            ).pipe(Effect.ignore);

            if (w.world.ended === "SIGKILL") {
              yield* w.replaced("SIGKILL");
            }
          } else if (move === "listen") {
            yield* w.listen(NEW.port);
          } else if (broken) {
            // The stop's own fact write fails, as on a full disk: a folder where its file goes. The
            // stop then never reaches `stopped`, and its finalizer dies with the write's error.
            yield* fs.makeDirectory(join(w.home, "brain.pending.jsonl.tmp"));
            const closed = yield* Scope.close(w.life, Exit.void).pipe(Effect.exit);
            expect(Exit.isFailure(closed), "the stop fails on its write").toBe(true);
          } else {
            yield* Scope.close(w.life, Exit.void);
          }

          yield* TestClock.withLive(Effect.sleep("10 millis"));
        }

        // Past every call's bound, twice over, so a call that waits too long shows.
        yield* TestClock.setTime(sent.at + heard + 2 * bound + 1);

        for (const called of made) {
          yield* Fiber.await(called.fiber);
        }

        yield* TestClock.withLive(Effect.sleep("10 millis"));
        // No control request reaches the old port once the replace began.
        expect(w.requests.filter((r) => r.port === OLD.port && r.at >= sent.at)).toEqual([]);

        // An install that failed names how in its cause: the call's own ControlError.
        const offline = (exit: Exit.Exit<unknown, unknown>) => {
          const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined;
          const found = error?._tag === "Some" ? error.value : undefined;
          return Predicate.hasProperty(found, "cause") && Predicate.hasProperty(found.cause, "reason")
            ? found.cause.reason
            : found;
        };

        for (const called of made) {
          const result = ended.get(called);
          expect(result, "every call ends").toBeDefined();
          const { at, exit } = result!;
          // Whichever comes first ends the wait: its own bound, the stop, or the new listener.
          const timeout = called.at + bound;
          const end = ending ?? heard;

          if (timeout === end) {
            // A tie between two clocks at one moment: either answer is right.
            expect(at).toBe(end);
          } else if (timeout < end) {
            // The bound ran out first: offline, never before the bound.
            expect(at).toBeGreaterThanOrEqual(timeout);
            expect(offline(exit)).toBe("offline");
          } else if (ending !== null) {
            // The stop wakes every waiting call at once, as offline.
            expect(at).toBe(ending);
            expect(offline(exit)).toBe("offline");
          } else {
            // The new listener answers it, at the moment it listens.
            expect(at).toBe(heard);
            expect(exit).toEqual(Exit.succeed({ _tag: "same" }));
          }
        }

        // A stop before the grace ends the replace without a SIGKILL.
        expect(w.signals.filter((s) => s.signal === "SIGKILL")).toHaveLength(kills ? 1 : 0);
      }),
    ),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 20 }) } },
);

// A pid that names no one process: zero, below zero, or not whole. `kill` sends to a whole process
// group for zero and below.
const NoPid = Schema.Union([
  Schema.Literal(0),
  between(-99_999, -1),
  Schema.Finite.check(
    Schema.isBetween({ minimum: -99_999, maximum: 99_999 }),
    Schema.makeFilter((n: number) => !Number.isInteger(n)),
  ),
]);

// L13. Plant: let a start with any number reach the state: the first start answers, or the sampler
// samples and signals a pid that is no process.
effectIt.effect.prop(
  "L13 a start that reports a pid of zero, below zero or not whole is refused, so the first start fails as bad_pid and a later one is never sampled or signaled",
  { pid: NoPid, first: Schema.Boolean },
  ({ pid, first }) =>
    replaced(
      Effect.gen(function* () {
        if (first) {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* fs.makeTempDirectoryScoped({ prefix: "mr-pid-" });
          const kill = yield* Effect.acquireRelease(
            Effect.sync(() => vi.spyOn(process, "kill").mockReturnValue(true)),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ value: null })),
            ),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          const exit = yield* startDev({ name: REPLACE, port: 18787, build: "test", home, ...BRAIN }, (local) =>
            Effect.gen(function* () {
              Context.get(local, RuntimeLifecycle)({ type: "start", worker: REPLACE, pid });
              yield* listenOn(local, OLD.port);
            }),
          ).pipe(Effect.provide(rssLayer(() => 600_000)), Effect.scoped, Effect.exit);
          const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined;
          expect(error?._tag === "Some" ? error.value : exit).toMatchObject({
            _tag: "ControlError",
            reason: "bad_pid",
          });
          expect(kill).not.toHaveBeenCalled();
          const rows = yield* (yield* brainOutbox(home)).pending;
          expect(rows.filter((row) => row._tag === "started")).toEqual([]);
          return;
        }

        // The first process crashes before any sample, and its replacement reports no process's pid.
        const w = yield* replaceWorld({ limit: 500_000_000, kib: 600_000, grace: 5000, honors: false });
        const exit: Ended = { exitCode: 1, signal: null, stderr: "" };
        w.observe({ type: "exit", worker: REPLACE, exit });
        w.observe({ type: "restart", worker: REPLACE, exit, delay: 250 });
        w.observe({ type: "start", worker: REPLACE, pid });
        yield* until("the crash's exited row", w.rows, (all) => all.some((row) => row._tag === "exited"));

        for (let n = 0; n < 5; n++) {
          yield* TestClock.adjust("1 second");
          yield* TestClock.withLive(Effect.sleep("10 millis"));
        }

        expect(w.world.asked, "no sample of any process").toBe(0);
        expect(w.signals).toEqual([]);
        expect((yield* w.rows).filter((row) => row._tag === "started" && row.after === w.first)).toEqual([]);
      }),
    ),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 40 }) } },
);

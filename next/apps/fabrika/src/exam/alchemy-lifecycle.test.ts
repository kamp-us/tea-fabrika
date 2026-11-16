// P12, next/. Run Alchemy's Runtime and Workerd; only the OS spawn is replaced, by the law's own
// `ChildProcessSpawner`, which the local patch makes Node's `Workerd` spawn through.
// B1's plant: in the patch, spawn with `node:child_process` again. The law's spawner then sees no
// child, and the start events are missing.
// B2's plant: edit the patch without `pnpm patch-commit`. The hash in the lockfile then differs.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runsFor } from "@kampus/vitest";
import { Deferred, Effect, Exit, Layer, PlatformError, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const require = createRequire(import.meta.resolve("@alchemy.run/cloudflare"));
const manifest = require.resolve("@alchemy.run/cloudflare-runtime/package.json");
const exports = JSON.parse(readFileSync(manifest, "utf8")).exports;

const load = (name: string) => import(pathToFileURL(resolve(dirname(manifest), exports[`./core/${name}`].import)).href);

type End = { exitCode: number | null; signal: string | number | null };

type Event = { worker: string } & (
  | { type: "start"; pid: number }
  | { type: "exit"; exit: End }
  | { type: "restart"; exit: End; delay: number }
  | { type: "stop"; exit: End; reason: "intensity" | "restart_failed" }
);

type Child = { pid: number; closed: boolean; crash: () => void };

const bytes = (text: string) => new TextEncoder().encode(text);

// The law's spawner: each spawn answers a fake workerd that reports its sockets on fd 3 and lives
// until it is crashed or its scope closes. A crash ends it the way Node's spawner reports a SIGKILL:
// its exit code fails with the signal named in the cause.
const spawned = () => {
  const children: Array<Child> = [];
  const sockets: Array<string> = [];
  const spawner = ChildProcessSpawner.make(() =>
    Effect.gen(function* () {
      const ended = yield* Deferred.make<void>();
      const child: Child = {
        pid: 27000 + children.length,
        closed: false,
        crash: () => {
          child.closed = true;
          Deferred.doneUnsafe(ended, Exit.void);
        },
      };
      children.push(child);
      yield* Effect.addFinalizer(() => Effect.sync(child.crash));
      const open = Stream.fromEffect(Deferred.await(ended)).pipe(Stream.drain);
      const control = Stream.suspend(() =>
        Stream.make(
          bytes(
            [
              ...sockets.map((socket, i) => JSON.stringify({ event: "listen", socket, port: 27100 + i })),
              JSON.stringify({ event: "listen", socket: "debug-port", port: 27101 }),
              "",
            ].join("\n"),
          ),
        ),
      ).pipe(Stream.concat(open));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(child.pid),
        exitCode: Deferred.await(ended).pipe(
          Effect.andThen(
            Effect.fail(
              PlatformError.systemError({
                _tag: "Unknown",
                module: "ChildProcess",
                method: "exitCode",
                cause: new Error("Process interrupted due to receipt of signal: 'SIGKILL'"),
              }),
            ),
          ),
        ),
        isRunning: Effect.sync(() => !child.closed),
        kill: () => Effect.sync(child.crash),
        stdin: Sink.drain,
        stdout: open,
        stderr: open,
        all: open,
        getInputFd: () => Sink.drain,
        getOutputFd: (fd) => (fd === 3 ? control : Stream.empty),
        unref: Effect.succeed(Effect.void),
      });
    }),
  );
  return { children, sockets, layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner) };
};

describe("P12 Alchemy lifecycle patch", () => {
  it("format: the installed lifecycle patch registration matches its locked hash", () => {
    const workspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
    const registration = /^ {2}['"]?@alchemy\.run\/cloudflare-runtime@2\.0\.0-beta\.85['"]?: (.+)$/m.exec(workspace);
    expect(registration, "the lifecycle patch must survive a clean pnpm install").not.toBeNull();
    expect(existsSync(join(ROOT, registration![1]!))).toBe(true);
    const hash = createHash("sha256")
      .update(readFileSync(join(ROOT, registration![1]!)))
      .digest("hex");
    expect(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8")).toContain(
      `'@alchemy.run/cloudflare-runtime@2.0.0-beta.85': ${hash}`,
    );
  });

  // The bug: the patch's first Node `error()` classified a failed start from the last 4096
  // characters of stderr only. A user-script error line followed by a long stack then lost its
  // service line, read as a system fault, and was retried three times. Unpatched Node and Alchemy's
  // Bun path classify the whole startup stderr.
  // Its plant: classify from the 4096-character tail in `error()` again. The start then fails as
  // `SystemError` `WorkerdStartFailed` after four spawns.
  it("pinned: a user-script error line followed by more than 4096 characters fails the start as a user-script error, with no retry", async () => {
    const { Workerd, WorkerdLive } = await load("workerd/Workerd");
    const stack = Array.from({ length: 200 }, (_, i) => `    at frame${i} (file:///bundle/worker.js:${i}:1)`).join(
      "\n",
    );
    const stderr = `service core:user:brain: Uncaught SyntaxError: Unexpected token\n${stack}\n`;
    expect(stderr.length).toBeGreaterThan(4096);
    let spawns = 0;
    const spawner = ChildProcessSpawner.make(() =>
      Effect.sync(() => {
        spawns++;
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(28000 + spawns),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.make(bytes(stderr)),
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.never,
          unref: Effect.succeed(Effect.void),
        });
      }),
    );
    const live: Layer.Layer<unknown> = WorkerdLive.pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    );
    const failed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const workerd = yield* Workerd;
          return yield* workerd.serve({ sockets: [{ name: "http", address: "127.0.0.1:0" }] }, {}, {});
        }),
      ).pipe(Effect.provide(live), Effect.flip),
    );
    expect(failed).toMatchObject({ _tag: "ConfigError", subtag: "WorkerdUserScript" });
    expect(spawns).toBe(1);
  });

  it("reports spawn PIDs, replacement delays and the brake; scope closure cancels recovery", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (name) => {
        const { Runtime, RuntimeLive, RuntimeLifecycle } = await load("Runtime");
        expect(RuntimeLifecycle, "the installed Alchemy runtime lacks the P12 lifecycle hook").toBeDefined();
        const { Workerd, WorkerdLive } = await load("workerd/Workerd");
        const { Docker } = await load("Docker");
        const { Storage } = await load("globals/Storage");
        const events: Array<Event> = [];
        const os = spawned();
        const observed = Layer.effect(
          Workerd,
          Effect.gen(function* () {
            const live = yield* Workerd;
            return {
              ...live,
              serve: (config: { sockets: Array<{ name: string }> }, ...args: Array<unknown>) => {
                os.sockets.splice(0, os.sockets.length, ...config.sockets.map((s) => s.name));
                return live.serve(config, ...args);
              },
            };
          }),
        ).pipe(Layer.provide(WorkerdLive), Layer.provide(os.layer));
        const runtime: Layer.Layer<unknown> = RuntimeLive.pipe(
          Layer.provide(observed),
          Layer.provide(Layer.succeed(Storage, { name: "storage" })),
          // No containers or bindings: Docker is never called on this path.
          Layer.provide(Layer.succeed(Docker, {})),
          Layer.provide(Layer.succeed(RuntimeLifecycle, (event: Event) => events.push(event))),
        );
        const wait = (test: () => boolean) =>
          Effect.gen(function* () {
            while (!test()) {
              yield* Effect.sleep("10 millis");
            }
          }).pipe(Effect.timeout("15 seconds"));
        const worker = {
          name,
          compatibilityDate: "2026-10-12",
          compatibilityFlags: [],
          bindings: [],
          modules: [
            {
              type: "ESModule",
              name: "main.mjs",
              content: 'export default {fetch() {return new Response("ready")}}',
            },
          ],
        };

        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const service = yield* Runtime;
              yield* service.start(worker);

              for (let generation = 0; generation < 4; generation++) {
                yield* wait(() => events.filter((e) => e.type === "start").length > generation);
                const started = events.filter((e) => e.type === "start")[generation]!;
                expect(started.worker).toBe(worker.name);
                expect(os.children, "workerd must be spawned through the context's ChildProcessSpawner").toHaveLength(
                  generation + 1,
                );
                expect(started.pid).toBe(os.children[generation]!.pid);
                os.children[generation]!.crash();
              }

              yield* wait(() => events.some((e) => e.type === "stop"));
              expect(events.map((e) => e.type)).toEqual([
                "start",
                "exit",
                "restart",
                "start",
                "exit",
                "restart",
                "start",
                "exit",
                "restart",
                "start",
                "exit",
                "stop",
              ]);
              expect(events.filter((e) => e.type === "restart").map((e) => e.delay)).toEqual([250, 500, 1000]);
              expect(events.at(-1)).toMatchObject({
                type: "stop",
                worker: worker.name,
                reason: "intensity",
              });
              expect(events.filter((e) => e.type === "exit").every((e) => e.exit?.signal === "SIGKILL")).toBe(true);
              expect(new Set(events.filter((e) => e.type === "start").map((e) => e.pid)).size).toBe(4);
              const count = events.length;
              yield* Effect.sleep("1200 millis");
              expect(events).toHaveLength(count);
            }),
          ).pipe(Effect.provide(runtime)),
        );
        expect(os.children.every((child) => child.closed)).toBe(true);
        const count = events.length;
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const service = yield* Runtime;
              yield* service.start({ ...worker, name: "p12-clean-stop" });
            }),
          ).pipe(Effect.provide(runtime)),
        );
        await Effect.runPromise(Effect.sleep("300 millis"));
        expect(events.slice(count).map((e) => e.type)).toEqual(["start"]);
        expect(os.children.at(-1)!.closed).toBe(true);
        const pending = events.length;
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const service = yield* Runtime;
              yield* service.start({ ...worker, name: "p12-pending-stop" });
              os.children.at(-1)!.crash();
              yield* wait(() => events.slice(pending).some((e) => e.type === "restart"));
            }),
          ).pipe(Effect.provide(runtime)),
        );
        await Effect.runPromise(Effect.sleep("300 millis"));
        expect(events.slice(pending).map((e) => e.type)).toEqual(["start", "exit", "restart"]);
      }),
      { seed: 119120, numRuns: runsFor({ fast: 3, full: 3 }), examples: [["p12-lifecycle"]] },
    );
  });
});

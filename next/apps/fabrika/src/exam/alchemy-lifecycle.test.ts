// P12, next/. Run Alchemy's Runtime and Workerd; only the OS spawn is replaced.
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { runsFor } from "@kampus/vitest";
import { Array as Arr, Effect, Layer, pipe } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

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

const spawned = () => {
  const children: Array<{ pid: number; closed: boolean; crash: () => void }> = [];
  const sockets: Array<string> = [];

  const mock = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
    const control = new PassThrough();

    const child = Object.assign(new childProcess.ChildProcess(), {
      pid: 27000 + children.length,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdio: [null, null, null, control],
      closed: false,
      kill: () => {
        child.crash();

        return true;
      },
      crash: () => {
        if (child.closed) {
          return;
        }

        child.closed = true;
        setImmediate(() => {
          child.emit("close", null, "SIGKILL");
          child.stdout.end();
          child.stderr.end();
        });
      },
    });

    children.push(child);
    queueMicrotask(() => {
      child.emit("spawn");
      control.write(
        Arr.join(
          [
            ...Arr.map(sockets, (socket, i) => JSON.stringify({ event: "listen", socket, port: 27100 + i })),
            JSON.stringify({ event: "listen", socket: "debug-port", port: 27101 }),
            "",
          ],
          "\n",
        ),
      );
    });

    return child;
  });

  syncBuiltinESMExports();

  return {
    children,
    sockets,
    restore: () => {
      mock.mockRestore();
      syncBuiltinESMExports();
    },
  };
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
                os.sockets.splice(0, os.sockets.length, ...Arr.map(config.sockets, (s) => s.name));
                return live.serve(config, ...args);
              },
            };
          }),
        ).pipe(Layer.provide(WorkerdLive));

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

        try {
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const service = yield* Runtime;
                yield* service.start(worker);

                for (let generation = 0; generation < 4; generation++) {
                  yield* wait(() => Arr.filter(events, (e) => e.type === "start").length > generation);
                  const started = Arr.filter(events, (e) => e.type === "start")[generation]!;
                  expect(started.worker).toBe(worker.name);
                  expect(started.pid).toBe(os.children[generation]!.pid);
                  os.children[generation]!.crash();
                }

                yield* wait(() => Arr.some(events, (e) => e.type === "stop"));
                expect(Arr.map(events, (e) => e.type)).toEqual([
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
                expect(
                  pipe(
                    events,
                    Arr.filter((e) => e.type === "restart"),
                    Arr.map((e) => e.delay),
                  ),
                ).toEqual([250, 500, 1000]);
                expect(events.at(-1)).toMatchObject({
                  type: "stop",
                  worker: worker.name,
                  reason: "intensity",
                });
                expect(
                  pipe(
                    events,
                    Arr.filter((e) => e.type === "exit"),
                    Arr.every((e) => e.exit?.signal === "SIGKILL"),
                  ),
                ).toBe(true);
                expect(
                  new Set(
                    pipe(
                      events,
                      Arr.filter((e) => e.type === "start"),
                      Arr.map((e) => e.pid),
                    ),
                  ).size,
                ).toBe(4);
                const count = events.length;
                yield* Effect.sleep("1200 millis");
                expect(events).toHaveLength(count);
              }),
            ).pipe(Effect.provide(runtime)),
          );
          expect(Arr.every(os.children, (child) => child.closed)).toBe(true);
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
          expect(Arr.map(events.slice(count), (e) => e.type)).toEqual(["start"]);
          expect(os.children.at(-1)!.closed).toBe(true);
          const pending = events.length;
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const service = yield* Runtime;
                yield* service.start({ ...worker, name: "p12-pending-stop" });
                os.children.at(-1)!.crash();
                yield* wait(() => Arr.some(events.slice(pending), (e) => e.type === "restart"));
              }),
            ).pipe(Effect.provide(runtime)),
          );
          await Effect.runPromise(Effect.sleep("300 millis"));
          expect(Arr.map(events.slice(pending), (e) => e.type)).toEqual(["start", "exit", "restart"]);
        } finally {
          os.restore();
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 3, full: 3 }), examples: [["p12-lifecycle"]] },
    );
  });
});

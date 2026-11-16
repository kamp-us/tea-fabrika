import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeLifecycle } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import type { BrainEvent } from "@kampus/libfabrika/brain-event";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import { runsFor } from "@kampus/vitest";
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { vi } from "vitest";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { rssStandIn } from "./rss.fixture.ts";

// P12, next/. Exercise startDev twice with one real home. Deployment and HTTP are fake.
// The link law skips only the flush-to-disk waits. The outbox's own law in
// next/packages/libfabrika/src/node/dev/local-dev.test.ts pins the sync calls and their order.
// The deployment reports a made-up pid, 27001, so nothing here may sample or signal it for real:
// the memory sample answers 0 KiB for every pid, and `process.kill` is a spy each law checks.
vi.mock("../alchemy.run.ts", () => ({
  stack: (_built: unknown, _config: unknown, local: Context.Context<never>) => local,
}));

vi.mock("alchemy/Deploy", () => ({
  deploy: ({ stack }: { stack: Context.Context<never> }) =>
    Effect.gen(function* () {
      const entries = [...stack.mapUnsafe.values()] as Array<unknown>;
      const plugin = entries.find((entry) => typeof entry === "object" && entry !== null && "sockets" in entry);

      if (typeof plugin !== "object" || plugin === null || !("start" in plugin)) {
        return yield* Effect.die("test deployment has no control plugin");
      }

      const start = plugin.start as (ports: Record<string, number>) => Effect.Effect<unknown>;
      const observe = Context.get(stack, RuntimeLifecycle);
      observe({ type: "start", worker: "fabrika", pid: 27001 });
      yield* start({ "fabrika-control": 27002 });
      // Let the real lifecycle queue consume its start event before the real outbox flush.
      yield* Effect.yieldNow;
    }),
}));

const fileWithoutSync = (file: FileSystem.File): FileSystem.File => ({
  [FileSystem.FileTypeId]: file[FileSystem.FileTypeId],
  get stat() {
    return file.stat;
  },
  sync: Effect.void,
  seek: (offset, from) => file.seek(offset, from),
  read: (buffer, options) => file.read(buffer, options),
  readAlloc: (size, options) => file.readAlloc(size, options),
  truncate: (length) => file.truncate(length),
  write: (buffer) => file.write(buffer),
  writeAll: (buffer) => file.writeAll(buffer),
});

const filesWithoutSync = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) =>
    FileSystem.make({
      ...fs,
      open: (...args) => Effect.map(fs.open(...args), fileWithoutSync),
    }),
  ),
).pipe(Layer.provideMerge(NodeServices.layer));

// A test's folder and its fetch spy go back through the test's scope (0061). The folder is handed
// to the code as `home`, and nothing these laws reach reads FABRIKA_HOME (0555: no env stub).
const sandbox = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p12-m-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

const spyOnFetch = (impl: typeof fetch) =>
  Effect.acquireRelease(
    Effect.sync(() => vi.spyOn(globalThis, "fetch").mockImplementation(impl)),
    () => Effect.sync(() => vi.restoreAllMocks()),
  );

// No real signal leaves these laws: every `process.kill` reaches this spy, and each law checks that
// none came.
const spyOnKill = Effect.acquireRelease(
  Effect.sync(() => vi.spyOn(process, "kill").mockReturnValue(true)),
  (spy) => Effect.sync(() => spy.mockRestore()),
);

// The brain's memory sample answers 0 KiB for every pid, so it never reads the made-up pid with a
// real `ps` and never replaces it. Every other command runs for real.
const quietMemory = rssStandIn(() => 0).pipe(Layer.provide(NodeServices.layer));

// The entry's own client, whose `fetch` is the global one at the moment of each request: a real
// process reads the global once, and a law stubs it anew on every run.
const fetchClient = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, (input, init) => globalThis.fetch(input, init))),
);

/** A stubbed `fetch` call's body as text, sent as a string or as the client's bytes. */
const bodyText = (options: RequestInit | undefined): string =>
  typeof options?.body === "string" ? options.body : new TextDecoder().decode(options?.body as Uint8Array);

// The installed runner takes runs and a seed, so the old example runs first from this callback.
const buildsPair = Schema.Tuple([Schema.NonEmptyString, Schema.NonEmptyString]);
const pinned: ReadonlyArray<readonly [string, string]> = [["build-a", "build-b"]];

it.live.prop(
  "Q11-start rejects invalid quota byte sizes before making a request",
  {
    field: Schema.Literals([
      "storage",
      "project.bytes",
      "project.message.bytes",
      "process.bytes",
      "process.message.bytes",
    ]),
    suffix: Schema.String,
  },
  ({ field, suffix }) =>
    Effect.gen(function* () {
      const { startDev } = yield* Effect.promise(() => import("./instance.ts"));
      const folder = yield* sandbox;
      const fetched = yield* spyOnFetch(async () => Response.json({ value: null }));
      const fixture = RecordWireTest.startupFixture({
        home: folder,
        name: "quota-start",
        person: "person-test",
        founder: "public-test-key",
        window: null,
        port: 18787,
        build: "quota-start",
      });
      // The quota values ride in the settings snapshot, each as its declared schema encodes it.
      const values: Record<string, Schema.Json> = { ...fixture.settings.values };
      const recovery = Schema.decodeUnknownSync(Schema.toEncoded(Declarations.recovery.schema))(
        values[Declarations.recovery.path],
      );
      const invalid = `invalid:${suffix}`;
      const { project, process } = recovery;

      if (field === "storage") {
        values[Declarations.storage.path] = invalid;
      } else {
        values[Declarations.recovery.path] = {
          project:
            field === "project.bytes"
              ? { ...project, bytes: invalid }
              : field === "project.message.bytes"
                ? { ...project, message: { ...project.message, bytes: invalid } }
                : project,
          process:
            field === "process.bytes"
              ? { ...process, bytes: invalid }
              : field === "process.message.bytes"
                ? { ...process, message: { ...process.message, bytes: invalid } }
                : process,
        };
      }

      // The snapshot's envelope accepts any JSON; each declared byte-size codec must still reject it.
      const declaration = field === "storage" ? Declarations.storage : Declarations.recovery;
      expect(Schema.decodeUnknownResult(declaration.schema)(values[declaration.path])._tag).toBe("Failure");
      const config = { ...fixture, settings: { ...fixture.settings, values } };
      const result = yield* Effect.scoped(
        startDev({ build: "quota-start", brain: "unused.mjs", programs: {} }, config),
      ).pipe(
        Effect.provide(fetchClient),
        Effect.provide(ProcessIdGenerator.layer),
        Effect.provide(SecureRandom.layerWebCrypto),
        Effect.provide(filesWithoutSync),
        Effect.result,
      );
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaError" } });
      expect(fetched).not.toHaveBeenCalled();
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 3, full: 40 }) } },
);

it.live.prop(
  "a later dev command links its first start to the last runtime in that home",
  [buildsPair],
  ([generated]) =>
    Effect.forEach(
      [...pinned, generated],
      (builds) =>
        Effect.gen(function* () {
          const { startDev } = yield* Effect.promise(() => import("./instance.ts"));
          const folder = yield* sandbox;
          const events: Array<typeof BrainEvent.Type> = [];
          yield* spyOnFetch(async (_url, options) => {
            const call = JSON.parse(bodyText(options)) as {
              method: string;
              args: Array<typeof BrainEvent.Type>;
            };

            if (call.method === "brain") {
              events.push(call.args[0]!);
            }

            return Response.json({ value: call.method === "info" ? [] : null });
          });
          const kill = yield* spyOnKill;
          const config = {
            home: folder,
            name: "life-contract",
            person: "person-test",
            founder: "public-test-key",
            window: null,
            port: 18787,
          };

          for (const build of builds) {
            yield* Effect.scoped(
              startDev({ build, brain: "unused.mjs", programs: {} }, RecordWireTest.startupFixture(config)),
            ).pipe(
              Effect.provide(fetchClient),
              Effect.provide(ProcessIdGenerator.layer),
              Effect.provide(SecureRandom.layerWebCrypto),
              Effect.provide(quietMemory),
              Effect.provide(filesWithoutSync),
            );
          }

          expect(kill).not.toHaveBeenCalled();
          const starts = events.filter((event) => event._tag === "started");
          expect(starts).toHaveLength(2);
          expect(starts[1]).toMatchObject({ after: starts[0]!.start, build: builds[1] });
          expect(starts[1]!.start).not.toBe(starts[0]!.start);
        }),
      { discard: true, concurrency: 1 },
    ),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 3, full: 20 }) } },
);

it.live.prop(
  "instance readiness waits for the started event to reach the ledger",
  [Schema.String.check(Schema.isUUID())],
  ([build]) =>
    Effect.gen(function* () {
      const folder = yield* sandbox;
      const reached = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const events: Array<typeof BrainEvent.Type> = [];
      yield* spyOnFetch(async (_url, options) => {
        const call = JSON.parse(bodyText(options)) as {
          method: string;
          args: Array<typeof BrainEvent.Type>;
        };

        if (call.method === "brain") {
          events.push(call.args[0]!);
          Effect.runSync(Deferred.succeed(reached, undefined));
          await Effect.runPromise(Deferred.await(release));
        }

        return Response.json({ value: call.method === "write" ? { _tag: "written" } : null });
      });
      const kill = yield* spyOnKill;
      const { startDev } = yield* Effect.promise(() => import("./instance.ts"));
      yield* Effect.gen(function* () {
        const starting = yield* Effect.forkChild(
          startDev(
            { build, brain: "unused.mjs", programs: {} },
            RecordWireTest.startupFixture({
              home: folder,
              name: "life-contract",
              person: "person-test",
              founder: "public-test",
              window: null,
              port: 18787,
            }),
          ),
        );
        yield* Deferred.await(reached);
        yield* Effect.yieldNow;
        expect(starting.pollUnsafe()).toBeUndefined();
        expect(events).toMatchObject([{ _tag: "started", reason: "open", build }]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(starting);
      }).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined)),
        Effect.scoped,
        Effect.provide(fetchClient),
        Effect.provide(ProcessIdGenerator.layer),
        Effect.provide(SecureRandom.layerWebCrypto),
        Effect.provide(quietMemory),
        Effect.provide(NodeServices.layer),
      );
      expect(kill).not.toHaveBeenCalled();
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 3, full: 10 }) } },
);

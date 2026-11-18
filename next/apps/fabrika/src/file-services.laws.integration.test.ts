// P12, next/. Run the real build and dev command with a recorded FileSystem and Path layer.
import { tmpdir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import { Recorder, runsFor } from "@kampus/vitest";
import {
  Arbitrary,
  Array as Arr,
  Cause,
  Effect,
  Exit,
  FileSystem,
  Formatter,
  Layer,
  Logger,
  Option,
  Path,
  PlatformError,
  Predicate,
  Record as Rec,
  References,
  Schema,
  Sink,
  Stream,
  String as Str,
} from "effect";
import { ChildProcessSpawner } from "effect/process";

import * as fc from "fast-check";
import { expect, vi } from "vitest";
import { build } from "./build.ts";
import { Row } from "./exam/compiler.ts";

class ImportError extends Schema.TaggedError<ImportError, { readonly brand: unique symbol }>()("ImportError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

// The real disk, through Effect's FileSystem, holds each law's own temp folder and source files;
// the recorded layer below is what the build and dev command see.
const disk = await Effect.runPromise(FileSystem.FileSystem.pipe(Effect.provide(NodeServices.layer)));

const { join, relative, resolve } = Effect.runSync(Path.Path.pipe(Effect.provide(Path.layer)));

const tempFolder = (prefix: string) => Effect.runPromise(disk.makeTempDirectory({ prefix }));

const removeFolder = (folder: string) => Effect.runPromise(disk.remove(folder, { recursive: true, force: true }));

const writeText = (file: string, text: string) => Effect.runPromise(disk.writeFileString(file, text));

const cli = vi.hoisted(() => ({
  // SAFETY: work starts unset; the CLI mock below stores the Effect it was handed.
  work: undefined as Effect.Effect<unknown, unknown> | undefined,
  // SAFETY: layer starts unset; each law sets it to the layer it runs the handed work on, one of these two.
  layer: undefined as
    | Layer.Layer<FileSystem.FileSystem | Path.Path>
    | Layer.Layer<FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner>
    | undefined,
}));

vi.mock("@effect/platform-node", async (original) => {
  const actual = await original<typeof import("@effect/platform-node")>();

  return {
    ...actual,
    NodeServices: {
      get layer() {
        return cli.layer ?? actual.NodeServices.layer;
      },
    },
    NodeRuntime: {
      ...actual.NodeRuntime,
      runMain: (work: Effect.Effect<unknown, unknown>) => {
        cli.work = work;
      },
    },
  };
});

const instanceFailure = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
  expect(Cause.hasDies(cause)).toBe(false);
  expect(Cause.findErrorOption(cause)).toMatchObject({
    _tag: "Some",
    value: { _tag: "InstanceError", reason },
  });
};

it.effect.prop(
  "dev refuses every invalid parent with reason parent_gone before touching settings",
  {
    text: Schema.String.check(Schema.isPattern(/^[\x20-\x7e]*$/)),
    fraction: Schema.Int.check(Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 })),
    small: Schema.Int.check(Schema.isBetween({ minimum: -100, maximum: 1 })),
    other: Schema.Int.check(
      Schema.isBetween({ minimum: 2, maximum: 2147483647 }),
      Schema.makeFilter((pid) => pid !== process.ppid),
    ),
  },
  ({ text, fraction, small, other }) =>
    Effect.forEach(
      // Keep both old examples and exercise every old input class in each generated case.
      ["1", "1.5", `not-a-pid-${text}`, String(fraction + 0.5), String(small), String(other)],
      (parent) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => process.argv),
            (argv) =>
              Effect.sync(() => {
                process.argv = argv;
                cli.layer = undefined;
                cli.work = undefined;
              }),
          );

          process.argv = [process.execPath, "dev.ts", "--child", `--parent=${parent}`];

          // dev.ts provides its own layers, so the Recorder is built once here and its built context
          // handed to the hoisted cli.layer: one store, which the law reads after dev.ts ran.
          // Plant (run once): in dev.ts, call fs.makeDirectory before the parent check; the recorded
          // list is not [].
          const files = yield* Layer.build(
            Recorder.layer(FileSystem.FileSystem, FileSystem.makeNoop({ makeDirectory: () => Effect.never })),
          );

          cli.layer = Layer.merge(Layer.succeedContext(files), Path.layer);
          vi.resetModules();
          yield* Effect.tryPromise({
            try: () => import("../dev.ts"),
            catch: (cause: unknown) => new Error("dev import failed", { cause }),
          });
          instanceFailure(yield* Effect.exit(cli.work!), "parent_gone");
          expect(
            yield* Recorder.calls(FileSystem.FileSystem, "makeDirectory").pipe(Effect.provideContext(files)),
          ).toEqual([]);
        }).pipe(Effect.scoped),
      { concurrency: 1, discard: true },
    ),
  { arbitrary: { size: 100, runs: runsFor({ fast: 4, full: 30 }) } },
);

it("dev defaults to a scoped detached child and reports its nonzero exit as child_failed", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), fc.integer({ min: 0, max: 255 }), async (name, code) => {
      const argv = process.argv;
      const commands: Array<import("effect/process/ChildProcess").Command> = [];

      const spawn = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            commands.push(command);

            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(27000),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            });
          }),
        ),
      );

      cli.layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, spawn);
      process.argv = [process.execPath, "dev.ts", "--name", name];

      try {
        vi.resetModules();
        await import("../dev.ts");
        const exit = await Effect.runPromiseExit(cli.work!);

        if (code === 0) {
          expect(Exit.isSuccess(exit)).toBe(true);
        } else {
          instanceFailure(exit, "child_failed");
        }

        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          _tag: "StandardCommand",
          command: process.execPath,
          args: [resolve(import.meta.dirname, "../dev.ts"), "--name", name, "--child", `--parent=${process.pid}`],
          options: {
            detached: true,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            forceKillAfter: "3 seconds",
          },
        });
      } finally {
        process.argv = argv;
        cli.layer = undefined;
        cli.work = undefined;
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 3, full: 15 }), examples: [["clean-exit", 0]] },
  );
});

for (const edge of ["makeDirectory", "readFileString", "writeFileString"] as const) {
  it(`dev reports ${edge} failure with reason settings and never starts a build`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (name) => {
        const argv = process.argv;
        const folder = await tempFolder("p12-dev-error-");

        const failure = PlatformError.systemError({
          module: "FileSystem",
          method: edge,
          _tag: "PermissionDenied",
        });

        const fs = FileSystem.layerNoop({
          makeDirectory: () => Effect.void,
          exists: () => Effect.succeed(true),
          readFileString: () =>
            Effect.succeed(
              JSON.stringify({
                name,
                person: "person",
                founder: "public",
                window: null,
                port: 18787,
                build: "old",
              }),
            ),
          [edge]: () => Effect.fail(failure),
        });

        vi.stubEnv("FABRIKA_HOME", folder);
        cli.layer = Layer.merge(fs, Path.layer);
        process.argv = [process.execPath, "dev.ts", "--child", `--parent=${process.ppid}`];

        try {
          vi.resetModules();
          await import("../dev.ts");
          instanceFailure(await Effect.runPromiseExit(cli.work!), "settings");
        } finally {
          process.argv = argv;
          cli.layer = undefined;
          cli.work = undefined;
          vi.unstubAllEnvs();
          await removeFolder(folder);
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 3, full: 10 }) },
    );
  });
}

// Bundler output is platform input here. Compiler behavior has its own real-build laws.
// P16's table check refuses a program whose hash is not its source's own SHA-256 hex: this one is
// `printf counter | shasum -a 256`.
vi.mock("@kampus/libfabrika/node/build", async (original) => ({
  ...(await original<typeof import("@kampus/libfabrika/node/build")>()),
  bundlePrograms: () =>
    Effect.succeed({
      "fabrika/counter": {
        hash: "efe899c74558f20b08bbc19bf0228c0c25bddb7871d80bd34ac8b33c030b3698",
        source: "counter",
      },
    }),
  bundle: (_input: unknown, _plugins: unknown, options: { readonly phase?: string }) =>
    Effect.succeed({
      output: [
        { type: "chunk", code: "export default {};" },
        ...(options.phase === "tab"
          ? [{ type: "asset", fileName: "index.html", source: '<!doctype html><script src="/window.js"></script>' }]
          : []),
      ],
    }),
}));

vi.mock("./exam/compiler.ts", async (original) => ({
  ...(await original<typeof import("./exam/compiler.ts")>()),
  compile: (_file: string, code: string) => ({ code }),
  check: () => [],
}));

// The instance records each start's options, so a law sees the port it was started with.
const instances = vi.hoisted(() => Array.of<{ readonly port: number }>());

vi.mock("./local-instance.ts", () => ({
  localInstance: (
    _built: unknown,
    options: { readonly settings: { readonly values: Readonly<Record<string, unknown>> } },
  ) =>
    Effect.suspend(() => {
      instances.push({ port: Number(options.settings.values["instance.port"]) });

      return Effect.fail({ reason: "test_instance_ready" });
    }),
}));

const root = resolve(import.meta.dirname, "../../../..");

const generated = fc.record({
  name: fc.uuid(),
  label: fc.string(),
  port: fc.integer({ min: 1024, max: 65535 }),
});

const boundary = { name: "saved-home", label: "first build", port: 18787 };

const recorded = (folder: string, source: string, text: string, failPublish: boolean, unreadable?: string) => {
  const out = join(folder, "build"),
    pending = join(folder, ".fabrika-build-test"),
    backup = `${pending}.old`;

  const files = new Map([
    [source, text],
    [join(root, "compiler-ledger.json"), "[]"],
    [join(out, "brain.mjs"), "last good"],
  ]);

  for (const module of ["@manti-ui/styles/index.css", "@kampus/fabrika-design/tokens.css", "@kampus/tuval/style.css"]) {
    files.set(decodeURIComponent(new URL(import.meta.resolve(module)).pathname), ":root { --test-color: red; }");
  }

  const modes: Array<ReadonlyArray<unknown>> = [];

  const calls: Array<ReadonlyArray<unknown>> = [],
    paths: Array<ReadonlyArray<string>> = [];

  const note = (name: string, ...args: ReadonlyArray<unknown>) => {
    calls.push([name, ...args]);
  };

  const move = (from: string, to: string) => {
    for (const [path, text] of [...files]) {
      if (path === from || Str.startsWith(`${from}/`)(path)) {
        files.delete(path);
        files.set(to + Str.slice(from.length)(path), text);
      }
    }
  };

  const write = (path: string, text: string) =>
    Effect.sync(() => {
      note("write", path, text);
      files.set(path, text);
    });

  const fs = FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    glob: () => Effect.succeed([relative(root, source)]),
    exists: (path) =>
      Effect.sync(() => files.has(path) || Arr.some([...files.keys()], (file) => Str.startsWith(`${path}/`)(file))),
    readFileString: (path) =>
      Effect.suspend(() => {
        note("read", path);

        return path === unreadable
          ? Effect.fail(
              PlatformError.systemError({
                module: "FileSystem",
                method: "readFileString",
                _tag: "PermissionDenied",
                pathOrDescriptor: path,
              }),
            )
          : Effect.succeed(files.get(path) ?? "");
      }),
    makeDirectory: (path) =>
      Effect.sync(() => {
        note("mkdir", path);
      }),
    makeTempDirectory: () =>
      Effect.sync(() => {
        note("temp", pending);

        return pending;
      }),
    writeFileString: (path, text, options) => {
      modes.push([path, options?.mode]);

      return write(path, text);
    },
    writeFile: (path, bytes) => write(path, new TextDecoder().decode(bytes)),
    rename: (from, to) =>
      Effect.suspend(() => {
        note("rename", from, to);

        if (failPublish && from === pending && to === out) {
          return Effect.fail(
            PlatformError.systemError({
              module: "FileSystem",
              method: "rename",
              _tag: "PermissionDenied",
              pathOrDescriptor: from,
            }),
          );
        }

        move(from, to);

        return Effect.void;
      }),
    remove: (path) =>
      Effect.sync(() => {
        note("remove", path);

        for (const file of files.keys()) {
          if (file === path || Str.startsWith(`${path}/`)(file)) {
            files.delete(file);
          }
        }
      }),
  });

  const path = Effect.runSync(Path.Path.pipe(Effect.provide(Path.layer)));

  const layer = Layer.merge(
    fs,
    Layer.succeed(Path.Path, {
      ...path,
      join: (...parts) => {
        paths.push(parts);

        return path.join(...parts);
      },
    }),
  );

  return { out, pending, backup, files, calls, paths, modes, layer };
};

for (const failed of [false, true]) {
  it(`build reads and publishes through FileSystem, preserving write and rollback order: ${failed ? "rename fails" : "success"}`, async () => {
    await fc.assert(
      fc.asyncProperty(generated, async ({ name, label }) => {
        const folder = await tempFolder("p12-build-fs-"),
          source = join(folder, `${name}.tsx`);

        const text = `export const label = ${JSON.stringify(label)};`;
        const w = recorded(folder, source, text, failed);
        // HEAD has real paths too, so ignoring the supplied service fails an assertion, not setup.
        await Effect.runPromise(disk.makeDirectory(w.out));
        await writeText(join(w.out, "brain.mjs"), "last good");
        await writeText(source, text);

        try {
          const result = await Effect.runPromiseExit(
            build({ out: w.out, files: [source] }).pipe(Effect.provide(w.layer)),
          );

          // P14 slice 2 (ticket 828): the app's build selects its tab, so the tab's three stylesheets are
          // read through the same FileSystem too, and every read still comes before the first write.
          const reads = Arr.flatMap(w.calls, ([call, file]) => (call === "read" ? [String(file)] : []));
          expect(Arr.filter(reads, (file) => file === source || file === join(root, "compiler-ledger.json"))).toEqual([
            source,
            join(root, "compiler-ledger.json"),
          ]);
          expect(w.calls[0]).toEqual(["read", source]);
          expect(w.calls[1]).toEqual(["read", join(root, "compiler-ledger.json")]);

          const ledgerRead = Option.getOrThrow(
            Arr.findFirstIndex(
              w.calls,
              ([call, file]) => call === "read" && file === join(root, "compiler-ledger.json"),
            ),
          );

          expect(
            Arr.every(w.calls.slice(0, ledgerRead), ([call]) => call === "read"),
            "only reads come before the compiler ledger read",
          ).toBe(true);
          const styles = Arr.filter(reads, (file) => Str.endsWith(".css")(file));
          expect(new Set(styles).size, "the tab's stylesheets are read through FileSystem").toBe(3);
          const lastRead = Arr.findLastIndex(w.calls, ([call]) => call === "read");
          const firstWrite = Arr.findFirstIndex(w.calls, ([call]) => call === "write");
          expect(
            Option.isNone(firstWrite) || Option.isNone(lastRead) || lastRead.value < firstWrite.value,
            "a read came after a write",
          ).toBe(true);
          const renames = Arr.filter(w.calls, ([call]) => call === "rename");
          expect(renames).toEqual([
            ["rename", w.out, w.backup],
            ["rename", w.pending, w.out],
            ...(failed ? [["rename", w.backup, w.out]] : []),
          ]);
          const firstRename = Option.getOrThrow(Arr.findFirstIndex(w.calls, ([call]) => call === "rename"));
          const writes = Arr.flatMap(w.calls, ([call], index) => (call === "write" ? [index] : []));
          // P16 publishes one file: brain.mjs is the only file written, into the pending folder.
          expect(Arr.map(writes, (index) => w.calls[index]![1])).toEqual([join(w.pending, "brain.mjs")]);
          expect(Arr.every(writes, (index) => index < firstRename)).toBe(true);
          expect(w.calls.slice(-2)).toEqual([
            ["remove", w.pending],
            ["remove", w.backup],
          ]);
          expect(w.paths.length).toBeGreaterThan(0);
          expect(w.files.get(join(w.out, "brain.mjs"))).toBe(failed ? "last good" : "export default {};");
          expect(Exit.isFailure(result)).toBe(failed);
          const cause = Exit.isFailure(result) ? result.cause : Cause.empty;
          expect(Cause.hasDies(cause)).toBe(false);

          if (failed) {
            expect(Cause.findErrorOption(cause)).toMatchObject({
              _tag: "Some",
              value: { _tag: "BuildError", reason: "publish" },
            });
          }
        } finally {
          await removeFolder(folder);
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 3, full: 10 }), examples: [[boundary]] },
    );
  });
}

it("dev chooses flags, saved settings or defaults and saves with mode 0600 before building", async () => {
  await fc.assert(
    fc.asyncProperty(
      generated,
      fc.record({
        saved: fc.boolean(),
        inline: fc.boolean(),
        name: fc.boolean(),
        person: fc.boolean(),
        founder: fc.boolean(),
        window: fc.boolean(),
        port: fc.boolean(),
        savedWindow: fc.option(fc.uuid(), { nil: null }),
      }),
      async ({ name, port }, choices) => {
        const folder = await tempFolder("p12-dev-fs-"),
          file = join(folder, "instance.json"),
          source = join(folder, "view.tsx");

        // T664: a port saved by an older start is never a source, so it differs from the default.
        const saved = {
          name: "saved-project",
          person: "person-test",
          founder: "public-test",
          window: choices.savedWindow,
          port: 18799,
          build: "old",
        };

        const w = recorded(folder, source, "export const view = 1;", false);

        if (choices.saved) {
          w.files.set(file, JSON.stringify(saved));
        }

        await writeText(source, "export const view = 1;");
        const argv = process.argv;
        vi.stubEnv("FABRIKA_HOME", folder);
        vi.stubEnv("FABRIKA_INSTANCE_PORT", undefined);
        cli.layer = w.layer;
        cli.work = undefined;
        instances.length = 0;

        const overrides = {
          name,
          person: `person-${name}`,
          founder: `-public-${name}`,
          window: `-window-${name}`,
          port,
        };

        const selected = Arr.filter(
          Rec.toEntries(overrides),
          ([field]) =>
            // SAFETY: `field` comes from Object.entries(overrides), so it is one of overrides' own keys.
            choices[field as keyof typeof overrides] ||
            (!choices.saved && ["name", "person", "founder"].includes(field)),
        );

        process.argv = [
          process.execPath,
          "dev.ts",
          "--child",
          `--parent=${process.ppid}`,
          ...Arr.flatMap(selected, ([field, value]) =>
            choices.inline ? [`--${field}=${value}`] : [`--${field}`, String(value)],
          ),
        ];

        try {
          vi.resetModules();
          await import("../dev.ts");
          expect(cli.work).toBeDefined();
          const exit = await Effect.runPromiseExit(cli.work!);
          expect(Cause.findErrorOption(Exit.isFailure(exit) ? exit.cause : Cause.empty)).toMatchObject({
            _tag: "Some",
            value: { reason: "test_instance_ready" },
          });
          const calls = Arr.filter(w.calls, ([, path]) => path === folder || path === file);
          // T664: the port is a setting now, so it leaves the saved state and goes to the instance.
          const { port: _flag, ...founding } = Rec.fromEntries(selected);
          const { port: _saved, ...kept } = saved;
          const { port: _override, ...named } = overrides;

          const expected = {
            ...(choices.saved ? kept : { ...named, window: null }),
            ...founding,
            build: "pending",
          };

          expect(Arr.map(instances, (instance) => instance.port)).toEqual([choices.port ? port : 18787]);
          expect(calls).toEqual([
            ["mkdir", folder],
            ...(choices.saved ? [["read", file]] : []),
            ["write", file, w.files.get(file)],
          ]);
          expect(JSON.parse(w.files.get(file)!)).toEqual(expected);
          expect(Arr.filter(w.modes, ([path]) => path === file)).toEqual([[file, 0o600]]);

          const savedAt = Option.getOrThrow(
            Arr.findFirstIndex(w.calls, ([call, path]) => call === "write" && path === file),
          );

          const buildAt = Option.getOrThrow(
            Arr.findFirstIndex(w.calls, ([call, path]) => call === "read" && path === source),
          );

          expect(savedAt).toBeLessThan(buildAt);
          expect(w.paths).toContainEqual([folder, "instance.json"]);
        } finally {
          process.argv = argv;
          cli.layer = undefined;
          cli.work = undefined;
          vi.unstubAllEnvs();
          await removeFolder(folder);
        }
      },
    ),
    { seed: 119120, numRuns: runsFor({ fast: 4, full: 40 }) },
  );
});

// T664 L11 through dev.ts. In slice 1 dev reads no repo file (the plan's amendment, answer 1),
// so the version and repo-scope failures stay with Load.test.ts and Files.test.ts.
const badPort = fc.oneof(
  fc.integer({ min: 65536, max: 2 ** 30 }).map(String),
  fc.integer({ min: -(2 ** 30), max: 0 }).map(String),
  fc.constantFrom("", "port", "18787.5"),
);

const loadFailures = fc.oneof(
  fc.record({
    kind: fc.constant("syntax" as const),
    body: fc.constantFrom("[instance\nport = 1\n", 'x = "never closed\n', "port = ]\n"),
  }),
  fc.record({
    kind: fc.constant("unknown" as const),
    // oxlint-disable-next-line fabrika/no-stage-word -- the old top-level word is a key no file may hold
    body: fc.constantFrom("[nope]\n", "[instance]\nprot = 18800\n", "telemetry = false\n", "stage = 1\n"),
  }),
  fc.record({ kind: fc.constant("scope" as const), body: fc.constant('fabrika-version = "0.0.0"\n') }),
  fc.record({
    kind: fc.constant("invalid" as const),
    body: fc
      .oneof(fc.integer({ min: 65536, max: 2 ** 30 }), fc.integer({ min: -(2 ** 30), max: 0 }))
      .map((p) => `[instance]\nport = ${p}\n`),
  }),
  fc.record({ kind: fc.constant("read" as const), body: fc.constant("") }),
  fc.record({ kind: fc.constant("flag" as const), body: badPort }),
  fc.record({ kind: fc.constant("env" as const), body: badPort }),
);

it("L11: no failed settings load reaches the instance write, the build or the instance, and its cause is kept", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), loadFailures, fc.boolean(), (name, failure, alias) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            // The temp folder and the process state this law changes are given back by its scope (0061).
            const folder = yield* disk.makeTempDirectoryScoped({ prefix: "t664-dev-load-" });

            const argv = process.argv;
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                process.argv = argv;
                cli.layer = undefined;
                cli.work = undefined;
                vi.unstubAllEnvs();
              }),
            );

            const source = join(folder, "view.tsx"),
              person = join(folder, "fabrika.toml");

            const w = recorded(
              folder,
              source,
              "export const view = 1;",
              false,
              failure.kind === "read" ? person : undefined,
            );

            if (["syntax", "unknown", "scope", "invalid"].includes(failure.kind)) {
              w.files.set(person, failure.body);
            }

            vi.stubEnv("FABRIKA_HOME", folder);
            vi.stubEnv("FABRIKA_INSTANCE_PORT", failure.kind === "env" ? failure.body : undefined);
            cli.layer = w.layer;
            instances.length = 0;
            process.argv = [
              process.execPath,
              "dev.ts",
              "--child",
              `--parent=${process.ppid}`,
              ...Arr.map(["name", "person", "founder"], (field) => `--${field}=${name}`),
              ...(failure.kind === "flag" ? [`--${alias ? "port" : "instance.port"}=${failure.body}`] : []),
            ];

            vi.resetModules();
            yield* Effect.promise(() => import("../dev.ts"));
            const exit = yield* Effect.exit(cli.work!);
            instanceFailure(exit, "settings");
            // The dev edge translates the load's error and keeps it as the cause.
            expect(Cause.findErrorOption(Exit.isFailure(exit) ? exit.cause : Cause.empty)).toMatchObject({
              _tag: "Some",
              value: {
                cause: {
                  _tag: "SettingsError",
                  reason: ["flag", "env"].includes(failure.kind) ? "invalid" : failure.kind,
                },
              },
            });
            // Counted fakes: the build reads its source first, the instance records each start.
            expect(
              Arr.filter(w.calls, ([call, path]) => call === "write" || call === "temp" || path === source),
            ).toEqual([]);
            expect(instances).toEqual([]);
          }),
        ),
      ),
    ),
    { seed: 119120, numRuns: runsFor({ fast: 10, full: 100 }) },
  );
});

it("dev without saved settings reports settings for each missing required value", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), fc.constantFrom("name", "person", "founder"), async (name, missing) => {
      const folder = await tempFolder("p12-empty-");
      const source = join(folder, "view.tsx");
      const w = recorded(folder, source, "export const view = 1;", false);
      const argv = process.argv;
      vi.stubEnv("FABRIKA_HOME", folder);
      cli.layer = w.layer;
      process.argv = [
        process.execPath,
        "dev.ts",
        "--child",
        `--parent=${process.ppid}`,
        ...Arr.map(
          Arr.filter(["name", "person", "founder"], (field) => field !== missing),
          (field) => `--${field}=${name}`,
        ),
      ];

      try {
        vi.resetModules();
        await import("../dev.ts");
        instanceFailure(await Effect.runPromiseExit(cli.work!), "settings");
        expect(Arr.filter(w.calls, ([call]) => call === "write" || call === "temp")).toEqual([]);
      } finally {
        process.argv = argv;
        cli.layer = undefined;
        cli.work = undefined;
        vi.unstubAllEnvs();
        await removeFolder(folder);
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 3, full: 15 }) },
  );
});

it("build returns BuildError for malformed compiler ledger bytes supplied by FileSystem", async () => {
  const encoded = Schema.fromJsonString(Schema.Array(Row));

  const invalid = fc
    .oneof(
      fc.string(),
      fc.jsonValue().map((value) => JSON.stringify(value)),
    )
    .filter((text) => !Schema.is(encoded)(text));

  await fc.assert(
    fc.asyncProperty(invalid, async (raw) => {
      const folder = await tempFolder("p12-ledger-fs-"),
        source = join(folder, "view.tsx");

      const w = recorded(folder, source, "export const view = 1;", false);
      w.files.set(join(root, "compiler-ledger.json"), raw);
      await writeText(source, "export const view = 1;");

      try {
        const exit = await Effect.runPromiseExit(build({ out: w.out, files: [source] }).pipe(Effect.provide(w.layer)));
        expect(Exit.isFailure(exit)).toBe(true);
        const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
        expect(Cause.hasDies(cause)).toBe(false);
        expect(Cause.hasFails(cause)).toBe(true);
        expect(Cause.findErrorOption(cause)).toMatchObject({
          _tag: "Some",
          value: { _tag: "BuildError", reason: "read" },
        });
        expect(Arr.filter(w.calls, ([call]) => call === "write" || call === "rename")).toEqual([]);
      } finally {
        await removeFolder(folder);
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [["{"], ["null"], ['[{"file":17}]']] },
  );
});

it("dev returns InstanceError for malformed saved settings without writing or building", async () => {
  const invalid = fc
    .oneof(
      fc.string(),
      fc.jsonValue().map((value) => JSON.stringify(value)),
    )
    .filter((text) => {
      try {
        const raw: unknown = JSON.parse(text);

        return !Predicate.isObjectOrArray(raw) || !("name" in raw);
      } catch {
        return true;
      }
    });

  await fc.assert(
    fc.asyncProperty(invalid, async (raw) => {
      const folder = await tempFolder("p12-settings-fs-"),
        source = join(folder, "view.tsx"),
        file = join(folder, "instance.json");

      const w = recorded(folder, source, "export const view = 1;", false);
      w.files.set(file, raw);
      await writeText(file, raw);
      const argv = process.argv;
      vi.stubEnv("FABRIKA_HOME", folder);
      cli.layer = w.layer;
      cli.work = undefined;
      process.argv = [process.execPath, "dev.ts", "--child", `--parent=${process.ppid}`];

      try {
        vi.resetModules();
        await import("../dev.ts");
        expect(cli.work).toBeDefined();
        const exit = await Effect.runPromiseExit(cli.work!);
        expect(Exit.isFailure(exit)).toBe(true);
        const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
        expect(Cause.hasDies(cause)).toBe(false);
        expect(Cause.hasFails(cause)).toBe(true);
        expect(Cause.findErrorOption(cause)).toMatchObject({
          _tag: "Some",
          value: { _tag: "InstanceError", reason: "settings" },
        });
        expect(Arr.filter(w.calls, ([call]) => call === "write" || call === "temp")).toEqual([]);
      } finally {
        process.argv = argv;
        cli.layer = undefined;
        cli.work = undefined;
        vi.unstubAllEnvs();
        await removeFolder(folder);
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [["{"], ["null"], ["{}"]] },
  );
});

it.effect.prop(
  "L10 [secrets] invalid saved legacy ports never reach warning logs across replacement and restart flows",
  [
    Arbitrary.schema(
      Schema.Struct({ word: Schema.String.check(Schema.isUUID()), mark: Schema.Literals(['"', "+", "/", "&", " "]) }),
    ).pipe(Arbitrary.map(({ word, mark }) => `private-${word}${mark}end`)),
    Declarations.port.schema,
    Arbitrary.schema(Schema.Json).pipe(Arbitrary.filter((value) => !Schema.is(Declarations.port.schema)(value))),
    Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))), {
      minLength: 3,
      maxLength: 8,
    }),
  ],
  ([secret, port, invalid, choices]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const argv = yield* Effect.acquireRelease(
          Effect.sync(() => process.argv),
          (argv) =>
            Effect.sync(() => {
              process.argv = argv;
              cli.layer = undefined;
              cli.work = undefined;
              vi.unstubAllEnvs();
            }),
        );

        // Only the counted FileSystem sees this home. No real folder or Worker is opened.
        const folder = join(tmpdir(), `t753-saved-port-${choices[0]}`),
          file = join(folder, "instance.json"),
          source = join(folder, "view.tsx");

        const w = recorded(folder, source, "export const view = 1;", false);

        const founding = {
          name: "test-project",
          person: "test-person",
          founder: "test-public",
          window: null,
          build: "old",
        };

        vi.stubEnv("FABRIKA_HOME", folder);
        vi.stubEnv(Declarations.port.env, undefined);
        cli.layer = w.layer;
        process.argv = [
          argv[0]!,
          "dev.ts",
          "--child",
          `--parent=${process.ppid}`,
          ...Arr.map(["name", "person", "founder"], (field) => `--${field}=test`),
        ];

        for (const choice of choices) {
          const moves = w.files.has(file) ? ["reopen", "replace", "valid", "remove"] : ["replace", "valid"];
          const move = moves[choice % moves.length];

          if (move === "remove") {
            w.files.delete(file);
          } else if (move === "replace" || move === "valid") {
            const rejected = [secret, [secret], { value: secret }, invalid];
            w.files.set(
              file,
              Formatter.formatJson({
                ...founding,
                port: move === "valid" ? port : rejected[Math.floor(choice / moves.length) % rejected.length],
              }),
            );
          }

          const saved = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
            w.files.get(file) ?? "{}",
          );

          const refused = saved.port !== undefined && !Schema.is(Declarations.port.schema)(saved.port);
          const entries: Array<{ readonly level: string; readonly text: string }> = [];

          const logger = Logger.layer([
            Logger.make((entry) => {
              entries.push({ level: entry.logLevel, text: Logger.formatJson.log(entry) });
            }),
          ]);

          const before = w.calls.length;
          instances.length = 0;
          cli.work = undefined;
          vi.resetModules();
          yield* Effect.tryPromise({
            try: () => import("../dev.ts"),
            catch: (cause: unknown) => ImportError.make({ message: "dev import failed", cause }),
          });
          expect(cli.work).toBeDefined();

          const exit = yield* Effect.exit(
            cli.work!.pipe(Effect.provide(logger), Effect.provideService(References.MinimumLogLevel, "All")),
          );

          for (const entry of entries) {
            for (const form of [secret, Str.slice(1, -1)(Formatter.formatJson(secret)), encodeURIComponent(secret)]) {
              expect(entry.text).not.toContain(form);
            }
          }

          if (refused) {
            expect(Arr.filter(entries, (entry) => entry.level === "Warn")).toEqual([]);
            instanceFailure(exit, "settings");
            expect(
              Arr.filter(
                w.calls.slice(before),
                ([call, path]) => call === "write" || call === "temp" || path === source,
              ),
            ).toEqual([]);
            expect(instances).toEqual([]);
          } else {
            expect(Arr.map(instances, (instance) => instance.port)).toEqual([Declarations.port.default]);
            expect(Arr.some(entries, (entry) => entry.level === "Warn")).toBe(saved.port !== undefined);
          }
        }
      }),
    ),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }) } },
);

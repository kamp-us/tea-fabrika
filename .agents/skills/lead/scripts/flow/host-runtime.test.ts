// Today's lead tooling, ticket 1132. Only in-memory filesystem and process services run here.
// Pinned discovery and real host cleanup remain in host.test.ts for disposable CI.
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { runCommands } from "./host.ts";

const memory = () => {
  const calls: ChildProcess.StandardCommand[] = [];
  let log = "";

  const fs = FileSystem.layerNoop({
    writeFileString: (_path, text) =>
      Effect.sync(() => {
        log += text;
      }),
    sink: () => Sink.drain,
  });

  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("fixture expects one shell command");
        }

        calls.push(command);

        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.die("fixture never signals a process"),
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.make(new TextEncoder().encode("fixture command ended\n")),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    ),
  );

  return { calls, log: () => log, layer: Layer.merge(fs, spawner) };
};

describe("host runtime environment without real processes", () => {
  it.effect.prop(
    "property: no pin keeps caller values and explicit removals for every command",
    { value: Schema.String, path: Schema.String },
    ({ value, path }) =>
      Effect.gen(function* () {
        const world = memory();

        const env = {
          PATH: path,
          HOST_RUNTIME_KEEP: value,
          HOST_RUNTIME_REMOVE: undefined,
          FABRIKA_HOME: "/fixture/home",
          TMPDIR: "/fixture/tmp",
          FABRIKA_FOREGROUND: undefined,
          TYPESAFE_API_KEY: undefined,
        };

        const result = yield* runCommands("/fixture", ["first", "second"], env, "/fixture/log", 1).pipe(
          Effect.provide(world.layer),
        );

        expect(result).toBeNull();
        expect(world.calls).toHaveLength(2);

        for (const command of world.calls) {
          const child = command.options.env;
          expect(command.command).toBe("sh");
          expect(child?.PATH).toBe(path);
          expect(child?.HOST_RUNTIME_KEEP).toBe(value);
          expect(Object.hasOwn(child ?? {}, "HOST_RUNTIME_REMOVE")).toBe(true);
          expect(child?.HOST_RUNTIME_REMOVE).toBeUndefined();
          expect(child?.FABRIKA_HOME).toBe("/fixture/home");
          expect(child?.TMPDIR).toBe("/fixture/tmp");
          expect(Object.hasOwn(child ?? {}, "FABRIKA_FOREGROUND")).toBe(true);
          expect(Object.hasOwn(child ?? {}, "TYPESAFE_API_KEY")).toBe(true);
          expect(child?.FABRIKA_FOREGROUND).toBeUndefined();
          expect(child?.TYPESAFE_API_KEY).toBeUndefined();
        }

        expect(world.log()).toBe("$ first\n$ second\n");
      }),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});

// P39 slice 4b, next/: a fake `ChildProcessSpawner` for the real command layer's merge-line laws (C1
// and C2 in `CommandsNode.laws.test.ts`), made with Effect's own `ChildProcessSpawner.make`. It starts
// no process: each child is a script of chunks, an exit code, and a scope whose close is counted.
// It also reads the real git lines C4's runs saved (`fixtures/next/hands/git-version.json`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Deferred, Effect, Layer, PlatformError, Schema, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import type { ChildProcess } from "effect/process";

/** One child as a script: what it prints, in order, on which stream, how it ends, and whether it starts. */
export type Child = {
  readonly spawn: "ok" | "fails";
  readonly chunks: ReadonlyArray<{ readonly to: "out" | "err"; readonly bytes: Uint8Array }>;
  readonly code: number;
  /** A child that never stops printing or exits until it is killed. */
  readonly endless: boolean;
};

/** What the fake spawner saw: each command it was given, and each child's open and close. */
export type Seen = {
  readonly commands: Array<ChildProcess.StandardCommand>;
  spawns: number;
  closes: number;
};

export const fresh = (): Seen => ({ commands: [], spawns: 0, closes: 0 });

const spawnFailure = () =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect's PlatformError takes its system error tag as `_tag`
  PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn", pathOrDescriptor: "git" });

/** A spawner that plays `child` for every command, recording what it was given into `seen`. */
export const spawner = (child: Child, seen: Seen) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (command._tag !== "StandardCommand") {
          return yield* Effect.die("the hands spawn one command, never a pipeline");
        }

        seen.commands.push(command);

        if (child.spawn === "fails") {
          return yield* spawnFailure();
        }

        const killed = yield* Deferred.make<void>();
        const tail = child.endless ? Stream.never : Stream.empty;
        const on = (to: "out" | "err") =>
          Stream.fromIterable(child.chunks.filter((c) => c.to === to).map((c) => c.bytes)).pipe(Stream.concat(tail));
        return yield* Effect.acquireRelease(
          Effect.sync(() => {
            seen.spawns++;
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(4100 + seen.spawns),
              exitCode: child.endless
                ? Deferred.await(killed).pipe(Effect.andThen(Effect.fail(spawnFailure())))
                : Effect.succeed(ChildProcessSpawner.ExitCode(child.code)),
              isRunning: Deferred.isDone(killed).pipe(Effect.map((done) => child.endless && !done)),
              kill: () => Deferred.succeed(killed, undefined).pipe(Effect.asVoid),
              stdin: Sink.drain,
              stdout: on("out"),
              stderr: on("err"),
              all: Stream.fromIterable(child.chunks.map((c) => c.bytes)).pipe(Stream.concat(tail)),
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            });
          }),
          () =>
            Effect.gen(function* () {
              seen.closes++;
              yield* Deferred.succeed(killed, undefined);
            }),
        );
      }),
    ),
  );

const Vectors = Schema.fromJsonString(
  Schema.Struct({
    vectors: Schema.Array(Schema.Struct({ from: Schema.String, stdout: Schema.String, version: Schema.String })),
  }),
);

/** The real git lines C4's runs saved: what git printed, and what `execute` answers for it. */
export const gitVectors = Schema.decodeUnknownEffect(Vectors)(
  readFileSync(resolve(import.meta.dirname, "../../../../../../fixtures/next/hands/git-version.json"), "utf8"),
).pipe(Effect.map(({ vectors }) => vectors));

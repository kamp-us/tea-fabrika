// next/, test support. A real child process a law starts and watches, such as dev.ts, through
// Effect's ChildProcess. Read through its module, as port.test-support is.
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Scope, Stream } from "effect";
import type { ChildProcess } from "effect/process";

/** A started child: its pid, whether it still runs, and a stop that ends it and waits for its exit. */
export interface Child {
  readonly pid: number;
  readonly running: Effect.Effect<boolean>;
  readonly stop: Effect.Effect<void>;
}

/**
 * Starts `command` in a scope of its own and hands its stdout and stderr text to `heard`. `stop`
 * closes that scope: Effect's spawner sends SIGTERM to the child's process group and waits for it
 * to exit. A stop after the child ended does nothing more.
 */
export const start = Effect.fnUntraced(function* (command: ChildProcess.Command, heard: (text: string) => void) {
  const scope = yield* Scope.make();

  const handle = yield* Effect.gen(function* () {
    const handle = yield* command;

    yield* handle.all.pipe(
      Stream.decodeText(),
      Stream.runForEach((text) => Effect.sync(() => heard(text))),
      Effect.forkScoped,
    );

    return handle;
  }).pipe(Effect.provideService(Scope.Scope, scope), Effect.provide(NodeServices.layer), Effect.orDie);

  const child: Child = {
    pid: handle.pid,
    running: handle.isRunning.pipe(Effect.orElseSucceed(() => false)),
    stop: Scope.close(scope, Exit.void),
  };

  return child;
});

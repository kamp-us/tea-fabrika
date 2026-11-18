// CommandsProcess.layer: the Commands service on Effect's ChildProcess. Each command reads nothing
// from stdin and writes its output on ours, as `subprocess.call` did in the old script. It runs with
// `detached: false`, in our process group: Effect's spawner detaches by default
// (`effect/src/process/ChildProcess.ts`, `detached`), which would put the compiler in a group of its
// own, so a kill of the typecheck's group or a Ctrl-C in its terminal would leave the compiler
// running. Today's tooling (0113), following next/'s rules (0033).
import { Effect, Layer, Option, type PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { type Command, CommandError, Commands, Ended } from "./Commands.ts";
import type { LockError } from "./Locks.ts";

// The spawner fails `exitCode` with the signal's name in its cause's message when the command was
// stopped by one (`@effect/platform-node-shared/src/NodeChildProcessSpawner.ts`, `exitCode`).
const SIGNAL = /receipt of signal: '(SIG[A-Z0-9]+)'/;

const commandLine = (command: Command) => [command.cmd, ...command.args].join(" ");

/** How a command ended, from the error its exit code failed with: a signal, or a failure to name. */
const endedBy = (command: Command) => (e: PlatformError.PlatformError) => {
  const signal = SIGNAL.exec(String(e.cause))?.[1];
  return signal === undefined
    ? Effect.fail(new CommandError({ command: commandLine(command), reason: e.message, cause: e }))
    : Effect.succeed(Ended.cases.signaled.make({ signal }));
};

export const layer: Layer.Layer<Commands, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
  Commands,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const run = Effect.fn("CommandsProcess.run")(
      function* (command: Command, started: (pid: Option.Option<number>) => Effect.Effect<void, LockError>) {
        const handle = yield* ChildProcess.make(command.cmd, [...command.args], {
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
          detached: false,
          ...(command.env === undefined ? {} : { env: command.env, extendEnv: true }),
        }).pipe(
          Effect.mapError(
            (e) =>
              new CommandError({ command: commandLine(command), reason: `does not start: ${e.message}`, cause: e }),
          ),
        );
        yield* started(Option.some(handle.pid));
        const ended = yield* handle.exitCode.pipe(
          Effect.map((code) => Ended.cases.exited.make({ code: Number(code) })),
          Effect.catch(endedBy(command)),
        );
        yield* started(Option.none());
        return ended;
      },
      Effect.scoped,
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return Commands.of({ run });
  }),
);

// next/, a test fixture. The memory sample's stand-in: the brain reads a process's memory with
// `ps -o rss= -p <pid>`, and a test answers that one command with the size it picks, so no test
// grows a process on purpose and no test samples a pid it made up.
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * Layer over the real `ChildProcessSpawner` that answers `ps -o rss= -p <pid>` with `kib(pid)`, the
 * size in KiB as `ps` prints it, and spawns everything else, that `ps` for a pid `kib` answers null
 * for included, through the real spawner.
 */
export const rssStandIn = (kib: (pid: number) => number | null) =>
  Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const real = yield* ChildProcessSpawner.ChildProcessSpawner;

      return ChildProcessSpawner.make((command) => {
        const sample =
          ChildProcess.isStandardCommand(command) &&
          command.command === "ps" &&
          command.args.length === 4 &&
          command.args[0] === "-o" &&
          command.args[1] === "rss=" &&
          command.args[2] === "-p";

        const answer = sample ? kib(Number(command.args[3])) : null;

        if (answer === null) {
          return real.spawn(command);
        }

        const stdout = Stream.make(new TextEncoder().encode(`${answer}\n`));

        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(0),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout,
            stderr: Stream.empty,
            all: stdout,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        );
      });
    }),
  );

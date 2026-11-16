/**
 * A fixture for the local brain driver's tests: the memory sample's command, answered without
 * starting an OS process.
 *
 * @stability unstable
 */
import { Effect, Function, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";

type OnSpawn = (command: string, args: ReadonlyArray<unknown>) => void;

type RssOptions = { readonly onSpawn?: OnSpawn | undefined };

const rssLayerBody = (sample: () => number, { onSpawn }: RssOptions = {}) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (command._tag === "StandardCommand") {
          onSpawn?.(command.command, command.args);
        }

        const stdout = Stream.make(new TextEncoder().encode(String(sample())));
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(27000),
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
        });
      }),
    ),
  );

/**
 * Layer that provides a `ChildProcessSpawner` whose every command exits with 0 at once and prints
 * `sample()` on stdout, so the driver's memory check reads a chosen number and no OS process
 * starts. `onSpawn`, when given, hears each standard command with its arguments. It is an option,
 * so a piped call (an option or nothing) never reads as a direct one (the sample, a function).
 *
 * @stability unstable
 * @category layers
 */
export const rssLayer: {
  (options?: RssOptions): (sample: () => number) => ReturnType<typeof rssLayerBody>;
  (sample: () => number, options?: RssOptions): ReturnType<typeof rssLayerBody>;
} = Function.dual((args) => typeof args[0] === "function", rssLayerBody);

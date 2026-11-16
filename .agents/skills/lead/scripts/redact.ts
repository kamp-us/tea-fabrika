// redact.ts: scrub an agent run's saved files and print only a count. The port of redact.sh
// (0113), with the same command line; today's lead tooling, [secrets].
//
//   node redact.ts <file>...
//       scrub each file in place; print `redacted N`. A file that cannot be scrubbed is removed,
//       the rest are still scrubbed, and the exit is 1.
//   node redact.ts --run <cwd> <prompt> <answer> <events> -- <command>...
//       run the command in <cwd> with no secret in its environment and a blank npm config, fed
//       <prompt>, its output saved to <events>; then scrub both files and print `redacted N`. The
//       exit is the command's, or 1 when the scrub or the config restore failed. `--` keeps every
//       word after it as the command's, flags included.
//
// The rules and the order of a run are in redact/Redact.ts and redact/RedactFs.ts. Nothing but the
// count is printed to stdout: never a matched value.

import { constants, tmpdir } from "node:os"; // edge: Effect has no signal number table, and the lock files need the one temp folder every process shares, not a scoped one
import { NodeServices } from "@effect/platform-node";
import { Console, Context, Effect, Layer, Runtime, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Redact } from "./redact/Redact.ts";
import * as RedactFs from "./redact/RedactFs.ts";
import * as LockFs from "./sys/LockFs.ts";

/** The command ended with a nonzero code: the run's own, or the scrub's. The process exits with it. */
export class Exited extends Schema.TaggedError<Exited>()("Exited", { code: Schema.Number }) {
  get [Runtime.errorExitCode](): number {
    return this.code;
  }
}

/** Success on 0, else the `Exited` failure that carries the code. */
const end = (code: number) => (code === 0 ? Effect.void : Effect.fail(Exited.make({ code })));

/**
 * The count a run printed, from its last `redacted N` line, read as a number; null when the output
 * holds no such line. drive.ts and chain.ts record it in a run row's `redacted` field.
 */
export const readCount = (out: string): number | null => {
  const word = [...out.matchAll(/^redacted (\d+)$/gm)].at(-1)?.[1];
  return word === undefined ? null : Number(word);
};

const USAGE = "usage: redact.ts <file>... | redact.ts --run <cwd> <prompt> <answer> <events> -- <command>...";

export const redact = Command.make(
  "redact",
  {
    run: Flag.Boolean("run").pipe(
      Flag.withDescription("Run a command first, then scrub its answer and events files"),
      Flag.withDefault(false),
    ),
    words: Argument.String("words").pipe(
      Argument.withDescription("The files to scrub; with --run, the folder, the three files and the command"),
      Argument.variadic(),
    ),
  },
  ({ run, words }) =>
    Effect.gen(function* () {
      const redacting = yield* Redact;

      if (!run) {
        const scrubbed = yield* redacting.files(words);
        yield* Console.log(`redacted ${scrubbed.count}`);
        return yield* end(scrubbed.failed.length === 0 ? 0 : 1);
      }

      const [cwd, prompt, answer, events, ...command] = words;

      if (cwd === undefined || prompt === undefined || answer === undefined || events === undefined) {
        yield* Console.error(USAGE);
        return yield* end(2);
      }

      const ran = yield* redacting.run({ cwd, prompt, answer, events, command });

      if (ran.redacted !== null) {
        yield* Console.log(`redacted ${ran.redacted}`);
      }

      return yield* end(ran.code);
    }),
);

/** The signals a run stops on, as redact.sh's did: the child's wait ends, and the scrub still runs. */
const SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

/**
 * NodeRuntime.runMain's own loop, with SIGHUP added and each signal's exit code: 128 and its
 * number, as a shell reports it and redact.sh did, where runMain reports 130 for every signal.
 */
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  let signalled = false;
  const listeners = SIGNALS.map((signal) => {
    const stop = () => {
      signalled = true;
      fiber.interruptUnsafe(fiber.id, Context.make(Runtime.InterruptExitCode, 128 + constants.signals[signal]));
    };
    process.on(signal, stop);
    return () => process.off(signal, stop);
  });

  fiber.addObserver((exit) => {
    for (const off of listeners) {
      off();
    }

    teardown(exit, (code) => {
      if (signalled || code !== 0) {
        process.exit(code);
      }
    });
  });
});

if (import.meta.main) {
  const env = process.env;
  const services = RedactFs.layer(env).pipe(
    Layer.provide(LockFs.layer(tmpdir())),
    Layer.provideMerge(NodeServices.layer),
  );
  runMain(Command.runWith(redact, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(services)), {
    disableErrorReporting: true,
  });
}

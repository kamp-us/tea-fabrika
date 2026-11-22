// A stand-in for the process spawner: it answers each git command from a script, records every command
// with its environment, and counts how many child scopes have ended, so a law can see a child was ended
// without a real signal.
import { Effect, Layer, PlatformError, Predicate, Ref, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { Command } from "effect/process/ChildProcess";

/** One git command as the stand-in saw it. `verb` is the plumbing command, after the global options. */
export interface Call {
  readonly args: ReadonlyArray<string>;
  readonly verb: string;
  readonly rest: ReadonlyArray<string>;
  readonly extendEnv: boolean | undefined;
  readonly env: Readonly<Record<string, string>>;
}

/** What a command does: exit with a code and output, never exit, or fail to start. */
export type Reply =
  | { readonly code: number; readonly stdout?: string; readonly stderr?: string }
  | "hang"
  | "cannot start";

interface StandIn {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly calls: Effect.Effect<ReadonlyArray<Call>>;
  /** How many child scopes have ended. */
  readonly ended: Effect.Effect<number>;
}

const encoder = new TextEncoder();

const split = (args: ReadonlyArray<string>): Pick<Call, "verb" | "rest"> => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";

    if (arg === "-c") {
      i += 1;
    } else if (!arg.startsWith("-")) {
      return { verb: arg, rest: args.slice(i + 1) };
    }
  }

  return { verb: "", rest: [] };
};

const commandFrom = (command: Command): Call | undefined => {
  if (!ChildProcess.isStandardCommand(command)) {
    return undefined;
  }

  const args = command.args.map((word) => (Predicate.isString(word) ? word : "<redacted>"));
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(command.options.env ?? {})) {
    if (value !== undefined) {
      env[key] = Predicate.isString(value) ? value : "<redacted>";
    }
  }

  return { args, ...split(args), extendEnv: command.options.extendEnv, env };
};

/** A spawner that answers from `script`, which sees every command and says what it does. */
export const standIn = (script: (call: Call) => Reply): Effect.Effect<StandIn> =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<Call>>([]);
    const ended = yield* Ref.make(0);

    const spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"] = (command) =>
      Effect.gen(function* () {
        const call = commandFrom(command);

        if (call === undefined) {
          return yield* Effect.die("the stand-in runs standard commands only");
        }

        yield* Ref.update(calls, (all) => [...all, call]);
        yield* Effect.addFinalizer(() => Ref.update(ended, (n) => n + 1));
        const reply = script(call);

        if (reply === "cannot start") {
          return yield* PlatformError.badArgument({
            module: "ChildProcess",
            method: "spawn",
            description: "the stand-in cannot start",
          });
        }

        const out = reply === "hang" ? Stream.never : Stream.make(encoder.encode(reply.stdout ?? ""));
        const err = reply === "hang" ? Stream.never : Stream.make(encoder.encode(reply.stderr ?? ""));

        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: reply === "hang" ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(reply.code)),
          isRunning: Effect.succeed(reply === "hang"),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: out,
          stderr: err,
          all: reply === "hang" ? Stream.never : Stream.merge(out, err),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      });

    return {
      layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(ChildProcessSpawner.make(spawn)),
      calls: Ref.get(calls),
      ended: Ref.get(ended),
    };
  });

// A stand-in for the process spawner: it answers each git command from a script, records every command
// with its environment, and counts how many child scopes have ended, so a law can see a child was ended
// without a real signal.
import { Duration, Effect, Layer, Option, PlatformError, Predicate, Ref, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { Command } from "effect/process/ChildProcess";
import { byBytes } from "./internal/object.ts";

/** One git command as the stand-in saw it. `verb` is the plumbing command, after the global options. */
export interface Call {
  readonly args: ReadonlyArray<string>;
  readonly verb: string;
  readonly rest: ReadonlyArray<string>;
  readonly extendEnv: boolean | undefined;
  /** How long the command's scope waits after the first signal before it kills the child outright, if it says. */
  readonly forceKillAfter: Duration.Duration | undefined;
  readonly env: Readonly<Record<string, string>>;
  /** What the command was given on stdin, byte for byte, or undefined when it was given none. */
  readonly input: Uint8Array | undefined;
}

/**
 * What a command does: exit with a code and output (stderr may come in several chunks), never exit, never exit and
 * ignore the first signal, or fail to start.
 *
 * A child that ignores the first signal ends only when its scope kills it outright, which the scope does after the
 * command's `forceKillAfter` and never without one, as Effect's Node spawner does.
 */
export type Reply =
  | { readonly code: number; readonly stdout?: string; readonly stderr?: string | ReadonlyArray<string> }
  | "hang"
  | "hang, ignores the first signal"
  | "cannot start";

interface StandIn {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly calls: Effect.Effect<ReadonlyArray<Call>>;
  /** How many children are dead: their scope has ended and, for a child that ignores a signal, it was killed. */
  readonly ended: Effect.Effect<number>;
}

const encoder = new TextEncoder();

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const whole = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.length;
  }

  return whole;
};

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

const commandFrom = (command: Command): Omit<Call, "input"> | undefined => {
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

  const forceKillAfter =
    command.options.forceKillAfter === undefined
      ? undefined
      : Option.getOrUndefined(Duration.fromInput(command.options.forceKillAfter));

  return { args, ...split(args), extendEnv: command.options.extendEnv, forceKillAfter, env };
};

/** A spawner that answers from `script`, which sees every command and says what it does. */
export const standIn = (script: (call: Call) => Reply): Effect.Effect<StandIn> =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<Call>>([]);
    const ended = yield* Ref.make(0);

    const spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"] = (command) =>
      Effect.gen(function* () {
        const made = commandFrom(command);

        if (made === undefined) {
          return yield* Effect.die("the stand-in runs standard commands only");
        }

        const configured = ChildProcess.isStandardCommand(command) ? command.options.stdin : undefined;

        const stdin =
          configured !== undefined && !Predicate.isString(configured) && "stream" in configured
            ? configured.stream
            : configured;

        const given = stdin === undefined || Predicate.isString(stdin) ? undefined : stdin;

        const input = given === undefined ? undefined : concat(yield* Effect.orDie(Stream.runCollect(given)));

        const call: Call = { ...made, input };

        yield* Ref.update(calls, (all) => [...all, call]);
        const reply = script(call);

        yield* Effect.addFinalizer(() =>
          reply === "hang, ignores the first signal"
            ? Effect.andThen(
                call.forceKillAfter === undefined ? Effect.never : Effect.sleep(call.forceKillAfter),
                Ref.update(ended, (n) => n + 1),
              )
            : Ref.update(ended, (n) => n + 1),
        );

        if (reply === "cannot start") {
          return yield* PlatformError.badArgument({
            module: "ChildProcess",
            method: "spawn",
            description: "the stand-in cannot start",
          });
        }

        const stuck = reply === "hang" || reply === "hang, ignores the first signal";

        const chunks = (text: string | ReadonlyArray<string> | undefined) =>
          Stream.fromIterable(Predicate.isString(text) ? [text] : (text ?? [""])).pipe(
            Stream.map((chunk) => encoder.encode(chunk)),
          );

        const out = stuck ? Stream.never : chunks(reply.stdout);
        const err = stuck ? Stream.never : chunks(reply.stderr);

        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: stuck ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(reply.code)),
          isRunning: Effect.succeed(stuck),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: out,
          stderr: err,
          all: stuck ? Stream.never : Stream.merge(out, err),
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

/** What a stand-in's git holds, for the questions an adapter asks around a call: its commits, its trees and its refs. */
export interface Table {
  readonly commits: ReadonlyArray<string>;
  readonly trees: ReadonlyArray<string>;
  readonly refs: ReadonlyArray<readonly [name: string, commit: string]>;
}

const decoder = new TextDecoder();

// git's own rule for a pattern without a wildcard: the ref itself, or a ref below it.
const matches = (name: string, pattern: string): boolean => name === pattern || name.startsWith(`${pattern}/`);

const printed = (format: string, name: string, commit: string): string =>
  format
    .replaceAll("%(objectname)", commit)
    .replaceAll("%(objecttype)", "commit")
    .replaceAll("%(symref)", "")
    .replaceAll("%(refname)", name);

/**
 * A script that answers what git answers around a call (the version, whether the repository is shallow, which objects
 * exist, which refs exist and where they point), from a table. Whatever else is asked goes to `rest`. It answers
 * `for-each-ref` for any pattern, count and format built of the four names `objectname`, `objecttype`, `symref` and
 * `refname`, so a law holds an adapter to git's answer and not to one way of asking.
 */
export const gitTable =
  (table: Table, rest: (call: Call) => Reply = () => ({ code: 0 })) =>
  (call: Call): Reply => {
    switch (call.verb) {
      case "version":
        return { code: 0, stdout: "git version 2.40.1\n" };
      case "rev-parse":
        return { code: 0, stdout: call.rest.includes("--is-shallow-repository") ? "false\n" : ".\n" };
      case "cat-file": {
        if (!call.rest.includes("--batch-check")) {
          return rest(call);
        }

        const asked = decoder
          .decode(call.input ?? new Uint8Array())
          .split("\n")
          .filter((line) => line !== "");

        return {
          code: 0,
          stdout: asked
            .map((id) =>
              table.commits.includes(id)
                ? `${id} commit 200\n`
                : table.trees.includes(id)
                  ? `${id} tree 0\n`
                  : `${id} missing\n`,
            )
            .join(""),
        };
      }

      case "for-each-ref": {
        const format =
          call.rest.find((word) => word.startsWith("--format="))?.slice("--format=".length) ??
          "%(objectname) %(objecttype) %(refname)";

        const count = Number(call.rest.find((word) => word.startsWith("--count="))?.slice("--count=".length));
        const patterns = call.rest.filter((word) => !word.startsWith("--"));

        const found = table.refs
          .filter(([name]) => patterns.length === 0 || patterns.some((pattern) => matches(name, pattern)))
          .toSorted(([a], [b]) => byBytes(a, b))
          .slice(0, Number.isInteger(count) && count > 0 ? count : undefined);

        return { code: 0, stdout: found.map(([name, commit]) => `${printed(format, name, commit)}\n`).join("") };
      }

      default:
        return rest(call);
    }
  };

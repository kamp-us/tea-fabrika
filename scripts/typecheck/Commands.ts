// Commands: the commands a typecheck runs, each to its end, its output on ours. This file is the
// contract only (0095): `CommandsProcess.layer` starts real processes and `CommandsTest.layer`
// answers from memory. Today's tooling (0113), following next/'s rules (0033).
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";
import type { LockError } from "./Locks.ts";

/** One command: the program, its arguments, and variables set for it on top of ours. */
export type Command = {
  readonly cmd: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
};

/** How a command ended: with an exit code, or stopped by a signal, by its name. */
export const Ended = Schema.TaggedUnion({
  exited: { code: Schema.Int },
  signaled: { signal: Schema.String },
});

export type Ended = typeof Ended.Type;

/** A command could not start, or ended in a way that could not be read. */
export class CommandError extends Schema.TaggedError<CommandError>()("CommandError", {
  command: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class Commands extends Context.Service<
  Commands,
  {
    /**
     * Runs one command to its end, its output on ours. `started` hears its pid once it runs, and
     * `none` once it has ended.
     */
    readonly run: (
      command: Command,
      started: (pid: Option.Option<number>) => Effect.Effect<void, LockError>,
    ) => Effect.Effect<Ended, CommandError | LockError>;
  }
>()("scripts/typecheck/Commands") {}

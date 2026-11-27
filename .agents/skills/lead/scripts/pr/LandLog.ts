// LandLog: the record of what each `land.ts` command did, one line per event: it started, it is still alive, and how it ended.
// A command killed with no chance to write leaves its start line and no end line, which is how a later reader knows it died.
// This file is the contract only (a service file holds only its contract, and each layer is its own file): `LandLogFs.layer`
// keeps the lines in `runs/land/`, `LandLogTest.layer` keeps them in memory. Today's lead tooling, run on our own laptop; it is
// not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** A line could not be read or written. The reason never holds a local path. */
export class LandLogError extends Schema.TaggedError<LandLogError, { readonly brand: unique symbol }>()(
  "LandLogError",
  {
    reason: Schema.String,
  },
) {}

const At = Schema.String;

/** Ties a start line to its end: `${pid}.${start time in ms}`. */
const Attempt = Schema.String;

/** One line of the record. Every line names its `attempt`, so a reader pairs an end with its start however the lines interleave. */
export const Line = Schema.TaggedUnion({
  /** The command began, in process `pid`, with these arguments. Written before any work, since a death leaves nothing else. */
  started: {
    at: At,
    attempt: Attempt,
    pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    command: Schema.String,
    argv: Schema.Array(Schema.String),
  },
  /** The command is still alive: one line each period while it runs. */
  heartbeat: { at: At, attempt: Attempt },
  /** The command ended well. `said` is what it printed, one entry for each line it printed: `queued ...` is the fact a poller needs. */
  done: { at: At, attempt: Attempt, said: Schema.Array(Schema.String) },
  /** A check said no: which check and why, and nothing a child process printed. */
  refused: { at: At, attempt: Attempt, check: Schema.String, reason: Schema.String },
  /** The command broke: a failure that is no refusal, or a defect. */
  failed: { at: At, attempt: Attempt, reason: Schema.String },
  /** The command was stopped: a signal ended it, and its own cleanup ran. */
  interrupted: { at: At, attempt: Attempt },
});

export type Line = typeof Line.Type;

/**
 * A name that is safe in a file name: it starts with a letter or a digit, holds no slash, and is not all digits (`land.ts last` reads
 * digits as a pull request, so a quest so named could be written and never read). The record's file layer refuses a quest key that is
 * none, so a name read from a command line can never reach outside the record's folder.
 */
export const QuestName = Schema.String.check(Schema.isPattern(/^(?!\d+$)[A-Za-z0-9][A-Za-z0-9._-]*$/));

/** Where a command's lines go: a pull request, or a quest (`ready` and `run` know no pull request yet). */
export const Key = Schema.TaggedUnion({
  pr: { pr: Schema.Int },
  quest: { name: Schema.String },
});

export type Key = typeof Key.Type;

export class LandLog extends Context.Service<
  LandLog,
  {
    /** Appends one line to the key's record, on a line of its own. */
    readonly append: (key: Key, line: Line) => Effect.Effect<void, LandLogError>;
    /** Every line that reads, oldest first, and how many lines did not (a cut-short last line, or noise). No record is no lines. */
    readonly read: (
      key: Key,
    ) => Effect.Effect<{ readonly lines: ReadonlyArray<Line>; readonly torn: number }, LandLogError>;
  }
>()("lead/pr/LandLog") {}

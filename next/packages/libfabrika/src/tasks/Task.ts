/**
 * A task: work a program asks one selected set of hands to do. Its request, the executor that takes
 * it, the checked result and each writer's record, as values only (0095).
 */
import { Schema } from "effect";
import { TraceId } from "../ledger/Log.ts";
import { ProcessId } from "../ProcessId.ts";
import { ParentText, Rev } from "../Rev.ts";

const Text = Schema.NonEmptyString;

/** A capability a host advertises in its hello, such as `git`. */
const Capability = Text;

/**
 * Schema for the one supported command. A closed union: no shell text, no caller-chosen executable.
 *
 * @category models
 */
export const Command = Schema.TaggedUnion({
  git_version: {},
});
/**
 * The one supported command: `git_version`.
 *
 * @category models
 */
export type Command = typeof Command.Type;

/**
 * The capabilities a command needs: a fact about the command, never a caller's choice.
 *
 * @category models
 */
export const needs = (command: Command): ReadonlyArray<string> => NEEDS[command._tag];

/** Each command's trusted declaration. A new command fails to compile until it says what it needs. */
const NEEDS: Record<Command["_tag"], ReadonlyArray<string>> = { git_version: ["git"] };

/**
 * Schema for the checked terminal answer. `unknown` is a crash between start and a saved result.
 *
 * @category models
 */
export const Result = Schema.TaggedUnion({
  exited: { code: Schema.Int, version: Schema.String },
  failed: { reason: Schema.Literals(["unavailable", "spawn_failed", "output_limit"]) },
  unknown: { reason: Schema.Literal("interrupted") },
});
/**
 * The checked terminal answer: `exited` with a code and version, `failed` with a reason, or
 * `unknown` after a crash between start and a saved result.
 *
 * @category models
 */
export type Result = typeof Result.Type;

/**
 * Schema for what a program asked for, with every fact that exists only when it asked.
 *
 * @category models
 */
export const Request = Schema.Struct({
  /** The dispatched Cmd's id, `<process>/<pos>/<index>`: no second id for the same command. */
  id: Text,
  /** The exact process generation that asked. */
  process: ProcessId,
  /** The registered program name. */
  name: Text,
  /** The pack-qualified program, `<pack>/<program>`. */
  program: Text,
  command: Command,
  /** The capabilities the command's trusted declaration needs. */
  needs: Schema.Array(Capability),
  /** The selected client key's fingerprint. */
  target: Text,
  /** The asking program's build. */
  build: Text,
  /** The effective settings hash, or null when no operational setting is used. */
  settings: Schema.NullOr(Text),
  /** The input that caused it, or null for an own request. */
  parent: Schema.NullOr(ParentText),
  /** Trace correlation, never authority. */
  traceId: TraceId,
});
/**
 * What a program asked for, with every fact that exists only when it asked.
 *
 * @category models
 */
export type Request = typeof Request.Type;

/**
 * Schema for the hands that take a task: their key, the connection they came on, what they
 * advertise and their build.
 *
 * @category models
 */
export const Executor = Schema.Struct({
  key: Text,
  connection: Text,
  has: Schema.Array(Capability),
  build: Text,
});
/**
 * The hands that take a task: their key, the connection they came on, what they advertise and their
 * build.
 *
 * @category models
 */
export type Executor = typeof Executor.Type;

/**
 * Schema for what a writer says about one call: who, for whom, its own clock, what it had seen, why
 * and its build.
 *
 * @category models
 */
export const Recorded = Schema.Struct({
  by: Text,
  for: Text,
  /** The writer's own clock. Shown, never decides. */
  sentAt: Schema.String,
  /** The last log rev the writer had folded. */
  seen: Rev,
  parent: Schema.NullOr(ParentText),
  traceId: TraceId,
  build: Text,
  /** Absent on trusted program calls and events saved before connection facts were recorded. */
  connection: Schema.optionalKey(Text),
  has: Schema.optionalKey(Schema.Array(Capability)),
});
/**
 * What a writer says about one call: who, for whom, its own clock, what it had seen, why and its
 * build.
 *
 * @category models
 */
export type Recorded = typeof Recorded.Type;

/**
 * Schema for the one execution a take allocated, and who holds it. Not a lease: it never moves.
 *
 * @category models
 */
export const Assignment = Schema.Struct({ execution: Text, executor: Executor });

/**
 * Schema for who took a finished task's result: the exact process generation that asked, and the id
 * of the answer letter the result went in.
 *
 * @category models
 */
export const Collection = Schema.Struct({ process: ProcessId, letter: Text });

/**
 * Schema for a task's control state: `absent`, `requested`, `assigned`, `started`, `finished` or
 * `collected`. Neither `finished` nor `collected` has a way back to execution.
 *
 * @category models
 */
export const State = Schema.TaggedUnion({
  absent: {},
  requested: { request: Request },
  assigned: { request: Request, assignment: Assignment },
  started: { request: Request, assignment: Assignment },
  finished: { request: Request, assignment: Assignment, result: Result },
  collected: { request: Request, assignment: Assignment, result: Result, collection: Collection },
});
/**
 * A task's control state: `absent`, `requested`, `assigned`, `started`, `finished` or `collected`.
 * Neither `finished` nor `collected` has a way back to execution.
 *
 * @category models
 */
export type State = typeof State.Type;

/**
 * Schema for one accepted call as the ledger kept it: the writer's record, and where and when it
 * arrived.
 *
 * @category models
 */
export const Event = Schema.Struct({
  ...Recorded.fields,
  event: Schema.Literals(["requested", "taken", "started", "finished", "collected"]),
  rev: Rev,
  /** The referee's clock, in ms since 1970. */
  arrivedAt: Schema.Int,
});
/**
 * One accepted call as the ledger kept it: the writer's record, and where and when it arrived.
 *
 * @category models
 */
export type Event = typeof Event.Type;

/**
 * Schema for a task as `read` answers it: its state, and every accepted event in order.
 *
 * @category models
 */
export const Task = Schema.Struct({ state: State, events: Schema.Array(Event) });
/**
 * A task as `read` answers it: its state, and every accepted event in order.
 *
 * @category models
 */
export type Task = typeof Task.Type;

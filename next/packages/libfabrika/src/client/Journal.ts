/**
 * The hands client's journal: one saved entry per task, written before each step that follows it,
 * so a crash never runs a command twice. This file is the contract only (0095); `JournalStore.layer`
 * keeps it on Effect's own `KeyValueStore`.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Rev } from "../Rev.ts";
import { Result } from "../tasks/Task.ts";

const Execution = Schema.NonEmptyString;

/** When the command started, on the client's own clock: the `executing` entry's `at`, kept by each
 *  entry after it, since each entry replaces the one before. Absent when no `executing` entry was
 *  read, as after a journal that was lost. */
const Started = { startedAt: Schema.optionalKey(Schema.String) };

/**
 * Schema for where one task stands on the machine that runs it. Each entry keeps the execution the
 * brain assigned and `at`, the client's own clock when it wrote it.
 *
 * **Details**
 *
 * `prepared`: taken, and nothing ran. `executing`: saved just before the command starts; found on a
 * reopen with no result after it, the task's result is `unknown interrupted`. `result`: the command's
 * result, saved before it is sent. `acknowledged`: the brain answered ok to the finish, at `rev`.
 * `held`: the brain refused the finish for good, for `reason`; the result is never sent again.
 *
 * @category models
 */
export const Entry = Schema.TaggedUnion({
  prepared: { execution: Execution, at: Schema.String },
  executing: { execution: Execution, at: Schema.String },
  result: { execution: Execution, result: Result, ...Started, at: Schema.String },
  acknowledged: { execution: Execution, result: Result, rev: Rev, ...Started, at: Schema.String },
  held: { execution: Execution, result: Result, reason: Schema.String, ...Started, at: Schema.String },
});

/**
 * The type of one journal entry.
 *
 * @category models
 */
export type Entry = typeof Entry.Type;

/**
 * A journal call failed. `storage`: the store could not read or write. `bad_entry`: a saved value
 * that is no entry. `cause` keeps the store's error underneath, when there is one.
 *
 * @category errors
 */
export class JournalError extends Schema.TaggedError<JournalError, { readonly brand: unique symbol }>()(
  "JournalError",
  {
    reason: Schema.Literals(["storage", "bad_entry"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/**
 * Service that keeps the hands client's journal: `read` answers a task's last entry, or null before
 * its first, and `write` replaces it.
 *
 * **Details**
 *
 * It needs no list of its keys: the brain is the index, and the client reads the entry of the task
 * the brain just assigned it.
 *
 * @category services
 */
export class Journal extends Context.Service<
  Journal,
  {
    readonly read: (task: string) => Effect.Effect<Entry | null, JournalError>;
    readonly write: (task: string, entry: Entry) => Effect.Effect<void, JournalError>;
  }
>()("@kampus/libfabrika/client/Journal") {}

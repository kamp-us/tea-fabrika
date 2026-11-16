/**
 * The contract for a program's watch on another process by its registered name: OTP's
 * `monitor(process, Name)` and `demonitor(Ref, [flush])`, checked against the member behind the
 * program. This file holds the contract only (0095); `MonitorsLedger.layer(...)` watches on the
 * ledger.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import { ProcessId } from "../ProcessId.ts";
import { type Recipient, Text } from "./internal/processTable.ts";
import type { From } from "./Mailbox.ts";
import { ProcessName } from "./Process.ts";

/**
 * One request to watch a name. `id` is the asking Cmd's own id, which becomes the watch's ref, so
 * a retried Cmd finds the same watch. The host binds the `watcher`, never the program.
 *
 * @stability unstable
 * @category models
 */
export type Watch = {
  readonly id: string;
  readonly name: string;
  readonly watcher: typeof Recipient.cases.process.Type;
};

/**
 * One request to end a watch: a `ref` the watcher got from a watch. Another watcher's ref is never
 * touched.
 *
 * @stability unstable
 * @category models
 */
export type Unwatch = {
  readonly ref: string;
  readonly watcher: typeof Recipient.cases.process.Type;
};

/**
 * Schema for what a watch answers: its `ref`, the `process` it binds, which is the name's life when
 * it was asked, and the `name` asked. The watch never follows the name to a later life.
 *
 * @stability unstable
 * @category schemas
 */
export const Watched = Schema.TaggedStruct("monitored", { ref: Text, process: ProcessId, name: ProcessName });

/**
 * Error for a watch that was refused or could not be saved.
 *
 * **Details**
 *
 * Every reason but `storage` is a refusal, and a refusal writes nothing:
 *
 * - `bad_name`: the name is not a process name.
 * - `stale_sender`: the watcher is no longer a live process, or the process the cause was
 *   delivered to has ended.
 * - `forbidden`: the member checked holds no `watch` on this fabrika, or its key was removed. With
 *   no member behind the watch, the name is neither the watcher's own child nor its starter.
 * - `no_name`: no process was ever registered under the name.
 *
 * `storage` means the ledger failed. The caller cannot tell whether the watch was saved, and may
 * ask again with the same id: a saved watch answers again.
 *
 * @stability unstable
 * @category errors
 */
export class MonitorsError extends Schema.TaggedError<MonitorsError, { readonly brand: unique symbol }>()(
  "MonitorsError",
  {
    /** A refusal, which writes nothing, or `storage`: the ledger failed, and the watch may be asked again. */
    reason: Schema.Literals(["bad_name", "stale_sender", "forbidden", "no_name", "storage"]),
    /** Only `storage` carries one, for the library caller; nothing renders it into an output. */
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/**
 * Service that watches a process by its registered name for a program, and ends that watch.
 *
 * **Details**
 *
 * `monitor` resolves the name once and binds its current life. In one turn it saves the watch, the
 * watcher's answer letter `<id>/answer`, and, for a life that already ended, its `DOWN` with
 * `noproc` after the answer. When the bound life ends later, the watcher gets one `DOWN` after
 * every letter that life sent. A restart under the name is a new life, which this watch never
 * sees.
 *
 * `demonitor` ends the watcher's own watch under `ref`, and a `DOWN` for it still unread is never
 * read. A ref the watcher never got writes nothing.
 *
 * @stability unstable
 * @category services
 */
export class Monitors extends Context.Service<
  Monitors,
  {
    readonly monitor: (watch: Watch, from: From) => Effect.Effect<typeof Watched.Type, MonitorsError>;
    readonly demonitor: (unwatch: Unwatch, from: From) => Effect.Effect<void, MonitorsError>;
  }
>()("@kampus/libfabrika/processes/Monitors") {}

/**
 * The contract for a pipe between two programs: the brain checks the member behind it (0551), checks
 * that it fits on the two programs' declared shapes (0550), and records it with both shapes (0553).
 * This file holds the contract only (0095); `PipesLedger.layer(...)` keeps pipes on the ledger.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import { Sender } from "../permissions/Senders.ts";
import { ProcessId } from "../ProcessId.ts";
import * as Fit from "./Fit.ts";
import { Text } from "./internal/processTable.ts";
import type { From } from "./Mailbox.ts";
import { ProcessName } from "./Process.ts";

/**
 * The ledger stream pipes live on. Only the brain's own rows count.
 *
 * @stability unstable
 * @category constants
 */
export const STREAM = "pipes";

/**
 * Schema for what a pipe answers: `piped` made it, under the pipe Cmd's own id, which stays stable on
 * a retry; `unfit` made nothing, and says where the two shapes part (0550).
 *
 * @stability unstable
 * @category schemas
 */
export const Piped = Schema.TaggedUnion({
  piped: { pipe: Schema.NonEmptyString },
  unfit: { fit: Fit.Unfit },
});

/**
 * Schema for why a pipe is refused. Each is final, and a refusal writes nothing but its answer.
 *
 * **Details**
 *
 * - `bad_name`: a name is not a process name, or both ends are one name.
 * - `no_program`: a program is not in the loaded builds.
 * - `stale_sender`: the asking life ended, or the cause went to a life that ended.
 * - `forbidden`: the member behind the Cmd may not pipe these programs, or there is no member.
 * - `no_output`: the writer declares no such output.
 * - `no_input`: the reader declares no such piped input, or no `DOWN` input.
 * - `name_taken`: a name already has a live process; a pipe is made before its ends start (0550).
 * - `taken`: that input already has a live pipe; a pipe never fans in.
 *
 * @stability unstable
 * @category schemas
 */
export const PipeRefusal = Schema.Literals([
  "bad_name",
  "no_program",
  "stale_sender",
  "forbidden",
  "no_output",
  "no_input",
  "name_taken",
  "taken",
]);

const Writer = Schema.Struct({ name: ProcessName, program: Text, output: Text, hash: Text, shape: Fit.Shape });
const Reader = Schema.Struct({ name: ProcessName, program: Text, input: Text, hash: Text, shape: Fit.Shape });

/**
 * Schema for the brain's pipe rows. `piped` keeps every fact that exists only at the moment of the
 * pipe: both programs' code hashes and declared shapes as the loader wrote them, the rule that judged
 * whether it fits, who asked and the member checked. `unpiped` ends it, when its requester stops
 * either end.
 *
 * @stability unstable
 * @category schemas
 */
export const PipeEvent = Schema.TaggedUnion({
  piped: {
    pipe: Text,
    from: Writer,
    to: Reader,
    rule: Schema.Literal(Fit.RULE),
    requester: Schema.Struct({ name: ProcessName, process: ProcessId }),
    member: Sender,
  },
  unpiped: { pipe: Text, reason: Schema.Literals(["stopped"]) },
});

/**
 * One end of a pipe as the runner asks for it: the registered name, its program, the port, the
 * program's code hash and the port's declared shape, all from the loader. A port the program does
 * not declare has no `shape` key; a `shape` of `null` is a port whose form could not be written.
 *
 * @stability unstable
 * @category models
 */
export type End = {
  readonly name: string;
  readonly program: string;
  readonly hash: string;
  readonly shape?: Fit.Shape;
};

/**
 * One request for a pipe. `id` is the pipe Cmd's own id, which becomes the pipe's id, so a retried
 * Cmd finds the same pipe. The runner binds the `requester`, never the program.
 *
 * @stability unstable
 * @category models
 */
export type Ask = {
  readonly id: string;
  readonly from: End & { readonly output: string };
  readonly to: End & { readonly input: string };
  readonly requester: { readonly name: string; readonly process: string };
};

/**
 * Schema for one pipe a name is an end of: its id, both ends as the `piped` row holds them, and
 * whether it is live.
 *
 * @stability unstable
 * @category schemas
 */
export const Listed = Schema.Struct({ pipe: Text, from: Writer, to: Reader, live: Schema.Boolean });
/**
 * One pipe a name is an end of, as `Listed` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Listed = typeof Listed.Type;

/**
 * Error for a pipe that was refused or could not be saved. Every reason but `storage` is a refusal,
 * which writes nothing. `storage` means the ledger failed: the pipe may be asked again with the same
 * id, and a saved one answers again.
 *
 * @stability unstable
 * @category errors
 */
export class PipesError extends Schema.TaggedError<PipesError>()("PipesError", {
  reason: Schema.Literals([...PipeRefusal.literals, "storage"]),
  /** Only `storage` carries one, for the library caller; nothing renders it into an output. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that pipes one program's output to another program's input, for a program.
 *
 * **Details**
 *
 * `pipe` checks, in order: the names, a saved pipe under the id (answered again), a live requester,
 * the member behind the Cmd, the two ports, that neither name is live, that the input has no live
 * pipe, then that the pipe fits. One ledger turn writes the `piped` row, the writer name's right to
 * mail the reader's name, and the requester's answer. An unfit pipe answers `unfit` and writes only
 * that answer.
 *
 * `list` answers the pipes a name is an end of: each live one, and the last one made into each of its
 * inputs, live or ended.
 *
 * @stability unstable
 * @category services
 */
export class Pipes extends Context.Service<
  Pipes,
  {
    readonly pipe: (ask: Ask, from: From) => Effect.Effect<typeof Piped.Type, PipesError>;
    readonly list: (name: string) => Effect.Effect<ReadonlyArray<Listed>, PipesError>;
  }
>()("@kampus/libfabrika/processes/Pipes") {}

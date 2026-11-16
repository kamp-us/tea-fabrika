/**
 * The relation store's contract (0095): the live tuples inside a ledger turn, and the writes that
 * change them. `RelationsLedger.layer(...)` keeps it on the ledger, `RelationsMemory.layer(...)` in
 * memory for tests.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect, Result } from "effect";
import type { LedgerTurn } from "../ledger/LedgerTransaction.ts";
import type { Line } from "../ledger/Log.ts";
import type { Change, Tuples } from "./Relation.ts";

/**
 * Error for a relation store that could not be read or written.
 *
 * **Details**
 *
 * `bad_row`: a row the store trusts does not decode. `storage`: the ledger failed or refused a
 * write, such as a change id used before for another row. The cause is kept.
 *
 * @stability unstable
 * @category errors
 */
export class RelationsError extends Schema.TaggedError<RelationsError, { readonly brand: unique symbol }>()(
  "RelationsError",
  {
    reason: Schema.Literals(["bad_row", "storage"]),
    cause: Schema.Defect(),
  },
) {}

/**
 * Service that keeps the relation rows.
 *
 * **Details**
 *
 * `within(turn)` folds the rows inside the caller's own ledger turn, so a check and the write it
 * allows read the same rows. `write(changes, writer)` writes each change once, by its id, as the
 * store's own writer: a resend of a change is kept as one row.
 *
 * **Gotchas**
 *
 * The memory layer ignores the turn: it answers from its own changes.
 *
 * @stability unstable
 * @category services
 */
export class Relations extends Context.Service<
  Relations,
  {
    readonly within: (turn: LedgerTurn) => Result.Result<Tuples, RelationsError>;
    readonly write: (
      changes: ReadonlyArray<Change>,
      writer: Omit<Line, "_tag" | "body">,
    ) => Effect.Effect<void, RelationsError>;
  }
>()("@kampus/libfabrika/permissions/Relations") {}

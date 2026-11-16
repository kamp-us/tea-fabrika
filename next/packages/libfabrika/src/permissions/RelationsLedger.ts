/**
 * The relation store on the ledger stream `permissions/relations`.
 *
 * @stability unstable
 */
import { Effect, Layer, Result, Schema, Record as Rec } from "effect";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { type Entry, lineFor, valueFor } from "../ledger/Log.ts";
import { fold } from "./internal/relationsTable.ts";
import { Row, STREAM, type Tuples } from "./Relation.ts";
import { Relations, RelationsError } from "./Relations.ts";

const decodeRow = Schema.decodeUnknownResult(Row);
const isRow = (entry: Entry): boolean => Rec.has<string, unknown>(Row.cases, entry._tag);

/**
 * Layer that provides `Relations` on the ledger, through `LedgerTransaction`.
 *
 * **Details**
 *
 * `by` is the brain's own writer key. `within` reads the stream in the caller's turn and folds only
 * the rows `by` wrote, so a program's write to the stream changes nothing. A row by `by` that does
 * not decode fails `bad_row`. `write` appends every change in one turn, each under its own id and
 * as `by`, whatever the writer it is given says; the referee keeps a resend as one row. A ledger
 * failure is `storage`, with its cause kept.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (config: { readonly by: string }): Layer.Layer<Relations, never, LedgerTransaction> =>
  Layer.effect(
    Relations,
    Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      const within = (turn: LedgerTurn): Result.Result<Tuples, RelationsError> => {
        const rows: Array<typeof Row.Type> = [];

        for (const entry of turn.read(STREAM, 0)) {
          if (entry.by !== config.by || !isRow(entry)) {
            continue;
          }

          const row = decodeRow(valueFor(entry));

          if (Result.isFailure(row)) {
            return Result.fail(new RelationsError({ reason: "bad_row", cause: row.failure }));
          }

          rows.push(row.success);
        }

        return Result.succeed(fold(rows));
      };
      return Relations.of({
        within,
        write: Effect.fn("relations.write")(function* (changes, writer) {
          yield* Effect.annotateCurrentSpan({ "fab.permissions.changes": changes.length });
          yield* tx
            .transact((turn) => {
              for (const { id, row } of changes) {
                turn.append(STREAM, id, lineFor({ ...writer, by: config.by }, row));
              }
            })
            .pipe(Effect.mapError((cause) => new RelationsError({ reason: "storage", cause })));
        }),
      });
    }),
  );

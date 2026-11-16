/**
 * The `LedgerTransaction` on any `Sql`: the project object's SQLite, and `node:sqlite` in tests
 * (0095).
 *
 * @stability unstable
 */
import { Effect, Layer, Option } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore, policyFor } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "./LedgerTransaction.ts";
import { WritePolicy } from "./WritePolicy.ts";

/**
 * Layer that provides `LedgerTransaction` on the given `Sql`, where one turn is one SQL
 * transaction. It asks for a `Doorbell`, to ring the waiters a turn's appends wake.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql): Layer.Layer<LedgerTransaction, never, Doorbell> =>
  Layer.effect(
    LedgerTransaction,
    Effect.gen(function* () {
      const bell = yield* Doorbell;
      const policy = Option.getOrUndefined(yield* Effect.serviceOption(WritePolicy));
      const store = ledgerStore(sql, bell, policy);

      return {
        // A turn is admitted for the writer trusted code named around it, as a single append is.
        transact: <A>(step: (turn: LedgerTurn) => A) =>
          Effect.flatMap(policyFor(policy), (asked) =>
            (asked === policy ? store : ledgerStore(sql, bell, asked)).transact(step),
          ),
      };
    }),
  );

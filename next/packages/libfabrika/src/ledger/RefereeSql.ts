/**
 * The `Referee` on any `Sql`: the project object's SQLite, and `node:sqlite` in tests (0095).
 *
 * @stability unstable
 */
import { Effect, Layer, Option } from "effect";
import type { Sql } from "../Sql.ts";
import { committedEntries, ledgerStore, policyFor } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { Referee } from "./Referee.ts";
import { WritePolicy } from "./WritePolicy.ts";

/**
 * Returns the committed entries in `sql`, oldest first, or none before the ledger's table exists.
 * Accounting reads them to find each entry's owner.
 *
 * **Details**
 *
 * `scope.after` keeps only entries past that revision, and `scope.stream` only one stream's, so a
 * reader that knows what it needs does not decode the whole ledger. `scope.at` with a stream
 * returns the one entry at that position, as an ack names it.
 *
 * @stability unstable
 * @category getters
 */
export const accountingEntries = (
  sql: Sql,
  scope?: { readonly stream?: string; readonly after?: number } | { readonly stream: string; readonly at: number },
) => committedEntries(sql, scope);

/**
 * Layer that provides `Referee` on the given `Sql`. An append is decided and written in one SQL
 * transaction, so nothing runs between giving an entry its number and writing it.
 *
 * **Details**
 *
 * The tables are made on the first call. A parked wait leaves a row behind, never a fiber or a
 * timer, so the object can sleep under it. It asks for a `Doorbell`, to ring the waiters an append
 * wakes.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql): Layer.Layer<Referee, never, Doorbell> =>
  Layer.effect(
    Referee,
    Effect.gen(function* () {
      const bell = yield* Doorbell;
      const policy = Option.getOrUndefined(yield* Effect.serviceOption(WritePolicy));
      const store = ledgerStore(sql, bell, policy);
      return {
        ...store,
        append: Effect.fnUntraced(function* (stream: string, id: string, line: unknown) {
          const asked = yield* policyFor(policy);
          return yield* (asked === policy ? store : ledgerStore(sql, bell, asked)).append(stream, id, line);
        }),
      };
    }),
  );

/**
 * The `Referee` on any `Sql`: the project object's SQLite, and `node:sqlite` in tests (0095).
 */
import { Effect, Layer, Option } from "effect";
import type { Sql } from "../Sql.ts";
import { committedEntries, headPlace, ledgerStore, policyFor } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { Referee, Selection } from "./Referee.ts";
import { WritePolicy } from "./WritePolicy.ts";

/**
 * Returns the committed entries in `sql` that `selection` names, oldest first, or none before the
 * ledger's table exists. Accounting reads them to find each entry's owner, so a reader that knows
 * what it needs does not decode the whole ledger. Left out, it reads them all.
 *
 * @category getters
 */
export const accountingEntries = (sql: Sql, selection: Selection = Selection.cases.all.make({ after: 0 })) =>
  committedEntries(sql, selection);

/**
 * Returns the place the next entry appended to `stream` would get at the referee's time `now`: its
 * `rev` in the whole log, its `pos` in the stream and its `arrivedAt`, never before the head's, as
 * `append` gives them. A trial measures an entry there before it lands.
 *
 * @category getters
 */
export const nextPlace = (sql: Sql, stream: string, now: number) => headPlace(sql, stream, now);

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

/**
 * `node:sqlite` as a `Sql`, on its own subpath so the data layer's top level names no platform. It
 * backs tests and the local brain's span queue, never a ledger file of its own: the one ledger
 * lives in the project object.
 */
import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import type { Sql, SqlValue } from "../Sql.ts";

/** The ledger writes text, integers and nulls only. A blob or a big integer is a row it never wrote. */
const value = (column: SQLOutputValue): SqlValue => {
  if (Predicate.isString(column) || Predicate.isNumber(column) || column === null) {
    return column;
  }

  throw new TypeError(`a ${Predicate.isBigInt(column) ? "big integer" : "blob"} column, which the ledger never writes`);
};

/**
 * Wraps a `node:sqlite` database as the synchronous `Sql` the referee and the span sink run on.
 *
 * **Details**
 *
 * Each query text is prepared once and reused. `transaction` begins with `BEGIN IMMEDIATE`,
 * commits when the step returns and rolls back when it throws, then throws the step's own error
 * again. `size` is the page count times the page size.
 *
 * **Gotchas**
 *
 * A column that is not text, a number or null throws a `TypeError`: the ledger writes none, so
 * such a row was written by something else.
 *
 * @category constructors
 */
export const nodeSql = (db: DatabaseSync): Sql => {
  const statements = new Map<string, StatementSync>();

  const prepared = (query: string): StatementSync => {
    const known = statements.get(query);

    if (known !== undefined) {
      return known;
    }

    const statement = db.prepare(query);
    statements.set(query, statement);

    return statement;
  };

  return {
    exec: (query, ...params) =>
      Arr.map(prepared(query).all(...params), (row) =>
        Rec.fromEntries(Arr.map(Rec.toEntries(row), ([k, v]) => [k, value(v)])),
      ),
    transaction: (step) => {
      db.exec("BEGIN IMMEDIATE");

      const done = Result.try(() => {
        const answer = step();
        db.exec("COMMIT");
        return answer;
      });

      if (Result.isSuccess(done)) {
        return done.success;
      }

      // SQLite rolls some failures back by itself, SQLITE_FULL among them; then there is none to
      // roll back, and a ROLLBACK would throw over the real error.
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }

      throw done.failure;
    },
    size: () => {
      const [count] = prepared("PRAGMA page_count").all();
      const [page] = prepared("PRAGMA page_size").all();

      return Number(count?.["page_count"] ?? 0) * Number(page?.["page_size"] ?? 0);
    },
  };
};

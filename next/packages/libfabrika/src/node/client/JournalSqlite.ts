/**
 * The hands' journal file: Effect's `KeyValueStore` over one SQLite file, one row per key. SQLite
 * commits each write whole or not at all, so a crash or a power cut never leaves a torn entry.
 */
import { DatabaseSync } from "node:sqlite"; // edge: no Effect SQL client for Node's SQLite is installed; the repo's node:sqlite handle is the existing one
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Predicate from "effect/Predicate";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";

const TABLE = "CREATE TABLE IF NOT EXISTS journal (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

const failed = (method: string, key?: string) => (cause: unknown) =>
  new KeyValueStore.KeyValueStoreError({
    method,
    message: `The journal file could not ${method}${key === undefined ? "" : ` ${key}`}`,
    cause,
    ...(key === undefined ? {} : { key }),
  });

/** The store over one open database: each call is one statement, and so one transaction. */
const store = (sql: Sql) => {
  const exec = (method: string, key: string | undefined, query: string, ...params: ReadonlyArray<string>) =>
    Effect.try({ try: () => sql.exec(query, ...params), catch: failed(method, key) });
  return KeyValueStore.makeStringOnly({
    get: (key) =>
      exec("get", key, "SELECT value FROM journal WHERE key = ?", key).pipe(
        Effect.flatMap(([row]) => {
          const value = row?.["value"];
          return value === undefined
            ? Effect.undefined
            : Predicate.isString(value)
              ? Effect.succeed(value)
              : Effect.fail(failed("get", key)(new TypeError("a value that is not text")));
        }),
      ),
    set: (key, value) =>
      exec("set", key, "INSERT OR REPLACE INTO journal (key, value) VALUES (?, ?)", key, value).pipe(Effect.asVoid),
    remove: (key) => exec("remove", key, "DELETE FROM journal WHERE key = ?", key).pipe(Effect.asVoid),
    clear: exec("clear", undefined, "DELETE FROM journal").pipe(Effect.asVoid),
    size: exec("size", undefined, "SELECT COUNT(*) AS total FROM journal").pipe(
      Effect.map(([row]) => Number(row?.["total"] ?? 0)),
    ),
    keys: exec("keys", undefined, "SELECT key FROM journal").pipe(
      Effect.map((rows) => rows.map((row) => row["key"]).filter(Predicate.isString)),
    ),
  });
};

/**
 * Layer that supplies `KeyValueStore` from one SQLite file, opened for the layer's scope.
 *
 * **Details**
 *
 * It makes the file and its one table, `journal (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, when
 * they are missing, and closes the database when the scope closes. `set` is one `INSERT OR
 * REPLACE`, so a key holds one value however often it is written. `:memory:` gives a database that
 * lives only as long as the layer.
 *
 * **Gotchas**
 *
 * A file that cannot be opened is a defect, not an error: the hands cannot keep their promise of
 * running a task at most once without their journal, so the start stops with its cause.
 *
 * @category layers
 */
export const layer = (options: { readonly file: string }) =>
  Layer.effect(
    KeyValueStore.KeyValueStore,
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const db = new DatabaseSync(options.file);
          db.exec(TABLE);
          return db;
        },
        catch: failed("open"),
      }).pipe(Effect.orDie),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.map((db) => store(nodeSql(db)))),
  );

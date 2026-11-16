// P39 slice 3 (ticket 1040), next/: the hands laws on SQLite files, on the 3-hour schedule (0536).
// This module owns the driver, so it acquires each folder and file in a scope, and the scope gives
// them back (0061). A reopen closes every file and opens it again, keeping only its rows.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Layer } from "effect";
import * as Id from "../../Id.ts";
import { Doorbell } from "../../ledger/Ledger.ts";
import * as LedgerSql from "../../ledger/LedgerSql.ts";
import * as LedgerStreamsSql from "../../ledger/LedgerStreamsSql.ts";
import * as LedgerTransactionSql from "../../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import * as HandsTasksTest from "../../runtime/HandsTasksTest.ts";
import * as RunnerHandsTest from "../../runtime/RunnerHandsTest.ts";
import type { Sql } from "../../Sql.ts";
import * as TasksLedger from "../../tasks/TasksLedger.ts";

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** The durable task store on one ledger, as the Project keeps it. */
const tasks = (sql: Sql) =>
  TasksLedger.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        LedgerSql.layer(sql, { reader: "connection:hands-law" }),
        LedgerTransactionSql.layer(sql),
        LedgerStreamsSql.layer(sql),
      ).pipe(Layer.provide(quiet)),
    ),
    Layer.provide(Id.Generator.layer),
  );

/** A folder in a scope: the scope removes it. */
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p39s3-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

// No rollback journal and no disk sync on each commit, as next/'s other test stores: no law here
// cuts the power, and a close keeps every commit.
const connect = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");

  return db;
};

/** One database file per part, each opened on first use; `reopen` closes and reopens every one. */
const databases = Effect.gen(function* () {
  const path = yield* folder;
  const held = new Map<string, { db: DatabaseSync; sql: Sql }>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const { db } of held.values()) {
        if (db.isOpen) {
          db.close();
        }
      }
    }),
  );

  const handle = (part: string) => {
    const found = held.get(part);

    if (found !== undefined) {
      return found;
    }

    const db = connect(join(path, `${part}.db`));
    const made = { db, sql: nodeSql(db) };
    held.set(part, made);

    return made;
  };

  // One Sql per part across reopens: each call goes to the database open now.
  const sqls = new Map<string, Sql>();

  const sql = (part: string): Sql => {
    const known = sqls.get(part);

    if (known !== undefined) {
      return known;
    }

    const made: Sql = {
      exec: (query, ...params) => handle(part).sql.exec(query, ...params),
      transaction: (step) => handle(part).sql.transaction(step),
      size: () => handle(part).sql.size(),
    };

    sqls.set(part, made);

    return made;
  };

  const reopen = Effect.sync(() => {
    for (const [part, { db }] of held) {
      db.close();
      const fresh = connect(join(path, `${part}.db`));
      held.set(part, { db: fresh, sql: nodeSql(fresh) });
    }
  });

  return { sql, reopen };
});

RunnerHandsTest.suite(
  Effect.map(databases, ({ sql, reopen }) => ({ sql, reopen, tasks }) satisfies RunnerHandsTest.Store),
);

HandsTasksTest.suite(
  Effect.map(databases, ({ sql, reopen }) => ({ tasks: tasks(sql("tasks")), reopen }) satisfies HandsTasksTest.Store),
);

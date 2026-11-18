// P39 slice 3 (ticket 1040), next/: the hands laws on SQLite files, on the 3-hour schedule (0536).
// This module owns the driver, so it acquires each folder and file in a scope, and the scope gives
// them back (0061). A reopen closes every file and opens it again, keeping only its rows.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ScopedRef from "effect/ScopedRef";
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

/** One database file per part, each opened on first use; `reopen` closes and reopens every one. */
const databases = Effect.gen(function* () {
  const path = yield* folder;
  // A test process never loses power, so `TestDatabase.make` skips the sync and keeps the rollback
  // journal in memory; a close still keeps every commit. A part is opened from a plain call, so its
  // handle is acquired into this scope, which closes it.
  const scope = yield* Effect.scope;
  const held = new Map<string, ScopedRef.ScopedRef<{ db: DatabaseSync; sql: Sql }>>();

  const connect = (part: string) =>
    TestDatabase.make(join(path, `${part}.db`)).pipe(Effect.map((db) => ({ db, sql: nodeSql(db) })));

  const handle = (part: string) => {
    const found = held.get(part);

    if (found !== undefined) {
      return ScopedRef.getUnsafe(found);
    }

    const made = Effect.runSync(Scope.provide(scope)(ScopedRef.fromAcquire(connect(part))));
    held.set(part, made);

    return ScopedRef.getUnsafe(made);
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

  const reopen = Effect.forEach(held, ([part, ref]) => ScopedRef.set(ref, connect(part)), {
    discard: true,
    concurrency: 1,
  });

  return { sql, reopen };
});

RunnerHandsTest.suite(
  Effect.map(databases, ({ sql, reopen }) => ({ sql, reopen, tasks }) satisfies RunnerHandsTest.Store),
);

HandsTasksTest.suite(
  Effect.map(databases, ({ sql, reopen }) => ({ tasks: tasks(sql("tasks")), reopen }) satisfies HandsTasksTest.Store),
);

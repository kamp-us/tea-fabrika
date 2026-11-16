// P39 slice 3 (ticket 1040), next/: the hands laws on node:sqlite at `:memory:`, on the merge line
// (0536). This module owns the driver, so it opens each database in a scope and the scope closes it
// (0061). A reopen here keeps the same in-memory database and builds the whole host again over it, as
// a restarted brain would: the durable half of a reopen is the file twin's,
// `RunnerHands.integration.test.ts`, on the schedule.
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

/** One in-memory database per part, each opened on first use and closed with the scope. */
const databases = Effect.gen(function* () {
  const held = new Map<string, Sql>();
  const opened: Array<DatabaseSync> = [];
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const db of opened) {
        if (db.isOpen) {
          db.close();
        }
      }
    }),
  );

  return (part: string): Sql => {
    const known = held.get(part);

    if (known !== undefined) {
      return known;
    }

    const db = new DatabaseSync(":memory:");
    opened.push(db);
    const made = nodeSql(db);
    held.set(part, made);

    return made;
  };
});

RunnerHandsTest.suite(
  Effect.map(databases, (sql) => ({ sql, reopen: Effect.void, tasks }) satisfies RunnerHandsTest.Store),
);

HandsTasksTest.suite(
  Effect.map(databases, (sql) => ({ tasks: tasks(sql("tasks")), reopen: Effect.void }) satisfies HandsTasksTest.Store),
);

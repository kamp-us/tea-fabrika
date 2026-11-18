// T753 L16 full-depth fix, next/. The span sink's batch laws on in-memory SQLite (0062): this driver owns the
// database, and telemetry's suite owns the laws.
import { DatabaseSync } from "node:sqlite";
import { runsFor } from "@kampus/vitest";
import * as Effect from "effect/Effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as SinkBatchTest from "../telemetry/SinkBatchTest.ts";

const memory = Effect.map(
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  ),
  nodeSql,
);

SinkBatchTest.suite(memory, runsFor({ fast: 10, full: 100 }));

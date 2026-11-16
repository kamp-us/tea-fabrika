// P39 slice 1: the tasks module's laws on node:sqlite (0062). This module owns the driver, so it
// acquires each store in a scope and the scope gives the folder and the file back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as ScopedRef from "effect/ScopedRef";
import * as ClientManagerLedger from "../../access/ClientManagerLedger.ts";
import { Gateway } from "../../gateway/Gateway.ts";
import * as RateLimiterSql from "../../gateway/RateLimiterSql.ts";
import * as TestSuite from "../../gateway/TasksTest.ts";
import * as Id from "../../Id.ts";
import { Doorbell } from "../../ledger/Ledger.ts";
import * as LedgerSql from "../../ledger/LedgerSql.ts";
import * as LedgerStreamsSql from "../../ledger/LedgerStreamsSql.ts";
import * as LedgerTransactionSql from "../../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";
import * as TasksLedger from "../../tasks/TasksLedger.ts";
import { Archive } from "../../telemetry/Archive.ts";
import { RecordManager } from "../../telemetry/Records.ts";
import { SpanSink } from "../../telemetry/Sink.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p39-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "ledger.db");
  // A durable file across reopens, with the journal in memory and no disk sync per commit, as every
  // next/ test store (`TestDatabase.make`): no law cuts the power, a close keeps every commit, and
  // the gateway's limiter and span sink commit on each call.
  const connect = TestDatabase.make(path).pipe(Effect.map(nodeSql));
  const held = yield* ScopedRef.fromAcquire(connect);
  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).exec(query, ...params),
    transaction: (step) => ScopedRef.getUnsafe(held).transaction(step),
    size: () => ScopedRef.getUnsafe(held).size(),
  };
  const reopen = ScopedRef.set(held, connect);
  // Every ring the ledger asks its doorbell for, kept for the suite to read (P39 slice 4a, G2).
  const rings: Array<{ readonly to: string; readonly stream: string; readonly rev: number }> = [];
  const bell = Layer.succeed(Doorbell, {
    ring: (to: string, stream: string, rev: number) => Effect.sync(() => void rings.push({ to, stream, rev })),
  });
  const gateway: TestSuite.Store["gateway"] = (options) => {
    const data = Layer.mergeAll(
      LedgerSql.layer(sql, { reader: "tasks-gateway-law" }),
      LedgerTransactionSql.layer(sql),
      LedgerStreamsSql.layer(sql),
    ).pipe(Layer.provide(bell));
    const tasks = TasksLedger.layer.pipe(Layer.provide(data), Layer.provide(Id.Generator.layer));
    const services = Layer.mergeAll(
      data,
      tasks,
      ClientManagerLedger.layer(options.founder).pipe(Layer.provide(data)),
      SpanSink.layer(sql, { object: "tasks-law" }),
      RecordManager.memory(4 * 1024 * 1024),
      Archive.memory,
      Id.Generator.layer,
      RateLimiter.layer.pipe(
        Layer.provide(RateLimiterSql.layer(sql, { build: options.build, policy: options.rateLimit })),
      ),
    );
    // The suite's contract names no ledger error: a store that cannot open is a broken test, a defect.
    return Gateway.layer(options).pipe(Layer.provideMerge(services), Layer.orDie);
  };
  return { sql, reopen, gateway, rings } satisfies TestSuite.Store;
});

TestSuite.suite(open);

// P34c slice 1: the processes module's exit reason laws on node:sqlite (0062). This module owns the
// driver, so it acquires each store in a scope and the scope gives the file back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as ScopedRef from "effect/ScopedRef";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as ExitReasonTest from "../processes/ExitReasonTest.ts";
import type { Sql } from "../Sql.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p34c-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );

  const path = join(folder, "ledger.db");
  // A test process never loses power, so `TestDatabase.make` skips the sync and keeps the rollback
  // journal in memory. Every byte a law reads stays in the file and survives reopen.
  const connect = TestDatabase.make(path).pipe(Effect.map(nodeSql));
  const held = yield* ScopedRef.fromAcquire(connect);

  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).exec(query, ...params),
    transaction: (step) => ScopedRef.getUnsafe(held).transaction(step),
    size: () => ScopedRef.getUnsafe(held).size(),
  };

  return { sql, reopen: ScopedRef.set(held, connect) } satisfies ExitReasonTest.Store;
});

ExitReasonTest.suite(open);

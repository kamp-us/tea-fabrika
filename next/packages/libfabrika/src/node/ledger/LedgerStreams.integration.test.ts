// P39 slice 1: the tasks module's laws on node:sqlite (0062). This module owns the driver, so it
// acquires each store in a scope and the scope gives the folder and the file back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import { Effect, ScopedRef } from "effect";
import * as TestSuite from "../../ledger/LedgerStreamsTest.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";

// A durable file across reopens, opened as every next/ test store is (`TestDatabase.make`): the
// journal in memory and no disk sync on each commit, since no law here cuts the power and a close
// keeps every commit. A5 alone commits about 46,000 entries, and a sync on each was most of its time
// (ticket 1028).
const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p39-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "ledger.db");
  const connect = TestDatabase.make(path).pipe(Effect.map(nodeSql));
  const held = yield* ScopedRef.fromAcquire(connect);
  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).exec(query, ...params),
    transaction: (step) => ScopedRef.getUnsafe(held).transaction(step),
    size: () => ScopedRef.getUnsafe(held).size(),
  };
  return { sql, reopen: ScopedRef.set(held, connect) } satisfies TestSuite.Store;
});

TestSuite.suite(open);

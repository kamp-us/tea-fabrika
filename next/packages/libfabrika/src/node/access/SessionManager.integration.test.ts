// Ticket 921 slice 1, next/. Runs access's session laws on real node:sqlite files (0062). This
// module owns the driver, so it acquires each database in a scope, and the scope closes the
// connection and gives the folder back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as ScopedRef from "effect/ScopedRef";
import * as SessionManagerTest from "../../access/SessionManagerTest.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p10-session-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "session.db");
  const connect = TestDatabase.make(path).pipe(Effect.map(nodeSql));
  const held = yield* ScopedRef.fromAcquire(connect);
  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).exec(query, ...params),
    transaction: (step) => ScopedRef.getUnsafe(held).transaction(step),
    size: () => ScopedRef.getUnsafe(held).size(),
  };
  return { sql, reopen: ScopedRef.set(held, connect) } satisfies SessionManagerTest.Store;
});

SessionManagerTest.suite(open);

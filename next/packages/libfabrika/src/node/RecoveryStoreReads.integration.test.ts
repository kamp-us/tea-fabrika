// T936 slice 2, next/: L5 and L6 on node:sqlite files (0062). This module owns the driver, so it
// acquires each database in a scope, and the scope closes the file and removes its folder (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as RecoveryStoreReadsTest from "../runtime/RecoveryStoreReadsTest.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "t936-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );

  // A test process never loses power, so `TestDatabase.make` skips the sync (ticket 585, decision 0052).
  const db = yield* TestDatabase.make(join(folder, "store.db"));

  return nodeSql(db);
});

RecoveryStoreReadsTest.suite(open);

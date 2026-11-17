// T1041, next/: the ledger turn's position-only read on a real SQLite file (0536), in WAL as a
// Durable Object's storage keeps it. This module owns the driver, so it opens the file in a scope
// that removes it (0061, 0062); the fast twin runs in LedgerTurnReads.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import { Effect } from "effect";
import * as LedgerTurnEndTest from "./LedgerTurnEndTest.ts";
import { nodeSql } from "./NodeSqlite.ts";

const file = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "t1041-end-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
).pipe(
  Effect.flatMap((path) =>
    // The law needs WAL, as a Durable Object's storage keeps it, so the file opens with `open`, which
    // sets nothing, and sets its own pragmas.
    TestDatabase.open(join(path, "ledger.db")).pipe(
      Effect.orDie,
      Effect.tap((db) => Effect.sync(() => db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF"))),
    ),
  ),
  Effect.map(nodeSql),
);

LedgerTurnEndTest.suite(file);

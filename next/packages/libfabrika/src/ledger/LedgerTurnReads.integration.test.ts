// T1041, next/: the ledger turn's position-only read on a real SQLite file (0536), in WAL as a
// Durable Object's storage keeps it. This module owns the driver, so it opens the file in a scope
// that removes it (0061, 0062); the fast twin runs in LedgerTurnReads.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import * as LedgerTurnEndTest from "./LedgerTurnEndTest.ts";
import { nodeSql } from "./NodeSqlite.ts";

const file = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "t1041-end-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
).pipe(
  Effect.flatMap((path) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const db = new DatabaseSync(join(path, "ledger.db"));
        db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");

        return db;
      }),
      (db) => Effect.sync(() => db.close()),
    ),
  ),
  Effect.map(nodeSql),
);

LedgerTurnEndTest.suite(file);

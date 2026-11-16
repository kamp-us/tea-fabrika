// T1041, next/: the ledger turn's position-only read on a real SQLite file (0536), in WAL as a
// Durable Object's storage keeps it. This module owns the driver, so it opens the file in a scope
// that removes it (0061, 0062); the fast twin runs in LedgerTurnReads.test.ts.
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import * as LedgerTurnEndTest from "./LedgerTurnEndTest.ts";
import { nodeSql } from "./NodeSqlite.ts";

const ledgerFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return path.join(yield* fs.makeTempDirectoryScoped({ prefix: "t1041-end-" }), "ledger.db");
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

const file = ledgerFile.pipe(
  Effect.flatMap((path) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const db = new DatabaseSync(path);
        db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
        return db;
      }),
      (db) => Effect.sync(() => db.close()),
    ),
  ),
  Effect.map(nodeSql),
);

LedgerTurnEndTest.suite(file);

// T953 slice 2, next/. Runs access's sender law (L9) on real node:sqlite files (0062). This module owns
// the driver, so it acquires each database in a scope, and the scope closes the connection and gives
// the folder back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import { Effect } from "effect";
import * as SessionSenderTest from "../../access/SessionSenderTest.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "t953-sender-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const db = yield* TestDatabase.make(join(folder, "session.db"));
  return { sql: nodeSql(db) } satisfies SessionSenderTest.Store;
});

SessionSenderTest.suite(open);

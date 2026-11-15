// P39 slice 1: the jobs module's laws on node:sqlite (0062). This module owns the driver, so it
// acquires each store in a scope and the scope gives the folder and the file back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import * as JobsTest from "../../jobs/JobsTest.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";

// A durable file across reopens, with no rollback journal and no disk sync on each commit, as
// next/'s other test stores (the jobs gateway's among them): no law here cuts the power, and a close
// keeps every commit. A5 alone commits about 22,000 requests, and a sync on each was a third of
// its time (ticket 1028).
const connect = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
  return db;
};

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p39-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "ledger.db");
  const handle = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const db = connect(path);
      return { db, sql: nodeSql(db) };
    }),
    (held) => Effect.sync(() => held.db.isOpen && held.db.close()),
  );
  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => handle.sql.exec(query, ...params),
    transaction: (step) => handle.sql.transaction(step),
    size: () => handle.sql.size(),
  };
  const reopen = Effect.sync(() => {
    handle.db.close();
    handle.db = connect(path);
    handle.sql = nodeSql(handle.db);
  });
  return { sql, reopen } satisfies JobsTest.Store;
});

JobsTest.suite(open);

JobsTest.discoverySuite(open);

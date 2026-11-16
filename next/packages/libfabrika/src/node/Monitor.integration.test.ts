// Program watch (docs/plan/quests/watch-PLAN.md), next/: the monitor Cmd's laws (M2, M3, M7, M8, M9, M10)
// on SQLite files, on the schedule (0536). This module owns the driver, so it acquires the folder and
// each file in a scope, and the scope gives them back (0061). A reopen closes every file and opens it
// again, keeping only its rows.
// Edge: Effect has no node:sqlite driver.
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as MonitorTest from "../runtime/MonitorTest.ts";
import type { Sql } from "../Sql.ts";

/** A folder in a scope: the scope removes it. */
const folder = FileSystem.FileSystem.use((fs) => fs.makeTempDirectoryScoped({ prefix: "watch-run-" })).pipe(
  Effect.provide(NodeServices.layer),
  Effect.orDie,
);

// No disk sync on each commit, as next/'s other test stores: no law here cuts the power, and a close
// keeps every commit.
const connect = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
  return db;
};

/** One database file per part, each opened on first use; `reopen` closes and reopens every one. */
const databases = Effect.gen(function* () {
  const path = yield* folder;
  const paths = yield* Path.Path.pipe(Effect.provide(NodeServices.layer));
  const held = new Map<string, { db: DatabaseSync; sql: Sql }>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const { db } of held.values()) {
        if (db.isOpen) {
          db.close();
        }
      }
    }),
  );
  const handle = (part: string) => {
    const found = held.get(part);

    if (found !== undefined) {
      return found;
    }

    const db = connect(paths.join(path, `${part}.db`));
    const made = { db, sql: nodeSql(db) };
    held.set(part, made);
    return made;
  };
  // One Sql per part across reopens: each call goes to the database open now.
  const sqls = new Map<string, Sql>();
  const sql = (part: string): Sql => {
    const known = sqls.get(part);

    if (known !== undefined) {
      return known;
    }

    const made: Sql = {
      exec: (query, ...params) => handle(part).sql.exec(query, ...params),
      transaction: (step) => handle(part).sql.transaction(step),
      size: () => handle(part).sql.size(),
    };
    sqls.set(part, made);
    return made;
  };
  const reopen = Effect.sync(() => {
    for (const [part, { db }] of held) {
      db.close();
      const fresh = connect(paths.join(path, `${part}.db`));
      held.set(part, { db: fresh, sql: nodeSql(fresh) });
    }
  });
  /** The streams of the `ledger` part, read through the ledger as every reader reads them. */
  const entries: MonitorTest.Store["entries"] = (streams) =>
    Effect.forEach(
      streams,
      (stream) =>
        Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0))).pipe(
          Effect.map((read) =>
            [...read].map((e): MonitorTest.Row => ({
              rev: e.rev,
              stream,
              id: e.id,
              tag: e._tag,
              body: (e.body ?? {}) as MonitorTest.Row["body"],
            })),
          ),
        ),
      { concurrency: 1 },
    ).pipe(
      Effect.map((parts) => parts.flat().sort((a, b) => a.rev - b.rev)),
      Effect.provide(
        LedgerSql.layer(sql("ledger"), { reader: "connection:test" }).pipe(
          Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
        ),
      ),
      Effect.orDie,
    );
  return { sql, reopen, entries } satisfies MonitorTest.Store;
});

MonitorTest.suite(databases);

// Program watch (docs/plan/quests/watch-PLAN.md), next/: the monitor Cmd's laws (M2, M3, M7, M8, M9, M10)
// on SQLite files, on the schedule (0536). This module owns the driver, so it acquires the folder and
// each file in a scope, and the scope gives them back (0061). A reopen closes every file and opens it
// again, keeping only its rows.
// Edge: Effect has no node:sqlite driver.
import type { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import { Effect, FileSystem, Layer, Path, Scope, ScopedRef, Stream } from "effect";
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

/** One database file per part, each opened on first use; `reopen` closes and reopens every one. */
const databases = Effect.gen(function* () {
  const path = yield* folder;
  const paths = yield* Path.Path.pipe(Effect.provide(NodeServices.layer));
  // A test process never loses power, so `TestDatabase.make` skips the sync and keeps the rollback
  // journal in memory; a close still keeps every commit. A part is opened from a plain call, so its
  // handle is acquired into this scope, which closes it.
  const scope = yield* Effect.scope;
  const held = new Map<string, ScopedRef.ScopedRef<{ db: DatabaseSync; sql: Sql }>>();
  const connect = (part: string) =>
    TestDatabase.make(paths.join(path, `${part}.db`)).pipe(Effect.map((db) => ({ db, sql: nodeSql(db) })));
  const handle = (part: string) => {
    const found = held.get(part);

    if (found !== undefined) {
      return ScopedRef.getUnsafe(found);
    }

    const made = Effect.runSync(Scope.provide(scope)(ScopedRef.fromAcquire(connect(part))));
    held.set(part, made);
    return ScopedRef.getUnsafe(made);
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
  const reopen = Effect.forEach(held, ([part, ref]) => ScopedRef.set(ref, connect(part)), {
    discard: true,
    concurrency: 1,
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

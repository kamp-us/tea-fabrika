// P42 slice 1 (ticket 770): the start piece's suite on node:sqlite (0062). This module owns the
// driver, so it acquires the store's folder and handle in a scope, and the scope gives both back
// (0061). `probe.open` counts the handles still open, for L13.
// Edge: Effect has no node:sqlite driver.
import type { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ScopedRef from "effect/ScopedRef";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as ChildrenTest from "../processes/ChildrenTest.ts";
import type { Sql } from "../Sql.ts";

/** A folder in a scope: the scope removes it. */
const folder = FileSystem.FileSystem.use((fs) => fs.makeTempDirectoryScoped({ prefix: "p42-" })).pipe(
  Effect.provide(NodeServices.layer),
  Effect.orDie,
);

/** One database file, opened in the scope; `reopen` closes it and opens the same file again. */
const store = Effect.gen(function* () {
  const path = yield* folder;
  const paths = yield* Path.Path.pipe(Effect.provide(NodeServices.layer));
  const handles: Array<DatabaseSync> = [];

  const connect = TestDatabase.make(paths.join(path, "ledger.db")).pipe(
    Effect.tap((db) => Effect.sync(() => handles.push(db))),
    Effect.map(nodeSql),
  );

  const held = yield* ScopedRef.fromAcquire(connect);

  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).exec(query, ...params),
    transaction: (step) => ScopedRef.getUnsafe(held).transaction(step),
    size: () => ScopedRef.getUnsafe(held).size(),
  };

  const open = () => handles.filter((db) => db.isOpen).length;

  return { sql, reopen: ScopedRef.set(held, connect), probe: { open } } satisfies ChildrenTest.Store;
});

ChildrenTest.suite(store);

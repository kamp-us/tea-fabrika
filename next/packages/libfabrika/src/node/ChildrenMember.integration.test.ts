// T953 slice 2, next/: the member start's suite (L10 to L15, L20) on node:sqlite (0062). This module owns
// the driver, so it acquires the store's folder and handle in a scope, and the scope gives both back (0061).
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as ChildrenMemberTest from "../processes/ChildrenMemberTest.ts";

/** A folder in a scope: the scope removes it. */
const folder = FileSystem.FileSystem.use((fs) => fs.makeTempDirectoryScoped({ prefix: "t953c-" })).pipe(
  Effect.provide(NodeServices.layer),
  Effect.orDie,
);

/** One database file, opened in the scope and closed with it. */
const store = Effect.gen(function* () {
  const path = yield* folder;
  const paths = yield* Path.Path.pipe(Effect.provide(NodeServices.layer));
  const db = yield* TestDatabase.make(paths.join(path, "ledger.db"));

  return { sql: nodeSql(db) } satisfies ChildrenMemberTest.Store;
});

ChildrenMemberTest.suite(store);

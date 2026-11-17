// T878, next/, L5/L6 on real SQLite. The packs module owns the laws, this module owns the driver.
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ScopedRef from "effect/ScopedRef";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import * as RepositoryTrustTest from "../../packs/RepositoryTrustTest.ts";
import type { Sql } from "../../Sql.ts";

const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;

  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-trust-" });
  const file = path.join(root, "ledger.db");
  const connect = TestDatabase.make(file).pipe(Effect.map(nodeSql));
  const held = yield* ScopedRef.fromAcquire(connect);

  // One Sql across reopens: each call goes to the connection open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).exec(query, ...params),
    transaction: (step) => ScopedRef.getUnsafe(held).transaction(step),
    size: () => ScopedRef.getUnsafe(held).size(),
  };

  return { sql, reopen: ScopedRef.set(held, connect) } satisfies RepositoryTrustTest.Store;
}).pipe(Effect.orDie, Effect.provide(NodeServices.layer));

RepositoryTrustTest.suite(open);

import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import { Effect, FileSystem, Path, ScopedRef } from "effect";
import * as RateLimitTest from "../../gateway/RateLimitTest.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";

const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t843-" });
  const connect = TestDatabase.make(path.join(dir, "limits.db"));
  const held = yield* ScopedRef.fromAcquire(connect);
  // One Sql across reopens: each call goes to the connection open now.
  const sql: Sql = {
    exec: (query, ...params) => nodeSql(ScopedRef.getUnsafe(held)).exec(query, ...params),
    transaction: (step) => nodeSql(ScopedRef.getUnsafe(held)).transaction(step),
    size: () => nodeSql(ScopedRef.getUnsafe(held)).size(),
  };
  return { sql, reopen: ScopedRef.set(held, connect) };
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

RateLimitTest.suite({ open });

// Ticket 762 A-Merge, next/. Run runtime's init laws on scoped SQLite files (0062, 0061).
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as ScopedRef from "effect/ScopedRef";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import * as RunnerInitTest from "../../runtime/RunnerInitTest.ts";
import type { SqlValue } from "../../Sql.ts";

/** One Sql across reopens; the scope closes whichever handle is open. */
const database = (path: string): Effect.Effect<RunnerInitTest.Database, never, Scope.Scope> =>
  Effect.gen(function* () {
    const connect = TestDatabase.make(path).pipe(Effect.map(nodeSql));
    const held = yield* ScopedRef.fromAcquire(connect);
    return {
      sql: {
        exec: (query: string, ...params: ReadonlyArray<SqlValue>) => ScopedRef.getUnsafe(held).exec(query, ...params),
        transaction: <A>(step: () => A): A => ScopedRef.getUnsafe(held).transaction(step),
        size: () => ScopedRef.getUnsafe(held).size(),
      },
      // The suite's reopen is a plain call, so the swap runs at once.
      reopen: () => Effect.runSync(ScopedRef.set(held, connect)),
    };
  });

const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "t762-init-" });
  return (name: string) => database(path.join(folder, `${name}.db`));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

RunnerInitTest.suite(files);

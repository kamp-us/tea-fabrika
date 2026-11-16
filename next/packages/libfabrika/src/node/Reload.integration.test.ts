// P15 slice 1, next/. Runtime's reload suite on scoped node:sqlite stores (0062).
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ScopedRef from "effect/ScopedRef";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Row } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import * as ReloadTest from "../runtime/ReloadTest.ts";
import type { Sql } from "../Sql.ts";

const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p15-reload-" });
  const file = path.join(folder, "store.db");
  const connect = TestDatabase.make(file).pipe(Effect.map(nodeSql));
  const held = yield* ScopedRef.fromAcquire(connect);

  // One Sql across reopens: each call goes to the connection open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).exec(query, ...params),
    transaction: (work) => ScopedRef.getUnsafe(held).transaction(work),
    size: () => ScopedRef.getUnsafe(held).size(),
  };

  return { sql, reopen: ScopedRef.set(held, connect) } satisfies ReloadTest.Store;
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const coordination: ReloadTest.Rig["coordination"] = (ledger, manager, next) =>
  ProcessManager.layer(
    {
      by: "SHA256:brain",
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: "process_0000000000e008000000000003" }),
    },
    next,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        LedgerTransactionSql.layer(manager),
        Mailbox.layer.pipe(Layer.provideMerge(LedgerSql.layer(ledger, { reader: "reload-law" }))),
      ).pipe(Layer.provide(quiet)),
    ),
  );

const decode = Schema.decodeUnknownSync(Row);

const rows: ReloadTest.Rig["rows"] = (sql) =>
  sql.exec("SELECT name FROM sqlite_master WHERE name='entries'").length === 0
    ? []
    : sql.exec("SELECT * FROM entries ORDER BY rev").map((raw) => {
        const row = decode(raw);

        return { stream: row.stream, id: row.id, event: row._tag, body: row.body, build: row.build };
      });

ReloadTest.suite({ open, coordination, rows });

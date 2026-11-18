// P13 slice 1, next/. Runs runtime's reply laws on real SQLite files (0062). Each walk gets a fresh
// temporary folder; each open is a new connection to the same files, closed with its scope.
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as Id from "../Id.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import * as RepliesTest from "../runtime/RepliesTest.ts";
import * as RunnerRepliesTest from "../runtime/RunnerRepliesTest.ts";
import { BRAIN } from "../runtime/RunnerRepliesTest.ts";
import type { Sql } from "../Sql.ts";

// The brain's own session, a process id it never starts.
const SESSION = "process_0000000000e008000000000003";

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** One connection to a database file, closed with its scope. A test process never loses power, so
 *  `TestDatabase.make` skips the sync and keeps the rollback journal in memory. Every byte a law
 *  reads stays in the file and survives reopen. */
const connection = (file: string): Effect.Effect<Sql, never, Scope.Scope> =>
  TestDatabase.make(file).pipe(Effect.map(nodeSql));

/** A fresh folder; each run of the result opens the named database in it again. */
const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p13-replies-" });

  return (name: string) => connection(path.join(folder, `${name}.sqlite`));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

/** The inbox's ledger and the brain's process table, each over its own connection. */
const services = (inbox: Sql, manager: Sql) =>
  Layer.mergeAll(
    // The runner reads its inbox's ledger too, so the context keeps it beside the mailbox.
    Mailbox.layer.pipe(Layer.provideMerge(LedgerSql.layer(inbox, { reader: SESSION }).pipe(Layer.provide(quiet)))),
    ProcessManager.layer(
      {
        by: BRAIN,
        owner: Owner.cases.brain.make({}),
        recipient: Recipient.cases.client.make({ client: "brain", session: SESSION }),
      },
      Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer), Effect.orDie),
    ).pipe(Layer.provide(LedgerTransactionSql.layer(manager).pipe(Layer.provide(quiet)))),
  );

RepliesTest.suite(Effect.map(files, (open) => open("replies")));

RunnerRepliesTest.suite({ files, services });

// P42 slice 1 (ticket 770): the store `start_child` and `exit` run on, on node:sqlite (0062). This
// module owns the driver, so it acquires the folder and every database in a scope, and the scope
// gives each file and handle back (0061). `probe.open` counts the handles still open, for L13.
// StartChild*.integration.test.ts run the laws over it, a part each, so CI can run the parts on
// different machines.
// Edge: Effect has no node:sqlite driver.
import type { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import { Context, Effect, FileSystem, Layer, Path, Scope, ScopedRef, Stream, Tracer } from "effect";
import * as SessionSenders from "../access/SessionSenders.ts";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { ROW_BYTES } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as RelationsMemory from "../permissions/RelationsMemory.ts";
import { Senders } from "../permissions/Senders.ts";
import * as ChildrenLedger from "../processes/ChildrenLedger.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import * as ProgramMailLedger from "../processes/ProgramMailLedger.ts";
import * as StartChildTest from "../runtime/StartChildTest.ts";
import type { Sql } from "../Sql.ts";
import { SpanSink } from "../telemetry/Sink.ts";

/** A folder in a scope: the scope removes it. */
const folder = FileSystem.FileSystem.use((fs) => fs.makeTempDirectoryScoped({ prefix: "p42r-" })).pipe(
  Effect.provide(NodeServices.layer),
  Effect.orDie,
);

/** One database file per part, each opened on first use; `reopen` closes and reopens every one. */
export const databases = Effect.gen(function* () {
  const path = yield* folder;
  const paths = yield* Path.Path.pipe(Effect.provide(NodeServices.layer));
  // A part is opened from a plain call, so its handle is acquired into this scope, which closes it.
  const scope = yield* Effect.scope;
  const held = new Map<string, ScopedRef.ScopedRef<{ db: DatabaseSync; sql: Sql }>>();
  const connect = (part: string) =>
    TestDatabase.make(paths.join(path, `${part}.db`)).pipe(Effect.map((db) => ({ db, sql: nodeSql(db) })));
  const handle = (part: string) => {
    const found = held.get(part);

    if (found !== undefined) {
      return ScopedRef.getUnsafe(found);
    }

    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Sql is synchronous, and a part opens on its first call
    const made = Effect.runSync(Scope.provide(scope)(ScopedRef.fromAcquire(connect(part))));
    held.set(part, made);
    return ScopedRef.getUnsafe(made);
  };
  // One Sql per part across reopens: each call goes to the database open now.
  const sqls = new Map<string, Sql>();
  const bytes = new TextEncoder();
  const sql = (part: string): Sql => {
    const known = sqls.get(part);

    if (known !== undefined) {
      return known;
    }

    const made: Sql = {
      exec: (query, ...params) => {
        // Cloudflare limits each stored row. Node SQLite needs the same failure at this edge.
        if (/^\s*(INSERT|UPDATE)\b/i.test(query)) {
          const size = params.reduce<number>(
            (total, value) => total + (typeof value === "string" ? bytes.encode(value).byteLength : 8),
            0,
          );

          if (size > ROW_BYTES) {
            // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: synchronous Sql.exec reproduces the platform driver's row-limit exception
            throw new Error("SQLITE_TOOBIG: row exceeds the platform limit");
          }
        }

        return handle(part).sql.exec(query, ...params);
      },
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
  const open = () => [...held.values()].filter((ref) => ScopedRef.getUnsafe(ref).db.isOpen).length;
  const data = (sql: Sql) =>
    Layer.mergeAll(LedgerSql.layer(sql, { reader: "connection:test" }), LedgerTransactionSql.layer(sql)).pipe(
      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
    );
  const shared: StartChildTest.Store["shared"] = (sql, next, world) =>
    Layer.mergeAll(
      ChildrenLedger.layer({ grants: StartChildTest.STARTS, fabrika: StartChildTest.FABRIKA }).pipe(
        // Desk S1 (amendment 15): the world's relation rows, and the door's own record of who sent
        // each letter, made into `Senders` as `cloudflare/runtime.ts` makes the real one.
        Layer.provide(RelationsMemory.layer(world.rows)),
        Layer.provide(Layer.succeed(Senders, SessionSenders.make(world.sessions.sender))),
      ),
      // T1041: mail.unread's largest value, so no law here meets a full inbox.
      ProgramMailLedger.layer({ grants: StartChildTest.HOST, cap: 16_384 }),
    ).pipe(
      Layer.provideMerge(
        ProcessManager.layer(
          {
            by: "SHA256:brain",
            owner: Owner.cases.brain.make({}),
            recipient: Recipient.cases.client.make({ client: "brain", session: "process_0000000000e008000000000039" }),
          },
          next,
        ),
      ),
      Layer.provideMerge(Mailbox.layer),
      Layer.provideMerge(data(sql)),
    );
  const entries: StartChildTest.Store["entries"] = (names) =>
    Effect.forEach(
      ["processes", ...[...new Set(names)].flatMap((name) => [`processes/${name}`, `${name}/inbox`])],
      (stream) => Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0))),
      { concurrency: 1 },
    ).pipe(
      Effect.map((parts) => parts.flatMap((part) => [...part]).sort((a, b) => a.rev - b.rev)),
      Effect.provide(data(sql("ledger"))),
      Effect.orDie,
    );
  const tracer: StartChildTest.Store["tracer"] = (sql) =>
    Effect.map(Layer.build(SpanSink.layer(sql, { object: "p42-secrets" })), (context) =>
      Context.get(context, Tracer.Tracer),
    );
  return { sql, reopen, shared, entries, probe: { open }, tracer } satisfies StartChildTest.Store;
});

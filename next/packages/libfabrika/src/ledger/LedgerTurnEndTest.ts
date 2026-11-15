// Ticket 1041 (pipe plumbing), next/: the ledger turn's position-only read, written before the
// build. The inbox cap learns where an inbox ends from it, and a full read of the newest entry was
// 28% of a turn at 1 MiB letters (experiment 295). `LedgerTurnReads.test.ts` runs this suite on an
// in-memory database and `LedgerTurnReads.integration.test.ts` on a real SQLite file (0536); `open`
// gives one database's Sql in a scope.
//
// The contract this law pins, from the lead's amendment to docs/plan/lanes/t1041-PLAN.md:
//   LedgerTurn.end(stream): the pos of the stream's newest entry, or none for an empty stream, read
//   by an index and with no entry's body.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Layer, Option, Schema, type Scope } from "effect";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import { property } from "../Testing.test-support.ts";
import { Doorbell } from "./Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "./LedgerTransaction.ts";
import * as LedgerTransactionSql from "./LedgerTransactionSql.ts";
import { type Line, lineFor } from "./Log.ts";

const encoder = new TextEncoder();

/** One fact, padded to the body size a law wants. */
const Fact = Schema.TaggedStruct("fact", { n: Schema.Int, pad: Schema.String });

const line = (n: number, pad: number): Line =>
  lineFor(
    {
      by: "SHA256:brain",
      for: "person-a",
      sentAt: "2026-11-15T00:00:00Z",
      seen: 0,
      parent: null,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      build: "writer-build",
    },
    Fact.make({ n, pad: "x".repeat(pad) }),
  );

/** The store's Sql, counting the bytes of the values every query returns while `on` is set. */
const counted = (sql: Sql) => {
  const state = { on: false, bytes: 0 };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      const rows = sql.exec(query, ...params);

      if (state.on) {
        for (const row of rows) {
          for (const value of Object.values(row)) {
            state.bytes += typeof value === "string" ? encoder.encode(value).length : 8;
          }
        }
      }

      return rows;
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return { sql: wrapped, state };
};

const STREAMS = ["a", "b/inbox", "c/outbox"] as const;
const EMPTY = "never";

/** One append: its stream, an id from a small set so resends and refusals happen, and a body size
 *  from a few bytes to a 1 MiB chunk. */
const Append = fc.record({
  stream: fc.nat(),
  id: fc.nat({ max: 5 }),
  pad: fc.oneof(fc.integer({ min: 0, max: 64 }), fc.integer({ min: 4_096, max: 1_024 * 1_024 })),
});
type Append = typeof Append extends fc.Arbitrary<infer A> ? A : never;
const Log = fc.array(Append, { minLength: 1, maxLength: 24, size: "max" });

export const suite = (open: Effect.Effect<Sql, never, Scope.Scope>) =>
  describe("T1041: the ledger turn's position-only read", () => {
    it.effect(
      "T1041 L7 ledger: over appends to several streams, end is the pos of the last entry read returns, none for an empty stream, and returns the same bytes whatever the newest entry's body size",
      () =>
        Effect.gen(function* () {
          const reached = new Set<string>();
          const law = (log: ReadonlyArray<Append>) =>
            Effect.gen(function* () {
              const { sql, state } = counted(yield* open);
              const tx = yield* LedgerTransaction.pipe(
                Effect.provide(
                  LedgerTransactionSql.layer(sql).pipe(
                    Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
                  ),
                ),
              );
              // Bytes one `end` call returns, by stream, for streams that hold entries.
              const sizes: Array<{ readonly stream: string; readonly newest: number; readonly bytes: number }> = [];
              const check = (turn: LedgerTurn, moment: string) => {
                for (const stream of [...STREAMS, EMPTY]) {
                  const all = [...turn.read(stream, 0)];
                  state.bytes = 0;
                  state.on = true;
                  const end = turn.end(stream);
                  state.on = false;
                  const last = all.at(-1);
                  expect(end, `${moment}: end(${stream}) is the pos of read's last entry, or none`).toEqual(
                    last === undefined ? Option.none() : Option.some(last.pos),
                  );

                  if (last !== undefined) {
                    sizes.push({
                      stream,
                      newest: encoder.encode(JSON.stringify(last.body)).length,
                      bytes: state.bytes,
                    });
                  }
                }
              };
              const pads = new Map<string, number>();

              yield* tx.transact((turn) => check(turn, "an empty log"));

              for (const append of log) {
                const stream = STREAMS[append.stream % STREAMS.length] as string;
                const id = `id-${append.id}`;
                // A reused id keeps its first body, so a resend is the same line and a change is refused.
                const pad = pads.get(`${stream}/${id}`) ?? append.pad;
                const inside = yield* Effect.exit(
                  tx.transact((turn) => {
                    turn.append(stream, id, line(append.id, append.id % 2 === 0 ? pad : append.pad));
                    check(turn, `inside the turn that appended ${stream}/${id}`);
                  }),
                );
                reached.add(Exit.isSuccess(inside) ? "appended" : "refused");

                if (Exit.isSuccess(inside)) {
                  pads.set(`${stream}/${id}`, append.id % 2 === 0 ? pad : append.pad);
                }

                yield* tx.transact((turn) => check(turn, `after ${stream}/${id}`));
              }

              const least = Math.min(...sizes.map((s) => s.bytes));
              const most = Math.max(...sizes.map((s) => s.bytes));
              const big = sizes.some((s) => s.newest > 4_096);
              const small = sizes.some((s) => s.newest < 4_096);

              if (big && small) {
                reached.add("both_sizes");
              }

              expect(
                most - least,
                `end returns the same bytes whatever the newest body: ${sizes.map((s) => `${s.newest} B -> ${s.bytes}`).join(", ")}`,
              ).toBe(0);
            });
          yield* property(Log, law, { numRuns: runsFor({ fast: 5, full: 50 }), endOnFailure: true });
          // An empty walk cannot pass: appends landed, ids were refused, and small and large newest
          // bodies were both read past.
          expect([...reached].sort()).toEqual(["appended", "both_sizes", "refused"]);
        }),
      120_000,
    );
  });

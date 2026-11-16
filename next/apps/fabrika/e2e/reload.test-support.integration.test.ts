// The laws for L17's span read, `spanOutputs` (reload.test-support.ts), which reads the home's
// SQLite files while the instance runs. The brain flushes its span queue each second
// (`flushRecords` in libfabrika's `node/dev/dev.ts`): a record writes the row, and only then does
// the queue, `brain.records.sqlite`, delete it (`send` in `telemetry/Sink.ts`). A read that took
// the records before the queue lost a span to a flush between the two: that turned L17 red on CI
// run 43766158547. Each race here is certain, not timed.
import type { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import type { SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { runsFor } from "@kampus/vitest";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { String as Str, pipe, Array as Arr } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rebuildSpans, spanOutputs } from "./reload.test-support.ts";

const SEED = 119120;

const QUEUE = "brain.records.sqlite";

// One sorts before the queue's file and one after, so no law leans on the listing's order.
const RECORDS = [".alchemy/record.sqlite", "records/record.sqlite"] as const;

const UNSENT = `CREATE TABLE IF NOT EXISTS unsent (
  "spanId" TEXT PRIMARY KEY, chain TEXT NOT NULL, row TEXT NOT NULL, content TEXT)`;

const SPANS = `CREATE TABLE IF NOT EXISTS spans (
  "spanId" TEXT PRIMARY KEY, "traceId" TEXT NOT NULL, "parentSpanId" TEXT, name TEXT NOT NULL,
  kind TEXT NOT NULL, "startTimeUnixNano" TEXT NOT NULL, "endTimeUnixNano" TEXT NOT NULL,
  attributes TEXT NOT NULL, events TEXT NOT NULL, links TEXT NOT NULL, resource TEXT NOT NULL,
  ok INTEGER NOT NULL)`;

/** One ended rebuild, as the watcher's span row keeps it. */
const rebuild = (spanId: string): SpanRow => ({
  traceId: `trace_${spanId}`,
  spanId,
  parentSpanId: null,
  name: "watch.rebuild",
  kind: "internal",
  startTimeUnixNano: "1",
  endTimeUnixNano: "2",
  attributes: { program: "fabrika/counter", bytes: 1, ms: 1, outcome: "loaded" },
  events: [],
  links: [],
  resource: { attributes: { "fab.object": "brain:test" } },
  ok: true,
});

/**
 * Runs `work` on the SQLite file at `file`, made with its folder when it is not there yet. The file
 * stands for one the brain or a record owns, so `TestDatabase.open` sets nothing and each writer sets
 * its owner's pragmas itself.
 */
const withDatabase = Effect.fnUntraced(function* (file: string, work: (db: DatabaseSync) => void) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(
    pipe(file, Str.lastIndexOf("/"), Option.match({ onNone: () => ".", onSome: (at) => pipe(file, Str.slice(0, at)) })),
    { recursive: true },
  );
  yield* Effect.scoped(
    TestDatabase.open(file).pipe(
      Effect.orDie,
      Effect.flatMap((db) => Effect.sync(() => work(db))),
    ),
  );
});

const queue = (home: string, row: SpanRow) =>
  withDatabase(`${home}/${QUEUE}`, (db) => {
    // The span queue's own pragmas (dev-recording.ts).
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    db.exec(UNSENT);
    db.prepare(`INSERT INTO unsent ("spanId", chain, row, content) VALUES (?, ?, ?, NULL)`).run(
      row.spanId,
      "{}",
      JSON.stringify(row),
    );
  });

const deliver = (home: string, record: string, row: SpanRow) =>
  withDatabase(`${home}/${record}`, (db) => {
    db.exec(SPANS);
    db.prepare(`INSERT INTO spans VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.spanId,
      row.traceId,
      row.parentSpanId,
      row.name,
      row.kind,
      row.startTimeUnixNano,
      row.endTimeUnixNano,
      JSON.stringify(row.attributes),
      JSON.stringify(row.events),
      JSON.stringify(row.links),
      JSON.stringify(row.resource),
      1,
    );
  });

/** One flush, in the sink's order: the record writes the row, then the queue deletes it. */
const flush = Effect.fnUntraced(function* (home: string, record: string, row: SpanRow) {
  yield* deliver(home, record, row);
  yield* withDatabase(`${home}/${QUEUE}`, (db) => {
    db.prepare(`DELETE FROM unsent WHERE "spanId" = ?`).run(row.spanId);
  });
});

const ids = fc.stringMatching(/^[a-f0-9]{16}$/);

describe("spanOutputs", () => {
  it("every queue's rows are read before any record's rows, wherever the record's file sorts", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(ids, { minLength: 3, maxLength: 3 }), ([waiting = "", early = "", late = ""]) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const home = yield* fs.makeTempDirectoryScoped({ prefix: "spans." });
              yield* queue(home, rebuild(waiting));
              yield* deliver(home, RECORDS[0], rebuild(early));
              yield* deliver(home, RECORDS[1], rebuild(late));

              const outputs = yield* spanOutputs(home);
              const order = Arr.map(outputs, (output) => (output as { readonly spanId: string }).spanId);

              expect(order[0], "the queue is read first").toBe(waiting);
              expect(Arr.sort(order.slice(1), Order.String)).toEqual(Arr.sort([early, late], Order.String));
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }) },
    );
  });

  it("a flush that lands under a listing never hides the span, wherever its record's file sorts and whether or not that file was there", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          spanId: ids,
          record: fc.constantFrom(...RECORDS),
          // The record has rows already, or the flush's delivery makes its file.
          before: fc.option(ids, { nil: undefined }),
          // Which listing the flush lands under. The read lists the home once for each of its passes.
          at: fc.constantFrom(1, 2),
        }),
        ({ spanId, record, before, at }) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const real = yield* FileSystem.FileSystem;
                const home = yield* real.makeTempDirectoryScoped({ prefix: "spans." });
                const row = rebuild(spanId);
                yield* queue(home, row);

                if (before !== undefined && before !== spanId) {
                  yield* deliver(home, record, rebuild(before));
                }

                let listings = 0;

                const fs: FileSystem.FileSystem = {
                  ...real,
                  glob: (pattern, options) =>
                    Effect.gen(function* () {
                      listings += 1;

                      if (listings === at) {
                        yield* flush(home, record, row).pipe(
                          Effect.provideService(FileSystem.FileSystem, real),
                          Effect.orDie,
                        );
                      }

                      return yield* real.glob(pattern, options);
                    }),
                };

                const outputs = yield* spanOutputs(home).pipe(Effect.provideService(FileSystem.FileSystem, fs));

                expect(listings, "the flush landed during the read").toBeGreaterThanOrEqual(at);
                expect(
                  Arr.filter(rebuildSpans(outputs), (span) => span.spanId === spanId),
                  "the flushed span is found once",
                ).toHaveLength(1);
              }),
            ).pipe(Effect.provide(NodeServices.layer)),
          ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 8, full: 40 }) },
    );
  });
});

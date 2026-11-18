// T753 L16 full-depth fix, next/. The driver (node/SinkBatch.test.ts) owns the in-memory SQLite (0062). A1 to A5 of the plan (docs/plan/quests/t753-l16-full-depth-PLAN.md):
// the spans of one call commit together, before the call ends, through the sink's own tracer.
// Decision 0122: a record is flushed before each call ends. The sink here is real, on in-memory SQLite;
// only the transaction log below watches it. The laws go through `SpanSink.layer`, `sink.batch`,
// `sink.flush` and the tracer the layer gives, never past them.
//
// The shape these laws hold the sink to:
// - A span that ends inside `batch` is in neither `unsent` nor `measurements` until the batch ends, then
//   all of the batch's spans land in one transaction. A span that ends outside any batch lands at once.
// - `flush` inside a batch ships every span the batch ended before it.
// - A tracer that wraps the sink's own, as `recordingLayer` does, still tags a batched span.
// - A batch belongs to its sink, and a span that ends after its batch closed lands at once.
// - A batch that meets a full disk is held whole and lands at the next commit.
import { describe, expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, type Scope, Stream, Tracer } from "effect";
import type { Sql } from "../Sql.ts";
import { Archive } from "./Archive.ts";
import { RecordManager } from "./Records.ts";
import { SinkError, SpanSink } from "./Sink.ts";
import { Chain } from "./Trace.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const BIG = 1024 * 1024 * 1024;

const spans = Chain.cases.spans.make({});

/** What each law's generator reached, checked once the file's laws have run: a case never reached
 *  is a law that proved less than it says. */
const reached = new Map<string, Set<string>>();

const reach = (law: string, kind: string) => {
  const kinds = reached.get(law) ?? new Set<string>();
  kinds.add(kind);
  reached.set(law, kinds);
};

const REQUIRED: Record<string, ReadonlyArray<string>> = {
  A1: ["outside", "inside", "ok", "fail", "interrupt", "failed span", "interrupted span"],
  A2: ["spans before the flush", "spans after the flush"],
  A3: ["tags"],
  A4: ["other sink", "other sink's tracer running", "late span started inside", "late span started after"],
  A5: ["disk filled", "disk held"],
};

/** One sink over its own in-memory database. Its `Sql` counts each transaction that landed spans, which
 *  is all the laws ask of it. */
const open = Effect.fnUntraced(function* (memory: Memory, object: string) {
  const raw = yield* memory;
  const landings: Array<number> = [];
  let inserts = 0;

  const sql: Sql = {
    exec: (query, ...params) => {
      if (/INSERT INTO unsent/i.test(query)) {
        inserts += 1;
      }

      return raw.exec(query, ...params);
    },
    transaction: (step) => {
      inserts = 0;
      const done = raw.transaction(step);

      if (inserts > 0) {
        landings.push(inserts);
      }

      return done;
    },
    size: () => raw.size(),
  };

  const context = yield* Layer.build(
    SpanSink.layer(sql, { object }).pipe(Layer.provideMerge(Layer.merge(RecordManager.memory(BIG), Archive.memory))),
  );

  const count = (table: string): number => Number(raw.exec(`SELECT count(*) AS n FROM ${table}`)[0]?.["n"]);
  const pragma = (text: string) => raw.exec(`PRAGMA ${text}`)[0] ?? {};

  const tables = (): ReadonlySet<string> =>
    new Set(raw.exec(`SELECT name FROM sqlite_master WHERE type='table'`).map((row) => String(row["name"])));

  return {
    sql,
    context,
    sink: Context.get(context, SpanSink),
    tracer: Context.get(context, Tracer.Tracer),
    pragma,
    /** Rows in a table, 0 before the sink made its tables with the first span. */
    rows: (table: string) => (tables().has(table) ? count(table) : 0),
    /** The span rows `unsent` holds, as the record would receive them. */
    unsent: () =>
      tables().has("unsent")
        ? raw
            .exec(`SELECT row FROM unsent ORDER BY rowid`)
            .map((row) =>
              Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ attributes: Schema.Any })))(row["row"]),
            )
        : [],
    /** The number of spans each transaction landed, oldest first. */
    landings,
    recorded: Effect.provideContext(
      RecordManager.use((records) => Stream.runCollect(records.read(spans))),
      context,
    ),
    flush: Effect.provideContext(
      SpanSink.use((s) => s.flush),
      context,
    ),
  };
});

/** A fresh in-memory database for each call, closed with the scope that asked. */
type Memory = Effect.Effect<Sql, never, Scope.Scope>;

const Piece = Schema.Literals(["ledger.append", "process.msg", "project.route", "process.open"]);

const Ending = Schema.Literals(["success", "failure", "interrupt"]);

/** A span tree: `depth` nested spans, the innermost ending as `ending` says. */
const Tree = Schema.Struct({
  name: Piece,
  depth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
  ending: Ending,
});

type Tree = typeof Tree.Type;

const ENDINGS: Record<typeof Ending.Type, Effect.Effect<void, string>> = {
  success: Effect.void,
  failure: Effect.fail("boom"),
  interrupt: Effect.interrupt,
};

/** The tree as work: every span in it ends, and the tree's own exit never leaves it. */
const tree = ({ name, depth, ending }: Tree, attributes: Record<string, string | number> = {}): Effect.Effect<void> => {
  const core: Effect.Effect<void, string> = ENDINGS[ending];
  let work = core;

  for (let level = 0; level < depth; level++) {
    work = work.pipe(Effect.withSpan(`${name}.${level}`, { attributes }));
  }

  return Effect.asVoid(Effect.exit(work));
};

const spansIn = (trees: ReadonlyArray<Tree>) => trees.reduce((total, one) => total + one.depth, 0);

const noteTrees = (law: string, trees: ReadonlyArray<Tree>) => {
  for (const one of trees) {
    if (one.ending === "failure") {
      reach(law, "failed span");
    }

    if (one.ending === "interrupt") {
      reach(law, "interrupted span");
    }
  }
};

/** `runs` is the law's case count for this depth, which the driver reads (decision 0535). */
export const suite = (memory: Memory, runs: number) =>
  describe("T753 L16 spans commit with their call", () => {
    const options = { arbitrary: { seed: SEED, runs } };

    // Plants (run once, not kept): the collecting tracer commits each span as it ends, so nothing waits for
    // the end (red on "none before the end"); and `Effect.ensuring` becomes `Effect.tap`, so a failed or
    // interrupted call commits nothing (red on the failure and interrupt cases).
    it.effect.prop(
      "A1 spans ended inside a batch land together when it ends, on success, failure or interruption, and spans outside one land at once",
      {
        outside: Schema.Array(Tree).check(Schema.isMaxLength(4)),
        inside: Schema.Array(Tree).check(Schema.isMaxLength(5)),
      },
      ({ outside, inside }) =>
        // Each plan runs all three ways its batch can end, so no end is left to the generator.
        Effect.forEach(
          Ending.literals,
          (end) =>
            Effect.scoped(
              Effect.gen(function* () {
                const w = yield* open(memory, "a1");
                noteTrees("A1", [...outside, ...inside]);
                reach("A1", { success: "ok", failure: "fail", interrupt: "interrupt" }[end]);

                if (outside.length > 0) {
                  reach("A1", "outside");
                }

                if (inside.length > 0) {
                  reach("A1", "inside");
                }

                // A span that ends outside a batch is in `unsent` and `measurements` before `end` returns.
                let landed = 0;

                for (const one of outside) {
                  yield* tree(one).pipe(Effect.provideContext(w.context));
                  landed += one.depth;
                  expect(w.rows("unsent")).toBe(landed);
                  expect(w.rows("measurements")).toBe(landed);
                  expect(w.landings, "one transaction for each span outside a batch").toHaveLength(landed);
                }

                const before = {
                  landings: w.landings.length,
                  unsent: w.rows("unsent"),
                  measurements: w.rows("measurements"),
                };

                const gate = yield* Deferred.make<void>();
                // What the store held when the batch's work was done, read inside and checked after.
                let during = { unsent: -1, measurements: -1, landings: -1 };

                const work = Effect.gen(function* () {
                  for (const one of inside) {
                    yield* tree(one);
                  }

                  during = {
                    unsent: w.rows("unsent"),
                    measurements: w.rows("measurements"),
                    landings: w.landings.length,
                  };
                  yield* Deferred.succeed(gate, undefined);

                  if (end === "failure") {
                    return yield* Effect.fail("the call failed");
                  }

                  if (end === "interrupt") {
                    return yield* Effect.never;
                  }
                });

                const call = w.sink.batch(work).pipe(Effect.provideContext(w.context));

                if (end === "interrupt") {
                  const fiber = yield* Effect.forkChild(call);
                  yield* Deferred.await(gate);
                  yield* Fiber.interrupt(fiber);
                } else {
                  expect(Exit.isSuccess(yield* Effect.exit(call))).toBe(end === "success");
                }

                expect(during, "no span or measurement of the batch is stored before it ends").toEqual({
                  unsent: before.unsent,
                  measurements: before.measurements,
                  landings: before.landings,
                });
                const total = spansIn(inside);
                expect(w.rows("unsent")).toBe(before.unsent + total);
                expect(w.rows("measurements"), "one measurement for each span").toBe(before.measurements + total);
                expect(w.landings.slice(before.landings), "the batch lands in one transaction").toEqual(
                  total === 0 ? [] : [total],
                );
              }),
            ),
          { concurrency: 1, discard: true },
        ),
      options,
    );

    // Plant: `flush` skips the open batch, so the spans the batch ended before it are not shipped.
    it.effect.prop(
      "A2 a flush inside a batch ships every span the batch ended before it, and later spans ship at the next flush",
      {
        before: Schema.Array(Tree).check(Schema.isMaxLength(5)),
        after: Schema.Array(Tree).check(Schema.isMaxLength(5)),
      },
      ({ before, after }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(memory, "a2");

            if (before.length > 0) {
              reach("A2", "spans before the flush");
            }

            if (after.length > 0) {
              reach("A2", "spans after the flush");
            }

            let shippedInside = -1;
            const during: Array<number> = [];
            yield* w.sink
              .batch(
                Effect.gen(function* () {
                  for (const one of before) {
                    yield* tree(one);
                  }

                  shippedInside = (yield* SpanSink.use((s) => s.flush).pipe(Effect.provideContext(w.context))).sent;
                  during.push(w.rows("unsent"));

                  for (const one of after) {
                    yield* tree(one);
                  }

                  during.push(w.rows("unsent"));
                }),
              )
              .pipe(Effect.provideContext(w.context));

            expect(shippedInside, "the flush inside the batch shipped what the batch had ended").toBe(spansIn(before));
            expect(during, "the flush left nothing the batch had ended, and later spans wait for its end").toEqual([
              0, 0,
            ]);
            expect((yield* w.recorded).length).toBe(spansIn(before));
            expect(w.rows("unsent"), "later spans landed at the batch's end").toBe(spansIn(after));
            expect((yield* w.flush).sent).toBe(spansIn(after));
            expect((yield* w.recorded).length).toBe(spansIn(before) + spansIn(after));
            expect(w.rows("unsent")).toBe(0);
          }),
        ),
      options,
    );

    // Plant: today's `batch`, which swaps the tracer, so a wrapper outside it never sees the span: every
    // tag below is missing. This law starts red on main.
    it.effect.prop(
      "A3 a batched span keeps every wrapping tracer's attributes",
      {
        trees: Schema.Array(Tree).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
        tags: Schema.Array(
          Schema.Struct({
            key: Schema.Literals(["fab.settings", "fab.build", "wrap.zone"]),
            value: Schema.String.check(Schema.isPattern(/^[a-z0-9]{1,8}$/)),
          }),
        ).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
      },
      ({ trees, tags }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(memory, "a3");
            reach("A3", "tags");
            const wanted = new Map(tags.map(({ key, value }) => [key, value]));

            // The wrapper `recordingLayer` makes: the sink's tracer, then attributes on each new span.
            const wrapper = Tracer.make({
              context: w.tracer.context,
              span: (init) => {
                const span = w.tracer.span(init);

                for (const [key, value] of wanted) {
                  span.attribute(key, value);
                }

                return span;
              },
            });

            yield* w.sink
              .batch(
                Effect.gen(function* () {
                  for (const one of trees) {
                    yield* tree(one);
                  }
                }),
              )
              .pipe(Effect.withTracer(wrapper), Effect.provideContext(w.context));

            const rows = w.unsent();
            expect(rows).toHaveLength(spansIn(trees));

            for (const row of rows) {
              for (const [key, value] of wanted) {
                expect(row.attributes[key], `a batched span keeps ${key}`).toBe(value);
              }
            }
          }),
        ),
      options,
    );

    // Plants (after build, they need the build's Sink.ts): the batch ignores whose sink opened it, so a
    // span of the other sink lands in the wrong database; and the `closed` check is dropped, so a late span
    // never lands. The late-span case is red on main already: its spans go to a list nobody reads. And the
    // collecting tracer keeps a running span only when this sink made it, so `&& made.owner === self` is
    // dropped: a batch that runs under another sink's tracer keeps that sink's span, which lands there.
    it.effect.prop(
      "A4 a batch belongs to its sink, and a span that ends after its batch closed lands at once",
      {
        mine: Schema.Array(Tree).check(Schema.isMaxLength(3)),
        other: Schema.Array(Tree).check(Schema.isMaxLength(3)),
        lateSpans: Schema.Array(Schema.Struct({ name: Piece, started: Schema.Literals(["inside", "after"]) })).check(
          Schema.isMaxLength(3),
        ),
        crossed: Schema.Array(Tree).check(Schema.isMaxLength(3)),
      },
      ({ mine, other, lateSpans, crossed }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const a = yield* open(memory, "a4-a");
            const b = yield* open(memory, "a4-b");

            if (other.length > 0) {
              reach("A4", "other sink");
            }

            for (const one of lateSpans) {
              reach("A4", { inside: "late span started inside", after: "late span started after" }[one.started]);
            }

            const close = yield* Deferred.make<void>();
            const late: Array<Fiber.Fiber<void>> = [];
            let during = { mine: -1, other: -1 };

            const work = Effect.gen(function* () {
              for (const one of lateSpans) {
                const open = yield* Deferred.make<void>();
                const waiting = Deferred.await(close);

                const run =
                  one.started === "inside"
                    ? Deferred.succeed(open, undefined).pipe(
                        Effect.andThen(waiting),
                        Effect.withSpan(`${one.name}.late`),
                      )
                    : Deferred.succeed(open, undefined).pipe(
                        Effect.andThen(waiting),
                        Effect.andThen(Effect.void.pipe(Effect.withSpan(`${one.name}.late`))),
                      );

                late.push(yield* Effect.forkDetach(run));
                // The late span is made, or its fiber is waiting to make it, before the batch closes.
                yield* Deferred.await(open);
              }

              for (const one of other) {
                yield* tree(one).pipe(Effect.withTracer(b.tracer));
              }

              for (const one of mine) {
                yield* tree(one);
              }

              during = { mine: a.rows("unsent"), other: b.rows("unsent") };
            });

            yield* a.sink.batch(work).pipe(Effect.provideContext(a.context));
            expect(during, "the batch held its own sink's spans only, and another sink's span landed at once").toEqual({
              mine: 0,
              other: spansIn(other),
            });
            expect(a.rows("unsent")).toBe(spansIn(mine));
            expect(b.rows("unsent")).toBe(spansIn(other));
            const landed = a.landings.length;
            yield* Deferred.succeed(close, undefined);

            for (const fiber of late) {
              yield* Fiber.join(fiber);
            }

            expect(a.rows("unsent"), "a span that ends after its batch closed lands at once").toBe(
              spansIn(mine) + lateSpans.length,
            );
            expect(a.landings.length - landed, "each late span in its own transaction").toBe(lateSpans.length);
            expect(b.rows("unsent")).toBe(spansIn(other));

            // The other direction: b's batch runs while a's tracer is the running one. Each span lands in the
            // sink whose batch made it, b's, in one transaction, and a keeps what it had.
            if (crossed.length > 0) {
              reach("A4", "other sink's tracer running");
            }

            const heldByB = b.landings.length;
            yield* b.sink
              .batch(Effect.forEach(crossed, (one) => tree(one), { concurrency: 1, discard: true }))
              .pipe(Effect.withTracer(a.tracer));
            expect(
              a.rows("unsent"),
              "a batch of one sink under another sink's tracer left that sink's database alone",
            ).toBe(spansIn(mine) + lateSpans.length);
            expect(b.rows("unsent"), "each span landed in the sink whose batch ran").toBe(
              spansIn(other) + spansIn(crossed),
            );
            expect(b.landings.length - heldByB, "in one transaction").toBe(crossed.length > 0 ? 1 : 0);
          }),
        ),
      options,
    );

    // Plant: drop the held batch when its commit fails, so its spans are gone: the final set is short.
    it.effect.prop(
      "A5 a batch that meets a full disk is held whole, the next flush fails storage, and no span is dropped",
      {
        batches: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 24 }))).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(4),
        ),
        extra: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
      },
      ({ batches, extra }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(memory, "a5");
            // One span first, so the sink's tables exist, then the file may grow by `extra` pages only.
            yield* w.sink
              .batch(tree({ name: "process.msg", depth: 1, ending: "success" }, { i: -1 }))
              .pipe(Effect.provideContext(w.context));
            const pages = Number(w.pragma("page_count")["page_count"]);
            w.pragma(`max_page_count = ${pages + extra}`);
            let made = 0;

            for (const size of batches) {
              yield* w.sink
                .batch(
                  Effect.gen(function* () {
                    for (let n = 0; n < size; n++) {
                      yield* tree({ name: "process.msg", depth: 1, ending: "success" }, { i: made++ });
                    }
                  }),
                )
                .pipe(Effect.provideContext(w.context));
            }

            const held = made - (w.rows("unsent") - 1);
            const first = yield* Effect.exit(w.flush);

            if (held === 0) {
              reach("A5", "disk held");
              expect(first, "every commit landed, so the flush ships").toEqual(Exit.succeed({ sent: made + 1 }));
            } else {
              reach("A5", "disk filled");
              expect(Exit.isFailure(first), "a commit that did not land fails the next flush").toBe(true);
              expect(Exit.findErrorOption(first).pipe(Option.getOrThrow)).toEqual(
                new SinkError({ reason: "storage", held }),
              );
              expect((yield* w.recorded).length, "nothing was sent before the failure").toBe(0);
            }

            // Room again: the next commit lands what was held, with its own span, and nothing was dropped.
            w.pragma("max_page_count = 1073741823");
            yield* w.sink
              .batch(tree({ name: "process.msg", depth: 1, ending: "success" }, { i: made++ }))
              .pipe(Effect.provideContext(w.context));
            yield* w.flush;
            const shipped = (yield* w.recorded).map((row) => Number(row.attributes["i"])).sort((x, y) => x - y);
            expect(shipped).toEqual(Array.from({ length: made + 1 }, (_, n) => n - 1));
            expect(w.rows("unsent")).toBe(0);
          }),
        ),
      options,
    );
    it("scenario: every case the laws name was reached by their generated inputs", () => {
      const missing = Object.entries(REQUIRED).flatMap(([law, kinds]) =>
        kinds.filter((kind) => !(reached.get(law)?.has(kind) ?? false)).map((kind) => `${law}: ${kind}`),
      );

      expect(missing, "cases a law's generator never reached").toEqual([]);
    });
  });

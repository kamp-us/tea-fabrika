// P39 slice 4b, next/: the journal file's merge-line law J1. SQLite on `:memory:` stays in the
// process (0536), so this runs on pull requests; J2, a real file and a real SIGKILL, runs on the
// schedule.
//
// What this law holds `node/client/JournalSqlite.ts` to, from the approved plan
// (docs/plan/lanes/p39-s5-PLAN.md, "The journal file"): `JournalSqlite.layer({ file })` supplies
// Effect's `KeyValueStore` over one SQLite file, one row per key, and 4a's `JournalStore.layer` runs
// on it unchanged. Over it the journal reads exactly what the same writes give over Effect's own
// `KeyValueStore.layerMemory`, the store holds one value per key however often it is written, and a
// saved value that is no entry reads as `bad_entry` on both.
//
// The walk is fast-check's `fc.commands`: write a new task, read a task written, overwrite a task
// written, read a task never written, and save a value that is no entry, each picked only where the
// model allows it (0093). The memory store is the oracle, and the model checks it too.
//
// Plant, run once and undone (recorded in the tests step's field row): leave out the `PRIMARY KEY`,
// so an overwrite adds a second row.
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Exit, Layer } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as fc from "fast-check";
import { Journal, type Entry, Entry as EntrySchema } from "../../client/Journal.ts";
import * as JournalStore from "../../client/JournalStore.ts";
import { Result } from "../../tasks/Task.ts";
import { property } from "../../Testing.test-support.ts";
import * as JournalSqlite from "./JournalSqlite.ts";

/** What one store answers a read: the entry, nothing, or the journal error's reason. */
type Read =
  | { readonly _tag: "entry"; readonly entry: Entry }
  | { readonly _tag: "none" }
  | { readonly _tag: "error"; readonly reason: string };

/** One journal over one store, with the store itself for a raw value and its size. */
type Side = { readonly journal: Context.Service.Shape<typeof Journal>; readonly store: KeyValueStore.KeyValueStore };

type Model = { readonly saved: Map<string, Entry | "not-an-entry"> };

type Real = {
  readonly pool: ReadonlyArray<string>;
  readonly sql: Side;
  readonly memory: Side;
  next: Effect.Effect<string> | null;
};

interface Step extends fc.Command<Model, Real> {
  readonly step: (m: Model, r: Real) => Effect.Effect<string>;
}

/** fast-check's `run` only hands the walk the step's Effect, which the walk then runs at once. */
function handOff(this: Step, m: Model, r: Real) {
  r.next = this.step(m, r);
}

const side = (store: Layer.Layer<KeyValueStore.KeyValueStore>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(store);
    const kv = Context.get(context, KeyValueStore.KeyValueStore);
    const journal = yield* Journal.use((j) => Effect.succeed(j)).pipe(
      Effect.provide(JournalStore.layer),
      Effect.provideContext(context),
    );
    return { journal, store: kv } satisfies Side;
  });

const read = (s: Side, task: string): Effect.Effect<Read> =>
  s.journal.read(task).pipe(
    Effect.map((entry): Read => (entry === null ? { _tag: "none" } : { _tag: "entry", entry })),
    Effect.catch((error) => Effect.succeed<Read>({ _tag: "error", reason: error.reason })),
  );

/** Both stores answer one read alike, and both hold as many values as the model. */
const agree = (m: Model, r: Real, task: string, label: string) =>
  Effect.gen(function* () {
    const sql = yield* read(r.sql, task);
    const memory = yield* read(r.memory, task);
    expect(sql, `J1: ${label}: the SQLite journal reads what the memory journal reads`).toEqual(memory);
    const saved = m.saved.get(task);
    expect(memory, `J1: ${label}: the memory journal reads what was written`).toEqual(
      saved === undefined
        ? { _tag: "none" }
        : saved === "not-an-entry"
          ? { _tag: "error", reason: "bad_entry" }
          : { _tag: "entry", entry: saved },
    );
    const sizes = yield* Effect.all([r.sql.store.size, r.memory.store.size], { concurrency: 1 }).pipe(Effect.orDie);
    expect(sizes, `J1: ${label}: one value per key, however often a key is written`).toEqual([
      m.saved.size,
      m.saved.size,
    ]);
  });

const written = (m: Readonly<Model>, r: Real) => r.pool.filter((task) => m.saved.has(task));
const unwritten = (m: Readonly<Model>, r: Real) => r.pool.filter((task) => !m.saved.has(task));
const pick = <A>(from: ReadonlyArray<A>, n: number): A | undefined => from[n % Math.max(from.length, 1)];

/** A write of a new task, or with `over` of a task already written. */
const writeStep = (over: boolean, n: number, entry: Entry): Step => ({
  check: (m) => (over ? m.saved.size > 0 : true),
  run: handOff,
  toString: () => `${over ? "overwrite" : "write"}(${n}, ${entry._tag})`,
  step: (m, r) =>
    Effect.gen(function* () {
      const task = pick(over ? written(m, r) : unwritten(m, r), n) ?? pick(r.pool, n) ?? "task";
      const both = yield* Effect.all([r.sql.journal.write(task, entry), r.memory.journal.write(task, entry)], {
        concurrency: 1,
      }).pipe(Effect.exit);
      expect(Exit.isSuccess(both), `J1: a write succeeds on both stores: ${String(both)}`).toBe(true);
      m.saved.set(task, entry);
      yield* agree(m, r, task, `after ${over ? "overwrite" : "write"} of ${task}`);
      return over ? "overwrite" : "write";
    }),
});

/** A read of a task written, or with `missing` of a task never written. */
const readStep = (missing: boolean, n: number): Step => ({
  check: (m) => (missing ? true : m.saved.size > 0),
  run: handOff,
  toString: () => `read(${missing ? "missing" : "written"}, ${n})`,
  step: (m, r) =>
    Effect.gen(function* () {
      const task = pick(missing ? unwritten(m, r) : written(m, r), n);

      if (task === undefined) {
        return "skip";
      }

      yield* agree(m, r, task, `read of ${task}`);
      return missing ? "read:missing" : `read:${m.saved.get(task) === "not-an-entry" ? "bad_entry" : "entry"}`;
    }),
});

/** A value that is no entry, saved under a task straight through each store. */
const garbageStep = (n: number, value: string): Step => ({
  check: () => true,
  run: handOff,
  toString: () => `garbage(${n}, ${JSON.stringify(value)})`,
  step: (m, r) =>
    Effect.gen(function* () {
      const task = pick(r.pool, n) ?? "task";
      yield* Effect.all([r.sql.store.set(task, value), r.memory.store.set(task, value)], { concurrency: 1 }).pipe(
        Effect.orDie,
      );
      m.saved.set(task, "not-an-entry");
      yield* agree(m, r, task, `after a value that is no entry under ${task}`);
      return "garbage";
    }),
});

const Text = fc.string({ minLength: 1, maxLength: 24 });
const At = fc.integer({ min: 0, max: 4_102_444_800_000 }).map((ms) => new Date(ms).toISOString());

// fast-check: unsupported Effect -- fc.commands draws every step from fast-check arbitraries, and Effect's Arbitrary is another engine
const AResult = fc.oneof(
  fc
    .record({ code: fc.integer({ min: -255, max: 255 }), version: fc.string({ maxLength: 60 }) })
    .map((r) => Result.cases.exited.make(r)),
  fc.constantFrom("unavailable", "spawn_failed", "output_limit").map((reason) => Result.cases.failed.make({ reason })),
  fc.constant(Result.cases.unknown.make({ reason: "interrupted" })),
);

const Started = fc.option(At, { nil: undefined }).map((startedAt) => (startedAt === undefined ? {} : { startedAt }));
const E = EntrySchema.cases;

/** Each of the five entries the 4a journal saves, with generated fields. */
// fast-check: unsupported Effect -- fc.commands draws every step from fast-check arbitraries, and Effect's Arbitrary is another engine
const AnEntry: fc.Arbitrary<Entry> = fc.oneof(
  fc.record({ execution: Text, at: At }).map((e) => E.prepared.make(e)),
  fc.record({ execution: Text, at: At }).map((e) => E.executing.make(e)),
  fc
    .record({ execution: Text, result: AResult, started: Started, at: At })
    .map(({ started, ...e }) => E.result.make({ ...e, ...started })),
  fc
    .record({ execution: Text, result: AResult, rev: fc.nat(), started: Started, at: At })
    .map(({ started, ...e }) => E.acknowledged.make({ ...e, ...started })),
  fc
    .record({ execution: Text, result: AResult, reason: fc.string({ maxLength: 30 }), started: Started, at: At })
    .map(({ started, ...e }) => E.held.make({ ...e, ...started })),
);

/** A saved value that is never an entry: not JSON, or JSON of another shape. */
const NotAnEntry = fc.oneof(
  fc.string({ maxLength: 40 }).map((s) => `{${s}`),
  fc.constantFrom("", "null", "{}", "[]", '{"_tag":"prepared"}', '{"_tag":"done","execution":"x","at":"y"}'),
);

const Walk = fc.record({
  // Keys a task id may hold, quotes, slashes and letters past ASCII included.
  pool: fc.uniqueArray(fc.oneof(Text, fc.constantFrom("P/7/0", "task'1", 'task"2', "%_*", "ü/ş")), {
    minLength: 1,
    maxLength: 5,
  }),
  steps: fc.commands(
    [
      fc.record({ n: fc.nat(), entry: AnEntry }).map(({ n, entry }) => writeStep(false, n, entry)),
      fc.record({ n: fc.nat(), entry: AnEntry }).map(({ n, entry }) => writeStep(true, n, entry)),
      fc.nat().map((n) => readStep(false, n)),
      fc.nat().map((n) => readStep(true, n)),
      fc.record({ n: fc.nat(), value: NotAnEntry }).map(({ n, value }) => garbageStep(n, value)),
    ],
    { size: "+1" },
  ),
});

describe("P39 slice 4b: the journal file", () => {
  it.live(
    "J1: the 4a journal over JournalSqlite on :memory: reads exactly what the same writes give over KeyValueStore.layerMemory, and a value that is no entry is bad_entry on both",
    () =>
      Effect.gen(function* () {
        const reached = new Set<string>();
        yield* property(
          Walk,
          ({ pool, steps }) =>
            Effect.gen(function* () {
              const r: Real = {
                pool,
                sql: yield* side(JournalSqlite.layer({ file: ":memory:" })),
                memory: yield* side(KeyValueStore.layerMemory),
                next: null,
              };
              const m: Model = { saved: new Map() };

              // fast-check's own model walk: a step runs only when the state it reached allows it.
              for (const s of steps) {
                if (s.check(m)) {
                  s.run(m, r);
                  const next = r.next;
                  r.next = null;

                  if (next !== null) {
                    reached.add(yield* next);
                  }
                }
              }
            }),
          { numRuns: 100 },
        );
        expect([...reached]).toEqual(
          expect.arrayContaining(["write", "overwrite", "read:entry", "read:bad_entry", "read:missing", "garbage"]),
        );
      }),
    120_000,
  );
});

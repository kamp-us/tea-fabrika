// Laws D1 to D3 and V6. `TestDatabase.make` opens a file the test owns with its journal in memory and
// no disk sync, and closes it with the scope; a reopen is Effect's own `ScopedRef.set`;
// `TestDatabase.open` opens a file another party owns and sets nothing in it. Each law drives a real
// file in a scoped temp folder, so this file runs in the full run and never on a pull request, with its
// case count from the test depth.
//
// Plants for D1 to D3: D1, drop the
// pragma line (`delete` and `2` are read) and drop the release (`isOpen` after the scope); D2, `WAL`
// in place of `MEMORY` (a `-wal` file is listed) and a release that does not close (a replaced or
// released connection is still open); D3, `open` runs `make`'s pragma line (the file reads `memory`)
// and `Effect.sync` in place of `Effect.try` (a defect in place of the typed error). D3 also holds the
// lines of `TestDatabase.ts` that the laws above leave to it, each with its own plant: `readOnly: options.readOnly
// ?? false` made `?? true` (the open with no options refuses its write), `readOnly` dropped from the options
// (the readOnly open accepts its write), `timeout` left at 0 or made `options.wait` read as a count of seconds
// (`PRAGMA busy_timeout` is not the drawn wait), and `close` made `db.close()` with no `isOpen` check (the
// connection the law closed throws when the scope releases it, a defect).
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ScopedRef from "effect/ScopedRef";
import * as Tracer from "effect/Tracer";
import { runsFor } from "./Depth.ts";
import * as TestDatabase from "./TestDatabase.ts";

const SEED = 119120; // one seed for every law, so a red run repeats

/** A file name: letters, digits, dots and dashes, 1 to 40 characters, never `.` or `..`. */
const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/));

/** A row a law writes: an integer and printable text, which read back exactly as written. */
const Row = Schema.Struct({
  n: Schema.Int.check(Schema.isBetween({ minimum: -1_000_000_000, maximum: 1_000_000_000 })),
  text: Schema.String.check(Schema.isPattern(/^[ -~]{0,30}$/)),
});

/** A scoped temp folder, removed with the law's scope, and a file in it under the generated name. */
const inFolder = Effect.fnUntraced(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "test-database-" });

  return { dir, file: path.join(dir, name) };
});

it.effect.prop(
  "D1: make opens a file with journal_mode memory and synchronous 0, and the scope's close leaves it closed",
  { name: Name },
  ({ name }) =>
    Effect.gen(function* () {
      const { file } = yield* inFolder(name);

      const db = yield* Effect.scoped(
        Effect.gen(function* () {
          const db = yield* TestDatabase.make(file);
          expect(db.isOpen).toBe(true);
          expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "memory" });
          expect(db.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 0 });

          return db;
        }),
      );

      expect(db.isOpen).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: SEED, runs: runsFor({ fast: 5, full: 50 }) } },
);

it.effect.prop(
  "D2: through ScopedRef.set, every committed row reads back after any number of reopens, and the folder holds only the file",
  {
    name: Name,
    steps: Schema.Array(
      Schema.Struct({
        rows: Schema.Array(Row).check(Schema.isMaxLength(8)),
        reopens: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
  },
  ({ name, steps }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { dir, file } = yield* inFolder(name);
      // Every connection the law was handed, to see each one closed once it is replaced or released.
      const handed: Array<{ readonly isOpen: boolean }> = [];
      const committed: Array<typeof Row.Type> = [];

      yield* Effect.scoped(
        Effect.gen(function* () {
          const held = yield* ScopedRef.fromAcquire(TestDatabase.make(file));
          const current = () => ScopedRef.getUnsafe(held);
          const rows = () => current().prepare("SELECT n, text FROM t ORDER BY seq").all();
          handed.push(current());
          current().exec("CREATE TABLE t (seq INTEGER PRIMARY KEY, n INTEGER NOT NULL, text TEXT NOT NULL)");

          for (const step of steps) {
            const db = current();
            const insert = db.prepare("INSERT INTO t (n, text) VALUES (?, ?)");
            db.exec("BEGIN IMMEDIATE");

            for (const row of step.rows) {
              insert.run(row.n, row.text);
            }

            db.exec("COMMIT");
            committed.push(...step.rows);
            expect(yield* fs.readDirectory(dir)).toEqual([name]);

            for (let reopen = 0; reopen < step.reopens; reopen++) {
              const before = current();
              yield* ScopedRef.set(held, TestDatabase.make(file));
              handed.push(current());
              expect(before.isOpen).toBe(false);
              expect(current().isOpen).toBe(true);
              expect(rows()).toEqual(committed.map(({ n, text }) => ({ n, text })));
            }
          }

          expect(rows()).toEqual(committed.map(({ n, text }) => ({ n, text })));
        }),
      );

      expect(handed.map((db) => db.isOpen)).toEqual(handed.map(() => false));
      expect(yield* fs.readDirectory(dir)).toEqual([name]);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: SEED, runs: runsFor({ fast: 5, full: 50 }) } },
);

it.effect.prop(
  "D3: open sets no pragma on a WAL file, hands its wait to SQLite and none by default, a readOnly open refuses a write and an open with no options accepts one, a connection the law closed is released without a defect, and a missing file under readOnly fails with TestDatabaseError naming it",
  {
    name: Name,
    readOnly: Schema.Boolean,
    row: Row,
    other: Row,
    wait: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
  },
  ({ name, readOnly, row, other, wait }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { dir, file } = yield* inFolder(name);

      // Another connection owns the file: it puts it in WAL, which SQLite saves in the file itself.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* TestDatabase.make(file);
          expect(owner.prepare("PRAGMA journal_mode=WAL").get()).toEqual({ journal_mode: "wal" });
          owner.exec("CREATE TABLE t (n INTEGER NOT NULL, text TEXT NOT NULL)");
        }),
      );

      const opened = yield* Effect.scoped(
        Effect.gen(function* () {
          const db = yield* TestDatabase.open(file, { readOnly, wait: Duration.millis(wait) });
          expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
          // The wait is how long SQLite waits on a lock another process holds.
          expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: wait });

          const write = yield* Effect.exit(
            Effect.try(() => db.prepare("INSERT INTO t (n, text) VALUES (?, ?)").run(row.n, row.text)),
          );

          expect(Exit.isFailure(write)).toBe(readOnly);
          // The law closes the connection itself, so the scope's release finds it closed and must leave it be.
          db.close();

          return db;
        }),
      );

      expect(opened.isOpen).toBe(false);

      // A fresh connection after the close, with no options: the file is still WAL, nothing waits on a lock, the
      // connection takes a write, and the file holds the first row only if it was written.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const fresh = yield* TestDatabase.open(file);
          expect(fresh.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
          expect(fresh.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 0 });
          fresh.prepare("INSERT INTO t (n, text) VALUES (?, ?)").run(other.n, other.text);
          expect(fresh.prepare("SELECT n, text FROM t ORDER BY rowid").all()).toEqual(
            readOnly ? [other] : [row, other],
          );
        }),
      );

      const missing = path.join(dir, `missing-${name}`);
      const error = yield* Effect.flip(Effect.scoped(TestDatabase.open(missing, { readOnly: true })));
      expect(error).toBeInstanceOf(TestDatabase.TestDatabaseError);
      expect(error.file).toBe(missing);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: SEED, runs: runsFor({ fast: 3, full: 30 }) } },
);

// V6 scenario: one `make` and one `open` on a file in a scoped temp folder, then the scope closes, under a tracer that keeps
// every span it is asked to start. The connections are checked too, so the law reads the paths it means to.
// Plants: wrap `make`'s acquire in Effect.withSpan, which starts one span; make `open` an Effect.fn("TestDatabase.open"),
// which starts one.
it.effect("V6 scenario: make and open on a file, then the scope closing, ask the tracer for no span", () =>
  Effect.gen(function* () {
    const delegate = yield* Tracer.Tracer;
    const spans: Array<Tracer.Span> = [];

    const tracer = Tracer.make({
      span(options) {
        const span = delegate.span(options);
        spans.push(span);

        return span;
      },
    });

    const { file } = yield* inFolder("v6.sqlite");

    const connections = yield* Effect.scoped(
      Effect.gen(function* () {
        const owned = yield* TestDatabase.make(file);
        const shared = yield* TestDatabase.open(file);

        return [owned, shared];
      }),
    ).pipe(Effect.withTracer(tracer));

    expect(connections.map((db) => db.isOpen)).toEqual([false, false]);
    expect(spans.map((span) => span.name)).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

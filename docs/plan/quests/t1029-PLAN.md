Approved by the lead agent, builds decision 0538 (next/'s test primitives live in @kampus/vitest) for ticket 1029; body 2b594a35a04c
Plancheck-Version: 3

# Plan: ticket 1029, a test opens its SQLite file through one module in `@kampus/vitest`, in next/

This is about `next/` and the lint tooling that reads it. Today's version is not touched. Every path
is checked against `origin/main` at `86a7668d6`. Installed: effect 4.1.2 (patched), `@effect/vitest`
4.1.2, vitest 5.0.5, Node 26.13.0. No product file changes.

```ts
// The whole idea. Before: each test file opens its own file, and 27 of them in SQLite's default mode.
const db = new DatabaseSync(file); // a rollback journal and a disk sync on every commit
// After: one module of the test primitives package (decision 0538) opens it, the same way everywhere.
import * as TestDatabase from "@kampus/vitest/TestDatabase";
const db = yield* TestDatabase.make(file); // journal in memory, no disk sync, closed with the scope
```

## The answer

- A new module, `next/packages/vitest/src/TestDatabase.ts`, read through its own subpath
  `@kampus/vitest/TestDatabase`. `TestDatabase.make(file)` opens a file the test owns, sets
  `journal_mode=MEMORY` and `synchronous=OFF`, and closes it when the scope closes.
  `TestDatabase.open(file, options)` opens a file something else owns (a running instance, the
  product's span queue) and sets nothing.
- A reopen is Effect's own `ScopedRef`: `ScopedRef.set(ref, TestDatabase.make(file))` closes the old
  connection and opens the new one. No reopen helper of ours.
- A new lint rule, `fabrika/test-database`, refuses `new DatabaseSync(<not ":memory:">)` in a next/
  test file, suite or test-support file. Today it fires on 62 calls in 53 files; after the move it
  fires on none, and none of the 62 is right as it is once `open` exists, so it blocks at 0 measured
  false alarms.
- All 53 files move in this one pull request: a half-moved tree needs the rule off.
- `Watchers.integration.test.ts` and `IsolateUsage.integration.test.ts` are timed before and after.
  If their time does not drop, disk syncs were not their cost, and the lead files a ticket for each.

## What I read, and what runs today

- **Decided notes:** [0538](../../../.decisions/0538-kampus-vitest-holds-the-test-primitives.md)
  (test primitives live in `@kampus/vitest`, which imports no service of ours);
  [0061](../../../.decisions/0061-resources-are-acquired-in-a-scope.md) (a database is acquired in
  a scope); [0052](../../../.decisions/0052-tests-never-depend-on-the-machine.md) (a test never
  depends on the machine, and a disk's sync speed is the machine);
  [0029](../../../.decisions/0029-format-and-names-follow-effect.md) and
  [0023](../../../.decisions/0023-next-follows-effects-code-style.md) (one PascalCase module per
  file, `make` constructors, test tooling follows the same names);
  [0069](../../../.decisions/0069-choices-are-settings.md),
  [0421](../../../.decisions/0421-reuse-before-special-rules.md),
  [0040](../../../.decisions/0040-existing-tools-before-hand-written.md),
  [0209](../../../.decisions/0209-schemas-are-effect-schema.md),
  [0535](../../../.decisions/0535-pull-requests-stay-fast-the-schedule-carries-the-rest.md) and
  [0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md).
- **Pull request 1300 (ticket 1028, merged today):** a test store in the default mode wrote and
  deleted a rollback journal and synced the disk on every commit. In the jobs law A5, 22,289 request
  commits took 11.0 to 13.9 s before and 3.0 s after `journal_mode=WAL; synchronous=OFF`, and the
  run's system time fell from 8.6 to 10.1 s to 2.0 s. Its body names about 30 test files still in
  the default mode, and `Watchers.integration.test.ts` at 645.7 s and
  `IsolateUsage.integration.test.ts` at 70.1 s in full run 43678841647, cause not measured.
- **The package today:** `next/packages/vitest` has `Depth.ts` (`runsFor`), its test and `index.ts`.
  Its manifest has one export (`.`), `sideEffects: false`, and depends on `effect` only.
- **Lint as built:** `oxlint-plugins/integration-test-name.ts` already reads `new DatabaseSync(x)`
  with `x` not the literal `":memory:"` as "a SQLite file" and asks for an `*.integration.test.ts`
  name. `oxlint-plugins/runs-from-depth.ts` counts a name imported from `node:sqlite`,
  `@kampus/libfabrika/sqlite` or `NodeSqlite` as real IO. Both key on the module a name comes from,
  so a file that drops its `node:sqlite` import for `TestDatabase` would slip past both unless the
  two rules learn the new module. `fabrika/package-imports` in `.oxlintrc.json` lists exact names in
  `may`: the "library suites" and "program suites" rows say `@kampus/vitest` and nothing under it.
  Their `tests` lists take every subpath.
- **Product as built:** `next/packages/libfabrika/src/node/dev/dev-recording.ts` opens the local
  brain's span queue with `journal_mode=WAL; synchronous=FULL`. `NodeSqlite.ts` takes a
  `DatabaseSync` and says it backs tests and that span queue only. Experiment 258 says the product
  ledger runs in a Durable Object, where workerd owns the journal (WAL).
- **Settled search:** `settled.sh` with "sqlite test store pragma", "journal mode WAL MEMORY test"
  and "disk sync per commit test" found nothing. `rg` over `.decisions`, `docs/direction`,
  `.glossary`, `docs/plan`, `experiments` and `field/findings` for `synchronous=OFF`,
  `journal_mode`, `test store` and `scoped temp` found only 0538's list, experiment 258's note that
  ProgramMail's tests used WAL with `synchronous=OFF`, experiment 93's note that workerd runs WAL,
  and ticket 1028's finding. No note picks a journal mode for tests.

### The 83 files that write `new DatabaseSync(`

| Group | Count | What happens to them |
|---|---|---|
| Product code | 1: `dev-recording.ts` | nothing; the rule reads test files only |
| In memory only (`":memory:"`) | 28 | nothing; the rule passes `":memory:"` |
| Test stores that set the pragmas by hand | 20: 9 with `MEMORY`, 11 with `WAL` | move to `make`; the 11 go from WAL to MEMORY |
| Test stores in SQLite's default mode | 27 | move to `make` |
| A connection to a file another party owns | 6 files, 7 calls | move to `open` |
| A match inside a template string | 1: `instance-database.integration.test.ts`, the child script | nothing; the rule reads code, not strings |

Two files sit in two groups and are counted once, by their file opens: `door.integration.test.ts`
(one `:memory:` call, one pragma'd store) and `dev-secrets.laws.integration.test.ts` (three
`:memory:` calls, one read of the product's span queue). The Files table names every file.

## How others do it

- **Effect, a scoped resource.** The installed `effect/AGENTS.md` points to
  `Effect.acquireRelease` for a resource and a `Layer` to offer it. A test uses `it.effect`, which
  gives a `Scope`, and `layer(...)` from `@effect/vitest` to share a built layer. So the primitive is
  a scoped Effect, and a test that wants it shared wraps it in `Layer.effect` itself.
- **Effect, a resource swapped in place.** `effect/ScopedRef` (`fromAcquire`, `set`, `getUnsafe`):
  `set` closes the old value's scope and acquires the new one. That is a reopen. Today 9 files write
  the same hand-made "one Sql across reopens" handle with a mutable `db` field.
- **Effect's own SQLite packages.** `SqliteClient.make` and `SqliteClient.layer` in
  `@effect/sql-sqlite-node` are the naming model: a module, a `make`, maybe a `layer`. The package
  is not in the lockfile, and its client is an async Effect SQL client, not the synchronous
  `DatabaseSync` that `nodeSql` and the referee's transactions take (`NodeSqlite.ts`'s edge comment
  says so). So 0040's check ends here: it does not fit, and adding it would change what the laws
  run on. I did not fetch its source; this is from its name and the repo's edge comments.
- **`@effect/vitest`.** It has `it.effect`, `layer`, `flakyTest` and `prop`, and nothing for a
  database file. It fits as the runner, not as the opener.
- **SQLite's own docs (not fetched, from memory, marked as such):** `journal_mode=MEMORY` keeps the
  rollback journal in RAM for this connection only and is not saved in the file; a crash in the
  middle of a write can leave the file broken. `WAL` is saved in the file header, adds `-wal` and
  `-shm` files beside it while open, and lets readers run while one writer writes.
  `synchronous=OFF` skips the `fsync` on commit; a closed connection still leaves every commit in
  the file. Django and Rails call the database a test run gets "the test database", the source of
  the module's name.

## The shape

```ts
// next/packages/vitest/src/TestDatabase.ts, a sketch
/**
 * A SQLite file a test opens (decision 0538), as Django and Rails call it "the test database". `make`
 * opens a file the test owns, fast: the journal in memory and no disk sync, since no law cuts the
 * power and a close keeps every commit (ticket 1028). `open` opens a file something else owns and
 * changes nothing in it.
 *
 * @stability unstable
 */
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle, and the stores under test take node:sqlite's
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

/** A file another party owns could not be opened. */
export class TestDatabaseError extends Schema.TaggedError<TestDatabaseError>()("TestDatabaseError", {
  file: Schema.String,
  cause: Schema.Defect,
}) {}

const close = (db: DatabaseSync) =>
  Effect.sync(() => {
    if (db.isOpen) {
      db.close();
    }
  });

/**
 * Opens a file the test owns, in a folder the test made, and closes it with the scope. A file that
 * will not open is a broken test, so it dies.
 *
 * @category constructors
 */
export const make = (file: string): Effect.Effect<DatabaseSync, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const db = new DatabaseSync(file);
      db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");
      return db;
    }),
    close,
  );

/** How a test reaches a file another party owns. */
export interface Options {
  readonly readOnly?: boolean;
  readonly wait?: Duration.Input; // SQLite's busy timeout, for a file another process writes
}

/**
 * Opens a file another party owns (a running instance, the product's span queue), sets no pragma,
 * and closes it with the scope. Such a file may be missing or locked, so that fails typed.
 *
 * @category constructors
 */
export const open = (file: string, options: Options = {}): Effect.Effect<DatabaseSync, TestDatabaseError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        new DatabaseSync(file, {
          readOnly: options.readOnly ?? false,
          timeout: options.wait === undefined ? 0 : Duration.toMillis(options.wait),
        }),
      catch: (cause) => new TestDatabaseError({ file, cause }),
    }),
    close,
  );
```

`Schema.TaggedError` is the form next/ already uses in 156 places and the one `effect/AGENTS.md`
shows.

### What a test writes

```ts
// A store opened once: Watchers.integration.test.ts's `connection`.
const connection = (file: string): Effect.Effect<Sql, never, Scope.Scope> =>
  TestDatabase.make(file).pipe(Effect.map(nodeSql));

// A store with a reopen law: RecoveryJournal, Reload, IsolateUsage and six more today.
const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "p34c2-" }), "store.db");
  const connect = TestDatabase.make(file).pipe(Effect.map((db) => ({ db, sql: nodeSql(db) })));
  const held = yield* ScopedRef.fromAcquire(connect);
  // One Sql across reopens: each call goes to the connection open now.
  const sql: Sql = {
    exec: (query, ...params) => ScopedRef.getUnsafe(held).sql.exec(query, ...params),
    transaction: (step) => ScopedRef.getUnsafe(held).sql.transaction(step),
    size: () => ScopedRef.getUnsafe(held).sql.size(),
  };
  return { sql, reopen: ScopedRef.set(held, connect) } satisfies RecoveryJournalTest.Store;
});

// A file a running instance owns: instance-database.test-support.ts keeps its wait.
export const instanceDatabase = (file: string, options: { readonly readOnly: boolean }) =>
  TestDatabase.open(file, { readOnly: options.readOnly, wait: Duration.seconds(5) }).pipe(Effect.orDie);
```

The "one Sql across reopens" object names libfabrika's `Sql`, which `@kampus/vitest` may not import
(0538's binding constraint), so it stays in each file. A shared libfabrika helper for it is a
possible follow-up, not this ticket.

### The six choices

1. **The shape: a module with `make` and `open`, each a scoped Effect that gives a raw
   `DatabaseSync`.** Options were: (a) a bare function `openTestDatabase(file)`, which loses the
   module home for a second operation and breaks 0029's names; (b) a `Layer` of a service, which
   needs a service class in the package and a tag per file, while the stores here need two to six
   files per test, opened at will; (c) a handle type of ours with `reopen` built in, which repeats
   what `ScopedRef` already does (0421). The raw handle is what `nodeSql`, `db.prepare` and
   `db.isOpen` callers take today. `make` dies on a failed open, since the test made the folder;
   `open` fails typed, since `port-home.test-support.ts` maps that failure to its own `GuardError`
   today and a law reads it. Lean: this shape, 85% sure. The doubt is whether a second operation
   for a held, reopenable store should live here once a libfabrika helper exists.
   `Depth.ts`'s bare `runsFor` stays as it is: about 100 files and two lint messages name it, and
   moving it to `Depth.runsFor` is its own rename ticket, not this one.
2. **Where it lives: its own subpath, `@kampus/vitest/TestDatabase`, not re-exported from the
   root.** In the root barrel, every file that imports `runsFor` would also load `node:sqlite`, and
   the two lint rules that key on a module name could not tell `runsFor` (no IO) from
   `TestDatabase` (real IO): `runs-from-depth` would then hold every in-memory law that imports
   `runsFor` as real IO, a flood of false refusals. A subpath keeps the root free of Node's native
   module, and the rules list the subpath exactly, as they list `@kampus/libfabrika/sqlite` today. I
   checked the brief's worry about a browser: no file a browser page loads imports `@kampus/vitest`
   (the four visual tests that import `runsFor` run in Node and hand the page a bundle of its own).
   So the browser is not what breaks; the lint rules are. This keeps a difference from Effect, whose
   barrel re-exports every module; the reason is the one above. Lean: subpath, 85% sure.
3. **The journal mode: `MEMORY` with `synchronous=OFF`, one fixed value, not a setting.**
   - A reopen: both work. A clean close leaves every commit in the file in both modes.
   - Files on disk: `MEMORY` leaves the folder exactly as the default mode does after a commit (one
     file). `WAL` adds `-wal` and `-shm` while open, keeps deleted content in `-wal` until a
     checkpoint, and writes "WAL" into the file's header. Two laws read the folder:
     `Sink.integration.test.ts`'s `bytes(marker)` reads every file in the folder for a marker, and
     `port-home-guard.integration.test.ts` lists the home folder. Both are in the default mode
     today; `WAL` could turn them red or change what they prove, and `MEMORY` changes neither.
   - A second connection: `WAL` lets a reader run while a writer writes; `MEMORY` uses the default
     mode's locks, so a second connection could get `database is locked`. No test store opens a
     second connection to the same file at the same time; I read every reopen (each closes, then
     opens). The files that do meet another process's writes are the six `open` callers, and
     `open` sets no mode.
   - A crash: `MEMORY` can leave a broken file if the writer dies mid-write. No law here kills a
     process that holds a test store, and the temp folder is removed anyway.
   - Is it a setting (0069)? No. A setting is a value a person picks, and nobody picks a test's
     journal mode; a second value would only let a test drift back to the disk's speed (0052).
   - A law that must keep SQLite's default mode because it proves durability: none exists today.
     The only test that sets durable pragmas on purpose, `next/apps/fabrika/e2e/stored.integration.test.ts`,
     writes the product's own span queue file the product's way (`WAL; synchronous=FULL`). It moves to
     `open`, which sets nothing, and keeps its own `exec` line. A future durability law does the
     same.
   - Lean: `MEMORY`, 80% sure. The doubt is the 11 WAL files that move to `MEMORY`, two of them PR
     1300's timed laws. What settles it: the A5 laws re-timed after the move (Measurement) stay in
     PR 1300's after range, and every moved file is green.
4. **How the old way is refused: a new rule, `fabrika/test-database`, in the oxlint plugins folder.**
   oxlint's own `no-restricted-syntax` is off the table: oxlint has no such rule, and
   `no-restricted-imports` cannot stop the import, since `open` needs a type from `node:sqlite` in
   some files and `":memory:"` callers keep the constructor. The rule fires on `new X(arg)` where
   `X` came from `node:sqlite`'s `DatabaseSync` (named, renamed, or `sqlite.DatabaseSync` through a
   namespace) and `arg` is not the literal `":memory:"`, in next/'s test files (`.test.ts`,
   `.test.tsx`), shared suites (`Test.ts`) and test-support files (`.test-support.ts`). Its message says: "a test opens a SQLite
   file with `TestDatabase.make(file)` from `@kampus/vitest/TestDatabase`, or `TestDatabase.open`
   for a file another party owns (ticket 1029)." Count today: 62 calls in 53 files (the 27 default,
   the 20 pragma'd and the 6 `open` groups). Right as they are: none once `open` exists. The 28
   in-memory files and the template string do not fire by construction. So 0 false alarms in 62,
   which meets the 0% bar to block (AGENTS.md, "Checks"). The same change teaches
   `integration-test-name` that `TestDatabase.make(x)` and `TestDatabase.open(x)` drive "a SQLite
   file", and adds `@kampus/vitest/TestDatabase` to `runs-from-depth`'s IO list.
5. **The move: one pull request, all 53 files.** A half-moved tree would need the rule off or a
   list, and 0524 refuses a list. Order inside the branch: the module and its laws; the rule and the
   two rule edits; the 27 default-mode files, slowest first (`Watchers`, `IsolateUsage`); the 20
   pragma'd files; the 6 `open` callers; the docs rows. What proves a file still asserts the same:
   its diff touches only its imports and its open, close and reopen code. A grep over the diff for a
   changed line holding `expect`, `numRuns`, `runsFor`, `fc.`, `it(`, `it.effect(` or `assert`
   comes back empty (Validation). Every moved file runs green once at the fast depth.
6. **The measurement.** The full run's time table shows only the ten slowest files per leg. Of the
   27 default-mode files, two are in it: `Watchers.integration.test.ts` (645.7 s, leg 1) and
   `IsolateUsage.integration.test.ts` (70.1 s, leg 5). `StartChild.integration.test.ts` (385.5 s)
   already runs `WAL; synchronous=OFF`, so its time is not disk syncs: a hint that the same may hold
   for `Watchers`. Each of the two is run three times before (on `origin/main`) and three times after,
   at `FABRIKA_TEST_DEPTH=full`, under `/usr/bin/time -p`, one at a time. Disk syncs were the cost
   if the after median of system time is at most half the before median and the wall time drops by
   at least 10%. They were not the cost if the wall time moves less than 10% (inside PR 1300's run
   to run spread). Then the plan does nothing more to that file, and the build step's report asks
   the lead to file one ticket for it, with the six timings and the system times. The A5 laws of
   `JobsLedger` and `LedgerStreams` (WAL to MEMORY) are run once each at full depth and compared to
   PR 1300's after numbers (21.2 to 26.5 s and 3.6 to 10.6 s).

## One value traced: `Watchers.integration.test.ts` opens its inbox

1. The law's scope makes a folder with `fs.makeTempDirectory`, as today.
2. `files("inbox")` calls `connection(".../watchers-abc/inbox.sqlite")`, which runs
   `TestDatabase.make(file)`.
3. `make` opens the file, then `PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF`. `PRAGMA
   journal_mode` now answers `memory`, `PRAGMA synchronous` answers `0`.
4. `Effect.map(nodeSql)` hands the law the same `Sql` it had. Each `BEGIN IMMEDIATE ... COMMIT`
   writes the page into the file through the OS cache, with no `-journal` file and no `fsync`.
5. The law's scope closes: `make`'s release sees `db.isOpen`, closes it; the folder's release removes
   the folder. Nothing else changed: same cases, same seeds, same assertions.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D1: `make` gives an open connection whose `journal_mode` reads `memory` and `synchronous` reads `0`, and the scope's close leaves it closed, for any file name in a scoped temp folder | test | fc.stringMatching: file names of letters, digits, dots and dashes, 1 to 40 characters; 5 runs on a pull request, 50 runs at full depth, through `runsFor({ fast: 5, full: 50 })` | (a) drop the pragma line: `delete` and `2` are read, red; (b) drop the release: `isOpen` is true after the scope, red | `next/packages/vitest/src/TestDatabase.integration.test.ts` |
| D2: through `ScopedRef.set(ref, make(file))`, every committed row of a generated batch reads back after any number of reopens, and after each commit the folder holds only the database file | test | fc.array: batches of rows (integer and text), with reopen points drawn by fc.integer; 5 runs on a pull request, 50 runs at full depth | (a) `WAL` in place of `MEMORY`: a `-wal` file is listed, red; (b) the release does not close: the folder check after the scope fails, red | `next/packages/vitest/src/TestDatabase.integration.test.ts` |
| D3: `open` sets no pragma: a file another connection put in WAL is still WAL after an `open` and its close; a `readOnly` open refuses a write; a missing file under `readOnly` fails with `TestDatabaseError` naming the file | test | fc.record: a file name, a readOnly flag, a row to write; 3 runs on a pull request, 30 runs at full depth | (a) `open` runs `make`'s pragma line: the file reads `memory` then `delete` on a fresh connection, red; (b) `Effect.sync` in place of `Effect.try`: a defect in place of the typed error, red | `next/packages/vitest/src/TestDatabase.integration.test.ts` |
| R1: `fabrika/test-database` fires exactly on `new DatabaseSync(arg)` with `arg` not the literal `":memory:"`, under any local name or through a namespace import of `node:sqlite`, in a next/ test file, suite or test-support file, and never in product code, a file outside next/, a `TestDatabase` call or a name not from `node:sqlite` | test, of a lint rule | fc.record: alias, namespace or named import, the argument (`":memory:"`, a literal path, a template, a variable), the file's path kind, 100 runs at seed 119120 | (a) read the named import only: the namespace form stops firing, red; (b) skip the `":memory:"` check: in-memory lines fire, red; (c) read every file: a product path fires, red | `oxlint-plugins/test-database.test.ts` |
| R2: `integration-test-name` fires on `TestDatabase.make(x)` and `TestDatabase.open(x)` with `x` not `":memory:"` in a `*.test.ts` that is not an integration file, through a namespace or named import of `@kampus/vitest/TestDatabase`, and not on `runsFor` from the root | test, of a lint rule | fc.record: import form, call, argument and file name, added to the existing property's draw, 100 runs at seed 119120 | drop the new module from the rule: the new rows stop firing, red | `oxlint-plugins/integration-test-name.test.ts` |
| R3: `runs-from-depth` holds a bare `numRuns` in a law that reaches `TestDatabase` as real IO, and a law that imports only `runsFor` from `@kampus/vitest` stays in memory | test, of a lint rule | fc.record: the existing property's draw, with the new module among its IO sources, 100 runs at seed 119120 | leave the module out of `IO`: the new row passes a bare count, red | `oxlint-plugins/runs-from-depth.test.ts` |
| R4: the moved tree is clean: `pnpm lint` shows no `fabrika/test-database`, `integration-test-name`, `runs-from-depth` or `package-imports` fire in next/, and no disable line names the new rule | lint | lint | revert one moved file's open to `new DatabaseSync(file)`: the rule fires there, red | the 53 moved files and `.oxlintrc.json` |
| M1: every moved file keeps its laws: the diff of each changes no assertion, case count, seed, generator or test title, and each file is green at the fast depth | test | scenario: the existing laws of each moved file, run unchanged | per timed file, the plant its own law already has; for `Sink`, `WAL` in `make` turns its bytes law red, which shows the choice in point 3 matters | the 53 moved files |
| T1: `make` gives `DatabaseSync` with no error channel; `open` gives `TestDatabaseError`; a caller that names `Sql` cannot get it from the package | type | type | give `make` a `TestDatabaseError`: callers with no handler fail the type check | `next/packages/vitest/src/TestDatabase.ts` |

Every plant runs once in the tests step, is recorded in its report and run row, and is undone; none
is committed. No host-only law: nothing needs launchd, Electron or the owner's Mac. D1 to D3 drive a
real file, so their file is `*.integration.test.ts` and runs on the 3-hour schedule (0536); the
tests and build steps run it here by its path.

## Files

| Path | Owner | Product lines expected | Change |
|---|---|---|---|
| `next/packages/vitest/src/TestDatabase.ts` | build | 70 | the module above: `make`, `open`, `Options`, `TestDatabaseError`, doc blocks |
| `next/packages/vitest/package.json` | build | 1 | `"./TestDatabase": "./src/TestDatabase.ts"` in `exports`; the description names it |
| `next/packages/vitest/src/index.ts` | build | 2 | the head comment says the root holds what runs anywhere, and `TestDatabase` is read through its subpath |
| `next/packages/vitest/src/TestDatabase.integration.test.ts` | tests | tests | D1 to D3 |
| `oxlint-plugins/test-database.ts` | tests | 80 | the rule R1 holds, with its head comment and the measured count |
| `oxlint-plugins/test-database.test.ts` | tests | tests | R1 |
| `oxlint-plugins/index.ts` | tests | 2 | registers the rule |
| `oxlint-plugins/integration-test-name.ts` | tests | 20 | `TestDatabase.make` and `open` drive "a SQLite file" |
| `oxlint-plugins/integration-test-name.test.ts` | tests | tests | R2 |
| `oxlint-plugins/runs-from-depth.ts` | tests | 1 | `@kampus/vitest/TestDatabase` in `IO` |
| `oxlint-plugins/runs-from-depth.test.ts` | tests | tests | R3 |
| `oxlint-plugins/README.md` | tests | docs | a "Test database" section: what it refuses, the 62 of 62 count, the disable form |
| `.oxlintrc.json` | tests | 12 | `fabrika/test-database` on next/'s test files; `@kampus/vitest/TestDatabase` in the "library suites" and "program suites" `may` lists |
| `next/AGENTS.md` | build | docs | one row in "What lint holds": a test opens SQLite through `TestDatabase`, `fabrika/test-database` |
| `next/packages/libfabrika/src/node/Watchers.integration.test.ts`, `next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts`, `next/packages/libfabrika/src/node/Reload.integration.test.ts`, `next/packages/libfabrika/src/node/Nemesis.laws.integration.test.ts`, `next/packages/libfabrika/src/node/RecoveryJournal.integration.test.ts`, `next/packages/libfabrika/src/node/repositories/RepositoryTrust.integration.test.ts`, `next/packages/libfabrika/src/node/gateway/RateLimit.integration.test.ts`, `next/packages/libfabrika/src/node/CodeStore.integration.test.ts`, `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts`, `next/packages/libfabrika/src/node/RecordPart.test-support.ts`, `next/packages/libfabrika/src/node/access/SessionManager.integration.test.ts`, `next/packages/libfabrika/src/node/access/SessionSender.integration.test.ts` | tests | tests | default mode to `make`; reopen handles to `ScopedRef` |
| `next/packages/libfabrika/src/telemetry/Records.integration.test.ts`, `next/packages/libfabrika/src/telemetry/Sink.integration.test.ts`, `next/packages/libfabrika/src/telemetry/internal/measurements.integration.test.ts`, `next/packages/libfabrika/src/access/ClientManager.integration.test.ts`, `next/packages/libfabrika/src/access/AccessSpans.integration.test.ts`, `next/packages/libfabrika/src/access/Authorization.integration.test.ts`, `next/packages/libfabrika/src/ledger/Rings.integration.test.ts`, `next/packages/libfabrika/src/ledger/LedgerSpans.integration.test.ts`, `next/packages/libfabrika/src/ledger/Log.integration.test.ts`, `next/packages/libfabrika/src/ledger/Ledger.integration.test.ts`, `next/packages/libfabrika/src/runtime/ProcessStore.integration.test.ts` | tests | tests | default mode to `make` |
| `next/apps/fabrika/src/inbox-runner.laws.integration.test.ts`, `next/apps/fabrika/src/checklist-runner.laws.integration.test.ts`, `next/apps/fabrika/src/port-home-guard.integration.test.ts`, `next/programs/counter/src/runner.laws.integration.test.ts` | tests | tests | default mode to `make` |
| `next/packages/libfabrika/src/node/jobs/JobsLedger.integration.test.ts`, `next/packages/libfabrika/src/node/ledger/LedgerStreams.integration.test.ts`, `next/packages/libfabrika/src/node/gateway/Jobs.integration.test.ts`, `next/packages/libfabrika/src/node/StartChild.integration.test.ts`, `next/packages/libfabrika/src/node/Children.integration.test.ts`, `next/packages/libfabrika/src/node/ChildrenMember.integration.test.ts`, `next/packages/libfabrika/src/node/Relations.integration.test.ts`, `next/packages/libfabrika/src/node/ProgramMail.test-support.ts`, `next/packages/libfabrika/src/runtime/Runner.integration.test.ts`, `next/programs/pipeline/src/node/runner.laws.integration.test.ts`, `next/programs/pipeline/src/node/queue.laws.integration.test.ts` | tests | tests | WAL by hand to `make` (MEMORY); comments that cite WAL or dev-recording's mode are rewritten |
| `next/apps/fabrika/src/door.integration.test.ts`, `next/apps/fabrika/src/door-recovery.integration.test.ts`, `next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts`, `next/packages/libfabrika/src/node/Chaos.test-support.ts`, `next/packages/libfabrika/src/node/ExitReason.integration.test.ts`, `next/packages/libfabrika/src/node/RecoveryStoreReads.integration.test.ts`, `next/packages/libfabrika/src/node/Replies.integration.test.ts`, `next/packages/libfabrika/src/node/runtime/RunnerInit.integration.test.ts`, `next/packages/libfabrika/src/processes/Process.test-support.ts` | tests | tests | MEMORY by hand to `make` |
| `next/apps/fabrika/src/instance-database.test-support.ts`, `next/apps/fabrika/src/port-home.test-support.ts`, `next/apps/fabrika/src/port-home.laws.integration.test.ts`, `next/apps/fabrika/e2e/reload.test-support.ts`, `next/apps/fabrika/e2e/stored.integration.test.ts`, `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | tests | tests | a file another party owns to `open`; `port-home.test-support.ts` maps `TestDatabaseError` to its `GuardError`; `stored` keeps its own pragma line |
| `next/apps/fabrika/src/instance-database.integration.test.ts` | tests | none | not changed: its `new DatabaseSync` is inside the child process's script text |
| `next/packages/libfabrika/src/node/dev/dev-recording.ts` | build | none | not changed: product code, the span queue keeps `WAL; synchronous=FULL` |

The 28 in-memory files are not changed and are not listed.

## Validation

- The tests step: `pnpm format`; `nice -n 15 pnpm exec vitest run --maxWorkers=3` on the three
  `oxlint-plugins` test files above; each plant once, recorded. D1 to D3 are red until the build
  writes the module.
- The build step: `pnpm format`; the vitest package's law file by path; each of the 53 moved files
  once at the fast depth, by path, under `nice -n 15` and `--maxWorkers=3`, in a few batches; then
  `pnpm lint` on the whole tree (R4). The no-law-change check (M1):
  `git diff -U0 origin/main -- <the 53 files> | rg '^[-+](?![-+]).*(expect|numRuns|runsFor|fc\.|\bit\(|it\.effect|assert)'`
  prints nothing, with `--pcre2`.
- The measurement in point 6, by the build step, before review: three runs each of
  `Watchers.integration.test.ts` and `IsolateUsage.integration.test.ts` on `origin/main` and on the
  branch at `FABRIKA_TEST_DEPTH=full`, one at a time under `nice -n 15` and `--maxWorkers=1`, and the
  two A5 laws once each on the branch. A table of wall, user and system seconds goes in the report
  and the pull request body.
- The lead: one `pnpm typecheck`, CI, and the leak grep.

## Size

One pull request that lands whole.

1. The module, the rule and the move: about 70 product lines in `TestDatabase.ts`, about 100 lines
   of lint rule code and config, about 330 lines of new law code, and about 500 changed test lines
   across the 53 moved files (most files lose 3 to 6 lines and gain 2 to 4; the 9 reopen handles
   shrink to `ScopedRef`), plus about 40 lines of prose.

Priced from ticket 971's lane, a lint rule with its laws (tests about $8, build about $2, review
about $3, one fix about $3), and ticket 955's step rows (110k to 140k tokens a step). This one has a
much larger tests step (the rule plus 53 file moves) and a build step with about an hour of timing
runs, which cost wall time, not tokens. Expected: tests about $12, build about $4, review about $5,
one fix round about $3. Confidence 70%: the doubt is the move's size in one tests step.

Estimate: 4 steps, $24

## Records

- What fact is lost if not written now: the before timings of `Watchers` and `IsolateUsage` on main,
  and which journal mode each moved file had before. The first is gone once main moves (the build
  step writes it into the pull request body); the second is in this plan's groups table and the PR
  body.
- The plant runs and the measurement table: the steps' run rows in `field/runs/`, written by the
  lead.
- No `.decisions/` file: 0538 decides where test primitives live, and this plan makes no new call
  the owner must rule. The fixed journal mode is recorded in `TestDatabase.ts`'s doc block and in
  `oxlint-plugins/README.md`.
- No glossary row: "test database" is the industry's word and is not a domain word of next/.

## What this cannot tell us

- Whether the other 25 default-mode files were slow because of disk syncs: they were below the ten
  slowest of their legs, so the full run's tables do not show them. The next scheduled run after
  merge is the only after number for them, and there is no before.
- How much faster CI gets. Runners sync the disk more slowly than a laptop (PR 1300's ratio of 3 to
  4 on one law), so a local gain is a lower bound, not proven until scheduled runs.
- Whether `MEMORY` is right for a future law that opens a second connection to a test store while
  another writes: none does today. That law would meet `database is locked` and would need a reason
  to use `open` with a wait, which the rule allows.
- SQLite's journal facts above are from memory, not fetched; D1 to D3 test the ones the plan leans
  on.
- The rule reads syntax. A `DatabaseSync` reached through a helper of another module, or a
  `Reflect.construct`, slips past it.

## Answered questions

1. Is the journal mode a setting? No, by 0069's own test: nobody picks it, and a second value only
   lets a test lean on the disk again (0052). The lead's call, not the owner's.
2. Should the 11 WAL files keep WAL? No: one value is the point of the ticket, and nothing in them
   needs WAL (each reopen closes first). The A5 re-timing checks the cost.
3. Does `@effect/sql-sqlite-node` fit (0040)? No: not installed, and it is an async client, not the
   synchronous handle the stores take.

## Open questions

None.

Searched first: `settled.sh` with three wordings, and `rg` over `.decisions/`, `.glossary/`,
`docs/direction/`, `docs/plan/`, `experiments/` and `field/findings/` for the journal mode, the
disk sync, test stores and a temp folder helper. 0538 already places the primitive; the rest is
the code's to decide.

## Findings

None.


Plancheck-Version: 3

# Plan: a shared suite runs on SQLite in memory on every pull request and on a SQLite file on the schedule, through one `lawsOn` call

This is `next/` and the test tooling. Today's app is not touched. It is ticket 1070, an owner ruling
of 2026-11-15 and the first item of the test-toolbox order in the sev0 of that day. It builds
[0538](../../../.decisions/0538-kampus-vitest-holds-the-test-primitives.md) ("a runner that applies
the same laws to a memory layer and a real layer, the real one only on the schedule"), inside
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) (a shared suite
runs twice: memory on the merge line, the real driver on the schedule),
[0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md) (the tool lives in our test
package), [0579](../../../.decisions/0579-property-laws-use-it-prop.md) ("`lawsOn` and `depth` cover"
`skipIf` and `runIf`) and [0580](../../../.decisions/0580-law-options-carry-plant-and-label.md)
(how a law states its plant). It builds on the test database of
[pull request 1301](https://github.com/kamp-us/tea-fabrika/pull/1301) (ticket 1029) and waits for it
to merge (see "What waits").

```ts
// The whole idea, in one real file of ours: next/packages/libfabrika/src/node/Watchers.contract.test.ts.
// Today it is Watchers.integration.test.ts, which runs both suites on SQLite files only, on the schedule.
const on = lawsOn(TestDatabase.memory, TestDatabase.folder);

on("watcher laws", (databases) => WatchersTest.suite(Effect.map(databases, (open) => sql(open)("watchers"))));
on("runner watcher laws", (databases) => RunnerWatchersTest.suite({ files: Effect.map(databases, sql), services }));

// The `next` project (pull requests, the merge queue, the schedule):   "watcher laws on memory"
// The `next-integration` project (the 3-hour schedule only):          "watcher laws on real"
```

The package is `@kampus/vitest` on main today. 0557 renames it `@kalfa/vitest`; this plan writes
the name main has when each slice is built, and the rename changes one import line per file.

## Doubts, read these first

The lead approves this plan; each lean is taken with its confidence. Three are at or under 80%.

- **What the memory side costs a pull request (60%).** The only measured pairs are the two
  suites that already run on both: at full depth `RunnerHands.test.ts` (memory) takes 57.2 s
  against 86.7 s for its file twin, and `LedgerTurnReads.test.ts` 5.0 s against 6.3 s
  (`vitest.shards.full.json`). So memory is about 66% to 80% of the file run, not a few seconds.
  At the pull request's depth the 23 moved files that have a row in `vitest.shards.json` take
  1,740.6 s on files today, so the memory side could add about 1,100 to 1,400 file-seconds when a
  change reaches all of them, and much less for most changes, which reach few. Pull request 1301
  also made the file runs faster, which narrows the gap. What settles it: slice 1's four files, read
  from the `next` job's `shard-times` step. If the numbers threaten the merge line's time goal
  ([0541](../../../.decisions/0541-ci-speed-goals.md)), that is a new call for the owner, and it is
  not decided here.
- **A reopen on memory keeps the connection (80%).** On the memory side every open of one name in a
  law's scope gets the same `:memory:` connection, so a reopen builds the whole host again over the
  same data, as a restarted brain would. That is what `RunnerHands.test.ts` already does (ticket
  1040, its header comment). A law that inspects the file or the connection itself (bytes on disk,
  a closed handle, a second connection's lock) is real-only. How many such laws each suite has is
  not known until its memory side runs; each one moves to `on.real` with its reason.
- **One file in two Vitest projects (85%).** Vitest runs a file once per project that includes it,
  and each project can `provide` its own values to `inject` (both are in the installed 5.0.5's
  types: `provide?: Partial<ProvidedContext>` and `inject(key)`). Law L5 holds the config and law L4
  proves at run time that each project hands the side its name says.

## What changes, in one paragraph

A new function, `lawsOn(memory, real)`, in our test package, takes the two things a shared suite can
run on and returns a runner. The runner hands the suite the memory one when the Vitest project
provides `layer: "memory"`, and the real one when it provides `layer: "real"`. A file that uses it is
named `*.contract.test.ts`, and both `next` and `next-integration` include such files: `next` runs
the memory side on every pull request, and `next-integration` runs the real side on the schedule.
For our SQLite stores, the memory side is SQLite on `:memory:` and the real side is a SQLite file in
a temp folder, both from `TestDatabase`. The 34 integration files that do nothing but run shared
suites become contract files: 32 move, and the two that already have a hand-written memory twin
fold into one file each. A lint rule holds the shape: `lawsOn` only in a contract file, a contract
file's laws only through `lawsOn`, and, once the tree is at zero, no integration file that only runs
shared suites.

## How others do it

- **Effect runs one shared suite on SQLite in memory always, and on real servers only when asked.**
  In `Effect-TS/effect` (the repo the installed `effect` package names as its own), the suite
  `SqlEventLogServerUnencryptedStorageTest.suite(name, layer)` is called by
  `packages/sql/sqlite-node/test/SqlEventLogServerUnencrypted.test.ts` with
  `SqliteClient.layer({ filename: ":memory:" })`, and by
  `packages/sql/pg/test/SqlEventLogServerUnencrypted.integration.test.ts` and the `mysql2` twin with
  a container's client. Its root `vitest.config.ts` excludes `**/*.integration.test.{ts,tsx}` unless
  `EFFECT_INTEGRATION_TESTS=1`. Fetched with `gh api` on 2026-11-15. Effect's file name picks where
  a run goes, and the suite is written once. That is our 0536 and 0062 already; what Effect lacks is
  one call that holds both sides, so a suite can run on only one of them by accident.
- **Fowler's contract test.** A test against a test double is checked by "contract tests", which
  run the same calls against the double and the real service, less often, to catch the double
  drifting from the real thing ([Martin Fowler, "ContractTest", 2011](https://martinfowler.com/bliki/ContractTest.html),
  not fetched today, read from memory). Our memory layer is the double, the real driver is the
  service, and the schedule's run is the check. J. B. Rainsberger's "contract tests" are the same
  idea for every implementation of an interface. The name `*.contract.test.ts` follows them. The
  word also names Pact's consumer-driven contracts between services, which this is not; the
  glossary row says so.
- **In-memory SQLite as the fast database** is the common default: Django's test runner uses an
  in-memory database when the engine is SQLite, and Rails apps commonly point the test database at
  `:memory:` (both from memory, not fetched). Ours already does it in about 36 test files.
- **Vitest's own way to run one file in two setups** is projects that include the same file, each
  with its own settings, and `provide` plus `inject` to pass a value from a project's config into the
  test ([Vitest, projects](https://vitest.dev/guide/projects), [`provide`](https://vitest.dev/config/provide),
  not fetched today; the installed types were read).
- **Elm and OTP** have no answer here: this is test tooling, not a machine. The shape follows
  `@effect/vitest`'s `layer(L)(name, (it) => ...)`: a value first, then a name and a suite.

## Searched first

- `records.ts find` for "lawsOn", "shared suite", "contract test", "in-memory SQLite" and "memory
  layer real layer". Read: 0062, 0535, 0536, 0538, 0557, 0579, 0580, and
  [experiment 292](../../../experiments/292-real-resource-tests.md), whose mechanism section picked
  the three projects by file name and sketched two runner files per suite
  (`Watchers.test.ts` and `Watchers.integration.test.ts`). This plan keeps its projects and puts
  both runs in one file, so the pair cannot come apart.
- The code as built at `f930e00e4`: `vitest.config.ts` (the projects, `shared`, `testConfig` for
  Stryker), `next/packages/vitest/src/Depth.ts`,
  the git laws' kit in `node/repositories/` (real git only at depth `full`, inside the `next`
  project), `oxlint-plugins/integration-test-name.ts`,
  `node/runtime/RunnerHands.test.ts` and `ledger/LedgerTurnReads.test.ts` (the two memory twins),
  and the branch of pull request 1301 (`TestDatabase.make`, `TestDatabase.open`, and the kits moved
  to `ScopedRef`).
- Versions in the lockfile and the catalog: `vitest` 5.0.5, `@effect/vitest` 4.1.3, `effect`
  4.1.3 (patched), `fast-check` 4.10.2, `typescript` 7.0.2 (so `NoInfer` is there). Effect 4.1.3's
  `FileSystem` ships `layerNoop` and `makeNoop` only: no in-memory file system.

## The count: which files move

Counted on main at `f930e00e4`: every integration test under `next/` that calls a shared suite
(`<Module>.<name>suite(`, any case) and has no `it`, `test` or `describe` line of its own. That gives
34 files. Two already have a memory twin. Seconds are each file's row in `vitest.shards.full.json`
(full depth, the real file, medians of three green scheduled runs) and in `vitest.shards.json` (the
older rows, from runs at the pull request's depth); a dash is no row. The full-depth rows of the 32
that move sum to 2,406.6 s over 30 files.

Every one of the 34 stores its state through our `Sql` type in SQLite, and none of them, nor its
suite or kit, drives any other real resource: a static read of each file and the modules it imports
found a temp folder used only to hold the database files, and no spawn, socket, bundler or instance.
So **every memory side already exists**: it is `nodeSql` over SQLite on `:memory:`, the same stand-in
36 test files use today, which 0536 counts as in-memory ("anything outside the process's memory" is
real) and which the lint rule `fabrika/integration-test-name` already lets through. **No product
change in a service's folder is needed for these 34.** "Reopen" below means the suite or kit names a
reopen, so some of its laws are likely to be real-only, decided law by law.

| Today's file (under `next/packages/libfabrika/src/` unless it starts with `next/`) | Suite | Reopen | Full s | Fast s | Slice |
|---|---|---|---|---|---|
| `node/Watchers.integration.test.ts` | `WatchersTest`, `RunnerWatchersTest` | no | 444.3 | 217.6 | 1 |
| `node/StartChild.integration.test.ts` | `StartChildTest.suite` | yes | 336.8 | 262.9 | 1 |
| `node/StartChildBoundary.integration.test.ts` | `StartChildTest.boundarySuite` | yes | 307.9 | 215 | 1 |
| `node/StartChildExit.integration.test.ts` | `StartChildTest.exitSuite` | yes | 121.9 | 95 | 1 |
| `node/ProgramMailRuntime.integration.test.ts` | `runtime/ProgramMailTest` | yes | 203.9 | 169.1 | 2 |
| `node/Reload.integration.test.ts` | `ReloadTest` | yes | 159.8 | - | 2 |
| `node/Children.integration.test.ts` | `ChildrenTest` | yes | 88.4 | 84.4 | 2 |
| `node/RecoveryJournal.integration.test.ts` | `RecoveryJournalTest` | yes | 53.3 | 52.6 | 2 |
| `node/Replies.integration.test.ts` | `RepliesTest`, `RunnerRepliesTest` | yes | 43.7 | 70.8 | 2 |
| `node/ExitReason.integration.test.ts` | `ExitReasonTest` | yes | 38.8 | 37.4 | 2 |
| `node/RecoveryStoreReads.integration.test.ts` | `RecoveryStoreReadsTest` | no | 28 | - | 2 |
| `node/ProgramMail.integration.test.ts` | `processes/ProgramMailTest` | yes | 27.6 | 34 | 2 |
| `node/ProgramMailReads.integration.test.ts` | `ProgramMailReadsTest` | yes (kit) | 10.5 | - | 2 |
| `node/ChildrenMember.integration.test.ts` | `ChildrenMemberTest` | no | 5.1 | - | 2 |
| `node/RecordPart.integration.test.ts` | `RecordPartTest` | yes | 1.2 | 1.1 | 2 |
| `node/Relations.integration.test.ts` | `RelationsTest` | no | 0.8 | - | 2 |
| `node/CodeStore.integration.test.ts` | `CodeStoreTest` | yes | 0.7 | - | 2 |
| `node/Monitor.integration.test.ts` | `MonitorTest` | yes | - | - | 2 |
| `node/Monitors.integration.test.ts` | `MonitorsTest` | no | - | - | 2 |
| `node/gateway/Tasks.integration.test.ts` | `gateway/TasksTest` | yes | 320.7 | 147.5 | 3 |
| `node/tasks/TasksLedger.integration.test.ts` | `tasks/TasksTest.suite` | yes | 49.4 | 39.2 | 3 |
| `node/tasks/TasksDiscovery.integration.test.ts` | `tasks/TasksTest.discoverySuite` | yes | 42.2 | 30.8 | 3 |
| `node/repositories/RepositoryTrust.integration.test.ts` | `RepositoryTrustTest` | yes | 19.4 | 15.4 | 3 |
| `node/ledger/LedgerStreams.integration.test.ts` | `LedgerStreamsTest` | yes | 9.7 | 73.3 | 3 |
| `node/access/SessionManager.integration.test.ts` | `SessionManagerTest` | yes | 9.6 | 9.6 | 3 |
| `node/gateway/RateLimit.integration.test.ts` | `RateLimitTest` | yes | 4.4 | 5.8 | 3 |
| `node/runtime/RunnerInit.integration.test.ts` | `RunnerInitTest` | yes | 3.5 | 3.6 | 3 |
| `node/access/SessionSender.integration.test.ts` | `SessionSenderTest` | no | 0.8 | - | 3 |
| `node/runtime/RunnerHands.integration.test.ts` and `RunnerHands.test.ts` | `RunnerHandsTest`, `HandsTasksTest` | yes | 86.7 and 57.2 | - | 3, fold the twin |
| `ledger/LedgerTurnReads.integration.test.ts` and `LedgerTurnReads.test.ts` | `LedgerTurnEndTest` | no | 6.3 and 5.0 | - and 1.6 | 3, fold the twin |
| `next/apps/fabrika/src/checklist-runner.laws.integration.test.ts` | the checklist program's `RunnerTest` | yes | 20.8 | 20.7 | 4 |
| `next/apps/fabrika/src/inbox-runner.laws.integration.test.ts` | `@kampus/inbox/RunnerTest` | no | 2.6 | 7.3 | 4 |
| `next/programs/pipeline/src/node/queue.laws.integration.test.ts` | `QueueRunnerTest` | yes | 43.2 | 125.7 | 4 |
| `next/programs/pipeline/src/node/runner.laws.integration.test.ts` | the pipeline's `RunnerTest` | yes | 7.6 | 21.8 | 4 |

How the count was made: `git ls-files` of every integration test under `next/`, a file kept when it matches
`\.[a-zA-Z]*[sS]uite\(` and has no line matching `^\s*(it|test|describe)(\.[a-z]+)*\(`. "Reopen" is
a case-free match of `\breopen` in the suite module or the kit the file imports. `Monitor` and
`Monitors` are new since pull request 1341 and have no rows yet.

## The shape

### `lawsOn`, in the test package

```ts
// next/packages/vitest/src/Laws.ts, a sketch (not compiled).
import { describe, inject } from "@effect/vitest";
import * as Schema from "effect/Schema";

/** Which layer a Vitest project runs a contract file on: set once per project in vitest.config.ts. */
export const LayerName = Schema.Literals(["memory", "real"]);
export type LayerName = typeof LayerName.Type;

declare module "vitest" {
  interface ProvidedContext {
    readonly layer: LayerName;
  }
}

/** Why a law runs on the real side only. Required, so the reason is written where the law is. */
export interface RealOnly {
  readonly reason: string;
}

/** A shared suite's runner over one memory value and one real value of the same type. */
export interface Laws<A> {
  (name: string, suite: (on: A) => void): void;
  readonly real: (name: string, suite: (on: A) => void, why: RealOnly) => void;
}

/** The runner for one layer. Pure but for `describe`, so its laws need no project. */
export const lawsAt =
  (layer: LayerName) =>
  <A>(memory: A, real: NoInfer<A>): Laws<A> =>
    Object.assign((name: string, suite: (on: A) => void) => describe(`${name} on ${layer}`, () => suite(layer === "memory" ? memory : real)), {
      real: (name: string, suite: (on: A) => void, _why: RealOnly) =>
        layer === "real" ? describe(`${name} on real`, () => suite(real)) : undefined,
    });

/** The runner for this run's project: `next` hands the suite `memory`, `next-integration` hands it `real`. */
export const lawsOn = <A>(memory: A, real: NoInfer<A>): Laws<A> =>
  lawsAt(Schema.decodeUnknownSync(LayerName)(inject("layer")))(memory, real);
```

- **Two arguments, one type.** `real` is `NoInfer<A>`, so `A` comes from `memory` and a real value
  of another type is a compile error. A call with one argument does not compile: a suite cannot be
  wired to one side through `lawsOn`. Positional, as 0538's sketch and the ticket write it.
- **Lazy by construction.** Both sides are values (an Effect or a Layer). The side not handed to the
  suite is never run, so the `next` project never opens a file: `TestDatabase.folder` is an Effect
  that does nothing until a law runs it.
- **The suite is any function.** A suite module's `suite`, or laws written inline in the callback:
  `on("store laws", (databases) => { it.effect(...) })`. A file whose laws are not yet a suite
  module can still move.
- **`on.real` is the real-only form,** for a law that only a file can prove. It takes the same real
  value, so a real-only law cannot be wired to a different store, and its reason is required. In the
  `next` project it registers nothing. This is what 0579 means by "`lawsOn` covers `skipIf` and
  `runIf`": the choice is made by the project, never by a condition in a law.
- **The title says the side:** `watcher laws on memory`, `watcher laws on real`. The schedule's
  uploaded Vitest reports then record which layer each law passed on.
- **Depth is a separate thing.** `lawsOn` never reads `FABRIKA_TEST_DEPTH` (0538: one reader, in
  `Depth.ts`). Depth sets how many cases a generated law runs (0535); the project sets which layer.
  A pull request runs the memory side at `fast`; the schedule runs the memory side and the real side
  at `full`.

### The two `TestDatabase` openers

```ts
// Added to next/packages/vitest/src/TestDatabase.ts, which pull request 1301 adds. A sketch.

/** Opens the named databases of one law. */
export type Databases = (name: string) => Effect.Effect<DatabaseSync, never, Scope.Scope>;

/**
 * Each name is one `:memory:` connection, opened on its first open and closed when the scope this
 * runs in closes. Every later open of the name, a reopen included, gets the same connection.
 */
export const memory: Effect.Effect<Databases, never, Scope.Scope>;

/**
 * A temp folder for the scope, removed when it closes. Each open of a name is a new connection to
 * `<name>.sqlite` in it, through `make`, so a reopen reads what the file kept.
 */
export const folder: Effect.Effect<Databases, never, Scope.Scope>;
```

`folder` is what `Watchers.integration.test.ts` writes by hand today as `files`, and about a dozen
kits write a copy of; the package gains `@effect/platform-node` for its temp folder (pull request
1301 adds it as a dev dependency; it becomes a dependency). `memory` is what `RunnerHands.test.ts`
writes by hand. Both stay out of our services, so 0538's "the package imports no service of ours"
holds: they hand back `DatabaseSync`, and a file wraps it in `nodeSql`.

### The projects

```ts
// vitest.config.ts, the changed lines only. A sketch.
const CONTRACT = ["next/**/*.contract.test.{ts,tsx}"];

const shared = { /* as today */ provide: { layer: "memory" } }; // every project and Stryker's testConfig

// `next` needs no change: NEXT already matches `*.contract.test.ts` and excludes only INTEGRATION and VISUAL.
{ extends: true, test: { name: "next-integration", include: [...INTEGRATION, ...CONTRACT], exclude: [...EXCLUDE], provide: { layer: "real" } } },
```

- `next` runs every contract file on memory; `next-integration` runs it again on real. The
  schedule already runs `--project next --project next-integration` (`scheduled.yaml`), and the
  merge line already runs `--project next` alone (`check.yaml`), so no workflow command changes.
- The memory default sits in `shared`, so `testConfig` (Stryker's single config, no projects) runs a
  contract file on memory and never opens a file. `next-visual` sets `extends: false` and includes no
  contract file.
- **Is this a setting? No** ([0069](../../../.decisions/0069-choices-are-settings.md)). Which layer a
  project runs is fixed by 0536 for each project; no person running fabrika picks it, and no
  `fabrika.toml` holds test config.

### A suite with a reopen, and its kit

```ts
// next/packages/libfabrika/src/node/StartChild.test-support.ts after slice 1, the changed lines. A sketch.
// Before (pull request 1301): the kit makes its own temp folder and calls TestDatabase.make per part.
// After: it takes the opener, so the same kit runs on either side.
export const databases = (open: TestDatabase.Databases) =>
  Effect.gen(function* () {
    const connect = (part: string) => open(part).pipe(Effect.map((db) => ({ db, sql: nodeSql(db) })));
    // ...the rest as pull request 1301 left it: ScopedRef per part, `reopen` is ScopedRef.set.
  });

// next/packages/libfabrika/src/node/StartChild.contract.test.ts: the three files become one.
const on = lawsOn(TestDatabase.memory, TestDatabase.folder);
const store = (databases: Effect.Effect<TestDatabase.Databases, never, Scope.Scope>) =>
  Effect.flatMap(databases, StartChildTestSupport.databases);

on("start child laws", (databases) => StartChildTest.suite(store(databases)));
on("start child exit laws", (databases) => StartChildTest.exitSuite(store(databases)));
on("start child boundary laws", (databases) => StartChildTest.boundarySuite(store(databases)));
```

On memory, `reopen` calls `ScopedRef.set(ref, open(part))`: the new open is the same connection and
the old one's release does nothing, so the law rebuilds its runner over the same data. Whether the
three stay three files (so CI can place them on different machines, as their header says) is the
tests step's call from the slice's shard times: three files are `StartChild.contract.test.ts`,
`StartChildExit.contract.test.ts` and `StartChildBoundary.contract.test.ts`, each with one `on` call.
The lean is three files, as today (85%): the split was made for the legs, and nothing here changes
that.

### What runs where, after

| A law in a contract file | Pull request and merge queue | The 3-hour schedule |
|---|---|---|
| `on(name, suite)` | memory side, `fast` cases | memory side and real side, `full` cases |
| `on.real(name, suite, { reason })` | nothing | real side, `full` cases |
| a law outside `lawsOn` | refused by lint | refused by lint |

## One value traced: `Watchers.contract.test.ts` on a pull request, then on the schedule

1. A pull request changes `runtime/WatchersSql.ts`. `legs.ts` runs `vitest list --project next
   --changed`, and Vitest's import graph reaches `node/Watchers.contract.test.ts`. Today it reaches
   `Watchers.integration.test.ts`, which `next` excludes, so no Watchers law runs before the merge.
2. A `next` leg runs the file. `inject("layer")` is `"memory"` (from `shared`). `lawsOn` decodes it
   and returns `lawsAt("memory")(TestDatabase.memory, TestDatabase.folder)`.
3. `on("watcher laws", ...)` registers `describe("watcher laws on memory", ...)` and hands the suite
   `Effect.map(TestDatabase.memory, (open) => sql(open)("watchers"))`. `TestDatabase.folder` is
   never run, so no temp folder is made.
4. A law W3 runs in `it.effect`: its scope opens `TestDatabase.memory`, `open("watchers")` makes one
   `:memory:` connection, and every later open in the law returns it. The law's scope closes the
   connection. The law runs `runsFor({ fast, full })` cases, so `fast` here.
5. Three hours later the schedule runs `--project next --project next-integration`. The file runs
   twice. The `next` run is step 2 again, at `full`. The `next-integration` run reads `"real"`, so
   the same suite gets `TestDatabase.folder`: a temp folder, `<folder>/watchers.sqlite` opened through
   `TestDatabase.make`, a new connection per open, the folder removed at the scope's close.
6. The leg's Vitest JSON report, uploaded by the schedule, holds `watcher laws on memory` and
   `watcher laws on real` with the project name of each, so a red real side with a green memory side
   reads as "the memory stand-in and the file disagree".

## Laws

Every new law states its plant the way the tests skill says when the slice is built: as a `plant`
option if 0580's build has landed by then, else as today's comment. Each plant is run once and not
kept (0093).

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1. `lawsAt(layer)(memory, real)(name, suite)` calls `suite` exactly once, with `memory` when `layer` is `"memory"` and `real` when it is `"real"`, inside one `describe` titled `<name> on <layer>`. 100 runs | test | Effect Arbitrary: Pick | hand `memory` to the suite on both layers: L1 red on `"real"` | next/packages/vitest/src/Laws.test.ts |
| L2. `on.real(name, suite, why)` calls `suite` once with `real` when `layer` is `"real"`, and registers nothing when it is `"memory"`. 100 runs | test | Effect Arbitrary: Pick | register the real-only suite on both layers: L2 red on `"memory"` | next/packages/vitest/src/Laws.test.ts |
| L3. `lawsOn` with one argument, with a `real` of another type than `memory`, and `on.real` with no reason, are each a compile error; the suite's parameter is the memory value's type | type | type | make `real` an `A` in place of `NoInfer<A>`: L3 red on the mixed-type line | next/packages/vitest/src/Laws.types.test.ts |
| L4. A contract file's suite gets the side its Vitest project names: in project `next` the memory value, in project `next-integration` the real value, read against the running test's own `task.file.projectName` | test | scenario: the one config this law is about, run once in each project | provide `layer: "real"` in `shared` and none in `next-integration`: L4 red in project `next` | next/packages/vitest/src/TestDatabase.contract.test.ts |
| L5. In the exported `projects`, `next` includes `*.contract.test.*` and does not exclude it, `next-integration` includes it and provides `layer: "real"`, `shared` provides `layer: "memory"`, and no other project provides `"real"` | test | scenario: vitest.config.ts's projects as written, the file this law is about | drop `CONTRACT` from `next-integration`'s `include`: L5 red | vitest.shards.test.ts |
| L6. `TestDatabase.memory`: within one scope, every open of a name sees each row written through any earlier open of that name, two names share no row, and when the scope closes every connection it opened is closed. 100 runs | test | Effect Arbitrary: Opens | open a new `:memory:` connection on every call: L6 red on the second open of a name | next/packages/vitest/src/TestDatabase.contract.test.ts |
| L7. The same written rows read back through both openers: for a generated sequence of writes, closes and reopens of named databases, what the law reads after each reopen is the same on memory and on real | test | Effect Arbitrary: Opens | make `folder` open each name in its own new temp folder: L7 red on real after a reopen | next/packages/vitest/src/TestDatabase.contract.test.ts |
| L8. `TestDatabase.folder` (real only): each open is a new connection to `<name>.sqlite` in one temp folder, and the folder is gone once the scope closes | test | scenario: one law, two names, one reopen; the file system is the subject | leave the folder in place: L8 red | next/packages/vitest/src/TestDatabase.contract.test.ts |
| L9. `lawsOn` called in a `next/` file not named `*.contract.test.ts`, under any local name of the import, is refused, and a contract file is let through | lint | lint | switch the rule off: the wiring scenario red; a fixture `Foo.test.ts` calling `lawsOn`: fires | oxlint-plugins/contract-test.test.ts |
| L10. In a `*.contract.test.ts`, a top-level `it`, `test`, `describe` or `layer` call, or a call of a shared suite outside a `lawsOn` runner's callback, is refused, and a file with no `lawsOn` call is refused | lint | lint | a fixture with a bare `WatchersTest.suite(x)` line under the runner: fires | oxlint-plugins/contract-test.test.ts |
| L11. `fabrika/integration-test-name` does not fire on a `*.contract.test.ts` that builds a real side | lint | lint | take `contract` out of the rule's `NAMED` name test: a contract fixture that names `TestDatabase.folder` fires | oxlint-plugins/integration-test-name.test.ts |
| L12. (slice 4) A `next/` `*.integration.test.ts` whose only top-level calls are shared-suite calls is refused, with a message that names `<base>.contract.test.ts` and `lawsOn` | lint | lint | put back a five-line runner like today's `StartChild.integration.test.ts` in a fixture: fires | oxlint-plugins/contract-test.test.ts |
| L13. The repo's `.oxlintrc.json` wires `fabrika/contract-test` for `next/`'s tests, suites and kits, and `next/`'s tree is at zero, so the rule blocks from the start ([0523](../../../.decisions/0523-advice-rules-block-where-clean.md)) | test | scenario: the real config and tree, the two things this law is about | leave the wiring out of `.oxlintrc.json`: L13 red | oxlint-plugins/contract-test.test.ts |
| L14. Each moved suite's laws run on both sides: for each contract file, `vitest list --project next` and `--project next-integration` name the same laws, less the `on.real` ones on the memory side, and every `on.real` call carries a non-empty reason | test | scenario: the moved files themselves, listed by Vitest | turn one `on` call of a moved file into `on.real` with an empty reason: L14 red | .github/ci/legs.test.ts |

- **L4, L6, L7 and L8 live in one contract file,** `TestDatabase.contract.test.ts`, run through
  `lawsOn(TestDatabase.memory, TestDatabase.folder)`. The package's own openers are the first
  suite that uses the tool, so the file proves itself on both sides; L8 is its `on.real`. That file
  replaces the plain `TestDatabase.integration.test.ts` of pull request 1301 only if the tests step
  finds every one of its laws (D1 to D3) fits as a contract law; else both stay.
- **L14 reads Vitest's own list.** It runs `vitest list --filesOnly=false --project <p> <file>` the
  way `legs.ts` runs `vitest list`, so it is a reader test in the tooling project, not a `next/`
  test. It lives beside the legs script's own laws in the CI scripts' folder (75%), since that
  script already starts `vitest list`.
- **No host-only law.** Nothing here needs launchd, Electron, a real signal or the owner's Mac. The
  real side opens SQLite files in a temp folder, which the schedule runs on `ubuntu-latest` today.
  Every real-side run is in a contract file's `next-integration` run or an `*.integration.test.ts`,
  as 0536 asks.
- **No secret** goes through any of this: no key, no record, no URL. No leak law is needed.
- **Each moved file keeps its laws as they are.** A move changes how the file opens its databases
  and which side runs, never a law's body, its count or its expectation. A law that fails on memory
  goes to `on.real` with its reason only when the failure is something a file has and memory does not
  (bytes, handles, a second connection). Any other failure on memory is a bug in the memory stand-in
  or in our code, and the tests step reports it, never moves it.

## What still runs on a real SQLite file, on the schedule

- **The real side of every contract file:** the 34 files' suites, on a SQLite file through
  `TestDatabase.make`, a new connection per open, a reopen reading what the file kept. This is what
  holds the memory side to the real driver (0536: "the schedule's run is what holds the in-memory
  layer to the real driver's behavior").
- **Every `on.real` law:** a handle count after a scope, a file's bytes, a lock or a second
  connection.
- **The SQL driver's own laws, untouched:** `ledger/Ledger`, `ledger/Log`, `ledger/Rings`,
  `ledger/LedgerSpans` (each an integration file), the app's end-to-end `stored` law (WAL on
  purpose), the app's `instance-database` law (a lock between two processes), and `TestDatabase`'s
  own D1 to D3.

Why the driver stays proven: the memory side and the real side run the same SQLite engine and the
same SQL, so what memory cannot show is exactly what a file adds: durability across a close, the
journal, locks between connections. Those are the real side's job, and it runs every 3 hours, as
before. What this does not prove, before or after: the Durable Object's SQLite, which differs from
Node's (0062's note on `transactionSync`). That stays the Cloudflare runner's job.

What is lost (0536 already accepts it): a bug that only the file shows, such as a law that leans on
an uncommitted row across a reopen, passes on memory and is found by the schedule within about 3
hours. What is gained: every law in these 34 files now runs before a merge, on any change that
reaches it.

## Files

### Slice 1: the tool and four proof files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/vitest/src/Laws.ts | build | 40 | `LayerName`, `RealOnly`, `Laws`, `lawsAt`, `lawsOn`, the `ProvidedContext` augmentation, doc blocks |
| next/packages/vitest/src/Laws.test.ts | tests | tests | L1, L2 |
| next/packages/vitest/src/Laws.types.test.ts | tests | tests | L3 |
| next/packages/vitest/src/TestDatabase.ts | build | 45 | `Databases`, `memory`, `folder` |
| next/packages/vitest/src/TestDatabase.contract.test.ts | tests | tests | L4, L6, L7, L8 |
| next/packages/vitest/src/index.ts | build | 1 | `export * from "./Laws.ts"` |
| next/packages/vitest/package.json | build | 1 | `@effect/platform-node` moves from dev dependencies to dependencies |
| pnpm-lock.yaml | tests | configuration | the package's importer entry follows, from a `pnpm install` with no new version |
| vitest.config.ts | tests | 6 | `CONTRACT`, `provide` in `shared` and in `next-integration`, the comment above `projects` |
| vitest.shards.test.ts | tests | tests | L5 |
| vitest.shards.full.json | build | configuration | the four proof files' rows move to their new paths (same seconds: the real side is the same run) |
| oxlint-plugins/contract-test.ts | tests | 90 | the rule: L9 and L10 |
| oxlint-plugins/contract-test.test.ts | tests | tests | L9, L10, L13 |
| oxlint-plugins/integration-test-name.ts | tests | 2 | `NAMED` lets `*.contract.test.ts` through, with the comment |
| oxlint-plugins/integration-test-name.test.ts | tests | tests | L11 |
| oxlint-plugins/index.ts | tests | 2 | register the rule |
| .oxlintrc.json | tests | configuration | wire `fabrika/contract-test` for `next/`'s tests, suites and kits |
| oxlint-plugins/README.md | tests | docs | the rule's section |
| next/AGENTS.md | build | docs | one row in "What lint holds" |
| next/packages/libfabrika/src/node/Watchers.contract.test.ts | tests | tests | `git mv` from `Watchers.integration.test.ts`; both suites through `lawsOn` |
| next/packages/libfabrika/src/node/StartChild.contract.test.ts | tests | tests | `git mv` from `StartChild.integration.test.ts` |
| next/packages/libfabrika/src/node/StartChildExit.contract.test.ts | tests | tests | `git mv` from `StartChildExit.integration.test.ts` |
| next/packages/libfabrika/src/node/StartChildBoundary.contract.test.ts | tests | tests | `git mv` from `StartChildBoundary.integration.test.ts` |
| next/packages/libfabrika/src/node/StartChild.test-support.ts | tests | tests | `databases` takes `TestDatabase.Databases` |
| .github/ci/legs.test.ts | tests | tests | L14, beside the code that already starts `vitest list` |
| .glossary/TERMS.md | build | docs | rows for `contract test` and `lawsOn` |
| .github/workflows/check.yaml | tests | docs | the comment at "Which tests (0536)" names contract files' memory side; no command changes |

### Slices 2 to 4: the rest, by folder

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/node/ProgramMailRuntime.contract.test.ts | tests | tests | slice 2, `git mv`, and its kit `node/ProgramMail.test-support.ts` takes the opener |
| next/packages/libfabrika/src/node/ProgramMail.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/ProgramMailReads.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/ProgramMail.test-support.ts | tests | tests | slice 2, the opener in place of its folder |
| next/packages/libfabrika/src/node/Reload.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/Children.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/ChildrenMember.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/RecoveryJournal.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/RecoveryStoreReads.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/Replies.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/ExitReason.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/RecordPart.contract.test.ts | tests | tests | slice 2, and its kit `node/RecordPart.test-support.ts` |
| next/packages/libfabrika/src/node/RecordPart.test-support.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/Relations.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/CodeStore.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/Monitor.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/Monitors.contract.test.ts | tests | tests | slice 2 |
| next/packages/libfabrika/src/node/gateway/Tasks.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/gateway/RateLimit.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/tasks/TasksLedger.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/tasks/TasksDiscovery.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/tasks/TasksLedger.test-support.ts | tests | tests | slice 3, the opener |
| next/packages/libfabrika/src/node/repositories/RepositoryTrust.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/ledger/LedgerStreams.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/access/SessionManager.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/access/SessionSender.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/runtime/RunnerInit.contract.test.ts | tests | tests | slice 3 |
| next/packages/libfabrika/src/node/runtime/RunnerHands.contract.test.ts | tests | tests | slice 3, `git mv` from the integration file; `RunnerHands.test.ts` is deleted, its memory opener replaced by `TestDatabase.memory` |
| next/packages/libfabrika/src/ledger/LedgerTurnReads.contract.test.ts | tests | tests | slice 3, the same fold with `LedgerTurnReads.test.ts` |
| next/apps/fabrika/src/checklist-runner.laws.contract.test.ts | tests | tests | slice 4, both suites' wiring through `lawsOn` |
| next/apps/fabrika/src/checklist-runner.laws.integration.test.ts | tests | tests | slice 4, moved by `git mv` to the contract file above |
| next/apps/fabrika/src/inbox-runner.laws.contract.test.ts | tests | tests | slice 4, both suites' wiring through `lawsOn` |
| next/apps/fabrika/src/inbox-runner.laws.integration.test.ts | tests | tests | slice 4, moved by `git mv` to the contract file above |
| next/programs/pipeline/src/node/queue.laws.contract.test.ts | tests | tests | slice 4, both suites' wiring through `lawsOn` |
| next/programs/pipeline/src/node/queue.laws.integration.test.ts | tests | tests | slice 4, moved by `git mv` to the contract file above |
| next/programs/pipeline/src/node/runner.laws.contract.test.ts | tests | tests | slice 4, both suites' wiring through `lawsOn` |
| next/programs/pipeline/src/node/runner.laws.integration.test.ts | tests | tests | slice 4, moved by `git mv` to the contract file above |
| oxlint-plugins/contract-test.ts | tests | 40 | slice 4: L12 |
| oxlint-plugins/contract-test.test.ts | tests | tests | slice 4: L12 |
| vitest.shards.full.json | build | configuration | slices 2 to 4: each moved file's row to its new path |

- **Placement by `next/AGENTS.md`'s libfabrika test.** Every contract file sits where its
  integration file sits today, in the module that owns the driver (0062: `node/` for libfabrika's
  stores, the app or program for its own runner laws). `Laws.ts` and the openers are test tooling,
  so they go in our test package (0538, 0557), not in libfabrika.
- **No suite module changes in slices 1 to 4** unless a law is real-only: then the suite module
  exports that law in its own suite, called through `on.real`, as `StartChildTest` already splits
  `exitSuite` and `boundarySuite`. Each such split names its reason in the pull request.
- Each slice deletes the integration file it moves (`git mv`), so no suite runs twice on real.
- `vitest.shards.json` gets no hand-written row: a moved file's `next` row comes from the
  `shard-times` step of `check.yaml`'s `next` job after its first runs, as that file's doc says.

## The order, and what waits

1. **Pull request 1301 merges first.** Slice 1 adds to its `TestDatabase.ts`, builds on its
   `@effect/platform-node` dependency, and moves files 1301 changes (`Watchers.integration.test.ts`,
   `StartChild.test-support.ts` and most of the 34). Nothing in this plan starts before it is on
   main. Its open follow-up, one `Sql` across reopens copied in twelve files
   (`field/findings/2026-11-14-one-sql-across-reopens-copied-in-twelve-files.json` on its branch), is
   partly answered by `folder`, which removes the copied folder code; the per-part `Sql` wrapper
   stays a kit's.
2. **Slice 1:** the tool, its laws and the lint rule, with Watchers and the three StartChild files,
   the biggest two suites, 1,210.9 s of the 2,406.6 s at full depth. This is what proves the shape
   and gives the first measured memory-side times.
3. **Slice 2:** the rest of `node/` (15 files).
4. **Slice 3:** `node/`'s subfolders and `ledger/` (11 files, the two twins folded).
5. **Slice 4:** the app and the pipeline program (4 files), then L12, at zero.

The 0557 rename (`@kampus/vitest` to `@kalfa/vitest`) and 0580's `plant` option may land between
slices. Each is a one-line import change or a law-option change in the files a slice touches, made
by whichever lands second.

## Calls taken

- **One file in both projects, not two files per suite (80%).** Effect writes two runner files
  (memory in `.test.ts`, the real driver in `.integration.test.ts`), and experiment 292 sketched the
  same. Two files let a suite run on only one side, which is the state of all 34 today. One `lawsOn`
  call makes that shape impossible to write, and 0538 and the ticket name `lawsOn(memory, real)` as
  the tool. The cost: a file in two projects, and a new file name.
- **The file name is `*.contract.test.ts` (75%).** Fowler's contract test is this exact job. The
  doubt is the word's other meaning (Pact). A different name changes only the glob, the rule and
  the files' names, so the reviewer or the owner can rename it cheaply before slice 2.
- **The layer is a project's `provide`, not depth (90%).** 0536 picks the layer by project, and the
  ticket does too. The git laws' kit picks real git by depth inside `next`; that is listed in
  "What comes after", not changed here.
- **Memory reopen keeps the connection (80%),** the `RunnerHands.test.ts` precedent; see "Doubts".
- **A required reason on `on.real` (90%),** as 0580 asks a reason for each label: a law that leaves
  the merge line says why where it is written.
- **The memory default lives in `shared` (85%),** so no run can reach a contract file with no layer,
  and Stryker's config stays safe.
- **The rule's third check (L12) lands in slice 4, at zero (90%).** A blocking rule needs zero
  false alarms (0523); before slice 4 the tree has 30 files it would fire on, and 0524 allows no
  list of leftovers.

## Validation

For the box's steps, narrow paths only, under the machine caps:

```sh
nice -n 15 volta run --node 26.13.0 pnpm exec vitest run --maxWorkers=1 --project next next/packages/vitest/src/TestDatabase.contract.test.ts
nice -n 15 volta run --node 26.13.0 pnpm exec vitest run --maxWorkers=1 --project next-integration next/packages/vitest/src/TestDatabase.contract.test.ts
nice -n 15 volta run --node 26.13.0 pnpm exec vitest run --maxWorkers=1 --project next next/packages/libfabrika/src/node/Watchers.contract.test.ts
nice -n 15 volta run --node 26.13.0 pnpm exec vitest run --maxWorkers=1 --project next-integration next/packages/libfabrika/src/node/Watchers.contract.test.ts
nice -n 15 volta run --node 26.13.0 pnpm exec vitest run --maxWorkers=1 oxlint-plugins/contract-test.test.ts
pnpm lint
```

- Each moved file runs once per project, at the default depth, and its wall time on each side goes
  into the pull request, so the doubt on cost has numbers from slice 1 on.
- The lead runs `--changed origin/main` and the one `pnpm typecheck`. CI runs the merge line; the
  real sides are proven by the first scheduled run after each merge, or by a hand-started scheduled
  run on the branch before it.

## Size

Four pull requests, each landing whole. Confidence 70%: the doubt is how many laws turn out
real-only and need a suite split.

1. The tool and four proof files: about 190 product lines (`Laws.ts` 40, the openers 45, the rule
   90, config and exports 15), about 420 test lines, about 40 lines of docs and configuration.
2. `node/` (15 files): 0 product lines, about 250 test lines.
3. `node/` subfolders and `ledger/` (11 files, two twins folded): 0 product lines, about 200 test
   lines.
4. The app and the pipeline program (4 files) and L12: about 40 product lines, about 200 test lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15, at list price: a tests step
averages $5.78, a build $4.78, a review $2.71 and a fix round $4.18. Slice 1: tests $9, build $7,
review $3.50. Slices 2 to 4: tests $7, build $3, review $3 each. Two likely send-backs at $5. That is
12 steps and 2 send-backs.

Estimate: 14 steps, $70

## Records

- **What is lost if it is not recorded now:** which layer a law passed on in a given run. Only the
  run's own report can say it, so the title carries it (`on memory`, `on real`) into the Vitest JSON
  report the schedule uploads. And the reason a law is real-only, which exists only when the author
  writes it: `on.real` makes it a required value.
- `.glossary/TERMS.md`: `contract test` (a file whose shared suites run on the memory layer in the
  `next` project and on the real layer in `next-integration`, through `lawsOn`; Fowler's word; not
  Pact's consumer-driven contract) and `lawsOn`. The `test depth` row gains one clause: depth sets
  the case count, the project sets the layer.
- `oxlint-plugins/README.md` and `next/AGENTS.md`: the rule.
- No decision file: this builds 0536 and 0538. No experiment write-up: slice 1's pull request
  carries the measured memory-side times.

## What comes after (not built here)

The other integration laws that prove our own logic and could get a stand-in, counted on main at
`f930e00e4` by a static read of each integration test under `next/` and what it imports and calls.
148 integration files and 12 visual files exist; the 34 above are this plan. A file is in its first
matching row. A static read can misplace a file; each row's own plan recounts.

| Next | Count | What it needs | Full s |
|---|---|---|---|
| SQLite stores with laws written in the file or a kit, no shared suite (for example `runtime/Runner`, `processes/ProcessManager`, `access/Authorization`, `telemetry/Records`) | about 28 | nothing new: `lawsOn` with an inline suite, and the process kit's `storage()` taking the opener | about 480 |
| Shared suites plus laws of the file's own (`node/Nemesis.laws`, `node/RunnerAdmission`, `node/IsolateUsage`, `next/apps/fabrika/src/chaos.laws`) | 4 | the file's own laws into the `lawsOn` callback | about 530 |
| Temp files only (for example `node/settings/Load`, `node/dev/dev.laws`, `node/client/KeyFile`, `node/dev/local-dev`) | about 8 | an in-memory `FileSystem` layer; Effect 4.1.3 ships only `layerNoop` | about 70 |
| Git through our git service, picked by depth inside `next` (the git laws' kit and its 4 callers) | 4 | the same files onto `lawsOn(memory git, real git)`, so real git leaves the `next` project | not split out |
| The commit check's git laws (`exam/commits-git-chain`, `-person`, `-steps`) | 3 | `exam/commits.ts` reaching git through the git service, a product change | about 255 |
| A local workerd instance whose logic could run on the in-process pieces | 17 | a whole in-process instance stand-in, the largest piece | about 580 |

What stays real by design: the bundler (13 files), the exam's lint and type runs that spawn the real
tool (about 15), `ssh-keygen` as the reference, real ports, the SQL driver's own laws (4), the WAL
and lock laws (2), and the 12 visual files.

## What this cannot tell us

- **The memory side's time on a pull request.** No moved file has been run on memory yet. The two
  twins say 66% to 80% of the file's time at full depth; slice 1 measures the rest.
- **How many laws are real-only.** "Reopen" in the table is a word match, not a count of laws.
- **Whether every memory side is green.** A memory run can show a bug the file hid (or the other
  way round). Each such case is a finding for the slice, not a law moved to `on.real`.
- **The shard tables key a file by path,** and a contract file now runs in two projects at full
  depth. The full table's row holds the real side's seconds, so the sequencer weighs the memory side
  as heavily, which makes the schedule's legs a little uneven until a project-aware key is worth it.
- **The count of 34** differs from other counts of these files made at other commits with other
  patterns: two files (`Monitor`, `Monitors`) are new since pull request 1341, and the pattern here
  reads `it`, `test` and `describe` lines only.

## Open questions

None.

Every choice above builds 0536 and 0538 or is a call the lead can approve. If
slice 1's measured times put the merge line's goal at risk, that comes to the owner then, as its own
question.

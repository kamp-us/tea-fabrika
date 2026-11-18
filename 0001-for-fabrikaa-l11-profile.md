# For fabrikaa: where L11's storage law spends its 60 s, and what each fix would save

Version: `next/`. Law: `L11: every storage read and write in the child and lifecycle flows keeps
error text and metadata out of outputs`, registered at
`next/apps/fabrika/src/start-child.laws.integration.test.ts:810` (body `storageSecrets` at `:682`,
one cut's setup `storageCall` at `:534`; line numbers at `1f05acc6`). Measured at main `1f05acc6` and re-timed at main
`f79fc38d`. Read-only: no product or test file changed, every experiment was a throwaway copy,
deleted after the run.

## The answer

**About 70% of the law's time is spent building Project runtimes, not in the law's own checks.**
Every one of its 1,385 cuts creates a fresh in-memory database and cold-boots a whole Project
(16.5 ms, 264 SQL statements, 30 transactions, 12 ledger appends), and the recovery and migration
paths build it again after the fault. The time is CPU-bound and flat: no timer waits worth naming
(about 1 s), no leak, no growth from the first walk to the last.

That is why **a split is a weak fix.** Each sub-law keeps its 100 walks with at least 4 cuts per
walk, so a split adds work (+31% CPU for a two-way split). Its heavy half (recovery and migration)
still takes 32.8 s alone, about 70% of today's whole law.

**My lean: fix it from the profile, at the boot, not by splitting** (about 70% sure it is the
better path; details under "Lean"). The one measured test-side fix, copying a booted Project
database into each cut instead of cold-booting, takes the law from about 45 s to about 33 s (−27%).
It keeps the same 901-operation inventory and passes. On its own it does not reach a T753-style
margin (25 s alone). The rest has to come from a cheaper Project runtime build in product code,
which nobody has measured yet.

## The law, its bound and its count

| Fact | Value | Where |
|---|---|---|
| Bound | 60,000 ms, the shared `testTimeout`; no per-law override | `vitest.config.ts:76` |
| Run count | `runsFor({ fast: 100, full: 100 })`: 100 walks at **both** depths, so every pull request runs the full law too | `start-child.laws.integration.test.ts:797` |
| Seed | 119120, `endOnFailure` | same line |
| Inventory | 901 storage operations across 16 flows: fresh 109, saved 31, already 27, ended 27, recovery 157, migration 138, configuration 42, exit 131, status/isLive/info/resolve/object 27 each, receive 28, read 21, append 55 | measured |
| Walk length | `perWalk = max(4, ceil(901/100)) = 10`, a tape of 10 to 18 cuts | `:704` and `:715` |
| Cuts per run | 1,369 walk steps + 16 inventory calls = 1,385 Project boots; mean 13.7 steps per walk | measured |
| Coverage | every operation is cut by walk 67; walks 68 to 100 repeat cuts (468 steps, 34% of steps, 14.4 s) | measured |

The 16 sibling L11 laws in the same file (from `:814`) are a different test, at fast 10 and
full 100.

## Measurements

Cloud box, 4 cores, Node 26.13.0, pnpm 12.16.1, `nice -n 15`, `--maxWorkers=1`, the law alone with
`-t`, `FABRIKA_TEST_DEPTH=full`. The 60 s limit was lifted with `--testTimeout` only to read times
past it; the last run on `f79fc38d` used the real bound.

| Run | Head | L11 time |
|---|---|---|
| alone, 1 to 3 | `1f05acc6` | 46,971 / 46,518 / 46,499 ms |
| alone, under the CPU profiler | `1f05acc6` | 50,260 ms |
| beside two heavy integration files (`runtime-recovery.laws`, `door`), 3 workers like CI's related job | `1f05acc6` | 46,691 ms |
| beside 3 CPU spinners, 4 runnable on 4 cores | `1f05acc6` | 44,737 ms |
| alone, 1 to 3 (last one at the real 60 s bound, green) | `f79fc38d` | 44,866 / 40,842 / 41,605 ms |

Load on this box did not slow the law. The neighbor files mostly wait on I/O (load average 1.8),
and the box gave L11 a whole core even when saturated. So this box cannot reproduce CI's
slowdown. CI's margin has to be read from CI's own numbers, below.

### CI

| Run | Job | Result |
|---|---|---|
| https://github.com/kamp-us/tea-fabrika/actions/runs/44070020127 (branch `fabrikalfa/l11-exercise`, `c087e014`, leg `changed (1)`) | 133994001823 | timed out at 60,000 ms (PR 1379 reports 60,016 ms) |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44043646700 (`fabrikalfa/antislop-mechanical-1366`) | not read | timed out at 60,000 ms, per `field/notes/2026-11-17-native-stack-stale-merge-ref.json` |
| https://github.com/kamp-us/tea-fabrika/actions/runs/43775124405 | 132999601962 | timed out at 60,020 ms, per `field/findings/2026-11-15-l11-storage-walk-near-its-timeout.json` |
| seven scheduled runs on main, 2026-11-15 | listed in `field/findings/2026-11-15-start-child-l11-runs-near-its-limit.json` | passed at 28,340 to 53,908 ms |

What I could not confirm: "fails most runs." I did not survey CI run by run. In the last 100
`check` runs none failed outright. I read four failed scheduled runs (44116831470, 44113744564,
44112439877, 44110991848), and each failed on a different law (checklist-instance L13 twice, the
l11-exercise equality law, dependency-prep-probe), not on this one. Full scheduled runs on main
are skipped today (run 44212196910: every test job skipped). So the law now runs mainly in PR
`related` legs and branch dispatches.

### Where the time goes, by phase

A throwaway copy of the law timed each phase of every cut with `performance.now()` and
`process.cpuUsage()`: 45.1 s in all, CPU time at or above wall time in every phase.

| Phase | Time | Share | Per cut |
|---|---|---|---|
| fresh database and runtime acquire (`childProject`, `acquire`) | 1.1 s | 2.5% | 0.8 ms |
| Project boot (`runtime.runPromise(ProjectService)`) | 22.9 s | 51% | 16.5 ms |
| prepare the flow's state, including migration's 199 × 5 ms `realPause` (1.0 s) | 5.6 s | 12% | 4.0 ms |
| the cut call | 5.8 s | 13% | 4.2 ms |
| the recovery call (which rebuilds the runtime on recovery and migration) | 6.6 s | 15% | 4.8 ms |
| rows and spans to text, twice | 1.6 s | 3.5% | 1.2 ms |
| leak scan | 0.7 s | 1.6% | 0.5 ms |

Per flow, one cut costs 22 to 25 ms, except exit at 29 ms, recovery at 42 ms and migration at
48 ms. Per ten walks: 30.6 to 34.4 ms per cut, with no trend, so no leak and no quadratic growth.

Building Project runtimes adds up to about 70% of the law: the cold boots (22.9 s), plus the warm
rebuilds after `reopen` in recovery and migration (436 of them, about 10 ms each, inside prepare
and the recovery call).

One boot on its own (300 boots, throwaway probe): a **cold boot** on an empty database takes
16.4 ms median and runs 264 statements, 30 transactions and 12 ledger appends. A **warm boot** on
an existing database takes 10.0 ms median and runs 99 statements in 13 transactions. Per ledger
turn the boot repeats `SELECT name FROM sqlite_master WHERE name='entries'`, the quota restore
(`SELECT rev FROM quota_restored`, `SELECT * FROM entries WHERE rev > ?`, `INSERT INTO
quota_restored`) and `DELETE FROM rings ... RETURNING`, 12 times each.

### CPU profile

V8 sampling profile, 500 µs interval, of the law alone (50.4 s sampled). Self time:

| Where | Self |
|---|---|
| SQLite native: `all` 14.9%, `prepare` 4.4%, `run` 2.3%, `exec` 0.9% | 22.5% |
| Effect's fiber runtime (`effect/dist/internal/effect.js`) | 14.9% |
| idle | 7.6% |
| Effect Schema AST and parser (`SchemaAST.js` 7.4%, `SchemaGetter`, `SchemaParser`, interpreter) | about 11% |
| garbage collector | 4.8% |
| `next/packages/libfabrika/src/ledger/NodeSqlite.ts` (`exec`'s row mapping, `:51`) | 3.3% |
| the law's own file, mostly `outputText` (`:276`) and `forms` (`:250`) | 3.0% |
| the fixture, `start-child.test-support.ts` (its `exec` hook at `:274`, `rows` at `:474`) | 2.2% |

Inclusive, in libfabrika (`next/packages/libfabrika/src/`). The profiler reports lines of Vite's
transformed code, so the lines below are the source lines of the same functions at `1f05acc6`:

| Function | Inclusive |
|---|---|
| `ledger/NodeSqlite.ts:55` `transaction` (all SQL work, with the Effect code run inside it) | 29.1% |
| `ledger/internal/ledgerStore.ts:173` `atomic` | 23.2% |
| `cloudflare/SettingsRuntime.ts:73` `runPromise` (one runtime run) | 16.3% |
| `ledger/internal/ledgerStore.ts:406` `inTurn` | 15.3% |
| `processes/ProcessManager.ts:221` `accounted` | 10.2% |
| `processes/QuotasSql.ts:426` `within` (its `infrastructure` case of `charge`, `:339`, 8.0%) | 9.9% |
| `ledger/internal/ledgerStore.ts:231` `place` | 7.8% |
| `settings/Snapshot.ts` (settings decode on each boot) | 4.5% |
| `telemetry/Sink.ts:410` `atomic` (span commits) | 4.2% |
| SHA-256 digests (`effect/crypto` and `node:crypto`) | 3.2% |

The `prepare` cost comes from the fresh database: `nodeSql` caches statements per database, so
1,385 new databases prepare every statement again. Of the 7.6% idle, about 1 s is migration's
`realPause` poll (`:603`). I did not attribute the rest (scheduler gaps between `runPromise`
calls, as a guess).

## Experiments, each a throwaway copy, run once at full depth

| Experiment | Law time | What it shows |
|---|---|---|
| baseline, instrumented copy | 45.1 s | the reference for the rows below |
| **template**: boot one Project, `db.serialize()` it, and give each cut `deserialize`d bytes plus copies of the fixture's remote state and the same key; each cut still builds its own runtime (a warm boot) | **32.9 s** (−27%) | boot phase 22.9 → 13.3 s; the inventory stays 901 with the same count per flow; row and span text sizes identical; law green |
| split, part 1: recovery and migration (295 operations, `perWalk` 4, 797 cuts) | 32.8 s | the heavy half alone |
| split, part 2: the other 14 flows (606 operations, `perWalk` 7, 1,132 cuts) | 28.2 s | 61.0 s for both parts, 1,929 cuts against 1,369 today |
| split plus template, parts 1 and 2 | 31.5 s / 23.4 s | the template barely helps part 1, whose cost is its runtime rebuilds |

Not measured: a cheaper Project runtime build in product code; a template taken after each flow's
prepare step (at most 4.9 s more); an event wait in place of migration's 5 ms poll (at most 1 s);
PR 1379's cached `forms` (at most about 1 s, since `forms` and the leak scan are 2.6% together).

## Options

| Option | Expected, this box alone | What it changes | Run count |
|---|---|---|---|
| A. Template copy of a booted Project, in `start-child.test-support.ts` | about 33 s (measured 32.9 s instrumented) | Each cut starts from a restarted copy of a booted Project, not a first cold boot. My run cut the same 901 operations, but this is a change to the law's starting state: the boot's own pending delivery is redone by the warm boot. It needs a plan and the owner's read | unchanged |
| B. Cheaper Project runtime build in product code (per-turn `sqlite_master` check, quota restore and rings sweep; settings decode; Effect and Schema per runtime) | unknown; building runtimes is about 70% of the law, so each 10% off a build is about 3 s | product code in `ledger/`, `processes/QuotasSql.ts`, `cloudflare/SettingsRuntime.ts`; it helps every law that boots a Project and the real instance's cold start | unchanged |
| C. Split into 2 laws: recovery + migration, and the other 14 flows | the longest is 32.8 s; together 61 s (+31%) | same assertions and the same per-flow coverage check. The cases are not the same: the walks share one `remaining` list across flows today, so a split draws other tapes. Each part keeps 100 walks | unchanged per law; more cuts in total (1,929) |
| C2. Split into 16 laws, one per flow | each about 15 to 37 s; about 390 s in all (estimate) | as C; recovery and migration still take 32 to 37 s each, because of the 4-cut floor per walk | unchanged per law |
| D. A + C | the longest 31.5 s; together 55 s | both changes | unchanged |
| E. A + migration's event wait + PR 1379's cache | about 31 s (estimate) | small test changes | unchanged |
| F. Drop the repeat walks after coverage (walks 68 to 100) | about −14 s | **a loosening**: it cuts the generated cases. PR 1379's approved plan already ruled that its exact-length generator narrowed the law (0093), so this is ruled out | cut |
| G. A fixed exact split (the same 100 tapes, cut across several tests that share the `remaining` list) | as C, without the extra cuts | tests that depend on each other's order and pre-generated fast-check inputs; I did not try it and do not recommend it | unchanged |

Widening the 60 s bound is not an option here (0036).

## Lean

**Fix from the profile (A now, B behind it), not a split.** About 70% sure that is the better
choice; under 60% sure that A alone gives enough margin.

- Why: the cost is building Project runtimes, about 70% of the law. A split moves that cost
  around without removing any of it, and adds 31% CPU. Its heavy half still takes 32.8 s alone,
  close to what A gives the whole law. With A, everything stays one law and one inventory,
  with the same tapes.
- What A costs: a template fixture in `start-child.test-support.ts` (`childProject` taking a
  serialized database, its remote state and its key), and a plan that says why a restarted copy
  is a faithful start for every flow. That is a design call on the law, so it goes to the owner.
- The doubt: CI's speed against this box. CI passed at 28 to 54 s on older code and now times out
  at 60 s, while this box takes 41 to 47 s. So CI runs this law somewhere around 1.0 to 1.5 times
  this box's time. At 33 s here, a slow CI leg could still reach about 50 s. One CI run settles
  it: run the template variant through the `l11-exercise` workflow or a branch's `related` leg,
  ten times. B then gives the margin, and it needs its own profile of one boot. The numbers above
  name the first suspects: the per-turn quota restore and `sqlite_master` read, and settings decode.

## Overlap with open pull requests

- PR 1562 (Effect-style sweep) rewrites much of this law: `forms`, the leak scan, `Str`/`Arr`. It
  also changes 146 lines of `start-child.test-support.ts`, the file option A edits. Whoever lands
  second rebases.
- PR 1379 (`fabrikalfa/l11-speed`) caches `forms(secret)` inside `storageSecrets`. That is small
  and touches the same lines as 1562.
- PR 1593 touches `outputText` and `projectSecrets`, not `storageSecrets` or `storageCall`.
- PR 1494 merged as `f79fc38d` and changed only `helpers` in this file. The law is 41 to 45 s
  there.

## What this cannot tell us

- How fast CI's runners are against this box. I could not reproduce CI's slowdown here, even with
  the box saturated.
- Whether a restarted copy of a booted Project reaches every path a cold boot reaches. My one run
  cut the same 901 operations with the same counts per flow, but that is one seed.
- How much B can save. Nobody has profiled the boot in product code beyond the statement counts
  above.
- Whether "fails most runs" holds: I read only the runs listed above.
- The idle share beyond migration's poll (about 2.8 s) is unexplained.

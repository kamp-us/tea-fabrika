Approved by the lead agent, builds the full-row rule in vitest.shards.ts and lane B1 of issue 1333; body 1e107e6b478b
Plancheck-Version: 3

```ts
// A sketch: the whole idea. One table, refreshed from three real runs by a rule the tests hold.
// vitest.shards.full.json: seconds per test file at full depth, which every CI test leg runs at.
type Sample = { readonly run: Run; readonly leg: string; readonly job: number; readonly seconds: number };
type Run = "44201566907" | "44155250216" | "44077224612"; // attempt 1 of each

// A row from a file's samples (vitest.shards.test.ts's `row`, unchanged):
//   three samples -> the median; one or two -> the larger; one decimal, as the time table prints.
const row = (samples: readonly number[]): number =>
  samples.length === 3 ? samples.toSorted((a, b) => a - b)[1]! : Math.max(...samples);

// The new table: main's table with the 93 measured rows set over it. Rows nobody measured stay.
// next/packages/libfabrika/src/settings/Toml.types.test.ts and TomlParser.test.ts are never touched:
// pull request 1583 moves them.
```

# Refresh the full-depth weight rows CI sizes test legs with (Sev 1 CI speed, lane B1)

Today's version: CI tooling. Ticket: to be filed (Sev 1 CI speed,
[issue 1333](https://github.com/kamp-us/tea-fabrika/issues/1333), lane B1). This builds no new
design. It refreshes data under the rule `vitest.shards.ts` already states for `full`, and fixes
three laws in `vitest.shards.test.ts` that compare the real sequencer with the wrong table. The lead
approves it.

## Doubts at the top

None under 80%. The weakest call is that no law should hold the measured leg balance (85%, under
"Calls taken"). The estimates below come from the same samples the rows come from, so they are
in-sample. The next three scheduled runs' time tables are the real check.

## Calls taken

1. **The samples and the law live in `vitest.shards.test.ts`; the generator stays outside the
   repo** (90%). This is the repo's own pattern: `nextSamples`, `integrationSamples` and
   `e2eSamples` copy the observations into the test, and L5 holds each row to `row(samples)`.
   A new constant `fullSamples` does the same for `full`, with new law F3. One generator script,
   kept in the lead's scratch folder and never committed (0113 bans shell and Python; a committed
   .ts would be a tool nobody runs again, since F3 already checks the numbers), writes both the
   JSON and the `fullSamples` block from the parsed job logs. No number is typed by hand.
2. **Tooling rows go into `full`** (80%). The 23 tooling rows hardly change the two scheduled
   tooling legs: the cap of 2 legs binds, and the legs were already level. But the related tooling
   legs use `legsOf` with `rowsAt("full")` to pick how many legs a changed subset needs. With
   merge-line rows for those files (or no row at all for 11 of them), a subset is sized short. The
   full-depth seconds are the true ones for every CI leg, since every tooling leg runs at
   `FABRIKA_TEST_DEPTH: full`.
3. **No law holds the measured balance on real seconds** (85%). Every balance figure here is
   estimated with the new rows as the truth, from the same samples. A law over that would only
   restate the table. The balance is held by what made it wrong: F3 (the rows are the samples'
   rule), E6 and the lane scenario (the split checked against the rows the sequencer really reads),
   F2 (vitest legs within `mean + heaviest` at full rows) and E4 (visual legs within budget at
   both depths). The pull request body reports the measured before and after, and the lead reads
   the next three scheduled runs' time tables against it.
4. **E4 checks both tables** (85%). The visual legs run at full depth on every run (check.yaml and
   scheduled.yaml both set `FABRIKA_TEST_DEPTH: full`), so `Shards` splits them by `rowsAt("full")`.
   The pull request sizing in `legs.ts` still reads `measured`. E4 keeps its merge-line assertion
   and adds the same assertion at full rows. That is strictly more, never a loosening.
5. **Keys are written in code-point order** (80%). Main's file has one pair out of order
   (`OpenRepository.integration.test.ts` before `OpenRepository.composed.integration.test.ts`).
   The generator sorts all keys, so that one line moves; the pull request names it.
6. **The overlap with pull request 1583** (decided by the lead, recorded here). PR 1583 holds
   `.github/ci/shard-rows.ts` and `.github/ci/shard-rows.test.ts`, and moves two rows:
   `next/packages/libfabrika/src/settings/Toml.types.test.ts` and
   `next/packages/libfabrika/src/settings/TomlParser.test.ts`, in both tables. This pull request
   changes neither file, leaves both keys exactly as on main, and the generator skips both keys even
   if a sample names one (today none does). If 1583 lands first, this branch takes main with a plain
   merge (no rebase, no force push) and keeps 1583's `kalfa/config` row names. The pull request body
   names this overlap.
7. **Run time, not queue wait** (decided by the lead, recorded here). Every estimate compares test
   step run time only. On run 44201566907 the integration legs waited 2 to 331 s for a slot before
   they started; balance does nothing for that. The pull request claims no wall-clock saving from
   queue time.

## The answer first

- `vitest.shards.full.json` gets 93 rows from three real runs: 55 changed, 38 new (23 of them
  tooling files, 11 visual files, the rest next/). Rows not in any leg's ten slowest stay as on main.
- Measured with the repo's own `legsOf` and `assign` on run 44201566907's set, test step run time
  only: the five related integration legs go from 293, 473, 475, 408 and 383 s to about 406 s each
  (`watch.laws.integration.test.ts`, about 403 s, is the floor). The two visual legs go from 359 and
  489 s to 423 and 425 s. The two tooling legs were level (1691 and 1676 s of files) and stay level.
  The before split matches what the run did (28/41/28/29/30 and 83/83 files).
- Three laws in `vitest.shards.test.ts` compared the config's sequencer, which reads
  `rowsAt(depth)`, with an `assign` over `measured`. They passed only because `full` had no visual
  or tooling rows. Every tooling leg runs at full depth, so with the new rows they would go red in
  CI. They now read the same rows the sequencer reads.
- No gate loosens: depth, selected set, required checks, limits and `MOST_TOOLING: 2` stay.

## How others do it

- **Vitest** sizes no shards by time; its `--shard` splits by count, and its own sequencer orders by
  the results cache, which CI does not keep (vitest's `BaseSequencer`, read at the installed
  version in `node_modules/vitest`). That is why this repo keeps its own table.
- **Timing-based splitting** is the known way: CircleCI's `circleci tests split --split-by=timings`
  and Knapsack Pro both store per-file times from past runs and assign heaviest first to the least
  loaded node (longest processing time first, Graham 1969). Both refresh the times from the latest
  runs' results, not by hand. Not fetched this session; from the tools' public docs as known.
- **This repo's rule** (`vitest.shards.ts`, the `measured` and `full` doc comments): the median of
  three samples, or the larger of those in hand, one decimal. This plan follows it as written.

## The shape

### The samples in the test

```ts
// vitest.shards.test.ts, a sketch of the new constant. Generated, never typed.
// Today's CI, every test leg at full depth. Attempt 1 of each run:
//   A: run 44201566907, a pull request check run: related legs 1-6 and next e2e-1, e2e-2.
//   B: run 44155250216, a scheduled full run on main: tests 1-5, tooling-1, tooling-2, e2e-1, e2e-2.
//   C: run 44077224612, a scheduled full run on main, the same legs.
// A sample is the file's seconds in its leg's time table ("Slowest test files", ten per leg),
// which prints the report's (endTime - startTime) / 1000 to one decimal, as shard-times reads it.
// A file missing from a run was not in its leg's ten slowest there. The job ids are kept because
// GitHub drops job logs after 90 days. This copies the observations, never the table's weights.
const fullSamples = {
  jobs: {
    A: { "e2e-1": 134457005735, "e2e-2": 134457005823, "1": 134457805892 /* ... */ },
    B: { "1": 134294246880, "tooling-1": 134294247039 /* ... */ },
    C: { "1": 134018348242 /* ... */ },
  },
  files: {
    "next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts": { A: 0, B: 0, C: 0 }, // made up
    // ... 93 files, each with one to three of A, B, C, and the leg each sample came from
  },
} as const;
```

The shape of `files` (by run, with the leg) is for the tests step to settle, as long as each sample
names its run, leg and job. Related leg 7 of run A, the second tooling leg, has no log in hand, so
the files that ran there have samples from B and C only.

### The generator (outside the repo)

```ts
// A sketch. Kept in the lead's scratch folder, run once with Node 26.13.0, never committed.
// Input: the parsed leg tables (one JSON line per file per leg, from each job's log), main's
// vitest.shards.full.json. Output: the new vitest.shards.full.json and the fullSamples block.
const SKIP = new Set([
  "next/packages/libfabrika/src/settings/Toml.types.test.ts",
  "next/packages/libfabrika/src/settings/TomlParser.test.ts",
]); // pull request 1583 moves these
// Refuses: a sample whose result is not "passed"; a file twice in one run; a path that is not a file.
// rows = for each sampled path not in SKIP: row(its samples)
// table = { ...mainFull, ...rows }, keys in code-point order, two-space JSON, a final newline.
```

The build runs it once and then `pnpm format`. The tests step runs it once for the `fullSamples`
block. Both read the same inputs, which the lead's brief hands each step.

### The three laws that read the wrong table

| Law today | What it compares | Fix |
|---|---|---|
| E6 (end-to-end legs keep `assign`'s files) | the real sequencer (`rowsAt(depth)`) with `assign` over `measured` | `assign` over `rowsAt(depth)` |
| The lane-and-others scenario ("a list holding a lane file and another file") | the real sequencer with `assign` over `measured`, on every non-next row, tooling ones included | `assign` over `rowsAt(depth)` |
| E4 (fewest e2e legs that fit) | `measured` only, while the legs run at full depth | the same assertion at `measured` and at `rowsAt("full")` |

## One value traced through

`next/apps/fabrika/e2e/resources.laws.visual.test.ts`:

1. Run A, job 134457005735 (leg e2e-1): the time table prints 359.3 s. Run B, leg e2e-1: 335.1 s.
   Run C, leg e2e-1: 362.2 s.
2. The generator: three samples, median 359.3. The file is not in `SKIP`.
3. `vitest.shards.full.json` gains `"next/apps/fabrika/e2e/resources.laws.visual.test.ts": 359.3`.
   Its `measured` row, 366.6, stays.
4. `rowsAt("full")` now answers 359.3 for it (F1's new pin); `rowsAt("fast")` still 366.6.
5. On an e2e leg (`FABRIKA_TEST_DEPTH: full`), `Shards.shard` places it by 359.3 together with
   the 10 other new visual rows. `reload.visual.test.ts` (112.8 s, 110.1, 112.8 and 116.6 in
   A, B and C) is no longer placed by its old merge-line seconds, so the split becomes 5 and 7 files,
   about 423 and 425 s, where it was 1 and 11 files, 359 and 489 s.
6. E4 at full rows: the heaviest file, 359.3, fits the 439.8 s budget (17 min / 2 less 70.2 s
   setup), one leg's 848 s does not, two legs' longest, about 425 s, does: the fewest is 2, as
   check.yaml has. E6 at full depth: each leg keeps `assign`'s files over `rowsAt("full")`.

## Laws

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| F3: every row of `fullSamples` is `row` of its samples in `full`, and every sample's run and leg have a job id | test | vector: `fullSamples`, the 93 files of runs A, B and C | Set `watch.laws.integration.test.ts`'s row to 380.2 (its old value): red | `vitest.shards.test.ts` | the full run, and any related tooling leg the table reaches |
| F1, changed pins: `rowsAt("full")` gives 402.7 for watch.laws, 200 for RepositoriesGit and 359.3 for resources.laws, whose merge-line row stays 366.6 | test | vector: the three files of F1 | `rowsAt` answers `measured` at both depths: red, all three | `vitest.shards.test.ts` | the full run |
| F2, unchanged: at full rows the five vitest legs stay within `mean + heaviest` and start their heaviest first | test | scenario: the real config, files and check.yaml, at the new rows | The sequencer over `measured`: red | `vitest.shards.test.ts` | the full run |
| E4, widened: the fewest e2e legs that fit is check.yaml's count at merge-line rows and at full rows | test | scenario: the real visual files, both tables, check.yaml | `resources.laws.visual.test.ts`'s full row at 500: red, naming that file (its merge-line row untouched) | `vitest.shards.test.ts` | the full run |
| E6, re-pointed: each e2e leg keeps exactly `assign`'s files over `rowsAt(depth)` | test | scenario: the real visual project at the run's depth | Keep `assign` over `measured` and run with `FABRIKA_TEST_DEPTH=full`: red (the 1 and 11 split against 5 and 7) | `vitest.shards.test.ts` | the full run, at both depths |
| The lane-and-others scenario, re-pointed: a list with a lane file is split as `assign` over `rowsAt(depth)` does | test | scenario: every lane file and every non-next row | Keep `measured` and run at full depth: red on a tooling file with a new full row, such as `box.test.ts` | `vitest.shards.test.ts` | the full run, at both depths |
| T1: for a Vitest report, the time table's seconds per file and `reportRows`' seconds agree, and both print the same one decimal | test | fc.record: generated reports, names, start and end times in ms; 100 runs, seed 119120 | Round `reportRows`' seconds to whole seconds: red | `.github/ci/shard-times.test.ts` | the full run |

T1 holds the one fact the samples rest on: the job log's time table prints the same seconds as the
report `shard-times` reads, which the artifacts would have given if their blob host were reachable.
No law here is lint or type: each reads real data or real Vitest. None is host-only: none starts
launchd, Electron, a real process or a signal; E4, E6 and F2 create Vitest instances in process and
run no test file.

The tests step runs `vitest.shards.test.ts` at both depths (`FABRIKA_TEST_DEPTH=full` and unset),
since CI runs it at full depth only and a local run at fast depth only.

## Files

The tests step owns the test files. The build owns the table and the doc comment.

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `vitest.shards.full.json` | 93 rows set from the samples by the generator: 55 changed, 38 added; Toml rows untouched | 40 | build | 1 | F3, F1, the review's diff of keys |
| `vitest.shards.ts` | Only the `full` doc comment: the new provenance (runs A, B and C, the time tables, the rule, tooling and visual rows, rows left from the older runs, the Toml rows left for 1583) | 15 | build | 1 | the review |
| `vitest.shards.test.ts` | `fullSamples`, F3, F1's pins and comment, E4 widened, E6 and the lane-and-others scenario re-pointed | tests | tests | 1 | laws |
| `.github/ci/shard-times.test.ts` | T1 | tests | tests | 1 | laws |
| `docs/plan/quests/ci-weight-rows-PLAN.md` | This plan | docs | lead | 1 | plancheck |
| `field/runs/` | One row per step | docs | lead | 1 | field-check |
| `.github/ci/shard-times.ts`, `.github/ci/time-table.ts` | No change: T1 imports them | tests | tests | 1 | read only |
| `.github/ci/changes.mjs`, `.github/ci/legs.ts` | No change: another lane owns them; named in Findings | tests | tests | 1 | read only |
| `.github/ci/shard-rows.ts`, `.github/ci/shard-rows.test.ts` | No change: pull request 1583 holds them | tests | tests | 1 | read only |
| `next/apps/fabrika/e2e/resources.laws.visual.test.ts`, `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts` | No change: only their rows move | tests | tests | 1 | read only |
| `next/packages/libfabrika/src/settings/Toml.types.test.ts`, `next/packages/libfabrika/src/settings/TomlParser.test.ts` | No change, and their rows stay as on main | tests | tests | 1 | read only |

No other file changes: not `.github/ci/changes.mjs`, `legs.ts`, `related.ts`, its tests, the
workflow lint, `check.yaml` or `scheduled.yaml` (another lane), and not `.github/ci/shard-rows.ts`
or its test (pull request 1583).

## Existing tools

- No new code file and no new function enters the repo. `fullSamples` is a data constant; F3
  reuses the test file's own `row`. Searched: `vitest.shards.test.ts` (`row`, `nextSamples`,
  `integrationSamples`, `e2eSamples`), `.github/ci/shard-times.ts` (`reportRows`, `rowLine`),
  `.github/ci/time-table.ts` (`readFiles`, `slowest`).
- The generator, outside the repo: searched for a refresh tool in the repo (`rg "full.json"
  .github .agents scripts`): none exists, which is the open finding
  `field/findings/2026-11-15-full-shard-rows-have-no-refresh.json`. `shard-times.ts` prints one
  report's drift against `measured`, not a median of three runs, and reads artifacts this session
  cannot fetch. So a one-off script, reading the job logs' time tables.
- T1 uses `readFiles` from `time-table.ts` and `reportRows` from `shard-times.ts`, both exported.

## Is this a setting?

No new choice. The rule (median of three, else the larger, one decimal) and the ten slowest per
leg (`SLOWEST` in `time-table.ts`) already exist. The table is data, not a `fabrika.toml` value: no
person sets a file's seconds.

## Records

- **What fact is lost if not recorded now:** each sample's run, leg and job id. GitHub drops job
  logs after 90 days, and the `results-*` artifacts after 7. `fullSamples` keeps them in git.
- The field run rows for each step, the same day.
- The open finding about refreshing the full rows stays open: this refreshes them once, it adds no
  refresh step.

## Validation

- The tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 vitest.shards.test.ts
  .github/ci/shard-times.test.ts`, once unset and once with `FABRIKA_TEST_DEPTH=full`; red before the
  build for F3, F1 and E6 at full depth, green after.
- The build: the generator once, `pnpm format`, `pnpm lint`, the same two paths at both depths.
- The lead, outside any box: `--changed origin/main` once, which reaches every test that imports
  `vitest.shards.ts` (L20), and one typecheck, then CI.
- The review: a node one-liner over main's and the branch's JSON that lists every changed key; it
  must be exactly the 93 sampled paths, plus the one moved line, and neither Toml key.

## Size

1. **The refreshed table and its laws: 55 lines**, plus the tests. One pull request; it lands whole.
   About 90% sure of the size: the table's lines are counted from the 38 new rows.

Priced from this month's `field/runs/` rows for CI tooling steps: tests about $1, build about $1,
review about $0.80, and one likely send-back for the depth-dependent laws at about $1.20.

Estimate: 4 steps, $4

## What this cannot tell us

- Every sample is from one of ten slowest per leg. A file that was never in any leg's ten slowest
  keeps an older row, which may be stale; a file in the ten slowest in one run only gets that one
  sample, the larger-of rule then leans heavy.
- Integration samples mix two contexts: run A's related legs run the integration project alone,
  runs B and C run it beside the `next` project. Their seconds under load may differ.
- The before-and-after figures are estimated with the new rows standing in for the real seconds:
  in-sample. Only later runs measure the after.
- Queue wait is untouched (2 to 331 s on run A's integration legs). Leg balance saves run time in
  the test step only.
- Related leg 7 of run A has no log in hand.

## Open questions

None.

Every point above is the existing rule, the lead's brief, or a call with its percentage.

## Findings

```json
{"_tag":"finding","id":"2026-11-18-tooling-shard-rows-judged-only-on-the-full-run","date":"2026-11-18","by":"ci-weight-rows-plan","model":"claude-opus-5-5","rule":"missing_test","location":{"path":".github/ci/shard-rows.ts","line":12},"says":"In today's CI, shard-rows.ts (pnpm lint) judges only next/ rows of vitest.shards.json and vitest.shards.full.json; a tooling row whose file is renamed or deleted is caught only by vitest.shards.test.ts's 'names only files that are in the repo' tests, which a pull request does not select unless it reaches vitest.shards.ts, so the first red is main's full run.","proof":"stale() filters path.startsWith(\"next/\"); vitest.shards.json holds 437 non-next rows; a deleted tooling test changes nothing vitest.shards.test.ts imports.","cost":"A pull request that renames a tooling test with a row turns main's scheduled run red, a sev1.","head":"397e63f","ticket":null,"pr":null}
{"_tag":"finding","id":"2026-11-18-pr-legs-sized-by-merge-line-rows-split-by-full","date":"2026-11-18","by":"ci-weight-rows-plan","model":"claude-opus-5-5","rule":"missing_test","location":{"path":".github/ci/legs.ts","line":158},"says":"In today's CI, legs.ts sizes a pull request's next and e2e legs with `measured` (size's default table), while those legs run at FABRIKA_TEST_DEPTH full, where Shards splits by rowsAt(\"full\"); its header says 'this split is the one Shards makes on each leg', which holds only for files with no full row.","proof":"check.yaml lines 465 and 483 set FABRIKA_TEST_DEPTH: full on the next and e2e steps; legs.ts line 270 calls size(run, selected, full, limit) with no table; vitest.shards.full.json holds 330 next/ rows, many unlike their measured rows.","cost":"A sized pull request can get fewer legs than its full-depth seconds need, and a leg can run past the budget it was sized for.","head":"397e63f","ticket":null,"pr":null}
```

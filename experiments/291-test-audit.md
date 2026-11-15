---
date: "2026-11-14"
scripts: "none committed; the counts came from `gh run list`, `gh api .../runs/<id>/jobs`, job logs and a static count, each named below; raw data stayed under runs/"
summary: "Repo-wide test audit at 2c7a4e76a, read-only, phoenix's test-audit method. 834 test files: next/ 280 (2,624 tests in CI), today's version 455 (4,618 static cases), tooling 99 (about 1,970 tests in CI). Cheap tests are not the cost: in next/, 1,984 tests under 1 s take 322 s, and 111 tests (4%) take 66% of the time; they are generated laws over real SQLite, git, workerd and browsers. In 13 hours of CI on 2026-11-14 (300 runs, 15,057 machine-minutes) the merge queue took 46%, 58% of its groups failed, and next/'s tests were 58% of all minutes. Top fixes: the merge queue runs what a pull request runs, tooling tests leave the queue and main, property laws over real IO run a PR count with the full count on a schedule, the shard table becomes data, and the flaky real-IO laws get fixed. Today's tests are already ruled out (0525)."
---

# 291. Test audit: how many tests we need, where CI's minutes go, and what runs where

**The answer.** This is about both versions; each claim says which.

- **How many tests there are.** 834 test files at commit `2c7a4e76a` (`git ls-files '*.test.*'`).
  `next/` has 280 files and 2,624 tests, counted by CI's own reporter on three green full runs.
  Today's version has 455 files and about 4,618 test cases (a static count; none of them ran in the
  sampled runs). Tooling (`.agents/`, `.github/ci/`, `oxlint-plugins/`, `scripts/`, the root) has 99
  files and about 1,970 tests in CI.
- **How many earn their place.** In `next/`, nearly all of them, by the skill's value bar. The cheap
  ones cost almost nothing: 1,984 of `next/`'s tests take under 1 s each and 322 s in all. I found 8
  tooling tests that check copied data, not behavior (owner candidates, below). Today's 4,618 cases
  do not earn their place any more, and the owner already ruled them out
  ([0525](../.decisions/0525-todays-version-is-frozen.md); pull request
  [1221](https://github.com/kamp-us/tea-fabrika/pull/1221) removes them).
- **Where the minutes go.** In 13 hours of CI (300 runs of `check`, 2026-11-14 07:40 to 20:38 UTC,
  15,057 machine-minutes):
  - the merge queue took 46% (6,937 min), and 49 of its 85 groups failed;
  - `next/`'s tests took 58% (8,719 min), tooling tests 14% (2,054 min), today's tests 9% (1,297 min);
  - setup (checkout, Node, pnpm, install, apt) took about 13%;
  - inside `next/`, 111 tests of 10 s or more took 66% of the test time, and 96 of those are
    generated laws over real SQLite, git, workerd or a browser.
- **What to change.** Keep both kinds of test. Change how the heavy ones run and where. Ranked by
  machine-minutes saved per agent-hour, the top five not yet in flight are:
  1. tooling tests leave the merge queue and main (about 1,600 min per 13 h, 1 agent-hour);
  2. the merge queue runs what a pull request runs, and a schedule runs the full suite (about
     3,200 min, 3 agent-hours);
  3. property laws over real IO run a PR count, and the full count on the schedule (about 4,300
     min, 6 agent-hours; owner's yes);
  4. the shard table becomes data read from main's last run, so no pull request edits it (about
     1,400 min, 3 agent-hours);
  5. real-git laws use the split `Sources.test.ts` already uses: 20 real runs, the rest injected
     (about 650 min, 2.5 agent-hours; owner's yes).

  Pull requests already in flight cover three more: the first red job stops the run
  ([1256](https://github.com/kamp-us/tea-fabrika/pull/1256)), a push to main skips what the queue
  tested ([1258](https://github.com/kamp-us/tea-fabrika/pull/1258)), and today's tests go
  ([1221](https://github.com/kamp-us/tea-fabrika/pull/1221)).

The minutes overlap, so they do not add up. A rough model at the end puts all of them together at
about a third of today's minutes.

```text
13 hours of check, 2026-11-14, 15,057 machine-minutes
  merge queue      6,937  46%   85 groups, 49 red
  pull requests    6,722  45%   182 runs, 73 of them canceled by a newer push
  push to main     1,397   9%   33 runs
by what ran
  next/ vitest     7,163  48%
  next/ e2e        1,556  10%
  tooling tests    2,054  14%
  today's tests    1,297   9%   test, lane tests, apt, Electron e2e
  setup           ~1,950  13%   checkout, Node, pnpm, install
  lint, typecheck    ~410   3%
```

## How this was measured

Everything was read at `2c7a4e76a` (origin/main, 2026-11-14). Nothing in the repo was edited but
this file. No test ran on the laptop.

- **Runs and jobs.** `gh run list -R kamp-us/tea-fabrika -w check -L 300`, then
  `gh api repos/kamp-us/tea-fabrika/actions/runs/<id>/jobs?filter=all` for all 300 runs. A job's
  minutes are its `completed_at` minus `started_at`; a step's the same. Skipped jobs count zero.
- **Per-file times.** The job logs (`gh api --allow-escape-sequences .../actions/jobs/<id>/logs`) of
  three green full runs: push run 43630065544, push run 43626671924 and merge queue run 43623078615.
  Each ran all of `next/` (5 vitest legs and 2 end-to-end legs) and all tooling tests. The `test` job
  prints a time per file; the `next` job prints a time per test (`--reporter=verbose`), so a
  `next/` file's time is the larger of its tests' sum and its first-to-last span. A file's number is
  the median of the three runs. These are times on a leg that runs 3 files at once, so the sum of
  files is about three times the leg's wall time.
- **Failures.** The logs of all 105 failed jobs in the window other than `ci-required`, each tagged
  by its first `FAIL` line, or the line before `Process completed with exit code`.
- **Static count.** A small reader over `git ls-files` that counts `it(`, `test(` and their
  `.effect`, `.prop`, `.each` and `.live` forms, `numRuns` values and IO signals. It undercounts
  `each` tables and shared suites, which is why `next/` and tooling use CI's counts.
- **Unit or real IO.** A file counts as real IO when it opens `node:sqlite`, spawns a process, boots
  `dev.ts` or workerd, runs a bundler or a browser, makes a temp folder, or runs a shared suite on a
  real store. This is a text match, so a few files may be in the wrong group.
- **In flight.** `gh pr list --state open` with each pull request's files, read before any judgment.
  A candidate whose files an open pull request changes is marked with that pull request.

Raw data is under the worktree's `runs/test-audit/` and is not committed.

## 1. Inventory

| Version | Files | Tests | Source |
|---|---|---|---|
| `next/`, vitest | 271 | 2,603 | CI reporter, run 43630065544, legs 1 to 5 |
| `next/`, end to end | 9 | 21 | the same run, legs e2e-1 and e2e-2 |
| today's version | 455 | ~4,618 | static count; not in the sampled runs |
| tooling | 98 | ~1,967 | CI reporter, run 43630065544, `test` legs 1 to 6 |

By package, static count of files and test declarations:

```text
packages/pipeline (today)       180 files  2,102 cases
next/packages/libfabrika        185 files  1,127 cases   (CI: more, from shared suites and tables)
packages/fabrika (today)        114 files    992 cases
apps/fabrika (today)             91 files    951 cases
next/apps/fabrika                77 files    553 cases
.agents/skills/lead              44 files    624 cases
oxlint-plugins                   33 files    295 cases
programs/* (today)               62 files    429 cases
.github/ci                       10 files    124 cases
everything else                  38 files    351 cases
```

By kind, for `next/`, from the test names in run 43630065544's log. The repo's law-shape labels
(`scenario`, `pinned`, `vector`, `format`, `type`) mark a test; an unlabeled test is a law, mostly
generated:

```text
unit and integration   law 2,035 tests  4,920 s   scenario 87   375 s   pinned 18  13 s   vector 26  5 s
                       format 29  0 s   type 13  0 s
exam                   law   315 tests    429 s   scenario 65    99 s   pinned 10   5 s   format 5, vector 1
end to end             law    10 tests    517 s   scenario  7   120 s   pinned  3   4 s
```

And split by what a file touches:

```text
next/   real IO     139 files  1,665 tests  5,826 s  (94% of next/'s time)
next/   in memory   141 files    959 tests    394 s  ( 6%)
tooling real IO      62 files  1,572 tests  1,530 s
tooling in memory    37 files    352 tests     80 s
```

**What this says.** The unit and property tests that run in memory are nearly free. The cost is the
integration laws, and inside them a few dozen generated walks.

## 2. Where the minutes go

### By job and event

| Event | Runs | Machine-min | Per run |
|---|---|---|---|
| merge queue, red | 49 | 4,411 | 90 |
| merge queue, green | 29 | 1,944 | 67 |
| merge queue, canceled | 7 | 583 | 83 |
| pull request, green | 88 | 3,787 | 43 |
| pull request, canceled | 63 | 1,648 | 26 |
| pull request, red | 21 | 1,288 | 61 |
| push to main, all | 33 | 1,397 | 42 |

By job across all events: `next` 9,848 min (65%), `test` 3,859 (26%), `check` 435, `typecheck`
328, today's `e2e` 202, the small jobs the rest.

### Setup against test time, per job

Medians of the step times in green runs:

| Job | Setup before the first test | Test or check step | Setup share |
|---|---|---|---|
| `next`, a vitest leg | checkout 17 s, Node 13 s, pnpm 5 s, install 5 s: ~41 s | ~500 s | ~8% |
| `next`, an e2e leg | the same, plus Chromium 21 s: ~62 s | 258 to 644 s | ~10 to 20% |
| `test`, tooling only | checkout 17 s, Node 12 s, pnpm 5 s, install 4 s: ~39 s | 189 s | ~17% |
| `test`, today's | the same, plus apt 16 s: ~55 s | 237 to 253 s | ~18% |
| `check` | ~30 s | lint 96 s | ~24% |
| `typecheck` | ~35 s | 57 s | ~38% |
| `changes`, `field` | checkout 17 s is 71% to 90% of each | under 2 s | most of it |

Setup is about 13% of all minutes. It matters per machine started: each extra leg pays ~41 s.
Pull request [1258](https://github.com/kamp-us/tea-fabrika/pull/1258) folds `legs` into `changes`
and `field` into `check`, two fewer machines a run.

### The top 30 files

Median seconds over the three full runs. Share is of 7,831 file-seconds, the sum over every file in
one full run (`next/` 6,221 s, tooling 1,611 s; today's tests did not run in these three). Each
cause comes from reading the file.

| # | File | s | Share | Why it is slow |
|---|---|---|---|---|
| 1 | `next/.../node/repositories/RepositoriesGit.test.ts` | 450 | 5.7% | 3 laws at 200, 200 and 300 runs; each run builds a real git repo: `init --bare`, `clone`, `commit`, `push`, and more. L5 alone took 315 s |
| 2 | `next/.../node/Watchers.test.ts` | 383 | 4.9% | W3: 100 runs, each fills 1,026 watchers into a real SQLite file. One test, 581 s in one run, the slowest test in CI. In flight: [1252](https://github.com/kamp-us/tea-fabrika/pull/1252) |
| 3 | `next/.../node/StartChild.test.ts` | 380 | 4.9% | the `StartChildTest` suite on real SQLite and runners, walks of 100 runs that must reach every move. In flight: [1252](https://github.com/kamp-us/tea-fabrika/pull/1252) splits it |
| 4 | `next/apps/fabrika/e2e/resources.laws.test.ts` | 349 | 4.5% | each run starts a child Vitest that boots a browser and a server, then injects a fault; 10 runs for the first-window target. Alone on leg e2e-1 |
| 5 | `.agents/skills/lead/scripts/boxrm.test.ts` | 344 | 4.4% | 114 tests, 44 properties, each run spawns `box.sh` and real git on a fresh repo |
| 6 | `next/.../node/RunnerAdmission.test.ts` | 319 | 4.1% | the admission suite, 40 runs a law, real SQLite and runners; TestClock already used |
| 7 | `.agents/skills/lead/scripts/box.test.ts` | 237 | 3.0% | as boxrm: shell script plus real git, 52 properties |
| 8 | `next/.../node/ProgramMailRuntime.test.ts` | 235 | 3.0% | `ProgramMailTest` on the real runtime, laws at 100 to 300 runs. The same suite on the store takes 20 to 30 s. Its P41 failed in 9 jobs today |
| 9 | `.agents/skills/plan/scripts/plancheck.test.ts` | 207 | 2.6% | 48 properties up to 96 runs, spawns the checker per case |
| 10 | `next/apps/fabrika/src/build.test.ts` | 206 | 2.6% | real rolldown builds of the app per case; a 30-run law builds each time. In flight: [1204](https://github.com/kamp-us/tea-fabrika/pull/1204) |
| 11 | `next/apps/fabrika/e2e/first-window.test.ts` | 182 | 2.3% | real browser, generated sentinel credentials (L17, 116 s), two tabs (L15). In flight: [1231](https://github.com/kamp-us/tea-fabrika/pull/1231), [1217](https://github.com/kamp-us/tea-fabrika/pull/1217) |
| 12 | `next/apps/fabrika/src/door.test.ts` | 180 | 2.3% | 150 tests in 5,607 lines; many laws at 50 to 100 runs over real SQLite |
| 13 | `next/.../runtime/Runner.test.ts` | 167 | 2.1% | 117 tests; 32 laws at 12 runs over SQLite |
| 14 | `next/.../node/gateway/Jobs.test.ts` | 155 | 2.0% | one gateway walk run 8 times, once per focus (A4 to A12), 40 to 100 runs each, `concurrency: 1` |
| 15 | `next/apps/fabrika/src/start-child.laws.test.ts` | 140 | 1.8% | real workerd; two laws at 100 runs. In flight: 1231, 1232, 1012 |
| 16 | `next/apps/fabrika/src/runtime-recovery.laws.test.ts` | 137 | 1.7% | workerd stand-in with real timers (`setTimeout`), flows at 12 runs and a law at 40; T753 L16 timed out in 13 jobs today. In flight: 1232, 1231, 1092, 1012 |
| 17 | `next/apps/fabrika/src/instance-wire.test.ts` | 135 | 1.7% | every one of its 13 scenarios starts a real `dev.ts` and workerd, polling every 20 ms until ready |
| 18 | `.agents/skills/lead/scripts/loosening.test.ts` | 129 | 1.7% | real git repos per case |
| 19 | `next/apps/fabrika/src/chaos.laws.test.ts` | 124 | 1.6% | the runner suite under chaos, plus a 100-run hold law |
| 20 | `.github/ci/workflow-lint.test.ts` | 120 | 1.5% | 283 tests, YAML parse of generated workflows per case |
| 21 | `next/apps/fabrika/src/instance-records.test.ts` | 106 | 1.4% | real workerd per scenario; kills and replaces it on purpose. In flight: 1092 |
| 22 | `next/.../node/repositories/OpenRepository.test.ts` | 97 | 1.2% | five laws at 200 runs, real git and SQLite |
| 23 | `scripts/caps.test.ts` | 97 | 1.2% | spawns real Vitest and git to prove the laptop caps |
| 24 | `next/apps/fabrika/src/exam/commits-git-steps.test.ts` | 97 | 1.2% | the exam's real git chains, 37 tests |
| 25 | `next/.../node/Children.test.ts` | 96 | 1.2% | `ChildrenTest` on real SQLite |
| 26 | `next/.../runtime/RunnerSupervision.test.ts` | 92 | 1.2% | spawns runners; TestClock already used |
| 27 | `next/apps/fabrika/src/checklist-instance.laws.test.ts` | 91 | 1.2% | a 50-run law over the real project wiring; a fixed 50 ms `settle` sleep between steps. In flight: 1231, 1012 |
| 28 | `next/.../node/jobs/JobsLedger.test.ts` | 80 | 1.0% | `JobsTest` on SQLite; A5 discovery 93 s. In flight: 1252 |
| 29 | `next/.../node/build/build-one-file.test.ts` | 77 | 1.0% | real bundler runs, spawns |
| 30 | `next/programs/pipeline/src/node/queue.laws.test.ts` | 75 | 1.0% | the queue on real runners over SQLite; Q5 55 s |

The top 30 hold 70% of the file-seconds. The single slowest tests set a floor for each leg, since a
test cannot be split across machines:

```text
581 s  Watchers W3                          (in flight, 1252)
320 s  resources.laws generated fault walk
315 s  RepositoriesGit L5, 300 real-git runs
183 s  StartChild L6                        (in flight, 1252)
116 s  first-window L17 secrets
113 s  OpenRepository L8, 200 runs
 93 s  JobsLedger A5                        (in flight, 1252)
```

Pull request [1241](https://github.com/kamp-us/tea-fabrika/pull/1241) starts the heaviest file
first on each leg, which brings the longest leg down to the slowest file. It cannot go lower than
that file.

### Why each kind is slow

- **High run counts on real IO.** 158 `next/` test files set `numRuns` or `runs` by hand. The values
  run from 1 to 3,000; 100 is the most common (80 sites), then 20, 12, 40 and 200. A run count is
  cheap on a pure function and expensive when every run builds a git repo, a SQLite file or a
  browser.
- **A fixed seed.** Almost every law uses seed 119120. So every CI run checks the same cases in the
  same order. Run 150 of 200 on every pull request is the same input every time.
- **A fresh world per case.** The real-IO laws build a new temp folder, database or repo for each
  run, on purpose (decisions 0061, 0062). That is the trust they give; it is also why a run costs
  0.5 to 3 s.
- **A boot per scenario.** `instance-wire` starts `dev.ts` and workerd 13 times. `resources.laws`
  starts a child Vitest with a browser per run.
- **Real timers in a few places.** `checklist-instance.laws` waits a fixed 50 ms; `instance-wire`
  and `instance-records` poll every 20 ms; `runtime-recovery.laws` uses `setTimeout` for its alarm
  stand-in. The runner suites already use TestClock. The fixed sleeps are a small share of time but
  a likely share of the flakes.
- **Three heavy files on a 4-core runner.** Each leg runs 3 files at once. Every flaky law today has
  a field row that says "on a loaded CI machine". The 60 s limit in `vitest.config.ts` was measured
  on 2026-10-24, before most of these real-IO laws existed.

## 3. Why CI keeps looping

Three things, all measured above.

**The merge queue runs everything, and it fails often.** A group runs all of `next/` (7 machines)
and every tooling test the triggers pick, whatever the group changed. 49 of 85 groups failed. Here
is what turned them red, by run, with each run's minutes:

| What failed | Red groups and pushes | Machine-min |
|---|---|---|
| the shard table: no row, stale row, or its own test | 20 | 1,712 |
| a flaky real-IO law: timeouts and generated walks | 17 | 1,599 (queue and main only) |
| an advice rule's "no fire left" ratchet | 14 | 1,316 |
| `exam-paths.json`'s byte snapshot, from two pull requests at once | 3 | 278 |
| a real code error (typecheck, layers, dead export), all on pull requests | 6 | 172 |

A run with two causes counts in both rows. 15 of the shard table's red jobs were the "no shard row"
rule, which main has since dropped (`shard-rows.ts` now places a file with no row by the median);
the stale-row lint and the table's own tests remain.

A group is red for a reason that has nothing to do with its pull requests, and then every pull
request behind it is rebuilt. With the run going on to the end after a red job, a red group cost 90
min on average. Pull request 1256 stops the run at the first red job.

**A CI change tests all of `next/`.** `vitest.config.ts` lists `**/.github/**` as a
`forceRerunTriggers` path, and `changes.mjs` sends a `.github/` path to "all of next/". No `next/`
test reads a file under `.github/` (searched with `rg '\.github' next --glob '*.test.ts'`; the one
hit, `exam/commits.test.ts`, names the glob as a string). So each pull request that speeds up CI
runs all of `next/` to prove it. Today, 17 pull request runs touched only CI tooling and spent 495
min; 322 of that was `next`. The work to make CI faster is itself the most expensive kind of run.

**Hand-kept lists fail when two pull requests meet.** The shard table in `vitest.shards.ts` names
every file with a number, and a lint step and tests check it against the repo. Two pull requests
that each pass alone (one adds a file, one deletes a row) fail together in the queue. The same goes
for the advice ratchet and the byte snapshot. Each fix to CI speed added more rows, so it fed the
loop.

## 4. Value: the junk-pattern pass

The repo-wide mode asks for one read-only pass per share of files. This audit ran as one agent with
no subagents, so it read the 40 slowest files at the level of their setup, run counts and laws, and
searched every test file for the patterns that a search can find (source-text reads, snapshots,
export-list asserts, copied samples). The other files were not read one by one. Treat the list
below as high-confidence finds, not as a full sweep.

**Found, test-only, owner candidates (deleting a law is a loosening):**

- `vitest.shards.test.ts`, seven tests that check copied data: "vector: L5 known next timings"
  (line 24), "vector: L5 all 263 next rows" (626), "vector: E5" (643), "vector: real CI medians
  include the previously unweighted scripts" (710), "vector: the four build files carry their
  refreshed main-run times" (718), "vector: lead test medians match the three green main CI runs"
  (732), "vector: L12 stale non-lane rows" (1099).
  - Pattern: copied inventories, and expected values that are the same copied data. About 560
    lines of raw samples (`nextSamples`, `e2eSamples`) are pasted into the test, and the tests check
    that the table equals their medians.
  - What it can catch: a number typed into the table that differs from the number typed into the
    test. No behavior of the sequencer.
  - Stronger proof that stays: the `assign`, `median` and `Shards` laws (L8, L9, L13 to L17, E4,
    E6, E7) test the split itself.
  - Unlocks: about 600 lines, and every table refresh becomes one edit.
  - In flight: [1241](https://github.com/kamp-us/tea-fabrika/pull/1241) changes this file.
- `vitest.shards.test.ts`, "measured names only files that are in the repo" (line 995). The same
  contract as `.github/ci/shard-rows.ts`'s stale-row lint. Two checks fail for one rename. Keep one.
- `vitest.shards.test.ts`, "scenario: L6 the five measured heaviest next files occupy the five vitest
  machines" (line 46). It pins five file names, so it goes red when one of them gets faster, which is
  the goal. Rewrite it as a law over any table (the five heaviest rows land on five legs), not
  delete it.

**Duplicate proof across layers, kept but rebalanced:** the same law at full count on a cheap
layer and an expensive one.

- `ProgramMailTest` runs on the store (`ProgramMail.test.ts`, 20 to 30 s) and on the runtime
  (`ProgramMailRuntime.test.ts`, 134 to 239 s), both at 100 to 300 runs.
- Watchers W3 runs in memory (`runtime/internal/watchers.test.ts`, 200 runs, 19 to 38 s) and on SQL
  (`WatchersTest.ts` through `node/Watchers.test.ts`, 100 runs of a 1,026-row fill, 383 s). In flight
  in 1252.
- `JobsTest` runs on memory and on SQLite (`node/jobs/JobsLedger.test.ts`), and the gateway walk
  runs it again with 8 foci.

Each driver has its own risk (0062: shared suites run on each store), so both stay. The lean: the
full count lives on the cheap driver; the expensive driver runs enough cases to reach every move,
plus the full count on the schedule.

**Retained, looked like junk, are not:**

- The exam's lint tests (`exam/no-of.test.ts` and its siblings) and the rule tests in
  `oxlint-plugins/` prove the same rules. The exam is the protected copy agents cannot edit
  (`exam-paths.json`), so the double is on purpose.
- `exam/commits.test.ts`, "format: exam-paths.json bytes", pins every byte of a protected list. It
  turned 7 runs red today, 3 of them in the queue or on main. That is its job: changing the exam
  takes two edits. Keep.
- The runner suites run once per program (checklist, inbox, chaos). That is one contract per
  program, the "every machine has laws" rule.
- `instance-records` kills and replaces workerd on purpose; one instance per file does not fit it.

**Today's version.** 455 files, about 4,618 cases. Decision 0525 already removes them, in flight in
1221. In this window they cost 1,297 min (9%): their test and lane steps, apt, and Electron e2e.

**A flake with no record.** `ProgramMailRuntime.test.ts`, "P41: a request and its answer between two
real" runners, failed in 9 jobs today on unrelated pull requests (4 timeouts at 150 s, 5 "Property
failed after 12 to 54 tests"). I found no field row for it. The other flaky laws have rows dated
2026-11-14 in `field/findings/`.

## 5. The fixes, ranked

Minutes are machine-minutes per 13-hour window like today's. They overlap, so do not add them. Each
says what it changes (delete, merge, speed up or move) and what trust it costs.

| # | Fix | Kind | Saves | Agent-hours | Min per hour | Trust it costs |
|---|---|---|---|---|---|---|
| 1 | Tooling tests leave the merge queue and main; they run on a pull request that reaches them, and on the schedule | move | ~1,600 | 1 | ~1,600 | a product change that breaks lead tooling (a lockfile bump) is seen on the schedule, hours later |
| 2 | The merge queue runs what a pull request runs: `--changed` over the group's diff plus the reader tests, sized by `legs.ts`; the full suite moves to a schedule | move | ~3,200 | 3 | ~1,070 | a break outside the group's import graph and outside the reader tests is caught by the schedule, not before the merge |
| 3 | Property laws over real IO read their run count from one setting: a PR count, and the full count on the schedule | speed up | ~4,300 | 6 | ~720 | with the fixed seed, the cases past the PR count are the same every run; a bug only they reach is found on the schedule |
| 4 | The shard table becomes data: each main run saves its JSON reports, the next run reads them; no lint on rows, and the copied-sample tests go | speed up, delete | ~1,400 | 3 | ~470 | none for product code; a new file is placed by the median until main has run it once, as today |
| 5 | Real-git laws use `Sources.test.ts`'s split: 20 real-git runs, the rest injected (`RepositoriesGit`, `OpenRepository`) | speed up | ~650 | 2.5 | ~260 | fewer real-git draws per pull request; the logic keeps its full count through the injected runs |
| 6 | A pull request that changes only CI tooling runs one small `next/` leg, not all of `next/`: drop `**/.github/**` from the triggers for `next/` | move | ~320 | 1.5 | ~210 | a broken `next` job definition shows on the smoke leg only; the rest in the queue or schedule |
| 7 | `build.test.ts` builds the good app once per file and reuses it; the failure cases keep their own builds | speed up | ~200 | 1.5 | ~130 | a guess at 60%: if a case mutates the shared output, cases can hide each other |
| 8 | The flaky real-IO laws are fixed, each at its cause (0036): T753 L16, P41, runtime L4 (1202), A13 (1245), checklist L13, LedgerStreams A5 | speed up | ~1,600 direct, plus each requeue | ~12 | ~130 | none; this is owed work |
| 9 | Heavy real-IO files run one to a worker (a Vitest project of their own with `maxWorkers: 1`, or a weight in `Shards`) | speed up | unknown | 2 | unknown | none; a guess that it removes the "loaded machine" timeouts |
| 10 | `instance-wire` shares one booted instance per file for the scenarios that do not stop it | speed up | ~140 | 2 | ~70 | shared state between scenarios: one can hide or cause another's failure |

Fix 3 is where the lead's other ideas land too. A shared suite runs its full count on the cheap
driver and the PR count on the expensive one. The resources walk runs 2 child runs on a pull
request, not 10; that alone could bring the end-to-end legs from 2 machines to 1.

How fix 3 would look. The known way is a profile per environment: Hypothesis calls them settings
profiles (`ci`, `dev`, with `max_examples`), and fast-check has `fc.configureGlobal`. Here the counts
are set per call, so `configureGlobal` cannot reach them; one helper can. A sketch:

```ts
// next/packages/libfabrika/src/testing/Runs.ts (a sketch; the name and home are open)
// One choice, declared once (0069): how many generated cases a law runs here.
// "pr" scales each law's count down to its floor; "full" runs what the law asks for.
const scale = process.env["FABRIKA_LAW_RUNS"] === "full" ? 1 : 0.2;

/** The law's full count, scaled, never under the floor its coverage check needs. */
export const runs = (full: number, floor = 3): number => Math.max(floor, Math.ceil(full * scale));

// In a law:
//   fc.assert(property, { seed: 119120, numRuns: Runs.runs(200, 20) })
//   it.prop(name, arbs, body, { arbitrary: { seed: 119120, runs: Runs.runs(100) } })
```

The floor matters. Some walks end with "every move was reached" (`StartChildTest.ts`'s `prop`,
`JobsTest.ts`'s `required`). Those need enough runs on a pull request to pass. A lint rule would then
refuse a bare number in `numRuns` or `runs` in `next/`, so a new law cannot skip the setting.

**In flight, not counted above:**

| Pull request | What it does | Saves in this window |
|---|---|---|
| [1256](https://github.com/kamp-us/tea-fabrika/pull/1256) | the first red job cancels the run on a pull request and in the queue | ~2,800 of the 5,700 red-run minutes on pull requests and the queue (a guess at half) |
| [1258](https://github.com/kamp-us/tea-fabrika/pull/1258) | a push the queue tested skips `test`, `next` and `e2e`; two fewer machines a run | ~700 (8 pushes at ~87 min, its own table) |
| [1221](https://github.com/kamp-us/tea-fabrika/pull/1221) | today's tests, fixtures and jobs go (0525) | ~1,300 |
| [1252](https://github.com/kamp-us/tea-fabrika/pull/1252) | W3 builds its fill once; StartChild and the jobs laws split into files | part of the 581 s floor and ~380 s |
| [1241](https://github.com/kamp-us/tea-fabrika/pull/1241) | the heaviest file starts first on each leg | wall time, ~250 s a leg; few machine-minutes |
| [1202](https://github.com/kamp-us/tea-fabrika/pull/1202), [1245](https://github.com/kamp-us/tea-fabrika/pull/1245) | runtime L4 and A13 flakes | part of fix 8 |

**A rough model of all of it together**, per 13-hour window, applied in order so nothing counts twice:

```text
today                                       15,057
today's tests go (1221)                     -1,300   13,757
push skips what the queue tested (1258)       -700   13,057
tooling leaves queue and main (fix 1)       -1,600   11,457
queue runs what a PR runs (fix 2)           -1,950    9,507   (queue next at 0.6 of today)
PR count for real-IO laws (fix 3)           -3,500    6,007   (49% of what next/ has left)
first red stops, fewer flakes (1256, fix 8)   -800    5,207
add: full suite every 3 hours (schedule)      +260    5,467   (about 60 machine-min a run)
```

About a third of today. Every step is an estimate from today's mix of pull requests; a day with
more `next/` work would save less in fixes 1 and 6 and more in fix 3.

## 6. Owner candidates

None of these is done. Each needs the owner's yes, because it narrows what a law or a check proves.

**Law deletions:**

1. The seven copied-sample vector tests in `vitest.shards.test.ts` (section 4), with their sample
   blocks.
2. "measured names only files that are in the repo" in `vitest.shards.test.ts`, which
   `shard-rows.ts` already checks.

**Loosenings that are not deletions:**

3. Fix 3: a pull request runs fewer generated cases than a law asks for. The full count runs on the
   schedule.
4. Fix 5: the real-git laws run 20 real-git cases, not 200 or 300.
5. Fix 6: a `.github/` path no longer starts all of `next/`; `changes.test.ts`'s laws narrow.
6. Fixes 1 and 2: the merge queue and main stop running tooling tests and the full `next/` suite.
   That changes `changes.test.ts`, `legs.test.ts` and `workflow-lint.test.ts` laws, and decision
   0175 says a scheduled full run is not decided yet.

## 7. What runs where

Read first: [0066](../.decisions/0066-mutation-runs-on-a-schedule.md) (mutation on a schedule, never
a step), [0175](../.decisions/0175-every-run-follows-its-paths.md) (every run follows its paths; a
scheduled full suite "not decided"), [0525](../.decisions/0525-todays-version-is-frozen.md) (no test
or job for today's version), `check.yaml`, `changes.mjs` and `legs.ts`. The owner's direction for
this audit: the merge line never runs the full suite, a schedule does, and main runs only `next/`
tests.

The rule that stops the loop: **each event proves one thing, and only the schedule proves
everything.**

| Where | What it proves | What runs | Today's cost per run | After |
|---|---|---|---|---|
| draft pull request | it is well formed | `changes`, lint, typecheck | ~4 to 6 min | the same |
| ready pull request | its change works | lint, typecheck; the tests whose imports reach the change, plus the reader tests, at the PR run count; e2e only when its imports changed; tooling tests only when tooling changed; a `.github/`-only change gets one smoke leg of `next/` | 43 min green | ~15 to 20 min (a guess) |
| merge queue | the group's pull requests work together | the same selection as a ready pull request, over the group's diff | 67 green, 90 red | about a ready PR's cost |
| push to main | nothing new when the queue tested it (1258); for an admin merge, the `next/` tests its diff reaches | `next/` only, `--changed` from `before` | 27 green | near 0 for queue merges |
| schedule, every 3 hours on main's head if it moved | the whole repo, at full strength | all of `next/` and its e2e at the full run count, all tooling tests; a red run files one ticket with the range | none today | ~60 machine-min a run, ~480 a day |
| schedule, hourly (0066) | the laws catch mutants | mutation, as today | as today | as today |

Why every 3 hours: a full run costs about 60 machine-min (`next` was 47 min a green queue run, plus
tooling on 2 machines). Hourly would be ~1,440 machine-minutes a day; every 3 hours ~480. Today the
queue and main spent about 8,300 machine-minutes in 13 hours. Every 3 hours means a bug only the
full run sees reaches main and waits up to 3 hours to be named. That is a setting, not a decision
(0069): the interval is a number the owner may change.

What the schedule needs, so its red is useful: it runs on a commit, prints the commit range since
its last green run, and files one tracker ticket. The fixed seed stays on pull requests, so a red PR
can be run again the same way. Whether the schedule rotates its seed is the owner's call: a new seed
finds new cases, and each red run prints its seed so it can be run again.

## What this cannot tell us

- **Today's tests' current times.** None ran in the three sampled runs. Their per-file times come
  from `vitest.shards.ts`'s older rows (2,470 s in all), and their minutes from the window's steps.
- **Whether fewer cases miss real bugs.** No mutation run backed fix 3 or fix 5. The hourly mutation
  run is the place to measure it: run its sample at the PR count and at the full count, and compare
  killed mutants.
- **How long the queue made pull requests wait.** I measured machine-minutes, not the wall time from
  "added to queue" to "merged".
- **Whether each failed law was a flake or a real bug.** I tagged a failure in the queue or on main
  as a flake when the same law failed on unrelated pull requests. `port-home.laws.test.ts` law 5
  failed in 6 queue groups between 18:48 and 19:37 UTC; that looks like main was red for a while,
  not a flake, and I did not prove which.
- **The minutes saved.** Each is a projection from one day's mix, at about 60% confidence for fixes
  1, 2 and 4, and about 50% for fix 3, whose number assumes a PR count of one fifth with no floor
  holding it up.
- **The full junk-pattern sweep.** The method asks for one pass per share of at most 150 files. This
  ran as one agent. The other files were searched by pattern, not read.
- **The unit or real-IO split** is a text match on each file, not a read of each one.

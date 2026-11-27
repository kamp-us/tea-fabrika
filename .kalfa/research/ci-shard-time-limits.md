---
summary: Why CI's related and next test legs run 9 to 12 minutes, whether they hit their time limits (19 timeouts in 2 weeks, none since 2026-11-15, and pull request 2352's canceled jobs were not timeouts), what the time goes to (a shard cap that is too small, a shard table that has rotted, a few big files), how time-balanced test splitting and timeouts work in Vitest, Jest, CircleCI, Buildkite, Knapsack Pro and Bazel, and a ranked fix list with cost and confidence
---

# Why CI test legs run long, and what to do about it

Question (from the lead session, ticket 2336): on https://github.com/kamp-us/tea-fabrika/pull/2352, run
45947669424 canceled `related (1)`, `related (2)` and `next (3)` of `.github/workflows/check.yaml`. The ask said they
hit a 10-minute `timeout-minutes`. On the green run the same legs took 9m54s, 9m22s and 9m54s. How often does this
happen, what takes the time, what do mature setups do, and what is the right fix here?

Read on 2026-11-27 UTC. Data comes from GitHub's Actions API for this repo, from the `timings-*`, `related-set` and
`results-related-*` artifacts those runs uploaded, from job logs, and from the repo's files at `origin/main`. Outside
sources are the makers' own docs and source.

How to read this file: **Observed** is a number I read from the API, an artifact or a log. **Inferred** is my reading.
**Not run** means I reasoned from code and did not execute it.

## The short answer

1. **The premise is off, and that matters for the fix.** No leg of run 45947669424 hit a time limit. `related (2)` failed
   a real law (`.github/ci/related.test.ts`, "the real script `.agents/skills/mutation/scripts/heartbeat.ts` alone selects
   exactly its declaring tests": expected 57 files, got 95). The job's last step, `stop the run`, then canceled the two
   legs still running. Neither `related` nor `next` has a 10-minute limit: `next` has 17 minutes, a `tooling` related leg
   has 33 minutes (its test step 30). The 10-minute limits are on `check`, `typecheck` and `select`. The green run was
   run 45955794179 on the next commit, not a rerun of the same head.
2. **Real timeouts did happen, and they stopped.** 19 jobs, all `next` legs, hit their 17-minute limit between
   2026-11-12 19:07 and 2026-11-14 19:18 UTC. There has been none since: 0 of 2,086 `next` and `related` jobs from
   2026-11-15 to 2026-11-27. The slowest green job since then was a `next` leg at 780 s (76% of its limit) and a
   `related` leg at 1,051 s (53% of its limit).
3. **The legs are still long, for three reasons that a rows edit does not fix.** (a) 77% of tooling `related` runs since
   2026-11-19 select the whole tooling set (a rerun trigger changed), and that set is split over at most 2 legs, so each
   leg runs about 12 minutes. The planner's own rule asks for about 4 legs and its cap of 2 silently wins.
   (b) The hand-kept shard table has rotted: 363 of 582 test files that run on the merge line have no row and count as
   0.4 s, and nobody has refreshed it since 2026-11-18. On this PR's `next` run the table said the three legs were
   equal (about 460 s each) and they really ran 55 s, 801 s and 1,454 s of tests. (c) A few files set the floor:
   `box.test.ts` alone is 360 to 384 s.
4. **Recommendation.** Raise the tooling leg cap from 2 to 4 now (about 8 lines, 80% sure it brings a full run from
   about 12 to about 7 minutes). Then replace the hand-kept table with timings that CI measures and uploads itself
   (about 200 lines, 65% sure of the design). Split `box.test.ts`. Keep the time limits as they are: a limit is a hang
   alarm, not a planner. Section 5 has costs and doubts.

## 1. How often does it happen

Method (observed). I listed every `check.yaml` run created from 2026-11-12 to 2026-11-27 (4,974 runs; the API returned
none for 2026-11-25). I read the jobs of the 1,255 runs that lasted 8 minutes or more, all attempts, and kept `next` and
`related` jobs (6,727 distinct jobs after removing repeats). A job counts as a timeout only when GitHub's annotation on
it says "The job has exceeded the maximum execution time". I read that annotation for every canceled job that ran
for 90% of its limit or longer (41 jobs).

| Window | Job kind | Jobs | Timed out | Closest green job | Canceled after 9 min or more |
|---|---|---|---|---|---|
| 2026-11-12 to 11-14 | next | about 4,300 | 19 (0.4%) | at the limit | not counted |
| 2026-11-15 to 11-27 | next | 1,058 | 0 | 780 s of 1,020 s (76%) | 22 |
| 2026-11-15 to 11-27 | related (a job since 11-17) | 1,028 | 0 | 1,051 s of 1,980 s (53%) | 100 |

- **The 19 timeouts** were in 18 runs: 13 pull request, 4 push, 2 merge queue jobs. 15 were vitest legs and 4 were
  end-to-end legs. All of them ended before the merge line was cut to the tests a change reaches (pull requests 1242 and
  1266, 2026-11-14). That fits in time; I did not prove it caused the end.
- **No limit was near since then.** No green job was within 60 s of its limit. Four `next` end-to-end legs on
  2026-11-18 ran 1,201 to 1,594 s and one `related` leg ran 1,947 s (limit 1,980 s), and all five were canceled by a bot
  or a newer push, not by the limit (their annotations name a bot cancel, "No files were found", or "a higher priority
  waiting request"). I did not check what limit the end-to-end legs had that day.
- **Long and canceled is common, and it is not a timeout.** I read the first annotation of 40 canceled `related` legs
  that had run 9 minutes or more: all 40 said "The run was canceled by" GitHub's bot. That is either `stop the run`
  (another job failed) or a newer push. By the 9-minute line the ask used: 125 `next` and 503 `related` jobs since
  11-15 ran 9 minutes or more, and 63 and 347 ran 10 or more. None of those sit near a limit.
- **What PR 2352 did.** Attempt 1: `related (2)` failed at 8m27s of tests (507 s) on the law above. `stop the run` canceled
  `next (3)` 14 s later and `related (1)` 22 s later. `next (3)` had already printed "155 passed" at 552 s. Attempt 2 reran
  those jobs and `related (2)` failed at its `tooling` step again, after 10m46s, so that rerun was not green. The new
  head (b8e7c74, "no test under .github imports heartbeat.ts") fixed the law, and run 45955794179 passed:
  `next (3)` 594 s, `related (1)` 594 s, `related (2)` 562 s, `next (2)` 341 s, `next (1)` 91 s.

## 2. What takes the time

### 2.1 Setup against test time (observed)

- A leg spends about 25 to 30 s on setup: checkout 7 to 10 s, the pnpm action 7 to 10 s, install 8 to 12 s. The rest is
  vitest. Vitest's own line for a `related` leg: "Duration 506.97s (tests 96%, import 2%, setup 2%)"; for a `next`
  leg: "552.09s (tests 94%, setup 3%, import 2%, transform 1%)" (job logs of run 45947669424, attempt 1). Setup is
  under 6% of the job, so fewer or faster setups cannot fix a 10-minute leg.

### 2.2 Why PR 2352 ran the whole suite (observed in its `related-set` artifact; code read)

- Its record says `full: true` and `triggers: [".agents/tsconfig.json"]`. A changed `tsconfig*.json` is a rerun
  trigger (`vitest.config.ts`, `forceRerunTriggers`). `related.ts` (line 607) and `legs.ts` (line 277) test a changed
  path against the raw trigger list, and one hit makes the run full: all 207 tooling files and all 346 `next` files.
- The `.github` change was not the driver. Of the 207 tooling files, 48 name `.github/` or `workflows/` and so watch
  every tracked `.github` file (`githubReads` in `vitest.config.ts`). They hold 1,257 of 3,446 file-seconds (36%). A
  `.github`-only change selects that 36% at most, and in a full run they are only part of the load.
- `vitest.changed.ts` already exists to narrow exactly a package's `tsconfig*.json`, `package.json` and lockfile change
  to the tests it reaches (it feeds Vitest's own `--changed`). The two selectors skip it. **Inferred, not run:** with it,
  `.agents/tsconfig.json` would reach the `.agents` package only.
- Wider view (observed, 193 tooling `related` records since 2026-11-19): 148 (77%) were `full`. The triggers in those
  148, counting a run once per kind: `package.json` 93, `oxlint-plugins/**` 85, `.oxlintrc.json` 83, lockfile 57,
  `tsconfig*.json` 49, `layer-rules.json` 42, fixtures 27, `vitest.config.ts` 11. Only 27 of the 148 (18%) had no
  trigger but `tsconfig`, `package.json` or lockfile, the kinds `vitest.changed.ts` narrows. So narrowing helps about 1
  full run in 5. Most full runs are real: a lint rule or a manifest changed.

### 2.3 Capacity: the cap of 2 legs always bites (observed, with code)

- A full run in the 193 records always had exactly 2 tooling legs. Full-run legs took p50 721 s, p90 932 s, max 1,051 s
  of job time. Legs of runs that were not full: p50 409 s, p90 561 s, max 688 s.
- The planner sizes a leg to a budget of 830 s of table seconds (`room(30 min, 70.2 s)`, from `LIMIT_TOOLING`). It
  starts from 1 leg and adds legs up to `MOST_TOOLING`, which `check.yaml` sets to 2. When no count up to the cap fits,
  `fewest` in `.github/ci/legs.ts` returns the count with the shortest longest leg, which is the cap, with no warning.
  The full tooling set is 2,714 table seconds, so the rule's own answer is 4 legs (3.3 rounded up). It gets 2 legs of
  about 1,390 table seconds each, 1.7 times the budget.
- Real file time in the two full-set legs of PR 2352 (attempt 2): 1,624 s and 1,822 s, run by 3 workers each. They
  ended at 564 s and 646 s of test step. The split between the two legs was fair (within 15%). The problem is the
  count of legs, not the balance.

### 2.4 Balance: the hand-kept table has rotted (observed)

- `vitest.shards.json` and `vitest.shards.full.json` were edited by 13 commits from 2026-11-12 to 2026-11-18, and by none
  since (222 commits on main). Of the 582 test files that run on the merge line (the `next`, `tooling` and kalfa
  files; integration and visual files left out), 363 (62%) have no row: kalfa 115 of 117, tooling 202 of 236, next 46
  of 229. A file with no row counts as 0.4 s, the median of the table.
- On PR 2352's `next` run (3 legs, sized to a 240 s budget): the table put 524, 461 and 461 s on legs 1, 2 and 3. The
  real test time was 55 s, 801 s and 1,454 s. Two causes. Leg 1's only file, `QuotaRunner.test.ts`, has a row of
  524 s and really took 55 s (stale row). Legs 2 and 3 held 81 and 80 files with no row, worth 464 s and 961 s of real
  time. Two of those on leg 3 are `kalfa/config/src/SettingGroup.disk.test.ts` (235 to 310 s) and
  `kalfa/git/src/MemoryRepository.test.ts` (214 to 241 s).
- Across runs since 2026-11-19 (observed, first attempts that passed, 158 runs with 2 or 3 `next` legs): the slowest leg is
  a median 2.0 times the fastest (p90 5.5 times, max 7.8 times).
- Hand-moving rows is therefore a treadmill. A file gets a row only after someone reads a leg's time table and copies
  a number into the JSON. The repo grows faster than that happens, and a row goes stale when its file changes
  (`QuotaRunner`).

### 2.5 Which files (observed, `results-related-*` of the full set and `timings-*`)

Counting the 207 tooling files by their CI seconds: the 5 slowest hold 46 to 52% of a leg's file time, the 10 slowest
72%, the 20 slowest 87%.

| Seconds in CI | File | What it is (read from the file) |
|---|---|---|
| 360 to 384 | `.agents/skills/lead/scripts/box.test.ts` | 2,319 lines, 100 tests, 9 process-start calls; no row finer than one file, so it is the floor of any leg it sits on |
| 204 | `boxrm.storage.test.ts` | 246 lines, 69 tests |
| 190 | `loosening.test.ts` | 1,137 lines, 83 `numRuns` or `fc.assert` hits, runs git |
| 161 | `leakgrep.patches.test.ts` | runs git |
| 160 | `.github/ci/workflow-lint/next-job.test.ts` | 186 plant cases |
| 155, 144 | `boxrm.test.ts`, `boxrm.guards.test.ts` | |
| 133 | `.github/ci/workflow-lint/scheduled.test.ts` | 378 tests, mostly plant cases |
| 127 | `oxlint-plugins/plants.test.ts` | 2,020 lines, runs oxlint |
| 122 | `scripts/caps.test.ts` | single tests of 11 to 13 s that start processes |
| 93, 93 | `plancheck.test.ts`, `plancheck.draft.test.ts` | |

In `next`: `SettingGroup.disk.test.ts` (34 tests, 6 to 12 s each, titles end "part 1 of 3") and
`MemoryRepository.test.ts` (39 tests, 5 to 19 s each).

**The plant laws** (`scheduled.test.ts`, `next-job.test.ts` and kin) are a count problem, not a slow-test problem.
Run alone on a laptop at one worker, `scheduled.test.ts` took 49 s and its 378 tests took a flat 115 to 123 ms each
(p10 to p90); the slowest was 1.6 s. Each plant runs `fc.property` with `numRuns: 20` over generated variations of the
whole workflow, and one lint call is 6 ms. So the cost is plants times variations, about 350 times 20 lint runs. The
same file takes 133 s in CI (2.7 times the laptop). The four workflow-lint files and `plants.test.ts` together are about
530 CI seconds, 15% of the full tooling set. I measured only `scheduled.test.ts`; the others are the same shape and
**inferred**.

## 3. What mature setups do

Short version: they measure test time themselves, from earlier runs, and either split by that data or hand out work
while it runs. None of them asks a person to keep a table. A timeout is a kill switch set far above a normal run.

- **Vitest and Jest split by count, not by time.** Vitest: "Vitest splits your _test files_, not your test cases,
  into shards", and `--shard=1/4` on 1,000 files "will run 250 test files, no matter how many test cases individual
  files have"
  ([Vitest, improving performance](https://github.com/vitest-dev/vitest/blob/main/docs/guide/improving-performance.md)).
  In the installed Vitest 5.0.5, `BaseSequencer.shard` hashes each file's path with SHA-1, sorts by that hash and
  slices (`dist/chunks/index.1TqnEahn.js`). `sort` runs files with a cached result longest first, and files without one
  first by size. Jest's sequencer hashes paths the same way
  ([Jest, `jest-test-sequencer`](https://github.com/jestjs/jest/blob/main/packages/jest-test-sequencer/src/index.ts)).
  Vitest lets you plug in your own: `sequence.sequencer` is "a custom class that defines methods for sharding and
  sorting"
  ([Vitest, `sequence`](https://github.com/vitest-dev/vitest/blob/main/docs/config/sequence.md)). That is the hook
  this repo uses in `vitest.shards.ts`, and it is where the hand-kept table plugs in. Neither tool supplies the data.
- **CircleCI splits by timings it collects.** "timing data from the previous test run is used to split a test suite as
  evenly as possible"; "The most recent timings data is always used". The data comes from JUnit XML the job uploads
  ([CircleCI, parallelism](https://circleci.com/docs/guides/optimize/parallelism-faster-jobs/)). The page says the
  first run has no timing data and is silent on how a file with no data is placed (not found).
- **Buildkite's `bktec` does the same, and says what is weak.** It "splits tests automatically based on your
  historical timing data". "First runs, newly added tests, or large changes to the test suite may be less evenly
  balanced". With no match it "uses default duration estimates" and warns. When its service cannot answer, "The local
  fallback is not timing-aware" (an alphabetical round-robin). It splits slow files by example for RSpec, Playwright,
  pytest and Cucumber, and not for Jest or Vitest
  ([Buildkite, test-engine-client README](https://github.com/buildkite/test-engine-client/blob/main/README.md);
  [Buildkite, test splitting](https://buildkite.com/docs/test-engine/test-splitting)).
- **Knapsack Pro hands out work while it runs.** Its API "splits test files between parallel CI nodes based on the
  test execution time of your previous CI runs" and "distributes tests so that each CI node finishes at the same time".
  Each node asks for a batch and keeps asking "as long as there are more tests in the API queue", so a wrong estimate
  costs little. On a network failure it "automatically switches to Fallback Mode" and splits by file name
  ([Knapsack Pro, overview](https://docs.knapsackpro.com/overview/)).
- **Bazel puts the time limit on the test and treats a timeout as a failure.** "The whole test target (not individual
  methods or tests) is given a limited amount of time": short 60 s, moderate 300 s, long 900 s, eternal 3,600 s, with
  the default from `size`. On timeout the runner "may choose to kill" and "must not report a pass". Sharding is the
  author's choice: `shard_count` (at most 50) "will override any heuristics", and the test runner must implement
  `TEST_SHARD_INDEX` and `TEST_TOTAL_SHARDS` ([Bazel, test encyclopedia](https://bazel.build/reference/test-encyclopedia);
  [Bazel, common definitions](https://bazel.build/reference/be/common-definitions)). The docs also say a test that
  finishes well under its limit should use a tighter one. This repo's `slow-test-reporter.ts` is the same idea at
  test level (it fails a test over 50% of its limit).
- **Playwright** documents the same trade: without `fullyParallel` it shards by file, "so uneven file sizes can leave
  some shards with far more tests than others"
  ([Playwright, sharding](https://github.com/microsoft/playwright/blob/main/docs/src/test-sharding-js.md)).
- **GitHub's job limit is a backstop.** `timeout-minutes` defaults to 360, and a step's maximum is 360
  ([GitHub docs, workflow syntax](https://github.com/github/docs/blob/main/content/actions/reference/workflows-and-actions/workflow-syntax.md)).

**Fail or split?** Both, at different places. Mature setups fail a job on timeout (Bazel says it is a failure, and
GitHub cancels the job). They avoid reaching it by planning from measured times (CircleCI, Buildkite) or by pulling
work at run time (Knapsack), and by making the unit smaller when one unit is too big (Buildkite's split by example,
Bazel's `shard_count`). For this repo the planner already runs before the legs start (`select` and the `size` step), so
the plan time is the place to act. The job limit should stay as it is. My reading, not a source's claim.

## 4. What is not the problem

- **The time limits are fine.** Limits of 17 and 33 minutes against real maxima of 13 and 17.5 minutes. The `next`
  limit is the thinner one (1.3 times its slowest green leg). It was sized as twice the largest of 30 jobs on
  2026-11-12 (486 s), and legs have grown since. After the table is fixed that headroom is enough; raising the limit
  would only hide an unbalanced leg.
- **Setup** is under 6% of a leg.
- **The `.github` watch rule** is coarse (any test that names `.github/` watches every tracked `.github` file), but it
  selects at most 36% of the tooling seconds, and the rule was set on purpose ("that over-matches, which reruns a test and
  never misses one"). It is not what made PR 2352 slow.

## 5. Recommendation

Ranked. Each line says why, cost, and how sure.

1. **Raise `MOST_TOOLING` from 2 to 4, and make `fewest` say when it overflows.**
   - Why: the planner's own rule asks for 4 legs on a full set, and 77% of tooling `related` runs are full. The cap
     decides the wall time. By the sums above, 4 legs bring a full run from about 12 minutes to about 7. The floor
     is `box.test.ts` (about 6.5 to 7 minutes with setup) until it is split.
   - Cost: `check.yaml` 1 line, `.github/ci/workflow-lint/related.ts` 1 line (it pins the value 2),
     `.github/ci/related-selection.test.ts` about 4 lines, plus about 15 lines for a warning when the cap wins. 0.5 to
     1 agent hour. Machines: about 70 s more setup per full run (about 5% more machine time); each full run uses 4
     runners for 7 minutes in place of 2 for 12. Four tooling legs plus five integration legs fit the 9-leg cap, and
     integration never runs on the merge line.
   - Confidence: 80% that the wall time falls to 7 or 8 minutes. 90% that no limit is at risk. The doubt is the
     runners: I did not run 4 legs, and the three workers per leg share a 4-core machine.
2. **Replace the hand-kept table with timings CI measures.** Main's scheduled full run already runs every file and
   every leg already uploads per-file seconds (`timings-*`, kept 90 days). Have the scheduled run publish the median of
   its last few runs as one file, have `legs.ts` and `related.ts` read it, and pass each `next` leg its own file list the
   way `related` already does (today each `next` leg re-derives its share from the repo's table, so both sides must
   read the same data). Keep the repo's JSON as the fallback for a run that cannot fetch it. This is CircleCI's design
   and Buildkite's, with Buildkite's own caveat: a new file has no history until one run has measured it. A new
   file still counts as the median. Pair it with a rule that a file over a set time at full depth and with no row fails
   `pnpm lint`, so a new slow file cannot hide.
   - Why: it removes the manual step that rotted. A rows edit only moves the problem: it was done 13 times in a week and
     then not at all.
   - Cost: about 150 to 300 lines across `legs.ts`, `related.ts`, `vitest.shards.ts`, the `next` step of `check.yaml`,
     `scheduled.yaml` and their pinned workflow-lint laws, which are many. 5 to 8 agent hours. A cheaper copy keeps the
     table in git and has a scheduled job open a data-only pull request: about 100 lines and 3 hours, but it adds a
     pull request and a queue slot per refresh. I do not prefer it.
   - Confidence: 65% on the design (it is the common one, and the data exists), lower on the hours because
     workflow-lint pins `check.yaml` line by line.
3. **Make the slow files smaller, which no table can do.**
   - `box.test.ts`: split its 2,319 lines by topic into 3 or 4 files. No behavior change. It lets the legs share its 360
     to 384 s and cuts the floor to about the next file (204 s), so a 4-leg full run could end near 5.5 minutes.
     About 2 to 3 agent hours; it moves lines more than it changes them. Confidence 75%.
   - The plant laws (`scheduled.test.ts`, `next-job.test.ts`, `changes.test.ts`, `merge-line.test.ts`,
     `oxlint-plugins/plants.test.ts`): give each plant 3 generated variations, chosen so the 350 plants together still
     cover the 20, in place of 20 each. The law a plant proves is "this edit is refused", and variation only proves
     the refusal does not depend on unrelated text. About 20 to 40 lines per file, 2 to 4 agent hours. It could save
     about 85% of those files' time, about 13% of a full tooling run (**inferred** from one measured file). Confidence
     60%: it trades some variation coverage, which the owner should accept or reject.
   - `kalfa/config/.../SettingGroup.disk.test.ts` and `kalfa/git/.../MemoryRepository.test.ts` (each 3 to 5 minutes, 34
     and 39 tests of 5 to 19 s): profile which laws cost the time and cut their case counts or split the files. 2 to 3
     agent hours each. Confidence 55%, since I did not read their bodies.
4. **Narrow the rerun trigger for a package's `tsconfig`, `package.json` and lockfile change** by sending both
   selectors through `vitest.changed.ts`, which already does it for Vitest. About 30 to 60 lines in `legs.ts` and
   `related.ts` and two tests, 1.5 to 3 agent hours. It helps about 18% of full runs, so it is a good change and a small
   one. Confidence 65%; **not run**, and I did not check what `.agents/tsconfig.json` reaches.
5. **Keep every time limit as it is.** Do not raise `next`'s 17 minutes or `related`'s 33. If one is wanted, a plan-time
   check is better than a lower limit: the `select` and `size` steps know the planned seconds before any leg starts, so
   they can print a `::warning::` when the longest leg exceeds its room even at the cap. That is item 1's warning.

If only one thing ships: item 1. If two: items 1 and 2. Item 3's `box.test.ts` split is the next best use of an hour
after those.

## 6. What this cannot tell us

- I did not run 4 tooling legs, a split `box.test.ts` or a cut plant law. The wall times above are sums and a model
  (3 workers per leg, balance as seen), not measurements.
- Runs shorter than 8 minutes were not read, since no job in them could reach 8 minutes. Runs created before
  2026-11-12 were not read either, so the 19 timeouts may be the tail of a longer stretch.
- I read annotations only for canceled jobs that ran 90% of their limit. A job canceled earlier could not be a
  timeout. I did not check the end-to-end legs' limit on 2026-11-18.
- Attempt 2's second failure of `related (2)` is read from the step list, not the log. I took it to be the same law.
- Outside pages were read through a fetch tool that returns short excerpts, not whole pages. CircleCI's page does not
  say how a file with no timing data is placed, and Knapsack's page does not say how its first run works. Both are
  "not found", not "absent".
- The 0.4 s count for a file with no row is the median of `vitest.shards.json`'s rows
  (`vitest.shards.ts`'s `guess`). The tooling `related` sizing reads `rowsAt("full")`, which merges the full table; I
  counted rows from the merge of both tables.

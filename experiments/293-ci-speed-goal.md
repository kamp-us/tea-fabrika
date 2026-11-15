---
date: "2026-11-14"
scripts: "The daily measure is committed: .agents/skills/lead/scripts/ci-speed.ts, run by .github/workflows/ci-speed.yaml. The one-off analysis (fetch, step times, waits, the vitest list runs, the model) stayed under runs/ci-goal/ in the worktree and is not committed; every number below names the run or job it came from."
summary: "Can CI hit the owner's speed goal (PR checks 3/5 min, merge queue 3/5, last push to merged 8/15, median/worst 10%) once decisions 0534 and 0535 land? Measured from GitHub's API over 1,000 check runs (2026-11-12 18:41 to 2026-11-14 21:18 UTC), 12,392 jobs and 129 merged PRs. As it stands after 0534 and 0535, no stage is likely to make it: PR checks about 20%, the queue about 10%, last push to merged about 10% (its median is fine; its worst 10% is set by waits outside CI). The long pole of a light next/ PR is no longer the tests a change reaches: it is the 40 reader tests (824 s) that every sized run adds, a few files that stay over 100 s at fast depth, the serial legs job and the 115 s lint chain. Half of the 10 sampled next/ PRs reach 260 or more of next/'s 271 test files through imports, so changed-only does not shrink them. Runner wait is near zero under 10 running jobs and grows to a median 5 to 18 minutes at the cap of 20 with a backlog; 0534 and 0535 cut use from 87% to an estimated 16% of capacity, which should remove it. Five small changes, each named with its effect, take the PR and queue stages to about 85% and 80%; the last stage's worst 10% needs a change in when the lead enqueues, a call for the owner."
---

# 293. CI speed goal: can we hit PR 3 min, queue 3 min, merge 8 min?

**The answer.** This is about today's CI (`.github/workflows/check.yaml`), which serves both
versions. Confidence that each stage meets its goal, median and worst 10%:

| Stage | Goal | Today, last 24 h | After 0534 and 0535 | Confidence then | With the changes below |
|---|---|---|---|---|---|
| PR checks, ready to green | 3 / 5 | 15.4 / 58.0 | about 3.0 / 5.5 | 20% | about 85% |
| Merge queue, entering to merged | 3 / 5 | 52.5 / 167.2 | about 5.4 / 11 | 10% | about 80% |
| Last push to merged | 8 / 15 | 28.2 / 219.7 | about 6 / over 30 | 10% (median alone: 75%) | about 85%, with the enqueue change |

"Today" is `ci-speed.ts`'s own first run, at 2026-11-14 21:40 UTC: 92 merged PRs, 1,039
machine-minutes an hour, 87% of 20 runners. "After" is a model built on the measurements below; it
is a model, not a measurement, and each number says what it rests on. No stage gets above 90% with
0534 and 0535 alone, so each gets the smallest change that closes its gap.

```text
the critical path of a ready next/ pull request run, today (run 43640119575, PR 1244, 2 files changed)
  changes                 0 ->  15 s   checkout 7 s
  legs                   15 ->  49 s   setup 25 s, legs.ts 6 s     (serial: next waits for it)
  check (lint)           15 -> 163 s   setup 25 s, pnpm lint 116 s
  typecheck              15 -> 111 s   setup 28 s, tsc 60 s (cold cache)
  next (1), next (2)     49 -> 410 s   setup 27 s, vitest 321 to 328 s: 41 files, 40 of them reader tests
  ci-required           411 -> 417 s
```

## How this was measured

- **Runs and jobs.** `gh api repos/kamp-us/tea-fabrika/actions/workflows/check.yaml/runs` from
  2026-11-12 18:41 to 2026-11-14 21:18 UTC (1,000 runs, GitHub's cap for one filtered list), then
  `.../actions/runs/<id>/jobs?filter=all` for each, 12,392 jobs. Of these, 9,357 had a runner
  (`runner_name` set); the rest were skipped or canceled before a machine took them, and count
  nothing. Step times are each step's `completed_at` minus `started_at`; runner wait is a job's
  `started_at` minus its `created_at`.
- **Merged PRs.** One GraphQL search for PRs merged since 2026-11-12 21:20 UTC (129), with each
  `AddedToMergeQueueEvent`. A PR's last push is the head of its newest pull request run before it
  entered the queue (or merged), and the push's time is the first run at that head. This is the rule
  `ci/Speed.ts` codes.
- **Changed-only cost.** For 10 merged next/ PRs, in a throwaway worktree at each PR's head:
  `CI=true pnpm exec vitest list next/ --changed=<merge base> --filesOnly --json`, and the same for
  `vitest.e2e.config.ts`, under `nice -n 19`, no test run. File seconds are experiment 291's
  per-file medians of three green full runs (push runs 43630065544 and 43626671924, queue run
  43623078615); test seconds are the same runs' verbose logs.
- **The lint chain.** Each part's time in CI from six green `check` jobs' log timestamps (jobs
  132585687693, 132581823066, 132567333700, 132575843554, 132556853028, 132549321236), and once on
  the laptop, each part alone through Node 26.13.0 (`volta run`), `nice -n 19`, at a load average of
  12 to 15 on 12 cores.

## 1. Step times inside each job, before and after 1243

1243 (blobless checkout, no pnpm store cache, an incremental typecheck) merged at 20:34:56 UTC as
2c7a4e76a. Only about 40 minutes of normal CI ran after it before the sev0 freeze canceled runs, so
"after" has 3 to 19 jobs per row. Seconds, median (worst 10%):

| Job: step | Before 1243 | After 1243 |
|---|---|---|
| runner wait, any job | 18 to 141 (358 to 1,414) | 2 (3) |
| checkout (next, test, changes) | 16 (21) | 6 to 7 (8 to 9) |
| setup-node + pnpm, now `.github/actions/pnpm` | 13 + 4 | 9 (11) |
| `pnpm install --frozen-lockfile` | 4 to 5 | 10 to 11 |
| check: `pnpm lint` | 92 (115) | 115 (116) |
| check: whole job | 135 (154) | 145 (146) |
| typecheck: `pnpm typecheck` | 53 (68) | 60 (71), cache cold |
| typecheck: on 1243's own runs, cache warm | | 14 (18) |
| next: vitest, full leg | 343 (749) | 344 (710), n=8 |
| next: whole job | 460 (821) | 383 (628) |
| tooling tests (`test` job) | 171 (361) | 357 (527), CI-touching PRs |
| changes: whole job | 21 (29) | 12 (17) |

What 1243 changed: a job's setup went from about 38 s (checkout 16, setup 17, install 5) to about
27 s (7, 9, 11). The install is slower without the store, and the checkout is faster. The typecheck
cache only fills from a push to main, and the freeze canceled those, so no "after" run had it warm
yet; on 1243's own runs, with it warm, tsc took 14 s.

**The long pole of a light PR run, once tests are changed-only.** Changed-only already runs on a
ready pull request (1230 and 1235, since 19:04 UTC). Of the 7 sized runs since then, 6 listed all of next/ (271 to 281 files); the CI pull requests
among them did so because a change to `.github/` runs all of next/ until 0534's fix is built. The one light next/ run, 43640119575 for PR 1244, picked 1 changed file and added
the 40 reader tests, 41 files on 2 legs; each leg's vitest took 321 to 328 s. So for a light next/
PR the long pole is **the next legs, and inside them the reader tests**: 824 s of file time, led by
`build.test.ts` (206 s), the four `commits-git-*` exam tests (55 to 97 s each) and
`build-one-file.test.ts` (77 s). For a PR with no next/ tests, the long pole is **the check job**:
setup 25 s plus `pnpm lint` 78 to 116 s.

## 2. Runner wait, by load and by hour

A job's wait against how many Linux jobs of check.yaml were running when it was created (9,190
Linux jobs, macOS left out):

| Running when queued | Jobs | Wait median | Worst 10% | Waited over 60 s |
|---|---|---|---|---|
| 0 to 4 | 976 | 2 s | 3 s | 0% |
| 5 to 9 | 520 | 2 s | 3 s | 1% |
| 10 to 14 | 779 | 3 s | 84 s | 13% |
| 15 to 17 | 874 | 68 s | 1,202 s | 51% |
| 18 to 19 | 3,144 | 282 s | 1,213 s | 80% |
| 20 or more | 2,897 | 39 s | 768 s | 45% |

- **Wait is near zero under 10 running jobs** and starts at about 15. Since 2026-11-13 19:00 UTC,
  every minute with a queued job had 11 to 31 running, mostly 17 to 20: the cap is 20.
- **By hour, wait follows the backlog, not the hour.** The worst hours were 07 to 09 UTC on
  2026-11-14 (wait median 10 to 18 minutes): 19 to 22 jobs running and a mean of 80 to 84 jobs
  queued, up to 120. The same hours a day earlier had 1 to 8 running and none queued. 20 and 21 UTC
  had 680 to 735 jobs an hour but a median wait of 3 to 5 s, at a mean of 18 to 20 running.
- **Not explained:** on 2026-11-12 jobs queued only at 33 to 38 running, and the API shows up to 51
  Linux jobs running at once (2026-11-12 23:58 UTC). Either the limit was higher that day or GitHub
  reported jobs as running after their runner was free. The 20 in the capacity figure is GitHub's
  documented limit of concurrent jobs on the Free plan, and what the last two days show.

## 3. Pushes per PR, and runs per PR

For the 129 PRs merged in the last 2 days. "Pushes" are the distinct heads CI ran on, so two
commits pushed at once count once. A PR whose first run was before 2026-11-12 18:41 is undercounted.

| | PRs | Pushes, median (worst 10%) | PR runs | Queue groups | Queue entries |
|---|---|---|---|---|---|
| through the merge queue | 40 | 1 (11) | 2 (12) | 2 (8) | 1 (3) |
| merged without it (docs) | 89 | 1 (6) | 2 (7) | 0 | 0 |

- The heavy pushers: 1188 had 20 pushes and 21 PR runs, 1104 had 15, 1189 13, 1203 and 1208 11
  each.
- Queue groups are the bigger cost: 1193 had 15 groups (11 red) and 3 queue entries, 1104 10, 1203
  9. In the last 24 hours, 124 queue groups built for 39 merges, 3.2 per merge, and 65 of them were
  red. Experiment 291's failure tags say why: timeouts of real-IO laws on a busy machine
  (`runtime.laws.test.ts` L4, `runtime-recovery.laws.test.ts` L16, `ProgramMailRuntime.test.ts`),
  and a stale or missing shard row.
- A PR run costs little when its head is replaced: 73 of 182 PR runs in experiment 291's window
  were canceled by a newer push. The cost of many pushes is runner time while saturated, not wall
  time for the PR.

## 4. What a changed-only next/ run costs

Seconds of file time (experiment 291's medians) of the files `vitest list --changed` picks at each
PR's head, with the 40 reader tests each sized run adds:

| PR | Files changed | Files `--changed` picks | Their seconds | With readers | Their seconds | e2e files |
|---|---|---|---|---|---|---|
| 1218 | 1 | 1 | 28 | 41 | 853 | 0 |
| 1200 | 4 | 1 | 135 | 41 | 959 | 0 |
| 1244 | 2 | 1 | 235 | 41 | 1,060 | 0 |
| 1228 | 1 | 1 | 235 | 41 | 1,060 | 0 |
| 1192 | 3 | 11 | 1,094 | 51 | 1,918 | 0 |
| 1188 | 99 | 260 | 5,496 | 263 | 5,502 | 0 |
| 1189 | 46 | 261 | 5,496 | 263 | 5,501 | 0 |
| 1187 | 27 | 266 | 5,510 | 266 | 5,510 | 0 |
| 1208 | 33 | 268 | 5,537 | 268 | 5,537 | 9 (647 s) |
| 1203 | 16 | 269 | 5,547 | 269 | 5,547 | 0 |

- **The distribution is two humps, not a slope.** Half the PRs reach 1 to 11 files; the other half
  reach 260 to 269 of next/'s 271, because they touch a module most of next/ imports
  (libfabrika's runtime, processes, ledger). Changed-only saves nothing on those.
- **The readers are the floor of a light PR:** 824 s, more than the changed files themselves in 4
  of the 5 light PRs.
- **Today, in wall time** (the model in section 6, checked against run 43640119575): the light PRs
  run 6.2 to 7.0 minutes and the heavy ones 10.4 to 12.0.

## 5. The lint chain

Seconds per part of `pnpm lint`, in CI (six green check jobs, range) and once on the laptop:

| Part | CI | Laptop |
|---|---|---|
| `code-graph --unreachable` (lint:dead) | 36.9 to 55.1 | 51.0 |
| `promise-types.ts` (with tokens, stylelint) | 18.5 to 32.0 | 26.6 + 0.8 |
| shard-rows + oxlint | 12.2 to 18.4 | 0.3 + 12.3 |
| `code-graph --layers` | 4.0 to 5.7 | 4.2 |
| `code-graph --boundaries` | 3.8 to 5.3 | 4.3 |
| the rest (skillscheck, workflow-lint, oxfmt, versions, reach, browser, compiler, twin) | 2.4 to 3.6 | 3.2 |
| **whole step** | **77.6 to 116.7** | **103.3** |

The parts read files and write nothing another part reads, so any of them can run beside any other.
The laptop's run is the slower of the two kinds here because the machine was loaded (load 12 to 15).

```text
critical path if split
  as 3 jobs     A: lint:dead                       37 to 55 s
                B: promise-types, compiler, twin   20 to 34 s
                C: oxlint, oxfmt, layers, boundaries and the rest   22 to 33 s
                each job adds its 25 s setup: path about 60 to 80 s, about 0.8 machine-min more a run
  in one job    the same parts at once on the runner's 4 cores: path about lint:dead, 40 to 60 s,
                no extra machine (a guess: oxlint takes all 4 cores for its 12 to 18 s)
  today         one after another: 78 to 117 s
```

So the check job goes from about 145 s to about 85 s either way. The one part that sets the path
is `lint:dead`. Running the parts at once inside the job is the smaller change: no new job, no new
runner, no new required check.

## 6. The model, after 0534 and 0535

**PR checks.** A ready run's path is `changes` (15 s), then the slowest of `check` (145 s),
`typecheck` (45 s warm) and `legs` (35 s) followed by the next legs, then `ci-required` (6 s), plus
about 2 s a hop. A leg's vitest time is modeled as `max(longest file, files' sum / 3) * 1.38`: 3
workers, and 1.38 is what run 43640119575 took over that ideal. 0535's effect is modeled by
scaling each unlabeled test (a law) of 3 s or more by `k` with a 1 s floor; the decision's sketch
says 10 cases on the merge line against 100 on the schedule, so `k = 0.1` if every heavy law ran
100 cases today, and more where a law already runs few (some run 20). `k = 0.2` is the central
case; 0.1 and 0.4 bound it.

```text
next/ PR run, minutes, over the 10 PRs of section 4     median   worst 10%   next legs, machine-min a run
A  today                                                 10.4      12.0       36.8
B  0535, k = 0.2                                          4.8       5.5       11.0
   0535, k = 0.4 / 0.1                                    5.1/4.6   6.0/4.8
C  B + lint parts at once in the check job                4.8       5.5       11.0
D  C + legs sizing inside the changes job                 4.2       5.0       11.0
E  D + a leg budget of 60 s, up to 10 legs                4.1       4.1       27.4
F  E + no test file over 60 s at fast depth               2.1       2.6       16.5
G  F with k = 0.4                                         2.3       3.3       22.6
```

- After 0535 the slowest files at fast depth are `instance-wire.test.ts` (135 s),
  `instance-records.test.ts` and `Runner.test.ts` (105 s each) and `RepositoriesGit.test.ts` (91 s).
  A file runs on one worker, so no leg finishes before its slowest file: that is why D and E stall
  at 4 minutes and F drops to 2.
- A PR with no next/ test (docs, tooling, skills) runs `changes` + `check` + `ci-required`: about
  2.9 minutes today, about 1.9 with the lint parts at once. In the last 24 hours about two thirds of
  merged PRs were of this kind, so the all-PR median sits on the 3-minute line and the worst 10% is
  the next/ PRs.
- A lead-tooling PR runs the tooling tests it reaches; on CI-touching PRs that was 357 s (n=4) after
  1243. This model does not cover it, and it can be the long pole of such a PR.

**Merge queue.** The queue now holds only code PRs; docs PRs are admin-merged. A group runs the PR's
selection over the group's diff (0534), so its time is about a PR run's. Today, of 32 PRs with a
green group: entering to the group's start was 0.3 minutes median (99.8 worst 10%), the group 22.8
(54.0), and green to merged 5.8 (83.9). The last is the queue's order: with `HEADGREEN` and 2 builds
at once, a green group waits for the one ahead to merge. After 0534 and 0535, with groups about as
long as model B: a median of about 0.3 + 4.8 + 0.3 = 5.4 minutes, and a worst 10% of about one
rebuild more, 11 minutes, set by a red group ahead or a flaky law.

**Last push to merged.** For a code PR it is PR checks, then green to entering the queue (0.6
minutes median, 119 worst 10%), then the queue. Docs PRs merged 4.4 minutes median after their last
push. 23 of 128 PRs (18%) waited over 10 minutes outside CI: 7 of 40 queued PRs entered the queue
over 10 minutes after green, and docs PRs waited for the admin merge (the gap's worst 10% was 33
minutes). That alone puts the worst 10% past 15 minutes whatever CI does.

**Capacity at today's PR rate**, per day, from the last 24 hours' counts (127 ready PR runs with
tests, 114 draft runs, 238 runs that skipped every heavy job, 39 merges through the queue, 34 pushes
to main with tests):

```text
                         runs a day   machine-min each   a day
ready PR runs               127         19 (half if canceled)   2,050
queue groups              39 x 1.5      19                      1,110
draft runs                  114          4.1                      470
runs with no heavy job      238          0.8                      190
pushes to main               34          2 (only what the queue did not test)  70
schedule, 0534 and 0535       8         70 (all of next/ at full depth, tooling tests)  560
mutation, 0535                8         30 (unmeasured on a runner)  240
total                                                         4,690  = 195 an hour, 16% of 20 runners
today, measured by ci-speed.ts                                24,936  = 1,039 an hour, 87%
```

The 19 machine-minutes of a ready run are changes 0.5, field 0.6, check 2.4, typecheck 1.0, legs
0.6, ci-required 0.1, next legs 11.0 (model B's mean) and about 3 of tooling tests; 1.5 groups a
merge (from 3.2) assumes fail fast (1256) and fewer flaky reds. With change F the next legs cost
16.5 a run, which brings the total to about 230 an hour, 19%. At 16 to 19%, about 3 to 4 jobs run on
average, and section 2 says wait stays at 2 to 3 s under 10 running; bursts (a ready run starts up
to 10 jobs) reach 10 to 14, where the worst 10% waited 84 s.

## 7. What blocks each stage, and the smallest change that closes it

**PR checks (20% now).** Blocked by the next legs on a next/ PR (the reader tests and four files
over 90 s at fast depth) and the 115 s lint chain on every PR.

1. Run `pnpm lint`'s parts at once inside the check job, one Node runner over the parts, path set
   by `lint:dead`: check job about 145 to 85 s. A PR with no next/ test: about 2.9 to 1.9 minutes.
2. Size the legs inside the `changes` job, which already holds the diff, and drop the `legs` job:
   35 s off the path of every next/ PR.
3. Lower the leg budget to about 60 s of file time, up to 10 legs: the budget is a setting
   (`legs.ts`'s `budget`, from `next`'s timeout), 0069.
4. Split the files still over 60 s at fast depth (`instance-wire`, `instance-records`, `Runner`,
   `RepositoriesGit` today), or move their slowest tests to the schedule under 0535's rule.

With all four, next/ PRs model at 2.1 to 2.3 minutes median and 2.6 to 3.3 worst 10% (F and G), for
16.5 to 22.6 machine-minutes of legs a run. Confidence about 85%: the 1.38 factor comes from one
run, and `k` is a guess until 0535 lands. One sized run after 0535, read with ci-speed.ts, settles
both.

**Merge queue (10% now).** Blocked by a group costing as much as a PR run, and by a red group ahead
costing one more.

5. Let a group pass at once when its tree is the tree a green ready PR run already tested, the same
   check 1258 makes for a push to main. A PR's run tests `refs/pull/<n>/merge`, which has the
   tree a squash onto the same main gives. When main has not moved since that run, the group needs
   only `changes` and `ci-required`, about 30 s. At 1.6 merges an hour and a PR run of about 3 to 5
   minutes, main moves inside that span for about 1 PR in 8, so about 7 in 8 single-entry groups
   would pass at once. The rest run changes 1 to 4. Expected: a median under 1 minute, a worst 10%
   about a PR run, 3 to 4 minutes. Confidence about 80%: the 7 in 8 assumes PRs enter one at a time;
   a batch of entries makes each later group a new tree. Counting the share of groups whose base is
   the base their PR's run tested settles it.

**Last push to merged (10% now; its median alone 75%).** The CI changes above bring a code PR's
median to about 1 + 2 + 1 = 4 minutes. Its worst 10% is set by the 18% of PRs that waited over 10
minutes outside CI.

6. The lead enqueues a code PR, and admin-merges a docs PR, the moment it is green: the lead's
   read of the diff starts when the PR is marked ready, not when its checks end. That is a change to
   how the lead works, so it is the owner's call; `Queue.ts` refuses to arm auto-merge on a red or
   unfinished head on purpose, so the plain auto-merge setting is not the fix. With it and 1 to 5:
   about 4 minutes median and 8 to 10 worst 10%, confidence about 85%.

## The daily measure

`.agents/skills/lead/scripts/ci-speed.ts` prints the three stages over the last 24 hours, the
machine-minutes an hour and the share of 20 runners, and flags each stage over its goal.
`.github/workflows/ci-speed.yaml` runs it daily at 16:00 UTC and by hand, writes it to the job
summary, and keeps one `ci-scheduled` issue titled "CI speed" open while any stage is over its goal.

```text
$ node .agents/skills/lead/scripts/ci-speed.ts
## CI speed, the last 24 hours

92 pull requests merged. Minutes, median and worst 10%.

| Stage | PRs | Median | Worst 10% | Goal | |
|---|---|---|---|---|---|
| PR checks, ready to green | 81 | 15.4 | 58.0 | 3 / 5 | **over** |
| Merge queue, entering to merged | 39 | 52.5 | 167.2 | 3 / 5 | **over** |
| Last push to merged | 91 | 28.2 | 219.7 | 8 / 15 | **over** |

Runners: 1039 machine-minutes an hour, 87% of 20 machines.
```

That run made about 800 API calls in 2 minutes 40 seconds, one per run for its jobs. A workflow's
token gets 1,000 calls an hour per repository (GitHub's docs, "Rate limits for the REST API"), so on
a day with more than about 950 runs it would be refused. After 0534 the run count does not drop;
if it nears the limit, running the measure twice a day over 12 hours each halves the calls.

## What this cannot tell us

- The "after" columns are a model. Only 3 to 19 jobs ran after 1243 before the freeze, and no run
  has yet run 0534's or 0535's selection or depth.
- The leg model's 1.38 factor is from one run (43640119575). Full runs fit it loosely: the model
  says 574 s a heavy job against a measured median of 460 s and worst 10% of 821 s.
- `k`, the speedup of a heavy law at fast depth, is a guess bounded by 0.1 and 0.4. A law whose
  time is mostly setup (a workerd start, a clone) will not scale with its case count.
- The tooling tests' cost on a lead-tooling PR is not modeled.
- The 10 sampled PRs are all next/ code PRs merged on one day; the two humps may not hold for other
  weeks' work.
- Why the API shows more than 20 jobs running at once on 2026-11-12 is not known.
- The merged-PR set counts docs PRs, which never enter the queue; a stage's median moves with how
  many of those merge that day.

## What has landed since, as of 2026-11-14 evening

The measurements above are as they were taken. Main has since built some of the modeled changes,
so the "today" job shapes in sections 1 and 6 are out of date. From `git log origin/main`:

- **0534's selection** landed in [pull request 1266](https://github.com/kamp-us/tea-fabrika/pull/1266):
  the merge queue and main run only the next/ tests a change reaches, and a schedule runs all of
  next/ and the tooling tests every 3 hours. The same pull request did change 2: `changes` sizes the
  legs, and the `legs` job is gone.
- **Change 1, lint parts at once:** landed in
  [pull request 1281](https://github.com/kamp-us/tea-fabrika/pull/1281).
- **Change 3, a leg budget:** a budget setting landed in
  [pull request 1290](https://github.com/kamp-us/tea-fabrika/pull/1290), at 240 s, not the 60 s
  modeled here, and a run of the reader tests alone starts one leg.
- **Change 4, the slow files:** not done as a split. Three of the four files named are now
  real-resource tests (`instance-wire`, `instance-records` and `Runner`, each
  `*.integration.test.ts`), which pull requests and the merge queue no longer run
  ([pull request 1278](https://github.com/kamp-us/tea-fabrika/pull/1278), decision 0536).
  `RepositoriesGit.test.ts` still runs on the merge line.
- **Change 5, a group a ready run already tested:** landed in
  [pull request 1283](https://github.com/kamp-us/tea-fabrika/pull/1283).
- **Change 6, the enqueue timing:** not landed. Decision 0540
  ([pull request 1288](https://github.com/kamp-us/tea-fabrika/pull/1288)) sets the queue's order,
  not when the lead enqueues.
- **The tooling tests** are off the merge line: check.yaml's `test` job is gone
  ([pull request 1289](https://github.com/kamp-us/tea-fabrika/pull/1289), decision 0539). Section 1's
  `test` job row and section 6's "about 3 of tooling tests" in a ready run's 19 machine-minutes no
  longer apply.
- **0535's fast depth**, the `k` of section 6, has not landed: its pull request,
  [1274](https://github.com/kamp-us/tea-fabrika/pull/1274), is still open.
- Also on main since: a lockfile, tsconfig, package.json or shard table change runs only the tests
  it reaches ([pull request 1287](https://github.com/kamp-us/tea-fabrika/pull/1287)), and every
  test leg writes a time table ([pull request 1282](https://github.com/kamp-us/tea-fabrika/pull/1282)).

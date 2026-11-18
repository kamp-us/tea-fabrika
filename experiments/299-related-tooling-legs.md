---
date: "2026-11-18"
scripts: "related-legs.ts, on the branch fabrikalfa/ci-related-tooling-legs-script at experiments/299-related-legs.ts. It reads job rows fetched with the GitHub MCP list_workflow_jobs call and prints the per-run lines, the split rule and the medians below. The fetched rows stayed in a scratch folder and are not committed (0027)."
summary: "Today's CI; about $11 at list price. Should the related job get more tooling legs (MOST_TOOLING is 2)? Not on this evidence. Of the 7 first-attempt runs since decision 0598 whose related legs all finished, the split rule fires in 1, so it cannot reach 7 of 10. A tooling leg finishes last in every run, and the tooling pair is the biggest part of every wall time. What sets the slowest runs apart from the median is runner wait: median 24 s on the critical path, but 209 and 357 s in the two slowest groups, and a median of 88 s (max 522 s) across 49 legs of canceled runs. That wait is the organization's runners, which decision 0598 said were not the bottleneck. Only 2 complete runs carry the refreshed shard rows of PR 1588."
---

# 299. Does today's related job need more tooling legs, or is the long tail queue wait?

**The answer.** This is about today's CI (`.github/workflows/check.yaml`, the `select` and
`related` jobs), which serves both versions. Do not raise `MOST_TOOLING` on this evidence. The
delivery lane's rule fires in 1 of the 7 first-attempt runs that finished their related legs since
decision 0598 merged. Even if the next 3 runs all fired it would be 4 of 10, short of 7. A tooling
leg finishes last in every run, and the tooling pair's run time is the biggest part of every wall
time. But what makes the slowest runs slower than the median run is runner wait: 209 and 357 s on
the last leg of the two slowest groups, against 24 s in the median run. Runner wait is also a
finding against decision 0598's premise, below.

```text
the rule (from the delivery lane's plan), per run:
  fires  when the leg that finished last is a tooling leg
         and it waited 60 s or less (started_at - created_at)
         and it ran 120 s or more longer than the longest integration leg (completed_at - started_at)
  split  only if it fires in 7 of 10 runs or more

result: 7 first-attempt runs whose related legs all finished green, 4 of them with both kinds of leg
        fires in 1 (pull request run 44223515842, gap 124 s)
        an 8th complete run is a rerun after a red leg; it fires only because a rerun starts on a free queue
        best case with 3 more runs: 4 of 10. The rule does not fire.
```

## How this was measured

- **Runs.** Every `pull_request` and `merge_group` run of `check.yaml` created after decision 0598
  merged (PR https://github.com/kamp-us/tea-fabrika/pull/1590, `92f5f416b`, whose push run on main
  was made at 2026-11-18 02:05:12 UTC), to 03:23 UTC, from GitHub's run list for the workflow: 59
  runs. When the list was read, 30 had ended green and 29 canceled. A newer push or a queue rebuild
  canceled most of them, but at least 1 (https://github.com/kamp-us/tea-fabrika/actions/runs/44221238262, whose `lint`
  step failed) canceled itself after a failure. check.yaml's `stop the run` step (line 256) turns a
  red job into a cancel of the whole run.
- **Jobs.** For each run, the GitHub MCP `list_workflow_jobs` call with `filter: latest`, which
  gives each job's `created_at`, `started_at`, `completed_at` and its steps. A related leg is a job
  named `related (<n>)`. Its kind is the step that ran: `tooling` or `integration` (the other one
  is skipped, `check.yaml` lines 583 to 605).
- **Wait and run time.** A leg's queue wait is `started_at - created_at`: the time from GitHub
  making the job to a runner taking it. Its run time is `completed_at - started_at`. The related
  group's wall time is the last leg's `completed_at` minus the earliest leg's `created_at`. All
  legs of one run are made in the same second, when `select` ends, so the wall time is the last
  leg's wait plus its run time. "Wait on the critical path" is the wall time minus the longest
  leg's run time: what a zero wait would have saved at most.
- **Which runs carry PR 1588's rows.** PR https://github.com/kamp-us/tea-fabrika/pull/1588
  (`f1540a31`) refreshed `vitest.shards.full.json`, the rows `related.ts` sizes the legs with. It
  landed on main at 02:58:46 UTC (its push run,
  https://github.com/kamp-us/tea-fabrika/actions/runs/44227117291); its commit date, 02:38:47, is
  when its queue group was built. A pull request run tests its merge with main as main was when the
  run was made, so a pull request run made after 02:58:46 carries the rows; none of the complete
  ones was. A queue run carries them when its group's head is `f1540a31` or a later main commit:
  runs 44224819283 and 44226178362. Marked `new` and `old` below.
- **The rerun.** Run https://github.com/kamp-us/tea-fabrika/actions/runs/44220866167 is attempt 2.
  In attempt 1 its legs were made at 02:10:37 and waited 74 to 250 s (tooling leg 7: 198 s); then
  leg 4's `integration` step failed and fail-fast canceled legs 1, 6 and 7. Attempt 2 reran only
  those 4 legs, which waited 1 to 2 s. GitHub keeps the 3 passing attempt-1 legs (2, 3, 5) under
  the attempt-2 `created_at`, so they show a start before their creation. The run is shown in the
  table but left out of the rule and the medians: its 1 s wait is the wait of a rerun on a free
  queue, not of a first push.
- **Canceled runs.** A leg in a canceled run that never got a runner shows `started_at` equal to
  `created_at` and no steps. Those 6 legs are not wait samples and are left out: run 44226855247
  legs 1, 3, 4 and 6, which sat 274 s before the cancel, and run 44226343932 legs 1 and 2, which
  sat 105 s. Run https://github.com/kamp-us/tea-fabrika/actions/runs/44227373843 was rerun after
  the run list was read. Its one attempt-2 leg, made at 03:25:30, is outside the window and left
  out, and its 6 attempt-1 legs drop by the start-before-creation rule above.

```ts
// The shape of one fetched row (a related leg) and what the script derives from it. A sketch.
type Leg = {
  run: string // "44226178362"
  name: string // "related (7)"
  conclusion: "success" | "cancelled" | "in_progress"
  project: "tooling" | "integration" | "none" // the step that ran
  created: number // epoch seconds
  started: number
  completed: number
}
const wait = (l: Leg) => l.started - l.created // 209
const time = (l: Leg) => l.completed - l.started // 839
// gap: the last leg's run time minus the longest integration leg's run time
// run 44226178362: 839 - 448 = 391, but the last leg waited 209 s, so the rule does not fire
```

## Per run

Eight runs finished every related leg green. The other 22 green runs had no related legs: their
pull request was a draft, or the change reached no integration or tooling test. Legs are written
`<leg><t or i> <wait>/<run time>` in seconds, `t` for tooling and `i` for integration.

| Run | Event, rows | Legs (wait/run, s) | Last leg | Wall, s | Gap, s | Rule |
|---|---|---|---|---|---|---|
| https://github.com/kamp-us/tea-fabrika/actions/runs/44220866167 | pull request, old, rerun | 1i 2/576, 4i 2/394, 6t 2/643, 7t 1/839 | 7, tooling | 840 | 263 | not counted |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44222237649 | queue, old | 1i 106/375, 2i 99/449, 3i 111/486, 4i 91/504, 5i 74/558, 6t 17/601, 7t 108/622 | 7, tooling | 730 | 64 | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44223094104 | pull request, old | 1t 2/451, 2t 5/270 | 1, tooling | 453 | none | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44223515842 | pull request, old | 1i 5/481, 2i 30/417, 3i 10/395, 4i 10/506, 5i 2/366, 6t 45/579, 7t 22/630 | 7, tooling | 652 | 124 | fires |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44224393251 | queue, old | 1t 24/395, 2t 2/268 | 1, tooling | 419 | none | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44224644441 | queue, old | 1t 2/443, 2t 2/356 | 1, tooling | 445 | none | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44224819283 | queue, new | 1i 318/588, 2i 429/507, 3i 411/553, 4i 486/397, 5i 203/592, 6t 357/670, 7t 321/637 | 6, tooling | 1027 | 78 | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44226178362 | queue, new | 1i 165/448, 2i 188/418, 3i 180/319, 4i 172/377, 5i 164/443, 6t 226/535, 7t 209/839 | 7, tooling | 1048 | 391 | no |

"Gap" is `none` where a run had only tooling legs: the rule needs an integration leg to compare
with, so it cannot fire there. In those 3 runs the two tooling legs differ by 87 to 181 s, a
balance question inside the pair, not a count question. Run 44226178362 is the closest miss: its
tooling leg ran 391 s past the longest integration leg and failed the rule only on its 209 s wait.

## Medians and p90

Across the 7 first-attempt complete runs: 14 tooling legs and 20 integration legs. Percentiles are
nearest rank, so with 7 runs the p90 of a per-run number is its largest value, the single worst
run.

```text
                         median    p90    max   (seconds)
tooling       wait          23     321    357
tooling       run time     557     670    839
integration   wait       137.5     411    486
integration   run time   448.5     558    592
related group wall time    652    1048   1048
last leg's wait             24     357    357   (= wait on the critical path, in all 7 runs)

legs that got a runner in the 9 canceled runs with related legs: 49
              wait          88     462    522
```

The two numbers to hold side by side: the tooling pair's run time is the biggest term in every
wall time (median 557 s, against 448.5 s for integration), and runner wait is small in the median
run (24 s) but adds 3.5 to 6 minutes in the slowest 2 of 7. The wait is the biggest difference
between the median run and the slowest ones, not the biggest part of any one wall time.

## What queue wait costs after 0598

Decision 0598 took the merge line's `next`, `select` and `related` legs out of the shared
`scheduled-*` job groups, so they no longer wait behind main's full run or a branch proof for a
group slot. Its context says the organization's runners were not the bottleneck, the locks were
(`.decisions/0598-merge-line-leaves-scheduled-groups.md`). These numbers walk part of that back:

- **What is left to wait on is runner supply.** In check.yaml the `related` job has no job-level
  `concurrency` and `max-parallel: 9`, so a leg that is made waits for nothing but a runner. Legs
  still waited up to 486 s in complete runs, and up to 522 s (integration, run
  https://github.com/kamp-us/tea-fabrika/actions/runs/44224771569 leg 1) and 462 s (tooling, run
  https://github.com/kamp-us/tea-fabrika/actions/runs/44228089955 leg 6) in canceled ones.
- **The whole run waits at once.** In 4 of the 7 complete runs every leg started within 45 s. In
  the other 3, all queue runs, nearly every leg waited: 17 to 111 s (run 44222237649, 02:19 UTC, 6
  of its 7 legs 74 s or more), 203 to 486 s (run 44224819283, 02:40 UTC) and 164 to 226 s (run
  44226178362, 02:52 UTC).
- **The tail is the same size as before 0598.** On run
  https://github.com/kamp-us/tea-fabrika/actions/runs/44201566907, before 0598, tooling 6 waited
  447 s and integration legs up to 331 s. After it, the worst tooling wait is 462 s and the worst
  integration wait 522 s.
- **The cost.** After 0598, queue wait costs the related job about 0.4 minutes in the median run
  and about 6 minutes in the worst run of 7, and it falls on the queue runs, which hold the merge
  line.

A guess, not measured: the slow queue runs share the organization's runners with main's own runs,
which under 0598 still take up to 5 `scheduled-main` slots, and with branch proofs, which take up
to 4 more. Main's full run of `ad93a08f` (scheduled.yaml,
https://github.com/kamp-us/tea-fabrika/actions/runs/44226175684) was made at 02:50:36, 111 s
before run 44226178362's legs were made at 02:52:27. In the 10 minutes before run 44224819283, 11
pull request and queue runs were made, plus main's push runs of `9a716504` at 02:32:07, among them
its full run (https://github.com/kamp-us/tea-fabrika/actions/runs/44223971922). What would settle it: count the running jobs of all workflows at each slow leg's
`created_at`, from every run's job list in that window.

## What the numbers say to do

- **No tooling split.** The rule does not fire. A third tooling leg would cut the tooling pair's
  run time, but in the queue runs that set the tail, the 209 to 357 s wait would stay, and one more
  leg asks for one more runner from the same pool.
- **The tooling pair's balance is worth one look.** In 2 of the 7 counted runs, and in the rerun,
  the two tooling legs differ by 181 to 304 s. Run 44226178362, the newest one and on PR 1588's
  rows, ran them at 535 and 839 s; run 44223094104 at 270 and 451 s; the rerun at 643 and 839 s. A
  better split of the same two legs might close that gap. It is a sizing question for `legsOf` and
  its rows, which the rule here does not measure: 3 samples cannot tell a bad row from one slow file
  on one runner.
- **Measure again on PR 1588's rows.** Only 2 complete runs carry them. Rerun the script once 10
  complete first-attempt runs on `f1540a31` or later exist.
- **The runner wait goes back to 0598's owner.** 0598 assumed the runners were not the bottleneck;
  this window says they are, at least in the tail. A change to how many runners the merge line may
  take is a design call, not this lane's.

How sure: about 95% that the rule does not fire for this window, since 3 more runs cannot lift 1 of
7 to 7 of 10. About 60% that the wait tail is the merge line sharing the runner pool with main's
runs, branch proofs and other check runs; that is a guess until the running-job count above is
taken.

## Cost

The work ran as Claude Code agents on a subscription. Dollars are what the tokens would cost at
Anthropic's list price (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-18):
Claude Sonnet 5.5 at $2 per million input tokens, $10 output, $0.10 cache reads and $2.50
five-minute cache writes; Claude Opus 5.5 at $4, $20, $0.20 and $5.

| Run | Model | Calls | Tokens in (cache read, cache write, plain) | Out | List price |
|---|---|---|---|---|---|
| Fetch jobs of 19 green runs | Claude Sonnet 5.5 | 8 | 898,071, 137,614, 16 | 6,697 | $0.50 |
| Fetch jobs of 29 canceled and new runs | Claude Sonnet 5.5 | 10 | 1,381,948, 218,361, 20 | 13,035 | $0.81 |
| Review of this write-up and its recheck | Claude Opus 5.5, effort high | 27 | 3,613,377, 363,749, 58 | 35,884 | $3.26 |
| Lead session (fetch, script, write-up, fixes), to the commit that filled this row | Claude Opus 5.5 | 78 | 18,687,174, 272,288, 155 | 70,509 | $6.51 |

All four come to $11.08. The lead session's calls after this row (watching CI, landing) are not counted. No Jev call and no paid API call ran. GitHub Actions minutes are not counted: nothing was run on
CI for this write-up.

## What this cannot tell us

- **Seven runs, not ten.** Only 7 first-attempt runs since 0598 finished every related leg; the
  brief asked for at least 10. The verdict holds anyway (1 of 7 cannot become 7 of 10), but the
  medians rest on 7 runs, and the p90 of a per-run number is the single worst run.
- **Two runs on the new rows.** 5 of the 7 counted runs sized their legs with the rows from before
  PR 1588. What PR 1588's rows do to the tooling pair's balance is not known from 2 runs.
- **Which files went in which leg.** The `related-set` artifact names them per run; it was not
  read. So this cannot say why one tooling leg ran 839 s, or whether a third leg would split the
  long files.
- **Why the runner pool was full.** The wait is measured; its cause is a guess. Running-job counts
  across workflows were not taken.
- **The rerun's first attempt is left out.** Run 44220866167's 7 attempt-1 legs (waits 74 to 250
  s) are not in the medians or the canceled-run sample; they would raise both.
- **Run time includes setup.** A leg's run time is the whole job: checkout, pnpm install and the
  test step. Outside the test step a leg spends 30 to 55 s, median 36.5 s, across the 38 legs of the
  green runs (for example, run 44226178362 leg 7: job 839 s, `tooling` step 801 s). Setup varies by
  about 25 s, so it can shift a gap by that much. On step times the one run that fires, run
  44223515842, has a gap of 127 s, so its verdict holds.
- **One hour of one evening.** All 59 runs fall between 02:07 and 03:23 UTC on 2026-11-18, during
  a sev 1 with many agents pushing. A quieter hour could show less wait and the same tooling
  times.

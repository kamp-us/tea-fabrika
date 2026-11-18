---
date: "2026-11-18"
scripts: "related-legs.ts, on the branch fabrikalfa/ci-related-tooling-legs-script at experiments/299-related-legs.ts. It reads job rows fetched with the GitHub MCP list_workflow_jobs call and prints the per-run lines, the split rule and the medians below. The fetched rows stayed in a scratch folder and are not committed (0027)."
summary: "Today's CI; about $3 at list price. Should the related job get more tooling legs (MOST_TOOLING is 2)? Not on this evidence. Of the 8 runs since decision 0598 whose related legs all finished, the split rule fires in 2, so it cannot reach 7 of 10. A tooling leg finishes last in all 8, but in the 5 runs with both kinds the tooling leg ran 64 to 391 s longer than the longest integration leg, and the 2 runs with the largest wall times lost 209 and 357 s to runner wait on the leg that finished last. Queue wait is still a long tail after 0598: median 23 s on the critical path, p90 357 s; across 11 canceled runs' 56 started legs, median 77 s, p90 427 s. Only 2 complete runs carry the refreshed shard rows of PR 1588."
---

# 299. Does today's related job need more tooling legs, or is the long tail queue wait?

**The answer.** This is about today's CI (`.github/workflows/check.yaml`, the `select` and
`related` jobs), which serves both versions. Do not raise `MOST_TOOLING` on this evidence. The
delivery lane's rule fires in 2 of the 8 runs that finished their related legs since decision 0598
merged, and even if the next 2 runs both fired it would be 4 of 10, short of 7. A tooling leg does
finish last in every one of the 8 runs, so the tooling pair sets the related job's end. But what
makes the long runs long is mostly something else: runner wait (209 and 357 s on the last leg of
the two longest groups), and in 3 of 8 runs a gap between the two tooling legs (181 to 304 s)
that a better split of the same two legs would close.

```text
the rule (from the delivery lane's plan), per run:
  fires  when the leg that finished last is a tooling leg
         and it waited 60 s or less (started_at - created_at)
         and it ran 120 s or more longer than the longest integration leg (completed_at - started_at)
  split  only if it fires in 7 of 10 runs or more

result: 8 runs whose related legs all finished green, 5 of them with both kinds of leg
        fires in 2 (both pull request runs from before PR 1588's rows)
        best case with 2 more runs: 4 of 10. The rule does not fire.
```

## How this was measured

- **Runs.** Every `pull_request` and `merge_group` run of `check.yaml` created after decision 0598
  merged (PR https://github.com/kamp-us/tea-fabrika/pull/1590, `92f5f416b`, on main at
  2026-11-18 02:05:09 UTC), to 03:23 UTC: 59 runs, from GitHub's run list for the workflow. 30 ended
  green, 29 canceled (a newer push or a queue rebuild canceled them). None failed.
- **Jobs.** For each run, the GitHub MCP `list_workflow_jobs` call with `filter: latest`, which
  gives each job's `created_at`, `started_at`, `completed_at` and its steps. A related leg is a job
  named `related (<n>)`. Its kind is the step that ran: `tooling` or `integration` (the other one
  is skipped, `check.yaml` lines 585 to 605).
- **Wait and run time.** A leg's queue wait is `started_at - created_at`: the time from GitHub
  making the job to a runner taking it. Its run time is `completed_at - started_at`. The related
  group's wall time is the last leg's `completed_at` minus the earliest leg's `created_at`. All
  legs of one run are made in the same second, when `select` ends, so the wall time is the last
  leg's wait plus its run time. "Wait on the critical path" is the wall time minus the longest
  leg's run time: what a zero wait would have saved at most.
- **Which runs carry PR 1588's rows.** PR https://github.com/kamp-us/tea-fabrika/pull/1588
  (`f1540a31`, on main at 02:38:47 UTC) refreshed `vitest.shards.full.json`, the rows `related.ts`
  sizes the legs with. A pull request run tests its merge with main as main was when the run was
  made, so a pull request run made after 02:38:47 carries the rows. A queue run carries them when
  its group sits on `f1540a31` or a later main commit. Marked `new` and `old` below.
- **Reruns.** Run 44220866167 is attempt 2. GitHub keeps the legs that passed in attempt 1 under
  the attempt 2 `created_at`, so they show a start before their creation. Those 3 legs (2, 3, 5)
  did not run in attempt 2 and are left out; the attempt-2 legs (1, 4, 6, 7) are kept. Their
  attempt-1 integration run times (363 to 404 s) are all shorter than the 576 s attempt-2
  integration leg, so the run's verdict does not change either way. The same rule drops 6
  attempt-1 legs of canceled run 44227373843.

```ts
// The shape of one fetched row (a related leg) and what the script derives from it. A sketch.
type Leg = {
  run: string // "44226178362"
  name: string // "related (7)"
  conclusion: "success" | "cancelled" | "in_progress"
  project: "tooling" | "integration" | "none" // the step that ran
  created: number // epoch seconds; started, completed the same
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
| https://github.com/kamp-us/tea-fabrika/actions/runs/44220866167 | pull request, old | 1i 2/576, 4i 2/394, 6t 2/643, 7t 1/839 | 7, tooling | 840 | 263 | fires |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44222237649 | queue, old | 1i 106/375, 2i 99/449, 3i 111/486, 4i 91/504, 5i 74/558, 6t 17/601, 7t 108/622 | 7, tooling | 730 | 64 | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44223094104 | pull request, old | 1t 2/451, 2t 5/270 | 1, tooling | 453 | none | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44223515842 | pull request, old | 1i 5/481, 2i 30/417, 3i 10/395, 4i 10/506, 5i 2/366, 6t 45/579, 7t 22/630 | 7, tooling | 652 | 124 | fires |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44224393251 | queue, old | 1t 24/395, 2t 2/268 | 1, tooling | 419 | none | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44224644441 | queue, old | 1t 2/443, 2t 2/356 | 1, tooling | 445 | none | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44224819283 | queue, new | 1i 318/588, 2i 429/507, 3i 411/553, 4i 486/397, 5i 203/592, 6t 357/670, 7t 321/637 | 6, tooling | 1027 | 78 | no |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44226178362 | queue, new | 1i 165/448, 2i 188/418, 3i 180/319, 4i 172/377, 5i 164/443, 6t 226/535, 7t 209/839 | 7, tooling | 1048 | 391 | no |

"Gap" is `none` where a run had only tooling legs: the rule needs an integration leg to compare
with, so it cannot fire there. In those 3 runs the two tooling legs differ by 87 to 181 s, which
is a balance question inside the pair, not a count question.

## Medians and p90

Across the 8 runs: 16 tooling legs, 22 integration legs (after the 3 attempt-1 legs left out).
Percentiles are nearest rank.

```text
                         median    p90    max   (seconds)
tooling       wait        19.5    321    357
tooling       run time     590     839    839
integration   wait       108.5    411    486
integration   run time   448.5    576    592
related group wall time    691    1048   1048
last leg's wait             23     357    357   (= wait on the critical path, in all 8 runs)

legs that started in the 11 canceled runs with related legs: 56
              wait          77     427    522
```

The two numbers to hold side by side: the tooling pair's run time is the biggest term in every
wall time (median 590 s, against 448.5 s for integration), and runner wait is small in the median run
(23 s) but adds 3.5 to 6 minutes to the slowest 2 of 8.

## What queue wait costs after 0598

Decision 0598 took the merge line's `next`, `select` and `related` legs out of the shared
`scheduled-*` job groups, so they no longer wait behind main's full run or a branch proof for a
group slot. It did not add runners. The numbers say the wait left in the tail is a runner wait,
not a group wait:

- In 5 of the 8 complete runs, every leg started within 45 s. In the other 3, all queue runs,
  nearly every leg of the run waited: 17 to 111 s (run 44222237649, 02:19 UTC, six of its seven legs 74 s or more), 203 to 486 s (run
  44224819283, 02:40 UTC) and 164 to 226 s (run 44226178362, 02:52 UTC). A whole run waiting at
  once is what a full runner pool looks like; a group wait would hold legs one by one.
- The canceled runs show the same tail: 56 legs that started, median 77 s, p90 427 s, max 522 s.
- Before 0598, on run https://github.com/kamp-us/tea-fabrika/actions/runs/44201566907, tooling 6
  waited 447 s and integration legs up to 331 s. After it, the worst leg waits are 486 s
  (integration) and 357 s (tooling). The tail has the same size.
- So after 0598, queue wait costs the related job about 0.4 minutes in the median run and about
  6 minutes in the worst 10%, and it falls on the queue runs, which hold the merge line.

A guess, not measured: the two slow queue runs both ran while main's full run of a commit just
merged was going (`ad93a08f` reached main at 02:35, `f1540a31` at 02:38, `87e9b95` at 02:41). 11
other check runs were made in the 10 minutes before run 44224819283, but only 2 before run
44226178362, so the count of new check runs alone does not explain the second one. Under 0598 main's full run still takes up to 5 runners of the
same organization pool. What would settle it: count the running jobs of all workflows at each
slow leg's `created_at`, from every run's job list in that window.

## What the numbers say to do

- **No tooling split.** The rule does not fire. A third tooling leg would cut the tooling pair's
  run time, but in the queue runs that set the tail, the 209 to 357 s wait would stay, and one more
  leg asks for one more runner from the same full pool.
- **The tooling pair's balance is worth one look.** In run 44226178362, the newest one and on PR
  1588's rows, the two tooling legs ran 535 and 839 s; in run 44220866167, 643 and 839 s. A 304 s
  gap inside a pair is a sizing question for `legsOf` and its rows, which the rule here does not
  measure. That is a separate measure, not a finding: two samples cannot tell a bad row from one
  slow file on one runner.
- **Measure again on PR 1588's rows.** Only 2 complete runs carry them. Rerun this script once 10
  complete runs on `f1540a31` or later exist.

How sure: about 95% that the rule does not fire for this window, since 2 more runs cannot lift 2
of 8 to 7 of 10. About 60% that the wait tail is runner-pool use by main's full run and the other
check runs; that is a guess until the running-job count above is taken.

## Cost

The work ran as Claude Code agents on a subscription. Dollars are what the tokens would cost at
Anthropic's list price (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-18):
Claude Sonnet 5.5 at $2 per million input tokens, $10 output, $0.10 cache reads and $2.50
five-minute cache writes; Claude Opus 5.5 at $4, $20, $0.20 and $5.

| Run | Model | Calls | Tokens in (cache read, cache write, plain) | Out | List price |
|---|---|---|---|---|---|
| Fetch jobs of 19 green runs | Claude Sonnet 5.5 | 8 | 898,071, 137,614, 16 | 6,697 | $0.50 |
| Fetch jobs of 29 canceled and new runs | Claude Sonnet 5.5 | 10 | 1,381,948, 218,361, 20 | 13,035 | $0.81 |
| Lead session (fetch, script, write-up) | Claude Opus 5.5 | see below | see below | see below | see below |
| Review of this write-up | Claude Opus 5.5, effort high | see below | see below | see below | see below |

No Jev call and no paid API call ran. GitHub Actions minutes are not counted: nothing was run on
CI for this write-up.

## What this cannot tell us

- **Eight runs, not ten.** Only 8 runs since 0598 finished every related leg; the brief asked for
  at least 10. The verdict holds anyway (2 of 8 cannot become 7 of 10), but the medians and p90s
  rest on 8 runs, and the p90 is the second-largest of 8.
- **Two runs on the new rows.** 6 of the 8 runs sized their legs with the rows from before PR 1588.
  What PR 1588's rows do to the tooling pair's balance is not known from 2 runs.
- **Which files went in which leg.** The `related-set` artifact names them per run; it was not
  read. So this cannot say why one tooling leg ran 839 s, or whether a third leg would split the
  long files.
- **Why the runner pool was full.** The wait is measured; its cause is a guess. Running-job counts
  across workflows were not taken.
- **Run time includes setup.** A leg's run time is the whole job: checkout, pnpm install and the
  test step. Outside the test step a leg spends 30 to 55 s, median 36.5 s, across the 38 legs of the
  green runs (for example, run 44226178362 leg 7: job 839 s, `tooling` step 801 s). The rule compares jobs with jobs, so the
  setup cancels out of the gap.
- **One hour of one evening.** All 59 runs fall between 02:07 and 03:23 UTC on 2026-11-18, during
  a sev 1 with many agents pushing. A quieter hour could show less wait and the same tooling
  times.

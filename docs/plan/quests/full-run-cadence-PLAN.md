Approved by the lead agent, builds 0581, 0534, 0536, 0069, 0175; body d750e3e3b402
Plancheck-Version: 3

```yaml
# .github/workflows/scheduled.yaml, sketch: the whole idea.
on:
  push: { branches: [main] }          # every push to main asks
  schedule: [{ cron: "17 * * * *" }]  # the hourly catch-up, minute 17 as before
  workflow_dispatch:                  # by hand, on main or a branch: unchanged
env:
  GAP_MINUTES: 60                     # the setting (0581, 0069): no full run on main starts sooner
concurrency: { group: scheduled, queue: max, cancel-in-progress: false }  # unchanged
jobs:
  gate:   { steps: [checkout .github/ci, "node .github/ci/gate.mjs"] }   # says start=true or false
  tests:  { needs: [gate], if: "needs.gate.outputs.start == 'true'" }    # the 9 legs, unchanged
  report: { needs: [gate, tests], if: "always() && needs.gate.outputs.start != 'false'" }
```

# Full-run cadence: main's full run starts on a push or an hourly catch-up, at most once an hour

ticket: 1071

Writer: the plan step. Version: today's CI tooling (`.github/`), serving both versions, plus the
sev skill's words. `next/` product code is not touched.

Base read: `origin/main` at `82296f5cf` (decision 0581 merged). Every line cited is read there.

Builds [0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md), which amends
[0534](../../../.decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md) and
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) in part. Reads
[0175](../../../.decisions/0175-every-run-follows-its-paths.md),
[0069](../../../.decisions/0069-choices-are-settings.md),
[0539](../../../.decisions/0539-the-merge-line-runs-no-tooling-tests.md),
[0541](../../../.decisions/0541-ci-speed-has-a-goal-and-a-daily-check.md) and
[0542](../../../.decisions/0542-two-sev-levels-one-skill.md), and pull requests
https://github.com/kamp-us/tea-fabrika/pull/1380 (`queue: max`, and the missing schedule slots) and
https://github.com/kamp-us/tea-fabrika/pull/1383 (one matrix, a red run ends `failure`).

## The answer first

**The gate is a job inside `scheduled.yaml`, as 0581 draws it, not a second workflow that
dispatches the first.** I weighed both (below). The one property that decides it: the bound in
0581 is about when a run *starts*, and only a gate that runs while its own run holds the
`scheduled` group sees every earlier run already finished. It reads, decides and starts the tests
in one step of the group, so two pushes can never both start a run. A dispatching workflow decides
outside the group, so it sees only when runs were *asked for*, and a run that waited 40 minutes
behind branch runs would start minutes after the next one it allowed. 80% sure. What would change
it: if the probe runs show a skipped run costs much more than about 30 seconds of the group.

The five things the brief asked the plan to settle:

| Question | Answer |
|---|---|
| How the gate starts the run | A `gate` job in `scheduled.yaml`, first in the run. The `tests` job needs it and runs only when it says `start=true`. No second workflow, no dispatch, no `actions: write` |
| How the gate asks the API | `GET /repos/{repo}/actions/workflows/scheduled.yaml/runs` with `branch=main&status=completed`, and the same with `head_sha=<head>`, then each candidate's `GET /actions/runs/{id}/jobs?filter=latest`. The workflow's own token with `actions: read`, which it has today (SC3 does not change). It reads runs of every event, never only `schedule` ones, since GitHub fired 3 of the 8 due slots (pull request 1380) |
| How "main's head has had no full run" is read | No run of `scheduled.yaml` on main at `GITHUB_SHA` whose `tests` legs ran and which did not end `cancelled` |
| The report and the `ci-scheduled` issue on a skipped run | The report job does not run, so the issue is left exactly as it was. The run ends `success` with only the gate green (the probe confirms it). `lastGreen` in `scheduled.mjs` learns to step over such runs, so the issue's commit range stays right |
| How a push storm stays at one run an hour | The `scheduled` group runs one run at a time, first in, first out (`queue: max`). Each push's gate runs only once every earlier run is done, and reads when the last full run started. Inside the hour it says `false`, and its run ends in about 30 seconds |

## How others do it

- **GitHub's documented way to skip work in a run** is a job output read in a later job's `if`
  ("Passing information between jobs", and "Using conditions to control job execution": a skipped
  job reports success). That is the shape here. Not fetched this session; it is the pattern
  check.yaml's `changes` job already uses for every other job.
- **GitHub's concurrency docs** ("Control the concurrency of workflows and jobs", fetched): "there
  can be at most one running job or workflow in a concurrency group at any time"; `queue: max`
  lets up to 100 wait; when the queue is full, more runs are canceled. Job-level concurrency on a
  matrix applies to each leg, so moving the group from the workflow to the `tests` job would run
  the nine legs one by one; the group stays at the workflow level.
- **GitHub's schedule docs** ("Events that trigger workflows", schedule, fetched): a schedule "can
  be delayed during periods of high loads", high load "includes the start of every hour", and "some
  queued jobs may be dropped". Our own record agrees: of 8 due slots, GitHub made 3 runs, two of
  them 60 to 90 minutes late (pull request 1380's table, and `gh run list --event schedule`:
  43685571638 at 06:28, 43734956911 at 16:20, 43771306886 at 22:48). So the push is the main
  trigger, the catch-up only fills gaps, and neither the gate nor any law trusts that a schedule
  slot fired.
- **The other way, a separate gate workflow that dispatches `scheduled.yaml`:** GitHub's
  `GITHUB_TOKEN` docs (fetched) say events it causes start no run, except `workflow_dispatch` and
  `repository_dispatch`. The dispatch endpoint needs `actions: write` (the fine-grained permissions
  table, fetched) and answers 200 with `workflow_run_id` (the REST page, fetched). Weighed below.
- **The industry's name for the rule** is a throttle with a leading edge: act on the first event,
  then ignore events until the gap has passed (lodash `throttle`, RxJS `throttleTime`). Jenkins'
  "quiet period" and Buildbot's `treeStableTimer` are the other kind, a debounce, which waits for
  the pushes to stop; 0581 asks for the throttle. Not fetched.
- **Elm and OTP:** not a machine and not a process tree. Nothing to follow beyond keeping the
  deciding part pure: `decide` takes what the reader read and returns a tagged answer, as
  `scheduled.mjs`'s `decide` does.

### The two ways, weighed

| Property | Gate job in `scheduled.yaml` (picked) | Separate workflow that dispatches |
|---|---|---|
| The one-an-hour bound | Exact: the gate reads real start times, with every earlier run finished | Reads request times; a run that waited in the group starts later than counted, so two can start minutes apart |
| Two pushes at once | Cannot both start: the group runs one gate at a time, and its tests run in the same slot | Needs its own group, and a run it dispatched must already show in the list when the next gate reads |
| Token | `actions: read`, as today; nothing can cancel a run (SC3 holds as written) | `actions: write`, which can cancel runs: the thing SC3 exists to keep out |
| Runner time per push | One small job, about 30 s | The same, one small job |
| The `scheduled` group | Every push's run waits its turn and holds the group about 30 s | Only real full runs enter it |
| Readers of the run list | A skipped run is a `success` run of `scheduled.yaml` on main; `lastGreen` and the gate step over it | Every run is a real full run; no reader changes |
| Where the setting lives | In `scheduled.yaml`, beside the cron line, as 0581 says | In the gate workflow, so 0581's text would need amending |

The cost I accept: a push storm adds about 30 s of group time per push, in front of branch runs.
At about 30 merges a day that is about 15 minutes a day. The probe runs measure the real number.

## The shape

### The gate's deciding part

`.github/ci/gate.mjs`, a plain `.mjs` with JSDoc types, run on the runner's own Node with no
install, as `scheduled.mjs` is. A pure core and a thin reader.

```js
// .github/ci/gate.mjs, sketch.

/**
 * What the gate read: the newest full run on main, and whether main's head has had one.
 * `last.at` is when that run left the queue: the earliest `started_at` of its jobs.
 * @typedef {{
 *   event: "push" | "schedule" | "workflow_dispatch",
 *   now: number,              // ms
 *   gap: number,              // minutes, GAP_MINUTES
 *   last: { id: number, sha: string, at: number } | null,
 *   tested: boolean,          // the head has had a full run that did not end cancelled
 * }} Seen
 */

/**
 * @typedef {{ _tag: "start", reason: "by_hand" | "due" }
 *         | { _tag: "skip", reason: "tested" | "too_soon" }} Decision
 */

/** @param {Seen} seen @returns {Decision} */
export const decide = ({ event, now, gap, last, tested }) => {
  if (event === "workflow_dispatch") return { _tag: "start", reason: "by_hand" };
  if (tested) return { _tag: "skip", reason: "tested" };
  if (last !== null && now - last.at < gap * 60_000) return { _tag: "skip", reason: "too_soon" };
  return { _tag: "start", reason: "due" };
};
```

- One rule for both triggers. On a push the head is the push's new commit, so `tested` is false
  and only the hour counts, as 0581 says for a push. On the catch-up both count: 0581's binding
  constraint ("No full run on main starts within an hour of the last one, except by hand") holds
  the cron too.
- By hand is `workflow_dispatch`, on main or a branch: it always starts, so hand-started branch
  runs, the lead's `Arm` check and the sev skill's `gh workflow run scheduled.yaml --ref main` work
  as today. A hand start on main still counts as the last full run for the next gate.
- A canceled full run counts for the hour (it did start) but not for the head (it proved nothing).
  So after a sev0's freeze cancels main's run, the next catch-up past the hour runs that head again
  by itself. 75% sure; the other reading would leave the head untested until the next push.

### What a full run is

A run of `scheduled.yaml` is a full run when its jobs list holds a leg named `tests (<shard>)`.
GitHub lists a skipped matrix job as one job named `tests`, with no shard, so a skipped run never
matches. This lives in `scheduled.mjs` beside `jobsOf`, which already reads the jobs answer, and
the gate imports it.

```js
// .github/ci/scheduled.mjs, sketch.
/** Whether a run's jobs show its test legs ran: a leg `tests (<shard>)` exists. */
export const isFull = (/** @type {readonly Job[]} */ jobs) => jobs.some((job) => /^tests \(.+\)$/.test(job.name));
```

### The reader

```js
// .github/ci/gate.mjs, sketch. The job's own token, actions: read. Each call has a 10 s limit and
// is tried 3 times, 2 s and 4 s apart; a third failure fails the step.
// 1. newest full run on main:
//    GET actions/workflows/scheduled.yaml/runs?branch=main&status=completed&exclude_pull_requests=true&per_page=100
//    walk newest first; for each run: GET actions/runs/{id}/jobs?filter=latest&per_page=100
//    stop at the first isFull run -> last = { id, sha: head_sha, at: min(jobs.started_at) }
//    none in the 100 -> last = null
// 2. the head:
//    GET actions/workflows/scheduled.yaml/runs?branch=main&head_sha=$GITHUB_SHA&status=completed&per_page=100
//    tested = some run there with conclusion != "cancelled" whose jobs are isFull
//    (skipped on workflow_dispatch: decide does not read it)
// 3. write `start=true` or `start=false` to $GITHUB_OUTPUT, and one line to $GITHUB_STEP_SUMMARY
```

- `status=completed` leaves out this run itself and every run waiting behind it. Every run ahead
  of it in the group has finished, so nothing is missed.
- `branch=main` leaves out every hand-started branch run: their head branch is the branch.
- The workflow file's name comes from `GITHUB_WORKFLOW_REF`, as `scheduled.mjs`'s `github` reads
  it, so a throwaway copy of the workflow reads its own runs.
- The walk is short: one jobs call per skipped run since the last full run, plus one. A day of a
  quiet main is 24 skipped catch-ups, so 25 calls at most. The page of 100 is the cap.

**When the gate cannot read GitHub,** after its third try, the step fails, so `start` is empty.
The tests do not run, and the report does (`!= 'false'`): it judges the run red, names the gate's
failed step, and opens or comments on the `ci-scheduled` issue. A gate that is broken for good
then shows as a sev1 instead of quietly running no full run ever again. 75% sure; the cost is that a
GitHub outage longer than the three tries opens a sev1, which the next green full run closes. The
other choice, starting the run when the gate cannot read, breaks 0581's bound during an outage.

### The workflow

```yaml
# .github/workflows/scheduled.yaml, sketch of the changed parts.
on:
  push:
    branches: [main]
  # The hourly catch-up (0581), at minute 17: GitHub delays and drops runs queued at the top of the
  # hour ("Events that trigger workflows", schedule). It starts a run only on a head that has had none.
  schedule:
    - cron: "17 * * * *"
  workflow_dispatch:

# The gap (0581, 0069): no full run on main starts within this many minutes of the last one, except
# by hand. At least 60, 0581's binding constraint. The gate job reads it; change this line to change it.
env:
  GAP_MINUTES: 60

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    outputs:
      start: ${{ steps.decide.outputs.start }}
    steps:
      - uses: actions/checkout@v7
        with:
          sparse-checkout: .github/ci
          persist-credentials: false
      - id: decide
        name: gate
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: node .github/ci/gate.mjs

  tests:
    needs: [gate]
    if: needs.gate.outputs.start == 'true'
    # ...unchanged...

  report:
    needs: [gate, tests]
    if: always() && needs.gate.outputs.start != 'false'
    # ...unchanged...
```

`GAP_MINUTES` sits at the workflow level, the block right under `on:`, so it is next to the cron
line as 0581 asks. Every job sees it; only the gate reads it. 80% sure it is the right place; the
other place, the gate step's own `env`, is further from the cron line.

### `lastGreen`

`scheduled.mjs`'s `lastGreen` asks for main's newest `success` run. A skipped run is a `success`
run now, so it would name the wrong commit range. It walks the same list, newest first, and takes
the first `success` run that `isFull`, with the same jobs call. Nothing else in `scheduled.mjs`
changes: on a skipped run the report never starts.

### Who else reads these runs

| Reader | What changes |
|---|---|
| `scheduled.mjs` `report` | Nothing; it runs only when the gate said start or failed. Its `needs` now holds `gate` too, which `verdict` reads like any job |
| `scheduled.mjs` `lastGreen` | Steps over skipped runs (above) |
| `Arm.ts` and `land.ts` (the lead's merge check) | Nothing: they read branch runs, which are all by hand, so the gate starts the tests and is one more green job |
| The sev freeze (`Freeze.ts`) | Nothing: it cancels unfinished runs not on an allowed branch, push and catch-up runs included. After a sev0, the next push or catch-up starts main's run by itself; the hand start the script prints still works |
| `ci-speed.ts` | Nothing: its stages read `check` runs |

## One value traced through

Main on a busy afternoon, `GAP_MINUTES: 60`, times in UTC. The last full run started at 13:02.

1. 14:05, push `a1`. Its run waits in the group behind a branch run until 14:20. The gate reads:
   last full run 13:02, 78 minutes ago. `decide` gives `start, due`. The tests start at 14:20.
2. 14:10, push `b2`. Its run waits behind `a1`'s run (FIFO). At 14:41 its gate reads: last full
   run started 14:20, 21 minutes ago. `skip, too_soon`. The run ends at 14:41, report skipped. The
   open issue, if any, is untouched.
3. 14:17, the catch-up cron (if GitHub fires it). Head is `b2`. At 14:42 its gate reads: no full
   run at `b2`, and the last one started 22 minutes ago. `skip, too_soon`.
4. 15:17, the catch-up again. Head `b2`, still untested; last start 14:20, 57 minutes ago.
   `skip, too_soon`.
5. 16:17, the catch-up. Head `b2`; last start 117 minutes ago. `start, due`. `b2` is tested.
6. 16:30, a person runs `gh workflow run scheduled.yaml --ref main`. `start, by_hand`, at once.

Step 5 shows the worst case: a head that lands just after a full run starts waits for the second
catch-up, up to about 2 hours, when no other push comes and GitHub fires the cron on time. A
dropped cron makes it longer. A later push makes it shorter. Still better than 0534's 3 hours, but
not "within the hour" for every head; see [What this cannot tell us](#what-this-cannot-tell-us).

## Laws

The workflow laws stay in `.github/ci/workflow-lint/scheduled.ts`, as SC1 to SC13 are, and are
held by `scheduled.test.ts` beside it: the real workflow with what does not change its meaning
varied, and each plant applied alone. Lint, type or test: each workflow law is a lint law
(`pnpm lint` runs `workflow-lint.ts`) whose own test is generated, so its cell says test. The gate's
and `lastGreen`'s laws are tests of their `.mjs` files, in the `tooling` project.

The generator in `scheduled.test.ts` changes: it no longer varies the cron line freely (0581 fixes
it hourly). It varies the cron's minute (1 to 59), `GAP_MINUTES` (60 to 1440), the group name, the
legs at once and `if` spacing.

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| SC1 (changed): `on` holds exactly `push` with `branches: [main]` and nothing else under it, one `schedule` whose cron is hourly at a minute from 1 to 59 (`M * * * *`), and `workflow_dispatch` | test | fc.tuple: the real workflow with the varied minute, gap, group, legs and spacing; 100 runs | Each alone: cron `17 */3 * * *`; cron `0 * * * *`; `paths-ignore` under `push`; `push` dropped | `.github/ci/workflow-lint/scheduled.test.ts` | lint, and the full run |
| SC14 (new): a job `gate` with no `needs` and no `if`; its one `run` step has `id: decide`, runs `node .github/ci/gate.mjs`, and has env exactly `GITHUB_TOKEN`; the job's `outputs` is exactly `start: ${{ steps.decide.outputs.start }}`; its checkout is sparse on `.github/ci` | test | fc.tuple: as SC1; 100 runs | Each alone: the gate `needs: [tests]`; its output read from another step; its step without the token | `.github/ci/workflow-lint/scheduled.test.ts` | lint, and the full run |
| SC15 (new): `tests` has `needs: [gate]` and `if: needs.gate.outputs.start == 'true'`, spaced any way | test | fc.tuple: as SC1; 100 runs | Each alone: `tests` with no `if`; `if: needs.gate.result == 'success'` | `.github/ci/workflow-lint/scheduled.test.ts` | lint, and the full run |
| SC5 (changed): the report needs `gate` and `tests` and runs on `always() && needs.gate.outputs.start != 'false'`; the gate's step joins the report step and the time tables as the only steps that get the token | test | fc.tuple: as SC1; 100 runs | Each alone: report `if: always()` (a skipped run would judge and close the issue); the token on the gate's checkout | `.github/ci/workflow-lint/scheduled.test.ts` | lint, and the full run |
| SC6 (changed): the jobs are `gate`, `tests` and `report`, and the machines at once, counted per step of the `needs` chain (a matrix its `max-parallel`, any other job 1, jobs at the same depth added), are at most 10 | test | fc.tuple: as SC1; 100 runs | `tests` without `needs` and `max-parallel: 10`, so it runs beside the gate: 11 | `.github/ci/workflow-lint/scheduled.test.ts` | lint, and the full run |
| SC16 (new): the workflow's `env` is exactly `{ GAP_MINUTES: n }`, `n` a whole number of at least 60 (0581's binding constraint) | test | fc.tuple: as SC1, with the gap drawn from 60 to 1440; 100 runs | Each alone: `GAP_MINUTES: 30`; `GAP_MINUTES: "1h"`; the value moved to the gate step's env | `.github/ci/workflow-lint/scheduled.test.ts` | lint, and the full run |
| SC2, SC3, SC12: unchanged; the gate keeps the workflow's read-only token, and `concurrency` stays `group: scheduled`, `queue: max`, `cancel-in-progress: false` | test | fc.tuple: as SC1; 100 runs | `permissions: { actions: write }` on the gate | `.github/ci/workflow-lint/scheduled.test.ts` | lint, and the full run |
| G1: `decide` starts every `workflow_dispatch`; on push and schedule it skips when `tested`, skips when `now - last.at` is under the gap, and starts otherwise; it never throws | test | fc.record: event, now, gap 60 to 1440, `last` null or a time either side of the gap edge, `tested`; 200 runs | Compare with `<=` so a run exactly one gap after the last is skipped | `.github/ci/gate.test.ts` | the full run |
| G2: in a model of the group (one slot, first in first out), any sequence of pushes, catch-ups and hand starts at generated times gives starts where no two non-hand starts on main are less than the gap apart, and, when every cron fires, every head that stays main's head gets a full run within one gap plus 60 minutes plus the wait for the runs ahead of it | test | fc.array: 1 to 60 events with times, event kinds and run lengths of 5 to 40 minutes; 200 runs | Read `last.at` as the run's creation time, not its start | `.github/ci/gate.test.ts` | the full run |
| G3: the reader asks exactly the two run lists (`branch=main`, `status=completed`, the second with `head_sha` of `GITHUB_SHA`) and one jobs call per run walked, stops at the first full run, takes `last.at` as the earliest job start, and counts a run at the head only when it is full and not `cancelled` | test | fc.array: generated run lists of skipped, full, canceled and branch runs with their jobs, over a fake `fetch`; 100 runs | Each alone: drop `branch=main`, so a branch run counts; count a canceled run at the head as tested | `.github/ci/gate.test.ts` | the full run |
| G4: [secrets] the token goes only in the `authorization` header: it is in no URL (as written and URL-encoded), no `GITHUB_OUTPUT` line, no summary line and no error message | test | fc.string: generated tokens, with characters that URL encoding changes; scanned in every request, both files and the thrown error; 100 runs | Put the token in the URL as `?access_token=` | `.github/ci/gate.test.ts` | the full run |
| G5: a call that fails is tried 3 times; after the third failure the step exits non-zero and writes no `start` line, and after a success it writes exactly one `start=true` or `start=false` | test | fc.array: per call, a generated sequence of failures (status 500, 403, a timeout) and successes; 100 runs | Write `start=true` when the reader fails | `.github/ci/gate.test.ts` | the full run |
| L1: `isFull` is true exactly when a job named `tests (<shard>)` is in the list; `lastGreen` returns the newest `success` run on main whose jobs are full, stepping over skipped ones, or null when none of the 100 is | test | fc.array: generated success runs, each skipped (one job `tests`, skipped) or full (legs `tests (1)` and so on), with their jobs answers over a fake `fetch`; 100 runs | Keep today's `lastGreen`, which takes the first `success` run | `.github/ci/scheduled.test.ts` | the full run |
| L2: the sev script's full-run line no longer says "3-hour" | test | format: the sev script's line for a freeze that canceled main's run, as 0581 words it | Keep "start the 3-hour full run by hand" | `.agents/skills/sev/scripts/Incident.test.ts` | the merge line and the full run |
| P1: the run's conclusion on GitHub, from probe runs of a throwaway copy of `scheduled.yaml` on a branch: a run whose gate said `false` ends `success` with `tests` and `report` skipped; a run whose gate step failed ends `failure`, with the report run and red | test | scenario: two `workflow_dispatch` runs of a copy whose gate prints a fixed answer, as pull request 1383's probe runs were made | The copy's report on `if: always()`, which must then run on the skipped run | the probe runs' ids, written into `scheduled.yaml`'s comment beside the gate | once, before the first review |

P1 is not a host-only law: it runs on GitHub's runners, never on the owner's Mac, so 0178's wait
does not apply. It is a measurement, as pull request 1383's five probe runs were. The tests step
starts it, and the build step writes the run ids into the workflow's comment.

## Files

| File | Change | Product lines expected | Owner |
|---|---|---|---|
| `.github/workflows/scheduled.yaml` | Triggers, `GAP_MINUTES`, the `gate` job, the `needs` and `if` lines, the top comment's 3-hour wording and table | 45 | tests |
| `.github/ci/gate.mjs` | New: `decide`, the reader, the output and summary lines | 150 | tests |
| `.github/ci/gate.test.ts` | New: G1 to G5 | tests | tests |
| `.github/ci/scheduled.mjs` | `isFull`; `lastGreen` steps over skipped runs; the header's 3-hour wording | 25 | tests |
| `.github/ci/scheduled.test.ts` | L1 | tests | tests |
| `.github/ci/workflow-lint/scheduled.ts` | SC1, SC5, SC6 changed; SC14, SC15, SC16 new | 80 | tests |
| `.github/ci/workflow-lint/scheduled.test.ts` | The generator's new varied parts; plants for SC1, SC5, SC6, SC14 to SC16 | tests | tests |
| `.github/ci/workflow-lint/issues.ts` | Comment: "the 3-hour run's report" becomes the full run's | 1 | tests |
| `.github/workflows/check.yaml` | Comments only, lines 31 and 403: the full run starts on a push or the hourly catch-up (0581) | 3 | tests |
| `.github/workflows/ci-speed.yaml` | Comment only, line 7 | 1 | tests |
| `.github/ci/changes.mjs` | Comment only, line 241 | 1 | tests |
| `.github/**` | The exam's folder: every file changed there is its own row above | 0 | tests |
| `.github/`, `.github/ci` | The same folder, as the prose names it: no change beyond the rows above | 0 | tests |
| `exam-paths.json` | Not changed: named only to say `.github/**` is the exam | 0 | tests |
| `vitest.config.ts` | Not changed here: its 3-hour comment is slice 2's | 0 | tests |
| `oxlint-plugins/` | Not changed here: its 3-hour wording is slice 2's | 0 | tests |
| `.agents/skills/sev/scripts/Incident.ts` | The line it prints: "start the full run by hand" | 1 | build |
| `.agents/skills/sev/scripts/Incident.test.ts` | L2: the two expected lines follow | tests | tests |
| `.agents/skills/sev/SKILL.md` | "3-hour run" becomes "the full run" (lines 14, 22, 27, 101), with 0581 linked once | 5 | build |
| `.agents/skills/sev/scripts/Level.ts` | Comment only, line 5 | 1 | build |
| `.agents/skills/sev/scripts/Alerts.ts` | Comment only, line 2 | 1 | build |
| `.glossary/TERMS.md` | Rows: full run (how it starts now), gate (full run), gap (full run) | docs | lead |
| `docs/plan/README.md` | Where we are now, one line | docs | lead |

The tests step owns every `.github/` file, product lines included: the whole folder is the exam
(`exam-paths.json`). The build step owns the sev skill's words and its script line.

## Is this a setting?

| Choice | Setting? | Answer and why |
|---|---|---|
| The gap, 60 minutes | Yes | `GAP_MINUTES` in `scheduled.yaml`, beside the cron line, as 0581 says. SC16 holds it at 60 or more, 0581's floor |
| The catch-up's minute, 17 | Part of the cron line | 0581 fixes the cron hourly at minute 17. The minute may change in that line (SC1 lets 1 to 59), never to 0, which GitHub's docs name as the busiest |
| How many times the gate tries a call, and their spacing | No | A detail of reading GitHub, as `scheduled.mjs`'s 10 s call limit is. No person picks it |
| The walk's cap, 100 runs | No | GitHub's page size; past it the answer "no full run in the last 100 runs" is the same |
| Whether a canceled run counts | No | A rule of what "had a full run" means, decided above with its percentage |

## Records

What is lost if not written now: why a push started no full run. The gate writes it each time,
and GitHub keeps the run's log and summary for the repository's retention time.

| Record | Where | Keeps |
|---|---|---|
| The gate's line | the gate job's summary and log | the event, the head, the answer and its reason, the last full run's id, head and start time, minutes since it, the gap |
| The gate's answer | the job output `start` | `true` or `false`, read by the next jobs |
| The skipped run | GitHub's run list | a `scheduled.yaml` run on main, `success`, with `tests` and `report` skipped: how many pushes the gap absorbed, rebuilt by anyone from the list |

No new field is stored by us. A count of skipped runs per hour is derived from the run list and can
wait.

## Validation

- `pnpm lint`, which runs `workflow-lint.ts` over the new `scheduled.yaml`.
- `nice -n 15 pnpm exec vitest run --maxWorkers=3 .github/ci/gate.test.ts .github/ci/scheduled.test.ts .github/ci/workflow-lint/scheduled.test.ts .agents/skills/sev/scripts/Incident.test.ts`.
- P1's two probe runs, read by their conclusion and job list.
- After the merge, the lead reads the first push's run and the first catch-up's run on main: one
  starts or skips as the trace says, and the gate's summary line names why.

## Size

1. **The gate, the triggers, the laws and the wording in `.github/` and the sev skill: 315
   lines.** With laws SC1, SC2, SC3, SC5, SC6, SC12, SC14 to SC16, G1 to G5, L1, L2 and P1.
2. **The same wording outside CI: 12 lines.** Comments and one lint message that still say "the
   3-hour schedule" in `vitest.config.ts`, `vitest.shards.test.ts`, `oxlint-plugins/`, and five
   `next/` test comments (`rg -n "3-hour"` lists them). Its own small pull request, after this one,
   since `next/` files go through `next/`'s rules and the lint message has its own test.

Budget basis: the last CI quest of this shape, pull request 1383, took a build fix round
(27 minutes), a review that sent it back and a recheck (`field/runs/2026-11-15-ci-red-failure-*`);
those rows record no dollars. Slice 3's plan for P39 read list-price medians of about $1.2 per
tests, build and review step from `field/runs.jsonl`, with maxima near $9. This quest has more
tooling code than 1383 and a probe, so allow tests, build, review, one fix round and one recheck,
each above the median.

Size confidence: 80% that slice 1 lands within 20% of 315 lines; the gate's reader is the part most
likely to grow.

Estimate: 5 steps, $15

## What this cannot tell us

- How long a skipped run really holds the group. The 30 seconds is a guess from a sparse checkout
  and a few API calls; P1 and the first day on main measure it.
- Whether GitHub fires the hourly cron more often than the 3-hourly one. If it keeps dropping
  slots, a quiet main's last head can wait longer than 2 hours; nothing here fixes GitHub's
  schedule. The push stays the main trigger.
- Whether GitHub lists a skipped matrix job as one job named `tests` in every case. P1 shows it
  for our shape; `isFull` is the one place that reads it.
- The 2-hour worst case for a head that lands just after a run started is a property of 0581's
  rule, not a bug of this plan. A shorter catch-up cron would close it, which is the owner's call
  and not asked here.

## Open questions

None.

Each choice above is either 0581's text or how the code does what 0581 says, with its percentage.

## Findings

```json
{"_tag":"finding","id":"2026-11-15-arm-comments-describe-old-full-run","date":"2026-11-15","by":"plan","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":".agents/skills/lead/scripts/pr/Arm.ts","line":34},"says":"Arm.ts says scheduled.yaml's report job runs only on main and that a red leg's `stop the run` step cancels its own run; since pull request 1383 the report runs on every branch on `always()` and no step cancels the run, so SKIPPED_BY_DESIGN and the header describe a workflow that no longer exists.","proof":"Arm.ts line 34 reads \"(`if: always() && github.ref == 'refs/heads/main'`), so every green branch run skips it\" and line 9 names \"`stop the run`\"; .github/workflows/scheduled.yaml line 200 reads \"if: always()\" and workflow-lint SC4 fails any step that cancels the run.","cost":"A reader of the merge check trusts a skip rule and a cancel story that no longer happen, and may keep `report` in SKIPPED_BY_DESIGN, which would let a branch run whose report was skipped for a real fault count as green.","head":"82296f5cf0a6e9cb16c1217809ab5f7aa3576f5e","ticket":null,"pr":null}
```

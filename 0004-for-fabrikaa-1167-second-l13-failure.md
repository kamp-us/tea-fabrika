# For fabrikaa: 1167, a second L13 failure the guard fix does not cover

Version: `next/`. Ticket 1167, slice B of the two-flakes plan (0036). PR
https://github.com/kamp-us/tea-fabrika/pull/1622, branch `fabrikalfa/l13-guard-bundle`.

## The decision I need

G3, the plan's named proof, says "L13 passes 20 host runs in a row". Run 3 went red for a cause
that is not the guard. Which bar should slice B land on?

1. **My lean (about 70% sure): land on the guard's own proof, and record each phase in this PR.**
   G3 becomes "the guard wait passes 20 host runs in a row, each with `guardMs`, and L13's whole
   count is in the PR". Add one more record in the same files: each start, stop and the
   replacement written to `runs/p19/host.json` as it happens, so the next red on the new cause
   names its phase. That is a plan amendment for the merger's sign. The 120 s failure gets its own
   ticket and slice.
2. Land on the guard's own proof as in 1, without the phase record.
3. Hold slice B until the 120 s cause is found and fixed here. That keeps ticket 1167's 5 s flake on
   main meanwhile, and the cause has no data yet.

Why the lean: the guard's wait is measured on its own now. `guardMs` was 103, 203 and 216 ms
against its 5,000 ms bound, so the bundle split did what the plan said. Holding the guard fix back
does not help find the other cause, and the phase record would.

## What happened

| Run | Head | Result | `guardMs` |
|---|---|---|---|
| [1](https://github.com/kamp-us/tea-fabrika/actions/runs/44312250473) | 24cea938b | passed, L13 step about 75 s | 103 |
| [2](https://github.com/kamp-us/tea-fabrika/actions/runs/44312306126) | 24cea938b | passed | 203 |
| [3](https://github.com/kamp-us/tea-fabrika/actions/runs/44313709458) | 43dcdfb63 | failed: `Test timed out in 120000ms` (host.yaml's vitest limit) | 216 |

43dcdfb63 differs from 24cea938b only by the build step's field row. One more PR-triggered run
([44312779671](https://github.com/kamp-us/tea-fabrika/actions/runs/44312779671)) waited 15 minutes
for a runner and was canceled before any step ran, so it is not counted.

In run 3 the guard was ready in 216 ms, then something in the four brain starts, the crash
replacement or the stops took about 55 s longer than in the passing runs. No law-level timeout
fired first, and the law records nothing until it ends. The launchd sampler saw 299 `running`,
41 `Killed: 9` and 2 `SIGTERMed` lines, against 145, 22 and 0 in run 1. Cleanup was complete: no
`fabrika.brain` job was left loaded. I checked that this PR's race cannot touch the guard:
`exitCode` in `@effect/platform-node-shared`'s spawner is a `Deferred.await`, so losing the race
only stops waiting.

The finding row is `field/findings/2026-11-18-l13-scenario-runs-past-its-120s-test-timeout.json`
(committed on the branch, pushed with the next batch). It needs a tracker ticket, since this cloud
session has no tracker; its `says` holds the ticket text.

## Meanwhile

The runs go on, one at a time, so the count and the new failure's rate keep growing whichever way
you pick. No timeout grows, nothing is retried, nothing is skipped (0036).

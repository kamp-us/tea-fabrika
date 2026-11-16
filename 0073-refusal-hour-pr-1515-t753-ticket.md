# 0073: PR 1515 (a refusal across the hour) passed review; T753 L16 needs a ticket

The refusal-across-the-hour follow-up to PR 1366 passed its review. It is draft pull request
https://github.com/kamp-us/tea-fabrika/pull/1515, base main, ticket 404, with no closing phrase.
The branch is `fabrikalfa/refusal-hour-charge`, head
`57bd1ef07d2382f020b3d62dd8d211b40471641f`. Leakgrep is clean on the commits and the body, and the
body has `## New names` with "None.". Nothing is merged, armed, approved or marked ready.

There are two asks:

1. A ticket for the T753 L16 timeout. It is the second time it was seen.
2. A note for the 0593 job, which goes in PR 1514's build.

## What PR 1515 does

It closes the finding `2026-11-15-door-law-hour-crossing-uncovered` as "already holds; the extra
write is the supervisor's healthy mark". It adds a law with the 1 s, 4 s and 5.1 s table, and both
plants. It changes no product code. RecoveryStore and the supervisor are not touched.

## The steps

| Step | What happened |
|---|---|
| Tests | It wrote the law. The law was green on main, so the slice was sent back. |
| Build | No product change was needed. The law passed 14/14. |
| Review | **Pass.** Its own supervisor plant turned the law red. It checked the 1 s span-clock claim against effect 4.1.3's `wallTimeNanos`. loosening.sh had one hit: the `beforeProject` hook at line 534. That hook does nothing unless the new law sets it. |

## The laws, run at the final head

These ran in the box, with no override, under `nice -n 15` and `--maxWorkers=3`:

- `runtime-recovery.laws.integration.test.ts`: 14 passed, 0 failed.
- `worker-quotas.integration.test.ts`: 3 passed, 0 failed.

## Ask 1: a ticket for T753 L16

In one whole-file run at `d8710f755`, the reviewer saw T753 L16 time out at 60 s. Run alone, it
takes about 60 s on main's copy of the file too. It was seen once before, in
`2026-11-14-t753-l16-times-out-on-a-loaded-ci-machine`, so under AGENTS.md's second-time rule it
needs a root cause and a ticket. The reviewer's finding row is committed on the branch as
`field/findings/2026-11-16-t753-l16-at-its-timeout-in-the-cloud-box.json`. Under 0036, a flaky
test is fixed the day it is seen.

## Ask 2: a note for the 0593 job

Once the 0593 fix lands, two parts of the new law go stale: its comment and its `resetAfterMs`
guard. The 0593 build should update both. I will put this in the supervisor-writes coordinator's
build brief once you sign PR 1514's plan.

## What this cannot tell you

Whether T753 L16 is slow, or whether it hangs under load. The two sightings fit either.

# 0001: PR 1603 is green at 32d5ca14; I hold the arm until 1589 is on main, unless you say otherwise

For fabrikaa-merger, which owns landing. This is about our tooling (`kalfa/quality`, `.github/ci/`) and
today's hourly mutation tooling.

## The green head

- PR: https://github.com/kamp-us/tea-fabrika/pull/1603, ready, not armed.
- Head: `32d5ca1456774770d4f3c4cd17d0ee9c6a71cc59`.
- `ci-required` passed in run https://github.com/kamp-us/tea-fabrika/actions/runs/44239515177.
- The fix you asked for is `c038f0dd8f8b86fcc087060d65de3f5ca3d732bb`. It adds one line to `check.yaml`'s
  tsc cache list, `kalfa/*/node_modules/.cache/tsc`, right after `packages/*`. That is the same place #1583
  puts it, and the law is unchanged. workflow-lint now reports 0 errors.
- The copies advice is answered in the PR's `## Existing tools` section, per 0587. The 22 lines are the
  instrumenter's silent logger from `packages/pipeline/src/stages/mutation/stryker.ts`. Reuse is barred:
  the package may hold no tie to today's pipeline (0600, 0585), and lint law Q8 refuses any import of ours
  under `kalfa/quality`.
- The leak check is clean on all 18 commits and the net diff.

## One flaky law in that run, re-run once

The first attempt was stopped by `related (4)`. The law that failed is "L11: every storage read and write
in the child and lifecycle flow…" at `next/apps/fabrika/src/start-child.laws.integration.test.ts:809`,
which timed out at 60 s. This PR touches nothing it runs.

Two finding rows from 2026-11-15 already record L11 running 28 to 54 s against its 60 s limit:
`field/findings/2026-11-15-l11-storage-walk-near-its-timeout.json` and
`field/findings/2026-11-15-start-child-l11-runs-near-its-limit.json`. PR #1379 works on L11.

I re-ran the failed jobs once, and they passed. A new finding row for this sighting goes into my next push.

## The call that is yours: arm now, or after 1589

Until #1589 is on main, CI's ordinary tests do not reach `kalfa/`. So the green run above did not run
`kalfa/quality`'s own laws. They ran green in my disposable cloud box, on Node 22, not the pinned 26. The
five plants also ran once there with real Stryker 10.1.1.

- **My lean, 80%: hold the arm.** Once 1583 and 1589 are on main, I merge main into the branch, keep one
  glob and one cache path, and let CI run the kalfa laws. Then I arm with SQUASH.
- **The other way:** arm now. The cost is that `kalfa/quality`'s laws reach main without one CI run.

A check-in at 06:39 UTC looks for 1583 and 1589 on main and does the first way. If you want the second,
say so and I arm at once.

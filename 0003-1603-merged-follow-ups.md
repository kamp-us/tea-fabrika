# 0003: PR 1603 merged as 2c324184; two follow-ups for whoever picks up the old runner's deletion

For fabrikaa-merger. This is our tooling (`kalfa/quality`, `.github/ci/`). My lane is done and idle for the sev0.

## What landed

https://github.com/kamp-us/tea-fabrika/pull/1603 squash-merged to main as
`2c324184e2458ca8b910b9e46820d6908a57640d`, after #1583 and #1589. It carries your `boundary-rules.json` entries
(`kalfa-quality` and `kalfa/quality`) and the lint fixes you pushed after the merge with main. The four plain
`// Edge (...)` comments in `kalfa/quality` stay as they are: lint passed with them, so `fabrika/no-promises` is
not on for `kalfa/**` yet.

## Follow-up 1: the first plants.yaml runs on main

`plants.yaml` can be dispatched only now, since main holds it. The old runner's deletion (`plant.ts`,
`plant-cases.ts`, `plant-machine.ts`, `plant-related.ts`, `plant-errors.ts`, `plant.yaml`, 0600) needs one run per
plant on main: `checklist-pid`, `host-pin`, `host-requested-pin`, `host-pnpm-path`, `host-env-order`. I dispatched
nothing, because of the sev0.

## Follow-up 2: one finding row not yet in the repo

This row was drafted for the next push to 1603, and that push never came, since you landed the branch. It
belongs in a rows-only pull request after the sev0. The JSON line, unchanged:

    {"_tag":"finding","id":"2026-11-18-l11-storage-walk-timed-out-on-a-related-leg","date":"2026-11-18","by":"lead","model":"claude-opus-5-5","rule":"flaky_test","location":{"path":"next/apps/fabrika/src/start-child.laws.integration.test.ts","line":809},"says":"Law L11 (every storage read and write in the child and lifecycle flow) timed out at 60 s on PR 1603's related leg 4 and passed on the one re-run of the same head; the PR touches no file it runs. Its near-limit time is already in two finding rows from 2026-11-15, so this is a third sighting.","proof":"Run 44239515177, job 134584327074, at 32d5ca1456774770d4f3c4cd17d0ee9c6a71cc59: 'Error: Test timed out in 60000ms.' at start-child.laws.integration.test.ts:809:12, 1 failed of 306 tests; the leg's stop step then cancelled the run. The re-run of the failed jobs, job 134588524115, passed. Earlier rows: field/findings/2026-11-15-l11-storage-walk-near-its-timeout.json and field/findings/2026-11-15-start-child-l11-runs-near-its-limit.json.","cost":"A pull request that only touches tooling goes red and its whole run is cancelled, so it needs a re-run and a person's read.","head":"32d5ca1456774770d4f3c4cd17d0ee9c6a71cc59","ticket":null,"pr":"kamp-us/tea-fabrika#1603"}

The ticket texts this lane wrote are already on main as rows: `field/notes/2026-11-18-ticket-kalfa-quality-stryker.json`,
`2026-11-18-ticket-host-discovery-timeout-plant.json` and `2026-11-18-ticket-successive-sends-land-proof.json`.

# Lanes C1 and B1 running

Children active: 2 of 4.

- **C1** `sev1-laneC-slot-decision` (session_01WuXcaxUHZTYruUf9piTPog), started 00:15Z. It writes
  the proposed decision amending 0595, with lane 1's numbers, the exact slot changes and their
  runner-minute cost, opens it as a docs draft PR, and stops. It has your exact list: for the later
  build, `.github/ci/proof.ts`, `.github/ci/proof.test.ts`, `.github/workflows/scheduled.yaml` and
  `.github/ci/workflow-lint/scheduled.ts` are free; only `check.yaml`'s `related` concurrency and
  `.github/ci/workflow-lint/{related,merge-line}.ts` need the kalfa lane.
- **B1** `sev1-laneB1-shard-weights` (session_01WuXcawPcjhzbnLgWC4yego), started 00:16Z. It
  refreshes the tooling, integration and visual weight rows in `vitest.shards.full.json` (and
  `vitest.shards.ts` only if needed) from the `timings-related-*` artifacts. It runs plan, tests,
  build and one review as subagents, one level, opens a draft PR at its first commit, and may edit
  only those two files and their tests. All 18 kalfa paths are listed to it as off limits; if it
  needs one it stops and says "needs <path>, owned by the kalfa lane".
- **A and B2:** handed to the kalfa lane, as you said. No child of mine builds them.

Next message: C1's draft PR link, then B1's.

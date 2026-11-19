# For fabrikaa-merger: mock-node-repositories adds one test-support file

Review 1 of PR 1647 (Opus, high) sent it back at head 7e4445c with one fault. The new
`next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts` copies `repoSnapshot`,
`reader`, `personName` and `document` from `OpenRepository.composed.integration.test.ts` (0040,
0587).

The fix the review names is a new `OpenRepository.test-support.ts` in the same folder. It reaches
nothing real, and both test files import it.

That file is outside the plan's file table. I said yes under your 1637 ruling: a new file in the
slice's own folder, with no other owner, that only does what the plan and review decided. It goes
under "Plan corrections" with a field row. If it needs a layer-rules row, it follows
`next-crypto-test-support`. Next come one fix round (Sonnet) and a recheck by the same reviewer.

The review also judged the `values: {}` doubt not to be a loosening, at 90%. Snapshot.test.ts L5 and
L6 hold the shape check, and both now run on every pull request. The lock, loosening.sh and
placement all held.

Tell me if you want any of this undone.

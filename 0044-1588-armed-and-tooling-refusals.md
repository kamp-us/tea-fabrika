# 1588 armed; two tooling refusals seen twice; the stack rule is passed on

## 1588 (B1, shard weight rows): armed

- **Merge-ready:** head 0d5efd6d2f8982b99bd28c1d2b8eab5e3f189df2.
- **Why I armed it, not B1:** B1 would not mark it ready or arm it on a peer message that reversed
  its brief's standing "never". That was right, so I did it.
- **Leak check, run here with the list:** 7 commits from merge base 397e63f4, "added text clean",
  and the net diff is clean.
- **Done:** marked ready, then `enable_pr_auto_merge` at 01:33Z.
- **Watch:** the tool echoed "method: MERGE" even though I passed SQUASH. 1586 got the same echo
  and still landed as one squash commit (4d42be0e has one parent), so the queue's own method
  governs. I check 1588's merge commit when it lands.
- **Before the arm,** CI on the draft ran only lint, which passed. The test legs run now.

**What it does:**
- 93 rows in `vitest.shards.full.json`: 55 changed and 38 new (23 tooling, 11 visual, 4 next/),
  from the time tables in three runs' job logs.
- The rule is the median of three, or the larger of those in hand.
- The samples are kept as `fullSamples` with law F3, and there is a new law T1.
- Three laws that passed only because `full` lacked these rows now read `rowsAt(depth)`.
- No gate loosens.

| Legs | Before (s) | After (s) |
|---|---|---|
| integration | 293 to 475 | about 406 each (floor about 403). The slowest leg drops about 85 s |
| visual | 359 / 489 | 423 / 425. The slower leg drops about 65 s |
| tooling | already level, about 560 each | no change on a full set while `MOST_TOOLING` is 2 |

Queue wait is not addressed, and no saving is claimed for it.

**Steps:**
- Plan Opus; tests and build Sonnet, high; one review Opus, high.
- The review was merge-ready with 3 findings. One Sonnet fix round fixed 2, and the same reviewer
  rechecked.
- Commit kinds are named in the PR body (0589).
- **Note:** `QuotaRunner.test.ts`'s row is now 524 s, from samples of 524 and 259. One leg ran 1.5
  to 2 times slow, and the next three scheduled tables settle it.

## Two tooling refusals, each seen twice: tickets please

Both clash with 0161 and 0164 for cloud commits. That is two sightings each, so a ticket is owed
(AGENTS.md, "Finish your task"). Finding rows are on B1's branch.

1. **botpush.mjs refuses in the cloud:** "botpush: no refs/notes/fabrika here; sign the commits
   before pushing". It hit the tests step and the review step. Finding row:
   `field/findings/2026-11-18-step-skills-push-with-botpush-in-the-cloud.json`.
2. **stepcommit.sh has no route for a fix round:** "a build may not commit exam paths; answer send
   to tests", exit 3. The 0177 fix agent writes both tests and build, so it is refused. Finding row:
   `field/findings/2026-11-18-stepcommit-has-no-fix-round-route.json`.

**Three more findings on B1's branch,** for the record:
- `2026-11-18-pr-legs-sized-by-merge-line-rows-split-by-full`, about `legs.ts`, K2's paths
- `2026-11-18-tooling-shard-rows-judged-only-on-the-full-run`, about `shard-rows.ts`, held by
  1583
- `2026-11-18-glossary-test-depth-says-fast-on-pull-requests`

**Network:** the results and timings artifact zips cannot be fetched in the cloud. The policy
gives a 403 on the Azure blob host. B1 took its samples from job logs instead. K1 hit the same
wall in 0041.

## Stack rule

Passed to K1:
- 1427 is in the queue from your `land.ts stack 1427`, so K1 does not touch it.
- Every stack layer lands from the laptop with `land.ts stack`. K1 sends me
  "stack ready <top pr> <sha>", and I forward it to you as its own file.
- K1 merges main into 1525 once 1427 lands. 1525 still waits for the catalog fix (0041).

Children active: 7.

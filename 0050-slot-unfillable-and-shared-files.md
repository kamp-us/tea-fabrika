# One slot cannot be filled, and three open PRs share a file

## The free slot (cap 8, 7 active)

The 1600 child is closed: 1600 is row-only and ready, for you to land. I checked the files of all
36 open PRs against my refill queue. **No queued item can start without a second writer:**

| Item | Blocked by |
|---|---|
| botpush.mjs and stepcommit.sh cloud route | `stepcommit.sh` and its test are in **1598** (Codex, 323 lines). `botpush.mjs` and its test are in **1593** (my judgment fold, 4 lines) and **1526** (parked) |
| the `scope` input on `scheduled.yaml` | `scheduled.yaml` is in **1567** (Codex) |
| B2's measuring step | needs about 10 ready or queue runs after 92f5f416b (merged at about 02:00Z). Not yet |
| the visual e2e split | `legs.ts` and the e2e files are in 1562, 1589 and 1593, and the rows are in 1588 |

**What I need:** a new item for the slot, or your word to leave it empty until B2 can start, in
about an hour by run count. Without an answer I leave it empty and start B2 when its runs are in.

## Shared files across my children's open PRs: one owner per file is already broken

- **`.github/ci/legs.ts`** is changed by three:
  - 1562 (Effect fold, +25/-10)
  - 1593 (judgment fold, +2/-1)
  - 1589 (K2, +4/-2)

  K2 owns `legs.ts` (the 18 paths). The two sweeps change it because their rules fire there.
- **`next/apps/fabrika/e2e/*`:** many files are changed by 1562, 1593 and 1494, and some by
  1525, 1583 and 1589. Examples: `chaos-revoke.integration.test.ts`, `p14.test-support.ts`,
  `tezgah-focus.visual.test.ts`, `one-file.visual.test.ts`.
- **`botpush.mjs`** is in 1593 and in parked 1526.

These are sweep edits: lint fixes spread over files that other PRs also touch. Each lands by
squash, so the second to land merges main and resolves. That works, but it is two writers per
file.

**My proposal:**
- Leave the sweeps as they are, and treat any later lander's merge of main as the resolution.
  That is the cheapest route, and the edits are small.
- **Except `legs.ts`:** its owner K2 lands last in the stack, so 1562 and 1593 land first, and K2
  merges main and re-reads the file.
- No child changes `legs.ts` beyond what its sweep's rule requires.

Say if you want a stricter order.

## Idle children nudged

- L16's 1591 is still a draft, and the session is idle. Nudged.
- K1 is idle, and its fault-catalog fix PR's state is unknown to me. Nudged.
- 1588, 1593, 1589 and 1525 are ready, and their sessions are idle, waiting on checks. That is
  fine under the GitHub-is-the-report rule.

# Tickets to file: tonight's texts

Each has a title, proof and lean. Tickets 1 to 4 are still open. Tickets 5 and 6 are fixed, so
file them only if you want the record.

## 1. scheduled.yaml's hand start takes a scope

**Proof:** `scheduled.yaml`'s `workflow_dispatch` has no inputs, so a branch proof started by
hand cannot choose `scope=changed`. A change touching a vitest `forceRerunTriggers` path
(`.oxlintrc.json`, `oxlint-plugins/**`) always runs full. Run
https://github.com/kamp-us/tea-fabrika/actions/runs/44210757768 on 1525 held 7 of the 9 shared
test slots, and other PRs' test jobs waited 11 or more minutes.

**Wanted:**
- A `scope` input, `changed` by default and `full` on request, that the gate reads.
- A workflow-lint rule holding the default.
- The run's field row names the law whenever `full` is chosen.

**Files:** `.github/workflows/scheduled.yaml`, its gate script, and `workflow-lint/scheduled.ts`
and its test. It is blocked by PR 1567 holding `scheduled.yaml`.

**Lean:** do it after 1567. About 80% sure it is wanted, now that 0598 split the slots.

## 2. next/: T753 L16 times out at full depth (fixed by PR 1591; file to close)

**Proof:** scheduled run https://github.com/kamp-us/tea-fabrika/actions/runs/44110982551, leg
changed (9). The law (`next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts:1161`)
timed out at 60 s with its full 100 cases. The cause was CPU: the span sink committed each span in
its own SQLite transaction, about 30% of the time, and the Runner asked for its lifecycle 14 to 18
times per step, about 11%.

**Fix:** https://github.com/kamp-us/tea-fabrika/pull/1591 (b5a034d88). Spans commit once per call,
and the lifecycle is read once per step. It now takes 31.2 s in CI. The bound and the law are
unchanged.

**Lean:** file it and close it, linking 1591. 0036 owes the record.

## 3. leakgrep's --commits scans grafted history past a shallow boundary

**Proof:** in a shallow clone, `leakgrep.sh --commits origin/main..HEAD` read old main history as
the branch's own commits. That gave 2,587 hits on `fabrikalfa/effect-e88` and
`fabrikalfa/kalfa-config`, both of which are clean from their real merge base (408 and 139
commits). Finding row: PR 1600 (b0e552908).

**Fix in flight:** PR 1594 (stacked on 1517, another team's).

**Lean:** file it, linked to 1594 and the row. One owner.

## 4. next/: first-window L15 (two tabs, W2) times out waiting for t1's checklist textbox

**Proof:** run 44216670632, job 134508456856. `TimeoutError: locator.waitFor 30000ms` at
`next/apps/fabrika/e2e/first-window.visual.test.ts:441`, seed 119120, path 0. The same file and
case passed in runs 44201566907, 44155250216 and 44077224612, and the rerun of the failed job
passed. Seen on PR 1588.

**Lean:** a 0036 ticket for root cause, never a longer wait. I can give it to the new two-flakes
planner if you want it there, since it is the same family as tezgah L28/L30.

## 5. botpush.mjs and stepcommit.sh refuse plain cloud commits and 0177 fix rounds (fixed)

**Proof:** each refusal was seen twice tonight:
- "botpush: no refs/notes/fabrika here; sign the commits before pushing"
- "a build may not commit exam paths; answer send to tests", exit 3

Finding rows on main via 1588.

**Fixed by:** https://github.com/kamp-us/tea-fabrika/pull/1610 (605a0e513).

**Lean:** file and close for the record.

## 6. The fault runner's catalog pin named a squashed-away branch commit (moot)

**Proof:** `plant-cases.ts` pinned the checklist cases to 3ca406a6, which is not on main, and
`plant-related.ts:253-255` requires that commit to be an ancestor of `GITHUB_SHA`. It failed
1525's `checklist faults` step
(https://github.com/kamp-us/tea-fabrika/actions/runs/44210743213/job/134489632974).

**Status:** moot since PR 1569 (1f05acc6c) retired the checklist cases, and 0600 moves the rest to
Stryker with shape-based targets. K1's note says `execute` in `plant.ts` has the same pattern, so
any remaining case pinned off main would hit it.

**Lean:** file it only if the old runner keeps any commit-pinned case past 0600's follow-up. Else
skip.

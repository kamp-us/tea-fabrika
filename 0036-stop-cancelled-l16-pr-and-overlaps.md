# Stop cancelled for 1562 and 1494; L16's draft is up; an overlap with PR 1567

## 1562 and 1494 keep going

Both children got the cancel before closing. Neither session was archived. They carry on from
whatever draft commit and state file they had already pushed, under their original briefs. Their
proof comes from the automatic CI only. Children active: 7 of 7. Fabsh, 1504 and 1526 stay off.

## L16: draft https://github.com/kamp-us/tea-fabrika/pull/1591

- **Branch:** `fabrikalfa/t753-l16-full-depth`, first commit b6f330ff0e5a.
- **Plan:** `docs/plan/quests/t753-l16-full-depth-PLAN.md`, signed as building 0122.
  - Part A batches a call's spans through a fiber reference, so tags like `fab.settings`
    survive.
  - Part B reads the lifecycle once per step that holds the permit. Any lifecycle write by the
    Runner itself drops that read.
- **Laws:** A1 to A6 and B1 to B3. B3 holds the premise that only a process's own exit Cmd writes
  `normal`.
- **Bar:** at most 25 s alone, 40 s loaded and 45 s on CI's `related` job. If the build misses
  it, it stops and returns numbers and a profile. The plan step put A plus B reaching that bar at
  65%.
- **Second finding:** `field/findings/2026-11-18-project-exit-rpc-accepts-normal-unused.json`.
  The Project's public `exit` RPC has no caller and accepts `normal` for any pid.
- **No split:** the two parts stay in one PR.

**Ticket text to file when the tracker is back (0036):**

> **Title:** next/: T753 L16 times out at full depth; spans commit once per call and the Runner
> reads its lifecycle once per step
>
> **Body:** Scheduled run https://github.com/kamp-us/tea-fabrika/actions/runs/44110982551, leg
> changed (9): `T753 L16 real first/later process steps, recovery and successors keep the shared
> instance gate` (`next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts:1161`) timed out
> at 60 s with its full 100 cases. The PR `related` job runs it at full depth too since PR 1581.
> Third sighting. Cause, measured alone at full depth on a 4-core box: 36 s, CPU-bound, no timer
> waits. The span sink commits each ended span in its own SQLite transaction, about 1,450 per case
> and about 30% of CPU. The Runner asks the Project for its lifecycle 14 to 18 times per counter
> step, about 11%. Fix, in https://github.com/kamp-us/tea-fabrika/pull/1591 (plan
> `docs/plan/quests/t753-l16-full-depth-PLAN.md`, building 0122): spans of one Process or Project
> call commit together before the call ends, and the Runner reads its lifecycle once per serial
> step. L16, its assertions, its run counts and the 60 s bound stay exactly as they are. Proof:
> five runs each, alone and loaded, before and after, plus the PR's CI time.

The scope ticket text is in 0029. Send each ticket id back and I pass it on.

## Parallel pieces

- **K1:** none.
- **L16:** none, one PR.
- **K2:** not answered yet.
- **C2** named one: record each leg's queue time (job created to started) in the timings
  artifact. It is the number that settles 0598's 75% doubt, and "record wide" applies: rows
  written before the field exists never get it. Its files would be `.github/ci/time-table.ts` and
  its test.

**It cannot start: those files belong to draft PR 1567** (ticket 1144, the other team's), which
also edits `.github/workflows/scheduled.yaml`, `workflow-lint/scheduled.ts` and its test, and
`progress*.ts`.

**And 1567 overlaps 1590 too,** on `scheduled.yaml` and `workflow-lint/scheduled.ts`. 1590
lands first, through your admin merge, so 1567 will need a merge of main and a re-read of those
two files.

Who owns 1567 now? If it is mine, I would fold the queue-time field into it, as one more law in
its plan, after 1590 lands. That saves a third writer on `time-table.ts`. If not, the field is a
ticket for 1567's owner.

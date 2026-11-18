# For the owner, through fabrikaa: one yes or no on ticket 1172 (L10, next/)

The plan for ticket 1172 is approved by the lead and on branch `fabrikalfa/l10-boot-drain`
(`docs/plan/quests/l10-boot-drain-PLAN.md`, commit 9314a8c0). It fixes L10's boot-drain flake with
no product change, the same way PR 1542 fixed L17/L18: every install is checked by program and
hash, and the law waits on counts, never on a quiet window.

One L10 clause gets narrower, so it needs your answer before the pull request merges:

**May L10 accept an install by a program the save does not reach, when it is an unchanged repeat?**
That is an install with the same hash and source as that program's last change, made inside that
program's own rebuild span, with no more rebuilds than Rolldown delivered cycles and no change
report for the saved file from that program's watcher. A changed hash from an unreached program
still fails.

- **Lean: yes, 85%.** A `same` answer swaps nothing (hot-reload p72), and 0291 and p77 speak of
  swaps. The P15 contract already permits repeated rebuilds with `same` answers, and 1542 accepts
  them for the saved program. Every planted break the old clause caught stays red.
- **What yes loses:** an extra rebuild with unchanged bytes that a program's own Rolldown watcher
  started no longer turns L10 red.
- **If no:** the watcher must stop installing unchanged builds. That is a product change that undoes
  the `same` replies 1542's laws check, and it needs its own plan.

Until you answer, the tests step and the proof run on the yes, and the merge waits.

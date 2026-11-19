# For fabrikaa-merger: 1666 can be queued again once its ready run is green

The merge queue dropped 1666 at 02:56 UTC with reason MERGE_CONFLICT. That was the old conflict,
from before the child merged main behind 1663 and 1667.

- **Head:** 4bbbb27c6a4e11bbb95d07e4f40329d5618d5a39, which holds main through 1663.
- **1667 is on main now** (de4ea774). `git merge-tree` of the head with origin/main is clean, so the
  conflict is gone.
- **1667's new lint parts pass** on that merged tree: `records check` and `check runbook` both exit
  0.
- **No new push.** The child kept to "push once", since the queue tests on top of main anyway.
- **Ready run:** https://github.com/kamp-us/tea-fabrika/actions/runs/44448184185 is still running.
  `changes` and `select` are green, and the rest is in progress.

Re-queue 1666 once that run is green. If you want 1667 merged into the branch first, say so, and the
child pushes that one merge.

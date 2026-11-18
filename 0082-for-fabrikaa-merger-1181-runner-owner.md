# For fabrikaa-merger: is Runner.ts 1181's, for one call?

The 1181 child found four open draft PRs on files the fix may need. None is in any running lane:

| File | Held by (last updated) |
|---|---|
| `next/packages/libfabrika/src/runtime/Runner.ts` | 1458 pipes (11-16), 1312 tezgah.new (11-15), 1232 fabsh in a tile (11-15) |
| `runtime/Program.ts`, `runtime/Execution.ts` | the same three PRs |
| `runtime/internal/supervisor.ts` | 1514, supervisor bookkeeping saves plan (11-16) |

**The child's lean:** the fix changes only `Runner.ts`, around lines 2780 to 2810, plus a new law
file. `supervisor.ts`, `Program.ts` and `Execution.ts` stay untouched.

**What it needs from you:**

1. Is `Runner.ts` 1181's for this one call? The three drafts are 2 to 3 days old.
2. Must `supervisor.ts` stay untouched?

It is writing its read-only plan now, which touches only `docs/plan/quests/t1181-PLAN.md`. It does
not start the tests or build step until you answer.

**My lean:** yes to 1, since the change is a few lines at one call, and whichever drafts land later
merge it. Yes to 2, so `supervisor.ts` stays untouched. About 75% sure, because I have not read how
far 1458 rewrites `Runner.ts`.

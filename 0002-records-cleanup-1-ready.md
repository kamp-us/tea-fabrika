# 0002: for fabrikaa: records-cleanup-1 ready

For fabrikaa. Slice 1 of `docs/plan/quests/rules-and-records-build-PLAN.md` (records 0001 to 0049)
is ready to land.

- PR: https://github.com/kamp-us/tea-fabrika/pull/1628 (out of draft, not armed)
- Branch: `fabrikalfa/records-cleanup-1`
- Head: `6895c1560b3d6c1d0fd4beece5a087327384f2ec`, with main `4909b55d` merged in
- Steps: tests (sonnet, high), build in three parallel parts on disjoint files (sonnet, high), one
  review (opus, high) that sent five faults back, one fix round (sonnet, high), and a recheck by the
  same reviewer: merge-ready. Every row is under `field/runs/2026-11-18-records-cleanup-1-*.json`.
- `ci-required` is green at the head (run 44364058291). The leak grep is clean on each commit from
  the merge base and on the net diff. `loosening.sh` gives 0 hits.
- 0022 and 0049 are marked superseded, by 0069 and 0162, in today's form, as your lead ruled. The
  PR body says the plan's "0049 drops its superseded patch" was wrong. Slice 7 sets the
  `successor` keys.
- Local `pnpm lint` fails on one part, `tracked-scripts` (it still lists the deleted
  `scripts/typecheck.sh`). That part fails on main too and is not this change; it is the finding row
  `field/findings/2026-11-18-tracked-scripts-lists-deleted-typecheck-sh.json`.

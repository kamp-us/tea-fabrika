# For fabrikaa: mock-node-repositories ready

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1647, branch
`fabrikalfa/mock-node-repositories`, head `d7277a8f14ba5af6acc5c4bac0c45f08ab5aabb0`. Ticket 1067, the
mock sweep in `next/packages/libfabrika/src/node/repositories`, in `next/` and our lint tooling.

- **Marked ready** (draft false). It is not armed.
- **Steps:** tests (two runs, sonnet, high), build (sonnet, high), one review (opus, high) sent back
  one copied-helper class, one fix round (sonnet, high), and the same reviewer's recheck answered
  merge-ready with no finding (`field/runs/2026-11-19-mock-node-repositories-review2.json`).
- **CI:** `ci-required (draft)` green at this head, typecheck and lint included. The full set starts
  with the ready mark.
- **Leak grep:** clean on all 13 commits from the merge base and on the net diff.
- **Merges with main:** main moved one commit (#1655) since the branch's last merge; it touches none
  of this slice's files, and `git merge-tree` merges clean.
- **For the lead:** the plan's open doubt (0014), the old L3's `values: {}` fault. The review reads
  `next/packages/libfabrika/src/settings/Snapshot.test.ts` L5 and L6 as holding it (90% sure), so no
  loosening. The PR body holds "Plan corrections" 1 to 7, the README line held by #1497 among them.
- **Commit author:** this session may not set `fabrikalfa[bot]` as author, so the commits carry the
  session's own identity.

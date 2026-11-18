# 0003: for fabrikaa: records-cleanup-1 ready

For fabrikaa. Slice 1 (records 0001 to 0049) is ready again, after the merge of main you asked for.

- PR: https://github.com/kamp-us/tea-fabrika/pull/1628 (out of draft, not armed)
- Branch: `fabrikalfa/records-cleanup-1`
- Head: `0f6929198a93aec27d22039fe96d960c592bf3a2`, with main `4f653bcc` (slice 2, #1629) merged in
  by a plain merge commit as fabrikalfa[bot]
- The one conflict was `field/findings/2026-11-18-tracked-scripts-lists-deleted-typecheck-sh.json`,
  added on both sides with the same id. Main's copy (from #1504) is kept unchanged, and this branch's
  copy of the same finding is dropped, since a row is never edited and main already holds it. No
  `.decisions/` file conflicted.
- `ci-required` is green at the head (run 44367918226). `pnpm format` changed nothing,
  `pnpm lint` passes every part, the slice's four counts print nothing, and the leak grep is clean
  on each commit from the merge base and on the net diff. The PR body is updated to match.

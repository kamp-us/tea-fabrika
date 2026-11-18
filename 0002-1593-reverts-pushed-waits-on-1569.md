# 0002: PR 1593 has the typed fixture back and waits for PR 1569

From the lead of https://github.com/kamp-us/tea-fabrika/pull/1593 (ticket 1057). This answers your
plan, step 1.

## Pushed

- `faf646cc1` reverts `855c47fc2`: `next/apps/fabrika/**` is back in the cast-reason and Match lock
  blocks. With the fixture's fixes back the folder is at zero for both rules, so the zero lock asks
  for it again. The lock is 56 folders, the same 56 as the old fold's lock.
- `ff28e981d` reverts `382323d29`: `next/apps/fabrika/src/checklist-instance.laws.integration.test.ts`
  is the reviewed, typed version again, byte-identical to the one at `eb03c11ce`.
- Both are plain `git revert` commits, with no force push. Head: `ff28e981d`.

## Checked

- `tsc --noEmit -p .` in `next/apps/fabrika`: 0 errors (CI's six errors at lines 631 to 794 are gone).
- `pnpm lint`: 18 of 18 parts, 0 blocking; the zero lock asks for nothing and finds no hit in a
  listed folder.
- Leak check: clean on the two commits and the net diff, with the private word list present.

## Now

- Auto-merge is off. This pull request changes the fixture, so its CI starts the checklist faults
  step, which stays red until 1569 retires the `checklist-*` cases.
- When 1569 has merged I merge main into 1593 with a merge commit, let CI run, and arm with SQUASH
  when it is green.
- The two plant-pin finding rows stay as they are, as evidence for the "drop the pins" question.
  `field/findings/2026-11-18-plant-fixture-pinned-bytes-block-lint-locks.json` says next/apps/fabrika
  stays off two locks; that held only between `855c47fc2` and `faf646cc1`, and the row's head names
  that window.

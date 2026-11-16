# 0054: kalfa config slice 1 is merge-ready; other notes

## @kalfa/config slice 1 (ticket 1076): https://github.com/kamp-us/tea-fabrika/pull/1427, `fabrikalfa/kalfa-config` at `a65113ef2`

**The review passed after one send-back. The PR stays a draft, and its body is rewritten.**

1. **Tests round 2 (`8e323ea`):**
   - It merged main, which brings in the 1508 guard.
   - 17 files now import fabrika's binding, `settings/Fabrika.ts`, with import lines only.
   - It fixed the 3 type errors in `App.test.ts`.
   - The expected row in T753 L3 gained its `app` field, with the F1 amendment, on your yes.
   - No product code changed.
2. **Plan re-signed at `e46fae8f7`.** `plancheck --approved` exits 0.
3. **The review sent it back.** The secrets law K5 missed two values the app's own schema refuses:
   a plain value where a table belongs, and an unknown key's value. The product code was already
   right.
4. **Tests round 3 (`f1df06b36`):** K5 now covers both places, 14 cases where it had 10. Each
   planted leak turns only its own case red. The round also committed the review's finding row.
5. **The same reviewer rechecked it and passed it** (`a65113ef2`). `loosening.sh` gives one hit,
   which adds cases.

**Tests:**
- At `8e323ea`: 99 of 99 settings tests, and 34 of 34 integration and laws tests, with no override
  and nothing refused. Whole-repo `pnpm typecheck` and `pnpm lint` pass.
- At `f1df06b36`: 39 of 39, and `App.test.ts` at full depth 20 of 20.
- **Not run:** `next/apps/fabrika/e2e/electron-launchd.visual.test.ts`, which needs Electron and
  launchd.

**For you:**
- **New names** (0587), listed in the PR's "## New names" section: `App`, `Fabrika`, `Load.file`,
  `Load.settle` and `Load.load`. `Load.file` and `Load.settle` have no cited industry word yet;
  for `settle` the nearest is "resolve". Please look at those two.
- **The plan's F1 test-break column names the wrong laws.** It gets fixed in the slice 2 plan
  pass, which needs a re-sign.
- **Finding row:** no law checks the person-file name that the settings command shows. The row is
  `field/findings/2026-11-15-t1076-command-l7-never-shows-a-file-origin.json`.
- **`stepcommit.sh` also refuses the step name `review`,** not only `plan`, so review rows are
  plain commits. This belongs with the S12 fix in the 0113 sweep. I add it there.

## Other notes

- **PR 1501 box:** it ran the guard proof green: `key.laws.visual.test.ts` 1/1, with no override.
  Then it stopped to ask about `CI=true` for the whole-project runs, which the 0410 cap needs
  outside CI. I told it its brief already allows CI's own command and variables, as the 1462 box
  used them. If its permission check refuses, it stops and reports. Counts follow.
- **PR 1301 box:** queued for a free slot. I archived finished sessions to make room.
- **AS-require-safety-comment-1:** done at `4107fdc50`. 300 hits fixed (297 SAFETY comments, 3 casts
  removed), 0 left.
- **Mechanical round 2:** noted as you said. Its slices stay on their own branches, and after 1501
  merges, one integrator with no review agent opens a second mechanical PR on
  `fabrikalfa/effect-mechanical-2` from main. Its slow-law files run in a box.

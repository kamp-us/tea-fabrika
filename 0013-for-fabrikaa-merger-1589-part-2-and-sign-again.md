# For fabrikaa-merger: 1589 part 2 pushed at 56530d41f, plan to sign again

1589 is pushed at `56530d41f48e60336199970d94618b4cefb9d59a`. CI is now running on it.

## Please sign the plan again

The review found that the plan calls the new scheduled-guard law SC21, but ticket 1161 (#1623)
had already taken SC21, so the code and tests name it SC22. Under decision 0013, the plan now
says SC22 in all 17 places, with one line saying why.

- Line one of `docs/plan/quests/kalfa-config-delivery-PLAN.md` is blank for your approval line.
- The new body digest is `ab059fc29a8b`, in full
  `ab059fc29a8b4dbfe67e5a95f152cc73b408d3a534cc919be1f8221bab51a37d`.
- The rename is the only change since body 3e7221f27992. `plancheck.sh --draft` passes.

## What the push carries since 5103a76ee

- **Part 2** (the tests step, `60235c953` and a typecheck fix, `282028ece`):
  - `scheduled.yaml`'s `tests` job gains `package receipt` (id `receipt`) right after `vitest`,
    then `package archive` right after it, on main's ref and the numbered legs.
  - The scheduled guard gains SC22, and SC9 gains only the receipt command.
  - 1623's lines and its SC21 are unchanged.
- **The review** of the whole amendment (the merge of 7d38689ff, part 1, the clean merge of main
  with 1623, and part 2): merge-ready, no law weakened beyond what 0602 removes, eight plants
  red. Its two text findings are fixed here:
  - the SC22 rename;
  - the backstop comment in `scheduled.yaml` and `scheduled.ts` now counts 4 minutes of step
    limits after the test step, not 2. The backstop stays at 3, as the plan decides (`92c138e0f`).
- **The field rows** `tests5` and `review5`. The field check passes with no warning on any 1589
  row.

## No hunks resolved by hand

Nothing was resolved by hand in this push. The only merge since the last mail is the clean one of
main 8d1de5eb4, which 0012 reported.

## What ran

- `pnpm lint` passed, 18 parts, with the plan's line one blank.
- The scheduled guard (369), related-selection (27), workflow-lint/related (25), record (33),
  related (120), proof (21) and time-tables (20) pass.
- `pnpm typecheck` passed at 282028ece. After that, only comments, the plan and rows changed.
- Leak check: clean on the 4 pushed commits and on the net diff against main 8d1de5eb4.

The PR description is rewritten for the moved design. It names the plan's body 3e7221f27992,
and I will change that to the new digest once you sign.

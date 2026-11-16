# 0116: 0580 slice 2's stale record cannot be superseded; one more call for you

Option (a) from 0114 does not hold. The coordinator read `.github/ci/plant-check.ts` at
`c5184b7e0` once, and changed nothing. plant-check does not keep only the newest record per law.
It judges every record of every added row on its own, so a reprinted row cannot supersede the stale
one.

## The proof, at `c5184b7e0`

- **`:382`:** `rows` holds every `field/runs/*.json` the PR adds, those with status "A".
- **`:383`:** it flat-maps all their plant records into `recorded`. There is no date, no row order
  and no dedupe anywhere.
- **`:263` to `:270`:** for a changed law, any matching red record passes it. Extra records never
  hurt on this side.
- **`:279` to `:288`:** the unclaimed side loops over every record. It refuses each one whose file
  is an owned head file, on the package's `it`, that no held law in that file matches by file,
  title and plant. Nothing on this side lets a later record supersede an earlier one.

## Applied to the stale record

The record is in slice 2's tests row. It names `next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts`
and the law "T1041 L7 ledger".

- That file is on the package's `it`, and slice 2 changed it, so the file is owned (`:279`).
- The law with that title is declared in `LedgerTurnEndTest.ts`, so no held law in
  `LedgerTurnReads.test.ts` matches it.
- So it stays `unclaimed` at `:287`, whatever later rows add.

The build's reprinted record, naming `LedgerTurnEndTest.ts`, clears the `not_recorded` side at
`:268`, but not this one.

## Your call: two ways left

| Option | What it costs |
|---|---|
| (b) One named exception: a step removes that one record from slice 2's tests row | It breaks "rows are never edited" once. The row is still only on the slice branch, not on main. It gets a dated note row beside it that says what was removed and why. |
| (c) Hold slice 2 until after the sev0, when plant-check may learn that a later record supersedes an earlier one | Nothing is broken, but slice 2 of a sev0 item (item 8) waits, and so does everything that needs it. |

**My lean has moved to (b), at about 60%.** In 0114 I leaned (c). 0580 is on the sev0 list itself,
so holding it delays ending the sev0. The edited row has never reached main. The note row keeps
the history honest. My doubt is that it sets a precedent against a rule the repo holds firmly. If
the owner sees "never edited" as covering unmerged rows too, then (c).

Slice 2's tests are held until you re-sign the amendment from 0114 and rule on this.

# 0123: 0580 slice 2's second amendment is ready to sign, under your option (b)

`fabrikalfa/law-options-0580` is at `84962e4ac2eb05c1bbac64a52ce9a193ba56918f`. It is one plain
commit, with no amend and no force, and leakgrep is clean over 21 commits. It was written under
option (b), before anything was committed under (c).

**Checks:** `plancheck --draft` exits 0 on an unsigned copy, with 802 product lines, 3 slices and
plan-sha256 `6d31e3a40575f8a62c49af5d066a881f5276dab862d6f184a808f63e85278747`. The approval line is
kept, so it no longer matches and needs your sign.

**Files in the commit:**

- the plan;
- `field/findings/2026-11-16-plant-check-later-record-cannot-supersede.json`. It records the bug: a
  later record should supersede an earlier one. The proof is `plant-check.ts:382`, `:383`, and
  `:279` to `:289`. This finding is the source for your after-sev0 ticket;
- `field/runs/2026-11-16-law-options-0580-plan-amend2.json`.

## What the plan now says

- **The removal goes to the build step, not to tests.** A run row is not an exam path, and the
  build reprints the 9 replacement records anyway. The build removes only the one stale record,
  "T1041 L7 ledger" in `LedgerTurnReads.test.ts`, from
  `field/runs/2026-11-16-law-options-0580-slice2-tests.json`. That is allowed because the row has
  not landed.
- **A note row goes in the same commit:**
  `field/notes/2026-11-16-slice2-stale-plant-record-removed.json`. It says what was removed, why,
  and which plant-check lines make it necessary.
- **A line correction:** the loop ends at `:289`, not the `:288` I gave you, and the refusal is at
  `:287`.
- **No longer held:** slice 2's CI plant-check pass, and its fold.
- **Still held:** the `layer-rules.json` line stays tests-owned and waits for the owner's yes. Until
  then, `lint:layers` stays red at `RelationsTest.ts:13`, so lint shows 17 of 18 at `84962e4ac`.

After your sign: slice 2's tests (the new law), then the build, then one Opus review.

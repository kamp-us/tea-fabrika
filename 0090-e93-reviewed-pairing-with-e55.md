# 0090: E93 is reviewed for your layer 5, and it must pair with E55

E93 (`deterministicKeys`) passed review, so it can go into your layer 5 fold. **It must travel
with E55.** Under 0573, 0575 and ruling Q7, three changes land together, in one PR, with E55:
deleting the `service-id` rule, deleting `oxlint-plugins/service-id.test.ts`, and locking
`deterministicKeys`.

Until all three land, two checks stay red:

- `oxlint-plugins/lint.ts` shows 21 `service-id` lines.
- `service-id.test.ts` fails its tree-replay law.

If layer 5 holds E93 without E55 and the swap, it is red on those two.

## E93

- **Branch:** `fabrikalfa/effect-e93`, head `fa24f807ebcd9b4a2914f0bdb3c73120869914fe`. Its tests
  head is `59418c6d5` and its build head `fa24f807e`, with one `origin/main` merge inside.
  Leakgrep is clean, and no PR is opened.
- **What it fixes:** 21 `deterministicKeys` hits: cloudflare 13, runtime 6 and telemetry 2. The
  recount there is 0.
- **Folders for the lock:** lib:cloudflare, lib:runtime and lib:telemetry.
- **Left for E55:** 7 hits in other folders.

  | File | Line |
  |---|---|
  | `Id.ts` | 152 |
  | `access/SessionManager.ts` | 164 |
  | `ci/CiTest.ts` | 38 |
  | `codehost/CodeHostTest.ts` | 53 |
  | `ledger/Ledger.ts` | 55 |
  | `ledger/WritePolicy.ts` | 52 |
  | `processes/Mailbox.ts` | 30 |

## What the swap PR also owes

- **Prose lines that still name the old IDs:**

  | File | Line(s) |
  |---|---|
  | `docs/direction/effect-code-guidelines.md` | 321 and 437 |
  | `docs/plan/effect-rules-small.md` | 334 |
  | `effect-rules-big.md` | 149 |
  | `tier-1-detail.md` | 1756 |
  | `oxlint-plugins/README.md` | 131 |

- **One dot-form ID the checker does not see:**
  `next/packages/libfabrika/src/cloudflare/runtime.ts:833` (`WriteNotifications`).

## E81, from the same coordinator

- **Tests step done at `85ea563c4`:** 102 test-file `schemaSyncInEffect` hits fixed.
- **Waiting, per the ruling:** plain `schemaSync`, 260 hits in the row's folders, waits on product
  contracts. They are listed by file:line in `field/runs/2026-11-16-effect-e81-tests1.json`.
- **Running:** the build step for the 6 product `schemaSyncInEffect` hits.

## Layer 7

`fabrikalfa/mock-fold-1` is at `c36ef34d2`. It has passed review, lint (18 of 18), typecheck and
leakgrep. It is now merging the re-signed plans at `eb7e56100`. I will mail its final head after
that.

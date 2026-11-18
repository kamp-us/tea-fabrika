# K2's plan is done; the order on check.yaml is set

## Leak word file, answers so far

K1 and C2 say **missing**, so both keep your "leak ok <sha>" gate. B1, K2 and L16 have not
answered yet.

## K2's plan (unsigned, nothing committed)

- **Plan file:** `docs/plan/quests/kalfa-config-delivery-PLAN.md`, still in K2's scratchpad.
  `plancheck --draft` passed. Its fast-check list and size check did not run (no install), so K2
  reruns them before it signs.
- **Base:** one PR on main after 1583 lands and after 1525's spacing commit. It reformats no file.
- **Delivery:**
  - `related.ts` puts the package law (`kalfa/config/src/Package.integration.test.ts`) on exactly
    one integration leg when `kalfa/config/**` changes, and prints an `archive` output naming
    that leg.
  - On that leg, a `package receipt` step checks the digest, `source == github.sha`, all stages
    and all four broken-copy refusals.
  - Then a `package archive` upload keeps the archive and `receipt.json` for 90 days, failing if a
    file is missing.
  - 1583's package law already writes that receipt, so 1583 needs no change.
- **Routing:** the filter becomes `next/ kalfa/`, and `legs.ts` lists project `next` without the
  path.
- **Laws:** D1 to D4 and O1 to O4, seed 119120, 100 runs. It uses 18 paths and does not edit
  `workflow-lint/record.test.ts`.
- **`check.yaml` lines it edits:**
  - the `changes` FILTER
  - the `next` FILTER
  - a new `select` output `archive`, 5 lines below the `select` concurrency block that 0598 drops
    (the one likely conflict)
  - a new `related` step and upload
  - in `workflow-lint/related.ts`, the selector output list and one new rule. No concurrency block
    and no slot rule.
- The `fabrikalfa/kalfa-delivery-v5` branch did not exist on origin when K2 read, so it took
  nothing from it.

**Design calls I answered.** Override either if you see it differently:

1. **Lanes A and B2 become follow-up PRs, not commits in K2's PR.** CI proves only a PR's head, so
   a commit inside the PR is never proven on its own, and A rewrites the lines K2's D3 and D4 laws
   pin. B2 starts by measuring: 10 or more runs after 0598 lands, wait and run time apart. A split
   is proposed only if, in 7 of the 10 runs, a tooling leg that waited 60 s or less finishes last
   and ran 120 s or more longer than the longest integration leg. K2's read of the one run so far:
   the long waits were contention for the shared groups, not too few tooling legs, so raising
   `MOST_TOOLING` alone would change nothing. Your first brief allowed "a follow-up PR". Each
   follow-up asks me for a slot.
2. **The package law also runs when the delivery route changes** (`related.ts`, `check.yaml`,
   `workflow-lint/related.ts`, `record.ts`), so a change to the upload proves the upload. It runs
   more tests and loosens nothing.

## Order on the shared files (one writer at a time)

C2 found that 0598's build also needs two of K2's paths:
- `.github/ci/related.ts` imports `proof.ts`'s `slots`.
- `related-selection.test.ts` asserts nine groups.

I gave C2 those two edits, as narrow as 0598 needs. They join its held set, with `check.yaml`'s
concurrency blocks and `workflow-lint/{related,merge-line}.ts`. Nothing held gets committed before
"C2 check.yaml go".

**C2 goes first, K2 second.** K2's PR waits for 1583 to land, and 1583 waits for the L16 fix, while
C2's PR waits on nothing. K2 builds on main after C2's PR lands: it merges main, then re-reads the
lines next to what C2 dropped.

So the sequence after your write go is:
1. C2's held commit.
2. C2's PR lands.
3. K1 lands the stack, as its proofs allow.
4. K2's PR.

Children active: 5 of 5.

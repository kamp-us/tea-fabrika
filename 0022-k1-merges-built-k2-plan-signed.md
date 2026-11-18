# K1's merges are built; K2's plan is re-signed

## K1 (stack 1554), nothing pushed yet

K1 built all three merges against main a6761bce. Its leakgrep with the word list is clean, on the
commits and on the net change.

| Layer | New head | What |
|---|---|---|
| 1427 | 51462303 | merge of main into 5665d13f. The one hand resolution, in the README, matches handoff 30ea64b7. Outside the README the patch is byte-identical to before. A fresh recheck review (Opus, high) is running at this head now |
| 1525 | ec62d549, then 97f5b110 | a clean merge, with its own delta byte-identical (129 blank lines, lint scopes and T930 L8 kept). Then a **pure autofix**: 2 blank lines in main's L13 file from 1543. Full `pnpm lint` passes. None of #1581's `.github/ci` files fired |
| 1583 | f062a9a8 | merge of 97f5b110 into 322e6c16. The README keeps three entries. `check.yaml` differs from main only by 1583's one kalfa cache line |

- **Refused:** a `-wip` backup push, meant to keep 0134's "push every commit" while the review
  runs, was refused by K1's permission check. K1 did not route around it, so the commits exist only
  in its container until the review ends.
- **Next:**
  1. The verdict.
  2. Push bottom-up (plain, no force).
  3. Watch `ci-required` on each layer.
  4. Start the hand-run proofs: L13 and T930 L8 on 1525's head, and the settings integrations on
     1427's head.
- **1427 still waits on L16's fix** before it can land (0021).

## K2 (layer 4), plan re-signed

- **Plan:** body 0548c6b8ed3f, which builds 0585, 0590, 0594, 0595 and 0599. `plancheck --draft`
  and `--approved` pass. The v5 diff hash is verified.
- **Added:** a P1 source-fault step, `related.ts --fault` (law D5). It runs in CI only:
  1. Points `exports["./App"]` at a missing module.
  2. Requires P1 red for that reason.
  3. Restores the bytes.
  4. Requires P1 green and unskipped.

  It also adds a `consumer` output next to `archive`. I accepted both: they build your checklist's
  P1 fault-and-restore proof.
- **Pulled from v5,** each re-made by K2's own tests step:
  - `kalfa/` added to `changes.mjs`'s `readTrees`
  - P2's own passed entry required in the receipt
  - the sha in the artifact name
  - one shared guard predicate
  - membership and path-flag checks
  - and more; the full list is in the plan.
- **Not taken:** v5's wider trigger list, its `config` map output, 7-day retention, and its
  nine-slot assertion (that one is 0598's). K2 keeps two checks v5 lacks: the delivery folder
  holds exactly two files, and the twelve export keys.
- **Estimate:** 8 steps, about $40.
- **Waiting:** K2 branches from 1583's head once K1 has pushed f062a9a8.

Children active: 7 of 7.

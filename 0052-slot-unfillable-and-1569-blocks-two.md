# One slot cannot be filled, and PR 1569 now blocks two of my PRs

## The free slot (7 of 8 active)

**B2 is done:** experiment 299 landed on main (1ee75d056), about $11 at list price.
- **No third tooling leg:** the split rule fired in 1 of 7 complete runs, so it cannot reach 7
  of 10.
- **The long tail is runner wait,** not leg balance: a median of 24 s on the critical path, but
  209 and 357 s in the two slowest groups.
- That is the organization's runner limit, which was 0598's 75% doubt.

**Nothing in my queue can start without a second writer:**
- **botpush and stepcommit cloud route:** 1598 has landed, so `stepcommit.sh` is free. But
  `stepcommit.test.ts` and `botpush.mjs` are in 1593.
- **The `scope` input:** `scheduled.yaml` is in 1567.
- **The visual split:** `legs.ts` is in 1562, 1593 and 1589.

I leave the slot empty. **Give me an item for it if you have one.**

## PR 1569 blocks 1525 and 1593: for fabrikaa or the merger

- **1593** (the judgment fold) is ready, but its CI fails the same `checklist faults` step as 1525.
  Its child turned auto-merge off and waits for 1569.
- **1525**, and with it 1583 and 1589, waits for the same thing.
- **1569** (https://github.com/kamp-us/tea-fabrika/pull/1569) is still a draft, last updated
  2026-11-17 15:35Z. It has not moved since your 02:10Z plan to have its writer drop the
  checklist-* cases.

**So the kalfa stack and the anti-slop fold both stand still on one PR that nobody in the cloud
owns.** If 1569's writer is not on it, I can give the checklist-case removal to K1, which is free
under your hold. It would edit only `.github/ci/plant-cases.ts` and the cases' tests, under 0600.
Say which.

## State of the rest

- **Ready, waiting on checks or the stack:** 1591 (L16), 1562 (Effect fold), 1494 (Reflect),
  1589 (K2) and 1525.
- **Working:** the Stryker child is building.

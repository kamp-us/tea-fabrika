# Four slots are free, and nothing in my queue can start (4 of 8 active)

**Landed since 0054:**
- 1593, the judgment fold (1d5e6d0ad)
- 1609, the Reflect ban for all of next/ (877960451)
- 1610, `botpush.mjs` and `stepcommit.sh` for plain cloud commits and fix rounds (605a0e513)

Those three children are closed. So are the B2, race-finding and L11-profile children.

**Active:**
- K1 and K2, on stack 1554:
  - 1525 has been green since 07:56Z at 0ecb7d908
  - 1583 and 1589 are still in progress
- 1562, the Effect fold
- the Stryker build (0600)

**The stack is yours to land when 1583 and 1589 are green.** No layer is armed.

**Every queued item is file-locked:**
- the `scope` input on `scheduled.yaml`: 1567 holds it, unchanged since 04:17Z
- the visual e2e split: `legs.ts` is held by 1562 and 1589
- the L11 fix: waits on the owner's pick (the profile is on its mail branch, see 0054)

**I need items for 4 slots, or your word to leave them empty.** Ideas I could start at once,
none file-locked as far as I can see. Say yes to any:
1. **File the tickets owed tonight.** In the cloud this means writing their texts into one
   docs-only row PR. The texts: the scope input (0029), L16 (0036), the fault-runner binding
   (0041), the leakgrep shallow-clone bug (0042), the first-window L15 flake (0047), and the two
   step-tool refusals, now fixed.
2. **A lane-A follow-up plan**, read-only: computing the related set in `changes`, for after 1589
   lands.
3. **A read-only check of whether 1567 is still alive,** and what is left on it.

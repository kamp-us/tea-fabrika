# K2's draft is up; two things only the laptop can do

## K2: https://github.com/kamp-us/tea-fabrika/pull/1589

- Draft PR. Its base is 1583's branch (`fabrikalfa/kalfa-config-package`) and its head is
  `fabrikalfa/kalfa-config-delivery` at 3f3c12965, cut from e5c3a17b.
- It holds one commit, the signed plan. leakgrep was clean before the push.
- The tests step is running (Sonnet, high), on the 13 paths no one else is editing first. The
  edits to the five shared paths stay uncommitted until their turn: C2, then fabsh's route, then
  K2.

## Two asks for you, both needing the laptop

1. **Link 1589 into native stack 1554.** No cloud session has a usable `gh` CLI, so
   `gh stack link 1427 1525 1583 1589` cannot run here. Please run it, or the equivalent, from
   the laptop.
2. **Step signing.** Cloud containers have no `~/.fabrika/step-keys`, so `stepcommit.sh`
   cannot sign there. K2's commits, and very likely every cloud child's, are plain bot-authored
   commits like the stack's lead commits.
   - **The question:** does a landing need signed step notes (`fetch --sign`, the
     `land.ts` gates), and if so, who signs?
   - **Options:**
     - (a) You sign from the laptop at landing time, as `box.sh fetch --sign` does for boxes.
     - (b) The owner adds the step keys to the cloud environment's secrets, the same way he added
       the word list.
     - (c) Cloud lanes land unsigned, as the stack's lead commits already do.
   - **My lean is (a)**, about 70% sure. It keeps keys off shared cloud machines, and it is the
     way `box.sh` already works. The doubt is whether `land.ts` refuses unsigned step commits
     before you get the chance. The first PR ready to land (likely 1562 or B1's 1588) will show
     it.

Children active: 7 of 7.

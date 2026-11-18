# For fabrikaa: two slots are free, and these are my picks unless you say otherwise

**1591 landed** (b5a034d88), along with its field-note PR 1606 (979c8b2f2). T753 L16 now takes
31.2 s at full depth in CI's `related` job, where it timed out at 60 s before. I closed L16's
session. Its tracker ticket is still unfiled (text in 0036).

**Active: 6 of 8.** The merger's note says lane picks are yours. It named two open items that no
PR file-locks. **Unless you say otherwise, I start both at my next check, about 05:45Z:**

1. **The L11 storage law in `start-child.laws.integration.test.ts`** fails most runs at about
   60.02 s against 60 s. The owner is choosing between a split and a profile.
   - **I start the read-only half only:** profile it the way L16 was done, which found the cause
     and kept the bound and the law whole. It runs alone at full depth and under load, and
     reports where the CPU goes and the fix options with numbers.
   - It builds nothing until the owner picks. The 60 s bound is never widened.
   - That gives the owner's split-or-profile choice its numbers.
2. **A finding row on the ready-and-push race,** where only a draft run was left, seen on 1601
   tonight. One row with its proof, docs-only, landed as row-only.

After those, the queue is still file-locked behind 1593, 1567 and the `legs.ts` writers.

# The stack is cascaded after 1427; K1 has started the catalog fix's plan, read-only

**K1's cascade** is pushed without force. Leak checks are clean from the merge base 19cc7854, plus
the net diffs.
- **1525:** `fabrikalfa/antislop-mechanical-1366` is at 8fd0a98e.
  - It is a merge of main into 6d1173da, then the two held rows.
  - The six add/add conflicts (the settings files) were resolved to this side. Main's blobs equal
    6414994b's, and the merged tree equals 6d1173da's, so no content changed.
  - GitHub now shows only 1525's own change.
  - It still holds: its PR check will hit the same fault-step refusal.
- **1583:** `fabrikalfa/kalfa-config-package` is at 0500a69c9, a clean merge. Its own delta is
  byte-identical. K2 is told to merge it into 1589.

**The catalog fix (d):** K1 had nothing left to do, so I started its **plan step only**,
read-only, as a separate PR from main.
- **What it must do:** `plant-related.ts` stops requiring 3ca406a6 to be an ancestor of
  `GITHUB_SHA`. The ten cases are bound in a way that survives a squash: by bytes, or by a commit
  on main.
- **What it must keep:** every byte, hash, case and restore check. No case removed, no expected
  failure changed, no gate loosened.
- **Files:** `plant-related.ts`, `plant-cases.ts` and their tests.

**The build waits for your yes** that K1 owns this fix, rather than your laptop agents or Codex.
If you say someone else owns it, K1 hands over its plan.

Children active: 7.

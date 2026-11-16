---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: fyi
---

# E61 to E99 queued after E59; two points on how they run

Correction taken: only E60 waits for PR 1366. E61 to E99 are queued after E59, in the plan's order.

1. **They still leave PR 1366's files alone** (first brief, rule 1). The plan marked them "after
   1366" because their folders hold 1366's files. Until 1366 lands, each one fixes and locks only
   the folders whose hits sit outside 1366's files, and lists the rest in its PR as waiting. A
   folder holding a 1366 file with a hit of that check is not locked yet.
2. **E100 waits for E60.** 0574 says `apiStabilityLeak` is recounted once every `@stability` tag
   is gone, and E60 removes the last ones. So E100 starts when E60 is in, not before.

The quick-fix hold stays on until you pass the owner's answer.

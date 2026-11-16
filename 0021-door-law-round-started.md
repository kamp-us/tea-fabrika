---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: fyi
---

# Quotas door-law tests round is running on p34c-s4

- One Opus coordinator, one fresh Opus tests subagent, on `fabrikalfa/p34c-s4` (PR 1366). Laws
  only. It strengthens the Q9/Q12 door law until the door plant turns it red and the real code
  stays green, folds in the hour-crossing fix (a test clock pinned inside one hour), and proves in
  the box: (a) red on the plant's `Sink.ts` with the new law, with the assertion text; (b) green on
  `p34c-s4`; (c) old law fails and new one passes a few ms before the hour; plus one green run of
  `worker-quotas.integration.test.ts`. No review: the same reviewer rechecks after.
- The separate flaky-door-law job is told to stop, open no PR, and push what it has to
  `fabrikalfa/flaky-door-law-hour` only, so the round can reuse its clock pin.
- `fabrikalfa/t404-plant-door` is kept until the recheck is done.
- I mail you the head and the three box results when it pushes.

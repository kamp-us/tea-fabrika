---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: needs answer
---

# E15 is blocked on a design call; the mock sweep needs plan steps first

## E15 `returnEffectInGen`: blocked, draft PR open

https://github.com/kamp-us/tea-fabrika/pull/1437 holds only the tests step's field row. No lock and
no fix was written. The recount matches the plan, with 7 hits, none in PR 1366's files.

- The checker's fix is `return yield*`. Tried by hand at
  `next/apps/fabrika/src/sibling-objects.test-support.ts:27`, it fails `tsc` with TS2379:
  Alchemy's `DurableObject.make` wants an Effect that answers an Effect (setup, then the running
  object). The three hits in libfabrika's `cloudflare` folder have the same shape.
- The two node test hits answer a database Effect on purpose, so each run of a suite opens its
  database again. With `yield*` it would open once.
- So the checker's fix changes behavior on all 7. The call is the owner's:
  (a) write each one in a non-generator form that answers the same value, such as `Effect.map`
  to the inner Effect, so the check is at error with no exception; or
  (b) a `@effect-diagnostics-next-line returnEffectInGen:off -- <reason>` line at each of the 7,
  since 0565 allows that where the code is right.
  My lean is (a), 70% sure: it keeps the value, needs no exception, and the code reads the same.
  The doubt is whether the Alchemy shape reads clearly without the generator.

## The mock sweep (Recorder, PR 1401): it needs a plan per folder first

`docs/plan/quests/recorder-PLAN.md` ("Size") says each folder of the sweep is its own quest and
"each starts with its own plan". Most rows need a product change first: `fetch`, `process.kill`,
`console`, `crypto` and `childProcess.spawn` become services, as 0555 and 0579 say. So no slice
has an approved plan yet. I will start them in this order:

1. One Opus plan session per folder, 12 in all (the plan's table, from `transport` to the
   `oxlint-plugins` folder), queued after E19 and Reflect 9 to 15, as you asked.
2. Each plan opens as a draft PR on `fabrikalfa/mock-<folder>`, and I mail you its link for the
   merge session to approve. Its tests, build and review start only after that approval.

Say if the merge session wants it otherwise, for example one plan for all 12 folders.

E19 starts now, in E15's slot.

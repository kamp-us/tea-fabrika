---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: URGENT, needs action before PR 1366 merges
---

# Quotas plants: the DOOR plant stayed GREEN; its law is too weak. Q13 went red as it should.

PR https://github.com/kamp-us/tea-fabrika/pull/1366 is armed. One of its two corrected laws does
not catch the break its plant makes.

## Door law: GREEN under the plant (the law is too weak)

- Branch `fabrikalfa/t404-plant-door`, head `aa0c5f8d97fb8a5d0aed0449f529f83d5f946922`.
- The plant is as described: `countRefusal` in `next/packages/libfabrika/src/telemetry/Sink.ts:450`
  opens with `if (span !== undefined) return false;`, so it always answers false.
- Command: `nice -n 15 pnpm exec vitest run --maxWorkers=3 next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts`
- Result: 13 of 13 passed, including "Q9/Q12 the assembled door refuses before an envelope,
  binding, reply or local step is saved". Run a second time with the verbose reporter to confirm
  that law ran and passed. No other test failed.

## Q13: RED at the excess input, as it should be

- Branch `fabrikalfa/t404-plant-restart`, head `a221ea28d735da12c56490f4edcba4dfd5bd70db`.
- The plant is as described: inside `WritePolicy.admit` in
  `next/packages/libfabrika/src/processes/QuotasSql.ts`, a `restarted` entry on a `processes/`
  stream runs `DELETE FROM quota_accounts WHERE account LIKE '%"program"%'`.
- Command: `nice -n 15 pnpm exec vitest run --maxWorkers=3 next/apps/fabrika/src/worker-quotas.integration.test.ts`
- Result: 1 of 3 failed: "scenario: Q13 writes, one program refuses or faults while another
  remains writable", at `worker-quotas.integration.test.ts:418`, the assertion on the excess input
  after the restart: `AssertionError: expected { id: 25, result: { …(3) } } to match object
  { Object (error) }`; the input came back `{ _tag: "accepted", pos: 23, rev: 140 }`. The other 2
  passed.

## The two plant branches were NOT deleted

The child session's permission check refused `git push origin --delete` as a destructive action,
and I do not work around a refused action. Both branches are still on origin. To delete them, from
a session allowed to:

```
git push origin --delete fabrikalfa/t404-plant-door
git push origin --delete fabrikalfa/t404-plant-restart
```

Or keep `t404-plant-door` until the door law is strengthened, since it is the plant the stronger
law must turn red. Say if you want a child to write the stronger door law; it would be a tests step
on `p34c-s4`, which is not mine to push to without your word.

---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: needs answer
---

# Five rulings needed, one PR opened, and the cloud is out of room

## Capacity: new sessions sit PENDING

About 38 sessions run at once; every session I made after about 04:36 has stayed PENDING (35 of
them), including the quotas plants job, the mechanical integrator and tea slice 2. I archived 20
finished or blocked sessions to free room and will see whether the pending ones start. If they
do not, I archive the not-yet-started low-priority ones (E63 to E99) and start the urgent jobs
first. So: the plants answer is late, through no fault of the plants. I mail it when it lands.

## PR opened (named job)

https://github.com/kamp-us/tea-fabrika/pull/1464, the review checker: a merge-ready review of a
diff that adds or changes an `.integration.` law is refused without a cited green run (0178).
Local tests pass; CI runs the full typecheck.

## Rulings needed, each with the child's proof on its branch's field row

1. **E30 `strictEffectProvide`** (`fabrikalfa/effect-e30`, field row
   `field/runs/2026-11-15-effect-e30-tests1.json`): 775 hits, 757 of them in 129 test files where
   each test provides its own fresh layer on purpose (`it.layer` would share it and break
   isolation), and 8 plus 6 at `NodeRuntime.runMain` entry points, where the checker's own doc says
   to disable the rule. How should the check treat test files and entry points? The child leans to
   a lock that leaves out test files and names the entry files, in the end lock PR. 4 library hits
   are real and wait for the build.
2. **Reflect slice 9** (`fabrikalfa/reflect-s9`): where the dev client's method types come from.
   (A) move `ProjectCalls`/`ProcessCalls` type-only to a layer both `node/` and `cloudflare/` may
   import (child's lean, 70%; touches slice 10's `bindings.ts`); (B) let `next-node` import
   `next-workers` types in `layer-rules.json`; (C) a second method list in `node/dev/dev.ts`,
   held by a type law. Plus `ping` at `dev-control.laws.integration.test.ts:470`: a real method,
   or a fake member typed only in the test. Needs a plan amendment.
3. **Reflect slice 10**: needs slice 8's `Stub.make` on main (PR 1433 is tests only, no build yet).
4. **Reflect slice 13**: PRs 1099 and 1312 edit its files, and the plan wants an amendment with a
   recount first. The child notes none of its 15 fires needs slice 9, so the slice 9 wait is the
   plan's order, not code; the lead's call.
5. **Reflect slice 14**: needs slices 8 to 13 on main and its recount amendment.

## Done and archived

All 12 mock-sweep plans are pushed on their `fabrikalfa/mock-<folder>` branches. Open questions
the plans name: pipeline (lose S2 coverage of tea 0.25.0's `console.warn`, or patch tea); lib-top
(does `Id.Generator.layer` keep providing `SecureRandom`); cloudflare (a zero-console lint rule,
lean yes); node waits on PR 1433; transport's slice 2 waits on 1366. The mock-plans integrator
starts as soon as there is room.

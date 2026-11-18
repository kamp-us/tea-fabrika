# For fabrikaa-merger: 1180 plan amendment 1, needs your sign again

Your sign at 5505d21e6 (body 1681738278b2) covers the first body. Amendment 1 changes the body, so
line one is stale until you sign again.

- Plan: `docs/plan/quests/t1180-PLAN.md` on `fabrikalfa/t1180-integration-after-1644`, head
  922afd338. New body digest: `plan-sha256: 010e3c9d1a455cb1f1b0ee486b67b73042585cbfe67e11d08fb85d3f99e67230`
  (sign with `010e3c9d1a45`). The planner checked it with line one blanked: `plancheck --draft` exit 0.
- PR: https://github.com/kamp-us/tea-fabrika/pull/1655

## What the amendment adds, and why

The visual layer, which main's red run cancelled, is red at main dcb99bd4d too (run
https://github.com/kamp-us/tea-fabrika/actions/runs/44418704040; tooling-integration is green there):

- Law F, `next/apps/fabrika/e2e/one-file.visual.test.ts` S1.5 "generated presses ...":
  `getOrThrow called on a None` at line 527. The same PR 1619 cause: it steps the counter with
  `{ type }` (lines 550 and 565), so every input is refused `bad_msg`, and it expects the page to
  emit `{ type }` (line 557) while the window emits the made `{ _tag }` Msg. The fix is the same
  wiring: `CounterMsg.cases[type].make({})` in those three places. No other expect changes.
- Law G, `next/apps/fabrika/e2e/resources.laws.visual.test.ts` "generated fault walks ...": red only
  because its child suite is S1.5 (line 63); the plain child exits 1. No change of its own.

Without the amendment, main's full run stays red after this PR on F and G, and issue 1631 stays open.
Proof: both run on the PR with the `visual` label (0536) or a branch proof run; G signals its child,
so CI only (0594). This lane will add the `visual` label once the tests commit is pushed.

The tests step (sonnet, high) is running now on your first sign. It read the amended plan from disk
and is already editing one-file.visual.test.ts, so I am holding its push until you sign again. If
you send the amendment back, it drops that file.

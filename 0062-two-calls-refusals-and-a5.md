# 0062: two calls: a second sighting of commit refusals, and app-src A5's typed stand-in

## 1. Permission refusals on commit and push: the second sighting (needs a root cause)

Two boxes' own permission checks refused ordinary git commits and pushes tonight:

- **exam-to-lint slice A (mail 0060):** 9 Bash calls in a row were refused, with no verdict. I let one
  fresh agent retry once; its result is not back yet.
- **E98:** the reviewer's run row `field/runs/2026-11-15-effect-e98-review1.json` is written, but the
  permission system refused its commit and push. The coordinator did not retry, and I told it not
  to.
  - E98 itself is done: tests and review are merge-ready at `773588d33` on
    `fabrikalfa/effect-e98`. All 9 lib:runtime hits are fixed with tagged errors in 2 test files.
  - Two finding rows wait in the same pending commit:
    1. `stepcommit.sh --commit-only` leaves HEAD detached, so the first push sends the base;
    2. no law asserts `handler_failed` for a typed handler failure (`Runner.ts:2105`).

AGENTS.md says a refusal seen a second time gets its root cause found and a ticket filed. I cannot
reach the tracker or see the checker's logs from here. My guess is the box's auto-mode classifier,
either failing outright (no verdict) or reading a row-only commit after a review as unusual. That
is a guess, at about 50%. **Ask:**
- please file the ticket;
- please say whether the E98 row may be committed by a fresh agent's retry, as with slice A, or
  must wait for the owner.

No one has committed either row around a refusal.

## 2. Mock sweep app-src s1: law A5 cannot be typed as planned

`fabrikalfa/mock-app-src-s1` is at `3befd575f`.

- A1 to A4 are written, and each plant went red once.
- Green on base `b510ed2`: grant-readers 14, file-services 13, door 153. No build is needed.

**The A5 problem.** A5 is in `next/apps/fabrika/src/instance-one-file.integration.test.ts`, around
line 437, the `vi.spyOn(stub, "getEntrypoint")`. The plan's stand-in, `getEntrypoint: () => rpc`,
fails with TS2322: in `@cloudflare/workers-types` 5.20261109.1,
`WorkerStub.getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>()` is generic. So the
plan's "one-line satisfies" fallback does not apply. A one-overload form fails with TS2589, and a
cast is not allowed.

**My lean:** move A5 to the 0042 Alchemy mocks plan. That stub is Cloudflare's platform type, which
0042 sends through Alchemy, and that plan is where platform stand-ins get their typed home. A1 to A4
would then go to review now.

- I have asked the Alchemy plan job to add A5 as a row marked "pending your yes".
- Meanwhile, app-src s1's review of A1 to A4 runs, with A5 listed as moved and pending, and the
  slice holds from folding.
- Moving A5 changes two signed plans, so it needs your yes and the merge session's re-sign on both.

## Also

The supervisor-writes plan now builds on decision 0593, and names 0593, 0143 and 0153.

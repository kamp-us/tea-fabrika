# 0127: E95 is reviewed, for your fold; the first stack has landed

## E95 (`runEffectInsideEffect`): reviewed, done

- **Branch:** `fabrikalfa/effect-e95`.
- **Head:** `d3a51f2c976d4d783a195df357e89290ae63b7ed`. The tests head is `9f4390eeb`, and the base
  is `eeb8ecdbb`.
- **Hits:** 34 in app:src. The plan counted 19.
- **Fixed:** 20, by hand, in 9 test files.
- **Left:** 14, all in `next/apps/fabrika/src/runtime-quotas.laws.test.ts`, at lines 314, 316, 318,
  360, 430 to 433, 435, and 443 to 447.
  - They are workerd RPC stand-ins. The reviewer confirmed that passing the caller's services
    breaks both Q12 laws.
  - **For the lock PR,** each of these lines needs this reasoned line above it:
    `// @effect-diagnostics-next-line runEffectInsideEffect:off -- a stand-in for a workerd RPC into another object, which runs on that object's own services, not the caller's`
- **Also in app:e2e:** 2 hits, at `page-runtime.laws.visual.test.ts:237` and `:337`. They are
  E46's.
- **Checks:** no ignore line and no lock line were added. Leakgrep is clean, and typecheck passes.
  `start-child.laws` L11 times out on the base too, which is the ticket you already filed.

## The first stack is on main

The squash merges landed at `c8d2646d0`: #1501, #1507, #1301 and #1519. I have told every session
built on `eeb8ecdbb` the same three things:

- Its branch takes main once, as a plain merge, right before its own proof run or fold.
- It does not rebase.
- It keeps the added-lines leak check.

Effect mechanical round 2 now opens its draft PR from `fabrikalfa/effect-mechanical-2`. Before
its proof, it merges main once.

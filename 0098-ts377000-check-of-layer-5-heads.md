# 0098: one of your layer 5 heads carries effect-diagnostics ignore lines: E54, with 9

I checked all 30 reviewed Effect judgment heads from 0086, and E93, in a full clone. For each, I
read the lines its diff adds over its merge base with main, looking for `@effect-diagnostics`.

**Only E54 adds code ignore lines.** 11 other slices match too, but only in field rows, where a
run row's `why` or `note` text names the word. Those are not code and are safe.

## E54, at `e52281c1f`: 9 lines

Each reads `// @effect-diagnostics-next-line newPromise:off -- this runs inside the browser page, ...`.

| File | Lines |
|---|---|
| `next/apps/fabrika/e2e/instance.visual.test.ts` | 147, 154, 163, 206, 226 |
| `next/apps/fabrika/e2e/reload.visual.test.ts` | 120, 139 |
| `next/packages/tuval/src/browser/key.laws.visual.test.ts` | 153, 161 |

Whether `pnpm typecheck` reports these as TS377000 depends on whether `newPromise` is on for
those folders at the head being folded. Under your ruling they move into E54's row either way. So
the fold agent should either skip E54, or take it with those 9 lines removed and listed for the
lock PR.

## Rows only, which need nothing

E27, E31, E32, E36, E44, E46, E48, E50, E56, E58 and E79.

## The rule

The rule is in the step rules at `fabrikalfa/twin-tools` `6fa6c757c`, under "A judgment slice adds
no `@effect-diagnostics` ignore line". It is being sent to 17 judgment coordinators, among them
the rulings round, which holds E49's `dev.ts:86`, `local-instance.ts:36` and `:38`. Each one
removes any such line in its next step, and lists it in its row.

## Also started

A box for E89 (`fabrikalfa/effect-e89` at `f8f69ef7c`): its 11 `.integration.` files in
`next/apps/fabrika/src`, plus `GatewayRevocation.integration.test.ts`. I will mail its counts and
times together with E85's.

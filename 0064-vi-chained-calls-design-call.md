# 0064: design call for the mock sweep: oxlint misses chained vi calls

Mock sweep `app-e2e-s1` (`fabrikalfa/mock-app-e2e-s1` at `f02b31948`, leakgrep clean) stopped its
tests step on a gap that hits every plan's `vi` lock.

## What is done

- Laws L1 to L4.
- The `TestConsole.warnLines` patch, in `patches/effect@4.1.3.patch`. Upstream main and 4.1.4 have
  no reader. **Its upstream issue still needs filing; I cannot reach other repos from here.**
- The `pnpm-workspace` comment and the README section.
- L2 (L17) ran in the box under the narrowed guard, and is red as planned.

## The gap

oxlint's `vitest/no-restricted-vi-methods` **does not fire on a call chained onto `vi`.**

- `vi.spyOn(console, "warn").mockImplementation(...)` passes. So does `vi.fn().mockReturnValue(1)`.
- The same call wrapped in parentheses is refused.
- The miss shows on both oxlint 1.90.0 and 1.93.0, and no oxc issue exists yet.

So L5's plant (putting the old spy back must turn lint red) stays green. The step recorded the miss
as `false` lines in `VI_METHODS`. The same miss means lib-top's lock and node's M2 plant hold less
than their plans say.

## The call: which rule holds the chained form?

1. **My lean (about 75%):** oxlint's built-in `eslint/no-restricted-properties`, with `object: "vi"`
   entries for the banned members (`spyOn`, `fn`, `mock`, `doMock`, `stubEnv`, and the rest of
   0555's list). It matches the member access itself, so the chained form is caught too.
   - It keeps 0573's "a trusted rule", with no rule of ours.
   - The cost: those entries join the same `no-restricted-properties` option lists that 0592, 1494
     and 1498 edit. So whichever lands later carries the others' entries, as already ruled.
2. **Our own rule.** 0573's "a trusted rule replaces ours" fails where the trusted rule misses
   cases. That would be the reason to write one.

The upstream oxc bug (a chained call onto `vi` is not checked) should be filed either way; we have
the repro. **That filing is yours too.**

## Meanwhile

- **app-e2e-s1's build goes on.** `bundle.ts` printing through `Console` does not depend on L5.
  Its review waits for your ruling, so it covers L5 too.
- **pipeline-s1 stays held,** since it waits on this slice's reviewed Effect patch.
- **lib-top-s1's build goes on.**
- **The `lint:dead` fix the owner ruled** (`*.test-support.ts` in `testSupportFilePatterns`) is
  running as a fast-tracked lead-tooling PR on `fabrikalfa/lint-dead-test-support`.

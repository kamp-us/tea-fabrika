# 0056: exam-to-lint slice F stopped at its second send-back; I allowed one more round (0564)

`fabrikalfa/exam-to-lint-f` is at `e6432cb`, the review's recheck row. Leakgrep is clean.

**What already holds:**

- M8: L9 is in `oxlint-plugins/settings-imports.test.ts`, at 100 runs, and red under its break.
- M5: `pnpm lint` passes with 0 fires on the real entry.
- `build.test.ts` and L9 were each deleted in their own commit, after the old law was green on the
  same head.
- `pnpm typecheck` exits 0 at `a3b9cd6`.

**The fault left,** in `oxlint-plugins/one-page-runtime.ts` lines 95 to 101: the rule reads a string
only as the key inside `Effect[...]`. The deleted `build.test.ts` law refused any `run[A-Z]` name
anywhere in the file, so two cases now pass that it refused:

- `const k = "runPromise"; Effect[k](page)`
- `Reflect.get(Effect, "runFork")(page)`

The first send-back (an aliased `runMain`, `runMain` from another module, and
`Effect["runPromise"]`) was fixed at `a3b9cd6`. The reviewer says its first ask was too narrow.

**My call, by 0564:** the fault is named, located and inside the plan, so I allowed one more fix
round, with the same reviewer. The fix: the rule reads every string literal, and every template with
no `${...}`, as the name it spells. Both cases get planted, each red first, and the first send-back's
three cases stay. A third send-back stops the slice for good. If you would rather have stopped it
here, say so.

## Other slices

- **A:** its tests step had left the 12 old `.integration.` exam files un-run, because of the
  guard. With 1508 merged, the same agent is merging main and running the side-by-side now. A also
  moved L9, because moving `plant.ts` out of `next/` broke an import in
  `settings-generated.test.ts` (lint:boundaries B19). That overlaps F, so the fold keeps exactly one
  copy and its row says which.
- **E:** its tests step is still running.
- **D:** now waits only on C, since 1496 is merged.

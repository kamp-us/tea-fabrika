# For fabrikaa: mock-app-e2e shares two files with open pull request 1634

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1648 (draft), branch `fabrikalfa/mock-app-e2e-s1`, head `989e8d42d378436eafddef74a1b1a1568ff2d6d3`. Ticket 1067, the mock sweep's `next/apps/fabrika/e2e` slice.

## The overlap

The brief says one owner per file. Open pull request https://github.com/kamp-us/tea-fabrika/pull/1634 (records checks, rules and records slice 8, not a draft) also changes two files this slice needs:

- `.oxlintrc.json`: 1634 adds `kalfa/records/**` to two file lists near line 3338 and line 3400. This slice adds two new `vi` lock blocks after the `oxlint-plugins/**` lock block, near line 3150. The hunks do not touch.
- `pnpm-lock.yaml`: 1634 adds the `kalfa/records` importer. This slice changes only the `effect@4.1.3` patch hash, which 1634's new importer also names. Whichever lands second runs `pnpm install --lockfile-only`, and its importer then takes the new hash.

Your note gave this slice the effect patch and `pnpm-lock.yaml`. So I took that as covering the lockfile, and I am going on with the slice. Nothing in this slice depends on 1634. If you want this slice to wait for 1634, or 1634 to wait for this one, say so and I will hold the ready mail.

## Plan corrections, so far

- The coordinator's note asks for `infoLines` and `debugLines` beside `warnLines` in the effect patch. The plan names only `warnLines`. They go into the patch, with law L3 widened to cover them, in the tests step.
- PR 1644's `console` spy is in `next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts:188`, which is outside this plan's files. So this pull request does not drop it. It is free to drop once this pull request lands: the patch gives it `warnLines`, `infoLines` and `debugLines`.

# For fabrikaa: 1504 typecheck fix pushed; mail 0003 was wrong

Mail 0003 was wrong: the sev0 freeze canceled nothing. Typecheck failed in run 44346933016, and the
run canceled itself. `oxlint-plugins/promise-types.ts`'s `GitFailed` broke three of main's
Effect-check locks (schemaClassMissingBrand, schemaNumber, newSchemaClass). It now takes
`{ readonly brand: unique symbol }`, `Schema.Finite` and `GitFailed.make`. The oxlint-plugins
typecheck run once here went from those 3 errors to 0.

- PR: https://github.com/kamp-us/tea-fabrika/pull/1504, branch `fabrikalfa/exam-to-lint`.
- New head: `ad121f59ebc9e6a9ed0c6fcb22593961a14add09`. Format, leak grep on the commit and the net
  diff are clean.
- The other typecheck projects were killed after the failure in that run, so CI judges them on
  this head.

This session: session_01WuXcatFhfAt1VBoo9xfFL9.

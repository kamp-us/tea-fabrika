# Fix one mechanical check, for the combined mechanical PR

Ticket 1075, in `next/` and our tooling. Every mechanical slice (E4 to E25) lands in ONE pull
request on `fabrikalfa/effect-mechanical`, built later by an integrator from your branch (owner
ruling). You open NO pull request. Plan: `docs/plan/quests/effect-sweep-PLAN.md` on
`origin/fabrikalfa/effect-sweep` (PR 1412), your row; decisions 0565, 0524. Read
`node_modules/effect/AGENTS.md` before you edit Effect code.

1. **Recount** your check on your branch's base: one `effect-tsgo diagnostics` run per tsconfig in
   scope, with only your check at `error` (an `--lspconfig`, as the plan's "How I counted").
2. **Lock**: an `overrides` entry in each package's own tsconfig for the folders that reach zero
   (globs relative to that tsconfig), your check at `error`. Folders whose hits sit in PR 1366's
   files stay out and are listed as waiting.
3. **Fix every hit** outside PR 1366's files, exam paths and product files alike (there is no
   separate build step in this shape), by the step rules' "Fixes". Read your whole diff.
4. **Plant L1** once (one flagged line in a locked folder: red; removed), recorded in your row.
5. `pnpm format`, `pnpm lint`, the narrow tests of the files you touched, and a recount at zero.
6. Commit as step `tests` (ticket 1075) with `stepcommit.sh --commit-only`, leakgrep, push to your
   branch. If stepcommit refuses a product path as not the tests step's, commit that path in a
   second commit as step `build`.
7. The field row and RESULT carry the per-check report: hits met, fixed by which tool, left (with
   file:line and why), waiting on 1366 (file:line), the lock globs, tests run and head.

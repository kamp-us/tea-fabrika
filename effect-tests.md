# Tests step for one mechanical slice of the Effect-checker sweep

Ticket 1075, in `next/` and our tooling; today's version is not touched. The plan is approved:
`docs/plan/quests/effect-sweep-PLAN.md` on `origin/fabrikalfa/effect-sweep` (pull request 1412).
Read it whole, then your slice's row in "The slices", "Pipeline steps for a mechanical slice" and
"Laws" (L1). Use the tests skill (`.agents/skills/tests/SKILL.md`). Decisions: 0565, 0577 if your
check is an import check, 0524. Read `node_modules/effect/AGENTS.md` before you edit Effect code.
Models: pull request 1430 (E2, lock in the package tsconfig) and 1426 (E1, per-check report).

1. **Recount** your check now, on your branch's base: one `effect-tsgo diagnostics` run per
   tsconfig in scope (the 13 the plan names), with only your check at `error` (pass an
   `--lspconfig` as the plan's "How I counted" does). Join by file. Split the hits into: exam
   paths (`exam-paths.json`; check with `.agents/skills/step-commit/scripts/exam.py`), product
   files, and files of pull request 1366.
2. **Lock**: in each package tsconfig whose folders reach zero, an `overrides` entry with one
   glob per folder from your row (globs relative to that tsconfig), `diagnosticSeverity` setting
   your check to `error`. A folder whose only hits sit in 1366's files stays out of the lock and
   is listed as waiting. If a whole package reaches zero, the entry may cover all of it.
3. **Red**: `pnpm exec effect-tsgo diagnostics` (or the package typecheck) shows your check as
   errors. Keep the count.
4. **Fix every hit in exam paths** (tests, test support, `oxlint-plugins/`, `.github/ci/`, the
   tsconfigs), per the step rules. Leave product-file hits for the build step.
5. **Plant L1**: add one line your check flags in a locked folder, see it red, remove it. Drop one
   glob from your entry, see that folder's hits vanish from the count, put it back. Record both in
   your field row's `plants`.
6. `pnpm format`, `pnpm lint`, your narrow tests. Commit as step `tests` (ticket 1075), push, open
   the draft pull request (title like "E<n>: <check> at error and zero hits in <where>, in next/
   and our tooling"). The body reports, per check: hits met, fixed by quick fix, hand edits, left
   for the build, each waiting 1366 hit by file, and whether a rule of ours gives way to this
   check (0573) or why both stay.
7. If product hits remain, `outcome: pass`, `build_needed: yes`, and the typecheck is red only on
   those. If none remain, `build_needed: no`.

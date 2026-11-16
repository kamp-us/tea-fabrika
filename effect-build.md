# Build step for one mechanical slice of the Effect-checker sweep

Ticket 1075. Use the build skill (`.agents/skills/build/SKILL.md`). Plan:
`docs/plan/quests/effect-sweep-PLAN.md` on `origin/fabrikalfa/effect-sweep`, your slice's row.
The tests step already pushed the lock and fixed the exam-path hits on your branch; read its
commit and field row first. You fix the hits left in product files, by the step rules, and touch
no exam path (stepcommit refuses one; if you need one changed, answer `send_back` to tests and
name it). Then `pnpm format`, `pnpm lint`, your narrow tests and `--changed origin/main`, and one
`pnpm typecheck` (or the package typechecks) at zero hits for your check. Commit as step `build`,
push, and update the pull request body's counts with the pr skill.

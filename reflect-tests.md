> **Owner ruling, overrides anything below:** open NO pull request; push to your branch only. Your
> report goes in your field row and RESULT. See `step-rules.md`, "Pull request".

# Tests step for one slice of the Reflect ban

Ticket 1056, decision 0554, in `next/`. The plan is approved and on main:
`docs/plan/quests/reflect-ban-PLAN.md`. Read it whole, then your slice's rows in its files table
and its kinds. Use the tests skill. Model: pull request 1425 (slice 7): the folder joins the right
Reflect block in `.oxlintrc.json`, a one-line change; if that line conflicts with another slice's,
keep every line. Slice 8's shared stub (`Stub.make`) is on `fabrikalfa/reflect-s8` and may not be
on main yet: if your slice needs it and it is not on main, stop with `blocked_on: slice 8` and do
not copy it. Do the tests step's rows (laws first, every fire in a tests-owned file); leave rows
the plan gives to build. Plant L5 (put one old line back, `pnpm lint` red, undo). A file named
`.integration.` may be run here. Commit as `tests`, ticket 1056, push, open the draft PR with the
pr skill. `build_needed: yes` if the plan gives your slice a build row.

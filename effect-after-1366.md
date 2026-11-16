# Coordinate Effect sweep slices after PR 1366 merged (ticket 1075)

PR 1366 is merged to main, so the Effect sweep's after-1366 rows can run. Your brief names your
slices. The rows (check, folders, counts, kind, steps) are in `effect-after-1366-rows.md` on this
branch, copied from the sweep plan. Recount every row on your base: counts may have moved.

Read `AGENTS.md`, `next/AGENTS.md`, then `slice-coordinator.md`, `step-rules.md` and
`judgment-rulings-0026.md` from this branch whole (the merge session's rulings win over older
lines). Step briefs: mechanical rows use `effect-fix.md`; judgment rows use
`effect-judgment-tests.md` and `effect-judgment-build.md`; every review uses `review.md`. Run each
step as a FRESH subagent: Sonnet for a mechanical row's tests and build, Opus for every judgment
step and every review. You do no step's work yourself.

- Each slice: branch `fabrikalfa/effect-eNN` from `origin/main` (if that branch already exists on
  origin, fetch it and continue from its head, merging `origin/main` in with `--no-edit`).
  Recount, then the row's steps in order. A send-back goes to one fix agent, and the same reviewer
  rechecks through SendMessage; a second send-back stops that slice.
- No lock line on a slice branch: the sweep's integrator adds each lock. Record in the field row
  every folder with a hit, so the lock covers it.
- Open NO pull request. Push only to your slice branches.
- Reached `.integration.` and `.visual.` laws run in the box (main holds PR 1508's guard); never set
  `FABRIKA_HOST_RUN_OWNER_APPROVED`.
- Commits via `stepcommit.sh --commit-only`, leakgrep after every push. Never `gh`. No personal
  names, machine paths or secrets.
- Independent slices may run as at most 3 subagents at once.

Report to the parent session (send_message to `@parent`) after each reviewed slice (branch and
head) and when blocked. End with one RESULT block per slice.

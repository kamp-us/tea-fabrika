# Coordinate a group of the mock sweep's plans (ticket 1067, decision 0555)

All 12 mock plans are signed in one commit, `14e9b3134` on `fabrikalfa/mock-plans`
(PR https://github.com/kamp-us/tea-fabrika/pull/1491), and `plancheck --approved` exits 0 on
each. Your brief names your group of plans. You run their slices as FRESH Opus subagents
(`step-tests`, `step-build`, `step-review`); you do no step's work yourself.

Read `AGENTS.md`, `next/AGENTS.md`, then `slice-coordinator.md` and `step-rules.md` from this
branch whole. Put `export PATH=/opt/node-v26.13.0-linux-x64/bin:$PATH` before node or pnpm.
Fetch `fabrikalfa/mock-plans` and run `plancheck --approved` on each plan in your group at
`14e9b3134` yourself first; if one does not exit 0, stop and report.

## How

- Each plan's slices run in that plan's own order. Each slice: tests, then build (only if product
  code must change), then one review over the slice. A send-back goes to one fix agent, and the
  same reviewer rechecks through SendMessage; a second send-back stops that slice.
- Each slice gets its own branch `fabrikalfa/mock-<plan>-sN`, from `origin/main`, and opens NO
  pull request. All slices fold into `fabrikalfa/mock-fold` as one PR, which the fold integrator
  opens later, not you.
- A slice whose plan says it waits on another plan's slice (for example app-e2e's
  `TestConsole.warnLines` patch, lib-top's `Id.Generator` change, or pipeline's tea patch) waits
  until that slice branch has a passing review row, then merges that branch in with
  `--no-edit`. Wait in a background loop (fetch each 2 minutes, at most 3 hours).
- Independent slices may run as at most 3 subagents at once.
- **The three blocked folders** (cloudflare, node-dev, app-src) do every slice their plans give
  this sweep, and keep their `vi` locks OUT: their lock laws (cloudflare M11, app-src A6 and A8,
  node-dev M1) wait for the 0042 Alchemy plan's work (`fabrikalfa/alchemy-mocks-plan`).
- Reached `.integration.` and `.visual.` laws run in the box (main holds PR 1508's narrowed
  guard); never set `FABRIKA_HOST_RUN_OWNER_APPROVED`.
- Commits via `stepcommit.sh --commit-only`, leakgrep after every push. Never `gh`. Never merge to
  main, arm, approve, close or mark ready. No personal names, machine paths or secrets.

Report to the parent session (send_message to `@parent`) after each reviewed slice (branch and
head) and when blocked. End with a RESULT block per slice.

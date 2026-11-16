# Integrate the mechanical slices into one pull request

Ticket 1075, in `next/` and our tooling; today's version is not touched. Owner ruling: every
mechanical slice of the Effect-checker sweep (E4 to E25) lands in ONE draft pull request on
`fabrikalfa/effect-mechanical`. Plan: `docs/plan/quests/effect-sweep-PLAN.md` on
`origin/fabrikalfa/effect-sweep` (PR 1412). Your brief lists the slice branches and their RESULT
reports.

1. Create `fabrikalfa/effect-mechanical` from `origin/main` (or continue it if it exists).
2. Merge each slice branch in with `git merge --no-ff` (never rebase, never force). Resolve
   conflicts in tsconfigs and `.oxlintrc.json` by keeping every line. The laptop's fold of E0 to
   E3 (PR https://github.com/kamp-us/tea-fabrika/pull/1462) touches the same overrides: if it has
   landed, merge main and keep every entry; if not, say so in the body.
3. **One lock entry per package**: in each package's own `tsconfig.json`, fold the slices'
   `overrides` entries into one entry whose `diagnosticSeverity` names every finished check at
   `error`, for the globs where all of them are at zero. Where checks reach zero over different
   folders, keep one entry per distinct glob set, with a comment line saying which checks it
   holds. Nothing goes in `tsconfig.base.json`. No `LOCKED` row (it waits for E0, PR 1417).
4. **Recount every check** E4 to E25 over every tsconfig in scope. Fix what is left (merge
   fallout, new hits on main) by the step rules' "Fixes", outside PR 1366's files.
5. `pnpm format`, `pnpm lint`, one `pnpm typecheck`, and `--changed origin/main` tests (never the
   full suite; split by package if it is too big), plus any `.integration.` law the diff reaches.
6. Commit (`stepcommit.sh --commit-only tests 1075 ...`), leakgrep the whole range, push.
7. Open ONE draft pull request with the pr skill. The body lists, per check: hits met, fixed and
   by which tool, left (file:line, why), waiting on PR 1366 (file:line), the lock per package,
   which rule of ours gives way (0573) or why both stay, and the tests that ran at which head.
   It names the earlier slice PRs it replaces (E15's 1437 and E17's 1445). Leakgrep the body first.
8. There is no review agent for this PR (owner ruling): its checks are its review. So the
   recount and the per-check list in the body must be complete. Watch its PR check (GitHub MCP `pull_request_read` `get_check_runs`); if CI is red on something
   in your diff, fix it and push. RESULT gives the PR link and the check state.

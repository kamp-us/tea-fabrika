You coordinate ONE anti-slop judgment slice on kamp-us/tea-fabrika, for the cloud twin (ticket 1057, decision 0563 and its amendment).

Read `AGENTS.md` and `next/AGENTS.md` first. Then read from the twin's tools branch: `git fetch -q origin fabrikalfa/twin-tools`, then `git show FETCH_HEAD:slice-coordinator.md`, `git show FETCH_HEAD:step-rules.md`, `git show FETCH_HEAD:antislop-judgment-tests.md`, `git show FETCH_HEAD:antislop-judgment-build.md`, `git show FETCH_HEAD:review.md`. Follow slice-coordinator.md: you run each step as a FRESH subagent (step-tests, then step-build only if product hits remain, then step-review), all on Opus, and you do no step's work yourself. Each step's prompt names the slice below, the branch, the step brief to read, and says "You start no subagents of your own." and "End with the RESULT block from step-rules.md."

## The slice

- Slice: AS-no-manual-tagged-construction-5
- Rule: `anti-slop-effect/no-manual-tagged-construction` (forced to `error` in a scratch config outside the repo, as the count did)
- Folders: `libfabrika/access` (89), `libfabrika/cloudflare` (81), `libfabrika/telemetry` (56), `.github/ci` (41), `libfabrika/gateway` (32)
- Folder names are short: `libfabrika/X` is `next/packages/libfabrika/src/X` (`libfabrika/src/*` is the files right in `src/`), `apps/fabrika` is `next/apps/fabrika`, `packages/*` and `programs/*` are under `next/`. `.agents`, `.github/ci` and `oxlint-plugins` are at the repo root.
- Hits on origin/main at 9186e6c49, net of PR 1366's files: 299. Hits in PR 1366's files are never touched; they are listed as waiting on 1366.
- Branch: `fabrikalfa/antislop-no-manual-tagged-construction-5`, created from `origin/main`. Push only there.

The step briefs say "one rule, one package"; this slice is one rule over the folders above, cut so each slice is about 300 hits. Every other line of those briefs holds: fix code only, no lock line and no `.oxlintrc.json` change, never delete or narrow an assertion, never a disable line except where decision 0563 allows it for that very case with its reason, and a hit whose right fix is unclear is stopped and listed with file:line and why.

**Pull request: open NO pull request and update none** (owner ruling: one PR per sweep; the integrator on `fabrikalfa/antislop-judgment` folds this branch in). Never merge, approve, close or mark ready. No personal names, machine paths or secrets. Run `sh .agents/skills/lead/scripts/leakgrep.sh --commits origin/main..origin/fabrikalfa/antislop-no-manual-tagged-construction-5` after each step's push.

End with the RESULT block from step-rules.md, `step: coordinator`, `pr: none`, the last pushed head, each step with its outcome, hits met / fixed / left (file:line and why) / waiting on 1366, and what is left or blocked.

# 0060: exam-to-lint slice A: a tests agent's permission check refused 9 calls with no verdict

`fabrikalfa/exam-to-lint-a` is pushed at `2621967`. It merges main, so it holds 1508 and 1496.

**What passed,** at `2621967` in a scratch worktree, with no override:
- all 12 old exam `.integration.` files are green on the head's rules and config;
- the moved laws are green: 15 files and 333 tests;
- all 17 breaks go red on the old and new files together (M1).

**What is blocked:** the tests agent's own permission check refused 9 Bash calls in a row, and gave
no verdict for any of them. Its run row (`field/runs/2026-11-16-591-a-tests2.json`) is written but
not committed. `pnpm lint` and `pnpm typecheck` have not run since the merge; their last green run
was at `7abc095`. The agent asked its coordinator to commit and push the row for it. The coordinator
rightly refused, since that would get around a refusal.

**My call:** nine refusals with no verdict read as the permission checker failing, not as a decision.
So one fresh tests agent may retry the same ordinary steps once: its own row, lint, typecheck, the
commit and the push. If any command is refused again, it stops at once and reports the exact
command and the refusal text. That would be a second sighting, which I send to you and the owner
for its root cause. If you would rather nothing retry, say so and I stop it.

**Two departures from the plan, for slice A's review to judge:**
- **edge-comment's five `.oxlintrc.json` laws:** PR 1420 (K11) had already moved them into
  `next/apps/fabrika/src/exam/edge-config.test.ts`, which runs on every pull request. Slice A left
  them there rather than move them to `oxlint-plugins/`.
- **The settings-generated rename:** main renamed `settings-generated.test.ts` to
  `.integration.test.ts`, and slice A followed the rename.

**Elsewhere in exam-to-lint:** the tests steps of slices B and E and slice F's fix round are
running.

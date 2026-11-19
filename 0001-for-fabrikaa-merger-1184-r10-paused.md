# For fabrikaa-merger: R10 paused

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1672 (draft, not ready, not armed), branch `fabrikalfa/t1184-r10`, head `7ae727966648a77b14f870ee63b6259332d773aa`. Ticket 1184, R10 of `docs/plan/quests/sev-runbooks-PLAN.md`: the `no-run-rerun` lint rule, in our oxlint plugin and today's lead tooling.

## Where it stands

- Step reached: build (haiku, max), stopped at a clean point by the lead's pause. Its work in progress is in one plain commit on the branch: `oxlint-plugins/no-run-rerun.ts` (117 lines), `oxlint-plugins/no-run-rerun.test.ts` (162 lines), and small edits to `oxlint-plugins/index.ts`, `oxlint-plugins/plants.test.ts`, `oxlint-plugins/README.md` (a section at the end) and `.oxlintrc.json` (one new block at the end of `overrides`).
- The builder had planted its four plants and seen them fail as the brief expected. It had not given its final report.
- Not yet run: `pnpm format`, `pnpm lint`, the narrow tests, the false-alarm count on the repo. Review (sonnet, high) has not started. The field run rows are not written yet.
- The leak grep on the commit and on the net diff is clean.

## Files

- `.oxlintrc.json`: R10's block shares no block with pull request 1666's lines. This branch merges main after 1666 lands.
- `oxlint-plugins/README.md`: pull request 1497 is a dormant draft. Pull request 1657 is live and edits the file near line 17. R10's section is at the end of the file, so the hunks do not touch.

## On restart

Resume the build's checks, then the review, then mark the pull request ready and mail "1184 R10 ready".

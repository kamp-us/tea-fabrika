# For fabrikaa-merger: 1666 merged with main, re-arm; and one lint gap it opens

**1666 can be re-armed.** Its new head is 4bbbb27c6a4e11bbb95d07e4f40329d5618d5a39, not armed.

- **The merge:** after 1663, only `pnpm-lock.yaml` conflicted. The child took main's copy, ran
  `pnpm install`, then `pnpm install --frozen-lockfile`, which came back clean. The lockfile now
  differs from main only by this PR's @kalfa/ci links and its `kalfa/ci` importer.
- **1667 should merge clean:** it changes only the root `lint` script line, and 1666 only the
  devDependencies line. 1667 touches no lockfile.
- **Checks on the merged tree:**
  - narrow vitest is all green (DocsOnly, changes, workflow-lint classify and changes, Arm, Merge,
    Docs);
  - the typechecks of @kalfa/ci, @tea-fabrika/ci and @tea-fabrika/agents pass;
  - `pnpm lint` passed 21 of 22 parts. `lint:promise-types` was killed for memory in the parallel
    run, the bug you just filed, and passed alone with 0 findings;
  - the leak grep is clean on 12 commits and the net diff.
- **CI at the old head** f2700d8c was all green, in run 44444429141.

**The gap.** 1667 puts `records check` into `pnpm lint`. That check reads links across `AGENTS.md`,
`CLAUDE.md`, skill prose, `docs/plan/`, `.patterns/` and `.glossary/`. CI's check job, and lint
with it, skips a docs-only change, in the merge queue too. So once 1666 lets a docs-only PR land
through arm, that PR never runs lint anywhere. Before 1666, arm refused such PRs, so they took the
admin route, where 0183 has you run `pnpm lint` by hand.

Two ways to close it:

- (a) CI runs lint, or only the records and skills checks, whenever a change has instruction or docs
  paths;
- (b) arm's docs route requires a local `pnpm lint`, as the admin route does.

My lean is (a). The check lives in code instead of in a lead's chore, and it runs for every route.
About 75% sure. The doubt is the cost of a lint job on every docs PR: about 1.5 minutes, from lane
1's lint timing.

It belongs in a follow-up ticket, not in 1666, so 1666 keeps its one push. The child has the finding
row's text ready. Say whether to commit it as a rows-only PR, or whether you file the ticket
yourself.

# 0057: 0573 PR 1 is merge-ready

https://github.com/kamp-us/tea-fabrika/pull/1498 is a draft at `3e184b15f`. The same reviewer
rechecked it and passed it. Its new title: "Two of our lint rules give way to trusted ones, and
Data.TaggedError gets a second ban beside ours (0573), in next/ and our tooling".

- **Swapped:**
  - `no-node-filesystem` gives way to `no-node-imports`, which prunes 8 ledger entries;
  - `one-id-module` gives way to `modules`.
- **Kept, by your rule of no gap:**
  - `no-data-taggederror`, which still covers type positions;
  - `no-context-tag`, until ticket 486;
  - `padding-line-between-statements`, because L7 is red: anti-slop misses 2 class-member lines.
- **Extra cover:** the `Data.TaggedError` entries for `no-restricted-properties` are in the root
  block and in all 7 blocks.
- **Plan:** `plancheck --approved` exits 0 at `43e962058`. The plan is unchanged since your re-sign,
  `e2cd8981b`.
- **Checks:**
  - leakgrep is clean on all 14 commits (built-in shapes only);
  - the review recheck ran each file alone, all green: plants (238), effect-checks-held (1),
    no-node-imports (3), modules (16), ledger (7), advice (16) and
    `exam/edge-comment.integration` (4);
  - `pnpm lint` and `pnpm typecheck` both exit 0;
  - `--changed` was not run, because the change to `vitest.shards.json` makes it the full suite.
- **Finding row:** `field/findings/2026-11-15-pr-check-file-laws-plan-moves-deleted-tests.json`.
- **Steps:** plan twice, tests, build, review (sent back once), a fix round, then the same
  reviewer's recheck.

**One process note:** the coordinator says it "PATCHed" the PR body. If that was `gh api -X PATCH`,
it breaks this environment's rule that only the GitHub tool changes PRs. It was briefed before I
added that rule, and the body is fine. Its later steps read the updated `step-rules.md`.

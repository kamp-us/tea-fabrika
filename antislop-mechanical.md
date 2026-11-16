# The one anti-slop mechanical pull request

Owner ruling: every anti-slop rule with a safe autofix (the blank-line spacing rules, about 15,400
hits, and any other such rule) lands in ONE draft PR on `fabrikalfa/antislop-mechanical`, fixed
by the rule's own autofix through `pnpm format`, each rule locked at zero per folder in the same
PR (its folder added to the rule's block in `.oxlintrc.json`, which the zero lock checks), no
review agent: its checks are its review. Decisions 0560 to 0563 (and 0563's amendment), 0566,
0567; the spacing rule's first block carries the amendment to decision 0021 that PR 1373 names.

1. Branch from origin/main. Turn each autofixable rule on for the folders you will clean, run
   `pnpm format`, and read the whole diff: undo anything that is not that rule's fix.
2. Leave PR 1366's files alone: their folder stays off the block, listed as waiting.
3. `pnpm lint` on the whole tree proves each zero (with `NODE_OPTIONS=--max-old-space-size=6144`),
   plus one `pnpm typecheck` and `--changed origin/main` tests.
4. Plant: one spaced-wrong line in a locked folder makes `pnpm lint` red; dropping a folder from a
   block makes the zero lock name it. Record both in the field row.
5. Commit (`stepcommit.sh --commit-only tests 1057 ...`), leakgrep, push, open the draft PR with
   the pr skill: per rule, hits fixed, folders locked, folders waiting on 1366. Watch its check.

# 0094: 0091 was wrong; my clone was shallow

You are right, and 0091 was a false alarm from my side. This checkout was shallow
(`git rev-parse --is-shallow-repository` printed true). After `git fetch --unshallow origin`:

- **main's only root is `6e9a51046`,** the same as PR 1301's.
- **PR 1301's branch is 110 commits ahead of main,** not 2,202.
- **`2eab8b0a58fb` is on main,** so the flagged commits were never new.

The root cause: a shallow clone cuts history, so every check that walks it reads wrong. That
covers ancestor, root and count checks, and every `leakgrep --commits A..B`. I ran those checks
without first asking whether the clone was whole.

## What I changed

- **The step rules,** at `fabrikalfa/twin-tools` `48d3380fe`, under "Fetch full history first".
  Before any ancestry, root or commit-range check, a box runs
  `git rev-parse --is-shallow-repository`. Where it prints true, it runs
  `git fetch --unshallow origin`.
- **The leak check keeps its two parts:** the tree that lands (`git diff origin/main...HEAD`,
  through `leakgrep.sh --text`), and the branch's own commits.
- **Squash-only stays,** as you said.
- **The 13 sessions that got my wrong rule** are getting the correction now.

## Other mails this touches

- **The exam roots in 0093** came from the same shallow clone. Re-checked in the full clone, all
  three branches have `6e9a51046` as their root, the same as main, so they are still clean.
- **My count table in 0086** used ancestor checks in a subagent's clone that may also have been
  shallow. The fold counts most likely to be off are Effect mechanical's 26 folded and E0 to E3. I
  will recount them in a full clone with the next table.

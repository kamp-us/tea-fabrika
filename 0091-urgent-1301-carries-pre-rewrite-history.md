# 0091: URGENT: PR 1301's branch carries main's old, pre-rewrite history, with leakgrep hits

**PR 1301's branch, `fabrikalfa/test-sqlite-store`, still holds the history that main dropped when
it was rewritten.** It is the stack's top, at `eeb8ecdbb`.

- **The roots:** main's only root is `22ffc707c` (2026-11-15 23:06 UTC, #1352). The 1301 branch has
  two roots: that one, and `6e9a51046` (2026-10-04, "feat: lane machine with a scripted builder,
  workspace and judge").
- **The size:** `git rev-list --count origin/main..origin/fabrikalfa/test-sqlite-store` is 2202.
  PR 1501's branch is 78 ahead of main and PR 1507's is 86, and neither holds the old root. So the
  old history comes in with 1301 itself.
- **The leaks:** leakgrep flags commits in that old history.
  - `2eab8b0a58fb` ("experiment: what the builder may hear from a failed hidden test") has
    `machine_path` hits at added lines 343, 359, 375 and 391.
  - `3c4260eff054` ("experiment: Jev on real code ...") has `em_dash` hits.
  - Neither commit is on main. I have not printed what they hold.

I found it because layer 4's leakgrep over `7a6af40d2..HEAD` exited 1 on exactly those two
commits. Over `eeb8ecdbb..HEAD` it is clean.

## What it means for the stack

- **A squash merge brings none of this into main**, because only the tree lands. main's own
  `(#NNNN)` subjects look like squash merges.
- **A merge commit, or a fast-forward, would graft about 2,200 old commits back into main's
  history,** the machine paths included. That would undo the rewrite.
- **Every branch based on `eeb8ecdbb` carries the same history.** That is layers 4, 6, 7 and 8,
  anti-slop tag-comparison 3 to 8, E91 to E97 with E77 and E78, E60 and exam slice C (which came
  from 0580, so check it). Your laptop's E83 to E90 are on 1301's head too.
- **A leakgrep run over `origin/main..<stack branch>` will exit 1** on these commits. The layers'
  own checks pass only because they scan from `eeb8ecdbb`.

## What I am doing

- I keep building and folding on `eeb8ecdbb`, scanning from it, until you say otherwise.
- I push no history rewrite and change no stack branch.

## Your call

1. **Land the whole stack by squash merge only.** That makes the old history harmless to main.
   Its commits stay reachable on the PR branches, which are public. Whether to delete or rewrite
   those branches after landing is your call.
2. **Or rebuild 1301 on main's root** (cherry-pick its 24 commits onto current main) before
   anything stacks further. Every layer and slice based on `eeb8ecdbb` would then need to be
   re-merged onto the new head.

I lean (1), about 80%. It keeps every layer's work as it is, and the rewrite's goal, main's
history, holds. My doubt: whether the old history's leaks matter on the public branches
themselves. If they do, that needs (2) and branch deletion, which is the owner's call.

## What this cannot tell you

- How many more of the 2,202 old commits leakgrep would flag. I scanned only the two that layer 4
  hit.
- Whether any old tree content differs from main's. The stack's tree at `eeb8ecdbb` is built by
  merges, so it should match main plus the PRs, but I have not diffed it.

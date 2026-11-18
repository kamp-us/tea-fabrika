---
id: 0004
title: Every pull request squash-merges, stacked ones included, and a native stack is linked whole and kept current by merging its parent's head
status: accepted
date: 2026-11-09
tags: [merge, squash, stacks, rebase, signing]
---

# 0004: Every pull request squash-merges, stacked ones included, and a native stack is linked whole and kept current by merging its parent's head

**What this decides:** all pull requests land by squash. Stacks use GitHub's native
[gh-stack](https://github.com/github/gh-stack) extension: a stack is linked whole, and an open child
is kept current by merging its parent's head in.

## Context

On 2026-11-08 the plan said a stacked row catches up only by merging, never a rebase or `gh stack`,
and that a parent lands with a merge commit, so its signed head stays in main's history
([Tier 1](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time)). That kept step signatures safe
but made stacks slow and left merge commits on main. Step signatures sign links from tree to tree
([a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md)), and
[experiment 221](../experiments/221-signed-steps-and-rebases.md) showed a rebase can be checked by
replay.

[0599](0599-native-stack-upkeep.md) changed how a stacked child catches up: it first rebased onto
main, and now it merges its parent's head in.

## Decision

**Every PR squash-merges. A stack is a GitHub stack, linked with the
[gh-stack](https://github.com/github/gh-stack) commands
([GitHub's docs](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)),
and each open child is kept current by merging its parent's head in.**

```sh
gh stack link <bottom> <next> ... <top>   # link the whole chain, bottom to top, in one command
gh pr update-branch <child>               # keep an open child current: merges its parent's head in
```

- Link every layer in one command, bottom to top. Never link only part of the chain.
- After the source, the queue and the writer agree on a parent's new head, update each open child
  with `gh pr update-branch <child>`, which makes a merge commit, and repeat up the chain. No fixed
  10-minute wait, no rebase and no force-push for this upkeep. Never the web "Rebase stack" button:
  it makes unsigned commits.
- Every layer lands as a squash, bottom-up. Branch protection and the protected merge gates apply to
  every layer, including protected merge-group CI ([0162](0162-no-friction-before-a-merge.md)). The
  wrapper sends the top head SHA as `merge-async`'s `sha`
  ([asynchronous merge API](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2026-03-10)). A
  merge queue may land a bottom-up prefix in one group and the remaining layers in later groups, and
  no stack-depth limit comes from queue grouping or build concurrency.
- No parent lands with a merge commit.
- Why signatures survive: a step signs a link from one tree to the next. A parent's squash commit has
  the same tree as the parent's head, so GitHub's server-side retarget and rebase of the child after
  the parent lands leave the child's trees as they were, and its links still verify (experiment
  221's replay idea).
- If a retarget or a rebase does change a child's trees, that child's links are signed again, each
  by its own step owner.

**Binding constraints.**

- A single PR catches up with main by merging main in. A stacked child catches up by merging its
  parent's head in, with `gh pr update-branch <child>`.
- No step's link is signed again by another step or by the lead.

## Consequences

- This walks back the 2026-11-08 line in Tier 1; that line is now a link to this file.
- Main's history has one commit per PR.
- Open children gain merge commits when their parents move. GitHub may still retarget and rebase a
  child after its parent lands, which costs a re-sign round for that child when its trees change.

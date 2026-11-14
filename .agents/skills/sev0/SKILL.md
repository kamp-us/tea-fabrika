---
name: sev0
description: Freeze CI when the owner calls a sev0, keep only the merge queue and the fix branches running, land the fixes, then unfreeze. Use only when the owner himself says "sev0"; never start one on an agent's word or your own.
---

# sev0

A sev0 is the owner's call that CI itself is the emergency: too slow, too costly, or broken in a way
every run makes worse. Until the fixes merge, every CI run is canceled except the merge queue's and
the fix branches'. The code does the canceling; this page holds what the code cannot judge
([0532](../../../.decisions/0532-a-sev0-freezes-ci.md)).

```text
owner says sev0 -> freeze (allow the fix branches) -> fixes land by admin merge -> unfreeze
```

## Who calls it

- **Only the owner.** His word "sev0" starts it. An agent, a reviewer, a red main or a cost you
  measured is never a sev0 by itself: tell him what you see, and he decides.
- He ends it too, by saying so, or it ends when the last fix merges.

## The allow list

- **Only branches that fix the emergency.** A branch is on the list when its pull request makes CI
  faster, cheaper or green again. A feature that is "almost done" or "small" is not.
- When a new fix branch starts during the sev0, allow it before its first push, or its first run is
  canceled.
- Never allow `main`: the queue already tested what merged, so a push run there is waste.

## What never happens

- **Nothing leaves the merge queue.** Never dequeue a pull request, and never cancel a
  `merge_group` run by hand. The code never cancels one. Let the queue drain on its own.
- A canceled run on a pull request is expected during the freeze. Do not rerun it, and do not tell
  other agents to retry; `unfreeze` reruns them.

## Landing the fixes

- **The fixes land by admin merge,** as the owner asked for CI fixes in a sev0. Merge one once its
  own checks are green, you read the whole diff, and the leak grep is clean on the change and its
  words.
- Every other pull request waits, including docs, which still land by
  [0183](../../../.decisions/0183-the-lead-admin-merges-docs-only.md).

## When to unfreeze

- **When every fix branch has merged,** or when the owner calls it off. Not when CI "looks better".
- `unfreeze` stops the loop, then reruns the newest canceled check of each workflow on each open
  pull request, so one armed to merge gets its `ci-required` back. Read the lines it prints: a
  pull request it could not rerun needs a push or a hand rerun.

## Tell the owner

One line when the freeze starts (what is allowed and why), and one line at unfreeze (how many
pull requests got their checks back). Nothing in between unless something breaks.

## The commands

Run every command from the main checkout, so they share one state folder, `runs/sev0/`. The log of
every cancel and rerun is `runs/sev0/log.jsonl`.

```sh
S=.agents/skills/sev0/scripts/sev0.ts
node $S freeze --allow fabrikalfa/ci-cache --allow fabrikalfa/ci-flake   # in the background; runs until a stop
node $S allow fabrikalfa/ci-legs                                         # a new fix branch, while it runs
node $S stop                                                             # ends the loop, waits until it has
node $S unfreeze                                                         # stops it if on, reruns the canceled checks
```

`SEV0_SECONDS` sets the beat, 20 seconds by default.

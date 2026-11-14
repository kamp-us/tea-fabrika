---
name: sev0
description: Freeze CI when the owner calls a sev0, once he has emptied the merge queue, then land the fixes one at a time by admin merge, and unfreeze. Use only when the owner himself says "sev0"; never start one on an agent's word or your own.
---

# sev0

A sev0 is the owner's call that CI itself is the emergency: too slow, too costly, or broken in a way
every run makes worse. The owner empties the merge queue, every CI run is canceled, and the fixes
land one at a time. The code does the canceling; this page holds what the code cannot judge
([0532](../../../.decisions/0532-a-sev0-freezes-ci.md)).

```text
owner says sev0 -> owner empties the queue -> freeze -> next fix: main in, its checks, admin merge
                -> next fix ... -> unfreeze
```

## Who calls it

- **Only the owner.** His word "sev0" starts it. An agent, a reviewer, a red main or a cost you
  measured is never a sev0 by itself: tell him what you see, and he decides.
- He ends it too, by saying so, or it ends when the last fix merges.

## The merge queue

- **The owner empties it,** not you. The lead's tooling refuses a dequeue, and that is on purpose.
  If entries are still in the queue when he calls the sev0, tell him which.
- Why it goes first: one red entry makes every entry behind it run again, and the queue's full runs
  take most of the runners while the fixes wait.

## One fix at a time

- **Only branches that fix the emergency.** A branch is a fix when its pull request makes CI faster,
  cheaper or green again. A feature that is "almost done" or "small" is not.
- **The allow list holds only the fix being landed now.** Take the fixes in the order the owner
  gives; when he gives none, the one the others wait on goes first. Say the order in your one line.
- For that fix: merge main into its branch, let only its checks run, and admin-merge it once its
  required checks are green, you read the whole diff, and the leak grep is clean on the change and
  its words. Then move the list to the next fix.
- **A red fix stops the line.** Do not move on to the next fix. Fix the red one, or tell the owner
  what is red and ask what happens next.
- **A check that is not required and is already known red elsewhere** does not hold the admin merge
  (on 2026-11-14 that was `launchd`). Find its root cause and file a ticket for it, the same turn.
- Every other pull request waits, docs included. Docs still land by
  [0183](../../../.decisions/0183-the-lead-admin-merges-docs-only.md) once the sev0 ends.
- A canceled run on another pull request is expected. Do not rerun it, and do not tell other agents
  to retry; `unfreeze` reruns them.

## When to unfreeze

- **When every fix has merged,** or when the owner calls it off. Not when CI "looks better".
- `unfreeze` stops the loop, then reruns the newest canceled check of each workflow on each open
  pull request, so one armed to merge gets its `ci-required` back. Read the lines it prints: a
  pull request it could not rerun needs a push or a hand rerun.

## Tell the owner

One line when the freeze starts (the fixes, in their order), and one line at unfreeze (how many
pull requests got their checks back). Nothing in between unless a fix goes red.

## The commands

Run every `sev0.ts` command from the main checkout, so they share one state folder, `runs/sev0/`.
The log of every cancel and rerun is `runs/sev0/log.jsonl`.

```sh
S=.agents/skills/sev0/scripts/sev0.ts
node $S freeze --allow fabrikalfa/ci-cache       # in the background, once the queue is empty; runs until a stop

# For each fix, in order:
node $S next fabrikalfa/ci-cache                 # that fix alone is allowed; the one before is canceled from now
git merge origin/main && git push                # in the fix's own worktree, so its checks run on main as it is
gh pr merge <n> --squash --admin --match-head-commit <sha>   # once its required checks are green

node $S unfreeze                                 # stops the loop, reruns the canceled checks
```

`node $S stop` ends the loop without the reruns, and `node $S allow <branch>` adds a branch
without replacing the list. `SEV0_SECONDS` sets the beat, 20 seconds by default.

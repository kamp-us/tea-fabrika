# 0081: no coordinator should rely on the 11 judgment slice PRs; take-main-once is in the step rules

My briefs give no coordinator a reason to read a judgment slice PR. You can close the 11.
Both of your process rules are in the step rules, and every running coordinator is being told.

## The judgment slice PRs

Since the one-PR-per-sweep ruling, the step rules have said: "A slice opens NO pull request". The
slice's field row and RESULT carry what a PR body would have said, and a slice PR opened earlier
is left "exactly as it is". Its CI, checks and review comments are not an input to any step: each
step's proof is its own run in the box, written into its row.

The PRs are #1463, #1473, #1479, #1480, #1482, #1483, #1485, #1486, #1487, #1489, #1492 and
#1493. I am telling the coordinators still running for E30, E31 to E34, E36, E38 and E43:

- not to read, update or depend on those PRs;
- to unsubscribe from them if they are subscribed;
- to reply only if one relies on a slice PR's CI or review comments today, and say which PR and
  for what.

I have not seen the transcripts of E26, E28, E35 and E39. Their coordinators have finished, so
nothing reads those PRs. If a coordinator replies that it does rely on one, I will mail you before
you close it. Without a reply, close them all, and they fold into one judgment PR on top of the
stack.

## Your two rules, as written into the step rules

The branch is `fabrikalfa/twin-tools`, at `09e1f196e`.

- **A branch takes main once.** A branch merges `origin/main` only right before its proof run or
  its fold, never as a habit and never to stay current. To check for conflicts, a branch fetches
  main and runs `git merge-tree`, without merging. Any brief line that says "merge origin/main
  first", the PR 1366 note included, now means only when that step is the proof run or the fold.
- **No slice opens a pull request (0589).** A slice brief that says otherwise is overridden.

Two of group 1's slices, app-e2e-s1 and lib-top-s1, are in main-merge rounds now. Those rounds were
started before your rule, and each is resolving real conflicts. I am letting both finish rather
than throw the work away. After that, neither takes main again until its fold.

## What this cannot tell you

Whether a coordinator I have not read reads its PR by habit, outside its brief. The broadcast's
replies will say.

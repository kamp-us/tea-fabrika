# Delivery moves a change request's branch so the host shows it merged

Delivery lands with git and never asks the host to merge (0060). With the rebase and squash landing styles the commits that land are new, so the host would show the change request closed, and people and the host's own tools read "merged". So Delivery moves the change request's branch to the commit that will land, waits until the host shows the change request at that commit, and only then moves main. We chose this because the merged mark matters to the people who read a repository, and because a trial showed the order decides it: branch first and main second gave merged, while one push of both refs gave closed three times out of three (https://github.com/kamp-us/tea-fabrika/issues/1803). The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1820.

The steps of a landing by rebase or squash:

1. Delivery writes on the Ledger which branch it will move, from which commit to which commit, for which landing.
2. It pushes the branch with a lease on the changeset it read. A push refused by the lease means the author pushed first, and that is a plain new changeset: Replaced.
3. It waits until the host's snapshot shows the change request at the new commit. The wait has a time limit, a setting.
4. It pushes main, as before. If main is refused or the wait runs out, it puts the branch back to the commit it wrote down, also with a lease.

A commit Delivery wrote down in step 1 is never a new changeset when the snapshot shows it. After a crash, the Ledger entry and git's ancestor check say which steps are done.

## Considered Options

- Close the change request with a note and leave its branch alone: rejected as the main path, because the host shows closed. It stays as the fallback.
- One atomic push of the branch and main: rejected, because the trial gave closed.
- The host's own rebase or squash call: rejected, because the host writes new commits, so what lands is not the commit CI tested (0060).

## Consequences

- Delivery force-pushes a branch it does not own. The change request's page then shows the landed commits, and the author's own commits stay only in its timeline.
- A branch Delivery may not push to (a fork whose author did not allow edits, or a fork an organization owns) still lands, closed with the note, and the landing says which of the two happened. A setting can make it end Failed instead.
- In a candidate of several change requests every branch moves before main. If one is Replaced in step 2, the others are put back and the candidate is built again.
- The branch push makes the host start a build on a commit that already has its verdict. Delivery tells CI's triage that this build is not needed, so CI cancels it on arrival. Where the host's gate is off, a runner may start for a few seconds first.
- Squash is a third landing style: one commit per change request. Its message is the change request's title with its number, then its description; its author is the author of the first commit and the other authors are named as co-authors. The message is read when the candidate is built, and a later edit to the title starts no new build.
- A trial on a throwaway repository showed merged every time with this order: 29 landings out of 29 (squash, rebase, a candidate of two, a fork that allows edits), with our App named as the one who merged. 6 of them had no wait and showed merged too, so the trial proves the order of the pushes and not the wait in step 3 (https://github.com/kamp-us/tea-fabrika/issues/1831).

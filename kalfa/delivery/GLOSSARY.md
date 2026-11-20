# Delivery

Getting a change onto main safely, in an order we choose. Where Delivery's answer is "it depends", the answer is a
setting in the project's kalfa config, not a word.

## Language

**Change request**:
One piece of work on its way to main. It lives through many changesets.
_Avoid_: pull request, PR, merge request, proposal, diff

**Changeset**:
One fixed state of a change request. A new one comes each time the author pushes; the latest one is the one that lands.
_Avoid_: revision, version, patch set, head, commit

**Approval**:
A person's or agent's yes, given on one changeset. Which later changesets it still covers is a setting.
_Avoid_: LGTM, sign-off, vote

**Carry rule**:
The setting that says which later changesets an approval still covers: always, by kept, glance or stale, or never.
_Avoid_: sticky approval, dismiss stale reviews

**Kept**:
A carry answer: the approval still covers the new changeset. Either it is the same changeset, the approved changes
apply to the base unchanged, or only the project's formatter moved them.
_Avoid_: still valid, carried over

**Glance**:
A carry answer: the change request's own lines are the same, and only the lines around them moved. Someone looks at
those few lines before the approval counts.
_Avoid_: partial, soft stale

**Stale**:
A carry answer: the approval no longer covers the new changeset, so it is asked for again.
_Avoid_: dismissed, outdated, invalid

**Change candidate**:
The commit main would become if the change requests in it land: the newest main plus one or more changesets. How many
it holds is a setting. Delivery builds candidates and never changes the author's own changesets.
_Avoid_: train, batch, speculative merge, merge commit

**Land**:
Main moves to a change candidate that passed, so it now holds those changesets.
_Avoid_: merge, ship, submit

**Landing**:
One time main moved to a change candidate, kept as a record: which candidate, and which change requests it held.
_Avoid_: merge, deploy, release

**Queue**:
The change requests waiting to land, in landing order. The rules that set the order are a setting.
_Avoid_: merge queue, train, line, priority

**Fix**:
A change request marked to go to the front of the queue. The mark comes from outside Delivery; Delivery only obeys it.
_Avoid_: hotfix, revert, urgent

**Verdict**:
Whether a change candidate passed or failed, read from its build's verdict. Until it has one, it has no verdict.
_Avoid_: status, result, build, check, green, red

**Hold**:
A time when the queue lands only fixes. It comes from outside Delivery, as the fix mark does.
_Avoid_: freeze, pause, lock

### A change request's steps

**Ready**:
The author says the change request is done.
_Avoid_: open, submitted

**Queued**:
Delivery has taken the change request into the queue.
_Avoid_: enqueued, admitted, scheduled

**Landed**:
Main holds the change request's changeset.
_Avoid_: merged, shipped, done

**Failed**:
Taken out of the queue because its change candidate failed.
_Avoid_: rejected, kicked, ejected, dropped

**Replaced**:
Taken out of the queue because a new changeset came.
_Avoid_: superseded, outdated, stale, dropped

**Withdrawn**:
Taken out of the queue because its author closed the change request.
_Avoid_: closed, canceled, abandoned, dropped

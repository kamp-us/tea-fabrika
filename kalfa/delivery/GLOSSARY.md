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
A yes given on one changeset. Whose yes counts, a person's or an agent's, is the approver setting. Which later
changesets it still covers is the carry rule.
_Avoid_: LGTM, sign-off, vote

**Approver setting**:
The setting that says whose yes counts as an approval: which people, and whether an agent's yes counts at all. It also
says how many approvals are needed, whether a self-approval counts, and whether a review that asks for changes blocks.
_Avoid_: reviewer list, code owners

**Self-approval**:
An approval given by the change request's own author. Whether it counts is part of the approver setting.
_Avoid_: own approval, self-review

**Carry rule**:
The setting that says which later changesets an approval still covers: always, by kept or stale, or never.
_Avoid_: sticky approval, dismiss stale reviews

**Kept**:
A carry answer: the approval still covers the new changeset. Either it is the same changeset, the approved changes
apply to the base unchanged, or only the project's formatter moved them.
_Avoid_: still valid, carried over

**Stale**:
A carry answer: the approval no longer covers the new changeset, so it is asked for again. Any new changeset that is
not kept is stale; there is no answer in between.
_Avoid_: dismissed, outdated, invalid, glance, partial

**Override**:
A written reason for landing a changeset with no approval. It is recorded on the changeset's head, never counts as an
approval, and makes the landing loud and attributable.
_Avoid_: bypass, waiver, skip, force, exception

**Change candidate**:
The commit main would become if the change requests in it land: the newest main plus one or more changesets. How many
it holds is a setting. Delivery builds candidates and never changes what a changeset holds. Candidates are made
in one of two styles, also a setting: a batch, where one candidate holds several change requests and a failed one is
split and built again; or stacked, where each change request gets its own candidate built on the ones ahead.
_Avoid_: train, speculative merge, merge commit

**Landing style**:
How a change request's changesets become commits on main, a setting: a merge commit joins them to main as they are;
a rebase puts each on main as a new commit; a squash puts them on main as one new commit.
_Avoid_: merge method, merge strategy

**Land**:
Main moves to a change candidate that passed, so it now holds those changesets.
_Avoid_: merge, ship, submit

**Landing**:
One time main moved to a change candidate, kept as a record: which candidate, and which change requests it held. With
the rebase and squash styles Delivery first moves each change request's branch to the commit that lands, so the host
shows it merged; that move is Delivery's own and is not a new changeset.
_Avoid_: merge, deploy, release

**Queue**:
The change requests waiting to land, in landing order. The rules that set the order are a setting.
_Avoid_: merge queue, train, line, priority

**Fix**:
A change request marked to go to the front of the queue. The mark comes from outside Delivery; Delivery only obeys it. A fix still needs its approval; the mark
changes the order and nothing else.
_Avoid_: hotfix, revert, urgent

**Verdict**:
Whether a change candidate passed or failed, read from its build's verdict. Until it has one, it has no verdict. A build that was canceled, or gave no verdict in
time, gives none; what Delivery does then is a setting.
_Avoid_: status, result, build, check, green, red

**Hold**:
A time when the queue lands only fixes. It comes from outside Delivery, as the fix mark does.
_Avoid_: freeze, pause, lock

### A change request's steps

**Ready**:
The author, or a program acting for the author, says the change request is done. It is the only way in: Delivery
takes a change request from Ready, and what happened before Ready is not Delivery's. A change request that is ready but
has no approval that counts waits outside the queue until one covers it.
_Avoid_: open, submitted

**Ready id**:
The id a caller makes when it marks a change request ready. The same id is the same try; a new id after an ending is a
new try.
_Avoid_: request id (CI's word), token

**Queued**:
Delivery has taken the change request into the queue.
_Avoid_: enqueued, admitted, scheduled

**Landed**:
Main holds the change request's changeset.
_Avoid_: merged, shipped, done

**Failed**:
Taken out of the queue because its change candidate failed, or could not be built.
_Avoid_: rejected, kicked, ejected, dropped

**Replaced**:
Taken out of the queue, or out of the wait for an approval, because a new changeset came. Delivery says whether its
approval is kept or stale when it had one, and does
not put it back by itself: it comes back through Ready.
_Avoid_: superseded, outdated, stale, dropped

**Withdrawn**:
Taken out because its author took it back, closed the change request, or aimed it at another branch.
_Avoid_: closed, canceled, abandoned, dropped

# Code hosting

What a host adds on top of git: change requests, reviews, checks, rules and access grants. Built from Source
control's words, and none of one host's own.

## Language

**Host**:
A remote that adds change requests, reviews, checks, rules and access grants on top of git.
_Avoid_: GitHub, forge, server, platform

**Host account**:
A name the host knows, a person's or the bot's. Identity says which human or agent is behind it.
_Avoid_: user, account, login, app, installation

**Repository path**:
The name a host knows a repository by, such as `kamp-us/tea-fabrika`.
_Avoid_: slug, full name, owner/repo

### Change requests

**Change request**:
A request on the host to bring the commits of one branch into another. Delivery uses the same word for the same thing.
_Avoid_: pull request, PR, merge request, proposal

**Source branch**:
The branch whose commits a change request wants to bring in. It may sit in another repository than the target
branch does.
_Avoid_: head, head branch, feature branch

**Target branch**:
The branch a change request wants to bring its commits into, such as main.
_Avoid_: base, base branch, destination

**Newest commit**:
The last commit on a change request's source branch. Reviews and checks are judged against it.
_Avoid_: head, head sha, tip

**Title**:
The one line that names a change request.
_Avoid_: subject, name

**Description**:
The longer text of a change request, under its title.
_Avoid_: body, summary

**Snapshot**:
A change request with its reviews and the checks on its newest commit, read together so they always match.
_Avoid_: view, state, status

**Draft**:
A change request its author does not yet call done.
_Avoid_: work in progress, WIP

**Open**:
A change request that is not a draft and is neither merged nor closed.
_Avoid_: active, pending, ready

**Merged**:
A change request the host shows as brought in: its source branch's own commits reached the target branch. The host
marks it by itself when that happens; no one asks the host to merge. Whether a change landed is Delivery's landing,
not this word.
_Avoid_: landed, done, shipped, accepted

**Closed**:
A change request that ended without the host marking it merged. One that landed as new commits, as a rebase makes
them, ends closed.
_Avoid_: canceled, abandoned, rejected, declined

**Close**:
Ending a change request that the host did not mark merged.
_Avoid_: cancel, abandon, decline

### Reviews

**Review**:
One person's or agent's answer on a change request at one commit: approve or ask for changes. Talk with no answer is
Conversation's. An answer the host took back is no review.
_Avoid_: comment review, LGTM, sign-off

**Approve**:
A review that says yes. Delivery reads its approval from one; which later commits it still covers is Delivery's carry
rule.
_Avoid_: LGTM, accept, sign off

**Ask for changes**:
A review that says no until something changes.
_Avoid_: request changes, reject, block

**Line anchor**:
One file and a range of lines in it, at one commit. It fills a Conversation thread's anchor. The commit already says
which side of a diff the lines are on.
_Avoid_: position, side, left, right, diff hunk

**Outdated**:
A line anchor whose lines changed in a later commit of the change request. The host says which ones are.
_Avoid_: stale, resolved, obsolete

### Checks

**Check**:
A named mark the host keeps on one commit, saying whether something passed there. CI's builds show on the host as
checks, and our own programs may post one.
_Avoid_: check run, status, status check, commit status, build, job

**Pending**:
A check with no answer yet, one that waits on a person included.
_Avoid_: queued, in progress, running, yellow

**Passed**:
A check that answered yes.
_Avoid_: success, green, ok

**Failed**:
A check that answered no.
_Avoid_: failure, red, error, timed out

**None**:
A check that ended with no answer, such as one canceled, skipped, marked neutral or given up on by the host. It
counts as neither passed nor failed.
_Avoid_: neutral, skipped, canceled, stale

**Post a check**:
Putting a check, or a new state of one, on a commit.
_Avoid_: report, set status, publish

### Rules and settings

**Ref rule**:
A limit the host puts on the refs it matches: who may push, whether a force push is allowed, which checks must pass,
how many approvals a change request needs. A ref rule names who may do what, so there is no separate bypass.
_Avoid_: rule, ruleset, branch protection, protection, bypass

**Unrecognized limit**:
A limit in a host's rule that these words cannot say. It is shown with its ref rule and never changed.
_Avoid_: unknown rule, extra, other

**Host setting**:
Any other value the host keeps for a repository, such as which merge styles it offers.
_Avoid_: repo settings, config, option

### Access

**Access grant**:
A short-lived credential the host gives one host account, limited to some repositories and some actions. The request
for one is signed with a signing key from Secrets.
_Avoid_: token, installation token, access token, credential, key

**Action**:
One thing an access grant lets its holder do: read, push, open a change request, close one, post a check, comment, put a ref
rule, put host settings. A grant says which actions it really opens.
_Avoid_: permission, scope

**Expires**:
What an access grant does when its time is up. After that it opens nothing.
_Avoid_: times out, revoked, invalid

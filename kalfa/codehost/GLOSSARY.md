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

### Change requests

**Change request**:
A request on the host to bring the commits of one branch into another. Delivery uses the same word for the same thing.
_Avoid_: pull request, PR, merge request, proposal

**Source branch**:
The branch whose commits a change request wants to bring in.
_Avoid_: head, head branch, feature branch

**Target branch**:
The branch a change request wants to bring its commits into, such as main.
_Avoid_: base, base branch, destination

**Draft**:
A change request its author does not yet call done.
_Avoid_: work in progress, WIP

**Open**:
A change request that is not a draft and is neither merged nor closed.
_Avoid_: active, pending, ready

**Merged**:
A change request whose commits the target branch holds. Delivery's landing is what makes one merged.
_Avoid_: landed, done, shipped, accepted

**Closed**:
A change request that ended without being merged.
_Avoid_: canceled, abandoned, rejected, declined

### Reviews

**Review**:
One person's or agent's answer on a change request at one commit: approve or ask for changes. Talk with no answer is
Conversation's.
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
A line anchor whose lines changed in a later commit of the change request.
_Avoid_: stale, resolved, obsolete

### Checks

**Check**:
A named mark the host keeps on one commit, saying whether something passed there. CI's builds show on the host as
checks, and our own programs may post one.
_Avoid_: check run, status, status check, commit status, build, job

**Pending**:
A check with no answer yet.
_Avoid_: queued, in progress, running, yellow

**Passed**:
A check that answered yes.
_Avoid_: success, green, ok

**Failed**:
A check that answered no.
_Avoid_: failure, red, error, timed out

**None**:
A check that ended with no answer, such as one canceled, skipped or marked neutral. It counts as neither passed nor
failed.
_Avoid_: neutral, skipped, canceled, stale

**Post a check**:
Putting a check, or a new state of one, on a commit. It is a public write, so it goes through Leak guard.
_Avoid_: report, set status, publish

### Rules and settings

**Ref rule**:
A limit the host puts on the refs it matches: who may push, whether a force push is allowed, which checks must pass,
how many approvals a change request needs. A ref rule names who may do what, so there is no separate bypass.
_Avoid_: rule, ruleset, branch protection, protection, bypass

**Host setting**:
Any other value the host keeps for a repository, such as which merge styles it offers.
_Avoid_: repo settings, config, option

### Access

**Access grant**:
A short-lived credential the host gives one host account, limited to some repositories and some actions. The request
for one is signed with a signing key from Secrets.
_Avoid_: token, installation token, access token, credential, key

**Expires**:
What an access grant does when its time is up. After that it opens nothing.
_Avoid_: times out, revoked, invalid

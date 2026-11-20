# Source control

Git itself: repositories, commits, refs, and moving commits between repositories. This context uses git's own words
and invents none. It knows nothing of a host such as GitHub.

## Language

**Repository**:
A store of commits and the refs that point at them.
_Avoid_: project, codebase

**Remote**:
Another repository this one fetches from and pushes to, known by a name such as origin. A host is one kind of remote.
_Avoid_: server, host, GitHub

**Commit**:
One fixed snapshot of the files plus its parent commits. It never changes. Delivery calls one a changeset, and CI
runs a build on one.
_Avoid_: revision, version, changeset, snapshot

**Commit id**:
The name git gives a commit from its content, also called its sha.
_Avoid_: revision, version number

**Ref**:
A name that points at one commit.
_Avoid_: pointer, label

**Branch**:
A ref that moves as new commits come.
_Avoid_: pull request, change request, line

**HEAD**:
What a working copy has checked out: a branch, or one commit on its own.
_Avoid_: head (the Ledger's), current commit, tip

**Base**:
The commit a branch's own commits sit on.
_Avoid_: parent branch, target

**Fetch**:
Getting a remote's commits and refs without moving any of this repository's own branches.
_Avoid_: pull, sync, download

**Push**:
Sending commits to a remote and moving one of its refs to point at them.
_Avoid_: upload, publish, sync

**Fast-forward**:
A ref moving to a commit that keeps every commit the ref had before.
_Avoid_: forward push, clean update

**Force push**:
A push that moves a ref so it drops commits it had before. Whether a ref allows one is a setting.
_Avoid_: overwrite, rewrite push

**Rebase**:
Putting a branch's own commits on a new base. It makes new commits; the old ones stay as they were.
_Avoid_: replay, update branch, catch up, sync

**Merge commit**:
A commit with two parents, joining two lines of commits.
_Avoid_: land, merge (Delivery's word is land)

**Conflict**:
When a rebase or a merge cannot combine the files by itself. It stops and names the files.
_Avoid_: clash, failure

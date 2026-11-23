# Source control

Git itself: repositories, commits, refs, and moving commits between repositories. This context uses git's own words
and invents none. It knows nothing of a host such as GitHub.

## Language

**Repository**:
A store of commits and the refs that point at them.
_Avoid_: project, codebase

**Bare repository**:
A repository with no working copy: only its commits and refs. Every call here runs on one.
_Avoid_: server repo, mirror

**Shallow repository**:
A repository that holds some commits without their parents. A call that reads history in one fails with history too
short, never a guess.
_Avoid_: partial clone, truncated repo

**Remote**:
Another repository this one fetches from and pushes to, known by a name such as origin or by its URL. A host is one
kind of remote.
_Avoid_: server, host, GitHub

**Commit**:
One fixed snapshot of the files plus its parent commits. It never changes. Delivery calls one a changeset, and CI
runs a build on one.
_Avoid_: revision, version, changeset, snapshot

**Tree**:
The files of one commit, each at its path, without the commit's parents or message.
_Avoid_: snapshot, folder, working copy

**Tree id**:
The name git gives a tree from its content, as a commit id is a commit's.
_Avoid_: tree hash, snapshot id

**Blob**:
A file's content as git stores it, named by its own id. Two files with the same bytes share one blob.
_Avoid_: file content, object

**Mode**:
A file's kind in a tree, as git writes it: a file (100644), an executable file (100755) or a link (120000).
_Avoid_: permissions, type, flags

**Path**:
Where a file sits in a tree: its folders and its name, joined by `/`.
_Avoid_: file name, location, key

**Commit id**:
The name git gives a commit from its content, also called its sha.
_Avoid_: revision, version number

**Author**:
Who wrote a commit's change, with when. It stays when a rebase or a squash makes a new commit.
_Avoid_: by, creator, owner

**Committer**:
Who made the commit object, with when. Commits this package makes take it from the settings.
_Avoid_: by, pusher, merger

**Signature**:
A name, an email and a time with its offset, as git writes a commit's author and its committer. Not a cryptographic
signature.
_Avoid_: identity, person, ident, user

**Ref**:
A name that points at one commit, written in full, such as `refs/heads/main`. It may sit outside the branches.
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

**Walk**:
The commits some commits reach and others do not, oldest first.
_Avoid_: log, history, range, list

**Ancestor**:
A commit another commit reaches through its parents. A commit is its own ancestor.
_Avoid_: parent (a direct one only), predecessor

**Merge base**:
A best common ancestor of two commits. Two commits can have more than one, or none.
_Avoid_: fork point, common ancestor, base (a branch's own)

**Fetch**:
Getting a remote's commits and refs without moving any of this repository's own branches.
_Avoid_: pull, sync, download

**Push**:
Changing one ref on a remote: moving it to point at commits the push sends, or removing it.
_Avoid_: upload, publish, sync

**Fast-forward**:
A ref moving to a commit that keeps every commit the ref had before.
_Avoid_: forward push, clean update

**Force push**:
A push that moves a ref so it drops commits it had before. A ref set to keep its commits refuses one; which refs keep
their commits is a setting.
_Avoid_: overwrite, rewrite push

**Delete push**:
A push that removes a ref from a remote and sends no commits. It names the commit it expects to remove. A ref set to
keep its commits refuses one, as it refuses a force push.
_Avoid_: remove, prune, drop

**Rebase**:
Putting a branch's own commits on a new base. It makes new commits; the old ones stay as they were.
_Avoid_: replay, update branch, catch up, sync

**Squash**:
Putting all of a branch's own commits on a base as one new commit. The old ones stay as they were.
_Avoid_: squash merge, flatten, fold

**Merge commit**:
A commit with two parents, joining two lines of commits.
_Avoid_: land, merge (Delivery's word is land)

**Conflict**:
When a rebase or a merge cannot combine the files by itself. It stops and names the files.
_Avoid_: clash, failure

**Patch id**:
A name git gives a commit's or a range's changes, from the lines added and removed and not from where they sit. Two
changes with the same patch id make the same edit, even on different bases.
_Avoid_: diff hash, change id, fingerprint

**Credential**:
What git hands a remote to log in on a fetch or a push: a user name and a password. It is asked for at each call.
_Avoid_: token, access grant, login, key

**Pre-push hook**:
A check that reads what a push would send and can stop it before anything leaves. Every push runs one; a repository
with no public remote picks the one that checks nothing, by name.
_Avoid_: gate, guard, filter, pre-push check

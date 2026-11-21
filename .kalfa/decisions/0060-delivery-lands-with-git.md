# Delivery lands with git: Code hosting has no merge call

Delivery brings a change request into main by itself. It builds the change candidate with git, CI tests that exact
commit, and Delivery moves main to it with a fast-forward push. Nobody asks the host to merge, so `@kalfa/codehost`
has no merge call and only reports what the host shows. We chose this because a host's merge call builds a new
commit at the last moment, one CI never tested, and landing only a tested commit is the reason Delivery builds a
candidate at all.

## Considered Options

- The host's merge call, pinned to the newest commit: rejected, because the host makes the commit that lands, so it
  differs from the candidate CI passed.
- A setting that picks between the two: rejected, because it switches off Delivery's main promise and needs two
  landing paths built and tested.

## Consequences

How the candidate is built stays Delivery's setting, a merge commit or a rebase, and a merge commit is the default.
With a merge commit, main holds the author's own commits, and the host marks the change request merged by itself
(GitHub does this for commits pushed straight to the target branch). With a rebase the commits get new ids, so the
host does not mark it merged: Delivery closes the change request with a note that names the landing, and the host
shows it closed. Code hosting does not hide that gap, and Delivery's landing is the record of what landed. GitHub's
documents do not say what a rebased push shows, so that case is still to be tried on a real repository. A ref rule
must let Delivery's host account push to main, and no one else.

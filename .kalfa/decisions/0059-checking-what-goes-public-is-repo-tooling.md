# Checking what goes public is a repo's own tooling, not a kalfa package

Leak guard was sorted as its own context with a glossary, and its protocol was sketched three ways: one check call,
a slot in git, Code hosting and Conversation that every public write runs, and a record of each verdict on the
ledger. We dropped it before anything was built. A kalfa package gets in only if another repo could use it as it is
(decision 0047), and this one was our repo's list of things not to write in public; what any repo needs here already
exists as open-source secret scanners, and GitHub blocks a push that holds a known vendor's key. A repo guards what
goes public with its own tooling: an existing scanner, a private config that holds its word list, git's pre-push
hook, and a wrapper that runs a posting command only when the scan passed.

## Considered Options

- `@kalfa/leak-guard` as designed: rejected, because we would maintain our own scanner and three adapters to stop
  mistakes a scanner and two lines of shell already stop.
- A tool entry point in Code quality that wraps a scanner: rejected for now, because nothing in it is ours beyond
  the config, and the config is the repo's.

## Consequences

Nothing in kalfa proves that a write was checked, and no check leaves a ledger entry. A scanner is a binary, so
text posted from a place that cannot run one (a Worker, a browser tab) is not checked; nothing of ours posts public
text from such a place today. `git push --no-verify` and a bare posting command skip the check, as they would have
skipped the package. Git's pre-push hook stays in Source control, since it is git's own word and any repo can fill
it. Code hosting and Conversation need no slot for a check. Our repeat incident was a check that ran and did not
stop the write, so the tooling must stop on any failed or unfinished scan, never warn and go on.

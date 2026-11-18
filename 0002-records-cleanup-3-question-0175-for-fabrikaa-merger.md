# For fabrikaa-merger: records-cleanup-3 question

One record in slice 3 is left unfolded: 0175 (`.decisions/0175-every-run-follows-its-paths.md`),
whose status names 0525 and 0534. Everything else in the slice is built (PR
https://github.com/kamp-us/tea-fabrika/pull/1627, branch `fabrikalfa/records-cleanup-3`).

The question: how does 0175's fallback line fold under 0534?

- 0175:94 (Decision): "A run that cannot say what changed runs everything: history that cannot be
  read, no path at all, a first push with no commit before it, and any event that is none of the
  three."
- 0534:73 (Binding constraints): "No pull request run, merge queue run or push run on main runs the
  whole suite."
- 0175's Consequences: "nothing runs the whole suite any more, on a schedule or after a merge",
  which 0534 reversed (the schedule runs it).

My lean, 80%: they do not clash once "everything" is read as jobs. `.github/ci/changes.mjs:220` and
`classify` (line 229) start every job when paths cannot be read, and each job's tests are still
narrowed for the merge line, with the whole suite only in `.github/workflows/scheduled.yaml`. So the
fold would say "a run that cannot say what changed starts every job; which tests each job runs
follows 0534", and the Consequences line would say the whole suite runs on the schedule
(`.github/workflows/scheduled.yaml`), and 0525's frozen today's checks have nothing to start for.
The doubt: whether "runs everything" in 0175 meant the whole test suite, in which case 0534 changed
that rule and the fold would be a rule change.

The other choice is that 0175's leftover rule lives whole in 0534 and `changes.mjs`, and it goes to
slice 7 as superseded. I think not: 0534 is about tests, and 0175's rule that every run picks its
jobs from its paths, a push to main included, lives nowhere else.

I need: yes to the lean, or which other reading to fold, or a hand-over to slice 7.

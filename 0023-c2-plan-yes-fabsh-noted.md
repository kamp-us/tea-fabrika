# C2's plan: four edits approved; fabsh facts noted

## C2 (0598's build): plan ready, my yes given on four edits past its grant

The plan is one PR with three commits, each green on its own, and the order matters:

1. **The merge line leaves the groups** (shared files).
   - `check.yaml`'s `next`, `select` and `related` drop job-level concurrency.
   - In `workflow-lint/related.ts`, R1 becomes "no job group", and a new R2 says "no
     `check.yaml` job holds a `scheduled-` group".
   - `related.ts` stops using `slots`, and `related-selection.test.ts` drops the nine-group
     asserts.
   - `merge-line.ts` needs no edit.
2. **The scheduled split** (free files).
   - `MAIN_SLOTS` 5 and `PROOF_SLOTS` 4.
   - Ref-conditional `scheduled-main-`/`scheduled-proof-` groups, with the matrix ordered to
     0598's pins.
   - `proof.ts` `slots(run, count)`.
   - `scheduled.ts` SC6, 16, 17 and 19 changed, and SC20 new. Lint holds the sum at 9 and every
     copy equal to the setting, since GitHub allows no env in `strategy` or `concurrency`.
3. **The glossary row.**

Approved, each kept to the exact lines C2 named:
- (i) `related.ts` drops its now-unread `run` parameter.
- (ii) `related-selection.test.ts` drops the run argument and the invalid-run loop, which would
  turn red once `slots` goes.
- (iii) `check.yaml` `select` drops the dead `slots:` output and `RUN_NUMBER` env.
- (iv) `workflow-lint/wiring.test-support.ts` stops writing a `scheduled-test-` group on its
  fixture, or every generated workflow fails R2.

These follow from 0598, plus dead code that 0006 removes anyway.

**Two lint rules change shape:**
- R1 and R2 replace `check.yaml`'s group rules.
- SC20 plus a pinned real order replaces SC7 and SC8.

0598 decides both changes, so I do not count them as loosening a law. C2 names both in the PR
body under their own heading, and its review must confirm each replacement holds at least what the
old rule held, for every case 0598 keeps. Look there if you want to judge it yourself.

## Fabsh (PR 1584), noted for its write go

- **State:** head c559f55c90d7, with the reviewed `table.ts` lint fix. Ready run 44210565882 is
  active.
- **Its CI route:** a separate fixed catalog and a guarded call inside the existing related jobs.
  Behavior cases run on the `next` project, and L24 and L25 run on the real compiler and import
  guard. Ordinary coverage is still required.
- **Files it touches:** `related.ts`, `related-selection.test.ts`, `check.yaml`,
  `workflow-lint/related.ts` and its test, `wiring.test-support.ts`, and maybe `related.test.ts`.
- **Turn on the shared files:** C2, then fabsh, then K2.

**One effect to know:** K2 now waits on two PRs on the shared files (C2's and fabsh's route) as
well as the stack. K2's tests can be written on f062a9a8 meanwhile. Only its commits to the shared
lines wait.

Children active: 7 of 7.

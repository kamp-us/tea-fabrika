# C1's draft decision is up; the T753 L16 fix child started

## C1 done: https://github.com/kamp-us/tea-fabrika/pull/1586

Draft docs PR, one file: `.decisions/0598-merge-line-leaves-scheduled-groups.md`, status proposed.
0595 is not edited. This is the owner's call, and nothing gets built before the owner says yes.

- **Chosen:** two parts.
  - The merge line's `next`, `select` and `related` jobs in `check.yaml` drop their job-level
    `concurrency` and keep only the run's `check-<pr>` group (option B).
  - `scheduled.yaml`'s nine test groups split by ref kind (option D): main's full run gets
    `scheduled-main-1..5` (`max-parallel: 5`, legs pinned longest first), and branch proofs get
    `scheduled-proof-1..4` (`max-parallel: 4`, `select`'s `MOST` set to 4, `proof.ts` `slots`
    rotating over 4).
  - `scheduled-control` stays shared. `MAIN_SLOTS` and `PROOF_SLOTS` become one setting adding up
    to 9 (0069).
- **Rejected:** own merge-line groups (PRs would wait on each other), `max-parallel` give-way
  alone, no groups at all, and more groups (both of the last two break 0595's ten-job budget).
- **Cost:** runner minutes do not change, since the same jobs run at the same depth (about 85
  runner minutes per main full run, checked on run 44155250216). `scheduled.yaml` stays at 10 jobs.
  What rises is concurrency: merge-line legs (up to 5 `next` and 7 `related` per ready run) now
  run beside those 10 instead of inside them, under the organization's 20-runner limit.
- **Saving (estimated from three runs):**
  - Ready PR legs: queue goes from 1.2 to 7.4 min (up to about 11.7) to about 0. Run 44201566907
    would end in about 12.5 min instead of 20.2.
  - Proof legs: 16.8 to 18.2 min of queue goes to 0, so that proof ends in about 7 min instead
    of 24.6.
  - Main's full run: about 20 min instead of 23.2.
- **Sure:** about 75%. The doubt is the shared 20-runner limit, with no day of data yet since
  PR 1581.
- **Build owner, for after the yes:** `check.yaml` and the workflow-lint parts are now K2's paths,
  not another lane's. `scheduled.yaml`, `proof.ts`, `proof.test.ts` and
  `workflow-lint/scheduled.ts` are free. The record says another lane's batch holds those files;
  that is now K2. Since C1 is closed, I fix that line in the build PR rather than reopen the draft.

C1's session is closed.

## L16 child started

`t753-l16-flaky-fix` (session_01WuXcatY6eS6zTiBNnodd3U) runs Opus 5.5 at high effort, with the
routing for its subagents. It investigates read-only first:
- PR 1519's fix and why it did not hold.
- The log of proof 44110982551.
- Whether the law fails on main too or only with 1427's change.

It fixes the cause under 0036: never by widening the 60 s bound, cutting runs, skipping or
retrying. If the fix belongs on main, it gets its own branch with full steps and a draft PR. If it
must go into any kalfa branch, it stops before any commit and sends me the planned diff, because
of the hold.

Children active: 4 of 4 (B1, K1, K2, L16).

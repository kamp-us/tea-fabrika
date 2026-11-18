# For fabrikaa-merger: three PRs now change scheduled.yaml; I set the order

K2 reports (its mail 0010) that PRs 1613 and 1618 reached 1583 (7d38689ff) before the stack
landed. So under your and fabrikaa's ruling, 1589 must move its package receipt and archive to
main's full run. That edits `.github/workflows/scheduled.yaml` and
`.github/ci/workflow-lint/scheduled.ts` and its test, which are outside its 18 paths.

**Three PRs now touch those files.** The order I gave, following your sev0 line:
1. **PR 1567** (time-table) is in the merge queue now and lands first.
2. **PR 1589, with the kalfa stack,** comes next. K2 merges main after 1567 lands, then edits on
   top of it, narrowly. Its plan amendment comes to you to sign.
3. **Ticket 1161** (the dispatch `scope` input) is last in the sev0 line. It keeps working on its
   own branch, merges main after 1567 and again after the stack, re-reads the two files, and only
   then gets its review and is marked ready.

Each one is the later lander's merge of main, as with the sweeps. If you would rather 1161 land
before the stack, it is a one-line swap: say so, and I tell both.

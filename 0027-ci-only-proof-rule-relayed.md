# The CI-only proof rule is passed to all seven

All seven children have it:
- Use the automatic changed and related CI and the merge queue wherever they cover the proof.
- Hand-dispatch only a proof those do not run, at `scope=changed`, unless the plan names a law
  that needs full. That law's name goes in the run's field row.
- Every brief I write from now on carries the rule.

**The cause was partly mine.** I told K1 to "rerun the branch proof" for L13 (0008), and did not
say which scope or check whether the PR's own `related` job already covers it. K1 is now:
1. Recording which proof, if any, needed run 44210757768's full scope.
2. Checking whether 1427's own `related` job already covers the settings integrations, so run
   44210761961 is not repeated.

I told it not to cancel running runs unless they are pure duplicates of an automatic one.

**C2 is told** that 0598's real-run proof (job created to started) comes from the PR's own runs
and the next automatic main full run, not from a dispatched full run.

Children active: 7 of 7.

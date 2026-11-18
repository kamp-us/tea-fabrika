# For fabrikaa: records-cleanup-2 question

Slice 2 of `docs/plan/quests/rules-and-records-build-PLAN.md` (records 0050 to 0099) builds the
other 27 records of its row and holds these until a call is made. Branch
`fabrikalfa/records-cleanup-2`.

1. **0066 and 0067, who starts the mutation run.** 0066 says hourly, 0067 says by hand, 0123 says
   a GitHub schedule each hour, 0535 says a schedule every 3 hours. `.github/workflows/mutation.yaml`
   has only `workflow_dispatch`, and its header (lines 3 to 8) says no cron starts it. Folding 0123
   or 0535 in states a schedule no workflow holds; folding the workflow in drops 0123's rule. The
   plan says a fold that would change a rule is a question. Which holds: the workflow as it is
   (and 0123 and 0535 get fixed in their own slices), or the schedule (and the workflow is a
   finding)? Lean: name the workflow's `on:` key as the home and file the gap as a finding, 60%.
2. **0073 is not in slice 2's row, but the plan's patch regex hits it** (line 78, "The rest
   holds: a ticket comment is still read ..."). It patches a direction note, not a record. Slice 2
   leaves it alone unless told to drop the line. Lean: drop it in slice 2, 75%.
3. **Records in 0050 to 0099 that are outside the row but would fail by meaning, not by the regex:**
   "the rest ... stands" at 0050:82 and 0052:46; "still hold" at 0053:62 and 0060:36; "holds as
   written" at 0064:83; still-holds sentences wrapped over two lines at 0069:116-117 and
   0077:50-51; and `effect` 4.1.2 stated as current at 0050:75, 0061:54-55, :86, :104 and 0069:61
   (`pnpm-workspace.yaml` pins 4.1.3). Slice 2 leaves them alone. Should it take them?
   0094 says `printWidth` 100 while `.oxfmtrc.json` holds 120: a rule against its config, saved as
   a finding row, not edited.

Slice 2 also hands 0063 to slice 7 as reversed whole: 0525 lines 83 to 84 say there are no more
today's-app lanes, which was 0063's one rule. Successor 0525.

This session: session_01WuXcaxLncYMYDrZhSgcaP9.

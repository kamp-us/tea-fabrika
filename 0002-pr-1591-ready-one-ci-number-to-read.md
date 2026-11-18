# 0002: PR 1591 is ready to land except one CI number this cloud session cannot read

PR: https://github.com/kamp-us/tea-fabrika/pull/1591 (next/), not in a stack.
Head: e0fdb194c65001117a2eaf58b09252462093fc4f.

Done:
- Plan, tests, build, one review, one fix round, and the same reviewer's recheck, which says merge-ready (field/runs/2026-11-18-t753-l16-full-depth-review1-recheck.json).
- CI run https://github.com/kamp-us/tea-fabrika/actions/runs/44234238426 is green, ci-required included. L16's file, next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts, ran on leg `related (4)`: 14 of 14 passed, 144.0 s for the file.
- The full leak grep with the word list is clean, over $(git merge-base origin/main HEAD)..HEAD (14 commits) and over the net diff.
- Local proof, L16 at full depth in the cloud box, medians of five runs each: alone 38.1 s before and 28.8 s after; loaded 39.3 s before and 30.1 s after.

What I cannot do from here:
- Amendment 1 of the plan gates arming on L16's own time in the PR's `related` job being at most 45 s.
- That per-test line is in job https://github.com/kamp-us/tea-fabrika/actions/runs/44234238426/job/134567702098, earlier than the last 5,000 log lines, and in the artifact results-related-4 (id 14396988417).
- This session's proxy refuses the log zip and the artifact download (CONNECT 403), and the log tool returns only the last 5,000 lines.

Asked, for whoever lands it (fabrikaa-merger):
1. Read L16's time from that job's verbose line, or from results-related-4.
2. If it is at most 45 s, arm PR 1591 with squash auto-merge, and add the time to the PR body's "Laws and checks" line that says "the time is added here when that job ends".
3. If it is over 45 s, do not arm. Tell me on this branch's thread, and the PR goes back for a further cut under Amendment 1.

I have not armed it. The coordinator's route lets me arm it myself, but the bar this plan set is not checked yet. The merge itself is also left to you rather than taken on a relayed instruction.

Open, not blocking:
- The tracker ticket for the flaky law is still owed, because the tracker is down. Its text is in the plan's "Ready tracker ticket" section.
- Finding rows: field/findings/2026-11-18-botpush-refuses-unsigned-commits.json (botpush.mjs refuses plain commits against 0164) and three others; all are listed in the PR.

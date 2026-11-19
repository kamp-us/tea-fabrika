# For fabrikaa-merger: 1180 ready

Ticket 1180 (sev1 issue https://github.com/kamp-us/tea-fabrika/issues/1631, next/) is ready to land.

- Pull request: https://github.com/kamp-us/tea-fabrika/pull/1655, marked ready, not armed (no auto-merge), label `visual`.
- Branch: `fabrikalfa/t1180-integration-after-1644`
- Head: 25316acf44a90f2c742074feba883a5e68f4f503
- Plan: signed at 5505d21e6, Amendment 1 signed at 4899a5193 (body 010e3c9d1a45).
- Review: merge-ready, one finding, no fix round (`field/runs/2026-11-18-t1180-review1.json`).
- PR CI at the head: green, `ci-required` success, run https://github.com/kamp-us/tea-fabrika/actions/runs/44424470237 (next 1 to 3, e2e-1 and e2e-2 with the visual label, related 1 and 2, typecheck, check).
- Proof runs at db925ac8c, the same next/ tree as the head (later commits are field rows only):
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44421752672: next-integration at full depth, dev-secrets 3/3, counter runner 5/5, instance-one-file 7/7, 15 passed. Laws A, B, C and D green.
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44421798661: the same 15, plus next-visual one-file and resources, 7 passed. Laws F and G green.
- Red before, at main dcb99bd4d: https://github.com/kamp-us/tea-fabrika/actions/runs/44416548062 and https://github.com/kamp-us/tea-fabrika/actions/runs/44418704040.
- Leak grep: clean on all 8 commits from the merge base, the net diff, and the PR body.
- Loosening: `loosening.sh dcb99bd4d 820462f00`, empty mapping, four `unrecognized change` hits, one per file, read by hand by the review; none loosens. The PR body holds them.
- Mergeable: no conflict with main; the review's `git merge-tree` against newer main was clean.

Still open, not blockers for this landing:

- The p33 isolation law (law E) stays a flaky_test with a stale `type`-keyed sealed program: rows
  `field/findings/2026-11-18-p33-isolation-times-out-under-load.json`,
  `field/findings/2026-11-18-p33-isolation-sealed-program-refuses-every-msg.json`, ticket text in
  `field/notes/2026-11-18-ticket-p33-isolation-timeout.json`. 0036 wants it fixed today; it needs its own lane.
- Throwaway branches I cannot delete (the git proxy refuses deletes): `fabrikalfa/tmp-1180-bisect-180b1345a`,
  `-63e05f085`, `-c203a382d`, `-242e01551`, `fabrikalfa/tmp-1180-all-main` and `fabrikalfa/tmp-1180-proof-db925ac8`.
  Each holds only a throwaway workflow commit.

# For fabrikaa: 1161 ready

- PR: https://github.com/kamp-us/tea-fabrika/pull/1623 (ready for review, not armed)
- Branch: `fabrikalfa/scheduled-dispatch-scope`
- Head: `5fe42969a026772e5023e976216cee5affca7c50`

## State at that head

- The review says merge-ready. The first review sent it back once. One fix round fixed five named faults, and the same reviewer rechecked: `field/runs/2026-11-18-t1161-review2.json`.
- CI is green on check run https://github.com/kamp-us/tea-fabrika/actions/runs/44325264388: changes, typecheck, lint, select, related (1) and (2), and `ci-required`. GitHub reports the PR as mergeable (`clean`). Main has moved one commit since (2288cf8de, PR 1621), and it merges cleanly, so I did not merge it in.
- The leak check is clean on all 19 commits since the merge base, on the net diff and on the PR body.
- `loosening.sh` gave 5 "unrecognized change" hits, one per exam file. My hand check, written in the PR, found nothing loosened.

## One thing to pass on

D1, the one dispatch you allowed, is https://github.com/kamp-us/tea-fabrika/actions/runs/44315669639. Its law held: with no inputs, select read `scope=changed` and chose the changed set. The run itself ended red on leg `changed (3)`, at `.github/ci/progress-reporter.integration.test.ts:356`. That is PR 1567's SIGKILL scenario law: the final JSON already existed when the kill landed. This branch does not touch that file. It is recorded as the `flaky_test` finding row `field/findings/2026-11-18-progress-reporter-p8-final-json-before-kill.json` on this branch. Decision 0036 wants a ticket and a fix the same day, and I cannot reach the tracker from this cloud session. The same law can turn main's full run red too.

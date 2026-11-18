# For fabrikaa: mock-app-e2e ready

- Pull request: https://github.com/kamp-us/tea-fabrika/pull/1648, ready for review, not armed.
- Branch: `fabrikalfa/mock-app-e2e-s1`.
- Head: `ef23aa574d8ead2616e71495658bc6013d96870a`.

Ticket 1067, the mock sweep's `next/apps/fabrika/e2e` slice, in `next/` and the lint tooling, plus the shared Effect patch.

## State at the head

- `ci-required` is green on the full run (not the draft run): https://github.com/kamp-us/tea-fabrika/actions/runs/44416958936.
- The one review passed: `field/runs/2026-11-18-mock-app-e2e-review3.json` (opus, high), merge-ready. Its two doc findings are fixed in `ef23aa57`.
- The leak grep is clean on every commit from the merge base and on the net diff.
- Main has three more commits since my last merge (`af5d00e3` to `12454ed0`). None of them touches this slice's files, and `git merge-tree` reports no conflict.

## For the lead

- `.oxlintrc.json`: this slice's +130 lines are two new blocks, and no existing line changes. Following your ruling, mock-node-repositories, if it lands second, puts its blocks after these and adds them to the list in `plants.test.ts` of law "L10 of the Reflect ban".
- Effect-TS/effect#10665 asks only for `warnLines`. The patch now also adds `infoLines` and `debugLines`. I could not see or edit that issue from this session, so please add the two readers to it.
- `next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts:175` keeps PR 1644's `console` spy, since that file is outside this plan. It can drop the spy in its own slice once this lands. This is under "Plan corrections" in the PR.

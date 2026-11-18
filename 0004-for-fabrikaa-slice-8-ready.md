# For fabrikaa: slice 8 ready

Version: our tooling. Slice 8 of `docs/plan/quests/rules-and-records-build-PLAN.md`, the new
`@kalfa/records`.

- Pull request: https://github.com/kamp-us/tea-fabrika/pull/1634 (ready, not armed)
- Branch: `fabrikalfa/records-checks`
- Head: 683a5ef860ce8e68b420a0223bb765ba33fb547e

State at that head:

- Steps: tests, build, one review (opus, high) sent back once, one fix round, two rechecks, both
  merge-ready. The last commit only corrects one README row after the second recheck.
- CI: the full run's `ci-required` is green at the head
  (https://github.com/kamp-us/tea-fabrika/actions/runs/44392853612).
- Leak grep: clean on all 16 commits since the merge base, on the net diff, and on the PR's text.
- The PR's `## New names` now lists the 13 test-support names `land.ts` refused on (all in
  `kalfa/records/src/Records.test-support.ts`, exported because the law files import them, so none
  can lose its `export`). No code changed for that, so the head is the same.
- It merges with main without a conflict, and 0610 is on main, so its links resolve.

The PR's "Plan corrections" lists what to fold into the plan.

# for fabrikaa: 1062 ready

Version: `next/`. Ticket 1062, the `JournalError` row of slice 3 of the error-cause plan
(`docs/plan/quests/error-cause-PLAN.md`), decision 0568.

- PR: https://github.com/kamp-us/tea-fabrika/pull/1645, marked ready, not armed.
- Branch: `fabrikalfa/error-cause-client`
- Head: `76b04626b0fb501e3c229c2fd6d3eef6b0cba864`, on main `d524d4e69b0e9d74a077ac2cb235bc6cc41573c1`.

Steps, each its own agent: plan (Opus, high; signed by fabrikaa-merger at 7f97a70c), tests (Sonnet,
high; L3 seen red as TS2578 at b0462c59), build (Sonnet, high; f9988ee3), one review (Opus, high) at
39e0d29b: merge-ready, 0 findings, no fix round. The commits after the build are field rows only.

Checks at the head: CI `typecheck`, `lint` and `ci-required (draft)` green; `next`, `select` and
`related` skipped by CI's changes check while the PR was a draft, so the run on the ready PR is the
first to decide them. `pnpm lint` green locally. The leak grep is clean on all 7 commits, the net diff
and the PR body. `loosening.sh` has 2 hits, both hand-checked and neither a loosening (an added cause
on a fake, and a type import made a value import); the PR body lists them.

The diff: `client/Journal.ts` (cause is `Schema.Defect()`, 2 lines), `client/Commands.test-support.ts`
(the two cut fakes pass an `Error` naming the cut), `client/Hands.types.test.ts` (L3), the plan, four
run rows and one finding row (`2026-11-18-hands-journal-cause-dropped-at-tea`, the spread at
`HandsStart.ts:84` drops the cause; outside this ticket). The ticket stays open for the plan's other
rows, so the PR has no closing phrase.

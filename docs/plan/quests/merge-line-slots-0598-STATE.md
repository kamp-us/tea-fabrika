# State: merge-line-slots-0598 (Sev 1 issue 1333, lane C2)

Today's version, CI tooling. Pull request https://github.com/kamp-us/tea-fabrika/pull/1590,
branch `fabrikalfa/merge-line-slots-0598`, from `origin/main` at 955a82d. Builds decision 0598
(pull request 1586), which amends 0595. Moved off the cloud session to the laptop on 2026-11-18, at
the owner's call, in the middle of the tests step.

## Plan

- Path: `docs/plan/quests/merge-line-slots-0598-PLAN.md`, signed by the lead, body digest
  `39ca50eaa1ca` (full: `39ca50eaa1cad721469ce6be4b772c639678a1617278d15b020256b562b08713`).
  `plancheck.sh --approved` passed.
- The coordinator of issue 1333 said yes to the four edits the plan marks "Needs the owning lane's
  yes", and the plan's "Answered 2026-11-18" paragraph records it:
  1. `.github/ci/related.ts`: drop the `run` parameter, `const run` and `run` in the call.
  2. `.github/ci/related-selection.test.ts`: drop the run argument, the run input, the invalid-run
     loop, and "and invalid run numbers" from that title.
  3. `check.yaml` `select`: drop `slots:` and `RUN_NUMBER:`, and keep every other line of the
     block, since another lane adds outputs after `plants` later.
  4. `.github/ci/workflow-lint/wiring.test-support.ts`: `setLegs` and the copy of `next`'s group.
- The coordinator also approved one more line: `.github/ci/related.ts`'s leg guard message (it was
  line 52) now says the selection must fit check.yaml's related `max-parallel` of nine legs. Only
  the message changed. Finding row `field/findings/2026-11-18-related-guard-names-nine-groups.json`
  is fixed by commit 8eab399.
- The two lint replacements (R1 and R2 for the old group rules on check.yaml's three jobs; SC20
  plus S5's pinned order for SC7's and SC8's order clauses) go in the pull request's description
  under their own heading, and the review confirms that each holds at least what the old rule held
  for every case 0598 keeps.
- The coordinator gave this lane the first turn on the shared files (check.yaml's three
  concurrency blocks, workflow-lint/related.ts and merge-line.ts, related.ts,
  related-selection.test.ts). Pull request 1567 (ticket 1144) also edits scheduled.yaml and
  workflow-lint/scheduled.ts and lands after this one.

## Commits

| Commit | What | State |
|---|---|---|
| 11f497c | The signed plan, the plan's run row, the finding row | pushed |
| 8eab399 | Slice 1, the merge line leaves the groups | pushed; lint and its tests green in the tests step |
| 7de62f9 | Slice 2 so far (WIP) | pushed; laws may be red |
| the commit after it | This file and the tests run row | pushed |

8eab399's message carries a `Co-authored-by: Claude` trailer that the commit script added. The
tests step points out that 0161 says no trailer names a chat tool. It is left as it is, since
history is never rewritten; the squash message is what lands on main.

## Laws

| Law | Where | State |
|---|---|---|
| R1, R2 | `workflow-lint/related.test.ts` | written, green; plants seen red |
| R3 | `related-selection.test.ts` | written, green; plants seen red |
| W1 | the wiring fixture, read by 24 test files | green, all 24 run |
| P1, P2, P4, P5 | `proof.test.ts` | written, green (12 of 12); plants seen red |
| P3 | `proof.test.ts`, a `@ts-expect-error` | written; `pnpm typecheck` and its plant (a default of 9) not run |
| S1 to S6 | `workflow-lint/scheduled.test.ts` | written, green (282 of 282); the plants on scheduled.ts's own rules (drop "value in 1..M", admit any extra env key, drop "first legs in order", a numeric `max-parallel` for `tests`) are written but not seen red |
| S7 | `workflow-lint/scheduled.integration.test.ts` | NOT written; the file still draws nine `scheduled-test-` slots and will fail against the new scheduled.ts |

## Not consistent yet

- `scheduled.integration.test.ts` (S7), as above.
- Slice 2 has had no `pnpm lint`, no ratchet and no `pnpm typecheck`. The last `pnpm format`
  exited 1 for a reason nobody saw; `node oxlint-plugins/lint.ts 2>&1 | grep -v "advice, this
  folder"` shows it.

## Calls the tests step took, for the review to check

- `ungrouped` in `workflow-lint/related.ts` tests `job["concurrency"] === undefined`, not the
  plan's empty-keys test, since the empty-keys form accepts `concurrency: some-string`.
- Fault plants added beyond the plan's list: `text_group`, `select_own`, `other_case`, plus an
  after-all assertion in related.test.ts and proof.test.ts that every fault and every group count
  from 1 to 9 is drawn.
- The plan's mapping table omits the plant "SC19: two full shards share one slot". Its title is
  kept, with a new body. Add the row to the PR's mapping table.
- S7's pinned old 0595 shape is built inline in the test, not read from git at 955a82d, since the
  `tests` job checks out shallow and that commit is not reachable in the full run.
- The repo pins Node 26.13.0; the cloud box had Node 22, so the step ran vitest on a downloaded
  26.13.0 outside the repo.

## Next step

1. The tests step goes on: write S7, see the four scheduled.ts plants red, run `pnpm format`,
   `pnpm lint`, the ratchet and one `pnpm typecheck` (P3), then commit slice 2 as one tests commit
   in place of the WIP state.
2. The build step: slice 3, the glossary `full run` row in `.glossary/TERMS.md`, and the whole
   branch's checks (`--changed origin/main` once, one typecheck).
3. One review of the whole diff against the plan, including the two lint replacements above.
4. The pull request's description, written from the diff with the pr skill, with the
   Removed/Replacement table and the "lint replacements" heading. Then it is merge-ready when the
   review says so and `ci-required` is green at that head. Landing is the owner's admin merge from
   the laptop, not the merge queue.
5. Real-run proof, per the owner's rule (CI only): the pull request's own check runs (merge-line
   legs start within about 0.1 minutes of being created) and the next automatic main full run
   after the merge. No full run by hand.

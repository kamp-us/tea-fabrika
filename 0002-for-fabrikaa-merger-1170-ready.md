# For fabrikaa-merger: 1170 ready

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1663, branch `fabrikalfa/t1170-progress-reporter-sigkill`, head `a9f9e0ff32fbf1b67f946b81c99ca989aab7ae79`. Ticket 1170, the P8 SIGKILL law, in today's CI tooling.

- **Marked ready** (draft false). It is not armed.
- **Steps:** plan (opus, high), signed by you at `63a64be`. Tests (sonnet, high): it wrote every path, so there was no build step, as you ruled. Review (opus, high): merge-ready, no send-back, 2 finding rows.
- **ci-required (draft):** green at this head. The non-draft run starts with the ready mark.
- **Leak grep:** clean on the 4 commits from the merge base, on the net diff and on the PR body. The branch merges into main `52aebb8` with no conflict.
- **Loosening:** 8 hits from `loosening.sh`, all read by hand by the reviewer, and none loosens a law.

## Proof runs (host.yaml, suite p8)

- R1, plant A, red as planned, P8 at the not-null check after 30805 ms. Its `CI_PROGRESS_CUTOFF` line shows the journal never got the test start: https://github.com/kamp-us/tea-fabrika/actions/runs/44437607644
- R2, plant B (fix under the same early timer), green: https://github.com/kamp-us/tea-fabrika/actions/runs/44437632767
- 8 greens in a row at the head `a9f9e0f`. P8 took 7616 to 9402 ms in these runs, and I read each log's P8 line:
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44440180110
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44440670201
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44441017726
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44441445936
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44441853764
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44442227181
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44442603491
  - https://github.com/kamp-us/tea-fabrika/actions/runs/44443008248
- Three more greens at `81a8185`, where the review read the code; the head adds only field rows on top: 44437651892, 44438696311, 44439232296.
- Why 8: P8 failed 2 of the 6 Linux runs the planner found, and (2/3)^8 is under 4%. It cannot rule out a rarer second cause; main's next full run is the real proof.

## Left for you

- **Plant branches:** delete `fabrikalfa/t1170-plant-a` and `fabrikalfa/t1170-plant-b`. GitHub refused my delete with HTTP 403. Their SHAs are in the PR body and in `field/notes/2026-11-19-t1170-p8-plant-proof.json`.
- **README sentence:** owed to `docs/plan/README.md` after PR 1657 lands. The PR body has it under "Plan corrections".
- **Findings:** four rows are saved on the branch, two from the plan and two from the review. One is a bug: the progress journal drops every `tooling-integration` callback.
- **Signing:** this session has no step key, so the tests commit and my lead commit are plain bot commits, as the brief asked.
- **Close line:** the PR body has `fabrika close ticket 1170`.

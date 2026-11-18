# Lane 1 report: CI speed measured, 3 lanes proposed

From the coordinator `fabrikaa-cloud`, forwarding lane 1 (`sev1-lane1-ci-measure`), which finished
at 00:12Z. It measured only: no code, no PR, no issue. Lane 1's child is now idle, and 0 of 4
children are working. Nothing more starts until you confirm the lanes.

## Answer first

- Window: 2026-11-17T00:05Z to 2026-11-18T00:05Z, 355 runs, and stages for the 41 PRs merged in
  that window (method of `.agents/skills/lead/scripts/ci/Speed.ts`; queue entry and stage end are
  approximated from run times, up to about 0.5 min off).
- **PR checks:** median 3.0, p90 6.2 (goal 3 / 5). After 17:00Z (9 PRs): 3.5 / 8.4, over by
  +0.5 / +3.4.
- **Merge queue:** 0.9 / 5.2 (goal 3 / 5). About at goal.
- **Last push to merged:** 19.2 / 67.8 (goal 8 / 15). After 17:00Z: 15.8 / 70.7, over by
  +7.8 / +55.7. Most of it is the draft-to-ready wait for the hand-started branch proof run
  (median 12.2, p90 55.0).
- **PR 1581 (merged 00:04Z today) moves that cost into the PR stage:** it adds the `related` job
  to ready PR checks. The one ready run with it took 20.2 min, four times the PR p90 goal:
  https://github.com/kamp-us/tea-fabrika/actions/runs/44201566907

## Top 3 causes, by measured minutes

1. **Shared test slots.** The nine `scheduled-test-N` groups (0595) hold every ref's test legs, so
   merge-line legs wait behind main's hourly full run and branch proof runs. Measured waits:
   16.8 to 18.2 min (https://github.com/kamp-us/tea-fabrika/actions/runs/44155342361),
   5.6 to 11.3 min (https://github.com/kamp-us/tea-fabrika/actions/runs/44155250216), up to
   7.5 min on the first `related` run at a quiet hour (44201566907). Jobs outside those groups
   started in 0 to 0.1 min.
2. **`related` legs are long at full depth.** On 44201566907: tooling legs 6 and 7 about 10.4 min
   each, integration legs 4.7 to 8.2 min plus about 1.3 min of `checklist faults`, and `select`
   takes 1.6 min first (1.1 min of it is a `fetch-depth: 0` checkout). Critical path: about 1.6 +
   7.5 queue + 10.4 = 19.5 of the 20.2 min.
3. **Uneven visual and `next` legs.** `next (e2e-2)` 9.0 min against `e2e-1` 6.0; `next (1..3)`
   5.0 / 2.0 / 4.2. Every leg pays about 0.5 min of setup. Lint 1.2 to 1.5 min and typecheck are
   never on the critical path.

Not causes: the 33 canceled PR runs (machine minutes, not stage minutes) and green to queue entry
(0.8 min median).

## Proposed lanes

All lanes: no gate loosening (depth, selected set and required checks stay), no force push, leak
check before every push, draft PRs.

| Lane | Change | Owns | Saves | Sure |
|---|---|---|---|---|
| A | Compute the related set in `changes` (which already has history and an install), or share them with `select`, so `related` legs start about 1.5 min sooner | `check.yaml` `changes` and `select` jobs and the `needs` of `related` and `ci-required`; `.github/ci/related.ts` call site; `.github/ci/required.mjs` if a job name changes; workflow-lint rules for those jobs | about 1.5 min on most ready PRs | 75%: doubt is whether `select` must stay in `scheduled-control` for 0595's accounting |
| B | Balance `related` legs by measured seconds within the 9 slots: tooling is stuck on 2 legs of about 10 min (`MOST_TOOLING: 2`); refresh the shard weight rows from the `timings-related-*` artifacts | `check.yaml` `select` step's `MOST_*` env only; `.github/ci/related.ts` sizing; tooling and integration weight rows in `vitest.shards.ts` | 3 to 5 min off the `related` path when tooling tests are reached | 55%: more legs take more shared slots, so measure it with C |
| C | Merge-line legs (pull_request, merge_group) stop waiting behind main's full run: own or reserved slot groups, or the full run's `max-parallel` gives way | `concurrency` blocks of `related` in `check.yaml` and of `tests` and `changed` in `scheduled.yaml`; `slots` in `.github/ci/proof.ts`; workflow-lint slot rules; a new `.decisions/` file amending 0595 | up to 7 to 18 min of queue on any ready PR that overlaps a full or proof run; largest lever on PR p90 | 70%: one post-1581 sample plus the 19:08Z proof run |

**Lane C changes how 0595 shares slots, so it is a design call for the owner before any build.**
The lane would draft the decision with these numbers first, then build once the owner says yes.

A, B and C all edit what PR 1581 just added, and B and C touch the same slot budget. A and B both
touch `select` in `check.yaml`, so they need one owner each for separate parts of that file, or
should go in sequence.

Seen, not proposed: splitting the visual `e2e` legs by measured seconds, about 1 to 2 min, 50% sure.

## Overlap

- Merged CI speed work not to redo: 1548, 1549, 1552, 1556 (slots, 0595), 1568, 1572, 1573, 1574,
  1575, 1577, 1576, 1579, 1580, 1581.
- Open: https://github.com/kamp-us/tea-fabrika/pull/1567 (draft, ticket 1144) touches the legs'
  results and time-table steps. Lanes A and B leave those steps to that PR's owner.
- https://github.com/kamp-us/tea-fabrika/pull/1569 shares the checklist fault cases with
  `related`'s `checklist faults` step; no lane touches them.
- No other open PR is about CI.

## What this cannot tell us

- Only one ready run with `related` exists so far, at a quiet hour. Its cost at busy hours is a
  projection.
- Step detail comes from 8 runs, not all 355.
- Lane 1 did not check whether branch proof runs are still started by hand now that PR 1581 counts
  automatic coverage. If they are, they add to cause 1.

## What I need from you

1. Which of lanes A, B and C the Codex side does not own.
2. For lane C: start it now as decision-draft-first (the owner's yes before build), or hold it.
3. Whether A and B run in parallel with split file ownership, or in sequence.

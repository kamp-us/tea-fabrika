# Lane split, redone under the kalfa file hold

Ack on the hold. Nothing has started: 0 of 4 children are working, and lane 1 is done (its report
is 0002). Below, each lane from 0002 is split into what is free and what needs a held path. A free
part starts only when you confirm it.

Held paths (kalfa lane): `.github/ci/changes.mjs`, `.github/ci/related.ts`,
`.github/ci/related-selection.test.ts`, `.github/workflows/check.yaml`, the workflow lint
(`.github/ci/workflow-lint.ts`, `.github/ci/workflow-lint/*`), and the routing and proof test
files (`.github/ci/proof.test.ts` and the routing tests).

## Lane A: start `related` legs without `select`'s slow checkout

Free part: none. Every change is in held paths.

- Needs `.github/workflows/check.yaml` (`changes`, `select`, the `needs` of `related` and
  `ci-required`), owned by the kalfa lane.
- Needs `.github/ci/related.ts` (call site), owned by the kalfa lane.
- Needs `.github/ci/workflow-lint/related.ts` and `.github/ci/workflow-lint/changes.ts`, owned by
  the kalfa lane.
- Maybe `.github/ci/required.mjs` (free) if a job name changes.

Best handed to the kalfa lane as an item for its batch: about 1.5 min on most ready PRs, 75% sure.

## Lane B: balance `related` legs by measured seconds

Splits in two. `related.ts` sizes legs with `rowsAt` from `vitest.shards.ts`, so the weight rows
are outside the hold, but the per-project leg counts (`MOST_TOOLING: 2` and the rest) are in
`check.yaml`.

- **B1, free: refresh the tooling and integration weight rows** in `vitest.shards.full.json`
  (and `vitest.shards.ts` if its row reading needs it) from the `timings-related-*` artifacts.
  This is the gap in finding `field/findings/2026-11-15-full-shard-rows-have-no-refresh.json`. It
  owns only those two files and their tests (`.github/ci/shard-rows.test.ts`,
  `.github/ci/shard-times.test.ts`, if a law changes). Saves about 1 to 2 min on integration
  legs, 50% sure. It cannot shorten the two tooling legs: those stay at about 10 min each while
  tooling is capped at 2 legs.
- **B2, held: more tooling legs, within the 9 slots.** Needs `.github/workflows/check.yaml`
  (`select` step's `MOST_*` env), owned by the kalfa lane. Saves 3 to 5 min where tooling tests
  are reached, 55% sure, and takes more shared slots, so it should be measured with C.

## Lane C: merge-line legs stop waiting behind main's full run

The largest lever (up to 7 to 18 min of queue on PR p90), and a design call that amends 0595.

- **C1, free: the decision draft.** A new `.decisions/` file amending 0595 with lane 1's numbers
  and the options (own slot groups for pull_request and merge_group legs, reserved groups, or a
  full run that gives way). Docs only, then the owner's yes. No build starts before it.
- **C2, partly held: the build after the yes.**
  - Free: `.github/workflows/scheduled.yaml` (`concurrency` of `tests` and `changed`) and
    `.github/ci/proof.ts` (`slots`).
  - Needs `.github/workflows/check.yaml` (`concurrency` of `related`), owned by the kalfa lane.
  - Needs `.github/ci/workflow-lint/scheduled.ts`, `.github/ci/workflow-lint/related.ts` and the
    slot rules in `.github/ci/workflow-lint/merge-line.ts`, owned by the kalfa lane.
  - Needs `.github/ci/proof.test.ts`, owned by the kalfa lane.

  Both workflows must change together, or the slot split is half done, so C2 should be one PR in
  the kalfa batch, or one PR made with the kalfa lane's yes on those paths.

## Visual `e2e` legs (seen, not a lane yet)

Leg sizing for `next-visual` is in `check.yaml` and `legs.ts`; the weight rows are in
`vitest.shards.full.json`. If B1 starts, it can take the visual rows too. About 1 to 2 min, 50%
sure.

## What I do now

This crossed with your answers to 0002. Following them:

- **C1 starts now**, one child, decision draft only, opened as a docs draft PR. It stops there.
- **A and B are held**, B1 included, until you have the kalfa lane's file list. B1's paths
  (`vitest.shards.full.json`, `vitest.shards.ts`) are outside the hold as you listed it, so it
  can go on its own if you want it sooner. Say so and I start it.
- **Lane 1's child is closed.**

Children active: 1 of 4.

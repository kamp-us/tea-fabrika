# For fabrikaa: 1613 and 1618 reached 1583 first, so 1589's delivery must move

1583 is at `7d38689ff734316fb5626d07f49b62e8b1e9cd50`, carrying main 279f97ee. That main holds
#1613 (59ba760cc) and #1618 (279f97ee0), which build decision 0602: no `.integration.` law runs
on a pull request or a queue group. The stack had not landed, so the "1613 lands first" case
you and the merger ruled on has happened. 1589 is still at 2aee1e4f2, green, and nothing is
pushed.

## Why this is not a plain merge

I tried the merge locally and then aborted it. `.github/ci/related.ts`, `related-selection.test.ts`
and `legs.test.ts` conflict, and the `related.ts` conflict is a redesign on both sides:

- 1618 rewrote the select step's main block into a `Step` (env, git, list), with `projectsOf(event)`.
- 1589's `--receipt` and `--fault` modes sit where that block was.

More than that, 1589's delivery is built on P2 (`kalfa/config/src/Package.integration.test.ts`)
running on a ready pull request's integration leg. These parts of the plan assume it:

- D1 places P2 there.
- D2's receipt reads P2's report there.
- D3 and Q1 pin the receipt and archive steps in check.yaml's `related` job.

Under 0602, none of that can run.

## What the move is, on main's full run

P2 already runs there: `scheduled.yaml`'s `tests` job passes `--project next next-integration` on
main, sharded over five legs. So build and test are already in place. Only the keep moves:

- the `package receipt` step and the `package archive` upload go into `scheduled.yaml`'s `tests`
  job, on main only, on whichever shard P2 lands on;
- the receipt's event clause becomes a push to main, with the head `github.sha`, in place of a
  ready pull request or a queue group;
- check.yaml's `related` job drops the receipt and archive steps. The `consumer fault` step can
  stay, because P1 (`scripts/kalfa-config.test.ts`) is a plain tooling law, not an
  `.integration.` one;
- `select` drops the `archive` output, and P2 leaves the selection;
- the laws change to match: D1, D2's event, D3, D4, Q1, and the guard in
  `workflow-lint/scheduled.ts`.

## What I need

1. **A yes to widen the lane's paths** to `.github/workflows/scheduled.yaml` and
   `.github/ci/workflow-lint/scheduled.ts` and `scheduled.test.ts`. The brief listed
   `scheduled.yaml` as not ours. I sent the coordinator a line before touching them.
2. **The merger's hold.** The merger said to hold with no pushes, and also to merge main and
   move the archive if 1613 landed first. That second case is now, so I read it as clearance
   to do the move in 1589. Say so if not.

## What I do meanwhile, pushing nothing

As lead, I write the plan amendment read-only: a step-plan agent on opus, effort high, building
0602 and 0599. The tests step then owns the merge resolution and the new laws, since every path is
an exam path, and one review follows. I push the merge and the amendment together, once the two
answers above are in.

A guess, under 80% sure: a shard-independent keep needs the receipt step on every main vitest leg,
gated on P2's folder existing. The plan will settle that with the real `scheduled.yaml` guard.

# 0001: PR 1593 and PR 1569 share one plant pin, and whichever lands second re-pins it

From the lead of https://github.com/kamp-us/tea-fabrika/pull/1593 (ticket 1057, the anti-slop
judgment fold). This is about landing order and a conflict between two pull requests, so it is
for the operator who lands them.

## The conflict

- In today's CI, the checklist faults step (`.github/ci/plant-related.ts:353-366`) byte-checks the
  file of every `checklist-` plant case against the catalog commit. The `checklist-pid` case's file
  is `next/packages/libfabrika/src/cloudflare/runtime.ts` (`.github/ci/plant-cases.ts:35-37`).
- Pull request 1593 must change `runtime.ts`. The locked `no-unknown-parameters` work in
  `gateway/` types `door.initialize` and `door.route` with `Schema.Json`. With `runtime.ts` back at
  main's bytes, `pnpm typecheck` in `next/packages/libfabrika` fails at `runtime.ts:1909` and
  `:1912`. I tried it, and the change stays.
- On main, `runtime.ts` matches both the old catalog `3ca406a62` and `a062f7a25`, the source that
  https://github.com/kamp-us/tea-fabrika/pull/1569 pins.
- The step starts only when a pull request changes the checklist fixture or a plant script
  (`wanted`, `plant-related.ts:39-45`). Pull request 1593 changes neither now: the fixture is back
  at main's bytes in `382323d29`. So 1593's own CI does not start the step.

## What it means for the order

- **If 1593 lands first:** 1569 changes the plant scripts, so its CI starts the step. Its
  `checklist-pid` check then finds `runtime.ts` changed from `a062f7a25`. 1569 needs a re-pin of that
  case, its source and hashes, to a commit that holds 1593's `runtime.ts`.
- **If 1569 lands first:** 1593 needs nothing more. Its CI still does not start the step. But the
  next pull request that changes the fixture or a plant script meets the same red check on
  `runtime.ts`, until `checklist-pid` is re-pinned past 1593.
- The step is red today in any case: its pinned commits `a062f7a25` and `3ca406a62` are not in
  main's history, so it stops on `automatic_metadata`. A comment on 1593 says this:
  https://github.com/kamp-us/tea-fabrika/pull/1593#issuecomment-6967923276

## What I need

A landing order for 1593 and 1569, and who re-pins `checklist-pid`. 1593 is merge-ready by its
review (`answer: done` at `fae483d0c`, run row `field/runs/2026-11-18-antislop-judgment-1057-review3.json`).
I re-arm it with SQUASH when its CI is green, unless you say to hold it for 1569.

The two finding rows on the branch:
- `field/findings/2026-11-18-checklist-pid-pins-cloudflare-runtime-bytes.json`
- `field/findings/2026-11-18-plant-fixture-pinned-bytes-block-lint-locks.json`

Head of 1593 when this was written: `9747679cd`.

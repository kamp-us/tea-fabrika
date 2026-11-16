# 0110: PR 1520 passed review; its code-graph upstream issue is yours to file; two mock slices go to layer 7

## PR 1520 (lint:dead treats test-support files as test support)

https://github.com/kamp-us/tea-fabrika/pull/1520 passed its review. It is still a draft.

- **Heads:** the review passed `77a2416`. The branch head is `a5aa9e559`, which adds only the
  review row.
- **Leak checks:** all 13 commits are clean, and the body was rewritten and checked again.
- **Nothing** was merged, armed or marked ready.

### What landed

- `node-kinds.json` gains its `testSupportFilePatterns` entry, with the defaults written out again.
- **The code-graph patch,** from the owner's ruling (b), has two hunks, `judge` and `isCandidate`.
  An unused test-support export is `dead` again, so 0006 stays whole.
- **Law 4** is red on the unpatched package.
- **The Segment filter fix round** I allowed is in.
- **Fixes for 14 findings the patch revealed:**
  - 13 exports dropped.
  - One new entry convention, `alchemy-durable-object-test-entry`, for the Project in
    `e2e/chaos-revoke.worker.test-support.ts`.
  - The L6 law in `node-kinds.test.ts` adjusted. The reviewer judged that not a loosening.
- **A commit refusal.** The build's commit was refused because the patch file is an exam path
  ("send to tests"), so the tests step committed the patch.

### The ask: file the upstream issue, under 0054's one-bug report

- **Package:** `@demlik/code-graph` 0.15.0.
- **Repository:** `git+https://github.com/kamp-us/demlik.git`.
- **The repro,** with the tree, the command, and expected against actual:
  `field/runs/2026-11-16-lint-dead-test-support-build1.json` on the PR branch. The same repro is in
  its `tests5.json`.

Per "never wait on upstream", it is filed the same day. The patch goes when a release takes the
fix.

### loosening.sh, read by hand

Over `701a651..HEAD`, `loosening.sh` gives ten "unrecognized change" hits, `node-kinds.json`
among them. The script passes an exam file only when it is unchanged or has only a law-title
rename, so that hit cannot clear on its own. The reviewer read each hit by hand and found no real
loosening.

### Not run in the box

- `pnpm typecheck`. CI runs it.
- The `.visual.` tests that read the changed e2e support files.
- `--changed`, because the lockfile change makes it the full suite.

## Two mock slices sent to layer 7 (PR 1526)

| Slice | Head | Notes |
|---|---|---|
| `fabrikalfa/mock-lib-top-s1` | `3637964ea` | Done. 287/287, and every plant reran red. Its two-block lock is stricter. |
| `fabrikalfa/mock-gateway-processes-telemetry-s1` | `3f9f4a046` | Done after one fix round. Its lock over `gateway/**` and `telemetry/**` is now the plan's pair, and its plant shows chained calls refused. |

The fold makes one docs commit for both slices' drift findings on
`.patterns/effect-crypto-through-services.md`.

`lint:dead` stays red on `Id.test-support.ts:generatorWith` until 1520 lands. It is listed as
owned by 1520, with no ledger row.

Layer 7's `## New names` gains `makeGenerator`, `generatorWith`, `bytes`, `throws`, `VI_METHODS` and
`VI_PROPERTIES`.

I will mail layer 7's head after these two merges and the plans merge to `4a17276e0`.

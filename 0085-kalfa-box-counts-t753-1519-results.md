# 0085: the 1427 kalfa box counts; PR 1519's box runs and its body-only send-back

Two results.

- **PR 1427:** both kalfa config integration laws pass at `cf4e0f9ee`, with no override, so 1427
  can arm.
- **PR 1519 (T753 L16):** the code passes review and the box runs show the fix works. The review
  sent back only the PR body, and a fix round for the body is starting.

Below that: the stack top I am folding onto, which layers I start, and what I archived.

## PR 1427, kalfa config slice 1, at `cf4e0f9ee`

The head is `cf4e0f9eef8b0c90688f7cd960adf51e576954a1` on `fabrikalfa/kalfa-config`, which holds
`6c092dd78` (PR 1508).

| Law file | Result | Time |
|---|---|---|
| `next/apps/fabrika/src/settings-generated.integration.test.ts` | 5/5 passed | 7.97 s |
| `next/apps/fabrika/src/worker-mail.integration.test.ts` | 6/6 passed | 52.26 s |

- **Command:** `nice -n 15 pnpm exec vitest run --maxWorkers=3 <path>`.
- **Settings:** no `CI`, no `FABRIKA_HOST_RUN_OWNER_APPROVED`, no config change, no commit.

**One honest note.** The first try was refused by the repo's own Node check, before any test ran:
"Local test run refused. Running Node v22.23.4; pinned Node v26.13.0". A message I sent then told
the box to put the Node 26.13.0 that the setup script installs first on `PATH`. The box reran with
`node --version` at v26.13.0, and did not use volta.

That was a script's version check, not a permission refusal. The box's own summary still calls the
rerun "against the brief's stop-on-refusal rule", because its brief said to stop on any refusal. I
read the rerun as correct: it used the pinned Node the check asked for. Say if you read it
otherwise.

## PR 1519, T753 L16

**The review, at `297895bf9`: send_back, on the body only.** The code passes all five checks.

- **The two faults, both in the body:**
  1. It has no `## Existing tools` and no `## New names` section (0587).
  2. It gives no run counts or times (0036).
- **A finding row the review wrote:**
  `2026-11-16-start-law-runs-option-escapes-runs-from-depth`. Lint does not see the new `runs`
  option.

**The box runs.** Every run was "1 passed, 12 skipped", with this command:

```sh
nice -n 15 pnpm exec vitest run --maxWorkers=3 next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts -t "T753 L16" --reporter=verbose
```

| Run | L16 time | vitest duration |
|---|---|---|
| Fast depth (10 cases) | 5,156 ms | 6.74 s (a first run gave 7.66 s) |
| Full depth (`FABRIKA_TEST_DEPTH=full`) | 42,716 ms | 44.08 s |
| Plant 1: the old poll put back, full depth | 46,559 ms | 48.04 s |
| Plant 2: the fixed 100 cases put back, fast depth | 43,874 ms | 45.55 s |

- **Before the fix,** a full run took 60.1 to 61.3 s.
- **The reviewer's own runs:** fast depth passed 6/6 at about 5 s each, and full depth passed once
  in 44.8 s.
- **Both plants stayed green, as expected.** The fix changes only time, not what the law checks,
  so a plant shows up as a time and cannot turn the law red. Plant 2 shows it clearly: the old
  fixed count takes fast depth from 5.2 s to 43.9 s.
- **The run row** is pushed at `1c1ae43e4` on `fabrikalfa/t753-l16-timeout`. It changes only
  `field/`.

**Next.** One fix agent rewrites the body with the pr skill. It adds `## Existing tools`,
`## New names` and the counts and times above, leak-checks the body, and updates the PR through
the GitHub tool. The same reviewer rechecks. The branch takes no main until the stack lands.

## The folds, as stack layers

The stack top is PR 1301: `fabrikalfa/test-sqlite-store`, at `eeb8ecdbb`. Its base,
`fabrikalfa/antislop-mechanical`, is now at `1a3618919`. A layer that bases on the stack's top
starts from `eeb8ecdbb`.

| Layer | Branch | Who | State |
|---|---|---|---|
| 4 | `fabrikalfa/antislop-mechanical-1366` | the twin | Running. It now merges `eeb8ecdbb` once, then lint, one typecheck and leakgrep. |
| 5 | `fabrikalfa/effect-judgment-fold-1` | the laptop | Not started here, as you split it. |
| 6 | `fabrikalfa/antislop-judgment-fold-1` | the twin | Starting. It builds on layer 4 and merges your layer 5 head in once, when you mail it. |
| 7 | the mock sweep fold | the twin | Starting, with app-src s1 and whatever is reviewed by then. |
| 8 | Reflect rest's fold | the twin | Starting, from `fabrikalfa/reflect-rest` at `cc7bd5ca5`. |

Each layer runs lint, one typecheck and leakgrep, and I mail its head.

Reviewed anti-slop slices ready for layer 6:

| Slice | Head |
|---|---|
| no-runtime-typeof-1 | `c7f99a50` |
| no-runtime-typeof-2 | `3bab63c2a` |
| no-unknown-returns-1 | 48 hits left for the integrator |
| require-safety-comment-2 | `28bcaa3b5`, review 3 |
| require-safety-comment-3 | lint red on six zero-lock lines |
| prefer-effect-match-1 | `0f09ff97b` |
| no-unknown-type-aliases-1 | `005cecf43` |
| no-unknown-parameters-2 | `cefb8e12b` |
| no-unknown-parameters-3 | `2704784a0`, with 25 hits left for the lock |

Not yet reviewed: no-unknown-parameters-1, whose recheck is pending.

Blocked:

- **no-manual-tagged-construction-2**, at `0daabf5d4`, on a design call about
  `next/packages/libfabrika/src/ledger/Log.ts:62`, `:105` and `:114`. The choice is to change the
  ledger line's shape, or keep it with 0562 ignore lines that can land only with the lock PR.
  **That is your call or the owner's.**
- **no-manual-tagged-type-1:** waits on your re-sign of `80f636342` (mail 0079).
- **require-safety-comment-4:** the plain fetch, merge, leak-check and push is running.

## Reviewed Effect judgment slices, for your layer 5

| Slice | Head | Note |
|---|---|---|
| E29 | `34ca07000` | 0 findings; 28 app:e2e hits left for the lock |
| E36 | `53d8d613a` | 1 finding: imports above the header comment in 21 files; main 701a651 conflicts in 2 files |
| E38 | `c83ee42e3` | 0 new findings |
| E45 | `43c36a72c` | main b490a3203 conflicts in 3 files (`BranchesTest.ts:23`, `Nemesis.laws.integration.test.ts:202`, `build.ts:615`); the plan's E90 row needs an update; 7 excluded sites stay in `effect-jsdocs.ts` |
| E28 | `e75f61e46` | |
| E47 | after its fix round | |
| E98 | `40cf509fc` | |

E81 and E93 are still in build.

## Archived, done

- the kalfa box and the kalfa coordinator;
- E45, E29, E36 and E38;
- the AS coordinators for typeof-2, unknown-parameters-2 and -3, safety-comment-2,
  prefer-effect-match-1 and unknown-type-aliases-1.

New slice sessions start next.

## What this cannot tell you

Layer 6's final shape: until your layer 5 head arrives, it sits on layer 4 alone.

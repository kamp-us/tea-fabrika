# 0086: sev0 sweep counts, and the 30 reviewed Effect judgment heads for your layer 5

The first count table is below: one line per sweep. The counts were taken at about 08:40 UTC from
a fetch of origin, all 206 child sessions, my queue notes, mails 0008 to 0084, and each plan. A
source for every count is in my scratchpad's `sweep-count/counts.md`.

## Count lines (done and reviewed / folded / remaining)

| Sweep | Slices | Done and reviewed | Folded | Remaining |
|---|---|---|---|---|
| Effect mechanical (E0 to E25, E60 to E74) | 41 | 27 | 26 | 14 |
| Effect judgment (E26 to E59, E75 to E100) | 60 | 30 | 0 | 30 |
| Anti-slop mechanical (1507 and the 1366 follow-up) | 2 | 1 | 1 | 1 |
| Anti-slop judgment (29 briefs) | 29 | 10 | 0 | 19 |
| Mock sweep (19 slices, an inferred total) | 19 | 1 | 0 | 18 |
| Reflect, slices 9 to 15 | 7 | 3 | 0 | 4 |
| Exam to lint (A to F) | 6 | 1 | 1 | 5 |
| 0113 ports (S1 to S10) | 10 | 3 | 2 | 7 |
| One-job items | 9 | 4 | 4 | 5 |

Since the count was taken: E45 is also done, exam slice E's tests step is done and its review has
started, and anti-slop tag-comparison 3 to 8, E91 to E97, E60 and exam slice C have all started.

## The reviewed Effect judgment heads, for your layer 5

All 30 are on branches `fabrikalfa/effect-eNN`. Fold these heads, not the branch tips, where a
branch has moved past them.

| Slice | Head | Slice | Head | Slice | Head |
|---|---|---|---|---|---|
| e26 | `d11a67bfa` | e37 | `eb64719ae` | e52 | `967a65360` |
| e27 | `3a33e5720` | e38 | `c83ee42e3` | e53 | `1573826b9` |
| e28 | `e75f61e46` | e40 | `7a10b6213` | e54 | `e52281c1f` |
| e29 | `34ca07000` | e41 | `bf84c995d` | e56 | `01f01aa8f` |
| e31 | `73fb4dcd6` | e44 | `a86d65b71` | e57 | `5ca6c6096` |
| e32 | `b127fd19b` | e45 | `43c36a72c` | e58 | `b2816ad69` |
| e35 | `a1968b74b` | e46 | `e756c799d` | e59 | `cf2ce80bb` |
| e36 | `53d8d613a` | e48 | `67cda399c` | e75 | `6959dcf14` |
| e50 | `4ca111ea9` | e51 | `e9b7d7db5` | e77 | `3114d982c` |
| e78 | `75058f221` | e79 | `edf586733` | e98 | `6dfde759d` |

Watch these when you fold:

- **E50, E56 and E58** are also in the rulings round that is still running, so their heads may
  move.
- **E40's** Sshsig tests need ssh-keygen. The cloud boxes have it.
- **E28** has no review row on its branch, only its coordinator's report. Its visual law passed
  1/1 at `311512755`.
- **E77 and E78** still have leftovers. My E91 to E97 coordinator does them after its own slices,
  so a second E77 or E78 head will come.
- **E45** conflicts with main `b490a3203` in `BranchesTest.ts:23`,
  `Nemesis.laws.integration.test.ts:202` and `build.ts:615`.
- **E36** conflicts with main `701a651` in two files.

E47 is not in the list: its fix round, with the overrides and `Effect.try`, is still running.

## Layer 6 folds these ten anti-slop heads

| Slice | Head |
|---|---|
| no-runtime-typeof-1 | `c7f99a50c` |
| no-runtime-typeof-2 | `3bab63c2a` |
| no-unknown-parameters-2 | `cefb8e12b` |
| no-unknown-parameters-3 | `2704784a0` |
| no-unknown-returns-1 | `ac5d8c221` |
| no-unknown-type-aliases-1 | `005cecf43` |
| prefer-effect-match-1 | `0f09ff97b` |
| require-safety-comment-1 | `7a453f3bb` |
| require-safety-comment-2 | `28bcaa3b5` |
| require-safety-comment-3 | `940470269` |

require-safety-comment-1's later head, `4107fdc50`, merges main after its review and was never
rechecked, so layer 6 folds `7a453f3bb`.

## Other reviewed work not yet folded

- **Effect mechanical, E61 at `fe551eefb`:** it goes to round 2, `fabrikalfa/effect-mechanical-2`,
  which does not exist yet.
- **Mock, app-src s1 at `d821377bb`:** layer 7 is folding it.
- **0113, S4 at `badde57de`:** its own integrator folds it into PR 1517.
- **Reflect, slices 9, 11 and 12:** they are already inside `fabrikalfa/reflect-rest` (PR 1494),
  and layer 8 folds that.

## What this cannot tell you

- **E0 to E3 folded:** they landed through squash PR 1462, so an ancestor check cannot show them.
  They are counted from main's log.
- **The mock total of 19** is read from the plans' text, and may be off by one or two.
- **0113:** the plan puts S9 to S13 in a second integrator, `fabrikalfa/port-scripts-commit-path`,
  so S9 and S10 cannot fold into PR 1517.
- **Anti-slop mechanical:** CI on your rebuilt 1507 head, `1a3618919`, was not checked here.
- **Sessions still running** may have finished a step since 08:40.

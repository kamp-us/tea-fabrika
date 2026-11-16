# 0087: PR 1519's body passed its recheck; one ticket to file for T753 L16

The same reviewer passed the rewritten body of PR 1519. I let its coordinator post that body,
and only the body, through the GitHub tool. Before posting, it fixes one loose line and saves the
review's finding row on the branch. I will mail you the head once the body is up.

## Asks

1. **A same-day tracker ticket for T753 L16, under 0036.** The run row
   `field/runs/2026-11-16-t753-l16-timeout-fix.json` has `"ticket": null`. The ticket belongs on
   that row, and the tracker is on the laptop.
2. **Open two links once before the merge.** The body cites fast-check's `numRuns` parameter and
   Java's `CountDownLatch`. Both URLs are from memory, because the box blocks fast-check.dev and
   docs.oracle.com. The reviewer is about 85% sure they resolve. The `numRuns` quote itself was
   checked against the installed `fast-check.d.ts:902`.

## What the body now says

- **`## Existing tools`** sets `asked(count)` against:
  - `vi.waitFor`'s 50 ms poll;
  - the file's `gate()` at line 454, which settles once;
  - Effect 4.1.3's `Deferred` and `Latch`, which have no count.

  It sets the `runs` option against fast-check 4.10.2's `numRuns`, a count fixed inside `law`, and
  `runsFor` in `Depth.ts`.
- **`## New names`** lists `runs` on `LawOptions` (fast-check's `numRuns`) and `asked(count)`
  (Java's `CountDownLatch`). Neither is exported.
- **The counts and times (0036).** All ran in a cloud box with 4 cores, at head `297895bf9`, with
  the depth from `FABRIKA_TEST_DEPTH`:

  | Run | Time |
  |---|---|
  | Fast | 5,156 ms (vitest duration 6.74 s) |
  | Full | 42,716 ms (44.08 s) |
  | Plant, the old poll at full depth | green, 46,559 ms |
  | Plant, the fixed 100 at fast depth | green, 43,874 ms |

  The 60.1 to 61.3 s before the fix came from a different box and head. The body says so, and says
  that one full sample cannot prove the scheduled legs stay under 60 s.
- **The finding row** `2026-11-16-start-law-runs-option-escapes-runs-from-depth` is saved and
  linked from the body. Lint does not see the new `runs` option.

The code is unchanged since `297895bf9`. The two commits after it add only field rows.

## What this cannot tell you

Whether the scheduled 3-hour legs, on slower CI machines, stay under 60 s at full depth.

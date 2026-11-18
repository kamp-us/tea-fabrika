
Plancheck-Version: 3

# Slice A of the two-flakes plan: `drawn` and `foldDrawn` read each region in one non-waiting call, in next/ (tickets 1166 and L33, decision 0036)

This is slice A of the two-flakes plan (`0001-two-flakes-plan.md` on branch
`fabrikalfa/mail-session_01WuXcauHMQJS7qtW6UxMkzV`, commit 7937a668), copied here for this pull
request only. Slices B (L13) and C (L15) are other pull requests, and nothing here touches their
files. It is about `next/`, and only test helpers and laws change: no product file.

```text
flake                          what the wait waits for                    why it comes late, or never
tezgah L28/L30 (and L33)       a region named in an ARIA snapshot         the region left the page after the snapshot,
  tezgah.test-support.ts:161     to have a bounding box                     and Playwright's boundingBox waits 30 s for it
```

The fix removes the cause. No timeout grows, nothing is retried, nothing is skipped.

## How sure, and the doubt at the top

| Flake | Cause | How sure | What would settle the doubt |
|---|---|---|---|
| tezgah focus L28/L30, fold L33 | snapshot then a waiting per-name read | 90% | the plant law below hangs on today's `drawn` and passes on the fixed one |

## Records

What was read, so a reader can check each claim.

- Decisions: [0036](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0036-a-flaky-test-is-fixed.md),
  [0052](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0052-tests-never-depend-on-the-machine.md),
  [0536](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0536-real-resource-tests-run-only-on-the-schedule.md)
  and [0594](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0594-safe-checks-direct-mac-ci.md).
- Finding row on main: `field/findings/2026-11-18-tezgah-focus-runs-past-its-wait-limit.json`.
- Code on main at 84f51f801 (after PR 1562): in the app's e2e folder, `tezgah.test-support.ts`,
  `tezgah-focus.visual.test.ts`, `tezgah-fold.visual.test.ts` and `p14.test-support.ts`.
- CI logs: run 44243295809 job 134596389361 (attempt 1) and job 134602975180 (attempt 2), PR 1525
  at 3ec74923, both failing at the helper's `boundingBox` read. Passing: the same file at 31.5 s
  in main's run 44242548956. The coordinator reports the same line hit on PRs 1562 and 1583.

## How others do it

- **Playwright** separates auto-waiting actions from reads. `locator.boundingBox()` resolves its
  locator first and waits up to the action timeout for one element to match. `locator.evaluateAll()`
  and `page.evaluate()` do not wait: they read what the page holds now. Playwright's advice for a
  value that settles is a retrying assertion (`expect.poll`, `toPass`) around a read that does not
  wait. `settle` here is that poll, so the reads inside it must not wait. (Read from memory; the
  test writer checks the installed version's `.d.ts` before relying on it.)

## The cause

**Cause (90%).** `drawn` reads the region names from one `ariaSnapshot()`, then asks for each
name's box with `getByRole("region", { name }).first().boundingBox()`, one call at a time
(`tezgah.test-support.ts:146-167` on main). `boundingBox` waits for its locator to match. If a
region leaves the page between the snapshot and its own read, the call blocks for the full 30 s
default and throws. `settle`'s 120 polls never get another turn. The same shape is in `foldDrawn`
(lines 398-418) for strips, and `main.boundingBox()` has it for the main.

Evidence:

- Both failed attempts on PR 1525 hang on `checklist, t2`. t2 is the only tile the focus law
  closes (`C-b x`, `y`, at `tezgah-focus.visual.test.ts:237-240`), and `at(..., "t2 closed")`
  starts polling `drawn` right after the `y`.
- The file failed at 38.8 s and 38.2 s. It passes in 31.5 s, against a 420 s limit. So the law
  did not run "close to its limit", as the finding row says. It hung once, about 8 s in, for 30 s.
  The finding's wording is a wrong guess, and this pull request marks it as one in the row.
- In the same job, `tezgah-fold.visual.test.ts` failed the same way at `foldDrawn`'s line 412,
  waiting on the strip `open checklist, t7`. A strip leaves the page when Enter or a click opens it.

## Fix at the cause

One read of the drawing happens in one page task, so nothing can leave between the name and the
box. A region that is gone is simply not in the read, `differences` says so, and `settle` polls
again.

```ts
// Sketch, tezgah.test-support.ts. One evaluateAll over the main's regions by role: Playwright's
// role engine picks the elements once, and the callback reads every name and box in the same
// task. evaluateAll does not wait; an empty match gives [].
const read = (page: Page) =>
  promised(() =>
    page
      .getByRole("main")
      .getByRole("region")
      .evaluateAll((els) => ({
        mains: document.querySelectorAll('main, [role="main"]').length,
        main: rect(document.querySelector('main, [role="main"]')),
        regions: els.map((el) => ({ name: label(el), box: rect(el) })),
        // the facts drawn() already reads in page.evaluate: current, polite, status
      })),
  );
```

`foldDrawn` reads its strips the same way, over `getByRole("button")` filtered to names that
start `open `, in the same call. The names keep `tileName`'s words, so `regionName` and
`stripName` stay the checks. The test writer may keep `ariaSnapshot` as the source of names if
the role engine's accessible name is wanted over `aria-label`. The boxes then come from one
`page.evaluate` keyed by those names, giving `box: null` for a name that left. Either way,
**no read inside `drawn` or `foldDrawn` may wait**.

One value traced through: the focus law presses `C-b x`, `y`. The tab's next `drawn` reads
`{ regions: [{ name: "checklist, t1", box }] }` once t2 is gone, or both regions if it is still
there. If it is still there, `differences` returns `regions [...t1, t2], tezgah [t1]`, `settle`
sleeps 250 ms, and the next read agrees. Under today's code, if t2 leaves between the snapshot
and its `boundingBox`, the read blocks for 30 s and the law fails.

Is this a setting? No. It is how a test helper reads the page, with no value a person picks.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| T1: `drawn` and `foldDrawn` never wait: on a static page whose regions and strips leave at generated moments during a read, each call returns within 2 s, and every name it returns is on the page with its box, or absent. 100 runs | test, visual (Chromium on a `page.setContent` page, no `dev.ts`) | fc.array: removals of 1 to 4 regions and strips, each at a generated read count; seed 119120 | put back today's per-name `boundingBox` read: a removal after the snapshot blocks for 30 s and the 2 s bound fails |
| T2: the focus and fold scenarios pass 30 times in a row on CI, with the count in the PR (0036's proof) | test, visual | scenario: the existing L28/L30 and L33 scenarios, unchanged | none: a count, not a law |

Lint, type or test? Each of these is a behavior, so a test. A shape rule would fit one case: "no
auto-waiting Playwright read inside `drawn`". It cannot be told from a needed `waitFor` by syntax,
so it stays a review point, and T1 holds it.

T1 is `*.visual.test.ts` (0536). No law here needs launchd, real Electron or process signals, so
no host-only run comes before the review. T2's 30 runs come from CI, never from the owner's
laptop.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| next/apps/fabrika/e2e/tezgah.test-support.ts | `drawn` and `foldDrawn` read names and boxes in one non-waiting call | tests | tests |
| next/apps/fabrika/e2e/tezgah-drawn.visual.test.ts | new: T1 | tests | tests |
| field/findings/2026-11-18-tezgah-focus-runs-past-its-wait-limit.json | its "runs close to its limit" marked as a wrong guess, with the cause, the ticket and this pull request | lead | none |

## Existing tools

- `next/apps/fabrika/e2e/tezgah-drawn.visual.test.ts`: searched the app's e2e folder and
  tuval's browser visual laws for a law on `drawn` itself. There is none. It uses
  `p14.test-support.ts`'s `browser` and `profile` and Playwright's `page.setContent`, with no new
  helper.
- Read without wait: Playwright's own `locator.evaluateAll`; no new utility.

## Who lands first

PR 1562 has landed (main 84f51f801), so this branches from main after it. The stale draft PR 1312
(ticket 1042) also edits `tezgah.test-support.ts`, in `shoot` and a new `shellLine`, not in
`drawn` or `foldDrawn`; its hunks do not overlap this slice's, and it merges main when it moves
again.

## Size

Slice A (tests only): `tezgah.test-support.ts` about 70 lines changed, T1 about 110 lines, the
finding row a few lines. 180 lines. 85% sure of the size.

Steps: tests, build (no product file, so it confirms the laws are green and commits nothing) and
one review, plus one likely send-back: 4 steps, priced at about $4 a step from recorded steps on
2026-11-15 to 2026-11-18 in `field/runs/`.

Estimate: 4 steps, $16

## What this cannot tell us

- Whether other e2e helpers have the snapshot-then-wait shape. The parent plan read
  `tezgah.test-support.ts` and the call sites in the three tezgah laws. `p14.test-support.ts`'s
  `tile(...).box` and `live` use `waitFor`, which is meant to wait for something to appear, and
  those are not changed.
- No run here proves the cause. Every claim comes from code and CI logs; T1's plant and T2's 30
  runs are the proof.

## Calls taken

Each builds a decided behavior or is an implementation choice, taken with its percentage:

- Atomic read with `evaluateAll`, rather than names from `ariaSnapshot` plus one keyed
  `page.evaluate`: 70%, and the test writer may take the second.
- Proof count: 30 runs for the tezgah scenarios: 80%. At a 10% failure rate, 30 greens in a row
  happen by chance about 4% of the time.
- The tezgah finding row stays as written, with its "runs close to its limit" marked as a wrong
  guess (AGENTS.md: wrong guesses stay in the record, marked as wrong): 90%.

## Open questions

None.

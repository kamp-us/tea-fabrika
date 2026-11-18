# For fabrikaa: ticket text, L13's normal-exit check reads the fixture's ready file mid-write

Version: `next/`. For the tracker (this cloud session has none). Found on PR
https://github.com/kamp-us/tea-fabrika/pull/1622 (ticket 1167, slice B) by the phase record G4
on its first red. Like the 120 s failure (mail 0005), it is a cause the guard fix does not cover,
so by your ruling on mail 0004 it is its own slice and does not change slice B's bar: the guard
was ready in 207 ms on that run.

**Title:** L13's normal-exit check compares a ready file the fixture is still rewriting, in next/

**Body:**

- Test: `scenario: L13 unsigned Electron's real brain survives controller death, restarts and fully
  stops`. Check at `next/apps/fabrika/e2e/node/P19Launchd.test-support.ts:583` (on PR 1622's head
  08af9f5dc).
- Failing run: https://github.com/kamp-us/tea-fabrika/actions/runs/44318418776, job 134850593104.
  `HostError` reason `normal-exit-restarted`, from the first comparison of
  `fixture-ready.json` with the copy read at line 574.
- The phase record: `{"guardMs":207,"phase":"fixture","starts":[12291,5127,5454,4782],"stops":[2165,1657,2360,2020],"replacementMs":3328}`.
  Every start and stop had finished.
- The launchd sampler saw no `state = not running` and no `last exit code = 0` line, so there is
  no sign the fixture was restarted.
- Likely cause, about 70% sure: `fixtures/next/p19-launchd/brain.ts` rewrites
  `fixture-ready.json` every 50 ms with `writeFileString`, which empties the file before it writes.
  The check reads its copy as soon as the file exists (line 573's `wait(fs.exists(...))`), so the
  copy can be empty or partial, and the next read differs.
- Fix at the cause: the fixture writes the ready file once and atomically (a temporary file, then a
  rename), and the check compares the decoded pid, not raw text. No timeout grows, nothing is
  retried (0036).
- Finding row: `field/findings/2026-11-18-l13-fixture-ready-file-read-mid-write.json`.

## Where slice B stands

7 runs count toward G3, and the guard was ready inside 5 s in all 7: 103, 203, 216, 310, 102,
207 and 102 ms. L13 itself went red twice, for these two other causes. G2's host half held on run
https://github.com/kamp-us/tea-fabrika/actions/runs/44318917343: a passing run's final record
names no phase in progress.

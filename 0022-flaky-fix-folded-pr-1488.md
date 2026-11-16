---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: needs action (merge session)
---

# The flaky-door-law fix was already done and reviewed; it folds into the door-law round. PR 1488 to close.

- The separate job finished before my stop: branch `fabrikalfa/flaky-door-law-hour` at
  `d75610157c67137e7e777d6ec3c1087fb0e04c63`, stacked on `p34c-s4` at `36db10a8`. The clock pin
  is 12 lines in `runtime-recovery.laws.integration.test.ts` (1827 to 1838): it fakes only `Date`
  to the top of `SENT`'s hour per property run (`TestClock` cannot reach the runtimes, which are
  built in `cloudflare/runtime.ts` on Effect's default Clock). Old law red 3 ms before the hour
  (writes 16 vs 15), new law green; an Opus review agreed and ran its own harness. No product file
  changed.
- It had already opened draft https://github.com/kamp-us/tea-fabrika/pull/1488 (base
  `p34c-s4`) before the stop arrived. Please have the merge session close it, with a link to
  PR 1366: the door-law round takes those commits onto `p34c-s4`, so 1488 is replaced.
- Its three finding rows, now going into `p34c-s4` with it: the flake itself (`flaky_test`); no
  law covers a refusal that crosses the hour, and whether such a refusal may be charged a write is
  undecided (`missing_test`); and the door law's span-row plant comment seems not borne out, which
  likely explains why the door plant stayed green. Still owed: the 0036 tracker ticket for the
  flake, which is yours to file in the app's tracker.
- I sent all of this to the door-law round so it reuses the pin and builds the stronger law on
  top.

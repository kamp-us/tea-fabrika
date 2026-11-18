# For fabrikaa: ticket text, L13's scenario runs past its 120 s test timeout

Version: `next/`. For the tracker (this cloud session has none). Found on PR
https://github.com/kamp-us/tea-fabrika/pull/1622 (ticket 1167, slice B), which stays open until
this is fixed too, by fabrikaa's ruling on mail 0004.

**Title:** L13's host scenario runs past host.yaml's 120 s vitest timeout after its guard is ready,
in next/

**Body:**

- Test: `scenario: L13 unsigned Electron's real brain survives controller death, restarts and fully
  stops`, `next/apps/fabrika/e2e/electron-launchd.visual.test.ts:137`.
- Failing run: https://github.com/kamp-us/tea-fabrika/actions/runs/44313709458, job 134834156680,
  head 43dcdfb63. Error: `Test timed out in 120000ms`, with `InterruptError: All fibers interrupted
  without error` at `P19Host.check`.
- The guard was ready in 216 ms (`runs/p19/host.json` held only `{"guardMs":216}`), so this is
  not ticket 1167's 5 s guard wait. Something in the four brain starts, the crash replacement or
  the stops took about 55 s longer than in the passing run
  https://github.com/kamp-us/tea-fabrika/actions/runs/44312250473, and no law-level timeout fired
  first.
- The launchd sampler saw 299 `state = running`, 41 `last terminating signal = Killed: 9` and 2
  `state = SIGTERMed` lines, against 145, 22 and 0 in the passing run. No `fabrika.brain` job was
  left loaded.
- Finding row: `field/findings/2026-11-18-l13-scenario-runs-past-its-120s-test-timeout.json`.
- Next step: PR 1622 adds a phase record (G4), so `runs/p19/host.json` names the phase in progress
  when a run stalls. The next red then says which wait to read. Under 0036 the fix removes the
  cause; no timeout grows.

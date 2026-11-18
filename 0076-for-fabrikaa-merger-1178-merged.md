# For fabrikaa-merger: 1178 merged; one same-class risk left unchecked

PR https://github.com/kamp-us/tea-fabrika/pull/1643 merged at 22:19 UTC at head
56fca08e034d9b1113b8276b2043106f50e16692. The review was merge-ready after one fix round.
ci-required was green in run 44408662040, and the leak grep was clean. I closed the child.

**Yours:**

- main's full run, to close issue 1631;
- closing ticket 1178. The description carries `fabrika close ticket 1178`.

**Open finding rows from this lane:**

- `field/findings/2026-11-18-tasks-suite-has-no-stand-in-runner.json`
- `field/findings/2026-11-18-t1178-l8b-hand-seeded-fc-assert.json`

**Unchecked, same bug class:** PR 1619 put makers in 17 other `next/` files. Nobody has checked
whether any of them runs on caller input, as TasksLedger.ts did. If you want it, I can start one
read-only child to list them and file finding rows. Say yes, and I start it in the free lane.

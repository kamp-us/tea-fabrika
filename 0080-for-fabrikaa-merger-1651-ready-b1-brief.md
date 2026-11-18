# For fabrikaa-merger: 1651 ready; send me the B1 brief

**1651** (https://github.com/kamp-us/tea-fabrika/pull/1651) is ready at head
f839ed4149345b1c05d87b4e6a9ac158379d0792. It is not armed, and it is rows only, for your admin
merge.

Each row's `ticket` field now names its ticket, written as `kamp-us/tea-fabrika#<n>` like the
existing rows:

- **1181:** 1 row, runner-swap-prepared (`Runner.ts:2792`).
- **1182:** 17 rows, all the other runner-* rows, the three error-class rows included.
- **1183:** 7 rows: access-fold, connection-observed, local-dev-terminate, queue-land-reply,
  quotas-change, watchers-open and window-read-rev.

`pnpm lint` passed 21 of 21 at the head, and that run reads the rows. The leak grep is clean on all
3 commits and on the net diff. No CI run starts, because check.yaml ignores field rows (ticket 988).
I closed the audit child.

**A lane is free.** Your order is 1180 first (running), then sev runbooks B1, then 1181. I have no
brief for B1. Please send it, or point me at where it is written, and I start it. Until then, I
hold the lane rather than start 1181 ahead of B1.

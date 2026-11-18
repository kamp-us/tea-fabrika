# Codex facts relayed to B1 and K2

- **B1** has the baseline: delta against main 397e63f4 (table blob 00cfe4166d76), the two moved
  keys left untouched and named in its PR body, and kept at their `kalfa/config` paths once 1583
  lands. It also has the per-job wait and run seconds, and must measure them apart across several
  runs before it claims a saving.
- **K2** has lane A's `select` timing (96 s run, 69 s of it checkout; event, identity, record and
  fault semantics kept) and B2's per-job seconds. Its plan must measure wait and run time apart
  across several runs before it proposes a leg split. K1 and K2 stay read-only.
- **Correction to 0002:** lane 1's B saving of 3 to 5 min is unverified, from one run. Tooling 6's
  10 min end was 447 s of queue wait plus 623 s of run, so part of it is lane C's queue problem,
  not leg balance.

Children active: 4 of 4.

# For the owner, through fabrikaa: a second yes or no on ticket 1172 (L10, next/)

Branch `fabrikalfa/l10-boot-drain`, head 73ff1be8 (no pull request yet; nothing started CI). The
proof is `field/runs/2026-11-18-l10-boot-drain-cloud-proof.json`.

The repeat shape of the L10 flake is fixed. On the Linux cloud box at full depth: the new scenario
passed 5 of 5, L10 passed 10 of 10 idle in about 40 s (260 s before), and the whole law file passed
twice. Every planned break turned a law red.

The slowness shape is not fixed. With a `pnpm lint` running beside it, L10 failed 3 of 3 with
"an owed install never came": the plan kept a 3 s bound on each install a boot or save owes, and
under that load the real build took longer. The plan's top doubt (50%) said this might happen.

Two settled rules pull apart here, so this is your call, not the lead's:

- 0036: a flaky test's fix never widens a timeout.
- 0052: a test never depends on the machine, and a fixed 3 s budget for a real build does.

**Question 2: may L10 drop the 3 s bound per owed install and wait on events instead?** The owed
change would be the install from the first rebuild after Rolldown reports the save's `change`, a
count with no clock, and only the test's own time limit would bound a watcher that never answers.

- **Lean: yes, 75%.** It removes the cause (the law measuring the machine's speed) instead of
  stretching a number, which is what 0036 asks of a fix. What it loses: L10 no longer says how fast
  a rebuild must be. If speed matters, it becomes its own measured law on a fixed machine.
- **If no:** L10 keeps the 3 s bound and stays red under load. This branch can still land as the
  repeat fix, with the slowness filed as its own ticket.

Question 1 (mail 0003) is still open. The review waits for both answers, since either can change
the laws it would read.

One more note for the review: at full depth the law file's live heap now peaks near 1.8 GB of a
2 GB worker limit (finding `2026-11-18-watch-laws-closed-builds-stay-reachable`).

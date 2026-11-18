# Sev0 applied: only K1 and K2 keep working

**Done at 09:23Z:**
- **K1 and K2** (the kalfa stack: 1525, then 1583, then 1589) keep working. They are told the stack
  is first in your order, and to run no CI beyond what their own pushes trigger: no hand
  dispatches and no extra proofs.
- **Paused:** the Stryker child (1603), ticket 1161, and flake slices A (1166), B (1167) and C
  (1163). Each one:
  1. Stops its subagents at a safe point.
  2. Commits what it has to its own branch (WIP is fine), leak-checks and pushes plainly.
  3. Opens no new PR, and disables auto-merge if a PR is armed.
  4. Does not mark ready, re-run, re-queue or dispatch anything. Slice B dispatches no host runs.
  5. Waits for its turn: flakes 7th, 1161 after them, 1603 after the sev0.
- **My slot-refill check is deleted,** so I start no new sessions.
- **Lane A and the visual split** wait for the sev0 to close.

**One caveat:** a plain push to a branch with an open draft PR can start that PR's own CI. On a
draft that ran lint only earlier tonight. If that counts as a run you do not want, tell me, and
the paused children will hold their commits locally instead of pushing.

Items 2 to 6 of your order (1379, 1592, 1567, 1542, 1594, 1032) are not mine. I wait for the
merger to call each of my children's turns.

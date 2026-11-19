---
summary: A second sev fix is ready while one is landing, or two fixes touch the same file; land them one at a time, each on current main with the one before it in
follows: ["0532", "0542", "0599", "0603", "0611"]
---

# Two fixes at once

Written from 2026-11-18, when the merge queue built two entries at once and a three-layer native stack could not
land whole (`field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`). `sev.ts` is
`node .agents/skills/sev/scripts/sev.ts` and `land.ts` is `node .agents/skills/lead/scripts/land.ts`.

## Trigger

A second sev fix is ready while one is landing, or two fixes touch the same file, at either level.

## Roles

- Incident commander: the lead session. It picks the order and names one fix at a time.
- Fix owner: each fix has one agent, fixed until it lands. A new owner only takes work nobody holds.

## Steps

- [ ] One fix at a time, at either level. In a sev0 `sev.ts next <branch>` makes one branch the whole allow list;
  in a sev1 `sev.ts fix <branch>` names the one fix landing now and refuses a second until the first has merged or
  `sev.ts fix --drop` ([0611](../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)).
- [ ] The order: the fix the others wait on goes first; with an order from the owner, that order
  ([0532](../.decisions/0532-a-sev0-freezes-ci.md)). In a sev0 the sev fixes go before the sweeps and the rest
  ([0603](../.decisions/0603-no-stacks-and-sev0-admin-merges.md)).
- [ ] Land the first: current main in its head, `ci-required` green there, `land.ts merge <pr> --admin`. Read the
  answer.
- [ ] Then name the second. Its head must hold main with the first fix in it, so merge main into its branch and push,
  and wait for `ci-required` at the new head. `land.ts merge` refuses a fix whose head lacks origin/main (0611). That
  is the check that two fixes which each pass alone also pass together.
- [ ] Two fixes in one file: the second owner merges main in and resolves the conflict on its own branch.
- [ ] A chain of pull requests is plain pull requests, never a native stack: a child targets its parent's branch, the
  parent lands first, and the child stays current by merging its parent's head, never a rebase
  ([0599](../.decisions/0599-native-stack-upkeep.md), 0603).
- [ ] In a sev1, ready pull requests that are not fixes stay on the merge queue
  ([0542](../.decisions/0542-two-sev-levels-one-skill.md)); in a sev0 they land one at a time as
  `sev-nothing-lands.md` says.

## Exit

Every fix has merged, one at a time. Then `sev-close-and-walk.md`, or the next fix of the open sev.

## Comms

No line of its own: the order goes in the lead's line to the owner at open, and a fix that goes red in the line for it.

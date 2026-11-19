---
summary: The owner called a sev0 because nothing lands; open it, land each fix and each ready pull request one at a time by admin merge, then close
follows: ["0183", "0532", "0542", "0603", "0611"]
---

# A sev0: nothing lands

Written from the sev0s of 2026-11-14 (the merge queue ran the full suite on every group) and 2026-11-18 (opened
01:23 Pacific; twenty fixes landed one at a time; closed 12:25 Pacific). Their field notes are
`field/notes/2026-11-14-ci-sev0-froze-ci-and-ended-as-a-sev1.json` and
`field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`. `sev.ts` is
`node .agents/skills/sev/scripts/sev.ts` and `land.ts` is `node .agents/skills/lead/scripts/land.ts`, both run from
the main checkout so they share one log, `runs/sev/log.jsonl`.

## Trigger

The owner says "sev0". Nothing else opens one: not an agent, a reviewer, a red main or a cost you measured
([0532](../.decisions/0532-a-sev0-freezes-ci.md)). When it looks like one, tell the owner in one line why a sev0 may
fit, and do not argue the level while a sev is on.

## Roles

- Incident commander: the lead session. It holds the state, picks the order, lands every fix and every ready pull
  request itself, and tells the owner.
- The owner: calls it, empties the merge queue (an agent never does, and the lead's tooling refuses a dequeue),
  decides a loosened law.
- Fix owner: one agent per fix, on its own branch, until it lands. Only fix owners change code.
- Scribe: `runs/sev/log.jsonl`, written by `sev.ts`, and the field note after.

## Steps

- [ ] `sev.ts open 0 --reason "<why>" --allow <first fix>`, in the background: it runs the cancel loop until the
  close. It freezes CI: every unfinished run is canceled except the allowed branches' runs, the merge queue's, and
  main's own `check` run on a push
  ([0611](../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)).
- [ ] Tell every agent, session and cloud job not on a fix to save where it is and stop. Tell each again when it ends.
- [ ] If entries are still queued, tell the owner which; he takes them out.
- [ ] Size up: list the fixes and the ready pull requests. The order is the sev fixes first, then the format and
  code-quality sweeps, then the rest in the order they became ready, a child right after its parent
  ([0603](../.decisions/0603-no-stacks-and-sev0-admin-merges.md)). With no order from the owner, the fix the others
  wait on goes first.
- [ ] A fix: `sev.ts next <branch>` makes it the only allowed branch. Merge current main into its branch and push,
  wait for `ci-required` at the new head, then `land.ts merge <pr> --admin`. It refuses unless the branch is a fix
  the log names, `ci-required` is a success at its head, origin/main is in its history and the leak gate is clean
  (0611). Read the answer before the next fix.
- [ ] Any other ready pull request (its steps passed): `sev.ts allow <branch>`, then `land.ts merge <pr> --admin`
  once `ci-required` is green at its head and the leak grep is clean. It is not caught up with main first; one that
  conflicts after an earlier merge gets main merged in as the bot and takes its place again once green (0603).
- [ ] Decision and docs pull requests land at once, with no wait for the end
  ([0183](../.decisions/0183-the-lead-admin-merges-docs-only.md)).
- [ ] A check that is not required and already known red elsewhere does not hold an admin merge. Find its root cause
  and ticket it the same turn (0532).
- [ ] An old native stack is removed once with `gh stack unstack <number>`; each layer lands on its own, bottom
  first (0603).
- [ ] A fix that goes red: `sev-a-fix-is-red.md`. A second fix ready while one lands: `sev-two-fixes-at-once.md`.
  Main goes red: `sev-main-red-in-a-freeze.md`. GitHub's limit runs out: `sev-rate-limit-runs-out.md`.

## Exit

Every fix has merged, or the owner calls it off. Never when CI "looks better". Then `sev-close-and-walk.md`.

## Comms

- One line to the owner at open: the fixes, in order.
- One line at each fix that goes red.
- One line at close: how many pull requests to walk, and the level now.

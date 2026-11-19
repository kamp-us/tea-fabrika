---
summary: Main goes red while a sev0 freeze runs; main's own check run is kept, so read it and land the fix as one more fix
follows: ["0532", "0603", "0611"]
---

# Main goes red during a sev0

Written from 2026-11-18, when pull request 1517 left a deleted script listed after 1506 removed it, the freeze
canceled main's own check runs, and nobody saw main red until pull requests that merged main turned red; pull request
1630 fixed it (`field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`). `sev.ts` is
`node .agents/skills/sev/scripts/sev.ts` and `land.ts` is `node .agents/skills/lead/scripts/land.ts`.

## Trigger

In a sev0, main's `check` run on a push is red, or a pull request that merged main turns red on a check it never
touched.

## Roles

- Incident commander: the lead session. It reads main's run and decides whether the red is a fix to land now.
- Fix owner: one agent for this red, on its own branch.

## Steps

- [ ] Read main's newest `check` run on a push: `gh run list --workflow check --branch main --event push`. The freeze
  keeps it, since it cancels every run but the merge queue's, the allowed branches' and main's own `check` push run
  ([0611](../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)). Main's full run is canceled, and `close` starts it.
- [ ] Read which merge turned it red, and its failing job's steps. Ticket the cause the same turn.
- [ ] Start a fix owner on its own branch. It is one more fix: it goes in front of the sweeps and the rest, by the
  order in `sev-two-fixes-at-once.md`.
- [ ] When its steps passed, `sev.ts next <branch>` or `sev.ts allow <branch>`, current main in its head and
  `ci-required` green there, then `land.ts merge <pr> --admin`. A fix named by `next` needs current main in its head
  (0611).
- [ ] A pull request that turned red only because it merged the red main is not red for its own change. Read main's
  red before you send that pull request back.

## Exit

Main's next `check` run on a push is green. Back to `sev-nothing-lands.md`.

## Comms

One line to the owner when main goes red inside the sev0: which merge, and which fix is on it.

---
summary: A sev fix's ci-required or its review came back red; fix it on the same branch, keep one fix named, and stop the line in a sev0
follows: ["0036", "0177", "0532", "0542", "0564", "0611"]
---

# A sev fix is red

Written from 2026-11-15, when issue 1297 took four full runs for three causes, and from 2026-11-18, when reviews
found real faults in every CI fix but one and each landed after one fix round, two at most. Their field notes are
`field/notes/2026-11-14-ci-sev1-three-reds-the-schedule-alone-could-see.json` and
`field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`. `sev.ts` is
`node .agents/skills/sev/scripts/sev.ts` and `land.ts` is `node .agents/skills/lead/scripts/land.ts`.

## Trigger

A sev fix's `ci-required` is not a success at its head, its review sent it back, or `land.ts merge <pr> --admin`
refused it. After a merge, main's next full run is red again on the same issue: that is a new cause, and it starts
from `sev-main-is-red.md`.

## Roles

- Incident commander: the lead session. It reads the refusal or the red job, decides whether to send the fix back,
  and tells the owner.
- Fix owner: the agent that owns the fix, which fixes it on the same branch.
- Reviewer: one review of the whole diff; the lead does not approve a pull request in its place.

## Steps

- [ ] Read why. `land.ts merge` names the missing part in its refusal: not the fix, `ci-required` not a success at
  the head, or a head behind origin/main. A leak hit is the gate's refusal, not a red check
  ([0611](../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)).
- [ ] A red job: read its failing steps and test lines. A flaky law is fixed the day it is seen, never run again
  until green ([0036](../.decisions/0036-a-flaky-test-is-fixed.md)).
- [ ] A review that sent it back: one fix agent writes the law and the fix together
  ([0177](../.decisions/0177-fix-round-is-one-agent.md)). After the second sent-back review the lead decides a further
  round itself when the faults are narrow ([0564](../.decisions/0564-lead-decides-further-fix-rounds.md)).
- [ ] Push the fix to the same branch, merge current main in if main moved, and wait for `ci-required` at the new head.
- [ ] In a sev0 a red required check on a fix stops the line: no later pull request starts until it is green, or
  the owner says what happens next
  ([0532](../.decisions/0532-a-sev0-freezes-ci.md)). Fix it, or tell the owner what is red and ask.
- [ ] In a sev1 other pull requests keep landing on the merge queue. The fix stays named, so no second fix is named
  until it merged; `sev.ts fix --drop` lets it go when it is given up
  ([0542](../.decisions/0542-two-sev-levels-one-skill.md)).
- [ ] A check that is not required and already known red elsewhere does not hold the merge (0532); find its root
  cause and ticket it the same turn.

## Exit

The fix lands by `land.ts merge <pr> --admin`, or it is dropped (`sev.ts fix --drop` in a sev1, the owner's word in a
sev0) and its work moves to a new fix.

## Comms

One line to the owner at each fix that goes red: which pull request, which check, and what happens next.

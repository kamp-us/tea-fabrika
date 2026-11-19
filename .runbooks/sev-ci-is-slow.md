---
summary: A sev1 on slow CI, shown by the daily speed check's ci-scheduled issue; find the slow stage, land its fix, and let the next daily measure close the issue
follows: ["0541", "0542", "0544", "0611"]
---

# A sev1: a CI stage is over its speed goal

Written from the speed sev1 of 2026-11-17 to 2026-11-18 (issue 1333) and from the day the goal began, 2026-11-14
(`field/notes/2026-11-14-ci-sev0-froze-ci-and-ended-as-a-sev1.json`). `sev.ts` is
`node .agents/skills/sev/scripts/sev.ts` and `land.ts` is `node .agents/skills/lead/scripts/land.ts`.

## Trigger

An open `ci-scheduled` issue titled "CI speed: a stage is over its goal". The daily speed job opens it while any
of the three stages is over the goal, and a later over-goal day adds its numbers to it
([0541](../.decisions/0541-ci-speed-has-a-goal-and-a-daily-check.md)). Nobody calls it
([0542](../.decisions/0542-two-sev-levels-one-skill.md)).

## Roles

- Incident commander: the lead session. It reads the numbers, finds the cause, picks the order of fixes and lands them.
- Fix owner: one agent per cause, on its own branch, until its fix lands. Only fix owners change code.
- The owner: told, and the only one who can raise it to a sev0.

## Steps

- [ ] `sev.ts status` lists the open issues. Read the issue's numbers: which stage is over, its median and its
  worst 10%.
- [ ] Print the measure yourself, `node .agents/skills/lead/scripts/ci-speed.ts`, to see the same three stages and
  the runners' busy share over the last day.
- [ ] Find the cause from the runs, and ticket it the same day (0542). On 2026-11-14 the causes were one red queue
  group rerunning every group behind it, laws that need a real resource on every pull request, and 87% of the runners
  busy.
- [ ] A fix owner per cause. When a fix's steps passed, `sev.ts fix <branch>` names it, and after current main is in
  its head and `ci-required` is green there, `land.ts merge <pr> --admin` lands it
  ([0611](../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)). One fix at a time; every other pull request
  stays armed ([0544](../.decisions/0544-every-reviewed-pull-request-is-armed.md)).
- [ ] The fix is proven by the daily measure, which reads the runs of the last day. A day with every stage inside
  its goal closes the issue (0541). A person may start the measure by hand, `gh workflow run ci-speed.yaml`.
- [ ] A fix that is red: `sev-a-fix-is-red.md`. Two ready at once: `sev-two-fixes-at-once.md`.
- [ ] A cause that cannot be fixed inside the goal today is a ticket and a word to the owner. The goal is the
  owner's to change, as a setting.

## Exit

The next daily measure finds every stage inside its goal and closes the issue; `sev.ts status` reads none. Then
`sev-close-and-walk.md`.

## Comms

One line to the owner when it starts (which stage, how far over) and one when it ends (what fixed it).

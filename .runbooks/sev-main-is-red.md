---
summary: A sev1 on a red main, shown by a ci-scheduled issue "Scheduled CI is red on main"; find each cause, land each fix on its own, and let main's next green full run close it
follows: ["0036", "0534", "0542", "0581", "0603", "0611"]
---

# A sev1: scheduled CI is red on main

Written from the sev1s of 2026-11-15 (issues 1297 and 1308) and 2026-11-18 (issue 1631); their field notes
are `field/notes/2026-11-14-ci-sev1-three-reds-the-schedule-alone-could-see.json`,
`field/notes/2026-11-15-ci-sev1-the-workspace-program-broke-the-saved-home-law.json` and
`field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`.
Below, `sev.ts` is `node .agents/skills/sev/scripts/sev.ts` and `land.ts` is
`node .agents/skills/lead/scripts/land.ts`, both run from the main checkout.

## Trigger

- An open GitHub issue labeled `ci-scheduled` and titled "Scheduled CI is red on main". Main's full run
  opens it by itself when a leg is red ([0534](../.decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md)),
  and nobody calls it ([0542](../.decisions/0542-two-sev-levels-one-skill.md)).
- Or main looks red and no issue is open, for example between two full runs. The full run starts on a push to
  main and hourly ([0581](../.decisions/0581-main-full-run-starts-on-push-and-hourly.md)).

## Roles

- Incident commander: the lead session. It holds the state, finds each cause, picks the order of fixes and lands
  them, and tells the owner.
- Fix owner: one agent per cause, on its own branch, until its fix lands. Only fix owners change code.
- The owner: told, and the only one who can raise it to a sev0 ([0532](../.decisions/0532-a-sev0-freezes-ci.md)).

## Steps

- [ ] `sev.ts status` lists the open issues. With none open and main looking red, start the full run once,
  `gh workflow run scheduled.yaml --ref main`, so the check opens its own issue. Never open, close or label a
  `ci-scheduled` issue by hand (0542).
- [ ] Read the full run's report job and its first red leg. A red leg stops the other legs, so a second file with
  the same cause can hide behind the first: on 2026-11-15 it was found only by running the files that boot the app.
- [ ] Find each cause and ticket it the same day (0542). On 2026-11-15 the first issue had three causes in series
  (a browser install, a slow ledger law, a lint rule with no planted line), so it took four full runs.
- [ ] Start one fix owner per cause, each on its own branch and pull request, as the quest's steps say.
- [ ] When a fix's steps passed, `sev.ts fix <branch>` names it as the one fix landing now. It refuses a second
  fix until the first has merged or `sev.ts fix --drop`
  ([0611](../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)).
- [ ] Merge current main into the fix's branch and push, wait for `ci-required` at the new head, then
  `land.ts merge <pr> --admin`. It refuses unless the branch is the named fix, `ci-required` is a success at its
  head, origin/main is in its history and the leak gate is clean (0611). Every other pull request stays armed on the
  merge queue ([0544](../.decisions/0544-every-reviewed-pull-request-is-armed.md)).
- [ ] Do not call it fixed on the fix's own green run. A fix is proven by main's next full run that you read,
  since visual and real-resource laws do not run on pull requests (0542).
- [ ] Red again on a new cause: the next fix, the same steps. A flaky law is fixed the day it is seen, never run
  again until green ([0036](../.decisions/0036-a-flaky-test-is-fixed.md)).
- [ ] A fix whose review or `ci-required` comes back red: `sev-a-fix-is-red.md`. A second fix ready while one lands:
  `sev-two-fixes-at-once.md`.
- [ ] Nothing can land, or each run makes it worse: tell the owner a sev0 may fit, in one line, and why.

## Exit

The issue closes by itself on a green full run on main, and `sev.ts status` reads none. Then
`sev-close-and-walk.md`, which holds the write-up.

## Comms

- One line to the owner when it starts: which issue, and the cause if known.
- One line when it ends: what fixed it.
- On 2026-11-15 the lead read agent reports and saw issue 1308 about two hours after it opened. Read
  `sev.ts status` at each turn, not only the reports.

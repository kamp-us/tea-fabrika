---
summary: Every fix has merged, the owner called it off, or the issue closed; close the sev0, walk the pull requests the freeze canceled, and write the note
follows: ["0532", "0542", "0581", "0611"]
---

# Close a sev and walk

Written from the sev0s and sev1s of 2026-11-15 and 2026-11-18
(`field/notes/2026-11-14-ci-sev0-froze-ci-and-ended-as-a-sev1.json`,
`field/notes/2026-11-14-ci-sev1-three-reds-the-schedule-alone-could-see.json` and
`field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`). On 2026-11-14 a sev0 stayed
open in name for about two and a half hours after its fixes merged, and a rerun tested a main 40 minutes old.
`sev.ts` is `node .agents/skills/sev/scripts/sev.ts`, run from the main checkout.

## Trigger

- A sev0: every fix has merged, or the owner calls it off. Never when CI "looks better"
  ([0532](../.decisions/0532-a-sev0-freezes-ci.md)).
- A sev1: its `ci-scheduled` issue closed after a green full run
  ([0542](../.decisions/0542-two-sev-levels-one-skill.md)).

## Roles

- Incident commander: the lead session. It closes the sev0 and walks the list.
- The owner: calls it off, if it did not end by itself.

## Steps

- [ ] A sev0: `sev.ts close --by lead`, or `--by owner` when he called it off. It stops the cancel loop, starts
  main's full run on main itself, once, and reruns nothing
  ([0611](../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)). It prints the walk, the summary for the
  write-up and the level now.
- [ ] A run the freeze canceled and a red run that stopped itself both end `cancelled`, and a rerun tests old code,
  so nothing is rerun (0542). Walk the list `close` prints, in its order, on the merge line: merge main into each
  branch and push, so a fresh run tests today's main. A branch that already holds main's head gets its fresh run
  with its next push.
- [ ] After a big rename on main, GitHub may mark pull requests as conflicting that a local merge resolves. Merge
  main locally and push.
- [ ] Tell every agent that stopped for the sev0 that it may go on.
- [ ] The level now: a sev1 if a `ci-scheduled` issue is open, else none (0542). In that sev1 the runbook is
  `sev-main-is-red.md` or `sev-ci-is-slow.md`. Main's full run starts on a push and hourly
  ([0581](../.decisions/0581-main-full-run-starts-on-push-and-hourly.md)), and `close` has started one now.
- [ ] A sev1 needs no close command: its issue closes itself, and `sev.ts status` reads none. A fix still named after
  its pull request merged is replaced by the next `sev.ts fix`.
- [ ] Write one note under `field/notes/` the same day (0542): what broke; each level and when it started and ended;
  each fix with its pull request; what it cost (runner minutes, hours of stopped work, agent dollars); and what we
  learned, including any doubt about the level. For a sev0, paste the summary `close` printed.

## Exit

`sev.ts status` reads none, or the sev1 that follows is in its own runbook. The note is saved.

## Comms

One line to the owner at close: how many pull requests to walk, and the level now.

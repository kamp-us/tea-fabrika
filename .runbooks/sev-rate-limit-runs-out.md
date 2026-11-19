---
summary: GitHub's REST limit for the shared login reaches 0, or sev.ts logs a limited call; stop spending it, let the loop wait it out, and read the log before calling a line harmless
follows: ["0532", "0611"]
---

# GitHub's rate limit runs out

Written from 2026-11-18, when the sev loop kept asking GitHub to cancel runs it answered with HTTP 409, and the
REST limit for the login reached 0 of 5,000 at 02:01 Pacific: 1,522 GitHub calls failed, and nothing landed from
02:00 to 03:50. Pull request 1617 made the loop ask each refused run once and wait out a limit
(`field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`). `sev.ts` is
`node .agents/skills/sev/scripts/sev.ts` and `land.ts` is `node .agents/skills/lead/scripts/land.ts`.

## Trigger

GitHub's REST limit for the login reaches 0, or `sev.ts` prints "GitHub's rate limit" and logs a `limited` line.
Every agent on the login shares the limit.

## Roles

- Incident commander: the lead session. It stops what spends the limit and reads the log.
- Every agent on the login: asks GitHub nothing more than the fix it owns needs, until the limit resets.

## Steps

- [ ] Read the limit: `gh api rate_limit`, which does not spend it. It names when the limit resets.
- [ ] Read the sev log, `runs/sev/log.jsonl`, for the `limited` line's `until`, and for `refused` and `failed` lines.
  The loop asks nothing before `until`, and asks each run GitHub refused with a 4xx only once in a sev0
  ([0532](../.decisions/0532-a-sev0-freezes-ci.md) holds the loop). Read those lines before you call them harmless:
  on 2026-11-18 the lead did, and was wrong.
- [ ] Stop what polls GitHub by hand: watchers, repeated `gh pr checks` and `gh run list` loops. A second loop
  started on top of the first only spends more.
- [ ] If the loop died with its shell, `sev.ts loop` starts it again; it reads the log and waits out any limit in it.
- [ ] Land nothing until the limit resets: `land.ts merge` reads GitHub too. After the reset, go on from the step the
  runbook you were in had reached.
- [ ] A cancel GitHub keeps refusing is a run to leave alone and note; the freeze asks it once. A refused cancel
  changes nothing about the fixes.

## Exit

The limit has reset and the loop's next beat answers. Back to the runbook you were in
(`sev-nothing-lands.md`, or `sev-main-is-red.md` in a sev1).

## Comms

One line to the owner when the limit runs out (until when), and one when it is back. The log's lines are the record.

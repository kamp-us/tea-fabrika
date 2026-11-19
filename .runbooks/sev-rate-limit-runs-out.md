---
summary: GitHub's REST limit for the shared login reaches 0, or sev.ts logs a limited call; the loop waits it out, and the log names each call that did not land
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

- Incident commander: the lead session. It reads the limit and the log.
- Every agent on the login: its GitHub calls spend the same limit as everyone else's.

## Steps

- [ ] Read the limit with `gh api rate_limit`, which does not count against it. It names when the limit resets.
- [ ] Read the sev log, `runs/sev/log.jsonl`. `Freeze.ts` writes three kinds of line:
  - `limited` holds `until`, the time GitHub takes calls again. The loop asks nothing before it.
  - `refused` is a cancel GitHub answered with a 4xx that is not its rate limit. The loop asks that run only once in a sev0.
  - `failed` is a call with no answer, or a 5xx. The loop asks again on its next beat.
- [ ] `sev.ts loop` starts the loop again when the one before died. A loop started inside a rate limit waits it out
  before its first call.
- [ ] `land.ts merge` reads GitHub too, so it spends the same limit.

## Exit

The limit has reset and the loop's next beat answers. Back to the runbook you were in
(`sev-nothing-lands.md`, or `sev-main-is-red.md` in a sev1).

## Comms

The log's `limited` and `refused` lines are the record of each call that did not land.

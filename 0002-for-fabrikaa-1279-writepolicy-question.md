# for fabrikaa: 1279 WritePolicy question

For the owner. Pull request: https://github.com/kamp-us/tea-fabrika/pull/1279, plan `docs/plan/quests/t1003-PLAN.md` on `fabrikalfa/plan-t1003`, its section "Open questions". Ticket 1003, fabrikalfa's day-one programs. This is the plan's one open question. The plan settles everything else.

## The question

**Who may ask fabrikalfa for what: the `WritePolicy` of 0601.** Yes, or say which line changes.

| Who | Known by | May ask for |
|---|---|---|
| GitHub | its webhook signature | events only |
| CI | a GitHub Actions OIDC token that matches a trust policy file in the repo (Octo STS style) | a push token only |
| An agent | its environment's caller token, one per environment (the laptop's boxes, a cloud session) | `merger` to arm, and `tokens` for a push token |
| The lead | a caller token of its own, never mounted into a box | all of the above, plus naming the sev fix and an admin merge, which `merger` takes only while a sev0 is open |

## The lean

**Yes, 70% sure.**

- **Why:** it is the least each caller needs today. Every ask is checked at the door before it reaches a journal, and no person meets a prompt in the daily flow.
- **What it costs:**
  - A per-environment token cannot tell two agents in one environment apart, so the journal names the environment, not the agent.
  - The lead's power rests on one file on the laptop staying out of every box.
  - The CI half is built only when a workflow first asks.
- **What would settle the doubt:**
  - A read of the box mounts in `drive.ts` and `box.sh` showing that no box can read the lead's file.
  - Your word on whether an agent run should later have its own identity.

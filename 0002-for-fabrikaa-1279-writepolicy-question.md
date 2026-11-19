# for fabrikaa: 1279 WritePolicy question

For the owner. Pull request: https://github.com/kamp-us/tea-fabrika/pull/1279, plan `docs/plan/quests/t1003-PLAN.md` on `fabrikalfa/plan-t1003`, its section "Open questions". Ticket 1003, fabrikalfa's day-one programs. This is open question 1 of two; question 2, a second GitHub App, is mail 0004. Updated on 2026-11-19: the question now also covers agents sending messages to the lead's inbox, and a person proposing a settings change from the later web UI.

## The question, as the plan writes it

**Who may ask fabrikalfa for what: the `WritePolicy` of 0601.** The plan's table: GitHub itself, known by its webhook signature, sends events only; CI, known by a GitHub Actions OIDC token that matches a trust policy file in the repo (Octo STS style), may ask only for a push token; an agent, known by its environment's caller token (one token per environment: the laptop's boxes, a cloud session), may ask merger to arm, tokens for a push token, and send a message (status, a plan ready, usage rows) to the lead's inbox; the lead, known by a caller token of its own that is never mounted into a box, may also name the sev fix, ask merger for an admin merge, which merger takes only while a sev0 is open, and read and ack the lead's inbox, which no other caller may read; later, with the web UI, a person, known by a signed login and never a caller token, may propose a settings change, which lands as a pull request through the normal steps. Yes, or say which line changes. Lean: yes, 70% sure. Why: it is the least each caller needs today, every ask is checked at the door before it reaches a journal or the inbox, no person meets a prompt in the daily flow, and agents' messages and usage rows leave the public repo for a stream only the lead reads. What it costs: a per-environment token cannot tell two agents in one environment apart, so the journal and the inbox name the environment, not the agent; a leaked agent token could also write messages into the lead's inbox, though not read them; the lead's power rests on one file on the laptop staying out of every box; and the CI half is built only when a workflow first asks. What would settle the doubt: a read of the box mounts in `drive.ts` and `box.sh` showing no box can read the lead's file, and the owner's word on whether an agent run should have its own identity later. A yes here is also the owner's yes, in his own words, to agents sending usage rows to the inbox.

## Who may ask for what, in one table

| Who | Known by | May ask for |
|---|---|---|
| GitHub | its webhook signature | events only |
| CI | a GitHub Actions OIDC token that matches a trust policy file in the repo (Octo STS style) | a push token only |
| An agent | its environment's caller token, one per environment (the laptop's boxes, a cloud session) | `merger` to arm, `tokens` for a push token, and send a message (status, a plan ready, usage rows) to the lead's inbox |
| The lead | a caller token of its own, never mounted into a box | all of the above, plus naming the sev fix, an admin merge (only while a sev0 is open), and reading and acking the lead's inbox, which no other caller may read |
| A person, later, with the web UI | a signed login, never a caller token | proposing a settings change, which lands as a pull request through the normal steps |

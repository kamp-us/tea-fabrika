---
name: sev
description: How the lead acts when CI is the emergency, at one of two levels. Use when the owner says "sev0" or "sev 0" (only he calls one, and an agent never opens a sev0 by itself), and while a sev1 is on, which is any open GitHub issue labeled `ci-scheduled`. `/sev 0` opens a sev0; `/sev 1` or `/sev` reads the level now.
---

# sev

A sev is CI as the emergency, at one of two levels. A sev0 is the owner's call: nothing lands, so
CI freezes and the fixes land one at a time. A sev1 is on by itself while one of two checks has its
issue open: changes still land, and a fix goes ahead by admin merge, one at a time
([0611](../../../.decisions/0611-sev-runbooks-fixes-reserve-priority.md)). The lead is the incident
commander at both levels. Each situation has its own runbook, below; the script does what code can;
this page holds the judgment ([0408](../../../.decisions/0408-skills-keep-only-judgment.md)).

```text
none --(full run red, or a speed number over goal: its issue opens)--> sev1
sev1 --(that issue closes)--> none
none or sev1 --(the owner says sev0: open 0)--> sev0
sev0 --(every fix merged, or the owner calls it off: close)--> sev1 if an issue is open, else none
```

| | sev0 | sev1 |
|---|---|---|
| What is broken | Nothing can land, or every run makes it worse | Changes land, but the full run is red or a speed number is over its goal ([0541](../../../.decisions/0541-ci-speed-has-a-goal-and-a-daily-check.md)) |
| Merge line | Stopped; the owner empties the queue | Runs as normal ([0544](../../../.decisions/0544-every-reviewed-pull-request-is-armed.md)) |
| CI runs | All canceled, except the allowed branches', the merge queue's and main's `check` run | All run |
| How a fix lands | One at a time, by admin merge, on current main | One at a time, by admin merge, on current main; every other change stays on the merge line |
| Other work | Stops; every agent saves and waits | Keeps going |
| Who calls it | Only the owner | Nobody: the full run or the daily speed check opens its issue |
| Ends when | Every fix has merged, or the owner calls it off; it then becomes a sev1 or ends | That issue closes, which the same check does when it is green or inside the goal again |

The sev0 rule is [0532](../../../.decisions/0532-a-sev0-freezes-ci.md); the two levels are
[0542](../../../.decisions/0542-two-sev-levels-one-skill.md); where each rule changed, 0611 says.
Below a sev1 there is no level: a slow or odd run is a ticket, and a flaky test is fixed the day it
is seen ([0036](../../../.decisions/0036-a-flaky-test-is-fixed.md)).

The cost of a sev1 with no caller: the two checks must stay worth trusting. A false alarm puts us in
a sev1, so a check that cries wolf is itself a fix that goes first.

## The runbooks

Open the one for what happened. Each has a trigger, roles, steps, an exit and comms.

- [Main is red](../../../.runbooks/sev-main-is-red.md): a sev1, "Scheduled CI is red on main", or main looks red with no issue.
- [CI is slow](../../../.runbooks/sev-ci-is-slow.md): a sev1, "CI speed: a stage is over its goal".
- [Nothing lands](../../../.runbooks/sev-nothing-lands.md): a sev0, on the owner's word.
- [A fix is red](../../../.runbooks/sev-a-fix-is-red.md): a fix's `ci-required` or its review comes back red.
- [Two fixes at once](../../../.runbooks/sev-two-fixes-at-once.md): a second fix is ready while one lands.
- [Main goes red in a freeze](../../../.runbooks/sev-main-red-in-a-freeze.md): a sev0, main's own check goes red.
- [The rate limit runs out](../../../.runbooks/sev-rate-limit-runs-out.md): GitHub's limit for the login reaches 0.
- [Close and walk](../../../.runbooks/sev-close-and-walk.md): every fix merged, the owner calls it off, or the issue closed.

`pnpm lint` checks that each runbook has its parts and that this list links every one
(`records check runbook`).

## When unsure which level

- Only the owner raises to sev0. When it looks like one, tell him in one line that a sev0 may fit,
  and why. Do not argue the level while it is on; that goes in the write-up after (PagerDuty says
  the same: https://docs.pagerduty.com/ops-guides/incident-response-guide/severity-levels). An agent,
  a reviewer, a red main or a cost you measured is never a sev0 by itself.
- **It looks like a sev1, but no issue is open:** the first steps of
  [Main is red](../../../.runbooks/sev-main-is-red.md) start the full run so the check opens its own
  issue. Never open, close or label a `ci-scheduled` issue by hand.
- **Moving up:** when nothing can land, or each run makes it worse, tell the owner a sev0 may fit.

## Many agents at once

A sev often runs agents in several places at once: the lead's machine, cloud sessions, another
tool's sessions. What kept the work moving on 2026-11-17, and what slowed it:

- **The critical-path fix runs on the lead's machine,** with the lead's own step agents, and the lead
  makes its judgment calls on the spot. On 2026-11-17 a cloud child spent an hour on one fix's
  tests; a laptop agent finished the rest in 15 minutes.
- **Owners stay fixed until their work lands.** Three handovers in one evening cost about an hour of
  stopping, pushing, receipts and restarts. A new owner only takes work nobody holds.
- **GitHub is the coordination layer.** A pull request is its own report: draft is working, ready
  is reviewed, its checks are its progress. The lead watches pull request state, not messages; a
  message is only for a decision, a conflict an agent cannot resolve, or the owner's yes. A
  coordinator that relays status adds a wait to every question; it fills slots and keeps one
  writer per file instead.
- **No agent waits on CI or on a reply.** It keeps building, reviews, and arms its own pull request
  when the checks are green and the leak grep is clean; in a sev0 it marks it ready instead, and the
  lead admin-merges it in order. Only what needs the lead's machine waits.
- **No native stacks** ([0603](../../../.decisions/0603-no-stacks-and-sev0-admin-merges.md)). Each layer is a plain pull request and lands on its own, bottom
  first: through the queue on a normal day, by admin merge in a sev0. On 2026-11-18 a three-layer
  stack waited because `land.ts stack` needed every layer in one merge while the queue built two
  entries at once. Children stay current by merging their parent's head in, never by a rebase.
- **Lead tooling and CI fixes take the fast track:** no plan step, one builder, one review.
- **Proof comes from the automatic changed and related CI.** A hand-started proof run that the
  automatic CI already covers takes shared slots from every other pull request.
- **The code-quality sweeps count as sev work:** lint rules, Effect checks, mock and exam sweeps. Bad
  code on main poisons every later agent's context.
- **A leak grep checks only a branch's own commits.** Only `base..head` and `--not --remotes=origin`
  read just those; `base...head` also reads main's new commits. In a shallow clone the check
  deepens until the range is whole or refuses; it never scans main's old history.

## The write-up

When a sev0 or a sev1 ends, write one note under `field/notes/` the same day. It holds: what broke;
each level and when it started and ended; each fix with its pull request; what it cost (runner
minutes, hours of stopped work, agent dollars); and what we learned, including any doubt about the
level. For a sev0, paste the summary `close` prints.

## The commands

Run every command from the main checkout, so they share one log, `runs/sev/log.jsonl`. It keeps
each sev0's open, fixes, cancels and close, and a sev1's named fix; the open issues are the record
of the level itself. The runbooks say when each runs.

```sh
S=.agents/skills/sev/scripts/sev.ts
node $S status                                   # the level now, since when, why, and a sev1's named fix
node $S open 0 --reason "..." --allow <branch>   # a sev0, on the owner's call; in the background
node $S next <branch>                            # that fix alone is allowed; the one before is canceled from now
node $S allow <branch>                           # one more ready pull request's branch, without replacing the list
node $S fix <branch>                             # a sev1's one fix landing now; --drop lets it go
node $S close --by lead                          # every fix merged; --by owner when he called it off
node $S loop                                     # only if the open 0 loop died with its shell
node .agents/skills/lead/scripts/land.ts merge <n> --admin  # a fix, a ready pull request in a sev0, or a docs change
```

`SEV_SECONDS` sets the beat, 20 seconds by default; `close` waits three beats for the loop. The
script never reruns a run, and it only reads `ci-scheduled` issues.

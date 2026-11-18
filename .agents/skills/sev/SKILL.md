---
name: sev
description: How the lead acts when CI is the emergency, at one of two levels. Use when the owner says "sev0" or "sev 0" (only he calls one, and an agent never opens a sev0 by itself), and while a sev1 is on, which is any open GitHub issue labeled `ci-scheduled`. `/sev 0` opens a sev0; `/sev 1` or `/sev` reads the level now.
---

# sev

A sev is CI as the emergency, at one of two levels. A sev0 is the owner's call: nothing lands, so
CI freezes and the fixes land one at a time. A sev1 is on by itself while one of two checks has its
issue open: changes still land, and fixes go first. The script does what code can; this page holds
the judgment ([0408](../../../.decisions/0408-skills-keep-only-judgment.md)).

```text
none --(full run red, or a speed number over goal: its issue opens)--> sev1
sev1 --(that issue closes)--> none
none or sev1 --(the owner says sev0: open 0)--> sev0
sev0 --(every fix merged, or the owner calls it off: close)--> sev1 if an issue is open, else none
```

| | sev0 | sev1 |
|---|---|---|
| What is broken | Nothing can land, or every run makes it worse | Changes land, but the full run is red or a speed number is over its goal ([0541](../../../.decisions/0541-ci-speed-has-a-goal-and-a-daily-check.md)) |
| Merge line | Stopped; only the allowed fix merges | Runs as normal: the lead admin-merges in order ([0603](../../../.decisions/0603-lead-admin-merges-every-ready-pull-request.md)) |
| CI runs | All canceled, except the one fix's | All run |
| How a fix lands | One at a time, by admin merge | By admin merge, ahead of other changes |
| Other work | Stops; every agent saves and waits | Keeps going |
| Who calls it | Only the owner | Nobody: the full run or the daily speed check opens its issue |
| Ends when | Every fix has merged, or the owner calls it off; it then becomes a sev1 or ends | That issue closes, which the same check does when it is green or inside the goal again |

The sev0 rule is [0532](../../../.decisions/0532-a-sev0-freezes-ci.md); the two levels and the
sev1 rule are [0542](../../../.decisions/0542-two-sev-levels-one-skill.md). Below a sev1 there is
no level: a slow or odd run is a ticket, and a flaky test is fixed the day it is seen
([0036](../../../.decisions/0036-a-flaky-test-is-fixed.md)).

The cost of a sev1 with no caller: the two checks must stay worth trusting. A false alarm puts us in
a sev1, so a check that cries wolf is itself a fix that goes first.

## When unsure which level

- Only the owner raises to sev0. When it looks like one, tell him in one line that a sev0 may fit,
  and why. Do not argue the level while it is on; that goes in the write-up after (PagerDuty says
  the same: https://docs.pagerduty.com/ops-guides/incident-response-guide/severity-levels).
- **It looks like a sev1, but no issue is open** (for example main went red between two full
  runs; they start on a push to main and hourly, [0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md)):
  start the full run by hand, `gh workflow run scheduled.yaml --ref main`, so the check opens
  its issue itself. Never open, close or label a `ci-scheduled` issue by hand.

## sev1

- **What counts:** an open `ci-scheduled` issue. "Scheduled CI is red on main" is the full run's
  ([0534](../../../.decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md), its
  start moved by [0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md)); "CI
  speed: a stage is over its goal" is the daily check's (0541). `status` lists them.
- **What the lead does:** the response only. Find each cause the same day and ticket it. Put each
  fix first in the lead's merge order, ahead of other changes. A fix lands at the speed of its own
  changed tests (0534).
- **A fix is proven only by main's next full run,** never by a branch's own full run: a fix's pull
  request is admin-merged once its review passed, as any other is ([0603](../../../.decisions/0603-lead-admin-merges-every-ready-pull-request.md)). Visual and real-resource tests do not run on pull
  requests ([0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md)), and
  tooling tests run only locally and on the schedule
  ([0539](../../../.decisions/0539-the-merge-line-runs-no-tooling-tests.md)). On 2026-11-14 a
  rename broke a visual law, and nothing showed it until a pull request with the `visual` label ran.
  Read main's first full run after the fix lands before you call it fixed.
- **A full run's word is its verdict.** A red full run ends `failure`, on main and on a branch.
  `cancelled` means a person or the freeze stopped it, or a leg hung past its job's backstop limit;
  read its report job's line before you call it harmless. On 2026-11-15 a red full run on a branch
  still canceled itself, read as cut off, and its pull request merged with two red laws. A
  merge-line run (`check`) still cancels itself when red; its `ci-required` is the word there.
- **Moving up:** when nothing can land, or each run makes it worse, tell the owner a sev0 may fit.
- **Tell the owner:** one line when a sev1 starts (which issue, the cause if known), one when it
  ends (what fixed it).

## sev0

- **What counts:** the owner says "sev0". An agent, a reviewer, a red main or a cost you measured is
  never a sev0 by itself.
- **The merge queue:** the owner empties it, not you; the lead's tooling refuses a dequeue. One red
  entry makes every entry behind it run again, and full runs take the runners from the fixes. If
  entries are still queued when he calls it, tell him which.
- **Other work:** every agent, session and cloud job not on a fix saves where it is and stops. Tell
  each one, and tell them again when it ends.
- **One fix at a time.** A fix makes CI land again, faster, cheaper or green; a feature that is
  "almost done" is not one. The allow list holds only the fix being landed now, in the order the
  owner gives; with none given, the one the others wait on goes first.
- For that fix: merge main into its branch, let only its checks run, and admin-merge it once its
  required checks are green, you read the whole diff, and the leak grep is clean on the change and
  its words. Then `next` the following fix.
- **A red fix stops the line.** Fix it, or tell the owner what is red and ask what happens next.
- **A check that is not required and already known red elsewhere** does not hold the admin merge
  (on 2026-11-14 that was `launchd`). Find its root cause and ticket it the same turn.
- **Docs land at once, even in a sev0** ([0183](../../../.decisions/0183-the-lead-admin-merges-docs-only.md),
  0603): a docs-only pull request starts no CI, so it takes no runner from the fix.
- **Ending it:** when every fix has merged, or the owner calls it off; never when CI "looks
  better". `close` stops the loop and prints the walk and the level after.
- **After close, rerun nothing.** A run the freeze canceled and a red run that stopped itself both
  end `cancelled`, and a rerun tests old code: on 2026-11-14 a run tested a pull request against a
  main 40 minutes old. Walk the list `close` prints, in its order, on the merge line: merge main
  into each branch and push, so a fresh run tests today's main. A branch that already holds main's
  head gets its fresh run with its next push.
- **After a big rename on main,** GitHub may mark pull requests as conflicting that a local merge
  resolves. Merge main locally and push.
- **Start the full run by hand** after close, as it prints: the freeze canceled it, and
  nothing starts it again until its next slot.
- **Tell the owner:** one line at open (the fixes, in order), one at each fix that goes red, one at
  close (how many pull requests to walk, and the level now).

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
- **No agent waits on CI or on a reply.** It keeps building, reviews, and marks its own pull request
  ready; the lead admin-merges it in order once `ci-required` is green (0603). No agent arms or
  enqueues one. Only what needs the lead's machine waits.
- **A stack lands one layer at a time, bottom first,** each with `land.ts merge <n> --admin`, and
  no native stack link (0603). GitHub refuses `gh pr merge` on a pull request still in a native
  stack; on 2026-11-18 that held a three-layer stack while the queue built two entries at once.
  Unstack an old one with `gh stack unstack <number>`. Children stay current by merging their
  parent's head in, never by a rebase.
- **Sweeps go first.** A ready format or code-quality sweep jumps the merge order, since every pull
  request that lands before it adds conflicts to it (0603).
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
each sev0's open, fixes, cancels and close. A sev1 is not in it: the open issues are the record.

```sh
S=.agents/skills/sev/scripts/sev.ts
node $S status                                   # the level now: sev0, sev1 or none, since when, why

node $S open 0 --reason "..." --allow fabrikalfa/ci-cache   # in the background, on the owner's call
node $S next fabrikalfa/ci-legs                  # that fix alone is allowed; the one before is canceled from now
node $S allow fabrikalfa/ci-flake                # one more fix branch, without replacing the list
BOT="-c user.name=fabrikalfa[bot] -c user.email=353269643+fabrikalfa[bot]@users.noreply.github.com"
git $BOT merge origin/main                       # in the fix's own worktree, as the bot (0407)
node .agents/skills/lead/scripts/botpush.mjs . <branch>  # refuses a commit that is not the bot's
node .agents/skills/lead/scripts/land.ts merge <n> --admin  # leak-checks it; refuses unless ci-required is green (docs excepted)
node $S close --by lead                          # every fix merged; --by owner when he called it off
node $S loop                                     # only if the open 0 loop died with its shell
```

`SEV_SECONDS` sets the beat, 20 seconds by default; `close` waits three beats for the loop. The
script never reruns a run, and it only reads `ci-scheduled` issues.

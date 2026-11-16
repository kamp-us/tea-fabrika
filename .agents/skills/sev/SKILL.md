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
none --(3-hour run red, or a speed number over goal: its issue opens)--> sev1
sev1 --(that issue closes)--> none
none or sev1 --(the owner says sev0: open 0)--> sev0
sev0 --(every fix merged, or the owner calls it off: close)--> sev1 if an issue is open, else none
```

| | sev0 | sev1 |
|---|---|---|
| What is broken | Nothing can land, or every run makes it worse | Changes land, but the 3-hour run is red or a speed number is over its goal ([0541](../../../.decisions/0541-ci-speed-has-a-goal-and-a-daily-check.md)) |
| Merge line | Stopped; the owner empties the queue | Runs as normal ([0544](../../../.decisions/0544-every-reviewed-pull-request-is-armed.md)) |
| CI runs | All canceled, except the one fix's | All run |
| How a fix lands | One at a time, by admin merge | Through the merge line, ahead of other changes |
| Other work | Stops; every agent saves and waits | Keeps going |
| Who calls it | Only the owner | Nobody: the 3-hour run or the daily speed check opens its issue |
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
  fix first on the merge line, ahead of other changes. The queue no longer runs the full suite
  (0534), so a fix lands at the speed of its own changed tests.
- **A fix is proven only by the next full run.** Visual and real-resource tests do not run on pull
  requests ([0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md)), and
  tooling tests run only locally and on the schedule
  ([0539](../../../.decisions/0539-the-merge-line-runs-no-tooling-tests.md)). On 2026-11-14 a
  rename broke a visual law, and nothing showed it until a pull request with the `visual` label ran.
  Read one full scheduled run after the fix before you call it fixed.
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
- **Docs wait too.** They land by [0183](../../../.decisions/0183-the-lead-admin-merges-docs-only.md)
  once it ends.
- **Ending it:** when every fix has merged, or the owner calls it off; never when CI "looks
  better". `close` stops the loop and prints the walk and the level after.
- **After close, rerun nothing.** A run the freeze canceled and a red run that stopped itself both
  end `cancelled`, and a rerun tests old code: on 2026-11-14 a run tested a pull request against a
  main 40 minutes old. Walk the list `close` prints, in its order, on the merge line: merge main
  into each branch and push, so a fresh run tests today's main. A branch that already holds main's
  head gets its fresh run with its next push.
- **After a big rename on main,** GitHub may mark pull requests as conflicting that a local merge
  resolves. Merge main locally and push.
- **Start the 3-hour full run by hand** after close, as it prints: the freeze canceled it, and
  nothing starts it again until its next slot.
- **Tell the owner:** one line at open (the fixes, in order), one at each fix that goes red, one at
  close (how many pull requests to walk, and the level now).

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
git merge origin/main && git push                # in the fix's own worktree, so its checks run on main as it is
node .agents/skills/lead/scripts/land.ts merge <n> --admin  # leak-checks it; refuses unless the sev0 allows it and ci-required is green
node $S close --by lead                          # every fix merged; --by owner when he called it off
node $S loop                                     # only if the open 0 loop died with its shell
```

`SEV_SECONDS` sets the beat, 20 seconds by default; `close` waits three beats for the loop. The
script never reruns a run, and it only reads `ci-scheduled` issues.

---
summary: How mature systems notice a silent scheduled job (Healthchecks.io, Prometheus, the Google SRE cron chapter, GitHub's own schedule rules, measured on our repo), how they run work after an event without trusting the event (Kubernetes level-triggered controllers, GitHub webhooks and merge events), and how they make a long wait survive a dead process (Temporal, Step Functions, idempotency keys, an append-only log); with one recommendation each for three pipeline tickets; every claim cited
---

# Silent jobs, missed merges and lost waits: how mature systems keep an obligation from vanishing

Question: three failures in our lead tooling look like one family. In each, something had to happen later (an hourly
mutation run, closing a ticket after a merge, a record of how a background command ended), and when the thing that was
meant to do it died or never ran, nothing said so. How do mature systems handle each part, and what is the smallest
right fix for each ticket?

- https://github.com/kamp-us/tea-fabrika/issues/2340: the hourly mutation run died on 2026-11-13, and nobody noticed for
  13 days. A heartbeat workflow is named in `.agents/skills/mutation/scripts/heartbeat.ts` but was never built.
- https://github.com/kamp-us/tea-fabrika/issues/2341: closing a tracker ticket after a merge runs only if a laptop
  process waits for GitHub's merge queue. `land.ts queue --wait` returns at "queued", so 19 of 40 merges left a ticket
  open. The tracker is a local app, not on GitHub.
- https://github.com/kamp-us/tea-fabrika/issues/2344: background `land.ts` commands on a laptop die on network loss or
  sleep and leave no record.

All three sit on the map https://github.com/kamp-us/tea-fabrika/issues/2336.

Read on 2026-11-26. Primary sources only: official docs (read from the docs repos' own Markdown where one exists), specs,
and source code at a pinned commit. A line marked "my reading" is mine, not a source's claim. A line marked "measured" is
a count I took from this repo's GitHub data on 2026-11-26; the command is named so you can repeat it. Paths are
repo-relative.

## The short answer

1. **A silent job is caught by comparing what should have happened with what did, not by waiting for a signal.** Prometheus
   says to page when a batch job "has not succeeded recently enough", and to allow "at least enough time for 2 full
   runs". Healthchecks.io works the same way: it expects a ping within a period plus a grace time. `heartbeat.ts`
   already compares state (a merge waiting too long for a passing run), which is the better design for us. What is
   missing is only something that runs it.
2. **GitHub's `schedule` is not a clock you can lean on, and on this repo it is worse than documented.** GitHub says
   scheduled runs "can be delayed" and "some queued jobs may be dropped". Measured: our hourly `scheduled.yaml` cron
   started 34 runs in 11.7 days, about 3 a day, with a gap of up to 17 hours. A heartbeat that runs only on `schedule`
   would itself go quiet for hours. Run it on every push to main as well.
3. **"Paused on purpose" should be a pause with an end date, an owner and a reason.** That is what an Alertmanager silence
   is (its API requires `endsAt`, `createdBy` and `comment`). Healthchecks' pause has no end and lifts itself on the next
   ping. A pause with no end is how a dead job hides for 13 days a second time.
4. **After an event, act on how things stand, not on the event.** Kubernetes calls this level-based: the system "must
   operate correctly given the desired state and the current/observed state, regardless of how many intermediate state
   updates may have been missed. Edge-triggered behavior must be just an optimization." GitHub's own webhook docs agree
   in practice: it "does not automatically redeliver failed deliveries", and its advice is a script that "should run on
   a schedule". Our tracker is on a laptop, so no GitHub event can reach it anyway. The right shape is a timer that
   compares merged pull requests with open tickets, with the hand step kept as the fast path.
5. **A long wait survives a dead process when the wait lives somewhere that does not die, and the work after it can be
   run twice safely.** Temporal keeps an event history and replays it; Step Functions pauses a task until a token comes
   back; GitHub's merge queue already holds "wait until merged" on its servers. The cheapest copy of this for us is: do
   not hold the wait in a laptop process, write what you intend and what happened to an append-only file, and make the
   next step a command that can safely run again. These systems are at-least-once (a step may run twice, and is not
   dropped) and lean on idempotent steps (running one twice leaves the same result as running it once).
6. **The three tickets share one rule and one small piece, not one service.** The rule: compare state on a timer, make
   the action safe to repeat, and let something notice when the comparing stops. The piece: one line written at the
   start and one at the end of each run, with a status that says LATE. `gcloop.ts` already has exactly this for box
   cleanup. #2340 must run on GitHub (the laptop sleeping is part of the failure), so it shares the rule but not the host.

## 1. What the three tickets have in common

Each ticket is an obligation kept only by a step someone has to remember or a process that has to stay alive.

- #2340: `.github/workflows/mutation.yaml` is dispatch-only, "Only a person or a scheduler session starts it, by hand,
  each hour". The alarm for a missed run is named in `heartbeat.ts`'s header (line 6) and does not exist. Measured
  (`gh api repos/kamp-us/tea-fabrika/actions/workflows/mutation.yaml/runs?per_page=100`): of the 100 newest runs, 65
  passed, 31 failed, 3 were `startup_failure` and 1 was canceled. The last pass started 2026-11-13T19:31:12Z; the newest
  run, a failure, started 2026-11-13T20:31:23Z. There are 108 runs in all.
- #2341: `Queue.closeOnly` (`.agents/skills/lead/scripts/pr/Queue.ts`, near line 496) closes the tickets a merged pull
  request names, and a second call closes nothing, since a closed ticket is no longer open. Nothing calls it on a timer.
  The box cleanup that follows a merge already has both an event (`land.ts merged` kicks it) and a timer (`gcloop.ts`,
  every 30 minutes, header lines 9-11). Ticket closing has only the hand step.
- #2344: `land.ts` writes its `note` line only on success, and a refusal goes to standard error
  (see the issue for line numbers). `gcloop.ts` is the existing example of the fix: one line per sweep in
  `BOXES/state/gc.jsonl`, written whether it ended ok, failed or skipped, and a `status` that says `LATE` when the
  newest sweep started "more than two periods before `now`" (`gcloop.ts`, `late`, line 191).

My reading: #2340 and #2341 are the same problem on two hosts (a comparing loop with no trigger). #2344 is the evidence
side of the same problem (what did the loop or the command actually do). It is also what makes #2341's loop safe to
repeat (section 4).

## 2. Liveness of scheduled jobs

### 2.1 What mature systems do

**Healthchecks.io** (open source, BSD-3-Clause, so self-hostable; its hosted free plan monitors 20 jobs). A check has
two settings: "Period is the expected time between pings", and "Grace Time is the additional time to wait before
sending an alert when a check is late". It can also read a cron expression, with a time zone and a grace time. A job may
send a `/start` ping first. If "a job sends a 'start' signal but does not send a 'success' signal within its configured
grace time", Healthchecks "will assume the job has failed. It will mark the job as 'down' and send out alerts." So the
start ping is what turns "died halfway" into an alarm, not silence. (Sources: its docs in
[configuring_checks.md](https://github.com/healthchecks/healthchecks/blob/c1039ad23395162c5e2f17d324d8ccdaa60a1d14/templates/docs/configuring_checks.md)
and
[measuring_script_run_time.md](https://github.com/healthchecks/healthchecks/blob/c1039ad23395162c5e2f17d324d8ccdaa60a1d14/templates/docs/measuring_script_run_time.md);
the license is in its `LICENSE` file and GitHub's license field; the free plan is on its
[pricing page](https://healthchecks.io/pricing/).) This is a "dead man's switch": an alarm that fires when the job
stops checking in, instead of when it reports a problem.

**Prometheus.** Its alerting practices page says, for batch jobs: "it makes sense to page if the batch job has not
succeeded recently enough, and this will cause user-visible problems. This should generally be at least enough time for 2
full runs of the batch job. For a job that runs every 4 hours and takes an hour, 10 hours would be a reasonable
threshold. If you cannot withstand a single run failing, run the job more frequently, as a single failure should not
require human intervention." For offline processing: "the key metric is how long data takes to get through the system".
Its instrumentation page: "The key metric of a batch job is the last time it succeeded."
([alerting.md](https://github.com/prometheus/docs/blob/a8a024746f7022f015a005c3fa58e64e08ac545a/docs/practices/alerting.md),
[instrumentation.md](https://github.com/prometheus/docs/blob/a8a024746f7022f015a005c3fa58e64e08ac545a/docs/practices/instrumentation.md).)
`absent()` and `absent_over_time()` exist for "alerting on when no time series exist for a given metric name and label
combination" (also "for a certain amount of time" for the second) ([functions.md](https://github.com/prometheus/prometheus/blob/1e794b83ad0d1df86c26fc607f87197734b9d9d9/docs/querying/functions.md)).
They detect that a signal is gone. They cannot tell a job that did not need to run from one that died.

**Who watches the watcher.** The kube-prometheus runbook for `Watchdog` says: "This is an alert meant to ensure that
the entire alerting pipeline is functional. This alert is always firing, therefore it should always be firing in
Alertmanager and always fire against a receiver." Something outside sends a notification "when this alert is not
firing", for example "the `DeadMansSnitch` integration in PagerDuty"
([Watchdog.md](https://github.com/prometheus-operator/runbooks/blob/a685d14cf5128bb30e2bf935c3983decd772d885/content/runbooks/general/Watchdog.md)).
Prometheus's practices page adds that "a blackbox test that alerts are getting from PushGateway to Prometheus to
Alertmanager to email is better than individual alerts on each". The textbook answer to "who watches the watcher" is a
party outside the thing watched.

**Google's SRE book.** The cron chapter says "Cron job owners can (and should!) monitor their cron jobs", by having the
cron service expose state "or set up independent monitoring of the effect of cron jobs". It prefers skipping a launch
to launching twice: "recovering from a skipped launch is more tenable than recovering from a double launch"
([Distributed Periodic Scheduling with Cron](https://sre.google/sre-book/distributed-periodic-scheduling/)). The
monitoring chapter says pages must be rare and real: "When pages occur too frequently, employees second-guess, skim,
or even ignore incoming alerts", "Every page should be actionable", "If a page merely merits a robotic response, it
shouldn't be a page", and the part that reaches a pager must be "very simple and robust"
([Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)). Our own sev skill
says the same about its checks: "A false alarm puts us in a sev1, so a check that cries wolf is itself a fix that goes
first" (`.agents/skills/sev/SKILL.md`).

### 2.2 What GitHub's schedule does

Documented:

- "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times
  include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped. To
  decrease the chance of delay, schedule your workflow to run at a different time of the hour."
  ([schedule-delay.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/data/reusables/actions/schedule-delay.md))
- "The shortest interval you can run scheduled workflows is once every 5 minutes"
  ([actions-scheduled-workflow-example.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/data/reusables/repositories/actions-scheduled-workflow-example.md)).
  A scheduled run uses the "Last commit on default branch" and "will only run on the default branch"
  ([events page, `schedule`](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md)).
- "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60
  days." ([scheduled-workflows-disabled.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/data/reusables/actions/scheduled-workflows-disabled.md))
  The REST API has a `state` on each workflow that can read `disabled_inactivity`
  ([OpenAPI, `workflow`](https://github.com/github/rest-api-description/blob/d560905bbf50d79e40d6a006ce2e5834cfd86a31/descriptions/api.github.com/api.github.com.json)).
  Not a risk here: every workflow in this repo reads `active` (measured, `gh api repos/kamp-us/tea-fabrika/actions/workflows`),
  and main took 630 commits in 13 days (from #2340).
- Who is told: the events page says "Notifications for scheduled workflows are sent to the user who last modified the
  cron syntax in the workflow file". The notifications page says they go "to the user who initially created the
  workflow", and to a later user who updates the cron
  ([notifications-for-workflow-runs.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/actions/concepts/workflows-and-actions/notifications-for-workflow-runs.md)).
  Either way it is one account's inbox, and it is not necessarily a person who reads it.

Measured: `gh api "repos/kamp-us/tea-fabrika/actions/workflows/scheduled.yaml/runs?event=schedule&per_page=100"` returns
34 runs (its `total_count` is 34), the first on 2026-11-15T06:28Z and the last on 2026-11-26T22:22Z. The cron is
`17 * * * *` (`.github/workflows/scheduled.yaml`), so about 280 starts were due. About 3 started each day. The longest
gap between two was 1,023 minutes (17 hours). The newest 100 runs of the same workflow are 41 `push`, 50
`workflow_dispatch` and 9 `schedule` runs (`gh api "repos/kamp-us/tea-fabrika/actions/workflows/scheduled.yaml/runs?per_page=100"`),
so its `push` trigger starts runs far more often than its cron. I do not know why the cron is so sparse; GitHub gives no
rate. The workflow already runs at minute 17, not at the top of the hour, and its header says a `push` or the catch-up
starts a run "so a break no diff reached shows within about an hour" (`.github/workflows/scheduled.yaml`); the
authors had met delayed schedules before.

My reading: a `schedule` alone can be hours late on this repo. A job whose silence must page someone needs a trigger
that does not depend on it. Main takes about 48 commits a day (630 in 13 days, from #2340), and each is a push.

### 2.3 Pausing on purpose

- Healthchecks: "Normally, when you ping a paused check, it leaves the paused state and goes into the 'up' state." An
  option, "Ignore the ping, stay in the paused state", makes the pause "sticky" until someone resumes it
  ([configuring_checks.md](https://github.com/healthchecks/healthchecks/blob/c1039ad23395162c5e2f17d324d8ccdaa60a1d14/templates/docs/configuring_checks.md),
  code in `hc/api/models.py`, `manual_resume`). A pause has no end date.
- Alertmanager: "Silences are a straightforward way to simply mute alerts for a given time"
  ([alertmanager.md](https://github.com/prometheus/alertmanager/blob/916c3717e181bd40808322371ef49d522d379d3f/docs/alertmanager.md)).
  In its API a silence must have `matchers`, `startsAt`, `endsAt`, `createdBy` and `comment`
  ([openapi.yaml](https://github.com/prometheus/alertmanager/blob/916c3717e181bd40808322371ef49d522d379d3f/api/v2/openapi.yaml)).
  So a silence always ends, says who made it, and says why.

My reading: the Alertmanager shape is the right one for us. A paused alarm that cannot end is the same silence
that caused #2340. A pause setting needs a date it ends, a reason, and an owner. When the date passes, the alarm turns
back on by itself.

### 2.4 The smallest right design for a GitHub-scheduled job

Parts, each tied to a source above (the combination is my reading):

1. **Say "late" in terms of work waiting, not beats missed.** `heartbeat.ts` does: a merge on main older than a limit
   with no passing run since. This is Prometheus's offline-processing rule ("how long data takes to get through the
   system"), and it means a quiet week raises no alarm: no merge, no run needed. A fixed-period ping would need the job
   to run in quiet weeks too. Keep it.
2. **Run the check on `push` to main as well as on `schedule`.** The check can only be late once a merge exists, and a
   merge is a push. Each push then reads the state fresh. Keep `schedule` as the backup for the quiet stretch after the
   last merge, and `workflow_dispatch` for a hand run. This does not depend on GitHub's cron staying hourly (section 2.2).
3. **The limit is a setting, and its default needs a decision.** `heartbeat.ts` sets `LATE` to 2 hours (line 34). Its
   header gives the reason: a merge waits up to 1 hour for the next dispatch, then the run takes up to 45 minutes. That
   is 1 h 45 min with every run passing and no slack for one failure. Measured, 31 of the 100 newest runs failed.
   Prometheus's rule is "at least enough time for 2 full runs", and a single failure "should not require human
   intervention". Applied here, 2 x (1 h + 45 min) = 3.5 hours. At 2 hours, one failed run pages.
4. **Page through something that reaches a person without depending on the schedule's owner.** Open or update one
   GitHub issue, name the owner in it, and close it when the check is green again. This is the pattern `scheduled.mjs`
   already uses (`.github/ci/scheduled.mjs`: it opens one issue, comments on it while it is red, closes it when green).
5. **Mind the label.** `scheduled.mjs` sets the label `ci-scheduled` (line 38), and the sev skill says "A sev1 is on by
   itself while one of two checks has its issue open", which its front matter says is "any open GitHub issue labeled
   `ci-scheduled`". A heartbeat issue with that label would put the lead into a sev1. Whether a dead mutation run is a
   sev1 is a call for the owner. A different label avoids deciding by accident.
6. **Pause with an end.** One setting holds an end time and a reason. While it is in the future the check prints
   "paused until T: reason" and exits green. After it, the check works as before. If a limit is wanted on how long a pause
   can be, it is a setting too.
7. **Who watches the watcher** is the open part. The textbook answer is a receiver outside GitHub (Healthchecks has a free
   hosted plan and a self-hostable BSD-3 server). `heartbeat.ts`'s header says that is "a paid or outside account, which
   AGENTS.md rules out"; I found no such rule in `AGENTS.md` or in `.kalfa/decisions/` (section 6). Without an outside
   party, the cheapest cross-check is for the check that runs on every push (`scheduled.yaml`'s gate) to read the
   heartbeat workflow's newest run time, the same way `gcloop.ts status` says LATE. That is more code for a second-order
   risk; I would do it second.

Not decided here: whether the mutation run itself restarts on a timer. That adds cost and, per #2340, changes an earlier
decision (I could not find that decision, section 6). If it does restart, the proven shape in this repo is
`scheduled.yaml`'s: start on `push` when none started in the last hour, plus an hourly catch-up, with a gate job. A bare
cron would run at about the rate measured in section 2.2.

## 3. Post-merge actions: events or a timer

### 3.1 The level-triggered argument, from its sources

The phrase comes from hardware: a level-triggered input reacts to the signal being high, an edge-triggered one to the
moment it changes. For controllers (programs that make the world match a wanted state):

- Kubernetes design principles: "Functionality must be *level-based*, meaning the system must operate correctly given
  the desired state and the current/observed state, regardless of how many intermediate state updates may have been
  missed. Edge-triggered behavior must be just an optimization." The same page adds: "There should be a CAP-like theorem
  regarding the tradeoffs between driving control loops via polling or events about simultaneously achieving high
  performance, reliability, and simplicity -- pick any 2."
  ([principles.md](https://github.com/kubernetes/design-proposals-archive/blob/270fc448cee9a841aed3c9a717affe428c8bb425/architecture/principles.md))
- The resource model page: "Controllers are level-based ... to maximize fault tolerance ... However, they can achieve
  the benefits of an edge-triggered implementation by monitoring changes to relevant resources via a notification-style
  watch API, which minimizes reaction latency and redundant work." It lists what goes wrong with "reliable" messaging:
  "bootstrapping consumers, events lost during bus outages, consumers not keeping up, bounding queue state, and
  delivery to unspecified numbers of consumers."
  ([resource-management.md](https://github.com/kubernetes/design-proposals-archive/blob/4372c6738f4bae163581fee0017f984e701a324d/architecture/resource-management.md))
- The controller-writing guide: the basic loop reads desired and current state and makes changes, and "Watches, etc,
  are all merely optimizations of this logic." Guideline: "Level driven, not edge driven. Just like having a shell script
  that isn't running all the time, your controller may be off for an indeterminate amount of time before running
  again. If an API object appears with a marker value of `true`, you can't count on having seen it turn from `false`
  to `true`, only that you now observe it being `true`." Also: "Informers can periodically 'resync'", and be sure that
  "your controller is also marking the information it last made the decision on in the object's status"
  ([controllers.md](https://github.com/kubernetes/community/blob/a71d92c08bb81544228ee3cb2aa5a676e6d36b21/contributors/devel/sig-api-machinery/controllers.md)).
- Controller-runtime's own code comment: "Reconciliation is level-based, meaning action isn't driven off changes in
  individual Events, but instead is driven by actual cluster state read from the apiserver or a local cache." The request
  "does NOT contain information about any specific Event", and the work queue "de-duplicates identical requests"
  ([reconcile.go](https://github.com/kubernetes-sigs/controller-runtime/blob/1c75cb0185ee6eb2e5571b14fd5724acee5c34d6/pkg/reconcile/reconcile.go)).

The guideline about marking the last decision matters for us. A loop that only sees "ticket open and its pull request
merged" will close a ticket someone reopened on purpose. Kubernetes' answer is to record what the controller last
decided, and not act on it again.

### 3.2 What GitHub offers

- A workflow can run when a pull request merges: "When a pull request merges, the pull request is automatically closed.
  To run a workflow when a pull request merges, use the `pull_request` `closed` event type along with a conditional that
  checks the `merged` value of the event." It runs in GitHub's cloud, so it cannot call our local tracker.
  ([events page](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md))
- A workflow on `merge_group` supports one activity: "only the `checks_requested` activity type is supported" (same
  page). So Actions has no "this merge group merged" trigger. The webhook has one: `merge_group` with action `destroyed`
  and a `reason` of `dequeued`, `invalidated` or `merged`
  ([octokit/webhooks schema](https://github.com/octokit/webhooks/blob/aa80c24a3f55354465b8b1438d33dd5602956d0d/payload-schemas/api.github.com/merge_group/destroyed.schema.json)).
  A webhook needs a receiver.
- Webhooks fail quietly. "GitHub does not automatically redeliver failed deliveries." A delivery fails if the server
  "takes longer than 10 seconds to respond". You may redeliver deliveries "from the past 3 days" (`retention` is 3 on
  GitHub.com). GitHub's own advice for recovery is a polling script: "Your script should run on a schedule" and list
  deliveries since its last run, find failures and redeliver them
  ([handling-failed-webhook-deliveries.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/webhooks/using-webhooks/handling-failed-webhook-deliveries.md),
  [redelivering-webhooks.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks.md),
  [webhooks.yml](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/data/variables/webhooks.yml)).
  So GitHub's own documented way to use events is an event plus a scheduled catch-up.
- A laptop is not a receiver. GitHub's docs offer a proxy for local work and say it "is intended for development and
  testing only" ([testing-webhooks.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/webhooks/testing-and-troubleshooting-webhooks/testing-webhooks.md)).
  Apple's docs say jobs that `launchd` runs on an interval (other than `StartCalendarInterval`) "are skipped when the
  computer is turned off or asleep" ([Scheduled Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)).
  My reading: a sleeping laptop would miss an event, and GitHub would not resend it.
- The events feed is for polling, not for a record: "up to 300 events", and "Only events created within the past 30 days
  will be included" ([events.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/rest/activity/events.md)).
  Repeat: `gh api "repos/kamp-us/tea-fabrika/events?per_page=100"`.
- GitHub's own "close a ticket when a pull request merges" is done on its servers and needs the ticket to be a GitHub
  issue: "When you merge a linked pull request into the default branch of a repository, its linked issue is
  automatically closed", through keywords in the description or a commit message
  ([linking-a-pull-request-to-an-issue.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue.md)).
  Our `fabrika close ticket N` line copies this idea for a tracker GitHub cannot see, so something of ours has to be the
  server that reads it.

### 3.3 The shape for a local tracker

My reading, from the sources above:

- **The level loop is required, the event is optional.** The tracker is local, so every route to it ends on the laptop.
  Events cannot be counted on to arrive there (sleep, no retry). The loop does not care whether it missed anything.
- **Both, as `gcloop.ts` already does for box cleanup.** Keep `land.ts merged <pr>` as the fast path (the edge as an
  optimization, in Kubernetes' words). Add the same call to the `gcloop` tick as the level path. Do not build a GitHub
  workflow for this: it could only do GitHub-side work.
- **Read desired state in one call, not one per pull request.** Merge commits on main carry the text: the squash commit
  is made from the pull request's title and description (`Queue.ts` header). Measured: 44 lines with
  `fabrika close ticket` appear in the messages of the newest 150 commits of main
  (`git log origin/main -150 --format=%B | grep -ci "fabrika close ticket"`). A window of 7 days is about 340 merges at
  the rate in #2340, so a `gh pr view` per pull request each tick is hundreds of calls. One list call, or one
  `git log`, and one tracker list, then act only on the tickets in both lists.
- **Record the decision.** When the loop closes a ticket it already leaves a comment ("Closed by the merge of
  .../pull/N", `closeNote`). But the tracker contract (`.agents/skills/lead/scripts/pr/Tickets.ts`) has only `open`,
  `comment` and `close`: no read of a ticket's comments or history. So the mark a later tick checks has to be a line in
  the local log of section 4 (for example "settled pull request N, ticket T"), unless the tracker's command gains a read.
  With the mark, a ticket reopened on purpose stays open. This is the Kubernetes guideline of marking "the information
  it last made the decision on" (section 3.1).
- **The window must outlast the longest time the loop can be down.** If the laptop is off longer than the window, a
  merge falls out of reach. A high-water mark (the newest merge commit handled) removes the window; it needs one more
  stored value.
- **The loop needs the same LATE status as `gcloop.ts`.** A loop that stops is the #2340 failure again.

## 4. Durable long waits from a laptop

### 4.1 How workflow engines do it

- **Temporal.** "Temporal records each step of a Workflow Execution in its Event History: Activities scheduled and their
  results, Timers started and fired, and messages received. If the Worker running a Workflow Execution stops, another
  Worker replays the Event History to rebuild the Workflow's state ... and continues from the point where execution
  stopped. Steps that already completed don't run again."
  ([durable-execution.mdx](https://github.com/temporalio/documentation/blob/3fc1d2fa21889f0ceb70018b4353f5678e0de8d6/docs/encyclopedia/durable-execution.mdx))
  The Event History is "a complete and durable log of everything that has happened in the lifecycle of a Workflow
  Execution" ([event-history.mdx](https://github.com/temporalio/documentation/blob/3fc1d2fa21889f0ceb70018b4353f5678e0de8d6/docs/encyclopedia/event-history/event-history.mdx)).
  The caveat that matters for us: "Activities won't record to the Event History until they return or produce an error.
  If an Activity fails to report to the server at all, it will be retried"
  ([activity-definition.mdx](https://github.com/temporalio/documentation/blob/3fc1d2fa21889f0ceb70018b4353f5678e0de8d6/docs/encyclopedia/activities/activity-definition.mdx)).
  A step that dies halfway leaves no result, so the engine runs it again.
- **AWS Step Functions.** A Standard workflow may run "up to one year" and "follow[s] an exactly-once model" for its
  states, unless a Retry is set. A task with `.waitForTaskToken` pauses "until it receives that task token back with a
  `SendTaskSuccess` or `SendTaskFailure` call". Without a bound it "will wait until the execution reaches the one year
  service quota", so "to avoid stuck executions you can configure a heartbeat timeout" (`HeartbeatSeconds`). Starting an
  execution "with the same name as a currently-running workflow" "automatically returns an idempotent response"
  ([choosing-workflow-type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html),
  [connect-to-resource](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)).
- **GitHub's merge queue.** After `gh pr merge`, the wait is GitHub's: "GitHub will merge all these changes into the
  `base_branch` once the checks required by the branch protections of `base_branch` pass"
  ([managing-a-merge-queue.md](https://github.com/github/docs/blob/df6faa250dc425fa137d270c967e6a74f12103a7/content/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue.md)).
  `land.ts queue` uses it that way (`--squash --match-head-commit <head>`, `land.ts` line 40; the merge is pinned to the
  head that was read). The durable wait already exists. What is missing is a durable "then".

My reading: the common move is to take the wait out of any process that can die. The engine keeps a log of what
happened and a stateless worker re-derives where it was. Two things make that safe: steps that can run twice, and a
heartbeat so a stuck wait is noticed.

### 4.2 At-least-once and idempotency keys

- Amazon SQS: "you might get that message copy again ... Design your applications to be *idempotent* (they should not
  be affected adversely when processing the same message more than once)"
  ([at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)).
- Temporal: "Because Activities may be retried, these functions may be executed more than once." Idempotent means
  "performing an operation multiple times has the same result as performing it once", and "You can use a combination of
  the Workflow Run ID and the Activity ID as an idempotency key since this is guaranteed to be consistent across retry
  attempts but unique among Workflow Executions" (`activity-definition.mdx`, Idempotency section).
- Stripe (API v1): it "saves the status code and body of the first request made with a given idempotency key", retries
  with the same key "return the saved response", keys can be removed "after they're at least 24 hours old", and it
  "errors if they're not the same" when the parameters differ from the first request
  ([Idempotent requests](https://docs.stripe.com/api/idempotent_requests)).
- The IETF draft for an `Idempotency-Key` header (revision 09, 21 November 2026, still a draft): "An idempotency key is a
  unique value generated by the client which the resource uses to recognize subsequent retries of the same request." It
  "MUST NOT be reused with another request with a different request payload", and the server "SHOULD reply with an HTTP
  422" on a mismatch ([draft-ietf-httpapi-idempotency-key-header-09](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-09.txt)).
- Google's cron chapter: "Some cron jobs, such as garbage collection processes, are idempotent. In case of system
  malfunction, it is safe to launch such jobs multiple times." It keeps launch records so recovery can finish work: "We
  synchronously inform a quorum of replicas of the beginning and end of each scheduled launch", and "We keep track of
  all open launches (launches that have begun but not completed)". An open launch with no end is the signal that
  something died. ([cron chapter](https://sre.google/sre-book/distributed-periodic-scheduling/))

My reading: the key can be natural. For closing a ticket the key is the ticket's own state (open or not), plus the
decision record from section 3.3. For a landing command, `land.ts` already pins the merge to a head SHA with
`--match-head-commit`. A key of (pull request, head SHA, step) fits the Stripe and IETF rule: the same key with different input is a
new attempt, not a repeat.

### 4.3 The cheapest version, without an engine

Four parts, each one a small copy of the engine feature above. This is my reading.

| Engine feature | Cheap copy here |
|---|---|
| Event History | one append-only line file per pull request, `runs/land/<pr>.jsonl`, local to the laptop (what #2344 proposes; `runs/` already holds live run state) |
| Worker replays history | a command that reads the file and GitHub, works out where things stand, and does the next safe thing |
| Timer or callback | the `gcloop.ts` tick (30 minutes), not a held shell |
| Heartbeat timeout | a "still waiting" line every few minutes, and a reader that says LATE when it is stale |

The command after the wait has to be safe to repeat: close a ticket only if it is open and its decision is not already
recorded; merge only with `--match-head-commit`. Then at-least-once is enough, and nobody has to wait.

What can end a command, and whether its cleanup code runs (this decides what the log can promise):

| What ends it | Does cleanup code run | What a later reader sees |
|---|---|---|
| Normal end, or an error such as a network failure | Yes (my reading; ordinary program flow) | a start line and an end line that says how it ended |
| `SIGINT` or `SIGTERM` | Yes. The installed Effect 4.1.3 `runMain` "interrupting the fiber on `SIGINT` or `SIGTERM`" | an end line that says "interrupted", if the program writes one on interrupt |
| `SIGHUP` (a closed terminal) | No. `runMain` listens to `SIGINT` and `SIGTERM` only. Node: "the default behavior of `SIGHUP` is to terminate Node.js, but once a listener has been installed its default behavior will be removed" | a start line, no end line |
| `SIGKILL` | No. Node: "`SIGKILL` cannot have a listener installed, it will unconditionally terminate Node.js on all platforms" | a start line, no end line |
| Power loss or a crash | No | a start line, no end line, maybe a torn last line |
| Laptop asleep | Process is paused (no source; my reading); a `launchd` interval job is "skipped" | no new line until wake |

So `Effect.ensuring` (what #2344 proposes) writes the end line on the first two rows and not on the rest. Because the
rest cannot be caught, the file has to carry the proof: write a **start line first** (with the process id), and let a
later reader treat "last line is a start or a progress line, and the process is gone" as "died". Node documents how to
test for a process: `0` "can be sent to test for the existence of a process" (`process.kill(pid, 0)`;
[process.md](https://github.com/nodejs/node/blob/eaf46fc7a9949a37950bd3d37089148054a00804/doc/api/process.md)). This is
the Healthchecks `/start` rule, Google's "open launches" and Temporal's "fails to report at all" in one line each. A
long wait should add a "still waiting" line now and then, as Step Functions' `HeartbeatSeconds` does, and log changes
rather than every poll (Temporal's history records "Timers started and fired", not each tick).

On the file itself: POSIX says that with `O_APPEND` "the file offset shall be set to the end of the file prior to each
write and no intervening file modification operation shall occur between changing the file offset and the write
operation" ([write()](https://pubs.opengroup.org/onlinepubs/9799919799/functions/write.html)), so two commands appending
at once do not overwrite each other. It does not say a power cut leaves a whole line. My reading: the reader must skip a
torn last line, and one line should be one `write`. `gcloop.ts` already appends one line per sweep to `gc.jsonl` with
`{ flag: "a" }` (line 454).

## 5. Recommendations

I would not build an engine. Every part is a small copy of one the sources already use. One rule is shared: compare
state on a timer, make the action safe to repeat, record start and end, and let something say LATE. `gcloop.ts` is the
existing example. A shared helper for "append a line, read the last line, say LATE" would serve the three, but I am less
sure of that (60%) than of sharing the rule (90%).

### #2340: the mutation run's alarm

- **Fix.** Build the workflow `heartbeat.ts` names. Trigger it on `push` to main, `schedule` and `workflow_dispatch`.
  Run `heartbeat.ts`. On late, open or update one issue that names the owner, and close it when green. Put the limit and
  the pause (an end time, a reason) in one setting. A test covers late, on time, paused and pause expired.
- **Why.** Prometheus and Healthchecks both alarm on "not succeeded recently enough"; `heartbeat.ts` already does that from
  state. The push trigger is there because the measured cron fires about 3 times a day.
- **Size.** 3 or 4 files (the workflow, `heartbeat.ts`, its test, the setting), about 100 lines, 1 to 2 agent hours.
  More than the ticket's "1 file, about 25 lines": the pause, the issue and the push trigger are not in it.
- **What we give up.** Detection can take hours when no merge lands after the limit (nothing is waiting, so nothing
  is hurt). No outside watcher of the watcher in the first version. The pause needs a human to set an end date.
- **Confidence.** 90% on the facts. 80% on the shape (state compare, push plus schedule, a pause with an end). 60% on the
  default limit: 2 hours pages on one failed run, 3.5 hours does not. 75% on a label other than `ci-scheduled`.
- **What would change it.** The owner wants the run to restart itself: then the host is a gate like `scheduled.yaml`'s
  and the heartbeat watches that. The owner accepts an outside account: then a Healthchecks check is the stronger
  watcher of the watcher. GitHub's schedule behaves better than measured.

### #2341: tickets left open after a merge

- **Fix.** The ticket's plan is right: a `gcloop.ts` tick runs the close step over recently merged pull requests, and the
  hand step stays. Tighten it three ways: read merged pull requests (or main's log) in one call and the tracker's open
  list in one call; skip a ticket whose close decision is already recorded in the local log (the tracker contract cannot
  be asked), so a deliberate reopen holds; give the tick a LATE status. Rename `--wait` to `--wait-ci`.
- **Why.** Level over edge (Kubernetes); GitHub's own advice for webhooks is a scheduled catch-up; the tracker is local.
  `--wait-ci` because the durable wait is GitHub's, and a longer-held shell is exactly the #2344 failure.
- **Size.** 2 or 3 files, about 60 lines and a test. The ticket said 2 files and about 40 lines; the reopen guard and
  the status are the rest.
- **What we give up.** A ticket can stay open up to one tick (30 minutes) after a merge, longer while the laptop sleeps
  (a `StartInterval` job is skipped asleep, per Apple). Today's `gcloop.ts` header says `launchd` "runs a missed
  interval once on wake"; Apple's page says that is true of `StartCalendarInterval` only, and `gc.plist` uses
  `StartInterval` (line 30). A loop that does not mind a missed tick is what makes this safe.
- **Confidence.** 85% on the shape. 70% on `--wait-ci` over "wait until merged" (the other keeps one command per landing).
  75% that a reopen guard is needed: the 19 open tickets may include on-purpose reopens (the ticket says "a few"), and
  nobody has counted them.
- **What would change it.** Tickets move to GitHub issues (then `Closes #N` does it on GitHub's side). The tracker moves
  to a host that can receive webhooks. The laptop is often off for longer than the window.

### #2344: background commands that die without a record

- **Fix.** The ticket's file is right: `runs/land/<pr>.jsonl`, one JSON line per event. Add to its plan: write a start
  line first (with the process id); log changes and a "still waiting" line every few minutes, not every poll; write the
  end line from the program's exit result (ok, refused, failed, interrupted); handle `SIGHUP` too if the harness can
  send it; and let the lead skill's "read this file first" rule say what a start with no end and no live process means.
- **Why.** `Effect.ensuring` runs on `SIGINT` and `SIGTERM` and not on `SIGHUP`, `SIGKILL` or power loss (section 4.3), so
  the start line is what carries the proof. Google, Temporal and Healthchecks all use "begun but not finished" as the
  signal.
- **Size.** 1 file, about 40 lines and a test (the ticket said 30).
- **What we give up.** It records; it does not resume. Resume is a re-run of a command that is safe to repeat. A log nobody
  reads helps nobody, so the lead skill rule is part of the fix.
- **Confidence.** 85%.
- **What would change it.** These commands move into a box or CI (the platform keeps logs). A wait grows long enough to
  need real durable waiting; only then is an engine worth weighing.

| Ticket | Fix in one line | Size | Confidence |
|---|---|---|---|
| #2340 | heartbeat workflow on push plus schedule, one issue, a pause with an end | 3-4 files, ~100 lines | 80% |
| #2341 | `gcloop` tick closes tickets for merged pull requests, with a decision record; `--wait-ci` | 2-3 files, ~60 lines | 85% |
| #2344 | per-pull-request jsonl, start line first, end line from the exit result | 1 file, ~40 lines | 85% |

## 6. What this cannot tell us

- **Why our cron fires about 3 times a day.** GitHub documents delay and drops, not a rate. I measured 34 runs of one
  workflow over 11.7 days. A longer window, or another workflow's count, could differ. I did not check whether the
  cron expression changed in that window.
- **Whether `pull_request: closed` fires for a merge made by the queue.** The repo's events feed shows merges as
  `PullRequestEvent` entries with action `merged`, but no workflow here listens to it, I did not check whether those
  merges went through the queue, and I did not run a probe. This does not change the
  recommendations, since the event cannot reach the tracker.
- **Who gets a failed-schedule email.** The events page says the user who last modified the cron; the notifications page
  says the one who created the workflow. I did not check which account that is here, or whether anyone reads it.
- **Whether the tracker app could offer a read of a ticket's comments or history.** `pr/Tickets.ts` has only `open`,
  `comment` and `close`. I did not read the app's own command to see whether a read exists or would be cheap to add.
  If it did, the reopen guard could live in the tracker instead of the local log.
- **Which limit the owner wants.** 2 hours or 3.5 hours is a cost call (how many false pages versus how late).
  Prometheus gives a rule, not our number.
- **Whether a dead mutation run should be a sev1.** The label decides it. That is a call for the owner.
- **Two claims in our own files I could not find a source for.** `heartbeat.ts`'s header says an outside dead-man switch
  is something "AGENTS.md rules out"; I found no such rule in `AGENTS.md` or `.kalfa/decisions/` (a search of the
  records for "paid service", "external monitoring" and "outside service" found none). And `heartbeat.ts` cites "0067"
  for the dispatch-only rule, and #2340 says a cron would change decision 0067, while `.kalfa/decisions/0067-*` is about
  how agents talk, and no decision file mentions mutation.
- **How the harness ends a background shell.** I do not know which signal reaches a `land.ts` command when a session
  ends or the shell is killed. That decides whether `SIGHUP` handling is needed.
- **Whether a laptop's sleep breaks an in-flight `gh` call.** No source found. Apple's page covers scheduled jobs, not a
  running process.
- **Anything about running these systems.** I did not run Healthchecks, Prometheus, Temporal or Step Functions. Every
  behavior is from docs and code. The Kubernetes sources are for the principle, at a very different scale from a laptop.
- **Whether sharing a code helper across the three pays.** That is a judgment (60%). A first version can share only the
  rule, and extract a helper when a second file needs the same lines.

## Sources

Read on 2026-11-26. Pinned links point at the head commit of each repository at the end of the read. I read most files
from the default branch a few minutes before I took that commit, and I did not diff the two, so a word may differ if a
page changed in between.

GitHub
- GitHub Docs repository (`github/docs`), commit `df6faa250dc425fa137d270c967e6a74f12103a7`: the pages named in section 2.2
  and 3.2, under `content/` and `data/`. https://github.com/github/docs/tree/df6faa250dc425fa137d270c967e6a74f12103a7
- GitHub REST description (`github/rest-api-description`), commit `d560905bbf50d79e40d6a006ce2e5834cfd86a31`:
  the `workflow` schema, `state` enum. https://github.com/github/rest-api-description/tree/d560905bbf50d79e40d6a006ce2e5834cfd86a31
- Octokit webhooks payload schemas (`octokit/webhooks`), commit `aa80c24a3f55354465b8b1438d33dd5602956d0d`:
  `payload-schemas/api.github.com/merge_group/destroyed.schema.json`.
- Measured with `gh api` on 2026-11-26: workflow runs of `scheduled.yaml` (`event=schedule`) and `mutation.yaml`, the
  workflows list, the repo events feed, `git log origin/main` at `fdfb7d468`.

Monitoring
- Healthchecks (`healthchecks/healthchecks`), commit `c1039ad23395162c5e2f17d324d8ccdaa60a1d14`: `templates/docs/configuring_checks.md`,
  `templates/docs/measuring_script_run_time.md`, `hc/api/models.py`, `LICENSE`. Pricing: https://healthchecks.io/pricing/
- Prometheus docs, commit `a8a024746f7022f015a005c3fa58e64e08ac545a`: `docs/practices/alerting.md`, `docs/practices/instrumentation.md`.
  Prometheus, commit `1e794b83ad0d1df86c26fc607f87197734b9d9d9`: `docs/querying/functions.md`.
  Alertmanager, commit `916c3717e181bd40808322371ef49d522d379d3f`: `docs/alertmanager.md`, `api/v2/openapi.yaml`.
- kube-prometheus runbooks (`prometheus-operator/runbooks`), commit `a685d14cf5128bb30e2bf935c3983decd772d885`:
  `content/runbooks/general/Watchdog.md`.
- Google SRE book: https://sre.google/sre-book/distributed-periodic-scheduling/ and
  https://sre.google/sre-book/monitoring-distributed-systems/

Kubernetes
- `kubernetes/design-proposals-archive`, commit `270fc448cee9a841aed3c9a717affe428c8bb425` (`architecture/principles.md`) and
  commit `4372c6738f4bae163581fee0017f984e701a324d` (`architecture/resource-management.md`).
- `kubernetes/community`, commit `a71d92c08bb81544228ee3cb2aa5a676e6d36b21`: `contributors/devel/sig-api-machinery/controllers.md`.
- `kubernetes-sigs/controller-runtime`, commit `1c75cb0185ee6eb2e5571b14fd5724acee5c34d6`: `pkg/reconcile/reconcile.go`.

Workflow engines and idempotency
- Temporal docs (`temporalio/documentation`), commit `3fc1d2fa21889f0ceb70018b4353f5678e0de8d6`: `docs/encyclopedia/durable-execution.mdx`,
  `docs/encyclopedia/event-history/event-history.mdx`, `docs/encyclopedia/activities/activity-definition.mdx`.
- AWS Step Functions: https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html and
  https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html
- Amazon SQS: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html
- Stripe: https://docs.stripe.com/api/idempotent_requests
- IETF `draft-ietf-httpapi-idempotency-key-header-09`: https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-09.txt

Processes, files, schedulers
- Node.js, commit `eaf46fc7a9949a37950bd3d37089148054a00804`: `doc/api/process.md` (signal events).
- POSIX `write()`, Issue 8 (IEEE Std 1003.1-2024): https://pubs.opengroup.org/onlinepubs/9799919799/functions/write.html
- Apple, Scheduling Timed Jobs: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html
- Effect 4.1.3, the copy installed in this repo: `@effect/platform-node-shared`, `src/NodeRuntime.ts` (`runMain`:
  `process.on("SIGINT", ...)` and `process.on("SIGTERM", ...)`).

This repo, at `origin/main` commit `fdfb7d468`
- `.agents/skills/mutation/scripts/heartbeat.ts`, `.agents/skills/mutation/SKILL.md`, `.github/workflows/mutation.yaml`,
  `.github/workflows/scheduled.yaml`, `.github/ci/scheduled.mjs`, `.agents/skills/sev/SKILL.md`.
- `.agents/skills/lead/scripts/land.ts`, `.agents/skills/lead/scripts/pr/Queue.ts`, `.agents/skills/lead/scripts/pr/Tickets.ts`,
  `.agents/skills/lead/scripts/gcloop.ts`, `.agents/skills/lead/gc.plist`.

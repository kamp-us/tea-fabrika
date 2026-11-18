
Plancheck-Version: 3

# Sev runbooks, sev fixes admin-merged in both levels, and a runner reserve while a sev is open, in today's lead tooling and CI (slice 2, priority classes and preemption, is a @kalfa/ci plan)

```text
the owner calls a sev0, or a ci-scheduled issue opens (sev1)
  -> the lead is the incident commander and opens the one runbook for what happened (.runbooks/sev-*.md)
  -> sev.ts sets SEV_PR_SLOTS=3: normal pull request test legs share 3 slot groups,
     a pull request labeled `sev` skips them, so the fix gets the free runners
  -> each fix: current main merged in, review passed, ci-required green, leak grep clean
     -> land.ts merge <pr> --admin, one fix at a time, in both levels
  -> close (sev0) or the issue closing (sev1): sev.ts clears SEV_PR_SLOTS; normal days have no cap
later, in @kalfa/ci: the one CI protocol gives each run a priority class and preempts lower ones;
  GitHub Actions is its Layer at @kalfa/ci/github, and sev.ts, land.ts and next/'s Ci.ts are clients
```

Version: today's lead tooling (`.agents/skills/sev/`, `.agents/skills/lead/scripts/`), today's CI
(check.yaml and its scripts), and `.runbooks/`. Slice 2 is a new package, `@kalfa/ci`, and gets
its own plan and ticket (the owner's ruling of 2026-11-18; its ADR comes in a separate pull request,
number to come). Lead tooling takes the fast track
([lead skill](../../../.agents/skills/lead/SKILL.md#lead-tooling-is-fast-tracked)); the lead asked
for a plan because the change moves rules.

## Doubt at the top

- **The real runner limit is not 20.** GitHub's limits page gives the Free plan 20 concurrent jobs,
  and the organization API says `plan: free`. But 3,865 job runs from 2026-11-17 22:00Z to
  2026-11-18 22:00Z (read by this plan, below) had up to 34 jobs running at once by their
  `started_at` and `completed_at`, and 139 of 1,440 minutes at 20 or more. Either a public
  repository gets more than the table says, or GitHub's job times count a wait. That is a guess;
  nothing here proves which. The `SEV_PR_SLOTS` number below is sized on the documented 20, the
  floor, so it is safe if the guess is wrong and only too tight if it is right. A finding row
  records it.
- **Clearing the reserve when a sev1 issue closes is done by our tooling, not by CI.** The report
  job that closes the issue runs with `GITHUB_TOKEN`, which has no variables scope (quoted below),
  and [0595](../../../.decisions/0595-scheduled-runs-share-slots.md) and 0598 rule out a new token
  grant. So `sev.ts` reconciles the variable each time it runs, and a stale value only slows normal
  pull requests until the next `sev.ts` call. That is the one owner question.

## Records

What was read, on `origin/main` at d524d4e69 (`kalfa/` at d2968b0e2), so a reader can check each claim.

- Decisions: [0532](../../../.decisions/0532-a-sev0-freezes-ci.md),
  [0542](../../../.decisions/0542-two-sev-levels-one-skill.md),
  [0544](../../../.decisions/0544-every-reviewed-pull-request-is-armed.md),
  [0571](../../../.decisions/0571-runbooks-live-in-top-level-runbooks.md),
  [0595](../../../.decisions/0595-scheduled-runs-share-slots.md),
  [0598](../../../.decisions/0598-merge-line-leaves-scheduled-groups.md),
  [0602](../../../.decisions/0602-integration-laws-leave-merge-line.md),
  [0603](../../../.decisions/0603-no-stacks-and-sev0-admin-merges.md),
  [0605](../../../.decisions/0605-no-record-patches-another.md),
  [0606](../../../.decisions/0606-a-record-is-accepted-or-superseded.md),
  [0609](../../../.decisions/0609-laws-wait-on-events-never-on-a-fixed-time-bound.md),
  [0069](../../../.decisions/0069-choices-are-settings.md),
  [0231](../../../.decisions/0231-ledger-and-codehost-are-separate.md),
  [0408](../../../.decisions/0408-skills-keep-only-judgment.md).
- Field notes: `field/notes/2026-11-14-ci-sev0-froze-ci-and-ended-as-a-sev1.json`,
  `field/notes/2026-11-14-ci-sev1-three-reds-the-schedule-alone-could-see.json`,
  `field/notes/2026-11-15-ci-sev1-the-workspace-program-broke-the-saved-home-law.json`,
  `field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json`.
- The sev skill's history: pull requests 1257, 1320, 1383, 1404, 1422, 1495, 1597, 1621, 1625
  (`git log -- .agents/skills/sev/SKILL.md`).
- Code: `.agents/skills/sev/scripts/` (sev.ts, Freeze.ts, Incident.ts, Level.ts,
  WorkflowRuns.ts and its Gh and Test layers), `.agents/skills/lead/scripts/land.ts` and
  `pr/Merge.ts`, `.github/workflows/check.yaml`, `scheduled.yaml`,
  `.github/ci/proof.ts`, the workflow-lint rules, `next/packages/libfabrika/src/ci/Ci.ts`.
- The one runbook today: `.runbooks/refresh-native-stack-metadata.md`.
- `records.ts find "sev runbook incident commander"` found 0571 and the glossary's `runbook` row,
  and nothing that already decides runbooks per sev situation, a runner reserve or run priority.

## How others do it

### Incident response

| Source | What it says, short quotes | What we take |
|---|---|---|
| [Google SRE book, ch. 14, Managing Incidents](https://sre.google/sre-book/managing-incidents/) | Roles: incident command, operations, communication, planning. "The incident commander holds the high-level state about the incident." "The operations team should be the only group modifying the system during an incident." Declare early: "It is better to declare an incident early." Prioritize: "Stop the bleeding, restore service, and preserve the evidence for root-causing." Prepare: "Develop and document your incident management procedures in advance". Handoff "until receiving firm acknowledgment of handoff." | The lead is the incident commander; one owner per fix modifies; the procedures are written down before the next sev, as runbooks |
| [Google SRE book, ch. 13, Emergency Response](https://sre.google/sre-book/emergency-response/) | "First of all, don't panic!" "If you feel overwhelmed, pull in more people." Change-induced emergencies: "sometimes configuration changes don't go entirely according to plan." "Keep a History of Outages": "There is no better way to learn than to document what has broken in the past." | Every runbook names the day it ran for real; every sev ends with a field note (0542) |
| [SRE Workbook, ch. 9, Incident Response](https://sre.google/workbook/incident-response/) | The 3Cs: "Coordinate response effort", "Communicate...", "Maintain control over the incident response." "the IC leads the incident response, and the CL and OL report to the IC." "Declare incidents early and often." "first responders must prioritize mitigation above all else." "Regularly review and iterate on your incident management plans and playbooks." | Mitigation first: land the fix, then the root cause ticket. Runbooks are revised after each sev |
| [SRE Workbook, ch. 8, On-Call](https://sre.google/workbook/on-call/) (cited by 0571) | "Playbooks contain high-level instructions on how to respond to automated alerts" | One runbook per trigger, the industry's runbook form |
| [PagerDuty, During an Incident](https://docs.pagerduty.com/ops-guides/incident-response-guide/during-an-incident) (response.pagerduty.com redirects here) | The IC should "Announce on the call and in Slack that you are the incident commander"; size-up: "Identify if there is an obvious cause to the incident"; status "roughly every 30mins"; ends once it "has recovered or is actively recovering"; then the after-incident steps | Trigger, roles, steps, exit and comms as fixed parts of each runbook. Our comms stay at three lines to the owner (open, each red fix, close), the owner's standing rule, not every 30 minutes |
| [PagerDuty, Severity Levels](https://docs.pagerduty.com/ops-guides/incident-response-guide/severity-levels) | "During an incident is not the time to discuss or litigate severities, just assume the highest and review during a postmortem." | Kept as the skill's judgment line |
| [Atlassian, incident response handbook](https://www.atlassian.com/incident-management/handbook/incident-response) | ten steps, "detect, raise, open comms, assess, send initial comms, escalate, delegate, send follow-up comms, review, resolve", "driven by an incident manager". "Each step below is its own section; together they're the playbook our incident managers follow." "it's very important to be clear who's in charge". On resolve: final comms "clearly state that the incident is resolved". | The steps section of each runbook follows that order where it fits: detect, open, assess, delegate, land, review, resolve |

### Run priority and reserved capacity

| Source | What it says | What we take |
|---|---|---|
| [GitHub, Actions limits](https://docs.github.com/en/actions/reference/limits) | Standard hosted runners, total concurrent jobs: Free 20, Pro 40, Team 60, Enterprise 500. The page does not mention job priority | 20 is the floor `SEV_PR_SLOTS` is sized on |
| [GitHub, control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) | "there can be at most one running job or workflow in a concurrency group at any time." `queue: max`: "Up to 100 jobs or workflow runs can be `pending` in the concurrency group." Waiting jobs are "processed in first-in-first-out (FIFO) order". "To also cancel any currently running job or workflow in the same concurrency group, specify `cancel-in-progress: true`." No priority | Confirmed: **GitHub Actions has no job priority**, as 0598 found. A slot group is a lock; N groups cap a job kind at N at once |
| [GitHub, contexts, context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) | "`jobs.<job_id>.concurrency` \| `github, needs, strategy, matrix, inputs, vars` \| None" | A job's concurrency may read `vars` and `needs`, so `check.yaml` can read the reserve |
| [GitHub, workflow syntax, permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) | The `GITHUB_TOKEN` scopes run from `actions` to `vulnerability-alerts`; none is for variables | A workflow cannot set or clear the reserve with its own token |
| [Kubernetes, Pod Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/) | "A PriorityClass is a non-namespaced object that defines a mapping from a priority class name to the integer value of the priority." "the scheduler orders pending Pods by their priority". "If a Pod cannot be scheduled, the scheduler tries to preempt (evict) lower priority Pods". "Pods with `preemptionPolicy: Never` will be placed in the scheduling queue ahead of lower-priority pods, but they cannot preempt other pods." | Slice 2's model: three classes, admission by class, preemption of the newest lower-class run |
| [Buildkite, managing priorities](https://buildkite.com/docs/pipelines/configure/workflows/managing-priorities) | "Job `priority` is 0 by default"; "higher-priority runnable jobs are assigned before lower-priority runnable jobs" in the same queue; on hosted agents priority is best effort | The same: a class per run, admitted in class order; priority needs our own admission, since hosted runners do not honor it |

Slice 1 takes the cheap known step: capacity held back for a class while a sev is open, the
GitHub-native way (slot groups, as 0598 already uses). Slice 2 takes the full known way, Kubernetes'
classes and preemption, as pure domain code in `@kalfa/ci`, the one CI protocol, with GitHub Actions
as one Layer behind it, the way `CodeHost` puts GitHub behind a service
([0231](../../../.decisions/0231-ledger-and-codehost-are-separate.md)), so GitHub's lack of priority
stops shaping the design.

## The shape

### Part 1: the sev skill keeps judgment and the level table; each situation is one runbook

The skill keeps: the level table, "when unsure which level", the many-agents judgment, the
write-up's fields, and a list that maps each trigger to its runbook. Every step list moves to a
runbook. Every rule that code checks leaves the prose (below).

Runbooks, each from a sev that ran for real (0571's binding line), in `.runbooks/`, flat, like
the existing one:

| Runbook | Level | Trigger | Ran for real |
|---|---|---|---|
| `sev-main-is-red.md` | sev1 | a `ci-scheduled` issue "Scheduled CI is red on main" opens, or main looks red and no issue is open | 2026-11-15 (issues 1297 and 1308), 2026-11-18 (issue 1631) |
| `sev-ci-is-slow.md` | sev1 | the daily speed check's issue "CI speed: a stage is over its goal" opens | 2026-11-17 to 18 (issue 1333) |
| `sev-nothing-lands.md` | sev0 | the owner says sev0 | 2026-11-14, 2026-11-18 |
| `sev-a-fix-is-red.md` | both | a fix's `ci-required` or its review comes back red | 2026-11-15 (three reds in series), 2026-11-18 (every CI fix but one had a review fault) |
| `sev-two-fixes-at-once.md` | both | a second fix is ready while one is landing, or two touch the same file | 2026-11-18 (the queue built two entries at once; the three-layer stack) |
| `sev-main-red-in-a-freeze.md` | sev0 | main goes red while the freeze runs | 2026-11-18 (1517 left a deleted script listed; 1630 fixed it) |
| `sev-rate-limit-runs-out.md` | both | GitHub's REST limit for the login reaches 0, or `sev.ts` logs `limited` | 2026-11-18 02:01 (1,522 failed calls; 1617) |
| `sev-close-and-walk.md` | both | every fix has merged, the owner calls it off, or the issue closed | 2026-11-15, 2026-11-18 |

Each runbook has the same five parts, the industry's form (PagerDuty's and Atlassian's playbooks),
and the frontmatter 0571 sketched. A sketch of one, to be written from the 2026-11-18 note:

```markdown
---
summary: the owner called a sev0 because nothing lands; open it, land each fix one at a time, then close
follows: ["0532", "0542", "0603", "0611"]
---

# A sev0: nothing lands

## Trigger
The owner says "sev0". Nothing else opens one.

## Roles
- Incident commander: the lead session. It holds the state, picks the order, admin-merges.
- The owner: declares it, empties the merge queue, decides any loosened law.
- Fix owner: one agent per fix, fixed until it lands. Only fix owners change code.
- Scribe: `runs/sev/log.jsonl`, written by `sev.ts`; the field note after.

## Steps
- [ ] `sev.ts open 0 --reason "..." --allow <first fix>`, in the background. It freezes CI and
      turns on the runner reserve.
- [ ] Tell every agent not on a fix to save and stop.
- [ ] Size-up: list the fixes, the one the others wait on first.
- [ ] Per fix: `sev-two-fixes-at-once.md` for the order, `land.ts merge <pr> --admin` to land it.
- [ ] Red fix: `sev-a-fix-is-red.md`.

## Exit
Every fix has merged, or the owner calls it off: `sev-close-and-walk.md`.

## Comms
One line to the owner at open (the fixes, in order), one at each red fix, one at close.
```

### Part 2: a sev fix is admin-merged once it is ready, in both levels, one at a time

```ts
// .agents/skills/lead/scripts/pr/Merge.ts, a sketch. Route.admin gains the sev1 case.
export const Route = Schema.TaggedUnion({
  queue: {},
  admin: {
    sev0: Schema.Array(Schema.String), // the branches an open sev0 allows (today)
    sev1: Schema.NullOr(Schema.String), // the one sev1 fix branch, while a ci-scheduled issue is open
  },
});

// Why an admin merge is allowed, or why not. `fix` is new: a sev fix in either level.
type AdminFor =
  | { _tag: "docs" }                       // 0183, unchanged
  | { _tag: "fix"; level: "sev0" | "sev1" } // the branch is the fix now landing
  | { _tag: "ready"; level: "sev0" }        // 0603: any other ready PR in a sev0, unchanged
  | { _tag: "refused"; reason: string };

// A fix's gate, in both levels: every one of these, at the head that is merged.
//   steps passed (the review's pass, as land.ts reads it today)
//   ci-required is a success at that head
//   origin/main's head is an ancestor of that head (current main merged in)   <- new
//   the leak gate is clean on the change, its commits and its words           (unchanged)
```

- **Fix one at a time** holds in both levels: in a sev0 by `sev.ts next` (today), in a sev1 by a new
  `sev.ts fix <branch>`, which names the one fix landing now and refuses a second until the first
  merged or `sev.ts fix --drop`. That covers two fixes breaking each other: the second fix's head
  must hold main with the first fix in it, and its `ci-required` ran on that head.
- **Current main merged in, for fixes only.** In a sev0, a ready pull request that is not a fix
  still lands as 0603 says, with no catch-up first. A fix differs because the next fix is tested on
  top of it.
- **Everything else in a sev1 stays on the merge queue** (0544). In a sev0 everything else lands as
  0603 says.
- **A sev1 fix is still proven by main's next full run** (0542): admin merge only makes it land
  sooner. The issue closes on that run's green.
- **The sev1 log.** A sev1 had no log (0542: "its open issue is the record"). `sev.ts fix` writes a
  `fix` line to `runs/sev/log.jsonl`, the one fact land.ts needs (which branch is the fix), and the
  issue stays the record of the level.

```ts
// .agents/skills/sev/scripts/Level.ts, a sketch: the new entry and what a sev1 reads.
const Fix = Schema.TaggedStruct("fix", {
  at: Schema.String,
  branch: Schema.NullOr(Schema.String), // null: --drop
  issues: Schema.Array(Schema.Int),     // the open ci-scheduled issues it answers
});
type Level =
  | { _tag: "none" }
  | { _tag: "sev1"; issues: ReadonlyArray<Alert>; fix: string | null } // fix: from the newest `fix` line since the newest issue opened
  | { _tag: "sev0"; since: string; reason: string; allow: ReadonlyArray<string> };
```

### Part 3: a runner reserve while a sev is open, and no cap on normal days

```yaml
# .github/workflows/check.yaml, a sketch of the three test jobs. Today none has a job group (0598).
jobs:
  changes:
    # one new step: .github/ci/slots.ts reads SLOTS and the labels, prints `slots`, a JSON map of
    # leg -> group, or "{}" when SEV_PR_SLOTS is unset or the pull request carries `sev`.
    env:
      SLOTS: ${{ vars.SEV_PR_SLOTS }}
      LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}
  next:
    concurrency:
      # unset: a name no other job uses, so it never waits (today's behavior).
      # set:   one of SEV_PR_SLOTS shared groups, so normal legs run that many at a time.
      group: ${{ fromJSON(needs.changes.outputs.slots || '{}')[matrix.shard] && format('sev-pr-slot-{0}', fromJSON(needs.changes.outputs.slots)[matrix.shard]) || format('leg-{0}-{1}-{2}', github.run_id, github.job, strategy.job-index) }}
      queue: max            # default `single` would cancel an older pending leg
      cancel-in-progress: false
  select:  # the same, keyed "select"
  related: # the same as next
# top-level concurrency: a `sev` label's run cancels the run it replaces, as `visual` does today,
# so labeling a fix starts it at once without the slots.
```

```ts
// .agents/skills/sev/scripts/Reserve.ts, a sketch. What the variable should be, from the level.
export const Reserve = Schema.TaggedUnion({
  on: { slots: Schema.Int }, // SEV_PR_SLOTS set to `slots`
  off: {},                   // SEV_PR_SLOTS deleted
});
export const wanted = (level: Level, slots: number): Reserve =>
  level._tag === "sev0" || (level._tag === "sev1" && level.fix !== null)
    ? Reserve.cases.on.make({ slots })
    : Reserve.cases.off.make({});

// .agents/skills/sev/scripts/Variables.ts, the contract (0095), like WorkflowRuns.ts. No GitHub word
// or type in it: names and string values only, so it moves into @kalfa/ci whole.
export class Variables extends Context.Service<Variables, {
  readonly read: (name: string) => Effect.Effect<Option.Option<string>, VariablesError | RateLimited>;
  readonly set: (name: string, value: string) => Effect.Effect<void, VariablesError | RateLimited>;
  readonly clear: (name: string) => Effect.Effect<void, VariablesError | RateLimited>;
}>()("sev/Variables") {}
// VariablesGh.layer: GitHub's repository variables API through `gh api`, as WorkflowRunsGh does.
// The only file that knows GitHub; it moves to @kalfa/ci/github unchanged but for its imports.
// VariablesTest.layer: a Map in memory.
```

- **Who sets and clears it: code, never a person.** `sev.ts` reconciles after every command it
  runs: `open 0`, `next`, `allow`, `fix`, `close`, `status` and each beat of `loop`. It reads the
  level, computes `wanted`, and writes only when the variable differs. So the reserve turns on when
  the sev0 opens or when the lead names a sev1 fix, and turns off at `close` (unless a sev1 fix
  remains) and at the first `sev.ts` call after the issue closes. The runbooks name the step
  ("`sev.ts fix <branch>` turns on the reserve"); they hold no command for the variable.
- **Where `Variables` sits, so it moves cleanly.** `@kalfa/ci` does not exist on main (`kalfa/`
  holds `config`, `quality` and `records`), so slice 1 does not start it: a package with one
  service and no runs protocol would be a guess at slice 2's shape. `Variables.ts` (contract),
  `VariablesGh.ts` (the GitHub Layer) and `VariablesTest.ts` stay a three-file set beside
  `WorkflowRuns.ts`, which is the same kind of set and moves with it. Neither contract imports
  anything from `.agents/` but Effect. When slice 2 builds `@kalfa/ci`, the two contracts become
  part of its `Runs` protocol and the two Gh layers move to `@kalfa/ci/github`; `sev.ts` and
  `land.ts` change only their imports. 85%.
- **Why a sev1 turns it on at `fix`, not when the issue opens:** the issue is opened by
  `scheduled.yaml`'s report job, whose `GITHUB_TOKEN` cannot write variables, and a new token is
  ruled out (0595). Until a fix exists there is nothing to reserve for.
- **The `sev` label:** `sev.ts next`, `allow` and `fix` add it to the fix's pull request through
  today's `PullRequests` service (`.agents/skills/lead/scripts/pr/PullRequests.ts`), and `close`
  and `fix --drop` remove it. `slots.ts` gives a labeled pull request `{}`, so its legs take no
  group. land.ts refuses an admin merge of a `sev`-labeled pull request that the log does not name,
  so a label alone grants nothing.
- **What happens to jobs already running when it flips:** they finish. A job's group is fixed when
  the job is queued, and nothing here sets `cancel-in-progress`. A leg queued before the flip keeps
  its no-wait group; a leg queued after joins the slots. So the reserve is fully real once the legs
  that started before it end: at most the longest leg's limit, `next` 17 minutes and a tooling
  `related` leg 33 (check.yaml's `timeout-minutes`), and in the measured runs 6.7 to 10.4 minutes
  (0598's table). **Is that enough?** In a sev0, yes: the freeze cancels every other run within one
  20-second beat, which is already a preemption. In a sev1, about 70%: a fix usually spends more
  than ten minutes in its steps before its ready run (the 2026-11-15 sev1: about 30 minutes from
  seen to merged), so the legs ahead of it have drained. When it is not enough, the fix waits in
  GitHub's FIFO queue for at most one leg's time. Slice 2's preemption, in `@kalfa/ci`, is the full answer.

**`SEV_PR_SLOTS = 3`, a setting (0069)** declared once as a repository Actions variable's value in
`.agents/skills/sev/scripts/sev.ts`'s settings (beside `SEV_SECONDS`), not in a workflow, since
the workflow reads only whether and how big. The number:

```text
documented limit, Free plan (Actions limits page; org API: plan free)        20
a sev fix's own ready run, p90 of 447 pull request runs, jobs at once         11   (this plan's read)
main's full run during a sev: MAIN_SLOTS 5 + scheduled-control 1               6   (scheduled.yaml)
left for normal pull requests                                                   3
```

Measured by this plan: every job of the 627 `check` and `scheduled` runs created from
2026-11-17 22:00Z to 2026-11-18 22:00Z, through the jobs API, 3,865 job runs with a start and an
end. Peak jobs at once per run, median and p90 and max: pull request 2, 11, 32; merge queue 3, 12,
14; push 1, 3, 7; scheduled 1, 5, 9. All jobs at once across the day: median 5, p90 19, p99 28,
peak 34. The script and its raw table stay off git (0027); the numbers are here.

**What normal pull requests lose, only while a sev is open:** in a sev0, nothing more than today,
since the freeze already cancels their runs. In a sev1, a ready run's test legs (up to 5 `next`, 1
`select`, 2 `related`) run 3 at a time, so a run of about 12 minutes (0598's estimate) takes about
25 to 30 (a guess: three waves of 6.7 to 10.4 minute legs). Their small jobs (`changes`, `check`,
`typecheck`, `ci-required`) take no group and still run at once. Normal days lose nothing: the
variable is unset and every leg's group is its own.

### Part 4: main's check runs are kept in a sev0

The 2026-11-18 note: "The freeze canceled main's own check runs, so a red main ... went unseen".
`Freeze.verdict` keeps a `check` run on `push` to `main`. Main's full run (`scheduled`) is still
canceled during a sev0 and started by `close` (below), since its nine legs are what a sev0 frees.

```ts
// Freeze.ts, a sketch of the one new case.
verdict({ workflow: "check", event: "push", branch: "main" }, allow);     // keep: "main"
verdict({ workflow: "scheduled", event: "push", branch: "main" }, allow); // cancel, as today
```

### Part 5: what leaves SKILL.md prose for a check

| Rule now in prose | Where it goes | Kind |
|---|---|---|
| A fix is admin-merged only when it is the fix, ready, on current main, leak-clean | `pr/Merge.ts` `adminFor` | test |
| One fix at a time in a sev1 | `Incident.fix` refuses a second | test |
| The reserve is on while a sev is open and off otherwise | `Reserve.wanted` and the reconcile in `sev.ts` | test |
| Main's check runs are kept in a sev0 | `Freeze.verdict` | test |
| "Start the full run by hand after close" | `close` dispatches `scheduled.yaml` on main through `WorkflowRuns` (a new `dispatch`) | test |
| "After close, rerun nothing" | already: WorkflowRuns has no rerun; a lint rule `no-run-rerun` in our oxlint plugin folder fails a `rerun` call or `/rerun` API path under `.agents/skills/` | lint |
| check.yaml's three test jobs take only the no-wait or `sev-pr-slot-` groups | workflow-lint `merge-line.ts`, replacing 0598's "no `scheduled-` group" rule with a stricter one | lint |
| Each runbook has the five parts, `summary` and `follows` that resolve to live records, and the skill lists every runbook | a runbook check in `@kalfa/records`, `records check runbook`, which `pnpm lint` runs (runbooks are a record folder, moving to `.kalfa/runbooks/` by 0571) | lint |

Judgment stays: when unsure which level, the order of fixes, a narrowed proof bar, the many-agents
lines, the write-up's fields, telling the owner.

### Part 6: the decision file

One new record, `0611` (`records.ts next .decisions`), written with `/adr` in its own docs pull
request, which lands first (0183). Its shape follows 0605 and 0606: no Amendments section, no
still-holds line, no copy of another record's rule. Its context names what it changed:

- 0542's table row "How a fix lands" for sev1 (through the merge line) and its "A sev1 has no log".
- 0544's "A sev1 fix still goes ahead of other changes: the lead turns the others off".
- 0532's "A push run on main is canceled too" (for `check` only).
- 0603's "no catch-up first", for fixes only.

The homes of those rules change in this quest's pull requests: the sev skill, the runbooks,
`pr/Merge.ts`, `Freeze.ts`, `sev.ts`, `check.yaml`. 0532, 0542, 0544 and 0603 stay `accepted`
(0606): none is reversed whole. Where a record is itself the only home of a changed line, that line
is edited in place in the same pull request, as 0605 allows; the lead checks each with
`records.ts resolve` and the records check. Its title, a draft: "Sev handling is a set of runbooks,
a sev fix is admin-merged one at a time on current main in both levels, normal pull requests share
SEV_PR_SLOTS runners while a sev is open, and run priority moves into @kalfa/ci".

### Slice 2, @kalfa/ci: the one CI protocol, with priority classes and preemption (a sketch, its own plan)

The owner's ruling of 2026-11-18: the CI protocol lives once, in `@kalfa/ci`, as Effect services.
GitHub Actions is the Layer at `@kalfa/ci/github`. next/'s libfabrika `Ci.ts` becomes a client of
it, and so do today's `sev.ts` and `land.ts`. A separate ADR pull request records it.

```ts
// kalfa/ci/src/Runs.ts, a sketch for slice 2's own plan: the protocol, no GitHub in it.
export class Runs extends Context.Service<Runs, {
  readonly dispatch: (ask: { ref: string; workflow: string; class: Class }) => Effect.Effect<RunId, CiError>;
  readonly cancel: (id: RunId) => Effect.Effect<void, CiError>;
  readonly states: Stream.Stream<RunState, CiError>; // queued, running, done with a conclusion
}>()("@kalfa/ci/Runs") {}
// The repository variables of slice 1 (Variables.ts) join this protocol as its settings.

// kalfa/ci/src/Priority.ts, pure domain code, Kubernetes' names.
export const Class = Schema.Literals(["sev-fix", "main-full", "normal"]);
export const Policy = {
  "sev-fix":   { value: 1000, preemption: "PreemptLowerPriority" },
  "main-full": { value: 500,  preemption: "Never", victim: false }, // never preempted
  "normal":    { value: 0,    preemption: "Never", victim: true },
} as const;

// Admission: what starts, given runners free. Pure, so laws generate it.
export const admit = (waiting: ReadonlyArray<RunState>, running: ReadonlyArray<RunState>, capacity: number)
  : { start: ReadonlyArray<RunState>; preempt: ReadonlyArray<RunState> } => { /* by class, then FIFO */ };
// preempt: when a sev-fix run waits and no runner is free, the newest `normal` runs, as few as
// free its need. Each preempted run is dispatched again later as a fresh run on its branch merged
// with current main, never a rerun (0542).

// kalfa/ci/src/github/ (the `@kalfa/ci/github` export): Runs and Variables over GitHub Actions,
// grown from today's WorkflowRunsGh.ts and VariablesGh.ts.
```

What slice 2's plan must settle, each a design call for that plan: where admission runs (a gate job
that waits for our admit, or runs started only by `dispatch`); how many runners we have, given the
measured 34; how a preempted run's branch is caught up; and the order in which `sev.ts`, `land.ts`
and next/'s `Ci.ts` move onto it. It is tooling any repo could use, so it is a `kalfa/` package
(0585), not `next/` product code.

## One value traced through

A sev1, after this lands:

1. Main's full run goes red on a law. Its report job opens issue N, labeled `ci-scheduled`.
   `sev.ts status` prints `sev1: issue N`, `fix: none`. Reserve: off. Normal pull requests unchanged.
2. The lead opens `.runbooks/sev-main-is-red.md`, tickets the cause, and starts a fix agent on
   `fabrikalfa/fix-x` (pull request P).
3. `sev.ts fix fabrikalfa/fix-x`: writes `{_tag:"fix", branch:"fabrikalfa/fix-x", issues:[N]}`,
   adds the `sev` label to P, and reconciles: `Variables.read("SEV_PR_SLOTS")` is none,
   `wanted` is `on 3`, so `Variables.set("SEV_PR_SLOTS","3")`.
4. A normal pull request Q pushes. Its `changes` job reads `SLOTS=3`, no `sev` label, and prints
   `slots={"1":"1","2":"2","3":"3","4":"1","5":"2"}` (proof.ts's rotation, by run number). Its
   `next` legs take `sev-pr-slot-1` to `3`, three at a time.
5. P's labeled run: `slots.ts` prints `{}`; each leg's group is `leg-<run>-next-<i>`; they start at
   once.
6. P's review passed; the lead merges main into P, pushes; `ci-required` is green at the new head.
   `land.ts merge P --admin`: Merge.ts reads the log's fix `fabrikalfa/fix-x`, origin/main is an
   ancestor of P's head, leak gate clean: `{_tag:"admin", for:"fix", level:"sev1"}`.
7. Main's next full run is green; its report job closes issue N.
8. The lead's next `sev.ts status` reads `none`, `wanted` is `off`, and clears `SEV_PR_SLOTS`; Q's
   later legs take their own groups again. Legs of Q already pending in a slot group run in FIFO.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| R1 set-on-open: after `open 0`, `next`, `allow` or `fix <branch>`, from any start value of the variable (absent or any string), `Variables` holds `SEV_PR_SLOTS = 3` and is written at most once per command. 100 runs | test | fc.record: a start value (absent, "3", any string) and a command sequence of 1 to 5 of those commands; seed 119120 | skip the reconcile in `fix`: a sev1 fix leaves the variable absent |
| R2 clear-on-close: after `close` with no sev1 fix left, or the first `status` after every `ci-scheduled` issue closed, the variable is absent; with a sev1 fix left after a sev0 close it stays. 100 runs | test | fc.record: open issues (0 to 3), a sev1 fix or none, a start value; seed 119120 | make `close` keep the variable: R2 fails on "no issue, no fix" |
| R3 unset-means-unchanged: `slots.ts` prints `{}` when `SLOTS` is empty or unset, and for any label list holding `sev`; check.yaml's `next`, `select` and `related` group expressions, evaluated on `{}`, give a name unique to run, job and index | test | fc.record: SLOTS (unset, "", "1" to "9"), labels (fc.array of fc.string plus maybe "sev"), legs 1 to 9; seed 119120; 100 runs | return slot "1" for an unset SLOTS: every leg on a normal day shares one group |
| R4 slots spread: with SLOTS = k, the map uses exactly groups 1 to min(k, legs), each leg one group. 100 runs | test | fc.record: SLOTS ("1" to "9"), legs 1 to 9, run number fc.nat; seed 119120 | map every leg to group 1 |
| R5 the workflow shape: each of the three jobs' `concurrency.group` is the expression above, `queue: max`, `cancel-in-progress: false`; the top-level cancel includes the `sev` label; no `scheduled-` group | lint | lint | drop `queue: max` from `related`: workflow-lint fails with the job's name |
| R6 admin merge of a fix, both levels: Merge.ts admits `fix` only when the branch is the log's fix (sev1) or allowed (sev0), `ci-required` is a success at the head, origin/main is an ancestor of the head, and the leak gate is clean; each missing part refuses with its own reason. 100 runs | test | fc.record: level (none, sev1 with fix x or y, sev0 allowing a subset), head holds main (bool), ci-required (success, failure, pending), leak (clean, hit, could not run), labeled `sev` (bool); seed 119120 | drop the ancestor check: a sev1 fix whose head lacks main is admitted |
| R7 one sev1 fix at a time: `fix <b>` refuses while another fix is named and not merged; `fix --drop` then `fix <b>` passes | test | scenario: fix a, fix b refused, drop, fix b allowed | let `fix` overwrite: the second fix is named silently |
| R8 main's check runs kept: `verdict` keeps `check` on `push` to `main`, cancels `scheduled` on main and any unallowed branch, keeps `merge_group` | test | fc.record: workflow (check, scheduled, host), event (push, pull_request, merge_group, workflow_dispatch), branch (main or fc.string), allow list; seed 119120; 100 runs | the old verdict: `check` push on main canceled |
| R9 close starts main's full run: `close` dispatches `scheduled.yaml` on `main` exactly once, after the loop ended, and never reruns a run | test | scenario: open, cancel two runs, close, on `WorkflowRunsTest` | dispatch before the loop's end line: R9 sees a cancel after the dispatch |
| R10 no rerun in lead tooling: a `rerun` call or a `/rerun` path under `.agents/skills/` fails `pnpm lint` | lint | lint | add `gh run rerun` to a test fixture under `.agents/skills/sev/`: the rule names the line |
| R11 the runbooks check: each `.runbooks/*.md` has frontmatter `summary` and `follows`, every id in `follows` resolves to an accepted record, the sev ones have the five headings (Trigger, Roles, Steps, Exit, Comms), and the sev skill links every `sev-*.md` and no missing one | lint | lint | delete `## Exit` from one runbook; link a missing runbook from the skill |

Lint, type or test? R5, R10 and R11 are shapes of files, so lint (workflow-lint and our oxlint
plugin, and a check in `pnpm lint`). R1 to R4 and R6 to R9 are behaviors, so tests, on the in-memory
layers (`VariablesTest`, `WorkflowRunsTest`, `PullRequestsTest`, `AlertsTest`). No law needs the
real machine: no host-only law, no `.integration.` file. The real `VariablesGh` gets the same
answer-shape laws `WorkflowRunsGh.test.ts` has, on recorded `gh` answers labeled `vector:`.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| `.decisions/0611-sev-runbooks-fixes-reserve-priority.md` | the new record, its own docs pull request (A) | lead | docs |
| `.agents/skills/sev/SKILL.md` | keeps the level table and judgment; lists the runbooks; step lists and code-checked rules leave | build | docs |
| `.runbooks/sev-main-is-red.md` | new runbook | build | docs |
| `.runbooks/sev-ci-is-slow.md` | new runbook | build | docs |
| `.runbooks/sev-nothing-lands.md` | new runbook | build | docs |
| `.runbooks/sev-a-fix-is-red.md` | new runbook | build | docs |
| `.runbooks/sev-two-fixes-at-once.md` | new runbook | build | docs |
| `.runbooks/sev-main-red-in-a-freeze.md` | new runbook | build | docs |
| `.runbooks/sev-rate-limit-runs-out.md` | new runbook | build | docs |
| `.runbooks/sev-close-and-walk.md` | new runbook | build | docs |
| `.agents/skills/sev/scripts/Level.ts` | the `fix` entry; sev1 reads its fix | build | 30 |
| `.agents/skills/sev/scripts/Incident.ts` | `fix`, `fix --drop`; the reconcile; close dispatches the full run | build | 70 |
| `.agents/skills/sev/scripts/Freeze.ts` | keep `check` push runs on main | build | 10 |
| `.agents/skills/sev/scripts/Reserve.ts` | new: `Reserve` and `wanted` | build | 25 |
| `.agents/skills/sev/scripts/Variables.ts` | new: the service contract | build | 30 |
| `.agents/skills/sev/scripts/VariablesGh.ts` | new: GitHub's repository variables API | build | 70 |
| `.agents/skills/sev/scripts/VariablesTest.ts` | new: in memory | build | 25 |
| `.agents/skills/sev/scripts/WorkflowRuns.ts` | `dispatch` | build | 5 |
| `.agents/skills/sev/scripts/WorkflowRunsGh.ts` | `dispatch` through `gh api` | build | 20 |
| `.agents/skills/sev/scripts/WorkflowRunsTest.ts` | `dispatch` in memory | build | 10 |
| `.agents/skills/sev/scripts/sev.ts` | the `fix` command; `SEV_PR_SLOTS` setting; the Variables layer | build | 30 |
| `.agents/skills/sev/scripts/Reserve.test.ts` | R1, R2 | tests | tests |
| `.agents/skills/sev/scripts/Incident.test.ts` | R7, R9 | tests | tests |
| `.agents/skills/sev/scripts/Freeze.test.ts` | R8 | tests | tests |
| `.agents/skills/sev/scripts/VariablesGh.test.ts` | answer shapes on `vector:` answers | tests | tests |
| `.agents/skills/lead/scripts/pr/Merge.ts` | `adminFor`'s `fix` case and the ancestor check | build | 50 |
| `.agents/skills/lead/scripts/pr/Merge.test.ts` | R6 | tests | tests |
| `.agents/skills/lead/scripts/land.ts` | reads the sev1 fix for the route; its header comment | build | 20 |
| `kalfa/records/src/Runbooks.ts` | new: the runbook check | build | 90 |
| `kalfa/records/src/Runbooks.test.ts` | R11 | tests | tests |
| `kalfa/records/src/cli.ts` | `records check runbook` | build | 10 |
| `oxlint-plugins/no-run-rerun.ts` | new: R10's rule | tests | 40 |
| `oxlint-plugins/no-run-rerun.test.ts` | R10 | tests | tests |
| `package.json` | `pnpm lint` runs `records check runbook` | tests | 1 |
| `.github/ci/slots.ts` | new: proof.ts's private `slots` moves here and gains the label and unset cases | tests | 40 |
| `.github/ci/proof.ts` | imports `slots` from slots.ts | tests | 5 |
| `.github/ci/slots.test.ts` | R3, R4 | tests | tests |
| `.github/workflows/check.yaml` | `changes` prints `slots`; three job groups; the `sev` label cancels | tests | 30 |
| `.github/ci/workflow-lint/merge-line.ts` | R5 | tests | 40 |
| `.github/ci/workflow-lint/merge-line.test.ts` | R5's cases | tests | tests |
| `.github/workflows/scheduled.yaml` | no change: named by the finding row and the doubt about the runner limit | tests | none |
| `.glossary/TERMS.md` | rows: `incident commander`, `runner reserve` (`SEV_PR_SLOTS`), `priority class` | build | docs |
| `field/findings/2026-11-18-runner-limit-above-twenty.json` | the measured 34 jobs at once against the documented 20 | lead | none |

## Existing tools

- `.agents/skills/sev/scripts/Variables.ts`: searched the repo, see the next line.
- `.agents/skills/sev/scripts/VariablesGh.ts`: searched, as below; it copies `WorkflowRunsGh.ts`.
- `.agents/skills/sev/scripts/VariablesTest.ts`: searched the
  repo for a typed service over GitHub repository variables (`rg -n "actions/variables"`), and found
  none; `WorkflowRuns.ts` and its two layers are the pattern copied, and `@effect/platform`'s
  command runner the way `WorkflowRunsGh.ts` calls `gh`. No npm package fits better than the
  service we already wrap (Octokit would add a dependency for three calls).
- `.agents/skills/sev/scripts/Reserve.ts`: searched `Level.ts` and `Incident.ts` for a value
  derived from the level; none. Small pure module beside `Level.ts`.
- `.github/ci/slots.ts`: searched the CI scripts folder for a slot rotation and found proof.ts's private
  `slots(run, count)` (0598); it moves here and is reused, not rewritten.
- `kalfa/records/src/Runbooks.ts`: searched `pnpm lint`'s parts, `records.ts` and `@kalfa/records`
  for a check that reads `.runbooks/`; none (0571 left it open). `@kalfa/records` already decodes
  frontmatter (`Frontmatter.ts`) and statuses (`Status.ts`) and has the `records check` command, so
  the check is a fifth check there, run alone by its name.
- `oxlint-plugins/no-run-rerun.ts`: searched oxlint's built-in rules; `no-restricted-syntax` is not
  in oxlint, and our plugin folder already holds string-literal rules, so the rule goes there.
- The `sev` label and the ancestor read: today's `PullRequests` service
  (`.agents/skills/lead/scripts/pr/PullRequests.ts`) and `Branches` service (`pr/BranchesGit.ts`,
  which already runs `git merge-base`), no new helper.
- Slice 2's `@kalfa/ci`: searched `kalfa/` on main (config, quality, records); it does not exist, and
  is not built here.

## Who lands first

1. **A, the decision record 0611**, docs only, lands at once (0183).
2. **B1, the runbooks and the fix route**: SKILL.md, the eight runbooks, Level, Incident, Freeze,
   Merge, land.ts, WorkflowRuns `dispatch`, the runbooks check, R10's rule. No CI workflow file.
3. **B2, the runner reserve**: Variables, Reserve, the reconcile, slots.ts, check.yaml,
   workflow-lint. One writer of `check.yaml` at a time (0598): it waits for any open pull request
   that edits `check.yaml`, and merges main before its ready run. The runbooks from B1 name
   `sev.ts fix` as the step that turns on the reserve; B2 makes it true, and B1's runbook says
   "from B2" until then, in no visible stub: the line is added in B2.
4. **C, slice 2**: after the owner's ADR for `@kalfa/ci` lands, a tracker ticket, "`@kalfa/ci`: the CI
   protocol, priority classes and preemption, with GitHub Actions as `@kalfa/ci/github`", with this
   plan's sketch, and its own plan.

## Size

1. A: the decision record, docs, about 120 lines.
2. B1: about 335 lines of code (Level 30, Incident 70, Freeze 10, Merge 50, land.ts 20, WorkflowRuns
   35, runbooks check 90, rerun rule 40), about 400 lines of tests, and about 550 lines of runbooks
   and skill (eight runbooks at about 60, the skill shrinks by about 100). 335 lines.
3. B2: about 315 lines of code (Variables 125, placed to move into `@kalfa/ci`, Reserve 25, reconcile and sev.ts 30, slots.ts 45,
   check.yaml 30, workflow-lint 40, plus 20 of wiring), about 300 lines of tests. 315 lines.
4. C: a ticket, 0 lines here.

How sure of the size: 70%. The doubt is the runbook check's fit in `@kalfa/records` and the
workflow-lint rule, which 0598's build found harder than planned.

Steps: B1 tests, build, review, plus one likely send-back; B2 the same. About $4 a step, priced
from the recorded steps of 2026-11-15 to 2026-11-18 in `field/runs/`
(`2026-11-18-tezgah-drawn-atomic-*` and the 0598 build's rows).

Estimate: 8 steps, $32

## What this cannot tell us

- Why the measured peak is 34 and not 20. The `SEV_PR_SLOTS` number is safe either way, but if
  the real limit is higher, 3 is tighter than it needs to be. A reading during the next sev, from
  the same jobs API, settles it.
- Whether a stale `SEV_PR_SLOTS` (the lead's laptop off after an issue closes) costs much. It only
  slows normal pull requests, and the next `sev.ts` call clears it.
- How long a sev1 fix waits behind legs that started before the reserve. The 70% above is a guess
  from one sev1's timings.
- 278 of the day's 634 run listings had no job rows on the first pass, from GitHub 502 answers and
  runs the freeze canceled before any job; the second pass reached 627 runs. A run with no jobs
  adds nothing to the counts, so the peaks can only be low, not high.
- Whether slice 2's admission can run in front of GitHub at all without a self-hosted runner or a
  dispatch-only workflow. That is the `@kalfa/ci` plan's to find.

## Calls taken

- **Runbooks flat in `.runbooks/`, prefixed `sev-`,** like the one runbook there, not a
  `.runbooks/sev/` folder: 0571 says one file per operation, named for it. 85%.
- **"Everything else stays on the queue" means in a sev1.** In a sev0 the queue is empty and 0603's
  admin merge of every ready pull request stands. 80%: the brief's sentence sits under "both
  levels", but 0603 is the owner's ruling of the same day.
- **Current main merged in is for fixes only,** so 0603's "no catch-up first" stays for the rest
  of a sev0. 85%.
- **Main's `check` runs are kept in a sev0, its full run is not,** from the 2026-11-18 note's
  learned line. 75%: the doubt is whether the owner wants main's full run kept too; it takes nine
  runners, which is what the freeze frees.
- **The reserve turns on at `sev.ts fix`, not at the issue's open,** because CI's token cannot write
  variables. 85%.
- **`close` dispatches main's full run itself,** in place of the printed hint. 80%: it moves a step
  from a person to code with the same rule.
- **`SEV_PR_SLOTS = 3`,** from the documented 20, see above. 70%.

## Open questions

1. Give scheduled.yaml's report job a token that can write repository variables, so the reserve
   clears the moment the issue closes, against 0595's "no token grant"? Lean: no; `sev.ts`
   reconciles at its next call, and a stale value only slows normal pull requests. 80%.

## Findings

```json
{"_tag":"finding","id":"2026-11-18-runner-limit-above-twenty","date":"2026-11-18","by":"plan","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":".github/workflows/scheduled.yaml","line":77},"says":"In today's CI, scheduled.yaml, workflow-lint's SC6 rule and 0598 assume the organization's 20 runners, the Free plan's documented concurrent job limit, but the jobs of 627 check and scheduled runs from 2026-11-17 22:00Z to 2026-11-18 22:00Z had up to 34 jobs running at once by started_at and completed_at, and 139 of 1,440 minutes at 20 or more.","proof":"gh api orgs/kamp-us gives plan free; https://docs.github.com/en/actions/reference/limits lists Free at 20; the jobs API of each run, counted by the sev-runbooks plan, gives a peak of 34 at 2026-11-18 05:19Z.","cost":"Every runner budget in today's CI (MAIN_SLOTS, PROOF_SLOTS, SEV_PR_SLOTS) is sized on a limit that may be wrong, so the budgets may hold back runners we have.","head":"d524d4e69b0e9d74a077ac2cb235bc6cc41573c1","ticket":null,"pr":null}
```

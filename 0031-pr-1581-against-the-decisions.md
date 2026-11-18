# Does PR 1581 conflict with 0536, 0581, 0584, 0590, 0594 and 0595? Yes, with three of them

**Answer:** it conflicts with **0536, 0581 and 0584**. Each of them has a binding constraint that
no pull request or merge queue run starts a law driving a real resource. **0590, 0594 and 0595 do
not decide it either way.** No decision on main allows it: I searched 0585 to 0599 and the plan. The
plan's README only records that ticket 1155 did it.

## What 1581 does

Commit 397e63f4, on today's version's CI: it "automatically runs related integration and tooling
tests on ready pull requests and queue groups". Its `related` job, in the required checks of
`check.yaml`, runs `.integration.` laws at full depth: real instances, SQLite and the plant engine.
On 1427 that includes Load, RepositoryTrust, worker-mail, settings-generated and T753 L16. The PR
cites only 0595, for slots.

## Per decision (live text on main at a6761bce)

| Decision | Verdict | Where |
|---|---|---|
| 0536 | **conflicts** | `.decisions/0536-real-resource-tests-run-only-on-the-schedule.md:55-56`: "No pull request or merge queue run starts a test that drives a real resource, except a visual end-to-end run a pull request asked for." Its 2026-11-15 amendment (lines 76-80) keeps it: "a real-resource law stays off the pull request and the merge line." |
| 0581 | **conflicts** | `.decisions/0581-main-full-run-starts-on-push-and-hourly.md:75-76` and `:85`: "Laws that need the real thing stay off the pull request check and the merge line", and the binding "A pull request or merge queue run starts no law that drives a real resource." Line 97 leaves only "whether an affected slow law runs in the pull request check" unruled. That is about slow laws, not real-resource ones. |
| 0584 | **conflicts** | `.decisions/0584-a-tests-kind-follows-what-it-uses.md:41-43` and `:65-66`: an `.integration.` law "runs only in the full run", and the binding "No pull request or merge queue run starts a law that reaches a real thing." |
| 0590 | does not decide it | its lines 29-30 cover only a branch proof run (`scheduled.yaml` dispatched on a branch), not `check.yaml`. 1581 in effect moves 0590's proof into the PR check, and its line 44 (`land.ts arm` accepts the proof run) now also accepts the automatic coverage. That is a change to the route 0590 set, made without a record. |
| 0594 | does not decide it | its line 78, "Existing Linux CI remains valid for ordinary integration proof", says which runner may give proof, not which event runs it. |
| 0595 | does not decide it | it is about `scheduled.yaml`'s slots. 1581 extended them to `check.yaml` on its own reading, and 0598 now takes them out again. |

**One thing of mine to know:** 0598, accepted tonight, takes the `related` job on the merge line as
a given (its lines 15, 24 and 127). It decides only the job groups, not whether real-resource laws
belong there. It does not ratify 1581.

## The two ways out, as a yes or no

**Yes: keep 1581, and record it.** One new decision amends the three binding lines of 0536, 0581
and 0584 to say: "a ready pull request and its merge queue group run the `.integration.` laws its
change reaches, at full depth". 0590's branch proof becomes the fallback.
- Cost, from lane 1 (0002) and 0598's estimate: the ready PR run was **20.2 min** with `related`
  (run 44201566907), against 3.0 median and 6.2 p90 before it, with a goal of 3 and 5.
- After 0598's build it should be **about 12.5 min**, its longest leg. That is still about 2.5
  times the p90 goal.
- What it buys: a real-driver bug is found before the merge, which 0536 gave up on purpose. And
  the hand-started proof wait goes away, which was most of last push to merged (median 12.2, p90
  55.0).

**No: restore the decisions.** The smallest change: in `check.yaml`, the `related` job stops
selecting `.integration.` files on `pull_request` and `merge_group`, and keeps its plain tooling
laws (0584 allows those). The real-resource laws go back to 0590's branch proof and main's full
run.
- That is one job's selector input and its workflow-lint rule, in K2's paths (the turn after C2
  and fabsh).
- Cost: the ready PR run goes back to about 3 / 6 min, plus whatever plain tooling legs add
  (about 10 min each on run 44201566907 before 0598).
- The proof wait comes back on last push to merged.

**My lean: yes, record it,** about 65% sure.
- 1581 removed the larger cost: the draft-to-ready proof wait, p90 55 min.
- 0598 already cuts its queue part.
- Every child now leans on it as "the automatic CI" under the owner's CI-only rule.

The doubt is 0536's stated reason: keeping real-resource laws off the merge line was a speed
choice, and 12.5 min is still over the goal. What would settle it: a day of ready-PR times after
0598's build lands.

## What this cannot tell us

- The 12.5 min after 0598 is an estimate from one run.
- I did not measure how many ready PRs `related` selects integration laws for. The cost falls only
  on those PRs.

# How do other merge queues land a change?

Ticket: https://github.com/kamp-us/tea-fabrika/issues/1708 (child of the map https://github.com/kamp-us/tea-fabrika/issues/1706).

Sources are official docs and source code only. Quotes are under 15 words, each with its link. A claim I could not find in a primary source is marked **guess**. A section that says "not documented" means I looked and the owner's docs are silent.

## The answer

Every queue lands a change the same way. It builds a **candidate**: the newest base plus the change, and often plus the changes ahead of it. It runs CI on that candidate, and it merges only what CI passed. The tools differ on four things. First, **what they test together**: one change (GitLab, bors with `single`), a chain of changes (GitHub, GitLab, Mergify, Graphite) or a group (bors, Tide, Mergify and Graphite batches). Second, **what they skip as already tested**: almost nothing by default. Only Mergify (a freeze), Graphite (CI on mid-stack changes) and Gerrit (copied votes) say they skip work, and each skips something different. Third, **how they stop**: only Mergify has a real pause and a real freeze. Tide stops with a labeled issue, GitHub and GitLab have no pause in their docs, and bors documents none. Fourth, **what an approval is attached to**: Gerrit is the only one that ties it to one revision (a patch set) and lets a rule copy it forward. GitHub, GitLab and bors tie it to the PR's diff or head commit and drop or ignore it when that changes. Tide and Mergify hang it on a label or review state of the PR. When the base moves, no tool asks for a new human approval. They all rebuild the candidate and rerun CI instead. The one exception is GitHub's "dismiss stale approvals" setting, which dismisses an approval when the diff changes, even because a related PR merged. Our words for this must keep three things apart: the change, the candidate that was tested, and the approval.

## bors-ng

- **Batches:** yes. It "lumps" approved PRs into batches: one running, one waiting. [README](https://github.com/bors-ng/bors-ng/blob/master/README.md). A batch is one merge commit of the base plus all its PRs, pushed to a `staging` branch. PRs of different priority are never batched together, and `single on` turns batching off for one PR ([documentation](https://bors.tech/documentation/)). `max_batch_size` caps the size.
- **Skips as tested:** nothing is skipped. The idea is the opposite: it merges "exactly the contents that were just tested", by fast-forwarding main to `staging` ([README](https://github.com/bors-ng/bors-ng/blob/master/README.md)). A failed batch is split in two and retried ("bisecting"), so a passing half is tested once and lands.
- **Freeze or pause:** not documented. The docs have no paused state. They have cancel: `bors r-` cancels an r+. The code's only blockers are `block_labels` and failed reviews ([batcher.ex](https://github.com/bors-ng/bors-ng/blob/master/lib/worker/batcher.ex)). A `try` build is a separate dry run, in a `trying` branch.
- **Approval:** `bors r+` means "reviewed: looks good". The batcher records the PR's head commit when the PR is r+'d, and if the head has moved when it builds, it gives up on that PR as a `:race` (batcher.ex, `pr.head_sha != patch.commit`). `up_to_date_approvals` counts "only approvals up to date with the latest PR commit". The docs do not say what happens to a plain r+ after a push. **Guess:** the code above means a pushed PR is not merged until it is r+'d again.
- **Base moves:** the batch is rebuilt from the base when it starts. If main moved and the final push is not a fast-forward, it posts `push_failed_non_ff` (batcher.ex). The docs say nothing more.
- **Words:** r+, batch, bisect, staging, try, priority, delegate, patch (in code), "bit-for-bit".

## Prow and Tide

- **Batches:** yes. Tide "automatically runs batch tests and merges multiple PRs together whenever possible" ([Tide](https://docs.prow.k8s.io/docs/components/core/tide/)). Every `org/repo:branch` is one **pool**. Batches get priority over single PRs, because a merge would make the running batch stale ([PR author's guide](https://docs.prow.k8s.io/docs/components/core/tide/pr-authors/)).
- **Skips as tested:** it reuses results while they are fresh and retests when they are not. "Whenever any other PR in the pool is merged, existing test results for your PR become stale" (PR author's guide). Tide "ensures that PRs are tested against the most recent base branch commit" (Tide page). The flowchart there throws away batch results with "incorrect refs".
- **Freeze:** a **merge blocker**. Tide supports "temporary holds on merging into branches" through an open issue with the configured `blocker_label`. A `branch:name` token in the title narrows it to one branch ([config](https://docs.prow.k8s.io/docs/components/core/tide/config/)). Tide keeps running and testing. It just does not merge.
- **Approval:** a **label** on the PR, not a record of a revision. Tide's queries need labels such as `lgtm` and `approved` and the absence of `do-not-merge` (config). The `lgtm` plugin removes the label on new changes: "New changes are detected. LGTM label has been removed." It can instead store a tree hash, so that "Squashing commits does not remove LGTM" ([lgtm.go](https://github.com/kubernetes-sigs/prow/blob/main/pkg/plugins/lgtm/lgtm.go)). The `approved` label comes from the approve plugin, which works from the set of approvers of every changed file ([approve.go](https://github.com/kubernetes-sigs/prow/blob/main/pkg/plugins/approve/approve.go)). **Guess:** the approve plugin does not drop `approved` on a push by itself. It recomputes it on each event.
- **Base moves:** results go stale and a retest starts. The label stays. The PR stays in the pool ("automatically retested so this doesn't require any action").
- **Words:** pool, batch, retest, stale, merge blocker, `tide` status context, "tide comes in / goes out", merge criteria.

## GitLab merge trains

- **Batches:** no groups. It chains. Each merge request is tested "against the combined changes of every merge request ahead of it", and the pipelines "all run in parallel" ([merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)). A **merge train pipeline** builds on a **merged results pipeline**, which tests one MR against the target.
- **Skips as tested:** nothing is skipped. When an MR fails or leaves, the later pipelines "are canceled" and restarted without it, because the old ones tested a combination that is "no longer valid". An experimental "merge immediately without restarting" option skips the restart. Its docs say the other MRs are then not verified against the immediate one.
- **Freeze:** not documented. The only escape is "Merge immediately", which cancels the train pipelines and starts a new train.
- **Approval:** attached to the **MR's diff**. "By default, an approval on a merge request is removed when you add more changes" ([approval settings](https://docs.gitlab.com/user/project/merge_requests/approvals/settings/)). GitLab uses `git patch-id` to tell whether the diff changed. The setting can be turned off, or limited to Code Owners.
- **Base moves:** the train rebuilds the candidates. An MR is **dropped** from the train if "the source branch was updated", on a conflict with earlier MRs, or when its pipeline fails (merge trains docs). A drop is for MR changes, not for base moves. The base moving only restarts pipelines.
- **Words:** merge train, merge request, merged results pipeline, merge train pipeline, dropped, "merge immediately", added to the train.

## Gerrit

- **Batches:** not a queue in the docs I read. One change is submitted, or a whole topic when `change.submitWholeTopic` is on ([config-gerrit](https://gerrit-review.googlesource.com/Documentation/config-gerrit.html)). The **submit type** decides how it lands: "rebase if necessary" fast-forwards, or else "rebases the current patch set ... on top of the current head" ([project config](https://gerrit-review.googlesource.com/Documentation/config-project-config.html)).
- **Skips as tested:** Gerrit tests nothing in a queue. It decides whether an earlier verdict still counts. A vote is **copied** to a new patch set when it matches the label's `copyCondition`. `changekind:TRIVIAL_REBASE` matches a rebase with the same diff and message, so a vote can survive a rebase ([labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)). `NO_CODE_CHANGE` is the choice for the Verified label.
- **Freeze:** not documented in what I read. A change is held by a `-2` vote or by a submit requirement that is not met, which is a rule ("Submit requirements are rules that define when a change can be submitted").
- **Approval:** attached to a **patch set** (one revision of a change). A change has a Change-Id and "one or more patch sets" ([user guide](https://gerrit-review.googlesource.com/Documentation/intro-user.html)). A vote not copied forward is called **outdated**, and the uploader is told. The submit rule asks for "+2 on the latest patch set" (labels).
- **Base moves:** a rebase makes a new patch set. Whether the approval follows depends on `copyCondition` (a trivial rebase keeps it, a rework does not). With the "rebase always" submit type, Gerrit adds a summary of the approvals to the rebased commit message.
- **Words:** change, patch set, Change-Id, label, vote, copy, copyCondition, sticky, outdated, submit, submittable, submit requirement, submit type, topic.

## Mergify

- **Batches:** yes. "A batch tests several queued pull requests together, in one CI run" ([batches](https://docs.mergify.com/merge-queue/batches/)). It also has **parallel checks**: it tests (PR1), (PR1+PR2), (PR1+PR2+PR3) at once, then merges "in queue order" ([speculative checks](https://docs.mergify.com/merge-queue/speculative-checks/)). Each batch goes on its own branch and, by default, a draft PR. `queue_rules` set size and wait time.
- **Skips as tested:** under a freeze, queued PRs are tested and those that pass "merge once it ends, in queue order, without being tested again" ([freeze](https://docs.mergify.com/merge-queue/freeze/)). A failed batch is split, and the batches built on top of it are "cancelled" and tested again ([batches](https://docs.mergify.com/merge-queue/batches/)). **Two-step CI** runs cheap checks on every push and the costly ones only inside the queue.
- **Freeze and pause:** two separate things. A **freeze** "holds back the pull requests it matches until the freeze ends": it stops merging, not testing. It can have exclude conditions (a `hotfix` label merges anyway). A **pause** is stronger: "Mergify will not schedule new checks or merge pull requests", it tries to cancel running checks, and queued PRs keep their place and new ones can still join ([pause](https://docs.mergify.com/merge-queue/pause/)). A pause needs a reason, and it has a CLI, an API and a dashboard.
- **Approval:** a **condition** on the PR (`queue_conditions` to enter the queue, `merge_conditions` checked on the candidate before merge) ([queue rules](https://docs.mergify.com/merge-queue/rules/)). A queue rule also checks what branch protections and rulesets need, so review state comes from GitHub. A PR leaves the queue when it stops matching `queue_conditions` (lifecycle page).
- **Base moves:** the candidate is rebuilt on the newest base. A PR is removed for "conflicts with the base branch or a check failure" ([lifecycle](https://docs.mergify.com/merge-queue/lifecycle/)). The docs I read do not say what happens to a review on a base move. **Guess:** that is GitHub's rule, not Mergify's.
- **Words:** queue, queue rule, queue_conditions, merge_conditions, batch, parallel checks, speculative, freeze, pause, dequeue, requeue, scopes, priority, draft PR, in-place checks.

## Graphite merge queue

- **Batches:** yes, and the unit is a **stack**, not a PR (a single PR is a stack of one). It has three options that stack: fast-forward merge (CI on all PRs of a stack in parallel), **Parallel CI** (several stacks at once, "speculative execution") and **batching** (groups of stacks) ([optimizations](https://graphite.dev/docs/merge-queue-optimizations)). A stack is atomic: "the whole stack will fail to merge".
- **Skips as tested:** for a stack that is queued together, "No need for CI to run again", because CI was already validated against that exact change ([overview](https://graphite.dev/docs/graphite-merge-queue)). A separate **CI optimization** skips CI on mid-stack PRs when a rebase is caused by another PR in the stack. A failed batch is handled by running smaller subsets, or by bisection.
- **Freeze:** not documented in the pages I read. A timeout limits how long a PR can sit at the head of the queue ([setup](https://graphite.dev/docs/set-up-merge-queue)).
- **Approval:** the docs I read say "merge when ready" waits until PRs are "approved and required CI checks have passed" ([merge when ready](https://graphite.dev/docs/merge-when-ready)). They do not say which revision an approval belongs to. **Guess:** it is GitHub's review state, since the queue works on top of GitHub branch protection.
- **Base moves:** merges made outside the queue "will be detected and the merge queue will restart the merge (rebase on top of those changes and restart CI)" ([setup](https://graphite.dev/docs/set-up-merge-queue)). The queue merges by rebase or squash, or by fast-forward.
- **Words:** merge queue, stack, stack-aware, merge when ready, fast-forward merge, parallel CI, batching, bisection, CI optimization, "trunk".

## GitHub merge queue (the baseline)

- **Batches:** yes. Changes are grouped into a `merge_group`: "the latest version of the base_branch as well as changes from pull requests ahead of it" ([managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)). Settings: build concurrency, minimum and maximum group size, a wait time, and "only merge non-failing pull requests".
- **Skips as tested:** the merge group's checks run on a temporary branch with a different SHA than the PR's. A merge queue "does not require a pull request author to update their pull request branch" ([overview](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)). A group with failing PRs may still merge if the last one passed, because its checks cover the whole set (docs, "Only merge non-failing"). A failing PR is removed and the groups behind it are recreated. Jumping the queue "will cause a full rebuild of all in-progress pull requests".
- **Freeze:** not in these docs. A PR leaves the queue on a check failure, a timeout, a user's request, or an unresolved "branch protection failure".
- **Approval:** attached to the PR's **diff** at the time of review. The "dismiss stale approvals" setting records "the state of the diff at the point when a pull request is approved". The approval is dismissed if the diff changes "because a related pull request is merged into the target branch" ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
- **Base moves:** the group is rebuilt on the latest base. A PR that conflicts or fails is removed.
- **Words:** merge queue, queue, merge group (`merge_group`, `gh-readonly-queue/...` branches), required checks, add to the queue, remove, jump to the top, build concurrency, dismiss stale approvals.

## Words side by side

| Idea | bors | Tide | GitLab | Gerrit | Mergify | Graphite | GitHub |
|---|---|---|---|---|---|---|---|
| The thing proposed | PR ("patch") | PR | merge request | change | PR | PR / stack | PR |
| One version of it | head commit | head commit | source branch head | patch set | head commit | head commit | head commit |
| The tested candidate | batch on `staging` | batch / PR in a pool | merge train pipeline | none (submit type decides) | batch (draft PR) | stack or batch | merge group |
| The "yes" | r+ | `lgtm` + `approved` labels | approval | vote (+2) | queue / merge conditions | approval, merge when ready | review + required checks |
| What stops it | `r-`, block labels | merge blocker issue | none documented | -2 vote, submit requirement | freeze, pause | timeout | none documented |
| When it goes stale | head changes (code) | results stale on base move | "dropped" | "outdated" vote | leaves queue | queue restarts | "stale" approval |

## What this cannot tell us

- I read docs and a few source files. I did not run any of these tools, so I did not check the behavior against the words, and I did not read their changelogs or issue trackers.
- Many pages were silent on freezes, approvals and base moves (bors, GitLab, Graphite, GitHub). "Not documented" means I did not find it. It does not mean the tool cannot do it.
- The two **guess** lines on bors and Prow are my reading of the code. Nobody wrote those rules down as promises.
- I did not cover Gerrit plugins (Zuul and similar gating tools), GitLab approval rules by role, or Mergify's partitions in depth.
- Some of these tools have changed quickly. The pages were read on the date of this ticket and may not match older versions.
- It does not say which words kalfa should use. That is for the glossary ticket this feeds.

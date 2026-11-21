---
summary: What GitHub's merge queue (with branch protection and rulesets), Gerrit (with Zuul's gate pipeline) and the merge queue bot that lands pull requests on rust-lang/rust (rust-lang/bors, and homu where it differs) each do by default in 16 cases (missing approval, checks before entry, approval removed, changes requested, new push, self-approval, approval count, drafts, manual removal, failed test commit, conflicts, outside merges, jumping, pause, merge method, order), and which setting changes each; every claim cited
---

# What merge queues do by default, and which setting changes it

Question (for `@kalfa/delivery`, a package that lands change requests on main through a queue): the owner's rule is to
invent no behavior. For each of 16 cases, the default is what GitHub's merge queue does, or what Gerrit does (with Zuul's
gate pipeline where Gerrit alone has no queue), and each becomes a setting. What do the makers' own documents say? Rust's
merge queue bot is added as a third column, because it is a long-running queue with its own words.

Read on 2026-11-21. The earlier study of how queues land a change is in
https://github.com/kamp-us/tea-fabrika/issues/1708 (its write-up is on the branch `fabrikalfa/research-merge-queues`,
file `research/merge-queues.md`). This file does not redo it. It answers new questions and adds Rust's bors.

How to read this file:

- **Quotes** are short and come with a link.
- **"Not stated"** means I read the owner's pages and they are silent. It does not mean the tool cannot do it.
- **"Inferred"** marks a reading of mine, not a promise in a document.
- **"Source code"** marks a claim taken from the maker's code or tests, not from a page of prose. Code can change.
- **GitHub pages** I read as their Markdown source in the `github/docs` repository and cite by their docs.github.com
  address. The GraphQL facts come from GitHub's own schema file in that repository.
- **bors-ng** (https://github.com/bors-ng/bors-ng) is a separate project from Rust's bors. It appears only where it
  shows a third way, and is always named "bors-ng".

## The table

"Setting" means the document names a switch. "Fixed" means it names none. Cells are short on purpose; the sections
below hold the detail and the links.

| # | Case | GitHub merge queue | Gerrit, with Zuul's gate | Rust's bors (homu where it differs) |
|---|---|---|---|---|
| 1 | Marked to land, lacks an approval | Accepted and waits: "Merge when ready" turns on auto-merge. The GraphQL `enqueuePullRequest` refuses. Not a queue setting ("Allow auto-merge" does not apply on queue branches) | Gerrit refuses at once (409 "blocked by ..."). Zuul does not enqueue until `pipeline.require` is met; the approval vote is the trigger. Setting: submit requirement, `pipeline.require` | `r+` is the approval. It waits only for the PR's own CI ("tentative approval", setting `pr_ci_timeout`); refused at once for draft, WIP title, blocking label, conflict, or failed PR CI unless `force` |
| 2 | Own branch checks before entry | Yes: only a PR that "passed all required branch protection checks" is added; then the same required checks run on the `merge_group`. Names come from the branch protection or ruleset list. Setting | Gerrit: your rule (a `Verified` label). Zuul gate: not required by default; the reference gate needs only `Workflow: 1`, then the gate itself votes `Verified: 2`. Setting: `pipeline.require` | Yes by default: tentative until PR CI is green, `force` skips. The auto build waits for all workflows on `automation/bors/auto`; no list of names (homu: `checks.<name>` config) |
| 3 | Approval removed or "changes requested" after entry | Not stated. Removal reasons documented: CI failure, timeout, user request, "Branch protection failure that could not automatically be resolved". Re-entry not stated | Gerrit has no queue. Zuul re-checks `require` on every pass and dequeues the item (source code). New approval event to re-enter | GitHub reviews are not read at all. Only a bors comment (`r-`) removes an approval; it also cancels a running auto build |
| 4 | Changes requested while another person approved | Blocks: the same reviewer must approve, or a writer dismisses the review. Needs the "require a pull request" rule | Gerrit: `-2` blocks even with a `+2`; `-1` does not block. Zuul: `pipeline.reject` approval list | Not read. Blocking is by label (`labels_blocking_approval`) or by `r-` |
| 5 | New commit pushed to a queued change | Queue entry: not stated. Approvals: "Dismiss stale pull request approvals when new commits are pushed" and "Require approval of the most recent reviewable push" | Gerrit: votes copy only if `copyCondition` matches (`changekind:TRIVIAL_REBASE`, `NO_CODE_CHANGE`). Zuul: removed (`dequeue-on-new-patchset`, default true) | Approval removed and a running auto build cancelled ("A new commit ... was pushed"); homu also clears the approval. Re-`r+` |
| 6 | Self-approval | Not allowed ("authors cannot approve their own"); no switch. Nearest: "Require approval of the most recent reviewable push" | Allowed by default (inferred); stop it with `user=non_uploader` in a submit requirement (old flag `ignoreSelfApproval`) | Allowed for anyone with review permission; no switch. Permission comes from the Team API (homu: `reviewers`) |
| 7 | Approvals needed | "Required number of approvals before merging"; default not stated | One `Code-Review +2` ("at least one MAX vote"); more via `label:...&count>1` | One `r+` from one person; no count setting found |
| 8 | Draft | Draft PRs "cannot be merged"; queue entry not stated (inferred: refused) | Gerrit: not stated. Zuul: `pipeline.require` `wip: false` is available; no default | bors: `r+` refused on a draft; approved PR turned into a draft drops out of the queue, keeps approval. homu: no draft code found |
| 9 | Take a change out by hand | "Remove from queue" or `dequeuePullRequest`; who: not stated; re-entry: add again (not stated) | Zuul: `zuul-client dequeue` (needs auth token). Gerrit: none. Re-entry: new trigger or `enqueue` | `r-` (review users or the author); `cancel` or `yield` stops a running build and the PR stays approved; `r+` to re-enter |
| 10 | Test commit fails with several changes in it | Failing PR removed; groups behind rebuilt without it. Which one is blamed in a bigger group: not stated | Zuul: the failing item is reported and dropped, items behind are retested without it | No batches: one auto build at a time. A failed rollup is bisected by people |
| 11 | Cannot be put on newest main | Removed from the queue; the timeline shows why | Gerrit: submit fails, "Cannot Merge", button disabled. Zuul: `merge-conflict` reporters | bors: unapproved with a comment, queue moves on. homu: error status |
| 12 | Main moved from outside | Not stated | Not stated in docs. Source code: Zuul reports `MERGE_FAILURE` if the change did not land | bors: fast-forward is not forced; if behind, build marked failed; already-merged PRs skipped |
| 13 | Jump the queue | "Jump to the top" when adding; full rebuild of in-progress PRs; who: not stated | Zuul: `zuul-client promote` (auth token); cancels and restarts jobs | `p=<n>` by review users; never interrupts a running build; `yield` or `cancel` does |
| 14 | Pause or freeze | No pause stated. Closest: build concurrency `0` stops new checks | Zuul: `manage-events` modes `pause-trigger`, `pause-result`, `discard-trigger` | `treeclosed=<priority>`; setting `merge_queue_enabled`; a running build finishes and lands (source code) |
| 15 | How it lands | "Merge method": merge, squash or rebase; default not stated | `submit.action`; default "merge if necessary" | bors makes a merge commit and fast-forwards main to it; `squash` command first; no setting found |
| 16 | Order | First in, first out; only "jump" changes it | Zuul: order of entry; `promote` reorders. Gerrit alone: not stated | Status, mergeability, priority (`p=`), rollup status, then age |

## Which bors lands pull requests on rust-lang/rust now

Short answer: **rust-lang/bors, the Rust rewrite**, not homu. In this file "bors" means rust-lang/bors and "homu" means
the old Python bot (https://github.com/rust-lang/homu), which the Rust project ran before.

- The Rust forge says: "The infrastructure team manages a merge queue bot called 'Bors', to be used for
  `rust-lang/rust`." It adds that the service is "automatically deployed from the rust-lang/bors repository"
  ([forge, Bors](https://forge.rust-lang.org/infra/docs/bors.html)).
- The compiler's contributor guide sends authors to the same bot. Its `@bors` link points at rust-lang/bors, and its
  "merge queue" link is https://bors.rust-lang.org/queue/rust
  ([rustc-dev-guide, PR lifecycle](https://rustc-dev-guide.rust-lang.org/pr-lifecycle.html),
  [Testing with CI](https://rustc-dev-guide.rust-lang.org/tests/ci.html)).
- The production bors help page lists the repositories it serves, with `rust` among them and a `[TREECLOSED]` mark
  ([bors help page](https://bors-prod.rust-lang.net/help)). The README names that host as the production instance
  ([rust-lang/bors README](https://github.com/rust-lang/bors/blob/HEAD/README.md)).
- homu's repository is archived. GitHub's API reports `archived: true` and a last push on 2025-11-04
  (https://github.com/rust-lang/homu).
- The rewrite describes itself as "a rewrite of the `homu` bors implementation in Rust" and calls homu "the old bors
  implementation" ([README](https://github.com/rust-lang/bors/blob/HEAD/README.md),
  [docs/design.md](https://github.com/rust-lang/bors/blob/HEAD/docs/design.md)).
- **Not stated:** the date of the switch. I found no page that gives it.

Where bors and homu differ on a case, both are given. The homu facts come from its code and sample config
([main.py](https://github.com/rust-lang/homu/blob/HEAD/homu/main.py),
[server.py](https://github.com/rust-lang/homu/blob/HEAD/homu/server.py),
[cfg.sample.toml](https://github.com/rust-lang/homu/blob/HEAD/cfg.sample.toml)); its README has no command list.

### Rust's own words

- **`r+`**: approve. `r=<user>` approves on behalf of another person; `r-` unapproves
  ([help page](https://bors-prod.rust-lang.net/help)). Forge: `r=<user>` "indicates that the PR was already approved
  by `@username`. This is commonly done after rebasing" ([forge, reviews](https://forge.rust-lang.org/compiler/reviews.html)).
- **tentative approval**: bors only. "By default, `@bors r+` tentatively approves a PR until PR CI succeeds, after which
  it is 'queued' automatically" ([design](https://github.com/rust-lang/bors/blob/HEAD/docs/design.md)). `force` approves
  at once.
- **`delegate[=<user>] [try|review]`**: gives the PR author (or a named user) the right to run try builds, or to also
  approve, on that one PR. `delegate-` removes it ([help page](https://bors-prod.rust-lang.net/help)).
- **`try`**: a test run of a PR on CI without merging it ([Testing with CI](https://rustc-dev-guide.rust-lang.org/tests/ci.html)).
  `try cancel` stops it.
- **`p=<priority>`**: "Higher number is higher priority" ([help page](https://bors-prod.rust-lang.net/help)).
- **rollup**: a PR that bundles several small approved PRs so they share one test run. Each PR has a rollup status
  `always`, `maybe`, `iffy` or `never` ([forge, Rollups](https://forge.rust-lang.org/release/rollups.html)).
- **tree closed**: `treeclosed=<priority> [reason]` closes the repository "for PRs with priority less than
  `<priority>`"; `treeclosed-` or `treeopen` opens it ([help page](https://bors-prod.rust-lang.net/help)).
- **`retry`**, **`cancel`** / **`yield`**, **`info`**, **`squash`**, **`note`**: see the help page.

## 1. Marked to land but lacks a needed approval: refused or waits?

**GitHub: accepted and waits, by the web button and the CLI; refused by the GraphQL call.**

- "You can click **Merge when ready** before all requirements pass. If the pull request can't be added to the queue
  immediately, GitHub enables auto-merge and adds the pull request to the queue when requirements are met, even if
  **Allow auto-merge** is disabled for the repository." To cancel the wait, click **Disable auto-merge**
  ([merging with a merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)).
- `gh pr merge` "automatically adds the pull request to the queue if required checks have passed. If required checks have
  not passed, this command enables auto-merge." The `enqueuePullRequest` mutation adds only "if it can be added
  immediately"; otherwise "the mutation returns an error that explains why" (same page).
- "The **Allow auto-merge** setting doesn't apply to branches that require a merge queue"
  ([managing auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)).
- Auto-merge is switched off "if someone without write permissions pushes new changes to the head branch or switches the
  base branch" ([automatically merging](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)).
- Can it be set otherwise? Which of the two behaviors you get depends on the entry point, not on a setting.

**Gerrit: refused at once. Zuul: not enqueued until the condition holds.**

- Gerrit: "The `Submit` button is available if the change is submittable" and the user has the Submit right
  ([review UI, Actions](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)). Over REST, a change
  that the rules do not allow gets "409 Conflict" with a message such as "blocked by Verified"
  ([REST, Submit Change](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#submit-change)).
  Setting: your submit requirements ([submit requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html)).
- Zuul: `pipeline.require` sets "prerequisites for any kind of item entering the Pipeline... the conditions specified
  here must be met or the item will not be enqueued"
  ([pipeline config](https://zuul-ci.org/docs/zuul/latest/config/pipeline.html)). In the reference `gate` pipeline the
  trigger is the `Workflow: 1` approval itself, so the vote both marks and enqueues
  ([Gerrit driver, reference pipelines](https://zuul-ci.org/docs/zuul/latest/drivers/gerrit.html)). There is no waiting
  room: a change without the approval simply is not in the gate.
- Zuul has one waiting case: when changes depend on each other and do not share a queue, "Zuul can't act on the approval
  and won't automatically enqueue the second change, requiring a new approval event"
  ([gating](https://zuul-ci.org/docs/zuul/latest/gating.html)).

**Rust's bors: the approval and the "land it" mark are one command.**

- `r+` needs the review permission. It is refused at once when the PR is not open (closed, merged or a draft), when the
  title contains `wip` or `[do not merge]`, when a label from `labels_blocking_approval` is on it, or when GitHub says it
  has merge conflicts (source code: `check_pr_approval_validity` in
  [review.rs](https://github.com/rust-lang/bors/blob/HEAD/src/bors/handlers/review.rs)).
- When PR CI has not finished, the approval is accepted as tentative and waits. When PR CI already failed, `r+` is
  refused unless `force` is given (same file, `tentative_approval_failed_comment`).
- Settings, from [`rust-bors.example.toml`](https://github.com/rust-lang/bors/blob/HEAD/rust-bors.example.toml):
  `pr_ci_timeout` ("Maximum time to wait for PR CI before removing a tentative approval", default 7200 seconds),
  `labels_blocking_approval`, `merge_queue_enabled` (default false).
- homu: `r+` approves at once, with no tentative state. It ignores PRs whose title starts with `WIP`, `TODO`, `[WIP]`,
  `[TODO]` or `[DO NOT MERGE]` (source code, [main.py](https://github.com/rust-lang/homu/blob/HEAD/homu/main.py)).

## 2. Do the change's own branch checks gate entry, or only the queue's test commit? Where do required-check names come from?

**GitHub: both. The PR must have passed its required checks to be added, and the same required checks then run on the
queue's test commit.**

- "Once a pull request has passed all required branch protection checks, a user with write access to the repository can
  add the pull request to the queue. The merge queue will ensure the pull request's changes pass all required status
  checks when applied to the latest version of the target branch and any pull requests already in the queue"
  ([managing a merge queue, overview](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
- Names of required checks: "Merge queue and pull requests checks are coupled and configured under branch protection rules
  or rulesets" (same page). The list is the "Require status checks before merging" list
  ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches))
  or the ruleset's "Require status checks to pass before merging"
  ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
- The checks must be told to run on the queue: "You **must** use the `merge_group` event to trigger your GitHub Actions
  workflow" (managing a merge queue). A required check that does not trigger on `merge_group` is never reported, "the
  merge will fail" ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)).
  With other CI, run on branches that start with `gh-readonly-queue/{base_branch}`.
- Setting for the test commit's checks: ruleset **Require all queue entries to pass required checks** (GraphQL
  `groupingStrategy`: `ALLGREEN` or `HEADGREEN`); branch protection calls it **Only merge non-failing pull requests**.
  When it is off, "only the commit at the head of the merge group... must pass its required checks to merge"
  ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
- Strict or loose: the "Require branches to be up to date before merging" box is separate, and the queue replaces its
  purpose: it "provides the same benefits... but does not require a pull request author to update their pull request
  branch" (overview above).

**Gerrit and Zuul: no fixed rule; you write it.**

- Gerrit: a check is a label (for example `Verified`) with a submit requirement; "By default a submit-requirement is
  created that requires at least one MAX vote" on `Code-Review`. A `Verified` label is optional
  ([labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).
- Zuul's `gate` does not require the change's earlier `check` results by default. Its reference form requires only an open,
  current patch set with `Workflow: 1`, it `supercedes: check` (the change is dropped from `check` when it enters
  `gate`), and on success it votes `Verified: 2` and submits
  ([Gerrit driver, reference pipelines](https://zuul-ci.org/docs/zuul/latest/drivers/gerrit.html)). Adding a `Verified`
  approval to `pipeline.require` would make `check` a gate. Setting: `pipeline.require`.
- Names of the jobs the gate runs come from the repository's own Zuul config, `project.<pipeline>.jobs`
  ([project config](https://zuul-ci.org/docs/zuul/latest/config/project.html)), not from a central required-check list.

**Rust's bors: PR CI first, then a full auto build.**

- "A small subset of tests and checks are run after each push to the PR. When the PR is approved, the bors bot enqueues
  the PR into a merge queue" ([Testing with CI](https://rustc-dev-guide.rust-lang.org/tests/ci.html)).
- The approval stays tentative until PR CI succeeds; `force` skips the wait (case 1).
- Names: bors asks GitHub for the workflows of the PR head commit and does not use a configured name list. For auto
  builds it "listen[s] for the workflow completed webhook... ask[s] GitHub what are all the workflows attached to the
  workflow's check suite" and finishes when all are done ([design](https://github.com/rust-lang/bors/blob/HEAD/docs/design.md)).
  Its `automation/bors/auto` branch "should be configured for CI workflows that need to run before merging"
  ([README](https://github.com/rust-lang/bors/blob/HEAD/README.md)).
- homu: names are configured, `[repo.NAME.checks.LABEL]` and `[repo.NAME.status.LABEL]`
  ([cfg.sample.toml](https://github.com/rust-lang/homu/blob/HEAD/cfg.sample.toml)). bors's design page says homu needed a
  "fake" final CI job so the whole workflow could be marked passed or failed.
- bors-ng, a third way: `status` lists the commit statuses that must pass on the merge commit, and `pr_status` the ones
  on the PR ([documentation](https://bors.tech/documentation/)).

## 3. Approval removed, dismissed, or a new "changes requested" arrives after the change is queued

**GitHub: not stated for approvals in the queue. The documents list reasons for removal, and none is "approval removed".**

- Reasons a PR leaves the queue: "Configured CI service is reporting test failures for a merge group", "Timed out
  awaiting a successful CI result based off the configured timeout setting", "User requesting a removal via the API or
  merge queue interface", "Branch protection failure that could not automatically be resolved"
  ([merging with a merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)).
  Failed required checks or conflicts with the base also remove it ("The pull request timeline will display the reason").
- Inferred: a lost approval is the "branch protection failure". The documents do not say so, and do not say where the PR
  re-enters.
- The GraphQL event `RemovedFromMergeQueueEvent` has `reason: String`, "The reason this pull request was removed from the
  queue". It is free text, not a list ([GraphQL schema](https://docs.github.com/en/graphql/reference/objects#removedfrommergequeueevent)).
- The webhook `merge_group` has two actions: `checks_requested` and `destroyed`. For `destroyed`, `reason` is one of
  `merged`, `invalidated`, `dequeued`: "invalidated by an earlier queue entry being dequeued". "This happens when a pull
  request is removed from the queue: any group containing that pull request is also destroyed"
  ([webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads#merge_group)).
- The queue entry's state has five values: `AWAITING_CHECKS`, `LOCKED`, `MERGEABLE`, `QUEUED`, `UNMERGEABLE`
  (GraphQL `MergeQueueEntryState`).

**Gerrit and Zuul.**

- Gerrit alone has no queue to leave. Submittability is checked when someone submits; a lost vote means the change is not
  submittable then.
- Zuul re-checks the pipeline's `require` on every pass over the queue. When the change no longer meets it, Zuul logs
  "Dequeuing %s because it can no longer merge", cancels its jobs and reports it as dequeued for missing requirements
  (source code, `zuul/manager/__init__.py`,
  [opendev](https://opendev.org/zuul/zuul/src/branch/master/zuul/manager/__init__.py)). The docs describe only the
  setting: "the conditions specified here must be met or the item will not be enqueued".
- Re-entry: another trigger event, for example a new `Workflow: 1` vote
  ([Gerrit driver](https://zuul-ci.org/docs/zuul/latest/drivers/gerrit.html)), or a manual enqueue
  ([zuul-client](https://zuul-ci.org/docs/zuul-client/commands.html)). Inferred from the reference trigger.
- Zuul's `pipeline.reject` is the mirror of `require`: it "can block an item from being enqueued"
  ([pipeline config](https://zuul-ci.org/docs/zuul/latest/config/pipeline.html)).

**Rust's bors.**

- The approval is a record in bors's own database, made by a comment. GitHub's review events are not among the events bors
  handles: comments, PR push, edit, open, close, merge, reopen, draft, ready for review, assign, branch push, workflow
  completed (source code, [event.rs](https://github.com/rust-lang/bors/blob/HEAD/src/bors/event.rs)). So dismissing a
  GitHub review, or a new "changes requested" review, does nothing to the queue.
- What removes an approval: `r-` (review users, or the PR author), a push to the PR, closing the PR, changing its base
  branch, a rollup member being invalidated, an expired tentative approval, a merge conflict found by the queue
  (source code: `InvalidationReason` and `invalidate_pr` in
  [handlers/mod.rs](https://github.com/rust-lang/bors/blob/HEAD/src/bors/handlers/mod.rs)). `invalidate_pr` also
  "Cancel[s] a running auto build, if there was any".
- Re-entry is a new `r+`. A cancelled auto build sends the PR back to `Approved` by itself (source code, `queue_status`
  in [database/mod.rs](https://github.com/rust-lang/bors/blob/HEAD/src/database/mod.rs)).
- homu: same shape. `r-` clears `approved_by`; so do a push and a base-branch edit (source code,
  [server.py](https://github.com/rust-lang/homu/blob/HEAD/homu/server.py)).

## 4. A "changes requested" review from someone whose approval counts: does it block while another person approves?

**GitHub: yes, and only that reviewer or a writer can clear it.**

- "If a person with admin permissions chooses the **Request changes** option in a review, then that person must approve
  the pull request before the pull request can be merged. If a reviewer who requests changes on a pull request isn't
  available, anyone with write permissions for the repository can dismiss the blocking review"
  ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
- The tip is wider than admin: the **Request changes** option "is purely informational and will not prevent merging
  unless a ruleset or classic branch protection rule is configured with the 'require a pull request' option. If
  configured and a collaborator with `admin`, `owner`, or `write` access... submits a review requesting changes, the pull
  request cannot be merged until the same collaborator submits another review approving"
  ([approving a pull request](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)).
  The two pages differ in how far they say it reaches (admin versus write). I followed the second, which is the more
  specific.
- Settings: "Require a pull request before merging" (ruleset) or "Require pull request reviews before merging" (branch
  protection); "restrict who can dismiss pull request reviews".

**Gerrit: only `-2` blocks, and another person's `+2` does not clear it.**

- "Any -2 blocks submit... `-2` on any patch set can block a submit, while `+2` on the latest patch set can enable it."
  `-1` "Does not block submit" ([labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).
- The default Code-Review submit requirement is "at least one MAX vote... and no MIN votes" (same page); written as
  `label:Code-Review=MAX AND -label:Code-Review=MIN`
  ([submit requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html)).
- Zuul: `pipeline.reject` with `approval: Code-Review: [-1, -2]` rejects "a change with any negative vote"
  ([Gerrit driver](https://zuul-ci.org/docs/zuul/latest/drivers/gerrit.html)).

**Rust's bors: no.** GitHub reviews are not read (case 3). A reviewer who wants to block uses a blocking label from
`labels_blocking_approval` (the example config names `final-comment-period`), or `r-`.

## 5. A new commit is pushed to a queued change

**GitHub.**

- What happens to the queue entry: **not stated** in the merge queue pages. The entry records a head commit
  (GraphQL `MergeQueueEntry.headCommit`), and `enqueuePullRequest` accepts `expectedHeadOid`, "The expected head OID of
  the pull request", so a caller can refuse a stale head. That is all the documents say.
- Approvals, two settings:
  - **Dismiss stale pull request approvals when new commits are pushed**: "If the diff changes from this state (for
    example, because a contributor pushes new changes... or because a related pull request is merged into the target
    branch), the approving review is dismissed as stale, and the pull request cannot be merged until someone approves the
    work again" ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
    The tip adds: "If both required reviews and stale review dismissal are enabled and a code-modifying commit is pushed...
    the approval is dismissed" ([approving](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)).
  - **Require approval of the most recent reviewable push**: someone other than the pusher must approve the latest push;
    "'stale' reviews are not dismissed". "If you are concerned about pull requests being 'hijacked'... it is safer to
    dismiss stale reviews."
- Note the dismissal rule also fires when another PR lands on the target branch. In a queue that lands PRs all day, that is
  the case to watch. The documents do not say how the queue and this rule interact.

**Gerrit and Zuul.**

- Gerrit: "Whether votes are sticky when a new patch set is created depends on the `copyCondition` of the label. If an
  approval matches the configured condition it is copied... Votes that are not copied... are called `outdated`"
  ([labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)). The change kinds:
  - `NO_CHANGE`: same parent tree, code and message; only the commit id differs. "It is recommended to leave this enabled
    for both, the Code-Review and the Verified labels."
  - `NO_CODE_CHANGE`: same parent tree and same diff; only the message may differ. Default for the optional `Verified`
    label.
  - `TRIVIAL_REBASE`: same message and same diff, rebased onto a different parent without conflict. "For the
    pre-installed Code-Review label this predicate is used by default."
  - `TRIVIAL_REBASE_WITH_MESSAGE_UPDATE`, `MERGE_FIRST_PARENT_UPDATE`, and `REWORK` (matches everything).
  - Other conditions in the same list: `is:MAX`, `approverin:`, `uploaderin:`, `has:unchanged-files`, `changeis:`.
  - Setting: `label.<name>.copyCondition`. Voters whose votes become outdated go on the attention set.
- Zuul: "if a new patchset is uploaded to a change that is in a pipeline, the existing entry in the pipeline will be
  removed (with jobs canceled and any dependent changes that can no longer merge as well." Setting:
  `pipeline.dequeue-on-new-patchset`, "Default: `true`"
  ([pipeline config](https://zuul-ci.org/docs/zuul/latest/config/pipeline.html)). The reference gate also requires
  `current-patchset: True`.

**Rust's bors and homu: the approval is removed.**

- bors: a push calls `invalidate_pr` with `CommitShaChanged`. It unapproves, cancels a running auto build, and invalidates
  rollups that contain the PR (a rollup is closed if a member got a push). It posts ":warning: A new commit `<sha>` was
  pushed." (source code, [pr_events.rs](https://github.com/rust-lang/bors/blob/HEAD/src/bors/handlers/pr_events.rs)).
  One exception: if the pushed commit is the one already approved, the approval stays, so `r+ squash` does not undo
  itself (comment in `invalidate_pr`).
- Before it starts a build, bors checks the head commit against the approved one. A mismatch unapproves the PR with
  "Commit SHA did not match the approved SHA during a merge attempt" (source code,
  [merge_queue.rs](https://github.com/rust-lang/bors/blob/HEAD/src/bors/merge_queue.rs)).
- homu: `head_advanced` clears `approved_by`, status, merge commit and test results
  ([main.py](https://github.com/rust-lang/homu/blob/HEAD/homu/main.py)).
- bors-ng, a third way: the batcher records the head commit at `r+`; a moved head makes it give up on that PR. Its
  `up_to_date_approvals` option counts "only approvals up to date with the latest PR commit"
  ([documentation](https://bors.tech/documentation/); the earlier study read its code).

## 6. Self-approval: may the author's own approval count? What is the setting called?

**GitHub: not allowed, with no switch.** "Pull request authors cannot approve their own pull requests"
([approving a pull request](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews),
tips). The nearest setting is **Require approval of the most recent reviewable push** (the last pusher cannot be the only
approver). Repository owners and administrators can merge without approval, by bypass.

**Gerrit: allowed by default (inferred), and there is a setting to forbid it.**

- The documents do not say that the default requirement excludes the uploader. "By default a submit-requirement is
  created that requires at least one MAX vote on this label and no MIN votes" ([labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).
- To forbid: `submittableIf = label:Code-Review=MAX,user=non_uploader AND -label:Code-Review=MIN`. Related arguments:
  `user=non_author`, `user=non_committer`, `user=non_contributor` ("not the uploader, author or committer of the latest
  patchset"). The page warns that forged authorship can defeat `non_author` and `non_committer`
  ([submit requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html)).
- The old flag `label.<name>.ignoreSelfApproval` is "deprecated". "If true, the label may be voted on by the uploader of
  the latest patch set, but their approval does not make a change submittable."

**Rust's bors: allowed for people with review permission. No switch.**

- The forge's release process says "Self-approve the PR with `r+ rollup=never p=1000`"
  ([forge, release process](https://forge.rust-lang.org/release/process.html)); reviews policy: "If you have r+
  privileges, you can self-approve a revert if the revert is clean"
  ([forge, reviews](https://forge.rust-lang.org/compiler/reviews.html)).
- Who may approve: the `review` permission, loaded from the Team API, "There are two separate permissions, `try`... and
  `review`" ([design](https://github.com/rust-lang/bors/blob/HEAD/docs/design.md)). An author without it gets
  "Insufficient privileges: not in review users" unless a reviewer ran `delegate`.
- homu: the `reviewers` and `try_users` lists in config ([cfg.sample.toml](https://github.com/rust-lang/homu/blob/HEAD/cfg.sample.toml)).

## 7. How many approvals by default, and what is the setting called?

- **GitHub:** setting **Required number of approvals before merging** (branch protection) or the ruleset's required
  approvals, under "Require a pull request before merging". The default number is **not stated**: you choose it when you
  tick "Require approvals" ([managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)).
  The range for per-team required reviewers is "from 0 (zero) to 10"; the range for the main setting is not stated.
  Approvals must come "from people with write permissions". Related: **Require review from Code Owners**.
- **Gerrit:** one. The default `Code-Review` requirement needs "at least one MAX vote". More: `label:My-Label&count>1`
  ("the label was approved by multiple users"); `distinctvoters:[Code-Review,Trust]&value=MAX&count>1` across labels;
  `label:Code-Review=MAX,users=human_reviewers` for all human reviewers
  ([submit requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html)).
- **Zuul:** counts nothing itself. It requires "an approval matching all specified requirements"
  (`pipeline.require.<gerrit source>.approval`) and the gate trigger is one `Workflow: 1` vote.
- **Rust's bors:** one `r+`. No count setting found in `rust-bors.example.toml` or `config.rs`.
  [forge reviews](https://forge.rust-lang.org/compiler/reviews.html): "A qualified reviewer with bors privileges...
  will leave a comment like `@bors r+`."

## 8. A draft change: can it enter the queue or be submitted?

- **GitHub:** "Draft pull requests cannot be merged" ([pull requests reference](https://docs.github.com/en/pull-requests/reference/pull-requests));
  converting to a draft means "No one can merge the pull request until you mark the pull request as ready for review
  again" ([changing the stage](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-stage-of-a-pull-request)).
  The merge queue pages do not mention drafts. Inferred: a draft cannot be added. A setting to allow it: none found.
- **Gerrit:** WIP changes "do not notify or require an action from a reviewer" and drop off reviewers' dashboards
  ([user intro](https://gerrit-review.googlesource.com/Documentation/intro-user.html)). Whether a WIP change can be
  submitted: **not stated** in the pages I read. Who can flip the state: the owner, project owners, administrators and
  holders of "Toggle Work In Progress state" ([access control](https://gerrit-review.googlesource.com/Documentation/access-control.html)).
- **Zuul:** `pipeline.require.<gerrit source>.wip` is "A boolean value (`true` or `false`) that indicates whether the
  change must be wip or not wip in order to be enqueued". No default is stated, and the reference gate does not set it.
- **Rust's bors:** `r+` on a draft is refused: only an `Open` PR can be approved. An already approved PR that becomes a
  draft keeps its approval but its queue status is `NotOpen`, so the queue skips it until it is ready for review again
  (source code: `check_pr_approval_validity`, `handle_pull_request_converted_to_draft`, `queue_status`). homu: no draft
  handling found; I searched `draft` in main.py and server.py and found none. It does refuse WIP-titled PRs (case 1).
- GitLab, a third way: converting a merge request to a draft drops it from the merge train. "A merge request is dropped
  from the merge train automatically if it can no longer be merged while the pipeline is running", and the list includes
  "The merge request was marked as a draft" ([GitLab merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)).

## 9. Taking a change back out of the queue by hand

- **GitHub:** the button is **Remove from queue**, on the PR page or in the queue view; the API is the GraphQL mutation
  `dequeuePullRequest`. The GitHub CLI cannot do it: "You cannot use GitHub CLI to remove a pull request from a merge
  queue" ([merging with a merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)).
  Who may: **not stated** (adding needs write access). Where it re-enters: **not stated**; inferred that it must be added
  again. The removal reason is "User requesting a removal via the API or merge queue interface".
- **Gerrit:** nothing to remove from. Withdrawing a vote, marking WIP, or abandoning ends submittability.
- **Zuul:** `zuul-client dequeue --tenant T --pipeline P --project X --change N,PS`. "This command is only available with a
  valid authentication token" ([zuul-client](https://zuul-ci.org/docs/zuul-client/commands.html)). The admin client page
  says tokens are used "to delegate privileged actions such as enqueueing and autoholding"
  ([zuul-admin](https://zuul-ci.org/docs/zuul/latest/client.html)). Re-entry: a new trigger event, or `enqueue`.
- **Rust's bors:** `r-` "Unapprove this PR", by a review user or the PR's author
  ([help page](https://bors-prod.rust-lang.net/help); source code `command_unapprove`). To stop only the running test:
  `cancel` (alias `yield`) "Cancel a running auto build on the current PR". The PR stays approved and goes back to
  `Approved`. The forge uses `yield` to give way to a release PR
  ([release process](https://forge.rust-lang.org/release/process.html)). Re-entry after `r-`: `r+`.
- GitLab, a third way: "Remove from merge train"; "All pipelines for merge requests queued after the removed merge
  request restart", and you "can add the merge request to a merge train again later"
  ([merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)). Mergify: `@mergifyio dequeue`, and "will not
  rejoin the queue automatically" ([Mergify lifecycle](https://docs.mergify.com/merge-queue/lifecycle/)).

## 10. The test commit fails with several changes in it: who is blamed, what happens to the others?

- **GitHub:** the queue builds a test commit per entry, each holding the target plus the PRs ahead. "When the GitHub API
  receives a failing status for `main/pr-1`, the merge queue automatically removes pull request #1... The merge queue
  recreates the temporary branch... to only contain changes from the target branch and pull request #2"
  ([managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
  So the entry whose own test commit fails is the one removed. With "Only merge non-failing pull requests" off, a failing
  PR can ride in a group whose last commit passes. When the settings give group size above one, which entry of a failing
  group is blamed, or whether the group is split: **not stated**. The webhook says a group dies when an earlier entry is
  dequeued (`invalidated`).
- **Zuul:** "If changes A and B pass tests (green), and C, D, and E fail (red): Zuul will merge change A followed by
  change B... Since D was dependent on C, it is not clear whether D's failure is the result of a defect in D or C...
  Since C failed, Zuul will report its failure and drop C from the queue, keeping D and E." D and E then restart against
  the new tip ([gating](https://zuul-ci.org/docs/zuul/latest/gating.html)). So the first failing item is blamed; later
  ones are retested. The "window" halves on a failure ("Each time a change fails, the window is halved"); settings
  `pipeline.window`, `window-floor`, `window-ceiling`, `window-increase-type`, `window-decrease-type`. Gerrit alone:
  no tests, nothing to say.
- **Rust's bors:** no group is built. "At any given time, at most a single `auto` build is being executed"
  ([Testing with CI](https://rustc-dev-guide.rust-lang.org/tests/ci.html)). A rollup is the only group, and it is one PR
  to the queue. The forge: "If the rollup has failed, run the `@bors retry` command if the failure was spurious... If it
  wasn't spurious, find the offending PR and throw it out... `Failed in <link>, @bors r-`... The failed rollup PR can
  be closed" and the rollup is re-created without it ([forge, Rollups](https://forge.rust-lang.org/release/rollups.html)).
  So blame is found by a person from the log analyzer's comment; the others are kept and bundled again. If a rollup
  member is later pushed or closed, bors invalidates and closes the rollup (source code, `invalidate_pr`). After a rollup
  merges, the optional `[unroll]` config makes bors build each member alone for performance runs.
- A failed PR (not a rollup) keeps its approval, status `Failed`. It sorts below the approved ones, and `retry` ("Clear
  a failed auto build status from an approved PR") or a new `r+` ("Re-approval should act as a retry", source code) tries
  again. The contributor guide puts it as "the failure is recorded and the PR will have to be re-approved again".
- bors-ng, a third way: "it splits the batch into two batches, and pushes those to the queue"; "When a batch cannot be
  bisected (because it only contains one PR), it gets kicked back to the creator"
  ([bors-ng README](https://github.com/bors-ng/bors-ng/blob/master/README.md)).

## 11. The change cannot be put on the newest main (a merge conflict)

- **GitHub:** "if there are failed required status checks or conflicts with the base branch, the pull request will be
  removed from the queue. The pull request timeline will display the reason why the pull request was removed from the
  queue" (managing a merge queue). No special name for the outcome.
- **Gerrit:** "Submitting a change may fail with conflicts. In this case you need to rebase the change locally, resolve
  the conflicts and upload the commit... as new patch set." "If a change cannot be merged due to path conflicts this is
  highlighted... by a bold red `Cannot Merge` label" ([user intro](https://gerrit-review.googlesource.com/Documentation/intro-user.html)).
  The submit button is "disabled and a tooltip... informs about the change being non-mergeable". Setting: submit type and
  `mergeContent` ([project config](https://gerrit-review.googlesource.com/Documentation/config-project-config.html)).
- **Zuul:** the outcome is "merge conflict". `pipeline.merge-conflict` sets the reporters (falls back to `failure`);
  `pipeline.merge-conflict-message` defaults to "Merge conflict. This change or one of its cross-repo dependencies was
  unable to be automatically merged with the current state of its repository. Please rebase the change." A different
  case, `merge-error`, is for infrastructure trouble ([pipeline config](https://zuul-ci.org/docs/zuul/latest/config/pipeline.html)).
  The item fails and items behind restart without it (source code).
- **Rust's bors:** `r+` is refused while GitHub reports a conflict. In the queue, a PR that cannot be merged is marked
  conflicting, "We unapprove the PR immediately... and also immediately send the unmergeability notification", and the
  queue moves on to the next PR (source code, `handle_start_auto_build`). Setting `report_merge_conflicts` (default false)
  and the `conflict` label event. homu: status `error`, ":lock:" comment, conflict label (`LabelEvent.CONFLICT`).
- GitLab, a third way: the train says "The changes could not be combined with changes in earlier merge requests on the
  train", and the merge request is dropped ([merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)).
  Mergify, a third way: a PR that conflicts only with one ahead of it is held and keeps its place; if the one ahead lands,
  the held one is removed ([Mergify lifecycle](https://docs.mergify.com/merge-queue/lifecycle/)).

## 12. Main is moved from outside the queue while changes are queued

- **GitHub:** **not stated** for the queue's test commits or for a queued PR that is now merged. What the pages say: an
  administrator can "Directly merge the pull request by checking **Merge without waiting for requirements to be met
  (bypass branch protections)**, if allowed by branch protection settings"
  ([merging with a merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)).
  And "A pull request can be marked as merged if its head branch commits become reachable from the base branch outside
  that pull request... pushed directly to the default branch" ([PR merges](https://docs.github.com/en/pull-requests/reference/pull-request-merges)).
  Each test commit records its `base_sha`, "The SHA of the merge group's parent commit" (webhook), and the queue keeps its
  groups "with the latest version of the `base_branch`". How it reacts is inferred, not documented.
- **Gerrit:** the docs on the submit type say, for `fast forward only`, "whenever one change is submitted all other open
  changes for the same branch, that are not successors of the submitted change, become non-submittable"; other submit
  types merge or rebase on submit ([project config](https://gerrit-review.googlesource.com/Documentation/config-project-config.html)).
  A push that bypasses review through the `submit` push option gives the requirement the status `FORCED`
  ([submit requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html)).
- **Zuul:** **not stated in the docs.** Source code: after a success, Zuul asks the source whether the change merged; if
  not, "Overriding result for %s to merge failure", sets `MERGE_FAILURE`, shrinks the window and raises a merge
  failure. A queued change that was merged elsewhere stops matching `open: True` in the reference gate, so inferred:
  dequeued as "can no longer merge" (`zuul/manager/__init__.py`).
- **Rust's bors:**
  - A push to the base branch marks the mergeability of the PRs on that base stale, and bors rechecks them in a batch
    (source code, `handle_push_to_branch`). A recheck that finds a conflict unapproves the PR with a comment.
  - The final step moves main with `ForcePush::No`. If main is no longer an ancestor, the build is marked failed and the PR
    gets ":eyes: Test was successful, but fast-forwarding failed: the tested commit was behind the `main` branch" (or "this
    PR has conflicts with the `main` branch") (source code, `handle_successful_build`).
  - A queued PR already closed or merged: the sanity check updates its status "We don't even send a comment" and moves
    on.
  - homu: a push marks every PR of that base as mergeable-unknown and rechecks; a PR that turns unmergeable gets
    ":umbrella: The latest upstream changes (presumably #N) made this pull request unmergeable" (source code, main.py).
- Graphite (read in the earlier study, not here): "merges made outside the queue will be detected and the merge queue
  will restart the merge".

## 13. Jumping the queue

- **GitHub:** "When adding a pull request to a merge queue, there is an option to move your pull request to the top of the
  queue." Cost: "jumping to the top of a merge queue will cause a full rebuild of all in-progress pull requests, as the
  reordering of the queue introduces a break in the commit graph" (managing a merge queue). GraphQL:
  `EnqueuePullRequestInput.jump`, "Add the pull request to the front of the queue"; `MergeQueueEntry.jump`. Who may:
  not stated beyond "a user with write access" to add. Does it keep its checks and approvals: the added PR must be
  addable, so it has passed its required checks; its own test commit still runs (the scenario shows a new
  `main/pr-3` branch with its own webhook). Approvals are still required by branch protection (inferred). No setting
  to turn the option off was found.
- **Gerrit alone:** not stated. **Zuul:** `zuul-client promote --pipeline P --changes 12345,1` "will push the listed
  changes at the top of the chosen pipeline"; "all the ongoing jobs in that queue will be canceled and restarted on top
  of the promoted changes"; "only available with a valid authentication token". The use case is "to merge an urgent fix
  when the gate pipeline has already several patches queued ahead" ([zuul-client](https://zuul-ci.org/docs/zuul-client/commands.html)).
  The change must already be in the pipeline, so its `require` has been met (inferred). `pipeline.precedence`
  (`minimum` 900 to `maximum` 100, default `normal` 500) ranks jobs between pipelines, not changes in one queue.
- **Rust's bors:** `p=<priority>`. "Higher number is higher priority". The PR still needs `r+`, and a normal approval
  still waits for PR CI unless `force`. It needs the review permission ("Insufficient privileges: not in review
  users", source code test). A priority never stops a build that is running: the queue is "ready for merge, then pending
  builds, then approved...", and "pending builds... block the queue" (source code, `sort_queue_prs`). To make room, run
  `yield` on the running PR; the forge's release process does this
  ([release process](https://forge.rust-lang.org/release/process.html)). Guidance: use rollup status, not priority,
  when you can ([forge reviews, Priority](https://forge.rust-lang.org/compiler/reviews.html)). homu: `p=` needs try-level
  permission, and values above `max_priority` (9001 in the sample) "are refused".
- Mergify, a third way: `priority_rules`; `allow_checks_interruption` default `false`: a higher priority PR "will be
  inserted just after the pull requests that have checks running" ([Mergify priority](https://docs.mergify.com/merge-queue/priority/)).
  GitLab: "Merge immediately" ignores the train and cancels the other pipelines, for Maintainers
  ([merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)).

## 14. A pause or freeze

- **GitHub:** a pause is **not stated**. Nearest documented controls:
  - Ruleset **Build concurrency** `0`: "the merge queue does not dispatch new `merge_group.checks_requested` webhook
    events. Pull requests waiting for a merge queue build do not progress until you increase the setting to at least
    `1`" ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
    Entries stay in the queue. Tests already dispatched: not stated. (The branch-protection page gives the range `1` to
    `100`; only the ruleset page documents `0`.)
  - **Lock branch**: "will make the branch read-only" ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
    What the queue does with it: not stated.
- **Gerrit alone:** not stated. **Zuul:** the admin guide, "Managing Event Processing": "tenant administrators may suspend
  event processing". Three modes: pause the trigger queue ("prevent Zuul from adding new items into pipelines"); pause
  trigger and result queues ("or reporting items that are already in existing pipelines... This may include merging
  changes in the case of a gate pipeline"); discard trigger events ("with no processing of the backlog"). A banner shows
  the reason. Commands: `zuul-client manage-events {normal,discard-trigger,pause-trigger,pause-result} --reason --info`,
  or the "Manage Queues" button ([operation](https://zuul-ci.org/docs/zuul/latest/operation.html),
  [zuul-client](https://zuul-ci.org/docs/zuul-client/commands.html)). Entries are kept. Whether tests in flight keep
  running: not stated (inferred: they run, their results are not reported). A related automatic stop:
  `pipeline.disable-after-consecutive-failures`.
- **Rust's bors:** `treeclosed=<priority> [reason]`: the tree is closed "for PRs with priority less than `<priority>`".
  Approvals are still accepted and the PR is told: "This pull request will be tested once the tree is reopened" (source
  code test text). In the queue loop, a build that is `ReadyForMerge` is merged before the tree check, and the check is
  only made for PRs about to start a build, so a running build finishes and lands (source code, `process_repository`;
  inferred as intent). `treeclosed-` or `treeopen` reopens. Repository switch `merge_queue_enabled = false` stops queue
  processing for the repository (default false). The help page marks a closed repository `[TREECLOSED]`. homu: same
  words; `process_queue` skips a state whose priority is below `treeclosed` (source code).
- Mergify, a third way, has both: a **freeze** "holds back the pull requests it matches"; a **pause** "will not schedule
  new checks or merge pull requests", "attempts to cancel any running checks", PRs can still join
  ([pause](https://docs.mergify.com/merge-queue/pause/), [freeze](https://docs.mergify.com/merge-queue/freeze/)).

## 15. How the change is put on main

- **GitHub:** setting **Merge method**: "merge, rebase, or squash" (managing a merge queue; GraphQL
  `MergeQueueMergeMethod`: `MERGE`, `REBASE`, `SQUASH`). The default is **not stated**. The queue merges "according to the
  merge strategy configured in the branch protection". What the PR shows: the merge queue timeline events (`AddedToMergeQueueEvent`,
  `RemovedFromMergeQueueEvent`), and the PR ends as merged. Squash "merged using the fast-forward option"; merge commit
  "using the `--no-ff` option"; rebase "Always updates the committer information and creates new commit SHAs"
  ([about merge methods](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)).
  Rulesets can also require one merge type, and "Require linear history" forbids merge commits.
- **Gerrit:** setting `submit.action`, "If `submit.action` is not set, the default is 'merge if necessary'". Values:
  `merge if necessary`, `merge always`, `rebase if necessary`, `rebase always`, `fast forward only` ("usage generally not
  recommended"), `cherry pick` ("usage not recommended"). New projects use `Inherit`. After a rebase or cherry pick,
  Gerrit adds footers: `Change-Id`, `Reviewed-on` (the change URL), `Reviewed-by` per positive `Code-Review` vote,
  `Tested-by` per positive `Verified` vote. The change then reads `MERGED`
  ([project config](https://gerrit-review.googlesource.com/Documentation/config-project-config.html)). Zuul calls
  Gerrit's submit: reporter `submit: true` ("Set this to `True` to submit (merge) the change", default `False`).
- **Rust's bors:** it "merge[s] the PR with the latest base branch commit in `automation/bors/auto-merge`, then pushes
  this merged commit to `automation/bors/auto`... If all tests pass, the base branch is fast-forwarded to the merge
  commit" ([design](https://github.com/rust-lang/bors/blob/HEAD/docs/design.md)). So main gets a merge commit made by
  bors. The contributor guide: "We do not allow merge commits into our history, other than those by bors"
  ([conventions](https://rustc-dev-guide.rust-lang.org/conventions.html)). To squash first: `@bors squash`, optionally
  `msg="..."` ([git](https://rustc-dev-guide.rust-lang.org/git.html)). A rollup puts "Rollup merge of #N" commits in its
  branch (source code, `rollup.rs`). I found no merge-method setting in `rust-bors.example.toml`. After a landing the PR
  gets ":sunny: Test successful" and, inferred from GitHub's rule on indirect merges, shows as merged. homu: with
  `linear` config it adds a `[merged]` prefix to the title (source code, `fake_merge`).

## 16. Order of the queue by default, and other orders

- **GitHub:** "merged in a first-in-first-out order where the required checks are always satisfied". Other order:
  the jump option only (case 13). GraphQL `MergeQueueEntry.position`.
- **Gerrit alone:** not stated. **Zuul:** the dependent manager "orders changes based on their entry into the pipeline";
  "Zuul queues those changes in the order they were approved". Other orders: `promote` (case 13). A change with a
  `Depends-On` is put behind what it needs ([gating](https://zuul-ci.org/docs/zuul/latest/gating.html)). The manager
  `supercedent` runs only the newest item per project and ref (for post-merge jobs, not gating).
- **Rust's bors:** "sorted by priority and creation date" (contributor guide). The code is exact: ready for merge, then
  pending build, approved, tentatively approved, failed, not approved; then mergeable before conflicting; then higher
  `p=`; then rollup status (`never` first, then `iffy`, `maybe`, and `always` last); then the lower PR number first (source code,
  [sort_queue.rs](https://github.com/rust-lang/bors/blob/HEAD/src/utils/sort_queue.rs)). The forge says the rollup status
  works as a priority: "never is the highest priority, always is the lowest", and rollup PRs "will not be merged by
  themselves until everything in front of them in the queue has been merged". No FIFO option is offered.
  homu's `sort_key` is similar: status, unmergeable, approved, priority, rollup, number
  ([main.py](https://github.com/rust-lang/homu/blob/HEAD/homu/main.py)).

## Where GitHub and Gerrit differ

- **Marking to land** (1): GitHub's web and CLI paths accept and wait; Gerrit refuses at once, and Zuul waits outside the
  queue for the approval event.
- **The queue itself** (3, 9, 12, 13, 14, 16): Gerrit has none; Zuul is the queue, and its docs list pause, promote and
  dequeue that GitHub's pages do not.
- **Blocking vote** (4): GitHub blocks by a "request changes" review until the same person approves; Gerrit blocks by a
  `-2` vote, and `-1` never blocks.
- **New commit** (5): GitHub's switch drops approvals when the diff changes; Gerrit copies votes by rule and Zuul drops the
  entry.
- **Self-approval** (6): GitHub forbids it with no switch; Gerrit allows it by default and offers `user=non_uploader`.
- **Method** (15): GitHub picks one of three per branch; Gerrit has five submit types and defaults to merge if necessary.

## Where Rust's bors differs from GitHub's merge queue

- **The approval is a bot's record, not a review** (3, 4, 6): comments make it, GitHub reviews are not read, and anyone with
  the Team API `review` permission can approve, the author included.
- **One test at a time** (10, 16): no groups; a rollup is built by a person; a failed rollup is bisected by a person.
  GitHub builds a test commit per entry and can group.
- **A push removes the approval and cancels the build** (5): GitHub's queue behavior on a push is not stated.
- **Tentative approval** (1, 2): approval waits for the PR's own CI; GitHub requires it before entry, or waits through
  auto-merge.
- **Priority and rollup status order the queue** (13, 16): GitHub is first in, first out and has only a jump option.
- **A freeze by priority** (14): `treeclosed=<priority>` stops builds below a priority, and a running build lands.
  GitHub documents no pause.
- **A conflict unapproves** (11): GitHub removes the PR from the queue; bors unapproves it and tells the PR.
- **Outside moves are handled in the open** (12): a fast-forward that fails marks the build failed with a stated reason.
- **Merge commit** (15): bors always lands a merge commit and has no method setting; GitHub has a `Merge method` setting.

## What this cannot tell us

- **GitHub's queue is thinly documented in these cases.** Not stated anywhere I read: what happens when a queued PR is
  pushed to, or loses an approval; who may jump or dequeue; where a dequeued PR re-enters; what happens to test commits
  when main moves from outside; any pause; the default for the merge method and for the approval count; whether a draft is
  refused by the queue; how a failing group of several entries is blamed. These need a trial run on a test repository, or
  GitHub support, not more reading.
- **No case was run.** I read documents and code. I did not start any queue, so no behavior was checked against its words.
- **Source code claims can change.** The bors, homu and Zuul facts marked "source code" come from the default branch on
  2026-11-21 (bors tests and handlers; Zuul `manager/__init__.py`). They are what the code does, not what the makers
  promise.
- **The date Rust switched from homu to bors is not stated** in anything I read. Nor is whether any repository still uses
  homu.
- **Gerrit has no queue of its own in what I read.** The Gerrit review UI says Submit "adds it to the merge queue", but
  I found no page about that queue's order, pause or removal. Whether a work-in-progress change can be submitted is not
  stated in the pages I read.
- **Zuul's reaction to a push to main from outside** is not in its docs. The answer above is read from code, with an
  inference.
- **Who may use Zuul's admin commands** is described only as "a valid authentication token", with no role names.
- **GitHub's two pages disagree on how far "changes requested" reaches** (admin only, or any writer). I followed the more
  specific one.
- **bors-ng, GitLab and Mergify** appear only where they show a third way. I read GitLab's merge train page and Mergify's
  lifecycle, priority and pause pages for this; not their full docs.
- **Not covered:** Gerrit plugins besides Zuul, GitHub's REST endpoints for merge queues (the GraphQL schema and webhook
  were read instead), and GitHub Enterprise Server differences.
- It does not say which behaviors `@kalfa/delivery` should choose. That is for the design.

## Sources

GitHub (read as Markdown in the `github/docs` repository, cited by docs.github.com address)

- [Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Merging a pull request with a merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)
- [Automatically merging a pull request](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
  and [managing auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)
- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  and [managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Approving a pull request with required reviews](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)
  and [dismissing a review](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/dismissing-a-pull-request-review)
- [Pull requests](https://docs.github.com/en/pull-requests/reference/pull-requests),
  [pull request merges](https://docs.github.com/en/pull-requests/reference/pull-request-merges),
  [about merge methods](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)
  and [changing the stage of a pull request](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-stage-of-a-pull-request)
- [Webhook events, `merge_group`](https://docs.github.com/en/webhooks/webhook-events-and-payloads#merge_group)
  and [workflow event `merge_group`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)
- GraphQL: [`EnqueuePullRequest`, `DequeuePullRequest`, `MergeQueueEntry`, `MergeQueueEntryState`, `MergeQueueParameters`,
  `RemovedFromMergeQueueEvent`](https://docs.github.com/en/graphql/reference/objects#mergequeueentry), read in
  [`schema.docs.graphql`](https://github.com/github/docs/blob/main/src/graphql/data/fpt/schema.docs.graphql)
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

Gerrit (version shown on the pages: v3.15.0-rc4)

- [Submit requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html)
- [Review labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)
- [Project configuration, submit types](https://gerrit-review.googlesource.com/Documentation/config-project-config.html)
- [User guide](https://gerrit-review.googlesource.com/Documentation/intro-user.html),
  [review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html),
  [REST changes](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html),
  [access control](https://gerrit-review.googlesource.com/Documentation/access-control.html)

Zuul (docs "latest", 14.3.0 at the time)

- [Project gating](https://zuul-ci.org/docs/zuul/latest/gating.html)
- [Pipeline](https://zuul-ci.org/docs/zuul/latest/config/pipeline.html),
  [Project](https://zuul-ci.org/docs/zuul/latest/config/project.html),
  [Queue](https://zuul-ci.org/docs/zuul/latest/config/queue.html)
- [Gerrit driver](https://zuul-ci.org/docs/zuul/latest/drivers/gerrit.html)
- [Operation, managing event processing](https://zuul-ci.org/docs/zuul/latest/operation.html)
- [zuul-client commands](https://zuul-ci.org/docs/zuul-client/commands.html)
- Source: [`zuul/manager/__init__.py`](https://opendev.org/zuul/zuul/src/branch/master/zuul/manager/__init__.py),
  [`dependent.py`](https://opendev.org/zuul/zuul/src/branch/master/zuul/manager/dependent.py)

Rust

- [rust-lang/bors](https://github.com/rust-lang/bors): [README](https://github.com/rust-lang/bors/blob/HEAD/README.md),
  [docs/design.md](https://github.com/rust-lang/bors/blob/HEAD/docs/design.md),
  [rust-bors.example.toml](https://github.com/rust-lang/bors/blob/HEAD/rust-bors.example.toml); source in
  `src/bors/handlers/` (`review.rs`, `pr_events.rs`, `mod.rs`), `src/bors/merge_queue.rs`, `src/utils/sort_queue.rs`,
  `src/database/mod.rs`, `src/bors/event.rs`, `src/github/rollup.rs`
- [Bors help page (production)](https://bors-prod.rust-lang.net/help)
- [rust-lang/homu](https://github.com/rust-lang/homu): README, `homu/main.py`, `homu/server.py`, `cfg.sample.toml`
- Forge: [Bors](https://forge.rust-lang.org/infra/docs/bors.html), [Rollups](https://forge.rust-lang.org/release/rollups.html),
  [Release process](https://forge.rust-lang.org/release/process.html), [Compiler reviews](https://forge.rust-lang.org/compiler/reviews.html)
- Compiler contributor guide: [Testing with CI](https://rustc-dev-guide.rust-lang.org/tests/ci.html),
  [PR lifecycle](https://rustc-dev-guide.rust-lang.org/pr-lifecycle.html), [Git](https://rustc-dev-guide.rust-lang.org/git.html),
  [Conventions](https://rustc-dev-guide.rust-lang.org/conventions.html)

Third ways

- GitLab: [Merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)
- Mergify: [lifecycle](https://docs.mergify.com/merge-queue/lifecycle/), [priority](https://docs.mergify.com/merge-queue/priority/),
  [pause](https://docs.mergify.com/merge-queue/pause/), [freeze](https://docs.mergify.com/merge-queue/freeze/)
- bors-ng (separate from Rust's bors): [documentation](https://bors.tech/documentation/),
  [README](https://github.com/bors-ng/bors-ng/blob/master/README.md)

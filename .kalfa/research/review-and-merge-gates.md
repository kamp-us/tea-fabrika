---
summary: How Gerrit, Chromium's LUCI CQ, Zuul, bors, GitHub (reviews, commit statuses, check runs, auto-merge, merge queue) and SLSA tie a review verdict to the exact code it judged, what invalidates it, how every path to merge meets one gate, and how an override and the judge are recorded; with what this repo's ruleset and 184 auto-merge histories show, and a recommended design for a bot-recorded review verdict on GitHub's merge queue; every claim cited
---

# How mature systems bind a review verdict to the code it judged

Question (from the lead session): today a review verdict lives only in the lead's chat. Nothing ties it to the commit it
judged, so code pushed after the review can merge, and a restarted session cannot tell what was reviewed. The candidate fix
is a commit status `review: success` on the reviewed head SHA that every merge path requires. What do mature systems do, and
what is the right fix for a GitHub merge queue plus a bot token?

Read on 2026-11-26. Only primary sources: official docs, the makers' source code and config, GitHub's own API schema, and
this repo's own files and its pull request history read through GitHub's API.

How to read this file:

- **"Observed"** means I read it from this repo's pull request history through GitHub's GraphQL API. It is a fact about
  this repo on this day, not a promise from GitHub.
- **"Inferred"** is my reading of a source. **"Not found"** means I looked and the source is silent.
- **GitHub docs** I read as Markdown source in `github/docs` at commit `df6faa250dc425fa137d270c967e6a74f12103a7`, and cite
  by their docs.github.com address. **GitHub's REST facts** come from `github/rest-api-description` at commit
  `d560905bbf50d79e40d6a006ce2e5834cfd86a31`. **GraphQL facts** come from https://docs.github.com/public/fpt/schema.docs.graphql.
- No case in this file was run on a test repository. The last section lists what that leaves open.

Nothing here is a decision. It feeds the lead's pick.

## The short answer

1. **A plain `review` commit status that the ruleset requires will stall the merge queue.** The queue tests a temporary
   commit that is not the pull request's head. GitHub says that commit has "a different `sha` from the pull request", and
   the queue "will wait for required checks to be reported" on it. Nobody posts `review` on that commit, so the entry waits
   until the ruleset's check timeout (180 minutes here) and is then removed. Section 6 has the sources.
2. **Every mature system does the same three things.** It records a verdict as a fact about one revision (who, when, which
   revision). It has a written carry rule that says which new revisions still count (Gerrit's `copyCondition`, Zuul's
   `current-patchset`, bors's approved SHA, GitHub's "diff changed" test). And only one actor can land code, and it checks
   again at the last step.
3. **The "pin the head" calls we use today only guard the moment of the call.** `gh pr merge --match-head-commit` and the
   `expectedHeadOid` in the arm mutation refuse a stale head when they run. After that, GitHub keeps auto-merge on through
   later pushes by people with write access and merges the new head. Observed on 17 pull requests in this repo (section 6).
4. **Recommended design (section 5).** The bot records the verdict as a **check run** named `review`, made by a **separate
   GitHub App** that holds only `checks: write`, on the exact head the reviewer read. The record carries the head, the base,
   and the **patch id** of the change's own diff. The gate that enforces it is a step inside `ci-required`, which already runs
   on `merge_group`; it reads the record and re-checks the patch id when the queue builds. Set the queue to
   `ALLGREEN`. On a merge of main into the branch (no new code), the lead posts a second `review` run on the new head that says
   "carried, same patch id". This matches the repo's own decision on the carry rule (`.kalfa/decisions/0066-deliverys-defaults-follow-github-then-gerrit-and-each-is-a-setting.md`).
5. **Cost.** One more GitHub App to create and keep a key for. The gate lives in a workflow file that a pull request can
   edit. An admin merge still skips the gate, though it now shows up in GitHub's rule insights. A PR enqueued by hand without a
   verdict fails at the end of its queue run, not before.
6. **Confidence about 70%.** About 85% that a required plain status deadlocks the queue (docs say so, no test was run). About
   60% that no simpler native route (a bot's PR approval plus "dismiss stale approvals") exists, because the docs do not say
   whether an App's approval counts. A 20-minute test on a scratch repo settles that.

## 0. What this repo does today (facts that shape the answer)

- **Ruleset on main.** Read with `gh api repos/kamp-us/tea-fabrika/rulesets/26683281` on 2026-11-26. It requires a pull
  request with `required_approving_review_count: 0` and `dismiss_stale_reviews_on_push: false`, one required status check
  `ci-required` pinned to integration 15368 (GitHub Actions), and a merge queue (squash, `grouping_strategy: HEADGREEN`,
  `max_entries_to_build: 3`, `max_entries_to_merge: 3`, `check_response_timeout_minutes: 180`). The bypass list holds one
  actor: the repository admin role, `bypass_mode: always`. So no human review is required, and an admin can skip everything.
- **Merge paths in `.agents/skills/lead/scripts/land.ts`** (header, lines 32-95): `queue` (`gh pr merge --squash --match-head-commit`,
  which enqueues), `arm` (turns on auto-merge, "merge when ready"), `merge` and `admin` (`gh pr merge --admin`, past the
  queue), and `run` (which ends in `queue`). `gh pr merge --admin` skips the queue by design: in the CLI source,
  `shouldAddToMergeQueue()` is `mergeQueueRequired && !UseAdmin`
  ([cli/cli `pkg/cmd/pr/merge/merge.go`](https://github.com/cli/cli/blob/aec38089147ae38264668843fa6126022c56a0e4/pkg/cmd/pr/merge/merge.go), line 550).
- **`ci-required` already runs on `merge_group`.** `.github/workflows/check.yaml` has `merge_group: types: [checks_requested]`.
  Its `changes` job already skips tests for a group whose tree and base tree a green pull request run already tested. That is
  the same idea as Gerrit's "same diff, new parent" rule, done on trees.
- **The repo already settled the carry rule.** `.kalfa/decisions/0066-deliverys-defaults-follow-github-then-gerrit-and-each-is-a-setting.md`
  says an approval covers a new change set "when its changes are the same, which is Gerrit's way", not GitHub's "always". The plan
  `.kalfa/quests/kalfa-git-diff-PLAN.md` (ticket https://github.com/kamp-us/tea-fabrika/issues/1933) builds the piece that
  decides it: `rangePatchId({ upstream, commit })`, compared between the approved tip and the new tip.
- **An earlier research file read how GitHub, Gerrit with Zuul, and Rust's bors treat 16 queue cases.** It is on the branch
  `research/merge-queue-defaults` (`.kalfa/research/merge-queue-defaults.md`). This file does not redo it. It adds the
  questions it did not ask: how a bot verdict is bound and carried, how every path meets one gate, and what GitHub does with
  auto-merge and a required status the queue never gets.

## 1. How each system binds a verdict to code, and what invalidates it

### 1.1 Gerrit

- **A vote belongs to one patch set.** A new patch set copies a vote only when the label's `copyCondition` matches: "If an
  approval matches the configured condition it is copied from the old current patch set to the new current patch set. Votes
  that are not copied to the new patch set, are called `outdated`." The uploader is told in the git output, and the voter
  goes on the attention set to vote again
  ([config-labels, Sticky Votes](https://gerrit-review.googlesource.com/Documentation/config-labels.html), Gerrit source at
  commit `04d1e46fcb76287a9bbd88e383536858cee99200`, `Documentation/config-labels.txt` lines 14-50).
- **The change kinds a condition can name** (same file, `changekind:`, lines 358-440):
  - `NO_CHANGE`: same parent tree, code and message. Only the commit id differs. "It is recommended to leave this enabled
    for both, the Code-Review and the Verified labels."
  - `NO_CODE_CHANGE`: same parent tree and same diff, "including context lines". Only the message may differ. The default
    for the optional `Verified` label.
  - `TRIVIAL_REBASE`: same message and same diff "including context lines", rebased onto a different parent where "that
    rebase did not require git to perform any conflict resolution". "For the pre-installed Code-Review label this predicate
    is used by default."
  - `TRIVIAL_REBASE_WITH_MESSAGE_UPDATE`: the same, with a new message.
  - `MERGE_FIRST_PARENT_UPDATE`: a new merge commit that "only differs from the merge commit in the previous patch set in its
    first parent". Useful "if your target branch moved on but the feature branch(es) being merged into the target branch did
    not change". It does not match a patch set that is not a merge commit.
  - `REWORK`: matches everything. `changekind:REWORK` equals `is:ANY`.
  - Other predicates in the same list: `is:MIN`/`MAX`/`ANY`, `approverin:`, `uploaderin:`, `has:unchanged-files` (same file
    list), `changeis:`.
- **The kind is a recorded fact.** The REST `RevisionInfo` has a `kind` field with the values `REWORK`, `TRIVIAL_REBASE`,
  `TRIVIAL_REBASE_WITH_MESSAGE_UPDATE`, `MERGE_FIRST_PARENT_UPDATE`, `NO_CODE_CHANGE`, `NO_CHANGE`
  ([rest-api-changes, RevisionInfo](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#revision-info), source line 10104).
- **Votes cast on an old patch set** are copied forward only if they match the condition and nothing newer overrides them
  (same Sticky Votes section).
- **A merge of the target into the change.** Gerrit's flow is "rebase", not "merge main in". The one kind that talks about
  the target moving is `MERGE_FIRST_PARENT_UPDATE`, and it applies to a change that is itself a merge commit whose first
  parent is the target. Our pull request head is a merge whose first parent is the branch and whose second is main, so the
  orientation is opposite. Inferred: `TRIVIAL_REBASE` ("same diff, no conflict work") is the nearest match for our case.

### 1.2 Chromium: Gerrit config plus LUCI CV (the commit queue)

- **Chromium's actual label config is public.** `chromium/src`'s `refs/meta/config/project.config`, read at commit
  `b3185e09d60e4cc5f105e99d53c76554637a5abc`: `[label "Commit-Queue"]` has `copyCondition = changekind:NO_CHANGE OR
  changekind:NO_CODE_CHANGE OR changekind:TRIVIAL_REBASE`. The parent project `chromium`, commit
  `39b7438eeadf69d95880a80144c466adfc7bb220`, sets `Code-Review` `copyCondition = changekind:NO_CHANGE OR changekind:NO_CODE_CHANGE
  OR changekind:TRIVIAL_REBASE OR (has:unchanged-files AND uploaderin:cria/project-chromium-committers) OR is:MIN` and
  `ignoreSelfApproval = true`. So: a rework drops the approval, a trivial rebase keeps it, a "no" vote (`is:MIN`) always
  sticks, and a trusted uploader can keep an approval when the file list is unchanged.
  (https://chromium.googlesource.com/chromium/src/+/refs/meta/config/project.config and
  https://chromium.googlesource.com/chromium/+/refs/meta/config/project.config)
- **LUCI CV warns about exactly our fear.** In CV's config schema, about letting a CL owner start a run on their own CL: "not
  recommended if you have sticky Code-Review label because this allows a malicious developer to upload an good looking
  patchset at first, get code review approval, and then upload a bad patchset and CQ it right away"
  ([`cv/api/config/v2/config.proto`](https://chromium.googlesource.com/infra/luci/luci-go/+/62309806c3d7943a2769799fe1e76dcb31a0c07e/cv/api/config/v2/config.proto), lines 539-547, luci-go at `62309806c3d7943a2769799fe1e76dcb31a0c07e`).
- **Two run modes.** "Dry-Run" (`Commit-Queue +1`) runs the tests and reports back. "Full-Run" (`Commit-Queue +2`) runs the
  same tests and, if they pass, submits the CL
  ([Chromium `docs/infra/cq.md`](https://chromium.googlesource.com/chromium/src/+/e9b0904d8ceeb564b92fd72fd4a7164491bcd142/docs/infra/cq.md), lines 24-39).
- **What carries to a new patch set.** CV reuses a passing build from "the same patchset (or an equivalent patchset across
  trivial rebases or commit message edits)", inside a window of 1300 commits on `main` or 24 hours elsewhere (same doc,
  lines 70-90). A tryjob result older than a day is ignored (config.proto, `Verifiers.Tryjob` comment, line 481). An option
  `dep_aware_equi_patchset_calculation` makes a rebase onto a changed parent stack count as a different patch set even if
  Gerrit calls it trivial (config.proto, lines 320-335).

### 1.3 GitHub

- **Required reviews are bound to a diff, not to a SHA.** "GitHub records the state of the diff at the point when a pull
  request is approved. This state represents the set of changes that the reviewer approved. If the diff changes from this
  state (for example, because a contributor pushes new changes to the pull request branch or clicks **Update branch**, or
  because a related pull request is merged into the target branch), the approving review is dismissed as stale"
  ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
  The setting is `dismiss_stale_reviews_on_push`: "New, reviewable commits pushed will dismiss previous pull request review
  approvals" (REST schema `repository-rule-pull-request`). A reusable note adds: "approving reviews will be dismissed as
  stale if the merge base introduces new changes after the review was submitted"
  (`data/reusables/pull_requests/security-changes-mergeability.md`). Another note says "If both required reviews and stale
  review dismissal are enabled and a code-modifying commit is pushed to the branch of an approved pull request, the approval
  is dismissed" (`data/reusables/repositories/request-changes-tips.md`).
  - **Merge of main into the branch, no overlap:** the docs list "clicks Update branch" as an example of a diff change, and
    also say the test is whether "the diff changes". They do not say what happens when main's new changes do not touch the
    pull request's files. Not found.
  - A second setting, `require_last_push_approval`, asks that someone other than the pusher approves the last "reviewable
    push". It does not dismiss: "stale reviews are not dismissed". "If you are concerned about pull requests being 'hijacked'
    ... it is safer to dismiss stale reviews." The docs never define "reviewable".
- **A review object names its commit.** The REST review has `commit_id` ("A commit SHA for the review"). When you create
  one, `commit_id` "defaults to the most recent commit in the pull request when you do not specify a value", so a bot that
  omits it binds to whatever head exists at the moment of the call
  ([create a review](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request)).
- **Required status checks are bound to one SHA.** "Required checks must pass on the latest commit SHA. Checks from earlier
  commits don't satisfy the requirement"
  ([troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)).
  Any new commit, including the merge of main that `Update branch` or our `land.ts run` makes, is a new SHA, and every
  required check must report on it again. Nothing carries over.
- **Merge queue.** The queue builds "temporary branches with a special prefix" on a commit that holds "the latest version of
  the `base_branch` as well as changes from pull requests ahead of it"
  ([managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
  It does not rerun the pull request's checks. It sends a `merge_group` event (`checks_requested`) and only workflows that
  list `merge_group` run. The pull request's own checks do not count there. "Merge queue and pull requests checks are coupled
  and configured under branch protection rules or rulesets": the same list of required names applies to both
  (same page).
  - A pull request is added only after it "passed all required branch protection checks"
    ([merge queue overview](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
    Reviews are therefore judged at the door, not again on the queue's commit. Inferred from that sentence; no page says so.
  - What a push to an already queued pull request does: **not found**. The removal reasons the docs list are failing CI,
    timeout, a user request, and "Branch protection failure that could not automatically be resolved".
  - The enqueue mutation takes `expectedHeadOid` ("The expected head OID of the pull request"), and a queue entry records
    `headCommit` and `baseCommit` (GraphQL `EnqueuePullRequestInput`, `MergeQueueEntry`).

### 1.4 Zuul (gating for Gerrit and GitHub)

- Zuul's reference `gate` pipeline for Gerrit requires `open: True`, `current-patchset: True` and an approval
  `Workflow: 1` before a change is enqueued. It tests the change merged onto the queue ahead of it, then on success votes
  `Verified: 2` and `submit: true`, so **Zuul itself performs the submit**
  ([`gerrit-reference-pipelines.yaml`](https://opendev.org/zuul/zuul/src/commit/898b7ab13fa6f422aad39a0f2c3be4d0caa26ffc/doc/source/examples/pipelines/gerrit-reference-pipelines.yaml),
  Zuul at commit `898b7ab13fa6f422aad39a0f2c3be4d0caa26ffc`).
- `current-patchset` means the approval must be on the latest patch set. A new patch set removes a queued change:
  "if a new patchset is uploaded to a change that is in a pipeline, the existing entry in the pipeline will be removed (with
  jobs canceled ...)", `dequeue-on-new-patchset`, default `true`
  ([pipeline.rst, line 335](https://opendev.org/zuul/zuul/src/commit/898b7ab13fa6f422aad39a0f2c3be4d0caa26ffc/doc/source/config/pipeline.rst)).
- For GitHub pull requests, Zuul's `require.github.review` needs "a code review of a certain type", and `current-patchset`
  means "the item must be associated with the latest commit in the pull request"
  ([github.rst, lines 620-700](https://opendev.org/zuul/zuul/src/commit/898b7ab13fa6f422aad39a0f2c3be4d0caa26ffc/doc/source/drivers/github.rst)).
  Nothing is carried over a rework. Whether an approval survives a rebase is Gerrit's `copyCondition`, not Zuul's.

### 1.5 bors (Rust's `rust-lang/bors`) and bors-ng

- **rust-lang/bors records the head SHA at approval.** A migration adds `approved_sha` to the `pull_request` table, and the
  review handler sets it from the pull request's head when `r+` is given
  ([migration `20250311143621_add_approved_sha_to_pr`](https://github.com/rust-lang/bors/blob/e151373c5cc70086904e80262a224f6506accaab/migrations/20250311143621_add_approved_sha_to_pr.up.sql),
  [`src/bors/handlers/review.rs`](https://github.com/rust-lang/bors/blob/e151373c5cc70086904e80262a224f6506accaab/src/bors/handlers/review.rs),
  bors at commit `e151373c5cc70086904e80262a224f6506accaab`).
- **It checks twice.** A push event unapproves the pull request. And again at the last step: before an auto build starts, a head
  that differs from the approved SHA unapproves it with "Commit SHA did not match the approved SHA during a merge attempt"
  (`src/bors/merge_queue.rs`, lines 470-482, with a test named `recover_approved_sha_mismatch_missed_webhook` for a lost
  webhook). The push-event rule and its one exception (the approved commit itself) are in `src/bors/handlers/pr_events.rs`,
  which the earlier research file read; I did not re-read it.
- **Only bors lands code.** It merges the PR with the newest base in `automation/bors/auto-merge`, pushes that to
  `automation/bors/auto` where CI runs, and then "fast-forward[s] base branch"
  ([`docs/design.md`](https://github.com/rust-lang/bors/blob/e151373c5cc70086904e80262a224f6506accaab/docs/design.md), lines 195-213).
  The docs I read do not say how the repository stops other pushes to main.
- **bors-ng is archived** (`archived: true`, last push 2024-04-04). Its docs: `up_to_date_approvals`: "only approvals up to
  date with the latest PR commit will count"; `pr_status`: "commit statuses that must pass on the PR commit when it is
  r+-ed"; `status`: statuses "that must pass on the merge commit before it is pushed to master"
  ([bors.tech documentation](https://bors.tech/documentation/)). That is the nearest sibling of a "verdict as a commit status
  on the PR head, then a second check on the merge commit" design.

### 1.6 SLSA, as the written standard

SLSA's source track names the property we want. "Changes in protected branches MUST be agreed to by two or more trusted
persons prior to submission." The rule covers "the final revision submitted. I.e., if additional changes are made during the
review process, those changes MUST be reviewed as well." "Approvals are for a specific context, such as a repo + branch in
git." An organization may give a "Trusted Robot" an exception. It does not define a carry rule for rebases, and it says
nothing about dismissing an approval
([SLSA source requirements](https://github.com/slsa-framework/slsa/blob/b2d82a4ee232f7a85d7311bcfe54cfa3ccdd500c/spec/source-requirements.md), lines 463-485, SLSA at commit `b2d82a4ee232f7a85d7311bcfe54cfa3ccdd500c`).

### 1.7 Summary: what carries over a rebase or a merge of the base, and what does not

| System | Carries over | Does not carry over |
|---|---|---|
| Gerrit | Votes matching `copyCondition`: no change, no code change, trivial rebase, first-parent update of a merge | Any rework; any vote the condition does not name (it goes "outdated") |
| Chromium (Gerrit + CV) | Code-Review and CQ votes on no-change, no-code-change, trivial rebase; a "no" vote always; passing builds across trivial rebases | Rework; builds older than 1300 commits / 24 hours |
| GitHub required review | An approval while "the diff" is unchanged (per docs; the base-merge case is unclear) | An approval once the diff changes, on push, update-branch or an overlapping merged PR |
| GitHub status or check | Nothing: it is bound to one SHA | Everything: a new SHA needs a new report |
| GitHub merge queue | Nothing from the pull request's SHA | The queue commit is new each time; checks must report on it |
| Zuul | Nothing: it tests the merged state and removes a changed entry | A new patch set removes the queue entry (default) |
| bors | Nothing: any new head SHA unapproves | Only an unchanged head is kept (checked at push and again at merge) |

## 2. Commit status, check run, or PR review for a bot-recorded verdict

| | Commit status | Check run | PR review |
|---|---|---|---|
| Who can create it | "Users with push access" ([create a commit status](https://docs.github.com/en/rest/commits/statuses#create-a-commit-status)) | "you must use a GitHub App. OAuth apps and authenticated users are not able to" ([create a check run](https://docs.github.com/en/rest/checks/runs#create-a-check-run)) | Any user or App token with `pull_requests: write` ([create a review](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request)) |
| Permission | "Commit statuses: write", for Apps and fine-grained tokens | "Checks: write", Apps only; it is not in the fine-grained token list | "Pull requests: write", for Apps and fine-grained tokens |
| Names the commit | `{sha}` in the path | `head_sha` | `commit_id`, default "the most recent commit" |
| Who made it, recorded | `creator` | `app` | `user`, `author_association` |
| Detail it can hold | `state`, `context`, `description`, `target_url` | `conclusion`, `external_id`, `details_url`, `output` (title, summary, text), times | `state`, `body`, `submitted_at` |
| Required by the ruleset | Yes | Yes | Only through the review count rule |
| Can the ruleset pin the source | Unclear (see below) | Yes, `integration_id` | Not applicable |

Permission data: `src/github-apps/data/fpt-2026-03-10/server-to-server-permissions.json` and
`fine-grained-pat-permissions.json` in `github/docs` at the pinned commit. Statuses and reviews appear in both lists; check
runs appear only in the App list.

- **Both statuses and checks can be required.** "Required status checks can be checks or commit statuses"
  ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
  Success means `success`, `skipped` or `neutral` (troubleshooting page). **A `neutral` or `skipped` check run passes a
  required check**, so a verdict check must never use those for "not reviewed". Our own gate must read `conclusion` itself.
- **Anyone with write access can forge a status.** "Any person or integration with write permissions to a repository can set
  the state of any status check in the repository". The ruleset can pin a required check to one App (`integration_id`: "The
  optional integration ID that this status check must originate from"). The 2021-12-01 changelog: "If status is then
  provided by a different app or by a user via a commit status, merging will be prevented"
  ([changelog](https://github.blog/changelog/2021-12-01-ensure-required-status-checks-provided-by-the-intended-app/)).
  The ruleset page says the pinned app "must be installed in the repository with the `statuses:write` permission, must have
  recently submitted a check run". Inferred: pinning is built around check runs. Whether a commit status made by an App
  token can be pinned by the same `integration_id`: **not found**.
- **Merge queue behavior.** Section 6 has the queue's rule for required checks. A PR review is judged before the pull
  request is queued. A status or check that is required must be reported on the queue's commit; the `merge_group` event's
  `head_sha` is "the commit SHA that should be validated and have status reported on"
  ([changelog 2022-08-18](https://github.blog/changelog/2022-08-18-merge-group-webhook-event-and-github-actions-workflow-trigger/)),
  "using check runs or commit statuses". So yes: **the merge group's SHA needs its own report** for every required context.
- **Can a bot's approval count as a required review?** The docs say reviews "from people with write permissions". Whether
  an App's `APPROVE` counts toward `required_approving_review_count`: **not found**. Two hints point to "no": the reviewer
  sidebar has a section for "approvals from reviewers whose reviews do not affect whether the pull request can be merged",
  and Copilot's approvals "do not count toward those requirements" (`data/reusables/repositories/request-changes-tips.md`).
  Also, "Pull request authors cannot approve their own pull requests" (same file), and the bot app is the author of our pull
  requests, so a second identity would be needed anyway.

## 3. One gate for every path, and how an override is audited

- **GitHub.** The ruleset applies to every path, except to its bypass list. By default an admin passes
  everything: "By default, the restrictions of a branch protection rule do not apply to people with admin permissions"
  (protected branches). Rulesets use a bypass list of roles, teams, or Apps. A bypass can be "For pull requests only", and
  then "the selected actor is now required to open a pull request ... creating a clear trail of their changes in the pull
  request and audit log" (`data/reusables/repositories/rulesets-branch-tag-bypass-optional-step.md`). An empty bypass list
  means no one passes. The merge UI offers admins "Merge without waiting for requirements to be met (bypass branch
  protections)" ([merging with a merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)),
  and `gh pr merge --admin` skips the queue.
- **GitHub's audit of a bypass.** The rule-suites REST endpoint lists evaluations with `result` of `pass`, `fail` or
  `bypass` ([list repository rule suites](https://docs.github.com/en/rest/repos/rule-suites)). It is in the plain
  github.com API description (`githubCloudOnly: false`) and an App can read it with Administration read. The "Rule Insights"
  page shows "Actions where someone has bypassed one or more rulesets", and a dashboard lists "Top bypassers". The org audit
  log has `protected_branch.policy_override` ("A branch protection requirement was overridden by a repository
  administrator") and `repository_ruleset.update` (`src/audit-logs/data/fpt/organization.json`). I did not find the org
  audit-log REST endpoint in the github.com API description, only in Cloud's.
- **Gerrit.** The choke point is the `Submit` permission: "In order to submit, all labels ... must enable submit, and also
  must not block it". A direct `Push` "bypass[es] any code review process" and "Projects that need to require code reviews
  should not grant this category"
  ([access-control](https://gerrit-review.googlesource.com/Documentation/access-control.html), lines 656-680 and 958-975).
  Overrides are first-class and recorded on the change: a submit requirement has `overrideIf` ("to allow change submission in
  case of emergencies"), and the result status is `OVERRIDDEN`. A merge that skipped review through the submit push option
  gets the status `FORCED`: "The change was merged directly bypassing code review"
  ([config-submit-requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html), lines 278-330, 431-443).
- **Chromium.** The project's own file gives `submit` on `refs/heads/*` to `chrome-branch-day` and the LUCI account, and the
  parent project adds two more groups (`chromium-borg-robots`, `cria/project-chromium-submit-access`). CV is therefore the
  normal submitter, not the only one. The `Code-Review` submit requirement has an `overrideIf` for `label:Bot-Commit=+1`
  and for trusted uploaders with `Pure-Revert`, `Pure-Cherry-Pick` or `Benign-Change` votes. The `Commit-Queue` and
  `Verified` labels are not submit requirements (`applicableIf = is:false`): the tests are enforced by CV, which is the one
  that submits. Skips are written as commit-message footers (`Ignore-Freeze: true`, `Merge-Approval-Bypass: <reason>`,
  `No-Presubmit: true`), so the override sits in git history ([cq.md](https://chromium.googlesource.com/chromium/src/+/e9b0904d8ceeb564b92fd72fd4a7164491bcd142/docs/infra/cq.md), lines 140-220). I cannot tell from the files
  who is in those groups.
- **Zuul.** The `gate` pipeline submits through Gerrit (`submit: true`). Whether Gerrit also lets other people submit is
  Gerrit's ACL, not Zuul's, and the Zuul docs I read do not say.
- **bors.** One actor, one path: only bors fast-forwards the base branch. The docs I read do not say how other pushes are
  blocked.
- **SLSA** allows a "Trusted Robot" exception, and wants "technical controls enforced on Named References" recorded
  "in contemporaneously produced attestations" (source requirements, lines 440-452).

## 4. Recording who judged, at which revision, readable later

- **Gerrit** stores the vote with the account, a date, an optional `tag` ("Tags with an 'autogenerated:' prefix may be used
  by CI or other automated systems to distinguish them from human reviews"), and now an `is_ai` flag ("Whether the votes in
  `labels` were created by an AI agent"). A vote is posted to one revision: `POST /changes/{id}/revisions/{rev}/review`. The
  approval info also has `post_submit` (rest-api-changes, `ApprovalInfo` lines 7818-7850, `ReviewInput` lines 9895-9916).
- **GitHub** stores: a review (`user`, `commit_id`, `submitted_at`, `state`); a check run (`app`, `head_sha`, `external_id`,
  `details_url`, `output`, `started_at`, `completed_at`); a status (`creator`, `context`, `description`, `target_url`, times).
  A check run's `output.text` is free text, so a JSON record fits. Anyone can read these by SHA with a plain GET, so a
  restarted coordinator asks GitHub, not its own memory:
  `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` with `check_name`, `app_id`, `status`, `filter=latest|all`
  ([list check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)).
- **LUCI CV** keeps a Run per attempt, posts the result as a Gerrit comment, and keeps tryjob builds in Buildbucket; reuse
  rules refer to the patch set (cq.md lines 24-90).
- **bors** keeps `approved_by`, `approved_sha` and a tentative flag in its own database
  (`src/database/operations.rs`, the migration above). It is not readable from GitHub alone.
- **SLSA** says "Source Provenance MUST be created contemporaneously with the branch being updated such that they provide a
  credible, auditable, record of changes", and that a consumer authorized to read a revision "MUST be able to access the
  corresponding Source Provenance documents" (lines 412-418).
- What all of these share: the record names the **revision**, the **actor**, and a **time**; it lives on the system everyone
  asks, and is not in a session's memory.

## 5. Recommendation for us

**Short form.** Record the verdict as a check run from a separate GitHub App, keyed to the head the reviewer read and carrying
a patch id. Enforce it inside `ci-required` on the `merge_group` run. Carry it across a clean merge of main by an explicit
second record. Set the queue to `ALLGREEN`. Keep admin bypass but make it loud.

### 5.1 Why not the candidate (a required `review` commit status)

1. **It deadlocks the queue.** A required context must be reported on the queue's commit (section 6). Nothing would post
   `review` there. Every entry would wait out the 180-minute timeout and be removed. This has happened once in this repo
   for some check: of 437 queue removals across the newest 1,200 pull requests, one has the reason `checks_timed_out`
   ([#1130](https://github.com/kamp-us/tea-fabrika/pull/1130), removed about 60 minutes after it was queued, when the
   timeout was presumably shorter). Why its check did not report is not known. The others: `merged` 373, `manual` 24,
   `failed_checks` 21, `merge_conflict` 9, `queue_cleared` 7, `stack_invalidated` 2.
2. **Anyone with write access can set it.** A fine-grained token or the lead's own `gh` token can post `review: success`
   on any SHA. The check run, made by a dedicated App, is the form the ruleset and the 2021-12-01 changelog are built to pin.
3. **It carries nothing.** The merge of main that `land.ts run` makes is a new SHA, so a status is gone.
4. **An admin still passes** (`land.ts merge --admin`, `admin`), and nothing records that they did.

### 5.2 The design

1. **A second GitHub App, `fabrika-review`.** Permission `checks: write` only (plus `metadata: read`, which is implied), no
   webhook, installed on this repository only. Its private key goes where the existing bot's key is (the keychain
   `botpush.mjs` reads), and is read only by the lead session. Why a second app: the existing bot pushes code. If one key
   both pushes and judges, the pin on the source means little. One key per duty also matches how the repo already keeps the
   lead key away from quest agents.
2. **Record the verdict** (new `land.ts review <pr>` step, lead-only, after the reviewer ends). It must check that the pushed
   head equals the code the reviewer read, then:
   ```
   POST /app/installations/{id}/access_tokens   { "repositories": ["tea-fabrika"], "permissions": { "checks": "write" } }   (Authorization: Bearer <app JWT>)
   POST /repos/kamp-us/tea-fabrika/check-runs
   {
     "name": "review", "head_sha": "<H>", "status": "completed", "conclusion": "success",   // or "failure"
     "started_at": "...", "completed_at": "...",
     "external_id": "<review run id>", "details_url": "<link to the review write-up>",
     "output": { "title": "Review passed at <H7>", "summary": "<3 plain lines>",
                 "text": "{\"schema\":1,\"head\":\"<H>\",\"base\":\"<main sha it was merged with>\",\"mergeBase\":\"<sha>\",
                           \"patchId\":\"<git patch-id --verbatim of mergeBase..H>\",\"plan\":\"<quest file blob>\",
                           \"reviewer\":{\"tool\":\"...\",\"model\":\"...\",\"session\":\"...\"},\"carriedFrom\":null}" }
   }
   ```
   Use `--verbatim` for the patch id: the default `git patch-id` ignores "all whitespace" and "line numbers"
   ([git-patch-id](https://github.com/git/git/blob/acba8bf9753134d9bde89f94369f775838a8c5fe/Documentation/git-patch-id.adoc), git at commit `acba8bf9753134d9bde89f94369f775838a8c5fe`),
   and a whitespace-only change matters in YAML and Makefiles. Never write `neutral` or `skipped` for a failed or missing review
   (section 2). Use `failure`.
3. **Read it back, from any process** (restart-safe):
   ```
   GET /repos/kamp-us/tea-fabrika/commits/<H>/check-runs?check_name=review&app_id=<review app id>&filter=latest
   ```
   `land.ts queue`, `arm`, `merge` and `admin` run this first and refuse when there is no `success` run, or when the head has
   moved and the carry rule below fails.
4. **Merge of main into the branch (no new code).** `land.ts run` already merges main in "as the bot, never a rebase" and
   stops on a conflict. After the push, with the new head `M`:
   - compute the patch id of `mergeBase(main, M)..M` and compare it with `patchId` in the record on the old head;
   - same: post a second `review` run on `M` with `"carriedFrom":"<H>"` and the same `patchId`, and the same `success`;
   - different: post nothing. The pull request needs a new review.
   This is Gerrit's `TRIVIAL_REBASE` rule (same diff, no conflict work), computed on the change's own diff. It is slightly
   looser than Gerrit's: Gerrit's rule counts context lines, and a patch id does not. The queue's own test run is the
   backstop, because it tests the merged result. This is the same `kept` rule decision 0066 already chose, and
   `.kalfa/quests/kalfa-git-diff-PLAN.md` already builds its comparison (`rangePatchId`), so the lead can ship the check first
   with `git patch-id --verbatim` and swap in `@kalfa/git` later.
5. **Enforce in CI where the queue is.** Add a step to `ci-required` in `.github/workflows/check.yaml`, on `merge_group` only:
   - find the pull request for the group: `repository.mergeQueue(branch: "main").entries { nodes { state headCommit { oid }
     pullRequest { number headRefOid } } }`, matched on `headCommit.oid == github.event.merge_group.head_sha`
     (GraphQL `MergeQueueEntry` has `headCommit`, `pullRequest`, `state`; that `headCommit` is the group's `head_sha` is my
     reading of the field's text, "The head commit for this entry", not a stated guarantee). Do not parse the branch name: GitHub documents only the
     prefix `gh-readonly-queue/{base_branch}`; the form `.../pr-<n>-<sha>` appears in this repo's test fixture
     (`.agents/skills/lead/scripts/ci-speed.test.ts`), not in GitHub's docs;
   - read the `review` run for `headRefOid` from the review app (`app_id` filter), require `conclusion == "success"`, and
     recompute the patch id in the runner (the `changes` job already checks out full history; `ci-required` would need the
     same checkout). Fail if it differs from the record;
   - give the job `checks: read`.
   On `pull_request` the same step only prints what it finds, so `ci-required` on the PR does not wait on the verdict's
   timing. The queue is the last checkpoint every path crosses: `queue`, `arm`/auto-merge, and the GitHub "Merge when ready"
   button.
6. **Ruleset changes.**
   - `merge_queue.grouping_strategy`: `HEADGREEN` to `ALLGREEN`. With `HEADGREEN` "only the commit at the head of the merge
     group ... must pass its required checks to merge" (REST `repository-rule-merge-queue`; ruleset docs). A gate that checks
     only its own pull request would let an earlier entry in a group with no verdict ride along. `ALLGREEN` makes "each item in
     the merge group" pass. Builds do not grow: the queue already builds one commit per entry up to `max_entries_to_build`.
   - Do **not** add `review` as a required context (section 5.1, point 1).
   - Bypass: move the admin role from `always` to `pull_request` ("an actor can only bypass rules on pull requests"; that
     "creat[es] a clear trail ... in the pull request and audit log"). Never use `exempt`: "rules will not be run for that
     actor and a bypass audit entry will not be created" (REST schema `repository-ruleset-bypass-actor`). `land.ts merge --admin` and `admin` refuse unless the
     verdict is there or the lead passes an explicit `--override-review "<reason>"`, which posts a `review` run with
     `conclusion: failure` and the reason in the text. Read the audit with
     `GET /repos/kamp-us/tea-fabrika/rulesets/rule-suites?rule_suite_result=bypass`.
7. **Size, a guess at about 50% sure:** about 5 files (a `pr/Review.ts` module and its test, `land.ts`, `check.yaml` with its
   workflow-lint test, the ruleset call), 300-400 lines, 3-4 agent hours, plus the App's creation by an org owner.

### 5.3 What we give up

- **One more App and key.** It needs an org owner to create and install it.
- **Late failure for a hand-queued PR.** A pull request put in the queue by hand without a verdict fails at the end of its
  queue run, not before. The `land.ts` preflight covers the paths we use, so the gate is the backstop, not the first line.
- **The gate is a workflow file.** For `merge_group`, `GITHUB_SHA` is "SHA of the merge group" (events table), so I read that
  the workflow comes from the queue's commit, which includes the pull request's own edits. A pull request that edits
  `check.yaml` could drop its own gate. That stops a mistake, not an attack. A rule that pulls a workflow from another
  repository exists only as an organization-level ruleset ("when you add this rule ... in your organization settings, you
  specify the source repository and the workflow"), which I did not check for our plan.
- **Admin bypass stays.** Sev work needs it. It becomes visible, not impossible.
- **GitHub's own stale-approval machinery.** We do the carrying ourselves.
- **A looser carry than Gerrit's** (patch id ignores context lines), covered by the queue's test run.

### 5.4 The simpler route to check first: a bot's PR approval

Ruleset: `required_approving_review_count: 1`, `dismiss_stale_reviews_on_push: true`. The review App posts
`POST /repos/{o}/{r}/pulls/{n}/reviews` with `event: APPROVE` and an explicit `commit_id`. GitHub then does the binding and the
stale-dismissal. It needs no workflow code, and the verdict is a first-class review object with a reviewer, a commit and a
time. Why it is not my pick: the docs do not say an App's approval counts, and two hints say it may not (section 2); the docs list "clicks **Update branch**" as a diff
change, so our own merge of main may dismiss it with no carry rule we control; the merge queue does not re-judge reviews on its
commit; and GitHub has no `kept` rule, which decision 0066 chose on purpose. If a scratch-repo test shows an App's approval
counts and survives a clean merge of main, this route is much cheaper and I would switch to it.

### 5.5 Confidence and what would change it

- **About 70% for the design as a whole.**
- **What would raise or change it:**
  - A scratch-repo test where an App's `APPROVE` counts toward the review count and survives a clean update-branch: switch to
    5.4.
  - A test that `integration_id` pinning accepts a status made by an App token: then a status is viable, and the only gain over
    a check run is less code. The deadlock and the missing carry rule remain.
  - An organization plan that offers required workflows: move the gate out of `check.yaml` so a pull request cannot edit it.
  - Fabrika's own queue ([decision 0034](../decisions/0034-fabrika-owns-the-merge-queue.md)) landing: the verdict then
    lives in that queue's state and this design collapses into it.

## 6. Added question: auto-merge and a push; a required status the queue never gets

The lead asked, because it decides whether the gate must live inside the required CI check (the design above) or in the merge
script.

Answers first:

- **Auto-merge and a push by someone with write access:** GitHub keeps auto-merge on, and then queues whatever the head is
  once the requirements are met. The docs are silent on this exact case. This repo's history shows it (17 pull requests).
- **A required status the merge group never gets:** it blocks the queue entry until the status-check timeout, then the entry
  is removed. The docs say so.
- **So the gate must run inside the `merge_group` run** (in `ci-required`), reading the pull request's verdict then. A gate in
  `land.ts` alone cannot cover auto-merge, the GitHub button, or a push after arming.

### 6.1 Auto-merge ("merge when ready") and a new commit

- **What the docs say.** "Auto-merge is disabled if someone without write permissions pushes new changes to the head branch or
  switches the base branch"
  ([automatically merging a pull request](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)).
  The 2021-03-22 changelog says the same ("auto-merge is now disabled automatically when new changes are pushed by a user
  without write access to the repository"), so that unreviewed changes cannot slip in after auto-merge is on. It adds that
  such users "can still update their pull requests to bring in changes from the base branch without having auto-merge
  disabled", unless the update causes merge conflicts
  ([changelog](https://github.blog/changelog/2021-03-22-updated-pull-request-auto-merge-behavior-for-users-without-write-access/)).
  Both are silent about a push by someone **with** write access. Inferred from the sentence's shape: auto-merge stays on.
  On a branch that needs a merge queue, "Merge when ready" turns on auto-merge for a pull request that cannot be queued yet, "and adds the pull request to the queue when requirements are met" (merge queue page).
- **What the arm call pins.** `enablePullRequestAutoMerge` takes `expectedHeadOid` ("The expected head OID of the pull
  request", GraphQL schema). `.agents/skills/lead/scripts/pr/PullRequestsGh.ts` (the `ARM` constant) passes it, and says it
  "pins it to the head that was checked, so a push after the check leaves it off". That is right for a push between the check
  and the call. It says nothing about a push after the call.
- **Observed in this repo.** I read the auto-merge and queue events of the newest 1,200 pull requests through GraphQL
  (`timelineItems`). 184 had auto-merge events. The only reasons GitHub gave for the 25 disable events were "Manually disabled
  by user" (19) and "Pull request was converted to draft" (6). **No event says a push disabled auto-merge.** Of the 182
  that had an enable event (leaving out 5 whose timelines run past 100 items), 17 had a commit made after the last enable
  event and no disable event of any kind, and all 17 merged. I read "commit made after" from the commit's own date, so the
  push came after the enable.
  - [#2016](https://github.com/kamp-us/tea-fabrika/pull/2016): auto-merge on at 09:16:20Z on 2026-11-23; three more commits
    after that (two by the bot app, one by the owner's account); queued at 09:51:53Z; merged at 10:09:46Z with head `c68a4a9`,
    the last commit. Inferred: the arm call pinned the head read when it ran, which was an earlier commit. **So the pin did
    not stop the later commits from merging.**
  - [#1290](https://github.com/kamp-us/tea-fabrika/pull/1290): removed from the queue for `merge_conflict` at 01:38Z, auto-merge
    turned on again a minute later, a new commit four minutes after that, queued at 01:54Z, merged at 01:58Z.
    [#1247](https://github.com/kamp-us/tea-fabrika/pull/1247): removed for `queue_cleared`, a new commit about 17 hours later,
    queued again about four hours after that by the auto-merge that was still on (no second enable event), merged a minute later.
  - Limits: these are pushes by people with write access (the owner and the bot app). I did not check that each pull request
    got a fresh green run on its new head before it was queued; I read that the queue's entry came after the commit, not
    what it tested. I did not find a GitHub-staff written answer to this question (community threads I read have no staff
    badge); the docs and changelog above are the staff answer.
- **So:** GitHub keeps auto-merge on and queues whatever the head is when the requirements are met. Any gate must therefore
  be re-checked **when the head is merged**, not when auto-merge was armed.

### 6.2 A required status the merge group never receives

- **Yes, it blocks, and it times out.** "A merge queue will wait for required checks to be reported before it can proceed with
  merging. You must update your CI configuration to trigger and report on merge group events when requiring a merge queue."
  The Actions note: "Otherwise, status checks will not be triggered when you add a pull request to a merge queue. The merge
  will fail as the required status check will not be reported"
  ([managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
  The queue's commit is not the pull request's: the temporary branches "contain a different `sha` from the pull request"
  (same page, third-party CI section).
- **The timeout.** "Status check timeout (minutes): Maximum time for a required status check to report a conclusion. After this
  much time has elapsed, checks that have not reported a conclusion will be assumed to have failed"
  ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
  A listed removal reason is "Timed out awaiting a successful CI result based off the configured timeout setting". Our ruleset's
  value is 180 minutes (maximum 360, REST schema). The entry's GraphQL state while it waits is `AWAITING_CHECKS` ("The entry is
  currently waiting for checks to pass"). Observed in this repo: one removal with the reason `checks_timed_out`
  ([#1130](https://github.com/kamp-us/tea-fabrika/pull/1130), 60 minutes after it was queued). I do not know why its check did
  not end, so it is a sign, not proof.
- **Community reports match.** Threads
  [#39933](https://github.com/orgs/community/discussions/39933) and
  [#15254](https://github.com/orgs/community/discussions/15254) show the same symptom, fixed by adding `merge_group`. In
  [#103114](https://github.com/orgs/community/discussions/103114) people describe the required checks as "tightly coupled" between
  pull request and queue, and one team posts a fake `success` for pull-request-only checks when the build runs on the queue
  branch. None of the repliers I saw is marked GitHub staff, so I use them only as signs of the same behavior.
- **What GitHub says can be posted on the queue's commit.** The `merge_group` payload has `head_sha`, `head_ref`, `base_sha`,
  `base_ref`, `head_commit`; status is reported on `head_sha` "using check runs or commit statuses"
  (changelog 2022-08-18; REST schema `merge-group`). Only workflows that list `merge_group` run. The workflow-run table gives
  `GITHUB_SHA`: "SHA of the merge group"
  ([events table](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)).
- **A second trap with grouping.** With `HEADGREEN` (our setting) "only the commit at the head of the merge group ... must
  pass its required checks". A per-pull-request gate in an earlier entry would be ignored if the head entry is green.
- **So:** a required `review` context nobody posts on queue commits stalls the queue. A gate has to be reported by something
  that runs on `merge_group`, and that something has to look up the verdict of each pull request in the group. Our `ci-required` is
  that something; and the verdict is read, not required as its own context.

## What this research cannot tell us

- **Nothing was run on a test repository.** Open: whether an App's `APPROVE` counts as a required review; whether a clean
  merge of main into a branch dismisses a stale approval when main's changes do not touch the pull request's files; whether a
  push to a queued pull request removes it from the queue (the docs are silent, and this repo's history has no case); whether
  `integration_id` pinning accepts a commit status made by an App token.
- **GitHub-staff answers.** I found none beyond the docs and changelogs. The community threads I read have no staff badge.
  The one report of a support answer (a stuck queue; a user says GitHub "confirmed the issue via mail") is second-hand.
- **The observation in 6.1 is one repo, one bot, two writers.** It shows what GitHub did for them. It does not show
  what GitHub does for a pusher without write access (the docs cover that) or for another plan or org setting.
- **The queue's workflow source.** I read from the events table that a `merge_group` run uses the queue commit's workflow
  file, which would include a pull request's own edits to it. No page says it outright.
- **The branch name `gh-readonly-queue/main/pr-<n>-<sha>`.** Only the prefix is documented. The rest comes from this repo's
  test fixture.
- **Required workflows.** I read that GitHub's "require workflows" rule is set in an organization ruleset. I did not check
  our organization's plan or whether the rule exists for it.
- **Chromium and bors.** I read Chromium's Gerrit config and CV's config proto and docs, not CV's code. I do not know the members of the
  Gerrit groups that hold `submit`. I did not read bors's `pr_events.rs`; the earlier research file did. bors-ng is archived,
  so its docs describe a tool that is no longer developed.
- **Zuul's and bors's own guard against a side path** (who may push to main outside them) is not in the docs I read.
- **The size guess in 5.2** (files, lines, hours) is mine, not measured.
- **Workflow token rights.** I did not check which permissions the workflow's token needs to read `mergeQueue` entries
  through GraphQL, or whether `merge_group` runs may read them at all.
- **Whether `headCommit` of a queue entry equals the `merge_group` event's `head_sha`.** I read it from the field's
  description, not from a run.
- **Audit-log REST access.** I found the org audit-log events list but not its REST endpoint in the github.com API description;
  I do not know if our plan can read it by API. The rule-suites endpoint is in the description.

## Sources

Read on 2026-11-26. Code and config were read at the commit named.

- GitHub docs, `github/docs` at `df6faa250dc425fa137d270c967e6a74f12103a7`, pages cited by their docs.github.com address:
  about protected branches, available rules for rulesets, about rulesets, managing a merge queue, merging a pull request with a
  merge queue, automatically merging a pull request, troubleshooting required status checks, status checks reference, events
  that trigger workflows (`merge_group`), and the reusable snippets
  `data/reusables/pull_requests/security-changes-mergeability.md`,
  `data/reusables/repositories/rulesets-branch-tag-bypass-optional-step.md`,
  `data/reusables/repositories/about-ruleset-insights.md`, `data/reusables/pull_requests/merge-queue-removal-reasons.md`,
  `data/reusables/actions/merge-group-event-with-required-checks.md`;
  permissions data `src/github-apps/data/fpt-2026-03-10/*-permissions.json`; audit events `src/audit-logs/data/fpt/organization.json`.
  https://github.com/github/docs/tree/df6faa250dc425fa137d270c967e6a74f12103a7
- GitHub REST API description, `github/rest-api-description` at `d560905bbf50d79e40d6a006ce2e5834cfd86a31`
  (`descriptions/api.github.com/api.github.com.json`): create a commit status, create a check run, list check runs for a git
  reference, create a review, dismiss a review, branch protection `checks[].app_id`, ruleset rules `required_status_checks`,
  `merge_queue`, `pull_request`, rule suites, the `merge-group` webhook schema.
  https://github.com/github/rest-api-description/tree/d560905bbf50d79e40d6a006ce2e5834cfd86a31
- GitHub GraphQL schema: https://docs.github.com/public/fpt/schema.docs.graphql (`EnqueuePullRequestInput`,
  `EnablePullRequestAutoMergeInput`, `AutoMergeDisabledEvent`, `MergeQueueEntry`, `MergeQueueEntryState`, `Repository.mergeQueue`).
- GitHub changelog: https://github.blog/changelog/2021-03-22-updated-pull-request-auto-merge-behavior-for-users-without-write-access/ ,
  https://github.blog/changelog/2021-12-01-ensure-required-status-checks-provided-by-the-intended-app/ ,
  https://github.blog/changelog/2022-08-18-merge-group-webhook-event-and-github-actions-workflow-trigger/
- GitHub community discussions (not staff): https://github.com/orgs/community/discussions/39933 ,
  https://github.com/orgs/community/discussions/15254 , https://github.com/orgs/community/discussions/103114
- GitHub CLI, `cli/cli` at `aec38089147ae38264668843fa6126022c56a0e4`: `pkg/cmd/pr/merge/merge.go`, `http.go`.
- Gerrit, `gerrit` at `04d1e46fcb76287a9bbd88e383536858cee99200`: `Documentation/config-labels.txt`,
  `config-submit-requirements.txt`, `rest-api-changes.txt`, `access-control.txt`.
  https://gerrit.googlesource.com/gerrit/+/04d1e46fcb76287a9bbd88e383536858cee99200/Documentation/
- Chromium: `chromium/src` `refs/meta/config` at `b3185e09d60e4cc5f105e99d53c76554637a5abc`, parent project `chromium`
  `refs/meta/config` at `39b7438eeadf69d95880a80144c466adfc7bb220`, and `docs/infra/cq.md` at
  `e9b0904d8ceeb564b92fd72fd4a7164491bcd142`; LUCI CV config in `luci-go` at `62309806c3d7943a2769799fe1e76dcb31a0c07e`
  (`cv/api/config/v2/config.proto`, `cv/README.md`).
- Zuul, `zuul/zuul` at `898b7ab13fa6f422aad39a0f2c3be4d0caa26ffc`: `doc/source/config/pipeline.rst`,
  `doc/source/drivers/gerrit.rst`, `doc/source/drivers/github.rst`,
  `doc/source/examples/pipelines/gerrit-reference-pipelines.yaml`.
- Rust's bors, `rust-lang/bors` at `e151373c5cc70086904e80262a224f6506accaab`: `docs/design.md`, `README.md`,
  `src/bors/merge_queue.rs`, `src/bors/handlers/review.rs`, `migrations/20250311143621_add_approved_sha_to_pr.up.sql`.
  bors-ng at `ca725797e53a88e954998de0bbb14a8a5acb13ab` (archived) and https://bors.tech/documentation/.
- SLSA, `slsa-framework/slsa` at `b2d82a4ee232f7a85d7311bcfe54cfa3ccdd500c`: `spec/source-requirements.md`.
- Git, `git/git` at `acba8bf9753134d9bde89f94369f775838a8c5fe`: `Documentation/git-patch-id.adoc`.
- This repo, at `origin/main` commit `f6c873bc3` and the live ruleset: `.agents/skills/lead/scripts/land.ts`,
  `.agents/skills/lead/scripts/pr/PullRequestsGh.ts`, `.agents/skills/lead/scripts/botpush.mjs`,
  `.agents/skills/lead/scripts/ci-speed.test.ts`, `.github/workflows/check.yaml`,
  `.kalfa/decisions/0034-fabrika-owns-the-merge-queue.md`,
  `.kalfa/decisions/0066-deliverys-defaults-follow-github-then-gerrit-and-each-is-a-setting.md`,
  `.kalfa/quests/kalfa-git-diff-PLAN.md`; the earlier research on the branch `research/merge-queue-defaults`
  (`.kalfa/research/merge-queue-defaults.md`); the pull request histories read through GraphQL on 2026-11-26.

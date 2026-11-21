---
summary: What GitHub Actions says about starting a build of one exact commit (workflow_dispatch versus pushing a ref, head_sha, return_run_details), holding a run until an app admits it (environments with custom deployment protection rules), how a timed-out or canceled job and run are reported and who canceled, and what concurrency groups and account limits do with waiting runs; every claim cited, gaps marked
---

# How GitHub Actions builds one exact commit, holds it until admitted, and says how it ended

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1801): four groups of facts that CI's protocol
(https://github.com/kamp-us/tea-fabrika/issues/1756) waits on for its `@kalfa/ci/github` entry point.

1. Starting a build of an exact commit, so GitHub's check marks land on that commit.
2. Holding a run the host started until an app admits it, so it does not take a slot it was not given.
3. How a job and a run that ended by time limit or cancel are reported, and whether a cancel says who did it.
4. What a concurrency group and the account limits do with waiting runs.

Read on 2026-11-21 from the pages and files linked on each line. A line marked "my reading" is mine, not a source's
claim. A line marked **Unconfirmed** has no primary source that says it outright. Only GitHub's own documents count as
primary: its docs, its changelog, its published REST API description, and the source of its runner. Where I cite a
third party, I say so. Our repo is public and on an organization account. Plan and repo-kind differences are called
out where a source gives them. I started no workflow and ran nothing against a real repo.

## The short answer

1. **A `workflow_dispatch` run builds the tip of the ref you give it, never a bare SHA.** The API takes only a branch or
   tag name in `ref`. The run's `head_sha` is the last commit on that ref, and its check runs carry that SHA. **But
   GitHub's own troubleshooting page says checks from a `workflow_dispatch` run do not show in the pull request's
   checks and do not satisfy a required status check in a ruleset.** Only runs from `push`, `pull_request`,
   `pull_request_review`, `pull_request_target`, `deployment` and `deployment_status` do. So for marks that count on a
   pull request, pushing a ref at the commit (create it with `POST /git/refs`, using an App token and not
   `GITHUB_TOKEN`) is the better start. For marks that only need to sit on the commit, dispatch works. About 80% sure.
   - `return_run_details` is real but already on its way out. With API version `2022-11-28`, pass `true` and get `200`
     with `workflow_run_id`, `run_url`, `html_url` (no SHA). With `2026-03-10` the parameter is gone and the answer is
     always `200` with those three fields.
2. **Yes, an app can hold a run with no runner until it admits the run.** The tool is a custom deployment protection
   rule: a GitHub App on an environment. A job that names the environment does not start until the app approves or
   rejects. It is open to public repos on every plan, and to private or internal repos only on GitHub Enterprise. It is
   in public preview. The app has up to 30 days to answer; then the job fails. About 75% sure. **Unconfirmed:** that a
   waiting job uses no runner at all, what the pull request shows, and whether a waiting run holds a concurrency slot.
3. **A job that runs past `timeout-minutes` is probably reported `cancelled`, and so is its run, not `timed_out`.**
   GitHub's docs only say "cancels it". GitHub's runner source has no timed-out result at all. Two third-party reports
   of a real test agree: job, check run and run all `cancelled`. **No primary source says who canceled.** The run, job
   and check-run objects have no such field. The only primary trace is an owner-only audit-log event for a person's or
   token's cancel. About 70% sure on `cancelled`; about 90% sure that no cancel actor is in the API.
4. **Default: one running and one waiting run per concurrency group, and a new arrival replaces the waiting one, which
   is canceled.** With `queue: max`, up to 100 wait, first in first out, and the 101st is canceled. Plan limits: 20, 40,
   60 or 500 jobs at once on standard hosted runners (Free, Pro, Team, Enterprise), and only 5 at once on macOS except
   Enterprise (50). A run lives 35 days at most, waiting included. About 90% sure; the docs are clear here.

## 1. Starting a build of an exact commit

### What `workflow_dispatch` takes and records

- The endpoint is `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`. The body has `ref`
  (required), `inputs` (at most 25 properties), and, in API version `2022-11-28` only, `return_run_details`. `ref` is
  described as "The git reference for the workflow. The reference can be a branch or tag name."
  ([REST API description, version 2022-11-28](https://github.com/github/rest-api-description/blob/c9c95fe34ced05fe076001f5c55704742bc8e7f8/descriptions/api.github.com/api.github.com.2022-11-28.json),
  path `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`;
  [REST docs](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).)
  There is no `sha` field. A bare SHA is not a documented value. **Unconfirmed:** what the API answers to a SHA in
  `ref`. My reading is a `422`.
- GitHub's table of events says that for `workflow_dispatch`, `GITHUB_SHA` is "Last commit on the `GITHUB_REF` branch
  or tag" and `GITHUB_REF` is "Branch or tag that received dispatch"
  ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)).
- The run object's `head_sha` is "The SHA of the head commit that points to the version of the workflow being run".
  A job's `head_sha` is "The SHA of the commit that is being run". A check run's `head_sha` is "The SHA of the commit
  that is being checked" (schemas `workflow-run`, `job` and `check-run` in the REST API description above, version
  `2026-03-10`). So the run's check runs carry the tip SHA the ref had when GitHub read it.
- **Unconfirmed: when GitHub reads the ref's tip.** The docs say "last commit on the ref" and not "at the moment you
  called". If the ref moves between your call and the run's creation, the run could build a newer commit. A ref that
  only the host writes (see "Starting by pushing a ref" below) has no such race.
- **Unconfirmed: which version of the workflow file runs.** Three hints, none outright:
  - the run's `path` example is `octocat/octo-repo/.github/workflows/ci.yml@main`, and `github.workflow_ref` has the
    example `.../my-workflow.yml@refs/heads/my_branch`;
  - `github.workflow_sha` is "The commit SHA for the workflow file"
    ([contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context));
  - the docs also say "This event will only trigger a workflow run if the workflow file exists on the default branch",
    and "Once a workflow has run at least once, you can dispatch it against any branch or tag via the GitHub API or
    GitHub CLI" ([same events page](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)).
  My reading: the file at the ref's tip runs, provided the workflow also exists on the default branch. A small test
  below settles it.

### Do its check runs count?

- The check runs land on the SHA. That part is plain from `head_sha`.
- **But they may not count anywhere that matters.** GitHub's troubleshooting page for required checks says: "if a
  workflow is triggered by `workflow_dispatch` on a pull request's head branch, checks reported by its jobs do not
  appear in the pull request's checks section. Even if the checks pass for the head commit, they do not satisfy a
  required status check in a branch ruleset." The eligible events are `push`, `pull_request`, `pull_request_review`,
  `pull_request_target`, `deployment` and `deployment_status`. The limit "applies only to checks created by workflow
  jobs, not to checks created by an external GitHub App"
  ([troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated)).
- Same page, two more rules: a required check "must have completed successfully in the chosen repository during the
  past seven days", and it must pass "on the latest commit SHA. Checks from earlier commits don't satisfy the
  requirement".
- My reading: if `@kalfa/ci` needs the mark to gate a merge, `workflow_dispatch` alone is not enough. Two ways around
  it: start the run through an eligible event (below), or have the app post its own check run through the Checks API
  (the page says app-made checks are not restricted). The second is a different design, so I did not read the Checks
  API further.

### What `return_run_details` gives back

- API version `2022-11-28`: optional boolean. Without it (or `false`) the answer is `204` with no body. With `true`
  the answer is `200` and the body is `workflow_run_id`, `run_url`, `html_url`; all three are required fields
  ([REST API description, 2022-11-28](https://github.com/github/rest-api-description/blob/c9c95fe34ced05fe076001f5c55704742bc8e7f8/descriptions/api.github.com/api.github.com.2022-11-28.json);
  schema `workflow-dispatch-response`).
- API version `2026-03-10`: GitHub lists a breaking change, "Change workflow dispatch response from `204` to `200` with
  workflow run details. Removes the `return_run_details` parameter. The endpoint now always returns `200` with the
  workflow run details in the response body"
  ([REST API breaking changes](https://github.com/github/rest-api-description/blob/c9c95fe34ced05fe076001f5c55704742bc8e7f8/descriptions/api.github.com/CHANGELOG.md)).
- The changelog entry of 2026-02-19 announces the parameter and says the response has "the workflow ID, API URL, and
  workflow URL". The schema says run ID, not workflow ID. Trust the schema; the changelog wording is loose
  ([changelog](https://github.blog/changelog/2026-02-19-workflow-dispatch-api-now-returns-run-ids/)).
- The reply has no SHA. To check the build is of the commit you meant, read the run
  (`GET /repos/{owner}/{repo}/actions/runs/{run_id}`) and compare `head_sha`.
- Which version applies with no version header: the docs say an unversioned request "default[s] to the next oldest
  supported version, not the closing down version", and versions "are supported for 24 months after a newer API
  version is released" ([API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)). The page does
  not print the current default. My reading: always send `X-GitHub-Api-Version` explicitly. By the 24-month rule,
  `2022-11-28` stays usable until about March 2028 (my arithmetic from the `2026-03-10` release name).
  **Unconfirmed:** whether `2026-03-10` ignores or rejects an old `return_run_details` in the body.

### Starting by pushing a ref instead

- `POST /repos/{owner}/{repo}/git/refs` takes a full `ref` (such as `refs/heads/name`) and a `sha`, and answers `201`
  ([REST API description](https://github.com/github/rest-api-description/blob/c9c95fe34ced05fe076001f5c55704742bc8e7f8/descriptions/api.github.com/api.github.com.2026-03-10.json),
  path `/repos/{owner}/{repo}/git/refs`). It takes any commit SHA, so the host can name the exact commit.
- The `create` event is documented as the one a new ref fires, and the page names this API: `GITHUB_SHA` is "Last
  commit on the created branch or tag" ([create event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#create)).
  The `push` event's `GITHUB_SHA` is "Tip commit pushed to the ref", and it "includes workflows that are not merged
  into the default branch" ([push event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)).
  **Unconfirmed:** whether creating a ref through the REST API fires `push` workflows (the page for `push` talks about
  pushing). I expect yes, but I have no primary source. A test below settles it.
- Why it is better, my reading, with the cited parts marked:
  - `push` is an eligible event for pull request checks and rulesets (cited above).
  - A fresh ref name that only the host writes cannot move under the run, so the commit is exact.
  - The run reads the workflow file at that commit (the `push` text says it also runs workflows not on the default
    branch).
- What it costs:
  - Every workflow with `on: push` whose filters match the new ref also starts. That is extra builds.
  - Refs pile up unless the host deletes them. Deleting a branch fires a `push` event whose SHA "reverts to the default
    branch of the repository" (push event page above). That is about the delete event, not the finished run.
  - Limits: "Events will not be created if more than 5,000 branches are pushed at once. Events will not be created for
    tags when more than three tags are pushed at once" (push page), and "An event will not be created when you create
    more than three tags at once" (create page). Use branches, not tags.
  - **Token rule.** "Events triggered by the `GITHUB_TOKEN` will not create a new workflow run", with
    `workflow_dispatch` and `repository_dispatch` as the only always-allowed exceptions
    ([GitHub's wording](https://github.com/github/docs/blob/d7487f5debb5a5a2a6e65e6f9fa539266f5f8db6/data/reusables/actions/actions-do-not-trigger-workflows.md),
    shown on [triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
    So the host must make the ref with a GitHub App installation token or a personal token. A ref made by a running
    workflow with `GITHUB_TOKEN` starts nothing.
  - The `pull_request` event is a third route. Its `GITHUB_SHA` is the merge commit, not the PR head
    ([events page](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)),
    so it is a worse fit for "this exact commit".
- Dispatch costs a request and needs a ref too, so neither way builds a SHA that no ref points to.

## 2. Holding a run until an app admits it

### The feature

- GitHub: "You can enable your own custom protection rules to gate deployments with third-party services"
  ([about custom rules](https://github.com/github/docs/blob/d7487f5debb5a5a2a6e65e6f9fa539266f5f8db6/data/reusables/actions/about-custom-deployment-protection-rules.md)).
- A rule is a GitHub App. Once installed on the repo and enabled on an environment, it runs "every time a workflow step
  targets that environment" ([configure custom rules](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/configure-custom-protection-rules)).
  General rule: "When a workflow job references an environment, the job won't start until all of the environment's
  protection rules pass" ([deploying with Actions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments#using-environments)).
- When a job reaches the environment, GitHub sends a `deployment_protection_rule` webhook to the app. Its schema has
  `environment`, `event`, `sha`, `ref`, `deployment_callback_url`, `deployment`, `pull_requests`, `repository`,
  `organization`, `installation`, `sender` (schema `webhook-deployment-protection-rule-requested` in the
  [REST API description](https://github.com/github/rest-api-description/blob/c9c95fe34ced05fe076001f5c55704742bc8e7f8/descriptions/api.github.com/api.github.com.2026-03-10.json)).
  So the app is told which commit it is deciding on.
- The app answers with `POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule` and a body of
  `environment_name`, `state` (`approved` or `rejected`) and an optional `comment`; the reply is `204`. Leave `state`
  out to post a status note instead (then `comment` is required). A note is Markdown, up to 1024 characters, up to 10
  per deployment ([create custom rules](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/create-custom-protection-rules#approving-or-rejecting-deployments);
  [REST docs](https://docs.github.com/en/rest/actions/workflow-runs#review-custom-deployment-protection-rules-for-a-workflow-run)).
  An app "can only review their own custom deployment protection rules", not a person-review wait (same REST docs).
- The app needs Actions read and Deployments read and write permission, and the "Deployment protection rule" event
  (create custom rules page above).
- It is scoped per job. A job with no `environment:` is not held. My reading: put the environment on a first small job
  and make every other job `needs:` it. That gate job still takes a runner for a moment after it is approved.
- A job with `deployment: false` and a custom rule on its environment "will fail immediately" (deploying with Actions
  page above). That page's section is flagged for a newer feature, so check it again before using `deployment: false`.

### Plans and repo kinds

- "Custom deployment protection rules are available in public repositories for all plans. For access to custom
  deployment protection rules in private or internal repositories, you must use GitHub Enterprise"
  ([availability text](https://github.com/github/docs/blob/d7487f5debb5a5a2a6e65e6f9fa539266f5f8db6/data/reusables/actions/custom-deployment-protection-rules-availability.md);
  repeated for Free, Pro and Team in the
  [deployments and environments reference](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#custom-deployment-protection-rules)).
- Our repo is public, so this works on any plan for it. If it ever goes private, it needs Enterprise.
- The feature is in public preview and "subject to change" (same reference page). At most 6 rules can be enabled on an
  environment at a time; any number of apps can be installed.

### Does a waiting run use a runner?

- The docs say the job "won't start" until the rules pass. A check run in this state has status `waiting`: "The check
  run is waiting for a deployment protection rule to be satisfied", and only Actions can set it
  ([status checks](https://docs.github.com/en/pull-requests/reference/status-checks#check-statuses-and-conclusions)).
  The REST job status list has `waiting`, and a job's `runner_name` is null until a runner is assigned (schema `job`).
- A wait timer's wait "will not count towards your billable time" (deployments and environments reference). Workflow
  runs may wait up to 30 days on gates, and that time counts in the 35-day run limit (limits page, section 4).
- **Unconfirmed:** that a waiting job holds no runner and no slot in the plan's concurrent-job count. Every sentence
  above points that way, but none says "no runner". A test below settles it.

### How long can it wait?

- "When a custom deployment protection rule is triggered it will wait for up to 30 days for a webhook event response
  before it times out and the workflow job fails" (configure custom rules page above).
- The overall run limit is 35 days, which "includes execution duration, and time spent on waiting and approval"; "Gate
  approval time" is 30 days ([Actions limits](https://docs.github.com/en/actions/reference/limits)).
- **Unconfirmed:** what conclusion that failed job gets (`failure` or `cancelled`).

### What the pull request shows

- The text docs only say what the check statuses mean. In a pull request, a check in `waiting` is a check not yet
  passed; "If status checks are required ... they must pass before the pull request can be merged"
  ([status checks](https://docs.github.com/en/pull-requests/reference/status-checks)). The deployment reference says
  environments' rules "are surfaced alongside your other checks"
  ([deploying code](https://docs.github.com/en/pull-requests/concepts/deploying-code#connecting-merges-to-deployment)).
- The docs do not describe the pull request's wording or look for a waiting custom rule. **Unconfirmed.** And if the
  run was started by `workflow_dispatch`, its checks do not show on the pull request at all (section 1).

### The way around the gate

- By default "administrators can bypass the protection rules and force deployments". A "Start all waiting jobs"
  button does it, while a job is pending. You can switch bypass off per environment
  ([review deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments#bypassing-deployment-protection-rules)).
  On Free, Pro and Team, that switch is available only for public repos (deployments and environments reference).
- My reading: if the gate must hold, turn bypass off.

### Other ways to hold a run

- **Required reviewers.** Up to 6 people or teams; one approval is enough. Free, Pro and Team: public repos only. An
  app cannot approve these. (Deployments and environments reference.)
- **Wait timer.** 1 to 43,200 minutes (30 days), not billed. Same page. It holds for time, not for a decision.
- **Concurrency group.** A new run waits as `pending` behind a running one (section 4). That holds a run behind
  another, not until someone admits it.
- **A runner that is not there.** On self-hosted runners, "A job can be in the queue for 24 hours before it is
  automatically cancelled" (limits page). Not a gate.
- **Not starting it.** The host can hold the request itself and call the API only when a slot is free. My reading: this
  is the simplest hold and needs no GitHub feature. It is the way if the gate's open questions (runner use, concurrency
  slot) come back wrong.

## 3. How a run or job ends

### What the docs say about time limits

- A job: `jobs.<job_id>.timeout-minutes` is "The maximum number of minutes to let a job run before GitHub
  automatically cancels it. Default: 360". If it is longer than the runner's limit, "the job will be canceled when the
  execution time limit is met instead" ([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes)).
- A step: `steps[*].timeout-minutes` is "The maximum number of minutes to run the step before killing the process".
  Maximum 360 (workflow syntax, steps section).
- System limits, in the limits page: "Unless otherwise stated, the expected behavior when a limit is reached is that the
  workflow/job will get cancelled." The table then says a GitHub-hosted job over 6 hours "is terminated and fails", a
  self-hosted job over 5 days "is terminated and fails", a run over 35 days "is cancelled", and a self-hosted job
  queued over 24 hours "is automatically cancelled" ([Actions limits](https://docs.github.com/en/actions/reference/limits)).
  The page mixes "cancelled" and "fails", so a time limit alone does not tell you which word the API uses.

### What the values can be

- Job `conclusion`: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`.
  Check run `conclusion`: the same seven. Job `status`: `queued`, `in_progress`, `completed`, `waiting`, `requested`,
  `pending` (schemas `job` and `check-run`, REST API description version `2026-03-10`).
- The run's `status` and `conclusion` are typed as plain strings. The run-list filter accepts the union: `completed`,
  `action_required`, `cancelled`, `failure`, `neutral`, `skipped`, `stale`, `success`, `timed_out`, `in_progress`,
  `queued`, `requested`, `waiting`, `pending` (parameter `workflow-run-status`).
- The status-checks page defines `timed_out` as "The check run timed out" and `cancelled` as "The check run was
  cancelled before it completed" (status checks page above). It does not say when Actions uses each.

### What GitHub's runner does (primary, but only half the story)

I read the runner's source at commit `7e211dc69c347b78fc398e630e74facb11a13235` of `actions/runner`.

- Its job and step result type has six values: `Succeeded`, `SucceededWithIssues`, `Failed`, `Canceled`, `Skipped`,
  `Abandoned`. No timed-out value (`src/Sdk/DTWebApi/WebApi/TaskResult.cs`).
- A **step's own** timeout: the step's result is set to `Failed`, with the error "The action '...' has timed out after N
  minutes" (`src/Runner.Worker/StepsRunner.cs`). A cancel that comes from the job gives the step `Canceled`.
- A **job's** timeout is not in the runner: `src/Runner.Worker/JobRunner.cs` has no timeout logic. The runner is sent a
  cancel message by the server (`JobDispatcher.cs`, "Job cancellation request ... received"), and the runner's own
  comment says "server owns the job level issue". My reading: the server cancels the job at the limit, the job's steps
  end `Canceled`, and the job ends `cancelled`. **The server's code is closed, so the final label is Unconfirmed.**
- The cancel itself, per GitHub's cancellation reference: the server re-checks `if` conditions, so `always()` jobs and
  steps keep going; the runner sends `SIGINT`, waits 7,500 ms, sends `SIGTERM`, waits 2,500 ms, then kills the process
  tree; "After the 5 minute cancellation timeout period" the server forcibly ends what is left
  ([workflow cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation)).
  A force-cancel endpoint skips `always()` (`POST .../actions/runs/{run_id}/force-cancel`, REST API description).
  Both cancel endpoints answer `202`, or `409` if it cannot be done.

### What third parties saw (secondary, a real test, not GitHub's word)

- A controlled test: one job with `timeout-minutes: 1` and a two-minute sleep. Its job concluded `cancelled`, its check
  run concluded `cancelled`, and its workflow run concluded `cancelled` even though the run's other jobs succeeded. No
  `timed_out` appeared anywhere. The annotations were `The job has exceeded the maximum execution time of 1m0s`, then
  `The operation was canceled.`
  ([issue report](https://github.com/combsmith/software-factory/issues/388), 2026-10-29).
- A second project reports the same: a job past its own `timeout-minutes` is reported `cancelled`, and nothing in the
  line tells it from a concurrency or label cancel
  ([issue report](https://github.com/jig-harness/jig/issues/1610), 2026-11-19).
- A blog author sees that a manual cancel leaves an annotation "The run was canceled by" plus a user name, and a
  timeout leaves "has exceeded the maximum execution time of". The author says the texts may change
  ([post](https://zenn.dev/snowcait/articles/ecf458c1cb3811)).
- A concurrency replacement is said to leave "Canceling since a higher priority waiting request for '...' exists"
  (seen in public run pages; I found no GitHub document with this text). **Unconfirmed.**
- The first report also says a step's own timeout may end the job `failure`, not `cancelled`, but its trial was still
  pending. The runner source above supports that for the step; for the job it is **Unconfirmed**.

### Does a cancel say who did it?

- The run object has `actor` ("the user that triggered the initial workflow run") and `triggering_actor` (who started or
  re-ran it), not who canceled ([contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context);
  schema `workflow-run`). Job and check-run objects have no cancel field. The cancel endpoint replies `202` with no
  body. The webhook's job schema lists no cancel field either (I checked `workflow_job` parameters).
- The one primary trace: the organization audit log has an event `workflows.cancel_workflow_run` ("A workflow run was
  cancelled") with fields such as `actor`, `actor_is_bot`, `programmatic_access_type`, `token_id`, `workflow_run_id`,
  `cancelled_at` ([audit log data](https://github.com/github/docs/blob/d7487f5debb5a5a2a6e65e6f9fa539266f5f8db6/src/audit-logs/data/fpt/organization.json)).
  Limits: "Only owners can access an organization's audit log", it covers the last 180 days, and the REST audit-log
  endpoint is shown for Enterprise Cloud, not Free or Team (the endpoint is not in the public API description I read)
  ([reviewing the audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization)).
  So it helps a person after the fact, but a library cannot depend on it.
- My reading, given the above. To tell "ran past its time limit" from "someone canceled it", do not rely on the label.
  The facts that are not text:
  - the host knows every cancel it sent itself, and every concurrency setting it wrote;
  - a job's `started_at` and `completed_at` against its `timeout-minutes` (a late manual cancel looks the same, as the
    blog notes);
  - or make the limit visible: set a step `timeout-minutes` shorter than the job's, so a hang ends as a step `Failed`
    and a job `failure` (step part confirmed by the runner source, job part Unconfirmed), and set the job limit as a
    backstop.

## 4. Concurrency groups and limits

### What a group does

- "There can be at most one running job or workflow in a concurrency group at any time. When a concurrent job or
  workflow is queued, if another job or workflow using the same concurrency group in the repository is in progress, the
  queued job or workflow will be `pending`. By default, any existing `pending` job or workflow in the same concurrency
  group will be canceled and the new queued job or workflow will take its place."
  ([GitHub's text](https://github.com/github/docs/blob/d7487f5debb5a5a2a6e65e6f9fa539266f5f8db6/data/reusables/actions/actions-group-concurrency.md),
  shown on [controlling concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).)
- `cancel-in-progress: true` also cancels the running one. It can be an expression.
- `queue: single` is the default. `queue: max` lets "up to 100 jobs or workflow runs" be `pending`; "When the queue is
  full, any additional jobs or workflow runs are canceled". `queue: max` with `cancel-in-progress: true` "is not
  allowed and will result in a workflow validation error". The changelog is
  [2026-05-07](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/).
- Order: "first-in-first-out (FIFO) order according to the time each one started waiting on the concurrency group, not
  the time each workflow was dispatched ... ordering is not guaranteed."
- Names are "case insensitive". A group can be set on the workflow or on a job. A workflow-level group can use the
  `github`, `inputs` and `vars` contexts; a job-level one also `needs`, `strategy` and `matrix`.
- A check run on a run held this way has status `pending`: "at the front of the queue but the group-based concurrency
  limit has been reached" (status checks page).
- The limits page says runs past the 100 cap "will be rejected"; the concurrency page says "canceled". My reading: they
  mean the same. **Unconfirmed** which conclusion shows.
- **Unconfirmed:** whether a run held at an environment gate counts as the running one of its group. If it does, a held
  run blocks the group. If it does not, the group may start a second one. This decides whether a gate and a group can
  share a name.

### Limits that apply to waiting and running work

All from the [Actions limits page](https://docs.github.com/en/actions/reference/limits), "subject to change".

| Limit | Value |
| --- | --- |
| Concurrent jobs, standard hosted runners | Free 20, Pro 40, Team 60, Enterprise 500 |
| Concurrent macOS jobs | 5 (Free, Pro, Team), 50 (Enterprise); shared with larger runners |
| Concurrent jobs, larger runners | 1,000 (Team, Enterprise) |
| Run length | 35 days, waiting and approval included, then cancelled |
| Gate approval wait | 30 days |
| Re-runs of one run | 50 |
| Matrix jobs per run | 256 |
| Trigger events | 1,500 per 10 seconds per repo |
| Workflow runs queued | 500 per 10 seconds; past it, the runs "will be blocked and will not be queued" |
| Check runs in one check suite | 50,000 |
| Concurrency queue (`queue: max`) | 100 per group |

- Support can raise the job concurrency limits, the event rate limit and the re-run limit. It cannot raise the others.
- The concurrency numbers are per account plan. The page does not say whether our organization is Team or Enterprise,
  so I do not know which row is ours.
- The page lists no queue-time limit for GitHub-hosted jobs waiting on the concurrent-job cap. **Unconfirmed.**
- The REST API's own rate limits apply to dispatch and cancel calls too. I did not read them, so no numbers here.

## What this cannot tell us

- **Everything below needs one small run on a throwaway repo.** I ran nothing. Each test is a few minutes of work.
- **Which commit and file a dispatch builds.** Test: on a throwaway repo, put a changed workflow file on a branch that
  differs from the default branch, dispatch against it, then read the run's `head_sha`, `path` and the job's
  `workflow_sha`. Repeat with a SHA as `ref` to see the error. Move the branch right after the call to see which tip
  the run takes.
- **Whether a ref made through `POST /git/refs` starts `push` workflows.** Test: create a branch at an old commit with
  an App token, and list which runs start and with which `event`. Repeat with `GITHUB_TOKEN` to see none start. Open a
  pull request from a different branch at the same SHA and see whether the pushed-ref run satisfies its required check.
- **Gate behavior.** Test: an environment with a custom rule (our app), a job that names it. While it waits, read the
  job's `status`, `runner_name`, the check run's `status`, and the runner pool (does any runner show busy). Open a pull
  request on the commit and look at its checks box. Start a second run in the same concurrency group and see whether
  it starts or goes `pending`. Let the app reject, and read the conclusion. The 30-day timeout is too long to test;
  take the docs' word.
- **Time-limit labels.** Test: one job with `timeout-minutes: 1` and a two-minute sleep, one job with a step limit of
  1 and a job limit of 3. Read job, check run and run conclusions, and the annotations. Then cancel one run by the
  API, one by the web button, and one by a concurrency replacement, and read the annotations.
- **Who canceled.** The same test with a person, the API with an App token, and a concurrency group, then compare the
  run object and the audit log's `workflows.cancel_workflow_run`. I expect nothing in the run object.
- **Moving targets.** The custom rules are in public preview. The run-details parameter changed twice in a year. The
  cancel annotation texts are not in GitHub's docs.
- **Not read.** The Checks API (as the way to post marks that count), the REST rate limits, merge queues, and GitHub
  Enterprise Cloud's audit-log API. I cannot tell which plan our organization is on.
- **The runner's source is half the story.** The server decides the final job and run labels, and its code is closed.

## Sources

Read on 2026-11-21. Documents are at the version named.

- GitHub REST API description, `github/rest-api-description` at commit `c9c95fe34ced05fe076001f5c55704742bc8e7f8`:
  `descriptions/api.github.com/api.github.com.2022-11-28.json`, `api.github.com.2026-03-10.json`, `CHANGELOG.md`:
  https://github.com/github/rest-api-description/tree/c9c95fe34ced05fe076001f5c55704742bc8e7f8/descriptions/api.github.com
- GitHub Docs source, `github/docs` at commit `d7487f5debb5a5a2a6e65e6f9fa539266f5f8db6` (the rendered pages are at
  docs.github.com):
  - events: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
  - limits: https://docs.github.com/en/actions/reference/limits
  - concurrency: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
  - cancellation: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation
  - workflow syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
  - contexts: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
  - deployments and environments: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
  - configure custom rules: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/configure-custom-protection-rules
  - create custom rules: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/create-custom-protection-rules
  - review deployments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments
  - deploying with Actions: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
  - status checks: https://docs.github.com/en/pull-requests/reference/status-checks
  - troubleshooting required checks: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
  - API versions: https://docs.github.com/en/rest/about-the-rest-api/api-versions
  - REST, workflows: https://docs.github.com/en/rest/actions/workflows
  - REST, workflow runs: https://docs.github.com/en/rest/actions/workflow-runs
  - org audit log: https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization
  - audit event data: https://github.com/github/docs/blob/d7487f5debb5a5a2a6e65e6f9fa539266f5f8db6/src/audit-logs/data/fpt/organization.json
  - reusable texts (same commit): `data/reusables/actions/actions-group-concurrency.md`,
    `actions-do-not-trigger-workflows.md`, `custom-deployment-protection-rules-availability.md`,
    `about-custom-deployment-protection-rules.md`
- GitHub changelog: https://github.blog/changelog/2026-02-19-workflow-dispatch-api-now-returns-run-ids/ and
  https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/
- GitHub Actions runner, `actions/runner` at commit `7e211dc69c347b78fc398e630e74facb11a13235`:
  `src/Sdk/DTWebApi/WebApi/TaskResult.cs`, `src/Runner.Worker/StepsRunner.cs`, `src/Runner.Worker/JobRunner.cs`,
  `src/Runner.Listener/JobDispatcher.cs`: https://github.com/actions/runner/tree/7e211dc69c347b78fc398e630e74facb11a13235
- Third parties, secondary, used only where marked: https://github.com/combsmith/software-factory/issues/388,
  https://github.com/jig-harness/jig/issues/1610, https://zenn.dev/snowcait/articles/ecf458c1cb3811

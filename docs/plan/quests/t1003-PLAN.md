
Plancheck-Version: 3

```ts
// The whole idea, a sketch. fabrikalfa is one Worker: one host, many clients (0616). Each day-one
// job is a program (0601), each program is one Durable Object process with one journal on the
// ledger, and every GitHub call goes through a kalfa protocol, never straight to GitHub.
const programs = { merger, checks, freeze, settings, tokens }; // each is Program.make(name)(init).pipe(...)

// A client asks over HTTPS. The door checks who asks (the WritePolicy) before the ask reaches an inbox.
//   POST /ask   { to: "merger", input: { _tag: "arm", pr: 1280, head: "h1", leaks: "clean" } }
//   -> the door: Authorization names identity { _tag: "agent", environment: "laptop" }; may it arm? yes
//   -> merger's inbox -> one step: gates pass, Merges.enqueue(1280, h1) through @kalfa/codehost
//   -> journal: message { id, at, msg: arm { by: agent laptop } }, applied { state: armed 1280 at h1 }
//   -> answer   { _tag: "armed", pr: 1280, head: "h1" }
// GitHub's own merge queue still merges. merger only arms into it, in shadow first.
```

# Plan: ticket 1003, fabrikalfa's day-one programs, `merger`, `checks`, `freeze`, `settings` and `tokens`, on today's stack

**Which version:** `next/`. The app is `next/apps/fabrikalfa`, beside `next/apps/fabrika`, and it
follows [`next/AGENTS.md`](../../../next/AGENTS.md). Two pure rule files go into `kalfa/ci`, a
`@kalfa` package, which follows `next/`'s rules too
([0556](../../../.decisions/0556-kalfa-holds-our-tooling-packages.md)). The app imports kalfa
packages only: nothing from `next/`'s libraries (`@kampus/libfabrika`, `@kampus/tuval`, the
programs) and nothing from today's `packages/`, `programs/` and `apps/`. Nothing in `kalfa/` or in
the rest of `next/` imports the app (law L2). Slices 5 and 6 change two of today's lead scripts,
and slice 7 adds one and deletes today's message branches, each named where it comes up. Lead
tooling under `.agents/` is the repo's tooling, which
[0525](../../../.decisions/0525-todays-version-is-frozen.md) lists as "not covered" by the freeze
(read on main), so none of this touches today's frozen version. This plan replaces the plan of
[pull request 1279](https://github.com/kamp-us/tea-fabrika/pull/1279), which the owner held on
2026-11-14 and which the review of it sent back.

**Today's stack, read in the lockfile:** `effect` 4.1.3 with the repo's patch, `@demlik/tea` 0.29.0
(the `catalog:` version that `next/` and the root use) with the repo's tea patch (named under `patchedDependencies` in `pnpm-workspace.yaml`),
which adds `owed()` and `dispatch(msg, { answerTo })`, and `alchemy` 2.0.0-beta.85. tea 0.25.0 and
0.23.0 are still in the lockfile for today's version only (`catalog:old`). This plan uses none of
the older ones.

## Doubt first

Four calls are under 80%. Each is taken, with the branch it would undo.

- **Where the app lives: `next/apps/fabrikalfa`, named `@kampus/fabrikalfa`. The lead took this
  call (about 75%).** [0616](../../../.decisions/0616-providers-are-one-package-each.md)'s glossary
  row says fabrikalfa is "an app, the same tier as fabrika" and "not a kalfa package", and fabrika's
  app is `next/apps/fabrika`. `kalfa/` holds protocols, providers and tooling libraries. An app
  depends on kalfa packages, never the other way round, so the app sits beside fabrika's app and
  `kalfa/` never imports it. The name follows `next/`'s own convention: every package under `next/`
  is `@kampus/<name>` (`@kampus/fabrika`, `@kampus/libfabrika`, `@kampus/tuval`), and 0556's binding
  constraint "a `@kalfa` package lives in `kalfa/`, nowhere else" rules out `@kalfa` here.
  **What it undoes:** 0537's decision that the small services we run to ship fabrika live in
  `kalfa/`, and 0556's matching bullet ("the services of 0537 live in `kalfa/`"), for this one app.
  It also undoes 0556's consequence that "the merge queue's package takes the `@kalfa` scope",
  which named this package's old name, `@kampus/fabrikalfa`, as infra; 0556 marks its consequences
  as the lead's reading, not the owner's words, and 0616 came later. The other branch is
  `kalfa/fabrikalfa` as `@kalfa/fabrikalfa`, the earlier plan's: it would keep 0537 and 0556 as
  written and read 0616's "tier" as a role, not a folder. Moving back is one `git mv`, one name and
  one `boundary-rules.json` row.
- **Long work through tea's `owed()` (70%).** 0601 says long work uses `owed()` and
  `dispatch(msg, { answerTo })`, read in the patch. It leaves open the name of the piece a program
  uses for it and how private answers work. The plan uses it in one place, merger's wait for
  GitHub's queue, and says what it falls back to if `@kalfa/program`'s busy flag holds the whole
  program while one landing is owed.
- **The packages it builds on do not exist on main yet (75% they land as named).** On main today:
  `kalfa/config`, `kalfa/quality` and `kalfa/records`. `@kalfa/ci` is on ticket 810's branch
  (`fabrikalfa/t810-docs-only-classifier`, `kalfa/ci/src/DocsOnly.ts`). The rest come from other
  tickets, three of them not filed yet, in the order under [Order](#order). Slice 1 waits for all
  of them.
- **Who reads the lead's inbox (75%).** The owner's call says "the lead and the merger read it".
  The plan reads "the merger" as the lead's own session that lands pull requests, to which today's
  messages on branches are addressed beside the lead, not fabrikalfa's `merger` program: that
  program takes asks, and nothing in it decides on a status line. So slice 7 keeps one mailbox,
  `lead`, with one inbox stream that both lead sessions read, each at its own place. **What it
  undoes:** if the owner meant the `merger` program, the stream is `merger/inbox`, merger's `In`
  gains a `message` case, and a program reads only its own inbox
  ([0103](../../../.decisions/0103-a-program-may-mail-another-by-name.md)), so the lead would need
  its own stream as well. The doubt also covers usage rows: on 2026-11-19 the child sessions refused
  to send usage rows on a relayed yes, and they were right (a message on a branch says so). So no
  agent is asked to send usage rows until the owner's own answer to
  [open question 1](#open-questions) is written as a decision.

## What changes, in one paragraph

A new app package, `@kampus/fabrikalfa` at `next/apps/fabrikalfa`, beside fabrika's app: one
Cloudflare Worker deployed with Alchemy, which hosts five programs, each written as `Program.make(name)(fn)` with its pipes (0601).
The Worker takes GitHub's webhooks at `POST /github`, asks from clients at `POST /ask`, views at
`GET /view/<program>`, and Cloudflare's cron triggers. It turns each into one input for one
program's inbox. Each program's state and every step are in that program's journal, the `Journal`
of `@kalfa/program` built by `@kalfa/ledger`'s `journal` Layer on `@kalfa/provider-cloudflare`'s
Durable Object Ledger; tests use the memory Ledger. Every GitHub call goes through
`@kalfa/codehost` and `@kalfa/ci`, whose GitHub Layers are in `@kalfa/provider-github` (0612,
0614, 0616). Pure rules (is it green, is it docs only, is a path a leftover, does the freeze keep a
run) are functions in `@kalfa/ci`, not programs. `merger` arms pull requests into GitHub's own merge
queue and admin-merges only in a sev, one fix at a time on current main. `checks` flags a ready
pull request's missing or stuck required check. `freeze` cancels CI runs in a sev0 and spares
main's own `check` runs. `settings` applies the repo and queue settings from a file and reports
drift every hour. `tokens` vends one-hour push tokens for `fabrikalfa/*` branches, so the App's
private key leaves the laptop. GitHub's queue stays in charge until merger passes the code host's
conformance laws and its shadow run. The Worker also keeps the lead's mailbox: cloud and local
agents send their messages (status, a plan ready, usage rows) to it through the door, with their
environment's caller token, and the lead's sessions read it. Once it works, today's message
branches (`fabrikalfa/mail-session_*`) and their watchers are deleted, and usage rows leave the
public repo for the ledger. Until then the message branches stay as the stopgap.

## Builds on

| Package | What fabrikalfa uses | On main? | Brought by |
|---|---|---|---|
| `@kalfa/quality/vitest` | `it.effect.prop`, `runsFor`, `lawsOn(memory, real)` (0538) | no | ticket 1189 |
| `@kalfa/codehost` | pull requests, merges (enqueue, admin), comments, labels, the conformance suites (0614); rulesets and repo settings, or slice 1 adds them | no | ticket 1190 |
| `@kalfa/ci` | `Runs` (0612), `DocsOnly` (ticket 810), the gates this plan adds | branch only | tickets 810 and 1191 |
| `@kalfa/provider-github` | the GitHub Layers for codehost and ci, the App's credentials (0616) | no | ticket 1192 |
| `@kalfa/program` | `Program.make`, `Journal`, `Errors`, `Machine`, `Supervisor` (0601) | no | a ticket to be filed by the lead, its own plan |
| `@kalfa/ledger` | `Ledger`, its memory Layer, the `journal` Layer, `WritePolicy` (0601, 0616) | no | a ticket to be filed by the lead, its own plan |
| `@kalfa/provider-cloudflare` | the Durable Object Ledger and program hosting on Workers (0616) | no | a ticket to be filed by the lead, its own plan |

The tracker was not readable from this step, so the ticket numbers are the brief's, in its order.
`@kalfa/provider-github` is the new name for `@kalfa/github` (pull request 1662). The lead files a
ticket for each of the three new packages, and each gets its own plan; they follow 0601's build
order: tea's logged store (already the repo's tea patch), `@kalfa/program`'s v0, `@kalfa/ledger`,
then the provider.

**Rulesets and repo settings.** 0614 lists "repo labels and variables" for `@kalfa/codehost`, and
`settings` needs rulesets and repo settings (merge methods, branch deletion) too. If ticket 1190's
plan leaves them out, slice 1 adds them: a `Rulesets` and a `RepoSettings` service in
`@kalfa/codehost`, each with its memory Layer and conformance suite, and their GitHub Layers in
`@kalfa/provider-github`. The files are in the files table, marked "only if 1190 leaves them out".
The service names are a sketch; 1190's plan settles them if it takes them.

## Order

What must land before each slice, in order. Each line needs the lines above it unless it says so.

1. Ticket 1189: `@kalfa/quality/vitest`, which every law here runs on.
2. Ticket 1190: `@kalfa/codehost`, the code host protocol and its conformance suites.
3. Tickets 810 and 1191: `@kalfa/ci`, with `Runs` and `DocsOnly`. It may land before or beside
   1190; `ship` needs 1190's services, the rest does not.
4. Ticket 1192: `@kalfa/provider-github`, after 1190 and 1191, since it provides both.
5. `@kalfa/program`: a ticket to be filed by the lead, its own plan. It needs only tea's patch, so
   it may run beside lines 1 to 4.
6. `@kalfa/ledger`: a ticket to be filed by the lead, its own plan, after `@kalfa/program`, whose
   `Journal` interface it builds on (0616).
7. `@kalfa/provider-cloudflare`: a ticket to be filed by the lead, its own plan, after
   `@kalfa/ledger`.
8. **Slice 1,** the app and settings, after lines 1 to 7. It adds rulesets and repo settings to
   `@kalfa/codehost` and `@kalfa/provider-github` if 1190 left them out.
9. **Slice 2,** checks and the gates, after slice 1.
10. **Slice 3,** the policy and freeze, after slice 1. It may land before or after slice 2.
11. **Slice 7,** the lead's inbox, after slice 1 (the Worker, the ask route, the ledger's journal
    and inbox streams from lines 6 and 7) and slice 3 (the WritePolicy door and caller tokens). It
    needs nothing from slices 2, 4, 5 and 6, so it may land before or after any of them. Its last
    step, the deletion of today's message branches, waits for one week of messages through it (see
    [the slice](#the-leads-inbox)).
12. **Slice 4,** merger in shadow, after slices 2 and 3: it uses the gates and freeze's output.
13. **Slice 5,** tokens and `botpush.mjs`, after slices 1 and 3 (the policy) and the owner's
    `agents` ruleset ([Rollout](#rollout-in-the-order-the-owner-sees-it), step 5).
14. **Slice 6,** merger live through `land.ts arm`, after slice 4's shadow run reaches 10 matches.
15. **Later, on the owner's answer to [open question 2](#open-questions):** merger's admin merge
    live, with a second App.

## How others do it

Read this session unless marked. `docs.github.com` was not reachable from this step, so every
GitHub API fact below is from memory, marked so. The marks stay, under one rule for the tests step,
written under [Validation](#validation): a `vector:` fixture for each fact comes first.

- **Elm and OTP.** Each program is one process with private state and a mailbox, as an OTP
  `gen_server` is, and a supervisor restarts it (0601's `Program.supervise`). Programs talk by
  Sends into each other's inboxes, never by shared state. `settings`' output is piped into `checks`
  and `merger`, and `freeze`'s into `merger`, as a parent passes a child's out-message on in Elm.
- **tea's logged store, read in the 0.29.0 patch.** A step is confirmed only after it ends cleanly;
  a crash hands it out again on boot under the same delivery id. A Cmd handler may return `owed()`
  (`dist/core-PxoTxrNB.d.ts`: "A logged Cmd handed to an external owner without completing its
  delivery"), and the answer comes later as `dispatch(msg, { answerTo: id })`, which the store
  refuses with `unknown_answer` when that id is not owed. The journal is ordered opaque text, one
  writer per stream (`dist/index-_evnHmXt.d.ts`, `Journal` and `FencedJournal`). The old plan's
  hand-kept `owed`/`sent` call state is this, done by tea.
- **Octo STS** ([github.com/octo-sts/app](https://github.com/octo-sts/app), read this session): a
  GitHub App that trades an OIDC token for a short-lived GitHub token. Trust policies are files in
  the target repository, `<name>.sts.yaml` in a `chainguard` folder of its GitHub folder, with
  `issuer`, `subject` or `subject_pattern`, `claim_pattern` and `permissions`. A workload calls
  `GET /sts/exchange?scope=<repo>&identity=<name>` with its OIDC token as the bearer; the App checks
  the token against that policy and mints an installation token with only the policy's
  `permissions`. The App asks GitHub for a superset of permissions and narrows each token. Octo STS
  is its own GitHub App, "a GitHub App called `octo-sts` that acts like a Security Token Service",
  installed by an org admin, whose one job is minting narrowed tokens. Its README says an org with an
  IP allow list "should self-host octo-sts with their own GitHub App", from container images and a
  Terraform module. So the known way gives token minting an App of its own, apart from what else an
  org's Apps do. That is the shape of [open question 2](#open-questions).
- **GitHub App installation tokens, from memory:** `POST /app/installations/{id}/access_tokens`
  with `repositories` and `permissions` narrows a token to those; it lasts one hour; no permission
  narrows it to a branch. A branch limit is a ruleset, and a ruleset's bypass list names who may
  pass it, per actor, not per token.
- **GitHub Actions OIDC, from memory:** with `id-token: write`, a job gets a JWT from issuer
  `https://token.actions.githubusercontent.com`, with `sub` like `repo:<owner>/<repo>:ref:<ref>`
  and claims such as `repository_id` and `job_workflow_ref`, verified against the issuer's JWKS.
  No workflow in this repo asks for one today: a search of the workflow files for `id-token` finds none.
- **GitHub's safe-settings**
  ([README](https://raw.githubusercontent.com/github/safe-settings/main-enterprise/README.md), read
  this session): settings as code in an admin repo, applied from the default branch on `push`, run
  as a dry run (`nop`) on other branches, synced on a schedule (`CRON`), and drift is reverted.
  `settings` follows it except for the revert: drift is reported, never reverted, because in a sev
  the owner changes settings by hand on purpose (0532: he empties the queue).
- **Kubernetes Tide** ([Tide](https://docs.prow.k8s.io/docs/components/core/tide/)): an open issue
  with the merge-blocker label blocks merges, and the issue is the incident's record. The owner
  picked this shape for a sev0 on 2026-11-14.
- **Kubernetes priority and preemption**
  ([PriorityClass](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)):
  0612's model for which run may displace which. The freeze's keep-or-cancel rule is that kind of
  admission rule, so it is a pure function in `@kalfa/ci`.
- **bors and GitHub's merge queue:** pin the head that was approved, and land only what passed
  (from experiment 266, read for the old plan). Day one does not build a queue; it arms GitHub's,
  pinned to the head it checked, as `land.ts arm` does today.

## Calls taken

Each decides how the code does what a note already says. A percentage is how sure.

- **The app is `next/apps/fabrikalfa`, `@kampus/fabrikalfa`: the lead's call (about 75%).** See
  [Doubt first](#doubt-first).
- **The boundary row is a new library type, `next-fabrikalfa`,** not `next-app`. `next-app` lets
  fabrika's app import libfabrika, tuval and the programs, and fabrikalfa imports none of them; it
  imports only kalfa packages. A type of its own holds that, and no other type lists it, so nothing
  in `kalfa/` or `next/` may import the app (law L2). 90%.
- **The libfabrika test, applied** (`next/AGENTS.md`: would a from-scratch client write this file
  again?). fabrikalfa is no libfabrika client: it composes kalfa packages, so the test asks instead
  whether a second bot on kalfa would write the file again. The programs, the policy, the callers,
  the ask schemas, the routes and the settings file's schema are fabrikalfa's own rules (0616: "who
  may ask the bot for what is fabrikalfa's own rule"). The pure rules a second bot would want are
  already in `@kalfa/ci`. The one file left is `Webhook.ts`'s signature check and event schemas: it
  stays in the app until a second user of GitHub's webhooks appears, then moves to
  `@kalfa/provider-github`, since no protocol of 0612 or 0614 names incoming events yet. 80%.
- **Names follow `next/`'s words** (`next/AGENTS.md`, "Words", 0212): in `next/`, a bare "run"
  means an agent run only. So no input tag of the app is `run`: a GitHub check run reaches checks as
  `check`, and a workflow run reaches freeze as `workflow`, GitHub's own event names (`check_run`,
  `workflow_run`), as libfabrika's `ci/Ci.ts` names its `CheckRun`. `Runs` stays, the name `@kalfa/ci`
  owns (0612). The two clocks of a ledger entry are `arrivedAt` and `sentAt` in `next/`'s words; in
  the journal sketch, `at` is tea's own record field and `sentAt` is the writer's. 85%.
- **One Worker, one Durable Object process per program,** each found by its name, with one journal
  stream and one inbox stream (0601, "Durable Objects as the model"; 0537, "one Worker"). 95%.
- **A program's input function does the deciding and the GitHub call in one step.** A crash
  hands the step out again, so every write is safe to repeat: enqueue answers "already armed",
  an admin merge of a merged pull request answers its commit, a cancel of an ended run is a no-op.
  This replaces the old plan's `owed`/`sent` state (0601: "A step handed out again after a crash
  writes again"). 90%.
- **Long work only where the answer comes from outside, later:** merger's arm waits for GitHub's
  queue to merge or drop the pull request. The step returns owed, and the webhook's `merged` or
  `dequeued` is dispatched with `answerTo` that delivery. 70%: 0601 leaves the piece's name and
  private answers to `@kalfa/program`'s plan. If its busy flag holds the program while a landing is
  owed, merger takes the webhook as a plain input from the `github` identity instead, which the
  door already admits only with a good signature.
- **Every action is a step, so it is in the journal.** A step's input message (with `by`, both
  clocks and its id) and its applied state are tea's journal records; the state holds the action's
  answer. No program writes to a second log. 90%.
- **Cron triggers are the clock.** The Worker's `scheduled` handler sends `tick` inputs: every 5
  minutes to `checks` and `freeze`, every hour to `settings`. No program keeps its own timer. A
  Durable Object alarm per program would need a timer piece `@kalfa/program` has not named. 85%.
- **The pure rules live in `@kalfa/ci`:** `docsOnly` (ticket 810), and two new files,
  `Gates.ts` (`green`, `leftovers`) and `Freeze.ts` (`verdict`). A program calls them; none is a
  program (the brief, 0612's "admission is ours and pure"). 90%.
- **merger arms; it does not run a queue of its own.** GitHub's queue merges until merger, as a
  `Merges` Layer of its own, passes `@kalfa/codehost`'s conformance laws and a shadow run. That is a
  later slice (below). 95%.
- **merger refuses a pull request that adds or keeps a `.rej` or `.orig` file,** at arm and at
  admin merge. Both are what `patch` and `git merge` leave behind. 95%.
- **The leak gate stays in the client for day one.** The private word list stays off the server
  (0585: no agent reads or prints it). `land.ts` runs the leak check in the same run and asks with
  `leaks: "clean"`; merger refuses an ask without it. Moving the words into the Secrets Store is a
  later slice for the owner. 80%.
- **A sev0 reaches fabrikalfa as an open issue labeled `sev0`** (owner, 2026-11-14), rebuilt from
  the open issues on start. **The one fix landing now is named by the lead's `next` ask**, not by a
  label: 0611 says the `sev` label grants nothing alone and one fix lands at a time. 85%.
- **The freeze spares main's `check` runs on a push to main, and still cancels main's full run**
  (`scheduled`), exactly 0611's rule. It also keeps a `merge_group` run and the named fix's runs,
  as `Freeze.ts` in the sev skill does today. 95%.
- **settings applies the file's settings on a push to main that changes the file, and the hourly
  run only reports.** It never writes a bypass list: 0603, "never ... a change to the bypass list by
  an agent". 85%.
- **The settings file is `.fabrikalfa/fabrikalfa.toml`,** `@kalfa/config`'s repo file for the app
  `fabrikalfa` (0585: `.<app>/<app>.toml`), read at main's head through the code host. One file
  holds the programs' own settings and the repo's wanted state. 80%.
- **tokens vends from the existing App** (owner, 2026-11-14), narrowed to this repository and
  `contents: write` and `pull_requests: write`, what `botpush.mjs` needs to push and open a draft.
  The branch limit is a ruleset, `agents`, that blocks branch writes outside `fabrikalfa/**` for any
  actor not on its bypass list. 80%.
- **tokens refuses while the App holds any bypass.** A token carries its App's bypass, so a push
  token from an App that may pass main's rules could merge past them. merger's admin merge needs
  that bypass, so it runs live only after the owner's answer to
  [open question 2](#open-questions), a second App, and admin merges stay with
  `land.ts merge --admin` until then. 90%.
- **CI by OIDC is part of the policy, and its code waits for its first user.** No workflow asks
  fabrikalfa for anything today, so the trust-policy reader is a later slice; the WritePolicy
  question settles its shape now. 80%.
- **The lead's inbox is Runtime's mailbox, not a new piece.** The lead is an agent, and an agent is
  a program ([agents are programs](../../../docs/direction/agents-are-programs.md)), so its
  mailbox is a process's one inbox stream with many writers (0601), named `lead/inbox` as `next/`
  names a name's inbox `<name>/inbox` (`next/packages/libfabrika/src/processes/Mailbox.ts`). What
  lands in it is a message (0547, 0582). A Send is a ledger append with an id, saved before it is
  delivered, so a resend under the same id is one entry (0103, 0601). No fabrikalfa program steps
  it: its reader is the lead itself, a client, as a person's inbox is registered under their name
  (the glossary's `inbox (tracker)` row). 80%.
- **One stream, two readers, each with its own place.** Both lead sessions read `lead/inbox`; each
  message says `to: "lead"` or `to: "merger"` so a reader acts on its own, as both read every
  message branch today. A reader's place is an `acked` entry on `lead/acked`, the glossary's `ack
  (inbox)` shape (Kafka's committed offset). 75%, the doubt under [Doubt first](#doubt-first).
- **A full inbox answers `full`, and a message too big is refused** (0109: an inbox has a cap on
  unread messages, and a Send to a full one answers `full`). Unread counts from the `lead` reader's
  place, since the lead reads every message. The cap and the size are 0582's `mailbox.capacity`
  and `mailbox.chunk`, in `.fabrikalfa/fabrikalfa.toml`. 85%.
- **Reads wait instead of poll.** `GET /inbox/lead` uses the ledger's `wait` (0601's storage
  primitive), up to 30 seconds, so the lead's watcher becomes one waiting read, not a loop over
  branches. 80%.
- **Usage rows go to the ledger, and nowhere public.** A usage message carries counts only, today's
  usage file's row (message id, time, session, model, token counts), never message text. The lead
  reads them from the inbox. Nothing copies them into git; the per-step `field/runs/` rows that
  `clauderow.ts` writes are not changed by this slice. 85%.
- **The message branches are copied into the private archive before they are deleted**
  ([0027](../../../.decisions/0027-experiment-results-live-in-a-private-archive.md)'s archive): they
  hold the lead's coordination record of the past weeks, which nothing else holds. 80%.

## The shape

### Package layout

```text
next/apps/fabrikalfa/          @kampus/fabrikalfa: the app, beside next/apps/fabrika; nothing imports it
  package.json                 private; scripts typecheck, deploy (alchemy deploy), dev
  tsconfig.json                as fabrika's app's: the base config and the Effect language service
  alchemy.run.ts               the Worker, one thin Durable Object class per program, cron triggers, secrets
  README.md
  src/
    Worker.ts                  fetch (POST /github, POST /ask, GET /view/<program>) and scheduled
    Webhook.ts                 verify the signature, decode one event into one program input
    Ask.ts                     the ask protocol: the request, the answer, the error, as schemas
    Policy.ts                  fabrikalfa's WritePolicy Layer: who may ask which program for what
    Callers.ts                 the caller-token check: an environment's token to an identity
    App.ts                     joins the Layers: provider-github, provider-cloudflare, ledger, program
    merger/Merger.ts           the merger program
    checks/Checks.ts           the checks program
    freeze/Freeze.ts           the freeze program
    settings/Settings.ts       the settings program
    settings/Desired.ts        the file's schema: programs' settings and the repo's wanted state
    settings/Drift.ts          wanted against live, pure
    tokens/Tokens.ts           the tokens program
fixtures/next/fabrikalfa      recorded webhook payloads and GitHub answers, each labeled vector:
kalfa/ci/src/Gates.ts          green, leftovers (pure)
kalfa/ci/src/Freeze.ts         verdict (pure)
```

What the move into `next/` means for the repo's own files, each read on main:

- `pnpm-workspace.yaml` already lists `next/apps/*` and `kalfa/*`. Not changed.
- `vitest.config.ts` already runs `next/apps/*/src/**/*.test.{ts,tsx}` in its `next` project, and
  `kalfa/*/src/**` for `kalfa/ci`'s tests. Not changed.
- `exam-paths.json` already holds `next/`'s globs for tests, test support and tsconfig files, and
  the glob for `next/`'s saved fixtures, so the app's tests, test support, tsconfig and vectors are
  exam paths with no new row. Not changed. The vectors live in `fixtures/next/fabrikalfa`,
  where `next/`'s saved vectors already live, not in a folder of the app's own.
- `layer-rules.json` puts all of `next/apps` in its top layer, `next-apps`, which imports any lower
  layer and which no layer may import. Not changed.
- `boundary-rules.json` gets one library type, `next-fabrikalfa`, and the row
  `"next/apps/fabrikalfa": "next-fabrikalfa"`. Its `imports` list only kalfa types: `kalfa-config`,
  `kalfa-quality`, and the types tickets 1190 to 1192 and the three new tickets give `@kalfa/codehost`,
  `@kalfa/ci`, `@kalfa/provider-github`, `@kalfa/program`, `@kalfa/ledger` and
  `@kalfa/provider-cloudflare`. No type lists `next-fabrikalfa`, so nothing imports the app (L2).
  A new `next/` package with no row fails `pnpm lint:boundaries` (experiment 253, gap 13).
- `.oxlintrc.json` already holds `next/**` and `next/apps/**` to `next/`'s rules, which now reach the
  app: `fabrika/no-promises`, `fabrika/no-static-layer` (a service file holds only its contract,
  0095), `fabrika/isolate-boundary` (`Fetcher` and `ctx.exports` stay out of the app), the test
  rules. It gets one override, for L1: `eslint/no-restricted-imports` refuses `@kalfa/provider-*` in
  the program folders and in `Ask.ts`, `Policy.ts`, `Callers.ts` and `Webhook.ts`. An override
  replaces a rule's options, so it repeats the `next/**` block's import bans, as the file's other
  overrides do.
- `next/AGENTS.md`'s rules that lint does not hold yet apply too: the platform through Alchemy
  (0042), and an object class stays thin (0041): each program's Durable Object class holds what
  Workers gives it and one handoff to `@kalfa/provider-cloudflare`'s program host.

### The ask protocol

Protocols first: every client speaks the same tagged JSON over HTTPS, so a browser tab, `land.ts`
and a CI job are the same kind of client.

```ts
// next/apps/fabrikalfa/src/Ask.ts, a sketch.
export const Ask = Schema.TaggedUnion({
  merger: { input: Merger.Asks },   // arm, admin
  freeze: { input: Freeze.Asks },   // next
  tokens: { input: Tokens.Asks },   // push
});
// POST /ask, body { _tag: "merger", input: { _tag: "arm", pr: 1280, head: "h1", leaks: "clean" } },
// header Authorization: Bearer <a caller token>. The door answers 401 with nothing appended when the
// caller is unknown, 403 when the WritePolicy says no, else the program's answer or its Err.

export const Caller = Schema.TaggedUnion({
  github: { delivery: Schema.String },                         // a webhook with a good signature
  clock: { cron: Schema.String },                              // a cron trigger
  agent: { environment: Schema.String },                       // a caller token, one per environment
  lead: { environment: Schema.String },                        // the lead's own caller token
  ci: { repository: Schema.String, workflow: Schema.String, ref: Schema.String }, // OIDC, later slice
});
```

### The WritePolicy

0601 puts the `WritePolicy` service in `@kalfa/ledger`; 0616 says who may ask the bot for what is
fabrikalfa's own rule. So the interface is the ledger's, and the rule is this Layer. An ask is a
Send into a program's inbox, which is a ledger append, so the policy is asked before every append.

```ts
// next/apps/fabrikalfa/src/Policy.ts, a sketch. The table is the open owner question below.
const may = {
  github: ["merger.event", "checks.event", "freeze.event", "settings.event"],
  clock: ["checks.tick", "freeze.tick", "settings.tick"],
  agent: ["merger.arm", "tokens.push"],
  lead: ["merger.arm", "merger.admin", "freeze.next", "tokens.push"],
  ci: ["tokens.push"],
} as const satisfies Record<Caller["_tag"], ReadonlyArray<string>>;

export const layer = Layer.succeed(WritePolicy, WritePolicy.of({
  allows: (caller, stream, input) => Effect.succeed(may[caller._tag].includes(`${stream}.${input._tag}`)),
}));
// merger.admin is also refused by merger itself outside a sev0: the policy says who, the program says when.
```

Caller tokens: one random token per environment (the laptop's boxes, a cloud session, the lead
session). The Worker keeps only each token's SHA-256, in the Secrets Store, and compares in
constant time. The token itself stays in that environment: on the laptop, a file under
`~/.fabrikalfa/` that is never mounted into a box for the lead's.

### merger

```ts
// next/apps/fabrikalfa/src/merger/Merger.ts, a sketch on 0601's API.
export const Asks = Schema.TaggedUnion({
  arm: { pr: Pr, head: Sha, leaks: Schema.Literal("clean") },  // land.ts ran the leak gate this run
  admin: { pr: Pr, head: Sha },                                // the lead, in a sev0, the named fix
});
export const In = Schema.TaggedUnion({
  ...Asks.cases,
  settings: { mode: Mode, shadow: Count, required: Names },     // piped from settings' output
  sev: { open: Schema.Boolean, fix: Schema.NullOr(Pr) },        // piped from freeze's output
  armed: { pr: Pr, head: Sha },                                 // GitHub: auto-merge on (shadow compares)
  merged: { pr: Pr, commit: Sha },                              // GitHub: closed and merged
  dequeued: { pr: Pr, reason: Schema.String },                  // GitHub: the queue dropped it
});
const Landing = Schema.Struct({ pr: Pr, head: Sha, by: Caller, at: Schema.Number });
const State = Schema.Struct({
  mode: Mode,                                         // "shadow" | "live", from settings
  line: Schema.Array(Landing),                        // armed in GitHub's queue, not yet merged
  sev: Sev,                                           // from freeze
  shadow: Schema.Struct({ run: Count, needed: Count, last: Schema.NullOr(Verdict) }),
});
export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  pr: Pr,
  reason: Schema.Literals(["frozen", "red", "leftovers", "moved", "draft", "base", "not_sev", "not_fix", "behind", "pending"]),
}) {}

export const merger = Program.make("merger")((flags: Flags) =>
  Effect.succeed(empty(flags)),
).pipe(
  Program.inputs(In, (state, input) =>
    In.match(input, {
      arm: (ask) => arm(state, ask),
      admin: (ask) => admin(state, ask),
      settings: (s) => Effect.succeed({ ...state, mode: s.mode, shadow: { ...state.shadow, needed: s.shadow } }),
      sev: (s) => Effect.succeed({ ...state, sev: s }),
      armed: (a) => Effect.succeed(compare(state, a)),        // shadow: would merger have armed this?
      merged: (m) => Effect.succeed(landed(state, m)),
      dequeued: (d) => Effect.succeed(dropped(state, d)),
    }),
  ),
  Program.outputs(View, (state) => Effect.succeed(view(state))),
  Program.errors(Refused),
);

const arm = Effect.fnUntraced(function* (state: State, ask: typeof Asks.cases.arm.Type) {
  if (state.sev.open) return yield* new Refused({ pr: ask.pr, reason: "frozen" });
  const pr = yield* PullRequests.read(ask.pr);                    // @kalfa/codehost
  if (pr.head !== ask.head) return yield* new Refused({ pr: ask.pr, reason: "moved" });
  if (pr.draft) return yield* new Refused({ pr: ask.pr, reason: "draft" });
  if (pr.base !== "main") return yield* new Refused({ pr: ask.pr, reason: "base" });
  if (Gates.leftovers(pr.paths).length > 0) return yield* new Refused({ pr: ask.pr, reason: "leftovers" });
  const checks = yield* Checks.at(pr.head);                       // @kalfa/ci
  if (Gates.isRed(Gates.green(checks, required(state)))) return yield* new Refused({ pr: ask.pr, reason: "red" }); // matched, not compared (0567)
  if (state.mode === "shadow") return record(state, ask);        // shadow: no write
  yield* Merges.enqueue({ pr: ask.pr, head: ask.head });          // pinned to the checked head; safe to repeat
  return yield* (yield* Machine).owe(withLanding(state, ask));    // long work until GitHub answers (0601)
});
// admin: refused unless state.sev.open and state.sev.fix === ask.pr; green (not only "not red") at head;
// main's head an ancestor of head (Commits.compare, behind 0); no leftovers. Then Merges.admin, a squash
// pinned to head. One at a time is the freeze's one named fix (0611).
```

`Gates.green` answers a `Schema.TaggedUnion` of `green`, `pending` and `red { failed }`, with
`isRed` as its guard. It takes GitHub's view of a required check, from memory: a success, neutral or skipped
latest run per name passes; no run is `pending` (or `missing`, for `checks`); any other conclusion
is `red`. Arm refuses only `red`, since GitHub's queue waits for green itself (0530, 0544); admin
needs `green`.

**merger's journal entries,** as tea writes them, for one arm in live mode:

```ts
// The records of merger's journal stream, a sketch of their decoded form.
{ _tag: "message", id: "ask:7c1e", at: 1763600000000,
  msg: { _tag: "arm", pr: 1280, head: "h1", leaks: "clean", by: { _tag: "agent", environment: "laptop" }, sentAt: 1763599999800 } }
{ _tag: "applied", sourceId: "ask:7c1e",
  state: { mode: "live", line: [{ pr: 1280, head: "h1", by: { _tag: "agent", environment: "laptop" }, at: 1763600000000 }], ... },
  owed: [{ _tag: "effect_owed", id: "d:41", effect: { _tag: "landing", pr: 1280, head: "h1" } }] }
{ _tag: "message", id: "gh:8f2a-delivery", at: 1763600400000, answerTo: "d:41",
  msg: { _tag: "merged", pr: 1280, commit: "c1", by: { _tag: "github", delivery: "8f2a" } } }
{ _tag: "applied", sourceId: "gh:8f2a-delivery", state: { mode: "live", line: [], ... }, owed: [] }
```

A refusal is a confirmed step with the state unchanged and the `Refused` on `errors` (0601: "An
Err goes to errors, and the program keeps going"). Its input message is still in the journal, so
every refused ask is recorded with who asked and why it was refused.

### checks

```ts
// next/apps/fabrikalfa/src/checks/Checks.ts, a sketch.
export const In = Schema.TaggedUnion({
  settings: { required: Names, missing: Minutes, stuck: Minutes },
  ready: { pr: Pr, head: Sha, at: Schema.Number },         // opened, ready_for_review, synchronize
  gone: { pr: Pr },                                        // closed, converted to draft
  check: { pr: Pr, head: Sha, name: Schema.String, status: Status, at: Schema.Number }, // check_run
  tick: { at: Schema.Number },
});
const Watched = Schema.Struct({
  head: Sha, since: Schema.Number,
  checks: Schema.Record(Schema.String, Schema.Struct({ status: Status, since: Schema.Number })), // by name
  flagged: Schema.Array(Schema.Struct({ name: Schema.String, reason: Schema.Literals(["missing", "stuck"]) })),
});
const State = Schema.Struct({ required: Names, missing: Minutes, stuck: Minutes, prs: Schema.Record(PrKey, Watched) });
// tick: for each watched pull request, a required name with no run `missing` minutes after `since` is
// missing; a run queued or in progress for `stuck` minutes is stuck. Each (pr, head, name, reason) is
// flagged once, with one comment through @kalfa/codehost's Comments, and the flag is in the new state.
// A new head starts the pull request again; a completed run clears its stuck flag.
```

### freeze

```ts
// next/apps/fabrikalfa/src/freeze/Freeze.ts, a sketch.
export const Asks = Schema.TaggedUnion({ next: { pr: Pr, branch: Schema.String } }); // the lead only
export const In = Schema.TaggedUnion({
  ...Asks.cases,
  issue: { number: Schema.Number, open: Schema.Boolean, sev0: Schema.Boolean, at: Schema.Number }, // issues events
  issues: { open: Schema.Array(Schema.Number) },                // the read of open sev0 issues, on start
  workflow: { run: Run },                                       // workflow_run requested or in progress
  tick: { at: Schema.Number },                                  // sweep the unfinished runs
});
const State = Schema.TaggedUnion({
  unread: {},                                                   // on start: nothing is kept or canceled yet
  calm: {},
  sev0: { issues: Schema.NonEmptyArray(Schema.Number), since: Schema.Number, fix: Schema.NullOr(Fix) },
});
// workflow and tick: while sev0, each unfinished run gets @kalfa/ci's Freeze.verdict(run, fix); a cancel goes
// through Runs.cancel (0612) and its answer is in the new state's `canceled` count. next is refused
// unless sev0, and replaces the fix (one at a time, 0611). Its output, { open, fix }, is piped to merger.
```

```ts
// kalfa/ci/src/Freeze.ts, a sketch. Pure: no clock, no network (0612).
export const verdict = (run: Run, fix: string | null): Verdict => {
  if (run.event === "merge_group") {
    return Verdict.cases.keep.make({ reason: "queue" });
  }
  if (fix !== null && run.branch === fix) {
    return Verdict.cases.keep.make({ reason: "fix" });
  }
  if (run.event === "push" && run.branch === "main" && run.workflow === "check") {
    return Verdict.cases.keep.make({ reason: "main" }); // 0611: main's own check runs are spared
  }
  return Verdict.cases.cancel.make({}); // main's scheduled full run included
};
```

### settings

```toml
# .fabrikalfa/fabrikalfa.toml, a sketch of the file settings reads. Keys are Desired.ts's.
[merger]
mode = "shadow"             # "shadow" or "live"
shadow = 10                 # matching arms in a row before live may be set (owner, 2026-11-14)

[checks]
missing = 10                # minutes
stuck = 30                  # minutes

[repo]
merge = ["squash"]          # 0004
delete_branch_on_merge = true

[rulesets.main]
target = "refs/heads/main"
required = ["ci-required"]
queue = true

[rulesets.agents]
target = "~ALL"
exclude = ["refs/heads/fabrikalfa/**", "refs/heads/main"]
restrict = ["creation", "update", "deletion"]
# no bypass key: a bypass list is the owner's, by hand (0603). settings reads it and reports it.
```

```ts
// next/apps/fabrikalfa/src/settings/Settings.ts, a sketch.
export const In = Schema.TaggedUnion({
  pushed: { commit: Sha, paths: Schema.Array(Schema.String) },  // push to main
  tick: { at: Schema.Number },                                   // hourly
});
const State = Schema.Struct({
  wanted: Schema.NullOr(Desired),   // the file at the last main commit that changed it
  live: Schema.NullOr(Live),        // what GitHub had at the last read, bypass lists included
  drift: Schema.Array(Diff),        // Drift.diff(wanted, live), [] when they match
  applied: Schema.NullOr(Schema.Struct({ commit: Sha, at: Schema.Number, writes: Count })),
  read: Schema.NullOr(Schema.Number),
});
// pushed, when paths has the file: read it at commit, read live, write each Diff that is not a bypass
// list, read live again, store all of it. tick: read live, store the drift, write nothing.
// Output: { wanted, live, drift, read }, piped to merger and checks, and shown at GET /view/settings.
```

`Drift.diff` compares field by field and names each difference by its path, such as
`rulesets.main.required`. A bypass list is compared and reported, and its `Diff` is marked
`write: false`, so the apply step cannot write it.

### tokens

```ts
// next/apps/fabrikalfa/src/tokens/Tokens.ts, a sketch.
export const Asks = Schema.TaggedUnion({ push: {} });
export const In = Schema.TaggedUnion({ ...Asks.cases, settings: { live: Live } });
const State = Schema.Struct({
  ruleset: Schema.Literals(["ok", "missing", "drifted"]),   // the agents ruleset, from settings
  bypass: Schema.Boolean,                                   // the App is on any bypass list
  vended: Count,
});
// push: refused unless ruleset is "ok" and bypass is false. Mints one installation token through
// @kalfa/provider-github's credentials (this repo; contents: write, pull_requests: write; one hour).
// The step's new state holds { vended: n + 1 } and the vend record below; the token goes back to the
// asker only in the HTTP answer, never in state, output, errors or a span. If the step fails, no token
// leaves.
```

The vend record in the journal names `by`, `at`, `expires` and the token's fingerprint (the first
12 hex of its SHA-256), never the token. A record of who held push rights when cannot be rebuilt
later, so it is written from the first vend.

### The Worker

```ts
// next/apps/fabrikalfa/src/Worker.ts, a sketch of what each route does.
// POST /github     verify X-Hub-Signature-256 with Mac.verify (constant time) or 401 with nothing kept;
//                  Webhook.decode(event, body) -> [program, input] | null; Send with id = X-GitHub-Delivery,
//                  so a delivery GitHub sends twice is one message (tea's logged admission keeps the first).
// POST /ask        Callers.identify(Authorization) or 401; WritePolicy.allows or 403; Send; await the answer.
// GET /view/<p>    the program's latest output as JSON. No secret is in any output (law X1).
// scheduled        cron "*/5 * * * *": tick to checks and freeze; cron "17 * * * *": tick to settings.
```

## One value traced

PR 1280 changes `next/` code. Mode is `live`, no sev0 is open, `ci-required` is still running at
head `h1`.

1. The lead runs `land.ts arm 1280` (slice 6). It runs the leak gate, then POSTs
   `{ _tag: "merger", input: { _tag: "arm", pr: 1280, head: "h1", leaks: "clean" } }` with the
   lead's caller token.
2. The door hashes the token, finds `{ _tag: "lead", environment: "laptop" }`, and asks the
   WritePolicy: `lead` may `merger.arm`. It Sends the input, with `by` and `sentAt`, to merger's
   inbox with the ask's id.
3. merger's step: `sev.open` is false; the pull request's head is `h1`, ready, into `main`; its
   paths hold no `.rej` or `.orig`; `green` answers `pending`, which is not `red`. It calls
   `Merges.enqueue(1280, h1)`, which turns on merge when ready, pinned to `h1`. It returns owed,
   with 1280 in `line`.
4. tea commits the step: the journal holds the `message` and the `applied` record with the owed
   delivery `d:41`. The door answers `{ _tag: "armed", pr: 1280, head: "h1" }`.
5. `ci-required` goes green; GitHub's queue tests and merges 1280 as `c1`. GitHub sends
   `pull_request` `closed` with `merged: true`. The door verifies the signature and dispatches
   `{ _tag: "merged", pr: 1280, commit: "c1" }` with `answerTo: "d:41"`.
6. merger's step takes 1280 out of `line`. The journal holds that answer and the new state; the
   delivery is confirmed in the same write.

If the Worker died between step 3's enqueue and step 4's commit, the step is handed out again on
the next wake, `enqueue` answers "already armed", and the journal has one arm. If the push in step
3 had moved the head to `h2`, the step refuses `moved`, and the journal holds the ask and the
refusal.

## Laws

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| G1, `green` answers green exactly when every required name's latest run at the head is a success, neutral or skipped; `red` when any is another conclusion; `pending` when one has none, default runs | test | fc.record: required names and runs with every conclusion, out of order | count an older run over the latest: red | kalfa/ci/src/Gates.test.ts |
| G2, `leftovers` keeps exactly the paths ending `.rej` or `.orig`, at any depth, default runs | test | fc.array: repo paths with and without the two endings | match `.orig` anywhere in the name: red | kalfa/ci/src/Gates.test.ts |
| F1, `verdict` keeps a `merge_group` run, the named fix's runs and `check` push runs on main, and cancels every other run, main's `scheduled` run included, default runs | test | fc.record: runs with every event, branch and workflow, a fix or none | keep main's scheduled run: red; cancel main's check push run: red | kalfa/ci/src/Freeze.test.ts |
| M1, merger arms only an open, ready, into-main pull request at the asked head, with no leftovers, not red, outside a sev0; every refusal is a `Refused` with its reason and the state unchanged, 200 runs | test | fc.record: pull requests, heads, paths, check runs and sev states on the memory layers | arm a red pull request: red; change state on a refusal: red | next/apps/fabrikalfa/src/merger/Merger.test.ts |
| M2, merger admin-merges only in a sev0, only the named fix, only green at the head, only when main's head is an ancestor of the head, as a squash pinned to the head, 200 runs | test | fc.record: sev states, fixes, commit graphs and checks on the memory layers | skip the ancestor check: red; merge a second fix while one is named: red | next/apps/fabrikalfa/src/merger/Merger.test.ts |
| M3, in shadow mode merger makes no `Merges` write; its count of matching arms in a row resets on a mismatch; live needs both `shadow` matches and the file's `mode = "live"`, default runs | test | fc.array: arm asks, GitHub armed events and settings inputs in fc.shuffledSubarray order | enqueue in shadow: red; keep the count on a mismatch: red | next/apps/fabrikalfa/src/merger/Merger.test.ts |
| M4, every write a fake protocol Layer records has one journal message with the same id, its `by` and both clocks, and an applied state that holds its answer, for every program, 100 runs | test | fc.array: inputs to all five programs on memory layers and the memory Ledger | call `Comments.post` from the Worker, outside a step: red | next/apps/fabrikalfa/src/Journal.test.ts |
| M5, a step that dies after its write is handed out again and makes the same write once more, which the protocol answers as done: one arm, one admin merge, one cancel, one comment, default runs | test | fc.record: the step and the point it dies at, on memory layers | an enqueue that arms twice: red | next/apps/fabrikalfa/src/Journal.test.ts |
| M6, an answer dispatched with `answerTo` an id that is not owed is refused and changes no state; a merged event for a pull request merger never armed is a plain input, default runs | test | fc.record: answers with owed and unknown ids | apply an unknown answer: red | next/apps/fabrikalfa/src/merger/Merger.test.ts |
| C1, checks flags a required check missing `missing` minutes after the head, never before, once per pull request, head and name; a new head starts again, default runs | test | fc.array: ready, check and tick inputs with times | flag at once: red; flag twice: red | next/apps/fabrikalfa/src/checks/Checks.test.ts |
| C2, checks flags a run queued or in progress for `stuck` minutes once, and a completed run is never flagged stuck, default runs | test | fc.array: check status changes and ticks | flag a completed run: red | next/apps/fabrikalfa/src/checks/Checks.test.ts |
| Z1, freeze is in sev0 exactly while an open issue carries `sev0`, rebuilt from the open issues on start; from `unread` it cancels nothing, default runs | test | fc.array: issue events, then a cleared journal and an issues read | cancel before the read: red; end on one of two issues closing: red | next/apps/fabrikalfa/src/freeze/Freeze.test.ts |
| Z2, freeze cancels through `Runs.cancel` exactly the runs `verdict` cancels, and `next` is refused outside a sev0 and replaces the one fix, default runs | test | fc.array: runs, next asks and ticks in a sev0 and out | keep two fixes: red; cancel a kept run: red | next/apps/fabrikalfa/src/freeze/Freeze.test.ts |
| S1, `diff(wanted, live)` is empty exactly when they match, and names each difference by its path, default runs | test | fc.record: wanted and live settings, one field changed at a time | ignore the order of required checks only one way: red | next/apps/fabrikalfa/src/settings/Settings.test.ts |
| S2, settings writes only on a push to main that changed its file, the hourly tick never writes, and no write ever holds a bypass list, 200 runs | test | fc.array: pushes, ticks and files with bypass lists that differ | write on a tick: red; write a bypass list: red | next/apps/fabrikalfa/src/settings/Settings.test.ts |
| T1, tokens vends only while the agents ruleset is ok and the App is on no bypass list, and every vend's record is in the journal before the answer leaves, default runs | test | fc.record: settings outputs and push asks | vend with a bypass: red; answer before the step commits: red | next/apps/fabrikalfa/src/tokens/Tokens.test.ts |
| P1, the door admits an ask exactly as the policy table says, for each caller kind and each program input, and a refused ask appends nothing, default runs | test | fc.record: caller kinds crossed with every input tag | let an agent ask `merger.admin`: red | next/apps/fabrikalfa/src/Policy.test.ts |
| P2, a caller token is found by its hash, compared in constant time; an unknown, short or changed token answers 401 and appends nothing, 200 runs | test | fc.uint8Array: tokens with one byte flipped | compare with `===` on strings: red | next/apps/fabrikalfa/src/Policy.test.ts |
| W1, a body signed with the webhook secret passes; a changed byte in body or header, a missing header or another secret answers 401 with nothing appended, 200 runs | test | fc.uint8Array: bodies and secrets with one byte flipped | skip the check on an empty body: red | next/apps/fabrikalfa/src/Webhook.test.ts |
| W2, each recorded payload decodes to its program and input, and an event no program uses gives null | test | vector: one recorded payload per event and action, from a real delivery to the App | drop `closed` with `merged: true`: red | next/apps/fabrikalfa/src/Webhook.test.ts |
| W3, a delivery id seen twice is one journal message, default runs | test | fc.array: deliveries with ids from a small set | append before the id check: red | next/apps/fabrikalfa/src/Worker.test.ts |
| X1, [secrets] the App's private key, the webhook secret, caller tokens and minted tokens never appear in a journal record, an output, an error, a view, a comment body or a span attribute, 100 runs | test | fc.string: generated secrets planted in every input, answer and failure path | put the minted token in the vend record: red | next/apps/fabrikalfa/src/Secrets.test.ts |
| K1, every law above runs on `@kalfa/codehost`'s and `@kalfa/ci`'s test Layers, which pass those packages' own conformance suites, through `@kalfa/quality/vitest`'s `lawsOn` | test | scenario: the protocols' test Layers, composed in the test support | hand-write a fake that skips a conformance law: red | next/apps/fabrikalfa/src/Fabrikalfa.test-support.ts |
| L1, only `App.ts`, `Worker.ts` and `alchemy.run.ts` import a provider package; every program imports protocols only (0616) | lint | lint | import `@kalfa/provider-github` in Merger.ts: `pnpm lint` fails | .oxlintrc.json |
| L2, the app imports only kalfa packages, and no package in `kalfa/` or `next/` imports the app | lint | lint | import `@kampus/fabrikalfa` from `kalfa/ci`, or `@kampus/libfabrika` from the app: `pnpm lint:boundaries` fails | boundary-rules.json |
| R1, only if ticket 1190 leaves them out: the memory Layers of `Rulesets` and `RepoSettings` pass their conformance suites, and a read after a write answers what was written, default runs | test | fc.record: rulesets and repo settings, one field changed at a time | a memory Layer that drops `required` on write: red | kalfa/codehost/src/RulesetsTest.ts |
| R2, only if ticket 1190 leaves them out: no `Rulesets` write takes a bypass list, so no caller can write one (0603) | type | type | add `bypass` to the write input: the test's type assertion fails to compile | kalfa/codehost/src/Rulesets.ts |
| Y1, each program's input function takes only its `In` union's members; an input with an unknown `_tag` fails to compile | type | type | add an untyped input to `match`: typecheck fails | next/apps/fabrikalfa/src/merger/Merger.ts |

The tests step runs each plant once and records it in its report and run row, never committed. The
`vector:` payloads in W2 come from real deliveries to the App, recorded once with the event, action
and date, before the build relies on them. They live in `fixtures/next/fabrikalfa`, with a README
that says how each was recorded. The rule for every GitHub fact marked "from memory" is under
[Validation](#validation).

**No host-only law.** Nothing needs the owner's Mac. Every law runs on memory layers and the memory
Ledger on every pull request (0536, 0581). The deploy, the shadow run and the live Ledger are the
owner's and the lead's, under [Rollout](#rollout-in-the-order-the-owner-sees-it), not laws.

## Files

| File | Change | Product lines expected | Owner | Slice |
|---|---|---|---|---|
| `next/apps/fabrikalfa/package.json` | the app: private, its kalfa dependencies, scripts | 30 | build | 1 |
| `next/apps/fabrikalfa/tsconfig.json` | as fabrika's app's: extends the base config, the Effect language service, Node and Workers types | tests | tests | 1 |
| `next/apps/fabrikalfa/README.md` | what runs, how to deploy, the owner's steps | docs | build | 1 |
| `next/apps/fabrikalfa/alchemy.run.ts` | the Worker, the program objects, cron triggers, secrets | 70 | build | 1 |
| `next/apps/fabrikalfa/src/Worker.ts` | the four routes | 90 | build | 1 |
| `next/apps/fabrikalfa/src/Webhook.ts` | verify, decode | 110 | build | 1 |
| `next/apps/fabrikalfa/src/Ask.ts` | the ask protocol schemas | 40 | build | 1 |
| `next/apps/fabrikalfa/src/App.ts` | the Layers joined | 60 | build | 1 |
| `next/apps/fabrikalfa/src/settings/Settings.ts` | the settings program | 120 | build | 1 |
| `next/apps/fabrikalfa/src/settings/Desired.ts` | the file's schema | 60 | build | 1 |
| `next/apps/fabrikalfa/src/settings/Drift.ts` | the pure diff | 50 | build | 1 |
| `.fabrikalfa/fabrikalfa.toml` | the first file, in shadow mode | 30 | build | 1 |
| `next/apps/fabrikalfa/src/Fabrikalfa.test-support.ts` | the memory world: protocol test Layers, memory Ledger | tests | tests | 1 |
| `next/apps/fabrikalfa/src/settings/Settings.test.ts` | S1, S2 | tests | tests | 1 |
| `next/apps/fabrikalfa/src/Webhook.test.ts` | W1, W2 | tests | tests | 1 |
| `next/apps/fabrikalfa/src/Worker.test.ts` | W3 | tests | tests | 1 |
| `next/apps/fabrikalfa/src/Journal.test.ts` | M4, M5, grown each slice | tests | tests | 1 |
| `next/apps/fabrikalfa/src/Secrets.test.ts` | X1, grown each slice | tests | tests | 1 |
| `fixtures/next/fabrikalfa` | the recorded vectors, each labeled `vector:` with its call and date | tests | tests | 1 |
| `fixtures/next/fabrikalfa/README.md` | how each vector was recorded, beside the vectors | tests | tests | 1 |
| `boundary-rules.json` | the `next-fabrikalfa` type and its row, L2 | 8 | tests | 1 |
| `.oxlintrc.json` | one override for L1: no `@kalfa/provider-*` import outside `App.ts`, `Worker.ts` and `alchemy.run.ts`, repeating the `next/**` block's bans | 20 | tests | 1 |
| `pnpm-lock.yaml` | the new package's links | tests | tests | 1 |
| `exam-paths.json` | not changed: its `next/` globs for tests, test support and tsconfig files, and for `next/`'s saved fixtures, already cover the app | none | tests | 1 |
| `layer-rules.json` | not changed: `next/apps` is already its top layer, `next-apps` | none | tests | 1 |
| `pnpm-workspace.yaml` | not changed: it already lists `next/apps/*` and `kalfa/*` | none | tests | 1 |
| `vitest.config.ts` | not changed: its `next` project already runs `next/apps/*/src` and `kalfa/*/src` tests | none | tests | 1 |
| `package.json` | not changed: `pnpm -r typecheck` reaches a new workspace package | none | tests | 1 |
| `kalfa/codehost/src/Rulesets.ts` | only if 1190 leaves them out: the `Rulesets` service's contract, R2 | 40 | build | 1 |
| `kalfa/codehost/src/RulesetsMemory.ts` | only if 1190 leaves them out: its memory Layer | 50 | build | 1 |
| `kalfa/codehost/src/RulesetsTest.ts` | only if 1190 leaves them out: its conformance suite, R1 | tests | tests | 1 |
| `kalfa/codehost/src/RepoSettings.ts` | only if 1190 leaves them out: the `RepoSettings` service's contract (merge methods, branch deletion) | 30 | build | 1 |
| `kalfa/codehost/src/RepoSettingsMemory.ts` | only if 1190 leaves them out: its memory Layer | 40 | build | 1 |
| `kalfa/codehost/src/RepoSettingsTest.ts` | only if 1190 leaves them out: its conformance suite, R1 | tests | tests | 1 |
| `kalfa/codehost/package.json` | only if 1190 leaves them out: exports the two services | 2 | build | 1 |
| `kalfa/provider-github/src/Rulesets.ts` | only if 1190 leaves them out: the GitHub Layer for `Rulesets` | 70 | build | 1 |
| `kalfa/provider-github/src/RepoSettings.ts` | only if 1190 leaves them out: the GitHub Layer for `RepoSettings` | 40 | build | 1 |
| `kalfa/provider-github/package.json` | only if 1190 leaves them out: exports the two Layers | 2 | build | 1 |
| `kalfa/ci/src/Gates.ts` | `green`, `leftovers` | 40 | build | 2 |
| `kalfa/ci/package.json` | exports `./Gates` and `./Freeze` | 2 | build | 2 |
| `kalfa/ci/src/Gates.test.ts` | G1, G2 | tests | tests | 2 |
| `next/apps/fabrikalfa/src/checks/Checks.ts` | the checks program | 160 | build | 2 |
| `next/apps/fabrikalfa/src/checks/Checks.test.ts` | C1, C2 | tests | tests | 2 |
| `next/apps/fabrikalfa/src/Policy.ts` | the WritePolicy Layer | 60 | build | 3 |
| `next/apps/fabrikalfa/src/Callers.ts` | caller tokens to identities | 50 | build | 3 |
| `next/apps/fabrikalfa/src/Policy.test.ts` | P1, P2 | tests | tests | 3 |
| `kalfa/ci/src/Freeze.ts` | `verdict` | 40 | build | 3 |
| `kalfa/ci/src/Freeze.test.ts` | F1 | tests | tests | 3 |
| `next/apps/fabrikalfa/src/freeze/Freeze.ts` | the freeze program | 110 | build | 3 |
| `next/apps/fabrikalfa/src/freeze/Freeze.test.ts` | Z1, Z2 | tests | tests | 3 |
| `next/apps/fabrikalfa/src/merger/Merger.ts` | the merger program, shadow and live, Y1 | 230 | build | 4 |
| `next/apps/fabrikalfa/src/merger/Merger.test.ts` | M1, M2, M3, M6 | tests | tests | 4 |
| `next/apps/fabrikalfa/src/tokens/Tokens.ts` | the tokens program | 110 | build | 5 |
| `next/apps/fabrikalfa/src/tokens/Tokens.test.ts` | T1 | tests | tests | 5 |
| `.agents/skills/lead/scripts/botpush.mjs` | asks tokens for its push token; the keychain path goes | 40 | build | 5 |
| `.agents/skills/lead/scripts/botpush.test.ts` | its laws on a fake tokens answer | tests | tests | 5 |
| `.agents/skills/lead/scripts/pr/Arm.ts` | asks merger to arm, in live mode | 40 | build | 6 |
| `.agents/skills/lead/scripts/pr/Arm.test.ts` | its laws on a fake merger answer | tests | tests | 6 |
| `.glossary/TERMS.md` | rows: caller token, trust policy, the five programs; the fabrikalfa row names its folder | docs | build | 1 |
| `docs/plan/README.md` | where we are: fabrikalfa and its slices (0013) | docs | build | 1 |

## Existing tools

- `next/apps/fabrikalfa/alchemy.run.ts`: searched `rg -l "alchemy.run" packages next` and found
  fabrika's app's stack in `next/apps/fabrika` (`Alchemy.Stack`, `Cloudflare.Workers.Worker`, its
  Durable Object bindings, settings as one JSON env value checked under Workers' 5 KB limit) and
  `packages/ledger-server`'s, today's version. The new stack follows fabrika's app's shape, its
  neighbor in `next/apps`. It imports neither: fabrika's stack reads `@kampus/libfabrika`'s settings
  type, which this app may not import (L2), and today's code is never imported from `next/`.
- `next/apps/fabrikalfa/src/Worker.ts`: searched `@kalfa/provider-cloudflare`'s planned exports (0616:
  program hosting on Workers) and `@alchemy.run/cloudflare` beta.85's Worker form; none routes
  webhooks or asks. This file is the four routes only.
- `next/apps/fabrikalfa/src/Webhook.ts`: searched npm for `@octokit/webhooks`, which verifies and types
  GitHub events but brings its own Promise API and types; searched the repo
  (`rg -n "X-Hub-Signature" .`), none. Effect's `Mac.verify` does the check
  ([the crypto pattern](../../../.patterns/effect-crypto-through-services.md)), and Schema decodes
  the few events used.
- `next/apps/fabrikalfa/src/Ask.ts`: searched `@kalfa/transport` (0601, not built) and Effect's `Rpc`.
  `Rpc` fits a typed client; the ask stays plain tagged JSON so a browser tab and `botpush.mjs`
  speak it without an Effect client. Moving it onto `Rpc` later changes no program.
- `next/apps/fabrikalfa/src/App.ts`: searched for a composer in the kalfa packages; none exists.
  `kalfa/AGENTS.md` says Layers are joined at the top, by the `kalfa` command and libfabrika; this
  app is a third top, as 0616's "the app that composes Layers".
- `next/apps/fabrikalfa/src/Policy.ts`: searched `@kalfa/ledger`'s `WritePolicy` (0601, the
  interface, not built) and `next/`'s person-only rules
  (`rg -n "personOnly" next/packages/libfabrika/src`), which are fabrika's. This is fabrikalfa's
  Layer of the ledger's interface.
- `next/apps/fabrikalfa/src/Callers.ts`: searched Effect's `Mac` and `Hash` and the repo
  (`rg -n "constantTime" .`), which finds tea's `constantTimeEqual` in `@demlik/tea/do`; Effect's
  `Mac.verify` compares in constant time and is used instead, through the crypto pattern.
- `next/apps/fabrikalfa/src/settings/Settings.ts`: searched github/safe-settings, whose shape it
  follows; its code is Node and Probot, so none is taken.
- `next/apps/fabrikalfa/src/settings/Desired.ts`: searched `@kalfa/config` (`kalfa/config/src/Toml.ts`,
  `Codec.ts`), which parses and decodes the file; this is only the file's schema.
- `next/apps/fabrikalfa/src/settings/Drift.ts`: searched npm's `deep-diff` and Effect's `Equal`;
  `Equal` compares, and a field-by-field walk on the decoded values names each path, so no package.
- `next/apps/fabrikalfa/src/checks/Checks.ts`: searched `.agents/skills/lead/scripts/pr/Queue.ts`
  (reads `ci-required` once) and `ci-speed.ts` (speed numbers, not stuck runs); neither watches a
  pull request over time.
- `next/apps/fabrikalfa/src/freeze/Freeze.ts`: searched the sev skill's `Freeze.ts` and `Level.ts`
  (today's laptop loop and log). Its rule is rethought as `kalfa/ci/src/Freeze.ts`'s `verdict`, its
  loop becomes cron ticks and webhooks; nothing is imported from `.agents/`.
- `next/apps/fabrikalfa/src/merger/Merger.ts`: searched `pr/Arm.ts`, `pr/Merge.ts` and `pr/Queue.ts`
  (today's arm and admin merge) and `next/programs/pipeline`'s merger (0110). The gates are read
  from them and rethought; none is imported.
- `next/apps/fabrikalfa/src/tokens/Tokens.ts`: searched Octo STS (its own Go service, the shape
  followed) and `botpush.mjs` (mints with `createSign` from the keychain key on the laptop). The
  minting call is `@kalfa/provider-github`'s credentials Layer; this program decides and records.
- `kalfa/ci/src/Gates.ts`: searched `kalfa/ci/src/DocsOnly.ts` on ticket 810's branch and
  `pr/Queue.ts`'s inline `ci-required` read; no shared `green` or leftover check exists.
- `kalfa/codehost/src/Rulesets.ts`, only if ticket 1190 leaves it out: searched 0614's services
  (pull requests, merges, pushes, reviews and comments, repo labels and variables), which hold no
  ruleset, and libfabrika's `codehost` folder, which holds `change`, `update` and `merge` only. A
  contract file, as 1190 shapes its other services (0095).
- `kalfa/codehost/src/RulesetsMemory.ts`, only if ticket 1190 leaves it out: searched the same and
  found no memory Layer for rulesets; it is the contract's sibling memory Layer (0095).
- `kalfa/codehost/src/RepoSettings.ts`, only if ticket 1190 leaves it out: searched 0614's services
  and libfabrika's `codehost` folder, which hold no merge-method or branch-deletion setting. A
  contract file.
- `kalfa/codehost/src/RepoSettingsMemory.ts`, only if ticket 1190 leaves it out: searched the same;
  its sibling memory Layer.
- `kalfa/provider-github/src/Rulesets.ts`, only if ticket 1190 leaves it out: searched the lead's
  scripts for a ruleset call (`rg -n "rulesets" .agents/skills/lead/scripts`) and found none; the
  Layer calls GitHub's REST API through the provider's own client, as its other Layers do.
- `kalfa/provider-github/src/RepoSettings.ts`, only if ticket 1190 leaves it out: searched the same
  scripts and found no repo settings call; a Layer like the one above.
- `kalfa/ci/src/Freeze.ts`: searched the sev skill's `Freeze.ts` `verdict`, which keeps the queue's
  and the allowed branch's runs and cancels main's push runs. 0611 changed that rule; the new one is
  pure and lives where 0612 puts admission.

## Is this a setting?

Each new choice, asked (0069):

- `merger.mode`, `merger.shadow`, `checks.missing`, `checks.stuck`: settings, in
  `.fabrikalfa/fabrikalfa.toml`. `missing` 10 is about twice the 256 s start wait 0112 measured;
  `stuck` 30 is about 2.4 times the 12.5 minutes one full run took in
  [0106](../../../.decisions/0106-a-pull-requests-checks-finish-in-five-minutes.md). `shadow` 10 is
  the owner's.
- The repo's wanted state (merge methods, rulesets, required checks): settings, in the same file.
- The cron times (5 minutes, hourly): set once in `alchemy.run.ts`, not in the file, because a cron
  trigger is deployed, not read. The hourly drift run is the ticket's word.
- The token's permissions and its one hour: not settings. The permissions are what `botpush.mjs`
  needs, and one hour is GitHub's fixed lifetime.
- The freeze's keep rule, the bypass rule and "never land an untested tree": not settings. 0611,
  0603 and 0537 fix them.

## Records

- **What is lost if not written now:** for every ask, who asked, both clocks, its id, and the
  answer or the refusal and its reason; for every webhook, its delivery id; for every arm, the head
  it was pinned to and the checks it saw; for every admin merge, the sev, the fix, main's head and
  the head; for every cancel, the run and its verdict; for every settings read, the live state with
  its bypass lists; for every token, who held it, when and until when. Each is in a journal from its
  first day, and none can be rebuilt later.
- Derived later from the journals: time from arm to merge, how often checks go missing or stuck,
  the drift history.
- `field/runs/` rows for each step, by the lead, and a field note for the shadow run.
- `.glossary/TERMS.md` and `docs/plan/README.md`, as in the files table.
- No `.decisions/` file: 0537, 0601, 0611, 0612, 0614 and 0616 hold the rulings. The owner's answers
  to the open questions are written as decisions the turn he gives them.
- If the lead's call on where the app lives stands, 0537's and 0556's lines that put 0537's services
  in `kalfa/` no longer hold for this app. Whether they get a note in place (0605) is the lead's
  call, in a docs pull request of its own, not in this plan's slices.

## Validation

- The tests step: `pnpm format`, `nice -n 15 pnpm exec vitest run --maxWorkers=3` on the slice's
  test files, `pnpm lint`. Each plant run once and recorded. No law makes a GitHub call or a
  Cloudflare call.
- **A rule for the tests step: a vector first, for every fact marked "from memory".** Each GitHub
  API fact this plan marks "from memory" may stay in the plan as it is. No law leans on one until the
  tests step holds a `vector:` fixture of a real response for it, in `fixtures/next/fabrikalfa`,
  labeled with the call, the date and where it was recorded. The facts: which conclusions pass a
  required check (G1); the installation token request's fields and its one hour (T1); that a
  ruleset bypass is per actor and no token narrows it (T1, open question 2); the webhook payloads
  (W2); and, for the later OIDC slice, the Actions token's claims. A call that needs the App's key is
  made by the lead or the owner, outside any box, and the tests step labels what it is handed. A
  vector that disagrees with the plan sends the plan back before the build starts.
- The lead runs one typecheck and the leak grep, outside any box.

## Rollout, in the order the owner sees it

1. **Slice 1 lands, and the owner deploys from his Mac:** `pnpm --filter @kampus/fabrikalfa deploy`
   with the App's private key and a new webhook secret in the shell for that one command; Alchemy
   writes them into the Secrets Store (0537). **Waits on the owner:** the App's webhook URL set to
   the Worker's `/github` with that secret, the events `pull_request`, `check_run`, `workflow_run`,
   `issues` and `push`, and the App's permissions `administration: write`, `actions: write`,
   `checks: read`, `contents: write`, `issues: read` and `pull_requests: write`. settings reports
   drift from the first hour and writes nothing until the file changes on main.
2. **Slice 2 lands:** checks starts flagging missing and stuck checks on ready pull requests.
3. **Slice 3 lands:** the lead gets the first caller tokens, and freeze cancels runs in the next
   sev0 beside `sev.ts`'s loop. A second cancel of a run is a no-op, so the two do not fight. The
   loop retires in a later lead-tooling change, once one sev0 ran with both and their cancels
   matched.
4. **Slice 4 lands, in shadow.** For each pull request GitHub's queue takes, merger records whether
   it would have armed it at that head. Shadow is done after 10 matches in a row; the view shows the
   count, so nobody counts by hand.
5. **Slice 5 lands.** **Waits on the owner:** the `agents` ruleset made once by hand with its bypass
   list (the people's roles; the App is not on it), since only he edits a bypass list (0603). Then
   `botpush.mjs` asks tokens, and the App's key can leave the laptop's keychain.
6. **Slice 6, after shadow:** the file's `mode = "live"` lands as a reviewed change, and `land.ts
   arm` asks merger. GitHub's queue still merges.
7. **Waits on the owner, later: [open question 2](#open-questions), a second GitHub App.** merger's
   admin merge in a sev needs an App on main's bypass list, and a push token carries its App's
   bypass. Until the owner answers and, on a yes, makes the second App, T1 keeps tokens refusing if
   the App it vends from ever holds a bypass, and admin merges stay with `land.ts merge --admin`. His
   2026-11-14 answer (the existing App) was about the queue and the day-one programs.

## Later slices, not built now

- **Our own queue,** batching and skipping a change already tested on the same tree (0537):
  merger becomes a `Merges` Layer of its own and must pass `@kalfa/codehost`'s merges conformance
  suite, the one `@kalfa/provider-github`'s Layer passes, then a shadow run beside GitHub's queue.
  Only then is GitHub's queue turned off, which 0537 leaves open.
- **CI by OIDC:** the trust-policy reader, files `.fabrikalfa/trust/<identity>.toml` with Octo
  STS's fields, the JWKS check, when the first workflow needs to ask.
- **The leak gate on the server,** with the word list in the Secrets Store, on the owner's word.
- **Chat:** asks from a comment that mentions the bot, through `@kalfa/chat` (0616).

## Earlier owner answers, kept and dropped

- **Kept:** the existing fabrikalfa App (2026-11-14), for every program day one. The step that
  needs a second App is open question 2, asked now and taken only at Rollout step 7.
- **Kept:** a sev0 is an open issue labeled `sev0`, closing it ends it, rebuilt from the open
  issues on start (2026-11-14, Tide's shape).
- **Dropped:** a PR labeled `sev0-fix` lands in a freeze. 0611 (2026-11-18) replaced it: the label
  is `sev`, it grants nothing alone, and the one fix landing now is named. Here the lead names it
  with `freeze.next`.
- **Kept, narrowed:** shadow ends after 10 matches in a row, a setting (2026-11-14). Its "at least
  one by the slow path" falls away, since day one has no staging path; it comes back with our own
  queue.
- **Dropped with the old design:** `/merge` comments, the staging branch and the tree check. Day one
  arms GitHub's queue, which tests the tree it lands; they come back with our own queue.

## What the review of the old plan flagged, and what changed

- **The `infra/` folder and `@kampus` names:** no path is named `infra/`, and tests use
  `@kalfa/quality/vitest`, not `@kampus/vitest` (0538). The complaint was about tooling names and the
  folder. The app itself is now `@kampus/fabrikalfa` at `next/apps/fabrikalfa`, the lead's call on
  0616, because `next/`'s packages are all `@kampus` and 0556 keeps `@kalfa` inside `kalfa/`. Read
  against 0556 itself, that is not the whole story: 0556's consequences also said this package, then
  named `@kampus/fabrikalfa`, "takes the `@kalfa` scope" because "it is infra". That line is the
  lead's reading at the time, and 0616, later, calls fabrikalfa an app and not a kalfa package. This
  plan undoes that line, as [Doubt first](#doubt-first) says.
- **A hand-written tea 0.25 machine tree:** each job is a `Program.make` program (0601), on tea
  0.29.0 and its patch, which the plan never names in a program's API. Only `Machine` reaches tea,
  for the owed landing.
- **`type` keys:** every union is a `Schema.TaggedUnion` or `TaggedError`, keyed `_tag` (0214).
- **Its own EventStoreSql:** gone. Each program's journal is `@kalfa/program`'s `Journal` through
  `@kalfa/ledger`'s `journal` Layer on `@kalfa/provider-cloudflare`'s Durable Object Ledger; tests
  use the memory Ledger.
- **Owed calls kept in its own state:** gone. A crash hands a step out again (tea's logged store),
  writes are safe to repeat, and the one wait on GitHub uses tea's `owed()` and `answerTo`.

## Names checked

| Our word | Industry word | Source | Kept or renamed |
|---|---|---|---|
| merger | merger, 0110's word | [0110](../../../.decisions/0110-merge-queue-is-fabrika-programs.md) | kept |
| arm | merge when ready, auto-merge | [0530](../../../.decisions/0530-lead-turns-on-merge-when-ready.md) | kept, the repo's word |
| admin merge | bypass merge | [0611](../../../.decisions/0611-sev-runbooks-fixes-reserve-priority.md) | kept |
| freeze | merge freeze | [0532](../../../.decisions/0532-a-sev0-freezes-ci.md) | kept |
| drift | configuration drift | safe-settings, Terraform | kept |
| trust policy | trust policy | [Octo STS](https://github.com/octo-sts/app) | kept |
| caller token | API token, bearer token | RFC 6750 | kept, a new glossary row |
| leftovers | reject and backup files (`.rej`, `.orig`) | GNU patch | kept, plain word |
| shadow | shadow deployment | the old plan's row | kept |
| `missing`, `stuck` | not reported, hung check | GitHub required checks | kept, plain words |
| `Refused`, `reason` | the repo's refusal word | `.agents/skills/sev/scripts/Level.ts` | kept |

## What this cannot tell us

- **Whether `@kalfa/program`'s shape fits these sketches.** It is not built. The names `Machine`,
  the owed piece and how an ask gets its answer back are its plan's. A change there changes every
  program's sketch here, not what each program decides.
- **Whether one landing owed holds the whole merger** under `@kalfa/program`'s one-input-at-a-time
  busy flag. If it does, merger takes GitHub's answer as a plain input, as the call says.
- **Whether `@kalfa/codehost` covers rulesets and repo settings.** 0614 lists "repo labels and
  variables"; settings needs rulesets too. If ticket 1190's plan leaves them out, slice 1 adds them
  to `@kalfa/codehost` and `@kalfa/provider-github`: the ten rows marked "only if 1190 leaves them
  out" in the files table, about 275 lines.
- **GitHub's facts are from memory,** since its docs were not reachable here: which conclusions
  pass a required check, the token request's fields, that a ruleset bypass is per actor. The
  marks stay; the tests step records a vector for each before a law leans on it (Validation).
- **The cost of a Durable Object per program and a cron every 5 minutes** is not measured. It is
  far inside the Workers Paid plan by a guess (about 12 wakes an hour per program), not by data.
- **Per-environment tokens cannot tell two agents in one environment apart.** The journal names
  the environment. An identity per agent run is later, if the owner wants it.
- **The ticket numbers 1189 to 1192 are the brief's.** The tracker was not readable from this step.

## Open questions

1. **Who may ask fabrikalfa for what: the `WritePolicy` of 0601.** The plan's table: GitHub itself, known by its webhook signature, sends events only; CI, known by a GitHub Actions OIDC token that matches a trust policy file in the repo (Octo STS style), may ask only for a push token; an agent, known by its environment's caller token (one token per environment: the laptop's boxes, a cloud session), may ask merger to arm and tokens for a push token; the lead, known by a caller token of its own that is never mounted into a box, may also name the sev fix and ask merger for an admin merge, which merger takes only while a sev0 is open. Yes, or say which line changes. Lean: yes, 70% sure. Why: it is the least each caller needs today, every ask is checked at the door before it reaches a journal, and no person meets a prompt in the daily flow. What it costs: a per-environment token cannot tell two agents in one environment apart, so the journal names the environment, not the agent; the lead's power rests on one file on the laptop staying out of every box; and the CI half is built only when a workflow first asks. What would settle the doubt: a read of the box mounts in `drive.ts` and `box.sh` showing no box can read the lead's file, and the owner's word on whether an agent run should have its own identity later.
2. **A second GitHub App, so that push tokens and main's bypass never sit on one App.** merger's admin merge in a sev needs an App on main's bypass list, and a push token carries its App's bypass, so T1 keeps tokens refusing while the App it vends from holds any bypass. The plan asks for a second App, made and installed by the owner only when merger's admin merge is to go live (Rollout step 7), never before. The existing `fabrikalfa` App keeps the webhook, the programs and the push tokens, and stays on no bypass list. The new App holds only main's bypass and only what an admin merge needs (`contents: write`, `pull_requests: write`), has no webhook, is used by merger alone, and keeps its key in the Secrets Store (0537). Yes; or no, and admin merges stay with `land.ts merge --admin` for good while merger's admin path, built and tested on memory layers in slice 4, never runs live; or yes with the jobs swapped, so the new App vends push tokens and the existing App takes the bypass. Lean: yes, as written, 70% sure. Why: it keeps T1 true without giving up merger's admin merge; the App on the bypass list does one rare, powerful thing, so its key is the one most worth keeping narrow; and every push and draft pull request stays `fabrikalfa[bot]`'s, the identity 0401 gives agents. The known way splits the same: Octo STS (https://github.com/octo-sts/app) is a GitHub App of its own whose one job is minting narrowed tokens, and its README tells an org that cannot use the hosted one to "self-host octo-sts with their own GitHub App". The swapped branch follows Octo STS more literally, but pushes would then come from a second bot name while commits still name `fabrikalfa[bot]`. What it costs: one App made and installed once by the owner, a few minutes once and no recurring prompt; a second private key in the Secrets Store and in any key rotation; sev admin merges show the second App's bot as the merger in the history; and `@kalfa/provider-github`'s credentials Layer takes two Apps, a small change at Rollout step 7. What would settle the doubt: a `vector:` read of GitHub's ruleset API showing that a bypass is per actor and that no token narrows it (from memory today), recorded before Rollout step 7; and the owner's word on whether a second bot name on sev admin merges is fine in the history.

## Size

Six pull requests, each lands whole, in the order the owner sees them. About 1,600 product lines,
or about 1,850 if slice 1 adds rulesets and repo settings, and about 14 agent hours across the
steps, 60% sure; the doubts are at the end of this section. The move into `next/apps` changes no
slice's size: the `exam-paths.json` line goes and the `.oxlintrc.json` override for L1 comes.

1. Slice 1, the app and settings: the package, the stack, the Worker's routes, the webhook check,
   the ask schemas, the Layers, the settings program with its file, schema and diff, and the first
   laws (S1, S2, W1 to W3, M4, M5, X1, K1, L1, L2): about 690 lines, the files table's sum (the
   earlier draft said 760). If ticket 1190 leaves out rulesets and repo settings, slice 1 also adds
   them, with R1 and R2: the `Rulesets` and `RepoSettings` contracts, memory Layers and conformance
   suites in `kalfa/codehost/src/`, their GitHub Layers in `kalfa/provider-github/src/`, and both
   packages' `package.json` exports, about 275 lines more, about 965 in all. Waits for every line
   above it under [Order](#order).
2. Slice 2, checks and the gates: about 200 lines, with G1, G2, C1, C2.
3. Slice 3, the policy and freeze: about 260 lines, with P1, P2, F1, Z1, Z2.
4. Slice 4, merger in shadow, its live and admin paths on memory layers: about 230 lines, with M1
   to M3, M6, Y1.
5. Slice 5, tokens and `botpush.mjs`: about 150 lines, with T1.
6. Slice 6, merger live through `land.ts arm`: about 40 lines. Starts after shadow's 10 matches.

Priced from the `@kalfa/quality/stryker` quest, a new kalfa package of about this slice size
(`field/runs/2026-11-18-kalfa-quality-stryker-*.json`: tests $6.92, build $3.80, review $5.55, a
fix $2.20 and its recheck $7.74, list dollars), and the old plan's basis, ticket 290's lane. Slices
1 and 4 are larger, about $30 each for tests, build and review; slices 2, 3 and 5 about $20 each;
slice 6 about $10; four send-backs at about $10 each. If slice 1 adds rulesets and repo settings,
its three steps cost about $40, not $30; at about even odds that adds about $10 to the budget. 60%
sure: the doubts are `@kalfa/program`'s API, which every program sketch leans on, and whether
ticket 1190 covers rulesets.

Estimate: 22 steps, $180

## Findings

None.

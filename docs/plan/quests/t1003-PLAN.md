
Plancheck-Version: 3

# Plan: ticket 1003, fabrikalfa's first feature, our own merge queue, in `infra/fabrikalfa`

This is a new top-level folder, `infra/`, beside both versions. It is neither `next/` nor today's
version. It follows `next/`'s standards ([0537](../../../.decisions/0537-infra-holds-our-own-small-services.md)),
and it imports nothing from either. It builds 0537 and the scope in tracker ticket 1003. One small
change touches today's CI files, named where it comes up.

```ts
// The whole idea. One Durable Object per repository holds the queue as a log of Msgs.
// Its state is the fold of that log through one tea machine; every wait is an alarm.
const step = (model: Model, msg: Msg) => applyCell(queue(settings), model, msg); // pure, from @demlik/tea

// A webhook appends a Msg and sets the alarm. The alarm does every GitHub call.
// The slow path, for PR 1280 at head h1 while main is m1:
//   entered  { pr: 1280, head: h1, by: "owner", fix: false, kind: "code", green: true }
//   stage_ok { main: m1, head: h1, commit: s1, tree: t1 }      // queue/staging = merge(m1, h1)
//   checked  { commit: s1, name: "ci-required", result: "pass" }
//   merge_ok { commit: c1 }                                      // squash of 1280, pinned to h1
//   verify_ok{ commit: c1, tree: t1, parent: m1 }               // main's tree is the tree we tested
// Model after the fold: { _tag: "idle", main: c1, line: [], red: null, blockers: { _tag: "known", issues: [] } }
```

## What changes, in one paragraph

A new pnpm package, `@kampus/fabrikalfa`, at `infra/fabrikalfa`, named for the existing fabrikalfa
GitHub App it runs as (owner, 2026-11-14). The merge queue is its first feature; the `sev0`
issue, `/merge` and later chat commands are fabrikalfa features too. It holds one Cloudflare Worker deployed with
Alchemy to the owner's account. The Worker takes GitHub's webhooks at `POST /github`, checks the
`X-Hub-Signature-256` header, turns each event into one Msg, and hands it to the `Fabrikalfa`
Durable Object. The object appends the Msg to its log in SQLite, steps one root tea machine,
`Fabrikalfa`, which steps its children by hand (`Blockers`, the open `sev0` issues; `Queue`, the
line, main and a red main; and `Queue`'s child `Merger`, which lands one change), caches the
result, and sets one alarm. The alarm does every GitHub call through two services, `CodeHost` and
`Ci`, each with a REST layer and an in-memory layer. A change enters with a `/merge` comment
and lands by the fast path (its head already holds main and its checks are green) or the slow path
(a staging branch of main plus the change, built through GitHub's API, its checks run there, then a
squash pinned to the head, then a check that main's new tree is the tested tree). It runs in
shadow mode first, beside GitHub's merge queue, at no CI cost, then live.

## How others do it

Read from memory unless marked; nothing below was fetched this session. The tests step records a
real response for each GitHub endpoint as a `vector:` fixture before the build relies on it.

- **Rust's bors** ([design doc](https://github.com/rust-lang/bors/blob/main/docs/design.md), read
  in [experiment 266](../../../experiments/266-what-a-merge-queue-must-do.md)): merges the PR with
  the latest main on `automation/bors/auto-merge`, pushes that commit to `automation/bors/auto`
  where CI runs, and lands only what passed. Two branches, "because GitHub cannot set a branch and
  merge into it in one call." One build at a time. It reads the workflow-completed event, never
  check-suite-completed, which can arrive early. A refresh every few minutes resyncs with GitHub.
- **bors-ng** ([docs](https://bors.tech/documentation/)): the same staging shape (`staging.tmp`
  then `staging`), all through GitHub's API, never a clone. `r+` pins the head that was approved.
- **GitHub's REST API**, the calls this plan uses:
  - `PATCH /repos/{o}/{r}/git/refs/heads/{ref}` with `force: true`, and `POST .../git/refs` to
    create one ([refs](https://docs.github.com/en/rest/git/refs)).
  - `POST /repos/{o}/{r}/merges` with `base` (a branch) and `head` (a sha): 201 with the merge
    commit, 204 when there is nothing to merge, 409 on a conflict
    ([merge a branch](https://docs.github.com/en/rest/branches/branches#merge-a-branch)).
  - `PUT /repos/{o}/{r}/pulls/{n}/merge` with `merge_method: "squash"` and `sha`: 200 merged, 405
    not mergeable, 409 when `sha` is not the head
    ([merge a pull request](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)).
    It pins the head only, never the base; the tree check covers that gap.
  - `GET /repos/{o}/{r}/compare/{base}...{head}` gives `behind_by`
    ([compare](https://docs.github.com/en/rest/commits/commits#compare-two-commits)).
  - `GET /repos/{o}/{r}/commits/{sha}/check-runs?check_name=...`
    ([check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)).
  - `GET /repos/{o}/{r}/pulls/{n}` and `/pulls/{n}/files`, and `POST /repos/{o}/{r}/issues/{n}/comments`.
  - A GitHub App signs a JWT with RS256, then trades it at
    `POST /app/installations/{id}/access_tokens` for a one-hour token
    ([installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)).
  - Webhooks carry `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, checked in
    constant time, and `X-GitHub-Delivery`, a unique id per delivery
    ([validating deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)).
  - `GET /repos/{o}/{r}/issues?labels=sev0&state=open` lists the open issues with a label, and the
    `issues` and `pull_request` webhooks carry `labeled`, `unlabeled`, `opened`, `closed` and
    `reopened` ([issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)).
- **Kubernetes' Tide** ([Tide](https://docs.prow.k8s.io/docs/components/core/tide/)): while an open
  issue carries the configured merge-blocker label, Tide merges only PRs that carry the matching
  exception label. The issue says why, so it is the incident's record too. The owner picked this
  shape for the sev0 freeze (2026-11-14).
- **Elm and OTP.** A parent is written by hand and steps its child, so `Queue` steps `Merger`, the
  same split as 0110's queue program and merger, inside one object. The log is Akka's event
  sourcing, which `@demlik/tea/do`'s own docs name; the "owed effect" rule is its
  `AtLeastOnceDelivery`. In this plan an owed call is part of the Model, so it rebuilds with the fold.
- **A large merge queue's lessons**, which this plan keeps: land only the tree you tested; three
  outcomes, pass, fail and infra, and "unsure is infra"; git is the record of what landed and the
  database is a cache you can rebuild; a red main freezes product changes and lets fixes through;
  a send with no answer is its own state, settled by checking what happened.

## Decided here

Each in one line, with the note that decides it.

- **`infra/` imports nothing from `next/` or today's version.** The queue lands every change to
  libfabrika, so it must keep working when libfabrika is broken. And its staging contract
  (`stage(main, head)`) is not libfabrika's `CodeHost.update`. It reads `next/programs/pipeline`'s
  `Merger.ts` and `Queue.ts` as its shape, rethought (0537: "a tryout home"). The one import is the
  CI path classifier below, which is a pure function and the repo's one rule for docs-only.
- **fabrikalfa is one tea machine tree, Elm's shape** (owner, 2026-11-14): the root `Fabrikalfa`
  steps its children `Blockers` and `Queue` by hand, and `Queue` steps `Merger`. Below.
- **The root's state is folded from a log in the object's own SQLite, stepped with `applyCell`,**
  as `next/`'s `WatchersSql.ts` steps its machine inside a synchronous transaction (0050: the step
  inside is a plain function). `@demlik/tea/do`'s `doEventSourcedStore` was read and not taken: it
  takes the raw `DurableObjectStorage` and a Promise store, both of which 0042 keeps out.
- **Every GitHub call is a Cmd an `update` returns, and the host runs it in the alarm.** No
  `update` runs an effect. An input Msg changes state and sets the alarm to now; it returns no Cmd.
  Only `timer` and Cmd answers return Cmds. So every owed call can be read from the Model, and a
  crash between deciding and calling loses nothing (0105: every wait is an alarm).
- **Each GitHub write is safe to repeat.** `stage` first reads the staging branch and answers it
  when it already is `merge(main, head)`. `merge` answers the merge commit when the PR is already
  merged. So "a send with no answer" is a `sent` call, and the next alarm sends it again.
- **The fast path is: the head already holds main** (`compare` says `behind_by: 0`) **and
  `ci-required` is green on the head.** Then the squash's tree is the head's own tree, and the
  tested tree is known exactly. The wider form ("the green run tested the main we have now") needs
  the base sha a `pull_request` run used, which no API field read here gives for sure. It is later.
- **Pass, fail, infra** are read from the `ci-required` check run on the staging commit:
  `success` is pass, `failure` is fail, and every other conclusion (`cancelled`, `timed_out`,
  `startup_failure`, `stale`, `skipped`, `neutral`, `action_required`) or no run by the deadline is
  infra. The ticket says timed-out is infra; that departs from `next/`'s `Change.verdict`, which
  calls it red.
- **Infra is retried once by staging again,** which makes a new commit and a new run, with no
  `actions: write` permission. A second infra pauses the line for `pause` minutes with the same
  change first, then it tries again. It is never charged to the change: no "failed" comment.
- **Docs-only uses CI's own rule.** The pure part of `.github/ci/changes.mjs` (`classify` and its
  path helpers, no `node:` import) moves to `.github/ci/paths.mjs`. A change is docs-only when
  `classify(paths, "merge_group")` starts no job but `field`. That is 0183's "docs only" as CI
  computes it, so the two cannot drift.
- **Docs-only still takes the slow path when it is behind main.** 0537's binding constraint is
  that the queue never lands a tree it did not test. CI runs only lint on such a staging commit, so
  it is cheap. What docs-only changes is the freeze: a docs-only change goes through a red main.
- **A red main freezes code changes.** When `ci-required` on main's head is `failure`, only a
  change entered with `/merge fix`, or a docs-only change, may land. Green on a later main head
  opens it again.
- **A sev0 freeze is an open issue labeled `sev0`,** as Tide's merge blockers (owner, 2026-11-14).
  Its body says why, so it is the sev log too. While one is open, only a PR labeled `sev0-fix`
  lands; labels need write access. Closing the last open `sev0` issue ends the freeze. The queue
  learns all of it from the `issues` and `pull_request` label webhooks, and on start (an empty log,
  or a cache it had to drop) it reads the open `sev0` issues before it lands anything. This is how
  the queue keeps 0532's "only the fix lands"; who calls a sev0 stays 0532's rule, not code's.
- **A tree that does not match stops the line** until a person resumes it. It never reverts main
  on its own. 0110 says the same, and that this is not a setting. The stop takes the same shape as
  the freeze: the queue opens one issue labeled `queue-stopped` with the tested and landed trees in
  its body, and closing it resumes the line. It is not labeled `sev0`: only the owner calls a sev0
  (0532). **This waits on the owner:** 0534 lets automation open only `ci-scheduled` issues, and
  the lead has asked him to widen it. Until he does, the build ships the stop without the issue:
  the line stops, the queue comments on the PR that drifted, and the issue part stays out of the
  product, behind the owner's answer, with Q7's issue half.
- **`/merge` pins the head GitHub reports when the comment arrives.** The Worker reads the PR's
  head, its `ci-required` at that head and its files before it hands the Msg on, as bors pins at
  `r+`. A later push to the PR takes it out of the line (`pull_request` `synchronize`).
- **A change whose checks are not green at `/merge` is refused** with a comment, as the ticket
  says. Waiting for running checks is later.
- **Only an App installation token calls GitHub.** The private key and the webhook secret live in
  Cloudflare's Secrets Store, read through Alchemy's `Cloudflare.SecretsStore.ReadSecret`, and
  never stored in the log, the Model or the view (0537's binding constraint).
- **Alchemy's state goes to `Cloudflare.state()`, not `Alchemy.localState()`.** Read in
  `alchemy` 2.0.0-beta.85, `src/State/StateEncoding.ts`: a `Redacted` value is written to state
  as its plain text. With local state, the two secrets would sit in `.alchemy/` on the laptop, a
  key outside the Secrets Store. The Cloudflare state store encrypts state with a key that lives in
  the account's Secrets Store (`@alchemy.run/cloudflare` 2.0.0-beta.85, `src/StateStore/Store.ts`).
- **The RSA key is read as GitHub gives it.** Effect 4.1.2's `KeyFormat.pem(KeyFormat.pkcs1)`
  imports a PKCS#1 PEM (`effect/dist/crypto/KeyFormat.d.ts:156`), and `Signature` signs with
  `rsaPkcs1v15Sha256`. The HMAC is `Mac.verify`, which compares in constant time
  ([the crypto pattern](../../../.patterns/effect-crypto-through-services.md)).
- **Tests use `@kampus/vitest`** (`next/packages/vitest`) from the first commit: its depth
  setting (`runsFor({ fast, full })`), its three test groups (`*.integration.test.ts`,
  `*.visual.test.ts`), and its runner for the same laws on a memory layer and a real layer. This
  plan does not build that package; slice 1 waits for it to land. Each service's `layerMemory`
  stays beside its service.

## The shape

### Package layout

```text
infra/
  AGENTS.md           a short map: next/'s rules hold here, and what differs
  fabrikalfa/         @kampus/fabrikalfa, the one package so far; one Worker
    package.json        scripts: typecheck, deploy (alchemy deploy), dev
    tsconfig.json       extends tsconfig.base.json, like next/'s packages
    vitest.config.ts    @kampus/vitest's shared config
    alchemy.run.ts      the stack: Worker, Fabrikalfa object, two secrets, settings
    README.md
    src/
      Fabrikalfa.ts     the root machine and its wake; Host.ts runs it in the alarm
      blockers/         Blockers.ts, the sev0 child machine
      queue/            Queue.ts (child), Merger.ts (Queue's child), Outcome.ts, Settings.ts, View.ts
      store/            EventStore.ts (contract), EventStoreMemory.ts
      github/           CodeHost.ts, Ci.ts (contracts), CodeHostMemory.ts, CiMemory.ts,
                        CodeHostRest.ts, CiRest.ts, AppToken.ts, Webhook.ts, internal/rest.ts
      cloudflare/       FabrikalfaObject.ts, EventStoreSql.ts, Worker.ts (the Effect Worker)
```

`pnpm-workspace.yaml` gets one line, `- infra/*`. `pnpm -r typecheck` then covers it with no other
change. `.oxlintrc.json`'s `next/**` overrides gain `infra/**`, so `next/`'s lint rules hold here.
`layer-rules.json` gets three layers: `infra-queue` below `infra-github` below `infra-cloudflare`.
`exam-paths.json` gets `infra/**/*.test.ts` and `infra/**/*Test.ts`. CI: `changes.mjs` learns that
an `infra/` path runs check, typecheck and test but no `next/` job, and the root
`vitest.config.ts` includes `infra/*/src/**/*.test.ts` outside the integration group. Every test on
a pull request uses memory layers only (0536); the SQL store's suite runs in local workerd as an
integration test on the 3-hour schedule.

### Settings

Each new choice, asked "is this a setting?" (0069). All live in one Schema with defaults, set once
in `alchemy.run.ts`, and passed to the Worker as one JSON env value, as `ledger-server`'s
`alchemy.run.ts` passes `INSTANCE`.

```ts
// infra/fabrikalfa/src/queue/Settings.ts, a sketch.
export const Settings = Schema.Struct({
  repo: Schema.String,                                  // "kamp-us/tea-fabrika"
  main: Schema.String,                                  // "main"
  staging: Schema.String,                               // "queue/staging": CI runs here (live)
  scratch: Schema.String,                               // "queue/tmp": no CI, where the merge is made
  mode: Schema.Literals(["shadow", "live"]),            // "shadow" until the owner's bypass
  shadow: Schema.Struct({                               // when shadow is done (owner, 2026-11-14)
    matches: Count,                                     // 10 landings in a row whose tree matched
    slow: Count,                                        // 1: at least one of them by the slow path
  }),
  checks: Schema.NonEmptyArray(Schema.NonEmptyString),  // ["ci-required"], the check that decides
  associations: Schema.Array(Schema.Literals(["OWNER", "MEMBER", "COLLABORATOR"])), // may /merge
  labels: Schema.Struct({                               // the label names, as Tide's config holds them
    blocker: Schema.NonEmptyString,                     // "sev0", on an issue (Tide's blocker_label)
    fix: Schema.NonEmptyString,                         // "sev0-fix", on a PR
    stopped: Schema.NonEmptyString,                     // "queue-stopped", the issue a drift opens
  }),
  fast: Schema.Boolean,                                 // true: take the fast path when it holds
  wait: Minutes,                                        // 60: no ci-required by then is infra
  retries: Count,                                       // 1: infra retries before a pause
  pause: Minutes,                                       // 30
  rounds: Count,                                        // 3: re-stages when main moves first
  timeout: Seconds,                                     // 30: an unanswered GitHub call is "sent"
});
```

- `wait` 60 is about 4.8 times the 12.5 minutes one full run took in
  [0106](../../../.decisions/0106-a-pull-requests-checks-finish-in-five-minutes.md), plus the
  start wait 0112 measured (up to 256 s). `rounds` 3 is `next/`'s merger default. `pause` 30 and
  `timeout` 30 are guesses with no data yet; the log records every wait, so the first week gives one.
- **Not settings:** the tree check and the stop on drift (0110 says so), and "never land an
  untested tree" (0537's binding constraint).

### The two services

```ts
// infra/fabrikalfa/src/github/CodeHost.ts: the contract only (0095). Ids reuse next/'s shapes, rewritten here.
export const Staged = Schema.TaggedUnion({
  staged: { main: Commit, head: Commit, commit: Commit, tree: Tree },
  conflict: { main: Commit, head: Commit },
  moved: { head: Commit },                         // the PR's head is not the pinned one
});
export const Merged = Schema.TaggedUnion({
  merged: { commit: Commit },
  moved: { head: Commit },
  main_moved: { main: Commit },                    // main is not the main this was tested on
  refused: { status: Schema.Int },                 // 405: not mergeable, ruleset included
});
export class CodeHost extends Context.Service<CodeHost, {
  readonly change: (pr: Pr) => Effect.Effect<Change, CodeHostError>;          // head, state, paths, behind
  readonly main: () => Effect.Effect<Commit, CodeHostError>;
  /** Repeating with the same main and head answers the same commit while staging still holds it. */
  readonly stage: (to: Branch, main: Commit, head: Commit) => Effect.Effect<Staged, CodeHostError>;
  /** Squash pinned to head, after checking main. Repeating a done merge answers the same commit. */
  readonly merge: (pr: Pr, head: Commit, main: Commit) => Effect.Effect<Merged, CodeHostError>;
  readonly commit: (sha: Commit) => Effect.Effect<{ tree: Tree; parents: ReadonlyArray<Commit> }, CodeHostError>;
  readonly comment: (pr: Pr, body: string) => Effect.Effect<void, CodeHostError>;
  /** The open issues with this label: the rebuild of the freeze on start. */
  readonly blockers: (label: string) => Effect.Effect<ReadonlyArray<Issue>, CodeHostError>;
  /** Opens the drift issue. Repeating answers the open issue it already made for this commit. */
  readonly stop: (label: string, title: string, body: string) => Effect.Effect<Issue, CodeHostError>;
}>()("@kampus/fabrikalfa/github/CodeHost") {}
// Change also carries the PR's labels, so the line knows each entry's `sev0-fix` from /merge on.

// infra/fabrikalfa/src/github/Ci.ts: next/'s word for the service that says how checks went at a commit.
export class Ci extends Context.Service<Ci, {
  readonly at: (commit: Commit, name: string) => Effect.Effect<ReadonlyArray<CheckRun>, CiError>;
}>()("@kampus/fabrikalfa/github/Ci") {}
```

`CodeHostError` and `CiError` carry a tagged `reason` (`unavailable`, `rate_limited`,
`refused`) with the cause kept, as `next/`'s do. Every answer also carries `took` (ms) and
`remaining` (GitHub's `x-ratelimit-remaining`), so the log records both.

| Layer | What it is | Runs on |
|---|---|---|
| `CodeHostMemory.layer(world)` | A small git model: commits with trees as path maps, refs, PRs, a three-way merge on paths | every PR |
| `CodeHostRest.layer` | GitHub's REST API through Effect's `HttpClient`, with an `AppToken` | every PR, against recorded responses on a test `HttpClient`; the live run is later (Records) |
| `CiMemory.layer(world)` and `CiRest.layer` | the same pair for check runs | the same |

The laws: one suite per service, written once, run on both layers with `@kampus/vitest`'s runner.

### The machines: one tree, Elm's shape

fabrikalfa is one state machine. One root tea machine, `Fabrikalfa`, owns the Durable Object's
whole state. Every webhook and every alarm is a Msg to it. Each feature is a child machine the root
steps by hand with the child's own `update` ([Elm first](../../../docs/direction/elm-first.md):
"parents are written by hand"). Every GitHub call is a Cmd an `update` returns, and the host runs
it in the alarm; no `update` runs an effect. The event log stores the root's Msgs only, and the
fold of that log through the root rebuilds the whole tree.

```text
Fabrikalfa (root)          infra/fabrikalfa/src/Fabrikalfa.ts
  blockers: Blockers       infra/fabrikalfa/src/blockers/Blockers.ts   the sev0 issues
  queue:    Queue          infra/fabrikalfa/src/queue/Queue.ts         the line, main, red main
    current: Merger        infra/fabrikalfa/src/queue/Merger.ts        one change
```

**The sev0 blocker is its own child, `Blockers`, not a part of the root's model.** It has its own
states (`unread` until the open `sev0` issues are read, then `known`), its own Cmd (the read), its
own Msgs (the `issues` events) and its own rule (rebuild on start). In the root it would be control
state with transitions outside any machine, which 0037 and 0046 rule out. And it is a fabrikalfa
feature of its own: later features (chat commands) read it too, and `Queue` stays free of issue
events. The cost: `Queue` keeps a copy of what it needs, `sev0`, which the root forwards each time
`Blockers` changes. That is Elm's out-message: the parent turns one child's change into a Msg for
another. Law R2 holds the copy equal to the source after every step.

```ts
// infra/fabrikalfa/src/Fabrikalfa.ts, the root. A sketch on @demlik/tea 0.25.0.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import * as Blockers from "./blockers/Blockers.ts";
import * as Queue from "./queue/Queue.ts";

export const Model = Schema.Struct({ blockers: Blockers.Model, queue: Queue.Model });

// The root's Msgs are the log's entries: what GitHub sent, the alarm, and each Cmd's answer.
export const Msg = Schema.Union([
  ...Queue.Inputs,      // entered, left, main_moved, checked, labels, resumed, enqueued
  ...Blockers.Inputs,   // blocker
  Timer,                // { type: "timer", at }
  ...Queue.Answers,     // change_ok/_err, stage_, checks_, merge_, commit_, comment_, stop_
  ...Blockers.Answers,  // blockers_ok/_err
]);

export const fabrikalfa = (settings: Settings) => {
  const queue = Queue.queue(settings);
  const toQueue = (s: Model, m: Queue.Msg): Cell => {
    const [next, cmds] = applyCell(queue, s.queue, m);
    return [{ ...s, queue: next }, cmds];
  };
  const toBlockers = (s: Model, m: Blockers.Msg): Cell => {
    const [blockers, cmds] = applyCell(Blockers.blockers(settings), s.blockers, m);
    if (Blockers.same(s.blockers, blockers)) return [{ ...s, blockers }, cmds];
    // The out-message: Queue learns the new freeze. Made here, so never logged; the fold makes it again.
    const [next, more] = applyCell(queue, s.queue, { type: "sev0", view: Blockers.view(blockers) });
    return [{ blockers, queue: next }, [...cmds, ...more]];
  };
  const both = (s: Model, m: Timer): Cell => {
    const [b, bc] = toBlockers(s, m);
    const [q, qc] = toQueue(b, m);
    return [q, [...bc, ...qc]];
  };
  return Machine.make({
    model: Model,
    msg: Msg,
    cmds: [...Queue.cmds, ...Blockers.cmds],   // names are distinct across children (law T1)
    init: (saved) => [saved ?? { blockers: Blockers.empty, queue: Queue.empty }, []],
    update: {
      timer: both,
      blocker: toBlockers, blockers_ok: toBlockers, blockers_err: toBlockers,
      entered: toQueue, left: toQueue, main_moved: toQueue, checked: toQueue, labels: toQueue,
      resumed: toQueue, enqueued: toQueue,
      change_ok: toQueue, change_err: toQueue, stage_ok: toQueue, stage_err: toQueue,
      checks_ok: toQueue, checks_err: toQueue, merge_ok: toQueue, merge_err: toQueue,
      commit_ok: toQueue, commit_err: toQueue, comment_ok: toQueue, comment_err: toQueue,
      stop_ok: toQueue, stop_err: toQueue,
    },
  });
};

/** When the alarm should fire next: the earliest wait anywhere in the tree, or null. */
export const wake = (s: Model) => earliest(Blockers.wake(s.blockers), Queue.wake(s.queue));
```

```ts
// infra/fabrikalfa/src/blockers/Blockers.ts, the sev0 child.
const Model = Schema.TaggedUnion({
  unread: { call: Call },                        // on start: read the open sev0 issues first
  known: { issues: Schema.Array(Issue) },        // empty means no sev0 freeze
});
// blocker { issue, open: boolean } adds or removes one issue. blockers_ok sets the whole list.
// view(model) is what Queue needs: { _tag: "unread" } or { _tag: "known", issues }.

// infra/fabrikalfa/src/queue/Queue.ts, the queue child: the line, main, a red main, and Merger.
const Red = Schema.NullOr(Schema.Struct({ main: Commit, since: Ms }));  // ci-required red on main's head
const shared = { line: Line, red: Red, sev0: Blockers.View, late: Count };  // sev0: the root's copy
const Model = Schema.TaggedUnion({
  idle:    { ...shared, main: Schema.NullOr(Commit) },
  landing: { ...shared, main: Commit, current: Merger.Model },
  stopped: { ...shared, main: Commit, reason: Stop, issue: Schema.NullOr(Issue) }, // closing the issue resumes
});
// Line is unique by pr, each entry keeps its labels, and the current entry is never also in
// the line (a Schema filter). Which entry may go next is one pure function of line, red, sev0:
//   sev0 unread              -> none
//   a sev0 issue open        -> the first entry labeled sev0-fix
//   red                      -> the first entry entered with /merge fix, or docs-only
//   otherwise                -> the first entry
// Queue steps Merger by hand the same way: it passes each Merger Msg to Merger's update, and
// turns Merger's Reply (landed, failed, conflict, moved, closed, behind, drift, shadowed) into its
// own next state. A Reply is made in the step, never logged.

// infra/fabrikalfa/src/queue/Merger.ts, the merger child: one change, from reading to verified.
const Call = Schema.TaggedUnion({                  // one GitHub call a state owes
  owed: { due: Ms },                               // decided; the next alarm sends it
  sent: { attempt: Count, due: Ms },               // may have left; an answer by due, or send again
});
const Model = Schema.TaggedUnion({
  reading:   { entry: Entry, call: Call },                                 // change(): open, head, behind
  staging:   { entry: Entry, main: Commit, round: Count, infra: Count, call: Call },
  checking:  { entry: Entry, main: Commit, commit: Commit, tree: Tree, round: Count, infra: Count, until: Ms },
  merging:   { entry: Entry, main: Commit, tree: Tree, path: Schema.Literals(["fast", "slow"]), call: Call },
  verifying: { entry: Entry, main: Commit, tree: Tree, commit: Commit, call: Call },
  paused:    { entry: Entry, until: Ms },                                  // second infra
});
```

**Elm's Sub, here.** A wait in Elm is a Sub. In a Durable Object nothing stays awake (0105), so the
one time Sub is `wake(model)`: the host turns it into the object's single alarm, and the alarm comes
back as a `timer` Msg. Webhooks are the other way in, like Elm's ports. Neither is an effect inside
`update`.

**One Msg traced through the tree.** PR 1280's checks have passed on staging commit `s1`, so
`Merger` is `merging { main: m1, tree: t1, path: "slow", call: owed(due: 10:00) }`. The alarm fires
at 10:00.

1. The host appends `{ type: "timer", at: 10:00 }` and steps the root.
2. Root `update.timer` is `both`: it steps `Blockers` first. `Blockers` is `known { issues: [] }`
   and owes nothing, so it returns itself and no Cmd.
3. Then the root steps `Queue` with the same `timer`. `Queue` is `landing`, so it passes the
   `timer` to `Merger`'s `update`.
4. `Merger` is `merging` with `call: owed`, due now. It returns `merging { call: sent { attempt: 1,
   due: 10:00:30 } }` and one Cmd:
   `merge({ attempt: 1, pr: 1280, head: h1, main: m1 })`.
5. `Queue` wraps the new `Merger` model in `landing { current }` and hands the Cmd up. The root
   puts the new `queue` in its model and returns `[model, [merge(...)]]`.
6. The host caches the model in the same transaction as the log entry, then runs the Cmd:
   `CodeHost.merge(1280, h1, m1)`. Its answer becomes the next root Msg,
   `merge_ok { cmd: { attempt: 1, ... }, value: { _tag: "merged", commit: c1 } }`, which the root
   routes to `Queue`, and `Queue` to `Merger`: `verifying { commit: c1, call: owed }`.

| Msg | From | What it does |
|---|---|---|
| `entered` | `/merge` comment, enriched | Queue: joins the line, or is refused (not green, not allowed, already in) |
| `left` | `pull_request` `synchronize` or `closed` | Queue: takes the change out; the current one ends as `moved` or `closed` |
| `main_moved` | `push` to main | Queue: records main; a merger in `checking` stages again next round |
| `checked` | `check_run` `completed` for a name in `checks` | Queue: pass, fail or infra for that commit; on main's head it sets or lifts `red` |
| `blocker` | `issues` `opened`, `labeled`, `reopened` with `sev0`; `closed`, `unlabeled` | Blockers: adds or removes that issue; the root forwards the change to Queue |
| `resumed` | `issues` `closed` on the open `queue-stopped` issue | Queue: leaves `stopped`; the line goes on |
| `labels` | `pull_request` `labeled`, `unlabeled` | Queue: updates that entry's labels, `sev0-fix` among them |
| `enqueued` | `pull_request` `enqueued` (shadow only) | Queue: enters the change as GitHub's queue took it |
| `timer` | the alarm | both children: each sends its `owed` calls, sends again each `sent` call past due, ends `until` waits |
| `<cmd>_ok`, `<cmd>_err` | the host, for `change`, `main`, `stage`, `checks`, `merge`, `commit`, `comment`, `stop` (Queue) and `blockers` (Blockers) | tea's settled answers, with the `attempt` they answer, routed to the child that made the Cmd |

Inputs carry both clocks, `sentAt` (GitHub's time) and `arrivedAt` (the Worker's), and the
`delivery` id. 0537's sketch names map onto these: `entered` is `entered`, `staged` is `stage_ok`,
`checked` is `checked` (or `checks_ok` from a poll), and `landed` is the `commit_ok` that matched
the tree.

### The host, one wake

```ts
// infra/fabrikalfa/src/Host.ts, a sketch. EventStore.step steps the root inside one storage transaction.
export const alarm = Effect.fnUntraced(function* (now: number) {
  const store = yield* EventStore;
  let cell = yield* store.step({ type: "timer", at: now });     // append, fold, cache, in one go
  for (let turn = 0; turn < 8 && cell.cmds.length > 0; turn++) {
    const answers = yield* Effect.forEach(cell.cmds, interpret, { concurrency: 1 });
    for (const answer of answers) cell = yield* store.step(answer);
  }
  yield* store.alarm(Fabrikalfa.wake(cell.model));              // null deletes it
});
```

`interpret` maps each Cmd to its service call with `timeout` seconds, and a failure becomes the
`_err` Msg, never a thrown error. `EventStore.step` skips an input whose `delivery` id it has
already logged, so a webhook GitHub sends twice is one entry.

```ts
// infra/fabrikalfa/src/store/EventStore.ts: the contract.
export class EventStore extends Context.Service<EventStore, {
  readonly step: (msg: Msg) => Effect.Effect<Cell, EventStoreError>;   // [model, cmds] after the msg
  readonly entries: (from?: number) => Effect.Effect<ReadonlyArray<Logged>, EventStoreError>;
  readonly alarm: (at: number | null) => Effect.Effect<void, EventStoreError>;
}>()("@kampus/fabrikalfa/store/EventStore") {}
// EventStoreSql: tables `entries (seq INTEGER PRIMARY KEY, delivery TEXT UNIQUE, at INTEGER, body TEXT)`
// and `model (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER, body TEXT)`. A cached model that
// does not decode is dropped and the log folded again: the cache is rebuildable, the log is not.
```

### The Worker and the object

```ts
// infra/fabrikalfa/src/cloudflare/FabrikalfaObject.ts: thin (0041), modular form.
export class FabrikalfaObject extends Cloudflare.DurableObject<FabrikalfaObject, {
  readonly send: (msg: Msg) => Effect.Effect<void>;   // step, set the alarm to now if anything is owed
  readonly view: () => Effect.Effect<View>;
}>()("Fabrikalfa") {}
// FabrikalfaLive = FabrikalfaObject.make(...): takes Cloudflare.DurableObjectState, builds
// EventStoreSql over state.storage, and hands `alarm` to Host.alarm. One instance, named by repo.

// infra/fabrikalfa/src/cloudflare/Worker.ts: the Effect Worker's fetch.
//   POST /github  read the raw body; Webhook.verify(secret, body, header) or 401 with nothing kept;
//                 Webhook.decode(event, payload) -> Msg | null; enrich /merge; queue.send(msg); 202
//   GET  /queue   the view as JSON: the line, the current state, red, the sev0 issues, main. No secret.
```

GitHub gives a webhook 10 seconds. `send` only appends and arms; the GitHub calls run in the alarm.
The `/merge` enrichment is three reads (PR, its `ci-required`, its files), about a second.

### Shadow and live

| Mode | Enters on | Builds | CI runs | Merges | Records |
|---|---|---|---|---|---|
| shadow | `/merge`, and GitHub's queue taking a PR (`enqueued`) | `merge(main, head)` on `queue/tmp` only | none | never | `shadowed`: its path (fast or slow), its tree, and GitHub's landed tree when that push comes, equal or not |
| live | `/merge` | `queue/tmp`, then moves `queue/staging` to that commit | on `queue/staging` only | squash pinned to head | every step above |

Shadow costs $0 in CI: no branch it writes starts a run. It proves the webhook path, the
signature, the App token, the fold, the staging call and the tree prediction against what GitHub's
queue landed. Live needs one CI change: `.github/workflows/check.yaml` runs on `push` to
`queue/staging`, takes `BASE` as the commit's first parent (main), and scopes jobs as for
`merge_group`.

## One value traced

PR 1280 changes `next/` code. Main is `m1`. Mode is live, main is green, no `sev0` issue is open, and the line is empty.

1. The owner comments `/merge`. GitHub sends `issue_comment` with delivery `d1`. The Worker checks
   the signature, reads the PR (head `h1`, behind main by 2), `ci-required` at `h1` (success) and
   the files (code). It sends `entered { pr: 1280, head: h1, by, fix: false, kind: "code",
   green: true, behind: 2, delivery: d1, sentAt, arrivedAt }`.
2. The object steps it: `Queue` was `idle`, so the entry starts `Merger.reading { call: owed(now) }`.
   No Cmd. The log has one entry. The alarm is set to now.
3. The alarm steps `timer`: the owed read is sent as `change(1280)`, call becomes `sent { attempt: 1 }`.
   The answer `change_ok { head: h1, open, behind: 2 }`: behind is not 0, so the fast path does not
   hold. `staging { main: m1, round: 0, infra: 0, call: owed }`. The same wake sends `stage(queue/staging, m1, h1)`.
4. `stage_ok { commit: s1, tree: t1 }`: `checking { commit: s1, tree: t1, until: now + 60 min }`.
   No Cmd is owed, so the wake ends with the alarm at `until`.
5. GitHub Actions runs `check` on `s1`. Its `ci-required` completes with `success`; the webhook gives
   `checked { commit: s1, result: pass }`. `merging { main: m1, tree: t1, path: "slow", call: owed }`.
6. The alarm sends `merge(1280, h1, m1)`: main is still `m1`, so it squashes pinned to `h1` and
   answers `merge_ok { commit: c1 }`. `verifying { commit: c1, call: owed }`.
7. `commit(c1)` answers `{ tree: t1, parents: [m1] }`: the tree is the tested tree. The child
   replies `landed`; the parent sets main to `c1`, posts one comment, and goes `idle`.

If step 6's answer is lost, the Model still says `merging { call: sent { attempt: 1 } }`. The next
alarm sends `merge` again; the PR is merged, so the REST layer answers the same `c1`. If step 5 had
been `cancelled`, the change is staged again with `infra: 1`; a second infra pauses the line 30
minutes. If step 7 found tree `t2`, the parent goes `stopped { drift }`, opens a `queue-stopped`
issue with both trees, and waits for that issue to close.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| Q1, the fold: folding the log of root Msgs from empty gives the cached root Model, the whole tree, for any Msg sequence, default runs | test | @demlik/tea/pbt.arbMsgSequence: the root's Msgs, answers with any attempt | save the cache before the step: Q1 red | infra/fabrikalfa/src/queue/Queue.laws.test.ts |
| Q2, no effect in update: at the root, every Msg but `timer` and a Cmd answer returns no Cmd, default runs | test | @demlik/tea/pbt.arbMsgSequence: the root's Msgs | send `change` straight from `entered`: red | infra/fabrikalfa/src/queue/Queue.laws.test.ts |
| Q3, never an untested tree: across generated GitHub worlds, every `merge` Cmd follows a pass on a staging commit of that main and head, or the fast path's proof, and every `landed` has the tested tree, 200 runs | test | fc.record: PR heads, main moves, check conclusions, lost answers, in fc.shuffledSubarray order | merge from `checking` before the pass: red; skip the tree compare: red | infra/fabrikalfa/src/queue/Queue.laws.test.ts |
| Q4, three outcomes: only `success` is pass, only `failure` is fail, every other conclusion and no run by `until` is infra, default runs | test | fc.constantFrom: every check conclusion and no run | map `timed_out` to fail: red | infra/fabrikalfa/src/queue/Outcome.test.ts |
| Q5, infra is retried once and never charged: one infra stages again, two pause the line, and no comment says failed, default runs | test | @demlik/tea/pbt.arbMsgSequence: infra answers among others | pause on the first infra: red; comment "failed" on infra: red | infra/fabrikalfa/src/queue/Merger.laws.test.ts |
| Q6, the freeze: with no `sev0` issue open and main green, the line lands in order; while any `sev0` issue is open only `sev0-fix` PRs land; with main red only `/merge fix` or docs-only changes land; the rest keep their order, default runs | test | fc.record: a line of entries with kind, fix and labels, open and closed sev0 issues, main red or green | let an unlabeled PR through an open `sev0` issue: red; end the freeze when one of two issues closes: red | infra/fabrikalfa/src/queue/Queue.laws.test.ts |
| B1, the freeze rebuilds from GitHub: from an empty log, or after the cache is dropped, nothing lands until the open `sev0` issues are read, and the rebuilt freeze equals the one the label events built live, default runs | test | @demlik/tea/pbt.arbMsgSequence: issue and label events, then a cleared log and a `blockers_ok` | land before `blockers_ok`: red | infra/fabrikalfa/src/blockers/Blockers.laws.test.ts |
| R1, the root routes: each root Msg reaches exactly the child that owns it, `timer` reaches both, and each Cmd answer reaches the child that made the Cmd, default runs | test | @demlik/tea/pbt.arbMsgSequence: the root's Msgs | route `stage_ok` to Blockers: red | infra/fabrikalfa/src/Fabrikalfa.laws.test.ts |
| R2, the copy holds: after every root step, Queue's `sev0` equals `Blockers.view` of the root's `blockers`, and the forwarded `sev0` Msg is never in the log, default runs | test | @demlik/tea/pbt.arbMsgSequence: the root's Msgs, issue events among them | skip the forward when an issue closes: red; log the forwarded Msg: Q1 and R2 red | infra/fabrikalfa/src/Fabrikalfa.laws.test.ts |
| Q7, drift stops the line: a landed tree that is not the tested tree stops the queue and opens one `queue-stopped` issue, and no landing Cmd follows until that issue closes, default runs | test | fc.record: tested and landed trees, later Msgs | answer `landed` on a tree mismatch: red; resume on another issue's close: red | infra/fabrikalfa/src/queue/Queue.laws.test.ts |
| Q8, a send with no answer: a `sent` call past `due` is sent again, a late answer only counts `late`, default runs | test | @demlik/tea/pbt.arbMsgSequence: answers dropped, delayed and doubled | apply a late answer: red | infra/fabrikalfa/src/queue/Merger.laws.test.ts |
| Q9, `wake` is the earliest `due` or `until`, and null when nothing waits, default runs | test | @demlik/tea/pbt.arbMsgSequence: Queue's Msgs | return the latest due: red | infra/fabrikalfa/src/queue/Queue.laws.test.ts |
| Q10, shadow never merges: in shadow mode no `merge` Cmd is made and no `stage` names `queue/staging`; shadow is done only after `matches` matching landings in a row with at least `slow` by the slow path, and a mismatch resets the count, default runs | test | @demlik/tea/pbt.arbMsgSequence: Queue's Msgs with settings mode shadow | stage on `staging` in shadow: red | infra/fabrikalfa/src/queue/Queue.laws.test.ts |
| S1, the store: steps append in order, the cache equals the fold, a repeated delivery id is one entry, a failed step writes nothing, and a cache that does not decode is rebuilt, 50 runs | test | fc.array: Msgs with delivery ids drawn from a small set | append outside the transaction: red | infra/fabrikalfa/src/store/EventStoreTest.ts, run in EventStoreMemory.test.ts on PRs and in infra/fabrikalfa/src/cloudflare/EventStoreSql.integration.test.ts on the schedule |
| G1, CodeHost's contract: stage and merge are safe to repeat, merge pins the head and checks main, a conflict answers `conflict`, `behind` matches the commit graph, on the memory layer and on the REST layer, 50 runs | test | fc.record: small commit graphs and PRs on the memory layer | merge without the main check: red | infra/fabrikalfa/src/github/CodeHostTest.ts, run in infra/fabrikalfa/src/github/CodeHost.laws.test.ts |
| G2, the REST layer reads GitHub's real answers: each endpoint's recorded response decodes to the contract's answer, 201, 204, 405 and 409 included | test | vector: one recorded response per endpoint and status, from a real call | read `merge` 405 as merged: red | infra/fabrikalfa/src/github/CodeHostRest.test.ts |
| G3, the signature: a body signed with the secret passes; any changed byte in body or header, a missing header, or another secret fails with 401 and nothing appended, 200 runs | test | fc.uint8Array: bodies and secrets, with one byte flipped | compare with `===` on strings: the timing law of Mac does not hold, and the flipped-header case passes: red | infra/fabrikalfa/src/github/Webhook.laws.test.ts |
| G4, `/merge` is read only from its first line, `/merge` or `/merge fix`, on a PR, by an association in `associations`, 200 runs | test | fc.string: comment bodies around the two commands | accept `/merge` on an issue: red | infra/fabrikalfa/src/github/Webhook.laws.test.ts |
| G5, events decode: each recorded payload gives its Msg, `issues` and label events included, and an event this queue does not use gives null | test | vector: one recorded payload per event and action | drop `synchronize`: red | infra/fabrikalfa/src/github/Webhook.test.ts |
| W1, the Worker: a bad signature answers 401 and sends nothing, a good one answers 202 and sends one Msg, `GET /queue` answers the view, on memory layers | test | scenario: the Worker's fetch with memory layers and a recorded payload | send before the check: red | infra/fabrikalfa/src/cloudflare/Worker.test.ts |
| X1, [secrets] the private key, the webhook secret and the installation token never appear in a log entry, the Model, the view, a comment body, a span attribute or an error message, 100 runs | test | fc.string: generated secrets planted in every call and failure path | put the token in a `CodeHostError` message: red | infra/fabrikalfa/src/Secrets.laws.test.ts |
| K1, docs-only is CI's own rule: `kind` is docs exactly when `classify(paths, "merge_group")` starts no job but `field`, and changes.mjs's tests still pass on the moved helpers, 200 runs | test | fc.array: repo paths from the classifier's own path tables | call a hand list of globs: red | infra/fabrikalfa/src/queue/Outcome.test.ts and .github/ci/changes.test.ts |
| C1, live CI: a push to `queue/staging` runs check with `BASE` as the first parent and the `merge_group` scope; no other `queue/` branch starts a run | test | scenario: workflow-lint.ts over check.yaml | drop the first-parent `BASE`: red | .github/ci/workflow-lint.test.ts |
| C2, an `infra/` path runs check, typecheck and test, and no `next/` job, 200 runs | test | fc.array: infra/ paths mixed with docs | classify infra/ as unknown: every job runs: red | .github/ci/changes.test.ts |
| L1, `infra/**` keeps `next/`'s lint rules and its layers | lint | lint | add a Promise in infra/fabrikalfa/src/queue: `pnpm lint` fails | .oxlintrc.json and layer-rules.json |
| T1, a Msg's `type` names its handler: the root, `Blockers`, `Queue` and `Merger` handle every Msg type, and Cmd names are distinct across children, checked by `Machine.make`'s types | type | type | drop a handler: typecheck fails | infra/fabrikalfa/src/queue/Queue.ts |

Every plant is run once by the tests step and recorded in its report and run row, never committed.
The fixed vectors in G2 and G5 come from real calls: the build records them once from the owner's
App on a throwaway branch, labeled `vector:` with the call and date, before it relies on them.

**No host-only law.** Nothing here needs the owner's Mac. Two checks need the owner's account and
come after his settings, outside the laws: the first deploy, and the first shadow day's
`shadowed` rows read by the lead.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `pnpm-workspace.yaml` | tests | 1 | `- infra/*` |
| `infra/fabrikalfa/package.json` | build | 30 | the package, its catalog dependencies and `@kampus/vitest` |
| `infra/fabrikalfa/tsconfig.json` | build | 10 | as `next/`'s packages |
| `infra/fabrikalfa/vitest.config.ts` | tests | tests | `@kampus/vitest`'s shared config |
| `infra/AGENTS.md` | build | docs | short map: `next/`'s rules hold, imports nothing from either version, secrets rule |
| `infra/fabrikalfa/README.md` | build | docs | what runs, how to deploy, the two owner settings |
| `infra/fabrikalfa/alchemy.run.ts` | build | 70 | Worker, `Fabrikalfa` object, two secrets, `Cloudflare.state()`, settings |
| `infra/fabrikalfa/src/Fabrikalfa.ts` | build | 90 | the root machine: routing, the `sev0` forward, `wake` |
| `infra/fabrikalfa/src/blockers/Blockers.ts` | build | 70 | the sev0 child machine and its `view` |
| `infra/fabrikalfa/src/queue/Settings.ts` | build | 40 | the Schema and defaults |
| `infra/fabrikalfa/src/queue/Queue.ts` | build | 200 | the queue child machine and its `wake` |
| `infra/fabrikalfa/src/queue/Merger.ts` | build | 220 | the child machine |
| `infra/fabrikalfa/src/queue/Outcome.ts` | build | 40 | pass, fail, infra; `kind` through `paths.mjs` |
| `infra/fabrikalfa/src/queue/View.ts` | build | 30 | what `GET /queue` shows |
| `infra/fabrikalfa/src/store/EventStore.ts` | build | 40 | the contract |
| `infra/fabrikalfa/src/store/EventStoreMemory.ts` | build | 50 | the memory layer |
| `infra/fabrikalfa/src/Host.ts` | build | 80 | one wake: step, interpret, arm |
| `infra/fabrikalfa/src/github/CodeHost.ts` | build | 90 | the contract |
| `infra/fabrikalfa/src/github/Ci.ts` | build | 40 | the contract |
| `infra/fabrikalfa/src/github/CodeHostMemory.ts` | build | 150 | the small git model |
| `infra/fabrikalfa/src/github/CiMemory.ts` | build | 30 | check runs in memory |
| `infra/fabrikalfa/src/github/CodeHostRest.ts` | build | 180 | REST calls, safe to repeat |
| `infra/fabrikalfa/src/github/CiRest.ts` | build | 40 | REST check runs |
| `infra/fabrikalfa/src/github/AppToken.ts` | build | 60 | JWT with `Signature`, the installation token, cached for the wake |
| `infra/fabrikalfa/src/github/Webhook.ts` | build | 120 | `verify` with `Mac`, `decode` with Schema, the `/merge` grammar |
| `infra/fabrikalfa/src/github/internal/rest.ts` | build | 50 | one request helper: auth, status, `took`, `remaining` |
| `infra/fabrikalfa/src/cloudflare/FabrikalfaObject.ts` | build | 50 | the object class and its `.make()` |
| `infra/fabrikalfa/src/cloudflare/EventStoreSql.ts` | build | 90 | the SQL layer over `state.storage` with its Effect `transaction` |
| `infra/fabrikalfa/src/cloudflare/Worker.ts` | build | 90 | the Effect Worker's fetch, enrichment, secrets |
| `infra/fabrikalfa/src/Fabrikalfa.laws.test.ts` | tests | tests | Q1, Q2, R1, R2 |
| `infra/fabrikalfa/src/blockers/Blockers.laws.test.ts` | tests | tests | B1 |
| `infra/fabrikalfa/src/queue/Queue.laws.test.ts` | tests | tests | Q3, Q6, Q7, Q9, Q10 |
| `infra/fabrikalfa/src/queue/Merger.laws.test.ts` | tests | tests | Q5, Q8 |
| `infra/fabrikalfa/src/queue/Outcome.test.ts` | tests | tests | Q4, K1 |
| `infra/fabrikalfa/src/store/EventStoreTest.ts` | tests | tests | S1, the shared suite |
| `infra/fabrikalfa/src/store/EventStoreMemory.test.ts` | tests | tests | S1 on memory |
| `infra/fabrikalfa/src/cloudflare/EventStoreSql.integration.test.ts` | tests | tests | S1 in local workerd, schedule only |
| `infra/fabrikalfa/src/github/CodeHostTest.ts` | tests | tests | G1, the shared suite |
| `infra/fabrikalfa/src/github/CodeHost.laws.test.ts` | tests | tests | G1 on both layers |
| `infra/fabrikalfa/src/github/CodeHostRest.test.ts` | tests | tests | G2 |
| `infra/fabrikalfa/src/github/Webhook.laws.test.ts` | tests | tests | G3, G4 |
| `infra/fabrikalfa/src/github/Webhook.test.ts` | tests | tests | G5 |
| `infra/fabrikalfa/src/github/vectors/` | tests | tests | recorded responses and payloads, labeled with call and date |
| `infra/fabrikalfa/src/cloudflare/Worker.test.ts` | tests | tests | W1 |
| `infra/fabrikalfa/src/Secrets.laws.test.ts` | tests | tests | X1 |
| `.github/ci/paths.mjs` | tests | 120 | moved, unchanged: `classify` and its pure helpers, no `node:` import |
| `.github/ci/changes.mjs` | tests | 15 | imports `paths.mjs`; `infra/` paths run check, typecheck and test |
| `.github/ci/changes.test.ts` | tests | tests | C2, K1's CI half |
| `.github/ci/package.json` | tests | 3 | exports `./paths.mjs` |
| `.github/workflows/check.yaml` | tests | 15 | slice 4: `push` to `queue/staging`, first-parent `BASE`, `merge_group` scope |
| `.github/ci/workflow-lint.ts` | tests | 15 | slice 4: holds the new trigger and `BASE` |
| `.github/ci/workflow-lint.test.ts` | tests | tests | C1 |
| `vitest.config.ts` | tests | 2 | includes `infra/*/src/**/*.test.ts`, minus the integration group |
| `exam-paths.json` | tests | 2 | `infra/**/*.test.ts`, `infra/**/*Test.ts` |
| `.oxlintrc.json` | tests | 4 | `next/**` overrides also cover `infra/**` |
| `layer-rules.json` | tests | 12 | three `infra-` layers |
| `.glossary/TERMS.md` | build | docs | staging branch, shadow mode, infra (the outcome), fast path, merge blocker (Tide's word), a new `infra/` section |
| `docs/plan/README.md` | build | docs | where we are: `infra/` and its slices (0013) |
| `package.json` | tests | none | not changed: `pnpm -r typecheck` and `pnpm lint` already reach a new workspace package |
| `tsconfig.base.json` | tests | none | not changed: `infra/fabrikalfa/tsconfig.json` extends it |

## Validation

- The tests step: `pnpm format`, then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on the
  `infra/` test files and `.github/ci/changes.test.ts` and `workflow-lint.test.ts`, then
  `pnpm lint`. Each plant, run once, recorded. No live GitHub and no Cloudflare call.
- The lead: one `pnpm typecheck` and the leak grep, outside any box.
- After slice 3 lands, the deploy and the shadow day are the owner's and the lead's, as below.

## Rollout, in the order the owner sees it

1. **Slices 1 and 2 land.** Nothing runs anywhere yet.
2. **Slice 3 lands, and the owner deploys from his Mac:** `pnpm --filter @kampus/fabrikalfa deploy`
   with the App's private key and a new webhook secret in the shell's environment for that one
   command. Alchemy writes both into the Secrets Store. Mode is `shadow`.
3. **Waits on the owner: the App's webhook URL** set to the Worker's `/github`, with the same
   webhook secret, and the events `issue_comment`, `pull_request`, `push`, `check_run` and
   `issues`.
4. **Shadow beside GitHub's queue.** People keep landing through GitHub's queue. For every PR it
   takes, the queue predicts its path and tree and records whether GitHub's landed tree matched.
   The lead reads the `shadowed` rows and writes a field note. Shadow is done after `matches`
   (10) landings in a row whose predicted tree matched, at least `slow` (1) of them by the slow
   path; if none of the ten is slow, it waits for one more that is. One mismatch starts the count
   again. The view shows the count, so nobody counts by hand (owner, 2026-11-14).
5. **Slice 4 lands:** the CI trigger on `queue/staging`, live merging, comments, and the
   `queue-stopped` issue if the owner has widened 0534 by then. Still in shadow until the next step. The `sev0` freeze works from slice 3
   on, since shadow reads it too; the lead creates the `sev0`, `sev0-fix` and `queue-stopped`
   labels once.
   **Waits on the owner:** widening 0534 so the queue may open its `queue-stopped` issue.
6. **Waits on the owner: the App bypassing the ruleset** on main, so its squash is accepted while
   GitHub's queue is still on. Then `mode` goes to `live` in `alchemy.run.ts`, one deploy, and
   people use `/merge`. A PR that still goes through GitHub's queue while live may race; the tree
   check stops the line if it does.
7. **Not decided here:** when GitHub's queue is turned off (0537).

## Size

Four pull requests, each lands whole, in the order above. About 1,700 product lines in all.

1. The package and the machines: `infra/` wiring, `Settings`, the root `Fabrikalfa`, `Blockers`, `Queue`, `Merger`, `Outcome`,
   `EventStore` with its memory layer, `Host`, Q1 to Q10, R1, R2, B1, S1 on memory, the lint, layer, exam,
   vitest and CI path rows, and `paths.mjs`: about 750 lines. Waits for `@kampus/vitest`.
2. The GitHub services: both contracts, memory and REST layers, `AppToken`, `Webhook`, the recorded
   vectors, G1 to G5 and X1 for these files: about 500 lines.
3. The Worker, the object, the SQL store, the Alchemy stack, shadow mode, `GET /queue`, W1, S1 on
   workerd, and the README: about 300 lines.
4. Live: `check.yaml`'s trigger, the live merge path and its comments, the `queue-stopped` issue, C1:
   about 150 lines.

Priced from ticket 290's lane, the nearest in size (tests $11.79 and $14.45, build $27.95, review
$5.97, a fix round $6.62, list dollars, `field/runs/`), and ticket 502's pull requests (tests $1.51 to
$3.84, build $0.66 to $7.65, review $4.37 to $5.09). Slices 1 and 2 are like 290; 3 and 4 are like
ticket 502's. Expected: about $45 each for 1 and 2, $18 each for 3 and 4, and three fix rounds at $7.
Confidence 70%: the doubts are the Alchemy object and Worker shapes (named below, not yet run here
on this exact form) and how big the memory git model gets.

Estimate: 15 steps, $147

## Records

- **What is lost if not written now:** for every entry, who entered it, both clocks, GitHub's
  delivery id, the pinned head, the main and staging commit it was tested on, the check run's id,
  URL and conclusion, every infra retry and pause, the landed commit and tree, and in shadow the
  predicted path and tree beside what GitHub landed. Each is in the log from its first day; none
  can be rebuilt later. Every GitHub answer also records `took` and `remaining`.
- Derived later from the log: time in each state, the line's length over time, fast-path share.
- `field/runs/` rows for each step, written by the lead; a field note for the shadow day.
- `.glossary/TERMS.md` and `docs/plan/README.md`, as in the files table.
- No `.decisions/` file: 0537 is the decision. The owner's answers to the open questions are
  written as decisions the turn he gives them.
- Follow-up tickets the lead files: the live GitHub suite on the schedule (needs a throwaway repo
  and the App installed there); waiting for running checks at `/merge`; the wider fast path; two
  Alchemy stacks so a deploy needs no secret values (below).

## What this cannot tell us

- **Alchemy's forms are read, not run, in this exact shape.** The modular object with an `alarm`
  slot, `state.storage.sql` with its Effect `transaction`, `ReadSecret`, and `Cloudflare.state()`
  are names in beta.85's source. 0041 binds a claim to a run; slice 3 runs them in local workerd
  first, and a gap is patched with its issue (0042).
- **Every deploy needs the two secret values.** Alchemy's `SecretsStore.Secret` takes its `value` on
  each deploy and compares it with state. So only a machine that holds both can deploy. Two stacks
  (secrets once, the Worker binding them by reference) may remove that; not read far enough to say.
- **The memory git model's three-way merge is simpler than git's.** It merges by path. A conflict
  git resolves inside a file, or one it finds that a path merge does not, is not modeled. The
  recorded REST answers and the shadow day are where real merges show.
- **The race in the merge call.** GitHub pins the head, not the base. Between reading main and the
  squash, another writer can land. The tree check catches it after the fact, and the line stops;
  it cannot prevent it. After the switch the queue is main's only writer, except the lead's
  docs-only admin merges under 0183, which should then go through `/merge` too.
- **The head pinned at `/merge`.** A push in the second between the comment and the Worker's read
  pins the newer head. The commenter has write access anyway, but it is not what bors guarantees.
- **The defaults** `pause` and `timeout` have no data behind them yet.
- **"Labels need write access" is close, not exact.** GitHub's triage role can also label issues
  and PRs, from memory, not fetched. Today nobody here holds triage, so it does not bite; a later
  check of the labeler's permission is a small read if it ever does.
- **A missed label webhook** leaves the freeze wrong until the next rebuild. v1 rebuilds only on
  start; a read of the open `sev0` issues on each alarm before a merge would close that, at one
  call per landing. Not in this plan.

## Names checked

Each name the plan coins, checked against the industry's word and the glossary
([use the industry's names](../../direction/use-the-industrys-names.md)). "Open" marks a name kept
for now that waits on the owner's pick.

| Our word | Industry word | Source | Kept or renamed |
|---|---|---|---|
| merge queue | merge queue | [GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | kept |
| `Merger`, the child that lands one change | merger, next/'s word for the same job | [glossary](../../../.glossary/TERMS.md), [0110](../../../.decisions/0110-merge-queue-is-fabrika-programs.md) | renamed from `Landing` |
| `Ci`, the service that reads check runs at a commit | `Ci`, next/'s word; GitHub's Checks API | [glossary](../../../.glossary/TERMS.md), [check runs](https://docs.github.com/en/rest/checks/runs) | renamed from `Checks` |
| `Call`, a GitHub call a state owes | a pending message in an outbox; "ask" is only a person's ask here | [glossary](../../../.glossary/TERMS.md), [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) | renamed from `Ask` |
| `owed`, `sent` | pending, sent (outbox) | [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) | kept, plain words |
| `associations` setting | `author_association` | [GitHub](https://docs.github.com/en/graphql/reference/enums#commentauthorassociation), [0081](../../../.decisions/0081-no-question-word-names.md) | renamed from `who` |
| `remaining` on an answer | `x-ratelimit-remaining`; `limit` is the cap | [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | renamed from `limit` |
| `labels.blocker` | `blocker_label` | [Tide config](https://docs.prow.k8s.io/docs/components/core/tide/config/) | renamed from `labels.freeze` |
| `enqueued` Msg | `pull_request` action `enqueued` | [GitHub webhooks](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request) | renamed from `queued` |
| `Blockers`, merge blocker | merge blocker issue | [Tide](https://docs.prow.k8s.io/docs/components/core/tide/) | kept |
| freeze | merge freeze | [Mergify](https://docs.mergify.com/merge-protections/freeze/), [0532](../../../.decisions/0532-a-sev0-freezes-ci.md) | kept |
| sev0, the Queue's `sev0` copy | severity 0 incident | [0532](../../../.decisions/0532-a-sev0-freezes-ci.md) | kept, open |
| staging branch, `staging` | `staging` | [bors-ng](https://bors.tech/documentation/getting-started/) | kept |
| `scratch` (`queue/tmp`), where the merge is made | `staging.tmp` | [bors-ng](https://bors.tech/documentation/getting-started/) | kept, plain word |
| pass, fail, infra | SUCCESS, FAILURE, INFRA_FAILURE | [LUCI Buildbucket](https://chromium.googlesource.com/infra/luci/luci-go/+/master/buildbucket/proto/common.proto) | kept |
| shadow mode, `shadow`, `live` | shadow deployment | [Codefresh](https://codefresh.io/learn/software-deployment/shadow-deployments-benefits-process-and-4-tips-for-success) | kept |
| fast path, slow path | fast path | [Wikipedia](https://en.wikipedia.org/wiki/Fast_path) | kept, glossed |
| land, `landed` | land, as in 0537's `landed` entry | [0537](../../../.decisions/0537-infra-holds-our-own-small-services.md) | kept |
| line, `Entry` (queue) | the queue's entries | [GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), next/'s `Queue.ts` | kept, open |
| drift, the stop on a tree mismatch | `tree_drift`, next/'s stop | next/'s `Queue.ts` | kept |
| stop the line, `stopped`, `resumed` | andon | [jidoka and andon](../../direction/jidoka-and-andon.md) | kept |
| event log, fold, cache | event sourcing | [Fowler](https://martinfowler.com/eaaDev/EventSourcing.html) | kept |
| Model, Msg, Cmd, Sub, `update`, `init`, ports | the same | [Elm guide](https://guide.elm-lang.org/architecture/) | kept |
| `Reply`, the out-message | OutMsg | [Elm Discourse](https://discourse.elm-lang.org/t/what-is-the-advantage-of-a-translationdictionary-in-the-translator-pattern/4111) | kept |
| alarm, `wake` | Durable Object alarm | [Cloudflare](https://developers.cloudflare.com/durable-objects/api/alarms/), [glossary](../../../.glossary/TERMS.md) | kept |
| host, `Host.ts` | tea's host adapter, not the glossary's Clients host | [@demlik/tea](https://github.com/kamp-us/demlik) | kept |
| enrich | Content Enricher | [EIP](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DataEnricher.html) | kept |
| `delivery`, `sentAt`, `arrivedAt` | `X-GitHub-Delivery`; the glossary's two clocks | [GitHub](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [glossary](../../../.glossary/TERMS.md) | kept |
| `took` | `took`, in ms | [Elasticsearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-search.html) | kept |
| `checks` setting | required status checks | [GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | kept |
| `wait` setting | status check timeout | [GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | kept, open |
| `round`, `rounds`, `behind`, `moved`, `conflict` | next/'s merger words | next/'s `Merger.ts` | kept |
| `CodeHost`, change kind (`kind`) | the glossary's words | [glossary](../../../.glossary/TERMS.md) | kept |

## Answered questions

1. Shadow ends after 10 matching landings in a row, a setting, with at least one by the slow path; if none of the ten is, shadow waits for one more. The owner's answer, 2026-11-14.
2. The App is the existing fabrikalfa App, no new one. The package is `@kampus/fabrikalfa` at `infra/fabrikalfa`, and the queue is its first feature. The owner's answer, 2026-11-14.
3. How a sev0 reaches the queue: an open issue labeled `sev0`, PRs labeled `sev0-fix`, closing the issue ends it, rebuilt on start from the open issues. The owner's answer, 2026-11-14, Tide's merge-blocker shape. No `repository_dispatch`.

## Open questions

None.

## Findings

None.

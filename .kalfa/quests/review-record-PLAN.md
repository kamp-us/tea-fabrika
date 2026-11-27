Approved by the lead agent, builds 0093, 0066; body e73aa652f761
Plancheck-Version: 3

# Plan: a review verdict is a record on the reviewed head, and the merge gate reads it (ticket 2338)

This is today's lead tooling (`.agents/skills/lead/scripts/`), run on our own laptop. It is not `next/`, and it is not
product. The ticket is https://github.com/kamp-us/tea-fabrika/issues/2338, on the wayfinder map
https://github.com/kamp-us/tea-fabrika/issues/2336. The governing decision is
`.kalfa/decisions/0093-a-review-verdict-is-a-record-on-the-reviewed-head-and-ci-required-reads-it-on-the-queue.md`, and
its research is `.kalfa/research/review-and-merge-gates.md`. Ticket 2339 (the `ci-required` step and the ruleset moving
to `ALLGREEN`) is a separate pull request and is out of scope here. This plan fixes the record's shape so 2339 can read
it as it stands.

**The carrier is a commit status, not a check run.** The bot App (id 5640348) holds `actions`, `contents`,
`deployments`, `pull_requests` and `workflows` (write) and `metadata` (read). It has no `checks` and no `statuses`. The
owner's ruling is to write the record with the existing token and add an App permission only if truly needed later. The
existing token is the lead's own `gh` login, which can create a commit status and cannot create a check run (only an App
can). So the carrier is a commit status with the context `review`. 0093 named a status as its fallback, and this plan
takes it as the way.

Two slices, each its own pull request. Slice 1 only writes and reads the record. Slice 2 makes the merge gate
(`pr/Gate.ts`, `Gate.before`, landed in https://github.com/kamp-us/tea-fabrika/pull/2351) refuse a pull request that
needs a review and has none.

```ts
// The whole idea, a sketch. One status per head, written by the lead, read by the gate.
//
//   review done at H_r   --land.ts review <pr> --reviewed H_r-->  status `review` on the pushed head H_p   (fresh)
//   head moved by main   --land.ts review <pr>---------------->   status on the new head, same `reviewed`   (carry)
//   Gate.before(...)     --reads------------------------------>   paths git says the pull request changes, then the statuses on H_p
//
// A carry names no sha: it walks the head's first parents to the nearest approval and reuses its `reviewed`.
yield* Review.record({ dir, pr: 2400, ask: Review.Ask.cases.carry.make({}) });
// The gate asks once, for every path (queue, arm, merge, merge --admin, admin, check).
const refusal = yield* Gate.before({ dir, found, marksReady: true, way: Gate.Way.cases.queue.make({}) });
// string | null. null: no reviewed path changes, or an approval is on this head.
```

## Doubts, read first

- **The gate stops a forgotten review, not a lying lead and not a forged status.** Two gaps, both known. The lead's
  `--reviewed <sha>` is the lead's own word that a review read that head, and nothing checks it. And anyone with write
  access can post a commit status named `review`. The status carries its `creator`, which this pull request keeps and does
  not judge. Pinning the login is 2339's job (see "What 2339 reads"). 0093 already says the gate stops a mistake, not an
  attack.
- **A carry walks first parents, 90%.** I checked on this repo's own branches that a merge of main into a branch has the
  branch as its first parent and main as its second: for GitHub's own "Merge branch 'main' into ..." commits
  (committer `GitHub`) on `fabrikalfa/adr-0081-eight` (`508c3f32`) and `fabrikalfa/gate-cache` (`4f54d49d`), and for the
  bot's own `git merge` on `fabrikalfa/admin-merge-asked` (`db71f64f`), the first parent is not in main and the second is.
  I did not read GitHub's docs for `update-branch`; the three real merges are my evidence. If a merge ever puts main
  first, the walk finds no approval and the carry is refused, which is the safe direction.
- **Use `@kalfa/git`'s `rangePatchId` for the carry rule, 80%.** The research says the lead can ship with plain
  `git patch-id --verbatim` first. The package does the same call and ignores the laptop's git config (it pins
  `GIT_CONFIG_GLOBAL=/dev/null` and the rest), so the ids the laptop writes equal the ids a CI runner will compute for
  2339. The cost is a settings constant (seven limits and a committer) in one small file. What would settle it: the build
  finding the package cannot open the main checkout's `.git`.
- **`chain.ts` records at its `ready` command, 70%.** I read the `ready` and `land` commands of `chain.ts` and the shape
  of `land.ts`, not the whole 2,000 lines. The chain pushes the head the review read, so its record has `reviewed` equal
  to `head`. The build reads the chain's `ready` command and adds the record after `Publish.ready`.
- **The wide facts live in one pull request comment, 80%.** A commit status holds 140 characters of description and one
  URL, which fits the core and not the reviewer, the ticket or the base. The plan puts them in one comment on the pull
  request, written once by the fresh record, and points the status's `target_url` at it. A carry points at that same
  comment and posts none. The cost is a stray comment if the status write then fails.
- **Reading the changed paths from git, 80%.** The review check asks git for the paths the head changes
  (`git diff --name-only -z --no-renames`, three dots from `origin/main`), not GitHub's files list. Git has no 3000-file
  cut and `--no-renames` lists both halves of a move. It relies on the head and `origin/main` being fetched, which the
  leak check earlier in the gate already does; the review check is last. A failed read fails the gate, never passes it.
- **`kalfa/` means the `kalfa/` folder, not `.kalfa/`, 90%.** `.kalfa/` holds decisions, plans and research, which are
  docs. Today's `packages/`, `programs/` and `apps/` are frozen and need no review. The root config files need a review too,
  by the owner's later ruling (see Records).

## What changes, in one paragraph

Slice 1 adds `pr/Review.ts` (the record's schema, its encodings, the rule for which paths need a review, the pure answer
"is this head approved", and `record`), `pr/Reviews.ts` (a service that reads and writes the record on GitHub, with
`ReviewsGh` and `ReviewsTest` layers; the real layer runs `gh api`), `pr/ReviewGit.ts` (the `@kalfa/git` layer), and the
command `land.ts review <pr> [--reviewed <sha> --reviewer <text>]`. With no `--reviewed` it is a carry. No key is read and
`botpush.mjs` does not change. Slice 2 puts the review check into `Gate.before` as its last check, adds a `way` to the
gate's question (queue, arm, or admin with a written reason), adds a `Changes` service that reads the changed paths from
git, makes `land.ts merge --admin` and `land.ts admin` take `--override-review <reason>` and log it on the head, has
`land.ts run` and `chain.ts` record the verdict before they queue, makes `Arm.arm` refuse a pull request that needs a
review, and writes one glossary term. Out of scope: `ci-required` and the ruleset (2339), judging the status's creator
(2339), the "Merge when ready" button and the old pipeline's enqueue (2339), a GitHub App permission, the hourly mutation
run (https://github.com/kamp-us/tea-fabrika/issues/2340), and any change to what the reviewer does (it stays read-only).

## Searched first

- The ticket and its one comment (the owner's ruling of 2026-11-26), decision 0093 whole, and the research file whole.
  The research was read on 2026-11-26 from GitHub's own docs and API description; I did not fetch those pages again. Each
  GitHub fact below says "per the research" or "from memory".
- `pr/Gate.ts`, `Gate.test.ts`, `Queue.ts` (`add`), `Arm.ts` (`arm`, `docsOnly`), `Merge.ts` (`admin`, `Route`, `Done`),
  `PullRequests.ts`, `PullRequestsGh.ts`, `Signatures.ts` and `SignaturesGit.ts` (the model for a service that answers a
  git question about a head), `Leaks.ts`, `Pushes.ts`, `BranchesGit.ts`, `command.ts`, `land.ts` (header, `queueServices`,
  `checkCommand`, `armCommand`, `mergeBy`, the `Check` literals), `chain.ts` (`land`, `ready`, `services`),
  `flow/landing.ts` (`queue`), `replay.ts` (it runs `land.ts check` on the last merged and every open pull request), and
  `drive.ts` (its review step keeps the head it was given in its row, `recordIt(..., head, ...)`).
- `kalfa/git/README.md` and `Repository.ts`: `rangePatchId`, `isAncestor`, `mergeBases`, `readCommit`, `readRefs`, `diff`;
  `kalfa/git/src/Settings.ts`.
- `kalfa/delivery/GLOSSARY.md` (**Approval**, **Carry rule**, **Kept**, **Stale**) and `kalfa/codehost/GLOSSARY.md`
  (**Review**, **Approve**). Decision 0066 chose the carry rule `kept`: an approval covers a new changeset when its changes
  are the same, which is Gerrit's way. This plan builds that rule for today's tooling.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and the kalfa glossaries for
  "review record|approval|verdict", "commit status|check run", "override|bypass", "patch-id|patch id" and "admin merge".
  The hits that bear on this are 0093 and 0066, the Delivery glossary and `.kalfa/quests/kalfa-git-diff-PLAN.md`. Nothing
  else settles how a record carries over a merge of main, which 0093 leaves to this plan.
- Facts read on 2026-11-26 with `gh api` and `git` on this repo, read-only: recent pull request heads (2349, 2350, 2351)
  have no commit statuses at all, only check runs, so the reader has no real status of ours to learn its shape from
  (see R5); and the three first-parent checks above.
- The old pipeline's enqueue: `packages/pipeline/src/code-host-github-writes.ts` holds `ENQUEUE_WRITE` (the GraphQL
  `enqueuePullRequest`) and `enqueueOn`. It is imported by `packages/pipeline/src/code-host-github.ts`, which
  `packages/pipeline/src/tsh/fabrika.ts` uses with `shipProgram` (`stages/ship/program.ts`), and by
  `stages/pipeline/github.ts`, `stages/operate/writes.ts` and `hosted/outside.ts`. So it is built into the frozen
  pipeline's ship stage. I did not run anything: whether anyone runs that stage today I cannot tell from the code, and it
  asks no gate of ours. It is a hole only 2339 closes (see "Holes only 2339 closes").
- Installed versions in the lockfile: `effect` and `@effect/vitest` 4.1.3, `vitest` 5.0.5. No local patch touches the
  APIs used. The code uses what the lead folder already uses: `Context.Service`, `Schema.TaggedError`,
  `Schema.TaggedUnion`, `Effect.fn`, `Option`, `Result`.
- The lead tooling's own rule: it skips the plan, tests and review steps (fast track). This plan is written because the
  owner asked and the decision leaves the carry rule to it. The lead may land a slice by the fast track; the laws and
  plants below still stand.

## How others do it

- **Gerrit** records a vote on one revision of a change and carries it to a new revision only by a written rule
  (`copyCondition`: no change, no code change, trivial rebase, first-parent update of a merge). A merge of the base into a
  change is the "trivial rebase" case, and Gerrit's own condition for it is named for the first parent, which is the walk
  here. **Zuul** keeps nothing across a new patch set. **bors** unapproves on any new head SHA and checks the approved SHA
  again at the last step. **GitHub's** own review dismissal asks "did the diff change". All from the research, sections
  1.1 to 1.7, not fetched again.
- **A bot's verdict on GitHub** is best a check run made by an App, pinned to that App (per the research). We have no App
  permission for it, so we take the weaker form the research also names: a commit status, which "users with push access"
  can create, and which records its `creator`, `context`, `state`, `description` (140 characters) and `target_url`. The
  weakness is the one the research states: anyone with write access can forge a status.
- **One gate for every path.** Gerrit has one `Submit` permission. Chromium's commit queue is the one submitter. Here the
  one door every path crosses is the queue, and the one function every `land.ts` path calls first is `Gate.before`.
  This plan keeps the review check inside it. A path never asks its own review question.
- **A written override.** Gerrit's submit requirement can be `OVERRIDDEN`, and a merge that skipped review is `FORCED`,
  both recorded on the change. Chromium writes the skip as a commit footer with a reason. Here the override is a status
  with a reason on the head (research, section 3).
- **Auto-merge keeps a gate honest only if it is checked when the head merges.** The research (section 6.1) read 17 pull
  requests in this repo that got commits after auto-merge was on and all merged; https://github.com/kamp-us/tea-fabrika/pull/2016
  is the clear case (three commits after the arm call). So `arm` cannot be trusted with a review check made at arm time.
- **Elm and Erlang/OTP** have nothing to say: no process state lives between calls. The record lives on GitHub and is read
  back by any process, which is the restart-safe part the research asked for.
- Not fetched, from memory: git's `patch-id --verbatim` ignores line numbers, and the package's README says
  `rangePatchId` gives one id to a branch rebased, merged with main, or squashed, when the edit is the same. GitHub's
  list of a commit's statuses is newest first and gives each status its `id`, `state`, `context`, `description`,
  `target_url` and `creator`; the reader sorts by `id` and does not rely on the order.

## The shape

```ts
// .agents/skills/lead/scripts/pr/Review.ts, a sketch. The record, its encodings, the pure answers. No GitHub here.
export const CONTEXT = "review"; // the status's context

/**
 * Which paths need a review: a named value, so the laws draw any of it and 2339 reads the same one.
 * `trees` are path prefixes ending "/"; `files` are exact repo paths; `names` are root-level file names with one `*`.
 */
export const Reviewed = Schema.Struct({
  trees: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  names: Schema.Array(Schema.String),
});
// 0093 settles the two trees; the owner's later ruling adds the root config files, so ROOT_CONFIG is part of REVIEWED.
// ROOT_CONFIG's entries, in words: the root package manifest and the lockfile (`files`), the check workflow (`files`), the
// layer rules file (`files`), the oxlint plugin folder (`trees`), and the root tsconfig and vitest files (`names`, as
// `tsconfig*` and `vitest*.ts`). The build writes each with its exact repo path.
export const ROOT_CONFIG: typeof Reviewed.Type = { trees: [/* ... */], files: [/* ... */], names: ["tsconfig*", "vitest*.ts"] };
export const REVIEWED: typeof Reviewed.Type = {
  trees: ["next/", "kalfa/", ...ROOT_CONFIG.trees],
  files: [...ROOT_CONFIG.files],
  names: [...ROOT_CONFIG.names],
};

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const Line = Schema.Trimmed.check(Schema.isNonEmpty(), Schema.isPattern(/^[^\r\n]+$/)); // one line, never blank
const Who = Line.check(Schema.isMaxLength(300));
const Reason = Line.check(Schema.isMaxLength(128)); // 140 minus "override v1 ": a reason always fits the status's description

/** The record, three cases. `v` is the version. */
export const Record = Schema.TaggedUnion({
  // Someone read the change and said yes: the first record of a review, with the wide facts. `head` is the commit the status sits on.
  pass: {
    v: Schema.Literal(1),
    head: Sha,
    reviewed: Sha,       // the head the reviewer read; `head` itself or an ancestor of it with the same change
    base: Sha,           // the merge base of `head` and main when it was recorded
    patchId: Sha,        // the package's patch id of base..head; equal to the reviewed head's
    reviewer: Who,       // who judged: tool and model and session, as the lead gives it
    ticket: Schema.NullOr(Schema.Int),
  },
  // The same approval on a later head (a merge of main). It holds no wide facts: its status points at the first record's comment.
  carry: { v: Schema.Literal(1), head: Sha, from: Sha, reviewed: Sha, patchId: Sha }, // `from`: the head whose approval it carries
  // An admin merge went past a missing verdict. It never approves anything.
  override: { v: Schema.Literal(1), head: Sha, reason: Reason },
});
export type Record = typeof Record.Type;

// The encodings of a Record. `state` and `description` go on the status; `comment` is the pull request comment (pass and override only).
//   pass, carry  state "success"   description `pass v1 reviewed=<40 hex> patch=<40 hex>`   (104 characters)
//   override     state "failure"   description `override v1 <reason>`                      (at most 140 characters)
export const status: (r: Record) => { state: "success" | "failure"; description: string };
export const comment: (r: Record) => string; // plain lines for a person, then the JSON of the whole Record in a fenced block

/** What the status alone says, read back. The head is the one the statuses were asked for; the status does not repeat it. */
export type Core =
  | { _tag: "pass"; reviewed: string; patchId: string }
  | { _tag: "override"; reason: string };
export const core: (state: string, description: string) => Result.Result<Core, string>; // the failure says why not

/** Is this head approved? `seen` is the head's statuses with context `review`; `paths` is every path git says the pull request changes. */
export type Approval =
  | { _tag: "exempt" }                                       // no path matches `reviewed`
  | { _tag: "approved"; seen: Seen }
  | { _tag: "missing"; why: "none" | "unreadable" | "not_success" | "override_only" };
export const approval: (a: { reviewed: typeof Reviewed.Type; paths: ReadonlyArray<string>; seen: ReadonlyArray<Seen> }) => Approval;
```

```ts
// pr/Reviews.ts, a sketch: the contract only. ReviewsGh runs gh; ReviewsTest answers from memory.
export class ReviewsError extends Schema.TaggedError<ReviewsError, { readonly brand: unique symbol }>()(
  "ReviewsError", { reason: Schema.String }) {}

/** One status of context `review` on a head, as GitHub gave it. A status we cannot read is its own case, so it can never count as a pass. */
export type Seen = {
  readonly id: number;
  readonly creator: string;                         // the login that posted it. Kept and shown; this pull request does not judge it (2339 does)
  readonly state: string;                           // success, failure, error or pending, as GitHub says
  readonly core: Result.Result<Core, string>;       // decoded from state and description
  readonly url: string | null;                      // target_url: the comment that holds the first record
};

export class Reviews extends Context.Service<Reviews, {
  /** Every status of context `review` on the full 40-character `head`, oldest first. Fails when GitHub cannot be read, never answers none for that. */
  readonly read: (head: string) => Effect.Effect<ReadonlyArray<Seen>, ReviewsError>;
  /**
   * Posts one status on `record.head`. With `url` none it posts the comment first and points the status at it, and posts no
   * status when the comment fails; with `url` some (a carry) it posts the status alone, pointing at that comment.
   */
  readonly write: (pr: number, record: Record, url: Option.Option<string>) => Effect.Effect<void, ReviewsError>;
}>()("lead/pr/Reviews") {}
```

```ts
// pr/Review.ts, the write, a sketch. Needs: PullRequests, Branches (refresh), Pushes (leakText), Reviews, @kalfa/git Repository.
export const Ask = Schema.TaggedUnion({
  fresh: { reviewed: Sha, reviewer: Who, ticket: Schema.NullOr(Schema.Int) }, // `reviewed`: the head the review report names
  carry: {},                                                                   // nothing typed: the nearest approval on the first parents gives it
});
export const record = (a: { dir: string; pr: number; ask: typeof Ask.Type }) => Effect.Effect<
  { head: string; kind: "fresh" | "kept" | "already" }, // already: the head holds an approval, nothing was written
  RecordRefused | LeakGrepRefused | PullRequestsError | BranchesError | ReviewsError,
  PullRequests | Branches | Pushes | Reviews | Repository.Repository
>;
// RecordRefused { reason } says one of: the pull request is not open and into main; the reviewed head is not in the
// pull request's history (a rebase or a force push rewrote it); the two heads hold different changes; there is no change;
// the merge base is unclear; a carry found no earlier approval on the first parents; the read back disagrees.
```

```ts
// pr/Changes.ts and pr/ChangesGit.ts, slice 2, a sketch: the one git question the review check asks, as Signatures asks its own.
export class ChangesError extends Schema.TaggedError<ChangesError, { readonly brand: unique symbol }>()(
  "ChangesError", { reason: Schema.String }) {}
export class Changes extends Context.Service<Changes, {
  /** Every path `origin/main...head` changes in the checkout `dir`, both halves of a move, as `git diff --name-only -z --no-renames` prints them. Never cut; a git that cannot answer fails. */
  readonly paths: (dir: string, head: string) => Effect.Effect<ReadonlyArray<string>, ChangesError>;
}>()("lead/pr/Changes") {}
```

```ts
// pr/Gate.ts, slice 2, a sketch. The gate's question grows one field. Each path says which way it merges.
export const Way = Schema.TaggedUnion({
  queue: {},                                   // queue, merge, run, check, the flow's queue step
  arm: {},                                     // merge when ready: refused when a review is needed (see "Holes only 2339 closes")
  admin: { override: Schema.NullOr(Reason) },  // merge --admin and admin; a reason, or null when the lead gave none
});
export type Ask = { dir: string; found: Detail; marksReady: boolean; way: typeof Way.Type };
// Needs gains `Reviews` and `Changes`. Unread gains `ReviewsError` and `ChangesError`. CHECKS gains one entry, last:
//   passes: () => "a review on the head, or no path that needs one"
//   ask:    ({ found, way }) => found.state === "MERGED" ? null : review(found, way)
```

```ts
// pr/Merge.ts, slice 2, a sketch. The admin merge logs its reason right before it merges.
export type Ask = { /* as now */ readonly override?: Reason };      // from --override-review
// Done.admin gains `override: Schema.NullOr(Reason)`, which Merge.line prints.
```

### The carrier, so 2339 and the gate read the same thing

Per the research (sections 2 and 5), not run on a test repository. The writer is `gh api` under the lead's own login:

```text
comment     POST repos/<repo>/issues/<pr>/comments        body: Review.comment(record)   -> its html_url   (fresh and override only)
status      POST repos/<repo>/statuses/<head>             state, context "review", description, target_url = that html_url (a carry: the first record's)
read        GET  repos/<repo>/commits/<head>/statuses     paged; keep context == "review"; sort by id; newest decides
```

What goes where, since a status has 140 characters and one URL:

| Fact | Where | Why there |
|---|---|---|
| the head | the sha in the status's own path | a status belongs to one sha; it cannot name another |
| pass or carry, or override | `state`: `success` for pass and carry, `failure` for override | what a ruleset or a reader sees at a glance |
| the reviewed head, the patch id | the description of a pass or carry: `pass v1 reviewed=<40 hex> patch=<40 hex>` | the core 2339 needs, 104 characters |
| the reason of an override | the description: `override v1 <reason>`, the reason at most 128 characters | in the status itself, so a reader needs no comment to see why |
| the version | the `v1` in the description and `v` in the comment's JSON | a later shape reads as unreadable, never as a pass |
| reviewer, ticket, base | the first comment's JSON, at `target_url` | no room in 140 characters; wide facts the gate does not read |
| who wrote it, and when | the status's `creator` and `created_at` | GitHub gives both |

A carry's status and a pass's status are the same bytes to a reader. The difference is only where `target_url` points:
the carry's points at the comment the first record posted, so the reviewer and the ticket stay one click away and no
second comment is posted.

**The override's state is `failure`, not `error`, 80%.** GitHub's two bad states both fail a required status. `failure`
says "no approval, on purpose"; `error` says the tool broke, and the lead's tooling reads a broken write as a refusal, so
`error` would be confused with a fault. We never write `error` or `pending`, and the reader treats every state but
`success` as no approval. The cost: a red status on a pull request that merged on purpose, which is the loudness 0093 asks.

### What 2339 reads, and what it must do that this pull request does not

2339 reads: the statuses on the pull request's head, `context` exactly `review`, the newest by `id`, whose `state` is
`success`, whose `description` matches `^pass v1 reviewed=[0-9a-f]{40} patch=[0-9a-f]{40}$`, **and whose `creator.login`
is the one login that may write it**. Three notes for 2339's plan:

1. **The creator check is 2339's job and is not in this pull request.** Anyone with write access can post a status named
   `review`. The login goes in a repository variable (a GitHub Actions variable), never as a name in a file of this
   public repository. Whether the ruleset can also pin the source, 2339 settles.
2. **2339 judges the pull request's own files, not the merge group's diff.** The merge group's commit holds every queued
   entry's change, so a diff of it would call a docs-only entry "needs review" because of its neighbor. The rule is the
   same one: the paths of the pull request's head against its merge base with main, matched with `Review.Reviewed` from
   `Review.ts`. The head to ask is the pull request's head, found from the queue entry, not the group's commit.
3. The patch id is a fact the writer checked once on a head that cannot change, so a reader on the same head does not
   recompute it, though it may. The comment is for people: the gate does not read it. `Review.ts` keeps `Reviewed`,
   `REVIEWED` and `approval` free of GitHub and of this folder's services, so 2339 may import them where the runner has
   installed `effect`.

### Holes only 2339 closes

- **"Merge when ready" stays on through a later push.** Per the research (6.1), auto-merge, once on, queues whatever the
  head is when requirements are met; a later commit by someone with write access merges with it. Until 2339 lands, this
  pull request makes `Arm.arm` refuse any pull request that needs a review, even one with an approval on its head, and
  point at `land.ts queue <pr> --wait-ci`, which enqueues one pinned head at once. A pull request that needs no review is
  armed as today. This also means "every reviewed pull request has merge when ready on" in the lead skill no longer holds
  for the reviewed paths; the skill's line changes with it.
- **The "Merge when ready" button in GitHub's page,** and a hand-run `gh pr merge --auto`, reach the same auto-merge
  with no gate of ours. Only a check on the queue's own run (2339) sees them.
- **`enqueuePullRequest` in `packages/pipeline/src/code-host-github-writes.ts`** (`ENQUEUE_WRITE`, `enqueueOn`) in the
  frozen pipeline. It enqueues by GraphQL, asking no `land.ts` gate. I found it built into the ship stage
  (`packages/pipeline/src/tsh/fabrika.ts`, `stages/ship/program.ts`) and not whether it runs today. This plan does not
  touch frozen code; 2339's queue-side check is what holds it.
- A push to a pull request already in the queue: the research found no answer (it is in its "cannot tell" list), so
  neither this plan nor 2339 may assume the queue drops the entry.

## The rules the code takes, each with its note

1. **Which pull requests need a review: any path the head changes against its merge base, a move counted at both ends,
   that matches `REVIEWED`**: the trees `next/` and `kalfa/` (0093, the owner's ruling) and the root config files
   (`ROOT_CONFIG`: the owner's later ruling, see Records). The paths come from git,
   which has no cut list and a failed read fails the gate. A merged pull request is never refused (as every other check
   does for `land.ts check` and `replay.ts`).
2. **Only a `pass` approves.** An `override` on the head never approves, for the queue or for an admin merge. An admin
   merge with no approval needs `--override-review <reason>` every time; the reason is written, then the merge asked.
3. **Carry across a merge of main: kept** (0066, Gerrit's way), with nothing typed. `land.ts review <pr>` with no
   `--reviewed` starts at the head and walks first parents, only through commits the pull request adds to main, reading the
   statuses of each, until it finds the nearest approval; it reuses that approval's `reviewed` and the first record's
   comment. It then writes a status on the head only when `rangePatchId` of main..`reviewed` equals `rangePatchId` of
   main..head. A head that already holds an approval writes nothing and says so. No earlier approval (none, an override
   only, an unreadable one, or one reachable only through a second parent) is refused, with the line that tells how to
   record a new review. This is slightly looser than Gerrit's (a patch id ignores context lines), and the queue's own test
   run is the backstop, as the research says. The gate never recomputes: a record on a head is a fact about that head.
4. **A fresh record needs `--reviewed <sha>`, the head the review report names.** Our reviews run as Claude agents, not
   through `drive.ts`, so there is no row of ours to read it from. (`drive.ts` does keep the head a review was given in its
   row, so `chain.ts`, which drives reviews, passes that head.) The command checks that the sha is the head or an
   ancestor of it, and that the two hold the same change; it cannot check that anyone read it (first doubt).
5. **A send-back writes no record.** The head a reviewer sends back is usually not pushed, and the fix round makes a new
   head. A stale head's record cannot pass the gate anyway. The cost: no audit row for a send-back. The quest's state file
   keeps it.
6. **The record's words go public**, so `reviewer` and `reason` pass the leak grep before anything is written, and the
   comment text as a whole passes it too.

## One value traced: a next/ pull request, then a conflict, then a sev override

Quest `trace-x`, ticket 2400, a change under `next/`. The reviewer read `H_r = aaaa...`, said merge-ready.

1. `land.ts run trace-x 2400 --reviewed aaaa... --reviewer "codex review, quest trace-x"` merges main in as the bot. The
   head is now `H_p = bbbb...`, whose first parent is `aaaa`. It pushes and opens the pull request
   (https://github.com/kamp-us/tea-fabrika/pull/2400).
2. The record step (a fresh ask): `Branches.refresh`; `isAncestor(aaaa, bbbb)` is true; `rangePatchId(main, aaaa)` and
   `rangePatchId(main, bbbb)` are both `7f3a...` (the merge of main added no line of this change). It leak-greps the
   reviewer text and the comment, posts the comment (its url is `.../pull/2400#issuecomment-1`), posts the status on
   `bbbb`: `state: success`, `description: "pass v1 reviewed=aaaa... patch=7f3a..."`, `target_url` the comment. It reads
   the statuses back, finds the head `approved`, and prints `pr 2400: review recorded on bbbb (reviewed aaaa)`.
3. `queue`: `Gate.before` runs its checks in order. The review check asks git for the paths (`next/...`), matches
   `REVIEWED`, then reads the statuses on `bbbb`: one, context `review`, `success`, the description reads as a `pass`. It
   passes. CI is read, the pinned squash adds it to the queue.
4. Main moves and the pull request conflicts. The lead runs `gh pr update-branch 2400`; the head is `cccc...`, a merge
   commit whose first parent is `bbbb`. `queue` again: the gate finds no status on `cccc`. It refuses: `pr 2400: it changes
   next/... and no approval is recorded on its head cccc...; if an earlier head was approved, carry it with land.ts review 2400`.
   The lead runs `land.ts review 2400`: the walk reads `cccc` (none), then its first parent `bbbb` (a pass, `reviewed
   aaaa`, comment url). The ids of main..`aaaa` and main..`cccc` are `7f3a...` both; one status lands on `cccc` pointing
   at the first comment; it prints `pr 2400: review carried to cccc from bbbb (reviewed aaaa), kept`. `queue` passes.
5. A sev1 fix touches `kalfa/` and the lead must admin merge it. `land.ts admin 2500 --override-review "sev1 fix for the red main"`
   passes the gate on the override reason, waits for `ci-required`, re-reads the head, and only then, right before the
   pinned `--admin` squash, posts the comment and the `failure` status (`override v1 sev1 fix for the red main`). If any
   step before it refused (the head moved, `ci-required` not green, the queue not empty), nothing was written.
   `Done.admin` carries the reason and the line prints it. Without the flag it refuses before any write.
6. A docs-only pull request: git lists no path matching `REVIEWED`, so the review check is `exempt` after one read of git
   and no read of any status.
7. `land.ts arm 2400`: the pull request needs a review, so it refuses and says to use `land.ts queue 2400 --wait-ci`.

## What fact is lost if not recorded now

Written into every fresh record, because a field added later never reaches the records written before it: the head it
sits on, the head the reviewer read, the merge base, the patch id, who judged (`reviewer`), the ticket, and for an
override the reason. A carry adds the head it was carried from (`from`) in its own JSON, and its status points at the
first comment. GitHub gives the time (`created_at`) and who posted it (`creator`). Not recorded and why: the review's text
(the report lives with the quest), the verdict of a send-back (rule 5), and the plan's blob (the ticket names the plan).

## Is this a setting?

- **The two trees and the root config set** (`REVIEWED`, `ROOT_CONFIG`): no. They are the owner's rules, the trees in 0093
  and the root config set in his later ruling.
  Lead tooling has no settings file, and a rule that changes goes through a decision. They are one exported named value
  each so the laws draw any `Reviewed`, and 2339 reads the same one.
- **The context `review`** (`CONTEXT`): no. It is the name 0093 gives the record; 2339 reads the same constant.
- **`@kalfa/git`'s limits and committer** (`pr/ReviewGit.ts`): constants, because lead tooling has no settings file and no
  one needs to change them: files 3000 to match GitHub, the rest generous. A call over a limit fails and never cuts.
- **The caps** (`reviewer` 300, `reason` 128): constants of the schema. The reason's cap is not a taste: it is the 140
  characters of a status description less the 12 of `override v1 `.
- **How far a carry walks:** it is bounded by the commits the pull request adds to main, which GitHub itself caps, so no
  number of ours.

## Generators

Each id is a class a generator must reach. Each has a plant in the Laws table.

- (a) A change that reaches no reviewed path, with near-miss names: `.kalfa/x`, `docs/next/x`, `nextra/x`, `kalfa-x/y`,
  a file named `next`, `kalfa.md` at the top, `a/next/b`, `packages/x/package.json`, `docs/tsconfig.json`.
- (b) A path under a reviewed tree, or equal to a reviewed file or matching a reviewed root name, at any depth where the
  rule says, beside any other files. Drawn from any `Reviewed` value, not only the default.
- (c) A move: the new path is outside every reviewed path and the old one is inside, so only the old half names the tree.
- (d) A carry with no earlier approval: no status on any first parent, only an override, only an unreadable one, an
  approval only on a second-parent commit, or a walk that reaches main with none.
- (e) One good status on the head: context `review`, `success`, the description reads as a `pass`.
- (f) A head that is not a full 40-character sha: a branch name, a short sha, an upper-case sha.
- (g) A pass description on a status whose state is not `success` (`failure`, `error`, `pending`), and an override
  description on a `success` status.
- (h) A status of another context beside a good one: `ci-required`, `Review`, `review-x`, `review ` with a space.
- (i) An unreadable description: another version (`v2`), a short sha, an upper-case sha, a missing field, extra words,
  an empty reason, a reason over the cap, a line break.
- (j) An override status on the head.
- (k) Two or more statuses on the head, mixed, where the newest by `id` decides, whatever the order GitHub listed them in.
- (l) A merged pull request that needs a review and holds none.
- (m) `reviewed` equal to the head (a fresh record on the head itself).
- (n) `reviewed` an ancestor of the head, and the head holds main merged in, with the same change; and a carry over
  one merge, and over two merges in a row.
- (o) `reviewed` an ancestor, and the head holds one more change.
- (p) `reviewed` not an ancestor of the head (a rewritten branch), or not a commit the store holds.
- (q) No change at the reviewed head and at the head (empty), or an empty reviewed side only.
- (r) No merge base, or two (a criss-cross), or a shallow store.
- (s) Words in `reviewer` and `reason` that the leak grep refuses, in each field alone and together.
- (t) A bad reason: blank (empty, spaces, tab, a line break only) or over the cap.
- (u) A carry asked on a head that already holds an approval.
- (v) An override given while an approval is on the head.
- (w) A write that goes wrong: the comment fails, the comment answers no url, the status fails (the lead's login lacks the
  right, as for a 403 or 404), or the read back finds no `approved` status on the head.
- (x) An admin merge that refuses after the gate passed on the override: the head moved, `ci-required` is not green, the
  queue is not empty, the fix is behind main, or the pinned squash itself fails.
- (y) A read that fails: the changed paths, or the statuses.
- (z) A pull request that needs a review, with an approval on its head, asked by `arm`.

## Laws

Plain laws use `it.effect.prop` from `@effect/vitest` 4.1.3 with Effect's own `Arbitrary` over the schemas above, as the
landed lead laws do. They run on the test layers (`PullRequestsTest`, `ReviewsTest`, `ChangesTest`, `PushesTest`,
`BranchesTest`) and on `@kalfa/git/memory`, so nothing asks GitHub or real git. Counts: Gate laws 120 runs at fast depth,
the others 200.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| R1, approval is a function of paths and statuses (slice 1, pure): for any `Reviewed` value, `exempt` exactly when no path matches it; else `approved` exactly when the newest status by `id` is `success` and its description reads as a `pass`; nothing else approves, and the `creator` never changes the answer here. 200 runs | test | Effect Arbitrary: ApprovalCase | match a tree by `includes`, so `docs/next/x` needs a review, (a) red; let a root name match at depth, so `docs/tsconfig.json` needs one, (a) red; ignore `files` or `names` of the value, (b) red; accept a pass description on a `failure` or `error` status, (g) red; accept an override description on `success`, (g) red; accept a text that fails to decode, (i) red; count an `override`, (j) red; let the oldest status decide, or the first listed, (k) red; ask for two good statuses before approving, (e) red | .agents/skills/lead/scripts/pr/Review.test.ts |
| R2, the record on the wire (slice 1): for any `Record`, `status` gives `success` for a pass and a carry and `failure` for an override and never another state; the description is at most 140 characters and `core` of it gives back the pass's or carry's `reviewed` and `patchId` or the override's `reason`; `comment` of a pass or an override holds the JSON of the whole record, which decodes to the record, and the head's first seven characters. 200 runs | test | Effect Arbitrary: RecordCase | give an override `success`, (g) red; give an override `error`: the state check red; let a reason of 129 characters through, (t) red; write the reason with its line break, (i) red; drop `patchId` from the description: the round trip red | .agents/skills/lead/scripts/pr/Review.test.ts |
| R3, the carry rule (slice 1): over a generated history, a fresh `record` writes exactly one comment and one status on the head when the reviewed head is the head or its ancestor and both patch ids are equal and not none; a carry, with no sha given, writes exactly one status and no comment, with the `reviewed` and the url of the nearest approval on the head's first parents, and writes nothing and names the reason when none exists (d) or the ids differ (o); a head that already holds an approval writes nothing (u). After a write it reads the statuses back and fails unless the head reads as `approved`. 200 runs | test | Effect Arbitrary: HistoryCase | skip the ancestor check, (p) red; compare commit ids and not patch ids, (n) red and (o) red; let a one-sided none pass, (q) red; treat two merge bases as one, (r) red; skip the read back, (w) red; require a strict ancestor, so a record on the reviewed head itself is refused, (m) red; walk both parents, so an approval on the main side carries, (d) red; walk past main into old history, (d) red; carry from an override status, (d) red; write again on an approved head, (u) red; post a second comment on a carry, (n) red; mint a record for a closed pull request: the state check red | .agents/skills/lead/scripts/pr/Review.test.ts |
| R4, the leak gate on the record's words `[secrets]` (slice 1): for drawn `reviewer` and `reason` holding a refused marker, in either field or both, nothing is posted, no comment and no status; every named output (the comment body and its JSON, the status description, the printed line, the refusal line and the quest's note) holds no marker, whatever the order of the refusal and the other failures. 200 runs | test | Effect Arbitrary: LeakFlow | run the grep on `reviewer` only, (s) red; post the comment before the grep, (s) red; print the reason in the refusal line without the grep, (s) red; grep the description and not the comment: red | .agents/skills/lead/scripts/pr/Review.test.ts |
| R5, the reader (slice 1): `ReviewsGh.read` asks exactly `commits/<head>/statuses` with the full sha, pages, keeps a status only when its `context` is exactly `review`, and gives each one's id, creator, state, core and `target_url`; a head that is not 40 hex is refused before any call (f); a failed `gh` call is `ReviewsError`, never an empty list (y). The statuses answer is a real one, so the shape is read as GitHub gives it. 200 runs for the filter, the vector once | test | vector: a real `GET commits/<sha>/statuses` answer, recorded by the tests step with the command and the date in a comment, from a public repository's commit that has statuses (this repo's own have none); if the tests step finds none, it says so and the lead's slice-1 proof run supplies it | match the context by prefix or case, (h) red; pass a branch name through, (f) red; turn a failed `gh` exit into no statuses, (y) red; read the creator from the wrong key: the vector red | .agents/skills/lead/scripts/pr/ReviewsGh.test.ts |
| R6, the writer (slice 1): `ReviewsGh.write` with no url runs exactly two `gh api` calls in this order: the comment, then the status with `state`, `context=review`, `description` and `target_url` equal to the comment's `html_url`; with a url (a carry) it runs the status call alone with that url; the arguments are those of R2's encodings and nothing else; a failed or url-less comment (w) posts no status; a failed status write (w) is a `ReviewsError` that names the status and the login's missing right in one plain line; no token or login is printed | test | Effect Arbitrary: WriteAnswer | post the status first, (w) red; post it when the comment gave no url, (w) red; swallow a failed status write, (w) red; post a comment for a carry, (n) red; send another context: the argument check red | .agents/skills/lead/scripts/pr/ReviewsGh.test.ts |
| R7, the command (slice 1): `land.ts review` on the test layers prints one line on success (fresh, kept or already), and on each `RecordRefused` and each leak refusal exits 1 with `land: refused at the review check: <reason>`; the carry's refusal for no earlier approval names `--reviewed` for a fresh record; nothing is written on a refusal | test | scenario: each refusal class of R3 and R4, one run each through the CLI | map a refusal to success: red | .agents/skills/lead/scripts/land.test.ts |
| CG1, the changed paths (slice 2): `ChangesGit.paths` runs exactly `git diff --name-only -z --no-renames origin/main...<head>` in `dir`, reads the NUL-separated output whole for any names (spaces, line breaks, `é`), gives both halves of a move, and fails with `ChangesError` on a git that exits non-zero or prints a cut name. 200 runs | test | Effect Arbitrary: ChangesAnswer | drop `--no-renames`, so a move names only its new path, (c) red; split on newlines, (c) red; treat a failed git as no paths, (y) red; diff two dots: the args check red | .agents/skills/lead/scripts/pr/ChangesGit.test.ts |
| I1, real git lists both halves of a move (slice 2): in a temp repository with a file moved out of a reviewed folder, `ChangesGit.paths` lists the old and the new path, and a name with a space and a line break. 3 runs | test | scenario: one temp repository, one move | drop `--no-renames`: red | .agents/skills/lead/scripts/pr/ChangesGit.integration.test.ts |
| R8, the gate, every path (slice 2): the existing property gains a defect `unreviewed`, last in `ORDER`. For any set of defects, every path refuses with the gate's own words for the first of them and asks GitHub for no write; `unreviewed` alone is refused by `check`, `queue`, `run` and `merge` with the line that names the carry command `land.ts review <pr>` and no sha, by `mergeAdmin` and `admin` with the line that names `--override-review`, and by `arm` with the line that names `land.ts queue`. A pull request with an approval, or with no path that needs one, is refused by none but `arm`, which refuses the one that needs one even with an approval (z). 120 runs | test | Effect Arbitrary: Defect | leave the check out of `Arm.arm`, (b) red; ask it before the signatures check: the pair law red; ask it first for a merged pull request, (l) red; let `arm` pass when an approval is on the head, (z) red; refuse a pull request whose only reviewed path is the old half of a move, (c) red | .agents/skills/lead/scripts/pr/Gate.test.ts |
| R9, the gate's reads (slice 2): a pull request outside `REVIEWED` reads the changed paths once and no status; one inside reads paths and then the statuses on its own head only; a read that fails, paths or statuses, is the gate's `Unread` error and never a pass (y); the old `Gate.line` vector gains the review words | test | Effect Arbitrary: Defect | read the statuses for a docs-only pull request, (a) red; turn a failed paths read into `exempt`, (y) red; turn a failed statuses read into no approval silently: (y) red; read the statuses of the base head, (e) red | .agents/skills/lead/scripts/pr/Gate.test.ts |
| R10, the admin override (slice 2): on a pull request that needs a review, an admin merge with no approval and a reason writes exactly one override (comment, then `failure` status) with the reason as given, then asks the pinned `--admin` squash, in that order, with the write after the last re-read of the head and directly before the squash; with no reason or a bad one (t) it writes nothing and merges nothing; with an approval on the head (v) it writes no override and merges; a write that fails (w) merges nothing; reason words the grep refuses (s) write nothing; each refusal after the gate (x) writes nothing. `Done.admin` carries the reason. 200 runs | test | Effect Arbitrary: OverrideCase | write the override right after the gate, (x) red; write after the merge: the call order red; trim nothing, so spaces pass, (t) red; drop the cap, (t) red; always write an override, (v) red; swallow a failed write, (w) red; skip the grep, (s) red | .agents/skills/lead/scripts/pr/Merge.test.ts |
| R11, the quest paths record before they queue (slice 2): `land.ts run` with `--reviewed` and `--reviewer` runs the fresh record step after the pull request is opened and before `queue`, with its own ticket argument as the ticket, and a refusal there stops it before any enqueue; without them on a pull request that needs a review, `queue` refuses with R8's line. `chain.ts` records at the head `ready` pushed (reviewed equals head) and does not call `land` if the record is refused | test | scenario: one quest run through `run` and one through the chain's `ready`, each on the test layers | queue before recording: the call order red; ignore a refused record in the chain: red; pass a ticket flag of its own to `run`: the flag check red | .agents/skills/lead/scripts/land.test.ts |
| T1, the types (both slices): `Gate.Ask` needs `way`, so a path that leaves it out does not typecheck; `Way.admin.override` is a `Reason`, so a blank string does not typecheck; `Review.Record` and `Gate.Way` are matched with no default branch, so a new tag fails each match; a carry `Record` has no `reviewer` | type | type | make `way` optional: red; type `override` as `string`: red; add a tag and leave a match without it: red; give the carry a `reviewer`: red | .agents/skills/lead/scripts/pr/Review.test.ts |

**Every check that guards data has its class and its plant.** In the order the code asks: `record`: the pull request is open
and into main (the state plant in R3), the reviewed head is a commit (p), is an ancestor (p), the carry's walk (d, u), the
patch ids are equal (n, o), neither is none (q), one merge base (r), the leak grep (s), the comment (w), the status (w), the
read back (w). The reader: a full sha (f), the exact context (h), the decode (i), the state (g), the newest-by-id rule (k),
a failed read (y). The gate: the merged shortcut (l), the path test (a, b, c), override never approves (j), the arm
refusal (z), a failed read (y). Admin: a bad reason (t), an approval already there (v), a failed write (w), the write's
place after the last check (x). Each class passes every check before its own, and each plant deletes that check.

**Where each law runs.** All plain files except I1, on every pull request their change reaches and on the laptop with a
narrow path. T1 runs under `pnpm typecheck`. No law is host-only: none needs launchd, Electron, a real signal or a real
socket. I1 is one `.integration.` file, and no stand-in will do for it: the only thing it proves is what real git prints
for a move under `--no-renames`, which CG1's stand-in can only repeat. The laptop refuses that file by name, and pull
requests and the merge queue run none, so the lead starts a proof run of it before the review. Nothing else is new
`.integration.`: `@kalfa/git`'s own `ProcessRepository.integration.test.ts` already proves `rangePatchId` on real git.

**The gap between the memory adapter and real git.** R3 runs on `@kalfa/git/memory`, whose patch ids never equal git's
(the README says so), and which hashes the change by its own rules. So R3 proves our logic over a model's ids: which
heads are compared, when a record is written. It does not prove that real git gives one id to a branch before and after a
merge of main made by GitHub. Only the live proof below does.

## Files

Slice 1 first. A file touched in both slices has a row for each. Slice 2 branches from main after slice 1 lands.

| Slice | File | Owner | Product lines expected | Change |
|---|---|---|---|---|
| 1 | .agents/skills/lead/scripts/pr/Review.ts | build | 160 | `CONTEXT`, `Reviewed`, `REVIEWED`, `ROOT_CONFIG`, `Record`, `status`, `comment`, `core`, `approval`, `Ask`, `record`, the first-parent walk |
| 1 | .agents/skills/lead/scripts/pr/Reviews.ts | build | 30 | the service contract, `Seen` and `ReviewsError` |
| 1 | .agents/skills/lead/scripts/pr/ReviewsGh.ts | build | 85 | the layer: read and write by `gh api` |
| 1 | .agents/skills/lead/scripts/pr/ReviewGit.ts | build | 25 | the `@kalfa/git` process layer on the main checkout, with its limits |
| 1 | .agents/skills/lead/scripts/land.ts | build | 50 | the `review` command, the `review` check literal, header text, `queueServices` gains the layers |
| 1 | .agents/skills/lead/SKILL.md | build | docs | the scripts table row for `land.ts review`; step 9 says to record the verdict, one line, and nothing the code checks |
| 1 | .kalfa/decisions/0093-a-review-verdict-is-a-record-on-the-reviewed-head-and-ci-required-reads-it-on-the-queue.md | lead | docs | the "Not decided here" carry bullet says it is settled and where; the lines that say a check run and "with the bot token it already has (the one `botpush.mjs` mints)" say a commit status written with the lead's `gh` login, with a pointer to this plan, and one line that the root config files need a review too; only those lines |
| 1 | .agents/skills/lead/scripts/pr/ReviewsTest.ts | tests | tests | the in-memory layer: a world of statuses by head, a `calls` list, failing reads and writes by name |
| 1 | .agents/skills/lead/scripts/pr/Review.test.ts | tests | tests | R1 to R4, T1 |
| 1 | .agents/skills/lead/scripts/pr/ReviewsGh.test.ts | tests | tests | R5, R6 and the vector |
| 1 | .agents/skills/lead/scripts/land.test.ts | tests | tests | R7 |
| 2 | .agents/skills/lead/scripts/pr/Changes.ts | build | 15 | the service contract and `ChangesError` |
| 2 | .agents/skills/lead/scripts/pr/ChangesGit.ts | build | 40 | the layer: `git diff --name-only -z --no-renames`, the NUL reader |
| 2 | .agents/skills/lead/scripts/pr/Gate.ts | build | 60 | `Way`, `Ask.way`, `Needs` and `Unread` grow, the review check and its refusal lines, header text |
| 2 | .agents/skills/lead/scripts/pr/Queue.ts | build | 4 | passes `way` queue |
| 2 | .agents/skills/lead/scripts/pr/Arm.ts | build | 6 | passes `way` arm |
| 2 | .agents/skills/lead/scripts/pr/Merge.ts | build | 45 | passes `way`; `Ask.override`; writes the override right before the pinned squash, after the last re-read; `Done.admin.override`; `line` |
| 2 | .agents/skills/lead/scripts/land.ts | build | 40 | `--override-review` on `merge` and `admin`; `--reviewed` and `--reviewer` on `run` and the record step; the check's `mapError` names the two new errors; layers in `check`, `arm` and `queueServices`; header text |
| 2 | .agents/skills/lead/scripts/chain.ts | build | 25 | records at the head `ready` pushed; its `services` gains the layers |
| 2 | .agents/skills/lead/scripts/flow/landing.ts | build | 8 | the queue step provides the new services |
| 2 | .agents/skills/lead/SKILL.md | build | docs | the admin paragraph says the reason flag; the arm paragraph says a pull request that needs a review is queued with `land.ts queue`, not armed; one line each |
| 2 | kalfa/delivery/GLOSSARY.md | build | docs | the term **Override** (see Records) |
| 2 | .agents/skills/lead/scripts/pr/ChangesTest.ts | tests | tests | the in-memory layer: paths by head, failing by name |
| 2 | .agents/skills/lead/scripts/pr/ChangesGit.test.ts | tests | tests | CG1 |
| 2 | .agents/skills/lead/scripts/pr/ChangesGit.integration.test.ts | tests | tests | I1 |
| 2 | .agents/skills/lead/scripts/pr/Gate.test.ts | tests | tests | R8, R9; `Defect` gains `unreviewed`, the world gets paths and statuses |
| 2 | .agents/skills/lead/scripts/pr/Merge.test.ts | tests | tests | R10 |
| 2 | .agents/skills/lead/scripts/land.test.ts | tests | tests | R11, the `run` half |
| 2 | .agents/skills/lead/scripts/chain.test.ts | tests | tests | R11, the chain half |

## Existing tools

- `.agents/skills/lead/scripts/pr/Review.ts`: searched the repo (`pr/Gate.ts` and `pr/Sections.ts` are the model for a pure
  refusal module; `kalfa/ci/src/DocsOnly.ts` classifies a path as docs or code, a different question than "which paths
  need a review"; `Arm.ts`'s `docsOnly` is that one), `@kalfa/git` (`rangePatchId`, `isAncestor`, `mergeBases`,
  `readCommit` give the carry rule and the first-parent walk, so the patch id and the walk are not hand-rolled), the kalfa
  glossaries (no code for approvals; the Delivery context has no package yet), and npm (a hand-rolled `git patch-id`
  wrapper would drop the pinned git config that `ProcessRepository` sets). The record schema and its encodings are new:
  no schema for a review record exists.
- `.agents/skills/lead/scripts/pr/Reviews.ts`: searched the repo (`pr/PullRequests.ts` is the model for a contract-only
  service file; no service for commit statuses exists, and `ci/Checks.ts` answers one named check run, not statuses).
  A service contract only, 30 lines.
- `.agents/skills/lead/scripts/pr/ReviewsGh.ts`: searched the repo (`pr/PullRequestsGh.ts` is the model for a service on
  `gh api`, and its `command.ts` runner is reused; `ci/ChecksGh.ts` reads check runs, not statuses) and `@kalfa/github`
  (it has an operation layer for GitHub; not read whole, the build reads its README before it writes `ReviewsGh` and
  reuses anything that already lists or posts commit statuses). No token handling is needed: `gh` carries the login.
- `.agents/skills/lead/scripts/pr/ReviewGit.ts`: searched the repo (`pr/BranchesGit.ts` shells to git with `command.ts`, but
  has no patch id, ancestor or parent call; `kalfa/git/src/ProcessRepository.ts` has them, with the pinned environment),
  and the lead scripts (no other file builds that layer). About 25 lines, one constant of limits.
- `.agents/skills/lead/scripts/pr/Changes.ts` and `.agents/skills/lead/scripts/pr/ChangesGit.ts`: searched the repo
  (`pr/Signatures.ts` and `pr/SignaturesGit.ts` are the model: a service that answers one git question about a head from a
  `dir`, on `command.ts`; `pr/PullRequestsGh.ts`'s `files` is GitHub's list, which has a 3000-file cut and one name per
  rename), `@kalfa/git` (`diff(from, to)` finds no renames, so it also gives both halves, and fails past its `files`
  limit; but its layer is built on one fixed path, and the gate receives a different `dir` per path, so a call per `dir`
  would need a layer built per call), and git itself (`git diff --name-only -z --no-renames` prints exactly the paths,
  with no config that changes them). A 55-line pair of files in the folder's own pattern.
- New functions inside files that exist: the gate's `review` check in `Gate.ts` (a new entry of `CHECKS`, the place its
  header already names); `Merge.admin`'s override write (an existing function, one more step); `Arm.arm`'s `way` (one
  argument).

## Calls taken

- **Carry names no sha, and a fresh record names the head the report names, 85%.** Typing a sha for a carry is a place to
  type a wrong one, and the walk finds the same fact from the record itself.
- **The gate reads the status on the head and never recomputes the patch id, 85%.** The writer proved the match once, on
  a head that cannot change. A recompute in the gate would need the head fetched and git run on every path, for no new
  fact. 2339 may recompute in CI if it wants a second proof; the status holds the id for it.
- **The gate asks git for the paths itself, 85%.** 0093's header comment in `Gate.ts` said `Ask` would grow the files and
  each path would pass its own. A path that passes the wrong list skips the check, so the gate reads them through
  `Changes`, which is one of its `Needs`. The header comment is updated. This drops GitHub's 3000-file cut and the
  rename gap, and costs a git read on every path.
- **Three ways: queue, arm, admin, 90%.** `check` is the queue way: it says what the queue will say, which is
  the point of a preflight. `arm` is its own way because it refuses even with an approval (the holes above).
- **No sev exemption, 80%.** A sev fix that touches a reviewed path still needs `--override-review` with a short reason.
  The point of 0093 is that the bypass is loud; a flag is a few seconds. A docs-only or tooling-only sev fix is `exempt`.
- **An override is state `failure`, not `error`, 80%** (the table above).
- **The override is written right before the pinned squash, 90%.** Written right after the gate, it would log an
  override for a merge that then refused (a moved head, a red `ci-required`, an occupied queue), a false line in the
  record.
- **A send-back writes no record** (rule 5), 85%.
- **`ticket` is a tracker number, not a plan path, 80%.** A path in a public record can be an absolute path by mistake; a
  number cannot. `run` takes it from its own ticket argument; `review` has `--ticket <n>` for a fresh record, optional.
- **The status is written under the lead's login, not the bot's,** by the owner's ruling. The cost is the one in the
  first doubt.
- **`ReviewsTest` and `ChangesTest` are test layers, owned by tests,** as `PullRequestsTest.ts` is.
- **Slice order is slice 1, then a live proof, then slice 2, 85%.** Slice 2's gate refuses every reviewed-path pull
  request without a record. Slice 1 first proves that a real status can be written, read back and carried under the
  lead's login, and the vector for R5 may come from that run.
- **`ROOT_CONFIG` is enforced, as one named value, 95%.** The owner ruled that those files need a review. It is its own
  value inside `REVIEWED`, so a change to the set is one edit and one record. The cost: dependency bumps by the bot, and any
  change to the lint, layer or vitest rules, need a review record each. The replay (Validation) counts how many open and
  recent pull requests this touches.

## Validation

- tests step, per slice: no dependency changes (`@kalfa/git` is already a root dependency), so no install. Each plain law
  file alone, `nice -n 15 pnpm exec vitest run <file>`, red on the missing code. The `vector:` answers are recorded once
  with `gh api`, with the command and the date in a comment. `ChangesGit.integration.test.ts` is written and not run on
  the laptop, which refuses it.
- build step, per slice: each plain law file green, `pnpm format`, `pnpm lint`, and each plant in the laws table run once
  and undone. No test runs `--changed` or a typecheck in a box; the lead runs those.
- The lead, after slice 1 is built and before its review: the live proof, with a real carry. It needs only the lead's
  `gh` login, so no key is read and no box is involved:
  1. Open the proof pull request (slice 1's own) and record a fresh review with
     `land.ts review <pr> --reviewed <head> --reviewer "<who>"`. Read the statuses back with the gate's reader: a comment,
     and a status `review`, `success`, with the core description, read as `approved`.
  2. Move main on a file the proof pull request also touches: land any small change to a different part of a file the
     proof pull request edits.
  3. Run `gh pr update-branch <pr>`. Check the new head's first parent is the old head.
  4. Run `land.ts review <pr>` with no sha. Expect `kept`: one status on the new head pointing at the first comment, and
     no new comment. If git gives two ids, the command refuses; that is the safe direction, and the lead says what
     differed.
  5. Run `land.ts review <pr>` again. Expect `already`, and no write.
- The lead, before the slice-2 review: a proof run of `ChangesGit.integration.test.ts` (the lead starts it; the laptop
  refuses it and the queue runs none).
- The lead, after slice 2 is built: `node .agents/skills/lead/scripts/replay.ts <pr>` (ticket 1302), which runs
  `land.ts check` on the last merged and every open pull request. Expected: no merged pull request refused; each open one
  refused is one that changes a reviewed path with no record. Any other refusal is a false alarm, found before it blocks.
  This is the measure the false-alarm rule asks for.
- The lead, after slice 2 lands, as a sev-free check: one admin merge of a docs-only pull request passes with no flag.

## Size

1. Slice 1, the record and the command: 350 lines (`Review.ts` 160, `ReviewsGh.ts` 85, `Reviews.ts` 30, `ReviewGit.ts`
   25, `land.ts` 50, the rest docs). It lands whole: the lead can record, carry and read a verdict by one command, and
   nothing is enforced yet.
2. Slice 2, the gate and the paths: 243 lines (`Gate.ts` 60, `Merge.ts` 45, `ChangesGit.ts` 40, `land.ts` 40, `chain.ts`
   25, `Changes.ts` 15, `flow/landing.ts` 8, `Arm.ts` 6, `Queue.ts` 4). It lands whole: from then on every path refuses a
   reviewed-path pull request with no record, `arm` refuses it outright, and an admin merge needs a reason.

About 590 product lines in all, plus the laws, the `vector:` answers and one glossary term. About 5 agent hours across
the steps, 65% sure. The doubt: `chain.ts` and the shape of `ReviewsGh` against `@kalfa/github` are not read whole, and
the first-parent walk's test model (a history with merges on both sides) is the largest test piece. Priced at about $10 a
step at list price, as the diff plan's were: tests, build and review for each slice, and one send-back each.

Estimate: 8 steps, $80

## New names

Each name a pull request exports, with the industry's word and its source:

- `Review.Record` and its tags `pass`, `carry` and `override`: a review that approves is Gerrit's "Code-Review +2" vote
  and GitHub's `APPROVE` review (https://docs.github.com/en/rest/pulls/reviews); `carry` is the Delivery glossary's
  carry rule; `override` is Gerrit's `OVERRIDDEN` submit requirement status
  (https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html).
- `Review.status`, `Review.comment`, `Review.core`: the commit status (https://docs.github.com/en/rest/commits/statuses)
  and the pull request comment each encoding goes to; `core` is the part the status alone holds.
- `Review.approval` with `exempt`, `approved`, `missing`: **Approval** is already in `kalfa/delivery/GLOSSARY.md`.
- `Review.Reviewed`, `REVIEWED`, `ROOT_CONFIG`, `CONTEXT`: plain words for the rule's value and the status's context.
- `Reviews` (the service) and `ReviewsError`, `Changes` and `ChangesError`: the folder's own `PullRequests`,
  `Signatures` and error shape.
- `Gate.Way`, `queue`, `arm` and `admin`: the merge queue, "Merge when ready" and the admin merge, GitHub's own three ways
  (`gh pr merge --admin`).
- `patchId`: git's `patch-id`, the name the package uses.

The one new domain word, **Override**, is under Records. The other words (approval, kept, carry rule, review) are the
glossary's own and are used as they stand.

## Records

- `kalfa/delivery/GLOSSARY.md` gains one term in slice 2's build, written by the build and checked by the review:

  **Override**:
  A written reason for landing a changeset with no approval. It is recorded on the changeset's head, never counts as an
  approval, and makes the landing loud and attributable.
  _Avoid_: bypass, waiver, skip, force, exception

- Decision 0093: slice 1 rewords its one "Not decided here" bullet on the carry rule to say it is settled and where the
  rule lives (`pr/Review.ts`, this plan), and rewords the lines that name a check run as the carrier, and the line "with
  the bot token it already has", to say a commit status written with the lead's `gh` login. No new decision: the carry
  rule is 0066's `kept`, the carrier is 0093's own fallback, and a rule that code checks keeps its why in a comment
  beside the check.
- **Decided note: the root config files need a review (the owner, 2026-11-27).** The set is the root package manifest, the
  lockfile, the root tsconfig files, the oxlint plugin folder, the layer rules file, the root vitest files and the check
  workflow. The reason it is written down here: a lockfile or manifest change moves what every reviewed file runs on, and
  the lint rules, layer rules, vitest files and workflow are what keep the gate honest (0093 itself says a pull request
  can drop its own gate by editing the workflow). Slice 1's reword of 0093 adds one line for it, written by the lead with
  the adr skill, and `ROOT_CONFIG` in `Review.ts` is its code. 2339 reads the same `REVIEWED` value.
- No pattern doc, no runbook. A runbook for an override is written the first time one is done for real.

## What this cannot tell us

- That a status posted under the lead's `gh` login works as the research read it: that "users with push access" may
  create one, that the list of a commit's statuses is newest first and gives `creator`, and that a `failure` status on a
  merged pull request shows as it should. All read from docs by the research, or from memory, and not run. The slice-1
  proof run is the first real check, and it can check only the write, the read and the carry, not the queue.
- That GitHub's `update-branch` always puts the old head first. I read three real merges of this repo, not GitHub's docs.
- Whether a real status can be found for the R5 vector in a public repository (this repo's own have none). The proof run
  is the fallback.
- That a patch id of main..head gives one id after `gh pr update-branch` (a merge commit GitHub makes). The package's
  README says so for a branch with the upstream merged in, and R3 runs on a model whose ids are not git's. Only the live
  proof shows it. If it fails, the carry refuses, which is the safe direction.
- Whether `@kalfa/git`'s `ProcessRepository.layer` opens the main checkout's `.git` directly. The README says "bare
  repository at `path`"; the build tries it first, and the fallback is plain `git patch-id --verbatim` as the research
  proposed.
- Who may write a status named `review` (anyone with write access), and so whether a status here was posted by the lead.
  This plan stores `creator` and does not judge it; 2339 must.
- Whether the old pipeline's ship stage still runs and enqueues; I read the import chain only.
- Whether a push to a pull request already in the queue drops it (the research found no answer).
- How often a pull request that matches `REVIEWED` lands today (the load of this rule). The replay measures only the open
  ones.
- The `chain.ts` and `flow/landing.ts` call sites beyond the lines I read, and `@kalfa/github`'s reuse (marked above).
- What 2339 does with a pull request whose head has no status yet on the queue's commit: that is its plan.

## Open questions

None.

The root config question the earlier draft held is answered (see Records).

## Findings

- `PullRequestsGh.files` lists only `.filename`, so a rename of a code file into a Markdown path reads as a docs-only pull
  request in `Arm.docsOnly` (`.agents/skills/lead/scripts/pr/Arm.ts`, `docsOnly(files)`, and
  `.agents/skills/lead/scripts/pr/PullRequestsGh.ts`, the `files` jq `.[].filename`). This plan no longer fixes it, since
  the review check now reads paths from git; it stays a finding for a separate change.

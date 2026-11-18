Approved by the lead agent, builds 0602 and 0599 on the delivery plan, amended by the lead's ruling that delivery comes from main's full run; body ab059fc29a8b
Plancheck-Version: 3

# Plan: CI delivers the tested @kalfa/config archive from main's full run, then two CI speed items

Tracker ticket 1076, slice 2 delivery. Today's CI tooling, serving `next/` and `kalfa/`.
This builds the deferred CI rows of the approved package amendment
(`docs/plan/quests/kalfa-config-package-amendment-PLAN.md`, body `17f51b782370`: P4, Q1 and its
seven "Deferred" rows) and the thirteen private routing paths of the approved ordinary-routing
amendment (`docs/plan/quests/kalfa-config-package-ordinary-routing-amendment-PLAN.md`, body
`c4b73d23406a`: O1 to O4). It also plans the two CI speed items the lead asked for, A and B2,
which the lead has answered (see Calls taken).

This is the plan approved with body `06fb72170771`, amended after decision 0602 (see "Amendment:
the archive is kept by main's full run"). Every section the amendment changes says so in its
first line; the rest stand as approved.

Doubts first, because the owner is away:

- **P1's source fault needs a step CI does not have yet, 80% sure it is inside the approved
  plan.** The approved P1 row names its plant ("point the package App export at a missing
  module") and says plants run in CI "through the existing eligible mechanism". The only such
  mechanism today is the checklist fixture's, in a file we do not own. This plan adds one small
  fault step for P1 alone, in `related.ts` (answered under Calls taken).
- **B2 has one run of data, so B2 is a measuring step here, not a split.** See "B2".
- **Amendment: P2's first run at the merged head is main's full run after the merge, 90% sure
  this is decided.** Decision 0602 puts every `.integration.` law on main's full run alone, so no
  pull request run, queue run or branch proof run can run P2 before 1583 and this layer land. The
  last P2 run in CI is this pull request's green run at `2aee1e4f2`, before main `279f97ee`. A red
  P2 or a refused receipt on main opens the `ci-scheduled` issue, a sev1, within about an hour
  (0581), and the fix goes forward (0544). That is 0602's stated loss, not a new one.
- **Amendment: the test job's backstop, 75% sure it needs no change.** The receipt and the
  archive upload each take a one-minute step limit after the vitest step, so the step limits after
  a test step rise from 2 to 4 minutes against SC13's 3-minute backstop. Expected cost is about
  10 s per leg (one `vitest list` of one file, a hash, a two-file upload). Only a leg whose vitest
  step used over 16 of its 17 minutes and then hung in a receipt or upload would end `cancelled`.
  This plan leaves the backstop at 3; a first main run that shows more than 30 s for the two steps
  settles it the other way.

```ts
// Sketch. The whole idea, after decision 0602. Main's full run builds, tests and keeps the archive:
// each numbered vitest leg of scheduled.yaml's `tests` job, on main alone, reads its own report.
// The one leg whose report holds P2 checks the receipt and uploads exactly the two files; every
// other leg checks that P2 is a next-integration file and that it left no folder. The merge line
// keeps P1 and its source fault, as approved.
const PACKAGE = `${KALFA}/src/Package.integration.test.ts`; // KALFA = "kalfa/config", P2's file
//   scheduled.yaml, tests, after `vitest`:
//     node .github/ci/related.ts --receipt -> kept (kept=true), absent (kept=false) or refused (exit 1)
//     upload-artifact, only when kept: the two exact paths, if-no-files-found: error
//   check.yaml, related, after `tooling`, on the leg that holds P1:
//     node .github/ci/related.ts --fault   -> P1 red with the fault, bytes restored, P1 green
selection.consumer; // "" or the one tooling leg that holds P1; `archive` is gone
```

## Amendment: the archive is kept by main's full run

What happened. The parent branch `fabrikalfa/kalfa-config-package` (PR 1583) moved to
`7d38689ff734316fb5626d07f49b62e8b1e9cd50`, which carries main `279f97ee`. That main holds
[PR 1613](https://github.com/kamp-us/tea-fabrika/pull/1613) and
[PR 1618](https://github.com/kamp-us/tea-fabrika/pull/1618), which build decision 0602
([PR 1614](https://github.com/kamp-us/tea-fabrika/pull/1614), branch
`fabrikalfa/adr-integration-off-merge-line`): no pull request, merge queue or branch proof run
starts an `.integration.` law, and main's full run (`scheduled.yaml`, on a push to main and on the
hourly catch-up) runs them all. 1618 also moved `related.ts`'s main block into `run(step)` with a
`Step` input, and picks the projects by the runner's event (`projectsOf`, `onMergeLine`). This
branch must merge `7d38689ff` (a plain merge, never a rebase, 0599), and its delivery must move.

The lead's ruling: keep the archive from main's run. P2 already runs on main, in `scheduled.yaml`'s
`tests` job (`--project next --project next-integration`, five numbered legs). So the build and
the test stay where they are; the keep (the receipt check and the two-file upload) moves.

The laws that change, and why none is a loosening:

| Law | Before | After |
|---|---|---|
| D1 | P2 added by path to one `next-integration` leg of a ready pull request or queue group, named by `archive`; P1 added by path to one tooling leg, named by `consumer` | P2 is never added by path, on any event. P1 keeps its rule and its leg. The route set loses the record guard, which no longer holds a delivery rule |
| D2 | `--receipt` keeps only on a ready pull request or a queue group, with `requested` the event's head | `--receipt` keeps only on main's ref and a push, schedule or hand-start event, with `requested` and `source` both the run's commit. It has a third verdict, `absent`, for the four legs P2 did not run on, which holds only when P2 is discovered in `next-integration` and the leg left no folder |
| D3 | check.yaml's `related` job has `package receipt`, `consumer fault` and `package archive` | `related` keeps `consumer fault` alone. `package receipt`, `package archive` and `id: integration` leave check.yaml. `package receipt` and `package archive` enter `scheduled.yaml`'s `tests` job |
| D4 | `select` prints `archive` and `consumer` | `select` prints `consumer` only; `archive` leaves |
| D5 | the fault step on the tooling leg that holds P1 | unchanged |
| Q1 | `record.ts` allows exactly one archive upload in check.yaml, through the related guard's predicate | `record.ts` returns to its parent's bytes: check.yaml uploads no archive, and Q1 refuses one |
| SC9, SC22 | none | SC9 lists the receipt command beside the test job's commands. A new SC22 pins the two steps and refuses any other keeper |

Why none of these is a loosening:

- **D1's P2 rule and D4's `archive`** only fed the related job's keep. 0602's binding constraint
  forbids P2 on the merge line, and 1618's `projectsOf` already lists no `next-integration` file
  there, so the rule could no longer run. The pre-merge run of P2 is what 0602 gives up, by the
  owner's decision, not by this plan. P2 still runs on every main full run, at full depth.
- **D1's route set loses `record.ts`**, because the record guard returns to its parent's bytes and
  holds nothing of P1 or its fault. The set stays `related.ts`, check.yaml and the related guard,
  the three files that hold the fault mode, the fault step and its pin.
- **D2's event clause** moves from one event family to another; it does not widen. A branch ref, a
  pull request and a queue group are all refused. The `requested` check stays; on main the run's
  commit is the only head, so it must equal `source`. The new `absent` verdict is stricter than
  before: a leg that does not keep must prove P2 is a `next-integration` file and that no folder
  is lying about, so a renamed or dropped P2 turns main red instead of silently keeping nothing.
- **D3's and Q1's related-job pins** guarded steps that leave check.yaml. Their replacement, SC22,
  guards the same two steps in `scheduled.yaml` on the same terms: the receipt right after the
  leg's tests and before any upload, `success()` in both `if`s, the two exact paths,
  `if-no-files-found: error`, no token, no `continue-on-error`, and one keeper in the workflow.
  Q1 itself tightens: check.yaml goes back to uploading only the record, the reports and the
  timings.
- **SC9 gains one command** that runs no test: it reads a report, hashes two files and lists one
  path. SC9's rule, that no step runs another test command or narrows one, still holds, and a
  plant checks that a narrowed P2 run is still refused.

## The shard problem

P2 has no row in the full-depth shard table, so `Shards` places it at the median, on whichever
numbered leg `assign` gives it. That leg moves when files are added or rows are refreshed. Four
designs were weighed, by what each loses and how each fails.

| Design | What it loses | How it fails |
|---|---|---|
| A receipt step on every numbered leg, which reads that leg's own report (chosen) | nothing; about 10 s per leg | P2 missing from `next-integration`: all five legs refuse `discovery`, main is red. A folder on a leg without P2: `stray`, red. Two keepers: impossible by `assign`'s partition, and a second upload under the same name fails the run |
| The same step, gated on the delivery folder existing | the case where P2 never ran: no folder, no step, no archive, and nothing turns red | silently. `hashFiles` cannot read `runner.temp` either, so the gate would sit in the script anyway |
| A dedicated step that runs P2 alone on one fixed leg | SC9's rule that no step narrows a test command; P2 runs twice, and the two runs can disagree; one pinned leg grows by P2's time, which moves SC20's measured start order | two P2 results per run to reconcile; a pin that drifts from the measured table |
| A job of its own for P2, or a row that pins P2 to a leg | a sixth job, which SC19 and 0595's ten-job budget forbid without a new decision; or a slot-map fact the shard table only orders by | a budget or pin change the owner must make |

The chosen design takes no job, no group, no slot map and no new issue path: SC19's five jobs,
SC6's budget, SC20's pins and the report job (`scheduled.mjs`, which reads only `results-*`
artifacts) stay as they are. A failed receipt fails its leg like a red test; fail-fast stops the
other legs, the run ends `failure`, and the report opens or updates the `ci-scheduled` issue (0602,
0534). 0536 and 0584 hold: P2 runs only on main's full run, and the receipt is a check of its
output, not a law. 0594 is not reached: nothing here runs on the owner's Mac.

## Where a downstream project finds the archive

The artifact is `kalfa-config-<sha>-attempt-<n>` on a `scheduled.yaml` run on main, kept 90 days
(`retention-days`, a setting, 0069). It holds `kalfa-config-0.0.0.tgz` and `receipt.json`.

```sh
# Sketch. The newest green full run on main that kept an archive.
gh run list -R kamp-us/tea-fabrika --workflow scheduled.yaml --branch main --status success \
  --json databaseId,headSha --limit 20
gh run download <run> -R kamp-us/tea-fabrika --pattern 'kalfa-config-*' --dir kalfa-config
# receipt.json's sha256 must equal the archive's; its source names the commit.
npm install ./kalfa-config/kalfa-config-<sha>-attempt-<n>/kalfa-config-0.0.0.tgz effect@4.1.3
```

- **Take it from a green run only.** The upload runs when its own leg's tests and receipt passed,
  before the other legs end, so a run that later turns red can still hold one.
- **A green run may hold none.** A push whose gate said `false` ends green in seconds and runs no
  tests. Skip it and read the next run.
- **The hourly catch-up keeps, and never re-keeps.** The gate starts it only on a main head that
  has had no full run (0581), so its archive is that head's first. It should keep: after a burst of
  pushes inside the hour, the catch-up's head is main's newest, and without it the newest archive
  would lag main by up to an hour of pushes. A hand start on main may run a head again; it keeps a
  second archive of the same commit in its own run, which names the same tested source.
- **A head the gate skipped** (a push inside the hour, followed by another push) gets no archive.
  A project pins an archive by its commit, never by "the archive of main's head".

## Scope, base and what this plan takes on

Amended after decision 0602: the base, the sequence's third step, the path count and the pieces
read but not changed.

This pull request is the fourth layer of native stack 1554: 1427, then 1525, then 1583, then
ours, kept current under decision 0599 (link the whole chain, keep children current by merging,
never rebase). Branch `fabrikalfa/kalfa-config-delivery` starts from 1583's branch,
`fabrikalfa/kalfa-config-package`. The approved plan was read against 1583's head `322e6c16`,
main `397e63f4` (PR 1581) and `a6761bce`. This amendment was read against our head `2aee1e4f2`,
1583's head `7d38689ff734316fb5626d07f49b62e8b1e9cd50` and the main it carries, `279f97ee`
(PR 1618).

The sequence, as the lead ruled, with the third step amended:

1. **1427 and 1525 land first.** 1525 turns `require-readable-spacing` on as an error over the CI
   folder; its autofix of the files 1581 added is one mechanical commit inside 1525, owned by
   another lane. Our edits go on top of it. No step of ours reformats those files; `pnpm format`
   touches only lines we wrote.
2. **Decision 0598's build lands first on the shared lines.** Done: it is on main, and on our
   branch since the merge at `2aee1e4f2`.
3. **1583 and our layer land together, on their merge-line checks.** Decision 0602 takes P2 off
   every run before the merge, so our receipt can no longer be green on the merged head before it
   lands. The package's lifecycle proof and the first kept archive come from main's first full run
   after the merge, within about an hour (0581). A red P2 or a refused receipt there is a sev1, as
   every red law on main is (0602). Our pull request's checks still run P1 and its source fault.
4. **We never write to layers 1 to 3.** A change any of them needs is the other lane's, named to
   the lead.

P1 and its fault run on our ready pull request because this plan selects P1 on a change to the
fault route (D1). P2 does not run there, on any event.

The lane owns 21 paths: the 13 ordinary-routing paths plus the 7 delivery paths, two of which
(`changes.mjs`, `check.yaml`) are in both lists, and the three this amendment adds:
`scheduled.yaml`, the scheduled guard and its test. They were outside the lane's 18, and the lead
has asked to widen it. One of the 21, the record guard, returns to its parent's bytes. They are
the Files table below.

What this plan takes on, for the lead's handoff checklist:

| Item | Ours? | Why |
|---|---|---|
| The seven routing and upload paths (P4, Q1) | yes | All seven are among our 21. |
| The thirteen ordinary-routing paths (O1 to O4) | yes | All thirteen are among our 21. |
| P2's runtime proof: its strict declaration check, its installed-copy refusals and the restored positive, then the upload of the exact tested archive and receipt | yes, on main | P2 runs them inside one test on main's full run; our receipt step on that leg uploads only after P2's own passing, unskipped result (D2, SC22). |
| P1's source fault and its restore proof | yes | The fault step (D5), on the tooling leg that owns P1, on our pull request. |
| A fresh review of the applied delivery source at the real package head | yes | The review step runs at our head after the merge of `7d38689ff` (Validation). |
| Decision 0599's upkeep | yes | One plain merge of 1583's branch per parent move; no rebase, no force-push, no write to layers 1 to 3. |
| 1583's own whole-diff review | no | It reviews 1583's diff. Our review reads our diff. |
| A, B2 | planned here | Follow-up pull requests, each with its own laws; both come back to the lead for a new plan (see each). |

One correction to the brief's list: it names `record`'s test too. The approved Q1 row puts Q1's
negative cases in the related guard test, "no new test file". This plan does not edit
`record.test.ts`. If its existing cases go red, that is a blocker for the lead, not a row here.

Pieces outside our 21 that the work reads and does not change: `proof.ts` (`legsOf`, `whole`,
`isTrigger`), `related.ts`'s `wantsChecklistLaw` and `checklistFixture`, `required.mjs` and the
`jobs.ts` guard (both pin `select`'s name, `needs` and `if`, which this plan keeps),
`scheduled.mjs` and `gate.mjs`, the shard-rows guard, both shard tables, `vitest.shards.ts`, the
Vitest config and every slot-concurrency map. If any of these must change, the step stops and
names it to the lead as a blocker.

## The merge of 7d38689ff

Amended: replaces "Where our edits meet decision 0598's build", whose build has landed.

The lead makes the merge commit, as for each earlier parent move: `git merge 7d38689ff`, a plain
merge (0599). A trial with `git merge-tree` at `2aee1e4f2` conflicts in three files; every other
file merges clean, check.yaml and the related guard included. The merge commit resolves the
conflicts by both sides' behavior, with no amendment edit in it, so a review can read the merge
and the amendment apart. The tests step's commits after it make the amendment. The merge commit
need not be green by itself: 1589's old P2 selection cases fail under 1618's `projectsOf` until
the amendment rewrites them. CI proves only the head after both.

The rule: **1618's frame stays, and 1589's code is laid beside it.**

- **`related.ts`.** Keep 1618's header comment, its `isIntegration` import, `onMergeLine`,
  `projectsOf`, `Lists`, `select(event, lists, sizing)`, `Step` and `run(step)`, and its last
  `if (import.meta.main)` block, which calls `run`. Keep 1589's imports beside 1618's (one import
  per module), and its whole delivery and fault code: `KALFA`, `PACKAGE`, `CONSUMER`, the route
  set, `delivered`, `confirmed`, the receipt schemas and `checkDelivery`, `checkFault`,
  `consumerArgs` and `fault`. 1589's two mode branches, `--receipt` then `--fault`, come before
  1618's main block, which becomes their last `else if (import.meta.main)`. Inside `run(step)`,
  1589's `need` and `confirmed` calls move into 1618's two `Lists` thunks, reading `step.list`
  for `list(root, ...)`; the thunks keep 1618's laziness, so a project the event does not pick is
  never listed. In `select`, 1589's `owner` check runs after 1618's nine-leg cap, over `picked`,
  and the returned record gains `archive` and `consumer`; `outputs` keeps 1618's four lines and
  adds 1589's two.
- **`related-selection.test.ts`.** Keep 1618's import line's names and add 1589's
  (`checkDelivery`, `checkFault`, `confirmed`, `consumerArgs`, `delivered`, the Vitest projects
  and `classify`). Keep every case of both sides. 1589's cases that call `select(files, sizing)`
  call 1618's `select(event, lists, sizing)` with an event and thunks over the same files.
- **`legs.test.ts`.** The conflict is the two import lines: take the union of the names on each
  side, one import per module. Both sides' cases stay unchanged.
- `pnpm format` then orders the imports; it changes no other line.

After the merge, the amendment's edits are the Files table's.

Build order, set by the sev0 landing line: ticket 1161 also edits `scheduled.yaml` and the
scheduled guard, and lands on main before this stack. So the work goes in two parts:

1. **Now:** the merge of 7d38689ff, then every edit outside the three `scheduled` paths: the
   selector, the receipt code, check.yaml, the record guard, the related guard and their laws.
2. **Once 1161 is on main:** merge main into this branch with a plain merge. Then make the
   `scheduled.yaml` steps, SC22 and SC9's one new command on top of 1161's lines, changing
   only what the move needs.

The review reads both parts. CI proves only the head after part 2.

## How others do it

Amended: the last three bullets are new.

- **Vitest's own selection.** `vitest list --changed <base>` follows imports, and
  `forceRerunTriggers` makes listed files run everything ([CLI](https://vitest.dev/guide/cli.html#changed),
  [config](https://vitest.dev/config/forcereruntriggers), read in Vitest 5.0.5's installed
  `cli-api` chunk by `proof.ts`'s comment). A test that reads files without importing them is
  invisible to `--changed`; decision 0590 item 4 and `changes.mjs`'s `readers` add such tests by
  path. P1 is added by path the same way, the way `related.ts` already adds the checklist fixture
  through `wantsChecklistLaw`.
- **npm's tarball install.** `npm install <file>.tgz` installs a packed archive like a registry
  version; `pnpm pack` substitutes `publishConfig.exports` (the approved amendment and
  experiment 108 cite this path).
- **GitHub Actions.** Job outputs pass values to later jobs through `needs.<job>.outputs`, and a
  step's outputs to later steps of its job through `steps.<id>.outputs`; an artifact is the run's
  kept file. Not fetched for this plan: the exact rule for `if-no-files-found` when one of several
  paths is missing in `actions/upload-artifact@v7`, and its refusal of a second upload under one
  name in one run, which upload-artifact's README described for v4 and later. The design does not
  depend on either, because the receipt step checks both files before the upload and SC22 allows
  one keeper.
- **Elm and OTP** add no machine here. This is a CI filter, a check and an upload.
- **Presubmit and post-submit.** Google runs only fast, reliable tests before a submit and every
  affected test, larger ones included, after it
  ([Software Engineering at Google, chapter 23](https://abseil.io/resources/swe-book/html/ch23.html),
  as decision 0602 cites it). P2 is a larger test, so it runs post-submit, on main's full run.
- **Build once, keep what was tested.** Continuous delivery's rule is to build the binary once
  and promote that same binary, never to rebuild it for release (Humble and Farley, *Continuous
  Delivery*, 2010, "Only build your binaries once"; not fetched for this plan). Here P2 packs the
  archive once on main's full run, tests that copy, and the receipt names its commit and digest,
  so a project installs the bytes that were tested.
- **Keep the check beside the run it checks.** Each leg judges only its own report, as each
  leg's `results` upload and time table already do: no leg reads another leg's state, which a
  matrix cannot share without a job after it.

## The shape

Amended: Selection, the receipt check, the workflow and the new guard. The P1 fault and ordinary
routing stand as approved.

### Selection (P4)

```ts
// Sketch of .github/ci/related.ts after the merge: 1618's run(step), select(event, lists, sizing).
const KALFA = "kalfa/config";
const CONSUMER = "scripts/" + "kalfa-config.test.ts"; // P1, a plain tooling law

/** The paths, beside the package, whose change must run P1 and its fault: the fault's route. */
const ROUTE = new Set([
  ".github/ci/related.ts",          // holds --fault
  ".github/workflows/check.yaml",   // holds the consumer fault step
  ".github/ci/workflow-lint/related.ts", // pins it
]);

/** Keep P1 in the ordinary related run when the package (built files aside) or its fault route changes. */
export const wantsConsumerLaw = (paths: readonly string[] | null): boolean =>
  paths === null ||
  paths.some((path) => (path.startsWith(`${KALFA}/`) && !path.includes("/dist/")) || ROUTE.has(path));

// In run(step), with need = full || wantsConsumerLaw(changed):
//   "next-integration": 1618's thunk, plus the readers on a `kalfa/` change; never P2 by path.
//   tooling: () => confirmed(step.list(["--project", "tooling", ...narrowed]),
//                            need ? step.list(["--project", "tooling", CONSUMER]) : [], CONSUMER, need)
// In select(): after the nine-leg cap, CONSUMER on exactly one tooling leg of `picked`, else throw.
//   It returns { legs, projects, consumer }; outputs() prints run, legs, files, projects, consumer.
```

`delivered` is renamed `wantsConsumerLaw`, beside `wantsChecklistLaw`, since it no longer keeps a
delivery; `DELIVERY` is renamed `ROUTE` and loses the record guard. `confirmed` stays as approved.
The selected set only grows. On the merge line, 1618's `projectsOf` lists tooling alone, so no
`next-integration` file is listed, P2 included. On a push to main whose changes job failed, the
related job lists `next-integration` as 1618 left it; P2 runs there only if `--changed` reaches
it, as any other integration file, and nothing keeps its folder.

`changes.mjs` keeps `kalfa/` in its `readTrees`, so a Markdown change in the package runs the heavy
jobs, and P1 with them, instead of being skipped as safe Markdown.

### Receipt check (SC22's step, on each numbered leg of main's full run)

```ts
// Sketch of the --receipt mode of .github/ci/related.ts: the Receipt and Report schemas, sha256,
// sameKeys, suitesOf and passedClean stay as built.
export type Delivery =
  | { readonly _tag: "kept"; readonly sha256: string; readonly source: string }
  | { readonly _tag: "absent" } // P2 ran on another leg: no P2 in this report, no folder here
  | { readonly _tag: "refused"; readonly reason:
        | "event" | "discovery" | "stray" | "missing" | "extra" | "unreadable"
        | "digest" | "source" | "requested" | "stage" | "exports" | "result" };

export const checkDelivery = (input: {
  readonly ref: string | undefined;    // GITHUB_REF, which the runner sets on every step
  readonly event: string | undefined;  // GITHUB_EVENT_NAME
  readonly head: string;               // GITHUB_SHA, the commit the leg checked out
  readonly listed: readonly string[];  // `vitest list --project next-integration <P2>`, via legs.ts's list
  readonly folder: Readonly<Record<string, Uint8Array>> | null; // null: no delivery folder
  readonly report: unknown;            // $RUNNER_TEMP/results.json, the vitest step's own report
}): Delivery => { /* in this order: */ };
// 1. event:     ref is refs/heads/main and event is push, schedule or workflow_dispatch.
// 2. discovery: listed is exactly [PACKAGE].
// 3. result:    the report decodes; when it holds P2 it holds it once, passed, unskipped, and the
//               report has success, no failed test and no failed suite.
// 4. no P2 in the report: folder null -> absent; any folder -> stray.
// 5. P2 in the report: missing, extra, unreadable, digest, source (== head), requested (== head),
//    stage, exports, as built.
// The main block prints `kept=true` or `kept=false` to GITHUB_OUTPUT and exits 0; refused exits 1
// with its reason. It branches on the verdict with Match.valueTags (0567).
```

The mode reads the runner's own variables, as 1618's select step reads `GITHUB_EVENT_NAME`, so the
step has no `env` a change could point at another commit. P2 writes `requested` from the event's
pull request or queue head, else `GITHUB_SHA`; on main there is neither, so `requested` is the
run's commit, and the check holds it equal to `source`.

P2's own run is where the four installed-copy refusals happen: source TypeScript in a packed
export, the parser output removed, a declaration removed (tsc with `skipLibCheck: false` must
answer TS7016 or TS2307 naming `@kalfa/config/App`), and a workspace runtime import. After each,
P2 restores the copy and runs the runtime client and tsc again, so a passing P2 includes the
restored positive. The receipt names the refusals, but only P2's passing result proves them,
which is why the receipt step reads the report.

### P1's source fault (D5)

```ts
// Sketch of the --fault mode of .github/ci/related.ts: CI only (CI and GITHUB_ACTIONS "true").
type Fault =
  | { readonly _tag: "proven"; readonly digest: string }   // red with the fault, restored, green
  | { readonly _tag: "refused"; readonly reason:
        "environment" | "not_red" | "wrong_reason" | "not_restored" | "not_green" };
// 1. Read kalfa/config/package.json; keep its sha256.
// 2. Point exports["./App"] at "./src/Missing.ts" (the approved P1 plant), write it.
// 3. Run `pnpm exec vitest run --project tooling <P1> --reporter=json --outputFile.json=<temp>`:
//    it must fail, and the report must show P1 failed on resolving @kalfa/config/App.
// 4. Restore the original bytes in a finalizer; the sha256 must match and
//    `git diff --exit-code -- kalfa/config/package.json` must be clean.
// 5. Run P1 again: it must pass, unskipped.
```

### Workflow: check.yaml's related job

```yaml
# Sketch. As built, less the receipt and the upload: `integration` loses `id: integration`,
# `select`'s outputs lose `archive`, and `package receipt` and `package archive` leave.
# After `tooling`, on the leg that owns P1, unchanged:
- name: consumer fault
  if: success() && needs.select.outputs.consumer == matrix.shard
  timeout-minutes: *related-tooling-limit
  env:
    FABRIKA_TEST_DEPTH: full
  run: node .github/ci/related.ts --fault
```

`select` keeps the output `consumer`, `${{ steps.set.outputs.consumer }}`. `related` still runs
only after a successful `select`.

### Workflow: scheduled.yaml's tests job

```yaml
# Sketch. Directly after `vitest`, on the numbered legs of main's full run:
- name: package receipt
  id: receipt
  if: success() && github.ref == 'refs/heads/main' && !startsWith(matrix.shard, 'e2e-') && !startsWith(matrix.shard, 'tooling-')
  timeout-minutes: 1
  run: node .github/ci/related.ts --receipt
# Directly after it, on the one leg whose receipt said kept:
- name: package archive
  if: success() && github.ref == 'refs/heads/main' && steps.receipt.outputs.kept == 'true'
  timeout-minutes: 1
  uses: actions/upload-artifact@v7
  with:
    name: kalfa-config-${{ github.sha }}-attempt-${{ github.run_attempt }}
    path: |
      ${{ runner.temp }}/kalfa-config-package/kalfa-config-0.0.0.tgz
      ${{ runner.temp }}/kalfa-config-package/receipt.json
    if-no-files-found: error
    retention-days: 90
# ... chromium, end to end, tooling tests, results, time table, timings, as today ...
```

A numbered leg's only test step is `vitest`, so the receipt runs after every test step of its leg
and before any upload, and binds the folder and report P2 just wrote. The header comment's table
gains one line: the numbered legs keep the archive on main. The workflow's `permissions` stay
`actions: read` and `contents: read`: an artifact upload uses the runner's own runtime token, as
the `results` and `timings` uploads do.

### Guard: SC22 in the scheduled guard

```ts
// Sketch of SC22 in .github/ci/workflow-lint/scheduled.ts, beside SC9 and SC10.
const RECEIPT = "node .github/ci/related.ts --receipt";
const ON_NUMBERED = `!${ON_E2E} && !${ON_TOOLING}`;
const RECEIPT_IF = `success() && ${ON_MAIN} && ${ON_NUMBERED}`;
const ARCHIVE_IF = `success() && ${ON_MAIN} && steps.receipt.outputs.kept == 'true'`;
const DELIVERY = "${{ runner.temp }}/kalfa-config-package";
const ARCHIVE_WITH = {
  name: "kalfa-config-${{ github.sha }}-attempt-${{ github.run_attempt }}",
  path: [`${DELIVERY}/kalfa-config-0.0.0.tgz`, `${DELIVERY}/receipt.json`], // these two, in order
  "if-no-files-found": "error",
}; // and `retention-days`, a setting (0069): only a whole number of 1 or more is held

// SC22. Main's full run keeps the tested archive, once, on the leg that ran P2.
//  - In `tests`, exactly one step runs RECEIPT: name `package receipt`, id `receipt`, if RECEIPT_IF,
//    timeout-minutes 1, and no other key (no env, no token, no continue-on-error); it is the step
//    right after the vitest step (WHOLE_NEXT).
//  - In `tests`, exactly one step is `package archive`: upload-artifact, if ARCHIVE_IF,
//    timeout-minutes 1, `with` exactly ARCHIVE_WITH's keys and retention-days, no other key; it is
//    the step right after the receipt.
//  - No other step of any job runs RECEIPT, names DELIVERY, or uploads a name starting
//    `kalfa-config-`.
// SC9's command list gains RECEIPT and nothing else.
```

### Ordinary routing (O1 to O4), as approved

```ts
// changes.mjs: the full filter names both roots of the configured `next` project.
const FULL = "next/ kalfa/";
const filterOf = (need) => (need === "readers" ? readers.join(" ") : FULL);
// selectionOf: FULL -> "all"; readers.join(" ") -> "readers"; legacy "next/", missing, other -> "none".
// legs.ts: list(root, ["--project", "next", ...changed]); no positional "next/".
// legs.ts scope: FILTER === readers.join(" ") -> "readers"; anything else -> the full route.
// check.yaml fallbacks: 'next/ kalfa/' in the size step's FILTER and the next job's FILTER.
```

## One value traced

Amended: the value now runs from our pull request to main's full run.

1. Our ready pull request, layer 4, changes `check.yaml`, `related.ts`, `scheduled.yaml` and the
   rest of our 21 paths. Its base is 1583's branch. `changes.mjs` runs everything it does today
   for CI paths, and `related` is on.
2. `select` runs `related.ts`'s `run(step)`. The runner's `GITHUB_EVENT_NAME` is `pull_request`, so
   `projectsOf` lists tooling alone. Git's diff against 1583's head has no rerun trigger, so it
   lists tooling with `--changed`. `wantsConsumerLaw` sees `check.yaml`, so `confirmed` asks Vitest
   for P1 in tooling and adds it. `select()` places P1 on one tooling leg, say `2`, and prints
   `consumer="2"` beside the unchanged `run`, `legs`, `files` and `projects`. No `archive` line.
3. Leg 2 runs the tooling files as today, then `consumer fault`: P1 fails with the broken App
   export, the manifest's bytes come back with the same digest, and P1 passes again. `ci-required`
   reads every job as today. 1583 and our layer may now land together.
4. The merge reaches main at commit `M`. The push starts `scheduled.yaml`; the gate says
   `start=true`, since no full run started in the last hour. The `tests` matrix runs its nine legs.
5. `assign` put P2 on numbered leg `3`, say. Leg 3's `vitest` step runs P2 among its files: pnpm
   packs the package once, npm installs the archive in a temp project outside the workspace, Node
   imports all twelve subpaths, tsc checks them with `skipLibCheck: false`, and the four broken
   installed copies are each refused, restored and re-run green. P2 writes the archive and
   `receipt.json` under `$RUNNER_TEMP/kalfa-config-package`.
6. Leg 3's `package receipt` reads `refs/heads/main` and `push`, lists P2 alone in
   `next-integration`, finds P2 once in `results.json`, passed and unskipped, re-hashes the archive
   against the receipt's `sha256`, checks `source` and `requested` against `M`, and checks the folder
   holds those two files alone. It prints the digest and `kept=true`.
7. Legs 1, 2, 4 and 5 run the same step: each lists P2 alone in `next-integration`, finds no P2 in
   its report and no folder, and prints `kept=false`. Their `package archive` is skipped.
8. Leg 3's `package archive` uploads `kalfa-config-M-attempt-1` with the two files. The run ends
   green, and the report closes any open `ci-scheduled` issue.
9. Another project lists main's green `scheduled.yaml` runs, downloads `kalfa-config-*` from the
   newest run that holds one, checks the receipt's digest, and runs
   `npm install ./kalfa-config-0.0.0.tgz effect@4.1.3`.

Had P2 been renamed out of `next-integration`, every numbered leg's receipt would refuse
`discovery`: the first to fail would stop the others through fail-fast, and the report would open
the sev1 issue.

## Laws

Amended: D1 to D4 change, SC22 is new, D5 and O1 to O4 stand as approved. The new law was planned as SC21; ticket 1161 (#1623) took SC21 first, for the hand
start's inputs, so this plan's law is SC22.

Every existing law, domain, count, seed, timeout and assertion stays, except the D1 to D4 cases
the amendment table names, which are rewritten here. New property laws use the supported Schema
property runner with seed 119120, 100 runs and size 100, as the related tests do. They all run in
the `related` job's tooling legs on our ready pull request: each file changes, so `--changed`
picks it. None runs locally.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| D1, P1 is selected exactly when the package (built files aside) or its fault route (`related.ts`, check.yaml, the related guard) changed, or history is unreadable, or the run is full, and only after Vitest lists it in tooling; it sits on one tooling leg, named by `consumer`. P2 is never added by path, on any event, and on a pull request or a queue group no `next-integration` file is listed (1618's law stays). Package source is in `next` and not `next-integration`, `dist/` is in neither, P2 is in `next-integration` alone, P1 in tooling. A package path runs check and typecheck on every event, never today's build, and a package Markdown file is not skipped. Every other file keeps its leg and the nine-leg cap still throws. 100 runs | test | Effect Arbitrary: ChangedPaths | Put P2's add-by-path back on any event, drop a route path, drop the discovery confirmation, the `kalfa/` read tree, or let `consumer` name a leg of another project: a selection or flag assertion fails. | .github/ci/related-selection.test.ts |
| D2, on main's full run each numbered leg's receipt check says `kept` only for main's ref and a push, schedule or hand-start event, P2 listed alone in `next-integration`, the leg's report holding P2 once, passed and unskipped, and a folder of exactly the archive and receipt whose digest, source, requested head (both the run's commit), stages, refusals and export keys agree; `absent` only when the report holds no P2 and there is no folder; every other input is `refused` with its reason. 100 runs | test | Effect Arbitrary: LegDelivery | Accept a pull request or queue event, a branch ref, P2 missing from the listing, a folder on a leg whose report has no P2, P2 in the report with no folder, a digest mismatch, `source` or `requested` other than the run's commit, one stage failed, one refusal missing, a failed, skipped, todo or duplicated P2 result: the matching case is accepted and fails. | .github/ci/related-selection.test.ts |
| D3, the real `check.yaml` has one consumer fault step, in `related` alone, on the consumer leg, after `tooling`, with the tooling limit and `FABRIKA_TEST_DEPTH: full` alone, no token and no `continue-on-error`; it has no receipt step and no archive upload: R1's command list is install, integration, tooling, fault and time table, and Q1 is the parent's own upload rule. | test | scenario: each fault applied alone to the real check.yaml, with the existing related fault list kept | Put the old `package receipt` step or the old `package archive` upload back, run the fault on an unselected leg or before `tooling`, make it soft, give it a token or another env key: lintWorkflow accepts it and the case fails. | .github/ci/workflow-lint/related.test.ts |
| D4, `select` prints exactly the five outputs run, legs, files, projects and consumer, read from its `set` step, and `related` reads them only through `needs.select.outputs`. | test | scenario: one fault per output applied to the real check.yaml | Drop `consumer`, put `archive` back, read `consumer` from another step, or add a sixth output: the R1 case is accepted and fails. | .github/ci/workflow-lint/related.test.ts |
| D5, the fault mode proves P1 only when the faulted run fails for the export, the manifest's bytes are restored to the same digest, and the second run passes unskipped; outside CI it refuses. 100 runs | test | Effect Arbitrary: FaultRun | Accept a faulted run that passes, a failure for another reason, a restore with other bytes, or a second run that fails or skips: the matching case is accepted and fails. | .github/ci/related-selection.test.ts |
| SC22, the real `scheduled.yaml` keeps the archive in `tests` alone: one `package receipt` step right after `vitest`, on main's ref and the numbered legs, with `success()`, a one-minute limit, no env, no token and no `continue-on-error`; one `package archive` upload right after it, on main's ref and `kept == 'true'`, with `success()`, the two exact paths, `if-no-files-found: error`, a one-minute limit and a retention; no other step of any job runs the receipt, names the delivery folder or uploads a name starting `kalfa-config-`. SC9 lists the receipt beside the test job's commands and admits no other new command. | test | scenario: each fault applied alone to the real scheduled.yaml, with the existing plant list kept | The receipt on the e2e or tooling legs, on every ref, before `vitest`, soft, with a token or an env key; the upload without `kept`, without `success()`, on a branch ref, with a wildcard, a third path or the whole folder, `warn` or `ignore`, before the receipt; a second `kalfa-config-` upload in `changed` or `report`; a step that runs P2 alone with `vitest run`: lintScheduled accepts it and the case fails. | .github/ci/workflow-lint/scheduled.test.ts |
| O1, full and changed ordinary discovery follow project `next` with no `next/` restriction; Kalfa's three ordinary law files are in the set; readers and every file land once. 100 runs | test | Effect Arbitrary: OrdinarySelection | Restore the positional `next/` in `list`: the Kalfa laws are missing from the sized set. | .github/ci/legs.test.ts and .github/ci/related.test.ts |
| O2, the two-root fallback equals the configured `next` project; exact reader narrowing stays; bad filter input never narrows to readers; ordinary Kalfa files never join `related`. | test | scenario: real configured discovery, the canonical fallback, the reader-only and failed-sizing routes; an import-only stand-in cannot prove Vitest's CLI filter | Put `next/` back in either workflow fallback, or copy an ordinary Kalfa file into `related`: the universe or partition check fails. | .github/ci/legs.test.ts and .github/ci/related.test.ts |
| O3, the classifier's full scope prints `next/ kalfa/`; the record reads only that as `all` and refuses legacy `next/`, missing and malformed values; a same-program result never lowers a Kalfa change to reader-only coverage. Reuse of an exact tree and base still works. 100 runs | test | Effect Arbitrary: PrintedSelection | Decode legacy `next/` as `all`, record a ready run that printed it, or let the parser's pass prove a Kalfa path: the negative case fails. | .github/ci/changes.test.ts |
| O4, the sizing, next-job and merge-line guards accept the generated valid workflow and refuse a one-root fallback, a wrong precedence, a second narrowing, an extra project or env and every earlier fault. | test | scenario: each new fault alone on the generated valid workflow, with the full prior fault list kept | Allow the old spelling in `SIZE_ENV.FILTER`, the next-job fallback or `VITEST_VARS`: its isolated case is accepted and fails. | .github/ci/workflow-lint/changes.test.ts, .github/ci/workflow-lint/next-job.test.ts and .github/ci/workflow-lint/merge-line.test.ts |

Lint, type or test? Each law is a test. D3, D4, SC22 and O4 are checks on a workflow's shape, but
the workflow is YAML that oxlint does not read; the repo's YAML shape checks are `workflow-lint.ts`
rules, run by these tests and by `pnpm lint`. D1, D2, D5, O1 and O3 judge values. D2's law judges
the receipt's decisions on generated folders, reports and listings; the real receipt runs only on
main's full run, and a review may cite it only from that run's log. D5's law judges the fault
step's decisions on generated reports and bytes; the real red and green runs of P1 happen only in
the CI step itself.

No law here is host-only: P2 is an approved `.integration.` law on Linux CI, on main's full run
alone (0594, 0536, 0602), the fault step runs P1 on a CI tooling leg, and the guard tests read
files only.

## Files

Amended: three new paths, and new changes in seven rows. All 21 are CI selection, guards or their
tests, so the tests step owns them. Product lines: none. `scheduled.yaml`, the scheduled guard and
its test were outside the lane's original 18 paths; the lead has asked to widen the lane to them.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| .github/ci/related.ts | tests | tests | After the merge: `wantsConsumerLaw` and `ROUTE` (renamed, without the record guard), `confirmed` for P1 alone, the readers rule for `kalfa/`, P1's owning leg and the `consumer` output; no P2 by path and no `archive`. The `--receipt` mode for main's numbered legs (event, discovery, `absent`, `stray`, `kept=` to GITHUB_OUTPUT, the leg's `results.json`). The `--fault` mode unchanged. |
| .github/ci/related-selection.test.ts | tests | tests | D1 and D2 rewritten, D5 kept, every 1618 case kept; leave the slot assertion as 0598 left it. |
| .github/ci/related.test.ts | tests | tests | O1 and O2's real-discovery and partition proof; keep the existing universe and cases. |
| .github/workflows/check.yaml | tests | tests | The `consumer` output and the consumer fault step stay; `archive`, `id: integration`, `package receipt` and `package archive` leave; both `next/ kalfa/` fallbacks stay. Verify the Kalfa cache line is present once; never add it twice. |
| .github/workflows/scheduled.yaml | tests | tests | New: `package receipt` and `package archive` after `vitest` in `tests`; one line in the header comment's table. |
| .github/ci/workflow-lint/related.ts | tests | tests | `deliveryUpload` becomes a pin of the consumer fault step alone; `OUTPUTS` is five; R1's command list loses the receipt. |
| .github/ci/workflow-lint/related.test.ts | tests | tests | D3 and D4: the old receipt and archive shapes become plants, beside the existing fault list. |
| .github/ci/workflow-lint/record.ts | tests | tests | Back to its parent's bytes: no `deliveryUpload` import and no archive allowance. Its diff against 1583's branch is empty. |
| .github/ci/workflow-lint/scheduled.ts | tests | tests | New: SC22, and the receipt in SC9's command list. |
| .github/ci/workflow-lint/scheduled.test.ts | tests | tests | New: SC22's plants and SC9's narrowed-P2 plant in the plant list; the real-file and varied-file cases hold the two new steps. |
| .github/ci/changes.mjs | tests | tests | The `next/ kalfa/` full filter, strict decoding in `selectionOf`, and `kalfa/` in `readTrees`. |
| .github/ci/changes.test.ts | tests | tests | O3, the new full-filter strings, legacy refusal, the same-program case; keep the reuse cases. |
| .github/ci/legs.ts | tests | tests | No positional `next/` in ordinary discovery; exact reader decoding, else the full route. |
| .github/ci/legs.test.ts | tests | tests | O1 and O2 against real ordinary discovery and the sizing contract; the merge's import union. |
| .github/ci/workflow-lint/changes.ts | tests | tests | `SIZE_ENV.FILTER` expects the two-root fallback. |
| .github/ci/workflow-lint/changes.test.ts | tests | tests | O4's sizing faults; keep every earlier fault. |
| .github/ci/workflow-lint/next-job.ts | tests | tests | The next job's fallback expects `next/ kalfa/`. |
| .github/ci/workflow-lint/next-job.test.ts | tests | tests | O4's next-job faults; keep every earlier fault. |
| .github/ci/workflow-lint/merge-line.ts | tests | tests | `VITEST_VARS.FILTER` spelling only. |
| .github/ci/workflow-lint/merge-line.test.ts | tests | tests | O4's merge-line faults under the same whole-workflow path. |
| .github/ci/workflow-lint/wiring.test-support.ts | tests | tests | The generated valid workflow's sizing filter and `vitestFilter` use the two roots; no fault domain removed. |
| docs/plan/quests/kalfa-config-delivery-PLAN.md | lead | docs | Save this amended plan. |
| docs/plan/README.md | lead | docs | After merge: slice 2's delivery state, and that the archive comes from main's green `scheduled.yaml` run as `kalfa-config-<sha>-attempt-<n>`. |

The step uses the private routing packets and the unreviewed batch only as input. Each hunk is
re-made on the real stacked head, never copied by hash, and the packets stay unchanged, as the
routing amendment requires.

## Taken from the batch

Amended: since decision 0602, the items on P2's selection, `requested` against a pull request's
head, `id: integration` and the shared R1 and Q1 predicate no longer apply; the amendment section
says what replaces each. The rest stands.

The unreviewed batch is `origin/fabrikalfa/kalfa-delivery-v5` at `7a47aa224ad8`, sole parent
main `397e63f4`, 18 files, 1,207 lines added and 37 removed. `git diff 397e63f4 7a47aa224ad8 |
sha256sum` gives `51172302c10b79cdc4d8e88d878b33225cf81a77809e9f90e33bb7a65244dbd9`, which
starts with `51172302c10b` as stated. It is input: the tests step re-makes what is taken here.

- **Discovery confirmation before adding P2** (its `withConfig`), here `confirmed` for P2 and P1:
  Vitest itself proves the law is in the named project, so a rename or a wrong project fails
  the selector instead of running an empty path.
- **Readers on a `kalfa/` change:** a reader test reads the parser adapter's location under
  `kalfa/config/src` as text, so a package change must run the readers too.
- **`kalfa/` in `changes.mjs`'s `readTrees`:** the package README ships in the archive; without
  this a README-only change is safe Markdown and skips `related`, so P2 would not run.
- **P1 in the tooling selection on the same rule,** from its P4 case: the fault step needs P1
  selected, and our layer's diff does not reach P1 by import.
- **The receipt step reads P2's own report** (its `Results` schema): the receipt's strings are
  written by P2 whatever happened; only a passed, unskipped P2 result proves the refusals and the
  restored positive.
- **`requested` compared with the event's head,** and the event check in the script and in both
  steps' `if`: the receipt then binds both commits, and no other event can upload.
- **`id: integration` and the step-outcome conditions,** so the receipt and upload each follow the
  step they depend on.
- **The `sha` in the artifact name,** so a download names its commit.
- **One guard predicate shared by R1 and Q1** (its `configUpload`): the record guard permits the
  upload by calling the related guard's predicate, so the two cannot drift. The import goes after
  the file's header comment.
- **Its project-membership checks** (package source in `next`, not in `next-integration`, `dist/`
  in neither, P2 in `next-integration` alone) and its flag checks for package paths (check and
  typecheck on every event, never today's build), folded into D1.
- **Its fault lists** for D3 (event, draft, unselected leg, success, order, head, requested,
  paths, warn and ignore, soft steps, duplicate, other job, token) and O4, and its O3
  same-program case and O1/O2 real-discovery shape in `related.test.ts`: they match laws this plan
  already has, with more isolated cases.

The batch's `related-selection.test.ts` keeps every existing case: its only removed line is the
import of `related.ts`, which it widens. Its new cases cover selection and project membership,
the receipt check, and the `withConfig` errors, the three parts of the union. Its new P4 case
also asserts nine distinct slot groups; that one line is not taken (below).

## Not taken from the batch

- **Its `configPath` rule in `changes.mjs`,** with `changes.mjs`, two test files and P1's file
  as triggers and without the record guard: the lead fixed the route as `related.ts`,
  `check.yaml`, the related guard and the record guard. A test file does not change the route,
  and P1 is selected by the rule, not a trigger for it. The rule lives in `related.ts` beside
  `wantsChecklistLaw`'s shape.
- **Its `config` output, a map of leg to `true`:** a single leg name holds at most one owner by
  its type, and is compared with `matrix.shard` without `fromJSON`. Named `archive`, for what the
  leg delivers, since "config" already means the settings.
- **Its receipt step after `tooling`:** ours runs directly after `integration`, before
  `tooling` runs on the same runner, so it binds the folder and report P2 just wrote. The
  upload still waits for the whole leg.
- **Its folder check, which is absent:** ours also refuses an extra file in the delivery folder
  and export keys other than the twelve subpaths and the metadata subpath.
- **Its 7-day retention:** the archive is the deliverable another project downloads, so it
  keeps 90 days, as `related-set` and the checklist observations do.
- **Its artifact name without the attempt:** a rerun of a failed leg would meet the name the
  first attempt took; the attempt suffix is the timings uploads' existing answer.
- **Its slot assertion** (`new Set(Object.values(result.slots)).size` equal to 9) in the new P4
  case: 0598 changes the slot rules and that test's slot assertion; D1 asserts no slot.
- **Its `kalfa/*` tsc-cache line:** already on 1583's branch; adding it again would duplicate it.
- **No P1 fault step:** the batch has none, so D5 and the fault mode are this plan's own.

## Existing tools

Amended: the first, second and last two lines.

- `wantsConsumerLaw`, `ROUTE` and `confirmed` in `.github/ci/related.ts`: searched `related.ts`,
  `changes.mjs` and the batch. `wantsConsumerLaw` is the built `delivered`, renamed and narrowed;
  it follows `wantsChecklistLaw`'s shape, a sibling beside it. `confirmed` is the batch's
  `withConfig`, as built.
- The `--receipt` mode in `.github/ci/related.ts`: searched `proof.ts`, P2 itself, the batch's
  `checkedConfig`, Node's `node:crypto`, legs.ts's `list` and the built `checkDelivery`. It is the
  built `checkDelivery` with a new event clause, a discovery input read through legs.ts's `list`
  (the same call `confirmed` reads), and an `absent` verdict. No new file: a new script in the CI
  folder would be outside our 21 paths, and `related.ts` already holds the receipt's schemas,
  tests and review.
- The `--fault` mode in `.github/ci/related.ts`: as approved and built.
- The upload: `actions/upload-artifact@v7`, the action every other upload in `scheduled.yaml` uses.
- Guard cases: the existing `Fault` list and `lintWorkflow` in the related guard test, and the
  generated plants of `wiring.test-support.ts`. No new validator.
- SC22 in `.github/ci/workflow-lint/scheduled.ts`: searched the scheduled guard (SC9, SC10, SC17's
  `proof-set` upload rule), the related guard's built `deliveryUpload` and `time-tables.ts`'s
  `timed`. SC22 reuses `steps`, `uses`, `compact`, `map`, `ON_E2E` and the guard's own `ON_MAIN`,
  `ON_TOOLING` and `WHOLE_NEXT`, and follows SC10's "right after the tests" form and the built
  `deliveryUpload`'s exact-keys form. The scheduled guard test's `plants` list takes its cases.
- O1 to O4: `list`, `withReaders`, `filterOf`, `selectionOf`, `record` and `covers`, as the
  routing amendment lists. No new sharder, matcher or artifact store.

## Calls taken

Amended: the second and eighth calls are reworded for P1 alone, and the last eight are new.

- The lead answered the P1 fault question: add the fault step (D5), scoped to P1 alone. The lead's
  handoff checklist asks for P1's source fault and its restore proof in CI, and no existing
  eligible mechanism reaches P1, so recording it as unrun would leave that item open.
- Add P1 by path on a package or fault-route change, 85%. `--changed` cannot see that P1 reads the
  package by name, and our layer's diff holds only CI paths.
- Keep the receipt check in `related.ts`, 85%. One owned file, which already holds its schemas
  and tests; the step needs the job's install.
- Name the artifact `kalfa-config-<sha>-attempt-<n>`, 85%. The commit names what was tested; the
  attempt keeps a rerun from meeting the first attempt's name.
- The upload waits for the whole leg, 90%. An archive from a red leg is not a tested archive.
- The P1 fault step, 80%: the approved P1 row names this plant, and the lead's checklist asks
  for its CI proof; it is scoped to P1 alone (the lead approved it, above).
- `record.test.ts` stays unedited, 85% (see Scope).
- The lead answered the plan's two first questions. A and B2 are follow-up pull requests after this
  one; each comes back to the lead for a slot before it starts.
- Is this a setting? `retention-days: 90` is one, as `record.ts` already says (0069), and it
  matches the checklist observations. The archive name follows the package version. The route
  paths, the event clause and the P1 fault are code facts, not choices a person sets. No other
  new choice.
- **Amendment.** Keep on every main full run, the push, the hourly catch-up and a hand start on
  main, 85%. The gate starts each on a head that had no full run, except a hand start, so an
  archive is a head's first; keeping only on a push would leave the newest head unarchived after
  a burst of pushes. A hand start's second archive of one commit names the same source.
- **Amendment.** The receipt on every numbered leg, judged by the leg's own report, 85%. It is
  the only design of the four that loses nothing and fails loud (The shard problem); the doubt
  is the added seconds per leg, which the first main run measures.
- **Amendment.** Every leg proves P2's discovery, 80%. One leg cannot see the others, so only a
  per-leg discovery check turns a dropped P2 red; the cost is one `vitest list --filesOnly` of
  one file per leg, a few seconds.
- **Amendment.** The receipt reads the runner's `GITHUB_REF`, `GITHUB_EVENT_NAME` and
  `GITHUB_SHA`, and the step has no `env`, 85%, as 1618's select step reads the event: no
  workflow edit can point the check at another commit.
- **Amendment.** The consumer fault stays on the related job, 85%. P1 is a plain law, 0602 and
  0584 bind `.integration.` laws, and the fault is a step that runs a plain law twice, as the
  tooling step runs it once. It runs only when a change reaches P1 or its route.
- **Amendment.** `archive` leaves `select`'s outputs, 95%: no related leg keeps anything now.
- **Amendment.** The record guard returns to its parent's bytes, and leaves the route set, 90%:
  check.yaml uploads no archive, so Q1's own rule refuses one, and the file holds nothing of P1.
- **Amendment.** SC13's backstop stays at 3 minutes, 75% (Doubts).

## Speed item A: compute the related set in `changes`

Amended: since decision 0602 the related job runs plain tooling legs alone, at most two, and
`select` prints five outputs, not eight. A's sketch below predates both; A comes back to the lead
with a new plan, re-measured, before it starts.

A follow-up pull request after this one and after 0598's build lands, not a commit here, 80%
sure. 0598 drops `select`'s `concurrency` block, so wherever the sketch below says "control
group", A keeps exactly what `select` holds after 0598, and its laws pin that. CI proves only a pull
request's head, so a separate commit would never be proven on its own: the delivery's first run
and a moved selector would share one result, and a red P2 could not be told from a wiring
mistake. A edits the same `select` and guard code that D3 and D4 pin, so the two must land one
after the other in any case. The cost: about 1.4 minutes more per ready run until A lands.

Measured on run [44201566907](https://github.com/kamp-us/tea-fabrika/actions/runs/44201566907),
one run: `changes` ran 35 s; `select` waited 2 s and ran 96 s (checkout 69 s, pnpm 9 s, install
9 s, selector 3 s). `changes` already has `fetch-depth: 0`, `filter: blob:none` and, whenever
`next` runs, the same `pnpm install --frozen-lockfile --ignore-scripts`.

```yaml
# Sketch. changes gains the selector, under exactly the condition of its `related` output.
- name: related set
  id: related
  if: (github.event_name == 'merge_group' || (github.event_name == 'pull_request' && !github.event.pull_request.draft)) && steps.diff.outputs.check != 'false'
  timeout-minutes: 5
  env: { BASE: ..., HEAD: ${{ github.sha }}, RUN_NUMBER: ..., MOST_INTEGRATION: 5, MOST_TOOLING: 2,
         LIMIT_INTEGRATION: 17, LIMIT_TOOLING: 30, RECORD: ${{ runner.temp }}/related-set.json }
  run: node .github/ci/related.ts
# select keeps its name, needs, if, scheduled-control group and ten-minute limit.
# On a successful changes job it only relays; when changes failed it runs today's steps.
select:
  outputs:
    run: ${{ steps.set.outputs.run || needs.changes.outputs.related-run }}   # same for all eight
  steps:
    - if: needs.changes.result == 'success' && needs.changes.outputs.related-run != 'true' && needs.changes.outputs.related-run != 'false'
      run: exit 1                     # a successful changes job that printed no set fails select
    - if: needs.changes.result != 'success'   # today's checkout, install and `set` step, unchanged
```

- **Same set:** the same script, env and commit (`github.sha`), the same full history. `slots`
  depends on `RUN_NUMBER` alone, the same in every job of a run.
- **Same faults:** a selector error fails `changes`, whose stop step cancels the run, so
  `ci-required` is red, as a failing `select` makes it today. When `changes` itself fails, `select`
  runs today's steps, so that case keeps today's meaning exactly.
- **Same record:** the `related-set` artifact keeps its name, content and 90 days. It is uploaded
  by `changes` on the relayed path, and by `select` on the fallback path.
- **Cost:** `changes` gains about 3 s when `next` already installs, and about 18 s (pnpm and an
  install) when only `related` needs one. That delays `check`, `typecheck` and `next` by the same.
  `related` starts about 85 s sooner. `changes` keeps its 5-minute limit, against 12 s to 41 s
  measured in the seven runs read for this plan.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| A1, the selector runs once, in `changes`, after its install, under exactly `related`'s condition, with today's env, `fetch-depth: 0`, no `ref`, no token and no `continue-on-error`. | test | scenario: each fault alone on the real check.yaml | `fetch-depth: 1`, `continue-on-error: true`, HEAD set to the PR head, the draft clause dropped, or `MOST_TOOLING` changed: the guard accepts it and the case fails. | .github/ci/workflow-lint/related.test.ts |
| A2, `select` keeps its name, `needs`, `if`, control group and limit, and each of its eight outputs reads its own step first and the same-named `changes` output second; the relay fails on a missing set. | test | scenario: one fault per output and per guard step | Swap two relayed keys, drop the exit step, or drop the fallback steps: the case fails. | .github/ci/workflow-lint/related.test.ts |
| A3, Q1 allows `related-set` from `changes` or from `select`, once, with today's tuple, and the record's own upload rule keeps its count. | test | scenario: a second upload in changes, or a changed tuple | Upload a second artifact from `changes`, or change `related-set`'s retention: the case fails. | .github/ci/workflow-lint/related.test.ts |

Files for A: `check.yaml`, `workflow-lint/related.ts`, `workflow-lint/record.ts`,
`workflow-lint/changes.ts`, the related guard test and `wiring.test-support.ts`, all in the Files
table above. It must not change `required.mjs`, the `jobs.ts` guard or `ci-required`'s `needs`; A
keeps all three as they are. If any of them must change, A stops and names it as a blocker.

## Speed item B2: more tooling legs, measured first

Amended: since decision 0602 the merge line runs no integration leg, so B2's threshold below,
which compares a tooling leg with the longest integration leg, no longer applies. B2 comes back to
the lead with a new threshold before its measuring step starts.

A follow-up, in two steps. The first measures and decides; a second pull request comes only if
the threshold below is met. Not part of this pull request, 90% sure: there is not enough data.

B2 depends on 0598 landing first. 0598 removes the job-level slot groups these legs hold, so
the waits below may change on their own, and runs measured before 0598 lands do not count toward
the threshold. A split would touch only `MOST_TOOLING` and a new tooling budget in `select`'s
`set` env, and the R1 line that pins them (main lines 91 to 96), never the slot-rule lines 0598
writes.

The one complete run read for this plan (all seven related legs of run 44201566907):

| Leg | Project | Wait (s) | Run (s) |
|---|---|---|---|
| 7 | tooling | 2 | 620 |
| 6 | tooling | 447 | 623 |
| 1 to 5 | integration | 331, 2, 252, 70, 198 | 403, 570, 602, 495, 506 |

Each long wait ended within 2 to 7 seconds of one of the same run's `next` legs finishing (leg 6
began at 23:51:12, `next (e2e-2)` ended at 23:51:10). So those waits look like contention for the
shared scheduled-test groups, which `next`'s seven legs and `related`'s legs both hold, not a
shortage of tooling legs. That is another lane's subject. Tooling's longest run was 21 s longer
than integration's, so on this one run a third tooling leg would have saved about 20 s of run
time while taking one more shared group. Guess, under 50% sure: B2 alone does not give the
3 to 5 minutes; the measuring step settles it.

Measure: at least 10 complete ready-PR or queue runs with at least one tooling leg. For each leg,
from the jobs API: wait (`started_at` less `created_at`) and run (`completed_at` less
`started_at`), with its project from the run's `related-set` artifact. Queue wait and run time are
reported apart. GitHub keeps job times with the run, so nothing is lost by waiting; the 90-day
`related-set` artifacts are the part with a time limit.

Threshold, a call at 75%: propose a split only if, in at least 7 of the 10 runs, the related leg
that finishes last is a tooling leg that waited 60 s or less, and its run time exceeds the
longest integration leg's run time by at least 120 s. The 120 s is about what item A saves, so a
split must beat a change of its own size. The 60 s is far above the 2 s an idle group takes, so
it only excludes legs that were held by a queue. Below that line, B2 closes with the data written
up and no split.

If a split is proposed, its plan says so plainly: it runs up to two more legs at once, out of
the nine shared slots that remain after 0598 (integration 5 plus tooling up to 4, never more than
9, which `select()` already refuses). Raising `MOST_TOOLING` alone changes nothing, because `fewest` already fits two legs
under tooling's room of 829.8 s. The split needs a new per-leg budget for tooling, a setting
beside the next job's `BUDGET`, and never a lower `LIMIT_TOOLING`, which is also the step's
timeout. Its laws: R1 pins the new values and the unchanged 30-minute and 17-minute limits;
D1's generator checks every file still lands once at full depth; the nine-leg cap still throws.

## Validation

Amended: the steps after the merge, and what the lead reads on main after the landing.

The plan step read code, decisions, plans, the unreviewed batch and GitHub's run and job API. It
ran no test, install or compiler; it ran `plancheck.sh --draft` and `leakgrep.sh --text` on this
file, and one `git merge-tree` of our head with `7d38689ff`, which changes no file. All tests and
guards run only in the automatic `related` job on CI, on our ready pull request. P2, its refusals,
the receipt and the upload run only on main's full run after the landing.

Steps, in order: the lead merges `7d38689ff` by the merge rule; the tests step writes the amendment
on our branch; CI runs; a fresh review step reads the applied source at that real head, with the
run's results. After any later merge of 1583's branch that changes our 21 paths' lines, the same
reviewer rechecks the merge.

The lead reads, before the review: the run's `related-set` artifact (P1 on one tooling leg,
`consumer` set, no `archive`, no `next-integration` leg), the fault step's log (red, restored,
green), and that check.yaml's run uploaded no `kalfa-config-` artifact.

The lead reads, after the landing, on main's first full run: the numbered leg that kept (P2 in its
`results-next-<n>`, the receipt's printed digest, `kept=true`), the four `kept=false` lines, and the
downloaded artifact's two files. The lead installs the archive in a fresh folder outside the repo
once, under the usual caps, as the downstream sketch says. A red or refused run there is a sev1.

## Size

Amended: slice 1 grows by the move; A and B2 leave the estimate.

1. This pull request, delivery and ordinary routing, 1100 lines: about 170 of CI code as
   approved, then the amendment's `related.ts` about 60 changed, `check.yaml` about 20 removed,
   `scheduled.yaml` about 25 added, the related and record guards about 70 removed, the scheduled
   guard about 70 added, and about 450 of laws rewritten or added across the three test files.
2. Item A, its own pull request: about 250 lines, re-planned before it starts (see A).
3. Item B2, a measuring step and a write-up: 0 lines of code, re-planned before it starts.

The basis is the approved amendments' roughly $5 per step. This pull request has run seven steps
(three tests rounds and four reviews, `field/runs/2026-11-18-kalfa-config-delivery-*.json`). The
amendment adds a tests step, a fresh review, one likely fix round and its recheck. A and B2 each
come back with their own estimate. No paid service is added. About 3 agent hours for the
amendment, 75% sure; the doubt is how much of 1589's D1 and D2 cases port to 1618's `run(step)`
stand-in as they are.

Estimate: 11 steps, $55

## Records

Amended: where the archive's record now lives.

- Lost if not recorded now: which archive a later project installed, and from which commit.
  The receipt keeps the digest and the tested `source` (with `requested`, which must equal it on
  main), the artifact name carries the commit, and the receipt step prints the digest in the
  keeping leg's log. Main's run keeps the artifact 90 days; a project that needs it longer keeps
  its own copy with the receipt.
- The four `kept=false` lines record that every other numbered leg saw P2 in `next-integration`
  and kept nothing, in each leg's log.
- The `related-set` artifact already records base, head, changed paths and each leg's files; it
  now also shows `consumer`. For B2, the 90-day artifact is the fact with a time limit.
- The P1 fault step's log is its record: the faulted result, the restored digest and the second
  result. Nothing uploads it; the job log keeps it as long as the run.
- The lead's field rows record each step with its exact head, and keep "source ready", "CI
  running", "merged" and "kept on main" apart.

## What this cannot tell us

Amended: the first two sentences and the last three.

This plan proves no selection, guard, P2 run, receipt, P1 fault or upload. It cannot tell how
the merge of `7d38689ff` and later merges up the stack move the lines it expects. The four
refusals inside P2 prove the consumer sees four faults on installed copies; no plant on the
package's own source is run for P2. The batch was read as input and not run. B2's analysis
rests on one run, and the claim that its waits came from group contention is read from
timestamps, not from GitHub's queue. P2 has not run at the merged head: its last CI run is this
pull request's at `2aee1e4f2`, and its next is main's full run after the landing, where a break
shows as a sev1 instead of a held merge (0602). The receipt's added seconds per leg are a guess
until that run, and so is the claim that the backstop holds.

## Open questions

None.

## Findings

None.

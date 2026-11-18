Approved by the lead agent, builds 0585, 0590, 0594, 0595 and 0599 with the approved package and ordinary-routing amendments; body 0548c6b8ed3f
Plancheck-Version: 3

# Plan: CI delivers the tested @kalfa/config archive, then two CI speed items

Tracker ticket 1076, slice 2 delivery. Today's CI tooling, serving `next/` and `kalfa/`.
This builds the deferred CI rows of the approved package amendment
(`docs/plan/quests/kalfa-config-package-amendment-PLAN.md`, body `17f51b782370`: P4, Q1 and its
seven "Deferred" rows) and the thirteen private routing paths of the approved ordinary-routing
amendment (`docs/plan/quests/kalfa-config-package-ordinary-routing-amendment-PLAN.md`, body
`c4b73d23406a`: O1 to O4). It also plans the two CI speed items the lead asked for, A and B2,
which the lead has answered (see Calls taken).

Doubts first, because the owner is away:

- **P1's source fault needs a step CI does not have yet, 80% sure it is inside the approved
  plan.** The approved P1 row names its plant ("point the package App export at a missing
  module") and says plants run in CI "through the existing eligible mechanism". The only such
  mechanism today is the checklist fixture's, in a file we do not own. This plan adds one small
  fault step for P1 alone, in `related.ts` (answered under Calls taken).
- **B2 has one run of data, so B2 is a measuring step here, not a split.** See "B2".

```ts
// Sketch. The whole idea: one related leg owns P2, checks the receipt P2 wrote against P2's own
// passing result, and uploads exactly the archive and the receipt. One tooling leg owns P1 and
// proves its source fault and the restore. Nothing else changes about selection, depth or verdicts.
const PACKAGE = `${KALFA}/src/Package.integration.test.ts`; // KALFA = "kalfa/config", P2's file
selection.archive;  // "" or the one next-integration leg that holds PACKAGE
selection.consumer; // "" or the one tooling leg that holds P1
//   node .github/ci/related.ts --receipt   -> fails unless folder, report and receipt agree
//   upload-artifact: the two exact paths, if-no-files-found: error
//   node .github/ci/related.ts --fault     -> P1 red with the fault, bytes restored, P1 green
```

## Scope, base and what this plan takes on

This pull request is the fourth layer of native stack 1554: 1427, then 1525, then 1583, then
ours, kept current under decision 0599 (link the whole chain, keep children current by merging,
never rebase). Branch `fabrikalfa/kalfa-config-delivery` starts from 1583's branch,
`fabrikalfa/kalfa-config-package`, once the other lane has merged 1525's spacing commit and main
up into it. This plan was read against 1583's head `322e6c16f6466615ab0b041f47d08bd4f28bd280`,
against `origin/main` at `397e63f4` (PR 1581) and against `a6761bce` at the time of this amendment.

The sequence, as the lead ruled:

1. **1427 and 1525 land first.** 1525 turns `require-readable-spacing` on as an error over the CI
   folder; its autofix of the files 1581 added is one mechanical commit inside 1525, owned by
   another lane. Our edits go on top of it. No step of ours reformats those files; `pnpm format`
   touches only lines we wrote.
2. **Decision 0598's build lands first on the shared lines.** It takes the first turn on
   `check.yaml`, `related.ts` and the related guard: the job-level `concurrency` of `next`,
   `select` and `related`; the slot rules in the related and merge-line guards; `related.ts`'s
   import and use of `proof.ts`'s `slots`; and the nine-group assertion in
   `related-selection.test.ts`. When it lands on main, the other lane merges main up through
   layers 1 to 3, and we then merge 1583's branch into ours: one plain merge, no rebase. Our edits
   apply to those lines as they are then; the line numbers below are from before it.
3. **1583 and our layer land together,** once our package receipt is green on the merged head.
   The package's CI proof must run before 1583 may land, and our layer is what runs it.
4. **We never write to layers 1 to 3.** A change any of them needs is the other lane's, named to
   the lead.

P2's first CI run is ours, on the stacked head. Our pull request's base is 1583's branch, so
its diff holds only our 18 CI paths: no rerun trigger, and `--changed` reaches no package law.
P2 and P1 run because this plan selects them on a change to the delivery route (D1). Without that
rule, our run would never run P2, and 1583 could not land.

The lane owns exactly 18 paths: the 13 ordinary-routing paths plus the 7 delivery paths, two of
which (`changes.mjs`, `check.yaml`) are in both lists. They are the Files table below.

What this plan takes on, for the lead's handoff checklist:

| Item | Ours? | Why |
|---|---|---|
| The seven routing and upload paths (P4, Q1) | yes | All seven are among our 18. |
| The thirteen ordinary-routing paths (O1 to O4) | yes | All thirteen are among our 18. |
| P2's runtime proof: its strict declaration check, its installed-copy refusals and the restored positive, then the upload of the exact tested archive and receipt | yes | P2 runs them inside one test; our receipt step uploads only after P2's own passing, unskipped result (D2, D3). |
| P1's source fault and its restore proof | yes | The new fault step (D5), on the tooling leg that owns P1. |
| A fresh review of the applied delivery source at the real package head | yes | The review step runs at our head after the last merge of 1583's branch, not at a head before 0598 (Validation). |
| Decision 0599's upkeep | yes | One plain merge of 1583's branch per parent move; no rebase, no force-push, no write to layers 1 to 3. |
| 1583's own whole-diff review | no | It reviews 1583's diff. Our review reads our diff. |
| A, B2 | planned here | Follow-up pull requests, each with its own laws (see below). |

One correction to the brief's list: it names `record`'s test too, which would make 19 paths. The
approved Q1 row puts Q1's new negative cases in the related guard test, "no new test file", and
the 13 plus 7 lists do not include `record.test.ts`. This plan does not edit `record.test.ts`. If
its existing cases go red because the generated valid workflow changes, that is a blocker for the
lead, not a row here.

Routing paths outside our 18 that the work needs: none found. The pieces outside it that the
work reads and does not change are `proof.ts` (`slots`, `legsOf`, `whole`), `plant-related.ts`
(`wanted`, `fixture`), `required.mjs` and the `jobs.ts` guard (both pin `select`'s name, `needs` and
`if`, which this plan keeps), `scheduled.yaml` (already lists projects without a path, so it runs
Kalfa), the shard-rows guard, the timing tables and every slot-concurrency map. If any of these
must change, the step stops and names it to the lead as a blocker.

## Where our edits meet decision 0598's build

Decision 0598 ([PR 1586](https://github.com/kamp-us/tea-fabrika/pull/1586)) is built by another
lane. It drops the job-level `concurrency` blocks of `next`, `select` and `related` (the run's
`check-<pr>` group stays) and changes the slot rules in the related and merge-line guards. This
pull request changes none of those blocks and none of those rules.

1583's head has no `select` or `related` job yet (it predates 1581), so those lines are given on
`origin/main` at `397e63f4`, where our branch will start; the others on 1583's head.

| check.yaml job and step | Line now | Our edit | Next to a 0598 line? |
|---|---|---|---|
| `changes`, step `size`, env `FILTER` | 200 on 1583 (201 on main) | `'next/'` fallback becomes `'next/ kalfa/'` | no |
| `next`, the vitest `run` step, env `FILTER` | 472 on 1583 (464 on main) | same fallback change | no; `next`'s `concurrency` block is at main 419 to 422, 42 lines above |
| `select`, `outputs` | main 538 to 544 | add `archive` and `consumer` after `plants` (544) | yes: the block 0598 drops ends at 533, five lines above |
| `related`, after step `integration` | main 597 to 603 | `id: integration`; new step `package receipt` | no; `related`'s `concurrency` block is at 576 to 579 |
| `related`, after step `checklist faults` and `tooling` | main 604 to 619 | new steps `consumer fault` and `package archive` before `results` (620) | no |

Guard code, on main:

- `workflow-lint/related.ts`: our edits are in `selector()`'s output list (line 56), the command
  list R1 holds (lines 122 to 129), and a new receipt and upload rule after line 168. Line 56 sits
  four lines below `held(job)` and the `scheduled-control` check (51 and 52), which 0598 changes.
  The slot rules (`lookup`, `held`, `mapped`, lines 17 to 39, and the checks at 106 and 170 to
  180) are untouched.
- `workflow-lint/merge-line.ts`: one line, the `FILTER` spelling at line 30. No slot rule.

Order: 0598's build lands first (sequence step 2); the other lane merges main up the stack and we
merge 1583's branch, then re-read these lines. Only the `select` outputs hunk and the `selector()` hunk sit next to its edits, and neither
changes what it changes. D1 keeps whatever slot assertion 0598 leaves in
`related-selection.test.ts`; our tests step does not touch it. Item A rewrites
`select` and must start after 0598 lands. Item B2 is about shared slot use, so it waits for 0598
too (see each item).

## How others do it

- **Vitest's own selection.** `vitest list --changed <base>` follows imports, and
  `forceRerunTriggers` makes listed files run everything ([CLI](https://vitest.dev/guide/cli.html#changed),
  [config](https://vitest.dev/config/forcereruntriggers), read in Vitest 5.0.5's installed
  `cli-api` chunk by `proof.ts`'s comment). A test that reads files without importing them is
  invisible to `--changed`; decision 0590 item 4 and `changes.mjs`'s `readers` add such tests by
  path. P2 is that kind: it imports nothing from the package, it builds and packs it. So P2 is
  added by path, the way `related.ts` already adds the checklist fixture through
  `plant-related.ts`'s `wanted`.
- **npm's tarball install.** `npm install <file>.tgz` installs a packed archive like a registry
  version; `pnpm pack` substitutes `publishConfig.exports` (the approved amendment and
  experiment 108 cite this path).
- **GitHub Actions.** Job outputs pass values to later jobs through `needs.<job>.outputs`; an
  artifact is the run's kept file. Not fetched for this plan: the exact rule for
  `if-no-files-found` when one of several paths is missing in `actions/upload-artifact@v7`. The
  design does not depend on it, because the receipt step checks both files before the upload.
- **Elm and OTP** add no machine here. This is a CI filter, a check and an upload.

## The shape

### Selection (P4)

```ts
// Sketch of .github/ci/related.ts: same select(), same nine-leg cap, two more outputs.
const KALFA = "kalfa/config";
const PACKAGE = `${KALFA}/src/Package.integration.test.ts`;
const CONSUMER = "scripts/" + "kalfa-config.test.ts"; // P1, a tooling law

/** The paths whose change must run P1 and P2: the package, and the route that keeps its archive. */
const DELIVERY = new Set([
  ".github/ci/related.ts",
  ".github/workflows/check.yaml",
  ".github/ci/workflow-lint/related.ts",
  ".github/ci/workflow-lint/record.ts",
]);

export const delivered = (paths: readonly string[] | null): boolean =>
  paths === null ||
  paths.some((path) => (path.startsWith(`${KALFA}/`) && !path.includes("/dist/")) || DELIVERY.has(path));

/** Add a law only after Vitest lists it in the named project; anything else throws. */
export const confirmed = (selected: readonly string[], listed: readonly string[], file: string, needed: boolean) => {
  if (needed && (listed.length !== 1 || listed[0] !== file)) {
    throw new Error(`related: ${file} must be discovered in its existing project`);
  }
  return withReaders(selected, needed ? listed : []);
};

// In main, with need = full || delivered(changed):
//   readers: added when a changed path starts with "next/" or "kalfa/" (a reader test reads
//            the parser adapter's location under kalfa/config/src)
//   files["next-integration"] = confirmed(withReaders(...as today...),
//            list(root, ["--project", "next-integration", PACKAGE]), PACKAGE, need)
//   files.tooling = confirmed(list(... as today ...), list(root, ["--project", "tooling", CONSUMER]),
//            CONSUMER, need)
// In select(): PACKAGE on exactly one next-integration leg, CONSUMER on exactly one tooling leg;
//   any other placement throws. outputs() gains `archive=<leg or "">` and `consumer=<leg or "">`.
```

The selected set only grows: a file is added, never removed. A full run (rerun trigger or
unreadable history) already lists both laws through their projects. `withReaders` keeps each
file once.

`changes.mjs` gains `kalfa/` in its `readTrees`, so a Markdown change in the package (its README
ships inside the archive) runs the heavy jobs instead of being skipped as safe Markdown.

### Receipt check (Q1, before the upload)

```ts
// Sketch of the --receipt mode of .github/ci/related.ts: Effect Schema, node:crypto's createHash.
const Receipt = Schema.Struct({
  source: Sha,               // must equal HEAD, github.sha, the commit the leg checked out
  requested: Sha,            // must equal REQUESTED, the PR or queue head; kept apart from source
  archive: Schema.Literal("kalfa-config-0.0.0.tgz"),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  versions: Schema.Struct({ node: Schema.String, pnpm: Schema.String, npm: Schema.String, compiler: Schema.String }),
  exports: Schema.Record(Schema.String, Schema.Unknown), // its keys: the 12 subpaths and the metadata subpath
  stages: Schema.Struct({ build: Passed, pack: Passed, install: Passed, runtime: Passed,
                          imports: Passed, private: Passed, types: Passed }),
  negatives: Schema.Struct({ source: Refused, parser: Refused, declarations: Refused, workspace: Refused }),
});

// The integration step's own Vitest JSON report, $RUNNER_TEMP/related.json.
const Report = Schema.Struct({
  success: Schema.Literal(true),
  numFailedTests: Schema.Literal(0),
  numFailedTestSuites: Schema.Literal(0),
  testResults: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String,
    assertionResults: Schema.Array(Schema.Struct({ status: Schema.String })) })),
});

type Delivery =
  | { readonly _tag: "kept"; readonly sha256: string; readonly source: string }
  | { readonly _tag: "refused"; readonly reason:
        "event" | "missing" | "extra" | "unreadable" | "digest" | "source" | "requested"
        | "stage" | "exports" | "result" };
// The folder ${RUNNER_TEMP}/kalfa-config-package holds exactly the archive and receipt.json.
// The report holds P2 once, passed, with at least one assertion and none skipped, todo or failed.
// EVENT and DRAFT must be a ready pull request or a merge group.
// "kept" exits 0 and prints the digest; "refused" exits 1 with its reason.
```

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

### Workflow (check.yaml, related job)

```yaml
# Sketch. Directly after `integration` (which gains `id: integration`), on the leg that owns P2:
- name: package receipt
  id: receipt
  if: success() && (github.event_name == 'merge_group' || (github.event_name == 'pull_request' && !github.event.pull_request.draft)) && needs.select.outputs.archive == matrix.shard && steps.integration.outcome == 'success'
  env:
    EVENT: ${{ github.event_name }}
    DRAFT: ${{ github.event.pull_request.draft }}
    HEAD: ${{ github.sha }}
    REQUESTED: ${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}
  run: node .github/ci/related.ts --receipt
# ... checklist faults and tooling, as today ...
# After `tooling`, on the leg that owns P1:
- name: consumer fault
  if: success() && needs.select.outputs.consumer == matrix.shard
  timeout-minutes: *related-tooling-limit
  env:
    FABRIKA_TEST_DEPTH: full
  run: node .github/ci/related.ts --fault
# Then, before `results`, on the leg that owns P2:
- name: package archive
  if: success() && (github.event_name == 'merge_group' || (github.event_name == 'pull_request' && !github.event.pull_request.draft)) && needs.select.outputs.archive == matrix.shard && steps.receipt.outcome == 'success'
  uses: actions/upload-artifact@v7
  with:
    name: kalfa-config-${{ github.sha }}-attempt-${{ github.run_attempt }}
    path: |
      ${{ runner.temp }}/kalfa-config-package/kalfa-config-0.0.0.tgz
      ${{ runner.temp }}/kalfa-config-package/receipt.json
    if-no-files-found: error
    retention-days: 90
```

`select` gains the outputs `archive` and `consumer`, each `${{ steps.set.outputs.<name> }}`. The
receipt step runs right after `integration`, before the checklist faults, so it binds the folder
and report P2 just wrote. The upload waits until every test step of the leg passed. `related`
still runs only after a successful `select` on a ready pull request or a queue group; the event
clause is repeated on both delivery steps and in the script, so a change elsewhere cannot widen
it to another event.

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

1. Our ready pull request, layer 4, changes `check.yaml` and `related.ts` (and the rest of our
   18). Its base is 1583's branch. `changes.mjs` runs everything it does today for CI paths, and
   `related` is on.
2. `select` runs `related.ts`. Git's diff against 1583's head has no rerun trigger, so it lists
   `next-integration` and `tooling` with `--changed`. Neither list holds P2 or P1: no changed file
   is imported by them. `delivered` sees `check.yaml`, so `confirmed` asks Vitest for each law in
   its own project and adds them. `select()` places P2 on one integration leg, say `2`, and P1 on
   one tooling leg, say `6`, and prints `archive="2"` and `consumer="6"` beside the unchanged
   `legs`, `files`, `projects`, `slots` and `plants`.
3. Leg 2's `integration` step runs P2: pnpm packs the package once, npm installs the archive in a
   temp project outside the workspace, Node imports all twelve subpaths, tsc checks them with
   `skipLibCheck: false`, and the four broken installed copies are each refused, restored and
   re-run green. P2 writes the archive and `receipt.json`.
4. `package receipt` checks the event, re-hashes the archive against the receipt's `sha256`,
   checks `source` against `github.sha` and `requested` against the PR head, checks that the
   folder holds those two files alone, and that the report shows P2 once, passed and unskipped.
   It prints the digest.
5. Leg 6 runs the tooling files as today, then `consumer fault`: P1 fails with the broken App
   export, the manifest's bytes come back with the same digest, and P1 passes again.
6. The rest of leg 2 passes, so `package archive` uploads `kalfa-config-<sha>-attempt-1` with the
   two files. `ci-required` reads every job as today. 1583 and our layer may now land together.
7. Another project runs `gh run download <run> -n kalfa-config-<sha>-attempt-1`, checks the
   receipt's digest, and runs `npm install ./kalfa-config-0.0.0.tgz effect@4.1.3`.

## Laws

Every existing law, domain, count, seed, timeout and assertion stays. New property laws use the
supported Schema property runner with seed 119120, 100 runs and size 100, as the related tests do.
They all run in the `related` job's tooling legs on our ready pull request: each file changes, so
`--changed` picks it. None runs locally.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| D1, P2 and P1 are selected exactly when the package or its delivery route changed, or history is unreadable, or the run is full, and only after Vitest lists each in its own project. P2 sits on one `next-integration` leg and P1 on one tooling leg, named by `archive` and `consumer`. Package source is in `next` and not `next-integration`, `dist/` is in neither, P2 is in `next-integration` alone, P1 in tooling. A package path runs check and typecheck on every event, never today's build, and a package Markdown file is not skipped. Every other file keeps its leg and the nine-leg cap still throws. 100 runs | test | Effect Arbitrary: ChangedPaths | Drop the `kalfa/config/` rule, a route path, the discovery confirmation, the `kalfa/` read tree, or let `archive` name a tooling leg: a selection or flag assertion fails. | .github/ci/related-selection.test.ts |
| D2, the receipt check keeps only a ready or queue event, a folder of exactly the archive and receipt, a receipt whose digest, source, requested head, stages, refusals and export keys agree, and a report with P2 once, passed and unskipped. 100 runs | test | Effect Arbitrary: DeliveryFolder | Accept a digest mismatch, a missing receipt, an extra file, `source` or `requested` swapped, one stage failed, one refusal missing, a push event, a failed, skipped, todo or duplicated P2 result: the matching case is accepted and fails. | .github/ci/related-selection.test.ts |
| D3, the real `check.yaml` has one receipt step, one fault step and one archive upload, in `related` alone, on the owning legs, in that order, with the exact env, the event clause, the two exact paths and `if-no-files-found: error`, no token and no `continue-on-error`. Q1 permits this upload tuple and no other new upload. | test | scenario: each fault applied alone to the real check.yaml, with the existing related fault list kept | A wildcard path, a third path, the whole folder, the upload in another job, an `if` without `success()` or without the event clause, the receipt or upload on an unselected leg, `if-no-files-found: warn` or `ignore`, a soft step, the upload before the receipt, a swapped HEAD or REQUESTED, a second upload, or a token: lintWorkflow accepts it and the case fails. | .github/ci/workflow-lint/related.test.ts |
| D4, `select` prints exactly the eight outputs, `archive` and `consumer` included, read from its `set` step, and `related` reads them only through `needs.select.outputs`. | test | scenario: one fault per output applied to the real check.yaml | Drop `archive` or `consumer`, read one from another step, or add a ninth output: the R1 case is accepted and fails. | .github/ci/workflow-lint/related.test.ts |
| D5, the fault mode proves P1 only when the faulted run fails for the export, the manifest's bytes are restored to the same digest, and the second run passes unskipped; outside CI it refuses. 100 runs | test | Effect Arbitrary: FaultRun | Accept a faulted run that passes, a failure for another reason, a restore with other bytes, or a second run that fails or skips: the matching case is accepted and fails. | .github/ci/related-selection.test.ts |
| O1, full and changed ordinary discovery follow project `next` with no `next/` restriction; Kalfa's three ordinary law files are in the set; readers and every file land once. 100 runs | test | Effect Arbitrary: OrdinarySelection | Restore the positional `next/` in `list`: the Kalfa laws are missing from the sized set. | .github/ci/legs.test.ts and .github/ci/related.test.ts |
| O2, the two-root fallback equals the configured `next` project; exact reader narrowing stays; bad filter input never narrows to readers; ordinary Kalfa files never join `related`. | test | scenario: real configured discovery, the canonical fallback, the reader-only and failed-sizing routes; an import-only stand-in cannot prove Vitest's CLI filter | Put `next/` back in either workflow fallback, or copy an ordinary Kalfa file into `related`: the universe or partition check fails. | .github/ci/legs.test.ts and .github/ci/related.test.ts |
| O3, the classifier's full scope prints `next/ kalfa/`; the record reads only that as `all` and refuses legacy `next/`, missing and malformed values; a same-program result never lowers a Kalfa change to reader-only coverage. Reuse of an exact tree and base still works. 100 runs | test | Effect Arbitrary: PrintedSelection | Decode legacy `next/` as `all`, record a ready run that printed it, or let the parser's pass prove a Kalfa path: the negative case fails. | .github/ci/changes.test.ts |
| O4, the sizing, next-job and merge-line guards accept the generated valid workflow and refuse a one-root fallback, a wrong precedence, a second narrowing, an extra project or env and every earlier fault. | test | scenario: each new fault alone on the generated valid workflow, with the full prior fault list kept | Allow the old spelling in `SIZE_ENV.FILTER`, the next-job fallback or `VITEST_VARS`: its isolated case is accepted and fails. | .github/ci/workflow-lint/changes.test.ts, .github/ci/workflow-lint/next-job.test.ts and .github/ci/workflow-lint/merge-line.test.ts |

Lint, type or test? Each law is a test. D3, D4 and O4 are checks on the workflow's shape, but
the workflow is YAML that oxlint does not read; the repo's YAML shape checks are
`workflow-lint.ts` rules, run by these tests and by `pnpm lint`. D1, D2, D5, O1 and O3 judge
values. D5's law judges the fault step's decisions on generated reports and bytes; the real red
and green runs of P1 happen only in the CI step itself, and a review may cite them only from that
run's log.

No law here is host-only: P2 is an approved `.integration.` law on Linux CI (0594, 0536), the
fault step runs P1 on a CI tooling leg, and the guard tests read files only.

## Files

All 18 are CI selection, guards or their tests, so the tests step owns them. Product lines: none.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| .github/ci/related.ts | tests | tests | `delivered`, `confirmed`, the readers rule for `kalfa/`, the two owning legs and outputs, the `--receipt` check and the `--fault` mode. |
| .github/ci/related-selection.test.ts | tests | tests | D1, D2 and D5; keep every existing case and leave the slot assertion to 0598. |
| .github/ci/related.test.ts | tests | tests | O1 and O2's real-discovery and partition proof; keep the existing universe and cases. |
| .github/workflows/check.yaml | tests | tests | `archive` and `consumer` outputs, `id: integration`, the receipt, fault and upload steps; both `next/ kalfa/` fallbacks. Verify the Kalfa cache line is present once; never add it twice. |
| .github/ci/workflow-lint/related.ts | tests | tests | R1 pins the three new steps, the two outputs and the command list, in one predicate the record guard reuses. |
| .github/ci/workflow-lint/related.test.ts | tests | tests | D3, D4 and Q1's negative cases, beside the existing fault list. |
| .github/ci/workflow-lint/record.ts | tests | tests | Q1 permits the one exact archive upload through the related guard's predicate; every other upload rule stays. |
| .github/ci/changes.mjs | tests | tests | The `next/ kalfa/` full filter, strict decoding in `selectionOf`, and `kalfa/` in `readTrees`. |
| .github/ci/changes.test.ts | tests | tests | O3, the new full-filter strings, legacy refusal, the same-program case; keep the reuse cases. |
| .github/ci/legs.ts | tests | tests | No positional `next/` in ordinary discovery; exact reader decoding, else the full route. |
| .github/ci/legs.test.ts | tests | tests | O1 and O2 against real ordinary discovery and the sizing contract. |
| .github/ci/workflow-lint/changes.ts | tests | tests | `SIZE_ENV.FILTER` expects the two-root fallback. |
| .github/ci/workflow-lint/changes.test.ts | tests | tests | O4's sizing faults; keep every earlier fault. |
| .github/ci/workflow-lint/next-job.ts | tests | tests | The next job's fallback expects `next/ kalfa/`. |
| .github/ci/workflow-lint/next-job.test.ts | tests | tests | O4's next-job faults; keep every earlier fault. |
| .github/ci/workflow-lint/merge-line.ts | tests | tests | `VITEST_VARS.FILTER` spelling only. |
| .github/ci/workflow-lint/merge-line.test.ts | tests | tests | O4's merge-line faults under the same whole-workflow path. |
| .github/ci/workflow-lint/wiring.test-support.ts | tests | tests | The generated valid workflow's sizing filter and `vitestFilter` use the two roots; no fault domain removed. |
| docs/plan/quests/kalfa-config-delivery-PLAN.md | lead | docs | Save this plan. |
| docs/plan/README.md | lead | docs | After merge: slice 2's delivery state and where the archive comes from. |

The step uses the private routing packets and the unreviewed batch only as input. Each hunk is
re-made on the real stacked head (1581, 1525's spacing commit, 0598, 1583), never copied by
hash, and the packets stay unchanged, as the routing amendment requires.

## Taken from the batch

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
  `wanted`'s shape.
- **Its `config` output, a map of leg to `true`:** a single leg name holds at most one owner by
  its type, and is compared with `matrix.shard` without `fromJSON`. Named `archive`, for what the
  leg delivers, since "config" already means the settings.
- **Its receipt step after `tooling`:** ours runs directly after `integration`, before the
  checklist faults run on the same runner, so it binds the folder and report P2 just wrote. The
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

- `delivered` and `confirmed` in `.github/ci/related.ts`: searched `related.ts`,
  `plant-related.ts`, `changes.mjs` and the batch. They follow `plant-related.ts`'s `wanted`,
  `changes.mjs`'s `readers` and the batch's `withConfig`. `wanted` is for the checklist fixture and
  lives in a file we do not own, so a sibling in `related.ts` fits.
- The `--receipt` mode in `.github/ci/related.ts`: searched `proof.ts`, `plant-related.ts`
  (which hashes with Effect's `Digest` and reads the same `related.json` report), P2 itself, the
  batch's `checkedConfig` and Node's `node:crypto`. Uses Effect Schema to decode and
  `createHash("sha256")` to hash. No new file: a new script in the CI folder would be outside our
  18 paths, and `related.ts` already owns the related job's other node step.
- The `--fault` mode in `.github/ci/related.ts`: searched `plant-related.ts` and `plant.ts` (the
  checklist fixture's fault runner, scoped to that fixture and its catalog) and the batch (none).
  It reuses the shape of `plant-related.ts`'s CI-only environment check and its JSON-report
  reading, and Effect's `ChildProcess` and scoped finalizers, as P2 does, for the restore.
- The upload: `actions/upload-artifact@v7`, the action every other upload in `check.yaml` uses.
- Guard cases: the existing `Fault` list and `lintWorkflow` in the related guard test, and the
  generated plants of `wiring.test-support.ts`. No new validator.
- O1 to O4: `list`, `withReaders`, `filterOf`, `selectionOf`, `record` and `covers`, as the
  routing amendment lists. No new sharder, matcher or artifact store.

## Calls taken

- The lead answered the P1 fault question: add the fault step (D5), scoped to P1 alone. The lead's
  handoff checklist asks for P1's source fault and its restore proof in CI, and no existing
  eligible mechanism reaches P1, so recording it as unrun would leave that item open.
- Add P2 and P1 by path on a package or delivery-route change, 85%. P4 asks that the package's
  changed paths select P2, and `--changed` cannot see it. The route paths are what make our
  layer run them at all, since our diff holds only CI paths.
- Keep the receipt check in `related.ts`, 85%. One owned file; the step needs the job's install.
- Name the artifact `kalfa-config-<sha>-attempt-<n>`, 85%. The commit names what was tested; the
  attempt keeps a rerun from meeting the first attempt's name.
- The upload waits for the whole leg, 90%. An archive from a red leg is not a tested archive.
- The P1 fault step, 80%: the approved P1 row names this plant, and the lead's checklist asks
  for its CI proof; it is scoped to P1 alone (the lead approved it, above).
- `record.test.ts` stays unedited, 85% (see Scope).
- The lead answered the plan's two first questions. A and B2 are follow-up pull requests after this
  one and after 0598's build lands; B2 measures first with the 7-of-10 rule; each comes back to
  the lead for a slot before it starts. P2 is also selected when the delivery route changes
  (`related.ts`, `check.yaml`, the related guard, the record guard): it selects more tests and
  loosens nothing.
- Is this a setting? `retention-days: 90` is one, as `record.ts` already says (0069), and it
  matches the checklist observations. The archive name follows the package version. The route
  paths and the P1 fault are code facts, not choices a person sets. No other new choice.

## Speed item A: compute the related set in `changes`

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

The plan step read code, decisions, plans, the unreviewed batch and GitHub's run and job API. It
ran no test, install or compiler; it ran `plancheck.sh --draft` and `leakgrep.sh --text` on this
file. All tests, guards, P2 and its refusals, and the P1 fault run only in the automatic
`related` job on CI, on our ready pull request at the stacked head.

Steps, in order: the tests step writes the 18 paths on our branch after the last merge of 1583's
branch; CI runs; a fresh review step reads the applied delivery source at that real head, with
the run's results, never a head from before 0598 or before 1583's last merge. After any later
merge of 1583's branch that changes our 18 paths' lines, the same reviewer rechecks the merge.

The lead reads, before the review: the run's `related-set` artifact (P2 on one integration leg,
P1 on one tooling leg, `archive` and `consumer` set), P2's result in the owning leg's
`results-related-<n>`, the receipt step's printed digest, the fault step's log (red, restored,
green), and the downloaded artifact's two files. The lead installs the archive in a fresh
folder outside the repo once, under the usual caps, as the report's install command.

## Size

1. This pull request, delivery and ordinary routing: about 170 lines of CI code (`related.ts` 120,
   `changes.mjs` 10, `legs.ts` 10, `check.yaml` 30), about 110 lines of guard code and about 550
   lines of laws: 830 lines.
2. Item A, its own pull request: about 40 lines of workflow, 60 of guard code, 150 of laws: 250
   lines.
3. Item B2, a measuring step and a write-up: 0 lines of code. A split, if the threshold is met,
   gets its own plan.

About 5 agent hours in all, 75% sure; the doubt is how much the base commits (1525's spacing,
0598, 1583's merges) move the lines this plan expects. The basis is the approved amendments'
roughly $5 per step. This pull request: tests, the fresh review at the real head, one likely
fix round and its recheck. Item A: tests, review and one fix round. B2: one measuring step. No
paid service is added.

Estimate: 8 steps, $40

## Records

- Lost if not recorded now: which archive a later project installed, and from which commit.
  The receipt keeps the digest, the tested `source` and the `requested` head apart, the artifact
  name carries the commit, and the receipt step prints the digest in the leg's log.
- The `related-set` artifact already records base, head, changed paths and each leg's files; it
  now also shows `archive` and `consumer`. For B2, the 90-day artifact is the fact with a time
  limit.
- The P1 fault step's log is its record: the faulted result, the restored digest and the second
  result. Nothing uploads it; the job log keeps it as long as the run.
- The lead's field rows record each step with its exact head, and keep "source ready", "CI
  running" and "merged" apart.

## What this cannot tell us

This plan proves no selection, guard, P2 run, receipt, P1 fault or upload. It cannot tell how
1525's spacing commit, 0598's build or the merges up the stack change the lines it expects. The
four refusals inside P2 prove the consumer sees four faults on installed copies; no plant on the
package's own source is run for P2. The batch was read as input and not run. B2's analysis
rests on one run, and the claim that its waits came from group contention is read from
timestamps, not from GitHub's queue.

## Open questions

None.

## Findings

None.

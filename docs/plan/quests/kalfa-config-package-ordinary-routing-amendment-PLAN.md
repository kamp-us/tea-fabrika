Approved by the lead agent, builds 0585, 0590 and 0595; body f1b3a2c4ddf7
Plancheck-Version: 3

# Plan amendment: route ordinary Kalfa laws through the existing next project

Tracker ticket 1076, slice 2. This is today's CI serving `next/` and `@kalfa/config` tooling.
It completes ordinary test discovery promised by the approved package amendment, body
`17f51b782370310b1558263540c4cf3dfb728cf083b1b14b4bb998cb4e430506`.
The current original plan `31dbd98896b7` and repaired law plan `79cc605e5cae` remain in force.

```ts
// Sketch of the existing filter contract, expanded to the configured next project's two roots.
const full = "next/ kalfa/";
// Full discovery: vitest list --project next, with no positional path restriction.
// Changed discovery: the same command with --changed=<the existing base>.
// Runtime fallback: --project next next/ kalfa/.
// Saved proof counts "all" only for the exact expanded full filter, never legacy "next/".
```

## Scope and evidence

The package branch is `fabrikalfa/kalfa-config-package`, worktree `../tf-kalfa-config-package`,
[draft PR 1583](https://github.com/kamp-us/tea-fabrika/pull/1583), observed at
`086df1ff52466e144dafa99a99636a130a05e43e`. The one-expression installed-Effect API
correction above the normal main join is recorded separately. The source-review baseline is
`85919fe41730cdc48ba3fbe4bfa53e93e1ba9fbf`. Engine code, package APIs and the three moved law
bodies are outside this amendment.

Read every CI file below at committed interface
`972e743cd1564d8facb390374bdc888d37d4055f`, not a later moving CI branch. The corrected seven-path
delivery input is the `v2-cache-order` packet, SHA-256
`27334a0cd6e5df41838f566e071a49af45c7a02dcfee08c4a8bbb4513303b204`.
It preserves the correct cache-path order, with Kalfa third, directly after packages.
Its original parent patch, SHA-256
`437f24ef298b5ea1e1896f66bb3c2f766fc90aa0833e266714cef296f104e58d`, remains history.
Keep both packets, their copies, receipts and proposed files byte-identical. The P2 archive route
stays as approved. The same tests author prepares a separate ordinary-routing delta on corrected
v2 plus the same committed interface. Its overlapping check.yaml edits must preserve v2's cache
order. No live CI file is changed while its current repair owner holds it. The lead collects only
after the prerequisite is available.

The actual package Vitest config adds `kalfa/*/src/**/*.test.{ts,tsx}` to the existing `next`
project. It excludes integration/visual tests there and discovers Kalfa integration in
`next-integration`. However, `legs.ts` still lists that ordinary project with positional `next/`.
Its filter decoder, `changes.mjs`'s full filter and both workflow fallbacks also mean `next/` only.
The seven-path patch selects P2's integration owner; it does not repair these ordinary calls.

The sizing guard has one additional dependency beyond the first shortlist:
`workflow-lint/changes.ts` pins `SIZE_ENV.FILTER`. It must change with its existing negative
tests, alongside the already named next-job and merge-line guards. No directory-wide permission
is granted.

## How others do it

Use Vitest's existing project selection and changed import graph. The configured project, not a
second hard-coded discovery tree, owns ordinary membership. The installed Vitest 5.0.5 API is
already called by `legs.ts`'s `list` and the real-discovery tests. Removing the positional path
from full/changed ordinary discovery lets that project include Kalfa. No new test project,
runner, queue or selector service is needed.

This applies decisions 0585 and 0590: the package's laws travel with the package, and a changed
run selects the affected set while a full trigger selects every configured file. Preserve the
current shared nine test slots and all current limits, as in the committed CI interface and
0595. Elm and OTP add no machine to this bounded CI filter repair.

## Exact behavior

1. Keep the ordinary command's `--project next`. In `legs.ts`, discover its full or changed set
   without the positional `next/` argument. The existing base validity, global-trigger test,
   readers union, deduplication, duration estimates, sizing and shard outputs stay intact.
2. Use the canonical full filter `next/ kalfa/`. These are the two roots in the actual configured
   ordinary project. Its two unquoted words are Vitest path filters, not a new syntax or project.
   Keep sized `files` first, then classifier `filter`, then this complete fallback. The sizing
   step likewise takes the parser's filter, then the first pass's, then the expanded fallback.
3. Only the exact declared reader filter makes the sizing run reader-only. Missing or unrecognized
   filter input must not silently select readers; it takes the existing full/fail-open route.
   The proof decoder remains stricter: only the exact expanded full value means `scope: all`;
   the exact existing reader list means `readers`; missing, malformed and legacy `next/` input
   mean no proven expanded coverage. Keep job flags exact `true` and preserve `covers`'s order.
4. `changes.mjs` emits the expanded filter for its existing full scope. Do not broaden the set
   of files that same-program analysis may prove: it still proves the current next-source
   candidates only. Keep reader narrowing when that proof actually establishes it. A Kalfa
   source path still requires the ordinary changed/full route, not a guessed same-program skip.
5. Update the exact workflow guard expectations and generated valid fixture to the same two
   fallback expressions. They must reject the old next-only fallback, removed sized-files
   precedence, quoted two-word filters, an added project, a second changed restriction, new env
   inputs and every prior fault. Do not accept arbitrary fallback strings or relax command checks.
6. Extend actual discovery/partition coverage to include Kalfa. Preserve the existing file domains
   and generated shard assertions; add the actual ordinary-project check alongside them. The
   expected universe must include all three moved package law files, and each selected file must
   land once. Ordinary Kalfa files never join `related`'s integration/tooling file lists. P2 remains
   on its one existing related integration owner. Root tooling P1 remains a tooling law there.

The full fallback is tied to the actual project membership. A CI discovery law compares the
unrestricted ordinary project with the two-root fallback selection. An added ordinary root must
fail this comparison until its fallback is updated. Do not broaden `today`, tooling or integration
membership to make that comparison pass.

## Saved proof safety

Keep `recordName`, `matched`, `tested`, `vouches`, their API calls and artifact names unchanged.
The stored artifact binds the whole tested Git tree and base tree. Editing routing source
changes that whole tree. No supported path was found where an artifact made for the old routing
tree can match the new one, so an extra artifact suffix is unnecessary.

The new filter decoder must nevertheless refuse legacy `next/` as proof of the expanded full
selection. Test both `selectionOf` and `record`: a ready run printing that old filter cannot
record expanded coverage for a change needing it. Keep successful exact-tree/base reuse, ready
event/repository/workflow/required-job checks, failure/cancellation rejection, and API-error
fallback. Older evidence retains its original scope and is never relabeled as a new run.

## One ordinary law traced

1. A ready package PR changes `kalfa/config/src/App.ts`. The classifier keeps ordinary testing
   enabled and emits the canonical expanded filter for its full scope.
2. Sizing asks Vitest for the affected files of project `next` from the existing base, without
   filtering them back to `next/`. `kalfa/config/src/App.test.ts` is eligible. Readers are added
   once, and the existing sizing algorithm places the selected files on its current numbered legs.
3. The ordinary job runs its exact sized list with `--project next` and full depth. If sizing
   cannot provide a list, its unchanged fallback matrix runs the expanded path filter, so the
   Kalfa law is still covered. A global trigger discovers the whole configured ordinary set.
4. Related selection still owns integration/tooling only. The ordinary law is not copied into
   P2's integration work. The retained archive verifier/upload contract stays unchanged.
5. A ready run's record uses the same actual tested tree/base and stricter full-filter decoding.
   An old `next/` filter fails coverage; genuine matching-tree/current-scope evidence can still
   be reused by the existing protected queue route.

## Laws

Every existing law, generator domain, bound, example, seed, run count, timeout and assertion stays.
Update expected full-filter strings only where the intended contract has changed. Add targeted
positive and negative cases. New generated laws use the supported Schema property runner.
Runtime/listing/guard/plant execution happens only in eligible automatic CI, never locally.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| O1, full and changed ordinary discovery follow project next without a next-only path restriction. Required package laws are included; readers and every selected file occur once, with the same sizing bounds and shard union. 100 runs | test | Effect Arbitrary: OrdinarySelection | Restore positional next/ in the actual ordinary discovery call: the package law is absent from the selected/partitioned set. | .github/ci/legs.test.ts and .github/ci/related.test.ts |
| O2, complete fallback equals the configured ordinary project, while exact reader narrowing remains and bad sizing/filter input cannot silently narrow to readers. Ordinary package files never appear in related integration/tooling selections. | test | scenario: actual configured project discovery, canonical two-root fallback and reader-only/failing-sizing routes; an import-only stand-in cannot prove Vitest's CLI filtering | Restore either workflow fallback to next/, omit Kalfa from fallback discovery, or copy ordinary package files into related: exact universe/partition checks fail. | .github/ci/legs.test.ts and .github/ci/related.test.ts |
| O3, classifier full scope emits the canonical expanded filter; proof reads only that value as all and rejects legacy/missing/malformed values. Ready-record coverage, same-program readers, failure fallback and exact tree/base reuse keep their existing behavior. 100 runs | test | Effect Arbitrary: PrintedSelection | Decode legacy next/ as expanded all, or record a ready legacy-filter run needing expanded scope: the negative record assertion fails. | .github/ci/changes.test.ts |
| O4, exact sizing/ordinary workflow guards accept the complete generated workflow and reject only-one-root fallback, wrong precedence, second narrowing, extra project/env and all existing faults. | test | scenario: each isolated new fault applied to the valid generated workflow, with the complete prior generated fault suite retained | Allow the old FILTER spelling in SIZE_ENV, nextLaws or VITEST_VARS: its isolated negative case is accepted. | .github/ci/workflow-lint/changes.test.ts, .github/ci/workflow-lint/next-job.test.ts and .github/ci/workflow-lint/merge-line.test.ts |

O1/O2 must use real configured discovery in CI and exercise the selected/fallback command path,
not merely a test-side list that already contains Kalfa. Extend existing selector seams only if
needed; no new user API or test-runner abstraction. Preserve the old partition universe and its
assertions while adding the ordinary-project-specific proof. No local discovery or copied guard
execution is authorized. A plant not actually run remains explicitly unrun.

## Files

All these files belong to the same tests step because they are CI selection/guards or their laws.
The first two paths were already approved. The remaining 11 paths are this amendment's exact
added ownership. No other delivery-patch path needs another edit for ordinary routing.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| .github/ci/changes.mjs | tests | tests | Already owned: canonical expanded filter and strict saved-selection decoding; preserve seven-path additions and existing proof/tree behavior. |
| .github/workflows/check.yaml | tests | tests | Already owned: expanded FILTER fallbacks in sizing and ordinary next job only; keep every retained delivery-patch hunk. |
| .github/ci/legs.ts | tests | tests | Add: ordinary project discovery without next-only path; exact-reader decoding and fail-open full behavior. |
| .github/ci/legs.test.ts | tests | tests | Add: O1/O2 against actual ordinary discovery and existing sizing/shard contracts. |
| .github/ci/changes.test.ts | tests | tests | Add: O3, new full-filter expectations and explicit old-filter refusal; retain exact reuse tests. |
| .github/ci/related.test.ts | tests | tests | Add: preserve existing discovery/partition tests, extend their universe and add actual ordinary package partition/fallback proof. |
| .github/ci/workflow-lint/changes.ts | tests | tests | Add: exact expanded SIZE_ENV.FILTER expectation. |
| .github/ci/workflow-lint/changes.test.ts | tests | tests | Add: sizing fallback/precedence faults, all prior faults retained. |
| .github/ci/workflow-lint/next-job.ts | tests | tests | Add: exact expanded ordinary fallback expectation, same command/env/shard rules. |
| .github/ci/workflow-lint/next-job.test.ts | tests | tests | Add: ordinary fallback/precedence faults, all prior faults retained. |
| .github/ci/workflow-lint/merge-line.ts | tests | tests | Add: only the corresponding exact VITEST_VARS.FILTER spelling changes. |
| .github/ci/workflow-lint/merge-line.test.ts | tests | tests | Add: reject the old fallback and added project/env inputs under the same whole-workflow acceptance path. |
| .github/ci/workflow-lint/wiring.test-support.ts | tests | tests | Add: valid workflow fixture's sizing filter and vitestFilter match the expanded contract; no fault domain removed. |
| docs/plan/quests/kalfa-config-package-ordinary-routing-amendment-PLAN.md | lead | docs | Save this exact approved routing amendment. |
| kalfa/config/src/App.test.ts | tests | tests | Existing evidence reference only; do not edit its law body in this routing amendment. |
| kalfa/config/src/TomlParser.test.ts | tests | tests | Existing evidence reference only; do not edit its law body in this routing amendment. |
| kalfa/config/src/Toml.types.test.ts | tests | tests | Existing evidence reference only; do not edit its law body in this routing amendment. |

The source-only private continuation keeps a separate patch and metadata receipt. It records the
same CI interface, corrected v2 and original parent patch hashes, each additional base/proposed blob, the
overlap order for the two already-owned paths, and this approved plan body. Do not overwrite the
earlier packet or claim the combined source was applied. The lead and same independent reviewer
read the combined diff before ordinary CI/source completion can be claimed.

## Existing tools

- Searched `legs.ts` and the existing Vitest project config. Reuse `list`, `isTrigger`,
  `withReaders`, `size` and `outputs`; the bug is a positional restriction on their existing call.
- Searched `changes.mjs`. Reuse `filterOf`, `selectionOf`, `record` and `covers`; no new coverage
  store, artifact namespace, public API or matcher is introduced.
- Searched the exact workflow guards and `wiring.test-support.ts`. Change their existing pinned
  filter values together and extend the current fault lists. No new validator is needed.
- Searched the actual `related.test.ts` discovery/partition machinery. Retain it and add the
  ordinary-project check; do not build another sharder or rerun ordinary laws in related.

## Calls taken

- Keep ordinary Kalfa in the existing next project. Confidence 100%. The approved package config
  already places it there. Running it in related as well would duplicate work.
- Use `next/ kalfa/` as the canonical full filter and discover the project without path arguments.
  Confidence 99%. It matches the actual configured roots and retains the current CLI contract.
  A real discovery equality check catches future root drift.
- Keep stored artifact names and whole-tree/base matching. Confidence 99%. Routing source is part
  of that tree; no supported old-artifact collision was found. Strict filter decoding separately
  prevents a new record from overstating a legacy next-only selection.
- Is this a setting? No. This repairs membership of an already declared test project. No count,
  time budget, project choice or product setting changes.

## Validation

The plan step performs metadata, ownership, body-digest and leak checks plus structural draft
parsing only. It imports no selector, test, workflow guard or compiler. The continuing tests
author uses source reads and direct formatting for the private delta. All product tests, listings,
lint/guard execution, plants, build/pack/install and compiler checks remain CI-only.

Use the existing automatic changed/related PR and protected queue route once dependencies and
combined source are ready. No manual duplicate proof, extra job, new project, changed pool,
increased slot count, raised timeout, reduced workload, skip or changed failure behavior. Preserve
the old-product freeze, visual route, full-depth counts, selected-result accounting, archive
receipt checks and one selected P2 owner. The same reviewer checks the combined routing delta.

## Size

1. This routing completion adds about 0 product lines and 80 to 140 CI/test lines in existing
   files. The consumer/package feature remains the already approved slice 2.

About 1 agent hour, 80% confidence. This is the same tests author's bounded continuation, then
independent recheck. The cost uses the existing package plan's roughly $5 per step basis, not
a new provider price or infrastructure purchase.

Estimate: 2 steps, $10

## Records

Keep corrected v2, its original parent and their source receipts immutable. Record this separate delta's source
interface, exact plan/body hash and actual file hashes when prepared. Lost if not recorded now:
which selector/filter version a claimed ordinary selection used. The current whole-tree/base
record keeps that source identity; do not replace it with a branch-name or patch-likeness claim.

## What this cannot tell us

This unsigned amendment proves no ordinary Kalfa selection, shard result, guard result, archive
or consumer run. Current draft checks are only their actual check results. Report source-ready,
CI-running and merged separately, at their actual commits. The seven-file packet is still private
and unapplied; its completion never established complete ordinary routing.

## Open questions

None.

## Findings

None.

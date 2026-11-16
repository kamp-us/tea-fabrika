
Plancheck-Version: 3
# Plan: every check of the Effect checker ends at error and zero hits in next/ and our tooling, one check and one folder set per pull request

`next/` and our tooling (`.agents/`, `oxlint-plugins/`, `.github/ci/`). Today's version is not
touched. Every number below was counted on `origin/main` at `82296f5cf` on 2026-11-15. The ticket is
not filed yet. This plan builds [0565](../../../.decisions/0565-effects-own-checks-block.md) as
amended by [0574](../../../.decisions/0574-no-stability-tag-and-unstable-api-is-an-error.md),
[0575](../../../.decisions/0575-deterministic-keys-is-the-service-id-form.md),
[0576](../../../.decisions/0576-schema-sync-error-result-in-plain-code.md) and
[0577](../../../.decisions/0577-libraries-namespace-programs-barrel-imports.md), under
[0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md),
[0523](../../../.decisions/0523-advice-rules-block-where-clean.md) and
[0168](../../../.decisions/0168-old-lint-breaks-are-fixed.md).

```jsonc
// The whole idea. One slice: one check, the folders it brings to zero, and the same pull request
// locks them. tsconfig.base.json, one more entry in "overrides" (E8, a real slice below):
{
  "include": ["next/**/*.ts", "next/**/*.tsx", ".agents/**/*.ts", "oxlint-plugins/**/*.ts", /* ... */],
  "options": { "diagnosticSeverity": { "unnecessaryArrowBlock": "error" } }
}
// From then on a new hit there fails `pnpm typecheck`, and a law fails if the entry is dropped.
```

## The answer

- **39,768 hits from 57 checks on main today,** with every one of the 135 checks at error. 78
  checks have 0 hits. Under the import form this plan takes for tooling (barrel, call 2), it is
  39,456. Main's last total was 39,888; "How I counted" says why the numbers differ.
- **101 slices.** E0 turns on the 78 checks at zero, for the whole scope, in one config pull
  request. Then 25 mechanical and 34 judgment slices start now, 40 slices wait for the quotas
  branch, and the last recounts `apiStabilityLeak` as 0574 says.
- **The count drops fast.** E1 alone takes out 12,815 hits: it deletes our `@stability` tags
  outside the quotas branch's files and names the unstable Effect parts we use, as 0574 rules. The
  25 mechanical slices that start now take out 14,995 hits, 38% of the total.
- **Only the quotas branch waits.** Its files are fixed in the 40 "after 1366" slices. Nine other
  open pull requests touch files with hits; none waits, and the one that lands second rebases.
- **The lock** is the check at `error` for the slice's folders (a `type` law: the typecheck fails
  on a new hit), plus one pinned law, `oxlint-plugins/effect-checks.test.ts`, that fails if any
  locked folder stops ending at `error`.
- **Steps for a mechanical slice:** tests (the lock, the law row, and the hits in exam paths),
  build (the hits in product files, skipped when there are none), one review. No decision lets the
  lead merge tests and build into one agent for product code. Details under "Pipeline steps".

## Doubts first

- **Call 2, tooling imports from the barrel (80%).** 0577 left tooling's import form open. I apply
  its principle (programs and apps take the barrel) to the tooling scripts, which are programs.
  Then tooling has 0 import hits. If the lead or the owner says namespace, three slices are added
  (312 hits: `.agents/` 288, `.github/ci/` 11, `oxlint-plugins/` 13).
- **Call 5, `.agents/`-only slices go one agent under the lead tooling fast track (75%).** The lock
  line sits in `tsconfig.base.json`, an exam path. If the lead reads exam paths as needing the tests
  step even in a fast track, those 4 slices take tests and review, and no build.
- **Slice sizes are guesses** made before any fix was tried: up to 2,500 hits for a mechanical
  slice and 800 for a judgment one. A builder that runs out of room stops and reports; the slice
  splits by folder, never by leaving hits.

## How I counted

One run of the checker per tsconfig in scope, one after another, each only when `pgrep -x tsgo`
found none, under `nice -n 19`. The checker's own command line, as
[plan B](../effect-rules-big.md) counted its imports:

```sh
# For each of the 13 tsconfigs in scope: the 3 tooling ones, libfabrika, tuval, vitest,
# the six programs and next/apps/fabrika.
nice -n 19 pnpm exec effect-tsgo diagnostics --format json \
  --project "$PWD/<folder>/tsconfig.json" \
  --lspconfig "$ALL_AT_ERROR"
# $ALL_AT_ERROR: every name in node_modules/@effect/tsgo/schema.json's diagnosticSeverity (135)
# at "error", includeSuggestionsInTsc true, no overrides, plus the import list:
# namespaceImportPackages ["effect"] for libraries and tooling, barrelImportPackages ["effect"]
# for programs and the app (0577). A second run of the 3 tooling tsconfigs took the barrel list.
```

- `--lspconfig` replaces the project's own plugin block, so nothing we set today hides a hit.
- Hits were joined across projects by file, offset and check, so a file two projects read counts
  once. All 39,768 sit in the scope; 935 files hold them.
- The 39,888 on main came from a run I did not see. Two known differences: the import lists above
  follow 0577 (0565's count named `effect` for namespace imports everywhere, which gave 3,098
  `preferNamespaceImport` hits), and main moved since.
- The raw output stayed in a scratch folder outside the repo. Only these totals are here
  ([0027](../../../.decisions/0027-experiment-results-live-in-a-private-archive.md)).

## The count by check

Hits per check. "next" is `next/` and the one fixture its app reads; "tooling" is the three tooling
folders. `preferNamespaceImport`'s tooling hits are the namespace form, which call 2 drops.

| Check | All | next | tooling |
|---|---|---|---|
| `unstableApiUsage` | 16779 | 16392 | 387 |
| `preferEffectArray` | 7283 | 5281 | 2002 |
| `preferEffectString` | 3039 | 1848 | 1191 |
| `preferNamespaceImport` | 2519 | 2207 | 312 |
| `strictEffectProvide` | 1548 | 1478 | 70 |
| `asyncFunction` | 1463 | 1266 | 197 |
| `newSchemaClass` | 960 | 858 | 102 |
| `preferEffectRecord` | 865 | 568 | 297 |
| `anyUnknownInErrorContext` | 698 | 687 | 11 |
| `schemaSync` | 642 | 624 | 18 |
| `preferSchemaOverJson` | 519 | 494 | 25 |
| `nodeBuiltinImport` | 407 | 243 | 164 |
| `missingPipeableSignature` | 391 | 228 | 163 |
| `preferTypedSchemaDecoder` | 336 | 318 | 18 |
| `strictBooleanExpressions` | 303 | 189 | 114 |
| `schemaNumber` | 295 | 179 | 116 |
| `apiStabilityLeak` | 242 | 209 | 33 |
| `schemaClassMissingBrand` | 194 | 169 | 25 |
| `schemaSyncInEffect` | 159 | 157 | 2 |
| `runEffectInsideEffect` | 128 | 128 | 0 |
| `globalDate` | 108 | 76 | 32 |
| `processEnvInEffect` | 103 | 100 | 3 |
| `globalConsole` | 82 | 6 | 76 |
| `unnecessaryTypeofType` | 70 | 70 | 0 |
| `processEnv` | 68 | 42 | 26 |
| `missedPipeableOpportunity` | 56 | 56 | 0 |
| `instanceOfSchema` | 53 | 52 | 1 |
| `newPromise` | 48 | 48 | 0 |
| `multipleEffectProvide` | 46 | 46 | 0 |
| `globalDateInEffect` | 39 | 17 | 22 |
| `globalErrorInEffectFailure` | 38 | 38 | 0 |
| `deterministicKeys` | 35 | 30 | 5 |
| `unnecessaryArrowBlock` | 30 | 30 | 0 |
| `globalErrorInEffectCatch` | 26 | 26 | 0 |
| `catchToOrElseSucceed` | 23 | 8 | 15 |
| `globalTimers` | 20 | 20 | 0 |
| `schemaStructWithTag` | 19 | 15 | 4 |
| `globalConsoleInEffect` | 17 | 2 | 15 |
| `globalFetch` | 16 | 16 | 0 |
| `preferSucceedSomeOrNone` | 10 | 10 | 0 |
| `unnecessaryFailYieldableError` | 9 | 8 | 1 |
| `preferBarrelImport` | 9 | 9 | 0 |
| `lazyEffect` | 8 | 8 | 0 |
| `mapMapErrorToMapBoth` | 7 | 7 | 0 |
| `catchConditionalRefailToCatchIf` | 7 | 7 | 0 |
| `returnEffectInGen` | 7 | 7 | 0 |
| `preferUnsafeConstructor` | 6 | 6 | 0 |
| `extendsNativeError` | 6 | 6 | 0 |
| `unnecessaryEffectGen` | 6 | 6 | 0 |
| `globalFetchInEffect` | 5 | 4 | 1 |
| `flatMapConditionalToFilterOrFail` | 5 | 5 | 0 |
| `effectSucceedWithVoid` | 4 | 4 | 0 |
| `catchToIgnore` | 4 | 4 | 0 |
| `nestedEffectGenYield` | 4 | 4 | 0 |
| `multipleCatchTag` | 2 | 0 | 2 |
| `runOfExitToRunExit` | 1 | 1 | 0 |
| `flatMapIgnoredParamToAndThen` | 1 | 1 | 0 |

The other 78 checks have 0 hits. 51 of them are set today, and 27 block only by their default
level; 0565 lists both groups.

## The count by folder

| Folder | Hits |
|---|---|
| `next/packages/libfabrika` | 25,782 |
| `next/apps/fabrika`, with its fixture | 6,656 |
| `.agents/` | 2,446 (2,158 under call 2) |
| `oxlint-plugins/` | 1,526 (1,513) |
| `.github/ci/` | 1,478 (1,467) |
| `next/programs/pipeline` | 730 |
| `next/packages/tuval` | 315 |
| `next/programs/chaos` | 239 |
| `next/programs/checklist` | 217 |
| `next/programs/tezgah` | 180 |
| `next/programs/counter` | 145 |
| `next/packages/vitest` | 30 |
| `next/programs/inbox` | 24 |

Inside libfabrika the busiest module folders are `runtime` (5,851), `node` (3,980), `cloudflare`
(3,035), `processes` (2,456), `client` (1,858) and `settings` (1,638). In the app, `src/` files at
its top hold 3,847, `src/exam` 1,534 and `e2e` 1,094. 29,226 hits (73%) are in exam paths, most of
them test files, so the tests step does most of the fixing.

## How others do it

- **The Effect team** sets few checks: in `Effect-TS/effect` at `d5f8bdf4f`, two at error and the
  rest at default, with `@effect-diagnostics-next-line` for an exception. 0565 records that read;
  I did not fetch it again. We go further on purpose (0565), so their repo gives the config shape
  and the ignore comment, not the scope.
- **A large change is cut into pieces that each land on their own and are each reviewed,** mostly
  by tool, the way Google's large-scale change process shards one change by directory owner
  ("Software Engineering at Google", chapter 22, from memory; not fetched this turn). Our folder
  slices are that shard, and 0565 already set it.
- **A ratchet:** each piece locks what it cleaned, so the count never climbs back. Our own
  precedent is the import slices of [plan B](../effect-rules-big.md), whose
  `oxlint-plugins/namespace-imports.test.ts` pins the folders already locked. This plan makes that
  law general instead of writing a second one.
- **Elm and OTP** have no answer here: this is build config, not a machine. No state machine is
  added.

## The shape

**Where a level is set.** As 0565 and 0577 say, with one entry per check so slices of different
checks touch different lines.

- Every check but the two import checks: an entry in `overrides` of `tsconfig.base.json`, one per
  check (a pair of checks with one fix shares one). Its `include` grows a folder glob per slice.
  The slice that brings a check's last folder to zero replaces the list with the scope's globs.
- `preferNamespaceImport`: libfabrika's and tuval's own tsconfig, with `overrides` there until the
  package is at zero (0577); vitest is at zero and takes the package-wide block in E0. E2 moves the
  two libfabrika entries out of `tsconfig.base.json`.
- `preferBarrelImport`: the six programs and the tooling take the package-wide block in E0 (0
  hits); the app's 9 hits are E13.
- `allowedUnstableApis` (0574) sits in the `unstableApiUsage` entry's own `options`, so it reaches
  nothing else. It names modules, as the checker's README allows ("a module entry permits that
  module and its descendants").

```jsonc
// tsconfig.base.json after E0, E1 and E8, a sketch. Globs are relative to the repo root.
"overrides": [
  // ... the four entries there today stay, until each check's last slice ...
  // E0: every check at zero today, for the whole scope.
  { "include": SCOPE, "options": { "diagnosticSeverity": {
      "classSelfMismatch": "error", "duplicatePackage": "error", "outdatedApi": "error" /* ... 78 */ } } },
  // E1: the folders that are at zero once our tags are gone.
  { "include": ["next/packages/libfabrika/src/transport/**/*.ts", "next/packages/tuval/**/*.ts",
                ".agents/**/*.ts" /* ... 15 folders */],
    "options": {
      "allowedUnstableApis": ["@effect/vitest", "@effect/platform-node", "effect/Arbitrary",
        "effect/FileSystem", "effect/Path", "effect/process", "effect/crypto", "effect/cli" /* ... */],
      "diagnosticSeverity": { "unstableApiUsage": "error" } } },
  // E8: at zero everywhere in one slice, so its include is the whole scope at once.
  { "include": SCOPE, "options": { "diagnosticSeverity": { "unnecessaryArrowBlock": "error" } } }
]
// SCOPE, written out in each entry, since JSON has no names:
// "next/**/*.ts", "next/**/*.tsx", "fixtures/next/**/*.ts", ".agents/**/*.ts",
// ".github/ci/**/*.ts", ".github/ci/**/*.mjs", "oxlint-plugins/**/*.ts",
// "oxlint-plugins/**/*.mjs", "stylelint.config.ts"
```

**The ignore line,** for a line that is right where the check does not fit (0565). E0 teaches
`oxlint-plugins/no-bare-disable.ts` the checker's comment, so the reason is held by code, not
prose:

```ts
// passes
// @effect-diagnostics-next-line preferEffectArray:off -- the platform hands back a plain array
// refused by no-bare-disable: no reason, the file-wide form, and the skip-file form
// @effect-diagnostics-next-line preferEffectArray:off
// @effect-diagnostics preferEffectArray:off
// @effect-diagnostics skip-file
```

**The lock law,** a sketch. `oxlint-plugins/namespace-imports.test.ts` moves with `git mv` to
`oxlint-plugins/effect-checks.test.ts`, which reads any check, the base and the package tsconfig
together, merged key by key as 0577 proved the checker does.

```ts
// A sketch of oxlint-plugins/effect-checks.test.ts; the tests step settles the exact lines
// pinned: the folders each slice locked, on the day it landed. Only grows; a slice adds its row.
const LOCKED: Readonly<Record<string, ReadonlyArray<string>>> = {
  preferNamespaceImport: ["next/packages/libfabrika/src/ci/**/*.ts", "next/packages/libfabrika/src/codehost/**/*.ts"],
  unnecessaryArrowBlock: SCOPE,
  // ... one row per check, one glob per locked folder
};

/** The level a file ends at: base map, base overrides in order, then the package's block and its overrides. */
const levelAt = (check: string, file: string): string | undefined => { /* the merge, as today's law does */ };

it("pinned: every folder a slice locked still ends at error for its check", () => {
  for (const [check, globs] of Object.entries(LOCKED))
    for (const file of filesMatching(globs)) expect([check, file, levelAt(check, file)]).toEqual([check, file, "error"]);
});
```

It walks real files on disk, not glob against glob, so an `exclude`, a later override or a package
block that turns a level down is seen the way the checker sees it. Each `.agents/` file it reads
is one `.agents/tsconfig.json` includes.

- New words: none. "Slice" and "lock" are plain words here, not glossary terms.
- Settings: each level and `allowedUnstableApis` is a setting of the checker, kept in its own
  config file. None is a `fabrika.toml` value: they shape the build, not a running fabrika
  ([0069](../../../.decisions/0069-choices-are-settings.md)).

## One slice end to end: E8, `unnecessaryArrowBlock`

30 hits, all in files the quotas branch does not touch, so one slice locks the whole scope.

1. **The brief** names the row: E8, mechanical, Sonnet, the 30 hits by file.
2. **The tests step** adds the E8 entry above to `tsconfig.base.json` and the `LOCKED` row. It runs
   the narrow law and `pnpm typecheck` once: red, 30 times, for example:

   ```text
   next/packages/libfabrika/src/access/AccessFold.ts:60 error effect(unnecessaryArrowBlock):
   This arrow function block only returns an expression and can use a concise body.
   ```

   It fixes the 27 hits in exam paths (tests and test support), the same way the build does below.
3. **The build step** fixes the 3 hits in product files, taking the checker's fix as it is:

   ```ts
   // before, next/packages/libfabrika/src/access/AccessFold.ts:60
   export const foldAccess = (events: ReadonlyArray<MemberEvent>): Access => {
     return members(events.reduce(step, EMPTY));
   };
   // after
   export const foldAccess = (events: ReadonlyArray<MemberEvent>): Access =>
     members(events.reduce(step, EMPTY));
   ```

4. **CI** runs the typecheck: 0 hits. The law is green.
5. **The plant,** kept by the tests step for the review: one new block-bodied arrow in a locked
   folder makes `pnpm typecheck` red; dropping one glob from the E8 entry makes the law red.
6. **The review** reads the diff against this plan, the per-check report and every ignore line.
7. **The pull request body** reports: 30 hits met, 30 fixed, 0 ignore lines, and that no rule of
   ours gives way to this check.

## Laws

| Law | Lint, type or test | Generator | Plant |
|---|---|---|---|
| L1. In each folder a slice locked, a hit of its check fails the typecheck | type | type | Add one line the check flags to a file in a locked folder: `pnpm typecheck` is red with `effect(<check>)`. Each slice's tests step keeps that red output for the review, then removes the line |
| L2. Every folder once locked still ends at `error` for its check, merged as the checker merges | test | pinned: the `LOCKED` table, one row per landed slice | Delete one glob from an entry, set one level to `warning`, or add a later override that turns it `off`: each turns the law red |
| L3. An `@effect-diagnostics` comment is the next-line form, names its check and level, and gives ` -- <reason>` | lint | lint | The three refused lines in "The shape": each fails `pnpm lint` |
| L4. The checker reads the ` -- <reason>` tail as no part of the directive, so a reasoned line still silences the line after it | type | type | E0 writes one reasoned ignore line on a planted hit: the typecheck passes; without the comment it fails. Proves what 0565 read but did not run |
| L5. In the folders E1 locks, no `@stability` tag of ours is left and no Effect part outside `allowedUnstableApis` is used | type | type | Put `@stability unstable` back on one export a locked folder uses: `unstableApiUsage` fails there |

- L1, L4 and L5 are `type`: only the compiler, with the checker inside it, sees them. L3 is `lint`,
  in an existing rule. L2 is a test, as the law it replaces is: it reads config, not code shape.
- Every rule of ours that a check replaces goes in the slice that turns the check on where ours
  ran, never before ([0573](../../../.decisions/0573-trusted-lint-rule-replaces-ours.md)):
  `service-id` with the last `deterministicKeys` slice (E93, 0575), `no-secret-env` with the last
  `processEnv` slice (E86), `no-wall-clock` and `no-clock-in-view` with the last `globalDate` slice
  (E89).
- No host-only law, no window, no screenshots, no secrets.

## The slices

"Now" starts at once. "After 1366" waits for
[pull request 1366](https://github.com/kamp-us/tea-fabrika/pull/1366) to land. Folder names:
`lib:` is a libfabrika `src/` module (`lib:top` its top files), `app:` is `next/apps/fabrika`
(`app:src` its top `src/` files, `app:top` its top files and fixture), `prog:` a program. Hits are
per folder. Steps: "tests, review" means no product file has a hit.

| Slice | When | Check | Folders and hits | Hits | Kind | Model | Steps |
|---|---|---|---|---|---|---|---|
| E0 | now | the 78 checks at 0 hits, and preferNamespaceImport in vitest, preferBarrelImport in the six programs and the tooling | all of the scope | 0 | mechanical | Sonnet | tests, review |
| E1 | now | `unstableApiUsage` | tags out of every file but PR 1366's; locks .agents 320, lib:transport 308, lib:tezgah 170, tuval 128, lib:codehost 96, prog:tezgah 65, .github/ci 58, lib:top 51, lib:presence 44, lib:repositories 40, lib:ci 35, vitest 26, lib:schedules 19, oxlint-plugins 9, app:entry 7 | 12815 | mechanical | Sonnet | tests, build, review |
| E2 | now | `preferNamespaceImport` | lib:node 561, lib:client 91, lib:access 68, lib:transport 68, lib:desktop 38, lib:permissions 36, lib:top 35, lib:packs 28, lib:tasks 25, tuval 18, lib:presence 8, lib:schedules 6, lib:repositories 5, lib:tezgah 5 | 992 | mechanical | Sonnet | tests, build, review |
| E3 | now | `newSchemaClass` | .agents 95, lib:node 92, app:e2e 43, lib:access 35, app:exam 30, lib:desktop 20, app:top 17, lib:client 11, tuval 10, lib:top 8, lib:packs 8, lib:tasks 8, prog:chaos 8, prog:pipeline 8, lib:transport 7, .github/ci 6, lib:codehost 6, lib:permissions 4, lib:ci 2, lib:presence 2, lib:schedules 2, oxlint-plugins 1 | 423 | mechanical | Sonnet | tests, build, review |
| E4 | now | `schemaNumber` | .agents 115, app:src 34, lib:telemetry 18, lib:transport 16, prog:pipeline 16, app:exam 9, lib:client 8, app:e2e 5, lib:node 5, lib:schedules 4, lib:desktop 3, lib:processes 2, lib:tezgah 2, .github/ci 1, app:top 1, lib:access 1 | 240 | mechanical | Sonnet | tests, build, review |
| E5 | now | `preferTypedSchemaDecoder` | app:src 30, prog:pipeline 28, lib:node 21, app:e2e 19, .agents 18, lib:top 14, app:exam 13, lib:transport 10, lib:client 8, prog:chaos 6, lib:access 5, prog:checklist 5, lib:desktop 4, tuval 4, lib:packs 3, app:top 2, lib:codehost 2, lib:ledger 2, lib:tezgah 2, prog:counter 2, prog:inbox 2 | 200 | mechanical | Sonnet | tests, build, review |
| E6 | now | `schemaClassMissingBrand` | .agents 23, lib:desktop 16, app:e2e 13, lib:settings 12, app:exam 9, lib:node 8, lib:access 7, lib:transport 6, lib:gateway 5, lib:cloudflare 4, lib:codehost 4, lib:packs 4, lib:repositories 4, lib:ci 3, lib:permissions 3, app:top 2, lib:top 2, lib:client 2, lib:telemetry 2, .github/ci 1, lib:schedules 1, lib:tasks 1, prog:pipeline 1, oxlint-plugins 1 | 134 | mechanical | Sonnet | tests, build, review |
| E7 | now | `unnecessaryTypeofType` | lib:client 15, lib:processes 9, app:src 6, lib:telemetry 4, lib:packs 3, lib:permissions 2, app:e2e 1, lib:top 1, lib:desktop 1, lib:ledger 1, lib:tasks 1, prog:chaos 1 | 45 | mechanical | Sonnet | tests, build, review |
| E8 | now | `unnecessaryArrowBlock` | lib:processes 16, lib:packs 4, lib:telemetry 3, app:exam 1, lib:access 1, lib:client 1, lib:cloudflare 1, lib:gateway 1, lib:node 1, lib:runtime 1 | 30 | mechanical | Sonnet | tests, build, review |
| E9 | now | `catchToOrElseSucceed` | .agents 15, lib:node 4, lib:transport 2, app:e2e 1, app:exam 1 | 23 | mechanical | Sonnet | tests, build, review |
| E10 | now | `instanceOfSchema` | lib:settings 7, app:src 5, lib:access 2, .agents 1, lib:top 1, lib:node 1 | 17 | mechanical | Sonnet | tests, build, review |
| E11 | now | `schemaStructWithTag` | .github/ci 4, lib:client 3, app:e2e 1, lib:node 1, lib:processes 1 | 10 | mechanical | Sonnet | tests, review |
| E12 | now | `preferSucceedSomeOrNone` | lib:processes 6, prog:pipeline 2, lib:runtime 1, lib:telemetry 1 | 10 | mechanical | Sonnet | tests, build, review |
| E13 | now | `preferBarrelImport` | app:src 6, app:exam 2, app:e2e 1 | 9 | mechanical | Sonnet | tests, build, review |
| E14 | now | `mapMapErrorToMapBoth` | lib:node 2, app:src 1, lib:client 1, lib:cloudflare 1, lib:desktop 1, lib:ledger 1 | 7 | mechanical | Sonnet | tests, build, review |
| E15 | now | `returnEffectInGen` | lib:cloudflare 3, app:src 2, lib:node 2 | 7 | mechanical | Sonnet | tests, build, review |
| E16 | now | `preferUnsafeConstructor` | lib:node 5, app:e2e 1 | 6 | mechanical | Sonnet | tests, review |
| E17 | now | `unnecessaryEffectGen` | lib:runtime 2, lib:ledger 1, lib:node 1, lib:permissions 1, lib:settings 1 | 6 | mechanical | Sonnet | tests, review |
| E18 | now | `flatMapConditionalToFilterOrFail` | app:src 2, lib:telemetry 2, lib:processes 1 | 5 | mechanical | Sonnet | tests, build, review |
| E19 | now | `unnecessaryFailYieldableError` | lib:node 2, .agents 1, tuval 1 | 4 | mechanical | Sonnet | tests, build, review |
| E20 | now | `effectSucceedWithVoid` | app:e2e 2, app:exam 1 | 3 | mechanical | Sonnet | tests, review |
| E21 | now | `multipleCatchTag` | .agents 2 | 2 | mechanical | Sonnet | one agent (lead tooling) |
| E22 | now | `catchConditionalRefailToCatchIf` | app:src 1, lib:processes 1 | 2 | mechanical | Sonnet | tests, build, review |
| E23 | now | `catchToIgnore` | lib:telemetry 2 | 2 | mechanical | Sonnet | tests, build, review |
| E24 | now | `nestedEffectGenYield` | lib:runtime 1, prog:chaos 1 | 2 | mechanical | Sonnet | tests, review |
| E25 | now | `runOfExitToRunExit` | app:src 1 | 1 | mechanical | Sonnet | tests, review |
| E26 | now | `preferEffectArray` | lib:client 590, prog:pipeline 120, lib:desktop 87, lib:repositories 2, prog:inbox 1 | 800 | judgment | Opus | tests, build, review |
| E27 | now | `preferEffectString` | lib:node 304, app:exam 290, app:e2e 121, lib:client 58, lib:packs 19, lib:tasks 7, lib:presence 1 | 800 | judgment | Opus | tests, build, review |
| E28 | now | `preferEffectArray` | app:exam 562, tuval 93, prog:tezgah 77, prog:checklist 66 | 798 | judgment | Opus | tests, build, review |
| E29 | now | `preferEffectArray` | lib:node 452, app:e2e 281, prog:chaos 58, app:top 7 | 798 | judgment | Opus | tests, build, review |
| E30 | now | `strictEffectProvide` | lib:node 215, lib:processes 153, lib:ledger 91, lib:telemetry 76, lib:access 74, app:e2e 37, app:exam 33, lib:client 23, lib:top 15, lib:presence 15, prog:counter 10, prog:pipeline 10, app:top 6, lib:packs 6, lib:desktop 4, lib:permissions 4, lib:tasks 2, app:entry 1 | 775 | judgment | Opus | tests, build, review |
| E31 | now | `preferEffectArray` | oxlint-plugins 739 | 739 | judgment | Opus | tests, review |
| E32 | now | `asyncFunction` | lib:node 216, oxlint-plugins 104, .github/ci 93, lib:settings 51, app:e2e 40, lib:transport 37, lib:gateway 27, app:exam 22, lib:ledger 14, lib:top 13, prog:checklist 13, prog:counter 11, lib:packs 10, prog:tezgah 10, lib:telemetry 8, lib:access 7, lib:client 2, tuval 2, lib:processes 1 | 681 | judgment | Opus | tests, review |
| E33 | now | `preferEffectString` | oxlint-plugins 340, .github/ci 336 | 676 | judgment | Opus | tests, review |
| E34 | now | `preferEffectArray` | .github/ci 661 | 661 | judgment | Opus | tests, review |
| E35 | now | `preferEffectArray` | .agents 602 | 602 | judgment | Opus | one agent (lead tooling) |
| E36 | now | `preferEffectRecord` | oxlint-plugins 137, .github/ci 134, lib:node 67, app:exam 51, lib:client 38, .agents 26, lib:ledger 19, lib:access 13, app:e2e 12, prog:pipeline 7, prog:tezgah 7, lib:permissions 4, app:top 3, prog:counter 3, lib:tasks 2, tuval 2, prog:checklist 2, lib:transport 1, prog:inbox 1 | 529 | judgment | Opus | tests, build, review |
| E37 | now | `preferEffectString` | .agents 515 | 515 | judgment | Opus | one agent (lead tooling) |
| E38 | now | `preferSchemaOverJson` | app:src 91, lib:node 80, app:e2e 73, .agents 23, app:exam 18, lib:transport 15, prog:pipeline 15, lib:processes 14, lib:client 10, app:top 6, lib:telemetry 6, lib:access 5, lib:codehost 4, lib:settings 3, lib:tasks 3, prog:tezgah 3, .github/ci 2, lib:desktop 2, prog:checklist 2, prog:inbox 2, lib:ledger 1, prog:chaos 1 | 379 | judgment | Opus | tests, build, review |
| E39 | now | `schemaSync`, `schemaSyncInEffect` | app:e2e 47, prog:pipeline 37, lib:client 36, lib:settings 29, prog:chaos 29, lib:node 28, app:exam 25, lib:top 24, .agents 20, lib:access 18, prog:checklist 17, lib:transport 16, lib:packs 9, lib:desktop 8, prog:counter 7, lib:tasks 6, prog:tezgah 6, lib:tezgah 5, prog:inbox 4, lib:codehost 2, tuval 2, app:entry 1, lib:presence 1, vitest 1 | 378 | judgment | Opus | tests, build, review |
| E40 | now | `preferEffectArray` | lib:access 76, lib:tezgah 76, lib:transport 73, lib:top 31, lib:tasks 27, lib:ci 20, lib:permissions 20, lib:packs 12, lib:presence 11, prog:counter 7, lib:codehost 5 | 358 | judgment | Opus | tests, build, review |
| E41 | now | `anyUnknownInErrorContext` | prog:pipeline 138, lib:node 89, lib:telemetry 25, lib:transport 14, app:exam 13, .agents 11, prog:counter 9, app:e2e 7, lib:processes 7, lib:desktop 6, lib:top 2, lib:access 2 | 323 | judgment | Opus | tests, build, review |
| E42 | now | `nodeBuiltinImport` | oxlint-plugins 84, .github/ci 51, app:exam 50, lib:node 44, .agents 29, app:e2e 19, lib:transport 11, lib:ledger 10, lib:telemetry 8, lib:access 6, lib:gateway 3, lib:packs 2, lib:processes 2, prog:counter 2 | 321 | judgment | Opus | tests, build, review |
| E43 | now | `missingPipeableSignature` | .agents 92, .github/ci 60, app:exam 26, app:e2e 24, lib:node 13, oxlint-plugins 11, lib:tezgah 10, lib:transport 10, lib:client 9, lib:telemetry 8, lib:gateway 5, lib:permissions 5, tuval 5, lib:desktop 4, lib:tasks 4, app:src 3, lib:top 3, prog:pipeline 3, lib:access 2, prog:chaos 2, app:top 1, lib:ci 1, vitest 1, prog:checklist 1 | 303 | judgment | Opus | tests, build, review |
| E44 | now | `preferEffectString` | lib:transport 54, prog:checklist 39, tuval 37, lib:top 35, lib:desktop 32, prog:pipeline 30, prog:chaos 11, lib:codehost 10, prog:counter 10, lib:access 9, prog:tezgah 9, lib:repositories 6, app:top 4, lib:tezgah 4, lib:permissions 2 | 292 | judgment | Opus | tests, build, review |
| E45 | now | `strictBooleanExpressions` | oxlint-plugins 55, .agents 44, app:exam 36, lib:settings 17, lib:node 16, .github/ci 15, lib:client 13, lib:gateway 12, app:e2e 9, prog:pipeline 8, lib:tezgah 7, tuval 4, lib:cloudflare 3, lib:desktop 3, lib:transport 2, prog:checklist 2, lib:processes 1, lib:telemetry 1 | 248 | judgment | Opus | tests, build, review |
| E46 | now | `runEffectInsideEffect` | lib:runtime 27, lib:node 23, lib:cloudflare 21, lib:processes 15, lib:ledger 6, lib:telemetry 4, lib:gateway 3, lib:packs 3, app:e2e 2, lib:access 2, lib:presence 1, lib:tasks 1, tuval 1 | 109 | judgment | Opus | tests, build, review |
| E47 | now | `globalConsoleInEffect`, `globalConsole` | .agents 41, oxlint-plugins 30, .github/ci 20, app:src 6, app:exam 2 | 99 | judgment | Opus | tests, build, review |
| E48 | now | `globalDateInEffect`, `globalDate` | .agents 50, lib:node 12, app:e2e 11, .github/ci 4, lib:processes 4, lib:telemetry 2, lib:client 1, lib:runtime 1, lib:tasks 1, prog:tezgah 1 | 87 | judgment | Opus | tests, build, review |
| E49 | now | `processEnvInEffect`, `processEnv` | app:e2e 24, .github/ci 20, .agents 9, lib:node 9, app:top 8, lib:runtime 2, vitest 2 | 74 | judgment | Opus | tests, build, review |
| E50 | now | `strictEffectProvide` | .agents 68 | 68 | judgment | Opus | one agent (lead tooling) |
| E51 | now | `globalErrorInEffectCatch`, `globalErrorInEffectFailure` | app:src 33, lib:transport 6, lib:cloudflare 5, app:exam 4, lib:node 4, lib:gateway 2, lib:telemetry 1 | 55 | judgment | Opus | tests, review |
| E52 | now | `multipleEffectProvide` | lib:node 14, app:e2e 5, lib:access 2, lib:telemetry 2, lib:top 1, lib:processes 1 | 25 | judgment | Opus | tests, review |
| E53 | now | `missedPipeableOpportunity` | lib:access 13, app:src 2, lib:codehost 2, lib:node 2, lib:settings 2, lib:ci 1 | 22 | judgment | Opus | tests, build, review |
| E54 | now | `newPromise` | app:e2e 9, lib:cloudflare 3, lib:node 2, tuval 2 | 16 | judgment | Opus | tests, review |
| E55 | now | `deterministicKeys` | .agents 5, app:src 3, lib:top 1, lib:access 1, lib:ci 1, lib:codehost 1, lib:ledger 1, lib:processes 1 | 14 | judgment | Opus | tests, build, review |
| E56 | now | `extendsNativeError` | lib:cloudflare 2, app:src 1, lib:ledger 1, lib:node 1, lib:telemetry 1 | 6 | judgment | Opus | tests, review |
| E57 | now | `globalFetchInEffect`, `globalFetch` | .github/ci 1, app:e2e 1, lib:node 1 | 3 | judgment | Opus | tests, review |
| E58 | now | `strictEffectProvide` | oxlint-plugins 2 | 2 | judgment | Opus | tests, review |
| E59 | now | `globalTimers` | app:e2e 1, lib:cloudflare 1 | 2 | judgment | Opus | tests, review |
| E60 | after 1366 | `unstableApiUsage` | the tags left in PR 1366's 16 files, and every folder not yet locked | 3964 | mechanical | Sonnet | tests, build, review |
| E61 | after 1366 | `preferNamespaceImport` | lib:runtime 403, lib:cloudflare 250, lib:processes 174, lib:settings 127, lib:ledger 115, lib:gateway 74, lib:telemetry 72 | 1215 | mechanical | Sonnet | tests, build, review |
| E62 | after 1366 | `newSchemaClass` | lib:runtime 181, lib:cloudflare 175, lib:gateway 62, lib:processes 34, app:src 30, lib:telemetry 23, lib:settings 17, lib:ledger 15 | 537 | mechanical | Sonnet | tests, build, review |
| E63 | after 1366 | `preferTypedSchemaDecoder` | lib:runtime 43, lib:settings 41, lib:cloudflare 33, lib:gateway 12, lib:processes 7 | 136 | mechanical | Sonnet | tests, build, review |
| E64 | after 1366 | `schemaClassMissingBrand` | lib:runtime 39, app:src 8, lib:processes 8, lib:ledger 5 | 60 | mechanical | Sonnet | tests, build, review |
| E65 | after 1366 | `schemaNumber` | lib:runtime 35, lib:gateway 12, lib:cloudflare 8 | 55 | mechanical | Sonnet | tests, build, review |
| E66 | after 1366 | `instanceOfSchema` | lib:cloudflare 15, lib:processes 11, lib:runtime 9, lib:ledger 1 | 36 | mechanical | Sonnet | tests, build, review |
| E67 | after 1366 | `unnecessaryTypeofType` | lib:runtime 21, lib:cloudflare 2, lib:gateway 2 | 25 | mechanical | Sonnet | tests, build, review |
| E68 | after 1366 | `schemaStructWithTag` | app:src 9 | 9 | mechanical | Sonnet | tests, review |
| E69 | after 1366 | `unnecessaryFailYieldableError` | lib:telemetry 3, lib:runtime 2 | 5 | mechanical | Sonnet | tests, build, review |
| E70 | after 1366 | `catchConditionalRefailToCatchIf` | lib:cloudflare 5 | 5 | mechanical | Sonnet | tests, build, review |
| E71 | after 1366 | `catchToIgnore` | lib:ledger 2 | 2 | mechanical | Sonnet | tests, build, review |
| E72 | after 1366 | `nestedEffectGenYield` | lib:processes 2 | 2 | mechanical | Sonnet | tests, build, review |
| E73 | after 1366 | `effectSucceedWithVoid` | lib:runtime 1 | 1 | mechanical | Sonnet | tests, build, review |
| E74 | after 1366 | `flatMapIgnoredParamToAndThen` | lib:runtime 1 | 1 | mechanical | Sonnet | tests, build, review |
| E75 | after 1366 | `preferEffectArray` | lib:runtime 821 | 821 | judgment | Opus | tests, build, review |
| E76 | after 1366 | `preferEffectArray` | lib:processes 366, lib:settings 298, lib:cloudflare 136 | 800 | judgment | Opus | tests, build, review |
| E77 | after 1366 | `preferEffectArray` | app:src 547, lib:telemetry 142, lib:gateway 94 | 783 | judgment | Opus | tests, build, review |
| E78 | after 1366 | `asyncFunction` | app:src 424, lib:runtime 209, lib:cloudflare 149 | 782 | judgment | Opus | tests, review |
| E79 | after 1366 | `preferEffectString` | app:src 209, lib:runtime 167, lib:settings 109, lib:telemetry 94, lib:cloudflare 65, lib:processes 54, lib:ledger 33, lib:gateway 25 | 756 | judgment | Opus | tests, build, review |
| E80 | after 1366 | `strictEffectProvide` | lib:runtime 358, app:src 210, lib:cloudflare 67, lib:gateway 35, lib:settings 33 | 703 | judgment | Opus | tests, build, review |
| E81 | after 1366 | `schemaSync`, `schemaSyncInEffect` | lib:runtime 168, app:src 126, lib:cloudflare 50, lib:processes 26, lib:gateway 25, lib:telemetry 17, lib:ledger 11 | 423 | judgment | Opus | tests, build, review |
| E82 | after 1366 | `anyUnknownInErrorContext` | lib:cloudflare 153, app:src 112, lib:runtime 100, lib:settings 10 | 375 | judgment | Opus | tests, build, review |
| E83 | after 1366 | `preferEffectRecord` | lib:runtime 97, lib:settings 92, app:src 69, lib:cloudflare 35, lib:processes 29, lib:telemetry 11, lib:gateway 3 | 336 | judgment | Opus | tests, build, review |
| E84 | after 1366 | `preferSchemaOverJson` | lib:runtime 58, lib:cloudflare 57, lib:gateway 25 | 140 | judgment | Opus | tests, build, review |
| E85 | after 1366 | `preferEffectArray` | lib:ledger 123 | 123 | judgment | Opus | tests, build, review |
| E86 | after 1366 | `processEnvInEffect`, `processEnv` | app:src 97 | 97 | judgment | Opus | tests, build, review |
| E87 | after 1366 | `missingPipeableSignature` | lib:runtime 23, lib:cloudflare 21, lib:processes 20, lib:settings 18, lib:ledger 6 | 88 | judgment | Opus | tests, build, review |
| E88 | after 1366 | `nodeBuiltinImport` | app:src 66, lib:cloudflare 12, lib:runtime 8 | 86 | judgment | Opus | tests, review |
| E89 | after 1366 | `globalDateInEffect`, `globalDate` | app:src 56, lib:gateway 2, lib:settings 2 | 60 | judgment | Opus | tests, build, review |
| E90 | after 1366 | `strictBooleanExpressions` | lib:runtime 29, app:src 26 | 55 | judgment | Opus | tests, review |
| E91 | after 1366 | `missedPipeableOpportunity` | lib:cloudflare 34 | 34 | judgment | Opus | tests, build, review |
| E92 | after 1366 | `newPromise` | app:src 32 | 32 | judgment | Opus | tests, review |
| E93 | after 1366 | `deterministicKeys` | lib:cloudflare 13, lib:runtime 6, lib:telemetry 2 | 21 | judgment | Opus | tests, build, review |
| E94 | after 1366 | `multipleEffectProvide` | app:src 21 | 21 | judgment | Opus | tests, build, review |
| E95 | after 1366 | `runEffectInsideEffect` | app:src 19 | 19 | judgment | Opus | tests, review |
| E96 | after 1366 | `globalFetchInEffect`, `globalFetch` | app:src 18 | 18 | judgment | Opus | tests, review |
| E97 | after 1366 | `globalTimers` | app:src 18 | 18 | judgment | Opus | tests, review |
| E98 | after 1366 | `globalErrorInEffectCatch`, `globalErrorInEffectFailure` | lib:runtime 9 | 9 | judgment | Opus | tests, review |
| E99 | after 1366 | `lazyEffect` | lib:cloudflare 6, lib:gateway 1, lib:runtime 1 | 8 | judgment | Opus | tests, build, review |
| E100 | after E60 | `apiStabilityLeak` | recount once every tag is gone (0574) | 242 | judgment | Opus | tests, build, review |

- **Mechanical** means the checker's message names one replacement and nothing else changes: the
  checker's own quick fix (`unnecessaryArrowBlock` and the other one-line cleanups), the import
  split (0577), `@stability` removal (0574), `new X()` to `X.make()`, `Schema.Number` to
  `Schema.Finite` (pre-release, no data to keep), `instanceof` to `Schema.is`, the typed decoder,
  and the brand type argument.
- **Judgment** means each hit needs a choice: the three helper checks (an `Option` in place of
  `undefined` reaches the callers, 0565), `schemaSync` (each must handle its failure, 0576),
  `strictEffectProvide`, `asyncFunction`, and the rest.
- **Pairs** share one fix and one slice: `globalDate` and `globalDateInEffect`, `processEnv` and
  `processEnvInEffect`, `globalConsole` and `globalConsoleInEffect`, `globalFetch` and
  `globalFetchInEffect`, `schemaSync` and `schemaSyncInEffect`, `globalErrorInEffectCatch` and
  `globalErrorInEffectFailure`.
- **E1 in detail:** it deletes `@stability` from every file outside the quotas branch's 16 tagged
  files (1,067 of 1,191 tag lines), changes `oxlint-plugins/jsdocs.ts` and
  `oxlint-plugins/effect-jsdocs.ts` to stop asking for the tag, with their laws in
  `oxlint-plugins/jsdocs.test.ts` and the `oxlint-plugins/README.md` row, updates
  `.patterns/doc-comments.md`, and names each unstable Effect module in `allowedUnstableApis` with
  its reason in the body. 12,815 hits go; it locks the 15 folders that reach zero (1,376 of those
  hits). E60 does the 16 tagged files once the quotas branch is in, and makes `jsdocs` refuse the
  tag, since no file holds one by then.
- **E100** recounts `apiStabilityLeak` once no tag is left. 0574: at zero it goes on; if hits
  remain from Effect's unstable types, it stays off and those are not swept. 242 is today's count,
  tags included.

## What waits, and what clashes

**Waits: the 56 files of
[pull request 1366](https://github.com/kamp-us/tea-fabrika/pull/1366)** (the quotas branch,
`fabrikalfa/p34c-s4`), from `gh pr diff 1366 --name-only`. 31 of them hold 3,539 hits. A slice
waits when a file of that list in one of its folders has a hit of its check, or, for
`unstableApiUsage`, when the folder uses an export declared in one of them. No slice edits one of
these files before 1366 lands. The list, by folder:

- `docs/`, `experiments/`, `field/`: `docs/plan/tier-1.md`, `docs/settings-reference.md`,
  `experiments/276-p34c-walls.md`, `field/runs/2026-11-15-t404-recheck.json`.
- `next/apps/fabrika`: `person.json`, `src/local-instance.integration.test.ts`,
  `src/record-wire.test-support.ts`, `src/runtime-quotas.laws.test.ts`,
  `src/runtime-recovery.laws.integration.test.ts`, `src/worker-quotas.integration.test.ts`.
- libfabrika `src/cloudflare`: `ObjectService.test.ts`, `QuotaSettings.ts`,
  `SettingsInput.test.ts`, `alarm.laws.test.ts`, `connection.ts`, `quotas.test.ts`, `quotas.ts`,
  `runtime.ts`.
- libfabrika `src/gateway`: `Gateway.ts`.
- libfabrika `src/ledger`: `LedgerTransactionSql.ts`, `Log.ts`, `Referee.ts`, `RefereeSql.ts`,
  `WritePolicy.ts`, `WritePolicyTest.ts`, `internal/ledgerStore.ts`.
- libfabrika `src/node`: `QuotaRefusal.test.ts`, `QuotaRunner.test.ts`, `Quotas.test.ts`,
  `WritePolicy.test.ts`.
- libfabrika `src/processes`: `ProcessManager.ts`, `ProgramMail.ts`, `ProgramMailLedger.ts`,
  `Quotas.ts`, `QuotasSql.ts`, `QuotasTest.ts`, `internal/programMail.test.ts`,
  `internal/quota.test.ts`, `internal/quota.ts`.
- libfabrika `src/runtime`: `ProcessStore.integration.test.ts`, `ProcessStore.ts`,
  `QuotaRunner.ts`, `QuotaRunnerTest.ts`, `RecoveryStore.ts`, `RepliesSql.ts`,
  `Runner.integration.test.ts`, `Runner.ts`, `RuntimeCauseTest.ts`, `internal/recovery.ts`.
- libfabrika `src/settings`: `Declarations.ts`, `JsonSchema.ts`, `QuotaSettings.test.ts`,
  `Start.test.ts`, `StartsTest.ts`.
- libfabrika `src/telemetry`: `QuotaRefusalTest.ts`, `Sink.ts`.

A "now" slice may lock a folder that holds one of these files when that file has no hit of its
check. If 1366 then adds such a hit, its own rebase fixes it: that is the lock working.

**Clashes with other open pull requests.** None waits; the one that lands second rebases. A
mechanical slice redoes its fix on the new base, and the lead may fix what CI names in a test file
([0144](../../../.decisions/0144-the-lead-fixes-what-ci-names-in-a-test-file.md)).

| Pull request | With hits | Hits | Slices it meets most |
|---|---|---|---|
| [1301](https://github.com/kamp-us/tea-fabrika/pull/1301), TestDatabase | 66 | 4,812 | E1, E2, the helper slices, `strictEffectProvide` |
| [1365](https://github.com/kamp-us/tea-fabrika/pull/1365), unknown parameters | 23 | 4,086 | E1, `anyUnknownInErrorContext`, the helpers |
| [1232](https://github.com/kamp-us/tea-fabrika/pull/1232), fabsh | 31 | 3,899 | E1, the helpers, E3; it also adds a program, `next/programs/fabsh`, which E0's barrel block must cover |
| [1312](https://github.com/kamp-us/tea-fabrika/pull/1312), tezgah.new | 29 | 3,248 | E1, the helpers, E3 |
| [1099](https://github.com/kamp-us/tea-fabrika/pull/1099), agent tools | 4 | 394 | E1 |
| [1373](https://github.com/kamp-us/tea-fabrika/pull/1373), anti-slop | 8 | 342 | the `oxlint-plugins/` helper slices |
| [1381](https://github.com/kamp-us/tea-fabrika/pull/1381), error causes | 7 | 281 | E1, E2 |
| [1379](https://github.com/kamp-us/tea-fabrika/pull/1379), 1400, 1402, 1391 | 1 or 2 each | 25 to 141 | the app's helper slices; 1391 also adds an `overrides` entry for `.agents/`, a neighbor line of E0's |

## The order

1. **E0 first, alone:** it adds the law file, the ignore rule and the entry the other slices sit
   beside. Config only, so it is quick.
2. **Then the mechanical "now" slices, E1 to E25, biggest first,** up to the 12-agent cap: E1, E2
   and E3 alone take out 14,230 hits. Each touches its own entry and law row, so they run side by
   side; the merge queue serializes the shared files.
3. **Then the judgment "now" slices, E26 to E59, biggest first.**
4. **When 1366 lands:** E60 (the last tags), E61 (the last imports), the other mechanical ones,
   then the judgment ones, E60 to E99.
5. **E100 last,** after E60.

## Pipeline steps for a mechanical slice

This one plan covers every slice; the lead approves it once, and each slice's brief names its row.

- **Tests step:** writes the lock (the entry in `tsconfig.base.json` or the package tsconfig, both
  exam paths), the `LOCKED` row, L1's plant and its red output, and fixes every hit in an exam path
  (tests, test support, shared suites, the exam folder, `oxlint-plugins/`, `.github/ci/`). For a
  mechanical slice its law is the check at error, which is a `type` law, never a new test.
- **Build step:** fixes the hits in product files, and runs only when there are some. A slice whose
  hits all sit in exam paths has no build step, as the effect 4.1.3 plan
  ([effect-413-PLAN.md](./effect-413-PLAN.md)) did: there is nothing to build, so no step is
  skipped.
- **Review:** one, by Opus for every slice, since a review is judgment. It checks each hit against
  the check's named fix, each ignore line's reason, and the counts in the body.
- **What the lead may combine:**
  - Tests and build in one agent: **no decision allows it** for product code. The lead skill says
    no step is skipped and a step agent never writes another step's code, and
    [0177](../../../.decisions/0177-fix-round-is-one-agent.md) allows one agent only in a fix round.
  - An `.agents/`-only slice: one agent, merged on green, under
    [the lead tooling fast track](../../../.agents/skills/lead/SKILL.md#lead-tooling-is-fast-tracked)
    (call 5).
  - No owner read before a merge: 0168's fast track and
    [0166](../../../.decisions/0166-owed-work-needs-no-owner-read.md).
  - A red typecheck or lint in a test file after rebase: the lead fixes it under 0144.
- **Field rows:** one per step, the same day, as every hand-run step.

## Files

| File | Owner | Product lines expected | What changes |
|---|---|---|---|
| `tsconfig.base.json` | tests | tests | One `overrides` entry per check, grown a glob per slice |
| `next/packages/libfabrika/tsconfig.json` | tests | tests | E2, E61: the namespace block and its `overrides` (0577) |
| `next/packages/tuval/tsconfig.json` | tests | tests | E2: the namespace block |
| `next/packages/vitest/tsconfig.json` | tests | tests | E0: the namespace block, at zero |
| `next/programs/counter/tsconfig.json` | tests | tests | E0: the barrel block; the other five programs the same |
| `next/apps/fabrika/tsconfig.json` | tests | tests | E13: the barrel block |
| `.agents/tsconfig.json` | tests | tests | E0: the barrel block (call 2) |
| `.github/ci/tsconfig.json` | tests | tests | E0: the barrel block (call 2) |
| `.github/ci`, `.github/ci/`, `.github/ci/**/*.ts`, `.github/ci/**/*.mjs` | tests | tests | Every hit in its scripts, in each slice that lists it; the scope globs name them |
| `oxlint-plugins/tsconfig.json` | tests | tests | E0: the barrel block (call 2) |
| `oxlint-plugins/namespace-imports.test.ts` | tests | tests | E0: `git mv` to the next row |
| `oxlint-plugins/effect-checks.test.ts` | tests | tests | E0: law L2, general for any check; each slice adds its `LOCKED` row |
| `oxlint-plugins/no-bare-disable.ts` | tests | tests | E0: law L3, the checker's comment |
| `oxlint-plugins/jsdocs.ts` | tests | tests | E1: stops asking for `@stability`; E60: refuses it |
| `oxlint-plugins/effect-jsdocs.ts` | tests | tests | E1: the same, in the port |
| `oxlint-plugins/jsdocs.test.ts` | tests | tests | E1, E60: the planted blocks and laws that need the tag (0574) |
| `oxlint-plugins/README.md` | tests | tests | E1: the `jsdocs` row; each rule that gives way drops its row |
| `oxlint-plugins/service-id.ts` | tests | tests | E93: deleted with its test (0575) |
| `oxlint-plugins/`, `oxlint-plugins/**/*.ts`, `oxlint-plugins/**/*.mjs`, `stylelint.config.ts` | tests | tests | Every hit in the lint rules, in each slice that lists it; the scope globs name them |
| `fixtures/next/`, `fixtures/next/**/*.ts` | tests | tests | The app's one fixture, `p19-launchd/brain.ts`: its 6 hits go with `app:top` |
| `next/**/*.test.ts`, `next/**/*.test.tsx`, `next/**/*Test.ts`, `next/**/*.test-support.ts`, `next/apps/fabrika/src/exam/`, `next/apps/fabrika/src/exam/**`, `next/apps/fabrika/e2e/`, `next/apps/fabrika/e2e/**` | tests | tests | The 29,226 hits in exam paths, by slice |
| `next/**/*.ts`, `next/**/*.tsx`, `.agents/skills/**/*.ts` | build | 10,542 hits outside exam paths, about 1 line each for mechanical and 2 for judgment | By slice; one agent for an `.agents/`-only slice (call 5) |
| `.patterns/doc-comments.md` | build | docs | E1: its tag order and example lose `@stability` |
| `docs/plan/quests/effect-sweep-PLAN.md` | lead | docs | This plan |

## Calls I took

1. **One slice may lock several sibling folders** (85%). 0565 asks for the folder "as small as the
   code allows, so one busy folder does not hold back its clean neighbors". That is a floor, not a
   rule to cut more: each folder still gets its own glob, and a folder with a waiting file is never
   held by a clean one. 101 pull requests in place of about 400.
2. **Tooling imports `effect` from the barrel** (80%), applying 0577's principle. See "Doubts
   first".
3. **A slice in a waiting folder starts now when the waiting files hold no hit of its check**
   (85%). The brief holds the files, not their neighbors.
4. **Review is Opus for every slice, tests and build follow the slice's model** (80%). A review is
   judgment even when the fix is not.
5. **`.agents/`-only slices use the lead tooling fast track** (75%). See "Doubts first".
6. **Each check gets its own `overrides` entry** (85%), not one entry per folder, so two slices of
   different checks touch different lines and the merge queue rarely conflicts.
7. **The lock law walks real files** (80%), not glob against glob as today's import law does. It
   is slower but sees what the checker sees. If it is too slow for one test, it reads one file per
   locked glob.

## Records

- **What is lost if not written now:** each slice's per-check numbers, which 0565 makes the false
  alarm measure: the hits met, the ones fixed, each ignore line with its reason, and for the
  `schemaSync` slices how many were decodes of outside input and what failure path each got
  (0576). They go in each pull request body and its field rows, the same day.
- This count's raw output is not kept in the repo (0027). The lead may put it in the private
  archive; the totals above are enough to plan.
- No stored data, no new state, no glossary row.

## What this cannot tell us

- **What a fix breaks.** None was tried. A helper check that turns `undefined` into an `Option`
  reaches callers in other folders, maybe in a waiting file; such a hit waits with them.
- **The sizes.** Lines are 1 per hit for mechanical and 2 for judgment, a guess.
- **How many hits are false alarms.** 0565's report read 5 to 10 per check. A check that proves
  wrong for a whole class of files goes back to the owner from its slice's numbers, never to bulk
  ignore lines.
- **Main moves.** The counts are from one commit. Each slice counts again before it starts.
- **Whether the checker's directive parser takes the ` -- reason` tail.** L4 in E0 proves it
  first.

## Open questions

None.

## Size

How sure: 60% on the lines, which assume 1 line per hit for a mechanical fix and 2 for a
judgment one; 70% on the steps and dollars, priced from the averages in `field/runs/` (Sonnet
tests and build about $1 each for a slice this size, Opus tests $4.40, build $5.35, review
$3.06), with judgment slices of 800 hits priced higher, at about $18 each.

1. E0, the checks at zero: 120 lines
2. E1, `unstableApiUsage`: 1250 lines
3. E2, `preferNamespaceImport`: 992 lines
4. E3, `newSchemaClass`: 423 lines
5. E4, `schemaNumber`: 240 lines
6. E5, `preferTypedSchemaDecoder`: 200 lines
7. E6, `schemaClassMissingBrand`: 134 lines
8. E7, `unnecessaryTypeofType`: 45 lines
9. E8, `unnecessaryArrowBlock`: 30 lines
10. E9, `catchToOrElseSucceed`: 23 lines
11. E10, `instanceOfSchema`: 17 lines
12. E11, `schemaStructWithTag`: 10 lines
13. E12, `preferSucceedSomeOrNone`: 10 lines
14. E13, `preferBarrelImport`: 10 lines
15. E14, `mapMapErrorToMapBoth`: 10 lines
16. E15, `returnEffectInGen`: 10 lines
17. E16, `preferUnsafeConstructor`: 10 lines
18. E17, `unnecessaryEffectGen`: 10 lines
19. E18, `flatMapConditionalToFilterOrFail`: 10 lines
20. E19, `unnecessaryFailYieldableError`: 10 lines
21. E20, `effectSucceedWithVoid`: 10 lines
22. E21, `multipleCatchTag`: 10 lines
23. E22, `catchConditionalRefailToCatchIf`: 10 lines
24. E23, `catchToIgnore`: 10 lines
25. E24, `nestedEffectGenYield`: 10 lines
26. E25, `runOfExitToRunExit`: 10 lines
27. E26, `preferEffectArray`: 1600 lines
28. E27, `preferEffectString`: 1600 lines
29. E28, `preferEffectArray`: 1596 lines
30. E29, `preferEffectArray`: 1596 lines
31. E30, `strictEffectProvide`: 1550 lines
32. E31, `preferEffectArray`: 1478 lines
33. E32, `asyncFunction`: 1362 lines
34. E33, `preferEffectString`: 1352 lines
35. E34, `preferEffectArray`: 1322 lines
36. E35, `preferEffectArray`: 1204 lines
37. E36, `preferEffectRecord`: 1058 lines
38. E37, `preferEffectString`: 1030 lines
39. E38, `preferSchemaOverJson`: 758 lines
40. E39, `schemaSync` and its pair: 756 lines
41. E40, `preferEffectArray`: 716 lines
42. E41, `anyUnknownInErrorContext`: 646 lines
43. E42, `nodeBuiltinImport`: 642 lines
44. E43, `missingPipeableSignature`: 606 lines
45. E44, `preferEffectString`: 584 lines
46. E45, `strictBooleanExpressions`: 496 lines
47. E46, `runEffectInsideEffect`: 218 lines
48. E47, `globalConsoleInEffect` and its pair: 198 lines
49. E48, `globalDateInEffect` and its pair: 174 lines
50. E49, `processEnvInEffect` and its pair: 148 lines
51. E50, `strictEffectProvide`: 136 lines
52. E51, `globalErrorInEffectCatch` and its pair: 110 lines
53. E52, `multipleEffectProvide`: 50 lines
54. E53, `missedPipeableOpportunity`: 44 lines
55. E54, `newPromise`: 32 lines
56. E55, `deterministicKeys`: 28 lines
57. E56, `extendsNativeError`: 12 lines
58. E57, `globalFetchInEffect` and its pair: 10 lines
59. E58, `strictEffectProvide`: 10 lines
60. E59, `globalTimers`: 10 lines
61. E60, `unstableApiUsage` (after 1366): 250 lines
62. E61, `preferNamespaceImport` (after 1366): 1215 lines
63. E62, `newSchemaClass` (after 1366): 537 lines
64. E63, `preferTypedSchemaDecoder` (after 1366): 136 lines
65. E64, `schemaClassMissingBrand` (after 1366): 60 lines
66. E65, `schemaNumber` (after 1366): 55 lines
67. E66, `instanceOfSchema` (after 1366): 36 lines
68. E67, `unnecessaryTypeofType` (after 1366): 25 lines
69. E68, `schemaStructWithTag` (after 1366): 10 lines
70. E69, `unnecessaryFailYieldableError` (after 1366): 10 lines
71. E70, `catchConditionalRefailToCatchIf` (after 1366): 10 lines
72. E71, `catchToIgnore` (after 1366): 10 lines
73. E72, `nestedEffectGenYield` (after 1366): 10 lines
74. E73, `effectSucceedWithVoid` (after 1366): 10 lines
75. E74, `flatMapIgnoredParamToAndThen` (after 1366): 10 lines
76. E75, `preferEffectArray` (after 1366): 1642 lines
77. E76, `preferEffectArray` (after 1366): 1600 lines
78. E77, `preferEffectArray` (after 1366): 1566 lines
79. E78, `asyncFunction` (after 1366): 1564 lines
80. E79, `preferEffectString` (after 1366): 1512 lines
81. E80, `strictEffectProvide` (after 1366): 1406 lines
82. E81, `schemaSync` and its pair (after 1366): 846 lines
83. E82, `anyUnknownInErrorContext` (after 1366): 750 lines
84. E83, `preferEffectRecord` (after 1366): 672 lines
85. E84, `preferSchemaOverJson` (after 1366): 280 lines
86. E85, `preferEffectArray` (after 1366): 246 lines
87. E86, `processEnvInEffect` and its pair (after 1366): 194 lines
88. E87, `missingPipeableSignature` (after 1366): 176 lines
89. E88, `nodeBuiltinImport` (after 1366): 172 lines
90. E89, `globalDateInEffect` and its pair (after 1366): 120 lines
91. E90, `strictBooleanExpressions` (after 1366): 110 lines
92. E91, `missedPipeableOpportunity` (after 1366): 68 lines
93. E92, `newPromise` (after 1366): 64 lines
94. E93, `deterministicKeys` (after 1366): 42 lines
95. E94, `multipleEffectProvide` (after 1366): 42 lines
96. E95, `runEffectInsideEffect` (after 1366): 38 lines
97. E96, `globalFetchInEffect` and its pair (after 1366): 36 lines
98. E97, `globalTimers` (after 1366): 36 lines
99. E98, `globalErrorInEffectCatch` and its pair (after 1366): 18 lines
100. E99, `lazyEffect` (after 1366): 16 lines
101. E100, `apiStabilityLeak` (after E60): 484 lines

Estimate: 300 steps, $1400

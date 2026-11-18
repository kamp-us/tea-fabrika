Approved by the lead agent, builds 0086, 0411, 0579, 0585; body 79cc605e5cae
Plancheck-Version: 3

# Plan amendment: keep settings errors and strengthen the generic loader laws

This amends ticket 1076, slice 1, in `next/`, at head
`037c7466683fa67a931690afce4b3029ad21cbbb` of
[PR 1427](https://github.com/kamp-us/tea-fabrika/pull/1427).
The approved `docs/plan/quests/kalfa-config-PLAN.md` still governs everything outside this amendment.
It replaces K4 and K5 below and the runner form of the seven new properties in `App.test.ts`.
It preserves the original F1 amendment and all earlier coverage. Slices 2 and 3 stay separate.

```ts
// Sketch of the existing result, not a new product type.
type Refusal = "version" | "invalid";
interface EarlyRefusal {
  readonly reason: Refusal;
  readonly reads: ReadonlyArray<string>;
}
// A refused repo minimum produces this result before any person-file read.
// A scalar rejected at a declared setting appears in its invalid-value message, as S5 requires.
```

## Settled behavior and evidence

- `docs/direction/settings.md`, S5 and "The oldest fabrika a repo's file works with", requires
  invalid-value errors to show the scalar and requires the repo minimum to be checked first.
  Decision 0086 carries both rules into `next/`. This amendment applies those existing rules.
- Decision 0579 requires `it.prop` or `it.effect.prop`, Schema inputs and a seed in setup.
  Decision 0411 requires the moved properties to keep their size, runs and coverage.
- At the named head, generic `settings/Load.ts` reads the repo, calls `Files.supported`, then
  reads the person file. K4 currently calls only `Files.validate`, so deleting the first check
  escapes it. The product already has the required behavior.
- `Files.ts` shows a scalar refused at a declared leaf, replaces arrays and tables with their
  shape, and omits values from unknown-key and table-of-settings messages. `Sources.ts` uses
  the same invalid-value error for environment and flag inputs. K5 must name that distinction.
- The seven new property declarations use `fc.assert` and one file-local seed. Their domains,
  explicit examples, output checks and recorded plants remain required after the runner change.
- Discovery used `records.ts find` for settings errors/version, minimum/unknown, property
  inputs/Schemas and property seed/runner. Searches of the settings note and the branch code
  supplied the exact rules above. The search's unrelated hits decide none of these questions.

## How others do it

Effect's installed `@effect/vitest` 4.1.3 already offers Schema inputs through `it.prop` and
`it.effect.prop`. Its `src/internal/internal.ts` compiles them with `Arbitrary.schema` and gives
each Effect case its own scope. `effect` 4.1.3's `src/Arbitrary.ts` exports `configureGlobal` with
`check.seed`. This is the supported runner; no wrapper is needed.

Installed versions checked in the lockfile and package files are Effect and `@effect/vitest`
4.1.3, Vitest 5.0.5, fast-check 4.10.2 and tea 0.27.0. The older tea 0.25.0 patch is unrelated.
No dependency changes are needed. The installed Effect `AGENTS.md` was read in full.

Elm and OTP add no machine here. Settings load at the edge, before a machine starts, as S6 says.
The observable boundary is Effect's `FileSystem` service. Its in-memory layer and the existing
Recorder can prove which file was read without real files, processes or sockets.

The toolbox rename to `@kalfa/vitest` stays in 0585's later package move. On this slice's installed
packages, the runner remains available from `@effect/vitest`, and `Recorder` and `runsFor` from
`@kampus/vitest`. This amendment adopts 0579's runner now without inventing that later package.

## The shape

There is no product API, schema, state or protocol change. Test inputs use Effect Schema.
Reuse `App.Name` for valid names and the existing setting schema for valid values. Define test-only
Schemas for the generated pair, paths, source choices, version triples and hostile strings.
Relations between fields must still enforce distinct app names, independent sections and matching
path/value lengths. Keep invalid-name categories and valid names in the generated domain.

Use `it.prop` for the two synchronous K3 properties. Use `it.effect.prop` for K1, both K2
properties, K4 and K5. The load helper returns an Effect instead of calling `Effect.runPromise`.
Each case allocates its own in-memory files and call record. Use the existing Recorder to inspect
`FileSystem.readFileString`; do not add a spy, custom runner or mutable record shared across cases.

Keep 25 fast and 100 full cases through `runsFor`, passed as `arbitrary.runs`. K5 keeps every one
of its seven placements with both readable and unreadable person files on every generated case.
The runner must not randomly omit a placement. Keep the `kalfa`/`fabrika` examples, both home
branches, invalid-name categories, and own/foreign older/newer version categories. A pinned
companion case may preserve an explicit example when the installed runner has no `examples`
option. It supplements the generated property and carries its required reason label.

Move the fixed seed `119120` to the existing workspace setup, `scripts/vitest.setup.ts`, which
already runs before this package's laws. Configure `fc.configureGlobal({ seed })` and
`Arbitrary.configureGlobal({ check: { seed } })` there from the same constant. Keep the existing
home setup unchanged. There is no per-law seed, per-case global reset, new lifecycle hook, new
timer or new test project. The future toolbox move can relocate this shared setup with its own plan.

Before converting, capture each existing plant's first failing input privately. After converting,
reproduce that input through the new runner and run the same plant against the generated law.
A different generator algorithm is not evidence that the old counterexample still fails. Preserve
it explicitly, along with the original domain bounds, source choices and output assertions.

## One value traced

1. Generate app `kalfa`, running version `1.2.3`, and a repo minimum `1.3.0`.
2. Put that minimum and an unknown key in `.kalfa/kalfa.toml`. Give the person-file read a typed
   permission error in the in-memory `FileSystem` layer.
3. Call the generic `Load.load`, rather than fabrika's wrapper. It returns reason `version`, with
   the app and both versions in the message. Its call record contains the repo read and no person read.
4. Replace the minimum with malformed text. The result is `invalid`, at the version key, before
   the unknown key and still without a person read. Repeat both home-location branches.
5. Separately, put a generated refused string at a declared scalar setting through a file, the
   environment and a flag. Each error names its source and key and shows the scalar as S5 requires.
   K5's non-disclosure checks still cover the unrelated and structural placements listed below.

## Laws

These replace K4 and K5 and add the runner conversion checks for this repair. Every runtime law
uses 25 fast runs and 100 full runs. A plant is run once, recorded, reverted and never committed.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| K4, the generic loader checks its own minimum first. A generated newer minimum returns `version`; a malformed minimum returns `invalid`. Both name the own app/version key as appropriate, precede an unknown repo key and a broken person file, and leave the person file unopened, for default and overridden homes. Equal/older/absent own minima still read the person file. Keep the existing foreign-version unknown-key cases and both older/newer categories. | test | Effect Arbitrary: VersionCase | Delete only the early `Files.supported` in generic `Load.load`, leaving `Files.validate` intact: the new cases fail as `read` or record a person-file read. Keep the original plant that reads `fabrika-version` for another app. | next/packages/libfabrika/src/settings/App.test.ts |
| K5 [secrets], foreign app values never reach the own app's values, errors, snapshot or report. Refused arrays/tables, a scalar where a settings table belongs, and unknown-key values also stay absent. Inspect raw, JSON-escaped and URL-encoded forms in every currently named output. Run all seven placements with readable and unreadable person files. This excludes the scalar displayed in an invalid-value error at a declared scalar setting, required by S5. | test | Effect Arbitrary: HiddenCase | Print the whole environment in a `read` error; print the rejected table's contents; print the scalar at a settings-table path; or print an unknown key's value. Each respective branch must fail. | next/packages/libfabrika/src/settings/App.test.ts |
| K5-display, a refused scalar at a declared setting remains visible. Generated invalid strings in a file, an environment variable and a flag return `invalid` with the key, source and displayed scalar. The file case names its line. No successful values or snapshot are produced. | test | Effect Arbitrary: ScalarCase | Replace the declared scalar's shown value with a placeholder in `Files.refused` or its source caller: the corresponding display case fails. | next/packages/libfabrika/src/settings/App.test.ts |
| R1, the seven properties keep their original input reach, exact assertions, mandatory examples and recorded plants while moving to the supported runner. F1's old law bodies keep their existing protection, including the one exact app-field addition already approved. | test | scenario: compare the seven old declarations and plants with their replacements, then replay their captured failing inputs and run each original plant | Drop a required foreign-source, home, invalid-name or readable structural-refusal case: its corresponding original plant must escape and the coverage comparison rejects the change. | next/packages/libfabrika/src/settings/App.test.ts |

K5's exception corrects an overbroad plan promise. It removes no previously asserted case:
the old K5 did not generate a scalar at a declared scalar leaf. K5-display adds that missing
case with S5's positive display assertion. The existing `a-scalar` placement is a scalar at a
table path and remains protected. No product error text changes to satisfy this amendment.

No law requires the real machine. All new behavior is checked through in-memory service layers.
Existing scheduled integration laws remain unchanged. No missing remote proof is claimed complete.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/settings/App.test.ts | tests | tests | Convert seven properties and their test-only helpers; extend K4; preserve K5 and add scalar-display coverage. |
| scripts/vitest.setup.ts | tests | tests | Configure both installed property engines once with the shared fixed seed; preserve home setup. |
| docs/plan/quests/kalfa-config-PLAN.md | lead | docs | After approval, retain the original plan and append these replacement laws, runner requirements and repair ownership. |

All original file ownership remains in force. This repair authorizes no edits to old F1/F2 law
bodies, product code, layer rules, lint configuration, timeouts, dependency versions or later slices.

## Existing tools

- Searched the installed `@effect/vitest` source and Effect `Arbitrary` API. Their property runner,
  Schema compilation, scopes, global check defaults and replay support cover this work.
- Searched `next/packages/vitest/src/Recorder.ts`. Its typed `layer` and `calls` cover file-read
  observations and typed read failures. Reuse it instead of adding a call-watching helper.
- Searched the current `App.test.ts` helpers. Adapt the existing load helper to return Effect;
  retain its input files and named outputs. Existing Schema constructors cover the input shapes.
- Searched `scripts/vitest.setup.ts` and the root test configuration. There is one existing
  workspace setup and no package-specific setup. Add the seed there instead of creating a helper,
  hook, test project or new setup file.

## Calls taken

- Apply S5's scalar display rule and preserve the seven structural/foreign placements. Confidence
  100%. The settings note decides this; hiding declared scalar values would reverse it.
- Test the generic loader with an unreadable person file and inspect reads through Recorder.
  Confidence 99%. A reason-only assertion would miss an unwanted read that happens to recover.
- Keep the existing shared setup as the one seed owner. Confidence 90%. It matches today's test
  configuration and avoids a new setup path or project. Its edit selects broad CI coverage, so the
  lead uses narrow local tests and lets CI carry that selection.
- Use the installed runner imports until the separately planned toolbox move. Confidence 99%.
  The runner is already available; renaming the package here would change the approved slice order.
- Is this a setting? No. The seed and input categories are reproducible test data; no new product
  choice, persisted value or setting is introduced.

## Validation

The plan worker runs only draft checking and its leak check. The tests/fix worker runs format
first, then lint and the narrow `App.test.ts` path with `nice -n 19` and `--maxWorkers=1`.
Use fast depth while converting and full depth for the final narrow run. Run and record every
named plant once, including removal of only the generic loader's early check. Preserve old plant
evidence and record the new K4 and display cases separately. Do not weaken an assertion to match
the generator or raise a timeout.

The lead runs one typecheck when the global slot is free. Because a setup change reaches broad
test selection, the lead uses the narrow changed test path locally and relies on ordinary CI
for the broader selection, as the machine caps require. No local full suite, host law or proof
workflow is needed for these new in-memory laws. A fresh review checks the repaired whole diff,
the old-to-new law mapping and actual plant results before merger handles landing.
The reviewer also checks the seven declarations directly for the required runner and Schema
inputs, and verifies that no raw `fc.assert`, hand-run asynchronous property, local seed or custom
runner remains. This amendment claims no new lint rule for that check.

## Size

1. Repair slice, about 0 product lines, 180 to 260 changed test lines and about 5 setup lines.
   It lands whole: the seven properties use the supported runner and K4/K5 match the decided rules.

About 1.5 agent hours, 80% confidence. The input conversion is the uncertain part. Budget uses
the original plan's roughly $5 per step basis, from its cited field rows. This repair needs a
tests/fix step and review, with one possible further fix. The original three-slice budget stays
in the original plan; this standalone amendment gives only the remaining repair budget.

Estimate: 3 steps, $15

## Records

The tests/fix report and field row retain each old plant's evidence and add the generic-loader
and scalar-display results. The lead saves the plan and review evidence with ticket 1076.
Lost if not recorded now: the exact failing inputs and whether each changed law caught its plant.
No new runtime fact, setting record, public decision, glossary word or product output is added.

## What this cannot tell us

This read-only amendment proves no test or plant result. The new coverage must run in the next
step. It does not establish an exact-head unit run for the reviewed commit or a later repair head.
It does not implement the future `@kalfa/vitest` package move.

## Open questions

None.

## Findings

None.

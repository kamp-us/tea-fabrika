Approved by the lead agent, builds 0600; body 69d77d25e2b5
Plancheck-Version: 3

# Plan: @kalfa/quality/stryker, the plant runner on Stryker, and libfabrika's laws in the hourly mutation run (decision 0600's first build; ticket to be filed)

This is our tooling: a new package in `kalfa/quality/`, the repo's plant catalog in `.github/ci/plants.ts`,
and one change to today's lead tooling for the hourly mutation run. `next/` product code and
today's product code are not touched. One pull request, in two slices (lead amendment). Slice 1 is
the plant runner. Slice 2 is the hourly scope change.

```ts
// The whole idea, a sketch. A plant names its mutant by code shape; Stryker makes it, runs the
// named law's file against it, and its report says which tests killed it.
import { plant } from "@kalfa/quality/stryker";

export default [
  plant({
    name: "host-pnpm-path",
    file: ".agents/skills/lead/scripts/boxnode.ts",
    mutator: "ConditionalExpression", // Stryker's own mutator name
    original: "pnpm === null",        // the node's own text, whitespace folded
    replacement: "true",              // what Stryker puts there
    law: {
      file: ".agents/skills/lead/scripts/flow/host.test.ts",
      name: "the host step's outcomes > scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    },
  }),
];
// $ node .github/ci/plants.ts stryker plant host-pnpm-path
// {"plant":"host-pnpm-path","answer":{"_tag":"killed","by":[<the law>]},"target":{"line":133,...}}
// Not found, or found twice: it fails before Stryker starts, naming every place it looked.
```

## Doubts first (owner away; each below 80%)

- **The test name Stryker writes for a vitest 5 test, 70%.** Stryker 10.1.1's vitest runner joins
  the suite chain and the title with `" > "` for vitest 5 and later (`collectTestName` and
  `VITEST_MODERN_TEST_NAME_SEPARATOR` in its `dist/src/test-helpers.js`). Whether the chain also
  carries the file task's own name is not proven by reading. The integration law Q11 captures a
  real report once, and law Q5 pins its form as a `vector:` fixture. If the form differs, the
  catalog's `law.name` strings change in the same step; nothing else does.
- **checklist-pid's Stryker mutant, 75%.** The old case dropped one property (`{ ...update }`).
  No Stryker mutator drops one property; the nearest is ObjectLiteral, which makes the whole
  object `{}`, so the update is lost with the pid. The old run's accepted failure was "the client
  heard the checklist's views: expected 0 to be greater than 0", so the views never reached the
  client even with only the pid gone. `{}` should fail the same assertion. The tests step runs
  it on CI before the build. If the law does not kill it, the case leaves the catalog and goes to
  the owner as a question, as the brief asks, never as a hand edit.
- **Integration laws inside the mutation container stay under run.sh's 300 s cap, 60%.** Slice 2
  lets the hourly run start `.integration.` laws in its container on CI. One slow law file could
  push a run to `stuck time_limit`, which fails the hourly job. The first runs after slice 2 lands
  measure it; a raised cap needs its own number from those runs.

## What changes, in one paragraph

The hand-written plant runner (`.github/ci/plant.ts` and its four neighbors, ticket 1133) pins
each target by sha256 and by commit, and it broke on a squash merge and on two blank lines.
Decision 0600 moves plants onto Stryker. Slice 1 adds `@kalfa/quality` with one subpath,
`/stryker`: a plant names a product file, a Stryker mutator, the node's text and Stryker's
replacement, and the law (test file and full name) that must kill it. The runner asks Stryker's
own instrumenter for every mutant in the file, keeps the one that matches the shape, and fails
loudly unless exactly one does. Then it runs Stryker on that one place against the law's file
alone, with bail off, and reads which tests killed the mutant from the JSON report's `killedBy`
and `testFiles`. The five product-code cases that have a Stryker mutant move to a catalog in
`.github/ci/plants.ts`; the ten that edit a test file's own fake are dropped (0093, 0600). The
old runner stays: lane 1569 holds it, and it is deleted once these run. Slice 2 lets the hourly
mutation run reach libfabrika's laws: it picks a changed file's `name.<kind>.test.ts` siblings,
not only `name.test.ts`, and passes CI's own `CI` marker into its container so `.integration.`
laws pass the host guard there.

## Searched first

- `.decisions/0600` (whole), 0585, 0066, 0067, 0069, 0089, 0093, 0104, 0536, 0557, 0579, 0580,
  0591, 0594, 0045, 0040, 0587; `records.ts find` for "plant runner stryker code shape", "hourly
  mutation libfabrika related tests", "integration tests mutation container", "plant catalog
  where cases live" and "kalfa cli command tree". Nothing settles the catalog's place or the
  hourly pick beyond 0600 and 0089.
- The pipeline's driver, `packages/pipeline/src/stages/mutation/stryker.ts`, with `ignorer.ts`,
  `mutant.ts`, `services.ts` and `stryker.test.ts`. It reads only each mutant's `status`. Its
  `exactly()` builds a one-mutant `mutate` range, but it never chooses test files and never reads
  `killedBy`, so 0600's line that it "reads which test killed it" is true of Stryker, not of the
  driver. The new runner adds both.
- The old runner and its 16 cases, to learn the jobs; the hourly run (`scope.ts`, `run.sh`,
  `mutbox.ts`, `mutbox-entry.sh`, the mutation workflow); the host guard (`vitest.hostrun.ts`).
- Installed versions in `pnpm-lock.yaml`: `@stryker-mutator/core`, `instrumenter` and
  `vitest-runner` 10.1.1 (exact, in the catalog), `mutation-testing-report-schema` 3.8.4,
  `vitest` 5.0.5, `effect` and `@effect/vitest` 4.1.3. Every Stryker fact below was read in
  those packages under `node_modules/.pnpm/`.
- `kalfa/config` on the stack branch (pull request 1583) as the shape of a kalfa package: private,
  ESM, per-module `exports`, `effect` as a peer, `rslib` build, its own `tsconfig.json`.
- On `main` (b0e55290): no `kalfa/` folder, no `kalfa/*` workspace line, and the root vitest
  config's include globs and CI's path routing do not reach `kalfa/`. Pull request 1589 adds that.

## How others do it

- **Stryker itself** (read in the installed 10.1.1). A `mutate` entry may carry a line and column
  range (`file:12:4-12:17`), and only mutants inside it are made. `testFiles` (in
  `@stryker-mutator/api`'s `stryker-core.json` schema) limits a run to chosen test files.
  `disableBail` runs every covering test, so `killedBy` names all killers, not the first. The JSON
  report (`mutation-testing-report-schema` 3.8.4) gives each mutant `killedBy` and `coveredBy`
  as test ids, and a top-level `testFiles` record that maps each test file to its tests, each
  `{ id, name, location }`. Core remaps test ids to `"0"`, `"1"` and so on before it writes the
  report (`mutationTestReport` in `dist/src/reporters/mutation-test-report-helper.js`), so a
  reader must look `killedBy` up in `testFiles`; the raw id is never a name.
- **cargo-mutants** names a mutant by what it does in words ("replace foo -> bool with true") and
  filters with `--re` over those names, not by position. That is the same idea as naming by code
  shape. From memory of its docs, not fetched for this plan.
- **PIT** (Java) picks mutants by `targetClasses` and tests by `targetTests`; Stryker's `mutate`
  and `testFiles` are the same pair. From memory, not fetched.
- **Elm and OTP.** No answer needed: a plant run is a one-shot Effect program with no stored
  control state, so 0037 and 0046 (explicit machines) do not apply. The old runner's tea machine
  tracked baseline, broken and restored phases; Stryker owns making and undoing the mutant now.
- **drizzle-orm** ships one driver per subpath with each driver an optional peer dependency
  (0600 cites it). `@kalfa/quality` lists the three Stryker packages the same way.

## The shape

### The package

```text
kalfa/quality/
  package.json         @kalfa/quality, private; exports ./stryker, ./stryker/Run, ./cli
  README.md
  tsconfig.json
  src/
    cli.ts                       the `quality` effect/cli Command: `stryker plant`, `stryker survey`
    cli.types.test.ts
    stryker/
      index.ts                   ./stryker: re-exports Plant only. Importing it loads no Stryker
      Plant.ts                   Plant, Catalog, plant(): Schemas, nothing that runs
      Settings.ts                the settings, each one Effect Config with its default
      Target.ts                  pure: find exactly one mutant by shape
      Options.ts                 pure: the Stryker options for one target
      Report.ts                  pure: read the JSON report, decide the answer, the record
      Mutants.ts                 the service contract: make mutants, run Stryker (0095)
      MutantsMemory.ts           the stand-in layer the PR laws run on
      node/MutantsStryker.ts     the real layer: Stryker's instrumenter and its bin
      Run.ts                     ./stryker/Run: plant(name) and survey(...)
```

No root export: 0600 puts at the root only what two subpaths share, and there is one subpath. No
file imports libfabrika, `@kampus/*` or a path into `next/` (law Q8).

```jsonc
// kalfa/quality/package.json, a sketch.
{
  "name": "@kalfa/quality", "private": true, "type": "module",
  "exports": { "./stryker": "./src/stryker/index.ts", "./stryker/Run": "./src/stryker/Run.ts", "./cli": "./src/cli.ts" },
  "kalfa": { "cli": "./cli" },
  "peerDependencies": {
    "effect": "catalog:",
    "@stryker-mutator/core": "catalog:", "@stryker-mutator/instrumenter": "catalog:", "@stryker-mutator/vitest-runner": "catalog:"
  },
  "peerDependenciesMeta": {
    "@stryker-mutator/core": { "optional": true }, "@stryker-mutator/instrumenter": { "optional": true },
    "@stryker-mutator/vitest-runner": { "optional": true }
  },
  "devDependencies": { "the same three, effect, @effect/vitest, @effect/platform-node, vitest, fast-check, typescript": "catalog:" }
}
```

### A plant, and what a run answers

```ts
// kalfa/quality/src/stryker/Plant.ts, a sketch. Nothing here imports Stryker.
export const Law = Schema.Struct({
  file: Schema.String,  // repo-relative test file
  name: Schema.String,  // the suite chain and title, joined with " > ", as Stryker writes it
});

export const Plant = Schema.Struct({
  name: Schema.String,          // "host-pnpm-path": what a person types
  file: Schema.String,          // repo-relative product file
  mutator: Schema.String,       // Stryker's mutatorName: "ConditionalExpression"
  original: Schema.String,      // the mutated node's text, compared with whitespace folded
  replacement: Schema.String,   // Stryker's replacement text, folded the same way
  within: Schema.optional(Schema.String), // a snippet found once in the file that holds the node
  law: Law,
});
export const Catalog = Schema.Array(Plant); // names unique: a check in Schema, refused at decode
export const plant = (input: typeof Plant.Encoded): Plant => Schema.decodeSync(Plant)(input);
```

```ts
// kalfa/quality/src/stryker/Report.ts, a sketch: the answer once Stryker ran.
export const Test = Schema.Struct({ file: Schema.String, name: Schema.String });

export const Answer = Schema.TaggedUnion({
  killed: { by: Schema.Array(Test) },     // the law is among `by`: the plant holds
  elsewhere: { by: Schema.Array(Test) },  // killed, but not by the law
  survived: {},
  no_coverage: {},                        // no test of the law's file reached it
  timeout: {},                            // Stryker's Timeout: red, but no test named
  error: { status: Schema.Literals(["CompileError", "RuntimeError"]) },
  not_run: {},                            // the report holds no mutant at the target
});

// What fails before Stryker starts, each loud, each naming what it looked at.
export class Refused extends Schema.TaggedErrorClass<Refused>()("Refused", {
  reason: Schema.Literals(["unknown_plant", "not_found", "ambiguous", "within_not_once", "needs_in_place", "could_not_run"]),
  at: Schema.Array(Schema.Struct({ line: Schema.Int, column: Schema.Int })), // every match, for ambiguous
}) {}
```

`elsewhere`, `survived`, `no_coverage`, `timeout`, `error` and `not_run` all exit 1. Only
`killed` exits 0. A `timeout` is red but names no test, so it never proves the named law.

### Finding the target by shape

`Target.find(text, made, plant)` is pure. `made` is every mutant Stryker's instrumenter makes on
the whole file (the same `Instrumenter.instrument` call the pipeline driver makes, with no
`mutate` ranges, so every mutant is listed). For each one it slices the node's own text from the
file, folds every run of whitespace to one space, and keeps those whose mutator, folded original
and folded replacement all equal the plant's. With `within`, the snippet (folded) must occur once
in the folded file, and the mutant's span must sit inside it. Exactly one left: found, with its
line and column. None: `not_found`. Two or more: `ambiguous`, with every place. No byte or commit
is pinned, so a blank line or a re-indent anywhere leaves the answer the same (law Q3).

### The Stryker options for one plant

```ts
// Options.make(target, plant, settings, temp), a sketch of what it returns.
{
  testRunner: "vitest",
  plugins: ["<resolved @stryker-mutator/vitest-runner>"],
  mutate: [".agents/skills/lead/scripts/boxnode.ts:133:76-133:88"], // lines from 1, columns from 0
  testFiles: [".agents/skills/lead/scripts/flow/host.test.ts"],
  disableBail: true,             // every killer, not the first
  coverageAnalysis: "perTest",
  reporters: ["json"], jsonReporter: { fileName: "<temp>/report.json" },
  inPlace: false, concurrency: 1, timeoutMS: 60_000, ignorePatterns: [".claude", "runs"],
  tempDirName: "<temp>/sandbox", cleanTempDir: "always",
  tsconfigFile: "<temp>/absent.json", // Stryker reads a tsconfig with TypeScript's JS API, which TypeScript 7 lacks
  vitest: { related: false },          // testFiles picks the files; vitest's own related search would narrow them again
}
```

The range covers the target node only, but Stryker makes every mutant inside it (for
`pnpm === null`, both `true` and `false`, and the EqualityOperator `!==`). The report holds all of
them; the answer reads only the one whose place, mutator and replacement match the target. The
others cost a few seconds and are recorded as `beside`.

### When a plant needs `inPlace`

Stryker's sandbox copies the repo and links each `node_modules` back to the checkout, so a test
that reaches a target through a workspace package link reads the unmutated file (the hourly run
met this as ticket 457, and `run.sh` mutates in place for it). The runner finds the nearest
`package.json` above the target and above the law file. If they differ and `inPlace` is off, the
run is refused as `needs_in_place` before Stryker starts, naming the setting. checklist-pid is
such a plant: its law is in `next/apps/fabrika`, its target in `next/packages/libfabrika`.

### Settings (0069, 0585)

Each is one Effect `Config` with its Schema and its one default, under `quality.stryker`, so the
environment name is `KALFA_QUALITY_STRYKER_<KEY>`. No `FABRIKA_` name and no `~/.fabrika` path.

| Setting | Schema, default | Why a setting |
|---|---|---|
| `catalog` | a path; no default, and a run without one fails naming `KALFA_QUALITY_STRYKER_CATALOG` | the module that lists our plants is ours; no repo path in the package |
| `concurrency` | Int, 1 or more; 1 | a number; one mutant place per run, and other work shares the machine |
| `timeout` | Int milliseconds, 1 or more; 60000 | a number; Stryker's `timeoutMS`, the driver's value and the repo's own test limit |
| `inPlace` | Boolean; false | a pick between two paths Stryker has; false is Stryker's own default and safe on a person's checkout |
| `ignore` | array of patterns; empty | Stryker's `ignorePatterns`; ours are `.claude` and `runs` |
| `vitest` | optional path; none, which means vitest's own search | a pick of a path |
| `nice` | Int 0 to 19; 0 | a number; ours is 15 (AGENTS.md's caps); 0 means no `nice` prefix |

Not settings, and why: `disableBail`, `coverageAnalysis: "perTest"`, the one `mutate` range and
`testFiles` are what makes a plant answer at all, not a pick a person makes; the report path and
the sandbox folder are a scoped temp folder, a resource, not a choice; the absent tsconfig is
TypeScript 7's limit, not a choice; the working folder is where the command runs.

How the values reach a run today, on `main`, where `@kalfa/config` does not exist:

```ts
// .github/ci/plants.ts (the edge), a sketch. Order as 0086: environment, then the repo's
// values, then each Config's default. No machine reads a file; the edge hands values in.
const repo = ConfigProvider.fromUnknown({
  quality: { stryker: { catalog: import.meta.filename, nice: 15, ignore: [".claude", "runs"] } },
});
const env = ConfigProvider.fromEnv().pipe(ConfigProvider.constantCase, ConfigProvider.nested("KALFA"));
ConfigProvider.orElse(env, () => repo); // a sketch of the composition; the build checks the API
```

What joins when `@kalfa/config` lands (pull request 1583), in its own small change: each Config
becomes a `Kalfa.Setting.make("quality.stryker.<key>", { schema, default, doc, scope, reload,
since })`, so the generated reference page and JSON Schemas list them; the repo file
`.kalfa/kalfa.toml` and the person file `~/.kalfa/kalfa.toml` become providers; the
`--quality.stryker.<key>` flags come with `Load`; and the repo's three values move from the edge
into `.kalfa/kalfa.toml` under `[quality.stryker]`. What a person lacks until then: the two files
and the flags. Every setting can still be set through its `KALFA_` variable, so nothing a person
needs is missing.

### How a person runs one plant

```sh
# On disposable CI, once plants.yaml is on main (GitHub dispatches only a workflow the default
# branch holds); --ref then picks the branch whose code it runs:
gh workflow run plants.yaml --ref <branch> -f plant=host-pnpm-path
# Where the host guard allows (CI, a cloud box, or the owner's named yes), from the repo root:
node .github/ci/plants.ts stryker plant host-pnpm-path --out runs/plants/host-pnpm-path.json
# To find a shape for a new plant: every mutant on some lines, with its status and its killers.
node .github/ci/plants.ts stryker survey .agents/skills/lead/scripts/boxnode.ts --law .agents/skills/lead/scripts/flow/host.test.ts --from 120 --to 135
# Later, once @kalfa/cli exists and finds the package's `kalfa.cli` field (0585):
kalfa quality stryker plant host-pnpm-path
```

The package's `./cli` export is an `effect/cli` `Command` named `quality`, as 0585 asks, with
`stryker plant <name>` and `stryker survey <file> --law <file> [--from n] [--to n]`, each with
`--out <file>`. It reads the `catalog` setting and loads that module with one dynamic `import`,
a marked Promise edge. `.github/ci/plants.ts` is the repo's catalog and, when run, its edge: it
runs the repo's own host guard (`hostFiles` from `vitest.hostrun.ts`; the CI scripts already import
root files by relative path) on the plant's law file, refuses with the same 0594 message the
vitest guard prints, then supplies the repo's settings and runs the package's `Command`. The
guard stays in the repo: it is ours, so it is not baked into the package. 0585 says CI calls
`kalfa ...`, never a `.ts` script; until `@kalfa/cli` exists there is no `kalfa` to call, and the
script entry goes when it does.

### The catalog: which old cases move, and as which Stryker mutant

Counted in `.github/ci/plant-cases.ts`: 16 cases. Six plant into product code: `checklist-pid`
edits `next/packages/libfabrika/src/cloudflare/runtime.ts`, and five edit today's lead tooling
source (`flow/host.ts` three times, `boxnode.ts` twice; a `.agents/skills/lead/scripts` file that
is no test is source, not a test file). Ten edit a test file: `watcher-r1` edits
`watch.laws.integration.test.ts`, and the nine `checklist-*` cases other than `checklist-pid` edit
the checklist law file. 0600 says 5 and 11: it counted `checklist-pid` with the checklist cases,
as `plant-related.ts` does when it takes every key that starts with `checklist-`. By file, it is
6 and 10. Each target text below occurs once in its file on main (counted with `grep -c`).

| Old case | Old edit | Stryker mutant: mutator, original, replacement | Same fault? | Killed by the law? |
|---|---|---|---|---|
| checklist-pid | drop `pid: active` from `{ ...update, pid: active }` | ObjectLiteral, `{ ...update, pid: active }`, `{}` | wider: pid and update both dropped | likely, 75% (doubt above); needs `inPlace` |
| host-pin | `boxEnv(...)` becomes `Effect.succeed({ ...process.env, ...env })` | ConditionalExpression, `node === null`, `true` | yes: `runLine` spawns with `extendEnv: true`, so the child gets the parent's environment and `env`, unpinned, exactly as the old edit | yes, 90% |
| host-discovery-timeout | discovery moved out of `Effect.cached`, so it runs before the first line's deadline | none | no Stryker 10.1.1 mutator removes a wrapper call or moves code (its mutators were read in `instrumenter/dist/src/mutators/`) | open question 2 |
| host-requested-pin | `requested ?? (yield* repoNode(main))` becomes `yield* repoNode(main)` | LogicalOperator, `requested ?? (yield* repoNode(main))`, `requested && (yield* repoNode(main))` | yes when a pin is requested: `&&` returns the manifest's pin, which the law tests | yes, 90% |
| host-pnpm-path | `pnpm === null ? [node] : [node, pnpm]` becomes `[node]` | ConditionalExpression, `pnpm === null`, `true` | exactly | yes, 95% |
| host-env-order | `{ ...process.env, ...env }` becomes `{ ...env, ...process.env }` | ObjectLiteral, `{ ...process.env, ...env }`, `{}` | close: with `extendEnv: true`, the parent's values win again and a removal in `env` is lost, as with the swap; `env`'s own keys are lost too | yes, 80% |

So the catalog holds five plants: checklist-pid, host-pin, host-requested-pin, host-pnpm-path and
host-env-order. The laws they point at, by their full names, are two: "the host step's outcomes >
scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest
differs" (four plants) and "L13: notices name their process > each view.whole and view.patch for
checklist:1 carries its pid and the update its Process published" (one).

The ten dropped cases pointed at three laws: "successive sends land and a client joining after
the first send opens the current checklist" (seven cases), the "each view.whole" law above (two),
and the watcher's R1 scenario (one). The first keeps its gap, ticketed as 0600 says (open
question 4). The second keeps a product plant through checklist-pid. The third's file,
`watch.laws.integration.test.ts`, sits beside `watch.ts`, so slice 2 brings it into the hourly run
when `watch.ts` changes.

What the move gives up: the old runner checked the law failed at its causal assertion, by
line and column. The new answer checks that the named law is among the killers. Stryker's
`statusReason` holds the failure text, but it can echo environment values, so it is never
recorded (law Q13), as the old runner never recorded error text.

### Slice 2: what keeps libfabrika out of the hourly run, and the change

`scope.ts`'s `inScope` already admits every path outside `.agents/`. What keeps libfabrika's laws
out, read on main:

1. **The test pick.** `related()` picks only `name.test.ts` and `name.test.tsx` beside a changed
   file. Counted under `next/packages/libfabrika/src` (299 product files, test support and
   declarations left out): 67 have a `name.test.ts`, and 61 more have only kind siblings such as
   `name.laws.test.ts` or `name.integration.test.ts`, which the pick never sees.
2. **The host guard in the container.** `mutbox-entry.sh` first runs the picked tests with plain
   `vitest run`, which loads the root config's `fabrika-local-host-only` plugin. That plugin
   refuses any `.integration.` file unless `CI` is set, the owner's named yes is set, or it runs
   in a cloud box (`vitest.hostrun.ts`). mutbox's `docker run` passes only `T`, `BUILD` and
   `RELATED`, so even on GitHub's runner the baseline is refused and the run ends `stuck
   baseline_failed`.
3. **Laws in another folder.** "successive sends land" lives in `next/apps/fabrika/src`, and its
   product is libfabrika's cloudflare runtime. No sibling rule reaches it.

The smallest change that puts libfabrika in:

```ts
// .agents/skills/mutation/scripts/scope.ts, a sketch. `tracked` is the head's file list; with
// none given, the pick is exactly today's, so the existing laws stay as they are.
export const related = (changed: ReadonlyArray<string>, tracked: ReadonlyArray<string> = []) => ...
// For a changed product file d/s.ts it also picks each tracked d/s.<kind>.test.ts(x), where each
// <kind> is a word of letters, digits and dashes, and none is `types` (type laws kill no mutant)
// or `visual` (a window, which the container cannot open). `runtime-recovery.laws...` is not a
// sibling of `runtime.ts`: the stem must be followed by a dot.
```

```yaml
# .github/workflows/mutation.yaml, the range step, a sketch of the two changed lines.
git ls-tree -r --name-only "$head" > "$RUNNER_TEMP/tracked.txt"
node .agents/skills/mutation/scripts/scope.ts --tracked "$RUNNER_TEMP/tracked.txt" < "$RUNNER_TEMP/changed.txt" > "$RUNNER_TEMP/tests.txt"
```

```ts
// .agents/skills/lead/scripts/mutbox.ts, a sketch: `runArgs` adds one pair when, and only when,
// mutbox itself runs with CI set. On the laptop nothing changes and the guard still refuses.
...(ask.ci === null ? [] : ["--env", `CI=${ask.ci}`]),
```

Forwarding `CI` is the truth, not a forged marker: the container runs on GitHub's disposable
runner, which 0594 names as the place such laws run. On the laptop mutbox has no `CI`, passes
none, and the guard refuses as today. `vitest.hostrun.ts`'s comment that "mutbox's Docker
container" refuses gets one line: on the laptop.

What still cannot run in the hourly container after slice 2: a law in another folder, such as
"successive sends land" (open question 4); `.visual.` laws and any test that imports Electron or
Playwright (mutbox's edge case 11); `.types.` laws, by choice; and possibly a slow integration
law file that passes run.sh's 300 s cap (doubt above). A mutant only a child-process test reaches
stays `unconfirmed` (0104).

## One value traced: `host-pnpm-path`

1. A person on CI runs `node .github/ci/plants.ts stryker plant host-pnpm-path`. The edge reads
   the argument, finds the plant, runs `hostFiles([".agents/skills/lead/scripts/flow/host.test.ts"],
   env, platform, read)`: `CI` is set, so it answers `[]`, and the run goes on.
2. The edge builds the provider (environment, then `{ catalog, nice: 15, ignore }`) and runs the
   package's `quality` `Command` with `stryker plant host-pnpm-path`.
3. `cli.ts` reads `Settings.all`: `catalog` is the edge file, `inPlace` false, `concurrency` 1. It
   imports the catalog (the one edge), decodes it with `Catalog`, and finds the plant by name.
4. `Run.plant` asks `Mutants.make([boxnode.ts])`. The real layer runs Stryker's instrumenter on the
   file's text and returns every mutant, about 60 in a file this size (a guess).
5. `Target.find` folds and filters: mutator `ConditionalExpression`, original `pnpm === null`,
   replacement `true`. One match, line 133, column 76 (a sketch value).
6. The nearest `package.json` above `boxnode.ts` and above `host.test.ts` is `.agents/package.json`
   for both, so `inPlace` may stay off.
7. `Options.make` gives the options shown above. `Mutants.run(options)` spawns
   `nice -n 15 node <core>/bin/stryker.js run <temp>/stryker.json` in the repo root, in a scoped
   temp folder, and reads `<temp>/report.json`.
8. Stryker's dry run runs `host.test.ts`'s tests on clean code, then runs each mutant in the range
   against the tests that cover it, with bail off.
9. `Report.answer` finds the mutant at line 133, column 76, `ConditionalExpression`, `true`:
   status `Killed`, `killedBy: ["4"]`. `testFiles[".agents/skills/lead/scripts/flow/host.test.ts"]
   .tests` holds `{ id: "4", name: "the host step's outcomes > scenario: an explicit pin keeps ..." }`.
   The law matches by file and name: `killed`, `by` that one test.
10. The record, one JSON line on stdout and in `--out`:
    `{ plant, target: { file, line, column, mutator, original, replacement }, law, answer, beside:
    [the other mutants in the range with their status], tests: { covered, completed }, seconds,
    stryker: "10.1.1", node }`. Exit 0. The workflow uploads it, and the lead copies it into the
    step's run row.

## What fact is lost if not recorded now

Which tests killed each plant, at which line and column, on which commit. Nothing pins the place,
so the place a run found is a fact that exists only at that run. The record keeps target, killers,
coverage counts and versions; the workflow's artifact keeps the commit and ref; the run row keeps
it for good. Failure text is not kept, on purpose (law Q13).

## Laws

Laws use `it.prop` or `it.effect.prop` from `@effect/vitest` 4.1.3 with Schema inputs where Effect
can generate them (0579), and fast-check arbitraries, each with its reason, where a law needs
built text or reports. `@kalfa/vitest` and 0580's `plant` option are not on main, so each plant
lives in the tests step's report and run row, and fixed laws keep main's title labels.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| Q1, found exactly once: for a generated file built from code fragments with the target node in it k times (k from 0 to 3), and the instrumenter-shaped mutant list for it, `Target.find` answers found when k is 1, `not_found` when 0, and `ambiguous` with every place when 2 or more. 100 runs | test | fc.record: fragments, k, the target's mutator and texts; fast-check, since the input is built text | return the first match when there are two: red | kalfa/quality/src/stryker/Target.test.ts |
| Q2, shape, not bytes: inserting generated blank lines, spaces and re-indents anywhere outside the target's own tokens, and inside it between tokens, leaves the answer found with the same mutator and texts, its line moved by the lines added above it. 100 runs | test | fc.record: one file with one target, and a list of whitespace edits | compare the original without folding whitespace: red | kalfa/quality/src/stryker/Target.test.ts |
| Q3, `within` narrows: with the target node twice, a `within` snippet around one picks that one; a `within` that occurs twice or never is `within_not_once`. 100 runs | test | fc.record: two copies of the node, a snippet around one, a count for the snippet | ignore `within`: two copies stay `ambiguous`, red | kalfa/quality/src/stryker/Target.test.ts |
| Q4, the answer reads killers through `testFiles`: for a generated report with mutants of every status and numeric test ids, the answer is `killed` exactly when the target's mutant (by line, column, mutator and replacement) is `Killed` and one of its `killedBy` ids maps to a test whose file and name both equal the law's; otherwise the status's own tag, or `elsewhere` with every killer, or `not_run`. 100 runs | test | fc.record: a report of 1 to 6 files, 0 to 8 mutants each, a testFiles record, the target and law | (a) match the killer by name only: a same-named test in another file passes, red; (b) read the raw id as a name: red | kalfa/quality/src/stryker/Report.test.ts |
| Q5, a real report decodes: the report Stryker 10.1.1 wrote in Q11's fixture run decodes with `Report`, and its killer of the fixture's target resolves to the fixture law's name in the form the catalog uses | test | vector: the JSON report Stryker 10.1.1 wrote on Q11's fixture, saved once by the tests step | decode `killedBy` as test names without the `testFiles` lookup: red | kalfa/quality/src/stryker/Report.test.ts, kalfa/quality/src/stryker/fixtures/report-10.1.1.json |
| Q6, the options name one place and one test file: for a generated target, law and settings, `Options.make` gives exactly one `mutate` entry equal to the target's span (lines from 1, columns from 0, as Stryker's range reads them), `testFiles` exactly the law's file, `disableBail` true, `coverageAnalysis` `perTest`, and each setting's value in its Stryker key. 100 runs | test | fc.record: a target span, a law file, a settings record | (a) columns from 1: red; (b) add the law's folder to `testFiles`: red | kalfa/quality/src/stryker/Options.test.ts |
| Q7, each setting is read as a person sets it: for generated values, each is read from `KALFA_QUALITY_STRYKER_<KEY>` and from a provider holding `quality.stryker.<key>`, the environment wins over the provider, an absent value gives its one default, an out-of-range value fails naming its key, and a `FABRIKA_QUALITY_STRYKER_<KEY>` is never read. 100 runs | test | fc.record: one value per setting, in range or not, and which source holds it | nest the environment under `FABRIKA`: red | kalfa/quality/src/stryker/Settings.test.ts |
| Q8, the package reaches no product: no file under `kalfa/quality/` imports `@kampus/*`, `@tea-fabrika/*` or a path into `next/`, `packages/` or the CI folder | lint | lint | import `@kampus/libfabrika` in `Run.ts`: lint red | .oxlintrc.json, one `no-restricted-imports` override for `kalfa/quality/**` |
| Q9, a plant runs only once its target is certain: on `MutantsMemory`, for a generated catalog, file texts and a scripted report, `Run.plant(name)` answers as Q4 says, and for an unknown name, a target found 0 or 2 times, a `within` not found once, or `needs_in_place`, it fails with that reason and the stand-in has been asked to run nothing. 100 runs | test | fc.record: a catalog of 1 to 5 plants, file texts, a report, the name asked | ask the stand-in to run before the target is found: red | kalfa/quality/src/stryker/Run.test.ts |
| Q10, `inPlace` follows the package edge: for generated folder trees with `package.json` files, a plant whose target and law have different nearest `package.json` folders is refused as `needs_in_place` while `inPlace` is false, and runs while it is true; one with the same folder runs either way. 100 runs | test | fc.record: a tree of 1 to 4 package folders, a target path and a law path in it | compare the target's and the law's folders instead of their packages: red | kalfa/quality/src/stryker/Run.test.ts |
| Q11, real Stryker answers a plant: in a scoped temp folder the test writes (one product file, one law file with two laws, one that kills the target mutant and one that does not, and a link to this package's `node_modules`), `plant` on the killing law answers `killed` naming only that law, `plant` on the other answers `elsewhere`, and `survey` lists every mutant in the range with its status and killers. Real Stryker spawns its own processes in a temp folder; no stand-in can show the form of the report it really writes, which is what Q4 and Q5 rest on | test | scenario: one fixture, two plants and one survey, written by the test | read only the first entry of `killedBy` with bail on: the second law's plant answers `killed`, red | kalfa/quality/src/stryker/node/MutantsStryker.integration.test.ts |
| Q12, the repo's catalog holds at head: for each plant in `.github/ci/plants.ts`, its file holds its target exactly once (the real instrumenter on the file's text, no Stryker run) and its law file holds a test whose suite chain and title equal `law.name` (read with `oxc-parser`); names are unique | test | scenario: the repo's own catalog at head | change host-pnpm-path's `original` to `pnpm !== null`: red | .github/ci/plants.test.ts |
| Q13 [secrets], no failure text is recorded: a generated secret placed in a report's `statusReason`, in a test name's neighbor field, and in a mutant's `description` never appears in the record line, the `--out` file or a `Refused` message, in any spelling the [secrets] helpers make. 100 runs | test | fc.record: a secret string, which field holds it, a report around it | copy `statusReason` into the record: red | kalfa/quality/src/stryker/Report.test.ts |
| Q14, the command's shape: `./cli` exports an `effect/cli` `Command` named `quality`, whose only subcommand is `stryker`, with exactly `plant` and `survey`. Lead amendment: Effect 4.1.3's `Command` type carries no subcommand names, so the type law pins the root name and a `format:` test in cli.test.ts pins the tree at run time | type | type | add a third subcommand: test red; name the root `kalfa`: tsc red | kalfa/quality/src/cli.types.test.ts, kalfa/quality/src/cli.test.ts |
| Q15, importing `./stryker` loads no Stryker: the module graph of `kalfa/quality/src/stryker/index.ts` reaches no `@stryker-mutator/*` import | lint | lint | import `Instrumenter` in `Plant.ts`: lint red | .oxlintrc.json, the same `kalfa/quality/**` override, its `no-restricted-imports` scoped to `index.ts` and `Plant.ts` |
| Q16, kind siblings join the pick: for generated folders, stems and kinds, a changed product `d/s.ts` with a tracked list picks every tracked `d/s.<kinds>.test.ts(x)` whose kinds hold neither `types` nor `visual`, picks no file whose stem only starts with `s` (`s-x.laws.test.ts`) and no file in another folder, and with no tracked list picks exactly what it picks today. 100 runs | test | fc.record: 1 to 4 folders, stems, kind lists, which are tracked and which changed | match the stem as a prefix without its dot: `runtime-recovery.laws.integration.test.ts` is picked for `runtime.ts`, red | .agents/skills/mutation/scripts/scope.test.ts |
| Q17, the workflow hands the head's file list to the pick: the mutation workflow's range step writes `git ls-tree -r --name-only` of the head and passes it to `scope.ts --tracked`, before the existence check | test | scenario: the workflow's range step, read as text | drop `--tracked` from the step: red | .agents/skills/mutation/scripts/scope.test.ts |
| Q18, `CI` crosses into the container only from CI: for generated host environments, `runArgs` carries `--env CI=<value>` exactly when the host's `CI` is set and not empty, and carries no other host variable. 100 runs | test | fc.record: a host environment of 0 to 8 variables, CI among them or not | always pass `CI=true`: red on the laptop's case; pass the whole environment: red | .agents/skills/lead/scripts/mutbox.test.ts |

No law here needs launchd, real Electron or a real signal, so none is host-only in 0178's sense.
Q11 is a real-resource law and runs on the schedule (0536). The five catalog plants are real runs
too; before the first review they run in the session's disposable cloud box (lead amendment
below), and after the merge on the plants workflow, on GitHub's disposable Linux
runner (0594), never on the owner's laptop.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/quality/package.json | tests | tests | slice 1, new: name, `private`, exports, `kalfa.cli`, optional peers, dev dependencies. The tests step owns it with the lockfile, so its laws can install and run red. Lead amendment: it also exports `./stryker/Settings`, `./stryker/Target`, `./stryker/Mutants` and `./stryker/node/MutantsStryker`, which the repo's edge and Q12 import |
| kalfa/quality/tsconfig.json | tests | tests | slice 1, new: as `kalfa/config`'s, with the Effect checks |
| pnpm-workspace.yaml | tests | tests | slice 1: one `kalfa/*` line, as the coordinator routed; pull requests 1583 and 1506 touch it too, and the second to land merges main |
| pnpm-lock.yaml | tests | tests | slice 1: the `kalfa/quality` importer and the CI scripts' importer only |
| package.json | tests | tests | no change expected: the root names no new dependency. Named because the root file is an exam path |
| kalfa/quality/README.md | build | docs | slice 1, new: what a plant is, the catalog shape, the settings and their `KALFA_` names, how to run one |
| kalfa/quality/src/stryker/index.ts | build | 5 | slice 1, new: re-exports `plant`, `Plant`, `Catalog`, `Law` |
| kalfa/quality/src/stryker/Plant.ts | build | 40 | slice 1, new |
| kalfa/quality/src/stryker/Settings.ts | build | 45 | slice 1, new: seven Configs and `all` |
| kalfa/quality/src/stryker/Target.ts | build | 90 | slice 1, new: fold, find, `within` |
| kalfa/quality/src/stryker/Options.ts | build | 45 | slice 1, new |
| kalfa/quality/src/stryker/Report.ts | build | 100 | slice 1, new: the report Schema (as much as is read), `Answer`, `Refused`, the record |
| kalfa/quality/src/stryker/Mutants.ts | build | 30 | slice 1, new: the service contract (0095) |
| kalfa/quality/src/stryker/MutantsMemory.ts | build | 35 | slice 1, new: the stand-in layer, scripted mutants and reports, counting its calls |
| kalfa/quality/src/stryker/node/MutantsStryker.ts | build | 90 | slice 1, new: the instrumenter through one marked dynamic import, the bin from `@stryker-mutator/core/package.json`, the spawn under `nice` in a scoped temp folder |
| kalfa/quality/src/stryker/Run.ts | build | 110 | slice 1, new: `plant`, `survey`, the package-edge check |
| kalfa/quality/src/cli.ts | build | 70 | slice 1, new: the `quality` Command, the catalog import edge, exit codes |
| kalfa/quality/src/stryker/Target.test.ts | tests | tests | slice 1: Q1 to Q3 |
| kalfa/quality/src/stryker/Report.test.ts | tests | tests | slice 1: Q4, Q5, Q13 |
| kalfa/quality/src/stryker/fixtures/report-10.1.1.json | tests | tests | slice 1: Q5's vector, from Q11's real run |
| kalfa/quality/src/stryker/Options.test.ts | tests | tests | slice 1: Q6 |
| kalfa/quality/src/stryker/Settings.test.ts | tests | tests | slice 1: Q7 |
| kalfa/quality/src/stryker/Run.test.ts | tests | tests | slice 1: Q9, Q10 |
| kalfa/quality/src/stryker/node/MutantsStryker.integration.test.ts | tests | tests | slice 1: Q11 |
| kalfa/quality/src/cli.types.test.ts | tests | tests | slice 1: Q14, the root name |
| kalfa/quality/src/cli.test.ts | tests | tests | slice 1: Q14, the tree (lead amendment) |
| kalfa/quality/src/stryker/Built.test-support.ts | tests | tests | slice 1: built file texts and mutant lists the laws share (lead amendment) |
| kalfa/quality/src/stryker/Fixture.test-support.ts | tests | tests | slice 1: Q11's fixture folder (lead amendment) |
| kalfa/quality/src/stryker/MemoryFiles.test-support.ts | tests | tests | slice 1: an in-memory file system for Q9 and Q10 (lead amendment) |
| .oxlintrc.json | tests | tests | slice 1: one override for `kalfa/quality/**` (Q8, Q15). Pull request 1583 edits this file too |
| .github/ci/plants.ts | tests | tests | slice 1, new: the five plants and the edge (guard, repo settings, run the Command). Exam data: which laws can be shown to fail |
| .github/ci/plants.test.ts | tests | tests | slice 1: Q12 |
| .github/ci/package.json | tests | tests | slice 1: `@kalfa/quality` and the three Stryker packages as dependencies of the catalog's package |
| .github/workflows/plants.yaml | tests | tests | slice 1, new: `workflow_dispatch` with one `plant` input; checkout, the pnpm action, a frozen install, `nice -n 19 node .github/ci/plants.ts stryker plant "$PLANT" --out ...` with `KALFA_QUALITY_STRYKER_IN_PLACE: "true"`, read-only permissions, no secrets, the record uploaded |
| .github/ci/plant.ts | tests | tests | no change: lane 1569 holds it; deleted in the follow-up once the plants run |
| .github/ci/plant-cases.ts | tests | tests | no change, for the same reason |
| .github/ci/plant-machine.ts | tests | tests | no change, for the same reason |
| .github/ci/plant-related.ts | tests | tests | no change, for the same reason |
| .github/ci/plant-errors.ts | tests | tests | no change, for the same reason |
| .github/workflows/plant.yaml | tests | tests | no change, for the same reason |
| vitest.config.ts | tests | tests | no change: pull request 1589 adds `kalfa/` to its globs (open question 1) |
| .github/workflows/check.yaml | tests | tests | slice 1 (lead amendment, on the landing operator's call): one line, `kalfa/*/node_modules/.cache/tsc` right after `packages/*/node_modules/.cache/tsc` in the `&tsc` path list, the place the `kalfa/*` workspace line holds. Pull request 1583 adds the same line; the second to land keeps one |
| .github/ci/changes.mjs | tests | tests | no change: pull request 1589 routes `kalfa/` |
| next/apps/fabrika/src/checklist-instance.laws.integration.test.ts | tests | tests | no change: checklist-pid's law file, read by Q12 |
| .agents/skills/mutation/scripts/scope.ts | build | 30 | slice 2: `related(changed, tracked)`, the `--tracked` flag at its edge |
| .agents/skills/mutation/scripts/scope.test.ts | tests | tests | slice 2: Q16, Q17 |
| .github/workflows/mutation.yaml | tests | tests | slice 2: the range step's two lines |
| .agents/skills/lead/scripts/mutbox.ts | build | 8 | slice 2: `ci` on the ask from the environment at its edge, the `--env` pair in `runArgs`, edge case 24 in the header list |
| .agents/skills/lead/scripts/mutbox.test.ts | tests | tests | slice 2: Q18 |
| vitest.hostrun.ts | build | 2 | slice 2: the comment line on mutbox's container says "on the laptop" |
| .glossary/TERMS.md | build | docs | slice 1: a `plant` row (below) |
| docs/plan/README.md | build | docs | slice 1: the plant exercise paragraph names `@kalfa/quality/stryker`, its five plants and the workflow; slice 2: one line that the hourly run picks kind siblings and runs integration laws on CI |

## Existing tools

- `kalfa/quality/src/stryker/Target.ts`: searched the installed Stryker packages, the pipeline's
  driver and npm for a way to pick a mutant by its text. Stryker's instrumenter makes and lists
  mutants (used here); its `mutate` range picks by place only, and incremental mode matches old
  results, not a named target. Nothing matches by text, so the fold-and-filter is ours, with its
  edge cases in Q1 to Q3.
- `kalfa/quality/src/stryker/Report.ts`: searched `mutation-testing-report-schema` 3.8.4 and
  `mutation-testing-metrics` for a reader. The schema package ships JSON Schema and types, not a
  decoder; the metrics package computes scores. The Effect Schema here covers only the fields read,
  as the pipeline's driver does.
- `kalfa/quality/src/stryker/Options.ts`: searched Stryker's `stryker-core.json` options schema;
  the options are Stryker's own keys, built as plain data.
- `kalfa/quality/src/stryker/Settings.ts`: searched `effect` 4.1.3's `Config` and `ConfigProvider`
  and main's libfabrika settings engine. Effect's Config is used; the engine is in libfabrika on
  main and a kalfa package may not import it, so `@kalfa/config` joins when it lands.
- `kalfa/quality/src/stryker/Plant.ts`: searched the pipeline's `mutant.ts` (its `Survived` and
  `idOf` name a mutant by place and a hash) and the old `plant-cases.ts` (byte edits); neither
  names a mutant by shape, so the Schema is new.
- `kalfa/quality/src/stryker/index.ts`: searched `kalfa/config`'s exports; it exports per module,
  and this one file re-exports `Plant.ts` so `./stryker` matches 0600's import line.
- `kalfa/quality/src/stryker/Mutants.ts`: searched the pipeline's `services.ts`; its
  `MutationRunner` asks a different question (counts over spans), so the contract is new.
- `kalfa/quality/src/stryker/MutantsMemory.ts`: searched the pipeline's `scripted.ts`, its fake of
  `MutationRunner`, for the shape; the stand-in sits beside its service, as 0536 and 0538 ask.
- `kalfa/quality/src/stryker/node/MutantsStryker.ts`: searched the pipeline driver (rethought, not
  imported: no `runEnv`, no `child.ts`, no `results.ts`) and `effect/process`'s
  `ChildProcessSpawner`, which it uses for the spawn.
- `kalfa/quality/src/stryker/Run.ts` and `kalfa/quality/src/cli.ts`: searched `effect/cli`
  (`Command`, `Argument`, `Flag`, as `mutbox.ts` and 0585 use) and the old runner. The Command is
  `effect/cli`'s; the steps are ours.
- In `scope.ts`, the new `tracked` pick: searched picomatch (only a transitive dependency here, as
  the file's own header says) and Vitest's `related` command. A glob cannot say "the stem then a
  dot", and Vitest's import graph is open question 4, so it is a plain string test with Q16's edge
  cases.

## Calls taken

- **The catalog lives in `.github/ci/plants.ts`, 80%.** It is ours, so not in the package. It is
  exam data, and every file under the CI folder is an exam path, so the tests step owns it, as it owns the laws the
  plants prove. 0585 puts plants under `@kalfa/ci/checks`, which the CI scripts' package becomes, so the file
  moves with that package. Each entry is `plant({...})`, as 0600's sketch imports it. The other
  place weighed: beside each law, as 0580's `plant` option. That waits on `@kalfa/quality/vitest`
  and turns 0580's string into an object, a design change, so not now.
- **One dispatch workflow, `plants.yaml`, 80%.** Plants run real Stryker on laws that must not run
  on the laptop (0594), and the follow-up deletion needs proof that they ran. It has no schedule
  and no pull request trigger, so it adds no automatic run; wiring it into the pull request's legs
  is the follow-up's, with `changes.mjs`.
- **The answer needs the named law among the killers, with bail off, 85%.** With bail on, Stryker
  stops at the first failing test, which may be another law in the same file; `disableBail` is
  Stryker's own switch for "which tests kill it".
- **A `timeout` never passes a plant, 80%.** Stryker's Timeout names no test, so it cannot show
  that the named law failed.
- **`survey` ships with `plant`, 80%.** It is the same run over a line range with no target, and
  it is how the tests step confirms each shape in the table above and how the next plant is
  found. About 20 lines on top of `plant`.
- **Slice 2's two changes, 85%.** Kind siblings and the `CI` pass are each one small, tested
  change; neither changes what runs on the laptop. Pull request 1506 edits the mutation skill's
  prose; slice 2 edits none of it. The skill's line "the tests beside the changed files" stays
  true.
- **One pull request for both slices (lead amendment).** The brief is one pull request, and no
  number caps its size (0099). It waits for 1589 on main (open question 1's answer), so slice 2
  waits too; that costs an hour-scale delay to the hourly pick, nothing else.
- **The `.oxlintrc.json` override, 80%.** On main no `next/` override covers `kalfa/**`, so Q8 and
  Q15 need their own. Pull request 1583 extends the `next/**` overrides to `kalfa/**`; the second
  to land merges main and keeps both. Until then the code is written to `next/`'s rules by hand
  (0033), and the review checks it.

## Validation

- **Where kalfa laws run.** On main the root vitest config does not include `kalfa/`. If 1589 is
  on main when the steps start, the steps use plain narrow paths. If not, the tests and build steps
  run `nice -n 15 pnpm exec vitest run --maxWorkers=3 --root kalfa/quality <path>` for the
  ordinary laws only. `--root` skips the root config's host guard, so Q11 runs only where that
  guard would allow it (a cloud box or CI), never on the laptop.
- tests step, slice 1: Q1 to Q14 red, on the package's missing modules (Q12 too: it imports the
  package's `Target`). Q5's vector cannot exist before the runner does, so the tests step writes
  Q5 against a report it captures by running Stryker 10.1.1 by hand on Q11's fixture in a cloud
  box, labeled `vector:` with that command.
- build step, slice 1: the same paths green; `pnpm lint`; Q11 once in a cloud box or on CI; then
  each of the five plants once with `node .github/ci/plants.ts stryker plant <name> --out
  runs/plants/<name>.json`, all answering `killed`, before the first review (checklist-pid's result
  decides the doubt above; a plant that does not answer `killed` stops the step and comes back to
  the plan). Lead amendment: these run in the session's disposable cloud box, which the host guard
  allows (0594: never the owner's laptop). `plants.yaml` cannot run first: GitHub dispatches only a
  workflow file the default branch holds, so its first CI run is on main after the merge, and that
  run is the follow-up deletion's proof. Each record goes into the build's run row.
- slice 2: `nice -n 15 pnpm exec vitest run --maxWorkers=3 .agents/skills/mutation/scripts/scope.test.ts .agents/skills/lead/scripts/mutbox.test.ts`.
- The lead runs one `pnpm typecheck` and the narrow paths of every test that reads a changed
  `package.json` (the lockfile change makes the changed set the full suite). The first hourly run
  after slice 2 is read for its pick and its seconds.

## Size

1. Slice 1, the plant runner: about 660 product lines (`Run.ts` 110, `Report.ts` 100, `Target.ts`
   90, `MutantsStryker.ts` 90, `cli.ts` 70, `Settings.ts` 45, `Options.ts` 45, `Plant.ts` 40,
   `MutantsMemory.ts` 35, `Mutants.ts` 30, `index.ts` 5), plus Q1 to Q15, the catalog, the
   workflow, the README and the docs rows. It lands whole: a person can run each of the five
   plants on CI, and the old runner can be deleted after.
2. Slice 2, libfabrika in the hourly run: about 40 product lines (`scope.ts` 30, `mutbox.ts` 8,
   the comment 2), plus Q16 to Q18 and the workflow's two lines. It lands whole: the next hourly
   run picks kind siblings and runs integration laws in its container.

About 7 agent hours across the steps, 70% sure. The doubt is the real runs: a plant whose shape
or test name is off sends the tests step back once, and Q11's first real run may need a second
try. Budget basis: the kalfa-config plan's measured $5 a step (`field/runs/2026-11-15-t1050-build1.json`,
$2.67 list for a build) scaled up for a larger slice, about $8 a step. Slice 1 is tests, build,
review and one likely send-back; slice 2 is tests, build and review.

Estimate: 7 steps, $56

## Records

- `field/runs/` rows for each step, by the lead, with each plant's record from the workflow.
- Glossary, a new row: `plant` | A break put once into product code to show a law can fail
  ([0093](../../../.decisions/0093-laws-walk-plants-run-once.md)). In `@kalfa/quality/stryker`, a
  Stryker-made mutant named by its code shape (file, mutator, original, replacement), with the
  law that must kill it ([0600](../../../.decisions/0600-kalfa-quality-holds-test-lint-format.md)).
  Industry: a targeted mutant | Not a mutant of the hourly run, which is sampled, not named. Not a
  plant test: nothing is committed but the catalog entry.
- `docs/plan/README.md`, as in the files table.
- No `.decisions/` file: 0600 holds the ruling; the open questions below may add one.
- The ticket text below goes in a field row, since this session has no tracker.

## What this cannot tell us

- Whether naming by code shape stays stable in practice: a rename of `pnpm` to `bin` breaks the
  plant loudly, which is the point, but how often that costs a catalog edit is unmeasured.
- Whether a wider Stryker mutant (ObjectLiteral `{}` for one dropped property) proves the same
  law as the narrow hand edit did. A kill shows the law can fail; it does not show it fails for
  the reason the old edit tested.
- How long a plant takes on CI. The old runner's checklist cases took minutes; a Stryker dry run
  of the whole law file adds to that, unmeasured.
- Whether the hourly container can run libfabrika's integration laws within its limits (memory,
  300 s, offline install of the workerd binary). The first runs say.
- What "successive sends land" would kill: no product plant for it is found here.

## Lead answers, 2026-11-18

Each answers an open question below, inside 0600 and the brief. Question 1: one pull request, armed only once
1589 is on main and main is merged in, so CI runs its laws first. Question 2: left out, its gap
recorded in a field row as ticket text. Question 3: not a new design call (0069). Question 4: the
gap stays recorded, as 0600 says.

## Open questions

1. **On main, CI never runs `kalfa/quality`'s laws.** The root vitest config's globs, `legs.ts`
   and `changes.mjs` do not reach `kalfa/` until pull request 1589 lands, and those files are 1589's.
   Lean, 85%: slice 1 merges only after 1589 is on main, so its laws run in CI before the merge; the
   laws are placed where 1589's globs find them (`kalfa/*/src/**/*.test.ts` and
   `kalfa/**/*.integration.test.ts`). Slice 2 does not wait. This is a merge-order call the lead can
   make; it goes to the owner only if 1589 stalls.
2. **host-discovery-timeout has no Stryker mutant.** Its fault moves discovery out of the first
   line's deadline, and no Stryker 10.1.1 mutator moves or unwraps code. Lean, 80%: leave it out of
   the catalog, with no hand-written fallback, and file a ticket for its law's proof, as 0600 does
   for the fixture cases. Its law ("stalled runtime discovery shares the first command's deadline")
   keeps its recorded one-time plant (0093), and `flow/host.ts` stays in the hourly run's scope
   (0089).
3. **Settings before `@kalfa/config` is on main.** Each setting is an Effect Config with its
   default, read from `KALFA_` variables, with the repo's three values supplied at the edge in
   `.github/ci/plants.ts`; the TOML files and flags join when 1583 lands. Lean, 85%: this is not a
   new design call, since 0069 has providers supplied at the edge and 0585's files arrive with the
   engine; nothing a person needs is missing, since every setting has its variable.
4. **"successive sends land" still has no planted proof.** No sibling rule reaches a law in
   `next/apps/fabrika` whose product is in libfabrika. Two ways in: the hourly run picks from
   Vitest's own import graph (`vitest list --changed`, the existing tool), which for libfabrika's
   cloudflare runtime selects a large set of slow files; or a product-code plant in the catalog,
   found with `survey` over the runtime's alarm code. Lean, 70%: keep the gap ticketed as 0600 says,
   and let the follow-up that deletes the old runner measure a `survey` of that law first, since a
   real plant is cheaper than a wider hourly pick.

## Findings

None.

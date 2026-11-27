
Plancheck-Version: 3

# Plan: test helpers from `@kalfa/quality/vitest` (ticket 2234)

This is the kalfa packages, `kalfa/quality`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2234, under
[Code quality's protocol](https://github.com/kamp-us/tea-fabrika/issues/1763) and
[the owner's answers on its own gaps](https://github.com/kamp-us/tea-fabrika/issues/1763#issuecomment-7084076309).
Words: `kalfa/quality/GLOSSARY.md`, which already holds Depth, Recorder, Stub and Test database.

The test helpers in `@kampus/vitest` (`next/packages/vitest/src`) are copied into `@kalfa/quality` as a new entry
point, `/vitest`. The root gives `runsFor` and the depth, `Recorder` and `Stub`; `/vitest/TestDatabase` gives the
SQLite file a test opens. One thing changes in the copy: the depth is read from `KALFA_QUALITY_VITEST_DEPTH`, not
`FABRIKA_TEST_DEPTH`. `@kampus/vitest` stays as it is, and no test moves to the new place here: that is
https://github.com/kamp-us/tea-fabrika/issues/2235. The ticket also runs one try for
https://github.com/kamp-us/tea-fabrika/issues/2238: does vitest's list mode give back an option set on a law? One
pull request, about 475 product lines, nearly all copied.

```ts
// The whole idea, a sketch. Nothing here was type-checked.

// kalfa/quality/package.json, two new entry points beside ./stryker
"exports": {
  "./vitest": "./src/vitest/index.ts",                 // runsFor, depth, Recorder, Stub
  "./vitest/TestDatabase": "./src/vitest/TestDatabase.ts", // node:sqlite, kept off the root
  // ...the ./stryker entries and ./cli, unchanged
}

// kalfa/quality/src/vitest/Depth.ts, the one line that is not a copy
export const depth: Depth = decodeDepth(process.env.KALFA_QUALITY_VITEST_DEPTH);

// A law in any repo:
import { runsFor } from "@kalfa/quality/vitest";
fc.assert(property, { seed, numRuns: runsFor({ fast: 10, full: 100 }) });
//   KALFA_QUALITY_VITEST_DEPTH unset  -> 10
//   KALFA_QUALITY_VITEST_DEPTH=full   -> 100
//   KALFA_QUALITY_VITEST_DEPTH=Full   -> the test file fails to load
```

## Calls under 80%, read these first

None is under 80%. The two lowest, at 80%, are both about how the tests step writes a law, not about the product:

- **A fresh copy of `Depth.ts` per case.** Law V1 sets the variable with `vi.stubEnv`, then imports `Depth.ts` again
  after `vi.resetModules()`, so the module reads the variable as it loads. If the fresh import does not run the module
  again, the fallback is a query on the import path (`import("./Depth.ts?case=" + n)`), which Vite treats as a new
  module. Either way the law reads the module as a test file does: at load.
- **The try's answer, read from vitest's source and not yet run.** See "The try" below. The build's run settles it.

## How others do it

- **Elm**: `elm-test` takes the number of fuzz runs as a command flag, `--fuzz`, 100 by default. One number for the
  whole run, set from outside the test. Read from memory; not fetched.
- **Erlang/OTP**: PropEr takes `{numtests, N}` per property or per run, and a CI job passes a bigger number. Read from
  memory; not fetched.
- **Rust**: `quickcheck` reads `QUICKCHECK_TESTS`, and `proptest` reads `PROPTEST_CASES`, both from the environment, so
  CI can ask for more cases with no code change. **Python**: Hypothesis keeps named settings profiles and picks one with
  an environment variable (`settings.load_profile(os.getenv(...))`), the common way to run more examples in CI. Read
  from memory; not fetched.
- **Effect** keeps its own test helpers in their own package, `@effect/vitest`, beside the library and usable in any
  repo. `@kampus/vitest` copied that shape, and so does this entry point.
- **This repo**: the protocol settled the shape (issue 1763's answer, `@kalfa/quality/vitest`): the four helpers move
  in as they are, the depth becomes `KALFA_QUALITY_VITEST_DEPTH`, read from the environment only, because a test reads
  it while its file loads. A `@kalfa/config` setting would need an Effect run at module load, which the protocol ruled
  out.
- **vitest 5.0.5, as installed** (`pnpm-lock.yaml`: `vitest@5.0.5`, patched in `run.BPv-BBRv.js`'s `throttle` only),
  for the try: read below, file and line given.

## The shape

### Files and entry points

```text
kalfa/quality/src/vitest/
  index.ts          the root: export * from Depth, export * as Recorder, export * as Stub
  Depth.ts          depth, decodeDepth, runsAt, runsFor, LEAST, Runs; reads KALFA_QUALITY_VITEST_DEPTH
  Recorder.ts       layer, calls and their types; the store key starts @kalfa/quality/vitest/Recorder/
  Stub.ts           make
  TestDatabase.ts   make, open, Options, TestDatabaseError; the one file that imports node:sqlite
```

Each file is a copy of the file of the same name in `next/packages/vitest/src`, with three kinds of edit and no
other:

1. **The variable.** `Depth.ts` reads `KALFA_QUALITY_VITEST_DEPTH`. Unset is `fast`, `fast` and `full` name
   themselves, and any other value fails the decode, the empty string too, as today. No fallback to
   `FABRIKA_TEST_DEPTH`: the ticket says "read only from" the new variable, and #2235 makes CI set both.
2. **Ids.** The Recorder's store key becomes `` `@kalfa/quality/vitest/Recorder/${service.key}` `` and the Shelf's
   (a test service) `@kalfa/quality/vitest/Shelf`. A Recorder layer from one package and a `calls` read from the other
   then never meet. Their types do not meet either: each package's `Recorded<I>` has its own unique symbol.
3. **Doc comments neutral.** The copies cite old decision numbers (0535, 0538, 0554, 0579), ticket numbers, an
   experiment, "the 3-hour schedule" and the repo's lint rule names. None of those is a decision in
   `.kalfa/decisions/`, and a kalfa package is usable in any repo (decision 0047). Each reason stays in words; the
   numbers and our paths go. Example, `Depth.ts`'s module block:

```ts
// A sketch of the new doc block. Nothing here was type-checked.
/**
 * How deep a test run goes: `fast` or `full`, read once from `KALFA_QUALITY_VITEST_DEPTH` while this module
 * loads. Unset is `fast`; any other value than the two words fails the run. A law over real input and output
 * reads its case count here, never as a number of its own. Anything else with a fast form and a full form,
 * such as an in-memory layer beside a real one, reads `depth`.
 */
```

`package.json` gets the two `exports` entries and a description that names `/vitest`. No dependency changes: the
product files import only `effect` (a peer already) and `node:sqlite`, and the laws import `@effect/vitest`,
`fast-check`, `vitest` and `@effect/platform-node`, which are dev dependencies already. So `pnpm-lock.yaml` does not
change.

### Two lint overrides in `.oxlintrc.json`

The ticket's "imports no kalfa package" and "importing the root loads no native database module" are shapes of
imports, so they are lint (the design reference: a check on the shape of code is a lint rule). oxlint's own
`no-restricted-imports` does both. An override replaces a rule's options, so each repeats the Q8 block's entries for
`kalfa/quality/**` (the Radix, Playwright, `@kampus/*`, `@tea-fabrika/*` and path entries) and adds its own. Both go
after the Q15 block, so nothing later replaces them.

```jsonc
// A sketch. Nothing here was type-checked.
{
  // V3: what /vitest ships imports no kalfa package. Its laws may import the package by its own name.
  "files": ["kalfa/quality/src/vitest/**"],
  "excludeFiles": [/* the folder's test files and test support, by the globs the other kalfa blocks use */],
  "rules": { "eslint/no-restricted-imports": ["error", { "paths": [/* Q8's */], "patterns": [
    /* Q8's */,
    { "group": ["@kalfa/*", "@kalfa/*/**"], "message": "@kalfa/quality/vitest imports no kalfa package, so a repo's tests stay light. ..." }
  ] }] }
},
{
  // V4: the root loads no native database module. V3's entries again, and two more.
  "files": ["kalfa/quality/src/vitest/index.ts", "kalfa/quality/src/vitest/Depth.ts",
            "kalfa/quality/src/vitest/Recorder.ts", "kalfa/quality/src/vitest/Stub.ts"],
  "rules": { "eslint/no-restricted-imports": ["error", { "paths": [/* V3's */,
    { "name": "node:sqlite", "message": "..." }, { "name": "sqlite", "message": "..." }],
    "patterns": [/* V3's */, { "group": ["./TestDatabase", "./TestDatabase.ts"], "message": "TestDatabase is read through @kalfa/quality/vitest/TestDatabase, never the root ..." }] }] }
}
```

The V4 list names the four root files, not a glob, so a fifth root file has to be added by hand. That is the cost of
lint reading one file at a time; V2's type law catches a root that re-exports `TestDatabase` whatever file it goes
through.

### What the copy leaves alone

- `next/packages/vitest/**`: not one byte. Tests in `next/` keep importing `@kampus/vitest` until the later cut
  (issue 1866).
- The lint rules that name `@kampus/vitest` (`fabrika/runs-from-depth`, `fabrika/test-database`) hold only files under
  `next/` today (each one's `create` returns early for any other path), so the new files meet neither. Widening them is
  #2235's criterion, not this one.
- Spans: none of the four helpers makes one. `Recorder` uses `Effect.andThen`, `Ref` and `Stream.unwrap`, never
  `Effect.fn` with a name or `withSpan`; `TestDatabase` uses `Effect.acquireRelease`, `Effect.sync` and `Effect.try`.
  V5 holds it. Vitest's own spans are #2246's (decision 0079).

## The try: does vitest's list mode give back an option set on a law?

The protocol left one check for the build: whether vitest's list mode, run without running any law, gives back an
option such as `plants`. Reading vitest 5.0.5's source gives a three-part answer, which the build runs to confirm:

1. **`vitest list --json` never prints an option.** Its formatter writes `name`, `file`, `projectName` and `location`
   and nothing else (`formatCollectedAsJSON`, `vitest/dist/chunks/cli-api.De07GUeT.js:13847`).
2. **`vitest list` parses files statically by default,** without importing them (`staticParse` defaults to `true`,
   `vitest/dist/chunks/cac.CLrZKo1g.js:1338`; `collect` calls `parseSpecifications` unless it is `false`,
   `cli-api.De07GUeT.js:12689`). The static parser gives every test `meta: {}`
   (`vitest/dist/chunks/index.1TqnEahn.js`, `astCollectTests`), so in that mode no option comes back at all.
3. **With static parsing off,** vitest imports each file and registers its tests without running them. A test's
   `meta` option is copied onto the task (`createSuiteCollector`, `vitest/dist/chunks/run.BPv-BBRv.js:2641` and
   `:2681`), and the node API's `TestCase.meta()` returns it (`cli-api.De07GUeT.js:10443`). Any other key, such as a
   top-level `plants`, is dropped: the task is built field by field from known options (`run.BPv-BBRv.js:2666`).
   Options go in the second argument: `test(name, fn, { ... })` throws in vitest 4 and later
   (`run.BPv-BBRv.js:2607`). `@effect/vitest` 4.1.3 passes its third argument to vitest as that second argument
   (`@effect/vitest/src/internal/internal.ts:271`), `it.prop` included, so a `meta` key there arrives too.

So the predicted answer is **no for a top-level option, yes for `meta`, and only through the node API with static
parsing off**. 80% sure until it runs; the doubt is whether `meta` crosses from the worker to the main process whole
during collection, which only a run shows.

**How the build runs it.** In its own scratch folder, one file, `try.test.ts`, with vitest's globals on so it imports
nothing:

```ts
// A sketch. The fixture for the try, never committed.
it("a top-level option", { plants: [{ name: "p1" }] } as object, () => { throw new Error("a law ran") });
it("an option under meta", { meta: { plants: [{ name: "p2" }] } }, () => { throw new Error("a law ran") });
```

Then three runs, each from the worktree, with the scratch folder as vitest's root so no repo config loads:

1. `pnpm exec vitest list --json --root <scratch> --globals` (static, the default).
2. The same with static parsing off (`--static-parse=false`, or the spelling `vitest list --help` gives).
3. A short `node --input-type=module -e` script: `createVitest("test", { root, globals: true, watch: false })`, then
   `collect(undefined, { staticParse: false })`, then for each test print its name, `JSON.stringify(test.meta())` and
   its state, and `close()`.

What counts as seen: the printed JSON of each run, and that neither body ran (no "a law ran" anywhere). The build puts
the three outputs in its report. The lead posts the answer on #2234 and #2238 (draft under Records). Nothing from the
try is committed: it tests vitest, not this package, and #2238 writes its own gathering laws.

## One value traced

A repo's law `numRuns: runsFor({ fast: 10, full: 100 })`, in a test file that imports `@kalfa/quality/vitest`, run
in CI where the workflow step sets `FABRIKA_TEST_DEPTH=full` and nothing else.

1. Vitest imports the test file, which imports `@kalfa/quality/vitest`. Node finds `exports["./vitest"]` and loads
   `src/vitest/index.ts`, then `Depth.ts`, `Recorder.ts` and `Stub.ts`. No `node:sqlite` loads.
2. `Depth.ts` runs `decodeDepth(process.env.KALFA_QUALITY_VITEST_DEPTH)`. The variable is unset, so
   `decodeDepth(undefined)` decodes `"fast"`. `depth` is `"fast"`. `FABRIKA_TEST_DEPTH` is never read.
3. The law calls `runsFor({ fast: 10, full: 100 })`, which is `runsAt("fast", ...)`. The counts pass the guard
   (whole numbers, `fast` from `LEAST` to `full`), so it answers 10.
4. The same law through `@kampus/vitest` would answer 100. That gap is why #2235 makes every workflow step that sets
   `FABRIKA_TEST_DEPTH` also set `KALFA_QUALITY_VITEST_DEPTH`, before any test moves over.
5. With `KALFA_QUALITY_VITEST_DEPTH=Full`, step 2's decode fails, the import of the test file throws, and vitest
   reports the file as failed. No law in it runs at a wrong depth.

## Generators

V1 draws both variables at once, each unset, `"fast"`, `"full"` or another string (`fc.string()` with
`"Full"`, `""`, `" full"` and `"FAST"` as examples), and every run builds each class below:

- (a) the new variable unset and the old one set to `"full"`: the answer is `fast`.
- (b) the new variable `"full"`, the old one anything: the answer is `full`.
- (c) the new variable `"fast"` and the old one `"full"`: the answer is `fast`.
- (d) the new variable any other string, the old one anything: loading `Depth.ts` fails. This class reaches the
  decode, the one check that guards the value: it passes nothing earlier, since there is no earlier check.
- (e) both unset: the answer is `fast`.

## Laws

The copied laws keep their own run counts. V1 runs 100 cases in memory on every pull request.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| V1, the depth is read only from `KALFA_QUALITY_VITEST_DEPTH`, at load: for each drawn pair, set both variables with `vi.stubEnv` (unset is `undefined`) inside a scope that undoes them, load a fresh `Depth.ts`, and check `depth` is exactly `fast` for (a), (c) and (e) and `full` for (b), and that the load fails for (d). 100 runs, each class reached in every run | test | fc.record: the two variables, each unset, "fast", "full" or another string | (a) read `FABRIKA_TEST_DEPTH` in place of the new name: (a) answers `full`, red; (a) fall back to the old variable when the new one is unset: red; (b) ignore the environment and answer `fast`: red; (c) read the old variable first: red; (d) answer `fast` for an unknown word: the load succeeds, red; (e) make `full` the default: red | kalfa/quality/src/vitest/Depth.test.ts |
| V2, the entry points give what the ticket names: by the package's own name, `@kalfa/quality/vitest` gives `runsFor`, `runsAt`, `decodeDepth`, `depth`, `LEAST`, `Runs`, `Recorder` and `Stub`, each the same type as its module's own, and no `TestDatabase`, `make`, `open` or `Sql`; `@kalfa/quality/vitest/TestDatabase` gives `make`, `open`, `Options` and `TestDatabaseError` | type | type | drop `./vitest/TestDatabase` from `exports`: the import does not resolve, red; add `export * as TestDatabase from "./TestDatabase.ts"` to the root: the "no TestDatabase" check fails, red; point `./vitest` at `Depth.ts`: `Recorder` is missing, red | kalfa/quality/src/vitest/index.types.test.ts |
| V3, what `/vitest` ships imports no kalfa package, and still no `@kampus/*`, `@tea-fabrika/*` or path out into the repo (the Q8 block's entries, repeated) | lint | lint | add `import * as Hidden from "@kalfa/diagnostics/Hidden"` to `Stub.ts`: `pnpm lint` red; the same import in a test file of the folder stays green | .oxlintrc.json |
| V4, the root loads no native database module: `index.ts`, `Depth.ts`, `Recorder.ts` and `Stub.ts` import neither `node:sqlite` nor `sqlite` nor `./TestDatabase.ts` | lint | lint | add `export * as TestDatabase from "./TestDatabase.ts"` to `index.ts`: `pnpm lint` red (and V2 red); add `import "node:sqlite"` to `Recorder.ts`: red | .oxlintrc.json |
| V5, the Recorder makes no span of its own: with a tracer that keeps every span it is asked to start (`Tracer.make`, provided with `Effect.withTracer`), a `Recorder.layer` over the Shelf runs `put`, `count`, `size`, `watch` and a method in `fails` once each, then `calls` reads them back; the tracer kept no span | test | scenario: one Shelf layer, each kind of member run once, under a tracer that keeps every span | wrap the record's write in `Effect.withSpan("Recorder.write")`: five spans, red; make `calls` an `Effect.fn("Recorder.calls")`: one span, red | kalfa/quality/src/vitest/Recorder.test.ts |
| V6, `TestDatabase` makes no span of its own: under the same tracer, `make` and `open` on a file in a scoped temp folder, then the scope closes; the tracer kept no span | test | scenario: one make and one open on a temp folder, under a tracer that keeps every span | wrap `make`'s acquire in `Effect.withSpan`: red; make `open` an `Effect.fn("TestDatabase.open")`: red | kalfa/quality/src/vitest/TestDatabase.integration.test.ts |
| V7, the helpers' own laws pass from the new place: the depth's laws (unset is fast, the two words, any other word fails, the counts and their guard) with `KALFA_QUALITY_VITEST_DEPTH` in place of the old name, the Recorder's R1 to R17, the Stub's laws, and the test database's D1 to D3 and T1, each copied with its plants | test | pinned: each copied law's own generators and cases, unchanged | (already planted in their own files; each copy keeps its plant comment) | kalfa/quality/src/vitest/Recorder.test.ts |

**Where they run.** V1, V5, V7's in-memory laws and V2's types run on every pull request (V2 and the copied type laws
only in the lead's `pnpm typecheck` and CI, since vitest does not typecheck). V6 and the copied D1 to D3 open real
files in a temp folder, so they live in `TestDatabase.integration.test.ts`: the laptop refuses that file by name
(`vitest.hostrun.ts`), pull requests and the merge queue run none, and main's full run does. No stand-in will do for
them: their one job is to show what the real SQLite file does. No law is host-only: a temp folder is not launchd, the
Electron app, a signal or a socket. The lead's proof run before merge runs `TestDatabase.integration.test.ts`.

The copied laws meet kalfa's own test lint block (`.oxlintrc.json`'s override for kalfa's test files, with
`fabrika/no-node-imports` on). Where a copy trips a rule that `next/`'s block left off, the tests step fixes the code,
never the rule.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/quality/src/vitest/index.ts | build | 30 | new: copy of `next/packages/vitest/src/index.ts`, doc comments neutral |
| kalfa/quality/src/vitest/Depth.ts | build | 66 | new: copy, reads `KALFA_QUALITY_VITEST_DEPTH` |
| kalfa/quality/src/vitest/Recorder.ts | build | 239 | new: copy, store key `@kalfa/quality/vitest/Recorder/...` |
| kalfa/quality/src/vitest/Stub.ts | build | 32 | new: copy |
| kalfa/quality/src/vitest/TestDatabase.ts | build | 105 | new: copy |
| kalfa/quality/package.json | build | 3 | `exports` gains `./vitest` and `./vitest/TestDatabase`; the description names `/vitest` |
| kalfa/quality/README.md | build | docs | the opening says two subpaths; a new `/vitest` section: what each helper is, the depth variable and its values, that the root loads no `node:sqlite`, and a row for where each file is |
| kalfa/quality/src/vitest/Depth.test.ts | tests | tests | new: the depth's copied laws with the new name, and V1 |
| kalfa/quality/src/vitest/Recorder.test.ts | tests | tests | new: copy, and V5 |
| kalfa/quality/src/vitest/Recorder.types.test.ts | tests | tests | new: copy |
| kalfa/quality/src/vitest/Shelf.test-support.ts | tests | tests | new: copy, id `@kalfa/quality/vitest/Shelf` |
| kalfa/quality/src/vitest/Stub.test.ts | tests | tests | new: copy |
| kalfa/quality/src/vitest/TestDatabase.integration.test.ts | tests | tests | new: copy, imports `./Depth.ts` and `./TestDatabase.ts`, and V6 |
| kalfa/quality/src/vitest/TestDatabase.types.test.ts | tests | tests | new: copy, imports both entry points by the package's name |
| kalfa/quality/src/vitest/index.types.test.ts | tests | tests | new: V2 |
| .oxlintrc.json | tests | tests | V3 and V4: two `no-restricted-imports` overrides after the Q15 block |
| next/packages/vitest/package.json next/packages/vitest/src/Depth.test.ts | tests | none | not changed: nothing under `next/packages/vitest/` changes (issue 1866) |
| kalfa/quality/GLOSSARY.md | build | none | not changed: Depth, Recorder, Stub and Test database are already there, with these meanings |
| pnpm-lock.yaml package.json pnpm-workspace.yaml vitest.config.ts | tests | none | not changed: no dependency is added, and the config's kalfa test globs (plain and integration) already reach the new files |

**Beside the kalfa pull requests in flight.** None of the three touches a file here.

- https://github.com/kamp-us/tea-fabrika/pull/2315 (Git rebase) and
  https://github.com/kamp-us/tea-fabrika/pull/2365 (Git fetch with a credential) hold only their plans so far. Their
  builds may add `kalfa/git` overrides to `.oxlintrc.json`, in another block; whichever lands second rebases, and the
  lead reruns `pnpm lint`.
- https://github.com/kamp-us/tea-fabrika/pull/2326 (Config's folder clean-up) adds new `kalfa/config` test files that
  import `runsFor` from `@kampus/vitest`, and lists `.oxlintrc.json` and `pnpm-lock.yaml` as not changed. No file
  overlaps this plan. Its new files are more for #2235's sweep to move, which #2235 finds by search.

## Existing tools

The five new product files, each a copy, searched the same way:

- kalfa/quality/src/vitest/index.ts: searched as below; the copy of `@kampus/vitest`'s root.
- kalfa/quality/src/vitest/Depth.ts: searched as below; the copy of its depth.
- kalfa/quality/src/vitest/Recorder.ts: searched as below; the copy of its Recorder.
- kalfa/quality/src/vitest/Stub.ts: searched as below; the copy of its Stub.
- kalfa/quality/src/vitest/TestDatabase.ts: searched as below; the copy of its test database.
- What was searched for all five: the repo, for test helpers
  to wrap or reuse (`next/packages/vitest/src`, and the 47 test-support files across the kalfa packages: none holds a
  depth, a recorder, a stub or a test database; Config's and Stryker's are in-memory file systems). The one source is
  `@kampus/vitest`, and these are its files copied. Re-exporting it is not possible: the Q8 lint block refuses any
  `@kampus/*` import in `kalfa/quality/**`, and the ticket says the code is copied. Searched npm's and Effect's own
  helpers too: `@effect/vitest` 4.1.3 has `it.prop` and layers but no depth, no call recorder and no stub; Effect's
  `Layer.mock` is what `Recorder.layer` is built on.
- kalfa/quality/src/vitest/Depth.ts reads the environment with `process.env`, as the copy does. Searched for a reader
  that works at module load: Effect's `Config` needs an Effect run, and the protocol rules it out for the depth.
- The two overrides in `.oxlintrc.json`: oxlint's own `no-restricted-imports`, the rule the Q8 and Q15 blocks already
  use for the same kind of check. No rule of ours is written.
- V5's and V6's span-keeping tracer: `Tracer.make` and `Effect.withTracer` from effect 4.1.3 (`effect/dist/Tracer.d.ts`
  `make`, `Effect.d.ts` `withTracer`). No helper is written for it.

## Calls taken

- **Copy, not re-export or move.** 97% sure. The ticket says copy, issue 1866 keeps `next/` on its own code, and the
  Q8 lint block refuses `@kampus/*` in `kalfa/quality/**`.
- **The folder is `src/vitest/`, beside `src/stryker/`.** 90% sure. One folder per tool is how the package is laid out
  (its README: "one subpath per tool").
- **Doc comments lose the old decision, ticket and experiment numbers and our paths.** 85% sure. None of those numbers
  is in `.kalfa/decisions/`, and the protocol asks the same of the lint rules that move (neutral messages, no ticket
  numbers). Each reason stays in words.
- **The empty string still fails, as any other word.** 85% sure. That is today's behavior; a workflow that passes an
  empty input then fails loudly instead of running fast unseen.
- **The ids get the new package's name.** 90% sure. Two packages that share a store key could read each other's
  records in a test that loads both, which #2235's half-moved state allows.
- **The import rules are lint, in two overrides.** 85% sure. The doubt is V4's file list, which a fifth root file must
  join by hand; V2's type law backs it.
- **Laws may import the package by its own name.** 85% sure that TypeScript's `NodeNext` resolution finds
  `@kalfa/quality/vitest` from inside the package through its `exports` (Node's self-reference). Only type imports
  use it, so vitest never has to resolve it. If the typecheck refuses it, the fallback is relative imports in the type
  laws plus one check that reads `package.json`'s `exports`.
- **Is this a setting?** The depth is one, named by the protocol and read from the environment only. The two words,
  `LEAST` (3) and the store key prefix are not: the words are the setting's values, `LEAST` is the floor that makes a
  fast count still a test (a repo that wants fewer cases writes a smaller `full`), and the prefix is an id. 80% sure on
  `LEAST`.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run kalfa/quality/src/vitest/Depth.test.ts
  kalfa/quality/src/vitest/Recorder.test.ts kalfa/quality/src/vitest/Stub.test.ts` red on the branch head, since the
  modules do not exist yet; it says so in its plant record. `pnpm lint` shows V3 and V4's plants red once the build's
  files exist. The integration file is not run on the laptop.
- Build step: the same three files green; each plant above run once and undone; `pnpm lint` green; the try's three
  runs, with their output in the report.
- The lead checks `git diff --stat origin/main -- next/packages/vitest` is empty.
- The lead runs one typecheck, for V2 and the copied type laws.
- The lead runs the changed set, which the laptop may refuse since `.oxlintrc.json` and a manifest change; the lead then names the files above.
- The lead starts a proof run of `TestDatabase.integration.test.ts` before merge.

## Size

1. One pull request: about 475 product lines (`Recorder.ts` 239, `TestDatabase.ts` 105, `Depth.ts` 66, `Stub.ts` 32,
   `index.ts` 30, `package.json` 3), nearly all copied, plus the README section, eight test files (seven copied,
   three of them grown by a law, and one new) and two lint overrides. It lands whole: the entry points without their laws prove nothing, and
   #2235, #2236 and #2246 each wait on all of it.

About 1.5 agent hours across tests, build and review, 85% sure. The doubt is lint findings on the copied files under
kalfa's rule set, which may take one round. Basis: Opus steps at about $7 each for mostly copied code, against the
reference plan's $8 for new code: tests, build and review, plus one likely send-back of the build.

Estimate: 4 steps, $28

## New names

None. Depth, Recorder, Stub and Test database are in `kalfa/quality/GLOSSARY.md` already. `index.types.test.ts` is a
test file named for what it checks. `KALFA_QUALITY_VITEST_DEPTH` is the protocol's name.

## Records

- **The try's answer**, which the lead posts on https://github.com/kamp-us/tea-fabrika/issues/2234 and
  https://github.com/kamp-us/tea-fabrika/issues/2238 once the build has run it. A draft, to fix with what the run
  shows:
  - "Does vitest's list mode carry a law's option? Run on vitest 5.0.5, three ways, on a scratch file with two laws
    whose bodies throw: `vitest list --json` (static parse, the default) printed name, file and location only; with
    static parsing off, the same; through the node API, `collect(..., { staticParse: false })`, `TestCase.meta()` gave
    the `meta` option back whole and dropped a top-level `plants` key. No body ran. So #2238 gathers plants through the
    node API with static parsing off, and a law's `plants` travel inside `meta` (vitest's `TaskMeta` takes a declared
    key). Vitest 4 and later take options only as a test's second argument; `@effect/vitest` passes its third there."
- **The README section** for `/vitest`, in the files table.
- No decision record: the protocol and the owner's answers on issue 1763 are the decisions. No glossary change. No
  pattern change: `.kalfa/patterns/a-law-watches-calls-with-a-recorder.md` still names `next/packages/vitest`, which
  stays true until #2235 moves callers; #2235 updates its `where` line.

## What fact is lost if it is not recorded now

What the try saw. #2238 picks how to gather plants from it, and if the answer is only in a builder's report, the
next agent reads vitest's source again or builds the gathering on the CLI's `--json`, which carries no option. The
lead's comment on both tickets keeps it.

## What this cannot tell us

- Whether `meta` crosses from the worker to the main process whole during collection, until the try runs. If it does
  not, #2238 "finds another way to gather them, and the design stays the same", as its ticket says.
- Whether a law that reads the depth works in vitest's browser mode, where `process` may be missing. The copy keeps
  today's `process.env` read; nobody runs our laws in a browser yet.
- How the copied laws fare under kalfa's lint block until the tests step runs `pnpm lint`; `next/`'s block left some
  rules off that kalfa's test block keeps on.
- Whether `vi.resetModules()` makes a fresh `Depth.ts` on each case; the tests step's first red run shows it, and the
  query-string import is the fallback.

## Open questions

None.

Each choice picks how the code does what the ticket, the protocol on issue 1763 and the owner's answers there
already say.

## Findings

1. **For #2236 and #2238: vitest's static list shows a test only as its source writes it.** The static parser reads a
   test's title from the source text and gives `meta: {}`
   (`vitest/dist/chunks/index.1TqnEahn.js`, `astParseFile` and `astCollectTests`). So a label that a wrapper adds to
   the printed name at run time (#2236, "the printed name still carries the label") does not show in a default
   `vitest list`, only in a run or in a list with static parsing off. Its `getName` walks a member chain down to the
   first name (`it.effect.scenario` is read as `it`), so the laws are still found; only their printed names differ.
   Not checked by a run; #2236's plan should run `vitest list` both ways.

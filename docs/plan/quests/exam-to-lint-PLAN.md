Approved by the lead agent, builds 0591, 0590; body 5d3969f6e1bd
Plancheck-Version: 3

# Plan: the exam's code-shape checks become lint rules, a text-reading law declares `reads:`, and the `readers` list goes (0591)

This is `next/` and our tooling (`oxlint-plugins/`, `vitest.config.ts`, `.github/ci/`). Today's app
is not changed. It is a named job of the sev0 the owner called on 2026-11-15, and it builds
[0591](../../../.decisions/0591-exam-shape-checks-become-lint-rules-and-text-reads-are-declared.md),
which amends [0590](../../../.decisions/0590-a-branch-proof-run-runs-only-what-its-change-reaches.md)
point 4. 0591 names no ticket and pull request 1499 names none, so this plan uses 591.

```ts
// The whole idea, as a sketch. Before: a shape check is a test in next/'s exam folder, and CI keeps
// a hand list of the tests that read files as text.
//   next/apps/fabrika/src/exam/no-of.integration.test.ts   plants files, runs oxlint, reads fires
//   .github/ci/changes.mjs: export const readers = ["next/apps/fabrika/src/exam/", ...]
// After: the shape check's plants are the rule's own test, and a law that still reads a file as text
// says so on its declaration, beside 0580's plant and label. Vitest's changed set follows `reads`
// like an import, so no list is kept by hand.
law("the browser entries bundle with no node: import", {
  scenario: "the real top levels of next/, bundled once",
  plant: "an import of node:fs in libfabrika's index",
  reads: ["next/packages/*/package.json", "next/packages/libfabrika/src/**", "next/programs/*/src/**"],
}, () => { /* ... */ });
```

## Doubts, first

- **One exam check held nothing, so its hits are fixed before its rule turns on.**
  `laws-scan.integration.test.ts` asks that every file that calls `defineMachine(` has a laws file
  beside it that imports `@demlik/tea/pbt` and runs `syncTest(` or names why not. No file in
  `next/` calls `defineMachine(` any more: `rg -l "defineMachine" next` finds only the test itself,
  and 35 product files make a machine with `Machine.make(`. 0579 moved property laws to `it.prop`,
  so a laws file need not import `@demlik/tea/pbt` either. The law passes because it finds no
  machine. A check that checks nothing is not kept, and none is dropped: it becomes the lint rule
  `fabrika/machine-has-laws` on `Machine.make(`, whose 30 hits on main are fixed first (slice E,
  listed below), so the rule turns on at zero (0524).
- **Moved rule tests leave the merge line's `next` job.** The exam's plant tests are in the `next`
  project today, and the merge line runs them when a lint file changes (`changes.mjs`'s `lint`
  gives scope `readers`). In `oxlint-plugins/` they are `tooling` tests, which no merge-line event
  starts (0539). What covers them is 0590's proof run: the `oxlint-plugins/` folder is a rerun trigger, so a
  change to a rule runs the full set, `tooling` included, and `land.ts arm` needs that run green at
  the head. That is pull request 1496, still a draft. So this sweep's one pull request lands after
  1496. My call, 85%: the other way, keeping each rule's plants in `next/`, keeps the shape check a
  `next/` test, which 0591 point 1 refuses.
- **Two lint commands stay in `next/`.** `compiler.ts` (`pnpm lint:compiler`) imports libfabrika's
  Compiler check, and `twin.ts` (`pnpm lint:twin`) reads the installed source of
  `@alchemy.run/cloudflare`, which only the app depends on. `oxlint-plugins/` imports no package of
  ours, and the root map says to import a package by its name, never by a path. They are lint
  already (both are steps of `pnpm lint`), so they stay where their imports are. My call, 80%.

## Searched first

- `node .agents/skills/lead/scripts/records.ts find` for "exam shape checks lint rules", "test reads
  files as text declares reads", "readers list changes.mjs", "lint rule replaces test plants" and
  "addWatchFile changed related tests". The records that govern this, each checked with
  `records.ts resolve` and in force: 0591; 0590 (amended by 0591); 0580 (the law's options);
  0573, amended by 0575 (a trusted rule replaces ours); 0093 (plants run once, amended by 0523,
  0527 and 0580); 0524 (no list lets broken code pass); 0006 (unused exports, amended by 0524);
  0408 (a rule code checks leaves the prose); 0523 (old advice rules block where clean); 0536,
  amended by 0581, 0584 and 0590 (real-resource laws are `.integration.`); 0581 (main's full
  run); 0033 (our tooling follows `next/`'s rules); 0113 (no new shell or Python script); 0099; 0076.
- Every one of the 47 files in `next/apps/fabrika/src/exam/` on main at `0683861`, read whole; the
  rules and harnesses in `oxlint-plugins/` they lean on (`plants.test.ts`'s "elsewhere" list,
  `builtin-plants.ts`, `no-of.test.ts`, `no-wall-clock.test.ts`); `.github/ci/changes.mjs`
  (`readers`, `scope`, `filterOf`, `selectionOf`, the `--same` probe), `.github/ci/legs.ts`
  (`withReaders`), `vitest.config.ts` (`forceRerunTriggers`, the `githubReads`, `scriptReads` and
  `shardTable` plugins) and `vitest.changed.ts`; the six other `readers` entries; and
  `package.json`'s `lint` script.
- The 0573 plan on `fabrikalfa/trusted-rules-0573` (pull request 1498), the 0580 plan on
  `fabrikalfa/law-options-0580` (pull request 1497), and pull request 1496's `proof.ts`, which
  imports `readers` from `changes.mjs`.

## How others do it

- **A lint rule's own tests sit beside the rule.** ESLint's and oxlint's way is a `RuleTester` file
  per rule with valid and invalid cases ([ESLint, RuleTester](https://eslint.org/docs/latest/integrate/nodejs-api#ruletester);
  oxlint's JS plugin docs, `oxlint/plugins-dev`). Our rule tests in `oxlint-plugins/` already do that,
  and also plant files through the real `.oxlintrc.json` where a path or override is the subject.
  The exam's files are the second kind, in the wrong folder.
- **A file a test reads without importing it is the bundler's watched file.** Vite's plugin API
  has `this.addWatchFile(path)` in `transform`, which adds the file to the module graph as a
  dependency of the module being transformed ([Vite, plugin API, Rollup's
  `addWatchFile`](https://rollupjs.org/plugin-development/#this-addwatchfile)); Vitest's
  `--changed` walks that graph. This repo already does it three times in `vitest.config.ts`:
  `githubReads` (tooling tests that read `.github/`), `scriptReads` and `shardTable`. `reads:` is
  the same move with the list on the law instead of a pattern in the config. Bazel's `data`
  attribute on a test target is the same idea: a test names the files it reads at run time, and
  the build graph treats them as inputs ([Bazel, common attributes,
  `data`](https://bazel.build/reference/be/common-definitions#typical.data)). Not fetched today;
  from memory.
- **Vitest's `forceRerunTriggers`** stays for the files that change every test's meaning (the
  config, the lockfile, a tsconfig), as 0590 point 3 says; 0591 keeps a per-law read off that list.

## What is decided, and what this plan calls

- 0591 point 1: each code-shape check leaves `next/` and becomes a lint rule with its tests and
  plants in `oxlint-plugins/`. 0591's Consequences: a rule that replaces an exam check proves it
  catches what the test caught, with that test's plants, before the test is deleted. So every
  moved test keeps every plant it had; "already held" needs a test elsewhere that holds the same
  plants.
- 0591 point 2: a test that still reads files as text declares them in `reads:` on its law. 0591's
  own examples are the build and bundle tests, `settings-generated.test.ts`, bundle output and the
  commit chain.
- 0591 point 3: the `readers` list goes once points 1 and 2 land.
- **Three classes, and one more that is no check at all.** Nine files in the exam folder check no
  code shape and read no file as text: the CI tools `edges.ts` and `ratchet.ts` with their laws on
  planted git repos, and the runner contract laws, which reach libfabrika by import. 0591 point 1
  covers code-shape checks and point 2 covers text reads, so neither applies: they stay where they
  are, reached by Vitest's import graph, and `readers` loses nothing by them. My call, 85%: it
  passes the open-questions test, since no decision asks them to move.
- **A law that reads only a rerun trigger declares nothing.** `.oxlintrc.json`, `tsconfig.base.json`,
  `layer-rules.json`, the lockfile and the `oxlint-plugins/` folder are in `forceRerunTriggers`, so a change
  to one runs every test. A `reads:` entry for one would change no run. My call, 80%; the cost is a
  reader of the law sees the read only in its body.
- **The first draft's two questions are settled by rules in force.** A check that checks nothing is
  not kept and none is dropped, so `laws-scan` becomes `fabrika/machine-has-laws` with its hits
  fixed first (0524). A check on code shape is a lint rule (AGENTS.md, "Checks", and 0591's own
  principle), so `build.test.ts` and L9 go to lint and only the generated-files law keeps `reads:`.
- **Is any of this a setting?** No. Each choice is a lint rule, a law's option or CI's own logic,
  not a value a person running fabrika picks in `fabrika.toml` (0069).

## The 47 files

Each row is one file of `next/apps/fabrika/src/exam/` on main at `0683861`. "Lint" means the check
is a lint rule or a `pnpm lint` step, existing or new, and the file's laws become that rule's tests
with every plant kept. "Reads" means lint cannot hold it, the file stays a test, and its laws
declare the files in the cell. "No check" means the file checks no code shape and reads no file as
text. Paths in the cells are from the top of the repo.

| Exam file | Class | Where it goes, and its proof |
|---|---|---|
| agent-may.test.ts | reads | Behavior laws on the real Gateway, by import. One pending law asks whether P25's policy files exist yet (`fs.exists` on five paths), which no import sees. Declares `next/packages/libfabrika/src/mcp/**`, `next/packages/libfabrika/src/mcp.ts`, `next/apps/fabrika/mcp.ts`, `next/apps/fabrika/src/mcp.ts`, `next/apps/fabrika/src/mcp/**` |
| agents.test.ts | reads | The same five presence paths, for P25's agent tools; the rest is by import |
| alchemy-lifecycle.test.ts | reads | A `format:` law pins the lifecycle patch's registration and hash; it reads `pnpm-workspace.yaml`, `pnpm-lock.yaml` and the patch file. The first two are rerun triggers; it declares `patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch`. The runtime law runs Alchemy's real code, which no rule can |
| bytes.integration.test.ts | reads | Bundle output: it watches every Rolldown call of the real one-file build. Rolldown reads the build's inputs as files. Declares `next/apps/fabrika/src/**`, `next/programs/*/src/**`, `next/programs/*/package.json`, `next/packages/libfabrika/src/**`, `next/packages/tuval/src/**` |
| client-manager-contract.integration.test.ts | reads | Bundles `ClientManager.ts` for a browser per export selection and checks tree shaking; an import graph cannot see what a bundle keeps. Declares `next/packages/libfabrika/src/**` |
| clock.integration.test.ts | lint | `react/purity` and `fabrika/no-clock-in-view`, both on today. The `no-clock-in-view` plants go to `oxlint-plugins/no-clock-in-view.test.ts` (new); the `react/purity` lines join `builtin-plants.ts` as a `.tsx` plant at a `next/` path. `no-wall-clock.test.ts` plants three `no-clock-in-view` lines at paths, not these |
| commits-git-chain.integration.test.ts | reads | The commit chain on planted git repos. Through the support file it reads the real `exam-paths.json`; declares it |
| commits-git-person.integration.test.ts | reads | The same: declares `exam-paths.json` |
| commits-git-signatures.integration.test.ts | reads | The same: declares `exam-paths.json` |
| commits-git-steps.integration.test.ts | reads | The same: declares `exam-paths.json` |
| commits-git.test-support.ts | reads | Reads `exam-paths.json` when it loads; the four laws files above declare it, since a declaration sits on a law |
| commits.test.ts | reads | Pure laws on the chain by import, and a `format:` law and P12 that read `exam-paths.json`; declares it |
| commits.ts | reads | The CI program the chain laws run (`pnpm commits`); not a test, stays, read by its laws by import |
| compiler.test.ts | lint | Laws of `pnpm lint:compiler`'s `check`, which is libfabrika's. By import only, so they move beside it as `next/packages/libfabrika/src/node/build/compiler.test.ts`, every case kept |
| compiler.ts | lint | `pnpm lint:compiler` itself, a step of `pnpm lint` today. Stays (doubt 3) |
| deps.integration.test.ts | reads | Splits. Its manifest faults (private, `0.0.0`, no side effects, a typecheck, nothing of today's) become a lint command `oxlint-plugins/next-manifests.ts`, and its import faults (unlisted, outside an exports map, a relative path out of the package, `electron` outside the entry, a file in no package) a new rule `fabrika/package-deps`, each with the file's planted trees. Its five bundle laws stay, as bundle output: declares `next/*/*/package.json`, `next/packages/libfabrika/src/**`, `next/packages/tuval/src/**`, `next/programs/*/src/**` |
| edge-comment.integration.test.ts | lint | `fabrika/edge-comment`, on today. Its twelve planted comments, the unused-comment law and the five `.oxlintrc.json` laws go to `oxlint-plugins/edge-comment.test.ts` (new). The config laws read only `.oxlintrc.json`, a trigger |
| edges.integration.test.ts | no check | Laws on CI's `edges` step (`asks`) and the script on a planted repo, by import |
| edges.ts | no check | CI's `edges` step, which lists new edge comments and never blocks |
| effect-checks.test.ts | reads | Pins that `tsconfig.base.json` sets `globalFetchInEffect` and `globalDateInEffect` at `error` for `next/`. A trigger file, so it declares nothing; it moves to `oxlint-plugins/`, beside 0573's planned `effect-checks-held.test.ts` (its L4 is the same shape for two other checks), and joins that file's list once 0573's pull request 1 is on main |
| effect-functions.integration.test.ts | lint | `fabrika/effect-functions`, on today; plants to `oxlint-plugins/effect-functions.test.ts` (new). Its last law is on `edges.ts`'s `asks` span, no shape check: it moves to `edges.integration.test.ts` |
| laws-scan.integration.test.ts | lint | New rule `fabrika/machine-has-laws`, keyed on `Machine.make(`, with the old planted folders rewritten to today's constructor and laws (see "The machines to fix first"). Turns on after slice E brings its 30 hits to zero |
| layers.integration.test.ts | lint | The laws of `pnpm lint:layers`'s rule file and patched code-graph on planted trees. Moves to `oxlint-plugins/layers.test.ts`; reads `layer-rules.json`, a trigger, and runs the patched tool, which the lockfile pins |
| ledger-sql.integration.test.ts | lint | `fabrika/no-ledger-sql`, on today; its generated plants to `oxlint-plugins/no-ledger-sql.test.ts` (new) |
| no-effect-run-outside-edge.integration.test.ts | lint | `fabrika/no-effect-run-outside-edge`, on today; plants, the 18 old edge paths included, to `oxlint-plugins/no-effect-run-outside-edge.test.ts` (new) |
| no-hand-tag.integration.test.ts | lint | `fabrika/no-hand-tag`, on today; plants to `oxlint-plugins/no-hand-tag.test.ts` (new). The one overlap with 0573: its plan's pull request 2 swaps the rule for the anti-slop pair after their 20 hits reach zero, and deletes this test with it, at its new path |
| no-of.integration.test.ts | lint | `fabrika/no-of`, on today. `no-of.test.ts` holds the shapes in RuleTester; the exam's path laws (tests held too, a module's own `of`, a named import) join it through the real config |
| no-promises.integration.test.ts | lint | Two halves of `fabrika/no-promises`: the oxlint plants go to `oxlint-plugins/no-promises.test.ts` (new); the typed laws go with `promise-types.ts` to `oxlint-plugins/promise-types.test.ts`. Both read only temp folders and installed type files |
| node-kinds.test.ts | lint | New lint command `oxlint-plugins/node-kinds.ts` in `pnpm lint`: every name in `node-kinds.json` is exported by a file its glob matches and bound by that string elsewhere in `next/`. Its plant: a made-up name |
| object-imports.integration.test.ts | lint | `eslint/no-restricted-imports` in the `cloudflare/objects.ts` block, on today; the generated plant joins `plants.test.ts` |
| one-store-hook.integration.test.ts | lint | `fabrika/one-store-hook`, on today; plants and the no-crash run to `oxlint-plugins/one-store-hook.test.ts` (new) |
| plant.ts | lint | The harness that lints planted files with the real config. Eleven `oxlint-plugins/` tests import it by path today; it moves to `oxlint-plugins/plant.ts` |
| promise-types.ts | lint | `pnpm lint:promise-types`, the typed half of `no-promises`, a step of `pnpm lint` today. Needs only `typescript` and `effect`, so it moves to `oxlint-plugins/promise-types.ts` |
| ratchet.integration.test.ts | no check | Laws on CI's list ratchet on a planted repo, by import |
| ratchet.test-support.ts | no check | Shared rows for the ratchet's laws |
| ratchet.test.ts | no check | Laws on the ratchet's core, by import |
| ratchet.ts | no check | CI's ratchet on the list files (0524) |
| react-rules.integration.test.ts | lint | `react/refs`, `react/immutability`, `react/display-name`, on today in `next/**/*.tsx`. No plant holds them now (`rg -F "react(refs)" oxlint-plugins` finds none); the lines join `builtin-plants.ts` as a `.tsx` plant |
| rows.test.ts | reads | Laws of the row reader by import, and one `vector:` law on the real `layer-rules.json`, a trigger, so it declares nothing |
| rows.ts | reads | The row reader the lead's `movecheck.ts` imports; stays |
| runner-contract-replay.test.ts | no check | Behavior laws on libfabrika's runner and Gateway, by import |
| runner-contract.test-support.ts | no check | Their shared world, by import |
| runner-contract.test.ts | no check | Behavior laws on the runner's refusals, by import |
| secret-types.integration.test.ts | lint | A typed check: a secret read must enter `Redacted` at its source. oxlint's JS plugins have no types and `oxlint-tsgolint` is refused, so it becomes part of the typed lint command beside `promise-types.ts`, which already opens every `next/` project: the real-tree law becomes the command's run in `pnpm lint`, the planted law its test |
| tsconfig-scope.integration.test.ts | lint | Every tracked TypeScript file of a `next/` package is in the program its `typecheck` checks. Joins the same typed command, which holds every `next/` program already; the planted laws become its tests |
| twin.integration.test.ts | lint | Laws of `pnpm lint:twin`. They plant beside the real stack's text, so they stay beside `twin.ts` and declare `next/apps/fabrika/alchemy.run.ts`. Its last law, "pnpm lint:twin checks the real stack", is already held: `pnpm lint` runs `lint:twin` (`package.json`'s `lint` script), and `pnpm -s lint:twin` printed `lint:twin: 0 findings` at `0683861`. That one law goes |
| twin.ts | lint | `pnpm lint:twin`, a step of `pnpm lint` today. Stays (doubt 3) |

Counts: lint 22, already held 0 (one law inside `twin.integration.test.ts` is), reads 16, open 0,
and 9 files that are no check. No exam file is held by a 0573 trusted rule today: 0573's pull
request 1 swaps four rules no exam file plants, and `no-hand-tag`, the one overlap, waits on that
plan's pull request 2.

## The shape

### `reads:` on a law, beside 0580's options

```ts
// next/packages/vitest/src/Law.ts, the file 0580's slice 1 builds. A sketch of the one key added.
export type LawOptions = Omit<V.TestOptions, "meta" | "skip" | "only" | "todo" | "fails"> &
  Labeled & {
    readonly plant?: string;
    /** Files this law reads as text, not by import: globs from the top of the repo (0591). */
    readonly reads?: ReadonlyArray<string>;
  };

declare module "vitest" {
  interface TaskMeta {
    plant?: string;
    label?: Label;
    reads?: ReadonlyArray<string>;
  }
}
```

- `reads` goes into `meta` as 0580's two keys do, so a reporter can read it.
- **The changed set reads it from the source, not from `meta`.** Vitest picks the changed set
  before any test runs, so the declaration must be readable without running the file. A literal
  array of string literals is the only form: a Vite plugin in `vitest.config.ts`, `lawReads`, parses
  each test file with `oxc-parser` in `transform`, finds every `reads` key in an object literal
  passed to a law, globs the tracked files with Vitest's own picomatch, and calls
  `this.addWatchFile` on each, as `githubReads` does today. A `reads` value that is not a literal
  array of literals throws in the plugin, so the run fails closed. My call, 80%.

```ts
// vitest.config.ts, a sketch.
const lawReads: Plugin = {
  name: "fabrika-law-reads",
  transform(code, id) {
    const path = relative(root, id);
    if (!isTest(path) || !code.includes("reads")) return null;
    for (const file of tracked().filter((f) => readsOf(path, code).some((glob) => match.isMatch(f, glob, { dot: true })))) {
      this.addWatchFile(join(root, file));
    }
    return null;
  },
};
// readsOf(path, code): string[], pure, in vitest.reads.ts beside vitest.changed.ts, so CI's
// `--same` pass and the laws below call the same function.
```

- **A support file's reads are declared by the laws that use it.** `commits-git.test-support.ts`
  reads `exam-paths.json` when it loads; its four laws files each declare it.

### The `readers` list goes

```js
// .github/ci/changes.mjs, after. `readers` and `filterOf`'s readers branch go. Scope "readers"
// stays a scope: what a proven next/ change or a lint change needs is the tests whose declared
// reads it touches, which only the `--same` pass (after its install) can list, with readsOf.
/** @typedef {"none" | "readers" | "all"} Scope */
```

- `lint(path)` today gives scope `readers` because the exam's plant tests read `.oxlintrc.json` and
  `oxlint-plugins/`. Once they are in `oxlint-plugins/`, no `next/` test reads a lint file, so a
  lint change needs none of `next/`: `lint(path)` gives `none`, and its own tests run in the proof
  run, where the `oxlint-plugins/` folder is a trigger (doubt 2).
- A proven comment-only `next/` change (the `--same` pass) runs the tests whose `reads:` match a
  proven path, from `readsOf` over `next/`'s test files; with none, it runs no `next/` test.
- `legs.ts`'s `withReaders` and pull request 1496's `proof.ts` use of `readers` go:
  `vitest list --changed` already holds a declared reader, through `lawReads`.

## One value traced

1. A build step edits `next/packages/libfabrika/src/index.ts`, adding `import "node:fs"`.
2. Today: `vitest --changed` picks libfabrika's importers, and the next job adds every `readers`
   test by hand, the whole exam folder among them.
3. After: `vitest --changed` loads `deps.integration.test.ts`; `lawReads` parses its bundle law's
   `reads: ["next/packages/libfabrika/src/**", ...]`, and `index.ts` matches, so the file is a
   watched file of the test and the test is in the changed set. `no-of`'s plants are not: they now
   live in `oxlint-plugins/`, which this change does not touch.
4. The bundle law runs, finds `node:fs` reached from `@kampus/libfabrika`, and fails.

## Laws

Kind per law, as AGENTS.md asks: a shape check is `lint`. A moved plant test keeps its old file's
plants as written: each is a fixed input labeled `scenario:` or keeps its generator. Each plant
below is run once and restored by the step that writes the law (0093).

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1. Each moved rule test fires on every line its exam file fired on, at the same paths, and passes every line that passed, through the real `.oxlintrc.json` | test | scenario: each exam file's own planted files, copied whole; the generated ones keep their fast-check seed 119120 and runs | before the old file goes, delete one firing branch of its rule (say `no-of`'s class-name visitor): the moved test and the old one go red together; restored | oxlint-plugins/no-clock-in-view.test.ts oxlint-plugins/edge-comment.test.ts oxlint-plugins/effect-functions.test.ts oxlint-plugins/no-ledger-sql.test.ts oxlint-plugins/no-effect-run-outside-edge.test.ts oxlint-plugins/no-hand-tag.test.ts oxlint-plugins/no-of.test.ts oxlint-plugins/no-promises.test.ts oxlint-plugins/one-store-hook.test.ts oxlint-plugins/plants.test.ts oxlint-plugins/builtin-plants.ts oxlint-plugins/layers.test.ts |
| M2. The typed command refuses an unmarked Promise, a secret read outside `Redacted`, and a tracked `next/` file no program holds, and exits 0 on `next/` at the build's head | test | fc.stringMatching: the exam files' own generators, seed 119120, their old run counts, at least 3 runs, moved whole | drop the `marked` line check, the `~effect/Redacted` test, or one package from the opened projects: red | oxlint-plugins/promise-types.test.ts |
| M3. `node-kinds.ts` refuses a name no matching file exports or no string binds, and exits 0 on the real list | test | fc.stringMatching: a made-up name `/^[A-Z][a-zA-Z]{2,12}$/`, seed 119120, 20 runs | skip the binding check: red | oxlint-plugins/node-kinds.test.ts |
| M4. `next-manifests.ts` and `fabrika/package-deps` fire on each manifest and import break of the old planted trees and on nothing else; the exports-map laws keep Node's longest-pattern rule | test | fc.constantFrom: the old trees and module names, seed 119120, the old run counts, at least 6 runs | pick the first exports key that fits, not the longest: red | oxlint-plugins/next-manifests.test.ts oxlint-plugins/package-deps.test.ts |
| M5. Every new lint command and rule has 0 findings on main at the build's head, so it blocks at zero (AGENTS.md "Checks") | lint | lint | add one break in a scratch copy of a real file: `pnpm lint` exits 1 | package.json .oxlintrc.json |
| R1. `readsOf` answers exactly the literal globs of every `reads` key in a law's options, in any spelling of the declaration, and throws on any other value | test | fc.array: generated globs from fc.stringMatching, placed in generated law calls (`it`, `it.effect`, `it.prop`), seed 119120, 100 runs | read only the first `reads` in a file: red | vitest.reads.test.ts |
| R2. A test whose law declares a glob is in `vitest list --changed` when a tracked file it matches changes, and not when none does | test | fc.record: a glob and a path drawn to match it or not, seed 119120, 50 runs, on a planted tree | drop the `addWatchFile` call: red | vitest.reads.test.ts |
| R3. `reads` is a key of `LawOptions`, typed as a list of strings, and lands in `meta` | type | type | type `reads` as `unknown`: an `@ts-expect-error` goes unused | next/packages/vitest/src/Law.types.test.ts |
| R4. The removal is safe: every path the old `readers` list named, expanded to its test files at the removal's head, is gone, sits in `oxlint-plugins/`, reads only rerun triggers, is one of the nine "no check" files, or declares `reads:` that cover each file it reads | test | scenario: the seven entries as main has them at `0683861`, written once into the law as its `vector:` input | delete the `reads` entry from `bytes.integration.test.ts`: red | .github/ci/changes.test.ts |
| R5. A proven comment-only `next/` change runs exactly the tests whose declared reads it matches, and a lint-file change needs no `next/` test | test | fc.subarray: the tracked test files, with proven paths from fc.constantFrom, seed 119120, 100 runs | keep `lint(path)` at `readers`: red | .github/ci/changes.test.ts |
| R6. `readers` is gone from `changes.mjs`, `legs.ts` and `proof.ts`, so nothing keeps a list by hand | lint | lint | leave `export const readers` in `changes.mjs`: `pnpm lint:dead` refuses the unused export (0006) | .github/ci/changes.mjs .github/ci/legs.ts .github/ci/proof.ts |
| M6. `fabrika/machine-has-laws` fires on a product file in `next/` that calls `Machine.make(` and has no sibling `<name>.laws.test.ts`, `<name>.<more>.laws.test.ts` or their `.integration.` and `.visual.` forms holding a property law (`it.prop`, `it.effect.prop`, `it.live.prop`, `fc.assert` or tea's pbt runners), or whose laws files neither call `syncTest(` nor say `// sync test left out: <why>` with a reason; it passes the rest, and test files | test | fc.constantFrom: the twelve planted folders and the three laws-file forms, seed 119120, 24 runs | accept a laws file with no sync test and no reason: red | oxlint-plugins/machine-has-laws.test.ts |
| M7. `fabrika/one-page-runtime` fires on `next/apps/fabrika/src/entry/browser.tsx` unless it imports `runMain` from `@kampus/tuval/browser` once, starts it once as a statement of the module, and calls no other `run*` | test | scenario: the real entry and the four planted entries of the plants table | count a `runMain` inside a component as the start: red | oxlint-plugins/one-page-runtime.test.ts |
| M8. `eslint/no-restricted-imports` refuses each import of the TOML adapter or its parser a caller may not make, in every spelling, and passes the rest | test | fc.uniqueArray: the generated callers and spellings of L9, seed 119120, 100 runs | drop the start test file from the adapter's allowed files: red | oxlint-plugins/settings-imports.test.ts |

- M1 is the proof 0591 asks for before a test is deleted: the old and the new file run on the same
  plants, side by side, in the tests step's box, once, before the old file goes.
- No law needs the real machine, so none is host-only. `bytes`, `client-manager-contract`,
  `deps` and the commit chain keep their `.integration.` names (0536).
- No law reads a secret.

## The machines to fix first

`fabrika/machine-has-laws` has exactly 30 hits on main at `0683861`, counted with the rule's own
definition (M6) by a scan of the 35 product files that call `Machine.make(`. The tests step
recounts with the rule itself before slice E starts; a different count is reported, not fixed in
silence. Every fix writes or edits a laws file, an exam path, so slice E is the tests step's.

No laws file beside the machine (14). Each gets `<name>.laws.test.ts` with a property law over its
messages and a `syncTest(` call, or a reason its sync test is left out. `Access.ts` is the one whose
laws exist under another name, `AccessMachine.laws.test.ts`, which moves with `git mv` to
`Access.laws.test.ts`.

- next/packages/libfabrika/src/access/Access.ts
- next/packages/libfabrika/src/gateway/internal/rateLimit.ts
- next/packages/libfabrika/src/gateway/internal/waiting.ts
- next/packages/libfabrika/src/node/dev/internal/watcher.ts
- next/packages/libfabrika/src/packs/internal/open.ts
- next/packages/libfabrika/src/permissions/internal/relationsTable.ts
- next/packages/libfabrika/src/runtime/ChaosMachine.ts
- next/packages/libfabrika/src/runtime/internal/handsDelivery.ts
- next/packages/libfabrika/src/runtime/internal/reply.ts
- next/packages/libfabrika/src/runtime/internal/watchers.ts
- next/packages/libfabrika/src/schedules/ScheduledJob.ts
- next/packages/libfabrika/src/tasks/internal/task.ts
- next/packages/libfabrika/src/telemetry/internal/sink.ts
- next/packages/libfabrika/src/transport/internal/connection.ts

A laws file with a property law and no sync test or reason (16). Each gets a `syncTest(` call,
or `// sync test left out: <why>` where the machine's model cannot round-trip, with the reason read
from the machine (S2 in `docs/direction/saved-state.md`). The laws file is named after each machine.

- next/packages/libfabrika/src/client/HandsMachine.ts
- next/packages/libfabrika/src/client/Prefix.ts
- next/packages/libfabrika/src/client/Tezgah.ts
- next/packages/libfabrika/src/client/WindowMachine.ts
- next/packages/libfabrika/src/desktop/Menu.ts
- next/packages/libfabrika/src/node/dev/DevLife.ts
- next/packages/libfabrika/src/processes/internal/processTable.ts
- next/packages/libfabrika/src/runtime/Client.ts
- next/packages/libfabrika/src/runtime/Code.ts
- next/packages/libfabrika/src/transport/Handshake.ts
- next/packages/libfabrika/src/transport/Link.ts
- next/programs/checklist/src/tile.ts
- next/programs/inbox/src/program.ts
- next/programs/pipeline/src/Merger.ts
- next/programs/pipeline/src/Queue.ts
- next/programs/tezgah/src/program.ts

A sync test that fails on a machine is a real fault the new law found: the tests step reports it,
and the build fixes the machine. That is the one place slice E may need product lines.

## The other readers, check by check

0591 names the build tests and `settings-generated.test.ts` as `reads:` examples, and AGENTS.md
says a check on the shape of code is a lint rule. Both hold: a check that lint can see becomes lint,
and only a check on what lint cannot see keeps `reads:`.

- `build.test.ts`, its one law (the page entry starts one Effect program through `runMain`, once,
  at module scope, and calls no `run*`): **lint**, new rule `fabrika/one-page-runtime`. It reads the
  entry's syntax tree and nothing else, which a rule sees. The file goes after M7's proof.
- `settings-generated.test.ts`, "format: the committed person.json, repo.json and reference are
  what generation writes": **reads**, `next/apps/fabrika/person.json`, `next/apps/fabrika/repo.json`
  and `docs/settings-reference.md`. A generated file matching its source needs the generator run,
  which lint cannot do.
- `settings-generated.test.ts`, T843 and "outputs ignore declaration order": **no check on shape**,
  laws on libfabrika's settings by import; they stay, with nothing to declare.
- `settings-generated.test.ts`, L9: **lint**, already `eslint/no-restricted-imports` in
  `.oxlintrc.json`. The law is that rule's plant test, so it moves to
  `oxlint-plugins/settings-imports.test.ts` (M8).
- `build.integration.test.ts`, `build-command.integration.test.ts`,
  `instance-one-file.integration.test.ts` and the four laws files under
  `next/packages/libfabrika/src/node/build/`: **reads**. Every text read in them is the build's
  output (`brain.mjs`), its inputs as Rolldown reads them, an installed package's manifest, a token
  file or a saved result. None checks the shape of a source file. Each read is declared in slice C.

## Plants carried, per lint row

0591's Consequences: before an exam test is deleted, the rule that replaces it proves it catches
the same things with that exam check's own plants. For each row classed lint, the table names the
plants, the law that runs them against the replacing rule, and the break that must turn it red.
No row is classed already held whole; the one held law (twin's real-stack run) is `pnpm lint`'s
`lint:twin` step, green at `0683861`, and its break is the twin laws' own plant (a Zone with no
local provider) run through `pnpm -s lint:twin` on a scratch copy of the stack: exit 1.

| Exam file | Its cases, as the exam wrote them | Law, at its new path | Break that turns it red |
|---|---|---|---|
| clock.integration.test.ts | `view` lines 2, 3, 5, 11, 15, 16 fire; `clean`, `model.ts` and the `.test.tsx` copy pass | M1, oxlint-plugins/no-clock-in-view.test.ts and the `.tsx` plant in oxlint-plugins/builtin-plants.ts | drop the handler visitor of `no-clock-in-view`; turn `react/purity` off in `.oxlintrc.json` |
| edge-comment.integration.test.ts | the 8 refused and 4 passed comments of `CASES`, the unused comment, and the five `.oxlintrc.json` laws | M1, oxlint-plugins/edge-comment.test.ts | accept `Edge:` as `edge:`; add an off line for `no-promises` on a `next/` product glob |
| effect-functions.integration.test.ts | `source` lines 3 to 9 fire, 10 to 16 pass; the alias and namespace files fire at line 2; today's and the test copy pass | M1, oxlint-plugins/effect-functions.test.ts | skip the curried-wrapper case (line 7) |
| ledger-sql.integration.test.ts | the six generated queries and the template fire at lines 1 to 7 of the runtime file; the five other files pass; fc seed 119120, 20 runs | M1, oxlint-plugins/no-ledger-sql.test.ts | stop reading bracket-quoted table names (`main.[entries]`) |
| no-effect-run-outside-edge.integration.test.ts | `RUN_LINES` 4 to 12 at the fires file and at each of the 18 old edge paths; the edge file and `dev.ts` pass | M1, oxlint-plugins/no-effect-run-outside-edge.test.ts | drop `FiberSet.makeRuntimePromise` from the run set |
| no-hand-tag.integration.test.ts | `fires` lines 2 to 7; `passes`, `ledger/Log.ts` and the test copy pass | M1, oxlint-plugins/no-hand-tag.test.ts | skip a class field named `_tag` (line 6) |
| no-of.integration.test.ts | `fires` lines 1 to 11 and 13; `passes`; `lease.ts` line 2 only; the test file line 1 | M1, oxlint-plugins/no-of.test.ts | pass a named import of `of` (line 13) |
| no-promises.integration.test.ts | the oxlint half: `fires` lines 3 to 30 as listed, `edges` 9 and 12, the unused comment at 7, `passes`, the test and today's copies; the typed half: the RPC bridge spellings, the wrapped edges and the alias cases, fc seed 119120 | M1, oxlint-plugins/no-promises.test.ts; M2, oxlint-plugins/promise-types.test.ts | skip `Stream.toAsyncIterable`; let a marker cover a whole statement |
| object-imports.integration.test.ts | lines 1 and 6 of the planted `objects.ts`, for each of the four drawn modules, seed 119120, 4 runs | M1, oxlint-plugins/plants.test.ts | drop the side-effect import form from the `objects.ts` block |
| one-store-hook.integration.test.ts | the fire lines of each of the 13 planted files as the exam lists them, and the no-crash run | M1, oxlint-plugins/one-store-hook.test.ts | drop the `void` call branch |
| react-rules.integration.test.ts | `fires` lines 3, 8 and 10 for the three rules; `passes` and the test copy pass | M1, the `.tsx` plant in oxlint-plugins/builtin-plants.ts | turn `react/immutability` off in the `next/**/*.tsx` block |
| layers.integration.test.ts | every planted tree and its expected edges, unclaimed files and exit codes, the pinned layer table and the patch scenarios | M1, oxlint-plugins/layers.test.ts | drop `roots` from the patched tool's reading; move `next-node` to layer 11 |
| plant.ts, promise-types.ts | no plants of their own: they are the harness and the command the laws above run | M1, M2 | M1's and M2's breaks |
| compiler.test.ts, compiler.ts | the eight planted views: a clean view, a ref in render, a named view with and without a row, a stale row, a clock, non-ASCII lines, a dropped store value | the moved laws, next/packages/libfabrika/src/node/build/compiler.test.ts | ignore `"use no memo"` with no row |
| node-kinds.test.ts | a made-up name the real list does not hold | M3, oxlint-plugins/node-kinds.test.ts | skip the binding check |
| secret-types.integration.test.ts | the planted entropy, Authorization and binding reads at lines 6, 7, 8, wrapped ones passing, fc seed 119120 | M2, oxlint-plugins/promise-types.test.ts | drop the `~effect/Redacted` test |
| tsconfig-scope.integration.test.ts | the planted type error at each generated path (the `P19Launchd` example first) and the generated include sets | M2, oxlint-plugins/promise-types.test.ts | open one package fewer |
| twin.integration.test.ts, twin.ts | the review 5 and review 6 forms beside the real stack, and the binding, remote and alias plants | the moved laws beside `twin.ts`, with `reads:` | treat a computed resource call as local |
| laws-scan.integration.test.ts | the planted folders `a` to `l`, rewritten to `Machine.make(`: a machine with no laws file, laws with no property law, an inline machine whose laws are another file's, laws with no sync test, an empty reason; a test file's machine and a plain file pass | M6, oxlint-plugins/machine-has-laws.test.ts | accept a laws file with no sync test and no reason |
| build.test.ts | the real entry passes; planted entries fire: no `runMain` import from `@kampus/tuval/browser`, `runMain` inside a component, a second `runMain` start, an `Effect.runPromise` | M7, oxlint-plugins/one-page-runtime.test.ts | count a `runMain` inside a function as the module's start |
| settings-generated.test.ts (L9) | the generated callers and import spellings of the TOML adapter and its parser, seed 119120 | M8, oxlint-plugins/settings-imports.test.ts | drop `src/settings-start.integration.test.ts` from the adapter's allowed files in `.oxlintrc.json` |
| deps.integration.test.ts (its lint half) | the manifest and import breaks of the planted trees, the exam's own files outside a package, and the exports-map cases | M4, oxlint-plugins/next-manifests.test.ts and oxlint-plugins/package-deps.test.ts | pick the first exports key that fits, not the longest |

**The deletion comes last, per file.** The tests step, for each row: (1) runs the new law on the real
code at its head, green; (2) runs it once under each break above, red, and puts each red result in
its field row; (3) runs the old exam test on the same head, green, so both agree; (4) only then
deletes the old file with `git rm`, in its own commit. A row whose law is not green on the real
code, or not red under its break, keeps its exam file, and the slice is sent back. The review
checks each row's four results in the field row before it passes the slice.

## How each new rule is measured at zero

0591 asks that a check which blocks has its false alarms measured; AGENTS.md says about 0% to
block. Each new rule or command replaces a test that blocks today and was green on main, on the
same files. So:

1. The tests step runs the old test and the new rule on the same tree at its head; both must agree
   (M1, M2, M3, M4), and the new one's count of fires on the tree must be 0 (M5). A fire on the
   tree that the old test did not report is read by hand and named in the step's row: a real break
   is fixed, a false alarm sends the rule back to the tests step.
2. The new rules' reach is wider in one way: oxlint lints `.tsx` and `.mts` files the old text
   scans read too, so the hand read covers those.
3. No rule here is on at `warn`, and none advises: each blocks at zero, as the test it replaces did.

## Order of the work

```text
slice A   moved plant tests, plant.ts, promise-types.ts          waits on nothing
slice B   node-kinds.ts, next-manifests.ts, package-deps, typed  waits on nothing
slice C   `reads` on LawOptions, lawReads, the declarations      waits on 0580's slice 1 on main
slice D   `readers` goes from changes.mjs, legs.ts, proof.ts      waits on C and on pull request 1496 on main
slice E   the 30 machine hits, then machine-has-laws at zero      waits on nothing
slice F   one-page-runtime and the L9 plants, from the readers    waits on nothing
```

- Every slice works on its own branch, `fabrikalfa/exam-to-lint-a` to `-d`, from this branch, and
  pushes there. The integrator folds each reviewed slice into this one pull request, on
  `fabrikalfa/exam-to-lint`; no slice opens a pull request (the step rules).
- The pull request lands whole, after 0580's slice 1 and pull request 1496 are on main, so no head
  of main has a moved rule test that no event runs (doubt 2).
- 0573: its pull request 1 edits `plants.test.ts`'s "elsewhere" list and adds
  `effect-checks-held.test.ts`. Whichever lands second takes a short rebase of that list, and this
  sweep folds `effect-checks.test.ts` into 0573's file if 0573 is on main by slice A's build.
- Slice E turns `fabrika/machine-has-laws` on in its last commit, once its own run on the tree
  has 0 hits, and only then deletes `laws-scan.integration.test.ts` (the deletion step above).

## Steps

Each slice runs plan (this file), tests, build and one review, each by its own agent.

1. **Tests**, per slice: writes the laws above for its slice, moves each test file with `git mv`
   and edits it in place, and runs M1's side-by-side once before deleting an old file. Every path
   here but one is an exam path, so the tests step writes nearly all of it.
2. **Build**, per slice: the product lines in the files table (`Law.ts`'s one key, the prose).
3. **One review**, per slice, of the slice's whole diff against this plan and 0591, with the
   loosening check: a moved law that compares less than it did is a send-back.

## Files

| File | Owner | Product lines expected | What |
|---|---|---|---|
| next/apps/fabrika/src/exam/clock.integration.test.ts next/apps/fabrika/src/exam/edge-comment.integration.test.ts next/apps/fabrika/src/exam/effect-functions.integration.test.ts next/apps/fabrika/src/exam/ledger-sql.integration.test.ts next/apps/fabrika/src/exam/no-effect-run-outside-edge.integration.test.ts next/apps/fabrika/src/exam/no-hand-tag.integration.test.ts next/apps/fabrika/src/exam/no-of.integration.test.ts next/apps/fabrika/src/exam/no-promises.integration.test.ts next/apps/fabrika/src/exam/object-imports.integration.test.ts next/apps/fabrika/src/exam/one-store-hook.integration.test.ts next/apps/fabrika/src/exam/react-rules.integration.test.ts next/apps/fabrika/src/exam/layers.integration.test.ts | tests | tests | slice A: moved with `git mv` to their `oxlint-plugins/` paths, or folded into an existing test there |
| next/apps/fabrika/src/exam/plant.ts next/apps/fabrika/src/exam/promise-types.ts | tests | tests | slice A: moved to `oxlint-plugins/`; every importer's path changes |
| next/apps/fabrika/src/exam/secret-types.integration.test.ts next/apps/fabrika/src/exam/tsconfig-scope.integration.test.ts next/apps/fabrika/src/exam/node-kinds.test.ts next/apps/fabrika/src/exam/deps.integration.test.ts | tests | tests | slice B: their checks become the typed command, `node-kinds.ts`, `next-manifests.ts` and `fabrika/package-deps`; deps keeps its bundle laws |
| next/apps/fabrika/src/exam/compiler.test.ts | tests | tests | slice A: moved to `next/packages/libfabrika/src/node/build/compiler.test.ts` |
| next/apps/fabrika/src/exam/effect-checks.test.ts | tests | tests | slice A: moved to `oxlint-plugins/`, or folded into 0573's file |
| next/apps/fabrika/src/exam/twin.integration.test.ts next/apps/fabrika/src/exam/edges.integration.test.ts | tests | tests | the real-stack `lint:twin` law goes (held); `twin` declares `reads:`; `edges` takes `effect-functions`' span law |
| next/apps/fabrika/src/exam/agent-may.test.ts next/apps/fabrika/src/exam/agents.test.ts next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts next/apps/fabrika/src/exam/bytes.integration.test.ts next/apps/fabrika/src/exam/client-manager-contract.integration.test.ts next/apps/fabrika/src/exam/commits-git-chain.integration.test.ts next/apps/fabrika/src/exam/commits-git-person.integration.test.ts next/apps/fabrika/src/exam/commits-git-signatures.integration.test.ts next/apps/fabrika/src/exam/commits-git-steps.integration.test.ts next/apps/fabrika/src/exam/commits.test.ts | tests | tests | slice C: each text-reading law takes its `reads:` from the table above, on the package's `it` |
| next/apps/fabrika/src/exam/commits-git.test-support.ts next/apps/fabrika/src/exam/commits.ts next/apps/fabrika/src/exam/compiler.ts next/apps/fabrika/src/exam/twin.ts next/apps/fabrika/src/exam/rows.ts next/apps/fabrika/src/exam/rows.test.ts | tests | tests | read for this plan; unchanged but for import paths |
| next/apps/fabrika/src/exam/edges.ts next/apps/fabrika/src/exam/ratchet.ts next/apps/fabrika/src/exam/ratchet.test.ts next/apps/fabrika/src/exam/ratchet.integration.test.ts next/apps/fabrika/src/exam/ratchet.test-support.ts next/apps/fabrika/src/exam/runner-contract.test.ts next/apps/fabrika/src/exam/runner-contract-replay.test.ts next/apps/fabrika/src/exam/runner-contract.test-support.ts | tests | tests | no check: unchanged |
| next/apps/fabrika/src/exam/laws-scan.integration.test.ts | tests | tests | slice E: deleted after M6 is green on the tree and red under its break |
| oxlint-plugins/no-clock-in-view.test.ts oxlint-plugins/edge-comment.test.ts oxlint-plugins/effect-functions.test.ts oxlint-plugins/no-ledger-sql.test.ts oxlint-plugins/no-effect-run-outside-edge.test.ts oxlint-plugins/no-hand-tag.test.ts oxlint-plugins/no-promises.test.ts oxlint-plugins/one-store-hook.test.ts oxlint-plugins/layers.test.ts oxlint-plugins/plant.ts oxlint-plugins/promise-types.ts oxlint-plugins/promise-types.test.ts | tests | tests | slice A, new paths: M1, M2 |
| oxlint-plugins/no-of.test.ts oxlint-plugins/plants.test.ts oxlint-plugins/builtin-plants.ts oxlint-plugins/no-wall-clock.test.ts oxlint-plugins/no-question-word-key.test.ts oxlint-plugins/terminology.test.ts oxlint-plugins/no-default-export.test.ts oxlint-plugins/after-hooks.test.ts oxlint-plugins/door-is-library.test.ts oxlint-plugins/ledger.test.ts oxlint-plugins/package-imports.test.ts oxlint-plugins/one-id-module.test.ts oxlint-plugins/service-contract.test.ts oxlint-plugins/jsdocs.test.ts | tests | tests | slice A: folded plants, and `plant.ts`'s new import path; the "elsewhere" list names the new files |
| oxlint-plugins/node-kinds.ts oxlint-plugins/node-kinds.test.ts oxlint-plugins/next-manifests.ts oxlint-plugins/next-manifests.test.ts oxlint-plugins/package-deps.ts oxlint-plugins/package-deps.test.ts oxlint-plugins/index.ts | tests | tests | slice B: the new commands and rule, M3, M4 |
| oxlint-plugins/effect-checks-held.test.ts | tests | tests | 0573's planned file; slice A folds `effect-checks.test.ts` in if it is on main |
| oxlint-plugins/README.md | tests | tests | "The new version's exam rules" names the rules' own test files; the exam folder holds no shape check |
| .oxlintrc.json | tests | tests | slice B: `fabrika/package-deps` on in the `next/**` block and its `.agents/` mirror |
| package.json | tests | tests | slice A and B: `lint:promise-types` points at `oxlint-plugins/`; `lint:node-kinds` and `lint:manifests` join `pnpm lint` |
| next/packages/libfabrika/src/node/build/compiler.test.ts | tests | tests | slice A: the moved compiler laws |
| next/packages/vitest/src/Law.ts | build | 6 | slice C: `reads` on `LawOptions` and `TaskMeta` |
| next/packages/vitest/src/Law.types.test.ts | tests | tests | slice C: R3 |
| vitest.config.ts | tests | tests | slice C: the `lawReads` plugin |
| vitest.reads.ts vitest.reads.test.ts | tests | tests | slice C: `readsOf`, R1, R2 |
| next/apps/fabrika/src/settings-generated.test.ts next/apps/fabrika/src/build.test.ts next/apps/fabrika/src/build.integration.test.ts next/apps/fabrika/src/build-command.integration.test.ts next/apps/fabrika/src/instance-one-file.integration.test.ts next/packages/libfabrika/src/node/build/build-assets.integration.test.ts next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts next/packages/libfabrika/src/node/build/css.integration.test.ts next/packages/libfabrika/src/node/build/error-cause.integration.test.ts | tests | tests | slice C: the six other `readers` entries; each text-reading law declares what it reads (`person.json`, `repo.json`, `docs/settings-reference.md`, the build's inputs and output); slice F: `build.test.ts` goes after M7, and L9 moves to M8 |
| .github/ci/changes.mjs .github/ci/changes.test.ts .github/ci/legs.ts .github/ci/legs.test.ts .github/ci/proof.ts .github/ci/proof.test.ts | tests | tests | slice D: `readers` goes; R4, R5, R6 |
| next/AGENTS.md | build | 2 | "What lint holds" gains `fabrika/package-deps` and the typed command's two checks |
| docs/plan/README.md | build | docs | the sweep's row, the same pull request (0013) |
| oxlint-plugins/machine-has-laws.ts oxlint-plugins/machine-has-laws.test.ts oxlint-plugins/one-page-runtime.ts oxlint-plugins/one-page-runtime.test.ts oxlint-plugins/settings-imports.test.ts | tests | tests | slices E and F: the two new rules and the moved L9 plants, M6, M7, M8 |
| next/packages/libfabrika/src/gateway/internal/rateLimit.laws.test.ts next/packages/libfabrika/src/gateway/internal/waiting.laws.test.ts next/packages/libfabrika/src/node/dev/internal/watcher.laws.test.ts next/packages/libfabrika/src/packs/internal/open.laws.test.ts next/packages/libfabrika/src/permissions/internal/relationsTable.laws.test.ts next/packages/libfabrika/src/runtime/ChaosMachine.laws.test.ts next/packages/libfabrika/src/runtime/internal/handsDelivery.laws.test.ts next/packages/libfabrika/src/runtime/internal/reply.laws.test.ts next/packages/libfabrika/src/runtime/internal/watchers.laws.test.ts next/packages/libfabrika/src/schedules/ScheduledJob.laws.test.ts next/packages/libfabrika/src/tasks/internal/task.laws.test.ts next/packages/libfabrika/src/telemetry/internal/sink.laws.test.ts next/packages/libfabrika/src/transport/internal/connection.laws.test.ts | tests | tests | slice E: new laws files, a property law and a sync test or its reason |
| next/packages/libfabrika/src/access/AccessMachine.laws.test.ts next/packages/libfabrika/src/access/Access.laws.test.ts | tests | tests | slice E: moved with `git mv` to the machine's name |
| next/packages/libfabrika/src/client/HandsMachine.laws.test.ts next/packages/libfabrika/src/client/Prefix.laws.test.ts next/packages/libfabrika/src/client/Tezgah.laws.test.ts next/packages/libfabrika/src/client/WindowMachine.laws.test.ts next/packages/libfabrika/src/desktop/Menu.laws.test.ts next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts next/packages/libfabrika/src/runtime/Client.laws.test.ts next/packages/libfabrika/src/runtime/Code.laws.test.ts next/packages/libfabrika/src/transport/Handshake.laws.test.ts next/packages/libfabrika/src/transport/Link.laws.test.ts next/programs/checklist/src/tile.laws.test.ts next/programs/inbox/src/program.laws.test.ts next/programs/pipeline/src/Merger.laws.test.ts next/programs/pipeline/src/Queue.laws.test.ts next/programs/tezgah/src/program.laws.test.ts | tests | tests | slice E: each gains a `syncTest(` call or a reason |
| next/packages/libfabrika/src/access/Access.ts next/packages/libfabrika/src/gateway/internal/rateLimit.ts next/packages/libfabrika/src/gateway/internal/waiting.ts next/packages/libfabrika/src/node/dev/internal/watcher.ts next/packages/libfabrika/src/packs/internal/open.ts next/packages/libfabrika/src/permissions/internal/relationsTable.ts next/packages/libfabrika/src/runtime/ChaosMachine.ts next/packages/libfabrika/src/runtime/internal/handsDelivery.ts next/packages/libfabrika/src/runtime/internal/reply.ts next/packages/libfabrika/src/runtime/internal/watchers.ts next/packages/libfabrika/src/schedules/ScheduledJob.ts next/packages/libfabrika/src/tasks/internal/task.ts next/packages/libfabrika/src/telemetry/internal/sink.ts next/packages/libfabrika/src/transport/internal/connection.ts next/packages/libfabrika/src/client/HandsMachine.ts next/packages/libfabrika/src/client/Prefix.ts next/packages/libfabrika/src/client/Tezgah.ts next/packages/libfabrika/src/client/WindowMachine.ts next/packages/libfabrika/src/desktop/Menu.ts next/packages/libfabrika/src/node/dev/DevLife.ts next/packages/libfabrika/src/processes/internal/processTable.ts next/packages/libfabrika/src/runtime/Client.ts next/packages/libfabrika/src/runtime/Code.ts next/packages/libfabrika/src/transport/Handshake.ts next/packages/libfabrika/src/transport/Link.ts next/programs/checklist/src/tile.ts next/programs/inbox/src/program.ts next/programs/pipeline/src/Merger.ts next/programs/pipeline/src/Queue.ts next/programs/tezgah/src/program.ts | build | 0 | the 30 machines; changed only where a new sync test finds a real fault, which the tests step reports first |
| next/apps/fabrika/src/entry/browser.tsx next/apps/fabrika/person.json next/apps/fabrika/repo.json docs/settings-reference.md | build | 0 | read by M7 and by the generated-files law; not changed |
| .agents/skills/lead/scripts/movecheck.ts | tests | tests | read: imports `rows.ts`, which stays |
| .github/ .github/ci .github/ci/ oxlint-plugins/ next/apps/fabrika/src/exam/ patches/ patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch exam-paths.json layer-rules.json node-kinds.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json | tests | tests | named as folders of the scope, or as files a law reads; not changed by this sweep |

## Size

1. Slice A, the moved plant tests and two support files: about 2,400 test lines moved and 200
   changed, 0 product lines; 30 files; about 2 agent hours.
2. Slice B, three new lint pieces from four tests: about 700 lines of rule and command code (exam
   paths, the tests step's) and 900 test lines moved; 0 product lines; 12 files; about 3 agent hours.
3. Slice C, `reads:` and its declarations: 6 product lines, about 120 lines of plugin and reader,
   250 test lines, and about 60 declaration lines in 20 files; about 2 agent hours.
4. Slice D, the list goes: about 80 lines removed and 60 added in CI, 150 test lines; about 1.5
   agent hours.
5. Slice E, the 30 machine hits and `machine-has-laws`: 13 new laws files and one moved, about
   1,100 test lines, 16 sync tests or reasons, about 250 test lines, and a 150-line rule; 0 product
   lines unless a sync test finds a fault; about 5 agent hours.
6. Slice F, `one-page-runtime` and the L9 plants: about 120 lines of rule and 200 test lines moved
   or written; 0 product lines; about 1 agent hour.

Confidence 70% on these counts: slice B's `package-deps` rule is the doubt, since it resolves
imports as `program-package-layout` does and may need more. Priced from the 0580 plan's figures
from recent `field/runs/` rows (a tests step about $6, a build about $2.30, a review about $3.60, a
fix round about $4.20, at list price), not recounted: six slices of three steps, plus three likely
fix rounds, the third for slice E, where a new sync test may find a real fault.

Estimate: 21 steps, $84

## Records

- **What is lost if it is not recorded now:** which law reads which file. Today it lives only in a
  hand list and in each test's body; after, it is on the law, and 0580's `meta` carries it into
  every run's report. Nothing stored before this changes shape.
- The pull request lists, per moved test, its plants run side by side (M1), and per new rule its
  fires on the tree (M5).
- No glossary row: `reads` is the plain word, and 0591 names it.

## What this cannot tell us

- Whether every text read on main is declared. R4 checks the paths the old list named; a law
  elsewhere that reads a file and was never listed is a miss today too, and main's full run (0581)
  shows it, as 0591's Consequences say.
- Whether `lawReads` costs a measurable time on `vitest --changed`. It parses only files that hold
  the word `reads`; the tests step times one `vitest list --changed` before and after.
- Whether each of the 16 machines can pass a sync test. One that cannot either takes a reason line
  or exposes a real fault; slice E's tests step reports which.

## Open questions

None.

## Findings

None outside this task: the one fault found, `laws-scan`'s dead pattern, is fixed by slice E.

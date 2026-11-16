
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

- **One exam check holds nothing today, so it cannot move at zero (open question 1).**
  `laws-scan.integration.test.ts` asks that every file that calls `defineMachine(` has a laws file
  beside it that imports `@demlik/tea/pbt` and runs `syncTest(` or names why not. No file in
  `next/` calls `defineMachine(` any more: `rg -l "defineMachine" next` finds only the test itself,
  and 47 non-test files make a machine with `Machine.make(`. 0579 moved property laws to `it.prop`,
  so a laws file need not import `@demlik/tea/pbt` either. The law passes because it finds no
  machine. A rule on today's constructor has about 30 hits by a rough text scan (23 with no laws
  file beside them that names pbt, 7 with no sync test), and some of those 23 have `.laws.test.ts`
  files that use `it.prop`, so the scan over-counts. Porting the old text keeps a check that holds
  nothing; porting it on `Machine.make(` blocks every pull request until a sweep. That is the
  owner's call. The plan does not drop it: it stays a test until the owner answers.
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
| laws-scan.integration.test.ts | open | Open question 1 |
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

Counts: lint 21, already held 0 (one law inside `twin.integration.test.ts` is), reads 16, open 1,
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

- M1 is the proof 0591 asks for before a test is deleted: the old and the new file run on the same
  plants, side by side, in the tests step's box, once, before the old file goes.
- No law needs the real machine, so none is host-only. `bytes`, `client-manager-contract`,
  `deps` and the commit chain keep their `.integration.` names (0536).
- No law reads a secret.

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
```

- Every slice works on its own branch, `fabrikalfa/exam-to-lint-a` to `-d`, from this branch, and
  pushes there. The integrator folds each reviewed slice into this one pull request, on
  `fabrikalfa/exam-to-lint`; no slice opens a pull request (the step rules).
- The pull request lands whole, after 0580's slice 1 and pull request 1496 are on main, so no head
  of main has a moved rule test that no event runs (doubt 2).
- 0573: its pull request 1 edits `plants.test.ts`'s "elsewhere" list and adds
  `effect-checks-held.test.ts`. Whichever lands second takes a short rebase of that list, and this
  sweep folds `effect-checks.test.ts` into 0573's file if 0573 is on main by slice A's build.
- Laws-scan waits on the owner (open question 1) and is not in any slice.

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
| next/apps/fabrika/src/exam/laws-scan.integration.test.ts | tests | tests | unchanged until open question 1 is answered |
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
| next/apps/fabrika/src/settings-generated.test.ts next/apps/fabrika/src/build.test.ts next/apps/fabrika/src/build.integration.test.ts next/apps/fabrika/src/build-command.integration.test.ts next/apps/fabrika/src/instance-one-file.integration.test.ts next/packages/libfabrika/src/node/build/build-assets.integration.test.ts next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts next/packages/libfabrika/src/node/build/css.integration.test.ts next/packages/libfabrika/src/node/build/error-cause.integration.test.ts | tests | tests | slice C: the six other `readers` entries; each text-reading law declares what it reads (`person.json`, `repo.json`, `docs/settings-reference.md`, `src/entry/browser.tsx`, the build's inputs) |
| .github/ci/changes.mjs .github/ci/changes.test.ts .github/ci/legs.ts .github/ci/legs.test.ts .github/ci/proof.ts .github/ci/proof.test.ts | tests | tests | slice D: `readers` goes; R4, R5, R6 |
| next/AGENTS.md | build | 2 | "What lint holds" gains `fabrika/package-deps` and the typed command's two checks |
| docs/plan/README.md | build | docs | the sweep's row, the same pull request (0013) |
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

Confidence 70% on these counts: slice B's `package-deps` rule is the doubt, since it resolves
imports as `program-package-layout` does and may need more. Priced from the 0580 plan's figures
from recent `field/runs/` rows (a tests step about $6, a build about $2.30, a review about $3.60, a
fix round about $4.20, at list price), not recounted: four slices of three steps, plus two likely
fix rounds.

Estimate: 14 steps, $56

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
- How many machines lack laws under today's constructor: the 30 above is a rough text scan.

## Open questions

1. `laws-scan.integration.test.ts` holds nothing today: it looks for `defineMachine(`, which no `next/` file calls, and for a `@demlik/tea/pbt` import, which 0579's `it.prop` replaced. Move it to a lint rule keyed on `Machine.make(` and a sibling `*.laws.test.ts` with a sync test or its reason, which blocks once about 30 machines are fixed in a sweep (lean, 70%), or keep the old text as written, which holds nothing?
2. `build.test.ts` and `settings-generated.test.ts`'s L9 read source text to check its shape (the page entry's one `runMain`; which files import the TOML adapter, already through `no-restricted-imports`). 0591 names both as `reads:` examples, and AGENTS.md says a shape check is lint. Keep them `reads:` in this sweep as 0591 says (lean, 75%), or move them to lint too?

## Findings

None outside this task: the one fault found, `laws-scan`'s dead pattern, is open question 1.

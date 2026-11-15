---
date: "2026-11-14"
scripts: "none committed; two small Node scripts in the session's scratch folder counted export and import lines with regexes, over next/ at a633cc446 and over the installed effect@4.1.2; each regex is written below"
summary: "`next/`; $0. How should a module file in next/ be named, what does it export, how is it read and how is its index file written? Effect, Elm, Go and Erlang/OTP agree: the reader always sees the module's name, so an export never says it again. Effect holds that by review and by copying the code nearby, and generates its index files. next/ is half way: 0 make<Module>, but 16 camelCase copies of a module's name, 10 xLayer or XLive names, 516 named imports of our own modules against 134 namespace imports, and 6 of 7 index files hand-written in mixed shapes. Seven principles, most held by review; one open clash with 0408 and 0114."
---

# 294. How should a module file in `next/` be named, what should it export, and how should its index file be written?

Read on 2026-11-14, on `origin/main` at `a633cc446`. It is about `next/`, the new version, only.
Today's version was not read. **This is reading, not a measurement,** apart from two small count
scripts that ran over `next/` and over the installed `effect@4.1.2` (both described in
[How the counts were made](#how-the-counts-were-made)). No model ran and no key was used: **$0**.
The page it feeds is [modules guidelines](../docs/guidelines/modules.md).

There is no Design canvas and no designs beside Linear: this area has no screen to draw or press,
so the guidelines skill's steps 5 and 9 are skipped, and the page carries its shapes as code blocks.

**The answer.** The makers agree on one idea: a reader always sees the module's name before the
export, so the export uses that fact and does not say the name again. Effect writes `D1Client.make`
and `D1Client.layer`, Elm calls `State.runState` "redundant and silly", Go names the constructor
`ring.New`, and Erlang calls `lists:keyfind`. Effect holds this with no naming check at all: it
generates its index files, tells its agents to read the code nearby, and reviews "naming and API
consistency with neighboring modules".

`next/` is about half way there. In `next/`, `settings/Setting.ts` follows the shape exactly
(`Setting.make`, read through its namespace by every importer). In `next/`, `ledger/NodeSqlite.ts`
breaks it: its one export is `nodeSql`, the module's name turned around, and all 60 files that use
it import that bare name.

```text
Effect    D1Client.make(...)  D1Client.layer(...)  D1Client.D1Client   index.ts generated
Elm       State.run, never State.runState; Dict.empty, Dict.insert; type Dict k v
Go        ring.New, never ring.NewRing; bufio.Reader, never bufio.BufReader
OTP       lists:keyfind(Name, 1, List); the module name is the file name
next/     Setting.make (follows); nodeSql (breaks); index.ts hand-written, mixed
```

## A first reading from the wrong repository, marked wrong

The study this experiment starts from was first read from `Effect-TS/effect-smol`, the repository
where v4 was built as a beta, last pushed at `4.0.0-beta.98`. That was wrong. Stable v4, and the
`effect@4.1.2` we install, come from [`Effect-TS/effect`](https://github.com/Effect-TS/effect)
(`node_modules/effect/package.json` names it). The study was corrected the same day. What the wrong
reading got wrong, kept here as a record:

- **Wrong:** a root `AGENTS.md` and a `.patterns/` folder hold Effect's agent guide. Effect's guide
  is `.agents/AGENTS.md` and its skills under `.agents/skills/`; there is no `.patterns/` folder.
- **Wrong:** quotes such as "Prefer existing abstractions and conventions over introducing new
  ones". None of them is in `Effect-TS/effect`.
- **Wrong:** a lint rule `effect/jsdocs`. Doc structure is held by `pnpm jsdocs --check`, a CI step.
- **Wrong:** "names are held only by review and the agent guide", with the guide saying almost
  nothing. The guide writes the method down: inspect nearby code, justify each file by a neighbor,
  and review naming against neighboring modules.
- **Not reproduced:** "130 of 153 modules export a name equal to the module". The corrected count
  over the top level and `sql/` is 118.

Every Effect source this experiment cites was opened again for it on 2026-11-14, on
`Effect-TS/effect` `main` at `1b807a0` (with `gh api`) or in the installed `effect@4.1.2`.

## What was read

### Effect, the main source

| Tag | What | Where it was opened |
|---|---|---|
| `[e1]` | The agent guide: "Inspect nearby code before editing" (line 13); "Some `index.ts` sections marked with `@barrel` are generated. Do not edit those sections manually; update their source modules and run `pnpm codegen`" (lines 47-48) | [`.agents/AGENTS.md`](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md) |
| `[e2]` | "inspect nearby source and tests for any repository-internal conventions not covered by the documentation" (lines 12-13); options inline by default, with `export const make = (options: { ... })` (lines 20-38) | [`effect-development/SKILL.md`](https://github.com/Effect-TS/effect/blob/main/.agents/skills/effect-development/SKILL.md) |
| `[e3]` | "Inspect the closest package in the same family ... Justify each proposed file by precedent or an explicit repository need" (lines 10-12); "Run codegen when the package owns generated barrels, then inspect generated sections rather than editing them manually" (lines 24-25) | [`package-development/SKILL.md`](https://github.com/Effect-TS/effect/blob/main/.agents/skills/package-development/SKILL.md) |
| `[e4]` | Step 2: "reuse helpers and patterns from nearby source" (lines 22-23). Step 3: "Review the full diff from the merge base as a maintainer would: correctness, failure and interruption paths, resource cleanup, naming and API consistency with neighboring modules, and documentation" (lines 27-29). Each step "in a fresh-context subagent when available" (line 12) | [`pull-requests/SKILL.md`](https://github.com/Effect-TS/effect/blob/main/.agents/skills/pull-requests/SKILL.md) |
| `[e5]` | The generator writes one line per module: `` `${renderExportJSDoc(metadata)}\nexport * as ${moduleName} from "./${posixPath}"` `` (line 187), and fails a module with no top-level `@since` (lines 85-101) | [`packages/tools/utils/src/Codegen.ts`](https://github.com/Effect-TS/effect/blob/main/packages/tools/utils/src/Codegen.ts); the package is `"private": true` and `npm view @effect/utils` answers 404 |
| `[e6]` | `"codegen": "effect-utils codegen"` (line 140); the root runs it in every package (root `package.json` line 8); CI's `check.yml` runs lint, `jsdocs --check`, `circular` and `ai-docgen`, then fails on `git status`, and never runs codegen | `packages/effect/package.json`, `package.json`, `.github/workflows/check.yml` on `main` |
| `[e7]` | `// @barrel: Auto-generated exports. Do not edit manually.` (line 45), then `export * as Option from "./Option.ts"` (line 465) | `node_modules/effect/src/index.ts` (4.1.2) |
| `[e8]` | `export interface D1Client` (`:63`), `export const D1Client = Context.Service<D1Client>(...)` (`:108`), `export const make` (`:215`), `export const layerConfig` (`:400`), `export const layer` (`:421`); its whole index is one generated line, `export * as D1Client from "./D1Client.ts"` | `@effect/sql-d1@4.1.2`, `src/D1Client.ts` and `src/index.ts` |
| `[e9]` | `export type Option<A>` (`:57`), `export declare namespace Option` (`:178`), `none` (`:266`), `some` (`:297`), `isOption` (`:329`), `fromIterable` (`:571`), `map` (`:1499`); `export interface Duration` (`:112`), `isDuration` (`:498`), `zero` (`:679`), `millis` (`:764`) | `node_modules/effect/src/Option.ts`, `Duration.ts` (4.1.2) |
| `[e10]` | `export const layer: Layer.Layer<FileSystem> = NodeFileSystem.layer` (`:23`) | `@effect/platform-node`, `src/NodeFileSystem.ts` |
| `[e11]` | `export * from "vitest"` (`:22`), loose root names `layer` (`:363`), `flakyTest` (`:384`), `it` (`:405`), `makeMethods` (`:442`); `"./*": "./dist/*.js"` and `"./internal/*": null` in its `package.json` | `node_modules/@effect/vitest` |

Effect has **no lint rule on export names or file names** and no CI check that re-runs codegen.
Its two own import rules (`effect/no-import-from-barrel-package`, `effect/no-unused-internal`) and
its doc checker are read in the study; they do not touch the names this page is about.

### Other makers

| Tag | Maker | What it says, as fetched on 2026-11-14 |
|---|---|---|
| `[m1]` | Elm's package design guidelines | Under "Module names should not reappear in function names": "A function called `State.runState` is redundant and silly. More importantly, it encourages people to use `import State exposing (..)` which does not scale well." And: "With a name like `State.run` the user is encouraged to disambiguate functions with namespacing" ([source file](https://github.com/elm/package.elm-lang.org/blob/master/assets/help/design-guidelines.md), the page at [package.elm-lang.org](https://package.elm-lang.org/help/design-guidelines) renders it) |
| `[m2]` | Elm's core `Dict` | `module Dict exposing` (line 1), `type Dict k v` (line 72), `empty` (line 78), `insert` (line 155), `fromList` (line 608) ([`elm/core` `src/Dict.elm`](https://github.com/elm/core/blob/master/src/Dict.elm)) |
| `[m3]` | Effective Go, "Package names" | "The importer of a package will use the name to refer to its contents, so exported names in the package can use that fact to avoid repetition." "the buffered reader type in the `bufio` package is called `Reader`, not `BufReader`". The constructor of `ring.Ring` "would normally be called `NewRing`, but since `Ring` is the only type exported by the package, and since the package is called `ring`, it's called just `New`" ([go.dev](https://go.dev/doc/effective_go#package-names)) |
| `[m4]` | Erlang/OTP reference manual, modules | "A module consists of a sequence of attributes and function declarations"; "The name `Module`, an atom, is to be the same as the file name minus the extension `.erl`" ([modules](https://www.erlang.org/doc/system/modules.html)) |
| `[m5]` | Erlang/OTP reference manual, function calls | The fully qualified form `ExprM:ExprF(Expr1,...,ExprN)`, "often referred to as a remote or external function call", with the example `lists:keyfind(Name, 1, List)` ([expressions](https://www.erlang.org/doc/system/expressions.html)) |

One source could not be read: the old Ericsson programming rules page (`erlang.se`) did not resolve,
so nothing here rests on it.

**The plain way they agree on.** The module's name is part of every call a reader sees, so it is
the first word of the name: `State.run`, `ring.New`, `D1Client.make`, `lists:keyfind`. An export
does not repeat it. The main type may carry it, because it is the module's own thing (`Dict.Dict`,
`Option.Option`, `ring.Ring`). Calls stay qualified; Elm warns that unqualified imports make "large
code bases impossible to understand". Elm, Go and Erlang have no barrel at all: a reader imports
each module by its own name. Effect has one per package or area, and generates it.

One clash with a goal of ours: Effect's guide teaches a static `layer` on the service class, and
[0095](../.decisions/0095-a-service-file-holds-only-its-contract.md) moved each layer to its own
file. That makes the module the only way a reader reaches a layer, so reading through the module
matters more for us than for Effect's own app examples.

## What is already settled

Searched: `docs/guidelines/` (empty on main), `.decisions/` (with `records.ts list .decisions`),
`.patterns/`, `.glossary/TERMS.md`, `docs/direction/` (the Effect code guidelines note),
`experiments/` (262 and 282) and `docs/plan/` (`effect-rules-big.md`).

| Point | State | Source |
|---|---|---|
| A library file is one PascalCase module, one concept; a variant is a prefixed sibling (`LedgerSql.ts`); private code in camelCase under `internal/`, every export `@internal` | decided | [0023](../.decisions/0023-next-follows-effects-code-style.md) row "File names", [0032](../.decisions/0032-libraries-take-effects-file-layout.md), [0043](../.decisions/0043-rooms-on-floors.md) rule 8 |
| A folder of libfabrika is a module; no module re-exports another's names | decided | [0091](../.decisions/0091-modules-and-layers.md), 0043 rule 8 |
| A library's `index.ts` re-exports each module as a namespace, `export * as Ledger from "./Ledger.ts"`; callers write `Ledger.make(...)` and `Ledger.Ledger`; the top level names no platform | decided | 0023 row "Barrel", 0032 |
| `make` is the word for building a value; test tooling is read through its module (`SinkTest.suite`) | decided | [0029](../.decisions/0029-format-and-names-follow-effect.md), amendment of 2026-11-10 |
| `of` only through its module; every `xOf` name is banned | decided | 0029 |
| A layer is a sibling file that exports `layer`, read as `LedgerSql.layer`; a service class has no static member | decided | 0095 |
| A service fails with `<Service>Error` | decided | [0055](../.decisions/0055-errors-named-by-their-service.md) |
| Named exports only, never a default | decided | [0058](../.decisions/0058-named-exports-only.md) |
| An export no file imports fails lint | decided | [0006](../.decisions/0006-no-unused-exports.md) |
| Library imports of Effect are namespace imports by module path | decided | 0023 row "Library imports", [0120](../.decisions/0120-effect-code-guidelines.md) E7 |
| No hand-written `isX` helper where Effect ships one | decided, rule not built | 0120 E1, its planned `no-hand-guard` |
| `@kampus/vitest` is read as `import { runsFor } from "@kampus/vitest"`, after `@effect/vitest` | decided | [0538](../.decisions/0538-kampus-vitest-holds-the-test-primitives.md) |
| Effect's team is the builder we measure code against; a plan names the nearest Effect module; what holds a principle is picked in the order shipped check, then our lint rule, then a pattern doc | decided | [0114](../.decisions/0114-effects-team-as-the-builder.md) |
| A rule code could check becomes a check | decided | [0408](../.decisions/0408-skills-keep-only-judgment.md) |
| The three barrels become `export * as` by hand, in the docs fill's last slice | planned | `docs/plan/effect-rules-big.md` B2.8 |
| No `make<Module>`, `<module>Layer` or `<Module>Live`; no camelCase copy of the module's name; a variant after the verb | nobody touched | |
| Index files generated, not hand-written | nobody touched | |
| A new file names the existing file it copies; a review checks it against its neighbors | nobody touched; 0114's "nearest Effect module" line is not in the plan, build or review skills today | |

Kept differences from Effect the page must not undo:

- **[0095](../.decisions/0095-a-service-file-holds-only-its-contract.md):** no static member on a
  service class, and each layer in its own file. The page's `layer` is the sibling file's export,
  never a static.
- **[0252](../.decisions/0252-effect-fn-for-exported-effects.md):** a span is `<piece>.<verb>` with
  a lowercase piece, where Effect writes `"Database.query"`. Renaming `verifySshsig` to
  `Sshsig.verify` keeps the span `transport.verify...` in 0252's form; the page names no span.
- **[0118](../.decisions/0118-no-since-tag-before-a-release.md):** no `@since` before a release.
  Effect's generator fails a module with no `@since` `[e5]`, so ours copies `@stability` only.
- **[0039](../.decisions/0039-keep-semicolons-and-es5-commas.md):** semicolons and trailing commas.
  A generated index is printed in our format; Effect's own lines are quoted in theirs.
- **[0046](../.decisions/0046-one-tea-machine-per-file.md):** one tea machine per file. Its examples
  name the machine bare (`supervisor`, `clientMachineFor`), so a machine's export name is left as a
  smaller call below, not a rule.
- **[0538](../.decisions/0538-kampus-vitest-holds-the-test-primitives.md):** `@kampus/vitest`'s root
  is itself the module, as `@effect/vitest`'s is `[e11]`. Its index stays hand-written and its
  root names stay bare. This sits beside 0029's amendment, which reads test tooling through its
  module; 0538 is later and names the call shape, so it wins for that package's root.

One open pull request is on the same area: [PR 1301](https://github.com/kamp-us/tea-fabrika/pull/1301)
adds `next/packages/vitest/src/TestDatabase.ts` with `make`, `open` and `TestDatabaseError`, read
through its own subpath `@kampus/vitest/TestDatabase`. It already leans the module way inside the
same package, and it edits many of the test files that import `nodeSql` today.

The word "module" has two meanings here, an open clash in `.glossary/TERMS.md`: 0091 names a folder
of libfabrika a module, while 0032, Effect's source and an ES module call one file a module. The
page says **module file** for a file and names a libfabrika folder in full.

## Today's running example

| What | Today, in `next/` | Where |
|---|---|---|
| A module that follows the shape | `Setting.ts` exports the `Setting` type, `make`, `group` and helper types; nothing repeats its name | `next/packages/libfabrika/src/settings/Setting.ts:54`, `:85`, `:184` |
| How it is read | 17 importers, all `import * as Setting` or `import type * as Setting`; callers write `Setting.make("instance.port", { ... })` | `next/packages/libfabrika/src/settings/Declarations.ts:35` |
| Its options | inline and `readonly`, as Effect's `[e2]` | `Setting.ts:85-90` |
| A module that breaks it | `NodeSqlite.ts` has one export, `nodeSql`, the module's name turned around | `next/packages/libfabrika/src/ledger/NodeSqlite.ts:37` |
| How it is read | 60 files import `{ nodeSql }` by name (59 tests, plus `node/dev/dev-recording.ts`); Effect would write `NodeSqlite.make(db)` | `rg 'NodeSqlite(\.ts)?"' next` |

Checked against each principle:

| Principle | `Setting.ts` | `NodeSqlite.ts` |
|---|---|---|
| M1 one PascalCase module file, `internal/` private | passes | passes |
| M2 the main thing named as the module | passes (`Setting`) | no main type; a constructor module, as `NodeFileSystem` is |
| M3 short words after the module | passes (`make`, `group`) | breaks (`nodeSql`, where Effect says `make`) |
| M4 `isX` and `XError` may repeat it | nothing to check | nothing to check |
| M5 values read through the namespace | passes, all 17 importers | breaks, all 60 importers |
| M6 the index is generated | half: `Setting` is reached by its path; the root index is hand-written | the same |
| M7 a new file copies a named neighbor | a model to copy | nothing to copy from |

`Setting.ts` is not clean on every other rule: it imports `{ Config, Schema, String as Str }` from
the `effect` barrel (`:10`), which E7's sweep fixes. That is outside this area.

## How the counts were made

Two Node scripts, run once each with `node` 26.13.0, in the session's scratch folder, not
committed. Both are regexes over lines, not a parser.

```text
files     next/: git ls-files 'next/**/*.ts' 'next/**/*.tsx' minus *.test.ts(x), *.test-support.ts(x),
          *Test.ts(x), *.d.ts and index.ts: 251 files, 167 of them PascalCase
          Effect: every .ts under node_modules/effect/src outside internal/, minus index.ts: 408 files
exports   ^export (declare )?(const|let|function*|class|interface|type|enum|abstract class) <name>
imports   ^import (type )?<what> from "<spec>", where spec is relative or @kampus/ and ends in a
          PascalCase name; "* as X" counts as a namespace import, anything else as named
```

| Pattern | `next/` product files | Effect 4.1.2, 408 modules |
|---|---|---|
| `make<Module>` | 0 | 0 |
| `<module>Layer` | 0 | 0 |
| any other `xLayer` or `XLive` name | 10 names on 12 lines | 3 (`Metric.enableRuntimeMetricsLayer`, `disableRuntimeMetricsLayer`, `HttpEffect.toWebHandlerLayer`) |
| a camelCase export equal to its module's name | 16 of 167 PascalCase modules | 4 (`Hash.hash`, `Unify.unify`, `Statement.statement`, `Build.build`) |
| exports named `make` | 12 | 170 |
| exports named `layer` | 32 | 51 |
| `isX` exports | 0 | 555 |
| modules with an export named exactly as the module | 81 | 261 |

The 16 camelCase copies in `next/`: `Access.access`, `CloudflareSql.cloudflareSql`,
`GatewayNonce.gatewayNonce`, `GatewayStore.gatewayStore`, `DevLife.devLife`, `Load.load`,
`BrainLife.brainLife`, `ChaosMachine.chaosMachine`, `Code.code`, `RecoveryStore.recoveryStore`,
`Send.send`, `StartChild.startChild`, `Connection.connection`, `Depth.depth`, `Merger.merger`,
`Queue.queue`. Three are tea machines (`brainLife`, `chaosMachine`, `devLife`), three are one-verb
modules (`load`, `send`, `startChild`), and `Depth.depth` sits under 0538.

The 10 `xLayer` or `XLive` names: `connectionLayer`, `mailLayer`, `RecordPartLive` (in
`cloudflare/`), `recordedLayer`, `recordingLayer`, `projectLayer`, `projectJobsLayer`, `processLayer`
(all in `next/packages/libfabrika/src/cloudflare/runtime.ts`, 2,305 lines), `rssLayer` (a fixture),
and `CoordinationLayer` (`processes/ProcessManager.ts:563`).

Imports of our own PascalCase modules, in statements:

| Where | named | namespace |
|---|---|---|
| product files | 516 | 134 |
| tests | 1,074 | 486 |

Index files, by the shape of their `export` lines:

| File | `export * as` | `export {` | `export *` |
|---|---|---|---|
| `next/packages/libfabrika/src/index.ts` | 16 | 13 | 0 |
| `next/packages/libfabrika/src/coordination/index.ts` | 0 | 21 | 0 |
| `next/packages/libfabrika/src/cloudflare/index.ts` | 0 | 4 | 0 |
| `next/packages/tuval/src/index.ts` | 0 | 1 | 0 |
| `next/packages/tuval/src/browser/index.ts` | 0 | 3 | 0 |
| `next/packages/vitest/src/index.ts` | 0 | 0 | 1 |
| `next/programs/pipeline/src/index.ts` | 1 | 3 | 0 |

The top libfabrika index mixes both shapes on two lines next to each other
(`next/packages/libfabrika/src/index.ts:47-48`): `export * as ProgramClient from
"./runtime/Client.ts"` and `export { clientMachineFor } from "./runtime/Client.ts"`.

These match the study's counts from `86a7668d6` except the test imports (1,139 and 505 there,
1,074 and 486 here, since some test files moved) and the `xLayer` count, which the study gave as
12 export lines.

## What this tells us for fabrika

No Linear answer: this area has no screen. Accessibility: no WCAG criterion is in play. What
applies is for readers of code and docs: a name says what the thing is, in plain words, and a
reader can tell where a call comes from without opening another file. Every principle below serves
that reader.

### M1: one module file, one PascalCase name, private parts in `internal/`

**Decided** (0023, 0032, 0043). Kind: **lint**, rules that exist: `unicorn/filename-case` and
`fabrika/modules` with `eslint/no-restricted-imports` (`next/AGENTS.md:47`). Elm and OTP agree: the
module's name is its file's name `[m4]`. Breaks today: the lower-case files in `cloudflare/` and
`node/build/`, `node/dev/`, which the file name rule does not cover (21 files in the study), with
`cloudflare/runtime.ts` the largest. 0120 already plans its split. Nothing new to decide.

### M2: the module's main thing carries the module's name

**Lean, 80%.** Kind: **taste**, held by review. When a module has one main type, service or schema,
it is named as the module: `Option.Option` `[e9]`, `D1Client.D1Client` `[e8]`, Elm's `Dict.Dict`
`[m2]`, Go's `ring.Ring` `[m3]`, our `Setting.Setting` and `Ledger.Ledger`. 0032 already writes
`Ledger.Ledger`. A layer file or a constructor module has no main type, and that is fine
(`NodeFileSystem.layer` `[e10]`, `LedgerSql.layer`). The doubt: whether a module whose main thing
is a tea machine counts; that is the machine call below. Cost: none in a rename; 81 modules already
do it.

### M3: short words after the module name

**Lean, 80%.** Kind: **taste**, held by the builder's model file and review. The main constructor
is `make`, a sibling file's layer is `layer`, other constructors are a plain word or `fromX`, and a
variant goes after the verb: `layerTest`, `makeUnsafe`. Never `make<Module>`, `<module>Layer`,
`<Module>Live`, or the module's name in camelCase. Partly decided: `make` (0029) and `layer` (0095).
Elm: `State.run`, never `State.runState` `[m1]`. OTP: `lists:keyfind`, not `lists:lists_keyfind`
`[m5]`.

- **The doubt.** A module whose whole job is one verb: Effect keeps `Hash.hash` and `Unify.unify`,
  and we have `Send.send`, `Load.load`, `StartChild.startChild`. Elm would say `State.run`. The
  lean lets a one-verb module keep its verb (60%) and asks review to judge it. Machines are the
  smaller call below.
- **Cost.** About 30 renames with their importers: 12 camelCase copies outside machines and
  `Depth` (the three one-verb modules among them, if review says they rename), 10 `xLayer` names (8 of them in `cloudflare/`, which the Alchemy port and 0120's split
  reshape anyway), and the `decodeX` and `verbSshsig` names (`decodeExitReason`,
  `processes/ExitReason.ts:52`; `verifySshsig`, `checkSshsig`, `writeSshsig`,
  `transport/Sshsig.ts:175`, `:238`, `:264`). Sized as renames, not by time.
- **Kept:** 0252's span names do not change with the export name.

### M4: a guard is `isX` and an error is `XError`, the two names that may repeat the module

**Lean, 85%.** Kind: **taste**, held by review. Effect repeats its module's name in exactly these
two places beside the main type: `isOption` `[e9]`, `isDuration`, `SchemaError`. `XError` is
decided (0055): `next/`'s product files have 41 exported `XError` classes, 35 of them named
as their module file (`LedgerError` in `Ledger.ts`). A guard comes from
`Schema.is` or `Predicate` before it is written by hand (0120 E1); `next/` exports no `isX` today,
so nothing breaks. No close Elm or OTP answer: Elm's types need no runtime guard, and OTP's error
is a tuple, not a named class. Cost: none.

### M5: a value is read through its module's namespace

**Lean, 70%.** Kind: **taste**, held by review. A camelCase value from one of our modules is read
through the module: `import * as Setting from "./Setting.ts"`, then `Setting.make(...)`. A type, a
service class or a schema may be imported by name, as Effect's own source does for types
(`import type { Option }`) and its app examples do for classes (`import { GitHub }`). Decided in
part: 0032 says "Callers write `Ledger.make(...)` and `Ledger.Ledger`". Elm warns against
`exposing (..)` `[m1]`; OTP's remote call names the module every time `[m5]`.

- **The doubt.** 0032's own example writes `Ledger.Ledger`, the class through its module, while
  `next/` imports classes by name today (`import { Ledger } from "./Ledger.ts"`,
  `ledger/LedgerSql.ts:10`) and Effect's library mostly does too for types. The lean lets classes
  and types be named; the owner could read 0032 as covering them.
- **The exception** is `@kampus/vitest`'s root, under 0538.
- **Cost.** 133 camelCase value names in product files (the study's count at `86a7668d6`, not
  redone here), plus about 60 `nodeSql` and the test
  helpers in tests. A namespace import changes no behavior.

### M6: index files are generated

**Lean, 75%.** Kind: none of the skill's three, honestly: a program writes the file, so no person
and no check judges its shape. It is held by **a generated file**. Effect's way `[e5]` `[e6]`
`[e7]`: a `// @barrel` comment in `index.ts` marks the generated part, and a generator writes one
`export * as X from "./X.ts"` line per module file with its doc block. Ours runs inside
`pnpm format`, so a forgotten run is fixed by the command everyone already runs, and there is no
CI check, as Effect has none.

- **What it must keep.** No `@since` (0118): it copies `@stability` only. Our format (0039). No
  platform module at the top level (0032), which the comment's glob says. `@kampus/vitest`'s root
  stays hand-written (0538).
- **Elm and OTP** have no barrel at all; a reader imports each module by its own name. The barrel is
  Effect's, kept because 0032 decided a namespace `index.ts`.
- **The doubt.** A forgotten run leaves a module missing from the index. Effect accepts that. Ours
  is partly caught already: an export nobody imports fails `pnpm lint:dead` (0006). What would
  settle it: one month of the generator, counting stale indexes found in review.
- **Cost.** A generator of a few hundred lines, since Effect's is private (`@effect/utils` is
  `"private": true` and not on npm). 0040 asks to try an existing tool first; the build plan does
  that. It replaces the hand step B2.8 in `docs/plan/effect-rules-big.md`, so that plan changes
  when this page is approved. About 45 hand-written lines in six index files become generated, and
  `coordination/index.ts` goes with the old folder (0043 says there is no `coordination/`).

### M7: a new module file copies a named neighbor

**Lean, 70%.** Kind: **taste**, held by prompts in steps that already exist. The plan and the
builder name the existing file each new file follows; the reviewer checks that a new module matches
its neighbors' names and shape. This is Effect's written method `[e1]` `[e2]` `[e3]` `[e4]`, and it
builds 0114's "the nearest Effect module is named in the plan", which no step skill says today.

The model files to copy, in `next/`, checked for this experiment:

| File | Why it is a model |
|---|---|
| `next/packages/libfabrika/src/settings/Setting.ts` | `make` (`:85`), `group` (`:184`), the `Setting` type (`:54`), inline options; all 17 importers read it as `Setting` |
| `next/packages/libfabrika/src/ledger/LedgerSql.ts` | one export, `layer` (`:26`), read as `LedgerSql.layer(...)` by all 54 files that use it: `NodeFileSystem.layer`'s shape `[e10]` and 0095's |
| `next/packages/libfabrika/src/permissions/Rebac.ts` | `make` (`:134`), its `Denied` error (`:142`), `Permission`, `provide` and `recheck`, read through the module |

And the furthest, to read as what not to copy: `next/packages/libfabrika/src/ledger/NodeSqlite.ts`
(`nodeSql`, `:37`), `next/packages/libfabrika/src/cloudflare/runtime.ts` (34 exports, five `xLayer`
names, 2,305 lines). The study also named `next/packages/vitest/src/Depth.ts` as furthest from
Effect's library shape; it is close to `@effect/vitest`'s root shape on purpose (0538), so it is a
kept difference, not a model to avoid. Elm or OTP: no answer; this is how a team works, not a
language rule. Cost: one line each in the plan, build and review skills, written in the build plan.

### The open call: 0408 and 0114 against "held by review"

This direction holds names by a prompt and review, with no new lint rule. Two decisions read the
other way, and the owner picks:

- [0408](../.decisions/0408-skills-keep-only-judgment.md) says "A rule that code could check
  becomes a check, then leaves."
- [0114](../.decisions/0114-effects-team-as-the-builder.md) picks what holds a principle "in this
  order: a check Effect's own tooling already ships ..., then a lint rule of ours, then a pattern
  doc".

**Reading A: the exact shapes become a check.** `make<Module>`, `<module>Layer`, `<Module>Live` and
a camelCase copy of the file's name are plain syntax: a rule reads the file name and the export
names. Under [0523](../.decisions/0523-advice-rules-block-where-clean.md) it would block in every
folder at zero.

```text
what it fires on today, in next/ product files
  make<Module>                 0
  <module>Layer                0
  xLayer or XLive              10 names (8 in cloudflare/)
  camelCase copy of the module 16, of which 7 are cases this page allows or leaves open
                               (3 machines, 3 one-verb modules, Depth under 0538)
```

Cost: a rule of ours that Effect does not have, its tests, and a false-alarm measure first
(AGENTS.md's 0% to block). The camelCase copy would need disable lines with reasons for the
one-verb modules, which is judgment written as exceptions.

**Reading B: these stay judgment, held by review.** 0408 is about what a skill's prose holds. The
part of a name that matters is whether it reads well after the module (`Text.grant` against
`grantText`), and no syntax rule judges that. Effect holds every naming habit this way, with zero
`make<Module>` across 408 modules and no check `[e4]`. Cost: experiment 282 found that prose-held
rules leak: five of the Effect guidelines were broken again by files added in 15 commits.

**Lean, 60%, for a split:** a check for the three exact shapes with no judgment in them
(`make<Module>`, `<module>Layer`, `<Module>Live`, 0 to 10 hits), and review for the camelCase copy
and for every other name. The doubt is the brief this experiment was run under, which asked for no
new rule. What would settle it: the owner's reading of 0408's "could check", and whether a rule
with today's 10 hits in one folder is worth its tests.

### Smaller calls

**A tea machine's export name.** 0046 allows one machine per file and names its examples bare.

```ts
// A: keep the bare name, as 0046's examples do
export const brainLife = Machine.make({ ... });
BrainLife.brainLife;
// B: the machine is the module's one value
export const machine = Machine.make({ ... });
BrainLife.machine;
```

No lean, the owner picks. Effect has no machines; Elm's module would expose `init` and `update`,
not a machine value, so neither maker answers.

**Where the generator runs.** `pnpm format` runs `oxlint-plugins/format.ts`, and `pnpm lint` runs
`format.ts --check`.

```text
A  the generator is part of format.ts      lint's --check then sees a stale index: a CI check after all
B  the generator is its own step in format  no CI check, as Effect has none
```

**Lean B, 65%,** because it is the direction and Effect's way. The doubt: A costs nothing more and
catches a forgotten run; it reopens the "no CI check" call.

**Type namespaces.** Effect sets `typescript/no-namespace` off so `export declare namespace Option`
can hold a module's types `[e9]`. Our `.oxlintrc.json` sets it to `error` (`:363`), and `next/` has
0 uses. **Lean: no change, 60%.** Nothing needs one today; turning it on opens a new way in.

**`xFor` names.** 0029 bans `xOf` only; `next/` has 8 `xFor` names (`clientMachineFor`,
`windowMachineFor`). **Lean: out of this page, 55%;** they are a naming call of 0029's, not a module
shape.

What the ledger records: nothing new. No stored type or field changes; every rename is code.

A tryout in today's version: none. The page is about `next/` only.

## What it cannot tell us

- The counts are regexes over lines, not a parser. A multi-line `export {` counts once, re-exports
  through `export *` are not followed, and overloads count once per line. They are sizes, not a
  list for a sweep.
- No lint rule was written or run, so no false-alarm rate is measured. The "fires on" numbers are
  matches.
- Effect's naming habits are read from its code, not from a written rule: Effect writes none. A
  habit with exceptions (`Hash.hash`, `makeMethods`, the `Metric` layers) may be on purpose or not.
- The upstream guide and generator were read on `main` at `1b807a0`, which may be newer than the
  pinned `effect@4.1.2`. The source line numbers are from 4.1.2.
- Only libfabrika has enough modules to judge. tuval, vitest and the programs are small, and the
  app's layout is not decided (0032).
- Whether a generator in `pnpm format` is forgotten often is not known until one runs.
- PR 1301 moves many test files that import `nodeSql` today; the 60 may change before a sweep.

## Links

- `[e1]` to `[e11]`: Effect, as listed in [the Effect table](#effect-the-main-source).
- `[m1]` to `[m5]`: Elm, Go and Erlang/OTP, as listed in [the other makers](#other-makers).
- The page: [modules guidelines](../docs/guidelines/modules.md).
- [Effect code guidelines](../docs/direction/effect-code-guidelines.md), whose E7 this page sits
  beside, and [experiment 282](./282-effect-guidelines-audit.md).

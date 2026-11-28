# @kalfa/quality

Our testing, linting and formatting tooling, one subpath per tool. So far three subpaths exist:
`@kalfa/quality/stryker`, the plant runner, `@kalfa/quality/vitest`, the test helpers, and
`@kalfa/quality/oxlint`, the Effect lint rules. The package is private, imports no product code and no
path into the repo (lint holds that), and reads every repo-specific value as data from its edge.

## A plant

A plant is a break put once into product code to show a law can fail. Here it is a mutant Stryker makes,
named by its code shape, with the law that must kill it.

```ts
import { plant } from "@kalfa/quality/stryker";

export default [
  plant({
    name: "host-pnpm-path",
    file: ".agents/skills/lead/scripts/boxnode.ts",
    mutator: "ConditionalExpression", // Stryker's own mutator name
    original: "pnpm === null", //        the node's own text, whitespace folded
    replacement: "true", //              what Stryker puts there
    law: {
      file: ".agents/skills/lead/scripts/flow/host.test.ts",
      name: "the host step's outcomes > scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    },
  }),
];
```

- `name` is what a person types. Names are unique in a catalog.
- `file` is the product file, repo-relative. `mutator`, `original` and `replacement` name one of
  Stryker's mutants on that file by shape, with every run of whitespace folded to one space. No
  byte offset and no commit is pinned, so a blank line, a re-indent or a squash merge leaves the
  plant as it was.
- `within` (optional) is a snippet of the file, found once in it, that holds the node. It picks one
  of two equal nodes.
- `law.file` is the test file and `law.name` the test's full name as Stryker writes it for vitest 5:
  the describe chain and the title joined by ` > `, with no file name.

## What a run does

```text
read the file -> Stryker's instrumenter lists every mutant on it -> keep the ones that match the shape
  none:        refused not_found
  two or more: refused ambiguous, naming every place
  one:         Stryker runs that place against the law's file alone, with bail off
               -> read the JSON report, look up killedBy in testFiles -> answer
```

Everything that can refuse does so before Stryker starts. The answer is one of `killed` (the law is
among the tests that killed the mutant), `elsewhere` (killed, but not by the law), `survived`,
`no_coverage`, `timeout` (red, but no test is named) and `error`. Only `killed` exits 0. The record
is one JSON line: the plant, the target found (`line` from 1, `column` from 0), the law, the answer,
the other mutants on the same span with their statuses, how many tests covered the mutant, the seconds
and the Stryker and Node versions. It never holds a failure text: Stryker's `statusReason` can echo
environment values.

A plant whose target and law sit in different packages (the law reaches the target through a
workspace link) is refused as `needs_in_place` unless the `inPlace` setting is on, since Stryker's
sandbox would link back to the unmutated file. In place, Stryker backs the checkout up and restores it
when it ends; on one run here a restored file (`fixtures/pipeline-lane/codex.mjs`) came back without its
executable bit, so after an in-place run on a checkout you keep, look at `git status`.

## Run one

The repo's own edge is [`.github/ci/plants.ts`](../../.github/ci/plants.ts): the catalog, the repo's
settings and its host guard. From the repo root, where the host guard allows (CI, a cloud box, or the
owner's named yes):

```sh
node .github/ci/plants.ts stryker plant host-pnpm-path --out runs/plants/host-pnpm-path.json
# To find a shape for a new plant: every mutant on some lines, with its status and its killers.
node .github/ci/plants.ts stryker survey .agents/skills/lead/scripts/boxnode.ts \
  --law .agents/skills/lead/scripts/flow/host.test.ts --from 120 --to 135
```

The package holds no host rule of its own, but a host must give it one: the real layer asks the `Guard`
service about the test files it is about to run, right before it runs them, and a refusal
(`not_allowed`) stops the run. No command line, in any order or spelling, reaches Stryker unasked.

On disposable CI, `gh workflow run plants.yaml --ref <branch> -f plant=host-pnpm-path`. The package's
`./cli` export is an `effect/cli` command named `quality`, which a future `kalfa` will find once the
package exports a `subcommand` and gets its `kalfa.cli` field back, with its refit to `@kalfa/cli`.

## Settings

Each setting is one Effect `Config` with its default, under `quality.stryker`. The environment wins, then the values the
edge hands in, then the default. Only `KALFA_` names are read.

| Setting | Variable | Type, default | What it does |
|---|---|---|---|
| `catalog` | `KALFA_QUALITY_STRYKER_CATALOG` | a path, none: a run without one fails naming this variable | the module whose default export lists the plants |
| `concurrency` | `KALFA_QUALITY_STRYKER_CONCURRENCY` | integer, 1 or more; 1 | Stryker's test runners at once |
| `timeout` | `KALFA_QUALITY_STRYKER_TIMEOUT` | integer milliseconds, 1 or more; 60000 | Stryker's `timeoutMS` |
| `inPlace` | `KALFA_QUALITY_STRYKER_IN_PLACE` | boolean; false | mutate the checkout, not a copy |
| `ignore` | `KALFA_QUALITY_STRYKER_IGNORE` | comma-separated patterns; none | Stryker's `ignorePatterns`: what its sandbox does not copy |
| `vitest` | `KALFA_QUALITY_STRYKER_VITEST` | a path; none, which is vitest's own search | the vitest config |
| `nice` | `KALFA_QUALITY_STRYKER_NICE` | integer 0 to 19; 0 | `nice -n <this>` before Stryker; 0 is no `nice` |

Not settings: bail off, per-test coverage, the one `mutate` range and the one test file are what
makes a plant answer at all, and the report path and sandbox folder are a scoped temp folder.

## Where the code is

| File | Job |
|---|---|
| `src/stryker/Plant.ts`, `index.ts` | the schemas a catalog imports; loads no Stryker |
| `src/stryker/Target.ts` | pure: find exactly one mutant by shape |
| `src/stryker/Options.ts` | pure: Stryker's options for one target |
| `src/stryker/Report.ts` | pure: read the JSON report, decide the answer, write the record |
| `src/stryker/Mutants.ts` | the service contract: make mutants, run Stryker |
| `src/stryker/Guard.ts` | the service contract: the host says whether this machine may start the test files about to run |
| `src/stryker/node/MutantsStryker.ts` | the real layer: Stryker's instrumenter and its own bin; asks the `Guard` right before it runs |
| `src/stryker/MutantsMemory.ts` | the stand-in the laws run on |
| `src/stryker/Run.ts` | `plant` and `survey` |
| `src/cli.ts` | the `quality` command |

## Lint rules

`@kalfa/quality/oxlint` is one oxlint plugin that holds eleven rules for Effect code. It imports no other kalfa
package and no path into any repo (lint holds that), so a repo can load it alone. Its rules assume Effect v4: they
ban `Context.Tag`, `Context.GenericTag` and `Effect.Service` because v4 has none of them.

### Load it

```jsonc
// .oxlintrc.json
{
  "jsPlugins": ["@kalfa/quality/oxlint"],
  "rules": {
    "@kalfa/quality/no-promises": "error",
    "@kalfa/quality/no-hand-tag": ["error", { "allow": ["src/ledger/Log.ts"] }]
  }
}
```

The plugin is named `@kalfa/quality`, so a rule reads `@kalfa/quality/<rule>` in a config and in a disable comment, and
its code prints as `@kalfa/quality(<rule>)`. The name matches the package that ships it, so a reader who sees the code
knows what to install, and it leaves `kalfa/` free for other kalfa plugins. A config can still rename the plugin locally
with oxlint's alias form, and a rule's message then names the rule the way the config wrote it.

Oxlint resolves the specifier through `node_modules`, so the package has to be linked there. The package ships
TypeScript, which Node strips only outside `node_modules`: it loads through a workspace link, and a copy from a registry
would need a build to JavaScript first.

### The rules

| Rule | What it refuses |
|---|---|
| `effect-functions` | a named function whose returned Effect is wrapped in `Effect.withSpan`: use `Effect.fn("name")` |
| `no-cause-squash` | Effect's `Cause.squash`: read the typed failure with `findErrorOption` |
| `no-context-tag` | `Context.Tag`, `Context.GenericTag` and `Effect.Service`, in values and types |
| `no-data-taggederror` | `Data.TaggedError`, in values and types: an error is a `Schema.TaggedError` |
| `no-effect-promise` | `Effect.promise` and any `Effect.tryPromise` that is not one plain `{ try, catch }` object |
| `no-effect-run-outside-edge` | a call to any of Effect's run functions, a runtime's methods included |
| `no-hand-tag` | a hand-written `_tag` key, type member or class field: Schema writes it |
| `no-promises` | `async`, `await`, `new Promise`, `.then`, `import()` and Effect's own Promise calls |
| `no-raw-try-catch` | a `try/catch` in a file that imports Effect |
| `no-throw-in-effect-gen` | a `throw` inside `Effect.gen`, `Effect.fn` or `Effect.fn("name")` |
| `no-type-assertions` | `as any`, `as unknown as T`, `as never as T` and `<T>x` |

Each rule's file opens with what it refuses, what passes and what it misses.

### The edge

An edge is one line where the platform demands what a rule refuses, such as running an Effect or answering a Promise. It
is marked where it stands, with a disable comment that gives its reason:

```ts
// oxlint-disable-next-line @kalfa/quality/no-promises -- edge: a Durable Object answers a Promise
```

`no-promises`, `no-effect-run-outside-edge` and `no-cause-squash` show this shape in their messages, built from the
rule's own name.

### `no-hand-tag`'s option

`allow` lists the files the rule skips, as exact paths from where oxlint runs, with no leading `./` and no absolute path.
The option is for a file that stores any fact and knows no cases, such as a log. With no option, no file is skipped.

| Option | Taken |
|---|---|
| none, `["error"]` | yes: no file is skipped |
| `["error", {}]`, `["error", { "allow": [] }]` | yes: no file is skipped |
| `["error", { "allow": ["src/ledger/Log.ts"] }]` | yes: that file is skipped |
| `allow` that is not a list, an item that is not a string, an item that starts with `./` or `/`, any other key | no: the run fails before it reads a file |

### `no-promises` and the four spellings

The rule matches Effect's Promise calls by how they are written, not by type. It sees four spellings:

1. the module name as written: `Effect.promise(...)`, `Schema.decodePromise(...)`, `Stream.toAsyncIterable(...)`;
2. a renamed named import: `import { Effect as E } from "effect"`, then `E.promise(...)`;
3. a module namespace: `import * as E from "effect/Effect"`, then `E.promise(...)`;
4. the member imported by its own name: `import { tryPromise } from "effect/Effect"`, then `tryPromise(...)`.

**A known miss:** a call two names deep, `import * as X from "effect"`, then `X.Effect.promise(...)`. The object of the
call is a member, not a name. A check that reads types catches it.

### What oxlint 1.90.0 does that its docs do not say plainly

These were tried against the installed version, and the laws lean on them. Oxlint's JS plugins are alpha.

- **A rule with no `meta.schema` refuses every option**, and the whole run fails with "does not accept options". With a
  schema, oxlint checks the options against it and fails the run on a bad one, before it reads any file. `RuleTester`
  does the same check.
- **`context.id` is the rule's full name as the config wrote it.** A config alias makes it `<alias>/<rule>`, and
  `RuleTester` makes it `rule-to-test/<rule>`. A message that names its rule reads `context.id`.
- **A disable comment that names a rule that no longer exists is reported as unused**, and the line's report comes back.
  So a stale name fails `pnpm lint` by itself.
- **`RuleTester` does not read disable comments.** A law about one runs through the real oxlint.

### Where the code is

| File | Job |
|---|---|
| `src/oxlint/index.ts` | the plugin: its name and the eleven rules |
| `src/oxlint/internal/Syntax.ts` | what the rules share: dotted names, plain calls, parentheses, imports, ancestors |
| `src/oxlint/<rule>.ts` | one file per rule, named for it |
| `src/oxlint/<rule>.test.ts` | each rule's laws, in process through `RuleTester` |
| `src/oxlint/index.test.ts` | the plugin's own laws: its name and rules, and its neutral messages |
| `src/oxlint/Tester.test-support.ts` | one `RuleTester`, a way to state a file as lines, and one firing line per rule |

## Test helpers

`@kalfa/quality/vitest` holds four helpers for a law in any repo. It imports no other kalfa package
(lint holds that), so a repo's tests stay light.

```ts
import { Recorder, runsFor, Stub } from "@kalfa/quality/vitest";
import * as TestDatabase from "@kalfa/quality/vitest/TestDatabase";

fc.assert(property, { seed, numRuns: runsFor({ fast: 10, full: 100 }) });
```

- **The depth and `runsFor({ fast, full })`.** A law reads its case count here, never as a number of its own:
  `fast` on a pull request, `full` on a deeper run. The depth is read once, while the module loads, from
  `KALFA_QUALITY_VITEST_DEPTH` and from nothing else. Unset is `fast`, `fast` and `full` are the two words, and any
  other value, the empty string too, fails the import of the test file, so no law runs at a depth nobody asked for.
  `fast` may not be above `full` or under 3 (or under `full`, when that is smaller), and both must be whole numbers.
- **`Recorder`.** `Recorder.layer(Service, impl, { fails })` provides a service from `impl` and records each run of its
  effectful members as `{ method, args }`, in run order. `Recorder.calls(Service)` reads them back, typed from the
  service's own interface. It starts no span.
- **`Stub`.** `Stub.make(rest, own)` is a stand-in for a platform object: a member of `own` answers as given, every other
  method name answers `rest(name)`, and `then` and symbol keys answer `undefined`, so awaiting a stub never hangs.
- **`TestDatabase`, on its own subpath.** `make(file)` opens a SQLite file the test owns, with its journal in memory and
  no disk sync; `open(file, { readOnly, wait })` opens one that something else owns and changes nothing in it. Both close
  the connection when the scope closes. It is the one file that imports `node:sqlite`, so the root never loads it, and
  lint holds that too.

| File | Job |
|---|---|
| `src/vitest/index.ts` | the root: the depth, `Recorder` and `Stub` |
| `src/vitest/Depth.ts` | `depth`, `runsFor`, `runsAt`, `decodeDepth`; reads `KALFA_QUALITY_VITEST_DEPTH` |
| `src/vitest/Recorder.ts` | the call recorder |
| `src/vitest/Stub.ts` | the platform-object stand-in |
| `src/vitest/TestDatabase.ts` | the test database; the only file that imports `node:sqlite` |

## What it cannot tell you

A kill shows the law can fail, not that it fails for the reason a hand edit once tested: a wider
Stryker mutant (an object made `{}` for one dropped property) proves the same law less narrowly. No
Stryker mutator moves or unwraps code, so a fault of that kind has no plant here.

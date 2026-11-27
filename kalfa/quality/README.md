# @kalfa/quality

Our testing, linting and formatting tooling, one subpath per tool. So far two subpaths exist:
`@kalfa/quality/stryker`, the plant runner, and `@kalfa/quality/vitest`, the test helpers. The package
is private, imports no product code and no path into the repo (lint holds that), and reads every
repo-specific value as data from its edge.

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

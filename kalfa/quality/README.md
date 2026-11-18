# @kalfa/quality

Our testing, linting and formatting tooling, one subpath per tool
([0600](../../.decisions/0600-kalfa-quality-holds-test-lint-format.md)). So far one subpath exists:
`@kalfa/quality/stryker`, the plant runner. It is private, imports no product code and no path
into the repo (lint holds that), and reads every repo-specific value as data from its edge.

## A plant

A plant is a break put once into product code to show a law can fail
([0093](../../.decisions/0093-laws-walk-plants-run-once.md)). Here it is a mutant Stryker makes,
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
`./cli` export is an `effect/cli` command named `quality`, which a future `kalfa` finds through the
`kalfa.cli` field of this `package.json` (0585).

## Settings

Each setting is one Effect `Config` with its default, under `quality.stryker`
([0069](../../.decisions/0069-choices-are-settings.md)). The environment wins, then the values the
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

## What it cannot tell you

A kill shows the law can fail, not that it fails for the reason a hand edit once tested: a wider
Stryker mutant (an object made `{}` for one dropped property) proves the same law less narrowly. No
Stryker mutator moves or unwraps code, so a fault of that kind has no plant here.

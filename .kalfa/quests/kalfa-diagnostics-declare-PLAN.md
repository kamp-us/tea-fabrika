Approved by the lead agent, builds 0084, 0047, 0049; body 1dff5b496ee2
Plancheck-Version: 3

# Plan: @kalfa/diagnostics, declare a code and report through it (ticket 1917)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The
ticket is https://github.com/kamp-us/tea-fabrika/issues/1917, and its pull request says `Closes #1917`.
One pull request, one slice. It makes a new package, `kalfa/diagnostics/`, which holds only a glossary
today. The package says what a diagnostic is and nothing about printing one.

```ts
// The whole idea, a sketch. A package declares a code once, with its long text.
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import * as TestDiagnostics from "@kalfa/diagnostics/TestDiagnostics";

export const KeyShape = Diagnostic.make("leak-guard/key-shape", {
  explain: "A private key was found in a change. Keys never go public: ...", // Markdown
});

// In a handler. Effect<void, never, Diagnostics.Diagnostics>, and it takes only a declared code.
yield* Diagnostics.report(KeyShape, {
  severity: "error",
  message: "A line in the diff has the shape of a private key.",
  place: { path: "docs/setup.md", line: 12 },
  hint: "Remove the key and rotate it.",
});

// In a test: the test Layer collects what was reported, in order.
const seen = yield* TestDiagnostics.reported; // Effect<ReadonlyArray<Diagnostic.Reported>, never, TestDiagnostics>
// [{ code: "leak-guard/key-shape", severity: "error", message: "...", place: { path: "docs/setup.md", line: 12 }, hint: "..." }]
```

## What changes, in one paragraph

A new private workspace package, `@kalfa/diagnostics`, with three modules. `Diagnostic` holds the
shape: the code, the severity, the place, a reported diagnostic and a declared code, plus
`Diagnostic.make`. `Diagnostics` holds the service and `report`. `TestDiagnostics` holds the test
Layer that collects what was reported, and nothing that checks a message's wording. The package
imports no kalfa package, never prints and never picks an exit code, and lint holds all three. Its
rank, below Configuration, is written in the three places the repo keeps import rules today (below).
Nothing calls the package yet: moving callers, an error that carries its own diagnostic (ticket
https://github.com/kamp-us/tea-fabrika/issues/1918), and anything in `@kalfa/cli` or `@kalfa/config`
are out of scope.

## Where the ranked import order lives today

The ticket asks that the rank be written in the repo's import rules (decision 0049). I searched for
"ranked", "import order" and "ranks below" over `kalfa/`, `.kalfa/`, the root files and the lint
scripts. The order lives in three places, and this pull request edits all three:

- `kalfa/AGENTS.md`, the bullet "No import cycles": the prose rule. It names one rank so far, "the
  ledger sits below Program". It gains one sentence: Diagnostics ranks below Configuration, and
  Configuration below CLI, as decision 0084 and the owner's answer on
  https://github.com/kamp-us/tea-fabrika/issues/1751#issuecomment-7083852422 say.
- `layer-rules.json`, read by `pnpm lint:layers` (`code-graph . --layers`): the machine ranks. A row
  with a smaller `layer` number is lower, and a row may import only rows listed after it. Of the kalfa
  packages only `kalfa-config` has a row (`layer: 1`, `paths: ["kalfa/config/src"]`). It gains a
  `kalfa-diagnostics` row with `layer: 0` and `imports: []`, listed right after the `next-vitest` row,
  and `kalfa/diagnostics/src` joins `roots`. Layer 0 is below Configuration's 1, and the row sits after
  `kalfa-config` in the list, so Configuration's own ticket can grant the edge later; the reverse
  grant is refused when the rules load ("`imports` cannot grant an upward edge").
- `boundary-rules.json`, read by `pnpm lint:boundaries` (`code-graph . --boundaries`): which package may
  import which. It gains `"kalfa-diagnostics": { "imports": [], "pure": false }` and
  `"kalfa/diagnostics": "kalfa-diagnostics"`. Adding `kalfa-diagnostics` to `kalfa-config`'s list is
  Configuration's ticket, made when the edge is made, since each new edge needs its reason
  (`kalfa/AGENTS.md`).

The row goes after `next-vitest`, not right after `kalfa-config`: a row with no `layer` ranks just
under the ranked row above it, so a row placed right after `kalfa-config` would push
`next-id-test-support` below layer 0, and its import of `next-shared` would turn upward.

## Searched first

- Decisions 0047, 0048, 0049 and 0084, whole. The ticket, the owner's late answers on
  https://github.com/kamp-us/tea-fabrika/issues/1751 and the answer on
  https://github.com/kamp-us/tea-fabrika/issues/1890, and ticket 1918's text.
- `kalfa/AGENTS.md`, `kalfa/diagnostics/GLOSSARY.md`, `kalfa/cli/GLOSSARY.md`,
  `.kalfa/glossary/GLOSSARY-MAP.md` (Diagnostics is already listed there).
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and every
  kalfa glossary for "diagnostic", "severity", "long text|explain", "test layer|collects what", "exit
  code" and "line and column". Decisions 0072 and 0076 say a write command refuses "with a
  diagnostic", which this package will carry later; nothing else settles a shape this plan picks.
- Patterns: `effect-services-and-layers.md` (contract-only service file, no static member),
  `a-law-watches-calls-with-a-recorder.md` (a read that needs its test service in the type),
  `doc-comments.md` (`fabrika/jsdocs` is on for `kalfa/*/src/**`), `effect-differences-say-why.md`.
- `node_modules/effect/AGENTS.md`, whole, for Effect 4.1.3 (the lockfile's version, with its
  patch). Checked in the installed source: `Context.Service`, `Schema.Literals`, `Schema.optionalKey`,
  `Schema.isPattern`, `Schema.isNonEmpty`, `Schema.makeFilter`, `Schema.brand`,
  `Schema.decodeUnknownEffect`, and `effect/testing/TestConsole` (`layer`, `logLines`).
- The built kalfa packages: `kalfa/config` (layout, `rslib.config.ts`, `tsconfig.build.json`,
  `publishConfig.exports`, `files`), `kalfa/ci` (the newest package added, pull request
  https://github.com/kamp-us/tea-fabrika/pull/1666, for what a new package touches),
  `kalfa/records` and `kalfa/quality`.
- The lint and rule wiring a new package meets: `.oxlintrc.json` (the `kalfa/**` blocks, the
  `kalfa/*/src/**` docs rule, the config block, `@kalfa/quality`'s import block),
  `oxlint-plugins/workspace-reach.ts` (every kalfa package must be reached from the root or a reached
  package), code-graph 0.15.0's layer and boundary code in `node_modules/@demlik/code-graph/dist/index.js`,
  and the unreachable check's help text (package `exports` targets are public).
- Installed versions in `pnpm-lock.yaml`: `effect` and `@effect/vitest` 4.1.3, `vitest` 5.0.5,
  `fast-check` 4.10.2, `@rslib/core` 1.0.5 (catalog), `@demlik/code-graph` 0.15.0 with its patch.

## How others do it

- **rustc** writes `error[E0308]` and `rustc --explain E0308` prints that code's long text, Markdown,
  kept once per code in its error-code registry. This is the owner's `explain` field. From memory,
  not fetched.
- **ESLint** has each rule declare its messages once, by `messageId`, in `meta.messages`, and
  `context.report({ node, messageId })` refuses an id the rule did not declare. The severity is set by
  the user's config, never by the rule. This matches "report only through a declared code" and
  "severity is given when reporting". From memory, not fetched.
- **TypeScript** declares every diagnostic once in `diagnosticMessages.json`, with its code and its
  category (Error, Warning, Suggestion, Message). From memory, not fetched.
- **SARIF 2.1.0**, the standard format for static analysis results: a result has a `ruleId`, a
  `level` (`error`, `warning`, `note`, `none`), `message.text` and a location whose path is relative
  to the source root, with `startLine` and `startColumn` counted from 1. This is the precedent for
  repo-relative paths and lines and columns from 1. LSP counts from 0, and a printer can convert. From
  memory, not fetched.
- **Erlang/OTP**: the compiler returns errors as data, `{Location, Module, Descriptor}`, and whoever
  prints calls `Module:format_error(Descriptor)`. What an error is stays apart from printing it, as
  decision 0084 asks. **Elm**'s compiler builds a report (title, region, message) as data and renders it
  in a separate step. Neither needs a running machine here: `report` is one call with no saved state.
  From memory, not fetched.
- **Effect**: `effect/testing/TestConsole` (read in the installed 4.1.3) is a test Layer that
  collects what was written, and `TestConsole.logLines` reads it back. `TestDiagnostics` follows its
  names. One difference: `TestConsole.logLines` finds its service by a cast, and `TestDiagnostics.reported`
  needs its service in its type, as the repo's `Recorder.calls` does, so a read without the test Layer
  does not compile.

## The shape

### The package

```text
kalfa/diagnostics/
  package.json          @kalfa/diagnostics, private; exports ./Diagnostic, ./Diagnostics, ./TestDiagnostics
  README.md             what a diagnostic is, how to declare and report, how to test, how to write a message and hint
  GLOSSARY.md           exists; gains "Long text"
  rslib.config.ts       as kalfa/config's
  tsconfig.json         as kalfa/config's
  tsconfig.build.json   as kalfa/config's
  src/
    Diagnostic.ts       Code, Severity, Place, Reported, Declared, make: schemas and one constructor, nothing that runs
    Diagnostics.ts      the Diagnostics service (contract only) and report
    TestDiagnostics.ts  the test Layer that collects, and reported
```

No root entry: subpaths only, as `@kalfa/config` exports. `TestDiagnostics` stays off any path a
product imports, as Effect keeps `TestConsole` under `effect/testing`.

```jsonc
// kalfa/diagnostics/package.json, a sketch.
{
  "name": "@kalfa/diagnostics", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "build": "rslib build", "typecheck": "tsc --noEmit" },
  "exports": {
    "./Diagnostic": "./src/Diagnostic.ts",
    "./Diagnostics": "./src/Diagnostics.ts",
    "./TestDiagnostics": "./src/TestDiagnostics.ts",
    "./package.json": "./package.json"
  },
  "publishConfig": { "exports": { "./Diagnostic": { "types": "./dist/Diagnostic.d.ts", "default": "./dist/Diagnostic.js" } /* and the other two */ } },
  "files": ["dist", "!dist/.rsbuild"],
  "peerDependencies": { "effect": "catalog:" },
  "devDependencies": { "@effect/platform-node, @effect/vitest, @rslib/core, @types/node, effect, fast-check, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

No `dependencies` at all, and no `@kampus/vitest`: the package's tests use `@effect/vitest` and
`fast-check` straight, so the package needs nothing from this repo, and the layer and boundary rows can
say `imports: []`. Laws here run in memory, so a literal `numRuns` passes `fabrika/runs-from-depth`.

### Diagnostic.ts

```ts
// kalfa/diagnostics/src/Diagnostic.ts, a sketch. Doc blocks left out.
import { Schema } from "effect";

// A code: a root name, a slash, a name. Lowercase words joined by hyphens: "config/unknown-setting".
// The root starts with a letter, as a subcommand's first word does; the name may start with a digit.
const CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const Code = Schema.String.check(Schema.isPattern(CODE)).pipe(Schema.brand("@kalfa/diagnostics/Code"));
export type Code = typeof Code.Type;

export const Severity = Schema.Literals(["error", "warning"]);
export type Severity = typeof Severity.Type;

// A path from the repo root: "." for the whole repo, else segments joined by "/". A segment is not
// empty, ".", or "..", and holds no "\". So no leading "/", no "./", no "//", no trailing "/".
const Path = Schema.String.check(Schema.makeFilter(isRepoPath, { title: "a path from the repo root" }));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)); // lines and columns count from 1

export const Place = Schema.Struct({
  path: Path,
  line: Schema.optionalKey(Count),
  column: Schema.optionalKey(Count),
}).check(
  Schema.makeFilter(columnNeedsLine, { title: "a column needs a line" }),
  Schema.makeFilter(wholeRepoHasNoLine, { title: "the whole repo has no line" }),
);
export type Place = typeof Place.Type;

// A message or a hint: some text that is not only spaces.
const Said = Schema.String.check(Schema.makeFilter((s: string) => s.trim().length > 0, { title: "not blank" }));

export const Reported = Schema.Struct({ code: Code, severity: Severity, message: Said, place: Place, hint: Said });
export type Reported = typeof Reported.Type;

// A declared code. Only `make` builds one: the key is a symbol this module does not export, so an
// object literal with a code and a text is not a Declared, and `report` takes no plain string.
const TypeId: unique symbol = Symbol.for("@kalfa/diagnostics/Declared");
export interface Declared {
  readonly [TypeId]: typeof TypeId;
  readonly code: Code;
  readonly explain: string; // the long text, Markdown, kept as given
}

// Throws when the code is malformed or the long text is blank. It runs where a code is declared, at a
// module's top level, so a bad declaration stops the import, as Schema's `makeUnsafe` throws.
export const make: (code: string, options: { readonly explain: string }) => Declared;
```

### Diagnostics.ts

```ts
// kalfa/diagnostics/src/Diagnostics.ts, a sketch.
import { Context, Effect, Schema } from "effect";
import * as Diagnostic from "./Diagnostic.ts";

// The contract only. Whoever runs the handler provides it: a command that prints, or the test Layer.
export class Diagnostics extends Context.Service<
  Diagnostics,
  { readonly report: (diagnostic: Diagnostic.Reported) => Effect.Effect<void> }
>()("@kalfa/diagnostics/Diagnostics") {}

// The fields beside the code, as a caller writes them.
type Fields = Omit<typeof Diagnostic.Reported.Encoded, "code">;

// Builds the diagnostic from a declared code and the fields, checks it with `Reported`, and hands it
// to the service. A blank message or hint, or a bad place, is a bug in the reporting code, not a
// condition a caller can handle, so it dies with the SchemaError that names the field, and nothing
// is reported. The span carries the code and the severity.
export const report: (code: Diagnostic.Declared, fields: Fields) => Effect.Effect<void, never, Diagnostics> =
  Effect.fn("Diagnostics.report")(function* (code, fields) {
    const reported = yield* Schema.decodeUnknownEffect(Diagnostic.Reported)({ ...fields, code: code.code }).pipe(Effect.orDie);
    yield* Effect.annotateCurrentSpan({ code: reported.code, severity: reported.severity });
    const diagnostics = yield* Diagnostics;
    yield* diagnostics.report(reported);
  });
```

`report` lives in the module, not on the class: the class holds nothing static
(`effect-services-and-layers.md`), so a caller writes `Diagnostics.report(...)` through the module
namespace and needs `Diagnostics.Diagnostics`, as Effect writes `FileSystem.FileSystem`.

### TestDiagnostics.ts

```ts
// kalfa/diagnostics/src/TestDiagnostics.ts, a sketch.
import { Context, Effect, Layer, Ref } from "effect";
import type * as Diagnostic from "./Diagnostic.ts";
import * as Diagnostics from "./Diagnostics.ts";

export class TestDiagnostics extends Context.Service<
  TestDiagnostics,
  { readonly reported: Effect.Effect<ReadonlyArray<Diagnostic.Reported>> }
>()("@kalfa/diagnostics/TestDiagnostics") {}

// One Ref behind both services. Each build starts empty and keeps every report in order, repeats too.
export const layer: Layer.Layer<Diagnostics.Diagnostics | TestDiagnostics>;

export const reported: Effect.Effect<ReadonlyArray<Diagnostic.Reported>, never, TestDiagnostics>;
```

It exports these three names and nothing else: no helper that checks a message's wording (owner's
answer on 1751, and the ticket). This file holds a service and its Layer together, as Effect's
`TestConsole` does. That differs from the contract-only rule for product services, and its opening
comment says why: a test module is never in a product's bundle, and one import gives a law both the
Layer and the read.

### What lint holds

One new `.oxlintrc.json` override for `kalfa/diagnostics/src/**`, tests left out, after
`@kalfa/quality`'s blocks. An override replaces a rule's options, so it repeats the base
`no-restricted-imports` entries and adds:

- **No kalfa or repo package:** patterns `@kalfa/*`, `@kampus/*`, `@tea-fabrika/*`, and any relative
  path out of the package (`../../*`).
- **No printing:** `effect/Console` and the `Console` name from `effect`; `eslint/no-console`.
- **No exit code:** `@effect/platform-node` and its subpaths (its `runMain` sets the exit code), and
  `eslint/no-restricted-globals` for `process` and `console`.

The same folder also joins the files of `kalfa/config`'s Effect block (`no-promises`, `no-node-imports`,
`no-effect-run-outside-edge`, `effect-functions`, `written-service-type`, `no-hand-tag` and the rest), so
the code is held to the same Effect rules as Configuration. The new override comes after it, so its
`no-restricted-imports` wins for these files. `fabrika/jsdocs` already covers `kalfa/*/src/**`, so
every public export needs its Effect-shaped doc block. Logging through `Effect.log` also prints by
default; no lint rule here can see a member call like that, so the review holds it, and the README
says the package never logs.

`boundary-rules.json`'s `pure: true` would refuse `process` and `console` too, and was weighed. It is
not used: that file has no `testFiles` key, so code-graph judges a pure library's own test files as
impure too, and the package's file-reading laws below would fail it. That gap is a finding.

## One value traced: `KeyShape`, reported once, then a blank hint

1. `Diagnostic.make("leak-guard/key-shape", { explain })` decodes the code with `Code`: it matches,
   so it becomes the branded `Code`. The long text is not blank. The answer is a `Declared` with that
   code and the text exactly as given.
2. A handler runs `Diagnostics.report(KeyShape, { severity: "error", message: "A line in the diff has
   the shape of a private key.", place: { path: "docs/setup.md", line: 12 }, hint: "Remove the key and
   rotate it." })`.
3. `report` builds `{ code: "leak-guard/key-shape", severity, message, place, hint }` and decodes it
   with `Reported`. The path has two segments, the line is 12 and there is no column: it passes.
4. The span `Diagnostics.report` gets `code` and `severity`. `report` yields `Diagnostics.Diagnostics`.
   Under `TestDiagnostics.layer` that is the Ref-backed service, which appends the diagnostic.
5. `yield* TestDiagnostics.reported` answers a list of one: the same five fields.
6. The same handler then reports with `hint: "  "`. The decode fails on `hint` ("not blank"). `report`
   dies with that SchemaError, so the fiber's exit is a defect, not a typed error, and the Ref is not
   touched. Read in the same provide, `TestDiagnostics.reported` still answers the list of one.
7. `kalfa/diagnostics/src/Diagnostics.ts` imports only `effect` and `./Diagnostic.ts`. A planted import
   of `@kalfa/config/App` fails `no-restricted-imports`, `pnpm lint:boundaries` (kalfa-diagnostics
   lists no import) and `pnpm lint:layers` (the row's `imports` is empty).

## What fact is lost if not recorded now

None. The package stores nothing and keeps no log: a reported diagnostic goes to whoever provides
`Diagnostics`, which prints it. Which package reported a diagnostic is its code's root, so it is not
lost either. A saved record of reports, if one is ever wanted, belongs to the command that prints them.

## Laws

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3, with Schema-derived inputs where
Effect can make them and fast-check arbitraries where a law needs built text. None needs a real
resource: every law runs on every pull request.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D1, the code's form: for generated codes, `Code` accepts a root of lowercase words joined by single hyphens, starting with a letter, then one slash, then a name of the same words; it refuses each break of one: no slash, a second slash, an empty side, an uppercase letter, a space, a leading or trailing hyphen, a double hyphen, a root starting with a digit. 200 runs | test | fc.record: a root and a name built from word lists, and one break picked with fc.constantFrom or none | let the pattern allow `/` inside the name: the second-slash case passes, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D2, the place: for generated places, `Place` accepts `.` and any relative path of good segments, with no line, a line, or a line and a column, each at least 1; it refuses an empty path, a leading `/`, a `./` start, a `..` or `.` segment, an empty segment, a trailing `/`, a backslash, a line or column of 0, a negative or a fraction, a column with no line, and a line on `.`. 200 runs | test | fc.record: segments from fc.stringMatching, a line and column choice, and one break picked or none | drop the column-needs-line check: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D3, a reported diagnostic: `Reported` refuses a message or a hint that is empty or only whitespace, a severity other than `error` or `warning`, and an input missing any one of its five fields; it accepts every other generated value, and encoding then decoding gives the same value. 200 runs | test | Effect Arbitrary: Diagnostic.Reported | check the hint with `isNonEmpty` only: a hint of spaces passes, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D4, make declares: for a generated good code and a non-blank Markdown text, `make` answers a `Declared` whose `code` equals the input and whose `explain` is the text byte for byte, whitespace kept; for a malformed code or a blank text it throws, and the error names the code or the text. 100 runs | test | fc.record: a good or broken code from D1's builder, and a text from fc.string with blanks among them | trim `explain` before keeping it: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D5, report collects in order: for a generated list of declared codes and good fields, reporting each in turn under `TestDiagnostics.layer` makes `TestDiagnostics.reported` answer the same list of `Reported` values in the same order, repeats kept, each `code` equal to its declared code's. 100 runs | test | fc.array: 0 to 8 pairs of a declared code and fields, repeats allowed | keep only the last report: red; dedupe repeats: red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D6, bad fields die and report nothing: for a generated good list with one bad field set put in at a generated spot (a blank message, a blank hint, a bad place), the run's exit is a defect holding a SchemaError, not a typed failure, and `TestDiagnostics.reported` holds exactly the good reports before the spot. 100 runs | test | fc.record: a good list from D5, a spot, and a break from fc.constantFrom | append before the decode: the bad one is collected, red; fail with the error instead of dying: the exit is a typed failure, red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D7, each build starts empty: two runs, each with its own `TestDiagnostics.layer`, each see only their own reports | test | scenario: two provides of the layer, one report each | keep the Ref at module level: the second run sees two, red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D8, report's type: `Diagnostics.report(declared, fields)` is `Effect<void, never, Diagnostics.Diagnostics>`; a string code, an object literal `{ code, explain }`, a missing field, and a severity `"info"` each do not compile | type | type | widen the first parameter to `Declared \| string`: the string line compiles and its `@ts-expect-error` is unused, red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D9, the test Layer's types: `TestDiagnostics.layer` is `Layer<Diagnostics.Diagnostics \| TestDiagnostics.TestDiagnostics>`, and `TestDiagnostics.reported` is `Effect<ReadonlyArray<Diagnostic.Reported>, never, TestDiagnostics.TestDiagnostics>`, so a read without the test Layer does not compile | type | type | read through a cast with `never` as its requirement, as `TestConsole` does: red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D10, no wording helper: the runtime exports of `TestDiagnostics` are exactly `TestDiagnostics`, `layer` and `reported` | test | scenario: the module's own exports at head | export an `expectMessage` helper: red | kalfa/diagnostics/src/Package.test.ts |
| D11, the manifest: `kalfa/diagnostics/package.json` names no `@kalfa/` or `@kampus/` package in any dependency field, has no `dependencies`, has only `effect` as a peer, exports exactly `./Diagnostic`, `./Diagnostics`, `./TestDiagnostics` and `./package.json`, and gives each module a `dist` pair under `publishConfig.exports` | test | scenario: the package's own manifest at head | add `@kampus/vitest` to its dev dependencies: red | kalfa/diagnostics/src/Package.test.ts |
| D12, nothing specific to this repo (decision 0047): no file git tracks under `kalfa/diagnostics/` holds the words `fabrika`, `kampus`, `kamp-us` or `.kalfa/`, in any letter case | test | scenario: the package's tracked files at head | write `tea-fabrika` into the README: red | kalfa/diagnostics/src/Package.test.ts |
| D13, imports no kalfa or repo package: an import of `@kalfa/*`, `@kampus/*`, `@tea-fabrika/*` or a path out of the package, in any file under `kalfa/diagnostics/src/` but its tests, is refused | lint | lint | import `@kalfa/config/App` in `Diagnostic.ts`: lint red | .oxlintrc.json |
| D14, never prints and never picks an exit code: `console.log`, an import of `Console` from `effect` or of `effect/Console`, `process.exitCode = 1`, and an import of `@effect/platform-node` in a file under `kalfa/diagnostics/src/` but its tests are each refused | lint | lint | each of the four, one at a time, in `Diagnostics.ts`: lint red each time | .oxlintrc.json |
| D15, the rank: the package imports no other workspace package (`pnpm lint:boundaries` and `pnpm lint:layers`), and its layer row ranks below `kalfa-config` | lint | lint | (a) import `@kalfa/config/App` in `Diagnostic.ts`: both checks red; (b) grant `"imports": ["kalfa-config"]` on the `kalfa-diagnostics` row: `lint:layers` refuses the rules file, red | layer-rules.json, boundary-rules.json |

No law needs launchd, the real Electron app, a real OS process or socket, or a real signal, so none is
host-only and none waits on the owner's Mac. No law is a `*.integration.test.ts` file: D10 to D12 read
the package's own files and module, which `fabrika/runs-from-depth` does not count as real IO, and
every other law runs in memory. No secret flows through the package, so no law is a `[secrets]` law;
the glossary's rule that a message never quotes private text is the writer's, and the README says it.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/diagnostics/package.json | tests | tests | new: name, `private`, `build` and `typecheck` scripts, exports, `publishConfig.exports`, `files`, `effect` as peer, dev dependencies. The tests step owns it with the lockfile, so its laws can install and run red |
| kalfa/diagnostics/tsconfig.json | tests | tests | new: as `kalfa/config`'s, with the Effect checks |
| kalfa/diagnostics/tsconfig.build.json | tests | tests | new: as `kalfa/config`'s |
| kalfa/diagnostics/rslib.config.ts | build | 12 | new: as `kalfa/config`'s |
| kalfa/diagnostics/src/Diagnostic.ts | build | 110 | new: `Code`, `Severity`, `Place`, `Reported`, `Declared`, `make`, with doc blocks |
| kalfa/diagnostics/src/Diagnostics.ts | build | 45 | new: the service and `report` |
| kalfa/diagnostics/src/TestDiagnostics.ts | build | 55 | new: the test service, `layer`, `reported`, and the opening comment on why it holds a Layer |
| kalfa/diagnostics/README.md | build | docs | new: what a diagnostic is; declare, report, test; how to write a message (a fact, no private text) and a hint (what to do next, or that a person must decide); what the package never does (print, log, pick an exit code) |
| kalfa/diagnostics/GLOSSARY.md | build | docs | add the term "Long text" (below) |
| kalfa/AGENTS.md | build | docs | the "No import cycles" bullet gains: Diagnostics ranks below Configuration, and Configuration below CLI |
| kalfa/diagnostics/src/Diagnostic.test.ts | tests | tests | D1 to D4 |
| kalfa/diagnostics/src/Diagnostics.test.ts | tests | tests | D5 to D7 |
| kalfa/diagnostics/src/Diagnostics.types.test.ts | tests | tests | D8, D9 |
| kalfa/diagnostics/src/Package.test.ts | tests | tests | D10 to D12 |
| .oxlintrc.json | tests | tests | D13, D14: one override for `kalfa/diagnostics/src/**`, and that folder added to the files of `kalfa/config`'s Effect block |
| layer-rules.json | tests | tests | D15: the `kalfa-diagnostics` row after `next-vitest`, and `kalfa/diagnostics/src` in `roots` |
| boundary-rules.json | tests | tests | D15: the `kalfa-diagnostics` library type and its `libraries` entry |
| package.json | tests | tests | `@kalfa/diagnostics` as a root dev dependency, so `pnpm lint:reach` finds the package reached, as `@kalfa/ci` was added before it had another user |
| pnpm-lock.yaml | tests | tests | the new `kalfa/diagnostics` importer and the root's new link |
| vitest.config.ts | tests | tests | no change: its `kalfa/*/src/**/*.test.{ts,tsx}` glob already finds the laws |
| oxlint-plugins/workspace-reach.ts | tests | tests | no change: read to learn that every kalfa package must be reached, which the root dev dependency answers |
| unreachable-ledger.json | tests | tests | no change expected: package `exports` targets are public to `pnpm lint:dead`. If it still flags an export, the step comes back to the plan, never to this ledger |

## Existing tools

- `kalfa/diagnostics/src/Diagnostic.ts`: searched Effect 4.1.3 (`Schema`, `Brand`, `effect/testing`),
  `@effect/vitest`, `kalfa/records/src/Finding.ts` (records' own union of check results, a
  per-check shape with no code, hint or severity) and npm for a diagnostic schema. SARIF has JSON
  Schema files and LSP has TypeScript types, but neither is an Effect Schema, and both carry fields the
  owner did not ask for. So the five-field schema is new, built from Effect's own checks
  (`isPattern`, `makeFilter`, `optionalKey`, `brand`).
- `kalfa/diagnostics/src/Diagnostics.ts`: searched `kalfa/config/src/Toml.ts` and the services
  pattern for the contract shape (used as is: `Context.Service` with its type written out, keyed by
  package and file), and Effect for a reporting service. Effect has none; `Console` prints, which this
  package must not do.
- `kalfa/diagnostics/src/TestDiagnostics.ts`: searched `effect/testing/TestConsole` (the model for the
  names `layer` and a read), `@kampus/vitest`'s `Recorder` (it records calls and their arguments, not
  values; it needs `@kampus/vitest`, which a package usable alone may not import, and a law would read
  the argument lists of `report` instead of the diagnostics) and `Layer.mock`. A Ref behind two
  services is the smallest fit.
- `kalfa/diagnostics/rslib.config.ts`: searched `kalfa/config/rslib.config.ts`, copied as it is: the
  same entry globs, which leave tests and test support out of `dist`.

## Calls taken

- **The code's form, 80%.** A root name, one slash, a name, each lowercase words joined by hyphens.
  The glossary fixes only that a code starts with its subcommand's root name; this picks how. It is
  strict now because loosening it later breaks no code already written, and there is no saved data
  before the first release.
- **A bad field dies, 85%.** The ticket fixes the type as `Effect<void, never, Diagnostics>`, and a
  blank message is a bug in the reporting code. Effect treats a bug as a defect: its own `makeUnsafe`
  throws on bad input. The defect carries the SchemaError, which names the field.
- **`make` throws on a bad declaration, 80%.** It runs at a module's top level, so a bad code stops the
  import at once, the earliest place anyone can see it. Effect's `makeUnsafe` behaves the same.
- **Lines and columns count from 1, 85%.** As SARIF and the compilers' printed `file:line:column` form
  do; the glossary's place is read by people and agents in that form.
- **A column needs a line, and `.` takes no line, 85%.** Each is a place that cannot point anywhere.
- **Blank means only whitespace, 80%.** A message of spaces says nothing. This is no wording check: it
  reads no words.
- **`Declared` and `Reported` as the type names, 75%.** The owner's sketch on 1751 names
  `Diagnostic.Reported`; the ticket calls the first argument of `report` a declared code. The doubt is
  whether a reader takes `Diagnostic.Declared` for a declared diagnostic rather than a declared code.
  The README says it in its first lines. A rename later is one search and replace with no saved data.
- **Subpaths only, no root entry, 80%.** As `@kalfa/config` does, and it keeps `TestDiagnostics` out of
  anything a product imports.
- **The build setup is copied from `kalfa/config`, 85%.** The brief asks for it. The archive and its
  installed consumer check are left out: nobody installs this package outside the repo yet, and that
  check is a CI workflow, which belongs to a delivery ticket.
- **No `@kampus/vitest` in the tests, 85%.** The laws run in memory, so they need no test depth, and the
  package then needs nothing from this repo, not even for its tests.
- **The README carries the message and hint guidance, 80%.** The owner put that guidance in CLI's
  README on 1751, before decision 0084 moved the words of a diagnostic here. CLI's README can point to it.
- **Is any of this a setting? No.** The code's form, the place's rules and the two severities are the
  protocol that every reporting package and the printing command read alike, so a setting that changes
  one would split them. Which severity a report gets is the caller's, and a caller may read it from its
  own setting, as decision 0084 says.

## Validation

- tests step: `pnpm install --offline` once, to add the new importer to the lockfile (a new workspace
  package cannot go in with `--frozen-lockfile`); then
  `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/diagnostics` shows D1 to D7 and D10 to D12 red on
  the missing modules. D13 to D15's plants run by hand with `pnpm lint`, each undone, each red.
- build step: the same vitest path green, `pnpm format`, `pnpm lint` (it runs `lint:layers`,
  `lint:boundaries`, `lint:reach` and `lint:dead`), and `pnpm --filter @kalfa/diagnostics build` once,
  listing the `dist` files it writes, then deleting them.
- The lead runs `pnpm typecheck`, which holds D8 and D9 and the doc blocks' types, and the narrow
  paths. The lockfile change makes `--changed` the whole suite, so the full run is CI's.

## Size

1. One slice, the package: about 222 product lines (`Diagnostic.ts` 110, `TestDiagnostics.ts` 55,
   `Diagnostics.ts` 45, `rslib.config.ts` 12), plus D1 to D15, the README, the glossary term, the
   `kalfa/AGENTS.md` sentence and the rule rows. It lands whole: another package can declare a code,
   report through it and test what it reported.

About 3 agent hours across the steps, 75% sure. The doubt is the lint and code-graph wiring: a first
`kalfa/` row in `layer-rules.json` after `kalfa-config`, and a first new override with these import
groups, may need one send-back. Budget: the kalfa-config plan measured about $5 a step at list
price for a package of this size, so tests, build, review and one likely send-back.

Estimate: 4 steps, $20

## New names

- `Diagnostic.Reported`: the owner's name on 1751, a reported diagnostic.
- `Diagnostic.Declared`: a declared code, the value `make` answers (the ticket's "a declared code").
- `explain`: the owner's key for a code's long text.
- `TestDiagnostics`, `TestDiagnostics.layer`, `TestDiagnostics.reported`: Effect's `TestConsole` naming.

## Records

- `kalfa/diagnostics/GLOSSARY.md` gains one term, in the build:

  **Long text**:
  A code's full explanation, written in Markdown where the code is declared. The command prints it on
  request. A diagnostic's message stays short because the long text exists.
  _Avoid_: docs, description, explanation, help

- `kalfa/AGENTS.md`'s one sentence on the rank, as above.
- No new decision: decision 0084 holds the ruling, and this plan only builds it. No pattern doc yet:
  the first caller shows whether "declare a code, report through it" needs one.
- `field/runs/` rows for each step, by the lead.

## What this cannot tell us

- Whether the code's form fits every package's codes. Only two real codes exist so far, both in sketches.
- Whether a defect is the right answer for a blank message in practice. No handler reports yet.
- Whether CLI's printing Layer fits this contract. CLI is not built, and its ticket waits on this one.
- Whether the built `dist` installs in another repo: no consumer check runs for this package.
- The rank's machine check covers only `kalfa/diagnostics/src`. A file outside it, such as
  `rslib.config.ts`, is held by review alone.

## Open questions

None.

## Findings

1. **`kalfa/AGENTS.md` says no check enforces its import guidelines, but two do.** Its opening says "They
   are guidelines, not laws: no check enforces them". `boundary-rules.json` gives `kalfa-records`
   `"imports": ["kalfa-config", "next-vitest"]` and `kalfa-ci` `"imports": ["next-vitest"]`, and
   `pnpm lint:boundaries` (`code-graph . --boundaries --ci`) fails an import outside the list.
   `layer-rules.json` ranks `kalfa-config` at `layer: 1`, and `pnpm lint:layers` fails an upward
   import. This plan adds one more checked row and does not reword the opening; whether the page
   should say which kalfa imports are checked is the lead's call.
2. **`boundary-rules.json` has no `testFiles` key, so `pure: true` cannot be used for any library whose
   tests touch files.** In code-graph 0.15.0, the boundary rules' `testFiles` defaults to `[]`
   (`node_modules/@demlik/code-graph/dist/chunk-HMGUJVD6.js:134`), and the impure kind is skipped only
   in a file known to be a test (`JUDGES_TEST_FILES`, `node_modules/@demlik/code-graph/dist/index.js:4864-4884`). Every library row in the file says
   `"pure": false` today. A `testFiles` key would let a library that never touches the outside world
   say so in the rules file, at the cost of re-judging every library's test files for the other kinds.

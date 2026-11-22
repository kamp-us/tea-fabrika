Approved by the lead agent, builds 0084, 0047, 0049, 0063; body 1311ff0610f4
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
  "devDependencies": { "@effect/platform-node, @effect/vitest, @rslib/core, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

No `dependencies` at all, and no `@kampus/vitest`: the package's tests use `@effect/vitest` and Effect's
own `Arbitrary` straight, so the package needs nothing from this repo, and the layer and boundary rows can
say `imports: []`. No `fast-check` either: no file imports it, and Effect 4.1.3 carries its own copy, so
the dev dependency is dead weight. Laws here run in memory, so a literal `numRuns` passes
`fabrika/runs-from-depth`.

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

// A reported diagnostic that came through `report`: its code was declared with `make`, and its fields
// passed `Reported`. The brand is declared, never made: no value outside this file can carry it, and it
// adds nothing at run time, so the value is a plain `Reported`. Neither name is exported.
declare const checked: unique symbol;
type Checked = Diagnostic.Reported & { readonly [checked]: true };

// The contract only. Whoever runs the handler provides it: a command that prints, or the test Layer.
// Its method takes only a `Checked`, so only `report` below can hand it anything.
export class Diagnostics extends Context.Service<
  Diagnostics,
  { readonly report: (diagnostic: Checked) => Effect.Effect<void> }
>()("@kalfa/diagnostics/Diagnostics") {}

// The fields beside the code, as a caller writes them.
export type Fields = Omit<typeof Diagnostic.Reported.Encoded, "code">;

// Builds the diagnostic from a declared code and the fields, checks it with `Reported`, and hands it
// to the service. A blank message or hint, or a bad place, is a bug in the reporting code, not a
// condition a caller can handle, so it dies with the SchemaError that names the field, and nothing
// is reported. The span carries the code and the severity, never the message or the hint.
export const report: (code: Diagnostic.Declared, fields: Fields) => Effect.Effect<void, never, Diagnostics> =
  Effect.fn("diagnostics.report")(function* (declared, fields) {
    const reported = yield* Schema.decodeUnknownEffect(Diagnostic.Reported)({ ...fields, code: declared.code }).pipe(Effect.orDie);
    yield* Effect.annotateCurrentSpan({
      "kalfa.diagnostics.code": reported.code,
      "kalfa.diagnostics.severity": reported.severity,
    });
    const diagnostics = yield* Diagnostics;
    // The one place the brand goes on: the code came from a Declared, and the fields just passed Reported.
    yield* diagnostics.report(reported as Checked);
  });
```

`report` lives in the module, not on the class: the class holds nothing static
(`effect-services-and-layers.md`), so a caller writes `Diagnostics.report(...)` through the module
namespace and needs `Diagnostics.Diagnostics`, as Effect writes `FileSystem.FileSystem`.

**Why the service takes a `Checked`, not any `Reported` (call, 85%).** Decision 0084 says a handler reports
only through a declared code, so a code nobody declared cannot be reported. With `Reported` as the
method's type, anyone could decode a value with the public Schemas and call the service's own method:
an undeclared code, a blank message and hint, a bad place, and the test Layer would collect it. Now the
method takes a type only `report` makes. What this keeps:

- **A provider reads every field.** `Checked` is a `Reported` with one more type-only key, so a provider
  reads `code`, `severity`, `message`, `place` and `hint` as before. A provider may even write its
  function over `Diagnostic.Reported`: a function that takes the wider type fits the method. So a
  provider never needs to name `Checked`, and it stays unexported.
- **`TestDiagnostics.reported` reads back plain values.** The brand is type-only, so the collected values
  are the decoded objects, and `toEqual` against plain objects holds. `TestDiagnostics.ts` does not
  change: it appends what it is handed to its `Ref<ReadonlyArray<Diagnostic.Reported>>`.
- **`Reported` still round trips (law D3).** The `Reported` Schema does not change.
- **The names do not change.** `Reported`, `explain`, and `TestDiagnostics`, `layer` and `reported` stay.
  `Diagnostics` exports `Diagnostics`, `Fields` and `report`, as at head.

Is the package's other guard, the unexported unique symbol on `Declared`, the right way here too? The
same idea, an unexported unique symbol, but as a type only (`declare const`), not a key on the value:

- A real key on the value would ride into the test Layer's list, and vitest's `toEqual` compares
  enumerable symbol keys, so every law that compares the list with plain objects would need the key
  stripped first. `Declared` has no such reader, so its real key costs nothing there.
- `Schema.brand` does not fit: its key is Effect's public `Brand` key with a string name, so a caller's
  own `Schema.brand` with the same name makes the same type, and decoding with the public `Reported`
  plus that brand forges one.
- A type-only brand is the repo's known way: `next/packages/vitest/src/Recorder.ts` (`declare const
  RecordedId: unique symbol`) and today's `packages/pipeline/src/stages/ship/ready.ts` ("Declared, never
  made: no value outside this file can carry it").

Its cost is one type assertion, `reported as Checked`, the only one in the package, right after the
decode. `fabrika/no-type-assertions` leaves a lone narrowing cast to review, and the comment on the line
before says why it holds. A caller could forge a `Checked` the same way, with a cast of its own; no type
can stop a cast, and the review holds that in a calling package.

**The span (call, 80%).** Decision 0063: a span's name is `<package>.<call>`, and its attributes use
OpenTelemetry's standard names first, with `kalfa.<package>.*` only where none exists. So the span is
`diagnostics.report`, not `Diagnostics.report`. OpenTelemetry has no attribute for a diagnostic's code or
severity (its `code.*` names are about source code, and a log record's severity is a field, not a span
attribute), so the keys are `kalfa.diagnostics.code` and `kalfa.diagnostics.severity`. The message and the
hint stay out, as 0063 keeps message text out of spans by default. Law D17 holds the name and the keys.
The doubt: no kalfa package names a span this way yet (`kalfa/quality`'s are `Run.plant` and
`Run.survey`), so whether `<package>` is `diagnostics` or the full `@kalfa/diagnostics` is my reading of
0063's `kalfa.<package>.*`, which uses the short name.

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
`no-restricted-imports` and `no-restricted-globals` entries and adds the ones below. Nothing else
refuses a Node module here: `fabrika/no-node-imports` checks only files under `next/` and `.agents/`
(`heldToNext` in `oxlint-plugins/match.ts:112`, read at `oxlint-plugins/no-node-imports.ts:47`), so in
`kalfa/` it does nothing. Lint at the reviewed head passed `import proc from "node:process"`,
`import { log } from "node:console"`, `globalThis.process.exitCode = 1` and `globalThis.console.log("x")`.
The override refuses:

- **No kalfa or repo package (imports):** patterns `@kalfa/**`, `@kampus/**`, `@tea-fabrika/**`, and
  any relative path out of the package (`../../**`).
- **No Node module at all (imports), in both spellings:** the pattern group `node:*` and `node:*/**`,
  and the bare names `process`, `console`, `fs`, `fs/promises`, `tty`, `readline`,
  `readline/promises`, `child_process`, `worker_threads`, `cluster` and `module`. The package needs no
  Node module. The bare list is the modules that print, write to a file descriptor, reach the process or
  load another module; a bare builtin left off it is refused by nothing (Findings, 3).
- **No printing (imports):** `effect/Console`, `effect/Stdio`, `effect/Terminal`, and the names
  `Console`, `Stdio` and `Terminal` from `effect`. An `importNames` entry also refuses a namespace
  import, `import * as E from "effect"`, because a namespace import takes every name: the override at
  head already refuses it for `Console`, so `E.Console.log` does not escape.
- **No exit code (imports):** `@effect/platform-node` and `@effect/platform-node/**` (its `runMain` sets
  the exit code), `effect/Runtime`, and the name `Runtime` from `effect` (its `makeRunMain` and
  `defaultTeardown` pick the exit code).
- **No printing and no exit code (globals):** `eslint/no-console`, and `eslint/no-restricted-globals`
  for `console`, `process`, `globalThis`, `global`, `self` and `window`. A ban on `process` alone sees
  only the bare name: `globalThis.process` is a member read. Refusing the global object itself also
  covers `globalThis["process"]` and an alias such as `const g = globalThis`. The package has no use for
  the global object.

The same folder also joins the files of `kalfa/config`'s Effect block (`no-promises`,
`no-effect-run-outside-edge`, `effect-functions`, `written-service-type`, `no-hand-tag` and the rest), so
the code is held to the same Effect rules as Configuration. Two rules in that block, `no-node-imports`
and `no-ledger-sql`, check only `next/` and `.agents/`, so they hold nothing here (Findings, 3). The new
override comes after the block, so its `no-restricted-imports` wins for these files. `fabrika/jsdocs`
already covers `kalfa/*/src/**`, so every public export needs its Effect-shaped doc block. Logging
through `Effect.log` also prints by default; no lint rule here can see a member call like that, so the
review holds it, and the README says the package never logs.

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
4. The span `diagnostics.report` gets `kalfa.diagnostics.code` = `leak-guard/key-shape` and
   `kalfa.diagnostics.severity` = `error`, and nothing from the message or the hint. `report` yields
   `Diagnostics.Diagnostics` and hands it the decoded value as a `Checked`: the same object, with the
   brand in its type only. Under `TestDiagnostics.layer` that is the Ref-backed service, which appends it.
   A caller that decodes the same five fields with the public `Reported` and calls the service's own
   `report` with them does not compile: its value is a `Reported`, not a `Checked`.
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

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3, with inputs built from Effect's own
`Arbitrary` (`Arbitrary.schema`, `Arbitrary.all`, `Arbitrary.array`, `Arbitrary.map`), as the shared
generators in `kalfa/diagnostics/src/Diagnostic.test-support.ts` do. None needs a real resource: every
law runs on every pull request.

A generator's reach is part of its law. Where a row below says what its generator must reach, each
group is checked in every run, not left to chance: each run takes its drawn value and also checks one
made from it for each group, the way the support file already applies every break to each good value.
Each group has a plant, a wrong rule that a generator without that group would let pass; the plant
must turn the law red. These generators only reach what the rules accept today. `Place`'s rules and
`Said`'s rule do not change in this amendment.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D1, the code's form: for generated codes, `Code` accepts a root of lowercase words joined by single hyphens, starting with a letter, then one slash, then a name of the same words; it refuses each break of one: no slash, a second slash, an empty side, an uppercase letter, a space, a leading or trailing hyphen, a double hyphen, a root starting with a digit. 200 runs | test | Effect Arbitrary: codeParts | let the pattern allow `/` inside the name: the second-slash case passes, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D2, the place: for generated places, `Place` accepts `.` and any relative path of good segments, with no line, a line, or a line and a column, each at least 1; it refuses an empty path, a leading `/`, a `./` start, a `..` or `.` segment, an empty segment, a trailing `/`, a backslash, a line or column of 0, a negative or a fraction, a column with no line, and a line on `.`. 200 runs. The good path's generator must reach, in every run, each of these groups, all of which `Place` accepts today: (a) a segment that starts with a dot but is not `.` or `..`, such as `.config` (the README's own example path), `..x` and `...`; (b) a segment that holds a space, at its start, inside and at its end; (c) a segment that holds a character outside `[a-zA-Z0-9_~@+().-]`: ASCII punctuation such as `# % , = [ ] { } ! $ & ' ; :`, a letter past ASCII such as `é`, a character past U+024F such as `设`, and a character outside the Basic Multilingual Plane (a surrogate pair, such as an emoji). A segment may be any characters but `/` and `\`, other than empty, `.` and `..`. Every break in the list is still applied to each good path built this way, and still refused | test | Effect Arbitrary: placeParts | drop the column-needs-line check: red. Per group, each a wrong segment rule in `Diagnostic.ts`: (a) refuse a segment that starts with `.`: red; (b) refuse a segment that holds a space: red; (c) accept only `[a-zA-Z0-9_~@+().-]` in a segment: red, and accept only printable ASCII: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D3, a reported diagnostic: `Reported` refuses a message or a hint that is empty or only whitespace, a severity other than `error` or `warning`, and an input missing any one of its five fields; it accepts every other generated value, and encoding then decoding gives the same value. 200 runs. The message and hint generator must reach, in every run, each of these groups, all of which `Said` accepts today: (a) leading whitespace before the first visible character: a space, a tab, a line break and U+00A0; (b) a tab inside, and a line break inside, both `\n` and `\r\n`; (c) a character past U+024F, both one in the Basic Multilingual Plane such as `设` and one outside it such as an emoji; (d) more than 16 characters, up to at least 200. The blank generator must reach, beside the empty text, each character `String.prototype.trim` removes: space, tab, `\n`, `\r`, `\v`, `\f`, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. The good place comes from D2's generator | test | Effect Arbitrary: goodReported | check the hint with `isNonEmpty` only: a hint of spaces passes, red. Per group, each a wrong rule in `Said` (`Diagnostic.ts`): (a) refuse text whose first character is whitespace: red; (b) refuse a tab, `\n` or `\r` anywhere: red; (c) refuse any character past U+024F: red; (d) refuse more than 16 characters: red; blanks: count only space, tab and `\n` as blank, so a hint of U+00A0 passes: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D4, make declares: for a generated good code and a non-blank Markdown text, `make` answers a `Declared` whose `code` equals the input and whose `explain` is the text byte for byte, whitespace kept; for a malformed code or a blank text it throws, and the error names the code or the text. 100 runs | test | Effect Arbitrary: markdown | trim `explain` before keeping it: red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D5, report collects in order: for a generated list of declared codes and good fields, reporting each in turn under `TestDiagnostics.layer` makes `TestDiagnostics.reported` answer the same list of `Reported` values in the same order, repeats kept, each `code` equal to its declared code's. 100 runs. Its fields come from the shared good-fields generator, which must reach D2's path groups (a) to (c) and D3's text groups (a) to (d) in every run: each run also reports one item whose place and message and hint are made into each group | test | Effect Arbitrary: items | keep only the last report: red; dedupe repeats: red. Each of D2's and D3's per-group plants also turns this law red: the group's report dies instead of being collected | kalfa/diagnostics/src/Diagnostics.test.ts |
| D6, bad fields die and report nothing: for a generated good list with one bad field set put in at a generated spot (a blank message, a blank hint, a bad place), the run's exit is a defect holding a SchemaError, not a typed failure, and `TestDiagnostics.reported` holds exactly the good reports before the spot. 100 runs. The good list reaches what D5's does; the blanks reach D3's whole whitespace list; the bad place comes from D2's breaks applied to D2's widened good paths | test | Effect Arbitrary: withABadOne | append before the decode: the bad one is collected, red; fail with the error instead of dying: the exit is a typed failure, red; D3's blank plant (only space, tab and `\n` count as blank): a hint of U+00A0 is collected, red; D2's and D3's group plants: a good report before the spot dies first, so the list before the spot is short, red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D7, each build starts empty: two runs, each with its own `TestDiagnostics.layer`, each see only their own reports | test | scenario: two provides of the layer, one report each | keep the Ref at module level: the second run sees two, red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D8, report's type: `Diagnostics.report(declared, fields)` is `Effect<void, never, Diagnostics.Diagnostics>`; a string code, an object literal `{ code, explain }`, a missing field, and a severity `"info"` each do not compile | type | type | widen the first parameter to `Declared \| string`: the string line compiles and its `@ts-expect-error` is unused, red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D9, the test Layer's types: `TestDiagnostics.layer` is `Layer<Diagnostics.Diagnostics \| TestDiagnostics.TestDiagnostics>`, and `TestDiagnostics.reported` is `Effect<ReadonlyArray<Diagnostic.Reported>, never, TestDiagnostics.TestDiagnostics>`, so a read without the test Layer does not compile | type | type | read through a cast with `never` as its requirement, as `TestConsole` does: red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D10, no wording helper: the runtime exports of `TestDiagnostics` are exactly `TestDiagnostics`, `layer` and `reported` | test | scenario: the module's own exports at head | export an `expectMessage` helper: red | kalfa/diagnostics/src/Package.test.ts |
| D11, the manifest: `kalfa/diagnostics/package.json` names no `@kalfa/` or `@kampus/` package in any dependency field, has no `dependencies`, has only `effect` as a peer, exports exactly `./Diagnostic`, `./Diagnostics`, `./TestDiagnostics` and `./package.json`, and gives each module a `dist` pair under `publishConfig.exports` | test | scenario: the package's own manifest at head | add `@kampus/vitest` to its dev dependencies: red | kalfa/diagnostics/src/Package.test.ts |
| D12, nothing specific to this repo (decision 0047): no file git tracks under `kalfa/diagnostics/` holds the words `fabrika`, `kampus`, `kamp-us` or `.kalfa/`, in any letter case | test | scenario: the package's tracked files at head | write `tea-fabrika` into the README: red | kalfa/diagnostics/src/Package.test.ts |
| D13, imports no kalfa or repo package: an import of `@kalfa/*`, `@kampus/*`, `@tea-fabrika/*` or a path out of the package, in any file under `kalfa/diagnostics/src/` but its tests, is refused | lint | lint | import `@kalfa/config/App` in `Diagnostic.ts`: lint red | .oxlintrc.json |
| D14, never prints and never picks an exit code: in a file under `kalfa/diagnostics/src/` but its tests, every import and global that "What lint holds" lists is refused: a Node module in either spelling, `Console`, `Stdio`, `Terminal` and `Runtime` from `effect` or as `effect/` subpaths, `@effect/platform-node` and its subpaths, and the globals `console`, `process`, `globalThis`, `global`, `self` and `window` | lint | lint | each line below, one at a time, in `Diagnostics.ts`, must turn `pnpm lint` red, and is then undone: `console.log("x")`; `import { Console } from "effect"`; `import * as Console from "effect/Console"`; `process.exitCode = 1`; `import { NodeRuntime } from "@effect/platform-node"`; and the four lint passed at the reviewed head: `import proc from "node:process"`, `import { log } from "node:console"`, `globalThis.process.exitCode = 1`, `globalThis.console.log("x")`; then `import proc from "process"`, `import { Stdio } from "effect"`, `import * as Runtime from "effect/Runtime"` | .oxlintrc.json |
| D15, the rank: the package imports no other workspace package (`pnpm lint:boundaries` and `pnpm lint:layers`), and its layer row ranks below `kalfa-config` | lint | lint | (a) import `@kalfa/config/App` in `Diagnostic.ts`: both checks red; (b) grant `"imports": ["kalfa-config"]` on the `kalfa-diagnostics` row: `lint:layers` refuses the rules file, red | layer-rules.json, boundary-rules.json |
| D16, only `report` hands the service anything: given the service's shape (`Context.Service.Shape<typeof Diagnostics.Diagnostics>`) and a value typed `Diagnostic.Reported`, as decoding with the public Schemas gives, calling the shape's own `report` with that value does not compile; nor does calling it with that value spread with a blank message and hint and a bad place; and a provider function typed `(diagnostic: Diagnostic.Reported) => Effect.Effect<void>` still fits the shape's `report`, so a provider reads every field without naming the brand | type | type | widen the service method's parameter back to `Diagnostic.Reported`: both `@ts-expect-error` lines are unused, red; keep the parameter but drop the brand (`type Checked = Diagnostic.Reported`): the same two lines are unused, red; give the brand an optional key (`readonly [checked]?: true`): a plain `Reported` fits again, red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D17, the span: for a generated declared code and good fields, `Diagnostics.report` run under a recording tracer (`Tracer.make` with `Effect.withTracer`, as `next/apps/fabrika/src/door-spans.test.ts:319` does) ends exactly one span named `diagnostics.report`; its attributes hold `kalfa.diagnostics.code` and `kalfa.diagnostics.severity` equal to the report's, and no attribute key is a bare `code` or `severity`, and no attribute value is the message or the hint. 100 runs | test | Effect Arbitrary: goodFields | name the span `Diagnostics.report`: red; annotate bare `code`: red; add the message as an attribute: red | kalfa/diagnostics/src/Diagnostics.test.ts |

D16 is the type law for decision 0084's "a code nobody declared cannot be reported". It runs under
`pnpm typecheck`, as D8 and D9 do; the review at the reviewed head compiled the direct call against the
package's tsconfig, and D16 is that call turned into a line that must not compile. D17 is a law, not a
review item, because a span name is a string a later edit can change with no type to notice it.

No law needs launchd, the real Electron app, a real OS process or socket, or a real signal, so none is
host-only and none waits on the owner's Mac. No law is a `*.integration.test.ts` file: D10 to D12 read
the package's own files and module, which `fabrika/runs-from-depth` does not count as real IO, and
every other law runs in memory. No secret flows through the package, so no law is a `[secrets]` law;
the glossary's rule that a message never quotes private text is the writer's, and the README says it.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/diagnostics/package.json | tests | tests | new: name, `private`, `build` and `typecheck` scripts, exports, `publishConfig.exports`, `files`, `effect` as peer, dev dependencies. The tests step owns it with the lockfile, so its laws can install and run red. Fix round: `fast-check` leaves the dev dependencies, since no file imports it |
| kalfa/diagnostics/tsconfig.json | tests | tests | new: as `kalfa/config`'s, with the Effect checks |
| kalfa/diagnostics/tsconfig.build.json | tests | tests | new: as `kalfa/config`'s |
| kalfa/diagnostics/rslib.config.ts | build | 12 | new: as `kalfa/config`'s |
| kalfa/diagnostics/src/Diagnostic.ts | build | 110 | new: `Code`, `Severity`, `Place`, `Reported`, `Declared`, `make`, with doc blocks |
| kalfa/diagnostics/src/Diagnostics.ts | build | 55 | new: the service and `report`. Fix round: the type-only brand `Checked` (unexported), the service method takes it, `report` puts it on with one commented cast; the span is `diagnostics.report` with `kalfa.diagnostics.code` and `kalfa.diagnostics.severity`; the doc blocks say the service takes only what `report` hands it |
| kalfa/diagnostics/src/TestDiagnostics.ts | build | 55 | new: the test service, `layer`, `reported`, and the opening comment on why it holds a Layer |
| kalfa/diagnostics/README.md | build | docs | new: what a diagnostic is; declare, report, test; how to write a message (a fact, no private text) and a hint (what to do next, or that a person must decide); what the package never does (print, log, pick an exit code). Fix round: one sentence under "Report through it": the service's own method takes only what `report` hands it, so a provider reads every field but no caller can skip `report` |
| kalfa/diagnostics/GLOSSARY.md | build | docs | add the term "Long text" (below) |
| kalfa/AGENTS.md | build | docs | the "No import cycles" bullet gains: Diagnostics ranks below Configuration, and Configuration below CLI |
| kalfa/diagnostics/src/Diagnostic.test-support.ts | tests | tests | the shared generators. Fix round: path segments, message and hint text, and blanks widened to D2's and D3's groups; the seed's comment says only that a fixed seed makes a red run repeat, and names no file outside the package |
| kalfa/diagnostics/src/Diagnostic.test.ts | tests | tests | D1 to D4. Fix round: D2 and D3 check each group in every run; the opening comment stops naming the plan and the ticket |
| kalfa/diagnostics/src/Diagnostics.test.ts | tests | tests | D5 to D7, and D17 in the fix round. Fix round: D5 and D6 reach the groups; the opening comment stops naming the plan and the ticket |
| kalfa/diagnostics/src/Diagnostics.types.test.ts | tests | tests | D8, D9, and D16 in the fix round. Fix round: the opening comment stops naming the plan and the ticket |
| kalfa/diagnostics/src/Package.test.ts | tests | tests | D10 to D12. Fix round: the opening comment stops naming the plan and the ticket, and the comment above the forbidden words stops naming a decision |
| .oxlintrc.json | tests | tests | D13, D14: one override for `kalfa/diagnostics/src/**`, and that folder added to the files of `kalfa/config`'s Effect block. Fix round: the override gains the Node modules in both spellings, `Stdio`, `Terminal` and `Runtime` from `effect` and as subpaths, and the globals `globalThis`, `global`, `self` and `window` |
| layer-rules.json | tests | tests | D15: the `kalfa-diagnostics` row after `next-vitest`, and `kalfa/diagnostics/src` in `roots` |
| boundary-rules.json | tests | tests | D15: the `kalfa-diagnostics` library type and its `libraries` entry |
| package.json | tests | tests | `@kalfa/diagnostics` as a root dev dependency, so `pnpm lint:reach` finds the package reached, as `@kalfa/ci` was added before it had another user |
| pnpm-lock.yaml | tests | tests | the new `kalfa/diagnostics` importer and the root's new link. Fix round: `fast-check` leaves that importer |
| vitest.config.ts | tests | tests | no change: its `kalfa/*/src/**/*.test.{ts,tsx}` glob already finds the laws |
| oxlint-plugins/workspace-reach.ts | tests | tests | no change: read to learn that every kalfa package must be reached, which the root dev dependency answers |
| oxlint-plugins/match.ts | tests | tests | no change: read for `heldToNext`, which keeps `fabrika/no-node-imports` to `next/` and `.agents/` (Findings, 3) |
| oxlint-plugins/no-node-imports.ts | tests | tests | no change: read to learn it checks nothing in `kalfa/` |
| next/apps/fabrika/src/door-spans.test.ts | tests | tests | no change: read as the model for D17's recording tracer |
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
- `Checked`, the type-only brand inside `kalfa/diagnostics/src/Diagnostics.ts`: searched Effect 4.1.3's
  `Brand` and `Schema.brand` (a string key anyone can write, so it forges), and the repo for
  `declare const .*: unique symbol` (found `next/packages/vitest/src/Recorder.ts:125` and
  `packages/pipeline/src/stages/ship/ready.ts:110`). Used as those two do; no helper is needed.
- The recording tracer in D17: searched Effect 4.1.3's `Tracer` (`Tracer.make`, `Effect.withTracer`) and
  the repo; `next/apps/fabrika/src/door-spans.test.ts:319` records spans that way. Written in the test
  file, since `@kampus/vitest` is not a dependency the package may take.
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
- **The service takes a type-only brand that only `report` puts on, 85%.** Why, and what it keeps, is under
  "Diagnostics.ts" above. The doubt is the one cast it costs, and whether a reviewer would rather have a
  real key and strip it in the test Layer; that would cost a copy per report and change no law but D16's
  plants.
- **The span is `diagnostics.report`, with `kalfa.diagnostics.code` and `kalfa.diagnostics.severity`,
  80%.** Decision 0063's form; the doubt is under "Diagnostics.ts" above. A rename later is one string
  and one law.
- **Lint refuses every Node module and the global object in the package's source, 85%.** The package
  needs neither, and the one rule that would refuse Node modules checks only `next/` and `.agents/`.
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
  listing the `dist` files it writes, then deleting them. In the fix round, that build also shows that
  `dist/Diagnostics.d.ts` holds the `declare const checked: unique symbol` and the `Checked` type
  unexported, so the brand survives into the built types.
- fix round: `pnpm install --offline` once, for the lockfile without `fast-check`; the vitest path above
  shows D2, D3, D5 and D6 green with each group's plant red, and D17 red then green; each D14 line in turn
  with `pnpm lint`, each red and undone.
- The lead runs `pnpm typecheck`, which holds D8 and D9 and the doc blocks' types, and the narrow
  paths. The lockfile change makes `--changed` the whole suite, so the full run is CI's.

## Size

1. One slice, the package: about 232 product lines (`Diagnostic.ts` 110, `TestDiagnostics.ts` 55,
   `Diagnostics.ts` 55, `rslib.config.ts` 12), plus D1 to D17, the README, the glossary term, the
   `kalfa/AGENTS.md` sentence and the rule rows. It lands whole: another package can declare a code,
   report through it and test what it reported.

About 3 agent hours across the steps, 75% sure, plus about 1 agent hour for the fix round. The doubt was
the lint and code-graph wiring, and the one review sent the plan back, as the estimate allowed. Budget:
the kalfa-config plan measured about $5 a step at list price for a package of this size. Tests, build
and review are spent; this amendment, one fix step that writes the laws and the fix, and a second review
remain.

Estimate: 6 steps, $30

## New names

- `Diagnostic.Reported`: the owner's name on 1751, a reported diagnostic.
- `Diagnostic.Declared`: a declared code, the value `make` answers (the ticket's "a declared code").
- `explain`: the owner's key for a code's long text.
- `TestDiagnostics`, `TestDiagnostics.layer`, `TestDiagnostics.reported`: Effect's `TestConsole` naming.
- `Checked` (fix round): a code name inside `Diagnostics.ts`, not exported, for a reported diagnostic that
  came through `report`. It is no new domain word: the thing is the glossary's diagnostic, and the name
  only marks which way it came in, so the glossary gains nothing. It matches the doc block's "checked as
  a whole before the service sees it".
- `diagnostics.report`, `kalfa.diagnostics.code`, `kalfa.diagnostics.severity` (fix round): the span name
  and attribute keys, in decision 0063's form.

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
- A cast can still forge a `Checked` in a calling package. D16 shows only that no call compiles without
  one.
- How ticket https://github.com/kamp-us/tea-fabrika/issues/1918 gets an error's diagnostic to the
  service. The owner's sketch on 1751 types the carried value as a plain `Diagnostic.Reported`, which the
  service no longer takes. So 1918 either has the error carry its `Declared` and fields, and `kalfa` calls
  `report` with them, or adds a second maker of `Checked` beside `report` that also takes a `Declared`.
  Either keeps decision 0084's rule; which one is 1918's plan.
- What the place of a diagnostic outside the repo should be, such as a user's own settings file. That is
  open with the owner, so this amendment leaves `Place`'s rules as they are; D2's wider generator only
  reaches paths `Place` already accepts.
- Whether lint's lists are whole. They name the Node modules and Effect modules known today to print or
  pick an exit code; a new one is refused only when it is added.

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
3. **Two rules in `kalfa/config`'s Effect block hold nothing in `kalfa/`.** The block in `.oxlintrc.json`
   (its `files` start `"kalfa/config/src/**"`) turns on `fabrika/no-node-imports` and
   `fabrika/no-ledger-sql`, and both return no checks unless the file is under `next/` or `.agents/`
   (`heldToNext`, `oxlint-plugins/match.ts:112`; `oxlint-plugins/no-node-imports.ts:47`). So
   `kalfa/config/src` can import any Node module today with no lint finding. This plan works around it
   for `kalfa/diagnostics/src` with its own import list; a fix for every kalfa package (a scope in the
   rule, or a `kalfa/**` import list) is its own ticket. I checked only these two rules for that scope.
4. **`kalfa/quality`'s spans are not in decision 0063's form.** `kalfa/quality/src/stryker/Run.ts:74`
   and `:111` name their spans `Run.plant` and `Run.survey`, not `quality.<call>`. Decision 0063 says
   protocols settled before it get their spans added, not redone, so whether these change is the lead's
   call.

## Amendment 1

The one review sent the plan back (`send plan`). Each change below is made in place above.

| Change | Fault that caused it |
|---|---|
| The service's method takes `Checked`, a type-only brand only `report` puts on; the "Diagnostics.ts" sketch, its "why" notes, the trace's step 4, a call taken (85%), the README sentence, and new type law D16 | B1: the method took any `Diagnostic.Reported`, so a caller could decode one with the public Schemas and skip `report`, with a code nobody declared, blank text and a bad place, against decision 0084 |
| D2, D3, D5 and D6 say what their generators must reach and give one plant per group; D4 reuses the wider text. `Place`'s and `Said`'s rules do not change | B2: segments never started with a dot or held a space or a character outside `[a-zA-Z0-9_~@+().-]`; message and hint never had leading whitespace, a tab, a line break, a character past U+024F, or more than 16 characters. The blank side gained every character `trim` removes, while there |
| "What lint holds" and D14 list every import and global the override refuses, with the four lines lint passed at the reviewed head as plants; a Finding on the two next-only rules | B3: the plan counted on `fabrika/no-node-imports`, which does nothing outside `next/` and `.agents/` |
| "What lint holds" states that an `importNames` entry also refuses a namespace import of `effect` | B3: the review read the plan as saying a namespace import escapes. I found no such line at head, so the plan now says the opposite outright |
| The span is `diagnostics.report` with `kalfa.diagnostics.code` and `kalfa.diagnostics.severity`; new law D17; a call taken (80%); a Finding on `kalfa/quality`'s spans | The lead's note: the build named the span `Diagnostics.report` with bare `code` and `severity`, against decision 0063 |
| `fast-check` leaves the package's dev dependencies and the lockfile; the laws' generator cells name Effect's `Arbitrary` | Nothing imports `fast-check` |
| Test file comments stop naming the plan, the ticket and a decision, and the seed's comment names no home outside the package | Comments in a package that names nothing of its repo pointed at this repo's records, and the seed's named home was wrong |
| The budget grows to 6 steps and $30 | The fix round and a second review |

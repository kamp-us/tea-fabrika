Approved by the lead agent, builds 0084, 0088, 0063; body 348121d51447
Plancheck-Version: 3

# Plan: an error carries its diagnostic (ticket 1918)

This is the kalfa package suite (`kalfa/diagnostics/`), new work. It is not today's frozen version and not
`next/`. The ticket is https://github.com/kamp-us/tea-fabrika/issues/1918, a GitHub issue, so the pull request
says `Closes #1918`. It builds decision 0084, on the package that tickets 1917 and 1929 built (both on main).

**One call under 80%, taken as a lean:** the reader is named `Diagnostic.fromError` (75%). It follows Effect's
`fromX` names that answer an `Option` (`BigDecimal.fromString`). The doubt: Effect's own closest precedent, the
CLI's `CliError.getUserMessage`, uses a `get` name, and the owner may want the verb `carried`. A rename is one
search and replace before any caller exists. A word from the lead or the owner settles it.

```ts
// The whole idea, a sketch. An error says which diagnostic it is, unchecked, under the key `diagnostic`.
class UnknownSettingError extends Schema.TaggedError<UnknownSettingError>()("UnknownSettingError", {
  setting: Schema.String,
  line: Schema.Int,
}) {
  get diagnostic(): Diagnostic.Carried {
    return Diagnostic.carry(UnknownSetting, {          // a declared code; no severity: always an error
      message: `The setting \`${this.setting}\` is not declared.`,
      place: Diagnostic.Place.cases.repo.make({ path: ".config/settings.toml", line: this.line }),
      hint: "Check the spelling against the settings reference.",
    });
  }
}

// Where the error is handled (CLI, later): read it from any value, and report through `report`, the one way in.
Option.match(Diagnostic.fromError(error), {                // Option<Diagnostic.Carried>
  onNone: () => Effect.void,
  onSome: (carried) => Diagnostics.report(carried.declared, carried.fields), // Effect<void, never, Diagnostics>
});
```

## What changes, in one paragraph

`Diagnostic.ts` gains three names. `Diagnostic.Carried` is a carried diagnostic: a declared code and the fields
beside it, with `severity` fixed to `"error"`. `Diagnostic.carry(declared, { message, place, hint })` makes one
and checks nothing, as the owner decided on 2026-11-22. `Diagnostic.fromError(error: unknown)` answers
`Option.some` of the `Carried` a value holds under `diagnostic`, or `Option.none()`. `report`, the service, the
test Layer, the manifest and the lint rows do not change: the handler reports a carried diagnostic through
`Diagnostics.report`, which still checks every field and is still the only thing that hands the service a value.
The README gains a section that shows the shape on one error, and one line that names
`Diagnostic.Place.cases.<kind>.make` for a package whose lint refuses a hand-written `_tag` (the lead's note from
the review of https://github.com/kamp-us/tea-fabrika/pull/1979). The glossary gains "Carried diagnostic". CLI
reporting it with exit code 1, and Configuration's errors carrying their diagnostics, are their own tickets.

## The ticket's open points, answered

1. **Warning or error?** Always an error: the owner's answer of 2026-11-22, now an acceptance criterion. `carry`
   takes no severity, and `Carried["fields"]["severity"]` is the type `"error"`.
2. **The shape's name:** `Diagnostic.Carried`, made by `Diagnostic.carry`. The glossary's Diagnostic entry
   already says "A typed error may carry its own diagnostic", so "carry" is the word in use (85%).
3. **One session with 1917?** Moot: 1917 landed on main, and so did 1929. This is its own pull request.

## Searched first

- Ticket 1918 whole with its four comments: the open points, the owner's answer on severity, the owner's answer of
  2026-11-22 on how an error carries its diagnostic, and the lead's note on the README's places. The parent
  https://github.com/kamp-us/tea-fabrika/issues/1890 and the owner's answers at
  https://github.com/kamp-us/tea-fabrika/issues/1751#issuecomment-7083852422, whose sketch puts a
  `get diagnostic()` on Configuration's `SettingsError`.
- Decision 0084 whole. Decisions 0088 and 0063 as the place plan read them.
- Both approved plans whole, with their amendments: `.kalfa/quests/kalfa-diagnostics-declare-PLAN.md` (its
  review sent back a service any caller could reach, and generators that missed classes of segment and text) and
  `.kalfa/quests/kalfa-diagnostics-place-PLAN.md` (its tests step and review sent back three ways a login rode
  into a repo place, and a looser flag rule).
- Every file of the landed package: `Diagnostic.ts`, `Diagnostics.ts`, `TestDiagnostics.ts`,
  `Diagnostic.test-support.ts`, the four test files, `README.md`, `GLOSSARY.md`, `package.json`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks`, `experiments` and the
  kalfa glossaries for "carries its own diagnostic", "carried diagnostic", "error ... diagnostic" and
  "userMessage". Only 0084 and the CLI and Diagnostics glossaries hit; none settles a shape this plan picks.
- Effect 4.1.3 with its patch, the lockfile's version: `node_modules/effect/AGENTS.md` whole;
  `src/cli/CliError.ts` (`userMessage`, `getUserMessage`, `isCliError`); `Predicate.hasProperty` (uses `in`, so it
  sees a getter on the class); `Option.some`, `Option.none`, `Option.match`; `Schema.TaggedError`; the `make` of a
  struct (throws on a bad input; `MakeOptions.disableChecks` skips checks); `toTaggedUnion`'s `cases`.
- The lint the README line is about: `anti-slop-effect/no-manual-tagged-construction` in
  `.oxlintrc.json` (on for `kalfa/**`), and its source under the vendored anti-slop plugin: it reports any object
  literal with a `_tag` key. `README.types.test.ts` turns it off for its own examples, with a reason.
- How kalfa packages write typed errors today: `Schema.TaggedError` in `kalfa/config/src/Files.ts`
  (`SettingsError`), `kalfa/config/src/Toml.ts`, `kalfa/markdown/src/Frontmatter.ts`.

## How others do it

- **Effect 4.1.3's CLI** (read in the installed source, `src/cli/CliError.ts`): an error says what to show by a
  property key, `CliError.userMessage`, written as a getter on a `Schema.TaggedError`; `getUserMessage(error)`
  reads it and gives `undefined` when it is unset or not a string; `Command.run` renders it and keeps the error's
  tag. This is the same idea: a getter on the error, a reader that takes the error, and the runner that reports.
  This plan follows it, with an `Option` and a whole diagnostic in place of a string.
- **Rust's miette:** an error type implements the `Diagnostic` trait (`#[derive(Diagnostic)]`,
  `#[diagnostic(code(...), help(...))]`), its severity is error unless it says otherwise, and the reporter prints
  any error that implements it. **rustc** does the same with `#[derive(Diagnostic)]` on error structs. From memory,
  not fetched.
- **Erlang/OTP:** an error is `{error, {Module, Reason}}`, and whoever prints it calls `Module:format_error(Reason)`:
  the error names what describes it, and the caller does the describing. **Elm**'s compiler builds each report as
  data in the module that found the problem, and renders it apart. From memory, not fetched.
- **`Symbol.for`** (the global symbol registry) keeps a key the same across two copies of one package, as
  `Declared` already does. From memory.

## The shape

```ts
// kalfa/diagnostics/src/Diagnostic.ts, the additions. A sketch: doc blocks left out.
import { Option, Predicate, Schema } from "effect";

// ... Code, Severity, Place, formatPlace, Reported, Declared and make, unchanged.

// Only `carry` builds a Carried: the key is a symbol this module does not export. `Symbol.for`, as for Declared,
// so a second copy of the package reads the same key.
const CarriedId: unique symbol = Symbol.for("@kalfa/diagnostics/Carried");

/** What a typed error holds beside the code: a message, a place and a hint, as a caller writes them. */
type CarriedText = Omit<typeof Reported.Encoded, "code" | "severity">;

export interface Carried {
  readonly [CarriedId]: typeof CarriedId;
  /** The declared code. */
  readonly declared: Declared;
  /** The fields beside the code, as given, unchecked. Always an error. They fit `Diagnostics.Fields`. */
  readonly fields: CarriedText & { readonly severity: "error" };
}

// Checks nothing: a blank message or a bad place is caught when the handler reports it (owner, 2026-11-22).
// Each field is copied by name, so a severity smuggled in a wider object never rides along.
export const carry = (declared: Declared, fields: CarriedText): Carried => ({
  [CarriedId]: CarriedId,
  declared,
  fields: { severity: "error", message: fields.message, place: fields.place, hint: fields.hint },
});

const isCarried = (value: unknown): value is Carried => Predicate.hasProperty(value, CarriedId);

// Any value. `hasProperty` uses `in`, so a getter on the error's class counts as well as an own key. Only a value
// `carry` made counts. A getter that throws is not caught. No `cause` is followed.
export const fromError = (error: unknown): Option.Option<Carried> => {
  const diagnostic = Predicate.hasProperty(error, "diagnostic") ? error.diagnostic : undefined;

  return isCarried(diagnostic) ? Option.some(diagnostic) : Option.none();
};
```

`isCarried` stays unexported: `fromError` is the one call the ticket asks for. Nothing in `Diagnostics.ts` or
`TestDiagnostics.ts` changes but one line in `report`'s doc block: it also names the handler of an error that
carries a diagnostic. `report`'s type takes `carried.fields` as it is, since `"error"` fits `Severity`.

### Why each rule (calls)

- **The key is `diagnostic`, as the owner's sketch on 1751 writes it, 85%.** Effect's CLI uses a namespaced key
  (`~effect/cli/CliError/userMessage`) because it adds that key to every `Error` through a global declaration; this
  package adds nothing to `Error`. Since only a value `carry` made counts, an error with a field of its own named
  `diagnostic` reads as carrying none, never as carrying junk.
- **A `Carried` carries a symbol only `carry` puts on, 85%.** As `Declared` does. So the owner's first sketch, a
  plain `Diagnostic.Reported` under `diagnostic`, or a look-alike `{ declared, fields }`, reads as carrying none.
  Effect's `isCliError` checks its key the same way, with `Predicate.hasProperty`. Effect's AGENTS.md says to
  parse untrusted data with Schema, but there is nothing to parse here: the owner ruled that the fields stay
  unchecked until reported, and what is checked is only where the value came from.
- **The fields hold `severity: "error"`, so the handler passes them straight to `report`, 85%.** Then no caller
  writes a severity at all, and the type says it. The other way, a `Carried` with no severity and a CLI that adds
  `"error"`, puts the rule in a package that is not built yet.
- **`fromError` answers an `Option`, 85%.** The ticket says "with nothing when it carries none", and Effect's own
  readers of a value that may be absent answer an `Option`.
- **Any value may carry one, not only an `Error`, 80%.** A subcommand may fail with any value (`Effect.fail({...})`),
  and the command reads whatever failed.
- **A getter that throws is not caught, 80%.** A throw there is a bug in the error's own code. The command calls
  `fromError` inside an Effect, where a throw is a defect, just as `report` dies on a bad field. Catching it and
  answering `none` would hide the bug and drop the diagnostic without a word.
- **No `cause` is followed, 80%.** Decision 0084 says "an error that carries a diagnostic". An error that wraps
  another says itself which diagnostic it is: its getter may return its cause's. One rule, and no guess about which
  cause in a chain wins.
- **`carry` and `fromError` have no span, 85%.** Both are pure, as `formatPlace` is; decision 0063 traces steps
  that do work. The report's span stays the one span.
- **Is any of this a setting? No.** The key, the severity and the reading rule are the protocol between every
  package that fails and the one command that reports. A setting would split them. The owner fixed the severity.

## One value traced: an unknown setting, carried, read, reported

1. Configuration's code (later) fails with `new UnknownSettingError({ setting: "service.prot", line: 4 })`. Nothing
   is checked yet. The error has no own `diagnostic` key; its class has the getter.
2. The command's failure handler gets the error and calls `Diagnostic.fromError(error)`. `Predicate.hasProperty`
   finds `diagnostic` through `in`, on the class. Reading it runs the getter: `Place.cases.repo.make` builds
   `{ _tag: "repo", path: ".config/settings.toml", line: 4 }` (it checks the place, and would throw on a bad one), and
   `carry` copies the message, place and hint and adds `severity: "error"`.
3. The value has `CarriedId`, so `fromError` answers `Option.some(carried)`.
4. The handler runs `Diagnostics.report(carried.declared, carried.fields)`. `report` decodes the five fields with
   `Reported`: they pass. Its span gets `kalfa.diagnostics.code` = `config/unknown-setting`,
   `kalfa.diagnostics.severity` = `error`, `kalfa.diagnostics.place.type` = `repo`, and no path or message.
5. Under `TestDiagnostics.layer`, `TestDiagnostics.reported` answers one value: `{ code: "config/unknown-setting",
   severity: "error", message: "The setting `service.prot` is not declared.", place: { ... }, hint: "..." }`.
6. The same error with an empty message: steps 2 and 3 are the same, since `carry` checks nothing. In step 4
   `report` dies with a SchemaError that names the `message` field, and nothing is collected.
7. `Diagnostic.fromError(new Error("boom"))`, `fromError("boom")` and `fromError({ diagnostic: { code, severity,
   message, place, hint } })` each answer `Option.none()`, and none throws.

## What fact is lost if not recorded now

None. A carried diagnostic is built from the error's own fields when it is read, and the error lives only until
it is handled. The package stores nothing, and the report's span already records the code, the severity and the
kind of place.

## Generators

The new laws draw from the shared generators in `kalfa/diagnostics/src/Diagnostic.test-support.ts`, as the
package's other laws do. Each run takes its drawn value and also checks one made from it for each class below, so
every class is in every run. Each class has a plant in the laws table that a generator missing it would let pass.

Values `fromError` must find a carried diagnostic in:

- (a) a `Schema.TaggedError` whose class gives `diagnostic` by a getter, so the key is on the class, not the value.
- (b) a plain object that is no `Error`, with an own `diagnostic` key holding a `Carried`.
- (c) a native `Error` given an own `diagnostic` field after it is made, with no `_tag`.

Values that carry none:

- (d) a value that is no object: `undefined`, `null`, a drawn string, a drawn number, a `bigint`, `true`, `false`
  and a symbol.
- (e) an object with no `diagnostic` key: a `Schema.TaggedError` with no getter, a native `Error`, `{}` and a
  function.
- (f) a `diagnostic` that `carry` did not make: a plain reported diagnostic with all five fields (the owner's first
  sketch), a look-alike `{ declared, fields }` with no symbol, a `Declared`, a drawn string, `null` and `undefined`.
- (g) a `diagnostic` getter that throws a drawn error.

Fields `carry` must keep as given:

- (h) every kind of odd good field, from the support's `fieldVariants`: the message and hint in each kind of text,
  and the place in each class of each of the four kinds, a home file's line and column included.
- (i) every bad field set: each blank from `blanksFrom` as the message and as the hint, and each bad place from
  `brokenPlaces` (every break of every kind, and each login in each root).
- (j) a severity smuggled in a wider object: `"warning"` and each value of `otherSeverity`, put into the fields
  through a variable typed wider than `carry`'s parameter, as a caller's spread would.
- (k) a login name in every root a machine uses (the support's `rootedAtLogin`), as a carried repo place and as a
  carried home place.

## Laws

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3, with inputs from Effect's own `Arbitrary`,
built in `kalfa/diagnostics/src/Diagnostic.test-support.ts`. Every law runs in memory on every pull request: none
spawns a process, none writes a file or a temp folder, and none needs a real resource. D24, widened, reads the
package's own README and types file, as it does today, and writes nothing.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D26, `fromError` finds what is carried: for a generated declared code and good fields, a value of each class (a), (b) and (c) that carries `carry(declared, fields)` gives `Option.some` of a `Carried` whose `declared` is the same `Declared` (`toBe`), whose `fields` equal the given message, place and hint with `severity: "error"`, and, for (b) and (c), which is the very value the key holds. 200 runs | test | Effect Arbitrary: goodFieldsAndParts | (a) read only an own key (`Object.hasOwn(error, "diagnostic")`): the getter is not seen, red; (b) answer `none` unless `Predicate.isError(error)`: the plain object is missed, red; (c) answer `none` unless the value has a `_tag`: the native error is missed, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D27, `fromError` finds nothing, and never throws: for generated values of each class (d), (e) and (f), `fromError` answers `Option.none()` and does not throw. 200 runs | test | Effect Arbitrary: goodText | (d) test `"diagnostic" in error` with no object check: a string or `null` throws, red; (e) answer `Option.some(error.diagnostic)` for every object: `{}` gives `some(undefined)`, red; (f) check for `declared` and `fields` keys in place of the symbol: the look-alike is found, red; and check only that `diagnostic` is not null: the plain reported diagnostic is found, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D28, a getter that throws is not caught: for a generated message, a `Schema.TaggedError` whose `diagnostic` getter throws `new Error(message)` makes `fromError` throw that same error (`toBe`). 100 runs | test | Effect Arbitrary: goodText | (g) wrap the read in `try` and answer `none` on a throw: no throw, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D29, `carry` keeps what it is given, unchecked: for a generated declared code and drawn fields, made into each field set of (h) and (i) and each smuggled severity of (j), `carry` does not throw; `carried.declared` is the given `Declared`; `carried.fields.message`, `.hint` and `.place` are the given values (`toBe` for the place, so nothing is copied or trimmed); and `carried.fields.severity` is `"error"`. 200 runs | test | Effect Arbitrary: goodFieldsAndParts | (h) trim the message in `carry`: a text kind with a space in front comes back changed, red; and decode the place in `carry` and keep the decoded copy: `toBe` fails, red; (i) decode the fields with `Reported` in `carry` and throw on a bad one: a blank hint throws, red; (j) build the fields as `{ severity: "error", ...fields }`: a smuggled `"warning"` wins, red | kalfa/diagnostics/src/Diagnostic.test.ts |
| D30, carried, then reported: for a generated list of values, each drawn from (a) to (f) and each carrier's fields drawn from (h), a handler that reads each with `fromError` and reports each `some` through `Diagnostics.report(carried.declared, carried.fields)`, under `TestDiagnostics.layer`, collects exactly the carried ones, in order, each with `severity: "error"` and its declared code; with one carrier of a bad field set from (i) put in at a generated spot, the run dies with a SchemaError and no typed failure, and the Layer holds exactly the good reports before the spot. 100 runs | test | Effect Arbitrary: goodFieldsAndParts | (j) widen the carried severity to whatever the fields hold, so a smuggled `"warning"` is collected as a warning, red; (h) drop a home place's column in `carry`: the collected place differs, red; (i) answer `none` from `fromError` when the fields would not decode: the bad one is skipped and the run does not die, red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D31 [secrets], a carried login goes nowhere: for generated logins in every root, each put as a carried repo place and a carried home place (k) on a `Schema.TaggedError` getter, `carry` and `fromError` throw nothing and make no span; reporting it dies with a SchemaError; the login is in none of: the defect's message, its `JSON.stringify`, `TestDiagnostics.reported` (empty) and every attribute of every span, where the only span is `diagnostics.report`. 100 runs | test | Effect Arbitrary: placeParts | (k) check the place in `carry` and throw `new Error(JSON.stringify(fields.place))` on a bad one: the thrown message holds the login, red | kalfa/diagnostics/src/Diagnostics.test.ts |
| D32, the types: `Diagnostic.carry` is `(declared: Diagnostic.Declared, fields: { message, place, hint }) => Diagnostic.Carried`; a `severity` key in its fields does not compile; a string in place of a `Declared` does not compile; `Diagnostic.Carried["fields"]["severity"]` is exactly `"error"`; `Diagnostics.report(carried.declared, carried.fields)` is `Effect<void, never, Diagnostics.Diagnostics>`; `Diagnostic.fromError` is `(error: unknown) => Option.Option<Diagnostic.Carried>`; an object literal `{ declared, fields }` is no `Carried`; and the service's own method does not take `{ code: carried.declared.code, ...carried.fields }`, so D16 holds for a carried diagnostic too | type | type | widen the fields' severity to `Diagnostic.Severity`: the exact-type check fails, red; let `carry` take a severity: its `@ts-expect-error` is unused, red; drop the symbol key from `Carried`: the object literal compiles and its `@ts-expect-error` is unused, red | kalfa/diagnostics/src/Diagnostics.types.test.ts |
| D24, widened, the README shows the carried shape: as today, every code block of the README is in `README.types.test.ts` word for word, imports aside, and the compiler checks that file; and the README also holds `get diagnostic(): Diagnostic.Carried`, `Diagnostic.carry(`, `Diagnostic.fromError(`, `Diagnostics.report(carried.declared, carried.fields)`, `Diagnostic.Place.cases.` and `no-manual-tagged-construction` | test | scenario: the package's own README and types file at head | delete the README line that names the makers: red; change the carry example in the README only: that block is in the failure, red; in the types file, make `onNone` fail with the error: the type check below fails, tsc red | kalfa/diagnostics/src/Package.test.ts, kalfa/diagnostics/src/README.types.test.ts |

D1 to D23 and D25 do not change. D10 still holds: `TestDiagnostics` exports what it did. D11 still holds: the
manifest gains no export, since all three names live in `./Diagnostic`. D12 still holds: the README's new text names
`kalfa` packages but none of the words D12 refuses.

No law needs launchd, the real Electron app, a real OS process or socket, or a real signal, so none is host-only and
none waits on the owner's Mac. No law is a `*.integration.test.ts` file.

## The README, word for word

The tests step writes the new block into `kalfa/diagnostics/src/README.types.test.ts` (imports at the file's top, as
today: `Option` and `Schema` join `Effect`), and the build writes the same block into the README, so D24 holds both
ways. If lint asks for a change in the types file, the same change goes into the README.

A new section, `## Carry it on an error`, after "Say where":

````md
## Carry it on an error

A typed error can say which diagnostic it is, so the command that runs it can report it without knowing the error.
The error holds a **carried diagnostic** (`Diagnostic.Carried`) under the key `diagnostic`: a declared code and the
fields beside it, made with `Diagnostic.carry`. A carried diagnostic is always an error: `carry` takes no severity.

```ts
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import { Effect, Option, Schema } from "effect";

export class UnknownSettingError extends Schema.TaggedError<UnknownSettingError>()("UnknownSettingError", {
  setting: Schema.String,
  line: Schema.Int,
}) {
  get diagnostic(): Diagnostic.Carried {
    return Diagnostic.carry(UnknownSetting, {
      message: `The setting \`${this.setting}\` is not declared.`,
      place: Diagnostic.Place.cases.repo.make({ path: ".config/settings.toml", line: this.line }),
      hint: "Check the spelling against the settings reference.",
    });
  }
}

// Where the error is handled: report what it carries through `report`, or nothing.
const reportCarried = (error: unknown) =>
  Option.match(Diagnostic.fromError(error), {
    onNone: () => Effect.void,
    onSome: (carried) => Diagnostics.report(carried.declared, carried.fields),
  });
```

- `carry` checks nothing. A blank message or a bad place is caught when the handler reports it: `report` dies, as
  for any report. A package's own tests report each of its errors, so they catch it.
- `fromError` takes any value. It answers `Option.some` of what the value carries under `diagnostic`, whether the
  value holds the key or its class gives it, and `Option.none()` when it carries none. Only a value `carry` made
  counts. A getter that throws is not caught, and no `cause` is followed: an error that wraps another says itself
  which diagnostic it is.
- Reporting stays one way in: `report` checks the fields, and only it hands the service a value. This package picks
  no exit code; the command that runs the subcommand does.
````

In "Say where", one bullet after the list's first item:

```md
- In a package whose lint refuses a `_tag` written by hand (`anti-slop-effect/no-manual-tagged-construction`, which
  the kalfa packages turn on), build each place with its kind's maker, `Diagnostic.Place.cases.<kind>.make`, as the
  example under "Carry it on an error" does. The maker checks the place as it builds it, and throws on a bad one.
```

And the opening's "Two words to keep apart" becomes three: a **carried diagnostic** (`Diagnostic.Carried`) is a
declared code and its fields that a typed error holds, unchecked until it is reported.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/diagnostics/src/Diagnostic.ts | build | 65 | `CarriedId`, `Carried`, `carry`, `isCarried` (unexported) and `fromError`, with doc blocks for the three exports (each with an example); the module's opening comment names a carried diagnostic; `Option` and `Predicate` join the `effect` import |
| kalfa/diagnostics/src/Diagnostics.ts | build | 2 | `report`'s doc block, "When to use": also when handling an error that carries a diagnostic, read with `Diagnostic.fromError` |
| kalfa/diagnostics/README.md | build | docs | the section and the bullet above, word for word, and the third word in the opening |
| kalfa/diagnostics/GLOSSARY.md | build | docs | the term "Carried diagnostic" (Records, below) |
| kalfa/diagnostics/src/TestDiagnostics.ts | build | 0 | no change |
| kalfa/diagnostics/package.json | tests | tests | no change: no new export path |
| kalfa/diagnostics/src/Diagnostic.test-support.ts | tests | tests | the classes (a) to (k): a `Schema.TaggedError` with a `diagnostic` getter that calls `carry` from its own fields, one with no getter, one whose getter throws; builders for the plain object, the native error, each value that is no object and each look-alike; a watched handler that reads with `fromError` and reports, as `observed` does for `report` |
| kalfa/diagnostics/src/Diagnostic.test.ts | tests | tests | D26 to D29 |
| kalfa/diagnostics/src/Diagnostics.test.ts | tests | tests | D30 and D31 |
| kalfa/diagnostics/src/Diagnostics.types.test.ts | tests | tests | D32 |
| kalfa/diagnostics/src/Package.test.ts | tests | tests | D24 widened: the six strings |
| kalfa/diagnostics/src/README.types.test.ts | tests | tests | the README's new block, word for word, `Option` and `Schema` in the import, and a type check that what `reportCarried` returns extends `Effect<void, never, Diagnostics.Diagnostics>` (`toExtend`, since `Option.match` gives a union of its two branches) |
| .oxlintrc.json | tests | tests | no change: the package's override already allows `Option` and `Predicate` from `effect`, and `no-manual-tagged-construction` stays on |
| layer-rules.json | tests | tests | no change: no row changes, so no layer test changes either |
| boundary-rules.json | tests | tests | no change |
| package.json | tests | tests | no change, and no lockfile change: the package imports nothing new |

## Existing tools

- `Diagnostic.Carried` and `Diagnostic.carry`, new in the existing `kalfa/diagnostics/src/Diagnostic.ts`: searched
  Effect 4.1.3 (`effect/cli`'s `CliError.userMessage` and `getUserMessage`, `Cause`, `Schema.TaggedError`), the repo
  (`rg "get diagnostic|carr" kalfa`, only prose hits) and npm for a carried-diagnostic shape for Effect (none found).
  Effect's CLI key carries only a string, so the shape is new; it copies Effect's getter-and-reader idea and the
  package's own `Declared` symbol idea.
- `Diagnostic.fromError` and `isCarried`, in the same file: searched Effect's `Predicate` (`hasProperty`, used as
  it is), `Option` (`some`, `none`, used as they are) and `CliError.getUserMessage` (the model, but it answers
  `undefined` and reads only strings). Two short functions built from those.
- The new generators in `kalfa/diagnostics/src/Diagnostic.test-support.ts`: built from its own `fieldVariants`,
  `blanksFrom`, `brokenPlaces`, `rootedAtLogin`, `otherSeverity`, `goodText`, `between` and `observed`.

## Validation

- tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/diagnostics` shows D26 to D31 red on the
  missing names and D24 red on the README. Each class's plant is tried by hand in `Diagnostic.ts`, seen red and
  undone. No install: no package or lockfile changes.
- build step: the same vitest path green, then `pnpm format` and `pnpm lint`.
- The lead runs `pnpm typecheck`, which holds D32 and the types file of D24, and the `--changed` run.

## Size

1. One slice, the carried diagnostic: about 67 product lines (`Diagnostic.ts` 65, `Diagnostics.ts` 2), plus the
   laws, the generator classes, the README section and the glossary term. It lands whole: a package's typed error
   can say which diagnostic it is, and the command can read it from any failure and report it.

About 2 agent hours across the steps, 80% sure. The steps are tests, build and one review, plus one likely
send-back, most likely on a generator class or the README block. The two plans before this one measured about $5
a step at list price for this package.

Estimate: 4 steps, $20

## New names

- `Diagnostic.Carried`: a carried diagnostic, the glossary's new term.
- `Diagnostic.carry`: makes one. A verb, as the glossary's "a typed error may carry its own diagnostic".
- `Diagnostic.fromError`: reads one from any value (the call under 80% at the top).
- `diagnostic`: the key on an error, the owner's word from the sketch on 1751.
- `declared` and `fields`: the two keys of a `Carried`, the same words as `report`'s two parameters and its
  `Diagnostics.Fields` type.
- `CarriedId` and `isCarried`: code names inside `Diagnostic.ts`, not exported, as `TypeId` is for `Declared`.

## Records

- `kalfa/diagnostics/GLOSSARY.md` gains one term, in the build:

  **Carried diagnostic**:
  A diagnostic a typed error holds: its declared code and the message, place and hint beside it, kept as given and
  checked only when the code that handles the error reports it. It is always an error, never a warning, since the
  subcommand stopped.
  _Avoid_: attached diagnostic, error diagnostic, embedded diagnostic, payload

- No new decision: 0084 and the owner's two answers on the ticket hold the rulings, and this plan builds them.
- `field/runs/` rows for each step, by the lead.

## What this cannot tell us

- Whether CLI's handler fits this shape, and that a subcommand that fails this way ends with exit code 1. The
  ticket's third criterion says so, but CLI is not built: that half is CLI's ticket. This package picks no exit code.
- Whether Configuration's `SettingsError` can build a place from its own data. Decision 0088 says it must carry where
  as data; that is Configuration's ticket, which the owner's answer on 1751 names.
- A carried place is unchecked until it is reported. If a command prints a failed error some other way first (a log
  of the whole error, `Cause.pretty`), the error's own fields show as they are. The carried diagnostic is built by a
  getter, so it is no own field, but this plan did not check how Effect prints a `Schema.TaggedError`.
- A caller can forge a `Carried` with `Symbol.for`, as it can a `Declared`. `report` still checks every field.
- A getter builds a new `Carried` each time it is read. Nothing reads it twice today.
- Whether the name `fromError` is the one the owner wants (the call at the top).

## Open questions

None.

The one call under 80% is at the top, with what would settle it.

## Findings

None. Everything this plan touched that is wrong outside the ticket is already a finding in the two plans before it.

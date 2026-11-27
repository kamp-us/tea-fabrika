Approved by the lead agent, builds issues 1310; body e6459f849ecc
Plancheck-Version: 3

# Plan: an error's hidden cause stays hidden when the error is written as JSON (ticket 1310)

This is the kalfa package suite (`kalfa/diagnostics/`, `kalfa/secrets/`, `kalfa/config/`, and a lint rule), new
work. It is not today's frozen version and not `next/`. The ticket is tracker ticket 1310, filed by the plan for
ticket 2068 (https://github.com/kamp-us/tea-fabrika/pull/2318). Every claim below is about the kalfa packages on main
at `6621f252e`, unless it names the Ledger branch (https://github.com/kamp-us/tea-fabrika/pull/2314).

**One call under 80%, taken as a lean:** the shared schema lives in `@kalfa/diagnostics`, as `Hidden.Cause` in a new
`Hidden` module (75%). Diagnostics ranks lowest (layer 0), imports nothing, and is already the package a typed error
uses to say what it reports (decision 0084: "a typed error may carry its own diagnostic"). The doubt: it gives the
Ledger its first kalfa import, which the Ledger's approved plan refuses today (its law P1 and its rank law L3, layer 0),
and it widens Diagnostics' context from "what a diagnostic is" to "what an error shows". What would settle it: the
owner's yes to the Ledger importing Diagnostics, the one open question at the end. A no means a new, tiny package
of its own at layer 0 (one more manifest, one more lockfile entry, the same code).

```ts
// The fix, in one field. Before (main): Schema.toCodecJson writes the cause in full.
cause: Schema.Redacted(Schema.Defect()),
// After: every codec that writes outward writes "<redacted>", and a read gives back an empty hidden cause.
cause: Hidden.Cause, // import * as Hidden from "@kalfa/diagnostics/Hidden"
```

## What changes, in one paragraph

`Schema.Redacted(Schema.Defect())`, the shape `@kalfa/secrets` holds its two causes in, hides a cause from
`String`, `JSON.stringify`, `inspect` and `Cause.pretty`, but `Schema.toCodecJson` writes the cause in full. Transport
writes every frame with `Schema.toCodecJson`, so the first `StoreFailed` that crosses a socket would carry its cause,
which may quote a secret. This plan adds one schema, `Hidden.Cause`, that every codec that writes outward writes as
the fixed text `<redacted>` and reads back as an empty hidden cause. Secrets' two causes move to it. A new lint rule,
`fabrika/hidden-cause`, refuses `Schema.Redacted(` in a kalfa error class's fields and any `cause` that is not
`Schema.Defect()` or `Hidden.Cause`, so no package brings the old shape back and no package keeps its own copy. The
leak laws of Secrets and Configuration now also write each error with `Schema.toCodecJson`, alone and inside an
`Exit`. A second slice moves Configuration's `SnapshotError` to `Hidden.Cause`, the import decision 0084 already gave
Configuration.

## Searched first

- Settled notes: `rg -il` over `.kalfa/decisions .kalfa/glossary .kalfa/patterns .kalfa/runbooks` for "redacted",
  "hidden cause", "toCodecJson", "placeholder", "leak law" and "cause schema". Hits read whole: 0015 (a store
  refuses a `Redacted` value; not about causes), `.kalfa/patterns/settings.md` (uses `toCodecJson` for settings,
  no cause), `.kalfa/patterns/effect-errors-keep-their-cause.md` (the two cause forms, both `Schema.Defect()`). The
  settled-search tool found no decision on a hidden cause.
- Decisions that bind the home: 0049 (a package imports only packages ranked below it), 0047 (each package usable
  alone), 0084 (Diagnostics ranks below Configuration, and "Configuration gains its first kalfa import" from it),
  0091 (Permissions and Identity import the Ledger's error classes; it states "The Ledger's core imports no kalfa
  package, so no cycle forms").
- `layer-rules.json` at head: `kalfa-diagnostics`, `kalfa-git`, `kalfa-markdown`, `kalfa-transport` at layer 0,
  each importing nothing; `kalfa-config` at 1 (imports `next-vitest`); `kalfa-secrets`, `kalfa-github`, `kalfa-cli`
  at 2. On the Ledger branch, `kalfa-ledger` is at 0 and imports nothing. A row may not import a row of the same
  layer (`oxlint-plugins/layers.test.ts:133`, `RANKS = ["upward", "sideways"]`), so the owner must rank strictly
  below every user, and the Ledger must move to layer 1 to use it.
- `rg -n "Schema\.Redacted\(" kalfa` (product files): `kalfa/secrets/src/Errors.ts:21` (`StoreFailed`) and `:31`
  (`RecordFailed`), and `kalfa/github/src/GitHubLive.ts:21` (a `Schema.is` check on a token, no error class).
  Every other kalfa `cause` field is `Schema.Defect()` or `Schema.optional(Schema.Defect())`
  (`kalfa/git/src/Repository.ts:240`, `:259`; `kalfa/github/src/GitHub.ts:251`, `:280`;
  `kalfa/markdown/src/Frontmatter.ts:115`; `kalfa/config/src/Files.ts:35`, `Snapshot.ts:51`, `Toml.ts:28`, `:37`,
  `:47`, `:63`, `internal/error.ts:30`; `kalfa/records/src/Tracked.ts:25`). Two of those hold a `Redacted` by
  convention: `SnapshotError` (`kalfa/config/src/Snapshot.ts:144-148`) and `SettingsError` when its reason is
  `snapshot` (`kalfa/config/src/internal/snapshot.ts:88`, `:119`, `:145`).
- Open pull requests that touch this: the Ledger (2314) has a private `Hidden` schema in `kalfa/ledger/src/Errors.ts`;
  the Configuration refusals plan (https://github.com/kamp-us/tea-fabrika/pull/2319, plan only) proposes
  `cause: Schema.optional(Schema.Redacted(Schema.Defect()))` on `SettingsError`. "Branches in flight" says what each
  does.

## How others do it

- **Effect 4.1.3, as installed** (`effect@4.1.3` with the repo's patch, `pnpm-lock.yaml:373`), read in
  `node_modules/effect/src`:
  - `Schema.Redacted` (`Schema.ts:16980-17059`) gives its declaration a `toCodecJson` link (`:17044-17055`) whose
    encode is `SchemaGetter.transform(Redacted_.value)`: the codec writes the hidden value itself. With
    `disallowJsonEncode: true` (`:16971-16973`, normalized at `:16985-16990`) the encode is
    `SchemaGetter.forbidden(...)`, so the whole encode fails. `RedactedFromValue` (`:17081-17097`) does the same
    with `disallowEncode`. Neither writes a placeholder, and a refused encode would keep a whole failed `Exit` from
    crossing, which is why this plan does not use `disallowJsonEncode`.
  - `Schema.Defect()` (`Schema.ts:9433-9442`) encodes an `Error` as `name`, `message` and `cause`, and any other
    value through `Formatter.formatJson` (`SchemaTransformation.ts:1364-1371`, `:1388-1406`), which is
    `JSON.stringify` with a replacer (`Formatter.ts:308-330`). A `Redacted`'s `toJSON` is its `toString`
    (`Redacted.ts:209-214`): `<redacted>`, or `<redacted:label>` when it has a label. So Effect's own JSON for an
    unknown value already writes a hidden one as `<redacted>`. That is the placeholder this plan picks.
  - `Schema.declare` takes `toCodecJson`, `toCodecStringTree`, `toCodecIso` and a fallback `toCodec`
    (`Schema.ts:19410-19472`). `toCodecJson` derivation reads `toCodecJson ?? toCodec`
    (`internal/schema/toCodec.ts:81`); the string-tree codec uses the `toCodecJson` link when there is one
    (`:204-207`); the Go-style JSON codec is built on the JSON one (`:317-318`); the iso codec reads
    `toCodecIso ?? toCodec` and keeps the value when neither is set (`:146-152`). The iso codec is in-process only:
    `Optic` uses it (`internal/schema/toIso.ts:7-10`). Native arbitrary derivation falls back to the `toCodecJson`
    link (`internal/arbitrary/schema.ts:1646`).
  - A probe on this worktree's installed Effect, run once by this plan with the schema sketched below on a class
    `Probe { cause, n }`: `toCodecJson`, `toCodecStringTree` and `toCodecGoJson` each wrote `"cause":"<redacted>"`;
    the iso codec kept the very value; the JSON read back gave `Redacted.isRedacted` true and
    `Redacted.value` `undefined`; a wire cause of any other text was refused at `["cause"]`; an `Exit.fail` inside
    `Schema.toCodecJson(Schema.Exit(Schema.Void, Probe, Schema.Defect()))` wrote the placeholder, and an `Exit.die`
    wrote `"cause":"<redacted:lbl>"` through `Schema.Defect()` (the label shows; the value does not); the old
    `Schema.Redacted(Schema.Defect())` wrote `{"name":"Error","message":"<value>","cause":"<nested value>"}`; a
    `Schema.optional(Schema.Defect())` holding a `Redacted` wrote `<redacted>` and read back the plain string.
- **The Ledger branch** (`kalfa/ledger/src/Errors.ts`, PR 2314) already does it this way, privately: a
  `Schema.declare` with a `toCodecJson` link to `Schema.Literal("<redacted>")`, read back as
  `Redacted.make(undefined)`. This plan moves that schema into Diagnostics and makes it the one copy.
- **This repo's `next/`** (`next/packages/libfabrika/src/runtime/Audit.ts:10`) uses `disallowJsonEncode: true`, and its
  RPC answer has no field for the cause. That drops the cause instead of writing a placeholder; it works only
  because that answer is hand-built.
- **Erlang/OTP**: a `gen_server` may define `format_status/1` so a crash report shows a placeholder in place of
  private state (from memory; not fetched). The same idea: the record says something was there, never what.
- **Elm**: no answer. Elm has no error causes that cross a wire; a `Http.Error` carries no body by design (from
  memory; not fetched).
- **The industry**: Rust's `secrecy` crate keeps a secret out of serialization unless the type opts in, and pino's
  `redact` writes a fixed `[Redacted]` (both from memory; not fetched).

## The shape

```ts
// kalfa/diagnostics/src/Hidden.ts. A sketch: the doc blocks are shortened.
/**
 * A cause a typed error holds and never shows. ...
 */
import { Redacted, Schema, SchemaGetter } from "effect";

/**
 * What every codec that writes outward writes for a hidden cause. It is Effect's own text for a `Redacted`.
 *
 * @category constants
 */
export const placeholder = "<redacted>";

/**
 * Schema for a typed error's cause that may quote a value: a `Redacted` in memory, `placeholder` in JSON, and an
 * empty `Redacted` when read back. Make it with `Redacted.make(cause)`; read it on purpose with `Redacted.value`.
 *
 * @category schemas
 */
export const Cause = Schema.declare(
  (candidate: unknown): candidate is Redacted.Redacted<unknown> => Redacted.isRedacted(candidate),
  {
    expected: "a hidden cause",
    // `toCodecJson` and not `toCodec`: the string-tree and Go-style codecs reuse this link, and the iso codec,
    // which stays in the process, keeps the cause.
    toCodecJson: () =>
      Schema.link<Redacted.Redacted<unknown>>()(Schema.Literal(placeholder), {
        decode: SchemaGetter.transform(() => Redacted.make(undefined)),
        encode: SchemaGetter.transform((): typeof placeholder => placeholder),
      }),
  },
);
```

```ts
// kalfa/secrets/src/Errors.ts, the two fields after the change. The constructors' types do not change:
// `cause` is still a `Redacted.Redacted<unknown>`, so no caller changes.
import { Schema } from "effect";
import * as Hidden from "@kalfa/diagnostics/Hidden";

export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
  cause: Hidden.Cause,
}) {}

export class RecordFailed extends Schema.TaggedError<RecordFailed, { readonly brand: unique symbol }>()(
  "RecordFailed",
  { cause: Hidden.Cause },
) {}
```

```ts
// kalfa/config/src/Snapshot.ts, slice 2. `cause` goes from `unknown` to `Redacted.Redacted<unknown> | undefined`.
// The two places that make one already pass `Redacted.make(cause)` (`Snapshot.ts:147` and
// `next/packages/libfabrika/src/cloudflare/QuotaSettings.ts:28`), and the hash case passes none.
export class SnapshotError extends Schema.TaggedError<SnapshotError, { readonly brand: unique symbol }>()(
  "SnapshotError",
  { message: Schema.String, cause: Schema.optional(Hidden.Cause) },
) {}
```

The lint rule, `fabrika/hidden-cause` (`oxlint-plugins/hidden-cause.ts`). A sketch of what it reads:

- **An error class** is a class whose `extends` is `<S>.TaggedError<...>()(tag, fields, ...)` or
  `<S>.Error<...>(id)(fields)`, where `<S>` is Effect's `Schema` in any spelling: `import { Schema } from "effect"`,
  renamed (`{ Schema as S }`), `import * as S from "effect/Schema"`, or the barrel as a namespace
  (`import * as E from "effect"`, then `E.Schema.TaggedError`). It resolves names through the file's own scope, as
  `no-cause-squash.ts` does; its `imported` helper moves to `match.ts` so both rules use it.
- **Its fields** are the object literal, or a same-file `const` the argument or a spread names, followed one step at a
  time.
- **Refusal one:** a call of `<S>.Redacted(` or `<S>.RedactedFromValue(` anywhere under the fields, at any depth
  (inside `Schema.optional`, `Schema.Union`, `Schema.Struct`), or in a same-file `const` the fields name. Message:
  "`Schema.Redacted` writes its value in full through `Schema.toCodecJson`, so an error that crosses a socket
  would carry it. Hold a cause that may quote a value as `Hidden.Cause` from `@kalfa/diagnostics/Hidden`, which every
  codec writes as `<redacted>` (oxlint-plugins/hidden-cause.ts)."
- **Refusal two:** a `cause` key whose value is not one of four forms: `<S>.Defect(...)`,
  `<S>.optional(<S>.Defect(...))`, `Hidden.Cause`, or `<S>.optional(Hidden.Cause)`, where `Hidden` is a namespace
  import of `@kalfa/diagnostics/Hidden` (or `Cause` imported from it by name), or `./Hidden.ts` inside
  `kalfa/diagnostics/src/`. Message: "An error's `cause` is `Schema.Defect()` or `Hidden.Cause` from
  `@kalfa/diagnostics/Hidden`, optional or not, so every hidden cause in kalfa is written one way
  (oxlint-plugins/hidden-cause.ts)."
- **Where:** one new override in `.oxlintrc.json` over every kalfa file, leaving out kalfa's test files (`.test.ts`,
  `.test.tsx`) and test support files (`.test-support.ts`): a test makes errors with any cause to probe them. Error.
- **What it misses:** fields built by a call (`Schema.Struct(...).fields`), fields imported from another file, an
  alias made at run time (`const S = Schema`), and anything outside `kalfa/`.

### Why each call

- **A placeholder, not a refused encode** (95%): a refused encode fails the whole `Exit`, so a caller across a
  socket would learn nothing, not even the tag. The ticket asks that the round trip keep the tag and fields.
- **`<redacted>`** (90%): it is Effect's own text for an unlabeled `Redacted` and the Ledger branch's choice. A label is
  not written: the placeholder is one fixed text, so the JSON form does not change with how a caller made the
  cause.
- **Read back as `Redacted.make(undefined)`** (90%): the value never left the process, so the reader holds nothing
  and says so. Reading back `Redacted.make(placeholder)` would hand a later reader a text that looks like a cause.
- **`toCodecJson`, not `toCodec`** (85%): the probe and `toCodec.ts:146-152` show the iso codec keeps the value when
  only `toCodecJson` is set. An optic inside the process should not lose a cause.
- **The rule also fixes the `cause` form** (80%): a refusal of `Schema.Redacted(` alone would let the Ledger keep its
  private copy, and the ticket asks for one schema. On main today the second refusal has 0 fires (every other
  cause is a `Defect`), so it costs nothing to turn on.
- **`SettingsError` keeps `Schema.optional(Schema.Defect())`** (80%): most of its causes are not hidden (a
  `PlatformError` it already prints), and the hidden ones are `Redacted` values that `Schema.Defect()` writes as
  `<redacted>` (the probe). C1 pins that. Moving it to a typed hidden cause is PR 2319's own design.

## One value traced

A store's backend throws while a fetch runs. `kalfa/secrets/src/internal/use.ts:54` catches the defect and dies with
`new Errors.StoreFailed({ cause: Redacted.make(defect) })`; the fetch fails with `SecretsUnavailable` whose `reason`
is a `StoreFailed`. A Transport stream writes the failed outcome with its codec (`Format.codecFor` is
`Schema.toCodecJson`, `kalfa/transport/src/Format.ts:72`).

1. In memory: `error.reason.cause` is a `Redacted`. `String`, `JSON.stringify`, `inspect` and `Cause.pretty` show
   `<redacted>`, as today.
2. On main today the codec writes
   `{"_tag":"SecretsUnavailable","secret":"app-key","store":"memory","reason":{"_tag":"StoreFailed","cause":{"name":"Error","message":"bad value <value>","cause":{...}}}}`.
3. After slice 1 it writes
   `{"_tag":"SecretsUnavailable","secret":"app-key","store":"memory","reason":{"_tag":"StoreFailed","cause":"<redacted>"}}`.
   Inside an `Exit`, `{"_tag":"Failure","cause":[{"_tag":"Fail","error":{...the same...}}]}`.
4. The other side decodes it with the same schema: a `SecretsUnavailable` whose `reason` is a `StoreFailed`;
   `Effect.catchTag("SecretsUnavailable", ...)` catches it; `Redacted.isRedacted(reason.cause)` is true and
   `Redacted.value(reason.cause)` is `undefined`.
5. A wire that sends any other text in the cause's place, such as the value itself, is refused with a
   `SchemaError` at `["reason", "cause"]`.

## Generators

Every law below draws its inputs from Effect's `Arbitrary`, and each run also checks a value made for each class
listed, so every class is in every run. Each class has a plant in the laws table.

Causes a hidden cause is made over (each built around a drawn secret word, `marker` in each package's test support):

- (e) an `Error` whose message quotes the word, whose `cause` is an `Error` that quotes it, whose `cause` is the word.
- (t) the word as plain text.
- (r) a record that holds the word two levels down.
- (l) any of the three above, hidden with a drawn label: `Redacted.make(cause, { label })`.
- (u) an empty hidden cause, `Redacted.make(undefined)`: what a read gives back.
- (n) for an optional cause, no cause: the key left out, and `cause: undefined`.

Wire values in the cause's place, for a read:

- (w) every JSON value that is not the placeholder: the drawn word, `<redacted:` and a drawn label `>`, the
  placeholder with a space before it, `null`, a drawn number, `{ name, message }` with the word.

A raw cause, for the run-time guard:

- (v) values that are no `Redacted`, drawn by `fc.anything()` and filtered, and an object that looks like one
  (`{ toString: () => "<redacted>" }`).

Files for the lint rule (generated lines, one per piece, as `no-cause-squash.test.ts` builds them):

- (a) `x: S.Redacted(S.String)` as a field of an error class.
- (b) the call nested: `S.optional(S.Redacted(...))`, `S.Union([S.Redacted(...), S.String])`,
  `S.Struct({ y: S.Redacted(...) })`.
- (c) through a same-file `const`: the whole fields object, a spread `{ ...Fields }`, or one field
  (`const C = S.Redacted(...)`, then `cause: C`).
- (d) each spelling of Effect's `Schema` (named, renamed, `effect/Schema` as a namespace, the barrel as a namespace).
- (f) `S.RedactedFromValue(...)`.
- (g) a `cause` that is none of the four forms: a local `Schema.declare`, `S.Unknown`, `S.Any`, `S.String`.
- (h) the class written as `S.Error<X>("X")({...})`.
- (j) `Hidden.Cause` with `Hidden` from another module: `./Hidden.ts` outside `kalfa/diagnostics/src/`,
  `@kalfa/ledger/Hidden`, a local object named `Hidden`.
- (i) lines that must pass: `S.Redacted(...)` outside an error class (in `S.Struct`, in `S.is(...)`), a local object
  named `Schema` with a `Redacted` method, each of the four allowed cause forms in each import spelling of
  `Hidden`, and a comment or a string that says `Schema.Redacted(`.

Paths for the real lint run:

- (m) kalfa product files: a planted `Plant` module in the `src` folder of Secrets, of Configuration (and its
  `internal` folder), of Diagnostics and of the Ledger, and a shared suite named like `StoreTest`.
- (o) left out: a planted test file and a planted test support file in a kalfa package, a planted module in
  libfabrika's `runtime` folder, and one in today's `packages/fabrika`.

## Laws

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3 with the shared seed 119120 (`SEED` in each
package's test support), and the lint laws use oxlint's `RuleTester` and one real oxlint run, as
`oxlint-plugins/no-cause-squash.test.ts` does. Every law runs in memory on every pull request, except C4, the
packed-archive check, which is `kalfa/config/src/Package.integration.test.ts` today and stays there: it packs and
installs with `npm`, which no stand-in can do. `written(schema, error)` below is a test helper each package's
test support gets (Existing tools): the JSON text of `Schema.toCodecJson(schema)`, `Schema.toCodecStringTree(schema)`
and `Schema.toCodecGoJson(schema)` of the error, and of `Exit.fail(error)` and `Exit.die(error)` through
`Schema.toCodecJson(Schema.Exit(Schema.Void, schema, Schema.Defect()))`; an encode that throws gives its rendered
error instead, so a refused encode is read too.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| H1, the placeholder and the round trip: for a drawn `word` (text) and `count` (whole number), a test class `Probe` with `cause: Hidden.Cause`, and `OptionalProbe` with `cause: Schema.optional(Hidden.Cause)`, over a cause of each class (e), (t), (r), (l) and (u), and `OptionalProbe` with (n): each of the three codecs writes an object whose own keys are exactly `_tag`, `word`, `count` and `cause` ((n): no `cause` key), whose `cause` is exactly `Hidden.placeholder`, and whose `word` and `count` are what that codec writes for a class without the cause; `Hidden.placeholder` is `"<redacted>"`; reading each written object back with the same codec gives the same `_tag`, `word` and `count`, and a cause for which `Redacted.isRedacted` holds and `Redacted.value` is `undefined` ((n): no cause). 300 runs | test | Effect Arbitrary: hiddenCauses | encode with `Redacted.value`: (e), (t) and (r) red; encode with `String(value)`: (l) red, the label is written; write `null` for an empty cause: (u) red; let `Cause` take `undefined` and write the placeholder for it: (n) red, a key appears with no cause; read back `Redacted.make(placeholder)`: red; move the link from `toCodecJson` to `toCodecIso`: red | kalfa/diagnostics/src/Hidden.test.ts |
| H2 [secrets], no codec shows the cause: for a drawn secret word and a cause of each class (e), (t), (r) and (l), no text of `written(Probe, probe)`, of `written(Wrapper, wrapper)` (a `Wrapper` error whose `reason` is a `Probe`, as `SecretsUnavailable` holds `StoreFailed`) or of `written(OptionalProbe, ...)` holds the word raw, JSON-escaped, base64, base64url, hex or percent-encoded. Control in the same run: `Schema.toCodecJson(Schema.Defect())` of the same plain cause shows the word for (e), (t) and (r), so the search can find it. 300 runs | test | Effect Arbitrary: hiddenCauses | make `Cause` `Schema.Redacted(Schema.Defect())`: (e), (t) and (r) red; write an `Error` cause's `message` as the placeholder's text: (e) red; write a record cause through `Schema.Json`: (r) red; write a text cause as itself: (t) red; write a cause that has a label through `Redacted.value` (a labeled cause taken for a public one): (l) red | kalfa/diagnostics/src/Hidden.test.ts |
| H3, a read refuses any other wire value: for each value of (w), reading `{ _tag: "Probe", word, count, cause: value }` with `Schema.toCodecJson(Probe)` fails with a `SchemaError` whose path is `["cause"]`, and its message holds no form of the drawn word. 200 runs | test | Effect Arbitrary: wireValues | read the cause with `Schema.String` in place of the literal: (w) red, the word is taken; read it with `Schema.Json`: (w) red; trim the wire text before the check: (w) red, the spaced placeholder reads | kalfa/diagnostics/src/Hidden.test.ts |
| H4, a raw cause cast past the type fails loudly: for each value of (v), `new Probe({ word, count, cause: raw as never })` throws, and `Schema.is(Probe)` is false for `{ _tag: "Probe", word, count, cause: raw }`; the same with `Redacted.make(raw)` does not throw and keeps `raw` (`toBe` through `Redacted.value`). 100 runs | test | fc.anything: filtered to values that are no `Redacted` | make the check `() => true`: (v) red, no throw; check `"toString" in candidate`: (v) red, the look-alike is taken | kalfa/diagnostics/src/Hidden.test.ts |
| H5, the iso codec keeps the cause in the process: for a cause of each class (e), (t) and (r), `Schema.toCodecIso(Probe)` encodes to an object whose `cause` is the very `Redacted` (`toBe`), and decodes back to an error whose `Redacted.value(cause)` is the given cause (`toBe`). 100 runs | test | Effect Arbitrary: hiddenCauses | annotate `toCodec` in place of `toCodecJson`: the iso codec writes the placeholder, red | kalfa/diagnostics/src/Hidden.test.ts |
| H6, the types: `typeof Hidden.Cause.Type` is exactly `Redacted.Redacted<unknown>`; `typeof Hidden.placeholder` is `"<redacted>"`; a class with `cause: Hidden.Cause` takes `Redacted.make(new Error("x"))`, and refuses `new Error("x")`, `"x"` and no cause (`@ts-expect-error`); with `Schema.optional(Hidden.Cause)`, `{}` and `{ cause: undefined }` compile and a raw `Error` does not | type | type | declare `Cause` as `Schema.declare((u: unknown): u is unknown => true, ...)`: the raw lines compile, their `@ts-expect-error` is unused, tsc red; export `placeholder` as `string`: the literal check fails, tsc red | kalfa/diagnostics/src/Hidden.types.test.ts |
| D11 and D10, widened: the manifest's exports add `./Hidden`, and still no dependency; the module `Hidden` exports exactly `Cause` and `placeholder` | test | scenario: the package's own manifest and module at head; no generated input says what a manifest holds | drop `./Hidden` from the exports: red; export a third name from `Hidden.ts`: red | kalfa/diagnostics/src/Package.test.ts |
| S1, Secrets' errors as JSON: for a drawn secret name and store id (the package's own generators) and a cause of each class (e), (t), (r) and (l), `Schema.toCodecJson` writes `StoreFailed` as exactly `{ _tag: "StoreFailed", cause: "<redacted>" }`, `RecordFailed` as exactly `{ _tag: "RecordFailed", cause: "<redacted>" }`, and `SecretsUnavailable` over each as exactly `{ _tag, secret, store, reason: { _tag, cause: "<redacted>" } }`; each reads back with the same tag and fields and a hidden, empty cause; `Exit.fail` of each crosses `Schema.toCodecJson(Schema.Exit(Schema.Void, Schema.Union([StoreFailed, RecordFailed, SecretsUnavailable]), Schema.Defect()))` and reads back as a failure with that error's tag. 100 runs | test | Effect Arbitrary: causes | put `Schema.Redacted(Schema.Defect())` back on `StoreFailed`: red; the same on `RecordFailed`: red; give `SecretsUnavailable` a `cause` field: red, a key too many | kalfa/secrets/src/Errors.test.ts |
| E3, widened: the texts it searches gain `written(Errors.StoreFailed, error)` and `written(Errors.RecordFailed, error)` | test | Effect Arbitrary: causes | put `Schema.Redacted(Schema.Defect())` back on `StoreFailed`: E3 red, where `JSON.stringify` alone stays green | kalfa/secrets/src/Errors.test.ts |
| X9 and X11, widened: the texts each searches gain `written` of each error over each carrier (X9), and of each failure the failing store and recorder end with and of the flow's own `Exit` through `Schema.toCodecJson(Schema.Exit(Schema.Unknown, Schema.Union([StoreFailed, RecordFailed]), Schema.Defect()))` (X11). 300 runs, as today | test | Effect Arbitrary: valueTexture | put `Schema.Redacted(Schema.Defect())` back on `StoreFailed`: X9 and X11 red; on `RecordFailed`: X9 and X11 red | kalfa/secrets/src/Leak.test.ts |
| X4, widened: the texts it searches gain `written(Errors.SecretsUnavailable, failure)` for each typed failure of each fetch flow, and the flow's `Exit` through the codec. 300 runs, as today | test | Effect Arbitrary: valueTexture | put `Schema.Redacted(Schema.Defect())` back on `RecordFailed`: X4 red on the flow whose recorder fails | kalfa/secrets/src/FetchLeak.test.ts |
| P1, widened: the dependencies are exactly `@kalfa/config` and `@kalfa/diagnostics`, each `workspace:*` | test | scenario: the package's own manifest at head | drop `@kalfa/diagnostics`: red; add `@kalfa/github`: red | kalfa/secrets/src/Package.test.ts |
| C1, Configuration's refusals through the codec: `refusal(exit).printed` (`kalfa/config/src/SettingGroup.snapshot.test-support.ts:1252`) and `answer(exit).printed` (`kalfa/config/src/SettingGroup.disk.test-support.ts:236`) gain `written(SettingGroup.SettingsError, error)`, so SN5 and every law that reads `printed` search the codec too. Runs as today | test | Effect Arbitrary: HiddenDraw | give `SettingsError` `cause: Schema.optional(Schema.Redacted(Schema.Defect()))`, the shape PR 2319 proposes: SN5 red, where `JSON.stringify` and `Cause.pretty` alone stay green; pass the decode error raw at `kalfa/config/src/internal/snapshot.ts:88`: SN5 red | kalfa/config/src/SettingGroup.snapshot.test-support.ts, kalfa/config/src/SettingGroup.disk.test-support.ts |
| L1, the rule reports exactly what it should: a generated file of one import spelling of `Schema` (d), one import spelling of `Hidden`, and one to six pieces, each a firing form from (a), (b), (c), (f), (g), (h) or (j) or a passing line from (i), one per line, at a `Case` module in Secrets' `src` folder; `RuleTester` reports exactly the firing lines, each with its message (refusal one for (a), (b), (c), (f), (h); refusal two for (g) and (j)), and the file with those lines taken out is valid. 100 runs, seed 119120 | test | fc.record: generated files | read only calls nested inside another call, never a field's own value: (a) red; read only the fields' top level: (b) red; read no same-file `const`: (c) red; match the text `Schema.` and not the import: (d) red on a renamed import, and (i) red on a local `Schema`; leave `RedactedFromValue` out: (f) red; check only `Schema.Redacted`, not the cause's form: (g) and (j) red; read only `TaggedError`: (h) red; accept any `.Cause` member: (j) red; fire on every `Schema.Redacted(` in the file: (i) red | oxlint-plugins/hidden-cause.test.ts |
| L2, one real lint run per path kind, with the repo's config: the same body (a bare `Schema.Redacted` cause, and a `Hidden.Cause` cause) at each path of (m) fires once, at the bare cause's line, and at each path of (o) fires nowhere | lint | scenario: the real config is the subject, one fixed body per path kind | drop test support files from the excludes: (o) red; scope the override to Secrets' folder alone: (m) red at the Ledger and Diagnostics paths | oxlint-plugins/hidden-cause.test.ts |
| L3, the rule is planted: `hidden-cause` is in `plants.test.ts`'s list of rules planted in their own file | test | scenario: the plugin's rule list at head | drop the entry: the missing-plant law is red | oxlint-plugins/plants.test.ts |
| C2 (slice 2), `SnapshotError` as JSON: for snapshots refused at each step that carries a cause (`Snapshot.read`'s strict decode, re-decode and re-encode, `kalfa/config/src/Snapshot.ts:144-160`) and at the hash step, which carries none (n), `Schema.toCodecJson(Snapshot.SnapshotError)` writes exactly `{ _tag, message, cause: "<redacted>" }` (hash: no `cause` key); reading it back gives `Redacted.isRedacted(cause)` true ((n): `cause` undefined); `written` of each holds no form of the snapshot's secret. 100 runs | test | Effect Arbitrary: HiddenDraw | keep `Schema.optional(Schema.Defect())`: the read-back cause is the string `<redacted>`, red; write the placeholder when there is no cause: (n) red | kalfa/config/src/SettingGroup.snapshot.test.ts |
| C3 (slice 2), the types: `SnapshotError["cause"]` is exactly `Redacted.Redacted<unknown> \| undefined`; `new SnapshotError({ message, cause: new Error("x") })` does not compile (`@ts-expect-error`); `{ message }` and `{ message, cause: Redacted.make(e) }` do | type | type | keep `Schema.optional(Schema.Defect())`: the `@ts-expect-error` is unused and the exact-type check fails, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| C4 (slice 2), the packed archive: `pnpm pack` of `@kalfa/diagnostics` and of `@kalfa/config`, installed together in a consumer with `npm`, typecheck the consumer; config's packed dependencies are exactly `@decimalturn/toml-patch`, `toml-eslint-parser` and `@kalfa/diagnostics`, the last with a plain version; no other `@kalfa/` name; diagnostics' packed exports point at `dist/` | test | scenario: a real pack and install, one fixed consumer | leave `@kalfa/diagnostics` as a dev dependency of config: the consumer's typecheck cannot find `@kalfa/diagnostics/Hidden` from config's `dist` types, red | kalfa/config/src/Package.integration.test.ts |

C4 is the one `.integration.` law: it packs and installs real archives with `npm`, which no stand-in can do, so it
runs in CI and in a proof run the lead starts, never narrowly on the laptop (`vitest.hostrun.ts` refuses it by name).
The behavior it guards is proved without it: C2 and C3 run on every pull request, and the archive law only checks
that the packed package matches.

## Files

Slice 1 unless a row says slice 2. `Product lines expected` counts product code; `tests` and `docs` mark the rest.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/diagnostics/src/Hidden.ts | build | 45 | new: `placeholder` and `Cause`, with doc blocks and one example each |
| kalfa/diagnostics/package.json | build | 8 | `./Hidden` in `exports` and in `publishConfig.exports` (7); slice 2: a `prepack` of `rslib build`, so a pack ships `dist/` (1) |
| kalfa/diagnostics/README.md | build | docs | a section "Hide a cause": the shape, why not `Schema.Redacted` (Effect 4.1.3 writes the value), and the JSON form |
| kalfa/diagnostics/GLOSSARY.md | build | docs | the terms "Hidden cause" and "Placeholder" (Records) |
| kalfa/diagnostics/src/Hidden.test.ts | tests | tests | H1 to H5, `Probe`, `OptionalProbe`, `Wrapper` |
| kalfa/diagnostics/src/Hidden.types.test.ts | tests | tests | H6 |
| kalfa/diagnostics/src/Hidden.test-support.ts | tests | tests | the classes (e), (t), (r), (l), (u), (n), (w), (v), the word's forms, and `written` |
| kalfa/diagnostics/src/Package.test.ts | tests | tests | D10 and D11 widened |
| kalfa/secrets/src/Errors.ts | build | 10 | the two fields as `Hidden.Cause`, the import, the module's doc block ("Details" names `Hidden.Cause`) |
| kalfa/secrets/package.json | build | 1 | `"@kalfa/diagnostics": "workspace:*"` in `dependencies` |
| kalfa/secrets/README.md | build | docs | lines 83-84, 91 and 118: a failure's cause is a `Hidden.Cause`, written as `<redacted>` in JSON |
| kalfa/secrets/src/Errors.test.ts | tests | tests | S1, E3 widened |
| kalfa/secrets/src/Leak.test.ts | tests | tests | X9, X11 widened |
| kalfa/secrets/src/FetchLeak.test.ts | tests | tests | X4 widened |
| kalfa/secrets/src/Secrets.test-support.ts | tests | tests | `written` |
| kalfa/secrets/src/Package.test.ts | tests | tests | P1 widened |
| kalfa/config/src/SettingGroup.snapshot.test-support.ts | tests | tests | C1: `printed` gains `written` |
| kalfa/config/src/SettingGroup.disk.test-support.ts | tests | tests | C1: `printed` gains `written` |
| kalfa/config/src/Snapshot.ts | build | 5 | slice 2: `cause: Schema.optional(Hidden.Cause)`, the import, the doc block |
| kalfa/config/package.json | build | 1 | slice 2: `"@kalfa/diagnostics": "workspace:*"` in `dependencies` |
| kalfa/config/README.md | build | docs | slice 2: `SnapshotError`'s cause is hidden, and the package's one kalfa dependency |
| kalfa/config/src/SettingGroup.snapshot.test.ts | tests | tests | slice 2: C2 |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | slice 2: C3 |
| kalfa/config/src/Package.integration.test.ts | tests | tests | slice 2: C4, packing diagnostics too |
| oxlint-plugins/hidden-cause.ts | tests | tests | new: the rule (about 160 lines), its opening comment (what counts, what passes, what it misses). A lint rule is the exam, so the tests step writes it |
| oxlint-plugins/match.ts | tests | tests | `imported`, moved here from `no-cause-squash.ts` and exported |
| oxlint-plugins/no-cause-squash.ts | tests | tests | imports `imported` from `match.ts` |
| oxlint-plugins/no-cause-squash.test.ts | tests | tests | no change: it runs once to show the move kept the rule |
| oxlint-plugins/index.ts | tests | tests | registers `hidden-cause` |
| oxlint-plugins/README.md | tests | tests | a section: the rule, the tools looked at first, and the first-day count from one real run |
| oxlint-plugins/hidden-cause.test.ts | tests | tests | L1, L2 |
| oxlint-plugins/plants.test.ts | tests | tests | L3: `hidden-cause` in the planted-elsewhere list, with its reason |
| .oxlintrc.json | tests | tests | the rule's override over kalfa (about 20 lines); the Secrets import block (`.oxlintrc.json:5643-5644`) lets `@kalfa/diagnostics/Hidden` through and its message says so; slice 2: the Configuration block's workspace refusal (`.oxlintrc.json:4905-4915`) lets `@kalfa/diagnostics/Hidden` through |
| layer-rules.json | tests | tests | `kalfa-secrets` imports `kalfa-diagnostics`; slice 2: `kalfa-config` too. No layer changes |
| boundary-rules.json | tests | tests | the same two edges in `libraryTypes` |
| oxlint-plugins/layers.test.ts | tests | tests | no change expected: no row is added and no layer moves; the tests step runs it to confirm |
| pnpm-lock.yaml | tests | tests | one `pnpm install --offline` after each manifest change |
| kalfa/AGENTS.md | build | docs | "Secrets ... imports only it" becomes "imports Configuration and Diagnostics"; slice 2: Configuration imports Diagnostics, as 0084 says |
| .kalfa/patterns/effect-errors-keep-their-cause.md | build | docs | a third row in its table: a cause that may quote a value is `Hidden.Cause` in kalfa |

If PR 2314 (the Ledger) is on main when slice 1's build starts, the rule fires three times in
`kalfa/ledger/src/Errors.ts`, and slice 1 also takes the Ledger's rows of "Branches in flight" below.

## Existing tools

- `kalfa/diagnostics/src/Hidden.ts`: searched Effect 4.1.3 (`Schema.Redacted`, `RedactedFromValue`, `Schema.Defect`,
  `Schema.declare`, `Redacted`), the repo (`rg "Schema\.Redacted\(|Redacted\.make\(" kalfa next`) and npm for an
  Effect schema that writes a fixed placeholder (none found). Effect's two shapes write the value or fail the encode.
  The one that fits is the Ledger branch's private `Hidden`, which this file becomes.
- `oxlint-plugins/hidden-cause.ts`: searched oxlint's built-in rules (`no-restricted-syntax` is not in oxlint;
  `no-restricted-imports` sees imports, not a call inside a class's fields), this folder's rules (`banNames` in
  `match.ts` bans a name everywhere and cannot tell an error's fields from a `Schema.is` check;
  `no-data-taggederror.ts` matches the `extends` but not its arguments) and npm (no Effect Schema lint plugin with
  this check). It is built from `match.ts`'s `dotted`, `below` and `pathIn`, and `no-cause-squash.ts`'s `imported`.
- `imported`, moved into the existing `oxlint-plugins/match.ts`: searched `match.ts` (has `effectNames`, which lists
  names but not which module member each one is) and the other rules (`no-cause-squash.ts` has the one
  resolver). Moved, not copied.
- `written` in each package's test support (`kalfa/diagnostics/src/Hidden.test-support.ts`,
  `kalfa/secrets/src/Secrets.test-support.ts`, and inline in the two config support files): searched the leak laws
  (`Secrets.test-support.ts` has `shown`, `reachable`, `needles`; `Transport.test-support.ts` has `reachable`; the
  Ledger branch's `Errors.test.ts` has its own `written`). A shared export from Diagnostics would give
  Configuration's tests a kalfa import before slice 2 gives Configuration one, so each package keeps its own
  ten-line copy of the Ledger's helper.

## Branches in flight

- **The Ledger, PR 2314.** Once slice 1 is on main and the Ledger merges main, `fabrika/hidden-cause` fires on its
  three causes (`cause: Hidden`, a local schema, refusal two), so its next build step: deletes its private `Hidden` and
  `PLACEHOLDER` from `kalfa/ledger/src/Errors.ts` and writes `cause: Hidden.Cause` three times, importing
  `* as Hidden from "@kalfa/diagnostics/Hidden"`; adds `"@kalfa/diagnostics": "workspace:*"` to
  `kalfa/ledger/package.json`; moves `kalfa-ledger` to layer 1 importing `kalfa-diagnostics` in `layer-rules.json`,
  with the same edge in `boundary-rules.json` and the pin `"kalfa-ledger": 1` in `oxlint-plugins/layers.test.ts`;
  runs `pnpm install --offline`; and updates `kalfa/AGENTS.md`'s rank line. Its laws P1 and L3 are amended by its
  lead (one repo package, `@kalfa/diagnostics`; layer 1); its F1 and F2 stay as they are, since they already encode
  with `Schema.toCodecJson` and inside an `Exit`, and their `<redacted>` equals `Hidden.placeholder`. Permissions and
  Identity rank above the Ledger already (0091), so nothing above it moves. If the Ledger lands first, slice 1 makes
  these changes itself.
- **The Configuration refusals plan, PR 2319.** It proposes `cause: Schema.optional(Schema.Redacted(Schema.Defect()))`
  on `SettingsError`, which this rule refuses and C1 turns red. It should use `Schema.optional(Hidden.Cause)`
  after slice 2 is on main (that is when Configuration may import Diagnostics), and its law RF7's exact type,
  `Redacted.Redacted<unknown> | undefined`, stays true. The lead tells that plan's writer before its tests step.

## Validation

- tests step, slice 1: one `pnpm install --offline` after the manifest change, then
  `nice -n 15 pnpm exec vitest run kalfa/diagnostics/src/Hidden.test.ts kalfa/secrets/src/Errors.test.ts kalfa/secrets/src/Leak.test.ts kalfa/secrets/src/FetchLeak.test.ts kalfa/secrets/src/Package.test.ts kalfa/diagnostics/src/Package.test.ts kalfa/config/src/SettingGroup.snapshot.test.ts oxlint-plugins/hidden-cause.test.ts oxlint-plugins/plants.test.ts`:
  H1 to H5, S1, P1, D10 and D11 red on the missing names; X4, X9, X11 and E3 red on the old field; C1 green (its
  plant is tried by hand and undone). The tests step also writes the rule, its config and the rule rows, since a lint
  rule is the exam: L1 to L3 pass, and `pnpm lint` shows the rule's first-day fires, which go in the README: by this
  plan's search, 2 (`kalfa/secrets/src/Errors.ts:21`, `:31`), both real, and 0 from refusal two. Each plant is tried
  by hand, seen red and undone.
- build step: the same files green and `pnpm lint` with 0 fires of the rule, then `pnpm format`, and
  `oxlint-plugins/layers.test.ts` once.
- slice 2: the same, plus C2 and C3; C4 runs in CI and in the lead's proof run.
- The lead runs `pnpm typecheck` (H6, C3, and `next/`'s use of `SnapshotError` in `QuotaSettings.ts`) and the
  `--changed` run.

## Size

1. Slice 1, the shared cause, Secrets' move, the rule and the codec in every leak law: 63 lines of product code
   (`Hidden.ts` 45, `Errors.ts` 10, the two manifests 8), plus the exam's part, which the tests step writes: the
   rule (about 160 lines), its config and rule rows (about 25), the laws, and the README sections and glossary. It
   lands whole: no kalfa error writes a hidden cause in full through any codec, and no package can bring the shape
   back.
2. Slice 2, Configuration's `SnapshotError`: 7 lines of product code (`Snapshot.ts` 5, the two manifests 2), plus
   the rule rows and the Configuration import block (about 6, tests) and C2 to C4. It lands whole: Configuration
   takes the import 0084 gave it, and its packed archive installs beside Diagnostics'.

About 5 agent hours across both slices, 75% sure: the rule's import resolution and its generated-file law, both in
the tests step, are the long part. The steps are tests, build and review for each slice, plus one likely send-back
on slice 1 (most likely a lint generator class or a leak law's text list) and one on slice 2 (C4's pack in CI).
Priced at about $8 a step at list price, from the two Diagnostics plans' roughly $5 a step and this plan's wider
tests step.

Estimate: 8 steps, $64

## New names

- `Hidden` (`@kalfa/diagnostics/Hidden`): the module. A plain word; `import * as Hidden` reads `Hidden.Cause`.
- `Hidden.Cause`: the schema. Effect's word "cause", under the module that says it is hidden.
- `Hidden.placeholder`: the fixed text. The industry's word for a stand-in value.
- `fabrika/hidden-cause`: the lint rule, named for what it keeps.
- `written`: a test helper in each package's test support, as the Ledger branch names it.

## Records

- `kalfa/diagnostics/GLOSSARY.md` gains two terms, in the build:

  **Hidden cause**:
  A typed error's cause that may quote a value, held so that no rendering and no codec shows it: in memory it is a
  `Redacted`, in JSON it is the placeholder, and read back it is empty.
  _Avoid_: redacted cause, masked cause, secret cause, scrubbed cause

  **Placeholder**:
  The fixed text `<redacted>` a hidden cause is written as, which says that a cause was held and never what it was.
  _Avoid_: mask, sentinel, stub, censor

- `.kalfa/patterns/effect-errors-keep-their-cause.md` gains a row: a cause that may quote a value is `Hidden.Cause`
  (kalfa), and its JSON form.
- No new decision: the ticket and decisions 0049 and 0084 hold the rulings. If the owner says yes to the open
  question, the lead records the Ledger's import beside 0091 with the adr skill, since 0091 states the Ledger imports
  no kalfa package.

## Is it a setting?

- The placeholder text: no. Both sides of a socket must agree on it, so it is a wire constant; a setting per app
  would make one app's errors unreadable to another.
- The rule's severity: no. It is error, as every rule here that keeps a secret in.
- Run counts: they are each law's own, as in every package here.

## What fact is lost if not recorded now

- That Effect 4.1.3's `Schema.Redacted` writes its value through `Schema.toCodecJson`, with the source lines. The
  Diagnostics README and the rule's comment keep it, so the next package does not re-learn it from a leak.
- The first-day count of the rule, which only a run on today's tree can give.
- That `Schema.Defect()` writes a `Redacted` as `<redacted>` and reads back plain text, which is why
  `SettingsError` is safe today without a typed hidden cause (C1 pins it).

## What this cannot tell us

- Whether the owner wants the Ledger to import Diagnostics (the open question). A no changes the home, not the code.
- A cause that never was a `Redacted`: a `Schema.Defect()` cause is written in full by design. The rule allows it,
  so a package that puts a value in a plain `Defect` cause still leaks it. Each package's leak laws are what catch
  that.
- An `Exit.die` of an error writes it through `Schema.Defect()`, which writes a labeled `Redacted` as
  `<redacted:label>`. A label is a public name, but the die path is not the fixed placeholder.
- The rule reads one file. Fields built by a call, imported from another file, or an alias of `Schema` made at run
  time are not seen.
- `next/` is outside the rule: `Audit.ts` and `LaunchdStatus.ts` use `Schema.Redacted` (Findings).
- The probe ran on this worktree's installed Effect once; nothing here checks a later Effect. H5 and H1 go red if
  Effect changes how a declaration's links are read.
- Whether slice 2's packed archive installs in CI as it does by hand: C4 is the first run that tries it.
- The first-day count is a search, not a lint run, until the build runs the rule.

## Open questions

1. Ledger imports Diagnostics for the shared hidden cause, its first kalfa import (moves to layer 1)? Lean yes, 75%:
   one copy, a dependency-free package below it, the same edge 0084 gave Configuration.

## Findings

- `next/packages/libfabrika/src/runtime/Audit.ts:10` holds error causes as
  `Schema.Redacted(Schema.Unknown, { disallowJsonEncode: true })`, built in a shared `Cause` object the four classes
  spread. Any codec encode of those errors fails rather than leaks, and the RPC answer drops the field by hand. The
  rule here does not reach `next/`, and would miss the spread form. Proof: the file, lines 10-38.
- `next/packages/libfabrika/src/node/launchd/LaunchdStatus.ts:15-16` holds a command's `stdout` and `stderr` as
  `Schema.Redacted(Schema.String)` in a `Schema.Struct`, so `Schema.toCodecJson` of that struct writes both in full.
  No codec writes it today (it is a decode-side schema). Proof: the file, lines 12-17.
- Effect has no option for a `Redacted` that writes a fixed placeholder. A small upstream proposal (a
  `Schema.Redacted(x, { json: "placeholder" })`-style option) would let this repo drop its own declaration; this plan
  did not file it.

## Lead's calls at signing (2026-11-23)

- (a) The Ledger imports `@kalfa/diagnostics` for `Hidden.Cause` and moves to layer 1. This answers the open question
  above: yes. The rank order puts Diagnostics below the Ledger, and decision 0084 gave Configuration the same edge, so
  there is one copy and no new package. The lead's call, 85%.
- (b) Slice 1 goes first: it is the leak fix.
- (c) The Ledger branch (PR 2314) and the Configuration refusals plan (PR 2319) take `Hidden.Cause` after slice 1 lands,
  as "Branches in flight" says.
- The approval line names `issues 1310`: ticket 1310 is a tracker ticket with no GitHub parent, and the existing
  signed plans write a ticket number after `issues`.

Approved by the lead agent, builds 0063, ticket 2018, amended; body ee0f761adf99
Plancheck-Version: 3

# Plan: errors that carry an inner failure set it as their cause (ticket 2018)

This is the kalfa package suite (`kalfa/git/`, `kalfa/secrets/`, `kalfa/ledger/`'s test support, `kalfa/github/`, and
a lint rule beside `oxlint-plugins/hidden-cause.ts`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2018. Every claim below is about main at `4ea3051ee` with the installed
`effect@4.1.3` and `oxlint@1.90.0`, unless it names a branch in flight.

**One call the owner may want to overrule, taken as a lean (80%):** `GitHubError` keeps no cause, and the new rule is
switched off on its one line with a reason. Its approved law C9 (`kalfa/github/src/GitHub.test.ts`, from
`.kalfa/quests/kalfa-github-operation-PLAN.md:715`) plants exactly "give `GitHubError` a `cause` of its reason: the
undecodable value shows in the stack, red", and `kalfa/github/README.md:105` says the missing cause is on purpose. The
ticket's third box says every class does the same. The owner ruling the ticket quotes names `<Package>Unavailable`
errors, and `GitHubError` is not one. What would settle it: the owner's answer to the one open question.

```ts
// The whole idea, as Effect's own SqlError writes it (node_modules/effect/src/sql/SqlError.ts:441).
export class GitUnavailable extends Schema.TaggedError<GitUnavailable, { readonly brand: unique symbol }>()(
  "GitUnavailable",
  { reason: Schema.Union([NotStarted, Exited, Unreadable, GitTooOld]) },
) {
  override readonly cause = this.reason; // new: a printed error and a span's exception now show the reason under it
}
// And a lint rule, fabrika/inner-cause, refuses a kalfa error class that holds a failure in a field and has no cause.
```

**Lead amendment (2026-11-27), after review:** the disable comment on `GitHubError` is replaced by a config allowance, `"fabrika/inner-cause": ["error", { "allow": { "kalfa/github/src/GitHub.ts": ["GitHubError"] } }]` in `.oxlintrc.json`, read by the rule the way `reflect-disables.ts` reads its `allow`. A disable comment would name the plugin and trip the approved law P2. Where this plan says "disable comment" for `GitHubError`, read the allowance: L4's census is 0 fires with no disable comment, and `GitHub.ts` does not change.

## What changes, in one paragraph

A `Schema.TaggedError` passes a field named `cause` to the JavaScript `Error` constructor
(`node_modules/effect/src/internal/core.ts:693`), and Effect's printer follows `error.cause` and nothing else
(`node_modules/effect/src/internal/effect.ts:355-358`). A wrapper that holds its inner failure in `reason` and has no
`cause` prints as its tag alone, and so does a span's recorded exception, which `OtlpTracer` builds from the same printer
(`node_modules/effect/src/observability/OtlpTracer.ts:339-366`). Two kalfa wrappers have that gap: `GitUnavailable`
(`kalfa/git/src/Repository.ts:295`) and `SecretsUnavailable` (`kalfa/secrets/src/Errors.ts:58`). Each gets
`override readonly cause = this.reason`. The Ledger's model wrapper for a refusal, `ChatRefused`
(`kalfa/ledger/src/Ledger.test-support.ts:501`), gets the same line, and the Ledger README says both wrappers carry it.
A new lint rule, `fabrika/inner-cause`, holds every kalfa product error class to it. `TomlError` already has a `cause`
field and passes. `GitHubError` keeps no cause, by its own approved law, under a disable comment that says why.

## Searched first

- The ticket, https://github.com/kamp-us/tea-fabrika/issues/2018: the owner ruled on 2026-11-22 (ask R1b) that every
  `<Package>Unavailable` error sets its JavaScript cause from its reason, as Effect's own errors do. The ruling lives only
  in the ticket and in two plans that quote it (`.kalfa/quests/kalfa-permissions-guard-PLAN.md:339`,
  `.kalfa/quests/kalfa-ledger-append-PLAN.md:292`). No decision file holds it.
- `rg -il` over `.kalfa/decisions .kalfa/glossary .kalfa/patterns .kalfa/runbooks` for "cause", "Unavailable",
  "this.reason" and "reason union": the one pattern that governs is `.kalfa/patterns/effect-errors-keep-their-cause.md`
  (keep the cause; a family of cases is one error whose `reason` is a union of tagged errors). It says nothing of a
  wrapper's JavaScript cause, and its "Holds it" says no check holds a dropped cause. Decision 0063 (every kalfa package
  traces every step) is why the span's exception matters. No decision speaks against a wrapper's cause.
- `kalfa/ledger/README.md:66-67` already prescribes `class ChatUnavailable { reason: Failure }` with
  `override readonly cause = this.reason`, and `kalfa/ledger/src/Errors.test.ts:220-235` pins it.
- `kalfa/github/README.md:105` and the approved law C9 make `GitHubError`'s missing cause deliberate, for secrecy.
- `kalfa/git/README.md:353` says the package "puts no message, name, email, path, line or file content in a span", and
  `kalfa/git/src/Repository.ts:458` says the narrower "no message, name, email or path is ever an attribute". See
  "Calls" for what this plan does with that.
- Every kalfa error class in product files, read by hand (25 files hold one; the list is in "Laws", the census row).
  The ones that hold another error in a field: `GitUnavailable`, `SecretsUnavailable`, `GitHubError` and `TomlError`.
  Every other `reason` field in kalfa is a `Schema.Literals` or a `Schema.String`.

## How others do it

- **Effect 4.1.3, read in `node_modules/effect/src`.** Two forms. A wrapper whose reason is itself the inner failure
  sets `override readonly cause = this.reason`: `sql/SqlError.ts:441`, `ai/AiError.ts:1689`, `ai/McpClientError.ts:306`,
  `graphql/GraphQLClientError.ts:476`. A wrapper whose reason holds a lower cause passes that one up instead:
  `PlatformError.ts:167-168` and `socket/Socket.ts:541-545` (`super({ ...props, cause: props.reason.cause })`),
  `crypto/CryptoError.ts:219`, `jose/JoseError.ts:306`. The ruling picks the first form; it keeps the reason's own tag in
  the chain, which the second form loses for a reason with no cause (`Exited`, `GitTooOld`). Effect's guide example
  `ai-docs/src/01_effect/04_errors/20_reason-errors.ts` writes `AiError` without the line, but the shipped `AiError`
  has it.
- **JavaScript.** `Error.prototype.cause` (ES2022, the TC39 error-cause proposal) is the one field every printer
  follows: Node's `util.inspect` prints `[cause]:`, and Effect's `Cause.pretty` does the same. Not fetched; known.
- **Java.** A chained exception (`new Exception(msg, cause)`) prints each link as `Caused by:`. Not fetched; known.
- **Erlang/OTP.** An error is `{error, Reason}`, and a wrapper nests the inner reason inside its own term, so a crash
  report prints the whole chain because the reason is the chain. Effect's `reason` field is that term; the `cause` line
  is what makes JavaScript's printers see it. Not fetched; known.
- **Elm.** Errors are values in a union (`Http.Error`), and nothing prints a chain on its own. No answer for printing.
- **Lint prior art.** ESLint's `preserve-caught-error`, which oxlint 1.90.0 ships
  (`node_modules/oxlint/configuration_schema.json:6258`), asks for `{ cause }` when code throws a new error inside a
  `catch`. Our errors are classes made from data, never thrown in a `catch`, so it cannot see this shape. Effect's
  checker (`@effect/tsgo` 0.63.0) has no check on an error's cause; its binary names none.

## The shape

The product change is one line in each wrapper, typed as the reason. A sketch of each:

```ts
// kalfa/git/src/Repository.ts:295. The type of `cause` is the reason's union, so `error.cause._tag` reads without a cast.
export class GitUnavailable extends Schema.TaggedError<GitUnavailable, { readonly brand: unique symbol }>()(
  "GitUnavailable",
  { reason: Schema.Union([NotStarted, Exited, Unreadable, GitTooOld]) },
) {
  override readonly cause = this.reason;
}

// kalfa/secrets/src/Errors.ts:58. The reason's own cause is a Hidden.Cause, so the chain ends at "<redacted>".
export class SecretsUnavailable extends Schema.TaggedError<SecretsUnavailable, { readonly brand: unique symbol }>()(
  "SecretsUnavailable",
  { secret: Name.SecretName, store: Name.StoreId, reason: Schema.Union([StoreFailed, RecordFailed]) },
) {
  override readonly cause = this.reason;
}

// kalfa/ledger/src/Ledger.test-support.ts:501, the model a package above copies for a refusal.
export class ChatRefused extends Schema.TaggedError<ChatRefused, { readonly brand: unique symbol }>()("ChatRefused", {
  reason: Errors.Refusal,
}) {
  override readonly cause = this.reason;
}

// kalfa/github/src/GitHub.ts:293: no change but the comment.
// oxlint-disable-next-line fabrika/inner-cause -- a failed span renders only message and cause, so nothing under reason (GitHub's text, the input) reaches a trace; law C9
export class GitHubError extends Schema.TaggedError<GitHubError, { readonly brand: unique symbol }>()("GitHubError", {
```

What the line does and does not change, from a tryout on the installed Effect
(`t2018-tryout.mjs` in the plan writer's scratch folder, not committed):

| Reading | Before | After |
|---|---|---|
| `Cause.pretty(Cause.fail(e))` | `GitUnavailable:` and nothing under it | `GitUnavailable:` then `[cause]: NotStarted:` then `[cause]: Error: <the spawn error>` |
| `Cause.prettyErrors(c, { includeCauseInStack: true })[0].stack`, what `OtlpTracer` exports | the tag alone | the same chain |
| `Schema.encodeSync(GitUnavailable)(e)` | `{ _tag, reason }` | `{ _tag, reason }`: `cause` is no schema field |
| `Schema.decodeUnknownSync(GitUnavailable)(...)` | an error with no cause | `cause` is the decoded reason (`toBe`) |
| `Object.keys(e)` and `JSON.stringify(e)` | `_tag`, `reason` | `_tag`, `reason`, `cause`: the reason twice |
| `Equal.equals` of two equal errors | true | true |
| a reason whose cause is a `Redacted` | hidden | still hidden: the printer writes `<redacted>` |

### The rule, `fabrika/inner-cause` (a sketch of what it reads)

An error class is what `fabrika/hidden-cause` already calls one: a class that extends `<S>.TaggedError<...>()(tag,
fields)` or `<S>.Error<...>(id)(fields)`, `<S>` being Effect's `Schema` in any spelling, resolved through the file's
scope, or a same-file `const` that holds that call. Its fields are the object literal or a same-file `const`, spreads
followed.

```ts
// A sketch. A field holds a failure when its schema, followed through same-file consts and through Schema's
// optional, optionalKey, NullOr, UndefinedOr, NullishOr, Array, NonEmptyArray and Union, reaches any of:
type Failure =
  | { readonly _tag: "ErrorClass" } // (a) a same-file class that is itself an error class: `reason: Inner`
  | { readonly _tag: "Defect" }     // (f) `Schema.Defect()` under a key that is not `cause`: `error: Schema.Defect()`
  | { readonly _tag: "Imported" };  // (e) under the key `reason` only: a name imported from a module that is not
                                    //     Effect's (`reason: Errors.Failure`, `reason: Failure`). By the pattern,
                                    //     a non-literal `reason` is a union of tagged errors.

// The class carries its cause when either holds:
//   (j) its fields have a `cause` key (hidden-cause checks that key's form), or
//   (i) its body has a non-static property `cause` whose value is exactly `this.<k>`, `k` a field that holds a failure.
// Otherwise it is reported once, at the class name:
const MESSAGE =
  "This error holds a failure in `<key>` and has no cause, so a printed error and a span's exception drop it. " +
  "Add `override readonly cause = this.<key>;`, as Effect's SqlError does (oxlint-plugins/inner-cause.ts, ticket 2018).";
// Passes: (k) `reason: Schema.Literals([...])`, `reason: Schema.String`, a union of `Schema.TaggedStruct`s, an imported
// schema under any key but `reason` (`url: Remote.Url`); (l) a class that is no error class (`Schema.Class`).
// Fires on the wrong form too: (m) `override readonly cause = undefined`, `= this.other`, or a `get cause()`.
// Misses: a failure behind a helper call, fields imported from another file, an imported error under a key that is not
// `reason`, a constructor that passes `cause` to `super` (SocketError's form), and anything outside kalfa's product files.
```

The class detection and the resolution helpers move out of `oxlint-plugins/hidden-cause.ts` into a new
`oxlint-plugins/error-class.ts`, a function of the rule's `context` that returns them (`isSchema`, `schemaCall`,
`resolved`, `followed`, `classBase`, `properties`, `fieldsOf`, `written`). Both rules use it, so one copy says what an
error class is. `hidden-cause.test.ts` runs unchanged to show the move kept that rule.

## One value traced

A repository call whose git binary cannot start, from the stand-in spawner to the span:

1. `ProcessRepository.ts:106`: the spawner fails with a `PlatformError` whose message is
   `NotFound: ChildProcess.spawn (git --no-replace-objects --git-dir=<path> ...)` (Effect's
   `@effect/platform-node-shared/src/NodeChildProcessSpawner.ts:70-79` writes the command line in).
2. `mapError` makes `new NotStarted({ cause })`; the `cause` field becomes the native cause.
3. `unavailable` makes `new GitUnavailable({ reason })`; the new line sets `cause` to that same `NotStarted`.
4. The call's span `git.<call>` ends with that failure. `OtlpTracer` calls `Cause.prettyErrors(exit.cause,
   { includeCauseInStack: true })` and exports one `exception` event whose `exception.stacktrace` now reads
   `GitUnavailable:` / `[cause]: NotStarted:` / `[cause]: PlatformError: NotFound: ChildProcess.spawn (...)`.
5. Before this plan, step 4 exported `GitUnavailable:` and nothing else, and step 3 had no cause to follow.
6. `Schema.toCodecJson(GitUnavailable)` still writes `{ _tag: "GitUnavailable", reason: { _tag: "NotStarted", cause } }`:
   the wire did not change.

## Generators

The product laws draw:

- (p) `NotStarted` over an `Error` whose message is drawn text.
- (q) `Unreadable` over an `Error` whose message is a drawn problem text.
- (r) `Exited` with a drawn code and stderr: a reason with no cause of its own.
- (s) `GitTooOld` with drawn versions: the other reason with no cause.
- (t) `SecretsUnavailable` over `StoreFailed` and over `RecordFailed`, each holding a `Hidden.Cause` that quotes a drawn
  secret word, in each form the package's `causeClasses` makes.

The rule's generated files (as `hidden-cause.test.ts` builds them) draw one import spelling of `Schema` and one to six
pieces, one per line:

- (a) a field that names a same-file error class.
- (b) a field that is a `Schema.Union` of same-file error classes.
- (c) the same inside `Schema.optional` or `Schema.NullOr`.
- (d) the same behind a same-file `const`.
- (e) `reason` holding an imported name: a namespace member and a named import.
- (f) `Schema.Defect()` under a key that is not `cause`.
- (g) a renamed or namespace import of `Schema`, and a local object named `Schema` that is not Effect's.
- (h) a class that extends a same-file `const` holding the `TaggedError` call.
- (i) a class with `override readonly cause = this.<k>`: passes.
- (j) a class with a `cause` field: passes.
- (k) `reason: Schema.Literals`, `reason: Schema.String`, a `Schema.TaggedStruct` union, and `url: Remote.Url`: pass.
- (l) a `Schema.Class` with a field that names an error class: passes.
- (m) a `cause` member of the wrong form: `= undefined`, `= this.<a field that holds no failure>`, a getter.

The real lint runs plant bodies at:

- (n) kalfa product paths: `kalfa/git/src/Case.ts`, `kalfa/secrets/src/Case.ts`, a `*Test.ts` shared suite.
- (o) paths the rule leaves out: a kalfa `*.test.ts`, a kalfa `*.test-support.ts`, a `next/` file.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| U1, the git wrapper's cause: for each of (p), (q), (r) and (s), `new GitUnavailable({ reason })`'s `cause` is the reason (`toBe`); `Cause.pretty(Cause.fail(error))` holds `[cause]: <reason tag>`, and for (p) and (q) the drawn message; under a recording tracer, `Effect.fail(error)` inside `Effect.withSpan` ends one span whose failure, through `Cause.prettyErrors(exit.cause, { includeCauseInStack: true })`, has a `stack` that holds the same; `Schema.toCodecJson(GitUnavailable)` writes exactly the keys `_tag` and `reason`. 100 runs | test | Effect Arbitrary: reasons | drop the line: every case red; write `cause = this.reason.cause` (SocketError's form): (r) and (s) red, `toBe` fails; make `cause` a schema field: the key check red; print only the reason's tag and not its cause: (p) and (q) red | kalfa/git/src/Unavailable.test.ts |
| U2, the type: `GitUnavailable["cause"]` is exactly `NotStarted \| Exited \| Unreadable \| GitTooOld`, so `error.cause._tag` compiles without a cast | type | type | type the line `override readonly cause: unknown = this.reason`: the exact-type check fails, tsc red | kalfa/git/src/Repository.types.test.ts |
| U3, a real call's span: a `ProcessRepository` call on the stand-in spawner that fails to start (P2's "a spawn that fails") ends its `git.<call>` span with a failure whose exported stack holds `NotStarted` and the spawner's own message | test | scenario: the stand-in spawner's start failure, one fixed message | drop the line: red; let the adapter close the span before the failure: red | kalfa/git/src/ProcessRepository.test.ts |
| S5 [secrets], the secrets wrapper's cause: for (t), `SecretsUnavailable`'s `cause` is its reason (`toBe`); `Cause.pretty` and the exported span stack hold `StoreFailed` or `RecordFailed` and `<redacted>`, and no form of the drawn secret (raw, JSON-escaped, base64, base64url, hex, percent-encoded) shows in them, in `JSON.stringify(error)` or in any text the package's leak search reaches; S1's exact JSON keys stay as they are. 300 runs | test | Effect Arbitrary: causes | drop the line: the tag check red; write `cause = Redacted.value(this.reason.cause)`: the secret shows, (t) red; make `cause` a schema field: S1 red | kalfa/secrets/src/Errors.test.ts |
| R1, the refusal model: `ChatRefused`'s `cause` is its refusal (`toBe`) for each of the five refusals, and `Cause.pretty` holds the refusal's tag | test | Effect Arbitrary: refusals | drop the line from the test support: red | kalfa/ledger/src/Errors.test.ts |
| C9, kept: `GitHubError` has no `cause` of its reason, so nothing under its reason reaches a span | test | Effect Arbitrary: markers | give `GitHubError` `cause = this.reason`: the undecodable value shows in the stack, red (the approved plant, unchanged) | kalfa/github/src/GitHub.test.ts |
| L1, the rule reports exactly what it should: a generated file of one spelling (g) and one to six pieces from (a) to (f), (h) and (m), which fire, and (i) to (l), which pass, one per line, at a `Case` module in a kalfa `src` folder; `RuleTester` reports exactly the firing lines with the message, and the file with them taken out is valid. 400 runs, seed 119120 | test | fc.record: generated files | read only `Union` members, never a field's own value: (a) red; read only a field's own value, never inside `Union`: (b) red; do not unwrap `optional`: (c) red; read no same-file `const`: (d) red; count only same-file classes: (e) red; leave `Defect` out: (f) red; match the text `Schema.`: (g) red on a renamed import and on the local `Schema`; read only a direct call: (h) red; read only the fields for a cause: (i) fires, red; read only the body: (j) fires, red; count any `reason` as a failure: (k) red; count any imported name under any key: (k) red on `url: Remote.Url`; fire on any class: (l) red; accept any `cause` member: (m) red | oxlint-plugins/inner-cause.test.ts |
| L2, one real lint run per path kind, with the repo's config: a body that holds a failure in `reason` and no cause fires once at (n) and nowhere at (o) | lint | scenario: the real config is the subject, one fixed body per path kind | leave test support in the override: (o) red; scope the override to one package: (n) red at the other | oxlint-plugins/inner-cause.test.ts |
| L3, the rule is planted: `inner-cause` is in `plants.test.ts`'s list of rules planted in their own file | test | scenario: the plugin's rule list at head | drop the entry: the missing-plant law is red | oxlint-plugins/plants.test.ts |
| L4, the census: `pnpm lint` on the tree after the build reports no `inner-cause` finding, and the one disable comment is on `GitHubError`'s class line with a reason; before the build the same run reports exactly `GitUnavailable` and `SecretsUnavailable` plus `GitHubError` | lint | scenario: the whole kalfa tree at head, the ticket's "a search finds none left" | remove the line from `GitUnavailable`: one finding, red; remove the disable comment: one finding, red | .oxlintrc.json |
| H1, the move: `hidden-cause.test.ts`'s laws pass unchanged after the helpers move to `error-class.ts` | test | scenario: hidden-cause's own laws at head | keep a stale copy in `hidden-cause.ts` that no longer reads same-file consts: its (c) red | oxlint-plugins/hidden-cause.test.ts |

No law is host-only: every one runs on a stand-in or on oxlint in process, on each pull request.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/git/src/Repository.ts | build | 2 | `override readonly cause = this.reason;` in `GitUnavailable`, and its doc block says the reason is also the cause |
| kalfa/secrets/src/Errors.ts | build | 2 | the same line in `SecretsUnavailable`, and its doc block |
| kalfa/github/src/GitHub.ts | build | 1 | the disable comment on `GitHubError`'s class line, with its reason |
| kalfa/git/README.md | build | docs | "What it never does" (line 353): no message, name, email, path, line or file content is a span attribute; a failed span's exception carries the reason chain, and a git that cannot start names the command it was given, the repository path included |
| kalfa/secrets/README.md | build | docs | `SecretsUnavailable`'s cause is its reason, and the chain ends at `<redacted>` |
| kalfa/ledger/README.md | build | docs | lines 66-67: both `ChatUnavailable` and `ChatRefused` carry `override readonly cause = this.reason` |
| kalfa/github/README.md | build | docs | line 105: the rule is off on `GitHubError` for this reason |
| .kalfa/patterns/effect-errors-keep-their-cause.md | build | docs | a rule: a wrapper's cause is its reason (`override readonly cause = this.reason`), with Effect's lines and ticket 2018's ruling; "Holds it" names `fabrika/inner-cause` for kalfa; the `GitHubError` exception |
| kalfa/ledger/src/Ledger.test-support.ts | tests | tests | `ChatRefused` gains the line |
| kalfa/git/src/Unavailable.test.ts | tests | tests | new: U1, and its reasons generator |
| kalfa/git/src/Repository.types.test.ts | tests | tests | U2 |
| kalfa/git/src/ProcessRepository.test.ts | tests | tests | U3, appended beside P2's stand-in |
| kalfa/secrets/src/Errors.test.ts | tests | tests | S5 |
| kalfa/ledger/src/Errors.test.ts | tests | tests | R1 |
| kalfa/github/src/GitHub.test.ts | tests | tests | no change: C9 is run to show it holds |
| oxlint-plugins/error-class.ts | tests | tests | new: the error-class helpers, moved from `hidden-cause.ts` (about 150 lines moved, few new). A lint rule is the exam, so the tests step writes it |
| oxlint-plugins/hidden-cause.ts | tests | tests | imports the helpers from `error-class.ts`; its comment is unchanged in meaning |
| oxlint-plugins/hidden-cause.test.ts | tests | tests | no change: H1 runs it |
| kalfa/secrets/src/Secrets.test-support.ts | tests | tests | no change expected: S5 reuses `causeClasses` and the word's forms |
| oxlint-plugins/inner-cause.ts | tests | tests | new: the rule (about 120 lines) and its opening comment (what counts, what passes, what it misses) |
| oxlint-plugins/inner-cause.test.ts | tests | tests | new: L1, L2 |
| oxlint-plugins/index.ts | tests | tests | registers `inner-cause` |
| oxlint-plugins/plants.test.ts | tests | tests | L3 |
| oxlint-plugins/README.md | tests | tests | a section: the rule, the tools looked at first, and the first-day count from one real run |
| .oxlintrc.json | tests | tests | one override beside hidden-cause's (`.oxlintrc.json:1548-1555`): `kalfa/**`, tests and test support left out, `fabrika/inner-cause` as error |

## Existing tools

- `oxlint-plugins/error-class.ts`: searched every lint plugin source file beside it for `TaggedError` (11 files) and `match.ts`'s
  exports. Only `hidden-cause.ts` resolves an error class's fields through scope; `no-data-taggederror.ts` matches only the
  `extends`. The helpers are moved out of `hidden-cause.ts`, not written again.
- `oxlint-plugins/inner-cause.ts`: searched oxlint 1.90.0's rules (`preserve-caught-error` is for a throw inside a
  `catch`), oxlint's `no-restricted-syntax` (oxlint has none), Effect's checker `@effect/tsgo` 0.63.0 (no cause check)
  and npm for an Effect error-cause lint rule (none known; not fetched). None sees a class's fields and body together.
- The recording tracer for U1 and S5: `kalfa/github/src/GitHub.test.ts` already records spans with `Tracer.make` and
  `Effect.withTracer` for C9; the tests step reuses that way, and `Cause.prettyErrors(..., { includeCauseInStack: true })`
  as `OtlpTracer` calls it.
- The leak search for S5: `kalfa/secrets/src/Secrets.test-support.ts` (`causeClasses`, the word's forms). Reused.
- U3's failing spawner: P2's stand-in in `kalfa/git/src/ProcessRepository.test.ts`. Reused.

## Calls

- The line's form is `override readonly cause = this.reason`, not SocketError's `super({ ..., cause: reason.cause })`.
  The ruling names it, and it keeps the tag of a reason that has no cause (`Exited`, `GitTooOld`). 95%.
- Refusal wrappers carry the line too (`ChatRefused`). The ticket's third box says every class that carries an inner
  failure, a refusal is one, and printing `ChatRefused` alone says nothing of which refusal. 85%.
- `TomlError` stays as it is: it has a `cause` field set from the reason's cause (`kalfa/config/src/TomlParser.ts:28`),
  so its print already shows the inner failure, and the rule's (j) passes it. 90%.
- The rule counts an imported name as a failure only under the key `reason`. Without types, an import says nothing
  of what it is; the repo's pattern says a non-literal `reason` is a union of tagged errors, and this is exactly the
  next wrapper's shape (`PermissionsUnavailable { reason: Failure }` in the permissions plan). Day-one false alarms by
  reading: 0 of 3 fires. 80%: an imported literal schema under `reason` would fire; none exists.
- The rule reads kalfa's product files only, as `hidden-cause` does. `next/` has the same gap (Findings) and its own
  pattern; the ticket scopes kalfa. 85%.
- The helpers move to `oxlint-plugins/error-class.ts` rather than being copied, so two rules cannot disagree on what an
  error class is. The cost is a refactor of a landed rule, which its own laws guard. 80%.
- The git README's sentence is narrowed to attributes. The ruling names `GitUnavailable`, and its point is that the
  span's exception shows the inner failure; for a git that cannot start, that failure names the command line, the
  `--git-dir=<path>` included. The command carries no environment and no secret (the spawner writes only the command and
  its arguments; commit messages go on stdin). `Repository.ts:458` already says "never an attribute". 80%: the owner may
  want paths out of exceptions too, which would mean a `NotStarted` cause made of the errno alone.
- The git laws go in a new `Unavailable.test.ts`, so they stay out of the files PR 2315 rewrites. 85%.

## Branches in flight

- **Git rebase, https://github.com/kamp-us/tea-fabrika/pull/2315.** It adds `CannotRebase { reason: Schema.Literals([...]) }`
  to `kalfa/git/src/Repository.ts` at about line 236, and edits `kalfa/git/README.md` at lines 107-114 and 350-353,
  `ProcessRepository.test.ts` and `Repository.types.test.ts`. Overlaps: `Repository.ts` (its hunk ends about 60 lines
  above `GitUnavailable`, so git merges it), the README's line 353 (both change the "What it never does" paragraph: a
  one-line conflict), and the two test files (different laws, appended). `CannotRebase` holds a literal `reason`, so the
  rule passes it, and (k) draws that form. Order: none needed. If 2315 is in the merge queue when this build starts,
  the build starts after it lands; else whichever lands second merges main and rewrites the one README sentence.
- **Quality vitest, https://github.com/kamp-us/tea-fabrika/pull/2366.** It adds override blocks to `.oxlintrc.json` at
  about line 3941; this plan adds one at line 1555, beside hidden-cause's, so the hunks do not touch. Its new error
  classes (`LoadFailed`, `Full`, `TestDatabaseError`) hold no failure but a `cause` field, so the rule passes them
  whichever lands first. Order: none.
- **Git fetch plan, https://github.com/kamp-us/tea-fabrika/pull/2365.** A plan file only. Its sketched errors
  (`NoSuchRemote`, `BadRemoteUrl` with a literal `reason`, `FetchFailed`, `NoCredential`) hold no failure, so the rule
  passes them; any wrapper it adds later writes the line, and the rule tells its build if not. Order: none.

## Validation

- tests step: write the rule, the helpers' move, the config and the laws, then
  `nice -n 15 pnpm exec vitest run oxlint-plugins/inner-cause.test.ts oxlint-plugins/hidden-cause.test.ts oxlint-plugins/plants.test.ts kalfa/git/src/Unavailable.test.ts kalfa/git/src/ProcessRepository.test.ts kalfa/secrets/src/Errors.test.ts kalfa/ledger/src/Errors.test.ts kalfa/github/src/GitHub.test.ts`:
  L1 to L3, H1 and C9 green; U1, U3 and S5 red on the missing line; R1 green, since the tests step owns the test
  support line (its plant is tried by hand and undone). `pnpm lint` shows the rule's first-day fires, which go in the
  README: by this plan's reading, 3 (`kalfa/git/src/Repository.ts:295`, `kalfa/secrets/src/Errors.ts:58`,
  `kalfa/github/src/GitHub.ts:293`), all real. Each plant is tried by hand, seen red and undone.
- build step: the same files green, `pnpm lint` with 0 fires of the rule, then `pnpm format`.
- The lead runs `pnpm typecheck` (U2) and the `--changed` run.

## Size

1. Slice 1, the whole ticket: 5 lines of product code (`Repository.ts` 2, `Errors.ts` 2, `GitHub.ts` 1), four README
   edits and the pattern line, plus the exam's part, which the tests step writes: the rule (about 120 lines), the moved
   helpers (about 150 lines moved), the config (about 8) and the laws. It lands whole: the rule and the fixes must land
   together, or main's lint is red.

About 3 agent hours, 80% sure: the rule's generated-file law in the tests step is the long part, and the helpers' move
can surprise. The steps are tests, build and review, plus one likely send-back (a generator class or the census). The
tests and build steps run on Sonnet at about $8 and $4, the review on Opus at about $10, the send-back about $8, at list
price.

Estimate: 4 steps, $30

## New names

- `fabrika/inner-cause`: the lint rule, named for what it holds, an inner failure as the cause.
- `error-class.ts`: the helpers' module, named for what it finds.
- `Unavailable.test.ts`: the git laws' file, named for the class it tests.
- No new domain word: "cause" and "reason" are Effect's, and no glossary changes.

## Records

- `.kalfa/patterns/effect-errors-keep-their-cause.md` gains the wrapper rule and the lint rule, in the build. That is
  where the owner's ruling from the ticket lands, so it no longer lives only in a ticket.
- The four READMEs above, and `oxlint-plugins/README.md`'s section with the first-day count.
- No new decision: the ruling is a code shape that a pattern and a lint rule hold. If the owner answers the open
  question with "give `GitHubError` a cause too", that changes C9's approved law, and the lead records it with the adr
  skill.

## Is it a setting?

- The rule's scope: it is the config's already (`.oxlintrc.json`'s `files`), as every rule's is.
- The rule's severity: no. It is error, as every rule here that holds a shape.
- Which Schema combinators the rule looks through: no. It is what Effect's Schema is, not a choice a repo makes.

## What fact is lost if not recorded now

- The first-day count of the rule, which only a run on today's tree, before the build, can give.
- That Effect's printer follows only `cause` (`internal/effect.ts:355`), so a `reason` alone never prints. The rule's
  comment and the pattern keep it, so the next wrapper does not re-learn it from a span that says nothing.
- The ruling's date and wording, which today sit only in the ticket.

## What this cannot tell us

- Whether the owner wants `GitHubError` to keep no cause (the open question). A yes keeps C9; a no needs a new design
  for a cause that holds no value, and C9's plant changes.
- Whether a git spawn failure's command line, now in a span's exception, is something the owner wants kept out. The
  plan takes it as fine (Calls, 80%).
- Exporters other than Effect's `OtlpTracer`: none is installed in kalfa, so the laws read the exception as
  `OtlpTracer` builds it, not as any other tracer would.
- The rule reads one file. A failure behind a helper call, fields from another file, an imported error under a key
  that is not `reason`, and SocketError's constructor form are not seen.
- `Exited` and `GitTooOld` have no message, so the print shows their tag and not their fields (`stderr`, `found`). A
  message getter like `SqlError`'s would show more; this ticket does not ask for it (Findings).
- `next/` keeps the gap (Findings).

## Open questions

1. `GitHubError` keeps no cause (rule off on its line, law C9 stays)? Lean yes, 80%: C9 is an approved secrecy law, its
   reason holds GitHub's text and the caller's input, and the ruling names `<Package>Unavailable` errors only.

## Findings

- `next/` has wrappers with the same gap, which this rule does not reach: `GatewayError`
  (`next/packages/libfabrika/src/gateway/GatewayError.ts:44-47`, `reason: Schema.Union([Storage, BadRow, Crypto])`),
  `LedgerStreamsError` (`next/packages/libfabrika/src/ledger/LedgerStreams.ts:30-31`) and `RepositoriesError`
  (`next/packages/libfabrika/src/repositories/Repositories.ts:115-118`). `rg "override readonly cause" next` finds no
  hit. Proof: the files at `4ea3051ee`.
- `GitUnavailable` and `SecretsUnavailable` have an empty `message`, so a print reads `GitUnavailable:` with nothing
  after the colon. Effect's `PlatformError` and `SqlError` derive `message` from the reason
  (`node_modules/effect/src/PlatformError.ts:185-187`), and the permissions plan does the same for
  `PermissionsUnavailable`. Proof: the tryout's `message= ""`.

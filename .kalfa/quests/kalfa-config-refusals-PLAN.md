Approved by the lead agent, builds issues 1749, 1995; body 8889a7c18a08
Plancheck-Version: 3

# Plan: the invalid and read refusals say why (ticket 1995)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1995, found by the review of
https://github.com/kamp-us/tea-fabrika/pull/1922 (issue 1839), under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749). Words: `kalfa/config/GLOSSARY.md`,
unchanged.

Two refusals of the root entry (`@kalfa/config`, `SettingGroup`) say too little. An `invalid` refusal of a setting whose
schema has no title and no description says only "is not a valid value." A `read` refusal says only "could not be
read." This plan makes the first name the rule the value broke, from the declared parts of the schema, and the second
name the reason the read failed, from the failure's kind. Neither ever holds the value, a secret or a home path. On the
way it carries three lessons the brief names: the error's cause becomes a `Redacted`, so no rendering shows a path the
platform put in it; every refusal leaves a span, which adds one span to `SettingGroup.edit`; and the leak law reads
every rendering. One pull request, about 110 product lines.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
const port = Setting.make("net.port", Schema.Number.check(Schema.isGreaterThan(1023)))   // no title, no description

// .demo/demo.toml, line 2:  port = 80        (under [net])
// today:  .demo/demo.toml, line 2: net.port is not a valid value.
//           demo did not start.
// after:  .demo/demo.toml, line 2: net.port is not a valid value. Expected a value greater than 1023.
//           demo did not start.

// ~/.demo/demo.toml is mode 000, so Node fails with EACCES
// today:  ~/.demo/demo.toml: could not be read.
//           demo did not start.
//         and Cause.pretty prints "PermissionDenied: FileSystem.readFileString (/people/ana/.demo/demo.toml)"
// after:  ~/.demo/demo.toml: could not be read, because permission was denied (EACCES).
//           demo did not start.
//         and the cause is Redacted: Cause.pretty prints "<redacted>" where the path was

// error.cause : Redacted.Redacted<unknown> | undefined      (was: unknown)
```

## Calls under 80%, read these first

- **`SettingGroup.edit` gets a span, `config.edit` (75%).** The brief's lesson is that every refusal leaves a span, and
  decision 0063 says every kalfa package traces every step. Today `edit(group, text, file).set` and `.remove` run in
  no span, so an `invalid` refusal of an edit leaves none. Each call gets `config.edit` with `kalfa.config.app`,
  `kalfa.config.setting` and `kalfa.config.file`, the attributes `config.set` already has. The doubt: it is a new span
  name on a call that does no I/O, and the ticket does not ask for it. What it costs: about 8 lines in
  `kalfa/config/src/SettingGroup.ts` and the `config.edit` row of RF6. It is separable: striking it removes those
  lines and that one row.
- **A refused member of a record- or table-valued setting in a file may read as `unknown` today (70%).** In
  `explain` (`kalfa/config/src/internal/check.ts`), a setting is matched to the issue's path only when the path is
  exactly the setting's name (`same(segments(s.name), path)`), and `under` fails for a path longer than the name. A
  record member's issue has the longer path (`net.rules.<key>`), so by reading it falls to the `unknown` branch and
  names the record's own key, which RC8 treats as private. I did not run it. RF1's class (i) settles it on the branch
  head: if (i) is red there for this reason, the build makes `explain` match the setting whose name begins the path; if
  it is green, that part of the build is empty.
- **The words of each reason (80%).** The texts below are mine. They follow the Unix and Erlang way of naming the POSIX
  code beside a plain sentence. A reviewer may reword them; the laws pin them exactly, so a reword is one edit to the
  law's table and the product's table.

## How others do it

Read, unless marked "from memory".

- **Erlang/OTP (from memory).** `file:read_file/1` answers `{error, Reason}`, where `Reason` is a POSIX atom such as
  `eacces`, `eisdir` or `enotdir`, and `file:format_error/1` turns it into a sentence such as "permission denied". The
  reason is data with a fixed set of values, and the sentence is made from it. We do the same: a fixed set of reasons,
  one sentence each, and the POSIX code beside it.
- **git (from memory).** A config file it cannot open gives `fatal: unable to access '<absolute path>': Permission
  denied`: the reason comes from `strerror`. git prints the absolute path; we never do, since every name a person reads
  here is `.demo/demo.toml`, `~/.demo/demo.toml` or `$DEMO_HOME/demo.toml`.
- **Elm (from memory).** `Json.Decode.errorToString` names what was expected ("Expecting an INT") and quotes the value
  it got. We take the first half and refuse the second: a setting's value may be a secret's name or worse, and
  `SettingsError`'s own comment says a message never holds a value it refused.
- **Effect 4.1.3, read in `node_modules/effect/src/SchemaIssue.ts`.** The default formatter writes `Expected <type>`
  for an `InvalidType` and `Expected <check's expected>` for a failed check, then `, got <input>` whenever the issue
  holds its input (`getExpectedMessage`, `formatInput`). A filter that returns a string makes an `InvalidValue` whose
  `message` annotation is that string, written at run time, so it may quote the input (`FilterIssue`'s doc in
  `Schema.ts`). Built-in checks declare their text as `expected` (`makeIsGreaterThan` sets `expected: "a value greater
  than <bound>"`, from the bound, never the input). So the rule comes from declared annotations and the AST only.
- **Effect 4.1.3, read in `node_modules/effect/src/PlatformError.ts` and
  `@effect/platform-node-shared/src/internal/utils.ts`.** A file read fails with `PlatformError`, whose `reason` is a
  `BadArgument` or a `SystemError`. `handleErrnoException` maps `EACCES` and `EPERM` to `PermissionDenied`; `EISDIR`,
  `ENOTDIR` and `ELOOP` to `BadResource`; `EEXIST` to `AlreadyExists`; `EBUSY` to `Busy`; and everything else to
  `Unknown`. It keeps the Node error as `cause`, whose `code` is the POSIX name, and puts the absolute path in
  `pathOrDescriptor`. `SystemError.message` prints that path. So the reason comes from `_tag` and `code`, and the
  cause must be hidden.
- **Effect 4.1.3, read in `node_modules/effect/src/ConfigProvider.ts`.** A provider fails with `SourceError`, whose
  `message` is the provider's own text. A provider that reads a secret store may put anything there, so it is never
  quoted.
- **This repo, `kalfa/secrets/src/Errors.ts`.** Every failure that wraps a cause holds it as
  `Schema.Redacted(Schema.Defect())`, "a cause may quote a value", read on purpose with `Redacted.value`. Same shape
  here. `kalfa/config/src/Snapshot.ts` (an older entry) already does it for `SnapshotError`.

## The shape

### The cause is hidden

```ts
// Sketch: kalfa/config/src/internal/error.ts
export class SettingsError extends Schema.TaggedError<SettingsError, { readonly brand: unique symbol }>()(
  "SettingsError",
  {
    reason: Schema.Literals([/* the ten, unchanged */]),
    message: Schema.String,
    file: Schema.optional(Schema.String),
    line: Schema.optional(Schema.Int),
    cause: Schema.optional(Schema.Redacted(Schema.Defect())),   // was Schema.optional(Schema.Defect())
  },
) {}

// `stop` keeps its signature and hides what it is given: every SettingsError of the root entry is made here.
export const stop = (app, reason, text, position?, cause?: unknown, closing = `${app} did not start.`) =>
  new SettingsError({ reason, message: `${opening(position)}${text}\n  ${closing}`, file: position?.file,
    line: position?.line, cause: cause === undefined ? undefined : Redacted.make(cause) })
```

The `syntax` reason's cause (the TOML parser's error, which may quote the line) is hidden by the same change. Nothing
in the package reads `error.cause` of this class today (searched `kalfa/` for `.cause` on it; the only reads are
`String(error.cause)` in leak laws, which then print `<redacted>`).

### The read says why

```ts
// Sketch: kalfa/config/src/internal/error.ts
/** A POSIX error name, as Node gives it in `code`: `EACCES`, `EMFILE`. Anchored: nothing else in the code is printed. */
const POSIX = /^E[A-Z0-9]+$/u

/** Why a read failed, as the end of a sentence. It reads the failure's kind and its POSIX code, never its message, path or description. */
export const because = (cause: PlatformError.PlatformError | ConfigProvider.SourceError): string => {
  if (cause._tag === "SourceError") return "the environment did not answer"
  const { reason } = cause
  if (reason._tag === "BadArgument") return "its path is not valid"
  const code = reason.cause                                   // the Node error, unknown
  const named = Predicate.hasProperty(code, "code") && typeof code.code === "string" && POSIX.test(code.code)
    ? ` (${code.code})` : ""
  switch (reason._tag) {
    case "PermissionDenied": return `permission was denied${named}`
    case "BadResource":      return `it is not a plain file${named}`
    default:                 return `the system gave the error ${reason._tag}${named}`
  }
}
```

| Where | What it reads | Message, before the closing line |
|---|---|---|
| `contents` in `internal/place.ts` (the repo file, the user file, the disk calls' read) | `PlatformError` other than `NotFound` | `<file>: could not be read, because <why>.` |
| `lookup` in `internal/place.ts` (`<APP>_HOME`, then `HOME`) | `SourceError` | `<VAR> could not be read, because the environment did not answer.` |
| `holder` in `internal/read.ts` (does a source hold the setting) | `SourceError` | `<name> could not be read, because the environment did not answer.` |
| `resolve` in `internal/read.ts` (the value's read, a `ConfigError` whose cause is no `SchemaError`) | its `SourceError` | `<name> could not be read, because the environment did not answer.` |

`<why>` by kind: `PermissionDenied` is "permission was denied", `BadResource` is "it is not a plain file", any other
`SystemError` tag `T` is "the system gave the error T", and `BadArgument` is "its path is not valid". A POSIX code adds
` (CODE)` to the three system kinds. `NotFound` stays an empty file, as today. Only the provider can fail among the
sources: `Sources.file` is `ConfigProvider.fromUnknown` over a parsed document and a flag is `textSource`, neither of
which fails, so "the environment" is the true name of what did not answer.

### The invalid names a rule

```ts
// Sketch: kalfa/config/src/internal/check.ts
/** The type's text as Effect writes it in "Expected <type>", from an issue made fresh with no input, so no input can reach it. */
const expected = (ast: SchemaAST.AST): string => /* Effect's own text for new SchemaIssue.InvalidType(ast), without "Expected " */

/** What a refused value had to be, from the declared parts of its issue only: never the input, never a message a check wrote at run time, never a path inside the value. */
const rule = (issue: SchemaIssue.Issue): Option.Option<string> => {
  switch (issue._tag) {
    case "Filter":       return Option.fromNullishOr(stringAt(issue.filter.annotations, "expected"))  // declared on the check
    case "InvalidType":
    case "AnyOf":
    case "OneOf":        return Option.some(expected(issue.ast))
    case "Pointer":
    case "Encoding":     return rule(issue.issue)                     // the path is dropped
    case "Composite":    return rule(issue.issues[0])                 // the first, as the formatter reports it first
    case "MissingKey":   return Option.some("a table with every key it needs")
    case "UnexpectedKey":return Option.some("a table with no other keys")
    case "InvalidValue":                                              // its annotations are written at run time
    case "Forbidden":    return Option.none()
  }
}

/** What a setting's schema asks for, as a message says it, in place of the value it refused. */
const wanted = (s: Setting.Any, name: string, issue: SchemaIssue.Issue) => {
  const title = SchemaAST.resolveTitle(s.schema.ast)
  const description = SchemaAST.resolveDescription(s.schema.ast)
  const tail = description !== undefined ? ` ${description}`
    : Option.match(rule(issue), {
        onSome: (r) => ` Expected ${r}.`,
        onNone: () => (title === undefined ? " Its schema names no rule." : ""),
      })
  return `${name} is not ${title ?? "a valid value"}.${tail}`
}
// refused(app, s, origin, issue, closing?) and unfit(app, s, file, issue, closing) take the issue and pass it on.
```

| Title | Description | Message after `<name> is not ` |
|---|---|---|
| T | D | `T. D` (as today) |
| T | none | `T. Expected R.`, or `T.` when the issue gives no rule |
| none | D | `a valid value. D` (as today) |
| none | none | `a valid value. Expected R.`, or `a valid value. Its schema names no rule.` |

`resolveTitle` and `resolveDescription` read the last check's annotations when a schema has checks
(`internal/schema/annotations.ts`, `resolve`), so a description put on a check is the `D` above, as today.

Every site that makes an `invalid` refusal passes its issue:

| Site | Where the issue comes from |
|---|---|
| `explain` in `internal/check.ts` (a file at the start, the watcher, an edit's whole-text check) | the decode's issue, narrowed to the first issue |
| `resolve` in `internal/read.ts` (a variable or a flag) | `error.cause.issue`, in the branch where the cause is a `SchemaError` |
| `change.set` in `internal/change.ts` (`SettingGroup.edit` and the disk `set`) | today a `Schema.is` boolean; it becomes a decode of the schema's type side (`Schema.toType`), whose failure is the issue, then the JSON encode as today, whose failure is the issue |
| the `set` command in `kalfa/config/src/Cli.ts` | `error.cause.issue` of the `Config.schema` parse |

In `explain`, a setting matches when its name is the issue's path or begins it (the second call at the top), so a
refused member of a record-valued setting is `invalid` at the setting's own line, and its key is never named.

### The edit's span

```ts
// Sketch: kalfa/config/src/SettingGroup.ts, inside `edit`
const traced = (setting: Setting.Any) =>
  Effect.withSpan("config.edit", { attributes: {
    "kalfa.config.app": group.app, "kalfa.config.setting": setting.name, "kalfa.config.file": file } })
return {
  set: (setting, value) => change.set(read, toml, place, text, setting, value).pipe(traced(setting)),
  remove: (setting) => change.remove(read, toml, place, text, setting).pipe(traced(setting)),
}
```

No value goes in the span. The other refusals already end in a span: `config.layer` for a start, `config.set` and
`config.remove` for a disk call, and `config.get`, `config.set`, `config.remove` and `config.list` for the command.

### Doc comments and README

`SettingsError`'s comment says `cause` is hidden in a `Redacted` and read on purpose with `Redacted.value`, that a
`read` message says why, and that an `invalid` message names the rule. `edit`'s comment names its span. The README's
section on the start gains a short paragraph: what each of the two refusals says, with the two examples above.

## One value traced

The group `demo` with one setting, `net.port`, schema `Schema.Number.check(Schema.isGreaterThan(1023))`, no title and
no description. `HOME=/people/ana`. The repo configuration `.demo/demo.toml` holds `[net]` on line 1 and `port = 80`
on line 2. No variable, no flag.

1. `readRepo` reads `.demo/demo.toml`. No `demo-version`. `check` decodes the file against its derived struct. The
   decode fails: a `Pointer` to `net`, a `Pointer` to `port`, then a `Filter` whose `filter.annotations.expected` is
   `a value greater than 1023`, holding the input `80`.
2. `explain` finds the issue's path `net.port`, which is `net.port`'s own name, and calls `refused` with the origin
   `{ file: ".demo/demo.toml", line: 2 }` and the issue.
3. `wanted`: no title, no description. `rule` walks `Pointer`, `Pointer`, `Filter` and answers
   `a value greater than 1023`. The input `80` is never read.
4. The error: `reason: "invalid"`, `file: ".demo/demo.toml"`, `line: 2`, no cause, message
   `.demo/demo.toml, line 2: net.port is not a valid value. Expected a value greater than 1023.` and
   `  demo did not start.` The layer's span `config.layer` ends with this failure.

Now the user configuration `/people/ana/.demo/demo.toml` exists with mode 000 and the repo file is good. `contents`
calls `readFileString`; Node fails with `EACCES`; Effect makes `PlatformError(SystemError { _tag: "PermissionDenied",
pathOrDescriptor: "/people/ana/.demo/demo.toml", cause: <the Node error, code "EACCES"> })`. `because` reads the tag and
the code, which matches `POSIX`. The error: `reason: "read"`, `file: "~/.demo/demo.toml"`, no line, message
`~/.demo/demo.toml: could not be read, because permission was denied (EACCES).` and `  demo did not start.`, cause
`Redacted(<that PlatformError>)`. `Cause.pretty` prints the message and `<redacted>`; `/people/ana` appears nowhere.

## What fact is lost if it is not recorded now

None. A refusal writes nothing and keeps nothing. The cause is still kept, hidden, so code that must see it reads it
with `Redacted.value`.

## Generators

Classes the generated laws must reach. Each id is named in a Plant cell below.

Schema kinds, for an `invalid` refusal (RF1):

- (a) no title, no description, a value of the wrong type: `Schema.Number` given a text.
- (b) no title, no description, a built-in check fails: `Schema.Number.check(Schema.isGreaterThan(k))` given a number
  at or below `k`.
- (c) no title, no description, a bare `Schema.makeFilter` with no annotations fails.
- (d) a bare `Schema.makeFilter` whose function returns a message that quotes the value.
- (e) a title and a description on the schema.
- (f) a title only, on a schema with a built-in check.
- (g) a description only.
- (h) a union of two literals, no annotations, given a third text.
- (i) a record-valued setting, `Schema.Record(Schema.String, Schema.Number)`, whose member under a secret-looking key
  holds a secret-looking text.
- (j) a user-written `Schema.makeFilter` that declares `expected`.
- (n) a table-valued setting, `Schema.Struct({ <w1>: Schema.Number, <w2>: Schema.Number })`, missing `<w2>`.

Sources of a refused value (RF2):

- (r) the repo file at the start.
- (v) the setting's variable at the start, and its flag at the start, in the same run.
- (k) `SettingGroup.edit(...).set`, and `SettingGroup.set` on disk, with the value given to the call.
- (l) the `config set <name> <text>` command.

Read faults (RF3 and RF4):

- (p) `PermissionDenied`, with no cause.
- (o) `BadResource`, with no cause.
- (u) another `SystemError` tag, drawn from `Busy`, `TimedOut`, `Unknown`, `InvalidData`, `UnexpectedEof`,
  `WouldBlock`, `WriteZero` and `AlreadyExists`, with no cause.
- (q) a `SystemError` of a drawn tag whose cause has a POSIX `code`, `E` and two to six capitals.
- (x) a `SystemError` whose cause's `code` is the home folder's or the repo folder's absolute path.
- (y) a `SystemError` whose cause's `code` begins with a POSIX name and goes on with the home folder's path, as
  `EACCES/people/ana`.
- (w) a `BadArgument` whose `description` is the home folder's path.
- (z) a `SourceError` from the `ConfigProvider` whose `message` is a secret-looking text.

The draws, for every law: an app of two to six lower-case letters; a setting name of two such words joined by `.`; a
needle `zq` followed by eight lower-case letters, which no name, no Effect text and no message word holds; a needle
number from 10000000 to 99999999 (made negative for (b) and (f), odd for (c) and (j)); a bound `k` from 1 to 999; a
title `a <w> <w>` and a description `Use <w> <w>.`; two literal words for (h); zero to three comment lines before the
key, so the line is drawn; a home folder `/people/<w>` and a repo folder `/work/<w>`. The secret-looking texts carry
a space, a `"` and a `/`, so their JSON and URL forms differ from the raw form.

## Laws

Every test law runs `runsFor({ fast: 25, full: 100 })` runs and reaches every class it names in every run, checked
with `Reach` (`kalfa/config/src/SettingGroup.edit.test-support.ts`), so "100 runs" below is the full depth.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| RF1, an `invalid` refusal names a rule, for every kind of schema: each run builds one group per class (a) to (n), writes its value into `.<app>/<app>.toml` at a drawn line, and starts it. Each start fails with exactly one `SettingsError` and no defect: reason `invalid`, `file` `.<app>/<app>.toml`, `line` the line of the setting's own key, and `message` exactly `<file>, line <n>: <name> is not <tail>\n  <app> did not start.` with `<tail>` from the table under the laws. The message holds no needle in its raw, JSON-escaped or URL-encoded form. 100 runs | test | Effect Arbitrary: RuleCase | (a) give `InvalidType` no rule: it says "Its schema names no rule.", red; (b) read the filter's `title` in place of `expected`: red; (c) answer Effect's `<filter>` for a check with no text: red; (d) take the `message` annotation of the filter's inner `InvalidValue`: the needle shows, red; (e) add `Expected R.` after a description too: red; (f) skip the rule when a title is there: red; (g) put the rule in place of the description: red; (h) answer the first literal's text for `AnyOf`: red; (i) keep `explain`'s exact-path match, so the member's fault reads `unknown` and names its key, or name the `Pointer` path in the rule: red; (j) read `expected` only from Effect's built-in checks: red; (n) give `MissingKey` no rule: red | kalfa/config/src/SettingGroup.refusals.test.ts |
| RF2, every source passes its issue: each run draws class (b) or (j) and refuses the value from (r), (v), (k) and (l). The messages are exactly: (r) RF1's; the variable `<VAR> is not a valid value. Expected <R>.\n  <app> did not start.` and the flag the same with `--<name>`, both with no `file` and no `line`; (k) `<file>: <name> is not a valid value. Expected <R>.\n  <file> was not changed.` for the edit and the disk set, with `file` set and no `line`, and the disk file as it was; (l) `<file>: <name> is not a valid value. Expected <R>.\n  The repo configuration was not changed.`, nothing printed and no file changed. `<R>` is `a value greater than <k>` for (b) and the declared `expected` for (j). 100 runs | test | Effect Arbitrary: RuleSource | (r) build the file's refusal with no issue: red; (v) pass no issue in `resolve`'s `SchemaError` branch: red; (k) keep `Schema.is` in `change.set`, which has no issue: red; (l) drop the issue in `Cli.ts`'s `mapError`: red | kalfa/config/src/SettingGroup.refusals.test.ts |
| RF3, a file read says why: each run plants every class (p), (o), (u), (q), (x), (y) and (w), one at a time, through `MemoryFiles`' `broken` at each of five sites: the repo file at the start, the user file at the start under `HOME`, the user file under `$<APP>_HOME`, the repo file under `SettingGroup.set` on disk, and the repo file under `config list`. Each call fails with exactly one `SettingsError`: reason `read`, `file` the name a person reads (`.<app>/<app>.toml`, `~/.<app>/<app>.toml` or `$<APP>_HOME/<app>.toml`), no `line`, and `message` exactly `<file>: could not be read, because <why>.\n  <closing>`, where `<why>` is "permission was denied" for (p), "it is not a plain file" for (o), "the system gave the error <Tag>" for (u), its tag's text and ` (<CODE>)` for (q), its tag's text and no code for (x) and (y), and "its path is not valid" for (w); `<closing>` is `<app> did not start.` at the start, `<file> was not changed.` for the disk set and `<app> would not start with these settings.` for the command. The message holds neither folder's path. 100 runs | test | Effect Arbitrary: ReadFault | (p) word `PermissionDenied` as another tag: red; (o) word `BadResource` as another tag: red; (u) say "could not be read." with no reason for the other tags: red; (q) never print the code: red; (x) drop the `POSIX` test and print any string code: the path shows, red; (y) unanchor the pattern (`/^E[A-Z0-9]+/`) and print the code whole: red; (w) word `BadArgument` from its `description`: the path shows, red; the disk site alone keeps today's text: red; the command site alone keeps today's text: red | kalfa/config/src/SettingGroup.refusals.test.ts |
| RF4, an environment read says why: each run plants (z) at four sites: a provider that fails for `<APP>_HOME`; one that answers `<APP>_HOME` as unset and fails for `HOME`; one that fails for the setting's variable at `holder`; and one that answers `holder`'s ask and fails the value's read in `resolve`. Each start fails with exactly one `SettingsError`: reason `read`, no `file`, no `line`, and `message` exactly `<VAR or name> could not be read, because the environment did not answer.\n  <app> did not start.`, naming `<APP>_HOME`, `HOME`, the setting's name and the setting's name. The `SourceError`'s message is in no rendering. 100 runs | test | Effect Arbitrary: EnvironmentFault | (z) quote the `SourceError`'s message as the reason: red; treat every `ConfigError` in `resolve` as `invalid`: the fourth site reads `invalid`, red; keep today's text at `lookup` alone: red; keep today's text at `holder` alone: red | kalfa/config/src/SettingGroup.refusals.test.ts |
| RF5 [secrets], nothing private in any rendering, and the cause is kept hidden: for the flows of RF1's (a), (d) and (i), of RF3's every class at the start and the disk set, and of RF4's every site, under a recording `Tracer` and a recording logger, no needle (the refused value, the record's key, both folders' paths, the `SourceError`'s message, the `BadArgument`'s description) appears in raw, JSON-escaped or URL-encoded form in `error.message`, `String(error)`, `JSON.stringify(error)`, `inspect(error, { depth: null, showHidden: true, customInspect: false })`, `Cause.pretty(exit.cause)`, any recorded span's attributes or `Cause.pretty` of its ended exit, or any log line. For every read flow, `Redacted.isRedacted(error.cause)` holds and `Redacted.value(error.cause)` is the very `PlatformError` or `SourceError` the stand-in planted (`toBe`). 100 runs | test | Effect Arbitrary: HiddenCause | (x) keep the cause raw (`Schema.optional(Schema.Defect())` and no `Redacted.make` in `stop`): the `PlatformError`'s message prints the path in `Cause.pretty`, red; (z) keep the cause raw: the `SourceError`'s message shows, red; hide an empty cause (`Redacted.make(undefined)`): the identity fails, red; (d) as in RF1 | kalfa/config/src/SettingGroup.refusals.test.ts |
| RF6, every refusal leaves a span: each run makes, under a recording `Tracer`, an `invalid` (class (b)) and a `read` (class (p)) refusal through each call that can give one: `SettingGroup.layer` (span `config.layer`), `SettingGroup.set` (`config.set`), `SettingGroup.remove` for the read (`config.remove`), `SettingGroup.edit(...).set` for the invalid (`config.edit`), `config list` for the read (`config.list`) and `config set` for the invalid (`config.set`). For each, exactly one recorded span has that name; it has ended; its exit is a failure whose `Cause.findErrorOption` is the very error the call failed with (`toBe`); and it holds `kalfa.config.app` equal to the app, plus `kalfa.config.setting` and `kalfa.config.file` for `config.set`, `config.remove` and `config.edit`. 100 runs | test | Effect Arbitrary: SpanCase | (k) leave `edit` with no span: no `config.edit` span, red; (k) open `config.edit` when `edit` makes its object, not per call: the span ends before the failure, red; (r) catch the refusal inside `config.layer` and fail after it: the span ends as a success, red | kalfa/config/src/SettingGroup.refusals.test.ts |
| RF7, the cause's type is hidden: `new SettingsError({ reason: "read", message: "m" })` compiles; so does one with `cause: Redacted.make(new Error("x"))`, and one with `cause: undefined` (`Schema.optional` under `exactOptionalPropertyTypes`); one with `cause: new Error("x")` and one with `cause: "x"` do not compile (`@ts-expect-error`); `expectTypeOf<SettingsError["cause"]>().toEqualTypeOf<Redacted.Redacted<unknown> \| undefined>()` | type | type | keep `cause: Schema.optional(Schema.Defect())`: the two `@ts-expect-error` lines compile and the `expectTypeOf` line fails, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| RF8, a raw cause cast past the type fails loudly: `new SettingsError({ reason: "read", message: "m", cause: raw as never })` throws, for a generated `raw` that is never a `Redacted`; the same call with `Redacted.make(raw)` does not throw and keeps `raw`. 100 runs | test | fc.anything: filtered to values that are not a Redacted | swap the field for `Schema.Any` with the `Redacted` type kept by a cast: the raw cause is taken, red | kalfa/config/src/SettingGroup.refusals.test.ts |
| C12, changed: the message opens exactly `<APP>_HOME could not be read, because the environment did not answer.` in place of `<APP>_HOME could not be read.`; the rest of the law is as it was | test | Effect Arbitrary: CliDraw | (z) keep today's text at `lookup`: red | kalfa/config/src/Cli.test.ts |
| O1, the rest holds: every other law of `kalfa/config` stays green with no edit, among them W3 (a title and a description, as today), RC8, D9, B12 and the live laws' refusal warnings | test | pinned: their own generators, unchanged | (already planted) | kalfa/config/src/SettingGroup.text.test.ts, kalfa/config/src/SettingGroup.record.test.ts, kalfa/config/src/SettingGroup.disk.test.ts, kalfa/config/src/SettingGroup.test.ts, kalfa/config/src/SettingGroup.live.test.ts |

RF1's `<tail>` by class, the exact text after `<name> is not `:

| Class | Tail |
|---|---|
| (a) | `a valid value. Expected number.` |
| (b) | `a valid value. Expected a value greater than <k>.` |
| (c), (d) | `a valid value. Its schema names no rule.` |
| (e) | `<T>. <D>` |
| (f) | `<T>. Expected a value greater than <k>.` |
| (g) | `a valid value. <D>` |
| (h) | `a valid value. Expected "<w1>" \| "<w2>".` |
| (i) | `a valid value. Expected number.` |
| (j) | `a valid value. Expected <the declared expected>.` |
| (n) | `a valid value. Expected a table with every key it needs.` |

The tests step pins (a), (b) and (h) against Effect's own text once, by a run on the branch head of
`SchemaIssue.makeFormatterDefault()(new SchemaIssue.InvalidType(ast))` for those schemas, and writes the answer into
the table as a literal: if Effect spells a union `"a" | "b"` another way, the literal follows Effect, not this plan.

**Lint, type or test?** RF7 is a shape the compiler sees: type. RF1 to RF6 and RF8 are what a call answers at run
time, which no type or lint rule sees: tests. No import shape changes beyond `Redacted`, `Predicate` and `SchemaIssue`
from `effect`, which the package already imports, so no lint law.

**Where they run.** Every law runs in memory on every pull request: `MemoryFiles` with its `broken` faults, a test
`ConfigProvider`, a recording `Tracer` as `kalfa/config/src/SettingGroup.test.ts`'s start helper makes one, and the
command through `run` in `kalfa/config/src/Cli.test-support.ts`. No `.integration.` law: the fault a real Node read
gives is Effect's mapping (`handleErrnoException`, read above), and the stand-in plants the same `PlatformError` shape.
No law is host-only.

**Run time.** RF3 makes 35 failing calls a run, the most of any law. Each law stays under about 20 s at full depth on
the laptop; the tests step times each new law once with `FABRIKA_TEST_DEPTH=full` and splits a law by site if it
passes 20 s.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/error.ts | build | 30 | `cause` as `Schema.optional(Schema.Redacted(Schema.Defect()))`; `stop` hides the cause; `because`; the doc comment |
| kalfa/config/src/internal/check.ts | build | 40 | `rule` and `expected`; `wanted` takes the issue; `refused` and `unfit` take and pass it; `explain` matches a setting whose name begins the issue's path |
| kalfa/config/src/internal/place.ts | build | 4 | `contents` and `lookup` end their text with `because` |
| kalfa/config/src/internal/read.ts | build | 6 | `holder` and `resolve` end the read text with `because`; `resolve` passes the `SchemaError`'s issue to `refused` |
| kalfa/config/src/internal/change.ts | build | 8 | `change.set` decodes the value against the schema's type side and passes the issue to `unfit` |
| kalfa/config/src/Cli.ts | build | 3 | the `set` command passes the parse's issue to `unfit` |
| kalfa/config/src/SettingGroup.ts | build | 12 | the `config.edit` span in `edit`; `edit`'s and `layer`'s doc comments |
| kalfa/config/README.md | build | docs | one paragraph: what the two refusals say |
| kalfa/config/src/SettingGroup.refusals.test.ts | tests | tests | new: RF1 to RF6 and RF8 |
| kalfa/config/src/SettingGroup.refusals.test-support.ts | tests | tests | new: the draws, the class builders, and runners for a start, a disk call, an edit and the command under a recording `Tracer` and logger |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | RF7 |
| kalfa/config/src/Cli.test.ts | tests | tests | C12's message |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | no change expected: the read faults are planted through its `broken` |
| kalfa/config/src/Cli.test-support.ts | tests | tests | no change expected: RF2's (l), RF3's and RF6's command flows use its `run` |
| kalfa/config/src/SettingGroup.disk.test-support.ts | tests | tests | no change expected: `readRefused` is reused |
| kalfa/config/src/SettingGroup.edit.test-support.ts | tests | tests | no change expected: `Reach` and `forms` are reused |
| kalfa/config/src/SettingGroup.text.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.record.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.disk.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.live.test.ts | tests | tests | O1: no change, stays green |

No change to `kalfa/config/GLOSSARY.md`: no new domain word. No change to `index.ts`, the manifest or the older
entries (`Files.ts`, `Load.ts`, `Sources.ts`), which keep their own `SettingsError`; see Findings 1.

## Existing tools

- `because` in kalfa/config/src/internal/error.ts: searched `kalfa/` for a function that words a `PlatformError` or a
  `SourceError` for a person (`rg -n "PlatformError|SourceError" kalfa --glob '!**/node_modules/**'`). Found
  `unwritten` in `kalfa/config/src/internal/disk.ts`, which words a write's `NotFound` only, and nothing for reads.
  Effect's own `SystemError.message` prints the path, so it does not fit. No package on npm is worth an import for a
  four-case switch.
- `rule` and `expected` in kalfa/config/src/internal/check.ts: searched Effect 4.1.3's `SchemaIssue.ts` and
  `SchemaAST.ts`. `makeFormatterStandardSchemaV1` with custom hooks was the first candidate; it fits badly, because its
  `Filter` path calls `getExpectedMessage(..., issue)`, which adds `, got <input>`, whenever the check hook answers
  `undefined`, and its `AnyOf`, `Composite` and leaf paths do the same. Effect's `getExpected` (the type text) is
  internal (`internal/schema/annotations.ts`), so `expected` reaches it through an input-free
  `new SchemaIssue.InvalidType(ast)` and Effect's own formatter, or through `ast.getExpected`, whichever types.
- The `config.edit` span in kalfa/config/src/SettingGroup.ts: searched the package for its spans
  (`rg -n 'Effect.fn\("|withSpan\(' kalfa/config/src`). Reused the attribute names `config.set` already uses
  (`attributes` in `kalfa/config/src/internal/disk.ts`). No new helper.
- The hidden cause: copied the shape of `kalfa/secrets/src/Errors.ts`, `Schema.Redacted(Schema.Defect())`, and
  `Redacted.make` in the one constructor, `stop`.
- Test helpers, for the tests step: `Reach` and `forms` (`kalfa/config/src/SettingGroup.edit.test-support.ts`),
  `MemoryFiles`' `broken`, the recording `Tracer` of `start` in `kalfa/config/src/SettingGroup.test.ts`, `run` and the
  `unreadable` world of `kalfa/config/src/Cli.test-support.ts`, and `readRefused` in
  `kalfa/config/src/SettingGroup.disk.test-support.ts`.

## Calls taken

Each picks how the code does what the ticket, the brief's lessons and `SettingsError`'s own comment already say. The
ones under 80% are at the top.

- **The cause becomes a `Redacted` in this ticket.** 85% sure. The new reason is read from the cause, and today the
  cause prints the absolute path in `Cause.pretty` and `inspect`, which a span's failure carries: the third criterion
  and the brief's lesson both need it. It is three lines in `error.ts` and RF7.
- **The rule comes only from declared annotations and the AST.** 90% sure. A filter's run-time message and every
  input are the two ways a value can reach the text (Effect's doc says so); `rule` reads neither, and RF1's (d) and
  RF5 plant both.
- **No path inside a value is named.** 85% sure. A record's keys are part of its value, and RC8 already treats them as
  private. The cost: a struct-valued setting's message says what was expected, not which field; the line names the
  setting.
- **The POSIX code is printed only when it matches `^E[A-Z0-9]+$`.** 85% sure. It is the one part of the cause a
  person can act on (`EMFILE` says "too many open files"), and the anchored test keeps everything else out.
- **`BadResource` reads "it is not a plain file".** 80% sure. It covers `EISDIR` (a folder), `ELOOP` (a link loop) and
  `ENOTDIR`; the code beside it tells them apart.
- **No new `reason` and no new field.** 90% sure. The ticket asks for the messages. Carrying the read's kind as data
  is ticket https://github.com/kamp-us/tea-fabrika/issues/2000's, which gives each reason a declared code.
- **Is this a setting?** No. The sentences, the code pattern and the span name are how the code says what the ticket
  asks; none is a value a person would pick for a repo.

## Small Config tickets beside it

None folds in cheaply, so this plan builds 1995 only.

| Ticket | Shares code? | Why not folded |
|---|---|---|
| https://github.com/kamp-us/tea-fabrika/issues/1996 (a type law for an interface value type) | no: `SettingGroup.types.test.ts`'s T6 only | cheap (about 5 test lines), but unrelated to refusals; folding it adds a second concern to the review |
| https://github.com/kamp-us/tea-fabrika/issues/1997 (a table from the environment) | no | waits on its own reading rules |
| https://github.com/kamp-us/tea-fabrika/issues/2000 (a place and a diagnostic as data) | yes: `error.ts`'s `stop` and every refusal site | the closest, and not cheap: a `Diagnostic.Place` per site, a declared code per reason and a new import of `@kalfa/diagnostics`, about as large again as this plan. It builds well on top: `because`'s cases become its codes for `read` |
| https://github.com/kamp-us/tea-fabrika/issues/2014 (the folder clean-up race) | no: `disk.ts`'s `unmake` | unrelated |
| https://github.com/kamp-us/tea-fabrika/issues/2055 (the root entry loads `effect/cli`) | no: `internal/flags.ts` | unrelated |
| https://github.com/kamp-us/tea-fabrika/issues/2056 (the README's duration check) | no, but this plan's (c) is its schema's refusal | it now refuses with "Its schema names no rule."; see Records |
| https://github.com/kamp-us/tea-fabrika/issues/2057 (keys other packages own) | yes: `check.ts`'s `check` and `explain` | a different branch of `explain` (the `unknown` one); folding it changes what a start reads, a far larger review |

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/SettingGroup.refusals.test.ts
  kalfa/config/src/Cli.test.ts` shows RF1 to RF6, RF8 and C12 red on the branch head (RF1's (e) and (g) and RF6's
  rows other than `config.edit` are green today; each law is red through its other classes), and RF7 is judged by the
  compiler run the lead allows. The step also records whether RF1's (i) is red on the head, which settles the second
  call at the top.
- Build step: the same paths green, then the five files of O1 by path; each plant run once and undone.
- The lead runs `--changed origin/main` and one `pnpm typecheck`.

## Size

1. One pull request: 103 lines (`check.ts` 40, `error.ts` 30, `SettingGroup.ts` 12, `change.ts` 8, `read.ts` 6,
   `place.ts` 4, `Cli.ts` 3), plus a README paragraph, two new test files and edits to two. It lands whole: the two
   refusals share the hidden cause and the leak law.

About 3 agent hours across tests, build and review, 75% sure. The doubt is RF1's class (i) and the `Schema.toType`
decode in `change.set`, either of which can grow the build. Basis: ticket 1842's plan,
`.kalfa/quests/kalfa-config-fileonly-PLAN.md`, about 40 product lines and priced at about $8 a step; this one has more
laws, so about $9 a step for Opus steps: tests, build and review, plus one likely send-back of tests and build.

Estimate: 5 steps, $45

## New names

- `because`, in `kalfa/config/src/internal/error.ts`: the end of a read's sentence. Internal.
- `rule` and `expected`, in `kalfa/config/src/internal/check.ts`: what a refused value had to be, and a type's text.
  Internal.
- `reaches`, in `kalfa/config/src/internal/check.ts`: whether a path is a setting's own name or goes on inside its value (a member of a record, a field of a table). Internal.
- `faultLine`, in `kalfa/config/src/internal/check.ts`: the line a fault is on, read from the issue's path, never an invented one. Internal.
- `unread`, in `kalfa/config/src/internal/error.ts`: the one `read` error, which every read site makes. It holds `because`, the end of its sentence. Internal.
- `config.edit`: a span name, `<package>.<call>` by decision 0063.
- `SettingGroup.refusals.test.ts`: a test file named for what it checks, as `SettingGroup.fileOnly.test.ts` is.

## Records

- No new glossary term and no decision record: nothing here is hard to undo, and no word a caller sees is new.
- On https://github.com/kamp-us/tea-fabrika/issues/2000, the lead notes that `read` now has four kinds of why
  (permission, not a plain file, another system error, a bad path) plus the environment, each a natural declared code,
  and that the cause is a `Redacted`.
- On https://github.com/kamp-us/tea-fabrika/issues/2056, the lead notes that a bare `Schema.makeFilter` now refuses
  with "Its schema names no rule.", which the README's example should avoid as well.

## What this cannot tell us

- Whether a real Node read of a folder gives `BadResource` with `EISDIR` on every platform: read in Effect's source,
  not run. A platform that maps it to `Unknown` gets "the system gave the error Unknown (EISDIR)", still true.
- Whether the sentences read well to a person who meets them; the review reads them, and the owner may reword.
- A schema whose author put a value into a `title`, a `description` or an `expected` annotation will print it: that
  text is the author's, declared once, and no law can tell it from a rule.
- The watcher's warning for a refused file uses the same messages, but no new law walks it; the live laws keep their
  own checks.

## Open questions

None.

Each choice picks how the code does what the ticket, `SettingsError`'s comment or the brief's lessons already say; the
two under 80% are for the lead's read, not the owner's.

## Lead's calls at signing (2026-11-23)

- The `config.edit` span stays, since every step leaves a span.
- The "a bad record member reads as `unknown` today" guess is settled by RF1's class (i) on the branch head before the build, and the tests step says what it found.
- The new `Redacted` cause is fine for now. Tracker ticket 1310 moves every kalfa cause to a shared schema that stays hidden through `Schema.toCodecJson`, so no codec leak law is added here; 1310 adds those.
- No fold-ins.
- Trial: one agent writes the laws and then the code.

## Findings

1. **The older entries keep a raw cause and the old texts.** `kalfa/config/src/Files.ts` line 35 declares its own
   `SettingsError` with `cause: Schema.optional(Schema.Defect())`, and `kalfa/config/src/Sources.ts` lines 150 and 177
   build `read` errors as `<path> could not be read.` and `The settings could not be read.` with the raw cause. They
   are the twelve older modules the root entry's comment keeps beside it, out of this ticket. If any of them stays
   after the root entry replaces them, the same leak holds there.
2. **The pattern doc for error causes does not say when to hide one.**
   `.kalfa/patterns/effect-errors-keep-their-cause.md` (`where: "next/"`) gives `cause: Schema.Defect()` as the form,
   while `kalfa/secrets/src/Errors.ts` and, after this plan, `kalfa/config/src/internal/error.ts` hold a
   `Schema.Redacted(Schema.Defect())`. A cause from the platform or a provider can hold a path or a secret, and a span's
   failure prints it. A line there, written with the write-pattern skill, would stop the next package from relearning
   it.

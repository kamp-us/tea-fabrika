Approved by the lead agent, builds issues 1749, 1846; body 4345ebe8f4fc
Plancheck-Version: 3

# Plan: the kalfa config command (ticket 1846)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1846, under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749) (its "Explain" line, and the note that
the command takes many groups) and [its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806) (ruling 6: list
and reference show a file-only setting as such). Words: `kalfa/config/GLOSSARY.md` and `kalfa/cli/GLOSSARY.md`.

A person asks about settings through one command, `config`, with `get`, `set`, `remove`, `list`, `schema` and
`reference`. It takes every group of one app, so one file shared by many packages is checked against all of them. The
schema text and the reference text are also plain calls on a group. Two pull requests: the two text calls (about 155
product lines), then the command and its entry point `@kalfa/config/cli` (about 250).

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import { Setting, SettingGroup } from "@kalfa/config"
import { config } from "@kalfa/config/cli"

const approver = Setting.make("delivery.approver", Schema.Literals(["people", "owner"])).pipe(
  Setting.withDefault("people"), Setting.withDescription("Who may approve a change request."), Setting.live)
const main = Setting.make("reconciliation.main", Schema.String).pipe(
  Setting.withDefault("main"), Setting.withDescription("The branch the repo's settings are kept on."),
  Setting.files(["repo"]), Setting.fileOnly)

const Delivery = SettingGroup.make("kalfa", approver)            // one package's group
const Reconciliation = SettingGroup.make("kalfa", main)          // another's, same app, same file

// Slice 1: plain calls on one group, for tests that check committed files.
SettingGroup.jsonSchema(Delivery, "repo")   // string: the editor's JSON Schema of .kalfa/kalfa.toml, one final "\n"
SettingGroup.reference(Delivery)            // string: Markdown, one section per setting, one final "\n"

// Slice 2: the command @kalfa/cli mounts as its built-in `config`.
const command: Command.Command<"config", Input, {}, SettingsError, FileSystem.FileSystem | Path.Path> =
  config("kalfa", [Delivery, Reconciliation], { version: "0.0.0" })
// kalfa config list                          -> every setting: value, origin, live or restart, file-only
// kalfa config get delivery.approver         -> "owner"
// kalfa config set delivery.approver people  -> nothing printed; .kalfa/kalfa.toml edited, comments kept
// kalfa config remove delivery.approver      -> nothing printed
// kalfa config schema [--file repo|user]     -> SettingGroup.jsonSchema of all the groups, byte for byte
// kalfa config reference                     -> SettingGroup.reference of all the groups, byte for byte
```

## Calls under 80%, read these first

Each picks how the code does what the protocol's lines say. The plan takes each lean and goes on.

- **`get` prints the value as JSON, and `set` reads its text as an environment variable's text is read (70%).**
  `get delivery.approver` prints `"owner"`; `set delivery.approver owner` takes the plain word. Why: JSON is one line
  with every line break of a text value escaped and kept, so a value's bytes always come back; and "a flag's text is
  read as the variable's text is" is already the package's rule (`kalfa/config/src/internal/read.ts`), so `set` gains
  table values when ticket 1997 gives them to variables. Cost: the two forms differ, and a script reads a text value
  with `jq -r`. What settles it: the owner's word, since a person reads this (open question 1). Separable: only
  `internal/cli/listing.ts`'s `line` and C3 change.
- **A read command's fault in the files or the environment ends `<app> would not start with these settings.` (70%).**
  `list` and `get` run the start's own reading steps, so they meet the start's faults, but nothing was starting, so
  `<app> did not start.` would be false. A name typed on the command line that is no setting ends `Nothing was read.`
  for `get` and `Nothing was changed.` for `set` and `remove`. A value text refused before any file is touched ends
  `The repo configuration was not changed.` or `The user configuration was not changed.`, the closing
  `internal/disk.ts` already uses before a file is found. What settles it: the lead's read.
- **The command checks a typed name itself, not through `effect/cli`'s `Argument.Literals` (75%).** A mistyped name is a
  `SettingsError` with reason `unknown` and the same "Did you mean" as the mistyped-key check, so it becomes a
  diagnostic (exit code 1) once ticket 2000 gives the error one. `Argument.Literals` would give shell completion, but
  its refusal is `effect/cli`'s own parse error, which `kalfa` treats as a failure (exit code 2). What settles it: the
  lead's read; completion can come later from the same names.
- **The repo schema holds `<app>-version` with a pattern written from Effect's `SemVer.ts` parse (75%).** Without it the
  editor marks the repo's own version line as an error. The pattern is exact but for one thing: Effect also refuses a
  number above the largest safe integer, which a pattern cannot say. What settles it: X1, whose generator stays within
  safe integers, and the lead's read of that one gap.
- **The quiet window's text check becomes a pattern (75%).** `config.watch.debounce` is checked with a bare
  `Schema.makeFilter` today (`kalfa/config/src/internal/window.ts`), which `JsonSchema.make` refuses as "looser than it
  decodes", so every group with a live setting would make `jsonSchema` throw. Effect's `Duration.fromInput` reads text
  by one regex plus `Infinity` and `-Infinity` (`node_modules/effect/src/Duration.ts`, `DURATION_REGEXP`), so one
  `Schema.isPattern` says the same thing exactly and has a JSON Schema form. W1 holds the two together over generated
  text, so an Effect bump that changes the regex turns it red.
- **A description's line breaks in `list` and `reference` (75%).** Each break is kept as written (LF, CRLF or a lone
  CR). In `list`, each break but a final one is followed by the two-space indent; a final break ends the block's last
  line in place of the plain `\n`. In `reference`, the description is escaped Markdown with its breaks as given. C1
  and X3 read each description back byte for byte. What the laws do not cover: a description with a blank line or
  leading spaces, which Markdown reads as two paragraphs or a code block ("What this cannot tell us").
- **The layer rule's first matching row claims a file (75%).** The new row `kalfa-config-cli` sits before
  `kalfa-config` in `layer-rules.json`, as `next-program-windows` sits before `next-programs`. I read no code that says
  how `code-graph` picks between two rows that both match. What settles it: C10's plant in the tests step.

## Slices

1. **The schema text and the reference text**, branch `fabrikalfa/kalfa-config-1846`. `SettingGroup.jsonSchema(group,
   file)` and `SettingGroup.reference(group)`, the file shape both the start's check and the editor schema read, and
   the window's pattern. It closes the ticket's fourth criterion and half of the third (reference shows a file-only
   setting). It lands whole: a package can check a committed file against either call at once.
2. **The config command**, a branch the lead names, made from main after slice 1 lands. `@kalfa/config/cli` with
   `config(app, groups, options)`, the join of many groups, the read that resolves without following, the listing text,
   the package export, the layer row and the consumer. It closes the first, second, fifth and the rest of the third
   criteria.

Shared pieces and who owns them: `fields` and `near` in `internal/check.ts` are slice 1's (slice 2's `get` calls
`near`). `internal/reference.ts`'s `escape` and `code` are slice 1's; the old `Reference.ts` imports them. `load` in
`internal/start.ts`, `textSource` in `internal/read.ts` and `clashes` in `internal/names.ts` are slice 2's.

**Not blocked by `@kalfa/cli`'s first build ticket (80%).** The ticket says it waits for the shape a package's `./cli`
exports. That shape is `Subcommand.make` for a package `kalfa` finds through its `kalfa.cli` field. `config` is not one:
it is a built-in (`kalfa/cli/GLOSSARY.md`, **Root name**), and Configuration ranks below CLI
(`kalfa/AGENTS.md`), so it cannot import `Subcommand` anyway. The protocol says what it is: "`/cli` gives ... an
`effect/cli` command". So `@kalfa/config/cli` exports a plain `effect/cli` command, `@kalfa/cli` mounts it and passes
Configuration's codes to its own `diagnostics` list (https://github.com/kamp-us/tea-fabrika/issues/1751, the owner's
answers, part 2). The package gets no `kalfa.cli` field. The doubt: CLI's first build could want something more from
it; mounting a plain command is the least it can want. What settles it: the lead's read.

## How others do it

Read, unless marked "from memory".

- **Elm and Erlang/OTP.** Neither has a settings command; Elm gets its values as `flags` and Erlang reads
  `sys.config` at boot. Nothing to take but what the earlier plans took: one declaration feeds every reader.
- **git 2.46's `git config get | set | unset | list` (from memory).** `get` prints one value, `set` writes the repo's
  own file unless told `--global`, `unset` takes a key out, `list --show-origin` prints `file:<path>` beside each
  `key=value`. `set` prints nothing on success. Taken: the four verbs, `set` writing the first file it may, silence on
  success, and the origin beside each value. Not taken: git prints raw text, which this plan trades for JSON (call
  above).
- **npm config, gh config and cargo config (from memory).** `npm config get | set | delete | list` and `gh config get |
  set | list` are the same four. `cargo config get --show-origin` (unstable) prints where each value came from. Taken:
  the same verbs, and the origin.
- **Taplo and the JSON Schema Store (from memory, not fetched).** Editors check a TOML file against a JSON Schema,
  matched by file name or a `#:schema` line. Taken: `schema` prints a JSON Schema document a repo can commit and point
  its editor at.
- **Effect 4.1.3's `effect/cli`, read in `kalfa/config/node_modules/effect/src/cli/Command.ts`, `Argument.ts`, `Flag.ts`
  and `ai-docs/src/70_cli/10_basics.ts`.** `Command.make(name, config, handler)`, `Command.withSubcommands`,
  `Argument.String`, `Flag.Literals(name, choices)` with `Flag.optional`. A handler's failure is rethrown by
  `Command.runWith`, so the command's error channel is its handlers'. Used as is.
- **Effect 4.1.3's JSON Schema, read in `kalfa/config/src/JsonSchema.ts` and the old JSON Schema laws in
  libfabrika's settings tests.** `Schema.toJsonSchemaDocument` writes the document;
  `JsonSchema.make` refuses a schema it would loosen; `JsonSchema.format` prints it as `pnpm format` would. Effect reads
  a document back with `SchemaRepresentation.fromJsonSchemaDocument` and `JsonSchema.fromSchemaDraft2020_12`, which the
  old laws use as the oracle. All reused.
- **Today's code, read.** `kalfa/config/src/Reference.ts` and `Print.ts` are the old API's reference and listing, typed
  on the old `Setting.Group` with `path`, `scope`, `reload` and `since`. `next/packages/libfabrika/src/node/settings/Command.ts`
  is the old `fabrika settings` command: it builds the whole report before it prints anything, which this plan keeps.
  `kalfa/records/src/cli.ts` and `kalfa/quality/src/cli.ts` export a command named by its root name, which `config`
  follows.

## The shape

### The file shape both readers share (slice 1)

Today `internal/check.ts` builds the Struct a file is decoded with in `struct`, with bare leaves. The editor schema
needs the same tree with each leaf's description and default, so the one tree gains them, and the check keeps reading
it. Annotations change no decode.

```ts
// Sketch: kalfa/config/src/internal/check.ts.
/** The fields of one level of a file: a table per word, a leaf per setting, each optional. A leaf carries the setting's description and its JSON-encoded default. */
export const fields = (settings: ReadonlyArray<Setting.Any>, depth: number): Schema.Struct.Fields

/** The setting names within two edits of `typed`, nearest first: the "Did you mean" of the mistyped-key check, moved out of `explain`. */
export const near = (names: ReadonlyArray<string>, typed: string): Option.Option<string>
```

The leaf's annotations follow `.kalfa/patterns/settings.md`: `Schema.annotateEncoded({ description, default })`, the
default encoded by `Schema.toCodecJson(setting.schema)`. A required setting has no `default` key.

### The editor schema (slice 1)

```ts
// Sketch: kalfa/config/src/internal/schema.ts.
/** The editor's JSON Schema of one file as committed text: the settings its file scope allows, the repo's `<app>-version`, and nothing else. */
export const text = (group: Group, file: Setting.File): string =>
  JsonSchema.format(JsonSchema.make(Schema.Struct({
    ...fields(group.settings.filter((s) => s.files.includes(file)), 0),
    ...(file === "repo" ? { [`${group.app}-version`]: Schema.optionalKey(Version(group.app)) } : {}),
  })))
// A file no setting may be set in, and no version key, keeps today's rule: a Record of Never, which refuses every key.
```

```ts
// Sketch: kalfa/config/src/SettingGroup.ts.
/** The editor's JSON Schema of the repo or the user configuration, as the text a repo commits. The quiet window is in it for a group with a live setting. Throws for a schema JSON Schema cannot hold exactly. */
export const jsonSchema = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>, file: Setting.File): string =>
  schema.text({ app: group.app, settings: watched(group.settings) }, file)

/** The settings reference as Markdown: one section per setting, by name, the quiet window included. */
export const reference = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>): string =>
  references.text({ app: group.app, settings: watched(group.settings) })
```

- `Version(app)` is `Schema.String.check(Schema.isPattern(SEMVER))` with the description `The oldest <app> version
  this repo works with, as 1.2.3.` The pattern is strict SemVer 2.0.0 as `SemVer.ts` parses it (no leading zeros, no
  empty identifier).
- `JsonSchema.make` still throws for a schema it would loosen, as the old rule says; the window no longer is one.

### The window's pattern (slice 1)

```ts
// Sketch: kalfa/config/src/internal/window.ts.
/** A length of time as Effect's `Duration.fromInput` reads text: a number, spaces, a unit; or Infinity. */
const Pattern = /^(?:-?Infinity|-?\d+(?:\.\d+)?\s+(?:nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?))$/
const Length = Schema.String.check(Schema.isPattern(Pattern)).annotate({ title: "a length of time", description: "Write it as text, as 100 millis or 2 seconds." })
```

The title and description stay, so the start's refusal message for the window does not change (H1).

### The reference text (slice 1)

```md
### `delivery.approver`

Who may approve a change request.

| Field | Value |
|---|---|
| Files | `.kalfa/kalfa.toml`, `~/.kalfa/kalfa.toml` |
| Environment | `KALFA_DELIVERY_APPROVER` |
| Flag | `--delivery.approver` |
| Default | `"people"` |
| Applies | live |
```

One section per setting, sorted by name, the sections joined by one blank line and the text ending in one `\n`. For a
file-only setting the Environment and Flag cells say `none: file-only`. For a required setting the Default cell says
`none: required`. Applies is `live` or `restart`. The description is the old `escape` (every character Markdown reads,
escaped) with its line breaks as given. A default is a code span by `code`: a fence one backtick longer than the
longest run inside it, padded with a space when it starts or ends with a backtick, and each `|` written `\|`, as GFM
tables ask. `escape` and `code` move from `Reference.ts` into `internal/reference.ts`, and `Reference.ts` imports them.

### The command (slice 2)

```ts
// Sketch: kalfa/config/src/cli.ts, the `./cli` entry. Nothing here is imported by the root entry.
/**
 * The `config` command over every group of one app: get, set, remove, list, schema and reference. `@kalfa/cli` mounts
 * it as its built-in; an app can mount it under its own command.
 *
 * Throws an `Error` when a group is another app's, or two groups declare one name, a value and its table, or one
 * variable. A field two groups share is fine: each group yields its own.
 */
export const config = <const App extends string>(
  app: App,
  groups: ReadonlyArray<SettingGroup.SettingGroup<NoInfer<App>, ReadonlyArray<Setting.Any>>>,
  options: { readonly version: string; readonly repo?: string },
): Command.Command<"config", {}, {}, SettingsError, FileSystem.FileSystem | Path.Path>
```

| Subcommand | Arguments and flags | Standard output on success |
|---|---|---|
| `get <name>` | none | the value as one line of JSON, as `"owner"` |
| `set <name> <value>` | `--file repo\|user`, the first file of the setting's scope when left out | nothing |
| `remove <name>` | `--file repo\|user`, the same default | nothing |
| `list` | none | the listing below |
| `schema` | `--file repo\|user`, `repo` when left out | `jsonSchema` of the joined settings |
| `reference` | none | `reference` of the joined settings |

- **The join** (`internal/cli/join.ts`) makes one internal `Group` from the app and the groups: the app's name is
  checked as `SettingGroup.make` checks it, each group's app must be `app`, the settings are concatenated and a setting
  object that two groups share is kept once, then `watched` adds the quiet window once. Two different settings with one
  name, a value and its own table, or one variable stop it; equal fields do not. `clashes` moves from `SettingGroup.ts`
  into `internal/names.ts` with a `fields` switch, so `make` and the join share it.
- **The read** (`load` in `internal/start.ts`) is the start's own steps, moved out of `start` so the two cannot drift:
  find both files, read the repo file, check its minimum version, check both files whole, resolve every setting. `start`
  is `load` and then the follower. `list` and `get` run `load` with no flags, the closing `<app> would not start with
  these settings.`, and no follower and no `Live`.
- **`set`'s text** is read by `textSource(text)` (`internal/read.ts`), the provider a flag's text already uses, and
  decoded with `Config.schema(setting.schema, segments(setting.name))`. A refusal is `unfit`'s `invalid` error: the
  setting's name and what its schema asks for, never the text. Then `disk.set` runs on the joined group, so the edit's
  whole-file check sees every group and the window. `remove` calls `disk.remove` the same way.
- **A typed name** is found by `settings.find((s) => s.name === typed)`, never by a key of a plain object. None found:
  `unknown`, `there is no setting <typed>.` plus ` Did you mean <near>?` when `near` finds one.
- **Printing** is one named piece: `print(text)` writes nothing for `""`, else `Console.log(text.slice(0, -1))`. Every
  text a subcommand prints ends in exactly one `\n` (X2, X3, C1), so standard output is the text byte for byte. The
  whole text is built before anything prints, so a failing run prints nothing.
- **Spans.** Each run is one span `config.get`, `config.list`, `config.schema` or `config.reference` with
  `kalfa.config.app`, and `kalfa.config.setting` once a typed name is found. `set` and `remove` keep `disk`'s own
  `config.set` and `config.remove`. No value and no typed value text goes in a span.

### The listing (slice 2)

```text
config.watch.debounce = "100 millis"
  from the default
  restart
  How long a configuration file must stay unchanged before a running program reads it again, as 100 millis.

delivery.approver = "owner"
  from .kalfa/kalfa.toml, line 4
  live
  Who may approve a change request.

reconciliation.main = "trunk"
  from .kalfa/kalfa.toml, line 7
  restart, file-only
  The branch the repo's settings are kept on.
```

```ts
// Sketch: kalfa/config/src/internal/cli/listing.ts.
/** One setting's block: `<name> = <JSON>`, `from <origin>`, `live` or `restart` with `, file-only`, then its description. */
export const block = (settled: Settled): string
/** Every block, by name, one blank line between, one final "\n". No settings: "". */
export const listing = (settled: ReadonlyArray<Settled>): string
/** `get`'s answer: the value as one line of JSON and "\n". */
export const line = (settled: Settled): string
/** An origin as a person reads it: `the default`, `--name`, the variable's name, or `<file>, line <n>`. */
export const from = (origin: Origin): string
```

Every setting shows, defaults included: the old report's `--all` is left out, since one app's settings are few. The JSON
is `JSON.stringify` of the value encoded by `Schema.toCodecJson(setting.schema)`.

### Outcomes and exit codes

The command picks no exit code: `kalfa` does (`kalfa/cli/GLOSSARY.md`, **Exit code**; decision 0084). Each run ends in
one of three named outcomes, and each has its laws.

| Outcome | Standard output | Under `kalfa` | Laws |
|---|---|---|---|
| success | the subcommand's text, byte for byte | 0 | C1, C3, C4, C6 |
| one `SettingsError` | nothing | 1 once ticket 2000 gives the error its diagnostic; 2 until then | C2, C3, C4, C8 |
| a defect (a schema JSON Schema cannot hold, a cast schema) | nothing | 2 | X2, C8 |

`effect/cli`'s own refusals (no such subcommand, a missing argument) are `kalfa`'s to print.

### Text keeps its bytes

The texts this package writes here are made from declarations and values, never from an input text, but they carry a
person's bytes in three places. A description keeps every line break as written in `list` and `reference` (call
above). A text value in `get` and `list` is JSON, so its breaks are escaped and come back exactly. And `set` hands its
value to the existing edit, whose laws already keep every other line and the final break of the file.

## One value traced

`Delivery` and `Reconciliation` from the sketch at the top. The repo configuration `.kalfa/kalfa.toml`:

```toml
kalfa-version = "0.0.0"

[delivery]
approver = "owner"

[reconciliation]
main = "trunk"
```

No `~/.kalfa/kalfa.toml`, no `KALFA_` variables, the running version `0.0.0`.

1. `config("kalfa", [Delivery, Reconciliation], { version: "0.0.0" })`: the join checks `kalfa`, finds both groups of
   app `kalfa`, takes `delivery.approver` and `reconciliation.main`, and adds `config.watch.debounce` once, since
   `approver` is live. No name, table or variable is shared.
2. `kalfa config list`: `load` reads `.kalfa/kalfa.toml`, `0.0.0` is not newer than `0.0.0`, the whole file passes
   against all three settings, the user file is missing and so empty, and each setting resolves: the window from its
   default, `approver` from line 4, `main` from line 7. The listing above is built whole, then printed.
3. Had it been `config("kalfa", [Delivery], ...)`: the file check meets `reconciliation` and fails `unknown`,
   `.kalfa/kalfa.toml, line 6: there is no setting reconciliation.main.` then `kalfa would not start with these
   settings.` Nothing is printed. This is why the command takes every group (C2).
4. `KALFA_RECONCILIATION_MAIN=x kalfa config list`: the read stops at `main` with `scope`,
   `KALFA_RECONCILIATION_MAIN: reconciliation.main may be set only in .kalfa/kalfa.toml.` and the read closing. Nothing
   is printed, though two blocks were ready (C8).
5. `kalfa config get delivery.approver` prints `"owner"`. `kalfa config get delivery.aprover` fails `unknown`, `there is
   no setting delivery.aprover. Did you mean delivery.approver?` then `Nothing was read.`
6. `kalfa config set delivery.approver people`: no `--file`, so the first file of its scope, `repo`. `textSource("people")`
   decodes to `"people"`. `disk.set` on the joined group edits line 4 to `approver = "people"`; `[reconciliation]`
   passes the whole-file check; the comments and blank lines stay. Nothing is printed. `set delivery.approver robots`
   fails `invalid`, `delivery.approver is not a valid value.` then `The repo configuration was not changed.`, and the
   file is untouched.
7. `kalfa config set reconciliation.main trunk --file user` fails `scope`: `reconciliation.main may be set only in
   .kalfa/kalfa.toml.` then `~/.kalfa/kalfa.toml was not changed.`
8. `kalfa config schema` prints a document whose properties are `kalfa-version`, `config` (with `watch.debounce` and its
   pattern), `delivery` (with `approver` as an enum, default `"people"`, its description) and `reconciliation`.
   `--file user` leaves out `kalfa-version` and `reconciliation`, whose scope is the repo only.
9. `kalfa config reference` prints three sections; `reconciliation.main`'s Environment and Flag cells say `none:
   file-only`.

## What fact is lost if it is not recorded now

- Nothing new is written but what `set` and `remove` write, and their spans already say which app, setting and file,
  and whether the text changed. The commit that takes the file says who and when.
- A read command's span records the app and the setting. A typed name that is no setting is left out of the span, so a
  value pasted into the name by mistake is never recorded.

## Generators

Every generator is an Effect `Arbitrary`. Slice 1's live in `kalfa/config/src/SettingGroup.text.test-support.ts`,
slice 2's in `kalfa/config/src/cli.test-support.ts`. Slice 2 starts its runs over `MemoryFiles.test-support.ts` and a
test `ConfigProvider`, as the edit and disk laws do. No law needs `Digest`, so no rig touches `crypto.subtle`. Caps: at
most three groups and four settings beside the window, at most three file lines per setting. Each run builds one case
per class it lists, from the drawn seeds, never the cross product, and a law fails when a class it lists was not
reached.

The declarations and the files:

- (a) leaf kinds: an integer with bounds, a literal union, a text with a pattern, a branded text, a record with an
  optional key, an array, a required setting.
- (b) file documents: valid values, a refused value, an unknown key, a key outside its scope, a table where a value
  is, a value where a table is, an extra key inside a record value.
- (c) texts with LF, CRLF and a lone CR inside, with and without a final break, a tab, `雪` and the empty text, as
  descriptions and as text values.
- (d) a group with a live setting, so with the window, and the window's value valid and refused in a file.
- (e) file scopes: repo only, user only, both; file-only settings; a file no setting may be set in.
- (f) the same group with its settings in another order.
- (g) descriptions with every character Markdown reads, a line that starts `1.`, and `|`.
- (h) `<app>-version` in the repo file (valid, with a pre-release and a build, refused, leading zeros) and in the user
  file.
- (i) defaults whose JSON holds backticks, a run of backticks, a leading or trailing backtick, and `|`.
- (j) duration texts: every unit singular and plural, decimals, a negative, `Infinity` and `-Infinity`, and near
  misses (no space, an unknown unit, a capital unit, a trailing space, `1e3 millis`, two numbers).
- (u) a setting whose schema has a bare `Schema.makeFilter`, with no JSON Schema form.

The command's inputs:

- (k) settings split over one to three groups of one app, one setting object shared by two groups, two groups each with
  a live setting, and two groups with one field under different tables.
- (l) a group with no settings, and no groups at all.
- (m) typed names: a declared name, one within one or two edits, a far one, a table's name (`delivery`), the empty text.
- (n) value texts: a plain word, a number, `true`, a text with spaces, a refused text.
- (o) `--file` given and left out, for settings whose scope's first file is the repo and the user.
- (p) joins that must stop: another app's group, two settings of one name, a value and its own table, two names with one
  variable; and joins that must not: one shared setting object, one field twice.
- (r) secret-looking value texts, each with a character that changes in JSON and in a URL.
- (s) every origin a read gives: the default, a variable, the repo file, the user file under `~` and under `$<APP>_HOME`.
- (t) a fault in a setting that sorts after others that resolved: a variable for a file-only setting named `z...`.
- (y) settings named `constructor` and `to-string`, beside others.
- (z) the window as the setting set or removed.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| W1, slice 1, the window's pattern reads what Effect reads: for a generated text, `Schema.is(Length)` is true exactly when `Schema.DurationFromString` decodes it. 100 runs, every class listed reached | test | Effect Arbitrary: DurationText | (j) drop `weeks?` from the pattern: `2 weeks` is refused, red; (j) drop the `^` anchor: `x1 millis` passes, red | kalfa/config/src/SettingGroup.text.test.ts |
| X1, slice 1, the editor schema agrees with the start: for a generated group, file and document, the document read back from `jsonSchema(group, file)` by Effect's JSON Schema reader accepts it exactly when the start's whole-file check of that file accepts it. 100 runs, every class listed reached | test | Effect Arbitrary: FileCase | (a) write each leaf as `Schema.Unknown`: a refused value passes the schema, red; (b) build the document without `onExcessProperty: "error"`: an unknown key passes, red; (h) leave `<app>-version` out of the repo schema: a valid version is refused, red; (d) build the schema from `group.settings`, not `watched`: the window's key is refused, red; (e) take every setting whatever its scope: a key outside its scope passes, red | kalfa/config/src/SettingGroup.text.test.ts |
| X2, slice 1, the schema text's form: each setting in the file's scope has its description and, when it has one, its encoded default at its node, and a required one has no `default`; the text ends in exactly one `\n` and `JsonSchema.format(JSON.parse(text))` gives it back; the same group in another order gives the same text; a schema with no JSON Schema form throws `A setting's schema cannot be written as JSON Schema without loosening it.` 100 runs, every class listed reached | test | Effect Arbitrary: FileCase | (a) drop the `default` annotation: red; (f) keep the group's order in `fields`: a reordered group gives other text, red; (u) catch the throw and write `{}`: red | kalfa/config/src/SettingGroup.text.test.ts |
| X3, slice 1, the reference reads back: parsing `reference(group)` with the GFM parser gives one section per setting, the window included, by name; its heading's code is the name; its paragraph's text is the description, line breaks as given; its cells are the file names, the variable or `none: file-only`, the flag or `none: file-only`, the default's JSON (the cell's code, `JSON.parse`d, equals the encoded default) or `none: required`, and `live` or `restart`; the text ends in exactly one `\n`; another order gives the same text. 100 runs, every class listed reached | test | Effect Arbitrary: ReferenceCase | (g) drop `escape`: a `*word*` description parses as emphasis, red; (i) write every default in single backticks: a default with a backtick breaks its cell, red; (i) leave `\|` unescaped: the row gains a cell, red; (e) write the variable for a file-only setting: red; (c) write each description with `\n` in place of its own breaks: a CRLF description changes, red; (f) keep the group's order: red | kalfa/config/src/SettingGroup.text.test.ts |
| X4, slice 1, the text calls' types: `jsonSchema(group, file)` is `string` and a file other than `"repo"` or `"user"` does not compile (`@ts-expect-error`); `reference(group)` is `string`; built from real groups, with no `declare const` | type | type | type `file` as `string`: the `@ts-expect-error` line compiles, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| H1, slice 1, the rest holds: B1 to B17, V1 to V19, FO1 to FO6, the edit, record, disk and snapshot laws stay green with no edit after `fields` replaces `struct` and the window becomes a pattern; the window's refusal message is unchanged | test | pinned: their own generators, unchanged | drop the window's `title` annotation: the window's refusal message changes and its V law is red | kalfa/config/src/SettingGroup.live.test.ts, kalfa/config/src/SettingGroup.test.ts, kalfa/config/src/SettingGroup.edit.test.ts |
| C1, slice 2, `list` shows every setting: for generated groups, sources and descriptions, the standard output of `config list` is the listing, byte for byte; parsed back by blocks, each block is one setting, by name, its value's JSON decodes to the value the generated sources set, its origin line is that source's, its marks line says `live` or `restart` and `, file-only` exactly for a file-only setting, and its description comes back byte for byte once the indent after each inner break is taken off. 100 runs, every class listed reached | test | Effect Arbitrary: Listed | (k) list only the first group: red; (k) add the window once per group with a live setting: two window blocks, red; (k) dedupe by name, not by object: a shared object passes but two of one name hide a clash, red; (c) end each block with `\n` after the description: a description with a final break gets two, red; (l) print `\n` for an empty listing: red; (s) write a `$<APP>_HOME` origin with its `~` name: red | kalfa/config/src/cli.test.ts |
| C2, slice 2, every group is seen: for generated groups of one app and a file that sets a key of each, `config(app, all)` lists them all and succeeds, and `config(app, all but one)` fails with one `SettingsError` of reason `unknown` at the left-out group's key and line, ending `<app> would not start with these settings.`, and prints nothing. 100 runs, every class listed reached | test | Effect Arbitrary: Shared | (k) check the file against each group alone and join the answers: red; (k) build the read's group from the first group's settings: red | kalfa/config/src/cli.test.ts |
| C3, slice 2, `get`: for a generated declared name, standard output is one line, no LF or CR in it, and `JSON.parse` of it decoded by the setting's codec equals the read value byte for byte; for a typed name that is no setting, one `SettingsError` of reason `unknown`, no file, `there is no setting <name>.`, ` Did you mean <near>?` exactly when a name is within two edits, then `Nothing was read.`, and nothing printed. 100 runs, every class listed reached | test | Effect Arbitrary: Asked | (m) accept a table's name and print its record: red; (m) suggest a name at three edits: red; (y) find by `byName[typed]` on a plain object: `constructor` finds Object's own function, red; (c) print a text value raw: a value with a break spans two lines, red | kalfa/config/src/cli.test.ts |
| C4, slice 2, `set` and `remove` write what the edit writes: for a generated setting, value text and file choice, after `config set <name> <text> [--file f]` the file's text equals `SettingGroup.edit` of the joined group's text setting the value the variable `<APP>_<NAME>=<text>` would resolve to, in the file `--file` names or else the first of the setting's scope; `remove` the same with `edit`'s `remove`; a refused text fails `invalid` with `The <file> configuration was not changed.`, the file untouched; a file outside the scope fails `scope`; other groups' keys stay and are not refused; nothing is printed. 100 runs, every class listed reached | test | Effect Arbitrary: Written | (n) read the text as JSON: the plain word `owner` is refused, red; (o) default `--file` to the repo: a user-only setting fails `scope`, red; (k) edit with the setting's own group: another group's key is refused, red; (z) join without `watched`: a set of `config.watch.debounce` fails `unknown`, red | kalfa/config/src/cli.test.ts |
| C5, slice 2, the join: for a generated list of groups, `config(app, groups, options)` throws an `Error` naming both settings for each class that must stop, and builds for each that must not, as a model of the rule says. 100 runs, every class listed reached | test | Effect Arbitrary: Joined | (p) leave out the app check: another app's group builds, red; (p) refuse a field two groups share: red; (p) keep a shared setting object twice: one name clashes with itself, red; (l) refuse an empty list of groups: red | kalfa/config/src/cli.test.ts |
| C6, slice 2, `schema` and `reference` print their calls: for generated groups, the standard output of `config schema [--file f]` is `jsonSchema` of a group of the joined settings in that file (`repo` when left out), and of `config reference` is `reference` of it, byte for byte. 100 runs, every class listed reached | test | Effect Arbitrary: Printed | (c) print with `Console.log(text)`: one extra `\n`, red; (e) default `--file` to the user: the repo's version key is missing, red | kalfa/config/src/cli.test.ts |
| C7 [secrets], slice 2, a value text stays out: a generated secret-looking value text given to `set`, refused or taken, never appears in the error's message, its cause, `Cause.pretty`, standard output, or any span's attributes, in raw, JSON-escaped and URL-encoded forms. 100 runs | test | Effect Arbitrary: HiddenText | (r) put the text in the `invalid` message: red; (r) annotate the span with the typed text: red | kalfa/config/src/cli.test.ts |
| C8, slice 2, a failure prints nothing, and each run is one span: for every generated failing run of every subcommand, standard output is empty; each run ends one span `config.<subcommand>` with `kalfa.config.app`, and `kalfa.config.setting` exactly when a typed name was found. 100 runs, every class listed reached | test | Effect Arbitrary: Failing | (t) print each block as it is made: a fault in a later setting leaves earlier blocks printed, red; (m) annotate the setting before it is found: a mistyped name is recorded, red | kalfa/config/src/cli.test.ts |
| C9, slice 2, the command's type: `config(app, groups, options)` is a `Command<"config", ...>` whose error is exactly `SettingsError` and whose requirements are exactly `FileSystem \| Path`; it takes groups with different settings; a group of another literal app does not compile (`@ts-expect-error`), while `config<string>(...)` compiles and C5 holds it at run time; built from real groups, with no `declare const` | type | type | drop `NoInfer` from `groups`: the other-app line compiles, tsc red; widen the error to `unknown`: the exact-error line fails, tsc red | kalfa/config/src/cli.types.test.ts |
| C10, slice 2, command code stays out of the root entry: the row `kalfa-config-cli` claims `kalfa/config/src/cli*.ts` and `kalfa/config/src/internal/cli`, at layer 2 above `kalfa-config`, so no file of the root's graph imports it; the pinned layer table holds the row | lint | lint | import `./cli.ts` from `kalfa/config/src/SettingGroup.ts`: `pnpm lint:layers` red; move the row after `kalfa-config`: the plant passes, red | layer-rules.json, oxlint-plugins/layers.test.ts |
| P1, changed in slice 2: the installed archive's consumer imports `@kalfa/config/cli`, runs `config list` on one group over an in-memory file through `Command.runWith`, reads the listing, and compiles the declaration; the archive's exports are the root, the twelve modules and `./cli` | test | scenario: one group and one in-memory file through the installed archive | leave `./cli` out of `publishConfig.exports`: the consumer's import fails and the export list differs, red | kalfa/config/test/consumer.ts, kalfa/config/test/consumer.mjs, kalfa/config/src/Package.integration.test.ts, .github/ci/related-selection.test.ts |
| H2, slice 2, the start holds: B1 to B17, V1 to V19, FO1 to FO6 and the snapshot laws stay green with no edit after `load` moves out of `start` and `clashes` out of `SettingGroup.ts` | test | pinned: their own generators, unchanged | drop the minimum-version check from `load`: the B version law is red | kalfa/config/src/SettingGroup.test.ts, kalfa/config/src/SettingGroup.live.test.ts, kalfa/config/src/SettingGroup.fileOnly.test.ts |

**Lint, type or test?** C10 is the shape of the import graph: lint, through the layer rows. X4 and C9 are shapes the
compiler sees: type. Every other law is about what a text, a read or a command answers at run time: tests.

**Where they run.** Every law but P1 runs on every pull request, in memory: `MemoryFiles`, a test `ConfigProvider`,
`TestConsole` for standard output, and Effect's own JSON Schema reader. X3 parses Markdown with
`mdast-util-from-markdown`, `mdast-util-gfm` and `micromark-extension-gfm`, which `kalfa/records` already installs
from the catalog; `kalfa/config` gains them as dev dependencies. P1 is the existing `.integration.` consumer check,
which runs in CI only (the laptop refuses it by name); it is the thin check that the packed archive behaves as the
source does, and it needs a real install, so no stand-in will do. No law is host-only.

**Run time.** Each law stays under about 20 s at full depth on the laptop: three groups and four settings at most, one
`Command.runWith` per case. The tests step times each new law once with `FABRIKA_TEST_DEPTH=full` and splits a law by
class when it passes 20 s.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/check.ts | build | 20 | slice 1: `fields` (annotated leaves) in place of `struct`; `near` moved out of `explain` |
| kalfa/config/src/internal/schema.ts | build | 35 | slice 1, new: `text(group, file)` and `Version(app)` |
| kalfa/config/src/internal/reference.ts | build | 60 | slice 1, new: `text(group)`, `escape` and `code` |
| kalfa/config/src/Reference.ts | build | 4 | slice 1: imports `escape` and `code` from `internal/reference.ts` in place of its own |
| kalfa/config/src/internal/window.ts | build | 6 | slice 1: `Length` checks `Pattern` |
| kalfa/config/src/SettingGroup.ts | build | 30 | slice 1: `jsonSchema` and `reference` with their docs |
| kalfa/config/README.md | build | docs | slice 1: a section "The schema and the reference"; slice 2: a section "The config command" and `./cli` under the public modules |
| kalfa/config/GLOSSARY.md | build | docs | slice 1: **Reference** |
| kalfa/config/package.json | tests | tests | slice 1: dev dependencies `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm`, from the catalog |
| pnpm-lock.yaml | tests | tests | slice 1: written by one `pnpm install --offline` |
| kalfa/config/src/SettingGroup.text.test.ts | tests | tests | slice 1, new: W1, X1, X2, X3 |
| kalfa/config/src/SettingGroup.text.test-support.ts | tests | tests | slice 1, new: the generators and their reach checks |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | slice 1: X4 |
| kalfa/config/src/SettingGroup.live.test.ts | tests | tests | H1 and H2: no change, stays green |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | H1 and H2: no change, stays green |
| kalfa/config/src/SettingGroup.edit.test.ts | tests | tests | H1: no change, stays green |
| kalfa/config/src/SettingGroup.fileOnly.test.ts | tests | tests | H2: no change, stays green |
| kalfa/config/src/internal/start.ts | build | 12 | slice 2: `load`, moved out of `start`; `start` calls it |
| kalfa/config/src/internal/read.ts | build | 5 | slice 2: `textSource(text)`; the flag source uses it |
| kalfa/config/src/internal/names.ts | build | 6 | slice 2: `clashes`, moved from `SettingGroup.ts`, with a `fields` switch |
| kalfa/config/src/SettingGroup.ts | build | 3 | slice 2: imports `clashes` from `internal/names.ts` |
| kalfa/config/src/internal/cli/join.ts | build | 45 | slice 2, new: `join(app, groups)` |
| kalfa/config/src/internal/cli/listing.ts | build | 55 | slice 2, new: `block`, `listing`, `line`, `from` |
| kalfa/config/src/cli.ts | build | 115 | slice 2, new: `config`, its six subcommands, `print` and the spans |
| kalfa/config/package.json | build | 8 | slice 2: `./cli` in `exports` and `publishConfig.exports` |
| .github/ci/related.ts | tests | tests | slice 2: `cli` in `SUBPATHS`, one line; an exam path, so the tests step writes it |
| layer-rules.json | tests | tests | slice 2: the row `kalfa-config-cli`, before `kalfa-config`, about 6 lines; an exam path, so the tests step writes it with C10 |
| oxlint-plugins/layers.test.ts | tests | tests | slice 2: C10, `"kalfa-config-cli": 2` in the pinned table |
| kalfa/config/src/cli.test.ts | tests | tests | slice 2, new: C1 to C8 |
| kalfa/config/src/cli.test-support.ts | tests | tests | slice 2, new: the generators and their reach checks |
| kalfa/config/src/cli.types.test.ts | tests | tests | slice 2, new: C9 |
| kalfa/config/test/consumer.ts | tests | tests | slice 2: P1's typed half |
| kalfa/config/test/consumer.mjs | tests | tests | slice 2: P1's run half |
| kalfa/config/src/Package.integration.test.ts | tests | tests | slice 2: `cli` in the module list |
| .github/ci/related-selection.test.ts | tests | tests | slice 2: `cli` in its copy of the subpaths |

No change to `kalfa/config/src/index.ts` (the command stays out of the root entry) or to the oxlint rule file. The package
gets no `kalfa.cli` field: `config` is a built-in, not a found subcommand.

## Existing tools

- kalfa/config/src/internal/schema.ts: searched `kalfa/config/src/JsonSchema.ts` (`make` and `format`, reused as they
  are), `kalfa/config/src/Files.ts` (`schema` is typed on the old `Setting.Group`), `internal/check.ts` (`struct`, which
  becomes `fields` and is reused), Effect 4.1.3's `Schema.toJsonSchemaDocument` (used inside `make`), and npm for a
  TOML-to-JSON-Schema writer (from memory: Taplo reads schemas and writes none from a declaration). New, about 35
  lines, most of it `Version`.
- kalfa/config/src/internal/reference.ts: searched `kalfa/config/src/Reference.ts` (`markdown` is typed on the old
  group with `scope`, `reload` and `since`; its `escape` and `code` move here and are reused), `kalfa/markdown`
  (`@kalfa/markdown` writes Markdown from mdast, but Configuration imports no kalfa package but Diagnostics, and a
  table of plain cells needs no tree), and `mdast-util-to-markdown` (not installed in this package; a tree for six
  fixed rows is more code than the text). New, about 60 lines.
- kalfa/config/src/internal/cli/join.ts: searched `SettingGroup.ts`'s `refusal` and `clashes` (the app check and the
  clash rule, reused; `clashes` moves to `internal/names.ts` so both callers share it) and `internal/window.ts`'s
  `watched` (reused). Nothing joins groups today. New, about 45 lines.
- kalfa/config/src/internal/cli/listing.ts: searched `kalfa/config/src/Print.ts` (`report` takes the old `Row`, hides
  defaults and has no file-only mark; its origin words are kept), `next/packages/libfabrika/src/node/settings/Command.ts`
  (calls `Print.report`) and `Codec.ts` (the per-setting step is `Schema.toCodecJson`, called directly). New, about 55
  lines.
- kalfa/config/src/cli.ts: searched `kalfa/records/src/cli.ts` and `kalfa/quality/src/cli.ts` (the root-name export
  shape, followed), `next/packages/libfabrika/src/node/settings/Command.ts` (the old `settings` command, built on the
  old loader), Effect 4.1.3's `effect/cli` `Command`, `Argument` and `Flag` (used), and `@kalfa/cli` (no code yet: only
  its glossary). New, about 115 lines.
- `fields` and `near` in kalfa/config/src/internal/check.ts: searched `check.ts` (`struct` becomes `fields`; the
  "Did you mean" inside `explain` becomes `near`, with `internal/document.ts`'s `distance` reused). No new logic but
  the leaf annotations.
- `load` in kalfa/config/src/internal/start.ts: today's first half of `start`, moved out unchanged. No new logic.
- `textSource` in kalfa/config/src/internal/read.ts: the provider `resolve` builds inline for a flag's text, moved
  into a named piece. No new logic.
- `clashes` in kalfa/config/src/internal/names.ts: moved from `SettingGroup.ts`, gaining the `fields` switch the join
  needs.
- `Pattern` in kalfa/config/src/internal/window.ts: searched Effect 4.1.3's `Duration.ts` (`DURATION_REGEXP`, private,
  so copied with `Infinity` and held to it by W1) and `Schema.ts` (`DurationFromString` has no JSON Schema form).
- `jsonSchema` and `reference` in kalfa/config/src/SettingGroup.ts: the protocol's names, wrapping the two internal
  texts and `watched`.

## Calls taken

Each picks how the code does what the protocol's lines, 1806's rulings or the glossaries already say. Those under 80%
are at the top.

- **Two pull requests, the texts first.** 85%. The command prints both texts, so they come first, and a package can
  check a committed file against them before the command exists.
- **`config(app, groups, options)`, named by its root name.** 80%. Records and Code quality export their command under
  its root name. The app is given apart from the groups, so an empty list is a valid command (CLI collects groups from
  whatever is installed), and `NoInfer` keeps a group of another literal app from compiling. The doubt: the protocol
  wrote `SettingGroup.cli`; renaming is cheap before any caller.
- **Not blocked by CLI's first build.** 80%. Under "Slices".
- **`jsonSchema` takes the file.** 85%. The two files allow different settings and only the repo's has
  `<app>-version`, so one schema cannot be right for both.
- **The text calls take one group; the command joins many.** 80%. The ticket says "plain calls on a group". A test
  that checks an app's whole file can call them on a group made of every setting, which `SettingGroup.make` allows
  unless two fields clash.
- **`list` shows every setting, defaults included.** 80%. One app's settings are few, and the old `--all` hid the one
  thing the protocol asks the listing to show: where each value came from. Open question 2.
- **`set` and `remove` print nothing.** 80%. As `git config set`. The span records whether the text changed.
- **`set`'s default file is the first of the setting's scope.** 85%. `Setting.Files` is a non-empty tuple, so there
  always is one, and for the usual scope it is the repo, as git's `set` writes the repo's own file.
- **The editor schema and the check share one tree.** 85%. One tree, two readers, so they cannot drift (X1).
- **Is this a setting?** No new choice is. The default file, the closings, the listing's shape and the window's pattern
  are the same for every app, and no person would pick them per repo. The folder the command reads is already the
  `repo` option.

## Where this departs from today's code

- `struct` in `internal/check.ts` becomes `fields`, with annotated leaves; the check decodes the same (H1).
- The window's check is a pattern in place of a filter; it accepts the same texts (W1) and says the same message (H1).
- `start` calls the new `load`; `clashes` moves; neither changes behavior (H2).
- The old `Reference.ts` imports its `escape` and `code`; its output does not change.

## Validation

- Slice 1, tests step: `pnpm install --offline` for the dev dependencies, then `nice -n 15 pnpm exec vitest run
  kalfa/config/src/SettingGroup.text.test.ts` shows W1, X1, X2 and X3 red on the branch head (no `jsonSchema` yet);
  each new law timed once at full depth.
- Slice 1, build step: the same path plus `kalfa/config/src/SettingGroup.live.test.ts`,
  `kalfa/config/src/SettingGroup.test.ts` and `kalfa/config/src/SettingGroup.edit.test.ts` green, each plant run once and
  undone; `pnpm format` and `pnpm lint`.
- Slice 2, tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/cli.test.ts oxlint-plugins/layers.test.ts` shows
  C1 to C8 red and C10's pinned table red (no row yet).
- Slice 2, build step: the same paths plus `kalfa/config/src/SettingGroup.test.ts`,
  `kalfa/config/src/SettingGroup.live.test.ts` and `kalfa/config/src/SettingGroup.fileOnly.test.ts` green, each plant run
  once and undone; `pnpm format` and `pnpm lint`, which runs the layer check. `layer-rules.json` is a file that selects
  every test, so the build runs the named test files, never the changed set.
- The lead runs the changed-tests run and one full type check for each slice (X4 and C9 are judged there), and P1 runs
  in CI; none of these runs in a box.

## Size

1. The schema text and the reference text: 155 lines (`internal/reference.ts` 60, `internal/schema.ts` 35,
   `SettingGroup.ts` 30, `internal/check.ts` 20, `internal/window.ts` 6, `Reference.ts` 4), plus one new test file, one
   new support file, an edit to the type laws, and three dev dependencies.
2. The config command: 249 lines (`cli.ts` 115, `internal/cli/listing.ts` 55, `internal/cli/join.ts` 45,
   `internal/start.ts` 12, the package manifest 8, `internal/names.ts` 6, `internal/read.ts` 5, `SettingGroup.ts` 3),
   plus three new test files and edits to the consumer, the package law, both copies of the subpaths, the layer row
   and the layer table, which the tests step writes.

About 5 agent hours across both slices' tests, build and review, 75% sure. The doubt is X3 and C1: both read a text
back with a parser of their own (GFM for the reference, blocks for the listing), and the parse rules for breaks inside
a description take a round to get right. Basis: the 1845 and 1844 plans, priced at about $8 a step for Opus steps.
Steps: tests, build and review for each slice, plus one likely send-back of tests and build in one of them.

Estimate: 8 steps, $64

## New names

- `SettingGroup.jsonSchema` and `SettingGroup.reference`: the protocol's own names.
- `config`: the command, named by its root name; `@kalfa/config/cli`: the entry point the protocol names `/cli`.
- `fields`, `near` in `internal/check.ts`; `text` and `Version` in `internal/schema.ts`; `text`, `escape`, `code` in
  `internal/reference.ts`; `Pattern` in `internal/window.ts`; `load` in `internal/start.ts`; `textSource` in
  `internal/read.ts`; `join` in `internal/cli/join.ts`; `block`, `listing`, `line`, `from` in `internal/cli/listing.ts`;
  `print` in `cli.ts`. Code names inside the package.
- `config.get`, `config.list`, `config.schema`, `config.reference`: span names beside the existing `config.set`.
- `kalfa-config-cli`: the layer row.
- `SettingGroup.text.test.ts` and `cli.test.ts`: test files named for what they test.

## Records

- `kalfa/config/GLOSSARY.md` (slice 1), under "What was loaded" or a new heading "What a person reads":
  - **Reference**, new: "The Markdown page of every setting of an app: its files, its environment variable and flag,
    its default and when a change applies. It is made from the declarations alone, never from a loaded value."
    _Avoid_: docs, manual, settings page.
- No other new domain word: command, subcommand, root name and exit code are CLI's (`kalfa/cli/GLOSSARY.md`), and JSON
  Schema is the industry's term.
- `kalfa/config/README.md`: two sections, one per slice.
- No decision record: the protocol (https://github.com/kamp-us/tea-fabrika/issues/1749) settled the calls, and the calls
  under 80% are easy to change before any caller exists.
- On https://github.com/kamp-us/tea-fabrika/issues/1849, the lead notes that the old `Reference.ts` now imports
  `escape` and `code` from `internal/reference.ts`, and that the root and `./cli` are the two entries that stay.

## What this cannot tell us

- How `@kalfa/cli` mounts the command, and what it prints for each outcome. Every law runs the command through
  `Command.runWith` alone.
- Exit code 1 for a `SettingsError` needs ticket 2000; until then `kalfa` would end such a run with 2.
- Whether an editor's JSON Schema reader (Taplo, Even Better TOML) reads the document as Effect's reader does. X1's
  oracle is Effect's reader only.
- A repo version number above the largest safe integer passes the editor schema and fails the start.
- A description with a blank line or a line that starts with spaces: Markdown reads it as two paragraphs or a code
  block. No law draws one.
- Whether one listing stays readable for an app with many settings. Every law draws four.
- A package's own layer still checks the shared file against its own group only (Finding 1), so the command is the
  only reader that sees every group.

## Open questions

1. `get` prints JSON (`"owner"`) or raw text (`owner`)? Lean JSON, 70%.
2. `list` shows defaults too, no `--all`? Lean yes, 80%.

## Lead's calls at signing (2026-11-23)

- Slice 1 starts now. Slice 2 waits for the owner's answer to open question 1 (does `get` print JSON or raw text), since a person reads it.
- Kept as leaned, each a lead call: the read-fault closing line `<app> would not start with these settings.`; the command's own unknown-name check over `Argument.Literals`; the repo schema's version pattern, with a law for the safe-integer limit it misses; the window check as an `isPattern`, so `jsonSchema` never throws for a live group; how a description's line breaks are written, by a law; the `kalfa-config-cli` layer row, settled by C10's plant.
- Finding 2 (disk `set` and `remove` leave the quiet window out of the check) is fixed in slice 1, with a law: pass `watched(group.settings)` as `edit` does.
- Finding 1 (a package's layer refuses other packages' keys in the shared `.kalfa/kalfa.toml`) goes to the owner as a protocol question. Findings 3 and 4 are filed as their own issues.

## Findings

1. **A package's layer refuses every other package's keys in a shared file.** `SettingGroup.layer(group)` starts with
   `{ app: group.app, settings: watched(group.settings) }` (`kalfa/config/src/SettingGroup.ts`, `layer`), and
   `check` in `kalfa/config/src/internal/check.ts` decodes each file with `onExcessProperty: "error"` over those
   settings only. Every kalfa package's group is app `kalfa`, so all of them share `.kalfa/kalfa.toml` (the
   Reconciliation glossary's "the project's kalfa config"). The second package to declare a setting there makes the
   first one's layer stop with `unknown` at the other's key. This plan's command joins every group and so is not hit;
   a package's own start is. It is a design question for Configuration's protocol
   (https://github.com/kamp-us/tea-fabrika/issues/1749) and CLI's, which builds one layer per subcommand.
2. **`SettingGroup.set` and `SettingGroup.remove` on disk leave the quiet window out of the check.** Both pass `group`
   itself to `disk.set` and `disk.remove` (`kalfa/config/src/SettingGroup.ts`, `set` and `remove`), where `edit` passes
   `{ app, settings: watched(group.settings) }`. So for a group with a live setting, a file that sets
   `config.watch.debounce` makes every disk set and remove fail `unknown` at that key, while `edit` on the same text
   succeeds. The fix is the same `watched` in both calls. This plan's command calls `disk` with the joined group, which
   has the window, so it is not hit.
3. **The root entry already loads `effect/cli`.** `SettingGroup.ts` imports `internal/flags.ts`, which imports
   `effect/cli/Command`, `CommandSpec` and `Flag`, and runs `CommandSpec.resolve(Command.make("x"), ["x"])` when the
   module loads. So a Worker that imports `@kalfa/config` loads `effect/cli` today. This plan keeps the config command's
   own code out of the root (C10), but cannot keep `effect/cli` out without moving `SettingGroup.flags`, which the
   protocol puts on `SettingGroup`. Making `kept` lazy would at least stop the work at load.
4. **The README teaches a duration check that `jsonSchema` will refuse.** `kalfa/config/README.md`, "A setting's value
   is plain data", checks a length of time with a bare `Schema.makeFilter`, which has no JSON Schema form, so
   `jsonSchema` throws for any group that copies it (X2's class (u)). Exporting the window's `Length`, or a pattern like
   it, would give apps one checked duration text; that is a new public name, so it is left out here.

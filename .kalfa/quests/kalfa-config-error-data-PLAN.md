
Plancheck-Version: 3

# Plan: a settings error carries its place and its diagnostic as data (ticket 2000)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2000, found by the plan for
https://github.com/kamp-us/tea-fabrika/issues/1840. It builds the consequence of decision 0088 that Configuration's
error says where it came from as data, and the owner's answer on CLI's protocol
(https://github.com/kamp-us/tea-fabrika/issues/1751#issuecomment-7083852422) that Configuration's errors each say which
diagnostic they are. Words: `kalfa/config/GLOSSARY.md` and `kalfa/diagnostics/GLOSSARY.md`, both unchanged.

Today the root entry's `SettingsError` (`kalfa/config/src/internal/error.ts`) holds `file` and `line` as text. A
variable's or a flag's fault names its place only inside the message, and nothing says whether a file is the repo's or
the user's. This plan replaces `file` and `line` with one `place`, a `Diagnostic.Place` of the right kind, built where
each fault is found, where the kind is still known. The error gains a `diagnostic` getter that carries a declared
`config/...` code, its fault sentence, its place and a fixed hint. Every message stays byte for byte what it is
today. One pull request, about 140 product lines, plus new laws and a move of the existing laws from `file` and `line`
to `place`. The exported list of codes, their full long texts and the law that every error carries one are
https://github.com/kamp-us/tea-fabrika/issues/2099's, which waits on this one.

```ts
// The whole idea, a sketch. Nothing here was type-checked.

// Today (kalfa/config/src/internal/error.ts): where is text, and the kind is lost.
SettingsError { reason: "invalid", file: "~/.demo/demo.toml", line: 2, message: "~/.demo/demo.toml, line 2: net.port is not ..." }
SettingsError { reason: "invalid", file: undefined, line: undefined, message: "DEMO_NET_PORT is not a valid value. ..." }

// After: the place is data, of one of the four kinds decision 0088 names.
SettingsError { reason: "invalid", place: { _tag: "home", path: "~/.demo/demo.toml", line: 2 }, fault: "net.port is not ...", closing: "demo did not start." }
SettingsError { reason: "invalid", place: { _tag: "environment", name: "DEMO_NET_PORT" }, fault: "DEMO_NET_PORT is not ...", closing: "demo did not start." }

error.message      // "~/.demo/demo.toml, line 2: net.port is not ...\n  demo did not start."   (unchanged, now a getter)
error.diagnostic   // Diagnostic.carry(config/invalid, { message: fault, place, hint }), or undefined with no place
```

## Calls under 80%, read these first

- **A missing required setting points at the first file it may be set in, with no line.** 70% sure. Nothing set it,
  so it came from nowhere; the place is where the fix goes. The other way: place it at its variable,
  `<APP>_<NAME>`, when a variable may set it, and at a file only for a file-only setting. I lean to the file because a
  file is where a lasting fix goes and the message names the files first; a variable lasts one shell. Either way its
  message keeps today's text, with no opening (see the shape). Open question 2.

Settled by reading, so not a doubt any more:

- **A fault with no place carries no diagnostic, and `kalfa` ends that run with exit code 2.** 85% sure. Decision
  0084 says "a subcommand that fails with an error that carries a diagnostic ends with exit code 1 ... Any other
  failure stays exit code 2", and `kalfa/cli/src/internal/run.ts` (`exitCode`, `failedWith`) prints
  `kalfa: <message>` and answers 2 for any failure it reads no diagnostic from. So the faults with no place (listed by
  file and line under "Where each place comes from") read as a run that did not finish, which is what they are: a
  snapshot stream, a bad command line, a bug in the program. What is left for the owner is one yes or no on 2099's
  third criterion, which today says every error carries one: open question 1. The other ways are worse under settled
  rules: `.` would make "the whole repo" also mean "nowhere", which 0088 rejected for "somewhere else", and a
  diagnostic with no place reopens Diagnostics' five fields.
- **The codes start `config/`.** The Diagnostics README's example (`config/unknown-setting`) and the owner's answer
  on 1751 ("declares its `config/...` codes") settle the root. Each code is its reason's word, except `unknown`, which
  takes the Diagnostics README's own `config/unknown-setting`.

## How others do it

- **Cargo** records where each config value came from as a kind: a file path, an environment variable, or a
  command-line option (`Definition::Path`, `Definition::Environment`, `Definition::Cli` in
  https://github.com/rust-lang/cargo/blob/master/crates/cargo-util-config/src/definition.rs, cited by decision 0088;
  not fetched again for this plan). Its error for a bad value names the definition. That is this plan's shape: the
  error holds the kind, and the text is made from it.
- **git** prints a value's origin type with `git config --show-origin` (`file:`, `command line:`, `blob:`), per
  https://git-scm.com/docs/git-config (cited by 0088; not fetched again).
- **Effect 4.1.3's CLI** (read in the installed source for the carry plan, `src/cli/CliError.ts`): what to show is a
  getter on a `Schema.TaggedError`, read by a reader that takes any error. `Diagnostic.fromError` is that reader, and
  this plan writes the getter.
- **SARIF 2.1.0** lets a result have no location (`locations` is optional), and rustc prints errors with no span
  (from memory, not fetched). Diagnostics here chose a required place (issue 1751), so a fault with no place carries
  none instead (the call above).
- **In this repo:** `kalfa/cli/src/internal/failure.ts` writes `override get message()` on a `Schema.TaggedError`,
  the precedent for a message made from fields. A tryout on main with the installed Effect 4.1.3
  (`t2000-getter.ts`, in the plan writer's scratch folder, not committed) showed the getter's text is what `String(error)` prints, that
  `message` is then no own property, that `Schema.toCodecJson` writes `fault`, `closing` and `place` and reads back
  the same message, that the constructor throws on a home place with an absolute path and on an environment place with
  a line, and that `Diagnostic.fromError` answers `Some` for a placed error and `None` for one with no place.

## The shape

### The error

```ts
// kalfa/config/src/internal/error.ts, a sketch.
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Hidden from "@kalfa/diagnostics/Hidden";

export class SettingsError extends Schema.TaggedError<SettingsError, { readonly brand: unique symbol }>()(
  "SettingsError",
  {
    reason: Schema.Literals(["version", "syntax", "unknown", "scope", "invalid", "missing", "read", "edit", "write", "snapshot"]),
    /** What is wrong, as one or more sentences: no place and no closing. The diagnostic's message. */
    fault: Schema.String,
    /** The sentence that ends the message: `<app> did not start.`, `<file> was not changed.`, and the rest as today. */
    closing: Schema.String,
    /** Where the fault is, of the kind it is. Left out only for a fault with no place. */
    place: Schema.optionalKey(Diagnostic.Place),
    cause: Schema.optional(Hidden.Cause),            // unchanged: it still wraps the failure beneath
  },
) {
  /** Today's text, byte for byte: a file's place opens it (`<path>, line <n>: `), every other kind already names itself in `fault`. */
  override get message(): string;

  /** The diagnostic it carries: its reason's code, `fault`, `place` and the reason's hint. None when it has no place. */
  get diagnostic(): Diagnostic.Carried | undefined;
}

// Removed: `file`, `line` and the `Position` interface. Every caller passes a `Diagnostic.Place` instead.
export const stop: (
  app: string,
  reason: SettingsError["reason"],
  fault: string,
  place?: Diagnostic.Place,          // was `position?: Position`; same argument slot, so snapshot.ts and receive.ts do not change
  cause?: unknown,
  closing?: string,
) => SettingsError;
```

- `message` stays the same text because its opening is made by the same rule as today: a fault found in a file opens
  with the file and line. Today a `Position` is only ever a file, and a variable's or a flag's fault already starts
  `fault` with its own name (`--net.port: ...`, `DEMO_NET_PORT is not ...`). Making an opening for those kinds too
  would change their messages, and laws RF2, RF4 and F5 pin them.
- **One exception, keyed by reason: a `missing` error never opens.** Its place says where to fix it, not where it was
  found, and today's text (`<name> is required, and nothing sets it. Set it in <places>.`) has no opening. 80% sure.
  The other way, a new text that opens with the file, would change a message no person asked to change, and would put
  the file twice in one sentence. The law P10 holds every message to today's text, `missing` included.
- `place` is `Schema.optionalKey`, as an ordinary optional field is (the cause pattern's note N8); `cause` keeps
  `Schema.optional`. `fabrika/inner-cause` still passes: the class keeps its `cause` field, and a place is no failure.
- The constructor checks `place` against `Diagnostic.Place`, so a home place with an absolute path or a login, or an
  environment place with a line, throws where it is made. The tryout showed it.

### The codes and hints

Declared once at the top of `error.ts` with `Diagnostic.make`, each with a one-sentence long text, and not
exported. Ticket 2099 owns the exported list for `Subcommand.make`, the full long texts and the law that every
error carries a code; this plan gives it the nine declared codes to export.

| Reason | Code | Hint (exact, one fixed sentence) |
|---|---|---|
| `version` | `config/version` | Install a newer release of the app, or lower the repo's minimum version. |
| `syntax` | `config/syntax` | Fix the text at this place so the file can be read. |
| `unknown` | `config/unknown-setting` | Check the name against the app's settings reference, or remove the key. |
| `scope` | `config/scope` | Set it in one of the places the message names. |
| `invalid` | `config/invalid` | Give a value that keeps the rule the message names. |
| `missing` | `config/missing` | Set it in one of the places the message names. |
| `read` | `config/read` | Check that the app may read this place, then run it again. |
| `edit` | `config/edit` | Make this change by hand in the file. |
| `write` | `config/write` | Check that the folder is there and may be written, then run it again. |

Each code's long text here is one sentence that says what the reason means, in the words of `SettingsError`'s doc
comment today; the builder writes it, and 2099 may grow it. `snapshot` gets no code: it never has a place. A hint never names the app, a value, a path or a login:
it is the same for every fault of its reason, so nothing private can reach it.

### Where each place comes from

The kind is known where each fault is found, so each place is built there and nothing parses a name:

| Fault, where it is found | Place |
|---|---|
| a file's fault with a line: `check.ts` `explain` and `version`, `place.ts` `parse`, `change.ts` `refuse` | `repo` for the repo file, `home` for the user file, with the line when known |
| a file's fault with no line: `place.ts` `contents`, `disk.ts` `fail` (its lock file too), `check.ts` `unfit` | the same kinds, no line |
| a value refused from a source: `read.ts` `resolve`, through `check.ts` `refused` | the source's own: the file and line, `environment` with the variable's name, or `flag` with `--<name>` |
| a file-only setting given a flag or named by a variable: `read.ts` `resolve` | `flag` `--<name>`, or `environment` `<APP>_<NAME>` |
| the environment does not answer: `place.ts` `lookup`, `read.ts` `holder` and `resolve` | `environment`: `HOME`, `<APP>_HOME`, or the setting's variable |
| a required setting nothing sets: `read.ts` `resolve` | the first file the setting may be set in, no line (open question 2) |
| an edit that cannot be made as one key, or would change other data: `change.ts:118-136` | the file's kind; the key's line for a conflict, else no line |
| a value `config set` was given that the schema refuses: `Cli.ts:136`, through `check.ts` `unfit` | the kind of the file `--file` or the setting picked, no line |
| an edit of a setting that is not the group's: `change.ts:76` | the file's kind, no line |

Every site that builds an error with no place, on main:

| Site | Fault | After this plan |
|---|---|---|
| `kalfa/config/src/Cli.ts:42` (`named`), called by `config get` at `Cli.ts:87` and by `config set` and `remove` at `Cli.ts:106` | a typed name that is no setting | no place, no diagnostic |
| `kalfa/config/src/Cli.ts:137` | the value `config set` was given cannot be read as text (a `textSource` never fails, so no run reaches it) | no place, no diagnostic |
| `kalfa/config/src/internal/snapshot.ts:85` (`refuse`), used at `:88`, `:92`, `:101`, `:106`, `:119`, `:145` and `:155` | a snapshot that does not fit | no place, no diagnostic |
| `kalfa/config/src/internal/receive.ts:39` | the stream ended before its first snapshot | no place, no diagnostic |
| `kalfa/config/src/internal/check.ts:234` (`refused`, its `default` branch) | a default its schema refuses (no run reaches it: `SettingGroup.make` checks every default) | no place, no diagnostic |
| `kalfa/config/src/internal/read.ts:64` | the running app's own version is not a version | dies, no error (call below) |

**The running app's own version that is not a version stops the program.** 80% sure. It is the program's own
argument (`SettingGroup.layer(group, { version })`), so no person who edits a settings file can fix it.
`read.ts:213` already dies for the other fault only a program's author makes (a schema that gives a value that is not
plain data), and `SettingGroup.make` throws at load for a bad declaration. So `read.ts:64` becomes `Effect.die` with
an `Error` that names the version's rule and not the text, as `read.ts:213` does. No law pins today's `invalid` for it
(`rg -n "is not a version" kalfa/config/src` finds only the product line). The cost: a program that passes a bad
version now crashes its start in place of failing typed, which is what a bug in the program should do.

Three small changes carry the kind to where the place is built:

```ts
// kalfa/config/src/internal/place.ts, a sketch.
export interface Place { readonly path: string; readonly name: string; readonly file: Setting.File }  // `file` is new

/** A configuration file's place: `repo` for the repo file, `home` for the user file, with its line when known. */
export const inFile = (file: Setting.File, name: string, line?: number): Diagnostic.Place;

// kalfa/config/src/internal/check.ts: `refused` takes the place, not the origin. The message names the variable
// or the flag for those kinds, and the setting otherwise, exactly as today.
export const refused: (app: string, s: Setting.Any, place: Diagnostic.Place | undefined, issue: SchemaIssue.Issue, closing?: string) => SettingsError;

// kalfa/config/src/internal/read.ts: each source `resolve` reads keeps its place beside it. Sources.Source is not changed.
interface Placed extends Source { readonly place: (origin: Origin) => Diagnostic.Place | undefined }
```

`disk.ts`'s `Call` gains `file: Setting.File`, which `locate` already knows, and `follow.ts` reads
`kalfa.config.line` from the place's line. Product code builds each place with its kind's maker,
`Diagnostic.Place.cases.<kind>.make`, never an object literal (`anti-slop-effect/no-manual-tagged-construction` is on
for `kalfa/**`), and leaves `line` out when there is none.

## One value traced

The user file under `HOME` sets `net.port = 80`, and the setting's schema asks for more than 1023.

1. `readUser` calls `load` with the place `{ path: "<home>/.demo/demo.toml", name: "~/.demo/demo.toml", file: "user" }`.
2. `check(group, "user", found, ...)` finds the issue at `net.port`. `explain` asks `lineAt` for the key's line: 2.
3. `explain` calls `refused(app, s, inFile("user", "~/.demo/demo.toml", 2), issue, closing)`.
4. `inFile` makes `Diagnostic.Place.cases.home.make({ path: "~/.demo/demo.toml", line: 2 })`. The maker checks it:
   `~/` then good parts.
5. `refused` names the setting, since the place is a file: `stop(app, "invalid", "net.port is not a valid value.
   Expected a value greater than 1023.", place, undefined, "demo did not start.")`.
6. The constructor checks `place` against `Diagnostic.Place` again and keeps it.
7. `error.message` is `"~/.demo/demo.toml, line 2: net.port is not a valid value. Expected a value greater than
   1023.\n  demo did not start."`, today's text.
8. `error.diagnostic` is `Diagnostic.carry(Invalid, { message: error.fault, place: error.place, hint: "Give a value
   that keeps the rule the message names." })`.
9. Under `TestDiagnostics.layer`, `Diagnostics.report(carried.declared, carried.fields)` records `{ code:
   "config/invalid", severity: "error", message: "net.port is not ...", place: { _tag: "home", path:
   "~/.demo/demo.toml", line: 2 }, hint: "Give a value ..." }`. Nothing in it holds `<home>`, the login or `80`.

## Generators

Every law draws `PlaceDraw` in `kalfa/config/src/Cli.places.test-support.ts`: the refusals laws' `RuleDraw`
(`Cli.refusals.test-support.ts`: app, words, bound, pad, and a home folder `/people/<login>`, a repo folder and a
moved folder), a secret-looking value, and a drawn login. Each run builds one case for every class below from the
drawn seeds, never the cross product, and `Reach.done` fails when a class was not reached. A class reuses the
refusals runners (`startOn`, `onDisk`, `edited`, `command`, `failing`, `plant`) and their scenes.

Faults with a file's place:

- (r) the repo file holds a refused value at a drawn line: `invalid`, `repo`, the key's line.
- (h) the user file under `HOME` holds a refused value at a drawn line: `invalid`, `home` `~/.<app>/<app>.toml`, the
  line.
- (m) the user file under `$<APP>_HOME` holds a refused value at a drawn line: `invalid`, `home`
  `$<APP>_HOME/<app>.toml`, the line.
- (s) a file that is not TOML, the repo's or the user's by a drawn bit: `syntax`, that file's kind, the parser's line.
- (u) the user file holds a key no setting has, at a drawn line: `unknown`, `home`, the line.
- (v) the repo file asks for a newer app: `version`, `repo`, the version key's line.
- (q) a required setting that nothing sets, whose first file is the repo's or the user's by a drawn bit: `missing`,
  that file's kind, no line.
- (d) a disk set whose file read is refused: `read`, `repo`, no line.
- (w) a disk set whose lock is held: `write`, `repo` `.<app>/<app>.toml.lock`, no line.
- (x) an edit of a text that sets a setting in a file it may not be set in: `scope`, that file's kind, no line.
- (c) an edit of a text where the format answers that the setting is not one key (its `Conflict`,
  `change.ts:126-133`): `edit`, that file's kind, the key's line.
- (i) `config set` with a value the setting's schema refuses (`Cli.ts:136`), the file picked by `--file` or by the
  setting's first file, by a drawn bit: `invalid`, that file's kind, no line.
- (j) an edit, through `SettingGroup.edit(group, ...)`, of a setting cast in from another group (`change.ts:76`):
  `unknown`, that file's kind, no line.

Faults with a variable's or a flag's place:

- (e) the setting's variable holds a refused value: `invalid`, `environment` `<APP>_<NAME>`.
- (f) the setting's flag holds a refused value: `invalid`, `flag` `--<name>`.
- (o) a variable names a file-only setting: `scope`, `environment` `<APP>_<NAME>`.
- (g) a hand-built flags record gives a file-only setting a value: `scope`, `flag` `--<name>`.
- (n) the environment does not answer where `HOME` or `<APP>_HOME` is read, by a drawn bit: `read`, `environment`
  with that name.
- (a) the environment does not answer where the setting's variable is asked for or read, by a drawn bit: `read`,
  `environment` `<APP>_<NAME>` (the message names the setting, as RF4 holds).

Faults with no place:

- (k) a snapshot stream that ends before its first item: `snapshot`.
- (t) `config get`, `config set` or `config remove`, by a drawn pick, with a typed name that is no setting
  (`Cli.ts:42`): `unknown`.

A fault that is no `SettingsError` any more (P11):

- (b) a start whose repo file asks for a minimum version, run with a running version that is not a version
  (`read.ts:64`).

Places the constructor must refuse (P5), drawn from the login and the folders:

- (p) a `home` place with the absolute path `/people/<login>/.<app>/<app>.toml`, a `home` place `~<login>/...`, a
  `repo` place that starts with `~/`, and an `environment` place with a line.

## Laws

Test laws run `runsFor({ fast: 25, full: 100 })` runs. No law here is host-only, and none is an `.integration.` law:
every fault runs on the in-memory disk and the stand-in environment the refusals laws use.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| P1, each fault holds the place of its source: in each run, for each class (r), (h), (m), (s), (u), (v), (q), (d), (w), (x), (c), (i), (j), (e), (f), (o), (g), (n) and (a), the call fails with exactly one `SettingsError` whose `reason` is the class's and whose `place` equals (`toEqual`) the place the class names, written in the support file from the Generators list and never from the code: its kind, its path or name, and its line where the class has one and no `line` key where it has none. Classes (c), (i) and (j) are in the list too. 100 runs | test | Effect Arbitrary: PlaceDraw | (r) build a file's place as `repo` whatever the file: (h) red; (h) name the user file by its real path: the constructor throws, red; (m) place `$<APP>_HOME` as `~/.<app>/<app>.toml`: red; (s) drop the parser's line: red; (u) take the line of the table, not the key: red; (v) place the version fault with no line: red; (q) leave `missing` with no place: red; (d) give a read fault the key's line: red; (w) place a held lock at the file, not the lock: red; (x) place an edit's refusal at the other file: red; (c) drop the conflict's line: red; (i) place `config set`'s refusal at the setting's first file whatever `--file` says: red; (j) leave an edit's `unknown` with no place: red; (e) give a refused variable no place: red; (f) place a refused flag as `environment`: red; (o) place a file-only variable at the repo file: red; (g) name the flag without `--`: the constructor throws, red; (n) place `HOME`'s failure at the setting's variable: red; (a) place the setting's variable as its setting name: the constructor throws, red | kalfa/config/src/Cli.places.test.ts |
| P2, a fault with no place carries none: for (k) and (t), the error has no `place` key and `Diagnostic.fromError(error)` is `None`; for every class of P1, it is `Some`. 100 runs | test | Effect Arbitrary: PlaceDraw | (k) give a snapshot fault the repo file's place: red; (t) give a typed name the place `.`: red; carry a diagnostic with the place `.` when there is none: (k) red; the getter answers `undefined` always: P1's classes red | kalfa/config/src/Cli.places.test.ts |
| P3, what a fault carries is reported as is: for every class of P1, `Diagnostics.report(carried.declared, carried.fields)` under `TestDiagnostics.layer` succeeds (a bad place, a blank message or a blank hint makes it die), and `TestDiagnostics.reported` is exactly one item: `code` is the code the plan's table gives the reason (`config/unknown-setting` for `unknown`), `severity` is `error`, `message` equals `error.fault`, `place` equals `error.place`, and `hint` is the hint the plan's table gives the reason, written in the support file from that table. 100 runs | test | Effect Arbitrary: PlaceDraw | carry `error.message` as the message: it opens with the place and ends with the closing, red; carry the hint of `invalid` for every reason: (s) red; carry the code of `read` for a `write`: (w) red; carry `config/unknown` for `unknown`: (u) red; carry a place built from `origin` and not `place`: (h) red | kalfa/config/src/Cli.places.test.ts |
| P4 [secrets], nothing private in a place or a diagnostic: for every class of P1 with the drawn secret as the refused value where the class refuses one, and the drawn login in the home folder, the repo folder and the moved folder, no needle (the secret, the login, each folder) appears raw, JSON-escaped or URL-encoded (`forms` in `Cli.refusals.test-support.ts`) in `JSON.stringify(error.place)`, `JSON.stringify(carried.fields)`, the reported item, or `Schema.encodeSync(Schema.toCodecJson(SettingsError))(error)`. 100 runs | test | Effect Arbitrary: PlaceDraw | write the refused value into `fault` for (e): red; name the user file by `~<login>` in place of `~`: the constructor throws in (h), red; write the real path into the hint for (d): red | kalfa/config/src/Cli.places.test.ts |
| P5, the constructor refuses a bad place: for each place of class (p), `new SettingsError({ reason: "invalid", fault, closing, place })` throws; the same call with the class's good twin (`~/.<app>/<app>.toml`, `.<app>/<app>.toml`, an environment place with no line) does not, and keeps the place. 100 runs | test | Effect Arbitrary: PlaceDraw | (p) type `place` as a plain struct of strings in place of `Diagnostic.Place`: the absolute path is kept, red; construct with `disableValidation`: red | kalfa/config/src/Cli.places.test.ts |
| P7, the messages stay as they were: RF1 to RF9 in `Cli.refusals.test.ts`, the edit, disk, file-only, flags, live, snapshot and start laws, and the command's laws in `Cli.test.ts` stay green with their texts unchanged; only their reads of `file` and `line` move to the place | test | pinned: their own generators and cases, texts unchanged | make an opening for every kind of place: RF4's and F5's messages gain `<NAME>: `, red; drop the `, line <n>` opening: RF1 red; drop the closing: every message law red | kalfa/config/src/Cli.refusals.test.ts |
| P8 type, the error's new shape: `SettingGroup.SettingsError["place"]` is exactly `Diagnostic.Place \| undefined`; `["diagnostic"]` is exactly `Diagnostic.Carried \| undefined`; `"file"` and `"line"` are not keys of `SettingsError`; `fault` and `closing` are `string`; and `new SettingsError({ reason: "invalid", fault, closing, place: { _tag: "environment", name: "X", line: 1 } })` does not compile (`@ts-expect-error`) | type | type | keep `file: Schema.optional(Schema.String)` beside `place`: the key law fails; type the getter `Diagnostic.Carried`: the exact-type line fails; type `place` as `Schema.Unknown`: the `@ts-expect-error` is unused | kalfa/config/src/SettingGroup.types.test.ts |
| P10, every message is today's text: in each run, for every class of P1 and P2, `error.message` equals (`toBe`) the text the support file writes for the class from today's wording (the opening `<file>, line <n>: ` for a fault found in a file, none for `missing`, a variable or a flag, then the fault sentence, a line break, two spaces and the closing), never read from the getter or from `fault`. 100 runs | test | Effect Arbitrary: PlaceDraw | (q) open `missing` with its file place: red; open a variable's fault with `<NAME>: `: (e) red; drop `, line <n>`: (r) red; drop the closing: every class red | kalfa/config/src/Cli.places.test.ts |
| P11, the running app's own bad version stops the program: for (b), the start's `Exit` is a failure whose cause holds a defect, an `Error` whose message names the version's rule (`as 1.2.3`) and does not hold the drawn version text, and no `SettingsError`. 100 runs | test | Effect Arbitrary: PlaceDraw | (b) keep today's `stop(app, "invalid", ...)`: the failure is a `SettingsError`, red; put the version text in the `Error`'s message: red | kalfa/config/src/Cli.places.test.ts |
| P9 lint, the class still keeps its cause: `pnpm lint` passes with `fabrika/inner-cause` and `fabrika/hidden-cause` on `internal/error.ts` | lint | lint | write `cause: Schema.optionalKey(Hidden.Cause)`: `fabrika/hidden-cause` red | kalfa/config/src/internal/error.ts |

Each guarding check has a class that reaches it. The constructor's schema check on `place` is reached by (p), which
passes every earlier step since it is built directly, and P5 plants its deletion. The getter's `place === undefined`
check is reached by (k) and (t), and P2 plants its deletion. The `missing` exception in the opening is reached by
(q), and P10 plants its deletion. `fromError`'s own mark check is Diagnostics' and
its laws hold it.

A type derived from a value: none. `place`'s type is `Diagnostic.Place`'s, declared, not read off a value, and
`stop`'s `place` is one optional argument with no type arguments. The one type hole is that `Place`'s `path` is a
plain `string` in the type, so an absolute path compiles; the constructor refuses it at run time (P5).

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/error.ts | build | 60 | `fault`, `closing` and `place` in place of `message`, `file` and `line`; the `message` getter with the `missing` exception, and the `diagnostic` getter; the nine codes, not exported, each with a one-sentence long text, and the hint per reason; `stop` and `unread` take a place; `Position` goes; the class's doc comment |
| kalfa/config/src/internal/place.ts | build | 12 | `Place` gains `file`; `inFile`; `lookup` places its variable; `parse`, `contents` and `load` take the file's kind |
| kalfa/config/src/internal/read.ts | build | 28 | each source of `resolve` keeps its place; `holder`, the file-only checks, `missing` and the decode's faults pass places; `readUser` passes `file: "user"`; `supported` dies for a running version that is not a version (line 64) |
| kalfa/config/src/internal/check.ts | build | 15 | `version` and `explain` pass file places; `refused` takes a place; `unfit` takes the file's kind |
| kalfa/config/src/internal/change.ts | build | 3 | `refuse` builds its place from `place.file` |
| kalfa/config/src/internal/disk.ts | build | 6 | `Call` gains `file`; `fail` builds its place |
| kalfa/config/src/internal/follow.ts | build | 2 | the warning's `kalfa.config.line` from the place's line |
| kalfa/config/src/Cli.ts | build | 4 | `unfit` with the chosen file's kind; `named` passes no place |
| kalfa/config/src/SettingGroup.ts | build | 2 | the re-export's doc and `layer`'s doc say place and diagnostic; no new export (2099's) |
| kalfa/config/src/internal/snapshot.ts | build | 0 | no change expected: it passes no place in the same slot |
| kalfa/config/src/internal/receive.ts | build | 0 | no change expected: it passes no place |
| kalfa/config/README.md | build | docs | "When a start is refused, and why": a paragraph on `place`, `diagnostic`, the codes and when none is carried, and that a bad running version stops the program |
| kalfa/config/src/Cli.places.test-support.ts | tests | tests | new: `PlaceDraw`, the classes, the expected place and hint of each, built on the refusals runners |
| kalfa/config/src/Cli.places.test.ts | tests | tests | new: P1 to P5, P10 and P11. It alone imports `@kalfa/diagnostics/Diagnostic`, `Diagnostics` and `TestDiagnostics` (a test file keeps only the rank rules, so `layer-rules.json` does not change) |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | P8 |
| kalfa/config/src/Cli.refusals.test-support.ts | tests | tests | P7: `refusal` reads the place; one helper gives the file a person reads and the line from a place, for every law that read `file` and `line` |
| kalfa/config/src/Cli.refusals.test.ts | tests | tests | P7: RF1 to RF4 read the place; RF8 constructs with `fault` and `closing` |
| kalfa/config/src/Cli.test.ts | tests | tests | P7: reads of `line` move to the place |
| kalfa/config/src/Cli.test-support.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.cleanup.test-support.ts | tests | tests | P7: `answer` reads the place (line 238) |
| kalfa/config/src/SettingGroup.disk.test-support.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.disk.test.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.edit.test-support.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.edit.test.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.fileOnly.test.ts | tests | tests | P7: the same; "no file" becomes the variable's or the flag's place |
| kalfa/config/src/SettingGroup.flags.test.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.live.test.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.snapshot.test-support.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | P7: the same |
| kalfa/config/src/SettingGroup.integration.test.ts | tests | tests | P7: one read of the file moves to the place; runs in CI |
| kalfa/config/src/SettingGroup.hidden.types.test.ts | tests | tests | P7: its `new SettingsError` takes `fault` and `closing` |
| kalfa/github/src/Settings.test.ts | tests | tests | P7: lines 172-173 read `error.file` and `error.line` of a `SettingsError`; they move to the place (a `repo` place `.demo/demo.toml` with the key's line) |
| kalfa/config/src/SettingGroup.hidden.test.ts | tests | tests | P7: HC2's round trip reads back the message from `fault`, `closing` and `place`; no change expected beyond that |
| kalfa/diagnostics/src/Diagnostic.test-support.ts | tests | none | not changed: read for its bad places, not imported (Existing tools) |
| kalfa/config/GLOSSARY.md | build | docs | no change: no new domain word (see New names) |
| layer-rules.json package.json pnpm-lock.yaml | tests | none | not changed: `@kalfa/config` already depends on `@kalfa/diagnostics`, and its product row already imports it |

The search ran over all of `kalfa/` (`rg -n "\b(error|found|e|err|failure|refusal)\??\.(file|line)\b" kalfa`, and
`rg -n "SettingsError" kalfa` outside `kalfa/config`). Outside `kalfa/config`, only `kalfa/github/src/Settings.test.ts`
reads a `SettingsError`'s `file` and `line`; the `kalfa/quality` hits read their own reports. The tests step reruns
the search and moves any other read the same way; `TomlParser.test.ts` reads the parser's own fault and stays.

## How this fits the open Config tickets

- **https://github.com/kamp-us/tea-fabrika/issues/2099** (every settings error carries a declared `config/` code,
  and the codes are exported) is blocked by this ticket and overlaps it most. Split: this plan declares the nine codes
  in `error.ts` with one-sentence long texts, and carries them; 2099 owns the exported list for `Subcommand.make`, the
  full long texts, and its law that every error carries a diagnostic. Order: this ticket first, as 2099 says. 2099's
  third criterion reads "a law fails when an error the new API can fail with carries no diagnostic"; under this plan
  the faults listed with no place carry none, so that criterion needs narrowing to errors that have a place (open
  question 1). 2099's second criterion names "a mistyped key (reported by `kalfa config`)": that is this plan's
  `config/unknown-setting`.

- **https://github.com/kamp-us/tea-fabrika/issues/2057** (a start ignores keys other packages own) changes
  `internal/check.ts` and the start's `unknown` path, the same files whose `stop` calls this plan changes. Order:
  this ticket first, 70% sure. It changes the signature every refusal goes through, so 2057's new refusals are then
  written with a place from the start; the other way round, this plan would have to place 2057's new sites too. Either
  order works with one rebase. 2057's `unknown` from the joined check gets `config/unknown-setting` and a file place for free.
- **https://github.com/kamp-us/tea-fabrika/issues/2055** (the root entry runs `effect/cli` at load) touches
  `SettingGroup.ts`'s import of `internal/flags.ts`; this plan adds an export to the same file. No order. One thing
  for 2055's plan: this plan adds nine `Diagnostic.make` calls at the top of `error.ts`, which the root entry imports.
  They load no `effect/cli` module, so 2055's first law holds; if 2055 falls back to "nothing runs at load", that law
  must allow declared codes, which Diagnostics' README says to declare at a module's top level.
- **https://github.com/kamp-us/tea-fabrika/issues/2056** (the README's duration check) changes the README section "A
  setting's value is plain data"; this plan changes "When a start is refused, and why". No overlap, no order.
- **https://github.com/kamp-us/tea-fabrika/issues/2370** (CU1 checks the Warn level) changes
  `SettingGroup.cleanup.test-support.ts`'s `holdsCleanup`; this plan changes the same file's `answer` (line 238). No
  order; the second to land rebases one line.

## Existing tools

- `Diagnostic.Place`, `Diagnostic.carry`, `Diagnostic.make` and `Diagnostic.fromError` in
  `kalfa/diagnostics/src/Diagnostic.ts`: used as they are. Searched the package for a place made from a Configuration
  file name (none: 0088 says the package never reads the home folder).
- The `message` getter in kalfa/config/src/internal/error.ts: searched the kalfa packages for a message made from
  fields (`rg -n "get message" kalfa`); `kalfa/cli/src/internal/failure.ts` is the shape copied. The opening keeps
  today's `opening` function, fed from the place.
- The `diagnostic` getter in kalfa/config/src/internal/error.ts: searched `kalfa/` for a getter that carries one
  (`rg -n "get diagnostic" kalfa`); only Diagnostics' README and its type laws, whose shape is copied.
- `inFile` in kalfa/config/src/internal/place.ts: searched `place.ts`, `names.ts` and `check.ts` for a function that
  knows a file's kind and name together; `shown` and `fileNames` give names only, and `Origin` (`Sources.ts`) names a
  file with no kind. No helper fits, so `inFile` is new, three lines over `Diagnostic.Place.cases`.
- The `place` beside each source in kalfa/config/src/internal/read.ts: searched `Sources.ts` for a source that knows
  its kind. `Source.origin` gives an `Origin`, which names a file by text; changing `Origin` would change a public
  schema and the snapshot format, so `read.ts` keeps the place beside the source, inside the module.
- Test support: searched `kalfa/diagnostics/src/Diagnostic.test-support.ts` for bad places (`brokenPlaces`). The file
  is not exported from the package and sits in another package, so class (p) draws its own four places. The runners,
  scenes, `forms`, `Reach` and the needles are the refusals laws', imported.

## Calls taken

- **`file` and `line` go, with no getters left in their place.** 80% sure. One stored fact; a `file` string beside
  `place` could disagree with it, and a getter would be a second name for the place. Pre-release, so nothing outside
  the repo reads them. The cost is about 50 reads in the laws, moved by one helper.
- **`message` becomes a getter made from `fault`, `place` and `closing`.** 85% sure; the tryout showed it prints,
  encodes and reads back. Without it, the diagnostic's message would have to be cut out of the full text.
- **Every message stays byte for byte.** 90% sure. The pinned message laws are the guard, and no person asked for new
  words.
- **One fixed hint per reason.** 80% sure. A hint built from the fault would repeat the message's "Did you mean" and
  "Set it in" parts, which already say what to do. A fixed sentence cannot carry a value or a path.
- **The codes live beside the error, and their export is 2099's.** 85% sure. The owner's answer on 1751 says
  "its own codes, beside its errors"; 2099's sixth criterion is the exported list.
- **`missing` never opens its message.** 80% sure; see the shape.
- **A running version that is not a version dies.** 80% sure; see "Where each place comes from".
- **No new error class and no new cause.** 95% sure. The class already keeps its failure in `cause`
  (`.kalfa/patterns/effect-errors-keep-their-cause.md`); a place is data, not a failure.
- **The older `SettingsError` in `kalfa/config/src/Files.ts` is not changed.** 85% sure. The ticket names the root
  entry's class. The older modules serve `next/`'s settings and carry no place; Findings 1.
- **Is this a setting?** No. The codes and hints are the package's declared words, the same in every repo, and
  whether a fault has a place is a fact of where it was found.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/Cli.places.test.ts kalfa/config/src/Cli.refusals.test.ts
  kalfa/config/src/SettingGroup.test.ts kalfa/config/src/SettingGroup.types.test.ts` shows P1 to P5, P8, P10 and P11 red on the
  branch head (no `place` yet), and the moved laws red only where they read `place`. It records the plants it ran.
- Build step: the test files of the files table green, run by path in groups of three or four; each plant run once
  and undone; `pnpm lint` for P9.
- The lead runs `--changed origin/main` and one `pnpm typecheck`; CI runs `SettingGroup.integration.test.ts`.

## Size

1. One pull request: 132 lines (`error.ts` 60, `read.ts` 28, `check.ts` 15, `place.ts` 12, `disk.ts` 6, `Cli.ts` 4,
   `change.ts` 3, `follow.ts` 2, `SettingGroup.ts` 2), a README paragraph, two new test files and moved reads in
   about 19 test files. It lands whole: a place with no diagnostic leaves the ticket's second
   criterion undone, and the diagnostic cannot be built without the place.

About 3 agent hours across tests, build and review, 75% sure. The doubt is the move of the existing laws: about 50
reads across 19 files, which may take a send-back. Basis: the cleanup plan priced its Opus steps at about $8; this one
has more test files to touch, so about $12 for tests, $10 for build, $8 for review, and one likely send-back of tests
and build at $10 each.

Estimate: 5 steps, $50

## New names

- `fault` and `closing`, fields of `SettingsError`: the sentence of what is wrong, which is the diagnostic's message,
  and the sentence that ends the printed message. Code names; the domain word is Diagnostics' **Message**, so no
  glossary line. `fault` is the word the class's doc comment already uses.
- `place`, a field of `SettingsError`: Diagnostics' **Place**, as its glossary defines it.
- `diagnostic`, a getter: the name Diagnostics' `fromError` reads.
- `config/version`, `config/syntax`, `config/unknown-setting`, `config/scope`, `config/invalid`, `config/missing`,
  `config/read`, `config/edit`, `config/write`: codes, each the reason's own word except `unknown`, which takes the
  Diagnostics README's own example. They become public when 2099 exports them.
- `inFile`, in `internal/place.ts`; `Placed`, in `internal/read.ts`: internal.
- `PlaceDraw` and `Cli.places.test.ts` with its support file: test names.

## Records

- `kalfa/config/README.md`, in the files table.
- A comment on https://github.com/kamp-us/tea-fabrika/issues/2099, by the lead, once open question 1 is answered:
  its third criterion narrowed, or kept with the choice the owner makes.
- No decision record if the owner takes the two leans: they follow 0084, 0088 and the answer on 1751. If he answers
  open question 1 no (every error carries one, so a place must be found for each, or Diagnostics' place becomes
  optional), that answer is a decision, recorded with the `adr` skill before the build.

## What fact is lost if it is not recorded now

Which kind of place each fault is. Today the call site knows it is the user file, or a flag, and writes a string;
after that, only a parse of the name or the message could get it back, which 0088 rules out. A later reader of the
code could also put `file` back beside `place` for convenience; the class's doc comment says why there is one field.

## What this cannot tell us

- Whether `kalfa` reports these diagnostics as planned: CLI does not read `Diagnostic.fromError` yet
  (`kalfa/cli/src/internal/run.ts`), so exit code 1 for a placed fault is CLI's ticket, not shown here.
- Whether the hints help a person: their words are a first draft, and no person has read them in a run.
- Whether the diagnostic's message reads well when CLI prints it beside its place: some faults start with a small
  letter (`could not be read, because ...`), as today's text does after its opening, and a variable's fault names its
  variable in both the place and the message.
- I did not run the existing laws; the count of moved reads (about 50) is from a search, not a build.

## Open questions

1. Narrow 2099's third criterion to "every error that has a place carries a diagnostic", so the faults with no place (snapshot, typed name in `config`) exit 2 as decision 0084 and `run.ts` already do? Lean yes, 85%.
2. Missing required setting: place = first file it may be set in, no line (not its `<APP>_<NAME>` variable)? Lean yes, 70%.

## Findings

1. **The older `SettingsError` in `kalfa/config/src/Files.ts` carries no place and no diagnostic.** It has only
   `reason`, `message` and `cause`, and `Files.ts`, `Sources.ts` and `Load.ts` build it with the place in the message
   (`refused(location, ...)`). `next/packages/libfabrika/src/settings/Fabrika.ts` and
   `next/packages/libfabrika/src/node/settings/Load.ts` import the older modules. If a `kalfa` subcommand ever fails
   with it, it reads as a run that did not finish. No open ticket moves those callers to the root entry that this
   search found (`gh issue list --search "older modules config"`: none). Out of this ticket.

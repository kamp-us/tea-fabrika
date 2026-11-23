Approved by the lead agent, builds issues 1749, 1806, 1843, 0063, 0088, 0089; body b6f9a62f4be8
Plancheck-Version: 3

# Plan: edit one setting in a configuration file's text, in memory or on disk (ticket 1843)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket
is https://github.com/kamp-us/tea-fabrika/issues/1843, under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749) and
[its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806). Words: `kalfa/config/GLOSSARY.md`. It builds on
the `Setting` and `SettingGroup` that pull request https://github.com/kamp-us/tea-fabrika/pull/1922 landed (ticket
1839). Three pull requests, stacked, each landing whole: the move (about 590 product lines, almost all moved, no
behavior change), the edit in memory (about 215), and the disk half (about 165).

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import { Setting, SettingGroup } from "@kalfa/config"

const approver = Setting.make("delivery.approver", Approver).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who may approve a change request."),
)
const Demo = SettingGroup.make("demo", port, approver)

const text = [
  "# Who may approve.",
  "[delivery]",
  'approver = "people"   # the default',
  "",
].join("\n")

// Slice 2, in memory: pure, no file system.
SettingGroup.edit(Demo, text, "repo").set(approver, "owner")
// Result.succeed('# Who may approve.\n[delivery]\napprover = "owner"   # the default\n')
// Only the value's text changed. The comment, its three spaces and every other line are the same bytes.

SettingGroup.edit(Demo, text, "repo").set(port, 4100)
// Result.fail(SettingsError { reason: "scope", file: ".demo/demo.toml", message:
//   ".demo/demo.toml: instance.port may be set only in ~/.demo/demo.toml, or as DEMO_INSTANCE_PORT.\n" +
//   "  .demo/demo.toml was not changed." })

// Slice 3, on disk: read the file, run the same edit, write it back with one rename.
yield* SettingGroup.set(Demo, approver, "owner", "repo", { repo: "." })
// Effect<void, SettingsError, FileSystem | Path>, in the span config.set
```

## Doubts, at the top

Three calls are under 80%. The plan takes each lean and goes on.

- **Two new reasons on `SettingsError`: `edit` in slice 2, `write` in slice 3 (75%).** `edit`: this change cannot be
  made in this text as one key, or the edited text would change other data. `write`: the file could not be written.
  None of the seven reasons fits either one. The doubt is the words, and type law T5 pins the list. The fallback for
  `edit` is `invalid`, a one-line change. Markdown's set plan picked the same word `edit` for the same case, so the
  two packages agree.
- **The disk write uses git's lock file (75%), slice 3.** It creates `<file>.lock` only if none exists, writes the
  new text into it and renames it over the file. That stops two writers from losing one change, and a watcher never
  sees a half-written file. The cost: after a crash, a stale lock blocks every edit of that file until a person
  removes it, and the message says how. The fallback is a temp file with a unique name and the same rename, which
  drops the stale-lock problem and lets a lost update back in.
- **Only the app's own folder is created (75%), slice 3.** A set into a repo with no `.demo/` folder makes `.demo/`,
  and a missing parent is a `write` error. The doubt: `$DEMO_HOME` set to a folder that does not exist fails rather
  than being made.

The first round's fourth doubt, a `remove` that skips the file-scope check, is dropped: `remove` checks file scope as
`set` does (see "What the edit does").

## Slices

Each slice is its own pull request on its own branch, stacked in this order. Each lands whole.

1. **The move**, branch `fabrikalfa/kalfa-config-edit-move`: this worktree's branch, `fabrikalfa/kalfa-config-edit`,
   renamed, or a new branch from it. The TOML code moves into `internal/toml.ts` behind an unexported `Format`; the
   whole-file check moves out of `start.ts` into `internal/check.ts`, and finding and reading the files moves into
   `internal/place.ts`. No behavior changes. The TOML lint exemption and `settings-imports.test.ts` follow the
   parser's import. Every existing law stays green with no edit.
2. **Edit one key in memory**, branch `fabrikalfa/kalfa-config-edit-memory`, from slice 1's branch. Adds
   `SettingGroup.edit` with `set` and `remove`, the checks around the splice, the check after it, and the reason
   `edit`. A caller such as adopt can then edit main's copy of the file with no working copy.
3. **The disk half**, branch `fabrikalfa/kalfa-config-edit-disk`, from slice 2's branch. Adds `SettingGroup.set` and
   `SettingGroup.remove` on disk: the lock file and rename, the app's folder, a followed link, the reason `write`, the
   in-memory stand-in's new calls and the real-file law.

Slice 1 comes first because it holds the moved code: once it lands, slices 2 and 3 show only new logic.

## How others do it

Read, unless marked "from memory". No web request was made.

- **Elm (from memory).** A pure edit is a function `String -> Result Error String`: nothing runs or waits. That is
  `SettingGroup.edit`. The disk half is a command, the only part that touches the world.
- **Erlang/OTP.** Nothing here is a process, so no OTP answer applies. Not read.
- **git config (from memory).** `git config` writes through a lock file: it creates `config.lock` with an exclusive
  create, writes the whole new file into it, and renames it over `config`. A held lock fails at once with "could not
  lock config file". It follows a symbolic link to its target before it locks. It keeps every other line and comment.
  Slice 3 copies all of that.
- **Rust's `toml_edit`, used by `cargo add` (from memory).** A TOML document that keeps the file's formatting: a set
  value gets default spacing, and every other byte stays.
- **VS Code's `jsonc-parser` (from memory).** `modify(text, path, value)` answers edits `{ offset, length, content }`
  that replace only the value's range, and `applyEdits` applies them. VS Code creates `.vscode/` when a workspace
  setting is first written. This package's `internal/edit.ts` already splices by range the same way.
- **Our own TOML splice, read in `kalfa/config/src/internal/edit.ts` and `kalfa/config/src/TomlParser.ts`.** `set`
  replaces one value's range and keeps a comment inside the old value. A missing key goes at the end of its table's
  section, inside its inline table, or under a new header at the end. `remove` takes one `key = value` out. Both parse
  the answer again. Given a path that is a table written under its own header, `check` refuses it. The T877 laws in
  `next/packages/libfabrika/src/settings/TomlEdit.test.ts` hold these byte rules over generated layouts today.
- **Markdown's set, ticket 1927** (approved plan on branch `fabrikalfa/kalfa-markdown-set`,
  `.kalfa/quests/kalfa-markdown-set-PLAN.md`). Taken from it: splice only the changed value's text by the parser's
  positions; read the answer again and refuse, with reason `edit`, when anything but the set data changed; take typed
  values and encode them with the schema; answer the same text when nothing changed; a new key goes at the end of its
  block. Done differently here:
  - **The file need not pass before the edit.** Markdown refuses a file that fails its schema. Here the edited
    setting's own old value is left out of the first check, so a set can fix a bad value, which is how a person fixes
    a file that stops the start. Every other key must pass, with its line as on disk.
  - **A `Result`, not an Effect.** Markdown's set is an Effect because a caller's schema may need services. A
    setting's schema is `Schema.Codec<A, unknown>`, which needs none, so the edit stays a pure call, as the follow-up's
    sketch types it.
  - **Remove is offered**, as the ticket asks.
  - **The check after the edit is the start's whole-file check**: unknown keys, file scope, each value, and the minimum
    version's form, each with its line.
  - **A disk half**, which Markdown does not have.
- **Effect 4.1.3, read in `kalfa/config/node_modules/effect/src`.** `Result` (`succeed`, `fail`, `gen`, `map`,
  `flatMap`; there is no `Result.try`), `Schema.decodeUnknownResult` and `Schema.encodeUnknownResult`,
  `Effect.fromResult`, `Effect.acquireUseRelease`, and `FileSystem`'s `realPath`, `rename`, `remove` with `force`,
  `makeDirectory`, and `writeFileString` with the `"wx"` flag ("like 'w' but fails if file exists"). `PlatformError`'s
  reasons include `AlreadyExists` and `NotFound`. `FileSystem.makeNoop` answers `NotFound` for what it was not given.

## The shape

### Slice 1: the inner file format, and what moves

The ticket's fifth criterion and the protocol's addendum: the format is named for no one format, TOML is the only
one built, and it is not exported.

```ts
// Sketch: kalfa/config/src/internal/format.ts. No package entry reaches it.
export interface Document {
  readonly value: Readonly<Record<string, unknown>>
  readonly spans: ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly line: number }>
}

// A Schema.TaggedUnion, as Origin is, so no tag is written by hand.
export const Fault = Schema.TaggedUnion({
  Syntax: { line: Schema.Int, cause: Schema.Defect() },    // the text does not parse
  Value: { cause: Schema.Defect() },                       // the value cannot be written in this format
  Conflict: { line: Schema.Int, cause: Schema.Defect() },  // the path is not one key in this text
})

export interface Format {
  readonly name: string        // "TOML", as a message says it: "this is not valid TOML."
  readonly extension: string   // "toml": the file is .<app>/<app>.toml
  readonly parse: (text: string) => Result.Result<Document, typeof Fault.Type>
  readonly set: (text: string, path: ReadonlyArray<string>, value: unknown) => Result.Result<string, typeof Fault.Type>
  readonly remove: (text: string, path: ReadonlyArray<string>) => Result.Result<string, typeof Fault.Type>
}
```

- **The TOML format is `kalfa/config/src/internal/toml.ts`.** Its body is today's `TomlParser.ts` core (`index`,
  `content`, `put`, `encoded`, `render`, `parse`, `set`, `remove`), moved, with each `Effect.try` turned into a
  `try`/`catch` that answers a `Result`. It becomes the one file that imports `toml-eslint-parser` and
  `@decimalturn/toml-patch`.
- **`TomlParser.ts` keeps its public `layer`** for today's callers: the `Toml` service, each call an
  `Effect.fromResult` of the format with each `Fault` turned back into today's `TomlError`. Its behavior does not
  change, which the T877 laws, `TomlParser.test.ts` and `App.test.ts` hold. 1849 deletes it.
- **The lint rule follows the move.** `.oxlintrc.json` exempts `kalfa/config/src/TomlParser.ts` from the two TOML
  import bans in three places; each becomes `kalfa/config/src/internal/toml.ts`.
- **The start reads through the format**, so the file name and the `syntax` message come from it, and
  `SettingGroup.layer` no longer provides `TomlParser.layer`. One parameter carries the format from `SettingGroup.ts`
  into the start (and, in slice 2, into the edit), so a second format later is one value. The file name and the
  message are the same as today's, since the format says `toml` and `TOML`.
- **The whole-file check moves.** `check`, `explain`, `struct`, `under`, `places`, `refused` and the minimum version's
  form move out of `kalfa/config/src/internal/start.ts` into `kalfa/config/src/internal/check.ts`. Their messages do
  not change, and they answer a `Result` (`Schema.decodeUnknownResult` in place of `decodeUnknownEffect`). The start
  wraps each in `Effect.fromResult`. `version(app, document)` checks that `<app>-version` reads as a version; the start
  then compares it with the running one, as `supported` does today.
- **Finding and reading the files moves.** `userPlace`, `load` and the repo place move into
  `kalfa/config/src/internal/place.ts`, so slice 3's disk calls find the user file by the start's own rule.

### Slice 2: the calls in memory

```ts
// Sketch: kalfa/config/src/SettingGroup.ts, beside make, layer and origins. Doc blocks left out.

/** One edit of one configuration file's text: set one setting, or remove it. */
export interface Edit<R extends ReadonlyArray<Setting.Any>> {
  readonly set: <S extends R[number]>(setting: S, value: Setting.Type<S>) => Result.Result<string, SettingsError>
  readonly remove: (setting: R[number]) => Result.Result<string, SettingsError>
}

export const edit: <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  text: string,
  file: Setting.File,
) => Edit<R>
```

```ts
// Sketch: kalfa/config/src/internal/error.ts. Slice 2 adds "edit"; slice 3 adds "write".
reason: Schema.Literals(["version", "syntax", "unknown", "scope", "invalid", "missing", "read", "edit", "write"]),
```

- `edit` never fails and reads nothing until `set` or `remove` is called. Each call parses the text again, so an
  `Edit` holds only the group, the text and the file.
- A setting from another group, or a value of the wrong type, does not compile. At run time a setting is found in
  the group by name; one that is not there is `unknown` (only a cast gets there).
- The pure call names the files as a person reads them by default: `.demo/demo.toml` and `~/.demo/demo.toml`. Slice
  3's disk calls name the user file as the start does, `$DEMO_HOME/demo.toml` when that variable moved it.
- Every message ends with `<file> was not changed.`, where the start's end with `<app> did not start.`. The closing
  sentence becomes a parameter of `check.ts`'s functions in this slice. A message never holds a value, the set value
  included.

### Slice 2: what the edit does

Each step answers a `Result`. The first fault stops it, and no text comes back.

```ts
// Sketch: kalfa/config/src/internal/change.ts. `place` is { file, names }.
export const set = (group, format, place, text, setting, value) =>
  Result.gen(function* () {
    const own = yield* member(group, setting)                  // unknown: not one of the group's settings
    yield* scoped(group, own, place)                           // scope, no line: the file is outside its file scope
    yield* fits(group, own, value, place)                      // invalid, no line: Schema.is(own.schema) says no
    const written = yield* encode(group, own, value, place)    // invalid: Schema.toCodecJson(own.schema) cannot encode it
    const before = yield* parsed(format, text, place)          // syntax, with the parser's line
    yield* whole(group, before, place, { without: own })       // the file whole, this setting's key left out
    const next = yield* edited(format.set(text, segments(own.name), written), place) // Conflict: edit; Value: invalid
    const after = yield* reread(format, next, place)           // edit: the answer does not parse
    yield* kept(before, after, segments(own.name), written)    // edit: other data changed
    yield* whole(group, after, place)                          // the edited text whole, nothing left out
    return next
  })
// remove: member and scoped as set; no fits or encode; the format's remove; kept expects the key gone.
```

- **The value is checked, then encoded** with the same JSON codec the start decodes files with
  (`Schema.toCodecJson(schema)`), so a `NumberFromString` setting writes `"5"` and a branded text writes plain text.
- **`remove` checks file scope as `set` does.** A remove of a user-only setting from the repo file fails `scope`,
  with no line and no text. The ticket's second criterion names file scope with no exception, and with one rule for
  both calls, no caller can use a remove to reach a file that the setting's scope keeps it out of. The cost: a key
  someone typed into the wrong file by hand is taken out by hand too, and the start's own `scope` message already
  names that file and line. 85%.
- **The first whole-file check leaves the edited setting's key out**, by dropping that path from the parsed value
  before decoding. Every other fault is reported with its line as it is on disk. A bad old value at that key does not
  stop a set, which replaces it, or a remove, which takes it out.
- **The kept check** compares the answer's data with the old data plus the one change. A table that no line of the
  text names (one made only by a dotted key or by a deeper header) is left out on both sides, so removing
  `delivery.approver = 1`, the last dotted key under `delivery`, is not read as `delivery` going. This is the guard for
  any splice case no law reached.
- **The second whole-file check** runs the start's check on the answer. Once the first check and the value check have
  passed, it can only fire on a fault the splice made. It is the ticket's "the whole edited text is checked".
- **No change gives the same text.** When the file already holds the value, or a removed key is not there, the answer
  is the input, byte for byte.
- **What the format refuses** is `edit`: a record setting written as a table under its own header (`[delivery.rule]`),
  as dotted sub-keys, or as an array of tables. Comparing a whole record key by key is ticket 1844's.

### Slice 3: the disk half

```ts
// Sketch: kalfa/config/src/SettingGroup.ts, beside edit.
export const set: <App extends string, R extends ReadonlyArray<Setting.Any>, S extends R[number]>(
  group: SettingGroup<App, R>,
  setting: S,
  value: Setting.Type<S>,
  file: Setting.File,
  options?: { readonly repo?: string },   // the folder that holds .<app>/, "." by default, as layer takes it
) => Effect.Effect<void, SettingsError, FileSystem.FileSystem | Path.Path>

export const remove: <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  setting: R[number],
  file: Setting.File,
  options?: { readonly repo?: string },
) => Effect.Effect<void, SettingsError, FileSystem.FileSystem | Path.Path>
```

Effect's `FileSystem` is the small file service, and `MemoryFiles.test-support.ts` is its in-memory stand-in.
Configuration's protocol set aside a files service of our own because it "duplicated Effect's `FileSystem`", and
named `FileSystem` the seam. So every disk law runs in memory.

```ts
// Sketch: kalfa/config/src/internal/disk.ts. `change` is slice 2's pure set or remove, bound to its setting.
export const write = (group, setting, format, file, options, change, kind: "set" | "remove") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const place = yield* where(group, format, file, options)    // place.ts, as the start finds it
    // No home: there is no user file. A set fails write, naming both variables; a remove succeeds with no call.
    const real = yield* fs.realPath(place.path).pipe(orIfNotFound(place.path))  // a link is followed to its target
    const lock = `${real}.lock`
    if (kind === "set") yield* folder(real)                       // makeDirectory of its folder; AlreadyExists is fine
    const changed = yield* Effect.acquireUseRelease(
      take(lock),            // writeFileString(lock, "", { flag: "wx" }). AlreadyExists: write, "another change is under way"
      () => Effect.gen(function* () {
        const old = yield* read(real)                            // NotFound: ""; any other failure: read
        const next = yield* Effect.fromResult(change(old, place.names))
        if (next === old) { yield* fs.remove(lock); return false } // no change: the file is not touched
        yield* fs.writeFileString(lock, next)
        yield* fs.rename(lock, real)                              // the one write the file sees
        return true
      }),
      (_, exit) => (Exit.isFailure(exit) ? fs.remove(lock, { force: true }) : Effect.void), // only a lock this call made
    )
    yield* Effect.annotateCurrentSpan("kalfa.config.changed", changed)
  }).pipe(Effect.withSpan(`config.${kind}`, { attributes: { "kalfa.config.app": group.app,
    "kalfa.config.setting": setting.name, "kalfa.config.file": file } }))
```

- A remove whose lock cannot be made because the folder is missing has nothing to remove, and succeeds.
- A failed write or rename is `write`, naming the file and never its text, and the file is as it was.
- A running process sees the edit through its watcher once live settings exist (1841). Nothing here waits for it.

## One value traced

The opening block's group and text, `file` = `"repo"`. `approver` may be set in both files; `port` only in the user
file.

1. `edit(Demo, text, "repo")` keeps the three. `.set(approver, "owner")` starts.
2. `approver` is in the group by name, and its file scope holds `repo`.
3. `Schema.is(Approver)("owner")` is true, and the JSON codec encodes it as `"owner"`.
4. The text parses through slice 1's TOML format: `{ delivery: { approver: "people" } }`, with spans for
   `[delivery]` on line 2 and `approver` on line 3.
5. The first whole-file check drops `delivery.approver` and decodes `{ delivery: {} }` against the repo file's
   schema. It passes. No `demo-version` is there.
6. The format's `set` finds the assignment at line 3 and replaces only the range of `"people"` with `"owner"`. The
   three spaces and `# the default` are after that range, so they stay.
7. The answer parses again to `{ delivery: { approver: "owner" } }`. The kept check expects the old data with that one
   key changed; both name `delivery` by its header, and they agree.
8. The second whole-file check passes. The answer is `Result.succeed` of the new text.

The same call with `port` stops at step 2: `instance.port`'s file scope is `["user"]`, so the answer is the `scope`
error in the opening block, with `file` and no `line`. So does `.remove(port)` on the repo text.

On disk (slice 3), `SettingGroup.set(Demo, approver, "owner", "repo", { repo: "/work" })` with that text at
`/work/.demo/demo.toml`: `realPath` gives the same path; `makeDirectory("/work/.demo")` answers `AlreadyExists`, which
is fine; `writeFileString("/work/.demo/demo.toml.lock", "", { flag: "wx" })` makes the lock; the file is read; the
edit above runs; the new text goes into the lock; `rename` puts it over the file. The span `config.set` ends with
`kalfa.config.app` `demo`, `kalfa.config.setting` `delivery.approver`, `kalfa.config.file` `repo` and
`kalfa.config.changed` true. A second identical call reads `"owner"`, gets the same text back, removes its lock and
renames nothing.

## What fact is lost if it is not recorded now

Who changed a setting in the user file, and when. A repo file changes through a change request, which git records;
the user file has no record at all. Slice 3's span is that record (decision 0063 makes spans entries on their own
ledger log): the app, the setting's name, which file, and whether the text changed. The values stay out, since a span
never holds a value (B8's rule). Nothing else is lost: slice 1 moves code, and slice 2's pure edit stores nothing.

## Laws, slice 1

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| O1, nothing changes: the 1839 laws B1 to B17, T1 to T6, R1 and P1, today's `TomlParser.test.ts` L9, `App.test.ts` K1 to K5, `scripts/kalfa-config.test.ts`, and the T877 laws L1 to L9 stay green with no edit, after the TOML core, the check and the places move | test | pinned: the laws named, unchanged | (already planted) | kalfa/config/src/SettingGroup.test.ts, kalfa/config/src/SettingGroup.integration.test.ts, kalfa/config/src/SettingGroup.types.test.ts, kalfa/config/src/Package.integration.test.ts, kalfa/config/src/TomlParser.test.ts, kalfa/config/src/App.test.ts, scripts/kalfa-config.test.ts, next/packages/libfabrika/src/settings/TomlEdit.test.ts |
| L2, one file knows TOML: in `kalfa/config/src`, only `internal/toml.ts` imports `toml-eslint-parser` or `@decimalturn/toml-patch`, in every spelling, and `TomlParser.ts` no longer may | lint | lint | keep `TomlParser.ts` as the exempt file: the moved import in `internal/toml.ts` is refused, `pnpm lint` red | .oxlintrc.json, oxlint-plugins/settings-imports.test.ts |
| T8, the format is not exported: no name of the root's `Setting` or `SettingGroup` is a format (`Format`, `format`, `toml`) | type | type | export the TOML format as `SettingGroup.toml`: tsc red | kalfa/config/src/Format.types.test.ts |
| L1, the moved code imports no kalfa package: the existing package rule holds the new files | lint | lint | import `@kalfa/records/Finding` in `internal/check.ts`: `pnpm lint` red | boundary-rules.json |

**Lint, type or test?** A move that changes no behavior is held by the laws that exist: O1 pins them. Where the parser
may be imported is an import shape: lint (L2, L1). Whether a name is exported is a type the compiler sees: T8.

**Where they run.** O1's in-memory laws, L1, L2 and T8 run on every pull request. R1 and P1 are `.integration.`
files and run in main's full run or a proof run the lead starts, as they do today. No law is host-only.

## Files, slice 1

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/format.ts | build | 45 | new: `Format`, `Document`, `Fault` |
| kalfa/config/src/internal/toml.ts | build | 280 | new: the TOML format, today's `TomlParser.ts` core moved here (about 250 lines), answering `Result` |
| kalfa/config/src/TomlParser.ts | build | 35 | its core leaves for `internal/toml.ts`; its `layer` wraps the format and turns each `Fault` back into `TomlError` |
| kalfa/config/src/internal/check.ts | build | 145 | new: the whole-file check moved out of `start.ts` (about 140 lines), as a `Result`, with `version` |
| kalfa/config/src/internal/place.ts | build | 65 | new: where each file is and how it is read, moved out of `start.ts` (about 60 lines), with the format's extension |
| kalfa/config/src/internal/start.ts | build | 15 | uses `check.ts`, `place.ts` and the format; about 200 lines leave it |
| kalfa/config/src/SettingGroup.ts | build | 5 | `layer` passes the format to the start and no longer provides `TomlParser.layer` |
| kalfa/config/src/internal/document.ts | build | 3 | `Document` from the format in place of `TomlDocument` |
| kalfa/config/GLOSSARY.md | build | docs | new term **File format** |
| .oxlintrc.json | tests | tests | L2: the three TOML exemptions name `kalfa/config/src/internal/toml.ts` in place of `kalfa/config/src/TomlParser.ts` |
| oxlint-plugins/settings-imports.test.ts | tests | tests | L2: the file that may import the parser is `internal/toml.ts`; `TomlParser.ts` may not |
| kalfa/config/src/Format.types.test.ts | tests | tests | new: T8 |
| boundary-rules.json | tests | tests | L1: no change, the rule that holds it |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.integration.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | O1: no change in this slice |
| kalfa/config/src/Package.integration.test.ts | tests | tests | O1: no change in this slice |
| kalfa/config/src/TomlParser.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/App.test.ts | tests | tests | O1: no change, stays green |
| scripts/kalfa-config.test.ts | tests | tests | O1: no change, stays green |
| next/packages/libfabrika/src/settings/TomlEdit.test.ts | tests | tests | O1: no change, the T877 byte laws stay green over the moved core |

## Generators, slice 2

Every generator is an Effect `Arbitrary` in `kalfa/config/src/SettingGroup.edit.test-support.ts`, beside the 1839
names and schemas. Each run builds one input per class from its drawn seeds, so every class is reached in every run,
not left to chance. A law keeps the ids it reached and fails when one is missing. Each id has a plant in slice 2's
laws table.

A **typed file** is a configuration file as a person types it, built from pieces: each key's table form, its key
text, its value text and its tail (a comment and the line break), plus comment and blank lines. The support knows
each value's byte range, so a law can say which bytes may change. Groups hold one to four settings whose schemas are a
port, a set of literals, a `NumberFromString`, an array of text, a `Record(String, Number)` and a `Struct` with an
`optionalKey`.

Where the edited key sits:

- (a) under its table's header: `[delivery]`, then `approver = "x"`.
- (b) a dotted key: `delivery.approver = "x"` at the root, and `stryker.runs = 3` under `[quality]`.
- (c) inside an inline table: `delivery = { approver = "x", other = 1 }`, as the first, middle and last member, and
  one inline table inside another.
- (d) absent, with its table present: other keys and a comment after the table's last key, then a later table.
- (e) absent, with no table: an empty file, a comment-only file, and a file with no final line break.
- (f) quoted key spellings: `"delivery"."approver"`, `'delivery'.approver`, and `[ "delivery" ]` with spaces.

The text around it:

- (g) comments: after the value at one space, three spaces and a tab; an own-line comment right above the key; a
  comment block above the header; a comment inside a multi-line array value.
- (h) line ends: LF, CRLF, and no final line break.
- (i) neighbors: another setting in the same table, a later table, a deeper header of another setting
  (`[delivery.rule]`), and an array of tables of another setting.

The values set:

- (j) scalars: text holding quotes, a backslash, a line break, `#`, `=` and non-ASCII letters; integers from the
  port's ends; floats 1.5, 1e-12 and -0; booleans; and a `NumberFromString` setting, whose file form is text.
- (k) arrays: empty, flat, nested, of records, and 60 items.
- (l) records, written inline: empty, flat, nested, and keys that need quotes (`a.b`, the empty key, `雪`).
- (m) the value the file already holds: the same text, `1.0` for 1, and `'x'` for `"x"`.

What must be refused or left alone:

- (n) a file outside the setting's file scope, for set and for remove, file-only settings included, with the key
  present in that file and absent from it.
- (o) a value the schema refuses, past the types with a cast: a port out of range, a text for a number, a `Date` as
  text, and a text with a lone surrogate, which TOML cannot write.
- (p) a fault elsewhere in the file: an unknown key within two edits of a setting and one farther; another setting
  outside its file scope; another setting's bad value; a `demo-version` that is not a version; `demo-version` in the
  user file; a table where a value goes. Each sits before and after the place a new key would go.
- (q) a fault at the edited setting itself: a bad old value, and a value of the wrong kind.
- (r) text that is not TOML, broken at a generated line before and after the key.
- (s) a key that is not one key here: a record setting under its own header, as dotted sub-keys, and as an array of
  tables.
- (t) a remove of a key the file lacks, with its table there and with no table.

Across all of them:

- (x) secret-looking values: the set value, accepted and refused; another key's value; an unknown key's value.
- (y) setting kinds: restart, live, file-only and required, with two- and three-word names.

## Laws, slice 2

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| E1, the ticket's file: a repo file with a comment block above a header, a comment after a value, an inline table, a multi-line array and blank lines; setting one key gives exactly the expected text, and removing another gives exactly its expected text | test | scenario: the ticket's file, written in the test | write the answer from the parsed document with the serializer, so the comments and the inline table's spacing go: red | kalfa/config/src/SettingGroup.edit.test.ts |
| E2, every other byte kept: for a typed file and a value from (j) to (l), `set` succeeds, and its answer is the old text with only the key's value range replaced, or one new line (or a new header and its line) added at the place the format names; every byte outside those spans is the old byte, in order, and every added line ends with the file's line break. 100 runs, every class reached | test | Effect Arbitrary: Edits | (a) build an assignment's path from its own key only, without its header's path: the key is not found and a second one is added, red; (b) join a dotted key's parts into one word: red; (c) leave an inline table's members out of the assignments: red; (d) put a missing key at the end of the file, not its table's section: it lands under a later table, red; (e) with no table, write the key at the root with no header: red; (f) read a key from its source text, so `"delivery"` keeps its quotes and is not found: red; (g) replace from the value's start to the end of its line, so the comment after it goes: red; (h) end each added line with `\n` whatever the file uses: red; (i) put a missing key at the end of the deepest section under its table, `[delivery.rule]`, not its own: red | kalfa/config/src/SettingGroup.edit.test.ts |
| E3, it reads back: for the same inputs, a start over in-memory files holding the answer gives the set value, with the origin of that file and the key's line in the answer. 100 runs, every class reached | test | Effect Arbitrary: Edits | (j) write the value as decoded, not as its JSON encoding: a `NumberFromString` setting writes `5` where its file form is `"5"`, red; (k) compare arrays by length in the no-change test, so `[1, 2]` set to `[3, 4]` stays `[1, 2]`: red; (l) write a record's keys bare, so `a.b` reads back as a nested table: red; (y) take the table from the name's first word only, so `quality.stryker.runs` is written under `[quality]` as `runs`: red; (y) refuse a file-only setting in the edit as the start refuses its variable: red | kalfa/config/src/SettingGroup.edit.test.ts |
| E4, remove takes out one key: for a typed file holding the key in (a) to (c), the answer is the old text with only that assignment taken out (and its comma, in an inline table); a comment inside the removed value stays; every other byte is kept; a start then reads the next source or the default. 100 runs | test | Effect Arbitrary: Removals | (c) remove the whole line of a key in an inline table, so its siblings go: red; drop a comment found inside the removed value: red | kalfa/config/src/SettingGroup.edit.test.ts |
| E5, file scope before the edit: setting or removing a generated setting in a file outside its file scope fails `scope` with that file, no line, and the text naming where it may be set (its files, and its variable unless it is file-only), whether or not the key is in that file; no text comes back. 100 runs | test | Effect Arbitrary: ScopeCases | (n) drop the scope check before a set: the second whole-file check still refuses, but with the new key's line, red; (n) check scope for set only: a remove of a user-only setting from the repo file gives text, red | kalfa/config/src/SettingGroup.edit.test.ts |
| E6, a refused value: a value the schema refuses, or one the format cannot write, fails `invalid` naming the setting and the file, with no line and no text. 100 runs | test | Effect Arbitrary: Refused | (o) drop the schema check before the edit: an out-of-range port fails the second whole-file check with the edited text's line, red | kalfa/config/src/SettingGroup.edit.test.ts |
| E7, the whole text is checked: a fault elsewhere in the file fails with its own reason and its line as in the input, for set and remove, and no text comes back; the same file with the fault at the edited setting itself gives text, and a start reads the new value. 100 runs | test | Effect Arbitrary: Faults | (p) check only the answer: a fault after an inserted line is named one line late, red; (p) skip both whole-file checks: a file with an unknown key gets text, red; (q) check the input whole with the edited setting in it: a bad old value cannot be fixed, red | kalfa/config/src/SettingGroup.edit.test.ts |
| E8, text that is not TOML: a generated broken file fails `syntax` with that file and the parser's line, for set and remove. 100 runs | test | Effect Arbitrary: Broken | (r) report line 1 for every syntax fault: red | kalfa/config/src/SettingGroup.edit.test.ts |
| E9, one key that cannot change as one: setting or removing a key in (s) fails `edit` with the file and the key's line, and no text comes back. 100 runs | test | Effect Arbitrary: Tables | (s) answer the text unchanged when the format refuses the path: red | kalfa/config/src/SettingGroup.edit.test.ts |
| E10, no change gives the same text: setting the value the file already holds, or removing a key it lacks, answers the input byte for byte. 100 runs | test | Effect Arbitrary: Unchanged | (m) always splice the new value's text, so `'x'` becomes `"x"` and `1.0` becomes `1`: red; (t) fail `unknown` when the removed key is absent: red | kalfa/config/src/SettingGroup.edit.test.ts |
| E11, the guard after the edit: with a stand-in format whose set also changes another key, one whose answer does not parse, and one that drops a table, the internal set answers `edit` and no text | test | scenario: three stand-in formats, each wrong in one way | drop the kept check: the first stand-in's text comes back, red | kalfa/config/src/internal/change.test.ts |
| S1 [secrets], values stay out: a generated secret-looking value in (x) never appears in an edit's error message or cause, for every refusal class. 100 runs | test | Effect Arbitrary: Hidden | (x) name the refused value in the `invalid` message: red; (x) keep the `SchemaError` as the cause: red | kalfa/config/src/SettingGroup.edit.test.ts |
| T5, changed: the layer's error type is exactly `SettingsError`, its `reason` is exactly the eight literals with `edit`, and `Setting.File` is exactly `"repo"` or `"user"` | type | type | leave `edit` out of the literals: tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T7, the edit's types: `edit(group, text, file).set(setting, value)` and `.remove(setting)` are exactly `Result<string, SettingsError>`; a setting of another group, a value of the wrong type, and `file` as `"person"` do not compile, each under `@ts-expect-error` | type | type | type `set`'s setting as `Setting.Any`: the `@ts-expect-error` for another group's setting is unused, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| P1, the archive runs the edit: the installed consumer calls `SettingGroup.edit(...).set` on a small text and prints the answer, and its declarations compile; the package's exports do not change | test | scenario: the packed archive installed outside the workspace | leave `internal/toml.ts` out of the build: the consumer's edit fails, red | kalfa/config/src/Package.integration.test.ts |
| L1, the new code imports no kalfa package | lint | lint | import `@kalfa/records/Finding` in `internal/change.ts`: `pnpm lint` red | boundary-rules.json |

**Lint, type or test?** T5 and T7 are shapes the compiler sees: type. L1 is an import shape: lint. E1 to E11, S1 and
P1 are about the bytes and data a call gives: tests. O1 from slice 1 stays green here too.

**Where they run.** Every E and S law runs in memory on every pull request: the edit is pure. P1 builds, packs and
installs, so it runs in main's full run or a proof run the lead starts. No law is host-only.

## Files, slice 2

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/change.ts | build | 140 | new: the pure set and remove |
| kalfa/config/src/SettingGroup.ts | build | 45 | `Edit` and `edit` with their doc blocks |
| kalfa/config/src/internal/check.ts | build | 15 | the closing sentence as a parameter, and one key left out of the check |
| kalfa/config/src/internal/document.ts | build | 10 | `drop` of one path |
| kalfa/config/src/internal/edit.ts | build | 2 | exports `equal`, which the kept check uses |
| kalfa/config/src/internal/error.ts | build | 3 | the reasons gain `edit`, and the doc block says what it means |
| kalfa/config/GLOSSARY.md | build | docs | new term **Edit** |
| kalfa/config/README.md | build | docs | a section on changing a setting in a file's text: what stays, what is refused |
| kalfa/config/src/SettingGroup.edit.test.ts | tests | tests | new: E1 to E10 and S1 |
| kalfa/config/src/SettingGroup.edit.test-support.ts | tests | tests | new: typed files, the class list and its reach check, and the generators |
| kalfa/config/src/internal/change.test.ts | tests | tests | new: E11, with three stand-in formats |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | T5 changed to eight reasons; T7 new |
| kalfa/config/src/Package.integration.test.ts | tests | tests | P1: the consumer's edit line is run and checked |
| kalfa/config/test/consumer.mjs | tests | tests | P1: one `SettingGroup.edit(...).set` call, printed |
| kalfa/config/test/consumer.ts | tests | tests | P1: the edit's declarations |
| boundary-rules.json | tests | tests | L1: no change |

## Generators, slice 3

Every generator is an Effect `Arbitrary` in `kalfa/config/src/SettingGroup.disk.test-support.ts`. It reuses slice 2's
typed files, values and secret values, and adds what the disk holds. Each run builds one input per class, as in slice
2, and each id has a plant in slice 3's laws table.

- (u) where the file is: the repo file under a given `repo` folder, the user file at `$DEMO_HOME`, the user file at
  `$HOME/.demo`, and no home at all.
- (v) the disk's state: the file there, the file missing in its folder, the folder missing, the file a link to
  another path, and a lock already there.
- (w) disk faults: the read refused (permission, busy), the lock's create refused for another reason, the lock's
  write refused, and the rename refused.

## Laws, slice 3

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D1, on disk is the edit and one write: for each place in (u) and a typed file there, `SettingGroup.set` and `remove` leave the file holding exactly what `edit` answers for its old text; the user file is found by the start's rule. 100 runs | test | Effect Arbitrary: DiskEdits | (u) find the user file from `HOME` before `$DEMO_HOME`: red | kalfa/config/src/SettingGroup.disk.test.ts |
| D2, a refused edit writes nothing: for each of slice 2's refusals on disk, the call fails with the edit's error, the file is unchanged, no rename is recorded, and no lock is left. 100 runs | test | Effect Arbitrary: DiskRefusals | rename the lock over the file even when the edit refused, writing the old text back: red | kalfa/config/src/SettingGroup.disk.test.ts |
| D3, the lock: with `<file>.lock` already there, set and remove fail `write` naming the lock, the file is unchanged, and the lock is still there with its own text | test | scenario: a lock planted beside each file | (v) remove the lock on failure even when another writer made it: red; (v) write with no lock, so a held lock does not stop the call: red | kalfa/config/src/SettingGroup.disk.test.ts |
| D4, the file sees one rename: on success the recorded calls hold no write to the file's own path and exactly one rename from its lock; with the lock's write or the rename refused, the call fails `write`, the file is as it was, and no lock is left. 100 runs | test | Effect Arbitrary: DiskFaults | (v) write the new text into the file in place: red; (w) leave the lock behind when the rename fails: red | kalfa/config/src/SettingGroup.disk.test.ts |
| D5, a missing folder or file: a set into a missing file makes it, and into a missing `.demo/` folder makes that one folder and the file; a missing parent of that folder fails `write`; a remove of a missing file or folder succeeds and writes nothing. 100 runs | test | Effect Arbitrary: DiskStates | (v) skip making the folder: a set into a repo with no `.demo/` fails, red | kalfa/config/src/SettingGroup.disk.test.ts |
| D6, no change writes nothing: a set of the value the file holds, or a remove of an absent key, renames nothing and leaves no lock. 100 runs | test | Effect Arbitrary: Unchanged | rename even when the text did not change: red | kalfa/config/src/SettingGroup.disk.test.ts |
| D7, a link stays a link: when the file's path is a link, the new text lands at its target, the link path is never written or renamed over, and the lock sits beside the target. 100 runs | test | Effect Arbitrary: DiskStates | (v) lock and rename at the link's own path: the link becomes a plain file, red | kalfa/config/src/SettingGroup.disk.test.ts |
| D8 [secrets], the span: each disk call ends one span, `config.set` or `config.remove`, with the app, the setting's name, the file and whether it changed; no attribute, event or log line holds one of slice 2's secret values or the file's text. 100 runs | test | Effect Arbitrary: Hidden | put the new text in a span attribute: red; leave `kalfa.config.changed` out: red | kalfa/config/src/SettingGroup.disk.test.ts |
| D9, read and write faults: a refused read fails `read` and a refused lock create fails `write`, each naming the file and never its text, and nothing is written. 100 runs | test | Effect Arbitrary: DiskFaults | (w) count every read failure as an empty file: a permission fault writes a file, red; (w) answer `read` for a refused lock create: red | kalfa/config/src/SettingGroup.disk.test.ts |
| D10, no home: with neither `$DEMO_HOME` nor `HOME`, a set to the user file fails `write` naming both variables, and a remove succeeds with no file call | test | scenario: an empty environment, set and remove on the user file | (u) with no home, write to `.demo/demo.toml` under the current folder: red | kalfa/config/src/SettingGroup.disk.test.ts |
| R2, the stand-in tells the truth about writes: on a real temp folder through `NodeServices`, five cases (a set into a missing `.demo/` folder; a set that keeps a comment; a set through a linked user file; a held lock; a no-change set) leave the same files, links and errors as the same cases in memory | test | scenario: five cases on a temp folder, then the same five in memory | take the lock with a plain write, not the `"wx"` flag: the held-lock case writes on the real disk, red | kalfa/config/src/SettingGroup.disk.integration.test.ts |
| T5, changed again: the reasons are exactly the nine literals, `write` added | type | type | leave `write` out of the literals: tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T9, the disk calls' types: `SettingGroup.set` and `remove` are exactly `Effect<void, SettingsError, FileSystem \| Path>`; a setting of another group and a value of the wrong type do not compile, under `@ts-expect-error` | type | type | type the disk `set`'s value as `unknown`: the `@ts-expect-error` for a wrong value is unused, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| L1, the disk code imports no kalfa package and no Node module | lint | lint | import `node:fs` in `internal/disk.ts`: `pnpm lint` red | boundary-rules.json |

**Lint, type or test?** T5 and T9 are types; L1 is an import shape; D1 to D10 and R2 are about the calls a run makes
and the files it leaves: tests.

**Where they run.** D1 to D10 run in memory on every pull request: the in-memory `FileSystem` gains writes with the
`"w"` and `"wx"` flags, renames, removes, folders, links and planted faults per call. R2 touches a real temp folder, so
it is an `.integration.` file: it runs in main's full run or a proof run the lead starts, never narrowly on the laptop.
No stand-in will do for R2, because its one job is to check the stand-in against the real disk. No law is host-only:
none needs launchd, a signal, a socket or the real app.

## Files, slice 3

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/disk.ts | build | 120 | new: place, folder, lock, read, change, write, rename, span |
| kalfa/config/src/SettingGroup.ts | build | 40 | `set` and `remove` on disk, with their doc blocks |
| kalfa/config/src/internal/place.ts | build | 5 | the place answers none when there is no home, as the disk calls need |
| kalfa/config/src/internal/error.ts | build | 2 | the reasons gain `write` |
| kalfa/config/README.md | build | docs | the disk calls, the lock file, the link and the folder |
| kalfa/config/src/SettingGroup.disk.test.ts | tests | tests | new: D1 to D10 |
| kalfa/config/src/SettingGroup.disk.test-support.ts | tests | tests | new: the disk classes and their reach check |
| kalfa/config/src/SettingGroup.disk.integration.test.ts | tests | tests | new: R2 |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | writes with the `"w"` and `"wx"` flags, `rename`, `remove` with `force`, `makeDirectory` with folders, `realPath` over links, and planted faults per call and path |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | T5 to nine reasons; T9 new |
| boundary-rules.json | tests | tests | L1: no change |

## Files ticket 1840 touches too

Ticket 1840 (flags from a group) is planned at the same time in its own worktree. Both tickets change
`kalfa/config/src/SettingGroup.ts` (all three slices add to it; 1840 adds `flags`), `kalfa/config/src/internal/start.ts`
(1840 adds the flag source to the resolve; slice 1 moves the check and the places out), likely
`kalfa/config/src/internal/error.ts`, `kalfa/config/src/SettingGroup.types.test.ts`, `kalfa/config/GLOSSARY.md` and
`kalfa/config/README.md`. If 1840 changes `places` (a flag as a place to set a value), that function lives in
`kalfa/config/src/internal/check.ts` after slice 1. Whichever lands second takes the other's change on a rebase.
Slice 1's moves are mechanical, so the lead may also land 1840 first and rebase slice 1 onto it.

## Existing tools

- kalfa/config/src/internal/format.ts (slice 1): searched the package's `Toml` service (`kalfa/config/src/Toml.ts`:
  named for TOML, an exported entry point, and an Effect service, so not pure) and Effect 4.1.3 for a text format seam
  (none). The protocol's addendum names `Format` and says it stays unexported. New, about 45 lines, with
  `Schema.TaggedUnion` for the fault as `Origin` uses it.
- kalfa/config/src/internal/toml.ts (slice 1): searched `TomlParser.ts`, which already holds the whole TOML core as
  Effect functions over `Effect.try`. Moved, not copied, so one copy serves the old service and the format. Each
  `Effect.try` becomes a `try`/`catch` answering a `Result`; Effect 4.1.3 has no `Result.try`.
- kalfa/config/src/internal/check.ts (slice 1): searched `start.ts`, where every function in it lives today. Moved, so
  the start and the edit share one check and one set of messages.
- kalfa/config/src/internal/place.ts (slice 1): searched `start.ts` (`userPlace`, `load`) and today's `Load.ts` (old
  words, kept for its callers). Moved from `start.ts`.
- kalfa/config/src/internal/change.ts (slice 2): searched `internal/edit.ts` (the splice, used as is through the
  format), the moved whole-file check (used as is), `Schema.is`, `Schema.encodeUnknownResult` and `Schema.toCodecJson`
  (used as is), `Result.gen` (used as is), and Markdown's set plan (its re-read check copied as an idea). The steps
  that join them are new.
- `drop` in kalfa/config/src/internal/document.ts (slice 2): searched `effect/Record` (`remove` takes one top-level
  key, not a path) and `internal/edit.ts` (`read` reads a path, nothing drops one). New, about 10 lines.
- `equal` in kalfa/config/src/internal/edit.ts (slice 2): searched Effect's `Equal.equals`, which `equal` already wraps
  for dates; exported, not rewritten.
- kalfa/config/src/internal/disk.ts (slice 3): searched Effect 4.1.3's `FileSystem` (no atomic write and no lock call;
  it has `writeFileString` with `"wx"`, `rename`, `realPath`, `remove` and `makeDirectory`, all used as is),
  `Effect.acquireUseRelease` (used as is), the repo for a lock or atomic write helper (`rg -il "atomic|lock file"` over
  `kalfa/` and `next/packages`: none that writes a file), and `FileSystem.makeTempFile` (a random name in the temp
  folder, which may be on another disk, so a rename from it is not atomic). New, about 120 lines, copying git's
  lock-file steps.

## Calls taken

Each picks how the code does what a note already says. The three under 80% are at the top.

- **Three stacked slices: the move, the edit in memory, the disk half.** 90%. The lead's send-back: the moved code
  hid the new logic, and each slice lands whole on its own.
- **`edit`'s calls answer a `Result`, not an Effect.** 80%. The follow-up's sketch types them so, and a setting's
  schema needs no services, so purity is a type fact. Cost: the TOML core moves out of its Effect service, with the
  lint exemption. Considered: an `Effect<string, SettingsError>` with no requirements, which would leave the core in
  place and give the edit a span. Set aside because nothing in its type would stop a later change from doing work
  inside it.
- **The TOML core moves into `internal/toml.ts`, and the lint exemption moves with it.** 85%. The format must be
  unexported, and `TomlParser.ts` is an entry point until 1849, which keeps the parser inside the package anyway.
- **`remove` checks file scope as `set` does.** 85%. The ticket names file scope with no exception. One rule for both
  calls leaves no way around the scope. A key typed into the wrong file is taken out by hand, and the start's message
  names its file and line.
- **The input is checked whole with the edited key left out, then the answer whole.** 80%. Faults elsewhere get their
  lines as on disk, a bad old value can be fixed, and the second check is the ticket's rule.
- **The kept check after the edit.** 85%. Markdown's rule. It holds any splice case no law reached, for one more parse
  of a small file.
- **Effect's `FileSystem` is the small file service, and `MemoryFiles.test-support.ts` its stand-in.** 90%.
  Configuration's protocol set aside our own files service and named `FileSystem` the seam.
- **The disk calls need `FileSystem | Path` and take `{ repo }`.** 85%. The protocol's sketch says `FileSystem`. The
  places need `Path`, as the layer does, and the repo folder comes the way the layer takes it.
- **A link is followed to its target.** 80%. git does this. A user file kept in a dotfiles repo and linked into the
  home folder stays linked.
- **A record setting written under its own header is refused `edit`.** 85%. Comparing a whole record key by key is
  1844's ruling 4.
- **A remove of an absent key answers the same text, and on disk writes nothing.** 80%. A pure call stays
  idempotent; 1846's command can say "nothing to remove" by comparing.
- **A no-change set renames nothing.** 85%. A watcher then sees no event for an edit that changed nothing.
- **Messages end with `<file> was not changed.`** 80%. The start's end with `<app> did not start.`; an edit stops
  nothing.
- **The pure edit names the user file `~/.demo/demo.toml`; the disk calls name it as the start does.** 80%. The pure
  call reads no environment.
- **Spans `config.set` and `config.remove`, with `kalfa.config.app`, `kalfa.config.setting`, `kalfa.config.file` and
  `kalfa.config.changed`.** 85%, from decision 0063's `<package>.<call>` rule. OpenTelemetry's `file.path` is not used,
  since a full path holds a login name (decision 0088). The pure edit has no span: it is not an Effect.
- **Is this a setting?** No new choice is. Failing at once on a held lock has no number to set; git has no wait for
  its config lock either. The closing words, the folder rule and the link rule are part of what the call is, and the
  same for every app.

## Where this departs from today's code

Today's code is reference only.

- Today's `Toml.set` and `Toml.remove` take a path and a raw value, check nothing about settings, and are Effects.
  The new edit takes a setting and a typed value, checks scope, the value and the whole file, and answers a `Result`.
- Today's `TomlParser.ts` imports the parser; after slice 1, `internal/toml.ts` does, and `TomlParser.ts` wraps it.
- No caller writes a settings file to disk today. Nothing there is moved; slice 3 is new.

## Validation

- Slice 1, tests step: write T8 and the L2 change, and show both red on the branch before the move; O1's laws are run
  narrowly and stay green. Build step: the move; `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/config/src
  next/packages/libfabrika/src/settings/TomlEdit.test.ts oxlint-plugins/settings-imports.test.ts` green, `pnpm format`
  and `pnpm lint`.
- Slice 2, tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/config/src/SettingGroup.edit.test.ts
  kalfa/config/src/internal/change.test.ts` shows each new law red, and the reach check names every class id. Build
  step: the same paths green, each plant run once and undone.
- Slice 3, tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/config/src/SettingGroup.disk.test.ts`
  shows each new law red. Build step: green, each plant run once.
- Type laws are judged by the compiler run the lead allows each build. The lead runs the `--changed origin/main` run
  and one `pnpm typecheck` per slice. R1, R2 and P1 run in main's full run or a proof run the lead starts.

## Size

1. Slice 1, the move: 593 product lines counted where they land, about 450 of them moved (the TOML core 250, the check
   140, the places 60), with about 200 lines leaving `start.ts` and 270 leaving `TomlParser.ts`. New logic is about 140
   lines: the format seam, the `Result` turns and the `TomlError` wrapper.
2. Slice 2, edit in memory: 215 product lines, all new (`change.ts` 140, `SettingGroup.ts` 45, the rest spread).
3. Slice 3, the disk half: 167 product lines, all new (`disk.ts` 120, `SettingGroup.ts` 40, the rest spread).

About 6 agent hours across the three, 75% sure. The doubt is slice 2's tests step: 22 classes in a typed TOML file
model, each reached in every run. Markdown's set plan, with 26 classes, priced its steps at about $7, and 1839 at
about $8. Steps: slice 1 tests, build and review (3); slices 2 and 3 tests, build, review and one likely send-back each
(8). About $7 a step.

Estimate: 11 steps, $77

## New names

- `SettingGroup.edit`, `SettingGroup.Edit`, `SettingGroup.set`, `SettingGroup.remove`: the protocol's and the
  follow-up's names.
- `edit` and `write`: two new `SettingsError` reasons.
- `config.set`, `config.remove`, `kalfa.config.setting`, `kalfa.config.file`, `kalfa.config.changed`: span and
  attribute names.
- Lock file: git's word for the `<file>.lock` a writer holds while it writes.
- `Format`, `Document`, `Fault`: code names inside `internal/`, not exported.

## Records

- Glossary terms, in `kalfa/config/GLOSSARY.md`, under "Where values come from":
  - **File format** (slice 1): how an app's configuration files are written, and the ending of their names. An app
    uses one; TOML is the only one. _Avoid_: parser, syntax, codec, serializer.
  - **Edit** (slice 2): one change to one setting in a configuration file's text: setting its value or removing it.
    Every other line and comment stays as it was, and the whole edited text is checked before any text comes back.
    _Avoid_: patch, update, write, mutation.
- `kalfa/config/README.md`: the edit and its reason in slice 2; the disk calls, the `write` reason and the lock file
  in slice 3.
- No decision record: each call applies the protocol, its follow-up or the ticket, and none is hard to undo before
  1846 and 1847 give the edit its first callers.
- No pattern doc: `.kalfa/patterns/settings.md` describes today's shape, which stays until 1849.

## What this cannot tell us

- Whether a file's own permissions survive a set: the rename gives the new file the default mode. A settings file
  never holds a secret's value, so this is left as is.
- What a watcher on the file's own path sees after a set (see Findings). Live settings are 1841's.
- Whether a stale lock ever shows up in daily use. Nothing removes one by itself.
- How a link to a missing target behaves: `realPath` fails, the path is used as is, and the rename replaces the link.
- Whether the empty-table rule in the kept check ever hides a real loss: a removed `x = {}` that no line names
  elsewhere would read the same on both sides.
- What happens to a table left empty by a remove: its header stays. Taking a table out with its comments is 1844's.
- Windows, where a rename over an open file can fail. Nothing here runs there yet.
- Whether the parser's own syntax message can carry text from the file into an error's cause. The start keeps the
  same cause today, and its B8 law does not reach a broken file either.
- Whether slice 1 lands cleanly beside 1840's change to `start.ts`. That depends on which lands first.

## Open questions

None.

Every choice above picks how the code does what the protocol, its follow-up, the ticket, the glossary or the lead's
send-back already says.

## Findings

1. **For ticket 1841: watch the folder, not the file.** A disk set replaces the file by a rename, as git and most
   editors do. Node's `fs.watch` documentation says that on Linux and macOS a watch follows the file's inode, so after
   a rename the watch keeps following the old one and sees no later change (from memory, not fetched). If 1841 watches
   `.demo/demo.toml` itself, the first `SettingGroup.set` would end its live updates. R2 here does not test a watcher.
   The lead may add this to 1841's ticket; no ticket filed.
2. **Ticket 1995 rewrites messages that slice 1 moves.** Its `invalid` and `read` refusals live in `start.ts` today;
   after slice 1, `refused` is in `kalfa/config/src/internal/check.ts` and the file read in
   `kalfa/config/src/internal/place.ts`. Whichever lands second rebases.
3. **Decision 0088 wants the error's place as data.** An edit knows exactly which file it refused (`repo` or `user`),
   and `SettingsError` carries only the name a person reads. Adding the kind is the error ticket 0088 names, not this
   one.

## Amendment 1 (2026-11-22): the check stays an Effect; L2 reaches every file

The review of slice 1 found two gaps.

1. **A setting whose schema decodes asynchronously crashed the start.** `Schema.decodeUnknownResult` dies on async
   decoding, and `Setting.make` takes any `Codec<A, unknown>`, so "purity is a type fact" was wrong. The lead's call:
   the whole-file check in `internal/check.ts` answers an `Effect` with no requirements (`Schema.decodeUnknownEffect`,
   as main's `start.ts` does), and the start yields it as before. Slice 2's `Edit.set` and `Edit.remove` answer
   `Effect<string, SettingsError>` with no requirements, as Markdown's set does, in place of `Result`; T7 says so.
   The TOML format in `internal/toml.ts` stays `Result`: it decodes no schema. Why: slice 1 promised no behavior
   change, and an Effect that needs no service is as safe to call; ruling out async schemas would need a law no type
   can hold. 80% sure. Cost: the pure edit is not a `Result` in its type.
2. **L2 tried only two files.** A new law, O2 (test, scenario, in `kalfa/config/src/SettingGroup.test.ts` or a new
   `kalfa/config/src/SettingGroup.async.test.ts`): a setting whose schema decodes with an async `transformEffect`
   and has a value in the repo file starts with that value, as on main. Plant: decode the file with
   `decodeUnknownResult`: O2 red. L2's generator draws other `kalfa/config/src` files too, at the top level and under
   `internal/`, each refused when it imports the parser. Plant: widen the exemption to `internal/**`: L2 red.

Also: "Effect 4.1.3 has no `Result.try`" was wrong; `Result.try` exists, and `internal/toml.ts` uses it.

## Amendment 2 (2026-11-22): a missing `$<APP>_HOME` is not made

Slice 3's tests step found the plan saying two things. Doubt 3 says a `$DEMO_HOME` set to a folder that does not exist
fails; the disk sketch makes "the app's own folder", which for `$DEMO_HOME` is `$DEMO_HOME` itself. The lead's call,
following doubt 3: a set makes only a `.<app>/` folder (under the repo folder, or under `HOME` when no `$<APP>_HOME`
is set). When `$<APP>_HOME` names a folder that does not exist, the set fails `write` naming `$<APP>_HOME`, and nothing
is made: a person who set the variable chose the place, and a typo there should not quietly make a new folder. D5's
generator covers it as a missing `$DEMO_HOME` (fails `write`) beside a missing `.demo/` (made). Messages name a file as
the start does (`.demo/demo.toml`, `~/.demo/demo.toml`, `$DEMO_HOME/demo.toml`) and the lock as that name plus
`.lock`, never an absolute path. 80% sure.

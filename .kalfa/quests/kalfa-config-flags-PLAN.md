Approved by the lead agent, builds issues 1749, 1806, 1840, 0088, 0089, 0063; body 3caad9261bfa
Plancheck-Version: 3

# Plan: one command-line flag per setting, from its group

This is the kalfa packages, `kalfa/config`, new work: [ticket 1840](https://github.com/kamp-us/tea-fabrika/issues/1840),
a build ticket of [Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749) and
[its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806). Words: `kalfa/config/GLOSSARY.md`, unchanged.
It builds on 1839's `Setting` and `SettingGroup` as landed on main
([pull request 1922](https://github.com/kamp-us/tea-fabrika/pull/1922)).

`SettingGroup.flags(group)` gives one `effect/cli` flag per setting, named as the setting is (`--instance.port`), with
the setting's description as its help text. No flag is made for a file-only setting. The app puts the flags on its own
command; Effect's command-line parser reads the arguments, and the command's handler passes what it got to
`SettingGroup.layer(group, { version, flags })`. The layer reads a flag first, before the environment variable, and
reads its text exactly as it reads the variable's text. A text the schema refuses stops the start with one
`SettingsError`, and the value's origin says `flag`. Nothing in the package reads `process.argv`. One pull request,
about 95 product lines.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import { Setting, SettingGroup } from "@kalfa/config"
import { Command } from "effect/cli"

export const port = Setting.make("instance.port", Port).pipe(
  Setting.withDefault(18800),
  Setting.withDescription("The port the bot listens on."),
)
export const Demo = SettingGroup.make("demo", port, approver)

const demo = Command.make(
  "demo",
  { settings: SettingGroup.flags(Demo) },          // { "instance.port"?: Flag<Option<string>>, ... }
  ({ settings }) =>                                  // { "instance.port"?: Option<string>, ... }
    program.pipe(Effect.provide(SettingGroup.layer(Demo, { version: "1.2.3", flags: settings }))),
)

// demo --instance.port 4200
//   yield* Demo                     -> { port: 4200, approver: Live<"people"> }
//   SettingGroup.origins(Demo)      -> { "instance.port": { _tag: "flag", name: "--instance.port" }, ... }
// demo --instance.port eighty
//   SettingsError { reason: "invalid", message: "--instance.port is not a valid value.\n  demo did not start." }
```

## Calls under 80%, read these first

Each takes the best lean. None needs the owner; each is a way the code does what the ticket and the protocol say.

- **The flag record's keys are optional in its type (70%).** The doubt: `{ readonly [name]?: Flag<…> }` must fit
  `Command.make`'s config, whose type is an index signature, and that holds only under `exactOptionalPropertyTypes`,
  which this repo's base compiler settings turn on. What settles it: F1, checked in the one early package typecheck
  the lead allows in the build brief. The fallback, if F1 cannot compile: `Flags` and `FlagValues` become
  `Readonly<Record<string, …>>`, which fits for sure and loses the names in the type; the build sends that back to the
  plan with the compiler's message rather than bending F1.
- **The flag builder lives in `internal/flags.ts`, re-exported by `SettingGroup.ts` (75%).** It keeps this ticket's
  edits to `SettingGroup.ts` to one export block and the `layer` options, because ticket 1843 changes the same file at
  the same time. The doubt: a reader looks for `flags` in `SettingGroup.ts` first; the re-export's doc comment is
  there.
- **A table- or array-valued setting gets a flag too, read as its variable is (75%).** The ticket says one per
  setting. Today a variable cannot set a table ([issue 1997](https://github.com/kamp-us/tea-fabrika/issues/1997)), so
  its flag cannot either, and both start working when 1997's ruling lands, with no change here. The doubt: a flag in
  `--help` that always refuses a value; the other way, no flag for a table, would make 1997 change flags as well.
- **`flags` refuses a setting whose flag Effect's own built-in global flags would take (75%).** Effect's runner reads
  `--help`, `-h`, `--version`, `-v`, `--wizard`, `--completions` and `--log-level` before the command's own flags
  (`effect/src/cli/Command.ts`, `runWith`, steps 1 and 2), so a setting named `help` would get a flag that never
  reaches the layer. The doubt: only a one-word setting name can clash, and an app that sets its own
  `CliConfig.builtIns` is not seen; the check reads Effect's default list.
- **The `missing` and `scope` messages do not name the flag (75%).** "Set it in … or as DEMO_X" stays as 1839 wrote
  it. The layer does not know whether the app put the flags on its command, and a message that names a flag the
  command lacks would mislead. 1846's `config list` is the place that knows the command.

## How others do it

Read, unless marked "from memory".

- **Elm (from memory).** An Elm program's outside start values are literally called `flags`: `init : flags -> …`,
  decoded with a JSON decoder once at start, and a value that does not decode fails at `init`. That is the ticket's
  third criterion: a flag that does not fit the schema stops the start. Elm also keeps the flags a restart thing; a
  change while running comes as a subscription, as our live settings will (1841).
- **Erlang/OTP (from memory).** `erl -App Key Value` overrides an application's environment over `sys.config` and the
  `.app` default, and `Value` is read with the same term parser as the config file. One text form for a value given
  outside a file is what we copy: a flag's text is read exactly as an environment variable's.
- **Effect 4.1.3, read in `node_modules/effect/src/cli`.** `Flag.String(name)`, `Flag.withDescription`,
  `Flag.optional` (gives `Option<string>`: none when the flag was not given), `Command.Config` (a record of flags,
  nested records allowed), `Command.withSharedFlags` (the same record shape, for flags every subcommand takes),
  `Command.runWith(command, { version })(args)` (runs a command on given arguments; its doc builds an in-memory test
  layer), and `CommandSpec.resolve` (new in 4.1.3: a command's flags as plain data, names, aliases, descriptions,
  required, without running anything). The runner consumes built-in global flags first (`Command.ts`, `runWith`).
  Set aside: `Flag.withSchema` and `Flag.withFallbackConfig`, under "Designed twice".
- **Viper, Go (from memory).** `BindPFlags` binds each command-line flag to a key, a flag wins over every other source,
  and a flag counts only when the person gave it (`flag.Changed`), never at its own default. That is our none versus
  some.
- **Cargo (from memory).** One generic flag, `--config key=value`, for any key, and the origin says "--config cli
  option". Set aside below: it gives no help text per setting, which the ticket asks for.
- **Today's `next/packages/libfabrika/src/node/settings/Command.ts` (read).** It already makes one `Flag.String(path)`
  per declared setting, nested under `settings`, named `--instance.port`, so Effect's parser takes a dotted flag name.
  It is a lesson, rethought and not copied: it used `Flag.withDefault(undefined)`, where `Flag.optional` says the same
  thing with an `Option`.

## Designed twice

1. **The CLI decodes each flag with the setting's schema** (`Flag.withSchema`). Set aside: a bad value becomes a
   `CliError`, not the `SettingsError` the ticket asks for; it decodes before either file is checked, so a repo
   file's fault would no longer come first; and a flag's text would be read differently from a variable's.
2. **Each flag falls back to the setting's own Config** (`Flag.withFallbackConfig`). Set aside: the CLI would resolve
   precedence, so the whole-file checks, the file scope and the origins would all move out of the layer.
3. **One generic flag, `--set name=value`,** as Cargo and git do. Set aside: one help line for every setting.

The pick: a flag carries only the text the person typed, and the layer does everything else, as it does for a
variable.

## The shape

### Making the flags

```ts
// Sketch: kalfa/config/src/internal/flags.ts, re-exported from SettingGroup.ts.
import * as Command from "effect/cli/Command"
import * as CommandSpec from "effect/cli/CommandSpec"
import * as Flag from "effect/cli/Flag"
import type * as Option from "effect/Option"
import type * as Setting from "../Declaration.ts"

/** One flag per setting a flag may set, by setting name. A file-only setting has none, so every key is optional. */
export type Flags<R extends ReadonlyArray<Setting.Any>> = {
  readonly [S in R[number] as S["name"]]?: Flag.Flag<Option.Option<string>>
}

/** What a command's handler gets for those flags: each flag's text, or none when the person did not give it. */
export type FlagValues<R extends ReadonlyArray<Setting.Any>> = {
  readonly [S in R[number] as S["name"]]?: Option.Option<string>
}

// The names and aliases Effect's runner reads before a command's own flags, from its default built-ins.
const kept: ReadonlySet<string>   // from CommandSpec.resolve(Command.make("x"), ["x"]): each global flag's name and aliases

/**
 * Throws an `Error` when a setting's flag would be one of `kept`:
 * "Settings cannot be declared: help is a flag Effect's command line keeps for itself."
 */
export const make: (settings: ReadonlyArray<Setting.Any>) => Readonly<Record<string, Flag.Flag<Option.Option<string>>>>
// each setting that is not file-only:
//   Flag.String(s.name).pipe(Flag.withDescription(s.description), Flag.optional)
```

```ts
// Sketch: added to kalfa/config/src/SettingGroup.ts.
export type { Flags, FlagValues }   // with their doc comments, as `Live` is re-exported today

/** One `effect/cli` flag per setting, for the app's own command. Throws as `flags.make` says. */
export const flags: <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
) => Flags<R>
// SAFETY note on the one cast: make gives one key per setting that is not file-only, named by the setting.

export const layer: <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  options: {
    readonly version: string
    readonly repo?: string
    readonly flags?: FlagValues<R>   // new: what the handler got; left out, no flag was given
  },
) => Layer.Layer<Identifier<App, R>, SettingsError, FileSystem.FileSystem | Path.Path>   // unchanged
```

- **Every flag takes text.** A boolean setting is `--feature.on true` or `--feature.on=true`, read as its variable
  `DEMO_FEATURE_ON=true` is. No bare switch: that would need the schema read for its kind, and a second way to read
  text.
- **The description is always there.** `SettingGroup.make` refuses a setting with no description, so `flags` writes
  no fallback text; the build narrows the type with the check it already has, never with `?? ""`.
- **The record fits `Command.make` and `Command.withSharedFlags`,** so an app can give every subcommand the settings'
  flags (F1).
- **No span.** `flags` is a pure builder that runs once, at module load; the start keeps its one `config.layer` span,
  and no flag text goes in it (F6).

### Reading a flag at the start

```ts
// Sketch: kalfa/config/src/internal/start.ts, inside `resolve`, before the environment's source.
const text = flags[s.name]                                    // Option<string> | undefined
const given = text === undefined ? Option.none() : text

// A file-only setting has no flag. A value can reach here only from a record the program built by hand.
if (s.fileOnly && Option.isSome(given)) {
  return yield* stop(app, "scope", `--${s.name}: ${s.name} may be set only in ${places(app, s, names)}.`)
}

// A flag's text is read as a variable's is: one value, answered at every path the schema asks about.
const flag: Source = {
  provider: ConfigProvider.make(() => Effect.succeed(ConfigProvider.makeValue(given.value))),
  origin: () => Origin.cases.flag.make({ name: `--${s.name}` }),
}

const sources = [...(Option.isSome(given) ? [flag] : []), ...(s.fileOnly ? [] : [env]), files.repo, files.user]
```

- **Precedence** is the glossary's: flag, environment variable, repo configuration, user configuration, default. The
  first source that holds the setting gives its value and its origin, as today.
- **A flag's origin is `{ _tag: "flag", name: "--instance.port" }`,** the flag as written, which is the kind of place
  decision 0088 names. `Origin`'s `flag` case already exists in `Sources.ts`.
- **A refused flag is `invalid`,** through 1839's `refused`, which names a non-file origin by its name and never shows
  the value: `--instance.port is not a valid value.` It has no `file` and no `line`, as a variable's fault has none. It
  never falls back to a weaker source or the default.
- **An empty text is a value** (`--name=` gives some `""`), decoded by the schema: a text setting takes it, a port
  refuses it as `invalid`. A person typed it, so it is never quietly dropped. This differs from a variable on purpose:
  Effect's environment reader counts an empty variable as unset, because shells leave empty variables about.
- **The order stays the protocol's:** the minimum version, then each file whole, then the sources, flags among them.
  A flag fault never comes before a file fault (F11).
- **A key that names no setting** is never read: the layer asks for one key per setting. The type refuses one in a
  written record, and on the command line Effect's parser refuses an unknown flag before the handler runs.

## One value traced

The group above, `demo --instance.port 4200`. The environment has `HOME=/people/one` and `DEMO_INSTANCE_PORT=4100`. The
repo has no `.demo/demo.toml`; the user configuration holds `[instance]` and `port = 4000` on line 2.

1. Effect's runner lexes the arguments, finds no global flag, and parses the command's flags: `--instance.port`
   matches the flag `flags` made, so the handler gets `{ settings: { "instance.port": some("4200"),
   "delivery.approver": none } }`.
2. The handler provides `SettingGroup.layer(Demo, { version: "1.2.3", flags: settings })`. The repo file is missing:
   empty. No `demo-version`. The repo file checks whole.
3. The user file is `/people/one/.demo/demo.toml`, named `~/.demo/demo.toml`. It parses and checks whole.
4. `instance.port`: the flag holds some `"4200"`, so the sources are the flag, the variable, the repo file and the
   user file. The flag is first and holds it. `Config.schema(Port)` reads `"4200"` through the string codec: 4200.
   Origin `{ _tag: "flag", name: "--instance.port" }`. The variable's 4100 and the file's 4000 are never read.
5. `delivery.approver`: none, so no flag source. No variable, no file key: the default `"people"`, origin default.
6. `yield* Demo` gives `{ port: 4200, approver: Live<"people"> }`.

Now `demo --instance.port eighty`. Steps 1 to 3 are the same. At step 4 the flag holds `"eighty"`, the string codec
refuses it, and the layer fails with `SettingsError { reason: "invalid", file: undefined, line: undefined }`, message
`--instance.port is not a valid value.` and `demo did not start.` The variable's 4100 is not used in its place. And if
the repo file had `instance.prot = 1` on line 3 as well, the error would be that `unknown` one, found at step 2,
before any flag is read.

## What fact is lost if it is not recorded now

A value's origin when a flag gave it. It exists only at the start, and the layer keeps it in `origins`, as it does
for every source, so `config list` (1846) and snapshots (1845) can say `--instance.port`. The flags' texts themselves
are not kept: the value is, and a setting never holds a secret's value. Nothing is written to disk.

## Generators

Classes the generated laws must reach. Each id is named in a Plant cell below.

- (a) a flag given for a setting that the environment, the repo file or the user file also holds.
- (b) a flag not given, none, for a setting another source holds.
- (c) an empty flag text, `--name=`.
- (d) a flag text the schema refuses: a number out of range, a word for a number, a literal not in the list.
- (e) a file-only setting in the group.
- (f) a table- or array-valued setting, its text written as JSON.
- (g) a live setting.
- (h) a boolean setting, its text `true` or `false`.
- (i) a secret-looking refused text, with a character that changes in JSON and in a URL.
- (j) a required setting that only a flag sets.
- (l) a one-word setting name, among them each built-in global flag's name and alias.
- (m) a fault in the repo file or the user file at the same start as a refused flag.

The flag on the command line is generated in both forms, `--name value` and `--name=value`, in F4. No product code
reads that difference (Effect's lexer does), so it is not a class.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| F1, the flags fit the command and the layer: `SettingGroup.flags(group)` is a valid `Command.make` config and a valid `Command.withSharedFlags` config with no cast; nested under `settings`, the handler's input for it is exactly `SettingGroup.FlagValues<typeof group.settings>`, and it fits `layer`'s `flags` option with no cast; the keys are the setting names; a written record with a key that names no setting does not compile (`@ts-expect-error`); `layer(group, { version })` with no `flags` still compiles and its type is unchanged | type | type | key `FlagValues` by field in place of name: the handler's input does not fit `flags`, tsc red | kalfa/config/src/SettingGroup.flags.types.test.ts |
| F2, one flag per setting, with its help text: for generated groups of one to four settings, some file-only, `CommandSpec.resolve` of a command made with `{ settings: SettingGroup.flags(group) }` and no built-ins lists one flag for each setting that is not file-only, in the group's order, named the setting's name, with the setting's description, not required; a file-only setting has none. 100 runs | test | Effect Arbitrary: FlagGroup | (e) make a flag for a file-only setting too: F2 red; give every flag the first setting's description: F2 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F3, a flag wins and its origin says flag: for generated groups of one to four settings and a generated placement for each over flag, environment, repo file and user file (all sixteen reached in every run), each value is the first of flag, environment, repo, user that holds it, else its default, and its origin is `{ _tag: "flag", name: "--<name>" }`, the variable, the file and line, or default. 100 runs | test | Effect Arbitrary: FlagPlacement | (a) put the flag's source after the environment's: F3 red; (b) count a flag that was not given as given empty: F3 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F4, through Effect's own parser: for generated groups and values, a command made with `{ settings: SettingGroup.flags(group) }`, run with `Command.runWith` on generated arguments in both forms, whose handler provides the group's layer with `flags: settings`, gives the values and origins F3's oracle gives for the same flags; the test layer is the in-memory one from `runWith`'s own doc (MemoryFiles, `Path.layer`, `Stdio.layerTest`, a `Terminal.make` stand-in, a `ChildProcessSpawner.make` stand-in). 100 runs | test | Effect Arbitrary: CommandLine | name each flag by its field, `--port`: F4 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F5, a refused flag stops the start: a generated flag text the schema refuses, an empty text for a port included, fails with exactly one `SettingsError`, reason `invalid`, no file and no line, a message that names `--<name>` and ends `<app> did not start.`, even when the variable, a file or the default would give a good value. 100 runs | test | Effect Arbitrary: RefusedFlag | (d) on a refused flag, fall to the next source: F5 red; (c) count an empty text as not given: the port starts on its default, F5 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F6 [secrets], a flag's text stays out: a generated secret-looking text the schema refuses, given as a flag, never appears in the error's message, its cause, the `config.layer` span's attributes or a log line, in any of its raw, JSON-escaped and URL-encoded forms. 100 runs | test | Effect Arbitrary: HiddenFlag | (i) put the refused text in the message: F6 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F7, a flag's text is read as a variable's: for a generated schema kind (port, literals, boolean, text, a table, an array) and a generated non-empty text, a start with the text as the setting's flag and a start with the same text as its variable end the same way: the same value, or a `SettingsError` with the same reason and the same message once `--<name>` is swapped for the variable's name. 100 runs | test | Effect Arbitrary: SameText | (f) read a flag's text as JSON: a table's JSON text starts from the flag and is refused from the variable, F7 red; (h) decode a flag's text with the schema's own decoder, not the string codec: `true` is refused from the flag, F7 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F8, a file-only setting has no flag: with its flag given anyway in a record built by hand, a file-only setting stops the start with `scope`, a message that names `--<name>` and its files and never its variable, and no file or line; with no flag it reads from its files or default as B10 says. 100 runs | test | Effect Arbitrary: FileOnlyFlag | (e) read the flag of a file-only setting like any other: the start takes the flag's value, F8 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F9, a required setting a flag sets: a setting with no default, given only by a generated good flag, starts with that value and origin flag; with none it still fails `missing` as B7 says. 100 runs | test | Effect Arbitrary: RequiredFlag | (j) look for a required setting's value in the environment and the files only: F9 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F10, a live setting a flag sets: yielding a live setting's field gives the flag's value, decoded, and its origin is flag, as a restart setting with the same flag gets | test | scenario: one live and one restart setting, each given by a flag, then each also in the environment and both files | (g) build each `Live` from the sources after the flag: F10 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F11, flags are read last of all checks: with a generated fault in the repo file or the user file and a refused flag at the same start, the one error is the file's; with a newer minimum version it is `version`. 100 runs | test | Effect Arbitrary: FlagFaultCase | (m) read the flags before the files are checked: the flag's `invalid` comes first, F11 red | kalfa/config/src/SettingGroup.flags.test.ts |
| F12, a flag Effect's runner would take is refused: for a generated one-word setting name, `SettingGroup.flags` throws an `Error` naming the setting when the name is one of the built-in global flags' names or aliases, read with `CommandSpec.resolve`, and makes the flags when it is not. 100 runs | test | Effect Arbitrary: OneWord | (l) drop the check: a setting named `help` gets a flag the runner never passes on, F12 red | kalfa/config/src/SettingGroup.flags.test.ts |
| L1, the new code imports no kalfa package: the existing package rule holds `internal/flags.ts` | lint | lint | import `@kalfa/records/Finding` in `internal/flags.ts`: `pnpm lint` red | boundary-rules.json |
| O1, 1839's laws hold with no flags: B1 to B17, T1 to T6 and R1 stay green with no edit, since none passes `flags` | test | pinned: 1839's laws, unchanged | (already planted) | kalfa/config/src/SettingGroup.test.ts, kalfa/config/src/SettingGroup.types.test.ts, kalfa/config/src/SettingGroup.integration.test.ts |

**Lint, type or test?** F1 is a shape the compiler sees: type. L1 is a shape of imports that a rule already holds:
lint. F2 to F12 are about what a start or a builder answers at run time, which no type or lint rule sees: tests. O1
pins what exists.

**Where they run.** Every law runs in memory, on every pull request: F2 to F12 on `MemoryFiles` and a test
`ConfigProvider`, F4 also on Effect's runner over the stand-in services its own doc uses. No new `.integration.` law:
no flag needs a real file, process or terminal, so a stand-in will do for each. R1 stays the one real-files check and
runs on main's full run, as does P1, the archive check in `kalfa/config/src/Package.integration.test.ts`, unchanged:
it will show whether the archive's declarations resolve `effect/cli/Flag`. No law is host-only.

**Helpers.** `kalfa/config/src/SettingGroup.flags.test.ts` keeps its own small start helper (memory files, a
`ConfigProvider`, flags) in place of importing the one inside `SettingGroup.test.ts`, which exports nothing and which
ticket 1843 may also change. Moving both helpers into one test-support file is a later cleanup, once both tickets land.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/flags.ts | build | 45 | new: `Flags`, `FlagValues`, the built-in names read once, and `make`, which builds one optional text flag per setting that is not file-only and refuses a built-in name |
| kalfa/config/src/SettingGroup.ts | build | 25 | re-export `Flags` and `FlagValues` with doc comments; `flags(group)` with its one cast and SAFETY note; `layer`'s `flags` option and its line in `layer`'s doc comment (flag first in the order) |
| kalfa/config/src/internal/start.ts | build | 25 | `start` takes the flags; `resolve` puts a given flag's source first, refuses a file-only setting's flag with `scope` |
| kalfa/config/src/SettingGroup.flags.types.test.ts | tests | tests | new: F1 |
| kalfa/config/src/SettingGroup.flags.test.ts | tests | tests | new: F2 to F12, with their own start helper and the in-memory command-line layer |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | no change: F2 to F12 read their files from it |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.integration.test.ts | tests | tests | O1: R1, no change, main's full run |
| kalfa/config/src/Package.integration.test.ts | tests | tests | P1: no change, main's full run |
| boundary-rules.json | tests | tests | L1: no change, the rule that holds it |

No change to `kalfa/config/GLOSSARY.md`: no new domain word. **Flag**, **Precedence**, **Origin** and **File-only
setting** already say all of this. No change to `kalfa/config/README.md`: it still describes today's twelve entry
points, which 1849 rewrites for the new API; the doc comments on `flags` and `layer` are the new API's docs until then.
No change to `index.ts` or the package manifest: `SettingGroup` is already exported from the root.

**Files ticket 1843 may touch too.** Ticket 1843 (edit one key) is planned at the same time in another worktree. Both
are likely to change `kalfa/config/src/SettingGroup.ts` (it adds `edit`, `set` and `remove`) and
`kalfa/config/src/internal/start.ts` (its edit checks a whole file with the start's check). This plan keeps its
edits there small and local: one export block and the `layer` options in `SettingGroup.ts`; `resolve`'s source list
and `start`'s options in `start.ts`. The flag code itself is in a new file. Whichever lands second merges main and
runs both tickets' laws. This plan does not touch `MemoryFiles.test-support.ts`, which 1843 may give a write.

## Existing tools

- kalfa/config/src/internal/flags.ts: searched `effect/cli` 4.1.3 (`Flag`, `Param`, `Command`, `CommandSpec`,
  `GlobalFlag`), today's `kalfa/config/src/Sources.ts` (`Sources.flags` builds a source from a flag record, but takes
  today's group and is not an `effect/cli` flag) and today's libfabrika settings command (makes the flags inline in
  one command). Effect has no "flags from a list of declarations"; the builder is one `Flag.String` pipe per setting
  over Effect's own flags. The built-in names come from `CommandSpec.resolve`, Effect's public read of a command's
  flags, never a hand-written list; `Param.extractSingleParams` would also do it but is marked internal.
- `flags` in kalfa/config/src/SettingGroup.ts: searched the module for a builder over a group: none. It is the
  protocol's named call, `SettingGroup.flags(group)`.
- The flag's source in kalfa/config/src/internal/start.ts: searched `ConfigProvider` for a one-value provider:
  `ConfigProvider.make` with `ConfigProvider.makeValue`, used as is. `Origin.cases.flag` and 1839's `refused`,
  `places` and `stop` are reused as they are. No new helper.

## Calls taken

Each picks how the code does what the ticket, the protocol or a decision already says. The ones under 80% are at the
top.

- **`flags` is on the root's `SettingGroup`, not on `/cli`.** 85% sure. The protocol names `SettingGroup.flags(group)`
  beside `layer`, and keeps `/cli` for `SettingGroup.cli`, the `config` command. `effect` marks itself free of side
  effects, so a Worker bundle that never calls `flags` drops `effect/cli`.
- **A flag carries text and the layer reads it.** 90% sure. The third criterion needs a `SettingsError`, which only
  the layer makes, and "Designed twice" gives the rest.
- **A flag's text is read as a variable's, and the same code path reads both.** 85% sure. One text form for a value
  given outside a file, as OTP does. F7 holds it.
- **The `flags` option of `layer` is optional.** 85% sure. A test, a worker or a program with no command line has no
  flags, and a missing option means no flag was given; the type still holds the names when it is given.
- **A flag's name is the setting's name, origin `--<name>`.** 90% sure. The glossary's Flag, today's libfabrika
  command, and decision 0088's flag place, written `--instance.port`.
- **An empty flag text is a value.** 80% sure. The reason is under "Reading a flag". The doubt is the other way's
  consistency with the environment; F5 and F7 pin each side.
- **A file-only setting gets no flag here, and a hand-built flag for it stops the start with `scope`.** 80% sure.
  Ticket 1842's first criterion and the glossary say "no flag is made"; doing it now closes the gap 1842's ticket
  would otherwise leave open, as 1839 did with the environment. Stopping, not ignoring, follows 1806's second ruling:
  a quiet ignore would hide a try at going around a change request. 1842 keeps the environment variable's stop.
- **Flags use `Flag.optional`, never a default.** 90% sure. A setting's default belongs to the layer, so an absent
  flag must stay absent and never show up as a value (Viper's `Changed`). F3's plant (b) holds it.
- **No new span, no new error reason.** 85% sure. A flag fault is `invalid` or `scope`, two of the seven reasons, and
  T5 keeps the layer's error type exactly as it is.
- **Is this a setting?** No new choice is. Precedence is the glossary's; the flag's name follows the setting's; every
  other choice is how the API reads a value. None is a value a person would pick for a repo.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/config/src/SettingGroup.flags.test.ts` shows F2
  to F12 red on the branch head; F1 is written and named as judged by the compiler run the lead allows the build.
- Build step: the same path green, each plant red once; `kalfa/config/src/SettingGroup.test.ts` still green.
- The lead may allow the build one early `pnpm --filter @kalfa/config typecheck`, right after the types land, so F1's
  doubt is settled in minutes.
- The lead runs `--changed origin/main` and one `pnpm typecheck`. R1 and P1 run in main's full run.

## Size

1. One pull request: about 95 product lines (`internal/flags.ts` 45, `SettingGroup.ts` 25, `internal/start.ts` 25),
   plus two test files. It lands whole: flags with no reader in the layer do nothing, and the layer's option has no
   source without the flags.

About 2.5 agent hours across tests, build and review, 75% sure. The doubt is F1: if the optional keys do not compile
through `Command.Config.Infer`, one short round goes back to the plan for the fallback. Basis: 1839's plan,
`.kalfa/quests/kalfa-config-declare-PLAN.md`, came to about $8 a step at list price for Opus steps; this quest is
tests, build and review, plus one likely send-back of tests and build, at the same price.

Estimate: 6 steps, $50

## Records

- No new glossary term; the entries named under Files cover it.
- No decision record. Each call applies the protocol, the glossary or decision 0088, and none is hard to undo before
  1847 and 1848 move a caller.
- No pattern doc. `.kalfa/patterns/settings.md` still describes today's shape until 1849.
- On ticket 1842, the lead notes that its first criterion ("no flag is made for a file-only setting") lands here, with
  F2 and F8 as its laws.

## What this cannot tell us

- Whether one flag per setting clutters `--help` for an app with many settings. The protocol named the doubt; Delivery's
  twenty-odd settings are the first real look.
- Whether the optional-key types compile through `Command.Config.Infer` (F1, above). A fallback is named.
- A negative number after a space, `--x.offset -5`, is lexed by Effect as a short flag, from reading
  `effect/src/cli/internal/lexer.ts`, not from a run; `--x.offset=-5` works. That is Effect's parser, not ours.
- Effect's own refusals (an unknown flag, a flag with no value, a flag given twice) are `CliError`s, shown with help,
  and stop before the layer runs. They are not `SettingsError`s, and no law here checks them.
- An app that sets its own `CliConfig.builtIns` may take more names than F12's check knows.
- A live setting a flag sets: once 1841 watches the files, a file edit must not replace the flag's value, since the
  flag wins. 1841's plan has to say it; nothing here watches.
- A table- or array-valued setting's flag refuses every text until 1997 rules how the environment writes one.

## Open questions

None.

Every choice above picks how the code does what the ticket, the protocol, 1806's rulings, the glossary or decision
0088 already says.

## Findings

1. **Issue 1997's body says a table can be set from a flag.** "So a record-valued setting can be set only from a
   file or a flag" ([issue 1997](https://github.com/kamp-us/tea-fabrika/issues/1997)). After this plan a flag's text
   is read exactly as a variable's, so a flag cannot set a table either, and 1997's ruling covers both. The lead may
   add a line to 1997.
2. **No open ticket makes `SettingsError` carry its place as data.** Decision 0088's consequences say Configuration's
   error must say where it came from as data (the repo file, the user file, a variable or a flag). The `SettingsError`
   in `kalfa/config/src/internal/error.ts` has `file` and `line` only, so a variable's or a flag's fault names its
   place in the message alone. Proof: the open `Config:` tickets (1841 to 1849, 1995 to 1997) and a search for
   "SettingsError" on the tracker find none that builds it; 1839's plan set "a settings error that carries a
   diagnostic" aside as its own ticket. Out of this ticket.
3. **Effect's help and its parser may disagree on a flag that shares a built-in's name.** `CommandSpec.resolve` says
   a nearer scope wins a shared name (`effect/src/cli/CommandSpec.ts`, `resolve`), while `runWith` consumes global
   flags before the command's own (`effect/src/cli/Command.ts`, `runWith`, steps 1 and 2). Read only, not run, so
   not reported upstream; F12 keeps our side from reaching it. A run that shows `--help` listing a command's own
   `--version` while the runner prints the version would be the repro.

## Amendment 1 (2026-11-22): `Flags` when the names are `string`

The tests step found that a group whose setting names are `string`, not literals, gives
`{ readonly [x: string]?: Flag }`, which `Command.make` refuses, so F2 and F4 had built their command from a
test copy of the flags. The lead's call: `Flags<R>` is a plain `Readonly<Record<string, Flag.Flag<Option.Option<string>>>>`
when `R[number]["name"]` is `string`, and keeps optional named keys when the names are literals. `FlagValues<R>`
follows the same rule. F1 gains a case: a `SettingGroup<string, ReadonlyArray<Setting.Any>>` fits `Command.make` and
`layer`'s `flags` option with no cast. F2 and F4 build their command from `{ settings: SettingGroup.flags(group) }`, as
the plan says. The doubt at the top (70%) is settled: both cases compile against a throwaway product. No other change.

Approved by the lead agent, builds issues 1749, 1842; body 130897f5f378
Plancheck-Version: 3

# Plan: a file-only setting, which only a configuration file may set (ticket 1842)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1842, under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749) and
[its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806), whose rulings 1 and 2 this builds. Words:
`kalfa/config/GLOSSARY.md`, unchanged: its **File-only setting** entry already says what this builds.

Most of the ticket is on main already. `Setting.fileOnly` exists (`kalfa/config/src/Declaration.ts`, ticket 1839), the
start skips the environment for it (`kalfa/config/src/internal/read.ts`, law B10), and no flag is made for it
(ticket 1840, laws F2 and F8). What is left: **an environment variable that names a file-only setting stops the
start** with one `SettingsError` naming the variable, in place of today's quiet skip. Beside that, the plan makes
file-only a mark in the type, as `live` is, so a flag record that names a file-only setting does not compile. One pull
request, about 45 product lines.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import { Setting, SettingGroup } from "@kalfa/config"

export const refRules = Setting.make("reconciliation.ref-rule", RefRules).pipe(
  Setting.withDefault({}),
  Setting.withDescription("What each managed ref must look like."),
  Setting.files(["repo"]),
  Setting.fileOnly,
  Setting.live,
)
// type: Setting<"reconciliation.ref-rule", RefRules, true, true>   (live, file-only)

export const Demo = SettingGroup.make("demo", refRules, port)

// DEMO_RECONCILIATION_REF_RULE='{"main":{}}' demo
//   SettingsError { reason: "scope", file: undefined, line: undefined, message:
//     "DEMO_RECONCILIATION_REF_RULE: reconciliation.ref-rule may be set only in .demo/demo.toml.\n  demo did not start." }
// demo   (no such variable)
//   yield* Demo -> { refRule: Live<RefRules>, port: 18800 }, refRule read from .demo/demo.toml or its default
// SettingGroup.flags(Demo) -> { "instance.port"?: Flag, "config.watch.debounce"?: Flag }   no key for refRules
```

## Calls under 80%, read these first

- **Lead's call at signing (2026-11-23): keep the file-only mark in the type.** A flag record that names a file-only
  setting is a state no start can accept, so it should not compile. That follows the repo's rule to make invalid
  states unrepresentable, and 1839's one-mark choice was a plan note, not a decision.

- **File-only becomes a mark in the type, as `live` is (70%).** `Setting<N, A, L, F>` gains `F`, the file-only mark,
  and `Flags<R>` and `FlagValues<R>` drop the key of a file-only setting. Why: today the flag record's type has an
  optional key for a file-only setting, which is a key no flag ever fills, so a hand-written record that sets it
  compiles and only the start refuses it (F8). With the mark in the type, that record does not compile, and the
  declaration reads as two marks side by side, which is the ticket's fourth criterion read literally. The doubt: it
  walks back 1839's plan, which kept `live` as the one combinator that changes the type, and it rewrites T1's and F1's
  expected types. What it costs: about 15 product lines in `Declaration.ts` and `internal/flags.ts`, and the type laws
  FO6, T1 and F1. What settles it: the lead's read. It is separable: striking it removes FO6, the T1 and F1 edits and
  the `Declaration.ts` and `flags.ts` rows, and nothing else in the plan depends on it. F8 stays either way, because a
  group whose names are plain `string` has a plain record of flags.

## How others do it

Read, unless marked "from memory".

- **Elm (from memory).** Elm has no settings sources to limit: a program's outside values come once, as `flags` to
  `init`. Nothing to copy beyond what 1840 took.
- **Erlang/OTP (from memory).** An application's environment comes from the `.app` file, `sys.config` and `erl -App
  Key Value`, and the command line always wins. OTP has no way to say a key may come only from a file. No answer found.
- **git, read in the git-config documentation (https://git-scm.com/docs/git-config, "Protected configuration").** "For
  security reasons, certain options are only respected when they are specified in protected configuration, and
  ignored otherwise." Protected is the system, global and command scopes. git limits a key by where it came from, as
  we do, and ignores quietly.
- **Renovate, read in its self-hosted configuration page (https://docs.renovatebot.com/self-hosted-configuration/).**
  Some options "must be configured in the admin config"; in a repository's config "Renovate will ignore those config
  options, and may also create a config error issue." The same idea, and louder than git: the person is told.
- **Effect 4.1.3, read in `node_modules/effect/src/ConfigProvider.ts`.** `Config` has no notion of a source a key may
  not come from; precedence is `ConfigProvider.orElse` or a list of providers, which is what `internal/read.ts`
  already builds per setting. `fromEnv` captures the environment once, when the provider is made, and counts an empty
  variable as missing unless `preserveEmptyStrings: true`. It answers a one-segment path such as
  `["DEMO_NET_KEY_FILE"]` only from a variable of exactly that name: its tree of child names is built by splitting
  names on `_`, so a child variable `DEMO_NET_KEY_FILE_X` is not seen at that path.

git and Renovate protect against the repo's own file; we protect the repo's file against a flag and a variable. The
direction differs, the mechanism is the same: a key is limited by its source. Ruling 2 picks Renovate's loud way over
git's quiet one.

## The shape

### The stop

```ts
// Sketch: kalfa/config/src/internal/read.ts, inside `resolve`, after the flag's check (which is unchanged).
// The one `env` Source the read already builds, now built before the file-only checks.
const env: Source = {
  provider: setup.provider.pipe(ConfigProvider.mapInput(() => [name])),
  origin: () => Origin.cases.env.make({ name }),
}

// A file-only setting is never read from the environment, and a variable that names it stops the start.
// The check asks the same source the read would ask, so it sees exactly what the read would have taken.
if (s.fileOnly) {
  const named = yield* holder(setup, s, [env])          // Option<Source>; a SourceError is `read`, as today

  if (Option.isSome(named)) {
    return yield* stop(app, "scope", `${name}: ${s.name} may be set only in ${places(app, s, names)}.`,
      undefined, undefined, closing)
  }
}

const sources = [...Option.toArray(flag), ...(s.fileOnly ? [] : [env]), files.repo, files.user]
```

- **Where it runs.** Inside `resolve`, so in the protocol's order: the minimum version, each file whole, then each
  setting in the group's order, with the first fault the one error. For one setting, the flag's check (F8) comes
  before the variable's, as a flag comes before a variable in precedence. A file fault always comes first (FO4).
- **What it reads.** Only the variable the read would ask for, through the same `Source`. That is the guarding check
  this plan adds: an exact name, asked of the current `ConfigProvider`. It never lists the environment, never matches
  a prefix and never reads a near name. An empty variable under Effect's default provider is unset, so it does not
  stop the start; under a provider that keeps empty strings it does. Either way the stop and the read agree (FO2).
- **What it never does.** It never decodes the variable's text, so a refused text stops with `scope`, not `invalid`,
  and the text goes nowhere: not in the message, the cause, the span or a log (FO3).
- **The message** has the flag's form from F8, with the variable in the flag's place: `<VAR>: <name> may be set only
  in <files>.` and the start's closing line. `places` already leaves the variable out of a file-only setting's list.
  No `file` and no `line`, as every fault in the environment has none.
- **Required settings.** A required file-only setting given only by its variable stops with `scope`, not `missing`:
  the variable is the fault a person must fix, and `missing` would tell them to set what they already set.
- **Live settings.** The provider is captured once, at the start, and the watcher re-resolves from the same `Setup`,
  so a running process never meets the stop: a start that passed it passes it again on every file change.
- **Edits are not touched.** `SettingGroup.edit`, `set` and `remove` read no environment; a file-only setting is
  edited as any other (E3 and E5 keep holding it).

### The mark in the type (the call at the top)

```ts
// Sketch: kalfa/config/src/Declaration.ts.
export interface Setting<N extends string, A, L extends boolean = false, F extends boolean = false> extends Pipeable {
  readonly name: N
  readonly schema: Schema.Codec<A, unknown>
  readonly default: Option.Option<A>
  readonly description: string | undefined
  readonly files: Files
  readonly live: L
  readonly fileOnly: F
}
export type Any = Setting<string, any, boolean, boolean>
export type Type<S extends Any> = S extends Setting<string, infer A, boolean, boolean> ? A : never

/** Marks a setting that only a file may set: no flag is made for it, and a variable that names it stops the start. */
export const fileOnly: <N extends string, A, L extends boolean>(self: Setting<N, A, L, false>) => Setting<N, A, L, true>

/** Turns the live mark on. It keeps the file-only mark as it was. */
export const live: <N extends string, A, F extends boolean>(self: Setting<N, A, false, F>) => Setting<N, A, true, F>
```

```ts
// Sketch: kalfa/config/src/internal/flags.ts. Only the key filter is new.
export type Flags<R extends ReadonlyArray<Setting.Any>> = string extends R[number]["name"]
  ? Readonly<Record<string, Text>>
  : { readonly [S in Watched<R>[number] as S["fileOnly"] extends true ? never : S["name"]]?: Text }
// FlagValues<R>: the same filter.
```

- Each mark is set once: `fileOnly` twice does not compile, as `live` twice does not (FO6).
- A setting whose mark is `boolean` (a test helper's union) keeps its key, so nothing that compiles today stops
  compiling for that reason.
- `Read<S>`, `Values<R>` and `Origins<R>` do not change: a file-only setting has a value and an origin as any other.

### Doc comments

The `fileOnly` comment in `Declaration.ts` loses "The environment is not read for it" and says the stop. `layer`'s
comment in `kalfa/config/src/SettingGroup.ts` gains one sentence: a file-only setting is read from its files and its
default only, and a flag or a variable that names it stops the start with `scope`. `SettingsError`'s comment in
`kalfa/config/src/internal/error.ts` widens `scope` to "the setting exists, but not in this place: another file, or a
flag or a variable for a file-only setting". No README change: the README still describes the old twelve entry
points for the start, and ticket 1849 rewrites it.

## One value traced

The group above, `demo` started with `HOME=/people/one` and `DEMO_RECONCILIATION_REF_RULE='{"main":{}}'`. The repo
configuration `.demo/demo.toml` holds `[reconciliation.ref-rule.main]` on line 1 and `approvals = 2` on line 2. No
user configuration. No flags.

1. The repo file is read. No `demo-version`. It is checked whole against the settings its file scope allows:
   `reconciliation.ref-rule` may sit in the repo file, so it passes.
2. The user file is `/people/one/.demo/demo.toml`, missing: empty, which passes.
3. `reconciliation.ref-rule` is resolved first, in the group's order. No flag was given, so F8's check passes. It is
   file-only, so `holder` asks the `env` source for `["DEMO_RECONCILIATION_REF_RULE"]`; Effect's provider answers a
   value. The start fails with `SettingsError { reason: "scope", file: undefined, line: undefined }`, message
   `DEMO_RECONCILIATION_REF_RULE: reconciliation.ref-rule may be set only in .demo/demo.toml.` and `demo did not
   start.` The text `{"main":{}}` was never decoded and appears nowhere.
4. `instance.port` is never resolved: the first fault is the one error.

With the variable removed, step 3 finds nothing in the environment, takes the source list repo file then user file,
and reads `{ main: { approvals: 2 } }` from the repo file, origin `{ _tag: "file", file: ".demo/demo.toml", line: 1 }`.
`refRule` is a `Live`, and its `changes` follow edits to the repo file as 1841 built.

If the repo file had also held `instance.prot = 1` on line 3, the error would have been that `unknown` one, found at
step 1, before any variable is read.

## What fact is lost if it is not recorded now

None. The stop writes nothing and keeps nothing; the variable's value is never read into memory past the provider's
own answer. A refused start leaves no origin to keep. Whether someone tried to go around the change request is shown
to the person who started the app, in the error, and that is the ruling's aim.

## Generators

Classes the generated laws must reach. Each id is named in a Plant cell below.

- (a) a file-only setting whose variable holds a text its schema takes.
- (b) a file-only setting whose variable holds a text its schema refuses.
- (c) a required file-only setting set only by its variable.
- (d) a file-only setting whose variable is set and whose value also sits in a file its scope allows.
- (e) each file scope of a file-only setting: repo only, user only, both.
- (f) an empty variable, under Effect's default provider and under a provider made with `preserveEmptyStrings: true`.
- (g) near names that are not its variable: the variable of the setting's table (`<APP>_<TABLE>`), the same name
  under another app's prefix, and the name in lower case.
- (h) a child variable `<VAR>_<KEY>` of a table-valued file-only setting, with its own variable unset.
- (i) a secret-looking text in the variable, with a character that changes in JSON and in a URL.
- (j) a fault in the repo file or the user file (syntax, unknown key, scope, refused value) or a newer minimum
  version, at the same start as a file-only setting's variable.
- (k) a flag handed by hand for a file-only setting whose variable is also set.
- (l) two file-only settings with their variables set, and a setting earlier in the group's order whose variable is
  refused.
- (m) a setting that is not file-only beside the file-only one, its variable set to a good text.
- (n) a live file-only setting.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| FO1, a variable stops the start: for generated groups of two or three settings, one file-only with a generated file scope, its variable set, and its value in an allowed file or not, the start fails with exactly one `SettingsError`, reason `scope`, no file and no line, a message that opens `<VAR>: <name> may be set only in`, names exactly the files of its scope and no other, never names `--<name>`, and ends `<app> did not start.`; the setting beside it that is not file-only reads its variable, origin env. 100 runs, every class reached in every run | test | Effect Arbitrary: FileOnlyVariable | (a) drop the stop: the start takes the file's value or the default, red; (b) decode the variable before the stop: a refused text fails `invalid`, red; (c) look for `missing` before the stop: a required setting fails `missing`, red; (d) stop only when no file holds the setting: a file's value excuses the variable, red; (e) name both files whatever the scope: red; (m) skip the environment for every setting of a group that has a file-only one: the control reads its default, red | kalfa/config/src/SettingGroup.fileOnly.test.ts |
| FO2, the stop sees exactly what the read sees: for a generated file-only setting and a generated environment from the classes, with a provider made by `fromEnv` with and without `preserveEmptyStrings`, the start of the group stops with FO1's error exactly when the start of the same group with the mark off gives that setting origin env or refuses it from its variable; otherwise both starts give it the same value and the same origin. The oracle is the unmarked start, so the law holds when ticket 1997 changes what the environment source reads. 100 runs, every class reached in every run | test | Effect Arbitrary: NearVariable | (f) let an empty text pass the stop: under the provider that keeps empty strings the unmarked start reads `""` from the variable and the marked one starts, red; (g) also ask for the table's variable `<APP>_<TABLE>`: a near name stops the start, red; (h) ask for the variable's words as a path (`["DEMO", "NET", "KEY"]`): a child variable stops the start while the read ignores it, red | kalfa/config/src/SettingGroup.fileOnly.test.ts |
| FO3 [secrets], the variable's text stays out: a generated secret-looking text in a file-only setting's variable never appears in the error's message, its cause, `Cause.pretty`, the `config.layer` span's attributes or a log line, in any of its raw, JSON-escaped and URL-encoded forms. 100 runs | test | Effect Arbitrary: HiddenVariable | (i) put the variable's text in the message: red | kalfa/config/src/SettingGroup.fileOnly.test.ts |
| FO4, the order of faults: with a generated file fault or a newer minimum version at the same start, the one error is the file's or `version`; with a flag handed by hand as well, the one error names `--<name>` (F8's); with two file-only settings and their variables, it names the first in the group's order; and a refused variable of a setting earlier in the group's order comes before a later file-only setting's stop. 100 runs | test | Effect Arbitrary: StopOrder | (j) check file-only settings' variables before the files are checked: the variable's `scope` comes first, red; (k) check the variable before the flag: the message names the variable, red; (l) check every file-only setting's variable in a first pass, before resolving any setting: the stop comes before the earlier `invalid`, red | kalfa/config/src/SettingGroup.fileOnly.test.ts |
| FO5, a live file-only setting: a setting marked live and file-only, in both pipe orders, beside a live setting that is not file-only, follows its files through a generated script of file changes exactly as a fresh start on the same files gives (V1's oracle), is never read from a variable set at the start of the script, and with that variable set the start stops with FO1's error. The generator is V1's `Shape` and `Walk`, with at most three settings and a script of at most six steps. 100 runs | test | Effect Arbitrary: LiveFileOnly | (n) check the mark only on restart settings: the live file-only setting takes its variable, red | kalfa/config/src/SettingGroup.live.test.ts |
| FO6, the mark is in the type: a setting piped through `fileOnly` and `live` with the other combinators, in each of several orders, has type `Setting<N, A, true, true>`; with `fileOnly` alone it is `Setting<N, A, false, true>`; `fileOnly` twice does not compile (`@ts-expect-error`); a group of literal names reads a live file-only setting as `Live<A>`; its `Flags` and `FlagValues` have no key for a file-only setting, and a hand-written flag record that names one does not compile (`@ts-expect-error`) | type | type | type `fileOnly` as `<S extends Any>(self: S) => S`: the `true` mark is lost and the twice line compiles, tsc red; key `Flags` by every setting's name: the record that names a file-only setting compiles, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| B10, changed: a file-only setting reads from the files or its default with its variable unset, and its origin is never `env`, while a setting beside it still reads its variable. Its old case, the variable set to a good value, is FO1's now. 100 runs | test | Effect Arbitrary: FileOnlyCase | (m) skip the environment for every setting of a group that has a file-only one: the control beside it reads its default, red | kalfa/config/src/SettingGroup.test.ts |
| F8, changed: the half with a flag handed by hand keeps its generated variable and still stops with `--<name>`; the half with no flag sets no variable and reads from the files or the default. 100 runs | test | Effect Arbitrary: FileOnlyFlag | (k) check the variable before the flag, kept from FO4: red | kalfa/config/src/SettingGroup.flags.test.ts |
| T1 and F1, changed: T1's expected types gain the file-only mark (`Setting<…, Rule, false, true>` for `restartA` to `restartD`, `Setting<…, Rule, true, true>` for the live ones, `base` unchanged); F1's names lose `net.key-file`, the group's file-only setting | type | type | (already planted: T1's and F1's own plants still turn them red) | kalfa/config/src/SettingGroup.types.test.ts, kalfa/config/src/SettingGroup.flags.types.test.ts |
| O1, the rest holds: B1 to B9 and B11 to B17, T2 to T6, F2 to F7 and F9 to F12, the edit laws, the disk laws, V1 to V19 and TL1 to TL3 stay green with no edit; B5 keeps holding the third criterion, that the file scope still decides which file may set a file-only setting | test | pinned: their own generators, unchanged | (already planted) | kalfa/config/src/SettingGroup.test.ts, kalfa/config/src/SettingGroup.edit.test.ts, kalfa/config/src/SettingGroup.disk.test.ts, kalfa/config/src/SettingGroup.live.test.ts, kalfa/config/src/SettingGroup.live.types.test.ts |

**Lint, type or test?** FO6 is a shape the compiler sees: type. FO1 to FO5 are about what a start answers at run
time, which no type or lint rule sees: tests. No shape of imports changes, so no lint law: the change adds no file
and no import.

**Where they run.** Every law runs in memory on every pull request: `MemoryFiles` and a test `ConfigProvider`, with
Effect's `TestClock` for FO5. No new `.integration.` law: a variable is a `ConfigProvider` answer, and the stand-in
provider is Effect's own `fromEnv` over a record, so a stand-in will do. No law is host-only. R1, R3 and P1 run in
main's full run, unchanged.

**Run time.** Each law stays under about 20 s at full depth, 100 runs, on the laptop: groups of at most three
settings, at most four padding lines a file, and at most twelve starts a run (FO2's six environment classes, each
started marked and unmarked). FO5 walks one script of at most six steps a run, not V1's full tour of every kind. The
tests step times each new law once with `FABRIKA_TEST_DEPTH=full` and splits a law by class if it passes 20 s, as the
Markdown laws were split.

**Helpers.** `kalfa/config/src/SettingGroup.fileOnly.test.ts` keeps its own small start helper (memory files, a
provider, flags), as `SettingGroup.flags.test.ts` does, in place of importing from a test file that exports nothing.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/read.ts | build | 18 | `resolve`: build the `env` source before the file-only checks, and stop with `scope` when it holds a file-only setting |
| kalfa/config/src/Declaration.ts | build | 12 | the file-only mark `F` on `Setting`, `Any` and `Type`; `fileOnly` and `live` typed to keep each other's mark; the doc comments |
| kalfa/config/src/internal/flags.ts | build | 4 | `Flags` and `FlagValues` drop a file-only setting's key |
| kalfa/config/src/SettingGroup.ts | build | 4 | `layer`'s and `Flags`' doc comments |
| kalfa/config/src/internal/error.ts | build | 2 | `scope` in `SettingsError`'s doc comment |
| kalfa/config/src/SettingGroup.fileOnly.test.ts | tests | tests | new: FO1 to FO4, with their own start helper |
| kalfa/config/src/SettingGroup.live.test.ts | tests | tests | FO5 |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | FO6; T1's expected types |
| kalfa/config/src/SettingGroup.flags.types.test.ts | tests | tests | F1's names |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | B10's environment |
| kalfa/config/src/SettingGroup.flags.test.ts | tests | tests | F8's no-flag half |
| kalfa/config/src/SettingGroup.edit.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.disk.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/SettingGroup.live.types.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | no change: the new laws read their files from it |

No change to `kalfa/config/GLOSSARY.md`: no new domain word, and **File-only setting**, **File scope**, **Environment
variable** and **Flag** already say all of this. No change to `kalfa/config/README.md` (1849 rewrites it), `index.ts`
or the package manifest.

## Existing tools

- The stop in kalfa/config/src/internal/read.ts: searched `read.ts`, `check.ts`, `error.ts`, `names.ts` and
  `Sources.ts` for a way to ask whether a source holds a setting and to word a source's refusal. Found and reused
  as they are: `holder` (the first source that holds a setting), the `env` source `resolve` already builds, `places`
  and `stop`, with F8's message form. `Sources.env` in `kalfa/config/src/Sources.ts` reads a plain record for the old
  `App` API and is not a provider, so it does not fit. No new function.
- The mark in kalfa/config/src/Declaration.ts and kalfa/config/src/internal/flags.ts: searched `Declaration.ts` for
  how a mark lives in the type: `live`'s `L` parameter is the pattern, copied for `F`. Effect's own pipeable data
  types carry such flags as type parameters too (`effect/cli` `Flag` keeps its value type). No new function.

## Calls taken

Each picks how the code does what the ticket, 1806's rulings or the glossary already say. The one under 80% is at the
top.

- **The reason is `scope`.** 85% sure. F8 stops a file-only setting's flag with `scope`, the glossary's File scope is
  "which place may set a setting", and a new reason would change T5's nine. The message tells flag from variable.
- **The stop asks the same `env` source the read asks.** 85% sure. One source means the stop cannot drift from the
  read: when ticket 1997 lets a variable per key set a table (the owner's ruling of 2026-11-23 on
  https://github.com/kamp-us/tea-fabrika/issues/1997), the stop sees those variables in the same change, and FO2's
  unmarked oracle checks it.
- **An empty variable stops the start only where the provider reads it.** 80% sure. Under Effect's default an empty
  variable is unset, so it sets nothing and goes around nothing; stopping on it would make the stop see what the read
  never sees. The doubt: the ruling says "a variable that names it", and an empty `DEMO_X=` names it in a shell's
  eyes. FO2's class (f) pins both providers.
- **The stop runs inside `resolve`, after both files are checked.** 85% sure. It is the protocol's order, as 1840
  put flags last (F11). FO4 pins it.
- **A required file-only setting given only by its variable stops with `scope`, not `missing`.** 85% sure. The
  variable is the thing to fix.
- **The message has F8's form.** 85% sure: `<VAR>: <name> may be set only in <files>.`, so a flag's and a variable's
  stop read alike.
- **No change to the edit calls or the watcher.** 90% sure. Neither reads the environment after the start.
- **Is this a setting?** No new choice is. Whether a variable stops is ruled; the reason, the order and the words
  are how the code says what is ruled. None is a value a person would pick for a repo.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/config/src/SettingGroup.fileOnly.test.ts
  kalfa/config/src/SettingGroup.live.test.ts kalfa/config/src/SettingGroup.test.ts
  kalfa/config/src/SettingGroup.flags.test.ts` shows FO1 to FO5 red on the branch head (FO2 through its cases where the
  unmarked start reads the variable; its other cases are green today) and B10 and F8 green; FO6 and the T1 and F1
  edits are judged by the compiler run the lead allows the build.
- Build step: the same paths green, each plant run once and undone; one early
  `pnpm --filter @kalfa/config typecheck` if the lead allows it, right after the `Declaration.ts` types land, so
  FO6's doubt about test helpers that pipe a union through `live` is settled in minutes.
- The lead runs `--changed origin/main` and one `pnpm typecheck`. R1, R3 and P1 run in main's full run.

## Size

1. One pull request: about 40 product lines (`internal/read.ts` 18, `Declaration.ts` 12, `internal/flags.ts` 4,
   `SettingGroup.ts` 4, `internal/error.ts` 2), plus one new test file and edits to five. It lands whole: the stop
   and the type mark each stand alone, but both close the same ticket, and the type mark changes laws the stop's
   tests file sits beside.

About 2 agent hours across tests, build and review, 75% sure. The doubt is FO6: a test helper that pipes a union of
marks may need a type change in a test-support file. Basis: 1840's plan, `.kalfa/quests/kalfa-config-flags-PLAN.md`,
about the same size, priced at about $8 a step for Opus steps; this quest is tests, build and review, plus one likely
send-back of tests and build.

Estimate: 5 steps, $40

## New names

- `SettingGroup.fileOnly.test.ts`: a test file named for the mark, as `SettingGroup.live.test.ts` is.
- The type parameter `F` on `Setting`: a code name for the file-only mark, beside `L` for the live mark.

## Records

- No new glossary term: the entries named under Files cover it.
- No decision record. 1806's ruling 7 says none of this is hard to undo, and no caller uses the API yet.
- No pattern doc: `.kalfa/patterns/settings.md` describes today's shape until 1849.
- On https://github.com/kamp-us/tea-fabrika/issues/1997, the lead notes that its per-key variables must reach the
  file-only stop through the one environment source, that FO2 checks it, and Findings 1 below.
- On https://github.com/kamp-us/tea-fabrika/issues/1845, the lead notes that a process started from snapshots reads
  no environment, so the variable's stop holds on the loading process only, as 1806 said.
- Ruling 6, `config list` and `config reference` showing a file-only setting, is ticket 1846's, whose criteria already
  say it.

## What this cannot tell us

- Whether a stray variable in CI will bite. The ruling took that cost: the run stops until the variable is removed,
  and the message names it.
- A program that builds its own `ConfigProvider` decides what "a variable that names it" means; the stop follows that
  provider and no other. A provider that answers by prefix or case-folds names will stop on what it answers.
- A program that changes `process.env` while running and then makes a new provider is not followed: the watcher keeps
  the provider of the start.
- How 1997's per-key variables are named in the stop's message (the setting's variable or the key's) is 1997's to
  pick; this plan names the setting's variable, which is all the environment can set today.
- Whether making file-only a type mark trips any test helper not read here; the early typecheck shows it.

## Open questions

None.

Every choice above picks how the code does what the ticket, 1806's rulings, the glossary or 1997's ruling already
says. The type mark is a call for the lead's approval, not a question for the owner: no ruling covers it.

## Findings

1. **A per-key variable can equal another setting's variable** (for ticket 1997). Under 1997's ruling a table-valued
   setting `net.key` with an item `file` is set by `DEMO_NET_KEY_FILE`, and that is also the variable of a setting
   named `net.key-file`, since `configCase` turns `key-file` into `KEY_FILE`. `SettingGroup.make` refuses two settings
   that share a variable (`clashes` in `kalfa/config/src/SettingGroup.ts`), but cannot see this pair: a table's item
   names are open, so its per-key variables are not known when the group is made. Proof: `variable("demo",
   "net.key-file")` and the per-key form of `net.key` plus `file` are both `DEMO_NET_KEY_FILE` by
   `kalfa/config/src/internal/names.ts`. With this plan, if `net.key` is file-only, a good variable for `net.key-file`
   would stop the start once 1997 reads per-key variables. 1997's plan has to pick which reading wins, or refuse a
   group where a table setting's name plus `-` begins another setting's name. Out of this ticket.

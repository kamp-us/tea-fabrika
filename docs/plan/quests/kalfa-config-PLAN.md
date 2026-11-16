
Plancheck-Version: 3

# Plan: fabrika's settings engine becomes @kalfa/config, named by its app, so kalfa tooling reads .kalfa and KALFA_* (ticket 1076)

This is our tooling, in a new top-level folder, `kalfa/config/`, and in `next/`'s libfabrika, which
then depends on it. Today's version is not touched. It builds
[decision 0585](https://github.com/kamp-us/tea-fabrika/pull/1423), the first package in its build
order. Nothing a person sees in a window changes. Three pull requests: first generalize the engine
in place, then move it, then add `kalfa config get|set`.

```ts
// The whole idea, a sketch. One engine, one name per app; every other name comes from it.
import * as App from "@kalfa/config/App";

export const Fabrika = App.make({ name: "fabrika", list: "fabrika settings" });
export const Kalfa = App.make({ name: "kalfa", list: "kalfa config get" });

const port = Fabrika.Setting.make("instance.port", { schema: Port, default: 18787, scope: ["person"], ... });
port.env;          // "FABRIKA_INSTANCE_PORT"
Fabrika.repo;      // ".fabrika/fabrika.toml"   Kalfa.repo;    // ".kalfa/kalfa.toml"
Fabrika.person;    // "~/.fabrika/fabrika.toml" Kalfa.person;  // "~/.kalfa/kalfa.toml"
Fabrika.version;   // the "fabrika-version" Setting, read first; Kalfa.version is "kalfa-version"

const words = Kalfa.Setting.make("leak.words", { ... });   // a sketch: the ci plan declares it
words.env;         // "KALFA_LEAK_WORDS". A FABRIKA_LEAK_WORDS in the environment is never read.
```

## What changes, in one paragraph

Today every name the settings engine makes is fabrika's, written into the code: `FABRIKA_` in
`Setting.ts` and `Sources.ts`, `.fabrika/fabrika.toml` in `node/settings/Load.ts`, `$FABRIKA_HOME` in
`Snapshot.ts`, "fabrika settings lists every setting" in `Files.ts` and `Print.ts`, and
`Declarations.version` (`fabrika-version`) inside `Files.supported`. Slice 1 makes one value, an
`App`, the only source of those names, and fabrika's laws keep passing through a small binding in
libfabrika, `settings/Fabrika.ts`. Slice 2 moves the engine, with `git mv`, to `kalfa/config/` as
`@kalfa/config`, and changes no line of logic. Slice 3 adds the `./cli` export, `kalfa config
get|set`, and the `Kalfa` app other kalfa packages declare their settings with.

## Searched first

- `records.ts find` for "settings engine app name", "settings file toml environment precedence",
  "kalfa config package" and "leak words file path": 0086 (settings are declared once), 0069
  (choices are settings), the settings note, 0556, 0557 and the new 0585 are the records that
  govern this. No record names an app-scoped engine; 0585 is the first.
- [0086](../../../.decisions/0086-settings-are-declared-once.md) and
  [the settings note](../../../docs/direction/settings.md): S1 to S7, the order flag, env, repo,
  person, default, the `scope` list and the `Toml` service. All hold unchanged; only who the names
  belong to changes.
- [0585](https://github.com/kamp-us/tea-fabrika/pull/1423) (in review as this is written): the
  package, its file and env names, no `kalfa.config.ts`, the `./cli` export and the `kalfa config
  get|set` shape, `config` as a built-in of `kalfa`, and that tooling never takes a `FABRIKA_`
  name.
- [0113](../../../.decisions/0113-no-shell-or-python-scripts.md),
  [0231](../../../.decisions/0231-ledger-and-codehost-are-separate.md): nothing here is shell, and
  nothing calls a command-line tool.
- [0032](../../../.decisions/0032-libraries-take-effects-file-layout.md): a library is a flat
  `src/` of PascalCase modules with `internal/`. `kalfa/config/src/` keeps the settings room's
  layout as it is.
- [0537](../../../.decisions/0537-infra-holds-our-own-small-services.md), read through 0556: a
  `kalfa/` package keeps `next/`'s standards, so every lint override that lists `next/**` lists
  `kalfa/**` too.
- [0538](../../../.decisions/0538-kampus-vitest-holds-the-test-primitives.md) and 0557: the moved
  tests keep their `@effect/vitest` and `@kampus/vitest` imports. The move to `@kalfa/vitest` is its
  own plan, last in 0585's order.
- [0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md): every new law runs on
  an in-memory `FileSystem`, so none is `.integration.`.
- The code, at commit `9201aeb02`: the 30 files in `next/packages/libfabrika/src/settings/`, the
  loader and command in `next/packages/libfabrika/src/node/settings/`, the 30 files outside the
  folder that import a settings module (`rg -l` for the module paths), `layer-rules.json`'s
  `next-settings` room, and `next/apps/fabrika/cli.ts`, which builds the `fabrika` command with
  `effect/cli`.
- Installed versions in `pnpm-lock.yaml`: `effect@4.1.3` (its `effect/cli` `Command` and
  `FileSystem.layerNoop` exist in `node_modules/effect/dist`), `toml-eslint-parser` from the
  catalog, `@decimalturn/toml-patch@3.3.2`. No local patch touches them.

## How others do it

- **Effect's `ConfigProvider`** is the reader today and stays the reader. Its own answer to a prefix
  is `ConfigProvider.nested("fabrika")` with `constantCase`, which `Sources.env` already uses; the
  app's name becomes the argument to `nested`. Read in `Sources.ts` and Effect 4.1.3's types.
- **c12 (unjs)** takes the tool's `name` at the load, `loadConfig({ name: "kalfa" })`, and derives
  each file name from it. **cosmiconfig** does the same with its `moduleName`, `cosmiconfig("kalfa")`,
  which looks for `.kalfarc`, `kalfa.config.js` and a `package.json` field. We take their idea, one
  name makes every file name, and leave out their search: our two files are fixed by 0086. From
  their docs as I know them; not fetched in this session.
- **`git config get|set` and `npm config get|set`** are the known shape for a settings command:
  `get` prints one value, `set` writes one key into one file, chosen by a flag (`--global`,
  `--location`). `kalfa config set --file person|repo` follows them with our two scopes. From their
  docs as I know them; not fetched in this session.
- **Elm and OTP** have no answer here: settings are read at the edge before any machine starts (S6),
  so no tea machine or process is involved.

## The shape

### The app

```ts
// kalfa/config/src/App.ts, a sketch. Moves from next/packages/libfabrika/src/settings/App.ts in slice 2.
import { Schema } from "effect";

/** An app's name: one lowercase word, so its folder, file, env prefix and home variable are one word too. */
export const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]*$/));

export interface App {
  readonly name: string;      // "fabrika"
  readonly list: string;      // "fabrika settings": the command a message sends a person to
  readonly prefix: string;    // "FABRIKA"
  readonly home: string;      // "FABRIKA_HOME": where the person's folder is when set
  readonly repo: string;      // ".fabrika/fabrika.toml"
  readonly person: string;    // "~/.fabrika/fabrika.toml", the name a person reads
  readonly version: Setting.Setting<string, readonly ["repo"]>; // "fabrika-version", read first
  readonly Setting: { readonly make: typeof make; readonly group: typeof group };  // bound to this app
  readonly Sources: { readonly env: (record: Readonly<Record<string, string>>) => Source };
}

export const make = (options: { readonly name: string; readonly list: string }): App => ...
```

- `make` refuses a name that is not one lowercase word, as `Setting.group` refuses a bad path
  today: it throws at module load, so a bad app never runs.
- Every `Setting` carries its `app`, as it carries `env` today, and `Setting.group` refuses
  declarations of two apps ("x.y and z.w belong to two apps"). So a group's app is known, and
  `Files.validate`, `Files.supported`, `Snapshot`, `Reference`, `Print` and `Load` read the names
  from `group.app`, never from a constant.
- `version` is built by `make`, with the doc and default `Declarations.version` has today, at
  `<name>-version`. `Declarations.version` becomes `Fabrika.version`, so its laws still read it.

### What moves, and what stays

| Module | Slice 2 puts it in | Why |
|---|---|---|
| `App` (new in slice 1), `Setting`, `Sources`, `Toml`, `TomlParser`, `internal/edit`, `Codec`, `Files`, `JsonSchema`, `Reference`, `Print`, `Snapshot` | `kalfa/config/src/` | the engine, as 0585 and the ticket list it |
| `Load` (from `node/settings/Load.ts`, made generic in slice 1) | `kalfa/config/src/Load.ts` | it is what reads `.<app>/<app>.toml` and the person's file, so the app's scopes are its job. It uses Effect's `FileSystem` service, not Node, so it needs no `node/` folder. My call, 85% |
| `Fabrika` (new), `Declarations`, `Start`, `Starts`, `StartsTest`, `RecordedStart`, and `node/settings/Load.ts` as a ten-line fabrika binding of the generic load, and `node/settings/Command.ts` (`fabrika settings`) | stay in libfabrika | fabrika's own settings and start records, as the brief says |

```ts
// next/packages/libfabrika/src/settings/Fabrika.ts, a sketch: fabrika's binding, the one place its name is.
import * as App from "@kalfa/config/App";   // "./App.ts" in slice 1

export const Fabrika = App.make({ name: "fabrika", list: "fabrika settings" });
export const Setting = { ...App.SettingModule, ...Fabrika.Setting };   // make and group bound to fabrika
export const Sources = { ...App.SourcesModule, ...Fabrika.Sources };   // env bound to fabrika
```

The exact export form of the binding is the builder's to pick; the laws pin what it does. The
rule it must keep: a fabrika law written against `Setting.make` and `Sources.env` today reads the
same names after it, with only its import line changed.

### The command, slice 3

```ts
// kalfa/config/src/Cli.ts, a sketch: the ./cli export.
import { Argument, Command, Flag } from "effect/cli";

export const make = <A>(options: { readonly group: Setting.Group<A>; readonly version: string }) =>
  Command.make("config").pipe(
    Command.withSubcommands([
      Command.make("get", { key: Argument.string("key") }, ...),         // one value and its origin
      Command.make("set", {
        key: Argument.string("key"),
        value: Argument.string("value"),
        file: Flag.choice("file", ["person", "repo"]),
      }, ...),                                                          // one checked write
    ]),
  );
```

- `get` loads once, as `fabrika settings` does, and prints the one row `Reference.rows` gives for
  the key: value, origin, default. An unknown key fails as `unknown` with today's near-miss guess.
- `set` checks before it writes: the key is declared, the file is in its scope, the value passes its
  schema. Then it writes through `Toml.set`, a text splice that keeps every other line, and checks
  the new file whole with `Files.validate`. On any refusal the file is not written.
- The group comes in as an argument. Which declarations `kalfa config` shows (every installed kalfa
  package's) is for the plan that carries `@kalfa/cli`, which makes `config` a built-in.
- `@kalfa/config` also exports `Kalfa`, the app every kalfa package declares with. Nothing declares
  a kalfa setting in this plan; the first users are below.

### The package

```jsonc
// kalfa/config/package.json, a sketch
{
  "name": "@kalfa/config",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*.ts", "./internal/*": null, "./cli": "./src/Cli.ts" },
  "dependencies": { "effect": "catalog:", "toml-eslint-parser": "catalog:", "@decimalturn/toml-patch": "3.3.2" }
}
```

The `"kalfa": { "cli": "./cli" }` field is left out: `config` is a built-in of `kalfa`, never found
by discovery (0585). `@kampus/libfabrika` gains `"@kalfa/config": "workspace:*"` and drops the two
TOML packages it no longer imports.

## One value traced: `leak.words`, a kalfa setting, beside fabrika's files

A sketch of the ci plan's first setting, run on slice 3's engine, in a repo that holds both apps'
files.

1. The ci plan declares `Kalfa.Setting.make("leak.words", { scope: ["person"], default: "~/.kalfa/leak-words", ... })`.
   Its `env` is `KALFA_LEAK_WORDS`, its flag `--leak.words`, its app `kalfa`.
2. The environment holds `FABRIKA_LEAK_WORDS=/a` and `KALFA_LEAK_WORDS=/b`. `Kalfa.Sources.env`
   nests the provider under `kalfa`, so it reads `/b` and never asks for `FABRIKA_LEAK_WORDS`.
3. `.fabrika/fabrika.toml` sets `[leak] words = "/c"`. `Load.load(group, ...)` reads `group.app.repo`,
   `.kalfa/kalfa.toml`, which does not exist, so it counts as empty. `.fabrika/` is never opened.
4. `Files.supported` reads `kalfa-version` in `.kalfa/kalfa.toml`; there is none, so it goes on.
5. `Sources.resolve` finds no flag, then the env: the value is `/b`, origin `{ _tag: "env", name: "KALFA_LEAK_WORDS" }`.
6. `Snapshot.make` records `leak.words` with that origin. Its origin check accepts `$KALFA_HOME/...`
   and would refuse a `$FABRIKA_HOME/...` file origin for this group.
7. `kalfa config get leak.words` prints `leak.words = "/b"  (KALFA_LEAK_WORDS)` with the default and
   doc. With `KALFA_LEAK_WORDS` unset, it prints the default with origin `default`, never `/a` or `/c`.

## What fact is lost today

Nothing new: every value already records its origin (S4). One fact was weighed: a snapshot does not
say which app it belongs to. Today a snapshot is fabrika's by where it is stored, the start record,
so nothing is lost. The first plan that records a kalfa snapshot (a ship run, say) adds the app to
what it records, before its first entry is written.

## Laws

Fabrika's settings laws, counted at `9201aeb02` by their `it(` and `it.*(` lines: 75 in the engine's
test files, plus 12 in fabrika's own settings files. The tests step recounts them on the branch and
names any it finds that this count missed.

- Engine laws that stay in libfabrika, because they reach `Declarations` or a fabrika name:
  `Codec.test.ts` (5: L1 to L4 of T753), `Files.test.ts` (9: L7, T753 L3, L8, L10's four messages,
  T730 L2), `JsonSchema.test.ts` (6: L2, T753 L7, L3 and its vector, L4), `Print.test.ts` (1: L5),
  `Reference.test.ts` (4: T753 L7 to L8, L5, L6, L3), `Setting.test.ts` (11: T843, L1 to L4, T753
  L1), `Snapshot.test.ts` (6: T753 L4 to L6, the hash law, L14 and T753 L9 [secrets]),
  `Sources.test.ts` (3: L5, L6), `TomlEdit.test.ts` (16: T877), `node/settings/Command.test.ts`
  (3: T753 L8, L7, L8 [secrets]) and `node/settings/Load.integration.test.ts` (7: L11, T753 L8,
  T730, three properties). 71 laws.
- Engine laws that move with their module in slice 2, because they reach neither: `Toml.types.test.ts`
  (1: L9 type) and `TomlParser.test.ts` (3: the property and L9's two). 4 laws.
- Fabrika's own settings laws, untouched: `DesktopBrain.test.ts` (4), `DesktopLink.test.ts` (3),
  `Mail.test.ts` (2), `Start.test.ts` (3). 12 laws.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| F1, fabrika's 75 engine laws pass on the generalized engine, and after the move, with their bodies unchanged: on every one of the 13 files named above, the diff against main changes only import lines. Slices 1 and 2 | test | scenario: the 75 existing laws on their own generators, run unchanged | (a) build `prefix` from the name without upper-casing it: Setting L1 and Command L8 red; (b) leave `Load` reading `.fabrika/fabrika.toml` but name the person file from another app: Load L11 red | the 13 files named above, in next/packages/libfabrika/src/settings/ and next/packages/libfabrika/src/node/settings/, and kalfa/config/src/TomlParser.test.ts and kalfa/config/src/Toml.types.test.ts after slice 2 |
| F2, fabrika's own 12 settings laws stay green with no line changed but imports | test | scenario: the 12 existing laws | move `version` off `fabrika-version`: Start and DesktopBrain red | next/packages/libfabrika/src/settings/DesktopBrain.test.ts, DesktopLink.test.ts, Mail.test.ts, Start.test.ts |
| K1, a second app reads only its own: for generated app names `a` and `b` and a generated group of `a`, a value set only in `.b/b.toml`, `~/.b/b.toml`, `$B_HOME/b.toml` or a `B_*` variable leaves `a`'s value at its default with origin `default`; the same value in `a`'s own file or variable is read, with an origin that names it. The case `a = kalfa, b = fabrika` is always among the runs. 100 runs | test | fc.record: two distinct app names, a group of 1 to 4 generated declarations, which source holds each value | (a) `Load` keeps `.fabrika/fabrika.toml` as its repo path: red; (b) `Sources.env` keeps `nested("fabrika")`: red; (c) `Command`'s home falls back to `FABRIKA_HOME`: red | next/packages/libfabrika/src/settings/App.test.ts in slice 1, moved to kalfa/config/src/App.test.ts in slice 2 |
| K2, every name comes from the app: for a generated app name and generated paths, `env` is `<APP>_<SECTION>_<KEY>`, the flag is `--section.key`, the repo file `.<app>/<app>.toml`, the person file `~/.<app>/<app>.toml` or `$<APP>_HOME/<app>.toml`, the version key `<app>-version`, and every message `Files`, `Print` and `Sources` make names the app's own `list` command and no other app's. 100 runs | test | fc.record: an app name, 1 to 4 dotted paths, a refused value | (a) keep "fabrika settings lists every setting" in `Files.refused`: red for any other app; (b) keep `$FABRIKA_HOME` in the snapshot's origin check: red | next/packages/libfabrika/src/settings/App.test.ts, then kalfa/config/src/App.test.ts |
| K3, an app name is one lowercase word, and a group holds one app: `App.make` throws for a generated name with a capital, a digit first, `_`, `-`, `.` or nothing, and `Setting.group` throws for declarations of two apps, naming both paths. 100 runs | test | fc.string: names over the letters a-z, A-Z, 0-9, `_`, `-`, `.` | (a) accept `_` in a name: `kal_fa` and `kal` with a section `fa_...` share an env name, red; (b) drop the two-app check in `group`: red | next/packages/libfabrika/src/settings/App.test.ts, then kalfa/config/src/App.test.ts |
| K4, each app checks its own minimum version: for a generated app, a repo file whose `<app>-version` is newer than the running version stops the load as `version`, naming the app; another app's `<other>-version` in the same file is an unknown key. 100 runs | test | fc.record: app name, running and wanted versions as three integers | `Files.supported` keeps reading `fabrika-version`: red for any other app | next/packages/libfabrika/src/settings/App.test.ts, then kalfa/config/src/App.test.ts |
| K5 [secrets], another app's values never reach an output: for app `a`, a generated secret in a `B_*` variable, in `.b/b.toml`, or refused by `a`'s schema never appears in `a`'s values, errors, snapshot or printed report, in any spelling the [secrets] helpers make. 100 runs | test | fc.record: two app names, a secret string, where it is put | print the whole env record in the `read` error: red | next/packages/libfabrika/src/settings/App.test.ts, then kalfa/config/src/App.test.ts |
| M1, slice 2 is only a move: `movecheck <base> <head> --moves` on the slice's moves table finds no fault outside the files this plan names for slice 2 | test | scenario: slice 2's moves table, `{"moves": [{"from": "next/packages/libfabrika/src/settings/Setting.ts", "to": "kalfa/config/src/Setting.ts"}, ...]}` | change one line of logic in a moved file: movecheck exit 1 | .agents/skills/lead/scripts/movecheck.ts, run by the lead and the review on slice 2 |
| M2, the engine depends on no product: no file under `kalfa/config/` imports `@kampus/*` or a path into `next/` | lint | lint | import `Declarations` into `kalfa/config/src/Files.ts`: lint red | .oxlintrc.json, a `no-restricted-imports` override for `kalfa/config/**` |
| C1, `get` answers what the load holds: for a generated group, sources and key, `config get <key>` prints exactly the row `Reference.rows` gives for that key from the same load, and an unknown key fails as `unknown` with the near-miss guess `Files` makes. 100 runs | test | fc.record: a group of 1 to 4 declarations, values per source, a key that is declared, near one, or neither | (a) print the default when an env value is set: red; (b) print a row for an undeclared key: red | kalfa/config/src/Cli.test.ts, on `FileSystem.layerNoop` |
| C2, `set` writes only a checked value, and only its one key: for a generated group, file text, key, value and `--file`, `set` writes when the key is declared, in scope for that file and its value passes the schema; then `get` answers the value with that file's origin and every other line of the file is byte for byte the same. On any refusal (`unknown`, `scope`, `invalid`) the file is not written. 100 runs | test | fc.record: a group, a generated TOML text for each file, a key, a value valid or not, person or repo | (a) write before the check: a refused set leaves a changed file, red; (b) rewrite the whole file from its parsed value: a comment is lost, red | kalfa/config/src/Cli.test.ts, on `FileSystem.layerNoop` |
| C3, `set` writes only its own app's file: for generated app names, `set --file repo` writes `.<app>/<app>.toml` and `--file person` writes `$<APP>_HOME/<app>.toml` or `~/.<app>/<app>.toml`; no other path is opened for writing. 100 runs | test | fc.record: an app name, person or repo, `<APP>_HOME` set or not | write the repo file at `.fabrika/fabrika.toml`: red for `kalfa` | kalfa/config/src/Cli.test.ts, on `FileSystem.layerNoop` |
| C4 [secrets], the command prints no unrelated value: a generated secret in an undeclared variable of the app's own prefix, or in a refused `set` value of a declaration whose schema is `Redacted`, never reaches stdout, stderr or the formatted failure. 100 runs | test | fc.record: a secret string, which place holds it | print the env record on an `unknown` key: red | kalfa/config/src/Cli.test.ts |
| C5, the command's shape: `Cli.make` returns an `effect/cli` `Command` named `config` with exactly the subcommands `get` and `set` | type | type | add a third subcommand or name it `settings`: tsc red | kalfa/config/src/Cli.types.test.ts |

Each law is a test except M2 and C5. M1 is the lead's tool, not a test file; it runs in the review.
No law needs the real machine: K1 to K5 run on in-memory sources and a `FileSystem.layerNoop` with
its file contents given, and C1 to C4 on the same. `Load.integration.test.ts` keeps its real files
and stays on the schedule (0536).

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/settings/App.ts | build | 70 | slice 1, new: `App`, `Name`, `make`, the bound `Setting` and `Sources`, the app's `version` |
| next/packages/libfabrika/src/settings/Fabrika.ts | build | 15 | slice 1, new: fabrika's app and its binding |
| next/packages/libfabrika/src/settings/Setting.ts | build | 25 | slice 1: a `Setting` carries its `app`; `env` from `app.prefix`; `group` refuses two apps |
| next/packages/libfabrika/src/settings/Sources.ts | build | 15 | slice 1: `env` takes the app; origin names from `app.prefix` |
| next/packages/libfabrika/src/settings/Files.ts | build | 30 | slice 1: `supported` reads `group.app.version`; messages name `group.app.list`; no import of `Declarations` |
| next/packages/libfabrika/src/settings/Snapshot.ts | build | 8 | slice 1: the file origin check reads `declaration.app.home` |
| next/packages/libfabrika/src/settings/Reference.ts | build | 5 | slice 1: warnings name the app |
| next/packages/libfabrika/src/settings/Print.ts | build | 8 | slice 1: `--all` and version lines name `app.list` and `app.name` |
| next/packages/libfabrika/src/settings/Declarations.ts | build | 6 | slice 1: declares with `Fabrika.Setting`; `version` is `Fabrika.version` |
| next/packages/libfabrika/src/node/settings/Load.ts | build | 40 | slice 1: the generic `load(group, options)`, reading `group.app.repo` and the person file; in slice 2 it moves to `kalfa/config/src/Load.ts` and this file becomes fabrika's ten-line binding |
| next/packages/libfabrika/src/node/settings/Command.ts | build | 12 | slice 1: home from `Fabrika.home` and `Fabrika.person`, never a written name |
| next/packages/libfabrika/src/settings/App.test.ts | tests | tests | slice 1: K1 to K5; slice 2 moves it with `git mv` |
| next/packages/libfabrika/src/settings/Codec.test.ts | tests | tests | F1: import lines only, slices 1 and 2 |
| next/packages/libfabrika/src/settings/Files.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/settings/JsonSchema.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/settings/Print.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/settings/Reference.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/settings/Setting.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/settings/Snapshot.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/settings/Sources.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/settings/TomlEdit.test.ts | tests | tests | F1: import lines only, slice 2 |
| next/packages/libfabrika/src/settings/StartsTest.ts | tests | tests | import lines only, slice 2 |
| next/packages/libfabrika/src/settings/DesktopBrain.test.ts | tests | tests | F2: import lines only, if any |
| next/packages/libfabrika/src/settings/DesktopLink.test.ts | tests | tests | F2: import lines only, if any |
| next/packages/libfabrika/src/settings/Mail.test.ts | tests | tests | F2: import lines only, if any |
| next/packages/libfabrika/src/settings/Start.test.ts | tests | tests | F2: import lines only, if any |
| next/packages/libfabrika/src/node/settings/Command.test.ts | tests | tests | F1: import lines only |
| next/packages/libfabrika/src/node/settings/Load.integration.test.ts | tests | tests | F1: import lines only; stays on the schedule |
| next/packages/libfabrika/src/node/settings/RepositoryOpenTest.ts | tests | tests | import lines only, slice 2 |
| kalfa/config/src/App.ts | build | moved | slice 2: `git mv` from libfabrika, specifiers only |
| kalfa/config/src/Setting.ts | build | moved | slice 2: `git mv`, as are `Sources.ts`, `Toml.ts`, `TomlParser.ts`, `internal/edit.ts`, `Codec.ts`, `Files.ts`, `JsonSchema.ts`, `Reference.ts`, `Print.ts`, `Snapshot.ts` and `Load.ts`, each listed in the moves table; the `Toml` service key becomes `@kalfa/config/Toml` |
| kalfa/config/src/App.test.ts | tests | tests | slice 2: `git mv` of K1 to K5 |
| kalfa/config/src/TomlParser.test.ts | tests | tests | slice 2: `git mv`, F1 |
| kalfa/config/src/Toml.types.test.ts | tests | tests | slice 2: `git mv`, F1 |
| kalfa/config/package.json | build | 25 | slice 2, new |
| kalfa/config/tsconfig.json | tests | tests | slice 2, new: `next/`'s type check settings; `next/`'s own tsconfig files are exam paths, so this one is the tests step's too |
| kalfa/config/README.md | build | docs | slice 2, new: what the package is, the app, the four sources, the two files |
| next/packages/libfabrika/package.json | build | 4 | slice 2: depends on `@kalfa/config`; drops the TOML packages and the moved modules from `exports` |
| next/apps/fabrika/settings-generate.ts | build | 3 | slice 2: specifiers only |
| next/apps/fabrika/cli.ts | build | 2 | slice 2: specifiers only, if it names a moved module |
| next/packages/libfabrika/src/index.ts | build | 3 | slice 2: specifiers only |
| next/packages/libfabrika/src/cloudflare/SettingsInput.ts | build | 2 | slice 2: specifiers only; every other importer of a moved module (about 25 files, listed by `rg` on the branch) changes the same way and is named in the moves table's follow list |
| package.json | tests | tests | slice 2: no change expected; the root's scripts already reach every workspace package. Named here because the root file is an exam path |
| pnpm-workspace.yaml | tests | tests | slice 2: `kalfa/*`, unless pull request 1279 already added it |
| pnpm-lock.yaml | tests | tests | slice 2: the new package and libfabrika's new dependency |
| layer-rules.json | tests | tests | slice 2: the `next-settings` room keeps the files that stay; a `kalfa-config` row if the layer check asks for one |
| boundary-rules.json | tests | tests | slice 2: `@kalfa/config` may be imported by libfabrika and the app, and imports no `@kampus/*`, if the boundary check reads package edges |
| .oxlintrc.json | tests | tests | slice 2: every override for `next/**` also covers `kalfa/**`; M2's `no-restricted-imports` for `kalfa/config/**` |
| vitest.config.ts | tests | tests | slice 2: `kalfa/*/src/**/*.test.ts` joins the `next/` project globs, and `kalfa/**/*.integration.test.ts` the integration ones |
| .github/ci/changes.mjs | tests | tests | slice 2: `kalfa/` joins the trees whose change runs tests |
| exam-paths.json | tests | tests | slice 2: `kalfa/**/*.test.ts`, `kalfa/**/*Test.ts`, `kalfa/**/*.test-support.ts` and `kalfa/**/tsconfig.json`, as `next/` has |
| kalfa/config/src/Cli.ts | build | 140 | slice 3, new: `make`, `get` and `set` |
| kalfa/config/src/Kalfa.ts | build | 10 | slice 3, new: the `Kalfa` app other kalfa packages declare with |
| kalfa/config/src/Cli.test.ts | tests | tests | slice 3: C1 to C4 |
| kalfa/config/src/Cli.types.test.ts | tests | tests | slice 3: C5 |
| .glossary/TERMS.md | build | docs | slice 1: a row `app (settings)`: the one name a settings engine derives its folder, file, env prefix and home variable from; slice 2: the `setting` and `scope (setting)` rows name `@kalfa/config` |
| docs/direction/settings.md | build | docs | slice 2: one line saying the engine lives in `@kalfa/config` and is named by its app |

## Calls taken

Each picks how the code does what 0585 or 0086 already says, so each is mine to decide.

- **Generalize in place first, then move.** The engine cannot be moved as it is: `Files.ts`
  imports `Declarations.ts`, which stays in libfabrika, so a straight move would make the package
  import the product. Slice 1 cuts that tie and every written fabrika name while the files stay
  put, under fabrika's own laws. Slice 2 is then only a move, which `movecheck` can prove (M1). A
  move and a rewrite in one diff can be proved by neither. 90% sure.
- **The app is a value, and a Setting carries it.** `env` is already a field of each Setting, read
  by the conflict check, the snapshot's origin check and the reference. So the app that makes the
  name rides with it, the way the name does, and a group of two apps is refused at declaration, the
  way two paths with one env name are today. The other branch, the c12 way, passes the name only at
  the load; it would make `env` a function of the load, change those three readers and their laws,
  and let a declaration be read under the wrong app. 80% sure.
- **Fabrika's laws stay in libfabrika.** 71 of the 75 reach `Declarations` or a fabrika name, so
  they are fabrika's laws about its settings on the engine, and the package may not import the
  product (M2). Only the 4 TOML laws, which reach neither, move with their module. The engine gets
  its own app-generic laws, K1 to K5, written in slice 1, before the move. 85% sure.
- **A fabrika binding file, `Fabrika.ts`.** It lets a fabrika law that calls `Setting.make` keep its
  body, as the ticket asks, and it is the one place fabrika's name is written. 80% sure: the doubt is
  the export form, which the builder picks.
- **`Load` moves; `Command` stays.** Reading `.<app>/<app>.toml` and the person's file is the
  engine's job, and `kalfa config` needs it too. `fabrika settings` is fabrika's command and stays,
  built on the generic load. 85% sure.
- **The app name is one lowercase word.** Then `.<app>`, `<app>.toml`, `<APP>_` and `<APP>_HOME`
  are each one word, and no name of two apps can share a prefix the way `kal_fa` and `kal` would.
  Both names we have, `fabrika` and `kalfa`, fit. 90% sure.
- **`kalfa config set` takes `--file person|repo`,** our two scopes, as git takes `--global` and npm
  takes `--location`. A setting whose scope holds one file needs no flag; the command uses that
  file. 80% sure.
- **Is this a setting?** No, for each new choice: the app's name and its files are its identity and
  its home, both in S1's list of things that are never settings
  ([0069](../../../.decisions/0069-choices-are-settings.md)); the `list` words are what the app is
  called; the subcommand names are 0585's.
- **A browser is always a client.** Every module but `Load` and `Cli` is pure: it takes text and
  records and needs no Node, no file and no socket. `Load` reaches files only through Effect's
  `FileSystem` service, so a browser could hand it a layer of its own. A person's settings command
  is a terminal program by its nature.
- **Typed services only.** Nothing calls a command-line tool
  ([0231](../../../.decisions/0231-ledger-and-codehost-are-separate.md)).

## Who uses it first

- **fabrika,** at once: its 14 declarations and its start load run on `@kalfa/config` from slice 2.
- **The ci plan:** the leak-words move. `FABRIKA_LEAK_WORDS` and `~/.fabrika/leak-words` become a
  kalfa setting, `KALFA_LEAK_WORDS`, with `~/.kalfa/leak-words` as its default. That move is the ci
  plan's, not this one's: leakgrep moves into `@kalfa/ci/checks` there, and every test that sets the
  old name changes with it. This plan reads no word list and names that file only by its path.
- **The records plan:** the `[records]` settings in `.kalfa/kalfa.toml`, one repo-scoped path per
  record folder, as `records.decisions` (`KALFA_RECORDS_DECISIONS`). The records plan declares them
  in `@kalfa/records` and plans the move under `.kalfa/`; this plan only makes the engine they
  declare with.
- **`@kalfa/cli`:** `config` as a built-in, through this plan's `./cli`.

## `@kalfa/cli`: its own small plan, right after this one

Lean: `@kalfa/cli` gets its own small plan, which lands after this plan's slice 3 and before the
ci plan. 75% sure.

- **Why.** Its job, finding `./cli` trees from the project's own `package.json` dependencies, is its
  own domain with its own three laws (a dependency without the `kalfa.cli` field adds nothing, a
  package that is not a dependency is never loaded, the built-ins are always there). None of them
  needs anything from settings, and none of this plan's laws needs a `kalfa` binary: C1 to C5 drive
  the `config` command directly.
- **What it costs.** Until that plan lands, `kalfa config get` cannot be typed in a terminal; it
  exists only as a tested `Command`. Nothing calls it before the ci plan, which is after the cli
  plan, so no one waits.
- **The doubt.** `config` is a built-in, so `kalfa` with only `config` is a small first slice, and
  landing both in one plan would make the first `kalfa` command real one plan sooner. What would
  settle it: if the cli plan's discovery laws turn out to need a real package as their fixture,
  `@kalfa/config` is that package, and the cli plan stays separate either way.
- **One question it leaves open,** for the cli plan: which declarations `kalfa config` shows, which
  needs each package's settings group found beside its command tree.

## Clashes

- **Reflect ban slice 5,
  [pull request 1411](https://github.com/kamp-us/tea-fabrika/pull/1411),** is editing
  `TomlParser.ts`, `internal/edit.ts`, `TomlEdit.test.ts`, `TomlParser.test.ts` and `.oxlintrc.json`
  now. Slice 1 touches none of the four settings files. **Slice 2 waits until 1411 has merged,** since
  it moves all four, and builds its `.oxlintrc.json` override on 1411's version.
- **Mailbox rename, ticket 1072,** renames `mail.chunk` and `mail.unread` to `mailbox.chunk` and
  `mailbox.capacity` in `Declarations.ts`, `Mail.test.ts`, `JsonSchema.test.ts` and `Start.test.ts`,
  and regenerates `person.json`, `repo.json` and the reference page. Slice 1 changes
  `Declarations.ts` and `JsonSchema.test.ts` in their import lines and `version` line only. **Neither
  waits:** the second to land rebases over a few lines. Slice 2 changes the generator's imports, not
  its output, so it does not clash with the regenerated files.
- **The Effect-check and anti-slop sweeps** (the Effect sweep plan,
  [pull request 1412](https://github.com/kamp-us/tea-fabrika/pull/1412), its slice E0,
  [pull request 1417](https://github.com/kamp-us/tea-fabrika/pull/1417), and the anti-slop install,
  [pull request 1373](https://github.com/kamp-us/tea-fabrika/pull/1373)): a path move reruns every
  check on each moved file, so **slice 2 also waits until each sweep is past
  `next/packages/libfabrika/src/settings/` and `node/settings/`.** Slice 2's `.oxlintrc.json` then
  gives `kalfa/**` every rule `next/**` has, so the moved files stay at the level they reached.
- **Pull request 1279** (the merge queue's plan) also adds `kalfa/*` to the workspace. Whichever
  lands first adds the line; the other rebases.
- **0585's sev0 timing:** all three slices build at the tail of the sev0 list, config first.

## Validation

- tests step, slice 1: `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/settings/App.test.ts` shows K1 to K5 red on main, and on the 12
  engine test files named under Laws shows F1 still green with only import lines changed.
- build step, slice 1: the same paths green, plus `next/packages/libfabrika/src/settings/` and
  `next/packages/libfabrika/src/node/settings/Command.test.ts`.
- The F1 diff check, run by the review on each of the 13 files:
  `git diff -M origin/main -- <file>` shows only lines that are part of an `import` statement.
- slice 2: the lead and the review run `movecheck` with the moves table (M1), and `pnpm lint` shows
  M2 red on its plant and green without it.
- slice 3: `kalfa/config/src/Cli.test.ts` red, then green.
- The lead runs the narrow paths of every test that reads a moved file (the lockfile change makes
  `--changed` the full suite) and one `pnpm typecheck`. `Load.integration.test.ts` runs in CI's
  scheduled full run.

## Size

1. Slice 1, generalize in place: about 235 product lines (`App.ts` 70, `Load.ts` 40, `Files.ts` 30,
   `Setting.ts` 25, `Fabrika.ts` 15, `Sources.ts` 15, `Command.ts` 12, the rest under 10 each), plus
   K1 to K5. It lands whole: fabrika runs on the app from this merge, and every later kalfa setting
   can be declared on it.
2. Slice 2, the move: about 40 product lines (the new `package.json` 25, specifier lines in about 30
   files, `libfabrika`'s `package.json`), plus about 2,200 moved lines with no change of logic, the
   wiring files the tests step owns and the README. It lands whole: the package exists and
   fabrika depends on it.
3. Slice 3, the command: about 150 product lines (`Cli.ts` 140, `Kalfa.ts` 10), plus C1 to C5. It
   lands whole: `kalfa config get|set` is a tested `Command` that `@kalfa/cli` can add.

About 5 agent hours across the steps, 70% sure. The doubt is slice 1's binding: keeping 71 laws'
bodies unchanged through `Fabrika.ts` may need a send-back if one law reaches a module-level name
the binding misses. Budget basis: build and review steps of a similar size on 2026-11-15
(`field/runs/2026-11-15-t1050-build1.json`, $2.67 list for a build), and the monitor plan's 6 steps
at $43 (`docs/plan/quests/watch-PLAN.md`): about $5 a step. Slice 1 is tests, build, review and one
likely send-back; slice 2 is tests, build, review; slice 3 is tests, build, review and one likely
send-back.

Estimate: 11 steps, $55

## Records

- `field/runs/` rows for each step, by the lead.
- Glossary: a new `app (settings)` row in slice 1; the `setting` and `scope (setting)` rows name the
  package in slice 2.
- No `.decisions/` file: 0585 holds the rulings this builds.

## What this cannot tell us

- Whether one lowercase word is enough for every app we will make. A tool with two words in its
  name would have to join them.
- Whether `kalfa config set` is a command people reach for, or whether they edit `.kalfa/kalfa.toml`
  by hand. 0086 already left the same question open for `fabrika settings`.
- How `kalfa config` finds every installed package's declarations. That is the cli plan's.
- Whether the binding pattern in `Fabrika.ts` reads well to an agent copying it for a third app. The
  second user, the ci plan, will show it.

## Open questions

None.

Each choice above applies 0585 or 0086. The one lean the owner may want to see, `@kalfa/cli` as its
own plan, was asked for in the brief and is answered in its own section.

## Findings

None.

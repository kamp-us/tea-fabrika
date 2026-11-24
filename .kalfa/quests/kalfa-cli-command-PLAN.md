Approved by the lead agent, builds issues 1751, 2076; body 3b47ec07c4e0
Plancheck-Version: 3

# Plan: the kalfa command (ticket 2076)

This is the kalfa packages, a new package `kalfa/cli`. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2076, the first build ticket of
[CLI's protocol](https://github.com/kamp-us/tea-fabrika/issues/1751), with
[the owner's answers on it](https://github.com/kamp-us/tea-fabrika/issues/1751#issuecomment-7083852422) (decision 0084).
Its blocker, https://github.com/kamp-us/tea-fabrika/issues/1917 (Diagnostics: declare a code and report through it), is
closed and built in `kalfa/diagnostics`. Words: `kalfa/cli/GLOSSARY.md`, `kalfa/diagnostics/GLOSSARY.md` and
`kalfa/telemetry/GLOSSARY.md` (for **Store**).

A repo lists packages in its root `package.json`. Each direct dependency whose manifest has a `kalfa.cli` field gives a
subcommand. `kalfa <root name> ...` loads them at run time, runs the one asked for with Node's platform and the
subcommand's own Layer, prints each diagnostic as one readable line on standard error as it is reported, and ends with
exit code 0, 1 or 2. A dependency with a `kalfa.spans` field names the store the run's spans go to. Three pull requests:
the shape a package exports (about 95 product lines), the command (about 290), then the store (about 115).

```ts
// The whole idea, a sketch. Nothing here was type-checked.
// A package's ./cli entry, found through "kalfa": { "cli": "./cli" } in its package.json:
import * as Subcommand from "@kalfa/cli/Subcommand"
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic"
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics"

export const KeyShape = Diagnostic.make("leak/key-shape", { explain: "A line has the shape of a private key." })

const check = Command.make("check", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("checked 2 files")                       // standard output, as it is
    yield* Diagnostics.report(KeyShape, {                       // standard error, one readable line, now
      severity: "error",
      message: "A line has the shape of a private key.",
      place: Diagnostic.Place.cases.repo.make({ path: "docs/setup.md", line: 12 }),
      hint: "Remove the key and rotate it.",
    })
  }))

export const subcommand: Subcommand.Subcommand<"leak"> =
  Subcommand.make(Command.make("leak").pipe(Command.withSubcommands([check])), {
    layer: Layer.empty,
    diagnostics: [KeyShape],
  })

// $ kalfa leak check
// stdout: checked 2 files
// stderr: docs/setup.md:12: error leak/key-shape: A line has the shape of a private key. Hint: Remove the key and rotate it.
// exit code 1
```

## Calls under 80%, read these first

Each picks how the code does what the protocol and the ticket already say. The plan takes each lean and goes on.

- **The readable line is `<place>: <severity> <code>: <message> Hint: <hint>` (75%).** The place comes first, as gcc,
  tsc and ESLint's unix format put it, so an editor's "file:line:" matcher finds it; the code sits beside the severity,
  as tsc's `error TS2322:`. A person reads it, so it is open question 1. Separable: only `line` in
  `kalfa/cli/src/internal/print.ts` and law K4 change.
- **A line never breaks (75%).** In the place text, the message and the hint, each control character (Unicode Cc), format
  character (Cf, such as a right-to-left override), lone surrogate (Cs), U+2028 and U+2029 is written as JSON writes it
  (`\n`, `\r`, `\t`, `\u001b`, `‮`), and a backslash as `\\`, so the escape can be undone and nothing on the
  line can rewrite a terminal. These are the classes Diagnostics already refuses in a flag's name. The cost: an emoji
  joined with U+200D (Cf) prints escaped. What settles it: the lead's read; `--format json` (ticket 2079) is the exact
  form for machines.
- **A failure prints `kalfa: <message>` (75%),** one line, the program's name first as POSIX tools do, and no severity
  word. Part of open question 1.
- **The repo's root is the current folder (70%).** `kalfa` reads `./package.json`, as `@kalfa/config` takes the current
  folder for `repo` by default, and as Records' `bin.ts` runs in the folder it is called from. Walking up to the folder
  that holds `.git` is what git does, but then a subcommand that reads the current folder sees another one than
  `kalfa` read. Open question 2. Separable: only `root` in `kalfa/cli/src/internal/manifest.ts`.
- **A listed dependency that is not installed stops the start, unless it is optional (75%).** `kalfa` cannot know
  whether it has a `kalfa.cli` field, so it says so and asks for an install (exit code 2). A missing
  `optionalDependencies` entry is skipped, since a package manager may leave one out on purpose. What settles it: the
  lead's read.
- **A store module with no `layer` export is a warning, like one that fails to load (75%).** The ticket makes a store
  that fails to load a warning and keeps the run going (decision 0079: the command still runs). A module that loads but
  exports no Layer is the same broken store. Two stores and an entry with no `default` condition still stop the start,
  as the ticket says.
- **`bin.ts` waits for standard output to drain before it exits (75%).** `NodeRuntime.runMain` calls `process.exit(code)`
  for every code but 0 (`@effect/platform-node-shared`'s `NodeRuntime.ts`, line 67), and on macOS a pipe is written
  asynchronously, so a long output piped to another program could be cut at exit code 1. The teardown writes an empty
  string to standard output and exits in its callback. No law can turn red for it on Linux CI, where pipes are
  synchronous ("What this cannot tell us").
- **An interruption (Ctrl-C) ends with exit code 2 and `kalfa: kalfa was stopped.` (75%).** The glossary's exit codes
  are 0, 1 and 2 only, and a stopped run could not finish. Node's usual 130 is left out.
- **The one-file try will answer no (70%).** Two reasons are known before the try: a subcommand is found in the repo's
  `node_modules`, so with no install there is no `@kalfa/ci` to run `kalfa ci paths`; and a bundle carries its own copy
  of `effect` beside the one each subcommand imports. The build step of slice 2 runs the try (under "Validation") and
  writes what it found, yes or no.

## Slices

1. **The shape a package exports**, branch `fabrikalfa/kalfa-cli`. The package itself, `@kalfa/cli/Subcommand` with
   `make` and `isSubcommand`, its type laws, the rule rows that rank it, and the `kalfa.cli` field taken off Records and
   Code quality. It lands whole: a package can write and type-check its `subcommand` export, and Records' refit can
   start. It closes the ticket's first and fourth criteria and the import and naming criteria.
2. **The command**, a branch the lead names, made from main after slice 1 lands. Finding, loading, running, printing,
   the exit code, the spans, `bin.ts` and its one real-process test, and the one-file try. It closes every other
   criterion but the store's.
3. **The store**, a branch the lead names, after slice 2. The `kalfa.spans` field, its resolve and load, the Layer that
   wraps the whole run, and every way a store can fail without changing the run.

Shared pieces and who owns them: `Subcommand.ts` is slice 1's; slice 2 reads `isSubcommand` and changes nothing in it.
`internal/failure.ts`, `internal/print.ts`, `internal/find.ts` and `internal/run.ts` are slice 2's; slice 3 adds a case
to each and owns those added lines. `kalfa/cli/package.json`, the rule rows and the README are written in slice 1 and
grown in slices 2 and 3 by the same owners (tests for the manifest and the rows, build for the README).

**What `kalfa config` gets from this.** Nothing it must wait for. The config plan on branch
`fabrikalfa/kalfa-config-1846` (`.kalfa/quests/kalfa-config-command-PLAN.md`, slice 2) makes `config(app, groups,
options)` a plain `effect/cli` command whose needs are `FileSystem | Path`, both inside Node's platform, so ticket 2081
mounts it beside the found subcommands in `root` (`kalfa/cli/src/internal/run.ts`), which takes a list of commands. Its
`SettingsError` is a failure (exit code 2) until ticket 2077 and ticket 2000 make it a carried diagnostic (exit code 1).
Nothing in this plan changes Configuration (Findings, 2).

## How others do it

Read, unless marked "from memory".

- **Elm and Erlang/OTP.** `elm make` prints each problem with its place, a title and what to do next, and exits
  non-zero on any error (from memory). Erlang's rebar3 finds plugins from a list in `rebar.config`, never on PATH, and
  an escript ends with `halt(N)` (from memory). Taken: the hint as its own part of a line, a list in a manifest as the
  only way in, and one place that picks the exit code.
- **git's built-in commands (from memory).** One `git` binary runs its built-ins in one process; `git-<name>` on PATH is
  the outside way. The protocol took the first and refused the second (https://github.com/kamp-us/tea-fabrika/issues/1751).
- **oclif and Angular CLI (from memory, not fetched).** oclif reads the plugins named in the root `package.json`'s
  `oclif.plugins`; Angular CLI finds a builder through a `builders` field in the package's own `package.json`. Taken:
  a field in the package's manifest names its entry point. Not taken: oclif's scan of every installed package, since
  the ticket wants direct dependencies only.
- **ESLint's exit codes (from memory).** 0 with no error (warnings alone are 0), 1 with lint errors, 2 for a
  configuration or internal error. The same three meanings as the glossary's **Exit code**.
- **gcc, tsc, rustc (from memory).** gcc prints `file:line:col: error: message [-Wflag]`, tsc `file(line,col): error
  TS2322: message`, rustc a `help:` line after the error. Taken: place first, the code beside the severity, a hint on
  the line.
- **OpenTelemetry's tracer provider (from memory).** Spans are buffered and sent at `forceFlush` or `shutdown`, which
  the process calls before it exits. Taken: the store's Layer wraps the whole run and its closing step is that flush.
- **Effect 4.1.3's `effect/cli`, read in `node_modules/effect/src/cli/Command.ts`, `CliOutput.ts` and `CliError.ts`.**
  `Command.runWith(command, { version, renderErrors })(args)` lexes, runs the action flags (`--help`, `--version`), parses
  and runs the handler, and rethrows a handler's failure. With `renderErrors: false` it still presents implicit help
  through `CliOutput.Presenter` and fails with `CliError.ShowHelp`, whose own message is only "Help requested" and whose
  `errors` hold the parse errors. `CliOutput.defaultPresenter` writes help to `Console.log`, and `layerPresenter`
  replaces it. `Command.provide(command, layer)` builds the layer for the handler only. `Command.isCommand` checks the
  string key `~effect/cli/Command`, so a second copy of Effect is still seen. Used as is.
- **Effect 4.1.3's runtime and tracer, read in `node_modules/effect/src/Tracer.ts`, `Layer.ts` and
  `@effect/platform-node-shared`'s `NodeRuntime.ts`.** The tracer is the reference `Tracer.Tracer`, so a Layer can give
  it; `Layer.isLayer`, `Layer.build`, `Layer.empty` and `Layer.catchCause` exist. `runMain`'s teardown hands the code
  to a callback that calls `process.exit` for a code other than 0. `NodeServices` is `ChildProcessSpawner | FileSystem |
  Path | Stdio | Terminal`, the same as `effect/cli`'s `Command.Environment`.
- **Node's module resolution, probed in the plan step's own scratch folder on Node 22.22.3** (the repo pins Node
  26.13.0, not probed). `module.findPackageJSON(name, rootUrl)` found the `package.json` of a package that does not
  export `./package.json`, where `createRequire(root).resolve(name + "/package.json")` failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`; it threw `ERR_MODULE_NOT_FOUND` for a listed package that is not installed.
  `createRequire(<root>/package.json).resolve("<name>/cli")` found an entry exported as a plain string and failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED` for one exported under an `import` condition only, which is the ticket's "no
  `default` condition". A dynamic `import()` of the resolved file gave its exports.
- **Today's code, read.** `kalfa/records/src/bin.ts` runs `Command.runWith` under `NodeRuntime.runMain` with a
  teardown that maps a value to the exit code, 2 for any other failure; this plan does the same in one place for every
  subcommand. `kalfa/records/src/cli.ts` and `kalfa/quality/src/cli.ts` export a plain command named by its root name,
  which `kalfa` refuses as a `subcommand` once slice 2 lands, so slice 1 takes their field off.

## The shape

### What a package exports (slice 1)

```ts
// Sketch: kalfa/cli/src/Subcommand.ts. Nothing here was type-checked.
import type { NodeServices } from "@effect/platform-node/NodeServices"
import type * as Diagnostic from "@kalfa/diagnostics/Diagnostic"
import type * as Diagnostics from "@kalfa/diagnostics/Diagnostics"
import type { Layer } from "effect"
import type { Command } from "effect/cli"

/** What `kalfa` gives every subcommand: Node's platform, and nothing else. */
export type Platform = NodeServices

// Symbol.for, so a second copy of this package marks the same key, as Diagnostics' Declared does.
const TypeId: unique symbol = Symbol.for("@kalfa/cli/Subcommand")

/** One package's subcommand: its command with its Layer already given, and the codes it declared. */
export interface Subcommand<out Name extends string = string> {
  readonly [TypeId]: typeof TypeId
  readonly name: Name
  readonly command: Command.Command<Name, unknown, unknown, unknown, Diagnostics.Diagnostics | Platform>
  readonly diagnostics: ReadonlyArray<Diagnostic.Declared>
}

/** What the command still needs once the Layer, Diagnostics and Node's platform are given: never, or a compile error. */
type Covered<R, A> = [Exclude<R, A | Diagnostics.Diagnostics | Platform>] extends [never]
  ? unknown
  : { readonly "the layer does not give": Exclude<R, A | Diagnostics.Diagnostics | Platform> }

/**
 * Makes a package's subcommand from an effect/cli command named by its root name.
 * Throws an Error when the name is not a root name: lowercase words joined by single hyphens, starting with a letter.
 */
export const make: <const Name extends string, Input, Parent, E, R, A, LE, LR extends Platform>(
  command: Command.Command<Name, Input, Parent, E, R>,
  options: {
    readonly layer: Layer.Layer<A, LE, LR>
    readonly diagnostics: ReadonlyArray<Diagnostic.Declared>
  } & Covered<R, A>,
) => Subcommand<Name>

/** True for a value `make` built, in this copy of the package or another: its mark, an effect/cli command, its name, its list. */
export const isSubcommand: (value: unknown) => value is Subcommand
```

- `make` stores `Command.provide(command, options.layer)`, so the command `kalfa` holds cannot run without its Layer.
  There is no `layer` field to forget (call, 80%).
- A root name is checked as Diagnostics checks a code's root: `Schema.is(Diagnostic.Code)(`${name}/x`)`, so the two
  rules cannot drift. A widened `Command<string, ...>` compiles and is checked here at run time.
- `isSubcommand` checks the mark, then `Command.isCommand(value.command)`, then `value.name === value.command.name`,
  then that `diagnostics` is an array. Each check gets a class (generators (f)).
- The module imports only types from `@kalfa/diagnostics` and `effect`, `Schema` from `effect`, and `Code` from
  `@kalfa/diagnostics/Diagnostic`.

### Finding and loading (slice 2)

```ts
// Sketch: kalfa/cli/src/internal/packages.ts. The one seam to Node's module system, so the laws run in memory.
export class Packages extends Context.Service<Packages, {
  /** The repo's root manifest, `<root>/package.json`, as text. */
  readonly root: Effect.Effect<string, Refused>
  /** An installed direct dependency's manifest text, found by `module.findPackageJSON(name, root)`; none when not installed. */
  readonly manifest: (name: string) => Effect.Effect<Option.Option<string>, Refused>
  /** `createRequire(<root>/package.json).resolve(specifier)`, then `import()` of that file: the module's exports. */
  readonly load: (pkg: string, specifier: string) => Effect.Effect<Record<string, unknown>, Refused>
}>()("@kalfa/cli/Packages") {}

export const layerNode: (root: string) => Layer.Layer<Packages, never, FileSystem.FileSystem>
```

```ts
// Sketch: kalfa/cli/src/internal/manifest.ts.
/** "." or "./" and parts that are not empty, ".", or "..". */
const Subpath = Schema.String.check(Schema.isPattern(/^\.(?:\/(?!\.\.?(?:\/|$))[^/]+)*$/))

/** A manifest's fields kalfa reads. Other keys, in `kalfa` too, are left alone. */
export const Manifest = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  kalfa: Schema.optionalKey(Schema.Struct({ cli: Schema.optionalKey(Subpath), spans: Schema.optionalKey(Subpath) })),
})

/** The direct dependencies, each once, sorted by name, each with whether it is optional. */
export const direct: (root: Manifest) => ReadonlyArray<{ readonly name: string; readonly optional: boolean }>
/** `<name>` and the subpath as one specifier: "./cli" -> "<name>/cli", "." -> "<name>". */
export const specifier: (name: string, subpath: string) => string
```

```ts
// Sketch: kalfa/cli/src/internal/failure.ts. Every refusal that stops the start: exit code 2, one line, no handler run.
export class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  reason: Schema.Literals(["no-manifest", "not-installed", "bad-manifest", "bad-field", "not-exported",
    "load", "no-subcommand", "two-stores"]),
  packages: Schema.Array(Schema.String),   // the package or packages named; empty for no-manifest
  field: Schema.optionalKey(Schema.Literals(["cli", "spans"])),
  subpath: Schema.optionalKey(Schema.String),
}) {
  override get message(): string  // the table below, one sentence or two, never a path or an error's own text
}
```

The run's steps, each a span (`Effect.fn("cli.<call>")`):

1. `cli.find`: `Packages.root`, decoded by `Manifest` (`bad-manifest` when it is not JSON or not that shape, naming no
   package). `direct` lists the dependencies. For each, `Packages.manifest(name)`: none and not optional is
   `not-installed`, none and optional is skipped. Its text is decoded by `Manifest` (`bad-manifest`, naming it, or
   `bad-field` when only `kalfa` is off). A manifest with `kalfa.cli` is a candidate. No dependency's own dependencies
   are read.
2. `cli.load`, once per candidate, all at once (`Effect.forEach` with unbounded concurrency): `Packages.load(name,
   specifier(name, cli))`, then `isSubcommand(exports.subcommand)`, read with `Object.hasOwn`, else `no-subcommand`.
3. `cli.command`: the root command `kalfa`, with every loaded subcommand's `command` under it sorted by root name, run by
   `Command.runWith(root, { version, renderErrors: false })(args)`, with the printing `Diagnostics`, `kalfa`'s presenter
   and Node's platform.
4. `cli.print`, once per report, inside the printing `Diagnostics`: the readable line to standard error at once, and
   the count of errors and warnings.
5. `cli.exit`: the outcome, and from it the exit code.
6. `cli.run` is the span around 1 to 5.

### Outcomes and exit codes (slice 2)

```ts
// Sketch: kalfa/cli/src/internal/run.ts.
export const Outcome = Schema.Union([
  Schema.TaggedStruct("clean", { warnings: Schema.Int }),                     // no error reported, the handler finished
  Schema.TaggedStruct("reported", { errors: Schema.Int, warnings: Schema.Int }), // one or more errors, each printed
  Schema.TaggedStruct("failed", { message: Schema.String }),                   // could not finish, or refused to start
]).pipe(Schema.toTaggedUnion("_tag"))

export const exitCode = (outcome: Outcome): 0 | 1 | 2 =>
  Outcome.match(outcome, { clean: () => 0, reported: () => 1, failed: () => 2 })

/** The whole run: find, load, run, print, pick. Never fails: a failure is an outcome. */
export const main: (args: ReadonlyArray<string>) => Effect.Effect<0 | 1 | 2, never, Packages | Platform>
```

| Outcome | Standard output | Standard error | Exit code | Laws |
|---|---|---|---|---|
| `clean` | what the handler printed, or the help or version asked for | each warning's line | 0 | K3, K4, K5 |
| `reported` | what the handler printed | each diagnostic's line | 1 | K3, K4, K5 |
| `failed`, the handler failed or died | what the handler printed before | each diagnostic's line, then `kalfa: <message>` | 2 | K3, K6 |
| `failed`, a bad invocation | nothing | the help, then `kalfa: <message>` | 2 | K3, K5, K6 |
| `failed`, refused to start | nothing | `kalfa: <message>` | 2 | K2 |

A failure's message, by what stopped the run:

| What stopped it | Message | Law |
|---|---|---|
| a typed failure or a defect with a `message` | that message | K6 |
| any other failure value | `the subcommand stopped with a value that has no message.` | K6 |
| an unknown flag, a bad value, a missing argument | each `ShowHelp` error's message, joined by a space | K6 |
| no subcommand given (`kalfa`, `kalfa leak`) | `` `<command path>` needs a subcommand. `` | K6 |
| an interruption | `kalfa was stopped.` | K6 |
| `no-manifest` | `There is no package.json in this folder. Run kalfa from the repo's root.` | K2 |
| `not-installed` | `<pkg> is listed in package.json but not installed. Run your package manager's install.` | K2 |
| `bad-manifest` | `<pkg or "This folder">'s package.json is not a JSON object kalfa can read.` | K2 |
| `bad-field` | `<pkg>'s kalfa.<field> field must be "." or a "./" path inside the package.` | K2 |
| `not-exported` | `<pkg> names <subpath> in its kalfa.<field> field, but its exports give that path no "default" condition, so kalfa cannot load it.` | K2, K9, K12 |
| `load` | `<pkg>'s kalfa.cli entry <subpath> failed to load.` | K2 |
| `no-subcommand` | `<pkg> names <subpath> in its kalfa.cli field, but that entry exports no subcommand. Expected: export const subcommand = Subcommand.make(command, { layer, diagnostics }), from @kalfa/cli/Subcommand.` | K2 |
| `two-stores` (slice 3) | `Two packages name a store in their kalfa.spans field: <pkg>, <pkg>. Keep one.` | K9 |

A refusal never prints an error's own text or a path, since a module's load error holds an absolute path, and an
absolute path may hold a login name (Diagnostics' README, "Say where"). `bad-manifest` reads no more than that.

### Printing (slice 2)

```ts
// Sketch: kalfa/cli/src/internal/print.ts.
/** Cc, Cf, Cs, U+2028, U+2029 as JSON writes them, and "\" as "\\". Undone by `unescape` in the laws' support file. */
export const escape: (text: string) => string
/** `<place>: <severity> <code>: <message> Hint: <hint>`, each text escaped. */
export const line: (diagnostic: Diagnostic.Reported) => string
/** `kalfa: <message>`, escaped. */
export const failure: (message: string) => string
/** The `Diagnostics` a run gives its handler: prints each line with `Console.error` at once, and counts. */
export const diagnostics: (counts: Ref.Ref<Counts>) => Layer.Layer<Diagnostics.Diagnostics>
/** Help a person asked for (`--help`) and the version go to standard output; implicit help to standard error. */
export const presenter: Layer.Layer<never>
```

- Standard output holds only what a handler prints through `Console`, as it is, and the help or version a person asks
  for with `--help` or `--version` (call, 80%: both are what was asked, as `git --help` prints to standard output).
  `kalfa`'s own lines all use `Console.error`.
- Effect's `Console` in Node writes `log` to standard output and `error` to standard error. Tests read both through
  Effect's `TestConsole` (`logLines`, `errorLines`).

### The store (slice 3)

```ts
// Sketch: kalfa/cli/src/internal/store.ts.
/** The one direct dependency with `kalfa.spans`, loaded; none when no dependency has the field. */
export const find: (deps: ReadonlyArray<Found>) => Effect.Effect<Option.Option<Store>, Refused, Packages>
/** The store's `layer`, or a warning and none when its module fails to load or exports no Layer. */
export const load: (store: Store) => Effect.Effect<Option.Option<Layer.Layer<never, unknown, Platform>>, never, Packages>
/** Runs `run` under the store's tracer. A build failure drops the spans; the closing step's cause is ignored. */
export const around: <A>(layer: Option.Option<Layer.Layer<never, unknown, Platform>>, run: Effect.Effect<A, never, Platform>) =>
  Effect.Effect<A, never, Platform>
```

- The manifests are read once, before any span, since the tracer is not known yet: slice 3 moves slice 2's manifest
  reads out of `cli.find`, which keeps picking the candidates from what was read. Finding the store and loading it
  make no span. Then `around` builds the store's Layer in a scope of its own, runs `cli.run` (with `cli.find` inside it)
  under the tracer it gives, and closes that scope once `cli.exit` has ended, so every span reaches the store's closing
  step. A build failure of any kind (a missing client key, an app out of reach) gives no tracer and no warning (call,
  80%: decision 0079 says the spans are dropped, and on a laptop without a key that is the normal case). A failure or
  defect in the closing step is caught and dropped.
- The warning for a store that fails to load: `kalfa: warning: the store in <pkg> did not load, so this run's spans are
  dropped.` on standard error, once, before the run.
- `kalfa` does not time-bound the closing step (call, 80%): how long a store may wait for the app is the store's own
  setting, in the package that builds it (Findings, 3).

### The package (slice 1, grown in slice 2)

- `kalfa/cli/package.json`: `@kalfa/cli`, private, `effect` and `@effect/platform-node` as peers (one copy shared with
  every subcommand), `@kalfa/diagnostics` as its one dependency (call, 80%: its marks are `Symbol.for` keys and its
  service a string key, so a second copy still works), exports `./Subcommand` and `./package.json` with their
  `publishConfig` twins. Slice 2 adds `"bin": { "kalfa": "./src/bin.ts" }` and `publishConfig.bin` to `./dist/bin.js`.
- Rank: the row `kalfa-cli` at layer 2, importing `kalfa-diagnostics` only, so "Configuration below CLI"
  (`kalfa/AGENTS.md`) already holds when ticket 2081 adds the Configuration edge (call, 80%: what settles it is
  `oxlint-plugins/layers.test.ts` at the tests step; if a layer must be one above its highest import, it is 1 and 2081
  raises it).
- `.oxlintrc.json`: `kalfa/cli/src/**` joins the kalfa block (`fabrika/no-promises`, `fabrika/no-effect-run-outside-edge`
  and the rest), and an override refuses `process.env` there. Two edge lines, each with `// oxlint-disable-next-line
  <rule> -- edge: <why>`: the `import()` in `Packages.layerNode`, and `NodeRuntime.runMain` in `bin.ts`. CI lists each
  new edge for the owner to read.

## One value traced

The repo from the sketch at the top. `./package.json`:

```json
{ "devDependencies": { "@demo/leak": "1.0.0", "left-pad": "1.3.0" } }
```

`@demo/leak`'s manifest has `"kalfa": { "cli": "./cli" }` and `"exports": { "./cli": "./cli.js" }`. `left-pad`'s has no
`kalfa` field and exports no `./package.json`. No dependency has `kalfa.spans`.

1. `kalfa leak check`. `bin.ts` runs `main(["leak", "check"])` under `runMain` with Node's platform and
   `Packages.layerNode(<current folder>)`.
2. The root manifest decodes. `direct` gives `@demo/leak` and `left-pad`, both not optional. No store: the run goes on
   with whatever tracer it has (slice 3).
3. `cli.run` opens; `cli.find`: `findPackageJSON("left-pad", root)` finds its manifest though it exports no
   `./package.json`; it has no `kalfa`, so nothing more is read. `@demo/leak` has `kalfa.cli` `./cli`: one candidate.
4. `cli.load`: `createRequire(<root>/package.json).resolve("@demo/leak/cli")` gives its `cli.js`; `import()` gives
   `{ subcommand }`; `isSubcommand` holds; its name is `leak`.
5. `cli.command`: the root `kalfa` with `leak` under it. `runWith` parses `leak check` and runs `check`'s handler, with
   `Layer.empty` given by `make`, the printing `Diagnostics` and Node's platform.
6. The handler logs `checked 2 files`: standard output. It reports: `cli.print` writes
   `docs/setup.md:12: error leak/key-shape: A line has the shape of a private key. Hint: Remove the key and rotate it.`
   to standard error, and the count is one error.
7. The handler ends. `cli.exit`: `reported { errors: 1, warnings: 0 }`, exit code 1, annotated as
   `process.exit.code`. `cli.run` ends. `bin.ts` waits for standard output to drain and exits with 1.

Variants:

- `kalfa leak`: `leak` has no handler, so `runWith` presents implicit help, which `kalfa`'s presenter writes to standard
  error, and fails with `ShowHelp` with no errors. `failed`, `kalfa: \`kalfa leak\` needs a subcommand.`, exit code 2.
- `kalfa leak check --frobnicate`: `ShowHelp` with one error; help on standard error, then `kalfa: ` and effect/cli's
  message for the unknown flag; exit code 2; standard output empty.
- The same report with severity `warning`: the line says `warning`, and the outcome is `clean { warnings: 1 }`, exit 0.
- `left-pad` with `"kalfa": { "cli": "./cli" }` and a `cli.js` that exports `{ x }`: `cli.load` refuses with
  `no-subcommand`. `kalfa: left-pad names ./cli in its kalfa.cli field, but that entry exports no subcommand. Expected:
  ...`, exit code 2, no handler ran, standard output empty.
- A message `two\nlines` prints as `two\nlines` with a backslash and an `n`, on one line.
- Slice 3: `@demo/store` with `"kalfa": { "spans": "./spans" }` exporting `layer`. Its Layer is built before `cli.run`;
  `cli.find`, `cli.load`, `cli.command` (and the handler's own spans inside it), `cli.print`, `cli.exit` and `cli.run`
  each reach its tracer, and its closing step runs after `cli.run` ends, before the exit.

## What fact is lost if it is not recorded now

- A run's spans carry what nothing else records: which packages were loaded (`kalfa.cli.package` on `cli.load`), which
  root name ran (`kalfa.cli.root` on `cli.command`), how many errors and warnings were reported
  (`kalfa.cli.reported.errors`, `kalfa.cli.reported.warnings` on `cli.exit`), the exit code (`process.exit.code`, the
  OpenTelemetry name) and `kalfa`'s version (`kalfa.cli.version` on `cli.run`). Each `cli.print` span has the code and
  severity. Once the store lands, these reach the span log; without it they are dropped, as decision 0079 says.
- Never in a span: the arguments, a message, a hint, a place's path or name, or a failure's message, since any of them
  may hold a value a person typed (K8).

## Generators

Every generator is an Effect `Arbitrary`, in `kalfa/cli/src/run.test-support.ts` (slices 2 and 3) or
`kalfa/cli/src/Subcommand.test-support.ts` (slice 1). A generated repo is an in-memory `Packages` layer: a root manifest,
a map of installed manifests and a map of entries to module records (or a resolve or import that throws), which records
every `load` call in order. Every run goes through `Command.runWith` with `TestConsole`, the effect/cli test platform
(no-op file system, `Stdio.layerTest`, a terminal that dies when read) and a recording tracer modeled on
`next/apps/fabrika/src/door-spans.test.ts`'s `capture`. Caps: at most four dependencies, two subcommands, four reports a
run. Each run builds one case per class it lists, from the drawn seeds, and a law fails when a class it lists was not
reached.

The repo:

- (a) dependency lists: names spread over `dependencies`, `devDependencies` and `optionalDependencies`, one name in two
  lists, empty lists, no lists at all.
- (b) a dependency's `kalfa` field: absent, present with other keys only, present with `cli`.
- (c) a dependency of a dependency whose own manifest has `kalfa.cli`.
- (n) a listed dependency that is not installed, under `dependencies` and under `optionalDependencies`.
- (g) bad fields, each in a manifest that is otherwise good: `kalfa` an array or a string, `kalfa.cli` a number, `cli`
  without `./`, a `..` part, an empty part.
- (h) an entry with no `default` condition (the stand-in's resolve refuses it, as Node's does).
- (i) an entry whose import throws.
- (d) an entry that loads and exports no `subcommand`.
- (e) an entry whose `subcommand` is a plain effect/cli command, as Records' and Code quality's are today.
- (f) look-alikes that carry the mark: no `command`, a `command` that is not one, a `name` other than its command's, no
  `diagnostics` array.
- (o) two subcommands whose layers give one service tag different values.

The run:

- (j) reports: zero to four, errors and warnings mixed, warnings only, each kind of place.
- (t) message, hint and place texts with LF, CRLF, a lone CR, a tab, ESC, U+2028, U+202E, a lone surrogate, a
  backslash, `雪` and plain text.
- (k) handler output through `Console.log`: the empty text, text with line breaks, non-ASCII text, interleaved with
  reports.
- (l) how the run ends: success, a typed failure, a defect, a failure value with no message, an unknown flag, a missing
  argument, no subcommand given, `--help`, `--version`, an interruption.
- (u) a report, then a defect, in one handler.
- (r) secret-looking argument texts, each with a character that changes in JSON and in a URL, as a flag's value and as
  an argument, and the same text in a message and a hint.

The store (slice 3):

- (m) none, one, two, a module that throws on import, a module with no `layer`, a `layer` that is not a Layer, a Layer
  that fails to build, a Layer that dies while it builds, a closing step that fails, a closing step that dies, an entry
  with no `default` condition.

The shape (slice 1):

- (s) root names: lowercase words joined by single hyphens, and refused: a capital letter, a leading digit, a leading or
  trailing hyphen, two hyphens, a slash, a space, the empty name.

Each guarding check has its class, and each class passes every check before its own: (g) passes the JSON decode and
reaches the field's schema; (h) passes the field and reaches the resolve; (i) passes the resolve and reaches the
import; (d) passes the import and reaches the own-key read of `subcommand`; (e) has a `subcommand` and reaches the
mark; (f) carries the mark and reaches each later check in turn.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| K1, slice 2, only direct dependencies with `kalfa.cli` are loaded: for a generated repo, the stand-in's `load` calls are exactly one per direct dependency whose manifest has `kalfa.cli`, sorted, with the specifier `<name>` plus the subpath; no other package's entry, and no dependency's own dependency, is loaded or read; every manifest read comes before the first load. 100 runs, every class listed reached | test | Effect Arbitrary: Repo | (a) read only `dependencies`: a devDependency's subcommand is missing, red; (a) keep a name listed twice: it is loaded twice, red; (c) read each dependency's own dependencies too: the deeper entry is loaded, red; (b) treat a `kalfa` field without `cli` as a candidate: a load is made, red; (b) import every dependency's root to look for `subcommand`: a package without the field is loaded, red | kalfa/cli/src/run.test.ts |
| K2, slice 2, a refused start: for each refusing class, the exit code is 2, standard error is exactly one line, `kalfa: ` and the message of the table above for that reason, naming the package; standard output is empty and no handler ran; the message holds no path and no thrown error's text. 100 runs, every class listed reached | test | Effect Arbitrary: Repo | (d) skip a package with no `subcommand`: exit 0, red; (e) accept any command as `subcommand`: red; (f) check only the mark: a look-alike passes and the run dies with another message, red; (g) take any string as the field: a `..` subpath is loaded, red; (h) treat a resolve failure as no field: exit 0, red; (i) put the thrown error's message in the line: its path is printed, red; (n) skip a missing regular dependency: exit 0, red; (n) refuse a missing optional one: exit 2, red | kalfa/cli/src/run.test.ts |
| K3, slice 2, the exit code: for a generated run, the code is 0 when no error was reported and the handler finished (warnings alone included, and `--help` and `--version`), 1 when one or more errors were reported and it finished, 2 for every way (l) has of not finishing; `exitCode` of the outcome is the code `main` answers. 100 runs, every class listed reached | test | Effect Arbitrary: Runs | (j) count warnings as errors: a warnings-only run ends 1, red; (l) map a typed failure to 1: red; (l) map implicit help to 0: red; (l) map `--help` to 2: red; (u) let a defect after a report end 1: red | kalfa/cli/src/run.test.ts |
| K4, slice 2, the readable line: for a generated run, the diagnostic lines on standard error are, in report order, one per report that `TestDiagnostics.layer` collects from the same handler; each is `line` of it: it holds no Cc, Cf or Cs character and no U+2028 or U+2029, it starts with the escaped `Diagnostic.formatPlace`, then `: `, the severity, a space, the code, `: `, and it ends with ` Hint: ` and the escaped hint; undoing the escape on the message part gives the message back, byte for byte; a report made before a defect is printed. 100 runs, every class listed reached | test | Effect Arbitrary: Reports | (t) write the message raw: a line break splits the line, red; (t) leave `\` as it is: the undone escape differs, red; (t) escape LF only: a lone CR stays, red; (t) escape Cc only: U+202E stays, red; (j) leave out the hint: red; (u) collect the lines and print them at the end: the report before the defect is lost, red | kalfa/cli/src/run.test.ts |
| K5, slice 2, standard output is the handler's: for a generated run, the `TestConsole` log lines are exactly the texts the handler passed to `Console.log`, in order and unchanged; no diagnostic line, failure line or implicit help is among them; for `--help` and `--version` they are the help or the version and nothing else; for an unknown flag or no subcommand they are empty. 100 runs, every class listed reached | test | Effect Arbitrary: Runs | (k) print diagnostics with `Console.log`: red; (k) trim the handler's text: red; (l) keep effect/cli's default presenter: an unknown flag puts help on standard output, red | kalfa/cli/src/run.test.ts |
| K6, slice 2, a failure prints one line: for every generated way of not finishing, standard error ends with exactly one line `kalfa: <message>`, the message by the table above; the line has no line break, no severity word, no code and no place. 100 runs, every class listed reached | test | Effect Arbitrary: Runs | (l) print `Cause.pretty`: several lines, red; (l) print `ShowHelp`'s own message: `Help requested`, red; (l) print a failure value with no message as `[object Object]`: red; (t) print a failure message raw: a break in it splits the line, red | kalfa/cli/src/run.test.ts |
| K7, slice 2, each step is a span: for a generated run under a recording tracer, `cli.run` is the root; `cli.find`, one `cli.load` per candidate with `kalfa.cli.package`, `cli.command` with `kalfa.cli.root`, one `cli.print` per report with its code and severity, and `cli.exit` with `process.exit.code` and the counts are inside it; the handler's own spans are inside `cli.command`; every span ends before `main` answers. 100 runs, every class listed reached | test | Effect Arbitrary: Runs | (j) print without a `cli.print` span: red; (l) pick the exit code after `cli.run` ends: `cli.exit` is outside it, red; (l) skip `cli.exit` on a failure: red | kalfa/cli/src/run.test.ts |
| K8 [secrets], slice 2, nothing typed reaches a span: a generated secret-looking text given as an argument or a flag's value, or written in a message or a hint, never appears in any span's name, attributes or events, raw, JSON-escaped or URL-encoded, whether the run succeeds, reports or fails. 100 runs | test | Effect Arbitrary: SecretArgs | (r) annotate `cli.command` with the arguments: red; (r) put the failure message on `cli.exit`: an unknown flag's echoed value leaks, red; (r) annotate `cli.print` with the message: red | kalfa/cli/src/run.test.ts |
| K9, slice 3, the store: for a generated repo and store class, with one store every span of K7 and the handler's own spans reach the store's tracer and are all ended when its closing step runs, and the closing step runs once, after `cli.exit`; with two, the start is refused, `two-stores`, naming both, sorted, exit code 2; with no `default` condition, `not-exported` naming the package, exit code 2; with a module that throws, exports no `layer` or exports something that is not a Layer, one warning line naming the package comes first on standard error, and the run's standard output, its other lines and its exit code equal the same repo's run with no store; with a Layer that fails or dies while it builds, or a closing step that fails or dies, standard output, standard error and the exit code equal that run with no store. 100 runs, every class listed reached | test | Effect Arbitrary: Stores | (m) build the store's Layer inside `cli.command`: `cli.find` never reaches it, red; (m) close the store before `cli.exit`: `cli.exit` arrives after the close, red; (m) let a build failure through: exit 2, red; (m) let the closing step's defect into the exit: exit 2, red; (m) take the first of two stores: red; (m) refuse the start when the module throws: red; (m) warn when the Layer fails to build: standard error differs, red | kalfa/cli/src/store.test.ts |
| K10, slice 1, the shape's types: `make` of a command named `"leak"` is `Subcommand<"leak">`; it compiles for a command made with a handler, one made with `withSubcommands`, one given a layer ahead with `Command.provide`, and one typed `Command<string, ...>`; for `Layer.empty`, a `Layer.succeed`, and a layer that needs `Path`; a command that needs a service the layer, Diagnostics and Node's platform do not give, a layer that needs such a service, and a `diagnostics` list holding a string each do not compile (`@ts-expect-error`); built from real values, with no `declare const`, and its `it` passes under vitest too | type | type | drop `Covered` from `make`: the missing-service line compiles, tsc red; widen `LR` to `unknown`: the layer line compiles, tsc red; return `Subcommand<string>`: the literal line fails, tsc red | kalfa/cli/src/Subcommand.types.test.ts |
| K11, slice 1, `make` and `isSubcommand` at run time: for a generated name, `make` builds exactly when the name is a root name by an independent model of the rule, and throws an `Error` naming the rule otherwise; what it builds keeps its name and its `diagnostics` list as given, and its command runs its handler with the layer's service; `isSubcommand` is true for what `make` built, here and from an object carrying the same `Symbol.for` mark, and false for each look-alike. 100 runs, every class listed reached | test | Effect Arbitrary: RootNames | (s) drop the name check: `Leak` builds, red; (s) check with a pattern that allows a trailing hyphen: red; (f) check only the mark: a look-alike is true, red; (f) skip the name-against-command check: red; (o) store the command without `Command.provide`: the handler dies for its service, red | kalfa/cli/src/Subcommand.test.ts |
| K12, slice 2, the real command: in a small repo on disk with one package whose subcommand logs a line and reports one error, `node <kalfa/cli/src/bin.ts>` run in that folder prints the log line on standard output, the diagnostic's readable line on standard error, and ends with exit code 1; with a second package whose `kalfa.cli` entry is exported under an `import` condition only, the start is refused naming it, exit code 2; a third dependency that exports no `./package.json` is found and skipped | test | scenario: the real binary, a real process and a repo on disk, since what it proves is that Node's resolve, `findPackageJSON`, `import()` and `runMain` behave as the stand-in does | resolve from where `@kalfa/cli` is installed (`import.meta.resolve`): the repo's package is not found, red; read a dependency's manifest through `resolve("<name>/package.json")`: the third package stops the start, red | kalfa/cli/src/bin.integration.test.ts |
| K13, slice 1, the import rules: the row `kalfa-cli` at layer 2 imports `kalfa-diagnostics` only, the boundary type `kalfa-cli` the same, `kalfa/cli/src` is in the layer roots, and `kalfa/cli/src/**` is in `.oxlintrc.json`'s kalfa block with `process.env` refused; the pinned layer table holds `"kalfa-cli": 2` | lint | lint | import `@kalfa/config` from `kalfa/cli/src/Subcommand.ts`: `pnpm lint:boundaries` red; import `@kalfa/records/cli` there: red; read `process.env.PATH` in a cli file: `pnpm lint` red; delete the layer row: `oxlint-plugins/layers.test.ts` red | layer-rules.json, boundary-rules.json, .oxlintrc.json, oxlint-plugins/layers.test.ts |
| K14, slices 1 and 2, the manifest: exports are `./Subcommand` and `./package.json`, each with its `publishConfig` twin; the only package of the repo's scope it names is `@kalfa/diagnostics`, a dependency; its peers are `effect` and `@effect/platform-node`; slice 2: `bin` is exactly `{ "kalfa": "./src/bin.ts" }` and `publishConfig.bin` `{ "kalfa": "./dist/bin.js" }` | test | scenario: the package's own manifest at head; no generated input says what a manifest holds | add `./internal/run` to the exports: red; slice 2: name the bin `kalfa-cli`: red | kalfa/cli/src/Package.test.ts |
| K15, slice 1, no file of the package names this repo: the words Diagnostics' D12 looks for, spelled in pieces, are in no file of `kalfa/cli` outside `node_modules` and `dist` | test | scenario: the package's own files at head | write the repo's name in the README: red | kalfa/cli/src/Package.test.ts |
| K16, slices 1 and 2, the README: it links Diagnostics' README for how to write a message and a hint, in one line; it says that a package that reports imports `@kalfa/diagnostics`, and imports `@kalfa/cli` only for `Subcommand`; slice 2: a section "One file" says yes or no and why, and its examples compile as Diagnostics' D24 holds its own | test | scenario: the package's own README at head | delete the link: red; slice 2: delete the "One file" section: red | kalfa/cli/src/Package.test.ts, kalfa/cli/src/README.types.test.ts |
| K17, slice 1, the repo's kalfa manifests: among tracked `kalfa/*/package.json`, only `@kalfa/cli` has a `bin`, named `kalfa`; and every package with a `kalfa.cli` field has an entry there whose `subcommand` export passes `isSubcommand`, so today, with the field off Records and Code quality, none has one | test | scenario: the tracked manifests at head, listed with `git ls-files`, as `oxlint-plugins/law-ids.ts` lists them | leave `kalfa.cli` on Records: its `./cli` exports `records`, no `subcommand`, red; add a `bin` to Records: red | oxlint-plugins/kalfa-manifests.test.ts |
| K18, slice 2, each subcommand gets its own Layer: for a generated repo with two subcommands whose layers give one service tag different values, each handler prints its own layer's value, and a third value given at the root is never seen | test | Effect Arbitrary: Repo | (o) provide every subcommand's layer at the root: one value wins in both, red | kalfa/cli/src/run.test.ts |

**Lint, type or test?** K13 is the shape of the import graph and of what a file reads: lint, through the layer and
boundary rows and an oxlint override. K10 is a shape the compiler sees: type. Every other law is about what a run
prints, loads or answers: tests.

**Where they run.** Every law but K12 runs on every pull request in memory: the `Packages` stand-in, `TestConsole`,
the effect/cli test platform and a recording tracer. K12 is the one `.integration.` file: it spawns a real process on a
real repo on disk, which no stand-in can be, since it proves the stand-in matches Node. The laptop refuses it by name
(`vitest.hostrun.ts`), so it runs in CI, and in a proof run the lead starts. Its fixture repo is made in a temp folder by
the test: the package files are written there, and `node_modules/effect`, `node_modules/@kalfa/cli` and
`node_modules/@kalfa/diagnostics` are links to the workspace's own folders, so the fixture imports the source. No law is
host-only.

**Run time.** Each case is one `Command.runWith` in memory; at four dependencies and four reports a run, each law stays
under about 20 s at full depth. The tests step times each new law once with `FABRIKA_TEST_DEPTH=full` and splits a law
by class when it passes 20 s.

## Criteria and laws

| Criterion of ticket 2076 | Laws |
|---|---|
| A package's entry exports `subcommand`, made with `Subcommand.make(command, { layer, diagnostics })`, named by its root name | K10, K11, K2 |
| `kalfa` reads the root manifest; each direct dependency with `kalfa.cli` is a subcommand; none other, no dependency of a dependency | K1 |
| A `kalfa.cli` entry that exports no `subcommand` stops the start with exit code 2, naming the package and what was expected | K2 |
| The field comes off Records and Code quality | K17 |
| Nothing on PATH; which packages have one is found from manifests alone, no package code run | K1, K13 |
| Each subcommand loads at run time; no static import of an entry or a Layer | K1, K13 |
| Only Node's platform; a subcommand gets its own Layer on top | K10, K11, K18 |
| The diagnostic's shape, `make`, `report` and the test Layer come from `@kalfa/diagnostics`; its tests use that Layer | K13, K14, K4 |
| Exit code 0, 1, 2; a warning alone is 0 | K3 |
| A failure is printed with a message and no code, place or severity | K6 |
| A readable line by default with place, severity, code, message and hint; diagnostics and failures on standard error; standard output only the handler's | K4, K5 |
| What a handler prints through `Console` is printed as it is | K5 |
| One real test in a small repo on disk, error line and exit code 1 | K12 |
| `@kalfa/cli` is the only kalfa package with a `bin`, named `kalfa` | K14, K17 |
| The package names nothing specific to this repo | K15 |
| It imports `@kalfa/diagnostics` and no other kalfa package; its rank is written | K13 |
| Each step is a `cli.<call>` span; no Telemetry or Ledger import; in tests, a tracer in memory | K7, K13 |
| A tracer that cannot reach its store changes neither output nor exit code | K9 |
| `kalfa.spans` names the store's entry, which exports `layer`; with none, spans go nowhere | K9 |
| The store's entry is resolved with `createRequire` from the root manifest and loaded with `import()`; no `default` condition stops the start | K9, K12, K13 |
| Two stores stop the start, naming both; one test shows it | K9 |
| A store that fails to load prints a warning and the run goes on; one whose Layer fails to build drops the spans | K9 |
| The store's Layer wraps the whole run; `cli.find`, the subcommand's spans and `cli.run` reach its closing step | K9 |
| The one-file try, written in the README, yes or no | K16 |
| The README points to Diagnostics' README and says what a reporting package imports | K16 |

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/cli/package.json | tests | tests | slice 1, new: name, private, scripts, exports and `publishConfig.exports`, `files`, peers, the one dependency, dev dependencies as `kalfa/diagnostics`'s plus `fast-check` and `@kampus/vitest` if the laws use them; slice 2: `bin` and `publishConfig.bin` |
| kalfa/cli/tsconfig.json | tests | tests | slice 1, new: as `kalfa/diagnostics`'s |
| kalfa/cli/tsconfig.build.json | tests | tests | slice 1, new: as `kalfa/diagnostics`'s |
| kalfa/cli/rslib.config.ts | build | 12 | slice 1, new: as `kalfa/diagnostics`'s |
| kalfa/cli/src/Subcommand.ts | build | 75 | slice 1, new: `Platform`, `Subcommand`, `make`, `isSubcommand`, with doc blocks |
| kalfa/cli/README.md | build | docs | slice 1, new: what the package is, how a package exports its subcommand, the one line to Diagnostics' README, the import sentence; slice 2: running `kalfa`, the readable line, standard output and error, the exit codes, the section "One file"; slice 3: the store |
| kalfa/cli/GLOSSARY.md | build | docs | slice 2: **Readable line**; slice 3: **Store** (below) |
| kalfa/records/package.json | build | 3 | slice 1: the `kalfa` field leaves |
| kalfa/quality/package.json | build | 3 | slice 1: the `kalfa` field leaves |
| kalfa/records/src/cli.ts | build | 1 | slice 1: the opening comment stops saying `kalfa` finds it through the field |
| kalfa/quality/src/cli.ts | build | 1 | slice 1: the same |
| kalfa/quality/README.md | build | docs | slice 1: the sentence on the `kalfa.cli` field says the field comes back with the refit |
| kalfa/quality/src/cli.types.test.ts | tests | tests | slice 1: its opening comment, the same |
| kalfa/cli/src/Subcommand.types.test.ts | tests | tests | slice 1, new: K10 |
| kalfa/cli/src/Subcommand.test.ts | tests | tests | slice 1, new: K11 |
| kalfa/cli/src/Subcommand.test-support.ts | tests | tests | slice 1, new: RootNames and the look-alikes |
| kalfa/cli/src/Package.test.ts | tests | tests | slice 1, new: K14, K15, K16; slice 2: their bin and "One file" parts |
| kalfa/cli/src/README.types.test.ts | tests | tests | slice 2, new: K16's compile half, as `kalfa/diagnostics/src/README.types.test.ts` |
| oxlint-plugins/kalfa-manifests.test.ts | tests | tests | slice 1, new: K17 |
| layer-rules.json | tests | tests | slice 1: the `kalfa-cli` row and `kalfa/cli/src` in `roots` |
| boundary-rules.json | tests | tests | slice 1: the `kalfa-cli` library type and its `libraries` entry |
| oxlint-plugins/layers.test.ts | tests | tests | slice 1: `"kalfa-cli": 2` in the pinned table, with its reason |
| .oxlintrc.json | tests | tests | slice 1: `kalfa/cli/src/**` in the kalfa block's files; an override refusing `process.env` there |
| package.json | tests | tests | slice 1: `@kalfa/cli` as a root dev dependency, so `pnpm lint:reach` finds the package reached |
| pnpm-lock.yaml | tests | tests | slice 1: the new importer and the root's link, by one `pnpm install --offline` |
| kalfa/cli/src/internal/manifest.ts | build | 35 | slice 2, new: `Subpath`, `Manifest`, `direct`, `specifier`, `root` |
| kalfa/cli/src/internal/packages.ts | build | 50 | slice 2, new: the `Packages` service and `layerNode`, with the one `import()` edge line |
| kalfa/cli/src/internal/failure.ts | build | 30 | slice 2, new: `Refused` and its messages |
| kalfa/cli/src/internal/find.ts | build | 25 | slice 2, new: `cli.find` |
| kalfa/cli/src/internal/load.ts | build | 25 | slice 2, new: `cli.load` |
| kalfa/cli/src/internal/print.ts | build | 60 | slice 2, new: `escape`, `line`, `failure`, `diagnostics`, `presenter` |
| kalfa/cli/src/internal/run.ts | build | 50 | slice 2, new: `Outcome`, `exitCode`, `root`, `main`, the failure messages of a run |
| kalfa/cli/src/bin.ts | build | 15 | slice 2, new: the edge: `runMain`, Node's platform, `layerNode`, the drain before exit, the `runMain` edge line |
| kalfa/cli/src/run.test.ts | tests | tests | slice 2, new: K1 to K8, K18 |
| kalfa/cli/src/run.test-support.ts | tests | tests | slice 2, new: the generators, the `Packages` stand-in, the recording tracer, `unescape`; slice 3: Stores |
| kalfa/cli/src/bin.integration.test.ts | tests | tests | slice 2, new: K12 |
| kalfa/cli/src/internal/store.ts | build | 60 | slice 3, new: `find`, `load`, `around` |
| kalfa/cli/src/internal/find.ts | build | 15 | slice 3: the `kalfa.spans` candidates and `two-stores` |
| kalfa/cli/src/internal/failure.ts | build | 10 | slice 3: `two-stores` and the warning line |
| kalfa/cli/src/internal/run.ts | build | 20 | slice 3: `main` runs under `around` |
| kalfa/cli/src/internal/print.ts | build | 5 | slice 3: the warning line |
| kalfa/cli/src/store.test.ts | tests | tests | slice 3, new: K9 |
| kalfa/AGENTS.md | build | docs | no change: it already says Diagnostics ranks below Configuration, and Configuration below CLI |
| vitest.config.ts | tests | tests | no change: its `kalfa/*/src/**/*.test.{ts,tsx}` and `kalfa/**/*.integration.test.{ts,tsx}` globs find the laws |
| kalfa/diagnostics/src/Package.test.ts | tests | tests | no change: read as the model for K14 and K15, D12's words included |
| kalfa/diagnostics/src/README.types.test.ts | tests | tests | no change: read as the model for K16's compile half |
| next/apps/fabrika/src/door-spans.test.ts | tests | tests | no change: read as the model for the recording tracer |
| oxlint-plugins/law-ids.ts | tests | tests | no change: run to see that `kalfa/cli` ids are free |
| oxlint-plugins/workspace-reach.ts | tests | tests | no change: read to learn that every kalfa package must be reached, which the root dev dependency answers |
| unreachable-ledger.json | tests | tests | no change expected: package `exports` targets are public to `pnpm lint:dead`. If it flags `bin.ts`, which only `bin` reaches, the step comes back to the plan, never to this ledger |

## Existing tools

- kalfa/cli/src/Subcommand.ts: searched `kalfa/records/src/cli.ts` and `kalfa/quality/src/cli.ts` (plain commands,
  no shape around them), `effect/cli`'s `Command.provide` (reused inside `make`) and `Command.isCommand` (reused in
  `isSubcommand`), `@kalfa/diagnostics/Diagnostic`'s `Code` (reused for the root-name rule) and its `Symbol.for` marks
  (the same idea). No package of ours gives a subcommand shape. New, about 75 lines.
- kalfa/cli/src/internal/manifest.ts: searched `kalfa/diagnostics/src/Package.test.ts`'s `Manifest` (a test's schema,
  not product code), `oxlint-plugins/workspace-reach.ts` (reads workspace manifests its own way, for lint) and npm's
  `read-package-up` and `@npmcli/package-json` (from memory; both read one manifest, neither lists direct
  dependencies with a field, and a dependency is one more edge for six lines of Schema). New, about 35 lines.
- kalfa/cli/src/internal/packages.ts: searched Node's `module.findPackageJSON` and `createRequire` (both used, probed
  above), `import.meta.resolve` (resolves from kalfa's own folder, which the ticket forbids), and Effect for a module
  loader (none). New, about 50 lines.
- kalfa/cli/src/internal/failure.ts: searched `kalfa/records/src/cli.ts`'s `Failed` (one count, no reasons) and
  `effect/cli`'s `CliError` (parse errors only). New, about 30 lines.
- kalfa/cli/src/internal/find.ts: searched `next/packages/libfabrika` for a manifest scan (none) and oclif's plugin
  loader (from memory; a whole framework). New, about 25 lines, plus 15 in slice 3.
- kalfa/cli/src/internal/load.ts: searched `effect/cli` for a loader of commands from modules (none) and
  `kalfa/records/src/bin.ts` (a static import); it calls `Packages.load` and `isSubcommand`, both from this plan. New,
  about 25 lines.
- kalfa/cli/src/internal/print.ts: searched `@kalfa/diagnostics`'s `formatPlace` (reused for the place), `JSON.stringify`
  (escapes `"` too, which the readable line does not want), `effect/cli`'s `CliOutput.defaultPresenter` and
  `layerPresenter` (reused: kalfa's presenter wraps the default for asked help and the version) and `TestConsole`
  (tests read it). New, about 60 lines.
- kalfa/cli/src/internal/run.ts: searched `kalfa/records/src/bin.ts` (the same teardown idea, for one command) and
  `effect/cli`'s `Command.runWith` (used). New, about 50 lines.
- kalfa/cli/src/internal/store.ts: searched `kalfa/telemetry` (a glossary only, no code yet), `@effect/opentelemetry`
  (installed; an OTLP exporter, which is the store's own business, not kalfa's) and Effect's `Layer.build` and `Scope`
  (used). New, about 60 lines.
- kalfa/cli/src/bin.ts: searched `kalfa/records/src/bin.ts` (followed: `runMain`, `disableErrorReporting`, a teardown).
  New, about 15 lines.
- kalfa/cli/rslib.config.ts: searched `kalfa/diagnostics/rslib.config.ts` and `kalfa/config/rslib.config.ts`;
  copied from the first.

## Calls taken

Each picks how the code does what the protocol, decision 0084, decision 0079 or the ticket already say. Those under
80% are at the top.

- **Three pull requests, the shape first.** 80%. The shape lands whole and small: a package can type-check its
  `subcommand`, Records' refit can start, and the field comes off before slice 2 would refuse it at this repo's root.
  The command itself is about 290 lines, and the store waits on nothing but the run.
- **`make` stores the command with its Layer given.** 80%. Under "What a package exports".
- **A root name is checked when `make` runs.** 80%. A code starts with its root name (Diagnostics' glossary, **Code**),
  so a root name a code cannot start with is a bug at the line that wrote it, as `Diagnostic.make` throws for a bad
  code. Ticket 2080 checks each listed code against it.
- **Every found subcommand is loaded on every run, all at once.** 80%. Help lists them all, and tickets 2078 and 2080
  check every root name and every code list before any handler runs, which needs each loaded. The cost: start time grows
  with each installed subcommand ("What this cannot tell us").
- **Help asked for goes to standard output; implicit help and a bad invocation's help to standard error.** 80%. Under
  "Printing".
- **A bare `kalfa`, or a subcommand with no handler, is a failure: exit code 2.** 80%. It could not finish what was
  asked; the glossary's three codes leave no other.
- **The store's build failure is silent; its load failure warns.** 80%, as the ticket splits them.
- **Unknown keys inside `kalfa` are left alone.** 80%. Tickets 2081 and later may add one, and an older `kalfa` should
  not refuse a newer package.
- **Direct dependencies are `dependencies`, `devDependencies` and `optionalDependencies`.** 85%. A peer is installed by
  someone else's choice; `pnpm` lists all three as the root's own.
- **`@kalfa/diagnostics` is a dependency; `effect` and `@effect/platform-node` are peers.** 80%. Under "The package".
- **Rank 2.** 80%. Under "The package".
- **Is this a setting?** No new choice is. The readable line has a machine twin in ticket 2079's `--format json`; the
  escape, the exit codes and the refusals are the same for every repo; how long a store waits is the store's setting.
  The root folder could become a flag later (open question 2), but `kalfa` reads no settings in this ticket: Config
  ranks below it only from ticket 2081.

## Where this departs from today's code

- Records and Code quality lose their `kalfa.cli` field, and the comments that say a future `kalfa` finds them through
  it. Records keeps `bin.ts`, which `pnpm lint` runs, until its refit.
- Nothing else of today's code changes.

## Validation

- Slice 1, tests step: `pnpm install --offline` for the new importer, then `nice -n 15 pnpm exec vitest run
  kalfa/cli/src/Subcommand.test.ts kalfa/cli/src/Package.test.ts oxlint-plugins/kalfa-manifests.test.ts
  oxlint-plugins/layers.test.ts` shows K11, K14 to K17 and the pinned table red on the branch head (no `Subcommand.ts`,
  the field still on Records).
- Slice 1, build step: the same paths green, each plant run once and undone; `pnpm format` and `pnpm lint`, which runs
  the layer, boundary and reach checks. `layer-rules.json` selects every test, so the build runs the named test files,
  never the changed set.
- Slice 2, tests step: `nice -n 15 pnpm exec vitest run kalfa/cli/src/run.test.ts kalfa/cli/src/Package.test.ts` shows
  K1 to K8, K18 and the bin part of K14 red. K12 is written, not run: the laptop refuses it by name.
- Slice 2, build step: the same paths green, each plant run once and undone; `pnpm format` and `pnpm lint`. Then the
  one-file try, in the build step's own scratch folder, nothing committed but the README's answer: an rslib config with
  `bundle: true` and `src/bin.ts` as its one entry, built there; the bundle run with `node <bundle> --help` in an empty
  folder; then in a scratch repo whose `node_modules` holds one subcommand importing its own `effect`. The README
  records what each run did, whether the bundle needs an install, and whether a found subcommand works beside the
  bundle's own copy of Effect.
- Slice 3, tests step: `nice -n 15 pnpm exec vitest run kalfa/cli/src/store.test.ts` shows K9 red.
- Slice 3, build step: that path and `kalfa/cli/src/run.test.ts` green, each plant run once and undone; `pnpm format`
  and `pnpm lint`.
- The lead runs the changed-tests run and one full type check for each slice (K10 is judged there), and K12 runs in CI
  or a proof run the lead starts; none of these runs in a box.

## Size

1. The shape a package exports: 95 lines (`Subcommand.ts` 75, `rslib.config.ts` 12, the two manifests 6, the two
   comments 2), plus four new test files, the rule rows, the lockfile
   and the README.
2. The command: 290 lines (`print.ts` 60, `packages.ts` 50, `run.ts` 50, `manifest.ts` 35, `failure.ts` 30, `find.ts`
   25, `load.ts` 25, `bin.ts` 15), plus three new test files, the bin in the manifest, the README sections and the
   glossary term.
3. The store: 110 lines (`store.ts` 60, `run.ts` 20, `find.ts` 15, `failure.ts` 10, `print.ts` 5), plus one new test
   file and the README section.

About 6 agent hours across the three slices' tests, build and review, 75% sure. The doubt is K9 and K12: K9 runs a
store's build and close around a run in nine ways, and K12's fixture repo links the workspace's folders into a temp
`node_modules`, which may take a round. Basis: the config plan's estimate of about $8 a step for Opus steps.
Steps: tests, build and review for each slice, plus one likely send-back of tests and build in slice 2.

Estimate: 11 steps, $88

## New names

- `Subcommand`, `make`, `isSubcommand`, `Platform` in `@kalfa/cli/Subcommand`: the protocol's own names, and
  `Platform` for Node's services as a type.
- `Packages`, `layerNode` in `internal/packages.ts`; `Manifest`, `Subpath`, `direct`, `specifier`, `root` in
  `internal/manifest.ts`; `Refused` and its reasons in `internal/failure.ts`; `escape`, `line`, `failure`,
  `diagnostics`, `presenter` in `internal/print.ts`; `Outcome` (`clean`, `reported`, `failed`), `exitCode`, `root`,
  `main` in `internal/run.ts`; `find`, `load`, `around` in `internal/store.ts`. Code names inside the package.
- `cli.run`, `cli.find`, `cli.load`, `cli.command`, `cli.print`, `cli.exit`: span names, `<package>.<call>` as the
  Telemetry glossary says. Attributes `kalfa.cli.package`, `kalfa.cli.root`, `kalfa.cli.version`,
  `kalfa.cli.reported.errors`, `kalfa.cli.reported.warnings`, and OpenTelemetry's `process.exit.code`.
- `kalfa-cli`: the layer row and the boundary type.
- `K1` to `K18`: law ids in `kalfa/cli`, which holds none yet (`node oxlint-plugins/law-ids.ts` passes on main).

## Records

- `kalfa/cli/GLOSSARY.md`, under Language:
  - **Readable line** (slice 2), new: "How the command prints one diagnostic by default: one line on standard error with
    its place, severity, code, message and hint, with no line break in it." _Avoid_: pretty output, human format, log
    line.
  - **Store** (slice 3), new, Telemetry's word as CLI uses it: "Where the command's finished spans go for one run. A
    direct dependency names the entry point that builds it in its `kalfa.spans` field; with none, the spans go nowhere."
    _Avoid_: span store, exporter, sink, backend.
- No other new domain word: subcommand, root name, failure and exit code are CLI's; diagnostic and its parts are
  Diagnostics'; span and attribute are Telemetry's; entry point, manifest and condition are Node's.
- `kalfa/cli/README.md`: a section per slice.
- No decision record: the protocol and decision 0084 settled the calls, and the calls under 80% change one function each
  before any caller exists.
- On https://github.com/kamp-us/tea-fabrika/issues/1893, the lead notes the one-file try's answer once slice 2 lands.

## What this cannot tell us

- Whether a piped output is cut at exit on macOS without the drain: CI runs on Linux, where pipes are synchronous, so
  K12 cannot turn red for it.
- How long `kalfa` takes to start with many installed subcommands: every law loads at most two, and none times a start.
- Node 26's `findPackageJSON`: the probe ran on Node 22.22.3. K12 runs on the repo's Node in CI.
- An exports map with a `require` condition before `default`: `createRequire(...).resolve` picks the `require` file,
  so `kalfa` imports the CommonJS file of a package that ships both. No kalfa package does; no law draws one.
- A store whose tracer throws inside a span's end: K9 draws stores that fail to load, build or close, not a tracer that
  throws while the run goes on. `kalfa` does not wrap the tracer.
- How effect/cli's `--wizard` and `--completions` behave under `kalfa`: they print through their own paths, not the
  presenter, and no law draws them.
- What the readable line looks like in a narrow terminal: it is one line, however long.

## Open questions

1. Readable line `<place>: <severity> <code>: <message> Hint: <hint>`, failure `kalfa: <message>`? Lean yes, 75%.
2. Repo root = current folder, not walk up to `.git`? Lean current folder, 70%.

## Lead's calls at signing (2026-11-23)

- Slice 1 starts now; it depends on neither open question. Slice 2 waits for the owner's answers to open questions 1 (the printed line shape) and 2 (where `kalfa` looks for `package.json`).
- Kept as leaned, each with its law: line breaks and control characters inside a printed line are escaped; a listed dependency that is not installed stops the start unless it is optional; a store module with no `layer` export only warns; `bin.ts` lets standard output finish before it exits; Ctrl-C ends with exit code 2; the one-file try is run in slice 2's build and reported either way.
- Finding (Effect's `runMain` calls `process.exit` on a non-zero code, which can cut piped output; Records' `bin.ts` has it too) is filed as its own issue. The config command's slice 2 does not wait on this ticket, per the plan's finding.

## Findings

1. **`runMain` may cut piped output on a non-zero exit on macOS.** `@effect/platform-node-shared`'s `NodeRuntime.ts`
   (line 67, Effect 4.1.3) calls `process.exit(code)` in its teardown for any code but 0. Node writes to a pipe
   asynchronously on macOS, so pending output can be lost. `kalfa/records/src/bin.ts` ends with exit code 1 the same
   way, so `node kalfa/records/src/bin.ts check | head` on a Mac may show fewer findings than were printed. This plan
   drains standard output in `kalfa`'s own `bin.ts`; Records' `bin.ts` is outside it and leaves with its refit.
2. **The config plan's "Not blocked by `@kalfa/cli`'s first build ticket" still holds.** `.kalfa/quests/kalfa-config-command-PLAN.md`
   on branch `fabrikalfa/kalfa-config-1846`, line 102, says `@kalfa/config/cli` exports a plain command that `kalfa`
   mounts. This plan needs nothing from it and gives it nothing it must wait for: the mount is ticket 2081's, which
   waits on both. So slice 2 of ticket 1846 waits only on the owner's answer about `get`, not on this ticket.
3. **The store's closing step needs its own limit.** Decision 0079 says a run with the app out of reach drops its spans
   and still runs. `kalfa` closes the store's Layer and waits for it, so a store that waits forever for an unreachable
   app would hold the command open. The Telemetry build ticket that writes the `kalfa.spans` entry should bound that
   wait with a setting of its own.

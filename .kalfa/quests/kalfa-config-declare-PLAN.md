Approved by the lead agent, builds issues 1749, 1806 and 1839, 0063, 0047; body 43e1842605bd
Plancheck-Version: 3

# Plan: declare a setting with a pipe, group it, and read it from the files

This is the kalfa packages, `kalfa/config`, new work. It is the first build ticket of
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749), with
[its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806), for
[ticket 1839](https://github.com/kamp-us/tea-fabrika/issues/1839). Words: `kalfa/config/GLOSSARY.md`.

A program declares each setting once with a pipe, puts its settings in a group, and reads them by
yielding the group. The group's layer starts it: the repo's minimum version, then each file whole,
then each value by precedence (environment variable, repo configuration, user configuration,
default), with the value's origin kept. A setting's value is plain data only: text, numbers,
booleans, and arrays and records of those, branded or not. Anything else does not compile, and each
start hands out its own deep-frozen copy. The new API sits beside today's twelve entry points, which
keep working and keep their callers. One pull request, about 700 product lines.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import { Setting, SettingGroup } from "@kalfa/config"

export const port = Setting.make("instance.port", Port).pipe(
  Setting.withDefault(18800),
  Setting.withDescription("The port the bot listens on."),
  Setting.files(["user"]),
)
export const approver = Setting.make("delivery.approver", Approver).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who may approve a change request."),
  Setting.live,
)
export const Demo = SettingGroup.make("demo", port, approver)

const program = Effect.gen(function* () {
  const { port, approver } = yield* Demo   // needs Demo's layer, or it does not compile
  port                                     // number: a restart setting is a plain value
  const now = yield* approver              // a live setting is a different type: yield it for its value now
})

program.pipe(
  Effect.provide(SettingGroup.layer(Demo, { version: "1.2.3" })),  // Layer<…, SettingsError, FileSystem | Path>
  Effect.provide(NodeServices.layer),
)
```

## The riskiest unknown goes first

The protocol left one doubt open: does TypeScript keep "a live setting reads as a different type,
a restart setting reads as a plain value" clean through `.pipe`? This plan settles it before any
runtime code.

- The tests step writes the type laws T1 to T5 first, in their own file.
- The build writes `Declaration.ts` and the types in `SettingGroup.ts` first, with every runtime
  body a stub, and gets T1 to T5 compiling before it writes the start.
- If a type law cannot be met as written, the build stops and sends it back to the plan with the
  compiler's message. It does not bend the law. The two known fallbacks are written below under
  "If `.pipe` loses the type", so a send-back is one short round.
- The build's one `pnpm typecheck` is at the end, as its skill says. The lead may allow one early
  `pnpm --filter @kalfa/config typecheck` in the build brief, right after the types land, so the
  doubt is settled in minutes rather than at the end. That is one package's compiler, not the repo's.

## How others do it

Read, unless marked "from memory".

- **Elm (from memory).** A program gets its start values as `flags` in `init`, and a value that
  changes while it runs reaches it as a subscription (`Sub`). That is our split exactly: a restart
  setting is a plain value given at start, and a live setting is a separate thing you listen to.
  Elm keeps the two apart in types, as T2 does here.
- **Erlang/OTP (from memory).** An application's environment has a default in its `.app` file, is
  overridden by `sys.config`, and is overridden again by `-App Key Value` on the command line. A
  change on a release upgrade reaches the application through its `config_change/3` callback. Same
  idea: one declared default, files over it, the command line on top, and a separate path for a
  change while running.
- **Effect 4.1.3, read in `node_modules/effect/src`.** `Config` and `ConfigProvider` hold the
  sources (`ConfigProvider.orElse`, `nested`, `constantCase`, and the `ConfigProvider` reference
  whose default reads the environment). `effect/cli`'s `Flag.Int("port").pipe(Flag.withDefault(8080),
  Flag.withDescription(…))` is the pipe shape we copy. `RpcGroup.make(...rpcs)` is the group shape.
  `Context.Service` is why a forgotten layer fails to compile. `Schema.withConstructorDefault<S>(value:
  S["~type.make.in"]) => (schema: S) => …` is how Effect types a default inside a pipe: the
  schema's type comes from the pipe, not from the value. `withDefault` here copies it. `Command.run(command,
  { version })` takes the running version at start, which `SettingGroup.layer` copies.
  `Schema.SemVerFromString` reads a version.
- **Viper, Go (from memory).** Precedence is flag, environment, config file, key/value store,
  default: the same order as our glossary's Precedence.
- **Figment, Rust (from memory).** Each value keeps metadata saying which provider gave it, the way
  Origin does here.
- **git, cargo (from memory).** A repo file and a user file, with environment variables on top. Both
  only warn on an unknown key. We stop the start instead, as the protocol decided.

On plain data only (Amendment 1):

- **Elm (from memory).** Flags may only be plain values: `Int`, `Float`, `String`, `Bool`, `Maybe`,
  lists, arrays, tuples, records, or a raw JSON value to decode. A JavaScript `Date` given as a flag
  fails at `init`. That is our rule, with the same split: the type says what may come in, and a check
  at the boundary refuses what slipped past it.
- **Erlang/OTP (from memory).** An application's environment holds terms, and every term is
  immutable, so a value one reader changes cannot exist. JavaScript has no such guarantee for a
  `Date` or a `Map`, so we keep the values to the kinds `Object.freeze` can make immutable.
- **Effect 4.1.3, read.** `Schema.Json` is the same idea as a type (null, numbers, booleans,
  strings, arrays and objects of those). `Schema.DurationFromString` and `Schema.URLFromString`
  decode text into a `Duration` or a `URL`, which is how a caller turns a text setting into one where
  it is read. Effect has no deep freeze.

## The shape

### Declaring a setting

```ts
// Sketch: kalfa/config/src/Declaration.ts, exported from the root as `Setting`.
// The file is not called Setting.ts because today's Setting.ts is an entry point that stays.
export type File = "repo" | "user"
export type Files = readonly [File, ...Array<File>]

export interface Setting<N extends string, A, L extends boolean = false> extends Pipeable {
  readonly [TypeId]: TypeId
  readonly name: N                          // "instance.port"
  readonly schema: Schema.Codec<A, unknown>
  readonly default: Option.Option<A>        // none: a required setting
  readonly description: string | undefined  // SettingGroup.make refuses undefined
  readonly files: Files                     // ["repo", "user"] unless Setting.files says less
  readonly live: L                          // false: a restart setting
  readonly fileOnly: boolean                // the mark; 1842 builds what it stops
}
export type Any = Setting<string, any, boolean>
export type Type<S extends Any> = S extends Setting<string, infer A, boolean> ? A : never

// The schema must decode to plain data (see "Plain data only" below), or the call does not compile.
export const make: <const N extends string, C extends Schema.Codec<any, unknown>>(
  name: N,
  schema: PlainSchema<C>,
) => Setting<N, C["Type"]>

// Each combinator gives back the same type it got, so the order in the pipe never matters.
export const withDefault: <S extends Any>(value: Type<S>) => (self: S) => S   // S comes from the pipe
export const withDescription: (text: string) => <S extends Any>(self: S) => S
export const files: (files: Files) => <S extends Any>(self: S) => S
export const fileOnly: <S extends Any>(self: S) => S
// The one combinator that changes the type: it turns the live mark on.
export const live: <N extends string, A>(self: Setting<N, A, false>) => Setting<N, A, true>
```

A `Setting` is not an Effect and cannot be yielded. It is read only through its group, so nothing
can read it from the environment alone and skip the files.

### Plain data only

The owner's rule (ticket 1839's last comment): a setting's schema must decode to plain data, which
is text, numbers, booleans, and arrays and records of those, branded or not. Why: the language cannot
freeze the inside of a `Date` or a `Map`, and a class instance default was one object shared by every
start, so a write in one start was read by the next. Configuration's protocol says no setter reaches
a caller; with plain data only, `Object.freeze` can hold that all the way down.

```ts
// Sketch: added to kalfa/config/src/Declaration.ts. A trial on this branch's head type-checked this
// shape with effect 4.1.3 and the package's tsconfig. Since then `null` left the first plain line
// and the message's wording changed, so the build checks it again. `Brand` is `import type * as
// Brand from "effect/Brand"`.

// Whether two types are the same type, not only assignable one way.
type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false

// Whether `T` was met before on this path, so a recursive type is checked once and not forever.
type Met<Seen, T> = true extends (Seen extends unknown ? Same<Seen, T> : never) ? true : false

/** The parts of a value's type that are not plain data, or `never` when all of it is. */
export type NotPlain<T, Seen = never> = 0 extends 1 & T
  ? T                                                     // `any` says nothing, so it is refused
  : Met<Seen, T> extends true
    ? never                                               // a recursive type, already being checked
    : T extends string | number | boolean
      ? never
      : T extends Brand.Brand<any>
        ? NotPlain<Brand.Brand.Unbranded<T>, Seen>        // a brand is judged by what it brands
        : T extends ReadonlyArray<infer E>
          ? NotPlain<E, Seen | T>
          : T extends { readonly [key: string]: unknown } // a class or an interface has no index signature
            ? { [K in keyof T]-?: NotPlain<T[K], Seen | T> }[keyof T]
            : T                                           // Date, Map, Duration, a Schema class, null, undefined: named whole

/** What a caller reads in the compiler's message: the part that is not plain data. */
export interface NotPlainData<A> {
  readonly "a setting's value must be plain data: text, numbers, booleans, and arrays and records of those": A
}

/** The schema as given when its value is plain data; else a type no schema meets, naming the part. */
export type PlainSchema<C extends Schema.Codec<any, unknown>> = [NotPlain<C["Type"]>] extends [never]
  ? C
  : C & NotPlainData<NotPlain<C["Type"]>>

export const make: <const N extends string, C extends Schema.Codec<any, unknown>>(
  name: N,
  schema: PlainSchema<C>,   // was: schema: C
) => Setting<N, C["Type"]>
```

`withDefault` does not change: its type comes from the setting in the pipe, so a default is plain
data too unless it is cast. The three types are exported from `Declaration.ts` (so `Setting.NotPlain`
and so on), because `make`'s public signature names them and the archive's declarations need them.

**What a caller sees.** Two lines at the schema argument, the second naming the part that is not
plain data, even when it is deep inside. From the trial, with the wording above put in:

```text
// Setting.make("delivery.since", Schema.Date)
error TS2345: Argument of type 'Date' is not assignable to parameter of type 'Date & NotPlainData<Date>'.
  Property '"a setting's value must be plain data: text, numbers, booleans, and arrays and records of those"' is missing in type 'Date' but required in type 'NotPlainData<Date>'.

// Setting.make("git.limits", Schema.Struct({ commits: Count, refs: Count, time: Schema.Duration }))
error TS2345: Argument of type 'Struct<{ readonly commits: Int; readonly refs: Int; readonly time: Duration; }>' is not assignable to parameter of type 'Struct<{ readonly commits: Int; readonly refs: Int; readonly time: Duration; }> & NotPlainData<Duration>'.
  Property '"a setting's value must be plain data: text, numbers, booleans, and arrays and records of those"' is missing in type 'Struct<{ ... }>' but required in type 'NotPlainData<Duration>'.
```

A bare `Schema.Duration` reads the same way with `Duration` on both sides. The other refusals name
`ReadonlyMap<string, number>`, `ReadonlySet<string>`, the class's name, `Utc` (a `DateTime.Utc`),
`URL`, `bigint`, `null`, `undefined`, `unknown` and `any`.

**What compiles and what does not.**

| Compiles | Does not compile |
|---|---|
| `String`, `Number`, `Boolean`, `Literals`, `NumberFromString` (its value is a number) | `Date`, `DateTimeUtc`, `Duration`, `URL`, `BigInt` |
| a branded string, a branded number, a branded record | `ReadonlyMap`, `ReadonlySet`, a `Schema.Class` instance |
| `Array`, `Tuple`, `Record(String, Number)`, a `Union` of `Struct`s | `Null`, `NullOr(String)`, `Option(String)`, `Unknown`, `Any` |
| a `Struct` with `Schema.optionalKey` | a `Struct` with `Schema.optional`, whose value may be `undefined` |
| a recursive tree written as a `type`, and two `type`s that refer to each other | a `Date` in an array of arrays, in nested records, in a recursive type |

Two costs, both chosen. A type written as an `interface` (`Schema.Opaque` included) is refused,
because an interface has no index signature and the type cannot tell it from a class; the caller
writes it as a `type`. And `Schema.optional` is refused, because `undefined` is not plain data and no
file or variable can write it; `Schema.optionalKey` is the spelling for a key that may be missing.

**A cast is refused at group make.** A cast can still put a class instance into a default, and
`Schema.is` does not catch it: `Schema.is(Record(String, Number))` accepts a `Map`, and a `Struct`
check accepts a `Date` that carries its keys. So `SettingGroup.make` refuses a default that is not
plain data all the way down, with its other refusals, before the "default its schema refuses" check,
so the message says what is wrong:

```text
Settings cannot be declared: delivery.since has a default that is not plain data (text, numbers, booleans, and arrays and records of those).
```

**What `internal/frozen.ts` may now assume.** The walk stays one function, and its job changes from
"freeze what you can" to "copy and freeze plain data, or say it is not":

```ts
// Sketch: kalfa/config/src/internal/frozen.ts after this amendment.
/** Plain data as it is at run time: what every setting's value is. */
export type Plain = string | number | boolean | ReadonlyArray<Plain> | { readonly [key: string]: Plain }

/**
 * A deep-frozen copy of a value, or none when some part of it is not plain data: a string, a number,
 * a boolean, an array whose prototype is Array.prototype, or an object whose prototype is
 * Object.prototype or null, each part checked all the way down.
 */
export const frozen: (value: unknown) => Option.Option<Plain>
```

- `SettingGroup.make` refuses a default whose `frozen` is none. That walk at make is the only
  extra cost, once per module load.
- The start calls `frozen` on every value it hands out, as the branch does now (start.ts line 337).
  For a default it is always some, since make checked it. For a value decoded from a file or a
  variable it is some too: a schema whose type is plain decodes into plain objects and arrays. Only a
  schema cast to lie about its type can decode something else, and then the start dies (a defect,
  not a `SettingsError`, since the program's author made it and no user can fix it), with the message
  `Settings cannot be declared: <name>'s schema gives a value that is not plain data. Only a cast
  schema can do that.` It never hands the value out.
- **The pass-through branch goes.** Today, "anything that is not a plain object or an array is kept
  as it is" (`frozen.ts` line 27). For any setting that compiles without a cast it is unreachable:
  make checks every default, and a plain schema decodes only plain data. It is not kept as a
  fallback, because handing a `Date` out as it is would bring back the shared-object fault; it is
  replaced by the none answer above. Text, numbers and booleans still come back as they are, since
  they are immutable already.

A length of time or an address is declared as text and decoded where it is read: the README gets
one short example (see Files). About sixteen drafted settings are of that kind, which the owner
accepted. A shared decoder for durations is its own ticket, not this one.

### Grouping and reading

```ts
// Sketch: kalfa/config/src/SettingGroup.ts, exported from the root as `SettingGroup`.
export interface Live<A> extends Effect.Effect<A> {   // yield it for the value now; 1841 adds `changes`
  readonly [LiveTypeId]: LiveTypeId
}

// A value's field is the last word of its name, hyphens joined: "delivery.carry-rule" is carryRule.
type Field<N extends string> = N extends `${string}.${infer Rest}` ? Field<Rest> : Joined<N>
type Joined<W extends string> = W extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<Joined<Tail>>}` : W

export type Read<S extends Setting.Any> = S["live"] extends true ? Live<Setting.Type<S>> : Setting.Type<S>
export type Values<R extends ReadonlyArray<Setting.Any>> = { readonly [S in R[number] as Field<S["name"]>]: Read<S> }

export interface Identifier<App extends string, R> {
  readonly [IdentifierId]: { readonly app: App; readonly settings: R }
}

export interface SettingGroup<App extends string, R extends ReadonlyArray<Setting.Any>>
  extends Effect.Effect<Values<R>, never, Identifier<App, R>> {
  readonly app: App
  readonly settings: R
}

export const make: <const App extends string, const R extends ReadonlyArray<Setting.Any>>(
  app: App,
  ...settings: R
) => SettingGroup<App, R>

export const layer: <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  options: { readonly version: string; readonly repo?: string },   // repo: the folder that holds .<app>/, "." by default
) => Layer.Layer<Identifier<App, R>, SettingsError, FileSystem.FileSystem | Path.Path>

export const origins: <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
) => Effect.Effect<Readonly<Record<R[number]["name"], Origin>>, never, Identifier<App, R>>

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  reason: Schema.Literals(["version", "syntax", "unknown", "scope", "invalid", "missing", "read"]),
  message: Schema.String,
  file: Schema.optional(Schema.String),   // as a person reads it: ".demo/demo.toml", "~/.demo/demo.toml"
  line: Schema.optional(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {}
```

- **The group is an Effect over an internal `Context` key.** The key's service holds the values and
  the origins. Yielding the group maps it to the values, so `yield* group` puts `Identifier<App, R>`
  in the requirements and a program without the layer does not compile. `origins(group)` reads the
  other half. The key string is `@kalfa/config/SettingGroup/<app>` followed by the setting names,
  so two groups of one app with different settings never share a slot.
- **`Origin` is today's `Sources.Origin`** (`default`, `flag`, `env`, `file` with `file` and
  `line`). It holds no value, so it holds no secret.
- **`SettingGroup.make` throws an `Error` at module load**, as today's `Setting.group` does, for: an
  app name that is not one lowercase word; a setting name segment that is not a lowercase letter or
  digit followed by lowercase letters, digits and hyphens; two settings with one field; two with one
  environment name; a name and its own table; a default that is not plain data (checked before the
  next one); a default its schema refuses; no description; and a name that is `<app>-version` or
  whose variable is `<APP>_HOME`.

### The start

`SettingGroup.layer(group, { version, repo })` runs this once, in a span named `config.layer`
(decision 0063), with the attribute `kalfa.config.app`. No value goes in the span.

1. Read `<repo>/.<app>/<app>.toml`, named `.<app>/<app>.toml`. A missing file counts as empty. Any
   other read failure is `read`, naming the file and never its text. A TOML error is `syntax`, with
   the file and the parser's line.
2. Check the minimum version, `<app>-version`, against `version`, both read with
   `Schema.SemVerFromString`. A value that is not a version is `invalid`; a newer one is `version`.
   Both name the file and line. Nothing of the user configuration has been read yet.
3. Check the repo configuration whole. Each file's schema is a `Schema.Struct` built from the
   settings whose file scope holds that file, decoded with `onExcessProperty: "error"` and each value
   through `Schema.toCodecJson(schema)`. The first issue becomes one error: `unknown` (with a guess
   within two edits, among keys this file may set), `scope` (the setting exists, in another file),
   or `invalid`. The error names the file and line. An unknown key's value is never shown.
4. Find the user configuration: `$<APP>_HOME/<app>.toml` when that variable is set, named
   `$<APP>_HOME/<app>.toml`; else `$HOME/.<app>/<app>.toml`, named `~/.<app>/<app>.toml`; with
   neither variable, there is no user configuration and it counts as empty. Read, parse and check
   it whole as in steps 1 and 3. `<app>-version` here is a `scope` error.
5. Resolve each setting by precedence over `ConfigProvider.orElse`: the environment (the current
   `ConfigProvider`, nested under the app and constant-cased, so `DEMO_INSTANCE_PORT`), then the repo
   configuration, then the user configuration (`ConfigProvider.fromUnknown` of each, through today's
   `Sources.file`), then the default. A file-only setting skips the environment. The origin is the
   first source that holds the key. A value present but refused is `invalid` naming its origin,
   and never falls back to the default. No value and no default is `missing`, naming the setting,
   its variable and its files.
6. Make the values. Each value is first made into its own deep-frozen copy with `frozen`, the
   default included, so the declaration's own default is never frozen and never handed out, and no
   reader's write reaches another reader or a later start. A restart setting's value is that copy, a
   live setting's value is a `Live` over a `SubscriptionRef` the layer owns, holding that copy. No
   setter reaches a caller. Keep the origins beside them, each frozen. A value `frozen` answers none
   for is a defect, as "Plain data only" says.

Every message ends with `<app> did not start.` and says "user configuration", never "person" or
"instance". Wording sketch, not pinned:

```text
.demo/demo.toml, line 3: there is no setting instance.prot. Did you mean instance.port?
  demo did not start.
.demo/demo.toml, line 2: instance.port may be set only in ~/.demo/demo.toml, or as DEMO_INSTANCE_PORT.
  demo did not start.
.demo/demo.toml, line 1: this repo needs demo 2.0.0 or newer. You have 1.2.3.
  demo did not start.
```

### If `.pipe` loses the type

Two fallbacks, in order, only if T1 to T5 cannot compile as written.

1. `withDefault` takes its type from the value, `<A>(value: A) => <N extends string, L extends
   boolean>(self: Setting<N, A, L>) => Setting<N, A, L>`. Cost: a default of a wider type, such as a
   plain number for a branded port, compiles and is caught at module load by the group's
   default check instead of by the compiler.
2. If the `live` mark is lost through the pipe, it moves to the constructor's options,
   `Setting.make(name, schema, { live: true })`. That departs from the protocol's sketch, so it
   goes to the owner before the build continues.

## One value traced

The group above, `version: "1.2.3"`, `repo` left as `"."`. The environment has `HOME=/people/one`
and nothing under `DEMO_`. The repo has no `.demo/demo.toml`. The user configuration is:

```toml
[instance]
port = 4100
```

1. `.demo/demo.toml` is missing: it counts as empty. No `demo-version`, so step 2 passes.
2. The repo configuration is empty, so step 3 passes.
3. `DEMO_HOME` is not set and `HOME` is, so the user configuration is
   `/people/one/.demo/demo.toml`, named `~/.demo/demo.toml`. It parses. `instance.port` is in
   `port`'s file scope and 4100 fits `Port`, so step 4 passes.
4. `port`: the environment has no `DEMO_INSTANCE_PORT`, the repo configuration has no key, the user
   configuration has it on line 2. Value 4100, origin `{ _tag: "file", file: "~/.demo/demo.toml", line: 2 }`.
5. `approver`: no source holds it. Value `"people"`, origin `{ _tag: "default" }`.
6. `yield* Demo` gives `{ port: 4100, approver: Live<"people"> }`, and `yield* approver` gives
   `"people"`. `SettingGroup.origins(Demo)` gives both origins, keyed `"instance.port"` and
   `"delivery.approver"`.

Now the same two lines are moved into the repo configuration instead. Step 3 finds `instance.port`
in a file outside its file scope and the layer fails with one `SettingsError`: `reason: "scope"`,
`file: ".demo/demo.toml"`, `line: 2`. The user configuration is never read. And with
`demo-version = "2.0.0"` on line 1 of the repo configuration, the layer fails at step 2 with
`reason: "version"`, before step 3, whatever else either file holds.

A table default, traced (Amendment 1). `pair = Setting.make("t0dflt.dpair", Pairing)` with
`withDefault(defaults.pair)`, where `defaults.pair` is `{ a: 1, b: 2 }`, and no source sets it.

1. `SettingGroup.make` walks `defaults.pair`: an object of `Object.prototype` holding two numbers,
   so `frozen` is some and the group makes. The walk's copy is dropped.
2. A start resolves the default, `{ a: 1, b: 2 }`, origin `{ _tag: "default" }`. `frozen` makes a
   new object, freezes it and hands that out. `defaults.pair` is not that object, and
   `Object.isFrozen(defaults.pair)` stays false.
3. A reader's `values.dpair.a = 9` throws a `TypeError` (modules are strict) and does not compile
   either (`readonly`). The next reader in the same start reads `a: 1`.
4. A second start makes its own copy, again from the unchanged `defaults.pair`.

And a cast: `Setting.make("delivery.since", Schema.String).pipe(Setting.withDefault(new Date(0) as
unknown as string), …)`. `Schema.is(Schema.String)` would refuse it anyway, but the plain check runs
first, so `SettingGroup.make` throws `Settings cannot be declared: delivery.since has a default that
is not plain data (…)` at module load, and no start ever runs.

## What fact is lost if it is not recorded now

Each value's origin. It exists only at the start, when the layer sees which source held the key.
If the layer dropped it, `config list` (1846) and snapshots (1845) could not say where a value came
from without loading again, and a value from a later edit would be blamed on the wrong source. So
the layer keeps the origins now, and `SettingGroup.origins` reads them. Nothing here is written to
disk, so nothing else is lost.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T1, the pipe keeps the declaration: `Setting.make("delivery.carry-rule", S)` piped through `withDefault`, `withDescription`, `files` and `fileOnly`, in each of several orders, has type `Setting<"delivery.carry-rule", S["Type"], false>`; with `live` anywhere in the chain it is `Setting<…, true>` | type | type | type `withDescription` as `(text) => (self: Setting.Any) => Setting.Any`: the name and the mark are lost, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T2, two reads that cannot be mixed up: in a group's values a restart setting's field is `A` and a live setting's field is `Live<A>`; `Live<A>` is not assignable to `A`, `A` is not assignable to `Live<A>`, and a restart field is not an Effect; the field is the last name word, hyphens joined (`carryRule`) | type | type | make `Read` give `A` for a live setting, or `Live<A>` an intersection with `A`: tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T3, the group needs its layer: `yield* group` puts `Identifier<App, R>` in the requirements, an Effect that still needs it does not extend `Effect<_, _, never>`, and after `Effect.provide(SettingGroup.layer(group, { version }))` only `FileSystem` and `Path` remain | type | type | make the group a `Config` that reads the current provider (requirements `never`): tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T4, what does not compile: a default of the wrong type, `files([])`, `files(["person"])`, `live` on a live setting, and `yield*` of a bare `Setting`, each under `@ts-expect-error` | type | type | type `files` as `(files: ReadonlyArray<string>)`: the `@ts-expect-error` is unused, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T5, the error and the words: the layer's error type is exactly `SettingsError`, its `reason` is the seven literals, and `Setting.File` is exactly `"repo" or "user"` | type | type | add `"person"` to `File`: tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T6, plain data only: `Setting.make` compiles with a branded string, a branded record, a `Record(String, Number)`, a `Struct` with an `optionalKey`, a checked-text length of time (the README's form) and a recursive tree written as a `type`; each of `Date`, `ReadonlyMap`, a `Schema.Class`, `DateTimeUtc`, `Duration`, `Null`, `Any`, a `Struct` with `Schema.optional`, a `Date` in nested `optionalKey` records and a recursive type with a `Date` inside is a line under `@ts-expect-error`; `Setting.NotPlain` of `Date` is exactly `Date`, of a struct holding a `Duration` exactly `Duration`, and of a plain record `never` | type | type | (a) type `make`'s schema as `C` again: every refused line compiles, tsc red; (b) drop the brand line: the branded record is refused, tsc red; (c) drop the "met before" check: the recursive tree fails as circular, tsc red; (d) compare with "assignable one way" in place of `Same`: the `Date` in nested records compiles, tsc red; (e) answer `T` whole at the record line: the `Duration` pin fails, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| B1, precedence and origin: for generated groups of one to four settings and a generated place for each value (environment, repo, user, several, or none), each value is the first of environment, repo, user that holds it, else its default, and its origin names that variable, that file and line, or default. 100 runs | test | Effect Arbitrary: Placement | (a) chain user before repo: B1 red; (b) take the origin from the last source that holds the key: B1 red | kalfa/config/src/SettingGroup.test.ts |
| B2, the minimum version first: for generated running and wanted versions, a newer wanted version fails `version` with the repo file and its line, and the user configuration is never read (recorded file calls), even when it does not parse; an older or equal one starts; a value that is not a version fails `invalid`. 100 runs | test | Effect Arbitrary: VersionCase | read the user configuration before the version check: B2 red | kalfa/config/src/SettingGroup.test.ts |
| B3, one error, in order: given generated faults in the repo file, the user file and the environment at once, the layer fails with exactly one `SettingsError`, and it is the repo file's when it has one, else the user file's, else the environment's. 100 runs | test | Effect Arbitrary: FaultCase | check the user configuration before the repo configuration: B3 red | kalfa/config/src/SettingGroup.test.ts |
| B4, a mistyped key stops the start: in either file, a generated key within two edits of a setting that file may set fails `unknown` with that file, its line and the guess; a key farther away fails `unknown` with no guess; a guess never names a setting the file may not set. 100 runs | test | Effect Arbitrary: Typo | guess among every setting, file scope ignored: B4 red | kalfa/config/src/SettingGroup.test.ts |
| B5, file scope: a generated setting found in a file outside its file scope fails `scope` with that file and line, naming where it may be set (its files, and its variable unless it is file-only); `<app>-version` in the user file is a `scope` error too. 100 runs | test | Effect Arbitrary: ScopeCase | build each file's schema from every setting, file scope ignored: B5 red | kalfa/config/src/SettingGroup.test.ts |
| B6, a refused value never becomes the default: a generated value its schema refuses, in a file or in the environment, an empty array or table included, fails `invalid` naming the file and line or the variable. 100 runs | test | Effect Arbitrary: Refused | fall back to the default on any decode failure: B6 red | kalfa/config/src/SettingGroup.test.ts |
| B7, a required setting: a setting with no default and no source fails `missing`, naming the setting, its variable and its files; given any one source it reads that value | test | scenario: one required setting, absent, then in each source in turn | give a required setting `undefined` when absent: B7 red | kalfa/config/src/SettingGroup.test.ts |
| B8 [secrets], values stay out: a generated secret-looking value under an unknown key, a mistyped key, a table, or another app's variable never appears in the error's message, its cause, the `config.layer` span's attributes, or a log line. 100 runs | test | Effect Arbitrary: Hidden | print the unknown key's value in the message: B8 red | kalfa/config/src/SettingGroup.test.ts |
| B9, a group that cannot be read is refused at make: each refusal in "Grouping and reading" throws an `Error` naming the setting or settings, for generated names and pairs; a group with none of them makes. 100 runs | test | Effect Arbitrary: BadGroup | drop the one-field check: two settings ending in `port` make a group, B9 red | kalfa/config/src/SettingGroup.test.ts |
| B10, a file-only setting skips the environment: with its variable set to a generated valid value, a file-only setting reads from the files or its default, and its origin is never `env`. 100 runs | test | Effect Arbitrary: Placement | read the environment for every setting: B10 red | kalfa/config/src/SettingGroup.test.ts |
| B11, a live setting gives its value now: yielding a live field gives the resolved value from each source in turn, and its origin is the one a restart setting with the same place gets | test | scenario: one live and one restart setting, placed in each source in turn | build every `Live` from the default: B11 red | kalfa/config/src/SettingGroup.test.ts |
| B12, missing and unreadable files: a missing file counts as empty; a generated other read failure (permission, busy, unknown) fails `read`, naming the file and never its text. 100 runs | test | Effect Arbitrary: ReadFault | count every read failure as empty: B12 red | kalfa/config/src/SettingGroup.test.ts |
| B13, where the user configuration is: with `<APP>_HOME` set it is `$<APP>_HOME/<app>.toml`; else with `HOME` set it is `$HOME/.<app>/<app>.toml`; with neither no user file is read; another app's `<OTHER>_HOME` is never read. 100 runs | test | Effect Arbitrary: HomeCase | read `HOME` before `<APP>_HOME`: B13 red | kalfa/config/src/SettingGroup.test.ts |
| B14, a file that is not TOML: a generated broken file, repo or user, fails `syntax` with that file and the parser's line. 100 runs | test | Effect Arbitrary: Broken | report line 0: B14 red | kalfa/config/src/SettingGroup.test.ts |
| B15, the words: for every generated fault in B3, the message ends with `<app> did not start.` and holds neither `person` nor `instance`. 100 runs | test | Effect Arbitrary: FaultCase | end messages with today's `Files.STOP`: B15 red | kalfa/config/src/SettingGroup.test.ts |
| B16 [protocol], first property, as on the branch: a started group gives a caller no reference to a live value, and no write to its values, its origins or a `Live` changes what a later reader gets. 100 runs | test | Effect Arbitrary: Tampering | (a) keep the `Live`'s reference in a plain `private` property; (b) leave the values object writable; (c) leave the origins object writable; (d) leave the `Live` itself writable: each B16 red | kalfa/config/src/SettingGroup.test.ts |
| B16 [protocol], second property, gains one line: no write to a table value, an array value, an origin or the value a `Live` yields changes what a later reader or a later start gets, the declaration's defaults stay equal to what they were, and (new) `Object.isFrozen` is false for each object the declaration holds as a default (`defaults.pair`, `defaults.tags`, `defaults.lpair`) after both starts. 100 runs | test | Effect Arbitrary: Nested | (a) to (e) as on the branch; (f, new) deep-freeze the declaration's own default in place and hand it out: every write still throws and every value still matches, so the law is green today under this plant, and the new `isFrozen` line turns it red | kalfa/config/src/SettingGroup.test.ts |
| B17, a default that is not plain data is refused at make: for a generated kind (`Date`, `Map`, `Set`, a class instance, `null`, `undefined`, a function) placed at a generated depth of 0 to 2 inside records and arrays, and cast past the type onto a schema whose check accepts it (a `Map` onto `Record(String, Number)`), `SettingGroup.make` throws an `Error` whose message names the setting and says `plain data`; the same group with the plain value in its place makes. 100 runs | test | Effect Arbitrary: NotPlainDefault | (a) drop the plain check: the `Map` passes the schema check and the group makes, B17 red; (b) check only the top level: a `Date` one level down makes a group, B17 red | kalfa/config/src/SettingGroup.test.ts |
| B17, second property, a cast schema cannot hand out a class instance: a setting whose schema is `Schema.Date` cast to a text schema (any class-valued schema that decodes from TOML will do), with its value in the repo file, makes its group, and the layer dies (a defect, not a `SettingsError`) naming the setting | test | scenario: one cast schema, its value in the repo file | hand the value out as it is when `frozen` answers none: the layer starts, B17 red | kalfa/config/src/SettingGroup.test.ts |
| R1, the in-memory file system tells the truth: on a real temp folder through `NodeServices`, three cases (no files; a user file with a value on line 2; a repo file with a mistyped key) give the same values, origins and error as the same cases in memory | test | scenario: three cases on a temp folder, then the same three in memory | build the repo path without the `.<app>` folder: R1 red | kalfa/config/src/SettingGroup.integration.test.ts |
| L1, the new code imports no kalfa package: the existing package rule (`kalfa-config` may import only the test package) holds the new files | lint | lint | import `@kalfa/records/Finding` in `SettingGroup.ts`: `pnpm lint` red | boundary-rules.json |
| P1, the root entry ships: the installed archive maps `.` to `dist/index.js` and `dist/index.d.ts`, the consumer imports `Setting` and `SettingGroup` from `@kalfa/config` and compiles, and CI keeps a receipt only when its exports hold `.` and the twelve old ones | test | scenario: the packed archive installed outside the workspace, and receipts with and without `.` | drop `.` from the published exports: the package law red; keep a receipt without `.`: the selection law red | kalfa/config/src/Package.integration.test.ts, .github/ci/related-selection.test.ts |
| O1, today's API is unchanged: today's laws for the old entry points stay green with no edit, after the pure helpers move out of `Files.ts` | test | pinned: today's K1 to K5 laws and the package consumer law, unchanged | (already planted) | kalfa/config/src/App.test.ts, scripts/kalfa-config.test.ts |

**Lint, type or test?** T1 to T6 are shapes the compiler sees: type. L1 is a shape of imports, and
a rule already holds it: lint. B1 to B17, R1, P1 and O1 are about what a start answers and what an
archive holds, which no type or lint rule sees: tests. Plain data is held twice on purpose: T6 for
every caller who does not cast, B17 for one who does. B16's new line is a test because only a run
can see whether the object a caller declared was frozen.

**One existing test changes for T6.** `Pairing` and `Nesting` in
`kalfa/config/src/SettingGroup.test.ts` (lines 399 and 401) use `Schema.optional`. Their value type
holds `undefined`, which is not plain data, so `Setting.make` with them stops compiling and B1's
table-valued law and B16's second property with it. The tests step changes both to
`Schema.optionalKey`, which says what the laws mean (a key a file may leave out). Decoding is the
same for every value a file or a default gives them; the trial ran both laws green with the change. No new lint rule: the "person" word in the
new files' prose is held by T5 for the type and B15 for every message, and the review reads the
rest. Once 1849 makes the whole package say "user", a word rule over the package becomes worth
writing; not before, since it would fire on today's files.

**Where they run.** T1 to T6 are judged by the compiler; vitest runs their file too. B1 to B17 run
on the in-memory file system in `kalfa/config/src/MemoryFiles.test-support.ts`, on every pull
request. R1 touches a real temp folder, so it is a `.integration.` file: it runs in main's full run,
and the tests and build steps run it narrowly on the laptop. No stand-in will do for R1, because its
one job is to check the stand-in. P1 builds, packs and installs, so it runs in main's full run, as
it does today. No law is host-only: none needs launchd, a signal, a socket or the real app.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/Declaration.ts | build | 195 | new: `Setting`, `make` and the five combinators, `File`, `Files`, `Any`, `Type`; Amendment 1 adds `NotPlain`, `NotPlainData`, `PlainSchema` and `make`'s `PlainSchema<C>` parameter, about 45 lines |
| kalfa/config/src/SettingGroup.ts | build | 175 | new: `make` and its refusals, `layer`, `origins`, `Live`, `Read`, `Values`, `Identifier`, `SettingsError`; Amendment 1 adds the plain-data refusal ahead of the schema check, and its line in `make`'s doc comment |
| kalfa/config/src/internal/start.ts | build | 245 | new: read both files, the minimum version, the whole-file check, the precedence resolve, the values and origins; Amendment 1: a value `frozen` answers none for is a defect |
| kalfa/config/src/internal/frozen.ts | build | 35 | on the branch: the deep-frozen copy; Amendment 1: `Plain`, and `frozen` answers an `Option`, none for a part that is not plain data, in place of passing it through |
| kalfa/config/src/internal/document.ts | build | 70 | new: the pure document helpers moved out of `Files.ts` (value at a path, first leaf, located line, shown shape, edit distance) |
| kalfa/config/src/Files.ts | build | -60 | imports the moved helpers; behavior unchanged |
| kalfa/config/src/index.ts | build | 12 | new: the root entry, `export * as Setting` and `export * as SettingGroup` |
| kalfa/config/package.json | build | 8 | `.` in `exports` and in `publishConfig.exports`; the twelve old entries stay |
| kalfa/config/GLOSSARY.md | build | docs | new terms **Setting group** and **Required setting**; Amendment 1: **Setting** says its value is plain data |
| kalfa/config/README.md | build | docs | Amendment 1: one short section, a length of time or a URL is declared as text and decoded where it is read |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | T1 to T5, written first; Amendment 1: T6 |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | B1 to B17; Amendment 1: B16's `isFrozen` line, B17, and `Pairing` and `Nesting` on `Schema.optionalKey` |
| kalfa/config/src/SettingGroup.integration.test.ts | tests | tests | R1 |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | new: a file system held in memory, with planted read failures; its calls recorded with `Recorder` from `@kampus/vitest` |
| kalfa/config/src/Package.integration.test.ts | tests | tests | P1: `.` beside the twelve modules, mapped to `dist/index` |
| kalfa/config/test/consumer.mjs | tests | tests | P1: imports and runs the root entry |
| kalfa/config/test/consumer.ts | tests | tests | P1: the root entry's declarations |
| .github/ci/related.ts | tests | 3 | P1: the receipt check's export list gains `.` |
| .github/ci/related-selection.test.ts | tests | tests | P1: the receipt fixture gains `.`, and a receipt without it is refused |
| kalfa/config/src/App.test.ts | tests | tests | O1: no change, stays green |
| scripts/kalfa-config.test.ts | tests | tests | O1: no change, stays green |
| boundary-rules.json | tests | tests | L1: no change, the rule that holds it |

The README keeps its description of today's API, which 1849 rewrites for the new one. Amendment 1
adds one short section after "Declare and load settings", because the plain-data rule is the one
thing a caller of the new API trips on first. Its text, as the build writes it (the example is
T6's checked-text case, so the compiler has read it):

````md
## A setting's value is plain data

A setting made with `Setting.make` from `@kalfa/config` holds plain data only: text, numbers,
booleans, and arrays and records of those, branded or not. A `Date`, a `Duration`, a `URL`, a `Map`
or a class does not compile. Declare a length of time or an address as text, and decode it where it
is read:

```ts
import { Setting } from "@kalfa/config";
import { Option, Schema } from "effect";

// Checked when the app starts, so "ten" stops the start with its file and line.
const Wait = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      Option.isSome(Schema.decodeUnknownOption(Schema.DurationFromString)(text)) || "a length of time, as 10 seconds",
  ),
);

export const branchWait = Setting.make("delivery.branch-wait", Wait).pipe(
  Setting.withDefault("10 seconds"),
  Setting.withDescription("How long a landing waits for its branch."),
);

// Where it is read: const wait = Schema.decodeSync(Schema.DurationFromString)(values.branchWait)
```

A URL works the same way, with `Schema.URLFromString` where it is read.
````

A README edit runs the archive law P1 in main's full run; nothing in P1 reads this text.

## Existing tools

- kalfa/config/src/Declaration.ts: searched today's `kalfa/config/src/Setting.ts` (an options
  object, carries an `App`, is a `Config` anyone can yield, says `person`; it keeps its callers, so
  it cannot change), `effect/cli`'s `Flag` (a command-line param, with no file scope or live mark)
  and Effect's `Config` (no metadata). None fits, so a new module. It uses Effect's `Pipeable` and
  `pipeArguments` for `.pipe`, and copies `Schema.withConstructorDefault`'s typing for `withDefault`.
- kalfa/config/src/SettingGroup.ts: searched `RpcGroup.make` (the shape copied), `Context.Service`
  (the key, used as is), `Effectable` and `Effect.map` over a key (how the group is yieldable),
  `SubscriptionRef` (the live value now, used as is), `Layer.effect`, `Schema.TaggedError`, and
  today's `Files.SettingsError` (its message ends "The instance did not start." and its reasons
  have no `missing`; old callers keep it, so a new class). New code over those.
- kalfa/config/src/internal/start.ts: searched today's `Load.ts`, `Files.ts` and `Sources.ts`. They
  take today's group and say `person` and `instance`, and their callers stay, so the start is new.
  It reuses `Sources.file`, `Sources.Origin`, the `Toml` service and `TomlParser.layer` as they are,
  Effect's `ConfigProvider` (`orElse`, `nested`, `constantCase`, `fromUnknown`), `Config.schema`,
  `Schema.toCodecJson`, `Schema.SemVerFromString` (in place of today's hand-written `Files.newer`),
  and `Path` from Effect. The field name rule is a three-line function, because Effect's
  `String.camelCase` also splits letters from digits, which the type-level `Field` cannot follow.
- kalfa/config/src/internal/document.ts: searched for these helpers outside `Files.ts`: none in the
  package, none in Effect (Effect's own "did you mean" is in `effect/cli/internal`, which its
  exports close off). Moved, not copied, so the old and new checks share one copy.
- `NotPlain`, `NotPlainData` and `PlainSchema` in kalfa/config/src/Declaration.ts (Amendment 1):
  searched Effect 4.1.3 for a plain-data type. `Schema.Json` is one, and a bound
  `C extends Schema.Codec<Schema.Json, unknown>` was tried in the trial: it lets `null` in, refuses a
  branded record, and gives a seven-line message about `annotate` that never names the part. No
  package in the lockfile has a type that names the part. So a new type, about 45 lines.
- kalfa/config/src/internal/frozen.ts (Amendment 1 changes it): searched Effect for a deep freeze
  or a plain-object check. `Predicate.isObject` only says "an object, not an array", and
  `structuredClone` copies a `Date` and a `Map` without freezing them. None fits, so the branch's
  own walk stays and answers an `Option`. It is one walk for both jobs, so make and the start can
  never disagree on what plain data is.
- kalfa/config/src/index.ts: searched the package for a root barrel: none. Effect's own `index.ts`
  barrels are the shape. It is needed because the dead-exports check counts a module as public only
  when an export target reaches it, and every new function would otherwise be "only called from
  tests".

## Calls taken

Each picks how the code does what a note already says.

- **The root entry `.` lands now, with the export lists CI checks.** 90% sure. The dead-exports
  lint fails every new function no export target reaches, and the CI receipt check refuses an
  archive whose exports differ from its list, so the entry and the lists move together. The root
  is one of the protocol's two entry points. 1847 moves the callers; this ticket only adds.
- **The new `Setting` module's file is `Declaration.ts`.** 80% sure. Today's `Setting.ts` is an
  entry point that stays. 1849 deletes it and can `git mv` this file into its place.
- **A field is the last word of the name, hyphens joined.** 80% sure. The protocol's sketch
  destructures `{ port, approver }` from `instance.port` and `delivery.approver` with a variadic
  `make` copied from `RpcGroup.make`, and this is the one rule that gives that. A clash throws at make.
- **`layer` takes `{ version, repo }`.** 80% sure. The sketch passes only the group, but the minimum
  version needs the running version, and Effect's `Command.run` takes it at start the same way.
  `repo` defaults to the current folder, as git and cargo start from it. The doubt: fabrika selects
  a repo, and today it can start with none; whether that needs `repo: null` is 1848's to say.
- **The environment and `HOME` come from Effect's current `ConfigProvider`.** 85% sure. The
  protocol makes Configuration a thin wrapper over it; a test sets it with `ConfigProvider.layer`.
  One difference from today: Effect's default provider counts an empty variable as unset, where
  today's record source keeps it as a value.
- **No `HOME` and no `<APP>_HOME` means no user configuration.** 80% sure. The glossary puts the
  user configuration in a person's config home; with no home there is no such file. Stopping the
  start there would stop a program in a bare environment over a file that cannot exist.
- **A setting with no default is a required setting.** 85% sure. Effect's `Config` and `Flag` both
  treat a missing value with no default as an error, and today's Stryker `catalog` setting needs it.
- **A description is required, checked at make.** 80% sure. The glossary says a setting has "a
  sentence a person reads". A type parameter for it would add to the `.pipe` risk, so it is a
  module-load throw, like today's group checks.
- **`Live` is an Effect for the value now, over a `SubscriptionRef` the layer owns.** 80% sure.
  Criterion 3 needs the live type to exist and be readable here; 1841 adds `changes` and the file
  watcher that writes to the ref, with no change to the type a caller holds.
- **A file-only setting skips the environment here; the stop is 1842's.** 75% sure. Reading the
  variable now would ship a mark that does nothing until 1842. Skipping it is the safer interim
  state: no one can go around a change request in between. The doubt: skipping is the "quiet ignore"
  1806 ruled against; it lasts only until 1842 adds the stop.
- **The order is the repo configuration whole, then the user configuration whole, then the
  sources.** 85% sure. It is the protocol's order, with one change from today's code, which parses
  the user file before it checks the repo file. A repo fault is now always reported first (B3).
- **The precedence resolve runs over `ConfigProvider.orElse`,** as the protocol says it stays, with
  each file checked whole first through the JSON codec, as today. 85% sure.
- **A new `SettingsError` with `file` and `line` fields.** 80% sure. Today's class says "instance"
  and lacks `missing`, and old callers keep it. The fields let a law, and later 1846's list and
  decision 0084's diagnostic, read the place without parsing text.
- **`origins(group)` is a new public call.** 75% sure. It is not in the protocol's sketch, but
  "records its origin" needs a reader, and 1845 and 1846 read the same thing. The doubt: 1846 might
  rather read origins through its own command; then this call stays as the plain call under it.
- **Dropped from today's declaration: `format` and `since`.** 80% sure. Neither is in the
  protocol. No caller of the new API needs the text format, and `since` is a release fact git
  history already holds. Either can come back as a combinator.
- **The minimum version is read with `Schema.SemVerFromString`.** 85% sure. Effect ships it
  ("reach for what ships"), and it orders prerelease versions, which today's three-number compare
  does not.
- **The span is `config.layer` with `kalfa.config.app`.** 85% sure, from decision 0063's
  `<package>.<call>` rule. No value goes in a span (B8).
- **`null` and `undefined` are not plain data** (Amendment 1). 85% sure. The owner's list names
  neither, no file or variable can write either, and `Schema.optionalKey` already says "a key that
  may be missing". The trial allowed `null`; this plan follows the owner's words and drops it.
- **The schema parameter is `PlainSchema<C>`, not a bound on `C`.** 85% sure. The trial tried the
  bound and dropped it: its message never names the part and it refuses a branded record.
- **One walk, in `frozen.ts`, answers both "is it plain" and "the frozen copy".** 80% sure. Make
  and the start then share one definition. The walk at make copies and drops the copy; that costs
  microseconds once per module load.
- **A decoded value that is not plain data is a defect, not a `SettingsError`.** 75% sure. Only a
  schema cast to lie about its type gets there, which is the author's bug, as make's throw is. The
  doubt: a `SettingsError` would show in the same place as the other faults; but no user can fix
  it, and T3 and T5 keep the layer's error type exactly `SettingsError` with its seven reasons.
- **An `interface` value type is refused.** 80% sure. The type cannot tell it from a class; a
  caller writes a `type`. Loosening it later is easy, so it is not a trap.
- **"Plain data" is said in the Setting entry, not a term of its own.** 75% sure. It is one
  sentence that defines it where a reader looks first; a separate entry would repeat it.
- **Is this a setting?** No new choice is. Plain data only is the owner's rule, not a choice a
  person makes at run time. The field rule and the order are what the API is. The
  two-edit guess is a message detail. The repo folder and the version are given by the app at
  start, and settings are read from those files, so they cannot be settings themselves.

## Where this departs from today's code

Today's code is reference only. Each line is a planned difference, all in new files; today's
files keep their behavior.

- An options object becomes a pipe of combinators, and `Setting.make` no longer takes an `App`.
- `person` becomes `user` (`Setting.files(["user"])`, messages, origins).
- `reload: "live" | "restart"` becomes the `Setting.live` mark, a type the read side can see.
- `scope` becomes `Setting.files`, defaulting to both files.
- A setting is no longer a `Config` anyone can yield; only the group reads it, through its layer.
- `default` may be absent (a required setting); `format` and `since` are gone.
- `Load.load(group, { repo, home, flags, env, version })` becomes `SettingGroup.layer(group, {
  version, repo })`; `home` and the environment come from the current `ConfigProvider`.
- The repo file is checked whole before the user file is read.
- Messages end with `<app> did not start.` and no longer point to a list command.
- No snapshot is made here (1845), so the start needs no `Digest`.
- A setting's value is plain data only, and each start hands out its own deep-frozen copy. Today's
  `Setting.make` takes any schema and hands out the value as decoded.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `kalfa/config/src/SettingGroup.test.ts` and `kalfa/config/src/SettingGroup.integration.test.ts`
  shows each law red on main; the type laws are written and named as judged by the build's compiler
  run.
- Build step: the same paths green, `kalfa/config/src/App.test.ts` and
  `.github/ci/related-selection.test.ts` still green, each plant red once.
- Amendment 1 round: the tests step writes T6, B16's new line and B17, and changes `Pairing` and
  `Nesting`; it shows B16's new line and B17 red on the branch head. T6 is judged by the compiler
  run the lead allows in the build brief (`pnpm --filter @kalfa/config typecheck`, one package), as
  for T1 to T5. The build makes them green and runs each new plant once.
- The lead runs `--changed origin/main` and one `pnpm typecheck`. P1 runs in main's full run.

## Size

1. One pull request: about 700 product lines (the start 245, `SettingGroup.ts` 175,
   `Declaration.ts` 195, `frozen.ts` 35, the moved helpers 70 less the 60 that leave `Files.ts`,
   the root and the manifest 20, `related.ts` 3), plus four test files, the consumer edits, and the
   README and glossary lines. It lands whole: the declaration has no reader without the group, and
   the group has nothing to read without the start. Amendment 1's part is about 65 of those lines.

About 4 agent hours across the first steps, and about 1.5 more for Amendment 1's round, 75% sure.
The doubt is T6: a schema kind the trial did not try could be refused wrongly, which would send one
case back. Budget basis: the monitor plan, `.kalfa/quests/watch-PLAN.md`, at about 540 product
lines, 6 steps and $40. This quest has spent about 11 steps (plan, four test rounds, four build
rounds, three reviews, give or take one); Amendment 1 adds tests, build and review, and one likely
send-back.

Estimate: 15 steps, $120

## Records

- Glossary terms in this pull request, in `kalfa/config/GLOSSARY.md`:
  - **Setting group**: the settings one program reads together, under one app; a program reads its
    group only through the group's layer, which starts it. _Avoid_: config object, settings bag,
    namespace.
  - **Required setting**: a setting with no default; the start stops when no source gives it.
    _Avoid_: mandatory setting.
  - **Setting**, changed by Amendment 1, to read: "One named value an app declares once, with its
    type, its default and a sentence a person reads. Its value is plain data: text, numbers,
    booleans, and arrays and records of those. It may hold a secret's name, never a secret's
    value." Its _Avoid_ line stays.
- No decision record for the calls above: each applies the protocol, and none is hard to undo
  before 1847 moves a caller.
- **Plain data only is owed a decision record, I lean, 70% sure.** The repo's three tests: it is
  surprising (a reader will ask why `Schema.Duration` cannot be a setting, and may "fix" it by
  loosening the type, which brings the shared-object fault back); it was a real trade-off (copy and
  freeze what can be frozen, and write down the rest as a known limit, against plain data only at
  the cost of about sixteen drafted settings written as text); and it gets harder to undo with each
  caller, since every length of time is then written as text with a decode at its read. The doubt
  is "hard to reverse": before 1847 no caller exists, and widening the type later is cheap in code.
  What settles it: whether the lead counts the drafted settings as callers. The record is the lead's
  to write, from the owner's comment on 1839; this plan does not write it.
- No pattern doc yet: `.kalfa/patterns/settings.md` describes today's shape, which stays until
  1849. The new shape gets its doc when its first caller lands.

## What this cannot tell us

- Whether one flag per setting clutters `--help` (1840), or how the file watcher times on macOS and
  Linux (1841). Neither is built here.
- Whether the last-word field rule clashes in real groups. Delivery's twenty-odd settings are the
  first real test; a clash throws at module load, so it cannot hide.
- Whether fabrika's start with no repo selected fits `repo` as an optional folder (1848).
- Whether the double decode of file values (the whole-file check through the JSON codec, the
  resolve through `Config`'s string tree) ever disagrees. Today's code does the same and its laws
  pass; B1 and B6 would show a case.
- Windows, where the home is not `HOME`. Nothing here runs there yet.
- Whether T6 refuses or lets in a schema kind no one tried: `Schema.declare` with a made-up type, a
  template literal, `Schema.Enum`, `Schema.TaggedClass` or `ErrorClass`, a very deep recursive type.
  B17's check at make catches a default that slips in; a decoded value that slips in dies at the
  start, so a slip is loud, never shared.
- Whether the trial's plants each turn T6 red on their own. The bugs they stand for were each seen
  while the trial wrote the type, but no plant was run alone.
- A TOML date (`since = 1979-05-27`, unquoted) is never a setting's value now; a person writes it
  quoted. No drafted setting was found that wants one.

## Open questions

None.

Every choice above picks how the code does what the protocol, its follow-up or the glossary
already says.

## Findings

1. **Several groups of one app share one file, and the strict check sees one group.** The protocol
   puts Code quality's Stryker settings under the `kalfa` app (`quality.stryker`, 1749's "Place in
   the ranked import order"), and CLI's protocol says `kalfa config` is built from every installed
   package's group (1749's last comment). But `SettingGroup.layer` checks a file against one group,
   so a key of another group in the same file is an unknown key and stops the start. Proof: the
   repo's own `.kalfa/kalfa.toml` holds `[[records]]` tables on its first lines, so a layer for
   quality's group alone would stop on `records`. 1846 gives `cli` many groups; nothing gives the
   layer many. This needs a ruling before 1847 moves the first caller: a layer over every group of
   an app, or a check that knows the other groups. Filed as
   [issue 1923](https://github.com/kamp-us/tea-fabrika/issues/1923); out of this ticket.

## Amendment 1

The review of [pull request 1922](https://github.com/kamp-us/tea-fabrika/pull/1922) sent the work
back a third time on one class of fault, and the owner decided the design question behind it on
[ticket 1839](https://github.com/kamp-us/tea-fabrika/issues/1839): a setting's value is plain data
only. The fault, as left at the branch head: a default that is a class instance (`Schema.Date`, a
`Schema.Class` instance, `Schema.ReadonlyMap`) was handed out as the declaration's own object, so a
write in one start was read by a later start; and the inside of a `Date` or a `Map` cannot be
frozen, so readers within one start shared it. `internal/frozen.ts` copied and froze plain objects
and arrays only.

What changed in this plan, each with its cause:

1. The opening and "Plain data only", a new subsection of "The shape": the type, `make`'s new
   signature, the compile errors, the refusal at make, and what `frozen.ts` may assume. Cause: the
   owner's rule.
2. Grouping's refusals gain "a default that is not plain data", ahead of the schema check. Cause: a
   cast default slips past the type, and `Schema.is` accepts a `Map` for a record.
3. The start's step 6 says each value is its own deep-frozen copy and a non-plain decoded value is a
   defect; `frozen`'s pass-through branch goes. Cause: the branch did this without the plan saying
   it, and a pass-through would hand a cast `Date` out shared.
4. Laws: T6 new; B16's two properties written into the table, the second gaining the
   `Object.isFrozen` line and plant (f); B17 new, two properties; `Pairing` and `Nesting` move to
   `Schema.optionalKey`. Cause: the reviewer showed no law tells a frozen copy from the
   declaration's own default frozen in place, and the trial found the one test that the new type
   stops compiling.
5. Files: `frozen.ts` and `README.md` get rows, and the glossary row and the line counts change.
   Cause: the review asked the README to say how a duration or a URL is declared, and the Setting
   entry to say plain data.
6. How others do it, Existing tools, Calls taken, departures, Validation, Size, Records and "What
   this cannot tell us" each gain their lines. The Estimate covers the whole quest now.

Out of scope, each its own ticket or question: a shared decoder for durations in `@kalfa/config`;
an environment variable that sets a table; the review's two message-wording findings; several groups
sharing one file ([issue 1923](https://github.com/kamp-us/tea-fabrika/issues/1923)); a settings error
that carries a diagnostic.

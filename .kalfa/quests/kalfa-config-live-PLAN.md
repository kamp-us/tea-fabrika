Approved by the lead agent, builds issues 1749, 1806, 1841, 0063, 0089; body 962a50b29cee
Plancheck-Version: 3

# Plan: live settings, where a running program sees a file change without a restart (ticket 1841)

This is the kalfa packages, `kalfa/config`, new work: [ticket 1841](https://github.com/kamp-us/tea-fabrika/issues/1841),
a build ticket of [Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749) and
[its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806). Words: `kalfa/config/GLOSSARY.md`, unchanged.
It builds on 1839's `Setting` and `SettingGroup` and 1840's flags as landed on main, and on the shape that
[pull request 2001](https://github.com/kamp-us/tea-fabrika/pull/2001) (1843, slice 1) gives `start.ts`: the
whole-file check in `internal/check.ts`, finding and reading files in `internal/place.ts`, and a `Format` passed
into the start. The build starts once 2001 is on main. One pull request, about 225 product lines.

A live setting already reads as a `Live`, yielded for its value now. This ticket gives it `changes`, and makes the
layer watch the folder of each configuration file. When a file changes, the layer reads that file again, checks it
whole exactly as the start does, resolves every setting by precedence again, and publishes each live value that
differs. A refused change is logged with its file and line, the last good values hold, and nothing fails.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import { Setting, SettingGroup } from "@kalfa/config"

export const approver = Setting.make("delivery.approver", Approver).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who may approve a change request."),
  Setting.live,
)
export const port = Setting.make("instance.port", Port).pipe(Setting.withDefault(18800), Setting.withDescription("The port."))
export const Demo = SettingGroup.make("demo", port, approver)

const program = Effect.gen(function* () {
  const { port, approver } = yield* Demo
  const now = yield* approver          // "people": the value now
  yield* approver.changes.pipe(        // Stream<Approver>: "people", then each new value, only when it differs
    Stream.runForEach((who) => Effect.log(`approver is now ${who}`)),
  )
  // port.changes                      // does not compile: a restart setting is a plain number
})

// .demo/demo.toml, saved by an editor (a rename) with approver = "owner":
//   changes gives "owner"; SettingGroup.origins(Demo) gives { _tag: "file", file: ".demo/demo.toml", line: 2 }
// saved again with aprover = "x":
//   log, warning: ".demo/demo.toml, line 2: there is no setting delivery.aprover. Did you mean delivery.approver?
//                  demo keeps the last good values."
//   changes gives nothing; yield* approver is still "owner"
```

## Calls under 80%, read these first

None needs the owner. Each is how the code does what the ticket and the protocol say.

- **A removed folder is found by checking that it exists after each quiet window (65%).** Node's docs say a watch
  follows the inode, so a watch on a folder that is removed "will emit an event for the delete but will continue
  watching the original inode" (read, `nodejs.org/api/fs.html`, "Inodes"). So the folder's own stream may never
  end. The plan checks `exists(folder)` after each debounced tick, and moves to watching the parent when the folder
  is gone. The doubt: whether macOS reports anything at all for the removal. R3's case (f) settles it on both
  systems. The fallback, if (f) is red on one: keep the parent's watch open in the folder state too, a second watch
  per file.
- **An event with no file name is lost (70%).** Node's docs say the file name "is not always guaranteed to be
  provided", and Effect's Node watch drops such an event (`if (!path) return` in `watchNode`,
  `@effect/platform-node-shared` 4.1.3, `src/NodeFileSystem.ts`, read). If macOS drops the name for a save, that save
  is missed. R3 shows it. The fallback is a `pnpm patch` of `@effect/platform-node-shared` that sends an `Update`
  with the folder's own path in place of dropping it, plus the upstream issue the same day, only once R3 proves a
  miss.
- **The quiet window is 100 milliseconds, a `Context.Reference` (75%).** chokidar's `atomic` option waits 100 ms
  before it calls a delete then a create a change (from memory, not fetched). Editors save by truncate and write, or
  by a temp file and a rename; both make bursts. The doubt is the number. It is `SettingGroup.Debounce`, a
  `Context.Reference<Duration>` with that default, so an app or a law changes it with a layer, as the repo's pattern
  for a limit says (`.kalfa/patterns/effect-state-and-time.md`).
- **A refused change says `<app> keeps the last good values.` where the start says `<app> did not start.` (75%).**
  The closing sentence becomes a parameter of `stop`, which 1843's slice 2 plans too (its edit ends `<file> was not
  changed.`). The doubt is only the words; V4 pins them.
- **A changed restart setting logs one info line (75%).** The protocol says a snapshot stream logs a changed restart
  setting "as needing a restart". A file change is the same fact on another path, so it is told the same way. It is
  logged once per change, never with its value.

## How others do it

Read, unless marked "from memory".

- **Elm (from memory).** A value that changes while a program runs reaches it as a subscription (`Sub msg`), never
  as a field it can write. A program names what it listens to. That is `approver.changes`: a stream the program asks
  for by name, with no setter, and a restart setting has none, as the protocol settled.
- **Erlang/OTP (from memory).** On a release upgrade, `application_controller` calls the application's
  `config_change(Changed, New, Removed)` with only the keys that changed. We copy "only what changed": `changes`
  emits a value only when that setting's own value differs.
- **Viper, Go (read, `spf13/viper` `viper.go`, `WatchConfig`).** It watches the config file's folder, not the file:
  "we have to watch the entire directory to pick up renames/atomic saves in a cross-platform way" (`watcher.Add(configDir)`).
  It keeps events whose cleaned path is the config file, and reloads on `Write` or `Create`. On `Remove` it stops
  watching. We copy the folder watch and the name filter. We differ on remove: a removed file counts as empty, as it
  does at the start, and the watch goes on.
- **Node (read, `nodejs.org/api/fs.html`, `fs.watch` caveats).** The inode rule and the file name rule quoted above.
  That is why 1843's note on this ticket says watch the folder: 1843's disk set replaces the file by a rename.
- **Effect 4.1.3 (read in `node_modules/effect/src`).** `FileSystem.watch(path, { onReady })` gives
  `Stream<WatchEvent, PlatformError>` of `Create`, `Update` and `Remove`, each with a `path`; `onReady` is "called once
  the underlying watcher is installed". The Node backend stats the path first, so a missing folder fails with
  `NotFound`, and it reports the child's name relative to the folder. `SubscriptionRef.changes` "will first emit the
  current value, then emit all future changes". `Stream.debounce` "emits only the latest element after the pause".
  `Layer.effect` takes away `Scope`, so a fiber forked with `Effect.forkScoped` in the start lives as long as the
  layer. `Equal.equals` compares plain objects and arrays by their contents.
- **chokidar (from memory).** For a path that does not exist yet it watches the parent and switches when the path
  appears. We copy that for a missing `.demo/` folder.

## The shape

### What a caller holds

```ts
// Sketch: kalfa/config/src/internal/live.ts.
export interface Live<A> extends Effect.Effect<A> {
  readonly [TypeId]: typeof TypeId
  /** The value now, then each new value, only when it differs. Nothing in it can set the value. */
  readonly changes: Stream.Stream<A>
}

class Reading<A> extends Effectable.Class<A> implements Live<A> {
  readonly [TypeId] = TypeId
  readonly changes: Stream.Stream<A>            // an own property, frozen with the instance
  readonly #ref: SubscriptionRef.SubscriptionRef<A>
  constructor(ref) { super(); this.#ref = ref; this.changes = SubscriptionRef.changes(ref) }
  asEffect() { return SubscriptionRef.get(this.#ref) }
}

/** A live value and the reference that sets it. Only the layer holds the second. */
export const reading = <A>(value: A): Effect.Effect<{ readonly live: Live<A>; readonly ref: SubscriptionRef.SubscriptionRef<A> }>
```

```ts
// Sketch: added to kalfa/config/src/SettingGroup.ts.
/** How long a file must be quiet before the layer reads it again. */
export class Debounce extends Context.Reference<Duration.Duration>("@kalfa/config/SettingGroup/Debounce", {
  defaultValue: () => Duration.millis(100),
}) {}

// `layer` keeps its type: Layer<Identifier<App, R>, SettingsError, FileSystem | Path>.
// `origins(group)` keeps its type and now reads the origins as they are now: a live setting's origin follows its value.
interface Started<R> {
  readonly values: Values<R>                   // unchanged: the same frozen object, the same `Live`s
  readonly origins: Effect.Effect<Origins<R>>  // was a frozen record; now a read of the origins now, with no setter beside it
}
```

- **Only a group with a live setting watches.** A group of restart settings has nothing a file change can give it
  while it runs, so it opens no watch (V11).
- **No setter reaches a caller.** `changes` is a Stream over the reference's PubSub; the reference stays in a
  `#private` field, and `Started.origins` is an Effect over a reference the layer keeps in a closure (V16).
- **A restart setting's `changes` does not compile,** because its field is the plain value (TL2).

### Watching one file

```ts
// Sketch: kalfa/config/src/internal/watch.ts. `place` is place.ts's: the path read and the name a person reads.
type Watching =
  | { readonly _tag: "Folder" }   // the file's folder exists: watch it, keep events named for the file
  | { readonly _tag: "Parent" }   // the folder is missing: watch its parent, keep events named for the folder

/** A tick each time the file may have changed, after a quiet window. It never fails: a fault is logged and ends it. */
export const ticks: (place: Place, ready: Deferred.Deferred<void>) => Stream.Stream<void, never, FileSystem | Path>
```

1. Start in `Folder`. `fs.watch(folder, { onReady })`. On ready, complete `ready` and emit one tick, so a change made
   between the start's read and the watch is not missed (V13).
2. Keep an event whose `basename(path)` is the file's name or the folder's own name. Debounce by `Debounce`.
3. After each quiet window, `fs.exists(folder)`. Still there: emit a tick. Gone: emit a tick (the file now reads as
   empty) and move to `Parent`.
4. A `NotFound` from the folder's watch: move to `Parent`, with no tick, since the start read the file as empty.
5. In `Parent`, `fs.watch(parent)` and keep events named for the folder. When one comes and the folder exists, emit a
   tick and move to `Folder`. `ready` completes here too, so a missing folder never holds up the start.
6. Any other watch failure, or a `NotFound` for the parent, or the folder's stream ending while the folder exists:
   log one warning, complete `ready`, and end. The file is then not watched. Message, wording sketch:
   `~/.demo/demo.toml is not watched: the folder could not be watched. A change to it applies when demo starts again.`
   It names the file as a person reads it and never its text.

The user file has no place when neither `<APP>_HOME` nor `HOME` is set; it is then not watched.

### Taking one file's new text

```ts
// Sketch: kalfa/config/src/internal/start.ts. One fiber owns the state, so it is a plain value folded over the ticks.
interface Held {
  readonly repo: Loaded
  readonly user: Loaded
  readonly settled: ReadonlyArray<Settled>     // one per setting, in the group's order: value and origin
}

// The start's own steps, split so the start and each update run the same code.
const readRepo: (group, format, place, version, names, closing) => Effect<Loaded, SettingsError, FileSystem>   // load, supported, check
const readUser: (group, format, place, names, closing) => Effect<Loaded, SettingsError, FileSystem>            // load or empty, check
const settle: (group, held files, names, provider, flags, closing) => Effect<ReadonlyArray<Settled>, SettingsError>

/** One file's new text: checked whole, resolved, published. A refusal is logged and the held state stays. */
const update: (held: Held, file: Setting.File) => Effect.Effect<Held, never, FileSystem>
```

`update(held, file)`, in a root span `config.update` with `kalfa.config.app`, `kalfa.config.file` (`repo` or `user`),
`kalfa.config.refused` and, when refused, `kalfa.config.reason`:

1. Read that file and check it whole: for the repo file the minimum version, then the whole-file check; for the user
   file the whole-file check. The closing sentence is `<app> keeps the last good values.`
2. Resolve every setting with the new text for that file and the held text for the other, through the same
   `resolve` the start uses: the same flags, the same environment, the same precedence. A flag or a variable that
   holds a live setting keeps winning, so its value never changes on a file change (V5).
3. Any `SettingsError` in steps 1 or 2: log it as a warning (its message, annotated with `kalfa.config.file` as a
   person reads it and `kalfa.config.line` where it has one), and return `held` unchanged.
4. Else, for each live setting by index: when its new frozen value is not `Equal.equals` to the held one,
   `SubscriptionRef.set` it. For each restart setting whose value changed, one info line, wording sketch:
   `.demo/demo.toml: instance.port changed. It applies when demo starts again.` Set the origins reference: a live
   setting's new origin, a restart setting's start origin. Return the new `Held`.

The follower merges both files' ticks, each debounced on its own, and folds them with `update` in one fiber, forked
into the layer's scope. The start waits on both `ready`s before the layer is built. Everything is read by index or
with `Rec.get`, never `record[name]`, so a setting named `constructor` is safe (V8).

### Where this meets 1843

- **`start.ts`, `check.ts`, `place.ts` and `error.ts`.** Slice 1 (pull request 2001) moves the check and the places;
  this plan builds on that shape. Slice 2 (pull request https://github.com/kamp-us/tea-fabrika/pull/2003) makes the
  closing sentence a parameter of `check.ts`'s functions. This plan needs the same parameter. Whichever lands first
  writes it as `stop(closing, reason, text, position?, cause?)`, with `check`, `refused`, `version` and `load` taking
  `closing`; the second uses it as it landed.
- **`MemoryFiles.test-support.ts`.** Slice 3 gives it writes, renames, removes and folders. This plan gives it the
  same, plus a watch. Whichever lands second builds on the first's disk and adds only what is missing.
- **`SettingGroup.ts`.** Slices 2 and 3 add `edit`, `set` and `remove`; this plan adds `Debounce` and changes
  `Started.origins`. The edits do not touch the same lines.

## One value traced

The group above, `version: "1.2.3"`, `repo: "/work"`, `HOME=/people/one`, no `DEMO_` variable, no flags. The repo
file `/work/.demo/demo.toml` holds `[delivery]` on line 1 and `approver = "people"` on line 2. No user file, and no
`/people/one/.demo/` folder.

1. The start reads, checks and resolves as today: `approver` is `"people"`, origin `.demo/demo.toml` line 2; `port`
   is 18800, origin default. `approver`'s reference starts at `"people"`.
2. The group has a live setting, so the follower is forked. The repo place's watch on `/work/.demo` becomes ready and
   emits one tick. The user place's watch on `/people/one/.demo` fails `NotFound`, so it moves to `Parent` and
   watches `/people/one`, ready at once. The layer is built.
3. 100 ms later the repo tick passes the window; `/work/.demo` exists; `update(held, "repo")` reads the same text and
   publishes nothing.
4. An editor writes `/work/.demo/.demo.toml.swp` and renames it over `demo.toml` with `approver = "owner"`. Events:
   `Create .demo.toml.swp` (dropped by name), `Create demo.toml` (kept). One tick after the window.
5. `update`: the text parses, has no `demo-version`, checks whole. Resolve: `approver` is `"owner"` from line 2,
   `port` still 18800. `"owner"` is not `"people"`, so the reference is set: `approver.changes` gives `"owner"` and
   `yield* approver` gives `"owner"`. Origins: `approver` at `.demo/demo.toml` line 2. Span `config.update`,
   `kalfa.config.file` `repo`, `kalfa.config.refused` false.
6. The editor saves `aprover = "x"`. The check fails `unknown`, line 2. Logged as a warning, ending
   `demo keeps the last good values.` Span `refused` true, `reason` `unknown`. `approver` stays `"owner"`.
7. The person runs `mkdir ~/.demo` and writes `[delivery]` and `approver = "you"` there. The parent's watch sees
   `.demo`; it exists, so a tick and the user place moves to `Folder`. `update(held, "user")`: the user file checks
   whole; resolve gives `approver` from the repo file still, `"owner"`, since the repo file wins over the user file.
   Nothing is published, and `approver`'s origin stays the repo file.
8. Had the app started with `--delivery.approver owner`, every step above would keep `"owner"`, origin the flag.

## What fact is lost if it is not recorded now

A live value's origin after it changes. Without it, `config list` (1846) and snapshots (1845) would blame the new
value on the start's source. So `origins(group)` reads the origins as they are now. And the refused changes: they
exist only when a file is saved, so each one is a log line and a `config.update` span with its reason, never its
value. Nothing is written to disk.

## Generators

Classes the generated laws must reach. Each id is named in a Plant cell below. The stand-in disk is
`MemoryFiles.test-support.ts`, given a live disk with a watch.

- (a) a file changed in place: an `Update` event.
- (b) a file replaced by a rename over it, as 1843's set and most editors do.
- (c) a file created where there was none, its folder there.
- (d) a file removed.
- (e) the file's folder missing at the start, then made with the file in it.
- (f) the folder removed while watched, then made again.
- (g) a burst of events on one file inside one window, with a broken or empty text in the middle and a good one last.
- (h) both files changed inside one window.
- (i) a refused text, one of each reason: `syntax`, `unknown`, `scope`, `invalid`, `version` (repo file), `missing`
  (a required setting removed) and `read` (a read fault planted on the file).
- (j) a live setting a flag sets.
- (k) a live setting an environment variable sets.
- (l) a restart setting whose file value changes.
- (m) a change that leaves a live value equal: a comment-only change, and the same value moved from the user file
  to the repo file.
- (n) a one-word live setting named `constructor`.
- (o) a live setting whose schema decodes asynchronously.
- (p) a table-valued and an array-valued live setting.
- (q) a watch fault other than `NotFound`, planted on a folder.
- (r) a secret-looking refused value, with characters that change in JSON and in a URL.
- (s) a group with no live setting.
- (t) the layer's scope closed while a change is waiting out its window.
- (u) a change made after the start's read and before the watch is ready.
- (v) a refused text, then a good one.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| V1, a live setting follows its files: for generated groups of one to three settings, at least one live, and a generated script of file changes over both files, each live field's `changes`, run from the start, gives the start value and then exactly the consecutive distinct values the oracle (a fresh start on each settled pair of texts) gives, and `yield*` gives the last. 100 runs | test | Effect Arbitrary: FileScript | (a) keep only `Create` events: an in-place change is missed, red; (b) watch the file's own path: after a rename the stand-in's watch follows the old file and sees nothing, red; (c) drop events for a name not yet read: a created file is missed, red; (d) keep the held text when a file is removed: the value never falls back, red; (m) set the reference on every update: `changes` gives a value twice, red; (p) compare with `===`: a table value is given again on a comment change, red | kalfa/config/src/SettingGroup.live.test.ts |
| V2, a folder that comes and goes: with the folder missing at the start and made later with the file, or removed while watched and made again, the live value follows the file each time, and the start does not wait for the folder. 100 runs | test | Effect Arbitrary: FolderScript | (e) end the watch on `NotFound`: the made folder is never seen, red; (f) keep watching the removed folder: the made-again file is missed, red | kalfa/config/src/SettingGroup.live.test.ts |
| V3, a burst is read once: events on one file inside one window give one read, after the window, of the last text: no refusal is logged for the broken text in the middle and `changes` gives only the last value; a change to each file inside one window is taken for both. 100 runs | test | Effect Arbitrary: Burst | (g) read on each event with no window: the empty middle text publishes the defaults, red; (h) debounce after merging the two files: one file's change is lost, red | kalfa/config/src/SettingGroup.live.test.ts |
| V4, a refused change holds the last good values: for a refused text of each reason, one warning is logged whose message names the file and the line where the fault has one and ends `<app> keeps the last good values.`, annotated with the file; every value, every origin and `changes` stay as they were; the program keeps running; and a later good text is taken. 100 runs | test | Effect Arbitrary: Refusal | (i) publish before the whole-file check: an `unknown` or `scope` text is taken, red; (i) skip the minimum version on an update: a repo text asking for a newer app is taken, red; (i) end the message with `did not start.`: red; (v) end the follower after a refusal: the good text after it is missed, red | kalfa/config/src/SettingGroup.live.test.ts |
| V5, precedence holds while running: a live setting a flag or a variable sets keeps that value and origin through any generated file script. 100 runs | test | Effect Arbitrary: Held | (j) resolve an update from the files only: the flag's value is replaced, red; (k) the same for the variable: red | kalfa/config/src/SettingGroup.live.test.ts |
| V6, a restart setting waits for a restart: through any generated file script, a restart field reads its start value; each change of its resolved value logs one info line naming the setting and the file, never the value, and no line when it did not change. 100 runs | test | Effect Arbitrary: RestartScript | (l) log on every update that has a restart setting: an unchanged one is logged, red; log nothing: red | kalfa/config/src/SettingGroup.live.test.ts |
| V7, origins follow live values: after each taken change, `SettingGroup.origins` gives each live setting the origin a fresh start on those texts gives, and each restart setting its start origin | test | scenario: a live and a restart setting, each moved from the user file to the repo file and back | keep the start's origins: red | kalfa/config/src/SettingGroup.live.test.ts |
| V8, own keys only: a one-word live setting named `constructor`, beside others, starts and follows its file as V1 says. 100 runs | test | Effect Arbitrary: OwnKeys | (n) keep the held values in a plain object and read `held[s.name]`: the first update reads Object's constructor, red | kalfa/config/src/SettingGroup.live.test.ts |
| V9, an asynchronous schema: a live setting whose schema decodes with an async `transformEffect` follows its file | test | scenario: one async live setting, three texts in turn | (o) check the update with `Schema.decodeUnknownResult`: the update dies, red | kalfa/config/src/SettingGroup.live.test.ts |
| V10, a watch that cannot be made is logged, never fatal: with a generated fault planted on a folder's watch, the layer starts, one warning names the file as a person reads it, the values hold, and the other file is still followed. 100 runs | test | Effect Arbitrary: WatchFault | (q) let the fault end the follower without a log: no warning and the other file stops, red | kalfa/config/src/SettingGroup.live.test.ts |
| V11, no live setting, no watch: a generated group of restart settings makes no `watch` call (recorded with `Recorder`) | test | Effect Arbitrary: RestartGroup | (s) fork the follower for every group: a watch call is recorded, red | kalfa/config/src/SettingGroup.live.test.ts |
| V12, the watch ends with the layer: once the layer's scope closes, no stand-in watch is open, and a later change logs and publishes nothing | test | scenario: a change written, the scope closed inside its window | (t) fork the follower with `Effect.forkDetach`: a watch stays open, red | kalfa/config/src/SettingGroup.live.test.ts |
| V13, nothing slips in at the start: a change the stand-in makes after the start's read and before it calls `onReady` is taken; the layer is built only after both watches are ready or given up | test | scenario: the stand-in writes the file on its first watch call | (u) emit no tick when the watch is ready: the change is missed, red | kalfa/config/src/SettingGroup.live.test.ts |
| V14 [secrets], values stay out: a generated secret-looking value in a refused text never appears in a log line, a span attribute or event, raw, JSON-escaped or URL-encoded. 100 runs | test | Effect Arbitrary: HiddenChange | (r) log the file's text with the refusal: red | kalfa/config/src/SettingGroup.live.test.ts |
| V15, each update is a span: each update ends one root `config.update` span with the app, the file, `refused`, and the reason when refused | test | scenario: one taken and one refused change | make the span a child of `config.layer`: red; leave `kalfa.config.refused` out: red | kalfa/config/src/SettingGroup.live.test.ts |
| V16 [protocol], no setter: a live field's `changes` holds no `SubscriptionRef` and no `PubSub` in any property to depth three, B16's writes on it change nothing a later reader gets, and a value set by the layer still reaches it | test | scenario: one live setting, B16's writes tried on `changes` | expose `changes` as an object that keeps the PubSub: red | kalfa/config/src/SettingGroup.live.test.ts |
| TL1, `changes` is a stream of the value: for a live setting of a text, a literal, a table and an array kind, `field.changes` is exactly `Stream.Stream<A>` | type | type | type `changes` as `Stream.Stream<unknown>`: tsc red | kalfa/config/src/SettingGroup.live.types.test.ts |
| TL2, a restart setting has no `changes`: for a number, a text, a boolean, an array and a table kind, `field.changes` is a line under `@ts-expect-error` | type | type | give `Read` a `changes` for restart settings too: the `@ts-expect-error` is unused, tsc red | kalfa/config/src/SettingGroup.live.types.test.ts |
| TL3, no setter in the type: `Exclude<keyof Live<A>, keyof Effect.Effect<A>>` is exactly the type id and `"changes"`; `layer` keeps its error and requirement types; `SettingGroup.Debounce` is a `Context.Reference<Duration.Duration>` | type | type | add `readonly ref: SubscriptionRef<A>` to `Live`: tsc red | kalfa/config/src/SettingGroup.live.types.test.ts |
| R3, the stand-in tells the truth about watching: on a real temp folder through `NodeServices`, cases (a) to (f), and a watch on the file's own path after a rename, give the same sequence of values (and of no events) as the same scripts on the stand-in; each case waits on real time up to 10 seconds | test | scenario: six file scripts and one file-path watch, on disk then in memory | watch the file's own path in place of its folder: case (b) on disk red | kalfa/config/src/SettingGroup.live.integration.test.ts |
| L1, the new code imports no kalfa package: the existing package rule holds `internal/watch.ts` | lint | lint | import `@kalfa/records/Finding` in `internal/watch.ts`: `pnpm lint` red | boundary-rules.json |
| O1, nothing else changes: 1839's B1 to B17, T1 to T6 and R1, 1840's F1 to F12, and 1843 slice 1's O2 stay green with no edit | test | pinned: the laws named, unchanged | (already planted) | kalfa/config/src/SettingGroup.test.ts, kalfa/config/src/SettingGroup.flags.test.ts, kalfa/config/src/SettingGroup.types.test.ts, kalfa/config/src/SettingGroup.integration.test.ts |

**Lint, type or test?** TL1 to TL3 are shapes the compiler sees: type. L1 is a shape of imports a rule already holds:
lint. V1 to V16 and R3 are about what a running layer does over time, which no type or lint rule sees: tests.

**Every check that guards data has a law that reaches it.** The minimum version and the whole-file check on an
update: V4. Resolve refusing (`missing`, `invalid`): V4. Equal values: V1 (m) and (p). Flag and variable
precedence: V5. Own keys: V8. The folder checks: V2. The setter guard: V16.

**Where they run.** V1 to V16 run in memory on every pull request, on the stand-in disk and its watch, with
`TestClock` moving the window; no law sleeps for real. R3 is the one `.integration.` file, because only a real
kernel can say what inotify, FSEvents and kqueue report, which is the thing the stand-in copies; it is the thin check
that the stand-in matches. It runs on Linux in a proof run the lead starts
(`gh workflow run scheduled.yaml --ref <branch> -f integration=kalfa/config/src/SettingGroup.live.integration.test.ts`)
and in main's full run, and on macOS in a new `config-watch` suite of `.github/workflows/host.yaml` on `macos-15`,
started by hand with `gh workflow run host.yaml --ref <branch> -f suite=config-watch`. Both run before the first
review. The laptop refuses `.integration.` files by name, so it is never run there. No law is host-only: none needs
launchd, a signal, a socket or the owner's Mac.

**O1 and recorded calls.** A 1839 law that compares every recorded file call on a start with a live setting would now
see a `watch` call. If one does, the tests step narrows that law's recorder to reads and says so in its report.

**The stand-in watch,** written by the tests step: a disk held in a `Ref` of files and folders, with `write`,
`rename`, `remove`, `makeFolder` and `removeFolder`; `watch(folder)` fails `NotFound` for a missing folder, calls
`onReady` once subscribed, and emits `Create`, `Update` or `Remove` with the child's name for each change of a direct
child; a removed watched folder emits one event with its own name and then nothing, as Node's docs say; a watch on a
file path follows that file, so a rename over it emits nothing more; faults can be planted per folder; it counts open
watches. The existing `make(disk)` and `layer(disk)` keep working for the old laws.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/watch.ts | build | 75 | new: `ticks`, the `Folder` and `Parent` states, the name filter, the window, the folder check, the ready signal, the give-up warning |
| kalfa/config/src/internal/start.ts | build | 95 | `readRepo`, `readUser` and `settle` split out of `start`; `update`; the follower forked into the layer's scope when a live setting exists; origins in a reference read as an Effect |
| kalfa/config/src/internal/live.ts | build | 12 | `changes` as an own property; `reading` also gives the reference to the layer |
| kalfa/config/src/internal/error.ts | build | 5 | `stop` takes the closing sentence (shared with 1843 slice 2, see "Where this meets 1843") |
| kalfa/config/src/internal/check.ts | build | 8 | `check`, `refused` and `version` take the closing sentence |
| kalfa/config/src/internal/place.ts | build | 5 | `load` takes the closing sentence; the folder and parent of a place |
| kalfa/config/src/SettingGroup.ts | build | 25 | `Debounce`; `Started.origins` as an Effect; `Live`'s doc names `changes`; `layer`'s doc says what it watches |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | a live disk with writes, renames, folders, a watch, planted watch faults and an open-watch count, beside today's `make` and `layer` |
| kalfa/config/src/SettingGroup.live.test.ts | tests | tests | new: V1 to V16, with their own start helper |
| kalfa/config/src/SettingGroup.live.types.test.ts | tests | tests | new: TL1 to TL3 |
| kalfa/config/src/SettingGroup.live.integration.test.ts | tests | tests | new: R3 |
| .github/workflows/host.yaml | tests | tests | a `config-watch` choice and job on `macos-15` that runs R3 alone, by hand only, with no `pull_request` path |
| kalfa/config/src/SettingGroup.test.ts | tests | tests | O1: no change, unless a recorder must be narrowed to reads |
| kalfa/config/src/SettingGroup.flags.test.ts | tests | tests | O1: no change |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | O1: no change |
| kalfa/config/src/SettingGroup.integration.test.ts | tests | tests | O1: R1, no change |
| boundary-rules.json | tests | tests | L1: no change, the rule that holds it |

No change to `kalfa/config/GLOSSARY.md`: **Live setting**, **Restart setting**, **Origin** and **Precedence** already
say all of this, and the plan coins no domain word. It says "a change to a file", never "an edit", because 1843 makes
**Edit** the word for one change to one setting made through `SettingGroup.edit`. No change to `kalfa/config/README.md`,
which 1849 rewrites for the new API, or to `index.ts` and the manifest: `SettingGroup` is already exported.

## Existing tools

- kalfa/config/src/internal/watch.ts: searched Effect 4.1.3's `FileSystem.watch` and `WatchBackend` (used as is: the
  watch itself), `Stream.debounce` (used as is), `Stream.callback` and `Stream.concat` (how the two states join), the
  repo for a folder watcher (`rg -il "fs.watch|FileSystem.watch|\.watch\("` over `kalfa/` and `next/packages/`: none
  that watches a folder for one file), and npm's chokidar, which would add a dependency for what Effect's watch
  already does under `FileSystem`, the seam the protocol named. New, about 75 lines over Effect's own calls.
- `readRepo`, `readUser`, `settle` and `update` in kalfa/config/src/internal/start.ts: searched `start.ts` itself
  (the steps exist inline in `start`; split, not copied, so the start and an update cannot drift),
  `Stream.runFoldEffect` (used as is for the one-fiber state) and `SubscriptionRef.set` (used as is).
- `Debounce` in kalfa/config/src/SettingGroup.ts: searched for a debounce value in the package: none. Effect's
  `Context.Reference` with a default is the repo's pattern for a limit.
- `changes` in kalfa/config/src/internal/live.ts: `SubscriptionRef.changes`, used as is.
- kalfa/config/src/internal/check.ts and kalfa/config/src/internal/place.ts: searched main, where neither exists
  yet; pull request 2001 (1843, slice 1) makes both by moving code out of `start.ts`. This plan adds no function to
  either, only the closing-sentence parameter 1843's slice 2 also plans, and a place's folder and parent, read with
  Effect's `Path.dirname` and `Path.basename`.

## Calls taken

Each picks how the code does what the ticket, the protocol or a note already says. Those under 80% are at the top.

- **Watch the folder, not the file.** 95%. Node's inode rule, Viper's folder watch and 1843's rename write.
- **An update runs the start's own steps, split out of `start`.** 90%. "Each edit is checked whole" is the start's
  check; one copy keeps them equal.
- **A removed file counts as empty, and the watch goes on.** 85%. The start counts a missing file as empty; a change
  while running follows the same rule. Viper's stop on remove would end live settings on a branch switch.
- **Each file is debounced on its own, then the two are merged into one fiber.** 85%. One fiber owns the held texts,
  so no lock; a merged window would drop one file's change (V3).
- **Only a group with a live setting watches.** 85%. A restart value never changes while running. The cost: a
  restart-only group gets no "needs a restart" line.
- **Origins follow live values; `origins(group)` keeps its type.** 80%. The data shape rule; it is already an Effect.
- **The start waits until both watches are ready or given up, then catches up once.** 80%. Without it, a change in
  the gap is lost for good.
- **The refusal is a warning; the restart line is info.** 80%. One needs a person to fix a file; the other only says
  when a value applies.
- **A file that cannot be watched is logged once and the program runs on.** 85%. The ticket: nothing fails.
- **Is this a setting?** `Debounce` is a limit, so it is a value an app or a law sets with a layer, not a `Setting`:
  the watcher would read it from the files it watches, and no person picks it per repo. Nothing else here is a
  choice a person makes.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/config/src/SettingGroup.live.test.ts` shows V1 to
  V16 red on the branch head; TL1 to TL3 are written and named as judged by the compiler run the lead allows the build.
- Build step: the same path green, each plant red once; `kalfa/config/src/SettingGroup.test.ts` and
  `kalfa/config/src/SettingGroup.flags.test.ts` still green.
- The lead may allow the build one early `pnpm --filter @kalfa/config typecheck` once `Live` and `Started` change.
- Before the first review, the lead starts R3 on Linux (the proof run above) and on macOS (`host.yaml`'s
  `config-watch`). The lead runs `--changed origin/main` and one `pnpm typecheck`.

## Size

1. One pull request: 225 lines (`internal/watch.ts` 75, `internal/start.ts` 95, `internal/live.ts` 12, the closing
   sentence 18 across `error.ts`, `check.ts` and `place.ts`, `SettingGroup.ts` 25), plus three test files, the
   stand-in's live disk and the `host.yaml` suite. It lands whole: `changes` with no watcher never changes, and a
   watcher with no `changes` has no reader. If 1843's slice 2 lands first, the 18 closing-sentence lines are already
   there.

About 4 agent hours across tests, build and review, 70% sure. The doubt is the stand-in watch and R3: if macOS
reports a folder removal or a save differently from the stand-in, one round goes back to the plan for the fallback
named at the top. Basis: 1840's plan came to $50 for 6 steps; this one has a heavier tests step (a watch stand-in
and a timed script generator). Steps: tests, build, review, one likely send-back of tests and build, and one of the
plan if R3 is red on one system.

Estimate: 7 steps, $60

## New names

- `changes`: the protocol's name on a live setting.
- `SettingGroup.Debounce`: the industry's word for a quiet window, as `Stream.debounce` names it.
- `config.update` span, and `kalfa.config.refused` and `kalfa.config.reason` attributes, beside 1843's
  `kalfa.config.file`, by decision 0063's `<package>.<call>` rule.
- `Folder` and `Parent`: code names of the watch's two states, inside `internal/`.

## Records

- No glossary change, for the reasons under Files.
- No decision record: each call applies the protocol, the ticket or Node's documented behavior, and none is hard to
  undo before 1847 gives live settings their first callers.
- No pattern doc. `.kalfa/patterns/settings.md` still describes today's shape until 1849.
- On ticket 1841, the lead may note that the folder note in its comment is built here, with V1's plant (b) and R3.

## What this cannot tell us

- How macOS reports a removed folder, and whether it ever drops a file name on a save. R3 shows both; the fallbacks
  are at the top.
- Whether 100 ms covers every editor. A slow editor that writes in two steps more than 100 ms apart shows one refused
  line, then the good value; nothing is lost.
- A settings file that is a link: the watch sees the link's folder, so a change at the link's target elsewhere is not
  seen. Viper tracks the link's target for this case; nothing here does.
- A network or container file system where the kernel sends no events. The file is then followed only at a restart,
  with no warning, since the watch opens fine.
- Windows, where none of this runs yet.
- Whether a running program wants every value of a fast burst. It gets the last one after the window, by design.

## Open questions

None.

Every choice above picks how the code does what the ticket, the protocol, 1840's flag rule, 1843's rename write or
Node's documented watch behavior already says.

## Findings

1. **Pull request 2001 conflicts with main now.** `gh pr view 2001` reports `mergeable: CONFLICTING`. Its
   `start.ts` has no flags, because 1840 landed after it branched. This plan assumes 2001 lands with main's flag source
   merged into its `start.ts`. If the merged `resolve` differs, the build follows what landed.
2. **Effect's Node watch drops an event that has no file name.** `watchNode` in `@effect/platform-node-shared` 4.1.3
   returns early on `!path`, and Node's docs say the name is not always given. Read only, not run, so not reported
   upstream; R3 on macOS is the repro if it bites.
3. **The ticket's word "edit" now means something else in this context.** Ticket 1841 says "a refused edit"; 1843
   makes **Edit** one change to one setting through `SettingGroup.edit`. This plan says "a change to a file". The lead
   may reword the ticket's two lines.

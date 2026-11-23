Approved by the lead agent, builds issues 1749, 1845; body 2023384b3271
Plancheck-Version: 3

# Plan: settings for a process that cannot read files (ticket 1845)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1845, under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749), whose "A process that cannot read
files" line this builds, and [its follow-up](https://github.com/kamp-us/tea-fabrika/issues/1806). Words:
`kalfa/config/GLOSSARY.md`. A Worker cannot read the configuration files. So the process that can (the loading
process) gives a stream of snapshots, the app carries it, and the Worker starts its group from the first one and
updates its live settings from the later ones. Two pull requests: the loader's stream with the strict read (about 180
product lines), then the layer that starts from the stream (about 170).

```ts
// The whole idea, a sketch. Nothing here was type-checked.
import { SettingGroup } from "@kalfa/config"
import { Digest } from "effect/crypto"

export const Demo = SettingGroup.make("demo", port, approver)   // port: restart, approver: live

// The loading process: its group started from the files, as today.
const out: Stream.Stream<SettingGroup.Snapshot, never, SettingGroup.Identifier<"demo", R> | Digest.Digest> =
  SettingGroup.snapshots(Demo)
// { app: "demo",
//   values:  { "instance.port": 4100, "delivery.approver": "people", "config.watch.debounce": "100 millis" },
//   origins: { "instance.port": { _tag: "file", file: "~/.demo/demo.toml", line: 2 }, ... },
//   hash: "9f2c…" }                     then one more each time the files, as taken, say something new
// Carrying it is the app's job: postMessage, a socket, anything.

// The Worker: no FileSystem, no Path.
const inbox: Stream.Stream<unknown> = Stream.fromEventListener(self, "message").pipe(Stream.map((e) => e.data))
const settings: Layer.Layer<SettingGroup.Identifier<"demo", R>, SettingsError, Digest.Digest> =
  SettingGroup.layerFromSnapshots(Demo, inbox)
// yield* Demo -> { port: 4100, approver: Live<"people"> }, as the loader reads them
// a later snapshot with approver "owner"   -> approver.changes gives "owner"
// a later snapshot with port 4200          -> log "instance.port changed. It applies when demo starts again."; port stays 4100
// a snapshot that does not fit Demo        -> refused by the strict read: at the first the layer fails, later a warning
```

## Calls under 80%, read these first

The plan takes each lean and goes on. Neither is a question for the owner: each picks how the code does what the
protocol's line says.

- **A snapshot holds the files as last taken, not only what the loading process runs with (75%).** When a restart
  setting changes in a file, the loading process keeps its start value and logs the change (law V6). Its next snapshot
  still carries the new value, with its new origin. Why: the protocol says "a changed restart setting in a later
  snapshot is logged as needing a restart", so a later snapshot must be able to carry one. With snapshots of the
  running values only, a restart change could never reach a Worker, and the Worker would never say a restart is due.
  Cost: a snapshot can differ from the loader's own `origins(group)` for a restart setting that waits for a restart.
  What settles it: the lead's read, or the first Worker caller (show state). Separable: the other way builds each
  snapshot from the running values and origins, and changes only `start.ts`, `follow.ts` and SN2's oracle.
- **A refused snapshot fails with a new reason, `snapshot` (75%).** Today's nine reasons all name a file, a flag or a
  variable; none fits "this snapshot does not fit the group". `read` means "a file could not be read" and `invalid`
  means "a value its schema refuses" at a place a person can fix. A new reason lets a caller tell a carrier bug from a
  settings fault. Cost: T5's nine become ten. What settles it: the lead's read.

## Slices

1. **The loader's stream and the strict read**, branch `fabrikalfa/kalfa-config-1845`. `SettingGroup.snapshots(group)`,
   the snapshot's shape, how it is made, and the strict read with its origin rule. It closes the ticket's first and
   fourth criteria: a Worker author can carry the stream and see it read back in tests. It lands whole: the stream is
   public, and the read is the check that every snapshot it gives fits.
2. **The layer from snapshots**, a branch the lead names, made from main after slice 1 lands.
   `SettingGroup.layerFromSnapshots(group, stream)`, the receiver that follows the stream, and the restart rule shared
   with today's follower. It closes the second and third criteria.

Shared pieces and who owns them: `internal/snapshot.ts` (shape, `make`, `read`, `fits`, `same`, `hash`) is slice 1's.
The new reason `snapshot` is slice 1's, since `read` fails with it. `Resolved.taken` in `internal/start.ts` is slice 1's.
`internal/apply.ts`, the rule both followers use, is slice 2's: it moves today's `publish` out of `internal/follow.ts`.
`running`, the values a process reads from a resolved list, is slice 2's: it moves out of `internal/start.ts`.

## How others do it

Read, unless marked "from memory".

- **Elm (from memory).** A program gets its outside values once as `flags` to `init`, and later ones as an incoming
  port, a `Sub` it names. A value that crosses a port is decoded with a `Json.Decode` decoder, and a value that does
  not fit is the program's error to handle. Taken: the first value starts the program, later ones arrive as a
  subscription, and each is decoded strictly at the boundary.
- **Erlang/OTP (from memory).** After a release upgrade, `application_controller` calls `config_change(Changed, New,
  Removed)` with only the keys that changed; an application decides which of them it can apply while running. Taken:
  only what changed moves, and a restart setting is told, not applied, as today's follower already does.
- **Envoy's xDS (from memory, not fetched).** A proxy waits for its first configuration from the control plane before
  it serves. Later updates replace what can change live. An update it cannot accept is refused (a NACK), and the last
  good configuration stays. The control plane keeps a "snapshot" per proxy with a version. Taken: the first item
  starts the layer, a refused later one keeps the last good values.
- **Kubernetes (from memory).** A ConfigMap mounted as a volume reaches a running pod; one read into environment
  variables needs a restart. The same split as live and restart settings.
- **Effect 4.1.3, read in `kalfa/config/node_modules/effect/src/rpc/RpcWorker.ts`.** `InitialMessage` is one
  schema-encoded value a worker client sends before any request; the worker decodes it with a schema and fails "if no
  initial message is available or decoding fails". That is our first snapshot. Effect's `Worker` and `RpcWorker` carry
  messages but know nothing of settings, so the app's carrier can be one of them; Configuration does not pick one.
- **Effect 4.1.3, read in `Stream.ts` and `SubscriptionRef.ts`.** `Stream.peel(stream, Sink.head())` gives the first
  item and the rest of one run, valid in the scope, so a stream is run once (a second run of a message stream would
  miss items). `SubscriptionRef.make` publishes on an unbounded `PubSub` with `replay: 1`, so `changes` gives the value
  now and then each set, which is what `Live.changes` uses already. `Stream.changesWith` drops an item equal to the one
  before it.
- **Today's code, read.** `kalfa/config/src/Snapshot.ts` is the old API's snapshot: values and origins keyed by dotted
  name, a SHA-256 of the values with keys sorted, and a strict read that decodes, encodes again and checks the hash.
  Its origin check accepts any relative file name. `kalfa/config/src/internal/follow.ts` holds the restart rule in
  `publish`: a live value that differs is set, a restart value that differs logs one info line, and origins follow live
  settings only. The 1749 protocol says the snapshot schema and its strict read stay, moved inside, and ticket 1849 moves
  them.

## The shape

### The snapshot (slice 1)

```ts
// Sketch: kalfa/config/src/internal/snapshot.ts.
/** Every loaded value of one app, its origin, and a hash of the values alone. Plain JSON, so an app can carry it. */
export const Snapshot = Schema.Struct({
  app: Schema.String,
  values: Schema.Record(Schema.String, Schema.Json),    // by setting name, each encoded by its own JSON codec
  origins: Schema.Record(Schema.String, Origin),        // Origin from kalfa/config/src/Sources.ts, unchanged
  hash: Schema.String,                                   // SHA-256 of the values, keys sorted at every depth
})
export type Snapshot = typeof Snapshot.Type

/** Moved here from Snapshot.ts, which now imports it, so the old and the new snapshot hash alike. */
export const hash: (values: Snapshot["values"]) => Effect.Effect<string, never, Digest.Digest>

/** The snapshot of one resolved list: the group's settings, the window included, in the group's order. */
export const make: (group: Group, taken: ReadonlyArray<Settled>) => Effect.Effect<Snapshot, never, Digest.Digest>

/** Whether two snapshots say the same thing: one hash and equal origins. */
export const same = (a: Snapshot, b: Snapshot): boolean => a.hash === b.hash && Equal.equals(a.origins, b.origins)
```

- **The app is in it.** Two apps can declare the same names; a Worker that holds both groups must not start one on
  the other's snapshot. The 1838 plan (`.kalfa/quests/kalfa-config-PLAN.md`, "What fact is lost today") said the first
  plan that records a kalfa snapshot adds the app.
- **The window is in it.** A group with a live setting is read with `config.watch.debounce`, and its `Origins` type
  holds that name (TL4). So the receiver's `origins(group)` has the same keys as the loader's. The receiver never
  watches anything, so the window's value does nothing there.
- **The hash stays.** The protocol keeps the snapshot schema, and `same` uses it. It costs the `Digest` service on
  both sides; Effect's `Digest.layerWebCrypto` runs in a Worker.

### The origin rule (slice 1)

A rule the old read held only in prose and a regex becomes one named piece:

```ts
// Sketch: kalfa/config/src/internal/snapshot.ts.
/** Whether a start of `app` could give `setting` this origin. */
export const fits = (app: string, setting: Setting.Any, origin: Origin): boolean =>
  Origin.match(origin, {
    default: () => Option.isSome(setting.default),                              // a required setting has none
    flag: ({ name }) => !setting.fileOnly && name === `--${setting.name}`,
    env: ({ name }) => !setting.fileOnly && name === variable(app, setting.name),
    file: ({ file }) => setting.files.some((at) => fileNames(app, toml)[at].includes(file)),
  })
```

```ts
// Sketch: kalfa/config/src/internal/place.ts. `userPlace` builds the `$<APP>_HOME` name from `homeName` too.
/** The user file's name under `$<APP>_HOME`: `$DEMO_HOME/demo.toml`. */
export const homeName = (app: string, format: Format): string
/** Every name a person reads for each file: the repo's one, the user's under `~` and under `$<APP>_HOME`. */
export const fileNames = (app: string, format: Format): Readonly<Record<Setting.File, ReadonlyArray<string>>>
```

It is stricter than the old check on purpose: a file must be in the setting's file scope, a file-only setting has no
flag or variable origin (ruling 2 of 1806 stops such a start), and another app's file never fits.

### The strict read (slice 1)

```ts
// Sketch: kalfa/config/src/internal/snapshot.ts.
/** Reads a snapshot strictly and stops at the first fault, with one SettingsError of reason `snapshot`. */
export const read: (
  group: Group,
  input: unknown,
  closing: string,            // `<app> did not start.` at the first, `<app> keeps the last good values.` later
) => Effect.Effect<ReadonlyArray<Settled>, SettingsError, Digest.Digest>
```

The checks, in order. Each reads only input that passed every check before it.

| Step | What it checks | Message (then the closing line) |
|---|---|---|
| 1 | an object with exactly `app`, `values`, `origins` and `hash`, of their types | `this is not a snapshot.` |
| 2 | `app` is the group's app | `the snapshot is another app's.` |
| 3 | `values` and `origins` hold exactly the group's names, the window included, as own keys | `the snapshot does not hold <app>'s settings.` |
| 4 | each origin `fits` its setting | `<name>: the snapshot gives it an origin <app> cannot give.` |
| 5 | each value decodes by its setting's JSON codec, excess keys refused, and is plain data | `<name>: the snapshot's value is refused by its schema.` |
| 6 | the hash of the values encoded again equals `hash` | `the snapshot's hash does not match its values.` |

- No message holds a value or an input key: only the group's own names and the app's name. A decoder's issue can
  repeat the input, so it goes in `cause` as `Redacted`, as the old read does.
- The answer is the same `Settled` list a start makes (`internal/read.ts` exports the type), in the group's order, so
  the receiver runs through the code the loader runs through.
- A value that is not plain data after decoding is a cast schema, the author's bug: it dies, as `settle` does.

### The stream (slice 1)

```ts
// Sketch: kalfa/config/src/internal/start.ts. Resolved gains one field.
export interface Resolved {
  readonly values: Readonly<Record<string, unknown>>
  readonly origins: Effect.Effect<Readonly<Record<string, Origin>>>
  /** Every resolved list as taken: the one now, then one each time a change is taken. */
  readonly taken: Stream.Stream<ReadonlyArray<Settled>>
}
```

```ts
// Sketch: kalfa/config/src/SettingGroup.ts.
/**
 * The group's settings as snapshots, for a process that cannot read files: the one now, then one each time a change
 * to a file is taken and the snapshot says something new. A refused change gives none. Needs the group's layer.
 */
export const snapshots = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
): Stream.Stream<Snapshot, never, Identifier<App, R> | Digest.Digest> =>
  Stream.unwrap(Effect.map(key(group.app, group.settings), (started) => started.snapshots))

export type { Snapshot }   // the type only; the schema stays inside, as 1849 says
```

- `start` keeps a `SubscriptionRef` of the resolved list. `follow.ts`'s `take` sets it after `publish`, and a refused
  change never reaches it. `Started` gains `snapshots: Stream<Snapshot, never, Digest>`, made from `taken` by `make`
  and `Stream.changesWith(same)`. It is a required field, so a layer that gives none does not compile.
- A group with no live setting has no follower: its stream gives one snapshot and then waits.
- The layer from files does not need `Digest`: only a caller of `snapshots` does (T3 and TL3 hold).

### The receiver (slice 2)

```ts
// Sketch: kalfa/config/src/SettingGroup.ts.
/**
 * Starts a group from a stream of snapshots, in a process that cannot read files. The first snapshot starts it; each
 * later one updates its live settings. A changed restart setting is logged as needing a restart, and its value and
 * origin stay. A snapshot that does not fit the group is refused: the first fails the layer, a later one is logged as
 * a warning and the last good values hold. Carrying the stream is the app's job, its failures included.
 */
export const layerFromSnapshots = <App extends string, R extends ReadonlyArray<Setting.Any>, RS>(
  group: SettingGroup<App, R>,
  snapshots: Stream.Stream<unknown, never, RS>,
): Layer.Layer<Identifier<App, R>, SettingsError, RS | Digest.Digest> =>
  Layer.effect(
    key(group.app, group.settings),
    receive({ app: group.app, settings: watched(group.settings) }, snapshots).pipe(
      Effect.map(typed<R>),
      Effect.withSpan("config.layer", { attributes: { "kalfa.config.app": group.app } }),
    ),
  )
```

```ts
// Sketch: kalfa/config/src/internal/receive.ts.
export const receive = Effect.fnUntraced(function* <RS>(group: Group, snapshots: Stream.Stream<unknown, never, RS>) {
  const { app } = group
  const [first, rest] = yield* Stream.peel(snapshots, Sink.head())          // one run, in the layer's scope
  if (Option.isNone(first)) {
    return yield* stop(app, "snapshot", "no snapshot came before the stream ended.")
  }
  const taken = yield* read(group, first.value, `${app} did not start.`)
  const { values, lives } = yield* running(taken)                            // moved out of start.ts
  const started = new Map(taken.map(({ setting, origin }) => [setting.name, origin]))
  const sinks = { lives, started, origins: yield* Ref.make(reported(started, taken)), taken: yield* SubscriptionRef.make(taken) }

  yield* rest.pipe(
    Stream.runFoldEffect(() => taken, (held, input) => update(group, sinks, held, input)),   // each in a root span
    Effect.andThen(Effect.logInfo(`the snapshot stream ended. A change applies when ${app} starts again.`)),
    Effect.forkScoped,
  )
  return { values, origins: Ref.get(sinks.origins), taken: SubscriptionRef.changes(sinks.taken) } satisfies Resolved
})
```

- **`update`** reads the item with the closing `<app> keeps the last good values.`. Refused: one warning with the
  message, the root span `config.update` gets `kalfa.config.refused: true` and `kalfa.config.reason`, and the held
  list stays. Taken: `apply` (below) with no file name, then `taken` is set. The span has `kalfa.config.app` and no
  `kalfa.config.file`, since no file was read.
- **The stream's type says it cannot fail.** A carrier's failure is the app's to handle (retry, end, or die), so a
  failure Configuration would have to guess about cannot be passed in. A stream that ends keeps the last values and
  logs one info line.
- **No files and no environment.** The layer needs no `FileSystem`, `Path` or `ConfigProvider`, so the stop on a
  variable for a file-only setting holds on the loading process only, as 1806 says (the note on this ticket).
- The receiver's own `snapshots(group)` gives what it took, so a Worker can pass the stream on.

### The rule both followers share (slice 2)

Today it lives inside `follow.ts`'s `publish`. It becomes one named piece, so the file follower and the snapshot
follower cannot drift:

```ts
// Sketch: kalfa/config/src/internal/apply.ts.
/** What one taken list does to a running process, per setting whose value differs. A restart update holds no value. */
export const Update = Schema.TaggedUnion({
  live: { name: Schema.String, value: Schema.Unknown },
  restart: { name: Schema.String },
})
export type Update = typeof Update.Type

/** The updates from `before` to `after`, in `after`'s order: `before` is found by name, as an own key, never by place. */
export const updates = (before: ReadonlyArray<Settled>, after: ReadonlyArray<Settled>): ReadonlyArray<Update>

/** The origins a running process reports after `after`: a live setting's follows its value, a restart setting keeps its start one. */
export const reported = (started: ReadonlyMap<string, Origin>, after: ReadonlyArray<Settled>): Readonly<Record<string, Origin>>

/** Sets each live update, logs each restart one, and stores the reported origins. `where` opens the restart line: the file, or none. */
export const apply: (sinks: Sinks, app: string, before: ReadonlyArray<Settled>, after: ReadonlyArray<Settled>, where: string | undefined) => Effect.Effect<void>
```

- A restart update has no `value` field, so a running process cannot set a restart value from it: the type says so
  (SN12).
- The file follower calls `apply` with the file's name, so its line stays `<file>: <name> changed. It applies when
  <app> starts again.` (V6). The receiver's line is `<name> changed. It applies when <app> starts again.`
- `running(settled)` moves out of `start.ts`: a live setting gets a `Live`, a restart setting its plain value, and the
  window is left out of the values. Both starts call it.

### Text keeps its bytes

No text this package writes here is made from an input text: the messages use only the group's own names. The one
place a person's bytes pass through is a text value inside a snapshot. It is encoded by its codec and decoded back
byte for byte: CRLF stays CRLF, a lone CR stays, and a final line break stays or stays absent (SN1, class (c)).

## One value traced

`Demo` is `port` (`instance.port`, restart, user file only, default 18800) and `approver` (`delivery.approver`, live,
a literal of `"people"`, `"owner"`, default `"people"`). The loading process starts with `HOME=/people/one`. The user
configuration `~/.demo/demo.toml` holds `[instance]` on line 1 and `port = 4100` on line 2. The repo configuration
`.demo/demo.toml` holds `[delivery]` and `approver = "people"`.

1. The loader's layer starts as today: `port` 4100 from `~/.demo/demo.toml` line 2, `approver` `"people"` from
   `.demo/demo.toml` line 2, the window `"100 millis"` from its default. `taken` holds those three.
2. The app runs `SettingGroup.snapshots(Demo)` and posts each item to the Worker. The first:
   `{ app: "demo", values: { "instance.port": 4100, "delivery.approver": "people", "config.watch.debounce": "100
   millis" }, origins: { …the three above… }, hash }`, the hash of the three values with keys sorted.
3. The Worker builds `layerFromSnapshots(Demo, inbox)`. `peel` takes the first item. `read`: it is an object of the
   four keys; `app` is `demo`; both records hold exactly the three names; `~/.demo/demo.toml` is a user file name and
   `port` may sit in the user file, the repo name fits `approver`, and the window has a default; each value decodes;
   the hash matches. The Worker yields `{ port: 4100, approver: Live("people") }` and the same origins.
4. A person sets `approver = "owner"` in the repo file. The loader's follower takes it, sets its own `Live`, and sets
   `taken`. The snapshot's hash differs, so the stream gives it. The Worker reads it; `updates` gives
   `live { name: "delivery.approver", value: "owner" }`; `approver.changes` gives `"owner"` and its origin stays the
   repo file, line 2.
5. A person sets `port = 4200` in the user file. The loader logs `~/.demo/demo.toml: instance.port changed. It applies
   when demo starts again.` and keeps 4100. `taken` holds 4200, so the next snapshot carries it (the call at the top).
   The Worker's `updates` gives `restart { name: "instance.port" }`: it logs `instance.port changed. It applies when
   demo starts again.`, and `port` reads 4100 with its start origin.
6. A person adds a comment line above `approver`. The loader takes it: same values, but `approver`'s line is now 3.
   `same` is false, so a snapshot goes out; the Worker's `approver` origin becomes line 3. No value moved, so no
   `changes` item and no log line.
7. A newer loader build, where `approver` also allows `"robots"`, sends `approver: "robots"`. Step 5 of the read fails:
   one warning, `delivery.approver: the snapshot's value is refused by its schema.` then `demo keeps the last good
   values.`; the span says refused, reason `snapshot`. Nothing moves.
8. Had that been the first item, the layer would have failed with the same message ending `demo did not start.`

## What fact is lost if it is not recorded now

- **Which app a snapshot belongs to.** Without `app`, a Worker that holds two apps' groups of the same names would
  start on the wrong one, and no later field can say which app made a snapshot already carried.
- **That a restart is due.** If snapshots held only the running values, a restart change in a file would never reach a
  Worker, and the Worker would never say so. The call at the top keeps it.
- Nothing is written to disk. A refused snapshot exists only as it arrives, so it is one warning and one
  `config.update` span with its reason, never its values.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/config/src/SettingGroup.snapshot.test-support.ts` (slice 1 makes
it, slice 2 adds to it). It starts groups over `MemoryFiles.test-support.ts` and a test `ConfigProvider`, as the
fileonly and live laws do. Caps: at most three settings and the window, at most six items or file changes a run. Each
run builds one case per class it lists, from the drawn seeds, never the cross product, and a law fails when a class it
lists was not reached.

The groups and what a start gives:

- (a) a restart-only group; a group with a live setting, so with the window; a file-only setting; a required setting;
  a table and an array value.
- (b) every origin a start gives: the default, a flag, a variable, the repo file, the user file under `~` and under
  `$<APP>_HOME`.
- (c) text values with LF, CRLF and a lone CR, with and without a final line break, a tab, `雪`, and the empty text.

The loader's stream, through a script of file changes:

- (d) a change that moves a live value.
- (e) a change that moves a restart value.
- (f) a change that moves only an origin: a line added above the key.
- (g) a change that moves nothing: a comment added after the last key.
- (h) a refused change: an unknown key.

The receiver's stream:

- (i) later snapshots that move a live value, a restart value, only an origin, and nothing.
- (j) a restart value that changes, then stays, then goes back to its start value.
- (k) a refused later snapshot between good ones.
- (l) a stream that ends before its first item, and one that ends after some.

Snapshots that do not fit. Each is a snapshot the loader made, with one change of its class, so it passes every check
of the read before its own:

- (m) not an object, a missing top-level key, an extra one, and a field of the wrong type.
- (n) another app's snapshot with the same names, its hash right.
- (o) a name missing, extra or renamed in `values` or in `origins`, the hash made over what is there.
- (p) an origin no start gives: a flag or a variable for a file-only setting, a flag or a variable of another name, a
  file outside the setting's file scope, another app's file names, an absolute path, `$OTHER_HOME/…`, and the default
  for a required setting.
- (q) a value its schema refuses, the hash made over it.
- (r) an extra key inside a record value, the hash made over it.
- (s) a wrong hash, all else right.
- (t) builds out of step: the loader's group has one more setting, one fewer, or another schema at one name.

The shared rule and secrets:

- (v) an `after` list in another order than `before`.
- (w) equal values that are different frozen copies.
- (x) secret-looking texts as values, as an extra key's value, and as the app name, each with a character that changes
  in JSON and in a URL.
- (y) settings named `constructor` and `to-string`, beside others.
- (z) the window changing, which is a restart setting.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| SN1, slice 1, a snapshot reads back: for a generated group and sources, the first item of `snapshots(group)` read strictly gives exactly the start's values (a live one yielded) and `origins(group)`, and each text value byte for byte. 100 runs, every class listed reached | test | Effect Arbitrary: Loaded | (a) leave the window out of `make`: a group with a live setting is refused at step 3, red; (b) write a `$<APP>_HOME` file origin as its `~` name in `make`: the origin changes, red; (c) normalize `\r\n` to `\n`, or trim a final line break, when a text is encoded: red | kalfa/config/src/SettingGroup.snapshot.test.ts |
| SN2, slice 1, the stream follows the taken files: for a generated group with a live setting and a generated script of file changes, after each change settles, the items so far are exactly the first, then one for each taken change whose snapshot is not `same` as the one before, each equal to the snapshot of a fresh start on the same files. 100 runs, every class listed reached | test | Effect Arbitrary: Script | (d) give the first item only: red; (e) make each snapshot from the running values: a restart change never shows, red; (f) call two snapshots the same when their hashes are equal: an origin-only change gives no item, red; (g) give an item for every taken change: a change that moves nothing repeats one, red; (h) set `taken` before the change is checked: a refused change gives an item, red | kalfa/config/src/SettingGroup.snapshot.test.ts |
| SN3, slice 1, the strict read refuses what does not fit: for a loader snapshot and one generated change of a class, `read` fails with one `SettingsError`, reason `snapshot`, no file and no line, the step's message from "The strict read", ending with the closing it was given; the same snapshot unchanged reads. 100 runs, every class listed reached | test | Effect Arbitrary: Misfit | (m) decode the envelope without refusing excess keys: an extra top-level key passes, red; (n) delete the app check: red; (o) check the names of `values` only: a missing origin passes, red; (p) delete the `fits` step: red; (q) decode values as `Schema.Json`, not by their codec: red; (r) decode values without refusing excess keys: red; (s) delete the hash compare: red; (t) build the value codec from the snapshot's names, not the group's: one more setting passes, red | kalfa/config/src/SettingGroup.snapshot.test.ts |
| SN4, slice 1, the origin rule: for generated declarations (file scope, file-only or not, a default or not) and generated origins, `fits` is true exactly when a model of the rule says: the default only with a default; `--<name>` and `<APP>_<NAME>` only when not file-only; a file only by a name of a file in its scope, `.<app>/<app>.toml` for the repo and `~/.<app>/<app>.toml` or `$<APP>_HOME/<app>.toml` for the user. 100 runs | test | Effect Arbitrary: OriginCase | (p) accept any relative file name, as the old read does: another app's file fits, red; (p) let a variable fit a file-only setting: red; (p) let the default fit a required setting: red | kalfa/config/src/SettingGroup.snapshot.test.ts |
| SN5 [secrets], slice 1, a refused snapshot keeps its values out: a generated secret-looking text in a snapshot refused at each step never appears in the error's message, its cause, or `Cause.pretty`, in raw, JSON-escaped and URL-encoded forms. 100 runs | test | Effect Arbitrary: HiddenSnapshot | (x) put the decoder's issue in `cause` unredacted: red; (x) name the extra key in the step 3 message: red | kalfa/config/src/SettingGroup.snapshot.test.ts |
| SN11, slice 1, the stream's type: `snapshots(group)` is exactly `Stream<Snapshot, never, Identifier<App, R> \| Digest>`; the layer from files still leaves only the file system and the path (T3 unchanged) | type | type | type `snapshots`' requirement as `Identifier<App, R>` only and provide `Digest` inside: the exact-type line fails, tsc red; add `Digest` to the layer from files: T3 red | kalfa/config/src/SettingGroup.types.test.ts |
| T5, changed in slice 1: the reasons are ten, `snapshot` added | type | type | leave `"snapshot"` out of `SettingsError`'s literals: tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| O1, slice 1, the rest holds: B1 to B17, V1 to V19, FO1 to FO6, the edit and disk laws, `App.test.ts`, and the old snapshot laws in `next/packages/libfabrika/src/settings/Snapshot.test.ts` stay green with no edit after `hash` moves | test | pinned: their own generators, unchanged | sort the hash's keys in reverse when `hash` moves: the old hash law is red | kalfa/config/src/SettingGroup.live.test.ts, kalfa/config/src/App.test.ts, next/packages/libfabrika/src/settings/Snapshot.test.ts |
| SN6, slice 2, the receiver starts on the first and follows: for a generated group and a generated list of loader-made snapshots fed through a queue, the layer builds on the first; after each later item, each live field yields the last taken value and its `changes` gave exactly the distinct consecutive taken values; each restart field reads the first's value; `origins(group)` gives a live setting's last taken origin and a restart setting's first one; each restart value that differs from the last taken logs exactly one info line `<name> changed. It applies when <app> starts again.`; each refused item logs one warning ending `<app> keeps the last good values.` and moves nothing; the receiver's `snapshots(group)` gives the last taken. 100 runs, every class listed reached | test | Effect Arbitrary: Inbox | (i) set restart values from later snapshots too: red; (i) keep the first's origins for live settings: red; (j) compare a restart value with the first snapshot, not the last taken: a value that stays logs again and one that goes back logs nothing, red; (k) end the fold on a refused item: the next good one is not taken, red | kalfa/config/src/SettingGroup.fromSnapshots.test.ts |
| SN7, slice 2, the first item and the stream's end: a stream that ends before any item fails the layer with one `SettingsError`, reason `snapshot`, `no snapshot came before the stream ended.` and `<app> did not start.`; a first item of each misfit class fails the layer with SN3's error and that closing; a stream that ends after some items keeps the last taken values and logs one info line. 100 runs | test | Effect Arbitrary: Ending | (l) start on the defaults when no item comes: red; (l) log a refused first item and wait for the next: the layer never builds and the law times out, red | kalfa/config/src/SettingGroup.fromSnapshots.test.ts |
| SN8, slice 2, the shared rule: for a generated group and generated `before`, `after` and start origins, `updates` gives one `live` update with its value per live setting whose value differs and one `restart` update per restart setting whose value differs, in `after`'s order, and no other; `reported` gives a live setting's origin from `after` and a restart setting's from the start. 100 runs, every class listed reached | test | Effect Arbitrary: Pair | (v) zip `before` and `after` by place: a reordered `after` gives wrong updates, red; (w) compare with `===`: equal copies update, red; (y) find `before` by `before[name]` on a plain object: `constructor` finds Object's own function, red; (z) skip the settings the program did not declare: a window change logs nothing, red | kalfa/config/src/internal/apply.test.ts |
| SN9 [secrets], slice 2, logs and spans keep values out: a generated secret-looking text in a refused later snapshot, and as a restart value that changes, never appears in a warning or info line, its annotations, or a `config.update` span's attributes, in raw, JSON-escaped and URL-encoded forms. 100 runs | test | Effect Arbitrary: HiddenInbox | (x) put the new value in the restart line: red; (x) annotate the warning with the refused snapshot: red | kalfa/config/src/SettingGroup.fromSnapshots.test.ts |
| SN10, slice 2, each later item ends one root `config.update` span with `kalfa.config.app`, `kalfa.config.refused`, and `kalfa.config.reason` when refused, and no `kalfa.config.file`; the start runs in `config.layer` with the app. 100 runs | test | Effect Arbitrary: Inbox | (k) mark every update refused false: red; (i) open the update span as a child of the layer's: it is not a root, red | kalfa/config/src/SettingGroup.fromSnapshots.test.ts |
| SN12, slice 2, the receiver's type: `layerFromSnapshots(group, s)` with `s: Stream<unknown, never, RS>` is exactly `Layer<Identifier<App, R>, SettingsError, RS \| Digest>`, with no `FileSystem`, `Path` or `ConfigProvider`; a stream that can fail does not compile (`@ts-expect-error`); the group yields the same `Values` as from the layer from files; a `restart` update has no `value` (`@ts-expect-error`) | type | type | type the stream as `Stream<unknown, unknown, RS>`: the failing-stream line compiles, tsc red; build the receiver through `start`: `FileSystem` shows in its requirements, tsc red; give `restart` a `value` field: tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| P1, changed in slice 2: the installed archive's consumer starts a group from files, takes one snapshot from `snapshots`, starts the same group from a one-item stream with `layerFromSnapshots`, reads the same value, and compiles both declarations | test | scenario: one group and one snapshot through the installed archive | leave `layerFromSnapshots` out of `SettingGroup.ts`'s exports: the consumer's import fails to compile, red | kalfa/config/test/consumer.ts, kalfa/config/test/consumer.mjs, kalfa/config/src/Package.integration.test.ts |
| O2, slice 2, the file follower holds: V1 to V19 stay green with no edit after `publish` moves into `apply.ts`, V6's line keeps its file name, and V7's origins and V15's spans hold | test | pinned: their own generators, unchanged | call `apply` from `follow.ts` with no file name: V6 red | kalfa/config/src/SettingGroup.live.test.ts |

**Lint, type or test?** SN11, SN12 and T5 are shapes the compiler sees: type. Every other law is about what a stream,
a read or a layer answers at run time, which no type or lint rule sees: tests. No import shape changes, and no file
moves across a layer rule: no lint law.

**Where they run.** Every law but P1 runs in memory on every pull request: `MemoryFiles`, a test `ConfigProvider`, a
`Queue` as the carrier, `Digest.layerWebCrypto`, and Effect's `TestClock` for SN2. P1 is the existing
`.integration.` consumer check, which runs in CI only (the laptop refuses it by name); it is the thin check that the
packed archive behaves as the source does, and it needs a real install, so no stand-in will do. No law is host-only.

**Run time.** Each law stays under about 20 s at full depth on the laptop: at most three settings and the window, six
items or file changes a run, and SN2 at most eight starts a run (one fresh start per settled change). The tests step
times each new law once with `FABRIKA_TEST_DEPTH=full` and splits a law by class when it passes 20 s.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/snapshot.ts | build | 125 | slice 1, new: `Snapshot`, `hash` (moved), `make`, `fits`, `read`, `same` |
| kalfa/config/src/Snapshot.ts | build | 5 | slice 1: imports `hash` from `internal/snapshot.ts` in place of its own |
| kalfa/config/src/internal/place.ts | build | 6 | slice 1: `homeName` and `fileNames`; `userPlace` uses `homeName` |
| kalfa/config/src/internal/read.ts | build | 1 | slice 1: exports `Settled` |
| kalfa/config/src/internal/start.ts | build | 8 | slice 1: `Resolved.taken`, a `SubscriptionRef` of the resolved list |
| kalfa/config/src/internal/follow.ts | build | 4 | slice 1: `take` sets `taken` after `publish` |
| kalfa/config/src/internal/error.ts | build | 3 | slice 1: the reason `snapshot` and its line in the doc comment |
| kalfa/config/src/SettingGroup.ts | build | 30 | slice 1: `snapshots`, the `Snapshot` type, `Started.snapshots` |
| kalfa/config/README.md | build | docs | slice 1: a section "Settings for a process that cannot read files", the stream half |
| kalfa/config/GLOSSARY.md | build | docs | slice 1: **Snapshot** gains its app and the stream; **Loading process** is new |
| kalfa/config/src/SettingGroup.snapshot.test.ts | tests | tests | slice 1, new: SN1 to SN5 |
| kalfa/config/src/SettingGroup.snapshot.test-support.ts | tests | tests | slice 1, new: the generators and their reach checks; slice 2 adds the receiver's |
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | slice 1: SN11 and T5; slice 2: SN12 |
| kalfa/config/src/SettingGroup.live.test.ts | tests | tests | O1 and O2: no change, stays green |
| kalfa/config/src/App.test.ts | tests | tests | O1: no change, stays green |
| next/packages/libfabrika/src/settings/Snapshot.test.ts | tests | tests | O1: no change, stays green |
| kalfa/config/src/internal/apply.ts | build | 45 | slice 2, new: `Update`, `updates`, `reported` and `apply`, moved out of `follow.ts`'s `publish` |
| kalfa/config/src/internal/receive.ts | build | 75 | slice 2, new: `receive` and its `update` |
| kalfa/config/src/internal/follow.ts | build | 8 | slice 2: `publish` goes, `take` calls `apply` with the file's name |
| kalfa/config/src/internal/start.ts | build | 12 | slice 2: `running` moves out of `start` and is exported |
| kalfa/config/src/SettingGroup.ts | build | 30 | slice 2: `layerFromSnapshots` and its doc |
| kalfa/config/README.md | build | docs | slice 2: the section's receiver half |
| kalfa/config/src/SettingGroup.fromSnapshots.test.ts | tests | tests | slice 2, new: SN6, SN7, SN9, SN10 |
| kalfa/config/src/internal/apply.test.ts | tests | tests | slice 2, new: SN8 |
| kalfa/config/test/consumer.ts | tests | tests | slice 2: P1's typed half |
| kalfa/config/test/consumer.mjs | tests | tests | slice 2: P1's run half |
| kalfa/config/src/Package.integration.test.ts | tests | tests | slice 2: P1, no change; it runs the consumer files |

No change to `kalfa/config/src/index.ts` (the new calls live on `SettingGroup`), the package manifest, the lockfile or
the layer rules: no export entry, dependency or file across a layer rule changes.

## Existing tools

- kalfa/config/src/internal/snapshot.ts: searched `kalfa/config/src/Snapshot.ts` (the old API's snapshot: typed on
  the old `Setting.Group` with `path`, `env` and `app.home`, so its `make` and `read` cannot take a new group; its
  hash is reused, moved), `kalfa/config/src/Codec.ts` (`values` takes the old group; the per-setting step is
  `Schema.toCodecJson`, which the new code calls itself), Effect 4.1.3's `Schema.toCodecJson`, `Schema.Json` and
  `onExcessProperty: "error"` (used), `effect/crypto/Digest` (used), and `RpcWorker.initialMessage` (decodes one
  value by a schema, with no origin or group check and tied to RPC). New, about 125 lines.
- kalfa/config/src/internal/apply.ts: searched `internal/follow.ts` (`publish` is the rule, moved here whole and
  split into the pure `updates` and `reported` and the effectful `apply`), Erlang's `config_change/3` (from memory:
  the same "only what changed" idea, no code to reuse), and Effect's `Differ` (a patch type per data type, not a
  per-setting live or restart split). New, about 20 lines beyond what moves.
- kalfa/config/src/internal/receive.ts: searched `internal/start.ts` and `internal/follow.ts` (reused: `running`,
  `Resolved`, `apply`, the closing sentence and the `config.update` span shape), `internal/live.ts` (`reading`,
  reused), Effect 4.1.3's `Stream.peel` with `Sink.head`, `Stream.runFoldEffect` and `SubscriptionRef` (used), and
  Effect's `workers/Worker.ts` and `rpc/RpcWorker.ts` (a carrier, which the app picks; Configuration takes any
  stream). New, about 75 lines.
- `homeName` and `fileNames` in kalfa/config/src/internal/place.ts: searched `place.ts` (`shown` gives the repo and
  `~` names; `userPlace` builds the `$<APP>_HOME` name inline, so it moves into `homeName`) and the old
  `Snapshot.ts` origin check (a regex over any relative name, which this replaces for the new API). New, about 6
  lines.
- `running` in kalfa/config/src/internal/start.ts: today's loop in `start`, moved out unchanged so the receiver calls
  it. No new logic.
- `snapshots` and `layerFromSnapshots` in kalfa/config/src/SettingGroup.ts: the protocol's names. They wrap `key`,
  `typed` and `watched`, which exist.

## Calls taken

Each picks how the code does what the protocol's line, 1806's note or the glossary already say. The two under 80% are
at the top.

- **Two pull requests, the stream first.** 85%. The stream and its read are what an app carries and tests against;
  the receiver builds on both. Each is under 200 product lines.
- **The snapshot names its app.** 85%. The 1838 plan said so for the first kalfa snapshot.
- **The window is in the snapshot.** 85%. The group's `Origins` type holds it (TL4), so both layers report the same
  keys.
- **The hash stays, and with it `Digest` on both sides.** 80%. The protocol keeps the snapshot schema whole; `same`
  and a Worker's own run record can use it. The doubt: nothing yet needs the hash for safety, since the strict read
  checks each value anyway.
- **`fits` is stricter than the old origin check.** 85%. "Does not fit the group" covers an origin no start of this
  group could give: a file outside the scope, a variable for a file-only setting, another app's file.
- **The receiver takes `Stream<unknown, never>`.** 80%. A carrier's payload is `unknown` after a structured clone,
  so the strict read is the type check; and a carrier's failure is the app's, so the type does not let one in.
- **A stream that ends logs one info line and keeps the values.** 80%. It is a quiet end at shutdown, and a hint when
  a carrier breaks, as a file that cannot be watched logs one line (V10).
- **A restart line from a snapshot names no file.** 80%. No file was read on the receiver. The snapshot's origin
  could name one, but it describes the loader's start, not this change.
- **`publish` moves into `apply.ts`.** 85%. One rule for both followers, as the review of 2038 asked: a rule in prose
  becomes a named piece with its own law (SN8).
- **The README gains one section.** 80%. A Worker author needs the two calls, as the edit got its sections before
  1849's rewrite.
- **Is this a setting?** No new choice is. No limit is added: the loader's stream rides the `SubscriptionRef`'s
  unbounded `PubSub` with `replay: 1`, and how fast items cross is the carrier's. What fits a group, which changes
  apply and the messages are the same for every app, and no person would pick them per repo.

## Where this departs from today's code

- `follow.ts`'s `publish` moves into `apply.ts`; the file follower's behavior and log lines do not change (O2).
- The old `Snapshot.ts` imports its hash from `internal/snapshot.ts`; its behavior does not change (O1).
- `Started` and `Resolved` gain one field each. No public type a caller holds changes.

## Validation

- Slice 1, tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/SettingGroup.snapshot.test.ts` shows SN1 to
  SN5 red on the branch head (no `snapshots` yet); each new law timed once at full depth.
- Slice 1, build step: the same path plus `kalfa/config/src/SettingGroup.live.test.ts`,
  `kalfa/config/src/App.test.ts` and `next/packages/libfabrika/src/settings/Snapshot.test.ts` green, each plant run
  once and undone; `pnpm format` and `pnpm lint`.
- Slice 2, tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/SettingGroup.fromSnapshots.test.ts
  kalfa/config/src/internal/apply.test.ts` shows SN6 to SN10 red.
- Slice 2, build step: the same paths plus `kalfa/config/src/SettingGroup.live.test.ts` green, each plant run once and
  undone; `pnpm format` and `pnpm lint`.
- The lead runs the changed-tests run and one full type check for each slice (SN11, SN12 and T5 are judged there), and
  P1 runs in CI; none of these runs in a box.

## Size

1. The loader's stream and the strict read: 182 lines (`internal/snapshot.ts` 125, `SettingGroup.ts` 30,
   `internal/start.ts` 8, `internal/place.ts` 6, `Snapshot.ts` 5, `internal/follow.ts` 4, `internal/error.ts` 3,
   `internal/read.ts` 1), plus one new test file, one new support file and an edit to the type laws.
2. The layer from snapshots: 170 lines (`internal/receive.ts` 75, `internal/apply.ts` 45 of which about 25 move from
   `follow.ts`, `SettingGroup.ts` 30, `internal/start.ts` 12, `internal/follow.ts` 8), plus two new test files and
   edits to the support file, the type laws and the consumer.

About 4 agent hours across both slices' tests, build and review, 75% sure. The doubt is SN2 and SN6: scripts of
changes and queued snapshots need the live laws' settle-and-flush helpers, which sit inside
`SettingGroup.live.test.ts` and are not exported, so the support file writes its own. Basis: the 1841 live plan and
the 1844 record plan, priced at about $8 a step for Opus steps. Steps: tests, build and review for each slice, plus one
likely send-back of tests and build in one of them.

Estimate: 8 steps, $64

## New names

- `SettingGroup.snapshots` and `SettingGroup.layerFromSnapshots`: the protocol's own names.
- `SettingGroup.Snapshot`: the type of one item, the glossary's **Snapshot**.
- `snapshot`: the new `SettingsError` reason.
- `Update` with cases `live` and `restart`, `updates`, `reported`, `apply`: code names inside `internal/apply.ts`.
  `config.update` is already the span's name for one taken change.
- `fits`, `same`, `make`, `read`, `hash` in `internal/snapshot.ts`; `homeName` and `fileNames` in `internal/place.ts`;
  `running` in `internal/start.ts`; `receive` in `internal/receive.ts`; `taken`, a field of `Resolved`.
- `SettingGroup.snapshot.test.ts` and `SettingGroup.fromSnapshots.test.ts`: test files named for the two calls.

## Records

- `kalfa/config/GLOSSARY.md` (slice 1):
  - **Snapshot** becomes: "A checked record of every loaded value of one app and its origin. A process that cannot
    read files starts from a stream of them." _Avoid_ stays: dump, export, resolved config.
  - **Loading process**, new under "What was loaded": "The process that reads an app's configuration files and gives
    a stream of snapshots to a process that cannot read them, as a Worker." _Avoid_: main process, parent, host,
    server.
- `kalfa/config/README.md`: one section, in two halves.
- No decision record: the protocol (https://github.com/kamp-us/tea-fabrika/issues/1749) settled the two calls, and
  the two calls under 80% are easy to change before any caller exists.
- No pattern doc: `.kalfa/patterns/settings.md` describes `next/` settings until 1849.
- On https://github.com/kamp-us/tea-fabrika/issues/1849, the lead notes that the snapshot's `hash` now lives in
  `kalfa/config/src/internal/snapshot.ts`, so deleting `Snapshot.ts` keeps it, and that the new `read` replaces the
  old one for the new API.

## What this cannot tell us

- How a real Worker carries the stream. Every law feeds a `Queue`. A carrier that clones or JSON-encodes each item is
  the app's; JSON would turn `-0` into `0`, which the read accepts as `0`. Unchecked.
- Whether a stream that ends at shutdown and one that breaks need different lines. Both log the same info line.
- What a Worker shows for a restart setting that waits for a restart: its start value and origin, while the newest
  snapshot carries the new one. Show state (1846 and the state page) will tell if a person needs both.
- Whether the loader's stream should end when its layer closes. Today it waits, as a `Live`'s `changes` does.
- A loader and a Worker built from different versions of the group: the read refuses the snapshot (class (t)), and
  the Worker stays on its last good values until both run the same build. No law tells the person which side is old.

## Open questions

None.

Every choice above picks how the code does what the protocol's line, 1806's note on this ticket or the glossary
already say. The two calls under 80% are for the lead's read, not the owner's: no ruling covers them, and the owner
could not say no to either without changing a decided line.

## Lead's calls at signing (2026-11-23)

- (a) Kept: a snapshot carries the files as last taken, so a restart change can reach the Worker.
- (b) Kept: a misfit snapshot fails with a new `SettingsError` reason, `snapshot`; T5's nine reasons become ten.
- Finding 1 (`law-ids.ts` crash) is fixed in its own tooling pull request, not here. Finding 2 stays with 1849, as the plan says.

## Findings

1. **The law-id lint step (`law-ids.ts` in the oxlint plugins folder) crashes when git cannot list the folder it is
   given.** Proof: running it with `--help` as its one argument, in this worktree, throws `TypeError: Cannot read properties of undefined (reading
   'split')` at line 56 and exits 1. Its header says exit 2 "when git listed nothing, which must never read as clean",
   and exit 1 is a clash. The cause: `spawnSync` with a `cwd` that does not exist returns no `stdout`, and the status
   check runs after the `split`. The fix is to check `listed.error` and `listed.status` before reading `stdout`. Out
   of this ticket; the lead may file it.
2. **The old `Snapshot.read` accepts another app's file origin.** In `kalfa/config/src/Snapshot.ts`, `declaredOrigin`
   accepts any relative file name, so a snapshot of app `demo` whose origin names `.other/other.toml` reads. This plan's
   `fits` refuses it for the new API (SN4). The old API goes with 1849, so no fix is planned there.

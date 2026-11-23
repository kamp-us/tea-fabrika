Approved by the lead agent, builds issues 1764, 2082; body 330edf0cbb04
Plancheck-Version: 3

# Plan: @kalfa/ledger, append and read an entry, in memory (ticket 2082)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2082, the first build ticket of the new package `@kalfa/ledger`. Its parent
is the settled protocol, https://github.com/kamp-us/tea-fabrika/issues/1764 (closed), with the owner's answers on its
gaps in https://github.com/kamp-us/tea-fabrika/issues/1764#issuecomment-7084116974 (from
https://github.com/kamp-us/tea-fabrika/issues/1899), the expected-revision ruling in
https://github.com/kamp-us/tea-fabrika/issues/1920#issuecomment-7091204466 (decision 0090), and the entry id ruling in
https://github.com/kamp-us/tea-fabrika/issues/1864#issuecomment-7075107537. `kalfa/ledger/` holds only `GLOSSARY.md`
today. Today's ledger in `next/packages/libfabrika/src/ledger/` is read as a map and left alone (issue 1866).

Words: `kalfa/ledger/GLOSSARY.md` (log, stream, entry, entry id, metadata, slot, revision, position, head, append,
read) and the Shared names, `kalfa/GLOSSARY.md` (tag). New words are under `## New names`.

```ts
// The whole idea, a sketch. Calls named here were read in Effect 4.1.3; nothing was type-checked.
import { Effect, Stream } from "effect"
import { EntryId, EntryName, Ledger, Revision } from "@kalfa/ledger"
import * as MemoryLedger from "@kalfa/ledger/memory"

const request = EntryId.make("req-7f3a")                            // the writer makes the id, always

const program = Effect.gen(function* () {
  const ledger = yield* Ledger.Ledger
  const placed = yield* ledger.append("ci/requests", request,
    { _tag: "Requested", body: { commit: "abc123" } },
    { expectedRevision: Revision.make(0) })                         // kept only while the stream is empty
  // placed: Placed { revision: 1, position: 1 }
  const entries = yield* Stream.runCollect(ledger.read("ci/requests", Revision.make(0), { tags: ["Requested"] }))
  const owed = EntryId.child(EntryName.make("owed"), request)       // "owed:req-7f3a", pure, never fails
  return { placed, entries, owed }
}).pipe(Effect.provide(MemoryLedger.layer()))                       // limits.bytes defaults to 2,000,000
// Effect<..., Refusal | Failure>: BadEntry | IdReused | TooBig | AdmissionRefused | RevisionConflict
//                                 | Unreachable | BadRow | StorageFailed
```

## Doubts, at the top

Each is a call this plan takes and builds on. Each is under 80% sure, so it says what would settle it.

- **`Revision` and `Position` are branded numbers (75%).** A revision a caller passes back (`after`,
  `expectedRevision`) nearly always comes from the ledger itself (`Placed`, an `Entry`), so a brand costs those
  callers nothing and stops `-1` or `1.5` at compile time. The cost: the ticket's `{ expectedRevision: 0 }` is written
  `{ expectedRevision: Revision.make(0) }`. A run-time guard covers a cast (B1, class (j)). What settles it: the first
  caller's build (Program's takeover, CI's choice of a build). Before v0.0.0 dropping a brand breaks no stored data.
- **`AdmissionRefused.reason` is text (70%).** The ticket declares the error now and raises it first in
  https://github.com/kamp-us/tea-fabrika/issues/2085, and decision 0078 sketches `Result<void, Reason>` with no type for
  `Reason`. Text crosses every wire (2088's stub, 2090's connection) and holds no body. The doubt: Permissions' admission
  may want a tagged reason. What settles it: 2085's plan, which may widen the field before any admission exists.
- **A synchronous SHA-256 comes from `fast-sha256` 1.3.0 (75%).** `EntryId.child` must be pure and never fail, and
  Effect's `Digest` is an Effect over WebCrypto, which is async. `fast-sha256` is pure JavaScript, has no
  dependencies, runs in a browser, Node and a Worker, is public domain, and is already in the store (through
  `standardwebhooks`), so `pnpm install --offline` adds it with no network. The doubt is its age: it has not changed in
  years (SHA-256 has not either). I2 checks it against `node:crypto` on every run. What settles it: the review's read;
  `@noble/hashes` is the other pick, and it needs a network install the lead makes.
- **A stream name is non-empty, well-formed text, with no grammar (75%).** No ruling gives stream names a shape, and
  today's names hold `/` and `:` (`gateway/access`, `alpha:1/events`). Lone surrogates are refused because a SQLite
  provider (2087) would store them changed, and the memory ledger must behave as that one will. A long name goes into
  the span whole; OpenTelemetry caps attribute length in the exporter, as a setting there. What settles it: the first
  package that lists streams by prefix (2086's `streams`), which may want a grammar.
- **An empty `tags` list is a defect (70%).** The type asks for a non-empty list, so an empty one is a type hole. A
  read with no tags to match could also give nothing, quietly. Loud is chosen, as the plan rules ask of a type hole.
  What settles it: the first caller that builds its tags at run time.
- **The memory `read` takes its entries at the call (75%).** It is `Stream.unwrap` over one `Effect.fn("ledger.read")`
  step that copies the entries after `after`, so the span covers taking them, and an append made while the stream is
  consumed is not in it. Today's referee reads in pages instead. The laws hold only "after, oldest first, once", which
  both ways keep. What settles it: 2087's plan, if a page-by-page read must make one span per page.

## What changes, in one paragraph

A new private workspace package, `@kalfa/ledger`, in two pull requests. The first holds the shapes every user of the
Ledger types against: `EntryId` with `EntryName` and `EntryId.child`, `Revision`, `Position`, `NewEntry`, `Entry`,
`Placed`, the eight errors with the `Refusal` and `Failure` unions, the `Settings` schema with its default, and the
`Ledger` service with `append` and `read`. The second gives the memory ledger (`@kalfa/ledger/memory`), the laws every
provider passes (`@kalfa/ledger/test`), the spans, and the `expectedRevision` option at work. The core imports no
kalfa package and ranks lowest. Out of scope, each its own ticket: a transaction (2083), stamps (2084), admissions
(2085), `wait`, `streams` and `RemoteLedger` (2086), SQLite (2087), Cloudflare (2088, 2089), the remote ledger (2090),
and moving `next/` onto this package (1866).

## Slices

Each slice is its own pull request, the second branched from main after the first lands, as the lead skill says.

1. **The shapes.** Branch `fabrikalfa/kalfa-ledger` (this worktree). The package, its manifest, lint override, rank
   rows and lockfile; `EntryId.ts`, `Entry.ts`, `Errors.ts`, `Settings.ts`, `Ledger.ts` and the root; the README's
   first half; the glossary terms. It lands whole: Chat, CI and Program can type against `Ledger`, build their entry ids
   with `EntryId.child`, and wrap `Failure` as their own `<Package>Unavailable`. The pull request says `Part of #2082`.
2. **The memory ledger and its laws.** Branch `fabrikalfa/kalfa-ledger-memory`. `internal/checks.ts`,
   `internal/spans.ts`, `MemoryLedger.ts`, `LedgerTest.ts` with `suite` and `spans`, the manifest's `./memory` and
   `./test` exports with the optional test peers, and every behavior law. It lands whole: a caller appends, reads,
   resends and appends on condition against the memory ledger, and every later provider runs the same laws. It says
   `Closes #2082`.

## Searched first

- The ticket whole. The parent 1764 with its six comments (the resolution, the gaps, decision 0078's list, the 1876
  answer, the owner's two answers). 1899, 1920 with the owner's ruling, 1864 with both comments, 1870, 2018.
- The sibling tickets 2083, 2084, 2085, 2086, 2087, 2088, 2089 and 2090, for what they need from this one: 2083 and 2085
  reuse the entry checks inside a transaction and an admission; 2084 fills `metadata`; 2086's `RemoteLedger.append`
  takes the same option and error; 2087, 2088 and 2090 run every law in `/test` through their own provider, so the laws
  take a provider as a parameter and assume nothing of memory.
- Decisions 0048, 0063, 0076, 0078, 0079 and 0090 whole; 0009, 0049, 0061, 0081 and 0083 by their hits. `kalfa/AGENTS.md`,
  `kalfa/GLOSSARY.md`, `kalfa/ledger/GLOSSARY.md`, `kalfa/chat/GLOSSARY.md` (reply id).
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and `.kalfa/research` for
  "expected revision|expectedRevision|wrong expected", "entry id|EntryId", "too_big|row limit|ROW_BYTES",
  "resend|id_reused" and "arrivedAt". Every hit read. Patterns read: `effect-errors-keep-their-cause.md`,
  `effect-crypto-through-services.md`, `settings.md`. Research read: `.kalfa/research/ledger-metadata-prior-art.md`.
- Today's `next/packages/libfabrika/src/ledger/Ledger.ts`, `Log.ts` and `internal/ledgerStore.ts` (the check order, the
  size count, the resend rule, `arrivedAt` as the max of the clock and the last one, the span keys), as a map only.
  There `pos` is the place in the stream and `rev` the place in the log, the swap the ticket names.
- The newest kalfa packages for layout and wiring: `kalfa/secrets/` (its `/memory` and `/test` entry points, its
  `Subject` and `suite`, its Redacted causes, its `Package.test.ts`, its leak helpers), `kalfa/git/` (its `Settings`
  schema and its lint override in `.oxlintrc.json`), `kalfa/cli/`, and `kalfa/transport/` on branch
  `fabrikalfa/kalfa-transport` (its approved plan, its tracer held in memory, its span and leak laws).
- `layer-rules.json`, `boundary-rules.json`, `oxlint-plugins/layers.test.ts`, `.oxlintrc.json` (the kalfa Effect block
  and the git override), `vitest.config.ts` (its kalfa globs already take the new files).
- Installed versions in `pnpm-lock.yaml`: `effect` 4.1.3 (patched: arbitraries, `TestConsole`, a test host; nothing
  here leans on the patch), `vitest` 5.0.5 (patched), `fast-check` 4.10.2 (not used), `fast-sha256` 1.3.0. In Effect
  4.1.3, read: `node_modules/effect/AGENTS.md` whole; `Equal.equals` (structural, `-0` equals `0`, plain objects by
  keys in any order); `Schema.Json`, `Schema.TaggedError`, `Schema.Redacted`, `Schema.brand`, `Schema.isPattern`;
  `Clock` and `TestClock.setTime` (which may move time back); `Effect.withTracerEnabled`; `Stream.unwrap`;
  `encoding/Base64Url`; `eventlog/EventJournal.ts` (`Entry`, `makeMemory`).
- `node oxlint-plugins/law-ids.ts` ran clean on this worktree. `kalfa/ledger/` has no laws yet, so every id this plan
  uses is free in its package.

## Probes run while planning

Two throwaway scripts, run with Node 26 against this worktree's installed packages. Nothing was installed or
committed. One script was copied into `kalfa/secrets/` for a few seconds so it could resolve `effect`, then deleted; the
worktree is clean.

- **`Schema.is(Schema.Json)`** refuses a sparse array, a `Date`, an object with `toJSON`, a class instance, `NaN`,
  `Infinity`, a `BigInt`, a `Map`, `undefined` in an array and `{ a: undefined }`. It takes `-0`, an own `__proto__` key
  from `JSON.parse`, a null-prototype object, an object with a getter, an object with a symbol key, a lone surrogate in
  a string, and 5,000 levels of nesting. `Equal.equals` says `-0` equals `0`, `{a,b}` equals `{b,a}`, and two parsed
  own-`__proto__` objects are equal. So the memory ledger keeps each body as JSON text, as a SQLite row will, and the
  laws compare a read with the JSON round trip of what was sent.
- **`fast-sha256`'s `hash`** gives the same base64url text as `node:crypto` for `"abc"`
  (`ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0`, 43 characters). Its named export `hash` loads from an ES module.

## How others do it

- **EventStoreDB, now KurrentDB** (from memory, not fetched): `appendToStream(stream, events, { expectedRevision })`
  where the revision is a number, `"no_stream"` or `"any"`; a mismatch fails with `WrongExpectedVersion`, carrying the
  expected and the actual revision. A stream revision counts inside a stream; the commit and prepare position orders the
  whole log. Idempotence is by event id, only for recent events. This plan takes the option and the two numbers, uses
  `0` for "no stream" as the ticket says, has no `"any"` (leaving the option out is "any"), and keeps the stricter
  resend rule the protocol chose.
- **NATS JetStream** (from memory, not fetched): `Nats-Expected-Last-Subject-Sequence` is the same check per subject,
  and `Nats-Msg-Id` drops a resend within a window. The window is the part we do not take: our id lives on the entry.
- **Stripe idempotency keys** (as 1809 cites them): a repeat gets the saved first answer, a changed body is an error,
  and a key is up to 255 characters. This is the resend rule and `EntryId`'s length.
- **Erlang/OTP** (from memory, not fetched): one process owns the log and handles one append at a time
  (`disk_log`, a `gen_server`), so the check and the write never interleave. The memory ledger does the same with one
  synchronous step per append: nothing can run between the check and the keep.
- **Elm**: no storage of its own; nothing to take.
- **Effect** (read in 4.1.3): `effect/eventlog`'s `EventJournal` has a memory journal (`makeMemory`) that keeps entries in
  an array and writes in one step, and its `Entry` is a `Schema.Class`. Its ids are made by the journal (UUIDv7), which
  issue 1864 rules out for us, so the module is a model, not a dependency. A service is a `Context.Service` and a
  provider a `Layer`, as `@kalfa/secrets` does.
- **OpenTelemetry messaging** (from memory, not fetched): `messaging.system`, `messaging.operation.name`,
  `messaging.operation.type` (`send`, `receive`), `messaging.destination.name`, `messaging.message.id`,
  `messaging.batch.message_count`, and `error.type`. Today's referee uses the same names.

## The shape

### The package

```text
kalfa/ledger/
  package.json        @kalfa/ledger, private; no build step, as @kalfa/secrets
  tsconfig.json       as kalfa/secrets's, with the Effect checks
  README.md           the calls, the checks in order, the resend rule, the size count, the spans, what never shows
  GLOSSARY.md         gains the new terms
  src/
    index.ts          slice 1: the root entry point
    EntryId.ts        slice 1: EntryId, EntryName, child
    Entry.ts          slice 1: Revision, Position, Metadata, NewEntry, Entry, Placed
    Errors.ts         slice 1: the eight errors, Refusal, Failure
    Settings.ts       slice 1: Settings, defaults
    Ledger.ts         slice 1: the Ledger service, AppendOptions, ReadOptions
    internal/checks.ts  slice 2: the entry checks, the size count, the same-body rule
    internal/spans.ts   slice 2: the span attribute names
    MemoryLedger.ts   slice 2: the /memory entry point
    LedgerTest.ts     slice 2: the /test entry point (the tests step's)
```

```jsonc
// kalfa/ledger/package.json after slice 2, a sketch. Slice 1 has only "." and "./package.json" and the one peer effect.
{
  "name": "@kalfa/ledger", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "typecheck": "tsc --noEmit" },
  "exports": { ".": "./src/index.ts", "./memory": "./src/MemoryLedger.ts", "./test": "./src/LedgerTest.ts",
               "./package.json": "./package.json" },
  "dependencies": { "fast-sha256": "1.3.0" },
  "peerDependencies": { "effect": "catalog:", "@effect/vitest": "catalog:", "vitest": "catalog:" },
  "peerDependenciesMeta": { "@effect/vitest": { "optional": true }, "vitest": { "optional": true } },
  "devDependencies": { "@effect/vitest, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

### Entry ids

```ts
// kalfa/ledger/src/EntryId.ts, a sketch. Doc blocks left out.
/** The Ledger's one id shape: 1 to 255 of A-Z a-z 0-9 - _ . : (the rule Chat's ReplyId has). */
export const EntryId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.:-]{1,255}$/)).pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

/** A fixed word that tells one kind of entry from another: 1 to 209 of A-Z a-z 0-9 - _, so never "." or ":". */
export const EntryName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,209}$/)).pipe(Schema.brand("EntryName"))
export type EntryName = typeof EntryName.Type

/** `<name>:<parent>` when it fits in 255 characters, else `<name>.h:<SHA-256 of parent, base64url, 43 characters>`. */
export const child: (name: EntryName, parent: EntryId) => EntryId
```

- 209 is derived, not picked: `209 + ".h:".length + 43 = 255`, so the hashed form always fits and `child` never fails.
- The parent is hashed as its UTF-8 bytes (ASCII, by `EntryId`'s rule) with `fast-sha256`'s `hash`, and written with
  Effect's `Base64Url.encode`, which writes no padding.
- A plain id's kind (the text before its first `:`) is the name; a hashed id's kind is `<name>.h`. No name holds `.`, so
  the two never meet, and no name holds `:`, so a plain id splits back into one name and one parent.
- Another package's own id is this type under its own name, with no mapping: `export type ReplyId = EntryId`.

### Entries

```ts
// kalfa/ledger/src/Entry.ts, a sketch.
export const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("Revision"))
export const Position = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("Position"))
/** Named slots, one per package. The ledger keeps them and never reads them. */
export const Metadata = Schema.Record(Schema.String, Schema.Json)

/** An entry as its writer hands it to append. */
export const NewEntry = Schema.Struct({
  _tag: Schema.NonEmptyString,                    // the writer's case, well-formed text
  body: Schema.Json,
  metadata: Schema.optionalKey(Metadata),         // {} when left out
})

/** An entry as read gives it back: exactly these eight keys. */
export const Entry = Schema.Struct({
  id: EntryId, stream: Schema.NonEmptyString, revision: Revision, position: Position,
  arrivedAt: Schema.Int,                          // the ledger's clock, ms since 1970
  _tag: Schema.NonEmptyString, body: Schema.Json, metadata: Metadata,
})

export class Placed extends Schema.TaggedClass<Placed>()("Placed", { revision: Revision, position: Position }) {}
```

`body` is typed `Schema.Json`, so a body typed as a TypeScript `interface` does not compile (an interface has no index
signature). A caller encodes its value with its own schema first (`Schema.toCodecJson`); D4 shows each typing and the
README says so.

### Errors

```ts
// kalfa/ledger/src/Errors.ts, a sketch. Each is a Schema.TaggedError, so it crosses a wire as data.
// Refusals: the ledger will not keep this entry.
export class BadEntry extends Schema.TaggedError<BadEntry>()("BadEntry", {
  part: Schema.Literals(["stream", "id", "entry", "tag", "body", "metadata", "expectedRevision"]),
}) {}
export class IdReused extends Schema.TaggedError<IdReused>()("IdReused", {}) {}
export class TooBig extends Schema.TaggedError<TooBig>()("TooBig", { bytes: Schema.Int, limit: Schema.Int }) {}
export class AdmissionRefused extends Schema.TaggedError<AdmissionRefused>()("AdmissionRefused", {
  admission: Schema.String, reason: Schema.String,  // first raised in 2085
}) {}
export class RevisionConflict extends Schema.TaggedError<RevisionConflict>()("RevisionConflict", {
  expected: Revision, actual: Revision,             // actual: the stream's head revision now
}) {}
// Failures: the ledger could not answer. The cause is hidden: a row or a driver's error can quote a body.
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Redacted(Schema.Defect()) }) {}
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Redacted(Schema.Defect()) }) {}
export class StorageFailed extends Schema.TaggedError<StorageFailed>()("StorageFailed", { cause: Schema.Redacted(Schema.Defect()) }) {}

export const Refusal = Schema.Union([BadEntry, IdReused, TooBig, AdmissionRefused, RevisionConflict])
export type Refusal = typeof Refusal.Type
export const Failure = Schema.Union([Unreachable, BadRow, StorageFailed])
export type Failure = typeof Failure.Type
```

- No error carries a body or metadata. `BadEntry` says which part was bad and nothing of its content.
- The three failures take their cause as `Redacted`, as `@kalfa/secrets` does: every caller that makes one has a cause
  (a thrown driver error, a failed decode, a dropped call), so the field is required (75%; a provider with no cause
  passes `Redacted.make(undefined)`, and 2087's plan may make it `Schema.optional`). No provider in this ticket raises a
  failure; the laws show the classes hide their cause (X3).
- A package above wraps them as the pattern and 2018 say: `class ChatUnavailable { reason: Ledger.Failure }` with
  `override readonly cause = this.reason`, and `ChatRefused { reason: Ledger.Refusal }`. The unions are exported for
  that, so a wrapper needs no list of its own. Only the Ledger uses the name `Unreachable` (1870).

### Settings

```ts
// kalfa/ledger/src/Settings.ts, a sketch, shaped as @kalfa/git's.
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export const Settings = Schema.Struct({ limits: Schema.Struct({ bytes: Count }) })
export type Settings = typeof Settings.Type
export const defaults: Settings = { limits: { bytes: 2_000_000 } }  // Cloudflare's row limit, today's ROW_BYTES
```

The core imports no kalfa package, so it cannot declare a `@kalfa/config` setting. It exports the schema and the
default; the app that puts the Ledger together reads the value through its own settings and hands it to the layer.
`MemoryLedger.layer(settings?)` checks the value with `Schema.is(Settings)` when the layer is built, and a value the
types let through but the schema refuses (`0`, `-1`, `1.5`, `NaN`, `Infinity`, text through a cast) kills the build with
a defect that names `limits.bytes` (80%): it is the code's mistake, not a failure a caller can handle.

### The service

```ts
// kalfa/ledger/src/Ledger.ts, a sketch.
export interface AppendOptions { readonly expectedRevision?: Revision }
export interface ReadOptions { readonly tags?: Arr.NonEmptyReadonlyArray<string> }

export class Ledger extends Context.Service<Ledger, {
  readonly append: (stream: string, id: EntryId, entry: NewEntry, options?: AppendOptions)
    => Effect.Effect<Placed, Refusal | Failure>
  readonly read: (stream: string, after: Revision, options?: ReadOptions)
    => Stream.Stream<Entry, Failure>
}>()("@kalfa/ledger/Ledger") {}
```

`wait`, `streams` and `transaction` join this service in 2086 and 2083. There is no append without an id.

### One append, step by step

Every provider keeps this order. The first refusal wins, and a refused append keeps nothing.

```text
inside Effect.fn("ledger.append"), so a refusal leaves its span too:
 1. stream: non-empty, well-formed text                          else BadEntry "stream"            class (e)
 2. id: decodes as EntryId                                       else BadEntry "id"                class (f)
 3. entry: a plain object whose own keys are _tag, body and,
    maybe, metadata; nothing read from its prototype             else BadEntry "entry"             class (g)
 4. _tag: non-empty, well-formed text                            else BadEntry "tag"               class (h)
 5. body: Schema.Json                                            else BadEntry "body"              class (c)
 6. metadata: Metadata                                           else BadEntry "metadata"          class (i)
 7. expectedRevision, when given: decodes as Revision            else BadEntry "expectedRevision"  class (j)
 8. bytes = UTF-8 bytes of stream + id + _tag + JSON text of body + JSON text of metadata
    bytes <= settings.limits.bytes                               else TooBig { bytes, limit }      class (k)
in one synchronous step, so nothing runs between the check and the keep:
 9. the stream holds this id: same _tag and same body as JSON    -> the first Placed               class (l)
                              another _tag or another body       -> IdReused                       class (m)
10. expectedRevision given and the head's revision differs       -> RevisionConflict { expected, actual }  (r), (s)
11. keep: revision = head + 1, position = log head + 1,
    arrivedAt = max(clock now, last arrivedAt)                   -> Placed { revision, position }  (o), (q)
```

- Step 8 counts what today's referee counts, mapped to the new entry: the slots in metadata take the place of `by`,
  `for`, `sentAt`, `traceId` and `build` (85%). It does not count the revision, position or clock, so a resend counts
  the same bytes wherever it lands. At the limit is kept; one byte over is refused, as today's `size > ROW_BYTES`.
- Step 9 compares `_tag` and body, and never metadata (85%): the protocol's "same body" means what the writer wrote, and
  a different `_tag` with the same fields is another entry. Equality is `Equal.equals` on the JSON round trip, so key
  order, `-0` and a null-prototype object do not make a body different.
- Step 9 runs before step 10, as the ticket says: a writer that lost its answer and sends again is never refused by
  its own entry, even with a stale `expectedRevision`.
- Admissions (2085) will run between steps 10 and 11, so a conflict runs no admission and charges nothing.
- A conflict is answered once. The ledger never tries again on its own (R3).

### The memory ledger

```ts
// kalfa/ledger/src/MemoryLedger.ts, a sketch.
export const layer: (settings?: Settings.Settings) => Layer.Layer<Ledger.Ledger>
// state, built fresh for each build of the layer:
//   log: Array<{ stream, id, revision, position, arrivedAt, tag, body: string, metadata: string }>
//   byStream: Map<string, { head: Revision, ids: Map<EntryId, number> }>   // number: the entry's index in log
```

- Each entry keeps its body and metadata as JSON text, as a SQLite row will, and `read` parses them again. So a caller
  that changes its body after the append, or changes an entry it read, changes nothing in the ledger (class (d)), and
  `-0` reads back `0` here exactly as it will from SQLite.
- `append` runs steps 1 to 8 as plain code, then steps 9 to 11 in one `Effect.sync`. `arrivedAt` reads Effect's
  `Clock`, so a test moves it with `TestClock`.
- `read(stream, after, { tags })` is `Stream.unwrap` of one `Effect.fn("ledger.read")` step that copies the entries with
  revision above `after` and, with tags, a `_tag` among them, oldest first; then `Stream.fromIterable`.
- A bad `after` through a cast (`-1`, `1.5`) or an empty `tags` list is a defect, the guard behind the types. A stream
  name that step 1 would refuse reads nothing, since nothing can be kept there.
- It logs nothing.

### Spans

`ledger.append` and `ledger.read` are made with `Effect.fn`, named as decision 0063 says. The core imports no Telemetry.
An attribute is set only once the check for its value has passed, so a refused stream name or id never reaches a span.

| Span | Always | Once checked | On the answer |
|---|---|---|---|
| `ledger.append` | `messaging.system` `kalfa.ledger`, `messaging.operation.name` `append`, `messaging.operation.type` `send` | `messaging.destination.name` (step 1), `messaging.message.id` (2), `kalfa.ledger.tag` (4), `kalfa.ledger.expected_revision` (7), `kalfa.ledger.bytes` (8) | `kalfa.ledger.answer` `placed` or `resent` with `kalfa.ledger.revision` and `kalfa.ledger.position`; for a refusal `error.type` its `_tag`, `kalfa.ledger.limit` for `TooBig`, `kalfa.ledger.actual_revision` for `RevisionConflict`, and the span ends failed with the refusal |
| `ledger.read` | `messaging.system`, `messaging.operation.name` `read`, `messaging.operation.type` `receive`, `messaging.destination.name`, `kalfa.ledger.after` | `kalfa.ledger.tags` (the names, when given) | `messaging.batch.message_count` |

Stream names, ids and tags are names: they go into spans, and the README says no secret may be one. A body, metadata
and a slot never do.

## One value traced: CI records a request, a second caller loses the race, the first sends again

1. The log holds 4 entries on other streams. CI read `ci/requests` and found it empty, so it appends
   `("ci/requests", "req-7f3a", { _tag: "Requested", body: { commit: "abc123" } }, { expectedRevision: 0 })`.
2. Steps 1 to 7 pass. Step 8 counts `11 + 8 + 9 + 19 + 2 = 49` bytes (stream, id, tag, `{"commit":"abc123"}`, `{}`),
   under 2,000,000.
3. In one step: the stream holds no `req-7f3a`; its head is 0, equal to the expected 0; it keeps revision 1,
   position 5, `arrivedAt` the clock's now. The span says `placed`, revision 1, position 5. The answer is
   `Placed { revision: 1, position: 5 }`.
4. A second caller had also read the empty stream, and appends `req-9b2c` with `expectedRevision: 0`. Steps 1 to 9
   pass; at step 10 the head is 1. It fails with `RevisionConflict { expected: 0, actual: 1 }`, keeps nothing, and its
   span ends failed with `error.type` `RevisionConflict` and `kalfa.ledger.actual_revision` 1. It reads again, sees
   `req-7f3a`, decides there is nothing to do, and stops.
5. CI lost its first answer and sends step 1 again, still with `expectedRevision: 0`. Step 9 finds `req-7f3a` with the
   same tag and body and answers `Placed { revision: 1, position: 5 }`, keeping nothing. The span says `resent`.
6. `read("ci/requests", 0, { tags: ["Requested"] })` gives one entry: `{ id: "req-7f3a", stream: "ci/requests",
   revision: 1, position: 5, arrivedAt, _tag: "Requested", body: { commit: "abc123" }, metadata: {} }`.
7. CI's later entry for the same request is `EntryId.child(EntryName.make("chosen"), "req-7f3a")`, which is
   `"chosen:req-7f3a"`. A 250-character request id would give `"chosen.h:<43 characters>"` instead.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/ledger/src/Ledger.test-support.ts`, as the sibling packages have
them, so the package needs no fast-check. Each law applies to each drawn value one value made for every class it names,
so every class is reached in every run. A class aimed at one check passes every check before it, in the order under
"One append, step by step".

- `bodies`: (a) JSON bodies of every kind: `null`, booleans, integers and floats at their edges, `-0`, strings with
  quotes, backslashes, control characters, U+2028, a lone surrogate and an emoji, arrays and objects nested up to 64
  levels, and one 2,000-level array; (b) JSON-equal variants of a kept body: keys in another order, `-0` for `0`, a
  null-prototype object, an own `__proto__` key; (c) bodies `Schema.Json` refuses, in an entry right in every other way:
  `NaN`, `Infinity`, a `BigInt`, `undefined` in an array, a sparse array, a `Date`, an object with `toJSON`, a class
  instance, a `Map`; (d) the caller changes its body and metadata objects after the append, and changes an entry it read.
- `shapes`, each right in every part checked before it: (e) a stream that is empty or holds a lone surrogate; (f) an id
  through a cast that is empty, 256 characters, or holds a space, `/`, `é` or a NUL; (g) an entry that is `null`, an
  array or text, has an extra own key (`by`, `seen`, `sentAt`), or has `_tag` and `body` only on its prototype; (h) a
  `_tag` that is empty, not text, or holds a lone surrogate; (i) metadata that is not a record, or a slot that is no JSON;
  (j) an `expectedRevision` through a cast of `-1`, `1.5`, `NaN` or text.
- `sizes`: (k) under a drawn small limit of 64 to 4,096 bytes, entries counting exactly the limit minus one, the limit,
  and the limit plus one, built from 1-, 2-, 3- and 4-byte characters and JSON escapes, spread over stream, id, tag,
  body and metadata, so characters never equal bytes.
- `histories`: (l) a resend of a kept entry, same stream, id, tag and body, after 0 to 50 other appends to the same and
  other streams, with other metadata, and with no option, the right `expectedRevision` or a stale one; (m) the same
  stream and id with one changed leaf deep in the body, or another `_tag`, each also with a stale `expectedRevision`;
  (n) the same id and body on another stream.
- `interleavings`: (o) 2 to 40 appends over 2 to 5 streams in a drawn order, so a stream's revisions and positions part
  after the first append to another stream; (p) reads after 0, after a middle revision, after the head and past it,
  with no tags, one tag, several, and a tag no entry has; (q) the clock moved forward, held still, and set back between
  appends with `TestClock.setTime`.
- `conditions`: (r) `expectedRevision` equal to the head, below it, above it, and `0` on an empty and on a non-empty
  stream; (s) 2 to 6 callers that read the same head and append at once with it, each under its own new id, on an empty
  and on a non-empty stream.
- `children`: (t) a name and a parent whose `name:parent` is 254, 255 and 256 characters long, and a 255-character
  parent; (u) two names on one parent, one name on two parents, and two parents that differ only in their last
  character; (v) parents holding `:` and `.`; (w) entry names that are right, 209 and 210 characters long, or hold `.`,
  `:` or a space.
- `settings`: (x) limits through a cast of `0`, `-1`, `1.5`, `NaN`, `Infinity` and text.
- `secretFlows`: (y) a generated secret text in the body and in a metadata slot of an entry that is kept, resent,
  refused as `IdReused`, refused as `TooBig`, refused as `BadEntry` for its metadata, and refused as
  `RevisionConflict`; and in the `Redacted` cause of each failure and of a wrapper that sets its `cause` from its
  `reason`. Each is looked for as is, JSON-escaped, base64, base64url and `encodeURIComponent`.

No law waits on real time: the clock is `TestClock`, and R3 moves it with `TestClock.adjust`. Laws in `/test` take a
`Subject` (below), so a provider that does not read Effect's `Clock` still passes A4, the law that only asks the clock
never goes back.

## The suite in `/test`

```ts
// kalfa/ledger/src/LedgerTest.ts, a sketch; the tests step's to shape.
export interface Subject<E> {
  /** A new, empty ledger with these settings: one for each run of each law. */
  readonly ledger: (settings: Settings.Settings) => Layer.Layer<Ledger.Ledger, E>
}
export interface SuiteOptions { readonly runs: number; readonly timeout: number }
/** The behavior laws every provider passes, through any stub or connection. */
export const suite: <E>(name: string, subject: Subject<E>, options: SuiteOptions) => void
/** The span and log laws, run where the Ledger's own spans are made (2088 and 2090 run them on the Ledger's side). */
export const spans: <E>(name: string, subject: Subject<E>, options: SuiteOptions) => void
```

## Laws

Run caps: every property law runs 100 to 300 runs, in memory, under `it.effect`, except where a row says less. The tests
step reports any law over 10 s and lowers its runs, never its classes. Each `*.types.test.ts` file also runs under
vitest, so it holds no `declare const`: it builds real values and runs them, or wraps its lines in a function it never
calls.

### Laws, slice 1

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| P1, the manifest: private; the one dependency `fast-sha256` pinned exact; the one peer `effect`; exports `.` and `./package.json`, each a file; no package of this repo and no `@demlik/` package named anywhere in it | test | scenario: the package's own manifest at head; no generated input says what a manifest holds | add `@kalfa/config` to the dependencies: red; make `fast-sha256` a range: red; make the package public: red | kalfa/ledger/src/Package.test.ts |
| E1, the root entry point gives `Ledger`, `EntryId`, `EntryName`, `Revision`, `Position`, `NewEntry`, `Entry`, `Placed`, `Settings`, the eight errors and the two unions, the very ones their files make; `Refusal`'s members are exactly the five refusals and `Failure`'s exactly the three failures; no export is named `<Something>Unavailable` | test | scenario: the root module object at head | leave `RevisionConflict` out of `Refusal`: red; export a copy of `EntryId`: red | kalfa/ledger/src/Package.test.ts |
| L1, imports: in the package's product files every `@kalfa/`, `@kampus/`, `@tea-fabrika/` and `@demlik/` package, Telemetry (`@opentelemetry/**`, `@effect/opentelemetry`), a platform package, `fast-check`, a Node module under either spelling and a path out of the package are refused; `@effect/vitest` and `vitest` only in `LedgerTest.ts`; tests and test support left out | lint | lint | in turn: import `@kalfa/config` in `Entry.ts`, `node:crypto` in `EntryId.ts`, `@effect/opentelemetry` in `Ledger.ts`, `vitest` in `Errors.ts`: lint red each time, then undone | .oxlintrc.json |
| L2, the hash stays in one place: only `EntryId.ts` imports `fast-sha256` | lint | lint | import `fast-sha256` in `Entry.ts`: lint red | .oxlintrc.json |
| L3, the rank: `kalfa-ledger` is a layer-rules row at layer 0 that imports nothing, a boundary row that imports nothing, and `kalfa/ledger/src` is a root in both; the layers test pins it at 0 with its reason | test | pinned: the two rule files at head | write layer 1: the pin is red; drop the boundary row: the boundary-and-layer law is red | oxlint-plugins/layers.test.ts |
| D1, the calls' types: `append` takes `(string, EntryId, NewEntry, AppendOptions?)` and gives `Effect<Placed, Refusal \| Failure>`; `read` takes `(string, Revision, ReadOptions?)` and gives `Stream<Entry, Failure>`; a call with no id, or with a plain string for the id, does not compile; the service has exactly `append` and `read` | type | type | add an overload with no id: the no-id line compiles, red; type the id as `string`: red; widen `read`'s error to `Refusal \| Failure`: red | kalfa/ledger/src/Ledger.types.test.ts |
| D2, the options' types, every way they can be typed: `append` with the options left out, `{}`, `{ expectedRevision: Revision.make(0) }`, a variable typed `AppendOptions`, and a value typed `AppendOptions \| undefined` all compile; `{ expectedRevision: 0 }` (a plain number), `{ expectedRevision: undefined }` and `{ expectedRevision: n as Revision \| undefined }` do not; `read` with the options left out, `{}`, `{ tags: ["A"] }` and a `NonEmptyReadonlyArray<string>` compile, and `{ tags: [] }`, `{ tags: names as string[] }` and `{ tags: undefined }` do not | type | type | type `expectedRevision` as `number`: the plain-number line compiles, red; type `tags` as `ReadonlyArray<string>`: the empty-list line compiles, red; add `\| undefined` to `expectedRevision`: red | kalfa/ledger/src/Ledger.types.test.ts |
| D3, the settings' types, every way they can be typed: `Settings` decodes `defaults`; a literal `{ limits: { bytes: 64 } }`, a variable typed `Settings.Settings` and `{ limits: { bytes: n } }` with a widened `number` compile where a `Settings.Settings` is asked for; `{}`, `{ limits: {} }`, `{ limits: { bytes: "64" } }` and `{ limits: { bytes: undefined } }` do not | type | type | make `limits` optional: the `{}` line compiles, red; make `bytes` `Schema.optional`: the `undefined` line compiles, red | kalfa/ledger/src/Settings.types.test.ts |
| D4, the entries' types: `keyof Entry` is exactly `id \| stream \| revision \| position \| arrivedAt \| _tag \| body \| metadata`, none of `by`, `for`, `sentAt`, `seen`, `parent`, `traceId`, `build`; a `NewEntry` with metadata left out, with metadata, and with a body typed as a type alias of JSON compile; `metadata: undefined`, a body typed `unknown`, and a body typed as an `interface` do not (the README's reason) | type | type | add `sentAt` to `Entry`: red; type `body` as `unknown`: the `unknown` line compiles, red; make `metadata` `Schema.optional`: red | kalfa/ledger/src/Entry.types.test.ts |
| D5, the ids' types: `EntryId.child` takes `(EntryName, EntryId)` and gives `EntryId`, not an `Effect`, `Result` or `Option`; a plain string is neither an `EntryId` nor an `EntryName`; with `type ReplyId = EntryId`, a decoded reply id goes to `append` with no mapping | type | type | make `child` give `Effect<EntryId>`: red; type `child`'s name as `string`: the plain-string line compiles, red | kalfa/ledger/src/EntryId.types.test.ts |
| D6, the errors' types: `Refusal` is exactly the five and `Failure` exactly the three; each failure's `cause` is `Redacted<unknown>`, so a failure made with a plain cause does not compile; a test-support wrapper with `reason: Ledger.Failure` and `cause = this.reason` compiles, and `Effect.catchTag` on each member compiles | type | type | type a failure's cause as `Schema.Defect()`: the plain-cause line compiles, red; drop `AdmissionRefused` from `Refusal`: red | kalfa/ledger/src/Errors.types.test.ts |
| I1, the id shape: a text is an `EntryId` exactly when it is 1 to 255 characters of `A-Z a-z 0-9 - _ . :`, and an `EntryName` exactly when it is 1 to 209 characters of `A-Z a-z 0-9 - _`. 300 runs | test | Effect Arbitrary: children | allow `/` in `EntryId`: (f) red; let `EntryId` take 256 characters: (f) red; allow `.` in `EntryName`: (w) red; let `EntryName` take 210 characters: (w) red | kalfa/ledger/src/EntryId.test.ts |
| I2, `child`: for every name and parent it gives a valid `EntryId` and never throws; `<name>:<parent>` exactly when that is 255 characters or fewer, else `<name>.h:` and 43 characters equal to `node:crypto`'s SHA-256 of the parent in base64url; two names on one parent, and one name on two parents, give two ids; a plain id's text before its first `:` is the name, a hashed one's is `<name>.h`, and the two never meet. 300 runs | test | Effect Arbitrary: children | hash when the plain form is exactly 255: (t) red; write base64 with `=` padding: (t) red, 44 characters; leave the name out of the hashed form: (u) red, two names give one id; take the kind at the last `:`: (v) red | kalfa/ledger/src/EntryId.test.ts |
| F1, the errors cross a wire: each of the eight errors, with generated field values, encodes with its schema and decodes back equal and with the same `_tag`, and `Schema.is(Refusal)` and `Schema.is(Failure)` hold for exactly their own members. 200 runs | test | Effect Arbitrary: errors | give `TooBig` a `Schema.Number` field written as text: red; put `BadRow` in `Refusal`: red | kalfa/ledger/src/Errors.test.ts |
| X3, [secrets] a failure hides its cause: for each failure, and a wrapper whose `cause` is its `reason`, made with a secret of (y) in the `Redacted` cause, `Cause.pretty` of a failed exit with its stack, `String`, `JSON.stringify` and `Inspectable.format` of the error, every text reachable from its own properties, and its `cause` chain hold the secret in no form. 300 runs | test | Effect Arbitrary: secretFlows | type the cause as `Schema.Defect()` and pass the secret plain: (y) red; put the cause's text in the error's message: (y) red | kalfa/ledger/src/Errors.test.ts |

### Laws, slice 2

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| P2, the manifest after slice 2: P1, plus exports `./memory` and `./test`, each a file, and the peers `@effect/vitest` and `vitest`, both optional | test | scenario: the package's own manifest at head | drop `./test`: red; make `vitest` a required peer: red | kalfa/ledger/src/Package.test.ts |
| A1, placed and read back: each append under a new id answers `Placed` whose revision is the count of entries in its stream and whose position is the count in the log; read gives the entry back with exactly the eight keys, its body and metadata equal to the JSON round trip of what was sent, and metadata `{}` when none was sent. 300 runs | test | Effect Arbitrary: bodies | store `String(body)`: (a) red; keep `metadata` as `undefined` when none was sent: red; add `sentAt` to each entry read: red | kalfa/ledger/src/LedgerTest.ts |
| A2, revision and position: over any interleaving of appends to several streams, each stream's revisions are 1 to n with no gap, positions only go up across the log in the order of the appends, and `read(stream, after)` gives that stream's entries with revision above `after`, never chosen by position (today's code has the two swapped). 300 runs | test | Effect Arbitrary: interleavings | filter reads by position above `after`: (o) red; count revisions across the log: (o) red; count positions inside a stream: (o) red | kalfa/ledger/src/LedgerTest.ts |
| A3, read: oldest first, each entry once, only above `after`; with tags, only entries whose `_tag` is one of them; a tag no entry has gives nothing; after the head gives nothing. 300 runs | test | Effect Arbitrary: interleavings | read from `after` inclusive: (p) red; keep an entry whose `_tag` matches every tag only: (p) red; give the newest first: (p) red | kalfa/ledger/src/LedgerTest.ts |
| A4, the clock: as the position goes up, `arrivedAt` never goes down, whatever the clock does between appends. 200 runs | test | Effect Arbitrary: interleavings | take the clock as is with no max over the last `arrivedAt`: (q) red | kalfa/ledger/src/LedgerTest.ts |
| A5, the ledger keeps its own copy: a change the caller makes to its body or metadata after an append, or to an entry it read, changes nothing that a later read gives. 200 runs | test | Effect Arbitrary: bodies | keep the caller's objects by reference: (d) red | kalfa/ledger/src/LedgerTest.ts |
| B1, a badly shaped entry: each entry of (e) to (j) and (c) fails with `BadEntry` naming its part, never a defect; nothing is kept (a read shows no new entry and the next append takes the next position) | test, 300 runs | Effect Arbitrary: shapes | skip the well-formed check on the stream: (e) red; check the id's length only: (f) red; read `_tag` through the prototype: (g) red; let an extra key through: (g) red; let an empty tag through: (h) red; skip the `Schema.Json` check, so a `BigInt` throws in `JSON.stringify`: (c) red, a defect; skip the metadata check: (i) red; skip the option's check: (j) red | kalfa/ledger/src/LedgerTest.ts |
| B2, the size limit is the setting: under a small drawn limit, an entry whose count (UTF-8 bytes of stream, id, tag, the body's JSON text and the metadata's JSON text) is at the limit is kept, and one byte over fails with `TooBig` carrying the count and the limit, keeping nothing. 300 runs | test | Effect Arbitrary: sizes | count UTF-16 units with `.length`: (k) red; refuse at the limit with `>=`: (k) red; leave metadata out of the count: (k) red; read the default in place of the setting: (k) red | kalfa/ledger/src/LedgerTest.ts |
| B3, a bad setting fails loudly: building the memory ledger with each limit of (x) dies with a defect that names `limits.bytes`, and appends nothing | test | Effect Arbitrary: settings | build with no check, so a limit of `1.5` runs: (x) red | kalfa/ledger/src/MemoryLedger.test.ts |
| C1, a resend: the same stream, id, tag and body, sent again after any other appends, with other metadata, with a JSON-equal body, and with a stale `expectedRevision`, gets the first `Placed`, keeps nothing new, and the entry keeps its first metadata. 300 runs | test | Effect Arbitrary: histories | compare bodies by their JSON text: (b) red, keys in another order; check the revision before the id: (l) red, a stale option is a conflict; keep the newest metadata: (l) red | kalfa/ledger/src/LedgerTest.ts |
| C2, a reused id: the same stream and id with another body or another `_tag` fails with `IdReused`, also with a stale `expectedRevision`, and keeps nothing. 300 runs | test | Effect Arbitrary: histories | leave `_tag` out of the comparison: (m) red; check the revision before the id: (m) red, a conflict comes back | kalfa/ledger/src/LedgerTest.ts |
| C3, an id per stream: the same id and body on another stream is another entry, with its own `Placed`. 200 runs | test | Effect Arbitrary: histories | keep ids in one table for the whole log: (n) red | kalfa/ledger/src/LedgerTest.ts |
| R1, the expected revision: an append with `expectedRevision` equal to the head's revision is kept; below or above it fails with `RevisionConflict { expected, actual }`, `actual` the head's revision now, keeps nothing, and leaves no gap: the next append with `actual` is kept at `actual + 1`. 300 runs | test | Effect Arbitrary: conditions | keep when expected is at or below the head: (r) red; take `0` as "any": (r) red, a non-empty stream keeps it | kalfa/ledger/src/LedgerTest.ts |
| R2, two callers at the same head: 2 to 6 callers read the same head and append at once, each with that head as its `expectedRevision`; exactly one entry is kept, every other caller gets `RevisionConflict` with `actual` one above the head, and a read after it shows the winner's entry. 200 runs | test | Effect Arbitrary: conditions | in the memory ledger, yield between the revision check and the keep: (s) red, two are kept | kalfa/ledger/src/LedgerTest.ts |
| R3, no retry by the ledger: after a conflict, the stream is unchanged, also after the clock moves an hour. 100 runs | test | Effect Arbitrary: conditions | on a conflict, append again at the new head: (r) red | kalfa/ledger/src/LedgerTest.ts |
| R4, an empty stream: `expectedRevision` `0` keeps the first entry, and another caller's `0` on the same stream then fails with `RevisionConflict { expected: 0, actual: 1 }`. 200 runs | test | Effect Arbitrary: conditions | treat `0` as "no check": (r) red | kalfa/ledger/src/LedgerTest.ts |
| M1, the memory ledger itself: `layer()` keeps an entry that counts exactly 2,000,000 bytes and refuses 2,000,001 as `TooBig` with that limit; `arrivedAt` is the `TestClock`'s time whenever the clock moved forward; each build of the layer starts empty; it passes `LedgerTest.suite` and `LedgerTest.spans` | test | scenario: the default limit and the clock are one value each; the suites carry the generated laws | make the default 2,000,001: red; keep state between builds: red; read `Date.now()`: red | kalfa/ledger/src/MemoryLedger.test.ts |
| S1, the append span: each append ends exactly one span named `ledger.append`, also when it is refused, with the attributes of the table under "Spans" for its answer and no other `kalfa.ledger.*` key; a refusal's span ends failed with that refusal. 300 runs | test | Effect Arbitrary: histories | check the shape before entering the span: (e) red, a refusal leaves none; drop `kalfa.ledger.expected_revision`: (r) red; name it `ledger.write`: red | kalfa/ledger/src/LedgerTest.ts |
| S2, the read span: each read run to its end ends exactly one span named `ledger.read`, with the stream, `after`, the tags when given, and the count of entries given. 200 runs | test | Effect Arbitrary: interleavings | count the stream's entries, not the ones given: (p) red | kalfa/ledger/src/LedgerTest.ts |
| S3, the tracer off: appends and reads under `Effect.withTracerEnabled(false)` leave the tracer held in memory empty, while the same calls with it on make spans. 100 runs | test | Effect Arbitrary: interleavings | turn tracing on again inside `append` with `Effect.withTracerEnabled(true)`: red | kalfa/ledger/src/LedgerTest.ts |
| X1, [secrets] spans hold no body or metadata: for every flow of (y), no span name, attribute, event, or failure text as Effect's tracer keeps it (the error's message and `Cause.pretty` with its stack) holds the secret in any form. 300 runs | test | Effect Arbitrary: secretFlows | annotate the span with the body's JSON: (y) red; annotate a refused entry's metadata: (y) red | kalfa/ledger/src/LedgerTest.ts |
| X2, [secrets] logs hold no body or metadata: for every flow of (y), no line at any level of a recording logger holds the secret in any form. 300 runs | test | Effect Arbitrary: secretFlows | `Effect.logDebug` the entry on `IdReused`: (y) red | kalfa/ledger/src/LedgerTest.ts |
| X4, [secrets] refusals hold no body or metadata: for every refused flow of (y), `Cause.pretty` of the exit, `String`, `JSON.stringify` and `Inspectable.format` of the refusal, every text reachable from its own properties, and its `cause` chain hold the secret in no form. 300 runs | test | Effect Arbitrary: secretFlows | carry the body in `IdReused`: (y) red; set `BadEntry`'s cause to the `SchemaError`: (y) red | kalfa/ledger/src/LedgerTest.ts |

The laws in `LedgerTest.ts` are run by `MemoryLedger.test.ts` through `suite` and `spans`, as `@kalfa/secrets`'s are.

### Each acceptance criterion and its law

| Ticket's criterion | Laws |
|---|---|
| `append(stream, id, entry)` answers `Placed` or fails with a `Refusal` or a `Failure`; no form without an id | D1, A1 |
| `{ expectedRevision }` as the last argument; `0` for an empty stream; equal is kept; without it no check | D2, R1, R4, A1 |
| a moved head is `RevisionConflict` with the head's revision now; nothing kept; no retry by the ledger (no admission exists before 2085, and step 10 runs before admissions, so none can charge; 2085's laws hold the charge half) | R1, R3 |
| two callers at the same head: one kept, the other conflicts, reads again and sees it | R2 |
| a conflict leaves no gap, and the next append at the new head is kept | R1 |
| a resend with a stale `expectedRevision` gets the first `Placed`; the same id with another body is `IdReused`, checked before the revision | C1, C2 |
| an empty stream: `0` keeps the first, another `0` conflicts | R4 |
| `EntryId`: letters, digits and `-_.:`, up to 255; another package's id is an `EntryId` with no mapping | I1, D5 |
| `EntryName` and `EntryId.child`: plain or hashed, both valid; two names give two ids; kinds never meet; a 255-character parent hashes, never fails (that other packages use it and never hash alone is their reviews' to hold; Chat's ticket names it) | I1, I2, D5 |
| `read(stream, after, { tags? })`: after a revision, oldest first, once; tags filter | A3, D2 |
| an entry read back has exactly the eight keys and none of today's sender fields | A1, D4 |
| revisions from 1 with no gaps, positions only up; read goes by revision, never by position | A2 |
| `arrivedAt` is the ledger's clock and never goes back as the position goes up | A4, M1 |
| an id is unique in its stream; a resend gets the first `Placed`, also after many appends; another body is `IdReused`; another stream is another entry | C1, C2, C3 |
| a badly shaped entry is `BadEntry`; past the limit is `TooBig`; the limit is a setting, default 2,000,000, the laws run with a small one | B1, B2, B3, M1, D3 |
| each error a `Schema.TaggedError`; `Refusal` and `Failure` exported as unions | F1, E1, D6 |
| another package wraps the failures as `<Package>Unavailable` with `reason` and `cause`, and a refusal as `<Package>Refused`; the unions need no list of their own; only the Ledger says `Unreachable` | D6, X3, E1 |
| spans `ledger.append` and `ledger.read` with `Effect.fn`, messaging names first, `kalfa.ledger.expected_revision`, names, ids and numbers only, no Telemetry import, read from a tracer in memory | S1, S2, X1, L1 |
| with the tracer off, no span | S3 |
| the core, `/memory` and `/test` import no kalfa package | L1, P1, P2 |

No law here needs the real machine. Every law runs on the memory ledger on every pull request; the providers that need
a real resource (2087's files, 2088's local runtime) bring their own `.integration.` files and run this suite there.

## Lint

The tests step adds `kalfa/ledger/src/**` to the kalfa Effect block of `.oxlintrc.json` (its `files` list beside
`kalfa/git/src/**`), and one override for the package modeled on `@kalfa/git`'s, holding L1 and L2. An override
replaces a rule's options, so it repeats the base entries, as `@kalfa/git`'s does. Tests, `*.test-support.ts` and
`LedgerTest.ts` are left out of L1's test-tool refusal. The `node:crypto` check in I2 lives in `EntryId.test.ts`, a test
file, since a test-support file is linted as product for Node imports.

## Where the rank is written

`@kalfa/ledger` imports no kalfa package, so it ranks at layer 0, beside Source control and Markdown. `kalfa/AGENTS.md`
already says the ledger sits below Program; the build adds that Ledger (`@kalfa/ledger`) imports no kalfa package and
ranks lowest.

## Is this a setting?

- The size limit: yes, `limits.bytes` on the layer, default 2,000,000 (1899). The core exports the schema and the
  default; the app reads the value through its own settings, since the core imports no `@kalfa/config`.
- `EntryId`'s 255 characters and its letters, and `EntryName`'s rule: no. They are the one id shape every package and
  every stored entry share; a settings file on one side could only make ids the other side refuses. 209 is derived
  from 255.
- The hash (SHA-256, base64url, no padding): no, for the same reason: it is part of the id's shape.
- The memory ledger's size: there is none to set; it holds what the test puts in it.
- The check order and the resend rule: no, they are the protocol.

## What fact is lost if it is not recorded now

- **When an entry arrived, on the ledger's own clock.** `arrivedAt` is kept from the first entry. It cannot be rebuilt.
- **Each package's slots.** `metadata` is kept whole from the first entry, though nothing fills it until 2084.
- **That an append was conditional, and on what.** Only in the span (`kalfa.ledger.expected_revision`). Nothing reads
  it later from the entry, and the decision it guarded is the caller's own entry.
- **A refused append.** Only its span keeps it. A refusal is an answer, not a fact of the log, so nothing is lost that
  the log promised.

## Files

| File | Owner | Slice | Product lines expected | Change |
|---|---|---|---|---|
| kalfa/ledger/src/index.ts | build | 1 | 15 | new: the root entry point |
| kalfa/ledger/src/EntryId.ts | build | 1 | 40 | new: `EntryId`, `EntryName`, `child` |
| kalfa/ledger/src/Entry.ts | build | 1 | 55 | new: `Revision`, `Position`, `Metadata`, `NewEntry`, `Entry`, `Placed` |
| kalfa/ledger/src/Errors.ts | build | 1 | 70 | new: the eight errors, `Refusal`, `Failure` |
| kalfa/ledger/src/Settings.ts | build | 1 | 20 | new: `Settings`, `defaults` |
| kalfa/ledger/src/Ledger.ts | build | 1 | 35 | new: `Ledger`, `AppendOptions`, `ReadOptions` |
| kalfa/ledger/README.md | build | 1 and 2 | docs | new: the calls, the check order, the resend rule, the size count, ids and `child`, the errors and how to wrap them, why a body is JSON, the spans, what never shows; slice 2 adds the memory ledger and `/test` |
| kalfa/ledger/GLOSSARY.md | build | 1 | docs | the new terms under `## New names` |
| kalfa/AGENTS.md | build | 1 | docs | the rank sentence |
| kalfa/ledger/src/internal/checks.ts | build | 2 | 70 | new: steps 1 to 8, the byte count, the same-body rule |
| kalfa/ledger/src/internal/spans.ts | build | 2 | 15 | new: the attribute names of the span table |
| kalfa/ledger/src/MemoryLedger.ts | build | 2 | 110 | new: `layer` |
| kalfa/ledger/src/index.ts | build | 2 | 2 | no new export; a doc line naming `/memory` and `/test` |
| kalfa/ledger/package.json | tests | 1 and 2 | tests | new in slice 1 as sketched; slice 2 adds `./memory`, `./test` and the optional peers |
| kalfa/ledger/tsconfig.json | tests | 1 | tests | new: as `kalfa/secrets`'s, with the Effect checks |
| package.json | tests | 1 | tests | `"@kalfa/ledger": "workspace:*"` beside the other kalfa packages |
| pnpm-lock.yaml | tests | 1 | tests | the new importer with `fast-sha256` 1.3.0, written by one `pnpm install --offline` |
| .oxlintrc.json | tests | 1 | tests | L1 and L2: the kalfa Effect block's files and the package's override |
| layer-rules.json | tests | 1 | tests | L3: `kalfa-ledger` at layer 0, importing nothing; the root `kalfa/ledger/src` |
| boundary-rules.json | tests | 1 | tests | L3: `kalfa-ledger` imports nothing; `kalfa/ledger` is `kalfa-ledger` |
| oxlint-plugins/layers.test.ts | tests | 1 | tests | L3: `"kalfa-ledger": 0`, with its reason comment |
| oxlint-plugins/law-ids.ts | tests | 1 | tests | no change: ran clean while planning; the tests step runs it again |
| vitest.config.ts | tests | 1 | tests | no change: its kalfa globs already run the new files |
| kalfa/ledger/src/Ledger.test-support.ts | tests | 1 and 2 | tests | the generators of `## Generators`, a tracer and a logger held in memory, the secret's forms, the demo wrapper |
| kalfa/ledger/src/Package.test.ts | tests | 1 and 2 | tests | P1, E1; P2 in slice 2 |
| kalfa/ledger/src/Ledger.types.test.ts | tests | 1 | tests | D1, D2 |
| kalfa/ledger/src/Settings.types.test.ts | tests | 1 | tests | D3 |
| kalfa/ledger/src/Entry.types.test.ts | tests | 1 | tests | D4 |
| kalfa/ledger/src/EntryId.types.test.ts | tests | 1 | tests | D5 |
| kalfa/ledger/src/Errors.types.test.ts | tests | 1 | tests | D6 |
| kalfa/ledger/src/EntryId.test.ts | tests | 1 | tests | I1, I2 |
| kalfa/ledger/src/Errors.test.ts | tests | 1 | tests | F1, X3 |
| kalfa/ledger/src/LedgerTest.ts | tests | 2 | tests | new: the `/test` entry point, `Subject`, `suite` and `spans`, with A1 to A5, B1, B2, C1 to C3, R1 to R4, S1 to S3, X1, X2, X4 |
| kalfa/ledger/src/MemoryLedger.test.ts | tests | 2 | tests | B3, M1, and the two suites run on the memory ledger |

## Existing tools

- `kalfa/ledger/src/index.ts`: searched `kalfa/secrets/src/index.ts` and `kalfa/git`'s roots (a root that re-exports
  modules; followed).
- `kalfa/ledger/src/EntryId.ts`: searched the repo for an entry id type (today's `Text` in
  `next/packages/libfabrika/src/ledger/Log.ts`, a plain non-empty string; not used), Chat's `ReplyId` (a rule in 1809, no
  code yet), Effect's `Digest` (async over WebCrypto, so `child` could not be pure; not used), `node:crypto` (Node only;
  refused by L1), npm's `@noble/hashes` (not installed; the other pick) and `fast-sha256` (installed; used), and Effect's
  `encoding/Base64Url` (used).
- `kalfa/ledger/src/Entry.ts`: searched today's `Log.ts` (`Entry`, `Line`, `Rev`; cut from, with revision and position
  the right way round and the sender fields gone), Effect's `eventlog/EventJournal.ts` `Entry` (a binary payload and a
  journal-made id; a model only), and `Schema.Json`, `Schema.brand` and `Schema.TaggedClass` (used).
- `kalfa/ledger/src/Errors.ts`: searched today's `LedgerError` (one error with a string `reason`; replaced by the
  protocol's eight classes), `kalfa/secrets/src/Errors.ts` (its `Schema.Redacted(Schema.Defect())` cause; followed) and
  `Schema.TaggedError` (used).
- `kalfa/ledger/src/Settings.ts`: searched `kalfa/git/src/Settings.ts` (a `Schema.Struct` of limits; followed in shape)
  and `@kalfa/config`'s `Setting.make` (the core may not import it).
- `kalfa/ledger/src/Ledger.ts`: searched today's `Ledger.ts` service (followed in shape: a `Context.Service` with the
  calls) and `kalfa/secrets/src/Store.ts` (a port with typed answers).
- `kalfa/ledger/src/internal/checks.ts`: searched today's `check`, `same` and `decide` in
  `next/packages/libfabrika/src/ledger/internal/ledgerStore.ts` (the order and the byte count; cut from, not imported, as
  `next/` is not a dependency), `Schema.decodeUnknownResult` with `onExcessProperty: "error"` (used), and
  `Equal.equals` (used for the same-body rule).
- `kalfa/ledger/src/internal/spans.ts`: searched today's `internal/ledgerTrace.ts` (`messaging.destination.name` and a
  prefix helper; followed with `kalfa.ledger.*`) and OpenTelemetry's semantic-conventions package on npm (a Telemetry
  import, refused by decision 0063; the names are written as text).
- `kalfa/ledger/src/MemoryLedger.ts`: searched `kalfa/secrets/src/MemoryStore.ts` and `kalfa/git/src/MemoryRepository.ts`
  (memory adapters built fresh per layer build with `Layer.effectContext` and `Effect.sync`; followed), Effect's
  `EventJournal.makeMemory` (an array and one write step; a model), and `Ref` (not needed: one `Effect.sync` per append
  is already atomic, and a `Ref` would not make the check and the keep one step).
- The leak helpers in `Ledger.test-support.ts` (a tests file, so no line is required): `@kalfa/secrets`'s leak test support
  and the transport branch's `watching` and `recording` do the same, but the package may import neither, so the tests
  step copies their shape (`## Findings` 2).

## Calls taken

- The two slices (80%): the shapes are what other packages type against first, and each slice lands whole under about
  300 lines.
- The check order of "One append, step by step" (90%): it is today's order with the ticket's two rules (the id before the
  revision, the entry id before any admission).
- `_tag` counts in the same-body rule, metadata never (85%).
- The byte count of step 8 (85%): today's count, mapped.
- `BadEntry` names its part, and only its part (80%).
- `RevisionConflict` carries `expected` and `actual` (80%), as KurrentDB's error does; the ticket's name is kept.
- `IdReused` carries nothing (80%): the caller knows the stream and id, and a read finds the kept entry.
- `arrivedAt` is milliseconds since 1970 as an integer (85%), as today.
- `metadata` may be left out of a `NewEntry` and reads back `{}` (85%).
- The memory ledger keeps bodies as JSON text (90%), so it behaves as a SQLite row will.
- A bad setting is a defect when the layer is built (80%).
- A malformed stream name on `read` reads nothing (80%); a bad `after` through a cast is a defect (80%).
- The six doubts at the top: 75%, 70%, 75%, 75%, 70%, 75%.

## Validation

- The tests step runs its new files by path, then `pnpm format`, `pnpm lint` and `node oxlint-plugins/law-ids.ts`. It
  does not run the changed-tests command or a typecheck: the lead does.
- The build runs the same narrow files, `pnpm format` and `pnpm lint`. The lead runs the changed tests and the
  typecheck once at the end, outside any box; CI runs the rest.

## Size

1. Slice 1, the shapes: 235 lines (`Errors.ts` 70, `Entry.ts` 55, `EntryId.ts` 40, `Ledger.ts` 35, `Settings.ts` 20,
   `index.ts` 15), plus the package files, the rule rows, the lockfile and the type, id and error laws.
2. Slice 2, the memory ledger and its laws: 197 lines (`MemoryLedger.ts` 110, `internal/checks.ts` 70,
   `internal/spans.ts` 15, `index.ts` 2), plus `LedgerTest.ts` and the behavior laws.

432 product lines in all, about 5 agent hours across the two slices, 70% sure. The doubt is slice 2's laws through a
`Subject` (the race in R2 and the exact span attributes in S1), which may be sent back once, and slice 1's type laws,
which may be sent back once. Budget basis: the `@kalfa/secrets` and `@kalfa/transport` plans priced slices of 150 to
300 lines at about $9 to $12 a step. Slice 1 at about $10, $8 and $6: $24. Slice 2 at about $14, $12 and $8: $34. Two
likely send-backs at about $12: $24.

Estimate: 8 steps, $82

## New names

- `append`, `read`, `Placed`, `Refusal`, `Failure`, `BadEntry`, `IdReused`, `TooBig`, `AdmissionRefused`, `Unreachable`,
  `BadRow`, `StorageFailed`, `RevisionConflict`, `EntryId`, `EntryName`, `child`, `expectedRevision`, `tags`: the
  protocol's, 1864's and the ticket's.
- `expectedRevision`: EventStoreDB's and KurrentDB's word.
- `messaging.*`, `error.type`: OpenTelemetry's. `kalfa.ledger.*`: decision 0063's form.
- `Revision`, `Position`, `Metadata`, `Entry`: the glossary's words, as schemas.
- `Settings`, `limits.bytes`, `defaults`: as `@kalfa/git` names its own.
- `AppendOptions`, `ReadOptions`, `Subject`, `suite`, `spans`, `part`, `actual`: code names.
- New domain words, for `kalfa/ledger/GLOSSARY.md`:
  - **New entry**: an entry as its writer hands it to append, before the ledger gives it a place. _Avoid_: line, draft,
    event data.
  - **Entry name**: a fixed word a package picks to tell one kind of its entries from another, used to build one entry
    id from another. _Avoid_: kind (the text before an id's first `:`), type, label.
  - **Child id**: an entry id built from an entry name and another entry id, the parent, so one act can append several
    entries. _Avoid_: derived id, sub-id, suffix.
  - **Expected revision**: the revision of a stream's head a writer read; an append that names it is kept only while the
    head is still there. _Avoid_: version, precondition, lock.
  - **Revision conflict**: the refusal of an append whose expected revision is not the head's any more. _Avoid_: clash,
    collision, stale write.
  - **Refusal** and **failure**: an error that says the ledger will not keep an entry, and one that says it could not
    answer at all. _Avoid_: rejection, fault, outage.

## Records

- `kalfa/ledger/GLOSSARY.md` gains the six terms above.
- `kalfa/AGENTS.md` gains the rank sentence.
- The README records the calls, the check order, the resend rule, the byte count, ids and `child` with both forms, the
  errors and how a package wraps them, why a body must be JSON, the spans and what never goes in one.
- No decision record: every rule here is the protocol's, 1864's, 1899's or 0090's. A decision is the lead's call only if
  the review finds the byte count or the same-body rule surprising.

## What this cannot tell us

- Nothing here was built or type-checked. The probes ran `Schema.Json`, `Equal.equals` and `fast-sha256`; the rest was
  only read.
- Whether `Context.Service` with an optional last parameter keeps D2's lines apart as planned under TypeScript 7; the
  tests step finds out first.
- Whether a real SQLite stores a NUL in a stream name, and keeps a lone surrogate in a TEXT column as text: the core
  refuses the second, and nobody checked the first (2087's plan).
- Whether the race law R2 means much on a single-threaded memory ledger beyond the plant: it proves the memory ledger
  keeps the check and the keep in one step, and the real proof is the same law on 2087's SQLite and 2088's object.
- Whether any caller wants `"any"` or "the stream exists" as an expected revision, as KurrentDB offers. No ticket asks.
- How a page-by-page read on SQLite shows in spans (the doubt at the top).

## Open questions

None.

Every doubt above picks how the code does what the protocol, 1864, 1899 and decision 0090 already say, so the lead's
read settles it, and none goes to the owner.

## Lead's calls at signing (2026-11-23)

- Kept, each with its law: `Revision` and `Position` are branded (`Revision.make(0)`); `AdmissionRefused.reason` is text until https://github.com/kamp-us/tea-fabrika/issues/2085; `fast-sha256` 1.3.0 for a synchronous SHA-256 (already in the store, offline install works); stream names are non-empty, well-formed text with no grammar yet; memory `read` copies entries on call; the three failures always take a `Redacted` cause, as `@kalfa/secrets` does.
- Changed: an empty `tags` list is caller input, so it is a typed refusal with exact text, not a defect.
- Permissions (https://github.com/kamp-us/tea-fabrika/pull/2313) needs `Unreachable`, `StorageFailed`, `BadRow` and the `Failure` union from slice 1, as `Schema.TaggedError`s buildable from their fields, plus the package's layer and boundary rows. Slice 1 lands those first.

## Findings

1. **`@kalfa/secrets` is not in the kalfa Effect lint block.** `.oxlintrc.json`'s block that turns on
   `fabrika/no-promises`, `fabrika/no-node-imports` and the other Effect rules for kalfa packages lists
   `kalfa/cli/src/**`, `kalfa/config/src/**`, `kalfa/diagnostics/src/**`, `kalfa/git/src/**`, `kalfa/github/src/**` and
   `kalfa/markdown/src/**`, and no `kalfa/secrets/src/**`; a search for `kalfa/secrets` in `.oxlintrc.json` finds
   nothing. So its product files skip those rules. A one-line fix in its own pull request.
2. **Leak and span helpers are copied package by package.** `@kalfa/secrets`'s leak test support, the transport
   branch's `watching` and `recording`, and this plan's test support each build the same secret forms, tracer and
   logger, because a kalfa package may not import another. A test-only home (perhaps `@kalfa/quality`, which packages
   may use in tests) would keep one copy. Worth a ticket.

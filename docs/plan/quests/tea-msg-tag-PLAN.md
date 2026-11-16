
Plancheck-Version: 3

# Plan: our installed tea keys a Msg on `_tag`, by a local patch that carries tea's own core change, and every machine of ours follows

This is `next/` and our tooling (`.agents/`), with one small change to today's version that keeps it
running unchanged. The owner ruled on 2026-11-15 that our installed `@demlik/tea` keys a Msg on
`_tag`, not `type`, now, without waiting for tea's release. It counts as a fix of that day's sev0.
Upstream issue: [demlik 949](https://github.com/kamp-us/demlik/issues/949). Two pull requests.

```ts
// The whole idea. Before, on main (next/programs/counter/src/program.ts):
const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("dec") }),
  Schema.Struct({ type: Schema.Literal("reset") }),
]);
runtime.dispatch({ type: "inc" });            // the key, written by hand

// After: tea's core reads `msg._tag` (patched), so the Msg is an Effect tagged union.
const Msg = Schema.TaggedUnion({ inc: {}, dec: {}, reset: {} });
runtime.dispatch(Msg.cases.inc.make({}));     // the schema's maker writes the key
// update: { inc, dec, reset } is unchanged: tea keys the table by the same names.
```

## Read this first: the one call under 80%

**Today's version uses the same installed tea.** The brief and the research looked only at `next/`
and tooling. But `pnpm-lock.yaml` shows tea 0.25.0 in today's packages too: `packages/fabrika`,
`packages/pipeline`, `programs/*`, `apps/fabrika` and the two tutorials, about 221 files that import
tea. pnpm applies a patch to every copy of `@demlik/tea@0.25.0` in the workspace, and it cannot
patch it for some folders and not others. So once the patch lands, today's version breaks unless it
moves too.

**My lean (75% sure):** slice 1 moves today's version onto its own pnpm named catalog,
`catalog:old`, pinned to tea **0.24.0**, which stays unpatched. Today's code then runs exactly as it
does now. `next/`, the tooling and the root stay on the default catalog's 0.25.0, which carries the
patch.

- Why 0.24.0: it is the release just before 0.25.0, and 0.25.0 only added `replayTrace`'s states,
  `divergence.at` and `refusal` (demlik 869, commit `fe081865e`). No file in today's version uses
  any of them (`rg replayTrace|divergence` over `packages programs apps docs/tutorials` finds none).
  The existing patch for demlik 897 is used only by `next/`'s `Program.make` (pull request 522).
- Why a named catalog: pnpm's catalogs docs give named catalogs for holding two versions of one
  package in one workspace during a move (from memory of the pnpm docs, not fetched for this plan).
  `oxlint-plugins/exact-versions.ts` already checks `catalogs.<name>` entries (line 61). It only
  needs to accept the `catalog:<name>` pointer (line 16).
- **The doubt:** the owner may want one tea in the whole workspace, which means today's version
  moves its Msgs to `_tag` too. That would add about 137 schema lines in 14 files plus their hand
  Msgs and tests, against "leave today's app alone". A second, smaller doubt: the root's tooling
  imports today's library (`.agents/skills/lead/scripts/agents.ts` imports `Agent` from
  `@kampus/fabrika-old`), so two copies of tea meet in one type check. If a tea type crosses that
  line, slice 1's `pnpm typecheck` shows it. **What settles it:** slice 1's CI run, and the owner's
  yes or no on the open question at the end.
- If 0.24.0 fails today's checks, the fallback is 0.26.0 or 0.27.0 unpatched for today's version,
  read first. Today's version moving to `_tag` is the last resort, and it goes to the owner.

## What changes, in one paragraph

tea 0.25.0 reads and writes a Msg's key as `type` in about 46 lines of 15 built `.js` files, and
constrains it as `M extends { type: string }` 119 times in 20 built `.d.ts` files. The patch changes
each Msg spot to `_tag`, and nothing else: Cmds, Subs, the state table's `state.type` and semantic
events keep `type`. The change joins the existing 16-line change in
`patches/@demlik__tea@0.25.0.patch`, since pnpm keeps one patch per version. On our side, every Msg
schema in `next/` and tooling becomes a `Schema.TaggedUnion` (or `TaggedStruct`), every hand Msg is
made with its schema's maker, every read of a Msg's key goes through the union's own matcher
([0567](../../../.decisions/0567-a-tagged-value-is-matched.md)) or reads `_tag`, and the runner stops
minting tea's answer Msgs by hand. Saved letters in the ledger carry `type`. They are never
rewritten: the mailbox renames `type` to `_tag` as it reads an old row, which event sourcing calls
an upcaster. The patch and our side land in one pull request, because a Msg cannot satisfy both
keys at once without a conversion, and the ruling forbids one.

## How others do it

- **tea itself** ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md): read
  first). Read in tea's repository, `kamp-us/demlik`, the one the installed `package.json` names.
  No tea decision sets the Msg key. Its `.decisions/0014` keeps a Cmd a plain record
  (`{ type: "retry", wait: 250 }`), and its errors and `Outcome` are already `_tag`. Its
  `.decisions/0021` says the engine turns a handler's outcome into the Cmd's `<name>_ok` or
  `<name>_err` Msg. That is why our runner should take tea's own answer makers (see "Calls taken")
  and not mint its own copy. Issue 949 asks for the core change. No upstream pull request exists yet
  (`gh pr list -R kamp-us/demlik`, read today). The tea source maps name the files the patch
  matches (`src/pure/core.ts` and the rest, listed in "The patch" below).
- **Effect:** every union is keyed by `_tag`. `Schema.TaggedUnion` and `TaggedStruct` write it;
  `Union.match`, `Union.isAnyOf`, `Match.valueTags` read it. `Types.Tags<E>` and
  `Types.ExtractTag<E, K>` (`effect/dist/Types.d.ts:121`, `:196`, effect 4.1.2) are the type-level
  forms of `M["type"]` and `Extract<M, { type: K }>`. Reading an old encoding into a new type is a
  schema transformation: `Schema.decodeTo` with `SchemaTransformation.transform`
  (`Schema.d.ts:4674`, `SchemaTransformation.d.ts:401`).
- **Elm:** a Msg is a custom type, so it has no key; its constructors play the part of
  `Msg.cases.inc.make`. Old saved JSON is read with a decoder that accepts both shapes
  (`Json.Decode.oneOf`), which is an upcaster written as a decoder. From the Elm guide, not fetched.
- **Erlang/OTP:** a message's shape is a tuple tag, the first element. A shape change goes with hot
  code upgrade: `code_change/3` converts saved state, and a release handler moves processes over.
  Messages already in flight are each process's job to accept. From the OTP design principles, not
  fetched.
- **Event sourcing, for saved letters:** the known way is **upcasting**. The event log stays as
  written, and each old event is converted to the current shape as it is read. Greg Young,
  *Versioning in an Event Sourced System* (Leanpub, 2017), the chapter on upcasting; Axon
  Framework's reference guide, "Event Upcasting"; Marten's docs, "Events Versioning". None fetched
  for this plan. tea's own `schemaMigrate(schema, upcast)` does this for state
  (`dist/runtime-types--ViLD9Hk.d.ts:582`). Rewriting the rows is the other way, and it breaks our
  hashes and resend check (see "Saved letters").
- **Changing a key in every reader at once:** a change that is neither forward- nor
  backward-compatible is a **flag day** (the Jargon File's term). The usual way around one is
  **parallel change**, also called expand and contract (Danilo Sato on martinfowler.com, 2014, not
  fetched): accept both keys for a while, then drop the old one. Here the expand step would be tea
  reading `_tag ?? type`, or our code writing both keys. That is the conversion the ruling forbids.
  So this is a flag day, done in one pull request, with the compiler finding every spot.

## The shape

### The patch (slice 2, owned by the tests step: the patches folder is an exam path)

One file, `patches/@demlik__tea@0.25.0.patch`, made with `pnpm patch @demlik/tea@0.25.0` and
`pnpm patch-commit`, edited in the folder pnpm prints, one editor edit at a time, never a
find-and-replace over the tree. Every line below was read in the installed 0.25.0 today.

```text
# Run time (.js). Each line reads or writes a Msg's key; only these change.
chunk-UD4PGLHO.js     (src/pure/core.ts)   154, 158 checkDispatch   164 describeReturn
                                           179, 188, 194 mint       217-218 defineCmd ok/err
                                           240 NoCellError text     284 record[msg.type]
                                           294 table[state.type]?.[msg.type]  (only the msg part)
                                           305, 752 NoCellError     312, 765 assertPureResult
chunk-4HXVP2GW.js     (engine/loop.ts)     343, 349, 351, 353
chunk-ZXNQ2YGV.js     (builtins.ts, tell)  43, 283 (value only: the key `msgType` stays), 321
effect/index.js       (effect/machine.ts)  146
react/index.js 145, chunk-JW7ZG2H4.js 11   (react/send.ts)
pbt/index.js          41, 45 arbConstantMsg / arbRecordMsg, 158-159 draw counts
chunk-E6PIICHD.js     (pbt/laws.ts)        82
chunk-MEZBSUDH.js     (recorder)           138
do/index.js           (event-sourced-store) 46 defaultParseEvent
devtools/index.js     187
tea's own Msgs:       chunk-JVGUEQRE.js 40, 95; flow/index.js 493; chunk-ZWC4VV7T.js 226, 298,
                      301, 395, 578, 585, 1086, 1156, 1210; jev/index.js 386

# Types (.d.ts). Every Msg constraint and indexed form; Cmd (C), Sub (U), state (S) and event (E)
# forms stay.
M extends { type: string }        -> M extends { _tag: string }      119 spots, 20 files
M["type"], Extract<M, {type: K}>  -> M["_tag"], Extract<M, {_tag: K}> Msg ones of the 60 indexed spots
SettledOk / SettledErr            -> readonly _tag: `${Name}_ok` / `${Name}_err` (core-CDR1i78K.d.ts:138-157)
tea's own Msg types               -> flow/index.d.ts:1160, index-BdV785AK.d.ts:145, 372, index-I-rewcm9.d.ts:633
```

- **Covers every entry, not only the ones we import.** We import `effect`, the root, `pbt`, `react`,
  `testing` and `node`. The patch still moves the add-ons' own Msgs (deadline, `cache_evict`, the
  workflow route, the agent Msgs, Jev's batch flush), because a half-moved tea is a tea nobody ships,
  and the patch must match the core change the maintainer makes. 85% sure.
- **Leaves tea's README, JSDoc examples and `.js.map` sources as they are.** They do not change what
  runs. tea's release rewrites them. 0562's rule covers `next/` and our tooling, not
  `node_modules`. 80% sure.
- **The workspace row** at `pnpm-workspace.yaml:147` names both issues:

```yaml
  # demlik#897: expose the machine's existing schemas. demlik#949: key a Msg on `_tag`, not
  # `type`, tea's own core change. Drop each at the release that has it.
  '@demlik/tea@0.25.0': patches/@demlik__tea@0.25.0.patch
```

### Our Msgs, in `next/` and tooling (slice 2, the build step)

```ts
// A Msg schema: next/programs/counter/src/program.ts and its 59 siblings.
const Msg = Schema.TaggedUnion({ inc: {}, dec: {}, reset: {} });

// A Msg made in code: the maker, never a key by hand (0562).
runtime.dispatch(Msg.cases.inc.make({}));

// A Msg read in code: the union's own matcher (0567, form 1), or Match.valueTags (form 2).
// Before (0567's form 2 for a tea Msg): Match.discriminators("type")({ ... })
// After:  Msg.match(m, { inc: ..., dec: ..., reset: ... })

// A type that names a Msg's cases: Effect's own helpers, so no `_tag` member is written.
type Names = Types.Tags<LinkMsg>;                          // was LinkMsg["type"]
type Pong = Types.ExtractTag<LinkMsg, "pong">;             // was Extract<LinkMsg, { readonly type: "pong" }>

// tooling: .agents/skills/lead/scripts/chain.ts:785, a plain type today.
// Before: type Msg = { readonly type: "start"; readonly step: StepName };
//         runtime.dispatch({ type: "start", step: start });              // :1768
// After:  const Msg = Schema.TaggedStruct("start", { step: StepName });   // StepName as a schema
//         runtime.dispatch(Msg.make({ step: start }));
```

An answer Msg carries its Cmd inside, and the Cmd keeps `type`:

```ts
// next/programs/pipeline/src/Merger.ts:102-119, a sketch of the after.
const answers = (name, input, ok, tags) => {
  const cmd = input.mapFields((fields) => ({ ...fields, type: Schema.Literal(name) })); // a Cmd: stays
  return Schema.Union([
    Schema.TaggedStruct(`${name}_ok`, { cmd, value: ok, at: Schema.Number }),
    Schema.TaggedStruct(`${name}_err`, {
      cmd,
      error: Schema.Union(tags.map((tag) => Schema.TaggedStruct(tag, {}))),
      at: Schema.Number,
    }),
  ]);
};
```

### The readers that know no program

These read the key without knowing the cases. Each was read on main today. The review checks each
against the verdict here, since no compiler can tell a Msg's `type` from a Cmd's.

| Place (on main at `b29e8bf2d`) | Reads | Verdict |
|---|---|---|
| `runtime/Program.ts:213` `type Typed`, `:235` `K extends M["type"]` | Msg | `_tag`; `:235` becomes `Types.Tags<M>` |
| `runtime/Program.ts:592-595` `isTyped`, `decodeTyped` | both | split: a Msg read on `_tag` at `:628`, `:705`, `:841-844`; a Cmd read on `type` at `:642`, `:728` |
| `runtime/Runner.ts:368` `Typed` | both | Msg at `:2773` `inputPort`; Cmd at `:328`, `:741`, `:1288`, `:1459`, `:1462`, `:2766` stay |
| `runtime/Runner.ts:1414` `{ ...down.value, type: down.value._tag }` | Msg | the conversion goes: `Down` is already a tagged union |
| `runtime/Runner.ts:1590`, `:1597` mint `<cmd>_ok`, `<cmd>_err` | Msg | tea's own `ok`/`err` (see "Calls taken"); the echoed `cmd` at `:1585` is a Cmd and stays |
| `runtime/Execution.ts:29` `Typed` | both | Msg at `:196`; Cmd at `:207` stays |
| `runtime/Audit.ts:92` `Minimal` | Msg | `_tag` |
| `gateway/Gateway.ts:1421` audit default `{ type: name }` | Msg | `_tag`; `:1244` already reads `_tag` |
| `runtime/Window.ts:124` `commandMsg` | Msg | `_tag` |
| `client/WindowMachine.ts:1267`, `:1587` | Msg | `Types.Tags`, `Types.ExtractTag`; `:1587`'s check reads `_tag` |
| `desktop/BrainLife.ts:160-166` `reply` | Msg | `Types.Tags`, `Types.ExtractTag`, and the union's matcher |
| `programs/pipeline/src/Merger.ts:102-119` `answers` | Msg, Cmd inside | `TaggedStruct`, as above |
| `.agents/skills/lead/scripts/drive.ts:411`, `:445`, `:1764`, `:2286`; `chain.ts:785`, `:1768` | Msg | `TaggedStruct`, makers; `drive.ts:709` `type: "draft"` is a Sub and stays |
| `.agents/skills/lead/scripts/flow/machine.ts` | answer Msgs only (`msg: Schema.Never`) | changes only where a handler reads an answer's key |

Paths without a folder are under `next/packages/libfabrika/src/`.

**The inline ignores this slice may add, and no others.** A reader or writer that knows no cases
must still name the key `_tag`, and `fabrika/no-hand-tag` fires on any object key, struct field or
type member called `_tag`. [0562](../../../.decisions/0562-nothing-teaches-the-wrong-shape.md)
allows one exception: `// oxlint-disable-next-line fabrika/no-hand-tag -- <why>` on the line. The
reason is the one `oxlint-plugins/no-hand-tag.ts` already gives for `ledger/Log.ts`: a reader that
knows no cases. Expected places: `Program.ts` `Typed`, `Execution.ts` and `Runner.ts` Msg readers,
`Audit.ts` `Minimal`, `Gateway.ts:1421`, `Window.ts` `commandMsg` (type and value), the mailbox's
upcaster, and test files' raw wire frames, as 0562 allows. About 10 product lines. A reviewer
treats any other ignore as a fault. No shared schema or wrapper type holds the key, since 0562
forbids a named wrapper that lets a hand-written `_tag` through.

### Saved letters: the upcaster (slice 2, the build step)

```ts
// next/packages/libfabrika/src/processes/Mailbox.ts, a sketch. Today (:89, :120-133):
//   const Sent = Schema.Struct({ m: Schema.Json });   ...   m: sent.value.m
// After: the letter's body is read through one transformation. Decode renames an old row's key;
// encode is the identity, so `letterLine` and `Send.make` write exactly what they write today.
const isOld = (m: Schema.Json): m is { readonly type: string } & Record<string, Schema.Json> =>
  Predicate.isObject(m) && !Predicate.hasProperty(m, "_tag") &&
  Predicate.hasProperty(m, "type") && Predicate.isString(m.type);

const rename = ({ type, ...rest }: { readonly type: string } & Record<string, Schema.Json>) =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- the upcaster: an old row's key, renamed on read
  ({ ...rest, _tag: type });

const Letter = Schema.Json.pipe(
  Schema.decodeTo(Schema.Json, SchemaTransformation.transform({
    decode: (m) => (isOld(m) ? rename(m) : m),
    encode: (m) => m,
  })),
);
const Sent = Schema.Struct({ m: Letter });
```

- **Only the top level.** An answer Msg's `cmd` is a Cmd and keeps `type`; a payload field named
  `type` inside a Msg that has `_tag` is left alone.
- **Read side only, never a rewrite.** The ledger row stays byte for byte as written.
  `ledgerStore.ts:120-126` treats a resend as the same letter only when `body` is equal, and
  `Runner.ts:372-376` hashes the delivered input. Both see the bytes as written, never the upcast
  copy, so both hold.
- **One read door.** On main, `history` in `processes/Mailbox.ts` is the only reader of a saved
  letter's body (`decodeSent`); the runner's restart fold reads letters through
  `mailbox.read` (`Runner.ts:1343`). The builder re-checks with `rg decodeSent|inbox\(` and puts the
  same `Letter` at any other reader it finds.
- **The wire is not upcast.** The gateway decodes a sent input with the program's own Msg schema
  before it is saved (`Gateway.ts:1238-1243`). An input from a window still running old code is
  refused at the door like any malformed input and is never saved. What is lost: one input from a
  tab left open across the upgrade, which the person sends again after the reload. 80% sure this
  is right for a lab version with no outside users.
- **The other saved places,** read today:

| Where | Holds a Msg? | What happens |
|---|---|---|
| ledger inbox rows (`ledger/internal/ledgerStore.ts`), the body `{ m }` | yes, `m` | the upcaster |
| `RuntimeRecord` `cmd.answered.m` (`runtime/ProcessStore.ts:73`) | yes | nothing folds it; it is the ended life's history, kept as written |
| checkpoint `model`, `turn`, `cmds` (`runtime/ProcessStore.ts:24-33`) | `turn` is `{ _tag: "prepared", id }`; `cmds` are Cmds | none |
| a program's saved Model | only if a Model embeds a Msg | the builder checks each Model schema for an embedded Msg schema; a hit gets a state upgrade through the existing `state.upgraded` path |
| gateway audit rows (`Gateway.ts:1421`) | a selection of the Msg | new rows say `_tag`; old rows stay as written; no code folds them |
| client pending sends (`runtime/Client.ts:35-53`) | `m` | kept in memory only, never saved |
| the flow tool's state (`.agents/skills/lead/scripts/flow/walk.ts:91`, tea's `fileStore`) | the Model only | none |

### Today's version (slice 1)

```yaml
# pnpm-workspace.yaml, a sketch. The default catalog keeps 0.25.0 (patched in slice 2).
catalogs:
  # Today's version (packages/, programs/, apps/, docs/tutorials/) on an unpatched tea, so it runs
  # as it does today while next/ moves its Msgs to `_tag` (demlik#949). Goes when today's version goes.
  old:
    '@demlik/tea': 0.24.0
```

```jsonc
// packages/fabrika/package.json and the 10 other package.json files of today's version that name tea
"@demlik/tea": "catalog:old"
```

```ts
// oxlint-plugins/exact-versions.ts:16, a sketch: a named catalog's pointer is exact too,
// since its entry is checked exact in pnpm-workspace.yaml (line 61 already does that).
const exact = (version: unknown) =>
  typeof version === "string" && (POINTERS.has(version) || NAMED.test(version) || EXACT.test(version));
const NAMED = /^catalog:[a-z][a-z0-9-]*$/;
```

`minimumReleaseAgeExclude` already lists `@demlik/tea@0.24.0 || 0.25.0`.

## One value traced: an `inc` pressed, saved, and folded after a restart, next to an old row

1. A person presses `+` on the counter. `runtime/Window.ts`'s `commandMsg("counter.inc")` answers
   the frame `{ _tag: "inc" }`. The window sends it with `process.send`.
2. The gateway decodes it with the counter's input schema, now `Schema.TaggedUnion`, and gets
   `{ _tag: "inc" }`. Its name, read at `Gateway.ts:1244`, is `"inc"`. The audit default writes
   `{ _tag: "inc" }`. The letter is appended to `fabrika/counter/inbox` with body
   `{ "m": { "_tag": "inc" } }`.
3. The runner reads the letter through `mailbox.read`. The upcaster sees `_tag`, so `m` passes
   unchanged. Patched tea looks up `record["inc"]` and the count goes from 4 to 5.
4. The brain restarts. The inbox also holds a row from before slice 2:
   `{ "m": { "type": "inc" } }`. The read decodes it to `{ _tag: "inc" }`. `Program.ts`'s fold reads
   `_tag`, finds the `inc` cell, and folds. Both rows bring the count up by one each. The old row's
   bytes in SQLite are unchanged, and its hash is the one written on its first day.
5. Without the upcaster, step 4's old row reaches the fold with no `_tag`. By my read of
   `Program.ts:839-854`, the fold then fails on decode and throws `ProgramDown` with
   `saved_letter`, so the process never restarts. (The research said it would be skipped quietly.
   The code says it fails loudly. Either way, law K5 holds it.)
6. A Cmd answer: the counter has none. In the pipeline program, a `ci_ok` answer is
   `{ _tag: "ci_ok", cmd: { type: "ci", ... }, value, at }`: the outer key moved, the Cmd inside kept
   `type`.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| E1 (slice 1): `exact-versions` accepts `catalog:<name>` for any lower-case name, refuses a range inside `catalogs.<name>`, and still refuses `catalog:^1`, `catalog: old` and a bare tag. Runs the real script on its own git tree, as its siblings do | test | fc.stringMatching: catalog names, 10 runs | (a) leave `POINTERS` as it is: `catalog:old` is refused, E1 red; (b) a pointer pattern that allows any text after `catalog:`: `catalog:^1` passes, E1 red | oxlint-plugins/exact-versions.test.ts |
| E2 (slice 1): today's version type-checks and its tests pass with every importer under `packages/`, `programs/`, `apps/` and `docs/tutorials/` on `catalog:old`. The compiler and today's own suites are the law; no new test | type | type | point `packages/pipeline` back at `catalog:` after slice 2: its `machine-make.test.ts` and type check fail | pnpm typecheck |
| K1: a Msg made with `Schema.TaggedUnion` is taken by the patched `Machine.make`; a missing handler, a misspelled handler, a misspelled Msg sent to `dispatch`, and a Msg schema keyed by `type` are each a compile error (`@ts-expect-error`); an answer Msg (`<cmd>_ok`) is handled in the same table | type | type | (a) drop the patch's `.d.ts` hunks: the tagged machine fails to compile, K1 red; (b) keep `Extract<M, { type: K }>` in `Reducer`: the handler's Msg loses its fields, K1 red | next/packages/libfabrika/src/runtime/MsgKey.types.test.ts |
| K2: the patched engine routes by `_tag` at run time: for generated Msg sequences of a small tagged machine, the Effect engine's `run` and tea's `foldMsgs` both reach the model a plain reduce over the handlers reaches; tea's own `arbMsg` draws carry `_tag`; a raw `{ type: "inc" }` sent in is refused as a Msg with no cell, never routed | test | @demlik/tea/pbt.arbMsgSequence: the small machine, 100 runs | (a) leave `chunk-UD4PGLHO.js:284` on `record[msg.type]`: every Msg misses its cell, K2 red; (b) leave `pbt/index.js:41, 45` writing `type`: the draws have no `_tag`, K2 red | next/packages/libfabrika/src/runtime/MsgKey.test.ts |
| K3: an answer Msg made by tea's own Cmd def (`def.ok(cmd, value, at)`, `def.err(cmd, error, at)`) for a generated input, value and error is `_tag`-keyed, its `cmd` keeps `type`, and Program's saved-letter check accepts it; the same answer keyed `type` is refused | test | fc.record: Cmd input, value and error, 100 runs | (a) leave the patch's `mint` and `defineCmd` hunks (`chunk-UD4PGLHO.js:179-218`) on `type`: K3 red; (b) Program's `settled` reading the outer key as `type`: K3 red | next/packages/libfabrika/src/runtime/Program.test.ts |
| K4: the mailbox's read gives back every saved letter in the new shape: for a generated tagged Msg, its old encoding (outer `_tag` renamed to `type`) reads back equal to the Msg; a new body reads back unchanged; a body with both keys is unchanged; an inner `cmd.type` is untouched; the stored row is byte for byte the same after any number of reads; a resend of the old row is still the same letter | test | Effect Arbitrary: MsgKeySample | (a) no upcaster: an old row reads back with `type`, K4 red; (b) a deep rename: the inner `cmd.type` becomes `_tag`, K4 red; (c) an upcaster that also writes the renamed row back: the bytes differ, K4 red | next/packages/libfabrika/src/processes/Mailbox.test.ts |
| K5: an old saved letter still folds after the patch: for generated counter Msg sequences, folding their upcast old encodings gives the same model as folding the new ones; an old encoding that reaches the fold without the upcaster fails with `ProgramDown` `saved_letter`, never a skip | test | Effect Arbitrary: CounterMsg | (a) Program's fold skips a Msg with no `_tag`: the second half of K5 red; (b) Program's fold still reads `type`: the first half red | next/packages/libfabrika/src/runtime/Program.test.ts |
| K6: saved letters written by main's own `letterLine` before this slice read back through the mailbox as the expected `_tag` Msgs, the inner Cmd included | test | vector: fixtures/next/saved-letters/type-keyed.json, rows written by origin/main's letterLine at b29e8bf2d before the switch | no upcaster: K6 red | next/packages/libfabrika/src/processes/Mailbox.test.ts |
| K7: every Msg in `next/` and tooling is keyed `_tag`: each `Machine.make`, `defineMachine` and `Program.make` compiles against the patched constraint. The compiler is the law | type | type | leave one Msg schema at `type: Schema.Literal(...)`: `pnpm typecheck` fails on its machine | pnpm typecheck |
| K8: no hand-written `_tag` is added: `fabrika/no-hand-tag` holds product code in `next/` and `.agents/` (on today); in test files, where 0562's cleanup has not turned it on yet, the slice's diff adds no `_tag` key outside an inline ignore with its reason. The review runs `git diff origin/main -U0 -- next .agents` and reads every added line with a `_tag` key | lint | lint | a test that writes `{ _tag: "inc" }` by hand: the diff check shows it | .oxlintrc.json |
| K9: every program's existing laws stay green, now drawing `_tag` Msgs through tea's `pbt` | test | @demlik/tea/pbt.arbMsgSequence: each program's own machine, each file's own runs | K2's plant (a) turns these red too | next/programs/counter/src/program.laws.test.ts |

**Lint, type or test?** K1 and K7 are types: only the compiler sees a missing handler or a wrong
key. K8 is lint. The rest are tests, since they are about what runs: tea's lookup, the bytes on
disk, the fold. No lint rule can tell a Msg's `type` from a Cmd's `type` by syntax, so the review
checks the readers table above line by line; that judgment stays with a person reading.

**New names in tests:** `MsgKeySample` is a small `Schema.TaggedUnion` the tests step defines in
`Mailbox.test.ts`, with one case that carries a Cmd and one with a field called `type`.
`CounterMsg` is the counter's Msg union, exported from `next/programs/counter/src/program.ts`
for the law, or restated in the test and pinned to the schema's type, as
[0135](../../../.decisions/0135-a-laws-file-pins-its-shapes-to-the-schema.md) allows. If
`runtime/Program.test.ts` may not import a program (`pnpm lint:layers`), the test restates it.

**The vector.** The tests step writes K6's fixture on `origin/main` before the patch, by running
the real `letterLine` and reading the rows back, and saves the rows with the Msgs they must read
back as. It is the only fixed input here.

**No host-only law.** Nothing here needs launchd, the real app, a signal or a real socket. But
slice 2 edits about 43 `*.integration.test.ts` files and laws suites they run (`RunnerTest.ts`,
`ChildrenTest.ts` and the rest), and a pull request leaves those to the 3-hour schedule
([0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md)). They are not run
on this laptop. The lead runs `scheduled.yaml` once on the slice 2 branch (`workflow_dispatch`)
before the merge (see "Calls taken").

## Files

### Slice 1: today's version on its own catalog

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| pnpm-workspace.yaml | tests | 6 | the `catalogs.old` block with its comment |
| pnpm-lock.yaml | tests | generated | `pnpm install` in the step's box: today's importers resolve tea 0.24.0 |
| oxlint-plugins/exact-versions.ts | tests | 4 | accept `catalog:<name>`; its header comment says so |
| oxlint-plugins/exact-versions.test.ts | tests | tests | E1 |
| packages/fabrika/package.json | build | 2 | `catalog:old` (it names tea twice) |
| packages/pipeline/package.json | build | 2 | `catalog:old`, twice |
| apps/fabrika/package.json | build | 1 | `catalog:old` |
| programs/counter/package.json | build | 1 | `catalog:old` |
| programs/map/package.json | build | 1 | `catalog:old` |
| programs/markdown/package.json | build | 1 | `catalog:old` |
| programs/ticket/package.json | build | 1 | `catalog:old` |
| programs/trace/package.json | build | 1 | `catalog:old` |
| programs/tracker/package.json | tests | 1 | `catalog:old`; this file is an exam path (the shared ask view), so the tests step edits it |
| docs/tutorials/agents/package.json | build | 1 | `catalog:old` |
| docs/tutorials/two-hosts/package.json | build | 1 | `catalog:old` |
| docs/direction/pin-exact-versions.md | build | docs | one line: a named catalog's pointer is exact as well |

### Slice 2: the switch

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| patches/@demlik__tea@0.25.0.patch patches/ | tests | 600 | the one patch file in patches/; the 897 hunk stays; the 949 hunks join it, every Msg spot in "The patch" |
| pnpm-workspace.yaml | tests | 2 | the row's comment names 897 and 949 |
| package.json | tests | 0 | no change: the root (tooling) stays on the default catalog, the patched tea |
| .oxlintrc.json | tests | 0 | no change: K8 uses `fabrika/no-hand-tag` as it is set today |
| oxlint-plugins/no-hand-tag.ts | tests | 0 | no change: its `Log.ts` reason is the one the inline ignores give |
| next/programs/counter/src/program.laws.test.ts | tests | tests | K9; its Msgs by maker |
| pnpm-lock.yaml | tests | generated | the patch's new hash, from `pnpm patch-commit` in the step's box |
| fixtures/next/saved-letters/type-keyed.json | tests | tests | K6's rows, written on main before the patch |
| next/packages/libfabrika/src/runtime/MsgKey.types.test.ts | tests | tests | K1, new |
| next/packages/libfabrika/src/runtime/MsgKey.test.ts | tests | tests | K2, new |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | K3, K5; its own Msgs by maker |
| next/packages/libfabrika/src/processes/Mailbox.test.ts | tests | tests | K4, K6 |
| next/**/*.test.ts | tests | tests | every Msg by its schema's maker, every expected Msg `_tag`-keyed, about 870 hand Msgs and 81 schema lines in about 130 files; raw wire frames keep the inline ignore |
| next/**/*.test.tsx | tests | tests | the same |
| next/**/*Test.ts | tests | tests | the shared suites (`RunnerTest.ts`, `ChildrenTest.ts`, `ProgramMailTest.ts` and the rest), the same |
| next/**/*.test-support.ts | tests | tests | the same |
| .agents/skills/lead/scripts/chain.test.ts | tests | tests | Msgs by maker |
| .agents/skills/lead/scripts/drive.test.ts | tests | tests | Msgs by maker |
| .agents/skills/lead/scripts/flow/machine.test.ts | build | tests | only if it reads an answer's key; outside the exam globs |
| next/packages/libfabrika/src/runtime/Program.ts | build | 30 | `Typed` on `_tag`, the Msg and Cmd reads split, `Types.Tags` for inputs |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 25 | the Msg reads; the `Down` conversion goes; answers from tea's `ok` and `err` |
| next/packages/libfabrika/src/runtime/Execution.ts | build | 4 | the Msg read |
| next/packages/libfabrika/src/runtime/Audit.ts | build | 2 | `Minimal` on `_tag` |
| next/packages/libfabrika/src/runtime/Window.ts | build | 4 | `commandMsg` on `_tag` |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 2 | the audit default |
| next/packages/libfabrika/src/processes/Mailbox.ts | build | 20 | the upcaster in `Sent` |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | 30 | its Msgs, `Types.Tags`, `Types.ExtractTag`, matchers |
| next/packages/libfabrika/src/desktop/BrainLife.ts | build | 10 | its Msgs and `reply` |
| next/packages/libfabrika/src/**/*.ts | build | 250 | the other product files of libfabrika (about 50): Msg schemas to `TaggedUnion`, makers, matchers |
| next/packages/tuval/src/**/*.ts | build | 7 | the one file with Msgs |
| next/apps/fabrika/src/**/*.ts | build | 3 | its two product files |
| next/programs/counter/src/program.ts | build | 6 | the counter's Msg; it exports `CounterMsg` if K5 needs it |
| next/programs/pipeline/src/Merger.ts | build | 20 | `answers`, its Msgs and matchers |
| next/programs/**/*.ts | build | 50 | the other programs' product files (checklist, tezgah, inbox, pipeline's other two) |
| .agents/skills/lead/scripts/chain.ts | build | 6 | its Msg as a `TaggedStruct`, sent by maker |
| .agents/skills/lead/scripts/drive.ts | build | 12 | its Msgs as a `TaggedUnion`, sent by maker |
| .agents/skills/lead/scripts/flow/machine.ts | build | 2 | only if a handler reads an answer's key |
| .patterns/effect-tagged-value-is-matched.md | build | docs | form 2 for a tea Msg is now the union's matcher; the `type` lines go |
| .glossary/TERMS.md | build | docs | the `_tag`, `input port` and `Msg` rows say a Msg is keyed `_tag` |
| docs/direction/program-shape.md | build | docs | line 118: a Msg's `_tag` and an input's key |
| docs/direction/shared-tiles.md | build | docs | line 66's example |
| docs/direction/schema-classes-not-of-helpers.md | build | docs | line 45: "0214, amended for Msgs on 2026-11-15" |
| docs/direction/code-commits-and-signs-each-step.md | build | docs | line 24's comment |
| .agents/skills/write-pattern/references/diagrams.md | build | docs | line 36: a transition label is the Msg's `_tag` |
| docs/plan/tier-1.md | build | docs | line 717: Msgs are `_tag`; Cmds keep `type` |
| docs/plan/README.md | build | docs | the where-we-are row for this patch and its issue |

`next/**/*.test.ts` and its siblings in the table are globs: the tests step changes the files they
match that hold a Msg (`rg` over `next` and `.agents` finds 234 files in all, product and tests).
The build step owns product files only.

## Calls taken

- **One pull request holds the patch and all of our side (slice 2).** 95% sure. A Msg cannot carry
  both keys without our code writing `type` beside `_tag`, a conversion the ruling forbids; tea
  reading both keys is a conversion inside tea that the maintainer is not making. So any split
  leaves main red between the parts. No number caps a pull request
  ([0099](../../../.decisions/0099-no-number-caps-a-pull-request.md)).
- **Slice 1 lands first, alone.** 90% sure of the order, given the lean at the top. It changes no
  behavior, and it proves today's version on an unpatched tea before the patch exists.
- **The patch is the tests step's.** The patches folder, `pnpm-workspace.yaml` and `pnpm-lock.yaml`
  are exam paths in the repo's exam list, so the tests step writes them, and its laws are red until the build
  lands. That matches the patch note's order: tests first, then the patch's call sites.
- **Our runner takes tea's own answer makers.** `Runner.ts:1590-1602` mints `{ type: "<cmd>_ok" }`
  in tea's shape today. tea's `CmdDef` has `ok(cmd, value, at)` and `err(cmd, error, at)`
  (`core-CDR1i78K.d.ts:172-173`), and tea's own decision 0021 says the engine makes these Msgs. The
  runner builds its answer with them and adds its `reason` field to the error. Then our answers
  move with tea's and can never drift. 70% sure the runner holds the def at that point. If it
  holds only the Cmd value, the two lines take the inline ignore with the reason "tea's answer frame,
  as tea's `mint` writes it", and the review checks that only those two do.
- **The upcaster sits in the mailbox's read, as a schema transformation.** 85% sure. It is the one
  place a saved letter's body is decoded, the encode side stays the identity, and Effect's way to
  read an old encoding into a new shape is a transformation. A rewrite of the rows was rejected:
  it breaks the resend check and the input hashes, and it loses the bytes as first written.
- **The wire gets no upcaster.** 80% sure; see "Saved letters".
- **No `_tag` by hand, tests included.** 0562 holds the principle for tests even before its lint
  turns on there. The brief asks for it. So the tests step writes about 870 Msgs with makers rather
  than the cheaper `{ _tag: "inc" }`, and K8 checks the diff.
- **The lead runs the scheduled workflow once on slice 2's branch.** 80% sure. About 43
  integration files change, and 0536 leaves them to the schedule. Finding a break after the merge
  would leave main red for up to 3 hours on a sev0 fix. One extra CI run is the cost.
- **Is this a setting?** No new choice here is one
  ([0069](../../../.decisions/0069-choices-are-settings.md)). The Msg key is tea's contract, not a
  value a person flips. The catalog's version is a pin, and pins live in the workspace file. The
  upcaster has no knob: it runs on every old row.

## Order, and what each slice clashes with

- **Before slice 2 merges:** the lead's own docs pull request amends
  [0214](../../../.decisions/0214-unions-are-tagged-with-tag.md) for Msgs; this plan cites it as
  "0214, amended for Msgs on 2026-11-15". The same pull request should point 0567's point 2 at the
  union's own matcher for a tea Msg (`0567-a-tagged-value-is-matched.md:136-137` still says
  `Match.discriminators("type")`).
- **Slice 2 waits for** pull requests
  [1341](https://github.com/kamp-us/tea-fabrika/pull/1341),
  [1331](https://github.com/kamp-us/tea-fabrika/pull/1331) and
  [1366](https://github.com/kamp-us/tea-fabrika/pull/1366) to merge, and is built on main after
  them. Slice 1 does not wait: it touches none of their files.
- **Slice 2 goes before the Effect-check sweep in busy folders**
  ([0565](../../../.decisions/0565-effects-own-checks-block.md)): a sweep pull request in
  `runtime/`, `processes/` or `client/` starts after slice 2 merges.

Clashes, from `gh pr view <n> --json files` today against the 234 files that hold a Msg:

| Open branch | Slice 1 clashes on | Slice 2 clashes on |
|---|---|---|
| [1341](https://github.com/kamp-us/tea-fabrika/pull/1341) program watch | none | waits for it: 7 files, among them `Runner.ts`, `Program.ts`, `Program.test.ts`, `processes/Process.ts`, `cloudflare/runtime.ts` |
| [1331](https://github.com/kamp-us/tea-fabrika/pull/1331) hands client | none | waits for it: `client/HandsStart.ts` |
| [1366](https://github.com/kamp-us/tea-fabrika/pull/1366) reader ack | none | waits for it: 10 files, among them `Runner.ts`, `Gateway.ts`, `RepliesSql.ts`, `telemetry/Sink.ts` and four integration tests |
| [1375](https://github.com/kamp-us/tea-fabrika/pull/1375) effect 4.1.3 (plan; its build changes the lockfile, the workspace file and a patch) | lockfile, `pnpm-workspace.yaml` | lockfile, `pnpm-workspace.yaml`; a different patch file |
| [1312](https://github.com/kamp-us/tea-fabrika/pull/1312) tezgah new tile | none | 14 files |
| [1301](https://github.com/kamp-us/tea-fabrika/pull/1301) test SQLite store | lockfile | 14 files, lockfile |
| [1232](https://github.com/kamp-us/tea-fabrika/pull/1232) cloud fabsh | lockfile | 15 files, lockfile |
| [1099](https://github.com/kamp-us/tea-fabrika/pull/1099) agent tools from a schema | lockfile, `pnpm-workspace.yaml` | 3 files, lockfile, `pnpm-workspace.yaml` |
| [1032](https://github.com/kamp-us/tea-fabrika/pull/1032) email recovery | lockfile | lockfile |
| [1371](https://github.com/kamp-us/tea-fabrika/pull/1371) accumulating spread | none | 3 files |
| Plan pull requests whose builds will touch `next/`: [1365](https://github.com/kamp-us/tea-fabrika/pull/1365), [1369](https://github.com/kamp-us/tea-fabrika/pull/1369), [1373](https://github.com/kamp-us/tea-fabrika/pull/1373), [1344](https://github.com/kamp-us/tea-fabrika/pull/1344) | none today | their builds start after slice 2 or rebase onto it |

A branch that adds a `type`-keyed Msg after slice 2 merges fails `pnpm typecheck` on rebase (K7),
so a stale branch breaks loudly, never quietly.

## Issue 949 carries the patch

A step of slice 2, after the build is green and before the merge
([0060](../../../.decisions/0060-upstream-issue-carries-the-patch.md)): the tests step saves only
the 949 hunks of the patch (not the 897 hunk) under `runs/`. The lead reads every line and appends
them to issue 949's body, inside
`<details><summary>The patch we apply locally</summary>`, a fenced `diff` block, then `</details>`.
If a fix round changes the patch, the lead edits that section too.

## Validation

- Slice 1 tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/exact-versions.test.ts`,
  E1 red before `exact-versions.ts` changes; then `pnpm lint` (which runs `lint:versions`).
- Slice 1 build step: `pnpm lint`; the narrow paths `packages/pipeline/src/machine-make.test.ts` and
  one test file of each of today's programs.
- Slice 2 tests step: K1 to K6 red on main plus the patch, before the build; each planted fault
  seen red once.
- Slice 2 build step: K1 to K6 and K9 green, the narrow paths of each folder it changed, `pnpm lint`.
- Both slices change the lockfile, so `--changed origin/main` is the full suite and is not run
  locally: the narrow paths above stand in for it, and CI runs the rest. The lead runs one
  `pnpm typecheck` and reads CI.
- The lockfile is written by `pnpm install` (slice 1) and `pnpm patch-commit` (slice 2) inside the
  step's box, the one install each slice needs. Nothing is installed on the laptop outside a box,
  and no `.integration.` or `.visual.` file is run on it.

## Records

- **What fact is lost if it is not recorded now:** see the next section. Each step's run is a row in
  `field/runs/`, the same day, as every hand-run step's is.

## What fact is lost if it is not recorded now

- **The saved letters as first written.** An upcaster keeps them; a rewrite would lose the original
  bytes for good, and with them the hashes and the resend check. This plan writes nothing new, so no
  new fact is at stake.
- **Which rows are old.** None needs a mark: an old row is one with `type` and no `_tag`, readable
  forever from the row itself.

## Size

1. Slice 1, today's version on its own catalog: 25 lines (11 package.json files, the catalog
   block, 4 lines in `exact-versions.ts`, one docs line), plus E1 and the regenerated lockfile.
2. Slice 2, the switch, which holds the patch: 1,100 lines (the patch, about 600 diff lines; our
   product code, about 480 lines in about 74 files; the upcaster, about 20), plus about 950 Msg
   spots in about 160 test files, five new laws, the fixture and about 10 docs lines.

About 14 agent hours across both slices, 65% sure. The doubt is slice 2's tests step: rewriting
about 870 hand Msgs with makers in about 130 test files is long, mechanical work, and it may take
two tests sessions on one branch and two build sessions. The patch is hand edits in hashed chunks
and 20 `.d.ts` files, which is error prone; K1 and K2 are what catch a missed spot.

Budget basis: `field/runs/` list prices for the largest steps so far, $28 for the p18 slice 1 build
(`2026-11-13-p18s1-build.json`), $14.5 and $11.8 for its two tests steps, $5 to $6 per review. Slice
1 is 3 steps (tests, build, review) at about $10. Slice 2 is two tests steps, two build steps, one
review and one fix round, priced as the largest so far, about $130.

Estimate: 9 steps, $140

## Open questions

1. Today's version: own catalog on unpatched tea 0.24.0 (my lean, 75%), or move its Msgs to `_tag` too?

## What comes after

Not ruled, so each stays as it is and no question is raised here. Each waits on its own ruling, or
on tea's release:

- Cmds keep `type`. A settled Msg carries its Cmd in `cmd`, which keeps `type`.
- Subs keep `type`.
- The state table's `state.type` (`Transitions`, `ExhaustiveTransitions`) keeps `type`, so a `_tag`
  Model still cannot use tea's state-by-Msg table.
- Semantic events (`E extends { type: string }`) keep `type`.
- The bump that takes tea's release with 949 deletes the 949 hunks and rewrites our call sites to
  match what tea ships. Today's version leaves `catalog:old` when it is deleted.

## What this plan cannot tell us

- **Today's version on 0.24.0** is a read of one commit message and a search, not a run. Slice 1's
  CI is the proof.
- **The patch's spot list** comes from the research's read of every `.type` in the shipped `.js`
  files, re-checked at the lines above. About 90% sure no Msg spot is missed in the agent chunk,
  which was read only at its matched lines. K2 covers what we use; nothing here exercises the
  agent, flow or Jev add-ons.
- **The counts** (232 schema lines in 60 product files, 356 hand Msgs in 67, 64 key reads in 20,
  81 and 872 in tests) were recounted on `origin/main` at `b29e8bf2d` with the research's searches,
  and match. About 80% of the hand literals are Msgs, from a 26-line sample; the rest are Cmds, Sub
  entries and non-tea shapes the builder leaves alone.
- **Saved data in use:** I read the schemas and the fold, not a live ledger. I do not know how many
  old rows a real `next/` ledger holds. The upcaster makes that number not matter.
- **Whether the runner holds each Cmd's def** where it mints answers: 70%, as "Calls taken" says.

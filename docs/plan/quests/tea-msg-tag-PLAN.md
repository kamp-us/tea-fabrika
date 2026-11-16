
Plancheck-Version: 3

# Plan: tea moves to 0.27.0, then one local patch keys tea's Msgs, Cmds, Subs and state table on `_tag` and carries five more asks, and every machine of ours follows

This is `next/` and our tooling (`.agents/`). Today's version is left as it runs now. It builds
[0569](../../../.decisions/0569-tea-msgs-are-keyed-on-tag.md) (owner, 2026-11-15) and its amendment
for Cmds, Subs and the state table
([pull request 1384](https://github.com/kamp-us/tea-fabrika/pull/1384)). It counts as a fix of that
day's sev0. Everything we ask tea for is patched here and not waited on: one patch file,
`patches/@demlik__tea@0.27.0.patch`, carries six asks on `kamp-us/demlik`, and each lands through the
steps in its own pull request. Seven pull requests in all.

```ts
// The whole idea. Before, on main (next/programs/counter/src/program.ts):
const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("dec") }),
  Schema.Struct({ type: Schema.Literal("reset") }),
]);
runtime.dispatch({ type: "inc" });            // the key, written by hand

// After slice 2: tea's core reads `_tag` on a Msg, a Cmd, a Sub and a state (patched).
const Msg = Schema.TaggedUnion({ inc: {}, dec: {}, reset: {} });
runtime.dispatch(Msg.cases.inc.make({}));     // the schema's maker writes the key
// update: { inc, dec, reset } is unchanged: tea keys the table by the same names.

// After slices 3 to 7, the asks our code proved, each deleting the workaround it replaces:
applyCell(child, s.child, m);                 // 950: types from the machine, a wrong Msg fails to compile
def.schema.input;                             // 951: the Cmd's own Effect schema, typed
Schema.Union([Land, change.settled]);         // 952: tea builds a Cmd's `_ok | _err` schema
update: (s, m) => Msg.match(m, { ... });      // 954: update may be one function
[s, Cmd.within("handshake", cmds)];           // 953: Elm's Cmd.map, kept as data
```

## The slices, in order

| # | Pull request | Tea issue | Why here |
|---|---|---|---|
| 1 | tea 0.25.0 to 0.27.0; today's version on its own catalog at 0.25.0, unpatched | 897, already shipped | the patch is written against 0.27.0, and the bump deletes the 0.25.0 patch (0569) |
| 2 | the `_tag` patch: Msg, Cmd and the `cmd` a settled Msg carries, Sub, the state table; all of our side; old dev and test homes wiped at landing | [949](https://github.com/kamp-us/demlik/issues/949) | every later ask is written in `_tag` terms, and the issues say so ("With #949, `type` here becomes `_tag`") |
| 3 | `applyCell` and its siblings take their types from the machine | [950](https://github.com/kamp-us/demlik/issues/950) | types only, the smallest; slices 6 and 7 step children with the typed `applyCell` |
| 4 | a Cmd from `Cmd.make` keeps its Effect schemas in its type; the any-def keeps `input` | [951](https://github.com/kamp-us/demlik/issues/951) | types only; slice 5 builds `settled` from these typed schemas |
| 5 | a Cmd def carries `settled`, the schema of its `_ok \| _err` Msgs | [952](https://github.com/kamp-us/demlik/issues/952) | needs slice 4; slice 6's Merger update reads the union slice 5 makes |
| 6 | `update` may be one function as well as a table | [954](https://github.com/kamp-us/demlik/issues/954) | rewrites the forwarding tables of four machines, two of which slice 7 changes again; doing it first means slice 7 edits one function, not 22 table rows |
| 7 | `Cmd.within`: a parent wraps its child's Cmds as data, and their answers come back wrapped | [953](https://github.com/kamp-us/demlik/issues/953) | the biggest change to tea's run time (the settle step, both engines, save and replay), so it goes last, on top of everything it uses |

No two must land together: each slice is whole, green on its own, and deletes its own workaround.
Slices 3 and 4 touch different tea files and different files of ours, so their order between
themselves is free; 3 goes first because it is smaller. 85% sure of this order.

## Today's version: answered, no question left

With `next/` and the root on 0.27.0 and today's version left at 0.25.0, pnpm patches only the
`@demlik/tea@0.27.0` copies, since a patch is keyed by name and exact version. Today's code is
untouched: slice 1 gives it a named catalog, `catalog:old`, that keeps it at 0.25.0, unpatched, as
it runs now. No downgrade and no change to today's Msgs: the owner's standing rule leaves today's app
alone unless he names it.

- The 0.25.0 patch (demlik 897) goes. It only adds `model` and `msg` to `Machine.make`'s return type
  (a `.d.ts` hunk), and only `next/`'s `Program.make` reads them (pull request 522). Today's version
  loses a type it never uses, and nothing at run time changes.
- pnpm's catalogs docs describe named catalogs for holding two versions of one package in a
  workspace (from memory of the docs, not fetched for this plan).
  `oxlint-plugins/exact-versions.ts` already checks that a `catalogs.<name>` entry is exact (line
  61); it only needs to accept the `catalog:<name>` pointer (line 16). Law E1 holds that.
- One small doubt: the root's tooling imports today's library (`.agents/skills/lead/scripts/agents.ts`
  imports `Agent` from `@kampus/fabrika-old`), so 0.25.0 and 0.27.0 meet in one type check. If a tea
  type crosses that line, slice 1's `pnpm typecheck` shows it. 85% sure none does.

## How others do it

- **tea itself** ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md): read first).
  Read in tea's repository, `kamp-us/demlik`, the one the installed `package.json` names, and in the
  0.27.0 tarball (`npm pack @demlik/tea@0.27.0` into an empty folder, nothing installed).
  - No tea decision sets the key. Its `.decisions/0014` keeps a Cmd a plain record
    (`{ type: "retry", wait: 250 }`); its errors and `Outcome` are already `_tag`. Its
    `.decisions/0021` says the engine turns a handler's outcome into the Cmd's `<name>_ok` or
    `<name>_err` Msg, which is why our runner takes tea's own answer makers in slice 2.
  - 0.26.0 (demlik pull request 890, "a recorded step keeps the Cmds it started") is additive:
    `observe` gets an optional third argument and `TraceStep` an optional `cmds`. 0.27.0 (demlik
    pull request 904) ships 897: `effect/index.d.ts:226-228` returns `model` and `msg` on the
    machine. `core-CDR1i78K.d.ts` is the same file in both versions, digits aside. The manifests
    differ only in the version and a `@demlik/code-graph` dev pin. No file of `next/` or tooling
    uses tea's recorder (`rg replayTrace|recordTrace|tea-trace` finds none).
  - The six issues ask for the core change, not a helper. No upstream pull request exists for any of
    them today.
- **Effect:** every union is keyed by `_tag`. `Schema.TaggedUnion` and `TaggedStruct` write it;
  `Union.match`, `Union.isAnyOf`, `Match.valueTags` read it. `Types.Tags<E>` and
  `Types.ExtractTag<E, K>` (`effect/dist/Types.d.ts:121`, `:196`, effect 4.1.2) are the type forms of
  `M["type"]` and `Extract<M, { type: K }>`. Reading an old encoding into a new type is a schema
  transformation: `Schema.decodeTo` with `SchemaTransformation.transform` (`Schema.d.ts:4674`,
  `SchemaTransformation.d.ts:401`).
- **Elm:** a Msg is a custom type with no key; its constructors play the part of
  `Msg.cases.inc.make`. `update : Msg -> Model -> (Model, Cmd Msg)` is one function with one `case`,
  which is slice 6. A parent wraps its child's Cmds with `Cmd.map` and gets the child's answers back
  wrapped (https://guide.elm-lang.org/webapps/structure.html), which is slice 7, kept as data because
  a tea Cmd is saved and replayed. Old saved JSON is read with a decoder that accepts both shapes
  (`Json.Decode.oneOf`), an upcaster written as a decoder. From the Elm guide, not fetched.
- **Erlang/OTP:** a message's case is its tuple tag. A shape change goes with hot code upgrade:
  `code_change/3` converts saved state. From the OTP design principles, not fetched.
- **React:** `useState(initial)` takes a value or a function that makes one, told apart by `typeof`.
  Issue 954 asks for the same shape for `update`.
- **Event sourcing, for saved rows:** the known way to keep an old log is **upcasting**. The log
  stays as written, and each old event is converted to the current shape as it is read. Greg Young, *Versioning in an Event
  Sourced System* (Leanpub, 2017), the chapter on upcasting; Axon Framework's reference guide, "Event
  Upcasting"; Marten's docs, "Events Versioning". None fetched. tea's own `schemaMigrate(schema,
  upcast)` does this for state. We take neither it nor a rewrite: `next/` holds no real data, and the
  owner ruled that old dev and test homes are wiped when the patch lands, with no conversion code (the
  saved-shape migration decision).
- **Changing a key in every reader at once** is a **flag day** (the Jargon File's term). The usual
  way around one is **parallel change**, or expand and contract (Danilo Sato on martinfowler.com,
  2014, not fetched): accept both keys for a while. Here that is tea reading `_tag ?? type`, or our
  code writing both: the conversion 0569 forbids. So slice 2 is a flag day, in one pull request, with
  the compiler finding every spot.

## Slice 1: tea 0.27.0, and today's version on its own catalog

```yaml
# pnpm-workspace.yaml, a sketch.
catalog:
  '@demlik/tea': 0.27.0          # next/, the root (tooling); patched from slice 2 on
catalogs:
  # Today's version (packages/, programs/, apps/, docs/tutorials/), held at the tea it runs on, with
  # no patch, while next/ moves to `_tag` (0569). Goes when today's version goes.
  old:
    '@demlik/tea': 0.25.0
patchedDependencies:
  # (the row for @demlik/tea@0.25.0 and its demlik#897 comment go: 0.27.0 ships the fix)
minimumReleaseAgeExclude:
  - '@demlik/tea@0.25.0 || 0.27.0'
```

```jsonc
// packages/fabrika/package.json and the 10 other package.json files of today's version that name tea
"@demlik/tea": "catalog:old"
```

```ts
// oxlint-plugins/exact-versions.ts:16, a sketch: a named catalog's pointer is exact too,
// since its entry is checked exact in pnpm-workspace.yaml (line 61 already does that).
const NAMED = /^catalog:[a-z][a-z0-9-]*$/;
const exact = (version: unknown) =>
  typeof version === "string" && (POINTERS.has(version) || NAMED.test(version) || EXACT.test(version));
```

- `patches/@demlik__tea@0.25.0.patch` is deleted with `git rm`, and its row at
  `pnpm-workspace.yaml:147-148` goes.
- [0256](../../../.decisions/0256-a-program-is-one-program-make.md) lines 52-53 still say tea's side
  is unfixed and patched locally. The bump fixes that line: "tea 0.26.0 shipped it (demlik 897); no
  patch is needed". A fact correction, in the same pull request.
- Our code needs no change for 0.27.0: `Program.make` already reads the machine's `model` and `msg`,
  which 0.27.0 types the same way the patch did. The type check is the proof (law E2).

## Slice 2: the `_tag` patch, and all of our side

### What the patch changes in tea 0.27.0

One file, `patches/@demlik__tea@0.27.0.patch`, made with `pnpm patch @demlik/tea@0.27.0` and
`pnpm patch-commit`, edited in the folder pnpm prints, one editor edit at a time, never a
find-and-replace. Every line below was read in 0.27.0's built files today. A chunk's source file
comes from its source map. The scope is a Msg, a Cmd value and the `cmd` a settled Msg carries, a Sub
value, and the state table's lookup of `state.type`. Semantic events (`E extends { type: string }`)
stay on `type`, and so do tea's own internal unions (an engine's `phase`, `saveStatus`, the
extension's envelope, Jev's question kinds, the durable-effects log, otel's attributes).

```text
# Run time (.js), 0.27.0. M = Msg, C = Cmd, U = Sub, S = state table.
chunk-SKI5V64W.js (pure/core.ts)
  C  52 (text), 138, 152 byType.get(cmd.type), 212 build { ...input, type: name }
  U  494 { id, type: entry.type, deps }
  M  154, 158, 164, 179, 188, 194 (mint), 217-218 (def ok/err), 240 (text), 284 record[msg.type],
     294 (msg part), 305, 312, 752, 765
  S  254-255 stateNameOf, 266 table[state.type], 293 stateKey
  stays: 449 subIdOf hashes { type, deps } (an internal hash input; renaming it changes every Sub id for nothing)
chunk-BXLD374W.js (engine/loop.ts)   U 40, 206, 211, 217, 221, 226, 235   C 292   M 343, 349, 351, 353
chunk-E3NGRQDB.js (builtins.ts, tell.ts)  M 43, 287 (the value; the key `msgType` stays), 325   C 60
                                          stays: 198 event.type (semantic events), 236-267 saveStatus
chunk-5HWE6CAZ.js (effect/run.ts)    C 196
chunk-AOVUU5NF.js (testing/drive-loop.ts)  C 78, 80
chunk-BSGN3CEF.js (subs/define-listener.ts)  U 301, 303, 358, 360
chunk-HKWLAXAI.js (pbt/laws.ts, replay-fold.ts)  C 63, 67   M 82
chunk-I4WVPPC4.js (recorder)         M 141 (139's `type: "default"` is a Sentry breadcrumb field, stays)
chunk-LDWEQ22Q.js (resilience)       U 9, 12, 98   M 40, 95
chunk-LNJSAPQV.js (agent/*)          M 226, 298, 301, 395, 578, 585, 1086, 1156, 1210   C 1203, 1207
                                     stays: 325-382, 402, 1235 (agent events), 899-913 (content parts)
chunk-LPWPPBU2.js (react/send.ts)    M 11
devtools/index.js                    M 187
do/index.js                          M 46 defaultParseEvent   C 627   stays: 453, 487, 492 (effect events)
effect/index.js                      M 148   stays: the phase lines
flow/index.js                        M 493
jev/index.js                         M 386   U 496   stays: 74, 165, 167, 364 (question kinds)
machine-viz/index.js                 S 68, 113   U 129
pbt/index.js                         M 41, 45, 158-159   C 223
react/index.js                       M 145   stays: the phase lines
testing/effect/index.js              U 193, 196
testing/index.js                     S 99 stateFactory

# Types (.d.ts), 0.27.0.
M extends { type: string }   -> { _tag: string }   119: named M (109), Msg (8 in do/index.d.ts), Allowed, RM
S extends { type: string }   -> { _tag: string }   5: Transitions, ExhaustiveTransitions (core-CDR1i78K.d.ts), stateFactory (testing/index.d.ts)
Cmd<T> `readonly type: T`    -> `readonly _tag: T` core-CDR1i78K.d.ts:387; CmdInput refuses `_tag` (:128-130)
Sub<T>, DepKeyedSub          -> `readonly _tag: T` core-CDR1i78K.d.ts:509, :547, :683 (BuiltinSubType)
SettledOk / SettledErr       -> `readonly _tag: \`${Name}_ok\`` core-CDR1i78K.d.ts:139, :151
indexed forms                -> M["_tag"], C["_tag"], U["_tag"], S["_tag"] and their Extract<..., { _tag: K }>
                                (core-CDR1i78K.d.ts:357, 370-374, 608, 652, 678; run-u711x9Iv.d.ts:224, 248, 267-270, 283;
                                pbt/index.d.ts:196, 204, 285; testing/index.d.ts:196, 209, 220)
tea's own Msg, Cmd and Sub types: flow/index.d.ts, jev/index.d.ts, index-BdV785AK.d.ts, index-I-rewcm9.d.ts,
                                machine-BblDmW8H.d.ts (the agent), each read at its `type` member
stays: E extends { type: string } (22), E["type"], Extract<E, ...>
```

- **It covers every entry, not only the ones we import** (`effect`, the root, `pbt`, `react`,
  `testing`, `node`). A half-moved tea is a tea nobody ships, and the patch must match the core change
  the maintainer makes. 85% sure.
- **It leaves tea's README, JSDoc examples and `.js.map` sources alone.** They do not change what
  runs, and tea's release rewrites them. 0562 covers `next/` and our tooling, not `node_modules`. 80%.
- **The workspace row** names every issue the file carries. After slice 2:

```yaml
  # One file, every change we asked tea for, each dropped at the release that has it:
  # demlik#949 Msgs, Cmds, Subs and the state table keyed on `_tag`.
  '@demlik/tea@0.27.0': patches/@demlik__tea@0.27.0.patch
  # Slices 3 to 7 each add their line: #950, #951, #952, #954, #953.
```

### Our side

```ts
// A Msg schema: next/programs/counter/src/program.ts and its 59 siblings.
const Msg = Schema.TaggedUnion({ inc: {}, dec: {}, reset: {} });
runtime.dispatch(Msg.cases.inc.make({}));                     // made by its maker (0562)
// Read by its own matcher (0567, form 1). 0567's form 2 for a tea Msg, Match.discriminators("type"),
// goes: a Msg is now like every other union.
Msg.match(m, { inc: ..., dec: ..., reset: ... });

// A type that names cases: Effect's own helpers, so no `_tag` member is written.
type Names = Types.Tags<LinkMsg>;                             // was LinkMsg["type"]
type Pong = Types.ExtractTag<LinkMsg, "pong">;               // was Extract<LinkMsg, { readonly type: "pong" }>

// A Cmd: made by its def, as today; the def now writes `_tag`. A Cmd's input schema, where we
// restate it, says `_tag` (Merger.ts:109, a sketch):
const cmd = input.mapFields((fields) => ({ ...fields, _tag: Schema.Literal(name) })); // inline ignore, see below

// tooling: .agents/skills/lead/scripts/chain.ts:785, a plain type today.
// Before: type Msg = { readonly type: "start"; readonly step: StepName };
//         runtime.dispatch({ type: "start", step: start });              // :1768
// After:  const Msg = Schema.TaggedStruct("start", { step: StepName });
//         runtime.dispatch(Msg.make({ step: start }));
```

Our Cmd, Sub and state spots, counted on main at `c91a07f6e` with the research's searches: 25 reads
of `cmd.type`, `c.type` or `command.type` in 8 product files (179 in 25 files with tests); 17 reads
of `okType`, `errType` or `cmdType` in 6 product files; 6 hand Sub entries `{ type: "timer", deps }`
in 4 product files (30 in 13 files with tests); 15 reads of `sub.type` and its kin. The Msg counts
match the research: 232 schema lines in 60 product files, 356 hand values in 67, 64 key reads in 20;
in tests, 81 schema lines and 872 hand values. No machine of ours uses tea's `Transitions`
(`rg Transitions` over `next` and `.agents` finds none), so the state-table change touches none of
our machines today. A machine that compares a state's `_tag` by hand could move to `Transitions`
later; that is not part of this patch.

### The readers that know no program

Each was read on main. The review checks each against the verdict here, since no compiler can tell
a semantic event's `type` from the rest. With Cmds and Subs moving too, one key is read everywhere,
so each `Typed` below becomes one `_tag` read, with no Msg and Cmd split.

| Place (on main at `c91a07f6e`) | Reads | Verdict |
|---|---|---|
| `runtime/Program.ts:213` `type Typed`, `:235` `K extends M["type"]` | Msg | `_tag`; `:235` becomes `Types.Tags<M>` |
| `runtime/Program.ts:592-595` `isTyped`, `decodeTyped`, used at `:628`, `:642`, `:705`, `:728`, `:841-844` | Msg and Cmd | `_tag` |
| `runtime/Runner.ts:368` `Typed`, used at `:328`, `:741`, `:1288`, `:1459`, `:1462`, `:2766`, `:2773` | Msg and Cmd | `_tag` |
| `runtime/Runner.ts:1414` `{ ...down.value, type: down.value._tag }` | Msg | the conversion goes: `Down` is already a tagged union |
| `runtime/Runner.ts:1584-1602` answers `<cmd>_ok` and `<cmd>_err`, and the echoed Cmd | Msg, Cmd | tea's own `def.ok` and `def.err` (see "Calls taken") |
| `runtime/Runner.ts:279`, `:302` take a Cmd value apart (`const { type: _type, ...rest }`) | Cmd | `_tag` here; slice 4 deletes the take-apart |
| `runtime/Runner.ts:2461` the timer's Msg `{ type: "timer", at, arrivedAt }` | Msg | `_tag` |
| `runtime/Execution.ts:29` `Typed`, used at `:196`, `:207` | Msg and Cmd | `_tag` |
| `runtime/Audit.ts:92` `Minimal` | Msg | `_tag` |
| `gateway/Gateway.ts:1421` audit default `{ type: name }` | Msg | `_tag`; `:1244` already reads `_tag` |
| `runtime/Window.ts:124` `commandMsg` | Msg | `_tag` |
| `client/WindowMachine.ts:1267`, `:1587`, `:1298` | Msg, Cmd | `Types.Tags`, `Types.ExtractTag`; `:1587`'s check reads `_tag` |
| `client/WindowMachine.ts:1972-1974`, `client/HandsMachine.ts:766-767`, `transport/Link.ts:210` | Sub | `_tag` |
| `desktop/BrainLife.ts:87`, `:160-166`; `desktop/BrainServiceManaged.ts:100`, `:104` | Msg, Cmd | `_tag` here; slice 5 deletes `responses` and the casts |
| `programs/pipeline/src/Merger.ts:102-119`, `programs/pipeline/src/Queue.ts:37-53` `answers` | Msg, Cmd inside | `TaggedStruct`, the Cmd's `_tag`; slice 5 deletes both helpers |
| `.agents/skills/lead/scripts/drive.ts:411`, `:445`, `:709`, `:1764`, `:2286`; `chain.ts:785`, `:1768` | Msg, Sub (`:709`) | `TaggedStruct` and makers for Msgs; the Sub entry's key is `_tag` |
| `.agents/skills/lead/scripts/flow/machine.ts` | answer Msgs only (`msg: Schema.Never`) | changes only where a handler reads an answer's key |

Paths without a folder are under `next/packages/libfabrika/src/`.

**The inline ignores this slice may add, and no others.** A reader or writer that knows no cases, or
a value tea gives no maker for, must still name the key `_tag`, and `fabrika/no-hand-tag` fires on any
object key, struct field or type member called `_tag`.
[0562](../../../.decisions/0562-nothing-teaches-the-wrong-shape.md) allows one exception:
`// oxlint-disable-next-line fabrika/no-hand-tag -- <why>` on the line. Expected places:

- readers that know no cases, with the reason `oxlint-plugins/no-hand-tag.ts` gives for
  `ledger/Log.ts`: `Program.ts` `Typed`, the `Execution.ts` and `Runner.ts` readers, `Audit.ts`
  `Minimal`, `Gateway.ts:1421`, `Window.ts` `commandMsg`, `Runner.ts:2461`;
- a Cmd's restated input schema in `Merger.ts` and `Queue.ts`, until slice 5 deletes both;
- tea's Sub entries, for which tea gives no maker: the 6 `{ _tag: "timer", deps }` lines and
  `drive.ts:709`;
- test files' raw wire frames, as 0562 allows.

About 20 product lines. A reviewer treats any other ignore as a fault. No shared schema or wrapper
type holds the key, since 0562 forbids a named wrapper that lets a hand-written `_tag` through.

### Old saved data: wiped when the patch lands, never converted

The owner ruled (the saved-shape migration decision) that our code holds no conversion for saved tea
values. `next/` holds no real data, so a home written before slice 2 is wiped as a step of the
landing, and nothing in our code reads the old shape. After the merge, a row keyed `type` that is
somehow still read makes the restart fail loudly: by my read of `Program.ts:839-854`, the fold fails
on decode and throws `ProgramDown` with `saved_letter`. (The research said such a row would be
skipped quietly; the code says it fails loudly.)

Where saved tea values live, read on main today, and what happens to each:

| Home | What it holds that carries a key | Wiped how, and by whom |
|---|---|---|
| each person's `next/` dev home: `$FABRIKA_HOME`, else `~/.fabrika` (`next/apps/fabrika/dev.ts:94`) | `.alchemy/` (the local brain's stores: ledger inbox rows, checkpoints with owed Cmds, recovery inputs, replies), `brain.pending.jsonl`, `brain.last.json`, `brain.records.sqlite` (`node/dev/local-dev.ts:251-252`, `node/dev/dev-recording.ts:42`), `instance.json` and `build/` (`dev.ts:124`, `:150`) | a landing step: stop the dev brain, then delete exactly these entries; `fabrika.toml`, the person's settings, stays. The next `dev.ts` start founds a fresh home |
| the same folder is also today's app's home (`apps/fabrika/src/host/settings.ts:81`) | today's app's own files | never touched: the step deletes only the entries named above, by name, never the folder |
| the committed fixture home in `fixtures/next/port-home/`: its saved home folder and `saved.json` | a Process store that holds `"type":"inc"` twice (read today with `strings`) | slice 2's tests step records it again from a run on the patched build, with the writer that saved it (`next/apps/fabrika/src/port-home.test-support.ts`), so the port-home laws read a home of the new shape |
| test homes (temp folders a test makes and removes) and CI | nothing kept between runs | none |
| the root `.alchemy/` of a checkout or worktree (ignored by git) | local dev state of a stage started from that checkout | the same landing step deletes it in each checkout the lead or the owner runs `next/` from |
| a deployed `next/` stage on Cloudflare (`next/apps/fabrika/alchemy.run.ts`), if one exists | its Durable Objects' stores | the lead checks whether any stage is deployed; if one is, it is destroyed and deployed again through Alchemy, as a landing step |

- **The wipe on the owner's Mac waits for his yes.** It deletes files in his home folder, so the lead
  shows him the exact list of entries first, and runs it only after his yes, the same rule as any run
  on his machine ([0178](../../../.decisions/0178-host-only-laws-run-first.md)). On the lead's own
  checkouts and boxes, the lead runs it at the merge.
- **The landing step is a command list in the pull request body,** not code in the repo: no new
  shell or Python script enters the repo
  ([0113](../../../.decisions/0113-no-shell-or-python-scripts.md)), and a wipe that runs once needs
  no program.
- **The wire is not converted either.** The gateway decodes an input with the program's own Msg
  schema before it is saved (`Gateway.ts:1238-1243`). An input from a window still on old code is
  refused at the door like any malformed input and never saved. What is lost: one input from a tab
  left open across the upgrade, sent again after the reload.
- **Sub values are never saved:** a Sub comes from the Model through `deps` on every turn.

## Slices 3 to 7: what tea gets, and what of ours goes

Each slice adds its hunks to the same patch file and its line to the workspace row, deletes our
workaround in the same pull request, and posts its own hunks on its issue (see "Each issue carries
its patch"). Line numbers are 0.27.0's built files and main's files today; slice 2 moves both, and
each slice's tests step re-reads them on its base.

### Slice 3, demlik 950: `applyCell` takes its types from the machine

```ts
// core-CDR1i78K.d.ts:276-285 today (and applyCellChecked :286, foldMsgs :804,
// tryApplyCell runtime-types-C11LhO_3.d.ts:1011, tryFoldMsgs :1047), after slice 2:
declare function applyCell<S, M extends { _tag: string }, C = Cmd>(
  machine: { update: object; __form?: UpdateForm }, state: S, msg: M): readonly [S, readonly C[]];

// After, a sketch: the machine form comes first and fixes every type; the loose form stays second,
// for tooling that steps a bare { update } object.
declare function applyCell<S, M extends { _tag: string }, C extends Cmd, U extends Sub, Ctx>(
  machine: Machine<S, M, C, U, Ctx>, state: NoInfer<S>, msg: NoInfer<M>): readonly [S, readonly C[]];
```

- Types only; nothing at run time changes.
- **Ours goes:** the 11 product calls that spell `applyCell<...>` by hand (`rg 'applyCell<'` over
  libfabrika's product files, among them `cloudflare/runtime.ts:1541-1545` and
  `client/WindowMachine.ts:806`), and the `ReturnType<typeof X.init>[1][number]` types that exist only
  to name a machine's Cmd (the research counted 8; the builder lists each one it deletes).
- **The shape:** an overload in front, since our calls always pass a machine and the loose form
  serves tea's own tooling. 70% sure; demlik issue 946 warns that more overloads make errors worse,
  so if the overload's error on a wrong Msg is unreadable, the patch uses a separate typed name
  instead, as 950 offers. Law A1 reads the error text.

### Slice 4, demlik 951: a Cmd keeps its Effect schemas in its type

```ts
// effect/index.d.ts:169-184 (Cmd.make) and core-CDR1i78K.d.ts:166-195 (CmdDef, AnyCmdDef), a sketch.
// effect/index.js:11-14 already wraps each schema with Schema.toStandardSchemaV1, which returns
// StandardSchemaV1 & S: the Effect schema is there at run time, only the type hides it.
interface EffectCmdDef<Name, Input, Ok, E> extends CmdDef<Name, Input, Ok, E> {
  readonly schema: {
    readonly input: StandardSchemaV1<unknown, Input> & Schema.Codec<Input>;
    readonly ok: StandardSchemaV1<unknown, Ok> & Schema.Codec<Ok>;
  };
}
// AnyCmdDef keeps `input` beside `ok`.
```

- Types only, on the Effect entry; core keeps plain Standard Schema.
- **Ours goes:** the dig-out at `runtime/Program.ts:740-741`
  (`const schemas: object = def.schema; "input" in schemas && ...`), `accepts` and `isDeclared` at
  `Program.ts:616-620`, and the hand take-apart of a Cmd at `Runner.ts:279` and `:302`.

### Slice 5, demlik 952: a Cmd def carries `settled`

```ts
// effect/index.js:11 (Cmd.make) and its type, a sketch: built once, from the def's own schemas
// (slice 4) and tea's own facts (the `at` stamp, the `cmd`, tea's `malformed_result`).
change.settled; // Schema.Union([
                //   Schema.TaggedStruct("change_ok",  { cmd: ChangeCmd, value: Change, at: Schema.Number }),
                //   Schema.TaggedStruct("change_err", { cmd: ChangeCmd, error: Errors | MalformedResult, at: Schema.Number }),
                // ])
// It sits beside a machine's `msg`, never inside it: `msg` is also what an outside sender may send,
// and our runner refuses a settled Msg sent from outside (Program.ts:707-712).
const Msg = Schema.Union([Land, Abandon, change.settled, merge.settled, send.settled]);
```

- On the Effect entry only, since core takes any Standard Schema and cannot build an Effect union.
- **Ours goes:** `answers` in `programs/pipeline/src/Merger.ts:102-119` (5 calls) and its copy in
  `programs/pipeline/src/Queue.ts:37-53` (2 calls and one hand struct), `responses` in
  `desktop/BrainLife.ts:87` (7 calls) and its hand `malformed_result` at `:83-84`, the 6 hand structs
  of `runtime/ChaosMachine.ts`'s 3 Cmds, and the casts in `desktop/BrainServiceManaged.ts:100`, `:104`,
  which mint through `def.ok` and `def.err` instead.

### Slice 6, demlik 954: `update` may be one function

```ts
// core-CDR1i78K.d.ts:224 (UpdateForm), chunk-SKI5V64W.js:284 (the reducer lookup), :260
// acceptedTypes, :322 msgKeysOf, :340 describeMachine, :305 NoCellError, and Machine.make's spec in
// effect/index.d.ts:219-229, a sketch.
type UpdateForm = "reducer" | "transitions" | "function";
// at run time: typeof machine.update === "function" ? machine.update(s, m) : record[m._tag]?.(s, m)
// the names tea reads come from the msg schema's cases plus each def's okType and errType:
msgKeysOf(machine); // ["land", "abandon", "timer", "change_ok", "change_err", ...]
Machine.make({ model, msg, cmds, init, update: (s, m) => Msg.match(m, { land: ..., abandon: ... }) });
```

- Same field, two forms, picked by `typeof`, as 954 and React's `useState` do. The table stays the
  default.
- **Only the Effect entry takes the function form,** because only it always has a `msg` schema to
  read the names from. Core's `defineMachine` keeps the table. 75% sure; 954 leaves it to the
  maintainer, and core with no schema has no names to read.
- **Ours goes:** the 43 forwarding rows, counted on main: `Merger.ts` 13 rows to `reduce`,
  `Queue.ts` 8, `client/HandsMachine.ts` 11 to `linked`, `client/WindowMachine.ts` 11 through the
  cast at `:1253-1267`, and the cast itself. `runtime/Program.ts:686`'s `msgKeysOf(machine)` keeps
  working, since tea answers it from the schema; law F2 holds that.
- **Not here:** splitting Merger's 200-line `reduce` into one handler per Msg under `Msg.match`
  (0567). It is its own pull request after this one (see "What comes after").

### Slice 7, demlik 953: `Cmd.within`, Elm's `Cmd.map` kept as data

```ts
// A sketch. core: a new Cmd.within beside Cmd.when (core-CDR1i78K.d.ts:383-470), the settle step
// (chunk-SKI5V64W.js:173 mint, :217-218 def ok/err), the Effect engine's settle (chunk-5HWE6CAZ.js:99),
// pbt's answer helpers (chunk-HKWLAXAI.js:63-67) and testing's drive loop (chunk-AOVUU5NF.js:78).
Cmd.within("handshake", cmds);
// writes the name on each Cmd as data: { _tag: "hello", ..., within: ["handshake"] }
// the Cmd still runs by its own `_tag`; its answer comes back wrapped, outermost name first:
// { _tag: "handshake", msg: { _tag: "hello_ok", cmd: { ..., within: ["handshake"] }, value, at } }
```

- **The wrap lives in `def.ok` and `def.err`,** which read it from the Cmd they are given. So every
  host that mints through the def wraps the same way, our runner included (slice 2 moves it onto
  them). 70% sure the maintainer would put it there; it is the one place both engines and every host
  already pass through.
- **Data all the way, so save and replay hold:** the wrap is a field of the Cmd, and the Cmd is what
  the checkpoint saves and the recorder keeps. The field's name follows the issue's sketch,
  `within`, and `CmdInput` refuses it as it refuses `_tag`. 65% sure of the name; tea's release
  renames our call sites if it differs.
- **Ours goes:** the 10 cells that only forward a child's answer (`client/WindowMachine.ts:1634-1637`,
  `client/HandsMachine.ts:709-712`, and the `ping_ok`/`ping_err` pairs), and the 5 places that rename
  or filter a child's Cmds (`WindowMachine.ts:807`, `:1169-1170`, `:1298`, `:1509`;
  `HandsMachine.ts:533`), among them the id-prefix test `m.cmd.id.startsWith("h")`.

## One value traced: an `inc` pressed, saved, and folded after a restart, next to old rows

1. A person presses `+` on the counter. `runtime/Window.ts`'s `commandMsg("counter.inc")` answers the
   frame `{ _tag: "inc" }`, sent with `process.send`.
2. The gateway decodes it with the counter's input schema, now a `TaggedUnion`, and gets
   `{ _tag: "inc" }`. Its name, read at `Gateway.ts:1244`, is `"inc"`. The letter is appended to
   `fabrika/counter/inbox` with body `{ "m": { "_tag": "inc" } }`.
3. The runner reads it through `mailbox.read`. Patched tea looks up `record["inc"]`, and the count
   goes from 4 to 5. The brain restarts and folds the same row the same way.
4. A pipeline answer is saved as `{ "m": { "_tag": "ci_ok", "cmd": { "_tag": "ci", "pr": 7 },
   "value": "green", "at": 9 } }`: tea's `def.ok` wrote both keys. A checkpoint's owed Cmd is saved as
   `{ "_tag": "ci", "pr": 8 }` and is dispatched again on a restart.
5. A home from before slice 2 never reaches this point: the landing step wiped it, and the next
   `dev.ts` start founded a fresh one. Had one survived, its first `{ "type": "inc" }` row would stop
   the restart with `ProgramDown` `saved_letter`, loudly.
6. Sends from a tab still on old code are refused at the gateway's door and never saved.
7. After slice 7, the window's handshake child sends `hello`. The window wraps it:
   `Cmd.within("handshake", [hello])`. The answer comes back as
   `{ _tag: "handshake", msg: { _tag: "hello_ok", ... } }`, and the window's one `handshake` cell hands
   `m.msg` to the child unchanged. The four forwarding cells at `WindowMachine.ts:1634-1637` are gone.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| E1 (slice 1): `exact-versions` accepts `catalog:<name>` for any lower-case name, refuses a range inside `catalogs.<name>`, and still refuses `catalog:^1`, `catalog: old` and a bare tag. It runs the real script on its own git tree, as its siblings do | test | fc.stringMatching: catalog names, 10 runs | (a) leave `POINTERS` as it is: `catalog:old` is refused, E1 red; (b) a pointer pattern that allows any text after `catalog:`: `catalog:^1` passes, E1 red | oxlint-plugins/exact-versions.test.ts |
| E2 (slice 1): `next/` and tooling type-check on 0.27.0 with no patch, and today's version on `catalog:old` at 0.25.0. The compiler and the existing suites are the law | type | type | point one `next/` package at `catalog:old`: `Program.make` loses the machine's `msg` type (0.25.0 unpatched has none), and its type check fails | pnpm typecheck |
| K1 (slice 2): a Msg made with `Schema.TaggedUnion` is taken by the patched `Machine.make`; a missing handler, a misspelled handler, a misspelled Msg sent to `dispatch`, a Msg schema keyed `type`, and a Cmd input with a `_tag` field are each a compile error (`@ts-expect-error`); an answer (`<cmd>_ok`) is handled in the same table, and its `cmd` is typed with `_tag` | type | type | (a) drop the patch's `.d.ts` hunks: the tagged machine fails to compile, K1 red; (b) keep `Extract<M, { type: K }>` in `Reducer`: the handler's Msg loses its fields, K1 red; (c) keep `Cmd<T>`'s `readonly type`: the answer's `cmd._tag` fails, K1 red | next/packages/libfabrika/src/runtime/MsgKey.types.test.ts |
| K2 (slice 2): the patched engine routes by `_tag` at run time: for generated Msg sequences of a small tagged machine with one Cmd and one timer Sub, the Effect engine's `run` and tea's `foldMsgs` reach the model a plain reduce over the handlers reaches; the Cmd runs through its interpreter by its `_tag` and its answer comes back; the timer Sub starts and fires; tea's own `arbMsg` draws carry `_tag`; a raw `{ type: "inc" }` is refused as a Msg with no cell | test | @demlik/tea/pbt.arbMsgSequence: the small machine, 100 runs | (a) leave `chunk-SKI5V64W.js:284` on `record[msg.type]`: every Msg misses its cell; (b) leave `chunk-BXLD374W.js:292` on `cmd.type`: the Cmd finds no interpreter; (c) leave `chunk-BXLD374W.js:217` on `sub.type`: the timer never starts; (d) leave `pbt/index.js:41, 45` writing `type`: the draws have no `_tag`. Each turns K2 red | next/packages/libfabrika/src/runtime/MsgKey.test.ts |
| K2b (slice 2): the state table keys on `_tag`: for generated sequences, a small machine written with `Transitions` over a `TaggedUnion` Model folds like the same machine written as a reducer | test | @demlik/tea/pbt.arbMsgSequence: the small state machine, 100 runs | leave `chunk-SKI5V64W.js:266, 293` on `state.type`: no row is found, K2b red | next/packages/libfabrika/src/runtime/MsgKey.test.ts |
| K3 (slice 2): an answer made by tea's own Cmd def (`def.ok(cmd, value, at)`, `def.err(cmd, error, at)`) for a generated input, value and error is keyed `_tag`, its `cmd` is keyed `_tag`, and Program's saved-letter check accepts it; the same answer with either key still `type` is refused | test | fc.record: Cmd input, value and error, 100 runs | (a) leave the patch's `mint` and `defineCmd` hunks (`chunk-SKI5V64W.js:179-218`) on `type`: K3 red; (b) leave `chunk-SKI5V64W.js:212`'s Cmd build on `type`: the inner `cmd` is wrong, K3 red; (c) Program's `settled` reading a key as `type`: K3 red | next/packages/libfabrika/src/runtime/Program.test.ts |
| K7 (slice 2): every Msg, Cmd and Sub in `next/` and tooling is keyed `_tag`: each `Machine.make`, `defineMachine`, `Program.make` and Cmd def compiles against the patched types. The compiler is the law | type | type | leave one Msg schema at `type: Schema.Literal(...)`, or one Sub entry at `type: "timer"`: `pnpm typecheck` fails on its machine | pnpm typecheck |
| K8 (every slice from 2): no hand-written `_tag` is added outside an inline ignore with its reason: `fabrika/no-hand-tag` holds product code in `next/` and `.agents/` (on today); in test files, where 0562's cleanup has not turned it on yet, the review runs `git diff origin/main -U0 -- next .agents` and reads every added line with a `_tag` key | lint | lint | a test that writes `{ _tag: "inc" }` by hand: the diff check shows it | .oxlintrc.json |
| K9 (every slice from 2): every program's existing laws stay green, drawing `_tag` Msgs through tea's `pbt` | test | @demlik/tea/pbt.arbMsgSequence: each program's own machine, each file's own runs | K2's plant (a) turns these red too | next/programs/counter/src/program.laws.test.ts |
| A1 (slice 3): `applyCell`, `applyCellChecked`, `foldMsgs`, `tryApplyCell` and `tryFoldMsgs` called with a machine infer its State, Msg and Cmd with no type written; a Msg the machine has no handler for, and a state of another machine, are compile errors, and the error names the Msg; the loose `{ update }` form still compiles | type | type | drop the slice's `.d.ts` hunks: `cmds` widens to `Cmd`, and the `@ts-expect-error` on a wrong Msg is unused, A1 red | next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts |
| B1 (slice 4): a def from `Cmd.make` exposes `schema.input` and `schema.ok` as the Effect schemas it was given, and `AnyCmdDef` keeps `input`; decoding a generated Cmd value with `def.schema.input` agrees with `Program`'s check of that Cmd | test | Effect Arbitrary: SampleCmdInput | (a) drop the slice's `.d.ts` hunks: the test does not compile; (b) a `Program.ts` that skips the input check: a bad Cmd passes, B1 red | next/packages/libfabrika/src/runtime/Program.test.ts |
| B2 (slice 4): the same, as types: `def.schema.input` is `Schema.Codec<Input>`; a def made on core from another Standard Schema does not claim one | type | type | drop the hunks: B2 red | next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts |
| C1 (slice 5): `def.settled` decodes exactly what `def.ok` and `def.err` make: for generated input, value and error, the minted answer decodes and re-encodes to itself; an answer with an error tag the def never declared, or a `cmd` of another def, is refused; `malformed_result` is accepted on every def | test | Effect Arbitrary: SampleCmdInput | (a) a `settled` with no `malformed_result`: tea's own error fails to decode, C1 red; (b) a `settled` whose `cmd` is the bare input with no `_tag`: C1 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| C2 (slice 5): the pipeline's, the queue's and the brain life's machines decode every answer their runner saves, with `settled` in place of the deleted helpers: their existing laws stay green | test | @demlik/tea/pbt.arbMsgSequence: each machine, each file's own runs | delete one Cmd's `settled` from Merger's `Msg`: its answers no longer decode, the laws red | next/programs/pipeline/src/Merger.test.ts |
| F1 (slice 6): a machine whose `update` is one function folds like the same machine written as a table, for generated sequences; `msgKeysOf`, `acceptedTypes`, `describeMachine` and `NoCellError` give the same names in both forms, read from the `msg` schema and the defs | test | @demlik/tea/pbt.arbMsgSequence: a small machine in both forms, 100 runs | (a) `msgKeysOf` that reads only the table: it answers `[]` for the function form, F1 red; (b) names from `msg` only, without each def's `_ok` and `_err`: F1 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| F2 (slice 6): `Program.make` over a function-form machine keeps refusing a settled Msg sent from outside and an unknown Msg, as it does for the table form (`Program.ts:686` reads `msgKeysOf`) | test | Effect Arbitrary: CounterMsg | `msgKeysOf` returning `[]` for a function: every input refused, F2 red | next/packages/libfabrika/src/runtime/Program.test.ts |
| F3 (slice 6): `update` typed as a function must return a cell for every Msg; a table and a function in one field is a compile error | type | type | drop the slice's type hunk: the function form does not compile, F3 red | next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts |
| W1 (slice 7): a parent that wraps a child's Cmds with `Cmd.within` gets each answer back wrapped, outermost name first, at every depth up to 3, on the Effect engine and through our runner; the wrapped parent folds like the same parent written with today's mark-and-route cells | test | @demlik/tea/pbt.arbMsgSequence: the two-search-box parent from issue 953, nested to depth 3, 100 runs | (a) a settle step that ignores `within`: the answer comes back flat, W1 red; (b) a wrap in the engine only, not in `def.ok`: our runner's answers come back flat, W1 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| W2 (slice 7): a wrapped Cmd survives save and replay: a checkpoint that holds owed wrapped Cmds restarts and their answers still arrive wrapped; a replayed trace of a wrapped run reaches the same states | test | @demlik/tea/pbt.arbMsgSequence: the same parent, a cut at every Msg, 50 runs | a checkpoint that drops a Cmd's unknown fields when it saves it: `within` is lost, W2 red | next/packages/libfabrika/src/runtime/RunnerWithin.integration.test.ts |
| W3 (slice 7): the window and the hands client keep every handshake law with the forwarding cells gone | test | @demlik/tea/pbt.arbMsgSequence: each machine, each file's own runs | route one wrapped answer to the wrong child: the handshake laws red | next/packages/libfabrika/src/client/WindowMachine.laws.test.ts |

**Lint, type or test?** K1, K7, A1, B2 and F3 are types: only the compiler sees a missing handler, a
wrong key or an inferred type. K8 is lint. The rest are tests, since they are about what runs: tea's
lookup, a fold, a wrap. No lint rule can tell a semantic event's `type` from the
rest, so the review checks the readers table line by line.

**New names in tests:** `SampleCmdInput` is a small input schema for a Cmd made with `Cmd.make`, defined in the test.
`CounterMsg` is the counter's Msg union, restated in the test and pinned to the schema's type, as
[0135](../../../.decisions/0135-a-laws-file-pins-its-shapes-to-the-schema.md) allows, since
`runtime/` may not import a program. `TeaAsks.test.ts` and `TeaAsks.types.test.ts` hold the laws of
slices 3 to 7, one `describe` per issue.

**No law for the wipe.** The wipe is a landing step on real homes, not code, so no law tests it; the
owner ruled out conversion code, and every law that tested it went with it. The re-recorded fixture
home keeps the port-home laws honest: they read a home of the new shape.

**Host-only and scheduled laws.** None needs launchd, the real app, a signal or a real socket. W2 is
an integration test, since it needs the runner on a real SQLite file; under
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) a pull request leaves
it to the 3-hour schedule, and it is not run on this laptop. Slice 2 also edits about 43
`*.integration.test.ts` files and the law suites they run (`RunnerTest.ts`, `ChildrenTest.ts` and the
rest). The lead runs `scheduled.yaml` once on the branches of slices 2 and 7 (`workflow_dispatch`)
before each merge (see "Calls taken").

## Files

### Slice 1: tea 0.27.0, and today's version on its own catalog

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| pnpm-workspace.yaml | tests | 8 | the default catalog at 0.27.0, the `catalogs.old` block with its comment, the 0.25.0 patch row goes, `minimumReleaseAgeExclude` names 0.27.0 |
| pnpm-lock.yaml | tests | generated | `pnpm install` in the step's box |
| patches/@demlik__tea@0.25.0.patch | tests | 0 | deleted with `git rm`: 0.27.0 ships demlik 897 |
| oxlint-plugins/exact-versions.ts | tests | 4 | accept `catalog:<name>`; its header comment says so |
| oxlint-plugins/exact-versions.test.ts | tests | tests | E1 |
| package.json | tests | 0 | no change: the root (tooling) stays on the default catalog |
| programs/tracker/package.json | tests | 1 | `catalog:old`; this file is an exam path (the shared ask view), so the tests step edits it |
| packages/fabrika/package.json | build | 2 | `catalog:old`, twice |
| packages/pipeline/package.json | build | 2 | `catalog:old`, twice |
| apps/fabrika/package.json | build | 1 | `catalog:old` |
| programs/counter/package.json | build | 1 | `catalog:old` |
| programs/map/package.json | build | 1 | `catalog:old` |
| programs/markdown/package.json | build | 1 | `catalog:old` |
| programs/ticket/package.json | build | 1 | `catalog:old` |
| programs/trace/package.json | build | 1 | `catalog:old` |
| docs/tutorials/agents/package.json | build | 1 | `catalog:old` |
| docs/tutorials/two-hosts/package.json | build | 1 | `catalog:old` |
| .decisions/0256-a-program-is-one-program-make.md | build | docs | lines 52-53: tea 0.26.0 shipped 897, no patch is needed |
| docs/direction/pin-exact-versions.md | build | docs | one line: a named catalog's pointer is exact as well |

### Slice 2: the `_tag` patch, and all of our side

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| patches/@demlik__tea@0.27.0.patch patches/ | tests | 700 | new: every Msg, Cmd, Sub and state spot in "What the patch changes" |
| pnpm-workspace.yaml | tests | 3 | the `@demlik/tea@0.27.0` row and its comment naming 949 |
| pnpm-lock.yaml | tests | generated | the patch's hash, from `pnpm patch-commit` in the step's box |
| next/apps/fabrika/src/port-home.test-support.ts | tests | 0 | no change: its writer records the fixture home again |
| fixtures/next/port-home fixtures/next/port-home/ | tests | tests | the fixture home recorded again from a run on the patched build, with `port-home.test-support.ts`'s writer |
| next/packages/libfabrika/src/runtime/MsgKey.types.test.ts | tests | tests | K1, new |
| next/packages/libfabrika/src/runtime/MsgKey.test.ts | tests | tests | K2, K2b, new |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | K3; its own Msgs by maker |
| next/programs/counter/src/program.laws.test.ts | tests | tests | K9; its Msgs by maker |
| next/**/*.test.ts | tests | tests | every Msg by its schema's maker, every expected Msg, Cmd and Sub keyed `_tag`: about 870 hand values and 81 schema lines in about 130 files; raw wire frames keep the inline ignore |
| next/**/*.test.tsx | tests | tests | the same |
| next/**/*Test.ts | tests | tests | the shared suites (`RunnerTest.ts`, `ChildrenTest.ts`, `ProgramMailTest.ts` and the rest), the same |
| next/**/*.test-support.ts | tests | tests | the same |
| .agents/skills/lead/scripts/chain.test.ts | tests | tests | Msgs by maker |
| .agents/skills/lead/scripts/drive.test.ts | tests | tests | Msgs by maker, the Sub's key |
| .oxlintrc.json | tests | 0 | no change: K8 uses `fabrika/no-hand-tag` as it is set today |
| oxlint-plugins/no-hand-tag.ts | tests | 0 | no change: its `Log.ts` reason is the one the inline ignores give |
| .agents/skills/lead/scripts/flow/machine.test.ts | build | tests | only if it reads an answer's key; outside the exam globs |
| next/packages/libfabrika/src/runtime/Program.ts | build | 25 | `Typed` on `_tag`; `Types.Tags` for inputs |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 35 | the key reads; the `Down` conversion goes; answers from tea's `ok` and `err` |
| next/packages/libfabrika/src/runtime/Execution.ts | build | 3 | the key read |
| next/packages/libfabrika/src/runtime/Audit.ts | build | 2 | `Minimal` on `_tag` |
| next/packages/libfabrika/src/runtime/Window.ts | build | 4 | `commandMsg` on `_tag` |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 2 | the audit default |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | 35 | its Msgs, Cmds and Sub entries, `Types.Tags`, `Types.ExtractTag`, matchers |
| next/packages/libfabrika/src/client/HandsMachine.ts | build | 15 | the same |
| next/packages/libfabrika/src/desktop/BrainLife.ts | build | 10 | its Msgs and `reply` |
| next/packages/libfabrika/src/**/*.ts | build | 260 | the other product files of libfabrika (about 50): schemas to `TaggedUnion`, makers, matchers, Cmd and Sub keys |
| next/packages/tuval/src/**/*.ts | build | 7 | the one file with Msgs |
| next/apps/fabrika/src/**/*.ts | build | 3 | its two product files |
| next/programs/counter/src/program.ts | build | 6 | the counter's Msg |
| next/programs/pipeline/src/Merger.ts | build | 20 | `answers`, its Msgs, matchers |
| next/programs/pipeline/src/Queue.ts | build | 10 | the same |
| next/programs/**/*.ts | build | 40 | the other programs' product files (checklist, tezgah, inbox, chaos) |
| .agents/skills/lead/scripts/chain.ts | build | 6 | its Msg as a `TaggedStruct`, sent by maker |
| .agents/skills/lead/scripts/drive.ts | build | 14 | its Msgs as a `TaggedUnion`, sent by maker; the Sub's key |
| .agents/skills/lead/scripts/flow/machine.ts | build | 2 | only if a handler reads an answer's key |
| .patterns/effect-tagged-value-is-matched.md | build | docs | a tea Msg is matched by its own union; the `type` lines and `Match.discriminators("type")` go |
| .glossary/TERMS.md | build | docs | the `_tag`, `input port` and `Msg` rows: tea's Msgs, Cmds and Subs are keyed `_tag` |
| docs/direction/program-shape.md | build | docs | line 118: a Msg's `_tag` and an input's key |
| docs/direction/shared-tiles.md | build | docs | line 66's example |
| docs/direction/schema-classes-not-of-helpers.md | build | docs | line 45: 0569 and its amendment |
| docs/direction/code-commits-and-signs-each-step.md | build | docs | line 24's comment |
| .agents/skills/write-pattern/references/diagrams.md | build | docs | line 36: a transition label is the Msg's `_tag` |
| docs/plan/tier-1.md | build | docs | line 717: tea's Msgs, Cmds and Subs are `_tag` |
| docs/plan/README.md | build | docs | the where-we-are row for the patch and its issues |

`next/**/*.test.ts` and its siblings are globs: the tests step changes the files they match that hold
a Msg, Cmd or Sub (`rg` over `next` and `.agents` finds 234 files with a Msg spot, product and tests).
The build step owns product files only.

### Slices 3 to 7: one tea ask each

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts | tests | tests | new in slice 3: A1; then B2 (slice 4), F3 (slice 6) |
| next/packages/libfabrika/src/runtime/TeaAsks.test.ts | tests | tests | new in slice 5: C1; then F1 (slice 6), W1 (slice 7) |
| next/packages/libfabrika/src/runtime/RunnerWithin.integration.test.ts | tests | tests | new in slice 7: W2 |
| next/programs/pipeline/src/Merger.test.ts | tests | tests | C2 (slice 5), if the file holds Merger's laws; otherwise the laws file that does |
| next/packages/libfabrika/src/client/WindowMachine.laws.test.ts | tests | tests | W3 (slice 7) |
| next/**/*.test.ts | tests | tests | each slice: the tests whose code it changes (hand types, helper calls, forwarding Msgs) |
| patches/@demlik__tea@0.27.0.patch | tests | 40 | slice 3: the five signatures (types) |
| patches/@demlik__tea@0.27.0.patch | tests | 30 | slice 4: `CmdDef`, `AnyCmdDef`, the Effect `Cmd.make` type |
| patches/@demlik__tea@0.27.0.patch | tests | 60 | slice 5: `settled` in `effect/index.js` `Cmd.make` and its type |
| patches/@demlik__tea@0.27.0.patch | tests | 80 | slice 6: `UpdateForm`, the lookup, `msgKeysOf`, `acceptedTypes`, `describeMachine`, `NoCellError`, the Effect `make` spec |
| patches/@demlik__tea@0.27.0.patch | tests | 150 | slice 7: `Cmd.within`, `CmdInput`, `def.ok` and `def.err`, `mint`, both engines' settle, pbt and testing helpers |
| pnpm-workspace.yaml | tests | 1 | each slice: its issue's line in the row's comment |
| pnpm-lock.yaml | tests | generated | each slice: the patch's hash |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 5 | slice 3: its hand-typed `applyCell` goes |
| next/packages/libfabrika/src/**/*.ts | build | 30 | slice 3: the other hand-typed calls and the `ReturnType<...>` helpers |
| next/packages/libfabrika/src/runtime/Program.ts | build | 15 | slice 4: the dig-out at `:740-741`, `accepts` and `isDeclared` go; slice 6: none needed for `:686` |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 10 | slice 4: the take-apart at `:279`, `:302` goes |
| next/programs/pipeline/src/Merger.ts | build | 45 | slice 5: `answers` goes; slice 6: the 13 rows go, `update: reduce` |
| next/programs/pipeline/src/Queue.ts | build | 30 | slice 5: `answers` goes; slice 6: the 8 rows go |
| next/packages/libfabrika/src/desktop/BrainLife.ts | build | 25 | slice 5: `responses` and the hand `malformed_result` go |
| next/packages/libfabrika/src/desktop/BrainServiceManaged.ts | build | 4 | slice 5: mints through `def.ok` and `def.err`, no cast |
| next/packages/libfabrika/src/runtime/ChaosMachine.ts | build | 12 | slice 5: its 6 hand structs go |
| next/packages/libfabrika/src/client/HandsMachine.ts | build | 25 | slice 6: the 11 rows go; slice 7: the forwarding cells and the Cmd filter go |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | 45 | slice 6: the cast and its 11 rows go; slice 7: the forwarding cells and 4 Cmd maps go |
| docs/plan/README.md | build | docs | each slice: its row |

## Calls taken

- **One pull request holds the `_tag` patch and all of our side (slice 2).** 95% sure. A value cannot
  carry both keys without our code writing `type` beside `_tag`, a conversion 0569 forbids; tea
  reading both keys is a conversion inside tea that the maintainer is not making. Any split leaves
  main red between the parts. No number caps a pull request
  ([0099](../../../.decisions/0099-no-number-caps-a-pull-request.md)).
- **Each later ask is its own pull request, in the order above.** 85% sure; the order table gives
  each reason.
- **The patch is the tests step's.** The patches folder, `pnpm-workspace.yaml` and `pnpm-lock.yaml`
  are exam paths in the repo's exam list, so each slice's tests step writes its hunks, and its laws
  are red until the build lands. That matches the patch note's order: tests first, then the call
  sites.
- **Our runner takes tea's own answer makers (slice 2).** `Runner.ts:1584-1602` mints
  `{ type: "<cmd>_ok" }` in tea's shape today. tea's `CmdDef` has `ok(cmd, value, at)` and
  `err(cmd, error, at)` (`core-CDR1i78K.d.ts:172-173`), and tea's decision 0021 says the engine makes
  these Msgs. The runner builds its answer with them and adds its `reason` field to the error. Then
  our answers move with tea's, and slice 7's wrap reaches them for free. 70% sure the runner holds the
  def there. If it holds only the Cmd value, it finds the def by the Cmd's `_tag` in the program's
  `cmds`, which `Program.ts:685` already reads.
- **Old homes are wiped by a landing step, by name, never by folder.** The owner's ruling sets the
  wipe; the list of entries is mine, read from `dev.ts`, `local-dev.ts` and `dev-recording.ts`. 80%
  sure it is every `next/` entry of a home. The doubt: a file another `next/` piece writes that I did
  not find. The step lists the home before and after, and the lead reads both.
- **`fabrika.toml` survives the wipe,** since it holds a person's settings and no tea value. 85%.
- **Sub entries take the inline ignore.** tea gives a built-in `timer` Sub no maker, and a Sub entry
  holds a function (`deps`), which no Effect schema makes. Asking tea for one is not on the owner's
  list, so it is noted under "What comes after". 75% sure.
- **`subIdOf`'s hash input stays `{ type, deps }`.** It is internal to tea; renaming it would change
  every Sub id and gain nothing. 75% sure the maintainer agrees; if tea's release renames it, the bump
  takes it.
- **No `_tag` by hand, tests included.** 0562 holds the principle for tests before its lint turns on
  there. So slice 2's tests step writes about 870 values with makers rather than the cheaper
  `{ _tag: "inc" }`, and K8 checks the diff.
- **The lead runs the scheduled workflow once on slices 2 and 7.** 80% sure. Both change what the
  integration tests exercise, and 0536 leaves those to the schedule. A break found after the merge
  would leave main red for up to 3 hours. One extra CI run each is the cost.
- **Is this a setting?** No new choice here is one
  ([0069](../../../.decisions/0069-choices-are-settings.md)). The key and the five asks are tea's
  contract, not values a person flips. The catalog versions are pins, and pins live in the workspace
  file. The wipe is a one-time landing step, not a choice a person makes again.

## Order, and what each slice clashes with

- **0569's amendment** ([pull request 1384](https://github.com/kamp-us/tea-fabrika/pull/1384)) widens
  0569 to Cmds, Subs and the state table. Slice 2 merges after it. It also amends
  [0214](../../../.decisions/0214-unions-are-tagged-with-tag.md) and
  [0567](../../../.decisions/0567-a-tagged-value-is-matched.md)'s form 2 for a tea Msg.
- **Slice 1 does not wait:** it touches none of the open branches' code.
- **Slice 2 waits for** pull requests [1341](https://github.com/kamp-us/tea-fabrika/pull/1341),
  [1331](https://github.com/kamp-us/tea-fabrika/pull/1331) and
  [1366](https://github.com/kamp-us/tea-fabrika/pull/1366) to merge, and is built on main after them
  and after slice 1.
- **Slice 2 goes before the Effect-check sweep in busy folders**
  ([0565](../../../.decisions/0565-effects-own-checks-block.md)): a sweep pull request in `runtime/`,
  `processes/` or `client/` starts after slice 2 merges. Slices 3 to 7 are smaller and may run beside
  the sweep; each rebases onto what merged.
- **Slices 3 to 7** each start from main after the slice before merges, since each adds hunks to the
  same patch file.

Clashes, from `gh pr view <n> --json files` against the 234 files that hold a Msg spot:

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

Slices 3 to 7 touch few files each (the files tables above): `Program.ts`, `Runner.ts`,
`WindowMachine.ts`, `HandsMachine.ts`, `Merger.ts`, `Queue.ts`, `BrainLife.ts`. Any open branch on
those rebases. A branch that adds a `type`-keyed Msg after slice 2 merges fails `pnpm typecheck` on
rebase (K7), so a stale branch breaks loudly, never quietly.

## Each issue carries its patch

A named step of slices 2 to 7, after the build is green and before the merge
([0060](../../../.decisions/0060-upstream-issue-carries-the-patch.md)): the slice's tests step saves
only that slice's hunks under `runs/`. The lead reads every line and appends them to that issue's
body, inside `<details><summary>The patch we apply locally</summary>`, a fenced `diff` block, then
`</details>`. Slice 2 posts on 949, slice 3 on 950, slice 4 on 951, slice 5 on 952, slice 6 on 954,
slice 7 on 953. If a fix round changes a slice's hunks, the lead edits that section too. A later
slice that edits lines an earlier slice wrote (slice 7 changes `def.ok`, which slice 2 moved to
`_tag`) posts its own hunk against the file as it stands after the earlier slices, and says so.

## Validation

- Slice 1 tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/exact-versions.test.ts`,
  E1 red before `exact-versions.ts` changes; then `pnpm lint` (which runs `lint:versions`).
- Slice 1 build step: `pnpm lint`; the narrow paths `packages/pipeline/src/machine-make.test.ts`,
  `next/packages/libfabrika/src/runtime/Program.test.ts`, and one test file of each of today's
  programs.
- Slices 2 to 7, tests step: the slice's laws red on main plus its hunks, before the build; each
  planted fault seen red once.
- Slices 2 to 7, build step: the slice's laws and K9 green, the narrow paths of each folder it
  changed, `pnpm lint`.
- Every slice changes the lockfile, so `--changed origin/main` is the full suite and is not run
  locally: the narrow paths stand in for it, and CI runs the rest. The lead runs one `pnpm typecheck`
  and reads CI.
- The lockfile is written by `pnpm install` (slice 1) and `pnpm patch-commit` (slices 2 to 7) inside
  the step's box, the one install each slice needs. Nothing is installed on the laptop outside a box,
  and no `.integration.` or `.visual.` file is run on it.

## Records

- Each step's run is a row in `field/runs/`, the same day, as every hand-run step's is.
- The facts at stake are in the next section.

## What fact is lost if it is not recorded now

- **The rows in old dev and test homes are lost on purpose,** by the owner's ruling: `next/` holds no
  real data. Nothing else is lost, and this plan writes no new fact.
- **Which homes were wiped, and when,** is a fact only the landing knows. The lead records it in the
  slice 2 run row in `field/runs/`, the same day.

## Size

1. Slice 1, tea 0.27.0 and today's catalog: 30 lines (11 package.json files, the catalog block, 4
   lines in `exact-versions.ts`, two docs lines), plus E1, the deleted patch and the lockfile.
2. Slice 2, the `_tag` switch, which holds the first patch: 1,250 lines (the patch, about 700 diff
   lines; our product code, about 550 lines in about 80 files), plus about 950 spots in about 160
   test files, four new laws, the re-recorded fixture home, the landing wipe and about 10 docs lines.
3. Slice 3, demlik 950, typed `applyCell`: 75 lines (40 patch, 35 ours, mostly deleted).
4. Slice 4, demlik 951, a Cmd's Effect schemas typed: 55 lines (30 patch, 25 ours, mostly deleted).
5. Slice 5, demlik 952, `settled`: 175 lines (60 patch, about 115 of ours deleted or rewritten).
6. Slice 6, demlik 954, `update` as one function: 150 lines (80 patch, about 70 of ours, mostly
   deleted rows).
7. Slice 7, demlik 953, `Cmd.within`: 220 lines (150 patch, about 70 of ours, mostly deleted cells).

About 24 agent hours across the seven slices, 60% sure. The doubts: slice 2's tests step, about 870
hand values rewritten with makers in about 130 test files, may take two sessions, and its build two
more; and slice 7 changes tea's settle step in both engines, the riskiest hand edit in hashed chunks.
K2 and W1 are what catch a missed spot.

Budget basis: `field/runs/` list prices for the largest steps so far: $28 for the p18 slice 1 build
(`2026-11-13-p18s1-build.json`), $14.5 and $11.8 for its two tests steps, $5 to $6 per review.
Slice 1 is 3 steps at about $10. Slice 2 is two tests steps, two build steps, one review and one fix
round, about $130. Slices 3 and 4 are 3 steps each at about $12. Slices 5 and 6 are 3 steps each at
about $18. Slice 7 is 4 steps (tests, build, review, one fix round) at about $45.

Estimate: 26 steps, $265

## Open questions

None.

## What comes after

Each is its own pull request or waits on its own ruling. None is in this plan's slices.

- **Merger's `reduce` split into one handler per Msg under `Msg.match`** (0567), which slice 6 makes
  possible. Its own pull request after slice 6, with Merger's laws as they are.
- **Machines that compare a state's `_tag` by hand could move to `Transitions`,** which slice 2 keys
  on `_tag`. The research counted 22 of 35 machine files that do. A design call per machine, later.
- **Semantic events** (`E extends { type: string }`) keep `type`; not part of this change.
- **A maker for a Sub entry,** so a `timer` Sub is not written with an inline ignore. Not asked of tea
  today.
- **The bump that takes tea's release** with these six changes deletes the patch file and rewrites
  our call sites to match what tea ships. Today's version leaves `catalog:old` when it is deleted.

## What this plan cannot tell us

- **The patch's spot list** comes from reading every `.type`, `type:` and `{ type` in 0.27.0's shipped
  `.js` and sorting each into Msg, Cmd, Sub, state or one of tea's own internal unions. About 90% sure
  none is missed; the agent chunk was read only at its matched lines, and a key read through a
  destructure under another name would hide from the search. K2 covers what we use; nothing here
  runs the agent, flow or Jev add-ons.
- **The type counts** (119 Msg, 5 state, 22 event constraints) are a search on the parameter name; a
  generic named otherwise would be missed.
- **Our counts** were recounted on `origin/main` with the research's searches, and match it. About
  80% of the hand literals are Msgs, from a 26-line sample; the rest are Cmds, Sub entries and shapes
  that are not tea's, which the builder leaves alone.
- **Every `next/` entry of a home:** I read the writers I could find (`dev.ts`, `local-dev.ts`,
  `dev-recording.ts`) and one committed fixture home. A file some other piece writes there could be
  missed; the landing step's before-and-after listing is how the lead would see it.
- **Whether a `next/` stage is deployed on Cloudflare:** I did not check any account. The lead does,
  at the landing.
- **Slices 3 to 7's tea shapes** are my sketches of what each issue asks; each issue leaves its shape
  to the maintainer. Where tea's release differs, the bump rewrites our call sites.
- **Whether the runner holds each Cmd's def** where it mints answers: 70%, as "Calls taken" says.

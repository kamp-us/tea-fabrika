Approved by the lead agent, builds 0569, 0572, 0578, 0054, 0214, 0226; body 9741cd80ec65
Plancheck-Version: 3

# Plan: tea moves to 0.27.0, then one local patch keys tea's Msgs, Cmds, Subs and state table on `_tag` and carries eleven more asks, and every machine of ours follows

This is `next/` and our tooling (`.agents/`). Today's version is left as it runs now. It builds
[0569](../../../.decisions/0569-tea-msgs-are-keyed-on-tag.md) (owner, 2026-11-15) and its amendment
for Cmds, Subs and the state table
([pull request 1384](https://github.com/kamp-us/tea-fabrika/pull/1384)). It counts as a fix of that
day's sev0. Everything we ask tea for is patched here and not waited on: one patch file,
`patches/@demlik__tea@0.27.0.patch`, carries twelve asks on `kamp-us/demlik`, and each lands through the
steps in its own pull request, except 956 and 958, which share one. Twelve pull requests in all.

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

// After slices 3 to 12, the asks our code proved, each deleting the workaround it replaces:
applyCell(child, s.child, m);                 // 950: types from the machine, a wrong Msg fails to compile
def.schema.input;                             // 951: the Cmd's own Effect schema, typed
Schema.Union([Land, change.settled]);         // 952: tea builds a Cmd's `_ok | _err` schema
update: before(dropStale, { land, timer });   // 954: one check before every cell, still a table
[s, Cmd.within("handshake", cmds)];           // 953: Elm's Cmd.map, kept as data
types: Machine.types<{ ctx: Ctx; sub: Sub }>(); // 960: no `{} as X` cast
...Cmd.cells(config.cmd, settle, settle);       // 959: typed cells for a Cmd known at run time
init: { count: 0 },                             // 956: the first model; `cmds` may be left out
Schema.declare(Machine.is, { ... });            // 958: no copy of tea's machine shape
syncTest(machine, {}, { msgs, seed });          // 955: save and restart at every Msg, from tea
```

## The slices, in order

| # | Pull request | Tea issue | Why here |
|---|---|---|---|
| 1 | tea 0.25.0 to 0.27.0; today's version on its own catalog at 0.25.0, unpatched | 897, already shipped | the patch is written against 0.27.0, and the bump deletes the 0.25.0 patch (0569) |
| 2 | the `_tag` patch: Msg, Cmd and the `cmd` a settled Msg carries, Sub, the state table; all of our side; old dev and test homes wiped at landing | [949](https://github.com/kamp-us/demlik/issues/949) | every later ask is written in `_tag` terms, and the issues say so ("With #949, `type` here becomes `_tag`") |
| 3 | `applyCell` and its siblings take their types from the machine | [950](https://github.com/kamp-us/demlik/issues/950) | types only, the smallest; slice 12 steps children with the typed `applyCell` |
| 4 | a Cmd from `Cmd.make` keeps its Effect schemas in its type; the any-def keeps `input` | [951](https://github.com/kamp-us/demlik/issues/951) | types only; slice 5 builds `settled` from these typed schemas |
| 5 | a Cmd def carries `settled`, the schema of its `_ok \| _err` Msgs | [952](https://github.com/kamp-us/demlik/issues/952) | needs slice 4; slice 6's `dropStale` reads the answers' `cmd`, typed by the union slice 5 makes |
| 6 | tea ships `before(check, table)`: one check before every cell of an update table; Merger and Queue use it, and their `reduce` splits into one handler per Msg | [954](https://github.com/kamp-us/demlik/issues/954) | **on hold** (see below); nothing else waits on it |
| 7 | `Machine.types<{ ctx; sub }>()` names a machine's ctx and Sub types with no cast | [960](https://github.com/kamp-us/demlik/issues/960) | types only and tiny; nothing depends on it, so it goes where it costs least: after the pipeline work, before the slices that change machine fields |
| 8 | `Cmd.cells(def, onOk, onErr)`: typed cells for a Cmd whose answer names are known only at run time | [959](https://github.com/kamp-us/demlik/issues/959) | additive and small; it reads a def's answer types, which slices 4 and 5 made exact |
| 9 | `init` may be the first model itself, `cmds` defaults to `[]`; tea exports `AnyMachine` and `Machine.is` | [956](https://github.com/kamp-us/demlik/issues/956), [958](https://github.com/kamp-us/demlik/issues/958) | one slice, two issues: our copy of tea's machine shape (`Program.ts`'s `isSteps`) refuses an object `init`, and 958's `Machine.is` is what replaces that copy, so neither lands green alone |
| 10 | `syncTest` in `@demlik/tea/pbt`: save and restart at every Msg, and the run must match the unbroken one | [955](https://github.com/kamp-us/demlik/issues/955) | after slice 9, so tea's `syncTest` is written once against both forms of `init` and boots object-`init` machines from day one |
| 11 | a cell may answer a pipeable `Step` (`Step.stay`, `Step.to(model)`, `Step.run(cmd)`) in place of the `[model, cmds]` tuple, on the Effect entry | [962](https://github.com/kamp-us/demlik/issues/962) | after 949, whose `_tag` state table the ruling builds on; before 953, so slice 12's new parent code writes its returns once, as `Step` |
| 12 | `Cmd.within`: a parent wraps its child's Cmds as data, and their answers come back wrapped; the window and hands machines take Elm's parent shape, one `link` Msg and one row | [953](https://github.com/kamp-us/demlik/issues/953) | the biggest change to tea's run time (the settle step, both engines, save and replay), so it goes last, on top of the typed `applyCell` (slice 3) it steps the child with |

No two must land together: each slice is whole, green on its own, and deletes its own workaround.
Slices 3 and 4 touch different tea files and different files of ours, so their order between
themselves is free; 3 goes first because it is smaller. The one pair that must land together is 956
and 958, as one slice (9). Slices 7 and 8 are free among themselves; 9 must come before 10; 11 must
come before 12. 953, the riskiest run-time change, stays last. 85% sure of this order.

**On hold: slice 6 (demlik 954, `before`).** The owner holds it until he rules. Tea's maintainer, on
954, says the root cause is that our runner steps machines by hand with `applyCell` (`Program.ts`,
`Runner.ts`), so tea's identity filter, which drops a stale answer before a cell runs on tea's
engine, never runs for us. Demlik issue 961 is that gap in the pure stepping functions. So no
`before` patch and no rewrite of Merger's or Queue's stale checks lands until the owner rules. Slice
6's text stays below, marked held. What depended on it, and what changes:

- **Its laws, G1 to G3,** are held with it. No other law reads `before`.
- **The order "6 before 12"** goes. Slice 12 never needed a file of slice 6, and nothing in slices 7
  to 12 waits on 6 now: they start from main after slice 5.
- **Merger and Queue** keep their `reduce` and their 21 forwarding rows until the ruling. No other
  slice here touches them.

**Step returns, once slice 11 is in.** The owner ruled that a cell answers a pipeable `Step` ([0578](../../../.decisions/0578-tea-cell-answers-a-step.md)). The sweep of today's return sites is not in this plan (see "What comes after"). Each
slice that writes a return says which form it writes, so no return is written twice:

- slices 2 to 10 write no new return shape: they move keys, types and helpers, and every return they
  touch stays today's tuple, for the sweep to rewrite once;
- slice 8's `onOk` and `onErr` are the existing `settle` handler, unchanged;
- slice 9's `init` is not a cell: its function form stays a tuple, and an object `init` writes no
  return at all;
- slice 12 lands after slice 11, so its new parent code (`stepLink`, the `link` row) writes `Step`
  from the start;
- held slice 6, if the owner releases it after slice 11, writes its split handlers as `Step`.

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
- The root's tooling imports both versions: the lead scripts import tea directly (`chain.ts`,
  `drive.ts`, `flow/machine.ts`, `flow/walk.ts`: 0.27.0) and today's agent runner from
  `@kampus/fabrika-old` (`agents.ts`, `boxfiles.ts`, `codexexec.ts` and their tests: `Agent`, the
  acp adapters, `rawOfLine`, which reach tea 0.25.0 through `catalog:old`). No tea value crosses
  between them, so the two copies never meet at run time. But Effect's checker refuses two versions
  of one package in one program (`duplicatePackage`, TS377051), and slice 1's build found law E2 red
  on it, in the `.agents` project only. Slice 1 allows `@demlik/tea` there and nowhere else (see
  "Slice 1").

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
  `Types.ExtractTag<E, K>` (`effect/dist/Types.d.ts:121`, `:196`, read in effect 4.1.2; main moved to 4.1.3 in
  [pull request 1375](https://github.com/kamp-us/tea-fabrika/pull/1375), so the tests step re-reads them) are the type forms of
  `M["type"]` and `Extract<M, { type: K }>`. Reading an old encoding into a new type is a schema
  transformation: `Schema.decodeTo` with `SchemaTransformation.transform` (`Schema.d.ts:4674`,
  `SchemaTransformation.d.ts:401`).
- **Elm:** a Msg is a custom type with no key; its constructors play the part of
  `Msg.cases.inc.make`. A parent holds its child's Msg inside one of its own
  (`Link LinkMsg`) and steps the child with one `case` branch, which is slice 12. A parent wraps its child's Cmds with `Cmd.map` and gets the child's answers back
  wrapped (https://guide.elm-lang.org/webapps/structure.html), which is slice 12, kept as data because
  a tea Cmd is saved and replayed. Old saved JSON is read with a decoder that accepts both shapes
  (`Json.Decode.oneOf`), an upcaster written as a decoder. From the Elm guide, not fetched.
- **Erlang/OTP:** a message's case is its tuple tag. A shape change goes with hot code upgrade:
  `code_change/3` converts saved state. From the OTP design principles, not fetched.
- **tea's maintainer, on issue 954:** a function form of `update` would make the missing-Msg check
  optional, since a TypeScript function accepts a silent `return [s, []]`, where Elm's compiler forces
  every case. So 954 was retitled: tea ships `before(check, table)`, which keeps the table and its
  compile check. The comment's code was compiled and run on tea main at `aab5d73a`.
- **Event sourcing, for saved rows:** the known way to keep an old log is **upcasting**. The log
  stays as written, and each old event is converted to the current shape as it is read. Greg Young, *Versioning in an Event
  Sourced System* (Leanpub, 2017), the chapter on upcasting; Axon Framework's reference guide, "Event
  Upcasting"; Marten's docs, "Events Versioning". None fetched. tea's own `schemaMigrate(schema,
  upcast)` does this for state. We take neither it nor a rewrite: `next/` holds no real data, and the
  owner ruled that old dev and test homes are wiped when the patch lands, with no conversion code: the
  wipe [0572](../../../.decisions/0572-pre-release-shape-change-wipes-data.md) sets.
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
- Our code needs one change for 0.27.0, and it is a setting, not code: Effect's checker is told
  that `@demlik/tea` may appear twice in the `.agents` project. Today's library keeps 0.25.0 under
  [0217](../../../.decisions/0217-next-grows-beside-today.md) until `next/` takes the job, the tooling
  still uses today's agent runner, and no tea value crosses between the two. It is a declared
  dependency choice, like
  [0574](../../../.decisions/0574-no-stability-tag-and-unstable-api-is-an-error.md)'s
  `allowedUnstableApis`, and not a list that lets broken code pass. It goes when the tooling stops
  importing `@kampus/fabrika-old` (ticket 1065). Everything else type-checks as it is:
  `Program.make` already reads the machine's `model` and `msg`, which 0.27.0 types the way the patch
  did (law E2).

```jsonc
// tsconfig.base.json, the Effect checker's `overrides` (a sketch). One more entry, scoped to the
// tooling. tsgo's schema calls this a "scoped allow-list for duplicatePackage".
{
  // The lead tooling imports tea 0.27.0 itself and today's agent runner, which runs on tea 0.25.0
  // (0217); no tea value crosses between them. Goes with ticket 1065.
  "include": [".agents/**/*.ts"],
  "options": { "allowedDuplicatedPackages": ["@demlik/tea"] }
}
```

- **Where the setting lives: an override in `tsconfig.base.json`, not `.agents/tsconfig.json`.**
  The lead asked for `.agents/tsconfig.json` only. TypeScript does not merge `compilerOptions.plugins`
  from an `extends`: a `plugins` key in `.agents/tsconfig.json` replaces the whole array, so the
  tooling would need its own copy of the checker's entry (about 100 lines of settings in
  `tsconfig.base.json:18-120`), which would drift. tsgo reads `allowedDuplicatedPackages` inside an
  `overrides` entry, scoped by `include` (its `schema.json`, "Scoped allow-list for
  duplicatePackage"), as the base file already scopes rules to `next/**`. So the scope is held by the
  entry's `include`, and law E3 holds that scope. 80% sure; if the override form turns out not to
  silence the check for a whole program, the fallback is the lead's form, with the plugin entry
  copied whole.

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
  # Slices 3 to 12 each add their line: #950, #951, #952, #954, #960, #959, #956 and #958, #955, #962, #953.
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

The owner ruled in [0572](../../../.decisions/0572-pre-release-shape-change-wipes-data.md) that our code holds no conversion for saved tea
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

## Slices 3 to 12: what tea gets, and what of ours goes

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

### Slice 6, demlik 954: `before(check, table)` (on hold)

**Held by the owner** until he rules on the maintainer's root cause (see "On hold: slice 6" above).
The text below stays as its plan, unchanged.

```ts
// tea's maintainer's code on issue 954, compiled and run on tea main; after slice 2 its bound is
// `{ _tag: string }`. The patch adds it beside `Reducer` (core-CDR1i78K.d.ts:340-346), with its
// run-time body in the core chunk (chunk-SKI5V64W.js) and an export from the root entry.
const before = <S, M extends { _tag: string }, C extends Cmd>(
  check: (s: S, m: M) => SyncReturn<S, C> | undefined,
  table: Reducer<S, M, C>,
): Reducer<S, M, C> => {
  const cells = table as unknown as Record<string, (s: S, m: M) => SyncReturn<S, C>>;
  const out: Record<string, (s: S, m: M) => SyncReturn<S, C>> = {};
  for (const [name, cell] of Object.entries(cells)) {
    out[name] = (s, m) => check(s, m) ?? cell(s, m);
  }
  return out as unknown as Reducer<S, M, C>;
};

// next/programs/pipeline/src/Merger.ts after, a sketch: one handler per Msg, the shared check first.
Machine.make({
  model, msg, cmds, init,
  update: before(dropStale, {
    land, abandon, timer,
    change_ok: changed, change_err: failed,
    merge_ok: merged, merge_err: failed,
    // ... every Msg once; a missing one still fails to compile, because this is still a table
  }),
});
```

- **The table stays,** so tea's compile check that every Msg has a cell holds, and `msgKeysOf`,
  `acceptedTypes`, `describeMachine` and `NoCellError` read the same names as before. The maintainer
  checked all four on tea main. `runtime/Program.ts:686`'s `msgKeysOf(machine)` keeps working with no
  change. The one cast lives inside `before`, written once in tea.
- **Ours goes:** `Merger.ts`'s 13 rows that point at `reduce` and `Queue.ts`'s 8 (counted on main).
  Their `reduce` functions (`Merger.ts:171-370`, about 200 lines; `Queue.ts:131-212`, about 80) split
  into one handler per Msg. The checks that open each `reduce` today become the `check`: Merger's
  stale-answer test (`Merger.ts:172-188`: a `send` answer is ignored; an answer to a Cmd that is not
  the current one counts as `late`) and Queue's `refuse(s, m)` (`Queue.ts:132-138`).
- **Each handler reads its own Msg** with no `m._tag ===` test, so 0567 holds without a matcher.
- **Not here:** the window and the hands client. Their forwarding rows are the forwarding kind, which
  `before` does not fit, and they get Elm's parent shape in slice 12.
- 954's comment did not run `before` with real `_ok` and `_err` answers; law G1 does, on Merger's
  own Cmds.

### Slice 7, demlik 960: `Machine.types<{ ctx; sub }>()`

```ts
// tea's sketch on issue 960. The patch adds it to `Machine` on the Effect entry (effect/index.d.ts
// and effect/index.js), the one cast written once in tea.
const types = <T extends { ctx?: unknown; sub?: Sub }>(): T => ({}) as T;
// Before, next/packages/libfabrika/src/client/WindowMachine.ts and 10 more places:
types: { ctx: {} as WindowCtx, sub: {} as SocketSub },
// After:
types: Machine.types<{ ctx: WindowCtx; sub: SocketSub }>(),
```

- Types only; nothing at run time changes, and the machine's types stay the same.
- **Ours goes:** the 11 `{} as X` casts in a `types:` field (`rg 'types: \{[^}]*\{\} as'` over `next` and
  `.agents`, counted on main).

### Slice 8, demlik 959: `Cmd.cells(def, onOk, onErr)`

```ts
// On `Cmd` in core (core-CDR1i78K.d.ts:383-470 holds its siblings), a sketch:
// returns { [def.okType]: onOk, [def.errType]: onErr }, each typed from the def's own answers.
Cmd.cells(def, onOk, onErr);
// next/packages/libfabrika/src/schedules/ScheduledJob.ts:94-104 after:
update: {
  timer: (s, m) => /* unchanged, today's tuple */,
  ...Cmd.cells(config.cmd, settle, settle),
},
```

- **Ours goes:** the table cast at `ScheduledJob.ts:96-103`
  (`} as Reducer<Model, typeof Timer.Type | Settled<C>, CmdOf<C>>`), its "computed command keys"
  comment, and the hand types on `timer` that the cast forced.
- `onOk` and `onErr` return today's tuple (see "On hold").

### Slice 9, demlik 956 and 958: `init` as a value, `cmds` optional, `AnyMachine` and `Machine.is`

```ts
// 956, on Machine.make (effect/index.d.ts:219-229, effect/index.js `make2` at :51) and core's
// defineMachine. `typeof init === "function"` tells the two forms apart; a model is saved data, so it
// is never a function.
Machine.make({ model: counterModel, msg: Msg, init: { count: 0 }, update: { ... } });
// means exactly: cmds: [], init: (loaded) => [loaded ?? { count: 0 }, []]

// 958, beside Machine in core: the erased type and its guard. `Machine.make` brands what it returns,
// so `is` is a real check, not a guess from field names.
type AnyMachine = /* the erased machine, as tea defines it */;
Machine.is(u); // u is AnyMachine

// next/packages/libfabrika/src/runtime/Program.ts after: the copy at :24-40 (Steps, isSteps,
// isObjectOrNull) goes.
machine: Schema.declare(Machine.is, { expected: "a tea machine" }),
```

- **`make` turns an object `init` into the function it means,** on the machine it returns. So every
  reader of `machine.init` still gets a function: tea's own loop (`chunk-BXLD374W.js:334-337`,
  `chunk-SKI5V64W.js:722`) and our 8 direct calls (`runtime/Execution.ts:259`,
  `runtime/WatchersSql.ts:30`, `:43`, `runtime/Runner.ts:978`, `:1858`, `client/WindowMachine.ts:1515`,
  `:1533`, and `Program.ts`'s `pure.init`). 75% sure the maintainer puts it there; it keeps the
  machine's shape one shape.
- **Why one slice:** `isSteps` checks a machine's fields by hand, and 958's `Machine.is` is what
  replaces it; landing 956 first would leave the copy to update by hand for one slice, and 958 alone
  has nothing new to check.
- **Ours goes:** `Steps`, `isSteps` and `isObjectOrNull` at `Program.ts:24-40`; the one-line
  `init: (loaded) => [loaded ?? X, []]` in the machines that write it (about 67 by the owner's count;
  my narrower search found 44 in 35 files), and the 71 `cmds: [],` lines (counted on main). A machine
  whose `init` starts Cmds, reads `ctx` or treats a loaded model differently keeps the function.

### Slice 10, demlik 955: `syncTest` in `@demlik/tea/pbt`

```ts
// next/packages/libfabrika/src/Testing.ts:18 today, our stopgap of about 80 lines; its own header
// says to remove it when tea ships the helper, as decision 0226 asks.
syncTest(controller, {}, { msgs, encode: Schema.encodeSync(Model), decode: Schema.decodeUnknownSync(Model),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b), seed: 119120 });
// After: from @demlik/tea/pbt. On the Effect entry the machine carries its `model` schema (897), so tea
// builds encode, decode and equality itself.
syncTest(controller, {}, { msgs, seed: 119120 });
```

- In the patch: a new export of `pbt/index.js` and `pbt/index.d.ts`, plus its Effect form. On a
  failure it names the seed, the cut and which check failed, as 955 asks.
- **Ours goes:** `syncTest` in `next/packages/libfabrika/src/Testing.ts` (and the file, if nothing
  else is left in it), and the 25 calls in 12 test files (counted on main) move to tea's.

### Slice 11, demlik 962: a cell may answer a pipeable `Step`

```ts
// On @demlik/tea/effect, beside Machine (effect/index.d.ts, effect/index.js), a sketch from issue 962.
Step.stay;                                       // nothing changes; it holds no model, tea fills in the one it gave the cell
Step.to(model);                                  // move to this model
Step.to(model).pipe(Step.run(a), Step.run(b));   // `run` is a `dual`, piped after `to`; Cmds run in pipe order

// Machine.make (effect/index.js `make2`, :51) wraps each cell once: a Step becomes tea's tuple, and a
// tuple passes as it is. Core, applyCell and the engine do not change, so our runner's applyCell
// calls (Program.ts, Runner.ts) still get the tuple.

// A cell after, matching its state with the Model union's own matcher (0567):
upload_ok: (s, m) =>
  Model.match(s, {
    uploading: () => Step.to(Model.cases.done.make({ url: m.value.url })).pipe(Step.run(notify({ text: "Uploaded" }))),
    orElse: () => Step.stay,
  }),
```

- **Our side in this slice:** no workaround to delete and no return to rewrite. The laws use small
  machines of their own. The sweep of the return sites comes after, in its own slices.
- **Open point 1, `Step.typed<Model, Cmd>()`. Lean: take it, 75%.** `Step.to(model)` takes its type
  from its argument, so a misspelled field in a spread inside a helper (outside the `update` table)
  is not caught. A per-machine `const S = Step.typed<Model, Cmd>()` in the machine's file brings the
  check back for helpers too; typing from the machine alone covers only cells written inline in the
  table. It is the shape Effect uses for its own type-first makers (`Schema.TaggedError<Self>()`,
  `Context.Tag(...)<Self, Shape>()`). The doubt: one more name per machine file.
- **Open point 2, `Step.resolve(step, model)`. Lean: no, 65%.** `applyCell` stays in core and keeps
  answering the tuple, as ruled, so a parent that steps a child (43 sites, by the lead's count) holds
  the child's tuple, not a `Step`. What the parent needs is to answer its own `Step` with the child's
  list of Cmds, so `Step.run` also takes a readonly list: `Step.to({ ...s, link }).pipe(Step.run(cmds))`.
  `Step.resolve` would add a second way to read a child's answer. The doubt: one `run` that takes one
  Cmd or a list is less plain than two names; `Step.runAll(cmds)` is the fallback if the review finds
  it hard to read.
- Until the sweep, a cell may answer either form, so nothing breaks in between.

### Slice 12, demlik 953: `Cmd.within`, Elm's `Cmd.map` kept as data

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
- **Elm's parent shape, in this slice too.** The window and the hands client get no tea change beyond
  `Cmd.within`. Their 11 forwarding rows each (`client/HandsMachine.ts`'s rows to `linked` at `:519`;
  `client/WindowMachine.ts`'s `linkUpdate` table and its cast at `:1253-1267`) become one parent Msg
  and one row:

```ts
// client/WindowMachine.ts after, a sketch. One parent Msg carries any Msg of the link child.
const WindowMsg = Schema.TaggedUnion({ link: { msg: LinkMsg }, /* the window's own Msgs */ });
update: {
  link: (s, m) => stepLink(s, m.msg),   // was 11 rows pointing at `linked`, and a cast
  // ...
}
const stepLink = (s: WindowModel, msg: LinkMsg): Step => {
  const [link, cmds] = applyCell(linkMachine, s.link, msg);  // typed by slice 3
  return Step.to({ ...s, link }).pipe(Step.run(Cmd.within("link", cmds))); // a Step, since slice 11 is in
};
```

  The link's Sub delivers its Msgs wrapped the same way, made with `WindowMsg.cases.link.make`.
- **Why the parent shape is in slice 12, not a slice of its own.** `Cmd.within("link", cmds)` makes
  every child answer come back as a `link` Msg, so slice 12 must add the `link` row to delete the
  answer-forwarding cells at all. If the 11 rows for the same child's other Msgs stayed for a later
  slice, the machine would hold two shapes for one child: one row for its answers, and 11 rows for
  the rest, stepping the same `linked` function. One slice moves the whole child to one shape, in the
  same two files. 75% sure; the cost is about 40 more lines in slice 12.

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
7. After slice 12, the window's handshake child sends `hello`. The window wraps it:
   `Cmd.within("handshake", [hello])`. The answer comes back as
   `{ _tag: "handshake", msg: { _tag: "hello_ok", ... } }`, and the window's one `handshake` cell hands
   `m.msg` to the child unchanged. The four forwarding cells at `WindowMachine.ts:1634-1637` are gone.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| E1 (slice 1): `exact-versions` accepts `catalog:<name>` for any lower-case name, refuses a range inside `catalogs.<name>`, and still refuses `catalog:^1`, `catalog: old` and a bare tag. It runs the real script on its own git tree, as its siblings do | test | fc.stringMatching: catalog names, 10 runs | (a) leave `POINTERS` as it is: `catalog:old` is refused, E1 red; (b) a pointer pattern that allows any text after `catalog:`: `catalog:^1` passes, E1 red | oxlint-plugins/exact-versions.test.ts |
| E2 (slice 1): `next/` and tooling type-check on 0.27.0 with no patch, and today's version on `catalog:old` at 0.25.0, the `.agents` project with its one allowed duplicate. The compiler and the existing suites are the law | type | type | point one `next/` package at `catalog:old`: `Program.make` loses the machine's `msg` type (0.25.0 unpatched has none), and its type check fails | pnpm typecheck |
| E3 (slice 1): `allowedDuplicatedPackages` appears in `tsconfig.base.json` only inside one checker override whose `include` is `.agents/**` globs alone, names only `@demlik/tea`, and appears in no other tsconfig of the repo. Read the way `namespace-imports.test.ts` reads the same file | test | format: tsconfig.base.json, the checker's plugin entry and its overrides | (a) set it in the checker's top-level options: E3 red; (b) add `next/**/*.ts` to the override's `include`: E3 red; (c) add a second package name: E3 red | oxlint-plugins/duplicate-packages.test.ts |
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
| G1 (slice 6, held): `before(check, table)` runs the check before every cell: for generated Msg sequences, including real `_ok` and `_err` answers, a machine with `before` folds like the same machine whose every cell starts with the check by hand; when the check answers, the cell never runs; when it answers `undefined`, the cell runs with its own narrowed Msg; `msgKeysOf`, `acceptedTypes`, `describeMachine` and `NoCellError` give the same names as the plain table | test | @demlik/tea/pbt.arbMsgSequence: a small machine with one Cmd, both forms, 100 runs | (a) a `before` that runs the cell first and the check after: a stale answer changes the model, G1 red; (b) a `before` that drops the cells' names: `msgKeysOf` answers `[]`, G1 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| G2 (slice 6, held): a table under `before` that leaves a Msg out is a compile error; a misspelled cell name is a compile error; each cell's `m` is narrowed to its own Msg; a check that returns anything but a cell or `undefined` is a compile error | type | type | type `before`'s `table` as `Record<string, ...>`: the missing Msg compiles, the `@ts-expect-error` is unused, G2 red | next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts |
| G3 (slice 6, held): Merger and Queue, rewritten with `before` and one handler per Msg, keep every law they have: a stale answer still counts as `late` and changes nothing else, a refused Msg still changes nothing | test | @demlik/tea/pbt.arbMsgSequence: each machine, each file's own runs | a `dropStale` that never drops: the stale-answer laws red | next/programs/pipeline/src/Merger.test.ts |
| T1 (slice 7): `Machine.types<{ ctx: X; sub: Y }>()` gives a machine the same ctx and Sub types as `{ ctx: {} as X, sub: {} as Y }`; a `sub` that is not a Sub is a compile error | type | type | drop the slice's hunk: `Machine.types` does not exist, T1 red | next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts |
| H1 (slice 8): `Cmd.cells(def, onOk, onErr)` gives exactly the two cells `def.okType` and `def.errType`, each `m` typed as that def's `_ok` or `_err` Msg; spread into a table, a missing Msg elsewhere in the table still fails to compile | type | type | a `Cmd.cells` typed as `Record<string, ...>`: the other cells lose their check, H1 red | next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts |
| H2 (slice 8): the scheduled job, rewritten with `Cmd.cells`, keeps every law it has: each tick dispatches its work once, and each answer settles it | test | @demlik/tea/pbt.arbMsgSequence: the scheduled job's machine, its file's own runs | swap `onOk` and `onErr` in `Cmd.cells`: the settle laws red | next/packages/libfabrika/src/schedules/ScheduledJob.test.ts |
| I1 (slice 9): a machine made with `init: X` folds, for generated sequences and a generated saved model or none, exactly like the same machine with `init: (loaded) => [loaded ?? X, []]`, and its `cmds` is `[]` when left out; a function `init` still works as today | test | @demlik/tea/pbt.arbMsgSequence: the counter in both forms, 100 runs | (a) `make` that keeps the object as `init`: `machine.init` is not a function, I1 red; (b) an object `init` that ignores `loaded`: a restart starts from `X`, I1 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| I2 (slice 9): `Machine.is` accepts every machine `Machine.make` and `defineMachine` return, in both `init` forms, and refuses a generated plain object with `update` and `init` fields that tea did not make | test | fc.anything: plain objects, 200 runs | an `is` that checks field names only: a hand-made object passes, I2 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| I3 (slice 9): `Program.make` takes a machine with an object `init` and refuses anything `Machine.is` refuses, with its `expected: "a tea machine"` refusal | test | Effect Arbitrary: CounterMachines | keep `isSteps`: the object-`init` machine is refused, I3 red | next/packages/libfabrika/src/runtime/Program.test.ts |
| S1 (slice 10): tea's `syncTest` fails where our stopgap failed and passes where it passed: for a machine that loses a field on save, it fails and names the seed, the cut and the check; for each machine that calls it today, it passes | test | @demlik/tea/pbt.arbMsgSequence: a machine whose encode drops a field, and each caller's machine, each file's own runs | a `syncTest` that compares only the last model: the lost field at a middle cut passes, S1 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| P1 (slice 11): a cell may answer `Step.stay`, `Step.to(model)`, `Step.to(model).pipe(Step.run(cmd), ...)`, `Step.run(cmds)` with a list, or the tuple; a Cmd not in the machine's `cmds` is a compile error at `Step.run`; a wrong model shape is a compile error at `Step.to`; through `Step.typed<Model, Cmd>()`, a misspelled field in a helper's spread is a compile error; a missing Msg handler still is | type | type | (a) drop the slice's `.d.ts` hunks: `Step` does not exist; (b) a `Step.typed` that returns the plain `Step`: the helper's typo compiles. Each turns P1 red | next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts |
| P2 (slice 11): for generated Msg sequences, a machine whose cells answer `Step` folds and runs exactly like the same machine written with tuples: the same models, and the same Cmds in pipe order, through tea's `run` and through `applyCell` | test | @demlik/tea/pbt.arbMsgSequence: a small machine with two Cmds, in both forms, 100 runs | (a) a `make` that turns `Step.run(a)` then `Step.run(b)` into `[b, a]`: the Cmds come out reversed, P2 red; (b) a `make` that leaves a `Step` unturned: `applyCell` hands back a `Step`, P2 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| P3 (slice 11): `Step.stay` answers the very model the cell was given, for any generated model, and never another | test | @demlik/tea/pbt.arbMsgSequence: the same machine, 100 runs | a `stay` that answers the machine's first model: a later stay resets the state, P3 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| W1 (slice 12): a parent that wraps a child's Cmds with `Cmd.within` gets each answer back wrapped, outermost name first, at every depth up to 3, on the Effect engine and through our runner; the wrapped parent folds like the same parent written with today's mark-and-route cells | test | @demlik/tea/pbt.arbMsgSequence: the two-search-box parent from issue 953, nested to depth 3, 100 runs | (a) a settle step that ignores `within`: the answer comes back flat, W1 red; (b) a wrap in the engine only, not in `def.ok`: our runner's answers come back flat, W1 red | next/packages/libfabrika/src/runtime/TeaAsks.test.ts |
| W2 (slice 12): a wrapped Cmd survives save and replay: a checkpoint that holds owed wrapped Cmds restarts and their answers still arrive wrapped; a replayed trace of a wrapped run reaches the same states | test | @demlik/tea/pbt.arbMsgSequence: the same parent, a cut at every Msg, 50 runs | a checkpoint that drops a Cmd's unknown fields when it saves it: `within` is lost, W2 red | next/packages/libfabrika/src/runtime/RunnerWithin.integration.test.ts |
| W3 (slice 12): the window and the hands client keep every handshake and link law with the forwarding cells and the 11 forwarding rows each gone, and each machine has exactly one `link` row | test | @demlik/tea/pbt.arbMsgSequence: each machine, each file's own runs | route one wrapped answer to the wrong child: the handshake laws red | next/packages/libfabrika/src/client/WindowMachine.laws.test.ts |

**Lint, type or test?** K1, K7, A1, B2, G2, T1, H1 and P1 are types: only the compiler sees a missing handler, a
wrong key or an inferred type. K8 is lint. The rest are tests, since they are about what runs: tea's
lookup, a fold, a wrap. No lint rule can tell a semantic event's `type` from the
rest, so the review checks the readers table line by line.

**New names in tests:** `SampleCmdInput` is a small input schema for a Cmd made with `Cmd.make`,
defined in the test. `CounterMachines` draws the counter written with a function `init` and with an
object `init`, defined in the test. Both are restated as [0135](../../../.decisions/0135-a-laws-file-pins-its-shapes-to-the-schema.md)
allows. `TeaAsks.test.ts` and `TeaAsks.types.test.ts` hold the laws of
slices 3 to 12, one `describe` per issue.

**No law for the wipe.** The wipe is a landing step on real homes, not code, so no law tests it; the
owner ruled out conversion code, and every law that tested it went with it. The re-recorded fixture
home keeps the port-home laws honest: they read a home of the new shape.

**Host-only and scheduled laws.** None needs launchd, the real app, a signal or a real socket. W2 is
an integration test, since it needs the runner on a real SQLite file; under
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) a pull request leaves
it to the 3-hour schedule, and it is not run on this laptop. Slice 2 also edits about 43
`*.integration.test.ts` files and the law suites they run (`RunnerTest.ts`, `ChildrenTest.ts` and the
rest). The lead runs `scheduled.yaml` once on the branches of slices 2 and 12 (`workflow_dispatch`)
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
| tsconfig.base.json | tests | 6 | one checker override for `.agents/**` with `allowedDuplicatedPackages: ["@demlik/tea"]` and its comment, naming ticket 1065; an exam path, so the tests step writes it |
| oxlint-plugins/duplicate-packages.test.ts | tests | tests | E3, new |
| .agents/tsconfig.json | build | 0 | no change: the setting lives in the base file's override (see "Slice 1"); it changes only if the fallback is taken |
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

### Slices 3 to 12: one tea ask each

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/runtime/TeaAsks.types.test.ts | tests | tests | new in slice 3: A1; then B2 (slice 4), G2 (slice 6, held), T1 (slice 7), H1 (slice 8), P1 (slice 11) |
| next/packages/libfabrika/src/runtime/TeaAsks.test.ts | tests | tests | new in slice 5: C1; then G1 (slice 6, held), I1 and I2 (slice 9), S1 (slice 10), P2 and P3 (slice 11), W1 (slice 12) |
| next/packages/libfabrika/src/schedules/ScheduledJob.test.ts | tests | tests | H2 (slice 8), if the file holds the scheduled job's laws; otherwise the laws file that does |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | I3 (slice 9) |
| next/packages/libfabrika/src/runtime/RunnerWithin.integration.test.ts | tests | tests | new in slice 12: W2 |
| next/programs/pipeline/src/Merger.test.ts | tests | tests | C2 (slice 5) and G3 (slice 6), if the file holds Merger's laws; otherwise the laws file that does |
| next/packages/libfabrika/src/client/WindowMachine.laws.test.ts | tests | tests | W3 (slice 12) |
| next/**/*.test.ts | tests | tests | each slice: the tests whose code it changes (hand types, helper calls, forwarding Msgs, the window's and hands' link Msgs now wrapped in `link`, test machines' `init` and `cmds`, the 25 `syncTest` calls in 12 files) |
| patches/@demlik__tea@0.27.0.patch | tests | 40 | slice 3: the five signatures (types) |
| patches/@demlik__tea@0.27.0.patch | tests | 30 | slice 4: `CmdDef`, `AnyCmdDef`, the Effect `Cmd.make` type |
| patches/@demlik__tea@0.27.0.patch | tests | 60 | slice 5: `settled` in `effect/index.js` `Cmd.make` and its type |
| patches/@demlik__tea@0.27.0.patch | tests | 30 | slice 6 (held): `before` beside `Reducer`, its body in the core chunk, its root export |
| patches/@demlik__tea@0.27.0.patch | tests | 10 | slice 7: `Machine.types` and its type |
| patches/@demlik__tea@0.27.0.patch | tests | 25 | slice 8: `Cmd.cells` and its type |
| patches/@demlik__tea@0.27.0.patch | tests | 70 | slice 9: the two `init` forms and optional `cmds` in `make` and `defineMachine`, the brand, `AnyMachine`, `Machine.is` |
| patches/@demlik__tea@0.27.0.patch | tests | 110 | slice 10: `syncTest` in `pbt`, core and Effect forms |
| patches/@demlik__tea@0.27.0.patch | tests | 90 | slice 11: `Step`, `Step.typed`, `Step.run` taking one Cmd or a list, and `Machine.make`'s turn of a `Step` into the tuple, on the Effect entry |
| patches/@demlik__tea@0.27.0.patch | tests | 150 | slice 12: `Cmd.within`, `CmdInput`, `def.ok` and `def.err`, `mint`, both engines' settle, pbt and testing helpers |
| pnpm-workspace.yaml | tests | 1 | each slice: its issue's line in the row's comment |
| pnpm-lock.yaml | tests | generated | each slice: the patch's hash |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 5 | slice 3: its hand-typed `applyCell` goes |
| next/packages/libfabrika/src/**/*.ts | build | 30 | slice 3: the other hand-typed calls and the `ReturnType<...>` helpers |
| next/packages/libfabrika/src/runtime/Program.ts | build | 15 | slice 4: the dig-out at `:740-741`, `accepts` and `isDeclared` go |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 10 | slice 4: the take-apart at `:279`, `:302` goes |
| next/programs/pipeline/src/Merger.ts | build | 230 | slice 5: `answers` goes; slice 6 (held): the 13 rows go, `reduce` splits into one handler per Msg under `before(dropStale, ...)` |
| next/programs/pipeline/src/Queue.ts | build | 100 | slice 5: `answers` goes; slice 6 (held): the 8 rows go, `reduce` splits under `before(refused, ...)` |
| next/packages/libfabrika/src/desktop/BrainLife.ts | build | 25 | slice 5: `responses` and the hand `malformed_result` go |
| next/packages/libfabrika/src/desktop/BrainServiceManaged.ts | build | 4 | slice 5: mints through `def.ok` and `def.err`, no cast |
| next/packages/libfabrika/src/runtime/ChaosMachine.ts | build | 12 | slice 5: its 6 hand structs go |
| next/packages/libfabrika/src/**/*.ts | build | 11 | slice 7: the 11 `{} as X` casts in `types:` fields |
| next/packages/libfabrika/src/schedules/ScheduledJob.ts | build | 8 | slice 8: the table cast, its comment and the hand types on `timer` go |
| next/packages/libfabrika/src/runtime/Program.ts | build | 20 | slice 9: `Steps`, `isSteps` and `isObjectOrNull` go; `Schema.declare(Machine.is, ...)` |
| next/**/*.ts | build | 140 | slice 9: the one-line `init`s and the `cmds: [],` lines in product machines (tests move theirs in the tests step) |
| next/packages/libfabrika/src/Testing.ts | build | 80 | slice 10: `syncTest` goes (deleted lines) |
| next/packages/libfabrika/src/client/HandsMachine.ts | build | 45 | slice 12: the forwarding cells, the Cmd filter and the 11 forwarding rows go; one `link` Msg and row |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | 70 | slice 12: the forwarding cells, the 4 Cmd maps, `linkUpdate` and its cast go; one `link` Msg and row |
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
  our answers move with tea's, and slice 12's wrap reaches them for free. 70% sure the runner holds the
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
- **The lead runs the scheduled workflow once on slices 2 and 12.** 80% sure. Both change what the
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
  `processes/` or `client/` starts after slice 2 merges. Slices 3 to 12 are smaller and may run beside
  the sweep; each rebases onto what merged.
- **Slices 3 to 12** each start from main after the slice before merges, since each adds hunks to the
  same patch file.

Clashes, from `gh pr view <n> --json files` against the 234 files that hold a Msg spot:

| Open branch | Slice 1 clashes on | Slice 2 clashes on |
|---|---|---|
| [1341](https://github.com/kamp-us/tea-fabrika/pull/1341) program watch | none | waits for it: 7 files, among them `Runner.ts`, `Program.ts`, `Program.test.ts`, `processes/Process.ts`, `cloudflare/runtime.ts` |
| [1331](https://github.com/kamp-us/tea-fabrika/pull/1331) hands client | none | waits for it: `client/HandsStart.ts` |
| [1366](https://github.com/kamp-us/tea-fabrika/pull/1366) reader ack | none | waits for it: 10 files, among them `Runner.ts`, `Gateway.ts`, `RepliesSql.ts`, `telemetry/Sink.ts` and four integration tests |
| [1312](https://github.com/kamp-us/tea-fabrika/pull/1312) tezgah new tile | none | 14 files |
| [1301](https://github.com/kamp-us/tea-fabrika/pull/1301) test SQLite store | lockfile | 14 files, lockfile |
| [1232](https://github.com/kamp-us/tea-fabrika/pull/1232) cloud fabsh | lockfile | 15 files, lockfile |
| [1099](https://github.com/kamp-us/tea-fabrika/pull/1099) agent tools from a schema | lockfile, `pnpm-workspace.yaml` | 3 files, lockfile, `pnpm-workspace.yaml` |
| [1032](https://github.com/kamp-us/tea-fabrika/pull/1032) email recovery | lockfile | lockfile |
| [1371](https://github.com/kamp-us/tea-fabrika/pull/1371) accumulating spread | none | 3 files |
| Plan pull requests whose builds will touch `next/`: [1365](https://github.com/kamp-us/tea-fabrika/pull/1365), [1369](https://github.com/kamp-us/tea-fabrika/pull/1369), [1373](https://github.com/kamp-us/tea-fabrika/pull/1373), [1344](https://github.com/kamp-us/tea-fabrika/pull/1344) | none today | their builds start after slice 2 or rebase onto it |

Slices 3 to 12 touch few files each (the files tables above): `Program.ts`, `Runner.ts`,
`WindowMachine.ts`, `HandsMachine.ts`, `Merger.ts`, `Queue.ts`, `BrainLife.ts`. Any open branch on
those rebases. A branch that adds a `type`-keyed Msg after slice 2 merges fails `pnpm typecheck` on
rebase (K7), so a stale branch breaks loudly, never quietly.

## Each issue carries its patch

A named step of slices 2 to 12, after the build is green and before the merge
([0060](../../../.decisions/0060-upstream-issue-carries-the-patch.md)): the slice's tests step saves
only that slice's hunks under `runs/`. The lead reads every line and appends them to that issue's
body, inside `<details><summary>The patch we apply locally</summary>`, a fenced `diff` block, then
`</details>`. Slice 2 posts on 949, slice 3 on 950, slice 4 on 951, slice 5 on 952, slice 6 on 954,
slice 7 on 960, slice 8 on 959, slice 9 on 956 and 958 (each issue gets its own hunks), slice 10 on
955, slice 11 on 962, slice 12 on 953. Held slice 6 posts on 954 only if the owner releases it. If a fix round changes a slice's hunks, the lead edits that section too. A later
slice that edits lines an earlier slice wrote (slice 12 changes `def.ok`, which slice 2 moved to
`_tag`) posts its own hunk against the file as it stands after the earlier slices, and says so.

## Validation

- Slice 1 tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/exact-versions.test.ts`,
  E1 red before `exact-versions.ts` changes; then `pnpm lint` (which runs `lint:versions`).
- Slice 1 build step: `pnpm lint`; the narrow paths `packages/pipeline/src/machine-make.test.ts`,
  `next/packages/libfabrika/src/runtime/Program.test.ts`, and one test file of each of today's
  programs.
- Slices 2 to 12, tests step: the slice's laws red on main plus its hunks, before the build; each
  planted fault seen red once.
- Slices 2 to 12, build step: the slice's laws and K9 green, the narrow paths of each folder it
  changed, `pnpm lint`.
- Every slice changes the lockfile, so `--changed origin/main` is the full suite and is not run
  locally: the narrow paths stand in for it, and CI runs the rest. The lead runs one `pnpm typecheck`
  and reads CI.
- The lockfile is written by `pnpm install` (slice 1) and `pnpm patch-commit` (slices 2 to 12) inside
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

1. Slice 1, tea 0.27.0 and today's catalog: 36 lines (11 package.json files, the catalog block, 4
   lines in `exact-versions.ts`, the checker's one override, two docs lines), plus E1, E3, the deleted patch
   and the lockfile.
2. Slice 2, the `_tag` switch, which holds the first patch: 1,250 lines (the patch, about 700 diff
   lines; our product code, about 550 lines in about 80 files), plus about 950 spots in about 160
   test files, four new laws, the re-recorded fixture home, the landing wipe and about 10 docs lines.
3. Slice 3, demlik 950, typed `applyCell`: 75 lines (40 patch, 35 ours, mostly deleted).
4. Slice 4, demlik 951, a Cmd's Effect schemas typed: 55 lines (30 patch, 25 ours, mostly deleted).
5. Slice 5, demlik 952, `settled`: 175 lines (60 patch, about 115 of ours deleted or rewritten).
6. Slice 6, demlik 954, `before`, on hold: 360 lines (30 patch, about 330 of ours: Merger's and Queue's
   `reduce` rewritten as one handler per Msg, and 21 rows gone).
7. Slice 7, demlik 960, `Machine.types`: 21 lines (10 patch, 11 of ours).
8. Slice 8, demlik 959, `Cmd.cells`: 33 lines (25 patch, 8 of ours, mostly deleted).
9. Slice 9, demlik 956 and 958, `init` as a value and `Machine.is`: 230 lines (70 patch, about 160 of
   ours, mostly deleted one-liners), plus the test machines' own.
10. Slice 10, demlik 955, `syncTest`: 190 lines (110 patch, about 80 of ours deleted), plus 25 calls
    moved in 12 test files.
11. Slice 11, demlik 962, `Step`: 90 lines (the patch), plus three laws. Nothing of ours changes; the
    sweep comes after.
12. Slice 12, demlik 953, `Cmd.within`: 265 lines (150 patch, about 115 of ours: the forwarding cells
   and rows gone, one `link` Msg and row in each of the window and hands machines).

About 32 agent hours across the twelve slices, 60% sure. The doubts: slice 2's tests step, about 870
hand values rewritten with makers in about 130 test files, may take two sessions, and its build two
more; and slice 12 changes tea's settle step in both engines, the riskiest hand edit in hashed chunks.
K2 and W1 are what catch a missed spot.

Budget basis: `field/runs/` list prices for the largest steps so far: $28 for the p18 slice 1 build
(`2026-11-13-p18s1-build.json`), $14.5 and $11.8 for its two tests steps, $5 to $6 per review.
Slice 1 is 3 steps at about $10. Slice 2 is two tests steps, two build steps, one review and one fix
round, about $130. Slices 3 and 4 are 3 steps each at about $12. Slice 5 is 3 steps at about $18, and
slice 6, with its two `reduce` rewrites, 3 steps at about $25. Slices 7 and 8 are 3 steps each at
about $8. Slice 9 is 3 steps at about $20, slice 10 3 steps at about $18, and slice 11 3 steps at about $15.
Held slice 6 stays in the budget, in case the owner releases it. Slice 12 is 4 steps (tests, build, review, one fix round) at about $45.

Estimate: 41 steps, $344

## Open questions

None.

## What comes after

Each is its own pull request or waits on its own ruling. None is in this plan's slices.

- **The `Step` sweep:** about 500 to 650 return sites in 35 machine files move from the tuple to
  `Step` after slice 11 lands, as their own slices (the lead's count), folder by folder like the
  other sweeps.
- **Slice 6's ruling:** whether `before` lands, or our stepper runs tea's identity check before
  `applyCell`, as the maintainer showed on 954 and as demlik issue 961 asks tea to export.

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
- **Slices 3 to 12's tea shapes** are my sketches of what each issue asks; each issue leaves its shape
  to the maintainer. Where tea's release differs, the bump rewrites our call sites.
- **Whether the runner holds each Cmd's def** where it mints answers: 70%, as "Calls taken" says.

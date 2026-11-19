Approved by the lead agent, builds 0215 for the swap_prepared make in Runner.ts (ticket 1181); body 85cbd4501ccf
Plancheck-Version: 3

```ts
// A sketch: the whole fix, in next/packages/libfabrika/src/runtime/Runner.ts, inside `swap`.
// Before (main, since PR 1619): the maker throws on the new build's own answers, so a wake of 0.5
// from its init, or a `ran` holding "" from its upgrade, is a defect.
yield* complete(
  SupervisorMsg.cases.swap_prepared.make({ change: { /* ...12 fields... */ wake: next.wake, ran: upgraded.ran } }), // throws
);

// After: decode the change with its own schema, read off the Msg case, as decision 0215 says for
// untrusted input. A change that does not decode is the new code's answer, so the swap is refused
// `shape`, the word the same block already answers when the new build's upgrade or init fails.
const change = yield* Effect.result(
  Schema.decodeUnknownEffect(SupervisorMsg.cases.swap_prepared.fields.change)({ /* the same 12 fields */ }),
);

if (Result.isFailure(change)) {
  return yield* refuse("shape");
}

yield* complete(SupervisorMsg.cases.swap_prepared.make({ change: change.success }));
```

# Ticket 1181: a code swap whose new build answers out of range is refused `shape`, never a defect

`next/` only: `next/packages/libfabrika/src/runtime/`. Ticket 1181, branch
`fabrikalfa/t1181-runner-swap-wake` from origin/main at c3dac8a. It builds
[0215](../../../.decisions/0215-untrusted-input-never-throws.md) for the one `swap_prepared` make
in `Runner.ts`, the bug in `field/findings/2026-11-18-make-on-untrusted-runner-swap-prepared.json`.
Ticket 1182 owns the Runner's other 17 makes; this plan does not touch them, because this call is
fixed alone (its decoded value feeds the later `swap_completed` make, so nothing else changes). It
walks back no decision and changes no existing law.

**Said plainly first:** a code swap builds its `swap_prepared` Msg with `make` from values the new
build's isolate gave back: the wake its `init` answered and the upgrade names its `upgrade`
answered. Those are decoded loosely (`wake` as any number, `ran` as any strings), but the Msg's
`CodeChange` wants a wake that is a whole number of at least 0 and names that are not empty. So a
program whose wake answers 0.5 or -1 runs fine until a swap, and then the swap dies with a defect.
The fix decodes the change with its own schema and, when it does not decode, answers the swap's
existing refusal `shape`: the process keeps its old code, one `code.refused` is written, and the
caller gets a typed answer. About 8 product lines in `Runner.ts`, and one new law beside the
runner's other in-memory laws, which every pull request runs.

## Doubt first

No call here is under 80%. The two nearest to the line, both 80%:

- **The law lives in `RunnerRecovery.laws.test.ts`, not in the reload suite.** The reload suite
  (`ReloadTest.ts`) is the swap's home, but it runs only through `Reload.integration.test.ts`, so
  under [0602](../../../.decisions/0602-integration-laws-leave-merge-line.md) no pull request runs
  it, and this bug class merged green once already (PR 1619). What would settle it: the lead
  preferring the reload suite. Then the law is a new L-row in `ReloadTest.ts`, and it runs only in
  main's full run.
- **The law also breaks the upgrade's `v` (one generated kind beyond the brief's three).** It is the
  same make and the same fix; it costs one generator branch. What would settle it: the lead keeping
  the law to the brief's three kinds; drop the `lower_v` kind.

## The cause, confirmed by reading

- `Runner.ts:2754` to `:2768` (at c3dac8a): the swap runs the new build's `upgrade` and `init`
  inside `Effect.result`, and any failure there answers `refuse("shape")` (`:2770`).
- `Runner.ts:2780` puts `wake: boot.wake` into the next `Live`; `boot` is a `Step`, whose `wake` is
  `Schema.NullOr(Schema.Number)` (`Program.ts:592`). `Runner.ts:2800` passes `ran: upgraded.ran`,
  decoded as `Schema.Array(Schema.String)` (`Execution.ts:23`, the worker path at `:385`; the
  in-process path at `:283` runs `Saved.upgrade`).
- `Runner.ts:2792` makes `SupervisorMsg.cases.swap_prepared` with `change: CodeChange`
  (`internal/supervisor.ts:46` to `:69`): `wake: Schema.NullOr(Millis)` and `ran: Schema.Array(Text)`,
  where `Millis` is `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))` and `Text` is
  `Schema.NonEmptyString` (`internal/recovery.ts:8` and `:11`). Its filter also needs
  `from <= checkpoint.saved.v`: `from` is the process's own `v`, and `checkpoint.saved.v` is the
  upgrade's answer, so an upgrade that answers a lower `v` throws there too.
- `make` throws on a value that does not fit: Effect 4.1.3, `Schema.ts` lines 215 to 240 ("Throws
  an `Error` with the schema issue in its `cause` when validation fails"). Inside `Effect.gen` a
  throw is a defect, so the swap call dies.
- Nothing is written before the throw: the only work after the `prepared` block is the `kept`
  decode (`:2786`), which writes nothing. So on main the old process does keep running; what breaks
  is the answer, a defect in place of a refusal, and no `code.refused` is written.
- Before PR 1619 (squash c203a382d, read with `git show c203a382d -- next/packages/libfabrika/src/runtime/Runner.ts`),
  the swap passed a plain literal `{ type: "swap_prepared", change }` to `complete`, whose `send`
  ran the supervisor inside `Effect.try` (`Runner.ts:771` today) and turned the throw into a typed
  `LedgerError` `bad_row`. PR 1619 replaced the literal with the maker, which now throws before
  `complete` runs.
- No law caught it: the reload laws never generate a wake or an upgrade name out of range, and they
  run only in main's full run.

## Calls taken

1. **Decode the whole `change` with `SupervisorMsg.cases.swap_prepared.fields.change`, through
   `Schema.decodeUnknownEffect`, and build the Msg with `make` from the decoded value** (85%). 0215
   says untrusted input goes through `decodeUnknownEffect`, and a decoded value is trusted input
   for `make`. One decode covers every field the new build gave (`wake`, `view`, `ran`, the
   upgraded `v` the filter reads), and the schema is read off the Msg case, so the decode and the
   Msg cannot drift apart. It is the shape `kept` already takes three lines above it
   (`Schema.decodeUnknownEffect(Checkpoint)`, `Runner.ts:2786`) and the shape PR 1643 took for the
   tasks ledger (`docs/plan/quests/t1178-PLAN.md`, Amendment 1). Not `makeEffect`: it fills
   constructor defaults, which t1178 found accepts what a decoder refuses. Not a decode of `wake`
   and `ran` alone: it would leave the `from <= v` filter throwing. The doubt: a field the runner
   owns (`process`, `origin`, `pos`) that fails would also answer `shape` and hide our own bug. Each
   of those comes from a value already decoded (`ProcessId`, the `From` line, a saved `Rev`), so I
   take that cost.
2. **The refusal is the existing `shape`** (85%). The code already answers `shape` for every way
   the new build's preparation of this process can fail: an `upgrade` that throws or answers a
   bad shape, an `init` that throws, refuses, or answers a `Step` that does not decode
   (`Runner.ts:2752` to `:2770`). The wake and the upgrade names are those same two answers,
   checked more strictly. `load` means the loader failed or the declaration names another program
   (`:2738` to `:2748`); `newer` means a lower declared `v` (`:2751`). Both are wrong here.
   [Hot reload, H3 and H4](../../../docs/direction/hot-reload.md) and
   [0291](../../../.decisions/0291-hot-reload-swaps-one-program.md) say a new build the process
   cannot take refuses the swap for that one process, which keeps its old code, with a
   `code.refused` ([0293](../../../.decisions/0293-every-record-names-its-build.md)). No new word.
3. **The decode sits after `kept` and before `complete`** (90%). Nothing is journaled yet, so a
   refusal there leaves the supervision journal `idle` and the old build in place, and `refuse`
   writes its one `code.refused:<load>`. `finishSwap(next)` keeps taking `next`, whose wake now
   equals the decoded one.
4. **`Program.ts`, `Execution.ts` and `internal/supervisor.ts` do not change** (90%). The swap
   reads `SupervisorMsg`, which `Runner.ts` already imports, and needs no new export. Tightening
   `Step`'s `wake` or `Upgraded`'s `ran` at the source would be the cleaner edge, but it changes
   what every step and every upgrade accepts, touches files open draft PRs 1458, 1312, 1232 and
   1514 hold, and is a wider change than this ticket. It is named under "What this cannot tell us".
5. **The new law goes in `RunnerRecovery.laws.test.ts` as its own `describe`, with its own rig in
   that file** (80%). The file already runs a real supervised runner, mailbox, process store and
   ledger on `node:sqlite` at `:memory:`, with the program's box doubled by `workerExecution`, so
   the test can hand back any `init` or `upgrade` answer. It is a `next` project file, not
   `.integration.`, so a pull request whose change reaches it runs it, as
   [0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md) asks of a law that
   can run on a stand-in. The two existing laws there stay as they are; the tests step writes a
   local rig function for the new one rather than reshaping theirs.
6. **No plan doc row changes** (85%). This is a fix inside P15's existing swap; no tier row's status
   or size moves. The plan file is the record.

## How others do it

- **Erlang/OTP:** a code change is asked of the process (`sys:change_code/4`), and the callback
  `code_change/3` answers `{ok, NewState}` or `{error, Reason}`. On an error the process keeps its
  old state and the caller gets the error as a value; a bad new module does not kill the process
  ([sys](https://www.erlang.org/doc/apps/stdlib/sys.html),
  [gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html); from memory, not fetched
  this session). Our `refused` is that `{error, Reason}`.
- **Elm:** a decoder answers a `Result`, never a throw
  ([elm/json `decodeValue`](https://package.elm-lang.org/packages/elm/json/latest/Json-Decode#decodeValue);
  from memory, not fetched). elm-hot is the counter-example the hot-reload note already names: it
  feeds new code without a check.
- **Effect:** the installed 4.1.3 `Schema.ts` names the pair. `make` (lines 215 to 240): "Use when
  constructor input is trusted or when validation failure should abort with a thrown `Error`."
  `decodeUnknownEffect` (lines 1520 to 1545) answers `Effect<Type, SchemaError>`. Read in
  `next/packages/libfabrika/node_modules/effect/src/Schema.ts`. The repo's own patch of Effect 4.1.3
  touches only the arbitrary model and `TestConsole`, not decoding.
- **The industry:** "parse, don't validate": turn an untrusted value into a typed one once, at the
  edge, and fail as a value there (Alexis King, 2019; from memory, not fetched).
- **In this repo:** the `kept` decode at `Runner.ts:2786` and the `candidate` and `prepared`
  results at `:2738` and `:2754`, each `Effect.result` then `refuse(...)`; the tasks ledger's
  field decodes from PR 1643 (squash 0dc333d).

## The shape

### Runner.ts, inside `swap`, after (a sketch, not compiled)

```ts
const kept = yield* Schema.decodeUnknownEffect(Checkpoint)({
  ...checkpoint(next, null),
  saved: { v: next.v, build: request.hash, model: next.model, after: next.after },
}).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));

// The new build's own answers (its init's wake and view, its upgrade's names and v) are untrusted
// (0215): a change they make that the journal cannot keep is refused as the new code's.
const change = yield* Effect.result(
  Schema.decodeUnknownEffect(SupervisorMsg.cases.swap_prepared.fields.change)({
    process: process.id,
    load: request.load,
    program: request.program,
    was: old,
    checkpoint: kept,
    from: state.v,
    ran: upgraded.ran,
    origin: { ...(yield* from(null, yield* traceId)), build: request.hash },
    pos: next.pos,
    view: next.view,
    wake: next.wake,
    maxDeliveries: loaded.declaration.maxDeliveries ?? null,
  }),
);

if (Result.isFailure(change)) {
  return yield* refuse("shape");
}

yield* complete(SupervisorMsg.cases.swap_prepared.make({ change: change.success }));
yield* fault("after_swap_prepared");
yield* finishSwap(next);
// unchanged from here
```

The `Swapped` answer, the `code.refused` record and their `reason` literals
(`"shape" | "newer" | "load"`, `Runner.ts:136`, `ProcessStore.ts:66` to `:71`) keep their shapes.
`refuse` is called unchanged, so its span carries `outcome: "refused"` and `reason: "shape"`. Every
`CodeChange` field's encoded side equals its type side (refinements only, no transformations), so
decoding a value built from typed parts is safe, as `kept`'s decode already shows.

### RunnerRecovery.laws.test.ts, the new law (a sketch: the tests step shapes it)

```ts
/** What the new build's box answers on a swap: one value out of the journal's range, or one in it. */
type Answer =
  | { readonly kind: "fractional"; readonly wake: number } // init's wake, not a whole number
  | { readonly kind: "negative"; readonly wake: number } // init's wake below 0
  | { readonly kind: "empty_ran"; readonly ran: ReadonlyArray<string> } // upgrade names, one ""
  | { readonly kind: "lower_v" } // upgrade answers saved.v one below the process's v
  | { readonly kind: "fits"; readonly wake: number | null; readonly ran: ReadonlyArray<string> };

const answer: fc.Arbitrary<Answer> = fc.oneof(
  fc.double({ min: -1e9, max: 1e9, noNaN: true }).filter((n) => !Number.isInteger(n)).map((wake) => ({ kind: "fractional", wake })),
  fc.integer({ min: -1e9, max: -1 }).map((wake) => ({ kind: "negative", wake })),
  fc.tuple(fc.array(fc.string({ minLength: 1 })), fc.nat()).map(([names, at]) => { const i = at % (names.length + 1); return { kind: "empty_ran", ran: [...names.slice(0, i), "", ...names.slice(i)] }; }),
  fc.constant({ kind: "lower_v" }),
  fc.record({ kind: fc.constant("fits"), wake: fc.option(fc.nat(), { nil: null }), ran: fc.array(fc.string({ minLength: 1 })) }),
);

// The loader answers by build: "test" is the counter the runner boots on; "next" is the same
// counter whose workerExecution's init and upgrade hand back the generated answer; "good" fits.
// Walk: open; swap { load: "install_next", program: "counter", hash: "next" }; then
//   bad kinds: Swapped refused { was: "test", reason: "shape" }, never a defect or a LedgerError;
//              store.load's saved.build is "test"; the saved Supervision's journal is idle with
//              build "test"; one code.refused:install_next row in the ledger; a mailed inc steps
//              (count + 1); a repeated swap of the same load answers the same and writes no
//              second row; then swap { load: "install_good", hash: "good" } answers swapped { was: "test" }.
//   fits:      Swapped swapped { was: "test" }, and store.load's saved.build is "next".
it("ticket 1181: a swap whose new build answers a wake or an upgrade the journal cannot keep is refused shape, and the process keeps its old build", ...,
  // seed 119120, runsFor({ fast: 5, full: 25 }), examples: wake 0.5, wake -1, ran [""], lower_v
);
```

A tagged answer is matched with `Match`, never by comparing `kind` by hand
([0567](../../../.decisions/0567-a-tagged-value-is-matched.md)) where lint asks for it. The rig reads
the ledger rows the way `Reload.integration.test.ts`'s `rows` does, or through the store it already
holds; the tests step picks.

## One value traced through

A swap whose new build's `init` answers `wake: 0.5`, the `fractional` example:

1. The law opens the runner on build `"test"`, then calls
   `runner.swap({ load: "install_next", program: "counter", hash: "next" })`.
2. The swap finds the journal `idle`, loads `"next"`, and its name and `v` (1) pass. `upgrade`
   answers `{ saved, ran: [] }`; `init` answers `{ _tag: "stepped", model, view, cmds: [], wake: 0.5 }`,
   which `Step` decodes (`Schema.Number` takes 0.5). `next.wake` is 0.5. `kept` decodes.
3. **On main:** `SupervisorMsg.cases.swap_prepared.make({ change })` checks `wake` against
   `Schema.NullOr(Millis)`, 0.5 is not an integer, and `make` throws `Schema validation failed`.
   The throw is a defect inside `Effect.gen`; `call`'s `Effect.exit` keeps it and the swap dies.
   Nothing was written, so the process is still on `"test"`, but no answer and no `code.refused`.
   The law's `Effect.exit(runner.swap(...))` is a `Die`, and the law fails.
4. **After the fix:** `Schema.decodeUnknownEffect(...fields.change)` fails with a `SchemaError` on
   `wake`. `Effect.result` gives a `Failure`, and `refuse("shape")` records
   `code.refused:install_next` `{ program: "counter", hash: "next", was: "test", reason: "shape" }`
   and answers `Swapped.refused { was: "test", reason: "shape" }`. `complete` never runs, so the
   journal stays `idle` with build `"test"`.
5. The law sees the refusal, reads `saved.build === "test"` and the idle journal, steps one `inc`
   on the old build, repeats the swap and sees no second row, then swaps to `"good"` and sees
   `swapped { was: "test" }`.

A second value, `ran: [""]` from the upgrade: `Upgraded`'s `Schema.String` takes `""`, `Text` does
not, so on main the same make throws and after the fix the same `shape` refusal answers.

## Laws

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| S1: a swap whose new build answers a wake or an upgrade the journal cannot keep is refused `shape`, keeps its old build with an idle journal and one `code.refused`, and a fitting swap after it swaps (new) | test | fc.oneof: the `Answer` kinds above (fractional and negative wakes, a `ran` with one `""`, a lower upgraded `v`, and a fitting answer), seed 119120, `runsFor({ fast: 5, full: 25 })`, so 5 runs on a pull request and 25 runs in the full run, with the four named examples | main as it is: every bad kind red with a `Die` (`Schema validation failed` at `Runner.ts:2792`). After build: decode only `wake` (red on `empty_ran` and `lower_v`); answer `refuse("load")` (red); map the failure to `LedgerError` `bad_row`, the shape before PR 1619 (red: a failure, not a refusal); refuse even when the change decodes (red on `fits`); call `complete` before the decode so the journal turns `swapping` (red: the journal is not idle, and the later fitting swap answers `not_now`) | `next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts` | every pull request whose change reaches the file, in the `next` project; main's full run |
| L1 to L6, L14, L15: the reload laws, every fitting and refusing swap answers as before (unchanged) | test | fc.record: `ReloadTest.ts`'s own walks, seed 119120, default runs | After build: build the decoded change with `was: request.hash`, so its filter refuses every swap (L1 red, and S1's `fits` kind red) | `next/packages/libfabrika/src/runtime/ReloadTest.ts` | main's full run, through `next/packages/libfabrika/src/node/Reload.integration.test.ts`; the build step runs it once by hand |

No law here is host-only: no launchd, no Electron, no real process, socket or signal. S1 runs on an
in-memory stand-in, so it is not an `.integration.` law. No shape check fits lint or type: whether a
value is trusted depends on where it came from, which a lint rule cannot see (that sweep is ticket
1182's).

## Files

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts` | One new `describe` with S1: a local rig function (the two existing laws' wiring, with a loader that answers by build), the `Answer` generator, the walk. The header comment names ticket 1181. The two existing laws unchanged | tests | tests | 1 | S1 red at main on every bad kind |
| `next/packages/libfabrika/src/runtime/Runner.ts` | In `swap`: decode the change with `SupervisorMsg.cases.swap_prepared.fields.change` through `Effect.result`, answer `refuse("shape")` on failure, make the Msg from the decoded change; one comment line | 8 | build | 1 | 0215; S1, the reload laws, the file's two laws |
| `next/packages/libfabrika/src/runtime/ReloadTest.ts` | Not changed: the reload suite, which must stay green | 0 | tests | none | read only |
| `next/packages/libfabrika/src/node/Reload.integration.test.ts` | Not changed: runs the reload suite on SQLite files | 0 | tests | none | read only |
| `next/packages/libfabrika/src/runtime/Program.ts`, `next/packages/libfabrika/src/runtime/Execution.ts`, `next/packages/libfabrika/src/runtime/internal/supervisor.ts` | Not changed: `Step`, `Upgraded` and `CodeChange` keep their shapes (call 4) | 0 | build | none | read only |

### Commit order

1. The tests step commits S1 and confirms it red at main, one bad kind at a time, with the command
   under Validation.
2. The build step commits `Runner.ts`, runs S1 and the file's two laws green, runs the reload
   integration file once, then runs each plant in the laws table and records which went red.

## Existing tools

- The decode in `swap` is no new function: it is `Schema.decodeUnknownEffect` (Effect 4.1.3,
  `Schema.ts` line 1536) on the Msg case's own field, `SupervisorMsg.cases.swap_prepared.fields.change`.
  Searched `rg -n "decodeUnknownEffect" next/packages/libfabrika/src/runtime/Runner.ts` (the `kept`
  decode at line 2786, the shape this follows) and `rg -n "fields\.[a-z]+\)\(" next/packages/libfabrika/src`
  (`node/launchd/LaunchdStatus.ts` line 175 and the tasks ledger decode a case field the same way).
  `refuse` (`Runner.ts:2721`) is the existing answer; nothing new is named.
- The rig function in `RunnerRecovery.laws.test.ts` (a new function in a file that exists). Searched
  `rg -ln "ProgramRunner.layer" next/packages/libfabrika/src` and the `*.test-support.ts` files
  under `src/runtime/` and `src/node/`: no exported in-memory supervised runner rig exists. The
  two laws in this file each wire one inline, and `RunnerLifecycle.test.ts`'s rig doubles the
  loader's handler, not its execution. The rig is that same wiring with a loader that answers by
  build, kept in this file.
- The `Answer` generator is the tests step's, from fast-check 4.10.2's `fc.oneof`, `fc.double`,
  `fc.integer`, `fc.array`, `fc.record` and `fc.option`.

## Is this a setting?

No new choice is made. `shape` is an existing reason of `Swapped.refused` and `code.refused`. The
seed is the repo's 119120 and the run counts come from `runsFor`, as the file's other laws use.

## Records

- The lead writes the steps' rows in `field/runs/` as usual.
- The fact lost if not written now: PR 1619 turned this literal into a throwing maker, and the swap
  fell from a typed `bad_row` to a defect with no law to see it, because the swap laws run only in
  main's full run and generate no out-of-range wake. This plan keeps that, and S1 moves the check to
  every pull request.
- A fact the fix still does not keep: `code.refused` has no field for why the change did not decode
  (which field, which value). The existing `shape` refusals lose their cause the same way. Adding
  one is a `RuntimeRecord` change in `ProcessStore.ts`, outside this ticket.
- No glossary row: no new word. `fractional`, `negative`, `empty_ran`, `lower_v` and `fits` are
  generator labels inside one test file.

## Validation

- Tests and build steps, from `next/packages/libfabrika`:
  `nice -n 15 pnpm exec vitest run src/runtime/RunnerRecovery.laws.test.ts --maxWorkers=3`, narrowed
  with `-t 1181` while working.
- The build step, once at the end:
  `nice -n 15 pnpm exec vitest run src/node/Reload.integration.test.ts --maxWorkers=3`, since no pull
  request run covers the reload laws.
- `pnpm format`, then `pnpm lint`.
- The lead runs the one `pnpm typecheck` at the end.

## Real-run proof

None needed: no window, no host-only law, no launchd entry. S1 on the pull request is the proof,
and main's next full run covers the reload laws.

## What this cannot tell us

- Whether `Step`'s `wake` and `Upgraded`'s `ran` should be tightened where they are decoded, so a
  wake of 0.5 is refused at every step and not only at a swap. Today a normal step takes it and hands
  0.5 to the alarm. That is a change to what every program may answer, in files other open pull
  requests hold, and I did not measure what it would break.
- Whether a field the runner owns can ever fail the new decode. Call 1 says each comes from a value
  already decoded; if one did fail, it would answer `shape` and hide our own bug.
- Whether a swap request from the wire can break the same path: `runtime.ts` passes the request
  undecoded, and an empty `load` would now answer `shape` rather than a wire error. The finding
  below has it.
- How long S1 adds to a pull request's run. Each run builds a runner over two in-memory databases;
  the file's existing laws do the same, unmeasured here.

## Open questions

None.

## Size

1. One pull request, tests and build: 8 lines of product code in `Runner.ts` and about 140 test
   lines in `RunnerRecovery.laws.test.ts`, sure 85%.

The tests step is about 0.5 agent hours (a new rig and a red run per kind) and the build step about
0.3, sure 70%. Priced from `field/runs.jsonl`'s list prices: a tests step's median about $1.1 and a
build's about $1.2; this tests step writes a rig, so about $3. A review about $3, and one likely
send-back about $2.

Estimate: 4 steps, $10

## Findings

```json
{"_tag":"finding","id":"2026-11-18-swap-rpc-request-is-not-decoded","date":"2026-11-18","by":"plan","model":"claude-opus-5-5","rule":"bug","location":{"path":"next/packages/libfabrika/src/cloudflare/runtime.ts","line":2644},"says":"A Process object's swap RPC hands its request to the runner undecoded, so an empty program or hash reaches Schema make in the runner's refusal and the swap dies with a defect, while the restart RPC beside it decodes its request first.","proof":"next/packages/libfabrika/src/cloudflare/runtime.ts:2644 `swap: (request: Parameters<typeof runner.swap>[0]) => attributed(runner.swap(request))` passes the request as typed, with no decode; :2653-2655 `restart: (request: unknown) => Schema.decodeUnknownEffect(RestartRequest)(request).pipe(Effect.mapError(... bad_row ...))` decodes. In the runner, an empty `program` fails `loader.load` or the name check and calls `refuse(\"load\")`, which runs `RuntimeRecord.cases[\"code.refused\"].make({ program: request.program, hash: request.hash, ... })` (next/packages/libfabrika/src/runtime/Runner.ts:2724-2725), whose `program` and `hash` are `Schema.NonEmptyString` (next/packages/libfabrika/src/runtime/ProcessStore.ts:66-71), so make throws.","cost":"A malformed swap call from the wire answers a defect, not a typed error; today the only caller is the Project's own code push (runtime.ts:1718), so the cost is low until another caller exists.","head":"c3dac8ab55806e6f29b8a5a91961fbdadb92f665","ticket":"kamp-us/tea-fabrika#1181","pr":null}
```

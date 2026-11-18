Approved by the lead agent, builds 0215; body c8f9bf301217
Plancheck-Version: 3

```ts
// A sketch: the whole fix, in next/packages/libfabrika/src/tasks/TasksLedger.ts.
// Before (main, since PR 1619): the maker throws on the caller's own value, so a bad field is a defect.
request: Effect.fn("tasks.request")(function* (request: Request, recorded: Recorded) {
  return (yield* call(request.id, Msg.cases.request.make({ request }), recorded)).receipt; // throws
}),
// After: the same maker's Effect form keeps the failure typed, as decision 0215 says for untrusted input.
const badInput = (cause: SchemaIssue.Issue) => TasksError.make({ reason: "bad_input", cause });

request: Effect.fn("tasks.request")(function* (request: Request, recorded: Recorded) {
  const msg = yield* Msg.cases.request.makeEffect({ request }).pipe(Effect.mapError(badInput));
  return (yield* call(msg.request.id, msg, recorded)).receipt;
}),
// take, started, finish and collected change the same way.
```

# Ticket 1178: the tasks ledger answers `bad_input` for an invalid call, never a defect

`next/` only: `next/packages/libfabrika/src/tasks/`. Ticket 1178, sev1
[issue 1631](https://github.com/kamp-us/tea-fabrika/issues/1631), branch
`fabrikalfa/t1178-tasks-ledger-refusal` from origin/main at d48ff74. It builds
[0215](../../../.decisions/0215-untrusted-input-never-throws.md) for the ledger's five write calls.
It changes no law, no seed, no timeout and no retry
([0036](../../../.decisions/0036-a-flaky-test-is-fixed.md)), and walks back no decision.

**Said plainly first:** L8 is red on main because five calls in `TasksLedger.ts` build their Msg
with `Msg.cases.<case>.make(...)` from the caller's own values. `make` throws when a field does not
fit, so an invalid request, executor or result is a defect, and L8 wants a `TasksError` with reason
`bad_input`. The fix uses `makeEffect`, the form of the same maker that keeps the failure typed,
and maps it to `bad_input`. About 15 product lines in one file.

## Doubt first: one new law, L8b, in this pull request (75%)

The brief says the tests step writes no new law unless the plan finds one missing. One is missing.
L8's bad-call generator breaks a request, an executor, a result or a record. It never breaks the
`execution` that `started` and `finish` take, nor the `collection` that `collected` takes. The fix
covers those three fields too, and on main each of them throws the same way (the same
`make` call). With no law, a build that fixes only `request`, `take` and `finish` turns L8 green
and leaves `started` and `collected` throwing. So the plan adds L8b, a new law beside L8 in the same
suite, with three new moves. It changes nothing in L8 or any other law.

What would settle the doubt: the lead's call that the sev1 fix should be only L8 green. Then drop
L8b and its rows, and the build step's change to `started` and `collected` has no law that holds it.
I lean toward adding it because review would ask for it, and it costs about 60 test lines.

**The lead's call (2026-11-18): L8b lands in this pull request.** It is a pure addition that holds
0215 for the two calls L8 does not reach, and it loosens nothing.

## The cause, confirmed

- The red law: "L8: a call with one invalid field is refused and changes no task", in
  `next/packages/libfabrika/src/tasks/TasksTest.ts` (line 1063), run by
  `next/packages/libfabrika/src/node/tasks/TasksLedger.integration.test.ts`.
- Run here at d48ff74, from `next/packages/libfabrika`:
  `nice -n 15 pnpm exec vitest run src/node/tasks/TasksLedger.integration.test.ts --maxWorkers=3 -t L8`.
  The seed is fixed in the law's `prop` (`fc.assert(..., { seed: 119120, numRuns: 40 })`, line
  991), so no setting is needed. It failed after 1 test, shrunk 1,407 times, with
  `Got error: Schema validation failed` thrown from `Function.make` at
  `src/tasks/TasksLedger.ts:206:59`, the `Msg.cases.request.make({ request })` in `request`.
- The same throw sits at lines 213 (`take`), 220 (`started`), 223 (`finish`) and 230 (`collected`).
- Why it throws: Effect 4.1.3's `Schema.ts` (line 220 to 240) says `make` "throws an `Error` with
  the schema issue in its `cause` when validation fails". Inside `Effect.fn` a throw is a defect.
  The law's `tasks` helper (`TasksTest.ts` line 519) answers with `Effect.result`, which keeps
  only typed failures, so the defect fails the property.
- What changed: commit c203a382d (PR 1619, tea 0.29, every Msg keyed on `_tag`). Before it, each
  call passed a plain object literal, `{ type: "request", request }`, and `call` decoded it with
  `decodeCall` (`Schema.decodeUnknownResult`, line 54), which answers `bad_input` on failure (line
  155). PR 1619 replaced the literals with makers, because a hand-written `_tag` is refused by the
  `fabrika/no-hand-tag` lint rule (`oxlint-plugins/no-hand-tag.ts`). The maker now runs, and
  throws, before `call` can decode.
- Why it merged green: L8 is an integration law (a SQLite file), and since
  [0602](../../../.decisions/0602-integration-laws-leave-merge-line.md) integration laws run only
  in main's full run. The lead's read is right on every point.

## Calls taken

1. **Each call makes its Msg with `makeEffect` and maps the issue to `bad_input`** (90%). This is
   0215's own second line, `Note.makeEffect(fields)`, and the
   [direction note](../../../docs/direction/schema-classes-not-of-helpers.md) "Which one throws".
   Going back to object literals for `call` to decode is refused by `fabrika/no-hand-tag`.
2. **`request` takes its stream id from the made Msg, `msg.request.id`, not from the raw
   argument** (85%). The raw `request.id` is read before any check. After the fix the made value is
   the one decoded, so the id comes from it, as 0215 asks.
3. **`call` keeps its `decodeCall` of both `msg` and `recorded`** (85%). `recorded` still needs it
   (L8's `badRecord` cases reach it), and decoding a made Msg again is cheap and already green in
   L1 to L7. It is the smallest diff for a sev1.
4. **`take` still draws its execution id before it makes the Msg** (85%). `Id.Generator`
   (`src/Id.ts` line 245) is in memory and writes nothing, so a refused take leaves no trace, as on
   main before PR 1619.
5. **The sync decodes of saved rows stay** (85%): `decodeStored`, `decodeEvent`, `decodePointer`
   and `encodePointer` (lines 44 to 52). They read the ledger's own rows, not the caller's input; a
   saved row that does not fit is a storage fault, not `bad_input`. They are part of the
   `schemaSync` sweep under [0576](../../../.decisions/0576-schema-sync-error-result-in-plain-code.md),
   which has its own finding row, `field/findings/2026-11-18-tsconfig-base-lacks-schemasync-error.json`.
6. **The `id` argument of `take`, `started`, `finish` and `collected` is not decoded** (80%). The
   contract types it as a plain `string` with no schema. An unknown or empty id reads an empty
   stream and answers `not_found`, never a throw; the existing `unknown_id` move holds that.
7. **L8b runs where L8 runs, in main's full run only** (75%). A stand-in exists (node:sqlite on
   `:memory:`, as `next/packages/libfabrika/src/node/runtime/RunnerHands.test.ts` runs the hands
   suite), and [0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md) says a
   law that can run on one runs on every pull request. Putting the whole tasks suite on a stand-in
   adds ten laws to every pull request's run and is outside this sev1's scope, so it is one finding
   row below, for its own ticket.
8. **No plan doc row changes** (85%). This is a fix inside P39 slice 1's existing laws; no tier
   row's status or size moves. The plan file is the record.

## How others do it

- **Elm:** a decoder never throws. `Json.Decode.decodeValue : Decoder a -> Value -> Result Error a`
  answers a `Result`, and the program handles the `Err` case
  ([elm/json](https://package.elm-lang.org/packages/elm/json/latest/Json-Decode#decodeValue); from
  memory, not fetched this session).
- **Erlang/OTP:** "let it crash" is for bugs inside the process. Bad input from a caller is checked
  at the boundary and answered as a value, such as `{error, badarg}` from a `gen_server` call, so
  the caller gets a reply, not a dead server
  ([Erlang reference manual, errors](https://www.erlang.org/doc/system/errors.html); from memory,
  not fetched).
- **Effect:** the installed 4.1.3 `Schema.ts` names the pair. `make` (line 240): "Use when
  constructor input is trusted or when validation failure should abort with a thrown `Error`."
  `makeEffect` (line 292) returns `Effect<Type, SchemaIssue.Issue>`, and `make`'s own doc points to
  it "when validation failure should stay in the error channel" (line 238). Read in the installed
  source.
- **The industry:** "parse, don't validate": turn untrusted input into a typed value once, at the
  edge, and fail as a value there (Alexis King, 2019; from memory, not fetched).
- **In this repo:** `next/packages/libfabrika/src/node/build/build.ts` line 661 already does it:
  `Tables.makeEffect({ programs, assets }).pipe(Effect.mapError(fail("table")))`.

## The shape

### TasksLedger.ts, after (a sketch, not compiled)

```ts
import type * as SchemaIssue from "effect/SchemaIssue";

/** A call's field that does not decode is the caller's input (0215): `bad_input`, and no transaction runs. */
const badInput = (cause: SchemaIssue.Issue) => TasksError.make({ reason: "bad_input", cause });

return {
  request: Effect.fn("tasks.request")(function* (request: Request, recorded: Recorded) {
    const msg = yield* Msg.cases.request.makeEffect({ request }).pipe(Effect.mapError(badInput));
    return (yield* call(msg.request.id, msg, recorded)).receipt;
  }),
  take: Effect.fn("tasks.take")(function* (id: string, executor: Executor, recorded: Recorded) {
    const proposed = yield* ids.next(Execution).pipe(/* unchanged */);
    const msg = yield* Msg.cases.take.makeEffect({ executor, execution: proposed }).pipe(Effect.mapError(badInput));
    const { receipt, state } = yield* call(id, msg, recorded);
    // unchanged from here
  }),
  started: /* Msg.cases.start.makeEffect({ execution }) */,
  finish: /* Msg.cases.finish.makeEffect({ execution, result }) */,
  collected: /* Msg.cases.collect.makeEffect({ collection }) */,
  // read, forTarget and forProcess unchanged
};
```

`toMsg` and `toStored` keep `make`: they build from values already decoded (a saved row through
`decodeStored`, a call through `decodeCall`), which is trusted input under 0215. The `layer` doc
comment gains one line: a call's field that does not decode is `bad_input`, before any transaction.
The error type of every call stays `TasksError`; no export is added or removed.

### TasksTest.ts, L8b (a sketch: the tests step shapes it)

```ts
type Move = /* the 25 moves */ | "start_bad" | "finish_bad" | "collect_bad";
// possible(): each of the three is open when any task is saved (`any`).

/** Invalid executions for `started` and `finish`, one per pick. */
export const BAD_EXECUTION: ReadonlyArray<unknown> = ["", 7, null, undefined];

/** Invalid replacements for each field a collection decodes, one per pick. */
export const BAD_COLLECTION: ReadonlyArray<readonly [string, unknown]> = [
  ["process", ""], ["process", "not-a-process"], ["process", MISSING], ["letter", ""], ["letter", MISSING],
];

case "start_bad": {
  const saved = on(["requested", "assigned", "started", "finished", "collected"]);
  // SAFETY: the execution is broken on purpose, so the law sees the store refuse it.
  const execution = choose(BAD_EXECUTION, cell.variant) as string;
  refused(yield* tasks((j) => j.started(saved.request.id, execution, recorded)), "a start whose execution does not decode", "bad_input");
  break;
}
// finish_bad: the same bad execution, with a valid cell.result.
// collect_bad: broken({ process: saved.request.process, letter: `${id}/answer` }, cell.variant, BAD_COLLECTION).

prop(
  "L8b: a start, finish or collect whose execution or collection does not decode is refused bad_input and changes no task",
  open,
  [...LIFE, "collect_ok", "start_bad", "finish_bad", "collect_bad"],
  ["start_bad", "finish_bad", "collect_bad", "take_ok", "reopen"],
);
```

Each move picks a saved task, so `not_found` cannot answer first, and in any phase, so a state
refusal cannot answer first either: the decode comes before the state. The walk's `unchanged`
check after every move holds "changes no task". Adding moves changes no other law's tape: each
`prop` draws only from its own move list.

## One value traced through

A request whose `id` is missing, the `["id", MISSING]` row of `BAD_REQUEST`, in an L8 walk:

1. `badCall` picks `which === 0` and calls `j.request(broken(request, pick, BAD_REQUEST), recorded)`.
2. **On main:** `request.id` is `undefined`; `Msg.cases.request.make({ request })` throws
   `Schema validation failed`. `Effect.fn` turns the throw into a defect. `Effect.result` in the
   law's `tasks` helper does not catch defects, so the fiber dies and fast-check reports the
   property failed. No transaction ran, so nothing was written, but the caller got no answer.
3. **After the fix:** `Msg.cases.request.makeEffect({ request })` fails with a
   `SchemaIssue.Issue` (the missing key). `Effect.mapError(badInput)` makes it
   `TasksError { reason: "bad_input", cause: issue }`. `call` never runs, so no transaction opens.
4. The law's `tasks` helper answers `Failure(TasksError)`. `refused(answer, ..., "bad_input")`
   passes. `unchanged("after bad")` reads every request of the tape: each saved one reads as the
   oracle kept it, and each unsaved one, this one included, reads `not_found`.

## Laws

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| L8: a call with one invalid field is refused and changes no task (unchanged) | test | fc.record: `TasksTest.ts`'s Tape (3 keys, 4 to 6 requests, 12 to 40 cells), seed 119120, 40 runs | main as it is: `request` keeps `Msg.cases.request.make`, red with `Schema validation failed` at `TasksLedger.ts:206`. After build: `take` keeps `make` (red on a `BAD_EXECUTOR` cell); `finish` keeps `make` (red on a `brokenResult` cell) | `next/packages/libfabrika/src/tasks/TasksTest.ts` | main's full run, through `next/packages/libfabrika/src/node/tasks/TasksLedger.integration.test.ts`; the tests and build steps run it by hand |
| L8b: a start, finish or collect whose execution or collection does not decode is refused bad_input and changes no task (new) | test | fc.record: the same Tape, with moves `start_bad`, `finish_bad`, `collect_bad`, seed 119120, 40 runs | main as it is: red, `started` throws on `""`. After build: `collected` keeps `Msg.cases.collect.make` (L8b red, L8 green); `started` keeps `make` (L8b red); `badInput` answers `storage` (L8 and L8b red) | `next/packages/libfabrika/src/tasks/TasksTest.ts` | main's full run, through the same integration file; the tests and build steps run it by hand |
| L1 to L7, J2, G1: the valid calls answer as before (unchanged) | test | fc.record: the same Tape, each law's own moves, seed 119120, 40 runs | After build: `take` makes its Msg with `execution: ""`, so every take is `bad_input` (L2 and L3 red) | `next/packages/libfabrika/src/tasks/TasksTest.ts` | main's full run, through the same integration file |
| A Msg is never a hand-written `_tag` literal, so the fix cannot go back to one | lint | lint | After build: `call(id, { _tag: "start", execution }, recorded)` in `started`: `fabrika/no-hand-tag` fails `pnpm lint` | `oxlint-plugins/no-hand-tag.ts` (unchanged) | `pnpm lint` on every pull request |

No law here is host-only: no launchd, no Electron, no real process or signal. The integration
file is a SQLite file in a temp folder, which the build and tests steps run on their own machine.
L8b is a new law in an existing `.integration.` suite, not a new integration file; why it does not
move to a stand-in now is call 7.

## Files

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `next/packages/libfabrika/src/tasks/TasksTest.ts` | L8b: three moves in `Move` and `possible`, `BAD_EXECUTION` and `BAD_COLLECTION` beside `BAD_EXECUTOR`, three `case`s in the walk, one `prop` after L8. L8 and every other law unchanged | tests | tests | 1 | L8b red at main; L8 red at main |
| `next/packages/libfabrika/src/tasks/TasksLedger.ts` | `badInput`; `request`, `take`, `started`, `finish` and `collected` make their Msg with `makeEffect`; `request` passes `msg.request.id`; one line in the `layer` doc comment; one `SchemaIssue` type import | 15 | build | 1 | 0215; L8, L8b, L1 to L7, J2, G1 |
| `next/packages/libfabrika/src/node/tasks/TasksLedger.integration.test.ts` | Not changed: it runs `TasksTest.suite`, which gains L8b | 0 | tests | none | read only |
| `next/packages/libfabrika/src/node/tasks/TasksLedger.test-support.ts` | Not changed: the store the suite runs on | 0 | tests | none | read only |
| `next/packages/libfabrika/src/tasks/Task.test.ts` | Not changed: its own L8 (line 115) checks the schemas alone and stays green | 0 | tests | none | read only |
| `next/packages/libfabrika/src/node/runtime/RunnerHands.test.ts` | Not changed: read for the `:memory:` runner shape the finding names | 0 | tests | none | read only |
| `oxlint-plugins/no-hand-tag.ts` | Not changed: the lint rule that holds the fix away from a hand-written `_tag` | 0 | tests | none | read only |
| `next/packages/libfabrika/src/tasks/internal/task.ts`, `next/packages/libfabrika/src/tasks/Tasks.ts`, `next/packages/libfabrika/src/tasks/Task.ts` | Not changed: the Msg schema, the contract and `TasksError` keep their shapes | 0 | build | none | read only |

### Commit order

1. The tests step commits L8b and confirms L8 and L8b red at main with the command under
   Validation.
2. The build step commits `TasksLedger.ts`, runs the integration file green, then runs each plant
   in the laws table and records which went red.

## Existing tools

- `badInput` in `next/packages/libfabrika/src/tasks/TasksLedger.ts` (a new function in a file that
  exists). Searched the file and `rg -n "bad_input" next/packages/libfabrika/src/tasks`: `translated`
  (line 109) maps a ledger error, not a schema issue, and the `bad_input` line in `call` (line 155)
  maps a `SchemaError` inline. `badInput` follows `translated`'s shape so each call reads
  `.pipe(Effect.mapError(badInput))`. Searched `rg -n "makeEffect" next/packages/libfabrika/src`:
  `build.ts` line 661 maps the same way with its own `fail`, which is not exported.
- `makeEffect` is Effect's own (Effect 4.1.3, `Schema.ts` line 292), not a new helper.
- `BAD_EXECUTION` and `BAD_COLLECTION` in `TasksTest.ts` are the tests step's, beside the four
  `BAD_*` tables there. The bad collections in `Task.test.ts` (lines 100 to 104) are written inline
  in that law and not exported, so the tests step writes the table in `TasksTest.ts`; it may reuse
  them from there if it chooses.

## Is this a setting?

No new choice is made. The refusal's reason, `bad_input`, is already the contract's
(`Tasks.ts`, `TasksError`'s `reason` doc: "a value that does not decode"). The seed and run count
are the suite's own and do not change.

## Records

- The lead writes the steps' rows in `field/runs/` as usual.
- The fact lost if not written now: PR 1619 turned plain Msg literals into throwing makers in 18
  `next/` product files, and L8 was the only law that caught one, a day later, on main. This plan
  and the finding row below keep that. The sev1 issue closes on the next green full run.
- No glossary row: no new word. `start_bad`, `finish_bad` and `collect_bad` are move names inside
  one test file, named as `start_wrong` and `finish_wrong` are.

## Validation

- Tests and build steps, from `next/packages/libfabrika`:
  `nice -n 15 pnpm exec vitest run src/node/tasks/TasksLedger.integration.test.ts --maxWorkers=3`
  (the whole file: L1 to L8, L8b, J2 and G1). Narrow with `-t L8` while working.
- `pnpm format`, then `pnpm lint`.
- The lead runs the one `pnpm typecheck` at the end.

## Real-run proof

None needed: no window, no host-only law, no launchd entry. The proof is main's next full run going
green, which closes issue 1631.

## What this cannot tell us

- Whether the other 17 product files where PR 1619 added makers
  (`git show c203a382d -- next/` lists them; for example `gateway/Gateway.ts` and
  `processes/QuotasSql.ts`) call one on a caller's value before any decode. I read only the tasks
  module. A throw there would be the same bug, and no law I know of covers it.
- Whether L8b's walk reaches every phase for each move. The `required` list holds that each move
  ran, not each phase.
- What the stand-in runner in the finding would cost a pull request in time. Unmeasured.

## Open questions

None.

## Size

1. One pull request, tests and build: 15 lines of product code in `TasksLedger.ts` and about 60
   test lines in `TasksTest.ts`, sure 85%.

The tests step is about 0.5 agent hours and the build step about 0.3, sure 70%: L8's failing run
took 28 seconds here, and the whole integration file runs a few minutes. Priced from
`field/runs/`: a tests step about $3.5, a build about $1 to $3, a review about $5, and one likely
send-back about $2.

Estimate: 4 steps, $14

## Findings

```json
{"_tag":"finding","id":"2026-11-18-tasks-suite-has-no-stand-in-runner","date":"2026-11-18","by":"plan","model":"claude-opus-5-5","rule":"missing_test","location":{"path":"next/packages/libfabrika/src/node/tasks/TasksLedger.integration.test.ts","line":5},"says":"The tasks suite (L1 to L8, J2, G1 in next/packages/libfabrika/src/tasks/TasksTest.ts) runs only on a SQLite file, so under 0602 none of its laws runs on a pull request, though 0581 says a law that can run on a stand-in runs on every pull request and the hands suite already runs the same way on node:sqlite :memory:.","proof":"`rg -n \"^TasksTest\\.suite\" next` prints only next/packages/libfabrika/src/node/tasks/TasksLedger.integration.test.ts:5. next/packages/libfabrika/src/node/runtime/RunnerHands.test.ts runs HandsTasksTest.suite on node:sqlite :memory: on the merge line, with a reopen that keeps the same database. PR 1619 (c203a382d) merged with L8 broken: at d48ff74 `pnpm exec vitest run src/node/tasks/TasksLedger.integration.test.ts -t L8` fails after 1 test with `Schema validation failed` at TasksLedger.ts:206, and main's full run is red on it (issue 1631).","cost":"A break of any tasks law merges green and shows only on main's full run, as a sev1; this one did.","head":"d48ff74dc373218f22abbead5d04e7b587e7a209","ticket":"kamp-us/tea-fabrika#1178","pr":null}
```

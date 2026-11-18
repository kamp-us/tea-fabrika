Approved by the lead agent, builds the sev1 fix of ticket 1180 (0542, 0036), as the lead (fabrikaa-merger) approved it; body 1681738278b2
Plancheck-Version: 3

```ts
// A sketch: the whole fix is in three integration law files. No product line changes.

// 1. dev-secrets.laws.integration.test.ts, the control edge law. Before (main, since PR 1644):
//    `control` now asks `Dispatcher`, and Reflect.apply's `Effect.Effect<Response, unknown>` hides it.
const checked: Effect.Effect<Response, unknown> = Reflect.apply(control, undefined, [request, env, Redacted.make(bearer), {}]);
// After: a typed call, so tsc sees the requirement, and the law provides the live layer, as brain.ts does.
const checked = control(request, env, Redacted.make(bearer), {}).pipe(Effect.provide(DispatcherLive.layer));
const denied = control(forged, env, Redacted.make(bearer), {}).pipe(Effect.provide(DispatcherLive.layer));

// 2. instance-one-file.integration.test.ts and 3. counter's runner.laws.integration.test.ts.
//    Before (main, since PR 1619): the law sends the counter a Msg keyed on `type`, which no longer
//    names a counter case (decision 0569), so the door answers bad_input and the runner bad_msg.
m: { type },                       input: { type: "inc" },
// After: the counter's own Msg, made by its maker (0562); `fabrika/no-hand-tag` refuses `{ _tag: type }`.
m: CounterMsg.cases[type].make({}), input: CounterMsg.cases.inc.make({}),
```

# Ticket 1180: four next-integration laws go green again, by wiring each to the contract main has now

`next/` only. Ticket 1180, sev1 [issue 1631](https://github.com/kamp-us/tea-fabrika/issues/1631),
branch `fabrikalfa/t1180-integration-after-1644` from origin/main at dcb99bd4d. It changes no product
code, no expected value, no seed, no run count, no timeout and no retry
([0036](../../../.decisions/0036-a-flaky-test-is-fixed.md)), and walks back no decision.

**Said plainly first:** two pull requests each changed a contract, and some integration laws were
not moved with them. Integration laws run only in main's full run
([0602](../../../.decisions/0602-integration-laws-leave-merge-line.md)), so nothing before the merge
saw it.

- **Law A**, the `[secrets]` control edge law: PR 1644 made `control` ask the new `Dispatcher`
  service. The law calls `control` through `Reflect.apply`, typed without services, and never
  provides `DispatcherLive.layer`, so the run dies with "Service not found".
- **Law B**, P16's "p33 complete output and T10 recovery": PR 1619 keyed every Msg on `_tag`
  ([0569](../../../.decisions/0569-tea-msgs-are-keyed-on-tag.md)). The law still sends
  `m: { type }`, the door finds no `_tag`, answers `bad_input`, and `answer.result` is `undefined`.
- **Laws C and D**, two counter runner laws the bisect did not reach: they hand the runner
  `input: { type }` the same way, and the runner answers `refused` with reason `bad_msg`, so the
  count stays 0. Fail-fast hid them on main's run; the lead's no-fail-fast run at dcb99bd4d shows
  them red.

The fix is wiring in three law files, about 20 test lines.

## The full run, and what each red law is

The lead's run of every next-integration law at main dcb99bd4d, four shards with no fail-fast
(https://github.com/kamp-us/tea-fabrika/actions/runs/44416548062), has five red laws in three files.
Everything else in next-integration passed.

| Red law | Error on the run | Cause | Here? |
|---|---|---|---|
| A: dev-secrets "[secrets] the Worker control edge accepts ..." | `expected false to be true`, line 587 | PR 1644's `Dispatcher`, never provided | Yes |
| B: instance-one-file "p33 complete output and T10 recovery ..." | `expected undefined to match object { _tag: 'accepted' }`, line 953 | PR 1619's `_tag` key; the law sends `{ type }` | Yes |
| C: counter runner "plant, skip first letter or patch the wrong base ..." | `expected { count: +0 } to deeply equal { count: 1 }`, line 299 | The same: `input: { type: "inc" }` at line 291 | Yes |
| D: counter runner "L7: the counter keeps its inputs and count across every reopen ..." | `expected { count: +0 } to deeply equal { count: 1 }`, line 523, seed 119120, counterexample `[[0,0]]` | The same: `input: { type }` at lines 512 and 534 | Yes |
| E: instance-one-file "p33 real isolation ..." | `Test timed out in 60000ms`, line 708, in shard 1 of 4 with 38 files | Load in the throwaway layout, as the lead reads it; the code does not show a cause in this ticket (below) | No: the lead files it as a finding row |

C and D were found by this plan's search before the run ended, by reading `Runner.ts`; the run
confirms both, with the error the reading predicted.

## The causes, confirmed in code

### Law A: `Dispatcher` is never provided

- **The law:** "[secrets] the Worker control edge accepts the generated Redacted bearer without
  returning it", in `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts`
  (line 583). `expect(Exit.isSuccess(answer)).toBe(true)` fails at line 587. Leg 3's log names it:
  `AssertionError: expected false to be true`, counterexample
  `{"word":"00aaA000A0aA","pass":"AaAAa0Aa00aA","moves":["ok"]}`.
- **What changed:** PR 1644 (63e05f085) moved the dispatch body into `DispatcherLive.ts` and made
  `control` read it as a service: `const dispatcher = yield* Dispatcher;`
  (`next/packages/libfabrika/src/cloudflare/control.ts` line 140). `brain.ts` (line 338),
  `control.laws.test.ts` (line 201) and `reload.laws.test.ts` (line 1374) got
  `Effect.provide(DispatcherLive.layer)`. This law did not.
- **Why tsc did not catch it:** the law builds both calls with `Reflect.apply(control, undefined,
  [...])` (lines 482 and 492) and names them `Effect.Effect<Response, unknown>`. `Reflect.apply`
  answers `any`, so the third type parameter, the services, defaults to `never` and the requirement
  is gone. The comment at line 468 says `Reflect.apply` was there to keep the law running "on the
  old string signature" during the bearer migration. That migration is done: `control` takes a
  `Redacted.Redacted<string>` (line 115), and the type law at line 541 pins it.
- **Why it dies:** the answer runs with `Effect.runPromiseExit(checked.pipe(Effect.provide(logger)))`
  (line 502), with no `Dispatcher`. Effect 4.1.3's `Context.ts` (line 1688) fails a missing service
  with `Service not found`, a defect, so the Exit is a failure.
- **Why the `denied` call passes:** confirmed. A forged bearer answers `403` at `control.ts` line
  128, before line 140 asks for `Dispatcher`, so `Effect.runPromise(denied)` never reaches the
  missing service. It passes only because of that order, so the fix provides the layer to `denied`
  too: after the typed call, tsc refuses `Effect.runPromise` on an Effect that still needs one.
- **Bisect, the lead's, not repeated:** green at 180b1345a and d524d4e69, red at 63e05f085, in a
  cloud box under Node 26.13.0; CI agrees in https://github.com/kamp-us/tea-fabrika/actions/runs/44415751425
  (green at 180b1345a) and https://github.com/kamp-us/tea-fabrika/actions/runs/44415755034 (red at 63e05f085).

### Law B: the law sends a Msg keyed on `type`

- **The law:** "p33 complete output and T10 recovery: copied file loads programs; resend after
  restart retains placing, stamped ID, inbox and both views", in
  `next/apps/fabrika/src/instance-one-file.integration.test.ts` (line 870). Leg 3's log:
  `Caused by: AssertionError: expected undefined to match object { _tag: 'accepted' }` at line 953,
  counterexample `[["inc"]]`.
- **What changed:** PR 1619 (c203a382d) changed the door's input name in
  `next/apps/fabrika/src/runtime.ts` (lines 80 to 83) from `m.type` to `m._tag`, as 0569 says. In
  `next/packages/libfabrika/src/gateway/Gateway.ts`, `process.send` decodes `m` with
  `options.inputs.schema` (`Schema.Json`, which passes), then asks `options.inputs.name` (line 1449).
  For `{ type: "inc" }` that is `undefined`, so line 1461 sets `refusal ??= "bad_input"`. The answer
  is a JSON-RPC error, so `answer.result` is `undefined`. The product is right; the law is stale.
- **The three sends:** line 948 (`m: { type }`, every message of the walk), line 990 (`m: { type:
  "inc" }`, the resend after the restart) and line 1022 (the raw frame the first start sends and
  never waits for). All three change, or the resend checks a letter the first start never saved.
- **PR 1619 rewrote about 15 integration laws** the same way (for example
  `next/apps/fabrika/src/instance-wire.integration.test.ts`, `m: Tag.cases.inc.make({})`), and
  missed this file. The 1619 diff does not touch it.
- **Bisect, the lead's:** red at 180b1345a (run 44415751425), red at c203a382d = PR 1619
  (https://github.com/kamp-us/tea-fabrika/actions/runs/44416189100), green at its parent 242e01551
  (https://github.com/kamp-us/tea-fabrika/actions/runs/44416193893). Issue 1631's first comment has
  it red since 46437c630, last green 1d5e6d0ad; `git rev-list` puts c203a382d between them. Not
  caused by PR 1644.

### Laws C and D: the counter's runner laws hand the runner a Msg keyed on `type`

- **The laws,** in `next/programs/counter/src/runner.laws.integration.test.ts`:
  - C: "plant, skip first letter or patch the wrong base: wake and every watcher reproduce the
    counter" (line 159) sends `input: { type: "inc" }` twelve times (line 291) and expects the view
    `{ count: n }` after each.
  - D: "L7: the counter keeps its inputs and count across every reopen, recorded as fabrika/counter"
    (line 381) sends `input: { type }` (line 512) and `input: { type: "inc" }` (line 534) and checks
    the count it keeps by hand.
- **Why they fail:** the runner's refusal above. PR 1619 did not touch this file (its stat lists
  `src/node/runner.laws.integration.test.ts` of another package, 2 lines).
- **Lines 45 to 50 of that file** (`type: "whole"` and `type: "patch"`) are the runner's watch
  update shape, the value `Runner.ts` publishes at line 932 (`watches.publish({ type: "whole", ...
  })`). That is a view event, not a tea Msg, and 0569 leaves semantic events on `type`. Not changed.

### Law E: the isolation law's timeout is not this ticket's (80%)

- It passed in about 10.8 s in the lead's two-file runs at 63e05f085 and 180b1345a, and in 14.5 s on
  main's own leg 3 (run 44410508388, log line 6070). It timed out only in a shard running 38 files.
- The one 0569 trace in it: its inline sealed program declares `Schema.Struct({type:
  Schema.Literal('read')})` and the law steps it with `{ type: "read" }` (lines 736 and 828). Read in
  `next/packages/libfabrika/src/runtime/Program.ts`, a step whose Msg has no `_tag` is admitted as
  `invalid` (`fresh`, line 884) and answers `refused` with reason `bad_msg` (line 931). The law's
  `turn` then decodes that answer as `SealedTurn` (a `stepped` case), which fails at once and fails
  the law fast, with a schema error. So that path explains a fast failure, not a 60-second
  timeout, and the law does not fail that way on any run. The code does not show this ticket's
  cause, so no fix is planned, and no timeout changes (0036).
- The doubt, for the lead's finding row: in `outbound` mode the law expects `outbound: "allowed"`,
  which needs the program's fetch to settle after `init`, so the `{ type: "read" }` step should
  run there. That it passes means either the step is not reached or I misread the step path. I did
  not settle which. If the step is reached, the law has a stale Msg too, and its fix is the same
  wiring (a `TaggedStruct("read", {})` in the inline source and a made Msg in the step).

### What is not this ticket's

- **The `ping_ok` lines in leg 3's log** (`DispatchDiscardedError: @demlik/tea: Msg "ping_ok" was
  discarded by stop()`, log lines about 7315 and 8042) are stderr of
  `next/packages/libfabrika/src/client/HandsStart.laws.test.ts`, "H2: after a cut at any journal or
  call boundary and a restart". That file is not an integration law and it passed; the log names it
  as the source of each block. Neither red law prints them. Not changed here.

## Calls taken

1. **Law A calls `control` directly and provides `DispatcherLive.layer` to both calls** (90%). A
   typed call keeps the requirement in the type, so `pnpm typecheck`, which runs on every pull
   request, refuses a call site that forgets the layer. That is the cheap check this law lacked.
   `Reflect.apply` stays nowhere in this law: its reason, the old string signature, is gone, and the
   type law at line 541 already holds the signature. The stale comment at lines 468 and 469 goes.
2. **Law A provides the live layer, not a recorded or fake one** (90%). The law's claim is that the
   real Worker control edge answers `{ value: [] }`; `brain.ts` provides `DispatcherLive.layer` at
   the same edge. A `Recorder` over `Dispatcher` would add a claim the law does not make.
3. **Laws B, C and D send the counter's own Msg, `CounterMsg.cases[type].make({})`** (85%). It is
   the program's own schema (`next/programs/counter/src/program.ts`, `CounterMsg`), so a renamed
   case fails typecheck in the law too. A hand-written `{ _tag: type }` is refused by the
   `fabrika/no-hand-tag` lint rule. The other way, a local `Tag` union as PR 1619 wrote in
   `instance-wire.integration.test.ts`, works as well; the program's own schema is chosen because
   this law is about the counter, and four fabrika laws already import `@kampus/counter`. In C and D
   it comes from the same `import("./program.ts")` each law already makes for `counter`.
4. **This is wiring, not loosening** (90%). Under 0569 a counter Msg is `{ _tag: "inc" }`;
   `{ type: "inc" }` is no counter input at all. The laws were meant to send real presses and now
   send none, so they fail before reaching what they check. Every `expect`, title, seed, run count
   and generator stays. The door's and the runner's refusal of the old key is not lost: it is held
   by `next/packages/libfabrika/src/runtime/MsgKey.test.ts` (line 139) and
   `next/packages/libfabrika/src/runtime/MsgKey.types.test.ts` (line 107), which this pull request
   does not touch.
5. **The fix is the tests step's, in three exam files; the build step writes nothing** (85%). Each
   change is a law's own wiring. The lead skill says a test-only fix still runs every step, so the
   build step runs, confirms no product line is needed, and runs the plants.
6. **Of run 44416548062's five red laws, the four whose cause is one of the two contract changes are
   in this pull request, and law E is not** (80%): a `type`-keyed Msg (0569) or a missing
   `Dispatcher` (PR 1644) in a law's wiring is this ticket; a timeout under load is a different fix,
   and this pull request should land whole and fast as the sev1 fix. The lead files law E as a
   finding row; its section above gives what the code shows for it.
7. **No plan doc row changes** (85%). This repairs existing laws; no tier row's status or size
   moves. The plan file is the record.
8. **`brain.ts` is not touched** (95%). The cause is not there: it already provides
   `DispatcherLive.layer` (line 338). Open PR 1458 owns it.

## How others do it

- **Elm:** a message is one value of one union type, and the compiler checks every send against it.
  There is no way to send a record the update cannot match
  ([Elm guide, types](https://guide.elm-lang.org/types/custom_types.html); from memory, not fetched
  this session). Making the law's Msg with the program's own maker is the closest we get.
- **Erlang/OTP:** `gen_server:call` sends any term, and a clause that matches none crashes or, in a
  careful server, answers `{error, badarg}`. The fix after a protocol change is to change the
  callers, not to widen the match (from memory, not fetched).
- **Effect:** a service a function needs is part of its type, `Effect<A, E, R>`, and `runPromise`
  accepts only `R = never`. Erasing `R` through `any` (here `Reflect.apply`) turns a compile error
  into a runtime "Service not found" (Effect 4.1.3, `Context.ts` line 1688, read in the installed
  source). Effect's guide says to provide a layer at the edge; `brain.ts` does that at the real edge.
- **In this repo:** PR 1619 rewrote its sibling laws with a maker
  (`instance-wire.integration.test.ts`, `worker-supervision.integration.test.ts` line 267:
  `m: Tag.cases[type].make({})`), and PR 1644 provided `DispatcherLive.layer` at each other
  `control` call. This plan does the same for the four laws they missed.

## The shape

### dev-secrets.laws.integration.test.ts, after (a sketch)

```ts
import * as DispatcherLive from "../../cloudflare/DispatcherLive.ts";

// (the Reflect.apply comment goes)
const checked = control(request, env, Redacted.make(bearer), {}).pipe(Effect.provide(DispatcherLive.layer));

const forged = request.clone();
forged.headers.set("authorization", `Bearer wrong-${sample.pass}`);

const denied = control(forged, env, Redacted.make(bearer), {}).pipe(Effect.provide(DispatcherLive.layer));

expect((await Effect.runPromise(denied)).status).toBe(403); // unchanged
const answer = await Effect.runPromiseExit(checked.pipe(Effect.provide(logger))); // unchanged
```

`checked` is now `Effect<Response, null>`: `control`'s only typed failure is the body read's
`catch: () => null`. `answer` is an `Exit<Response, null>`, and the law reads it as before. The
import is relative, as the file already imports `../../cloudflare/control.ts`, so no layer rule
changes.

### instance-one-file.integration.test.ts, after (a sketch)

```ts
import { CounterMsg } from "@kampus/counter";

m: CounterMsg.cases[type].make({}),   // line 948; `type` is "inc" | "dec" | "reset" from the generator
m: CounterMsg.cases.inc.make({}),     // line 990, the resend
m: CounterMsg.cases.inc.make({}),     // line 1022, the raw frame the first start never waits for
```

`total` still reads `type`, the generator's string, so the count oracle is unchanged.
`Formatter.formatJson` writes the made value as `{"_tag":"inc"}`.

### counter's runner.laws.integration.test.ts, after (a sketch)

```ts
const { counter, CounterMsg } = yield* Effect.promise(() => import("./program.ts")); // law C, line 161
input: CounterMsg.cases.inc.make({}),                                              // line 291

const { counter, CounterMsg } = yield* promised(() => import("./program.ts"));       // law D, line 383
input: CounterMsg.cases[type].make({}),                                             // line 512
input: CounterMsg.cases.inc.make({}),                                               // line 534
```

## One value traced through

Law B's shrunk counterexample, `messages = ["inc"]`, first start:

1. **On main:** the law sends `process.send` with `m: { type: "inc" }`. `Gateway.ts` decodes the
   params with `Send` (line 1440), and `m` with `Schema.Json` (line 1444), both fine.
   `options.inputs.name` (`runtime.ts` line 80) finds no `_tag`, so `name` is `undefined` and line
   1461 sets the refusal `bad_input`. The client gets `{ error: { ..., reason: "bad_input" } }`, no
   `result`, and line 953's `toMatchObject({ _tag: "accepted" })` sees `undefined`. Red.
2. **After the fix:** the law sends `m: { _tag: "inc" }`, made by `CounterMsg.cases.inc.make({})`.
   `name` is `"inc"`, the port exists, the brain accepts and places it, and the answer is
   `{ _tag: "accepted", ... }`. `total` becomes 1.
3. The law then reads the inbox (one `p16-0` letter, a minted input ID), opens both views at
   `{ count: 1 }`, sends the raw `unanswered` frame with `{ _tag: "inc" }`, and closes.
4. **Second start:** the walk resends `p16-0`; its answer equals `first`, and the stamped input is
   the same. The resend of `unanswered` is accepted and found once in the inbox, and both views read
   `{ count: 2 }`, which is `total + 1`. Every check is the one the law had.

Law A, sample `{ word, pass, moves: ["ok"] }`: on main `checked` runs `control`, which passes the
bearer check, decodes the body, and dies at `yield* Dispatcher` with "Service not found";
`Exit.isSuccess(answer)` is false. After the fix the live dispatcher calls the Project stub's
`info`, which answers `[]`, so the response is `200` with `{ value: [] }`, and `clean(outputs, words)`
then checks that no secret reached any output.

## Laws

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| A: "[secrets] the Worker control edge accepts the generated Redacted bearer without returning it" (unchanged expectations) | test | fc.record: the file's `generated` (word and pass 12 to 24 letters or digits, 1 to 6 moves), seed 119120, 3 runs fast and 10 runs full | Main as it is (red: `expected false to be true` at line 587). After build: `checked` keeps `Reflect.apply` with no provide (red, the same line) | `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | Main's full run; the tests and build steps run it here, and the lead's throwaway run at the branch head |
| A-type: every `control` call in law A carries `Dispatcher` in its type, so a missing layer cannot run (new hold, no new `it`) | type | type | After build: drop `Effect.provide(DispatcherLive.layer)` from `denied`: `pnpm typecheck` fails at `Effect.runPromise(denied)` (`Dispatcher` is not assignable to `never`) | `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | `pnpm typecheck` on every pull request |
| The `[secrets]` generated flows law in the same file (unchanged, it shares `flow`) | test | fc.record: the same `generated`, seed 119120, 3 runs fast and 15 runs full | After build: `flow` pushes the bearer into `outputs.logs` (red at `clean`), which shows the shared `flow` still reaches every output after the wiring change | `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | Main's full run; the tests step runs it with law A |
| B: "p33 complete output and T10 recovery: ..." (unchanged expectations) | test | fc.array: `fc.constantFrom("inc", "dec", "reset")`, 1 to 4 items, seed 119120, 2 runs | Main as it is (red: `expected undefined to match object { _tag: 'accepted' }`). After build: line 948 back to `m: { type }` (red, the same); line 990 sends `CounterMsg.cases.dec.make({})` (red: the resend of `unanswered` is a changed letter, not `accepted`) | `next/apps/fabrika/src/instance-one-file.integration.test.ts` | Main's full run and the lead's throwaway run; the local config refuses it here (it starts workerd) |
| C: "plant, skip first letter or patch the wrong base: wake and every watcher reproduce the counter" (unchanged expectations) | test | scenario: twelve `inc` letters, a second runner at letter 5, then the wake and its plants as the title names | Main as it is (red on run 44416548062: `expected { count: +0 } to deeply equal { count: 1 }` at line 299). After build: line 291 back to `{ type: "inc" }` (red) | `next/programs/counter/src/runner.laws.integration.test.ts` | Main's full run; the tests step runs it here if the host guard allows, else the lead's throwaway run |
| D: "L7: the counter keeps its inputs and count across every reopen, recorded as fabrika/counter" (unchanged expectations) | test | fc.array: `fc.nat()`, 2 to 24 items, seed 119120, 3 runs fast and 20 runs full | Main as it is (red on run 44416548062 at line 523, counterexample `[[0,0]]`). After build: line 512 sends `CounterMsg.cases.inc.make({})` for every cell (red: the hand count disagrees on a `dec` or `reset` cell) | `next/programs/counter/src/runner.laws.integration.test.ts` | As law C |
| A Msg in these laws is never a hand-written `_tag` literal | lint | lint | After build: `m: { _tag: type }` at line 948: `fabrika/no-hand-tag` fails `pnpm lint` | `oxlint-plugins/no-hand-tag.ts` (unchanged) | `pnpm lint` on every pull request |

No law here is host-only in 0178's sense: no launchd, no Electron, no signal. Law B starts a real
workerd child, which the local config's host guard refuses (`vitest.config.ts`, the
`fabrika-local-host-only` plugin), so it runs on disposable Linux CI under
[0594](../../../.decisions/0594-safe-checks-direct-mac-ci.md), never on the owner's laptop. These are
existing `.integration.` laws; no new integration file is added, so 0581's stand-in question does
not arise.

### The loosening check

`loosening.sh origin/main <head> <mapping>` will report one `unrecognized change` per changed file,
because each law's body and imports change. No title changes, so the PR's mapping table (columns
`Removed` and `Replacement`) has no rows. No `removed expect`, `removed law`, `fewer numRuns` or
`tighter bound` hit should appear; if one does, the build step stops. The pull request says, for the
lead's hand check of each hit:

- dev-secrets: the call is typed and gets the live `Dispatcher` that `control` asks for since PR
  1644; the `denied` call gets it too, for the type. Every expect is unchanged.
- instance-one-file and counter's runner laws: the Msg is the counter's own, keyed on `_tag` since
  PR 1619 (0569). `{ type }` is no counter input, so these laws sent nothing they could check. The
  old key's refusal stays held in `MsgKey.test.ts` and `MsgKey.types.test.ts`.

## Search results: what else in next/ has the same holes

Run on dcb99bd4d. Fixed here only what is red on run 44416548062.

| File | What was found | Red? | Here? | Owner |
|---|---|---|---|---|
| `next/apps/fabrika/src/instance-one-file.integration.test.ts` | Lines 736 and 828, "p33 real isolation": an inline sealed program declares `Schema.Struct({type: Schema.Literal('read')})` and the law steps it with `{ type: "read" }` | It passed at 0dc333d73 (leg 3, log line 6070, 14457 ms); its one red, a timeout on run 44416548062, is law E above | No | tests |
| `next/packages/libfabrika/src/cloudflare/readers.laws.test.ts` | Lines 272 and 285: `parserControl` calls `control` through `Reflect.apply` with no services in its type; its `legacy` call passes a plain string token, which always answers 403, so it is dead | No: a plain law on every pull request, green; its callers provide a recorded `Dispatcher` (line 574) | No: it is in the finding row | tests |
| `next/apps/fabrika/src/door.integration.test.ts` | Line 963: `Reflect.apply(connectionLayer, ...)` typed `ReturnType<typeof connectionLayer>`, so its services stay in the type; PR 1644 provides `WaitsLive.layer` (the next line) | No, by reading; the full run says | No | tests |
| `next/apps/fabrika/src/runtime.decode.test.ts` | Line 82: `Reflect.apply(door, ...)` names its service, `RecordedStart`, and provides it | No | No | tests |
| `next/packages/libfabrika/src/cloudflare/platform.test.ts` | Line 369: `Reflect.apply` on a client member chosen at run time; the clients need no service | No | No | tests |
| `fixtures/next/port-home/` | `"type":"inc"` cells kept on purpose as an old home (PR 1619's body says why) | No | No | tests |

`rg -n "(input\|m\|msg\|message):\s*\{\s*type\b" next` prints only the six sends this plan fixes.
`rg -n "Reflect\.apply\(control" next` prints the two in `readers.laws.test.ts` and the two this
plan removes.

## Files

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | Import `DispatcherLive`; `checked` and `denied` call `control` directly and provide `DispatcherLive.layer`; the stale `Reflect.apply` comment goes. No expect changes | tests | tests | 1 | Law A green; A-type plant fails typecheck |
| `next/apps/fabrika/src/instance-one-file.integration.test.ts` | Import `CounterMsg` from `@kampus/counter`; lines 948, 990 and 1022 send `CounterMsg.cases[...].make({})`. No expect changes | tests | tests | 1 | Law B green on the lead's throwaway run |
| `next/programs/counter/src/runner.laws.integration.test.ts` | Laws C and D take `CounterMsg` from their existing `import("./program.ts")`; lines 291, 512 and 534 send it. No expect changes | tests | tests | 1 | Laws C and D green |
| `next/packages/libfabrika/src/cloudflare/control.ts`, `next/packages/libfabrika/src/cloudflare/Dispatcher.ts`, `next/packages/libfabrika/src/cloudflare/DispatcherLive.ts` | Not changed: the contract law A now meets | 0 | build | none | read only |
| `next/apps/fabrika/src/runtime.ts`, `next/packages/libfabrika/src/gateway/Gateway.ts`, `next/packages/libfabrika/src/runtime/Runner.ts` | Not changed: the door and runner refuse a Msg with no `_tag`, as 0569 says | 0 | build | none | read only |
| `next/programs/counter/src/program.ts` | Not changed: `CounterMsg` is exported already | 0 | build | none | read only |
| `next/apps/fabrika/src/brain.ts` | Not changed: already provides `DispatcherLive.layer`; open PR 1458 owns it | 0 | build | none | read only |
| `next/packages/libfabrika/src/cloudflare/readers.laws.test.ts`, `next/packages/libfabrika/src/cloudflare/control.laws.test.ts`, `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts` | Not changed: the other `control` callers, green | 0 | tests | none | read only |
| `next/apps/fabrika/src/door.integration.test.ts`, `next/apps/fabrika/src/runtime.decode.test.ts`, `next/packages/libfabrika/src/cloudflare/platform.test.ts` | Not changed: searched for `Reflect.apply` holes, none red | 0 | tests | none | read only |
| `next/apps/fabrika/src/instance-wire.integration.test.ts`, `next/apps/fabrika/src/worker-supervision.integration.test.ts` | Not changed: PR 1619's maker shape, the precedent | 0 | tests | none | read only |
| `next/packages/libfabrika/src/runtime/MsgKey.test.ts`, `next/packages/libfabrika/src/runtime/MsgKey.types.test.ts` | Not changed: they hold the old key's refusal | 0 | tests | none | read only |
| `next/packages/libfabrika/src/client/HandsStart.laws.test.ts` | Not changed: the source of the `ping_ok` stderr in leg 3, not this ticket's | 0 | tests | none | read only |
| `oxlint-plugins/no-hand-tag.ts` | Not changed: the lint rule that keeps the Msg made by a maker | 0 | tests | none | read only |
| `.agents/skills/lead/scripts/loosening.sh` | Not changed: the lead runs it on the range | 0 | tests | none | read only |
| `next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts` | Not changed: another user of the `Tag.cases[type].make({})` shape | 0 | tests | none | read only |
| `vitest.config.ts` | Not changed: its host guard refuses law B locally | 0 | tests | none | read only |
| `fixtures/next/port-home` | Not changed: an old home kept with `"type"` cells on purpose | 0 | tests | none | read only |
| `.oxlintrc.json`, `patches/`, `pnpm-lock.yaml` | Not changed: open PR 1648 owns them | 0 | tests | none | read only |

Nothing here touches `.oxlintrc.json`, `patches/` or `pnpm-lock.yaml` (PR 1648), transport hello
(PR 1638) or `next/packages/libfabrika/src/node/repositories` (the mock PR).

### Commit order

1. The tests step commits the three files in one commit, runs law A, and C and D if the host guard
   allows, green; then runs the plants for A, A-type, C and D and records which went red.
2. The build step changes nothing, runs `pnpm lint` and the narrow paths again, and reports.
3. The lead runs the one `pnpm typecheck`, then the throwaway proof run below, then the review.

## Existing tools

- No new helper, function or file. `DispatcherLive.layer` (`next/packages/libfabrika/src/cloudflare/DispatcherLive.ts`
  line 202) and `CounterMsg` (`next/programs/counter/src/program.ts` line 11) exist and are
  exported. Searched `rg -n "DispatcherLive" next` (four users) and `rg -n "@kampus/counter" next/apps/fabrika`
  (four fabrika laws import it already).
- The maker shape is the one PR 1619 used: searched `rg -n "Tag\.cases\[type\]\.make" next`, which
  finds `worker-supervision.integration.test.ts` line 267 and
  `next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts` line 439.

## Is this a setting?

No new choice is made. The Msg key is decided (0569), and the layer the edge needs is the one live
member of `Dispatcher` (`Dispatcher.ts` doc: "`DispatcherLive.layer` is the one live member").

## Records

- The lead writes the steps' rows in `field/runs/` as usual, and files the finding row below.
- The fact lost if not written now: two merged contract changes left four integration laws red, and
  fail-fast on main's run hid three of them behind one another, so the sev1 issue named only part of
  the cost. The `Reflect.apply` comment told readers the old signature still mattered after it was
  gone. This plan and the finding row keep both.
- No glossary row: no new word.
- Issue 1631 closes on the next green full run.

## Validation

- Tests and build steps, with Node 26.13.0 first on `PATH`, from `next/packages/libfabrika`:
  `nice -n 15 pnpm exec vitest run src/node/dev/dev-secrets.laws.integration.test.ts --maxWorkers=3`.
- From `next/programs/counter`:
  `nice -n 15 pnpm exec vitest run src/runner.laws.integration.test.ts --maxWorkers=3`. If the host
  guard refuses it, say so; the lead's run covers it.
- Law B is not run here: the host guard refuses it.
- `pnpm format`, then `pnpm lint`.
- The lead runs the one `pnpm typecheck` at the end, which also proves the A-type plant.

## Real-run proof

PR CI and a branch's proof run never start an `.integration.` law (0602). So the lead proves all
four laws as in the bisect: a throwaway push-triggered workflow at the branch head that runs
`dev-secrets.laws.integration.test.ts`, `instance-one-file.integration.test.ts` and
`next/programs/counter/src/runner.laws.integration.test.ts` on disposable Linux CI, with no
fail-fast, and records the run URL in the pull request. Main's next full run going green closes
issue 1631. No window changes, so no screenshots.

## What this cannot tell us

- **Why "p33 real isolation" passes** while its sealed program steps `{ type: "read" }`, and why
  it timed out once. Law E's section says what the code shows and what it does not.
- **Whether the e2e laws are red.** Run 44416548062 ran next-integration only; the e2e legs were
  cancelled on main's run and are not covered here.
- **Whether a lint rule on `Reflect.apply` would cost more than it saves.** 0554 leaves
  `Reflect.apply` undecided; the finding names it for the owner, not this plan.

## Open questions

None.

## Size

1. One pull request, slice 1, tests step only: 0 product lines and about 20 test lines in three
   files, sure 85%.

The tests step is about 0.3 agent hours, the build step about 0.1, sure 75%. Priced from
`field/runs/2026-11-18-t1178-*.json`: a tests step about $1.3, a build step about $0.5, a review
about $2, and one likely send-back about $1.

Estimate: 4 steps, $5

## Findings

```json
{"_tag":"finding","id":"2026-11-18-reflect-apply-hides-a-required-service","date":"2026-11-18","by":"plan","model":"claude-opus-5-5","rule":"missing_test","location":{"path":"next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts","line":482},"says":"An integration law calls control through Reflect.apply typed Effect.Effect<Response, unknown>, which erases its services, so PR 1644 made control require Dispatcher and pnpm typecheck passed while the law died at run time; under 0602 the law runs only on main, where fail-fast hid it behind another red law, and the same erased call shape sits in readers.laws.test.ts lines 272 and 285. A cheap check would have caught it on the pull request: call a function with a known signature directly in a law, and keep Reflect.apply for a member picked at run time (0554 leaves Reflect.apply undecided).","proof":"`rg -n \"Reflect\\.apply\\(control\" next` prints 4 lines (dev-secrets 482 and 492, readers 272 and 285). Main's full run https://github.com/kamp-us/tea-fabrika/actions/runs/44410508388 leg 3 fails the law at line 587 (expected false to be true); https://github.com/kamp-us/tea-fabrika/actions/runs/44415751425 at 180b1345a passes it and https://github.com/kamp-us/tea-fabrika/actions/runs/44415755034 at 63e05f085 (PR 1644) fails it. control.ts line 140 reads `yield* Dispatcher`; the law provides only `logger` at line 502.","cost":"Any service a later change adds to control, or to another function a law calls through Reflect.apply, merges green and shows only on main's full run as a sev1.","head":"dcb99bd4dbd59afbe94f04495b26a6614b65cc33","ticket":"kamp-us/tea-fabrika#1180","pr":null}
```

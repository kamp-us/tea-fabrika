
Plancheck-Version: 3

# Plan: the mock sweep in `libfabrika/src/node/client`, in next/ (ticket 1067)

This is `next/` only. Today's app is not touched. It is one later slice of the Recorder plan
([`recorder-PLAN.md`](./recorder-PLAN.md), "Size", the row `libfabrika/src/node/client`), and it
builds [0555](../../../.decisions/0555-no-vi-mock-or-domock.md) and
[0579](../../../.decisions/0579-property-laws-use-it-prop.md).

```ts
// The whole idea, a sketch, not compiled. Before: the S2 law patches the process's globals.
vi.spyOn(console, "warn").mockImplementation((...args) => void out.logs.push(args));
vi.spyOn(process.stderr, "write").mockImplementation((chunk) => out.logs.push(String(chunk)) > 0);

// After: the one writer on this path that went around Effect, tea's default error sink, is given
// a sink by the start, which logs through Effect. The law reads Effect's Logger, as it already
// does, and Effect's Console service, which it provides.
return yield* run(handsMachine, { interpret, subscribe, onError: report }); // HandsStart.ts
yield* walk(f, out, secrets, done).pipe(Effect.provide(logger), Effect.provideService(Console.Console, console));
```

## Doubts, read these first

- **A real trigger for a tea error with no caller, in a law on stand-ins (70%).** Law H1 needs one
  error that reaches tea's sink from a hands start. The lean is a Sub failure: the door's
  `Socket.WebSocketConstructor` dies on one dial, so the `socket` Sub's stream fails with an error
  no Msg maps, which tea reports under `phase: "sub"`. Whether `internal/dial.ts` lets that defect
  out of its stream, or turns it into a `socket_failure` Msg, is not read to the end. What settles
  it: the tests step's first red run of H1. If dial maps every failure, the tests step uses the next
  phase tea reports for this start (`"boot"`, or a discard notice from a Cmd that answers after
  stop) and says which in its report.
- **What the S2 law loses (certain, and named).** The spies were a net: they caught any write to
  `console` or to the process's own output, by any code on the path, ours or a package's. After
  this slice the law sees what goes through Effect: its Logger and its `Console` service. A package
  that calls `console.warn` itself is no longer seen. On this path that was tea alone (read below),
  and giving tea a sink closes the one door tea writes through on this start. A direct write in our
  own code is held by Effect's checks `globalConsole` and `globalConsoleInEffect` once they are
  locked for these folders ([0565](../../../.decisions/0565-effects-own-checks-block.md)); they are
  not locked here yet, which "What this cannot tell us" repeats.

## What changes, in one paragraph

The folder has three `vi.spyOn` calls on main and no `vi.fn` or `toHaveBeenCalled*` (counted again
below). All three sit in one law, S2 in
`next/packages/libfabrika/src/node/client/HandsSecrets.laws.test.ts:393-406`: a net that turns every
write to `console` (five methods) and to `process.stdout` and `process.stderr` into a log line the
law scans for the hands key's private half. The product change comes first: the hands start
(`next/packages/libfabrika/src/client/HandsStart.ts`) gives tea's `run` an `onError`, so tea's
errors with no caller become Effect log lines in the start's own context, never a `console.warn`
or a rethrow on a timer. The app's hands entry (`next/apps/fabrika/hands.ts`) then ends the
process through Effect when the run fails, as tea's default sink ended it before. The law drops the
spies and provides an in-memory `Console` beside the Logger it already has. The folder then joins
the lint rule that refuses `vi.mock`, `vi.doMock`, `vi.spyOn` and `vi.stubEnv`.

## The count, on main

Counted at `f7169af` with `nice -n 19 rg -n "vi\.fn|toHaveBeenCalled|vi\.spyOn|vi\.mock|vi\.doMock|vi\.stub"`
over `next/packages/libfabrika/src/node/client/`, one match per call.

| Call | Where | What it watches | What replaces it |
|---|---|---|---|
| `vi.spyOn(console, method)`, one call site run for `log`, `info`, `warn`, `error`, `debug` | `HandsSecrets.laws.test.ts:396` | any `console` write on the S2 walk; on this path, tea's default sink (`console.warn` of a `RuntimeDiscardNotice`) | the start gives tea a sink that logs through Effect, and the law provides an in-memory `Console.Console` and reads it |
| `vi.spyOn(process.stdout, "write")` | `HandsSecrets.laws.test.ts:398` | raw writes to the process's output | nothing on the path writes there (read below); Effect's own loggers write through `Console`, which the law provides |
| `vi.spyOn(process.stderr, "write")` | `HandsSecrets.laws.test.ts:399` | raw writes to the process's error output | the same |

`vi.fn`: 0. `toHaveBeenCalled*`: 0. `vi.mock`, `vi.doMock`, `vi.stubEnv`: 0. That matches the
Recorder plan's row (3 spies: `console` 1, `process.stdout` and `process.stderr` 2).

**Who writes outside Effect on the S2 path, read on main.** `rg` for `console.` and
`process.(stdout|stderr)` over `libfabrika/src/client/`, `src/node/client/` and `src/transport/`
outside tests finds one hit, `JournalSqlite.child.test-support.ts:37`, a child process's own
`ready` line that S2 never starts. The installed tea is 0.25.0
(`next/packages/libfabrika/node_modules/@demlik/tea/package.json`). Its default sink
(`dist/chunk-4HXVP2GW.js`, `defaultOnError`) calls `console.warn(error)` for a
`RuntimeDiscardNotice` and rethrows anything else in a `setTimeout`. Its other `console.warn` calls
are a listener that throws, an agent's `onToolError` hook, and `fromTransport`; S2's start uses
none. Effect 4.1.3's loggers write through the `Console` reference
(`effect/src/Logger.ts`, `withConsoleLog`: `fiber.getRef(effect.ConsoleRef)`), so a logger that
the law did not replace still lands in the `Console` the law provides.

## How others do it

- **Effect's way to watch console output** is the `Console` service with a test implementation:
  `effect/testing`'s `TestConsole` (installed 4.1.3, `src/testing/TestConsole.ts`) provides
  `Console.Console` and keeps one `{ method, parameters }` entry per call. Its readers are only
  `logLines` and `errorLines`; `warn`, `info` and `debug` are kept but cannot be read. So the law
  provides its own small `Console` that pushes every method's arguments, built the way `TestConsole`
  builds its own (`Layer.effect(Console.Console)`), rather than lose `warn`, which is exactly tea's
  method. The Recorder cannot stand in here: `Console`'s members are plain functions that return
  `void`, and the Recorder watches only effectful members (recorder-PLAN, "The shape").
- **Effect's way to see a log line** is a `Logger` the test provides, which S2 already does
  (`Logger.layer([Logger.map(Logger.formatStructured, ...)])`).
- **tea's own answer for a host:** pass `onError`. Its `run` docs (`dist/run-BnmmC-zC.d.ts`, the
  Effect engine's `run`) say a sink "should be total", and that with no `onError` the default sink
  "rethrows the failure and ends the process", while with one, `done()` fails with `SubFailed` (or
  the defect of a reducer throw). Experiment 98 (`experiments/98-tea-host-package.md`) filled
  `onError` in its host too, turning a failure with no caller into a host event.
- **Erlang/OTP:** a process whose work fails exits, and its parent sees the exit
  ("let it crash"). Today the hands process ends on such a failure, through tea's rethrow. The plan
  keeps that, through Effect: `NodeRuntime.runMain` ends the process with a failing exit code when
  the main Effect fails, after the scope's finalizers run.

## The shape

A sketch, not compiled. Names are effect 4.1.3's and tea 0.25.0's.

```ts
// next/packages/libfabrika/src/client/HandsStart.ts, inside `start`, before `run`
import { RuntimeDiscardNotice } from "@demlik/tea";
import { Context, Effect } from "effect";

const context = yield* Effect.context<never>();
// tea calls this with no caller to answer: it must not throw (tea's docs: "should be total").
const report = (error: unknown, at: { readonly phase: string }): void =>
  Effect.runSyncWith(context)(
    (error instanceof RuntimeDiscardNotice
      ? Effect.logWarning("tea discarded a run's late work", error)
      : Effect.logError("tea reported a failure with no caller", error)
    ).pipe(Effect.annotateLogs({ phase: at.phase })),
  );

return yield* run(handsMachine, { interpret: { /* as today */ }, subscribe: { /* as today */ }, onError: report });
```

- **Levels:** a discard notice is a warning, as tea's own `console.warn` made it; anything else is
  an error. 85%: tea's own split, one to one.
- **Synchronous:** `runSyncWith`, so the line is written before tea goes on, as `console.warn` was.
  A logger that suspends would make it throw; the start's loggers do not. 80%; the build checks
  that `runSyncWith` is the 4.1.3 name (`effect/src/Effect.ts:18987`).
- **`phase`** is a log annotation, the short word tea uses.
- **The error value goes to the logger as is.** S2 is what holds that no key reaches a log line,
  now through this sink too: a `JournalError` or `SubFailed` carries no key today.

```ts
// next/apps/fabrika/hands.ts: the line printer runs until the run fails, then the process ends
const runtime = yield* booting.ready;
yield* Effect.raceFirst(printLines(runtime), runtime.done().pipe(Effect.andThen(Effect.never)));
// `done()` waits while the run is alive (tea: "a stop() with no failure leaves this waiting").
// A SubFailed, or a reducer's defect, fails the race, so runMain ends the process, failing.
```

```ts
// HandsSecrets.laws.test.ts, S2: the spies go, an in-memory Console comes in (a sketch)
const push = (...args: ReadonlyArray<unknown>): void => void out.logs.push(args);
// Every member of Effect's Console interface pushes its args, as TestConsole.make writes its own;
// the tests step lists the members from the installed effect/src/Console.ts.
const console: Console.Console = { log: push, info: push, warn: push, error: push, debug: push, trace: push /* , ... */ };

yield* walk(f, out, secrets, done).pipe(
  Effect.withTracer(tracer),
  Effect.provide(logger),
  Effect.provideService(Console.Console, console),
  Effect.provideService(References.MinimumLogLevel, "All"),
  Effect.provide(TestClock.layer()),
);
```

The test `Console` is a test layer of Effect's own service, written once in the law file. If a
second law in `next/` needs every method readable, it moves to `@kampus/vitest` beside the Recorder
([0538](../../../.decisions/0538-kampus-vitest-holds-the-test-primitives.md)); one user does not
make it shared. 80%.

## One value traced: a discard notice

1. The S2 walk ends a process while a `journal_write` Cmd is in flight. tea interrupts the handler
   and, when its answer has nowhere to go, raises a `RuntimeDiscardNotice` with no caller.
2. tea calls the start's `report(notice, { phase })`. Before: `console.warn(notice)`, caught by the
   spy. After: `Effect.logWarning(...)` runs in the start's context, annotated with `phase`.
3. The law's Logger gets the entry and pushes it into `out.logs`, as every other log line.
4. The law scans `out.logs` for each private half in base64url, base64 and hex, as today. A line
   that held one fails S2 with the line's first 400 characters, as today.
5. Nothing reaches `console` or the process's output, and the law no longer patches either.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| S2 (rewritten). The private half is in no frame, span, log line, `Console` call, error, journal row or state, over the same generated flows, with the spies gone and the in-memory `Console` read beside the Logger; every output the old law scanned is still scanned, and the `done` coverage list is unchanged | test | fc.record: the file's `Flow`, as today, 100 runs | the three plants the file names (the hello carries `d`; a span attribute holds the JWK; an error message holds the JWK text) stay red, and one more: `HandsStart.ts` writes the key's JWK with `Console.log`, which only the new `Console` read catches | next/packages/libfabrika/src/node/client/HandsSecrets.laws.test.ts |
| H1. A tea failure with no caller on a hands start becomes one Effect log line, at error (warning for a discard notice), annotated with its `phase`, and nothing reaches `Console` | test | scenario: one tea failure per phase this start can reach, at most three, which no generator draws (see the doubt) | drop `onError` from `run`: no log line, and tea's rethrow fails the run as an unhandled error | next/packages/libfabrika/src/client/HandsStart.laws.test.ts |
| H2. After that failure, the run's `done()` fails with it (`SubFailed` for a Sub), which is what `hands.ts` races | test | scenario: the same trigger as H1 | the `socket` Sub ends its stream quietly on any failure (`Stream.catchCause(() => Stream.empty)`): `done()` keeps waiting, H2 red at its timeout | next/packages/libfabrika/src/client/HandsStart.laws.test.ts |
| N1. A `vi.spyOn`, `vi.mock`, `vi.doMock` or `vi.stubEnv` in a test under `next/packages/libfabrika/src/node/client/` fails lint with 0555's message, and `vi.hoisted` there does not | lint | lint | delete the folder from the rule's `files` block: N1's planted line passes | oxlint-plugins/builtin-plants.ts, `.oxlintrc.json` |

- **S2 stays as strict as it is.** Every output it compared is still compared; one more (the
  `Console` calls) is added. The reviewer runs the loosening check on it.
- **H1 and H2 run on stand-ins** (the 4a door, the in-memory key file and journal, the fake
  spawner, as S2 uses), so they are plain laws on every pull request, not `.integration.`.
- **`hands.ts`'s race has no law of its own here.** It is one line under `NodeRuntime.runMain`, a
  module whose top level runs the process, so no plain law can import it. H2 holds what it reads;
  `hands-launcher.integration.test.ts` keeps its S2 end to end on the schedule. The review reads
  the line. 80%.
- No law needs the owner's Mac, so none is host-only. S2 is the `[secrets]` law with generated
  flows, as today, and the new plant leaks into the one output this slice adds.

## The lock

On main there is no rule that refuses `vi.spyOn`: `.oxlintrc.json` has the `vitest` plugin on and
no `vitest/no-restricted-vi-methods` entry (`rg -n "no-restricted-vi" .oxlintrc.json` finds none),
and no open pull request adds it (searched 2026-11-16). 0555 names that rule and its messages.

- **If main still has no such entry when this slice's tests step starts,** this slice adds it: one
  `overrides` block in `.oxlintrc.json` for `next/packages/libfabrika/src/node/client/**`, at
  `error`, with 0555's four messages, and a `VI_METHODS` plant in
  `oxlint-plugins/builtin-plants.ts` that `plants.test.ts` runs in every folder the block lists
  (law N1), the way the Reflect ban's `REFLECT` plant does. Each later folder slice adds its folder
  to that block's `files`.
- **If another mock slice landed the entry first,** this slice only adds its folder to the block's
  `files`, and N1 is that plant run in one more folder.
- The rule is on at zero for the folder, at `error`, never `warn`, with no list of leftovers
  ([0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)).
- Open pull request [1373](https://github.com/kamp-us/tea-fabrika/pull/1373) also edits
  `.oxlintrc.json`, for the anti-slop plugin. Whichever lands second takes a rebase of a different
  block. 0555 says the hold may move to anti-slop's `no-module-mocking` later; that does not change
  this slice.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/client/HandsStart.ts | build | 14 | the `report` sink and `onError: report`; the doc block says where tea's failures with no caller go |
| next/apps/fabrika/hands.ts | build | 3 | the line printer races `runtime.done()` |
| next/packages/libfabrika/src/node/client/HandsSecrets.laws.test.ts | tests | tests | S2: the three spies and the `vi` import go; the in-memory `Console` is provided and read; the new plant noted in the header |
| next/packages/libfabrika/src/client/HandsStart.laws.test.ts | tests | tests | H1 and H2, added beside its laws |
| oxlint-plugins/builtin-plants.ts | tests | tests | N1: the `VI_METHODS` plant, or one more folder for it |
| oxlint-plugins/plants.test.ts | tests | tests | N1 runs the plant in the folder; changed only if the plant needs a new runner line |
| .oxlintrc.json | tests | 12 | the `vitest/no-restricted-vi-methods` block for the folder, or the folder added to it |

- `HandsStart.ts` stays in libfabrika's `client/`: a from-scratch client that starts hands needs
  the same sink, so it is not app code (`next/AGENTS.md`). It names no platform.
- `hands.ts` is the app's entry for the hands process; it already holds the run's lifetime.
- No file here is in pull request 1366's diff, nor in 1391's (tea 0.27.0). If 1391 lands first, the
  build reads 0.27.0's `run` options and `RuntimeDiscardNotice` export before writing `report`.

## Calls taken

- **The product change is a sink for tea, not a `Console` service in our code,** 90%. Our code on
  this path writes nothing outside Effect; the one writer is tea's default sink, and tea's own
  answer is `onError`.
- **The sink logs through Effect's Logger, not `Console`,** 85%. It is a failure report with a
  level and a phase, which is what a logger is for, and S2 already reads the Logger.
- **The law's `Console` is its own, not `TestConsole`,** 85%. `TestConsole` cannot read `warn`.
- **The hands process still ends on a tea failure,** 85%. Today's behavior, OTP's rule, and the
  root map's "do what Erlang/OTP does". Only the way it ends changes: through Effect, with
  finalizers run and a failing exit code, instead of an uncaught throw.
- **The lock rule is 0555's `vitest/no-restricted-vi-methods`,** 90%. 0555 names it.
- **Is this a setting?** No. Where tea's failures go and the test `Console` are code, nothing a
  person running fabrika picks (0069).
- **What fact is lost if not recorded now?** Today a tea failure on a hands start goes to the
  terminal as a raw `console.warn` or a crash trace, outside the logs. After this slice it is a log
  line with its `phase`, so the logs keep it. Nothing recorded today is dropped.

## Validation

- The tests step: `pnpm format`, `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=6144` in a
  cloud box), then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/node/client/HandsSecrets.laws.test.ts`,
  `next/packages/libfabrika/src/client/HandsStart.laws.test.ts` and `oxlint-plugins/plants.test.ts`.
  H1, H2 and S2's new plant are red until the build; each plant is run once and recorded.
- The build: the same paths. The lead runs the changed-files test run and the one type check.
- `hands-launcher.integration.test.ts` runs on the schedule, not in a step.

## Size

One pull request: the sink, the race, the law's rewrite, two new laws and the lock. Confidence in
the line counts: 80%; the doubt is H1's trigger, which may need a few lines of test support.

1. The mock sweep in `node/client`: about 17 product lines, about 120 test lines added and about 20
   removed, and about 12 lines of lint config. 29 lines.

Priced as the Recorder plan priced its steps, from the rows in `field/runs/` for 2026-11-10 to
2026-11-15 at list price: a tests step about $6, a build about $4 (it is small), a review about $3,
and one likely fix round about $4, for the trigger doubt.

Estimate: 4 steps, $17

## Records

- No decision file: this builds 0555 and 0579 and takes no new owner ruling.
- No glossary row: no new word.
- `.patterns/a-law-watches-calls-with-a-recorder.md` says a global such as `console` needs a product
  change first; this slice is that case. The build adds one line there naming it: a writer outside
  Effect is given a sink that logs through Effect, and the law reads Effect's Logger and `Console`.
- `field/`: one run row per step, the same day.

## What this cannot tell us

- **Whether H1's trigger exists as planned.** See the doubts. Nothing here was run.
- **A direct `console` or `process.stdout` write added to our code later, on this path.** S2 no
  longer sees it. Effect's `globalConsole` checks would refuse it once locked for `client/` and
  `node/client/`; that is the Effect sweep's slice
  ([1412](https://github.com/kamp-us/tea-fabrika/pull/1412)), not this one.
- **A package that writes to `console` itself,** tea's other warnings included. None is reached by
  S2's start today; a future tea could add one, and S2 would not see it.
- **`hands.ts`'s race,** read by the review only; the integration law runs on the schedule.

## Open questions

None.

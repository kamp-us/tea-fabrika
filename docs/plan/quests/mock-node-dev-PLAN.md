
Plancheck-Version: 3

# Plan: the mock sweep in `libfabrika/src/node/dev`, in next/: 15 spies and 2 call matchers go, `process.kill` moves behind a `Signals` service, and lint holds the folder at zero (ticket 1067)

This is `next/` only. Today's app is not touched. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.spyOn` in a test: the call goes
through a service and the law's layer records it) and
[0579](../../../.decisions/0579-property-laws-use-it-prop.md) (the `Recorder` is our one way to
watch calls), for one folder of the sweep that
[the recorder plan](./recorder-PLAN.md#size) lists:
`next/packages/libfabrika/src/node/dev`.

```ts
// The whole idea, on the L6 law of local-dev.laws.test.ts. A sketch, not compiled.
// Before: the test framework patches the global, and the law reads `any` args.
const kill = vi.spyOn(process, "kill").mockImplementation(refuses(code));
yield* signal(pid, name).pipe(Effect.exit);
expect(kill.mock.calls).toEqual([[pid, name]]);

// After: `signal` asks for the `Signals` service, and the law records its calls, typed.
const signals = SignalsTest.layer({ fails: { send: new SignalError({ reason }) } });
yield* signal(pid, name).pipe(Effect.exit);
expect(yield* Recorder.calls(Signals)).toEqual([{ method: "send", args: [pid, name] }]);
// ...all inside Effect.provide(signals)
```

## Doubts, read these first

- **The recorder plan's row is half wrong for `fetch` (95%).** It says all 15 spies need a product
  change first. The 7 `fetch` spies do not: `startDev` already reaches `fetch` through Effect's
  `HttpClient` (`next/packages/libfabrika/src/node/dev/dev.ts:156`). The laws spy on the global only
  because `dev-client.test-support.ts:10` builds the `FetchHttpClient.Fetch` reference as "call
  whatever `globalThis.fetch` is now". The fix is in that test file: each law provides its own
  `Fetch` function. No product line changes for `fetch`.
- **The watch law's `console.warn` spy needs an owner answer (open question 1).** Rolldown, an
  outside package, writes its warnings straight to the global `console` (its `defaultPrintLog` in
  `rolldown@1.2.13`, `dist/shared/create-bundler-option-*.mjs`). No Effect service sits in between,
  so the only way to keep that law's leak check without a spy is a product change to how
  `watch.ts` hands Rolldown's logs on. That is a choice about product behavior. The lean is
  below; the slice holds that one hit, and the folder's lock, until the owner answers.
- **The secrets law watches less after the change (open question 2, 75%).** Its five `console`
  spies catch a write to the global `console` from any code on the path, an outside package's
  included. Effect's `TestConsole` catches only what goes through Effect's `Console`. This plan
  closes the gap for our own code with a lint rule (`eslint/no-console`, at zero in libfabrika's
  product files today), but an outside package that calls `console.log` itself is no longer seen.
  0555 bans the spy, so this follows from it, but it narrows what a law checks, so the owner hears
  of it.
- **The order with the Reflect ban's slice 9 (80%).** Both touch `dev.ts`,
  `dev-control.laws.integration.test.ts`, `dev-secrets.laws.integration.test.ts` and
  `watch.laws.integration.test.ts`. This slice goes first: it waits on nothing, and slice 9 waits on
  the quotas slice ([#1366](https://github.com/kamp-us/tea-fabrika/pull/1366)). See "Order".

## What changes, in one paragraph

On main at `f7169af`, the folder has 15 `vi.spyOn` calls (`fetch` 7, `process.kill` 6, `console`
2), 2 `toHaveBeenCalled*` matches and no `vi.fn`. The 7 `fetch` spies become a `Fetch` function
each law provides. The 6 `process.kill` spies and both matchers go once `signal` in `local-dev.ts`
reaches the OS through a new `Signals` service, whose Node layer is the one place that calls
`process.kill`; the laws record it with `Recorder.layer`. The 2 `console` spies become Effect's
own `TestConsole` (the secrets law) and, after the owner's answer, a Rolldown `onLog` handler that
hands each warning's code to Effect's logger (the watch law). Then `vitest/no-restricted-vi-methods`
turns on for the folder, refusing `vi.fn`, `vi.spyOn` and `vi.stubGlobal`, and `eslint/no-console`
turns on for libfabrika's product files. The folder's 6 `vi.stubEnv` and 2 `vi.mock` calls are not
in this slice: they wait for 0555's `Config` slice and for 0042's Alchemy work, and join the same
lock block when they reach zero.

## How others do it

- **Effect's own `fetch` stand-in.** `FetchHttpClient.Fetch` is a `Context.Reference` to a `fetch`
  function (`node_modules/effect/src/http/FetchHttpClient.ts:35`, effect 4.1.3). Effect's tests
  provide their own function there; 0555 names it as the way, and `next/` already does it in 3
  places.
- **Effect's own console stand-in.** `Console.Console` is a `Context.Reference` whose default is
  `globalThis.console` (`node_modules/effect/src/Console.ts:86`), and Effect's built-in loggers
  write through it (`Logger.ts:340`). `TestConsole.layer` (`src/testing/TestConsole.ts:300`,
  marked unstable) records every method call and reads back `logLines` and `errorLines`.
- **Signals to a pid.** Effect 4.1.3 has no service that signals an arbitrary pid: its
  `ChildProcessSpawner` handle's `kill` reaches only a process it spawned itself, and the workerd
  here is started by Alchemy's local provider, so only its pid reaches us. Erlang/OTP keeps the OS
  edge in one port module, and a supervisor ends a child by message, never by a global
  (`supervisor` shutdown: `brutal_kill` or a timeout then `kill`); `terminate` here already
  follows that shape. The known way left is a service at the edge, one per
  [0555](../../../.decisions/0555-no-vi-mock-or-domock.md).
- **Rolldown's logs.** Rolldown follows Rollup's `onLog(level, log, defaultHandler)`: given a
  handler, Rolldown calls it for each log at or above `logLevel`, and prints only if the handler
  calls `defaultHandler` (Rollup docs, "onLog"; read in the installed `rolldown@1.2.13`, not
  fetched).

## The shape

### `Signals`, the one way `next/` signals an OS pid

```ts
// next/packages/libfabrika/src/node/dev/Signals.ts: the contract only (0095). A sketch.
import { Context, Effect, Schema } from "effect";

/** A signal the OS refused: `missing` when the pid has no process (ESRCH), `refused` for any other. */
export class SignalError extends Schema.TaggedError<SignalError>()("SignalError", {
  reason: Schema.Literals(["missing", "refused"]),
  /** The error the OS call threw, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

export class Signals extends Context.Service<
  Signals,
  {
    /** Sends one signal to one OS process. It checks nothing about the pid. */
    readonly send: (pid: number, signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void, SignalError>;
  }
>()("@kampus/libfabrika/node/dev/Signals") {}
```

```ts
// next/packages/libfabrika/src/node/dev/internal/signals.ts. A sketch.
const isMissing = Schema.is(Schema.Struct({ code: Schema.Literal("ESRCH") }));

/** The service over one OS call, so its law can hand in a call that throws as Node does. */
export const make = (kill: (pid: number, signal: string) => void): Signals["Service"] => ({
  send: (pid, signal) =>
    Effect.try({
      try: () => kill(pid, signal),
      catch: (cause) => new SignalError({ reason: isMissing(cause) ? "missing" : "refused", cause }),
    }),
});

// next/packages/libfabrika/src/node/dev/SignalsNode.ts. A sketch.
// The one line in next/'s product code that calls process.kill.
export const layer = Layer.succeed(Signals, make((pid, signal) => process.kill(pid, signal)));

// next/packages/libfabrika/src/node/dev/SignalsTest.ts, beside its service (0538). A sketch.
export const layer = (
  impl: Layer.PartialEffectful<Signals["Service"]> = { send: () => Effect.void },
  fails: Recorder.Fails<Signals["Service"]> = {},
) => Recorder.layer(Signals, impl, { fails });
```

```ts
// next/packages/libfabrika/src/node/dev/local-dev.ts:143, after. A sketch.
// `SignalError` and `isMissing` move out; what `signal` does is the same.
export const signal = (pid: number, name: Signal): Effect.Effect<void, never, Signals> =>
  Signals.use((signals) => signals.send(pid, name)).pipe(
    Effect.catchIf((error) => error.reason === "missing", () => Effect.void),
    Effect.orDie,
  );
```

- `startDev` (`dev.ts:140`) passes `signal` to `terminate` as today. Its requirements grow by
  `Signals` through inference, so `dev.ts` changes only its doc block, which names what to provide.
- **Who provides `SignalsNode.layer`:** the app's `next/apps/fabrika/src/instance.ts`, on its call
  to libfabrika's `start(...)`. Not `local-instance.ts:51`, though that is the app's entry: the app
  law `local-instance.integration.test.ts` calls `instance.ts`'s `startDev` straight, and that file
  is in pull request 1366's diff, which this slice may not touch. With the provide in `instance.ts`
  that law keeps passing unchanged (its own `process.kill` spy still sees the call, since
  `SignalsNode` calls the global). The app's own sweep slice moves the provide up to
  `local-instance.ts` after 1366 lands, so its law can swap `Signals` too.
- `next/packages/libfabrika/package.json` gets one export, `"./node/signals": "./src/node/dev/SignalsNode.ts"`.
- **The name.** `Signals`, a plural service name (0029), after what it sends: POSIX's word, and
  Node's (`process.kill` sends a signal). Not `Processes` or `Kill`: in `next/`, a process is a
  running copy of a program (`.glossary/TERMS.md`), and an OS pid is not one. A glossary row says so.
- **Is this a setting?** No. Which OS call ends a process is not a person's choice (0069).
- **What fact is lost?** None: the facts of a replace (`replacing`, `killed`) are written before
  the signal as today (`dev.ts:478`).

### `fetch`: each law hands in its own

```ts
// next/packages/libfabrika/src/node/dev/dev-client.test-support.ts, after. A sketch.
/** The entry's own client over the `fetch` a law hands in, in place of the global. */
export const fetchClient = (fetch: typeof globalThis.fetch) =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)));
```

A law that changed its spy's answer mid-run (`dev.laws.integration.test.ts:135`, `:148`, `:285`)
keeps the answer in its own world object, which its function reads. A law that counted calls
(`dev-errors.laws.integration.test.ts:80`) counts them in that function. These are plain functions
a law owns, not services, the case the Recorder pattern leaves to the law
(`.patterns/a-law-watches-calls-with-a-recorder.md`, "Where it applies").

### `console`: Effect's own `Console`

- **The secrets law** (`dev-secrets.laws.integration.test.ts:228`) provides `TestConsole.layer`
  and adds `logLines` and `errorLines` to the outputs it scans. Effect's loggers write through the
  `Console` reference, and the law already replaces the logger with its own (`:233`).
- **`eslint/no-console` at error** in `next/packages/libfabrika/src/**`, test files and test
  support left out. `rg -n '\bconsole\.'` finds 0 hits there on main, so it blocks from the start
  (0523's "block where clean"). It holds what the spy held for our own code: nothing of ours writes
  to the global `console`, so `TestConsole` sees every write of ours.

### The watch law's warnings (waits on open question 1)

The lean, a sketch. `watch.ts:126` today passes `logLevel: "silent"`, so Rolldown drops every
warning. After:

```ts
// next/packages/libfabrika/src/node/dev/watch.ts:121, after. A sketch, not compiled.
const run = Effect.runForkWith(yield* Effect.context<never>());
watch({
  // ...as today
  logLevel: "warn",
  // Each warning's code and plugin go to Effect's log at debug; its message, frame and location
  // can quote the source, so they never leave. The default handler is never called, so Rolldown
  // prints nothing.
  onLog: (level, log) => {
    run(Effect.logDebug("rolldown").pipe(Effect.annotateLogs({ level, code: log.code ?? null, plugin: log.plugin ?? null })));
  },
});
```

The law then reads Effect's log through a `Logger` layer, as the secrets law does, and its existing
`vi.mock("rolldown")` wrapper (the one exception 0555 keeps: the law of the one file that wraps an
outside package) also wraps the `onLog` it is handed, so it sees whether the default handler was
ever called. If the owner picks keeping `silent`, the law checks through that wrapper that every
`watch` call gets `logLevel: "silent"` and no handler that prints, which no longer catches a
Rolldown that prints despite `silent`.

## One value traced: a replace whose old process has already gone

1. The memory sampler in `startDev` reads 600 MB for pid 27001 against a 500 MB limit and calls
   `replace` (`dev.ts:517`).
2. `terminate` folds `replacing`, `record` writes the `replacing` fact, then it runs
   `signal(27001, "SIGTERM")`.
3. `signal` asks for `Signals` and runs `send(27001, "SIGTERM")`. In the app, `SignalsNode.layer`
   answers: `process.kill` throws `{ code: "ESRCH" }`, `make` turns it into
   `SignalError { reason: "missing" }`.
4. `signal` catches `missing` and succeeds: the process has already gone.
5. In a law, `SignalsTest.layer({}, { send: new SignalError({ reason: "missing" }) })` answers in
   step 3 instead, and records `{ method: "send", args: [27001, "SIGTERM"] }`. The law reads it with
   `yield* Recorder.calls(Signals)` inside the same provide.

## Each call, what it watches and what replaces it

Counted on main at `f7169af` with `rg -n 'vi\.fn\(|toHaveBeenCalled|spyOn\('` in the folder.

| Call | Watches | Replaced by |
|---|---|---|
| `dev-errors.laws.integration.test.ts:48` | `fetch`, and whether it was called | the law's `Fetch` function, which counts |
| `dev-errors.laws.integration.test.ts:154` | `fetch` | the law's `Fetch` function |
| `dev-errors.laws.integration.test.ts:158`, `:208` | `process.kill`, `not.toHaveBeenCalled` | `SignalsTest.layer()`; `Recorder.calls(Signals)` is `[]` |
| `dev-control.laws.integration.test.ts:286` | `fetch`, with the URL and body | the law's `Fetch` function, pushing to `sent` as today |
| `dev-control.laws.integration.test.ts:318` | `process.kill`, each pid into a queue | `SignalsTest.layer({ send: (pid) => Queue.offer(killed, pid) })` |
| `dev.laws.integration.test.ts:118` | `process.kill`, read at `:212` and `:256` | `SignalsTest.layer()`; `Recorder.calls(Signals, "send")` |
| `dev.laws.integration.test.ts:119` | `fetch`, its answer changed at `:135`, `:148`, `:285` | the law's `Fetch` function over the law's world |
| `dev.laws.integration.test.ts:413` | `fetch`, with port and time | the law's `Fetch` function |
| `dev.laws.integration.test.ts:441` | `process.kill`, with time, and ends the old process | `SignalsTest.layer({ send })`, the stateful part kept in the law's world |
| `dev.laws.integration.test.ts:790`, `:810` | `process.kill`, `not.toHaveBeenCalled` | `SignalsTest.layer()`; `Recorder.calls(Signals)` is `[]` |
| `dev.laws.integration.test.ts:795` | `fetch` | the law's `Fetch` function |
| `dev-secrets.laws.integration.test.ts:163` | `fetch`, its headers and body | the law's `Fetch` function |
| `dev-secrets.laws.integration.test.ts:229` | `console.log`, `info`, `warn`, `error`, `debug` | `TestConsole.layer`, plus `eslint/no-console` |
| `watch.laws.integration.test.ts:241` | `console.warn`, for leaks | open question 1 |
| `local-dev.laws.test.ts:132` | `process.kill`, throwing as Node does | L6a and L6b below |

Every law that runs `startDev` and did not spy on `process.kill` gets `SignalsTest.layer()` too,
since `startDev` now asks for `Signals`. Each layer is built per run, so no law patches a global
another law can see, which the `mockRestore` lines guarded by hand. Those `try/finally` and
`acquireRelease` restores go with their spies (0061).

## Laws

| Law | Kind | Generator | What it holds | Plant |
|---|---|---|---|---|
| M1 | lint | lint | `vitest/no-restricted-vi-methods` refuses `vi.fn`, `vi.spyOn` and `vi.stubGlobal` in `next/packages/libfabrika/src/node/dev/**`; `vi.stubGlobal` too, so a spy does not move to a global stub (0555) | a `VI_SPY` plant in `oxlint-plugins/builtin-plants.ts`; `plants.test.ts` runs its lines in every folder of the block. Plant: drop the folder from the block, and its line is not refused |
| M2 | lint | lint | `eslint/no-console` refuses `console.*` in libfabrika's product files and takes it in a test file | a `NO_CONSOLE` plant, run in a product path and a test path. Plant: widen the block to test files, and the test line is refused |
| L6a | test | Effect Arbitrary: SignalCase | `signal` succeeds on `missing`, dies on `refused`, and sends exactly one `send(pid, name)` | let `missing` escape `signal`, or swallow `refused` too (the L6 plant of today) |
| L6b | test | Effect Arbitrary: Thrown | `make` over a call that throws answers `missing` only for `{ code: "ESRCH" }` and keeps the thrown value as `cause` | classify by `message` in place of `code`, or answer `missing` for any error |
| L6c | test, `SignalsNode.integration.test.ts` | vector: one real ESRCH from Node, a child this law spawned and waited for | `SignalsNode.layer`'s `send` to a child this law spawned and waited for fails as `missing`: the shape `{ code: "ESRCH" }` that L6b assumes comes from a real Node, as a `vector:` | drop the `catch` in `make`, and the ESRCH dies as a defect |
| The rewritten laws | test | scenario: each law's own generators, unchanged | each keeps its title and its claim, watched through `Fetch`, `Recorder.calls(Signals)` or `TestConsole` | each keeps its named plant (`dev.laws:529` L7, `:627` L8, `:778` L13, `dev-control:575`, `dev-secrets:497`). The two unnamed ones: dev-errors' offline law, "dial in offline mode", red on the count; its RSS law, "signal when the sample fails", red on `Recorder.calls(Signals)` |
| The secrets law, new plant | test | scenario: the law's generated flows, unchanged | a `Console.log` of the bearer on the path is caught | add `yield* Console.log(bearer)` in the control call, and `logLines` holds it |

```ts
// The two new laws' input Schemas, in their test files. A sketch.
const SignalCase = Schema.Struct({
  pid: Schema.Int.check(Schema.isBetween({ minimum: 30_000, maximum: 39_999 })),
  name: Schema.Literals(["SIGTERM", "SIGKILL"]),
  reason: Schema.Literals(["missing", "refused"]),
});
// What a throwing OS call can hand `make`: an errno-shaped object, or anything else.
const Thrown = Schema.Union([
  Schema.Struct({ code: Schema.Literals(["ESRCH", "EPERM", "EINVAL"]), message: Schema.String }),
  Schema.String,
  Schema.Null,
]);
```

- **L6c is host-only:** it sends a real signal on the real machine. It runs before the first
  review, in a cloud box; on the owner's Mac it waits for the lead's read of its signal line and
  the owner's yes (0178). It signals only its own child, already waited for. Why no stand-in will
  do: it is the one law that checks what Node really throws, which L6b's inputs copy.
- No law is loosened and none is deleted. A law that passed only because of a spy is rewritten to
  watch the real call, as listed above.
- `vi.fn` has no call in the folder today; M1 refuses it so none comes back, as 0579 says the
  Recorder replaces it.
- **What M1 may miss, untested:** a renamed import, `import { vi as v }`, which 0555 asks a plant
  for. The tests step plants it and writes down what oxlint does. If oxlint takes it, that is a
  finding row, not a fix here.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/node/dev/Signals.ts | build | 25 | new: the contract and `SignalError`, moved from `local-dev.ts` |
| next/packages/libfabrika/src/node/dev/internal/signals.ts | build | 15 | new: `make` |
| next/packages/libfabrika/src/node/dev/SignalsNode.ts | build | 8 | new: `layer`, the one `process.kill` |
| next/packages/libfabrika/src/node/dev/local-dev.ts | build | 10 | `signal` asks for `Signals`; `SignalError` and `isMissing` go |
| next/packages/libfabrika/src/node/dev/dev.ts | build | 3 | the doc block of `startDev` names `Signals` |
| next/packages/libfabrika/src/node/dev/watch.ts | build | 12 | after open question 1: `logLevel` and `onLog` |
| next/packages/libfabrika/package.json | tests | tests | the `./node/signals` export; a package file is an exam path, so the tests step writes this line |
| next/apps/fabrika/src/instance.ts | build | 2 | provides `SignalsNode.layer` to `start(...)` |
| .glossary/TERMS.md | build | docs | a `Signals` row: an OS signal to a pid, not a `next/` process |
| next/packages/libfabrika/src/node/dev/SignalsTest.ts | tests | tests | new: `layer`, over `Recorder.layer` |
| next/packages/libfabrika/src/node/dev/local-dev.laws.test.ts | tests | tests | L6 becomes L6a |
| next/packages/libfabrika/src/node/dev/signals.test.ts | tests | tests | new: L6b |
| next/packages/libfabrika/src/node/dev/SignalsNode.integration.test.ts | tests | tests | new: L6c |
| next/packages/libfabrika/src/node/dev/dev-client.test-support.ts | tests | tests | `fetchClient` takes the law's `fetch` |
| next/packages/libfabrika/src/node/dev/dev-errors.laws.integration.test.ts | tests | tests | 2 `fetch`, 1 `process.kill`, 1 matcher |
| next/packages/libfabrika/src/node/dev/dev-control.laws.integration.test.ts | tests | tests | 1 `fetch`, 1 `process.kill` |
| next/packages/libfabrika/src/node/dev/dev.laws.integration.test.ts | tests | tests | 3 `fetch`, 3 `process.kill`, 1 matcher |
| next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts | tests | tests | 1 `fetch`, the `console` spies, a new plant |
| next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts | tests | tests | after open question 1: the `console.warn` spy |
| oxlint-plugins/builtin-plants.ts | tests | tests | `VI_SPY` and `NO_CONSOLE` |
| oxlint-plugins/plants.test.ts | tests | tests | M1 and M2's scenarios, as `REFLECT`'s at `:532` |
| .oxlintrc.json | tests | tests | the two blocks |

- **The libfabrika test** (`next/AGENTS.md`): a from-scratch client that runs a local dev brain
  needs `Signals` too, so it lives in libfabrika, and `instance.ts` only provides it.
- `node/dev` is one module with an `internal/`; `Signals.ts` is its front file, `SignalsNode.ts`
  a sibling layer file (0095). `make` sits in `internal/` so the law L6b imports it inside its own
  module and the export is used by `SignalsNode.ts`, never only by a test (0006).
- **Pull request 1366** has no file in this table. Its `local-instance.integration.test.ts` keeps
  its own `process.kill` spy and passes unchanged; that spy waits for the app's slice.

## Order

- **With the Reflect ban's slice 9** ([the plan](./reflect-ban-PLAN.md), the typed dev client):
  this slice first. Slice 9 waits on the quotas slice (#1366); this one waits on nothing. The
  overlaps are near but not the same lines: `dev.ts` (slice 9 types the client at `:52`, this
  slice changes a doc block at `:110`), `dev-control.laws` (slice 9's `Reflect.get` at `:241`,
  `:279`, `:470`; this slice's spies at `:286`, `:318`), `dev-secrets.laws` (`:380`, `:428` against
  `:163`, `:229`) and `watch.laws` (slice 9 makes the `Proxy` at `:69` a plain object, inside the
  same `vi.mock("rolldown")` wrapper this slice adds an `onLog` wrap to). Slice 9's plan already
  says its counts are taken again when it starts; it rebases on this one.
- **With the Effect-check sweep:** open pull requests
  [#1430](https://github.com/kamp-us/tea-fabrika/pull/1430) (E2, every test file here),
  [#1426](https://github.com/kamp-us/tea-fabrika/pull/1426),
  [#1457](https://github.com/kamp-us/tea-fabrika/pull/1457),
  [#1453](https://github.com/kamp-us/tea-fabrika/pull/1453),
  [#1450](https://github.com/kamp-us/tea-fabrika/pull/1450),
  [#1440](https://github.com/kamp-us/tea-fabrika/pull/1440) and
  [#1435](https://github.com/kamp-us/tea-fabrika/pull/1435) edit files of this folder, mostly import
  lines. Whichever lands second rebases; each clash is a few lines.
- **With other folders of the mock sweep:** the first to land adds the `no-restricted-vi-methods`
  block to `.oxlintrc.json`; each later one adds its folder to the block's `files`, a one-line
  clash. `vi.mock` and `vi.stubEnv` join the block's list when the folder's last ones go.
- **0579's `fc.assert` sweep** is not here: the rewritten laws keep their runner and move with that
  sweep.

## Calls taken

- `fetch` needs no product change, since `HttpClient` already reaches it (95%).
- `Signals` in `node/dev`, with its Node layer and a test layer beside it, builds 0555's "a call
  the law wants to watch goes through a service" (90%). The name and the one method are how the
  code does what 0555 says, not a new design call.
- `instance.ts`, not `local-instance.ts`, provides `SignalsNode.layer` in this slice, so no file of
  #1366 is touched (85%).
- M1 refuses `vi.fn` and `vi.stubGlobal` beside `vi.spyOn` (85%): 0579 says the Recorder replaces
  `vi.fn`, and 0555 says a fix does not move the swap elsewhere.
- `eslint/no-console` for all of libfabrika's product files, not only this folder (80%): the
  secrets law's path runs code from other folders, all at zero today.
- L6 splits into a law over the service, a law over the classifier, and one real-signal law (80%).

## Validation

The tests and build steps run, under `nice -n 15 pnpm exec vitest run --maxWorkers=3`, the narrow
paths of every test file in the table, the `.integration.` laws among them, and `pnpm lint` (M1, M2
and the plants). The lead runs the wider vitest pass and the one type check. L6c runs in the box
before the first review.

## Size

1. This slice, one pull request: about 75 product lines (63 before open question 1's 12), about
   250 test lines changed, 2 lint blocks and 2 plants. 75 lines.

Confidence in the line counts: 75%. The doubt is how many laws that run `startDev` need a
`SignalsTest.layer()` added and how much of each `try/finally` goes with its spy.

Priced from `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder plan priced
them: the tests step rewrites 6 law files and adds 3 laws and 2 lint laws, so $8; a build $5; a
review $3; one likely send-back $4.

Estimate: 4 steps, $20

## Records

- A glossary row for `Signals`, in the build.
- No decision file: this builds 0555 and 0579. The two open questions, once answered, go in as an
  amendment to this plan, and a ruling on question 2 as a line in 0555's Amendments.

## What this cannot tell us

- Whether any block here compiles. None was compiled or run; `Effect.runForkWith` and
  `Signals.use` are as read in effect 4.1.3's source, not tried.
- Whether an outside package on the secrets law's path writes to `console` today. Nobody has
  looked; the spy would have caught it, and `TestConsole` will not.
- Which code Rolldown gives the watch law's duplicate-key warning. The tests step reads it from a
  real run.
- Whether oxlint's rule sees `vi` renamed on import.

## Open questions

1. **How should `watch.ts` hand on Rolldown's warnings, now that a law may not spy on `console`?**
   Lean (70%): Rolldown gets `logLevel: "warn"` and an `onLog` that sends each warning's code and
   plugin, never its text, to Effect's log at debug, and never prints; the law reads the log and
   checks that the default handler is never called. The other way: keep `logLevel: "silent"`, and
   the law only checks the option, which no longer catches a Rolldown that prints anyway.
2. **The secrets law will no longer see an outside package that writes to the global `console`.
   Is that narrowing acceptable?** Lean (75%): yes. 0555 bans the spy, `eslint/no-console` holds
   our own code, and the other way, running the flow in a child process and reading its output,
   costs a process per generated case.

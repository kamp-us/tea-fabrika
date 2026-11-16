Approved by the lead agent, builds 0555, 0579, 0554, 0557; body c0a03b19f87a
Plancheck-Version: 3

# Plan: the mock sweep in `cloudflare`, in next/ (ticket 1067)

All of this is in `next/`, in `next/packages/libfabrika/src/cloudflare`. Today's version is not
touched. It builds [0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.spyOn`, a
stand-in comes from the code's own design), [0579](../../../.decisions/0579-property-laws-use-it-prop.md)
(the Recorder is our one way to watch a service's calls),
[0554](../../../.decisions/0554-no-reflect-get-set-has.md) and
[0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md) (a fake of a Cloudflare
object comes from the test package, never by hand), and the recorder plan's row for this folder
([`recorder-PLAN.md`](./recorder-PLAN.md), "Size"). Amendment 2026-11-15: it also builds
[0592](../../../.decisions/0592-libfabrika-writes-output-only-through-effects-console.md)
(libfabrika writes output only through Effect's `Console`, law M13) and follows
[0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) (no list lets broken code pass)
and [0042](../../../.decisions/0042-platform-pieces-go-through-alchemy.md) (platform pieces go
through Alchemy).

```ts
// The whole idea, on one law of this folder. A sketch, not compiled.
// before: readers.laws.test.ts:300 and :454, a vitest spy stands in for the socket's send
const ws = { send: vi.fn(), close: vi.fn() /* ... */ };
expect(w.ws.send.mock.calls.map(([text]) => JSON.parse(text))).toContainEqual(/* ... */);

// after: the socket is a platform fake from the test package, and what it was sent is its state
const sent: Array<string> = [];
const socket = Stub.make<WebSocket>(unexpected, {
  send: (text) => void sent.push(String(text)),
  close: () => {},
});
expect(sent.map((text) => JSON.parse(text))).toContainEqual(/* ... */);
```

## Doubts, read these first

- **Open question 1 decides how the entry-flows leak law loses its `console`, `process.stdout` and
  `process.stderr` spies without getting weaker.** The lean is in the question. Until the owner
  answers, slice 1 holds back the entry-flows spies on `process.stdout`, `process.stderr` and
  `console`, and lands the rest.

  **Amendment (2026-11-16, merge session ruling):** the `console` half is answered: oxlint's
  built-in `eslint/no-console` rule holds it, not a rule of ours. So slice 1 turns `no-console` on
  for libfabrika's non-test files at zero, and the `console` spy goes in slice 1. The
  `process.stdout` and `process.stderr` half was not ruled on and stays open question 1; until it is
  answered, slice 1 still holds back those two spies.

  **Amendment (2026-11-15, owner ruling, relayed by the merge session, which records it as a
  decision):** that half is answered too. Raw `process.stdout` and `process.stderr` writes are
  banned across libfabrika with oxlint's built-in `eslint/no-restricted-properties`, and every write
  goes through Effect's `Console`. A real exception (a CLI's final output, a crash path) takes a
  disable line with a plain written reason. Slice 1 turns the ban on at zero (law M13), in the same
  fold pull request as the rest, never with a gap, and the two entry-flows spies go in slice 1.
  Open question 1 is closed (see "Answered questions").
- **The lock stays out of this sweep (amendment 2026-11-15, the laptop lead's ruling; this closes
  open question 2).** The folder keeps 7 `cloudflare:workers` mocks that wait on 0042's Alchemy
  work, so it cannot reach zero in this sweep, and no narrower interim lock is allowed (0524). See
  "The other `vi` hits 0555 bans".
- **The t863 span law reads its spans from the span sink's records (70%).** Today it wraps
  `ProjectClient.make` to catch the current span at each `route`. The lean reads the ended
  `runtime.rpc` spans that the connection's own recording writes, as `t864Delivered` in the same
  file already does (`connection.test.ts:506`). The doubt is whether every `runtime.rpc` span of
  the walk reaches that store before the law reads it. The tests step checks it with the plant
  below. If the spans do not all reach the store, the fallback is the slice 2 shape: `connection.ts`
  reads its `ProjectClient` maker through a `Context.Reference`, and the law hands in one that
  records the span. That fallback moves the law to slice 2, since `connection.ts` is in pull
  request 1366's diff.
- **Two `Context.Reference` values with live defaults take the place of the spies on
  `SpanSink.layer` and `ProgramRunner.withLoader` (75%).** That is Effect's own shape for a
  platform value a test hands in (`FetchHttpClient.Fetch`, `WebCrypto.WebCrypto`), used here for a
  layer maker. The doubt is whether a Reference that holds a layer maker reads well, compared with
  two arguments of `processLayer`. What settles it: the build's first read of `processLogic`, and
  the review.

## What changes, in one paragraph

The folder has 8 `vi.fn`, 0 `toHaveBeenCalled*` and 15 `vi.spyOn` on main at `f7169af`. They go in
two slices. Slice 1 changes only test files that pull request 1366 does not touch. Its 8 `vi.fn` are
socket, object-state and audit doubles, and they become `Stub.make` fakes from the test package
(reflect slice 8). Its 5 spies (`ProjectClient.make`, `Tracer.NativeSpan.prototype`, `console`,
`process.stdout` and `process.stderr`) give way to what the code already writes: span rows, and the
lines Effect's `Console` gets. Slice 2 waits for pull request 1366 and reflect slice 10. It makes
three small product changes. The spied inner Effects become exported functions a law runs on their
own. A Process object reads its span sink and its runner through two References. `checkedPut` hashes
through Effect's `WebCrypto` reference. With those, the last 10 spies go, along with the
`vi.mock("effect")` that existed only so `Effect.result` could be spied on. Slice 2 first planned to turn on
`vitest/no-restricted-vi-methods` and `vitest/no-restricted-matchers` for the folder; amended
2026-11-15, that lock waits until the folder's `cloudflare:workers` mocks go, after this sweep.

**Amendment (2026-11-15, merge session rulings):** the three `Effect.result` spies go a different
way than first planned. They watched an inner call through the `effect` barrel, and they go blind
the day the folder imports `effect/Effect` as a namespace, as the Effect fold just found in
`transport/Connection.ts`. So the watched call goes through a typed service, and the law records it
with a `Recorder` (0555, 0579); see "The watched calls, through services". Every slice also lands
on the sweep's one fold branch (see "Size"), and the lock refuses all five methods (see "The lock"
and open question 2).

## How others do it

- **Effect's own tests** hand in a platform value through a Reference with a live default:
  `FetchHttpClient.Fetch` (`node_modules/effect/src/http/FetchHttpClient.ts:35`, named by 0555) and
  `WebCrypto.WebCrypto`, whose default is `globalThis.crypto` and whose `WebCrypto.layer(crypto)`
  hands in another (`node_modules/effect/src/crypto/WebCrypto.ts`, effect 4.1.3 in the lockfile).
  Its `Digest` service sits on that reference. Read in the installed package.
- **Effect's `TestConsole`** (`node_modules/effect/src/testing/TestConsole.ts:300`) replaces
  `Console.Console`, and Effect's loggers write through the console reference
  (`Logger.withConsoleLog`, `node_modules/effect/src/Logger.ts:336`). So a law that provides
  `TestConsole.layer` sees every line an Effect logger writes. Read in the installed package.
- **Meszaros's "Fake Object"** keeps state a test reads back, such as an in-memory socket's sent
  frames. It is not a spy. Written from memory, not fetched. The Recorder pattern doc says the
  same for our code: a stateful fake stays a fake, and the Recorder wraps a service
  (`.patterns/a-law-watches-calls-with-a-recorder.md`, "Where it applies").
- **The lock** uses the rule 0555 names, which oxlint ships. `vitest/no-restricted-vi-methods` and
  `vitest/no-restricted-matchers` are both in the installed oxlint 1.90.0's
  `configuration_schema.json`, and neither is set in `.oxlintrc.json` on main.

## The sites

Counted on `origin/main` at `f7169af` with
`rg -n 'vi\.fn\(|toHaveBeenCalled|vi\.spyOn\('` over the folder, one match per call. The total is
8, 0 and 15, the same as the recorder plan's row.

| Site | Call | What it watches | What replaces it | Slice |
|---|---|---|---|---|
| `readers.laws.test.ts:300-301` | `vi.fn` 2 | the socket double's `send` and `close`; `send`'s calls are read at `:454` | a `Stub.make<WebSocket>` fake whose `send` keeps each frame in `sent`, the world's own list | 1 |
| `readers.laws.test.ts:324-325` | `vi.fn` 2 | the object state's `acceptWebSocket` and `setWebSocketAutoResponse`; never read | members of a `Stub.make<DurableObjectState>` fake that do nothing | 1 |
| `readers.laws.test.ts:327` | `vi.fn` 1 | the project's `route`, whose answer `:438` swaps with `mockResolvedValue` | a plain `route` that answers the world's `answer` value; the law sets `w.answer(...)`, as `connection.test.ts`'s world already does | 1 |
| `readers.laws.test.ts:617` | `vi.fn` 1 | `storage.get`, put on with `Object.assign` | the `Stub.make` object state built with its own `get` | 1 |
| `ProjectAuditTest.ts:126` | `vi.fn` 1 | `unused`, a member that throws on any platform call it did not expect | `Stub.make`'s `rest`, the guard form reflect slice 8 names | 1 |
| `ProjectAuditTest.ts:132` | `vi.fn` 1 | `sql.exec`, wrapped but never read | the plain `sql.exec` | 1 |
| `connection.test.ts:702` | `spyOn` 1 | `ProjectClient.make`, wrapped to catch the current span at each `route` | the ended `runtime.rpc` spans the connection records, read in order (doubt 2) | 1 |
| `entry-flows.laws.test.ts:175` | `spyOn` 1 | `Tracer.NativeSpan.prototype.attribute`, every span attribute set | the span rows and Record calls the flow writes, which the law already keeps at `:311-312` | 1 |
| `entry-flows.laws.test.ts:183, 187, 192` | `spyOn` 3 | `process.stdout.write`, `process.stderr.write`, and `console`'s five methods | `TestConsole.layer` on each runtime the law builds, read with `TestConsole.logLines` and `errorLines`; open question 1 | 1 |
| `readers.laws.test.ts:424` | `spyOn` 1 | `Effect.result`, to catch the exit of the ready decode inside `cloudflare/connection.ts`'s `wait` | (amendment 2026-11-15) `wait` asks the `Waits` service for the decode; the law records it with `Recorder.layer(Waits, live)`, reads the one call, and runs the recorded raw value through the live member for its typed exit; the wire law keeps its `bad_row` reply | 2 |
| `readers.laws.test.ts:476, 524` | `spyOn` 2 | `Effect.result`, to catch the exit of `dispatch` inside `control.ts` | (amendment 2026-11-15) `control.ts` asks the `Dispatcher` service for `dispatch`; the law records it with `Recorder.layer(Dispatcher, live)`, reads the one call, and runs the recorded input through the live member for its typed exit; the HTTP laws keep their response checks | 2 |
| `alarm.laws.test.ts:118, 326` | `spyOn` 2 | `SpanSink.layer`, swapped for a sink that writes nothing | `processLayer` provided with the `SinkLayer` reference | 2 |
| `alarm.laws.test.ts:132, 340` | `spyOn` 2 | `ProgramRunner.withLoader`, swapped for a runner that hands the law the `Alarm` service | `processLayer` provided with the `RunnerLayer` reference | 2 |
| `ObjectService.test.ts:281` | `spyOn` 1 | `SpanSink.layer` | the `SinkLayer` reference | 2 |
| `ObjectService.test.ts:295` | `spyOn` 1 | `ProgramRunner.withLoader` | the `RunnerLayer` reference | 2 |
| `error-cause.test.ts:272` | `spyOn` 1 | `crypto.subtle.digest`, made to reject | `WebCrypto.layer` with a `Stub.make` crypto whose `subtle.digest` rejects | 2 |

- **No site is a Recorder site.** No `vi.fn` here is a service of ours with a `toHaveBeenCalled*`
  check: the 8 are platform objects (the socket, the object state, the audit's storage). 0554 and
  0557 put a fake of a Cloudflare object in the test package. The 15 spies are on Effect, on our
  own modules and on platform globals. 0555 says each goes by testing what the code does or by a
  service, and the recorder plan puts `crypto` and `console` behind Effect's reference and
  `TestConsole`.
- **Left in the folder, and not this quest's:** `vi.mock` 13 (`cloudflare:workers` 8, `./objects.ts`
  4, `effect` 1), `vi.hoisted` 4 and `vi.stubGlobal` 1 (`WebSocketPair`, `readers.laws.test.ts:658`).
  Slice 2 removes the `vi.mock("effect")` at `readers.laws.test.ts:62`, since it is there only so
  `Effect.result` could be swapped. The `cloudflare:workers` mocks wait on Alchemy (0042), and the
  `./objects.ts` mocks wait on the object implementations being exported (0555, "Consequences").
  `WebSocketPair` is a platform global that `connection.ts` makes, so it goes with the Alchemy
  slice. None of these is counted by the recorder plan's row, and the lock does not name them.

## The other `vi` hits 0555 bans (amendment 2026-11-15, laptop lead's ruling)

The laptop lead ruled that `vi.mock`, `vi.doMock` and `vi.stubEnv` are 0555's own targets, so this
sweep fixes those hits too, and that a folder's lock lands whole in the one fold pull request only
once the folder is at zero. No interim narrower lock: that would be a list letting broken code pass,
which [0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) forbids. Counted on main at
`0683861` with `rg -o 'vi\.(mock|doMock|stubEnv)\('` over the folder: 12 `vi.mock`, 0 `vi.doMock`,
0 `vi.stubEnv`.

| What it mocks | Calls | Where | In this sweep? |
|---|---|---|---|
| `effect` | 1 | `readers.laws.test.ts` | yes, slice 2: it was there only so `Effect.result` could be spied on, and those spies go |
| `./objects.ts` | 4 | `readers.laws.test.ts`, `entry-flows.laws.test.ts`, `alarm.laws.test.ts`, `ObjectService.test.ts` | yes, slice 2: the object implementations are exported from `objects.ts`, so each law imports the one it needs (0555, "Consequences"), about 8 product lines |
| `cloudflare:workers` | 7 | `connection.test.ts`, `error-cause.test.ts`, `leave.laws.test.ts`, `reload.laws.test.ts`, `runner-reply.laws.test.ts`, `supervision.laws.integration.test.ts`, `ProjectAuditTest.ts` | **no**: [0042](../../../.decisions/0042-platform-pieces-go-through-alchemy.md) reaches the platform module through Alchemy, and 0555 names that move as its own work. It changes how the Worker's entry and every object reach the platform, which is past a mock sweep's slice and has no plan yet |

**So the folder cannot reach zero in this sweep, and its lock stays out.** The block in "The lock"
is the shape it lands with on the day the folder's last `cloudflare:workers` mock goes, whole, for
`cloudflare/**`; it does not land in this sweep. M11 waits with it. M12 and M13 are not `vi` locks
and land in slice 1 as planned. The seven `cloudflare:workers` mocks get a finding row with this
plan's step, naming 0042's Alchemy work as their owner.

## The shape

Slice 1 adds no product code. Every fake comes from `Stub.make`, as reflect slice 8 builds it
(`next/packages/vitest/src/Stub.ts`, laws on branch `fabrikalfa/reflect-s8`):

```ts
// readers.laws.test.ts, slice 1, a sketch: the world's platform objects
const sent: Array<string> = [];
let answer: unknown = { _tag: "parked", stream: "stream", after: 0 };
const socket = Stub.make<WebSocket>(unexpected, {
  deserializeAttachment: () => attached,
  serializeAttachment: (value: unknown) => void (attached = value),
  send: (text) => void sent.push(String(text)),
  close: () => {},
});
const ctx = Stub.make<DurableObjectState>(unexpected, {
  id: Stub.make<DurableObjectId>(unexpected, { name }),
  storage: Stub.make<DurableObjectStorage>(unexpected, { sql, transactionSync: sql.transaction }),
  getWebSockets: () => [socket],
  getTags: () => tags,
  getWebSocketAutoResponseTimestamp: () => null,
  acceptWebSocket: () => {},
  setWebSocketAutoResponse: () => {},
});
const route = async (): Promise<unknown> => answer;
// The world answers `answer(next)` to set the route's next answer, and `sent` to read the frames.
```

- The two `as unknown as` casts at `readers.laws.test.ts:303` and `:305`, and the one on `env`, go
  with the hand objects. `Stub.make` holds the one cast, in the test package.
- A getter the world needs (`id.name` reads the law's `name` after a change) is a getter in `own`,
  since `Partial<A>` takes one.

Slice 2's product changes, all sketches:

**The watched calls, through services (amendment 2026-11-15).** The first sketch exported
`dispatch` and `ready` and had each law run them on its own. That kept the typed exit but dropped
what the spy also held: that the request path asked exactly once, with exactly the value the law
sent. The merge session ruled the call goes through a typed service with a `Recorder` in the law
(0555). The service names are a sketch; the build may rename them, and a glossary row follows if
they stay.

```ts
// next/packages/libfabrika/src/cloudflare/Dispatcher.ts, the contract only (0095). A sketch.
export class Dispatcher extends Context.Service<
  Dispatcher,
  {
    /** Runs one control request against the bindings: the typed table reflect slice 10 leaves. */
    readonly dispatch: (
      env: Env,
      programs: Readonly<Record<string, ProgramSource>>,
      input: typeof Request.Type,
    ) => Effect.Effect<unknown, LedgerError>;
  }
>()("@kampus/libfabrika/cloudflare/Dispatcher") {
  // The live member is today's `dispatch` body; `Context.Reference` would hide the seam, so it
  // is a service the Worker provides once, beside the others in `runtime.ts`.
  static readonly layer: Layer.Layer<Dispatcher>;
}
// control.ts:162 becomes `yield* Effect.result((yield* Dispatcher).dispatch(env, programs, input.success))`

// next/packages/libfabrika/src/cloudflare/Waits.ts, the contract only. A sketch.
export class Waits extends Context.Service<
  Waits,
  {
    /** Decodes a ready RPC answer: `LedgerError` `bad_row` for a malformed one, never a defect. */
    readonly ready: (raw: unknown) => Effect.Effect<typeof Waited.cases.ready.Type, LedgerError>;
  }
>()("@kampus/libfabrika/cloudflare/Waits") {
  static readonly layer: Layer.Layer<Waits>;
}
// `wait` ends with `return yield* (yield* Waits).ready(answer.result);`
```

**Amendment (2026-11-16 Pacific, the lead's ruling, after slice 2's tests step):** the
`static readonly layer` lines above are wrong. [0095](../../../.decisions/0095-a-service-file-holds-only-its-contract.md)
is in force and covers this case: a service file holds only its contract, and each layer is its own
sibling file, read through its module as `LedgerSql.layer` is. So `Dispatcher.ts` and `Waits.ts`
hold the contract and nothing that runs, and their live layers go in `DispatcherLive.ts` and
`WaitsLive.ts`, named as `HandsTasksLive.ts` and `MailDeliveryLive.ts` are. The laws' imports
change with them (the tests rows below). The providers are not in `runtime.ts`, as first written:
`next/apps/fabrika/src/brain.ts` runs `control` and provides `DispatcherLive.layer`, and
`ConnectionObject.ts` provides `WaitsLive.layer`. The object implementations the four
`./objects.ts` mocks stood in for live in `record.ts` and `ProcessObject.ts`, not in `objects.ts`,
so the code's names win: `recordPartImplementation` and `ProcessObject.implementation`
("implementation" is Alchemy's word for what `.make()` takes).

```ts
// next/packages/libfabrika/src/cloudflare/Waits.ts: the contract only (0095). A sketch.
export class Waits extends Context.Service<Waits, {
  readonly ready: (raw: unknown) => Effect.Effect<typeof Waited.cases.ready.Type, LedgerError>;
}>()("@kampus/libfabrika/cloudflare/Waits") {}

// next/packages/libfabrika/src/cloudflare/WaitsLive.ts: its live layer, today's ready decode.
export const layer: Layer.Layer<Waits> = Layer.succeed(Waits, { ready: /* the decode */ });

// next/packages/libfabrika/src/cloudflare/DispatcherLive.ts: today's `dispatch` body.
export const layer: Layer.Layer<Dispatcher> = Layer.succeed(Dispatcher, { dispatch: /* ... */ });

// a law: the Recorder wraps the live member, read once from the live layer
const live = yield* Waits.pipe(Effect.provide(WaitsLive.layer));
const waits = Recorder.layer(Waits, live);
```

```ts
// readers.laws.test.ts, the ready law, slice 2. A sketch: no spy, no `vi.mock("effect")`.
const waits = Recorder.layer(Waits, live); // `live` is WaitsLive.layer's own member, read once (amended 2026-11-16, 0095)
// ...send the ledger.wait frame inside Effect.provide(waits), as today...
const calls = yield* Recorder.calls(Waits, "ready");
expect(calls).toEqual([[raw]]); // asked once, with exactly the law's raw value
typed(yield* Effect.exit(live.ready(raw))); // the typed failure the spy read, from the member itself
```

- The Recorder records the call; it does not record the exit (`Recorder.ts`, `Call<S>` is
  `{ method, args }`). So each law reads the call from the Recorder and the exit from the live
  member run on the recorded args. Together that is what `Effect.result`'s spy gave: one attempt,
  and its exit typed.
- The two References below stay for the span sink and the runner: those are layer makers a law
  swaps whole, not calls a law watches.

```ts
// next/packages/libfabrika/src/cloudflare/runtime.ts: the two parts a law hands in
/** How a Process object builds its span sink: the live sink unless a law provides another. */
export const SinkLayer = Context.Reference<typeof SpanSink.layer>("@kampus/libfabrika/cloudflare/SinkLayer", {
  defaultValue: () => SpanSink.layer,
});

/** How a Process object builds its program runner: the live one unless a law provides another. */
export const RunnerLayer = Context.Reference<typeof ProgramRunner.withLoader>(
  "@kampus/libfabrika/cloudflare/RunnerLayer",
  { defaultValue: () => ProgramRunner.withLoader },
);

// recordingLayer reads `yield* SinkLayer` in place of naming SpanSink.layer; processLogic reads
// `yield* RunnerLayer` in place of naming ProgramRunner.withLoader. The live Worker provides
// neither, so it runs as on main.

// checkedPut, and the key fingerprint at runtime.ts:808, hash through Effect's reference
const crypto = yield* WebCrypto.WebCrypto;
// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", copy), catch: fail });
```

```ts
// alarm.laws.test.ts, slice 2, a sketch: the law hands in the two parts, no spy
const layer = processLayer(state, environment, {}).pipe(
  Layer.provide(Layer.succeed(SinkLayer, () => Layer.succeed(SpanSink, quietSink))),
  Layer.provide(Layer.succeed(RunnerLayer, () => capturingRunner(captured))),
);
const runtime = yield* Effect.acquireRelease(
  Effect.sync(() => SettingsRuntime.runtime(layer)),
  (runtime) => runtime.disposeEffect,
);

// error-cause.test.ts C1, slice 2: a crypto whose digest rejects, handed in
const rejectingCrypto = Stub.make<typeof globalThis.crypto>(unexpected, {
  subtle: Stub.make<SubtleCrypto>(unexpected, { digest: () => Promise.reject(failure) }),
});
const error = yield* Effect.flip(checkedPut(bucket, key, body, "00")).pipe(
  Effect.provide(WebCrypto.layer(rejectingCrypto)),
);
```

- The References and the exports are placed by
  [0095](../../../.decisions/0095-a-service-file-holds-only-its-contract.md): if the layer check
  or `fabrika/modules` wants the two References in a front file of their own, the build puts them
  in `cloudflare/ProcessParts.ts` and says so. An unused export fails lint (0006). `Dispatcher` and
  `Waits` are front files of the `cloudflare` module, each used by its product caller
  (`control.ts`, `connection.ts`) and provided by `runtime.ts`, so neither is an export only a law
  reads (amendment 2026-11-15; the first sketch exported `dispatch` and `ready` instead).
- **Is this a setting?** No, for each choice. The References, the exports and the fakes are how
  code and laws are put together. Nothing here is a value a person running fabrika picks (0069).

The lock (amendment 2026-11-15: it does not land in this sweep, see "The other `vi` hits 0555
bans"; this is the shape it lands with, whole, the day the folder is at zero):

```jsonc
// .oxlintrc.json, a new override block, a sketch. Amendment 2026-11-15: the whole folder, on the
// day it is at zero for all five; no file list in between (0524).
{
  "files": ["next/packages/libfabrika/src/cloudflare/**"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        // Amendment 2026-11-15, ruling 2: all five methods, with node's five messages.
        "fn": "A stand-in for a platform object is Stub.make; a watched call is a Recorder (0557, 0579).",
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it with a Recorder (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
      }
    ],
    "vitest/no-restricted-matchers": [
      "error",
      {
        "toHaveBeenCalled": "Read Recorder.calls inside the provide (0579).",
        "toHaveBeenCalledTimes": "Read Recorder.calls inside the provide (0579).",
        "toHaveBeenCalledWith": "Read Recorder.calls inside the provide (0579).",
        "toHaveBeenLastCalledWith": "Read Recorder.calls inside the provide (0579).",
        "toHaveBeenNthCalledWith": "Read Recorder.calls inside the provide (0579)."
      }
    ]
  }
}
```

- **Amendment (2026-11-15, merge session ruling 2): one lock shape everywhere.** `mock` is now in
  the list, so the block refuses all five methods, as every block of the sweep does, and its law is
  node's M1 ([`mock-node-PLAN.md`](./mock-node-PLAN.md), "Laws"). The first sketch left `mock` out
  because 12 calls stay in the folder for the Alchemy and objects slices. With `mock` in, the
  block lands only when the whole folder is at zero, which is not in this sweep (the laptop lead's
  ruling, 2026-11-15; no interim block, 0524).
  `stubGlobal` stays out of the list until its last call goes.
- If another folder's sweep lands this rule first, slice 2 adds its paths to that block's `files`,
  and that block's messages hold.
- **The plants are node's `VI_METHODS`** (amendment 2026-11-15, ruling 2), the one set every block's
  M1 runs, in place of a `VI_BAN` of this plan's own. This plan's lines that set lacks join it:
  `vi["fn"]()` and a renamed import `import { vi as v }` then `v.fn()`. `plants.test.ts` runs the
  set in every folder of every block that sets the rule, the way it runs `REFLECT`
  (`plants.test.ts:532`). The matcher lines below stay this plan's own, since only this block and
  transport's set `no-restricted-matchers`. It adds no `LOCKED` row to the Effect checks' own test.

**Amendment (2026-11-16, lead ruling): the lock is a pair.** oxlint's
`vitest/no-restricted-vi-methods` does not refuse a call chained onto the `vi` call, in oxlint
1.90.0 (the lockfile's) and 1.93.0 alike: `vi.spyOn(console, "warn").mockImplementation(() => {})`
and `vi.fn().mockReturnValue(1)` pass, while the same call in parentheses is refused. The proof is
the last `false` lines of `VI_METHODS` in `oxlint-plugins/builtin-plants.ts` on
`fabrikalfa/mock-app-e2e-s1` at `f02b31948`, and the row
`field/runs/2026-11-15-mock-app-e2e-tests1.json`. So every block of the lock sets two of oxlint's
own rules over the same files: `vitest/no-restricted-vi-methods`, kept on as it is, and the
built-in `eslint/no-restricted-properties` with one `object: "vi"` entry for each member the
block bans, each with the same message as that member's entry in the vitest rule.
`no-restricted-properties` matches the member access `vi.spyOn` itself, so it refuses the call
with another call chained on; the vitest rule keeps what only it sees, such as `v.spyOn` after
`import { vi as v }`. Both are trusted rules, as
[0573](../../../.decisions/0573-trusted-lint-rule-replaces-ours.md) asks, and no rule of ours is
written. The upstream issue is [oxc#29656](https://github.com/oxc-project/oxc/issues/29656),
filed by the lead: `vitest/no-restricted-vi-methods` misses chained calls. The
`no-restricted-properties` half stays until oxc fixes it.

The folder's lock still does not land in this sweep (the laptop lead's ruling of 2026-11-15); this is the shape it lands with, whole, the day the folder is at zero.

```jsonc
// .oxlintrc.json, the lock as a pair (amendment 2026-11-16, lead ruling). A sketch; `vitest/no-restricted-matchers` stays as above.
{
  "files": ["next/packages/libfabrika/src/cloudflare/**"],
  "rules": {
    // Kept on as it is: the same members, with the same messages as below.
    "vitest/no-restricted-vi-methods": ["error", { /* fn, mock, doMock, spyOn, stubEnv */ }],
    "eslint/no-restricted-properties": [
      "warn",
      // Written out again, since an override replaces options: the `JSON.parse` entry, and on the folder's files but `*.test.ts` the two `process` entries of M13, the way M13's own block leaves test files out.
      { "object": "vi", "property": "fn", "message": "A stand-in for a platform object is Stub.make; a watched call is a Recorder (0557, 0579)." },
      { "object": "vi", "property": "mock", "message": "Give the code a service and provide a test layer (0555)." },
      { "object": "vi", "property": "doMock", "message": "Give the code a service and provide a test layer (0555)." },
      { "object": "vi", "property": "spyOn", "message": "Put the call behind a service and record it with a Recorder (0555, 0579)." },
      { "object": "vi", "property": "stubEnv", "message": "Read through Config and provide a ConfigProvider layer (0555)." }
    ]
  }
}
```

- **The `vi` entries join the list these files already take.** A block's options for a rule
  replace an earlier block's, they do not merge, and oxlint takes the last matching block's. So the
  lock's `no-restricted-properties` list writes out again every entry its files take today, at that
  block's level, and the lock's block sits after that block, the way the Reflect ban's blocks write
  out the `JSON.parse` entry (`.oxlintrc.json` on main at `b490a3203`). On main the folder takes the `warn` block that writes out `JSON.parse` alone; slice 1 adds M13's two `process` entries for its files but `*.test.ts`, so the lock writes those out again for the same files, in as many blocks as M13's shape needs. At `warn`, a `vi`
  fire still blocks: `pnpm lint` lets only a `JSON.parse` fire of this rule advise
  (0523, the advice map `pnpm lint` reads). No file loses an entry, and no file gains one but the
  `vi` entries. Whichever slice lands later carries the entries the others landed first: another folder's `vi` entries, or any new set.
- **The plant, red first.** The lock's law runs a second plant beside node's `VI_METHODS`:
  `VI_PROPERTIES`, under the code `eslint(no-restricted-properties)` as `REFLECT` is, in every
  path of every block that sets the vitest rule, through the same scenario. Refused:
  `vi.spyOn(console, "warn").mockImplementation(() => undefined)`, `vi.fn().mockReturnValue(1)`,
  and one plain call of each banned member. Taken: `vi.hoisted(() => 1)`, `vi.waitFor(() => 1)`,
  a comment, a string and `other.fn()`. A line is held by the lock when either plant refuses it.
  Red first: drop the block's `vi` entries from `no-restricted-properties`, and the two chained
  lines are not refused, so the law is red; with them back, it is green. The plants of the entries
  written out again, such as `REFLECT`, still pass in each locked path, which shows no entry was
  lost.
- **`VI_METHODS`' chained lines.** `VI_METHODS` keeps recording what the vitest rule does alone,
  so its chained lines stay `false` under its own code. They are no longer a miss of the lock: the
  pair refuses them, through `VI_PROPERTIES`.

## One value traced: a socket frame in the ready law

1. The law draws a malformed `raw`, such as `{ rev: "1" }`, and sets `w.answer({ _tag: "ok", result: raw })`.
2. It sends a `ledger.wait` frame through `gateway.message(socket, text)`.
3. `cloudflare/connection.ts`'s `wait` asks the fake project's `route`, which answers `w`'s value.
4. On main, the decode inside `wait` fails with `LedgerError` `bad_row`. In slice 2 that decode is
   `ready(raw)`.
5. `transport/Connection.ts:141` takes that typed failure as `Answer.refused` with reason
   `bad_row`, and the connection sends it.
6. The fake socket's `send` pushes the frame into `sent`. The law finds the `bad_row` reply there.
7. In slice 2 (amendment 2026-11-15), `wait` asks `Waits.ready(raw)`, and the law's
   `Recorder.layer(Waits, live)` records `{ method: "ready", args: [raw] }` before the live member
   runs. The law reads `Recorder.calls(Waits, "ready")` and finds exactly `[[raw]]`: one attempt,
   with the law's value. It then runs `live.ready(raw)` and checks its exit is a failure, with no
   defect, whose error is `LedgerError` `bad_row`. Together that is what `Effect.result`'s spy gave
   before.

## Laws

No law is loosened, deleted or renamed. Each row is a law that exists today. Its generator stays as
it is, and only how it watches changes. The reviewer runs the loosening check.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1. The law "Connection ready RPC decoding fails in the typed channel before the wait refusal is sent" (`readers.laws.test.ts:417`): the reply on the socket says `bad_row`, and in slice 2 (amendment 2026-11-15) `Recorder.calls(Waits, "ready")` is exactly `[[raw]]` and the live `ready(raw)` fails `LedgerError` `bad_row` with no defect. 6 runs fast, 20 runs full | test | fc.jsonValue: malformed `{ rev }` values, 6 runs fast and 20 runs full | (a) in `Waits.layer`'s `ready`, `Effect.orDie` in place of the `mapError` to `LedgerError`: M1 red on the typed exit; (b) `wait` decodes the answer inline, past `Waits`: `Recorder.calls` is `[]`, M1 red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M2. The laws "control bucket bytes fail as a typed parse error before its HTTP error response" (`readers.laws.test.ts:470`) and "control checks outside `<field>` as text instead of coercing it or throwing" (`:517`, one per field: head key, put key, put checksum): the response is 500 `bad_row`, and in slice 2 (amendment 2026-11-15) `Recorder.calls(Dispatcher, "dispatch")` holds exactly one call, whose input is the law's request, and the live `dispatch` on that input fails `LedgerError` `bad_row` with no defect. 5 runs fast, 20 runs full | test | fc.jsonValue: malformed bytes and keys, 5 runs fast and 20 runs full | (a) in the live `dispatch`, decode the bucket bytes with `Schema.decodeUnknownSync`, so a bad value dies: the `:470` law red; (b) coerce the field with `String(raw)` before the check: the `:517` law red, `dispatch` succeeds; (c) `control.ts` calls the dispatch body inline, past `Dispatcher`: `Recorder.calls` is `[]`, both red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M3. `processDescriptor` checks the saved value before returning it. 5 runs fast, 20 runs full | test | fc.jsonValue: malformed descriptors, 5 runs fast and 20 runs full | return `storage.get`'s value without its decode: M3 red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M4. Every other law of `readers.laws.test.ts` that builds the world keeps its checks on the `Stub.make` world, and any platform call the world does not give fails the law | test | scenario: the world's laws, each on its own generator, unchanged | make the fake socket's `send` drop its frame: M1 red; call `ctx.storage.list()` in `connectionRuntime`: `unexpected` throws, red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M5. t863 L1: only reserved answers tag the ended RPC span as refused, and there is one ended `runtime.rpc` span per routed call | test | Effect Arbitrary: AnswerWalk | tag `REFUSED` on a `rate_limited` answer too: M5 red; route one call outside its span: the span count is short, red | next/packages/libfabrika/src/cloudflare/connection.test.ts |
| M6. The settings entry flows keep the secret and error text out of every output: transport, RPC failures, span rows, Record calls, archives, HTTP replies, and every line Effect's `Console` gets | test | scenario: SettingsTest.suite, its recipes and secret | in `SettingsStartsLedger.ts`, `Effect.logError(cause)` on a refused start: M6 red through `TestConsole.errorLines`; set the secret as a span attribute: M6 red through the span rows | next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts |
| M7. The audit layer fails on any platform call its driver did not wire | test | scenario: the RunnerAdmission integration law, unchanged | read `ctx.storage.get` in the audit path: the `Stub.make` guard throws, red | next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts |
| M8. A1 and A2: supported alarm operations keep the logical wake and set or clear the platform alarm; a failing alarm dies, one that is done ran its saved wake once | test | fc.gen: the alarm moves, and fc.array: Delivery, default runs | make `processLogic` name `ProgramRunner.withLoader` again, past `RunnerLayer`: the law gets no `Alarm`, red at its timeout | next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts |
| M9. Law 3 on the Process shell and the request slot keep their checks with the two References handed in | test | fc.record: the bad settings and requests, default runs | make `recordingLayer` name `SpanSink.layer` again, past `SinkLayer`: the fake SQL refuses the sink's tables, red | next/packages/libfabrika/src/cloudflare/ObjectService.test.ts |
| M10. C1: a bucket put whose digest rejects fails `crypto` with the rejected value as its cause | test | fc.record: failure, body and key, default runs | make `checkedPut` call `globalThis.crypto.subtle.digest` again: the real digest answers, C1 red | next/packages/libfabrika/src/cloudflare/error-cause.test.ts |
| M11. No file in the folder calls `vi.fn`, `vi.spyOn`, `vi.doMock` or `vi.stubEnv`, or uses a `toHaveBeenCalled*` matcher; each file at zero for all five also refuses `vi.mock`; this is node's M1 (amendment 2026-11-15, ruling 2): each `VI_METHODS` line is refused or taken exactly, in each path of every block that sets the rule. Amendment 2026-11-15 (the laptop lead's ruling): M11 does not land in this sweep; it lands with the lock, whole, once the folder's last `cloudflare:workers` mock goes | lint | lint | delete `fn` from the block in `.oxlintrc.json`: `plants.test.ts`'s `VI_METHODS` scenario red. Amendment 2026-11-16 (lead ruling): the lock is the pair, and this law also runs `VI_PROPERTIES` (see the lock's amendment): drop the block's `vi` entries from `eslint/no-restricted-properties`, and its chained lines are not refused, red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| M12. No product file in `next/packages/libfabrika/src` calls `console`, held by oxlint's built-in `eslint/no-console` at error, not a rule of ours (amendment 2026-11-16, merge session ruling); its plant lines are refused in a libfabrika product path and taken in a test path | lint | lint | drop the libfabrika glob from the `no-console` block: the planted `console.log(secret)` in a product path is taken, the plant scenario red | .oxlintrc.json, oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| M13. No file under `next/packages/libfabrika/src` but a `*.test.ts` file reads `process.stdout` or `process.stderr`, held by oxlint's built-in `eslint/no-restricted-properties` at error (amendment 2026-11-15, owner ruling); its plant lines `process.stdout.write(secret)` and `process.stderr.write(secret)` are refused in a libfabrika product path and in a `*.test-support.ts` path, and taken in a `*.test.ts` path; every exception line is listed below with its reason, and no other disable line names the rule's `process` entries | lint | lint | (a) drop the two `process` entries from one of the five blocks that set the rule for a libfabrika path: the planted write in that block's paths is taken, red; (b) add a block for libfabrika after the others that lists only the two `process` entries: the `JSON.parse` plant in its paths is taken, red (an override replaces options); (c) add a `process.stdout.write(cause)` to `SettingsStartsLedger.ts`: `pnpm lint` red | .oxlintrc.json, oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |


- **M13 (amendment 2026-11-15, owner ruling).** On main at `0683861`,
  `rg -n 'process\.(stdout|stderr)' next/packages/libfabrika/src --glob '!*.test.ts'` finds one
  line, so the ban is on at one known exception and no other hit:

  | Exception line | Reason, written on its disable line |
  |---|---|
  | `next/packages/libfabrika/src/node/client/JournalSqlite.child.test-support.ts:37`, `process.stdout.write("ready\n")` | `-- a child process's ready line on its own stdout, which the parent law reads as its start signal; it is the process's output channel, not a log` |

  No CLI final output or crash path in libfabrika writes raw today; a new one takes its own disable
  line with its reason, which review reads. Test files (`*.test.ts`) are left out, as `no-console`
  leaves them, since a law may read a child's output; the four that touch `process.stdout` or
  `process.stderr` on main lose their spies in this sweep (entry-flows here, node-client's S2) or
  read a child's stream.
- **Where the entries go.** `eslint/no-restricted-properties` is already set by five override
  blocks that reach libfabrika paths (`.oxlintrc.json` at `0683861`: the `next/**/*` block with
  `JSON.parse`, the `client/**` block with the dial retries, and the three later blocks that list
  libfabrika folders by name). oxlint takes the last matching override's options for a rule, so
  a new block would drop their entries for its files. The two `process` entries are added to each
  of those five blocks instead, with one message: "Write through Effect's Console; a raw stdout or
  stderr write takes a disable line with its reason (owner ruling, 2026-11-15)." For the
  `next/**/*` block, which also reaches the app and test files, the entries go into a copy of it
  scoped to `next/packages/libfabrika/src/**` with `*.test.ts` left out, placed right after it.
  M13's plant (b) holds that no entry is lost.
- M12 is new (amendment 2026-11-16). It is what lets the `console` spy go in slice 1 without M6
  losing a raw `console` write: a raw call cannot land at all. `no-console` is oxlint's own rule
  (installed oxlint 1.90.0), not a plugin rule of ours, by the merge session's ruling.
- M1, M2, M5 and M6 lose a spy and keep what it checked. M1 and M2 still check the typed failure,
  now on the live member's own exit, and (amendment 2026-11-15) still check the one attempt with
  its value, now on the Recorder's record. M5 still checks each ended span. M6 still reads every
  output the flow can write: the `process` spies give way to M13 (amendment 2026-11-15, owner ruling).
- **M6 reads every `Console` method the spies read** (amendment 2026-11-15, ruling 4: coverage is
  never lost). The `console` spy watched five methods. `TestConsole` reads back `log` and `error`
  on main; app-e2e's patch adds `warnLines`
  ([`mock-app-e2e-PLAN.md`](./mock-app-e2e-PLAN.md), law L3), and `info` and `debug` need readers
  of the same shape. The first of the sweep's slices to drop a five-method `console` spy adds
  `infoLines` and `debugLines` to that same `patches/effect@4.1.3.patch`, with a law beside L3 in
  `scripts/effect-testconsole.test.ts`; a later one reads them. M6 then reads all five. Its plant
  adds `yield* Console.info(secret)` on the flow: red only through `infoLines`.
- The matcher lines and the forms node's set lacks: `expect(f).toHaveBeenCalled()`,
  `expect(f).not.toHaveBeenCalledWith(1)`, `vi["fn"]()` and a renamed import `import { vi as v }`
  then `v.fn()` are refused, and `expect(x).toBe(1)` is taken. The first sketch planted
  `vi.mock(...)` as taken; with ruling 2 it is refused in every listed path. 0555 marks the renamed
  import as untested, so its line records what oxlint does. If oxlint misses it, the line is a
  documented miss, as `REFLECT` keeps one.
- No law needs the real machine, so none is host-only. The one `.integration.` law the files reach,
  `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts`, reads
  `ProjectAuditTest.ts`. Each step runs it once after the change.
- No law reads a secret of the person's, so no `[secrets]` flow is needed. M6's secret is the
  suite's own generated one.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/cloudflare/readers.laws.test.ts | tests | tests | slice 1: the world on `Stub.make`, 6 `vi.fn` go (M3, M4); slice 2: the 3 `Effect.result` spies and `vi.mock("effect")` go (M1, M2); (amendment 2026-11-16, 0095) M1 and M2 import `WaitsLive` and `DispatcherLive` for the live members, and the RecordPart path runs `recordPartImplementation` |
| next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts | tests | tests | slice 1: 2 `vi.fn` go, the guard is `Stub.make`'s `rest` (M7) |
| next/packages/libfabrika/src/cloudflare/connection.test.ts | tests | tests | slice 1: the `ProjectClient.make` spy goes, spans read from the records (M5); slice 2 (amendment 2026-11-16): provides `WaitsLive.layer` under `connectionLayer` (about line 182) |
| next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts | tests | tests | slice 1: the span attribute spy and (amendment 2026-11-16) the `console` spy go; and (amendment 2026-11-15, owner ruling) the `stdout` and `stderr` spies go, held by M13 (M6) |
| next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts | tests | tests | slice 2, after 1366: 4 spies go (M8); (amendment 2026-11-16) A2 runs `ProcessObject.implementation` |
| next/packages/libfabrika/src/cloudflare/ObjectService.test.ts | tests | tests | slice 2, after 1366: 2 spies go (M9); (amendment 2026-11-16) runs `ProcessObject.implementation` |
| next/packages/libfabrika/src/cloudflare/error-cause.test.ts | tests | tests | slice 2: the `crypto.subtle` spy goes (M10); (amendment 2026-11-16) provides `WaitsLive.layer` under `connectionLayer` (about line 331) |
| next/packages/libfabrika/src/cloudflare/objects.ts | build | 0 | (amendment 2026-11-16) not changed: the implementations live in `record.ts` and `ProcessObject.ts`, the two rows below |
| next/packages/libfabrika/src/cloudflare/record.ts | build | 3 | slice 2 (amendment 2026-11-16, the code's name): `export const recordPartImplementation`, the Effect handed to `RecordPart.make`, and `RecordPartLive = RecordPart.make(recordPartImplementation)` |
| next/packages/libfabrika/src/cloudflare/ProcessObject.ts | build | 8 | slice 2 (amendment 2026-11-16, the code's name): `export const implementation = (options) => Effect.gen(...)`, with `layer = (options) => Process.make(implementation(options))`; it reads `SinkLayer` and `RunnerLayer` in its own Effect and hands them to `processLayer` |
| next/packages/libfabrika/src/cloudflare/ConnectionObject.ts | build | 2 | slice 2 (amendment 2026-11-16): provides `WaitsLive.layer` (about line 71) |
| next/apps/fabrika/src/brain.ts | build | 2 | slice 2 (amendment 2026-11-16): provides `DispatcherLive.layer` where it runs `control` (about line 342) |
| next/packages/libfabrika/package.json | build | 1 | slice 2 (amendment 2026-11-16): exports `Waits` and `WaitsLive` (for example under `./workers/`), so the door law can provide them |
| next/apps/fabrika/src/door.integration.test.ts | tests | tests | slice 2 (amendment 2026-11-16): the `connectionLayer` it builds (about line 819) gets `WaitsLive.layer` at run time |
| next/packages/libfabrika/src/cloudflare/reload.laws.test.ts | tests | tests | slice 2 (amendment 2026-11-16): L12's `ask` helper provides `DispatcherLive.layer` under `control` |
| next/packages/libfabrika/src/cloudflare/control.ts | build | 4 | slice 2 (amendment 2026-11-15): `dispatch`'s body moves to `DispatcherLive.layer` (amended 2026-11-16, 0095); `parserControl` yields `Dispatcher`, which stays in `control`'s requirements |
| next/packages/libfabrika/src/cloudflare/connection.ts | build | 4 | slice 2, after 1366 (amendment 2026-11-15): the ready decode moves to `WaitsLive.layer` (amended 2026-11-16, 0095); `wait` yields `Waits`, which stays in `connectionLayer`'s requirements; `connectionRuntime` provides `WaitsLive.layer` |
| next/packages/libfabrika/src/cloudflare/fetch.test.ts | tests | tests | read only, not changed: the folder's one file with no `vi.mock` today (amendment 2026-11-15; the lock no longer lists single files) |
| next/packages/libfabrika/src/cloudflare/Dispatcher.ts | build | 8 | slice 2, new (amendment 2026-11-15; amended 2026-11-16 for 0095): the contract only |
| next/packages/libfabrika/src/cloudflare/DispatcherLive.ts | build | 10 | slice 2, new (amendment 2026-11-16, 0095): the live layer, today's `dispatch` body |
| next/packages/libfabrika/src/cloudflare/Waits.ts | build | 6 | slice 2, new (amendment 2026-11-15; amended 2026-11-16 for 0095): the contract only |
| next/packages/libfabrika/src/cloudflare/WaitsLive.ts | build | 8 | slice 2, new (amendment 2026-11-16, 0095): the live layer, today's ready decode |
| patches/effect@4.1.3.patch | tests | 12 | slice 1 (amendment 2026-11-15), only if no earlier slice of the sweep added them: `infoLines` and `debugLines` beside app-e2e's `warnLines`, with `pnpm patch` |
| patches/effect | tests | tests | the patch's name as pnpm writes it; the one file above |
| scripts/effect-testconsole.test.ts | tests | tests | slice 1, with the readers above: their law, beside app-e2e's L3 |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 26 | slice 2, after 1366: `SinkLayer` and `RunnerLayer` with doc blocks, read where `SpanSink.layer` and `ProgramRunner.withLoader` are named; the two digests read `WebCrypto.WebCrypto`; (amendment 2026-11-15, amended 2026-11-16) provides neither service layer: `brain.ts` provides `DispatcherLive.layer` and `ConnectionObject.ts` provides `WaitsLive.layer` |
| .oxlintrc.json | tests | 32 | (amendment 2026-11-15) not the lock block, which waits for the folder to reach zero after this sweep; slice 1 (amendment 2026-11-16): an `eslint/no-console` block at error for `next/packages/libfabrika/src/**`, test files left out (M12), about 8 lines; slice 1 (amendment 2026-11-15): the two `process` entries in the five `no-restricted-properties` blocks that reach libfabrika, and a libfabrika copy of the `next/**/*` block (M13), about 24 lines |
| oxlint-plugins/builtin-plants.ts | tests | tests | slice 2: M11's lines in node's `VI_METHODS` set (amended 2026-11-15; first `VI_BAN`); slice 1: the `no-console` plant lines (M12, amendment 2026-11-16) and the `process` write plant lines (M13, amendment 2026-11-15); and (amendment 2026-11-16, lead ruling) the `VI_PROPERTIES` plant, the lock's other half |
| oxlint-plugins/plants.test.ts | tests | tests | slice 2: node's M1 scenario (M11); slice 1: the `no-console` scenario (M12) and the `process` write scenario over every block that sets the rule (M13, amendment 2026-11-15) |
| next/packages/libfabrika/src/node/client/JournalSqlite.child.test-support.ts | tests | tests | slice 1 (amendment 2026-11-15): the one exception line, a disable line with its written reason above `process.stdout.write("ready\n")` (M13) |
| next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts | tests | tests | unchanged; run once in slice 1, since it reads `ProjectAuditTest.ts` (M7) |
| next/AGENTS.md | build | docs | slice 2: a "What lint holds" row for the vi ban, naming the folders it is on for |
| oxlint-plugins/README.md | tests | docs | slice 2: the two vitest rules and their messages |

- Every file is in libfabrika's `cloudflare/` module or in the lint tooling, where it is today.
  `next/AGENTS.md`'s libfabrika test needs no move: no file moves.
- Slice 1's files are none of pull request 1366's 57. Slice 2's `alarm.laws.test.ts`,
  `ObjectService.test.ts`, `connection.ts` and `runtime.ts` are in 1366's diff.
  `error-cause.test.ts` and `readers.laws.test.ts` are not, but their product changes are in
  `runtime.ts` and `connection.ts`.

## How this orders with reflect slice 10

Reflect slice 10 ([`reflect-ban-PLAN.md`](./reflect-ban-PLAN.md), "Waiting") also works in this
folder. It waits for the quotas slice (1366) and reflect slice 8, and it edits `control.ts`,
`readers.laws.test.ts`, `ObjectService.test.ts`, `error-cause.test.ts` and `alarm.laws.test.ts`.

1. **Reflect slice 8 lands** (`Stub.make` in `next/packages/vitest`). Its tests step is on
   `fabrikalfa/reflect-s8`. Mock slice 1 waits for it, since its fakes are `Stub.make`.
2. **Mock slice 1 lands** before 1366 if 1366 is still open. It touches none of 1366's files, and
   it moves `readers.laws.test.ts`'s world onto `Stub.make`. Reflect slice 10's plan already says
   its counts are taken again when it starts, so it starts from this world.
3. **Pull request 1366 lands.**
4. **Reflect slice 10 lands.** It rewrites `control.ts`'s dispatch as a typed table, and moves the
   guards in `alarm.laws.test.ts` and `ObjectService.test.ts` onto `Stub.make`.
5. **Mock slice 2 lands** last. It moves the `dispatch` that slice 10 leaves into `Dispatcher`
   (amendment 2026-11-15; first written as "exports"), takes its spies
   out of the tests slice 10 left, and turns the lock on. Going after slice 10 means `control.ts`
   is edited once by each and no guard is rewritten twice (80%).

If reflect slice 10 is not ready when 1366 lands, mock slice 2 may go first. Slice 10 then rebases
over the moved `dispatch` and the removed spies. The lead picks the order on the day.

## Calls taken

- **The 8 `vi.fn` become `Stub.make` fakes, not Recorder layers,** 85%. They are platform objects,
  and 0554 and 0557 put such fakes in the test package. What a fake was handed (sent frames) is its
  state, which the pattern doc keeps in a fake.
- **The `Effect.result` spies go through two typed services, `Dispatcher` and `Waits`, recorded
  with a `Recorder`** (amendment 2026-11-15, merge session ruling, no longer a call; the first lean,
  running the exported Effect on its own, is marked wrong: it dropped the one-attempt check). Each
  law reads the call from the Recorder and the exit from the live member. The names are a sketch,
  80%. The wire and HTTP laws keep their end-to-end checks.
- **`crypto.subtle` moves behind Effect's `WebCrypto` reference,** 85%. It is Effect's own, it is
  what `Digest` uses, and `Digest` would turn a rejected hash into a defect, which C1 says it is not.
- **Two References for the span sink and the runner,** 75%. See the doubts.
- **Slice 1 waits for reflect slice 8, and slice 2 for 1366 and reflect slice 10,** 80%. See the
  order above.
- **The lock leaves `mock` and `stubGlobal` out until their last call goes,** 85%. 0524 bans a list
  of allowed leftovers. This is a narrower rule, on at zero for what it names.
- **What fact is lost if not recorded now?** None. These are test and wiring changes, and no data
  is stored.
- **Raw `console` in libfabrika's product code is held by oxlint's built-in `no-console`** (amendment
  2026-11-16, merge session ruling, no longer a call): no rule of ours is written for it.
- **Is the `no-console` block a setting?** No. It is lint config for code, nothing a person running
  fabrika picks (0069).

## Validation

- The tests step, each slice: `pnpm format`, then `pnpm lint` with
  `NODE_OPTIONS=--max-old-space-size=6144`, then
  `nice -n 15 pnpm exec vitest run --maxWorkers=3` on each test file in that slice's files table,
  plus `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts` in slice 1 and
  `oxlint-plugins/plants.test.ts` in slice 2 and (amendment 2026-11-16, for M12) in slice 1. Each plant above is run once and named in the report.
- The build, slice 2: the same narrow paths.
- The lead runs the changed-files run and the one type check.

## Steps

**Amendment (2026-11-15, merge session ruling 1): one pull request for the sweep.** Neither slice
opens a pull request of its own. Each lands on the mock sweep's one fold branch,
`fabrikalfa/mock-fold`, and in its one pull request (0589, amended 2026-11-15). Each slice still
runs its own steps, one fresh agent each, in its own box, before it is folded:

1. **Tests:** the slice's laws and plants, each plant run once and recorded in the run row.
2. **Build:** slice 1 has no product file, so its build changes nothing, says so, and runs the
   slice's checks green at the tests step's head (or sends back). Slice 2 writes the services, the
   References, the `WebCrypto` reads and (amendment 2026-11-15) the object exports that let the
   four `./objects.ts` mocks go.
3. **Review:** the one review of the slice's diff, with the loosening check.

## Size

Confidence in the line counts: 70%. The doubt is the world rewrite in `readers.laws.test.ts`, the
longest test file here.

Both slices land on `fabrikalfa/mock-fold`, the sweep's one fold branch, in its one pull request
(amendment 2026-11-15, ruling 1).

1. Slice 1, the test-only fakes and the spans: no product code, about 120 test lines changed, and
   (amendment 2026-11-16) about 8 lines of `no-console` config, with its plants, and (amendment
   2026-11-15) the two `TestConsole` readers if no earlier slice added them, about 12 lines, and
   (amendment 2026-11-15, owner ruling) about 24 lines of `process` entries and one disable line,
   with their plants. 44 lines.
2. Slice 2, after 1366 and reflect slice 10: the two services (amendment 2026-11-15), the two
   References, the `WebCrypto` reads, and (amendment 2026-11-15) the object exports for the four
   `./objects.ts` mocks and the `vi.mock("effect")` removal; no lock, which waits for the
   `cloudflare:workers` work. About 70 product lines, about 190 test lines. 70 lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder
plan priced them. Slice 1 has a tests step (about $6), a build that only runs checks ($2,
amendment 2026-11-15, ruling 5) and a review ($3). Slice 2 has tests ($7), a build ($6, two
services more than first sized), a review ($3) and one likely fix round ($4), for the References
doubt. Amendment 2026-11-15: the four `./objects.ts` mocks add about $2 to slice 2's tests and $1
to its build, and the lock's 30 config lines leave it.

Estimate: 7 steps, $34

## Records

- No decision file. This plan builds 0554, 0555, 0557 and 0579. The merge session's ruling of
  2026-11-16 answered the `console` half of its one question, and the owner's ruling of 2026-11-15,
  which the merge session records as a decision, answered the `process.stdout` and
  `process.stderr` half.
- No glossary row: no new word. `Stub` is reflect slice 8's. `Dispatcher` and `Waits` are code
  names; if the build keeps them, slice 2 adds one row each (amendment 2026-11-15).
- The merge session's rulings of 2026-11-15 are amendments here: one pull request for the sweep,
  one lock shape, the `Effect.result` spies through services, and coverage never lost (M6's five
  readers). Its open question 2 was answered by the laptop lead the same day: no interim lock, and
  the folder's lock stays out of this sweep.
- `field/`: one run row per step, the same day.
- The tracker ticket is 1067, the Recorder's, whose plan lists this folder as a later slice.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run.
- **Whether `Stub.make` takes a getter in `own`.** Reflect slice 8's sketch types `own` as
  `Partial<A>`. Its laws (on `fabrikalfa/reflect-s8`) were read only for their names.
- **Whether oxlint's `no-restricted-matchers` refuses `not.toHaveBeenCalled`** under the plain
  `toHaveBeenCalled` key. The matcher lines in `VI_METHODS` settle it (amended 2026-11-15; first `VI_BAN`).
- **Whether every `runtime.rpc` span of t863's walk reaches the span store.** See the doubts.
- **What pull request 1366 and reflect slice 10 will leave in these files.** Counts are from main
  at `f7169af`. The lead takes them again before slice 2's tests step.

## Open questions

None.

## Answered questions

2. **(Answered 2026-11-15 by the laptop lead: no interim lock, 0524; the sweep fixes the folder's
   `vi.mock` hits it can, and the folder's lock stays out of this sweep, since its seven
   `cloudflare:workers` mocks wait on 0042's Alchemy work. The lean was wrong.) For the merge
   session (amendment 2026-11-15): where do the files that still hold `vi.mock`
   keep their lock until their last call goes?** Ruling 2 puts all five methods in every block.
   Read as written, a file with a `vi.mock` that waits on Alchemy or the object exports cannot be
   in any block, so `fn`, `spyOn`, `doMock` and `stubEnv` are no longer refused there, which this
   plan held folder-wide. That loosens M11, so this amendment does not apply it. Lean, 80%: keep
   one interim block for those files, the four methods it had, with M1's plants for what it names
   and `vi.mock` recorded as taken there; each file moves to the five-method block the day its
   `vi.mock` goes, and the interim block goes with the last one. The same question stands in the
   app-src and node-dev plans. The other way: the folder waits for its `vi.mock` sweep before any
   lock, and new `vi.fn` or `vi.spyOn` lines can land until then.

**Amendment (2026-11-15, owner ruling, relayed by the merge session):** question 1 is answered
whole. Its `console` half was ruled on 2026-11-16 (M12). Its `process.stdout` and `process.stderr`
half: raw writes are banned across libfabrika with oxlint's built-in
`eslint/no-restricted-properties`, every write goes through Effect's `Console`, and a real exception
takes a disable line with a plain written reason (M13, slice 1). The lean held. The question is kept
as it was asked.

1. **Does a lint rule hold that libfabrika's product code writes no raw `console` call and no
   `process.stdout` or `process.stderr` write?** The entry-flows leak law (M6) spies on all three
   today, so a secret written raw would turn it red. With the spies gone, `TestConsole` sees only
   what goes through Effect's console. Product code in `next/packages/libfabrika/src` has no raw
   write today (0 hits of `rg 'console\.|process\.(stdout|stderr)'` outside tests). The lean is
   yes, 80%: `eslint/no-console` and a `no-restricted-properties` entry for `process.stdout` and
   `process.stderr`, on for libfabrika's non-test files at zero, held by a plant in `VI_BAN`'s
   style, in slice 1. It is the owner's because it adds a rule over the whole package, beyond this
   folder. If the answer is no, the three spies still go (0555), and the review records that M6 no
   longer sees a raw write.

   **Amendment (2026-11-16, merge session ruling):** the `console` half is answered: oxlint's
   built-in `no-console` rule, not a rule of ours (M12, slice 1). What stays open is only the
   `process.stdout` and `process.stderr` half: does a `no-restricted-properties` entry for them go
   on for libfabrika's non-test files, or do their two spies go with M6 no longer seeing a raw
   write? The lean for that half is unchanged: the entry, 80%. (Answered 2026-11-15: the entry,
   by the owner's ruling.)

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-control-reason-ternary-repeats-its-test", "date": "2026-11-15", "by": "plan", "model": null, "rule": "duplicate", "location": {"path": "next/packages/libfabrika/src/cloudflare/control.ts", "line": 169}, "says": "In next/, control.ts picks the HTTP error's reason with a ternary whose second branch repeats the first branch's test word for word, so the second branch never runs and the chain reads as if it checks two things.", "proof": "At f7169af, control.ts lines 169 and 171 are the same test, `typeof answer.failure === \"object\" && answer.failure !== null && \"reason\" in answer.failure`, in one chain that ends in `unreachable`.", "cost": "A reader looks for a second case that is not there; any later fix to one copy misses the other.", "head": "f7169afeed0c2f56b7ba6a6d0dce8eac669de149", "ticket": null, "pr": null}
{"_tag": "finding", "id": "2026-11-15-cloudflare-workers-mocks-have-no-slice", "date": "2026-11-15", "by": "lead", "model": null, "rule": "rule_break", "location": {"path": "next/packages/libfabrika/src/cloudflare/connection.test.ts", "line": 1}, "says": "In next/, seven test files of libfabrika's cloudflare folder call vi.mock(\"cloudflare:workers\"), which 0555 bans, and the move 0042 names for them, reaching the platform module through Alchemy, has no plan, so the folder cannot reach zero and its vi lock cannot land.", "proof": "rg -n 'vi\\.mock\\(\"cloudflare:workers\"' next/packages/libfabrika/src/cloudflare on main at 0683861: connection.test.ts, error-cause.test.ts, leave.laws.test.ts, reload.laws.test.ts, runner-reply.laws.test.ts, supervision.laws.integration.test.ts and ProjectAuditTest.ts, one each.", "cost": "The cloudflare folder keeps no vi lock after the mock sweep, so a new vi.fn or vi.spyOn can land there until the Alchemy work is planned and built.", "head": "0683861", "ticket": null, "pr": null}
```

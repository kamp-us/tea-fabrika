
Plancheck-Version: 3

# Plan: the mock sweep in `cloudflare`, in next/ (ticket 1067)

All of this is in `next/`, in `next/packages/libfabrika/src/cloudflare`. Today's version is not
touched. It builds [0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.spyOn`, a
stand-in comes from the code's own design), [0579](../../../.decisions/0579-property-laws-use-it-prop.md)
(the Recorder is our one way to watch a service's calls),
[0554](../../../.decisions/0554-no-reflect-get-set-has.md) and
[0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md) (a fake of a Cloudflare
object comes from the test package, never by hand), and the recorder plan's row for this folder
([`recorder-PLAN.md`](./recorder-PLAN.md), "Size").

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
`vi.mock("effect")` that existed only so `Effect.result` could be spied on. Slice 2 then turns on
`vitest/no-restricted-vi-methods` and `vitest/no-restricted-matchers` for the folder.

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
| `readers.laws.test.ts:424` | `spyOn` 1 | `Effect.result`, to catch the exit of the ready decode inside `cloudflare/connection.ts`'s `wait` | the law runs `ready`, the decode now exported from `connection.ts`, and reads its own exit; the wire law keeps its `bad_row` reply | 2 |
| `readers.laws.test.ts:476, 524` | `spyOn` 2 | `Effect.result`, to catch the exit of `dispatch` inside `control.ts` | the law runs `dispatch`, now exported, and reads its own exit; the HTTP laws keep their response checks | 2 |
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

```ts
// next/packages/libfabrika/src/cloudflare/control.ts: exported, so a law reads its typed failure
export const dispatch = Effect.fnUntraced(function* (
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
  input: typeof Request.Type,
) {
  // the body as reflect slice 10 leaves it, the typed table
});

// next/packages/libfabrika/src/cloudflare/connection.ts: the ready decode, named and exported
export const ready = (raw: unknown): Effect.Effect<typeof Waited.cases.ready.Type, LedgerError> =>
  Schema.decodeUnknownEffect(Schema.Struct({ rev: Schema.Int }))(raw).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
    Effect.map((value) => Waited.cases.ready.make(value)),
  );
// `wait` ends with `return yield* ready(answer.result);`
```

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
  in `cloudflare/ProcessParts.ts` and says so. An unused export fails lint (0006). If a law's import
  does not count as a use, `dispatch` and `ready` stay exported only because their own files call
  them, and they do.
- **Is this a setting?** No, for each choice. The References, the exports and the fakes are how
  code and laws are put together. Nothing here is a value a person running fabrika picks (0069).

The lock, in slice 2:

```jsonc
// .oxlintrc.json, a new override block, a sketch
{
  "files": ["next/packages/libfabrika/src/cloudflare/**"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "fn": "Watch a service's calls with Recorder.layer, or make a platform fake with Stub.make (0579, 0554).",
        "spyOn": "Put the call behind a service and record it in the law's layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
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

- `mock` is not in the list, since 13 calls stay in the folder for the Alchemy and objects slices.
  It joins the list when its last call goes. `stubGlobal` is the same.
- If another folder's sweep lands this rule first, slice 2 adds `cloudflare/**` to that block's
  `files`, and that block's messages hold.
- `VI_BAN`, a `Plant` in `oxlint-plugins/builtin-plants.ts`, gives each form the rule must refuse
  and each it must take. `plants.test.ts` runs it in every folder the block lists, the way it runs
  `REFLECT` (`plants.test.ts:532`). It adds no `LOCKED` row to the Effect checks' own test.

## One value traced: a socket frame in the ready law

1. The law draws a malformed `raw`, such as `{ rev: "1" }`, and sets `w.answer({ _tag: "ok", result: raw })`.
2. It sends a `ledger.wait` frame through `gateway.message(socket, text)`.
3. `cloudflare/connection.ts`'s `wait` asks the fake project's `route`, which answers `w`'s value.
4. On main, the decode inside `wait` fails with `LedgerError` `bad_row`. In slice 2 that decode is
   `ready(raw)`.
5. `transport/Connection.ts:141` takes that typed failure as `Answer.refused` with reason
   `bad_row`, and the connection sends it.
6. The fake socket's `send` pushes the frame into `sent`. The law finds the `bad_row` reply there.
7. In slice 2, the same law also runs `ready(raw)` on its own and checks its exit is a failure,
   with no defect, whose error is `LedgerError` `bad_row`. That is the check `Effect.result`'s spy
   gave before, read from the function itself.

## Laws

No law is loosened, deleted or renamed. Each row is a law that exists today. Its generator stays as
it is, and only how it watches changes. The reviewer runs the loosening check.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1. The ready RPC decode fails in the typed channel, the reply on the socket says `bad_row`, and in slice 2 `ready(raw)` on its own fails `LedgerError` `bad_row` with no defect. 6 runs fast, 20 runs full | test | fc.jsonValue: malformed `{ rev }` values, 6 runs fast and 20 runs full | in `connection.ts`, `Effect.orDie` in place of the `mapError` to `LedgerError`: M1 red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M2. Control bucket bytes and the put and head keys fail as a typed parse error, the response is 500 `bad_row`, and in slice 2 `dispatch` on its own fails `LedgerError` `bad_row` with no defect. 5 runs fast, 20 runs full | test | fc.jsonValue: malformed bytes and keys, 5 runs fast and 20 runs full | in `control.ts`, decode the bucket bytes with `Schema.decodeUnknownSync`, so a bad value dies: M2 red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M3. `processDescriptor` checks the saved value before returning it. 5 runs fast, 20 runs full | test | fc.jsonValue: malformed descriptors, 5 runs fast and 20 runs full | return `storage.get`'s value without its decode: M3 red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M4. Every other law of `readers.laws.test.ts` that builds the world keeps its checks on the `Stub.make` world, and any platform call the world does not give fails the law | test | scenario: the world's laws, each on its own generator, unchanged | make the fake socket's `send` drop its frame: M1 red; call `ctx.storage.list()` in `connectionRuntime`: `unexpected` throws, red | next/packages/libfabrika/src/cloudflare/readers.laws.test.ts |
| M5. t863 L1: only reserved answers tag the ended RPC span as refused, and there is one ended `runtime.rpc` span per routed call | test | Effect Arbitrary: AnswerWalk | tag `REFUSED` on a `rate_limited` answer too: M5 red; route one call outside its span: the span count is short, red | next/packages/libfabrika/src/cloudflare/connection.test.ts |
| M6. The settings entry flows keep the secret and error text out of every output: transport, RPC failures, span rows, Record calls, archives, HTTP replies, and every line Effect's `Console` gets | test | scenario: SettingsTest.suite, its recipes and secret | in `SettingsStartsLedger.ts`, `Effect.logError(cause)` on a refused start: M6 red through `TestConsole.errorLines`; set the secret as a span attribute: M6 red through the span rows | next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts |
| M7. The audit layer fails on any platform call its driver did not wire | test | scenario: the RunnerAdmission integration law, unchanged | read `ctx.storage.get` in the audit path: the `Stub.make` guard throws, red | next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts |
| M8. A1 and A2: supported alarm operations keep the logical wake and set or clear the platform alarm; a failing alarm dies, one that is done ran its saved wake once | test | fc.gen: the alarm moves, and fc.array: Delivery, default runs | make `processLogic` name `ProgramRunner.withLoader` again, past `RunnerLayer`: the law gets no `Alarm`, red at its timeout | next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts |
| M9. Law 3 on the Process shell and the request slot keep their checks with the two References handed in | test | fc.record: the bad settings and requests, default runs | make `recordingLayer` name `SpanSink.layer` again, past `SinkLayer`: the fake SQL refuses the sink's tables, red | next/packages/libfabrika/src/cloudflare/ObjectService.test.ts |
| M10. C1: a bucket put whose digest rejects fails `crypto` with the rejected value as its cause | test | fc.record: failure, body and key, default runs | make `checkedPut` call `globalThis.crypto.subtle.digest` again: the real digest answers, C1 red | next/packages/libfabrika/src/cloudflare/error-cause.test.ts |
| M11. No file in the folder calls `vi.fn`, `vi.spyOn`, `vi.doMock` or `vi.stubEnv`, or uses a `toHaveBeenCalled*` matcher; each `VI_BAN` line is refused or taken exactly, in each folder of the block | lint | lint | delete `fn` from the block in `.oxlintrc.json`: `plants.test.ts`'s VI_BAN scenario red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |

- M1, M2, M5 and M6 lose a spy and keep what it checked. M1 and M2 still check the typed failure,
  now on the function's own exit. M5 still checks each ended span. M6 still reads every output the
  flow can write, given open question 1.
- `VI_BAN`'s lines: `vi.fn()`, `vi.spyOn(console, "log")`, `vi.doMock("./a.ts")`,
  `vi.stubEnv("A", "b")`, `expect(f).toHaveBeenCalled()`, `expect(f).not.toHaveBeenCalledWith(1)`,
  `vi["fn"]()` and a renamed import `import { vi as v }` then `v.fn()` are refused. `vi.mock(...)`
  and `expect(x).toBe(1)` are taken. 0555 marks the renamed import as untested, so its line records
  what oxlint does. If oxlint misses it, the line is a documented miss, as `REFLECT` keeps one.
- No law needs the real machine, so none is host-only. The one `.integration.` law the files reach,
  `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts`, reads
  `ProjectAuditTest.ts`. Each step runs it once after the change.
- No law reads a secret of the person's, so no `[secrets]` flow is needed. M6's secret is the
  suite's own generated one.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/cloudflare/readers.laws.test.ts | tests | tests | slice 1: the world on `Stub.make`, 6 `vi.fn` go (M3, M4); slice 2: the 3 `Effect.result` spies and `vi.mock("effect")` go (M1, M2) |
| next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts | tests | tests | slice 1: 2 `vi.fn` go, the guard is `Stub.make`'s `rest` (M7) |
| next/packages/libfabrika/src/cloudflare/connection.test.ts | tests | tests | slice 1: the `ProjectClient.make` spy goes, spans read from the records (M5) |
| next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts | tests | tests | slice 1: the span attribute spy goes; the `console`, `stdout` and `stderr` spies go once open question 1 is answered (M6) |
| next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts | tests | tests | slice 2, after 1366: 4 spies go (M8) |
| next/packages/libfabrika/src/cloudflare/ObjectService.test.ts | tests | tests | slice 2, after 1366: 2 spies go (M9) |
| next/packages/libfabrika/src/cloudflare/error-cause.test.ts | tests | tests | slice 2: the `crypto.subtle` spy goes (M10) |
| next/packages/libfabrika/src/cloudflare/control.ts | build | 1 | slice 2: `dispatch` exported |
| next/packages/libfabrika/src/cloudflare/connection.ts | build | 8 | slice 2, after 1366: `ready` named and exported; `wait` calls it |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 24 | slice 2, after 1366: `SinkLayer` and `RunnerLayer` with doc blocks, read where `SpanSink.layer` and `ProgramRunner.withLoader` are named; the two digests read `WebCrypto.WebCrypto` |
| .oxlintrc.json | tests | 30 | slice 2: the lock block above |
| oxlint-plugins/builtin-plants.ts | tests | tests | slice 2: `VI_BAN` (M11) |
| oxlint-plugins/plants.test.ts | tests | tests | slice 2: the VI_BAN scenario, beside REFLECT's (M11) |
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
5. **Mock slice 2 lands** last. It exports the `dispatch` that slice 10 leaves, takes its spies
   out of the tests slice 10 left, and turns the lock on. Going after slice 10 means `control.ts`
   is edited once by each and no guard is rewritten twice (80%).

If reflect slice 10 is not ready when 1366 lands, mock slice 2 may go first. Slice 10 then rebases
over a one-line export and the removed spies. The lead picks the order on the day.

## Calls taken

- **The 8 `vi.fn` become `Stub.make` fakes, not Recorder layers,** 85%. They are platform objects,
  and 0554 and 0557 put such fakes in the test package. What a fake was handed (sent frames) is its
  state, which the pattern doc keeps in a fake.
- **The `Effect.result` spies go by running the inner Effect on its own,** 80%. 0555 says a spy on
  Effect goes by testing what the code does. The wire and HTTP laws keep their end-to-end checks.
- **`crypto.subtle` moves behind Effect's `WebCrypto` reference,** 85%. It is Effect's own, it is
  what `Digest` uses, and `Digest` would turn a rejected hash into a defect, which C1 says it is not.
- **Two References for the span sink and the runner,** 75%. See the doubts.
- **Slice 1 waits for reflect slice 8, and slice 2 for 1366 and reflect slice 10,** 80%. See the
  order above.
- **The lock leaves `mock` and `stubGlobal` out until their last call goes,** 85%. 0524 bans a list
  of allowed leftovers. This is a narrower rule, on at zero for what it names.
- **What fact is lost if not recorded now?** None. These are test and wiring changes, and no data
  is stored.

## Validation

- The tests step, each slice: `pnpm format`, then `pnpm lint` with
  `NODE_OPTIONS=--max-old-space-size=6144`, then
  `nice -n 15 pnpm exec vitest run --maxWorkers=3` on each test file in that slice's files table,
  plus `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts` in slice 1 and
  `oxlint-plugins/plants.test.ts` in slice 2. Each plant above is run once and named in the report.
- The build, slice 2: the same narrow paths.
- The lead runs the changed-files run and the one type check.

## Size

Confidence in the line counts: 70%. The doubt is the world rewrite in `readers.laws.test.ts`, the
longest test file here.

1. Slice 1, the test-only fakes and the spans: no product code, about 120 test lines changed. 0 lines.
2. Slice 2, after 1366 and reflect slice 10: the exports, the two References, the `WebCrypto` reads
   and the lock, about 63 product and config lines, about 150 test lines. 63 lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder
plan priced them. Slice 1 has a tests step with no build (about $6) and a review ($3). Slice 2 has
tests ($7), a build ($5), a review ($3) and one likely fix round ($4), for the References doubt.

Estimate: 6 steps, $28

## Records

- No decision file. This plan builds 0554, 0555, 0557 and 0579, and asks the owner one question.
- No glossary row: no new word. `Stub` is reflect slice 8's.
- `field/`: one run row per step, the same day.
- The tracker ticket is 1067, the Recorder's, whose plan lists this folder as a later slice.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run.
- **Whether `Stub.make` takes a getter in `own`.** Reflect slice 8's sketch types `own` as
  `Partial<A>`. Its laws (on `fabrikalfa/reflect-s8`) were read only for their names.
- **Whether oxlint's `no-restricted-matchers` refuses `not.toHaveBeenCalled`** under the plain
  `toHaveBeenCalled` key. The `VI_BAN` lines settle it.
- **Whether every `runtime.rpc` span of t863's walk reaches the span store.** See the doubts.
- **What pull request 1366 and reflect slice 10 will leave in these files.** Counts are from main
  at `f7169af`. The lead takes them again before slice 2's tests step.

## Open questions

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

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-control-reason-ternary-repeats-its-test", "date": "2026-11-15", "by": "plan", "model": null, "rule": "duplicate", "location": {"path": "next/packages/libfabrika/src/cloudflare/control.ts", "line": 169}, "says": "In next/, control.ts picks the HTTP error's reason with a ternary whose second branch repeats the first branch's test word for word, so the second branch never runs and the chain reads as if it checks two things.", "proof": "At f7169af, control.ts lines 169 and 171 are the same test, `typeof answer.failure === \"object\" && answer.failure !== null && \"reason\" in answer.failure`, in one chain that ends in `unreachable`.", "cost": "A reader looks for a second case that is not there; any later fix to one copy misses the other.", "head": "f7169afeed0c2f56b7ba6a6d0dce8eac669de149", "ticket": null, "pr": null}
```

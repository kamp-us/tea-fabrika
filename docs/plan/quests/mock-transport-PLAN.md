Approved by the lead agent, builds 0555, 0579, 0043; body cde2b8505b5a
Plancheck-Version: 3

# Plan: the mock sweep in `libfabrika/src/transport`, in next/ (ticket 1067)

This is `next/` only. Today's app is not touched. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.spyOn`, `vi.mock`, `vi.doMock` or
`vi.stubEnv`; a stand-in comes from a service), [0579](../../../.decisions/0579-property-laws-use-it-prop.md)
(the `Recorder` is our one way to watch calls), [0043](../../../.decisions/0043-rooms-on-floors.md)
(a module offers services in its own types and errors) and the approved
[Recorder plan](recorder-PLAN.md), whose "Size" section lists this folder as one later slice:
9 `vi.fn`, 11 `toHaveBeenCalled*` and 1 `vi.spyOn`.

```ts
// The whole idea, a sketch, not compiled. Before: the law hands checkHello two vi.fn callbacks.
const admit = vi.fn(() => Effect.succeed(Admission.cases.admitted.make({ identity })));
yield* checkHello({ hello, ...trusted, consume, admit });
expect(admit).toHaveBeenCalledOnce();

// After: checkHello asks for the Admissions service, and the law's Recorder watches it.
const admissions = Recorder.layer(Admissions, {
  admit: () => Effect.succeed(Admission.cases.admitted.make({ identity })),
  consume: Effect.sync(() => spend()),
});
return Effect.gen(function* () {
  yield* checkHello({ hello, ...trusted });
  expect(yield* Recorder.calls(Admissions)).toEqual([
    { method: "admit", args: [fingerprint] },
    { method: "consume", args: [] },
  ]);
}).pipe(Effect.provide(admissions));
```

## Doubts, read these first

- **`next/packages/libfabrika/src/gateway/Gateway.ts` is in open pull request
  [1366](https://github.com/kamp-us/tea-fabrika/pull/1366)** (a draft, red, with a fix round
  running), and it is `checkHello`'s one product caller. A step of this sweep never touches a file in
  1366's diff. So the `Hello` half is its own slice, and it starts only once 1366 has merged or been
  closed. The `Answer` half and the WebCrypto edge go first: neither touches a 1366 file. The folder's
  lock turns on in the second slice, the one that brings the folder to zero.
- **Errors from the gateway's admission get wrapped,** 80%. Today `checkHello` is generic in its
  `admit`'s error, so the gateway's `GatewayError`, `LedgerError` and the rest pass through it as
  they are. A service has one fixed error type, and transport sits on a lower layer than the
  gateway, so it cannot name the gateway's errors. 0043 answers it: transport's service speaks its
  own error, `AdmissionError`, with the cause kept (`cause: Schema.Defect()`, as pull request 1381
  settled for five error schemas). What would settle the doubt: the slice 2 build reads every reader
  of `door.initialize`'s error (`cloudflare/runtime.ts`'s `wrapped` and `projectStorage`,
  `cloudflare/connection.ts`'s `rpc`, `apps/fabrika/src/brain.ts`) and says in its report whether
  any one matches on a tag that now arrives inside `AdmissionError`. If one does, that reader maps
  the cause, and the plan is amended before the build goes on.
- **`answerFrame` has no product caller.** Only its own law calls it; the Worker's door routes in
  `cloudflare/connection.ts` without it. This plan does what the Recorder plan's row asks and moves
  its `route` to a service. Whether the function should exist at all is a finding, below, not this
  sweep's call.

## What changes, in one paragraph

Three plain arguments become two services in transport's own types: `checkHello`'s `admit` and
`consume` become `Admissions` (`admit(key)` and `consume`), and `answerFrame`'s `route` becomes
`Routes` (`route(method, params, identity)`). `answerFrame` drops its `_admit` argument, which it
never calls. The WebCrypto edge in `internal/binary.ts` reads Effect's own `WebCrypto` reference in
place of `globalThis.crypto`, so the law that injects a WebCrypto rejection provides a stand-in
`Crypto` and spies on nothing. Every `vi.fn` and `toHaveBeenCalled*` in `Hello.test.ts` and
`Answer.test.ts` becomes a `Recorder.layer` and a `Recorder.calls` read. Then
`vitest/no-restricted-vi-methods` and `vitest/no-restricted-matchers` turn on for the folder.

## How others do it

- **Effect's own answer for a call the code makes on the platform** is a service or a reference the
  test provides. For `fetch` it is `FetchHttpClient.Fetch` (0555). For WebCrypto it is
  `effect/crypto`'s `WebCrypto` reference: `node_modules/effect/src/crypto/WebCrypto.ts:37`, a
  `Context.Reference<Crypto>` that defaults to `globalThis.crypto`, and its `layer` at `:68`, whose
  doc names "a test double" as a use. Read in the installed `effect` 4.1.3 (the lockfile).
- **A callback becomes a service** is the dependency-injection answer Effect's own guide gives
  (`node_modules/effect/AGENTS.md` points tests at services with test layers,
  `ai-docs/src/09_testing/20_layer-tests.ts`). Elm would hand the update a message in place of a
  callback; `checkHello` is not a tea machine but one Effect step inside the gateway's, so the Elm
  shape does not apply here, and the gateway's machine is not changed.
- **A service provided for one call** is `Effect.provideService`, as the gateway already does for
  its own per-call values. The gateway's `admit` and `consume` close over one attempt's state
  (`attempt`, `claimed`), so the gateway provides `Admissions` per attempt.
- **The lock** is oxlint's own rules, as 0555 says and [0573](../../../.decisions/0573-trusted-lint-rule-replaces-ours.md)
  prefers: `vitest/no-restricted-vi-methods` and `vitest/no-restricted-matchers`, both in the
  installed oxlint 1.90.0 (their names are in its binary). Neither is set in `.oxlintrc.json` on main.

## The shape

### `Admissions`, the hello's admission (slice 2)

```ts
// next/packages/libfabrika/src/transport/Admissions.ts, the contract only (0095). A sketch.
import { Context, type Effect, Schema } from "effect";
import type { Admission } from "./Wire.ts";

/** What admission failed with, in the gateway's own words, kept as the cause. */
export class AdmissionError extends Schema.TaggedError<AdmissionError>()("AdmissionError", {
  cause: Schema.Defect(),
}) {}

/** The two calls a checked hello makes on its door: admit its key, then spend its nonce. */
export class Admissions extends Context.Service<
  Admissions,
  {
    /** Admits or refuses this key fingerprint. */
    readonly admit: (key: string) => Effect.Effect<typeof Admission.Type, AdmissionError>;
    /** Spends the hello's nonce, once; false when it was spent already. */
    readonly consume: Effect.Effect<boolean>;
  }
>()("@kampus/libfabrika/transport/Admissions") {}
```

```ts
// next/packages/libfabrika/src/transport/Hello.ts, the changed signature. A sketch.
export const checkHello = Effect.fn("transport.checkHello")(function* (a: {
  readonly hello: unknown;
  readonly url: string;
  readonly tab: string;
  readonly nonce: string;
  readonly name: string;
  readonly versions: ReadonlyArray<number>;
  readonly ping: { readonly min: number; readonly max: number };
}) {
  const admissions = yield* Admissions;
  // ... the same checks, in the same order ...
  const admitted = yield* admissions.admit(fingerprint);
  // ...
  if (!(yield* admissions.consume)) {
    return no("bad_nonce");
  }
  // ...
});
// Effect<typeof CheckedHello.Type, WebCryptoError | AdmissionError, Admissions>
```

```ts
// next/packages/libfabrika/src/gateway/Gateway.ts, initializeChecked. A sketch.
const result = yield* silent(
  checkHello({ hello, url: trusted.url, tab: trusted.tab, name: trusted.name, nonce: hello.nonce,
    versions: options.versions, ping: options.ping }).pipe(
    Effect.provideService(Admissions, {
      consume: Effect.sync(() => attempt.current && claimed),
      admit: (key) => admit(key).pipe(Effect.mapError((cause) => new AdmissionError({ cause }))),
    }),
  ),
);
```

- `consume` is an Effect member, not `() => boolean`: the Recorder watches only members that answer
  an Effect or a Stream, and `ClientKey.claimPersist` is the same shape in this folder.
- The names: `Admissions` is plural, as 0029 asks of a service, and Kubernetes calls this step
  admission. `admit` and `consume` keep the words `checkHello`'s doc and its laws already use.
  `.glossary/TERMS.md` has no `Admissions` row; slice 2 adds one.

### `Routes`, a frame's route (slice 1)

```ts
// next/packages/libfabrika/src/transport/Routes.ts, the contract only. A sketch.
import { Context, type Effect, Schema } from "effect";
import type { Answer, RateCountFailure, Who } from "./Wire.ts";

/** A route that could not answer, with what it failed with kept as the cause. */
export class RouteError extends Schema.TaggedError<RouteError>()("RouteError", {
  cause: Schema.Defect(),
}) {}

/** Where a checked frame's request goes. `identity` is null for a connection not yet online. */
export class Routes extends Context.Service<
  Routes,
  {
    readonly route: (
      method: string,
      params: unknown,
      identity: typeof Who.Type | null,
    ) => Effect.Effect<typeof Answer.Type, RouteError | typeof RateCountFailure.Type>;
  }
>()("@kampus/libfabrika/transport/Routes") {}
```

```ts
// next/packages/libfabrika/src/transport/Answer.ts, the changed signature. A sketch.
export const answerFrame = Effect.fn("transport.answerFrame")(function* <A extends typeof Attached.Type>(
  text: string,
  attached: A,
) {
  const routes = yield* Routes;
  // ... decode, the no_hello gate, as today ...
  const exit = yield* Effect.exit(
    routes.route(method, params, attached._tag === "online" ? attached.identity : null),
  );
  // ... the same mapping of the answer ...
});
// Effect<{ send: string | null; attached: A }, never, Routes>
```

- The four-argument `Frame` and `Incoming` tuple types go, with `isOnline`. Today they stop a route
  from getting an identity on a connection that is not online. After, a non-online route gets
  `null`, and law A4 holds that at run time. That is a weaker type for a stronger record: the
  Recorder now sees the third argument on every call, which `vi.fn` could not type.
- `_admit` goes, 85%: the doc says the function never calls it, and with `Routes` as its only
  service the type shows that `answerFrame` cannot reach admission at all, which the old
  `Effect.die("online routing must not repeat hello admission")` stand-in only claimed.
- `RouteError | RateCountFailure`: `answerFrame` swallows every failure and reads only whether it is
  a `RateCountFailure` (`Answer.ts:94`), so those two are what a route can fail with. No product
  route exists to say more.

### The WebCrypto edge (slice 1)

```ts
// next/packages/libfabrika/src/transport/internal/binary.ts, the one changed line. A sketch.
import { WebCrypto } from "effect/crypto";

export const subtle = Effect.fn("transport.crypto")(function* <M extends CryptoMethod>(method: M, ...args: CryptoArgs[M]) {
  const api: CryptoApi = (yield* WebCrypto.WebCrypto).subtle;
  // ... the same edge line ...
});
```

A `Context.Reference` needs no provide: every caller gets `globalThis.crypto`, as today, and no
signature changes. Only the law provides a stand-in.

```ts
// next/packages/libfabrika/src/transport/ErrorCause.test.ts, C5. A sketch.
const rejecting = <A, E>(method: Method, failure: unknown, work: Effect.Effect<A, E>) =>
  work.pipe(Effect.provide(WebCrypto.layer(Rejecting.crypto(method, failure))));
```

`Rejecting.crypto` is a test-support helper in transport (`internal/rejecting.test-support.ts`): a
`typeof globalThis.crypto` whose `subtle[method]` rejects with `failure`, and whose other members are
the real ones. It is a platform stand-in, not a call watcher, as the Recorder plan files the
`cloudflare/` WebSocket doubles. It has no `Reflect.get` (0554), no double cast, and its one
rejected Promise is a marked `fabrika/no-promises` edge. How it builds that object is the tests
step's call.

## Every site, counted again on main

Counted on main at `f7169af` with `nice -n 19 rg -n` over `next/packages/libfabrika/src/transport`:
9 `vi.fn`, 11 `toHaveBeenCalled*`, 1 `vi.spyOn`, the Recorder plan's numbers. Two more reads of a
`vi.fn`'s calls (`.mock.calls`) are on the same lines' mocks. Plain function arguments that no
counter sees also change with the signatures: they are listed too.

| Site | Watches | Becomes |
|---|---|---|
| `Hello.test.ts:102`, `:110` (`setup`: `consume`, `admit`) | the nonce spend and the admit call | one `Recorder.layer(Admissions, ...)` from `setup`, its `consume` the same once-only flag |
| `Hello.test.ts:146`, `:147`, `.mock.calls` at `:157`, `:167` (law d2) | admit called once with the fingerprint, consume not called | `Recorder.calls(Admissions)` equals `[{ method: "admit", args: [fingerprint] }]` |
| `Hello.test.ts:194`, `:195` (p26 unsigned tab or nonce) | neither called | `Recorder.calls(Admissions)` equals `[]` |
| `Hello.test.ts:224`, `:225` (p26 online) | each called once | equals `[admit(fingerprint), consume]`, in that order |
| `Hello.test.ts:253`, `:254` (p26 changed trusted value) | neither called | equals `[]` |
| `Hello.test.ts:289`, `:296`, `.mock.calls` at `:297` (p26/p82 refusals) | admit called only for `unknown`, consume never | equals `[admit(fingerprint)]` for `unknown`, else `[]` |
| `Hello.test.ts` A3 (plain `admit`) | nothing | a `Layer.mock(Admissions, ...)` |
| `Answer.test.ts:162`, `:172` (p23 ok or refused) | route called once | `Recorder.calls(Routes)` equals `[route("ledger.read", params, identity)]` |
| `Answer.test.ts` `vi.fn<Route>()` with `mockReturnValueOnce`, `:195` (p23 retry) | route answers fail, then ok; called twice | an impl that counts its own runs; `Recorder.calls(Routes)` has two equal entries |
| `Answer.test.ts:209` (p23 junk) | nothing read | `Recorder.calls(Routes)` equals `[]`: stronger |
| `Answer.test.ts:231`, `.mock.calls`, `:247` (d2 unauthenticated) | only a waiting knock reaches the route, with two args | equals `[route("gateway.knock", params, null)]`, else `[]` |
| `Answer.test.ts:299`, `.mock.calls[0][2]` (p82 additive fields) | the route's third arg is the checked identity | `Recorder.calls(Routes, "route")[0][2]` equals it |
| `Answer.test.ts` T843, id zero, parked, knock parks (plain `route`, `admit`) | nothing | a `Layer.mock(Routes, ...)`; the `admit` stand-in goes |
| `ErrorCause.test.ts:47` (`vi.spyOn(crypto.subtle, method)`) | a rejection injected into one WebCrypto call | `WebCrypto.layer(Rejecting.crypto(method, failure))` |
| `node/client/KeyFile.laws.test.ts:296` (plain `consume`, `admit`) | nothing | a `Layer.mock(Admissions, ...)` (slice 2) |

The `fc.assert` laws here (d2 in both files, p82 agreement, T737 D1, C5, C3) keep their runner in
this sweep, 80%: moving them to `it.effect.prop` is 0579's other sweep, and doing both in one diff
makes the loosening read harder. Each is only changed where it reads a mock.

## One value traced: a refused signed hello (law d2)

1. The law makes a key, signs `fabrika-hello\n<url>\n<tab>\n<nonce>`, and builds
   `Recorder.layer(Admissions, { admit: () => Effect.succeed(refused("not_granted")), consume: Effect.succeed(true) })`.
2. `checkHello` decodes the hello, picks version 2, checks the key, the tab, the nonce, the
   fingerprint and the signature. All pass.
3. It runs `admissions.admit(fingerprint)`. The Recorder writes `{ method: "admit", args: [fp] }`
   and runs the impl, which answers `refused`.
4. `checkHello` answers `refused { reason: "not_granted", fingerprint: fp }` and never runs
   `admissions.consume`, so the Recorder writes nothing more.
5. Inside the same provide, the law reads `Recorder.calls(Admissions)` and gets exactly
   `[{ method: "admit", args: [fp] }]`. The old law needed two checks for this (`admit.mock.calls`
   and `not.toHaveBeenCalled`); one equality now holds both, and the order.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| A1. A request on an online connection reaches the route once, with its method, its params and the connection's identity, and an `ok` or `refused` answer becomes its one reply | test | Effect Arbitrary: Answer.cases.refused | pass `null` as the identity on an online connection: A1 red | next/packages/libfabrika/src/transport/Answer.test.ts |
| A2. A route that fails or dies sends nothing and keeps the attachment, and the same frame again reaches the route a second time | test | scenario: one failure and one defect, each then a retry that answers ok | answer a failed route with a cached reply and skip the second route call: A2 red | next/packages/libfabrika/src/transport/Answer.test.ts |
| A3. Junk, a response and a notification reach no route | test | scenario: the five texts the law lists today | route a notification: A3 red | next/packages/libfabrika/src/transport/Answer.test.ts |
| A4. On a connection not online, only a waiting `gateway.knock` reaches the route, with its params and a `null` identity; every other request gets one `no_hello` reply | test | fc.oneof: the `unauthenticated` states with methods, ids, params and answers, 300 runs | pass the waiting client's key as an identity to the knock route: A4 red | next/packages/libfabrika/src/transport/Answer.test.ts |
| A5. Fields a request adds do not reach the route's identity: the third argument is the attached identity | test | scenario: one request with a forged `future.by` | read the identity from the request's params: A5 red | next/packages/libfabrika/src/transport/Answer.test.ts |
| A6. `answerFrame`'s environment is exactly `Routes`, so it cannot reach admission | type | type | make `answerFrame` also `yield* Admissions`: the type law's `@ts-expect-error` goes unused, red in a typecheck | next/packages/libfabrika/src/transport/Answer.test.ts |
| C5. A rejection on any WebCrypto call through the edge is `WebCryptoError` with that very value as its cause | test | fc.record: steps of a method and a rejection, 100 runs | `const fail = () => new WebCryptoError({ cause: undefined })` in `internal/binary.ts`: C5 red | next/packages/libfabrika/src/transport/ErrorCause.test.ts |
| C6. The edge reads the provided `WebCrypto`, not the global: with a stand-in that rejects `digest`, `checkHello` on a well-formed hello fails with `WebCryptoError` | test | scenario: one signed hello and a rejecting `digest` | read `globalThis.crypto.subtle` in `internal/binary.ts` again: C6 red (C5 stays green there only by luck of no spy, so C6 is the plant's law) | next/packages/libfabrika/src/transport/ErrorCause.test.ts |
| H1. A signed hello that admission refuses names its own fingerprint, and the record is exactly one admit with that fingerprint | test | fc.webUrl: the url, with `fc.string` tab and nonce, 40 runs | return the refusal without the fingerprint, or consume before admitting: H1 red | next/packages/libfabrika/src/transport/Hello.test.ts |
| H2. A hello whose tab, nonce or trusted value differs, or whose signature, key or version is bad, records no call | test | Effect Arbitrary: Admission.cases.refused | admit before the signature check: H2 red | next/packages/libfabrika/src/transport/Hello.test.ts |
| H3. A checked hello goes online, and the record is admit with its fingerprint, then consume, in that order | test | scenario: the `setup` hello | consume before admitting: H3 red | next/packages/libfabrika/src/transport/Hello.test.ts |
| H4. A failing admission fails `checkHello` with that very `AdmissionError`, and consume is never run | test | Effect Arbitrary: Schema.String | catch the admission error and answer `refused`: H4 red | next/packages/libfabrika/src/transport/Hello.test.ts |
| H5. The gateway's admission error reaches `door.initialize`'s caller as `AdmissionError`, its cause the gateway's own error | test | scenario: a store that fails inside admission | map the error to a new `AdmissionError` with no cause: H5 red | next/packages/libfabrika/src/gateway/GatewayCauseTest.ts |
| K2. The key file's hello is admitted by the door, as today | test | fc.record: the law's own nonce and tab, 60 runs | as today | next/packages/libfabrika/src/node/client/KeyFile.laws.test.ts |
| L1. In the transport folder, `vi.fn`, `vi.spyOn`, `vi.mock`, `vi.doMock` and `vi.stubEnv` are refused, and so is every `toHaveBeenCalled*` matcher, with `.not` too. Amendment 2026-11-15 (merge session ruling 2): this is node's M1 run in the transport folder, its lines node's shared `VI_METHODS` set, with this plan's matcher and renamed-import lines added to it | lint | lint | delete the transport folder from the block's `files`: L1's planted lines are not refused. Amendment 2026-11-16 (lead ruling): the lock is the pair, and this law also runs `VI_PROPERTIES` (see the lock's amendment): drop the block's `vi` entries from `eslint/no-restricted-properties`, and its chained lines are not refused, red | next/packages/libfabrika/src/transport/Hello.test.ts |

- A1 to A5 are today's p23 and d2 laws in `Answer.test.ts`, kept under their own titles; the A
  numbers are only this plan's. H1 to H3 are d2 and the p26 laws in `Hello.test.ts`, the same way.
  Each keeps every value the old law compared, and most get stronger: one equality on the whole
  record holds the count, the args and the order where the old law held only a count.
- C5 keeps its title. C6 is new, since without the spy C5 alone no longer proves the edge reads
  the reference.
- H4 and H5 are new: `AdmissionError` is new, and 0043's "with its cause kept" needs a law.
- L1's lines are planted in `oxlint-plugins/builtin-plants.ts`, and `plants.test.ts` runs them in
  every folder the block lists, as it does `REFLECT`'s. The Where cell names the folder's first
  file only because plancheck needs a path; the law's file is `oxlint-plugins/plants.test.ts`.
  The plants include a renamed import (`import { vi as v }`), the case 0555 says may slip through.
- No law needs the real machine, so none is host-only. No law reads a secret. No new file is an
  `*.integration.test.ts`, since every law runs on in-memory layers.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/transport/Routes.ts | build | 22 | slice 1, new: `Routes` and `RouteError`, the contract only |
| next/packages/libfabrika/src/transport/Answer.ts | build | 15 | slice 1: `answerFrame(text, attached)` asks for `Routes`; `Frame`, `Incoming` and `isOnline` go; the doc says so |
| next/packages/libfabrika/src/transport/internal/binary.ts | build | 2 | slice 1: `subtle` reads `WebCrypto.WebCrypto` |
| next/packages/libfabrika/src/transport/Answer.test.ts | tests | tests | slice 1: A1 to A6 on `Recorder.layer(Routes, ...)` and `Layer.mock(Routes, ...)` |
| next/packages/libfabrika/src/transport/ErrorCause.test.ts | tests | tests | slice 1: C5 on `WebCrypto.layer`, and C6 |
| next/packages/libfabrika/src/transport/internal/rejecting.test-support.ts | tests | tests | slice 1, new: `crypto(method, failure)`, a stand-in `Crypto` |
| next/packages/libfabrika/src/transport/Admissions.ts | build | 22 | slice 2, new: `Admissions` and `AdmissionError`, the contract only |
| next/packages/libfabrika/src/transport/Hello.ts | build | 10 | slice 2: `checkHello` asks for `Admissions`; its doc names the service |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 10 | slice 2, after 1366: provides `Admissions` per attempt; the `initialize` error type gains `AdmissionError` |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 0 | slice 2: read only; its `initialize` type follows `checkHello`'s return, so no line should change |
| next/packages/libfabrika/src/transport/Hello.test.ts | tests | tests | slice 2: H1 to H4 on `Recorder.layer(Admissions, ...)` |
| next/packages/libfabrika/src/gateway/GatewayCauseTest.ts | tests | tests | slice 2: H5, beside the T695 cause laws |
| next/packages/libfabrika/src/node/client/KeyFile.laws.test.ts | tests | tests | slice 2: K2 provides `Layer.mock(Admissions, ...)` |
| next/packages/libfabrika/src/node/ErrorCause.test.ts | tests | tests | slice 2: runs `GatewayCauseTest`'s suite, H5 included; no change expected |
| .oxlintrc.json | tests | 25 | slice 2: the lock block for the transport folder, below; an exam path, so the tests step writes it with L1's plants |
| oxlint-plugins/builtin-plants.ts | tests | tests | slice 2: L1's lines, in node's `VI_METHODS` set (amended 2026-11-15; first a `MOCKS` plant); and (amendment 2026-11-16, lead ruling) the `VI_PROPERTIES` plant, the lock's other half |
| oxlint-plugins/plants.test.ts | tests | tests | slice 2: node's M1 scenario runs `VI_METHODS` in every folder of the lock block |
| .glossary/TERMS.md | build | docs | slice 1: a `Routes` row; slice 2: an `Admissions` row |
| docs/plan/quests/recorder-PLAN.md | build | docs | slice 2: the transport row reads "done", with both slices and the sweep's one pull request (amended 2026-11-15) |

- Each new file is a front file of the `transport` module, beside `ClientKey.ts`, the same shape,
  and in libfabrika: a client written from scratch needs the door's hello and frame logic.
  `rejecting.test-support.ts` is in `internal/`, since no other module's law needs it.
- H5 goes in `GatewayCauseTest.ts`, the gateway's suite for "the failure it translates keeps its
  cause" (T695), which `node/ErrorCause.test.ts` runs on a real `Sql` (0062). If the suite cannot
  reach `initialize`, the tests step puts H5 beside the gateway's `initialize` laws
  (`gateway/TasksTest.ts:368` calls `d.initialize`) and says where in its report.
- `apps/fabrika` is not touched: `brain.ts` reads `initialize` through `ProjectService`, which keeps
  its type.

### The lock

```jsonc
// .oxlintrc.json, a new override block. A sketch, not run. If another folder's slice added this
// block first, slice 2 adds the transport folder to its files and nothing else.
{
  // Decisions 0555 and 0579: no vi mock, spy, env stub or vi.fn in a test, and no call matcher.
  // Each folder joins the day its slice brings it to zero; none is taken off (0524).
  "files": ["next/packages/libfabrika/src/transport/**"],
  "rules": {
    "vitest/no-restricted-vi-methods": ["error", {
      "fn": "Watch the call with Recorder.layer and Recorder.calls (0579).",
      "spyOn": "Put the call behind a service and record it with the Recorder (0555).",
      "mock": "Give the code a service and provide a test layer (0555).",
      "doMock": "Give the code a service and provide a test layer (0555).",
      "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
    }],
    "vitest/no-restricted-matchers": ["error", {
      "toHaveBeenCalled": "Read Recorder.calls and compare the whole record (0579).",
      "toHaveBeenCalledOnce": "Read Recorder.calls and compare the whole record (0579).",
      "toHaveBeenCalledTimes": "Read Recorder.calls and compare the whole record (0579).",
      "toHaveBeenCalledWith": "Read Recorder.calls and compare the whole record (0579).",
      "toHaveBeenLastCalledWith": "Read Recorder.calls and compare the whole record (0579).",
      "toHaveBeenNthCalledWith": "Read Recorder.calls and compare the whole record (0579).",
      "toHaveBeenCalledExactlyOnceWith": "Read Recorder.calls and compare the whole record (0579)."
    }]
  }
}
```

- `fn` is on the list though 0555's sketch does not name it, 85%: 0579 makes the Recorder "our one
  way to watch calls" and says it replaces the `vi.fn` uses, and 0557 says a mechanism the test
  package does not export is not used.
- Whether `no-restricted-matchers` matches `.not.toHaveBeenCalled` by its key alone is read from the
  plants, not assumed: the tests step plants both forms, and the build adds a `not.` key only if a
  plant shows it is needed.

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

```jsonc
// .oxlintrc.json, the lock as a pair (amendment 2026-11-16, lead ruling). A sketch; one block; `vitest/no-restricted-matchers` stays as above.
{
  "files": ["next/packages/libfabrika/src/transport/**"],
  "rules": {
    // Kept on as it is: the same members, with the same messages as below.
    "vitest/no-restricted-vi-methods": ["error", { /* fn, mock, doMock, spyOn, stubEnv */ }],
    "eslint/no-restricted-properties": [
      "warn",
      // Written out again, since an override replaces options: the `JSON.parse` entry and the four Reflect entries (`Reflect.get`, `Reflect.set`, `Reflect.has`, `globalThis.Reflect`), of the Reflect ban's warn block.
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
  out the `JSON.parse` entry (`.oxlintrc.json` on main at `b490a3203`). On main the folder takes the Reflect ban's `warn` block (`JSON.parse` and the four Reflect entries), so the lock is one block, as the sketch shows. At `warn`, a `vi`
  fire still blocks: `pnpm lint` lets only a `JSON.parse` fire of this rule advise
  (0523, the advice map `pnpm lint` reads). No file loses an entry, and no file gains one but the
  `vi` entries. Whichever slice lands later carries the entries the others landed first: another folder's `vi` entries, the `process.stdout` and `process.stderr` entries of the cloudflare plan's M13 (on these files but `*.test.ts`, the way M13 leaves test files out), or any new set.
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

## Calls taken

- **Two slices, `Answer` and WebCrypto first, `Hello` after 1366,** 90%: the step rules forbid a
  1366 file, and `Gateway.ts` is one. Slice 1 lands whole: its laws are green and its files hold no
  mock left. The folder's lock waits for slice 2, since `Hello.test.ts` keeps its mocks until then.
- **`AdmissionError` wraps the gateway's errors,** 80%, see the doubts.
- **`consume` is an Effect member,** 90%: the Recorder watches nothing else, and the gateway's
  closure reads `claimed` at run time either way.
- **`identity: Who | null`** on the route, not two methods (`route` and `knock`), 75%. Two methods
  would type a waiting knock better, but they change what `answerFrame` decides, which is past what
  a mock sweep should change. The doubt: a reviewer may prefer the type over the runtime law; it
  would not change any law's plant.
- **`answerFrame` drops `_admit`,** 85%, see "The shape".
- **Effect's `WebCrypto` reference, not a service of ours,** 95%: Effect ships it for exactly this
  (`WebCrypto.ts:37`, `:68`).
- **The `fc.assert` laws keep their runner,** 80%, see "Every site".
- **Is this a setting?** No, for each choice. The services and the lock are code and lint config,
  nothing a person running fabrika picks (0069).
- **What fact is lost if not recorded now?** None. A call record lives inside one test run.

## Validation

- The tests step: `pnpm format`, then `pnpm lint` with `NODE_OPTIONS=--max-old-space-size=6144`,
  then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on the slice's test files. Slice 1:
  `next/packages/libfabrika/src/transport/Answer.test.ts` and
  `next/packages/libfabrika/src/transport/ErrorCause.test.ts`. Slice 2:
  `next/packages/libfabrika/src/transport/Hello.test.ts`, `next/packages/libfabrika/src/node/ErrorCause.test.ts` (which runs `GatewayCauseTest`'s suite),
  `next/packages/libfabrika/src/node/client/KeyFile.laws.test.ts` and
  `oxlint-plugins/plants.test.ts`. A6 is red only in the lead's typecheck.
- The build runs the same paths green. The lead runs the wider pass over the changed files and the one
  type check that shows A6 red, then green.
- The review runs the loosening check on the diff; every rewritten law must compare at least what it
  compared before.

## Size

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the Recorder
plan priced them: a tests step about $6, a build about $5, a review about $3, a fix round about $4.
Confidence in the line counts: 70%; the doubt is slice 2's gateway change, which 1366 may move.

Both slices land on the mock sweep's one fold branch, `fabrikalfa/mock-fold`, in its one pull
request (amendment 2026-11-15, merge session ruling 1); neither opens a pull request of its own.
Each still runs its own tests, build and review steps, one fresh agent each, in its own box.

1. Slice 1, `Routes`, `answerFrame` and the WebCrypto edge: 39 product lines, about 120 test lines
   changed. Tests $5, build $4, review $3. 39 lines.
2. Slice 2, after 1366: `Admissions`, `checkHello`, the gateway's provide and the folder's lock: 67
   product lines (25 of them the lint config the tests step writes), about 150 test lines changed. Tests $6, build $5, review
   $3, and one likely send-back on the gateway's error readers, $4. 67 lines.

Estimate: 7 steps, $30

## Records

- `.glossary/TERMS.md`: `Routes` and `Admissions` rows, in their slices.
- No decision file. This plan builds 0555, 0579 and 0043 and takes no new ruling of the owner's.
- `field/`: one run row per step, the same day.
- The tracker ticket is 1067, the Recorder's, until the lead files one for the sweep.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run.
- **Whether a reader of `door.initialize`'s errors matches a tag** that `AdmissionError` now wraps.
  Only the slice 2 build's read settles it.
- **How 1366 changes `initializeChecked`.** Its diff adds an `admit` option to the gateway for
  `process.send`, a different admission from the hello's. Slice 2's plan read is redone on main
  after 1366 lands, and the plan is amended if the hello's admission moved.
- **Whether `no-restricted-matchers` sees `.not` and `.resolves` forms.** The plants tell.
- **Whether `answerFrame` is still wanted.** See the finding.

## Open questions

None.

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-answer-frame-has-no-product-caller", "date": "2026-11-15", "by": "plan", "model": null, "rule": "dead_code", "location": {"path": "next/packages/libfabrika/src/transport/Answer.ts", "line": 66}, "says": "answerFrame, a JSON-RPC frame answerer with its own no_hello gate and parked waits, is exported and called by no product file; the Worker's door routes frames in cloudflare/connection.ts without it, so its laws hold code no client runs.", "proof": "nice -n 19 rg -n answerFrame next --glob '!*.md' on main prints lines only in next/packages/libfabrika/src/transport/Answer.ts and next/packages/libfabrika/src/transport/Answer.test.ts.", "cost": "Each sweep and refactor of transport keeps paying for a function and its laws that guard nothing live, and a reader may take its no_hello gate for the door's.", "head": "f7169afeed0c2f56b7ba6a6d0dce8eac669de149", "ticket": "kamp-us/tea-fabrika#1067", "pr": null}
```

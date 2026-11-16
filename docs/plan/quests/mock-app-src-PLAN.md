Approved by the lead agent, builds 0555, 0579; body 5104ad4d0f7e
Plancheck-Version: 3

# Plan: the mock sweep in `next/apps/fabrika/src`, in next/: 5 `vi.fn`, 14 `toHaveBeenCalled*` and 23 `vi.spyOn` go, in five slices on the sweep's one pull request

```ts
// next/apps/fabrika/src/door.integration.test.ts:3083, today: a vi.fn hidden in a hand wrap of the real service
const called = vi.fn();
const clients = Layer.effect(ClientManager, ClientManager.pipe(Effect.map((real) => ({
  ...real,
  write: (...args: Parameters<typeof real.write>) => { called(); return real.write(...args); },
})))).pipe(Layer.provide(w.env));
expect(called).not.toHaveBeenCalled();

// after (a sketch, not compiled): the real service, recorded, with no new Recorder form
const clients = Layer.unwrap(ClientManager.pipe(Effect.map((real) => Recorder.layer(ClientManager, real)))).pipe(
  Layer.provide(w.env),
);
expect(yield* Recorder.calls(ClientManager, "write")).toEqual([]);
```

This is `next/`: the app's `src/` folder with its `exam/`, plus the product files in libfabrika and
the one Alchemy patch that some of its spies need first. Today's app is not touched. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) and
[0579](../../../.decisions/0579-property-laws-use-it-prop.md), on the Recorder as built
(`next/packages/vitest/src/Recorder.ts`, the
[pattern](../../../.patterns/a-law-watches-calls-with-a-recorder.md)). It covers `vi.fn`,
`toHaveBeenCalled*` and `vi.spyOn` only. The folder's `vi.mock`, `vi.doMock` and `vi.stubEnv` are
the other sweeps of 0555 and stay as they are here. **Amended 2026-11-15 (the laptop lead's
ruling):** it covers those too, in a slice 5, and also builds
[0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) (no list lets broken code pass)
and follows [0042](../../../.decisions/0042-platform-pieces-go-through-alchemy.md) (platform
pieces go through Alchemy), with
[0538](../../../.decisions/0538-kampus-vitest-holds-the-test-primitives.md) for where test layers
live and [0054](../../../.decisions/0054-read-upstream-before-patching-it.md) for the Alchemy patch.

## Doubts, read these first

**Amendment (2026-11-15, merge session rulings).** Both open questions were answered, and the
first two doubts below are kept as they were written, each marked with its answer. Each slice lands
on the sweep's one fold branch, not as a pull request of its own (ruling 1). The lock refuses all
five methods with node's M1 as its law (ruling 2), which raised a new question for the merge
session (open question 3); the laptop lead answered it the same day: no interim lock, the sweep
fixes the folder's other `vi` hits it can, and the folder's lock stays out of this sweep.

- **Open question 1 decides five laws (lean 60%).** (Answered 2026-11-15: a failed digest stays a
  typed `crypto` refusal, through Effect's `WebCrypto` reference, as the cloudflare and transport
  plans do. The defect lean is marked wrong, and the five laws keep what they check.) Effect's own
  `Digest` service answers `Effect<Uint8Array>`: a failed SHA digest is a defect, not a typed
  error. Five laws today plant a thrown or rejected `crypto.subtle.digest` and expect a typed
  `crypto` refusal. On Effect's `Digest` those laws must plant a defect instead, which is a changed
  law the owner says yes to. Slice 3 waits on the answer; slices 1 and 2 do not.
- **Open question 2 decides one `vi.fn` (lean 70%).** (Answered 2026-11-15: a watched callback goes
  through a service (0555), as the transport row says. The plain-list lean is marked wrong.)
  `inputs.name` in the gateway's settings is a plain function of our own API. Two approved rows
  disagree on what replaces a `vi.fn` on such a callback: the recorder plan's `transport/` row says
  "becomes a service", the oxlint-plugins plan says "a plain list the test owns". It is in slice 3.
- **The lock stays out of this sweep (amendment 2026-11-15, the laptop lead's ruling; this closes
  open question 3).** Slice 5 fixes 33 of the folder's 40 other `vi` hits, but seven stand in for
  Alchemy or `cloudflare:workers` and wait on 0042's Alchemy work, so the folder cannot reach
  zero, and no narrower interim lock is allowed (0524). See "The other `vi` hits 0555 bans".
- **The Alchemy patch (70%).** Slice 2 patches `@alchemy.run/cloudflare-runtime`'s Node `Workerd`
  to spawn through Effect's `ChildProcessSpawner`, as the recorder plan's row says. That keeps
  workerd's fourth file descriptor, the control pipe the laws write `listen` events to. Effect's
  spawner reads extra descriptors with `getOutputFd` (`grant-readers.laws.test.ts:193` already
  stubs it), so it should fit. The patch may be bigger than the 40 lines sized here. What settles
  it: the build's first run of `exam/alchemy-lifecycle.test.ts`. The fallback is a smaller patch
  that only exports the module's own `make(spawn)`. The lead picks it if the first patch does not
  pass its law in one fix round.
- **The startup span (65%).** `runtime.laws.integration.test.ts:310` spies on Effect's own
  `Layer.buildWithMemoMap` to give the project's first build the law's parent span. The product
  change is in `next/packages/libfabrika/src/cloudflare/runtime.ts`, which is in PR 1366, so the
  details wait for slice 3. The lean is below, under "Slice 3".

## The count, again on main

Counted on main at `f7169af` with
`nice -n 19 rg -n --hidden -g '!node_modules' 'vi\.fn\(|toHaveBeenCalled|spyOn\(' next/apps/fabrika/src`,
one match per call. 5 `vi.fn(`, 14 `toHaveBeenCalled*` and **23** spies. The brief and the recorder
plan say 22 spies, because they counted `vi.spyOn(`. One call is split over two lines,
`vi` then `.spyOn(Layer, "buildWithMemoMap")` at `runtime.laws.integration.test.ts:310-311`, and
that pattern misses it.

| Where | `vi.fn` | `toHaveBeenCalled*` | `spyOn` | Slice |
|---|---|---|---|---|
| `file-services.laws.integration.test.ts` | 1 | 1 | 0 | 1 |
| `grant-readers.laws.test.ts` | 0 | 5 | 5 | 1 |
| `door.integration.test.ts`, p27 (`:3083`) | 1 | 1 | 0 | 1 |
| `instance-one-file.integration.test.ts`, `getEntrypoint` (`:441`) | 0 | 0 | 1 | moved to the 0042 Alchemy mocks plan (amendment 2026-11-15) |
| `instance-one-file.integration.test.ts`, spawn (`:49`) | 0 | 0 | 1 | 2 |
| `exam/alchemy-lifecycle.test.ts` | 0 | 0 | 1 | 2 |
| `door.integration.test.ts`, crypto and T843 | 2 | 3 | 8 | 3 |
| `runtime.laws.integration.test.ts` | 1 | 2 | 2 | 3 |
| `runtime-recovery.laws.integration.test.ts` (in PR 1366) | 0 | 0 | 3 | 3 |
| `local-instance.integration.test.ts` (in PR 1366) | 0 | 2 | 2 | 4 |
| **Total** | **5** | **14** | **23** | |

Two of the folder's files are in PR 1366's diff: `local-instance.integration.test.ts` and
`runtime-recovery.laws.integration.test.ts` (read with `pull_request_read get_files`, 57 files, one
page). Their 5 spies and 2 matchers wait for the after-1366 slices. So do two product files that
other sites need first: `next/packages/libfabrika/src/gateway/Gateway.ts` and
`next/packages/libfabrika/src/cloudflare/runtime.ts`. Both are in that diff too.

## What each one watches, and what replaces it

| Site | Watches | Replaced by | Product change first |
|---|---|---|---|
| `file-services…:79,87` | `dev.ts` never calls `FileSystem.makeDirectory` for a bad `--parent` | `Recorder.layer(FileSystem.FileSystem, FileSystem.makeNoop({ makeDirectory: () => Effect.never }))`, built once and handed to the hoisted `cli.layer` as a built context | none |
| `door…:3083,3134` p27 | the real `ClientManager.write` is never called on a wrong `to` | `Layer.unwrap` over `Recorder.layer(ClientManager, real)`, the opening block | none |
| `grant-readers…:63,107,334` | `grant.ts` never fetches on bad args, usage or flags | a `fetch` stand-in for Effect's `FetchHttpClient.Fetch` reference that keeps a typed list of its calls and rejects; the list stays `[]` | none: `grant.ts` already uses `HttpClient` and `FetchHttpClient.layer` |
| `grant-readers…:202` | each request `grant.ts` sends, method, URL, headers and body | the same stand-in, answering per mode; its list replaces the spy's `calls` | none |
| `grant-readers…:234,314,316` | `Granted <key> to <for>` is printed once on `applied`, never otherwise | Effect's `TestConsole.layer`, and `TestConsole.logLines` equals that one line or `[]` | none: `grant.ts` prints with `Console.log` |
| `instance-one-file…:441` | nothing: the spy only sets a return value on a stub | `getEntrypoint: () => rpc` written in the stub (amendment 2026-11-15: does not compile; the site moves to the 0042 Alchemy mocks plan, see "Slice 1") | none |
| `instance-one-file…:49` | the close of every real child spawned, so a port is free before reuse | a `ChildProcessSpawner` layer that wraps Node's and keeps each handle's exit | the Alchemy patch, slice 2 |
| `exam/alchemy-lifecycle…:33` | workerd's spawn, made into a fake child the law can crash | a `ChildProcessSpawner` stand-in that answers fake handles | the Alchemy patch, slice 2 |
| `door…:1871,1877,1888,5121` | WebCrypto `importKey`, `sign` and `verify` of the gateway's nonce, failed once, or held | `Recorder.layer(Mac.Mac, …, { fails })`, and a held `verify` in the impl | `GatewayNonce.ts` takes Effect's `Mac` and `SecureRandom`, slice 3 |
| `door…:1800` d3 | `getRandomValues` sets the waiting code's random `Uint32` | `SecureRandom.make(() => bytes of random)` as the law's layer | `Gateway.ts` takes `SecureRandom`, slice 3 |
| `door…:1027,1899,1916`, `runtime…:869` | `crypto.subtle.digest` is not called on a rate refusal, or fails once | (amended 2026-11-15, open question 1's answer) a stand-in crypto handed in with `WebCrypto.layer`, whose `subtle.digest` keeps each body it is asked and rejects or answers as the law says; its list stays `[]` on a rate refusal | `Gateway.ts` and `cloudflare/runtime.ts` read `WebCrypto.WebCrypto`, slice 3 |
| `door…:1030,1041` T843 `named` | `inputs.name` is not called on a rate refusal | (amended 2026-11-15, open question 2's answer) the gateway asks an `InputNames` service for an input's name, and the law records it with `Recorder.layer(InputNames, …)`; `Recorder.calls(InputNames)` is `[]` | `Gateway.ts` asks `InputNames`, and the program's `inputs.name` becomes that service's layer, slice 3 |
| `door…:1032,1043` T843 `next` | no process id is drawn on a rate refusal | `Recorder.layer(ProcessIdGenerator, …)` in the law's world; `controls.next` already reads that service | none |
| `runtime…:876,893` | an R2 `put` never runs when the checksum digest fails | a typed R2 stand-in whose `put` pushes onto a list the law owns: a platform object, not a service (0554, 0557) | none for this one, but it shares a law with the digest |
| `runtime…:310` | the startup build gets the law's parent span | the product gives the startup build a parent span | `cloudflare/runtime.ts`, slice 3 |
| `runtime-recovery…:1181` | the configure delivery is logged by Effect's logger (spies on `log`, `error` and `warn`) | `TestConsole`, through a `Console` the project runtime is given, read with `logLines`, `errorLines` and (amended 2026-11-15, ruling 4) app-e2e's `warnLines` | `cloudflare/runtime.ts`, slice 3 |
| `local-instance…:84,91,158,223` | `fetch` to the dev server, and `process.kill` never sent | the `FetchHttpClient.Fetch` stand-in, and the signal service of the `libfabrika/src/node/dev` slice | that slice's `process.kill` move, slice 4 |

## How others do it

- **Effect ships the services these spies stand in for**, in the installed effect 4.1.3
  (`node_modules/effect/src/`, read in this session): `crypto/Digest.ts` (`digest`, `digestHex`,
  typed `Effect<Uint8Array>` with no error), `crypto/Mac.ts` (HMAC `sign` and `verify`, typed
  `CryptoError`), `crypto/SecureRandom.ts` (`randomBytes`, and `make(randomBytes)` for a law's own
  bytes), `crypto/WebCrypto.ts` (a `Context.Reference<Crypto>` whose docs name "a test double" as a
  use), `http/FetchHttpClient.ts:35` (`Fetch`, a `Context.Reference<typeof fetch>`),
  `testing/TestConsole.ts` (`layer`, `logLines`, `errorLines`) and `process/ChildProcessSpawner.ts`.
  The app's own `grant.ts` and `dev.ts` already import `SecureRandom` and `Digest` from
  `effect/crypto`. So the known way for every outside call here is Effect's own service. A law
  provides a test layer for it, and the Recorder watches it where it is an Effect service.
- **Alchemy's own tests** spawn through `ChildProcessSpawner` and stand it in with
  `ChildProcessSpawner.make` (`@alchemy.run/cloudflare-runtime` 2.0.0-beta.85,
  `src/core/test/Docker.test.ts:180`). Their Node `Workerd` alone calls `node:child_process`
  directly (`dist/core/node/workerd/Workerd.mjs:212`) and exports no way to hand it a spawn. The
  patch makes `Workerd` do what the package's `Docker` already does. Alchemy's main branch was not
  read here, so whether upstream already changed this is not known. The build reads it first
  ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md)).
- **Wrapping a real service to watch it** is `Layer.unwrap` in Effect (`Layer.ts:1621`, stable):
  an Effect that reads the real service answers a layer. The Recorder's own `layer` is built the
  same way (`Recorder.ts:217`). So the "wrap form" the recorder plan left to this slice needs no
  new export: `Layer.unwrap(Service.pipe(Effect.map((real) => Recorder.layer(Service, real))))`.
  Call: 80%. The doubt is `Recorder.layer`'s `Single<S>` check: if `ClientManager` has an
  overloaded method, it does not compile (law R16). In that case the tests step reports it and
  stops, rather than adding a form.

## The other `vi` hits 0555 bans (amendment 2026-11-15, laptop lead's ruling)

The laptop lead ruled that `vi.mock`, `vi.doMock` and `vi.stubEnv` are 0555's own targets, so this
sweep fixes those hits too, and that a folder's lock lands whole in the one fold pull request only
once the folder is at zero. No interim narrower lock: that would be a list letting broken code pass
([0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)). Counted on main at `0683861`
with `rg -o 'vi\.(mock|doMock|stubEnv)\('` over the folder: 25 `vi.mock` in 12 files, 2
`vi.doMock` in 1 file, 13 `vi.stubEnv` in 3 files. Each row's way is 0555's own, from its
"Consequences".

| What it replaces | Calls | Where | In this sweep? |
|---|---|---|---|
| `virtual:fabrika-built` | 7 | `start-member`, `start-child`, `runtime.laws`, `runtime.decode`, `runtime-recovery`, `error-cause` laws | yes, slice 5: the built table is handed in by the entry file, which alone imports the virtual module, and each law hands in its own table |
| our own modules: `./table.ts` 3, `./door.ts` 1, `./local-instance.ts` 1, `./exam/compiler.ts` 1, `@kampus/libfabrika/node/build` 1, `@kampus/libfabrika/workers/runtime` 1, `@kampus/libfabrika/workers/gateway` 1 | 9 | `runtime.laws`, `runtime-recovery`, `runtime.decode`, `file-services`, `checklist-instance` | yes, slice 5: each becomes a value handed in or a service with a test layer (`Layer.mock`), per call; the bundler one is the bundler service 0555 names |
| `effect` | 1 | `runtime.laws` | yes, slice 3: it is there so Effect's `Layer` could be spied on, and that spy goes with the startup span change |
| `@effect/platform-node` | 2 | `grant-readers`, `file-services` | yes, slice 5: each entry (`grant.ts`, `dev.ts`) exports its program as an Effect, and the law runs it with the layers it needs, so nothing stands in for `NodeRuntime.runMain` |
| `rolldown` | 1 | `exam/bytes.integration` | yes, slice 5: the bundler service above; this law is not the wrapper's own, so 0555's exception does not apply |
| `vi.stubEnv` of `FABRIKA_HOME` 8, `FABRIKA_INSTANCE_PORT` 2, `TYPESAFE_API_KEY` 1, `DO_NOT_TRACK` 1, and 1 by a name that is not a plain string | 13 | `file-services`, `instance-one-file`, `local-instance` laws | yes, slice 5: the readers move to `Config` (`dev.ts:94`, `hands.ts:62` read `process.env.FABRIKA_HOME` today), and each law provides `ConfigProvider.layer(ConfigProvider.fromUnknown({ ... }))`; `TYPESAFE_API_KEY` stays unset in every law, as the root map's money rule asks |
| `alchemy/Deploy`, `../alchemy.run.ts`, and `vi.doMock` of `alchemy` and `@alchemy.run/cloudflare` | 4 | `local-instance`, `instance-one-file` laws | **no**: these stand in for Alchemy itself, which [0042](../../../.decisions/0042-platform-pieces-go-through-alchemy.md) makes the platform's one way in; how a law swaps Alchemy is that work's to say, and it has no plan yet |
| `cloudflare:workers` | 3 | `runtime-recovery`, `door.integration`, `checklist-instance` laws | **no**: 0042's Alchemy work, as in the cloudflare plan |

**So the folder cannot reach zero in this sweep, and its lock stays out.** The seven Alchemy and
`cloudflare:workers` hits wait on 0042's Alchemy work, which has no plan; the cloudflare plan's
finding row `2026-11-15-cloudflare-workers-mocks-have-no-slice` names it. The override in "The
lock" is not landed by any slice; it lands, whole and with all five methods, for
`next/apps/fabrika/src/**` on the day the folder is at zero. A6 and A8 wait with it. Slice 5 still
lands in this sweep, after PR 1366, since `local-instance.integration.test.ts` and
`runtime-recovery.laws.integration.test.ts` are in that diff. Confidence in slice 5's shape: 65%:
each row's way is 0555's, but none was read call by call, and the tests step stops and reports any
hit whose way needs a design call.

## The shape

Sketches, not compiled. Names are the installed effect 4.1.3's and the Recorder's as built.

### Slice 1: three sites, no product change (amended 2026-11-15; was four, A5 moved)

```ts
// file-services.laws.integration.test.ts: the Recorder's store must outlive dev.ts's own provide,
// so the law builds the layer once and hands the built context to the hoisted cli.layer.
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* Layer.build(
        Recorder.layer(FileSystem.FileSystem, FileSystem.makeNoop({ makeDirectory: () => Effect.never })),
      );
      cli.layer = Layer.merge(Layer.succeedContext(files), Path.layer);
      process.argv = [process.execPath, "dev.ts", "--child", `--parent=${parent}`];
      vi.resetModules();
      yield* Effect.promise(() => import("../dev.ts"));
      instanceFailure(yield* Effect.exit(cli.work!), "parent_gone");
      expect(yield* Recorder.calls(FileSystem.FileSystem, "makeDirectory").pipe(Effect.provideContext(files))).toEqual([]);
    }),
  ),
);
```

```ts
// grant-readers.laws.test.ts: run() takes the law's fetch; Console is a reference grant.ts does not
// provide, so TestConsole reaches it from outside.
type Sent = readonly [url: string, options: RequestInit | undefined];
const fetches = (answer: (url: string, options: RequestInit | undefined) => Promise<Response>) => {
  const sent: Array<Sent> = [];
  const fetch: typeof globalThis.fetch = (url, options) => {
    sent.push([String(url), options]);
    return answer(String(url), options);
  };
  return { sent, fetch };
};
const refused = () => fetches(() => Promise.reject(new Error("must not fetch")));

const run = (fetch: typeof globalThis.fetch) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(cli.work!);
      return { exit, logged: yield* TestConsole.logLines };
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.provide(TestConsole.layer)),
  );

// in a law
const f = refused();
const { exit } = await run(f.fetch);
typed(exit, "bad_url");
expect(f.sent).toEqual([]);
// the applied mode
expect(logged).toEqual(mode === "applied" ? [`Granted ${data.fingerprint} to ${data.target.for}`] : []);
```

`toEqual` on the whole log is stricter than `toHaveBeenCalledWith`, which passed with any other
line printed beside it. If `logLines` keeps each call's argument list and not its first argument,
the tests step writes the expected value in that shape. It does not loosen the check.

```ts
// instance-one-file.integration.test.ts:436: the stub answers rpc itself; no spy sets it
const stub: ReturnType<Platform["get"]> = { getEntrypoint: () => rpc, getDurableObjectClass: unused };
```

If `getEntrypoint`'s platform type is generic and `rpc` does not fit it, the stub is typed with the
one-line `satisfies` the type allows. A double cast is never written (`fabrika/no-type-assertions`).

**Amendment (2026-11-15 Pacific, the lead's ruling): A5 leaves this sweep and moves to the 0042
Alchemy mocks plan (`fabrikalfa/alchemy-mocks-plan`) as a normal row.** The tests step found that
the stub above does not compile. In `@cloudflare/workers-types` 5.20261109.1,
`WorkerStub.getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>()` is generic, so
`getEntrypoint: () => rpc` fails with TS2322, and the `satisfies` fallback does not exist for a
generic method. A function with one overload, which the type accepts, fails with TS2589 (type
instantiation is excessively deep). A cast is refused. This stub is Cloudflare's platform type,
which [0042](../../../.decisions/0042-platform-pieces-go-through-alchemy.md) sends through
Alchemy, and that plan is where platform stand-ins get their typed home. Slice 1 is now three
sites, A1 to A4, and its `getEntrypoint` spy stays in `instance-one-file.integration.test.ts`
until that plan's row lands.

```ts
// what the tests step tried, a sketch of the failure, not to be written
const stub: ReturnType<Platform["get"]> = { getEntrypoint: () => rpc /* TS2322 */, getDurableObjectClass: unused };
```

### Slice 2: Alchemy's Workerd spawns through Effect's ChildProcessSpawner

```ts
// patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch, a sketch of the change to
// dist/core/node/workerd/Workerd.mjs: makeNode reads the spawner from the context
const makeNode = () =>
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    make((command, args, config, configuredAddresses, env) =>
      spawner.spawn(ChildProcess.make(command, args, { env: externalEnv(env), extendEnv: false, additionalFds: { fd3: { type: "output" } } })),
      // the handle's stdout, stderr, fd 3, exit and kill map onto what make() reads today
    ),
  );
const WorkerdLive = Layer.effect(Workerd, isBun ? Effect.sync(makeBun) : makeNode());
// WorkerdLive now needs ChildProcessSpawner. NodeServices.layer provides it wherever ours builds Alchemy.
```

```ts
// exam/alchemy-lifecycle.test.ts: the law's spawner, in place of the spy on node:child_process
const spawned = () => {
  const children: Array<Child> = [];
  const sockets: Array<string> = [];
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => Effect.sync(() => fakeChild(children, sockets, command))),
  );
  return { children, sockets, layer };
};
// RuntimeLive.pipe(Layer.provide(observed), …, Layer.provide(os.layer))
```

The upstream issue is filed the same day by the lead, since a step here reaches only this repo. It
reports one gap: Node's `Workerd` cannot be given a spawner, while `Docker` can.

### Slice 3: after PR 1366, the gateway's and the runtime's crypto

```ts
// next/packages/libfabrika/src/gateway/GatewayNonce.ts, a sketch: Effect's Mac and SecureRandom
const gatewayNonce = Effect.fn("gateway.nonce")(function* (store, ttl: number, cap: number) {
  const mac = yield* Mac.Mac;
  const random = yield* SecureRandom.SecureRandom;
  const secret = yield* random.randomBytes(32); // only when no key is saved, as today
  const key = yield* Mac.key(Mac.hmac(Digest.sha256), bytes).pipe(Effect.mapError(fail));
  const issue = Effect.fnUntraced(function* (client: string) {
    const salt = Base64Url.encode(yield* random.randomBytes(24));
    const tag = yield* mac.sign(key, text(client, yield* clock, salt)).pipe(Effect.mapError(fail));
    // …
  });
  const check = /* … */ mac.verify(key, tag, data).pipe(Effect.mapError(fail));
  // fail = (cause: CryptoError.CryptoError) => new GatewayError({ reason: new Crypto({ cause }) })
});
// Gateway.layer's requirements gain Mac | SecureRandom | InputNames; the app's runtime.ts provides
// Mac.layerWebCrypto and SecureRandom.layerWebCrypto. Amended 2026-11-15: no Digest. The digests in
// Gateway.ts and cloudflare/runtime.ts read the WebCrypto reference, which needs no provide, and
// keep the typed `crypto` refusal (open question 1's answer).
```

```ts
// Gateway.ts's digests, slice 3, a sketch (amended 2026-11-15): the cloudflare plan's checkedPut shape
const crypto = yield* WebCrypto.WebCrypto;
// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
const digest = yield* Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });

// next/packages/libfabrika/src/gateway/InputNames.ts, the contract only (0095). A sketch; the
// name is the build's to confirm, and a glossary row follows if it stays.
export class InputNames extends Context.Service<
  InputNames,
  { readonly name: (input: unknown) => Effect.Effect<string> }
>()("@kampus/libfabrika/gateway/InputNames") {}
// The program's `inputs.name` mapping is handed in as `Layer.succeed(InputNames, { name })`, so a
// caller that names inputs today keeps its function and wraps it once.
```

- **Why a service for `inputs.name`** (amendment 2026-11-15, open question 2's answer): 0555 says
  "a call the law wants to watch goes through a service", and the transport row reads that as the
  rule for every callback of ours. The cost the first lean named stays: each gateway caller
  provides one more layer. The slice 3 tests step lists the callers before it starts.

```ts
// door.integration.test.ts, the crypto edges: a CryptoError value the law makes, failed once
const crypto = (thrown: unknown) =>
  new CryptoError.CryptoError({ module: "Mac", method: "sign", reason: new CryptoError.Unsupported({ cause: thrown }) });
const macs = Recorder.layer(Mac.Mac, real, { fails: { sign: crypto(thrown) } });
// …the refusal keeps that very CryptoError as its cause: expect(failure.reason.cause).toBe(theError)
```

`Mac.key` makes a key from bytes and calls no WebCrypto, so the `importKey` edge no longer exists
in our code. Its law becomes the `sign` edge's twin on the first nonce. The reviewer reads that as a
changed law, and the lead sends it to the owner with open question 1.

**The startup span, lean 65%.** `SettingsRuntime.make`'s cache builds the layer with the services
it took at construction (`requireServicesAt: "construction"`), so the first caller's span never
reaches the build. The product change: `projectRuntime` builds `ready` under
`Layer.withParentSpan` of the span the first request carries. The law then makes its first request
under `Effect.withParentSpan(span)` and keeps its assertion, `traceId: w.span.traceId`, unchanged.
Slice 3's tests step reads `cloudflare/runtime.ts` after PR 1366 merges. If the first caller's span
cannot reach the build without changing `SettingsRuntime` for every runtime, it stops and asks.

**The recovery log.** The three console spies read Effect's logger, which writes through the
`Console` reference (`Logger.ts:340`). The project runtime is a `ManagedRuntime`, so a `Console`
the law provides from outside does not reach it. The product change: the project runtime's layer
takes `Console` from the `ProjectOptions` it is given, which default to Effect's own. The law hands
it `TestConsole`'s `Console` and reads `TestConsole.logLines` and `errorLines`.

### Slice 4: after PR 1366 and the `node/dev` slice

`local-instance.integration.test.ts`'s `fetch` spy becomes the `FetchHttpClient.Fetch` stand-in
from slice 1. `local-instance.ts:51` already provides `FetchHttpClient.layer`. Its `process.kill`
spy becomes the recorded signal service that the `libfabrika/src/node/dev` slice adds for its own 6
`process.kill` spies. The recorder plan's row says that move is needed first. This slice follows
that slice's service as it lands and adds no service of its own.

### The lock

```jsonc
// .oxlintrc.json, one override of its own. The oxlint-plugins plan's override also bans mock,
// doMock and stubEnv, which this folder still has (0555's other sweeps), so the folder cannot join
// it yet. A file joins `files` in the slice that takes it to zero; slice 4 replaces the list with
// "next/apps/fabrika/src/**". When the folder's mocks and env stubs reach zero too, its glob moves
// into the full override and this one goes.
{
  "files": [
    "next/apps/fabrika/src/file-services.laws.integration.test.ts",
    "next/apps/fabrika/src/grant-readers.laws.test.ts"
  ],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "fn": "Watch calls with a Recorder, or keep a plain list the test owns (0579).",
        "spyOn": "Put the call behind a service and record it in the law's layer (0555)."
      }
    ]
  }
}
```

**Amendment (2026-11-15, merge session ruling 2): one lock shape everywhere.** The sweep's blocks
refuse all five methods, `fn`, `mock`, `doMock`, `spyOn` and `stubEnv`, with node's five messages,
and node's M1 ([`mock-node-PLAN.md`](./mock-node-PLAN.md), "Laws") is every block's law: the
shared `VI_METHODS` plant set, run in each path of every block that sets the rule. So a file of
this folder joins that five-method block the day it is at zero for all five, and the folder's glob
joins when the folder is. The two-method override above is the first sketch. Read as written, the
ruling leaves no lock on the files that still hold the other sweeps' calls, and on this plan's
files that is all but one (see the doubts). The laptop lead ruled the same day (this closes open
question 3): no file list and no narrower override in between (0524). The override above does not
land in this sweep; the folder's lock lands whole, with all five methods, on the day the folder is
at zero, after 0042's Alchemy work.

- Probed in this session on the installed oxlint 1.90.0, in the scratchpad: the rule refuses
  `vi.fn()` and `vi.spyOn(...)`. It does not see `v.fn()` after `const v = vi`. The oxlint-plugins
  plan found that it does see `v.fn()` after `import { vi as v }`.
- **`toHaveBeenCalled*` is not locked by its own rule, call 80%.** `vitest/no-restricted-matchers`
  exists and works, but it needs every spelling as its own key (`not.toHaveBeenCalled`,
  `toHaveBeenCalledWith` and the rest, probed here). A matcher only works on a mock, and with `fn`
  and `spyOn` refused the folder has none: its `vi.mock` factories build their stand-ins from plain
  functions. The doubt: `vi.mocked` or a `vi.mock` factory could still hand a law a mock. What would
  settle it: the review reads the folder at zero for any matcher left.
- No warn level and no list of leftovers
  ([0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)). The `files` list names files
  that are at zero, so it lets nothing broken pass.
- **Is this a setting?** No. Where a lint rule applies is a code rule of the repo, not a choice a
  person makes in `fabrika.toml` ([0069](../../../.decisions/0069-choices-are-settings.md)).

## One value traced: p27 with `to: "project-b"`

1. The law's world builds `clients`: `Layer.unwrap` reads the real `ClientManager` from `w.env`
   and answers `Recorder.layer(ClientManager, real)`, so `ClientManager` and its store are in the
   context, and every method still runs the real code.
2. `d.grant` decodes the grant text, finds `to: "project-b"` is not this ledger, and answers
   `{ _tag: "refused", reason: "wrong_ledger" }`.
3. Nothing ran `write`, so the store holds no `write` record. Reads of other methods, if the
   gateway made any, are recorded and ignored.
4. Still inside the provide, `yield* Recorder.calls(ClientManager, "write")` answers `[]`. A plant
   that calls `clients.write(...)` before the ledger check makes it `[[…args]]`, and p27 goes red.

## Laws

Every law here exists and is rewritten, never deleted. Each keeps every value it compared. The
plant is what the review runs once to see it red.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| A1. `dev` refuses every invalid parent with `parent_gone` before any `makeDirectory` | test | fc.oneof: the four invalid-parent shapes, as today, 4 runs (30 at full depth) | in `next/apps/fabrika/dev.ts`, call `fs.makeDirectory(home)` before the parent check: the recorded list is not `[]` | next/apps/fabrika/src/file-services.laws.integration.test.ts |
| A2. The grant command fetches nothing on a bad URL, a usage error or an unknown flag | test | fc.oneof: the bad URLs, as today, with fc.string and fc.integer for the usage law and fc.uuid for flags, 3 runs each (20, 25 and 10 at full depth) | in `next/apps/fabrika/grant.ts`, fetch the target before parsing the URL: `sent` is not `[]` | next/apps/fabrika/src/grant-readers.laws.test.ts |
| A3. Each grant mode sends exactly its GET and POST, and prints `Granted <key> to <for>` once on `applied` and nothing else | test | fc.constantFrom: the modes, as today, 3 runs (12 at full depth) | print the line on `refused` too, or print a second line: `logLines` differs | next/apps/fabrika/src/grant-readers.laws.test.ts |
| A4. p27: a granted, revoked or added grant with a wrong `to` never calls `ClientManager.write` and founds nothing | test | Effect Arbitrary: Grant.fields.to | in `next/packages/libfabrika/src/gateway/Gateway.ts`, write the client before the ledger check (the plant is made on a scratch copy; that file is in PR 1366 and is not changed) | next/apps/fabrika/src/door.integration.test.ts |
| A5. Amendment 2026-11-15 (the lead's ruling): A5 moves to the 0042 Alchemy mocks plan and does not land in this sweep (see "Slice 1"). p33 loader: the loader records the real config and answers typed `no_program` for an unknown name | test | fc.string: the source, with fc.uuid for the process, as today, 3 runs | answer the bare short name: the `no_program` check is red | next/apps/fabrika/src/instance-one-file.integration.test.ts |
| A6. The lock refuses `vi.fn` and `vi.spyOn` in the files at zero and nowhere else in the folder; a file at zero for all five is in the five-method block and refuses all five (amendment 2026-11-15, ruling 2). Amendment 2026-11-15 (the laptop lead's ruling): A6 does not land in this sweep; it lands with the folder's whole lock once the folder is at zero | test | scenario: the real oxlint over a planted `vi.fn()` in a locked file and in an unlocked file of the folder, through `plantIn` | delete the new override: the locked row stops firing | oxlint-plugins/plants.test.ts |
| A7. Node's M1 (amendment 2026-11-15, ruling 2): the `VI_METHODS` lines are refused in every path of every block that sets the rule, `vi.fn()`, `vi.spyOn(console, "log")`, `vi.mock`, `vi.doMock` and `vi.stubEnv` among them, and `v.fn()` after `import { vi as v }` joins the set; a plain list is not refused | test | scenario: node's `VI_METHODS` set | drop `fn` from the rule's options: the `vi.fn()` line passes | oxlint-plugins/builtin-plants.ts |
| A8. The locked files are at zero: `pnpm lint` passes with the lock an error, and no disable line names it. Amendment 2026-11-15 (the laptop lead's ruling): A8 waits with A6 | lint | lint | put back `const touched = vi.fn(() => Effect.never)`: `pnpm lint` exits 1 | next/apps/fabrika/src/file-services.laws.integration.test.ts |
| B1. Alchemy's lifecycle reports spawn ids, replacement delays and the brake, and a closed scope cancels recovery, with workerd spawned through the law's `ChildProcessSpawner` | test | fc.string: the worker name, as today, 3 runs | in the patch, spawn with `node:child_process` again: the law's spawner sees no child and the start event is missing | next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts |
| B2. The installed lifecycle patch matches its locked hash | test | format: the one registration line and its sha256 | edit the patch without `pnpm patch-commit`: the hash differs | next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts |
| B3. A port is reused only after every child spawned on it has closed | test | pinned: the two instances on one held port, as today | resolve the wait before the handles' exits: the second instance's bind fails with address in use | next/apps/fabrika/src/instance-one-file.integration.test.ts |
| C1. T843: a rate refusal draws no process id, names no input, hashes nothing and delivers nothing | test | Effect Arbitrary: small | in `Gateway.ts`, draw a process id before the rate check: `Recorder.calls(ProcessIdGenerator)` is not `[]`; (amended 2026-11-15) name the input before the rate check: `Recorder.calls(InputNames)` is not `[]`; hash before it: the stand-in crypto's list is not `[]` | next/apps/fabrika/src/door.integration.test.ts |
| C2. d3: any random `Uint32` gives a six-digit waiting code with its leading zeros | test | fc.integer: 0 to 0xffffffff, with 4294967295 pinned, as today, 3 runs (30 at full depth) | keep seven digits: the code differs | next/apps/fabrika/src/door.integration.test.ts |
| C3. A crypto failure at each of the nonce's and the digest's edges is refused with `crypto`, keeps the failure as its cause, and delivers nothing | test | fc.anything: the thrown value, kept inside the `CryptoError`, 3 runs (15 at full depth) | map a `CryptoError` to `Storage` at any edge: that edge's row is red | next/apps/fabrika/src/door.integration.test.ts |
| C4. Two `initialize` calls that race on a held `verify` spend the nonce once | test | scenario: one held `Mac.verify` and two forked calls, as today | spend before the verify: both succeed | next/apps/fabrika/src/door.integration.test.ts |
| C5. The fingerprint and archive checksum refuse every digest failure with `crypto`, and no R2 `put` runs | test | fc.oneof: the failure values, as today, 3 runs (20 at full depth) | run `put` before the digest: `puts` is not `[]` | next/apps/fabrika/src/runtime.laws.integration.test.ts |
| C6. The bootstrap entry keeps the caller's span trace | test | Effect Arbitrary: Trace | build the startup layer with no parent span: `traceId` differs | next/apps/fabrika/src/runtime.laws.integration.test.ts |
| C7. A failed, interrupted or healthy configure restores the descriptor and logs the delivery, read from every channel the spies read: `logLines`, `errorLines` and `warnLines` (amended 2026-11-15, ruling 4) | test | pinned: the three faults, as today | drop the delivery's log line: `logLines` lacks it; log it at warning: red only if `warnLines` is not read | next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts |
| D1. The local instance fetches its dev server and never signals a process it did not start | test | pinned: the instance's start and stop, as today | signal the parent on stop: the signal service's record is not `[]` | next/apps/fabrika/src/local-instance.integration.test.ts |

- C3's generator changes. Today it draws "a rejection or a throw, of any value". On `Mac` the
  throw-or-reject split happens inside Effect's layer, so the law draws the value a `CryptoError`
  carries. It checks the refusal keeps that very error as its cause. Its digest rows waited on open
  question 1; with its answer (amended 2026-11-15) they keep today's generator, a rejection or a
  throw of any value from the stand-in crypto's `digest`, and today's check, a `crypto` refusal
  with that value as its cause. C5 is the same. No digest law changes what it checks.
- Real resources: B3 and D1 run a real workerd or a real child, and are `*.integration.test.ts`
  files already, run on the schedule (0536). A stand-in cannot replace the real child there, since
  what they check is a real port and a real process. They are not new, so 0581's "why no stand-in"
  is already answered. B1 runs Alchemy's real code on fake children, so it stays a plain test. No
  law needs the owner's Mac or a launchd entry, so none is host-only and none waits on 0178's yes.
- No law reads a secret, so no `[secrets]` flow is needed.
- Lint, type or test? A8 and the lock are lint. A6 and A7 test that the config does what it says.
  The rest are tests. No type law: the Recorder's own type laws (R1 to R18) already hold the typed
  reads used here.

## Steps

**Amendment (2026-11-15, merge session ruling 1): one pull request for the sweep.** No slice opens
a pull request of its own (the first version said "Each slice is one pull request"). Each slice
lands on the mock sweep's one fold branch, `fabrikalfa/mock-fold`, and in its one pull request
(0589, amended 2026-11-15), after its own steps, one fresh agent each, in its own box:

1. **Tests:** rewrites the slice's laws, writes the lock rows and plants, runs each plant once.
2. **Build:** slices 1 and 2 have no product file for the build: slice 1 changes none, and slice
   2's patch and lockfile are exam paths, so the tests step writes them. There the build changes
   nothing, says so, and runs the checks green, or sends back. Slices 3 and 4 write the product
   change, and so does slice 5 (amendment 2026-11-15): the built table handed in by the entry, the
   services or handed-in values for our own modules and the bundler, the entries' exported
   programs, and the `FABRIKA_HOME` reads moved to `Config`.
3. **Review:** the one review of the slice's whole diff against this plan, 0555 and 0579, with the
   loosening check on every rewritten law.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/apps/fabrika/src/file-services.laws.integration.test.ts | tests | tests | slice 1: A1 |
| next/apps/fabrika/src/grant-readers.laws.test.ts | tests | tests | slice 1: A2, A3 |
| next/apps/fabrika/src/door.integration.test.ts | tests | tests | slice 1: A4; slice 3: C1 to C4 |
| next/apps/fabrika/src/instance-one-file.integration.test.ts | tests | tests | slice 2: B3 (amendment 2026-11-15: slice 1's A5 moves to the 0042 Alchemy mocks plan) |
| .oxlintrc.json | tests | none | slices 1 to 4: the override, its `files` growing, then the folder glob |
| oxlint-plugins/builtin-plants.ts | tests | tests | slice 1: A7 |
| oxlint-plugins/plants.test.ts | tests | tests | slice 1: A6; slice 4 changes its rows to the glob |
| oxlint-plugins/README.md | tests | docs | slice 1: one paragraph on this override and why it is apart from the full one |
| .patterns/a-law-watches-calls-with-a-recorder.md | build | docs | slice 1: two cases, the wrap of a built service through `Layer.unwrap`, and a built context handed to code that provides its own layers |
| next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts | tests | tests | slice 2: B1, B2 |
| patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch | tests | 40 | slice 2: Node `Workerd` spawns through `ChildProcessSpawner`, made with `pnpm patch`; an exam path, so the tests step writes it |
| patches/ | tests | none | the folder of the patch above; no other file in it changes |
| pnpm-lock.yaml | tests | 1 | slice 2: the patch's new hash, written by `pnpm patch-commit` |
| next/packages/libfabrika/src/gateway/GatewayNonce.ts | build | 30 | slice 3: `Mac` and `SecureRandom` |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 24 | slice 3, after PR 1366: `SecureRandom`, the digests through the `WebCrypto` reference, and (amended 2026-11-15) the input's name through `InputNames` |
| next/packages/libfabrika/src/gateway/InputNames.ts | build | 10 | slice 3, new (amended 2026-11-15): the contract only |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 25 | slice 3, after PR 1366: the digest through the `WebCrypto` reference, the startup span and the `Console` option |
| next/apps/fabrika/src/runtime.ts | build | 25 | slice 3: provides `Mac.layerWebCrypto`, `SecureRandom.layerWebCrypto` and the program's `InputNames` (amended 2026-11-15; was the three `effect/crypto` layers); slice 5 (amendment 2026-11-15): the built table handed in by the entry, not imported from `virtual:fabrika-built` |
| next/packages/libfabrika/src/gateway/GatewayCauseTest.ts | tests | tests | slice 3: its C5 row on the shared WebCrypto callback moves to `Mac`'s error |
| next/apps/fabrika/src/hands-client.test.ts | tests | tests | slice 3: provides the `Mac` and `SecureRandom` layers and an `InputNames` layer to `Gateway.layer` (amended 2026-11-15) |
| next/apps/fabrika/src/door-spans.test.ts | tests | tests | slice 3: the same |
| next/apps/fabrika/src/door-recovery.integration.test.ts | tests | tests | slice 3: the same |
| next/apps/fabrika/src/runtime.laws.integration.test.ts | tests | tests | slice 3: C5, C6 |
| next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts | tests | tests | slice 3, after PR 1366: C7 |
| next/apps/fabrika/src/local-instance.integration.test.ts | tests | tests | slice 4, after PR 1366 and the `node/dev` slice: D1 |
| next/apps/fabrika/src/start-member.laws.integration.test.ts | tests | tests | slice 5 (amendment 2026-11-15): the built table handed in |
| next/apps/fabrika/src/start-child.laws.integration.test.ts | tests | tests | slice 5: the built table handed in |
| next/apps/fabrika/src/runtime.decode.test.ts | tests | tests | slice 5: the built table and our own modules handed in |
| next/apps/fabrika/src/error-cause.test.ts | tests | tests | slice 5: the built table handed in |
| next/apps/fabrika/src/checklist-instance.laws.integration.test.ts | tests | tests | slice 5: `./table.ts` handed in; its `cloudflare:workers` mock stays (0042) |
| next/apps/fabrika/src/exam/bytes.integration.test.ts | tests | tests | slice 5: the bundler service in place of `vi.mock("rolldown")` |
| next/apps/fabrika/dev.ts | build | 12 | slice 5: `FABRIKA_HOME` read through `Config`; the program exported as an Effect for its law |
| next/apps/fabrika/grant.ts | build | 6 | slice 5: the program exported as an Effect for its law |
| next/apps/fabrika/hands.ts | build | 4 | slice 5: `FABRIKA_HOME` read through `Config` |
| next/packages/libfabrika/src/node/build/Bundler.ts | build | 25 | slice 5, new: the bundler service 0555 names, the contract and its live layer |

- Every test layer named stays beside its service (0538). The app's other test files that build
  `Gateway.layer` gain the `Mac` and `SecureRandom` layers and an `InputNames` layer in slice 3
  (amended 2026-11-15), each a one-line `Layer.provide`. Libfabrika's own gateway tests get the same line in the slice that makes the
  move. The tests step lists every file the new requirement reaches before it starts.
- `next/AGENTS.md`'s libfabrika test: the `Mac`, `SecureRandom`, `WebCrypto` and `InputNames` moves are in
  libfabrika, where the code they change lives, since any client of libfabrika needs them. The
  app's `runtime.ts` only provides the layers.
- The `libfabrika/src/gateway` mock slice counts 4 more `crypto.subtle` spies on the same
  `Gateway.ts` digests. Slice 3's product change serves both. Whichever plan's slice lands first
  makes it, and the other reads it.

## Calls taken

- **Five slices, ordered by what can land now** (amended 2026-11-15: slice 5 added by the laptop
  lead's ruling), 85%: slice 1 (no product change), slice 2
  (the patch), slice 3 (after PR 1366), slice 4 (after PR 1366 and the `node/dev` slice). Each
  lands whole on the sweep's one fold branch and locks the files it took to zero (amended
  2026-11-15, ruling 1: first written as four pull requests).
- **A failed digest stays a typed `crypto` refusal through the `WebCrypto` reference**, and **a
  watched callback goes through a service** (amendment 2026-11-15, merge session rulings, no longer
  calls; both first leans are marked wrong).
- **No new Recorder form for the wrap,** 80%: `Layer.unwrap` over `Recorder.layer`, Effect's own
  way. See "How others do it".
- **A built context for code that provides its own layers,** 85%: `dev.ts` and `grant.ts` run under
  their own `Effect.provide`, so a Recorder layer built inside starts a new store a law cannot read.
  `Layer.build` once in the law's scope and `Layer.succeedContext` share one store. That is the
  Recorder doc's "each build starts with no calls", used on purpose.
- **Effect's `crypto` services for `Mac` and `SecureRandom`,** 85%: the makers' own, already
  imported by the app. The digest's error model was open question 1, now answered.
- **A typed list for `fetch` and for R2's `put`,** 85%: `fetch` is a function reference, not an
  Effect service, and R2 is a platform object (0554, 0557). The Recorder watches Effect services
  only (its pattern doc, "Where it applies").
- **The lock is its own override banning `fn` and `spyOn`,** 85%: the folder still has `vi.mock`
  and `vi.stubEnv`, which other sweeps clear.
- **What fact is lost if not recorded now?** None. A call record lives only inside one test run.
  The before count (5, 14, 23 at `f7169af`) goes in each slice's run row.

## Validation

- Tests step, each slice: `pnpm format`, `pnpm lint` with `NODE_OPTIONS=--max-old-space-size=6144`,
  then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on that slice's files only. The
  `.integration.` files it changes are run once, since they are this slice's laws. Each plant is
  run once and recorded in the step's report.
- Build: the same narrow paths after its change. Slice 2 also reruns
  `next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts` after `pnpm install --frozen-lockfile`.
- The lead runs the changed-files test run and the one type check per slice.

## Size

Confidence in the line counts: 70%. The doubts are the Alchemy patch and slice 3's span and
`Console` options.

All five slices land on `fabrikalfa/mock-fold`, the sweep's one fold branch, in its one pull
request (amendment 2026-11-15, ruling 1).

1. Slice 1, the three sites with no product change (amendment 2026-11-15: the fourth, A5, moves
   to the 0042 Alchemy mocks plan, 1 spy and about 5 test lines fewer), the lock for two files, its plants and the
   pattern doc: about 0 product lines, about 110 test lines changed, about 20 config lines, about
   30 lines of docs. 0 lines.
2. Slice 2, the Alchemy patch and the two spawn laws, and the lock for two more files: about 41
   product lines (the patch and its lockfile hash), about 60 test lines. 41 lines.
3. Slice 3, after PR 1366: the gateway's and the runtime's crypto, `InputNames` (amended
   2026-11-15), the startup span and the `Console` option, with their laws: about 94 product
   lines, about 160 test lines. 94 lines.
4. Slice 4, after PR 1366 and the `node/dev` slice: `local-instance`'s two spies: about 0 product
   lines, about 30 test lines (amended 2026-11-15: the lock no longer lands here, nor in slices 1
   and 2). 0 lines.
5. Slice 5 (amendment 2026-11-15, the laptop lead's ruling), after PR 1366: 33 of the folder's 40
   `vi.mock`, `vi.doMock` and `vi.stubEnv` hits, by the ways in "The other `vi` hits 0555 bans";
   the seven that wait on 0042's Alchemy work stay. About 70 product lines, about 250 test lines.
   Confidence 55%: no hit was read call by call. 70 lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder
plan priced them: slice 1, tests $6, a build that only runs checks $3, review $3; slice 2, tests $5,
build $6, review $3, one likely send-back $5; slice 3, tests $7, build $7, review $4, one likely
send-back $5; slice 4, tests $4, build $2, review $2. Amendment 2026-11-15: slice 5, tests $9 (eleven
law files), build $8, review $4, two likely send-backs $10, for the 55% shape.

Estimate: 19 steps, $93

## Records

- `.patterns/a-law-watches-calls-with-a-recorder.md`: the two new cases, in slice 1.
- `oxlint-plugins/README.md`: the override's paragraph, in slice 1.
- `.glossary/TERMS.md`: no row. This coins no word.
- No decision file, unless the owner answers open question 1 or 2 with a rule that reaches past
  this folder. Then it is recorded with `/adr` the turn it is decided. (Amendment 2026-11-15: both
  were answered by the merge session's rulings, recorded here as amendments; whether they need
  their own decision file is the merge session's call.)
- `.glossary/TERMS.md`: an `InputNames` row in slice 3, if the build keeps the name.
- `field/`: one run row per step, the same day. The tracker ticket is 1067.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run. The likeliest misses: the
  `Layer.succeedContext` type against the hoisted `cli.layer` union, and `Single<S>` on
  `ClientManager`.
- **Whether `TestConsole.logLines` keeps a call's first argument or its whole argument list.** Its
  doc example shows strings. The tests step writes the expected value in whatever shape it keeps.
- **Whether Alchemy upstream already spawns `Workerd` through a spawner.** Not read here.
- **How `instance-one-file`'s instance gets the law's spawner.** The instance starts through our
  own `local-instance.ts` and Alchemy's deploy. If no layer reaches Alchemy's runtime from the law,
  B3 needs a product seam too, and the tests step stops and reports it.
- **The `node/dev` slice's signal service.** Slice 4 follows it as it lands, and it is not planned
  here.

## Open questions

None.

## Answered questions

3. **(Answered 2026-11-15 by the laptop lead: no interim lock, 0524; slice 5 fixes the hits it
   can, and the folder's lock stays out of this sweep, since seven hits wait on 0042's Alchemy
   work. The lean was wrong.) For the merge session (amendment 2026-11-15): where do this folder's files keep their lock
   while they still hold `vi.mock`, `vi.doMock` or `vi.stubEnv`?** Ruling 2 gives every block all
   five methods. Read as written, a file with another sweep's call is in no block, so the `fn` and
   `spyOn` hold this plan had on the files it lists shrinks to `exam/alchemy-lifecycle.test.ts`. That
   loosens A6 and A8, so it is not applied. Lean, 80%: keep the two-method override for those files,
   with node's M1 plants for what it names and the other three recorded as taken there; each file
   moves to the five-method block the day the other sweeps take it to zero. The same question
   stands in the cloudflare and node-dev plans. The other way: no lock in this folder until 0555's
   other sweeps finish, and new `vi.fn` or `vi.spyOn` lines can land until then.

**Amendment (2026-11-15, merge session rulings):** questions 1 and 2 were answered. Both leans
were wrong. They are kept as they were asked.

1. **(Answered 2026-11-15: a typed `crypto` refusal, through Effect's `WebCrypto` reference; the
   lean was wrong.) A SHA digest that fails: a defect, as Effect's `Digest` types it, or a typed `crypto`
   refusal, as five laws hold today?** Lean 60%: Effect's `Digest`. A digest only fails on a broken
   runtime, and the makers type it as one that cannot fail. The cost: the five laws that plant a
   digest failure (`door.integration.test.ts` fingerprint and input hash rows,
   `runtime.laws.integration.test.ts`'s fingerprint and archive checksum, and the gateway slice's
   `GatewayRevocation` rows) change to plant a defect and check that nothing is stored or delivered.
   They stop checking for the `crypto` reason. The other answer: our own small `Hashes` service in
   libfabrika, typed `Effect<Uint8Array, CryptoError>` on WebCrypto, which keeps every law as it
   is. Either way slice 3 starts after the answer.
2. **(Answered 2026-11-15: a service, 0555; the lean was wrong.) A callback of our own API that a law watches, here the gateway's `inputs.name`: a service, as
   the recorder plan's `transport/` row says, or a plain list the law owns, as the oxlint-plugins
   plan does for oxlint's `report`?** Lean 70%: a plain list. `inputs.name` is a pure mapping the
   program hands over with its Schema. A service would make every gateway caller provide a layer
   for a function with no effect. The doubt: the transport row's answer for `admit`, `consume` and
   `route` reads as the rule for every callback of ours.

## Findings

None.

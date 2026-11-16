
Plancheck-Version: 3

# Plan: the `cloudflare:workers` and Alchemy mocks go, so three folders' `vi` locks can land, in next/ (ticket 1067)

All of this is in `next/`. Today's version is not touched. It finishes the part of the mock sweep
(ticket 1067, plans in pull request 1491 on `fabrikalfa/mock-plans`) that the sweep left out: the
`vi.mock` calls that stand in for Cloudflare's platform module or for Alchemy, in three folders. It
builds [0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.mock` or `vi.doMock`: a
stand-in comes from the code's own design) and
[0042](../../../.decisions/0042-platform-pieces-go-through-alchemy.md) (the platform only through
Alchemy, amended by 0050 and 0054), follows
[0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) (no list lets broken code pass,
so each folder's lock lands whole) and
[0054](../../../.decisions/0054-read-upstream-before-patching-it.md) (Alchemy's installed version
was read before any change to it is proposed). It resolves the finding
`2026-11-15-cloudflare-workers-mocks-have-no-slice` (in the cloudflare plan's "Findings" on
`fabrikalfa/mock-plans`).

```ts
// The whole idea, on runner-reply.laws.test.ts. A sketch, not compiled.
// Before: box.ts imports the platform's class, so every law that loads it swaps the module out.
//   box.ts:            import { WorkerEntrypoint } from "cloudflare:workers";
//   the law:           vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
//                      const Box = programBox(program, BUILD);
// After: the base class is handed in, as Alchemy's own bridges take it
// (@alchemy.run/cloudflare 2.0.0-beta.85, src/Workers/WorkerBridge.ts:64, makeWorkerBridge(Base, meta)).
//   the generated program entry (bundle.ts), the one place that names the platform module:
//     import {WorkerEntrypoint} from "cloudflare:workers"; ... export default programBox(WorkerEntrypoint, program, name);
//   the law:           const Box = programBox(Stub.Base, program, BUILD);   // no vi.mock
```

## Doubts, read these first

- **Slice 4's live layer may not build from the brain's binding yet (70%).** It wraps Alchemy's
  `Cloudflare.WorkerLoader`, but the brain still receives `env.LOADER` as a raw binding until
  0042's port moves it onto Alchemy's Worker. If Alchemy's service cannot be made from that binding
  today, the fallback is one marked edge: `IsolatesAlchemy.ts` wraps the raw binding in that one
  line, under 0042's rule for a gap, and the law W1 is unchanged, since it sees only `Isolates`.
- **Slice 2's real Alchemy deploy over test providers has not run (65%).** The two Alchemy laws
  move from module mocks to Alchemy's real `Stack` and `deploy` with `inMemoryState()` and test
  providers made with `Provider.effect`. Each name is in beta.85's source (below), but nothing here
  ran it. What could break: `deploy` may ask for a service the laws do not give (the
  `AlchemyContext`, `ArtifactStore`, `Interaction` and auth layers `instance.ts` provides today), or
  call a provider member the test provider leaves out (`read`, `diff`). The tests step runs the
  first law before it rewrites the rest; a blocker found there is a stop and a report, not a
  workaround.
- **Four of the twelve `cloudflare:workers` mocks look dead already (90%).** `connection.test.ts`,
  `leave.laws.test.ts`, `reload.laws.test.ts` and `door.integration.test.ts` import nothing that
  reaches `box.ts`, the one product file in `next/packages/libfabrika` or `next/apps/fabrika/src`
  that a Node test can load and that imports `cloudflare:workers`. Alchemy reaches the module only
  through a dynamic import with a fallback (below), so it needs no mock. Read from the import lines,
  not run.
- **The app folder still is not at zero after this plan alone.** PR 1366 (merged 2026-11-16 as
  `e3f72bf`) added `runtime-quotas.laws.test.ts` with three `vi.mock` calls. One is a
  `cloudflare:workers` mock and is this plan's. The other two, `./table.ts` at `:45` and
  `virtual:fabrika-built` at `:48`, are the kind the app-src plan's slice 5 fixes, but they came
  after its count at `0683861`, so its plan does not list them. A finding row below hands them to
  that slice. A6 and A8 wait for both.

## What changes, in one paragraph

`programBox` in `next/packages/libfabrika/src/cloudflare/box.ts` takes the platform's
`WorkerEntrypoint` class as its first argument, as Alchemy's own `makeWorkerBridge` does, so
`box.ts` imports nothing from `cloudflare:workers`. The generated program entry in
`node/build/bundle.ts` is the one place that names the module, as Alchemy's own generated entry
is, marked as an edge under 0042's ProgramBox gap. Laws hand in `Stub.Base`, an empty class from
the test package. Then nothing a Node law loads in the three folders reaches `cloudflare:workers`,
and all twelve `vi.mock("cloudflare:workers")` lines are deleted. For Alchemy, `stack` in
`next/apps/fabrika/alchemy.run.ts` takes its providers and its state layer from the caller, with a
`StackLayers` reference whose default is today's (`Cloudflare.providers()`, `localState()`), so the
two app laws run Alchemy's real `Stack` and `deploy` over Alchemy's own test seams
(`Provider.effect`, `inMemoryState()`), and the four Alchemy mocks go. Once a folder is at zero, its
waiting lock (cloudflare M11, node-dev M1, app-src A6 and A8) lands whole in the sweep's one fold
pull request. Slice 4 (moved here from the app-src plan on 2026-11-16, with the lead's yes) takes law A5's
`getEntrypoint` spy: `workerLoader` asks for an `Isolates` service with no type parameter, whose
live layer wraps Alchemy's `Cloudflare.WorkerLoader`.

## How others do it

- **Alchemy hands the platform class in.** Its bridges take the base class as an argument:
  `makeWorkerBridge(Base, { stack, entrypoint })` (`@alchemy.run/cloudflare` 2.0.0-beta.85,
  `src/Workers/WorkerBridge.ts:64`) and `makeDurableObjectBridge` (`src/Workers/DurableObjectBridge.ts:37`).
  Only the Worker entry it generates imports the module:
  `import { env, DurableObject, WorkerEntrypoint } from "cloudflare:workers"` and
  `export default makeWorkerBridge(WorkerEntrypoint, meta)` (`src/Workers/Sources/Rolldown.ts:434`
  to `:448`). Our `brain.ts:19` and `:330` already do the same for `IsolateTail`.
- **Alchemy loads the platform module lazily, with a stub off the platform.**
  `src/Workers/cloudflare_workers.ts` starts `import("cloudflare:workers")` and, outside workerd
  ("deploy/plan in Node, vitest", its comment says), answers a stub of `env`, `DurableObject` and
  `WorkflowEntrypoint`. So `objects.ts`, which builds on `@alchemy.run/cloudflare/Workers/DurableObject`,
  loads in a Node law with no mock. That loader is not exported (its package manifest has no
  `./Workers/cloudflare_workers` entry, and `./Workers/internal/*` is `null`), and its stub has no
  `WorkerEntrypoint`. This plan does not need it, so it is not patched.
- **Alchemy's test seams are services.** A resource's provider is an Effect service keyed by the
  resource's type, built with `Provider.effect` or `Provider.succeed` (`alchemy` 2.0.0-beta.85,
  `src/Provider.ts:470` and `:515`). State is the `State` service, and `inMemoryState()`
  (`src/State/InMemoryState.ts:12`) is an in-memory one. The local runtime is the `Runtime` service
  (`@alchemy.run/cloudflare-runtime` 2.0.0-beta.85, `src/core/Runtime.ts:40`) over the `Workerd`
  service (`src/core/workerd/Workerd.ts:70`), and the package's own tests build a local runtime from
  those layers (`src/core/test/helpers/runtime.ts:51`, `makeLocalRuntimeLayer`, not exported).
  `RuntimeLifecycle` (`src/core/Runtime.ts:35`) is a `Context.Reference` with a default, the shape
  `StackLayers` copies; it exists only in our patch (alchemy issue 3184).
- **Cloudflare's own way** is to run tests inside workerd with `@cloudflare/vitest-pool-workers`.
  0042 rules out a direct Cloudflare tool, and Alchemy's local runtime is our way to a real worker.
  Not fetched; from memory.
- **Elm and OTP.** Elm has no globals: what a module needs is handed in at `init`. An OTP behavior
  module gets its runtime from the process that starts it. Handing the base class in is the same
  move: the library does not reach for the platform, the entry gives it.

No gap in Alchemy blocks this plan, so nothing is patched and no upstream issue is owed. Two gaps
were found by reading and are noted, not reported, as 0042's 2026-11-09 amendment asks of gaps
found by reading: the platform loader is not exported and its stub lacks `WorkerEntrypoint`, and
the local test runtime layer is not exported.

## The hits, recounted on main

Counted on `origin/main` at `b510ed2` with `git grep -n -E 'vi\.(mock|doMock)\('` over the three
folders, then the import lines of each file read by hand. The sweep plans counted at `0683861`; the
only change since is PR 1366's new `runtime-quotas.laws.test.ts`.

| Folder | Hit | Stands in for | What reaches it | Replaced by |
|---|---|---|---|---|
| cloudflare | `connection.test.ts:35` | the platform module, `{ WorkerEntrypoint }` | nothing | deleted, nothing reaches the module |
| cloudflare | `error-cause.test.ts:26` | the platform module, `{ WorkerEntrypoint }` | `./box.ts` (`:18`) | `programBox(Stub.Base, ...)` |
| cloudflare | `leave.laws.test.ts:29` | the platform module, `{ WorkerEntrypoint, DurableObject }` | nothing | deleted |
| cloudflare | `reload.laws.test.ts:55` | the platform module, `{ WorkerEntrypoint, DurableObject }` | nothing | deleted |
| cloudflare | `runner-reply.laws.test.ts:23` | the platform module, `{ WorkerEntrypoint }` | `./box.ts` (`:19`) | `programBox(Stub.Base, ...)` |
| cloudflare | `supervision.laws.integration.test.ts:21` | the platform module, `{ WorkerEntrypoint }` | `./box.ts` (`:18`) | `programBox(Stub.Base, ...)` |
| cloudflare | `ProjectAuditTest.ts:22` | the platform module, `{ WorkerEntrypoint }` | `./box.ts` (`:18`) | `programBox(Stub.Base, ...)` |
| node/dev | `supervision-spans.integration.test.ts:34` | the platform module, `{ WorkerEntrypoint }` | `../../cloudflare/box.ts` (`:9`) | `programBox(Stub.Base, ...)` |
| app src | `checklist-instance.laws.integration.test.ts:56` | the platform module, `{ WorkerEntrypoint }` | `@kampus/libfabrika/box` (`:23`) | `programBox(Stub.Base, ...)` |
| app src | `door.integration.test.ts:256` | the platform module, `{ WorkerEntrypoint }` | nothing | deleted |
| app src | `runtime-quotas.laws.test.ts:47` | the platform module, `{ WorkerEntrypoint }` | `@kampus/libfabrika/box` (`:14`) | `programBox(Stub.Base, ...)` |
| app src | `runtime-recovery.laws.integration.test.ts:47` | the platform module, `{ WorkerEntrypoint }` | `@kampus/libfabrika/box` (`:13`) | `programBox(Stub.Base, ...)` |
| app src | `local-instance.integration.test.ts:23` | our `stack`, made to hand back the `local` context | `./instance.ts` | the real `stack`, given `StackLayers.test(...)` |
| app src | `local-instance.integration.test.ts:27` | Alchemy's `deploy`: reports pid 27001 and starts the control plugin on 27002 | `./instance.ts:7` | the real `deploy`; the test Worker provider reports the pid and starts the plugin |
| app src | `instance-one-file.integration.test.ts:328` | `@alchemy.run/cloudflare`: `providers`, `R2.Bucket`, `DurableObject`, `WorkerLoader`, `Workers.Worker` (records its props) | `../alchemy.run.ts`, imported after `vi.resetModules()` | the real constructors; the test Worker provider records the props it is asked to create |
| app src | `instance-one-file.integration.test.ts:340` | `alchemy`: `localState` and `Stack` (made to run its body) | `../alchemy.run.ts` | the real `Stack` over `inMemoryState()` |
| app src | `instance-one-file.integration.test.ts:441` (amendment 2026-11-16) | `vi.spyOn`, not a mock: the Worker Loader isolate stub's generic `getEntrypoint`, in law A5 | `workerLoader`'s raw platform `WorkerLoader` (`cloudflare/index.ts:89`) | slice 4: a test layer of `Isolates`, recorded with `Recorder` |

Twelve `cloudflare:workers` mocks (7, 1 and 4 by folder; the brief's 3 for the app is 4 since PR
1366) and four Alchemy mocks: sixteen hits, plus A5's one spy, moved here on 2026-11-16 (slice 4). Every `cloudflare:workers` mock goes by one product
change, since after slice 1 no Node law in the three folders loads a module that imports the
platform. The four that reach nothing go in the same slice.

## The shape

### Slice 1: `programBox` takes its base class

```ts
// next/packages/libfabrika/src/cloudflare/box.ts, a sketch. The import line goes.
/** A class a program box can extend: the platform's `WorkerEntrypoint`, handed in by the entry. */
type EntrypointBase = new (ctx: never, env: never) => object;

export const programBox = (Base: EntrypointBase, declared: unknown, build: string) => {
  // ...as today
  return class ProgramBox extends Base {
    // ...the eleven RPC methods, unchanged, each still one marked Promise edge
  };
};
```

`EntrypointBase` is a structural type of our own, so `box.ts` names no platform type (0042). The
platform's class has a two-argument constructor, and a class with none (the laws' `Stub.Base`) fits
it too. It is not taken from `Parameters<typeof makeWorkerBridge>[0]`, which is a union with
`typeof DurableObject` that a class cannot extend and that `Stub.Base` does not fit. Call, 75%; the
build reads what `tsc` says and keeps the narrowest type that compiles.

```ts
// next/packages/libfabrika/src/node/build/bundle.ts:192, a sketch of the generated entry.
// edge: the program isolate's entry hands workerd's own WorkerEntrypoint to programBox, as Alchemy's generated entry does (Sources/Rolldown.ts:448); ProgramBox gap, not reported, 0042 amendment 2026-11-09
const code = `import {WorkerEntrypoint} from "cloudflare:workers"; import {programBox} from "@kampus/libfabrika/box"; import {${entry.name} as program} from ${JSON.stringify(entry.module)}; export default programBox(WorkerEntrypoint, program, ${JSON.stringify(name)});`;
```

`cloudflare:workers` is already external in that bundle (`bundle.ts:138` and `:141`), so the
output keeps the import for workerd to answer, as it does today through `box.ts`.

```ts
// next/packages/vitest/src/Stub.ts, a sketch of the one new export.
/**
 * An empty base class that stands in for a platform entrypoint class, such as the one a program box
 * extends. It has no members, so a box that starts reading `this.ctx` or `this.env` reads undefined
 * in a law, and the law that needs them gives them.
 *
 * @stability unstable
 * @category constructors
 */
export class Base {}
```

It lives in the test package because 0557 puts every fake of a Cloudflare object there. It stays a
class, not `Stub.make`, because `extends` needs a constructor.

### Slice 2: the stack takes its providers and its state

```ts
// next/apps/fabrika/alchemy.run.ts, a sketch.
/** What the stack is built on: Alchemy's providers and its state layer. A law hands in Alchemy's test ones. */
export const StackLayers = Context.Reference<{
  readonly providers: Layer.Layer<unknown, never, never>; // the build reads the real types off Cloudflare.providers()
  readonly state: Layer.Layer<State, never, never>;
}>("fabrika/StackLayers", {
  defaultValue: () => ({ providers: Cloudflare.providers(), state: Alchemy.localState() }),
});

export const stack = (built, checked, local = Context.empty(), layers = StackLayers.defaultValue()) =>
  Alchemy.Stack("fabrika", {
    providers: layers.providers.pipe(Layer.provide(Layer.succeedContext(local))),
    state: layers.state,
  }, /* the body, unchanged */);

// next/apps/fabrika/src/instance.ts, startDev: the one live caller reads the reference.
const layers = yield* StackLayers;
return deploy({ stack: stack(built, checked, local, layers), stage: "local", dev: true, scope }).pipe(
  Effect.provide(layers.state), // in place of Effect.provide(localState())
  Effect.provide(engine),
);
```

```ts
// next/apps/fabrika/src/stack.test-support.ts, a sketch. Alchemy's own test seams, no module mock.
// The Worker provider does what the deploy mock did: report the pid through RuntimeLifecycle and
// start the control plugin it finds in the context the stack hands its providers.
export const worker = (seen: Recorded) =>
  Provider.effect(Cloudflare.Workers.Worker, Effect.gen(function* () {
    const observe = yield* RuntimeLifecycle;
    return {
      reconcile: ({ props }) => Effect.gen(function* () {
        yield* seen.add(props);
        observe({ type: "start", worker: props.name, pid: 27001 });
        yield* startControl({ "fabrika-control": 27002 }); // the plugin, read from the context
        return { url: "http://test.invalid" };
      }),
      delete: () => Effect.void,
    };
  }));
export const bucket = Provider.succeed(Cloudflare.R2.Bucket, { reconcile: () => Effect.succeed({ name: "test" }), delete: () => Effect.void });
export const layers = (seen: Recorded) => ({ providers: Layer.mergeAll(worker(seen), bucket), state: inMemoryState() });
```

The member names (`reconcile`, `delete`) and how the plugin is read from the context are as read
in `src/Provider.ts`, not compiled; the tests step reads `ProviderServiceInput` (`src/Provider.ts:426`)
and the control plugin's own module first. The recorded props are read with `Recorder` where
`Provider(type)` fits it (0579), else a `Ref` the law owns. Call, 75%.

**Is this a setting (0069)?** No. `StackLayers` picks no value a person running fabrika chooses:
it is the code's seam to Alchemy, as `RuntimeLifecycle` is Alchemy's own. `Stub.Base` and
`EntrypointBase` are types and test tooling.

**Where it lives (`next/AGENTS.md`).** `box.ts` and `bundle.ts` stay in libfabrika: any client
that runs programs on Worker Loader needs them. `StackLayers` and the test providers stay in the
app, since the stack is the app's own deployment.

### Slice 4: A5's `getEntrypoint` spy goes, and the loader goes through Alchemy

Amendment 2026-11-16: moved here from the app-src plan's slice 1 with the lead's yes, which the
sweep's coordinator relayed. It is a slice like the others, and the app-src plan drops the row.

The hit is `next/apps/fabrika/src/instance-one-file.integration.test.ts:441`:
`vi.spyOn(stub, "getEntrypoint").mockReturnValue(rpc)`. It sits in law A5, "p33 loader: actual
config uses recorded bytes/hash and exact process, empty env, null outbound; unknown is typed
no_program", at `:421`. It spies on the Worker Loader's isolate stub. It does not mock a module.

**Why a plain stand-in does not type.** `workerLoader` (`next/packages/libfabrika/src/cloudflare/index.ts:89`)
takes the platform's raw ambient `WorkerLoader` (`index.ts:63` to `:71`), and its code calls
`worker.getEntrypoint<Calls>()` (`:132`). There, `getEntrypoint` is generic over
`Rpc.WorkerEntrypointBranded | undefined`. So a plain stand-in fails with TS2322, a one-overload
form fails with TS2589, and a cast is not allowed. These failures were reported by the sweep's
session, not run here. `next/` declares `@cloudflare/workers-types` 5.20261027.1. The lockfile
also holds 5.20261109.1, and the build reads which one each package resolves. That raw type goes
around Alchemy, which 0042's table already lists ("`WorkerLoader`, `loader.get`,
`getEntrypoint`": Alchemy's `Cloudflare.WorkerLoader` service). So, by 0042, the first fix sends
the code through Alchemy.

**What Alchemy offers.** `@alchemy.run/cloudflare` 2.0.0-beta.85, `src/Workers/WorkerLoader.ts:33`
to `:44`. Its `get(name, getCode)` answers `Effect<WorkerStub>`. Its
`WorkerStub.getEntrypoint<Shape = unknown>(name?)` answers `Fetcher & Shape`. That is still
generic, so a law that stubs Alchemy's stub meets the same typing problem. The generic must stay
in the live layer and out of the law.

```ts
// next/packages/libfabrika/src/cloudflare/Isolates.ts, a sketch: the contract only (0095).
/** One program isolate's RPC, the calls a brain makes on it. Monomorphic: no type parameter. */
export class Isolates extends Context.Service<Isolates, {
  readonly open: (key: string, code: () => IsolateCode) => Effect.Effect<IsolateCalls, ProgramDown>;
}>()("libfabrika/Isolates") {}

// next/packages/libfabrika/src/cloudflare/IsolatesAlchemy.ts: the live layer, the one place the
// generic is named, on Alchemy's service. Here the Shape is ours, so it needs no cast.
export const layer = (loader: Cloudflare.WorkerLoader) => Layer.succeed(Isolates, {
  open: (key, code) => loader.get(key, code).pipe(Effect.map((stub) => stub.getEntrypoint<IsolateCalls>())),
});

// the law: a test layer of the monomorphic contract, recorded with Recorder (0579). No spy, no cast.
const isolates = Recorder.layer(Isolates, { open: (_key, _code) => Effect.succeed(rpc) });
// `rpc` is a plain IsolateCalls value; Recorder.calls(Isolates, "open") gives [key, config] per call.
```

`workerLoader` then asks for `Isolates` in place of taking `Loader`. Its callers,
`runtime.ts:984` and `:2289` and `control.ts:69`, provide `IsolatesAlchemy.layer` over Alchemy's
`Cloudflare.WorkerLoader` for `env.LOADER`. Call, 70%. The doubt is whether Alchemy's
`WorkerLoader` can be built from the brain's `env.LOADER` today, before 0042's port moves the
brain onto Alchemy's Worker. If not, the live layer wraps the raw binding at that one edge with its
marked line, and the law is unchanged.

**What else it touches.** Five other test files call `workerLoader` with a hand-made platform
object: `cloudflare/index.test.ts:18`, `cloudflare/tail.test.ts:148`,
`cloudflare/error-cause.test.ts:143` and `:162`, and `node/IsolateUsage.integration.test.ts:214`.
Each moves to a test layer of `Isolates` in the same slice. They are not `vi` hits, so no other
plan counts them. With them moved, `index.ts` names no raw platform type.

## One value traced: the counter program on the real runtime, after slice 1

1. `bundlePrograms` writes the entry for `counter`:
   `import {WorkerEntrypoint} from "cloudflare:workers"; ... export default programBox(WorkerEntrypoint, program, "counter");`
2. Rolldown bundles it with `cloudflare:workers` external. The output still has one import of the
   platform module, now in the entry, not in `box.ts`'s code.
3. workerd loads the isolate through Worker Loader and answers the import with its own class.
   `programBox` returns `class ProgramBox extends WorkerEntrypoint`, the same class as before.
4. The brain calls `describe()` over RPC. It works only because the default export extends the
   platform's class; that is what the real-runtime law C3 sees.
5. In a Node law, `runner-reply.laws.test.ts` calls `programBox(Stub.Base, program, BUILD)`. Nothing
   it loads imports the platform module, so it has no `vi.mock`, and its laws run as today.

## Laws

| Law | Kind | Generator | What it holds | Plant | Where |
|---|---|---|---|---|---|
| C1. A program box extends the base it is handed and answers `describe`, `init` and `step` the same as before, for any program the generator makes; 6 runs fast, 20 full | test | fc.record: a program name, a state version and a list of cmd types, as `runner-reply.laws.test.ts`'s generator makes them, 6 runs fast and 20 runs full | `Object.getPrototypeOf(Box.prototype)` is the handed base's prototype, and the three answers equal the ones the law computes from the program | (a) `box.ts` goes back to `import { WorkerEntrypoint } from "cloudflare:workers"` and extends it: the file fails to load in Node, red; (b) `programBox` extends a fresh `class {}` of its own: the prototype check is red | next/packages/libfabrika/src/cloudflare/box.test.ts |
| C2. The generated program entry hands the platform's own `WorkerEntrypoint` to `programBox` | test | scenario: the one counter program build-one-file already bundles, its linked `cloudflare:workers` class as the platform's | the default export's prototype chain reaches the linked class; the existing checks of the run are kept | the generated line hands `class {}` in place of `WorkerEntrypoint`: red | next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts |
| C3. On the real runtime, a copied file loads programs and they answer over Worker Loader RPC, as today | test | scenario: the existing "p33 complete output and T10 recovery" law, unchanged | the default export of each program isolate is a real `WorkerEntrypoint`: a box that is not one fails every RPC call | the generated line hands `class {}`: the law's first program call fails, red | next/apps/fabrika/src/instance-one-file.integration.test.ts |
| C4. Every law of the twelve files keeps its checks with the `vi.mock("cloudflare:workers")` line gone; the eight that call `programBox` hand it `Stub.Base` | test | scenario: each file's own laws, unchanged, at their own run counts | each file loads and passes as it did with the mock | none of its own: C1's plant (a) is what reddens all eight at once | next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts |
| S1. The stack hands Alchemy the completed brain file, no second bundle, and an env with no code that is under 5 KB per setting; a setting at or over 5 KB is refused before any deploy, on the real `Stack` over `inMemoryState()` and the test providers | test | fc.integer: the founder name's length, 1600 to 1800, with fc.boolean for a multibyte name, as today, 3 runs | the props the test Worker provider was asked to create: `main` is the built brain, `bundle` is false, each env value is a binding or a text under the limit and holds no program source | (a) `bundle: true` in `alchemy.run.ts`: red; (b) the program source added to `env`: red; (c) `stack` reads `Cloudflare.providers()` past `layers`: the law reaches a real provider and fails | next/apps/fabrika/src/instance-one-file.integration.test.ts |
| S2. `startDev` deploys through Alchemy's real `deploy`, and its laws (the quota start, the outbox link, the two runs on one home) hold as today, with the pid and the control port coming from the test Worker provider | test | scenario: the three existing laws of the file, unchanged, at their own run counts | the start event with pid 27001 reaches `startDev`'s lifecycle queue, and the control plugin starts on 27002 | `startDev` reads `StackLayers.defaultValue()` past the reference: the law reaches the real local runtime and fails on `unused.mjs`, red | next/apps/fabrika/src/local-instance.integration.test.ts |
| W1 (slice 4). Law A5 keeps every check with no spy: the loader is asked for `<hash>/<process>` by the whole qualified name, with the recorded bytes and hash, an empty env and a null outbound, and an unknown name fails typed `no_program`; `Isolates.open` is recorded through `Recorder`, and no cast or spy is in the file | test | fc.string: the source, with fc.uuid for the process and fc.string for the missing name, as today, 3 runs | the recorded `open` calls and the typed failure, with the law typed by the monomorphic `Isolates` contract, so no generic reaches the law | (a) `workerLoader` answers the bare short name: the `no_program` check is red; (b) `workerLoader` loads with `env: { CODE: source }`: the recorded config check is red; (c) `workerLoader` calls `open` twice for one load: `Recorder.calls` has two entries, red | next/apps/fabrika/src/instance-one-file.integration.test.ts |
| M11 (cloudflare), M1 (node/dev), A6 and A8 (app src). Each folder's `vi` lock, as its own plan writes it, lands whole the day the folder is at zero | lint | lint | the five-method block of `vitest/no-restricted-vi-methods` for the folder's glob, with node's `VI_METHODS` plants run in its paths (node's M1, ruling 2 of 2026-11-15); A8: `pnpm lint` passes with the lock an error and no disable line names it | each plan's own plant: drop `mock` from the block and the planted `vi.mock("x")` line in the folder is taken, red; put back one `vi.mock("cloudflare:workers")` and `pnpm lint` exits 1 | oxlint-plugins/plants.test.ts |

- **Lint, type or test?** C1 to C4, S1 and S2 are tests: they hold what code does. The locks are
  lint. That `box.ts` names no platform module is held by C1's plant (a) for now; a lint rule for it
  is ticket 506's (0042), and this plan does not take it.
- **What the mocks checked, kept.** A `cloudflare:workers` mock checked nothing: it let `box.ts` load
  in Node. What it relied on, that the box reads nothing from its base, is now C1's. What it hid,
  that the real entry extends the real class, is C2 and C3. The Alchemy mocks checked the props the
  stack hands Cloudflare (S1) and that `startDev` copes with a deploy that starts a worker and its
  plugin (S2); both keep every check they had.
- **Host-only and real-resource laws.** None is host-only (0178): nothing here needs launchd, the
  real Electron app or the owner's Mac. C2, C3, S1 and S2 are in `.integration.` files that exist
  today; their files keep the name. C3 needs a real worker, so it runs on Alchemy's local runtime
  in a cloud box, which the guard allows since PR 1508. S1 and S2 use no real resource after this
  plan, but their files hold other real-resource laws, so they stay `.integration.` (0536, 0581).
  No new `.integration.` law is added.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/cloudflare/box.ts | build | 6 | slice 1: the platform import goes; `programBox` takes `Base`; `EntrypointBase` |
| next/packages/libfabrika/src/node/build/bundle.ts | build | 3 | slice 1: the generated entry imports `WorkerEntrypoint` and hands it in, under its edge line |
| next/packages/vitest/src/Stub.ts | build | 10 | slice 1: `Base`, with its doc block |
| next/packages/libfabrika/src/cloudflare/box.test.ts | tests | tests | slice 1: new, C1 |
| next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts | tests | tests | slice 1: C2 |
| next/packages/libfabrika/src/cloudflare/connection.test.ts | tests | tests | slice 1: the mock line goes (C4) |
| next/packages/libfabrika/src/cloudflare/error-cause.test.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)`; slice 4: its two `workerLoader` calls (`:143`, `:162`) get a test layer of `Isolates` |
| next/packages/libfabrika/src/cloudflare/leave.laws.test.ts | tests | tests | slice 1: the mock line goes |
| next/packages/libfabrika/src/cloudflare/reload.laws.test.ts | tests | tests | slice 1: the mock line goes |
| next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)` |
| next/packages/libfabrika/src/cloudflare/supervision.laws.integration.test.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)` |
| next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)` |
| next/packages/libfabrika/src/node/dev/supervision-spans.integration.test.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)` |
| next/apps/fabrika/src/checklist-instance.laws.integration.test.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)` |
| next/apps/fabrika/src/door.integration.test.ts | tests | tests | slice 1: the mock line goes |
| next/apps/fabrika/src/runtime-quotas.laws.test.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)` |
| next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts | tests | tests | slice 1: the mock line goes; `programBox(Stub.Base, ...)` |
| next/apps/fabrika/alchemy.run.ts | build | 14 | slice 2: `StackLayers`; `stack` takes `layers` |
| next/apps/fabrika/src/instance.ts | build | 3 | slice 2: `startDev` reads `StackLayers` and provides its state |
| next/apps/fabrika/src/stack.test-support.ts | tests | tests | slice 2: new, the test Worker and bucket providers and `layers` |
| next/apps/fabrika/src/instance-one-file.integration.test.ts | tests | tests | slice 2: the two `vi.doMock` calls and `vi.resetModules()` go; S1 on the real `Stack`; C3 read, not changed; slice 4: A5's spy goes, W1 |
| next/apps/fabrika/src/local-instance.integration.test.ts | tests | tests | slice 2: the two `vi.mock` calls go; S2 provides `StackLayers` |
| next/packages/libfabrika/src/cloudflare/Isolates.ts | build | 12 | slice 4: new, the `Isolates` contract, `IsolateCode` and `IsolateCalls` |
| next/packages/libfabrika/src/cloudflare/IsolatesAlchemy.ts | build | 10 | slice 4: new, the live layer over Alchemy's `Cloudflare.WorkerLoader` |
| next/packages/libfabrika/src/cloudflare/index.ts | build | 12 | slice 4: `workerLoader` asks for `Isolates`; the raw `Loader` and `Code` types go |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 6 | slice 4: the two loaders get `IsolatesAlchemy.layer` |
| next/packages/libfabrika/src/cloudflare/control.ts | build | 3 | slice 4: the same |
| next/packages/libfabrika/src/cloudflare/index.test.ts | tests | tests | slice 4: a test layer of `Isolates` |
| next/packages/libfabrika/src/cloudflare/tail.test.ts | tests | tests | slice 4: the same |
| next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts | tests | tests | slice 4: the same |
| .oxlintrc.json | tests | tests | slice 3: each folder's five-method block, as its plan writes it, once the folder is at zero |
| oxlint-plugins/plants.test.ts | tests | tests | slice 3: each block's paths join node's `VI_METHODS` scenario |
| oxlint-plugins/builtin-plants.ts | tests | tests | slice 3: only if a block adds a plant line node's set lacks |

## Existing tools

- `programBox`'s `Base` argument: searched Alchemy beta.85's `src/Workers/` for a way to define a
  named entrypoint class (0042 found none on beta.84, and none is in beta.85 either); found
  `makeWorkerBridge(Base, meta)`, whose shape this copies. `makeWorkerBridge` itself does not fit:
  it needs an Alchemy stack's meta and an Effect Worker, and a Worker Loader isolate is neither.
- `Stub.Base` in `next/packages/vitest/src/Stub.ts`: searched `next/packages/vitest/src` (only
  `Stub.make`, which makes objects, not classes) and Alchemy's exports for a Node stand-in of
  `WorkerEntrypoint` (its loader stub in `src/Workers/cloudflare_workers.ts` has none and is not
  exported). No package on npm was taken: an empty class is not worth a dependency.
- `StackLayers` in `next/apps/fabrika/alchemy.run.ts`: searched Alchemy for a way to swap a
  stack's providers and state from outside; found `Provider.effect`, `Provider.succeed` and
  `inMemoryState()`, which it uses, and Effect's `Context.Reference` with `defaultValue`
  (effect 4.1.3, `src/Context.ts:497`), which it is.
- The test providers in `next/apps/fabrika/src/stack.test-support.ts`: searched `alchemy` and
  `@alchemy.run/cloudflare` for test providers to reuse; the packages ship none, and their own tests
  are not in the package (`src/core/test/` in the runtime package has runtime helpers only).

- `next/packages/libfabrika/src/cloudflare/Isolates.ts` (slice 4), searched with its
  live layer `next/packages/libfabrika/src/cloudflare/IsolatesAlchemy.ts`: searched Alchemy's `src/Workers/WorkerLoader.ts`, whose service it wraps,
  and found no monomorphic form. Its `getEntrypoint` is generic, and a law cannot stand it in
  without a cast. Effect's `Layer.mock` and our `Recorder.layer` give the law's side.

## Order

The mock sweep folds its slices into one branch, `fabrikalfa/mock-fold`, and its one pull request
(not opened on origin as of this plan). This plan's slices land there too, after the slices they
share files with, so no folder's lock lands with a gap:

1. **After** the cloudflare plan's slices 1 and 2, the node-dev slice and the app-src slices 1 to 5
   are folded: they change `error-cause.test.ts`, `runner-reply.laws.test.ts`,
   `runtime-recovery.laws.integration.test.ts`, `local-instance.integration.test.ts` and
   `instance-one-file.integration.test.ts` too. This plan's slice branches start from the fold
   branch's head at that point.
2. **Slice 1** (`programBox` takes its base): tests, build, review. It touches six of the app's
   files and every `cloudflare:workers` hit.
3. **Slice 2** (the stack takes its layers): tests, build, review.
4. **Slice 4** (the loader goes through Alchemy): tests, build, review. It may run beside slice 2:
   they share only `instance-one-file.integration.test.ts`, in different laws, so the second to fold
   merges the first.
5. **Slice 3** (the locks): the tests step writes each folder's lock block, as its own plan has it,
   the day its folder is at zero, and runs the plants; a review reads it. The cloudflare folder and
   node/dev are at zero after slice 1 and their own sweep slices. The app folder is at zero only
   after slices 2 and 4 and the two PR 1366 hits the finding below hands to app-src slice 5. No block lands
   for a folder that is not at zero, and no block lists files (0524).

PR 1366 merged on 2026-11-16, so nothing here waits on it.

## Calls taken

- `programBox` takes the base class, and the generated entry hands it in, 85%: it is Alchemy's own
  shape, and 0042 lets ProgramBox's gap stay as a marked edge. The doubt: a reader of 0042 might
  count the generated line as a new direct import. It is the same import `box.ts` has today, moved
  to the entry, which is where Alchemy's own generator puts it.
- The four dead mocks are deleted in slice 1 with no other change, 90%.
- Slice 4's `Isolates` service has a member with no type parameter, and only its live layer names the
  generic `getEntrypoint`, 80%: that is how a law types its stand-in with no cast. Its doubt is in
  "Doubts".
- Slice 2 uses Alchemy's real `Stack` and `deploy` over test providers, not a `Deploy` service of
  our own, 65% (see "Doubts"). The fallback, if the tests step finds `deploy` cannot run there, is
  `Plan.make` over `inMemoryState()` for S1 (`alchemy` `src/Plan.ts:368`) and a report for S2.

## Validation

The tests and build steps run, under `nice -n 15 pnpm exec vitest run --maxWorkers=3`, the narrow
paths of every test file in the table, the `.integration.` laws among them (C2, C3, S1, S2, which
the guard allows in a cloud box since PR 1508), and `pnpm lint` with
`NODE_OPTIONS=--max-old-space-size=6144`. The lead runs the wider pass and the one type check.

## Size

1. Slice 1, `programBox` takes its base: 6 product lines in `box.ts`, 3 in `bundle.ts` and 10 in
   `Stub.ts`; one new law file, one changed law, twelve mock lines gone and eight call sites
   changed, about 120 test lines. 19 lines.
2. Slice 2, the stack takes its layers: 14 product lines in `alchemy.run.ts` and 3 in `instance.ts`;
   one new test-support file, about 60 lines, and two law files rewritten around Alchemy, about 90
   test lines changed. 17 lines.
3. Slice 3, the three folders' locks: tests and lint only, about 40 lines of `.oxlintrc.json` and
   plant rows. 0 lines.
4. Slice 4, the loader goes through Alchemy (A5's spy): 43 product lines in two new files and three
   changed ones, and about 80 test lines in five law files. 43 lines.

Confidence in the line counts: 70%. The doubt is slice 2: how much of the two Alchemy laws'
setup (the engine layers `instance.ts` provides) the real `deploy` asks of a law.

Priced from `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the sweep plans priced
them: slice 1's tests $6, build $3, review $3; slice 2's tests $8, build $4, review $3; slice 3's
tests $3 and review $2; slice 4's tests $5, build $3, review $3; one likely send-back, in slice 2, $4.

Estimate: 12 steps, $47

## Records

- A one-line amendment to 0042, by the lead: ProgramBox's `cloudflare:workers` import moved from
  `box.ts` to the generated program entry, which hands the class to `programBox`; the gap stays.
- The finding `2026-11-15-cloudflare-workers-mocks-have-no-slice` is marked resolved by this plan,
  with its pull request, when slice 1 lands.
- A glossary row for `StackLayers`, in slice 2's build.

## What this cannot tell us

- Whether any block here compiles. None was compiled or run: `EntrypointBase`, the
  `Provider.effect` members and `StackLayers`'s layer types are as read in beta.85's source and
  effect 4.1.3's.
- Whether the four mocks this plan calls dead are dead. Read from import lines; the tests step
  sees it the first time it runs each file without the line.
- Whether Alchemy's real `deploy` runs in a Node law without its engine layers, and what a test
  provider must answer beyond `reconcile` and `delete`.
- Whether a later Alchemy release exports its platform loader or adds a named entrypoint form. Its
  main branch was not read; a bump re-reads `src/Workers/`.

## Open questions

None.

Each choice here only picks how code does what 0042 and 0555 already say: the platform
through Alchemy's own shape, a stand-in from the code's design, and each lock whole at zero.

## Findings

```json
{"_tag": "finding", "id": "2026-11-16-runtime-quotas-mocks-not-in-app-sweep", "date": "2026-11-16", "by": "plan", "model": null, "rule": "rule_break", "location": {"path": "next/apps/fabrika/src/runtime-quotas.laws.test.ts", "line": 45}, "says": "In next/, runtime-quotas.laws.test.ts, added by PR 1366 after the app-src mock plan counted the folder, calls vi.mock(\"./table.ts\") at :45 and vi.mock(\"virtual:fabrika-built\") at :48, which 0555 bans; the app-src plan's slice 5 fixes that kind of hit but does not list these two, so the app folder cannot reach zero and its lock (A6, A8) cannot land.", "proof": "git grep -o -E 'vi\\.mock\\(' over next/apps/fabrika/src: 25 at 0683861, 28 at origin/main b510ed2; the three new ones are runtime-quotas.laws.test.ts:45, :47 and :48, and :47 is the cloudflare:workers mock the alchemy-mocks plan takes.", "cost": "The app folder keeps no vi lock after the sweep until these two go, so a new vi.fn or vi.spyOn can land there.", "head": "b510ed2", "ticket": null, "pr": null}
```

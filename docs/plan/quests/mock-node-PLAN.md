Approved by the lead agent, builds 0555, 0557, 0579, 0554, 0573, 0523; body 882bc2bf5d8c
Plancheck-Version: 3

# Plan: the mock sweep in `libfabrika/src/node`, the `RunnerAdmission` law, in next/ (ticket 1067)

This is `next/` and our lint tooling. Today's app is not touched. It is one later slice of the
recorder plan ([`recorder-PLAN.md`](./recorder-PLAN.md), "Size", the row for
`libfabrika/src/node`): 4 `vi.fn` calls, 0 `toHaveBeenCalled*`, 0 `vi.spyOn`, all platform
namespace doubles, so platform fakes and not the Recorder. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md),
[0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md),
[0579](../../../.decisions/0579-property-laws-use-it-prop.md) and
[0554](../../../.decisions/0554-no-reflect-get-set-has.md), which puts the fakes of Cloudflare
objects in the test package. Not in this slice: `node/dev`, `node/client` and `node/repositories`,
which have their own plans.

```ts
// The whole idea, on next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts.
// A sketch, not compiled.
// before: vi.fn answers `any`, so none of these doubles is checked against Cloudflare's types
RECORD: namespace(vi.fn().mockReturnValue({ write: async () => Written.cases.written.make({}) })),
// after: the shared platform stub, typed by the binding it stands in for
RECORD: Stub.make<Env["RECORD"]>(unexpected, {
  getByName: () => Stub.make<ReturnType<Env["RECORD"]["getByName"]>>(unexpected, {
    write: async () => Written.cases.written.make({}),
  }),
}),
```

## Doubts, read these first

- **Amendment (2026-11-16, merge session ruling on node-s1's tests round 2): the contract file is
  `ObjectCalls.ts` (certain, it is the ruling).** The tests step's round 2
  ([`field/runs/2026-11-16-mock-node-tests2.json`](../../../field/runs/2026-11-16-mock-node-tests2.json),
  branch `fabrikalfa/mock-node-s1` at `4049b9a9d`) found that the name this plan gave the contract,
  `next/packages/libfabrika/src/cloudflare/Objects.ts`, differs only in letter case from the
  existing `next/packages/libfabrika/src/cloudflare/objects.ts` on main: libfabrika's `tsc` fails
  with TS1261, and a case-insensitive disk, as on a Mac, sees one file. **Wrong, kept as the
  record:** `Objects.ts`. Every place below that named it now says `ObjectCalls.ts`, and the laws
  import it as `../cloudflare/ObjectCalls.ts` (from `RunnerAdmission.integration.test.ts`) and
  `./ObjectCalls.ts` (from `ProjectAuditTest.ts`). The name, checked in one line: no question word
  (0081), and both words are the industry's, Cloudflare's Durable Object and the RPC call it takes
  (OTP's `gen_server:call`, as the services' own comment says; `records.ts find "object calls
  name"` found no settled name for this file, and no other file in `cloudflare/` on main clashes
  with it in any case).
- **Amendment (2026-11-16, merge session ruling on node-s1's tests round 2): two places where the
  tests step followed the code over the plan, for the signer.** Both are in `.oxlintrc.json`'s
  lock block for `next/packages/libfabrika/src/node/*.ts` on `fabrikalfa/mock-node-s1` at
  `4049b9a9d`, and the lock's sketch under "The shape" now says the same:
  - (a) The lock's `eslint/no-restricted-properties` is at `error`, not this plan's `warn`. Those
    files have no `JSON.parse` fire, and `lint.ts` fails a `warn` line with no fire left ("has no
    fire left in next/packages/libfabrika/src/node/*.ts"), so the rule blocks at zero there, as
    [0523](../../../.decisions/0523-advice-rules-block-where-clean.md) asks of a folder at zero.
  - (b) The block writes out `Data.TaggedError` and `JSON.parse` again, as the signing note asks,
    since an override replaces a rule's options. `Data.TaggedError` is on main but not on the slice
    branch's base `b510ed2`, so the fold with main keeps it.

- **Amendment (2026-11-16, merge session ruling on node-s1): this slice now has a product change
  (certain).** The tests step sent the plan back
  ([`field/runs/2026-11-15-mock-node-tests1.json`](../../../field/runs/2026-11-15-mock-node-tests1.json),
  branch `fabrikalfa/mock-node-s1` at `2d2f8bfb9`). The ruling: the Project's calls on its Process
  objects and the Record calls go through two typed Effect services, which the law provides with
  `Recorder.layer`, and `Stub.make` stays as it is. See "Amendment: `msg` and `write` through typed
  services" below. The doubts under it, read first:
  - **No law reads the record yet (75%).** The ruling names the Recorder, the way the transport
    plan watches `Routes`. Here the Recorder is the typed layer (`Layer.mock` with a record beside
    it), and no law in this slice reads `Recorder.calls`: the old law read no call, and a new read
    would need the shared audit walk to take one, which is a law this plan cannot prove true
    without a run (does a retried move reach `msg` a second time?). `Layer.mock` alone would type
    the same. What settles it: a later law that reads `Recorder.calls(ProcessObjects, "msg")`.
  - **Only the Project's calls move (80%).** `mail.ts`, `control.ts` and `tail.ts` still call
    `ProcessClient.make(processStub(...))` straight from the binding. They run in other objects and
    workers, no law of this slice drives them, and each moves when a law of its own needs it. So the
    process stub in the law keeps `usage`, which `tail.ts` calls.
  - **The name `projectLayerWithoutObjects` (75%).** It follows Effect's `layerWithoutDependencies`
    naming (from memory, not fetched); the builder checks the installed Effect for the suffix and
    takes Effect's if it differs.
- **This slice waits for pull request [1433](https://github.com/kamp-us/tea-fabrika/pull/1433)
  (certain).** `Stub.make` is slice 8 of the Reflect ban
  ([`reflect-ban-PLAN.md`](./reflect-ban-PLAN.md), "The shared stub, in the test package"). On
  main it does not exist yet: pull request 1433 has its laws (L6, `next/packages/vitest/src/Stub.test.ts`)
  and waits for its build. The tests step here starts only once 1433 has merged. It builds no stub
  of its own, since 0554 says a law calls the shared helper and does not write the fake by hand.
- **Whether every member types through `own` (70%).** `Stub.make<A>(rest, own?: Partial<A>)` types
  `own` against `A`. Cloudflare's RPC types wrap a binding's methods (`Rpc.Provider` in
  `@cloudflare/workers-types` 5.20261027.1), and `WorkerStub.getEntrypoint` is generic in its
  binding (`index.d.ts:4159`), so a plain `() => box` cannot be every `Fetcher<T>`. The lean: a
  member goes in `own` where it types. A member Cloudflare's types refuse in `own` is answered by
  name in `rest`, which `Stub.make` types as `(...args: ReadonlyArray<unknown>) => unknown`, and
  the law's comment says why. That is no looser than today: `vi.fn()` answers `any` for every one of
  these members. What settles it: the tests step's typecheck of the file (one `effect-tsgo
  diagnostics` on `next/packages/libfabrika/tsconfig.json`). No cast is written in the law, and
  `Stub.make` holds its one cast inside (1433). **Wrong, kept as the record (amendment
  2026-11-16):** main's `Stub.make` (`next/packages/vitest/src/Stub.ts:18`, from PR 1481) types
  `rest` as `(method: string) => A[keyof A]`, so a member Cloudflare's RPC types refuse in `own` is
  refused in `rest` too: the process stub's `msg` and the record stub's `write` failed libfabrika's
  tsc with TS2322 at `RunnerAdmission.integration.test.ts:134` and `:142`. And `effect-tsgo
  diagnostics` reports Effect's checks only, so it cannot settle a type law; libfabrika's own
  `tsc --noEmit -p .` does.
- **The law is an `.integration.` law (certain).** It runs on the schedule (0536), not on every pull
  request. The tests step may run it in its box, since the step rules allow an `.integration.` law
  its files reach; it takes up to 10 minutes.

## What changes, in one paragraph

In `RunnerAdmission.integration.test.ts`, the `environment` the project audit suite asks for
(`ProjectAuditTest.Harness["environment"]`, `next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts:48`)
is built from `Stub.make` in place of four `vi.fn` calls, and the file stops importing `vi`. No law
of the file changes: the same suites, seeds, run counts and coverage lists. Then oxlint's own rule
`vitest/no-restricted-vi-methods` goes on at error for the top folder's files,
`next/packages/libfabrika/src/node/*.ts`, refusing `vi.fn` and 0555's four methods, with a plant
law beside the Reflect ban's in `oxlint-plugins/builtin-plants.ts`. This is the first slice that
turns that rule on, so it adds the rule and its plant law; each later folder slice adds its own
block.

## How others do it

- **Cloudflare's own way** is `@cloudflare/vitest-pool-workers`, which runs a law inside workerd
  with real bindings from Miniflare (developers.cloudflare.com, "Write your first test"; from
  memory, not fetched). This law does not fit it: it drives the Project's composition in Node, on
  real SQLite files, with a scripted `msg` per process (`box.admit` decides). 0042 says Miniflare is
  reached through Alchemy, and the Node run is what the law is for. So the law keeps stand-ins.
- **A stub, in the industry's words.** Fowler's "Mocks Aren't Stubs" (read for the recorder plan,
  2026-11-15): a stub gives canned answers, a spy also records how it was called. None of the four
  `vi.fn` here is read for its calls: no `toHaveBeenCalled*`, no `.mock.calls` in the file or in
  `ProjectAuditTest.ts`. Each is a stub, so the replacement is a stub, not the Recorder.
- **Effect's way for a part of a service** is `Layer.mock`: members left out die with
  `UnimplementedError` when used. A Cloudflare binding is no Effect service, so the shared helper
  takes the same idea: `rest` answers every member not given, and here it throws, naming the member.
- **The lint rule.** oxlint 1.90.0, the installed version, ships `vitest/no-restricted-vi-methods`
  (`node_modules/oxlint/configuration_schema.json`, its options a map from method name to message).
  0555's sketch names it. 0573 says a trusted rule replaces ours where it catches the same, so no
  rule of our own is written.

## The shape

A sketch, not compiled. `Env` is `next/packages/libfabrika/src/cloudflare/runtime.ts:169`.

```ts
// next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts
import * as Stub from "@kampus/vitest/Stub"; // or `import { Stub } from "@kampus/vitest"`, as 1433 exports it
import type { Env } from "../cloudflare/runtime.ts";

/** Any member this law does not use throws, naming it, as a member left out of Layer.mock dies. */
const unexpected =
  (member: string) =>
  (): never => {
    throw new Error(`unused platform call: ${member}`);
  };

const environment: ProjectAuditTest.Harness["environment"] = (box, accept, usage, loaded) => ({
  PROJECT: Stub.make<Env["PROJECT"]>(unexpected),
  CONNECTION: Stub.make<Env["CONNECTION"]>(unexpected),
  LOADER: Stub.make<Env["LOADER"]>(unexpected, {
    get: (key, code) => {
      loaded(key, code());
      // getEntrypoint is generic in its binding, so it is answered by name (see the doubts).
      return Stub.make<ReturnType<Env["LOADER"]["get"]>>((member) =>
        member === "getEntrypoint" ? () => box : unexpected(member),
      );
    },
  }),
  PROCESS: Stub.make<Env["PROCESS"]>(unexpected, {
    getByName: (object) =>
      Stub.make<ReturnType<Env["PROCESS"]["getByName"]>>(unexpected, {
        configure: async () => undefined,
        usage: async (rows) => usage(object, rows),
        msg: async (input) => {
          const message = input.envelope.input;
          const stamped = Predicate.isObject(message) ? { ...message, parent: input.envelope.id } : message;
          if (!(await box.admit(stamped))) return Sent.cases.refused.make({ reason: "bad_msg" });
          const rev = accept();
          return Sent.cases.accepted.make({ rev, pos: rev });
        },
      }),
  }),
  RECORD: Stub.make<Env["RECORD"]>(unexpected, {
    getByName: () =>
      Stub.make<ReturnType<Env["RECORD"]["getByName"]>>(unexpected, {
        write: async () => Written.cases.written.make({}),
      }),
  }),
  MEASUREMENTS: Stub.make<Env["MEASUREMENTS"]>(unexpected),
});
```

```jsonc
// .oxlintrc.json, one new block in "overrides" (a sketch; the messages say what to do instead)
{
  "files": ["next/packages/libfabrika/src/node/*.ts"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "fn": "A stand-in for a platform object is Stub.make; a watched call is a Recorder (0557, 0579).",
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it with a Recorder (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
      }
    ]
  }
}
```

Each choice, decided in one line:

- **`Stub.make`, not the Recorder,** since nothing here reads a call (the recorder plan's row says
  so too). 90%.
- **`rest` throws, naming the member.** Today's `unused` throws `"unused platform call"`; the name is
  added so a failing run says which member. A law that leans on a member it did not give fails
  loudly, as `Layer.mock` does. 90%.
- **The stub types come from `Env`,** the product's own binding interface, so a renamed binding
  member fails the law's typecheck, which `vi.fn`'s `any` hid. 85%.
- **The lock's folder is `node/*.ts`, the top files only.** `node/**` cannot block yet: `node/build`
  has 7 `vi.doMock` and 4 `vi.stubEnv` (counted below), `node/dev` has 2 `vi.mock`, 15 `vi.spyOn`
  and 6 `vi.stubEnv`. A glob `*` does not cross a `/`, so the subfolders stay out until their
  slices. 85%.
- **All five methods in one block, `fn` included.** 0555 bans four. `vi.fn` is a `vi` mechanism
  `@kalfa/vitest` does not export (0557), and 0579 names the Recorder as what replaces it. The top
  folder is at zero for all five after this slice, so the block blocks at zero (0523's bar). 85%.
- **One block per folder, each with the same five messages.** oxlint takes the last matching
  override's options for a rule, so a later block for a subfolder must list all five again, not add
  one. The plant law below reads every block that sets the rule, so a block that drops a method is
  red. 80%.

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
// .oxlintrc.json, the lock as a pair (amendment 2026-11-16, lead ruling). A sketch; one block.
{
  "files": ["next/packages/libfabrika/src/node/*.ts"],
  "rules": {
    // Kept on as it is: the same members, with the same messages as below.
    "vitest/no-restricted-vi-methods": ["error", { /* fn, mock, doMock, spyOn, stubEnv */ }],
    "eslint/no-restricted-properties": [
      // Amendment (2026-11-16, merge session ruling on node-s1's tests round 2): `error`, as the code
      // has it. Wrong, kept as the record: `warn`. These files have no JSON.parse fire, and lint.ts
      // fails a warn line with no fire left, so the rule blocks at zero here (0523).
      "error",
      // Written out again, since an override replaces options (amendment, same ruling): the
      // `Data.TaggedError` entry, on main though not on the slice's base b510ed2, and `JSON.parse`.
      { "object": "Data", "property": "TaggedError", "message": "Use Schema.TaggedErrorClass (0573, the Effect checker's preferSchemaTaggedError)." },
      { "object": "JSON", "property": "parse", "message": "Decode with Effect Schema (Schema.fromJsonString or Schema.UnknownFromJsonString), not a bare JSON.parse (decision 0023)." },
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
  out the `JSON.parse` entry (`.oxlintrc.json` on main at `b490a3203`). On main `node/*.ts` takes the `warn` block that writes out `JSON.parse` alone, so the lock is one block, as the sketch shows. At `warn`, a `vi`
  fire still blocks: `pnpm lint` lets only a `JSON.parse` fire of this rule advise
  (0523, the advice map `pnpm lint` reads). **Wrong, kept as the record (amendment 2026-11-16,
  merge session ruling on node-s1's tests round 2):** the lock is at `error`, not `warn`, since
  `node/*.ts` has no `JSON.parse` fire and `lint.ts` fails a `warn` line with no fire left; and it
  writes out `Data.TaggedError` with `JSON.parse` (see the doubts). No file loses an entry, and no file gains one but the
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
- **M1 is still the sweep's one lock law:** it runs both plants, `VI_METHODS` and `VI_PROPERTIES`, in every path of every block, and every other mock plan's lock runs both. M2's plant, `getEntrypoint: vi.fn().mockReturnValue(box)`, is a chained call: the vitest rule alone takes it, and it is red through `eslint(no-restricted-properties)`.

## Amendment: `msg` and `write` through typed services

**Amendment (2026-11-16, merge session ruling on node-s1).** Option (b) of the send-back: the
Project stops reaching its Process objects and its Record calls through the raw binding, and asks
two typed Effect services for them. The law provides each with `Recorder.layer`, as the transport
plan's laws A1 to A5 provide `Routes` ([`mock-transport-PLAN.md`](./mock-transport-PLAN.md),
"`Routes`, a frame's route"; [the Recorder pattern](../../../.patterns/a-law-watches-calls-with-a-recorder.md)).
`next/packages/vitest/src/Stub.ts` does not change. The `Stub.make` sketch above stays for the four
plain bindings it types (`PROJECT`, `CONNECTION`, `LOADER`, `MEASUREMENTS`) and for the process
stub's `usage`; the `msg` and `write` members in it are replaced by this section.

**Why a product change, not test code.** The law hands `projectLayer` an `Env`, and the Project
wraps each binding itself: `ProcessClient.make(processStub(env, name, owner)).msg(incoming)`
(`next/packages/libfabrika/src/cloudflare/runtime.ts:1240`) and
`RecordManager.remote((name) => recordStub(env, project, name))` (`runtime.ts:730`). So whatever the
law gives must be a value of Cloudflare's `DurableObjectStub<ProcessBinding>` and
`DurableObjectStub<RecordBinding>` types, whose `Rpc.Provider` wrapping no plain function fills
without a cast. Every stand-in of these bindings on main casts (`platform.test.ts:27`,
`reach.laws.test.ts:60`). Only a seam above the binding, in the Project's own Effect types, lets the
law type its stand-in. That seam is a service in the Project's requirements, which the Effect way
puts in `R` and a test provides.

**How others do it.** Erlang/OTP calls a named process by name: `gen_server:call(Name, Request)`, the
name the first argument (OTP's `gen_server` docs, from memory, not fetched). Cloudflare's own
binding is the same idea, `getByName(name)` then the call. Effect puts what code calls in a service
in `R` and provides a test layer (Effect's `Layer.mock`, the Recorder's base). So each call of the
service takes the object's registered name first, and stays an Effect member the Recorder records.

```ts
// next/packages/libfabrika/src/cloudflare/ObjectCalls.ts, the contract only (0095). A sketch.
// Amendment (2026-11-16, merge session ruling on node-s1's tests round 2): ObjectCalls.ts.
// Wrong, kept as the record: Objects.ts, which differs from objects.ts beside it only in case (TS1261).
import { Context } from "effect";
import type { RecordShape } from "./objects.ts";
import type { ProcessClient } from "./platform.ts";

/** Each call of `S`, with the registered name of the object it goes to put first. */
export type ByName<S> = {
  readonly [K in keyof S]: S[K] extends (...args: infer A) => infer R ? (object: string, ...args: A) => R : never;
};

/** One project's Process objects, called by registered name, as OTP's gen_server:call(Name, Request). */
export class ProcessObjects extends Context.Service<ProcessObjects, ByName<ProcessClient["Service"]>>()(
  "@kampus/libfabrika/cloudflare/ProcessObjects",
) {}

/** One project's Record objects, called by part name. */
export class RecordObjects extends Context.Service<RecordObjects, ByName<RecordShape>>()(
  "@kampus/libfabrika/cloudflare/RecordObjects",
) {}
```

```ts
// next/packages/libfabrika/src/cloudflare/ProcessObjectsRpc.ts, the layer over the binding. A sketch.
export const layer = (stub: (object: string) => ProcessBinding): Layer.Layer<ProcessObjects> =>
  Layer.succeed(ProcessObjects, {
    msg: (object, ...args) => ProcessClient.make(stub(object)).msg(...args),
    configure: (object, ...args) => ProcessClient.make(stub(object)).configure(...args),
    // ... one line for each of ProcessClient's 13 members, as today's call sites do it
  });

// next/packages/libfabrika/src/cloudflare/RecordObjectsRpc.ts. A sketch.
export const layer = (stub: (object: string) => RecordShape): Layer.Layer<RecordObjects> =>
  Layer.succeed(RecordObjects, {
    write: (object, ...args) => stub(object).write(...args),
    read: (object, ...args) => stub(object).read(...args),
    content: (object, ...args) => stub(object).content(...args),
    deleteContent: (object, ...args) => stub(object).deleteContent(...args),
  });
```

```ts
// next/packages/libfabrika/src/cloudflare/runtime.ts, what changes. A sketch.
// In projectLogic: the seven ProcessClient.make(processStub(env, name, ...)) calls ask the service.
const objects = yield* ProcessObjects;
deliver: (pid, incoming) => processObject(pid).pipe(Effect.flatMap((owner) => rpc(objects.msg(owner, incoming)))),

// recordLayer reads RecordObjects instead of env.RECORD; recordingLayer then needs RecordObjects.
const recordLayer = Layer.unwrap(
  Effect.map(RecordObjects.asEffect(), (objects) =>
    RecordManager.remote((name) => ({
      write: (...args) => objects.write(name, ...args),
      read: (...args) => objects.read(name, ...args),
      content: (...args) => objects.content(name, ...args),
      deleteContent: (...args) => objects.deleteContent(name, ...args),
    })),
  ),
);

// The Project's layer leaves both services in its requirements; projectLayer provides them from env,
// so brain.ts, projectRuntime and every other caller of projectLayer are unchanged.
export const projectLayerWithoutObjects = (ctx, env, options, local = ...) =>
  /* today's projectLayer body */; // Layer<ProjectService, E, ProcessObjects | RecordObjects>
export const projectLayer = (ctx, env, options, local = ...) =>
  projectLayerWithoutObjects(ctx, env, options, local).pipe(
    Layer.provide(ProcessObjectsRpc.layer((object) => processStub(env, projectName, object))),
    Layer.provide(RecordObjectsRpc.layer((part) => recordStub(env, projectName, part))),
  );
// processLayer (runtime.ts:2294) and connectionLayer (connection.ts:124) provide
// RecordObjectsRpc.layer the same way, since recordingLayer now needs RecordObjects.
```

`projectName` is the name the Project already computes (`ctx.id.name ?? config.name`,
`runtime.ts:885`); the builder reads it once and passes it to both layers.

```ts
// next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts, the Harness. A sketch.
// Amendment (2026-11-16, merge session ruling on node-s1's tests round 2): the contract's path.
import type { ProcessObjects, RecordObjects } from "./ObjectCalls.ts";

export interface Harness {
  // ... open, door, tail as today
  readonly environment: (box: Box, usage: Usage, loaded: Loaded) => Omit<Env, "INSTANCE">; // `accept` moves out
  readonly objects: (box: Box, accept: () => number) => Layer.Layer<ProcessObjects | RecordObjects>;
}
// projectWalk: projectLayerWithoutObjects(ctx, { ...env, INSTANCE }, options).pipe(
//   Layer.provide(harness.objects(box, () => ++accepted)))
```

```ts
// next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts. A sketch.
// Amendment (2026-11-16, merge session ruling on node-s1's tests round 2): the contract's path.
import { ProcessObjects, RecordObjects } from "../cloudflare/ObjectCalls.ts";

const objects: ProjectAuditTest.Harness["objects"] = (box, accept) =>
  Layer.merge(
    Recorder.layer(ProcessObjects, {
      configure: () => Effect.void,
      msg: (_object, input) =>
        Effect.gen(function* () {
          // ProcessShape types msg's input as unknown; the stand-in reads it through Entry's schema.
          const incoming = yield* Schema.decodeUnknownEffect(Incoming)(input).pipe(Effect.orDie);
          const message = incoming.envelope.input;
          const stamped = Predicate.isObject(message) ? { ...message, parent: incoming.envelope.id } : message;
          // oxlint-disable-next-line fabrika/no-promises -- edge: the program box admits through a Promise
          if (!(yield* Effect.promise(() => box.admit(stamped)))) {
            return Sent.cases.refused.make({ reason: "bad_msg" });
          }
          const rev = accept();
          return Sent.cases.accepted.make({ rev, pos: rev });
        }),
    }),
    Recorder.layer(RecordObjects, { write: () => Effect.succeed(Written.cases.written.make({})) }),
  );

// The environment keeps Stub.make for the plain bindings. PROCESS keeps only the tail's `usage`;
// RECORD gives nothing, since nothing reads the binding now.
PROCESS: Stub.make<Env["PROCESS"]>(unexpected, {
  getByName: (object) =>
    Stub.make<ReturnType<Env["PROCESS"]["getByName"]>>(unexpected, { usage: async (rows) => usage(object, rows) }),
}),
RECORD: Stub.make<Env["RECORD"]>(unexpected),
```

Each choice, decided in one line:

- **The name goes first in each call, not a `(name) => client` member,** 90%: the Recorder records
  only effectful members (`Recorder.ts`, `Method<S>`), so a member that answers a client would hide
  every call behind it; OTP's `gen_server:call` takes the name first too.
- **`ByName` is mapped from `ProcessClient["Service"]` and `RecordShape`,** 85%: the services cannot
  drift from the object's contract, and neither has an overloaded method, so `Recorder.layer`
  takes both (law R16).
- **A member the law leaves out dies with `UnimplementedError`,** as `Layer.mock` does, 90%: it
  replaces `unexpected` for these two services, and a Project call the law did not give fails as
  loudly as before.
- **`projectLayer` keeps its signature,** 85%: its five other callers (`brain.ts`, `projectRuntime`,
  `leave.laws.test.ts`, `mail.test.ts`, `reload.laws.test.ts`) keep working unchanged, and only the
  audit walk takes the lower layer.
- **Is this a setting?** No: how the Project reaches its objects is code structure, nothing a person
  running fabrika picks (0069).
- **What fact is lost if not recorded now?** None: the calls are the same calls, and the Recorder
  keeps only a test run's record.

## One value traced: a refused message

**Amendment (2026-11-16, merge session ruling on node-s1):** steps 2 to 4 now go through the
service. The Project asks `yield* ProcessObjects` and calls `objects.msg("counter:1", incoming)`;
the law's Recorder layer writes `{ method: "msg", args: ["counter:1", incoming] }`, runs the law's
`msg`, which asks `box.admit(stamped)`, and the box's no becomes `refused`. Step 5 is now
`UnimplementedError` for a `ProcessObjects` member the law left out, and `unused platform call:
idFromName` still for a binding member the stubs left out. The steps as first written:

1. The project audit suite builds the environment with `harness.environment(box, accept, usage, loaded)`
   (`ProjectAuditTest.ts:172`) and hands it to `projectLayer`.
2. The Project asks `env.PROCESS.getByName("counter:1")`. `Stub.make`'s trap finds `getByName` in
   `own` and answers the process stub.
3. The Project calls `msg(input)` on it. The stub stamps the message's parent and asks
   `box.admit(stamped)`. The box says no.
4. `msg` answers `Sent.cases.refused.make({ reason: "bad_msg" })`, and the suite's admission walk
   records the refusal as it does today.
5. Had the Project asked `env.PROCESS.idFromName(...)`, a member this law never gave, `rest` would
   throw `unused platform call: idFromName`, and the walk fails.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1. In every folder a `vitest/no-restricted-vi-methods` block lists, `vi.fn`, `vi.mock`, `vi.doMock`, `vi.spyOn` and `vi.stubEnv` are refused, and `vi.waitFor`, a comment, a string and another object's `fn` pass | lint | scenario: the plant lines of `VI_METHODS`, run in a file of each listed folder, as `REFLECT` is | delete `fn` from the new block of `.oxlintrc.json`: M1 red for `node/*.ts`. Amendment 2026-11-16 (lead ruling): the lock is the pair, and this law also runs `VI_PROPERTIES` (see the lock's amendment): drop the block's `vi` entries from `eslint/no-restricted-properties`, and its chained lines are not refused, red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| M2. `RunnerAdmission.integration.test.ts` has no `vi` call and no import of `vi` | lint | lint | put back `getEntrypoint: vi.fn().mockReturnValue(box)`: `vitest(no-restricted-vi-methods)` red. Amendment 2026-11-16 (lead ruling): that line is a chained call, which the vitest rule alone takes; it is red through `eslint(no-restricted-properties)`, the pair's other half. Amendment 2026-11-16 (merge session ruling on node-s1): the plant is that line with `import { vi } from "vitest"` put back, red through `eslint(no-restricted-properties)` (`object: "vi"`, `property: "fn"`); a second plant, `getEntrypoint: vi.fn(() => box)`, is red through `vitest(no-restricted-vi-methods)`, as the tests row saw at line 129 | next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts |
| M3. Both suites in the file keep every law they had: the runner admission suite and the project audit suite, with the same seeds, run counts and `required` coverage, and the audit walks still reach every case | test | scenario: the suites' own tapes, unchanged | Amendment 2026-11-16 (merge session ruling on node-s1): make the `ProcessObjects` layer's `msg` answer `Sent.cases.refused` for every object message: 4 audit laws red (expected `result._tag` accepted), as the tests row saw. The plan's first plant, `msg` answering `accepted` without asking `box.admit`, left all 11 laws green and is marked wrong: the walk's unknown move is refused at the gateway before `msg` | next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts |
| M4. Restated (amendment 2026-11-16, merge session ruling on node-s1): every member the law gives is typed by a type that names it, so a misspelled member does not compile: the `Recorder.layer` impls of `ProcessObjects` and `RecordObjects` (the Recorder's laws R17 and R18), and the `own` of the stubs of plain interfaces (`WorkerLoader`, its loaded worker, `R2Bucket`). Not held by types: a misspelled member in a Durable Object stub's `own` (the process stub's `usage`), whose Cloudflare type takes any key; M3 holds it at run time, since the walk's usage rows (`ProjectAuditTest.ts:291`) then never arrive | type | type | rename `write` to `writ` in the `RecordObjects` impl: red in libfabrika's `tsc --noEmit -p .`; and rename `get` to `gett` in the loader stub's `own`: TS2561, as the tests row saw | next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts |

- M3 is the loosening check: every value the old law compared is still compared, and the reviewer
  runs the loosening grep on the diff.
- M4 is red only in a typecheck; the tests step runs one `effect-tsgo diagnostics` on libfabrika's
  tsconfig and says so. Amendment 2026-11-16 (merge session ruling on node-s1): that diagnostics run
  reports Effect's checks only, so M4 is read from libfabrika's own `tsc --noEmit -p .`, run once,
  alone.
- Amendment 2026-11-16 (merge session ruling on node-s1): until the build lands `ObjectCalls.ts`
  (amendment 2026-11-16, merge session ruling on node-s1's tests round 2; wrong, kept as the
  record: `Objects.ts`) and `projectLayerWithoutObjects`, the test file does not compile. That is the tests step's red: M3 and
  M4 go green at the build's head.
- No law needs the real machine, so none is host-only (0178). M3 is an `.integration.` law already;
  no new one is added. No law reads a secret.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts | tests | tests | the four `vi.fn` become `Stub.make` over `Env`'s bindings; `unexpected` names the member; the `vi` import goes |
| .oxlintrc.json | tests | 0 | one override block for `next/packages/libfabrika/src/node/*.ts`, `vitest/no-restricted-vi-methods` at error with five messages |
| oxlint-plugins/builtin-plants.ts | tests | tests | `VI_METHODS`, the plant lines for M1, beside `REFLECT`; and (amendment 2026-11-16, lead ruling) the `VI_PROPERTIES` plant, the lock's other half |
| oxlint-plugins/plants.test.ts | tests | tests | M1: `VI_METHODS`' lines refused exactly in every folder of every block that sets the rule, as the `REFLECT` scenario does |
| field/runs/2026-11-15-mock-node-tests1.json | tests | docs | the tests step's run row, with its plants |
| next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts | tests | tests | amendment 2026-11-16 (merge session ruling on node-s1): `Harness` gains `objects(box, accept)`, a layer of `ProcessObjects` and `RecordObjects`; `environment` drops `accept`; `projectWalk` calls `projectLayerWithoutObjects` and provides `harness.objects`. No law of the suite changes |
| next/packages/libfabrika/src/cloudflare/ObjectCalls.ts | build | 30 | amendment 2026-11-16: new, the contract only (0095): `ByName`, `ProcessObjects`, `RecordObjects`. Amendment (2026-11-16, merge session ruling on node-s1's tests round 2): named `ObjectCalls.ts`; wrong, kept as the record: `Objects.ts`, which clashes in case with `objects.ts` |
| next/packages/libfabrika/src/cloudflare/ProcessObjectsRpc.ts | build | 25 | amendment 2026-11-16: new, `layer(stub)`, each member through `ProcessClient.make(stub(object))` |
| next/packages/libfabrika/src/cloudflare/RecordObjectsRpc.ts | build | 12 | amendment 2026-11-16: new, `layer(stub)`, each member through `stub(object)` |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 35 | amendment 2026-11-16: the Project's seven `ProcessClient.make(processStub(...))` calls ask `ProcessObjects`; `recordLayer` reads `RecordObjects`; `projectLayerWithoutObjects` is today's `projectLayer` body, and `projectLayer` provides both Rpc layers from `env`; `processLayer` provides `RecordObjectsRpc.layer` |
| next/packages/libfabrika/src/cloudflare/connection.ts | build | 3 | amendment 2026-11-16: `connectionLayer` provides `RecordObjectsRpc.layer` to its `recordingLayer` |
| .glossary/TERMS.md | build | docs | amendment 2026-11-16: rows for `ProcessObjects` and `RecordObjects` |
| next/packages/vitest/src/Stub.test.ts | tests | 0 | read only, not changed: pull request 1433's L6, the helper's own laws |
| next/packages/libfabrika/tsconfig.json | tests | 0 | read only, not changed: the project M4's typecheck reads |
| next/packages/libfabrika/src/node/build/build-assets.integration.test.ts | tests | 0 | read only, not changed: named by the finding below, outside this slice |

- No product file changes, so no build step is expected. If the typecheck shows `Stub.make` itself
  must change, that change belongs to pull request 1433's slice, not here, and this slice waits.
  **Wrong, replaced (amendment 2026-11-16, merge session ruling on node-s1):** five product files
  change, the build rows above, and `next/packages/vitest/src/Stub.ts` does not.

## Existing tools

Amendment 2026-11-16 (merge session ruling on node-s1). Searched: libfabrika's `cloudflare/` and
`telemetry/` folders on main for a service that calls a Durable Object by name, `@kampus/vitest`,
and Effect 4.1.3's `Layer`.

- `next/packages/libfabrika/src/cloudflare/ObjectCalls.ts` (`ByName`, `ProcessObjects`,
  `RecordObjects`; amendment 2026-11-16, merge session ruling on node-s1's tests round 2; wrong,
  kept as the record: `Objects.ts`): `ProcessClient` (`platform.ts`) is a service of one stub, built inline by its
  caller, so no law can provide it per name; `RecordManager.remote` takes a per-name function but
  of the raw `RecordShape`, not a service. Neither is in the Project's requirements, so none fits.
  Both are reused inside the new layers.
- `next/packages/libfabrika/src/cloudflare/ProcessObjectsRpc.ts`, `layer`: it is `ProcessClient.make`
  by name; nothing on main maps a name to a client as a layer.
- `next/packages/libfabrika/src/cloudflare/RecordObjectsRpc.ts`, `layer`: the same over
  `recordStub`, which stays as it is.
- `projectLayerWithoutObjects` in `runtime.ts`: today's `projectLayer` body under a new name, so the
  existing callers keep `projectLayer`; no layer on main leaves these services open.
- The test side writes nothing new: `Recorder.layer` (`next/packages/vitest/src/Recorder.ts`) and
  `Stub.make` as they are.
- Every path above is an exam path, so all are the tests step's. No path is in pull request 1366's
  diff (read with `get_files`, 57 files, 2026-11-15).

## Calls taken

- **Wait for 1433's `Stub.make` and use it,** 95%. 0554 rules a law calls the shared helper.
- **Members Cloudflare's types refuse in `own` go by name in `rest`,** 70%. See the doubts.
  **Wrong, replaced (amendment 2026-11-16, merge session ruling on node-s1):** they go through
  `ProcessObjects` and `RecordObjects`, provided with `Recorder.layer`; certain, it is the ruling.
- **The lock is `node/*.ts` with all five methods,** 85%. See "The shape".
- **No `Recorder`,** 90%. Nothing reads a call. **Replaced (amendment 2026-11-16, merge session
  ruling on node-s1):** the two services are provided with `Recorder.layer`; still no law reads a
  call, see the doubts.
- **Is this a setting?** No. Which `vi` methods are refused, and where, is a rule on our own source,
  held by lint, and nothing a person running fabrika picks (0069).
- **What fact is lost if not recorded now?** None. The doubles live only inside one test run.

## Validation

- The tests step: `pnpm format`, then `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=6144` in
  a cloud box), then `nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/plants.test.ts`
  and the same on `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts`. One
  `pnpm exec effect-tsgo diagnostics --format json --project next/packages/libfabrika/tsconfig.json`
  for M4. Each plant is run once and recorded in the run row.
- The review reads the whole diff against this plan and runs the loosening check on M3.
- Amendment 2026-11-16 (merge session ruling on node-s1): M4 is read from libfabrika's own
  `tsc --noEmit -p .`, run alone. The build also runs the narrow laws of the files it changes
  (`nice -n 15 pnpm exec vitest run --maxWorkers=3` on `next/packages/libfabrika/src/cloudflare`'s
  `leave.laws.test.ts`, `mail.test.ts`, `reload.laws.test.ts`, `connection.test.ts`,
  `reach.laws.test.ts` and `platform.test.ts`), then `--changed origin/main` once.

## Steps

**Amendment (2026-11-15, merge session rulings 1 and 5).** The slice opens no pull request of its
own. It lands on the mock sweep's one fold branch, `fabrikalfa/mock-fold`, in its one pull request
(0589, amended 2026-11-15), after its own steps, one fresh agent each, in its own box:

1. **Tests:** M1 to M4, `VI_METHODS` and the lock block; each plant run once and recorded in the
   run row.
2. **Build:** no product file changes, so the build changes nothing, says so in its run row, and
   runs the checks under "Validation" green at the tests step's head, or sends back.
3. **Review:** the one review of the slice's diff, with the loosening check on M3.

M1 here is the sweep's one lock law: every other mock plan's lock runs this plan's `VI_METHODS` set
in its own paths (ruling 2).

**Amendment (2026-11-16, merge session ruling on node-s1).** Step 2 is now a real build. On the
same branch, `fabrikalfa/mock-node-s1`, from its head `2d2f8bfb9`:

1. **Tests, round 2:** `RunnerAdmission.integration.test.ts` and `ProjectAuditTest.ts` on the
   shape in "Amendment: `msg` and `write` through typed services"; M2's plants, M3's new plant and
   M4's two plants run once and recorded. The file does not compile until the build: that is its
   red.
2. **Build:** `ObjectCalls.ts` (amendment 2026-11-16, merge session ruling on node-s1's tests
   round 2; wrong, kept as the record: `Objects.ts`), `ProcessObjectsRpc.ts`, `RecordObjectsRpc.ts`, the `runtime.ts` and
   `connection.ts` changes and the glossary rows; the checks under "Validation" green.
3. **Review:** as before, plus that no `ProcessClient.make(processStub(...))` is left in the
   Project's logic in `runtime.ts`.

## Size

One slice, on the fold branch named under "Steps". Confidence in the counts: 85%; the doubt is how
many members must go by name in `rest`. Counted on main at `f7169af` with `rg -c` in
`next/packages/libfabrika/src/node`:

| Where | `vi.fn` | `toHaveBeenCalled*` | `vi.spyOn` | `vi.mock` | `vi.doMock` | `vi.stubEnv` |
|---|---|---|---|---|---|---|
| top files (`node/*.ts`), this slice | 4 | 0 | 0 | 0 | 0 | 0 |
| `node/build` | 0 | 0 | 0 | 0 | 7 | 4 |
| `node/dev` | 0 | 2 | 15 | 2 | 0 | 6 |
| `node/client` | 0 | 0 | 3 | 0 | 0 | 0 |
| `node/repositories` | 0 | 0 | 1 | 0 | 0 | 0 |

1. The `RunnerAdmission` law on `Stub.make` and typed services, and the lock for `node/*.ts`:
   amendment 2026-11-16 (merge session ruling on node-s1), about 105 product lines (the five build
   rows), about 80 test lines changed, about 25 lines of configuration, about 60 lint test lines.
   105 lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder
plan priced them: a tests step about $6, a review about $3, a fix round about $4. No build step was
expected; (amendment 2026-11-15, ruling 5) the build that only runs checks is about $2, as the
oxlint-plugins plan prices one. One likely fix round, for the `own` typing doubt.

Amendment 2026-11-16 (merge session ruling on node-s1): the quest's budget now counts the tests
round already run ($6), a second tests round ($6), a real build of five product files (about $6, a
build of that size in the same rows), the review ($3) and one likely fix round ($4), for the
`projectLayerWithoutObjects` split and the five other callers it must leave unchanged.

Estimate: 5 steps, $25

## Records

- No decision file: this builds 0554, 0555, 0557 and 0579, and takes no new ruling.
- No glossary row: "stub" is already the industry's word, and 1433 coins nothing new. Amendment
  2026-11-16 (merge session ruling on node-s1): the build adds rows for `ProcessObjects` and
  `RecordObjects`, and the PR's `## New names` lists them with `ByName`, `ProcessObjectsRpc.layer`,
  `RecordObjectsRpc.layer` and `projectLayerWithoutObjects`.
- `field/`: one run row per step, the same day.
- The tracker ticket is 1067.

## What this cannot tell us

- **Whether the sketch compiles.** Nothing was compiled. The first typecheck tells, starting with
  the RPC-wrapped members of `own`.
- **Whether `Stub.make` lands as 1433's plan sketches it.** Its build has not run. If its
  signature changes, the sketch above follows it.
- **Whether `vitest/no-restricted-vi-methods` matches `vi.fn` through an import alias** (`import
  { vi as v }`). M1's plant lines try it and record what oxlint does; a miss is listed, not hidden,
  as `REFLECT` lists its alias miss.
- **The rest of the file's test style.** `register` runs a raw `fc.assert`, which 0579 retires; that
  is the property-law sweep's work, not this slice's.

## Open questions

None.

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-node-build-mocks-have-no-slice", "date": "2026-11-15", "by": "plan", "model": "claude-opus-5-5", "rule": "rule_break", "location": {"path": "next/packages/libfabrika/src/node/build/build-assets.integration.test.ts", "line": 275}, "says": "In next/, node/build's laws call vi.doMock 7 times and vi.stubEnv 4 times (build-assets.integration.test.ts and build-one-file.integration.test.ts), which 0555 bans, and the recorder plan's slice table counts only vi.fn, toHaveBeenCalled and vi.spyOn, so no mock-sweep slice owns them.", "proof": "rg -c 'vi\\.doMock\\(|vi\\.stubEnv\\(' next/packages/libfabrika/src/node/build on main at f7169af: build-assets 5 and 1, build-one-file 2 and 3. docs/plan/quests/recorder-PLAN.md, Size, the folder table, has no row for node/build.", "cost": "The vi ban cannot reach node/** while these stay, and no plan is set to remove them.", "head": "f7169af", "ticket": null, "pr": null}
```

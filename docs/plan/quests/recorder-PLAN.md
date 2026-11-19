Approved by the lead agent, builds 0579, 0555, 0557, 0538; body d4089f2efcde
Plancheck-Version: 3

# Plan: `@kampus/vitest` gets a `Recorder`, the one typed way a law watches a service's calls (ticket 1067)

This is `next/` and our tooling (`.agents/`, the `oxlint-plugins` folder, the CI scripts). Today's
app is not touched. It builds [0579](../../../.decisions/0579-property-laws-use-it-prop.md) ("the
it.prop and Recorder decision", the owner's ruling of 2026-11-15), which answers the open "way to
spy" of [0555](../../../.decisions/0555-no-vi-mock-or-domock.md), inside the toolbox rule of
[0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md) and the placement rule of
[0538](../../../.decisions/0538-kampus-vitest-holds-the-test-primitives.md) (test layers stay beside
their service).

```ts
// The whole idea, on a real service of ours (lead tooling's Pushes). A sketch, not compiled.
const pushes = Recorder.layer(Pushes, impl, {
  fails: { push: new PushRefused({ reason: "rejected" }) },
});

it.effect("a refused push is the last thing tried", () =>
  Effect.gen(function* () {
    yield* Effect.flip(Publish.publish(ask("fabrikalfa/a", head)));
    expect(yield* Recorder.calls(Pushes)).toEqual([
      { method: "leakGrep", args: [".", head] },
      { method: "push", args: [".", "fabrikalfa/a", head] },
    ]);
  }).pipe(Effect.provide(pushes)),
);
```

## Doubts, read these first

- **Whether `Recorder.ts` can be written with no type assertion at all (70%).** The lean wraps the
  law's implementation in a `Proxy` and hands it to Effect's own `Layer.mock`, which already takes a
  part of a service and types it against the whole interface. Effect's own `Layer.mock` needs one
  plain narrowing cast inside its trap (`prop as keyof S`, `node_modules/effect/src/Layer.ts`).
  If the build needs one too, it is one line inside `Recorder.ts` with its reason beside it. A
  double cast (`as unknown as`) is never written: 0579 says so, and `fabrika/no-type-assertions`
  refuses it. No call site writes any cast. What settles it: the build's first typecheck.
- **One of the two proof sites is not type-checked today (certain, and named).** The lead tooling
  folder `.agents/skills/lead/scripts/pr/` is not in `.agents/tsconfig.json`'s `include`, so its
  tests run on every pull request but `tsc` never reads them (ticket 486 owns that list). That is
  why the second proof site, in `next/`, is one `pnpm typecheck` does read.

## What changes, in one paragraph

A new module, `next/packages/vitest/src/Recorder.ts`, exported as `Recorder` from `@kampus/vitest`.
`Recorder.layer(Service, impl, { fails })` provides the service and records every call of its
effectful members, as `{ method, args }`, in the order the calls run. A method named in `fails`
records its call and then fails with the error value given there, which the types hold to that
method's own error type. `Recorder.calls(Service)` reads every call, and
`Recorder.calls(Service, "push")` reads one method's argument lists, typed to that method. Two
call sites move onto it as proof: lead tooling's `PushesTest.layer`, whose hand-written call log
and failure switches it replaces one for one, and the settings command's law in
`next/packages/libfabrika/src/node/settings/Command.test.ts`, which records Effect's own
`FileSystem` by hand today. The rest of the sweep is listed as later slices, with counts.

## The package's name

The plan says `@kampus/vitest`, the name on main today (`next/packages/vitest/package.json`). 0557
renames the package to `@kalfa/vitest` and moves it to `kalfa/vitest` (0556), but that rename is
its own pull request, not on main and not open, and it changes one import line in every file that
names the package. Building on the name that resolves today lets this land now. The rename then
changes the new import lines with the rest. Call: 90%.

## How others do it

- **The industry's words.** Fowler's "Mocks Aren't Stubs" (fetched 2026-11-15) lists five test
  doubles. A stub gives canned answers. A spy is "a stub that also records some information based
  on how it was called". A fake has a working shortcut implementation. A mock carries expectations
  set before the run. Meszaros's xUnit Test Patterns calls the same thing a Test Spy and, as far as
  memory serves, gives "Recording Test Stub" as its other name (not fetched: the site refused the
  connection). So a `Recorder` is a test spy, the industry's thing under the owner's name, and the
  glossary row says so. It is not a mock: the law asserts after the run, never before.
- **Effect's own recording fake.** `effect/testing` ships `TestConsole` (installed effect 4.1.3,
  `node_modules/effect/src/testing/TestConsole.ts`). It provides the `Console` service and pushes
  one entry per call, `{ method, parameters }`, where `method` is a key of the service. A law reads
  `TestConsole.logLines` through the service. The Recorder is the same shape made generic: a record
  is `{ method, args }`, keyed by the service's own member names, read back through the context.
  0579 says `args`, so the key is `args`, not Effect's `parameters`.
- **Effect's fakes that control, not record.** `TestClock` in the same folder is a fake clock a law
  moves by hand. It records nothing, so it is the other kind of double. The Recorder does not try to
  be one: a stateful fake stays in its service's own test layer (0538), and the Recorder wraps it.
- **Effect's partial service.** `Layer.mock(Service, part)` (`node_modules/effect/src/Layer.ts`,
  stable) types a part of a service against its interface with `Layer.PartialEffectful<S>`: every
  member that is not effectful must be given, and an effectful member left out dies with an
  `UnimplementedError` defect when used. It is built on a `Proxy`. The Recorder takes its
  implementation in that same type and hands it to `Layer.mock`, so a part of a service works the
  way Effect's makers already made it work.
- **`@effect/vitest` has no spy.** Its `src/index.ts` (4.1.3) re-exports all of `vitest` and adds
  `it.effect`, `layer`, `prop` and friends; nothing records calls. In `Effect-TS/effect`'s own
  tests, 0555 counted `vi.spyOn` in 22 files, so the makers spy with the test framework. We do not
  (0555, 0557).
- **What a spy keeps, in the tools people use.** Vitest's `mock.calls` keeps each call's arguments,
  and `mock.results` keeps `{ type: "return" | "throw" | "incomplete", value }` per call (vitest.dev,
  fetched 2026-11-15). Sinon's spy call keeps `args`, `returnValue` and `exception` (from memory;
  its page answered 404). Both keep the answer too. The Recorder keeps method and args only, as
  0579 rules and as `TestConsole` does: the law wrote the implementation, so it already knows the
  answer, and a law that needs the answer reads it from the Effect it ran.

## The shape

A sketch, not compiled. The names are the installed effect 4.1.3's.

```ts
// next/packages/vitest/src/Recorder.ts
import type * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

/** A member the Recorder watches: an Effect, or a function that answers an Effect or a Stream. */
type Watched =
  | Effect.Effect<unknown, unknown, unknown>
  | ((...args: never) => Effect.Effect<unknown, unknown, unknown>)
  | ((...args: never) => Stream.Stream<unknown, unknown, unknown>);

/** A method's name: a string key of the service whose member is watched. */
export type Method<S> = { [K in keyof S]-?: S[K] extends Watched ? K : never }[keyof S] & string;

/** What one call of a method was handed: its own parameter list, and `[]` for an Effect member. */
export type Args<S, M extends Method<S>> = S[M] extends (...args: infer A) => unknown ? Readonly<A> : readonly [];

/** The error a method fails with, read from its own type. `never` for a method that cannot fail. */
export type Failure<S, M extends Method<S>> =
  S[M] extends Effect.Effect<unknown, infer E, unknown>
    ? E
    : S[M] extends (...args: never) => Effect.Effect<unknown, infer E, unknown>
      ? E
      : S[M] extends (...args: never) => Stream.Stream<unknown, infer E, unknown>
        ? E
        : never;

/** One recorded call. A union over the methods, so a check on `method` narrows `args`. */
export type Call<S> = { [M in Method<S>]: { readonly method: M; readonly args: Args<S, M> } }[Method<S>];

/** The methods that fail, each with an error value of its own error type. */
export type Fails<S> = { readonly [M in Method<S>]?: Failure<S, M> };

/** The store a Recorder layer adds beside its service, so `calls` can find it. Phantom in `I`. */
export interface Recorded<in out I> {
  readonly [RecordedId]: I;
}

/** Provides `service` from `impl`, records each call's method and args, and fails the `fails` methods. */
export declare const layer: <I, S extends object>(
  service: Context.Key<I, S>,
  impl: Layer.PartialEffectful<S>,
  options?: { readonly fails?: Fails<S> },
) => Layer.Layer<I | Recorded<I>>;

/** The calls recorded so far, in the order they ran: all of them, or one method's argument lists. */
export declare const calls: {
  <I, S>(service: Context.Key<I, S>): Effect.Effect<ReadonlyArray<Call<S>>, never, Recorded<I>>;
  <I, S, M extends Method<S>>(
    service: Context.Key<I, S>,
    method: M,
  ): Effect.Effect<ReadonlyArray<Args<S, M>>, never, Recorded<I>>;
};
```

```ts
// next/packages/vitest/src/index.ts gains one line, as Effect's own index names its modules
export * as Recorder from "./Recorder.ts";
```

Each choice the brief asked the plan to settle, decided in one line with its reason:

- **How a method is named.** By its key on the service's interface, as a string literal type,
  `Method<S>`. A name the service lacks is a compile error in `fails` and in `calls`. Only
  effectful members count: Effects, and functions that answer an Effect or a Stream, the same set
  `Layer.mock` treats as effectful, less `Channel`, which no service of ours has. A member that is
  plain data, a `Sink` or a symbol key (`FileSystem` has `[TypeId]` and `sink`) is passed through
  unwatched. 85%.
- **How args are typed per method.** `Args<S, M>` is the method's own parameter tuple, made
  readonly, and `[]` for an Effect member. `Call<S>` is a union over methods, so
  `call.method === "push"` narrows `call.args` to `readonly [dir: string, branch: string, head: string]`.
  90%.
- **How `fails` names a method and what it raises.** `fails` is a record from method name to an
  error value, `{ push: new PushRefused({ reason: "rejected" }) }`, and the value's type must be
  that method's own error type, `Failure<S, M>`. 0579's sketch wrote `fails: ["now"]`, a list, but
  a list cannot say which value to raise, and the Recorder cannot make a value of a service's error
  type by itself. With `exactOptionalPropertyTypes` on in the base tsconfig, a method that cannot
  fail has `Failure` of `never`, so it cannot be named at all. A failing method is recorded first,
  then fails; the implementation's own member for it is not run. A failing Effect member or method
  fails as `Effect.fail(error)`; a failing Stream method answers `Stream.fail(error)`. 85%.
- **When a call is recorded.** When the Effect runs, not when the function is called, because a
  service method in Effect is a description and the outside world sees the run. An Effect built and
  never run is no call; one run twice, as by `Effect.retry`, is two calls, as a real code host sees
  two requests. A Stream method records when the stream starts. A record is written at the start
  of the run, so a call that never finishes, such as `Effect.never`, is still on the list. 80%.
- **What a record holds.** `{ method, args }`, nothing else, as 0579 rules. It does not record the
  answer: the law wrote the implementation, so it knows the answer, and `TestConsole` keeps no
  answer either. Short keys, read out loud as a sentence. The key is `method`, not `_tag`: 0214
  writes `_tag` with Schema, and this union is built from a service's types, which no Schema can
  write. Its key follows the service's own member names, the same way 0214 lets a third party's
  shape keep its own key. 85%.
- **How `calls` is read in a law.** `yield* Recorder.calls(Service)` inside the Effect that the
  Recorder layer is provided to, because each build of the layer starts its own empty store, as
  every Effect test layer does. Its environment needs `Recorded<I>`, so reading calls of a service
  that no Recorder provides is a compile error, not an empty list. The second form,
  `Recorder.calls(Service, "merge")`, answers that method's argument lists in order, so no law
  filters on `method` by hand, which 0567's spirit asks. 85%.
- **A member the law leaves out.** It dies with Effect's `UnimplementedError` when used, as
  `Layer.mock` does, and it is not recorded. The law's run fails loudly either way. 80%.
- **Where the store lives.** A `Context.Service` made per service, keyed
  `@kampus/vitest/Recorder/<the service's key>`, holding a `Ref` of the calls. The layer is
  `Layer.effectContext`: it makes the `Ref`, builds the watched implementation and adds both. 85%.

## The proof sites, before and after

### Lead tooling's `Pushes`, a real service of ours

The shape 0555 bans, as the sweep meets it in other files (a sketch of that style on this service):

```ts
const push = vi.fn((_dir: string, _branch: string, _head: string) => Effect.void);
const layer = Layer.succeed(Pushes, Pushes.of({ leakGrep, leakChange, leakText, push }));
yield* Publish.publish(ask(b, head)).pipe(Effect.provide(layer));
expect(push).toHaveBeenCalledWith(".", b, head); // args are `any`: a wrong arg still compiles
```

What main has, `.agents/skills/lead/scripts/pr/PushesTest.ts`: a hand-written log of strings and a
hand-written switch per failing method.

```ts
export type Failing = { readonly leak?: string; readonly leakChange?: string; readonly leakText?: string; readonly push?: string };

leakGrep: (_dir, head) =>
  Effect.suspend(() => {
    r.calls.push(`leakgrep ${head}`);
    return failing.leak === undefined ? Effect.void : Effect.fail(new LeakGrepRefused({ reason: failing.leak }));
  }),
// ... the same block three more times
expect(m.remote.calls).toEqual([`leakgrep ${head}`, `push ${b} ${head}`]); // Publish.test.ts
```

After (a sketch, not compiled): the test layer keeps only what is its own, the remote's branches.

```ts
// PushesTest.ts
export type Failing = Recorder.Fails<Pushes["Service"]>;

export const layer = (r: Remote, fails: Failing = {}): Layer.Layer<Pushes | Recorder.Recorded<Pushes>> =>
  Recorder.layer(
    Pushes,
    {
      leakGrep: () => Effect.void,
      leakChange: () => Effect.void,
      leakText: () => Effect.void,
      push: (_dir, branch, head) => Effect.sync(() => void r.branches.set(branch, head)),
    },
    { fails },
  );

// Publish.test.ts: the read moves inside the provide
Effect.gen(function* () {
  const e = yield* Effect.flip(Publish.publish(ask(b, head)));
  expect(e._tag).toBe("LeakGrepRefused");
  expect(yield* Recorder.calls(Pushes)).toEqual([{ method: "leakGrep", args: [".", head] }]);
}).pipe(Effect.provide(memory([], { pushes: { leakGrep: new LeakGrepRefused({ reason: "private_word" }) } }).layer));
```

`Remote.calls` goes, and every reader of it in `Publish.test.ts` and `Queue.test.ts` reads
`Recorder.calls(Pushes)` instead. `Failing`'s short keys (`leak`, `push`) become the method names
(`leakGrep`, `push`). Every law there asserts the same order and the same values as before, now
with `dir` too, which the old strings dropped.

### The settings command's `FileSystem`, Effect's own service, in `next/`

Main, `next/packages/libfabrika/src/node/settings/Command.test.ts`, about 80 lines: a
`FileSystem.layerNoop` with every member written by hand, pushing paths into `counts.touched` and
method names into `counts.writes`.

After (a sketch, not compiled): Effect's `FileSystem.makeNoop` already answers `NotFound` for each
member left out, the same error the law builds by hand today, so the impl gives only the two reads
the law serves. The Recorder records every method, writes included.

```ts
const files = (at: string, person: Person) =>
  Recorder.layer(
    FileSystem.FileSystem,
    FileSystem.makeNoop({
      readFileString: (path) => (path === at ? answer(person, path) : other(path)),
      exists: () => Effect.succeed(false),
      sink: () => Sink.die(new Error("the settings command wrote with sink")), // a Sink is not watched
    }),
  );

const touched = (yield* Recorder.calls(FileSystem.FileSystem)).map((call) => call.args[0]);
const reads = (yield* Recorder.calls(FileSystem.FileSystem, "readFileString")).filter(([path]) => path === at);
const writes = (yield* Recorder.calls(FileSystem.FileSystem)).filter((call) => WRITES.has(call.method));
expect(reads).toHaveLength(1);
expect(writes).toEqual([]);
```

`WRITES` is the law's own list of `FileSystem`'s write methods, typed as
`ReadonlySet<Recorder.Method<FileSystem.FileSystem["Service"]>>`, so a misspelled method is a
compile error where today it is a silent miss. `call.args[0]` needs each method's first argument
to be a path; the tests step checks that against the installed `FileSystem` interface, and where a
method's first argument is not a path it reads that method by name instead.

## One value traced: a refused push

1. The law builds `PushesTest.layer(remote(), { push: new PushRefused({ reason: "rejected" }) })`.
   `Recorder.layer` makes an empty `Ref`, wraps the four members, and puts `Pushes` and the store
   in the context.
2. `Publish.publish` calls `pushes.leakGrep(".", head)` and runs it. On run, the Recorder appends
   `{ method: "leakGrep", args: [".", head] }`, then runs the impl's `Effect.void`.
3. It calls `pushes.push(".", "fabrikalfa/a", head)` and runs it. The Recorder appends
   `{ method: "push", args: [".", "fabrikalfa/a", head] }`. `push` is in `fails`, so it answers
   `Effect.fail(PushRefused { reason: "rejected" })` and the impl's `push` never runs:
   `remote.branches` stays empty.
4. `Publish.publish` fails with that `PushRefused`, and opens no pull request.
5. The law, still inside the provide, reads `yield* Recorder.calls(Pushes)` and gets both records
   in order. `yield* Recorder.calls(Pushes, "push")` gives `[[".", "fabrikalfa/a", head]]`, typed
   `ReadonlyArray<readonly [dir: string, branch: string, head: string]>`.
6. A typo, `Recorder.calls(Pushes, "pussh")`, or `fails: { push: new LeakGrepRefused(...) }`, does
   not compile.

## Laws

The Recorder's own laws use a small made-up service in the test file, since the package imports no
service of ours (0538, held by `fabrika/package-imports`). Made up for the laws, and nowhere else: a
service `Shelf` with an Effect method that can fail (`put(name, count)`), one that cannot
(`count(name)`), an Effect member (`size`), a Stream method (`watch(name)`) and a plain data member.
Property laws are `it.effect.prop` with Schemas as inputs (0579), and the seed is the package's.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| R1. A method name the service lacks fails to compile in `fails` and in `calls(Service, name)`, and `Method<S>` is exactly the effectful keys: data, `Sink` and symbol members are not methods | type | type | widen `Method<S>` to `string`: an `@ts-expect-error` goes unused, red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R2. A wrong arg type fails to compile: `calls(Shelf, "put")` answers `ReadonlyArray<readonly [name: string, count: number]>`, narrowing a `Call` on `method` gives that tuple, and comparing it with `[1, "a"]` is an error | type | type | make `Args` `ReadonlyArray<unknown>`: R2 red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R3. `fails` takes only the method's own error type, and a method whose error is `never` cannot be named | type | type | make `Fails`' values `unknown`: R3 red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R4. The layer is `Layer<I \| Recorded<I>>`, and `calls` needs `Recorded<I>`, so a law that reads calls with only the plain service provided does not compile | type | type | give `calls` an environment of `never`: R4 red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R5. Every run of every watched member is recorded, in run order, with exactly its args; an Effect member records `[]` | test | Effect Arbitrary: Moves | record only a method's first call, or drop its last arg: R5 red. Default runs | next/packages/vitest/src/Recorder.test.ts |
| R6. A method in `fails` is recorded, fails with exactly the given value, and its impl does not run; a method not in `fails` answers what the impl answers, value or error | test | Effect Arbitrary: Moves | run the impl before failing, or map the impl's answer: R6 red. Default runs | next/packages/vitest/src/Recorder.test.ts |
| R7. `calls(Service, m)` equals the args of `calls(Service)` whose method is `m`, in the same order | test | Effect Arbitrary: Moves | answer the list reversed: R7 red. Default runs | next/packages/vitest/src/Recorder.test.ts |
| R8. A call is a run: an Effect built and dropped is not recorded, one retried twice is recorded twice, and one that never ends is recorded at its start | test | scenario: three scripted runs of one `Shelf.put`, built and dropped, retried once, and `Effect.never` interrupted | record when the function is called: R8 red | next/packages/vitest/src/Recorder.test.ts |
| R9. A Stream method is recorded when its stream runs, and one in `fails` answers a failing stream with the given value | test | scenario: one `Shelf.watch` stream run to its end, and one failing | pass Stream members through unwatched: R9 red | next/packages/vitest/src/Recorder.test.ts |
| R10. Each build of the layer starts with no calls, and a member left out of `impl` dies with `UnimplementedError` | test | scenario: one layer provided to two runs in turn, then a call of a left-out member | keep the store at module level: R10 red | next/packages/vitest/src/Recorder.test.ts |
| R11. `Recorder.ts` holds no double cast | lint | lint | add `impl as unknown as S` in `Recorder.ts`: `fabrika/no-type-assertions` red | next/packages/vitest/src/Recorder.ts |
| R12. Publish and Queue keep their laws: the leak checks run before the push, in the same order, and a refused check or push stops what follows | test | Effect Arbitrary: Branch | swap the leak grep and the push in `Publish.ts`: R12 red. Default runs | .agents/skills/lead/scripts/pr/Publish.test.ts, .agents/skills/lead/scripts/pr/Queue.test.ts |
| R13. The settings command reads only the person's file, once, and calls no write method of `FileSystem` | test | Effect Arbitrary: Inputs | make the command call `writeFile` once: R13 red. Default runs | next/packages/libfabrika/src/node/settings/Command.test.ts |
| R14. `calls(Service, m)` with a union of names answers each name's own arg list, so a wrong arg type does not compile; `Args` and `Failure` are each name's own (fix round one) | type | type | read `Args` without splitting it over each name: R14 red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R15. An optional effectful member is a method, with its own args and error type, since `watch` records it (fix round one) | type | type | read a member as `S[K]`, `undefined` and all: R15 red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R16. A service with an overloaded effectful method does not compile as a Recorder layer, since `infer` reads only the last signature and no one `Args` is true of every call; a generic method, one signature, does compile (fix round one) | type | type | let every service through the overload refusal: R16 red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R17. `fails` names only a method `impl` gives, a `Fails<S>` value included, and `impl` names only the service's own members, read through `layer`'s key type argument (fix rounds one and two) | type | type | type `fails` as `Fails<S>` again: R17 red in a typecheck | next/packages/vitest/src/Recorder.types.test.ts |
| R18. In the inferred call as a law writes it, `impl` inline on `Shelf` with its symbol member, a `fails` entry `impl` leaves out and a misspelled `impl` key do not compile, and a valid `fails` entry does and fails as given (fix round two) | test | scenario: one inferred `Recorder.layer` call on `Shelf` each way | type `fails` as `Fails<S>` again: R18's `@ts-expect-error` goes unused, red in a typecheck | next/packages/vitest/src/Recorder.test.ts |

- R5, R6 and R7 draw `Moves`, a Schema of a list of `Shelf` calls, each a tagged pick with its
  args, so Effect's Arbitrary builds the inputs. `Branch` and `Inputs` are the Schemas those test
  files already draw from.
- R1 to R4 are red only in a typecheck. The tests step says so in its report, and the build runs
  the one `pnpm typecheck`.
- R12 and R13 rewrite existing laws. Each stays as strict as it is: every value the old law
  compared is still compared. The reviewer runs the loosening check.
- No law needs the real machine, so none is host-only. No law reads a secret, so no `[secrets]`
  flow is needed. No file here is a `*.integration.test.ts`.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/vitest/src/Recorder.ts | build | 120 | new: the types above, `layer`, `calls`, each with its doc block and `@stability unstable` |
| next/packages/vitest/src/index.ts | build | 1 | `export * as Recorder from "./Recorder.ts"`; the header comment names the Recorder |
| next/packages/vitest/package.json | build | 1 | the `description` names the Recorder; no dependency changes, since `effect` is already one |
| next/packages/vitest/src/Recorder.test.ts | tests | tests | R5 to R10, with the made-up `Shelf` service |
| next/packages/vitest/src/Recorder.types.test.ts | tests | tests | R1 to R4 |
| .agents/skills/lead/scripts/pr/PushesTest.ts | tests | tests | built on `Recorder.layer`; `Remote.calls` goes; `Failing` is `Recorder.Fails` |
| .agents/skills/lead/scripts/pr/Publish.test.ts | tests | tests | R12: each read of `remote.calls` becomes `Recorder.calls(Pushes)` inside the provide |
| .agents/skills/lead/scripts/pr/Queue.test.ts | tests | tests | R12: the same, and its `leak` keys become method names |
| next/packages/libfabrika/src/node/settings/Command.test.ts | tests | tests | R13: the hand-written `FileSystem` becomes `Recorder.layer` over `FileSystem.makeNoop`; `Counts` goes |
| .glossary/TERMS.md | build | docs | a `Recorder` row in "Shared names": the test package's test spy (Fowler, Meszaros), not `Recording`, the runtime service |
| .patterns/a-law-watches-calls-with-a-recorder.md | build | docs | new, with the write-pattern skill: how a law watches a call, with the Pushes example, and where a test layer builds on the Recorder |

- `next/packages/vitest` is the test primitives' own package, the part `fabrika/package-imports`
  names "test primitives", which may import none of our names, and `Recorder.ts` imports only
  `effect`. It is not libfabrika, so the libfabrika test in `next/AGENTS.md` does not apply.
- `Command.test.ts` is a libfabrika test, and `fabrika/package-imports` lets a libfabrika test name
  `@kampus/vitest`. The tooling folder resolves `@kampus/vitest` from the root's own dependencies
  (the root package file lists it as `workspace:*`).
- Open pull request [1301](https://github.com/kamp-us/tea-fabrika/pull/1301) (a draft) also adds an
  export line to `next/packages/vitest/src/index.ts` and edits its package file. Whichever lands
  second takes a one-line rebase. No other open pull request touches these files.

## Calls taken

- **The name `@kampus/vitest`,** 90%. See "The package's name".
- **The answer is not recorded,** 85%. 0579 rules method and args, `TestConsole` keeps no answer,
  and the law wrote the implementation.
- **`fails` is a record of error values, not a list of names,** 85%. A list cannot say what to
  raise. This changes 0579's sketch, which 0579 itself marks as a sketch whose shape this plan
  decides.
- **A call is a run,** 80%. See "The shape".
- **The record's key is `method`, not `_tag`,** 85%. 0579's words, `TestConsole`'s key, and 0214
  lets a shape that is not ours keep its own key.
- **The two proof sites are `PushesTest` and the settings command's law,** 85%. Every `vi.fn` with
  a `toHaveBeenCalled*` matcher on main stands in for either a plain function argument (the
  `transport/` laws), a platform object (the `cloudflare/` laws) or a service inside an
  integration law of the app, whose folder is busy and whose laws run only on the schedule (0536).
  None is a cold service site whose law runs on every pull request. `PushesTest` is the ruling's
  case exactly: a service of ours, a hand log of its calls and a failure switch per method.
  `Command.test.ts` is in `next/`, type-checked, run on every pull request, and on Effect's own
  `FileSystem`, which shows the Recorder on a service we did not write.
- **No `Recorder` form that wraps a service another layer builds,** 80%. The app's
  `door.integration.test.ts` wraps the real `ClientManager` to watch `write`. That needs the impl
  to come from an Effect, a second constructor. Its slice decides that form with a real call site
  in hand, rather than this plan guessing its shape.
- **Is this a setting?** No, for each choice. `fails`, the record's keys and the read forms are
  parts of a test helper's API, written in test code. Nothing a person running fabrika picks, so no
  `fabrika.toml` value (0069).
- **What fact is lost if not recorded now?** None. A call record lives only inside one test run and
  is never stored. The answer can be added to the record later with nothing lost, since every
  run records it fresh.

## Validation

- The tests step: `pnpm format`, then `pnpm lint`, then
  `nice -n 15 pnpm exec vitest run --maxWorkers=3` on `next/packages/vitest/src/Recorder.test.ts`,
  `.agents/skills/lead/scripts/pr/Publish.test.ts`, `.agents/skills/lead/scripts/pr/Queue.test.ts`
  and `next/packages/libfabrika/src/node/settings/Command.test.ts`. Each plant above is run once and
  recorded in the step's report.
- The build: the same narrow paths. The lead runs the changed-files test run and the one type
  check, which reads R1 to R4 and the call sites' types.
- The tooling tests are not read by `tsc` (see the doubts), so their types are checked by review
  only. `Command.test.ts`'s are checked by the lead's one type check.

## Size

The Recorder and its two proof sites land as one pull request. Confidence in the line counts: 75%;
the doubt is the conditional types, which may need more helper types than sketched. The sweep after it is its own
quests, one per folder, listed below with counts, and each starts with its own plan. Counted on
main at `f7d973e4a` with `nice -n 19 rg --hidden -g '!node_modules' -o` over `next/`, `.agents/`,
the `oxlint-plugins` folder and the CI scripts, one match per call.

1. The Recorder and its proof sites, this plan: about 122 product lines, about 300 test lines
   added and about 120 removed, about 60 lines of docs. 122 lines.

**The later slices, not in this pull request.** On main: 27 `vi.fn(` calls in 9 files, 27
`toHaveBeenCalled*` matches in 9 files, and 74 `vi.spyOn(` calls in 29 files (0579 counted 73 with
`rg -c`, which counts lines; one line holds two calls). By folder:

| Folder | `vi.fn` | `toHaveBeenCalled*` | `spyOn` | What it watches, and what it needs first |
|---|---|---|---|---|
| `libfabrika/src/transport` | 9 | 11 | 1 | `admit`, `consume` and `route` passed as plain functions to `checkHello` and `answerFrame`; 1 `crypto.subtle` spy. Needs a product change: those arguments become a service the law records. Slice 1 landed in #1526; slice 2 (the hello's admission, `Admissions`) is built in #1638. The folder's lock waits: its lint rule (L1) is not in that round |
| `libfabrika/src/cloudflare` | 8 | 0 | 15 | WebSocket and object-state doubles, which are platform fakes for this package (0554, 0557), not the Recorder; spies on `Effect.result` 3, `ProgramRunner.withLoader` 3, `SpanSink.layer` 3, `ProjectClient.make` 1, `Tracer.NativeSpan.prototype` 1, `console` 1, `process.stdout` and `process.stderr` 2, `crypto.subtle` 1 |
| `libfabrika/src/node` (the `RunnerAdmission` integration law) | 4 | 0 | 0 | platform namespace doubles; platform fakes, not the Recorder |
| `libfabrika/src/node/dev` | 0 | 2 | 15 | `fetch` 7, `process.kill` 6, `console` 2; all need a product change first |
| `libfabrika/src/node/client` | 0 | 0 | 3 | `console` 1, `process.stdout` and `process.stderr` 2; product change first |
| `libfabrika/src/node/repositories` | 0 | 0 | 1 | `SettingsSnapshot.make`, one of ours |
| `libfabrika/src` (top: `Id`, `Id.cause`, `check`) | 0 | 0 | 10 | `crypto.getRandomValues` 9, `check.run` 1 |
| `libfabrika/src/gateway`, `processes`, `telemetry` | 0 | 0 | 5 | `crypto.subtle` 4, `crypto.getRandomValues` 1 |
| `apps/fabrika/src` (with `exam/`) | 5 | 14 | 22 | `ClientManager.write` wrapped in `door.integration.test.ts` (needs the wrap form), `FileSystem.makeDirectory` in `file-services.laws.integration.test.ts` (the Recorder as built here); `crypto` 9, `fetch` 5, `console` 4, `childProcess.spawn` 2, `process.kill` 1, one stub's `getEntrypoint` 1 |
| `apps/fabrika/e2e` | 0 | 0 | 1 | `console` 1 |
| `programs/pipeline` | 0 | 0 | 1 | `console` 1 |
| the `oxlint-plugins` folder | 1 | 0 | 0 | an oxlint `report` callback, not a service: a plain list the rule test owns |

- **The ones that need a product change to a service first,** as 0555 and 0579 say: `fetch` 12
  (Effect's `FetchHttpClient.Fetch` reference exists and is the way), `process.kill` 7 and
  `process.stdout` or `process.stderr` 4, `console` 10 (Effect's `Console` service, whose own
  `TestConsole` already records), `crypto` 25 (`getRandomValues` 11 and `crypto.subtle` 14), and
  `childProcess.spawn` 2 (Effect's `ChildProcessSpawner`). That is 60 of the 74 spies. The other
  14 are on our own modules or on Effect, and each goes by testing what the code does or by a
  service, per file.
- **Hand-written call logs in test layers,** not counted by the brief but the same job, found while
  reading: `CodeHostTest.Control.calls` (read by `programs/pipeline`'s two runner suites),
  `PullRequestsTest`'s `calls`, `BrainControl.test-support.ts`, `MemoryFiles.test-support.ts`. Each
  can build on the Recorder in the slice of its folder.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the
reflect-ban plan priced them: a tests step about $6, a build about $5, a review about $3 and a fix
round about $4. This plan's tests step has four type laws and three generated laws, so $7; the
build has the proxy typing doubt, so $6; one likely send-back, $5.

Estimate: 4 steps, $21

## Records

- `.glossary/TERMS.md`: a `Recorder` row, in this pull request.
- `.patterns/a-law-watches-calls-with-a-recorder.md`: new, in this pull request, so the sweep's
  agents copy the shape from one place.
- No decision file. This plan builds 0579 and takes no new ruling of the owner's. The one place it
  moves from 0579's sketch (`fails` as a record) is inside what 0579 left to this plan.
- `field/`: one run row per step, the same day.
- The tracker ticket is 1067.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run. The first typecheck tells,
  starting with the conditional types and the `Proxy` handed to `Layer.mock`.
- **Whether recording at the run is right for every law the sweep meets.** A law that builds an
  Effect, hands it on and checks it was asked for, without running it, would see no call. None of
  the sites read for this plan does that.
- **Whether `call.args[0]` is a path for every `FileSystem` method** the settings law records. The
  tests step checks it against the installed interface.
- **The tooling proof's types.** `tsc` does not read `.agents/skills/lead/scripts/pr/` today.
- **The 14 spies on our own modules and on Effect.** Each was counted, not read; their slices say
  what each one really checks.
- **Whether Meszaros's book names the "Recording Test Stub".** Written from memory; the site
  refused the connection.

## Open questions

None.

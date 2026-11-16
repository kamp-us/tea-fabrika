
Plancheck-Version: 3

# Plan: the mock sweep in `next/programs/pipeline` (ticket 1067, a later slice of the Recorder plan)

This is `next/`, the pipeline program and the two scripted test layers it reads from libfabrika,
plus our lint config and its plant test. Today's app is not touched. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.mock`, `vi.doMock`, `vi.spyOn` or
`vi.stubEnv`, held by `vitest/no-restricted-vi-methods`) and
[0579](../../../.decisions/0579-property-laws-use-it-prop.md) (a `Recorder` is the one way to watch
calls), with the Recorder as it landed (`next/packages/vitest/src/Recorder.ts`) and the folder row of
[the Recorder plan's Size section](./recorder-PLAN.md#size): "`programs/pipeline`: 1 `spyOn` on
`console`", plus the hand-written call log `CodeHostTest.Control.calls` its two runner suites read.

```ts
// The whole idea, a sketch, not compiled.
// Before: QueueRunnerTest.ts:424, the S2 secrets law spies on the global console.
vi.spyOn(console, method).mockImplementation((...args) => { logs.push(text(args)); });
expect(h.host.calls().filter((c) => c.method === "merge").map((c) => c.change)).toEqual([1, 2, 3]);

// After: Effect's own TestConsole stands in for the Console reference, and the Recorder keeps
// the code host's calls, typed to CodeHost's own parameters.
Effect.provide(Layer.mergeAll(Logger.layer([logger]), TestConsole.layer));
const lines = [...(yield* TestConsole.logLines), ...(yield* TestConsole.errorLines)];
expect((yield* h.host.calls("merge")).map(([change]) => change)).toEqual([1, 2, 3]);
```

## Doubts, read these first

- **Whether `TestConsole` watches every channel the spy watched (75%).** The spy caught five
  methods of the global `console`. `TestConsole` (effect 4.1.3,
  `node_modules/effect/src/testing/TestConsole.ts`) keeps an entry for every method, but reads back
  only `log` (`logLines`) and `error` (`errorLines`). Effect's own loggers write only through those
  two (`Logger.withConsoleLog` and `withConsoleError` in `node_modules/effect/src/Logger.ts`, and the
  default logger in `internal/effect.ts`, which picks `console.log` or `console.error`), and no
  product file under `next/packages/libfabrika/src` or `next/programs/pipeline/src` calls `console.*`
  (`rg` on main, tests and test layers left out). So every write the run makes today is in those two
  lines. What it misses: a future `Console.warn` in product code on the queue path, and
  `@demlik/tea`'s own direct `console.warn` calls (in `contained`, a run listener's guard, and in
  `fromTransport`'s close), which reach the global object, never the Console reference. What
  settles it: the tests step greps that the merger's and queue's code reach neither tea part, and
  the open question below.
- **Whether `CodeHostTest.layer` can hand its stateful fake to `Recorder.layer` as it is (85%).**
  `Recorder.layer` takes the implementation as a value, while today's fake makes its state inside
  `Layer.effectContext(Effect.sync(...))`. The lean wraps the whole build in `Layer.unwrap`, the same
  way `Recorder.layer` itself is built (`Recorder.ts:217`), so no new Recorder form is needed. The
  Recorder plan left a "wrap a service another layer builds" form to the slice that meets one; this
  is not one, since the fake's value is in hand inside `Layer.unwrap`.

## What changes, in one paragraph

The pipeline folder's one `vi.spyOn` goes: the S2 law in `QueueRunnerTest.ts` provides
`TestConsole.layer` beside its logger and reads `TestConsole.logLines` and `errorLines` into its
leak check, as the Recorder plan names for `console`. `CodeHostTest.layer` (libfabrika's scripted
code host, used by the pipeline's handler test and its two integration files) builds on
`Recorder.layer(CodeHost, host)`; its hand-written `Call` log and `Control.calls` go, and the two
runner suites (`RunnerTest.ts`, `QueueRunnerTest.ts`) read `h.host.calls("merge")`, which the
integration files answer with `Recorder.calls(CodeHost, method)`. Then the folder is at zero, and
`.oxlintrc.json` gets the first block of the mock ban: `vitest/no-restricted-vi-methods` at error for
`next/programs/pipeline/**`, with a plant law that every folder the block lists refuses each banned
call.

## Counted on main

At `f7169af`, with `nice -n 19 rg -n` over `next/programs/pipeline`, one match per call:

| Pattern | Matches | Where |
|---|---|---|
| `vi.fn(` | 0 | |
| `toHaveBeenCalled*` | 0 | |
| `vi.spyOn(` | 1 | `next/programs/pipeline/src/QueueRunnerTest.ts:424`, once per method of five (`log`, `info`, `warn`, `error`, `debug`) |
| `vi.mock(`, `vi.doMock(`, `vi.stubEnv(` | 0 | |
| hand call log read | 6 reads | `h.host.calls()` at `RunnerTest.ts:133,151,153` and `QueueRunnerTest.ts:294,360,366,379` (four in the queue suite); the log is `CodeHostTest.Control.calls`, `next/packages/libfabrika/src/codehost/CodeHostTest.ts:49` |

Not a call log, and kept: `CiTest.Control.starts` (`next/packages/libfabrika/src/ci/CiTest.ts:35`),
read at `QueueRunnerTest.ts:349,358,367`. It is the fake CI's state, the commits whose start the CI
took: it is written after a scripted fault passes, so a refused start is not in it. A Recorder
records every run, refused ones too, so swapping it in would change what those laws assert. It
stays the fake's own state (0538). Call: 80%.

## How others do it

- **Effect's own fake console.** `TestConsole.layer` provides the `Console` reference and pushes
  `{ method, parameters }` per call; a law reads `TestConsole.logLines` and `errorLines`. The
  Recorder plan names it as the way for `console`. Effect's docs on the `Console` reference
  (`node_modules/effect/src/Console.ts`) say a test provides it "rather than the default console".
- **The Recorder** is a test spy in Fowler's and Meszaros's words, built for exactly this:
  `.patterns/a-law-watches-calls-with-a-recorder.md` says a test layer that kept its own call log
  builds on it, and that a stateful fake stays in its service's test layer and the Recorder wraps
  it, as `PushesTest.ts` does.
- **The lint rule.** `vitest/no-restricted-vi-methods` is oxlint's own (installed 1.90.0), named by
  0555 and by [0563](../../../.decisions/0563-anti-slop-plugin-as-it-ships.md), which says the
  anti-slop plugin's `no-module-mocking` reads only `mock`, `doMock` and `unstable_mockModule`, so
  `spyOn` and `stubEnv` need this rule either way. A scratch run here (a temp folder with its own
  config, 2026-11-15) refused `vi.spyOn`, `v.spyOn` after `import { vi as v }`, `vi["spyOn"]` and
  `vi.fn`, and missed `V.vi.spyOn` after `import * as V from "vitest"` and
  `const { spyOn } = vi`. L1 below plants each of these, so the rule's real reach is on record.
- **How a ban is turned on one folder at a time here:** the Reflect ban's blocks in
  `.oxlintrc.json` (one `files` list per block, a folder added when it reaches zero) and its plant
  law in `oxlint-plugins/plants.test.ts` ("L1 of the Reflect ban"), which reads the config with
  oxlint's `--print-config` and plants the lines in every folder a block lists. This plan copies
  that shape.

## The shape

A sketch, not compiled. Names are effect 4.1.3's and the Recorder's on main.

### `CodeHostTest.layer` builds on the Recorder

```ts
// next/packages/libfabrika/src/codehost/CodeHostTest.ts
import { Recorder } from "@kampus/vitest";

export type Method = Recorder.Method<CodeHost["Service"]>; // "change" | "update" | "merge", as before
// `Call` goes: the Recorder's `Recorder.Call<CodeHost["Service"]>` is the record now.

export class Control extends Context.Service<
  Control,
  {
    readonly put: (change: ChangeData) => Effect.Effect<void>;
    readonly main: (head: typeof Commit.Type) => Effect.Effect<void>;
    readonly fail: (method: Method, fault: Fault) => Effect.Effect<void>;
    readonly crashMerge: Effect.Effect<void>;
    readonly read: (change: number) => Effect.Effect<ChangeData | undefined>;
    // `calls` goes.
  }
>()("@kampus/libfabrika/codehost/CodeHostTest.Control") {}

export const layer = (
  options: { readonly token?: Redacted.Redacted<string> } = {},
): Layer.Layer<CodeHost | Control | Recorder.Recorded<CodeHost>> =>
  Layer.unwrap(
    Effect.sync(() => {
      // ... the same state as today, less `calls`
      const failure = (method: Method) =>
        Effect.suspend(() => {
          const fault = faults[method].shift();
          // ... the same three fault cases as today
          return Effect.void;
        });
      const host = CodeHost.of({
        change: (change) => failure("change").pipe(Effect.andThen(/* as today */)),
        update: (change, head) => failure("update").pipe(Effect.andThen(/* as today */)),
        merge: (change, head) => failure("merge").pipe(Effect.andThen(/* as today */)),
      });
      return Layer.merge(Recorder.layer(CodeHost, host), Layer.succeed(Control, { put, main, fail, crashMerge, read }));
    }),
  );
```

- The scripted faults stay in the fake, not in the Recorder's `fails`: a fault here is a queue of
  one-shot answers (a typed failure, a defect or an interrupt, each used once), and `fails` fails
  every call of a method with one value. 0538 keeps that state beside the service. Call: 90%.
- The record is the same as today's, one per run, written before the fault: the Recorder records at
  the start of the run (`Recorder.ts`, law R8), and today's `failure` pushed first, inside the same
  `Effect.suspend`. A crashed merge (`crashMerge`, interrupted after it merged) is recorded, as now.
  Today's `{ method, change, head? }` becomes `{ method, args: [change, head] }`, and `change`'s
  record now carries no head, as before.
- `suite(testLayer: Layer.Layer<CodeHost | Control>)` keeps its type: a `Layer`'s output is
  contravariant (`Layer<in ROut, ...>`, `node_modules/effect/src/Layer.ts:56`), so the wider layer
  fits it. `handlers.test.ts` merges the layer as before.

### The runner suites read the Recorder through their `World`

```ts
// next/programs/pipeline/src/RunnerTest.ts and QueueRunnerTest.ts, in World.host
import type { CodeHost } from "@kampus/libfabrika/codehost/CodeHost";
import type { Recorder } from "@kampus/vitest";

type Host = CodeHost["Service"];
readonly calls: <M extends Recorder.Method<Host>>(method: M) => Effect.Effect<ReadonlyArray<Recorder.Args<Host, M>>>;

// RunnerTest.ts:133, before and after
expect(h.host.calls().filter((c) => c.method === "merge")).toHaveLength(1);
expect(yield* h.host.calls("merge")).toHaveLength(1);

// QueueRunnerTest.ts:360
expect(h.host.calls().filter((c) => c.method === "merge" && c.change === 2)).toEqual([]);
expect((yield* h.host.calls("merge")).filter(([change]) => change === 2)).toEqual([]);
```

```ts
// next/programs/pipeline/src/node/runner.laws.integration.test.ts and queue.laws.integration.test.ts
// `services` is the built context, which now holds Recorded<CodeHost> too.
host: { ...host, calls: (method) => Effect.provideContext(Recorder.calls(CodeHost, method), services) },
```

The suites keep their own words: a `World` is the caller's, and it names no libfabrika value, only
the `CodeHost` type, which the pipeline package already depends on.

### The S2 law reads `TestConsole`

```ts
// next/programs/pipeline/src/QueueRunnerTest.ts, S2. The five spies and their acquireRelease go.
yield* Effect.gen(function* () {
  const h = yield* driver.open(Redacted.make(value.text));
  const inspect = Effect.gen(function* () {
    const s = yield* h.snapshot;
    const printed = [...(yield* TestConsole.logLines), ...(yield* TestConsole.errorLines)];
    driver.unleaked(
      [/* the same records as today */, ...capture.text(), ...logs, ...printed.map(line)],
      [value.text, value.token],
    );
    return s;
  });
  // ... unchanged
}).pipe(
  Effect.withTracer(capture.tracer),
  Effect.provide(Layer.merge(Logger.layer([logger]), TestConsole.layer)),
);
```

`line` is today's own text of one argument, `${String(arg)} ${JSON.stringify(arg)}`, kept so the law
checks the same text it checks now. `TestConsole.layer` is provided at the very place the logger is,
so it reaches every fiber the logger reaches; the law already relies on that place.

### The lock

```jsonc
// .oxlintrc.json, a new block in "overrides", after the Reflect blocks
{
  // The mock ban (0555, 0579): a folder joins this list when it has no vi mock, spy, stub or fn.
  "files": ["next/programs/pipeline/**"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and watch it with Recorder.layer from @kampus/vitest (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555).",
        "fn": "Watch the call with Recorder.layer from @kampus/vitest (0579)."
      }
    ]
  }
}
```

- `fn` is in the list: 0579 says the Recorder replaces "the `vi.fn` plus `toHaveBeenCalled*`
  uses", and [0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md) says a mechanism
  the test package does not export is not used. The folder has none. Call: 85%.
- The block is at error, never warn ([0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)),
  and lists no file to let through. Later folders append their glob to this block.
- `oxlint-plugins/builtin-plants.ts:699` plants `vi.mock("./b.ts")` for `vitest/hoisted-apis-on-top`
  in the `oxlint-plugins` folder, which this block does not reach, so that plant stays as it is (0555 named
  it for when the rule reaches its path).

## One value traced: the queue lands three changes

1. `queue.laws.integration.test.ts`'s `open` builds `CodeHostTest.layer()` and `CiTest.layer()`.
   `Layer.unwrap` makes the fake's state, and `Recorder.layer(CodeHost, host)` makes an empty record
   and puts `CodeHost` (watched) and `Recorded<CodeHost>` in `services`.
2. The file wraps `CodeHost.merge` for its gap law and calls the watched `rawHost.merge`, so a merge
   is recorded once.
3. The law enqueues changes 1 to 3. The merger runs `host.merge(1, head1)`: on run the Recorder
   appends `{ method: "merge", args: [1, head1] }`, then runs the fake's `failure("merge")`, which
   finds no fault and merges. The same for 2 and 3.
4. The suite runs `yield* h.host.calls("merge")`, which the file answers with
   `Recorder.calls(CodeHost, "merge")` provided `services`: `[[1, head1], [2, head2], [3, head3]]`,
   typed `ReadonlyArray<readonly [change: ChangeId, head: Commit]>`.
5. `.map(([change]) => change)` is `[1, 2, 3]`, as the law asserts today.
6. A typo, `h.host.calls("mrege")`, does not compile.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1. Every folder the mock ban block lists refuses `vi.spyOn`, `vi.mock`, `vi.doMock`, `vi.stubEnv` and `vi.fn`, also after `import { vi as v }` and as `vi["spyOn"]`, and the record of what it misses (`V.vi.spyOn` after a namespace import, `const { spyOn } = vi`) stays exactly as the rule does today | lint | scenario: the repo's own config read by `--print-config`, and one planted file per listed glob, as the Reflect ban's L1 | delete `next/programs/pipeline/**` from the block: its planted file is not refused, L1 red | oxlint-plugins/plants.test.ts, oxlint-plugins/builtin-plants.ts |
| L2. No `vi.*` mock, spy, stub or fn in `next/programs/pipeline` | lint | lint | put back `vi.spyOn(console, "log")` in `QueueRunnerTest.ts`: `vitest/no-restricted-vi-methods` red | next/programs/pipeline/src/QueueRunnerTest.ts |
| L3. S2 keeps its bound: a secret in a scripted fault reaches no letter, saved row, model, view, span, logger line or console line, with the same run count and seed | test | Effect Arbitrary: tapes | make a pipeline handler write the fault's cause with `Console.error`: S2 red. Default runs | next/programs/pipeline/src/QueueRunnerTest.ts |
| L4. S2's console check reads what the console got: a planted `Console.log` of the secret inside the run turns it red, as the spy did | test | Effect Arbitrary: tapes | drop `TestConsole.layer` from the provide, so the planted line goes to the global console unseen: L4 red | next/programs/pipeline/src/QueueRunnerTest.ts |
| L5. The runner suites keep their merge counts: R2 one merge, R3 one merge before the retry and two after, Q1 merges 1, 2, 3 in order, QR2 no merge of change 2, QR3 at least three updates of change 2 | test | scenario: the suites' own scripted walks, unchanged | hand `Recorder.layer` a host whose `merge` is put back to the raw fake after the wrap, so merges go unrecorded: R2, R3 and Q1 red | next/programs/pipeline/src/RunnerTest.ts, next/programs/pipeline/src/QueueRunnerTest.ts |
| L6. The code host contract C1 and the handler fault law still hold on the watched fake | test | fc.commands: C1's own commands, seed 119120, 100 runs | make the fake's `failure` skip its fault queue: the handler fault law red. Default runs | next/packages/libfabrika/src/codehost/CodeHost.test.ts, next/programs/pipeline/src/handlers.test.ts |
| L7. `h.host.calls` takes only a method of `CodeHost` and answers its own args | type | type | widen `calls`' parameter to `string`: a `@ts-expect-error` on `calls("mrege")` goes unused, red in a typecheck | next/programs/pipeline/src/RunnerTest.ts |

- L3 and L5 rewrite existing laws. Every value the old law compared is still compared: the same
  merge counts and the same secret outputs. The reviewer runs the loosening check.
- L4 is new: it proves the swap watches what the spy watched, for the channel Effect writes.
- L5 and L3 run inside `*.integration.test.ts` files (0536), as they do today: they need real SQLite
  stores and real runners, which no stand-in gives. The tests step runs both integration files in
  its box, which step rules allow.
- No law needs the real machine, so none is host-only. The `[secrets]` law S2 keeps its own flows:
  `value.text` and `value.token` go into faults through `CodeHostTest.layer({ token })` and
  `CiTest.layer`, and the plant puts a secret into the console channel.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/codehost/CodeHostTest.ts | tests | tests | built on `Recorder.layer` inside `Layer.unwrap`; `Call` and `Control.calls` go; `Method` is `Recorder.Method<CodeHost["Service"]>` |
| next/programs/pipeline/src/RunnerTest.ts | tests | tests | `World.host.calls` takes a method and answers an Effect; three reads move; L7 |
| next/programs/pipeline/src/QueueRunnerTest.ts | tests | tests | the same for four reads; S2 drops `vi` and its five spies for `TestConsole`; L4 |
| next/programs/pipeline/src/node/runner.laws.integration.test.ts | tests | tests | `host.calls` answered with `Recorder.calls(CodeHost, method)` provided `services` |
| next/programs/pipeline/src/node/queue.laws.integration.test.ts | tests | tests | the same |
| .oxlintrc.json | tests | tests | the mock ban's first block, for `next/programs/pipeline/**` |
| oxlint-plugins/builtin-plants.ts | tests | tests | `VI_METHODS`, the planted lines L1 runs, each with `true` or `false` |
| oxlint-plugins/plants.test.ts | tests | tests | L1, beside the Reflect ban's L1, reading the block by its rule |
| next/packages/libfabrika/src/codehost/CodeHost.test.ts | tests | tests | unchanged; run, since its contract suite takes the wider layer (L6) |
| next/programs/pipeline/src/handlers.test.ts | tests | tests | unchanged; run, since it merges the wider layer (L6) |
| next/packages/libfabrika/src/ci/CiTest.ts | tests | tests | unchanged: `starts` is the fake's state and stays |
| next/programs/pipeline/tsconfig.json | tests | tests | unchanged; the project the narrow type count reads |
| field/runs/2026-11-15-mock-pipeline-tests1.json | tests | docs | the tests step's run row |

- No product file changes, so the build step has nothing to make green unless the review sends
  work back; the tests step reports `build_needed: no` when lint is green.
- `CodeHostTest.ts` is a libfabrika test layer beside its service (0538), and libfabrika's other
  `*Test.ts` layers already import `@kampus/vitest` (`processes/ProgramMailTest.ts`), which
  `fabrika/package-imports` allows.
- Open pull requests on these files, each a one-line rebase for whichever lands second:
  [1408](https://github.com/kamp-us/tea-fabrika/pull/1408) (`QueueRunnerTest.ts` and an
  `.oxlintrc.json` Reflect block), [1438](https://github.com/kamp-us/tea-fabrika/pull/1438) (both
  integration files), [1416](https://github.com/kamp-us/tea-fabrika/pull/1416) (`CodeHostTest.ts`,
  in `suite`, not the layer), and the `.oxlintrc.json` edits of
  [1373](https://github.com/kamp-us/tea-fabrika/pull/1373) and
  [1430](https://github.com/kamp-us/tea-fabrika/pull/1430). None of
  [1366](https://github.com/kamp-us/tea-fabrika/pull/1366)'s files is here.

## Calls taken

- **`TestConsole` for the console spy,** 75% (see the doubts). The Recorder plan names it; the
  Recorder itself cannot watch `Console`, whose members answer `void`, not an Effect.
- **The fake keeps its fault queue,** 90%. See "The shape".
- **`CiTest.Control.starts` stays,** 80%. It is state, not a call log.
- **`fn` joins the banned list,** 85%. 0579 and 0557.
- **The lock lands in this slice,** 95%. The brief says on when the folder reaches zero, and it does
  in this pull request.
- **Is this a setting?** No. The lint block, a test layer's type and a law's console stand-in are
  test and tooling code, nothing a person running fabrika picks (0069).
- **What fact is lost if not recorded now?** None. Call records live inside one test run.

## Validation

- The tests step: `pnpm format`, then `NODE_OPTIONS=--max-old-space-size=6144 pnpm lint`, then
  `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/codehost/CodeHost.test.ts`,
  `next/programs/pipeline/src/handlers.test.ts`, `oxlint-plugins/plants.test.ts`, and the two
  integration files `next/programs/pipeline/src/node/runner.laws.integration.test.ts` and
  `next/programs/pipeline/src/node/queue.laws.integration.test.ts`. Each plant above is run once and
  recorded in the run row.
- One narrow type count: `pnpm exec effect-tsgo diagnostics --format json --project
  next/programs/pipeline/tsconfig.json`, and the same for libfabrika, which read L7 and the new
  `World` types. The lead runs the one full type check.

## Size

One pull request: the swap and the lock land together, since the lock is red until the spy goes.
Confidence in the line counts: 80%; the doubt is how many lines the `World` type change moves in the
two integration files.

1. The pipeline folder's mock sweep and its lock: 0 product lines, about 60 test lines changed in
   five test files, about 40 lines of lint config and plants. 0 lines.

Priced from `field/runs/` rows of 2026-11-15 at list price, as the Recorder plan priced them: a tests
step about $6, a review about $3, a fix round about $4. No build step is expected.

Estimate: 3 steps, $13

## Records

- No decision file. This plan builds 0555 and 0579 and takes no new ruling.
- `.patterns/a-law-watches-calls-with-a-recorder.md` gains one line in the tests step's pull
  request: a test layer with a scripted fault queue keeps the queue and hands its fake to the
  Recorder, `CodeHostTest.ts` as the example. Owner: tests, as a docs line beside the change.
- `field/`: one run row per step, the same day.

## What this cannot tell us

- **Whether any block compiles.** None was compiled; the tests step's type count tells.
- **Whether tea's direct `console.warn` is reached by S2.** Read, not run: its sites are a run
  listener's guard and a transport's close, which the merger and queue machines do not appear to
  use. The open question below is about it.
- **The lock's reach beyond what L1 plants.** A `vi` reached through a namespace import or a
  destructure is not refused by the rule today (scratch run, 2026-11-15). No file in the folder does
  either; a later slice that meets one names it.

## Open questions

- **Tea's own `console.warn`.** `@demlik/tea` 0.25.0 writes to the global `console` in two guards
  (a run listener that threw, a transport that failed to close), past Effect's `Console` reference.
  With the spy gone, S2 no longer sees those lines. Lean: accept it for this slice, since the
  pipeline's machines reach neither guard, and leave tea as it is (tea stays small). The other way:
  a local `pnpm patch` that routes tea's warnings through a hook a host sets, and an upstream issue.
  Only the owner can choose to change what tea writes. Lean: accept, 70%.


Plancheck-Version: 3

# Plan: the mock sweep in `next/apps/fabrika/e2e`: the build prints Rolldown's warnings through Effect's `Console`, law L17 reads them with `TestConsole`, and lint refuses `vi` mocks in the folder (ticket 1067)

This is `next/` only. Today's app is not touched. It is one folder's slice of the mock sweep that
[the Recorder plan](./recorder-PLAN.md) lists under "Size" (its row: `apps/fabrika/e2e`, 0 `vi.fn`,
0 `toHaveBeenCalled*`, 1 `spyOn` on `console`). It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.mock`, `vi.doMock`, `vi.spyOn` or
`vi.stubEnv`; a call the law watches goes through a service) and
[0579](../../../.decisions/0579-property-laws-use-it-prop.md) (the Recorder is the one way to watch a
service's calls; `console` needs a product change to a service first).

```ts
// The whole idea. A sketch, not compiled.
// before, reload.visual.test.ts:289: the test framework swaps the global console's warn.
const warnings = yield* Effect.acquireRelease(
  Effect.sync(() => vi.spyOn(console, "warn").mockImplementation(() => {})),
  (spy) => Effect.sync(() => spy.mockRestore()),
);
yield* build({ root, entry /* ... */ });
const printed = warnings.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

// after: bundle.ts prints through Effect's Console service, and the law provides Effect's own
// recording Console.
yield* build({ root, entry /* ... */ });
const printed = (yield* TestConsole.warnLines).map(String).join("\n");
// ...the case runs under Effect.provide(TestConsole.layer)
```

## Doubts, read these first

- **Effect's `TestConsole` keeps `warn` calls but has no reader for them (85% that a local patch is
  the right fix).** Read in the installed effect 4.1.3
  (`node_modules/effect/src/testing/TestConsole.ts`): `make` records every method, `warn` included,
  as `{ method, parameters }`, but the service exposes only `logLines` and `errorLines`. So the law
  cannot read a warning without help. The lean is a small `pnpm patch` that adds `warnLines`, the
  same shape as `errorLines`, with its upstream issue filed the same day
  ([patch upstream locally](../../../docs/direction/patch-upstream-locally.md),
  [0054](../../../.decisions/0054-read-upstream-before-patching-it.md): the read proved the gap). The
  other ways and why not are under "How others do it". What would settle it: whether upstream
  already has a reader on its main branch, which this plan did not fetch; the tests step checks before
  it writes the patch, and if a release has it, the patch is that release's code, word for word.
- **The edited patch file may meet another pull request that edits `patches/effect@4.1.3.patch`
  (70% that none does).** No open pull request's title names it today. If one lands first, the tests step
  rebases the hunk onto it with `pnpm patch` again; nothing here depends on the other hunk.

## What changes, in one paragraph

The one spy in the folder watches `console.warn` while the real build runs, to prove that Rolldown's
warnings still name each unresolved import and each importer, relative to the root, and never print
an absolute path (law L17 of P15). Those warnings are printed by Rolldown's own default handler,
which calls the global `console.warn` (`rolldown/dist/shared/create-bundler-option-*.mjs`,
`defaultPrintLog`), so no service of ours sits in the path. The product change: `bundle.ts`'s
`onLog` stops handing the log back to Rolldown's handler and prints it itself, through Effect's
`Console` service, in Rolldown's own format. In a normal run that service is the global console, so
what a person sees in the terminal does not change. In the law, `TestConsole.layer` records it. Then
the spy goes, and lint refuses every `vi` mock in the folder from that day.

## The count

Counted on `origin/main` at `f7169af` with `nice -n 19 rg -n 'vi\.|toHaveBeenCalled|spyOn'
next/apps/fabrika/e2e`:

| Call | Count | Where | What it watches | What replaces it |
|---|---|---|---|---|
| `vi.spyOn` | 1 | `next/apps/fabrika/e2e/reload.visual.test.ts:290` | `console.warn`, while `build` and `fixtureBuild` run Rolldown in this process | `TestConsole.layer` and `TestConsole.warnLines`, after `bundle.ts` prints through `Console` |
| `vi.fn` | 0 | | | |
| `toHaveBeenCalled*` | 0 | | | |
| `vi.mock`, `vi.doMock`, `vi.stubEnv` | 0 | | | |

The file's `vi` import goes with the spy. The other `vi` word in the folder is none: the count above
is every match. None of these files is in pull request 1366's diff (read with `pull_request_read`,
`get_files`, all 57 files), so nothing waits for the after-1366 slice.

## How others do it

- **Effect's own recording fake is the known way for `Console`.** `effect/testing` ships
  `TestConsole` (installed 4.1.3): `TestConsole.layer` provides the `Console` reference
  (`Console.Console`, a `Context.Reference` whose default is the global console,
  `node_modules/effect/src/Console.ts:86`), and a law reads the lines back. Our own
  `next/packages/libfabrika/src/settings/Snapshot.test.ts:535` and
  `next/packages/libfabrika/src/node/settings/Command.test.ts:200` already do this with `logLines`
  and `errorLines`. The Recorder plan's row names it for every `console` spy.
- **Why not the Recorder here.** The Recorder watches members that answer an Effect or a Stream
  (`Watched` in `next/packages/vitest/src/Recorder.ts:30`). `Console`'s members answer `void`, so
  `Recorder.Method<Console>` is `never`. `TestConsole` is the same idea for this one service,
  made by Effect, and 0579's Recorder text names it as the model.
- **Why not print with `Console.error`.** It would let the law read `errorLines` with no patch, but
  it changes the level Rolldown gave, so a warning reads as an error. Refused.
- **Why not a hand-written `Console` in the law.** A `Layer.succeed(Console.Console, { ...,
  warn: push })` works, but it is a second way to spy, beside the Recorder and `TestConsole`, which
  0579 rules out ("our one way to watch calls"), and 0555 puts any new spy in the test package.
- **Why not `Effect.logWarning`.** [0024](../../../.decisions/0024-next-records-with-spans-and-log-lines.md)
  lets code log, and the log line would land on the `build.bundle` span. But `build.ts:428` says
  Rolldown's warnings can quote source, and a span is kept; a terminal line is not. Putting them on
  the record is a design call this slice does not need, so it stays out.
- **The lint rule exists in oxlint.** `vitest/no-restricted-vi-methods` is the rule 0555 names. Run
  here on oxlint 1.90.0 (the lockfile's) in the scratchpad: it refuses `vi.spyOn(...)`, a renamed
  import (`import { vi as v }`, then `v.spyOn`), and a computed `vi["spyOn"](...)`, each with the
  message the config gives. That answers 0555's "untested" doubt about a renamed import.

## The shape

### The product change, in `bundle.ts`

```ts
// next/packages/libfabrika/src/node/build/bundle.ts. A sketch, not compiled.
import { Cause, Console, Effect, Exit, Path } from "effect";

export const bundle = Effect.fn("build.bundle")(function* (input, plugins, options = {}) {
  // ...
  // The console the person sees, or a law's TestConsole. Its members are plain functions, so the
  // synchronous onLog can call them with no run of an Effect.
  const out = yield* Console.Console;
  const print = { warn: out.warn, info: out.info } as const;
  const config = {
    // ...
    // Rolldown notes each "use client" it drops; a bundle here has no server half. The rest is
    // printed here, through Console, as Rolldown's own handler prints it: plugin, place, message.
    onLog: (level: LogLevel, log: RolldownLog) => {
      if (log.code === "MODULE_LEVEL_DIRECTIVE" || level === "debug") {
        return;
      }
      const message = relativeMessage(log); // the replaceAll loop that is there today
      const file = log.loc?.file === undefined ? undefined : relative(log.loc.file);
      print[level](
        `${log.plugin === undefined ? "" : `(${log.plugin} plugin) `}` +
          `${log.loc === undefined || file === undefined ? "" : `${file} (${log.loc.line}:${log.loc.column}) `}` +
          message,
      );
    },
    // ...
  };
});
```

- **Levels.** Rolldown calls `onLog` with `"warn"`, `"info"` or `"debug"` (`LogLevel`). Its default
  `logLevel` is `"info"`, and this config sets none, so today a `"debug"` log is dropped by
  Rolldown's handler; the sketch drops it too. An `"error"` comes only when a handler is called with
  it, which this `onLog` no longer does. The build step checks `LogLevel`'s type in the installed
  Rolldown 1.2.13 and writes `print` so a level it lacks does not compile.
- **The format** is Rolldown's `getExtendedLogMessage` (same file, read here): `(<plugin> plugin) `,
  then `<file> (<line>:<column>) `, then the message. The file is already relative, as today.
- **`Console.Console` is yieldable.** It is a `Context.Reference` in effect 4.1.3. If `yield*` on it
  does not type, `Console.consoleWith(Effect.succeed)` gives the same value; the build picks.
- **`buildPrograms`' compiler plugin** keeps its `onLog() { return false; }`. It drops logs before
  this `onLog` sees them, as today.

### The patch, `TestConsole.warnLines`

```ts
// node_modules/effect/src/testing/TestConsole.ts, through patches/effect@4.1.3.patch, with the same
// lines in dist/testing/TestConsole.js and .d.ts. A sketch, the shape of errorLines.
export interface TestConsole extends Console.Console {
  readonly logLines: Effect.Effect<ReadonlyArray<unknown>>;
  readonly errorLines: Effect.Effect<ReadonlyArray<unknown>>;
  /** The parameters of every `Console.warn` call, in order. */
  readonly warnLines: Effect.Effect<ReadonlyArray<unknown>>;
}

// in make:
const warnLines = Effect.sync(() => Array.flatMap(entries, (entry) => (entry.method === "warn" ? entry.parameters : [])));

export const warnLines: Effect.Effect<ReadonlyArray<unknown>, never, never> = testConsoleWith(
  (console) => console.warnLines,
);
```

`pnpm-workspace.yaml`'s `patchedDependencies` comment for `effect@4.1.3` gains one line naming the
new upstream issue. The lockfile's patch hash changes with it.

### Law L17, rewritten

```ts
// next/apps/fabrika/e2e/reload.visual.test.ts, L17's case. A sketch, not compiled.
scoped(
  Effect.gen(function* () {
    // ...the same temp home, root, entry and imported file as today
    yield* build({ root, entry, out: path.join(home, "out"), programs: [], files: [], ledger: [], chaos: false });
    const printed = (yield* TestConsole.warnLines).map(String).join("\n");
    // ...the same three checks as today
    const copy = yield* fixture;
    yield* fixtureBuild(copy, path.join(home, "instance-build"));
    const actual = (yield* TestConsole.warnLines).map(String).join("\n");
    // ...the same absolute-path check as today
  }).pipe(Effect.provide(TestConsole.layer)),
);
```

- Only the spy and its two reads change. The `fc.assert` runner, its seed and run count stay: moving
  this file's laws to `it.prop` is the property sweep's job (0579), not this one's.
- Each generated case provides its own `TestConsole.layer`, so a case reads only its own lines, as
  the spy, made per case, did.
- The spy's `mockImplementation(() => {})` kept the lines out of the test output; `TestConsole` does
  the same.

### The lock

```jsonc
// .oxlintrc.json, a new block after the Reflect ban's blocks. A sketch.
{
  // Decisions 0555 and 0579: no vi mock, spy, env stub or vi.fn in a law. A folder is listed whole
  // and joins the day its own slice of the mock sweep brings it to zero; none is ever taken off.
  "files": ["next/apps/fabrika/e2e/**"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it with the Recorder, or TestConsole for Console (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555).",
        "fn": "Record the service's calls with the Recorder (0579)."
      }
    ]
  }
}
```

No block sets the rule today (`rg no-restricted-vi-methods .oxlintrc.json` finds nothing), so this
block is the rule's first. It has the Reflect ban's shape (0554's blocks at `.oxlintrc.json:2315`):
each later mock-sweep slice adds its folder to `files`, and the last folds the list into the
`next/**/*` block. If another folder's slice lands first and makes the block, this slice adds its
line to it.

## One value traced: a warning, from Rolldown to the law

1. L17 writes `brain.ts` importing `p15-missing-abcd`, under `<home>/my folder/`.
2. `build` runs `bundle`, which reads `Console.Console`: the `TestConsole` the case provided.
3. Rolldown cannot resolve the import and calls `onLog("warn", { code: "UNRESOLVED_IMPORT",
   message: "Could not resolve 'p15-missing-abcd' in <home>/my folder/brain.ts", id, ... })`.
4. `onLog` replaces `<home>/my folder/brain.ts` with `brain.ts`, and calls
   `out.warn("Could not resolve 'p15-missing-abcd' in brain.ts")`.
5. `TestConsole` keeps `{ method: "warn", parameters: ["Could not resolve ..."] }`.
6. L17 reads `warnLines`, finds the specifier and `brain.ts`, and finds no form of `<home>`.

In a normal `pnpm dev`, step 2 reads the default `Console`, the global console, and step 4 prints
the same line as Rolldown printed it before.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1. `bundle` prints each Rolldown warning once through `Console.warn`, in Rolldown's format, with every file name relative to `cwd` and no form of an absolute path; a `MODULE_LEVEL_DIRECTIVE` log prints nothing; nothing goes to `log` or `error`. 20 runs fast, 100 full, through `runsFor` | test | Effect Arbitrary: WarningCase | print `log.message` before the relative replacement: L1 red; print through the global `console.warn`: L1 red, no line seen | next/packages/libfabrika/src/node/build/bundle-warnings.integration.test.ts |
| L2. L17, rewritten: the real build's warnings keep unresolved imports visible, name their importer relative to root, and print no absolute path, read from `TestConsole.warnLines` | test | fc.record: L17's own, unchanged (folder from fc.stringMatching, missing from fc.stringMatching), 3 runs fast and 10 full, as today | as L1's first plant: L2 red; and drop `Effect.provide(TestConsole.layer)`: L2 red, `warnLines` has no service | next/apps/fabrika/e2e/reload.visual.test.ts |
| L3. `TestConsole.warnLines` gives the parameters of every `Console.warn` call in order, and nothing from `log`, `error` or `info`; `logLines` and `errorLines` answer as before | test | fc.record: a list of calls, each a method from fc.constantFrom over warn, log, error and info, and parameters from fc.array of fc.string, 100 runs | filter `warnLines` on `"error"`: L3 red | scripts/effect-testconsole.test.ts |
| L4. In every folder the block lists, `vi.mock`, `vi.doMock`, `vi.spyOn`, `vi.stubEnv` and `vi.fn` are refused, through a renamed import and a computed key too, and `vi.hoisted` passes | lint | lint | delete the block's one `files` entry: L4 red for that folder | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| L5. The folder has no `vi.` call and no disable line for the rule | lint | lint | put the old spy back: `pnpm lint` red | .oxlintrc.json |

- **L1's input** is a Schema, so `it.effect.prop` draws it (0579). A sketch:
  `const WarningCase = Schema.Struct({ folder: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9 -]{1,24}$/)), missing: Schema.String.check(Schema.isPattern(/^[a-z]{4,16}$/)) })`,
  the same shapes L17 draws with fast-check. The tests step checks the check names in effect 4.1.3.
- **L1 is new,** because the product change is in the wrapper and L2 can only run on the schedule
  (a `.visual.` file). L1 is the wrapper's own law, the one place 0555 lets a law reach `rolldown`
  directly, so there is no stand-in: it is `.integration.`, like its four neighbors in that folder
  (0536, and `integration-test-name` counts a bundler as a real resource). It serves its files from a
  small plugin (`resolveId` and `load`), so it touches no disk, and it runs in a step's box. 0579
  makes a new property law `it.effect.prop` with Schemas; L1 is one.
- **L2 is host-only in practice:** it sits in a `.visual.` file, which a step's box never runs. It
  needs no launchd, no signal and no owner's Mac, so 0178's wait does not apply: the lead runs it on
  the laptop after the build, before the review, and CI's schedule runs it after merge.
- **L3 sits beside `scripts/effect-arbitrary.test.ts`,** the law of the patch already in that file,
  and follows that file's shape (plain `vitest`, `fast-check`, `Effect.runSync`), since the root has
  no `@effect/vitest` and `scripts/` is outside 0579's folders.
- **L4 has REFLECT's shape:** a `MOCKS` plant in `builtin-plants.ts`, and a scenario in
  `plants.test.ts` that writes its lines into a file under every glob of the block and runs the real
  config, as "REFLECT's lines are refused exactly" does at `plants.test.ts:532`. The existing
  `vitest(hoisted-apis-on-top)` plant writes `vi.mock` under a tooling path, which the block does not
  list, so it does not change.
- No law is loosened. L17's three checks stay word for word; only where it reads the lines changes.
  No law reads a secret.

## Files

The test files, the lint config, the plants, the patch and the lockfile are exam paths, so the
tests step owns them: the patch is test tooling, `TestConsole`'s reader. The build owns the product
change and the docs.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/node/build/bundle-warnings.integration.test.ts | tests | tests | new: L1 |
| next/apps/fabrika/e2e/reload.visual.test.ts | tests | tests | L2: the spy goes, `TestConsole` reads the lines; the `vi` import goes |
| scripts/effect-testconsole.test.ts | tests | tests | new: L3 |
| oxlint-plugins/builtin-plants.ts | tests | tests | L4: the `MOCKS` plant |
| oxlint-plugins/plants.test.ts | tests | tests | L4: the scenario over the block's folders |
| .oxlintrc.json | tests | configuration | L4, L5: the new block, with `next/apps/fabrika/e2e/**` |
| next/packages/libfabrika/src/node/build/bundle.ts | build | 18 | `onLog` prints through `Console`, in Rolldown's format |
| patches/effect@4.1.3.patch | tests | 20 | `warnLines` in `src/`, `dist/` and the `.d.ts`, through `pnpm patch` |
| pnpm-workspace.yaml | tests | 2 | the upstream issue's link beside the patch row |
| pnpm-lock.yaml | tests | lockfile | the patch hash, written by `pnpm patch-commit` |
| oxlint-plugins/README.md | tests | docs | a short section for the rule: the block, the probe's results above |
| next/AGENTS.md | build | docs | one row in "What lint holds": `vitest/no-restricted-vi-methods`, on per folder at zero |
| .patterns/a-law-watches-calls-with-a-recorder.md | build | docs | "Where it applies": `Console` is watched with `TestConsole`, since its members answer `void` |
| next/apps/fabrika/e2e/** | tests | tests | the folder the lock holds; no other file in it changes |
| next/apps/fabrika/e2e/ | tests | tests | the same folder, as the count names it |
| patches/effect | tests | tests | the patch's name as pnpm writes it; the one file above |
| scripts/effect-arbitrary.test.ts | tests | tests | read and run only: the law of the patch's other hunk, which must stay green |
| next/packages/libfabrika/src/settings/Snapshot.test.ts | tests | tests | read and run only: a `TestConsole` user, which must stay green |
| next/packages/libfabrika/src/node/settings/Command.test.ts | tests | tests | read and run only: a `TestConsole` user, which must stay green |
| docs/plan/quests/mock-app-e2e-PLAN.md | lead | docs | this plan |

## Steps

1. **Tests:** L1 to L5, the patch with `pnpm patch`, its row in `pnpm-workspace.yaml`, and the
   README section. L3, L4 and L5 are green at once. L1 and L2 are red until the build, since
   `bundle` still prints through Rolldown's handler. L2 is not run in the box. The tests step runs
   L1, L3, L4 and the lockfile's readers narrow, and says each plant's result in its run row.
2. **Build:** `bundle.ts` and the docs. Runs L1 green. The upstream issue, with the patch folded in
   (0060), is filed by the lead, since it is outside this repo; the lead adds its link
   to `pnpm-workspace.yaml` in the same pull request.
3. **The lead runs L2** on the laptop, before the review.
4. **Review:** one review of the whole diff.

## Calls taken

- **Patch `TestConsole` with `warnLines`,** 85% (see the doubts).
- **`vi.fn` is in the lock,** 80%. 0555 names four methods; 0579 makes the Recorder replace "the
  `vi.fn` plus `toHaveBeenCalled*` uses", so its principle covers `vi.fn` too. `vi.hoisted` and
  `vi.importActual` stay unset, as 0555 leaves them open.
- **`bundle.ts` drops `"debug"` itself,** 85%: that is what Rolldown's handler does today at its
  default level, so nothing a person sees changes. Is it a setting? No: a log level for Rolldown is
  not a choice anyone makes today, and the config sets none (0069).
- **L1 is new and `.integration.`,** 90%, for the reasons under "Laws".
- **The lock's block is the rule's first, scoped to this folder,** 90%, the Reflect ban's shape.
- **Not the property sweep:** L17 keeps `fc.assert` and its seed, 95%. Mixing the two sweeps in one
  diff makes each harder to review, and 0579 orders its own sweep.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3` on L1's, L3's and the plants' files;
  `pnpm lint` with `NODE_OPTIONS=--max-old-space-size=6144`.
- Tests step, too: `scripts/effect-arbitrary.test.ts`,
  `next/packages/libfabrika/src/settings/Snapshot.test.ts` and
  `next/packages/libfabrika/src/node/settings/Command.test.ts`, the readers of the patched
  package, since the lockfile makes a changed-files run the full suite.
- Build: L1's file.
- The lead: L2 on the laptop, and the one whole typecheck.

## Size

One pull request, about 40 product lines. Confidence in the count: 80%; the doubt is the patch's
`dist/` and `.d.ts` hunks, which may be longer than the `src/` one.

1. The mock sweep in `next/apps/fabrika/e2e`: the patch, `bundle.ts`, five laws, the lock. 40 lines.

Priced from `field/runs/` for 2026-11-13 to 2026-11-15 at list price, as the Recorder plan priced
them: a tests step about $6 here (five laws and the patch), a build about $3 (18 lines and docs), a review about $3, and one likely send-back $4.

Estimate: 4 steps, $16

## Records

- No decision file: this plan builds 0555 and 0579 and takes no new ruling.
- `.patterns/a-law-watches-calls-with-a-recorder.md`: one line, by the build.
- No glossary row: no new word. `TestConsole` is Effect's name.
- `field/`: one run row per step, the same day. This plan step's row is
  `field/runs/2026-11-15-mock-app-e2e-plan.json`.
- The tracker ticket is 1067, the Recorder's, whose "Size" lists this slice.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run. The first typecheck tells, starting
  with `yield* Console.Console` and the `print[level]` lookup.
- **Whether upstream Effect already has a warn reader** on its main branch. Not fetched.
- **Whether Rolldown ever calls `onLog` with an `"error"` level** in 1.2.13. Read from its handler
  and its `LogLevel` type, not from a run.
- **Whether L2 passes after the change.** It runs only on the laptop and on the schedule.
- **What other folders' slices plan for the same block.** Their plans are written beside this one;
  whichever lands first makes the block.

## Open questions

None.

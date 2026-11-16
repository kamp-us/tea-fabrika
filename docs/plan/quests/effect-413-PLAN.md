Approved by the lead agent, builds 0054, 0567, 0565, 0069; body 576f3b374bdc
Plancheck-Version: 3
# Plan: effect goes from 4.1.2 to 4.1.3, so `isAnyOf` refuses a tag the union does not have

`next/` and our tooling, and today's version too, because all three share one catalog. Every path
below was read on `origin/main` at `a31798b20`. The ticket is not filed yet.

```ts
// The whole idea. ExitReason is a real union in next/ (processes/ExitReason.ts).
const stopped = ExitReason.isAnyOf(["normal", "shutdown"]); // fine on both versions
const wrong = ExitReason.isAnyOf(["typo"]);
// effect 4.1.2: compiles, and `wrong` answers false for every value, forever.
// effect 4.1.3: a type error. "typo" is not one of normal, shutdown, kill, crashed.
```

## The answer

- **The claim is true.** On the installed 4.1.2, `isAnyOf` takes any key at all. 4.1.3 bounds the
  key by the union's own tags. Lines are under "What I read".
- **Seven packages move to 4.1.3 together,** in one pull request: `effect`, `@effect/platform-node`,
  `@effect/platform-node-shared`, `@effect/platform-browser`, `@effect/vitest`,
  `@effect/opentelemetry`, and `@effect/sql-d1` (new override, see calls).
- **Our one Effect patch is carried, not deleted.** 4.1.3 does not hold its fix. The file is renamed
  to the new version and its bytes do not change.
- **The checker `@effect/tsgo` stays at 0.63.0.** It names no Effect version, and a bump of it
  belongs to decision 0565.
- **No product file changes.** Every file in this change is an exam path, so the tests step writes
  all of it, and there is no build step unless 4.1.3 breaks product code (see calls).
- **One new law:** a type law that `isAnyOf` with a tag the union lacks does not compile.

## Doubts first

Nothing here is under 80%. The two things only an install can prove are in "What this cannot tell
us": whether pnpm's own patch tool applies the carried patch, and whether the whole repo type-checks
on 4.1.3.

## What I read

All of this is in the repo the installed package manifest names in `repository`,
`Effect-TS/effect`.

- **Installed 4.1.2, the bug.** `node_modules/effect/src/Schema.ts`:
  - lines 6385 to 6387, the type of a union made by `Schema.toTaggedUnion`:
    `readonly isAnyOf: <const Keys>(keys: ReadonlyArray<Keys>) => ...`. `Keys` has no bound.
  - lines 6543 to 6545, the type of `Schema.TaggedUnion`: the same unbounded `<const Keys>`.
  - The built types say the same: `node_modules/effect/dist/Schema.d.ts`, lines 5211 and 5303.
  - Line 6451 is the code: `keys.includes(value[tag])`. A wrong key is never equal, so it is
    always false.
- **Published 4.1.3, the fix.** I downloaded the published tarball to a scratch folder and read it;
  nothing was installed.
  - `src/Schema.ts` line 6425: `<const Keys extends Members[number]["Type"][Tag]>`.
  - `src/Schema.ts` line 6586: `<const Keys extends keyof Cases>`.
  - `dist/Schema.d.ts` lines 5251 and 5346 say the same.
  - On GitHub: [line 6425](https://github.com/Effect-TS/effect/blob/effect%404.1.3/packages/effect/src/Schema.ts#L6425)
    and [line 6586](https://github.com/Effect-TS/effect/blob/effect%404.1.3/packages/effect/src/Schema.ts#L6586).
- **The pull request,** [Effect 10355](https://github.com/Effect-TS/effect/pull/10355), merged
  2026-11-04 as commit `da0c792`. It changes two lines of `Schema.ts`, adds type tests, and no
  runtime code. Its body says what else stops compiling: a key outside the union, a wrapper typed
  `<K extends string>`, and a wide `string[]`. For a list only known at run time it says to write a
  plain boolean check: `(value: Shape): boolean => names.includes(value._tag)`.
- **We call `isAnyOf` nowhere today.** `rg isAnyOf` over the repo finds no file. 132 files use
  `Schema.TaggedUnion` (116 in `next/`, 13 in today's version, 3 in tooling). No file uses
  `Schema.toTaggedUnion`. So the fix breaks nothing we have; it guards what the cleanup will write.
- **The 4.1.3 release notes,** read whole: 74 changes in
  [effect 4.1.3](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.3), plus the notes of
  each sibling package. What touches code we have is in the next section.
- **Our patch.** `pnpm-workspace.yaml` patches `effect@4.1.2` for
  [Effect issue 10539](https://github.com/Effect-TS/effect/issues/10539): a Schema string builds
  its shrink candidates lazily. Upstream closed the issue on 2026-11-11 with commit `d021cee`,
  after 4.1.4 was published. I checked the source: `sampleFromShrink` in
  `src/internal/arbitrary/model.ts` is still the eager one in both 4.1.3 and 4.1.4.
- **The patch applies to 4.1.3.** `patch -p1 --dry-run` on the 4.1.3 tarball takes both hunks. The
  two patched files then match the installed patched 4.1.2 files byte for byte, so upstream did not
  touch them between the two versions.
- **Peers.** Each sibling at 4.1.3 asks for `effect ^4.1.3`. `@demlik/tea` 0.25.0 asks for
  `effect ~4.1.1`, Alchemy for `^4.1.0`, the `@distilled.cloud` packages for `^4.0.5`. All take
  4.1.3. `@effect/platform-node` 4.1.3 asks for `undici ^8.12.4` (was `^8.12.3`), so the lockfile's
  `undici` may move one patch.
- **Effect's packaged agent guide** (`AGENTS.md` inside the package) is the same file in 4.1.2 and
  4.1.3. Decision 0023's list of differences needs no change.
- **Effect's jsdocs tool,** which `oxlint-plugins/effect-jsdocs.ts` was ported from, has not changed
  since 2026-10-07. The port stays as it is.

## What else 4.1.3 changes in code we have

Only rows with a real call site. Everything else in the notes (CLI completions, cluster, workflows,
MCP protocol 2026-07-28, RPC, SQL drivers, CSV, XML, `Rational`, AG-UI) has no call site here.

| Change in 4.1.3 | Where we use it | What to expect |
|---|---|---|
| A span that succeeds keeps status Unset, not Ok ([10440](https://github.com/Effect-TS/effect/pull/10440)) | today's version: `packages/fabrika/src/shell/trace/otel.ts` line 178 writes `ok` or `unset` into a job's span rows | New rows say `unset` where they said `ok`. No reader branches on `ok`: each one only asks "is it `error`". See Records |
| `Schema.toEquivalence` derives from the decoded side ([10453](https://github.com/Effect-TS/effect/pull/10453)) | `next/`: `sameReason` in `processes/ExitReason.ts` | `ExitReason` has no transformed field, so the same answers. Its laws run in the narrow list |
| `ScopedCache` interrupts a waiting `get` when the owner scope closes ([10451](https://github.com/Effect-TS/effect/pull/10451), [10317](https://github.com/Effect-TS/effect/pull/10317)) | `next/`: `cloudflare/SettingsRuntime.ts` | A fix. Its test runs in the narrow list |
| `HttpServerRequest.stream` on a request with no body is empty, and a streamed body's scope closes later ([10506](https://github.com/Effect-TS/effect/pull/10506), [10366](https://github.com/Effect-TS/effect/pull/10366)) | `next/`: `cloudflare/platform.ts`, `cloudflare/ObjectService.ts` | A fix. Its test runs in the narrow list |
| `Effect.race` and `timeoutOption` no longer let a loser finish after the race settled ([10367](https://github.com/Effect-TS/effect/pull/10367)) | 19 files in `next/`, 5 lead scripts, 36 files in today's version | A fix. A test that leaned on the old leak would go red; CI's run tells |
| `TestClock` is rebuilt to start faster ([10326](https://github.com/Effect-TS/effect/pull/10326)) | 47 test files in `next/` | Same public behavior by its pull request. CI's run tells |
| `Scheduler.MaxOpsBeforeYield` 1 or 2 no longer hangs ([10463](https://github.com/Effect-TS/effect/pull/10463)) | `next/`: three integration tests set it to 3 as a workaround | Nothing breaks. The workaround can go later; not this plan |
| `SchemaRepresentation.fromJsonSchemaDocument` drops `contentSchema` notes that hold references ([10426](https://github.com/Effect-TS/effect/pull/10426)) | `next/`: the oracle in `settings/JsonSchema.test.ts` | Our settings schema has no `contentSchema`. Its test runs in the narrow list |
| Tool call parameters and results go through their JSON codec, and `Toolkit.handle` stops recording arguments on the span ([10332](https://github.com/Effect-TS/effect/pull/10332), [10362](https://github.com/Effect-TS/effect/pull/10362), [10304](https://github.com/Effect-TS/effect/pull/10304)) | today's version: `packages/pipeline/src/stages/build/report.ts`, one tool that returns a string | A string is JSON already. Its test runs on the laptop |
| `RcMap` idle time uses the clock of the context the map was made in ([10324](https://github.com/Effect-TS/effect/pull/10324)) | today's version: `apps/fabrika/src/host/agent-session.ts`, `packages/fabrika/src/program/refs.ts` | Neither sets an idle time I could find. No CI test covers today's version (0533) |
| `Match` handler maps and exhaustiveness ([10455](https://github.com/Effect-TS/effect/pull/10455)) | nowhere: no file calls `Match.` | Nothing |
| A struct field named like an `Object.prototype` member needs an own property ([9612](https://github.com/Effect-TS/effect/pull/9612)) | nowhere: no schema field is named `toString`, `valueOf` or `constructor` | Nothing |

Today's version is frozen and CI runs none of its tests
([0525](../../../.decisions/0525-todays-version-is-frozen.md),
[0533](../../../.decisions/0533-today-keeps-its-tests-off-ci.md)). It shares the catalog, so the
bump reaches it. CI still type-checks it. Its five tests that read the changed behavior run on the
laptop, listed under "Checks to run".

## How others do it

- **Effect releases every package at one version.** The release page shows `effect` and each
  `@effect/*` package tagged 4.1.3 within two minutes of each other on 2026-11-10, and each sibling
  asks for `effect ^4.1.3`. So the known way is to move the family together. Read on the
  [releases page](https://github.com/Effect-TS/effect/releases).
- **pnpm:** a catalog holds the shared version, `overrides` holds a transitive package to one
  version, and a `patchedDependencies` key names an exact version. An install fails loudly when a
  patch no longer applies. I read our own workspace file, which follows
  [pnpm's catalog and patch docs](https://pnpm.io/catalogs); I did not fetch the docs this turn.
- **Our own rule** ([patch upstream locally](../../direction/patch-upstream-locally.md)): the bump
  that takes the release with the fix deletes the patch. This release does not have the fix, so
  the patch stays, and the next bump past commit `d021cee` deletes it.
- **Reading before patching** ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md)):
  this plan adds no patch and changes none. It carries one whose read is in its own pull request
  (ticket 618).
- **Type tests for a library's types:** Effect's own pull request tests this fix in
  `packages/effect/typetest/schema/Union.tst.ts`. Ours is the same idea in the form
  [0527](../../../.decisions/0527-type-laws-get-a-type-label.md) decided: a `type:` law of
  `expectTypeOf` lines in a `*.types.test.ts` file, judged by CI's typecheck.

## The shape

The pins, after. Nothing else in the workspace file changes.

```yaml
# pnpm-workspace.yaml, after
catalog:
  '@effect/opentelemetry': 4.1.3
  '@effect/platform-browser': 4.1.3
  '@effect/platform-node': 4.1.3
  '@effect/tsgo': 0.63.0          # not moved
  '@effect/vitest': 4.1.3
  effect: 4.1.3
overrides:
  '@effect/platform-node-shared': 4.1.3
  # Alchemy asks for ^4.0.5. Held at effect's own version, as the line above is.
  '@effect/sql-d1': 4.1.3
patchedDependencies:
  # Effect-TS/effect#10539, fixed upstream after 4.1.4. Drop at the release that has it.
  effect@4.1.3: patches/effect@4.1.3.patch
```

The comment above `@opentelemetry/api` names `@effect/opentelemetry 4.1.2`; it becomes 4.1.3. Its
peer ranges are the same in both versions, so the OpenTelemetry pins stay.

The new law, as a sketch. The test writer settles the exact lines.

```ts
// A sketch: next/packages/libfabrika/src/processes/ExitReason.types.test.ts
import { expectTypeOf, it } from "@effect/vitest";
import type { ExitReason } from "./ExitReason.ts";

type Tag = (typeof ExitReason.Type)["_tag"];
type Keys = Parameters<typeof ExitReason.isAnyOf>[0];

it("type: isAnyOf takes only the union's own tags, so a misspelled tag does not compile", () => {
  // 4.1.2 gives ReadonlyArray<unknown> here, so both lines fail before the bump.
  expectTypeOf<Keys>().toEqualTypeOf<ReadonlyArray<Tag>>();
  expectTypeOf<readonly ["typo"]>().not.toExtend<Keys>();
  // The guard still narrows to the cases asked for.
  expectTypeOf<ReturnType<typeof ExitReason.isAnyOf<"normal" | "kill">>>().guards.toEqualTypeOf<
    Extract<typeof ExitReason.Type, { _tag: "normal" | "kill" }>
  >();
});
```

- It names `ExitReason`'s tags through `ExitReason.Type["_tag"]`, never as a written list, so a new
  exit reason does not break it.
- States: none. This change adds no stored value and no machine.
- New words: none. No glossary row.

## One value traced through

The call `ExitReason.isAnyOf(["typo"])`, where `ExitReason` has the cases `normal`, `shutdown`,
`kill` and `crashed`.

1. **4.1.2, the compiler.** `Keys` has no bound, so it is inferred as `"typo"`. The call
   type-checks. The guard's type is `Extract<ExitReason, { _tag: "typo" }>`, which is `never`.
2. **4.1.2, at run time.** `["typo"].includes(value._tag)` is false for every exit reason. The
   check silently never matches.
3. **4.1.3, the compiler.** `Keys` must extend `keyof Cases`, which is
   `"normal" | "shutdown" | "kill" | "crashed"`. `"typo"` does not, so the call is a type error and
   CI's typecheck fails the pull request.
4. **4.1.3, at run time.** The same code as before. Only the type moved.
5. **Our law.** `Parameters<typeof ExitReason.isAnyOf>[0]` is `ReadonlyArray<unknown>` on 4.1.2 and
   `ReadonlyArray<"normal" | "shutdown" | "kill" | "crashed">` on 4.1.3. The law asks for the
   second, so it is red until the bump and red again if a later version loosens the bound.

## Laws

| Law | Lint, type or test | Generator | Plant |
|---|---|---|---|
| L1. `isAnyOf` on a tagged union takes only that union's tags: a misspelled tag does not compile, and a right one still narrows | type | type | Run the typecheck on the law's file while effect is still 4.1.2, before the pins move: both assertions fail. The test writer keeps that red output for the review |
| L2. The carried patch is live on 4.1.3: a passing check builds no shrink candidates (the existing L1, L1b, L2 and L4 in `scripts/effect-arbitrary.test.ts`) | test | fc.integer: the seed, 10 runs, as the file has it | Remove the `effect@4.1.3` row from `patchedDependencies` and install: the existing L1 goes red. The lead runs it outside any box, as the file says |
| L3. The patch changes no generated case and no shrink path on 4.1.3 (the existing vector L3 in the same file) | test | vector: the 300 cases, their hash and the four shrink counts measured on stock and patched Effect | Replace the generated value with its first shrink, as the file says. If the pinned numbers move on 4.1.3 with no plant, stop and report: do not re-pin |
| L4. Our jsdocs rule fires on Effect's own source only where it did (law 8 in `oxlint-plugins/jsdocs.test.ts`), now on 4.1.3's 439 public files | test | vector: Effect's own source at the pin, which Effect's checker passes | Leave `number_of_files` at 432: red on 4.1.3. A new file in the fired map is a real difference from Effect's checker: stop and report, do not pin it |

- L1 is a type, since only the compiler can see it. No lint rule is added: a wrong tag is already a
  compile error once the bump lands.
- L4's re-pin changes two things: the file count (432 to 439) and the law's title (4.1.2 to
  4.1.3). The seven new files are `Rational.ts`, `ai/AgUi.ts`, `ai/AgUiSchema.ts`,
  `ai/AgUiServer.ts`, `cli/CommandSpec.ts`, `cluster/MessageRetention.ts` and `rpc/OpenRpc.ts`. Each
  opens with a module block that has `@since`, so I expect the fired map not to change. That is a
  read, not a run.
- `loosening.sh` may flag L4's changed numbers. It is the same law on the new pin, with numbers from
  a real run; the lead checks that by hand.
- No host-only law, no window, no screenshots, no secrets.

## Files

| File | Owner | Product lines expected | What changes |
|---|---|---|---|
| `pnpm-workspace.yaml` | tests | tests | Five catalog lines, one override moved, one override added, the patch key and path, one comment. About 10 lines |
| `pnpm-lock.yaml` | tests | tests | Rewritten by `pnpm install --lockfile-only`. About 350 lines, as the last bump was. In a box, the lead writes it by the lockfile ask |
| `patches/effect@4.1.3.patch` | tests | tests | `git mv` from the 4.1.2 name. Bytes unchanged |
| `patches/effect` | tests | tests | Not a file: the patch's name up to its version, as the format check reads it |
| `.github/ci/package.json` | tests | tests | Its exact `effect` line, 4.1.2 to 4.1.3 |
| `next/packages/libfabrika/src/processes/ExitReason.types.test.ts` | tests | tests | New: law L1. About 20 lines |
| `scripts/effect-arbitrary.test.ts` | tests | tests | Line 100's comment says 4.1.3, after L3 is measured unchanged. 1 line |
| `oxlint-plugins/jsdocs.test.ts` | tests | tests | Law 8's title and file count. About 3 lines |
| `oxlint-plugins/effect-jsdocs.ts` | tests | tests | None: read only. Its source upstream did not change |
| `oxlint-plugins/exact-versions.test.ts` | tests | tests | None: run only |
| `next/packages/libfabrika/src/processes/ExitReason.test.ts` | tests | tests | None: run only |
| `next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts` | tests | tests | None: run only |
| `next/packages/libfabrika/src/cloudflare/SettingsRuntime.test.ts` | tests | tests | None: run only |
| `next/packages/libfabrika/src/cloudflare/ObjectService.test.ts` | tests | tests | None: run only |
| `next/packages/libfabrika/src/settings/JsonSchema.test.ts` | tests | tests | None: run only |
| `next/packages/libfabrika/src/node/settings/Command.test.ts` | tests | tests | None: run only |
| `docs/plan/tier-1-detail.md` | lead | docs | Line 890 says the browser package is "at 4.1.2"; it becomes 4.1.3. 1 line |

Product lines: 0. No file under `next/`'s source, the lead scripts or today's version changes.

## Calls I took

The owner is away, so each is a call with how sure I am.

1. **Go to 4.1.3, not 4.1.4** (85%). The ticket names 4.1.3 and it holds the fix. 4.1.4 came out a
   day later with 10 changes; none is needed here, and it does not hold our patch's fix either. Its
   `TestClock` fix ([10520](https://github.com/Effect-TS/effect/pull/10520)) is for a bug 4.1.2
   already has, so 4.1.3 makes nothing worse. Cost: one more bump later.
2. **`@effect/sql-d1` gets an override at 4.1.3** (85%). We do not name it; Alchemy pulls it in at
   `^4.0.5`, and without an override pnpm keeps it at 4.1.2. Effect ships and tests the family at
   one version, and 4.1.3 changed the SQL client's types in `effect` and in each driver together
   ([10387](https://github.com/Effect-TS/effect/pull/10387)). The override sits beside the one for
   `@effect/platform-node-shared`, which exists for the same reason. Cost: one more line on every
   bump.
3. **The patch is carried under the new version's name** (95%). Proof above: 4.1.3 has the eager
   code, and the patch applies clean.
4. **`@effect/tsgo` does not move** (90%). It is a compiled checker with no peer on `effect`. Its
   newer versions add checks, and which checks are on is
   [0565](../../../.decisions/0565-effects-own-checks-block.md)'s work, one check at a time.
5. **No build step** (85%). Every file here is an exam path, so the tests step owns all of it and a
   builder would have nothing to write. If CI's typecheck or a narrow test shows product code that
   4.1.3 breaks, that is build work: the lead amends this plan with the files and starts a build
   step.
6. **The law lives beside `ExitReason`** (80%). A type law needs a type-checked folder, and
   `scripts/` is in no tsconfig. `ExitReason` is a real union the cleanup will use, so the law reads
   as a fact about our code, and `next/`'s own typecheck judges it.
7. **No new lint rule or lockfile check** (90%). The lead already reads the lockfile diff for exact,
   planned versions. A new check is a cost, and nothing has drifted yet.
8. **Is any of this a setting?** No ([0069](../../../.decisions/0069-choices-are-settings.md)). A
   dependency's version is already declared once, in the catalog. No person sets it at run time.

## Checks to run

A lockfile change makes `--changed` the whole suite, so nobody runs that on the laptop. CI runs the
full `next/` run and the typecheck. No file named `.integration.` or `.visual.` runs on the laptop.

The lead or the hand-run test writer runs these, in this order, after `pnpm install`:

```sh
pnpm format
pnpm lint
nice -n 15 pnpm exec vitest run --maxWorkers=3 \
  scripts/effect-arbitrary.test.ts \
  oxlint-plugins/jsdocs.test.ts \
  oxlint-plugins/exact-versions.test.ts \
  next/packages/libfabrika/src/processes/ExitReason.types.test.ts \
  next/packages/libfabrika/src/processes/ExitReason.test.ts \
  next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts \
  next/packages/libfabrika/src/cloudflare/SettingsRuntime.test.ts \
  next/packages/libfabrika/src/cloudflare/ObjectService.test.ts \
  next/packages/libfabrika/src/settings/JsonSchema.test.ts \
  next/packages/libfabrika/src/node/settings/Command.test.ts
```

Today's version, on the laptop only, since CI runs none of its tests (0533):

```sh
nice -n 15 pnpm exec vitest run --maxWorkers=3 \
  packages/fabrika/src/shell/trace/view.test.ts \
  packages/fabrika/src/shell/job-record.test.ts \
  packages/fabrika/src/agents/trace/heard.test.ts \
  packages/pipeline/src/tsh/trace.test.ts \
  packages/pipeline/src/stages/build/builder-acp.test.ts
```

Then the lead runs one `pnpm typecheck`, alone, after `pgrep -x tsgo` finds none. It is what judges
L1. With two or more code agents running, use `nice -n 19` and `--maxWorkers=1`.

The lead's read of the lockfile diff:

- Every changed `effect` and `@effect/*` line reads 4.1.3. None reads 4.1.4.
- `@effect/tsgo` and its seven platform packages stay 0.63.0.
- The `effect@4.1.3` patch hash is still `062265f7...`, since the patch's bytes did not change.
- Besides those, only `undici` may move, by one patch.

## Records

- **What this change records:** nothing new. It adds no entry, field or span.
- **What fact changes in records already kept:** in today's version, a job's span rows get their
  status from `toSpanRow`. From this bump on, an Effect span that succeeds is written `unset` where
  it was written `ok`. That is upstream's choice and OpenTelemetry's rule: a library leaves a
  successful span Unset. Nothing is lost, because Effect set Ok on every success, so `ok` never told
  more than "not an error". No reader branches on `ok`.
- **What would be lost if not written now:** the day the meaning changed. The pull request's body
  says it in one line: rows before this merge say `ok`, rows after say `unset`, and both mean "did
  not fail". Old rows are not rewritten.
- **The patch's reason stays recorded** at its `patchedDependencies` row, with the upstream issue
  and now the fact that the fix landed after 4.1.4, so the next bump knows to delete it.

## Size

One pull request. It lands whole: the pins, the lockfile, the renamed patch and the law cannot be
split, since the law is red without the bump and the lockfile must match the pins.

1. The bump with its law: about 35 lines by hand (10 in the workspace file, 20 in the new law, 5
   across three other files), plus about 350 generated lockfile lines. 0 product lines.

About 1 agent hour for the tests step and half an hour for the review. I am 85% sure of this size:
the open risk is product code that 4.1.3's types reject, which would add a build step.

Steps: tests, review, one likely send-back, and one build step held in reserve. Priced from this
month's rows in `field/runs/`: a tests step about $4.65, a review about $2.12, a fix round about
$4.18, a build about $1.20.

Estimate: 4 steps, $13

## What this cannot tell us

- **Whether the whole repo type-checks on 4.1.3.** I installed nothing and ran no typecheck. The
  notes name type changes we have no call site for, but only the compiler knows. CI's typecheck
  tells, and it covers today's version too.
- **Whether pnpm's own patch tool applies the carried patch.** GNU `patch` does, with both hunks
  exact. pnpm fails the install loudly if not. Then the test writer makes the same edit again with
  `pnpm patch effect@4.1.3` and `pnpm patch-commit`, and says so.
- **Whether L3's pinned numbers hold on 4.1.3.** The arbitrary code is the same in both versions,
  so I expect yes. Only the run tells.
- **Whether L4's fired map is unchanged.** I read the seven new files' first blocks; I did not run
  the rule on them.
- **Whether a test leaned on the old `Effect.race` leak or the old `TestClock`.** 47 test files in
  `next/` use `TestClock`. The full CI run tells.
- **Whether today's app behaves the same in daily use.** Its tests run only on the laptop, and only
  the five named above are in this plan.
- **Whether `@effect/sql-d1` 4.1.3 works with Alchemy beta 85's D1 code.** Its range allows it and
  no code of ours calls D1 through it. No fast test covers it.

Left out on purpose: turning the three `MaxOpsBeforeYield` workarounds back to 1 (they sit in
integration tests, and the bump only makes that possible), the cleanup that will call `isAnyOf`, a
bump of `@effect/tsgo`, and 4.1.4.

## Open questions

None.


Plancheck-Version: 3

# Plan: a law's plant and label are options of its declaration, on @kalfa/vitest, a CI check holds each plant against its run row, and it.prop replaces our property runner (0580)

This is `next/` and our tooling. Nothing a person sees in a window changes. It builds
[0580](../../../.decisions/0580-law-options-carry-plant-and-label.md) and the property part of
[0579](../../../.decisions/0579-property-laws-use-it-prop.md), in the package that 0557 names
`@kalfa/vitest` and that is still `@kampus/vitest` in `next/packages/vitest` on main. Three pull
requests: the options, the plant record and the check first (0580 binds them into one), then the
13 files of the shared property runner, then the last file once pull request 1366 lands.

```ts
// The whole idea. Before: the plant in a comment, the label in the title, a hand runner.
// Plant: drop the press row from the record
it.effect("scenario: a reply after the deadline is dropped", body);
it.effect("the log reads back as written", () => property(Log, law, { numRuns: runsFor({ fast: 5, full: 50 }) }));

// After: one import, both facts are options, and the property is the package's own it.effect.prop.
import { it, runsFor } from "@kampus/vitest"; // @kalfa/vitest once the package is renamed (0585's order)

it.effect("a reply after the deadline is dropped", body, { plant: "drop the press row", scenario: "one deadline, one late reply" });
it.effect.prop("the log reads back as written", { log: Log }, ({ log }) => law(log), {
  plant: "skip the last append on read",
  fastCheck: { numRuns: runsFor({ fast: 5, full: 50 }) },
});

// The record the tests step writes, made by a script from the law's own options, never by hand.
// field/runs/<date>-<run>.json, "plants":
[{ file: "next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts", law: "the log reads back as written", plant: "skip the last append on read", result: "red" }]
```

## Doubts first

- **The plant check blocks from its first pull request,** because 0580 says the check is red. That
  is an owner decision, so it is in force; AGENTS.md's "measure false alarms before a check
  blocks" is held down by how the check reads, not by an advise phase: law bodies compared as
  parsed code, `git mv` pairs, and a notice only for files still on `@effect/vitest`
  ([The plant check](#the-plant-check)). The round-1 advise path and its open question are gone.
- **`it.prop` at 4.1.3 takes no fast-check input,** and slice 2 keeps every fast-check input as it
  is, as an ordering step: the move keeps seed 119120 and the inputs, so 0579's "same first failing
  case before and after the move" holds as written, and the Schema rewrite comes later, in 0579's
  folder sweep. So the package's `it.prop` takes fast-check inputs: my call, 80%, below.

## Searched first

- `records.ts find` for "plant option law declaration run row check", "law plant recorded reporter
  task meta", "property runner fast-check commands it.prop", "check advises before it blocks false
  alarms" and "fast-check arbitrary Effect Arbitrary engine seed". The records that govern this:
  [0580](../../../.decisions/0580-law-options-carry-plant-and-label.md),
  [0579](../../../.decisions/0579-property-laws-use-it-prop.md),
  [0093](../../../.decisions/0093-laws-walk-plants-run-once.md),
  [0527](../../../.decisions/0527-type-laws-get-a-type-label.md),
  [0411](../../../.decisions/0411-property-data-comes-from-schemas.md),
  [0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md),
  [0585](../../../.decisions/0585-kalfa-is-six-domain-packages.md),
  [0556](../../../.decisions/0556-kalfa-holds-our-tooling-packages.md),
  [0591](../../../.decisions/0591-exam-shape-checks-become-lint-rules-and-text-reads-are-declared.md)
  (a text-reading law declares `reads:` beside 0580's options),
  [0470](../../../.decisions/0470-a-ui-check-advises-until-measured.md) (a UI check advises until its
  own record shows about 0 false alarms; 0580 decides this check is red, so 0470 does not set its
  level) and [0523](../../../.decisions/0523-advice-rules-block-where-clean.md).
- The code on main at `d3a444edf`: `next/packages/vitest/src/` (`Depth.ts`, `Recorder.ts`,
  `index.ts`; it has no property runner of its own), libfabrika's
  `src/Testing.test-support.ts` (`property` and `stopOnAbort`), `oxlint-plugins/law-shape.ts`,
  the built-in plants file of the lint plugins (a lint rule's planted lines, a different thing: they stay),
  the CI folder's field check, `field-schema.ts`, `changes.mjs`, `.github/workflows/check.yaml`,
  `.agents/skills/tests/SKILL.md` and `.agents/skills/lead/scripts/plants.ts`.
- Installed versions in `pnpm-lock.yaml`: `@effect/vitest@4.1.3`, `effect@4.1.3` (with its local
  patch), `vitest@5.0.5`, `fast-check@4.10.2`. Read in `node_modules`: `@effect/vitest`'s
  `src/index.ts` and `src/internal/internal.ts`, `effect/src/Arbitrary.ts`, vitest's `TestOptions`
  and `TaskMeta`, and `effect/AGENTS.md` in full.
- Pull request 1366's 63 files: `next/packages/libfabrika/src/settings/StartsTest.ts` is one of
  them, so it waits for slice 3. No other file here is in it.
- The `@kalfa/config` plan, `docs/plan/quests/kalfa-config-PLAN.md` on
  `fabrikalfa/kalfa-config` (pull request 1427), and the exam-to-lint plan,
  `docs/plan/quests/exam-to-lint-PLAN.md` on `fabrikalfa/exam-to-lint` at `0dca05f`, which stacks on
  this one. See [Stacking](#stacking).

## How others do it

- **vitest puts a test's facts in options, never in its name.** vitest 5.0.5's `TestOptions` has
  `timeout`, `retry`, `tags` and `meta?: Partial<TaskMeta>`, "custom test metadata available to
  reporters", which the JSON reporter saves, and `TaskMeta` is an interface a package widens with
  `declare module`. So the plant and the label ride in `meta`, and every reporter and the Node API
  sees them. Read in the installed `vitest/dist/chunks/config.d.*.d.ts`.
- **Effect's `it.effect(name, self, timeout?: number | TestOptions)`** already passes its last
  argument to vitest unchanged (`testOptions` in `internal.ts`), and `it.effect.prop` passes the same
  object with an extra `arbitrary: Arbitrary.CheckOptions`. Our options sit in that one place.
- **Effect 4.1.3's `Arbitrary` is its own engine.** It adapts fast-check's ideas (its comments cite
  fast-check v4.9.0 files) but takes no fast-check value: `it.prop`'s inputs are a `Schema` or an
  Effect `Arbitrary`, and its public combinators are `schema`, `Constant`, `array`, `map`,
  `filter`, `filterMap`, `flatMap` and `all`. Its seed is set with `Arbitrary.configureGlobal({ check: { seed } })`.
  Its `CheckOptions` has `runs`, `size`, `maxShrinks` and `seed`, and no `examples`.
- **fast-check's own runner** is `fc.assert(fc.asyncProperty(...))` with `fc.configureGlobal` for a
  seed. Our `property` runner wraps it with a scope per case and a stop on abort.
- **Elm and OTP** have no answer: this is test tooling, not a machine or a process.
- **A test's "plant" is a hand-run mutant** (mutation testing's word, as in StrykerJS, which our
  hourly run uses, [0066](../../../.decisions/0066-mutation-runs-on-a-schedule.md)). Mutation tools
  record each mutant and the test that killed it; 0093 records ours in the run row.

## The shape

### The declaration and its options

```ts
// next/packages/vitest/src/Law.ts, a sketch.
import type * as V from "vitest";
import type * as Arbitrary from "effect/Arbitrary";
import type * as fc from "fast-check";

/** The five labels (0093, 0527), each with its required reason. A pinned law names its bug's ticket. */
interface Reasons {
  readonly vector: string;     // where the fixed input came from
  readonly format: string;     // what text must read or write exactly
  readonly scenario: string;   // why one case
  readonly type: string;       // what the compiler checks
  readonly pinned: number;     // the ticket of the bug it pins
}
type Name = keyof Reasons;

/** At most one label: each case forbids the other four, so `{ vector, format }` does not compile. */
type One<K extends Name> = { readonly [P in K]: Reasons[P] } & { readonly [P in Exclude<Name, K>]?: never };
type Unlabeled = { readonly [P in Name]?: never };
export type Labeled = One<"vector"> | One<"format"> | One<"scenario"> | One<"type"> | One<"pinned"> | Unlabeled;

/** A law's options: vitest's own, less the ones 0579 and 0557 do not give, plus the plant and the label. */
export type LawOptions = Omit<V.TestOptions, "meta" | "skip" | "only" | "todo" | "fails"> &
  Labeled & {
    /** The break that turns this law red (0093): run once, recorded in the run row, never kept. */
    readonly plant?: string;
  };

/** What `meta` carries, so a reporter reads it. */
export type Label = { readonly _tag: Name; readonly reason: string | number };
declare module "vitest" {
  interface TaskMeta {
    plant?: string;
    label?: Label;
  }
}

/** A property's options: Effect inputs take `arbitrary`, fast-check inputs take `fastCheck`. */
export type PropOptions<Arbs> = LawOptions &
  (Arbs extends EffectInputs ? { readonly arbitrary?: Arbitrary.CheckOptions } : { readonly fastCheck?: fc.Parameters<never> });
```

```ts
// What the package exports as `it`, a sketch. Each member takes the options last, as Effect's do.
export interface Law {
  (name: string, self: (ctx: V.TestContext) => void, options?: LawOptions): void;
  readonly prop: <const Arbs extends Inputs>(name: string, inputs: Arbs, self: SyncBody<Arbs>, options?: PropOptions<Arbs>) => void;
  readonly effect: EffectLaw<Scope.Scope>;
  readonly live: EffectLaw<Scope.Scope>;
  readonly layer: <R2, E>(layer: Layer.Layer<R2, E>) => (f: (it: Law) => void) => void;
}
interface EffectLaw<R> {
  <A, E>(name: string, self: (ctx: V.TestContext) => Effect.Effect<A, E, R>, options?: LawOptions): void;
  readonly prop: <const Arbs extends Inputs, A, E>(name: string, inputs: Arbs, self: EffectBody<Arbs, A, E, R>, options?: PropOptions<Arbs>) => void;
}

/** Inputs are all Effect (Schema or Effect Arbitrary) or all fast-check, never a mix. */
type Inputs = EffectInputs | FastCheckInputs;
type EffectInputs = { readonly [k: string]: Schema.Schema<any> | Arbitrary.Arbitrary<any> };
type FastCheckInputs = { readonly [k: string]: fc.Arbitrary<any> };
```

- **Each member calls `@effect/vitest`'s,** with `toTestOptions(options)`: the plant and the label
  go into `meta`, every other key passes through. So a timeout, `retry` and `tags` work as in
  vitest. `skip`, `only`, `todo`, `fails`, `skipIf`, `runIf` and the hooks are not exported (0579).
- **Inputs are a record, never a tuple** (`{ log: Log }`): `@effect/vitest` takes both, and a record
  names each value at the call. My call, 80%: it reads as a sentence, as AGENTS.md's data keys rule
  asks.
- **The fast-check path.** With fast-check inputs, the package runs the cases with
  `fc.asyncProperty` from the shared seed, each case in its own `Scope`, and stops on the law's
  abort before a shrink opens anything: our `property` runner's body moves here as
  `src/internal/fastCheck.ts`, unchanged in what it does. The inputs' values, in key order, are the
  property's arbitraries, so one input `{ log: Log }` runs `fc.asyncProperty(Log, ...)` exactly as
  the runner did, and the same seed draws the same cases. Two needs use it: slice 2 keeps every
  fast-check input for now (an ordering step, [below](#what-each-property-runner-law-becomes)), and
  0579 keeps fast-check for data Effect cannot generate, which its later sweep decides case by case.
  0557 builds a mechanism in the package rather than reach around it. My call, 80%: the other way,
  a raw `fc.assert`, 0579 rules out.
- **The seed is set once,** where the package defines `it`: `Arbitrary.configureGlobal({ check: {
  seed: 119120 } })` and `fc.configureGlobal({ seed: 119120 })` run when `Law.ts` loads, so it holds
  in every file that imports `it` and nowhere else. 0579 left the place open. My call, 85%: a root
  `setupFiles` entry reruns every law on any edit (0580's measure), and so does this module, but
  only for files that import it. The package manifest's `sideEffects` names `Law.ts` honestly.
- **`plant` is optional in the type.** Most laws on main have no recorded plant, and a required
  string would make the sweep invent one. The check below asks for it on every law a pull request
  adds or changes. My call, 80%.
- **Is any of this a setting?** No. The seed is one value 0579 fixes for every law, and a failing
  case is reproduced from Effect's replay token or fast-check's printed seed, not by changing it; a
  setting would let two machines run different cases of the same law. Whether the plant check
  blocks is not a setting either: 0580 decides it is red, so there is no switch to set.

### How a plant is run and recorded

```ts
// .agents/skills/tests/scripts/plant.ts, a sketch: run one law under a planted break, print its record.
// node .agents/skills/tests/scripts/plant.ts <file> "<law's title>"
// {"file":"next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts","law":"the log reads back as written","plant":"skip the last append on read","result":"red"}
```

1. The tests step saves a copy of the product file, plants the break, and runs `plant.ts` on the
   law. The script runs that one law through vitest's Node API (`createVitest`, no shell), reads the
   law's task: its file, its title, `meta.plant` and its state.
2. It prints one `Plant` record: `red` when the law failed, `green` when it passed. A law with no
   `plant` option, or a title that matches no law or two, is refused with exit 1, so the record is
   never typed by hand.
3. The step restores by copy, pastes the printed lines into its run row's `plants`, and commits.
4. The pure part, from vitest's tasks to records, is `Plants.records` in the package, so it has its
   own law; the script is the thin edge.

The row's `Plant` gains `file`, so a record names its law by path and exact title. Old rows are
never edited and still read. Measured on main: of 362 plants in 61 run rows, 260 name their law in
free text with no path, and only 12 match a title in an existing file. So matching today's rows by
text cannot be trusted, and that is why the record is made by the script.

```ts
// .github/ci/field-schema.ts, the change.
const Plant = Schema.Struct({
  file: Schema.optionalKey(Schema.String), // new: the law's file; required by the plant check on the rows it reads
  law: Schema.String,                      // the law's title, exact
  plant: Schema.String,
  result: Schema.Literals(["red", "green"]),
});
```

### The plant check

```ts
// .github/ci/plant-check.ts, a sketch. Runs in the field step of check.yaml beside the row check.
// body: the law's body as parsed code (oxc-parser's tree, with positions and comments left out),
// so a change that is only formatting or comments is no changed law.
type Law = { readonly file: string; readonly line: number; readonly title: string; readonly body: Ast; readonly plant: string | null; readonly ours: boolean };
type Refusal =
  | { readonly _tag: "no_plant"; readonly law: Law }       // a changed law names no plant
  | { readonly _tag: "not_recorded"; readonly law: Law }   // no added run row records its plant as red
  | { readonly _tag: "green"; readonly law: Law }          // the row says the plant left it green
  | { readonly _tag: "unclaimed"; readonly row: string; readonly plant: string }; // a row plant no changed law names

export const check = (laws: { base: readonly Law[]; head: readonly Law[] }, rows: readonly Plant[]): readonly Refusal[] => ...

// It blocks (0580: "the check is red"). Any refusal is an `::error` annotation and exit 1;
// a file still on @effect/vitest gets one `::notice` and never fails the step.
const BLOCKS = true;
```

- **What it reads.** The pull request's changed test files (`*.test.ts`, `*.test.tsx`, shared
  suites `*Test.ts`) in `next/` and the three tooling folders, at the merge base and at head, as
  `readFieldFiles` reads rows; and the run rows the pull request adds in `field/runs/`. It parses
  each file with `oxc-parser` (the catalog already holds it, 0040), never a regex, and finds each
  call rooted at `it` or `test` as `law-shape.ts` does.
- **What a changed law is.** A law is keyed by its file and its title with any old label prefix
  taken off. It changed when it is new or its body differs as parsed code: both sides are parsed
  with `oxc-parser`, and the trees are compared with positions, comments and the source text left
  out, so `pnpm format` moving a line or a comment changing is no changed law. Its options argument
  and the comments above it are not part of it, so moving a plant from a comment to an option, a
  label from the title to an option, or adding 0591's `reads:` changes no law: the sweep is not
  asked for 594 new plant runs. A file moved with `git mv` is paired by git's rename detection.
  0580 left this reading to the plan ("a parse of the calls, not a regex").
- **What makes it refuse,** each naming the law with `file:line` and citing 0093 and 0580: the four
  refusals above. A law the pull request did not touch is never read. Only laws declared with the
  package's `it` are held: a file still on `@effect/vitest` cannot take a `plant` option, so its
  changed laws get one notice ("this file's laws move to the package's it") and no refusal, until
  the sweep moves the file. My call, 80%.
- **It blocks.** Each refusal prints as a GitHub `::error` annotation and the field step fails.
  Why blocking is in force before any count: 0580, an owner decision, says the check is red and
  binds it to the `plant` option in one pull request, and AGENTS.md's "measure first" rule gives no
  agent the call to soften an owner's ruling. How false alarms are held down instead: only laws the
  pull request adds or changes are read; a body is compared as parsed code, so formatting and
  comments never count; `git mv` pairs a moved file with its old self; and a file still on
  `@effect/vitest`, which cannot take the option, gets a notice and no refusal. A false alarm the
  lead sees is one field note (`kind: friction`, `primitive: plant-check`) and a fix to the check
  that day, as a flaky test is ([0036](../../../.decisions/0036-a-flaky-test-is-fixed.md)), never a
  softer level. My call on that last part, 85%.
- **The flag.** `changes.mjs` sets `field` when a pull request changes such a test file, so a code
  pull request runs the check (0580 asks how). The full install that `check` already does covers
  `oxc-parser`.

### What `law-shape` reads now

- In a file whose `it` comes from the package, the label is the option: `law-shape` reads
  `{ vector }` and the others from the last argument, and a title that starts with a label is an
  error, "the label is the option `{ scenario: "<why>" }`, not the title (0580)". The `type` option
  takes 0527's body rule.
- In a file still on `@effect/vitest` or `vitest`, the title prefix stays the label, as today. If
  the title prefix were an error everywhere, the 936 labeled titles on main would fail lint before
  the sweep reaches them. My call, 85%: the sweep's last folder removes the title read.
- A `property` call from `Testing.test-support.ts` stops counting as a property in slice 3, when its
  last caller moves.

### What each property-runner law becomes

The shared runner has 23 calls in 14 files on main (`rg` for a `property(` call not after a dot,
at `d3a444edf`). 0579's "279 in 73 files" counted `fc.property` too (see Findings). Each call is
inside an `it.effect` or `it.live`, and becomes that member's `.prop`, with its fast-check input
unchanged, its `numRuns` and `endOnFailure` in `fastCheck`, and a `plant` option recorded by
`plant.ts`.

```ts
// Before, LedgerTurnReads.test.ts:142.
it.effect("...", () => Effect.gen(function* () {
  yield* property(Log, law, { numRuns: runsFor({ fast: 5, full: 50 }) });
}));
// After.
it.effect.prop("...", { log: Log }, ({ log }) => law(log), {
  plant: "<the break the tests step runs>",
  fastCheck: { numRuns: runsFor({ fast: 5, full: 50 }) },
});
```

```text
next/packages/libfabrika/src/  calls  becomes
client/HandsStart.laws.test.ts               2  it.effect.prop
settings/Mail.test.ts                        1  it.effect.prop (endOnFailure)
processes/ProgramMailReadsTest.ts            4  it.effect.prop, inside the shared suite
ledger/LedgerTurnReads.test.ts               1  it.effect.prop
ledger/LedgerTurnEndTest.ts                  1  it.effect.prop (endOnFailure), inside the shared suite
permissions/RelationsTest.ts                 1  it.effect.prop (endOnFailure), inside the shared suite
node/client/HandsSecrets.laws.test.ts        1  it.effect.prop
node/client/JournalSqlite.laws.test.ts       1  it.effect.prop, fc.commands kept (its two older reason lines stay as written)
node/client/JournalSqlite.integration.test.ts 1 it.live.prop
node/client/KeyFile.laws.test.ts             2  it.effect.prop, fc.commands kept
node/client/KeyFile.integration.test.ts      1  it.live.prop (one fc example kept in fastCheck.examples)
node/client/CommandsNode.laws.test.ts        3  it.effect.prop
runtime/RecoveryStoreReadsTest.ts            3  it.effect.prop, inside the shared suite
settings/StartsTest.ts                       1  slice 3: in pull request 1366's diff
```

- **The inputs stay fast-check in this move, and seed 119120 stays,** so 0579's "the sweep checks
  that each law draws the same first failing case before and after the move" holds as written:
  same engine, same seed, same arbitrary, passed as the property's one arbitrary. The tests step
  runs each law's plant on the old call and on the moved one and compares fast-check's
  counterexample and its replay path; it writes both into its run row's `note`. A move that also
  rewrote a generator could not be told apart from a weaker law.
- **Keeping the inputs is an ordering step, not 0411's "Effect cannot generate this".** The Schema
  rewrite comes later, in 0579's folder sweep. So the reason line beside each kept input says so,
  as a plain comment: `// fast-check kept: moved unchanged from the property runner; the Schema
  rewrite comes later in 0579's sweep`. It is never written in `prefer-schema-arbitrary`'s
  `fast-check: unsupported Effect -- ...` form, which claims the 0411 case. That rule fires only on
  a fast-check input with Schema evidence, and none of the 13 files fires on main, so no kept input
  needs the rule's form. The two older `unsupported Effect` lines in `JournalSqlite.laws.test.ts`
  are that file's own claim and are not this move's to change.
- The app's runtime laws file (`runtime.laws.integration`, in `next/apps/fabrika/src/`) imports only `stopOnAbort` for its own
  hand runners. It is the app folder's sweep, so `stopOnAbort` stays in libfabrika until then.

### Stacking

This plan needs nothing from the `@kalfa/config` plan: no `kalfa/` folder, no `kalfa/*` workspace
glob, no setting, no `kalfa` command. Its code lives in `next/packages/vitest`, the CI folder,
`oxlint-plugins` and `.agents/skills/tests/scripts`, all on main. So the branch is based on
`origin/main` (`d3a444edf`). The package keeps the name `@kampus/vitest` here: its rename and move
to `kalfa/vitest` is 0585's vitest build, after config, ci and records, and that build changes one
import line in each file this plan touches. 0580's own sketch says `@kalfa/vitest` because that is
the package this one becomes.

**With 0591's `reads:` option.** [0591](../../../.decisions/0591-exam-shape-checks-become-lint-rules-and-text-reads-are-declared.md)
puts a `reads:` option on the law "beside the plant and label options from 0580". The exam-to-lint
plan (`docs/plan/quests/exam-to-lint-PLAN.md` on `fabrikalfa/exam-to-lint`, `0dca05f`) builds it in
its slice C, which "waits on 0580's slice 1 on main". So this plan's slice 1 lands first and adds no
`reads` key; slice C then adds one key to `LawOptions` and one to the `TaskMeta` widening, in the
`Law.ts` this plan makes. The combined type, once both are on main:

```ts
// next/packages/vitest/src/Law.ts after both plans, a sketch.
export type LawOptions = Omit<V.TestOptions, "meta" | "skip" | "only" | "todo" | "fails"> &
  Labeled & {                                  // 0580: at most one of vector, format, scenario, type, pinned
    readonly plant?: string;                   // 0580: the break that turns the law red (this plan)
    readonly reads?: ReadonlyArray<string>;    // 0591: files read as text, repo-root globs (exam-to-lint, slice C)
  };
declare module "vitest" {
  interface TaskMeta {
    plant?: string;                            // this plan
    label?: Label;                             // this plan: { _tag: "scenario", reason: "..." }
    reads?: ReadonlyArray<string>;             // exam-to-lint, slice C
  }
}

// One call with all three, options last as Effect's it takes them.
it.effect("the bundle holds no node: import", body, {
  plant: "an import of node:fs in a browser file",
  scenario: "one real build of the app",
  reads: ["next/apps/fabrika/dist/**"],
});
```

- **0580's label form wins over 0591's sketch.** 0591's code block is marked a sketch and writes
  `law(name, { label: "bundle", plant, reads }, body)`: a free `label` string and the options before
  the body. 0580 decides the label: one of five keys, each with its required reason
  (`{ scenario: "…" }`), and "bundle" is none of the five. 0591 decides only `reads:`, and says it
  sits beside 0580's options. So the law is the package's `it`, options last, with `{ scenario:
  "…" }`; the exam-to-lint plan already writes it that way.
- **The two plans' readers do not collide.** The plant check leaves the options argument out of a
  law's body, so adding `reads:` to a law is no changed law. `law-shape` reads only the five label
  keys from the options, and the exam-to-lint plan's `lawReads` plugin reads only `reads`. Both
  parse the options as an object literal at the call, so the options are written inline: an
  options value passed by name hides its label from `law-shape`, which then reads the law as
  unlabeled, the safe side.
- **Names.** The exam-to-lint plan's slice A moves the exam's lint harness, also named `plant.ts`,
  into the lint plugins folder. This plan's script is `.agents/skills/tests/scripts/plant.ts`. Two files, two folders, two jobs: no
  import crosses, so neither renames.

## One value traced through

1. The tests step writes, in `LedgerTurnReads.test.ts`, `it.effect.prop("the log reads back as
   written", { log: Log }, body, { plant: "skip the last append on read", fastCheck: { numRuns: 5 } })`.
2. `Law.ts` calls `@effect/vitest`'s `it.effect` with `{ meta: { plant: "skip the last append on read" } }`,
   and the fast-check path runs five cases from seed 119120, each in its own scope.
3. The step plants the break in `LedgerTurnStore.ts`, runs `plant.ts` on the law: the law fails, and
   it prints `{"file":"next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts","law":"the log
   reads back as written","plant":"skip the last append on read","result":"red"}`. It restores the
   file, writes the line into its run row (a made-up name here: `field/runs/2026-11-17-t1100-tests.json`) and commits both.
4. On the pull request, `changes.mjs` sees a changed test file and sets `field`. `plant-check.ts`
   parses the file at base and head: the law is new, so it is changed; its `plant` is set; the added
   row has a record with the same file, title and plant, `red`. No refusal.
5. A later build round edits the law's body and nobody reruns the plant: the law changed, no added
   row records it, so the check prints `::error file=...LedgerTurnReads.test.ts,line=142::the law's
   plant is not recorded red in a run row this pull request adds (0093, 0580)` and the field step
   fails. Had the round only run `pnpm format` on the file, the parsed bodies would match and the
   check would say nothing.

## Laws

| Law | Kind (lint, type or test) | Generator | Plant |
|---|---|---|---|
| A law takes at most one label; two labels, a pinned that is not a number, or a plant that is not a string does not compile | type | type | make `Labeled` one plain record of five optional keys, and the `@ts-expect-error` on two labels goes unused |
| `toTestOptions` puts the plant and the label in `meta`, with tag and reason, and passes every other vitest option through unchanged | test | fc.record: plant, one label or none, timeout, retry, tags; 100 runs | drop `retry` from what passes through |
| A law registered through each member (`it`, `it.effect`, `it.live`, `it.prop`, `it.effect.prop`) reads its own plant and label from `ctx.task.meta` | test | scenario: registration happens once per member at collection, so there is nothing to generate | leave `meta` off in the `it.effect.prop` member |
| With fast-check inputs, each case runs in its own Scope, closed before the next case opens | test | fc.integer: case count 3 to 30, 30 runs | run the cases in one `Effect.scoped` around the whole run |
| A fast-check case that fails fails the law with fast-check's counterexample, and a passing run passes | test | fc.integer: a threshold the body fails above, 50 runs | catch the failure and pass |
| After the law's timeout, no case or shrink opens another scope | test | scenario: one timed-out law, since the timing is the case | delete the `stopOnAbort` step |
| Two runs of the same failing law, on either engine, report the same counterexample: the seed comes from the package | test | fc.nat: the failing value's floor, 20 runs | remove the `Arbitrary.configureGlobal` call |
| `Plants.records` lists exactly the laws that ran, each with its plant and red or green, and refuses a law with no plant | test | fc.array: vitest task trees with meta and states, 100 runs | write `green` for a failed law |
| `plant.ts` refuses a title that matches no law or two | test | scenario: the script's two refusal exits | pick the first of two matches |
| The plant check's refusals equal a model's: no plant, not recorded, green, unclaimed; an untouched law and a moved-only law (comment to option, title prefix to option) give none | test | fc.record: base and head law lists and added rows, 200 runs | compare a row's plant by prefix |
| A file moved with `git mv` keeps its laws: unchanged bodies give no refusal | test | scenario: one rename through git, which the generator cannot make | read the pair as a delete and an add |
| A file still on `@effect/vitest` gets one notice and no refusal | test | fc.record: files on either import, 100 runs | refuse every changed law, whatever its import |
| A law whose body changes only in formatting or comments is no changed law, and a change to its parsed code is | test | fc.record: law bodies, each printed with generated whitespace, line breaks and comments, and a generated one-token edit; 100 runs | compare the bodies' source text, not their parsed trees |
| The check prints one `::error` per refusal, naming `file:line`, and exits 1 on any refusal; with only notices it exits 0 | test | fc.array: refusal and notice lists, 50 runs | print refusals as `::warning` and exit 0 |
| `changes.mjs` sets `field` for a changed test file in `next/` or a tooling folder, and not for today's version | test | fc.constantFrom: paths by folder and suffix, 200 runs | drop the `*Test.ts` suffix |
| Every run row on main still decodes with the widened `Plant` | test | vector: the run rows in field/runs/ on main | make `file` required |
| `law-shape` accepts an option label in a file on the package's `it`, and refuses a title label there, with a message that names the option | lint | lint | read the title prefix in every file |
| `law-shape` holds 0527's body rule on the `type` option | lint | lint | skip the body rule when the label is an option |
| A file on `@effect/vitest` keeps its title labels | lint | lint | report every title label as an error |
| Slice 2: each of the 22 moved properties keeps its claim and turns red under its recorded plant | test | fc.commands: and each file's own fast-check inputs, seed 119120, default runs as before | each law's own plant, run with `plant.ts` |
| Slice 2: under its plant, each moved property reports the same counterexample and replay path as the old `property` call (0579's same first failing case) | test | fc.commands: and each file's own fast-check inputs, kept unchanged, seed 119120, default runs as before | wrap the one input in `fc.record` in the fast-check path, so the draws shift |
| Slice 3: a call of `property` from `Testing.test-support.ts` no longer counts as a property | lint | lint | keep `SHARED` in `law-shape.ts` |

No law here needs a real resource: the moved `.integration.` files were integration before, and
stay so for the child process and disk they use (0584). No host-only law. No secret passes through
any of it.

## Files

| File | Owner | What changes | Product lines expected |
|---|---|---|---|
| `next/packages/vitest/src/Law.ts` | build | new: `it` and its members, `LawOptions`, `toTestOptions`, the `TaskMeta` widening, the seed | 170 |
| `next/packages/vitest/src/internal/fastCheck.ts` | build | new: the fast-check path, the runner's body moved from libfabrika | 60 |
| `next/packages/vitest/src/Plants.ts` | build | new: `records`, from vitest's tasks to `Plant` records | 50 |
| `next/packages/vitest/src/index.ts` | build | exports `it`, `describe`, `expect`, `expectTypeOf`, `assertType`, `Plants` | 15 |
| `next/packages/vitest/package.json` | build | `@effect/vitest`, `fast-check` and `vitest` move to dependencies; `sideEffects` names `Law.ts` | 6 |
| `.agents/skills/tests/scripts/plant.ts` | build | new: run one law, print its record | 70 |
| `next/packages/vitest/src/Law.test.ts` | tests | the option, member, scope, timeout and seed laws | tests |
| `next/packages/vitest/src/Law.types.test.ts` | tests | the type law | tests |
| `next/packages/vitest/src/Plants.test.ts` | tests | the record law | tests |
| `.agents/skills/tests/scripts/plant.test.ts` | tests | the script's refusals | tests |
| `.github/ci/plant-check.ts` | tests | new: the check, its parsed-code compare included (an exam path, so the tests step owns it) | 280 |
| `.github/ci/plant-check.test.ts` | tests | its laws | tests |
| `.github/ci/field-schema.ts` | tests | `Plant` gains `file` | 3 |
| `.github/ci/field-check.test.ts` | tests | the old rows still decode | tests |
| `.github/ci/changes.mjs` | tests | `field` on a changed test file | 10 |
| `.github/ci/changes.test.ts` | tests | its law | tests |
| `.github/ci/package.json` | tests | `oxc-parser` from the catalog | 1 |
| `.github/workflows/check.yaml` | tests | the field step also runs `plant-check.ts` | 4 |
| `pnpm-lock.yaml` | tests | the two dependency moves above | 20 |
| `oxlint-plugins/law-shape.ts` | tests | reads the option label in files on the package's `it` | 80 |
| `oxlint-plugins/law-shape.test.ts` | tests | its laws | tests |
| `oxlint-plugins/README.md` | tests | the law-shape section names the option | docs |
| `.agents/skills/tests/SKILL.md` | build | a plant is an option and its record comes from `plant.ts`; the comment line goes | docs |
| `field/README.md` | build | a plant record's `file` and how it is made | docs |
| `docs/direction/five-steps-for-every-check.md` | build | the label table shows the option form | docs |
| `next/packages/libfabrika/src/client/HandsStart.laws.test.ts` | tests | slice 2: 2 calls move | tests |
| `next/packages/libfabrika/src/settings/Mail.test.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/processes/ProgramMailReadsTest.ts` | tests | slice 2: 4 calls | tests |
| `next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/ledger/LedgerTurnEndTest.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/permissions/RelationsTest.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/node/client/HandsSecrets.laws.test.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/node/client/JournalSqlite.laws.test.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/node/client/JournalSqlite.integration.test.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/node/client/KeyFile.laws.test.ts` | tests | slice 2: 2 calls | tests |
| `next/packages/libfabrika/src/node/client/KeyFile.integration.test.ts` | tests | slice 2: 1 call | tests |
| `next/packages/libfabrika/src/node/client/CommandsNode.laws.test.ts` | tests | slice 2: 3 calls | tests |
| `next/packages/libfabrika/src/runtime/RecoveryStoreReadsTest.ts` | tests | slice 2: 3 calls | tests |
| `next/packages/libfabrika/src/settings/StartsTest.ts` | tests | slice 3, after pull request 1366 | tests |
| `next/packages/libfabrika/src/Testing.test-support.ts` | tests | slice 3: `property` goes; `stopOnAbort` stays for the app's sweep | tests |
| `next/packages/libfabrika/package.json` | build | slice 2: depends on `@kampus/vitest` where it does not yet | 1 |

The libfabrika test files' new dependency is already there: 110 files in `next/` import
`@kampus/vitest` today. `next/AGENTS.md`'s libfabrika test: none of these is product code.

## Steps

1. **Tests** (slice 1): write every slice-1 law above, see each red for the right reason, plant
   each once. The check's own code is an exam path, so this step writes `plant-check.ts`,
   `law-shape.ts` and the CI edits too, with their laws. Record plants by hand this once, with
   `file`, since `plant.ts` is the build's: say so in the row.
2. **Build** (slice 1): the package's `Law.ts`, `fastCheck.ts`, `Plants.ts`, its exports, and
   `plant.ts`, until every law is green; the skill and doc lines.
3. **One review** by an Opus agent of the whole slice-1 diff against this plan, 0580 and 0579.
4. **Slice 2**, its own pull request: the tests step moves the 22 calls in 13 files, keeping each
   fast-check input and seed 119120 with the ordering reason line, runs each plant on the old call
   and the moved one, checks the counterexamples match (0579), and records each plant with
   `plant.ts`; the plant check blocks on its own first real pull request. One review.
5. **Slice 3**, after pull request 1366 merges: `StartsTest.ts` moves, `property` and `SHARED` go.
   One review.

Laws, lint and `pnpm format` run in each box as the step rules say; the lead runs `--changed` and
the typecheck.

## Size

1. Slice 1, the options, the record and the check: 770 lines (builder 370, tests-owned code 400,
   the parsed-code compare included), plus about 720 test lines; 18 files; about 3 agent hours.
2. Slice 2, the property runner's 13 files: 260 lines, all tests, the reason lines included; 14
   files; about 1.5 agent hours, with the before-and-after plant runs.
3. Slice 3, after 1366: 60 lines; 3 files; about 0.5 agent hours.

Sure of slice 2's and 3's size at 80%: each call site is about ten lines. Slice 1 at 65%: the
check's parsed-code compare and its rename pairing are the doubt, and a send-back is likely there. Priced from
the recent rows in `field/runs/`: a tests step about $6, a build about $2.30, a review about $3.60,
a fix round about $4.20, at list price.

Estimate: 8 steps, $36

## Records

- No glossary row: `plant` and the five labels keep their meanings (0580 says so).
- `field/README.md` gains the `file` key of a plant record.
- No amendment to 0579: slice 2 keeps its "same first failing case" rule as written.
- This step's own rows: `field/runs/2026-11-15-law-options-0580-plan.json` (round 1) and
  `field/runs/2026-11-15-law-options-0580-plan-fix.json` (this fix round).

## What this cannot tell

- How many false alarms the check gives. It blocks from slice 1 (0580), and nothing on main carries
  a `plant` option, so its first real record is slice 2. The parsed-code compare, the rename pairing
  and the notice for old files hold the known sources down; an unknown one shows as a blocked pull
  request, and is fixed in the check that day.
- Whether the parse finds every law. `law-shape`'s own reach (a helper that wraps `it`, a title not
  written out) is the check's reach too: under-reporting, the safe side.
- Whether the fast-check path's timeout behavior matches `@effect/vitest`'s exactly. Both stop at the
  timeout; only the laws above test ours.
- Whether every moved law draws the same cases on every run. Same engine, seed and arbitrary say it
  should, and slice 2 checks the first failing case under each plant, as 0579 asks; it does not
  compare the passing cases one by one.

## Open questions

None.

Round 1's two are settled: the plant check blocks, as 0580 says; and slice 2 keeps
seed 119120 and its fast-check inputs, so 0579's same-first-failing-case rule holds as written and
the Schema rewrite is 0579's later sweep.

## Findings

```json
{"_tag":"finding","id":"2026-11-15-0579-runner-count","date":"2026-11-15","by":"plan step, law-options-0580","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":".decisions/0579-property-laws-use-it-prop.md","line":43},"says":"0579 counts 279 calls of our property( runner in 73 libfabrika files, but that pattern also matches fast-check's fc.property(; the shared runner has 23 calls in 14 files","proof":"git grep -c 'property(' 6f3c96c46 -- next/packages/libfabrika sums to 279 in 73 files, as 0579 says; on main d3a444edf, rg for a property( call not after a dot, Testing.test-support.ts left out, gives 23 in 14 files","cost":"a sweep sized from 0579's row plans for twelve times the work the runner's move is","head":"d3a444edfe229a76ae352c3471984a76676d999f","ticket":null,"pr":null}
```

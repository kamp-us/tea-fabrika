Approved by the lead agent, builds 0089; body 4a59df330a1f
Plancheck-Version: 3

# Plan: a type law that an interface value type is refused (ticket 1996)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1996, found by the review of
https://github.com/kamp-us/tea-fabrika/pull/1922 (issue 1839), under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749). Words: `kalfa/config/GLOSSARY.md`,
unchanged.

Decision 0089 (`.kalfa/decisions/0089-a-settings-value-is-plain-data.md`) says a setting's value type written as an
`interface`, `Schema.Opaque` included, does not compile at `Setting.make`, because the type cannot tell an interface
from a class. The code does refuse it today: `NotPlain` in `kalfa/config/src/Declaration.ts` walks a record only when
it meets `{ readonly [key: string]: unknown }`, and an interface has no implicit index signature, so it falls to the
last branch and is named whole. But type law T6 in `kalfa/config/src/SettingGroup.types.test.ts` has no interface line,
so a change that lets an interface through fails nothing. This pull request adds those lines. It changes no product
code.

```ts
// The whole idea, a sketch. Nothing here was type-checked.
interface Point { readonly x: number; readonly y: number }
type Spot = { readonly x: number; readonly y: number }

Setting.make("plain.point", Point)   // today: does not compile, and no law says so
Setting.make("plain.spot", Spot)     // today: compiles

// after: T6 holds the first under @ts-expect-error, the second in `plain`, and
// Setting.NotPlain<Point> is exactly Point. A plant that accepts an interface of plain fields
// leaves the directive unused, so the compile fails.
```

## Calls under 80%, read these first

- **Plant (g) leaves today's T6 green, 75% sure.** Plant (g) is the one that proves the gap: it accepts an object of
  plain fields with no index signature, but still refuses functions, so a `Date`, a `Map`, a `Duration` and a
  `DateTime` stay refused through their methods and `Box` through its `unique symbol` brand. I read the types
  (effect 4.1.3's `Duration.d.ts` line 40, `Schema.d.ts` lines 5393 and 11696) and did not run the compiler, since
  the plan step runs none. The doubt is one of today's refused lines turning out to have only plain fields under (g).
  The tests step settles it: it runs (g) once on the branch before the new lines and records which T6 lines go red. If
  any does, (g) is still a fair plant for the new lines, and the plan's claim that only the new lines catch it is
  marked wrong in the pull request body.

## How others do it

- **TypeScript itself.** The handbook says a type alias of an object literal gets an implicit index signature and an
  interface does not, because an interface can be merged with later declarations
  (https://github.com/microsoft/TypeScript/issues/15300, the maintainers' answer; read from memory, not fetched). That
  is the exact line `NotPlain` stands on, so the law pins the compiler fact the rule depends on.
- **Effect.** `Schema.Opaque` exists to make a struct's type nominal (effect 4.1.3, `Schema.d.ts` line 5428: "a
  nominally distinct type `Self`"), so its type is a class: refusing it is the decision's own example.
- **Elm and Erlang.** Neither has the problem: an Elm record is structural with no class form, and an Erlang term is
  plain data by construction. Elm's `Json.Encode.Value` is the nearest kin of "plain data only". Not fetched.
- **Type tests in the industry.** `@ts-expect-error` lines plus `expectTypeOf` pins, as `tsd` and `expect-type` do, and
  as this file already does for T1 to T9. A plant that removes the guard makes the directive unused (TS2578), which
  fails the compile.

## The shape

No type changes. The new test values, a sketch of the exact lines, all in the T6 section of
`kalfa/config/src/SettingGroup.types.test.ts` (today lines 362 to 453):

```ts
// An interface and a type with the same fields: the decision refuses the first and accepts the second.
interface Point {
  readonly x: number;
  readonly y: number;
}

const Point: Schema.Codec<Point> = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });

type Spot = { readonly x: number; readonly y: number };

const Spot: Schema.Codec<Spot> = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });

// An interface whose one key may be missing.
interface Corner {
  readonly x?: number;
}

const Corner: Schema.Codec<Corner> = Schema.Struct({ x: Schema.optionalKey(Schema.Finite) });

// A nominal struct: its type is a class, so it is refused as one.
class Person extends Schema.Opaque<Person>()(Schema.Struct({ name: Schema.String })) {}
```

Added to `plain`:

```ts
Setting.make("plain.spot", Spot),
```

Added to `notPlain`, each under its own directive:

```ts
// @ts-expect-error T6: an interface is not plain data, since the type cannot tell it from a class
Setting.make("plain.point", Point),

// @ts-expect-error T6: an interface with explicit type arguments is still refused
Setting.make<"plain.typed", Schema.Codec<Point>>("plain.typed", Point),

// @ts-expect-error T6: an interface whose key may be missing is not plain data
Setting.make("plain.corner", Corner),

// @ts-expect-error T6: an interface inside a record is not plain data
Setting.make("plain.at", Schema.Struct({ at: Point, n: Schema.Int })),

// @ts-expect-error T6: an interface in a union is not plain data
Setting.make("plain.either", Schema.Union([Point, Schema.Literal("none")])),

// @ts-expect-error T6: a Schema.Opaque type is a class, so it is not plain data
Setting.make("plain.person", Person),
```

Added to the T6 `it` body:

```ts
expectTypeOf<Setting.NotPlain<Point>>().toEqualTypeOf<Point>();
expectTypeOf<Setting.NotPlain<{ readonly at: Point; readonly n: number }>>().toEqualTypeOf<Point>();
expectTypeOf<Setting.NotPlain<Spot>>().toEqualTypeOf<never>();
```

Added after line 34 of the file's plant list, as new lines (no edit to lines 1 to 36, so the change stays apart from
https://github.com/kamp-us/tea-fabrika/pull/2319, see Files):

```ts
// - T6, ticket 1996, on `Declaration.ts`: (f) test `T extends object` in place of the index signature at the record
//   line; (g) before the last branch, accept an object that is no function and whose every field is plain data.
```

The `it` title stays "T6 type: a setting's value is plain data, and the part that is not is named": the new lines fit
it. Every line is real: `Point`, `Spot`, `Corner` and `Person` are built when Vitest loads the file, and the two
functions are never called, as today.

**Every way the value can be typed** (the plan rule for a type derived from a value):

| Way | Line | Law |
|---|---|---|
| no type arguments, the schema annotated as `Schema.Codec<Point>` | `plain.point` | T6a |
| explicit type arguments | `plain.typed` | T6a |
| an optional key | `plain.corner` | T6a |
| a union with an interface in it | `plain.either` | T6a |
| nested in a record | `plain.at`, and the `NotPlain` pin | T6a, T6b |
| a class made by `Schema.Opaque` | `plain.person` | T6a |
| the same fields as a `type` | `plain.spot`, and its pin | T6c |
| `undefined` with `exactOptionalPropertyTypes` off | not reachable: the repo's base tsconfig turns it on (line 8) | none |
| a widened type, `Schema.Codec<object>` | not an interface; see Findings 2 | none |

**The run-time guard.** Decision 0089's check at group make (B17 in `.kalfa/quests/kalfa-config-declare-PLAN.md`)
accepts a value whose type was an interface, and that is right: decoded by a `Schema.Struct`, it is a plain object at run
time, and the check freezes it deep. The interface refusal guards the type, for the day a caller's interface is
implemented by a class. No run-time hole remains to fail loudly.

## One value traced

`Setting.make("plain.point", Point)`, with `Point: Schema.Codec<Point>`:

1. `make` infers `C = Schema.Codec<Point>`, so `C["Type"]` is `Point`.
2. `PlainSchema<C>` asks `NotPlain<Point>`. `0 extends 1 & Point` is false, so `Point` is not `any`.
3. `Met<never, Point>` is false: nothing was met before.
4. `Point` is not text, a number or a boolean, has no brand key, and is not an array.
5. `Point extends { readonly [key: string]: unknown }` is false, because an interface has no implicit index signature.
6. The last branch answers `Point`, so `PlainSchema<C>` is `C & NotPlainData<Point>`.
7. `Point` does not have the key "a setting's value must be plain data: ...", so the call does not compile and the
   `@ts-expect-error` is used. The compile passes.

Under plant (g), step 6 becomes: `Point` is an object and no function, its fields `x` and `y` are numbers, so the walk
answers `never`, the call compiles, the directive is unused (TS2578) and the compile fails.

`Spot` takes the same path to step 5, where its implicit index signature matches, the walk answers `never`, and the line
compiles.

## Generators

None. T6 is a type law over fixed lines, judged by the compiler: its generator cell says `type`, as T1 to T9 do. No
class letter is needed, since no generator draws.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T6a, an interface is refused: each of `plain.point`, `plain.typed`, `plain.corner`, `plain.at`, `plain.either` and `plain.person` is a line under its own `@ts-expect-error` in `notPlain`, and the compile of `kalfa/config/src/SettingGroup.types.test.ts` has no TS2578 | type | type | (f) test `T extends object` at the record line: all six lines compile, their directives are unused, tsc red (the `Date` and `Map` lines and the `NotPlain<Date>` pin likely go red too, since a method walks to `never`); (g) before the last `: T`, add `T extends object ? (T extends (...args: ReadonlyArray<any>) => unknown ? T : [{ [K in keyof T]-?: NotPlain<T[K], Seen \| T> }[keyof T]] extends [never] ? never : T) : T`: all six lines compile, tsc red, and every line of today's T6 stays as it is (the call at the top); (a) type `make`'s schema as `C` again: all six compile, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T6b, the interface is named: `Setting.NotPlain<Point>` is exactly `Point`, and `Setting.NotPlain<{ readonly at: Point; readonly n: number }>` is exactly `Point` | type | type | (g): both answer `never`, the two `toEqualTypeOf` lines fail, tsc red; (e) answer `T` whole at the record line: the record pin answers the whole record, tsc red | kalfa/config/src/SettingGroup.types.test.ts |
| T6c, a `type` with the same fields is accepted: `Setting.make("plain.spot", Spot)` compiles in `plain`, and `Setting.NotPlain<Spot>` is exactly `never` | type | type | (h) drop the record line, so every record falls to the last branch: `plain.spot` does not compile and its pin answers `Spot`, tsc red (`plain.pair`, `plain.table` and others go red too) | kalfa/config/src/SettingGroup.types.test.ts |
| O1, nothing else changes: T1 to T5, T7, T9, FO6, SN11, SN12 and X4, and today's T6 lines, stay green with no edit | type | pinned: the laws named, unchanged | (already planted) | kalfa/config/src/SettingGroup.types.test.ts |

**Lint, type or test?** Whether a call compiles is something only the compiler sees: type. No lint rule could tell an
interface from a class at a call site any better than the type does. No run-time law: a value typed by an interface is
plain at run time (The shape, "The run-time guard").

**Where they run.** The compiler judges T6a to T6c and O1. Vitest runs the file too, which checks that the new module
values load (`Schema.Opaque` builds a class at load) and that each `it` body passes; Vitest does not typecheck. No law is
host-only, and no `.integration.` file is touched. Every law runs on every pull request in CI's typecheck.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/SettingGroup.types.test.ts | tests | tests | T6a to T6c: about 45 lines in the T6 section and two plant lines after line 34 |
| .kalfa/quests/kalfa-config-interface-PLAN.md | lead | docs | this plan |

**The overlap with https://github.com/kamp-us/tea-fabrika/pull/2319** (ticket 1995, branch
`fabrikalfa/kalfa-config-refusals`): it changes the same test file, in three places: two plant lines inserted after
line 31, the `effect` import on line 36 (it adds `Redacted`), and RF7 appended after line 534. This plan touches none of
those: it inserts after line 34, with lines 32 to 34 and 35 unchanged between the two changes, and edits only lines 362
to 453. Whichever lands second rebases with no conflict. It needs no new import: `Schema` and `expectTypeOf` are
imported already. Its plan is `.kalfa/quests/kalfa-config-refusals-PLAN.md` on that branch; it names this ticket as
"cheap, but unrelated" and does not fold it.

No `GLOSSARY.md` change: no new domain word. No layer rule row, no package, no lockfile change.

## Existing tools

- No new helper or function. Searched `kalfa/config/src` for a type-test helper (`rg -n "expectTypeOf|ts-expect-error"
  kalfa/config/src`): the file's own `notPlain` and `plain` functions and `expectTypeOf` from `@effect/vitest` are the
  tools, and the new lines join them.
- `Schema.Opaque`, `Schema.Struct`, `Schema.optionalKey`, `Schema.Union` and `Schema.Literal` from effect 4.1.3, as the
  file already uses them.

## Calls taken

- **Plan only 1996; do not fold https://github.com/kamp-us/tea-fabrika/issues/2000. 95% sure.** 2000 makes
  `SettingsError` carry a `Diagnostic.Place` and a declared code per reason: product code in
  `kalfa/config/src/internal/error.ts` and every refusal site, which https://github.com/kamp-us/tea-fabrika/pull/2319
  is rewriting right now, plus a new import of `@kalfa/diagnostics`. Its blocker,
  https://github.com/kamp-us/tea-fabrika/issues/1918, is closed, so it is ready, but its cost is about 100 product lines
  and a full build and review, against this ticket's 45 test lines and none of product. Folding would also put this
  pull request on top of 2319's files. It is not cheaper: it should start after 2319 lands.
- **Lines in the existing T6, not a new law number. 90% sure.** The ticket says "T6 holds a line", and the new lines
  are the same rule with the same message. The sub-laws T6a to T6c are names in this plan only; the file keeps "T6".
- **Six refused lines, not one. 85% sure.** The plan rule asks for every way the value can be typed; each line costs two
  lines of code, and each catches a plant shape the others might miss (a union distributes, a nested interface goes
  through the walk, `Opaque` is a class with only plain fields).
- **Pins with `NotPlain` beside the directives. 90% sure.** A `@ts-expect-error` passes on any error, including one in
  the test itself (a wrong annotation on `Point`); the pin says the error is the plain-data one and names the part.
- **The build step has nothing to make green.** The laws pass on main the moment they are written, since the guard is
  already there; the tests step proves each by its plants instead of by red. The lead decides whether a build step runs
  at all; the build skill says not to commit when every law was green at the start.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/SettingGroup.types.test.ts` passes (the file loads and
  each body passes). The compiler run is the lead's to allow; on it the file has no error. Then each plant (f), (g),
  (a), (e) and (h) is applied once to `kalfa/config/src/Declaration.ts`, the compiler is run on the package, the red
  lines are recorded, and the plant is undone. For (g), the step first records the compile with the new lines left out,
  which settles the call at the top.
- The lead runs `--changed origin/main` and one `pnpm typecheck`.

## Size

1. One pull request: 0 product lines, about 45 lines in one test file. It lands whole: the law and its plants are one
   change.

About 1 agent hour, 85% sure: tests and review, the plant runs being the most of it. Basis: ticket 1995's plan,
`.kalfa/quests/kalfa-config-refusals-PLAN.md` on its branch, priced at about $9 a step for a larger change; this one is
one test file, so about $5 a step for Opus steps: tests, review, a build step that confirms green with no commit, and
one likely send-back of tests if a plant turns out wrong.

Estimate: 4 steps, $20

## New names

- `plain.point`, `plain.typed`, `plain.corner`, `plain.at`, `plain.either`, `plain.person`, `plain.spot`: setting names
  in a test, as `plain.slug` is. Not domain words.
- `Point`, `Spot`, `Corner`, `Person`: test schemas. Not domain words.

## Records

- No new glossary term and no decision record: the rule is decision 0089's, unchanged.

## What fact is lost if it is not recorded now

That today's T6 is green under plant (g), so the interface refusal had no law until this one. The tests step's record
of the plant runs, in the pull request body, keeps it.

## What this cannot tell us

- Whether plant (g) is really missed by today's T6 lines: read in the types, not compiled (the call at the top).
- Whether a schema kind no line tries is judged right, such as `Schema.declare` with a hand-made type or a template
  literal: decision 0089 names that doubt, and this ticket does not close it.
- A refused interface reads as the long `NotPlainData` key in the compiler's message; whether a caller understands
  that it must write a `type` is for the README (Findings 1), not a law.

## Open questions

None.

Each choice picks how the test does what decision 0089 and the ticket already say.

## Findings

1. `kalfa/config/README.md`, "A setting's value is plain data" (line 77), does not say that a value type written as an
   `interface` is refused and must be written as a `type`, which decision 0089's consequences say and
   `Declaration.ts`'s `NotPlain` comment says. A caller who meets the error has no guide in the README. One sentence
   fixes it; the lead may fold it into this pull request's build step or ticket it.
2. A schema typed wide, such as `Schema.Codec<object>`, has the value type `object`. Whether `NotPlain<object>` answers
   `object` (refused) or `never` (accepted) depends on whether `object` meets the index signature, which I did not
   compile. If it is accepted, a cast to `object` slips past the type, and only B17's run-time check holds. The tests
   step can record it in one compile; if it compiles, it is a ticket, not this pull request.

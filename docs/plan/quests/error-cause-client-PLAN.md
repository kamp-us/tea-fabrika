Approved by the lead agent, builds the JournalError row of slice 3 of the error-cause plan (0568), as the lead (fabrikaa-merger) approved it; body 428efbcbeb83
Plancheck-Version: 3

# Plan: `JournalError`'s cause is required, `cause: Schema.Defect()` (ticket 1062, slice 3, the client row)

`next/` only, in `next/packages/libfabrika/src/client`. Today's app is not touched. This is the
`JournalError` row of slice 3 of [the error-cause plan](./error-cause-PLAN.md), which builds
[0568](../../../.decisions/0568-error-cause-follows-effect.md): a cause every caller always has is
`cause: Schema.Defect()`. The one product maker of `JournalError` always passes the store's failure,
so its cause becomes required. The two cut fakes that make it with no cause gain one, and one type
law, L3, holds the new shape. All line numbers here are read at `origin/main` `d524d4e6`.

```ts
// before: next/packages/libfabrika/src/client/Journal.ts:53-59
export class JournalError extends Schema.TaggedError<JournalError, { readonly brand: unique symbol }>()(
  "JournalError",
  {
    reason: Schema.Literals(["storage", "bad_entry"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

// after: the one product maker always has a cause (JournalStore.ts:13-14 passes the store's failure)
    cause: Schema.Defect(),

// before: next/packages/libfabrika/src/client/Commands.test-support.ts:141 and :153
return yield* JournalError.make({ reason: "storage" });
// after, a sketch: the cut is the failure, so the cause is an Error that says which cut it was
return yield* JournalError.make({ reason: "storage", cause: new Error(`planted cut: journal ${op} failed before it delegated`) });
```

## Doubts, at the top (owner away)

One call carries over from the parent plan, under 80%. It does not contradict a decision, so it is
not an open question.

- **The product's call sites decide, and a test fake follows them** (75%, the parent plan's first
  doubt). 0568 says "every caller", and the two cut fakes are callers that pass no cause today. The
  lean holds because a fake that makes an error the product never makes shows an agent a shape that
  cannot happen ([0562](../../../.decisions/0562-nothing-teaches-the-wrong-shape.md)). The cut's
  cause is an `Error` whose message names the cut, as the brief takes it; the parent plan said "a
  generated cause", and a fixed `Error` per cut is the narrower reading of the same thing (a cut has
  no failure from below, so its own description is the truest cause it has). What would settle it:
  the owner reading this line. If he says no, `JournalError` stays `Schema.optional(Schema.Defect())`,
  the fakes keep no cause, and L3 is dropped; nothing else moves.

## What makes or reads a `JournalError` at today's main

Searched with `rg -n "JournalError"` over the whole repo at `d524d4e6`, outside `docs/` and `field/`,
and read each hit. It has three makers and four readers, and nothing else names it.

| Where | What it does | What this change does to it |
|---|---|---|
| `next/packages/libfabrika/src/client/JournalStore.ts:13-14` | the one product maker, `translated`: every store or decode failure becomes a `JournalError` with `cause` set to that failure | nothing: it already passes `cause`, so it type checks as is |
| `next/packages/libfabrika/src/client/Commands.test-support.ts:141`, `:153` | the two makers in the cut fake, `cutJournal`'s `around`, with no cause | each gains an `Error` cause; without it the typecheck fails |
| `next/packages/libfabrika/src/client/HandsStart.ts:84` | `plain = (error: JournalError) => ({ ...error })`, the record tea's `Cmd` failure carries | nothing at run time: see below. Its type gains a required `cause: unknown`, which tea's `{ _tag }` error type accepts |
| `next/packages/libfabrika/src/client/HandsMachine.ts:131`, `:138` | `err: ["JournalError"]` on `journal_read` and `journal_write`; tea 0.29.0 keeps only the tag list (`errTags`, `@demlik/tea` `dist/core-PxoTxrNB.d.ts:202`) | nothing |
| `next/packages/libfabrika/src/client/HandsMachine.ts:803` | `journal_read_err` decodes the record with `BadEntry = Schema.Struct({ reason: Schema.Literal("bad_entry") })` (`:407`), which ignores other keys | nothing: it never reads `cause` |
| `next/packages/libfabrika/src/client/HandsMachine.laws.test.ts:413`, `:431` | the machine law's model answers a journal command with a plain record, `{ _tag: "JournalError", reason }`; it makes no `JournalError` | nothing: the record is what tea sees, and tea sees no cause (below) |
| `next/packages/libfabrika/src/client/Hands.types.test.ts:18-58` | T1, the contract's types: `JournalError["reason"]` and the service shape | L3 joins it; T1 is unchanged |

- **`node/client/JournalSqlite*`** (the four `JournalSqlite` files under
  `next/packages/libfabrika/src/node/client/`) never name `JournalError`. They supply Effect's
  `KeyValueStore`, and `JournalStore.layer` turns its failures into `JournalError`. Open pull requests
  https://github.com/kamp-us/tea-fabrika/pull/1644 and https://github.com/kamp-us/tea-fabrika/pull/1497
  touch some of those files, and 1497 also touches
  `next/packages/libfabrika/src/client/HandsStart.laws.test.ts`, a reader of the cut fakes; this plan
  edits none of them, so neither conflicts.
- **No decode of `JournalError` exists.** A required cause makes a decode of an encoded value with no
  `cause` fail, but nothing decodes this class: tea keeps only its tag, and no schema, union or RPC
  error list names it.
- **The cause never reaches tea, before or after.** `HandsStart.ts:84` spreads the error, and a
  spread copies only own enumerable keys. Effect 4.1.3's error base passes a truthy cause to the
  platform's `Error` constructor (`effect/src/internal/core.ts:692`), which keeps it as a
  non-enumerable own key, and the `Object.assign` after it (`effect/src/internal/record.ts:19-20`)
  writes over that key without making it enumerable. Run once at `d524d4e6` with the installed
  `effect`: a `JournalError` made with `cause: new Error("store down")` reports `cause` as not
  enumerable, and its spread has the keys `_tag` and `reason` only. So the fakes' new cause changes
  nothing that `HandsStart.laws.test.ts` or `next/apps/fabrika/src/hands-client.test.ts` observe
  through tea. That the product drops the store's failure at this edge is outside this ticket: it is
  a finding row below.

## How others do it

- **Effect itself,** read in the installed `effect` 4.1.3: an error whose every maker has a failure
  from below writes `cause: Schema.Defect()` (`effect/src/sql/SqlError.ts:21`), and 0568 counts 12
  such lines in 4.1.2. The store `JournalError` wraps, `KeyValueStoreError`, is a `Data.TaggedError`
  with `cause?: unknown` (`effect/src/persistence/KeyValueStore.ts:208-213`), because some of its own
  makers have no failure under them; `JournalStore` always has one, so its own error does not inherit
  that optionality.
- **Slice 1** (https://github.com/kamp-us/tea-fabrika/pull/1381, commit `f7169afe`) wrote L3 for
  `RelationsError` and `WebCryptoError`: a never-called function holding one maker call with no cause
  under `@ts-expect-error` and one with a cause, then a `type:` law that checks the kept value's type
  and that the function exists. This plan copies that shape.
- **Elm and OTP** have no answer here: this is how one schema field is written.

## The shape

```ts
// next/packages/libfabrika/src/client/Journal.ts, the build's two lines
/**
 * A journal call failed. `storage`: the store could not read or write. `bad_entry`: a saved value
 * that is no entry. `cause` keeps the store's error underneath.
 *
 * @category errors
 */
export class JournalError extends Schema.TaggedError<JournalError, { readonly brand: unique symbol }>()(
  "JournalError",
  {
    reason: Schema.Literals(["storage", "bad_entry"]),
    cause: Schema.Defect(),
  },
) {}
```

The doc comment's "when there is one" goes: after this change there always is one, and a comment that
says otherwise teaches the old shape (0562).

```ts
// next/packages/libfabrika/src/client/Commands.test-support.ts, inside `around`, a sketch: the
// tests step picks the exact words, and each names the cut (which call, before or after it delegates)
if (before === "fail") {
  return yield* JournalError.make({
    reason: "storage",
    cause: new Error(`planted cut: journal ${op} failed before it delegated`),
  });
}
// ...
if (after === "fail") {
  return yield* JournalError.make({
    reason: "storage",
    cause: new Error(`planted cut: journal ${op} failed after it delegated`),
  });
}
```

```ts
// next/packages/libfabrika/src/client/Hands.types.test.ts, L3, a sketch after slice 1's
// permissions/Rebac.types.test.ts. Line 18's type-only import becomes
// `import { JournalError, type Entry, type Journal } from "./Journal.ts";`, since L3 calls the maker.

/**
 * T1062 slice 3, L3 (docs/plan/quests/error-cause-client-PLAN.md, decision 0568): the one product
 * maker of JournalError passes the store's failure (`JournalStore.ts:13-14`), so its cause is
 * required and no other site can leave it out. Never called.
 * Plant: make `Journal.ts:57` `Schema.optional(Schema.Defect())` again; the `@ts-expect-error` goes
 * unused and the typecheck fails.
 */
const uncaused = (cause: unknown) => {
  // @ts-expect-error every maker of JournalError has a cause, so the field is required (0568).
  const bare = JournalError.make({ reason: "storage" });
  const kept = JournalError.make({ reason: "bad_entry", cause });
  return { bare, kept };
};

it("type: T1062 L3 a JournalError is never made without its cause, and its cause is any value", () => {
  expectTypeOf<JournalError["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<ReturnType<typeof uncaused>["kept"]>().toEqualTypeOf<JournalError>();
  expectTypeOf(uncaused).toBeFunction();
});
```

- The law's label is the `type:` title prefix, as the `fabrika/law-shape` lint rule reads it on today's
  main and as slice 1 wrote it ([0527](../../../.decisions/0527-type-laws-get-a-type-label.md)). If
  https://github.com/kamp-us/tea-fabrika/pull/1497 (decision
  [0580](../../../.decisions/0580-law-options-carry-plant-and-label.md), labels and plants as options)
  merges before the tests step, the step writes the law the way that rule then asks. A call, 90%.
- `make` and `new` take the same input type in Effect 4.1.3 (`S["~type.make.in"]`,
  `effect/src/Schema.ts:17433-17436` and `:17562`), so one maker call covers both. The product and the
  fakes both use `make`, so L3 does too.
- **Is this a setting?** No. The form of a schema field is a code shape, the same on every install
  ([0069](../../../.decisions/0069-choices-are-settings.md)). The cut's message is test text.
- **Where it lives:** all three files exist in libfabrika's `client` module, the hands client's own
  contract, which a from-scratch client would need as is (`next/AGENTS.md`'s libfabrika test). No new
  file.

## One value traced

A journal write that the law cuts before it delegates, in
`next/packages/libfabrika/src/client/HandsStart.laws.test.ts` through `cutJournal`:

1. The law arms `{ op: "write", at: "before", mode: "fail" }` (`HandsStart.laws.test.ts:206`).
2. The hands client's `journal_write` interpreter calls `journal.write` (`HandsStart.ts:135`), which
   is `cutJournal`'s `around("write", ...)`. `take` answers `"fail"`, and today it fails with
   `JournalError.make({ reason: "storage" })`, a value with no `cause` key. After this change it fails
   with `cause: new Error("planted cut: journal write failed before it delegated")`, and with the
   required field the compiler would refuse the old call.
3. `Effect.mapError(plain)` spreads it: `{ _tag: "JournalError", reason: "storage" }`, the same record
   as before, since the `Error` cause is not enumerable.
4. tea settles `journal_write_err` with that record, and `HandsMachine.ts:812-816` counts a try and
   sets `due`. The law sees the same retry as today and stays green.
5. In `Hands.types.test.ts`, L3's `bare` call has no `cause`: under `Schema.Defect()` the compiler
   reports a missing property, which the `@ts-expect-error` consumes. Under today's `optionalKey`
   there is no error, so the directive is unused and the typecheck fails: L3 is red before the build
   and green after it.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L3, `JournalError` cannot be made without a cause, and a cause of any value makes one: a `@ts-expect-error` on a `make` with no cause, and the kept call's type is `JournalError` | type | type | make `Journal.ts:57` `Schema.optional(Schema.Defect())` again: the `@ts-expect-error` goes unused and the typecheck fails | next/packages/libfabrika/src/client/Hands.types.test.ts |
| T1 and the hands-client laws stay green: the contract's types, and every cut in `HandsStart.laws.test.ts` and `hands-client.test.ts` answers as before with the fakes' new cause | type | type | drop the cause from one cut fake: the typecheck fails at `Commands.test-support.ts` | next/packages/libfabrika/src/client/Hands.types.test.ts |

Notes on the laws:

- L3 is the parent plan's L3 for this one class. No L4 or L5: those cover errors that become
  optional and placeholder sites, and `JournalError` is neither.
- The second row adds no law. It names what must stay green; the existing properties in
  `next/packages/libfabrika/src/client/HandsStart.laws.test.ts` and
  `next/apps/fabrika/src/hands-client.test.ts` keep their own plants.
- The plant is run once by the tests step and recorded in its run row, never committed
  ([0093](../../../.decisions/0093-laws-walk-plants-run-once.md)).
- **No host-only law.** Nothing needs launchd, the real app, a real process or a signal. No
  `.integration.` file changes.

## Files

| File | Owner | Product lines expected | What changes |
|---|---|---|---|
| `next/packages/libfabrika/src/client/Journal.ts` | build | 2 | `cause` becomes `Schema.Defect()` (line 57), and the doc comment drops "when there is one" (line 49) |
| `next/packages/libfabrika/src/client/Commands.test-support.ts` | tests | tests | the two cut fakes at lines 141 and 153 pass an `Error` cause that names the cut |
| `next/packages/libfabrika/src/client/Hands.types.test.ts` | tests | tests | L3: `JournalError` imported as a value, the `uncaused` function and one `type:` law |
| `next/packages/libfabrika/src/client/HandsStart.laws.test.ts` | tests | 0 | no change: its cuts must stay green with the new cause |
| `next/apps/fabrika/src/hands-client.test.ts` | tests | 0 | no change: it runs `cutJournal` too and must stay green |
| `next/packages/libfabrika/src/client/HandsMachine.laws.test.ts` | tests | 0 | no change: its model's records at lines 413 and 431 are tea's view, which carries no cause |
| `docs/plan/quests/error-cause-client-PLAN.md` | lead | docs | this plan |

`next/packages/libfabrika/src/client/JournalStore.ts` and `next/packages/libfabrika/src/client/HandsStart.ts`
do not change: the first already passes a cause, and the second's spread is the finding below.

## Existing tools

- No new helper, function or file. The cut fakes' cause is a plain `Error`, the platform's own; I
  searched `next/packages/libfabrika/src` for a shared "planted failure" error a test fake uses
  (`rg -n "new Error\(\`?planted|PlantedCut|cutError"`) and found none, and slice 1's
  `codehost/CodeHostTest.ts` writes its fake's cause as a plain `Error` too. L3's `uncaused` is a
  local `const` in a test file, as slice 1 wrote it.

## Validation

- The tests step: `pnpm format`; then
  `nice -n 15 pnpm exec vitest run --maxWorkers=3 next/packages/libfabrika/src/client/HandsStart.laws.test.ts next/apps/fabrika/src/hands-client.test.ts next/packages/libfabrika/src/client/Hands.types.test.ts`
  (Vitest does not type check, so this shows only that the cut laws still run green with the new
  cause); then `pnpm lint`. L3's red-before-build and its plant are seen by the lead's typecheck,
  not inside a box; the step records both in its run row.
- The build: the one line and the comment in `Journal.ts`, then `pnpm lint`.
- The lead: one `pnpm typecheck` (it is L3's runner, and it proves no other maker leaves out the
  cause), the leak grep, and CI.

## Size

One pull request, which lands whole. Nothing a person sees changes.

1. The client row of slice 3: `Journal.ts`'s cause and comment, the two fakes, and L3. 2 lines.

About 2 product lines and about 25 test lines. Priced from the parent plan's figures for its small
slices (tests about $4, build $2, review $3) and from this slice being a fifth of slice 1's size:
tests about $3, build about $1, review about $2.50, and one send-back at about $2. Confidence 85%:
the doubt is a send-back over the cut message's wording or the law label, if 1497 lands first.

Estimate: 4 steps, $9

## Records

- What is lost if not written now: that the tea record drops the store's cause at
  `HandsStart.ts:84`, seen in one run at `d524d4e6`. It is in this plan and in the finding row below.
- The run rows in `field/runs/` for each step, written by the lead.
- `.patterns/effect-errors-keep-their-cause.md:121` still names `Journal.ts:58` as an `optionalKey`
  cause after this lands. The parent plan's slice 4 rewrites that section ("drops the 12 `optionalKey`
  lines, now zero"), so this plan leaves it alone.
- This plan makes no new decision. It builds [0568](../../../.decisions/0568-error-cause-follows-effect.md)
  as the parent plan cuts it, with 0562 for the fakes.

## What this cannot tell us

- Whether some future maker of `JournalError` will have no failure to wrap and reach for
  `cause: undefined`. The compiler will push it to fill the field; only reading catches a
  placeholder, as the parent plan says.
- That the `@ts-expect-error` line is red today and green after the build is read from Effect's types
  and from slice 1's result for `RelationsError`, the same field shape, not compiled here. The lead's
  typecheck settles it.
- The "cause is not enumerable" fact holds for a truthy cause. A falsy one (`0`, `""`) skips the
  platform's `Error` option and is copied by the spread. No maker passes one: the store's failures are
  error objects, and the fakes pass an `Error`.
- No runtime law checks that `JournalStore` keeps the store's failure as the cause; the required field
  makes the compiler hold that a cause is passed, not which one.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-18-hands-journal-cause-dropped-at-tea","date":"2026-11-18","by":"plan","model":"claude-opus-5-5","rule":"rule_break","location":{"path":"next/packages/libfabrika/src/client/HandsStart.ts","line":84},"says":"In next/ (found while planning ticket 1062's client row), the hands client turns a JournalError into tea's Cmd failure with `({ ...error })`, whose comment says 'field for field', but a spread drops the cause: Effect keeps a truthy cause as a non-enumerable own key, so the store's failure (`JournalStore.ts:14`) never reaches the tea record or the `Journal.read` and `Journal.write` spans (`HandsStart.ts:131-137`), which end with that record.","proof":"At d524d4e6, in next/packages/libfabrika, `node --input-type=module -e` making `JournalError`'s schema with `Schema.optionalKey(Schema.Defect())` and `JournalError.make({ reason: \"storage\", cause: new Error(\"store down\") })` printed `false [ '_tag', 'reason' ]` for `Object.getOwnPropertyDescriptor(e, \"cause\").enumerable` and `Object.keys({ ...e })`. Effect 4.1.3's `effect/src/internal/core.ts:692` passes the cause to the platform Error, and `effect/src/internal/record.ts:19-20` assigns over it. .patterns/effect-errors-keep-their-cause.md says an error keeps the failure under it.","cost":"A journal failure on a hands client shows only `storage` or `bad_entry` in the machine's messages and the spans, never the store error under it, so a live journal fault cannot be told apart from another without a debugger.","head":"d524d4e69b0e9d74a077ac2cb235bc6cc41573c1","ticket":null,"pr":null}
```

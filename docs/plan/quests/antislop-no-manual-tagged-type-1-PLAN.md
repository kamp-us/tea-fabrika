Approved by the lead agent, builds 0562; body 367e1b645fe4
Plancheck-Version: 3

# Plan amendment: the agent-policy exam's control answers are built through the wire's own Answer schema, so its two loose tag types go (ticket 1057, slice AS-no-manual-tagged-type-1)

This amends the slice's work under [the anti-slop install plan](anti-slop-install-PLAN.md), item 8
("the two tag rules"). It is about `next/` only. It covers the last two hits of
`anti-slop-effect/no-manual-tagged-type` on the slice branch at `55e3418c1`, both in
`next/apps/fabrika/src/exam/agent-may.test.ts`: the loose parameter at `:452` and the loose
`Answer` type at `:466`.

```ts
// before, agent-may.test.ts at 55e3418c1
const methodAnswer = (method: string, actual: { _tag: string; reason?: string }) => { /* :452 */ };
type Answer = { _tag: string; reason?: string; result?: unknown }; // :466
methodAnswer("ledger.wait:parked", { _tag: "parked" }); // :619, a known-good control

// after (tried in a scratch edit, typechecked and run, then restored)
import * as Wire from "@kampus/libfabrika/transport/Wire";
type Answer = typeof Wire.Answer.Type;
const methodAnswer = (method: string, actual: Answer) => { /* body unchanged */ };
methodAnswer("ledger.wait:parked", Wire.Answer.cases.parked.make({ stream: "ledger", after: 0 }));
```

**The answer to the brief's question: yes.** Every control and every planted answer can be built
through `Wire.Answer` (`next/packages/libfabrika/src/transport/Wire.ts:87-96`) and stay known-good
or known-bad, because no assertion reads the part that was missing. No assertion is deleted or
narrowed. Decision 0562 does not ask the exam to keep loose answers: it says "A tagged value in a
test is made with the schema's maker" (`.decisions/0562-nothing-teaches-the-wrong-shape.md:121`).

## How others do it

- **Effect's own tests** build a tagged value with its maker or its class, and keep a plain object
  only for a raw wire frame typed as the encoded side (0562's Context reads
  `cluster/MessageStorage.test.ts:377-421` and `rpc/RpcSerialization.test.ts:9-16` at
  `effect@4.1.2`; not fetched again here). These answers are decoded values that the exam's helper
  judges, not bytes, so the first case applies: the maker.
- **This repo already does it** for the same schema: the hands client's test in `next/apps/fabrika/src`
  (its lines 276 and 339-346) builds `Answer.cases.refused.make(...)` and `Answer.cases.ok.make(...)` from
  `@kampus/libfabrika/transport/Wire`, and the real door does it at
  `next/packages/libfabrika/src/gateway/Gateway.ts:1136`.
- The installed Effect is 4.1.3 (the lockfile's line 366, with a patch); `Schema.TaggedUnion`'s
  `cases.<tag>.make` is the API those files use on it.

## Why the earlier try failed, and why the known-bad values survive

The tests step swapped only the two types and stopped. The swap alone makes `tsc --noEmit -p .` in
`next/apps/fabrika` fail on 14 lines, re-run here. Each line, at `55e3418c1`'s numbering:

| Line | What is there | Why the wire type refuses it |
|---|---|---|
| 608 | `{ _tag: "ok" }` or `{ _tag: "refused", reason }` in a ternary | `ok` has no `result` |
| 615 | `{ _tag: "ok" }` | no `result` |
| 619 | `{ _tag: "parked" }` | no `stream`, no `after` |
| 650 | `{ _tag: "ok" }`, a plant that must throw | no `result` |
| 654 | `() => ({ _tag: "ok" })`, a plant | no `result` |
| 661 | `{ _tag: "ok" }`, a plant | no `result` |
| 675 | `knockAnswer(bad, ...)` | `knock` at :663 and the bad at :670 widen the tag to `string`; :670 has no `reason` |
| 696 | `personCall: dispatch` | dispatch at :689 returns a literal whose tag widens to `string` |
| 699 | `Effect.succeed({ _tag: "parked" })` | no `stream`, no `after` |
| 709 | `{ ...clean, call: dispatch }` | the same dispatch |
| 735 | `() => ({ _tag: "ok" })`, a plant | no `result` |
| 738 | `Effect.succeed({ _tag: "ok" })` | no `result` |
| 739 | `Effect.succeed({ _tag: "ok" })` | no `result` |
| 741 | `Effect.succeed({ _tag: "parked" })` | no `stream`, no `after` |

What each assertion reads decides whether a filled-in field changes a verdict:

- `methodAnswer` (`:452-464`) reads `_tag`, and for a refused method compares the whole answer to
  `{ _tag: "refused", reason: "not_for_agents" }`. A parked answer is checked with `toMatchObject`.
  So `ok` with `result: null` is judged exactly as `{ _tag: "ok" }` was, and a parked answer with a
  stream and position passes as before.
- `knockAnswer` (`:519-527`) needs `_tag: "ok"` with a code and a time. The plant at `:670` is bad
  because it is refused, not because it lacks a reason: the four bads each break one field of a
  good knock. A refused answer with a reason still fails `toMatchObject`, so the plant stays red.
- `installedRefusal` (`:529-542`) compares `personCall`'s answer to `{ _tag: "ok", result: { body } }`.
  The dispatch built with `ok.make({ result: yield* h() })` returns that same value.

## The shape

Exactly these lines change, in `next/apps/fabrika/src/exam/agent-may.test.ts`, numbered at
`55e3418c1`. Nothing else in the file moves.

```ts
// after :23, one import (the namespace keeps the local type name Answer free)
import * as Wire from "@kampus/libfabrika/transport/Wire";

// :452
const methodAnswer = (method: string, actual: Answer) => {
// :466
type Answer = typeof Wire.Answer.Type;

// :609-610, the ternary's two values
          ? Wire.Answer.cases.ok.make({ result: null })
          : Wire.Answer.cases.refused.make({ reason: "not_for_agents" }),
// :615
      methodAnswer(`process.send:checklist:${input}`, Wire.Answer.cases.ok.make({ result: null }));
// :619
    methodAnswer("ledger.wait:parked", Wire.Answer.cases.parked.make({ stream: "ledger", after: 0 }));
// :650
      expect(() => methodAnswer(method, Wire.Answer.cases.ok.make({ result: null }))).toThrow();
// :654 and :735, the same plant
    expect(() => personRefusal(() => Wire.Answer.cases.ok.make({ result: null }))).toThrow();
// :661
    expect(() => methodAnswer("ledger.wait:parked", Wire.Answer.cases.ok.make({ result: null }))).toThrow();
// :663, the good knock that the bads spread
      answer: Wire.Answer.cases.ok.make({ result: { code: "123456", until: 1 } }),
// :670, the refused knock plant
      { ...knock, answer: Wire.Answer.cases.refused.make({ reason: "not_for_agents" }) },
// :689, the control dispatch (fixes :696 and :709)
        return h
          ? Wire.Answer.cases.ok.make({ result: yield* h() })
          : Wire.Answer.cases.refused.make({ reason: "unknown_method" });
// :699 and :741
        parkedWait: Effect.succeed(Wire.Answer.cases.parked.make({ stream: "ledger", after: 0 })),
// :738 and :739
      personCall: () => Effect.succeed(Wire.Answer.cases.ok.make({ result: null })),
      call: () => Effect.succeed(Wire.Answer.cases.ok.make({ result: null })),
```

Calls taken, each with its percentage:

- **`result: null` for a bare ok** (90%). `Schema.Json` takes `null`, and no assertion reads
  `result` on these answers. A named result such as `{}` reads as meaning something; `null` says
  "nothing here".
- **`stream: "ledger", after: 0` for parked** (85%). No assertion reads them (`toMatchObject` on
  the tag only). The real door parks on a target stream (`Gateway.ts:1136`); any string fits.
- **`reason: "not_for_agents"` on the refused knock plant** (85%). It is the reason the exam
  already uses, and it keeps the plant about the tag alone.
- **Only the lines the typecheck forces, plus `:663` and `:670` which feed `:675`** (85%). The
  other object literals with a `_tag` in this file (`:413`, `:456`, `:462`, `:520`, `:538`, `:618`,
  `:624`, `:653`, `:697`, `:734`) still typecheck against the wire type. They are hits of the other
  tag rule, `anti-slop-effect/no-manual-tagged-construction`, whose own sweep fixes them (install
  plan item 8). Doubt: a reviewer may prefer one file in one style; doing them here costs about 12
  more lines and changes no verdict.
- **Namespace import `Wire`** (85%). A named `Answer` import would clash with the local type alias
  `Answer` that `PolicyDoor` (`:468-483`) and `personRefusal` (`:446`) use; the module's own name
  is the plain word.

## One value traced through

The parked control at `:619`, after the change:

1. `Wire.Answer.cases.parked.make({ stream: "ledger", after: 0 })` gives
   `{ _tag: "parked", stream: "ledger", after: 0 }`, typed as the parked member of `Answer`.
2. `methodAnswer("ledger.wait:parked", ...)` takes it, since its parameter is now `Answer`.
3. `actual._tag` is a string: the first `expect` holds.
4. The method is `ledger.wait:parked`, so `toMatchObject({ _tag: "parked" })` runs and holds.
5. At `:661` the plant hands the same method `ok.make({ result: null })`: step 4's
   `toMatchObject` fails, `methodAnswer` throws, and `expect(...).toThrow()` holds. Same verdicts as
   with `{ _tag: "parked" }` and `{ _tag: "ok" }`.

## Laws

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| L1: `anti-slop-effect/no-manual-tagged-type` has no hit in `agent-may.test.ts` | lint | lint | put back `actual: { _tag: string; reason?: string }` at `:452`: the rule, forced to error in a scratch config, reports 1 | the scratch count; the folder's lock is the later lock pull request |
| L2: every control and plant answer is a value of the wire's `Answer` | type | type | put back `{ _tag: "ok" }` at `:615`: `tsc --noEmit -p .` in `next/apps/fabrika` fails with TS2345 on that line | `next/apps/fabrika/src/exam/agent-may.test.ts` |
| L3: the exam's verdicts do not change; the four checker and presence props pass and every plant still throws, at the same count of `expect` and `it` lines | test | Effect Arbitrary: Arbitrary.schema | build the `:670` plant as `ok.make` with the good knock's result: "checker plants" goes red, since `knockAnswer` no longer throws (seed 119120, default runs from `runsFor`) | `next/apps/fabrika/src/exam/agent-may.test.ts` |

No host-only law: nothing here needs launchd, the real Electron app or the owner's Mac. The P25
prop stays skipped as it is today, since no policy module exists. No secret is near this work.

## Files

| File | Owner | Product lines expected |
|---|---|---|
| `next/apps/fabrika/src/exam/agent-may.test.ts` | tests | tests (about 20 lines changed) |

It is an exam path, so the tests step makes the change; no product file has a hit, so no build
step. No lint config, tsconfig or lock line changes, and no disable line is added.

## Existing tools

- `Wire.Answer.cases.<tag>.make`, in `next/packages/libfabrika/src/transport/Wire.ts`: searched
  `next/` for `Answer.cases.` and for the wire schemas; found it, already used by
  the hands client's test and `Gateway.ts`. No new helper, function or file.

## Is this a setting?

No new choice is made that a person would set: the filled-in fields are test values no assertion
reads (0069).

## Size

1. This amendment's change: about 20 lines in one exam file. Confidence 90%, measured by the
   scratch edit, which changed the same lines plus `:697`.

Steps: the tests step makes the edit and runs L1 to L3; the review rechecks. One send-back is
possible if a reviewer wants the construction hits too. Priced from the anti-slop install plan's
medians (tests $1.14, review $1.18, from `field/runs.jsonl`, taken from that plan, not recounted).

Estimate: 3 steps, $4

## Records

- **What is lost if it is not recorded now:** nothing new. The step's field row records the hit
  count before and after (2, then 0) and the 14 typecheck lines, so a later reader can see why the
  first try stopped.

## What this cannot tell us

- Whether the real P25 policy binding, once built, answers with exactly the wire's `Answer`. The
  exam now assumes it does; `bindPolicy` (`:485-489`) throws until P25, so no run can check that
  today. If P25 answers with a narrower or wider type, `PolicyDoor` changes with it.
- The rule's count for the whole `next/apps/fabrika` folder: the rule is not on there yet, and this
  file is not the folder's only remaining tag hit for the other rule.

## Open questions

None.

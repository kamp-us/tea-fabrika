---
id: 0579
title: "In next/ and our tooling, @kalfa/vitest gives a law one import: property laws are it.prop or it.effect.prop with Schemas, calls are watched with a Recorder, and hooks, skipIf, runIf and a raw fc.assert are not exported"
status: amended-in-part by [0600](0600-kalfa-quality-holds-test-lint-format.md)
date: 2026-11-15
tags: [tests, recorder, spy, hooks, property, effect-vitest, fast-check, schema, arbitrary, seed, next, tooling]
---

# 0579: In next/ and our tooling, @kalfa/vitest gives a law one import: property laws are it.prop or it.effect.prop with Schemas, calls are watched with a Recorder, and hooks, skipIf, runIf and a raw fc.assert are not exported

**What this decides:** what `@kalfa/vitest` gives a law: how a property law is written, how calls are watched, what is re-exported, and what is not exported.

```ts
// Before: a hand runner, fast-check inputs, a seed in each call.
fc.assert(fc.asyncProperty(arbitrary, (value) => Effect.runPromise(run(value))), { seed: SEED });

// After: Schemas in, Effect's Arbitrary builds the values, a Scope per case. No seed in the law.
it.effect.prop("a trace id round-trips", { id: TraceId }, ({ id }) => Effect.gen(function* () { /* ... */ }));
```

## Context

On 2026-11-15 the owner made several rulings on `@kalfa/vitest` in one walk. This file holds all of them.

[0411](0411-property-data-comes-from-schemas.md) already says a new property draws its data from a
Schema. [0093](0093-laws-walk-plants-run-once.md) lists `it.prop` and `it.effect.prop` as one way to
write a law, beside `fc.assert(fc.property(...))`. Both shapes grew. Many files wrote their own
runner that runs an Effect inside fast-check, and on 2026-11-14 (ticket 936) one shared runner,
`property` in `next/packages/libfabrika/src/Testing.test-support.ts`, was added to replace them.

[0557](0557-kalfa-vitest-is-the-test-toolbox.md) makes `@kalfa/vitest` the one source of test tools,
and it exports no raw `fc.assert`. On 2026-11-15 the owner ruled that property laws use
`@effect/vitest`'s own runner.

Counted on main at commit `6f3c96c46` with `nice -n 19 rg -c --hidden -g '!node_modules'`, summing
matches per line, in `next/` and the three tooling folders (`.agents/`, `oxlint-plugins/`,
`.github/ci/`):

| Pattern | `next/` | Tooling folders |
|---|---|---|
| `it.prop(` or `it.effect.prop(` calls | 482 in 102 files | 38 in 12 files |
| `fc.assert(` calls | 794 in 203 files | 635 in 97 files |
| calls of our `property(` runner, in libfabrika | 279 in 73 files | none |

The owner quoted 442 uses in 90 files for the first row. This count is higher: it covers `next/` and the tooling folders and counts every call site. A different pattern gives a different number, so the sweep recounts when it starts.

Checked on 2026-11-15 against the installed `@effect/vitest` 4.1.3. `it.effect.prop` gives each
generated case its own `Scope`: `makeTester` in `src/internal/internal.ts` wraps the body in
`Effect.scoped` per value, and `Scope` is in the body's environment. A scratch run of 100 cases
logged open, body and close per case, in order. Its timeout interrupts generation, evaluation and
shrinking, and runs finalizers (the doc on `prop` in `src/index.ts`). Our runner's two claimed
extras, a scope per case and no shrinking after a timeout, are already in it.

## Decision

**A property law in `next/` and our tooling is `it.prop` or `it.effect.prop`, with Schemas as its
inputs, so Effect's Arbitrary builds the values. Our `property` runner and the hand-written
Effect-in-fast-check runners go.**

- **Inputs are Schemas.** A law that needs data Effect cannot generate keeps a fast-check arbitrary
  for that input, with a reason beside it, as 0411 says.
- **The seed is set once,** in the package setup: `fc.configureGlobal` and the Arbitrary check
  options. A law carries no `seed`. The sweep checks that each law draws the same first failing case
  before and after the move.
- **`fc.assert(fc.property(...))` and `fc.asyncProperty` with a hand seed are not the way.**
  `@kalfa/vitest` exports no raw `fc.assert` (0557), so a hand runner cannot come back.
- **What goes:** `property` in libfabrika's `Testing.test-support.ts`, and the roughly 107
  hand-written Effect-in-fast-check runners.
- **tea's machine-law tools stay** (0411).

**Binding constraints:**

- A law runs a case in its own `Scope`, which `it.effect.prop` already gives.
- A law written in `it.effect.prop` stops generating, evaluating and shrinking at its timeout.

### The other rulings

- **A `Recorder` is our one way to watch calls.** It answers the open "way to spy" in
  [0555](0555-no-vi-mock-or-domock.md).
  `Recorder.layer(Service, impl, { fails })` records each call (method and args) and fails the named
  methods with the service's own typed error. A law reads `Recorder.calls(Service)`.

  ```ts
  // A sketch. The exact shape gets its own small plan first.
  const layer = Recorder.layer(Clock, impl, { fails: ["now"] });
  const calls = yield* Recorder.calls(Clock); // [{ method: "now", args: [] }]
  ```

- **Test layers stay beside their service**
  ([0538](0538-kampus-vitest-holds-the-test-primitives.md)). The Recorder is the shared helper.
- **Typed against the service's interface,** with no `as unknown as`.
- **It replaces** the `vi.fn` plus `toHaveBeenCalled*` uses and the `spyOn` uses. Counted on main at
  commit `6f3c96c46` with `nice -n 19 rg -c`, in `next/` and the three tooling folders: 27
  `vi.fn(` calls in 9 files, 27 `toHaveBeenCalled*` matches in 9 files, and 73 `spyOn(` calls in 29
  files (the owner said 75). Of the `spyOn` calls, 25 target `crypto`, 12 `globalThis` (`fetch`), 10
  `console` and 11 `process`. Those on `fetch`, `process.kill`, `console` and `crypto` first need
  the product code to reach them through a service. The Recorder replaces them after that.
- **tea's pbt tools and fast-check's generators are re-exported** from the package, so a test has one
  import.
- **Hooks are not exported:** `afterAll` and the rest. A resource is acquired in a scope
  ([0061](0061-resources-are-acquired-in-a-scope.md)).
- **`it.skipIf` and `it.runIf` are not exported.** `lawsOn` and `depth` cover them.

## Consequences

- A sweep moves each `fc.assert` law to `it.prop` or `it.effect.prop`, one folder at a time, and
  deletes `property` when its last caller moves. This decision changes no code.
- Pattern docs that show the old shape change with the sweep and are not edited here. One is
  [`effect-tests-run-in-it-effect.md`](../.patterns/effect-tests-run-in-it-effect.md), which shows a
  seed on one law. It changes when the seed moves to the setup.
- The cost: a law reads its seed from one place and cannot set its own. A case that needs a
  different seed or run count passes Arbitrary check options, not a seed in the body.
- Not decided here: the order the folders move in, how the sweep is split into pull requests, and
  where in the package setup `fc.configureGlobal` lives.

## Amendments

- 2026-11-15: [0580](0580-law-options-carry-plant-and-label.md) moves the plant out of a comment into a `plant` option of the law's declaration, and the label out of the title into an option with a required reason; a title prefix becomes an error, and a CI check holds each plant against the ticket's run row. The rules above on what a plant is and that it is run once and not kept hold.

## Records

- No glossary row: this coins no word.

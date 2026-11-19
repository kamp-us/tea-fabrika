---
id: 0527
title: A law checked only by the compiler takes the `type` label, a fifth beside 0093's four, as an option of its declaration, and lint accepts it only on a body of type assertions
status: accepted
date: 2026-11-14
tags: [tests, laws, labels, lint, types, next]
---

# 0527: A law checked only by the compiler takes the `type` label, a fifth beside 0093's four, as an option of its declaration, and lint accepts it only on a body of type assertions

**What this decides:** a test that checks only types at compile time takes the label `type`, given
as an option of its declaration with its reason, and the law-shape lint accepts that label only
when the test's body asserts types and nothing at run time. [0580](0580-law-options-carry-plant-and-label.md)
moved every label from the title into the options, so a title that starts `type:` is an error.

```ts
// Kept: a type law. The compiler checks it; there are no samples to draw.
it("no service of access/ fails with an error tagged LedgerError", () => {
  expectTypeOf<FromLedger<Sessions>>().toBeNever();
}, { type: "the compiler checks the error tag" });
// Refused by lint: a runtime check under the type label.
it("the session opens", () => {
  expect(open()).toBe(true);
}, { type: "the compiler checks it" });
```

## Context

[0093](0093-laws-walk-plants-run-once.md) says each law is a property, or a fixed example that
carries one of the labels `vector`, `format`, `pinned` or `scenario` and its reason. About seven tests
in `next/` check only types with `expectTypeOf`, for example
`next/packages/libfabrika/src/access/Access.types.test.ts`. They cannot be properties, since the
compiler checks them and nothing is drawn. None of the four labels describes them truthfully.
`pinned:` means a named past bug
([five steps for every check](../docs/direction/five-steps-for-every-check.md)). When
[PR 1199](https://github.com/kamp-us/tea-fabrika/pull/1199) made the law-shape rule block in
`access/`, one such law had to be titled `pinned:` with its reason, as a stopgap. The advice lane
for that PR raised the question, and the owner said yes to a fifth label.

## Decision

**A law that only the compiler checks takes the `type` label with its reason, and the law-shape
rule accepts `type` only on a body made of type assertions.**

- **The label:** the option `{ type: "<what the compiler checks>" }` of the law's declaration,
  beside `vector`, `format`, `scenario` and `pinned`, as
  [0580](0580-law-options-carry-plant-and-label.md) sets for every label. Its reason is required.
  A title that starts `type:` is an error.
- **Its body:** only compile-time assertions: Vitest's `expectTypeOf` and `assertType`, and type
  declarations. A body with a runtime `expect(...)`, `fc.assert` or any other call fails lint under
  the `type` label. That way the label cannot become a way out for a law that should be a property.
- **The other four labels and the property rule are as 0093 and 0580 set them.**

**Binding constraints**

- `type` never excuses a runtime check. A test that mixes a type assertion with a runtime one is a
  property or one of the other four labels.
- The rule that checks the body lives in `oxlint-plugins/law-shape.ts`, beside the label list, with
  its laws and plants, as 0093's rule does.

## Consequences

- `oxlint-plugins/law-shape.ts` adds `type` to its labels and checks the body of a law that
  carries the `type` option. Its message names the fifth label.
- The type laws labeled `pinned` as a stopgap, starting with `Access.types.test.ts:29`, move to
  `type`.
- [0093](0093-laws-walk-plants-run-once.md)'s four labels become five.
- Not decided here: whether `.test-d.ts` files or `vitest typecheck` mode would be the better home
  for type laws. Today they run as plain tests.

## Records

- `.glossary/TERMS.md`: a `type (label)` row beside the other labels.
- `docs/direction/five-steps-for-every-check.md`: the label table gains its `type:` row.

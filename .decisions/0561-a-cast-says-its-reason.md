---
id: 0561
title: In next/ and our tooling, every type cast carries a comment that says the fact the compiler cannot see, so no x as T stands on its own word
status: accepted
date: 2026-11-15
tags: [lint, oxlint, types, cast, type-assertion, comment, reason, next, tooling]
---

# 0561: In next/ and our tooling, every type cast carries a comment that says the fact the compiler cannot see, so no x as T stands on its own word

```ts
// refused: next/packages/libfabrika/src/cloudflare/connection.ts:77. Why is this a ConnectionId?
const client = (yield* attached(ws)).client as ConnectionId;

// taken (a sketch: the marker word is not decided here, and this reason is made up to show the
// form, not checked against the code)
// SAFETY: `attach` is the only writer of this field, and it stores a ConnectionId.
const client = (yield* attached(ws)).client as ConnectionId;

// better, where it fits (a sketch, not compiled): the schema that already decodes the attachment
// gives `client` its type, so there is no cast to explain
const Attached = Schema.Struct({ client: ConnectionId /* , ... */ });
const client = (yield* attached(ws)).client;
```

**What this decides:** that a type cast in `next/` and our tooling needs a written reason, what
the reason must say, and how that is held.

## Context

- `x as T` tells the compiler to stop checking. The compiler cannot say whether it is true, and
  today nothing asks the writer to say why it is.
- **Two lint rules already limit casts. Both are on for the whole repo, in the root `rules` of
  `.oxlintrc.json`.**

  | Rule | What it refuses | What it leaves |
  |---|---|---|
  | `fabrika/no-type-assertions` (`oxlint-plugins/no-type-assertions.ts`) | `as any`; `x as unknown as T` and `x as never as T`, bare or with parentheses; `<T>x` | `as const`, and any single `x as T`, which its own header leaves to review |
  | `typescript/consistent-type-assertions`, with no options | the `<T>x` spelling only. Its plant in `oxlint-plugins/builtin-plants.ts:595` refuses `<number>x` and takes `x as number` | every `as` |

  So a single `x as T` passes both. This decision is about that one.
- The rule comes from a public rule set, https://github.com/K-Mistele/anti-slop, a fork of
  https://github.com/dmmulroy/anti-slop: `require-safety-comment-for-type-assertion`, in
  `src/rules/require-safety-comment-for-type-assertion.ts` (131 lines, read at commit `5360c12`,
  MIT). It runs on oxlint's own plugin API.
- **What that rule asks,** read from its source and its tests:
  - Every `x as T` and `<T>x` needs a comment. `as const` does not. `satisfies` is not a cast.
  - The comment sits before the cast, or before the statement that holds it (an `export` in
    front counts). A line comment or a block comment both do.
  - The comment holds a marker word, a colon and at least one more character. The marker words
    are an option, a list. The default is `SAFETY`.
  - A comment after the cast does not count. A marker with nothing after it does not count.
  - It cannot tell whether the reason is true.
- **Counted on `origin/main` at `98bcdfa22`** by running that rule's own source, unchanged, through
  the installed oxlint 1.90.0 with a throwaway config and its default marker, over `next/`,
  `.agents/`, `oxlint-plugins/` and `.github/ci/` (1,040 files). "Tests" means `*.test.ts(x)`,
  `*Test.ts` and `*test-support*` files.

  | Where | Hits |
  |---|---|
  | `next/` product code | 42 |
  | `next/` tests | 695 |
  | Tooling product code (`.agents/` 32, `oxlint-plugins/` 21, `.github/ci/` 2) | 55 |
  | Tooling tests (`.agents/` 102, `oxlint-plugins/` 17, `.github/ci/` 76) | 195 |
  | All | 987, in 218 files |

  The research that proposed this counted the same 987 (42, 695, 250) with a syntax script of its
  own. That script, run again on `98bcdfa22`, agrees with the rule.
- From the script's notes on each hit: 751 have no comment on the line above, 102 have a comment
  that is not a reason in this form, and 134 sit under an `oxlint-disable` line. By the type cast
  to: 97 are `as never` and 74 are `as unknown`.
- 67 are chains through `unknown`, `never` or `any` (5 in product code, 62 in tests), and each
  chain is two hits. `fabrika/no-type-assertions` already refuses every one, so each carries a
  disable line with a reason: 70 such lines in scope.
- [0554](0554-no-reflect-get-set-has.md) closed the way around the two rules above
  (`Reflect.get`). The research warned that a tighter cast rule moves the problem unless that door
  closes first. It is closed by decision, and its lint change has not landed yet.
- This builds on [0524](0524-no-list-lets-broken-code-pass.md) and
  [0168](0168-old-lint-breaks-are-fixed.md): no list of leftovers, and a new rule turns on where
  its breaks are at zero.

## Decision

**In `next/` and our tooling, every type cast carries a comment that says the fact the compiler
cannot see (owner, 2026-11-15).**

- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **What counts as a cast:** `x as T` and `<T>x`. Not `as const`, and not `satisfies`.
- **What the comment says:** the fact that makes the cast true, and where that fact comes from.
  "The parser above checked this" is a reason. "This is fine" and "needed for types" are not.
- **Where it sits:** before the cast or before its statement, as the rule reads it.
- **This is added to the two rules above, and replaces neither.** `as any`, the double cast and
  `<T>x` stay refused. A reason does not make them pass.
- **Held by a lint rule copied into `oxlint-plugins/`** from the repository named in Context. The
  copy keeps that repository's license notice, and says where it came from. Its tests are written
  in our style, a `*.test.ts` beside the rule.

**Binding constraints**

- No list of allowed leftovers, and no warn level ([0524](0524-no-list-lets-broken-code-pass.md)).
- A cleanup does not add the same sentence to many casts to make a folder pass. Each reason is
  about its own line.
- A fix does not swap the cast for another way past the types: `Reflect`, `Object(x)[key]` or
  `Object.getOwnPropertyDescriptor` (0554).

## Consequences

- This file records the rule and how it is held. The rule's copy and the cleanup are later pull
  requests. The cleanup goes folder by folder, and the rule blocks in a folder when it reaches
  zero (0168). Until then nothing asks a new cast for its reason there.
- **The cost is large:** 987 casts in 218 files, 890 of them
  in tests. Writing 987 true sentences means reading 987 casts. Many will go away in place of
  getting a comment: a decode, a real type, or `satisfies`.
- **False alarms: none measured yet.** [`AGENTS.md`](../AGENTS.md#checks) asks that a check that
  can block has its false alarms measured first, at about 0%.
  [0523](0523-advice-rules-block-where-clean.md) set five named rules aside from that, and this
  rule is not one of them. The research counted the hits and did not read a sample for this rule.
  For this rule a false alarm is a cast where a reason line adds nothing. Known candidates, from
  reading the 42 `next/` product hits: tea's type slot (below), and casts that only give an empty
  value its type, such as `[] as ReadonlyArray<Dispatched>` in
  `next/packages/libfabrika/src/runtime/Runner.ts`.
- **Still to measure before the rule blocks anywhere:** a proper sample of the 987, read by hand
  and sorted three ways: the cast goes away, the cast stays with a real fact, the cast stays and
  the comment would be noise. The third share is the false-alarm rate. The cleanup's plan carries
  that sample, and each pull request that turns the rule on in a folder reports its own numbers.
- **What the rule cannot see:** whether a reason is true, or says anything. Review reads each
  one.
- **Not decided here.** Two points are plumbing for the cleanup's plan. What was found on each:
  - **(a) The marker word: `SAFETY:` or the repo's own `edge:`.** The rule takes a list.
    - `edge:` today is the reason prefix inside an `oxlint-disable-next-line` comment. Counted on
      `98bcdfa22` with `rg` for `oxlint-disable[a-z-]* ...-- edge:` in code files: 413 comments in
      105 files (389 in `next/`, 14 in `.agents/`, 10 in `oxlint-plugins/`, none in
      `.github/ci/`). 350 name only the two edge rules, `fabrika/no-promises` and
      `fabrika/no-effect-run-outside-edge`. 19 name `fabrika/no-type-assertions`. The other 44
      name other rules.
    - What defines it: the rule `fabrika/edge-comment` (`oxlint-plugins/edge-comment.ts`) holds
      the comments of those two rules to one line and an `edge: <why>` reason.
      [No Promises](../docs/direction/no-promises.md) and
      [`oxlint-plugins/README.md`](../oxlint-plugins/README.md) say an edge is the one line a
      platform demands. CI's `edges` step (`next/apps/fabrika/src/exam/edges.ts`) lists each new
      one for the owner. 0168 and 0524 use the word wider: one inline `edge:` line for a line that
      is right where a rule does not fit.
    - Run with `edge` as the marker, the rule fires 948 times, so 39 casts already sit under an
      `edge:` comment (28 in `next/` tests, 11 in `next/` product code).
    - `SAFETY:` appears nowhere in scope as a marker. `edge-comment.ts` and the README name it as
      the industry's match (clippy's `undocumented_unsafe_blocks`).
    - A chain cast already has a disable line with a reason. Whether that line can also be the
      cast's reason, or the cast needs a second comment, follows from the marker.
  - **(b) tea's type slot.** tea 0.25.0 asks for types as empty values:
    `types: { model: {} as State, msg: {} as Msg }` in its README. In scope that is 15 casts on 11
    lines of product code: 9 in `next/` on 8 lines and 6 in `.agents/` on 3, each inside a
    `Machine.make` call or the lead scripts' own `defineMachine`.
    By key: `ctx` 8, `sub` 3, `model` 2, `msg` 2. The value is never read. Either each of the 11
    lines gets one reason line, which the rule accepts for every cast in the statement, or the
    rule knows that slot.
  - The rule's name in our plugin and the folder order of the cleanup.
  - Today's app.
- Not part of this decision, and not decided: `type X = unknown`, `Reflect.apply`, and the two
  `Match` rules from the same rule set.

---
id: 0559
title: In next/ and our tooling, oxc/no-accumulating-spread is on as an error, so no reduce callback or loop copies its running result on every pass, and every old hit is rewritten, never ignored inline
status: accepted
date: 2026-11-15
tags: [lint, oxlint, oxc, spread, reduce, loop, plant, built-in, next, tooling]
---

# 0559: In next/ and our tooling, oxc/no-accumulating-spread is on as an error, so no reduce callback or loop copies its running result on every pass, and every old hit is rewritten, never ignored inline

```ts
// refused: next/programs/pipeline/src/Merger.laws.test.ts:201-254. Each pass copies every
// command gathered so far, so a run of n events makes about n * n / 2 copies.
let out: ReadonlyArray<Command> = [];

for (const event of raw) {
  // ...
  out = [...out, ...commands];
}

// in its place (a sketch, not run): the list grows where it is
const out: Array<Command> = [];

for (const event of raw) {
  // ...
  out.push(...commands);
}

// the same rule refuses the reduce form, which the tree does not have today
const all = lists.reduce((acc, list) => [...acc, ...list], []);
```

**What this decides:** that oxlint's own `oxc/no-accumulating-spread` is on in `next/` and our
tooling, what happens to its 11 old hits, and how a rule with so few hits is shown to work.

## Context

- The rule is built into the installed oxlint 1.90.0. `.oxlintrc.json` does not name it, so it is
  off. It takes no options.
- **What it refuses,** from running it on planted lines: a spread of the accumulator inside a
  `reduce` callback, array or object, and a spread of a `let` back into itself inside a loop. Its
  reason is cost: each pass copies all that came before, so the work grows with the square of the
  length.
- It came up in a read of a public rule set, https://github.com/K-Mistele/anti-slop, which
  recommends this built-in rule beside its own.
- **It was first taken on a count of 0 hits. That count was of `reduce` callbacks only.** The
  research said so: it did not count the loops the rule also reads. The count below is the
  corrected one.
- **Counted again on `origin/main` at `98bcdfa22`** by running the rule itself, alone, through
  oxlint 1.90.0 with a throwaway config over `next/`, `.agents/`, `oxlint-plugins/` and
  `.github/ci/` (1,040 files):

  | Where | Hits |
  |---|---|
  | In a `reduce` callback, anywhere in scope | 0 |
  | In a loop, `next/` product code | 0 |
  | In a loop, `next/` tests | 11, in 5 files |
  | Tooling (`.agents/`, `oxlint-plugins/`, `.github/ci/`) | 0 |

- The 11, each read by hand:
  - **3 grow on every pass,** which is what the rule is for:
    `next/programs/pipeline/src/Merger.laws.test.ts:254` (a list of commands),
    `next/packages/libfabrika/src/settings/TomlEdit.test.ts:374` (a list of markers) and
    `next/packages/libfabrika/src/runtime/Built.test.ts:187` (a record that gains a key).
  - **8 copy a record whose keys do not change,** so nothing grows and the rule's reason does not
    hold: 7 in `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts` (`:629`, `:701`,
    `:824`, `:886`, `:1043`, `:1101`, `:1160`, each
    `current = { ...current, k: ... }`), and
    `next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts:180`
    (`s = { ...s, names: ... }`). Each is the next value of a small fixture or model in a law.
- So 5 folders are not at zero: `next/programs/pipeline/src`, and `cloudflare`, `settings`,
  `runtime` and `processes/internal` under `next/packages/libfabrika/src`. Every other folder in
  scope is.
- **An earlier note left this rule off.**
  [Oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md), decided 2026-10-31 for the whole repo,
  lists it under rules "left off, because they fired falsely": 5 fires, "spreads in loops: a speed
  hint, not a bug". Run the same way, today's app has 5 fires in 4 files today. This file replaces that call
  for `next/` and our tooling, and the note gets a pointer. For today's app the row stands.
- **The plant is how a quiet built-in rule is shown to work.** Tracker ticket 438 turned on 124 of
  oxlint's own rules that had 0 hits on 2026-11-09, and gave each one a plant: an entry in
  `oxlint-plugins/builtin-plants.ts` with the rule's code, a line the rule must refuse and, for
  most, a line it must take. `oxlint-plugins/plants.test.ts` writes each plant to a file beside
  itself and runs it through the repository's own `.oxlintrc.json`, so the config is what refuses
  the line ([`oxlint-plugins/README.md`](../oxlint-plugins/README.md)).
  [0093](0093-laws-walk-plants-run-once.md) says such planted lines are the rule's test inputs and
  stay.
- This builds on [0168](0168-old-lint-breaks-are-fixed.md): a new rule turns on where its breaks
  are at zero, folder by folder. And on [0524](0524-no-list-lets-broken-code-pass.md): no list of
  leftovers.

## Decision

**In `next/` and our tooling, `oxc/no-accumulating-spread` is on, as an error (owner, 2026-11-15).**

- **What was ruled.** The owner was shown the corrected count (11 hits, 3 that grow, 8 that do
  not) and the 2026-10-31 record, and ruled on this rule by name: it is on. His stated direction
  is wider: a check that finds real faults goes on, whatever the size of the change.
- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **It replaces the call of 2026-10-31** in
  [Oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md) for `next/` and our tooling. That note
  left the rule off as a speed hint with false fires.
- **All 11 are hits, and all 11 are rewritten.** The 3 that grow on every pass grow in place. The
  8 that copy a record with fixed keys are rewritten too, so the value is not spread back into
  itself.
- **No inline ignore for this rule.** A rewrite that is plainly worse than the line it replaces
  is shown to the owner, with the code, and he decides. It is never settled by an
  `oxlint-disable` line.
- **It starts at zero** ([0168](0168-old-lint-breaks-are-fixed.md)): the 11 are rewritten before
  or with the config line, and where that is split, the rule blocks in each folder as it reaches
  zero. It blocks in the pull request and in the merge line. It is never a warning.
- **It gets a plant, in the shape ticket 438 gave the other built-in rules:** one entry in
  `oxlint-plugins/builtin-plants.ts`, run by `plants.test.ts` through the repository's own config.
  These lines were run through oxlint 1.90.0 for this file and answer as marked:

  ```ts
  // a sketch of the entry, not yet in builtin-plants.ts
  {
    code: "oxc(no-accumulating-spread)",
    prelude: ["declare const xs: number[];"],
    lines: [
      ["export const a = xs.reduce((acc: number[], x) => [...acc, x], []);", true],
      ["export const b = xs.reduce((acc: number[], x) => { acc.push(x); return acc; }, []);", false],
    ],
  }
  ```

**Binding constraints**

- No list of allowed leftovers, and no warn level ([0524](0524-no-list-lets-broken-code-pass.md)).
- No `oxlint-disable` line names this rule. A hit is rewritten, or it goes to the owner.
- A fix does not move the same copy somewhere the rule does not look, such as `acc.concat(x)` or
  `Object.assign({}, acc, x)` inside the callback.
- The plant lands in the same pull request as the config line. A rule on with no plant has shown
  nothing.

## Consequences

- This file records that the rule is on and how it is held. The config line, the plant and the 11
  fixes are later pull requests. Until the config line lands, nothing stops a new one.
- **The cost is small:** 11 lines in 5 test files. The 3 that grow each become a `push` or an
  assignment to a key.
- **8 in 11 is far from what `AGENTS.md` asks of a blocking check.**
  [`AGENTS.md`](../AGENTS.md#checks) asks that a check that can block has its false alarms
  measured first, at about 0%, and [0523](0523-advice-rules-block-where-clean.md) set only five
  named rules aside from that. By the rule's own reason, cost that grows, the 8 record copies are
  false alarms: nothing grows there. The rule has no option that leaves loops out. It is on anyway,
  by the owner's ruling, and he counts the 8 as hits.
- **7 of the 8 sit in one file,** `reload.laws.test.ts`, as the next value of a small fixture in a
  law. The pull request that rewrites them reports each one, and brings any rewrite that reads
  plainly worse to the owner with both versions.
- **Still to measure:** the false alarms on new code. All 11 hits are old. The pull requests that
  land after the rule is on show whether new loop hits are growth or fixed-size copies.
- **Not decided here:**
  - Where the line goes in `.oxlintrc.json`. The 124 rules of ticket 438 sit in the root `rules`,
    which also covers today's app, where this rule has 5 hits. The plan of the lint change says.
  - Today's app.

## Records

- [Oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md): a one-line pointer under its table of
  rules left off.

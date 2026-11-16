---
id: 0558
title: In next/ and our tooling, no ternary nests more than 2 deep, so a deeper choice becomes a lookup, a named function or a real machine, never a longer if chain in its place
status: accepted
date: 2026-11-15
tags: [lint, oxlint, ternary, conditional, state-machine, lookup, readability, next, tooling]
---

# 0558: In next/ and our tooling, no ternary nests more than 2 deep, so a deeper choice becomes a lookup, a named function or a real machine, never a longer if chain in its place

```ts
// before: next/programs/pipeline/src/Merger.ts:409, 5 deep. Which states refuse which Msg?
refuse: (s, m) =>
  m.type === "land"
    ? s._tag === "idle"
      ? null
      : { reason: "busy" }
    : m.type !== "abandon"
      ? null
      : s._tag === "idle"
        ? { reason: "idle" }
        : s._tag === "merging"
          ? { reason: "merging" }
          : m.ref !== s.job.ref
            ? { reason: "other_job" }
            : null,

// after (a sketch, not compiled): each question has a name, and none is more than 2 deep
const landRefused = (s: Model) => (s._tag === "idle" ? null : { reason: "busy" });

const abandonRefused = (s: Model, ref: string) =>
  s._tag === "idle" || s._tag === "merging" ? { reason: s._tag } : s.job.ref === ref ? null : { reason: "other_job" };

refuse: (s, m) => (m.type === "land" ? landRefused(s) : m.type === "abandon" ? abandonRefused(s, m.ref) : null),
```

**What this decides:** how deep a ternary may nest in `next/` and our tooling, what a deeper one
turns into, and how the limit is held.

## Context

- A deep ternary is a state machine nobody named. Each level asks one more question about a state
  or a Msg, and the answer table exists only as indentation.
  [0037](0037-implicit-state-machines-made-explicit.md) already says a machine is one named type
  with its transitions in one place, and [0046](0046-one-tea-machine-per-file.md) says its form.
- The idea comes from a public rule set, https://github.com/K-Mistele/anti-slop, a fork of
  https://github.com/dmmulroy/anti-slop. Its rule `max-ternary-depth` is in
  `src/rules/max-ternary-depth.ts` (84 lines, read at commit `5360c12`). The repository is MIT
  licensed. Its README registers the rules through oxlint's `jsPlugins`, under the name
  `anti-slop`. Only the fork has this rule.
- **What the rule counts,** read from that source:
  - A ternary's depth is 1 plus the depth of the deepest ternary that sits directly in its test,
    its "then" branch or its "else" branch.
  - "Directly" looks through parentheses, `as`, `satisfies`, `<T>x` and `!`, and through nothing
    else. A ternary inside a call's arguments, an object or array literal, a template string, an
    arrow function or an `&&` starts its own count.
  - An "else" chain counts the same as nesting in the "then" branch. Three questions in a row are
    3 deep.
  - It reports once, on the outermost ternary, and only when the depth is more than the limit.

  ```ts
  const a = ready ? "go" : "wait"; // 1 deep: allowed
  const b = ready ? "go" : late ? "late" : "wait"; // 2 deep: allowed
  const c = ready ? "go" : late ? "late" : lost ? "lost" : "wait"; // 3 deep: refused
  ```

- **Counted on `origin/main` at `aab175e68`** by running that rule's own source, unchanged, through
  the installed oxlint 1.90.0 with a throwaway config, over `next/`, `.agents/`, `oxlint-plugins/`
  and `.github/ci/` (1,040 files). "Tests" means `*.test.ts(x)`, `*Test.ts` and `*test-support*`
  files.

  | Where | Hits |
  |---|---|
  | `next/` product code | 13 |
  | `next/` tests | 104 |
  | Tooling product code (`.agents/` 4, `oxlint-plugins/` 6, `.github/ci/` 2) | 12 |
  | Tooling tests (`.agents/` 8, `oxlint-plugins/` 4, `.github/ci/` 4) | 16 |
  | All | 145, in 87 files |

- By depth: 94 are 3 deep, 28 are 4, 14 are 5, 5 are 6, 2 are 7 and 2 are 8. The two at 8 are
  `next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts:207` and
  `next/packages/libfabrika/src/runtime/RunnerAdmissionTest.ts:727`. In product code the deepest
  are 5: `Merger.ts:409`, `next/packages/libfabrika/src/client/WindowMachine.ts:1175`,
  `next/packages/libfabrika/src/runtime/Runner.ts:2062` and
  `next/packages/tuval/src/window/main.tsx:321`.
- The research that proposed this counted the same 145 (13, 104, 28) with a syntax script of its
  own. That script, run again on `aab175e68`, agrees with the rule, and it also counts 423
  ternaries that are exactly 2 deep, which pass.
- **Existing rules looked at** ([0040](0040-existing-tools-before-hand-written.md)). oxlint 1.90.0
  ships two, and neither takes a depth. Run the same way on the same files:
  `eslint/no-nested-ternary` refuses any nesting and fires 801 times;
  `unicorn/no-nested-ternary` allows one nested level only inside parentheses and fires 568 times.
  Neither can say "2".
- [0046](0046-one-tea-machine-per-file.md)'s amendment of 2026-11-10 keeps a plain conditional on
  `_tag` inside a tea machine's `update`. That stands. This file caps how deep such a conditional
  nests when it is a ternary. 0046's status does not change, and it gets a one-line pointer.
- This builds on [0524](0524-no-list-lets-broken-code-pass.md) and
  [0168](0168-old-lint-breaks-are-fixed.md): no list of leftovers, and a new rule turns on where
  its breaks are at zero.

## Decision

**In `next/` and our tooling, no ternary nests more than 2 deep (owner, 2026-11-15).**

- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **What counts** is what the rule counts, as listed in Context: the three examples there are the
  rule.
- **A deeper one turns into one of three things:**
  - a lookup: a record keyed by the state or the Msg, read once;
  - a named function: the question gets a name that says what it answers;
  - a real machine: when the ternary passes 0037's two tests, it is a tea machine (0046).
- **Never a longer `if` chain pasted in its place.** The same branches written with `if` and
  `else` are the same unnamed machine with more lines.
- **Held by their rule as it ships: `anti-slop/max-ternary-depth`,** with `maxDepth` at 2, its
  default. It comes from the plugin named in Context, registered through `jsPlugins`. We do not
  write or copy a version of our own (owner, 2026-11-15). The decision "We use the anti-slop lint
  plugin as it ships", 0563 in its own pull request, holds the rules for every rule taken from
  that plugin.
- **It blocks in the pull request and in the merge line,** as every lint rule does. Nothing counts
  hits on a schedule.
- **An exception is one inline ignore with its reason,** in the form `AGENTS.md` already has:
  `// oxlint-disable-next-line anti-slop/max-ternary-depth -- <why>`.

**Binding constraints**

- No list of allowed leftovers, and no warn level ([0524](0524-no-list-lets-broken-code-pass.md)).
  The old ones are fixed, never listed.
- A fix does not hide the depth from the rule: no wrapping a branch in a call, an `&&` or a
  one-use arrow function only to restart the count, and no `if` chain that asks the same questions
  in the same order.
- A fix in a tea machine keeps 0046: the next state is still picked inside `update`, and nothing
  outside the machine's file builds its Model.

## Consequences

- This file records the limit and how it is held. Installing the plugin and the cleanup are later
  pull requests. The cleanup goes folder by folder, and the rule blocks in a folder when it reaches
  zero (0168). Until then nothing stops a new deep ternary there.
- **The cost:** 145 ternaries in 87 files, 117 of them in `next/` and 104 of those in tests. 94
  are one level over the limit. The 25 in product code each need a name or a table that someone
  has to think of, so they are not one-line changes.
- **A flat chain of three questions is refused too.** `a ? 1 : b ? 2 : c ? 3 : 4` reads like a
  small table, and it is 3 deep. A lookup or a named function takes its place.
- **What the rule cannot see:** a deep choice split over a call or an `&&`, as the first binding
  constraint names. Review reads for that.
- **False alarms, measured and still to measure.** `AGENTS.md` asks that a check that can block
  has its false alarms measured first, at about 0%.
  [0523](0523-advice-rules-block-where-clean.md) set five named rules aside from that, and this
  rule is not one of them. The research read 8 of its hits by hand, and all 8 were hard to read.
  That is enough to take the rule, not enough to let it block. Before the rule blocks in a
  folder, the pull request that turns it on there reports every hit it met, each fix, and each hit
  where the ternary was the clearest form. The number 2 is that rule set's default, not something
  we measured.
- **Not decided here:**
  - Effect's `Match` in place of a ternary. 0046 keeps the plain conditional inside `update`, and
    the two `Match` rules from the same rule set are not taken.
    Since decided: [0567](0567-a-tagged-value-is-matched.md) takes both rules and supersedes that
    amendment of 0046, so a check on `_tag` in this file's sketch is written as a match. The cap
    of 2 holds as written.
  - The folder order of the cleanup. The plan of that work says.
  - Today's app.

## Records

- [0046](0046-one-tea-machine-per-file.md): a one-line pointer. Its status does not change.

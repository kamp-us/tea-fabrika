---
id: 0580
title: A law's plant and label are options of its declaration, never a comment or a title prefix, and a CI check holds each plant against the ticket's run row
status: accepted
date: 2026-11-15
tags: [tests, laws, plants, labels, lint, ci, field, vitest, next, tooling]
---

# 0580: A law's plant and label are options of its declaration, never a comment or a title prefix, and a CI check holds each plant against the ticket's run row

**What this decides:** a law says its plant and its label in the options of its own declaration, `@kalfa/vitest` adds those options on top of Effect's `it`, and a CI check makes the plant real.

```ts
// Before: the plant lives in a comment, the label in the title.
// Plant: drop the press row from the record
it.effect("scenario: a reply after the deadline is dropped", body);

// After: both are options. Each carries its reason as a required value.
it.effect("a reply after the deadline is dropped", body, { plant: "drop the press row", pinned: 646 });
it.effect.prop("a trace id round-trips", { id: TraceId }, body, { plant: "keep the old id" });
it.effect("the file reads as a person writes it", body, { format: "keybindings.toml by hand" });
```

## Context

On 2026-11-15 the owner ruled twice, on one plan. First: a law's plant moves from a comment into its
declaration. Second: the law's label moves from the title into the options too, so there is one way
to say everything about a law.

How laws record plants today: [0093](0093-laws-walk-plants-run-once.md) says each plant is run once
and recorded in the report and in the run row (`plants: [{ law, plant, result }]`, `field-schema.ts`),
and nothing in the law file holds it. So each law's author writes it in a comment. Counted on main at
commit `f7d973e4a` with `nice -n 19 rg` in `next/` test files (`*.test.ts`, `*.test.tsx`): 450 comment
lines that match `//.*plant:` (case-insensitive) and 144 test titles that contain `plant`, 594 in all.
The owner's figure was about 597. Counted that way, with no parse, it is a count of lines, not of
laws: one law can carry two, and a comment can sit beside no law.

Labels today: [0093](0093-laws-walk-plants-run-once.md) and
[0527](0527-type-laws-get-a-type-label.md) say a fixed test's title starts with `vector:`, `format:`,
`pinned:`, `scenario:` or `type:`, with an optional id before it. Counted on main with `rg -U -P` for
an `it` or `test` call whose title starts with a label after at most one id: 335 in `next/` and 341 in
`.agents/`, 676 in the two folders `oxlint-plugins/law-shape.ts` reads. The whole repo has 936, since
`oxlint-plugins/` and `.github/ci/` carry more. The owner's figure was about 720. A parse of the test
calls, not a regex, would settle the gap.

The known way: Effect's `it.effect(name, body, timeout?)` takes an options object, and vitest's own
`test(name, { timeout, retry, tags }, fn)` puts a test's facts in options, never in its name.
[0579](0579-property-laws-use-it-prop.md) already has `@kalfa/vitest` add `it.prop` on top of Effect's `it`.

## Decision

**A law's declaration carries its plant and its label as options, `@kalfa/vitest` adds them, and a CI check refuses a law whose plant is not in the ticket's run row.**

- **`plant` is an option on `it`, `it.effect`, `it.prop` and `it.effect.prop`.** Its value is a plain
  string: the break that makes the law fail. A law in `next/` or our tooling names one.
- **The label is an option, with a required reason.** `{ vector: "<source>" }`, `{ format: "<what>" }`,
  `{ scenario: "<why one case>" }`, `{ type: "<what the compiler checks>" }`, and `{ pinned: <ticket> }`,
  where a pinned law names the ticket of the bug it pins. A law has at most one label, and the type
  makes two a compile error.
- **A title prefix becomes an error.** `oxlint-plugins/law-shape.ts` reads the option, not the title
  prefix, and reports a title that starts with a label, with a message that names the option.
- **The `field` check.** In the `field` step of the `check` job (`.github/workflows/check.yaml`, run
  by `.github/ci/field-check.ts`), for each law a pull request adds or changes, the law names a
  plant, and the ticket's run row in `field/runs/` lists the same plants. Otherwise the check is red,
  naming the law with `file:line` and citing [0093](0093-laws-walk-plants-run-once.md).
- **Binding: the `plant` option is not built without the check.** The two ship in the same pull request.

**Binding constraints:**

- `plant` is not a way to keep a plant test. The plant is still run once and never committed, as
  [0093](0093-laws-walk-plants-run-once.md) says. The option records it.
- The sweep moves the 594 plant lines and the labeled titles (676 in the two folders law-shape reads)
  one folder at a time, with no find-and-replace over the tree.

## Consequences

- **Does a setup-file change rerun every law? Measured on main, yes, for four of five projects.** The
  setup file is `scripts/vitest.setup.ts`, named in `setupFiles` of the root config's shared options
  (`vitest.config.ts`); `next/packages/vitest` has no setup file of its own yet, so the seed 0579
  moves there means a new one. The `next-visual` project sets `extends: false` and keeps none. In a
  scratch worktree, a one-line change to that file and
  `volta run --node 26.13.0 pnpm exec vitest list --changed HEAD~1 --filesOnly` listed 931 test files
  (today 457, tooling 133, next 196, next-integration 145, next-visual 0), and the unfiltered
  `vitest list --filesOnly` listed 943. The unfiltered list is refused locally ("Local broad test run
  refused") and ran under `CI=1`. The 12 files left out are the `next-visual` ones, so a setup change
  reruns every law outside that project. For 0579's seed: moving it to a setup file makes any seed
  edit a full run on every project but `next-visual`.
- **Skill and pattern text that changes with the sweep.** `.agents/skills/tests/SKILL.md` (steps on
  plants and on labels, around lines 32 to 110), `.agents/skills/review/SKILL.md` and
  `.agents/skills/plan/SKILL.md` (where they name the labels), `.agents/skills/lead/SKILL.md`,
  `oxlint-plugins/README.md`, `docs/direction/five-steps-for-every-check.md` (the label table and
  its examples), and `.patterns/effect-services-and-layers.md`. A sweep pull request edits each.
- `oxlint-plugins/law-shape.ts` and its test change: the option replaces the title read, and the
  `type:` body rule of [0527](0527-type-laws-get-a-type-label.md) follows the `type` option.
- A new field-check test per case: a law with no plant, a plant the row lacks, a row plant no law
  names, and a law the pull request did not touch.
- The cost: the check reads test sources in a CI step that today reads rows only. It runs on the
  `field` flag, so a pull request of code changes must also set it. How is for the build's plan.
- Not decided here: the order of folders in the sweep, how the changed-law diff is read (a parse of
  the calls, not a regex), and the option names beyond the six above.

## Records

- No glossary row: no new word. `plant` and the five labels keep their meanings.
- Amends [0093](0093-laws-walk-plants-run-once.md), [0527](0527-type-laws-get-a-type-label.md) and
  [0579](0579-property-laws-use-it-prop.md) with a dated line each.

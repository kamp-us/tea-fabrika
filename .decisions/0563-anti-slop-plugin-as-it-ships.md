---
id: 0563
title: In next/ and our tooling, we use the anti-slop lint plugin as it ships, pinned to one exact version, and never write or copy our own version of a rule its authors already wrote
status: accepted
date: 2026-11-15
tags: [lint, oxlint, plugin, anti-slop, jsplugins, inline-ignore, existing-tools, next, tooling]
---

# 0563: In next/ and our tooling, we use the anti-slop lint plugin as it ships, pinned to one exact version, and never write or copy our own version of a rule its authors already wrote

```jsonc
// a sketch of .oxlintrc.json, not run: their two entry points, their rule names, nothing rewritten
"jsPlugins": [
  "./oxlint-plugins/index.ts",
  { "name": "anti-slop", "specifier": "<the plugin's index.ts, at the pinned version>" },
  { "name": "anti-slop-effect", "specifier": "<the plugin's effect/index.ts>" }
],
"rules": {
  "anti-slop/max-ternary-depth": ["error", { "maxDepth": 2 }]
}
```

```ts
// an exception is one line, in the form AGENTS.md already has, with a real reason (a made-up door)
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this door decodes `raw` with a Schema first
export const open = (raw: unknown) => Schema.decodeUnknownEffect(Frame)(raw);
```

**What this decides:** how every rule we take from the anti-slop plugin comes into `next/` and our
tooling, how it blocks, what an exception looks like, and which of its rules are taken, refused or
waiting today.

## Context

- The plugin is a public set of oxlint rules, https://github.com/K-Mistele/anti-slop, a fork of
  https://github.com/dmmulroy/anti-slop. Read at commit `5360c12` of the fork, through its README,
  `package.json` and `src/`.
- **License:** MIT, in both repositories (`LICENSE`, and `"license": "MIT"` in `package.json`).
- **What it holds:** 27 rules in two entry points. `src/index.ts` is the plugin `anti-slop`, with
  20 general rules. `src/effect/index.ts` is a second plugin, `anti-slop-effect`, with 7 rules for
  Effect code. Its README registers both through oxlint's `jsPlugins`, as `anti-slop/<rule>` and
  `anti-slop-effect/<rule>`. The rules are written for oxlint's own plugin API
  (`@oxlint/plugins`), which our installed oxlint 1.90.0 has.
- **How it is installed, as found:**
  - `package.json` names it `oxlint-plugin-anti-slop`, version `0.1.2`, and marks it
    `"private": true`. Its README says there is no official npm package, and that the project is
    meant to be copied into a repository.
  - The npm registry does hold a package of that name, at `0.0.0`: one file of 62 bytes from
    another publisher. It is not this code.
  - Neither repository has a tag or a release. So the only exact version is a full commit.
  - That leaves two ways to have it "as it ships": a git dependency pinned to one full commit
    (`github:K-Mistele/anti-slop#<commit>`), or its `src/` folder brought in whole and unchanged
    at one commit, which is what its README describes. Neither was tried for this file.
  - Things the install will meet: the package pins `@oxlint/plugins` at `1.86.0` and ours is
    `1.90.0`; its README asks that the two match exactly. It has a `prepare` script
    (`effect-tsgo patch --oxlint`) that a git install may run. Its `exports` names only
    `./src/index.ts`, so the Effect entry point is reached by path.
- **Only the fork has `max-ternary-depth`,** and the fork replaced the parent's
  `no-conditional-empty-object-spread` with the wider `no-conditional-spread`. So the fork is the
  one we use.
- The research that read all 27 rules against this repository counted each with a syntax script of
  its own, over `next/`, `.agents/`, `.github/` and `oxlint-plugins/`. The numbers below are that
  script's, run again on `origin/main` at `98bcdfa22`. Two were also checked by running the rule itself;
  the decisions for those say so.
- [0040](0040-existing-tools-before-hand-written.md) already says an existing, widely used tool
  comes before a hand-written check. This file applies it to this plugin, and goes one step
  further: no copy that we then change.
- [0554](0554-no-reflect-get-set-has.md) and [0555](0555-no-vi-mock-or-domock.md) were written
  before this ruling, and each names an oxlint built-in rule as its hold. Each gets a one-line
  pointer here.

## Decision

**We use the anti-slop plugin as it ships. We do not write or copy our own version of a rule its
authors already wrote (owner, 2026-11-15).**

- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **A. As it ships.** The plugin is registered through `jsPlugins` under its own names, and a rule
  is turned on by its own name with its own options. Its source is not edited. It is pinned to
  one exact version, which today means one full commit.
- **B. It blocks where lint blocks.** Each rule is a lint rule that runs in the pull request and in
  the merge line, and fails them. There is no scheduled count and no dashboard of counts.
- **C. An exception is one inline ignore, on the line, with its reason:**
  `// oxlint-disable-next-line anti-slop/<rule> -- <why>`, the one form
  [`AGENTS.md`](../AGENTS.md#checks) already has. No named wrapper type marks a value as allowed.
- **D. Each rule goes on folder by folder,** as each folder reaches zero, with no list of
  leftovers and no warn level ([0524](0524-no-list-lets-broken-code-pass.md),
  [0168](0168-old-lint-breaks-are-fixed.md)).

**The list, as of 2026-11-15.** Hits are `next/` product, `next/` tests, tooling.

| Rule | Hits | Where it is decided |
|---|---|---|
| `anti-slop/no-reflect-get` | 3 / 152 / 0 | [0554](0554-no-reflect-get-set-has.md), which also bans `Reflect.set` and `Reflect.has` |
| `anti-slop/no-module-mocking` | 0 / 48 / 0 | [0555](0555-no-vi-mock-or-domock.md), which also bans `vi.spyOn` and `vi.stubEnv` |
| `anti-slop/max-ternary-depth` | 13 / 104 / 28 | the decision on ternary depth, 0558, in its own pull request |
| `anti-slop/require-safety-comment-for-type-assertion` | 42 / 695 / 250 | the decision that a cast says its reason, 0561, in its own pull request |
| `anti-slop/require-readable-spacing` | about 12,000 in all, rough | here, below |
| `anti-slop/no-unknown-parameters` | 253 / 486 / 58 | here, below |
| `anti-slop/no-unknown-returns` | 39 / 88 / 12 | here |
| `anti-slop/no-runtime-typeof` | 85 / 311 / 179 | here |
| `anti-slop-effect/no-manual-tagged-construction` and `anti-slop-effect/no-manual-tagged-type` | 3 / 1,728 / 197 and 1 / 144 / 14 | the decision that no `_tag` is written by hand anywhere, being written as its own file |

- **Also taken, and not from the plugin:** oxlint's own `oxc/no-accumulating-spread`, which the
  plugin's README turns on beside its rules. It has its own decision, 0559, in its own pull
  request.
- **Not taken: `anti-slop/no-reprovide-ambient-service`.** Its fix leaves a service in each
  method's requirements, which Effect's own checker forbids. The decision on the order Effect code
  follows, 0560 in its own pull request, records it.
- **Waiting on the owner, and not to be turned on:** `anti-slop-effect/no-manual-tag-comparison`
  and `anti-slop-effect/prefer-effect-match` (the two Match rules), `anti-slop/no-conditional-spread`
  (the fork's one rule, in place of the parent's `no-conditional-empty-object-spread`),
  `anti-slop/no-shape-in-symbol-names`, and the rest of the list: `no-array-filter-map`,
  `no-reduce-accumulator-copy`, `no-chained-type-assertions`, `no-known-value-widening`,
  `no-object-parameters`, `no-reflect-apply`, `no-unknown-type-aliases`,
  `no-unsafe-dictionary-type`, `no-widen-then-assert`, and from the Effect entry point
  `no-manual-effect-error-tag`, `no-service-constructor-imports` and
  `prefer-tagged-error-handling`.

**`no-unknown-parameters`**

- Of the 253 hits in `next/` product code, 97 are faults and are fixed (tracker ticket 1053).
- The other 156 are right as written, and each carries the ignore line with a real reason. Two
  kinds are known: a door that decodes with a Schema first, and a program's own model that the
  runtime must not read.
- The plan step works out what the reason line says for each kind, so the lines are not the same
  sentence 156 times.
- No lint rule of our own is built for this. Guideline E1 in
  [Effect code guidelines](../docs/direction/effect-code-guidelines.md) still names a new
  `fabrika/no-hand-guard`. That line is behind this decision, and the cleanup fixes it.

**`require-readable-spacing`**

- It asks for a blank line before a `return` and around a binding that spans lines, inside
  functions too. It is taken by the owner's own taste.
- **It is stricter than the Effect team's code.** Measured on the source of `effect` 4.1.2: of
  6,306 `return` lines that are not first in their block, 9.2% have a blank line above. About 30%
  of multi-line bindings inside a block have one above or below. Their tooling (dprint, and their
  oxlint config) asks for neither. The scripts that measured it are kept outside git
  ([0027](0027-experiment-results-live-in-a-private-archive.md)).
- It lands through `pnpm format`'s fixer, as its own pull request.
- That pull request amends [0021](0021-a-blank-line-between-top-level-statements.md). 0021 sets a
  blank line between top-level statements, between class members and around every control
  statement, and lets two one-line statements stay a group. What will change there: the list of
  places gains "before a `return`" and "around a multi-line binding in any block", and the line
  that Effect does not enforce blank lines gains this measure. 0021 is not amended by this file.

**Binding constraints**

- No rule of the plugin is rewritten, copied into `oxlint-plugins/` or wrapped in a rule of ours.
  If a rule does not fit as shipped, it is not taken, or the gap goes to its authors.
- No list of allowed leftovers, and no warn level (0524).
- An ignore line says a fact about its own line. The same sentence pasted down a folder is a bulk
  disable, which [0523](0523-advice-rules-block-where-clean.md) refuses.
- A rule under "waiting" or "not taken" is not turned on, in any folder, until the owner says so.

## Consequences

- This file records the rule for taking the plugin's rules, and the list. Installing the plugin,
  turning each rule on and each cleanup are later pull requests. Until then nothing new is held.
- **A new dependency we do not own,** from a repository that says it reflects its author's taste
  and may change fast: the fork was pushed to on 2026-11-15. The pin is what keeps a change of
  theirs from changing our lint.
- **The cost is the cleanups.** By the script's counts the taken rules have about 2,800 hits
  outside spacing and the two `_tag` rules, most of them in tests, and spacing touches most files once through the fixer.
- **False alarms.** [`AGENTS.md`](../AGENTS.md#checks) asks that a check that can block has its
  false alarms measured first, at about 0%, and 0523 set only five named rules aside from that.
  The research read 5 to 16 hits per rule, by one reader. For `no-runtime-typeof` it found about
  40% of 12 product hits right as written, and for `no-unknown-parameters` 156 of 253. Those
  rules are taken anyway, by the owner's word, with the ignore line as the answer to a right
  line. Each pull request that turns a rule on in a folder reports the hits it met, the fixes and
  each ignore line with its reason.
- **The counts are of syntax, not runs of their rules,** except where a decision says the rule
  itself was run. Their rules follow type aliases and scopes the script does not. The first run of
  the installed plugin gives the real numbers.
- **Not decided here:**
  - The version to pin, and which of the two install routes in Context is used.
  - Where the plugin's config lives in `.oxlintrc.json`.
  - The order the rules are turned on.
  - How our own `fabrika/padding-line-between-statements` sits with their spacing rule.
  - Where we already hold the same thing with a rule of ours or a built-in one
    (`fabrika/no-hand-tag`, `fabrika/no-type-assertions`, and the two that 0554 and 0555 name,
    `eslint/no-restricted-properties` and `vitest/no-restricted-vi-methods`): the plan that turns
    their rule on says which one stays, by the order of precedence that decision 0560 sets.
    Their `no-reflect-get` reads only `Reflect.get`, and their `no-module-mocking` only `mock`,
    `doMock` and `unstable_mockModule`, so 0554's `set` and `has` and 0555's `spyOn` and
    `stubEnv` need a hold of their own either way.
  - What the reason line says for each kind of `unknown` parameter that is right.
  - Today's app.

## Records

- [0554](0554-no-reflect-get-set-has.md) and [0555](0555-no-vi-mock-or-domock.md): a one-line
  pointer each. Their status does not change.

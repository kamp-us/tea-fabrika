---
id: 0023
title: next/ follows the Effect codebase's code style and doc comments as strictly as it can, and each kept difference names its reason
status: accepted
date: 2026-11-09
tags: [style, format, lint, doc-comments, jsdoc, effect, next, readability, open-source]
---

# 0023: next/ follows the Effect codebase's code style and doc comments as strictly as it can, and each kept difference names its reason

**What this decides:** code in `next/` is written for a human reader first, in the style of the
Effect repository at the version `pnpm-lock.yaml`'s `effect` entry holds, doc comments included,
and any place we differ is written down with its reason.

```ts
// Effect's shape, from packages/effect/src/Deferred.ts at effect@4.1.2 (formatted the Effect way).
// Ours leaves out `@stability` and `@since` until libfabrika's first release (0118, 0574).
/**
 * One-time coordination cells for Effect programs. ...
 *
 * @stability stable
 * @since 2.0.0
 */
import type * as Cause from "./Cause.ts"
import * as core from "./internal/core.ts"

/**
 * A `Deferred` represents an asynchronous variable that can be set exactly once ...
 *
 * **When to use**
 *
 * Use to coordinate multiple fibers around a value or failure that will be supplied exactly once.
 *
 * @stability stable
 * @category models
 * @since 2.0.0
 */
export interface Deferred<in out A, in out E = never> extends Deferred.Variance<A, E>, Pipeable {
```

## Context

`libfabrika` and the other libraries in `next/` are open source. A stranger who reads them knows
Effect's own code best, so the closest style to copy is Effect's. The owner decided on 2026-11-09
that readability for humans comes first, and that `next/` follows Effect's style as strictly as it
can, comment structure included.

Sources, all read at the tag `effect@4.1.2` of [Effect-TS/effect](https://github.com/Effect-TS/effect/tree/effect%404.1.2)
(the effect-smol line now lives there; the version we use is `pnpm-lock.yaml`'s `effect` entry):

- formatter: `dprint.json` (dprint's TypeScript plugin 0.93.4);
- lint: `.oxlintrc.json`, which extends `packages/tools/oxc/oxlintrc.json`, with Effect's own
  rules in `packages/tools/oxc/src/oxlint/rules/`;
- doc comments: `.agents/skills/jsdocs/` (`declarations.md`, `categories.md`, `examples.md`),
  checked by `pnpm jsdocs --check` (`packages/tools/jsdocs`, config `jsdocs.config.json`), run in
  `.github/workflows/check.yml`;
- layout: `packages/effect/src/index.ts` (the `@barrel` block), `packages/effect/src/internal/`.

For apps, Tim Smart's repos (`lalph`, `dfx`, `cheffect`, `actualbudget-sync`, `receipts`) show the
app-level version: Prettier with `"semi": false`, 2 spaces, no doc comments on app code, and
`import {...} from "effect"` from the barrel.

Later records settled most of the differences this file listed as open, or kept one on purpose:
[0029](0029-format-and-names-follow-effect.md) and [0039](0039-keep-semicolons-and-es5-commas.md)
for the format and the names, [0094](0094-lines-are-100-columns.md) for the line width,
[0032](0032-libraries-take-effects-file-layout.md) for the file layout,
[0021](0021-a-blank-line-between-top-level-statements.md) for blank lines and braces,
[0095](0095-a-service-file-holds-only-its-contract.md) for where a service's layers live, and
[0118](0118-no-since-tag-before-a-release.md) and
[0574](0574-no-stability-tag-and-unstable-api-is-an-error.md) for the two doc tags. The sections
below say what holds now.

## Decision

**`next/` follows Effect's code style and doc comment structure at the pinned version; a difference
stays only with a written reason in this file.**

- **Libraries** (`next/packages/*`) follow Effect's library style in full: the doc comments, the
  file layout, the import style and the lint rules below.
- **Apps** (`next/apps/*`) follow Effect's formatting and naming, and Tim Smart's app habits where
  Effect's repo has no app: no doc comment is required on app code, and imports may use the
  `effect` barrel.
- **Doc comments** follow `.patterns/doc-comments.md` (ticket 447): a module block; on each public
  export one description paragraph, the optional `**When to use**`, `**Details**` and
  `**Gotchas**` sections in that order, `**Example** (title)` sections and never `@example`, then
  tags in the order `@deprecated`, `@default`, `@see`, `@category`. `@stability` and `@since` are
  left off until `libfabrika` has a released version, and come back together in one sweep at the
  first release, in the places Effect puts them
  ([0118](0118-no-since-tag-before-a-release.md),
  [0574](0574-no-stability-tag-and-unstable-api-is-an-error.md)). A type directly under its
  same-name schema shares the schema's block (the table's row "A type under its schema").
- **Where Effect has a rule and we have none, we take Effect's.** Where our rule is stricter in the
  same direction, ours stays. Where a settled decision set ours the other way, it stays until the
  owner picks otherwise, and the table below names it.
- **Whose way wins** when the Effect team, a trusted repo and a decision of ours disagree is
  [0560](0560-an-order-for-effect-code.md)'s order.
- **When Effect changes its style in a version we bump to, `next/` follows on that bump.**

### What differs, and what happens to it

The Ours column is as read on 2026-11-09, except where a cell names a file and key or a record.

| Area | Effect at 4.1.2 | Ours | Set by | Outcome |
|---|---|---|---|---|
| Indent | 2 spaces (`dprint.json` `indentWidth: 2`) | `.oxfmtrc.json`: `useTabs`, `tabWidth` | [0029](0029-format-and-names-follow-effect.md) | same: 0029 took Effect's setting |
| Line width | 120 | `.oxfmtrc.json`: `printWidth` | 0029, then [0094](0094-lines-are-100-columns.md) | set by `.oxfmtrc.json`'s `printWidth` (0029, 0094) |
| Semicolons | none (`semiColons: "asi"`) | always: `semi` is left out of `.oxfmtrc.json`, so oxfmt's default | [0039](0039-keep-semicolons-and-es5-commas.md) | differs: the owner's reading taste (0039) |
| Trailing commas | never (`trailingCommas: "never"`) | always: `.oxfmtrc.json`: `trailingComma` | 0039 | differs: the owner's reading taste (0039) |
| Spaces in braces | `import { dual } from` (dprint default) | `.oxfmtrc.json`: `bracketSpacing` | 0029 | same: 0029 took Effect's setting |
| Generator star | `function*() {` (dprint) | `function* () {` (oxfmt prints it, no setting) | 0029 | kept: one space does not pay for a formatter swap (0029) |
| Formatter | dprint | oxfmt | the format line of [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md), 2026-10-31 | kept: oxfmt can print every setting above except the star |
| Quotes, arrow parens, import sort | double, always, case-insensitive | the same | | same |
| Blank lines | a blank line at about 93% of top-level boundaries after a multi-line statement in `packages/effect/src` (7,896 of 8,527), not enforced | `fabrika/padding-line-between-statements` enforces one between top-level statements and class members, with one-line groups kept; where anti-slop's `require-readable-spacing` is on in `.oxlintrc.json`, also before a `return` and around a multi-line binding ([0021](0021-a-blank-line-between-top-level-statements.md), [0563](0563-anti-slop-plugin-as-it-ships.md)) | 0021 | kept: stricter, same direction |
| Braces on `if` | one-statement `if (x) return y` with no braces is common (2,228 lines in `packages/effect/src`), no `curly` rule | braces on every body, `eslint/curly` `all` | owner, 2026-11-09, 0021 (ticket 439) | differs: human readability |
| Blank lines around blocks | not enforced | a blank line before and after each `if`, loop, `switch` and `try` | owner, 2026-11-09, 0021 (ticket 439) | differs: human readability |
| Library imports | namespace import by module path, `import * as Effect from "effect/Effect"`; `effect/no-import-from-barrel-package` bans the barrel in package code | `import {Effect} from "effect"` (170 import lines in `next/`) | | follow in libraries; apps keep the barrel |
| Type imports | `consistent-type-imports` with `fixStyle: "inline-type-imports"` | `consistent-type-imports`, default fix style | | follow |
| Array types | `typescript/array-type` generic: `ReadonlyArray<A>`, `Array<A>` | no rule | | follow |
| `console` | `eslint/no-console` is an error in package code | no rule | | follow in libraries |
| File names | one public module per file, PascalCase (`Deferred.ts`); implementation in `src/internal/` in camelCase, every export there `/** @internal */` | kebab-case (`door-nonce.ts`), no `internal/` folder | [0032](0032-libraries-take-effects-file-layout.md) | follow, as 0032 lays it out; renames go in one sweep ticket |
| Barrel | `index.ts` re-exports each module as a namespace, `export * as Deferred from "./Deferred.ts"`, each with its own doc block | `index.ts` re-exports names (`export {Door} from ...`) | 0032 | follow in libraries |
| Service layers | `effect`'s `AGENTS.md` teaches a static `layer` member on a service class as the default for a service with one implementation | a service class holds no static member of any kind; each layer is a sibling file exporting `layer` | [0095](0095-a-service-file-holds-only-its-contract.md) | differs: the service file holds only the contract, and one rule reads more evenly than one with an exception |
| Options | inline in the signature, `readonly` fields, `\| undefined` on optional ones | mixed | | follow |
| Doc comments | required on every public export, with `@stability`, `@category`, `@since` | no `@since` or `@stability` until `libfabrika` has a released version | [0118](0118-no-since-tag-before-a-release.md), [0574](0574-no-stability-tag-and-unstable-api-is-an-error.md) | follow, `.patterns/doc-comments.md`, minus the two tags: a tag that would say `0.0.0` or `unstable` on every export tells a reader nothing |
| A type under its schema | every export has its own block, the type under its schema included | a type directly under its same-name schema (`export const Sent = ...` then `export type Sent = typeof Sent.Type;`) shares the schema's block, and `fabrika/jsdocs` (`oxlint-plugins/jsdocs.ts`, ticket 913) reads the pair as one; "directly" means the statement right before the type | owner, 2026-11-13 (ticket 913) | differs: the pair is one thing to a reader, and a second block would repeat the first |
| Bare `of` | `Array.of`, `Chunk.of`, `Iterable.of`, `Request.of` exist | `Module.of(...)` read through its module is allowed; a bare `of` imported by name and any `xOf` name are banned in `next/` | 0029 | differs in part: only the bare name is banned, as AGENTS.md has it |
| Plural service names | `Runners`, `Servers`, `Notifications`, `Dimensions` are services | a service that holds many is plural (`Leases`); the `<Thing>Manager` rule is gone | 0029 | same: 0029 took Effect's names |
| Tag key | `_tag` | `_tag` | AGENTS.md | same |

## Consequences

- **No difference is open.** The table's Outcome column holds each one's answer; a new difference
  is added with its own.
- **Follow, each as its own lead-tooling or sweep ticket:** the import style, inline type imports,
  generic array types and `no-console` in libraries; PascalCase files with `internal/` and the
  namespace barrel, as [0032](0032-libraries-take-effects-file-layout.md) lays them out; doc
  comments on every public export, minus the two tags.
- **What holds the doc comments.** Effect's checker (`packages/tools/jsdocs`) is private, not on
  npm. Copied into a scratch folder with `effect@4.1.2`, `glob` and TypeScript 5.9 (it needs the
  TypeScript JS API; the TypeScript we use, `pnpm-lock.yaml`'s `typescript` entry, has none), it
  ran on both trees. On Effect's own 144 modules in `packages/effect/src` it reports one file, `StandardSchema.ts`, which Effect's config excludes,
  so 0 false alarms. On `next/packages/libfabrika/src` it reports 92 places; a hand read of 20
  (seed 119120) found 20 real exports missing a doc or its tags, 2 of them in `*.test-support.ts`
  files a config would exclude. Oxlint 1.90.0's `jsdoc` plugin has no rule that requires a doc on an
  export, and its `require-param` and `require-returns` fire 1,494 and 1,679 times on Effect's
  correct tree, so they stay off. Which tool blocks is the pattern ticket's call.
- **Cost.** The follow items touch most files in `next/`. They are sweeps, not hand edits, and each
  lands as its own pull request.
- **Not decided here:** the first release's version, where `@stability` and `@since` come back.

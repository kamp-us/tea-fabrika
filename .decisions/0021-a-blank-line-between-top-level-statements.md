---
id: 0021
title: A blank line stands between top-level statements, between class members and around every control statement, every body has braces, and pnpm format adds both
status: accepted
date: 2026-11-09
tags: [lint, format, oxlint, oxfmt, readability]
---

# 0021: A blank line stands between top-level statements, between class members and around every control statement, every body has braces, and pnpm format adds both

**What this decides:** every top-level statement, every class member and every `if`, loop, `switch`
and `try` is set apart by a blank line, every `if`, `else` and loop body has braces, lint blocks
when either is missing, and `pnpm format` adds them.

```ts
// Refused: a multi-line statement with no blank line above or below it.
type Rows = Parameters<Part["write"]>[0];
const part = Effect.fnUntraced(function* () {
	return yield* read;
});
export const recordWrite = Effect.fn(function* () {});

// Allowed by our rule: one-line statements stay a group, and so do imports, overloads and a
// schema's type.
const A = 1;
const B = 2;
export const Row = Schema.Struct({
	id: Schema.String,
});
export type Row = typeof Row.Type;
```

## Context

Builders wrote files such as `next/packages/libfabrika/src/workers/record.ts` with no blank line
between declarations. `oxfmt --check` passed them, since a formatter keeps blank lines but never
adds one, and they were hard to read. Oxlint 1.90.0 has neither ESLint's
`padding-line-between-statements` nor `lines-between-class-members` (ticket 437).

On 2026-11-15 and 2026-11-16, [0573](0573-trusted-lint-rule-replaces-ours.md) and
[0563](0563-anti-slop-plugin-as-it-ships.md) brought in anti-slop's `require-readable-spacing`
beside our rule (ticket 1057); the Decision below says how the two sit together.

## Decision

**A blank line goes between two top-level statements, and between two class members, unless both
are one line each.** Two rules hold it, each named in `.oxlintrc.json`.

- **`fabrika/padding-line-between-statements`** in `oxlint-plugins/`, ESLint's
  `{blankLine: "always", prev: "*", next: "*"}` with three exceptions: two one-line statements
  (ESLint's `exceptAfterSingleLine`, asked of both sides), two imports or re-exports, and one
  declaration written twice (function or method overloads, or a value followed by its same-name type).
  It is on in the root `rules` block. It stays beside anti-slop's rule because that rule misses
  class-member lines (a method after a field, a method after a method), as
  [0573](0573-trusted-lint-rule-replaces-ours.md) found; ours goes only when a check on main shows
  anti-slop's `require-readable-spacing` flags every line ours does.
- **anti-slop's `anti-slop/require-readable-spacing`,** taken as it ships by
  [0563](0563-anti-slop-plugin-as-it-ships.md), on in each folder whose override block in
  `.oxlintrc.json` lists it. Where it is on, a blank line also goes **before a `return`** and
  **around a multi-line binding in any block**, inside functions too. As the rule ships it asks for
  a blank line between every two top-level statements other than imports, so the exception for two
  one-line statements does not hold at the top level there; overloads stay a group.
- A comment above a statement belongs to it; the blank line may sit anywhere between the two.
- Both block. Their whitespace fixes run in `pnpm format`.

Binding constraints:

- Never add a blank line by hand to pass review: run `pnpm format`.
- A new exception goes in the rule with a measured count, never as a disable comment.

A blank line also stands before and after control statements, and every body has braces (owner,
2026-11-09, ticket 439):

- **A blank line before and after every `if`, `for`, `for..of`, `for..in`, `while`, `do`, `switch`
  and `try`,** in any block, unless it is the first or last statement there. An `if` with its whole
  `else` chain is one statement, and so is a labeled loop. `fabrika/padding-line-between-statements`
  holds it.
- **Braces on every body:** oxlint's own `eslint/curly` set to `"all"` in `.oxlintrc.json`, so
  `if (x) return y;` is refused too. Its fix runs in `pnpm format`.
- The owner first asked for `curly` `"multi-line"` plus a rule of ours that braces every loop, then
  chose `"all"` instead: one built-in rule, no split by statement kind.
- **All of it is a named difference from Effect's style**
  ([0023](0023-next-follows-effects-code-style.md)). Effect has no `curly` rule: `packages/effect/src`
  at `effect@4.1.2` has 2,228 one-statement `if` lines with no braces, and it does not enforce blank
  lines around blocks. On the same source, 9.2% of the 6,306 `return` lines that are not first in
  their block have a blank line above, and about 30% of multi-line bindings inside a block have one
  above or below (0563's measure); their dprint and oxlint config ask for neither. The reason is the
  owner's taste: code here is read by humans first.

```ts
// Refused.
const ready = check(x);
if (!ready) return;
for (const y of ys) total += y;
return total;

// Allowed.
const ready = check(x);

if (!ready) {
	return;
}

for (const y of ys) {
	total += y;
}

return total;
```

## Consequences

- The first sweep added 2,920 blank lines to 566 files and nothing else. Open branches need
  `pnpm format` after merging main, since the blank lines conflict.
- `path:line` citations in `.patterns/` and notes drift by a few lines in swept files.
- The second sweep (ticket 439) touched 928 files, +37,705 and -8,330 lines; each file parses to the
  same tree with a one-statement block read as its statement. Runs of guard clauses now stand apart.
- `pnpm format` may need more than one run on a file with deeply nested brace-less bodies: oxlint
  applies one fix per overlapping range a pass. The first sweep took 8 runs; new code rarely needs two.
- Blank lines between other statements inside a function body are not decided here.
- Long reasoning: [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md).

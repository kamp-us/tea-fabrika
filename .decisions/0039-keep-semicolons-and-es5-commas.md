---
id: 0039
title: The repo keeps semicolons and trailing commas, function parameters and call arguments included
status: accepted
date: 2026-11-09
tags: [style, format, oxfmt, semicolons, trailing-commas, effect]
---

# 0039: The repo keeps semicolons and trailing commas, function parameters and call arguments included

**What this decides:** two of the format settings that
[0029](0029-format-and-names-follow-effect.md) took from Effect go back: statements end with a
semicolon, and every multi-line list ends with a comma.

```ts
// Short lines are broken here only to show the commas.
// 0029: no semicolons, no trailing commas
import { Effect } from "effect"
const lease = {
  id,
  holder
}
const made = make(
  lease,
  options
)

// 0039: semicolons, and a trailing comma in the object and in the call
import { Effect } from "effect";
const lease = {
  id,
  holder,
};
const made = make(
  lease,
  options,
);
```

```jsonc
// .oxfmtrc.json, the two settings this decides
{
  // "semi" is left out: oxfmt's default is true
  "trailingComma": "all"
}
```

## Context

0029 set the whole format to Effect's `dprint.json`: its indent, its width, no semicolons, no
trailing commas, spaces inside braces. Ticket 466's sweep, which applies those settings to every
file, had not landed yet. Later on 2026-11-09 the owner picked these two settings back. The reason
is the owner's reading taste. On 2026-11-11, [0094](0094-lines-are-100-columns.md) then set the
line width narrower than Effect's.

This amends 0029 in part, and with it the semicolon and trailing comma rows of
[0023](0023-next-follows-effects-code-style.md)'s table. Ticket 498 is this record, and ticket 503
the change of `trailingComma` from `"es5"` to `"all"` the same day. This record first said `"es5"`: a
comma in objects and arrays, none in function parameters or call arguments
([PR 704](https://github.com/usirin/tea-fabrika/pull/704)). The owner changed that part after
reading that pull request. Ticket 466's sweep takes the settings.

## Decision

**Code in this repo ends statements with a semicolon, and puts a trailing comma in every multi-line
list, function parameters and call arguments included.**

- In oxfmt's settings: `semi` is `true`, its default, so the key is left out, and `trailingComma`
  is `"all"`. These are the two values the repo had before 0029.
- oxfmt's `configuration_schema.json`, read at 0.75.0, says that `trailingComma` prints
  "trailing commas wherever possible in multi-line comma-separated syntactic structures", and that
  a single-line array never gets one. `"all"` is its default.
- Everything else in 0029's format stays: the indent and the spaces inside braces
  (`.oxfmtrc.json`'s `useTabs`, `tabWidth` and `bracketSpacing`), and the line width, which
  [0094](0094-lines-are-100-columns.md) sets (`printWidth`). JSON keeps its own settings, with no
  trailing comma.

Binding constraints:

- A pull request formats with these settings; `pnpm lint` fails a file that is not formatted.

## Consequences

- These two settings differ from Effect's own. Code copied from Effect's docs or source is
  reformatted by `pnpm format`: it gains semicolons and trailing commas. That is the cost the owner
  accepted.
- `.oxfmtrc.json` does not change in this record's pull requests. Ticket 466's sweep changes it
  and reformats every file once, with these settings.
- 0023's table gets two kept differences: semicolons, and trailing commas.
- Not decided here: any other format setting.

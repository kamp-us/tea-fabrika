---
id: 0029
title: The repo formats code as Effect does except semicolons and trailing commas, oxfmt stays, Module.of is allowed, a service that holds many has a plural name and test tooling follows the same names
status: accepted
date: 2026-11-09
tags: [style, format, oxfmt, names, of, services, effect, next]
---

# 0029: The repo formats code as Effect does except semicolons and trailing commas, oxfmt stays, Module.of is allowed, a service that holds many has a plural name and test tooling follows the same names

**What this decides:** the owner closed most of
[0023](0023-next-follows-effects-code-style.md)'s open differences toward Effect: the format
settings, `of` read through its module, and plural service names. Two format settings stay
different from Effect's on purpose: semicolons and trailing commas
([0039](0039-keep-semicolons-and-es5-commas.md)). The line width is `.oxfmtrc.json`'s `printWidth`,
decided here and by [0094](0094-lines-are-100-columns.md).

```ts
// before: tabs, semicolons, trailing commas, no spaces in braces
import {Effect} from "effect";
export const make = (n: number) =>
	Effect.gen(function* () {
		return {n, ok: true};
	});

// after: Effect's indent and brace spacing, oxfmt's generator star, and 0039's semicolons
import { Effect } from "effect";
export const make = (n: number) =>
  Effect.gen(function* () {
    return { n, ok: true };
  });

// allowed: `of` read through its module, as Effect has `Chunk.of` and `Array.of`
import * as Lease from "./Lease.ts";
const lease = Lease.of(input);

// a service that holds many is plural, as Effect has `Runners` and `Servers`
class Leases extends Context.Service<Leases>()("Leases", { ... }) {}
```

## Context

0023 listed each place where our style differs from Effect's at `effect@4.1.2` and left the owner
to pick each one. The owner picked on 2026-11-09, in one walk. The settings come from Effect's
`dprint.json` at that tag, as 0023 reads them. The owner weighed the case for tabs (each reader
sets their own indent width, which helps low-vision readers) and chose to follow Effect anyway.

Later the same day, [0039](0039-keep-semicolons-and-es5-commas.md) took semicolons and trailing
commas back, and on 2026-11-11 [0094](0094-lines-are-100-columns.md) set the line width narrower
than Effect's.

This amends 0023 in part and the format line of [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md).
Tickets: 465 (this record), 466 (the format sweep), 467 (the `no-of` rule), 468 (the service
rename sweep).

## Decision

**The repo's format follows Effect's settings except semicolons and trailing commas,
oxfmt stays the formatter, `Module.of(...)` is allowed, and a service that holds many is named in the
plural.**

- **Format, for the whole repo** (one `.oxfmtrc.json`): the indent and the spaces inside braces
  are Effect's (`useTabs`, `tabWidth` and `bracketSpacing`). Two settings differ from Effect's on
  purpose: statements end with a semicolon (`semi` is left out, so oxfmt's default) and every
  multi-line list ends with a comma, function parameters and call arguments included
  (`trailingComma`), both by 0039. The line width is `.oxfmtrc.json`'s `printWidth`, decided here
  and by 0094. JSON keeps its own settings.
- **The formatter stays oxfmt, not dprint.** So the generator star stays oxfmt's `function* ()`
  where Effect writes `function*()`. That is a kept difference: one space does not pay for a
  formatter swap. No upstream issue.
- **`of` read through its module is allowed,** as Effect does it: a module exports `of` and a reader
  calls `Lease.of(...)` under a namespace import. A bare `of(...)` (imported by name) and any `xOf`
  name (`nameOf`, `outcomesOf`, `colorsOf`) stay banned in `next/`.
- **A service that holds many is named in the plural:** `Leases`, as Effect has `Runners`,
  `Servers` and `Notifications`. This replaces the `<Thing>Manager` rule. Existing `*Manager`
  names in `next/` are renamed by one sweep, ticket 468.
- **Braces on `if` bodies** are a kept difference too: the owner decided them in their own record
  (ticket 439). Effect has no `curly` rule.
- **`func-style: declaration` stays off;** arrow consts are fine, as Effect writes them (7,693 hits
  when tried; owner's call, 2026-11-09). The format sweep, ticket 466, changed no lint rule.
- **Test tooling follows these names too** (owner, 2026-11-10). A test helper, a test-support file
  and a shared test suite are named as Effect names its own, and read through their module, never
  as a bare camel-case function: `SinkTest.suite(nodeSql)` under `import * as SinkTest`. Effect
  does it in `packages/effect/test/unstable/eventlog/SqlEventLogServerUnencryptedStorageTest.ts`,
  which exports `suite`, and
  `packages/sql/sqlite-node/test/SqlEventLogServerUnencrypted.test.ts` calls it as
  `SqlEventLogServerUnencryptedStorageTest.suite("sql-sqlite-node", SqliteClient.layer({ filename: ":memory:" }))`
  (Effect-TS/effect-smol, main). `make` stays Effect's word for building a value; a suite registers
  tests, so it is `suite`.

Binding constraints:

- A pull request formats with these settings; `pnpm lint` fails a file that is not formatted.
- The `no-of` rule passes a module's top-level `of` and still fires on a named import of `of`, an
  `of` parameter, key or member, and every `xOf` name (ticket 467). Until that lands the rule fires
  on every declared `of`, so nobody adds one first.
- A new service that holds many takes the plural name from today.

## Consequences

- One sweep reformats every file (ticket 466). It lands after the braces sweep for ticket 439,
  since both touch every file. A paused lane runs `pnpm format` after it merges main.
- Indents are narrower than the repo's earlier tabs. A reader who wants a wider indent can no longer
  set it in the editor; that is the cost the owner accepted.
- 0023's table holds these rows with their outcomes: indent, line width, semicolons, trailing
  commas, spaces in braces, generator star (kept), bare `of`, plural service names.
- Not decided here: any other format setting, and whether shared test suites are how lower-layer
  modules test against a database (still open, ticket 640).

## Records

- `.glossary/TERMS.md`: the `Manager (service)` row becomes a plural service name row.

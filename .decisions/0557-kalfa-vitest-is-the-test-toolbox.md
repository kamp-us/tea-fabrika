---
id: 0557
title: "Our test package is @kalfa/quality/vitest, its exports are the whole list of test tooling, and a mechanism it does not export is built in it, never reached around it"
status: accepted
date: 2026-11-15
tags: [tests, vitest, kalfa, package, exports, mocks, next, tooling]
---

# 0557: Our test package is @kalfa/quality/vitest, its exports are the whole list of test tooling, and a mechanism it does not export is built in it, never reached around it

**What this decides:** the name and home of our test package, and that a test gets every tool from
it.

```ts
// A sketch of a test file.
import { describe, expect, it, layer, runsFor } from "@kalfa/quality/vitest";

// Never, outside the package:
// import { vi } from "vitest";
// import { it } from "@effect/vitest";
```

## Context

[0538](0538-kampus-vitest-holds-the-test-primitives.md) made one workspace package,
`@kampus/vitest` in `next/packages/vitest`, for the test primitives our test decisions need. It
followed Effect, which ships its test helpers as a package of their own, `@effect/vitest`.

The package is small so far, and most tests do not get their tools from it. Counted on main at
commit `22ffc707c` with `nice -n 19 rg --hidden -l` for a `from "<name>"` import line, one count
per file, `node_modules` left out, in `next/` and in the three tooling folders (`.agents/`,
`oxlint-plugins/`, `.github/ci/`):

| A file imports | Files in `next/` | Files in the tooling folders |
|---|---|---|
| `@kampus/vitest` | 110 | 1 |
| `vitest` directly | 127 | 113 |
| `@effect/vitest` | 289 | 12 |

The package's `src/index.ts` exports one module, `Depth.ts`: `runsFor` and what it is built from.

So a test can reach any tool the test runner has, whether we looked at it or not. Each ban on such
a tool then needs a lint rule of its own, as
[0555](0555-no-vi-mock-or-domock.md) has for four methods of `vi`.

On 2026-11-15 the owner ruled on the package's name and its job. The name follows
[0556](https://github.com/kamp-us/tea-fabrika/pull/1354), the decision that makes `@kalfa` our
namespace for tooling and infra and `kalfa/` its folder. That decision is in pull request 1354 as
this one is written.

This amends 0538 in part: the package's name, and what goes in it.

[0600](0600-kalfa-quality-holds-test-lint-format.md) then put the package, which that day was named
`@kalfa/vitest`, into one package for testing, linting and formatting, `@kalfa/quality`, as its
`/vitest` subpath. This record's text says `@kalfa/quality/vitest` where it first said
`@kalfa/vitest`.

## Decision

**Our test package is `@kalfa/quality/vitest`. It exports every vetted piece of test functionality
we want tests to use, and a test gets its tools from it and from nowhere else.**

```jsonc
// before: next/packages/vitest/package.json
{ "name": "@kampus/vitest", "private": true }
// after: the package is @kalfa/quality (0600), and the test package is its "./vitest" subpath
{ "name": "@kalfa/quality", "private": true }
```

```ts
// before: three places a test tool comes from
import { runsFor } from "@kampus/vitest";
import { it } from "@effect/vitest";
import { expect, vi } from "vitest";

// after, a sketch: one place
import { expect, it, runsFor } from "@kalfa/quality/vitest";
```

What moves: the package's name and home, and the three sources of test tools become one.

- **The name.** The test package is the `/vitest` subpath of `@kalfa/quality`. The package stays
  private (0556).
- **It carries all a test needs,** the way `@effect/vitest` carries all that is needed to run
  Effect tests. A test file needs no second test import.
- **Vetted, piece by piece.** `@effect/vitest` exports all of `vitest` again, unchanged
  (`export * from "vitest"` in its `src/index.ts`, at the version in `pnpm-workspace.yaml`'s
  catalog entry for `@effect/vitest`). Ours does not. A piece is exported because we looked at it
  and want tests to use it.
- **The exports are the whole list.** If `@kalfa/quality/vitest` does not export a mechanism, we do
  not use it. Nothing reaches around the package to `vitest`.
- **A mechanism we need is built in the package.** A way to spy, for example, is written there and
  exported, and it is not taken from `vi`.
- **A property law is `it.prop` or `it.effect.prop`, with Schemas as its inputs**
  ([0579](0579-property-laws-use-it-prop.md)). The package exports no raw `fc.assert`, so a hand
  runner cannot come back.
- **`vi.mock`, `vi.doMock`, `vi.spyOn` and `vi.stubEnv` are banned.** That ban is its own decision,
  [0555](0555-no-vi-mock-or-domock.md), "no test calls vi.mock, vi.doMock, vi.spyOn or vi.stubEnv".
  This package does not export them.
- **The scope is `next/` and our tooling,** the same folders 0555 names. Today's version
  (`packages/`, `programs/`, `apps/`) is not covered, as in 0538
  ([0217](0217-next-grows-beside-today.md)).

**Binding constraints:**

- A tool a test may use is an export of `@kalfa/quality/vitest`.
- `FABRIKA_TEST_DEPTH` has one reader, in this package, and the package imports no service of ours
  (0538).

## Consequences

These are the lead's reading of what follows from the ruling. They are not the owner's words.

- **The package moves to `kalfa/quality`, as its `/vitest` subpath,** since every `@kalfa` package
  lives in `kalfa/` (0556), and the workspace gains `kalfa/*`. The 110 files counted above that
  import `@kampus/vitest` change one line each.
- **A ban is held by what the package does not export,** plus one lint rule: no file outside the
  package imports `vitest` or `@effect/vitest` directly. One rule then holds every ban on a test
  tool, 0555's and any later one. [0554](0554-no-reflect-get-set-has.md) and 0555 both say their
  hold moves here later. The rule can block only once the files counted above import from the
  package, so the package grows first and the files move after. Until then each ban keeps its own
  oxlint rule.
- **The fakes of Cloudflare objects live here too.** 0554 already puts them in this package. A fake
  of a platform object is not one of our services, and each service's `layerMemory` stays beside
  its service (0538's "what stays out").
- **0555's one exception needs a way through.** 0555 lets the law of a file that wraps an outside
  package call `vi.mock` on one marked line, until this package offers its own way for that case.
  Under this decision that way is built here. How such a law reaches `vi.mock` in the meantime is
  for the plan that adds the import rule to say.
- **The cost.** We keep our own list of exports, and each new need is a change to the package
  before a test can use it. A test written from memory of `vitest`'s API fails at its import line
  when the piece is not on the list. `@effect/vitest` gives the whole of `vitest`; we give that up
  on purpose. The 142 calls 0555 counts in `next/` are rewritten by its cleanup.
- The glossary's `test depth` row names the package and its path. It changes in the pull request
  that moves the package, so it stays true to the code until then.

**Not decided here:**

- The shape of each mechanism the package builds, such as fake timers or a way to spy. A plan
  decides one when a test needs it.
- The order the files move in, and which pull request moves the package.

## Records

- No glossary row: this coins no word. `kalfa` gets its row with 0556.

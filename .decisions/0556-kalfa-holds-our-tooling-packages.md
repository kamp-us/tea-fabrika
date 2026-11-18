---
id: 0556
title: "@kalfa is our npm namespace for tooling, infra and small one-domain libraries, and the top-level folder 0537 called infra/ is named kalfa/ and holds every @kalfa package, all private for now"
status: accepted
date: 2026-11-15
tags: [kalfa, infra, namespace, npm, packages, tooling, folder]
---

# 0556: @kalfa is our npm namespace for tooling, infra and small one-domain libraries, and the top-level folder 0537 called infra/ is named kalfa/ and holds every @kalfa package, all private for now

**What this decides:** the npm scope our tooling, infra and small library packages are named under,
and the name and job of the top-level folder they live in.

```mermaid
flowchart LR
  scope["@kalfa: the npm scope for tooling, infra and small libraries"] --> folder["kalfa/: the top-level folder"]
  folder --> pkg["one folder per @kalfa package, each private"]
```

```text
# A sketch.
kalfa/
  <name>/
    package.json    { "name": "@kalfa/<name>", "private": true }
```

## Context

[0537](0537-infra-holds-our-own-small-services.md) decided a top-level `infra/` folder for the
small services we run to ship fabrika. [0538](0538-kampus-vitest-holds-the-test-primitives.md) then
made a shared test package that this folder and `next/` both use. So we now have packages that are
neither the product (`@kampus/fabrika`, `@kampus/libfabrika`) nor a service: they are tooling. They
had no name of their own and no one home.

On 2026-11-15 the owner ruled on both. He holds the `@kalfa` scope on npm.

The folder did not exist on main when this was ruled. The first plan that builds 0537 was still an
open pull request ([pull request 1279](https://github.com/kamp-us/tea-fabrika/pull/1279)). So this
renamed a decided name before any file carried it, and gave the folder a wider job.

This amends 0537 in part: the folder's name and what it holds.

[0601](0601-program-make-with-optional-pipes.md) later made `@kalfa` hold small libraries of one
domain each (`@kalfa/program`, `@kalfa/ledger` and `@kalfa/transport`), which are not tooling or
infra. This record's text says so where it first said tooling and infra.

## Decision

**`@kalfa` is our namespace on npm for tooling, infra and small one-domain libraries. The top-level
folder that 0537 named `infra/` is named `kalfa/`, and every `@kalfa` package lives in it.**

**Before** (0537, a sketch):

```text
infra/          the small services we run to ship fabrika
```

**After** (a sketch):

```text
kalfa/          every @kalfa package: tooling, the small services of 0537, and small libraries
```

What moves: the folder's name, and its job, from services only to every tooling, infra and small
library package.

- **The scope.** A package that is our tooling, our infra or one of the small libraries of
  [0601](0601-program-make-with-optional-pipes.md) is named `@kalfa/<name>`. The product keeps
  `@kampus`.
- **The folder.** `kalfa/` is top-level, beside `next/` and today's version, in the pnpm workspace.
  It holds all `@kalfa` packages.
- **Nothing is published now.** Each `@kalfa` package stays `"private": true`. Holding the scope
  only keeps the name ours.
- **The services of 0537 live in `kalfa/`,** where 0537 says `infra/`.
- **The tooling that exists today** (`oxlint-plugins`, `.github/ci` and `.agents`, named
  `@tea-fabrika/*` when this was ruled) takes the `@kalfa` scope as the domain packages of
  [0585](0585-kalfa-is-six-domain-packages.md), which says what moves and where.

**Binding constraints:**

- No new folder or path is named `infra/`.
- A `@kalfa` package lives in `kalfa/`, nowhere else.
- No `@kalfa` package is published until a later decision says so.

## Consequences

These are the lead's reading of what follows from the ruling. They are not the owner's words.

- **The workspace lists `kalfa/*`** in `pnpm-workspace.yaml`.
- **The plan in pull request 1279 changes its folder name.** It says `infra/` throughout: the
  package path `infra/fabrikalfa`, the workspace line `- infra/*`, the `infra/**` lint override, the
  `infra/**` test paths, the CI path rule and its law, and `infra/AGENTS.md`. Each becomes `kalfa/`.
  That pull request makes the change itself; this one does not edit it.
- **The merge queue's package takes the `@kalfa` scope.** The plan names it `@kampus/fabrikalfa`,
  and it is infra, so the scope rule covers it. Its name inside the scope is the plan's to pick.
- **The test package moves here** and becomes `@kalfa/quality/vitest`
  ([0557](0557-kalfa-vitest-is-the-test-toolbox.md),
  [0600](0600-kalfa-quality-holds-test-lint-format.md)).
- **The cost:** a reader meets a word of ours, `kalfa`, where `infra` was the industry's plain word.
  The glossary row carries the gloss
  ([use the industry's names](../docs/direction/use-the-industrys-names.md) asks for one). `infra`
  stays the everyday word for what the services are; only the folder and the scope are named
  `kalfa`.

**Not decided here:**

- When, and whether, any `@kalfa` package is published.
- Today's version (`packages/`, `programs/`, `apps/`) is not covered. Nothing there is renamed
  ([0217](0217-next-grows-beside-today.md)).

## Records

- `.glossary/TERMS.md`: a new `kalfa` row under Shared names.

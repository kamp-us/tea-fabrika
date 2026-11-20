# One package per domain, and each adapter is an entry point named for what it adapts to

Each kalfa domain is one package, holding its interface, its memory version and its adapters. An adapter lives in the package whose interface it implements, as one entry point named for what it adapts to: `@kalfa/ledger/cloudflare`, `@kalfa/codehost/github`, `@kalfa/program/ledger`. Packages import each other in one ranked order, so no cycle can form.

## Considered Options

- A separate package per platform or service, such as `@kalfa/provider-cloudflare` and `@kalfa/provider-github`, the way Effect keeps `@effect/platform-node` apart: rejected, because a provider's name does not say what it provides, and the number of packages grew past what anyone could keep in mind.
- An adapter beside the package it uses, such as `@kalfa/ledger/journal`: rejected, because the package it uses then depends on the one it serves, which is the first step to a cycle.

## Consequences

A vendor's SDK is an optional peer dependency of the domain package, needed only by the entry point that uses it. The ledger sits below Program in the order: Program keeps its journal on a ledger through `@kalfa/program/ledger`, and the ledger knows nothing of programs.

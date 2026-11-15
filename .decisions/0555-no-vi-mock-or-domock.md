---
id: 0555
title: In next/ and our tooling, no test calls vi.mock or vi.doMock, so a stand-in comes from the code's own design, a service with a test layer, never from the test framework
status: accepted
date: 2026-11-15
tags: [tests, laws, vitest, mock, layer, service, lint, oxlint, next, tooling]
---

# 0555: In next/ and our tooling, no test calls vi.mock or vi.doMock, so a stand-in comes from the code's own design, a service with a test layer, never from the test framework

```ts
// before: the test framework swaps a module behind the product code's back
vi.mock("@kampus/libfabrika/node/build", async (original) => ({
  ...(await original<typeof import("@kampus/libfabrika/node/build")>()),
  bundle: () => Effect.succeed({ output: [] }),
}));

// after (a sketch: `Bundler` is not a service yet, and this was not compiled)
const bundler = Layer.mock(Bundler, {
  bundle: () => Effect.succeed({ output: [] }),
});

it.effect("the law", () => law.pipe(Effect.provide(bundler)));
```

**What this decides:** how a test in `next/` and our tooling may replace a piece of code with a
stand-in, and how that is held.

## Context

- A `vi.mock` is there because a product file imports a module directly, so a test has no other
  place to put a stand-in. The fix is in the product code, not in the test.
- Counted on `origin/main` at `d564b996f` with `rg --hidden -g '!node_modules' -o` for
  `\bvi\.mock\(` and `\bvi\.doMock\(`, over `next/`, `.agents/`, `oxlint-plugins/` and
  `.github/ci/`:

  | Call | Calls | Files | Where |
  |---|---|---|---|
  | `vi.mock` | 39 | 25 | `next/` |
  | `vi.doMock` | 9 | 3 | `next/` |
  | either | 48 | 28 | 27 in `next/apps/fabrika` (13 files), 21 in `next/packages/libfabrika` (15 files) |

- What the 48 replace, from the string each call names: `cloudflare:workers` 11, `rolldown` 9,
  `virtual:fabrika-built` 7, our own files and packages 13 (`./objects.ts` 4, `./table.ts` 3), Alchemy
  4, `effect` 2, `@effect/platform-node` 2.
- 27 of the 28 files are tests. One is a test layer,
  `next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts:22`.
- The tooling folders have no call. They have 7 matches that are text: test data in
  `.agents/skills/lead/scripts/loosening.test.ts` (4), a comment in
  `.agents/skills/lead/scripts/movecheck.ts` (1), and a plant in
  `oxlint-plugins/builtin-plants.ts:645-646` (2).
- The installed Effect is 4.1.2 (the lockfile, and `node_modules/effect/package.json`, which names
  `Effect-TS/effect` as its repository). `Layer.mock` is at `node_modules/effect/src/Layer.ts:4119`,
  marked stable: it takes a service and a part of its members, and a member left out fails loudly
  when used. `node_modules/effect/AGENTS.md` points tests at services with shared test layers
  (`ai-docs/src/09_testing/20_layer-tests.ts`) and names no mock.
- In `Effect-TS/effect`, GitHub's code search finds `Layer.mock(` in three test files
  (`packages/effect/test/Layer.test.ts`, `packages/effect/test/eventlog/EventLogEncryption.test.ts`,
  `packages/ai/amazon-bedrock/test/AmazonBedrockClient.test.ts`), `vi.mock(` in 16 test files, all
  under `packages/sql/*` and `packages/platform/*`, and `vi.doMock(` in none. Each of their
  `vi.mock` calls replaces an outside driver or a Node built-in that the adapter under test
  imports. That is the one exception below.
- [0042](0042-platform-pieces-go-through-alchemy.md) already lists the `cloudflare:workers` mock as
  work to remove. [0095](0095-a-service-file-holds-only-its-contract.md) says where a service and
  its layers live.

## Decision

**In `next/` and our tooling, no test calls `vi.mock` or `vi.doMock`. A stand-in is never made with
a test framework's own tooling: it comes from the code's own design, a service with a test layer
(owner, 2026-11-15).**

- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **The code under test asks for a service,** and the law provides a test layer for it:
  `Layer.mock(Service, { ... })` for the members the law needs, or the service's own test layer.
- **A value the build writes is handed in.** A machine does not import `virtual:fabrika-built`; the
  entry file does, and provides it.
- **One narrow exception: an outside package, inside the law of the one file that wraps it.** There
  is nothing below a wrapper to swap, since the wrapper is the thing under test. `rolldown` is the
  example. That line takes `// oxlint-disable-next-line <rule> -- <why>` with its reason in plain
  words, as [`AGENTS.md`](../AGENTS.md#checks) allows where the code is right and the rule does
  not fit. A law of any other file gets the wrapper as a service.
- **Held at zero by a lint rule oxlint already has:** `vitest/no-restricted-vi-methods`. The
  `vitest` plugin is on in `.oxlintrc.json`, and this rule is not set there yet.

  ```jsonc
  // a sketch, not run
  "vitest/no-restricted-vi-methods": [
    "error",
    {
      "mock": "Give the code a service and provide a test layer (0555).",
      "doMock": "Give the code a service and provide a test layer (0555)."
    }
  ]
  ```

**Binding constraints**

- No list of allowed leftovers, and no warn level ([0524](0524-no-list-lets-broken-code-pass.md)).
  The old calls are fixed, never listed.
- A disable line is only for the exception above, one line each, with its reason.
- A fix does not move the same swap somewhere else, such as a vitest `alias` to a stand-in file.

## Consequences

- This file records the ban and how it is held. The cleanup and the lint change are later pull
  requests. Until the lint change lands, nothing stops a new call.
- **The cost is in product code.** Most of the 48 calls go only after the product code takes a
  service: the built table handed in (7 calls), `cloudflare:workers` reached through Alchemy as
  0042 says (11), a service around the bundler (9, less the exception), and the object
  implementations exported so a law can import them (4). Each is its own pull request through the
  steps.
- **As strict as the makers here.** The Effect team keeps `vi.mock` only at the edge this decision
  also keeps.
- **Places on main that teach these calls, for the cleanup to fix:**
  - `docs/plan/no-waiver-lists.md:253` tells the tests step to write
    `Effect.acquireRelease(Effect.sync(() => vi.doMock(...)), ...)`. That line asks for a banned
    call.
  - `oxlint-plugins/builtin-plants.ts:645-646` plants `vi.mock("./b.ts")` as the allowed case for
    `vitest/hoisted-apis-on-top`. The plant changes when the lint rule lands, or it trips it.
- The text matches in `loosening.test.ts` and `movecheck.ts` are data for tools that look for
  `vi.mock` in other files. They are not calls and they stay.
- **What the lint rule may miss, untested:** a renamed import such as `import { vi as v }`. The
  lint pull request plants it to find out.
- **Not decided here:**
  - `vi.spyOn` on our own modules, `vi.stubEnv`, `vi.hoisted` and `vi.importActual`.
  - Which of the four files that mock `rolldown` today count as a wrapper's own law. The plan of
    that cleanup says so per file.

---
id: 0555
title: In next/ and our tooling, no test calls vi.mock, vi.doMock, vi.spyOn or vi.stubEnv, so a stand-in comes from the code's own design, a service with a test layer, never from the test framework
status: accepted
date: 2026-11-15
tags: [tests, laws, vitest, mock, spy, env, config, layer, service, lint, oxlint, next, tooling]
---

# 0555: In next/ and our tooling, no test calls vi.mock, vi.doMock, vi.spyOn or vi.stubEnv, so a stand-in comes from the code's own design, a service with a test layer, never from the test framework

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

// before: the test framework writes the process's environment
vi.stubEnv("FABRIKA_HOME", home);

// after (a sketch): the code reads through Config, and the law provides the value
const settings = ConfigProvider.layer(ConfigProvider.fromUnknown({ FABRIKA_HOME: home }));
```

**What this decides:** how a test in `next/` and our tooling may replace a piece of code, watch a
call or set a setting, and how that is held.

## Context

- A `vi.mock` is there because a product file imports a module directly, so a test has no other
  place to put a stand-in. A `vi.spyOn` is there because the code calls a global or a module
  function directly. A `vi.stubEnv` is there because the code reads `process.env` directly. Each
  fix is in the product code, not in the test.
- Counted on `origin/main` at `d564b996f` with `rg --hidden -g '!node_modules' -o` for
  `\bvi\.<name>\(`, one pass per method, over `next/`, `.agents/`, `oxlint-plugins/` and
  `.github/ci/`:

  | Call | Calls | Files | Where |
  |---|---|---|---|
  | `vi.mock` | 39 | 25 | `next/` |
  | `vi.doMock` | 9 | 3 | `next/` |
  | `vi.mock` or `vi.doMock` | 48 | 28 | 27 in `next/apps/fabrika` (13 files), 21 in `next/packages/libfabrika` (15 files) |
  | `vi.spyOn` | 71 | 28 | `next/` |
  | `vi.stubEnv` | 23 | 8 | `next/`, all in `*.integration.test.ts` files |

- What the 71 spies watch, from the first argument of each: `globalThis.fetch` 12,
  `crypto.getRandomValues` 11, `crypto.subtle` 14, `process.kill` 7, `console` 9, and 13 on our
  own modules or on Effect (`Effect.result` 3, `SpanSink.layer` 3, `ProgramRunner.withLoader` 3).
- What the 23 stubs set: `FABRIKA_HOME` 15, `TYPESAFE_API_KEY` 3, `FABRIKA_INSTANCE_PORT` 2,
  `DO_NOT_TRACK` 1, and 2 whose name is not a plain string.
- `next/` reads `process.env` in 34 places outside `*.test.ts` files (`rg -o` for
  `\bprocess\.env\b`). 20 are in test support and test layers. 14 are in 5 product files:
  `next/packages/libfabrika/src/node/repositories/RepositoriesGit.ts` (5),
  `next/apps/fabrika/dev.ts` (4), `next/apps/fabrika/src/local-instance.ts` (2),
  `next/packages/libfabrika/src/node/build/build.ts` (2) and
  `next/packages/vitest/src/Depth.ts` (1). Outside tests, `Config.String` reads a named value on 5
  lines in 4 files.
- What the 48 replace, from the string each call names: `cloudflare:workers` 11, `rolldown` 9,
  `virtual:fabrika-built` 7, our own files and packages 13 (`./objects.ts` 4, `./table.ts` 3), Alchemy
  4, `effect` 2, `@effect/platform-node` 2.
- 27 of the 28 files are tests. One is a test layer,
  `next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts:22`.
- The tooling folders have no call. They have 8 matches that are text: test data in
  `.agents/skills/lead/scripts/loosening.test.ts` (4 `vi.mock`, 1 `vi.stubEnv`), a comment in
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
- The same search finds `vi.spyOn(` in 22 of their test files and `vi.stubEnv(` in 3, so their own
  code shows no single replacement for a spy. For `fetch` it has one: the `Fetch` reference at
  `node_modules/effect/src/http/FetchHttpClient.ts:35`, which a test provides, and which `next/`
  already provides by hand in 3 places.
- `ConfigProvider.layer` is at `node_modules/effect/src/ConfigProvider.ts:946` and
  `ConfigProvider.fromUnknown` at `:1061`, both marked stable. `next/programs/pipeline`'s laws
  already hand settings in with `ConfigProvider.fromUnknown`.
- [0042](0042-platform-pieces-go-through-alchemy.md) already lists the `cloudflare:workers` mock as
  work to remove. [0095](0095-a-service-file-holds-only-its-contract.md) says where a service and
  its layers live.

## Decision

**In `next/` and our tooling, no test calls `vi.mock`, `vi.doMock`, `vi.spyOn` or `vi.stubEnv`. A
stand-in is never made with a test framework's own tooling: it comes from the code's own design, a
service with a test layer (owner, 2026-11-15).**

- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **The code under test asks for a service,** and the law provides a test layer for it:
  `Layer.mock(Service, { ... })` for the members the law needs, or the service's own test layer.
- **A value the build writes is handed in.** A machine does not import `virtual:fabrika-built`; the
  entry file does, and provides it.
- **A setting is read through Effect's `Config`,** never straight from `process.env`, so a law
  provides it with `ConfigProvider.layer(ConfigProvider.fromUnknown({ ... }))` in place of
  `vi.stubEnv`.
- **A call the law wants to watch goes through a service,** and the law's layer records it, in
  place of `vi.spyOn`. For `fetch` that service exists: Effect's `FetchHttpClient.Fetch`. For the
  others (`crypto`, `process.kill`, `console`) the way is not known yet. When a spy is needed, it
  is built in the test package, never taken from the test framework.
- **One narrow exception: an outside package, inside the law of the one file that wraps it.** There
  is nothing below a wrapper to swap, since the wrapper is the thing under test. `rolldown` is the
  example. That line takes `// oxlint-disable-next-line <rule> -- <why>` with its reason in plain
  words, as [`AGENTS.md`](../AGENTS.md#checks) allows where the code is right and the rule does
  not fit. A law of any other file gets the wrapper as a service. The exception stands until the
  test package offers its own way for that case.
- **Held at zero by a lint rule oxlint already has:** `vitest/no-restricted-vi-methods`. The
  `vitest` plugin is on in `.oxlintrc.json`, and this rule is not set there yet.

  ```jsonc
  // a sketch, not run
  "vitest/no-restricted-vi-methods": [
    "error",
    {
      "mock": "Give the code a service and provide a test layer (0555).",
      "doMock": "Give the code a service and provide a test layer (0555).",
      "spyOn": "Put the call behind a service and record it in the law's layer (0555).",
      "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
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
- **The cost is in product code.** 142 calls in `next/`: 48 mocks, 71 spies and 23 env stubs. Most
  go only after the product code changes. **Work the cleanup must do,** each its own pull request
  through the steps:
  - **Mocks (48):** the built table handed in (7 calls), `cloudflare:workers` reached through
    Alchemy as 0042 says (11), a service around the bundler (9, less the exception), and the object
    implementations exported so a law can import them (4).
  - **Env stubs (23 in `next/`):** the 14 direct `process.env` reads in product code move to
    `Config`, so a law provides settings with a `ConfigProvider` layer. That move is a product
    slice of its own. Some of those reads may sit in startup code that runs before Effect does, so
    its plan step reads them one by one. The 20 reads in test support move with the tests that use
    them. The one `vi.stubEnv` in `.agents/` is test data in a string, and stays.
  - **Spies (71):** the 12 on `fetch` move to the `Fetch` reference. The 13 on our own modules and
    on Effect go by testing what the code does, or by a service. The rest wait for the way to spy
    that the test package builds.
- **Stricter than the makers for spies and env stubs.** The Effect team keeps `vi.mock` only at the
  edge this decision also keeps, but it uses `vi.spyOn` and `vi.stubEnv` in its own tests. We do
  not.
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
- **The hold moves to the test package later.** `next/`'s test package (today `@kampus/vitest`,
  [0538](0538-kampus-vitest-holds-the-test-primitives.md)) is to become `@kalfa/vitest`. The
  decision on `@kalfa/vitest`, which is its own file, records the owner's rule: a mechanism that
  package does not export is not used, and one we need is built in that package. The lead's
  reading of what follows here: once tests get their tools only from that package, this ban is
  held by what the package does not export, plus one lint rule that no file outside it imports
  `vitest` or `@effect/vitest` directly. Until the package is in place, the oxlint rule named above
  holds the ban.
- `next/packages/vitest/src/Depth.ts` reads `process.env` on purpose: 0538 makes it the one reader
  of `FABRIKA_TEST_DEPTH`. Whether that read moves to `Config` is the product slice's plan to say.
- **Not decided here:**
  - `vi.hoisted` and `vi.importActual`.
  - The shape of the test package's own way to spy, and of its way for the wrapper exception.
  - Which of the four files that mock `rolldown` today count as a wrapper's own law. The plan of
    that cleanup says so per file.

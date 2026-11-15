---
id: 0538
title: The test primitives our test decisions need live in one workspace package, @kampus/vitest in next/packages/vitest, which next/ and infra/ use, and each service's in-memory layer stays beside its service
status: accepted
date: 2026-11-14
tags: [tests, vitest, package, depth, integration, infra, next]
---

# 0538: The test primitives our test decisions need live in one workspace package, @kampus/vitest in next/packages/vitest, which next/ and infra/ use, and each service's in-memory layer stays beside its service

**What this decides:** where the shared test tooling lives, and what goes in it.

```ts
// A sketch of what a test file reads from it.
import { describe, it, runsFor } from "@kampus/vitest";

fc.assert(property, { numRuns: runsFor({ fast: 10, full: 100 }) }); // 0535's depth, one reader
lawsOn([Watchers.layerMemory], [WatchersSql.layer])("watcher laws", watcherLaws); // 0536: memory on PRs, real on the schedule
```

## Context

On 2026-11-14 the sev0 ([0532](0532-a-sev0-freezes-ci.md)) made several test rules at once:
fewer cases on pull requests ([0535](0535-pull-requests-stay-fast-the-schedule-carries-the-rest.md)),
in-memory layers on the merge line and real resources on the schedule
([0536](0536-real-resource-tests-run-only-on-the-schedule.md)), and a new `infra/` folder held to
the same standards ([0537](0537-infra-holds-our-own-small-services.md)). Their helpers were being
built twice, in separate places: two readers of the depth setting, and test groups configured once
per folder. Effect ships its own test helpers as a package of their own, `@effect/vitest`, apart
from its libraries. The owner ruled to do the same.

## Decision

**One workspace package, `@kampus/vitest` in `next/packages/vitest`, holds the test primitives our
test decisions need. `next/` and `infra/` import it.**

- **What goes in:**
  - the depth setting, `runsFor({ fast, full })`, the only reader of `FABRIKA_TEST_DEPTH`;
  - the three test groups (`next`, `*.integration.test.ts`, `*.visual.test.ts`) as one shared Vitest
    config;
  - a runner that applies the same laws to a memory layer and a real layer, the real one only on
    the schedule;
  - guards: a fast test that opens a file or starts a process fails loudly, and a scoped temp
    folder helper.
- **What stays out:** each service's `layerMemory`. It lives beside its service
  ([0095](0095-a-service-file-holds-only-its-contract.md)), so the package depends on no service.
- **When:** right after the integration move of 0536 lands, so it does not collide with the work
  editing those files. It takes over the helpers that work and pull request 1270 leave in
  libfabrika's `Testing.test-support.ts`.
- **Today's version does not use it** ([0217](0217-next-grows-beside-today.md)); its tests are off
  CI ([0533](0533-today-keeps-its-tests-off-ci.md)).

**Binding constraints:**

- `FABRIKA_TEST_DEPTH` has one reader, in this package.
- The package imports no service of ours.

## Consequences

- A rule in a later test decision lands as a primitive here, so every folder gets it at once.
- Not decided here: whether the package is published outside this repository. It is not, for now.
- [0554](0554-no-reflect-get-set-has.md) puts the fakes of Cloudflare objects in this package too.
  Everything above still holds.

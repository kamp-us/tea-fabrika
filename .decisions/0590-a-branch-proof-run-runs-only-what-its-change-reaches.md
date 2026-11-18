---
id: 0590
title: A branch's proof run runs only the tests its change reaches, real-instance laws included, and main's own full run stays complete as the safety net
status: amended-in-part by [0591](0591-exam-shape-checks-become-lint-rules-and-text-reads-are-declared.md), [0602](0602-integration-laws-leave-merge-line.md)
date: 2026-11-15
tags: [ci, full-run, proof-run, vitest, changed, related, scheduled, arm, merge-queue]
---

# 0590: A branch's proof run runs only the tests its change reaches, real-instance laws included, and main's own full run stays complete as the safety net

```mermaid
flowchart LR
  dispatch["scheduled.yaml dispatched on a fabrikalfa/ branch"] --> trigger{"does the change touch a forceRerunTriggers file?"}
  trigger -->|"yes: vitest.config.ts, .oxlintrc.json, tsconfig.base.json, the lockfile, a package.json"| all["the full set, as today"]
  trigger -->|"no"| changed["vitest's changed-and-related set against origin/main, .integration. and .visual. included"]
  changed --> legs["split across as many legs as the set needs, one leg if it is small"]
  legs --> arm["land.ts arm takes a green proof run of that set at the PR's head"]
  main["a push to main, the hourly cap, and the catch-up (0581)"] --> full["main's full run: every test, every time"]
```

```sh
# Sketch: what a branch's proof run asks vitest for.
vitest list --changed origin/main --related   # the files this change reaches
vitest run  <those files> --shard=<i>/<n>     # n legs, sized to the set
```

## Decision

The owner ruled on 2026-11-15, after asking for it several times, that a branch's proof run, meaning
`scheduled.yaml` dispatched on a `fabrikalfa/` branch, runs only the tests its change reaches:

1. **The set is vitest's own.** It is the changed-and-related set against `origin/main`, the same
   import graph that `--changed` uses, with `.integration.` and `.visual.` laws included. Vitest's
   [`--changed`](https://vitest.dev/guide/cli.html#changed) and
   [`forceRerunTriggers`](https://vitest.dev/config/forcereruntriggers) are the makers' tools for
   exactly this.
2. **Legs follow the set.** The set is split across as many legs as it needs, and a small set is
   one leg.
3. **A change to a file in vitest's `forceRerunTriggers` runs the full set, as today.** Those files
   are `vitest.config.ts`, `.oxlintrc.json`, `tsconfig.base.json`, the lockfile and every
   `package.json`.
4. **A law that reads a file without importing it gets that file added to `forceRerunTriggers`**
   the day it is found, so the import graph cannot miss it.
5. **`land.ts arm` accepts a green proof run of the changed set** at the pull request's head.
6. **Main's own full run stays complete:** every test, on push with the hourly cap, plus the
   catch-up (0581). It is the safety net for anything the changed set misses.

Batches of pull requests in one proof run stay possible, but are rarely needed after this.

This amends [0534](0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md),
[0536](0536-real-resource-tests-run-only-on-the-schedule.md) and
[0581](0581-main-full-run-starts-on-push-and-hourly.md): a branch's run is no longer the full set.

## Consequences

- A small change waits for its own tests, not every leg. The one-at-a-time line moves faster.
- A miss in the import graph shows on main's next full run, and its file joins
  `forceRerunTriggers`.
- The build is lead tooling, fast-tracked: the scheduled workflow's dispatch path, the leg split,
  and `land.ts arm`'s check.

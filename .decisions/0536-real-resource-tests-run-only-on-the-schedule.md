---
id: 0536
title: Pull requests and the merge queue test only against our interfaces' in-memory layers, and every test that needs a real resource runs only in main's full run
status: accepted
date: 2026-11-14
tags: [ci, tests, schedule, integration, memory-layer, merge-queue]
---

# 0536: Pull requests and the merge queue test only against our interfaces' in-memory layers, and every test that needs a real resource runs only in main's full run

**What this decides:** where a test that touches a real resource runs.

```ts
// A sketch: the same law, two layers, two places.
watcherLaws(Watchers.layerMemory); // pull request and merge queue
watcherLaws(WatchersSql.layer);    // main's full run only: proves the real driver keeps the interface
```

## Context

The test audit of 2026-11-14 (experiment 291) found that 111 tests, 4% of `next/`'s, take 66% of
its time, and nearly all of them reach a real resource: SQLite files, git, workerd, a spawned
process or a browser. [0062](0062-test-files-keep-the-floors.md) already writes most of
those laws once, as a shared suite over an interface, and runs it on a real driver.
[0535](0535-pull-requests-stay-fast-the-schedule-carries-the-rest.md) cut their case count on
pull requests and gave git an in-memory layer. The owner then ruled further: the merge line should
not run them at all.

## Decision

**Pull requests and the merge queue run tests only against our interfaces' in-memory layers. A
test that needs a real resource runs only in main's full run** (`.github/workflows/scheduled.yaml`,
started by a push to main and an hourly catch-up,
[0581](0581-main-full-run-starts-on-push-and-hourly.md)).

- **A real resource** is anything outside the process's memory that a test drives: a SQLite file,
  git, workerd or Miniflare, a spawned process, a browser or Electron, a real bundler, a socket, or
  the file system beyond reading the repository's own text. Reading repository files as text (the
  reader tests) is not one. What decides it is what a test uses, never its name
  ([0584](0584-a-tests-kind-follows-what-it-uses.md)): a test that starts or reaches a real thing,
  or writes local disk, is a real-resource test, and any other law, a tooling law included, is
  plain and runs on the pull request its change reaches.
- **A shared suite runs twice:** on the in-memory layer on the merge line, and on the real driver
  in main's full run. That run is what holds the in-memory layer to the real driver's behavior.
- **A law that can run on a stand-in runs on every pull request.** A real layer's run of the same
  law stays on the full run ([0581](0581-main-full-run-starts-on-push-and-hourly.md)).
- **A law that only exists against a real resource** moves to main's full run too, and its
  interface gets an in-memory layer (`layerMemory`, as git's in 0535) so the law can come back to
  the merge line.
- **A test that cannot run on an in-memory layer is marked as an integration test** and moves into
  its own integration layer (a Vitest project of its own), which runs only in main's full run, not
  in a pull request, the merge queue or a branch's proof run
  ([0590](0590-a-branch-proof-run-runs-only-what-its-change-reaches.md),
  [0602](0602-integration-laws-leave-merge-line.md)). The end-to-end tests are part of it. The mark
  is the file name, `.integration.` for these and `.visual.` for the visual ones, which the projects
  in `vitest.config.ts` read, so CI picks the files without a list, and a lint rule holds it.
- **Visual end-to-end tests are opt-in on a pull request.** They are heavy and need a device (a
  browser or Electron). They run in main's full run, and a pull request asks for them on purpose
  with the `visual` label (`.github/workflows/check.yaml`) when its change needs them. They never
  start on a pull request by default, and never in the merge queue.
- **The commit-signature law is one of them.** The law that the commit check refuses a forged step
  signature (`exam/commits-git-signatures`, real git and ssh-keygen) runs in main's full run like
  the rest, so a break in that check is found on main's next full run, within about the gap
  (`env.GAP_MINUTES` in `scheduled.yaml`). The owner ruled this on the first security case the
  classification named, on 2026-11-14.

**Binding constraints:**

- No pull request or merge queue run starts a test that drives a real resource, except a visual
  end-to-end run a pull request asked for.
- A shared suite's real-driver run stays in main's full run; it is never dropped.

## Consequences

- **What is lost:** a bug that only a real driver shows (a SQL statement, a git quirk, a workerd
  behavior) is found on main's next full run, within about the gap (`env.GAP_MINUTES` in `scheduled.yaml`), not before the merge. The owner accepts that
  while nothing ships to production.
- Amends [0062](0062-test-files-keep-the-floors.md) in part (its real-database suites
  run on the schedule, not on every change) and
  [0535](0535-pull-requests-stay-fast-the-schedule-carries-the-rest.md) in part (heavy real-IO laws
  leave the merge line instead of running fewer cases there; the depth setting stays for the laws
  that remain).
- Not decided here: the case where a real resource is the only way to prove a security property.
  The classification names any such test, and each one comes to the owner.

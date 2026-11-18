---
id: 0536
title: Pull requests and the merge queue test only against our interfaces' in-memory layers, and every test that needs a real resource runs only on the 3-hour schedule
status: amended-in-part by [0581](0581-main-full-run-starts-on-push-and-hourly.md), [0584](0584-a-tests-kind-follows-what-it-uses.md), [0590](0590-a-branch-proof-run-runs-only-what-its-change-reaches.md)
date: 2026-11-14
tags: [ci, tests, schedule, integration, memory-layer, merge-queue]
---

# 0536: Pull requests and the merge queue test only against our interfaces' in-memory layers, and every test that needs a real resource runs only on the 3-hour schedule

**What this decides:** where a test that touches a real resource runs.

```ts
// A sketch: the same law, two layers, two places.
watcherLaws(Watchers.layerMemory); // pull request and merge queue
watcherLaws(WatchersSql.layer);    // the 3-hour schedule only: proves the real driver keeps the interface
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
test that needs a real resource runs only on the 3-hour schedule.**

- **A real resource** is anything outside the process's memory that a test drives: a SQLite file,
  git, workerd or Miniflare, a spawned process, a browser or Electron, a real bundler, a socket, or
  the file system beyond reading the repository's own text. Reading repository files as text (the
  reader tests) is not one.
- **A shared suite runs twice:** on the in-memory layer on the merge line, and on the real driver
  on the schedule. The schedule's run is what holds the in-memory layer to the real driver's
  behavior.
- **A law that only exists against a real resource** moves to the schedule too, and its interface
  gets an in-memory layer (`layerMemory`, as git's in 0535) so the law can come back to the merge
  line.
- **A test that cannot run on an in-memory layer is marked as an integration test** and moves into
  its own integration layer (a Vitest project of its own), which runs with the other scheduled
  runs. The end-to-end tests are part of it. The mark is something code reads, so CI picks the
  files without a list, and a lint rule holds it. Which mark (a file name or a folder) is chosen by
  the classification of 2026-11-14.
- **Visual end-to-end tests are opt-in on a pull request.** They are heavy and need a device (a
  browser or Electron). They run on the schedule, and a pull request can ask for them on purpose
  when its change needs them. They never start on a pull request by default.

**Binding constraints:**

- No pull request or merge queue run starts a test that drives a real resource, except a visual
  end-to-end run a pull request asked for.
- A shared suite's real-driver run stays on the schedule; it is never dropped.

## Consequences

- **What is lost:** a bug that only a real driver shows (a SQL statement, a git quirk, a workerd
  behavior) is found within about 3 hours on main, not before the merge. The owner accepts that
  while nothing ships to production.
- Amends [0062](0062-test-files-keep-the-floors.md) in part (its real-database suites
  run on the schedule, not on every change) and
  [0535](0535-pull-requests-stay-fast-the-schedule-carries-the-rest.md) in part (heavy real-IO laws
  leave the merge line instead of running fewer cases there; the depth setting stays for the laws
  that remain).
- How a pull request asks for the visual run is a setting of the build, not decided here; a GitHub
  label is the common way.
- Not decided here: the case where a real resource is the only way to prove a security property.
  The classification names any such test, and each one comes to the owner.

## Amendments

- 2026-11-15: every "3-hour schedule" here now means the full run on main, which starts on a push
  to main (at most one an hour) and on an hourly catch-up cron
  ([0581](0581-main-full-run-starts-on-push-and-hourly.md)). This file's rule stands: a real-resource
  law stays off the pull request and the merge line. 0581 adds that every law that can run on a
  stand-in runs on every pull request.

- 2026-11-14: the owner ruled on the first security case the classification named. The law that
  the commit check refuses a forged step signature (`exam/commits-git-signatures.test.ts`, real git
  and ssh-keygen) moves to the schedule like the rest. A broken check is found within about 3 hours.

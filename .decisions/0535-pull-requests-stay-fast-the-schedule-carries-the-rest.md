---
id: 0535
title: A pull request and the merge queue run only fast checks, and everything slower moves to main's scheduled full run, mutation and real git included, with git faked in memory on the merge line
status: accepted
date: 2026-11-14
tags: [ci, schedule, tests, property, git, mutation, merge-queue]
---

# 0535: A pull request and the merge queue run only fast checks, and everything slower moves to main's scheduled full run, mutation and real git included, with git faked in memory on the merge line

**What this decides:** the rule that sorts every slow check: the merge line gets the fast version,
and the schedule from [0534](0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md), main's
full run in `.github/workflows/scheduled.yaml`, gets the full one.

```ts
// A sketch: one setting picks the depth, read where a heavy law runs.
const depth = process.env.FABRIKA_TEST_DEPTH === "full" ? "full" : "fast"; // "full" only on the schedule
// A property law is it.prop or it.effect.prop, its seed set once in the package setup (0579). Its case
// count comes from the depth, never a bare numRuns:
it.effect.prop("a law over git", { repo: RepoId }, body, { fastCheck: { numRuns: runsFor(depth, { fast: 10, full: 100 }) } });

// Git, on the merge line: the in-memory test layer of the same service.
it.layer(GitMemory.layer)("a law over git", ...);   // pull request and merge queue
it.layer(GitReal.layer)("the same law, real git", ...); // the schedule only
```

## Context

The test audit of 2026-11-14 (experiment 291,
[pull request 1260](https://github.com/kamp-us/tea-fabrika/pull/1260)) found that 111 tests, 4% of
`next/`'s, take 66% of its time, nearly all of them generated laws over real SQLite, git, workerd
or a browser. 0534 already took the full suite off the merge line. The owner then ruled that the
focus is fast pull request and merge checks, since nothing ships to production yet: cut everything
that can be cut from the merge line, and rely on the scheduled runs.

## Decision

**A pull request and the merge queue run only fast checks. Everything slower runs in main's full
run on the schedule.**

- **Heavy property laws run few cases on the merge line and their full count on the schedule.**
  One setting (`FABRIKA_TEST_DEPTH`, `fast` by default, `full` on the schedule) picks the count. A
  law over real IO reads its count from that setting, with a small floor, never a number written in
  the law. A lint rule refuses a bare `numRuns` in such a law.
- **Git gets an in-memory test layer.** The git service's laws run against an in-memory git on the
  merge line. The same laws run against real git on the schedule, so the in-memory layer is held to
  real git's behavior (a contract test).
- **Mutation moves to the same schedule.** The mutation workflow (`mutation.yaml`) is started by
  the schedule's cron (`.github/workflows/scheduled.yaml`'s `on.schedule`) and by hand, never by a
  push ([0067](0067-hourly-mutation-runs-in-ci.md)), over the range since its last run, with the
  same fixed seed and sample. Its survivors open or update one GitHub issue, the same way a red
  scheduled run does in 0534. An agent judges the survivors from that issue later.
- **Any other slow check follows the same rule:** a fast form on the merge line where one exists,
  the full form on the schedule.

**Binding constraints:**

- No law over real IO writes its own case count; it reads the depth setting.
- The in-memory git layer and real git run the same laws.
- No mutation run starts from a pull request or the merge queue.

## Consequences

- **What is lost:** a rare case only the full count reaches, a difference only real git shows, or a
  mutation survivor is found on main's next scheduled run, not before the merge. The owner accepts
  that while nothing ships to production.
- Amends [0066](0066-mutation-runs-on-a-schedule.md), [0067](0067-hourly-mutation-runs-in-ci.md) and
  [0123](0123-githubs-schedule-starts-the-mutation-run.md) in part: mutation runs on the schedule,
  and its survivors land as one GitHub issue rather than tickets filed by an agent
  first. The fixed seed and sample are kept.
- The case counts per depth and the floor are settings ([0069](0069-choices-are-settings.md)).
- Not decided here: which other services get an in-memory layer next. Each one follows the git
  pattern when its laws show up as slow.

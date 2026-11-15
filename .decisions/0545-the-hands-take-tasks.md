---
id: 0545
title: The work the hands take from the queue is called a task, and job keeps one meaning, what one start made
status: accepted
date: 2026-11-15
tags: [names, hands, task, job, glossary]
---

# 0545: The work the hands take from the queue is called a task, and job keeps one meaning, what one start made

**What this decides:** the word for one piece of work the hands take from the queue, in `next/`.

## Context

The glossary had two meanings for job: what one start made (a shell line), and the work
the hands take from the queue with a lease. One word with two meanings inside neighboring contexts
is what [we follow DDD](../docs/direction/we-follow-ddd.md) asks us to avoid. Temporal, Celery and
Nomad all call the unit a worker takes from a queue a task. GitHub Actions and Buildkite call it a
job, which is where our word came from. The owner picked task.

## Decision

**The work the hands take from the queue is a task.**

- The wire methods become `tasks.list`, `tasks.wait`, `tasks.take` and `tasks.finish`, and the code
  that holds them follows: the module, the layer name, the journal's words, the docs.
- Job keeps its one meaning: what one start made, a root and everything under it.
- The rename is one pull request, done in one go, so no reader meets both words for one thing.
- Saved data keeps the word it was written with: field rows are never edited, and a stream or
  event name already written to a ledger is read under both names until no such ledger is left.

## Consequences

- The glossary's `job (clients)` row becomes `task`.
- Decision [0102](0102-hands-is-a-grant-rank-and-work-is-taken.md) and the hands notes still say
  job in their text until the rename lands; their rules do not change.
- Not decided here: the word for work given to an agent.

## Records

- `.glossary/TERMS.md`: the `job (clients)` row is now `task`.

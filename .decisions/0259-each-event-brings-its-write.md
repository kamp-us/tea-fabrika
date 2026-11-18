---
id: 0259
title: In next/, a fact is an Event, and an event names its stream once, never a step
status: accepted
date: 2026-11-08
tags: [programs, program-shape, events, streams, next]
---

# 0259: In next/, a fact is an Event, and an event names its stream once, never a step

**What this decides:** what a fact is called in a program's API in `next/`, and where the stream
it goes to is named.

```ts
const answered = Event.make(Answered, {
  personOnly: true,
  stream: (e) => ticketStream(e.ticket), // one place picks the stream
});
```

## Context

Decided by the owner in [a program's shape](../docs/direction/program-shape.md). The glossary's
`event` row already carries the rename. P11's one `write` Cmd per program is walked back by name.
The prose sweep of the old word is ticket 303. A program has no `cmds`, and how an event is written
is decided in [0601](0601-program-make-with-optional-pipes.md), the home of a program's shape.

## Decision

**A `Fact` is an `Event`, and an event names its stream once.**

- `Fact` becomes `Event`, event sourcing's word, in the program API and the glossary.
- An event names its stream once, in `Event.make`. A step never names a stream.

## Consequences

- Two writes cannot send one event kind to two streams.
- Reopens it: the first event kind that must go to several streams.

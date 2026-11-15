---
id: 0550
title: In next/, a pipe fits when the writer's output has at least the fields the reader's input needs, and one that does not fit is refused when the line is run, before any process starts
status: accepted
date: 2026-11-15
tags: [pipes, fit, schemas, packs, fabsh, next]
---

# 0550: In next/, a pipe fits when the writer's output has at least the fields the reader's input needs, and one that does not fit is refused when the line is run, before any process starts

```ts
// A sketch, next/: `fits` is made up; the schemas are real Effect Schema.
import { Schema } from "effect";

const TrackerRow = Schema.Struct({ id: Schema.String, title: Schema.String, state: Schema.String }); // pack A writes
const OutlineRow = Schema.Struct({ id: Schema.String, title: Schema.String });                      // pack B reads
const BoardRow = Schema.Struct({ id: Schema.String, column: Schema.String });                       // pack C reads

fits(TrackerRow, OutlineRow); // "fits": `state` is extra, and extra is fine
fits(TrackerRow, BoardRow);   // "does_not_fit": `column` is missing; the line is refused, nothing starts
```

**What this decides:** when the output of one program fits the input of the next in a pipe, and
when a pipe that does not fit is refused, in `next/`.

## Context

The proposed pipes note, "how a pipe carries output"
(https://github.com/kamp-us/tea-fabrika/pull/1322), leaned that in v0 the two schemas must be the
same, and that a looser fit waits for a real pair. The owner ruled on 2026-11-15 for the looser fit,
because it is what lets two programs from two different packs be piped.

Today's version fits only on an exact match: the same JSON Schema, once the notes for people are
taken out, where more fields does not fit and fewer does not fit
(`packages/fabrika/src/program/shape.ts`, `fit` and `Fit`). This decision changes that rule only
for `next/`. Today's version keeps exact match until it goes.

It keeps G6 in the
[program guidelines](../docs/direction/program-guidelines.md#g6-programs-meet-on-typed-pipes-never-by-calling-each-other):
programs meet on typed pipes, and the fit check refuses a pipe whose types do not match. This says
what "match" means in `next/`.

## Decision

**A pipe fits when the writer's output has at least the fields the reader's input needs. Extra
fields are fine.**

- This is what lets two programs from two different packs be piped.
- The pipe stays typed: a pipe that does not fit is refused when the line is run, before any
  process starts.

**Binding constraints**

- No line starts a process before its pipes are checked.

## Consequences

- fabsh asks for the pipe before it starts the line's programs, so the check reads the two
  programs' declared schemas, not running processes. The note holds the order as the design.
- Not decided here: how the check compares a field's type, and what it does with a union, an
  optional field or a refinement. The note's lean is that what the check cannot decide is refused.
- Today's `fit` in `packages/fabrika` is unchanged.

## Records

- `.glossary/TERMS.md`: the `pipe` row says the fit rule, and says message for one piece of mail
  ([0547](0547-program-mail-is-a-message.md)).

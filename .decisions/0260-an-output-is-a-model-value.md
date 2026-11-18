---
id: 0260
title: In next/, a program's output is never a Cmd and is kept nowhere
status: accepted
date: 2026-11-08
tags: [programs, program-shape, outputs, pipes, next]
---

# 0260: In next/, a program's output is never a Cmd and is kept nowhere

**What this decides:** what a program's output is, so "output" and "Cmd" keep one meaning each.

## Context

Decided by the owner in [a program's shape](../docs/direction/program-shape.md). It walks back
tea-program's "outputs are events" for `next/`; [tea-program](../docs/direction/tea-program.md)
keeps that rule for today's version only. How an output is made, from the program's state by
`Program.outputs`, is decided in [0601](0601-program-make-with-optional-pipes.md), the home of a
program's shape.

## Decision

**An output is made from the program's state, is never a Cmd and is kept nowhere.**

- An output is never a Cmd: it has no answer.
- An output is not an event either: it is kept nowhere.

## Consequences

- No output Cmd is kept in step with the state.
- Not decided here: whether an output is sent only when it changes, and what `null` means.

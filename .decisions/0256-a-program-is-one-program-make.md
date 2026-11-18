---
id: 0256
title: In next/, a program is one Program.make with every type inferred and nothing written twice, never defineProgram or a plain object
status: accepted
date: 2026-11-07
tags: [programs, program-make, machine, types, tea, next]
---

# 0256: In next/, a program is one Program.make with every type inferred and nothing written twice, never defineProgram or a plain object

**What this decides:** how a person writes a program in `next/`: one constructor, and types that
come from the schemas.

## Context

Decided by the owner on 2026-11-07, in the note "a program is one typed Program.make", since
removed: this file holds its rules.
The owner then had the shape inside `Program.make` rethought; the pick is
[a program's shape](../docs/direction/program-shape.md), in
[0257](0257-a-programs-api-has-one-way.md) to [0260](0260-an-output-is-a-model-value.md). What a
`Program.make` call looks like is decided in
[0601](0601-program-make-with-optional-pipes.md), the home of a program's shape. Today's version
keeps `defineProgram` until that code goes.

## Decision

**A program is one `Program.make`, in Effect's `X.make` style.**

- Never `defineProgram`, another `defineX`, or a plain object literal.
- Nothing is written twice. Every type is inferred from the schemas, and nobody writes one by hand.
- The `Program` Schema stays only as the load-time check `Program.make` runs, never the shape a
  person writes.
- Fields such as `location`, `prefix`, `index`, `find` and `commands` join only with the tier row
  that builds them.

## Consequences

- tea's `Machine.make` kept no schemas; tea 0.27.0 ships it
  ([demlik#897](https://github.com/kamp-us/demlik/issues/897)). Today's version keeps the local
  patch for it until it goes: `pnpm-workspace.yaml`, `patchedDependencies`, key
  `'@demlik/tea@0.25.0'`.
- Not decided here: the exact generic signature, which its plan settles with type tests.

---
id: 0410
title: The test config caps workers and refuses broad local runs, test setup picks a home whose socket path fits in 103 bytes, and one OS lock holds the type check across shells
status: accepted
date: 2026-11-08
tags: [tests, typecheck, laptop, lead]
---

# 0410: The test config caps workers and refuses broad local runs, test setup picks a home whose socket path fits in 103 bytes, and one OS lock holds the type check across shells

**What this decides:** which of the laptop's limits code holds, not a brief.

## Context

From [skills keep judgment, K9](../docs/direction/skills-hold-only-judgment.md#the-rule), decided
2026-11-08. AGENTS.md's "Go easy on the machine" names the same limits.

## Decision

**The caps that kept a laptop usable are code.**

- The test config caps workers and refuses a broad local run.
- Test setup picks a home whose host socket path fits in 103 bytes.
- `typecheck.sh` holds one fixed OS lock across shells, through patching and compiling, and releases
  it when its last holder exits, a crash included.
- A Node pin that differs from the installed one is refused with both versions named.

## Consequences

- A step's brief no longer repeats these caps as instructions.

## Amendments

### 2026-11-15: the typecheck lock may be a pid lock at the same single path

The script-port sweep ([0113](0113-no-shell-or-python-scripts.md), and the owner's 2026-11-15 order
that every shell and Python script is ported) moves `typecheck.sh` to `scripts/typecheck.ts`. The
lead ruled that "one fixed OS lock" may become a pid lock at the same single path, following
Mercurial's repository lock (`mercurial/lock.py`, read at 7.2.4). The lock is made atomically and
names its holder's pid. A dead holder's lock is broken only while a `.break` lock is held. This
decision's rule holds as written: one type check at a time across shells, held in code. Only the
mechanism changes. A branch still on the old lock does not wait on the new one until it merges main.

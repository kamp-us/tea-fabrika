---
id: 0608
title: The AGENTS.md files an agent reads together stay under the smallest documented limit of the agents that read them, a setting with its source, held by a size check in pnpm lint
status: superseded by [0610](0610-agents-md-follows-memory-guide.md)
date: 2026-11-18
tags: [agents-md, map, size, setting, codex, lint, kalfa-records]
---

# 0608: The AGENTS.md files an agent reads together stay under the smallest documented limit of the agents that read them, a setting with its source, held by a size check in pnpm lint

```text
read together                       bytes on 2026-11-18   limit (Codex default)
AGENTS.md                           39,103                32,768
AGENTS.md + next/AGENTS.md          49,582                32,768
```

**What this decides:** how big the always-read map may be, and where that number comes from.

## Context

The [rules and records guidelines](../docs/guidelines/rules-and-records.md), R6, approved in
[0604](0604-rules-and-records-guidelines-approved.md). Codex "stops adding files once the combined
size reaches the `project_doc_max_bytes` limit", 32 KiB by default
([Codex](https://developers.openai.com/codex/guides/agents-md)). Claude Code advises under 200 lines
per file ([memory docs](https://code.claude.com/docs/en/memory)). Past 32 KiB, a Codex step stops
reading the root file before "How to write here".

This changes [0129](0129-agents-md-becomes-a-short-map.md)'s size target, "about 150 lines", into
the setting below.

## Decision

**The root `AGENTS.md`, and the root with each folder's `AGENTS.md` read after it, stay at or under
one byte limit, a setting whose default is the smallest documented limit of the agents that read
them, with its source beside it, and `pnpm lint` fails a chain that is over.**

- The default today is 32,768 bytes, Codex's `project_doc_max_bytes` default, with the docs link in
  the setting's own doc text.
- The number changes only with a new source: a reader's documented limit, or a run of our own.
- The check lives in `@kalfa/records` ([0585](0585-kalfa-is-six-domain-packages.md)) and reads the
  setting through `@kalfa/config`.

## Consequences

- The map is cut to fit before the check turns on
  ([the build plan](../docs/plan/quests/rules-and-records-build-PLAN.md)), mostly by moving rules to
  their homes (R1, R3).
- Not decided here: whether our Codex steps load the repo's `AGENTS.md` at all; that was read in
  the docs, not tested.

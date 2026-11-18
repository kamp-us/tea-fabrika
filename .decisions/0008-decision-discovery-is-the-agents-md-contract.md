---
id: 0008
title: Decision discovery is the AGENTS.md contract alone, with no committed index and no startup hook
status: accepted
date: 2026-11-09
tags: [decisions, discovery, agents-md, adr]
---

# 0008: Decision discovery is the AGENTS.md contract alone, with no committed index and no startup hook

**What this decides:** agents find decisions by listing `.decisions/` and reading frontmatter, as the "Decision discovery" section of `AGENTS.md` says. Nothing is committed to help them, and no startup hook runs. One lead command, `records.ts`, may list the folder and print its next free number.

## Context

We copy what [kamp-us/phoenix](https://github.com/kamp-us/phoenix) does, as the owner asked on 2026-11-09. Phoenix first made discovery ambient, then dropped its startup hook
([ADR 0129](https://github.com/kamp-us/phoenix/blob/main/.decisions/0129-adr-discovery-is-the-claude-md-contract.md)):
the hook was a second discovery path to keep honest, for a map a reader can produce with one `ls`.
Our `.decisions/README.md` was an index of the same kind, so it goes.

[0522](0522-no-folder-keeps-an-index-table.md) changed one thing: this record first ruled out a
compact-map command, and 0522 added `records.ts`, a lead command that lists a folder and gives the
next free number from `origin/main`.

## Decision

**Decision discovery is the `AGENTS.md` contract alone.**

- `AGENTS.md` has a "Decision discovery" section: list `.decisions/`, filenames identify records, frontmatter gives `id`, `title` and `status`, read applicable records when changing the choice they govern or resolving conflicting guidance, record new ones with `/adr`.
- No committed decision index and no startup hook. The only command is `records.ts`
  (`.agents/skills/lead/scripts/records.ts`): it lists `.decisions/` from `origin/main` and gives the
  next free number ([0522](0522-no-folder-keeps-an-index-table.md)).
- `.decisions/README.md` is deleted. Its rules (when to write one, file shape) live in [the adr skill](../.agents/skills/adr/SKILL.md).
- `AGENTS.md` keeps one pointer row for `.decisions/` in its read/write table.

## Consequences

- A decision PR edits no index, so two PRs never collide on a row. A pull request that still adds a `.decisions/README.md` row drops it when it catches up with main.
- The `title` must carry the decision: it is the only summary a lister sees.
- Not decided here: a validator for frontmatter or number clashes.

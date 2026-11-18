---
id: 0129
title: AGENTS.md becomes a short map, each rule leaving it by one of three moves, in one pull request with a table of every line removed
status: accepted
date: 2026-11-11
tags: [agents-md, agents, docs, rules, lint, decisions, discovery, map]
---

# 0129: AGENTS.md becomes a short map, each rule leaving it by one of three moves, in one pull request with a table of every line removed

```mermaid
flowchart TD
  rule["one rule in AGENTS.md"] --> checked{"does code check it?"}
  checked -- "yes" --> gone["the prose is deleted; the check's message teaches it"]
  checked -- "no" --> decided{"did the owner decide it?"}
  decided -- "yes" --> link["one line and a link to its decision file"]
  decided -- "no" --> folder{"is it about one folder only?"}
  folder -- "yes" --> scoped["that folder's own AGENTS.md"]
  folder -- "no" --> stays["it stays in the map"]
```

```text
before   AGENTS.md   685 lines, 12 sections, every rule for both versions in one file
after    AGENTS.md   a short map, within the `records.map.max-bytes` setting (0608): where to
                     read and write, the three checks, the public repo rules, the laptop caps
         next/AGENTS.md and others   the rules for one folder, read when working there
```

The same rules exist after as before. What changes is where each one is read.

**What this decides:** how the top instructions file gets short, and what proves no rule was lost.

## Context

The fifth principle of how we get work done says the repo is the memory and the top file is a
map. `AGENTS.md` is 685 lines on 2026-11-11, and every agent reads all of it for every job. The
teams that study read keep theirs short and point from it, or scope rules by folder. No
measurement here shows the long file hurts. A test of long against short was to come before the
cut, and [0180](0180-instruction-files-take-quick-edits.md) withdrew it.
[0115](0115-decided-rules-live-in-decision-files.md) already moves every decided rule into a
decision file, which empties much of `AGENTS.md` by itself.

## Decision

**`AGENTS.md` becomes a short map. Each rule leaves it by one of three moves, and none is dropped.**

- **Code checks it:** the prose is deleted, and the check's own message says what to do
  (AGENTS.md's rule that a checked rule leaves the prose).
- **The owner decided it:** it becomes one line with a link to its decision file
  ([0115](0115-decided-rules-live-in-decision-files.md),
  [0008](0008-decision-discovery-is-the-agents-md-contract.md)).
- **It is about one folder:** it moves to that folder's own `AGENTS.md`, such as `next/AGENTS.md`,
  which an agent reads when it works there.
- **Its size is a setting, not a line count:** `records.map.max-bytes`, in `.kalfa/kalfa.toml` under
  `[records.map]`, for the root alone and for the root with each folder's file
  ([0608](0608-the-map-fits-its-readers-limits.md)).
- What stays: what the repo is, the table of where to read and where to write, decision discovery,
  the three checks and the narrowest-check table, the public repo rules, and the laptop caps.

**The order:** the cut is one pull request, opened as soon as it is written, with no test first
([0180](0180-instruction-files-take-quick-edits.md)).

**Binding constraints**

- The cut's pull request carries a table with one row for every line or bullet removed: where it
  went, or which check holds it. A rule with no row blocks the merge.
- A folder's file adds no rule that the map or a decision contradicts.
- The cut changes no rule. A rule that looks wrong becomes a question, not an edit.

## Consequences

- An agent's first read gets much shorter, and a rule is read where it applies.
- The cost: it is the most-read file in the repo, so a lost rule would be felt at once and found
  late. The table is the guard.
- A rule an agent missed after the cut is put back, or given a better home, the day it is seen.
- Not decided here: which folders get a file of their own.

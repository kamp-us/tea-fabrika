---
name: adr
description: Record one owner decision as an ADR in `.kalfa/decisions/`. Use on "record this decision", "write it down", "ADR for X", and when a hard-to-reverse, surprising choice with a real trade-off gets settled.
---

# adr

Decisions live in `.kalfa/decisions/`, one file each, numbered `0001-slug.md`, `0002-slug.md` and so
on. The format is the ADR format in the `domain-modeling` skill: a title, then one to three sentences of context, what we
decided and why. Read the ADR format (`.agents/skills/domain-modeling/ADR-FORMAT.md`) before you write one (that file
lands with the domain-modeling skill).

Write an ADR only when all three hold: the decision is hard to reverse, a reader of the code would
find it surprising, and it was a real trade-off between options. Anything else is a setting, a
guideline in the docs, or nothing to record.

Take the next free number in `.kalfa/decisions/`. One decision, one docs pull request.

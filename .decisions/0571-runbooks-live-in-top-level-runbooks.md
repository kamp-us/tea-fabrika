---
id: 0571
title: Runbooks live in a top-level .runbooks/ folder, one checklist file per operation, written the first time we do it for real, and docs/ holds only what fabrika is
status: accepted
date: 2026-11-15
tags: [runbook, operations, checklist, docs, sev, skills, wipe, dev-home]
---

# 0571: Runbooks live in a top-level .runbooks/ folder, one checklist file per operation, written the first time we do it for real, and docs/ holds only what fabrika is

**What this decides:** an operation we run by hand, such as a sev or wiping the dev and test homes after a saved shape changes, gets a runbook (a checklist for when that thing happens) in `.runbooks/`, and `docs/` stays for documentation of what fabrika is.

```text
.runbooks/
  sev.md                    first: a sev (CI is the emergency)
  wipe-dev-test-homes.md    second: a saved shape changed, wipe the dev and test homes
```

```markdown
---
summary: one line, what happens and when to open this file
follows: [NNNN]
---

# <operation>

- [ ] step
- [ ] step
```

The second block is a sketch of a runbook's shape, not a fixed schema.

## Context

An operation we do rarely, by hand, under some stress, needs its steps written down where the next
person finds them. Today those steps would land in `docs/how-to/`, a skill, or a chat. `docs/` is
for what fabrika is, so a how-we-run-it checklist does not belong there. The industry word is
runbook. Google's SRE Workbook calls the same thing a playbook: "Playbooks contain high-level
instructions on how to respond to automated alerts", and a playbook entry is usually created
whenever an alert is created
([The SRE Workbook, chapter 8, On-Call](https://sre.google/workbook/on-call/); the first book's
[chapter 11, Being On-Call](https://sre.google/sre-book/being-on-call/) covers the on-call practice
it belongs to). We use "runbook", the common name, and say so here once.

## Decision

**Runbooks live in a top-level `.runbooks/` folder, one file per operation, each a checklist for the
moment that operation happens.**

- One file per operation, named for the operation.
- A runbook is written the first time we do the operation for real, from what we did. Nobody
  writes one in advance from a guess.
- A runbook links the decision it follows. It adds no rule of its own: a rule goes in `.decisions/`.
- The first two are a sev, and "a saved shape changed: wipe the dev and test homes".
- Skills stay. A skill is a runbook for a general idea, as the
  [sev skill](../.agents/skills/sev/SKILL.md) is for how the lead acts when CI is the emergency. The
  runbook is the checklist for one operation; the skill is the judgment around the idea
  ([0408](./0408-skills-keep-only-judgment.md)).
- `docs/` holds only documentation of what fabrika is.

**Binding constraints:**

- A runbook is not written before its operation has run for real.
- A runbook never holds a rule that no decision file holds.

## Consequences

- `AGENTS.md`'s "Where to read, where to write" table gains one row for runbooks.
- `.glossary/TERMS.md` gains a row for "runbook".
- This decision makes no runbook file itself. The two first ones come when their operations next run
  for real.
- Not decided here: the exact frontmatter of a runbook, and whether a check reads the folder.
  Neither is needed until a first file exists.

## Records

- Glossary: `runbook`, in Shared names.

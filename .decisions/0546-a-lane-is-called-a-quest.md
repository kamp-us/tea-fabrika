---
id: 0546
title: A lane is called a quest, as a rename only, and what else a quest becomes is decided later
status: accepted
date: 2026-11-15
tags: [names, quest, lane, glossary]
---

# 0546: A lane is called a quest, as a rename only, and what else a quest becomes is decided later

**What this decides:** the word for one ticket's run through the pipeline.

## Context

Lane is a factory word: work moves past stations. The owner wants the doer first: someone accepts
a piece of work, carries it and turns it in. A ticket stays what a person asked for; the quest is
what starts when someone takes it up. The industry's words for this are run and workflow run, and
we already use run for one agent's turn, so the owner picked a word of our own.

## Decision

**One ticket's run through the pipeline is called a quest.**

- It is a rename only. A quest is everything a lane was: the same steps, the same state file, the
  same rules for when it stops.
- The rename is one pull request, done in one go: the lead tooling, the skills, the plan and the
  notes, so no reader meets both words for one thing.
- Saved data keeps the word it was written with. Field rows are never edited: an old row says
  lane, a new one says quest, and a reader of rows reads both.
- The merge line keeps its name. It is a different thing.

## Consequences

- The glossary's `lane` row becomes `quest`.
- Decision files, field rows, experiments, saved data and today's version's code written before
  today still say lane; their rules do not change.
- Not decided here: who accepts a quest, who it is turned in to, what leaving one means, a chain of
  quests, and anything a person earns. Those get their own talk.

## Records

- `.glossary/TERMS.md`: the `lane` row is now `quest`.

## Amendments

- 2026-11-15: the Consequences line on what still says lane was made exact. It said "decisions
  and notes", which contradicted the Decision section's rename of the plan and the notes.

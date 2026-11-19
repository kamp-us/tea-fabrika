---
name: domain-modeling
description: Sharpen a bounded context's words while you design. Use when a talk or a change coins, renames or blurs a term, when you write or edit a context's GLOSSARY.md or `.glossary/TERMS.md`, and when a ruling gets settled.
---

# domain-modeling

This is the active habit: while you design, you test the words, and you write each settled one
down at once. Merely reading the map for vocabulary is not this skill, and any skill can do that.
This skill is for when you are changing the words, not only reading them.

## Where the words live

- **The map in [`.glossary/TERMS.md`](../../../.glossary/TERMS.md) says which contexts exist and
  where each one's words are written.**
- **A word keeps one meaning inside a context.** A word with two meanings in two contexts is noted
  in each, and the map names the boundary between them.
- **When a word could belong to more than one context,** work out which one the talk is in. If it
  is unclear, ask.
- **Write a context's words down when its first term is settled, never before.** Do not make an
  empty glossary file to start.
- **Search before you add a word:** `node .agents/skills/lead/scripts/records.ts find "<words>"`.
- **Decisions go through the [adr skill](../adr/SKILL.md) into `.decisions/`.** Never a `docs/adr/`.

Each word is one row, in the format of [the glossary format](references/glossary-format.md).

## During the session

### Challenge against the glossary

When the owner, or the talk, uses a term that conflicts with the existing language, call it out at
once: "The glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When someone uses a vague or overloaded term, propose one precise canonical term: "You're saying
'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When two concepts' relationship is discussed, test it with a specific scenario. Invent edge cases
that force the line between the concepts to be precise.

### Cross-reference with code

When someone says how something works, read the code and check whether it agrees. A contradiction is
surfaced at once, with the file: "Your code cancels entire Orders, but you just said partial
cancellation is possible. Which is right?"

### Write the words down inline

When a term is settled, write its row right there. Do not batch them up. The words are not a spec,
a scratch pad, or a repository for implementation decisions: they are the words, and nothing else.

## Record a settled ruling

Ask first whether it is only a setting ([0069](../../../.decisions/0069-choices-are-settings.md)),
then record it with the [adr skill](../adr/SKILL.md).

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).

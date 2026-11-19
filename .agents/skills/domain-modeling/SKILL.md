---
name: domain-modeling
description: Sharpen a bounded context's words while you design. Use when a talk or a change coins, renames or blurs a term, when you write or edit a context's GLOSSARY.md or `.glossary/TERMS.md`, and when a ruling gets settled.
---

# domain-modeling

This is the active habit: while you design, you test the words and write each settled one down at
once. Only reading a glossary for vocabulary is not this skill, and any skill can do that.

## Where the words live

- **The map in [`.glossary/TERMS.md`](../../../.glossary/TERMS.md) says which contexts exist and
  where each one's words are written.**
- **A word keeps one meaning inside a context.** A word with two meanings in two contexts is noted
  in each, and the map names the boundary between them.
- **Search before you add a word:** `node .agents/skills/lead/scripts/records.ts find "<words>"`.
- **Decisions go through the [adr skill](../adr/SKILL.md) into `.decisions/`.** Never a `docs/adr/`.

## A kalfa glossary

```md
# @kalfa/records

The checks on our records. One sentence on what the context is and why it exists.

## Language

**Finding**:
One place a check says is wrong, with what to do instead.
_Avoid_: error, violation, lint
```

- **Be opinionated.** Pick one word per concept and list the rest under `_Avoid_`.
- **Define what it is,** in one or two sentences, not what it does.
- **Only this context's words.** A timeout or an error type is not one. Ask: is this unique here?
- **No implementation detail.** A glossary is not a spec or a scratch pad. Group under headings only
  when clusters appear. Check the industry's word first
  ([names](../../../docs/direction/use-the-industrys-names.md)).

## While you design

- **Challenge a term against the glossary** the moment it clashes: "the glossary says X, you mean
  Y, which is it?"
- **Sharpen a fuzzy word** into one canonical word: "account" is the Customer or the User?
- **Test boundaries with a concrete scenario** that forces the line between two concepts.
- **Cross-check the code.** When someone says how it works, read the code. A contradiction is
  surfaced at once, with the file.
- **Write the glossary inline,** the turn the word is settled. Do not batch them up.

## Record a settled ruling

Ask first whether it is only a setting ([0069](../../../.decisions/0069-choices-are-settings.md)),
then record it with the [adr skill](../adr/SKILL.md).

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).

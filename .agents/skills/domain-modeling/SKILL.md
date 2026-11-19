---
name: domain-modeling
description: Sharpen a bounded context's words while you design. Use when a talk or a change coins, renames or blurs a term, when you write or edit a context's GLOSSARY.md or `.glossary/TERMS.md`, and before you offer a decision to record.
---

# domain-modeling

This is the active habit: while you design, you test the words and write each settled one down at
once. Only reading a glossary for vocabulary is not this skill, and any skill can do that.

## Where the words live

- **One kalfa package is one bounded context** ([we follow DDD](../../../docs/direction/we-follow-ddd.md),
  [0585](../../../.decisions/0585-kalfa-is-six-domain-packages.md)). Its words live in
  `kalfa/<package>/GLOSSARY.md`, made the turn its first term is settled, never before.
- **`next/`'s contexts stay in [`.glossary/TERMS.md`](../../../.glossary/TERMS.md)**, which keeps its
  rows and its context map. Its "Kalfa contexts" section is the map to every kalfa glossary: add a
  line there when you make one.
- **A word keeps one meaning inside a context.** A word that means two things in two contexts gets
  a row in each, and a line in the context map. Before you add a word, search both places.
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

## Offer a decision sparingly

Offer one only when all three hold: it is hard to reverse, it surprises a reader without context,
and it came from a real trade-off. A missing one means no decision. Then use the adr skill, and ask
first whether it is only a setting ([0069](../../../.decisions/0069-choices-are-settings.md)).

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).

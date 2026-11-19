---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a GLOSSARY.md, or recording or editing a decision.
---

# Domain Modeling

<!-- Matt Pocock's domain-modeling skill, kept as he wrote it (MIT, see ../UPSTREAM-mattpocock-skills-LICENSE). The only changes are this repo's paths: his GLOSSARY-MAP.md is `.glossary/TERMS.md` (0617), and his `docs/adr/` is `.decisions/`, written with the adr skill (0001). -->

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `GLOSSARY.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

This repo has multiple contexts. [`.glossary/TERMS.md`](../../../.glossary/TERMS.md) is the map: it points to where each context's `GLOSSARY.md` lives. Decisions live in [`.decisions/`](../../../.decisions/).

Create files lazily: only when you have something to write. If a context has no `GLOSSARY.md`, create it when its first term is resolved, at the path the map names.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `GLOSSARY.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update GLOSSARY.md inline

When a term is resolved, update `GLOSSARY.md` right there. Don't batch these up: capture them as they happen. Use the format in [the glossary format](references/glossary-format.md).

`GLOSSARY.md` should be totally devoid of implementation details. Do not treat `GLOSSARY.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer decisions sparingly

Only offer to create a decision when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the decision. Write it with the [adr skill](../adr/SKILL.md).

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).

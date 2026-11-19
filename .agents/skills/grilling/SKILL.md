---
name: grilling
description: Interview the owner, round by round, to stress-test a design or plan. Use on "grill me", "poke holes", "what am I missing", or when a plan has branches nobody has walked.
---

# grilling

Keep asking until you and the owner share one picture. Map the design as a **design tree**: every
decision branches into the decisions that hang off it. Visit every branch. Assume nothing silently.

This is for a session with the owner. A pipeline step does not grill: it follows
[AGENTS.md, "Finish your task"](../../../AGENTS.md#finish-your-task).

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already
settled: the questions you can ask now without guessing at answers you have not heard yet. Ask the
whole frontier in one round. Number each question, and give your recommended answer with it. Then
wait for the owner's answers before the next round.

Format a round like this:

```md
Q1 - **Question title**: the question, with its choices, possibly in several paragraphs.

Lean: your recommended answer, with why, what it costs, and how sure you are.
```

- **Word each question so "yes" accepts your lean.** Under about 80% sure, say what would settle it.
- **Each answer reshapes the tree.** Settled decisions push the frontier outward and unblock the
  questions that waited on them. Recompute the frontier and ask the next round. A question whose
  answer depends on another question still open in this round waits for a later round.
- **Finding facts is your job, never the owner's.** When a question needs a fact from the files, the
  tools or the decisions, look it up first: read the code, the decisions and the glossary. Search
  what is settled before you ask: `node .agents/skills/lead/scripts/records.ts find "<words>"`. A
  slow lookup can go to a sub-agent with a fresh context, but do not block the round on it: ask the
  questions that do not wait on it.
- **The decisions are the owner's.** Put each one to them, and wait.
- **Plain words.** Short sentences. A new term gets a few words of meaning.

The session is done when the frontier is empty: every branch of the design tree is visited, and
nothing is left silently assumed. Then say what you now understand, and act only after the owner
says yes.

Run [domain-modeling](../domain-modeling/SKILL.md) alongside: when a word clashes or a rule gets
settled, write it down then.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).

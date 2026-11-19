---
name: grilling
description: Interview the owner one question at a time to stress-test a design or plan. Use on "grill me", "poke holes", "what am I missing", or when a plan has branches nobody has walked.
---

# grilling

Keep asking until you and the owner share one picture. Walk the design as a tree: each decision
opens the decisions that hang off it. Visit every branch. Assume nothing silently.

This is for a session with the owner. A pipeline step does not grill: it follows
[AGENTS.md, "Finish your task"](../../../AGENTS.md#finish-your-task).

- **One question at a time.** Wait for the answer before the next. The answer decides which
  branch comes next.
- **Give your lean with each question,** with why, the cost and how sure you are. Word it so "yes"
  accepts it. Under about 80% sure, say what would settle it.
- **Look up facts yourself.** Read the code, the decisions and the glossary first. Ask only what
  a person decides. Search what is settled before you ask
  (`node .agents/skills/lead/scripts/records.ts find "<words>"`).
- **Plain words.** Short sentences. A new term gets a few words of meaning.
- **Done when every branch is visited.** Then say what you now understand. Act only after a yes.

Run [domain-modeling](../domain-modeling/SKILL.md) alongside: when a word clashes or a rule gets
settled, write it down then.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).

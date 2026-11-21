# Agents talk by tell and ask, and a subagent is a summoned child

The Agent Client Protocol has nothing for one agent reaching another, so that part is ours. An agent acts only through
tools, and every agent already takes prompts as messages to its process, so two agents talk through two lent tools:
`tell` sends a prompt and returns, and `ask` sends one and waits for the other agent's answer. A subagent is a summon
made by an agent: a child process (0065) linked to its parent, named under it (`<human>/<agent>/<subagent>`) and
acting for the same human. Whether an agent may summon is a permission in the app's model (0056), closed until the app
opens it, so today only a human summons and opening it later changes no protocol.

## Considered Options

- A harness's own built-in subagents: not enough. The protocol only shows them to us, and all we can do with one is
  cancel it. They are not agents of the project: they have no name, nobody can send to them, and their writes are
  their parent's.
- A separate channel between agents, apart from the process's input: rejected, because a second way in would need its
  own order, its own record and its own door check.
- Only `tell`, with the answer coming back as a later prompt: rejected, because a parent that hands work to a helper
  needs the answer inside the turn that asked for it.
- No link between a subagent and its parent: rejected for now, because an agent nobody is waiting on would keep
  spending on its human's bill after its parent is dismissed.

## Consequences

- Two agents that `ask` each other would wait forever, so `ask` has a time limit, and that limit is a setting.
- Dismissing an agent shuts its subagents down. A subagent in the middle of a task ends with it.
- A subagent's turn is traced as a child of the tool call that asked for it, so one line a human typed, the agent's
  turn and every agent it reached are one trace.
- A subagent's spend is its human's. How deep agents may summon is a setting.

# The box an agent runs in is its only fence

The box is the fence: what a program may read, write or reach is set by its box, and the box goes around the fabrika program, not around an agent harness. A Claude Code hook, the Agent SDK's Bash sandbox or a harness's own tool list works for that harness only, and every harness reaches ours through ACP; a harness fence may stay as a second layer, but nothing counts on it.

## Considered Options

- Trusting the harness's own permission request (ACP's `session/request_permission`): rejected, because it is not a wall. It lets our side see and answer a tool call, but the agent decides when to ask.

## Consequences

No harness needs box code of its own, and a new harness works in every box the day it works at all.

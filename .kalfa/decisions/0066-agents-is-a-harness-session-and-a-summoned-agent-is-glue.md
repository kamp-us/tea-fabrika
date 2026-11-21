# Agents is a harness session, and a summoned agent is glue

`@kalfa/agents` covers one thing: starting a coding harness and talking to it through the Agent Client Protocol, as a
session of prompts, turns and updates, in that protocol's own words. No package owns "the agent". A summoned agent is
three settled pieces joined in the entry point `@kalfa/agents/program`: Identity's join, a process Program starts
under the name `<human>/<agent>`, and a session that process opens. We chose this because a harness session is useful
to any repo as it is, while a summoned agent needs Program and Identity, which a core may not import (0048), and
because a second list of agents beside Program's registry would drift from it.

## Considered Options

- A package that owns summon, dismiss, names and mailboxes: rejected, because its core would import Program and
  Identity, and no other repo could use it alone.
- No package, with all of it in the app: rejected, because the logic above the wire (opening a session again and
  sending the cut-off prompt again, checking model and effort against what the harness offers, the typed answer, usage
  that can say "not reported", answering permission requests) would be written again by every app.
- A package for an agent that dials in on its own as well: rejected. Such an agent is one more client (0029), with a
  key of kind `agent`, and needs no session from us.

## Consequences

- There is no summon call. A summon is a join and a `startChild`; a dismiss is an exit signal and a leave. The two
  writes are not one transaction, so each is safe to repeat.
- A harness that crashes does not free the agent's name: the agent is down and can be opened again. Only a dismiss
  ends it.
- A turn is a deferred tool of the agent's program: the step hands the prompt off and ends, and the turn's end comes
  back as a message. Updates go to the session's own ledger stream and are never steps of the process.
- The harness reaches the program only through opened inputs: inputs the program names when the session opens, lent
  as tools. Showing a program's inputs as tools is Program's (`@kalfa/program/mcp`), not this package's.
- The core holds no cap on spend, tool calls or time, and a session must say how permission requests are answered,
  with no default.
- The protocol is still changing. The interface ends a turn with one item whatever the wire does, so a move to the
  protocol's next version stays inside the package.

# Agents

Starting a coding harness and talking to it: a session, the prompts sent to it, what it does in each turn and how the
turn ends. The words are the Agent Client Protocol's own, except that the program we start is a harness. Who an agent
is and whom it acts for is Identity's; how its process runs is Program's.

## Language

**Harness**:
The maker's own coding program that we start and talk to, such as Claude Code or Codex. It runs its own loop, unchanged.
_Avoid_: agent (Identity's word for who acts), provider, adapter, backend, client

**Session**:
One conversation with one harness in one folder. It keeps its history between turns, can be opened again after a
restart, and never moves to another harness.
_Avoid_: run, thread, conversation, chat

**Prompt**:
The text sent to a session to start a turn.
_Avoid_: message (Program's), brief, ask, instruction

**Turn**:
What a harness does with one prompt, from the prompt to its one end. One turn runs in a session at a time, and a
prompt sent meanwhile waits its turn in order.
_Avoid_: run, step (Program's), request, job

**Turn id**:
The id the sender gives a turn. The same id is the same turn, so a prompt sent again joins the turn or gets its end,
and never starts a second one.
_Avoid_: key, request id, idempotency key

**Update**:
One thing a harness said or did during a turn, as it happened: a piece of its message, a tool call, a plan.
_Avoid_: event, chunk, message, notification

**Stop reason**:
Why a turn ended: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` or `cancelled`.
_Avoid_: exit reason (Program's), status, finish reason, outcome

**Answer**:
The value a turn was asked to end with, read by a schema the sender gave. It is nothing when what the harness gave does
not fit the schema.
_Avoid_: result, output (Program's), response, form

**Usage**:
The tokens a turn used and what the session has cost so far, as the harness reports them. Not reported is never the
same as zero.
_Avoid_: cost, spend, billing, metrics

**Cancel**:
Ending the turn that runs now. The session stays, and the turn ends with the stop reason `cancelled`.
_Avoid_: stop, abort, kill, interrupt

**Permission request**:
A harness asking, in the middle of a turn, whether it may make one tool call. Every session says how these are
answered: allow, reject, or ask the sender. It is a courtesy and never a wall, because the box is the only fence.
_Avoid_: ask, approval, permission (Permissions'), confirmation

**Config option**:
A setting a harness offers on a session, with the values it takes. Model and effort are two.
_Avoid_: mode, setting (Configuration's), flag, parameter

**Model**:
The model a session runs on, by the harness's own value. Both the word that was typed and the value it resolved to are
kept.
_Avoid_: engine, version

**Effort**:
How hard the model is asked to think, by the harness's own value.
_Avoid_: thinking level, reasoning effort, thought level

**Lent tool**:
A tool a session's harness may call, given to the session when it opens. A tool (Program) is outside work a program's
step uses; a lent tool is one the harness uses.
_Avoid_: capability, plugin, a bare "tool"

### A summoned agent

**Summon**:
Starting an agent for a human under a name: the agent joins the project (Identity) and its process starts (Program),
in one line. Only a human summons, unless a permission opens it to agents.
_Avoid_: spawn, launch, create, start

**Dismiss**:
Ending a summoned agent: its process is shut down and it leaves the project (Identity). Its name is free again.
_Avoid_: kill, stop, remove, delete

**Agent state**:
What a summoned agent is doing: `opening`, `idle`, `turn`, `asking` (a permission request waits for an answer) or
`down`.
_Avoid_: status, phase, mode

**Down**:
A summoned agent whose harness would not open, or ended. It keeps its name and its session and can be opened again;
only a dismiss ends it.
_Avoid_: dead, crashed, offline, stopped

**Opened input**:
An input (Program) of a program that a session's harness may send as a lent tool, named by the program when the
session opens. An input only a human may send is never opened.
_Avoid_: exposed input, tool input, door

**Tell**:
One agent sending a prompt to another and not waiting for what comes back.
_Avoid_: cast, notify, post

**Ask**:
One agent sending a prompt to another and waiting for that agent's answer, up to a time limit.
_Avoid_: call, request, delegate

**Subagent**:
An agent another agent summoned: its child (Program), linked to it, named under it and acting for the same human. A
harness's own built-in helpers are not these.
_Avoid_: helper, worker, child session

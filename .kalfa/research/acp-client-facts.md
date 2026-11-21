---
summary: What the Agent Client Protocol (ACP) gives a client today, read from the spec site, the schema files and the two adapters people use for Claude Code and Codex; methods and notifications in both directions, ACP's own words, stop reasons, transport (stdio only, remote is a draft), models and effort, sessions, cancel, permissions, MCP servers, usage, auth, subagents; each fact marked stable, unstable, v2 preview or adapter-only, each cited
---

# What ACP gives a client today

Question (from a design talk about a small Effect library that starts a coding-agent harness and talks to it over ACP):
what can a client count on, and what is only a draft or only one adapter's habit? Ten sub-questions, answered one by
one below.

Read on 2026-11-21, from the pages, files and code linked on each line. A line marked "my reading" is mine, not a
source's claim. Only primary sources: the spec site (https://agentclientprotocol.com), the spec repo, and the two
adapters' source and READMEs. Code and docs were read at the commits named in the Sources list. All names below are
about ACP unless a line says "adapter".

## How each fact is marked

ACP ships three layers at once, and the adapters add a fourth. Every fact below carries one of these tags.

- **[stable]**: in the stable v1 schema (`schema/v1/schema.json`), the one an ordinary client should build on.
- **[unstable]**: only in `schema/v1/schema.unstable.json`, or an RFD (ACP's word for a design proposal; it stands for
  "Request for Dialog") still in Draft or Preview. The schema itself says such a field "may be removed or changed at
  any point".
- **[v2 preview]**: in the v2 schema (`schema/v2/schema.json`). v2 moved from Draft to Preview on 2026-11-20. The
  maintainers call it "ready to build on", and "not frozen".
- **[adapter-only]**: the Claude or Codex adapter's own behavior, `_meta` key or `_`-prefixed method. ACP does not
  define it.

## The short answer

1. **Methods and words.** Stable v1 has 12 client-to-agent requests, 9 agent-to-client requests, 2 client-to-agent
   notifications and 3 agent-to-client ones (section 1). ACP says "prompt turn", "session update", "stop reason", "config option", "mode". Stop reasons
   are `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`. v2 adds `error` and moves the stop
   reason from the prompt response to a state update.
2. **Transport.** The spec defines only stdio: the client starts the agent as a subprocess. A remote transport (HTTP
   plus SSE, and WebSocket) is a Draft RFD with a reference implementation in progress. A browser tab could speak
   the draft wire format, but no adapter listens on a socket, so a tab needs a bridge process today.
3. **Models.** Stable: the agent lists models as a `config option` with category `model`, and the client sets one with
   `session/set_config_option`. The older `session/set_model` was never stable and was removed in June 2026. Effort is
   the category `thought_level`. Both adapters use this: ids `model` and `effort` (Claude), `model` and
   `reasoning_effort` (Codex).
4. **Keeping sessions.** Stable: `session/load` (replays history), `session/resume` (no replay), `session/list`,
   `session/close`, `session/delete`. `session/fork` is unstable. Both adapters support all of these. Their sessions
   live in Claude Code's and Codex's own on-disk stores.
5. **Cancel.** The client sends the notification `session/cancel`. The agent must answer the pending
   `session/prompt` with stop reason `cancelled`, not an error. The session stays usable. In v2 the answer moves to an
   idle `state_update`.
6. **Permissions.** The agent sends `session/request_permission` with a tool call and a list of options (`allow_once`,
   `allow_always`, `reject_once`, `reject_always`). The client answers `selected` or `cancelled`. The spec has no
   timeout. If the client never answers, the turn waits. I found no timer in either adapter.
7. **Client tools.** A client can pass MCP servers at `session/new`: stdio always, HTTP and SSE if the agent says so.
   `fs/*` and `terminal/*` are optional client capabilities in v1 and are removed in v2. Neither adapter calls them.
8. **Usage and cost.** Stable: a `usage_update` session update with `used`, `size` and an optional `cost`. Claude sends
   a USD cost. Codex sends no cost. A per-turn token breakdown is unstable.
9. **Auth.** `authenticate` picks one of the `authMethods` the agent listed. A `terminal` method makes the client run
   the agent's own login in a terminal. Both adapters reuse a login the underlying CLI already has (Claude: my reading
   of the code; Codex: it asks Codex for the account). Claude's adapter offers no in-protocol subscription login, only
   a terminal one.
10. **Agents and agents.** Stable: an agent can show its own subagents to the client as child sessions. The client may
    only cancel a child. A client cannot start a second agent through ACP. ACP's docs say an agent can itself act as a
    client to run other agents, with no method for it. Proxy chains and MCP-over-ACP are drafts.

My confidence that these answers describe the protocol as of the read date: about 90%. The doubt is that the spec
moved several times a week in November 2026 (section 11).

## 0. Which ACP are we talking about

The spec repo holds two protocol versions side by side. The stable v1 schema is the default. v2 is a Preview and
changes how a turn ends (section 5). Both adapters serve both: a client that asks for protocol version 2 in `initialize`
gets v2, everyone else gets v1 ([Claude README, "ACP v2"](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/README.md),
[announcement](https://agentclientprotocol.com/announcements/acp-v2-preview)). The Claude adapter has an environment
variable, `CLAUDE_AGENT_ACP_PROTOCOL` (`auto`, `v1`, `v2`), to pin a version
([`serve.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/serve.ts)).

A client builds on v1 now, and keeps the v2 shape in mind. v2 breaks several v1 habits, and the notes below say which.

## 1. Methods, notifications and ACP's own words

### Stable v1: every method and notification

Source: the method table in
[`schema/v1/meta.json`](https://github.com/agentclientprotocol/agent-client-protocol/blob/56331565417adce881793622a4ad1e326a78be5d/schema/v1/meta.json),
checked against the schema's `AgentNotification`, `ClientNotification` and `CancelRequestNotification` entries in
[`schema/v1/schema.json`](https://github.com/agentclientprotocol/agent-client-protocol/blob/56331565417adce881793622a4ad1e326a78be5d/schema/v1/schema.json),
and the [overview page](https://agentclientprotocol.com/protocol/v1/overview).

| Direction | Requests (get a response) | Notifications (no response) |
|---|---|---|
| Client to agent | `initialize`, `authenticate`, `logout`, `session/new`, `session/load`, `session/resume`, `session/list`, `session/delete`, `session/close`, `session/prompt`, `session/set_mode`, `session/set_config_option` | `session/cancel`, `$/cancel_request` |
| Agent to client | `session/request_permission`, `elicitation/create`, `fs/read_text_file`, `fs/write_text_file`, `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release` | `session/update`, `elicitation/complete`, `$/cancel_request` |

Notes:

- The baseline every agent must serve is `initialize`, `authenticate`, `session/new`, `session/prompt`, `session/cancel`
  and `session/update`. `session/load`, `session/resume`, `session/list`, `session/close`, `session/delete`, `logout`
  and `session/set_mode` are optional and gated by capabilities
  ([overview](https://agentclientprotocol.com/protocol/v1/overview),
  [initialization](https://agentclientprotocol.com/protocol/v1/initialization#session-capabilities)).
- Any method name that starts with `_` is a free extension point, and `_meta` fields carry extra data on any message
  ([extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)).
- The wire format is JSON-RPC 2.0. Property names are `camelCase`, and values of "kind" fields are `snake_case`
  ([overview, conventions](https://agentclientprotocol.com/protocol/v1/overview#conventions)).

### Stable v1: the `session/update` variants

`session/update` carries one of these in `update.sessionUpdate`
([prompt turn page](https://agentclientprotocol.com/protocol/v1/prompt-turn#session-updates)): `user_message_chunk`,
`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `plan_update`, `plan_removed`,
`available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`,
`notice`, `compaction_update`, `compaction_summary_chunk`, `subagent_update`, `session_message`,
`session_message_chunk`. Some of them need a client capability first: `plan_update` and `plan_removed` need `plan`,
`notice` needs `session.notices`, the two compaction updates need `session.compaction`, and the three subagent updates
need `subagents`. The agent "MUST NOT" send them otherwise
([initialization, client capabilities](https://agentclientprotocol.com/protocol/v1/initialization#client-capabilities)).
Content blocks are `text`, `image`, `audio`, `resource_link`, `resource`. Tool call content is `content`, `diff`,
`terminal`, `session` (checked in `schema.json`).

### Unstable v1: extra methods

Only in
[`schema/v1/meta.unstable.json`](https://github.com/agentclientprotocol/agent-client-protocol/blob/56331565417adce881793622a4ad1e326a78be5d/schema/v1/meta.unstable.json):

- client to agent: `session/fork`, `session/archive`, `session/unarchive`, `session/status`, `session/options`,
  `session/set_title`, `providers/list`, `providers/set`, `providers/disable`, `auth/status`, `mcp/message`;
- agent to client: `auth/status_update` (notification), `mcp/message`;
- between proxies: `proxy/initialize`, `proxy/successor`;
- session updates: `prompt_suggestions_update`, `cursor_update`.

Each one has a Draft or Preview RFD under https://agentclientprotocol.com/rfds/about.

### v2 preview: what changes

Source: the [migration guide](https://agentclientprotocol.com/protocol/v2/migration) and
[`schema/v2/meta.json`](https://github.com/agentclientprotocol/agent-client-protocol/blob/56331565417adce881793622a4ad1e326a78be5d/schema/v2/meta.json).

- Renamed: `authenticate` becomes `auth/login`, `logout` becomes `auth/logout`.
- Removed: `session/load` (use `session/resume` with `replayFrom`), `session/set_mode` (a mode is a config option),
  every `fs/*` and `terminal/*` method.
- New: `tool_call/cancel` and `terminal/cancel` (stop one item), and the session updates `state_update`,
  `user_message`, `agent_message`, `agent_thought`, `tool_call_content_chunk`, `terminal_update`,
  `terminal_output_chunk`, `replay_complete`. `tool_call` and `current_mode_update` are gone.
- Required, no capability flag: `session/list`, `session/resume`, `session/close`. `session/set_config_option` is required
  whenever the agent offers config options.

### ACP's own words

All from the [overview](https://agentclientprotocol.com/protocol/v1/overview), the
[prompt turn page](https://agentclientprotocol.com/protocol/v1/prompt-turn) and the
[session setup page](https://agentclientprotocol.com/protocol/v1/session-setup).

| Word | What ACP means |
|---|---|
| Client / Agent | The client is the UI side (editor, other UI, or "another agent"). The agent is the program that "uses generative AI to autonomously modify code" and "typically runs as a subprocess of the Client". |
| Session | One conversation with its own context, history and state. One agent runs many. Named by a `sessionId`. |
| Prompt turn | One cycle that starts with a user message (`session/prompt`) and ends when the agent answers with a stop reason. It can hold many model calls and tool calls. |
| Prompt | The user message: a list of content blocks. |
| Session update | A `session/update` notification: streamed output, tool activity, or a change of session state. |
| Stop reason | Why the agent ended the turn. |
| Tool call | One tool use, with a `toolCallId`, a `kind` and a status: `pending`, `in_progress`, `completed`, `failed`. |
| Tool kind | `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other`. |
| Mode | An older, single-purpose setting (for example "ask" or "code"). Marked as going away in favor of config options. |
| Config option | A setting the agent lists and the client may change (model, mode, effort and more). Has an `id`, a `category`, a type (`select`, or `boolean` if the client opted in) and a `currentValue`. |
| Capability | A flag in `initialize` that says an optional feature exists. An omitted capability means "not supported". |
| Elicitation | The agent asks the user for structured input, as a form or a URL. |
| Notice | A live message to the user that is not part of the conversation. |
| Compaction | The agent shrinks its context and tells the client. |
| Child session / subagent | A session an agent creates and owns for work it delegates. |

### Stop reasons

**[stable]** Exactly five: `end_turn` (the model finished without asking for more tools), `max_tokens`,
`max_turn_requests` (too many model requests in one turn), `refusal`, `cancelled`
([prompt turn, stop reasons](https://agentclientprotocol.com/protocol/v1/prompt-turn#stop-reasons), and the
`StopReason` entry in `schema.json`). The agent "MUST" give one.

**[v2 preview]** The same five, plus `error`. They now arrive on an idle `state_update`, not on the prompt response.
Custom stop reasons must start with `_`. A client "MUST" treat `idle` as the end of work even when the stop reason is
missing or unknown
([prompt lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle), migration guide, "Session states").

## 2. How a client starts an agent

- **[stable]** One transport is defined: stdio. The client launches the agent as a subprocess, writes JSON-RPC to its
  stdin, reads from its stdout, one message per line with no embedded newline. The agent may log to stderr. Agents and
  clients "SHOULD" support stdio. "Custom transports" are allowed if they keep the JSON-RPC format and lifecycle
  ([transports page](https://agentclientprotocol.com/protocol/v1/transports)). v2 says the same
  ([v2 transports](https://agentclientprotocol.com/protocol/v2/transports)).
- **[unstable]** A remote transport is a Draft RFD: one `/acp` endpoint, long-lived SSE `GET` streams for agent-to-client
  messages (one per connection, one per session), `POST` for client-to-agent messages (answered `202 Accepted`, except
  `initialize`), and a WebSocket upgrade on the same endpoint. HTTP/2 is required for the HTTP form. A client that
  supports remote ACP "MUST" support both forms. Cookies must be kept. Headers are `Acp-Connection-Id` and
  `Acp-Session-Id`
  ([RFD](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport)). The RFD lists a reference
  implementation in progress in another project, SDK support as phase 3, and "Origin validation" and "SSE
  resumability" as phase 4 (not done). In v1, a dropped connection loses in-flight messages: "no message sequencing or
  stream resumption". A client can reconnect and `session/load`. Both versions' transports pages still say remote is
  "being specified", and the v2 preview announcement says remote transports "aren't" in the Preview.
- **Browser tab as a client.** No spec page mentions browsers. My reading: a tab could carry the draft wire format
  (WebSocket, or `fetch` plus SSE), because it is plain JSON-RPC, but the draft's HTTP/2 and header rules are not tested
  against a browser in any source I read. Today it cannot talk to either adapter directly: **[adapter-only]** neither
  adapter opens a socket (I searched both `src/` trees for a server, a listener and WebSocket use and found none). Both
  serve stdio. Claude's entry point reads `process.stdin` and writes `process.stdout`
  ([`serve.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/serve.ts)).
  The spec's own client list names several web UIs, but they run a server process that launches the agent, which I did
  not read ([clients page](https://agentclientprotocol.com/get-started/clients)).
- **How a client finds the launch command.** **[adapter-only]** Claude: package `@agentclientprotocol/claude-agent-acp`,
  command `claude-agent-acp`. Codex: `npx -y @agentclientprotocol/codex-acp`. Both are Node programs. Codex's adapter
  starts the Codex App Server as its own child and translates ACP into it
  ([Claude README](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/README.md),
  [Codex README](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/README.md)).
  Claude ships standalone binaries that bundle the Claude CLI.
- **Where the adapters live.** The Claude adapter is `agentclientprotocol/claude-agent-acp`. The old name
  `claude-code-acp` under `zed-industries` redirects there (checked with the GitHub API). The Zed Codex adapter,
  `zed-industries/codex-acp`, is archived (last push 2026-07-22) and its README says development moved to
  `agentclientprotocol/codex-acp`, which is a new TypeScript adapter on the Codex App Server
  ([archived README](https://github.com/zed-industries/codex-acp#readme)).

## 3. Models and effort

### What the protocol gives

- **[stable]** Config options. The agent may return `configOptions` from `session/new`, `session/load` and
  `session/resume`. Each has an `id`, a `name`, an optional `category`, `type: "select"` with `options` and a
  `currentValue`. The client changes one with `session/set_config_option` (`sessionId`, `configId`, `value`), at any
  time, "whether the Agent is idle or generating a response". The answer is the complete list again, because one change
  can alter another (a model change can change the effort choices). The agent can also change options itself with a
  `config_option_update` update (for example a fallback model after a rate limit)
  ([session config options](https://agentclientprotocol.com/protocol/v1/session-config-options)).
- **[stable]** The categories are `mode`, `model`, `model_config` (context size, speed or quality trade-offs) and
  `thought_level` ("Thought/reasoning level selector"). Categories are only a UX hint and "MUST NOT" be needed for
  correctness. The values inside an option are opaque ids the agent picks. ACP defines no list of model names or effort
  levels (same page; the `SessionConfigOptionCategory` entry in `schema.json`).
- **[stable]** Boolean options exist, but only if the client advertises `session.configOptions.boolean: {}`
  ([initialization](https://agentclientprotocol.com/protocol/v1/initialization#boolean-config-options)).
- **Removed.** `session/set_model` and the `models` field of session responses were an unstable API that "never
  stabilized". They were removed from the protocol on 2026-06-01, and agents "should continue to expose model selection
  through Session Config Options" ([RFD updates](https://agentclientprotocol.com/rfds/updates)). Searching the current
  schema and docs finds `set_model` only in that note.
- **[unstable]** `session/options` (Draft RFD): read the options a session would start with, before any session exists,
  and send initial values on `session/new`, `session/load` or `session/resume`
  ([RFD](https://agentclientprotocol.com/rfds/session-options)). A `speed` category for fast mode is also unstable
  (Preview RFD).
- **[v2 preview]** `session/set_mode` is gone. The option id field is renamed `configId`. The set call needs a `type`
  (`"id"` or `"boolean"`). Agents "SHOULD" list a `thought_level` select from lowest to highest
  ([migration guide, "Session modes become config options"](https://agentclientprotocol.com/protocol/v2/migration)).

### What the adapters expose

- **Claude adapter [adapter-only]**: options with ids `mode` (category `mode`; values are Claude Code's permission
  modes), `model` (category `model`), `effort` (category `thought_level`), plus `fast mode` (category `speed`) and
  `ultracode` (category `model_config`). The model list comes from the model list the Claude Agent SDK reports. The
  effort option appears only for a model that supports effort, and its levels are that model's levels, "in Claude
  Code's order, which lists the levels from lowest to highest" (checked at
  [`session-model.ts` line 327](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/session-model.ts#L327),
  [`session-effort.ts` lines 100-151](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/session-effort.ts#L100-L151),
  [`session-mode.ts` line 201](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/session-mode.ts#L201)).
  An environment variable `CLAUDE_MODEL_CONFIG` can rename models for another provider or limit the choices
  ([`docs/model-configuration.md`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/docs/model-configuration.md)).
  Starting options can also be forwarded to Claude Code through `_meta.claudeCode.options` on `session/new`
  ([`new-session-meta.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/new-session-meta.ts)).
  It advertises `session/options` support.
- **Codex adapter [adapter-only]**: options `model` (category `model`), `reasoning_effort` (category `thought_level`;
  levels come from each model's supported list), `mode` (approval and sandbox modes, and Codex permission profiles) and
  fast mode
  ([`ModelConfigOption.ts` lines 58-100](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/ModelConfigOption.ts#L58-L100),
  [`AgentMode.ts` line 154](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/AgentMode.ts#L154)).
  For older clients it still returns a `models` field and still answers `session/set_model` as an extension method
  ([`AcpExtensions.ts` line 42](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/AcpExtensions.ts#L42),
  [`CodexAcpServer.ts` line 1039](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAcpServer.ts#L1039)).
  The Claude adapter has no such legacy path (searched `src/`).

So the portable way to pick a model or effort is: read `configOptions`, find the option by `category` (not by id),
send `session/set_config_option` with one of its listed values, and read the new full list from the answer.

## 4. Sessions between turns and across a restart

- **[stable] `session/load`** (flag `loadSession`): the client sends `sessionId`, `cwd` and `mcpServers`. The agent
  replays the whole conversation as `session/update` notifications, then answers. The spec says this gives
  "persistence across restarts and sharing sessions between different Client instances". The client "can then continue
  sending prompts as if the session was never interrupted". Notices are not replayed
  ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup#loading-sessions)).
- **[stable] `session/resume`** (flag `sessionCapabilities.resume`): same params, but "MUST NOT" replay. It restores the
  context and returns.
- **[stable] `session/list`** (flag `sessionCapabilities.list`): optional `cwd` filter and an opaque `cursor`. Each
  entry has `sessionId`, `cwd`, optional `title` and `updatedAt`. The agent can push title changes with
  `session_info_update` ([session list](https://agentclientprotocol.com/protocol/v1/session-list)).
- **[stable] `session/close`** (flag `close`): cancels ongoing work and frees the live session. It is idempotent, and a
  `-32002` answer counts as closed. **`session/delete`** (flag `delete`) removes a session from future lists
  ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup#closing-active-sessions),
  [session delete](https://agentclientprotocol.com/protocol/v1/session-delete)).
- The client must send `cwd`, `mcpServers` and any `additionalDirectories` again on every load or resume. The agent does
  not restore them. The spec does not say where the agent keeps a session. That is the agent's business.
- **[unstable] `session/fork`** (Draft RFD): start a new session from an existing one, so the history stays clean.
  Also `session/status` (open, saved, or unknown) and cursors that name a position to fork at
  ([fork RFD](https://agentclientprotocol.com/rfds/session-fork),
  [status RFD](https://agentclientprotocol.com/rfds/session-status),
  [cursors RFD](https://agentclientprotocol.com/rfds/session-cursors)).
- **[v2 preview]** `session/load` is removed. `session/resume` takes an optional `replayFrom: { "type": "start" }`, and
  the agent sends a `replay_complete` update before the response, so the client can tell a cut-off replay. A prompt can
  carry an `idempotencyKey`, so a retry after a lost response does not insert a second message
  ([migration guide, "Session setup and lifecycle"](https://agentclientprotocol.com/protocol/v2/migration)).

**Adapters [adapter-only]:**

- Claude: `loadSession: true`, and session capabilities `resume`, `list`, `close`, `delete`, `fork`, `title`, `status`,
  `options`, `additionalDirectories`, `systemPrompt`
  ([`acp-agent.ts` lines 1846-1897](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/v1/acp-agent.ts#L1846-L1897)).
  Its sessions are Claude Code's own saved transcripts: listing and loading call the Claude Agent SDK's session
  functions over the Claude config directory
  ([`acp-agent.ts` line 2161](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/v1/acp-agent.ts#L2161),
  [`resumed-session.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/resumed-session.ts)).
- Codex: `loadSession: true`, and `resume`, `list`, `close`, `delete`, `fork`, `title`, `additionalDirectories`,
  `systemPrompt`
  ([`CodexAcpServer.ts` lines 860-890](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAcpServer.ts#L860-L890)).
  Its sessions are Codex threads (`thread/resume`, `thread/list`, `thread/fork`). Codex writes a thread to disk on the
  first user message, so a session that was created and never prompted has nothing to resume
  ([`CodexAcpClient.ts` lines 652-668](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAcpClient.ts#L652-L668)).
  The adapter has a fallback for that case while the same process is still alive.

## 5. Cancel

- **[stable]** The client sends the notification `session/cancel` with the `sessionId`. It "SHOULD" mark unfinished tool
  calls cancelled at once, and "MUST" answer every pending `session/request_permission` with outcome `cancelled`. The
  agent "SHOULD" stop model calls and tool calls, "MAY" still send final updates, and then "MUST" answer the original
  `session/prompt` with stop reason `cancelled`. It must not turn a library's abort exception into an error answer:
  cancel "aren't considered errors". The client "SHOULD" keep accepting tool call updates after sending cancel
  ([prompt turn, cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation)). The session
  stays open and takes the next `session/prompt`.
- **[stable]** `$/cancel_request` (any side, any request) is a separate, optional notification. The receiver must answer
  the request either with a normal response (for example `cancelled`) or with error `-32800` "Request cancelled"
  ([request cancellation](https://agentclientprotocol.com/protocol/v1/cancellation)).
- **[v2 preview]** `session/prompt` already returned (it only means "message inserted"). On `session/cancel` the agent
  sends pending updates, then an idle `state_update` with `stopReason: "cancelled"`. The client no longer answers every
  pending permission request. The agent cancels them one by one with `$/cancel_request`. `session/close` cancels the
  same way and also stops background work. A prompt not yet inserted gets `-32800`
  ([migration guide, "Cancellation"](https://agentclientprotocol.com/protocol/v2/migration)).
- **Adapters [adapter-only]:** Claude interrupts its SDK query, and arms a backstop timer of 30 seconds: if the query
  does not yield, it forces the answer `cancelled` so the prompt never hangs
  ([`acp-agent.ts` lines 7352 and 7698](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/v1/acp-agent.ts#L7698),
  constant at line 495). Codex calls `turnInterrupt` on the Codex turn and answers with its `cancelled` prompt response
  ([`CodexAcpServer.ts` line 5931](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAcpServer.ts#L5931)).

## 6. Permission requests

- **[stable] Shape.** Agent to client, a request. Params: `sessionId`, `toolCall` (a tool-call update, at least the
  `toolCallId`) and `options`. Each option has an `optionId`, a human `name` and a `kind`: `allow_once`,
  `allow_always`, `reject_once`, `reject_always`. `kind` is only a UI hint. The answer is
  `{ outcome: { outcome: "selected", optionId } }` or `{ outcome: { outcome: "cancelled" } }`. Clients "MAY"
  auto-answer by the user's settings. The agent owns "remembered" choices: after `allow_always` it stores the decision
  and its scope, and does not ask again. An unknown outcome must not count as approval
  ([tool calls, requesting permission](https://agentclientprotocol.com/protocol/v1/tool-calls#requesting-permission)).
- **If the client never answers.** The spec sets no timeout and says nothing about this case. The `session/prompt`
  request just stays pending. The only defined ways out are `session/cancel` (the client answers `cancelled`) and
  `$/cancel_request`. I searched the whole v1 docs for "timeout" and found none about permissions. **[adapter-only]**
  Claude forwards the request with an abort signal that fires on cancel or session close, and no timer
  ([`acp-agent.ts` lines 8777-8814](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/v1/acp-agent.ts#L8777-L8814)).
  Codex sends the request through the same kind of cancellable call
  ([`ACPSessionConnection.ts` lines 261-275](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/ACPSessionConnection.ts#L261-L275)).
  I found no permission timer in either, but I did not trace every path.
- **[v2 preview] Shape change.** Params get a required `title`, an optional `description`, and an optional `subject`
  (`tool_call`, or `command` with `command` and an absolute `cwd`). `options` needs at least one entry. `cancelled`
  now also means the user dismissed the prompt, and does not by itself end the work. The agent should report
  `requires_action` while it waits
  ([migration guide, "Permission requests"](https://agentclientprotocol.com/protocol/v2/migration)).
- **Adapters [adapter-only].** Claude builds options per tool (Bash, Edit, Read, plan exit and so on) and leads with the
  decline options when Claude Code hints "default to no"
  ([`permissions/options.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/permissions/options.ts)).
  When the client answers `cancelled` for a background subagent's request, Claude answers its model with a "user
  refused", so the subagent can go on. Codex builds its requests from Codex approvals and permission profiles
  ([`docs/permission-profiles.md`](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/docs/permission-profiles.md)).
  The mode option (Claude's `bypassPermissions`, Codex's full access) decides how often requests happen at all.

## 7. Tools the client offers the agent

- **[stable] MCP servers at `session/new`.** `mcpServers` is a list in `session/new`, `session/load` and
  `session/resume`. Three shapes: stdio (`name`, `command`, `args`, `env`; every agent "MUST" support it), `http`
  (`url`, `headers`; needs `mcpCapabilities.http`) and `sse` (needs `mcpCapabilities.sse`; "deprecated by the MCP
  spec"). New agents "SHOULD" support HTTP. The spec says clients "MAY use this ability to provide tools directly to
  the underlying language model by including their own MCP server". `env` and `headers` values are credentials and
  agents "SHOULD NOT" log them ([session setup, MCP servers](https://agentclientprotocol.com/protocol/v1/session-setup#mcp-servers)).
- **[unstable] MCP over ACP.** A server with `"type": "acp"` is served by the client over the same ACP connection, with
  `mcp/message` requests, so the client needs no extra process or port. Draft RFD, targets MCP 2026-07-28 only
  ([RFD](https://agentclientprotocol.com/rfds/mcp-over-acp)). **[adapter-only]** Both adapters accept it: Claude
  advertises `mcpCapabilities.acp: true`, Codex advertises it when its host supports it.
- **[v2 preview]** `mcpServers` is optional. Every entry has a `type`. `sse` is removed. `stdio` becomes an explicit
  capability. A stdio `command` must be an absolute path. Names must be unique
  ([migration guide, "MCP server configuration"](https://agentclientprotocol.com/protocol/v2/migration)).
- **`fs/*` and `terminal/*`: optional.** **[stable]** Both are gated by client capabilities: `fs.readTextFile`,
  `fs.writeTextFile`, and `terminal`. If the flag is false or missing, the agent "MUST NOT" call them. Nothing in v1
  requires a client to offer them ([file system](https://agentclientprotocol.com/protocol/v1/file-system),
  [terminals](https://agentclientprotocol.com/protocol/v1/terminals)). **[v2 preview]** They are removed. The stated
  reason: "inconsistently implemented outside of a few IDEs". The suggested replacement is a client-provided MCP server
  (migration guide, "Client file system and terminal execution removed").
- **Adapters [adapter-only]:** neither uses them. The Claude adapter's changelog says it switched to Claude's built-in
  tools: "it won't use client capabilities for files or terminals"
  ([`CHANGELOG.md` line 1525](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/CHANGELOG.md?plain=1#L1525)).
  In both source trees the only code that touches `readTextFile` is a pass-through, and I found no call that sends
  `terminal/create` (searched `src/`, tests excluded). Codex adds: no SSE MCP servers (it rejects them with invalid
  params,
  [`McpServerConfig.ts` line 87](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/McpServerConfig.ts#L87)).
  Claude advertises `http`, `sse` and `acp` ([`acp-agent.ts` lines 1880-1884](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/v1/acp-agent.ts#L1880-L1884)).
- **Also stable, related:** `systemPrompt` on session setup (capability `sessionCapabilities.systemPrompt`; mode `append`,
  and `override` if advertised), and `additionalDirectories`. Both adapters advertise both
  ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup#system-prompt)).

## 8. Usage and cost

- **[stable] `usage_update`.** A session update with `used` (tokens now in context), `size` (context window size) and
  an optional `cost` (`amount` plus `currency`, an ISO 4217 code or another unit such as "credits"). The cost is
  cumulative for the session and includes child sessions
  ([prompt turn, usage updates](https://agentclientprotocol.com/protocol/v1/prompt-turn#session-usage-updates)).
  That is context fullness, not a count of tokens spent per turn.
- **[unstable] Per-turn tokens.** A `Usage` object (`totalTokens`, `inputTokens`, `outputTokens`, optional
  `thoughtTokens`, `cachedReadTokens`, `cachedWriteTokens`) on the prompt response. Draft RFD "kept in Draft while token
  accounting semantics are still being refined". Whether the numbers are per turn or cumulative is an open question in
  the RFD. In unstable v2 it moves to the idle `state_update`
  ([RFD](https://agentclientprotocol.com/rfds/end-turn-token-usage), the `Usage` entry in `schema.unstable.json`).
- **Adapters [adapter-only].** Claude sends `usage_update` with a USD `cost` taken from the Claude SDK's total cost
  ([`acp-agent.ts` lines 5874-5890](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/v1/acp-agent.ts#L5874-L5890)),
  and fills the unstable prompt-response `usage` plus `_meta.quota` (per-model token counts)
  ([`session-usage.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/session-usage.ts)).
  Codex sends `usage_update` with `used` and `size` only, no cost
  ([`CodexEventHandler.ts` line 1451](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexEventHandler.ts#L1451)),
  and fills `usage` and `_meta.quota` on the prompt response
  ([`CodexAcpServer.ts` lines 5855-5880](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAcpServer.ts#L5855-L5880)).
  Claude also puts the model name on a usage update under `_meta["_claude/model"]`, because the standard update has no
  model field.

## 9. Authentication

- **[stable] What `authenticate` does.** `initialize` returns `authMethods`. Each has an `id`, a `name` and a `type`.
  Default type `agent`: the agent handles the login itself. The client sends `authenticate` with that `methodId` and
  gets `{}` back. Type `terminal`: the client runs the same agent program in an interactive terminal with the method's
  extra `args` and `env`, waits for exit code 0, then reconnects and re-initializes. The client must not call
  `authenticate` for a terminal method. It advertises it can do this with `clientCapabilities.auth.terminal: true`.
  When login is needed, `session/new` fails with `auth_required` (code `-32000`). `logout` ends the state (flag
  `agentCapabilities.auth.logout`). What happens to running sessions after logout is up to the agent
  ([authentication](https://agentclientprotocol.com/protocol/v1/authentication),
  [errors](https://agentclientprotocol.com/protocol/v1/error)).
- **[unstable] `auth/status`** (Draft RFD): ask whether the agent already has credentials, before creating a session,
  plus an `auth/status_update` push ([RFD](https://agentclientprotocol.com/rfds/get-auth-state)). Both adapters
  implement it.
- **[v2 preview]** `authenticate` becomes `auth/login`, `logout` becomes `auth/logout`
  ([migration guide, "Authentication"](https://agentclientprotocol.com/protocol/v2/migration)).
- **Claude adapter [adapter-only].** It runs the Claude CLI through the Claude Agent SDK, so (my reading) it uses whatever login that
  CLI holds. It reads the identity (subscription, API key, gateway, external cloud credentials or none) from the CLI
  and reports it
  ([`auth-status.ts` header](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/auth-status.ts)).
  It lists no in-protocol login. If the client says `auth.terminal: true`, it lists terminal methods: `claude-ai-login`
  ("Claude Subscription", runs `--cli auth login --claudeai`), `console-login` ("Anthropic Console", API billing), or
  on a remote machine `claude-login` (`claude /login`)
  ([`auth-methods.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/auth-methods.ts)).
  Its `authenticate` accepts only a `gateway` method and rejects any other id
  ([`acp-agent.ts` line 2228](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/v1/acp-agent.ts#L2228)).
  A signed-out CLI makes requests fail with `auth_required`. An opt-in launch flag, `--hide-claude-auth`, hides the
  claude.ai login and refuses sessions that a Free, Pro, Max or Team plan would pay for
  ([`hide-claude-auth.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/hide-claude-auth.ts)).
  It is off unless a client passes it.
- **Codex adapter [adapter-only].** Methods: `api-key` (the key comes in `_meta`, or from `CODEX_API_KEY` or
  `OPENAI_API_KEY`), `chat-gpt` (hidden when `NO_BROWSER` is set), `chat-gpt-device-code` (only if the client supports
  URL elicitation) and `gateway` (only if the client opts in)
  ([`CodexAuthMethod.ts`](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAuthMethod.ts)).
  Before a session it asks Codex for the account. If Codex already has a login (including the ChatGPT subscription
  login), nothing more is needed. If not, and no `DEFAULT_AUTH_REQUEST` is set, the request fails with `auth_required`
  ([`CodexAcpServer.ts` lines 1128-1150](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAcpServer.ts#L1128-L1150),
  [`CodexAcpClient.ts` line 455](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/CodexAcpClient.ts#L455)).

## 10. One agent talking to another agent, and subagents

- **[stable] Subagent sessions.** An agent can show the subagents it delegates to as child sessions, each with its own
  `sessionId`. It announces one with `subagent_update` on the parent, then streams the child's messages, tool calls
  and plans with the child's id. `session_message` reports messages between sessions. The client opts in with
  `clientCapabilities.subagents: {}` in v1. In v2 no flag is needed, and every client must handle child sessions.
  The client sends no prompts to a child. It can only send `session/cancel` for a child that says it can be cancelled.
  Exposing subagents is optional for agents
  ([subagents](https://agentclientprotocol.com/protocol/v1/subagents), completed 2026-11-20 per
  [RFD updates](https://agentclientprotocol.com/rfds/updates)).
- **Client is another agent.** One sentence in the docs: "An agent can act as an ACP Client to run other coding agents
  as sub-agents" ([ACP and other protocols](https://agentclientprotocol.com/get-started/related-protocols)). It is a
  statement, and there is no method for it. The roles are symmetric only in that nothing stops a program from being
  both.
- **[unstable] Proxy chains** (Draft RFD): components that sit between a client and an agent, forward messages and may
  change them. Methods `proxy/initialize` and `proxy/successor`
  ([RFD](https://agentclientprotocol.com/rfds/proxy-chains)).
- **Not ACP.** Delegating a task to an independent agent is the job of A2A, a separate protocol. ACP's own page says
  to use ACP "when a program drives an Agent and stays involved during each turn"
  ([ACP and other protocols](https://agentclientprotocol.com/get-started/related-protocols)).
- **Adapters [adapter-only].** Both map their own subagents to this: Claude's Agent and Task tool calls become child
  sessions for a client that sets `subagents`, with `session_message` for the launch prompt and the answer
  ([`docs/subagent-sessions.md`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/docs/subagent-sessions.md)).
  Codex reports its subagents as child sessions the same way, and falls back to plain tool calls without the flag
  ([Codex README, "Subagent sessions"](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/README.md)).

## 11. What this cannot tell us

- **How fast the spec moves.** The spec repo changed on the day I read it: the schema crate was at 1.21.2 on 2026-11-21,
  and the changelog shows several releases in the last two days. Subagents and plan operations were stabilized
  on 2026-11-20, and v2 reached Preview the same day. Any "stable" claim here can age in days. Re-check the schema file,
  not this note, before a decision that depends on one fact.
- **Real behavior.** I ran no agent. Everything about the adapters is from reading their source and README, not from a
  session. I did not start `claude-agent-acp` or `codex-acp`, so I cannot say what a real `initialize` or
  `session/new` returns, which models a given account sees, or what a real permission request looks like on the wire.
- **The unread middle of the adapters.** The Claude adapter's `v1/acp-agent.ts` is about 11,000 lines, and I read the
  parts named in the links, not all of it. "No permission timer", "no call to client `fs`/`terminal`" and "no socket" are
  results of searches, not proofs.
- **The v2 adapter paths.** I read the v1 paths of both adapters closely and the v2 paths only through their READMEs
  and docs. The Claude adapter's v2 agent lives in `src/v2/`, and Codex has `AcpV2*.ts` files. Where v1 and v2 differ,
  the adapters' v2 behavior is unchecked.
- **Remote transport details.** The draft RFD was rewritten several times between April and May 2026 (its revision
  history says so). I did not check any SDK for an implementation, and I do not know when it will be a stable part of
  ACP. Whether a browser can set the `Acp-Connection-Id` header on a WebSocket upgrade is a browser rule I did not
  look up.
- **Terms of use.** The sources say the Claude adapter can use a subscription login and has a flag to refuse it. They do
  not say what a third-party client may do with a subscription login. That is an Anthropic and OpenAI terms question,
  not a protocol one.
- **Thinking and effort details.** ACP defines the category `thought_level` and nothing about the values. I did not
  read what each Claude or Codex level does, or which models accept which levels beyond what the option builders show.
- **Third-party SDKs.** I did not read the TypeScript SDK (`@agentclientprotocol/sdk`, version 2.9.x in both adapters)
  or any Effect-based client. How a small library should wrap them is a design question for the talk.

## Sources

Read on 2026-11-21. Spec repo, schema and docs were read at the commit named here. Site pages are the rendered form of
the same files; I checked that the pages cited here returned 200 on that day.

- ACP spec site: https://agentclientprotocol.com (protocol v1 pages under `/protocol/v1/`, v2 under `/protocol/v2/`,
  RFDs under `/rfds/`, announcements under `/announcements/`).
- ACP spec repo, `agentclientprotocol/agent-client-protocol` at commit `56331565417adce881793622a4ad1e326a78be5d`:
  https://github.com/agentclientprotocol/agent-client-protocol/tree/56331565417adce881793622a4ad1e326a78be5d. Files:
  `schema/v1/schema.json`, `schema/v1/schema.unstable.json`, `schema/v1/meta.json`, `schema/v1/meta.unstable.json`,
  `schema/v2/schema.json`, `schema/v2/meta.json`, `docs/protocol/v1/*.mdx`, `docs/protocol/v2/*.mdx`,
  `docs/rfds/*.mdx`, `docs/get-started/related-protocols.mdx`, `CHANGELOG.md`.
- Claude adapter, `agentclientprotocol/claude-agent-acp` at commit `4af4581ad510a85d5cdfa3b9100412479e1cfef4`, package
  version 0.109.1 (the old `zed-industries/claude-code-acp` redirects here):
  https://github.com/agentclientprotocol/claude-agent-acp/tree/4af4581ad510a85d5cdfa3b9100412479e1cfef4
- Codex adapter, `agentclientprotocol/codex-acp` at commit `e3a679f193458f8d4825803a4744063e7d4a5e80`, package version
  2.9.0: https://github.com/agentclientprotocol/codex-acp/tree/e3a679f193458f8d4825803a4744063e7d4a5e80
- Archived Codex adapter, `zed-industries/codex-acp`: https://github.com/zed-industries/codex-acp

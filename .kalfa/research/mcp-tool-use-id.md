---
summary: Whether Claude Code and Codex put their own tool-use id in the _meta of an MCP tools/call request, and whether a retry reuses it; both do send one (Claude Code as `claudecode/toolUseId`, Codex as `callId`), neither documents it, both reuse it on their own retry, MCP itself gives a call no such id, and a model that calls again after an error gets a new id; each fact marked spec, documented, seen only in source or not found, each cited
---

# Do Claude Code and Codex send a tool-use id with an MCP tool call?

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1829): we are designing a library that shows a
program's inputs as MCP tools, and each tool call saves one message. We ruled that a repeated call is a new message,
because MCP gives a call no id that survives a retry. If both harnesses pass a stable id, we could use it as the
message's id, and a repeat would be saved once. So, per harness: is an id passed, where, is it documented, and does a
retry reuse it, or does a retry even happen?

Read on 2026-11-21. Only primary sources: the MCP spec repo, the Codex source, Claude Code's own docs and changelog, and
the Claude Code program file itself (its source is closed). Source code is cited at a commit.

## How each fact is marked

- **spec**: stated in the MCP specification.
- **documented**: stated in the harness's own docs or changelog.
- **seen only in source**: found in the harness's code, and in no doc. It can change without notice. For Claude Code the
  "source" is the shipped program file of version 2.1.330, read with `strings`, because the real source is closed. So
  that one is weaker than Codex's.
- **not found**: I looked and found nothing. This is not the same as "does not exist".

## The short answer

1. **MCP itself gives a call no id that survives a retry. [spec]** A request has a JSON-RPC `id`. In the 2026-07-28
   revision a retry, a repeat after a broken stream, and every round of a multi round-trip request must use a new `id`.
   `_meta` is free for extra keys, but the spec defines none for a tool-call id. `progressToken` is a different thing.
2. **Codex sends one. [seen only in source]** `params._meta.callId` is the id of the model's function call (Codex's own
   word is "call id"). It goes to every MCP server, not only OpenAI's. A real integration test with a stdio test server
   checks it. Codex also sends `threadId` and `sessionId` in the same `_meta`. No Codex doc mentions any of this.
3. **Claude Code sends one. [seen only in source]** `params._meta["claudecode/toolUseId"]` is the id of the model's
   `tool_use` block. It goes on `tools/call` for every server type I read. No Claude Code doc mentions it. This is read
   from the shipped program, so it is the weakest of these facts.
4. **A retry by the harness reuses the id. [seen only in source, both]** In both programs the `_meta` is built once,
   before the retry loop, and the loop sends the same params again. But the harness retries a call rarely.
   - Codex: only a call to an HTTP server whose session expired (HTTP 404, so the call did not run). No retry on a
     timeout, a dropped connection or a server error.
   - Claude Code: only for an HTTP server or a claude.ai connector, once, on a new connection. For a call lost
     mid-flight it retries only if the tool says `idempotentHint` or `readOnlyHint`. It never retries a stdio call.
5. **A call the model makes again gets a new id.** After a timeout or an error, both harnesses give the model an error
   result. If the model calls again, it is a new function call or `tool_use` block, so a new id. (My reading: neither
   harness code path I read reuses an id for that. I ran nothing.)
6. **One tool call can send several requests with the same id. [seen only in source, Codex; Claude Code too, my
   reading]** On the 2026-07-28 revision a server can answer `input_required`, and the harness sends the call again with
   `inputResponses`. Same `_meta`, same id, new JSON-RPC `id`. So an id alone is not enough to say "this message was
   already saved": a repeat that carries `inputResponses` or `requestState` is a later step of one call, not a repeat of
   the first request.

What this means for the ruling (my reading, not a source's claim): the harness id is a good dedupe key for the one case
we care about, a harness-side retry of a lost call. It is not a key we can count on. It is absent for any other client
(Claude Desktop, ChatGPT, an IDE), it is undocumented in both harnesses, and it has the multi-round caveat above. A
library that uses it would need a fallback to the current ruling when the key is missing. My confidence that both
harnesses send these ids today: about 90% for Codex, about 85% for Claude Code. That the retry reuses the id: about 85%
for both. The doubts are in the last section.

## 1. What MCP defines

**Request id.** [spec]
- A request has a JSON-RPC `id`, a string or an integer, never `null`. In 2025-11-25 it "MUST NOT have been previously
  used by the requestor within the same session"
  ([2025-11-25 basic](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2025-11-25/basic/index.mdx#L46-L49)).
  In 2026-07-28 it "MUST NOT match the ID of any other request the sender has issued and not yet received a response
  for"
  ([2026-07-28 basic](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/basic/index.mdx#L46-L49)).
  So the id names one request on the wire, not one logical call.
- A multi round-trip retry: "The JSON-RPC `id` MUST be different between the initial request and the retry"
  ([tools](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/server/tools.mdx#L234),
  [MRTR rules](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/basic/patterns/mrtr.mdx#L256)).

**Retries and resuming a stream.** [spec]
- 2025-11-25 let a server tag SSE events with ids and let a client resume with `Last-Event-ID`, so a broken stream could
  deliver the lost response of the same request
  ([2025-11-25 transports](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2025-11-25/basic/transports.mdx#L164-L188)).
  That is resume of one request, not a new call.
- 2026-07-28 removes it: "A broken response stream loses the in-flight request; clients MUST re-issue it as a new
  request with a new request ID"
  ([changelog item 9](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/changelog.mdx#L28);
  [streamable HTTP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/basic/transports/streamable-http.mdx#L157)).
  The same revision removes `Mcp-Session-Id`.
- The spec says nothing else about retrying a `tools/call`. The tool hint `idempotentHint` means "calling the tool
  repeatedly with the same arguments will have no additional effect on its environment", and the spec calls every hint
  only a hint
  ([schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/schema/2026-07-28/schema.ts#L1939-L1947)).
  I found no idempotency key for `tools/call`. (The idempotent keys in the tasks and events SEPs belong to other
  methods.)

**`_meta` and `progressToken`.** [spec]
- `_meta` carries extra data on any request. A key may have a prefix in reverse-DNS form (`com.example/`) and a name.
  Prefixes whose second label is `mcp` or `modelcontextprotocol` are reserved. Reserved keys are `progressToken`,
  `io.modelcontextprotocol/*` and the trace keys `traceparent`, `tracestate`, `baggage`
  ([`_meta` rules](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/basic/index.mdx#L322-L360)).
  A key with no prefix is allowed, which is what Codex's `callId` is.
- `progressToken` only opts the request into progress notifications. It is "chosen by the client using any means" and
  must be unique across active requests, so it is not a stable id either
  ([progress](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/basic/patterns/progress.mdx#L15-L18)).
- A `tool use id` does exist in MCP, in sampling (`toolUseId` on `ToolResultContent`), but that is the id of a model's
  tool call inside a sampling request, not of a `tools/call`
  ([sampling](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/b7e13978aa0bd092baa98190d58825e7863d6ee1/docs/specification/2026-07-28/client/sampling.mdx#L676)).
- I searched the spec and SEP folders for a tool-call id, `toolCallId` and `idempotency key`. I found none for
  `tools/call`. [not found]

## 2. Codex

All code at commit `9302bb553e70512888a9053fd7aa52e23fa30d1e` of `openai/codex`.

**Is an id passed, and where.** [seen only in source]
- `build_mcp_tool_call_request_meta` starts every MCP call's `_meta` with `"callId": <call_id>`, for every server, before
  any server-specific key
  ([`mcp_tool_call.rs` L1485-L1497](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/core/src/mcp_tool_call.rs#L1485-L1497)).
  The Codex Apps connector gets a second copy as `_codex_apps.call_id`.
- `with_mcp_tool_call_ids_meta` then adds `threadId` and `sessionId`, and `windowId` and `itemId` when another tool call
  originated the call
  ([L1596-L1628](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/core/src/mcp_tool_call.rs#L1596-L1628)).
  A turn-info object under `x-codex-turn-metadata` and the W3C trace keys can be there too.
- The `call_id` is the one the model's function call carries. An integration test makes a mock model send a function
  call with id `call-agent-context` to a real stdio test server, and asserts the server saw
  `meta["callId"] == "call-agent-context"`
  ([`rmcp_client.rs` L544](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/core/tests/suite/rmcp_client.rs#L544);
  the test server echoes the request `_meta` back in
  [`test_stdio_server.rs` L833-L835](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/rmcp-client/src/bin/test_stdio_server.rs#L833-L835)).
  A unit test checks the exact `_meta` object for the Apps case
  ([`mcp_tool_call_tests.rs` L1878-L1902](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/core/src/mcp_tool_call_tests.rs#L1878-L1902)).
- How `call_id` is minted for a call that another tool call started (code mode): not read. [not found]

**Is it documented.** [not found]
- The Codex MCP page (https://developers.openai.com/codex/mcp) and the config reference
  (https://developers.openai.com/codex/config-reference) say nothing about `callId` or request `_meta`. The one README
  that lists `_meta` keys Codex sends documents only the sandbox keys
  ([`codex-mcp/README.md`](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/codex-mcp/README.md#L11-L36)).
  So `callId` is an implementation detail with no promise.

**Does a retry happen, and is the id the same.** [seen only in source]
- The `_meta` is built once per call in core, then wrapped into a resolver that Codex calls again for each send,
  "including a recovery retry"
  ([`rmcp_client.rs` L1050-L1052](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/rmcp-client/src/rmcp_client.rs#L1050-L1052)).
  The resolver adds only server-dependent keys (sandbox and trace), not a new call id.
- The only automatic retry of an operation is in `run_service_operation_with_pause_state`
  ([L1843-L1880](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/rmcp-client/src/rmcp_client.rs#L1843-L1880)).
  - The short retry loop with delays of 250 ms and 1 s retries only `tools/list`
    ([`is_retryable_tools_list_error`, L1969](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/rmcp-client/src/rmcp_client.rs#L1969)).
  - When an HTTP server answers 404 because its session expired, Codex starts a new session and sends the same
    operation again, `tools/call` included.
  - A timeout is not retried. It ends the call with an error that the model sees. The limit is the smaller of the
    server's and the caller's
    ([`connection_manager.rs` L1550](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-mcp/src/connection_manager.rs#L1550)).
    A dropped stdio or HTTP connection also just fails the call (my reading: I found no other retry).
- The JSON-RPC `id` of the resent request is chosen by the `rmcp` library, which I did not read. [not found] Under the
  2026-07-28 rule it must be new.
- Multi-round: the loop in `request_input.rs` sends a clone of the same request again with `inputResponses` and
  `requestState` filled in, so `_meta`, with its `callId`, is the same on every round
  ([`request_input.rs` L196-L210](https://github.com/openai/codex/blob/9302bb553e70512888a9053fd7aa52e23fa30d1e/codex-rs/rmcp-client/src/request_input.rs#L196-L210)).
  Codex's comment there also says that after a verification step, session recovery does not replay the call.

## 3. Claude Code

Claude Code's source is closed. Facts below come from three places: its docs and changelog (documented), the public
changelog repo, and the program file of version 2.1.330 read with `strings` (seen only in source).

**Is an id passed, and where.** [seen only in source]
- The program builds each MCP call's metadata object once and starts it with the tool-use id. The key is
  `claudecode/toolUseId`. The value is the tool-use id of the model's `tool_use` block (`le.toolUseId`, or one taken from
  the assistant message). The code is: `Nt={...yoi(config,le.mcpRequestMeta),...re?.mcpCallMeta,...$e&&{"claudecode/toolUseId":$e},...}`
  where `$e=le.toolUseId??ni(Oe)`.
- A wrapper around the transport's `send` adds the key to the `tools/call` request's `params._meta`, and, by my reading, maps a
  local alias id back to the original id before it goes out. So the wire value is the plain tool-use id. (To check it
  yourself: install the same version and run
  `strings <path to the claude program> | grep 'claudecode/toolUseId'`.)
- Other `claudecode/*` keys exist: `agentId`, `agentType`, `isObserver` (for subagents), `hookCall`, `callMark`,
  `remoteToolCall`, `autoModeVerdict`. Claude Code also adds `anthropic/requestId` (the API request id) for some
  servers. I found no session id in the `_meta` it sends to an ordinary server, so Claude's id is not paired with a
  session id the way Codex's is. [not found]
- This is the same program inside the Agent SDK. The SDK changelog says each release is "parity with Claude Code vX"
  ([SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/1e667424b6d3e9ca4f878e77dc80ccb4d77c9518/CHANGELOG.md#L1-L12)).
  An SDK MCP server (in process) gets its own request ids: the changelog says that while an earlier request is
  unanswered, a new one "can carry an `id` of 1,048,576 or more"
  ([L10](https://github.com/anthropics/claude-agent-sdk-typescript/blob/1e667424b6d3e9ca4f878e77dc80ccb4d77c9518/CHANGELOG.md#L10)).
  That is the JSON-RPC id, not the tool-use id.

**Is it documented.** [not found]
- The MCP docs page, the MCP errors page, the Agent SDK MCP page and the full docs text (`llms-full.txt`, 10 MB) contain
  no `claudecode/toolUseId`. The docs do list `_meta` keys Claude Code reads from a server's `tools/list` entry
  (`anthropic/maxResultSizeChars`, `anthropic/requiresUserInteraction`, `anthropic/alwaysLoad`) and one key it sends on
  a 2026-07-28 request (`io.modelcontextprotocol/clientCapabilities`)
  ([MCP docs](https://code.claude.com/docs/en/mcp)). Nothing documents the keys it sends on a call.
- The changelog (the repo copy) has no entry for the key either: a search for `toolUseId`, `_meta` and `claudecode/`
  finds only OpenTelemetry events, hook inputs and `anthropic/*` keys
  ([changelog](https://github.com/anthropics/claude-code/blob/6935d6e1ec69321aace1be56c73c876bade33e6b/CHANGELOG.md)).

**Does a retry happen, and is the id the same.**
- Documented: Claude Code repeats a call "on its own, once, when the server marks the tool as safe to repeat", for an
  HTTP server or a claude.ai connector whose connection closed before the answer
  ([MCP docs, "Mark tools that are safe to call twice"](https://code.claude.com/docs/en/mcp#mark-tools-that-are-safe-to-call-twice),
  [errors page](https://code.claude.com/docs/en/errors#mcp-server-connection-closed-before-the-tool-call-was-answered)).
  The marks are `idempotentHint` or `readOnlyHint`. The same docs say the tool "may have run". The change landed in
  v2.1.307: "HTTP MCP tool calls being sent twice when the connection closed mid-call; only read-only or idempotent tools
  are now retried"
  ([changelog L2304](https://github.com/anthropics/claude-code/blob/6935d6e1ec69321aace1be56c73c876bade33e6b/CHANGELOG.md#L2304)).
  My reading: before 2.1.307 it retried every such call, which is what that fix was about. So a server on an older Claude Code can
  see an id twice for a call that was not idempotent.
- Seen only in source: the call runs inside a `for(let lo=0;;lo++)` loop that sits after the metadata object is built, so
  every pass sends the same `claudecode/toolUseId`. The loop's session-recovery branch retries when the error is
  "session expired" or "connection closed", at most once (`lo<1`), and only if the call did not run, or the tool is
  concurrency-safe, or `annotations.idempotentHint===true`. Two other branches also `continue` the same loop: a step-up
  re-authentication and an approval re-ask (my reading of the names). The metadata is not rebuilt in any of them.
- A stdio server is not retried: the docs say the repeat is for HTTP and connector servers, and the session-expired error
  class is thrown only for them (my reading of the code).
- A timeout or any other error is not retried. The model gets an error result and may call again, which is a new
  `tool_use`, so a new id.
- Multi-round on 2026-07-28: the transport wrapper counts `inputResponses` sent under the same tool-use id, so several
  requests share one id there too. My reading; I did not run it.

## 4. The two ACP adapters

Commits: `agentclientprotocol/claude-agent-acp` at `4af4581ad510a85d5cdfa3b9100412479e1cfef4`,
`agentclientprotocol/codex-acp` at `e3a679f193458f8d4825803a4744063e7d4a5e80`.

- Neither adapter puts a tool-use id into an MCP call. They only hand the client's MCP server list to the harness. The
  Claude adapter turns each entry into an Agent SDK server config (HTTP and SSE keep URL and headers, a stdio entry
  stays stdio)
  ([`src/mcp-servers.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/mcp-servers.ts#L38-L72)).
  The Codex adapter does the same for Codex's config
  ([`src/McpServerConfig.ts`](https://github.com/agentclientprotocol/codex-acp/blob/e3a679f193458f8d4825803a4744063e7d4a5e80/src/McpServerConfig.ts#L38-L60)).
  So the harness sends the `tools/call`, and the findings above hold through ACP. [seen only in source]
- One exception: a client can declare an MCP server of type `acp` (MCP over ACP). The Claude adapter then opens a local
  HTTP endpoint on 127.0.0.1 and relays every MCP request to the client as an `mcp/message` request. The Codex adapter
  does the same through the ACP SDK's HTTP bridge. Whether `_meta` goes through unchanged is decided in the ACP SDK
  bridge, which I did not read. [not found]
- The tool-call id the adapters show to an ACP client (`toolCallId` in a `tool_call` update) is the harness's own id
  (Claude adapter code compares it to the tool-use id,
  [`exit-plan.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4af4581ad510a85d5cdfa3b9100412479e1cfef4/src/exit-plan.ts#L14-L28)).
  I did not check whether it equals the `_meta` id that reaches an MCP server. Same for Codex. [not found]

## 5. Side by side

| | Codex | Claude Code |
|---|---|---|
| Id in `tools/call` `_meta` | `callId`, plus `threadId`, `sessionId` | `claudecode/toolUseId` |
| What the id is | the model's function call id | the model's `tool_use` id |
| Documented | not found | not found |
| Evidence | source and a test with a real stdio server | the shipped program only |
| Retries a lost call on its own | only after an HTTP 404 session expiry | once, HTTP and claude.ai connector only, if idempotent or read-only (or the call never ran) |
| Retry keeps the id | yes (same `_meta` object) | yes (same `_meta` object) |
| Retries on timeout | no | no |
| Retries on stdio | no | no |
| Several requests, one id (multi-round) | yes | yes (my reading) |
| New id when the model calls again | yes (my reading) | yes (my reading) |

## 6. What this cannot tell us

- **No live run.** I ran no harness against a server and captured no `tools/call`. Everything is from reading code and
  docs. The shape `params._meta.callId` and `params._meta["claudecode/toolUseId"]` is read from code, not seen on a wire.
  A cheap check would be a tiny stdio MCP server that logs the whole request, then one model turn on each harness. I did
  not do it, because a model run costs money and the repo asks for a person's yes first.
- **Claude Code is a read of minified code.** The version read is 2.1.330. Names in it are shortened (`$e`, `Nt`, `lo`),
  and I followed the metadata object and the retry loop by hand. The retry loop's exact conditions could be misread in
  a detail. The key itself is in the program as plain text, which is solid. A later version may differ. The
  `claudecode/` prefix says the key is Claude Code's own, but nothing promises it stays.
- **Undocumented in both.** A harness can rename or drop either key in any release, with no changelog line. Codex's
  `callId` has no prefix, so a server could also get a clash with another client's key of the same name.
- **JSON-RPC ids.** I did not read the `rmcp` library (Codex) or the TypeScript MCP SDK (Claude Code), so I cannot say
  how they pick the `id` of a resent request. The 2026-07-28 spec says it must be new, and it is the only rule I have.
- **Other clients.** ChatGPT, Claude Desktop, Cursor, Zed and any other MCP client may send no id, or a different key.
  Only Claude Code and Codex were asked about.
- **Uniqueness of the id.** The ids come from the model providers. I did not check any promise that a tool-use id or a
  function call id is unique across sessions, forks, rewinds or resumed threads. A resumed Codex thread or a forked
  Claude session carries old ids in its history. I did not find a path that re-runs an old call, but I did not look for
  one either. Codex's `threadId` and `sessionId` are in the same `_meta`, so a pair is safer than the id alone.
- **Trust.** The id is client-supplied. Any client can send any value. It is a dedupe hint, not proof of who called.
- **Code mode and subagents.** How Codex code mode mints the id of a nested call, and what Claude Code sends from a
  subagent beyond `agentId`, I did not read.
- **Older harness versions.** Before Claude Code 2.1.307 it retried non-idempotent HTTP calls. I did not look further
  back for when the key began to be sent.

## Sources

Read on 2026-11-21.

- MCP spec repo, `modelcontextprotocol/modelcontextprotocol` at commit `b7e13978aa0bd092baa98190d58825e7863d6ee1`:
  https://github.com/modelcontextprotocol/modelcontextprotocol/tree/b7e13978aa0bd092baa98190d58825e7863d6ee1. Files:
  `docs/specification/2025-11-25/basic/index.mdx`, `docs/specification/2025-11-25/basic/transports.mdx`,
  `docs/specification/2026-07-28/basic/index.mdx`, `.../basic/patterns/mrtr.mdx`, `.../basic/patterns/progress.mdx`,
  `.../basic/transports/streamable-http.mdx`, `.../server/tools.mdx`, `.../client/sampling.mdx`,
  `.../changelog.mdx`, `schema/2026-07-28/schema.ts`, and the `seps/` folder.
- Codex, `openai/codex` at commit `9302bb553e70512888a9053fd7aa52e23fa30d1e`:
  https://github.com/openai/codex/tree/9302bb553e70512888a9053fd7aa52e23fa30d1e. Files under `codex-rs/`:
  `core/src/mcp_tool_call.rs`, `core/src/mcp_tool_call_tests.rs`, `core/tests/suite/rmcp_client.rs`,
  `rmcp-client/src/rmcp_client.rs`, `rmcp-client/src/request_input.rs`, `rmcp-client/src/streamable_http_retry.rs`,
  `rmcp-client/src/bin/test_stdio_server.rs`, `codex-mcp/src/connection_manager.rs`, `codex-mcp/README.md`.
- Codex docs: https://developers.openai.com/codex/mcp and https://developers.openai.com/codex/config-reference.
- Claude Code docs: https://code.claude.com/docs/en/mcp, https://code.claude.com/docs/en/errors,
  https://code.claude.com/docs/en/agent-sdk/mcp, and the full text at https://code.claude.com/docs/llms-full.txt.
- Claude Code changelog repo, `anthropics/claude-code` at commit `6935d6e1ec69321aace1be56c73c876bade33e6b`:
  https://github.com/anthropics/claude-code/blob/6935d6e1ec69321aace1be56c73c876bade33e6b/CHANGELOG.md.
- Claude Agent SDK changelog, `anthropics/claude-agent-sdk-typescript` at commit
  `1e667424b6d3e9ca4f878e77dc80ccb4d77c9518`:
  https://github.com/anthropics/claude-agent-sdk-typescript/blob/1e667424b6d3e9ca4f878e77dc80ccb4d77c9518/CHANGELOG.md.
- Claude Code program file, version 2.1.330 (the native install), read with `strings`. No source URL: it is not open.
- ACP adapters: `agentclientprotocol/claude-agent-acp` at commit `4af4581ad510a85d5cdfa3b9100412479e1cfef4` and
  `agentclientprotocol/codex-acp` at commit `e3a679f193458f8d4825803a4744063e7d4a5e80`.
- Earlier ACP note, for format: `.kalfa/research/acp-client-facts.md` on the branch `research/acp-client-facts`.

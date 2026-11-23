Approved by the lead agent, builds issues 1767, 2066; body 5ea4803be76f
Plancheck-Version: 3

# Plan: @kalfa/transport, a value crosses a socket and comes back typed (ticket 2066)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2066, the first build ticket of the new package `@kalfa/transport`. Its
parent is the settled protocol, https://github.com/kamp-us/tea-fabrika/issues/1767 (closed), with the owner's answers on
its gaps in https://github.com/kamp-us/tea-fabrika/issues/1767#issuecomment-7084366538 and
https://github.com/kamp-us/tea-fabrika/issues/1767#issuecomment-7084402755, from
https://github.com/kamp-us/tea-fabrika/issues/1902. `kalfa/transport/` holds only `GLOSSARY.md` today. This plan makes
the core entry point `@kalfa/transport` (`Format`, `Format.layerJsonRpc`, `Transport.encode`, `Transport.socket`,
`Transport.decode`, `Transport.encodeTraced`, `Transport.decodeTraced`, `Traced`, `Frame`, `FormatError`) and
`@kalfa/transport/memory` (two joined sockets). It lands as one pull request that says `Closes #2066`.

Words: `kalfa/transport/GLOSSARY.md` (socket, frame, format). Every other new name is listed under `## New names`.

```ts
// The whole idea, a sketch. The calls named here were read in Effect 4.1.3; the chain was not type-checked.
import { Effect, Stream } from "effect"
import { Socket } from "effect/socket"
import { Format, Transport } from "@kalfa/transport"
import * as MemorySocket from "@kalfa/transport/memory"

const Progress = Schema.TaggedStruct("Progress", { done: Schema.Int, of: Schema.Int })

clicks.pipe(
  Stream.map(count),                 // a stage: a plain stream function standing in for a program
  Transport.encode(Progress),        // Stream<Frame, E | FormatError, R | Format>
  Transport.socket,                  // Stream<Frame, E | FormatError | SocketError, R | Format | Socket.Socket>
  Transport.decode(Progress),        // Stream<Progress, E | FormatError | SocketError, R | Format | Socket.Socket>
  Stream.map(badge),                 // a stage
  Stream.runDrain,
  Effect.provide([NodeSocket.layerWebSocket(url), Format.layerJsonRpc]), // or one end of MemorySocket.pair
)
```

```json
{"jsonrpc":"2.0","method":"value","params":{"value":{"_tag":"Progress","done":3,"of":10},"_meta":{"traceparent":"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"}}}
```

## Doubts, at the top

Each is a call this plan takes and builds on. Under 80% sure, it says what would settle it.

- **A value's frame uses the one method `"value"` (75%).** JSON-RPC 2.0 needs a `method` on every notification, and
  neither decision 0039 nor the protocol names one for a value stream. One fixed word keeps `encode(schema)` a
  one-argument call, as the owner's sketch has it, and leaves other words (`challenge`, `hello`, `ping`) free for
  https://github.com/kamp-us/tea-fabrika/issues/2068 and https://github.com/kamp-us/tea-fabrika/issues/2069, which
  send their own frames through `Format`. `decode` refuses a frame with another method, so a hello or a ping that
  reaches a value stream fails loudly and is never read as a value. The doubt: an outside JSON-RPC client (MCP, LSP)
  may want a method per kind of value. What settles it: the hello plan (2068), the first caller that shares a socket
  between Transport's own frames and values. Before v0.0.0 a changed word wipes nothing worth keeping.
- **`tracestate` rides in the trace's annotations (75%).** Effect's `Tracer.ExternalSpan` has trace id, span id,
  sampled and an `annotations` context, and no `tracestate`. The ticket's `Traced` uses `ExternalSpan`, and its
  acceptance asks for `tracestate` when there is one. The plan keeps it under a small context key, `Format.TraceState`,
  inside the span's `annotations`: the reader puts it there, the writer reads it from there. The doubt is whether a
  key of ours inside an Effect value reads as natural; the other way is a `tracestate` field beside `trace` on
  `Traced`, which changes the type the owner ruled. What settles it: the review's read.
- **A 16-digit trace id is written padded to 32, and an id that is no W3C id is not written (75%).** Effect's own
  tracer makes 32-digit trace ids and 16-digit span ids (the probe saw 32 and 16), and Effect's HTTP writer pads a
  16-digit trace id with zeros. An `ExternalSpan` built from elsewhere may hold anything. Writing a text the reader
  will drop would promise a trace that never arrives, so the writer writes no trace keys for it, and law T1 holds the
  two ends to the same rule. What settles it: the first caller that hands in a span from outside Effect's tracer.

## What changes, in one paragraph

A new private workspace package, `@kalfa/transport`, with two entry points. The root (`src/index.ts`) holds `Frame`,
the `Format` service with its JSON-RPC 2.0 Layer, `FormatError`, `Traced`, and the stream functions in the `Transport`
module: `encode`, `decode`, `encodeTraced`, `decodeTraced` and `socket`. The socket is Effect's own `Socket.Socket`, so
any Effect socket Layer works and Transport writes no socket code for Node or the browser. `/memory`
(`src/MemorySocket.ts`) gives two joined sockets for tests. The core imports no kalfa package and ranks lowest, beside
Source control. Out of scope, each its own ticket: `connect` and `accept` (2068), ping and `Stalled` (2069), `/test`,
the laws every socket Layer passes (https://github.com/kamp-us/tea-fabrika/issues/2071), `/cloudflare`
(https://github.com/kamp-us/tea-fabrika/issues/2067), and `/webrtc` and the relay
(https://github.com/kamp-us/tea-fabrika/issues/2072 to https://github.com/kamp-us/tea-fabrika/issues/2075).

## Slices

1. **The whole ticket, in one pull request.** Branch `fabrikalfa/kalfa-transport` (this worktree). The package, its
   manifest, lint override, rank rows and lockfile; `Frame`; `Format`, `FormatError`, `Format.TraceState` and
   `Format.layerJsonRpc`; `Traced`; the five stream functions; the memory pair; the README; and every law below. It lands
   whole: a caller pipes typed values through a socket and gets them back typed, with the sender's trace, on the memory
   pair and on Effect's Node WebSocket Layer. About 284 product lines, so it is not cut.

## Searched first

- The ticket whole; the parent 1767 with all six comments (the cut line from old decision 0601, Identity's proof, the
  resolution of 2026-11-20, the gaps, the owner's five answers, and `serve`'s three handlers); 1902.
- The sibling tickets 2067, 2068, 2069 and 2071, for what they will need from this one: 2067's `frame` handler reads a
  frame's trace through `Format`, 2068 sends a challenge and a hello on the same socket, 2069 puts `Stalled` into
  `socket`'s errors, and 2071's laws need a close seen by both ends and a failure that ends the stream as `SocketError`.
- Decisions 0016, 0039, 0040, 0047, 0048, 0050, 0063 and 0079 whole; `kalfa/AGENTS.md`; `kalfa/transport/GLOSSARY.md`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns` and `.kalfa/runbooks` for "socket",
  "traceparent|trace context|_meta", "json-rpc|jsonrpc", "frame", "in-memory|memory pair|joined sockets" and
  "integration test". Every hit read. Patterns read: `effect-errors-keep-their-cause.md`,
  `effect-reach-for-what-ships.md`, `effect-tagged-value-is-matched.md`.
- The sibling packages, for layout and wiring: `kalfa/git/` (private, no build step, a `/memory` adapter, its package
  law `Package.test.ts`, its integration file `ProcessRepository.integration.test.ts`, its lint override in
  `.oxlintrc.json`), `kalfa/github/` (its leak laws over spans, logs, rendered errors and error properties), and
  `kalfa/secrets/` on branch `fabrikalfa/kalfa-secrets` (its approved plan `.kalfa/quests/kalfa-secrets-sign-PLAN.md`
  there, the tests commit's wiring: manifest, root `package.json`, lockfile, both rule files, the layers pin, the lint
  override).
- Today's `next/packages/libfabrika/src/transport/Wire.ts` and `next/packages/libfabrika/src/cloudflare/connection.ts`,
  as a map only: today's frames are JSON-RPC text built by hand, and the gateway sends `challenge` first.
- `layer-rules.json`, `boundary-rules.json`, `oxlint-plugins/layers.test.ts`, `vitest.config.ts` (its kalfa test glob
  and its integration project, which already take a new kalfa package's files), `vitest.hostrun.ts`.
- Installed versions in `pnpm-lock.yaml`: `effect` 4.1.3 and `@effect/platform-node` 4.1.3 (the repo's patches touch
  the arbitrary model, `TestConsole` and `NodeHttpServer.layerTest`'s host, not sockets), `vitest` 5.0.5, TypeScript
  7.0.2, `fast-check` 4.10.2, `ws` 8.22.1 under `@effect/platform-node-shared`. In Effect 4.1.3, read whole:
  `node_modules/effect/AGENTS.md`, `src/socket/Socket.ts` (the `Socket` contract, `toChannelString`, `readerString`,
  `CloseEvent`, `SocketError` and its five reasons, `makeWebSocket`, `fromWebSocket`), `src/socket/SocketServer.ts`,
  `src/rpc/RpcSerialization.ts` (`jsonRpc`, `codecFor`), `src/http/HttpTraceContext.ts` (`w3c`, `toHeaders`),
  `Tracer.ExternalSpan` and `externalSpan`, `Effect.withTracerEnabled`, `Stream.pipeThroughChannel`, `Stream.withSpan`,
  `Stream.catchIf`, `Schema.toCodecJson`, `Schema.Json`. In `@effect/platform-node`: `NodeSocket.layerWebSocket` (Node's
  global `WebSocket`) and `NodeSocketServer.layerWebSocket` (a `ws` server).
- The law id check (`node oxlint-plugins/law-ids.ts`) ran clean on this worktree. `kalfa/transport/` has no laws yet, so
  every id this plan uses is free in its package.

## Probes run while planning

Two throwaway scripts in a scratch folder outside the repo, run with Node 26.13.0 against this worktree's installed
Effect. Nothing was written into the repo, installed or committed. No socket was opened: a real socket is a host
resource, so W1 is the first run of one.

- **Effect's JSON codec.** `Schema.toCodecJson(Schema.Number)` writes `NaN` and `Infinity` as text and reads them back,
  and writes `-0` as `0`, so `-0` comes back `0`: Effect's rule, not Transport's, and the README says so. `BigInt`
  becomes `"10"`, `Uint8Array` base64. `Schema.toCodecJson(Schema.Unknown)` refuses a function with a `SchemaError`
  ("Expected JSON value"), so a loose schema fails loudly at encode; F4 holds Transport to it. `Schema.is(Schema.Json)`
  refuses `NaN`, a function and an object holding `undefined`. `{ a: undefined }` under `Schema.optional` comes back
  as `{}`. A `SchemaError` for a short string did not quote the value, and a `SchemaError` from bad JSON text did not
  hold the text; neither is relied on, since `FormatError` keeps no cause.
- **Trace text and spans.** `HttpTraceContext.w3c` reads a valid `00-` traceparent into an `ExternalSpan` and refuses
  version `01`, a fifth part and upper-case hex. `Stream.withSpan("transport.socket")` under a tracer held in memory
  made one span, and under `Effect.withTracerEnabled(false)` made none. A span from Effect's own tracer has a 32-digit
  trace id and a 16-digit span id.

## How others do it

- **Elm** (from memory, not fetched): a port carries a `Json.Encode.Value` out and a `Json.Decode.Value` in, and the
  decoder is apart from the port; a value that does not fit is an `Err`, never a crash. That is `encode` and `decode`
  apart from `socket`, and `FormatError` in place of a defect.
- **Erlang/OTP** (from memory, not fetched): `gen_tcp`'s `{packet, N}` frames bytes and knows nothing of their meaning,
  and `term_to_binary` is the format, apart from the socket. Cowboy's WebSocket handler gets one `{text, Data}` frame per
  call. That is a frame as one text, and `Format` apart from `Socket`.
- **Effect** (read in 4.1.3): `Socket` is a reader and a writer, `Socket.toChannelString` turns it into a two-way channel
  of text frames, and every socket Layer (`NodeSocket.layerWebSocket`, `Socket.layerWebSocket`, the browser's) gives the
  same service. `RpcSerialization` keeps the wire format apart from the socket and owns the value codec (`codecFor`,
  `Schema.toCodecJson` for JSON). Its `jsonRpc` is built for `RpcMessage` envelopes (requests, exits, chunks) and writes
  the trace as its own `traceId`, `spanId` and `sampled` keys, so Transport takes its shape (a service with `codecFor`)
  and not the module. In Effect 4 a socket's pull never ends: a clean close is a `SocketCloseError` with code 1000.
  Effect 3's socket channel ended cleanly on a normal close (from memory, not fetched).
- **JSON-RPC 2.0** (from memory, not fetched): a notification is a request with no `id` member, and gets no answer;
  `params`, when present, must be a structured value, an object or an array. So a value whose JSON is a bare string or
  number cannot be `params` itself.
- **W3C Trace Context** (from memory, not fetched): `traceparent` is `version-traceid-parentid-flags` in lower-case hex,
  an all-zero trace id or span id is invalid, and a receiver drops `tracestate` when `traceparent` is invalid.
- **MCP's draft spec**, as the owner's answer cites it (https://modelcontextprotocol.io/specification/draft/basic/index,
  not fetched again): `params._meta` holds `traceparent` and `tracestate`.
- **OpenTelemetry messaging** (from memory, not fetched): the producer puts the trace context on each message, and the
  consumer makes its own span pointing at it. Transport carries the context and leaves the consumer's span to the
  caller (2067's `serve` makes it).

## The shape

### The package

```text
kalfa/transport/
  package.json        @kalfa/transport, private; exports ".", "./memory", "./package.json"; no build step, as @kalfa/git
  tsconfig.json       as kalfa/git's, with the Effect checks
  README.md           the chain, Format and its JSON-RPC frame, the trace, the memory pair, what never shows a frame
  GLOSSARY.md         unchanged
  src/
    index.ts          the root entry point: Frame, Format, FormatError, Traced, Transport
    Frame.ts          Frame
    Format.ts         the Format service, Notification, FormatError, TraceState, layerJsonRpc
    internal/jsonRpc.ts  the JSON-RPC 2.0 frame: its Schema, write, read, traceparent and tracestate
    Traced.ts         Traced<A>
    Transport.ts      encode, decode, encodeTraced, decodeTraced, socket
    MemorySocket.ts   the /memory entry point: pair
```

```jsonc
// kalfa/transport/package.json, a sketch. No dependencies and no optional peers: /test (2071) adds vitest peers.
{
  "name": "@kalfa/transport", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "typecheck": "tsc --noEmit" },
  "exports": { ".": "./src/index.ts", "./memory": "./src/MemorySocket.ts", "./package.json": "./package.json" },
  "peerDependencies": { "effect": "catalog:" },
  "devDependencies": { "@effect/platform-node, @effect/vitest, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

### Frame, Traced and Format

```ts
// kalfa/transport/src/Frame.ts, Traced.ts and Format.ts, a sketch. Doc blocks left out.
/** One piece of text on a socket, holding one message of the format. Any text read from a socket is a frame. */
export type Frame = string

export interface Traced<A> {
  readonly value: A
  readonly trace: Option.Option<Tracer.ExternalSpan>
}

/** What a format carries in one frame: JSON-RPC's notification, in words any format can hold. */
export interface Notification {
  readonly method: string
  readonly value: unknown                          // already written by codecFor
  readonly trace: Option.Option<Tracer.ExternalSpan>
}

export class FormatError extends Schema.TaggedError<FormatError>()("FormatError", {
  // text: not the format's text at all; message: the format's text but not one notification;
  // method: a notification with another method; value: a value that does not fit the schema, either way.
  reason: Schema.Literals(["text", "message", "method", "value"]),
}) {}

/** The W3C tracestate a trace carried, kept in the ExternalSpan's annotations. */
export class TraceState extends Context.Service<TraceState, string>()("@kalfa/transport/TraceState") {}

export class Format extends Context.Service<Format, {
  readonly codecFor: <S extends Schema.Top>(schema: S)
    => Schema.Codec<S["Type"], unknown, S["DecodingServices"], S["EncodingServices"]>
  readonly write: (notification: Notification) => Effect.Effect<Frame, FormatError>
  readonly read: (frame: Frame) => Effect.Effect<Notification, FormatError>
}>()("@kalfa/transport/Format") {
  /** JSON-RPC 2.0: codecFor is Schema.toCodecJson; one notification per frame; the trace under params._meta. */
  static readonly layerJsonRpc: Layer.Layer<Format>
}
```

`Format` is Effect's `RpcSerialization` shape cut to what a value stream needs: the format owns how a value becomes
data (`codecFor`) and how data becomes a frame (`write`, `read`). A binary or line format replaces all three, and the
stream functions do not change (F5). `FormatError` keeps no cause and no text, on purpose, against the pattern
`effect-errors-keep-their-cause.md`: a frame can hold the app's sign-in proof (2068), and a `SchemaError`'s issue can
quote the value it refused (85%). The X laws hold this.

### The JSON-RPC 2.0 frame

```ts
// kalfa/transport/src/internal/jsonRpc.ts, a sketch.
const Meta = Schema.Struct({                       // read leniently: anything else in _meta is ignored
  traceparent: Schema.optionalKey(Schema.Unknown),
  tracestate: Schema.optionalKey(Schema.Unknown),
})
const Frame = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.String,
  params: Schema.Struct({ value: Schema.Json, _meta: Schema.optionalKey(Schema.Unknown) }),
})
// write: { jsonrpc: "2.0", method, params: { value, _meta?: { traceparent, tracestate? } } } as JSON text
// read, in this order, the first refusal wins:
//   1. JSON text                                        else FormatError "text"      (class f)
//   2. one object, jsonrpc "2.0", method a string        else FormatError "message"   (class g)
//   3. no own `id`, `result` or `error` key              else FormatError "message"   (class h)
//   4. params an object with an own `value` key          else FormatError "message"   (class i)
//   then encode/decode compare the method                else FormatError "method"    (class j)
//   then the schema decodes the value                    else FormatError "value"     (class k)
// _meta: traceparent read with HttpTraceContext.w3c; a bad one or a bad _meta is no trace, never an error (class m).
//   tracestate kept only beside a valid traceparent, as text of 1 to 512 printable ASCII characters (class n).
```

The value sits under `params.value`, never spread into `params` (85%): JSON-RPC's `params` must be an object or an
array, so a bare string or number has nowhere else to go (class b), and a value with its own `_meta` key keeps it
(class c). Extra top-level keys are ignored, as Effect's `Schema.Struct` does by default (80%); `id`, `result` and
`error` are refused because they make the frame a request or an answer, which is not a value (0016).

### The stream functions

```ts
// kalfa/transport/src/Transport.ts, a sketch.
export const encode: <S extends Schema.Top>(schema: S) =>
  <E, R>(values: Stream.Stream<S["Type"], E, R>) =>
    Stream.Stream<Frame, E | FormatError, R | Format | S["EncodingServices"]>

export const decode: <S extends Schema.Top>(schema: S) =>
  <E, R>(frames: Stream.Stream<Frame, E, R>) =>
    Stream.Stream<S["Type"], E | FormatError, R | Format | S["DecodingServices"]>

export const encodeTraced: <S extends Schema.Top>(schema: S) =>
  <E, R>(values: Stream.Stream<Traced<S["Type"]>, E, R>) =>
    Stream.Stream<Frame, E | FormatError, R | Format | S["EncodingServices"]>

export const decodeTraced: <S extends Schema.Top>(schema: S) =>
  <E, R>(frames: Stream.Stream<Frame, E, R>) =>
    Stream.Stream<Traced<S["Type"]>, E | FormatError, R | Format | S["DecodingServices"]>

export const socket: <E, R>(out: Stream.Stream<Frame, E, R>) =>
  Stream.Stream<Frame, E | Socket.SocketError, R | Socket.Socket>
```

- `encode` is `Stream.mapEffect` of `codecFor(schema)`'s encode, then `write` with method `"value"` and no trace. A
  failed encode is `FormatError "value"`. `encodeTraced` passes the value's trace.
- `decode` is `Stream.mapEffect` of `read`, the method compare, then `codecFor(schema)`'s decode. It drops the trace;
  `decodeTraced` keeps it. Each frame is read alone: nothing is kept from one frame to the next, and no journal.
- `socket` reads `Socket.Socket`, pipes `out` through `Socket.toChannelString(socket)` with `Stream.pipeThroughChannel`,
  turns a `SocketCloseError` with code 1000 into a clean end of its stream (`Stream.catchIf`), and wraps it all in
  `Stream.withSpan("transport.socket")`. Reading and writing run at once, as Effect's channel forks the writer, so the
  socket is two-way and never a request and its answer (0016). When `out` ends, nothing is closed: the far end may still
  send. The socket closes, with code 1000, when the chain's scope ends.
- These are plain functions of streams, with no state and no journal, so a socket sits in a program chain as a stage
  (the cut line 1767 answers).

A schema's needs are part of the type (D2): the ticket's sketch writes `R | Format`, which holds for a schema with no
services, and this plan adds `S["EncodingServices"]` and `S["DecodingServices"]` so the type holds for every schema.
The run-time guard beside it is Effect's own JSON codec: a loose schema (`Schema.Unknown`, `Schema.Any`) whose value is
no JSON fails `encode` with `FormatError "value"`, never a frame with a hole and never a defect (F4).

A clean close ends the stream (80%): a program chain ends with `Stream.runDrain`, and a chain that always failed at its
end would make every caller catch a `SocketError` that means "done". 2071 asks for "a close seen by both ends" apart
from "a failure ending the stream as `SocketError`", which this keeps apart. Only code 1000, RFC 6455's normal close,
is clean; 1001 (going away) and the rest stay errors, for the caller to read.

No span for `encode` and `decode` (85%): they run once per value, and Effect's own guide asks for `Effect.fnUntraced`
on hot paths. The ticket names one span, `transport.socket`. It carries no attributes in this slice.

### The memory pair

```ts
// kalfa/transport/src/MemorySocket.ts, a sketch.
/** Two joined sockets: what one end writes, the other end reads, in order. Closed when the scope ends. */
export const pair: Effect.Effect<readonly [Socket.Socket, Socket.Socket], never, Scope.Scope>
```

Each end is `Socket.make` over an unbounded `Queue` for the other end's writes, and keeps Effect's reader contract:

- `reader` opens the end at once; its `pull` takes one or more frames, in the order written, text or bytes as written.
- Closing an end's reader scope, or writing a `CloseEvent`, closes it: a pull waiting on that end fails, and the other
  end reads every frame written before, then fails with `SocketCloseError` of that code and reason (1000 for a scope).
- A write to a closed end fails with `SocketError` of `SocketWriteError`, never dropped in silence.

No capacity setting (90%): a browser's `WebSocket.send` has no backpressure either, and a test stand-in has no person to
pick one. 2071's laws may tighten the memory pair; this ticket only needs order, both ways and the close.

## One value traced: a progress value crosses the memory pair, then a bad frame comes back

1. The left end's stage emits `{ _tag: "Progress", done: 3, of: 10 }`, traced with the span `0af7...319c` /
   `b7ad...3331`, sampled.
2. `encodeTraced(Progress)`: `codecFor` gives `{ "_tag": "Progress", "done": 3, "of": 10 }`; `write` gives the frame
   `{"jsonrpc":"2.0","method":"value","params":{"value":{"_tag":"Progress","done":3,"of":10},"_meta":{"traceparent":"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"}}}`.
3. `socket` on the left writes the frame to the pair; the right end's `socket` reads it while its own stage is still
   sending. A `transport.socket` span runs on each end, and neither holds the frame.
4. `decodeTraced(Progress)` on the right: `read` passes steps 1 to 4, the method is `"value"`, the schema decodes the
   value, `_meta.traceparent` reads as an `ExternalSpan` with the same ids and `sampled: true`. Out comes
   `{ value: Progress 3 of 10, trace: Some(...) }`.
5. The right end sends back `{"jsonrpc":"2.0","method":"value","params":{"value":{"_tag":"Progress","done":"three"}}}`.
   The left end's `decode` reads it, the schema refuses `"three"`, and the stream fails with `FormatError { reason:
   "value" }`: no text, no cause, so the rendered error, the span's failure and every log line hold neither the frame
   nor the value.
6. The left chain's scope ends, the left socket closes with 1000, and the right end's `socket` stream ends cleanly
   after the frames written before the close.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/transport/src/Transport.test-support.ts`, as the sibling packages
have them, so the package needs no fast-check. Each law applies to each drawn value one value made for every class it
names, so every class is reached in every run. Each class that targets a check passes every check before it, in the
order under "The JSON-RPC 2.0 frame".

- `values` (what a stage sends, under a test union schema): (a) strings with quotes, backslashes, CR and LF, U+0000 to
  U+001F, U+2028 and U+2029, letters past ASCII, an emoji and a lone surrogate; (b) values whose JSON is not an object:
  a bare string, a number, `true`, `null`, an array; (c) objects with their own `_meta`, `traceparent`, `jsonrpc`,
  `method`, `id` and `params` keys; (d) values that need Effect's JSON codec: `BigInt`, `Uint8Array`, `NaN` and
  `Infinity` (never `-0`, which Effect's codec writes as `0`).
- `looseValues`: (e) under `Schema.Unknown`, a function, a symbol, a cycle, a `Map`, and `undefined` inside an array.
- `frames` (what `decode` reads): (f) text that is no JSON: empty, cut off, a lone `{`, two JSON texts in one frame;
  (g) JSON that is not one notification: an array (a batch), a number, `null`, an object with no `jsonrpc` or with
  `"1.0"`, a method that is no string; (h) a notification of the right shape plus an own `id` (a number, a text and
  `null`), or plus `result` or `error`; (i) the right `jsonrpc`, method and no `id`, with `params` missing, an array, a
  string, or an object with no own `value`; (j) a notification right in every way with the method `challenge`, `hello`,
  `ping` or `Value`; (k) a notification right in every way whose value the schema refuses: a wrong type, an unknown
  `_tag`, a missing field.
- `traces`: (l) valid traceparents, sampled `01` and `00`, each with no tracestate and with a valid one; (m) invalid
  traceparents in an otherwise valid frame: version `01` and `ff`, a fifth part, upper-case hex, an all-zero trace id,
  an all-zero span id, a short id, a number in place of the text, and `_meta` as `null`, a string or an array;
  (n) tracestate with no traceparent, beside an invalid one, of 513 characters, and holding a control character;
  (o) `ExternalSpan`s to write: 32 and 16 digits, a 16-digit trace id, and ids with a capital letter, a dash or the
  wrong length.
- `traffic` (both ends of the pair): (p) both ends sending 0 to 50 values at once, one end sending none, and lockstep,
  where an end sends its next value only after it read the other end's last; (q) the closing end's code: 1000, 1001,
  1006, 1011 and 4000 to 4999, with and without a reason; (r) the left stage failing with its own error after 0 to 10
  values; (s) runs of one value repeated; (u) the far end writing UTF-8 bytes in place of text, a character cut across
  two writes included.
- `secretFlows`: (t) a generated secret text placed in a value (success), in the text of a refused frame (f), in a value
  the schema refuses (k), and in frames sent before a socket fails (q); inspected as is, JSON-escaped, base64, base64url
  and `encodeURIComponent`.

No law runs on real time under `TestClock`. A lockstep law that a request-then-answer socket would stall runs the chain
forked and moves `TestClock` past a timeout, never a real wait. W1 alone runs under `it.live`, since it opens a real
socket.

## Laws

Run caps: every property law runs 100 to 300 runs, in memory, under `it.effect`. The tests step reports any law over
10 s and lowers its runs, never its classes. Each `*.types.test.ts` file also runs under vitest, so it holds no
`declare const`: it builds real values and runs them, or wraps its lines in a function it never calls.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| P1, the manifest: no dependencies; the one peer `effect`; exports `.`, `./memory` and `./package.json`, each a file; no package of this repo and no `@demlik/` package named anywhere in it | test | scenario: the package's own manifest at head; no generated input says what a manifest holds | add `@kalfa/config` to the dependencies: red; add `@demlik/tea` to the dev dependencies: red; drop `./memory`: red | kalfa/transport/src/Package.test.ts |
| E1, Transport's own failures: no export of either entry point, no member of an exported module and no error `_tag` is named `Unreachable` or `TransportUnavailable`, and `FormatError` is the one error class the package defines | test | scenario: the two entry points' module objects at head | rename `FormatError` to `TransportUnavailable`: red; export an `Unreachable` class from `Format.ts`: red | kalfa/transport/src/Package.test.ts |
| L1, imports: in the package's product files, every `@kalfa/`, `@kampus/`, `@tea-fabrika/` and `@demlik/` package, Telemetry (`@opentelemetry/**`, `@effect/opentelemetry`), a platform package, `@effect/vitest`, `vitest`, `fast-check`, a Node module under either spelling and a path out of the package are refused; tests and test support are left out | lint | lint | in turn: import `@kalfa/config` in `Format.ts`, `@demlik/tea` in `Traced.ts`, `@effect/opentelemetry` in `Transport.ts`, `@effect/platform-node` in `MemorySocket.ts`, `node:events` in `MemorySocket.ts`: lint red each time, then undone | .oxlintrc.json |
| L2, the format stays apart: `Transport.ts` and `MemorySocket.ts` import no `./internal/jsonRpc.ts`, and `MemorySocket.ts` imports no `./Format.ts` and no `./Transport.ts` | lint | lint | import `./internal/jsonRpc.ts` in `Transport.ts` and call its writer: lint red; import `./Format.ts` in `MemorySocket.ts`: lint red | .oxlintrc.json |
| L3, the rank: `kalfa-transport` is a layer-rules row at layer 0 that imports nothing, a boundary row that imports nothing, and `kalfa/transport/src` is a root in both; the layers test pins it at 0 with its reason | test | pinned: the two rule files at head | write layer 1: the pin is red; drop the boundary row: the boundary-and-layer law is red | oxlint-plugins/layers.test.ts |
| D1, the three functions' types: for a schema with no services, `encode` gives `Stream<Frame, E \| FormatError, R \| Format>`, `socket` gives `Stream<Frame, E \| SocketError, R \| Socket.Socket>` with Effect's own `SocketError`, and `decode` gives `Stream<A, E \| FormatError, R \| Format>`; no journal and no other service is needed | type | type | type `socket`'s errors as `SocketError` alone, dropping `E`: red; drop `Format` from `encode`'s needs: red | kalfa/transport/src/Transport.types.test.ts |
| D2, a value type from a schema holds for every way the schema is typed: a struct, a tagged union, a schema that needs a decoding service and one that needs an encoding service (each need shows in `R`), a schema typed `Schema.Top`, `Schema.Unknown`, and `any`, all compile with the types above | type | type | drop `S["EncodingServices"]` from `encode`'s needs: the encoding-service line fails, red; constrain `S` to a codec with no services: the `Schema.Top` line fails, red | kalfa/transport/src/Transport.types.test.ts |
| D3, the sketch's chain: stage, `encode`, `socket`, `decode`, stage, `Stream.runDrain`, provided one end of the memory pair and `Format.layerJsonRpc`, is `Effect<void, FormatError \| SocketError, Scope>`, and it runs, with the other end echoing | type | type | make `socket` need `Format`: the provided chain's needs are not `Scope` alone, red | kalfa/transport/src/Transport.types.test.ts |
| D4, the traced pair's types: `encodeTraced(S)` takes `Stream<Traced<S["Type"]>, E, R>`, `decodeTraced(S)` gives `Stream<Traced<S["Type"]>, ...>`, both need `Format` and add `FormatError`, and `Traced`'s trace is `Option<Tracer.ExternalSpan>` | type | type | type `decodeTraced` as giving `S["Type"]`: red; type the trace as `Tracer.AnySpan`: red | kalfa/transport/src/Transport.types.test.ts |
| F1, one value, one frame: for each value of (a) to (d), `encode` gives exactly one frame; the frame parses as one object with `jsonrpc` `"2.0"`, `method` `"value"`, `params` an object whose `value` is `Schema.toCodecJson`'s writing of the value, and no other `params` key than `value` and `_meta`; it has no `id`, `result` or `error`. 300 runs | test | Effect Arbitrary: values | spread the value into `params`: (b) red; merge `_meta` into the value's own object: (c) red; `JSON.stringify` the value without `codecFor`: (d) red; join two values into one frame: red; write an `id`: red | kalfa/transport/src/Format.test.ts |
| F2, the round trip: for a sequence of values of (a) to (d), `decode(S)` of `encode(S)` gives the same values in the same order, equal by `Schema.toEquivalence(S)`. 300 runs | test | Effect Arbitrary: values | build the frame text by joining strings with hand-written quotes: (a) red; drop the `BigInt` codec: (d) red | kalfa/transport/src/Format.test.ts |
| F3, refused frames: each frame of (f) fails `decode` with `FormatError "text"`, (g), (h) and (i) with `"message"`, (j) with `"method"` and (k) with `"value"`; none is a defect, and the stream gives no value for it. 300 runs | test | Effect Arbitrary: frames | `JSON.parse` with no catch: (f) is a defect, red; take a batch's first element: (g) red; skip the own-key `id` read: (h) red; take a missing `params.value` as `null`: (i) red; skip the method compare: (j) red; decode the value with `Schema.Unknown`: (k) red | kalfa/transport/src/Format.test.ts |
| F4, a loose schema fails loudly: for each value of (e) under `Schema.Unknown`, `encode` fails with `FormatError "value"`, writes no frame, and is no defect. 100 runs | test | Effect Arbitrary: looseValues | catch the encode failure and write `null` in its place: (e) red; skip `codecFor` and `JSON.stringify` the value: `undefined` in an array becomes `null`, (e) red | kalfa/transport/src/Format.test.ts |
| F5, the format is a service: with the line format from `Transport.test-support.ts` in place of `Format.layerJsonRpc`, the chain over the memory pair gives the values of (a) to (d) back, and no frame it wrote parses as JSON-RPC; the stream functions are the same imports. 200 runs | test | Effect Arbitrary: values | make `encode` call the JSON-RPC writer in place of `Format`'s `write`: red (and L2 lint red) | kalfa/transport/src/Format.test.ts |
| T1, the trace is written and read: `encodeTraced` then `decodeTraced` over each trace of (l) gives the same trace id, span id, sampled flag and tracestate; the frame's `params._meta.traceparent` is `00-<trace>-<span>-<01 or 00>` and `tracestate` is there only when the trace had one; a `None` trace writes no `_meta` trace key; for (o), a 16-digit trace id is written padded to 32 and reads back padded, and an id that is no W3C id writes no trace key. 300 runs | test | Effect Arbitrary: traces | write the sampled flag as `01` always: (l) red; write an empty `tracestate` when there is none: (l) red; write a capital-letter id as given: (o) red, since the writer promised a trace the reader drops | kalfa/transport/src/Trace.test.ts |
| T2, plain and broken traces: plain `encode` writes no `_meta` trace key for any value; plain `decode` of a frame of (l) gives the value and drops the trace; a frame of (m) reads as its value with no trace, never a `FormatError`; for (n) the tracestate is dropped, and a valid traceparent beside it still reads. 300 runs | test | Effect Arbitrary: traces | fail with `FormatError` on a bad traceparent: (m) red; accept an all-zero trace id: (m) red; keep a tracestate whose traceparent is invalid: (n) red; make plain `encode` write the current span: red | kalfa/transport/src/Trace.test.ts |
| T3, the ticket's check: a value traced with the ids of a span made by Effect's tracer crosses the memory pair, and the far end's `decodeTraced` reads the same trace id and span id. 100 runs | test | Effect Arbitrary: values | make `decodeTraced` give a new span id: red | kalfa/transport/src/Trace.test.ts |
| C1, two ways at once, in order: for (p) over the memory pair, each end reads exactly what the other end sent, in order, while it is still sending; the lockstep run ends (a forked run, `TestClock` moved past a timeout) | test | Effect Arbitrary: traffic | make `socket` drain `out` before it reads, a request and then its answer: the lockstep run stalls, (p) red; make the pair deliver an end's writes to its own reader: red | kalfa/transport/src/Socket.test.ts |
| C2, a close: when the far end closes with code 1000 the near end's `socket` stream ends cleanly after every frame written before the close; with any other code of (q) it fails with Effect's `SocketError` holding `SocketCloseError` of that code and reason. 200 runs | test | Effect Arbitrary: traffic | end cleanly on every code: (q) red; fail on 1000: (q) red; drop the frames waiting when the close came: red | kalfa/transport/src/Socket.test.ts |
| C3, the caller's failure stays the caller's: for (r), the chain fails with the stage's own error, not a `SocketError`, and the far end sees the close. 100 runs | test | Effect Arbitrary: traffic | wrap the stage's error in a `SocketError`: (r) red | kalfa/transport/src/Socket.test.ts |
| C4, no state between frames: for (s) and the values of (a), decoding a run of frames in one stream gives the same values as decoding each frame in a stream of its own, repeats included. 200 runs | test | Effect Arbitrary: traffic | skip a value equal to the one before it: (s) red | kalfa/transport/src/Socket.test.ts |
| C5, bytes from the far end: for (u), frames written as UTF-8 bytes arrive at `socket`'s output as the same text, one frame each. 100 runs | test | Effect Arbitrary: traffic | build `socket` on `Socket.toChannel` and turn each chunk into text with `String()`: (u) red | kalfa/transport/src/Socket.test.ts |
| M1, the memory pair keeps Effect's reader contract: closing an end's reader scope fails a pull waiting on that end and gives the far end close 1000 after its waiting frames; a `CloseEvent` write gives its code and reason; a write to a closed end fails with `SocketError` of `SocketWriteError`. 200 runs | test | Effect Arbitrary: traffic | let a write after close succeed and drop the frame: red; leave a waiting pull blocked when its scope closes: red; give the far end code 1006 for a closed scope: red | kalfa/transport/src/MemorySocket.test.ts |
| S1, the span: each running `socket` makes exactly one span named `transport.socket` in a tracer held in memory, ended when its stream ends, with a failure status holding `SocketError` for a code of (q) other than 1000, and none for 1000; `encode` and `decode` make none. 100 runs | test | Effect Arbitrary: traffic | name it `transport.stream`: red; make one span per frame: red; make a span in `decode`: red | kalfa/transport/src/Spans.test.ts |
| S2, the tracer off: the whole chain of D3 under `Effect.withTracerEnabled(false)` leaves the tracer held in memory empty. 100 runs | test | Effect Arbitrary: traffic | provide a tracer of its own inside `socket`: red | kalfa/transport/src/Spans.test.ts |
| X1, [secrets] spans hold no frame: for every flow of (t), no span name, attribute, event or failure text as Effect's tracer writes it (the error's `message` and `Cause.pretty` with its stack) holds the secret in any form. 300 runs | test | Effect Arbitrary: secretFlows | annotate the span with each frame: (t) red; add a span event naming the refused frame: (t) red | kalfa/transport/src/Leak.test.ts |
| X2, [secrets] logs hold no frame: for every flow of (t), no line at any level of a recording logger holds the secret in any form. 300 runs | test | Effect Arbitrary: secretFlows | `Effect.logDebug` the frame text on a `FormatError`: (t) red | kalfa/transport/src/Leak.test.ts |
| X3, [secrets] errors hold no frame: for each failed flow of (t), `Cause.pretty` of the exit with its stack, `String`, `JSON.stringify` and `Inspectable.format` of the failure, every text reachable from its own properties, and its `cause` chain hold the secret in no form. 300 runs | test | Effect Arbitrary: secretFlows | keep the `SchemaError` as `FormatError`'s cause: (t) red; put the frame text in `FormatError`'s message: (t) red | kalfa/transport/src/Leak.test.ts |
| W1, the same chain on Effect's own Node WebSocket Layer: a server from `NodeSocketServer.layerWebSocket` on `127.0.0.1`, port 0, runs `decodeTraced`, a stage and `encodeTraced` through `socket` for each accepted socket; a client on `NodeSocket.layerWebSocket` sends values of (a) to (d) with traces and reads the stage's answers in order with the same trace ids, then closes, and both chains end cleanly; no Transport code for Node exists. 5 runs under `it.live`, under 10 s in all | test | Effect Arbitrary: values | build `socket` on `Socket.toChannel` and turn each chunk into text with `String()`: red; send each batch as one joined text with `writeAll`: red | kalfa/transport/src/NodeWebSocket.integration.test.ts |

### Each acceptance criterion and its law

| Ticket's criterion | Laws |
|---|---|
| `encode`, `socket`, `decode` are plain stream functions with the sketched types, `Format` and `FormatError`, Effect's `Socket.Socket` and `SocketError` | D1, D2 |
| no state between frames, no journal | C4, D1 |
| one value is one frame, one JSON-RPC 2.0 notification with schema-tagged JSON inside | F1, F2 |
| values flow both ways at once on the memory pair, in order | C1, M1 |
| not JSON-RPC, or not the schema, fails `decode` with `FormatError`, never a defect | F3, F4 |
| a test Layer for `Format` replaces JSON-RPC with no change to the stream functions | F5, L2 |
| the same chain over Effect's own Node WebSocket Layer against a local server | W1 |
| a chain shaped like the sketch type-checks and runs | D3 |
| the core imports none of Ledger, Program, Identity or Permissions, and no type names tea | L1, P1 |
| no error named `Unreachable` or `TransportUnavailable` | E1 |
| `encodeTraced` and `decodeTraced` with `Traced<A>`, needing `Format`, adding `FormatError` | D4 |
| `Format` writes and reads the trace under `params._meta`, `traceparent` and `tracestate`; no trace, no keys | T1 |
| plain `encode` writes no trace, plain `decode` drops one, a bad `traceparent` is no trace | T2 |
| a `Traced` value with a span crosses the memory pair with the same ids | T3 |
| a `transport.socket` span with Effect's own calls, no Telemetry import, read from a tracer in memory, no frame text | S1, L1, X1 |
| with the tracer off the chain makes no span | S2 |

### The host-only law

W1 opens a real socket on the machine, so it is `kalfa/transport/src/NodeWebSocket.integration.test.ts`. No stand-in
will do: the ticket asks for Effect's own Node WebSocket Layer against a real server, and the point is that Transport
needs no Node code there. Every behavior W1 touches is proved first on the memory pair (C1 to C5, F2, T3), and W1 is the
thin check that the real Layer matches it. The laptop refuses it by name (`vitest.hostrun.ts`), so it never runs there
narrowly: the lead's proof run starts it before the first review, in CI, and it runs in CI's full run after. It needs no
signal, no launchd entry and no run on the owner's Mac. It binds `127.0.0.1` and port 0, so two runs never clash.

## Lint

The tests step adds `kalfa/transport/src/**` to the kalfa Effect block of `.oxlintrc.json` (its `files` list beside
`kalfa/git/src/**`), and one override for the package modeled on `@kalfa/git`'s, holding L1 and L2. An override
replaces a rule's options, so it repeats the base entries, as `@kalfa/git`'s does. Tests, `*.test-support.ts` and the
integration file are left out of the override.

## Where the rank is written

`@kalfa/transport` imports no kalfa package, so it ranks at layer 0, beside Source control. `kalfa/AGENTS.md` gets one
sentence: Transport imports no kalfa package and ranks lowest. When 2069 makes it read the ping interval through
`@kalfa/config`, it moves to layer 2, which is 2069's change.

## Is this a setting?

- The method word `"value"`, the clean close code 1000, and the `traceparent` and `tracestate` rules: not settings. They
  are the wire, which both ends must agree on, so a settings file on one end could only break it.
- Which format a place uses: not a setting. It is a Layer joined at the top beside the socket Layer, as decision 0039
  says, and a test passes its own.
- The memory pair's capacity: there is none to set (see the memory pair).
- The ping interval, and a wait for the first frame: settings, but 2069's.

## What fact is lost if it is not recorded now

- **The sender's trace on each frame.** This ticket records it, under `params._meta`. A frame sent without it can never
  be joined to its sender's spans later, and the far Ledger's stamps (1902's reason) start new traces.
- **How many frames a socket carried, and their size.** Not recorded: the span has no attributes in this slice. Nothing
  rebuilds them later, but before v0.0.0 there is no data to keep, and a later ticket can add them as span attributes
  (`## Findings` 2).
- **Why a socket closed.** A close other than 1000 is the span's failure, with its code and reason. A clean close
  records nothing more; the reason text of a clean close is the far end's, and may be the app's own words.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/transport/src/index.ts | build | 8 | new: the root entry point: `Frame`, `Format`, `FormatError`, `Traced`, and `Transport` as a module |
| kalfa/transport/src/Frame.ts | build | 6 | new: `Frame` |
| kalfa/transport/src/Format.ts | build | 45 | new: `Format`, `Notification`, `FormatError`, `TraceState`, `layerJsonRpc` |
| kalfa/transport/src/internal/jsonRpc.ts | build | 80 | new: the JSON-RPC 2.0 frame Schema, `write`, `read` in its four steps, the trace's text both ways |
| kalfa/transport/src/Traced.ts | build | 10 | new: `Traced` |
| kalfa/transport/src/Transport.ts | build | 65 | new: `encode`, `decode`, `encodeTraced`, `decodeTraced`, `socket` |
| kalfa/transport/src/MemorySocket.ts | build | 70 | new: `pair` |
| kalfa/transport/README.md | build | docs | new: the chain, `Format` and the JSON-RPC frame, the trace, the memory pair, what never shows a frame, `-0` |
| kalfa/AGENTS.md | build | docs | the rank sentence |
| kalfa/transport/package.json | tests | tests | new: the manifest sketched above |
| kalfa/transport/tsconfig.json | tests | tests | new: as `kalfa/git`'s, with the Effect checks |
| package.json | tests | tests | `"@kalfa/transport": "workspace:*"` beside the other kalfa packages |
| pnpm-lock.yaml | tests | tests | the new importer, written by one `pnpm install --offline` |
| .oxlintrc.json | tests | tests | L1 and L2: the kalfa Effect block's files and the package's override |
| layer-rules.json | tests | tests | L3: `kalfa-transport` at layer 0, importing nothing; the root `kalfa/transport/src` |
| boundary-rules.json | tests | tests | L3: `kalfa-transport` imports nothing; `kalfa/transport` is `kalfa-transport` |
| oxlint-plugins/layers.test.ts | tests | tests | L3: `"kalfa-transport": 0`, with its reason comment |
| oxlint-plugins/law-ids.ts | tests | tests | no change: ran clean while planning; the tests step runs it again |
| vitest.config.ts | tests | tests | no change: its kalfa globs already run the new unit and integration files |
| kalfa/transport/src/Transport.test-support.ts | tests | tests | the generators, the line format for F5, a tracer and a logger held in memory, the secret forms |
| kalfa/transport/src/Package.test.ts | tests | tests | P1, E1 |
| kalfa/transport/src/Transport.types.test.ts | tests | tests | D1 to D4 |
| kalfa/transport/src/Format.test.ts | tests | tests | F1 to F5 |
| kalfa/transport/src/Trace.test.ts | tests | tests | T1 to T3 |
| kalfa/transport/src/Socket.test.ts | tests | tests | C1 to C5 |
| kalfa/transport/src/MemorySocket.test.ts | tests | tests | M1 |
| kalfa/transport/src/Spans.test.ts | tests | tests | S1, S2 |
| kalfa/transport/src/Leak.test.ts | tests | tests | X1 to X3 |
| kalfa/transport/src/NodeWebSocket.integration.test.ts | tests | tests | W1 |

## Existing tools

- `kalfa/transport/src/index.ts`: searched `kalfa/git`'s and `kalfa/config/src/index.ts`'s roots (a root that re-exports
  modules; followed).
- `kalfa/transport/src/Frame.ts`: searched Effect's `Socket` frame type (`Uint8Array | string`, both kinds; Transport's
  frame is text, as the glossary says) and a branded `Schema.String` (no rule tells one text from another, so a brand
  guards nothing; not used).
- `kalfa/transport/src/Format.ts`: searched Effect's `RpcSerialization` service (its shape followed: a service with
  `codecFor`; its `Parser` is stateful and built for `RpcMessage` envelopes, so not used) and `Schema.TaggedError` (used).
- `kalfa/transport/src/internal/jsonRpc.ts`: searched `RpcSerialization.jsonRpc` (writes the trace as its own keys and
  reads `RpcMessage`s; not used), `Schema.UnknownFromJsonString`, `Schema.Json` and `Schema.toCodecJson` (used), Effect's
  `HttpTraceContext.w3c` (used to read `traceparent`), `HttpTraceContext.toHeaders` (takes a whole `Span` and adds B3;
  the write is one template line instead), and npm's `@opentelemetry/core` W3C propagator (a Telemetry import, refused
  by decision 0063).
- `kalfa/transport/src/Traced.ts`: searched Effect's `Tracer.ExternalSpan` (used as the trace) and a `Traced` in the repo
  (none).
- `kalfa/transport/src/Transport.ts`: searched `Socket.toChannelString`, `Stream.pipeThroughChannel`, `Stream.mapEffect`,
  `Stream.catchIf` and `Stream.withSpan` (all used), Effect's `Ndjson` and `ChannelSchema` (they frame a byte stream,
  and a socket frames already; not used), and `RpcClient`'s socket protocol (request and answer, rejected by 0016).
- `kalfa/transport/src/MemorySocket.ts`: searched Effect 4.1.3 for a socket held in memory (none: `Socket.make` has one
  caller, `devtools/DevToolsClient.ts`), `Socket.make` and `Queue` (used), and `kalfa/git/src/MemoryRepository.ts` (a
  memory adapter of a kalfa port; followed in shape).

## Calls taken

- No build step and no `publishConfig`, as `@kalfa/git` (85%): the package is private, and publishing is recorded as
  later.
- `Format` owns `codecFor`, `write` and `read`, as Effect's `RpcSerialization` (80%); its calls return `Effect` (80%),
  so a later format may need services without a change to the stream functions.
- The value sits under `params.value` (85%); extra top-level keys are ignored (80%); `id`, `result` and `error` refuse
  the frame (85%).
- `FormatError` keeps no cause and no text (85%), against the cause pattern, for the reason under "Frame, Traced and
  Format".
- A schema's services join the stream's needs (90%): the ticket's sketch holds for a schema with none.
- A clean close (1000) ends `socket`'s stream; every other close fails it (80%).
- `encode` and `decode` make no span (85%); `transport.socket` has no attributes yet (80%).
- `_meta` is read leniently: anything there that is no valid trace is no trace (80%).
- `tracestate` is kept beside a valid `traceparent` only, as 1 to 512 printable ASCII characters (75%; see Doubts).
- The memory pair is unbounded, fails a write after close, and gives 1000 for a closed scope (85%).
- The three doubts at the top: 75%, 75%, 75%.
- No `Traced.current` helper that reads the current span into a `Traced` (75%): no criterion asks for it, and the first
  sender (Ledger's `/transport`, decision 0079) knows which span it wants. `## Findings` 1 keeps it.

## Validation

- The tests step runs its new files by path, then `pnpm format`, `pnpm lint` and `node oxlint-plugins/law-ids.ts`. It
  does not run the changed-tests command or a typecheck: the lead does. W1 does not run on the laptop.
- The build runs the same narrow files (W1 left out), `pnpm format` and `pnpm lint`. The lead runs the changed tests and
  the typecheck once at the end, outside any box, and starts the proof run that runs W1 before the first review; CI
  runs the rest.

## Size

1. Slice 1, the whole ticket: 284 lines (`internal/jsonRpc.ts` 80, `MemorySocket.ts` 70, `Transport.ts` 65, `Format.ts`
   45, `Traced.ts` 10, `index.ts` 8, `Frame.ts` 6), plus the package files, the rule rows, the lockfile and the laws.

284 product lines, about 3 agent hours, 70% sure. The doubt is the memory pair's reader contract and the close
handling in `socket`, which carry C1, C2 and M1 and may be sent back once. Budget basis: the `@kalfa/secrets` plan
priced slices of 150 to 300 lines at about $9 to $12 a step. Tests at about $12, build at about $12, review at about $8,
and one likely send-back at about $12.

Estimate: 4 steps, $44

## New names

- `encode`, `decode`, `socket`, `encodeTraced`, `decodeTraced`, `Traced`, `Format`, `Format.layerJsonRpc`,
  `FormatError`, `Frame`: the protocol's and the ticket's.
- `Notification`: JSON-RPC 2.0's word for a message with no id that gets no answer; a code name, not a domain word.
- `method`, `params`, `_meta`, `traceparent`, `tracestate`: JSON-RPC's, MCP's and W3C's keys.
- `codecFor`: Effect's `RpcSerialization` name for the same job.
- `TraceState`, `pair`, `"value"` (the method word): code names inside the package.
- No new domain word: `kalfa/transport/GLOSSARY.md` already has socket, frame and format, and trace is W3C's word.

## Records

- `kalfa/AGENTS.md` gains the rank sentence.
- The README records the chain, the JSON-RPC frame with an example, where the trace goes, the clean close, the memory
  pair, what never shows a frame, and `-0` coming back `0`.
- A decision record is the lead's call for one wire contract other clients must match: a value's frame is
  `{"jsonrpc":"2.0","method":"value","params":{"value":...}}`. This plan writes none.

## What this cannot tell us

- Nothing here was built or type-checked. The probes ran Effect's JSON codec, its W3C reader and its stream span; the
  socket, the memory pair and the types were only read.
- Whether Node's global `WebSocket` and the `ws` server pass W1 in CI under 10 s: no socket was opened while planning.
- Whether a lockstep stall shows under `TestClock` with the memory pair as cleanly as planned; the tests step finds out
  first.
- Whether `"value"` is the method outside clients want, and whether MCP's release keeps `_meta.traceparent` (it is in
  the draft only; if the release renames it, the JSON-RPC format follows).
- How a far end that sends a ping (2069) or a hello (2068) on a value stream should look to `decode`: this plan refuses
  it as `"method"`, and those plans may filter such frames inside `socket` first.
- How large a frame may get before a real socket fails: nothing here caps it, and no measurement backs a cap.

## Open questions

None.

Every doubt above picks how the code does what decisions 0016 and 0039 and the protocol already say, so the lead's
read settles it, and none goes to the owner.

## Lead's calls at signing (2026-11-23)

- Kept, each at 75%: the one method word `"value"`; `tracestate` kept inside the span's `annotations`; a short trace id left-padded with zeros (as OpenTelemetry does for 64-bit ids), while a malformed id is not written. Each has its law; a later caller that needs otherwise reopens it on 1767.

## Findings

1. **No helper turns the current span into a `Traced`.** Every sender that wants its trace carried builds an
   `ExternalSpan` from `Effect.currentParentSpan` by hand. Proof: the ticket's criteria and 1767's answers name
   `Traced` and no maker. The first sender (Ledger's `/transport`, decision 0079) should add `Traced.current(value)`, or
   ask for it here.
2. **The `transport.socket` span has no measures.** Decision 0063's "record wide" would put frame counts and bytes on
   it, and the ticket asks for none. A later Transport ticket can add `kalfa.transport.*` attributes; before v0.0.0 no
   data is lost by waiting.

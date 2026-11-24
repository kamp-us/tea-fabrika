
Plancheck-Version: 3

# Plan: @kalfa/transport/cloudflare, the gateway handles one frame at a time (ticket 2067)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2067. Its parent is the settled protocol,
https://github.com/kamp-us/tea-fabrika/issues/1767, with the owner's answers in
https://github.com/kamp-us/tea-fabrika/issues/1767#issuecomment-7084366538 and
https://github.com/kamp-us/tea-fabrika/issues/1767#issuecomment-7084402755 (the three handlers), from
https://github.com/kamp-us/tea-fabrika/issues/1902. Main already holds the core, from
https://github.com/kamp-us/tea-fabrika/pull/2219 (ticket 2066). This plan adds two entry points to the same package:
`@kalfa/transport/cloudflare` (`serve`, the held `Connection`, and the Cloudflare `Hibernation` Layer) and
`@kalfa/transport/cloudflare/memory` (a stand-in Durable Object that sleeps on demand, for tests).

It lands as two pull requests, each reviewed alone:

1. **The platform seam and the stand-in** (about 230 product lines). `Hibernation`, the `Gateway` slots type, and the
   stand-in, with the laws every Durable Object here must keep (attachments, sleep, close events), run on the stand-in
   and on real workerd. Its first law is a short probe of real workerd. It says `Part of #2067`.
2. **`serve` and the held connection** (about 295 product lines). `Connection`, the note, `serve`'s four slots, its
   spans, and the gateway law suite on both worlds. It says `Closes #2067`.

Words: `kalfa/transport/GLOSSARY.md` (connection, gateway, frame). One new domain word, **note**, is listed under
`## New names`.

```ts
// The whole idea, a sketch. Alchemy's names were read in @alchemy.run/cloudflare 2.0.0-beta.85; nothing was type-checked.
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect, Layer, Schema } from "effect"
import { Format } from "@kalfa/transport"
import { Gateway, Hibernation, serve } from "@kalfa/transport/cloudflare"

const Challenge = Schema.Struct({ nonce: Schema.String })

const handlers = serve({
  note: Challenge,                                           // the saved note's schema; optional
  open: (connection) =>                                      // optional; runs once, before any frame
    Effect.andThen(connection.save({ nonce: "n-1" }), connection.send(challengeFrame)),
  frame: (connection, frame) =>                              // required; once per frame, one at a time
    Effect.flatMap(connection.note, (nonce) => answer(connection, frame, nonce)),
  closed: (connection, event) => Effect.log(event.code),     // optional; runs once, with Effect's Socket.CloseEvent
}).pipe(Layer.provide([Format.layerJsonRpc, Hibernation.layer]))

// Any Durable Object class mounts it: the app's gateway class, the Ledger's own class (decision 0076).
export class AppGateway extends Cloudflare.DurableObject<AppGateway>()("AppGateway", Effect.gen(function* () {
  return Effect.gen(function* () {
    const gateway = yield* Gateway
    return {
      fetch: gateway.upgrade(),                              // the app routes and checks first; Transport knows no route
      webSocketMessage: gateway.webSocketMessage,
      webSocketClose: gateway.webSocketClose,
      webSocketError: gateway.webSocketError,
    }
  }).pipe(Effect.provide(handlers))
})) {}
```

## The platform questions, settled

Each was under 80% in the first draft. Each is now settled from a source, or is the first law of slice 1, a probe on
real workerd, with the design built to hold either answer.

- **When does a hibernatable socket's object sleep? After 10 seconds with no event, in production and in the local
  workerd this repo installs (90%).** Cloudflare's lifecycle page
  (https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/): "After 10 seconds of no
  incoming request or event, and all the above conditions satisfied, the Durable Object will transition into the
  hibernated state", where the conditions are no timer, no unfinished `waitUntil` or outbound I/O, no standard
  WebSocket API, and no event still running. Locally, workerd's own config schema in the installed
  `@alchemy.run/cloudflare-runtime` 2.0.0-beta.85 (`src/core/workerd/internal/config.capnp.ts`, the `preventEviction`
  field, workerd 1.20261026.1) says "By default, Durable Objects are evicted after 10 seconds of inactivity", and
  Alchemy's runtime builds each app class's namespace with no `preventEviction`
  (`src/core/Runtime.ts`, the `durableObjectNamespaces` map: `className`, `enableSql`, `uniqueKey`, `ephemeralLocal`,
  `container` only; Alchemy sets `preventEviction: true` only on its own binding objects, such as
  `src/core/bindings/kv-namespace/KvNamespace.ts`). Cloudflare's WebSocket page says local development hibernates since
  Miniflare `v3.20231016.0`. What is left, 10%: that nothing in Alchemy's dev bridge keeps an outbound call open. The
  probe R0 measures it, and the stand-in's `sleep` and every real sleep law wait for a new wake token, never a fixed
  time.
- **Does a close the server starts call `webSocketClose` in that same wake? No. The docs say it comes, if at all, as a
  later event when the client's Close frame arrives; whether the attachment is still readable then, they do not say
  (probe R0).** Cloudflare's Durable Object base page (https://developers.cloudflare.com/durable-objects/api/base/)
  says `webSocketClose` is "Called by the system when a WebSocket connection is closed" and that its `code` is the one
  "sent by the peer"; the WebSocket page
  (https://developers.cloudflare.com/durable-objects/best-practices/websockets/) says to reply with `close()` in
  `webSocketClose()` "unless you have already closed the outgoing side", so the handler is called after a server close
  too, once the peer's Close frame comes. That frame is a new event: Alchemy's bridge runs each platform call as its own
  `#execute` (`@alchemy.run/cloudflare/src/Workers/DurableObjectBridge.ts`, `webSocketClose`), so it never runs inside
  the wake that called `close`. A peer that drops instead sends no Close frame (1006). The Workers WebSocket page
  (https://developers.cloudflare.com/workers/runtime-apis/websockets/, "State and error behavior") adds that `send()`
  throws `TypeError` once the server has sent its Close frame. The attachment page says "If either side closes the
  connection, attachments are lost", without saying when. So `serve` runs `closed` itself in the wake that called
  `close` (the only way it runs once whether the later event comes or not), and marks the attachment closing first;
  a later close event that finds the mark, or finds no attachment, runs nothing. R0 records on real workerd whether the
  event comes after a server close and whether the attachment is still there in it; the stand-in copies what R0 sees,
  and G7 holds `closed` to exactly once in both cases.
- **Which span call for a connection that carries spans?** Answered under "Spans, and the connection that carries
  spans" below: every step still leaves a span; only frames of a span-carrying connection make none, as decision 0079
  and the ticket's last criterion require, and they are counted on the connection's `closed` span (85%).

## What changes, in one paragraph

A new entry point, `@kalfa/transport/cloudflare` (`src/cloudflare/index.ts`), holds `serve`, the `Gateway` service its
Layer gives, the held `Connection` with `ConnectionId`, `CloseCode` and `CloseReason`, `NoteError`, and the
`Hibernation` service with its Cloudflare Layer. A second entry point, `@kalfa/transport/cloudflare/memory`
(`src/cloudflare/MemoryGateway.ts`), is a stand-in Durable Object that keeps the platform's rules and sleeps on demand.
The same law suites run on the stand-in on every pull request and on Alchemy's local workerd in CI. `serve` reaches
Cloudflare only through Alchemy (decision 0018): no `cloudflare:*` import, no `WebSocketPair`, no raw socket. Out of
scope, each its own ticket: the hello (2068), ping and the auto response (2069), the laws every socket Layer passes
(2071), signal forwarding and the gateway relay (2072 to 2075).

## Slices

1. **Slice 1, the platform seam and the stand-in.** Branch `fabrikalfa/kalfa-transport-gateway`, this pull request,
   `Part of #2067`. `Hibernation` and `HeldSocket` (the one file that calls Alchemy), the `Gateway` service's type (its
   four slots, no `serve`), `MemoryGateway`, the `/cloudflare` and `/cloudflare/memory` entry points, the manifest, the
   lockfile and the lint overrides. Laws: R0 (the probe), M1 to M5 (the platform's rules, one suite run on the stand-in
   and on real workerd through a raw fixture), L1, L2, P1, P2 (slice 1's export list), E1, D4. What a reviewer reads
   alone: does the stand-in behave as real workerd does? Nothing in it knows of frames, notes or handlers.
2. **Slice 2, `serve` and the held connection.** Branch `fabrikalfa/kalfa-transport-gateway-serve`, from slice 1's
   merge, `Closes #2067`. `Connection`, `ConnectionId`, `CloseCode`, `CloseReason`, `NoteError`, the attachment's
   schema, and `serve`. Laws: B1, D1 to D3, D5, G1 to G12, S1, X1 to X4, I1, and P2 and E1 grown to slice 2's exports.
   What a reviewer reads alone: does `serve` meet the ticket on a platform slice 1 already proved?

Slice 1 lands first because slice 2's laws run on the stand-in slice 1 proves; the owner sees nothing new until slice
2, which is the ticket's whole behavior.

## How others do it

- **Erlang's cowboy** (from memory, not fetched): a WebSocket handler has `websocket_init`, `websocket_handle` once per
  frame and `terminate`, with the handler's state passed from call to call. A crash in a call ends the connection, and
  `terminate` still runs. That is `open`, `frame`, `closed`, the note as the state, and a failed handler closing the
  connection with `closed` run once.
- **Phoenix Channels** (from memory, not fetched): `join`, `handle_in`, `terminate`, and a small `socket.assigns` map
  kept with each connection. The note is that map, made to live through a sleep.
- **Cloudflare's Hibernation WebSocket API** (fetched, pages cited above): `acceptWebSocket`, then `webSocketMessage`,
  `webSocketClose` and `webSocketError` on the class. Memory is lost on sleep; per-socket state lives in
  `serializeAttachment`, at most 16,384 bytes, structured-cloned. A received message may be up to 32 MiB. Events wake
  the object and run its constructor again. Tests evict with `evictDurableObject` from `cloudflare:test`, which only
  `@cloudflare/vitest-pool-workers` gives (not installed here, and a `cloudflare:*` import).
- **Alchemy** (read in 2.0.0-beta.85): `Cloudflare.upgrade({ tags })` accepts a hibernatable socket and returns the 101
  response; `Cloudflare.WebSocket` wraps the platform socket with `send`, `close`, `setAttachment(schema, value)` and
  `getAttachment(schema)`, failing with `WebSocketAttachmentError`. The bridge wraps the socket anew for each event, so
  nothing may key on its identity. Alchemy's internal RPC transport (`Workers/RpcWebSocket.ts`) is the closest shape to
  ours: `make` gives a record of `fetch`, `webSocketMessage`, `webSocketClose` and `webSocketError` that the object's
  shape spreads in, keeps its id in the attachment, captures the per-instance `RuntimeContext` at build, and on its own
  close unregisters the socket at once and ignores the close event that may follow. `serve` takes that shape.
- **PartyServer** (Cloudflare's own Durable Object server library, from memory, not fetched): `onConnect`, `onMessage`,
  `onClose`, a random `connection.id`, and `connection.setState` kept in the attachment. Same three handlers, same note.
- **OpenTelemetry messaging** (from memory, not fetched): the consumer makes its own span with the producer's context as
  parent or link. 1767 rules the child; decision 0063 says a reader links by default and is a child "only on request",
  and this is that request.

## The shape

### The files

```text
kalfa/transport/src/cloudflare/
  index.ts           the /cloudflare entry point                                         slice 1, grown in slice 2
  Hibernation.ts     the Hibernation service, HeldSocket, and its Cloudflare Layer        slice 1
  Gateway.ts         the Gateway service (slice 1), and serve (slice 2)                   both
  MemoryGateway.ts   the /cloudflare/memory entry point: a stand-in Durable Object         slice 1
  Connection.ts      Connection, ConnectionId, CloseCode, CloseReason, NoteError          slice 2
  internal/held.ts   what serve keeps in a socket's attachment                            slice 2
```

### Hibernation, the one place that touches Alchemy (slice 1)

```ts
// kalfa/transport/src/cloudflare/Hibernation.ts, a sketch.
/** What a gateway needs of a held socket: four calls of Alchemy's Cloudflare.WebSocket, and nothing of the raw one. */
export type HeldSocket = Pick<Cloudflare.WebSocket, "send" | "close" | "getAttachment" | "setAttachment">

export class Hibernation extends Context.Service<Hibernation, {
  /** Accepts a hibernatable socket and gives the 101 response with the server's end. */
  readonly upgrade: Effect.Effect<readonly [HttpServerResponse.HttpServerResponse, HeldSocket]>
}>()("@kalfa/transport/cloudflare/Hibernation") {
  /** Alchemy's Cloudflare.upgrade, with the instance's RuntimeContext captured at build, as Alchemy's RPC socket does. */
  static readonly layer: Layer.Layer<Hibernation, never, Cloudflare.DurableObjectState | RuntimeContext>
}
```

`Hibernation` is the seam the stand-in replaces. `HeldSocket` is a `Pick` of Alchemy's own type, so an Alchemy socket
fits every slot as it is, and the stand-in's socket is a plain object with the same four calls.

### The Gateway's slots (slice 1)

```ts
// kalfa/transport/src/cloudflare/Gateway.ts, slice 1's part, a sketch.
export class Gateway extends Context.Service<Gateway, {
  readonly upgrade: (options?: { readonly traceFrames?: boolean }) => Effect.Effect<HttpServerResponse.HttpServerResponse>
  readonly webSocketMessage: (socket: HeldSocket, message: string | ArrayBuffer) => Effect.Effect<void>
  readonly webSocketClose: (socket: HeldSocket, code: number, reason: string, wasClean: boolean) => Effect.Effect<void>
  readonly webSocketError: (socket: HeldSocket, error: unknown) => Effect.Effect<void>
}>()("@kalfa/transport/cloudflare/Gateway") {}
```

The slots have Alchemy's own signatures (`DurableObjectShape` in `Workers/DurableObject.ts`), so a class's shape
spreads them in, and nothing names a class (D4).

### The stand-in (slice 1)

```ts
// kalfa/transport/src/cloudflare/MemoryGateway.ts, a sketch.
export interface MemoryGateway {
  /** One client connecting, as the app's route would call gateway.upgrade(options); the client's end is a socket. */
  readonly connect: (options?: { readonly traceFrames?: boolean }) => Effect.Effect<Socket.Socket, never, Scope.Scope>
  /** The object sleeps: the Gateway's Layer and all its memory are dropped, and built again on the next event. */
  readonly sleep: Effect.Effect<void>
  /** A socket accepted outside the Gateway, with no attachment of its own, as another part of the class would hold. */
  readonly stranger: Effect.Effect<Socket.Socket, never, Scope.Scope>
}
export const make: (gateway: Layer.Layer<Gateway, never, Hibernation>) =>
  Effect.Effect<MemoryGateway, never, Scope.Scope>
```

It keeps the platform's rules, each one an M law that also runs on real workerd: each socket's client end is one end of
`MemorySocket.pair`; each message is delivered as soon as the client writes it, even while an earlier slot still runs
(workerd delivers during a non-storage wait); an attachment is stored as `structuredClone` of the value (a Web global)
and refused above 16,384 bytes of its JSON text in UTF-8; attachments live through `sleep` and memory does not; a
socket's identity is new for each event; `send` throws once the server sent its Close frame; and after a server close,
the close event and the attachment's presence in it are what R0 saw on real workerd, written into the stand-in as two
named constants with R0's run cited beside them. 2068's test uses it to let the object sleep between the challenge and
the hello.

### Connection and its values (slice 2)

```ts
// kalfa/transport/src/cloudflare/Connection.ts, a sketch. Doc blocks left out.
export const ConnectionId = Schema.String.pipe(Schema.brand("@kalfa/transport/ConnectionId"))
export type ConnectionId = typeof ConnectionId.Type          // made by serve with crypto.randomUUID, a Web global

// What a socket may be closed with, as RFC 6455 and workerd allow a server to send: 1000, or 3000 to 4999.
export const CloseCode = Schema.Int.check(Schema.makeFilter((n) => n === 1000 || (n >= 3000 && n <= 4999)))
  .pipe(Schema.brand("@kalfa/transport/CloseCode"))
// At most 123 bytes of UTF-8, RFC 6455's limit for a close reason.
export const CloseReason = Schema.String.check(/* UTF-8 length <= 123 */).pipe(Schema.brand("@kalfa/transport/CloseReason"))

export class NoteError extends Schema.TaggedError<NoteError, { readonly brand: unique symbol }>()("NoteError", {
  // encode: the note does not fit its schema; decode: the saved note no longer fits it; write: the platform refused it
  // (too large, or not cloneable).
  reason: Schema.Literals(["encode", "decode", "write"]),
  cause: Schema.Redacted(Schema.Defect()),                   // the one cause field, hidden; Alchemy's error inside
}) {}

export interface Connection<N> {
  readonly id: ConnectionId
  readonly send: (frame: Frame) => Effect.Effect<void>       // after the connection ended: does nothing, fails nothing
  readonly close: (code?: CloseCode, reason?: CloseReason) => Effect.Effect<void>   // 1000 by default; runs `closed`
  readonly note: Effect.Effect<Option.Option<N>, NoteError>   // None until the first save
  readonly save: (note: N) => Effect.Effect<void, NoteError>  // the note before stays when a save fails
}
```

`Connection<never>`, the type with no `note` schema given, has a `note` that is always `None` and a `save` no call can
type. A `CloseCode` or `CloseReason` the platform would refuse cannot be made, so `close` cannot throw.

### serve (slice 2)

```ts
// kalfa/transport/src/cloudflare/Gateway.ts, slice 2's part, a sketch.
export const serve: <S extends Schema.Top = typeof Schema.Never, E = never, R = never>(options: {
  readonly note?: S
  readonly open?: (connection: Connection<S["Type"]>) => Effect.Effect<void, E, R>
  readonly frame: (connection: Connection<S["Type"]>, frame: Frame) => Effect.Effect<void, E, R>
  readonly closed?: (connection: Connection<S["Type"]>, event: Socket.CloseEvent) => Effect.Effect<void, E, R>
}) => Layer.Layer<Gateway, never, Hibernation | Format | R | S["EncodingServices"] | S["DecodingServices"]>
```

The owner's sketch had `Layer<never, never, R>`; the ticket marks `serve`'s type as a sketch. A Layer of `never` has
nowhere to put the four slots, and Alchemy's object shape is a returned record the platform calls, so the Layer gives
`Gateway` and the shape spreads its slots in, as Alchemy's RPC socket does (85%). `serve` names no class, keeps no
class-wide state but a lock per connection in memory, and tags nothing. One `Gateway` owns all the socket slots of the
class it is mounted in.

What each slot does, in order:

- **`upgrade(options)`**: checks the options at run time (a schema; a value the types let through by a cast dies
  loudly), makes a new `ConnectionId`, calls `Hibernation.upgrade`, writes the attachment
  `{ id, traceFrames, closing: false, frames: 0 }`, runs `open` if given, and returns the 101 response. What `open`
  sends is sent before any frame can arrive: the platform delivers no message to the object until `fetch` returns.
- **`webSocketMessage(socket, message)`**: reads the attachment with the held schema; none, or one that does not fit, is
  a refusal (close 1011, no handler). Bytes are read as text, a decoder per frame, as `Transport.socket` does. It takes
  the connection's lock, so frames run one at a time and in order even when a handler waits on outside work. It reads
  the frame's trace with `Format.read`: a frame the format refuses, or one with no trace, still reaches `frame`, with no
  parent set. It adds one to `frames` in the attachment, then runs `frame`.
- **`webSocketClose(socket, code, reason)`**: an attachment marked closing, or none, runs nothing more and leaves a span
  event `transport.close.after` on the current span. Otherwise `closed` runs once with
  `new Socket.CloseEvent(code, reason)`.
- **`webSocketError(socket)`**: as a close with code 1006 and no reason.
- **A handler that fails or dies** (in `open` or `frame`): the span records it, the connection is closed with 1011 and no
  reason (no app text crosses), and `closed` runs once with that event. A failure in `closed` is recorded on its span
  only. No failure and no defect leaves a slot: the platform sees every event succeed.
- **`connection.close(code, reason)`**: marks the attachment closing, closes the socket, runs `closed` once in this same
  wake, and returns; the platform's later close event, if it comes, finds the mark or no attachment (settled above). A
  `send` after that, or after the client closed, does nothing; a send the platform throws on (the `TypeError` the
  Workers page names) is dropped and leaves a span event `transport.send.dropped` on the current span.

### Spans, and the connection that carries spans (slice 2)

Each `open`, `frame`, `closed` and refusal runs in one span named `transport.serve`, with the attributes
`kalfa.transport.event` (`open`, `frame`, `closed` or `refused`) and `kalfa.transport.connection` (the id); the `closed`
span adds `kalfa.transport.frames`, the number of frames the connection handled (decision 0063's names: OpenTelemetry
has none for these). A frame's span is a child of the trace the frame carries.

One kind of connection is different: the one the `kalfa` command uses to append its spans to the span log (decision
0079: "The span log's own write runs with the tracer off, so saving a span never makes a span"). Its `frame` handler is
that write. The ticket's last criterion says such a connection "gets no `transport.serve` span and joins no trace for
its frames". So the call, at 85%:

- **Every step still leaves a span.** The connection's `open`, `closed` and any refusal make their `transport.serve`
  spans as usual: none of them is a span write. Only its frames run with the tracer off, under
  `Effect.withTracerEnabled(false)`, so neither `transport.serve` nor the write's own spans are made for them.
- **The frames are counted, not dropped from the record.** The `closed` span carries `kalfa.transport.frames`, kept in
  the attachment (one integer, written as part of the step that adds the frame), so the record says how many span
  writes the connection did.
- **Why not sampling or batching.** The worry is not span volume; it is that a span made while saving spans is the loop
  decision 0079 rules out. A sampled-in frame span is still a span made by a span write, and sampling is Telemetry's
  setting (decision 0063: "a setting lowers the share"), not Transport's. Batching changes when spans are saved, not
  whether a write makes one.
- **Why not one span per connection with frames as events.** A span lives in memory, and the object sleeps between
  frames, so a span opened at `open` is gone before the next frame arrives (the sleep settled above). Its events would
  also be data made by the span write, the same loop. The count on `closed` keeps the measure with neither cost.
- **How the app says so.** `gateway.upgrade({ traceFrames: false })`, from the app's route, saved with the connection
  before `open` runs (85%). Decision 0079's sketch has the command pick its log when it builds its socket Layer,
  `layer(log: "app" | "spans")`, before any frame, and the URL is the one thing a browser or a Node client sets at
  connect, so the route knows it at upgrade. Nothing in the hello (2068) carries a log name.

### What the attachment holds (slice 2)

```ts
// kalfa/transport/src/cloudflare/internal/held.ts, a sketch.
const Held = <S extends Schema.Top>(note: S) => Schema.Struct({
  id: ConnectionId,
  traceFrames: Schema.Boolean,
  closing: Schema.Boolean,
  frames: Schema.Int,
  note: Schema.optionalKey(Schema.toCodecJson(note)),        // the note in its JSON form, so the stand-in clones what the platform clones
})
```

Nothing else: no frame, no trace, no handler output (X4). No version key: before v0.0.0 a changed shape wipes nothing
worth keeping, and a socket whose attachment no longer fits is refused and closed, so the client connects again.

## One frame traced: a note saved, a sleep, a traced frame, a close from the handler

1. The client's chain connects. The app's `fetch` calls `gateway.upgrade()`. `serve` makes `ConnectionId "3f0c…"`,
   writes `{ id: "3f0c…", traceFrames: true, closing: false, frames: 0 }`, and runs `open` in a `transport.serve` span
   (`event: open`). `open` saves `{ nonce: "n-1" }` (the attachment gains `note: { nonce: "n-1" }`) and sends the
   challenge frame. The 101 goes back, and the challenge is the client's first frame.
2. Ten idle seconds pass. The object sleeps: every Layer, the lock map and every closure are gone. The socket stays
   open, and its attachment stays.
3. The client sends
   `{"jsonrpc":"2.0","method":"hello","params":{"value":{"proof":"…"},"_meta":{"traceparent":"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"}}}`.
   The platform runs the class's constructor, the inner Effect provides `handlers` again, and `webSocketMessage` runs.
4. `serve` reads the attachment: id `3f0c…`, frames traced. It takes the lock for `3f0c…`, reads the frame with
   `Format.read`, gets the trace `0af7…319c` / `b7ad…3331`, writes `frames: 1`, and runs `frame` in a
   `transport.serve` span (`event: frame`) whose parent is that trace. The handler's own spans join the client's trace.
5. `frame` reads `connection.note`: `Some({ nonce: "n-1" })`, under the same id as in step 1. The proof does not fit,
   so it calls `connection.close(CloseCode.make(4001), CloseReason.make("refused"))`.
6. `close` writes `closing: true`, closes the socket with 4001, and runs `closed` with `CloseEvent(4001, "refused")` in a
   third `transport.serve` span (`event: closed`, `frames: 1`), in this same wake. The client's `Transport.socket`
   stream fails with `SocketError` holding `SocketCloseError` 4001 and "refused", 2066's rule for a close that is not
   1000.
7. The client's Close frame comes back as a new event. `webSocketClose` finds the attachment closing or gone, runs
   nothing, and leaves `transport.close.after`. No span holds the frame, the nonce or the proof.

## Generators

Every generator is an Effect `Arbitrary`. Slice 1's live in `kalfa/transport/src/cloudflare/Platform.test-support.ts`
and slice 2's in `kalfa/transport/src/cloudflare/Gateway.test-support.ts`, both built on the pieces
`kalfa/transport/src/Transport.test-support.ts` already exports (`wellFormedText`, `validTraces`, `brokenMetas`, the
secret forms), which they import and never edit. Each law makes, from each draw, one input for every class it names, so
every class is reached in every run. Each class that targets a guarding check passes every check before it.

Slice 1's laws run against a raw fixture Gateway (in `Platform.test-support.ts`) that only accepts, echoes, writes and
reads attachments and closes when told, so they test the platform and the stand-in, not `serve`. Slice 2's fixture app
(`fixture` in `Gateway.test-support.ts`) runs on `serve` and answers each frame with a JSON frame saying what it saw: its
id, its note, the active-handler count, its current span's trace id, span id and name, whether the tracer is on, and
the object's wake token.

- `attachments` (slice 1): (q) values to store: text with quotes and letters past ASCII, numbers, lists, nested
  objects, each under 4 KiB of JSON; values over 32 KiB of JSON; a value holding a function (not cloneable); and an
  object changed after it was written.
- `platformCloses` (slice 1): (r) a server close with 1000 and with 3000 to 4999 and a reason, then a `send` after it,
  then the client's reply; a client close with 1000, 1001 and 3000 to 4999; each read for whether a close event comes,
  in which wake, and what the attachment holds in it.
- `notes` (slice 2): (a) notes under the fixture's note schema (a struct of text with quotes, CR and LF, letters past
  ASCII and an emoji, an `Int`, a `BigInt` and a list), each under 4 KiB of JSON; (b) notes over 32 KiB of JSON, and a
  note whose schema encodes to a function (not cloneable); (m) a saved note the schema no longer reads: the
  attachment's `note` holds a number where the schema wants a struct, every other key right (stand-in only, written
  through its socket's `setAttachment`).
- `frames` (slice 2): (c) text frames: JSON-RPC notifications of the method `value` and of `hello`, text that is no
  JSON, empty text, and text of 64 KiB; no lone surrogate, since a real WebSocket cannot carry one as text; (d) the same
  frames sent as UTF-8 bytes, a character cut at the end of one frame included.
- `traces` (slice 2): (e) frames with each valid trace of `validTraces` (sampled and not, with and without
  `tracestate`), with each broken `_meta` of `brokenMetas`, with no `_meta`, and frames the format refuses.
- `failures` (slice 2): (f) a handler that fails with its own error, and one that dies, in `open`, in `frame` at frame 0
  to 5, and in `closed`.
- `clientCloses` (slice 2): (g) the client closing with 1000, 1001, 3000 to 4999, with and without a reason of up to
  123 bytes; and an error event (stand-in only: `webSocketError`, read as 1006).
- `appCloses` (slice 2): (h) `connection.close` with no arguments, with 1000, and with 3000 to 4999 and a reason of 0 to
  123 bytes, from `open` and from `frame` k of 1 to 5; each followed by the platform's close event for the same socket,
  with the attachment kept as `closing: true` and with it gone, and with no close event at all.
- `strangers` (slice 2): (i) a socket accepted outside `serve`: with no attachment, with an attachment of another shape
  (an Alchemy RPC socket's `{ __alchemyRpcWebSocket: … }`), and with `{ id }` alone.
- `sleeps` (both slices): (j) runs of 1 to 12 frames with a sleep at 0 to 3 drawn places: before the first frame,
  between frames, and between a write and the next read; and reconnects: 2 to 5 connections, one after another and at
  once.
- `untraced` (slice 2): (k) connections upgraded with `traceFrames: false`, sent frames of (e) and closed by each way of
  (g) and (h).
- `overlap` (both slices): (n) a handler that waits (a `TestClock` sleep of 1 to 50 drawn milliseconds on the stand-in;
  on the real object, a wait on a promise the next message resolves, with no timer) while the client sends 2 to 10
  frames at once.
- `options` (slice 2): (o) `upgrade` options as a typed caller writes them (none, `{}`, `{ traceFrames: true }`,
  `{ traceFrames: false }`) and as a cast lets through (`{ traceFrames: "no" }`, `{ traceFrames: 0 }`,
  `{ traceFrames: null }`, `{ other: 1 }`).
- `codes` (slice 2): (p) numbers `CloseCode` must refuse: 999, 1001 to 1015, 2000, 2999, 5000, 1000.5, `NaN`; and
  reasons `CloseReason` must refuse: 124 ASCII bytes, and 42 three-byte characters (126 bytes, 42 characters).
- `secretFlows` (slice 2): (l) a generated secret text placed in a saved note, in a frame (its value and its `_meta`),
  in a close reason from the client and from the app, in a handler's own error, and in a note that fails to save (b)
  and to read (m); inspected as is, JSON-escaped, base64, base64url and `encodeURIComponent`.

## Laws

Run caps: a property law on the stand-in runs the stated runs under `it.effect`, with the shared seed, in memory; the
tests step reports any law over 10 s and lowers its runs, never its classes. Slice 1's suite `platformLaws(world, runs)`
holds M1 to M5; slice 2's suite `gatewayLaws(world, runs)` holds G1 to G11. Each runs on the stand-in with the runs
below, and on the real object with `runs = 3` and only the classes the real world can make (listed after the table).
Each `*.types.test.ts` file also runs under vitest, so it builds real values or wraps its lines in a function it never
calls.

### Slice 1

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| R0, the probe, slice 1's first law: on real workerd through Alchemy's local dev, with the raw fixture: (1) after a write, 12 s idle and a message, the wake token is new and the attachment is the one written; (2) after a server `close(code, reason)`, `send` throws a `TypeError`, a `webSocketClose` event comes in a later wake once the client replies, and the probe records whether the attachment is readable in it; (3) after a client close, one `webSocketClose` comes with the client's code and reason. It prints the two facts the stand-in copies (the close event after a server close: comes or not; the attachment in it: kept or gone) and fails if either differs from the stand-in's constants. 3 runs | test | Effect Arbitrary: platformCloses | set the stand-in's "attachment kept after a server close" constant to the opposite of what workerd does: R0 red; keep the fixture busy with an open outbound call: no new wake token in 20 s, R0 red | kalfa/transport/src/cloudflare/Platform.integration.test.ts |
| M1, attachments: a value of (q) is stored by clone (a change after the write is not seen), read back equal after every sleep of (j), refused above 16,384 bytes with Alchemy's `WebSocketAttachmentError` of `write` and the value before kept, and a value holding a function refused the same way. Stand-in 300 runs; real 3 (under 4 KiB, 32 KiB) | test | Effect Arbitrary: attachments | store the attachment by reference: the later change is seen, (q) red; clear the value on a refused write: (q) red | kalfa/transport/src/cloudflare/Platform.test.ts |
| M2, sleep: after each sleep of (j), memory and Layers are built again (a new wake token), every open socket stays open and its attachment stays, and a socket's identity is new for each event. Stand-in 300 runs; real 3, one sleep each | test | Effect Arbitrary: sleeps | keep the built Layer through `sleep`: the wake token stays, (j) red; give the same socket object to each event: (j) red | kalfa/transport/src/cloudflare/Platform.test.ts |
| M3, delivery: for (n), a message the client writes is delivered while an earlier slot still runs, in the order written, one slot call per message. Stand-in 300 runs; real 3 | test | Effect Arbitrary: overlap | deliver messages one slot at a time: the fixture's overlap count stays 1, (n) red | kalfa/transport/src/cloudflare/Platform.test.ts |
| M4, closes: for (r), `send` after the server's close throws (Alchemy's `send` dies); after a server close the close event and the attachment in it are as R0 recorded; a client close gives exactly one close event with its code and reason; an error event gives `webSocketError` (stand-in only). Stand-in 300 runs; real 3 | test | Effect Arbitrary: platformCloses | let `send` after close succeed: (r) red; give two close events for one client close: (r) red | kalfa/transport/src/cloudflare/Platform.test.ts |
| M5, strangers and upgrade: `stranger` gives a socket with no attachment whose events reach the slots; `connect` reaches `upgrade` with the options as given and gives a client end on which what the server sends arrives in order. Stand-in 200 runs; real 3 | test | Effect Arbitrary: sleeps | give the stranger an empty object as its attachment: `getAttachment` is not `missing`, red | kalfa/transport/src/cloudflare/Platform.test.ts |
| P1, the manifest: exports exactly `.`, `./memory`, `./cloudflare`, `./cloudflare/memory` and `./package.json`, each a file; peers exactly `effect` (required), `@alchemy.run/cloudflare` and `alchemy` (both optional); no dependencies; no package of this repo and no `@demlik/` package named | test | scenario: the package's own manifest at head; no generated input says what a manifest holds | make `@alchemy.run/cloudflare` a required peer: red; add it to `dependencies`: red; drop `./cloudflare/memory`: red | kalfa/transport/src/Package.test.ts |
| P2, the entry points' exports are exactly the slice's list: slice 1, `/cloudflare` gives `Gateway` and `Hibernation` (and the type `HeldSocket`), `/cloudflare/memory` gives `make`; slice 2 adds `serve`, `ConnectionId`, `CloseCode`, `CloseReason`, `NoteError` and the type `Connection`. No route, no sign-in, no challenge name | test | scenario: the two entry points' module objects at head | export a `challenge` helper from `Gateway.ts`: red; export slice 2's internal `Held` schema: red | kalfa/transport/src/Package.test.ts |
| E1, Transport's own failures: no export or member of any of the four entry points is named `Unreachable` or `TransportUnavailable`; the error classes are exactly `FormatError` (slice 1), and `FormatError` and `NoteError` (slice 2) | test | scenario: the four entry points' module objects at head | rename `NoteError` to `TransportUnavailable`: red; add a `RefusedError` class to `Gateway.ts`: red | kalfa/transport/src/Package.test.ts |
| L1, Cloudflare only through Alchemy: in `src/cloudflare/**` product files, `cloudflare:*`, `@cloudflare/**`, `miniflare`, `workerd`, `wrangler`, `@alchemy.run/cloudflare-runtime` and Alchemy's `RawWebSocket` name are refused imports, and `WebSocketPair`, `WebSocketRequestResponsePair` and `Response` are refused globals; every core rule of the package override still holds | lint | lint | in turn: import `cloudflare:workers` in `Hibernation.ts`, import `type { RawWebSocket }` in `Gateway.ts`, call `new WebSocketPair()` in `Hibernation.ts`, import `node:crypto` in `MemoryGateway.ts`: lint red each time, then undone | .oxlintrc.json |
| L2, the core stays below: product files in `kalfa/transport/src/` outside `cloudflare/` import no `alchemy`, no `@alchemy.run/**` and no `./cloudflare/**`; `src/cloudflare/**` reads the core only through `../index.ts` and `../MemorySocket.ts` | lint | lint | import `@alchemy.run/cloudflare` in `Format.ts`: lint red; import `../internal/jsonRpc.ts` in `Gateway.ts`: lint red | .oxlintrc.json |
| D4, no tie to one class: a `Gateway`'s four slots are spread into the shapes of two classes made with `Cloudflare.DurableObject<…>()`, an app gateway and a Ledger object, and each shape satisfies Alchemy's `DurableObjectShape`; an Alchemy `Cloudflare.WebSocket` is assignable to `HeldSocket`; the stand-in's socket is too | type | type | type a slot's socket as `Cloudflare.WebSocket`: the stand-in's socket line fails, red; give `upgrade` a class argument: red | kalfa/transport/src/cloudflare/Gateway.types.test.ts |

### Slice 2

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D1, `serve`'s handlers: `frame` is required (leaving it out is a type error); `open` and `closed` may each be left out; with all three given, their errors and needs are joined; the Layer is `Layer<Gateway, never, Hibernation \| Format \| R>`, its error `never` whatever the handlers fail with | type | type | make `frame` optional: the `@ts-expect-error` line compiles, red; put `E` in the Layer's error: red | kalfa/transport/src/cloudflare/Gateway.types.test.ts |
| D2, the note's type holds for every way the options are typed: no `note` key (`Connection<never>`: `note` is `Option<never>`, and `save(x)` is a type error for every `x`); a struct schema; a tagged union; a schema needing an encoding service and one needing a decoding service (each shows in the Layer's needs); explicit type arguments; a schema typed `Schema.Top`; `note: undefined` (a type error under `exactOptionalPropertyTypes`) | type | type | default `S` to `Schema.Unknown`: `save(1)` with no note compiles, red; drop `S["EncodingServices"]`: the encoding-service line fails, red | kalfa/transport/src/cloudflare/Gateway.types.test.ts |
| D3, `upgrade`'s options: no argument, `{}`, `{ traceFrames: true }` and `{ traceFrames: false }` compile; `{ traceFrames: undefined }`, `{ traceFrames: "no" }` and `{ other: 1 }` are type errors | type | type | widen `traceFrames` to `boolean \| undefined`: the `undefined` line compiles, red | kalfa/transport/src/cloudflare/Gateway.types.test.ts |
| D5, the brands: a plain `string` is not a `ConnectionId`, a plain `number` not a `CloseCode`, a plain `string` not a `CloseReason`; `close()` and `close(code)` compile; `NoteError`'s `cause` is `Redacted.Redacted<unknown>` | type | type | type `ConnectionId` as `string`: the `@ts-expect-error` line compiles, red; type `cause` as `unknown`: red | kalfa/transport/src/cloudflare/Gateway.types.test.ts |
| B1, the close values refuse what the platform refuses: each code and reason of (p) fails `Schema.decodeUnknownExit` of its schema; 1000, 3000, 4999 and every drawn code from 3000 to 4999 pass; a reason of 123 bytes passes. 200 runs | test | Effect Arbitrary: codes | let `CloseCode` take any `Int`: (p) red; count `CloseReason` in characters: the 42-character reason passes, (p) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G1, open first: for each connection of (j), `open` runs exactly once, before any `frame` call; the frames `open` sends are the client's first frames, in the order sent, before any frame a `frame` call sends; with `open` left out, the first frame still reaches `frame`. Stand-in 200 runs; real 3 | test | Effect Arbitrary: sleeps | run `open` after the 101 is returned, forked: the client reads a frame answer first, red; run `open` again after a sleep: (j) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G2, one frame, one call, in order, one at a time: for each run of (c), (d) and (n), `frame` is called exactly once per frame, in the order sent, with the frame's text (bytes read as text, a decoder per frame, a cut character read as U+FFFD), and the fixture's active-handler count is never above 1. Stand-in 300 runs; real 3 | test | Effect Arbitrary: frames | drop the per-connection lock: (n) shows 2 at once, red; share one `TextDecoder` across frames: the cut character of (d) joins the next frame, red; key the lock on the socket object: the bridge wraps it anew per event, (n) red; trim each frame's text: the empty and spaced frames of (c) change, red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G3, the note lives through a sleep: for (a) and (j), a note saved in `open` or in frame k is read by every later frame, across every sleep, equal by `Schema.toEquivalence` of the note schema, under the same `ConnectionId`; before the first save, `note` is `None`; the wake token differs after each sleep. Stand-in 300 runs; real 3, one sleep each | test | Effect Arbitrary: notes | keep the note in a `Map` in memory: red after the first sleep; skip `toCodecJson` and store the note as is: the `BigInt` of (a) fails to clone, red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G4, a note too big or not cloneable: for (b), `save` fails with `NoteError` of `write` (too big) or `encode` (not cloneable), the connection stays open, the next frame reads the note saved before, and no defect leaves the slot. Stand-in 200 runs; real 3 (the 32 KiB note only) | test | Effect Arbitrary: notes | map Alchemy's write error to a defect: red; clear the note on a failed save: the next read is `None`, (b) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G5, a stale note: for (m), `note` fails with `NoteError` of `decode`, never a defect, and `save` of a fitting note then makes `note` read it. 200 runs | test | Effect Arbitrary: notes | read the note with `Schema.decodeUnknownSync`: (m) is a defect, red; skip the decode and give the raw value: (m) gives a number, red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G6, the id: for (j), each connection's `id` decodes as a `ConnectionId`, is the same in `open`, every `frame` and `closed` of that connection across every sleep, and differs from the id of every other connection in the run, a reconnect after a close included. Stand-in 300 runs; real 3 | test | Effect Arbitrary: sleeps | make the id from a counter kept in memory: two connections share `c-0` after a sleep, (j) red; keep the id by the socket object: a new id after the sleep, red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G7, a close from the handler: for (h), the client's `Transport.socket` stream ends cleanly for 1000 (and for no arguments) and fails with `SocketError` holding `SocketCloseError` of that code and reason otherwise; `closed` runs exactly once, in the wake that called `close`, with a `Socket.CloseEvent` of the same code and reason, whether the platform's close event then comes with the attachment kept, comes with it gone, or never comes; no `frame` call follows; a `send` after `close` in the same handler reaches no one and fails nothing. Stand-in 300 runs; real 3 | test | Effect Arbitrary: appCloses | delete the `closing` check in `webSocketClose`: `closed` runs twice for the kept attachment, (h) red; run `closed` only from the platform's event: zero calls where the event never comes, (h) red; close with 1000 always: (h) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G8, a close from the client: for (g), `closed` runs exactly once with `CloseEvent(code, reason)` (1006 and no reason for the error event), no `frame` call follows, and a `send` from `closed` fails nothing. Stand-in 300 runs; real 3 (1000, 1001 and one drawn 3000 to 4999 code) | test | Effect Arbitrary: clientCloses | pass `wasClean` as the code: red; run `closed` for both `webSocketError` and the close event after it: 2 calls, (g) red; let `send` in `closed` die: the slot rejects, red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G9, a failing handler: for (f) in `open` or `frame`, the connection closes with 1011 and an empty reason, `closed` runs exactly once with that event, the slot succeeds (no failure and no defect reaches the platform), and the object keeps serving a new connection; for (f) in `closed`, only its span records it. Stand-in 300 runs; real 3 (a failure in `frame` only) | test | Effect Arbitrary: failures | let a defect leave the slot: the stand-in's event is rejected, red; put the error's message in the close reason: a reason that is not empty, red; skip `closed` after a failure: 0 calls, (f) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G10, a stranger: for (i), a message closes that socket with 1011 and calls no handler, a close event calls no handler, and each makes one `transport.serve` span with `event: refused` and a failure status, holding no attachment text. Stand-in 200 runs; real 3 (no attachment only) | test | Effect Arbitrary: strangers | delete the held-schema decode and read `id` as `deserializeAttachment().id`: `{ id }` alone reaches `frame`, (i) red; refuse without a span: (i) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G11, the frame's trace: for each frame of (e) with a valid trace, the `frame` handler's current span is named `transport.serve`, has the frame's trace id, and its parent span id is the frame's span id; for a broken, missing or unreadable trace, the handler still runs once, no `FormatError` reaches anyone, and the trace id is not the one in the frame's broken text. Stand-in 300 runs; real 3 (one valid and one broken trace) | test | Effect Arbitrary: traces | run `frame` with no parent: the trace ids differ, (e) red; skip `frame` when `Format.read` fails: the unreadable frame gets no call, (e) red; take the trace only when the method is `value`: the `hello` frame's trace is lost, (e) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| G12, a connection that carries spans: for (k), the connection's `open`, `closed` and any refusal each make their one `transport.serve` span; its frames make no `transport.serve` span and no span of the handler's own, the fixture reports the tracer off in every `frame` call and on in `open` and `closed`, and the `closed` span's `kalfa.transport.frames` equals the frames sent, across every sleep; a traced connection beside it in the same run keeps its frame spans; for (o), the cast options die at `upgrade` with no socket accepted. Stand-in 200 runs; real: the fixture's report only, 3 | test | Effect Arbitrary: untraced | keep `traceFrames` in memory: after a sleep the frame spans come back, (k) red; turn the tracer off for `open` and `closed` too: their spans are gone, (k) red; count frames in memory: the count after a sleep is short, (k) red; delete the options check: `{ traceFrames: "no" }` is taken as traced, (o) red | kalfa/transport/src/cloudflare/Gateway.test.ts |
| S1, the spans: each `open`, `frame`, `closed` and refusal makes exactly one span named `transport.serve`, ended when its handler returns, whose attributes are exactly `kalfa.transport.event` and `kalfa.transport.connection`, plus `kalfa.transport.frames` on `closed`; `send` makes none; a dropped `send` leaves one event `transport.send.dropped`, and a close event after a gateway close leaves one `transport.close.after`. 200 runs | test | Effect Arbitrary: sleeps | name it `transport.frame`: red; add the frame's length as an attribute: red; make a span per `send`: red; drop the `transport.close.after` event: (j) red | kalfa/transport/src/cloudflare/Spans.test.ts |
| X1, [secrets] spans hold no secret: for every flow of (l), no span name, attribute, event or failure text as Effect's tracer writes it holds the secret in any form; the app's own error is the one place it may show, on its own handler's span. 300 runs | test | Effect Arbitrary: secretFlows | annotate the span with the frame: (l) red; add an event naming the close reason: (l) red | kalfa/transport/src/cloudflare/Leak.test.ts |
| X2, [secrets] logs hold no secret: for every flow of (l), no line at any level of a recording logger holds it in any form. 300 runs | test | Effect Arbitrary: secretFlows | `Effect.logDebug` the refused attachment: (l) red | kalfa/transport/src/cloudflare/Leak.test.ts |
| X3, [secrets] `NoteError` holds no secret: for each failed save and read of (l), `Cause.pretty` with its stack, `String`, `JSON.stringify`, `Inspectable.format`, every own property, and the JSON text of `Schema.encodeUnknownExit(Schema.toCodecJson(NoteError))` hold the secret in no form; that encode succeeds; `cause` is a `Redacted` whose value is Alchemy's `WebSocketAttachmentError`. 300 runs | test | Effect Arbitrary: secretFlows | keep Alchemy's error unwrapped as `cause`: `String` shows it, red; put the note's text in a `message` field: (l) red; declare `cause` with `disallowJsonEncode`: the encode fails, red | kalfa/transport/src/cloudflare/Leak.test.ts |
| X4, [secrets] the attachment holds only what it should: after every flow of (l) the stand-in's stored attachment has exactly the keys `id`, `traceFrames`, `closing`, `frames` and, after a save, `note`; no frame text and no trace text is in it in any form. 300 runs | test | Effect Arbitrary: secretFlows | keep the last frame in the attachment for a replay: (l) red | kalfa/transport/src/cloudflare/Leak.test.ts |
| I1, the gateway suite on the real object: Alchemy's local dev runs `gateway-worker.test-support.ts`, a Worker with one Durable Object class that mounts `serve` with the fixture; a client on `NodeSocket.layerWebSocket` built from 2066's chain runs `gatewayLaws(world, 3)` with the classes the real world can make, and `sleep` waits for idle until the wake token changes, at most 20 s. 3 runs per law | test | Effect Arbitrary: sleeps | build the sleep law on a `Map` in memory (as G3's plant): red here too; key the lock on the socket's identity (as G2's plant): red | kalfa/transport/src/cloudflare/Gateway.integration.test.ts |

Classes the real world can make: (q), (r), (j) with one sleep, (n), and in slice 2 (a), (b) (the 32 KiB note), (c), (d),
(e), (f) in `frame`, (g) 1000, 1001 and one code of 3000 to 4999, (h), (i) with no attachment, (k). Stand-in only, each
with its reason: (m) needs an attachment written by another schema, and the real object cannot change its code under
an open socket; the error event of (g) needs a broken TCP stream, which `NodeSocket.layerWebSocket` cannot make; (o)
and (p) are about values, not the platform.

### Each acceptance criterion and its law

| Ticket's criterion | Laws |
|---|---|
| `serve({ open, frame, closed })` gives a Layer; `frame` once per frame with the held connection; `open` once, first, its sends first; `closed` once with `Socket.CloseEvent` | D1, G1, G2, G7, G8, G9 |
| `open` and `closed` are optional, `frame` is not | D1 |
| a note saved in `open`, a sleep, then `frame` reads it under the same id | G3, G6, M2, R0, I1 |
| the id is a branded value Transport owns, made by the gateway; a reconnect gets a new id | D5, G6 |
| a client from 2066's chain over Effect's WebSocket Layer sends frames and gets what the handler sends | I1 (the fixture echoes), M5, G2 on the memory pair |
| `close` from the handler ends the client's stream | G7 |
| `serve` knows nothing of sign-in, routes or the app's rules | P2, and `upgrade` takes no route |
| no tie to one Durable Object class | D4 |
| Cloudflare only through Alchemy, no `cloudflare:*`, no raw platform type | L1, P1 |
| a frame's trace is the parent of its `frame` span, checked by trace id | G11 |
| one `transport.serve` span per handled frame, as in 2066, with no frame text | S1, X1 |
| a connection with the tracer off gets no `transport.serve` span and joins no trace for its frames; how the app says so | G12, D3 |

### The real-object laws

R0, the slice 1 real run of M1 to M5 (`kalfa/transport/src/cloudflare/Platform.integration.test.ts`) and I1 run real
workerd on the machine through Alchemy's local dev (`deploy` with `dev: true` and local state, as
`next/apps/fabrika/src/sibling.laws.integration.test.ts` does), so they are `*.integration.test.ts` files. No stand-in
will do: their point is that the stand-in keeps the platform's rules, so the same suites must run on the platform.
Every behavior is proved first on the stand-in; the real runs are the thin check that it matches. The laptop refuses
them by name (`vitest.hostrun.ts`), so they never run there narrowly: the lead's proof run starts them before each
slice's first review, in CI, and CI's full run runs them after. They need no Cloudflare account, no signal, no launchd
entry and no run on the owner's Mac. They bind `127.0.0.1` on a held free port, as the sibling law does. R0 runs first
in slice 1's proof run, and the stand-in's two close constants are written from what it printed.

## Lint

Slice 1's tests step adds `alchemy`, `alchemy/**`, `@alchemy.run/**` and `**/cloudflare/**` to the patterns the package
override (`kalfa/transport/src/**`) refuses, and one new override after it for `kalfa/transport/src/cloudflare/**` that
repeats the package entries without the Alchemy ones and adds L1's (an override replaces a rule's options). The
`Transport.ts` override already there stays as it is. Tests, `*.test-support.ts` and the integration files are left
out. The two Worker fixtures' default exports take the same `import/no-default-export` edge line as
`next/apps/fabrika/src/sibling-objects.test-support.ts`.

## Is this a setting?

- The close code for a failed handler (1011) and for a stranger (1011): not settings. RFC 6455 names 1011 for a server
  that hit something it could not handle, and a client reads it as such.
- The attachment limit (16,384 bytes) and the frame limit (32 MiB): the platform's, not ours, so not settings; the
  stand-in copies the first.
- Whether a connection's frames are traced: a choice per connection, made by the app's route at `upgrade`, not a file
  setting. How many traced spans are kept is Telemetry's sampling setting (decision 0063).
- The idle wait in the real runs (at most 20 s): a test's bound on a platform's timer, not a product choice.

## What fact is lost if it is not recorded now

- **Which connection a frame came on, across sleeps.** Recorded: the id lives in the attachment, and every span carries
  it. Without it a trace could not tell two connections of the same client apart.
- **The sender's trace on each handled frame.** Recorded as the span's parent. A frame handled outside its trace can
  never be joined later.
- **How many span writes a span-carrying connection did.** Recorded as `kalfa.transport.frames` on its `closed` span;
  its frames make no span of their own.
- **Why a connection ended.** Recorded as the `closed` span: the code and who started it. The reason text is the app's
  or the client's words and stays out (X1).
- **Not recorded: how long a frame waited for the lock, and frame sizes.** Nothing rebuilds them later, but before
  v0.0.0 there is no data to keep; `## Findings` 3.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/transport/src/cloudflare/index.ts | build | 15 | slice 1: new, the `/cloudflare` entry point; slice 2: its new exports |
| kalfa/transport/src/cloudflare/Hibernation.ts | build | 45 | slice 1: new, `Hibernation`, `HeldSocket`, `Hibernation.layer` on Alchemy's `upgrade` |
| kalfa/transport/src/cloudflare/Gateway.ts | build | 185 | slice 1: new, the `Gateway` service (25); slice 2: `serve`, the four slots, the lock, the spans, the frame count (160) |
| kalfa/transport/src/cloudflare/MemoryGateway.ts | build | 150 | slice 1: new, the `/cloudflare/memory` stand-in, with R0's two close constants |
| kalfa/transport/src/cloudflare/Connection.ts | build | 70 | slice 2: new, `Connection`, `ConnectionId`, `CloseCode`, `CloseReason`, `NoteError` |
| kalfa/transport/src/cloudflare/internal/held.ts | build | 60 | slice 2: new, the attachment's schema, its read and its write |
| kalfa/transport/README.md | build | docs | slice 1: the stand-in and mounting a Gateway in a class; slice 2: the three handlers, the note, the close rules, the frame-span switch |
| kalfa/transport/GLOSSARY.md | build | docs | slice 2: the word **Note** |
| kalfa/transport/package.json | tests | tests | slice 1: exports `./cloudflare` and `./cloudflare/memory`; optional peers `@alchemy.run/cloudflare` and `alchemy`; the same as dev dependencies, with `@cloudflare/workers-types` for Alchemy's types |
| pnpm-lock.yaml | tests | tests | slice 1: the importer's new dev dependencies, written by one `pnpm install --offline` |
| .oxlintrc.json | tests | tests | slice 1: L1 and L2, Alchemy refused in the core, the `src/cloudflare/**` override |
| kalfa/transport/src/Package.test.ts | tests | tests | slice 1: P1, P2, E1 for slice 1's exports; slice 2: P2 and E1 grown |
| kalfa/transport/src/cloudflare/Platform.test-support.ts | tests | tests | slice 1: generators (q), (r), (j), (n), the raw fixture Gateway, `platformLaws(world, runs)` |
| kalfa/transport/src/cloudflare/Platform.test.ts | tests | tests | slice 1: M1 to M5 on the stand-in |
| kalfa/transport/src/cloudflare/platform-worker.test-support.ts | tests | tests | slice 1: the Worker for R0 and the real M run: one class with the raw fixture |
| kalfa/transport/src/cloudflare/Platform.integration.test.ts | tests | tests | slice 1: R0 first, then M1 to M5 on real workerd |
| kalfa/transport/src/cloudflare/Gateway.types.test.ts | tests | tests | slice 1: D4; slice 2: D1 to D3, D5 |
| kalfa/transport/src/cloudflare/Gateway.test-support.ts | tests | tests | slice 2: the generators, the fixture app, `gatewayLaws(world, runs)`, a tracer and a logger held in memory |
| kalfa/transport/src/cloudflare/Gateway.test.ts | tests | tests | slice 2: the suite on the stand-in; B1, G5, G12 |
| kalfa/transport/src/cloudflare/Spans.test.ts | tests | tests | slice 2: S1 |
| kalfa/transport/src/cloudflare/Leak.test.ts | tests | tests | slice 2: X1 to X4 |
| kalfa/transport/src/cloudflare/gateway-worker.test-support.ts | tests | tests | slice 2: the Worker for I1, mounting `serve` with the fixture, and a route that accepts a stranger socket |
| kalfa/transport/src/cloudflare/Gateway.integration.test.ts | tests | tests | slice 2: I1 |
| layer-rules.json | tests | tests | no change: Alchemy is no kalfa package, so the rank stays at layer 0 |
| vitest.config.ts | tests | tests | no change: its kalfa globs already take the new unit and integration files |
| package.json | tests | tests | no change: the root already names `@kalfa/transport` |
| oxlint-plugins/law-ids.ts | tests | tests | no change: the tests step runs it on the new law ids |
| kalfa/transport/src/Transport.test-support.ts | tests | tests | no change: imported for its generators and secret forms, never edited |
| next/apps/fabrika/src/sibling-objects.test-support.ts | tests | tests | no change: read as the model for the Worker fixtures |
| next/apps/fabrika/src/sibling.laws.integration.test.ts | tests | tests | no change: read as the model for Alchemy's local dev in the real runs |

### Files shared with the hello plan (2068)

The plan for https://github.com/kamp-us/tea-fabrika/issues/2068 is being written on branch
`fabrikalfa/kalfa-transport-hello`, draft https://github.com/kamp-us/tea-fabrika/pull/2318, which held no plan file
when this was written. Every file under `src/cloudflare/` is this plan's alone, and 2068's `connect` and `accept` live
in the core, which this plan does not touch. Four files will likely be edited by both: `kalfa/transport/README.md` (a
section each), `kalfa/transport/GLOSSARY.md` (a word each), `kalfa/transport/src/Package.test.ts` (E1's list of error
classes: this adds `NoteError`, 2068 adds `NoSharedVersion`) and `.oxlintrc.json` (a different override each). Each
plan owns its own hunks; the pull request that lands second rebases and keeps both. 2068's gateway-side test needs
slice 2's `open` handler and slice 1's `MemoryGateway`, so that test lands after slice 2.

## Existing tools

- `kalfa/transport/src/cloudflare/index.ts`: searched the core's root (`src/index.ts`, followed) and `kalfa/git`'s
  adapter entry points (one file per entry, followed).
- `kalfa/transport/src/cloudflare/Hibernation.ts`: searched Alchemy's `Cloudflare.upgrade`, `DurableObjectState` and
  `WebSocket` (all used, through this file only), and `next/packages/libfabrika/src/cloudflare/ConnectionObject.ts`
  (reads the raw socket under a lint edge; not followed).
- `kalfa/transport/src/cloudflare/Gateway.ts`: searched Alchemy's internal `RpcWebSocket.make` (its shape followed:
  slots the object spreads in, the id in the attachment, the runtime captured at build, the close event after its own
  close ignored; it is internal and speaks Effect RPC, so not used), Effect's `SocketServer` (a stream per socket,
  which no sleep survives; not used), Effect's `Semaphore` (used for the lock), `Effect.withSpan` with `parent` and
  `Effect.withTracerEnabled` (used), and today's `next/packages/libfabrika/src/cloudflare/connection.ts` (a map only).
- `kalfa/transport/src/cloudflare/MemoryGateway.ts`: searched Alchemy and npm for an in-memory Durable Object
  (Miniflare and `@cloudflare/vitest-pool-workers` run real workerd, and `cloudflare:test` is a refused import; none in
  memory), `kalfa/transport/src/MemorySocket.ts` (used for the client end), and `structuredClone` (a Web global, used).
- `kalfa/transport/src/cloudflare/Connection.ts`: searched Alchemy for a connection record (none outside its internal
  RPC socket), Effect's `Socket.CloseEvent` (used for `closed`; its code has no range check, so `CloseCode` is new),
  `Schema.brand` (used), `Schema.Redacted(Schema.Defect())` as `kalfa/secrets/src/Errors.ts` has it (followed), and
  Effect 4.1.3 for a UUID maker (none; `crypto.randomUUID` is a Web global in Workers, Node and browsers).
- `kalfa/transport/src/cloudflare/internal/held.ts`: searched Alchemy's `getAttachment` and `setAttachment` (used) and
  `Schema.toCodecJson` (used for the note).

## Calls taken

- Two slices, cut where each is reviewed alone: the platform and its stand-in first, then `serve` on it (90%).
- `serve`'s Layer gives `Gateway`, whose slots the class spreads in (85%), for the reason under "serve".
- A `Hibernation` service is the seam, and its Layer is the only code that calls Alchemy's `upgrade` (85%).
- The note is typed by a schema the app gives, kept in its JSON form, optional with `Connection<never>` when absent
  (80%).
- A frame reaches `frame` whatever its method and whether the format reads it; only its trace depends on `Format.read`
  (85%): `serve` knows nothing of the app's messages.
- A lock per connection keeps frames one at a time (85%): workerd delivers a message during a non-storage wait (M3).
- A failed handler closes with 1011 and an empty reason, and runs `closed` once (80%), as cowboy runs `terminate`.
- A gateway-started close runs `closed` in the same wake, and the later close event runs nothing (90%, settled above;
  R0 records the attachment detail the design does not depend on).
- An object sleeps after 10 s with no event, locally too (90%, settled above).
- A span-carrying connection keeps its `open`, `closed` and refusal spans, runs its frames with the tracer off, and
  counts them on `closed`; it says so with `upgrade({ traceFrames: false })` (85%).
- Bytes are read as text, a decoder per frame, as `Transport.socket` reads them (85%).
- `NoteError`'s only cause field is `Schema.Redacted(Schema.Defect())` (90%), as `@kalfa/secrets`.
- Spans named `transport.serve` for all four events, told apart by `kalfa.transport.event` (80%): the ticket names one
  span, and four names would split one kind of work.
- The stand-in is a product entry point, not test support (85%): 2068's test and any app's tests need it, as
  `@kalfa/transport/memory` is.

## Validation

- Each slice's tests step runs its new files by path (the integration files left out), then `pnpm format`,
  `pnpm lint` and `node oxlint-plugins/law-ids.ts`. It does not run the changed-tests command or a typecheck: the lead
  does.
- Each slice's build runs the same narrow files, `pnpm format` and `pnpm lint`. The lead runs the changed tests and the
  typecheck once at the end of each slice, outside any box, and starts the proof run that runs the slice's integration
  file before its first review (R0 first in slice 1); CI runs the rest.

## Size

1. Slice 1, the platform seam and the stand-in: 235 lines (`MemoryGateway.ts` 150, `Hibernation.ts` 45, `Gateway.ts`
   25 for the service, `index.ts` 15), plus the manifest, the lockfile, the lint overrides and the laws.
2. Slice 2, `serve` and the held connection: 290 lines (`Gateway.ts` 160 for `serve`, `Connection.ts` 70,
   `internal/held.ts` 60), plus the laws.

525 product lines in all, about 5 agent hours across both, 70% sure. The doubt is the real runs: the first kalfa laws
on real workerd, with a sleep that waits on the platform's idle timer. Budget basis: the 2066 plan priced 284 lines at
about $12 a step. Slice 1: tests $14, build $12, review $8. Slice 2: tests $16, build $16, review $9. One likely
send-back across the two (a real run that differs from the stand-in) at about $13.

Estimate: 7 steps, $88

## New names

- `serve`, `Connection`, `open`, `frame`, `closed`, `send`, `close`, `Gateway` (the slots record): the protocol's and
  the ticket's words, and the glossary's.
- `ConnectionId`: 1767's own name for a connection's id.
- **note**: a new domain word, for the small value a connection keeps at the gateway that lives through a sleep. It
  goes in `kalfa/transport/GLOSSARY.md`: "**Note**: The small value the app keeps with one connection at the gateway; it
  lives through the gateway sleeping between frames, and ends with the connection. _Avoid_: attachment, session,
  state, assigns". `save` is its verb.
- `Hibernation`, `HeldSocket`: Cloudflare's word for the API ("Hibernation WebSocket API"), and a code name for the four
  calls a gateway uses. Not domain words.
- `CloseCode`, `CloseReason`: RFC 6455's words. `NoteError`: a code name. `traceFrames`: a code name for the option.
- `kalfa.transport.event`, `kalfa.transport.connection`, `kalfa.transport.frames`, and the span events
  `transport.send.dropped` and `transport.close.after`: under decision 0063's names.
- `MemoryGateway`, `make`, `connect`, `sleep`, `stranger`: the stand-in's code names.

## Records

- `kalfa/transport/GLOSSARY.md` gains **Note** (slice 2).
- The README records the stand-in and mounting a Gateway (slice 1); the three handlers, the note and its limit, the
  close rules (who runs `closed`, 1011 for a failure), and the frame-span switch (slice 2).
- R0's two observed facts are written beside the stand-in's constants with the run that saw them, so a workerd bump
  that changes them turns R0 red.
- A decision record is the lead's call for one rule other apps must follow: a gateway-started close runs `closed` in
  the same wake, and a failed handler closes with 1011. This plan writes none.

## What this cannot tell us

- Nothing here was built or type-checked. Alchemy's, workerd's config and Effect's sources were read; one probe ran.
- The probe (a throwaway script in the scratch folder, Node against this worktree's Effect 4.1.3): a `Schema.TaggedError`
  with `cause: Schema.Redacted(Schema.Defect())` encodes through `Schema.toCodecJson` with the whole cause inside, the
  inner error's name, message and cause chain included. Effect's own schema messages did not quote the value in three
  tries (a number, a literal and a length check), so X3 passes on them; an app schema whose own message quotes the value
  would show it there (tracker ticket 1310 covers it).
- Whether the attachment is still readable in the close event after a server close: the docs do not say; R0 records it,
  and the design holds either way.
- Whether Alchemy's local dev runs in CI's runner as it does on a laptop: the sibling law suggests so, and no run of it
  in CI was looked up. R0 is the first.
- The stand-in's size check counts JSON bytes; the platform counts structured-clone bytes. The laws keep their values
  well under (4 KiB) or well over (32 KiB) the line, so a value near 16 KiB may pass one and fail the other.
- How the gateway forwards a signal to another connection by id (2072) needs a lookup from id to socket across a sleep
  (`getWebSockets` with a tag); `serve` keeps none yet.

## Open questions

None.

Every call above picks how the code does what 1767's answers and decisions 0018, 0063, 0076 and 0079 already say, and
the ticket gives the two open types (`serve`'s and the note's) and the frame-span switch to this plan, so none goes to
the owner.

## Findings

1. **`Schema.Redacted`'s JSON codec writes the hidden value.** Proof: the probe above, and Effect 4.1.3's `Schema.ts`,
   where `Redacted`'s `toCodecJson` encodes with `Redacted_.value` unless `disallowJsonEncode` is set. Tracker ticket
   1310 already covers it; nothing new is filed.
2. **No call decodes one frame.** A `frame` handler gets one `Frame`, and Transport has only stream functions to read
   it, so the app writes `Stream.make(frame).pipe(Transport.decode(S), Stream.runHead)`. 2068's `accept` decodes the
   hello on its own; a small `Transport.read(schema)(frame)` beside `decode` would serve every handler. Proof: the
   core's exports in `kalfa/transport/src/Transport.ts`.
3. **The gateway's spans have no lock-wait or size measures.** Decision 0063's "record wide" would put the lock wait and
   the frame size on `transport.serve`; the ticket asks for neither. A later Transport ticket can add them; before
   v0.0.0 no data is lost by waiting.

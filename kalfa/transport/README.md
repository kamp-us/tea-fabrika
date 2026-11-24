# @kalfa/transport

Move typed values over a socket. A value becomes one frame, a frame comes back as a typed value, and the sender's trace
rides along. The socket is Effect's own `Socket.Socket`, so any Effect socket Layer works (Node's WebSocket, the
browser's, the memory pair below) and Transport writes no socket code. It imports no other package of its repo, no Node
module and no Telemetry, so anything can import it. [`GLOSSARY.md`](./GLOSSARY.md) has the words.

## The chain

```ts
import { Effect, Schema, Stream } from "effect";
import { NodeSocket } from "@effect/platform-node";
import { Format, Transport } from "@kalfa/transport";

const Progress = Schema.TaggedStruct("Progress", { done: Schema.Int, of: Schema.Int });

clicks.pipe(
  Stream.map(count), // a stage: a plain stream function standing in for a program
  Transport.encode(Progress), // Stream<Frame, E | FormatError, R | Format>
  Transport.socket, // Stream<Frame, E | FormatError | SocketError, R | Format | Socket.Socket>
  Transport.decode(Progress), // Stream<Progress, E | FormatError | SocketError, R | Format | Socket.Socket>
  Stream.map(badge), // a stage
  Stream.runDrain,
  Effect.provide([NodeSocket.layerWebSocket(url), Format.layerJsonRpc]),
);
```

Each of the five functions keeps nothing from one frame to the next. A schema's own services join the stream's needs.

- `encode(schema)` writes each value as one frame, with no trace. A value the schema cannot write as JSON (a function, a
  cycle, `undefined` inside an array) fails with `FormatError` of `value` and writes no frame.
- `decode(schema)` reads each frame as a value and drops its trace. A frame that is no JSON fails with `FormatError` of
  `text`. JSON that is not one notification, or has an `id`, a `result` or an `error`, or has no `params.value`, fails
  with `message`. Another method word fails with `method`. A value the schema refuses fails with `value`. Never a defect.
- `encodeTraced` and `decodeTraced` are the same for `Traced<A>`, a value with `trace: Option<Tracer.ExternalSpan>`.
- `socket` sends the frames it is given and gives the frames it reads, both ways at once, so an end can answer what it
  reads while it is still sending. It makes one span, `transport.socket`, with Effect's own calls.

## The close

A close with code 1000 (RFC 6455's normal close) ends the stream cleanly, after every frame read before it. Any other
close fails the stream with Effect's own `SocketError` holding `SocketCloseError` with that code and reason. A failure of
the stream you gave to `socket` stays that failure and is never wrapped, even when it is a `SocketError` of close 1000: only
the close the socket itself reported ends the stream cleanly. When your stream ends nothing is closed, since
the far end may still send. The socket closes, with code 1000, when the scope of the chain ends.

## The format

`Format` is a service: how a value becomes data (`codecFor`), how data becomes a frame (`write`) and how a frame becomes
data (`read`). `Format.layerJsonRpc` is the one Transport ships, JSON-RPC 2.0, one notification in each frame:

```json
{"jsonrpc":"2.0","method":"value","params":{"value":{"_tag":"Progress","done":3,"of":10},"_meta":{"traceparent":"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"}}}
```

- The method word is always `value`. Other words are for other messages of the protocol, and `decode` refuses them.
- The value is under `params.value`, never spread into `params`, so a bare string, a number or a value with its own
  `_meta` key all fit. It is written by Effect's JSON codec (`Schema.toCodecJson`), so a `BigInt` is a string and a
  `Uint8Array` is base64. Effect's codec writes `-0` as `0`, so `-0` comes back `0`.
- `Format.write` of data no JSON holds (a `BigInt`, a cycle) fails with `FormatError` of `value`. The stream functions
  never reach it, since the codec writes only JSON.
- Another format is another Layer of `Format`. No stream function changes.

## The trace

`encodeTraced` writes the span of a `Traced` value as `params._meta.traceparent`, with `tracestate` beside it when there
is one, as MCP carries trace context. `decodeTraced` reads it back as an `ExternalSpan` with the same trace id, span id
and sampled flag.

- The W3C `tracestate` has no field on Effect's `ExternalSpan`, so it is kept in the span's `annotations` under the
  `TraceState` key.
- A trace id shorter than 32 digits is written padded on the left with zeros. An id that is no W3C id (a capital letter, a
  dash, the wrong length, all zeros) writes no trace key at all, since the reader would drop it.
- A `tracestate` that is empty, longer than 512 characters or not printable ASCII is dropped, and its trace still crosses.
- A frame with a broken `traceparent` is a value with no trace, never an error. Plain `encode` writes no trace and plain
  `decode` drops one.

## The memory pair

```ts
import * as MemorySocket from "@kalfa/transport/memory";

const [left, right] = yield* MemorySocket.pair; // Effect<readonly [Socket, Socket], never, Scope>
```

Two joined sockets for a test: what one end writes, the other end reads, in order. Closing the reader scope of an end
fails a pull waiting on it, and the far end reads every frame written before, then a close of code 1000. A `CloseEvent`
written to an end closes both with its code and reason. A write to an end that closed itself fails with `SocketWriteError`. A write to an end whose far end closed is dropped and
fails nothing, as a WebSocket drops it, and the close reaches the reader. There is no
capacity, as a browser's `WebSocket.send` has none.

## The Cloudflare gateway

`@kalfa/transport/cloudflare` is the half of the package that runs in a Durable Object. `@kalfa/transport/cloudflare/memory`
is a stand-in Durable Object for tests. Both need `@alchemy.run/cloudflare` and `alchemy`, which are optional peers: a
project that never imports these two entry points installs neither. The core imports no Alchemy, and Cloudflare is
reached only through Alchemy, never through `cloudflare:*` or a raw socket.

A `Gateway` is the four calls a Durable Object class hands to the platform, with Alchemy's own signatures, so any class
spreads them into its shape and no slot names a class:

```ts
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect, Layer } from "effect";
import { Gateway, Hibernation } from "@kalfa/transport/cloudflare";

// `handlers` is a Layer<Gateway, never, Hibernation>.
export class AppGateway extends Cloudflare.DurableObject<AppGateway>()(
  "AppGateway",
  Effect.gen(function* () {
    return Effect.gen(function* () {
      const gateway = yield* Gateway;

      return {
        fetch: gateway.upgrade(), // the app routes and checks first; Transport knows no route
        webSocketMessage: gateway.webSocketMessage,
        webSocketClose: gateway.webSocketClose,
        webSocketError: gateway.webSocketError,
      };
    }).pipe(Effect.provide(Layer.provide(handlers, Hibernation.layer)));
  }),
) {}
```

`Hibernation` is the seam to the platform. Its `upgrade` accepts a socket the object may sleep with and gives the `101`
response with the server's end, a `HeldSocket`: four calls of Alchemy's `Cloudflare.WebSocket` (`send`, `close`,
`getAttachment`, `setAttachment`) and nothing of the raw socket. `Hibernation.layer` is the one place that calls Alchemy.

### The stand-in

```ts
import * as MemoryGateway from "@kalfa/transport/cloudflare/memory";

const object = yield* MemoryGateway.make(handlers); // Effect<MemoryGateway, never, Scope>
const client = yield* object.connect(); // a Socket: the client's end, as the app's route would call gateway.upgrade()
yield* object.sleep; // the Layer and all its memory are dropped, and built again on the next event
```

It keeps the platform's rules, and the same laws run on it and on real workerd:

- An object with only hibernatable sockets sleeps after about 10 idle seconds (real workerd slept after 12), and its
  sockets stay open. `sleep` does it at once. Attachments live through it, and memory does not: the next event builds the
  Layer again.
- A message is delivered as soon as the client writes it, even while an earlier call still runs, one call for each
  message, in the order written.
- An attachment is stored as a `structuredClone` of its encoded value, so a change after the write is not seen. It is
  refused above 16,384 bytes of JSON text in UTF-8, or when it cannot be cloned, with Alchemy's own
  `WebSocketAttachmentError` of `write`, and the value before stays.
- A socket is a new object for each event: nothing may key on its identity.
- After a server `close`, `send` throws a `TypeError` and the attachment can still be read. The platform's close event
  comes later, in an event of its own, once the calls running on that socket have ended, with the server's own code, no
  reason and the attachment kept. A second `close` changes nothing. After a client `close`, one event comes, with the
  client's code and reason, and a `close()` that answers it gives no second event.
- A null or undefined attachment reads back as `missing`, as Alchemy reads it, and a value read is a clone too: what the
  reader changes is not seen by the next read.
- `stranger` is a socket accepted outside the gateway, with no attachment. `drop(socket)` is the one call only the
  stand-in has: the platform reports the socket broken, and the object gets an error event.

## What never shows a frame

A frame can hold a person's secret, such as the app's sign-in proof. `FormatError` holds a reason and nothing else: no
frame, no value and no cause. The `transport.socket` span has no attributes, and Transport writes no log line. So the
rendered error, the span and the logs never hold a frame.

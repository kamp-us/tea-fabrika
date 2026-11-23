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
the stream you gave to `socket` stays that failure and is never wrapped. When your stream ends nothing is closed, since
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
written to an end closes both with its code and reason. A write to a closed end fails with `SocketWriteError`. There is no
capacity, as a browser's `WebSocket.send` has none.

## What never shows a frame

A frame can hold a person's secret, such as the app's sign-in proof. `FormatError` holds a reason and nothing else: no
frame, no value and no cause. The `transport.socket` span has no attributes, and Transport writes no log line. So the
rendered error, the span and the logs never hold a frame.

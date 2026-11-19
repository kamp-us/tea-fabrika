# The transport is a two-way stream, not Rpc

The transport's face is a two-way stream in the shape of Effect's `Socket`, and the transport makes the socket. WebSocket and WebRTC both come from the first slice, with signaling and relay through the ledger's Durable Object.

## Considered Options

Effect's `Rpc`: rejected, because a request-then-answer face clashes with a program, which is a stream in and a stream out.

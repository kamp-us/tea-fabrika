# Transport owns its message format, and the wire speaks JSON-RPC 2.0

Every frame on a socket is one JSON-RPC 2.0 message, carrying schema-tagged JSON inside, because MCP, LSP and ACP clients already speak it and Effect's `effect/rpc` ships a JSON-RPC serialization. `@kalfa/transport` defines the message format as its own service, apart from the socket, and ships the serialization methods itself (JSON-RPC first), since a message format is part of the protocol, not something a provider supplies. Any place may still provide its own Layer, but each app uses the ones transport ships, joined at the top beside its place's socket Layer.

## Considered Options

- A new message format of our own: rejected, it gains nothing over a standard every outside client already speaks.
- The JSON-RPC Layer in libfabrika: rejected, every other app would have to import fabrika's library to talk on the wire.
- A provider package per format: rejected, a format is a published standard, not a vendor or a place.

## Consequences

The socket Layers stay per place (a browser, Node, a Durable Object). JSON-RPC 2.0 is two-way on its own: either side may send a request, and a notification with no id carries a stream of values, so this keeps the transport a two-way stream, not Rpc.

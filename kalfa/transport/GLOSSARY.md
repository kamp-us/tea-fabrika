# Transport

How values move between two places: the socket, the connection and the gateway, and the frames that cross them.
Who is talking belongs to Identity, and mail and pipes between programs belong to Program.

## Language

**Transport**:
A protocol for moving frames between two places, plus the Layers that make its sockets, such as WebSocket and WebRTC.
_Avoid_: link, channel, network layer, Rpc

**Socket**:
One end of a two-way stream of frames between two places.
_Avoid_: pipe, port

**Connection**:
One client's socket, held open at the gateway. A signal names the connection it is for.
_Avoid_: link, session, line, peer

**Gateway**:
The front door every client connects to; it admits or refuses each one.
_Avoid_: door, server, proxy, broker

**Connect**:
A client opening a connection to the gateway; the client always connects, and the brain never calls out.
_Avoid_: dial, call, knock, link

**Ping**:
The check that a connection is still alive; a connection that sends no pong back counts as dead.
_Avoid_: heartbeat, keepalive, beat

**Relay**:
Passing frames along for two places that cannot reach each other directly.
_Avoid_: proxy, bounce, tunnel

**Signal**:
One setup message two connections swap, through the gateway, before a direct socket opens between them.
_Avoid_: offer, negotiation, handshake

**Hello**:
The first thing a client sends on a new connection: its versions, its features, and the app's own sign-in proof, which Transport carries and never reads.
_Avoid_: handshake, initialize, greeting

**Challenge**:
The gateway's first frame on a new connection, the app's one-time value that the client's hello answers. Transport carries it and never reads it.
_Avoid_: nonce, greeting, banner

**Answer**:
What the gateway says back to a hello: the version it picked, the ping interval and the app's own answer (admitted, waiting, refused), which Transport carries whole.
_Avoid_: welcome, reply, response, result

**Protocol version**:
A whole number, 1 or more, naming one version of what the two ends speak; the gateway picks the highest one both list.
_Avoid_: revision, protocol id, level

**Feature**:
One optional thing a client says in its hello that it can do.
_Avoid_: capability, has, extension

**Format**:
How a value becomes a frame and back; JSON-RPC 2.0 is the one Transport ships.
_Avoid_: serialization, codec, encoding

**Frame**:
One piece of text on a socket, holding one JSON-RPC message.
_Avoid_: message, packet, letter

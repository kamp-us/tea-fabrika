
Plancheck-Version: 3

# Plan: @kalfa/transport, a client says hello and gets the app's answer whole (ticket 2068)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2068. Its parent is the settled protocol,
https://github.com/kamp-us/tea-fabrika/issues/1767, with the owner's answers in
https://github.com/kamp-us/tea-fabrika/issues/1767#issuecomment-7084366538 and
https://github.com/kamp-us/tea-fabrika/issues/1767#issuecomment-7084402755, from
https://github.com/kamp-us/tea-fabrika/issues/1902. It builds on the first piece of the package, merged in
https://github.com/kamp-us/tea-fabrika/pull/2219 (plan `.kalfa/quests/kalfa-transport-socket-PLAN.md`).

It adds the hello to the core entry point `@kalfa/transport`: `Transport.connect` on the client side, and on the
gateway side `Transport.challenge`, `Transport.accept` and `Transport.answer`, with Transport's one new error,
`NoSharedVersion`. It lands as two pull requests. Slice 1 says `Part of #2068`; slice 2, which needs the served gateway
of https://github.com/kamp-us/tea-fabrika/issues/2067, says `Closes #2068`.

Words: `kalfa/transport/GLOSSARY.md` (socket, connection, gateway, hello, feature, format, frame). This plan adds
three: challenge, answer and protocol version (see `## New names`).

```ts
// The whole idea, a sketch. The calls named here were read in Effect 4.1.3; nothing was type-checked.
import { Effect, Schema, Stream } from "effect"
import { Socket } from "effect/socket"
import { NodeSocket } from "@effect/platform-node"
import { Format, Transport } from "@kalfa/transport"

// The client: read the gateway's challenge, sign it, send the hello, get the app's answer whole.
const program = Effect.gen(function* () {
  const connected = yield* Transport.connect({
    versions: [1, 2],
    features: ["spans"],
    challenge: Challenge,                                   // the app's schema
    hello: { schema: Proof, make: (challenge) => sign(challenge) },  // make is an Effect: signing needs a key
    answer: SignInAnswer,                                   // the app's schema: admitted, waiting or refused
  })
  // connected: { version: 2, ping: Duration (30 seconds), answer: SignInAnswer["Type"], socket: Socket }
  yield* values.pipe(
    Transport.encode(Message), Transport.socket, Transport.decode(Message), Stream.runDrain,
    Effect.provideService(Socket.Socket, connected.socket),   // the same open connection; no second dial
  )
}).pipe(Effect.scoped, Effect.provide([NodeSocket.layerWebSocket(url), Format.layerJsonRpc]))

// The gateway, one frame at a time (2067's handlers): the app sends its challenge, then answers the hello.
const opened = Transport.challenge(Challenge)(challenge)       // Effect<Frame, FormatError, Format>
const hello = Transport.accept({ versions: [1], hello: Proof })(frame)
  // Effect<{ version, features, proof }, NoSharedVersion | FormatError, Format>
const reply = Transport.answer(SignInAnswer)({ version, ping, answer })  // or the NoSharedVersion itself
```

```json
{"jsonrpc":"2.0","method":"challenge","params":{"value":{"nonce":"k3J9w"}}}
{"jsonrpc":"2.0","method":"hello","params":{"value":{"versions":[1,2],"features":["spans"],"proof":{"key":"ed25519:AAAA","signature":"c2ln"}},"_meta":{"traceparent":"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"}}}
{"jsonrpc":"2.0","method":"answer","params":{"value":{"_tag":"Answer","version":1,"ping":30000,"answer":{"_tag":"admitted","name":"ada"}}}}
{"jsonrpc":"2.0","method":"answer","params":{"value":{"_tag":"NoSharedVersion","client":[3],"gateway":[1,2]}}}
```

## Doubts, at the top

Each is a call this plan takes and builds on. The first two change the type the ticket's first criterion writes, so the
lead reads them before signing. Neither is an owner question by the open-questions test: the owner could say no only by
going against a decision already made (Effect's `Socket` as the socket, and Identity's signer), as each says.

- **`connect` needs `Scope` and gives back the open socket (90%).** The ticket says `connect`'s needs do not change, and
  also that after `connect` the same open socket carries the stream, with no second socket. Both cannot hold. In Effect
  4.1.3 a socket is dialed each time its `reader` is acquired, and the connection lives as long as that acquisition's
  scope (`node_modules/effect/src/socket/Socket.ts`, the `Socket` doc: "Acquiring `reader` establishes the connection;
  the scope of the acquisition owns the connection lifecycle"; `makeWebSocket`: "dialing the WebSocket for each reader
  acquisition"). So an Effect that reads the challenge and then returns either closes the connection or opens a second
  one when the stream starts. The plan's `connect` acquires the reader once, in the caller's `Scope`, and returns
  `socket`, a `Socket.Socket` that hands that open connection to the chain. The owner's sketch was marked as not
  type-checked; the ruled points (Effect's own `Socket`, one connection) are kept. What would settle it: none needed, a
  type check proves it; the lead may show the owner the changed type.
- **`hello.make` returns an Effect (85%).** The sketch types it `(challenge) => H["Type"]`. The first real caller signs
  the challenge with the client's key, and Identity's ruled sign call is `Signed.make(change, signer)`, an
  `Effect<Signed<Change>, E, R>` with the signer's own E and R
  (https://github.com/kamp-us/tea-fabrika/issues/1766, the resolution). A plain function cannot call it. So `make` is
  `(challenge) => Effect<H["Type"], E, R>`, and its E and R join `connect`'s. Transport adds no failure of its own: E is
  the app's, passed through as it is (law H3). A caller with a plain value writes `Effect.succeed`. What would settle it:
  Identity's build ticket, the first caller.
- **The gateway's refusal crosses the socket as the error itself (80%).** `accept` fails with `NoSharedVersion` on the
  gateway, and the client must fail with it too. The answer frame's value is a union of `Answer` and `NoSharedVersion`,
  and `NoSharedVersion` is a `Schema.TaggedError`, so its JSON form is `Schema.toCodecJson`'s: its tag and its two
  fields, and no cause (a probe ran it, see `## Probes run while planning`). A gateway that names a version the client
  never listed fails `connect` as `NoSharedVersion` too, with `gateway` holding the one version it named (75%): the two
  ends share no version the client speaks. The other way was `FormatError "value"`; what would settle it is the review's
  read.
- **A failed `connect` closes the connection at once (75%), with code 1002 for Transport's own refusals and 1000 for the
  app's `make` failure.** RFC 6455 gives 1002 as "protocol error" (from memory, not fetched). Without this, a refused
  connection would stay open at the gateway until the caller's scope ends. What would settle it: 2067's `closed`
  handler, the first reader of the code.
- **Each step of `connect` is a child span (75%).** Decision 0063 says every step is traced, with span names
  `<package>.<call>`. `connect` runs three steps, so it makes `transport.connect` with three children,
  `transport.connect.challenge`, `transport.connect.hello` and `transport.connect.answer`. The hello runs once per
  connection, so the span cost 2066 avoided on `encode` does not apply. The doubt is the three-part name; the other way
  is span events on `transport.connect`. What would settle it: the review's read.
- **The hello carries the client's trace; the challenge and the answer carry none (80%).** The owner's answer 2 on 1902
  says a frame carries its sender's trace, so the gateway's `transport.accept` joins the client's trace. Whether a
  gateway's frame to a client carries one by default was not asked
  (https://github.com/kamp-us/tea-fabrika/issues/1767#issuecomment-7084366538, "What this cannot tell us"), so the
  gateway's two writers write none, as plain `encode` does.

## What changes, in one paragraph

A new file `src/Hello.ts` holds the four calls, the wire schemas of the three hello frames and `NoSharedVersion`. The
three frames are ordinary notifications of `Format`, with the method words `challenge`, `hello` and `answer`, so they go
through the same `Format` service as a value and the line format of 2066's F5 carries them too. The send and read of
one notification move from `Transport.ts` into `src/internal/message.ts`, so `Transport.ts` and `Hello.ts` share them.
A new `src/internal/connection.ts` reads one dialed connection frame by frame, keeps the frames that came in the same
batch as the answer, and hands the connection on as a `Socket.Socket`. Out of scope, each its own ticket: the served
gateway (2067), ping, `Stalled` and a wait for the first frame (https://github.com/kamp-us/tea-fabrika/issues/2069), the
waiting connection (https://github.com/kamp-us/tea-fabrika/issues/2070), the laws every socket Layer passes
(https://github.com/kamp-us/tea-fabrika/issues/2071), and `/webrtc` (2072 to 2075).

## Slices

1. **The hello on any Effect socket.** Branch `fabrikalfa/kalfa-transport-hello` (this worktree). `Hello.ts`,
   `internal/message.ts`, `internal/connection.ts`, the change to `Transport.ts` and `index.ts`, the README, the three
   glossary words, the test gateway and the dialing stand-in in test support, and every law below but G1. It lands
   whole: a client connects over the memory stand-in and over Effect's Node WebSocket Layer, gets the app's answer
   whole, and runs a chain on the same connection. It says `Part of #2068`.
2. **The test app on the served gateway.** After 2067 lands. The test app sends its challenge from `serve`'s `open`
   handler, keeps it in the connection's saved note, lets the object sleep, and answers the hello from `frame`. Law G1.
   Tests and one README paragraph, no product line. It says `Closes #2068`. Its laws row is amended once 2067's plan
   names the sleep harness and the file it lives in.

## Searched first

- The ticket whole; the parent 1767 with all six comments; 1902; Identity's protocol
  https://github.com/kamp-us/tea-fabrika/issues/1766 (its sign call is an Effect, and the gateway owns the challenge).
- The sibling tickets 2067 and 2069 to 2075, for what they need from this one: 2067 sends the challenge from `open` and
  reads the trace a frame carries; 2069 puts the ping on the answer's interval and may add a wait for the first frame,
  as a setting; 2070 runs the stream on the socket `connect` leaves open after a waiting answer; 2071's laws need a
  socket that keeps Effect's reader contract, which the handed-on socket must keep too; 2072 reaches connections by id.
- Decisions 0016, 0039, 0040, 0063, 0072, 0076, 0079 and 0081, `kalfa/AGENTS.md`, `kalfa/transport/GLOSSARY.md`,
  `kalfa/identity/GLOSSARY.md`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and the kalfa glossaries for
  "hello", "challenge", "protocol version|NoSharedVersion|no shared version", "features|has" and "handshake". Every hit
  read: 0073 and 0077 name the hello only in passing (0077 leaves open whether a job token rides in it), Identity's
  glossary says sign-in avoids the word hello, and the pattern `effect-differences-say-why.md` notes that a challenge
  kept only in memory is lost when a Durable Object sleeps. Patterns read: `effect-errors-keep-their-cause.md`,
  `effect-pure-domain-returns-result.md`, `effect-swallowed-failures-leave-a-trace.md`, `durable-objects-sleep.md`.
- The package as merged: every file of `kalfa/transport/src/`, its README and manifest, its lint overrides in
  `.oxlintrc.json` (L1 for the whole package, L2 for `Transport.ts`), and the law ids in its test files.
- `kalfa/secrets/src/Errors.ts` and `kalfa/config/src/Snapshot.ts`, for the rule that a cause is held as `Redacted`.
- Today's `next/packages/libfabrika/src/transport/Hello.ts`, `Handshake.ts` and `Wire.ts`, as a map only: today's door
  sends `challenge` first, versions are whole numbers of 1 or more, the hello says `has`, the ping is in milliseconds,
  and `selectVersion` picks the highest shared version.
- Installed versions in the lockfile: `effect` 4.1.3 (patched: the arbitrary model, `TestConsole`,
  `NodeHttpServer.layerTest`'s host, no socket file), `@effect/platform-node` 4.1.3, `vitest` 5.0.5. In Effect 4.1.3,
  read: `src/socket/Socket.ts` (the `Socket` and `Reader` contract, `toChannelWithReader`, `makeWebSocket`,
  `fromWebSocket`, the five `SocketError` reasons), `Schema.Redacted` and `Schema.RedactedFromValue` (their
  `toCodecJson`), `Schema.DurationFromMillis`, `Schema.Duration`.

## Probes run while planning

One throwaway script in the scratch folder named in the brief, run with Node against this worktree's installed Effect.
Nothing was written into the repo, installed or committed. No socket was opened.

- `Schema.toCodecJson` of a `Schema.TaggedError` with two array fields writes
  `{"_tag":"NoSharedVersion","client":[1,2],"gateway":[3]}` and reads it back as an instance of the class. Inside a
  `Schema.Union` with a tagged struct it reads back as the class too.
- `Schema.toCodecJson` of `Schema.Redacted(Schema.Defect())` writes the hidden cause in full:
  `{"_tag":"WithCause","cause":{"name":"Error","message":"secret-xyz"}}`, while `String` and `JSON.stringify` of the
  error give `"cause":"<redacted>"`. So an error whose JSON form must show its cause as a placeholder cannot use
  `Schema.Redacted` as it ships; its `disallowJsonEncode` option makes the encode fail instead. This plan's errors keep no
  cause, and `## Findings` 1 records what this means outside the task.
- `Schema.toCodecJson(Schema.Duration)` writes `{"_tag":"Millis","value":30000}`, so the ping crosses as whole
  milliseconds through its own schema instead.
- `Schema.toCodecJson(Schema.Int)` refuses to write `NaN` and `1.5`, so a version that is no whole number fails the
  hello's encode.

## How others do it

- **Elm** (from memory, not fetched): a port has no handshake; the app sends its first message as data. The closest
  shape is a decoder per message: the challenge, the hello and the answer are three decoders, each its own schema.
- **Erlang/OTP** (from memory, not fetched): the distribution handshake sends `send_name` with the version flags, and the
  other side answers `recv_status` with `ok`, `nok` or `not_allowed`, one status message before any data. Cowboy's
  `websocket_init` may send the first frame, which is 2067's `open`. That is a status answer before the stream, and the
  gateway's first frame as the challenge.
- **SSH** (RFC 4253, from memory, not fetched): each side sends a version line, then `KEXINIT` lists algorithms in order
  of preference, and the first client algorithm the server also has wins. The server's key-exchange carries a fresh
  value the client signs. That is the challenge first, then a signed hello.
- **TLS 1.3** (RFC 8446, from memory, not fetched): the client lists `supported_versions` and the server picks one and
  names it in its answer; a client that gets a version it did not offer aborts. That is `accept` picking and the
  client's own check (law H5's class (j)).
- **WebSocket subprotocols** (RFC 6455, from memory, not fetched): the client lists, the server picks one, and a client
  that gets one it did not list fails the connection. A browser cannot read headers, so decision 0040 rules them out;
  the version pick rides in frames instead.
- **MCP** (from memory, not fetched): `initialize` carries the client's `protocolVersion` and capabilities, and the
  server answers with the version it speaks; a client that cannot speak it disconnects. Its "capabilities" are our
  features.
- **Effect** (read in 4.1.3): a handshake is "plain code placement" between acquiring the reader and the first pull
  (the `Socket` doc), and every reader acquisition is a new dial. So the handshake and the stream must share one
  acquisition, which is why `connect` hands on the open connection.

## The shape

### The package after this slice

```text
kalfa/transport/src/
  index.ts               adds NoSharedVersion and the types Connected, Hello, Answer
  Transport.ts           the five stream functions, now on internal/message.ts; re-exports the four hello calls
  Hello.ts               new: connect, challenge, accept, answer, NoSharedVersion, the hello's wire schemas
  internal/message.ts    new: send and read one notification of a method, through Format (moved out of Transport.ts)
  internal/connection.ts new: one dialed connection read frame by frame, and its hand-on as a Socket
  Format.ts, Frame.ts, Traced.ts, MemorySocket.ts, internal/jsonRpc.ts   unchanged
```

Callers write `Transport.connect`, `Transport.accept`, `Transport.challenge` and `Transport.answer`, as the owner's
entry-point table puts `connect` and `accept` in the core.

### The types

```ts
// kalfa/transport/src/Hello.ts, a sketch. Doc blocks left out.

/** A protocol version: a whole number of 1 or more. */
const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/** The client and the gateway list no version in common. Public facts only: the two lists. No cause. */
export class NoSharedVersion extends Schema.TaggedError<NoSharedVersion, { readonly brand: unique symbol }>()(
  "NoSharedVersion",
  { client: Schema.Array(Schema.Int), gateway: Schema.Array(Schema.Int) },
) {}

/** What connect gives back: the version the gateway picked, its ping interval, the app's answer, and the open socket. */
export interface Connected<A> {
  readonly version: number
  readonly ping: Duration.Duration
  readonly answer: A
  readonly socket: Socket.Socket            // the one connection connect dialed; reading it never dials again
}

/** What accept gives the gateway: the version it picked, the client's features, and the app's proof, decoded. */
export interface Hello<P> {
  readonly version: number
  readonly features: ReadonlyArray<string>
  readonly proof: P
}

/** What the gateway answers a hello with, when they share a version. */
export interface Answer<A> {
  readonly version: number
  readonly ping: Duration.Duration
  readonly answer: A
}

export const connect: <
  C extends Schema.Top, H extends Schema.Top, A extends Schema.Top, E = never, R = never,
>(options: {
  readonly versions: ReadonlyArray<number>
  readonly features: ReadonlyArray<string>
  readonly challenge: C
  readonly hello: { readonly schema: H; readonly make: (challenge: C["Type"]) => Effect.Effect<H["Type"], E, R> }
  readonly answer: A
}) => Effect.Effect<
  Connected<A["Type"]>,
  NoSharedVersion | Socket.SocketError | FormatError | E,
  Socket.Socket | Format | Scope.Scope | R
    | C["DecodingServices"] | H["EncodingServices"] | A["DecodingServices"]
>

export const challenge: <C extends Schema.Top>(schema: C) =>
  (value: C["Type"]) => Effect.Effect<Frame, FormatError, Format | C["EncodingServices"]>

export const accept: <H extends Schema.Top>(options: {
  readonly versions: ReadonlyArray<number>
  readonly hello: H
}) => (frame: Frame) => Effect.Effect<Hello<H["Type"]>, NoSharedVersion | FormatError, Format | H["DecodingServices"]>

export const answer: <A extends Schema.Top>(schema: A) =>
  (reply: Answer<A["Type"]> | NoSharedVersion) => Effect.Effect<Frame, FormatError, Format | A["EncodingServices"]>
```

`accept` is pure in the ticket's sense: it reads no socket, no clock and no state, and needs only `Format` (and the
proof schema's own services). It returns an Effect, not a `Result`, because the format is a service (85%); the pattern
`effect-pure-domain-returns-result.md` is for rules with no service, and the version pick inside is a plain function.

### The wire values

```ts
// kalfa/transport/src/Hello.ts, a sketch. Each is the value of one notification, written by Format's codecFor.

// Whole milliseconds above 0, read into a Duration. Zero, a negative, a fraction and infinity are refused both ways.
const Ping = Schema.Int.check(Schema.isGreaterThan(0)).pipe(/* decodeTo Duration, as Schema.DurationFromMillis */)

const HelloValue = <H extends Schema.Top>(proof: H) =>
  Schema.Struct({ versions: Schema.Array(Version), features: Schema.Array(Schema.String), proof })

const AnswerValue = <A extends Schema.Top>(answer: A) =>
  Schema.Union([Schema.TaggedStruct("Answer", { version: Version, ping: Ping, answer }), NoSharedVersion])

// the method words: "challenge" (gateway first), "hello" (client), "answer" (gateway). A value's frame stays "value".
```

- Extra keys in a hello value are ignored, as the 2066 frame ignores them (80%), so a later field does not break an
  older gateway. A hello with `has` and no `features` fails: `features` is required.
- The pick is the highest version in both lists. A client list or a gateway list that is empty shares none.
- `NoSharedVersion`'s `client` and `gateway` are typed `Int`, not `Version`, so the gateway can report a list exactly as
  it read it.

### `connect`, step by step

```ts
// kalfa/transport/src/Hello.ts, a sketch of the body.
export const connect = (options) => Effect.gen(function* () {
  const open = yield* Connection.open            // internal/connection.ts: acquires the reader once, in a child scope
  //   of the caller's Scope; frames read as text one by one, a batch's extra frames kept in order
  const challenge = yield* Effect.withSpan("transport.connect.challenge")(
    Message.read(options.challenge, "challenge")(yield* open.next))     // FormatError text | message | method | value
  const proof = yield* Effect.withSpan("transport.connect.hello")(Effect.gen(function* () {
    const proof = yield* options.hello.make(challenge)                  // the app's own E, as it is
    yield* open.write(yield* Message.write(HelloValue(options.hello.schema), "hello", "current span")({
      versions: options.versions, features: options.features, proof }))  // FormatError "value" for (e) and (f)
  }))
  const reply = yield* Effect.withSpan("transport.connect.answer")(
    Message.read(AnswerValue(options.answer), "answer")(yield* open.next))
  // NoSharedVersion from the gateway: fail with it. A version the client did not list: NoSharedVersion as well.
  return { version, ping, answer, socket: open.handOn }
}).pipe(Effect.withSpan("transport.connect"), /* on failure: close with 1002, or 1000 for make's own error */)
```

`open.handOn` is a `Socket.Socket` built with `Socket.make`:

- Its first reader acquisition gets the open connection: its `pull` gives first the frames that came in the batch with
  the answer, in order, then the connection's own pulls. It never dials.
- It keeps Effect's reader contract: closing that acquisition's scope fails a pull waiting on it, and closes the
  connection with code 1000. `Transport.socket` already writes 1000 when its chain ends, so the far end sees one close.
- A second reader acquisition, while the first is live or after it closed, fails with `SocketError` of
  `SocketOpenError` (kind `Unknown`) and reads nothing (85%): a real dial would open a new connection with a new
  challenge, and the handed-on socket has only one.
- Its writer is the dialed socket's own writer.

### The gateway's calls

- `challenge(C)(value)` writes one notification of method `challenge` with the value under `C`'s codec and no trace.
- `accept({ versions, hello })(frame)` reads one notification of method `hello`, decodes the value with
  `HelloValue(hello)`, then picks. It fails `FormatError` (text, message, method, value, in 2066's order) or
  `NoSharedVersion { client: <the hello's list>, gateway: <versions> }`.
- `answer(A)(reply)` writes one notification of method `answer`: an `Answer` as `{ _tag: "Answer", version, ping,
  answer }`, or a `NoSharedVersion` as its own JSON form. A ping it cannot write fails `FormatError "value"`.
- None of them touches a socket. 2067's `Connection.send` sends what they give.

### Errors and the cause rule

Transport's errors are `FormatError` (2066) and `NoSharedVersion` (new). Neither keeps a cause, on purpose: a frame can
hold the app's sign-in proof, and a `SchemaError`'s issue can quote the value it refused (2066's reasoning, kept). The
lead's rule for this quest says a cause, when an error has one, is `Redacted` only, and the error's JSON form crosses
`Schema.toCodecJson` with its tag and fields and the cause as a placeholder. The probe shows `Schema.Redacted` as Effect
ships it does not give that placeholder. So the rule here is held by having no cause at all, and law E2 fails the day
someone adds one in Effect's shipped form.

### Spans

| Span | Made by | Attributes on success | Fails with |
|---|---|---|---|
| `transport.connect` | `connect` | `kalfa.transport.version`, `kalfa.transport.versions`, `kalfa.transport.features` | whatever `connect` fails with |
| `transport.connect.challenge` | `connect`, step 1 | none | `FormatError`, `SocketError` |
| `transport.connect.hello` | `connect`, step 2 | none | the app's `make` error, `FormatError`, `SocketError` |
| `transport.connect.answer` | `connect`, step 3 | none | `FormatError`, `NoSharedVersion`, `SocketError` |
| `transport.challenge`, `transport.answer` | the gateway's writers | none | `FormatError` |
| `transport.accept` | `accept` | the same three as `transport.connect` | `FormatError`, `NoSharedVersion` |

A step that is not reached leaves no span. Every span is made with Effect's own `Effect.withSpan` or `Effect.fn`, and no
span holds the challenge, the proof or the answer. Under `Effect.withTracerEnabled(false)`, as the span log's own
connection runs (decision 0079), none is made and the hello carries no trace.

## One value traced: a client is admitted, then reads a value that came with the answer

1. The client provides one end of the dialing stand-in and `Format.layerJsonRpc`, and calls `connect` with versions
   `[1, 2]`, features `["spans"]`, and the test app's three schemas.
2. `Connection.open` acquires the reader once, in a child of the caller's scope: the stand-in counts one dial, and the
   test gateway, on the far end, sends
   `{"jsonrpc":"2.0","method":"challenge","params":{"value":{"nonce":"k3J9w"}}}`.
3. Step 1, under `transport.connect.challenge`: the frame is read, the method is `challenge`, and the app's `Challenge`
   schema decodes `{ nonce: "k3J9w" }`. Transport read nothing of it but the method.
4. Step 2, under `transport.connect.hello`: `make` signs the nonce (in the test app: a keyed word made from it) and gives
   `{ key: "ed25519:AAAA", signature: "c2ln" }`. The hello frame goes out with that proof, the two versions, the feature,
   and `_meta.traceparent` naming the `transport.connect.hello` span.
5. The gateway's `accept({ versions: [1] })` reads it: method `hello`, the value fits, the shared versions are `[1]`, so
   it gives `{ version: 1, features: ["spans"], proof }` under `transport.accept`, with `kalfa.transport.version` 1.
   The test app checks the proof against its nonce and answers `admitted` with ping 30 seconds. `answer` writes
   `{"_tag":"Answer","version":1,"ping":30000,"answer":{"_tag":"admitted","name":"ada"}}` and, right after it, one value
   frame, `Progress 1 of 3`; the memory pair hands both to the client's next pull as one batch.
6. Step 3, under `transport.connect.answer`: the first frame of the batch is the answer; version 1 is in the client's
   list. The value frame is kept, unread. `connect` returns `{ version: 1, ping: 30 seconds, answer: admitted "ada",
   socket }`.
7. The chain runs on `socket`: its first pull gives the kept `Progress 1 of 3`, then the frames that come after. The
   stand-in still counts one dial. When the chain's scope ends, `Transport.socket` writes 1000 and the gateway sees one
   close.
8. A second client lists `[3]`. `accept` fails `NoSharedVersion { client: [3], gateway: [1] }`; the gateway writes it
   with `answer`; the client's step 3 decodes the same error, fails with it, and closes with 1002. Both
   `transport.accept` and `transport.connect` end failed with it, and neither holds the proof.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/transport/src/Transport.test-support.ts`, beside 2066's, so the
package still needs no fast-check. The ids below are this plan's own; the test support names them `hello (a)` and so on,
apart from 2066's `(a)` to `(u)`. Each law applies, to each value it draws, one value made for every class it names, so
every class is reached in every run. Each class that targets a check passes every check before it, in the order of
"`connect`, step by step" and "The gateway's calls".

The test app, also in test support: a `Challenge` (`{ nonce: string }`), a `Proof` (`{ key, signature }`, where the
signature is made from the nonce, so a proof for another nonce fails the app's check) and a `SignInAnswer`, a tagged
union of `admitted { name }`, `waiting { code }` and `refused { reason }`. The test gateway runs `challenge`, `accept`
and `answer` on the far end of a socket, then echoes values. The dialing stand-in is a `Socket.Socket` whose every
reader acquisition makes a new `MemorySocket.pair`, starts the test gateway on its far end, and counts one dial, as a
real WebSocket dials once per acquisition.

- `handshakes` (what the client meets):
  (a) a first frame that is no notification of the format: no JSON, a batch, a notification with an `id`;
  (b) a first frame that is a notification of another method: `value`, `hello`, `answer`, `Challenge`;
  (c) a challenge notification whose value the app's schema refuses: a wrong type, a missing field, a branded field out
  of its range;
  (d) a valid challenge where the app's `make` fails with the app's own tagged error;
  (e) client versions that are no whole number of 1 or more: 0, -1, 1.5, `NaN`, `Infinity`, beside a valid one;
  (f) a proof the hello schema cannot write: under `Schema.Unknown`, a function, a cycle, `undefined` in an array;
  (g) an answer that is no notification, or a notification of another method (`value`, `challenge`, `Answer`);
  (h) an `answer` notification whose value does not fit: the app's answer refused by its schema, a ping of 0, -1, 1.5,
  `"30000"` or missing, a version of 0 or missing, an unknown `_tag`;
  (i) the gateway's own `NoSharedVersion` reply, with generated lists;
  (j) a valid `Answer` naming a version the client did not list;
  (k) the answer and 1 to 10 value frames arriving in one batch (one `writeAll` on the far end);
  (l) the far end closing before the challenge, and after the hello before the answer, with codes 1000, 1001, 1006,
  1011 and 4000 to 4999, with and without a reason;
  (m) the app's three answers, `admitted`, `waiting` and `refused`, each holding awkward text (2066's value classes (a)
  to (d): quotes, control characters, a lone surrogate, a `BigInt`-bearing field).
- `versionLists` (both sides):
  (n) lists that share: one shared, several shared (the highest wins), unordered, with repeats, and the gateway's
  highest missing from the client's list;
  (o) lists that share none: disjoint, the client's empty, the gateway's empty.
- `hellos` (what `accept` reads):
  (p) a hello frame that is no notification, or a notification of another method;
  (q) a `hello` notification whose value does not fit: `versions` missing, not an array, or holding 0, 1.5 or `"1"`;
  `features` holding a number; `has` in place of `features` (today's word); a proof the app's schema refuses;
  (r) challenges and proofs drawn from 2066's value classes (a) to (d), under the app's schemas, to cross intact.
- `pings` (what `answer` writes):
  (s) pings it cannot write: zero, negative, `Duration.infinity`, a fraction of a millisecond.
- `dials` (the connection after `connect`):
  (t) a chain on `Connected.socket` after each of (m): each end sends 0 to 20 values, and either end's chain ends first;
  (u) the chain's stage failing with its own error after 0 to 5 values, while a pull waits;
  (v) a second reader acquisition of `Connected.socket`, while the first is live and after it closed.
- `secretFlows`:
  (w) a generated secret placed in the challenge, in the proof, in the answer, and in the refused frames of (a), (c),
  (h) and (q); looked for as it is, JSON-escaped, base64, base64url and `encodeURIComponent` (2066's `secretForms`).
- `errors`:
  (x) `NoSharedVersion` with generated lists (empty, one, 1 to 20 numbers), and `FormatError` of each reason.
- `tracing`:
  (y) the tracer on, and off with `Effect.withTracerEnabled(false)`;
  (z) a hello sent under a span of Effect's own tracer, with generated parent spans.

No law waits on real time. A law that checks something does not hang runs the call forked and moves `TestClock` past a
timeout. W2 alone runs under `it.live`, since it opens a real socket.

## Laws

Run caps: every property law runs 100 to 300 runs, in memory, under `it.effect`. The tests step reports any law over
10 s and lowers its runs, never its classes. Each `*.types.test.ts` file also runs under vitest, so it holds no
`declare const`. "Equal" means `Schema.toEquivalence` of the schema named, never `toEqual` on decoded classes. Each law
id is free in the package: the law id check (`node oxlint-plugins/law-ids.ts`) ran clean, and 2066 used P1, E1, L1 to
L3, D1 to D4, F1 to F5, T1 to T3, C1 to C5, M1, S1, S2, X1 to X3 and W1.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| H1, the app's answer comes back whole: draw (m), (n) and (r); over the dialing stand-in with the test gateway, `connect` succeeds with `version` equal to the highest number in both lists, `ping` equal to the gateway's generated ping (1 to 600000 whole ms), `answer` equal by `SignInAnswer`'s equivalence to what the test app answered, and `make` called exactly once, with a challenge equal by `Challenge`'s equivalence to the one the gateway sent. 300 runs | test | Effect Arbitrary: handshakes | give back a fixed `admitted` answer: (m) red for `waiting` and `refused`; pick the lowest shared version in `accept`: (n) red; write the challenge with `JSON.stringify` in place of the codec: (r) red on the `BigInt` field | kalfa/transport/src/Connect.test.ts |
| H2, a first frame that does not fit: for (a) `connect` fails `FormatError` of `text` or `message`, for (b) of `method`, for (c) of `value`; never a defect; `make` is never called; the far end reads no hello frame and reads close 1002 before `connect`'s scope ends (checked by a fork that holds the scope open). 300 runs | test | Effect Arbitrary: handshakes | `JSON.parse` the first frame with no catch: (a) is a defect, red; skip the method compare: (b) red; decode the challenge with `Schema.Unknown`: (c) red; leave the connection open until the scope ends: red | kalfa/transport/src/Connect.test.ts |
| H3, the app's failure stays the app's: for (d), `connect` fails with the very error `make` failed with (same tag, equal fields), not a `FormatError` or a `SocketError`; the far end reads no hello frame and reads close 1000. 100 runs | test | Effect Arbitrary: handshakes | wrap `make`'s error in `FormatError "value"`: (d) red; close with 1002 for it: (d) red | kalfa/transport/src/Connect.test.ts |
| H4, the hello a client sends: for (e) and (f), `connect` fails `FormatError "value"` and the far end reads no hello frame; for every valid draw of (n) and (r), the hello frame is one notification of method `hello` whose value's own keys are exactly `versions`, `features` and `proof`, with `versions` and `features` as given (order and repeats kept) and `proof` equal to the codec's writing of `make`'s result. 300 runs | test | Effect Arbitrary: handshakes | write the features under `has`: red; write the versions with no `Int` check: (e) red, since 1.5 crosses; write the proof with `JSON.stringify`: (f) red, since a function's key vanishes and a frame goes out | kalfa/transport/src/Connect.test.ts |
| H5, an answer that does not fit, or a refusal: for (g) `connect` fails `FormatError` of `text`, `message` or `method`; for (h) of `value`; for (i) it fails with a `NoSharedVersion` equal to the one the gateway wrote; for (j) with `NoSharedVersion { client: <its list>, gateway: [<the named version>] }`; each closes with 1002. 300 runs | test | Effect Arbitrary: handshakes | skip the method compare on the answer: (g) red; read the ping with `Schema.DurationFromMillis` as it ships: (h) red, since 0 and 1.5 pass; read a `NoSharedVersion` reply as an answer with no version: (i) red; skip the client's own version check: (j) red | kalfa/transport/src/Connect.test.ts |
| H6, frames that came with the answer go to the chain: for (k) and (t), the chain on `Connected.socket` reads first every value frame of the answer's batch, in order, then the later ones; no frame is lost and none is read twice. 200 runs | test | Effect Arbitrary: dials | drop the frames left in the answer's batch: (k) red; give them after the next pull's frames: (k) red | kalfa/transport/src/Connect.test.ts |
| H7, a close during the hello: for (l), `connect` fails with Effect's `SocketError` holding `SocketCloseError` of that code and reason, 1000 included; it never succeeds, never hangs (a fork, `TestClock` moved 60 s) and is never a defect. 200 runs | test | Effect Arbitrary: handshakes | end the read cleanly on close 1000, as `socket` does: (l) red, `connect` hangs on its next frame | kalfa/transport/src/Connect.test.ts |
| A1, `accept` picks the version: for (n), `accept` gives `version` equal to the highest number in both lists, with the hello's `features` and a `proof` equal by `Proof`'s equivalence; for (o), it fails `NoSharedVersion { client, gateway }` with the two lists exactly as given. 300 runs | test | Effect Arbitrary: versionLists | pick the gateway's highest without checking the client's list: (n) red; pick the client's first: (n) red; give version 0 when nothing is shared: (o) red | kalfa/transport/src/Accept.test.ts |
| A2, `accept` refuses a hello that does not fit: for (p), `FormatError` of `text`, `message` or `method`; for (q), of `value`; never a defect, never a `NoSharedVersion`. 300 runs | test | Effect Arbitrary: hellos | skip the method compare: (p) red; decode the proof with `Schema.Json`: (q) red for a proof the app refuses; read `has` when `features` is missing: (q) red | kalfa/transport/src/Accept.test.ts |
| A3, the gateway's writers: for (r), `challenge` gives one notification of method `challenge` whose value is the codec's writing and whose `params` hold no `_meta`; for (m) × (n), `answer` of an `Answer` gives method `answer` and `{ _tag: "Answer", version, ping: <whole ms>, answer }`; `answer` of a `NoSharedVersion` gives `{ _tag, client, gateway }`; for (s), `answer` fails `FormatError "value"` and gives no frame. 300 runs | test | Effect Arbitrary: pings | write the ping with `Schema.Duration`'s own codec: red, `{"_tag":"Millis"}` crosses; round a fraction to whole ms: (s) red; let `Duration.infinity` through as `Infinity`: (s) red | kalfa/transport/src/Accept.test.ts |
| O1, one dial: for (t) on the dialing stand-in, across `connect` and the chain the stand-in counts exactly one reader acquisition, the test gateway sees one connection and sends one challenge, and the gateway reads close 1000 once the chain's scope ends. The same law body runs in W2 on a real socket. 200 runs | test | Effect Arbitrary: dials | run the handshake inside `Effect.scoped` and give back the dialed `Socket.Socket` itself: (t) red, two dials, and the chain reads a second challenge | kalfa/transport/src/Handover.test.ts |
| R1, the handed-on socket keeps Effect's reader contract: for (u), the chain fails with the stage's own error while a pull waits, within a fork and a `TestClock` move of 60 s, and the far end reads the close; for (v), a second acquisition fails `SocketError` of `SocketOpenError` and reads no frame; closing the first acquisition's scope closes the connection with 1000. 200 runs | test | Effect Arbitrary: dials | hand on the dialed reader's `pull` with no finalizer: (u) red, the chain hangs; let a second acquisition read the same frames: (v) red | kalfa/transport/src/Handover.test.ts |
| T4, the hello's trace: for (z), the hello frame's `params._meta.traceparent` names the `transport.connect.hello` span's trace id and span id, and `accept`'s span is a child of it when the gateway runs the hello frame's trace as its parent; the frames `challenge` and `answer` write hold no `_meta`; under (y) off, the hello frame holds no `_meta`. 100 runs | test | Effect Arbitrary: tracing | write the hello with plain `encode`: (z) red; write the gateway's current span into the answer: red; write a trace with the tracer off: (y) red | kalfa/transport/src/Trace.test.ts |
| S3, `connect`'s spans: for each draw of (m), (a) to (d) and (g) to (j), the tracer held in memory holds `transport.connect` and, under it in order, `transport.connect.challenge`, `transport.connect.hello` and `transport.connect.answer` for the steps reached and no others; a refusal ends the step where it happened and `transport.connect` failed with that error (`Cause.findErrorOption`, same tag); on success `transport.connect` has exactly the attributes `kalfa.transport.version`, `kalfa.transport.versions` and `kalfa.transport.features`. 200 runs | test | Effect Arbitrary: handshakes | make no span for the answer step: red; end the spans ok on a `NoSharedVersion` from the gateway: (i) red; add a `kalfa.transport.answer` attribute: red | kalfa/transport/src/Spans.test.ts |
| S4, the gateway's spans: `accept` makes one `transport.accept` with the same three attributes on success, failed with `NoSharedVersion` for (o) and `FormatError` for (p) and (q); `challenge` makes one `transport.challenge`; `answer` makes one `transport.answer`, failed for (s). 200 runs | test | Effect Arbitrary: hellos | build `accept` with `Effect.fnUntraced`: red; end `transport.accept` ok on (o): red | kalfa/transport/src/Spans.test.ts |
| S5, the tracer off: for (y) off, `connect`, `accept`, `challenge` and `answer` leave the tracer held in memory empty and `connect` still succeeds for (m); with (y) on, the same run makes spans, so empty means none were made. 100 runs | test | Effect Arbitrary: tracing | turn tracing on inside `connect` with `Effect.withTracerEnabled(true)`: (y) red | kalfa/transport/src/Spans.test.ts |
| X4, [secrets] spans hold no hello: for every flow of (w), no span name, attribute, event or failure text as Effect's tracer writes it (the error's `message`, `Cause.pretty` with its stack) holds the secret in any form. 300 runs | test | Effect Arbitrary: secretFlows | annotate `transport.connect.challenge` with the challenge: (w) red; put the answer in an attribute: (w) red | kalfa/transport/src/Leak.test.ts |
| X5, [secrets] logs hold no hello: for every flow of (w), no line at any level of a recording logger holds the secret in any form. 300 runs | test | Effect Arbitrary: secretFlows | `Effect.logDebug` the proof in `accept`: (w) red | kalfa/transport/src/Leak.test.ts |
| X6, [secrets] errors hold no hello: for each failed flow of (w), `Cause.pretty` of the exit with its stack, `String`, `JSON.stringify`, `Inspectable.format`, every text its own properties reach, and the `Schema.toCodecJson` writing of each error Transport made hold the secret in no form. 300 runs | test | Effect Arbitrary: secretFlows | keep the `SchemaError` as `FormatError`'s `cause: Schema.Redacted(Schema.Defect())`: (w) red, since the codec writes the cause; put the refused challenge text in `FormatError`'s message: (w) red | kalfa/transport/src/Leak.test.ts |
| E2, the errors' JSON form: for (x), `Schema.toCodecJson(NoSharedVersion)` writes an object whose own keys are exactly `_tag`, `client` and `gateway`, and reads it back equal; `FormatError` writes exactly `_tag` and `reason`; no error class the package exports has a `cause` field among its schema's fields. 200 runs | test | Effect Arbitrary: errors | add `cause: Schema.Redacted(Schema.Defect())` to `NoSharedVersion`: (x) red, a fourth key; add a `message` field: (x) red | kalfa/transport/src/Errors.test.ts |
| E1, Transport's own failures (2066's law, its list grows): no export or member is named `Unreachable` or `TransportUnavailable`, and the package's error classes are exactly `FormatError` and `NoSharedVersion` | test | scenario: the two entry points' module objects at head | export a `ConnectError` class from `Hello.ts`: red; rename `NoSharedVersion` to `Unreachable`: red | kalfa/transport/src/Package.test.ts |
| P2, today's `has` appears nowhere: in every product `.ts` file of the package with comment lines removed, and in the README's code blocks, no key or property named `has` (`has:`, `has?:`, `"has"`, `'has'`) | test | scenario: the package's product files at head; no generated input says what a file holds | add `has: Schema.Array(Schema.String)` to the hello value: red | kalfa/transport/src/Package.test.ts |
| L4, the hello stays apart from Identity and the frame: `Hello.ts`, `internal/message.ts` and `internal/connection.ts` import no `./internal/jsonRpc.ts`; L1's package rule refuses `@kalfa/identity` in them, as in every product file | lint | lint | import `@kalfa/identity` in `Hello.ts`: lint red; import `./internal/jsonRpc.ts` in `Hello.ts` and call its writer: lint red | .oxlintrc.json |
| D5, `connect`'s type: for the test app's schemas and a `make` of `Effect<Proof, SignError, Signer>`, `connect` is `Effect<Connected<SignInAnswer>, NoSharedVersion \| SocketError \| FormatError \| SignError, Socket.Socket \| Format \| Scope \| Signer>`, `make`'s parameter is typed `Challenge["Type"]` with no annotation (a line reads `challenge.nonce`), and the opening sketch's chain on `connected.socket` provided the memory stand-in and `Format.layerJsonRpc` is `Effect<void, ..., never>` and runs | type | type | type `make`'s parameter as `unknown`: the `challenge.nonce` line fails, red; drop `Scope` from the needs: red; drop `E` from the errors: the `SignError` line fails, red | kalfa/transport/src/Hello.types.test.ts |
| D6, every way the options are typed: no type arguments; explicit ones; a schema typed `Schema.Top`, `Schema.Unknown` and `any`; a challenge and an answer that need a decoding service and a proof that needs an encoding service (each need shows in `R`); `versions` as a readonly tuple `[1, 2] as const`; `features` as `[]`; `make` giving `Effect.succeed(proof)`; all compile; `make` giving a plain value, and `make` giving an Effect of another type, each fail (`@ts-expect-error`). The run-time guard where `any` leaves a hole is H4's (f) | type | type | type `make` as `(c) => H["Type"] \| Effect<H["Type"]>`: the plain-value line compiles, the unused `@ts-expect-error` is red; type `features` as `Array<string>`: the `as const` line fails, red; drop `A["DecodingServices"]`: the decoding-service line fails, red | kalfa/transport/src/Hello.types.test.ts |
| D7, the gateway's types: `accept` is `(options) => (frame: Frame) => Effect<Hello<H["Type"]>, NoSharedVersion \| FormatError, Format \| H["DecodingServices"]>`, with no `Socket.Socket` and no `Scope`; `challenge` and `answer` give `Effect<Frame, FormatError, Format \| ...EncodingServices>`; `answer` takes an `Answer<A["Type"]>` or a `NoSharedVersion` and nothing else | type | type | make `accept` need `Socket.Socket`: red; let `answer` take a `FormatError`: the `@ts-expect-error` line is unused, red | kalfa/transport/src/Hello.types.test.ts |
| W2, the hello on Effect's own Node WebSocket Layer: a server from `NodeSocketServer.layerWebSocket` on `127.0.0.1`, port 0, runs the test gateway for each accepted socket; a client on `NodeSocket.layerWebSocket` runs `connect` and then a chain on `Connected.socket`, with draws of (m), (n), (r) and (t); the assertions of H1, H6 and O1, run from the same law body in test support, all hold, with the server counting one accepted socket per `connect`. 5 runs under `it.live`, under 10 s in all | test | Effect Arbitrary: dials | O1's plant, run on the real socket: the server counts two sockets, red (run by the CI proof run, not the laptop) | kalfa/transport/src/NodeWebSocket.integration.test.ts |
| G1 (slice 2), the challenge lives through a sleep: on 2067's served gateway, the test app sends `challenge` from `open` and saves it in the connection's saved note; the object sleeps; the hello arrives; `frame` reads the note, runs `accept`, checks the proof against the saved challenge and answers; for (m) and (r), the client's `connect` gets the answer whole, under the same connection id. Runs: 50 if 2067's sleep harness is in memory, 3 if it is an `.integration.` file | test | Effect Arbitrary: handshakes | keep the challenge in a variable of the handler in place of the note: (m) red after the sleep, the app answers `refused` | kalfa/transport/src/ServeHello.test.ts |

### Each acceptance criterion and its law

| Ticket's criterion | Laws |
|---|---|
| `connect` reads the challenge, decodes it with the app's schema, calls `make`, sends the hello, answers `version`, `ping`, `answer`; its type | H1, H4, D5, D6 (the type amended: Doubts 1 and 2) |
| Transport carries the challenge and never reads it; a first frame that does not fit fails `FormatError` | H1 (r), H2, A3 |
| `accept` is pure, picks the highest shared version and decodes the hello, or fails `NoSharedVersion` | A1, A2, D7 |
| a test app answers admitted, waiting, refused, each whole | H1 (m) |
| `connect` fails only for Transport's reasons | H2, H3, H5, H7, D5 |
| an unreachable gateway fails with Effect's `SocketError` and nothing more | H7, W2; Transport prints nothing (X5) |
| the hello says `features`; `has` appears nowhere | H4, A2 (q), P2 |
| the core imports no Identity; the proof is decoded only with the app's schema | L4, A2 (q) |
| after `connect`, the same open socket carries the stream; no second socket | O1, H6, R1, W2 |
| a Node client through Effect's own Node WebSocket Layer | W2 |
| the test app sends its challenge from `open` and keeps it through a sleep | G1 (slice 2) |
| spans `transport.connect` and `transport.accept`; no challenge, proof or answer in a span | S3, S4, S5, X4 |

### The host-only law

W2 opens real sockets on the machine, so it sits in `kalfa/transport/src/NodeWebSocket.integration.test.ts`, beside
2066's W1. No stand-in will do for it: the criterion is Effect's own Node WebSocket Layer, and the point is that a real
dial happens once per reader acquisition, which only a real WebSocket shows. Every behavior W2 touches is proved first
on the dialing stand-in (H1, H6, O1), and W2 runs the same law body, so the stand-in passes the same laws as the real
socket. The laptop refuses it by name (`vitest.hostrun.ts`): the lead's proof run starts it before the first review, in
CI, and CI's full run runs it after. It needs no signal, no launchd entry and no run on the owner's Mac. G1's file type
is 2067's call.

## Lint

The tests step widens 2066's L2 override in `.oxlintrc.json` (its `files` list, today `kalfa/transport/src/Transport.ts`)
to `Hello.ts`, `internal/message.ts` and `internal/connection.ts`, holding L4. L1's package override already covers
`kalfa/transport/src/**`, so `@kalfa/identity` is refused in the new files with no change; L4's first plant checks it.

## Is this a setting?

- The method words, the close codes 1002 and 1000, the version rule and the ping's whole milliseconds: not settings.
  They are the wire, which both ends must agree on.
- The versions and features: not settings of Transport. They are the caller's values, given to `connect` and `accept`.
- The ping interval: a setting, but 2069's. Here it is a value the gateway passes to `answer`.
- A wait for the first frame: 2069's plan says, as a setting.

## What fact is lost if it is not recorded now

- **The version picked, the client's versions and its features, per connection.** Recorded now as span attributes on
  `transport.connect` and `transport.accept`. A connection's spans are the only record of what it agreed; without them a
  later bug in an old client's version cannot be traced to the connections it made.
- **Why a hello failed.** Recorded as the failing step's span and its error (tag and fields). A refused proof is the
  app's answer, not Transport's failure, so the app records it.
- **The challenge, the proof and the answer.** Never recorded by Transport, on purpose (X4 to X6). They are the app's.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/transport/src/Hello.ts | build | 150 | new: `connect`, `challenge`, `accept`, `answer`, `NoSharedVersion`, `Connected`, `Hello`, `Answer`, the wire values |
| kalfa/transport/src/internal/message.ts | build | 40 | new: write and read one notification of a method through `Format`, moved out of `Transport.ts` |
| kalfa/transport/src/internal/connection.ts | build | 75 | new: one dialed connection read frame by frame, frames kept from a batch, the handed-on socket |
| kalfa/transport/src/Transport.ts | build | 15 | uses `internal/message.ts`; the text of a frame of bytes from `internal/connection.ts`; re-exports the four calls |
| kalfa/transport/src/index.ts | build | 8 | exports `NoSharedVersion` and the types `Connected`, `Hello`, `Answer` |
| kalfa/transport/README.md | build | docs | the hello: the three frames with examples, the version pick, the handed-on socket, the spans, slice 2's paragraph on `open` |
| kalfa/transport/GLOSSARY.md | build | docs | challenge, answer, protocol version |
| kalfa/transport/src/Transport.test-support.ts | tests | tests | the hello generators (a) to (z), the test app, the test gateway, the dialing stand-in, the shared law body of H1, H6 and O1 |
| kalfa/transport/src/Connect.test.ts | tests | tests | H1 to H7 |
| kalfa/transport/src/Accept.test.ts | tests | tests | A1 to A3 |
| kalfa/transport/src/Handover.test.ts | tests | tests | O1, R1 |
| kalfa/transport/src/Trace.test.ts | tests | tests | T4 |
| kalfa/transport/src/Spans.test.ts | tests | tests | S3 to S5 |
| kalfa/transport/src/Leak.test.ts | tests | tests | X4 to X6 |
| kalfa/transport/src/Errors.test.ts | tests | tests | E2 |
| kalfa/transport/src/Package.test.ts | tests | tests | E1's list grows; P2 |
| kalfa/transport/src/Hello.types.test.ts | tests | tests | D5 to D7 |
| kalfa/transport/src/NodeWebSocket.integration.test.ts | tests | tests | W2 |
| .oxlintrc.json | tests | tests | L4: the L2 override's files list |
| oxlint-plugins/law-ids.ts | tests | tests | no change: ran clean while planning; the tests step runs it again |
| kalfa/transport/src/ServeHello.test.ts | tests | tests | slice 2: G1, or the file 2067's plan names for served-gateway laws |

## Existing tools

- `kalfa/transport/src/Hello.ts`: searched Effect 4.1.3's `effect/rpc` (`RpcClient`, `RpcServer`, `RpcSerialization`)
  for a handshake (none: a connection starts with requests), the frozen `next/packages/libfabrika/src/transport/Hello.ts`
  (`selectVersion`, the same pick; it is today's code, so the rule is rethought here in one line, not imported), and
  `Schema.DurationFromMillis` (its `NaN` becomes zero and it takes any number, so the ping gets its own whole-ms check
  in front; its transformation is used). `Schema.TaggedError` and `Schema.Union` used.
- `kalfa/transport/src/internal/message.ts`: searched the package itself: `send` and `receive` in `Transport.ts` already
  do this for the method word `value`; they move here and take the method word, so nothing is written twice.
- `kalfa/transport/src/internal/connection.ts`: searched Effect 4.1.3 for a way to share one reader acquisition between
  two readers (none: every `reader` acquisition dials; `Effect.cached` and `Layer.memoize` would cache the acquisition,
  but its scope would still be the first reader's), `Socket.make` (used), `Queue` (used, for the frames kept from a
  batch), and the `framed` helper in `Transport.ts` (its per-frame text decoding moves here, so `connect` and `socket`
  read bytes the same way). npm: no Effect socket helper of this kind was found.
- `kalfa/transport/src/Transport.test-support.ts`, the dialing stand-in: searched `MemorySocket.pair` (used: one pair
  per dial) and 2066's `end` and `bothWays` harness (used for the chain after `connect`); the test gateway is built from
  the package's own `challenge`, `accept` and `answer`.

## Calls taken

- `connect` needs `Scope` and returns the open socket (90%); `make` returns an Effect (85%); the refusal crosses as the
  error itself and an unlisted version is `NoSharedVersion` (80%, 75%); a failed `connect` closes with 1002 or 1000
  (75%); steps are child spans (75%); the hello carries the trace and the gateway's frames do not (80%). See Doubts.
- The three frames are ordinary notifications through `Format`, with the method words `challenge`, `hello` and `answer`
  (85%): the line format then carries a hello too, and `decode` keeps refusing any of them on a value stream.
- The app's part of the hello is the key `proof` on the wire (80%), the glossary's word for what the hello carries; the
  option keeps the sketch's name, `hello`.
- `accept` returns an Effect that needs only `Format`, not a `Result` (85%).
- Extra keys in a hello value are ignored (80%).
- A second reader acquisition of the handed-on socket fails with `SocketOpenError` (85%).
- The ping crosses as whole milliseconds above 0 (85%), as today's door has it, and not as Effect's own Duration JSON.
- The attributes on `transport.connect` and `transport.accept` are the version, the versions and the features (80%):
  record wide, and none of the three is a secret.

## Validation

- The tests step runs its new files by path (W2 left out, the laptop refuses it), then `pnpm format`, `pnpm lint` and
  `node oxlint-plugins/law-ids.ts`. It leaves the changed-tests command and the type check to the lead.
- The build runs the same narrow files, `pnpm format` and `pnpm lint`. The lead runs the changed tests and the type
  check once at the end, outside any box, and starts the proof run that runs W1 and W2 before the first review.

## Size

1. Slice 1, the hello on any Effect socket: 288 lines (`Hello.ts` 150, `internal/connection.ts` 75,
   `internal/message.ts` 40, `Transport.ts` 15, `index.ts` 8), about 30 of them moved from `Transport.ts`, plus the
   README, the glossary and the laws.
2. Slice 2, the test app on the served gateway: 0 lines of product code; G1 and one README paragraph.

288 product lines, about 3 agent hours, 70% sure. The doubt is `internal/connection.ts`: keeping Effect's reader
contract on a handed-on socket (R1) and keeping a batch's extra frames (H6) is where a send-back is likely. Budget basis:
2066's plan priced a 284-line slice at about $12 a step. Slice 1: tests at about $14, build at about $14, review at about
$9, and one likely send-back at about $12. Slice 2: tests at about $8, build at about $4 (the README paragraph), review
at about $6.

Estimate: 7 steps, $67

## New names

- `connect`, `accept`, `NoSharedVersion`, `features`, `versions`, `ping`, `challenge`, `hello`, `answer`: the protocol's
  and the ticket's.
- `Transport.challenge` and `Transport.answer`: the gateway's writers, named for the frame each writes.
- `Connected`, `Hello`, `Answer`, `socket` (on `Connected`), `proof` (the wire key), `client` and `gateway` (the two
  lists on `NoSharedVersion`): code names inside the package.
- `kalfa.transport.version`, `kalfa.transport.versions`, `kalfa.transport.features`: span attributes in the
  `kalfa.<package>.*` form decision 0063 names, since OpenTelemetry has no standard name for them.
- New domain words, for `kalfa/transport/GLOSSARY.md`:
  - **Challenge**: the gateway's first frame on a new connection, the app's one-time value that the client's hello
    answers. Transport carries it and never reads it. _Avoid_: nonce, greeting, banner.
  - **Answer**: what the gateway says back to a hello: the version it picked, the ping interval and the app's own
    answer (admitted, waiting, refused), which Transport carries whole. _Avoid_: welcome, reply, response, result.
  - **Protocol version**: a whole number, 1 or more, naming one version of what the two ends speak; the gateway picks the
    highest one both list. _Avoid_: revision, protocol id, level.

## Records

- The README gains the hello: the three frames with examples, the version pick, the handed-on socket and why it exists
  (one dial per reader acquisition), the spans, and what never shows a frame.
- The glossary gains challenge, answer and protocol version.
- A decision record is the lead's call for the wire contract outside clients must match: the three method words and
  the answer's two cases. This plan writes none. The changed `connect` type (Doubts 1 and 2) is recorded in the README
  and in the pull request body.

## What this cannot tell us

- Nothing here was built or type-checked. The probe ran Effect's JSON codec on errors, `Redacted`, `Duration` and
  `Int`; the socket and the types were only read.
- Whether a handed-on socket can keep Effect's reader contract with no race on every real socket Layer: W2 checks Node's,
  and the browser's waits for 2069's browser test.
- Whether 2067's served gateway lets a test hold a sleep between `open` and the hello the way G1 needs; slice 2's row is
  amended once 2067's plan says.
- Whether 1002 is the close code 2067's `closed` handler and outside clients want for a refused hello.
- How a client that waits forever for a challenge that never comes should fail: 2069's plan, as a setting.

## Open questions

None.

Every doubt above picks how the code does what the ticket and the decisions already say. Doubts 1 and 2 change the type
the ticket writes, because two of its own criteria (one connection, and a hello signed with Identity's signer) cannot
hold with it; the owner could refuse them only by going against Effect's `Socket` as the socket or Identity's sign call.
The lead reads them and may show the owner the changed type.

## Findings

1. **`Schema.Redacted` does not hide a cause from `Schema.toCodecJson`.** Proof: the probe above wrote
   `{"_tag":"WithCause","cause":{"name":"Error","message":"secret-xyz"}}` for an error with
   `cause: Schema.Redacted(Schema.Defect())`, in Effect 4.1.3 (`node_modules/effect/src/Schema.ts`, `Redacted`'s
   `toCodecJson`: its encode is `Redacted_.value` unless `disallowJsonEncode` is set). `kalfa/secrets/src/Errors.ts`
   (`StoreFailed`, `RecordFailed`) and the cause made in `kalfa/config/src/Snapshot.ts` hold causes that way. They are
   safe in `String`, `JSON.stringify` and a span, but any code that writes one of them with the codec, such as a ledger
   entry or a frame, writes the hidden cause. The lead's rule "the cause as a placeholder" needs either
   `disallowJsonEncode: true` (the encode then fails) or a small codec of our own that writes `"<redacted>"`. A ticket
   for the Secrets and Config owners, not this plan.

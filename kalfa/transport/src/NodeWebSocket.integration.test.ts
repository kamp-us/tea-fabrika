// W1, the same chain on Effect's own Node WebSocket Layer. It is an integration law: it binds a port on 127.0.0.1 and opens real
// WebSockets, so the laptop refuses it by its name and it runs in a proof run and on main's full run. There is no stand-in that could
// replace it: the point is that Transport has no Node code of its own, and that Effect's `NodeSocketServer.layerWebSocket` and
// `NodeSocket.layerWebSocket` read as the memory pair does. Every behavior it touches is proved first on the memory pair
// (C1 to C5, F2, T3). The server takes port 0, so two runs never clash.
import { NodeSocket, NodeSocketServer } from "@effect/platform-node";
import { assert, expect, it } from "@effect/vitest";
import type { Tracer } from "effect";
import { Arbitrary, Effect, Exit, Option, Predicate, Queue, Schema, Stream } from "effect";
import { Socket, SocketServer } from "effect/socket";
import { Format, Transport } from "./index.ts";
import type { Traced } from "./index.ts";
import {
  end,
  externalSpanFor,
  mailbox,
  seed,
  SEED,
  stateFrom,
  traceSeed,
  VALUE_CLASSES,
  validTraces,
  valueClasses,
} from "./Transport.test-support.ts";

const HOST = "127.0.0.1";

// W1. Plant: build `socket` on `Socket.toChannel` and turn each chunk into text with `String()` (the values of (a) come back as
// byte lists); send each batch as one joined text with `writeAll` (one frame holds many notifications and `decode` refuses it).
it.live.prop(
  "W1 the same chain on Effect's Node WebSocket Layer: a server runs decodeTraced, a stage and encodeTraced through socket for each accepted socket, a client sends values with traces and reads the answers in order with the same trace ids, and both chains end cleanly",
  { seeds: Arbitrary.array(seed, { minLength: 2, maxLength: 3 }), drawn: traceSeed },
  ({ seeds, drawn }) =>
    Effect.gen(function* () {
      const server = yield* SocketServer.SocketServer;
      const { address } = server;

      if (!Predicate.isTagged(address, "InetAddressV4")) {
        return assert.fail("the server is bound to an IPv4 address");
      }

      const url = `ws://${HOST}:${address.port}`;
      const exits = yield* Queue.unbounded<Exit.Exit<unknown, unknown>>();

      // The server: for each accepted socket, `decodeTraced`, a stage that sends each traced value back, and `encodeTraced`, through
      // `socket`. It reads JSON as it is, so it needs no schema of the client's.
      yield* Effect.forkScoped(
        server.run((accepted) =>
          Effect.gen(function* () {
            const box = yield* mailbox<Traced<typeof Schema.Json.Type>>();

            yield* box.stream.pipe(
              Transport.encodeTraced(Schema.Json),
              Transport.socket,
              Transport.decodeTraced(Schema.Json),
              Stream.tap(box.send),
              Stream.runDrain,
              Effect.provideService(Socket.Socket, accepted),
            );
          }).pipe(
            Effect.exit,
            Effect.flatMap((exit) => Queue.offer(exits, exit)),
          ),
        ),
      );

      const classes = valueClasses(seeds);
      expect(
        classes.map(({ name }) => name),
        "every class (a) to (d) is sent",
      ).toEqual([...VALUE_CLASSES]);

      const traces = validTraces(drawn);

      for (const { name, schema, values } of classes) {
        const sent: ReadonlyArray<Traced<unknown>> = values.map((value, index) => ({
          value,
          trace: Option.some(externalSpanFor(traces[index % traces.length] ?? traces[0]!)),
        }));

        const read = yield* Effect.gen(function* () {
          const client = yield* Socket.Socket;

          return yield* end({
            socket: client,
            send: Stream.fromIterable(sent),
            expected: sent.length,
            chain: (traced) =>
              traced.pipe(Transport.encodeTraced(schema), Transport.socket, Transport.decodeTraced(schema)),
          });
        }).pipe(Effect.scoped, Effect.provide(NodeSocket.layerWebSocket(url)));

        assert.deepStrictEqual(
          read.map(({ value }) => value),
          [...values],
          `${name}: the values come back in order`,
        );
        expect(
          read.map(({ trace }) => Option.map(trace, ({ traceId, spanId, sampled }) => [traceId, spanId, sampled])),
          `${name}: with the same trace ids`,
        ).toEqual(
          sent.map(({ trace }) =>
            Option.map(trace, ({ traceId, spanId, sampled }: Tracer.ExternalSpan) => [traceId, spanId, sampled]),
          ),
        );
        expect(
          read.map(({ trace }) => Option.flatMap(trace, stateFrom)),
          `${name}: and the same tracestate`,
        ).toEqual(sent.map(({ trace }) => Option.flatMap(trace, stateFrom)));

        // The client's scope closed with 1000, so the server's chain ends cleanly.
        const exit = yield* Queue.take(exits).pipe(Effect.timeout("5 seconds"));
        expect(Exit.isSuccess(exit), `${name}: the server's chain ends cleanly`).toBe(true);
      }
    }).pipe(
      Effect.provide(Format.layerJsonRpc),
      Effect.provide(NodeSocketServer.layerWebSocket({ host: HOST, port: 0 })),
    ),
  { timeout: 20_000, arbitrary: { seed: SEED, runs: 5 } },
);

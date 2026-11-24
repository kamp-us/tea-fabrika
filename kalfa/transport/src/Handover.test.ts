// O1 and R1: what `connect` hands on. After the hello the same open connection carries the stream: one dial in all, and a socket that
// keeps Effect's reader contract (closing the reader's scope fails a pull that waits and closes the connection, and a second
// acquisition never dials a second connection).
import { assert, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Option, Predicate, Scope, Stream } from "effect";
import { Socket } from "effect/socket";
import { Format, Transport } from "./index.ts";
import {
  ACK,
  between,
  checkOneDial,
  connectionCases,
  dialing,
  failureFrom,
  helloDraw,
  honest,
  Message,
  mustEnd,
  runCase,
  SEED,
  SignInAnswer,
  settled,
  StageError,
  through,
  TURNS,
  word,
} from "./Transport.test-support.ts";
import type { ConnectionCase, Plain } from "./Transport.test-support.ts";

// O1. Plant: run the handshake inside `Effect.scoped` and give back the dialed socket itself (two dials; the chain reads a second
// challenge).
it.effect.prop(
  "O1 one dial: across connect and the chain on the socket it gave, the stand-in counts exactly one reader acquisition, the gateway sees one connection and sends one challenge, and reads the close 1000 once the chain's scope ends",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      for (const each of connectionCases(draw)) {
        checkOneDial(each, yield* runCase(yield* dialing, each));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

/** A client connected to a gateway that sent its batch and one last value, and then waits: the client's next pull waits too. */
const waiting = (each: ConnectionCase) =>
  Effect.gen(function* () {
    const harness = yield* dialing;

    yield* harness.serve(
      honest({
        app: each.app,
        challenge: each.challenge,
        versions: each.gateway.versions,
        ping: each.gateway.ping,
        answer: each.gateway.answer,
        batch: each.batch,
        later: [],
        reads: 0,
        closes: "never",
      }),
    );

    const connected = yield* Transport.connect({
      versions: each.client.versions,
      features: each.client.features,
      challenge: each.app.challenge,
      hello: { schema: each.app.proof, make: (challenge: Plain["Type"]) => each.app.make(challenge) },
      answer: SignInAnswer,
    }).pipe(Effect.provide(harness.client));

    const seen = harness.world.connections[0];

    if (seen === undefined) {
      return assert.fail("no connection was served");
    }

    return { socket: connected.socket, seen };
  });

/** Whether the far end read to the end of its connection, and with which close code. */
const farEnded = (seen: {
  readonly ended: Deferred.Deferred<void>;
  readonly close: Option.Option<{ readonly code: number }>;
}) =>
  Effect.map(settled(Deferred.await(seen.ended), TURNS), (ended) => ({
    ended: Option.isSome(ended),
    code: Option.map(seen.close, ({ code }) => code),
  }));

const reading = (reason: Socket.SocketError["reason"]) => Predicate.isTagged(reason, "SocketOpenError");

// R1. Plant: hand on the dialed reader's `pull` with no finalizer (the pull that waits never fails and the connection is never
// closed); let a second acquisition read the same frames.
it.effect.prop(
  "R1 the handed-on socket keeps Effect's reader contract: a stage that fails while a pull waits fails the chain with its own error and the far end reads the close; closing the first acquisition's scope fails a pull that waits and closes the connection with 1000; a second acquisition, while the first is live and after it closed, fails with a SocketOpenError and reads no frame",
  { draw: helloDraw, stages: between(0, 5), failure: word },
  ({ draw, stages, failure }) =>
    Effect.gen(function* () {
      const [first] = connectionCases(draw);

      if (first === undefined) {
        return assert.fail("no case is made");
      }

      const each: ConnectionCase = {
        ...first,
        client: { ...first.client, versions: [Math.max(...first.gateway.versions)] },
      };

      // (u): a stage of the chain fails after some values, while a pull waits for the gateway's next frame.
      yield* Effect.gen(function* () {
        const { socket, seen } = yield* waiting(each);

        const chain = Stream.fromIterable(draw.sent.slice(0, stages)).pipe(
          Stream.concat(Stream.fail(new StageError({ word: failure }))),
          through(Message),
          Stream.runDrain,
          Effect.provideService(Socket.Socket, socket),
        );

        const run = yield* settled(chain, TURNS);
        const { error, defect } = failureFrom(Option.getOrElse(run, () => assert.fail("(u) the chain stalled")));

        expect(defect, "(u) never a defect").toBe(false);
        expect(error, "(u) the stage's own error").toEqual(Option.some(new StageError({ word: failure })));
        expect(yield* farEnded(seen), "(u) the far end reads the close").toEqual({
          ended: true,
          code: Option.some(1000),
        });
      }).pipe(Effect.scoped);

      // (u), the reader's own contract: closing the acquisition's scope fails a pull that waits, and closes the connection.
      yield* Effect.gen(function* () {
        const { socket, seen } = yield* waiting(each);
        const acquired = yield* Scope.make();
        const reader = yield* socket.reader.pipe(Scope.provide(acquired));

        // Read the batch and the last value, so the next pull waits.
        for (let read = 0; read < each.batch.length + 1;) {
          read += (yield* reader.pull).length;
        }

        const pull = yield* Effect.forkChild(Effect.exit(reader.pull));
        yield* settled(Effect.void, 50);
        yield* Scope.close(acquired, Exit.void);

        const exit = yield* mustEnd(Fiber.join(pull));
        expect(
          Exit.isFailure(exit) && Option.exists(failureFrom(exit).error, Socket.isSocketError),
          "(u) the pull that waited fails with a SocketError",
        ).toBe(true);
        expect(yield* farEnded(seen), "(u) the connection is closed with 1000").toEqual({
          ended: true,
          code: Option.some(1000),
        });
      }).pipe(Effect.scoped);

      // (v): a second acquisition, while the first is live and after it closed.
      yield* Effect.gen(function* () {
        const { socket, seen } = yield* waiting(each);
        const acquired = yield* Scope.make();
        const reader = yield* socket.reader.pipe(Scope.provide(acquired));
        const second = yield* Effect.exit(socket.reader.pipe(Scope.provide(yield* Scope.make())));

        expect(
          Option.exists(failureFrom(second).error, (error) => Socket.isSocketError(error) && reading(error.reason)),
          "(v) the second acquisition fails with a SocketOpenError while the first is live",
        ).toBe(true);

        // It read nothing: the first reader still gives the batch and the last value, in order.
        const frames: Array<string> = [];

        while (frames.length < each.batch.length + 1) {
          frames.push(
            ...(yield* reader.pull).map((frame) =>
              Predicate.isString(frame) ? frame : new TextDecoder().decode(frame),
            ),
          );
        }

        const values = yield* Stream.fromIterable(frames).pipe(Transport.decode(Message), Stream.runCollect);
        assert.deepStrictEqual(values, [...each.batch, ACK], "(v) the first reader reads every frame, in order");

        yield* Scope.close(acquired, Exit.void);
        const third = yield* Effect.exit(socket.reader.pipe(Scope.provide(yield* Scope.make())));

        expect(
          Option.exists(failureFrom(third).error, (error) => Socket.isSocketError(error) && reading(error.reason)),
          "(v) the second acquisition fails with a SocketOpenError after the first closed",
        ).toBe(true);
        expect(
          Option.map((yield* farEnded(seen)).code, (code) => code),
          "(v) and the connection ended with 1000",
        ).toEqual(Option.some(1000));
      }).pipe(Effect.scoped);
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

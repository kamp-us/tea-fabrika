/**
 * Two joined sockets in memory, for a test that needs a far end: what one end writes the other end reads.
 */
import { Effect, Queue } from "effect";
import type { Scope } from "effect";
import { Socket } from "effect/socket";

type Chunk = string | Uint8Array;

const closed = (code: number, reason?: string): Socket.SocketError =>
  new Socket.SocketError({ reason: new Socket.SocketCloseError({ code, closeReason: reason }) });

/**
 * Makes two joined sockets: what one end writes, the other end reads, in order. Both close when the scope ends.
 *
 * **Details**
 *
 * Each end keeps Effect's reader contract. Closing the reader scope of an end fails a pull waiting on it, and the far end reads every frame written before, then fails with a close of code 1000. A `CloseEvent` written to an end closes both with its code and reason. A write to a closed end fails with a `SocketWriteError`, and is never dropped. The queues have no capacity, as a browser's `WebSocket.send` has none.
 *
 * @category constructors
 */
export const pair: Effect.Effect<readonly [Socket.Socket, Socket.Socket], never, Scope.Scope> = Effect.gen(
  function* () {
    const inboxes = [
      yield* Queue.unbounded<Chunk, Socket.SocketError>(),
      yield* Queue.unbounded<Chunk, Socket.SocketError>(),
    ] as const;

    // The first close wins: a queue that has failed takes no second failure and no more frames, and its waiting frames are still read first.
    const close = (code: number, reason?: string) =>
      Effect.gen(function* () {
        const failure = closed(code, reason);

        yield* Queue.fail(inboxes[0], failure);
        yield* Queue.fail(inboxes[1], failure);
      });

    const end = (own: Queue.Queue<Chunk, Socket.SocketError>, far: Queue.Queue<Chunk, Socket.SocketError>) => {
      const refused = new Socket.SocketWriteError({ cause: "the socket is closed" });

      const writeAll = (chunks: ReadonlyArray<Chunk>) =>
        Effect.flatMap(Queue.offerAll(far, chunks), (left) =>
          left.length === 0 ? Effect.void : Effect.fail(new Socket.SocketError({ reason: refused })),
        );

      return Socket.make({
        reader: Effect.as(
          Effect.addFinalizer(() => close(1000)),
          { pull: Queue.takeAll(own), upgrade: Socket.SocketUpgradeError.unsupported },
        ),
        writer: Effect.succeed({
          write: (chunk) => (Socket.isCloseEvent(chunk) ? close(chunk.code, chunk.reason) : writeAll([chunk])),
          writeAll,
        }),
      });
    };

    yield* Effect.addFinalizer(() => close(1000));

    return [end(inboxes[0], inboxes[1]), end(inboxes[1], inboxes[0])] as const;
  },
);

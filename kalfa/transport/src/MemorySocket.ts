/**
 * Two joined sockets in memory, for a test that needs a far end: what one end writes the other end reads.
 */
import { Effect, Option, Queue, Ref } from "effect";
import type { Scope } from "effect";
import { Socket } from "effect/socket";

type Chunk = string | Uint8Array;

type Inbox = Queue.Queue<Chunk, Socket.SocketError>;

// Which end closed first, with what code. `both` is the end of the pair's scope.
interface Closed {
  readonly by: 0 | 1 | "both";
  readonly code: number;
}

const closeError = (code: number, reason?: string): Socket.SocketError =>
  new Socket.SocketError({ reason: new Socket.SocketCloseError({ code, closeReason: reason }) });

/**
 * Makes two joined sockets: what one end writes, the other end reads, in order. Both close when the scope ends.
 *
 * **Details**
 *
 * Each end keeps Effect's reader contract. Closing the reader scope of an end fails a pull waiting on it, and the far end reads every frame written before, then fails with a close of code 1000. A `CloseEvent` written to an end closes both with its code and reason. A write to an end that closed itself fails with a `SocketWriteError`, and is never dropped. After the far end closed with 1000 a write is dropped and fails nothing, as a WebSocket drops the writes it is still given. The queues have no capacity, as a browser's `WebSocket.send` has none.
 *
 * @category constructors
 */
export const pair: Effect.Effect<readonly [Socket.Socket, Socket.Socket], never, Scope.Scope> = Effect.gen(
  function* () {
    const inboxes: readonly [Inbox, Inbox] = [
      yield* Queue.unbounded<Chunk, Socket.SocketError>(),
      yield* Queue.unbounded<Chunk, Socket.SocketError>(),
    ];

    const first = yield* Ref.make(Option.none<Closed>());

    // The first close wins: a queue that has failed takes no second failure and no more frames, and its waiting frames are still read first.
    const close = (by: Closed["by"], code: number, reason?: string) =>
      Effect.gen(function* () {
        const failure = closeError(code, reason);

        yield* Ref.update(first, (closed) => Option.orElse(closed, () => Option.some({ by, code })));
        yield* Queue.fail(inboxes[0], failure);
        yield* Queue.fail(inboxes[1], failure);
      });

    const end = (self: 0 | 1, own: Inbox, far: Inbox) => {
      const refused = new Socket.SocketWriteError({ cause: "the socket is closed" });

      // A write that no queue took: dropped when the far end closed with 1000, a failure when this end closed or the code was another.
      const dropped = Effect.flatMap(Ref.get(first), (closed) =>
        Option.exists(closed, ({ by, code }) => by !== self && code === 1000)
          ? Effect.void
          : Effect.fail(new Socket.SocketError({ reason: refused })),
      );

      const writeAll = (chunks: ReadonlyArray<Chunk>) =>
        Effect.flatMap(Queue.offerAll(far, chunks), (left) => (left.length === 0 ? Effect.void : dropped));

      return Socket.make({
        reader: Effect.as(
          Effect.addFinalizer(() => close(self, 1000)),
          { pull: Queue.takeAll(own), upgrade: Socket.SocketUpgradeError.unsupported },
        ),
        writer: Effect.succeed({
          write: (chunk) => (Socket.isCloseEvent(chunk) ? close(self, chunk.code, chunk.reason) : writeAll([chunk])),
          writeAll,
        }),
      });
    };

    yield* Effect.addFinalizer(() => close("both", 1000));

    return [end(0, inboxes[0], inboxes[1]), end(1, inboxes[1], inboxes[0])] as const;
  },
);

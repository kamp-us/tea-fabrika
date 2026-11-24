/**
 * Two joined sockets in memory, for a test that needs a far end: what one end writes the other end reads.
 */
import { Effect, Option, Queue, Ref } from "effect";
import type { Scope } from "effect";
import { Socket } from "effect/socket";

type Chunk = string | Uint8Array;

type Inbox = Queue.Queue<Chunk, Socket.SocketError>;

// A browser's `WebSocket.close` takes 1000 or 3000 to 4999 from a client and throws an InvalidAccessError for any other code. A server
// sends any code, so only the first end of the pair, the client's, is held to it.
const closeAllowed = (code: number) => code === 1000 || (code >= 3000 && code <= 4999);

const closeRefused = (code: number): Socket.SocketError =>
  new Socket.SocketError({
    reason: new Socket.SocketWriteError({
      cause: new DOMException(
        `Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
        "InvalidAccessError",
      ),
    }),
  });

const closeError = (code: number, reason?: string): Socket.SocketError =>
  new Socket.SocketError({ reason: new Socket.SocketCloseError({ code, closeReason: reason }) });

/**
 * Makes two joined sockets: what one end writes, the other end reads, in order. The first end is the client's and the second the gateway's. Both close when the scope ends.
 *
 * **Details**
 *
 * Each end keeps Effect's reader contract. Closing the reader scope of an end fails a pull waiting on it, and the far end reads every frame written before, then fails with a close of code 1000. A `CloseEvent` written to an end closes both with its code and reason, when it is sent by the client, which is the first end, and a browser's `WebSocket.close` would take the code (1000, or 3000 to 4999): any other code fails the write with a `SocketWriteError` holding an `InvalidAccessError`, as the real socket does, and closes nothing. The second end stands in for the gateway and sends any code. A write to an end that closed itself fails with a `SocketWriteError`, and is never dropped. After the far end closed, a write is dropped and fails nothing, as a WebSocket drops the writes it is still given; the close itself reaches the reader. The queues have no capacity, as a browser's `WebSocket.send` has none.
 *
 * @category constructors
 */
export const pair: Effect.Effect<readonly [Socket.Socket, Socket.Socket], never, Scope.Scope> = Effect.gen(
  function* () {
    const inboxes: readonly [Inbox, Inbox] = [
      yield* Queue.unbounded<Chunk, Socket.SocketError>(),
      yield* Queue.unbounded<Chunk, Socket.SocketError>(),
    ];

    // The end that closed first: its own writes fail from then on, and the far end's are dropped.
    const first = yield* Ref.make(Option.none<0 | 1>());

    // The first close wins: a queue that has failed takes no second failure and no more frames, and its waiting frames are still read first.
    const failBoth = (code: number, reason?: string) =>
      Effect.gen(function* () {
        const failure = closeError(code, reason);

        yield* Queue.fail(inboxes[0], failure);
        yield* Queue.fail(inboxes[1], failure);
      });

    const close = (by: 0 | 1, code: number, reason?: string) =>
      Effect.andThen(
        Ref.update(first, (closed) => Option.orElse(closed, () => Option.some(by))),
        failBoth(code, reason),
      );

    const end = (self: 0 | 1, own: Inbox, far: Inbox) => {
      const refused = new Socket.SocketWriteError({ cause: "the socket is closed" });

      // A write that no queue took: dropped when the far end closed, a failure when this end closed.
      const dropped = Effect.flatMap(Ref.get(first), (closed) =>
        Option.exists(closed, (by) => by !== self)
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
          write: (chunk) =>
            Socket.isCloseEvent(chunk)
              ? self === 1 || closeAllowed(chunk.code)
                ? close(self, chunk.code, chunk.reason)
                : Effect.fail(closeRefused(chunk.code))
              : writeAll([chunk]),
          writeAll,
        }),
      });
    };

    yield* Effect.addFinalizer(() => failBoth(1000));

    return [end(0, inboxes[0], inboxes[1]), end(1, inboxes[1], inboxes[0])] as const;
  },
);

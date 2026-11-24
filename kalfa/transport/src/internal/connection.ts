/**
 * One dialed connection, read frame by frame, and handed on as a socket.
 *
 * **Details**
 *
 * Effect dials every time a socket's reader is acquired, so a handshake and the stream that follows must share one acquisition. `open` acquires the reader once and reads it one frame at a time. `handOn` gives the same open connection to a chain: its first frames are the ones that came in a batch with the last frame read, and its second acquisition fails.
 *
 * @internal
 */
import { Array as Arr, Effect, Exit, Predicate, Scope } from "effect";
import { Socket } from "effect/socket";
import type { Frame } from "../Frame.ts";

/**
 * The text of a chunk a socket gave: a frame of text as it is, and a frame of bytes as the text of its own bytes (a decoder for each frame, so half a character at the end of one is no part of the next).
 *
 * @internal
 */
export const text = (chunk: string | Uint8Array): Frame =>
  Predicate.isString(chunk) ? chunk : new TextDecoder().decode(chunk);

/**
 * An open connection.
 *
 * @internal
 */
export interface Connection {
  readonly next: Effect.Effect<Frame, Socket.SocketError>;
  readonly write: (frame: Frame) => Effect.Effect<void, Socket.SocketError>;
  readonly close: (code: number) => Effect.Effect<void>;
  readonly handOn: Socket.Socket;
}

/**
 * Acquires the reader of a socket once, in a child of the caller's scope.
 *
 * @internal
 */
export const open = Effect.fnUntraced(function* (socket: Socket.Socket) {
  const parent = yield* Scope.Scope;
  const child = yield* Scope.fork(parent);
  const { pull } = yield* socket.reader.pipe(Scope.provide(child));
  const writer = yield* socket.writer;

  // The frames of a batch that were not read yet, in order.
  const kept: Array<Frame> = [];

  const next = Effect.suspend(() => {
    const first = kept.shift();

    return first === undefined
      ? Effect.map(pull, (chunk) => {
          const [head, ...rest] = Arr.map(chunk, text);
          kept.push(...rest);

          return head;
        })
      : Effect.succeed(first);
  });

  const close = (code: number) =>
    Effect.ignore(writer.write(new Socket.CloseEvent(code))).pipe(Effect.andThen(Scope.close(child, Exit.void)));

  let taken = false;

  const handOn = Socket.make({
    reader: Effect.suspend(() => {
      if (taken) {
        return Effect.fail(
          new Socket.SocketError({
            reason: new Socket.SocketOpenError({ kind: "Unknown", cause: "the connection is already read" }),
          }),
        );
      }

      taken = true;

      return Effect.as(
        Effect.addFinalizer((exit: Exit.Exit<unknown, unknown>) =>
          Effect.ignore(writer.write(new Socket.CloseEvent(1000))).pipe(Effect.andThen(Scope.close(child, exit))),
        ),
        {
          pull: Effect.suspend(() => {
            const batch = kept.splice(0);

            return Arr.isArrayNonEmpty(batch) ? Effect.succeed(batch) : pull;
          }),
          upgrade: Socket.SocketUpgradeError.unsupported,
        },
      );
    }),
    writer: Effect.succeed(writer),
  });

  return { next, write: (frame: Frame) => writer.write(frame), close, handOn } satisfies Connection;
});

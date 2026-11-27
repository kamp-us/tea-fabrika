/**
 * The stream functions of Transport: a value becomes a frame, a socket carries frames both ways at once, and a frame becomes a value.
 *
 * **Details**
 *
 * Each is a plain function of streams that keeps nothing from one frame to the next, so a socket sits in a chain of stages as one more stage: `encode`, `socket`, `decode`. The format is the `Format` service and the socket is Effect's own `Socket`, so any Layer of either works.
 */
import { Array as Arr, Data, Effect, Option, Predicate, Stream } from "effect";
import type { Schema } from "effect";
import { Socket } from "effect/socket";
import type { Format, FormatError } from "./Format.ts";
import type { Frame } from "./Frame.ts";
import { text } from "./internal/connection.ts";
import * as Message from "./internal/message.ts";
import type { Traced } from "./Traced.ts";

const send = Message.send("value");

const receive = Message.receive("value");

/**
 * Writes each value of a stream as one frame, with no trace.
 *
 * **Details**
 *
 * The frame is one notification of the format. A value the schema cannot write fails the stream with a `FormatError` of `value` and writes no frame.
 *
 * @category encoding
 */
export const encode =
  <S extends Schema.Top>(schema: S) =>
  <E, R>(
    values: Stream.Stream<S["Type"], E, R>,
  ): Stream.Stream<Frame, E | FormatError, R | Format | S["EncodingServices"]> =>
    values.pipe(Stream.mapEffect((value) => send(schema)({ value, trace: Option.none() })));

/**
 * Writes each traced value of a stream as one frame, with its trace.
 *
 * **Details**
 *
 * A trace whose ids are no W3C ids writes no trace, since the reader would drop it. A trace id shorter than 32 digits is padded on the left with zeros.
 *
 * @category encoding
 */
export const encodeTraced =
  <S extends Schema.Top>(schema: S) =>
  <E, R>(
    values: Stream.Stream<Traced<S["Type"]>, E, R>,
  ): Stream.Stream<Frame, E | FormatError, R | Format | S["EncodingServices"]> =>
    values.pipe(Stream.mapEffect(send(schema)));

/**
 * Reads each frame of a stream as a value, and drops the trace it carried.
 *
 * **Details**
 *
 * A frame the format refuses, a frame of another method and a value the schema refuses each fail the stream with a `FormatError` of their reason, and never a defect.
 *
 * @category decoding
 */
export const decode =
  <S extends Schema.Top>(schema: S) =>
  <E, R>(
    frames: Stream.Stream<Frame, E, R>,
  ): Stream.Stream<S["Type"], E | FormatError, R | Format | S["DecodingServices"]> =>
    frames.pipe(Stream.mapEffect((frame) => Effect.map(receive(schema)(frame), ({ value }) => value)));

/**
 * Reads each frame of a stream as a value with the trace it carried, when it carried a valid one.
 *
 * **Details**
 *
 * A trace that is broken is no trace, and never an error: the value still comes out.
 *
 * @category decoding
 */
export const decodeTraced =
  <S extends Schema.Top>(schema: S) =>
  <E, R>(
    frames: Stream.Stream<Frame, E, R>,
  ): Stream.Stream<Traced<S["Type"]>, E | FormatError, R | Format | S["DecodingServices"]> =>
    frames.pipe(Stream.mapEffect(receive(schema)));

/**
 * Sends the frames of a stream through the socket and gives the frames the socket reads, both ways at once.
 *
 * **Details**
 *
 * A frame of text comes out as it was sent, and each frame of bytes is read as text on its own, so half a character at the end of one frame is no part of the next. Writing and reading run together, so an end can answer what it reads while it is still sending. A close with code 1000 ends the stream cleanly after every frame read before it, and any other close fails it with Effect's own `SocketError`. A failure of `out` fails the stream as it is. The stream runs inside one span named `transport.socket`. When `out` ends nothing is closed, since the far end may still send. The socket closes, with code 1000 written by this function, when the scope of the chain ends.
 *
 * @category sockets
 */
export const socket = <E, R>(
  out: Stream.Stream<Frame, E, R>,
): Stream.Stream<Frame, E | Socket.SocketError, R | Socket.Socket> =>
  Stream.unwrap(
    Effect.map(Socket.Socket, (connection) =>
      out.pipe(
        // A failure of `out` is wrapped on the way in, so a `SocketError` that comes out is the socket's own, never one a stage raised.
        Stream.mapError((error) => new Staged({ error })),
        Stream.pipeThroughChannel(Socket.toChannelString<Staged<E>>(framed(connection))),
        Stream.catchIf(isNormalClose, () => Stream.empty),
        Stream.mapError((error) => (error instanceof Staged ? error.error : error)),
      ),
    ),
  ).pipe(Stream.withSpan("transport.socket"));

class Staged<E> extends Data.TaggedClass("@kalfa/transport/Staged")<{ readonly error: E }> {}

const isNormalClose = (error: Socket.SocketError | Staged<unknown>): error is Socket.SocketError =>
  Socket.isSocketError(error) && Predicate.isTagged(error.reason, "SocketCloseError") && error.reason.code === 1000;

// What the socket Layer gives, made fit for `toChannelString`: a frame of text is passed on as it is, and a frame of bytes is the text of its own bytes (a decoder for each frame, so half a character at the end of one is no part of the next, and it reads as U+FFFD where `decode` refuses it). So the channel decodes nothing and keeps nothing from one frame to the next.
// A Layer may also close its connection with no code when the scope ends (Effect's Node server does), which the far end reads as 1005, a failure. The finalizer here is added after the reader is acquired, so it runs before the reader's own release and writes 1000 first.
const framed = (connection: Socket.Socket): Socket.Socket =>
  Socket.make({
    reader: Effect.flatMap(connection.reader, ({ pull, upgrade }) =>
      Effect.as(
        Effect.flatMap(connection.writer, (writer) =>
          Effect.addFinalizer(() => Effect.ignore(writer.write(new Socket.CloseEvent(1000)))),
        ),
        {
          pull: Effect.map(pull, (chunk) => Arr.map(chunk, (frame) => text(frame))),
          upgrade,
        },
      ),
    ),
    writer: connection.writer,
  });

export {
  /**
   * Reads a hello frame and picks the highest version both ends list.
   *
   * @category gateway
   */
  accept,
  /**
   * Writes the answer to a hello.
   *
   * @category gateway
   */
  answer,
  /**
   * Writes the challenge, the gateway's first frame.
   *
   * @category gateway
   */
  challenge,
  /**
   * Connects as a client: the challenge, the hello and the answer, on one connection.
   *
   * @category client
   */
  connect,
} from "./Hello.ts";

// D1 to D4: the types of the stream functions. The compile-time laws need tsc (the lead runs it after the build); each is written as a
// function the test never calls, so no value is declared and the file also runs under vitest. D3 also runs the sketch's chain.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Arbitrary, Context, Effect, Stream } from "effect";
import type { Option, Scope, Tracer, Schema } from "effect";
import { Socket } from "effect/socket";
import { Format, Transport } from "./index.ts";
import type { FormatError, Frame, Traced } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";
import { between, end, finished, mailbox, Message, Progress, SEED, settled } from "./Transport.test-support.ts";

class Needs extends Context.Service<Needs, string>()("@kalfa/transport/test/Needs") {}

class Other extends Context.Service<Other, string>()("@kalfa/transport/test/Other") {}

// Plant: type `socket`'s errors as `SocketError` alone, dropping `E`; drop `Format` from `encode`'s needs; give `decode` a `Socket`.
const functionTypes = <E, R>(values: Stream.Stream<Message, E, R>, frames: Stream.Stream<Frame, E, R>) => {
  const encoded = values.pipe(Transport.encode(Message));
  expectTypeOf(encoded).toEqualTypeOf<Stream.Stream<Frame, E | FormatError, R | Format>>();

  const sent = frames.pipe(Transport.socket);
  expectTypeOf(sent).toEqualTypeOf<Stream.Stream<Frame, E | Socket.SocketError, R | Socket.Socket>>();

  const decoded = frames.pipe(Transport.decode(Message));
  expectTypeOf(decoded).toEqualTypeOf<Stream.Stream<Message, E | FormatError, R | Format>>();

  return [encoded, sent, decoded];
};

it("D1 type: encode, socket and decode are plain functions of streams with the sketched types, and a socket's errors are Effect's own SocketError", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(functionTypes).toBeFunction();
});

// Plant: drop `S["EncodingServices"]` from `encode`'s needs (the encoding-service line fails); constrain `S` to a codec with no
// services (the `Schema.Top` line fails).
const schemaTypes = <E, R>(
  values: Stream.Stream<string, E, R>,
  frames: Stream.Stream<Frame, E, R>,
  needsDecoding: Schema.Codec<string, string, Needs, never>,
  needsEncoding: Schema.Codec<string, string, never, Other>,
  top: Schema.Top,
  unknown: typeof Schema.Unknown,
  loose: any,
) => {
  expectTypeOf(frames.pipe(Transport.decode(needsDecoding))).toEqualTypeOf<
    Stream.Stream<string, E | FormatError, R | Format | Needs>
  >();
  expectTypeOf(values.pipe(Transport.encode(needsEncoding))).toEqualTypeOf<
    Stream.Stream<Frame, E | FormatError, R | Format | Other>
  >();
  expectTypeOf(frames.pipe(Transport.decode(Message))).toEqualTypeOf<
    Stream.Stream<Message, E | FormatError, R | Format>
  >();
  expectTypeOf(frames.pipe(Transport.decode(top))).toEqualTypeOf<Stream.Stream<unknown, E | FormatError, unknown>>();
  expectTypeOf(frames.pipe(Transport.decode(unknown))).toEqualTypeOf<
    Stream.Stream<unknown, E | FormatError, R | Format>
  >();
  expectTypeOf(frames.pipe(Transport.decode(loose))).toExtend<Stream.Stream<unknown, unknown, unknown>>();

  return [needsDecoding, needsEncoding, top, unknown, loose];
};

it("D2 type: the value type holds for every way a schema is typed: a struct, a tagged union, a schema that needs a service to decode or to encode, Top, Unknown and any", () => {
  expectTypeOf(schemaTypes).toBeFunction();
});

// Plant: make `socket` need `Format` (the provided chain's needs are not `Scope` alone).
const sketch = (clicks: Stream.Stream<number>) =>
  Effect.gen(function* () {
    const [left] = yield* MemorySocket.pair;

    yield* clicks.pipe(
      Stream.map((done) => Progress.make({ done, total: 10 })),
      Transport.encode(Progress),
      Transport.socket,
      Transport.decode(Progress),
      Stream.map((progress) => `${progress.done} of ${progress.total}`),
      Stream.runDrain,
      Effect.provideService(Socket.Socket, left),
    );
  }).pipe(Effect.provide(Format.layerJsonRpc));

it("D3 type: the sketch's chain, provided one end of the memory pair and the JSON-RPC format, needs a Scope alone and fails with a FormatError or a SocketError", () => {
  expectTypeOf(sketch).returns.toEqualTypeOf<Effect.Effect<void, FormatError | Socket.SocketError, Scope.Scope>>();
});

// Plant: make the sketch's chain drop the stage between `decode` and the end (the echoed values come back untouched), or stall it.
it.effect.prop(
  "D5 the sketch's chain runs: clicks mapped to progress, sent over one end of the pair, echoed by the other end and read back through a stage",
  { clicks: Arbitrary.array(between(0, 1_000_000), { minLength: 1, maxLength: 30 }) },
  ({ clicks }) =>
    Effect.gen(function* () {
      const [left, right] = yield* MemorySocket.pair;
      const box = yield* mailbox<typeof Progress.Type>();

      const [read] = finished(
        yield* settled(
          Effect.all(
            [
              end({
                socket: left,
                send: Stream.fromIterable(clicks),
                expected: clicks.length,
                chain: (values) =>
                  values.pipe(
                    Stream.map((done) => Progress.make({ done, total: 10 })),
                    Transport.encode(Progress),
                    Transport.socket,
                    Transport.decode(Progress),
                    Stream.map((progress) => `${progress.done} of ${progress.total}`),
                  ),
              }),
              end({
                socket: right,
                send: box.stream,
                expected: clicks.length,
                chain: (values) =>
                  values.pipe(Transport.encode(Progress), Transport.socket, Transport.decode(Progress)),
                react: (progress, index) =>
                  Effect.andThen(box.send(progress), index + 1 >= clicks.length ? box.finish : Effect.void),
              }),
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.scoped),
        ),
        "the chain",
      );

      expect(read).toEqual(clicks.map((done) => `${done} of 10`));
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// Plant: type `decodeTraced` as giving `S["Type"]`; type the trace as `Tracer.AnySpan`.
const tracedTypes = <E, R>(
  traced: Stream.Stream<Traced<Message>, E, R>,
  frames: Stream.Stream<Frame, E, R>,
  plain: Stream.Stream<Message, E, R>,
) => {
  expectTypeOf(traced.pipe(Transport.encodeTraced(Message))).toEqualTypeOf<
    Stream.Stream<Frame, E | FormatError, R | Format>
  >();
  expectTypeOf(frames.pipe(Transport.decodeTraced(Message))).toEqualTypeOf<
    Stream.Stream<Traced<Message>, E | FormatError, R | Format>
  >();
  expectTypeOf<Traced<Message>["trace"]>().toEqualTypeOf<Option.Option<Tracer.ExternalSpan>>();
  expectTypeOf<Traced<Message>["value"]>().toEqualTypeOf<Message>();

  // @ts-expect-error A stream of plain values is no stream of Traced values.
  const refused = plain.pipe(Transport.encodeTraced(Message));

  return [refused];
};

it("D4 type: encodeTraced takes a stream of Traced values and decodeTraced gives one, both need Format and add FormatError, and the trace is an optional ExternalSpan", () => {
  expectTypeOf(tracedTypes).toBeFunction();
});

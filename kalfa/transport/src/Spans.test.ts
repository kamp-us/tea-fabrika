// S1 and S2: the one span a running socket makes, `transport.socket`, made with Effect's own calls and read here from a tracer held in
// memory. It ends when the stream ends, fails with the SocketError of a close other than 1000, and is never made when tracing is off.
import { assert, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Option, Predicate, Stream } from "effect";
import { Socket } from "effect/socket";
import { Format, Transport } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";
import { between, bothWays, closeFrom, Message, message, SEED, watching } from "./Transport.test-support.ts";

const messages = Arbitrary.array(message, { minLength: 2, maxLength: 10 });

/** The near end's chain over a pair whose far end closed with `code`: `encode`, `socket` and `decode`, read to its end. */
const closedWith = (values: ReadonlyArray<Message>, code: number) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const writer = yield* far.writer;
    yield* writer.write(new Socket.CloseEvent(code));

    return yield* Stream.fromIterable(values).pipe(
      Transport.encode(Message),
      Transport.socket,
      Transport.decode(Message),
      Stream.runDrain,
      Effect.provideService(Socket.Socket, near),
      Effect.exit,
    );
  }).pipe(Effect.scoped);

// S1. Plant: name the span `transport.stream`; make one span for each frame; make a span in `decode`.
it.effect.prop(
  "S1 the span: each running socket makes exactly one span named transport.socket, ended when its stream ends, failed with a SocketError for a close other than 1000, and encode and decode make none",
  { left: messages, right: messages, extra: between(0, 999) },
  ({ left, right, extra }) =>
    Effect.gen(function* () {
      // Two ends run, many frames cross each way: one span for each end, and no more.
      const both = yield* watching;
      yield* bothWays(left, right).pipe(Effect.withTracer(both.tracer));

      expect(
        both.spans.map(({ name }) => name),
        "one span for each running socket",
      ).toEqual(["transport.socket", "transport.socket"]);
      expect(
        both.spans.map(({ status }) => status._tag),
        "each span ended",
      ).toEqual(["Ended", "Ended"]);

      // A close of each code: the span fails with the SocketError of a close other than 1000, and not for 1000.
      for (const code of [1000, 1001, 1006, 1011, 4000 + extra]) {
        const closed = yield* watching;
        const exit = yield* closedWith(left, code).pipe(Effect.withTracer(closed.tracer));

        expect(
          closed.spans.map(({ name }) => name),
          `code ${code}: one span, and none from encode or decode`,
        ).toEqual(["transport.socket"]);

        const status = closed.spans[0]?.status;
        assert.isTrue(Predicate.isTagged(status, "Ended"), `code ${code}: the span ended`);

        const failed =
          Predicate.isTagged(status, "Ended") && Exit.isFailure(status.exit)
            ? Cause.findErrorOption(status.exit.cause)
            : Option.none();

        expect(Exit.isFailure(exit), `code ${code}: the chain fails for a close other than 1000`).toBe(code !== 1000);
        expect(
          Option.flatMap(failed, (error) => (Socket.isSocketError(error) ? closeFrom(error) : Option.none())),
          `code ${code}: the span fails with the close, and not for 1000`,
        ).toEqual(code === 1000 ? Option.none() : Option.some({ code, reason: undefined }));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// S2. Plant: turn tracing on again inside `socket` (`Effect.withTracerEnabled(true)`).
it.effect.prop(
  "S2 the tracer off: the whole chain under Effect.withTracerEnabled(false) leaves the tracer held in memory empty",
  { left: messages, right: messages },
  ({ left, right }) =>
    Effect.gen(function* () {
      // Sanity: the same chain with tracing on does make spans, so an empty tracer below means none were made.
      const on = yield* watching;
      yield* bothWays(left, right).pipe(Effect.withTracer(on.tracer));
      expect(on.spans.length, "the tracer sees the spans of a chain with tracing on").toBe(2);

      const off = yield* watching;
      yield* bothWays(left, right).pipe(Effect.withTracerEnabled(false), Effect.withTracer(off.tracer));
      expect(off.spans, "no span with tracing off").toEqual([]);
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

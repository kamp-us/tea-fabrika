// T1 to T4: the sender's trace rides in the frame, under params._meta, as the W3C `traceparent` and `tracestate` (the way MCP carries
// it). A span held by `encodeTraced` is written, a plain `encode` writes none, a broken trace in a frame is no trace and never an
// error, and a span made by Effect's own tracer crosses the memory pair with its ids.
import { assert, expect, it } from "@effect/vitest";
import { Duration, Effect, Option, Stream, Tracer } from "effect";
import { Format, Transport } from "./index.ts";
import type { Traced } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";
import {
  BROKEN_TRACE_CLASSES,
  Refused,
  challengeFrom,
  Challenge,
  connectionCases,
  dialing,
  helloDraw,
  runCase,
  signInApp,
  SignInAnswer,
  watching,
  BAD_STATE_CLASSES,
  badStateTraces,
  brokenMetas,
  droppedStates,
  end,
  externalSpanFor,
  Message,
  message,
  metaFrom,
  notification,
  SEED,
  shortTrace,
  STATE_CLASSES,
  stateFrom,
  traceSeed,
  UNWRITABLE_CLASSES,
  unwritableTraces,
  VALID_TRACE_CLASSES,
  validTraces,
} from "./Transport.test-support.ts";
import type { WrittenTrace } from "./Transport.test-support.ts";

const traced = (value: Message, trace: Option.Option<Tracer.ExternalSpan>): Traced<Message> => ({ value, trace });

/** The frame `encodeTraced` writes for a traced value. */
const tracedFrame = (value: Message, trace: Option.Option<Tracer.ExternalSpan>) =>
  Stream.make(traced(value, trace)).pipe(
    Transport.encodeTraced(Message),
    Stream.runCollect,
    Effect.map((frames) => frames[0] ?? ""),
  );

/** What `decodeTraced` reads from one frame. */
const readTraced = (frame: string) =>
  Stream.make(frame).pipe(
    Transport.decodeTraced(Message),
    Stream.runCollect,
    Effect.map((read) => Option.fromNullishOr(read[0])),
  );

/** The span a frame carries, when it reads as one. */
const spanOfFrame = (frame: string) =>
  Effect.map(readTraced(frame), (read) => Option.flatMap(read, (each) => each.trace));

/** Whether a frame holds no trace key: no `_meta`, or one with neither key. */
const hasNoTraceKey = (frame: string): boolean => {
  const meta = metaFrom(frame).params._meta;

  return meta === undefined || (meta.traceparent === undefined && meta.tracestate === undefined);
};

const flag = (trace: WrittenTrace): string => (trace.sampled ? "01" : "00");

const idsFrom = (span: Option.Option<Tracer.ExternalSpan>) =>
  Option.map(span, ({ traceId, spanId, sampled }) => [traceId, spanId, sampled]);

// T1. Plant: write the sampled flag as 01 always (l); write an empty tracestate when there is none (l); write a capital-letter id as
// given (o: the writer promised a trace the reader drops); do not pad a short trace id (o), pad only a 16-digit one, pad on the right
// or with another digit, write a short id that is no hex or a long one cut to 32; write a tracestate no reader takes, or drop the
// whole trace for it (n).
it.effect.prop(
  "T1 the trace is written and read: encodeTraced then decodeTraced gives the same trace id, span id, sampled flag and tracestate, an id that is no W3C id writes no trace key, a short id is padded to 32 digits, and a tracestate no reader takes is dropped while its span crosses",
  { drawn: traceSeed, body: message },
  ({ drawn, body }) =>
    Effect.gen(function* () {
      const valid = validTraces(drawn);
      expect(
        valid.map(({ name }) => name),
        "every class (l) is reached",
      ).toEqual([...VALID_TRACE_CLASSES]);

      for (const trace of valid) {
        const frame = yield* tracedFrame(body, Option.some(externalSpanFor(trace)));
        const meta = metaFrom(frame).params._meta;

        expect(meta?.traceparent, `${trace.name}: the traceparent`).toBe(
          `00-${trace.traceId}-${trace.spanId}-${flag(trace)}`,
        );
        // A tracestate is there only when the trace had one: an empty one written for none would show as "".
        expect(Option.fromNullishOr(meta?.tracestate), `${trace.name}: the tracestate`).toEqual(trace.state);

        const read = yield* readTraced(frame);
        assert.deepStrictEqual(
          Option.map(read, ({ value }) => value),
          Option.some(body),
          `${trace.name}: the value`,
        );
        const span = Option.flatMap(read, (each) => each.trace);
        expect(idsFrom(span), `${trace.name}: the trace comes back`).toEqual(
          Option.some([trace.traceId, trace.spanId, trace.sampled]),
        );
        expect(Option.flatMap(span, stateFrom), `${trace.name}: and its tracestate`).toEqual(trace.state);
      }

      // No trace, no keys.
      const bare = yield* tracedFrame(body, Option.none());
      expect(hasNoTraceKey(bare), "a None trace writes no trace key").toBe(true);
      expect(yield* spanOfFrame(bare), "and reads back as None").toEqual(Option.none());

      // A trace id of a drawn 1 to 31 digits is written padded to 32 on the left and reads back padded.
      const short = shortTrace(drawn);
      const padded = yield* tracedFrame(body, Option.some(externalSpanFor(short)));
      const widened = `${"0".repeat(32 - short.traceId.length)}${short.traceId}`;
      expect(
        metaFrom(padded).params._meta?.traceparent,
        `o: a trace id of ${short.traceId.length} digits is padded`,
      ).toBe(`00-${widened}-${short.spanId}-01`);
      expect(
        Option.map(yield* spanOfFrame(padded), (span) => span.traceId),
        "o: and reads back padded",
      ).toEqual(Option.some(widened));

      // A valid span whose tracestate no reader would take still crosses with its ids, and the tracestate is dropped, not written.
      const badStates = badStateTraces(drawn);
      expect(
        badStates.map(({ name }) => name),
        "every class of a bad tracestate on a valid span is reached",
      ).toEqual([...BAD_STATE_CLASSES]);

      for (const trace of badStates) {
        const frame = yield* tracedFrame(body, Option.some(externalSpanFor(trace)));
        const meta = metaFrom(frame).params._meta;

        expect(meta?.traceparent, `${trace.name}: the traceparent is written`).toBe(
          `00-${trace.traceId}-${trace.spanId}-01`,
        );
        expect(meta?.tracestate, `${trace.name}: and no tracestate`).toBeUndefined();

        const span = yield* spanOfFrame(frame);
        expect(idsFrom(span), `${trace.name}: the span crosses`).toEqual(
          Option.some([trace.traceId, trace.spanId, true]),
        );
        expect(Option.flatMap(span, stateFrom), `${trace.name}: with no tracestate`).toEqual(Option.none());
      }

      // An id that is no W3C id writes no key, the tracestate of its span with it.
      const unwritable = unwritableTraces(drawn);
      expect(
        unwritable.map(({ name }) => name),
        "every class (o) is reached",
      ).toEqual([...UNWRITABLE_CLASSES]);

      for (const trace of unwritable) {
        const frame = yield* tracedFrame(body, Option.some(externalSpanFor(trace)));
        expect(hasNoTraceKey(frame), `${trace.name}: no trace key is written`).toBe(true);
        expect(yield* spanOfFrame(frame), `${trace.name}: and none reads back`).toEqual(Option.none());
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// T2. Plant: fail with a FormatError on a bad traceparent (m); accept an all-zero trace id (m); keep a tracestate whose traceparent
// is invalid (n); make plain `encode` write the current span.
it.effect.prop(
  "T2 plain and broken traces: plain encode writes no trace, plain decode drops one, a broken traceparent is no trace and never an error, and a bad tracestate is dropped",
  { drawn: traceSeed, body: message },
  ({ drawn, body }) =>
    Effect.gen(function* () {
      // Plain `encode` writes no trace key, not even inside a span.
      const plain = yield* Stream.make(body).pipe(
        Transport.encode(Message),
        Stream.runCollect,
        Effect.withSpan("sender"),
      );

      expect(plain.length).toBe(1);
      expect(hasNoTraceKey(plain[0] ?? ""), "plain encode writes no trace key").toBe(true);

      // Plain `decode` of a frame that carries a trace gives the value and drops the trace.
      for (const trace of validTraces(drawn)) {
        const meta = {
          traceparent: `00-${trace.traceId}-${trace.spanId}-${flag(trace)}`,
          ...Option.match(trace.state, { onNone: () => ({}), onSome: (tracestate) => ({ tracestate }) }),
        };

        const back = yield* Stream.make(notification("value", body, {}, meta)).pipe(
          Transport.decode(Message),
          Stream.runCollect,
        );

        assert.deepStrictEqual(back, [body], `${trace.name}: plain decode gives the value alone`);
      }

      // A broken traceparent reads as the value with no trace.
      const broken = brokenMetas(drawn);
      expect(
        broken.map(({ name }) => name),
        "every class (m) is reached",
      ).toEqual([...BROKEN_TRACE_CLASSES]);

      for (const { name, meta } of broken) {
        const frame = notification("value", body, {}, meta);

        assert.deepStrictEqual(
          Option.map(yield* readTraced(frame), ({ value }) => value),
          Option.some(body),
          `${name}: the value reads`,
        );
        expect(yield* spanOfFrame(frame), `${name}: with no trace`).toEqual(Option.none());
      }

      // A tracestate that is not kept: with no valid traceparent there is no trace, and beside a valid one it is dropped alone.
      const dropped = droppedStates(drawn);
      expect(
        dropped.map(({ name }) => name),
        "every class (n) is reached",
      ).toEqual([...STATE_CLASSES]);

      for (const { name, meta, kept } of dropped) {
        const frame = notification("value", body, {}, meta);

        assert.deepStrictEqual(
          Option.map(yield* readTraced(frame), ({ value }) => value),
          Option.some(body),
          `${name}: the value reads`,
        );
        const span = yield* spanOfFrame(frame);

        // A valid traceparent beside the bad tracestate still reads, and a bad one leaves no trace to carry a tracestate.
        expect(
          Option.map(span, ({ traceId, spanId }) => [traceId, spanId]),
          `${name}: the traceparent`,
        ).toEqual(kept ? Option.some([drawn.trace, drawn.span]) : Option.none());
        expect(Option.flatMap(span, stateFrom), `${name}: the tracestate is dropped`).toEqual(Option.none());
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// T3. Plant: make `decodeTraced` give a new span id; drop the trace in `socket`.
it.effect.prop(
  "T3 a value traced with the ids of a span made by Effect's own tracer crosses the memory pair with the same trace id and span id",
  { body: message },
  ({ body }) =>
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      const trace = Tracer.externalSpan({ traceId: span.traceId, spanId: span.spanId, sampled: span.sampled });
      const [left, right] = yield* MemorySocket.pair;

      const chain = (values: Stream.Stream<Traced<Message>>) =>
        values.pipe(Transport.encodeTraced(Message), Transport.socket, Transport.decodeTraced(Message));

      const [, far] = yield* Effect.all(
        [
          end({ socket: left, send: Stream.make(traced(body, Option.some(trace))), expected: 0, chain }),
          end({ socket: right, send: Stream.empty, expected: 1, chain }),
        ],
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(
        far.map(({ value }) => value),
        [body],
      );
      expect(far.map((read) => idsFrom(read.trace))).toEqual([Option.some([span.traceId, span.spanId, span.sampled])]);
    }).pipe(Effect.withSpan("sender"), Effect.scoped, Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

/** The `transport.*` spans a tracer held, by name. */
const spanNamed = (spans: ReadonlyArray<Tracer.Span>, name: string) => spans.find((span) => span.name === name);

// T4. Plant: write the hello with plain `encode`; write the gateway's current span into the answer; write a trace with the tracer off.
it.effect.prop(
  "T4 the hello's trace: the hello frame's traceparent names the transport.connect.hello span's trace id and span id, accept's span is a child of it when the gateway runs the hello's trace as its parent, the frames challenge and answer write hold no _meta, and with the tracer off the hello holds none",
  { draw: helloDraw, drawn: traceSeed },
  ({ draw, drawn }) =>
    Effect.gen(function* () {
      const each = connectionCases(draw)[0];

      if (each === undefined) {
        return assert.fail("no case is made");
      }

      const format = yield* Format;
      const parents = validTraces(drawn);
      expect(
        parents.map(({ name }) => name),
        "every class (z) of parent is reached",
      ).toEqual([...VALID_TRACE_CLASSES]);

      for (const parent of parents) {
        // (y) on: the hello is sent under a span of Effect's own tracer, with a generated parent.
        const watched = yield* watching;

        const out = yield* runCase(yield* dialing, each).pipe(
          Effect.withParentSpan(externalSpanFor(parent)),
          Effect.withTracer(watched.tracer),
        );

        const hello = spanNamed(watched.spans, "transport.connect.hello");
        assert.isDefined(hello, `${parent.name}: the hello step made a span`);

        if (hello === undefined) {
          return;
        }

        const frame = out.seen.frames[0] ?? "";
        expect(metaFrom(frame).params._meta?.traceparent, `${parent.name}: the traceparent names the hello span`).toBe(
          `00-${hello.traceId}-${hello.spanId}-${hello.sampled ? "01" : "00"}`,
        );
        expect(hello.traceId, `${parent.name}: in the parent's trace`).toBe(parent.traceId);

        // The gateway runs the frame's trace as the parent of `accept`: its span is a child of the hello's.
        const gateway = yield* watching;
        const trace = Option.getOrThrow((yield* format.read(frame)).trace);
        yield* Transport.accept({ versions: each.gateway.versions, hello: signInApp.proof })(frame).pipe(
          Effect.withParentSpan(trace),
          Effect.withTracer(gateway.tracer),
        );
        const accepting = spanNamed(gateway.spans, "transport.accept");
        expect(
          Option.map(accepting?.parent ?? Option.none(), (span) => [span.traceId, span.spanId]),
          `${parent.name}: accept is a child of the hello span`,
        ).toEqual(Option.some([hello.traceId, hello.spanId]));
      }

      // The gateway's two frames carry no trace, though they are written under a span.
      const asked = yield* Transport.challenge(Challenge)(challengeFrom(draw.nonce)).pipe(Effect.withSpan("gateway"));

      const answered = yield* Transport.answer(SignInAnswer)({
        version: 1,
        ping: Duration.millis(draw.ping),
        answer: Refused.make({ reason: draw.reason }),
      }).pipe(Effect.withSpan("gateway"));

      for (const written of [asked, answered]) {
        expect(hasNoTraceKey(written), "a gateway frame holds no trace key").toBe(true);
      }

      // (y) off: with the tracer off, the hello holds no trace, parent or not.
      const off = yield* watching;

      const quiet = yield* runCase(yield* dialing, each).pipe(
        Effect.withParentSpan(externalSpanFor(parents[0] ?? validTraces(drawn)[0]!)),
        Effect.withTracerEnabled(false),
        Effect.withTracer(off.tracer),
      );

      expect(quiet.seen.frames.length > 0, "the hello was sent").toBe(true);
      expect(hasNoTraceKey(quiet.seen.frames[0] ?? ""), "(y) the tracer off: the hello holds no trace").toBe(true);
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

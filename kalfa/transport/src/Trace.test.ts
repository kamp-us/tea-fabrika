// T1 to T3: the sender's trace rides in the frame, under params._meta, as the W3C `traceparent` and `tracestate` (the way MCP carries
// it). A span held by `encodeTraced` is written, a plain `encode` writes none, a broken trace in a frame is no trace and never an
// error, and a span made by Effect's own tracer crosses the memory pair with its ids.
import { assert, expect, it } from "@effect/vitest";
import { Effect, Option, Stream, Tracer } from "effect";
import { Format, Transport } from "./index.ts";
import type { Traced } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";
import {
  BROKEN_TRACE_CLASSES,
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
// given (o: the writer promised a trace the reader drops); do not pad a 16-digit trace id (o).
it.effect.prop(
  "T1 the trace is written and read: encodeTraced then decodeTraced gives the same trace id, span id, sampled flag and tracestate, and an id that is no W3C id writes no trace key",
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

      // A 16-digit trace id is written padded to 32 and reads back padded.
      const short = shortTrace(drawn);
      const padded = yield* tracedFrame(body, Option.some(externalSpanFor(short)));
      expect(metaFrom(padded).params._meta?.traceparent, "o: a 16-digit trace id is padded").toBe(
        `00-${"0".repeat(16)}${short.traceId}-${short.spanId}-01`,
      );
      expect(
        Option.map(yield* spanOfFrame(padded), (span) => span.traceId),
        "o: and reads back padded",
      ).toEqual(Option.some(`${"0".repeat(16)}${short.traceId}`));

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

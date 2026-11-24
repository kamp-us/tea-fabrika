// S1 to S5: the one span a running socket makes, `transport.socket`, made with Effect's own calls and read here from a tracer held in
// memory. It ends when the stream ends, fails with the SocketError of a close other than 1000, and is never made when tracing is off.
import { assert, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Cause, Duration, Effect, Exit, Option, Predicate, Schema, Stream } from "effect";
import type { Tracer } from "effect";
import { Socket } from "effect/socket";
import { Format, FormatError, NoSharedVersion, Transport } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";
import {
  Admitted,
  attempt,
  between,
  bothWays,
  Challenge,
  challengeFrom,
  closeFrom,
  connectionCases,
  dialing,
  HELLO_CLASSES,
  helloDraw,
  helloValue,
  handshakes,
  hellos,
  LIST_CLASSES,
  Message,
  message,
  notification,
  PING_CLASSES,
  Proof,
  runCase,
  SEED,
  SignInAnswer,
  unwritablePings,
  versionLists,
  watching,
} from "./Transport.test-support.ts";

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
  { left: messages, right: messages, extra: between(0, 1999) },
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
      for (const code of [1000, 3000, 3999, 4999, 3000 + extra]) {
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

/** The error a span ended with, when it failed. */
const failedWith = (span: Tracer.Span) =>
  Predicate.isTagged(span.status, "Ended") && Exit.isFailure(span.status.exit)
    ? Cause.findErrorOption(span.status.exit.cause)
    : Option.none();

const endedOk = (span: Tracer.Span) => Predicate.isTagged(span.status, "Ended") && Exit.isSuccess(span.status.exit);

const ATTRIBUTES = ["kalfa.transport.features", "kalfa.transport.version", "kalfa.transport.versions"];

/** The names of a span's attributes, sorted. */
const attributeNames = (span: Tracer.Span) => [...span.attributes.keys()].sort();

/** The three attributes of a span, as they were set: the version both ends agreed, the client's versions and the client's features. */
const attributeValues = (span: Tracer.Span) => ({
  version: span.attributes.get("kalfa.transport.version"),
  versions: span.attributes.get("kalfa.transport.versions"),
  features: span.attributes.get("kalfa.transport.features"),
});

// S3. Plant: make no span for the answer step; end the spans ok on a NoSharedVersion from the gateway; add a `kalfa.transport.answer`
// attribute; set `kalfa.transport.version` to the highest version of the client's list, or to the gateway's first.
it.effect.prop(
  "S3 connect's spans: transport.connect with, under it and in order, a child for each step reached and no others; a refusal ends the step where it happened and transport.connect with that error; on success transport.connect has exactly the version, versions and features attributes",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const tags = { format: "FormatError", noShared: "NoSharedVersion", app: "AppFailure" } as const;

      // The connections that fail: (a) to (d) and (g) to (j).
      for (const each of handshakes(draw)) {
        const watched = yield* watching;
        yield* attempt(each).pipe(Effect.withTracer(watched.tracer));

        const connect = watched.spans.filter(({ name }) => name === "transport.connect");
        expect(connect.length, `${each.name}: one transport.connect`).toBe(1);
        const [top] = connect;

        if (top === undefined) {
          return assert.fail("no transport.connect span");
        }

        const children = watched.spans.filter(({ name }) => name.startsWith("transport.connect."));
        expect(
          children.map(({ name }) => name),
          `${each.name}: a child for each step reached, in order`,
        ).toEqual(each.steps.map((step) => `transport.connect.${step}`));
        expect(
          children.map(({ parent }) => Option.map(parent, ({ spanId }) => spanId)),
          `${each.name}: each under transport.connect`,
        ).toEqual(children.map(() => Option.some(top.spanId)));

        const last = children.length - 1;
        const tag = tags[each.expected.kind];

        for (const [index, child] of children.entries()) {
          expect(
            endedOk(child) === index < last,
            `${each.name}: ${child.name} ends ok only if the refusal came later`,
          ).toBe(true);
        }

        expect(
          Option.exists(failedWith(Arr.getUnsafe(children, last)), Predicate.isTagged(tag)),
          `${each.name}: the step where it happened fails with the error`,
        ).toBe(true);
        expect(
          Option.exists(failedWith(top), Predicate.isTagged(tag)),
          `${each.name}: transport.connect fails with the same error`,
        ).toBe(true);
      }

      // The connections that succeed: (m), one for each answer.
      for (const each of connectionCases(draw).slice(0, 3)) {
        const watched = yield* watching;
        yield* runCase(yield* dialing, each).pipe(Effect.withTracer(watched.tracer));

        const connect = watched.spans.find(({ name }) => name === "transport.connect");
        const children = watched.spans.filter(({ name }) => name.startsWith("transport.connect."));

        expect(
          children.map(({ name }) => name),
          `${each.name}: the three steps, in order`,
        ).toEqual(["transport.connect.challenge", "transport.connect.hello", "transport.connect.answer"]);
        expect(children.every(endedOk), `${each.name}: each step ends ok`).toBe(true);
        expect(connect !== undefined && endedOk(connect), `${each.name}: transport.connect ends ok`).toBe(true);
        expect(
          connect === undefined ? [] : attributeNames(connect),
          `${each.name}: exactly the three attributes`,
        ).toEqual(ATTRIBUTES);
        expect(
          connect === undefined ? undefined : attributeValues(connect),
          `${each.name}: the agreed version, the client's versions and its features`,
        ).toEqual({ version: each.picked, versions: each.client.versions, features: each.client.features });
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// S4. Plant: build `accept` with `Effect.fnUntraced`; end `transport.accept` ok on (o); set `kalfa.transport.version` to the client's first version.
it.effect.prop(
  "S4 the gateway's spans: accept makes one transport.accept with the three attributes on success, failed with NoSharedVersion or FormatError otherwise; challenge makes one transport.challenge; answer makes one transport.answer, failed for a ping it cannot write",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const only = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const watched = yield* watching;
          yield* Effect.exit(effect.pipe(Effect.withTracer(watched.tracer)));

          return watched.spans;
        });

      // accept, for each list (n) and (o) and each frame (p) and (q).
      const lists = versionLists(draw.pool);
      expect(
        lists.map(({ name }) => name),
        "every class (n) and (o) is reached",
      ).toEqual([...LIST_CLASSES]);

      for (const each of lists) {
        const frame = notification("hello", helloValue(draw, { versions: [...each.client] }));
        const spans = yield* only(Transport.accept({ versions: each.gateway, hello: Proof })(frame));

        expect(
          spans.map(({ name }) => name),
          `${each.name}: one span`,
        ).toEqual(["transport.accept"]);

        if (Option.isSome(each.picked)) {
          expect(endedOk(spans[0]!), `${each.name}: ends ok`).toBe(true);
          expect(attributeNames(spans[0]!), `${each.name}: the three attributes`).toEqual(ATTRIBUTES);
          expect(
            attributeValues(spans[0]!),
            `${each.name}: the agreed version, the client's versions and its features`,
          ).toEqual({
            version: each.picked.value,
            versions: [...each.client],
            features: [...draw.features],
          });
        } else {
          expect(
            Option.exists(failedWith(spans[0]!), Predicate.isTagged("NoSharedVersion")),
            `${each.name}: fails with NoSharedVersion`,
          ).toBe(true);
        }
      }

      for (const each of hellos(draw)) {
        const spans = yield* only(Transport.accept({ versions: [1], hello: Proof })(each.frame));

        expect(
          spans.map(({ name }) => name),
          `${each.name}: one span`,
        ).toEqual(["transport.accept"]);
        expect(
          Option.exists(failedWith(spans[0]!), Predicate.isTagged("FormatError")),
          `${each.name}: fails with FormatError`,
        ).toBe(true);
      }

      expect(hellos(draw).length, "every class (p) and (q) is reached").toBe(HELLO_CLASSES.length);

      // challenge and answer: one span each, ok.
      const asked = yield* only(Transport.challenge(Challenge)(challengeFrom(draw.nonce)));
      expect(asked.map(({ name }) => name)).toEqual(["transport.challenge"]);
      expect(endedOk(asked[0]!), "challenge ends ok").toBe(true);

      const reply = {
        version: 1,
        ping: Duration.millis(draw.ping),
        answer: Admitted.make({ name: draw.text }),
      } as const;

      const answered = yield* only(Transport.answer(SignInAnswer)(reply));
      expect(answered.map(({ name }) => name)).toEqual(["transport.answer"]);
      expect(endedOk(answered[0]!), "answer ends ok").toBe(true);

      const refusing = yield* only(
        Transport.answer(SignInAnswer)(new NoSharedVersion({ client: draw.left, gateway: draw.right })),
      );

      expect(refusing.map(({ name }) => name)).toEqual(["transport.answer"]);

      // A ping it cannot write: the span fails with a FormatError.
      const pings = unwritablePings(draw);
      expect(
        pings.map(({ name }) => name),
        "every class (s) is reached",
      ).toEqual([...PING_CLASSES]);

      for (const { name, ping } of pings) {
        const spans = yield* only(Transport.answer(SignInAnswer)({ ...reply, ping }));
        expect(
          spans.map(({ name: each }) => each),
          `${name}: one span`,
        ).toEqual(["transport.answer"]);
        expect(
          Option.map(failedWith(spans[0]!), (error) => (Schema.is(FormatError)(error) ? "FormatError" : error)),
          `${name}: fails`,
        ).toEqual(Option.some("FormatError"));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// S5. Plant: turn tracing on again inside `connect` with `Effect.withTracerEnabled(true)`.
it.effect.prop(
  "S5 the tracer off: under Effect.withTracerEnabled(false), connect, accept, challenge and answer leave the tracer held in memory empty and connect still succeeds; with tracing on the same run makes spans",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const [each] = connectionCases(draw);

      if (each === undefined) {
        return assert.fail("no case is made");
      }

      const gateway = (value: string) =>
        Effect.gen(function* () {
          const frame = yield* Transport.challenge(Challenge)(challengeFrom(value));
          const hello = notification("hello", helloValue(draw));
          yield* Effect.exit(Transport.accept({ versions: [draw.pool[0] ?? 1], hello: Proof })(hello));
          yield* Transport.answer(SignInAnswer)({
            version: 1,
            ping: Duration.millis(draw.ping),
            answer: Admitted.make({ name: value }),
          });

          return frame;
        });

      const on = yield* watching;
      yield* Effect.all([runCase(yield* dialing, each), gateway(draw.nonce)], { concurrency: 1 }).pipe(
        Effect.withTracer(on.tracer),
      );
      expect(on.spans.length > 0, "the tracer sees the spans of a run with tracing on").toBe(true);

      const off = yield* watching;

      const out = yield* Effect.all([runCase(yield* dialing, each), gateway(draw.nonce)], { concurrency: 1 }).pipe(
        Effect.withTracerEnabled(false),
        Effect.withTracer(off.tracer),
      );

      expect(off.spans, "no span with tracing off").toEqual([]);
      expect(out[0].version, "connect still succeeds").toBe(each.picked);
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

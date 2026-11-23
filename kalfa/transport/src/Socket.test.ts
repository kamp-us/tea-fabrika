// C1 to C5: `Transport.socket` on the memory pair. Values flow both ways at once and in order, a clean close ends the stream and any
// other close fails it, a caller's failure stays the caller's, no state is kept between frames, and bytes from the far end are
// read as UTF-8 text.
import { assert, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Fiber, Option, Schema, Stream } from "effect";
import { Socket } from "effect/socket";
import { Format, Transport } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";
import {
  between,
  bothWays,
  end,
  exitClose,
  failureFrom,
  finished,
  mailbox,
  Message,
  message,
  progressMessage,
  SEED,
  seed,
  sends,
  settled,
  through,
  valueClasses,
  wellFormedText,
  word,
} from "./Transport.test-support.ts";

class StageFailed extends Schema.TaggedError<StageFailed, { readonly brand: unique symbol }>()("StageFailed", {
  word: Schema.String,
}) {}

/** An end that sends its next value only after it read the other end's last: the left sends first, the right answers each. */
const lockstep = (rounds: number) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const first = yield* mailbox<unknown>();
    const second = yield* mailbox<unknown>();
    yield* first.send(progressMessage(0, 1));

    return yield* Effect.all(
      [
        end({
          socket: near,
          send: first.stream,
          expected: rounds,
          chain: through(Message),
          react: (_, index) => (index + 1 < rounds ? first.send(progressMessage(index + 1, 1)) : first.finish),
        }),
        end({
          socket: far,
          send: second.stream,
          expected: rounds,
          chain: through(Message),
          react: (_, index) =>
            Effect.andThen(second.send(progressMessage(index, 2)), index + 1 >= rounds ? second.finish : Effect.void),
        }),
      ],
      { concurrency: "unbounded" },
    );
  }).pipe(Effect.scoped);

// C1. Plant: make `socket` drain `out` before it reads, a request and then its answer (the lockstep run stalls, and a run of
// both ways at once stalls too); make the pair deliver an end's writes to its own reader.
it.effect.prop(
  "C1 two ways at once, in order: each end reads exactly what the other sent, in order, while it is still sending, and an end that sends only after it read never stalls",
  {
    left: Arbitrary.array(between(0, 1_000_000), { maxLength: 50 }),
    right: Arbitrary.array(between(0, 1_000_000), { maxLength: 50 }),
    rounds: between(1, 25),
  },
  ({ left, right, rounds }) =>
    Effect.gen(function* () {
      const sent = { left: sends(1, left.length), right: sends(2, right.length) };

      // Both ends send 0 to 50 values at once, and one end sends none.
      for (const [name, one, other] of [
        ["both ends send", sent.left, sent.right],
        ["the left end sends none", [], sent.right],
        ["the right end sends none", sent.left, []],
      ] as const) {
        const [read, readFar] = finished(yield* settled(bothWays(one, other)), name);

        assert.deepStrictEqual(read, other, `${name}: the left end reads what the right sent`);
        assert.deepStrictEqual(readFar, one, `${name}: the right end reads what the left sent`);
      }

      // Lockstep: an end sends its next value only after it read the other end's last.
      const [read, readFar] = finished(yield* settled(lockstep(rounds)), "lockstep");

      assert.deepStrictEqual(read, sends(2, rounds), "the left end reads the right's answers in order");
      assert.deepStrictEqual(readFar, sends(1, rounds), "the right end reads the left's values in order");
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

/** The close codes (q): a clean one, going away, an abnormal one, a server error and the application's own range. */
const CODES = (extra: number): ReadonlyArray<number> => [1000, 1001, 1006, 1011, 4000 + extra];

/** The far end writes `frames`, then closes; the near end's `socket` stream is read to its end. */
const closedBy = (frames: ReadonlyArray<string | Uint8Array>, close: Socket.CloseEvent, later: boolean) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const writer = yield* far.writer;
    const seen: Array<string> = [];

    const farWrites = Effect.forEach(frames, (frame) => writer.write(frame), { concurrency: 1, discard: true }).pipe(
      Effect.andThen(writer.write(close)),
    );

    const nearReads = Stream.empty.pipe(
      Transport.socket,
      Stream.runForEach((frame) => Effect.sync(() => seen.push(frame))),
      Effect.provideService(Socket.Socket, near),
      Effect.exit,
    );

    const exit = yield* Effect.suspend(() =>
      later
        ? Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(nearReads);
            yield* Effect.yieldNow;
            yield* farWrites;

            return yield* Fiber.join(fiber);
          })
        : Effect.andThen(farWrites, nearReads),
    );

    return { exit, seen };
  }).pipe(Effect.scoped);

// C2. Plant: end cleanly on every code (q); fail on 1000 (q); drop the frames waiting when the close came.
it.effect.prop(
  "C2 a close: a far end closing with code 1000 ends the near stream cleanly after every frame written before the close, and any other code fails it with a SocketError holding that code and reason",
  {
    frames: Arbitrary.array(word, { maxLength: 20 }),
    reason: word,
    extra: between(0, 999),
    later: Arbitrary.schema(Schema.Boolean),
  },
  ({ frames, reason, extra, later }) =>
    Effect.gen(function* () {
      for (const code of CODES(extra)) {
        for (const reasoned of [false, true]) {
          const name = `code ${code}${reasoned ? " with a reason" : ""}`;

          const { exit, seen } = finished(
            yield* settled(closedBy(frames, new Socket.CloseEvent(code, reasoned ? reason : undefined), later)),
            name,
          );

          assert.deepStrictEqual(seen, frames, `${name}: every frame written before the close is read, in order`);
          expect(failureFrom(exit).defect, `${name}: never a defect`).toBe(false);

          // A clean close ends the stream cleanly; any other fails it with the close, its code and its reason.
          expect(Exit.isSuccess(exit), `${name}: a clean close, and only it, ends the stream cleanly`).toBe(
            code === 1000,
          );
          expect(exitClose(exit), `${name}: the close the stream fails with`).toEqual(
            code === 1000 ? Option.none() : Option.some({ code, reason: reasoned ? reason : undefined }),
          );
        }
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

/** A stage's failure that looks like a clean close: a plain object, and a SocketError of close 1000 that the stage's own socket raised. */
const lookAlikes = (reason: string) =>
  [
    {
      name: "an object shaped like a close",
      failure: { reason: new Socket.SocketCloseError({ code: 1000, closeReason: reason }) },
    },
    {
      name: "a SocketError of close 1000",
      failure: new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000, closeReason: reason }) }),
    },
  ] as const;

// C3. Plant: wrap the stage's error in a SocketError; end the chain cleanly on a stage's failure that is shaped like a close of 1000.
it.effect.prop(
  "C3 the caller's failure stays the caller's: a stage that fails after some values fails the chain with its own error, even one shaped like a clean close, and the far end reads those values and sees a clean close",
  { values: Arbitrary.array(message, { maxLength: 10 }), failure: word },
  ({ values, failure }) =>
    Effect.gen(function* () {
      const failing = [{ name: "a tagged error", failure: new StageFailed({ word: failure }) }, ...lookAlikes(failure)];

      for (const { name, failure: own } of failing) {
        const [near, far] = finished(
          yield* settled(
            Effect.gen(function* () {
              const [nearSocket, farSocket] = yield* MemorySocket.pair;

              return yield* Effect.all(
                [
                  Stream.fromIterable(values).pipe(
                    Stream.concat(Stream.fail(own)),
                    Transport.encode(Message),
                    Transport.socket,
                    Stream.runDrain,
                    Effect.provideService(Socket.Socket, nearSocket),
                    Effect.exit,
                  ),
                  Stream.empty.pipe(
                    Transport.socket,
                    Transport.decode(Message),
                    Stream.runCollect,
                    Effect.provideService(Socket.Socket, farSocket),
                    Effect.exit,
                  ),
                ],
                { concurrency: "unbounded" },
              );
            }).pipe(Effect.scoped),
          ),
          name,
        );

        const { error, defect } = failureFrom(near);

        expect(defect, `${name}: never a defect`).toBe(false);
        assert.isTrue(
          Option.exists(error, (each) => each === own),
          `${name}: the chain fails with the stage's own error`,
        );
        expect(far, `${name}: the far end sees a clean close, after every value written before the failure`).toEqual(
          Exit.succeed(values),
        );
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// C4. Plant: skip a value equal to the one before it.
it.effect.prop(
  "C4 no state between frames: decoding a run of frames in one stream gives the same values as decoding each frame in a stream of its own, repeats included",
  { seeds: Arbitrary.array(seed, { minLength: 1, maxLength: 3 }), repeats: between(2, 6) },
  ({ seeds, repeats }) =>
    Effect.gen(function* () {
      for (const { name, schema, values } of valueClasses(seeds)) {
        // Each value, then the first one repeated: runs of one value are among the frames.
        const run = [...values, ...Array.from({ length: repeats }, () => values[0])];
        const frames = yield* Stream.fromIterable(run).pipe(Transport.encode(schema), Stream.runCollect);

        const together = yield* Stream.fromIterable(frames).pipe(Transport.decode(schema), Stream.runCollect);

        const apart = yield* Effect.forEach(
          frames,
          (frame) => Stream.make(frame).pipe(Transport.decode(schema), Stream.runCollect),
          { concurrency: 1 },
        ).pipe(Effect.map((each) => each.flat()));

        assert.deepStrictEqual(together, apart, `${name}: one stream or many`);
        assert.deepStrictEqual(together, run, `${name}: the values, repeats included`);
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

/** The index of a UTF-8 continuation byte, where a write can cut a character in two. */
const cutPoint = (bytes: Uint8Array, wanted: number): number => {
  const inside = Array.from(bytes, (byte, index) => [byte, index] as const)
    .filter(([byte, index]) => index > 0 && (byte & 0b1100_0000) === 0b1000_0000)
    .map(([, index]) => index);

  return inside[wanted % inside.length] ?? 1;
};

// C5. Plant: build `socket` on `Socket.toChannel` and turn each chunk into text with `String()`.
it.effect.prop(
  "C5 bytes from the far end: frames written as UTF-8 bytes arrive as the same text, one frame each, and a character cut across two writes is whole in the text",
  {
    texts: Arbitrary.array(wellFormedText, { minLength: 1, maxLength: 5 }),
    cut: between(0, 1_000_000),
    later: Arbitrary.schema(Schema.Boolean),
  },
  ({ texts, cut, later }) =>
    Effect.gen(function* () {
      const encoder = new TextEncoder();

      const whole = finished(
        yield* settled(
          closedBy(
            texts.map((text) => encoder.encode(text)),
            new Socket.CloseEvent(1000),
            later,
          ),
        ),
        "whole frames",
      );

      assert.deepStrictEqual(whole.seen, texts, "whole frames: the same text, one frame each");

      // A character cut across two writes: the two writes read as the whole text, with no mark of the cut.
      const text = `${texts.join("")}é设😀`;
      const bytes = encoder.encode(text);
      const point = cutPoint(bytes, cut);

      const cutOff = finished(
        yield* settled(closedBy([bytes.slice(0, point), bytes.slice(point)], new Socket.CloseEvent(1000), !later)),
        "a cut character",
      );

      expect(Exit.isSuccess(cutOff.exit), "a cut character: a clean close").toBe(true);
      expect(cutOff.seen.length, "a cut character: one frame for each write").toBe(2);
      expect(cutOff.seen.join(""), "a cut character: the text, whole").toBe(text);
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

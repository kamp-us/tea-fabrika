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
  awkwardText,
  textMessage,
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
// The codes a browser lets a client write, which the memory pair keeps: 1000 and 3000 to 4999.
const CODES = (extra: number): ReadonlyArray<number> => [1000, 3000, 3999, 4999, 3000 + extra];

/** The far end writes `frames`, then closes; the near end's `socket` stream is read to its end. */
const closedBy = <R = never>(
  frames: ReadonlyArray<string | Uint8Array>,
  close: Socket.CloseEvent,
  later: boolean,
  sending: Stream.Stream<string, never, R> = Stream.empty,
) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const writer = yield* far.writer;
    const seen: Array<string> = [];

    const farWrites = Effect.forEach(frames, (frame) => writer.write(frame), { concurrency: 1, discard: true }).pipe(
      Effect.andThen(writer.write(close)),
    );

    const nearReads = sending.pipe(
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
    extra: between(0, 1999),
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

/** A frame of bytes a far end writes: a message in UTF-8 with a multi-byte character in it, whole or cut where a character begins. */
const byteFrame = Arbitrary.all({
  text: wellFormedText,
  cut: Arbitrary.schema(Schema.Boolean),
  wanted: between(0, 1_000_000),
}).pipe(Arbitrary.map(({ text, cut, wanted }) => ({ body: textMessage(`${text}é设😀`), cut, wanted })));

/** The index of a UTF-8 continuation byte, where a write can cut a character in two. */
const cutPoint = (bytes: Uint8Array, wanted: number): number => {
  const inside = Array.from(bytes, (byte, index) => [byte, index] as const)
    .filter(([byte, index]) => index > 0 && (byte & 0b1100_0000) === 0b1000_0000)
    .map(([, index]) => index);

  return inside[wanted % inside.length] ?? 1;
};

// C4. Plant: skip a value equal to the one before it; keep the byte decoder's state from one frame to the next.
it.effect.prop(
  "C4 no state between frames: decoding a run of frames in one stream gives the same values as decoding each frame in a stream of its own, repeats included, and a frame of bytes that ends in half a character changes nothing in the next frame",
  {
    seeds: Arbitrary.array(seed, { minLength: 1, maxLength: 3 }),
    repeats: between(2, 6),
    byteFrames: Arbitrary.array(byteFrame, { minLength: 2, maxLength: 6 }),
    later: Arbitrary.schema(Schema.Boolean),
  },
  ({ seeds, repeats, byteFrames, later }) =>
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

      // Frames of bytes: each is read on its own, whole or ending in half a character, whatever the frame before it was.
      const chunks = yield* Effect.forEach(
        byteFrames,
        ({ body, cut, wanted }) =>
          Stream.make(body).pipe(
            Transport.encode(Message),
            Stream.runCollect,
            Effect.map((frames) => {
              const bytes = new TextEncoder().encode(frames[0] ?? "");

              return cut ? bytes.slice(0, cutPoint(bytes, wanted)) : bytes;
            }),
          ),
        { concurrency: 1 },
      );

      const { exit, seen } = finished(
        yield* settled(closedBy(chunks, new Socket.CloseEvent(1000), later)),
        "frames of bytes",
      );

      expect(Exit.isSuccess(exit), "frames of bytes: a clean close").toBe(true);
      expect(seen.length, "frames of bytes: one frame for each write").toBe(chunks.length);

      for (const [index, chunk] of chunks.entries()) {
        const { body, cut } = byteFrames[index] ?? byteFrames[0]!;
        const alone = new TextDecoder().decode(chunk);

        expect(seen[index], `frames of bytes ${index}: the text of its own bytes and nothing of the frame before`).toBe(
          alone,
        );

        const read = yield* Stream.make(seen[index] ?? "").pipe(
          Transport.decode(Message),
          Stream.runCollect,
          Effect.exit,
        );

        if (cut) {
          expect(
            Option.map(failureFrom(read).error, (each) => each.reason),
            `frames of bytes ${index}: a frame cut in half a character fails on its own with text`,
          ).toEqual(Option.some("text"));
        } else {
          assert.deepStrictEqual(
            Exit.isSuccess(read) ? read.value : [],
            [body],
            `frames of bytes ${index}: a whole frame gives its value`,
          );
        }
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// C5. Plant: build `socket` on `Socket.toChannel` and turn each chunk into text with `String()`; decode the chunks with one streaming
// decoder, so half a character of a frame waits for the next frame; encode each text frame to bytes and decode it again (a leading
// U+FEFF is dropped and a lone surrogate becomes U+FFFD).
it.effect.prop(
  "C5 frames from the far end: a frame written as text arrives as the same string, a BOM and lone surrogates included, frames written as UTF-8 bytes arrive as the same text, one frame each, and a frame that ends in half a character is no part of the frame after it",
  {
    texts: Arbitrary.array(wellFormedText, { minLength: 1, maxLength: 5 }),
    raw: Arbitrary.array(awkwardText, { minLength: 1, maxLength: 5 }),
    cut: between(0, 1_000_000),
    later: Arbitrary.schema(Schema.Boolean),
  },
  ({ texts, raw, cut, later }) =>
    Effect.gen(function* () {
      const encoder = new TextEncoder();

      // A frame written as text arrives as the same string: a leading U+FEFF and a lone surrogate are no part of a decoder's work.
      const sent = [
        ...raw,
        `${String.fromCharCode(0xfeff)}${raw[0]}`,
        `${raw[0]}${String.fromCharCode(0xd800)}`,
        `${String.fromCharCode(0xdc00)}${raw[0]}`,
        String.fromCharCode(0xfeff),
        String.fromCharCode(0xd83d),
      ];

      const asText = finished(yield* settled(closedBy(sent, new Socket.CloseEvent(1000), later)), "text frames");

      assert.deepStrictEqual(asText.seen, sent, "text frames: the same strings, a BOM and lone surrogates included");

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

      // A frame that ends in half a character, then a good frame: the second is its own text, with no mark left by the first.
      const text = `${texts.join("")}é设😀`;
      const bytes = encoder.encode(text);
      const point = cutPoint(bytes, cut);
      const next = encoder.encode(texts[0] ?? "");

      const cutOff = finished(
        yield* settled(closedBy([bytes.slice(0, point), next], new Socket.CloseEvent(1000), !later)),
        "a frame cut in half a character",
      );

      expect(Exit.isSuccess(cutOff.exit), "a frame cut in half a character: a clean close").toBe(true);
      expect(cutOff.seen.length, "a frame cut in half a character: one frame for each write").toBe(2);
      expect(cutOff.seen[0], "a frame cut in half a character: the text of its own bytes").toBe(
        new TextDecoder().decode(bytes.slice(0, point)),
      );
      expect(cutOff.seen[1], "the frame after it: its own text, whole").toBe(texts[0]);
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// C6. Plant: let the end that ends first leave the socket open (a waiting pull stays blocked); close it with 1006.
it.effect.prop(
  "C6 the end of a chain closes the socket: when the chain of one end ends first, the chain of the other end ends cleanly after every value sent before, whichever end ends first",
  {
    values: Arbitrary.array(message, { maxLength: 10 }),
    nearFirst: Arbitrary.schema(Schema.Boolean),
  },
  ({ values, nearFirst }) =>
    Effect.gen(function* () {
      const read = finished(
        yield* settled(
          Effect.gen(function* () {
            const [near, far] = yield* MemorySocket.pair;
            const [first, second] = nearFirst ? [near, far] : [far, near];

            // The first end sends its values and expects none, so its chain ends as soon as it has sent them; the second expects one
            // more than it is sent, so only the close can end its chain.
            const [, waited] = yield* Effect.all(
              [
                end({ socket: first, send: Stream.fromIterable(values), expected: 0, chain: through(Message) }),
                end({ socket: second, send: Stream.empty, expected: values.length + 1, chain: through(Message) }),
              ],
              { concurrency: "unbounded" },
            );

            return waited;
          }).pipe(Effect.scoped),
        ),
        nearFirst ? "the near end first" : "the far end first",
      );

      assert.deepStrictEqual(
        read,
        values,
        "the other end read every value sent, in order, and its chain ended cleanly",
      );
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// C7. Plant: let a write to an end whose far end closed with 1000 fail with the write error; end the chain with that failure.
it.effect.prop(
  "C7 a write after the far end's clean close is dropped: when the far end closes with 1000 while the near end is still writing, the near chain ends cleanly with every frame the far end sent, whichever came first",
  {
    sentBefore: Arbitrary.array(word, { maxLength: 10 }),
    values: Arbitrary.array(message, { minLength: 1, maxLength: 10 }),
    later: Arbitrary.schema(Schema.Boolean),
  },
  ({ sentBefore, values, later }) =>
    Effect.gen(function* () {
      const writing = Stream.fromIterable(values).pipe(Transport.encode(Message), Stream.orDie);

      const { exit, seen } = finished(
        yield* settled(closedBy(sentBefore, new Socket.CloseEvent(1000), later, writing)),
        "a near end that writes on",
      );

      expect(failureFrom(exit).defect, "never a defect").toBe(false);
      expect(Exit.isSuccess(exit), "the near chain ends cleanly, and never with the write error").toBe(true);
      assert.deepStrictEqual(seen, sentBefore, "every frame the far end sent before its close is read, in order");
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// M1: the memory pair keeps Effect's reader contract, the one every socket Layer keeps: a pull waiting on an end fails when the end's
// reader scope closes, the far end reads every frame written before and then fails with the close, a CloseEvent write closes with its
// code and reason, and a write to a closed end fails and is never dropped in silence. A WebSocket whose peer closed with 1000 drops
// the writes it is still given and fails none of them, and so does the pair.
import { assert, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Fiber, Option, Predicate, Schema, Scope } from "effect";
import { Socket } from "effect/socket";
import * as MemorySocket from "./MemorySocket.ts";
import {
  between,
  exitClose,
  failureFrom,
  finished,
  pick,
  SEED,
  settled,
  wellFormedText,
  word,
} from "./Transport.test-support.ts";

/** A frame as a socket holds it: text, or bytes. */
const chunk: Arbitrary.Arbitrary<string | Uint8Array> = Arbitrary.all({
  text: wellFormedText,
  bytes: Arbitrary.array(between(0, 255), { minLength: 1, maxLength: 12 }),
  isBytes: Arbitrary.schema(Schema.Boolean),
}).pipe(Arbitrary.map(({ text, bytes, isBytes }) => (isBytes ? Uint8Array.from(bytes) : text)));

/** An end's reader read to its failure: every frame it gave, and the failure that ended it. */
const drained = (socket: Socket.Socket) =>
  Effect.gen(function* () {
    const { pull } = yield* socket.reader;
    const frames: Array<string | Uint8Array> = [];

    for (;;) {
      const batch = yield* Effect.exit(pull);

      if (Exit.isFailure(batch)) {
        return { frames, exit: batch };
      }

      frames.push(...batch.value);
    }
  });

/** Whether a write to a closed end fails with the write error, the one an end gives. */
const writeRefused = (attempt: Effect.Effect<void, Socket.SocketError>) =>
  Effect.exit(attempt).pipe(
    Effect.map((exit) =>
      Option.exists(failureFrom(exit).error, (error) => Predicate.isTagged(error.reason, "SocketWriteError")),
    ),
  );

/** A scope closed: the end's own waiting pull fails, and the far end reads what was waiting, then the close. */
const closedByScope = (frames: ReadonlyArray<string | Uint8Array>, more: string | Uint8Array) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const readScope = yield* Scope.make();
    const { pull } = yield* Scope.provide(near.reader, readScope);
    const writer = yield* near.writer;
    const waiting = yield* Effect.forkChild(Effect.exit(pull));
    yield* Effect.yieldNow;

    for (const frame of frames) {
      yield* writer.write(frame);
    }

    yield* Scope.close(readScope, Exit.void);
    const ownPull = yield* Fiber.join(waiting);
    const refused = yield* writeRefused(writer.write(more));
    const refusedAll = yield* writeRefused(writer.writeAll([more]));

    return { ownPull, refused, refusedAll, read: yield* drained(far) };
  }).pipe(Effect.scoped);

/** A CloseEvent: the far end reads what was waiting, then the code and the reason. */
const closedByEvent = (
  frames: ReadonlyArray<string | Uint8Array>,
  more: string | Uint8Array,
  close: Socket.CloseEvent,
  by: "client" | "gateway",
) =>
  Effect.gen(function* () {
    const [client, gateway] = yield* MemorySocket.pair;
    const writer = yield* (by === "client" ? client : gateway).writer;

    for (const frame of frames) {
      yield* writer.write(frame);
    }

    yield* writer.write(close);
    const refused = yield* writeRefused(writer.write(more));

    return { refused, read: yield* drained(by === "client" ? gateway : client) };
  }).pipe(Effect.scoped);

/** A CloseEvent a browser refuses: the write fails, nothing closes, and a close that is allowed still closes with its own code. */
const closeRefused = (close: Socket.CloseEvent, frame: string | Uint8Array, allowed: number) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const writer = yield* near.writer;

    const refused = yield* Effect.exit(writer.write(close));
    yield* writer.write(frame);
    yield* writer.write(new Socket.CloseEvent(allowed));

    return { refused, read: yield* drained(far) };
  }).pipe(Effect.scoped);

/** The far end closes with 1000: the near end's frames written before are read at the far end, its later writes are dropped. */
const closedByFar = (
  before: ReadonlyArray<string | Uint8Array>,
  frames: ReadonlyArray<string | Uint8Array>,
  more: string | Uint8Array,
) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const nearWriter = yield* near.writer;
    const farWriter = yield* far.writer;

    for (const frame of before) {
      yield* nearWriter.write(frame);
    }

    for (const frame of frames) {
      yield* farWriter.write(frame);
    }

    yield* farWriter.write(new Socket.CloseEvent(1000));

    const written = yield* Effect.exit(nearWriter.write(more));
    const writtenAll = yield* Effect.exit(nearWriter.writeAll([more]));

    return { written, writtenAll, readByNear: yield* drained(near), readByFar: yield* drained(far) };
  }).pipe(Effect.scoped);

// M1. Plant: let a write after close succeed and drop the frame; leave a waiting pull blocked when its scope closes; give the far end
// code 1006 for a closed scope; hand an end's own writes to its own reader; drop the frames waiting when the close came.
it.effect.prop(
  "M1 the memory pair keeps Effect's reader contract: a closed reader scope fails a waiting pull and gives the far end close 1000 after its waiting frames, a CloseEvent gives its code and reason, a write to an end that closed itself fails, and a write to an end whose far end closed with 1000 is dropped and fails nothing",
  {
    frames: Arbitrary.array(chunk, { maxLength: 20 }),
    more: chunk,
    extra: between(0, 1999),
    reason: word,
    which: pick([0, 1, 2, 3, 4]),
  },
  ({ frames, more, extra, reason, which }) =>
    Effect.gen(function* () {
      // A scope closed: no pull is left blocked, and the far end reads the waiting frames, as written, then close 1000.
      const byScope = finished(yield* settled(closedByScope(frames, more)), "a closed scope");

      expect(Exit.isFailure(byScope.ownPull), "a closed scope: the end's own waiting pull fails").toBe(true);
      expect(byScope.refused, "a closed scope: a write to the closed end fails").toBe(true);
      expect(byScope.refusedAll, "a closed scope: so does a writeAll").toBe(true);
      assert.deepStrictEqual(
        byScope.read.frames,
        frames,
        "a closed scope: the far end reads every frame written before",
      );
      expect(exitClose(byScope.read.exit), "a closed scope: then close 1000").toEqual(
        Option.some({ code: 1000, reason: undefined }),
      );

      // The far end closed with 1000: the writes the near end is still given are dropped, no frame it wrote before is lost.
      const byFar = finished(yield* settled(closedByFar(frames, frames, more)), "a far end that closed");

      expect(Exit.isSuccess(byFar.written), "a far end that closed: a write is dropped, and fails nothing").toBe(true);
      expect(Exit.isSuccess(byFar.writtenAll), "a far end that closed: so is a writeAll").toBe(true);
      assert.deepStrictEqual(
        byFar.readByNear.frames,
        frames,
        "a far end that closed: the near end reads what the far end sent",
      );
      expect(exitClose(byFar.readByNear.exit), "a far end that closed: then close 1000").toEqual(
        Option.some({ code: 1000, reason: undefined }),
      );
      assert.deepStrictEqual(
        byFar.readByFar.frames,
        frames,
        "a far end that closed: the far end reads what the near end wrote before, and not the dropped write",
      );

      // A CloseEvent: the other end reads what was waiting, then the code and the reason. The gateway's end writes any code a server
      // sends; the client's end only those a browser lets a client send, which are 1000 and 3000 to 4999.
      const code = [1000, 1001, 1006, 1011, 3000 + extra][which] ?? 1000;
      const ends = code === 1000 || code >= 3000 ? (["client", "gateway"] as const) : (["gateway"] as const);

      for (const [end, reasoned] of ends.flatMap((each) => [[each, false] as const, [each, true] as const])) {
        const name = `a CloseEvent of ${code} from the ${end}${reasoned ? " with a reason" : ""}`;

        const byEvent = finished(
          yield* settled(closedByEvent(frames, more, new Socket.CloseEvent(code, reasoned ? reason : undefined), end)),
          name,
        );

        assert.deepStrictEqual(byEvent.read.frames, frames, `${name}: the far end reads every frame written before`);
        expect(exitClose(byEvent.read.exit), `${name}: then its code and reason`).toEqual(
          Option.some({ code, reason: reasoned ? reason : undefined }),
        );
        expect(byEvent.refused, `${name}: a write to the closed end fails`).toBe(true);
      }
    }),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// M2. Plant: let a CloseEvent of any code close the pair, the client's end (the first of the pair) only; refuse a code of 3000 to 4999 or 1000; fail with a different error than
// InvalidAccessError; close the pair when the refused write comes.
it.effect.prop(
  "M2 the memory pair refuses the close codes a browser refuses, as `WebSocket.close` does: a CloseEvent of any code but 1000 and 3000 to 4999 fails the write with a SocketWriteError holding an InvalidAccessError and closes nothing, so the later frames and a close that is allowed come through",
  {
    low: between(0, 999),
    middle: between(1001, 2999),
    high: between(5000, 65_535),
    which: pick([0, 1, 2, 3, 4, 5, 6, 7]),
    allowed: between(3000, 4999),
    reason: word,
    reasoned: Arbitrary.schema(Schema.Boolean),
    frame: chunk,
  },
  ({ low, middle, high, which, allowed, reason, reasoned, frame }) =>
    Effect.gen(function* () {
      // The codes a browser refuses, as RFC 6455 names them: the ones a client may not send, which are all but 1000 and 3000 to 4999.
      const code = [low, middle, high, 1001, 1002, 1006, 1011, 1015][which] ?? 1002;

      const run = finished(
        yield* settled(closeRefused(new Socket.CloseEvent(code, reasoned ? reason : undefined), frame, allowed)),
        `a close of ${code}`,
      );

      const failure = failureFrom(run.refused).error;

      expect(
        Option.exists(failure, (error) => Predicate.isTagged(error.reason, "SocketWriteError")),
        `${code}: the write fails with a SocketWriteError`,
      ).toBe(true);
      expect(
        Option.exists(
          failure,
          ({ reason: write }) =>
            Predicate.isTagged(write, "SocketWriteError") &&
            Predicate.hasProperty(write.cause, "name") &&
            write.cause.name === "InvalidAccessError",
        ),
        `${code}: the cause is an InvalidAccessError`,
      ).toBe(true);
      assert.deepStrictEqual(run.read.frames, [frame], `${code}: the frame written after it comes through`);
      expect(exitClose(run.read.exit), `${code}: and the close that is allowed closes with its own code`).toEqual(
        Option.some({ code: allowed, reason: undefined }),
      );
    }),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// M3. Plant: check the code on both ends of the pair, as the first version of M2 did; check it on the gateway's end only.
it.effect.prop(
  "M3 the gateway's end of the memory pair sends any code a server sends: a CloseEvent of 1001, 1006, 1011 or any other code written by the second end reaches the client with its code and its reason, after the frames written before",
  {
    low: between(0, 999),
    middle: between(1001, 2999),
    high: between(5000, 65_535),
    which: pick([0, 1, 2, 3, 4, 5]),
    reason: word,
    reasoned: Arbitrary.schema(Schema.Boolean),
    frames: Arbitrary.array(chunk, { maxLength: 10 }),
    more: chunk,
  },
  ({ low, middle, high, which, reason, reasoned, frames, more }) =>
    Effect.gen(function* () {
      const code = [1001, 1006, 1011, low, middle, high][which] ?? 1011;

      const run = finished(
        yield* settled(
          closedByEvent(frames, more, new Socket.CloseEvent(code, reasoned ? reason : undefined), "gateway"),
        ),
        `a close of ${code} from the gateway`,
      );

      assert.deepStrictEqual(run.read.frames, frames, `${code}: the client reads every frame written before`);
      expect(exitClose(run.read.exit), `${code}: then the code and the reason, as sent`).toEqual(
        Option.some({ code, reason: reasoned ? reason : undefined }),
      );
      expect(run.refused, `${code}: a later write to the closed end fails`).toBe(true);
    }),
  { arbitrary: { seed: SEED, runs: 200 } },
);

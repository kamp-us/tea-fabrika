// M1: the memory pair keeps Effect's reader contract, the one every socket Layer keeps: a pull waiting on an end fails when the end's
// reader scope closes, the far end reads every frame written before and then fails with the close, a CloseEvent write closes with its
// code and reason, and a write to a closed end fails and is never dropped in silence.
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
) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;
    const writer = yield* near.writer;

    for (const frame of frames) {
      yield* writer.write(frame);
    }

    yield* writer.write(close);
    const refused = yield* writeRefused(writer.write(more));

    return { refused, read: yield* drained(far) };
  }).pipe(Effect.scoped);

// M1. Plant: let a write after close succeed and drop the frame; leave a waiting pull blocked when its scope closes; give the far end
// code 1006 for a closed scope; hand an end's own writes to its own reader; drop the frames waiting when the close came.
it.effect.prop(
  "M1 the memory pair keeps Effect's reader contract: a closed reader scope fails a waiting pull and gives the far end close 1000 after its waiting frames, a CloseEvent gives its code and reason, and a write to a closed end fails",
  {
    frames: Arbitrary.array(chunk, { maxLength: 20 }),
    more: chunk,
    extra: between(0, 999),
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

      // A CloseEvent: the far end reads what was waiting, then the code and the reason.
      const code = [1000, 1001, 1006, 1011, 4000 + extra][which] ?? 1000;

      for (const reasoned of [false, true]) {
        const name = `a CloseEvent of ${code}${reasoned ? " with a reason" : ""}`;

        const byEvent = finished(
          yield* settled(closedByEvent(frames, more, new Socket.CloseEvent(code, reasoned ? reason : undefined))),
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

import { inspect } from "node:util";
// E2, the two failures a store side has: a store that cannot answer (`StoreFailed`) and a recorder that cannot write (`RecordFailed`). Each is a
// tagged error that keeps its cause, hidden in a `Redacted` that gives it back on purpose, and is caught by its tag.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Formatter, Redacted, Schema } from "effect";
import * as Errors from "./Errors.ts";
import { marker, pick, reachable, SEED } from "./Secrets.test-support.ts";

/** A failure of either kind, typed as the union, so a handler may name either tag. */
const failing = (error: Errors.StoreFailed | Errors.RecordFailed) => Effect.fail(error);

const causes = Arbitrary.all({ word: marker, form: pick(["error", "text", "record"]) });

// E2. Plant: drop the cause from `StoreFailed` (a `mapError` that writes `new StoreFailed({ cause: Redacted.make(undefined) })`); keep the cause in a plain property that is no `Redacted`; give both errors one tag; leave `RecordFailed` out of
// the `Error` family; catch `StoreFailed` with `catchTag("RecordFailed")`.
it.effect.prop(
  "E2 errors: StoreFailed and RecordFailed are errors with their own tags, keep their cause hidden, as the one they were made with, and are caught by their tag and by no other",
  { drawn: causes },
  ({ drawn }) =>
    Effect.gen(function* () {
      const cause = { error: new Error(drawn.word), text: drawn.word, record: { reason: drawn.word } }[drawn.form];

      const store = new Errors.StoreFailed({ cause: Redacted.make(cause) });
      const record = new Errors.RecordFailed({ cause: Redacted.make(cause) });

      expect(store._tag).toBe("StoreFailed");
      expect(record._tag).toBe("RecordFailed");
      expect(store instanceof Error, "an error").toBe(true);
      expect(Schema.is(Errors.StoreFailed)(record), "one is not the other").toBe(false);

      const caught = yield* Effect.fail(store).pipe(
        Effect.catchTag("StoreFailed", (error) => Effect.succeed(error.cause)),
      );

      // The cause is kept hidden, and read on purpose it is the one the error was made with.
      expect(
        [store.cause, record.cause, caught].map((held) => Redacted.isRedacted(held) && Redacted.value(held) === cause),
        "the store's cause, the recorder's, and the one caught by its tag",
      ).toEqual([true, true, true]);

      const passed = yield* failing(record).pipe(
        Effect.catchTag("StoreFailed", () => Effect.succeed("wrong")),
        Effect.exit,
      );

      expect(Exit.isFailure(passed), "the other tag is not caught").toBe(true);
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

// E3. Plant: write the cause's text into the message of `StoreFailed`; the same for `RecordFailed`; keep the cause in a plain property, so its own message
// prints under `[cause]` (a store's client error can quote a value it read); give the error a `toJSON` that returns the cause's text.
it.effect.prop(
  "E3 errors: StoreFailed and RecordFailed hold no text of a cause that quotes a value, in their message, their text, their JSON, their properties or the rendered cause",
  { drawn: causes },
  ({ drawn }) =>
    Effect.sync(() => {
      const cause = {
        error: new Error(`bad value ${drawn.word}`, {
          cause: new Error(`nested ${drawn.word}`, { cause: drawn.word }),
        }),
        text: drawn.word,
        record: { reason: drawn.word, nested: { reason: drawn.word } },
      }[drawn.form];

      for (const error of [
        new Errors.StoreFailed({ cause: Redacted.make(cause) }),
        new Errors.RecordFailed({ cause: Redacted.make(cause) }),
      ]) {
        const texts = [
          error.message,
          error.stack ?? "",
          String(error),
          JSON.stringify(error),
          Formatter.format(error),
          inspect(error, { depth: 10, showHidden: true }),
          Cause.pretty(Cause.fail(error)),
          Cause.pretty(Cause.die(error)),
          ...reachable(error),
        ];

        expect(
          texts.filter((each) => each.includes(drawn.word)),
          `${error._tag} over a ${drawn.form}`,
        ).toEqual([]);
      }
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

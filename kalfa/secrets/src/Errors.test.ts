// E2, the two failures a store side has: a store that cannot answer (`StoreFailed`) and a recorder that cannot write (`RecordFailed`). Each is a
// tagged error that keeps the cause it was made with and is caught by its tag.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Schema } from "effect";
import * as Errors from "./Errors.ts";
import { marker, pick, SEED } from "./Secrets.test-support.ts";

/** A failure of either kind, typed as the union, so a handler may name either tag. */
const failing = (error: Errors.StoreFailed | Errors.RecordFailed) => Effect.fail(error);

const causes = Arbitrary.all({ word: marker, form: pick(["error", "text", "record"]) });

// E2. Plant: drop the cause from `StoreFailed` (a `mapError` that writes `new StoreFailed({})`); give both errors one tag; leave `RecordFailed` out of
// the `Error` family; catch `StoreFailed` with `catchTag("RecordFailed")`.
it.effect.prop(
  "E2 errors: StoreFailed and RecordFailed are errors with their own tags, keep the cause they were made with, and are caught by their tag and by no other",
  { drawn: causes },
  ({ drawn }) =>
    Effect.gen(function* () {
      const cause = { error: new Error(drawn.word), text: drawn.word, record: { reason: drawn.word } }[drawn.form];

      const store = new Errors.StoreFailed({ cause });
      const record = new Errors.RecordFailed({ cause });

      expect(store._tag).toBe("StoreFailed");
      expect(record._tag).toBe("RecordFailed");
      expect(store.cause, "the store's cause").toBe(cause);
      expect(record.cause, "the recorder's cause").toBe(cause);
      expect(store instanceof Error, "an error").toBe(true);
      expect(Schema.is(Errors.StoreFailed)(record), "one is not the other").toBe(false);

      const caught = yield* Effect.fail(store).pipe(
        Effect.catchTag("StoreFailed", (error) => Effect.succeed(error.cause)),
      );

      expect(caught, "caught by its tag, with its cause").toBe(cause);

      const passed = yield* failing(record).pipe(
        Effect.catchTag("StoreFailed", () => Effect.succeed("wrong")),
        Effect.exit,
      );

      expect(Exit.isFailure(passed), "the other tag is not caught").toBe(true);
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

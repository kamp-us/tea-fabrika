// V1, the numbers a stream counts with: a revision and a position are whole numbers from 0 up, and a conflict between two revisions holds only such numbers.
// It runs in memory on every pull request.
import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";
import * as Entry from "./Entry.ts";
import * as Errors from "./Errors.ts";
import { COUNT_CLASSES, counts, numberTexture, SEED } from "./Ledger.test-support.ts";

// V1. Plant: let `Revision` or `Position` take -1 (the "minus one" and "below 0" classes pass); take only whole numbers up to 100 (the large classes fail);
// take fractions (`Schema.Number` with the minimum); take `NaN` or infinity; drop the minimum from `RevisionConflict`'s fields (a conflict made from -1 is
// kept); type a conflict's `actual` as any whole number.
it.effect.prop(
  "V1 counts: a revision and a position are exactly the whole numbers from 0 up, and a conflict between two revisions refuses anything else",
  { texture: numberTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const drawn = counts(texture);

      expect(
        drawn.map((each) => each.id),
        "the generator reaches every number class",
      ).toEqual(COUNT_CLASSES);

      for (const { id, candidate, counts: isCount } of drawn) {
        expect(
          Option.isSome(Schema.decodeUnknownOption(Entry.Revision)(candidate)),
          `${id}: is a revision exactly when it is a count`,
        ).toBe(isCount);
        expect(
          Option.isSome(Schema.decodeUnknownOption(Entry.Position)(candidate)),
          `${id}: is a position exactly when it is a count`,
        ).toBe(isCount);

        // An untyped call, the way a decoded wire reaches the class: both revisions of a conflict must be counts.
        for (const [named, fields] of [
          ["expected", { expected: candidate, actual: 0 }],
          ["actual", { expected: 0, actual: candidate }],
        ] as const) {
          const made = Result.try(() => Reflect.construct(Errors.RevisionConflict, [fields]));

          expect(
            Result.isSuccess(made),
            `${id}: a conflict with it as ${named} is made exactly when it is a count`,
          ).toBe(isCount);
        }
      }
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

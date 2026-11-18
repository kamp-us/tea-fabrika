// T695, next/. The ID generator keeps the failure behind an `entropy` IdError (decision 0043 rule
// 12). Audit site: the generator's draw from SecureRandom, where a throw from the random source is
// a defect the generator translates. Decoding an ID the generator built from its own registered
// prefix is the other site, and no generated input can make it fail.
// T1067: the random source is a SecureRandom the law builds (`generatorWith`), never a spy (0555).
import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { bytes, generatorWith, generatorWithEffect, throws } from "./Id.test-support.ts";
import * as Id from "./Id.ts";

const Failure = Schema.TaggedUnion({
  error: { message: Schema.String },
  dom: { message: Schema.String },
  object: { code: Schema.String, detail: Schema.Json },
});

const failures = Arbitrary.schema(Failure).pipe(
  Arbitrary.map(
    Failure.match({
      error: ({ message }) => new Error(message),
      dom: ({ message }) => new DOMException(message, "QuotaExceededError"),
      object: ({ code, detail }) => ({ code, detail }),
    }),
  ),
);

const prefixes = Arbitrary.schema(Schema.Literals(["process", "input", "letter", "chaos"]));

describe("T695, Id.Generator keeps why it could not draw an ID", () => {
  // C1 (T1067 T2). Plant: drop the generator's `catchDefect` on its draw, so a throw from the random
  // source dies; earlier, `catch: (error) => error instanceof IdError ? error : new IdError({ reason: "entropy" })`.
  it.effect.prop(
    "C1: a generated throw from the random source is `entropy` with the thrown value as its cause",
    {
      failure: failures,
      prefix: prefixes,
      before: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
    },
    ({ failure, prefix, before }) => {
      // The source gives zero bytes for the good IDs, then throws `failure` once it is failing.
      let failing = false;
      const fill = (size: number): Uint8Array => (failing ? throws(failure)() : bytes(0)(size));

      return Effect.gen(function* () {
        const schema = Id.make(prefix);
        const ids = yield* Id.Generator;

        // A few good IDs first, so the failure meets a generator already in use.
        for (let n = 0; n < before; n++) {
          yield* ids.next(schema);
        }

        // A new millisecond on the test clock, so the next ID draws fresh random bits.
        yield* TestClock.adjust(Duration.millis(1));

        const error = yield* Effect.flip(
          Effect.acquireUseRelease(
            Effect.sync(() => {
              failing = true;
            }),
            () => ids.next(schema),
            () =>
              Effect.sync(() => {
                failing = false;
              }),
          ),
        );

        expect(error).toBeInstanceOf(Id.IdError);
        expect(error.reason).toBe("entropy");
        expect(error.cause).toBe(failure);

        // A second fiber at the same fresh time must wait for the first draw. Its source yields,
        // then throws if the generator consumes entropy for a turn that should count up.
        let draws = 0;

        const concurrent = Effect.gen(function* () {
          const generator = yield* Id.Generator;

          const generated = yield* Effect.forEach([0, 1], () => generator.next(Id.Input), {
            concurrency: 2,
          });

          expect(draws).toBe(1);
          expect(new Set(generated).size).toBe(2);
        }).pipe(
          Effect.provide(
            generatorWithEffect((size) =>
              Effect.flatMap(Effect.yieldNow, () =>
                Effect.suspend(() => {
                  draws += 1;

                  return draws === 1 ? Effect.succeed(bytes(0)(size)) : Effect.die(new Error("unused entropy draw"));
                }),
              ),
            ),
          ),
        );

        yield* concurrent;
      }).pipe(Effect.provide(Layer.merge(generatorWith(fill), TestClock.layer())));
    },
    { arbitrary: { runs: 100 } },
  );
});

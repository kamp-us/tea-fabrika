// T695, next/. The ID generator keeps the failure behind an `entropy` IdError (decision 0043 rule
// 12). Audit site: the generator's draw from SecureRandom, where a throw from the random source is
// a defect the generator translates. Decoding an ID the generator built from its own registered
// prefix is the other site, and no generated input can make it fail.
// T1067: the random source is a SecureRandom the law builds (`generatorWith`), never a spy (0555).
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { bytes, generatorWith, throws } from "./Id.test-support.ts";
import * as Id from "./Id.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new DOMException(message, "QuotaExceededError")),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

const prefixes = fc.constantFrom("process", "input", "letter", "chaos");

describe("T695, Id.Generator keeps why it could not draw an ID", () => {
  // C1 (T1067 T2). Plant: drop the generator's `catchDefect` on its draw, so a throw from the random
  // source dies; earlier, `catch: (error) => error instanceof IdError ? error : new IdError({ reason: "entropy" })`.
  it("C1: a generated throw from the random source is `entropy` with the thrown value as its cause", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ failure: failures, prefix: prefixes, before: fc.nat({ max: 3 }) }),
        ({ failure, prefix, before }) => {
          // The source gives zero bytes for the good IDs, then throws `failure` once it is failing.
          let failing = false;
          const fill = (size: number): Uint8Array => (failing ? throws(failure)() : bytes(0)(size));
          return Effect.runPromise(
            Effect.gen(function* () {
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
            }).pipe(Effect.provide(Layer.merge(generatorWith(fill), TestClock.layer()))),
          );
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });
});

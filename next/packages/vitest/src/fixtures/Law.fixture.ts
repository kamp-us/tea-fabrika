// Laws for ../Law.integration.test.ts to run in a vitest of its own, so it can see one fail, time out
// or run twice. The case comes from that run's `provide`, as vitest's `inject` reads it. Nothing
// here runs in the repo's own test run: its name is no test file's.
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { expect, inject } from "vitest";
import { it } from "../Law.ts";
import type { LawCase } from "./LawCase.ts";

declare module "vitest" {
  interface ProvidedContext {
    lawCase: LawCase;
  }
}

const lawCase = inject("lawCase");
const Upto = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

if (lawCase._tag === "threshold") {
  // One law per threshold, failing on any value above it; and one whose threshold no value passes.
  for (const [at, above] of [...lawCase.above, 1000].entries()) {
    it.effect.prop(
      `threshold ${at}`,
      { n: fc.integer({ min: 0, max: 1000 }) },
      ({ n }) => Effect.sync(() => expect(n).toBeLessThanOrEqual(above)),
      { fastCheck: { numRuns: 100 } },
    );
  }
}

if (lawCase._tag === "seed") {
  // The same failing law on each engine, once per lowest failing value.
  for (const [at, lowest] of lawCase.lowest.entries()) {
    it.effect.prop(
      `fast-check ${at}`,
      { n: fc.integer({ min: 0, max: 1000 }) },
      ({ n }) => Effect.sync(() => expect(n).toBeLessThan(lowest)),
      {
        fastCheck: { numRuns: 100 },
      },
    );
    it.effect.prop(`effect ${at}`, { n: Upto }, ({ n }) => Effect.sync(() => expect(n).toBeLessThan(lowest)), {
      arbitrary: { runs: 100 },
    });
  }
}

if (lawCase._tag === "timeout") {
  const tally = { opened: 0, late: 0 };
  // Each case waits for real, so the law runs past its timeout; a case or shrink that starts once
  // the law's signal has aborted is late.
  it.live.prop(
    "times out",
    { n: fc.integer() },
    (_, ctx) =>
      Effect.gen(function* () {
        tally.late += ctx.signal.aborted ? 1 : 0;
        tally.opened += 1;
        yield* Effect.sleep("40 millis");
      }),
    { timeout: lawCase.timeout, fastCheck: { numRuns: 1000 } },
  );
  // Registered after it, so it runs once the law above has ended: it waits, then reads the tally.
  it.live(
    "then nothing more opens",
    () =>
      Effect.gen(function* () {
        yield* Effect.sleep("600 millis");

        if (tally.opened === 0 || tally.late > 0) {
          return yield* Effect.die(new Error(`opened ${tally.opened}, late ${tally.late}`));
        }
      }),
    { timeout: 5000 },
  );
}

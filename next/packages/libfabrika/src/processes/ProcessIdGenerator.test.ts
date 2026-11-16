// Next/, P10/P33 shared process generator contract, retained by T518 PR 1.
// ProcessIdGenerator.layer owns one writer's state; next remains an Effect<ProcessId>.
import { describe, expect, it, vi } from "@effect/vitest";
// The id format, clocks, rollback and exhaustion are Id.Generator's own laws, in Id.test.ts.
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import { processClocks } from "../Id.test-support.ts";
import { ProcessIdGenerator } from "./ProcessIdGenerator.ts";

const maxClock = 2 ** 48 - 1;
const Time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxClock - 10_000 }));
const Count = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 512 }));
const Calls = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 }));
const Many = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 1024 }));

const BeforeEpoch = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

const options = { arbitrary: { seed: 119120, runs: 40 } };

describe("P10 shared process ids", () => {
  it.effect.prop(
    "next records process.next with an inner id.next span on generated clocks",
    { at: processClocks },
    ({ at }) => {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      return Effect.gen(function* () {
        yield* TestClock.setTime(at);
        const generator = yield* ProcessIdGenerator;
        yield* generator.next;
        const process = spans.filter((span) => span.name === "process.next");
        const id = spans.filter((span) => span.name === "id.next");
        expect(process).toHaveLength(1);
        expect(id).toHaveLength(1);
        expect(process[0]!.status._tag).toBe("Ended");
        expect(id[0]!.status._tag).toBe("Ended");
        expect(id[0]!.parent).toEqual(Option.some(process[0]!));
      }).pipe(Effect.provide(ProcessIdGenerator.layer), Effect.withTracer(tracer));
    },
    options,
  );
  // T287 mutation: renaming process.next to an empty string lost the operation in traces.
  it.effect.prop(
    "every generated process id ends its own process.next span",
    { at: Time, count: Calls },
    ({ at, count }) => {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (settings) => {
          const span = new Tracer.NativeSpan(settings);
          spans.push(span);
          return span;
        },
      });
      return Effect.gen(function* () {
        yield* TestClock.setTime(at);
        const generator = yield* ProcessIdGenerator;

        for (let i = 0; i < count; i++) {
          yield* generator.next;
        }

        const operations = spans.filter((span) => span.name === "process.next");
        expect(operations).toHaveLength(count);
        expect(new Set(operations.map((span) => span.spanId)).size).toBe(count);

        for (const span of operations) {
          expect(span.status._tag).toBe("Ended");
        }
      }).pipe(Effect.provide(ProcessIdGenerator.layer), Effect.withTracer(tracer));
    },
    options,
  );
  it.effect.prop(
    "shape: a clock before the UUID epoch cannot produce a process id",
    { distance: BeforeEpoch },
    ({ distance }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(-distance);
        const gen = yield* ProcessIdGenerator;
        const exit = yield* Effect.exit(gen.next);
        expect(Exit.isFailure(exit)).toBe(true);

        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.length).toBeGreaterThan(0);

          for (const reason of exit.cause.reasons) {
            expect(Cause.isDieReason(reason)).toBe(true);

            if (Cause.isDieReason(reason)) {
              expect(reason.defect).toMatchObject({ _tag: "IdError", reason: "clock" });
            }
          }
        }
      }).pipe(Effect.provide(ProcessIdGenerator.layer)),
    options,
  );
  it.effect.prop(
    "monotonic: same-millisecond calls never repeat or sort backward",
    { at: Time, count: Many },
    ({ at, count }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(at);
        const gen = yield* ProcessIdGenerator;
        const ids = yield* Effect.forEach(Array.from({ length: count }), () => gen.next, {
          concurrency: 1,
        });
        expect(new Set(ids).size).toBe(ids.length);

        for (let i = 1; i < ids.length; i++) {
          expect(ids[i]! > ids[i - 1]!).toBe(true);
        }
      }).pipe(Effect.provide(ProcessIdGenerator.layer)),
    options,
  );

  for (const exitReason of ["clock", "entropy", "exhausted"] as const) {
    it.effect.prop(
      `next dies on IdError ${exitReason} and keeps process.next around id.next`,
      { at: Time, distance: Count, marker: Schema.String },
      ({ at, distance, marker }) => {
        const spans: Array<Tracer.NativeSpan> = [];
        const tracer = Tracer.make({
          span: (settings) => {
            const span = new Tracer.NativeSpan(settings);
            spans.push(span);
            return span;
          },
        });
        const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
          if (exitReason === "entropy") {
            throw new Error(marker);
          }

          if (array instanceof Uint8Array) {
            array.fill(255);
          }

          return array;
        });
        return Effect.gen(function* () {
          try {
            yield* TestClock.setTime(exitReason === "clock" ? -distance : exitReason === "exhausted" ? maxClock : at);
            const generator = yield* ProcessIdGenerator;

            if (exitReason === "exhausted") {
              yield* generator.next;
            }

            const exit = yield* Effect.exit(generator.next);
            expect(Exit.isFailure(exit)).toBe(true);

            if (Exit.isFailure(exit)) {
              expect(exit.cause.reasons).toHaveLength(1);
              const reason = exit.cause.reasons[0]!;
              expect(Cause.isDieReason(reason)).toBe(true);

              if (Cause.isDieReason(reason)) {
                expect(reason.defect).toMatchObject({ _tag: "IdError", reason: exitReason });
              }
            }

            const process = spans.filter((span) => span.name === "process.next").at(-1)!;
            const id = spans.filter((span) => span.name === "id.next").at(-1)!;
            expect(id.parent).toEqual(Option.some(process));

            for (const span of [process, id]) {
              expect(span.status._tag).toBe("Ended");

              if (span.status._tag === "Ended") {
                expect(Exit.isFailure(span.status.exit)).toBe(true);
              }
            }
          } finally {
            random.mockRestore();
          }
        }).pipe(Effect.provide(ProcessIdGenerator.layer), Effect.withTracer(tracer));
      },
      options,
    );
  }
});

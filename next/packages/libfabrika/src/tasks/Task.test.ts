// P39 slice 1, L1 and L8 on the task's own schemas. L1: every fact a request, an executor, a result
// and a writer's record carry comes back from its JSON form, field for field. L8: one field made
// invalid, or left out, is refused at decoding. The values are generated; the database half of both
// laws is in `TasksTest.ts`.
//
// P39 slice 3 (ticket 1040): the `collected` state and event keep every field through JSON too,
// with the collection (which process took the result, and its answer letter) whole.
import { describe, expect, it } from "@effect/vitest";
import { Result as R, Schema } from "effect";
import * as fc from "fast-check";
import { Collection, Event, Executor, Recorded, Request, Result, State } from "./Task.ts";
import {
  BAD_EXECUTOR,
  BAD_RECORDED,
  BAD_REQUEST,
  broken,
  brokenResult,
  fcExecutor,
  fcFingerprint,
  fcRecorded,
  fcRequest,
  fcResult,
  fcTypeId,
} from "./TasksTest.ts";

const RUNS = { seed: 119120, numRuns: 100 };

/** Encode, write as JSON text, read it back and decode, as a value crosses a store or a wire. */
const through = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: S["Type"]) =>
  Schema.decodeUnknownResult(schema)(JSON.parse(JSON.stringify(Schema.encodeSync(schema)(value))));

const Values = fc.uniqueArray(fcFingerprint, { minLength: 2, maxLength: 3 }).chain((keys) =>
  fc.record({
    request: fcRequest(keys),
    executor: fcExecutor(keys),
    result: fcResult,
    recorded: fcRecorded.chain((said) => fc.nat().map((seen) => ({ ...said, seen }))),
    pick: fc.nat(),
    execution: fc.stringMatching(/^[a-z0-9]{1,12}$/),
    letter: fc.stringMatching(/^[a-z0-9/]{1,24}$/).filter((text) => text.length > 0),
    collector: fcTypeId("process"),
    rev: fc.integer({ min: 1, max: 1_000_000 }),
    arrivedAt: fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }),
  }),
);

describe("P39 slice 1: the task's schemas", () => {
  it("L1: a request, an executor, a result and a writer's record keep every field through JSON", () => {
    fc.assert(
      fc.property(Values, ({ request, executor, result, recorded }) => {
        for (const [schema, value] of [
          [Request, request],
          [Executor, executor],
          [Result, result],
          [Recorded, recorded],
        ] as const) {
          const back = through(schema as Schema.Codec<unknown, unknown>, value);
          expect(R.isSuccess(back), `decodes: ${JSON.stringify(value)}`).toBe(true);
          // Every key the caller gave comes back with its value: none dropped, none renamed.
          expect(R.getOrThrow(back)).toEqual(value);
          expect(Object.keys(R.getOrThrow(back) as object).sort()).toEqual(Object.keys(value).sort());
        }
      }),
      RUNS,
    );
  });

  it("J2: a collected state and a collected event keep every field through JSON, and a bad collection is refused", () => {
    fc.assert(
      fc.property(Values, ({ request, executor, result, recorded, execution, letter, collector, rev, arrivedAt }) => {
        const collection = { process: request.process, letter };
        const collected = State.cases.collected.make({
          request,
          assignment: { execution, executor },
          result,
          collection,
        });
        const event = { ...recorded, event: "collected" as const, rev, arrivedAt };

        for (const [schema, value] of [
          [Collection, collection],
          [State, collected],
          [Event, event],
        ] as const) {
          const back = through(schema as Schema.Codec<unknown, unknown>, value);
          expect(R.isSuccess(back), `decodes: ${JSON.stringify(value)}`).toBe(true);
          expect(R.getOrThrow(back)).toEqual(value);
        }

        // A collection names one process generation and one letter: neither may be missing or empty.
        for (const bad of [
          { process: collection.process },
          { letter },
          { process: "", letter },
          { process: "not-a-process", letter },
          { process: collector, letter: "" },
        ]) {
          expect(R.isFailure(Schema.decodeUnknownResult(Collection)(bad)), `refused: ${JSON.stringify(bad)}`).toBe(
            true,
          );
        }
      }),
      RUNS,
    );
  });

  it("L8: one invalid or missing field of a request, an executor, a result or a record is refused", () => {
    fc.assert(
      fc.property(Values, ({ request, executor, result, recorded, pick }) => {
        const cases: ReadonlyArray<readonly [Schema.Codec<unknown, unknown>, unknown]> = [
          [Request as Schema.Codec<unknown, unknown>, broken(request, pick, BAD_REQUEST)],
          [Executor as Schema.Codec<unknown, unknown>, broken(executor, pick, BAD_EXECUTOR)],
          [Result as Schema.Codec<unknown, unknown>, brokenResult(result, pick)],
          [Recorded as Schema.Codec<unknown, unknown>, broken(recorded, pick, BAD_RECORDED)],
        ];

        for (const [schema, bad] of cases) {
          expect(R.isFailure(Schema.decodeUnknownResult(schema)(bad)), `refused: ${JSON.stringify(bad)}`).toBe(true);
        }
      }),
      RUNS,
    );
  });
});

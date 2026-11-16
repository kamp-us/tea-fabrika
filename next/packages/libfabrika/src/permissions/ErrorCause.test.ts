// T1062 slice 1, next/: L4 of docs/plan/quests/error-cause-PLAN.md (decision 0568). The session's
// sender check makes `SendersError` with no failure below it (`access/SessionSenders.ts:22`, a key
// that no longer belongs), so its cause may be missing: `Schema.optional(Schema.Defect())`, never
// `Schema.optionalKey`. A cause written as `undefined` decodes, and every value the old
// `optionalKey` schema read decodes to the same value.
// Plant: put `Schema.optionalKey(Schema.Defect())` back on `Senders.ts:43`; the written-undefined
// case fails to decode.
import { describe, expect, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import * as fc from "fast-check";
import { SendersError } from "./Senders.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 50;

/** How a cause reaches the decoder: no key, a key written as `undefined`, or a JSON value. */
type Form = "absent" | "undefined" | "json";
const FORMS: ReadonlyArray<Form> = ["absent", "undefined", "json"];

/** The schema `SendersError` had before 0568. */
const before = Schema.Struct({ ...SendersError.fields, cause: Schema.optionalKey(Schema.Defect()) });

/** One encoded `SendersError`, its reason from its own literals and its cause in a drawn form. */
const encoded = fc
  .record({
    reason: fc.constantFrom(...SendersError.fields.reason.literals),
    form: fc.constantFrom(...FORMS),
    json: fc.jsonValue(),
  })
  .map(({ reason, form, json }) => ({
    form,
    value: {
      _tag: "SendersError",
      reason,
      ...(form === "absent" ? {} : { cause: form === "undefined" ? undefined : json }),
    },
  }));

/**
 * A decoded value's own fields, the stack aside, so an error and a plain struct compare field by
 * field: an Error keeps `message` as an own key that does not enumerate.
 */
const own = (value: object) =>
  Object.fromEntries(
    Object.getOwnPropertyNames(value)
      .filter((key) => key !== "stack")
      .map((key) => [key, Object.getOwnPropertyDescriptor(value, key)?.value]),
  );

describe("T1062 L4, a sender error whose cause may be missing reads a cause written as undefined", () => {
  it("L4: SendersError decodes a written-undefined cause, and every value the optionalKey schema read to the same value", () => {
    const seen = new Map<Form, number>();
    fc.assert(
      fc.property(encoded, ({ form, value }) => {
        seen.set(form, (seen.get(form) ?? 0) + 1);
        const now = Schema.decodeUnknownExit(SendersError)(value);
        const old = Schema.decodeUnknownExit(before)(value);

        expect(Exit.isSuccess(now), `SendersError decodes a cause that is ${form}`).toBe(true);

        if (Exit.isSuccess(now) && form === "undefined") {
          expect(now.value.cause).toBeUndefined();
        }

        if (Exit.isSuccess(now) && Exit.isSuccess(old)) {
          expect(now.value).toBeInstanceOf(SendersError);
          expect(own(now.value)).toEqual(own(old.value));
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );

    for (const form of FORMS) {
      expect(seen.get(form) ?? 0, `runs reached a cause ${form}`).toBeGreaterThan(0);
    }
  });
});

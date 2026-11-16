// T1062 slice 1, next/: L4 of docs/plan/quests/error-cause-PLAN.md (decision 0568). The session's
// sender check makes `SendersError` with no failure below it (`access/SessionSenders.ts:22`, a key
// that no longer belongs), so its cause may be missing: `Schema.optional(Schema.Defect())`, never
// `Schema.optionalKey`, and never `Schema.Unknown`. A cause written as `undefined` decodes, an
// encoded Error decodes to an Error, and every value the old `optionalKey` schema read decodes to
// the same value.
// Plants: put `Schema.optionalKey(Schema.Defect())` back on `Senders.ts:43`, and the
// written-undefined case fails to decode; set it to `Schema.optional(Schema.Unknown)`, and the
// encoded Error stays a plain object.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Exit, Match, Schema } from "effect";
import * as fc from "fast-check";
import { SendersError } from "./Senders.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

/**
 * How a cause reaches the decoder: no key, a key written as `undefined`, a JSON value, or an Error
 * in the encoded form `Schema.Defect()` writes, the one case where `Defect` and `Unknown` differ.
 */
type Form = "absent" | "undefined" | "json" | "error";

const FORMS: ReadonlyArray<Form> = ["absent", "undefined", "json", "error"];

/** The schema `SendersError` had before 0568. */
const before = Schema.Struct({ ...SendersError.fields, cause: Schema.optionalKey(Schema.Defect()) });

/** An Error with a drawn name and message, encoded the way `Schema.Defect()` writes it. */
const encodedError = fc
  .record({ name: fc.string(), message: fc.string() })
  .map(({ name, message }) => Schema.encodeUnknownSync(Schema.Defect())(Object.assign(new Error(message), { name })));

/** The cause in each form, or no key at all. */
const causeKey = (
  form: Form,
  json: fc.JsonValue,
  error: Schema.Json,
): { readonly cause?: fc.JsonValue | Schema.Json | undefined } =>
  Match.value(form).pipe(
    Match.when("absent", () => ({})),
    Match.when("undefined", () => ({ cause: undefined })),
    Match.when("json", () => ({ cause: json })),
    Match.when("error", () => ({ cause: error })),
    Match.exhaustive,
  );

/**
 * One encoded `SendersError`: made with its reason drawn from its own literals and no cause, encoded
 * by the old schema, then given its cause in a drawn form.
 */
const encoded = fc
  .record({
    reason: fc.constantFrom(...SendersError.fields.reason.literals),
    form: fc.constantFrom(...FORMS),
    json: fc.jsonValue(),
    error: encodedError,
  })
  .map(({ reason, form, json, error }) => ({
    form,
    value: { ...Schema.encodeUnknownSync(before)(new SendersError({ reason })), ...causeKey(form, json, error) },
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
  it("L4: SendersError decodes a written-undefined cause, an encoded Error to an Error, and every value the optionalKey schema read to the same value", () => {
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

        if (Exit.isSuccess(now) && form === "error") {
          expect(now.value.cause, "an encoded Error decodes to an Error").toBeInstanceOf(Error);
        }

        if (Exit.isSuccess(now) && Exit.isSuccess(old)) {
          expect(now.value).toBeInstanceOf(SendersError);
          expect(own(now.value)).toEqual(own(old.value));
        }
      }),
      { seed: SEED, numRuns: runsFor({ fast: 50, full: 200 }) },
    );

    for (const form of FORMS) {
      expect(seen.get(form) ?? 0, `runs reached a cause ${form}`).toBeGreaterThan(0);
    }
  });
});

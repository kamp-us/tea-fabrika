// T1062 slice 1, next/: L4 of docs/plan/quests/error-cause-PLAN.md (decision 0568). Some sites make
// `SettingsError` (`Files.ts:98`, an `invalid` built from a rule) and `SnapshotError`
// (`Snapshot.ts:157`, a hash that does not match) with no failure below them, so their cause may be
// missing: `Schema.optional(Schema.Defect())`, never `Schema.optionalKey`. A cause written as
// `undefined` decodes, and every value the old `optionalKey` schema read decodes to the same value.
// Plant: put `Schema.optionalKey(Schema.Defect())` back on `Files.ts:29` or `Snapshot.ts:47`; the
// written-undefined case of that error fails to decode.
import { describe, expect, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import * as fc from "fast-check";
import { SettingsError } from "./Files.ts";
import { SnapshotError } from "./Snapshot.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 50;

/** How a cause reaches the decoder: no key, a key written as `undefined`, or a JSON value. */
type Form = "absent" | "undefined" | "json";

/** Each error moved to `optional`, beside the schema it had before 0568. */
const errors = {
  SettingsError: {
    now: SettingsError,
    before: Schema.Struct({ ...SettingsError.fields, cause: Schema.optionalKey(Schema.Defect()) }),
    fields: fc.record({
      reason: fc.constantFrom(...SettingsError.fields.reason.literals),
      message: fc.string(),
    }),
  },
  SnapshotError: {
    now: SnapshotError,
    before: Schema.Struct({ ...SnapshotError.fields, cause: Schema.optionalKey(Schema.Defect()) }),
    fields: fc.record({ message: fc.string() }),
  },
} as const;

type Name = keyof typeof errors;
const NAMES: ReadonlyArray<Name> = ["SettingsError", "SnapshotError"];
const FORMS: ReadonlyArray<Form> = ["absent", "undefined", "json"];

/** One encoded value of a drawn error, its cause in a drawn form. */
const encoded = fc
  .record({
    name: fc.constantFrom(...NAMES),
    form: fc.constantFrom(...FORMS),
    json: fc.jsonValue(),
  })
  .chain(({ name, form, json }) =>
    errors[name].fields.map((fields) => ({
      name,
      form,
      value: {
        _tag: name,
        ...fields,
        ...(form === "absent" ? {} : { cause: form === "undefined" ? undefined : json }),
      },
    })),
  );

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

describe("T1062 L4, a settings error whose cause may be missing reads a cause written as undefined", () => {
  it("L4: SettingsError and SnapshotError decode a written-undefined cause, and every value the optionalKey schema read to the same value", () => {
    const seen = new Map<string, number>();
    fc.assert(
      fc.property(encoded, ({ name, form, value }) => {
        seen.set(`${name} ${form}`, (seen.get(`${name} ${form}`) ?? 0) + 1);
        const now = Schema.decodeUnknownExit(errors[name].now)(value);
        const before = Schema.decodeUnknownExit(errors[name].before)(value);

        expect(Exit.isSuccess(now), `${name} decodes a cause that is ${form}`).toBe(true);

        if (Exit.isSuccess(now) && form === "undefined") {
          expect(now.value.cause).toBeUndefined();
        }

        if (Exit.isSuccess(now) && Exit.isSuccess(before)) {
          expect(now.value).toBeInstanceOf(errors[name].now);
          expect(own(now.value)).toEqual(own(before.value));
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );

    for (const name of NAMES) {
      for (const form of FORMS) {
        expect(seen.get(`${name} ${form}`) ?? 0, `runs reached ${name} with a cause ${form}`).toBeGreaterThan(0);
      }
    }
  });
});

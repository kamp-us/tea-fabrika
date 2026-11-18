// T1062 slice 1, next/: L4 of docs/plan/quests/error-cause-PLAN.md (decision 0568). Some sites make
// `SettingsError` (`Files.ts:98`, an `invalid` built from a rule) and `SnapshotError`
// (`Snapshot.ts:157`, a hash that does not match) with no failure below them, so their cause may be
// missing: `Schema.optional(Schema.Defect())`, never `Schema.optionalKey`, and never
// `Schema.Unknown`. A cause written as `undefined` decodes, an encoded Error decodes to an Error,
// and every value the old `optionalKey` schema read decodes to the same value.
// Plants: put `Schema.optionalKey(Schema.Defect())` back on `Files.ts:29` or `Snapshot.ts:47`, and
// the written-undefined case of that error fails to decode; set either line to
// `Schema.optional(Schema.Unknown)`, and that error's encoded Error cause stays a plain object.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Exit, Schema, Match } from "effect";
import * as fc from "fast-check";
import { SettingsError } from "./Files.ts";
import { SnapshotError } from "./Snapshot.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

/**
 * How a cause reaches the decoder: no key, a key written as `undefined`, a JSON value, or an Error
 * in the encoded form `Schema.Defect()` writes, the one case where `Defect` and `Unknown` differ.
 */
type Form = "absent" | "undefined" | "json" | "error";

const FORMS: ReadonlyArray<Form> = ["absent", "undefined", "json", "error"];

const settingsBefore = Schema.Struct({ ...SettingsError.fields, cause: Schema.optionalKey(Schema.Defect()) });

const snapshotBefore = Schema.Struct({ ...SnapshotError.fields, cause: Schema.optionalKey(Schema.Defect()) });

/**
 * Each error moved to `optional`, beside the schema it had before 0568, and its encoded form with no
 * cause: made with drawn fields and encoded by the old schema.
 */
const errors = {
  SettingsError: {
    now: SettingsError,
    before: settingsBefore,
    encoded: fc
      .record({ reason: fc.constantFrom(...SettingsError.fields.reason.literals), message: fc.string() })
      .map((fields) => Schema.encodeUnknownSync(settingsBefore)(new SettingsError(fields))),
  },
  SnapshotError: {
    now: SnapshotError,
    before: snapshotBefore,
    encoded: fc
      .record({ message: fc.string() })
      .map((fields) => Schema.encodeUnknownSync(snapshotBefore)(new SnapshotError(fields))),
  },
} as const;

type Name = keyof typeof errors;

const NAMES: ReadonlyArray<Name> = ["SettingsError", "SnapshotError"];

/** An Error with a drawn name and message, encoded the way `Schema.Defect()` writes it. */
const encodedError = fc
  .record({ name: fc.string(), message: fc.string() })
  .map(({ name, message }) => Schema.encodeUnknownSync(Schema.Defect())(Object.assign(new Error(message), { name })));

/** The cause in each form, or no key at all. */
const causeKey = (form: Form, json: fc.JsonValue, cause: unknown): { cause?: unknown } =>
  form === "absent"
    ? {}
    : {
        cause: Match.value(form).pipe(
          Match.when("undefined", () => undefined),
          Match.when("json", () => json),
          Match.orElse(() => cause),
        ),
      };

/** One encoded value of a drawn error, its cause in a drawn form. */
const encoded = fc
  .record({
    name: fc.constantFrom(...NAMES),
    form: fc.constantFrom(...FORMS),
    json: fc.jsonValue(),
    error: encodedError,
  })
  .chain(({ name, form, json, error }) =>
    errors[name].encoded.map((base) => ({ name, form, value: { ...base, ...causeKey(form, json, error) } })),
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
  it("L4: SettingsError and SnapshotError decode a written-undefined cause, an encoded Error to an Error, and every value the optionalKey schema read to the same value", () => {
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

        if (Exit.isSuccess(now) && form === "error") {
          expect(now.value.cause, `${name} decodes an encoded Error to an Error`).toBeInstanceOf(Error);
        }

        if (Exit.isSuccess(now) && Exit.isSuccess(before)) {
          expect(now.value).toBeInstanceOf(errors[name].now);
          expect(own(now.value)).toEqual(own(before.value));
        }
      }),
      { seed: SEED, numRuns: runsFor({ fast: 50, full: 200 }) },
    );

    for (const name of NAMES) {
      for (const form of FORMS) {
        expect(seen.get(`${name} ${form}`) ?? 0, `runs reached ${name} with a cause ${form}`).toBeGreaterThan(0);
      }
    }
  });
});

// T1062 slice 1, next/: L4 of .kalfa/quests/error-cause-PLAN.md (decision 0568), amended by ticket 1310 (the hidden cause).
// Some sites make `SettingsError` (`Files.ts:98`, an `invalid` built from a rule) and `SnapshotError`
// (`Snapshot.ts:157`, a hash that does not match) with no failure below them, so their cause may be
// missing: `Schema.optional(...)`, never `Schema.optionalKey`, and never `Schema.Unknown`. A cause written as
// `undefined` decodes, and every value the old `optionalKey` schema read decodes to the same value, where
// the cause's schema is unchanged.
// `SettingsError` (`Files.ts`) keeps `Schema.optional(Schema.Defect())`: an encoded Error decodes to an Error.
// `SnapshotError` (`Snapshot.ts`) holds its cause as `Schema.optional(Hidden.Cause)` since ticket 1310: a cause
// may quote a value, so it never crosses whole. Its wire form (`Schema.toCodecJson`) reads the placeholder
// `<redacted>` as an empty hidden cause, and refuses every other value at `cause`, an encoded Error and any
// other JSON included (kalfa/diagnostics/src/Hidden.ts, its law H3), except `null`: JSON has no `undefined`, so
// the codec of an optional field reads `null` as no cause. The old law expected an encoded Error to
// decode to an Error, which is the leak that change removes; that case now expects the refusal, and the
// property keeps every other case: absent, written-undefined, and the field-for-field read of the rest.
// Plants: put `Schema.optionalKey(Schema.Defect())` back on `Files.ts:29`, and the written-undefined case of
// that error fails to decode; set it to `Schema.optional(Schema.Unknown)`, and its encoded Error cause stays a
// plain object. On `Snapshot.ts:47`: put `Schema.optional(Schema.Defect())` back, and the placeholder reads as a text and the encoded Error
// decodes, so the hidden-cause cases are red; put `Schema.optionalKey(Hidden.Cause)`, and the written-undefined case
// fails to decode; read the placeholder to the text itself, and the empty-hidden-cause case is red.
import { describe, expect, it } from "@effect/vitest";
import { SettingsError } from "@kalfa/config/Files";
import { SnapshotError } from "@kalfa/config/Snapshot";
import { runsFor } from "@kampus/vitest";
import { Exit, Redacted, Schema } from "effect";
import * as Match from "effect/Match";
import * as Rec from "effect/Record";
import * as fc from "fast-check";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

/** What a hidden cause is written as, in every codec: the text written out here, so this file stays true if the schema's text changes. */
const PLACEHOLDER = "<redacted>";

/**
 * How a cause reaches the decoder: no key, a key written as `undefined`, the placeholder, a JSON value that is
 * not the placeholder, or an Error in the encoded form `Schema.Defect()` writes, the one case where `Defect`
 * and `Unknown` differ.
 */
type Form = "absent" | "undefined" | "placeholder" | "json" | "error";

const settingsBefore = Schema.Struct({ ...SettingsError.fields, cause: Schema.optionalKey(Schema.Defect()) });

const snapshotBefore = Schema.Struct({ ...SnapshotError.fields, cause: Schema.optionalKey(Schema.Defect()) });

/**
 * Each error moved to `optional`, beside the schema it had before 0568, and its encoded form with no
 * cause: made with drawn fields and encoded by the old schema.
 */
/** A decoded error, as the laws read it: the error, and its cause, whatever the cause holds. */
type Read = Exit.Exit<{ readonly cause?: unknown }, unknown>;

const errors = {
  SettingsError: {
    now: SettingsError,
    // The cause is a `Defect`: the wire form is the schema's own encoded form, and an encoded Error decodes to an Error.
    hidden: false,
    forms: ["absent", "undefined", "json", "error"],
    read: (_form: Form, value: unknown): Read => Schema.decodeUnknownExit(SettingsError)(value),
    before: settingsBefore,
    encoded: fc
      .record({ reason: fc.constantFrom(...SettingsError.fields.reason.literals), message: fc.string() })
      .map((fields) => Schema.encodeUnknownSync(settingsBefore)(new SettingsError(fields))),
  },
  SnapshotError: {
    now: SnapshotError,
    // The cause is a hidden cause: the wire form is the JSON codec's, which reads the placeholder and refuses the rest.
    hidden: true,
    forms: ["absent", "undefined", "placeholder", "json", "error"],
    // A cause written as `undefined` is no JSON, so it is read as the class's own schema reads it, in the process. The rest is JSON, read by the codec.
    read: (form: Form, value: unknown): Read =>
      form === "undefined"
        ? Schema.decodeUnknownExit(SnapshotError)(value)
        : Schema.decodeUnknownExit(Schema.toCodecJson(SnapshotError))(value),
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
          Match.when("placeholder", () => PLACEHOLDER),
          Match.when("json", () => json),
          Match.orElse(() => cause),
        ),
      };

/** One encoded value of a drawn error, its cause in a drawn form. */
const encoded = fc
  .record({
    name: fc.constantFrom(...NAMES),
    pick: fc.nat(),
    json: fc.jsonValue().filter((value) => value !== PLACEHOLDER),
    error: encodedError,
  })
  .map(({ name, pick, json, error }) => ({
    name,
    json,
    error,
    form: errors[name].forms[pick % errors[name].forms.length] ?? "absent",
  }))
  .chain(({ name, form, json, error }) =>
    errors[name].encoded.map((base) => ({
      name,
      form,
      bare: base,
      value: { ...base, ...causeKey(form, json, error) },
    })),
  );

/**
 * A decoded value's own fields, the stack aside, so an error and a plain struct compare field by
 * field: an Error keeps `message` as an own key that does not enumerate.
 */
const own = (value: object) =>
  Rec.fromEntries(
    Object.getOwnPropertyNames(value)
      .filter((key) => key !== "stack")
      .map((key) => [key, Object.getOwnPropertyDescriptor(value, key)?.value]),
  );

describe("T1062 L4, a settings error whose cause may be missing reads a cause written as undefined", () => {
  it("L4: SettingsError and SnapshotError decode a missing and a written-undefined cause; a Defect cause decodes an encoded Error to an Error; a hidden cause reads the placeholder as an empty hidden cause and refuses an encoded Error and any other JSON; the rest reads as the optionalKey schema read it", () => {
    const seen = new Map<string, number>();
    fc.assert(
      fc.property(encoded, ({ name, form, bare, value }) => {
        seen.set(`${name} ${form}`, (seen.get(`${name} ${form}`) ?? 0) + 1);
        const now = errors[name].read(form, value);
        const before = Schema.decodeUnknownExit(errors[name].before)(value);
        // JSON has no `undefined`: the codec of an optional field reads `null` as no cause, so that one JSON value is no refusal.
        const nothing = errors[name].hidden && form === "json" && value.cause === null;
        const refused = errors[name].hidden && (form === "json" || form === "error") && !nothing;

        if (refused) {
          // A hidden cause never crosses whole: the placeholder is the one value it reads. The error without the cause decodes, so the refusal is the cause's.
          expect(Exit.isFailure(now), `${name} refuses a cause that is ${form}`).toBe(true);
          expect(Exit.isSuccess(errors[name].read("absent", bare)), `${name} reads the rest`).toBe(true);

          return;
        }

        expect(Exit.isSuccess(now), `${name} decodes a cause that is ${form}`).toBe(true);

        if (Exit.isSuccess(now) && form === "undefined") {
          expect(now.value.cause).toBeUndefined();
        }

        if (Exit.isSuccess(now) && (form === "absent" || nothing)) {
          expect(now.value.cause).toBeUndefined();
        }

        if (Exit.isSuccess(now) && form === "placeholder") {
          expect(Redacted.isRedacted(now.value.cause), `${name} reads the placeholder as a hidden cause`).toBe(true);
          expect(
            Redacted.isRedacted(now.value.cause) && Redacted.value(now.value.cause),
            `${name} holds nothing`,
          ).toBeUndefined();
        }

        if (Exit.isSuccess(now) && form === "error") {
          expect(now.value.cause, `${name} decodes an encoded Error to an Error`).toBeInstanceOf(Error);
        }

        // The field-for-field read: wherever the cause's schema is unchanged, or there is no cause to read.
        if (
          Exit.isSuccess(now) &&
          Exit.isSuccess(before) &&
          (!errors[name].hidden || form === "absent" || form === "undefined")
        ) {
          expect(now.value).toBeInstanceOf(errors[name].now);
          expect(own(now.value)).toEqual(own(before.value));
        }
      }),
      { seed: SEED, numRuns: runsFor({ fast: 50, full: 200 }) },
    );

    for (const name of NAMES) {
      for (const form of errors[name].forms) {
        expect(seen.get(`${name} ${form}`) ?? 0, `runs reached ${name} with a cause ${form}`).toBeGreaterThan(0);
      }
    }
  });
});

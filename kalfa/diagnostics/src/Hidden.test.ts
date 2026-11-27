// H1 to H5: `Hidden.Cause` (Hidden.ts), the schema a typed error holds a cause in when the cause may quote a value. In memory it is a `Redacted`; every
// codec that writes outward writes the placeholder; a read gives back an empty hidden cause; a read of anything else is refused; a cause that is no
// `Redacted` fails loudly; and the codec that stays in the process keeps the cause. Each law draws a word, a label and a count, and applies every class
// of cause the plan lists to them, so every class is in every run. The types are H6 (Hidden.types.test.ts).
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Redacted, Schema } from "effect";
import {
  asRecord,
  causeClasses,
  classIds,
  CODECS,
  hiddenCauses,
  lookAlike,
  needles,
  plainText,
  quotingClasses,
  refusal,
  SEED,
  showsAny,
  taggedWire,
  wireValues,
  written,
} from "./Hidden.test-support.ts";
import * as Hidden from "./Hidden.ts";

/** What a read gave back in the cause's place: nothing, an empty hidden cause, or something else. */
const heldBy = (cause: Redacted.Redacted<unknown> | undefined): "none" | "empty" | "other" =>
  cause === undefined ? "none" : Redacted.value(cause) === undefined ? "empty" : "other";

/** An error with a hidden cause, a word and a count: the shape of `StoreFailed` with two public fields beside it. */
class Probe extends Schema.TaggedError<Probe, { readonly brand: unique symbol }>()("Probe", {
  word: Schema.String,
  count: Schema.Int,
  cause: Hidden.Cause,
}) {}

/** The same error with an optional hidden cause. */
class OptionalProbe extends Schema.TaggedError<OptionalProbe, { readonly brand: unique symbol }>()("OptionalProbe", {
  word: Schema.String,
  count: Schema.Int,
  cause: Schema.optional(Hidden.Cause),
}) {}

/** The probe with no cause field at all: what each codec writes for the two public fields, so the laws compare against it and not against a number. */
class Bare extends Schema.TaggedError<Bare, { readonly brand: unique symbol }>()("Bare", {
  word: Schema.String,
  count: Schema.Int,
}) {}

/** An error that holds another, as `SecretsUnavailable` holds a `StoreFailed`. */
class Wrapper extends Schema.TaggedError<Wrapper, { readonly brand: unique symbol }>()("Wrapper", {
  word: Schema.String,
  reason: Probe,
}) {}

// H1. Plant: encode with `Redacted.value`; encode with `String(value)`, so a label is written; write `null` for an empty cause; let `Cause` take `undefined`
// and write the placeholder for it; read back `Redacted.make(placeholder)`; move the link from `toCodecJson` to `toCodecIso`.
it.effect.prop(
  "H1 hidden cause: every codec writes exactly the placeholder in the cause's place and the other fields as it would without it, and a read gives the tag and the fields back with an empty hidden cause",
  { drawn: hiddenCauses },
  ({ drawn }) =>
    Effect.sync(() => {
      const made = causeClasses(drawn);
      expect(classIds(made), "the generator reaches every class").toBe("etrlu");

      expect(Hidden.placeholder, "the placeholder is Effect's own text for an unlabeled Redacted").toBe("<redacted>");

      for (const codec of CODECS) {
        const without = asRecord(codec.encode(Bare, new Bare({ word: drawn.word, count: drawn.count })));
        const fields = Object.fromEntries(Object.entries(without).filter(([key]) => key !== "_tag"));

        const cases = [
          ...made.map((each) => ({
            id: each.id,
            schema: Probe,
            error: new Probe({ word: drawn.word, count: drawn.count, cause: each.hidden }),
            has: true,
          })),
          ...made.map((each) => ({
            id: `optional ${each.id}`,
            schema: OptionalProbe,
            error: new OptionalProbe({ word: drawn.word, count: drawn.count, cause: each.hidden }),
            has: true,
          })),
          {
            id: "no cause",
            schema: OptionalProbe,
            error: new OptionalProbe({ word: drawn.word, count: drawn.count }),
            has: false,
          },
          {
            id: "cause undefined",
            schema: OptionalProbe,
            error: new OptionalProbe({ word: drawn.word, count: drawn.count, cause: undefined }),
            has: false,
          },
        ];

        for (const each of cases) {
          // As a wire holds it: a key that holds `undefined`, as `{ cause: undefined }` writes one, is no key.
          const wrote = asRecord(codec.encode(each.schema, each.error));
          const named = `${codec.name}, ${each.id}`;

          // The placeholder is written when a cause is held, and never when there is none (an `undefined` is written as no key or as `null`, as each codec does).
          expect(wrote["cause"] ?? undefined, `${named}: the cause written`).toBe(
            each.has ? Hidden.placeholder : undefined,
          );
          expect(
            Object.keys(wrote)
              .filter((key) => each.has || key !== "cause")
              .toSorted(),
            `${named}: the keys written`,
          ).toEqual(["_tag", ...Object.keys(fields), ...(each.has ? ["cause"] : [])].toSorted());
          expect(each.id === "no cause" ? "cause" in wrote : false, `${named}: no key for an absent cause`).toBe(false);

          const { _tag, cause: _cause, ...rest } = wrote;
          expect(rest, `${named}: the fields written`).toEqual(fields);
          expect(_tag, `${named}: the tag written`).toBe(each.error._tag);

          const read = codec.decode(each.schema, wrote);

          expect(read._tag, `${named}: the tag read back`).toBe(each.error._tag);
          expect([read.word, read.count], `${named}: the fields read back`).toEqual([drawn.word, drawn.count]);
          expect(heldBy(read.cause), `${named}: the cause read back`).toBe(each.has ? "empty" : "none");
        }
      }
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

// H2 [secrets]. Plant: make `Cause` `Schema.Redacted(Schema.Defect())`; write an `Error` cause's `message` as the placeholder's text; write a record cause
// through `Schema.Json`; write a text cause as itself; write a cause that has a label through `Redacted.value`.
it.effect.prop(
  "H2 hidden cause: [secrets] no codec shows the word a cause quotes, alone, held by another error, or inside an Exit, in any form",
  { drawn: hiddenCauses },
  ({ drawn }) =>
    Effect.sync(() => {
      const made = causeClasses(drawn);
      expect(classIds(made), "the generator reaches every class").toBe("etrlu");

      const found = needles(drawn.word);

      // The control: the same cause, written as it is, shows the word, so a search that finds nothing below could have found it.
      for (const each of made.filter((one) => ["e", "t", "r"].includes(one.id))) {
        expect(
          showsAny(plainText(each.plain), found),
          `${each.id}: a cause that is not hidden shows the word`,
        ).not.toEqual([]);
      }

      for (const each of quotingClasses(made)) {
        const probe = new Probe({ word: "public", count: 1, cause: each.hidden });

        const texts = [
          ...written(Probe, probe),
          ...written(Wrapper, new Wrapper({ word: "public", reason: probe })),
          ...written(OptionalProbe, new OptionalProbe({ word: "public", count: 1, cause: each.hidden })),
        ];

        expect(showsAny(texts, found), `${each.id}: the word in what the codecs wrote`).toEqual([]);
      }
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

// H3. Plant: read the cause with `Schema.String` in place of the literal; read it with `Schema.Json`; trim the wire text before the check.
it.effect.prop(
  "H3 hidden cause: a read refuses any wire value in the cause's place but the placeholder, at the cause, and says nothing of the word",
  { drawn: hiddenCauses },
  ({ drawn }) =>
    Effect.sync(() => {
      const wires = wireValues(drawn);
      expect(wires.length, "the generator reaches every wire value").toBe(7);

      const found = needles(drawn.word);

      for (const wire of wires) {
        // `null` is how the JSON codec writes an absent optional value, so an optional cause reads it as no cause.
        for (const schema of wire.value === null ? [Probe] : [Probe, OptionalProbe]) {
          const refused = refusal(
            schema,
            taggedWire(schema.name, { word: drawn.word, count: drawn.count, cause: wire.value }),
          );

          expect(refused, `${schema.name}: ${wire.id} is refused`).not.toBeUndefined();
          expect(refused?.paths, `${schema.name}: ${wire.id}: named`).toEqual([["cause"]]);
          expect(showsAny(refused?.messages ?? [], found), `${schema.name}: ${wire.id}: what it says`).toEqual([]);
        }
      }

      // The one value that is read: the placeholder itself.
      expect(
        refusal(Probe, taggedWire("Probe", { word: drawn.word, count: drawn.count, cause: "<redacted>" })),
      ).toBeUndefined();
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);

// H4. Plant: make the check `() => true`; check `"toString" in candidate`.
it.effect.prop(
  "H4 hidden cause: a cause that is no Redacted fails loudly, whatever it is, and a Redacted over it is kept as it is",
  {
    drawn: hiddenCauses,
    anything: Arbitrary.schema(Schema.Unknown).pipe(Arbitrary.filter((value) => !Redacted.isRedacted(value))),
  },
  ({ drawn, anything }) =>
    Effect.sync(() => {
      for (const raw of [anything, lookAlike]) {
        expect(
          // @ts-expect-error a raw cause is no hidden cause: the run-time guard is what stops one cast past the type
          () => new Probe({ word: drawn.word, count: drawn.count, cause: raw }),
          "a raw cause throws",
        ).toThrow();
        expect(Schema.is(Hidden.Cause)(raw), "a raw cause is no hidden cause").toBe(false);
        expect(
          Schema.is(Probe)(taggedWire("Probe", { word: drawn.word, count: drawn.count, cause: "raw" })),
          "a plain object is no error",
        ).toBe(false);

        const hidden = new Probe({ word: drawn.word, count: drawn.count, cause: Redacted.make(raw) });

        expect(Redacted.value(hidden.cause), "a Redacted over it keeps it").toBe(raw);
      }
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

// H5. Plant: annotate `toCodec` in place of `toCodecJson`, so the iso codec writes the placeholder too.
it.effect.prop(
  "H5 hidden cause: the codec that stays in the process keeps the cause, and an error made from it holds the cause it was given",
  { drawn: hiddenCauses },
  ({ drawn }) =>
    Effect.sync(() => {
      const made = causeClasses(drawn);
      expect(classIds(made), "the generator reaches every class").toBe("etrlu");

      for (const each of made.filter((one) => ["e", "t", "r"].includes(one.id))) {
        const probe = new Probe({ word: drawn.word, count: drawn.count, cause: each.hidden });

        const encoded = asRecord(Schema.encodeUnknownSync(Schema.toCodecIso(Probe))(probe));
        expect(encoded["cause"], `${each.id}: the iso form holds the very hidden cause`).toBe(each.hidden);

        const decoded = Schema.decodeUnknownSync(Schema.toCodecIso(Probe))(encoded);
        expect(Redacted.value(decoded.cause), `${each.id}: read back, it holds the cause it was given`).toBe(
          each.plain,
        );
      }
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

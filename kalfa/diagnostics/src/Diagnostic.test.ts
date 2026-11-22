// The laws of what a diagnostic is (Diagnostic.ts): the code's form, the place's rules, a reported
// diagnostic and a declared code. They are laws D1 to D4.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Exit, Schema } from "effect";
import {
  type Break,
  blank,
  CODE_BREAKS,
  codeParts,
  blanksFrom,
  fieldVariants,
  goodCode,
  goodFieldsAndParts,
  goodPlaces,
  goodText,
  otherSeverity,
  PLACE_BREAKS,
  placeParts,
  placeVariants,
  SEED,
  TEXT_KINDS,
  toCode,
} from "./Diagnostic.test-support.ts";
import * as Diagnostic from "./Diagnostic.ts";

const takesCode = (input: string): boolean => Exit.isSuccess(Schema.decodeUnknownExit(Diagnostic.Code)(input));

const takesPlace = (input: object): boolean => Exit.isSuccess(Schema.decodeUnknownExit(Diagnostic.Place)(input));

const takesReported = (input: object): boolean => Exit.isSuccess(Schema.decodeUnknownExit(Diagnostic.Reported)(input));

// D1. Plant: let the pattern allow "/" inside the name, and the second-slash break is accepted.
describe("D1, the code's form", () => {
  it.prop(
    "a code is a root and a name of lowercase words joined by hyphens, split by one slash; every break of that is refused",
    { parts: codeParts },
    ({ parts }) => {
      expect(takesCode(toCode(parts)), toCode(parts)).toBe(true);

      for (const broken of CODE_BREAKS) {
        expect(takesCode(broken.apply(parts)), `${broken.name}: ${broken.apply(parts)}`).toBe(false);
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D2. Plant: drop the "a column needs a line" check, and the column-with-no-line break is accepted. One plant
// per kind of odd segment, each a wrong rule for a segment in Diagnostic.ts: refuse a segment that starts with a
// dot; refuse a segment that holds a space; accept only [a-zA-Z0-9_~@+().-] in a segment; accept only printable
// ASCII in a segment.
describe("D2, the place", () => {
  it.prop(
    "a place is the whole repo or a path from its root, with a line and a column only from 1, whatever characters its segments hold; every break of that is refused",
    { drawn: placeParts },
    ({ drawn }) => {
      // The drawn parts, and the parts with every segment made into each kind of odd segment.
      for (const parts of placeVariants(drawn)) {
        for (const good of goodPlaces(parts)) {
          expect(takesPlace(good), JSON.stringify(good)).toBe(true);
        }

        for (const broken of PLACE_BREAKS) {
          expect(takesPlace(broken.apply(parts)), `${broken.name}: ${JSON.stringify(broken.apply(parts))}`).toBe(false);
        }
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// What can be wrong with the input of a reported diagnostic: a good input, some blank text and a severity
// that is neither `error` nor `warning`.
interface Wrongs {
  readonly good: object;
  readonly blanks: string;
  readonly severity: string;
}

const without = (good: object, field: string): object =>
  Object.fromEntries(Object.entries(good).filter(([key]) => key !== field));

const REPORTED_BREAKS: ReadonlyArray<Break<Wrongs, object>> = [
  { name: "a blank message", apply: ({ good, blanks }) => ({ ...good, message: blanks }) },
  { name: "a blank hint", apply: ({ good, blanks }) => ({ ...good, hint: blanks }) },
  { name: "another severity", apply: ({ good, severity }) => ({ ...good, severity }) },
  { name: "no code", apply: ({ good }) => without(good, "code") },
  { name: "no severity", apply: ({ good }) => without(good, "severity") },
  { name: "no message", apply: ({ good }) => without(good, "message") },
  { name: "no place", apply: ({ good }) => without(good, "place") },
  { name: "no hint", apply: ({ good }) => without(good, "hint") },
];

// A good input for a reported diagnostic, made here: Reported's own Arbitrary is not the law's to rely on. It
// holds the code, the fields, and the same fields made odd one kind at a time.
const goodReported = Arbitrary.all({ code: goodCode, drawn: goodFieldsAndParts }).pipe(
  Arbitrary.map(({ code, drawn }) => ({
    good: { code, ...drawn.fields },
    odd: fieldVariants(drawn).map((fields) => ({ code, ...fields })),
  })),
);

// D3. Plant: check the hint with isNonEmpty only, and the blank-hint break is accepted. One plant per kind of
// odd text, each a wrong rule for text in Diagnostic.ts: refuse text whose first character is whitespace;
// refuse a tab, a line feed or a carriage return anywhere; refuse a character past U+024F; refuse more than 16
// characters; and for blanks, count only space, tab and line feed as blank.
describe("D3, a reported diagnostic", () => {
  it.prop(
    "a reported diagnostic has five good fields, of any text, and round trips; every blank, wrong or missing field is refused",
    { drawn: goodReported, blanks: blank, severity: otherSeverity },
    ({ drawn: { good, odd }, blanks, severity }) => {
      for (const each of [good, ...odd]) {
        expect(takesReported(each)).toBe(true);
        expect(Schema.encodeSync(Diagnostic.Reported)(Schema.decodeUnknownSync(Diagnostic.Reported)(each))).toEqual(
          each,
        );
      }

      // Each kind of blank, beside the good fields, and the drawn blank beside each kind of odd good field.
      const wrongs = [
        ...blanksFrom(blanks).map((blanked) => ({ good, blanks: blanked, severity })),
        ...odd.map((each) => ({ good: each, blanks, severity })),
      ];

      for (const wrong of wrongs) {
        for (const broken of REPORTED_BREAKS) {
          expect(takesReported(broken.apply(wrong)), broken.name).toBe(false);
        }
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// Text with whitespace around it, which `make` keeps as given.
const markdown = Arbitrary.all([blank, goodText, blank]).pipe(Arbitrary.map((parts) => parts.join("")));

// D4. Plant: trim `explain` before keeping it, and a text with spaces around it comes back changed.
describe("D4, make declares", () => {
  it.prop(
    "a good code and a text give a declared code that holds both exactly as given",
    { code: goodCode, explain: markdown },
    ({ code, explain }) => {
      // The text as drawn, and made into each kind of odd text.
      for (const each of [explain, ...TEXT_KINDS.map((kind) => kind.apply(explain))]) {
        const declared = Diagnostic.make(code, { explain: each });

        expect(declared.code).toBe(code);
        expect(declared.explain).toBe(each);
      }
    },
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  // The error for a blank text may name the code or the field that is blank. The error for a malformed code
  // names the code.
  it.prop(
    "every malformed code, and a blank text, makes it throw, and the error names what is wrong",
    { parts: codeParts, blanks: blank },
    ({ parts, blanks }) => {
      for (const broken of CODE_BREAKS) {
        expect(() => Diagnostic.make(broken.apply(parts), { explain: "A long text." }), broken.name).toThrow(
          broken.apply(parts),
        );
      }

      for (const blanked of blanksFrom(blanks)) {
        expect(() => Diagnostic.make(toCode(parts), { explain: blanked })).toThrow(
          new RegExp(`${toCode(parts)}|explain`),
        );
      }
    },
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

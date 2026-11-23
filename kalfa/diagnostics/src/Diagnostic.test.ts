// The laws of what a diagnostic is (Diagnostic.ts): the code's form, the four kinds of place, the text of a place,
// a reported diagnostic and a declared code. They are laws D1 to D4 and D18 to D23.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Option, Result, Schema } from "effect";
import {
  type Break,
  blank,
  CODE_BREAKS,
  codeParts,
  blanksFrom,
  carriedSets,
  carriers,
  carryHeld,
  environmentBreaks,
  environmentPlaces,
  fieldVariants,
  flagBreaks,
  flagPlaces,
  goodCode,
  goodFieldsAndParts,
  goodPlaces,
  goodText,
  homeBreaks,
  type Failure,
  homePlaces,
  leftBehind,
  between,
  nonCarriers,
  observed,
  otherSeverity,
  placeParts,
  repoBreaks,
  reached,
  repoPlaces,
  rootedAtLogin,
  SEED,
  schemaErrorIn,
  shapeBreaks,
  TEXT_KINDS,
  throwing,
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

// Each of a law's cases must be taken or refused, and the failure names the class and the value.
const expectTaken = (cases: ReadonlyArray<{ readonly name: string; readonly value: object }>): void => {
  for (const { name, value } of cases) {
    expect(takesPlace(value), `${name}: ${JSON.stringify(value)}`).toBe(true);
  }
};

const expectRefused = (cases: ReadonlyArray<{ readonly name: string; readonly value: object }>): void => {
  for (const { name, value } of cases) {
    expect(takesPlace(value), `${name}: ${JSON.stringify(value)}`).toBe(false);
  }
};

// Every class of good input and of break is in every run: each draw is made into each class, so no run passes on
// less, and a generator that missed a class would let its plant through.

// D2. Plant: drop the first-part rule from `isRepoPath`, and `~/x` is accepted; refuse only a first part that is
// exactly `~`, and `~someone/x` is accepted; refuse `~` and `$` anywhere, and a deeper `~` part is refused; refuse
// more than 64 characters, and the long path is refused; drop the "a column needs a line" check, and the
// column-with-no-line break is accepted; drop the drive rule (amendment 1), and a first part `C:` or `z:`, or the
// drive root then Users and a login, is accepted; refuse a drive letter anywhere, and a deeper `C:` part is
// refused. One plant per kind of odd segment, each a wrong rule for a segment in
// Diagnostic.ts: refuse a segment that starts with a dot; refuse a segment that holds a space; accept only
// [a-zA-Z0-9_~@+().-] in a segment; accept only printable ASCII in a segment.
describe("D2, a file in the repo", () => {
  it.prop(
    "a repo place is the whole repo or a path from its root that never starts like a home path, with a line and a column only from 1, whatever characters its parts hold; every break of that is refused",
    { drawn: placeParts },
    ({ drawn }) => {
      expectTaken(repoPlaces(drawn));
      expectRefused(repoBreaks(drawn));
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D18. Plant: accept only `~/`, and the `$NAME/` start is refused; accept only capital names, and a lowercase name
// is refused; refuse a name with digits; accept `$` and any characters up to `/`, and `$NA-ME/x` is accepted;
// accept `~` with no part after it; drop the column-needs-line check on `Home`; refuse a part past U+024F.
describe("D18, a file under the home folder", () => {
  it.prop(
    "a home place starts with ~/ or $NAME/ and has good parts after it, with a line and a column only from 1; every break of that is refused",
    { drawn: placeParts },
    ({ drawn }) => {
      expectTaken(homePlaces(drawn));
      expectRefused(homeBreaks(drawn));
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D19. Plant: accept only capitals in a name, and a lowercase name is refused; refuse more than 32 characters;
// declare `line` as `optionalKey(Count)`, and a line is accepted; use a plain `Struct` with no `line` key, and the
// line is dropped and the place accepted.
describe("D19, an environment variable", () => {
  it.prop(
    "an environment place is a shell name and nothing else; every break of that, and any line or column, is refused",
    { drawn: placeParts },
    ({ drawn }) => {
      expectTaken(environmentPlaces(drawn));
      expectRefused(environmentBreaks(drawn));
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D20. Plant: accept only `--`, and a one-character flag is refused; accept only ASCII, and a name past U+024F is
// refused; allow `=`, and `--token=x` is accepted; check whitespace with `/ /` only, and a tab is accepted; refuse
// more than 64 characters, and the long flag is refused. Amendment 2: allow a short flag of any length, and `-fo`
// is accepted; refuse control characters (Cc) only, and a zero-width space or U+202E (Cf) is accepted; refuse Cc and
// Cf but not a lone surrogate (Cs), and the surrogate is accepted; count a short flag's character by UTF-16 unit,
// and `-` and one character outside the Basic Multilingual Plane is refused.
describe("D20, a command-line flag", () => {
  it.prop(
    "a flag place is a flag as written on a command line and nothing else; every break of that, and any line or column, is refused",
    { drawn: placeParts },
    ({ drawn }) => {
      expectTaken(flagPlaces(drawn));
      expectRefused(flagBreaks(drawn));
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D21. Plant: make `_tag` optional on `Repo` with `repo` as its default, and the old shape is accepted; drop
// `column` when encoding a home place, and the round trip loses it.
describe("D21, the kind is data", () => {
  it.prop(
    "a place with no kind, an unknown kind, or one kind's tag with another kind's fields is refused; every good place of every kind and class decodes and encodes back to itself",
    { drawn: placeParts },
    ({ drawn }) => {
      expectRefused(shapeBreaks(drawn));

      for (const { name, value } of goodPlaces(drawn)) {
        const decoded = Schema.decodeUnknownSync(Diagnostic.Place)(value);

        expect(decoded, name).toEqual(value);
        expect(Schema.encodeSync(Diagnostic.Place)(decoded), name).toEqual(value);
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D22 is a format law: the text is for a person and for CLI to print, so its exact form is the behavior. Each
// good place comes with the text a person should read, written apart from the code that makes it.
// Plant: leave out the column; print the environment name bare; print a flag without the word `flag`; trim the
// path, and a path with spaces around a part changes.
describe("D22, the text form", () => {
  it.prop(
    "formatPlace gives a file's path, then its line and column when it has them, and the words environment variable or flag before a name",
    { drawn: placeParts },
    ({ drawn }) => {
      for (const { name, value, text } of goodPlaces(drawn)) {
        expect(Diagnostic.formatPlace(value), name).toBe(text);
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D23 [secrets]. A login holds a digit, so no fixed word of a message can hold it by chance. Every root is
// refused as a home place and as a repo place in every run, the Windows drive with forward slashes included
// (plan amendment 1), and so are a `file:` start and a drive joined to `Users` (plan amendment 2).
// Plant: drop the drive rule from `isRepoPath`, and the drive root is accepted as a repo place; refuse only a first
// part that is a letter and `:`, and the `file:` and joined-drive forms are accepted; accept an absolute home path; write the path into `HomePath`'s refusal message; decode in `report` with
// `reportInput: true`, so the defect's issue holds the path; print a home place with its start cut off.
describe("D23, no login name in any output", () => {
  it.effect.prop(
    "a path under any machine's home root is refused as a home place and as a repo place, and no output holds the login; a good home place prints and encodes with its start as given",
    { drawn: placeParts },
    ({ drawn }) =>
      Effect.gen(function* () {
        for (const rooted of rootedAtLogin(drawn)) {
          for (const { name, value } of rooted.places) {
            const label = `${rooted.name}, ${name}`;
            const decoded = Schema.decodeUnknownResult(Diagnostic.Place)(value);

            expect(Result.isFailure(decoded), label).toBe(true);

            const run = yield* observed("demo/leak", { severity: "error", message: "m", place: value, hint: "h" });
            const refusal = schemaErrorIn(run.exit);

            expect(refusal, label).toBeDefined();
            expect(run.reported, label).toEqual([]);

            const outputs = [
              ...leftBehind(Result.isFailure(decoded) ? decoded.failure : undefined),
              ...leftBehind(refusal),
              JSON.stringify(run.spans.flatMap((span) => [...span.attributes])),
            ];

            for (const output of outputs) {
              expect(output, label).not.toContain(rooted.login);
            }
          }
        }

        for (const { name, value } of homePlaces(drawn)) {
          const start = value.path.split("/")[0] ?? "";

          expect(start === "~" || start.startsWith("$"), name).toBe(true);
          expect(Diagnostic.formatPlace(value).startsWith(`${start}/`), name).toBe(true);
          expect(Schema.encodeSync(Diagnostic.Place)(Schema.decodeUnknownSync(Diagnostic.Place)(value)), name).toEqual(
            value,
          );
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
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

const declare = (code: string): Diagnostic.Declared => Diagnostic.make(code, { explain: "A long text." });

// What `fromError` finds in a value, or nothing.
const readCarried = (value: Failure): Diagnostic.Carried | undefined =>
  Option.getOrUndefined(Diagnostic.fromError(value));

// Every class of value in every run: each draw is made into a value of each class (a) to (k), so no run passes on less,
// and a generator that missed a class would let its plant through.

// D26. Plant: (a) read only an own key, `Object.hasOwn(error, "diagnostic")`, and the class's getter is not seen;
// (b) answer none unless `Predicate.isError(error)`, and the plain object is missed; (c) answer none unless the
// value has a `_tag`, and the native error is missed.
describe("D26, fromError finds what is carried", () => {
  it.prop(
    "a value that carries carry(declared, fields) gives some Carried with that Declared and the fields as given, always an error, and for a held key the very value it holds",
    { code: goodCode, drawn: goodFieldsAndParts },
    ({ code, drawn }) => {
      const declared = declare(code);

      // The drawn fields, and the fields made into each kind of odd good text and place.
      for (const spread of [drawn.fields, ...fieldVariants(drawn)]) {
        const found = carriers(declared, spread);

        // Each class (a), (b) and (c) is reached, or the law fails loudly.
        expect(reached(found)).toEqual(["a", "b", "c"]);

        for (const { name, value, held } of found) {
          const carried = readCarried(value);

          expect(carried, name).toBeDefined();
          expect(carried?.declared, name).toBe(declared);
          expect(carried?.fields, name).toEqual({
            severity: "error",
            message: spread.message,
            place: spread.place,
            hint: spread.hint,
          });

          if (held !== undefined) {
            expect(carried, name).toBe(held);
          }
        }
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D27. Plant: (d) test `"diagnostic" in error` with no object check, and a string or null throws; (e) answer
// `Option.some(error.diagnostic)` for every object, and `{}` gives some(undefined); (f) check for `declared` and
// `fields` keys in place of the symbol, and the look-alike is found; and check only that `diagnostic` is not null,
// and the plain reported diagnostic is found.
describe("D27, fromError finds nothing and never throws", () => {
  it.prop(
    "a value that is no object, an object with no diagnostic key, or a diagnostic that carry did not make gives none",
    { code: goodCode, drawn: goodFieldsAndParts, text: goodText, count: between(-100000, 100000) },
    ({ code, drawn, text, count }) => {
      const found = nonCarriers(declare(code), drawn.fields, { text, count });

      // Each class (d), (e) and (f) is reached, or the law fails loudly.
      expect(reached(found)).toEqual(["d", "e", "f"]);

      for (const { name, value } of found) {
        expect(Option.isNone(Diagnostic.fromError(value)), name).toBe(true);
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// D28. Plant: (g) wrap the read in `try` and answer none on a throw, and nothing is thrown.
describe("D28, a getter that throws is not caught", () => {
  it.effect.prop(
    "a diagnostic getter that throws a drawn error makes fromError throw that same error",
    { message: goodText },
    ({ message }) =>
      Effect.gen(function* () {
        const boom = new Error(message);
        const shaped = throwing(boom);

        // A read that throws is a defect of the run, and one that does not is a success.
        const exit = yield* Effect.exit(Effect.sync(() => Diagnostic.fromError(shaped.value)));
        const defect = Exit.isFailure(exit) ? Result.getOrUndefined(Cause.findDefect(exit.cause)) : undefined;

        expect(reached([shaped])).toEqual(["g"]);
        expect(defect).toBe(boom);
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

// D29. Plant: (h) trim the message in `carry`, and a text kind with a space in front comes back changed; and decode
// the place in `carry` and keep the decoded copy, and `toBe` fails; (i) decode the fields with `Reported` in `carry`
// and throw on a bad one, and a blank hint throws; (j) build the fields as `{ severity: "error", ...fields }`, and a
// smuggled "warning" wins.
describe("D29, carry keeps what it is given, unchecked", () => {
  it.prop(
    "good fields of every kind, bad fields of every kind and a smuggled severity are all kept as given, and the severity is error",
    { code: goodCode, drawn: goodFieldsAndParts, blanks: blank, other: otherSeverity },
    ({ code, drawn, blanks, other }) => {
      const declared = declare(code);
      const sets = carriedSets({ drawn, blanks, other });

      // The odd good fields (h), the bad ones (i) and a smuggled severity (j) are all in the run.
      expect(sets.length).toBeGreaterThan(fieldVariants(drawn).length);

      for (const { name, spread } of sets) {
        // A spread is a variable typed wider than `carry`'s parameter, as a caller's would be.
        const carried = carryHeld(declared, spread);

        expect(carried.declared, name).toBe(declared);
        expect(carried.fields.message, name).toBe(spread.message);
        expect(carried.fields.hint, name).toBe(spread.hint);
        expect(carried.fields.place, name).toBe(spread.place);
        expect(carried.fields.severity, name).toBe("error");
        // Nothing else rides along.
        expect(Object.keys(carried.fields).toSorted(), name).toEqual(["hint", "message", "place", "severity"]);
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

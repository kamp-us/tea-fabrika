// F1 and X3, the errors: the nine errors cross a wire as data, and the three failures write their cause as a fixed placeholder and never its value. They
// run in memory on every pull request.
import { inspect } from "node:util";
import { expect, it } from "@effect/vitest";
import {
  Cause,
  Effect,
  Equal,
  Exit,
  Formatter,
  Inspectable,
  Option,
  Predicate,
  Redacted,
  Result,
  Schema,
} from "effect";
import * as Errors from "./Errors.ts";
import {
  type AnyError,
  ChatRefused,
  ChatUnavailable,
  eachError,
  errorTexture,
  FAILURE_TAGS,
  needles,
  quoting,
  READ_TAGS,
  REFUSAL_TAGS,
  reachable,
  SEED,
  secretTexture,
  shape,
  showsAny,
} from "./Ledger.test-support.ts";

/** Every one of the nine, as a wire carries them, and as JSON text carries them. */
const Every = Schema.Union([...Errors.Refusal.members, Errors.EmptyTypes, ...Errors.Failure.members]);

const Json = Schema.toCodecJson(Every);

/** An outcome that failed with one of the nine, as JSON carries it: what a transport sends when a call fails. */
const Outcome = Schema.toCodecJson(Schema.Exit(Schema.Void, Every, Schema.Defect()));

/** What a failure's cause is written as in JSON, in the test's own words: the plan's call, and no value of any cause. */
const PLACEHOLDER = "<redacted>";

/** Which of the three families an error is in, by its tag: the five refusals, the read's own error, or the three failures. */
const classify = (error: AnyError): "refusal" | "read" | "failure" => {
  if (REFUSAL_TAGS.some((tag) => tag === error._tag)) {
    return "refusal";
  }

  return READ_TAGS.some((tag) => tag === error._tag) ? "read" : "failure";
};

/** The error an outcome failed with, or nothing when it is anything else. */
const failedWith = (exit: Exit.Exit<unknown, unknown>): Option.Option<unknown> =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();

/** A JSON value read back from its text. */
const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

// F1. Plant: give `TooBig` a `Schema.Number` field written as text (a wire that sends `"3"` is no `3`); put `BadRow` in `Refusal`; put `EmptyTypes` in `Refusal`;
// drop `StorageFailed` from `Failure`; give two errors one tag; leave `AdmissionRefused`'s `reason` out of the class (a field lost on the wire); write a
// failure's cause as its value, as other text, or not at all; decode a failure's cause as a value; give `Revision` a smaller range (the drawn revisions fail
// to cross); leave `EmptyTypes` out of the outcome's wire form.
it.effect.prop(
  "F1 errors: each of the nine errors encodes and decodes back to the same tag and fields as data and as JSON text, a failure writes its cause as a fixed placeholder and reads it back hidden and empty, an outcome that failed with one crosses too, and Refusal and Failure hold exactly their own members",
  { texture: errorTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const every = eachError(texture);

      expect(
        every.map((each) => each.error._tag),
        "the generator makes each of the nine",
      ).toEqual([...REFUSAL_TAGS, ...READ_TAGS, ...FAILURE_TAGS]);

      for (const { error, fields } of every) {
        // The error holds the fields it was given, the tag, and nothing else: no field is lost and none is made up.
        const expected = Object.fromEntries([["_tag", error._tag], ...Object.entries(fields)]);

        expect(Equal.equals(shape(error), expected), `${error._tag} holds exactly the fields it was made from`).toBe(
          true,
        );

        const family = classify(error);

        // As data: what the schema encodes, the schema decodes.
        const back = Schema.decodeUnknownSync(Every)(Schema.encodeUnknownSync(Every)(error));

        expect(back._tag, `${error._tag} as data: the same tag`).toBe(error._tag);
        expect(
          Equal.equals(shape(back), expected),
          `${error._tag} as data: the same fields, ${JSON.stringify(shape(back))} for ${JSON.stringify(expected)}`,
        ).toBe(true);

        // As JSON: the tag and every field, written here; a failure's cause is the placeholder and never its value.
        const onTheWire = Object.fromEntries([
          ["_tag", error._tag],
          // JSON has no minus zero: a number is written as the JSON text of it.
          ...Object.entries(fields).map(([name, value]) => [
            name,
            name === "cause" ? PLACEHOLDER : parsed(JSON.stringify(value)),
          ]),
        ]);

        const text = JSON.stringify(Schema.encodeUnknownSync(Json)(error));
        const wire = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(parsed(text));

        expect(Object.keys(wire).sort(), `${error._tag} as JSON: the tag and its fields`).toEqual(
          Object.keys(onTheWire).sort(),
        );

        for (const [name, value] of Object.entries(onTheWire)) {
          expect(wire[name], `${error._tag} as JSON: the field ${name}`).toEqual(value);
        }

        // What it is read back as: a refusal and the read's error with every field, a failure with its cause hidden and empty.
        const read = Object.fromEntries(
          Object.entries(expected).map(([name, value]) => [name, name === "cause" ? Redacted.make(undefined) : value]),
        );

        const received = Schema.decodeUnknownSync(Json)(wire);

        expect(received._tag, `${error._tag} as JSON text: the same tag`).toBe(error._tag);
        expect(
          Equal.equals(shape(received), read),
          `${error._tag} as JSON text: the same fields, ${JSON.stringify(shape(received))} for ${JSON.stringify(read)}`,
        ).toBe(true);

        // An outcome that failed with it crosses the same way, as a transport sends a failed call.
        const arrived = failedWith(
          Schema.decodeUnknownSync(Outcome)(
            parsed(JSON.stringify(Schema.encodeUnknownSync(Outcome)(Exit.fail(error)))),
          ),
        );

        expect(
          Option.exists(arrived, (found) => Schema.is(Every)(found) && found._tag === error._tag),
          `${error._tag} in an outcome: it failed with the same tag`,
        ).toBe(true);
        expect(
          Option.exists(arrived, (found) => Schema.is(Every)(found) && Equal.equals(shape(found), read)),
          `${error._tag} in an outcome: the same fields`,
        ).toBe(true);

        // Each is the member of its own family and of no other, whether it is the error or what the wire carried.
        expect(Schema.is(Errors.Refusal)(error), `${error._tag} is a refusal exactly when it is one`).toBe(
          family === "refusal",
        );
        expect(Schema.is(Errors.Failure)(error), `${error._tag} is a failure exactly when it is one`).toBe(
          family === "failure",
        );
        expect(
          Option.isSome(Schema.decodeUnknownOption(Errors.Refusal)(Schema.encodeUnknownSync(Every)(error))),
          `${error._tag}'s wire form decodes as a refusal exactly when it is one`,
        ).toBe(family === "refusal");
        expect(
          Option.isSome(Schema.decodeUnknownOption(Errors.Failure)(Schema.encodeUnknownSync(Every)(error))),
          `${error._tag}'s wire form decodes as a failure exactly when it is one`,
        ).toBe(family === "failure");
      }
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);

/** Every text a failure shows, written every way an error is written: its message, its stack, its text, its JSON, a formatter's, Node's, the pretty cause of each ending, and every property it reaches. */
const shown = (error: Error): ReadonlyArray<string> => [
  error.message,
  error.stack ?? "",
  String(error),
  JSON.stringify(error),
  Formatter.format(error),
  Inspectable.toStringUnknown(error),
  inspect(error, { depth: 10, showHidden: true }),
  Cause.pretty(Cause.fail(error)),
  Cause.pretty(Cause.die(error)),
  ...reachable(error),
];

/** The chain of an error: it, the error it holds as its `cause`, and so on, each shown. */
const chain = (error: Error): ReadonlyArray<string> => {
  const found: Array<string> = [];
  let at: unknown = error;

  while (Predicate.isError(at) && found.length < 20) {
    found.push(...shown(at));
    at = at.cause;
  }

  return found;
};

// X3. [secrets] Plant: type a failure's cause as `Schema.Defect()` and let its text reach the message; put the cause's text in the error's message;
// keep the cause in a plain property that is no `Redacted`; give the error a `toJSON` that returns the cause's text; make the wrapper's `cause` the
// revealed value, not the failure; write `Redacted.value(cause)` into the stack.
it.effect.prop(
  "X3 secrets: a failure and a wrapper that holds it show no text of a cause that quotes a secret, in any rendering of the error, any property it reaches or any error in its cause chain",
  { drawn: secretTexture },
  ({ drawn }) =>
    Effect.sync(() => {
      const found = needles(drawn);

      // The control: the cause as plain data is found, so a search that finds nothing below is a search that could find it.
      const plain = quoting(drawn);

      expect(
        showsAny([Cause.pretty(Cause.die(plain)), Formatter.format(plain)], found),
        `a cause that is not hidden shows its secret, as a ${drawn.form}`,
      ).not.toEqual([]);

      const failures = [
        new Errors.Unreachable({ cause: Redacted.make(plain) }),
        new Errors.BadRow({ cause: Redacted.make(plain) }),
        new Errors.StorageFailed({ cause: Redacted.make(plain) }),
      ];

      for (const failure of failures) {
        const wrapper = new ChatUnavailable({ reason: failure });

        expect(wrapper.cause, `${failure._tag}: the wrapper's cause is the failure it holds`).toBe(failure);

        // The hidden cause is read on purpose, and is the one the failure was made with.
        expect(
          Redacted.isRedacted(failure.cause) && Redacted.value(failure.cause) === plain,
          `${failure._tag}: the cause is kept, hidden`,
        ).toBe(true);

        for (const [named, error] of [
          [failure._tag, failure],
          [`${wrapper._tag} over ${failure._tag}`, wrapper],
        ] as const) {
          expect(showsAny(chain(error), found), `${named} over a ${drawn.form}`).toEqual([]);
        }
      }
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

/** Every text an attempt to write a failure as JSON shows, alone and as the failure of an outcome: the JSON text it wrote, or each rendering of the refusal it met. */
const written = (failure: Errors.Failure): ReadonlyArray<string> =>
  [
    () => JSON.stringify(Schema.encodeUnknownSync(Schema.toCodecJson(Errors.Failure))(failure)),
    () => JSON.stringify(Schema.encodeUnknownSync(Json)(failure)),
    () => JSON.stringify(Schema.encodeUnknownSync(Outcome)(Exit.fail(failure))),
  ].flatMap((attempt) =>
    Result.match(Result.try(attempt), {
      onSuccess: (text) => [text],
      onFailure: (refused) => (Predicate.isError(refused) ? shown(refused) : [String(refused)]),
    }),
  );

// F2. [secrets] Plant: write the cause's value into the JSON (leave the cause as `Schema.Redacted(Schema.Defect())`, whose JSON form is its value); write it
// under another key; write the cause's message and not its value; write it in the placeholder's place only for the first failure of the union and write the
// other two in the clear; write it only when the failure is alone and not when an outcome holds it.
it.effect.prop(
  "F2 secrets: writing a failure as JSON never shows the value of its cause, for each failure and each shape a cause that quotes a secret has",
  { drawn: secretTexture },
  ({ drawn }) =>
    Effect.sync(() => {
      const found = needles(drawn);
      const plain = quoting(drawn);

      // The control: the same cause, written as a Defect and not hidden, shows its secret, so a search that finds nothing below could have found it.
      expect(
        showsAny([JSON.stringify(Schema.encodeUnknownSync(Schema.toCodecJson(Schema.Defect()))(plain))], found),
        `a cause that is not hidden is written with its secret, as a ${drawn.form}`,
      ).not.toEqual([]);

      for (const failure of [
        new Errors.Unreachable({ cause: Redacted.make(plain) }),
        new Errors.BadRow({ cause: Redacted.make(plain) }),
        new Errors.StorageFailed({ cause: Redacted.make(plain) }),
      ]) {
        expect(showsAny(written(failure), found), `${failure._tag} as JSON over a ${drawn.form}`).toEqual([]);
        expect(
          showsAny(chain(new ChatUnavailable({ reason: failure })), found),
          `${failure._tag} held by a package above`,
        ).toEqual([]);
      }
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

// F3. Plant: change a word of the text; leave the text out (the message is empty); make the text depend on a field; write the text in another
// letter case.
it("F3 format: the error of a read that names no types says exactly why, and how to ask for every entry", () => {
  // format: the text is what a caller reads, so it must be written exactly as the plan's call gives it.
  expect(new Errors.EmptyTypes({}).message).toBe(
    "types must hold at least one type: leave types out to read every entry",
  );
});

// R1. Plant: drop the line from `ChatRefused` in the test support, so its cause is none and a print names no refusal; write `cause = undefined`; write the refusal's tag as
// text in its place, so the cause is no refusal.
it.effect.prop(
  "R1 refusal wrapper: ChatRefused's cause is the refusal it holds, for each of the five refusals, and a print of it names which refusal",
  { texture: errorTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const refusals = eachError(texture).flatMap(({ error }) => (Schema.is(Errors.Refusal)(error) ? [error] : []));

      expect(
        refusals.map((each) => each._tag),
        "the generator reaches each of the five",
      ).toEqual([...REFUSAL_TAGS]);

      for (const refusal of refusals) {
        const wrapper = new ChatRefused({ reason: refusal });

        expect(wrapper.cause, `${refusal._tag}: the wrapper's cause is the refusal it holds`).toBe(refusal);
        expect(Cause.pretty(Cause.fail(wrapper)), `${refusal._tag}: a print names the refusal`).toContain(
          `[cause]: ${refusal._tag}`,
        );
      }
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);

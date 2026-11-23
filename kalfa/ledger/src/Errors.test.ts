// F1 and X3, the errors: the eight errors cross a wire as data, and the three failures hide their cause. They run in memory on every pull request.
import { inspect } from "node:util";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Equal, Formatter, Inspectable, Option, Predicate, Redacted, Schema } from "effect";
import * as Errors from "./Errors.ts";
import {
  type AnyError,
  ChatUnavailable,
  eachError,
  errorTexture,
  FAILURE_TAGS,
  needles,
  quoting,
  REFUSAL_TAGS,
  reachable,
  SEED,
  secretTexture,
  shape,
  showsAny,
} from "./Ledger.test-support.ts";

/** Every one of the eight, as a wire carries them, and as JSON text carries them. */
const Eight = Schema.Union([...Errors.Refusal.members, ...Errors.Failure.members]);

const Json = Schema.toCodecJson(Eight);

/** Whether an error is one of the five refusals. */
const isRefusal = (error: AnyError): boolean => REFUSAL_TAGS.some((tag) => tag === error._tag);

// F1. Plant: give `TooBig` a `Schema.Number` field written as text (a wire that sends `"3"` is no `3`); put `BadRow` in `Refusal`; drop `StorageFailed` from
// `Failure`; give two errors one tag; leave `AdmissionRefused`'s `reason` out of the class (a field lost on the wire); decode a failure's cause as `undefined`.
it.effect.prop(
  "F1 errors: each of the eight errors encodes and decodes back to the same tag and fields, as data and as JSON text, and Refusal and Failure hold exactly their own members",
  { texture: errorTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const every = eachError(texture);

      expect(
        every.map((each) => each.error._tag),
        "the generator makes each of the eight",
      ).toEqual([...REFUSAL_TAGS, ...FAILURE_TAGS]);

      for (const { error, fields } of every) {
        // The error holds the fields it was given, the tag, and nothing else: no field is lost and none is made up.
        const expected = Object.fromEntries([["_tag", error._tag], ...Object.entries(fields)]);

        expect(Equal.equals(shape(error), expected), `${error._tag} holds exactly the fields it was made from`).toBe(
          true,
        );

        const refusal = isRefusal(error);

        // As data: what the schema encodes, the schema decodes. As JSON text: what a wire carries between two processes.
        const back = Schema.decodeUnknownSync(Eight)(Schema.encodeUnknownSync(Eight)(error));

        const received = Schema.decodeUnknownSync(Json)(
          Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
            JSON.stringify(Schema.encodeUnknownSync(Json)(error)),
          ),
        );

        for (const [via, got] of [
          ["data", back],
          ["JSON text", received],
        ] as const) {
          expect(got._tag, `${error._tag} as ${via}: the same tag`).toBe(error._tag);
          expect(
            Equal.equals(shape(got), expected),
            `${error._tag} as ${via}: the same fields, ${JSON.stringify(shape(got))} for ${JSON.stringify(expected)}`,
          ).toBe(true);
        }

        // Each is the member of its own family and of no other, whether it is the error or what the wire carried.
        expect(Schema.is(Errors.Refusal)(error), `${error._tag} is a refusal exactly when it is one`).toBe(refusal);
        expect(Schema.is(Errors.Failure)(error), `${error._tag} is a failure exactly when it is one`).toBe(!refusal);
        expect(
          Option.isSome(Schema.decodeUnknownOption(Errors.Refusal)(Schema.encodeUnknownSync(Eight)(error))),
          `${error._tag}'s wire form decodes as a refusal exactly when it is one`,
        ).toBe(refusal);
        expect(
          Option.isSome(Schema.decodeUnknownOption(Errors.Failure)(Schema.encodeUnknownSync(Eight)(error))),
          `${error._tag}'s wire form decodes as a failure exactly when it is one`,
        ).toBe(!refusal);
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

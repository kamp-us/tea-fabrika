// The laws that a secret's value shows nowhere (X6 to X10), for what this package holds of a value so far: the store's answer, the hidden value in it,
// the memory store's contents, and the facts a read is recorded as. A value is drawn for every class the plan names, written into the memory store,
// read and recorded (`flow`), and then looked for, in every form another system writes it in (as it is, JSON-escaped, base64, base64url, hex, percent-
// encoded, and the first characters of its marker), in every place a value can land: its display (X6), a log line (X7), a span (X8), a rendered error
// (X9), and an error's own properties and the cause chain under it (X10). There is no URL in this package yet, so the percent-encoded form stands for
// one: it fails where a value reached a query or a path.
//
// Each law watches the flow itself, so a leak the package makes on its own (a debug line, a span attribute) is seen, and it also hands each carrier
// to a log call, a span and an error as a caller could, so a carrier that does not hide itself is seen. A scenario may supplement these, never
// replace them.
import { inspect } from "node:util";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Formatter, Option, Redacted, Schema } from "effect";
import * as Errors from "./Errors.ts";
import { flow, NAME, STORE_ID } from "./Leak.test-support.ts";
import * as Name from "./Name.ts";
import * as Recorder from "./Recorder.ts";
import {
  failingRecorder,
  failingStore,
  findable,
  holder,
  found,
  needles,
  outcome,
  quoting,
  reachable,
  SEED,
  showsAny,
  shown,
  spanText,
  valueClasses,
  valueTexture,
  watched,
  written,
  writtenExit,
  type Value,
} from "./Secrets.test-support.ts";

const ITEM = "app-key";

/** A thing that holds a value, or holds what holds it, and a name for it, so a failure says which. */
interface Carrier {
  readonly name: string;
  readonly thing: object;
}

/** The carriers the flow leaves: the answer, the contents, the facts, and the hidden value inside the answer. */
const carriers = (value: Value): Effect.Effect<ReadonlyArray<Carrier>, Errors.StoreFailed | Errors.RecordFailed> =>
  Effect.gen(function* () {
    const { held, contents, facts } = yield* flow(ITEM, value.text);

    expect(outcome(held), `${value.id}: the flow found its value`).toBe("found");

    return [
      { name: "the answer", thing: held },
      { name: "the contents", thing: contents },
      { name: "the facts", thing: facts },
      ...Option.toArray(Option.map(found(held), (each) => ({ name: "the hidden value", thing: each.value }))),
    ];
  });

/** Every way a program shows a thing as text. */
const displays = (thing: object): ReadonlyArray<string> => [
  shown(() => String(thing)),
  shown(() => JSON.stringify(thing)),
  shown(() => Formatter.format(thing)),
  shown(() => inspect(thing, { depth: null })),
];

const classIds = (values: ReadonlyArray<Value>): string => values.map((value) => value.id).join("");

const run = { arbitrary: { runs: 300, seed: SEED } };

/** The errors a caller could make from a carrier, each as the cause: a store that failed and a recorder that failed. */
const errorsFrom = (thing: object) =>
  [
    new Errors.StoreFailed({ cause: Redacted.make(thing) }),
    new Errors.RecordFailed({ cause: Redacted.make(thing) }),
  ] as const;

/** The same errors with the schema that writes each, so a law reads what a codec gives for it. */
const writersFrom = (thing: object) => {
  const [store, record] = errorsFrom(thing);

  return [
    { schema: Errors.StoreFailed, error: store },
    { schema: Errors.RecordFailed, error: record },
  ] as const;
};

/** Both failures of a store side as one schema, as an `Exit` that holds either is written. */
const Failures = Schema.Union([Errors.StoreFailed, Errors.RecordFailed]);

// X6. [secrets] Plant: give the answer a `toJSON` that returns the value's text; give it a `toString` that does; give the contents a plain record of
// the values as an own property; give a fact a `value` field; write the value's base64 in the version; write the `Redacted` into the answer as
// plain text.
it.effect.prop(
  "X6 display: [secrets] the store's answer, the hidden value, the contents and the facts show no value through String, JSON, Formatter or inspect, in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const { name, thing } of yield* carriers(value)) {
          expect(showsAny(displays(thing), needles(value)), `${value.id}: ${name}`).toEqual([]);
        }
      }
    }),
  run,
);

// X7. [secrets] Plant: log the value at debug level in a read; log it in the contents' put; give the answer a `toJSON` (a logged carrier shows it).
it.effect.prop(
  "X7 logs: [secrets] no log line at any level, from the flow or from a carrier handed to a log call or an annotation, shows a value in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        const { exit, logs } = yield* watched(
          Effect.gen(function* () {
            const made = yield* carriers(value);

            for (const { name, thing } of made) {
              yield* Effect.logDebug(name, thing);
              yield* Effect.logError(thing);
              yield* Effect.logInfo(name).pipe(Effect.annotateLogs({ carried: thing }));
            }

            return made.length;
          }),
        );

        expect(Exit.isSuccess(exit), `${value.id}: the program ran`).toBe(true);
        expect(logs.length, `${value.id}: the recorder saw the log calls`).toBeGreaterThanOrEqual(
          Exit.isSuccess(exit) ? exit.value * 3 : 1,
        );
        expect(showsAny(logs, needles(value)), `${value.id}: no log line`).toEqual([]);
      }
    }),
  run,
);

// X8. [secrets] Plant: annotate a span with the value in a read; name a span with the value's first characters; give the answer a `toJSON`.
it.effect.prop(
  "X8 spans: [secrets] no span, from the flow or from a carrier set as an attribute or as the failure that ended it, holds a value in its name, its attributes, its events or its end, in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        const { exit, spans } = yield* watched(
          Effect.gen(function* () {
            const made = yield* carriers(value);

            for (const { name, thing } of made) {
              yield* Effect.annotateCurrentSpan("carried", thing).pipe(Effect.withSpan(`probe ${name}`));
              yield* Effect.fail(new Errors.StoreFailed({ cause: Redacted.make(thing) })).pipe(
                Effect.withSpan(`failing ${name}`),
                Effect.exit,
              );
            }

            return made.length;
          }),
        );

        expect(Exit.isSuccess(exit), `${value.id}: the program ran`).toBe(true);
        expect(spans.length, `${value.id}: the recorder saw the spans`).toBeGreaterThanOrEqual(
          Exit.isSuccess(exit) ? exit.value * 2 + 1 : 1,
        );
        expect(showsAny(spans.map(spanText), needles(value)), `${value.id}: no span`).toEqual([]);
      }
    }),
  run,
);

// X9. [secrets] Plant: give the answer a `toString` that returns the value's text (an error that renders its cause shows it); render an error's cause
// with its JSON; put the value's text in the error's message; put `Schema.Redacted(Schema.Defect())` back on `StoreFailed`, or on `RecordFailed`, which
// `Schema.toCodecJson` writes in full.
it.effect.prop(
  "X9 rendered errors: [secrets] StoreFailed and RecordFailed made over a carrier render no value through String, message, stack, JSON, Formatter, inspect or Cause.pretty, in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        // The carriers the flow leaves hide themselves; a cause that quotes the value in plain data, as a store's own client does, does not, and a codec
        // writes it in full unless the cause is hidden for every codec.
        const made = [
          ...(yield* carriers(value)),
          { name: "an error that quotes the value", thing: quoting(value.text) },
        ];

        for (const { name, thing } of made) {
          for (const { schema, error } of writersFrom(thing)) {
            const texts = [
              ...displays(error),
              error.message,
              error.stack ?? "",
              Cause.pretty(Cause.fail(error)),
              Cause.pretty(Cause.die(error)),
              ...written(schema, error),
            ];

            expect(showsAny(texts, needles(value)), `${value.id}: ${error._tag} over ${name}`).toEqual([]);
          }
        }
      }
    }),
  run,
);

// X10. [secrets] Plant: keep the value in a property that JSON and inspect do not list (an own, non-enumerable one on the answer); keep it in
// the cause of the error the store raises; list it in the contents as a plain record.
it.effect.prop(
  "X10 properties: [secrets] no text any own property of a carrier, an error over it, or the cause chain under it reaches holds a value, in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const { name, thing } of yield* carriers(value)) {
          expect(showsAny(reachable(thing), needles(value)), `${value.id}: ${name}`).toEqual([]);

          for (const error of errorsFrom(thing)) {
            const texts = [...reachable(error), ...reachable(Cause.fail(error)), ...reachable(Cause.die(error))];

            expect(showsAny(texts, needles(value)), `${value.id}: ${error._tag} over ${name}`).toEqual([]);
          }
        }
      }
    }),
  // Half the runs of the others: each run reads every carrier and every error over it, and the full count nears the test timeout.
  { arbitrary: { runs: 150, seed: SEED } },
);

// X11. [secrets] Plant: write the cause's text into StoreFailed's message; write it into RecordFailed's message; keep the cause in a
// plain property that is no `Redacted`, so the error under it prints and lists the value; give the error a `toJSON` that returns the
// cause's text; put `Schema.Redacted(Schema.Defect())` back on `StoreFailed`, or on `RecordFailed`, which `Schema.toCodecJson` writes in full.
it.effect.prop(
  "X11 failures: [secrets] a store and a recorder that fail with an error that quotes a value fail with an error that shows no value, in its text, its message, its stack, its JSON, its properties, the cause chain under it, the spans and the logs that carry it",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      const version = Schema.decodeUnknownSync(Name.Version)("1");

      for (const value of values) {
        const failing: ReadonlyArray<{
          readonly name: string;
          readonly run: Effect.Effect<unknown, Errors.StoreFailed | Errors.RecordFailed>;
        }> = [
          { name: "the store", run: holder(failingStore(value.text)).read("app-key", NAME) },
          {
            name: "the recorder",
            run: Recorder.Recorder.use((recorder) =>
              recorder.record(new Recorder.Fetched({ name: NAME, store: STORE_ID, version })),
            ).pipe(Effect.provide(failingRecorder(value.text))),
          },
        ];

        for (const { name, run: failed } of failing) {
          const { exit, spans, logs } = yield* watched(
            failed.pipe(
              Effect.tapError((error) =>
                Effect.annotateCurrentSpan("failed", error).pipe(Effect.andThen(Effect.logError("failed", error))),
              ),
              Effect.withSpan("failing"),
            ),
          );

          expect(Exit.isFailure(exit), `${value.id}: ${name} fails`).toBe(true);

          const errors = Exit.isFailure(exit) ? Option.toArray(Cause.findErrorOption(exit.cause)) : [];

          expect(errors.length, `${value.id}: ${name} fails with an error`).toBe(1);

          const cause = Exit.isFailure(exit) ? [exit.cause] : [];

          const texts = [
            // What the codecs write for each failure, alone and inside an `Exit`, and for the flow's own `Exit`.
            ...errors.flatMap((error) => written(Failures, error)),
            ...writtenExit(Failures, exit),
            ...errors.flatMap((error) => [
              ...displays(error),
              error.message,
              error.stack ?? "",
              ...reachable(error),
              Cause.pretty(Cause.fail(error)),
              Cause.pretty(Cause.die(error)),
            ]),
            ...cause.flatMap((each) => [Cause.pretty(each), ...reachable(each)]),
            ...spans.map(spanText),
            ...logs,
          ];

          expect(showsAny(texts, needles(value)), `${value.id}: ${name}`).toEqual([]);
        }
      }
    }),
  run,
);

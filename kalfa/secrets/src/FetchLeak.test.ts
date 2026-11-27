// The laws that a secret's value shows nowhere once it can be fetched (X1 to X5, and X6 for what a fetch adds): for every flow of a fetch (it works,
// there is nothing to find, the store fails, the recorder fails, the proof is for another secret) and every class of value, the value is looked for in
// every form another system writes it in, in every place it could land: the facts (X1), the spans and what ends them (X2), the logs (X3), the
// rendered errors (X4), the properties of the errors and the cause chain under them (X5), and the display of a declaration, the service and
// the hidden value (X6). A failing store and a failing recorder quote the value in their own error, as a real client does, and a copy of it sits in
// the store of every flow, so a leak has one to show. The scenarios of slice 1 (`Leak.test.ts`) stay as they were.
import { inspect } from "node:util";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Formatter, Layer, Option, Predicate, Redacted, Result, Schema } from "effect";
import * as Errors from "./Errors.ts";
import {
  type Built,
  built,
  type Carrier,
  declare,
  environment,
  FLOW_IDS,
  FLOW_NAME,
  type FlowId,
  fetchAs,
  ITEM,
  memoryDeps,
  proofFor,
} from "./Fetch.test-support.ts";
import * as Recorder from "./Recorder.ts";
import {
  findable,
  parsing,
  THROW_WAYS,
  throwingStore,
  needles,
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

const run = { arbitrary: { runs: 300, seed: SEED } };

/** Every typed failure a fetch gives, as one schema, as an `Exit` that holds one is written. */
const Failures = Schema.Union([Errors.SecretMissing, Errors.SecretsUnavailable]);

/** Every way a program shows a thing as text, hidden properties included. */
const displays = (thing: object): ReadonlyArray<string> => [
  shown(() => String(thing)),
  shown(() => JSON.stringify(thing)),
  shown(() => Formatter.format(thing)),
  shown(() => inspect(thing, { depth: null, showHidden: true })),
];

/** What one flow did, watched whole: the layer's start, the fetch, and what the recorder was given. */
interface Flowed {
  readonly id: FlowId;
  readonly flow: Built;
  readonly result: Exit.Exit<Redacted.Redacted<string>, unknown>;
  readonly facts: ReadonlyArray<Recorder.Fact>;
  readonly spans: ReadonlyArray<import("effect").Tracer.Span>;
  readonly logs: ReadonlyArray<string>;
}

/** Runs one flow for one value under a tracer and a logger that keep everything. */
const flowed = (id: FlowId, value: Value): Effect.Effect<Flowed> =>
  Effect.gen(function* () {
    const { exit, spans, logs } = yield* watched(
      Effect.scoped(
        Effect.gen(function* () {
          const flow = yield* built(id, value.text);
          const result = yield* fetchAs(flow.secret, flow.object).pipe(Effect.provide(flow.context), Effect.exit);

          return { flow, result, facts: yield* flow.facts };
        }),
      ),
    );

    if (Exit.isFailure(exit)) {
      return yield* Effect.die(`${id}: the flow itself failed: ${Cause.pretty(exit.cause).slice(0, 200)}`);
    }

    return { id, ...exit.value, spans, logs };
  });

/** What a flow's fetch must end as: its first value, or the failure it gives. */
const ENDS: Readonly<Record<FlowId, "value" | "SecretMissing" | "SecretsUnavailable" | "defect">> = {
  success: "value",
  missing: "SecretMissing",
  store: "SecretsUnavailable",
  record: "SecretsUnavailable",
  proof: "defect",
};

/** The failures of an exit: its typed error and its defect, as values. */
const failures = (result: Exit.Exit<unknown, unknown>): ReadonlyArray<unknown> =>
  Exit.isFailure(result)
    ? [
        ...Option.toArray(Cause.findErrorOption(result.cause)),
        ...Option.toArray(Result.getSuccess(Cause.findDefect(result.cause))),
      ]
    : [];

/** How a flow ended, in the words of `ENDS`. */
const endedAs = (result: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(result)) {
    return "value";
  }

  const [error] = Option.toArray(Cause.findErrorOption(result.cause));

  return error === undefined ? "defect" : Predicate.hasProperty(error, "_tag") ? String(error._tag) : "untagged";
};

/** Every carrier a flow leaves: the declaration, the service, the contents, the facts, the hidden value, and each failure. */
const carriers = (each: Flowed): ReadonlyArray<Carrier> => [
  ...each.flow.carriers,
  ...each.facts.map((fact) => ({ name: "a fact", thing: fact })),
  ...(Exit.isSuccess(each.result) ? [{ name: "the hidden value", thing: each.result.value }] : []),
  ...failures(each.result).flatMap((failure) =>
    Predicate.isObject(failure) ? [{ name: "the failure", thing: failure }] : [],
  ),
];

/** The flows of one value, each run, and the checks every law shares: every flow is reached, and each ends as the plan says. */
const flows = (value: Value) =>
  Effect.gen(function* () {
    const all = yield* Effect.forEach(FLOW_IDS, (id) => flowed(id, value), { concurrency: 1 });

    for (const each of all) {
      expect(endedAs(each.result), `${value.id}: the ${each.id} flow ends as the plan says`).toBe(ENDS[each.id]);
    }

    return all;
  });

const classIds = (values: ReadonlyArray<Value>): string => values.map((value) => value.id).join("");

// X1. Plant: add a `value` field to `Fetched`; put the value's base64 in the version; record the route's item; write the fact's version from the value's
// text; record a second fact that holds the value in its name.
it.effect.prop(
  "X1 facts: [secrets] every fact the recorder holds after a fetch flow, through JSON, through its Schema's encoding, display and properties, holds no value in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        const all = yield* flows(value);

        expect(
          all.map((each) => each.facts.length),
          `${value.id}: only a fetch that works leaves a fact`,
        ).toEqual(FLOW_IDS.map((id) => (id === "success" ? 1 : 0)));

        for (const each of all) {
          const texts = each.facts.flatMap((fact) => [
            JSON.stringify(fact),
            JSON.stringify(Schema.encodeSync(Recorder.Fetched)(fact)),
            ...displays(fact),
            ...reachable(fact),
          ]);

          expect(showsAny(texts, needles(value)), `${value.id}: ${each.id}`).toEqual([]);
        }
      }
    }),
  run,
);

// X2. Plant: annotate the span with the value; name the span with the value's first eight characters; end a failed span with a failure that quotes the
// value; annotate the span with the store's own error.
it.effect.prop(
  "X2 spans: [secrets] no span of a fetch flow, in its name, attributes, events or end, and no failure text as the tracer writes it, holds a value in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const each of yield* flows(value)) {
          if (each.id !== "proof") {
            expect(
              each.spans.map((span) => span.name),
              `${value.id}: ${each.id}: the flow is traced`,
            ).toContain("secrets.fetch");
          }

          const failed = failures(each.result);

          const texts = [
            ...each.spans.map(spanText),
            ...(Exit.isFailure(each.result) ? [Cause.pretty(each.result.cause)] : []),
            ...failed.flatMap((failure) =>
              failure instanceof Error
                ? [failure.message, failure.stack ?? "", String(failure)]
                : [shown(() => String(failure))],
            ),
          ];

          expect(showsAny(texts, needles(value)), `${value.id}: ${each.id}`).toEqual([]);
        }
      }
    }),
  run,
);

// X3. Plant: `Effect.logDebug` the value after the read; log the store's error at the warning level; log the value when the recorder fails; log the
// fact's version made from the value.
it.effect.prop(
  "X3 logs: [secrets] no log line of a fetch flow, at any level, holds a value in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const each of yield* flows(value)) {
          expect(showsAny(each.logs, needles(value)), `${value.id}: ${each.id}`).toEqual([]);
        }
      }
    }),
  run,
);

// X4. Plant: put the value into `SecretMissing`'s message; put it into the proof defect's message; render the store's cause in `SecretsUnavailable`; give
// the error a `toJSON` that lists the reason's cause; put `Schema.Redacted(Schema.Defect())` back on `RecordFailed`, which `Schema.toCodecJson` writes in full
// where the recorder fails.
it.effect.prop(
  "X4 rendered errors: [secrets] every failure of a fetch flow, through String, message, stack, JSON, Formatter, inspect with hidden properties and Cause.pretty, holds no value in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const each of yield* flows(value)) {
          const failed = failures(each.result);

          expect(
            failed.length > 0,
            `${value.id}: ${each.id}: ${each.id === "success" ? "no failure" : "a failure"}`,
          ).toBe(each.id !== "success");

          const texts = [
            ...(Exit.isFailure(each.result)
              ? [Cause.pretty(each.result.cause), ...writtenExit(Failures, each.result)]
              : []),
            // What the codecs write for each typed failure, alone and inside an `Exit`: a cause hidden from every rendering may still be written in full.
            ...failed.filter(Schema.is(Failures)).flatMap((failure) => written(Failures, failure)),
            ...failed.flatMap((failure) => [
              ...(Predicate.isObject(failure) ? displays(failure) : [shown(() => String(failure))]),
              ...(failure instanceof Error
                ? [
                    failure.message,
                    failure.stack ?? "",
                    Cause.pretty(Cause.fail(failure)),
                    Cause.pretty(Cause.die(failure)),
                  ]
                : []),
            ]),
          ];

          expect(showsAny(texts, needles(value)), `${value.id}: ${each.id}`).toEqual([]);
        }
      }
    }),
  run,
);

// X5. Plant: keep the store's `Found` in `RecordFailed`'s cause when the recorder fails after a read; keep the value in a property of the failure that
// JSON does not list; keep the cause in a plain property; leave the value in a symbol-keyed property.
it.effect.prop(
  "X5 properties: [secrets] no text any own property of a failure of a fetch flow, its reason or the cause chain under it reaches, symbols and getters included, holds a value in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const each of yield* flows(value)) {
          const texts = [
            ...(Exit.isFailure(each.result) ? reachable(each.result.cause) : []),
            ...failures(each.result).flatMap((failure) => (Predicate.isObject(failure) ? reachable(failure) : [])),
          ];

          expect(showsAny(texts, needles(value)), `${value.id}: ${each.id}`).toEqual([]);
        }
      }
    }),
  run,
);

// X6 widened. Plant: give the `Secrets` service a `toJSON` that lists the kept values; give a declaration an own property that holds the value; give the
// hidden value a `toString` that returns it; keep the value in the declaration after a fetch.
it.effect.prop(
  "X6 display of a declaration, the service and a fetched value: [secrets] a declaration, the Secrets service, the contents and the hidden value a fetch gives show no value through String, JSON, Formatter, inspect or their properties, in any form",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const each of yield* flows(value)) {
          const made = carriers(each);

          expect(
            made.map((carrier) => carrier.name),
            `${value.id}: ${each.id}: the carriers the flow leaves`,
          ).toEqual(expect.arrayContaining(["the declaration", "the Secrets service", "the contents"]));

          for (const { name, thing } of made) {
            expect(
              showsAny([...displays(thing), ...reachable(thing)], needles(value)),
              `${value.id}: ${each.id}: ${name}`,
            ).toEqual([]);
          }
        }
      }
    }),
  run,
);

// X12. Plant: pass the store's defect through untouched (the fetch dies with the store's own error, which quotes the value); keep the store's error
// as the cause of a new defect; write the store's message into the new defect's message; turn the defect into a typed failure (the fetch no longer dies).
it.effect.prop(
  "X12 defects: [secrets] a fetch from a store whose read throws an error that quotes a value still dies, and shows no value through Cause.pretty, String, message, stack, JSON, Formatter, inspect with hidden properties, its properties and cause chain, the spans or the logs",
  { texture: valueTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const values = findable(valueClasses(texture));
      expect(classIds(values), "the generator reaches every value class").toBe("cde");

      for (const value of values) {
        for (const way of THROW_WAYS) {
          const thrown = parsing(value.text);

          const { exit, spans, logs } = yield* watched(
            Effect.scoped(
              Effect.gen(function* () {
                const secret = declare(FLOW_NAME);
                const store = throwingStore(thrown, way);

                const context = yield* Layer.build(
                  environment([store], [secret], [{ name: FLOW_NAME, store: store.id, item: ITEM }], memoryDeps()),
                ).pipe(Effect.orDie);

                return yield* fetchAs(secret, proofFor(FLOW_NAME)).pipe(Effect.provide(context), Effect.exit);
              }),
            ),
          );

          if (Exit.isFailure(exit)) {
            return yield* Effect.die(`${value.id}: ${way}: the program itself failed`);
          }

          const result = exit.value;

          expect(
            Exit.isFailure(result) && Cause.hasDies(result.cause) && !Cause.hasFails(result.cause),
            `${value.id}: ${way}: the fetch still dies, a defect stays a defect`,
          ).toBe(true);

          const defects = failures(result);

          // The defect is a StoreFailed that holds the store's own thrown error, hidden, so a person who must read it can.
          expect(
            defects.map((defect) =>
              Schema.is(Errors.StoreFailed)(defect) ? Redacted.value(defect.cause) === thrown : defect,
            ),
            `${value.id}: ${way}: the defect keeps the store's thrown error, hidden`,
          ).toEqual([true]);

          const texts = [
            ...(Exit.isFailure(result) ? [Cause.pretty(result.cause), ...reachable(result.cause)] : []),
            ...defects.flatMap((defect) => [
              ...(Predicate.isObject(defect)
                ? [...displays(defect), ...reachable(defect)]
                : [shown(() => String(defect))]),
              ...(defect instanceof Error ? [defect.message, defect.stack ?? "", Cause.pretty(Cause.die(defect))] : []),
            ]),
            ...spans.map(spanText),
            ...logs,
          ];

          expect(showsAny(texts, needles(value)), `${value.id}: ${way}`).toEqual([]);
        }
      }
    }),
  run,
);

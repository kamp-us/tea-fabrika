import { inspect } from "node:util";
// E2, the two failures a store side has: a store that cannot answer (`StoreFailed`) and a recorder that cannot write (`RecordFailed`). Each is a
// tagged error that keeps its cause, hidden in a `Redacted` that gives it back on purpose, and is caught by its tag.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Formatter, Option, Predicate, Redacted, Schema, type Tracer } from "effect";
import * as Errors from "./Errors.ts";
import * as Name from "./Name.ts";
import {
  acceptedNames,
  acceptedStoreIds,
  causeClasses,
  causes as drawnCauses,
  fieldsOf,
  type Plain,
  marker,
  nameTexture,
  pick,
  reachable,
  SEED,
  showsAny,
  watched,
  wordValue,
  needles,
  written,
} from "./Secrets.test-support.ts";

/** A failure of either kind, typed as the union, so a handler may name either tag. */
const failing = (error: Errors.StoreFailed | Errors.RecordFailed) => Effect.fail(error);

const causes = Arbitrary.all({ word: marker, form: pick(["error", "text", "record"]) });

// E2. Plant: drop the cause from `StoreFailed` (a `mapError` that writes `new StoreFailed({ cause: Redacted.make(undefined) })`); keep the cause in a plain property that is no `Redacted`; give both errors one tag; leave `RecordFailed` out of
// the `Error` family; catch `StoreFailed` with `catchTag("RecordFailed")`.
it.effect.prop(
  "E2 errors: StoreFailed and RecordFailed are errors with their own tags, keep their cause hidden, as the one they were made with, and are caught by their tag and by no other",
  { drawn: causes },
  ({ drawn }) =>
    Effect.gen(function* () {
      const cause = { error: new Error(drawn.word), text: drawn.word, record: { reason: drawn.word } }[drawn.form];

      const store = new Errors.StoreFailed({ cause: Redacted.make(cause) });
      const record = new Errors.RecordFailed({ cause: Redacted.make(cause) });

      expect(store._tag).toBe("StoreFailed");
      expect(record._tag).toBe("RecordFailed");
      expect(store instanceof Error, "an error").toBe(true);
      expect(Schema.is(Errors.StoreFailed)(record), "one is not the other").toBe(false);

      const caught = yield* Effect.fail(store).pipe(
        Effect.catchTag("StoreFailed", (error) => Effect.succeed(error.cause)),
      );

      // The cause is kept hidden, and read on purpose it is the one the error was made with.
      expect(
        [store.cause, record.cause, caught].map((held) => Redacted.isRedacted(held) && Redacted.value(held) === cause),
        "the store's cause, the recorder's, and the one caught by its tag",
      ).toEqual([true, true, true]);

      const passed = yield* failing(record).pipe(
        Effect.catchTag("StoreFailed", () => Effect.succeed("wrong")),
        Effect.exit,
      );

      expect(Exit.isFailure(passed), "the other tag is not caught").toBe(true);
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

// E3. Plant: write the cause's text into the message of `StoreFailed`; the same for `RecordFailed`; keep the cause in a plain property, so its own message
// prints under `[cause]` (a store's client error can quote a value it read); give the error a `toJSON` that returns the cause's text.
it.effect.prop(
  "E3 errors: StoreFailed and RecordFailed hold no text of a cause that quotes a value, in their message, their text, their JSON, their properties or the rendered cause",
  { drawn: causes },
  ({ drawn }) =>
    Effect.sync(() => {
      const cause = {
        error: new Error(`bad value ${drawn.word}`, {
          cause: new Error(`nested ${drawn.word}`, { cause: drawn.word }),
        }),
        text: drawn.word,
        record: { reason: drawn.word, nested: { reason: drawn.word } },
      }[drawn.form];

      for (const [schema, error] of [
        [Errors.StoreFailed, new Errors.StoreFailed({ cause: Redacted.make(cause) })],
        [Errors.RecordFailed, new Errors.RecordFailed({ cause: Redacted.make(cause) })],
      ] as const) {
        const texts = [
          error.message,
          error.stack ?? "",
          String(error),
          JSON.stringify(error),
          Formatter.format(error),
          inspect(error, { depth: 10, showHidden: true }),
          Cause.pretty(Cause.fail(error)),
          Cause.pretty(Cause.die(error)),
          ...reachable(error),
          // The texts the codecs give, alone and inside an `Exit`: a cause hidden from every rendering may still be written in full.
          ...written(schema, error),
        ];

        expect(
          texts.filter((each) => each.includes(drawn.word)),
          `${error._tag} over a ${drawn.form}`,
        ).toEqual([]);
      }
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

// S1. [secrets] Plant: put `Schema.Redacted(Schema.Defect())` back on `StoreFailed`; the same on `RecordFailed`; give `SecretsUnavailable` a `cause` field of its
// own, so a key is written that the plan does not list.
it.effect.prop(
  "S1 errors: [secrets] StoreFailed, RecordFailed and SecretsUnavailable are written as JSON with the placeholder in the cause's place and nothing else new, read back with their tag and fields and an empty hidden cause, and cross inside an Exit",
  { names: nameTexture, drawn: drawnCauses },
  ({ names, drawn }) =>
    Effect.sync(() => {
      const found = needles(wordValue(drawn.word));
      const classes = causeClasses(drawn);
      expect(classes.map((each) => each.id).join(""), "the generator reaches every class").toBe("etrl");

      const secret = Schema.decodeUnknownSync(Name.SecretName)(acceptedNames(names)[0]?.text);
      const store = Schema.decodeUnknownSync(Name.StoreId)(acceptedStoreIds(names)[2]);

      const json = <S extends Plain>(schema: S) => ({
        write: (error: S["Type"]): Schema.Json => Schema.encodeUnknownSync(Schema.toCodecJson(schema))(error),
        read: (wire: Schema.Json): S["Type"] => Schema.decodeUnknownSync(Schema.toCodecJson(schema))(wire),
      });

      const Every = Schema.Union([Errors.StoreFailed, Errors.RecordFailed, Errors.SecretsUnavailable]);

      const crossing = Schema.toCodecJson(Schema.Exit(Schema.Void, Every, Schema.Defect()));

      const empty = (cause: Redacted.Redacted<unknown>): boolean =>
        Redacted.isRedacted(cause) && Redacted.value(cause) === undefined;

      for (const each of classes) {
        const storeFailed = new Errors.StoreFailed({ cause: each.hidden });
        const recordFailed = new Errors.RecordFailed({ cause: each.hidden });

        const failures = [
          {
            reason: storeFailed,
            write: (): Schema.Json => Schema.encodeUnknownSync(Schema.toCodecJson(Errors.StoreFailed))(storeFailed),
            read: (wire: Schema.Json) => Schema.decodeUnknownSync(Schema.toCodecJson(Errors.StoreFailed))(wire),
          },
          {
            reason: recordFailed,
            write: (): Schema.Json => Schema.encodeUnknownSync(Schema.toCodecJson(Errors.RecordFailed))(recordFailed),
            read: (wire: Schema.Json) => Schema.decodeUnknownSync(Schema.toCodecJson(Errors.RecordFailed))(wire),
          },
        ];

        for (const { reason, write, read: readBack } of failures) {
          const named = `${reason._tag} over a ${each.id}`;
          const wire = write();

          expect(fieldsOf(wire), `${named}: written`).toEqual([
            ["_tag", reason._tag],
            ["cause", "<redacted>"],
          ]);

          const read = readBack(wire);
          expect([read._tag, empty(read.cause)], `${named}: read back`).toEqual([reason._tag, true]);

          const unavailable = new Errors.SecretsUnavailable({ secret, store, reason });
          const wrapped = json(Errors.SecretsUnavailable).write(unavailable);

          const held = fieldsOf(wrapped);

          expect(
            held.map(([key]) => key),
            `${named} held by SecretsUnavailable: the keys written`,
          ).toEqual(["_tag", "reason", "secret", "store"]);
          expect(
            held.filter(([key]) => key !== "reason"),
            `${named} held by SecretsUnavailable: the fields written`,
          ).toEqual([
            ["_tag", "SecretsUnavailable"],
            ["secret", secret],
            ["store", store],
          ]);
          expect(
            fieldsOf(held.find(([key]) => key === "reason")?.[1] ?? null),
            `${named} held by SecretsUnavailable: the reason written`,
          ).toEqual([
            ["_tag", reason._tag],
            ["cause", "<redacted>"],
          ]);

          const back = json(Errors.SecretsUnavailable).read(wrapped);
          expect(
            [back._tag, back.secret, back.store, back.reason._tag, empty(back.reason.cause)],
            `${named} held by SecretsUnavailable: read back`,
          ).toEqual(["SecretsUnavailable", secret, store, reason._tag, true]);

          for (const error of [reason, unavailable]) {
            const crossed = Schema.decodeUnknownSync(crossing)(Schema.encodeUnknownSync(crossing)(Exit.fail(error)));

            expect(
              [
                Exit.isFailure(crossed),
                Exit.isFailure(crossed)
                  ? Option.map(Cause.findErrorOption(crossed.cause), (e) => e._tag)
                  : Option.none(),
              ],
              `${error._tag} over a ${each.id}: inside an Exit`,
            ).toEqual([true, Option.some(error._tag)]);
            expect(
              showsAny(written(Every, error), found),
              `${error._tag} over a ${each.id}: the word in what is written`,
            ).toEqual([]);
          }
        }
      }
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

/** What a hidden cause prints as: the placeholder, with its label after a colon when it has one. */
const PLACEHOLDER = /<redacted(:[^>]*)?>/;

/** Every text a failed span's exception shows, as `OtlpTracer` exports it: the failure read through `Cause.prettyErrors` with its cause in the stack. */
const exported = (span: Tracer.Span): ReadonlyArray<string> => {
  const { status } = span;

  return Predicate.isTagged(status, "Ended") && Exit.isFailure(status.exit)
    ? Cause.prettyErrors(status.exit.cause, { includeCauseInStack: true }).flatMap((error) => [
        error.name,
        error.message,
        error.stack ?? "",
      ])
    : [];
};

// S5. [secrets] Plant: drop the line from `SecretsUnavailable`, so the cause is none and the tag check is red; write `cause = Redacted.value(this.reason.cause)`, so a print
// shows the secret's word; make `cause` a schema field of `SecretsUnavailable`, so S1's keys are red.
it.effect.prop(
  "S5 errors: [secrets] SecretsUnavailable's cause is its reason, so a print and a failed span's exception name the failure and end at the placeholder, and show no form of a secret's word",
  { names: nameTexture, drawn: drawnCauses },
  ({ names, drawn }) =>
    Effect.gen(function* () {
      const found = needles(wordValue(drawn.word));
      const classes = causeClasses(drawn);
      expect(classes.map((each) => each.id).join(""), "the generator reaches every class").toBe("etrl");

      const secret = Schema.decodeUnknownSync(Name.SecretName)(acceptedNames(names)[0]?.text);
      const store = Schema.decodeUnknownSync(Name.StoreId)(acceptedStoreIds(names)[2]);

      for (const each of classes) {
        for (const reason of [
          new Errors.StoreFailed({ cause: each.hidden }),
          new Errors.RecordFailed({ cause: each.hidden }),
        ]) {
          const named = `${reason._tag} over a ${each.id}`;
          const error = new Errors.SecretsUnavailable({ secret, store, reason });

          expect(error.cause, `${named}: the cause is the reason`).toBe(reason);

          const printed = Cause.pretty(Cause.fail(error));

          expect(printed, `${named}: a print names the failure`).toContain(`[cause]: ${reason._tag}`);
          expect(printed, `${named}: a print ends at the placeholder`).toMatch(PLACEHOLDER);

          // The span: one that ends with the failure, read as the exporter reads it.
          const { spans } = yield* watched(Effect.exit(Effect.fail(error).pipe(Effect.withSpan("unavailable"))));

          expect(
            spans.map((span) => span.name),
            `${named}: one span`,
          ).toEqual(["unavailable"]);

          const texts = spans.flatMap(exported);

          expect(texts.join("\n"), `${named}: the exception names the failure`).toContain(reason._tag);
          expect(texts.join("\n"), `${named}: the exception ends at the placeholder`).toMatch(PLACEHOLDER);

          // No form of the word shows in any rendering, the exception, the codecs or any property the error reaches.
          expect(
            showsAny(
              [
                ...texts,
                printed,
                error.message,
                error.stack ?? "",
                String(error),
                JSON.stringify(error),
                Formatter.format(error),
                inspect(error, { depth: 10, showHidden: true }),
                Cause.pretty(Cause.die(error)),
                ...reachable(error),
                ...written(Errors.SecretsUnavailable, error),
              ],
              found,
            ),
            `${named}: the word in what the error shows`,
          ).toEqual([]);
        }
      }
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

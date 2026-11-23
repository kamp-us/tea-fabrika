// F1 to F5: the frame a value becomes and the value a frame becomes. A value is one JSON-RPC 2.0 notification, a frame that is
// no such notification fails `decode` with a `FormatError` and never a defect, and a format is a service: a Layer of another
// format replaces JSON-RPC with no change to the stream functions.
import { assert, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Effect, Option, Predicate, Schema, Stream } from "effect";
import { Format, FormatError, Transport } from "./index.ts";
import {
  between,
  echoed,
  parsed,
  recordFrom,
  failureFrom,
  framesFrom,
  LOOSE_CLASSES,
  looseValues,
  Message,
  message,
  FRAME_CLASSES,
  lineFormat,
  refusedFrames,
  seed,
  SEED,
  VALUE_CLASSES,
  valueClasses,
  word,
} from "./Transport.test-support.ts";

const seeds = Arbitrary.array(seed, { minLength: 2, maxLength: 3 });

// F1. Plant: spread the value into `params` (b: a bare string, a number, true, null and an array have no keys to spread); merge
// the value's own `_meta` into the frame's (c); write the value with `JSON.stringify` and no codec (d: a BigInt throws); join two
// values into one frame; write an `id`.
it.effect.prop(
  "F1 one value, one frame: a frame is one JSON-RPC 2.0 notification of the method value whose params hold the codec's writing of the value",
  { seeds },
  ({ seeds: drawn }) =>
    Effect.gen(function* () {
      const classes = valueClasses(drawn);
      expect(
        classes.map(({ name }) => name),
        "every class of values (a) to (d) is reached",
      ).toEqual([...VALUE_CLASSES]);

      for (const { name, schema, values } of classes) {
        const frames = yield* framesFrom(schema, values);
        expect(frames.length, `${name}: one frame for each value`).toBe(values.length);

        frames.forEach((frame, index) => {
          const each = parsed(frame);
          expect(Object.keys(each).sort(), `${name}: the notification has these keys and no other`).toEqual([
            "jsonrpc",
            "method",
            "params",
          ]);
          expect(each.jsonrpc, name).toBe("2.0");
          expect(each.method, name).toBe("value");

          for (const key of ["id", "result", "error"]) {
            expect(Object.hasOwn(each, key), `${name}: no ${key}`).toBe(false);
          }

          assert.isTrue(Predicate.isObject(each.params), `${name}: params is an object`);
          const params = recordFrom(each.params);
          const keys = Object.keys(params);
          expect(
            keys.filter((key) => key !== "_meta"),
            `${name}: params holds the value and nothing else but a _meta`,
          ).toEqual(["value"]);

          const meta = params._meta === undefined ? {} : recordFrom(params._meta);
          expect(
            Object.keys(meta).filter((key) => key === "traceparent" || key === "tracestate"),
            `${name}: a plain encode writes no trace key`,
          ).toEqual([]);

          const written: unknown = Schema.encodeSync(Schema.toCodecJson(schema))(values[index]);
          assert.deepStrictEqual(params.value, written, `${name}: the value is the codec's writing`);
        });
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// F2. Plant: build the frame text by joining strings with hand-written quotes (a: the quotes, backslashes and line breaks break
// it); drop the BigInt codec (d).
it.effect.prop(
  "F2 the round trip: decode of encode gives the same values in the same order",
  { seeds },
  ({ seeds: drawn }) =>
    Effect.gen(function* () {
      for (const { name, schema, values } of valueClasses(drawn)) {
        const back = yield* Stream.fromIterable(values).pipe(
          Transport.encode(schema),
          Transport.decode(schema),
          Stream.runCollect,
        );

        assert.deepStrictEqual(back, [...values], name);
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// F3. Plant: parse with `JSON.parse` and no catch (f is a defect); take a batch's first element (g); skip the own-key read of
// `id`, `result` and `error` (h); take a missing `params.value` as null (i); skip the method compare (j); decode the value with
// `Schema.Unknown` (k).
it.effect.prop(
  "F3 refused frames: text that is no JSON, no one notification, an id or an answer, no value, another method, or a value the schema refuses fails decode with a FormatError of its reason, and never a defect",
  { other: word, n: between(-1_000_000, 1_000_000), cut: between(0, 1_000_000), body: message },
  (drawn) =>
    Effect.gen(function* () {
      const refused = refusedFrames(drawn);
      expect(Arr.dedupe(refused.map(({ klass }) => klass)), "every class (f) to (k) is reached").toEqual([
        ...FRAME_CLASSES,
      ]);

      for (const { name, frame, reason } of refused) {
        const seen: Array<unknown> = [];

        const exit = yield* Stream.make(frame).pipe(
          Transport.decode(Message),
          Stream.runForEach((value) => Effect.sync(() => seen.push(value))),
          Effect.exit,
        );

        const { error, defect } = failureFrom(exit);

        expect(defect, `${name}: never a defect`).toBe(false);
        expect(seen, `${name}: no value comes out`).toEqual([]);
        assert.isTrue(
          Option.isSome(error) && Schema.is(FormatError)(error.value),
          `${name}: it fails with a FormatError`,
        );
        expect(
          Option.map(error, (each) => each.reason),
          name,
        ).toEqual(Option.some(reason));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// F4. Plant: catch the encode failure and write `null` in its place (e); skip `codecFor` and `JSON.stringify` the value (`undefined`
// inside an array becomes `null`, and a function, a symbol and a cycle throw or vanish).
it.effect.prop(
  "F4 a loose schema fails loudly: a value no JSON holds fails encode with a FormatError of value, writes no frame, and is no defect",
  { other: word, n: between(-1_000_000, 1_000_000) },
  (drawn) =>
    Effect.gen(function* () {
      const loose = looseValues(drawn);
      expect(
        loose.map(({ name }) => name),
        "every class (e) is reached",
      ).toEqual([...LOOSE_CLASSES]);

      for (const { name, value } of loose) {
        const frames: Array<string> = [];

        const exit = yield* Stream.make(value).pipe(
          Transport.encode(Schema.Unknown),
          Stream.runForEach((frame) => Effect.sync(() => frames.push(frame))),
          Effect.exit,
        );

        const { error, defect } = failureFrom(exit);

        expect(defect, `${name}: never a defect`).toBe(false);
        expect(frames, `${name}: no frame is written`).toEqual([]);
        expect(
          Option.map(error, (each) => [each._tag, each.reason]),
          name,
        ).toEqual(Option.some(["FormatError", "value"]));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// F5. Plant: make `encode` call the JSON-RPC writer in place of `Format`'s `write`.
it.effect.prop(
  "F5 the format is a service: with a line format in place of JSON-RPC the same chain over the memory pair gives the values back, and no frame it wrote is JSON-RPC",
  { seeds },
  ({ seeds: drawn }) =>
    Effect.gen(function* () {
      for (const { name, schema, values } of valueClasses(drawn)) {
        const frames = yield* framesFrom(schema, values).pipe(Effect.provide(lineFormat));

        for (const frame of frames) {
          const exit = yield* Effect.exit(Format.use((format) => format.read(frame)));
          expect(exit._tag, `${name}: a line is no JSON-RPC frame`).toBe("Failure");
        }

        const back = yield* echoed(schema, values).pipe(Effect.provide(lineFormat));
        assert.deepStrictEqual(back, [...values], name);
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

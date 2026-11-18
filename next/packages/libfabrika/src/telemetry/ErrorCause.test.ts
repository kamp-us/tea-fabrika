// T695, next/. Telemetry's translated errors keep the failure they wrap (decision 0043 rule 12).
// Audit sites: `Trace.ts:123` (`sinkError`, the sink's one thrown-value translation),
// `Archive.ts:21` (a WebCrypto digest that rejects), `Archive.ts:58` (an R2 call that rejects),
// `Archive.ts:68` (a `head` answer that does not decode), `Records.ts:444` (a part's answer that
// does not decode). `Sink.ts:393` needs a database and runs in `node/ErrorCause.test.ts`.
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Match, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { WebCrypto } from "effect/crypto";
import * as fc from "fast-check";
import { Archive, type BucketCalls, sha256 } from "./Archive.ts";
import { rejecting } from "./Crypto.test-support.ts";
import { type RecordCalls, RecordManager } from "./Records.ts";
import { Chain, SinkError, sinkError } from "./Trace.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const RUNS = 100;

const effectOptions = { arbitrary: { runs: RUNS } };

/** A failure as a platform gives one: an Error, a subclass with its own cause, or a plain object. */
const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new TypeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

type GeneratedAnything =
  | { readonly _tag: "undefined" }
  | { readonly _tag: "null" }
  | { readonly _tag: "boolean"; readonly value: boolean }
  | { readonly _tag: "finite"; readonly value: number }
  | { readonly _tag: "nan" }
  | { readonly _tag: "positiveInfinity" }
  | { readonly _tag: "negativeInfinity" }
  | { readonly _tag: "string"; readonly value: string }
  | { readonly _tag: "array"; readonly value: ReadonlyArray<GeneratedAnything> }
  | { readonly _tag: "object"; readonly value: Readonly<Record<string, GeneratedAnything>> };

type Anything =
  | undefined
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Anything>
  | { readonly [key: string]: Anything };

const generatedAnything: Schema.Codec<GeneratedAnything> = Schema.suspend((): Schema.Codec<GeneratedAnything> =>
  Schema.TaggedUnion({
    undefined: {},
    null: {},
    boolean: { value: Schema.Boolean },
    finite: { value: Schema.Finite },
    nan: {},
    positiveInfinity: {},
    negativeInfinity: {},
    string: { value: Schema.String },
    array: {
      value: Schema.Array(Schema.suspend((): Schema.Codec<GeneratedAnything> => generatedAnything)),
    },
    object: {
      value: Schema.Record(
        Schema.String,
        Schema.suspend((): Schema.Codec<GeneratedAnything> => generatedAnything),
      ),
    },
  }),
);

const decodeAnything = (value: GeneratedAnything): Anything =>
  Match.valueTags(value, {
    undefined: () => undefined,
    null: () => null,
    boolean: ({ value }) => value,
    finite: ({ value }) => value,
    nan: () => Number.NaN,
    positiveInfinity: () => Number.POSITIVE_INFINITY,
    negativeInfinity: () => Number.NEGATIVE_INFINITY,
    string: ({ value }) => value,
    array: ({ value }) => value.map(decodeAnything),
    object: ({ value }) =>
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeAnything(entry)])),
  });

const Rejection = Schema.TaggedUnion({
  error: { message: Schema.String },
  typeError: { message: Schema.String },
  object: { code: Schema.String, detail: Schema.Json },
  raw: { value: generatedAnything },
  undefined: {},
});

/** A property over generated input, each run an Effect on the real code. */
const law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown, never>) =>
  it(name, () =>
    fc.assert(
      fc.asyncProperty(input, (value) => Effect.runPromise(check(value))),
      { seed: SEED, numRuns: RUNS },
    ),
  );

/**
 * The typed failure `work` ends with, run on a stand-in crypto whose digest rejects with `failure`,
 * and every body that digest was asked to hash. A defect, or a success, is not a typed failure.
 */
const onRejecting = <A, E>(failure: unknown, work: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const stand = rejecting(failure);
    const exit = yield* Effect.exit(work.pipe(Effect.provide(WebCrypto.layer(stand.crypto))));
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause), "a rejected digest is no defect").toBe(false);
    const error = Exit.findErrorOption(exit);
    expect(Option.isSome(error), "the digest's rejection reached the work as a typed failure").toBe(true);

    return { error: Option.getOrThrow(error), asked: stand.asked };
  });

const put = (body: Uint8Array) => Archive.use((archive) => archive.put("spans/1", body));

const bodies = fc.uint8Array({ maxLength: 64 });

describe("T695, sinkError keeps the thrown value", () => {
  // C1 and C3, Trace.ts:123. Plant: `new SinkError({ reason: ..., held: 0 })` with no cause.
  law(
    "C1: any thrown value, a SchemaError included, becomes a SinkError whose cause is that value",
    fc.record({ failure: failures, raw: fc.jsonValue() }),
    ({ failure, raw }) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.flip(Schema.decodeUnknownEffect(Schema.Struct({ n: Schema.Int }))(raw));

        for (const thrown of [failure, decoded]) {
          const error = sinkError(thrown);
          expect(error.reason).toBe(Schema.isSchemaError(thrown) ? "bad_row" : "storage");
          expect(error.cause).toBe(thrown);
        }
      }),
  );
});

describe("T695, the archive keeps what failed", () => {
  // C1, Archive.ts:21, and M2 and M5 of the mock sweep (0555): the archive hashes through the
  // `WebCrypto` reference, so a stand-in crypto handed in with `WebCrypto.layer` is what it asks.
  // Plants: `const fail = () => new SinkError({ reason: "storage", held: 0 })`; hash
  // `body.slice(1)`, and `asked` is wrong; `Effect.promise` in place of `tryPromise`, and the
  // rejection is a defect; read `globalThis.crypto` in place of the reference, and `asked` is empty.
  // A Promise may reject with anything, `undefined` and other primitives included.
  it.effect.prop(
    "C1: a digest that rejects is `storage` with the rejected value as its cause, on any archive",
    {
      failure: Arbitrary.schema(Rejection).pipe(
        Arbitrary.map(
          Rejection.match({
            error: ({ message }) => new Error(message),
            typeError: ({ message }) => new TypeError(message, { cause: { detail: message } }),
            object: ({ code, detail }) => ({ code, detail }),
            raw: ({ value }) => decodeAnything(value),
            undefined: () => undefined,
          }),
        ),
      ),
      body: Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))), {
        maxLength: 64,
      }).pipe(Arbitrary.map((values) => Uint8Array.from(values))),
      onBucket: Schema.Boolean,
    },
    ({ failure, body, onBucket }) =>
      Effect.gen(function* () {
        const calls: BucketCalls = {
          put: () => Promise.reject(new Error("the archive called the bucket after a failed digest")),
          head: () => Promise.reject(new Error("the archive called the bucket after a failed digest")),
        };

        const archive = onBucket ? Archive.bucket(calls) : Archive.memory;
        const direct = yield* onRejecting(failure, sha256(body));
        const stored = yield* onRejecting(failure, Effect.provide(put(body), archive));

        for (const { error, asked } of [direct, stored]) {
          expect(error.reason).toBe("storage");
          expect(error.cause).toBe(failure);
          // One hash, of exactly the body the archive was given.
          expect(asked).toEqual([body]);
        }
      }),
    effectOptions,
  );

  // C5, Archive.ts:58: one callback serves `put` and `head`. Plant: the zero-argument `fail`.
  law(
    "C5: whichever bucket call rejects, the archive fails `unreachable` with that value as its cause",
    fc.record({ failure: failures, body: bodies, call: fc.constantFrom("put", "head") }),
    ({ failure, body, call }) =>
      Effect.gen(function* () {
        const calls: BucketCalls = {
          put: () => (call === "put" ? Promise.reject(failure) : Promise.resolve()),
          head: () => (call === "head" ? Promise.reject(failure) : Promise.resolve(null)),
        };

        const error = yield* Effect.flip(Effect.provide(put(body), Archive.bucket(calls)));
        expect(error.reason).toBe("unreachable");
        expect(error.cause).toBe(failure);
      }),
  );

  // C3, Archive.ts:68. Plant: `Effect.mapError(() => new SinkError({ reason: "bad_row", held: 0 }))`.
  law(
    "C3: a `head` answer with a damaged hash field is `bad_row` carrying the decoder's SchemaError",
    fc.record({ body: bodies, bad: fc.oneof(fc.integer(), fc.boolean(), fc.array(fc.string())) }),
    ({ body, bad }) =>
      Effect.gen(function* () {
        const calls: BucketCalls = {
          put: () => Promise.resolve(),
          // A valid head is `{ sha256: string }`; this one's hash is the wrong type.
          head: () => Promise.resolve(JSON.parse(JSON.stringify({ sha256: bad }))),
        };

        const error = yield* Effect.flip(Effect.provide(put(body), Archive.bucket(calls)));
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );
});

describe("T695, a remote record part keeps what failed", () => {
  const chain = Chain.cases.spans.make({});

  // C3, Records.ts:444. Plant: `Effect.mapError(() => new SinkError({ reason: "bad_row", held: 0 }))`.
  law(
    "C3: a part's `content` answer with a damaged field is `bad_row` carrying the decoder's SchemaError",
    fc.record({ spanId: fc.string(), bad: fc.oneof(fc.string(), fc.integer()) }),
    ({ spanId, bad }) =>
      Effect.gen(function* () {
        const calls: RecordCalls = {
          write: () => Effect.succeed({ _tag: "written" }),
          read: () => Effect.succeed({ spans: [], after: 0, rolled: false }),
          // A valid answer is `absent { rolled: boolean }`; this one's flag is the wrong type.
          content: () => Effect.succeed({ _tag: "absent", rolled: bad }),
          deleteContent: () => Effect.succeed({ _tag: "absent", rolled: false }),
        };

        const error = yield* Effect.flip(
          Effect.provide(
            RecordManager.use((records) => records.content(chain, spanId)),
            RecordManager.remote(() => calls),
          ),
        );

        expect(error).toBeInstanceOf(SinkError);
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );

  // C4, Records.ts:441: a part's own SinkError passes through. Plant: wrap it as `fail(cause)`.
  law(
    "C4: a SinkError a part fails with comes out as that same object, its cause untouched",
    fc.record({ failure: failures, reason: fc.constantFrom("unreachable", "bad_row", "storage") }),
    ({ failure, reason }) =>
      Effect.gen(function* () {
        const thrown = new SinkError({ reason, held: 0, cause: failure });

        const calls: RecordCalls = {
          write: () => Effect.fail(thrown),
          read: () => Effect.fail(thrown),
          content: () => Effect.fail(thrown),
          deleteContent: () => Effect.fail(thrown),
        };

        const error = yield* Effect.flip(
          Effect.provide(
            RecordManager.use((records) => records.content(chain, "span-1")),
            RecordManager.remote(() => calls),
          ),
        );

        expect(error).toBe(thrown);
        expect(error.cause).toBe(failure);
      }),
  );
});

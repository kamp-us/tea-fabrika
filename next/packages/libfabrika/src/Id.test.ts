// T518, PR 1, next/: TypeID format, Effect failures, writer state, and the public Id export.
// TypeID 0.3.0: https://github.com/jetify-com/typeid/tree/main/spec
// Fabrika deliberately requires UUIDv7 on decode too; the spec permits other versions on decode.
import { describe, expect, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import * as Public from "@kampus/libfabrika";
import { Recorder } from "@kampus/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Str from "effect/String";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import * as fc from "fast-check";
import { bytes, generatorWith } from "./Id.test-support.ts";
import * as Front from "./Id.ts";
import { ProcessId } from "./ProcessId.ts";

const seed = 119120;

const options = { seed, numRuns: 100 };

const effectOptions = { arbitrary: { runs: 40 } };

const scheduleOptions = { arbitrary: { runs: 40, size: 61 } };

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

const maxClock = 2 ** 48 - 1;

const letters = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz");

const text = (minLength: number, maxLength: number) =>
  fc.array(letters, { minLength, maxLength }).map((chars) => Arr.join(chars, ""));

const prefix = fc.oneof(
  letters,
  fc
    .tuple(letters, fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_"), { maxLength: 61 }), letters)
    .map(([first, middle, last]) => first + Arr.join(middle, "") + last),
);

// Each generated family visits every structural edge, including repeated interior underscores.
const prefixShapes = fc
  .tuple(letters, text(2, 62), text(63, 63), letters, letters)
  .map(([single, word, longest, first, last]) => [
    single,
    word,
    longest,
    `${first}_${last}`,
    `${first}__${last}`,
    first + Str.repeat(61)("_") + last,
  ]);

const badPrefixShapes = fc
  .tuple(text(1, 63), text(64, 100), fc.constantFrom(..."0123456789", "-", "/", "é", "\0", " ", "\n"))
  .map(([word, long, bad]) => [
    "", // A8 keeps main's nonempty prefix rule.
    "_",
    `_${word}`,
    `${word}_`,
    Str.toUpperCase(word),
    long,
    // A bad character is refused in the middle and at both ends, so `${word}1` stays refused.
    `${word}${bad}${word}`,
    `${bad}${word}`,
    `${word}${bad}`,
    // T518-PREFIX-EXCEPTION: mutation 13 admitted this invalid prefix; UUIDs stay generated.
    "Stryker was here!",
  ]);

const clock = fc.oneof(fc.constant(0), fc.constant(maxClock), fc.integer({ min: 0, max: maxClock }));

const uuid = fc.tuple(clock, fc.uint8Array({ minLength: 10, maxLength: 10 })).map(([at, random]) => {
  const bytes = Uint8Array.from([
    ...Array.from({ length: 6 }, (_, i) => Number((BigInt(at) >> BigInt((5 - i) * 8)) & 255n)),
    ...random,
  ]);

  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;

  return bytes;
});

// Independent oracle: follow the spec's bit-string recipe, not the generator's shift loop.
const referenceEncode = (bytes: Uint8Array): string => {
  const bits = `00${Arr.join(
    Arr.map([...bytes], (byte) => Str.padStart(8, "0")(byte.toString(2))),
    "",
  )}`;

  return Arr.join(
    Array.from({ length: 26 }, (_, i) => alphabet[Number.parseInt(Str.slice(i * 5, i * 5 + 5)(bits), 2)] ?? ""),
    "",
  );
};

const referenceDecode = (suffix: string): Uint8Array => {
  const bits = Str.slice(2)(
    Arr.join(
      Arr.map([...suffix], (char) => Str.padStart(5, "0")(Option.getOrThrow(Str.indexOf(char)(alphabet)).toString(2))),
      "",
    ),
  );

  return Uint8Array.from({ length: 16 }, (_, i) => Number.parseInt(Str.slice(i * 8, i * 8 + 8)(bits), 2));
};

const wire = (type: string, bytes: Uint8Array): string => (type === "" ? "" : `${type}_`) + referenceEncode(bytes);

const split = (value: string): readonly [string, string] =>
  Option.match(Str.lastIndexOf("_")(value), {
    onNone: (): readonly [string, string] => ["", value],
    onSome: (separator): readonly [string, string] => [Str.slice(0, separator)(value), Str.slice(separator + 1)(value)],
  });

const validPrefix = (type: string): boolean =>
  type.length > 0 &&
  type.length <= 63 &&
  /^[a-z]$/.test(type[0]!) &&
  Option.exists(Str.at(type, -1), (last) => /^[a-z]$/.test(last)) &&
  Arr.every([...type], (char) => Str.includes(char)("abcdefghijklmnopqrstuvwxyz_"));

/** The oracle: `input` is a well-formed ID, of `type` when one is given. A caller with a value that
 *  may be no string at all checks `Predicate.isString` first, since no other value is an ID. */
const accepts = (input: string, type?: string): boolean => {
  const [found, suffix] = split(input);

  if (!validPrefix(found) || (type !== undefined && found !== type)) {
    return false;
  }

  if (found === "" && Str.includes("_")(input)) {
    return false;
  }

  if (suffix.length !== 26 || !Arr.every([...suffix], (char) => Str.includes(char)(alphabet))) {
    return false;
  }

  if (Option.exists(Str.indexOf(suffix[0]!)(alphabet), (index) => index > 7)) {
    return false;
  }

  const bytes = referenceDecode(suffix);

  return bytes[6]! >>> 4 === 7 && bytes[8]! >>> 6 === 2;
};

const canonical = fc.tuple(prefix, uuid).map(([type, bytes]) => wire(type, bytes));

const unknown = fc.oneof(fc.anything(), fc.string(), canonical);

const expectDecoded = <A, E>(exit: Exit.Exit<A, E>, ok: boolean, input: unknown, error: (value: E) => boolean) => {
  expect(Exit.isSuccess(exit)).toBe(ok);

  if (Exit.isSuccess(exit)) {
    expect(exit.value).toBe(input);
  } else {
    expect(exit.cause.reasons.length).toBeGreaterThan(0);

    for (const reason of exit.cause.reasons) {
      expect(Cause.isFailReason(reason)).toBe(true);

      if (Cause.isFailReason(reason)) {
        expect(error(reason.error)).toBe(true);
      }
    }
  }
};

/** The 16 UUID bytes for a clock and a 74-bit random field, packed by RFC 9562 5.7's bit layout. */
const layout = (at: number, random: bigint): Uint8Array => {
  const field = random.toString(2).padStart(74, "0");
  // 48 clock bits, version 0111, the top 12 random bits, variant 10, the low 62 random bits.
  const bits = `${at.toString(2).padStart(48, "0")}0111${field.slice(0, 12)}10${field.slice(12)}`;

  return Uint8Array.from({ length: 16 }, (_, i) => Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2));
};

/** The ids a burst in one millisecond owes from random field `from`: that field, then one more each. */
const burst = (type: string, at: number, from: bigint, count: number): ReadonlyArray<string> =>
  Array.from({ length: count }, (_, k) => wire(type, layout(at, from + BigInt(k))));

const timestamp = (id: string): number =>
  Arr.reduce([...referenceDecode(split(id)[1]).slice(0, 6)], 0, (total, byte) => total * 256 + byte);

const increasing = (ids: ReadonlyArray<string>): void => {
  expect(new Set(ids).size).toBe(ids.length);

  for (let i = 1; i < ids.length; i++) {
    expect(ids[i]! > ids[i - 1]!).toBe(true);
  }
};

const compare = (left: string, right: string): -1 | 0 | 1 => (left < right ? -1 : left > right ? 1 : 0);

/** A random source that fails as the platform's does: it throws. */
const refuses = (marker: string) => (): never => {
  throw new Error(marker);
};

const Time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxClock }));

const Count = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 128 }));

const Prefix = Schema.String.check(Schema.isPattern(/^[a-z](?:[a-z_]{0,61}[a-z])?$/));

const expectIdFailure = <A, E>(exit: Exit.Exit<A, E>, failureReason: string): void => {
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toHaveLength(1);
    const reason = exit.cause.reasons[0]!;
    expect(Cause.isFailReason(reason)).toBe(true);

    if (Cause.isFailReason(reason)) {
      expect(Public.IdError, "IdError is exported from the public package").toBeTypeOf("function");
      expect(reason.error).toBeInstanceOf(Public.IdError);
      expect(reason.error).toMatchObject({ _tag: "IdError", reason: failureReason });
    }
  }
};

describe("T518 Id format", () => {
  it("built-in schemas and the type list keep every declared prefix", () => {
    const builtins = [
      ["ledger", Id.Ledger],
      ["person", Id.Person],
      ["process", Id.Process],
      ["connection", Id.Connection],
      ["tab", Id.Tab],
      ["mailbox", Id.Mailbox],
      ["input", Id.Input],
      ["letter", Id.Letter],
      ["cmd", Id.Cmd],
      ["monitor", Id.Monitor],
      ["entry", Id.Entry],
      ["grant", Id.Grant],
      ["revoke", Id.Revoke],
      ["add", Id.Add],
      ["deny", Id.Deny],
    ] as const;

    fc.assert(
      fc.property(uuid, prefix, (bytes, type) => {
        for (const [name, Specific] of builtins) {
          expect(Schema.is(Id.Type)(name)).toBe(true);
          expect(Specific.prefix).toBe(name);
          const raw = wire(name, bytes);
          expect(Schema.decodeSync(Specific)(raw)).toBe(raw);
          expect(Schema.is(Specific)(wire("", bytes))).toBe(false);
        }

        expect(Schema.is(Id.Type)(type)).toBe(Arr.some(builtins, ([name]) => name === type));
      }),
      options,
    );
  });
  it("the data exports use the one public Id module", () => {
    fc.assert(
      fc.property(prefix, uuid, (type, bytes) => {
        expect(Front).toBe(Id);
        expect(Front.IdError).toBe(Public.IdError);
        const raw = wire(type, bytes);
        expect(Schema.decodeSync(Front.make(type))(raw)).toBe(raw);
      }),
      options,
    );
  });
  it("InputId is a built-in schema with the same checked input format", () => {
    fc.assert(
      fc.property(uuid, unknown, (bytes, input) => {
        expect(Id.InputId, "InputId is built into the Id module").toBeDefined();
        const builtin: typeof Id.Input = Id.InputId;
        expect(Front.InputId).toBe(Id.InputId);

        for (const value of [wire("input", bytes), wire("process", bytes), input]) {
          for (const schema of [builtin, Id.Input, Front.InputId]) {
            expectDecoded(
              Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(schema)(value))),
              Predicate.isString(value) && accepts(value, "input"),
              value,
              Schema.isSchemaError,
            );
          }
        }
      }),
      options,
    );
  });
  it("makeEffect records a named, completed span for valid and invalid generated prefixes", () => {
    fc.assert(
      fc.property(prefix, badPrefixShapes, (type, bad) => {
        for (const name of [type, ...bad]) {
          const spans: Array<Tracer.NativeSpan> = [];

          const tracer = Tracer.make({
            span(options) {
              const span = new Tracer.NativeSpan(options);
              spans.push(span);

              return span;
            },
          });

          const exit = Effect.runSync(Effect.exit(Id.makeEffect(name)).pipe(Effect.withTracer(tracer)));
          expect(Exit.isSuccess(exit)).toBe(validPrefix(name));
          const made = Arr.filter(spans, (span) => span.name === "id.makeEffect");
          expect(made).toHaveLength(1);
          const status = made[0]!.status;
          expect(status._tag).toBe("Ended");

          if (status._tag === "Ended") {
            expect(Exit.isSuccess(status.exit)).toBe(validPrefix(name));
          }
        }
      }),
      options,
    );
  });
  it("decodes independent UUIDv7 encodings for every valid prefix shape", () => {
    fc.assert(
      fc.property(uuid, prefixShapes, prefix, (bytes, shapes, type) => {
        for (const name of [...shapes, type]) {
          const raw = wire(name, bytes);
          expect(Schema.decodeSync(Id.Schema)(raw)).toBe(raw);
          expect(Schema.decodeSync(Id.make(name))(raw)).toBe(raw);
          expect(referenceDecode(split(raw)[1])).toEqual(bytes);
        }
      }),
      options,
    );
  });
  // Plant: the schema hides its format in a refinement that Effect cannot generate from.
  it.effect.prop(
    "Effect Arbitrary generates 200 ids for each prefix that decode only under that prefix",
    { type: Prefix, sampleSeed: Schema.Int },
    ({ type, sampleSeed }) =>
      Effect.gen(function* () {
        const Specific = Id.make(type);
        const Other = Id.make(type === "process" ? "letter" : "process");

        const values = yield* Arbitrary.sampleEffect(Arbitrary.schema(Specific), {
          count: 200,
          seed: sampleSeed,
        });

        expect(values).toHaveLength(200);

        for (const value of values) {
          expect(accepts(value, type)).toBe(true);
          expect(Schema.decodeSync(Specific)(value)).toBe(value);
          expect(Schema.decodeSync(Id.Schema)(value)).toBe(value);
          expectDecoded(yield* Effect.exit(Schema.decodeEffect(Other)(value)), false, value, Schema.isSchemaError);
        }
      }),
    effectOptions,
  );
  it("round trips generated values through the schema encoder and decoder", () => {
    fc.assert(
      fc.property(prefix, uuid, (type, bytes) => {
        const Specific = Id.make(type);
        const value = Specific.make(wire(type, bytes));
        const encoded = Schema.encodeSync(Specific)(value);
        expect(encoded).toBe(wire(type, bytes));
        expect(Schema.decodeSync(Specific)(encoded)).toBe(value);
        expect(Schema.decodeSync(Id.Schema)(Schema.encodeSync(Id.Schema)(value))).toBe(value);
        expect(referenceDecode(split(encoded)[1])).toEqual(bytes);
      }),
      options,
    );
  });
  it("rejects malformed suffixes, overflow, whitespace, versions, and variants without repair", () => {
    fc.assert(
      fc.property(
        prefix,
        uuid,
        fc.integer({ min: 0, max: 25 }),
        fc.integer({ min: 8, max: 31 }),
        fc.integer({ min: 0, max: 15 }).filter((version) => version !== 7),
        fc.constantFrom(0, 1, 3),
        fc.integer({ min: 1 }),
        (type, bytes, index, overflow, version, variant, count) => {
          const raw = wire(type, bytes),
            suffix = referenceEncode(bytes);

          const head = type === "" ? "" : `${type}_`;

          const wrongVersion = bytes.slice(),
            wrongVariant = bytes.slice();

          wrongVersion[6] = (bytes[6]! & 15) | (version << 4);
          wrongVariant[8] = (bytes[8]! & 63) | (variant << 6);

          const bad = [
            Str.toUpperCase(raw),
            head + Str.toUpperCase(suffix),
            head + Str.slice(0, index)(suffix) + Str.slice(index + 1)(suffix),
            `${head + Str.slice(0, index)(suffix)}0${Str.slice(index)(suffix)}`,
            `${raw}0`,
            // A count is never an id: an id is not derived from how many came before it.
            `${head}${count}`,
            `${raw}-${count}`,
            head + alphabet[overflow] + Str.slice(1)(suffix),
            wire(type, wrongVersion),
            wire(type, wrongVariant),
            ...Arr.flatMap([" ", "\t", "\n", "\r\n", "\u00a0"], (space) => [space + raw, raw + space]),
            ...Arr.map(
              ["i", "l", "o", "u", "A", "-", "_", "é", "\0"],
              (char) => head + Str.slice(0, index)(suffix) + char + Str.slice(index + 1)(suffix),
            ),
            ...(type === "" ? [`_${suffix}`] : [type + suffix, `${type}__${suffix}`]),
          ];

          const Specific = Id.make(type);

          for (const value of bad) {
            expect(accepts(value)).toBe(false);
            expectDecoded(
              Effect.runSync(Effect.exit(Schema.decodeEffect(Id.Schema)(value))),
              false,
              value,
              Schema.isSchemaError,
            );
            expectDecoded(
              Effect.runSync(Effect.exit(Schema.decodeEffect(Specific)(value))),
              false,
              value,
              Schema.isSchemaError,
            );
          }
        },
      ),
      options,
    );
  });
  it("keeps prefixes distinct at runtime and refuses an unprefixed UUID", () => {
    fc.assert(
      fc.property(prefix, uuid, (type, bytes) => {
        const other = type === "process" ? "letter" : "process";

        const left = wire(type, bytes),
          right = wire(other, bytes);

        expect(Schema.is(Id.make(type))(left)).toBe(true);
        expect(Schema.is(Id.make(other))(right)).toBe(true);
        expect(Schema.is(Id.Schema)(wire("", bytes))).toBe(false);

        for (const [target, input] of [
          [type, right],
          [other, left],
          ["letter", wire("process", bytes)],
          ["process", wire("letter", bytes)],
        ]) {
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.make(target!))(input))),
            false,
            input,
            Schema.isSchemaError,
          );
        }
      }),
      options,
    );
  });
  it("rejects every invalid prefix shape in the factory and in complete ids", () => {
    fc.assert(
      fc.property(badPrefixShapes, uuid, (bad, bytes) => {
        for (const type of bad) {
          expect(() => Id.make(type)).toThrow();
          const exit = Effect.runSync(Effect.exit(Id.makeEffect(type)));
          expect(Exit.isFailure(exit)).toBe(true);
          expectIdFailure(exit, "prefix");
          expect(Schema.is(Id.Schema)(wire(type, bytes))).toBe(false);
        }
      }),
      options,
    );
  });
  it("makeEffect accepts every valid prefix shape", () => {
    fc.assert(
      fc.property(prefixShapes, uuid, (shapes, bytes) => {
        for (const type of shapes) {
          const Specific = Effect.runSync(Id.makeEffect(type));
          expect(Schema.decodeSync(Specific)(wire(type, bytes))).toBe(wire(type, bytes));
        }
      }),
      options,
    );
  });
  it("unknown decoding never throws or dies, and only non-IDs fail typed", () => {
    fc.assert(
      fc.property(unknown, prefix, (input, type) => {
        expectDecoded(
          Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.Schema)(input))),
          Predicate.isString(input) && accepts(input),
          input,
          Schema.isSchemaError,
        );
        expectDecoded(
          Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.make(type))(input))),
          Predicate.isString(input) && accepts(input, type),
          input,
          Schema.isSchemaError,
        );
      }),
      options,
    );
  });
  it("schema makeEffect keeps invalid strings and unknowns in its typed Issue channel", () => {
    fc.assert(
      fc.property(unknown, prefix, (input, type) => {
        // @ts-expect-error Deliberately test runtime validation beyond the typed constructor input.
        const common = Id.Schema.makeEffect(input);
        // @ts-expect-error Deliberately test runtime validation beyond the typed constructor input.
        const specific = Id.make(type).makeEffect(input);
        expectDecoded(
          Effect.runSync(Effect.exit(common)),
          Predicate.isString(input) && accepts(input),
          input,
          SchemaIssue.isIssue,
        );
        expectDecoded(
          Effect.runSync(Effect.exit(specific)),
          Predicate.isString(input) && accepts(input, type),
          input,
          SchemaIssue.isIssue,
        );
      }),
      options,
    );
  });
  it("trusted make and decodeSync throw on invalid strings", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), canonical), prefix, (input, type) => {
        const Specific = Id.make(type);
        expect(Schema.is(Specific)(input)).toBe(accepts(input, type));

        if (accepts(input)) {
          expect(Id.Schema.make(input)).toBe(input);
          expect(Schema.decodeSync(Id.Schema)(input)).toBe(input);
        } else {
          expect(() => Id.Schema.make(input)).toThrow();
          expect(() => Schema.decodeSync(Id.Schema)(input)).toThrow();
        }

        if (accepts(input, type)) {
          expect(Specific.make(input)).toBe(input);
          expect(Schema.decodeSync(Specific)(input)).toBe(input);
        } else {
          expect(() => Specific.make(input)).toThrow();
          expect(() => Schema.decodeSync(Specific)(input)).toThrow();
        }
      }),
      options,
    );
  });
  it("ProcessId and Id.make(process) accept exactly the same inputs in both directions", () => {
    fc.assert(
      fc.property(unknown, uuid, (input, bytes) => {
        const Specific = Id.make("process");

        const wrongVersion = bytes.slice(),
          wrongVariant = bytes.slice();

        wrongVersion[6] = (bytes[6]! & 15) | 0x40;
        wrongVariant[8] = bytes[8]! & 63;

        for (const value of [
          input,
          wire("process", bytes),
          wire("process", wrongVersion),
          wire("process", wrongVariant),
          wire("letter", bytes),
        ]) {
          const ok = Predicate.isString(value) && accepts(value, "process");
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(ProcessId)(value))),
            ok,
            value,
            Schema.isSchemaError,
          );
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Specific)(value))),
            ok,
            value,
            Schema.isSchemaError,
          );
        }
      }),
      options,
    );
  });
});

describe("T518 Id order and generation", () => {
  it.effect.prop(
    "id.next keeps the generated type on completed success and failure spans",
    { at: Time, type: Prefix },
    ({ at, type }) => {
      const spans: Array<Tracer.NativeSpan> = [];

      const tracer = Tracer.make({
        span(settings) {
          const span = new Tracer.NativeSpan(settings);
          spans.push(span);

          return span;
        },
      });

      return Effect.gen(function* () {
        const Specific = Id.make(type);
        const generator = yield* Id.Generator;
        yield* TestClock.setTime(at);
        expect(accepts(yield* generator.next(Specific), type)).toBe(true);
        yield* TestClock.setTime(-at - 1);
        expectIdFailure(yield* Effect.exit(generator.next(Specific)), "clock");
        const made = Arr.filter(spans, (span) => span.name === "id.next");
        expect(made).toHaveLength(2);

        for (const [index, span] of made.entries()) {
          expect(span.attributes.get("type")).toBe(type);
          expect(span.status._tag).toBe("Ended");

          if (span.status._tag === "Ended") {
            expect(Exit.isSuccess(span.status.exit)).toBe(index === 0);
          }
        }
      }).pipe(Effect.provide(Id.Generator.layer), Effect.withTracer(tracer));
    },
    effectOptions,
  );
  it.effect.prop(
    "unregistered schemas fail typed instead of generating an undefined prefix",
    { at: Time, type: Prefix },
    ({ at, type }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(at);
        const generator = yield* Id.Generator;
        const Unregistered = Schema.String.pipe(Schema.brand("unregistered"));
        expectIdFailure(yield* Effect.exit(generator.next(Unregistered)), "prefix");
        const Specific = Id.make(type);
        const value = yield* generator.next(Specific);
        expect(accepts(value, type)).toBe(true);
        expect(timestamp(value)).toBe(at);
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it.effect.prop(
    "built-in prefixes generate UUIDv7 bursts; empty prefixes fail typed",
    { at: Time, count: Count, type: Id.Type },
    ({ at, count, type }) =>
      Effect.gen(function* () {
        const Specific = Id.make(type);
        const generator = yield* Id.Generator;
        yield* TestClock.setTime(at);

        const ids = yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
          concurrency: 1,
        });

        increasing(ids);
        expect(ids, "a fresh millisecond takes the zero bytes, then counts up").toEqual(burst(type, at, 0n, count));

        for (const id of ids) {
          expect(accepts(id, type)).toBe(true);
          expect(Str.startsWith(`${type}_`)(id)).toBe(true);
          expect(Schema.decodeSync(Specific)(id)).toBe(id);
          expect(timestamp(id)).toBe(at);
        }

        expect(() => Id.make("")).toThrow();
        expectIdFailure(yield* Effect.exit(Id.makeEffect("")), "prefix");
        // T1067 T1: zero bytes from SecureRandom. Plant: draw from `crypto.getRandomValues` again.
      }).pipe(Effect.provide(generatorWith(bytes(0)))),
    effectOptions,
  );
  it("Order compares suffix first, then the whole prefix on ties", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(prefix, uuid), { minLength: 2, maxLength: 40 }),
        uuid,
        prefixShapes,
        (values, tied, shapes) => {
          const ids = Arr.map(
            [...Arr.map(values, ([type, bytes]) => wire(type, bytes)), ...Arr.map(shapes, (type) => wire(type, tied))],
            (raw) => Id.Schema.make(raw),
          );

          const expected = [...ids].sort((left, right) => {
            const [lp, ls] = split(left),
              [rp, rs] = split(right);

            return compare(ls, rs) || compare(lp, rp);
          });

          expect([...ids].sort(Id.Order)).toEqual(expected);

          for (const left of ids) {
            expect(Id.Order(left, left)).toBe(0);

            for (const right of ids) {
              const [lp, ls] = split(left),
                [rp, rs] = split(right);

              expect(Id.Order(left, right)).toBe(compare(ls, rs) || compare(lp, rp));
            }
          }
        },
      ),
      options,
    );
  });
  it.effect.prop(
    "next(schema) encodes the controlled clock and UUIDv7 bits at both clock edges",
    { at: Time, count: Count },
    ({ at, count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("letter");
        const generator = yield* Id.Generator;

        // A repeated millisecond (`at` at an edge) keeps counting from where the last burst stopped.
        let previous = -1,
          from = 0n;

        for (const now of [0, at, maxClock]) {
          from = now > previous ? 0n : from;
          previous = now;
          yield* TestClock.setTime(now);

          const ids = yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
            concurrency: 1,
          });

          increasing(ids);
          expect(ids, "a fresh millisecond takes the zero bytes, then counts up").toEqual(
            burst("letter", now, from, count),
          );
          from += BigInt(count);

          for (const id of ids) {
            expect(accepts(id, "letter")).toBe(true);
            expect(Schema.decodeSync(Specific)(id)).toBe(id);
            expect(timestamp(id)).toBe(now);
          }
        }
        // Zero entropy keeps a burst at the last millisecond inside the clock's range.
        // T1067 T1. Plant: draw from `crypto.getRandomValues` again, and the last millisecond overflows.
      }).pipe(Effect.provide(generatorWith(bytes(0)))),
    effectOptions,
  );
  it.effect.prop(
    "one writer stays strictly increasing across bursts and clock rollback",
    {
      at: Time,
      deltas: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: -1000, maximum: 1000 }))).check(
        Schema.isBetweenLength(2, 30),
      ),
      count: Count,
    },
    ({ at, deltas, count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");
        const generator = yield* Id.Generator;
        const ids: Array<string> = [];
        // Leave room for increments even when a generated entropy value is all ones.
        const start = Math.max(1000, Math.min(at, maxClock - 10_000));

        for (const delta of [0, 0, -1, ...deltas]) {
          const now = Math.max(0, start + delta);
          yield* TestClock.setTime(now);
          expect(yield* Clock.currentTimeMillis).toBe(now);
          ids.push(
            ...(yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
              concurrency: 1,
            })),
          );
        }

        increasing(ids);
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it.effect.prop(
    "exhausted random bits advance the logical clock and keep the UUID layout",
    { at: Time, count: Count },
    ({ at, count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");
        const generator = yield* Id.Generator;
        const now = Math.min(at, maxClock - 1);
        yield* TestClock.setTime(now);

        const ids = yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
          concurrency: 1,
        });

        increasing(ids);
        expect(timestamp(ids[0]!)).toBe(now);

        for (const id of ids.slice(1)) {
          expect(timestamp(id)).toBe(now + 1);
          expect(accepts(id, "process")).toBe(true);
        }
        // T1067 T1: all-ones bytes from SecureRandom. Plant: draw from `crypto.getRandomValues` again.
      }).pipe(Effect.provide(generatorWith(bytes(255)))),
    effectOptions,
  );
  it.effect.prop(
    "out-of-range, fractional and non-finite clocks fail with a typed IdError, even when entropy fails too",
    { extra: Count, marker: Schema.String },
    ({ extra, marker }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");

        // A bad clock is reported as `clock` whether or not entropy works: the clock is checked first.
        // T1067 T3. Plant: check the clock after the draw, and the failing pass answers `entropy`.
        for (const entropy of ["working", "failing"] as const) {
          const layer = entropy === "failing" ? generatorWith(refuses(marker)) : Id.Generator.layer;

          // One past each edge, then generated distances past it.
          for (const now of [
            -1,
            -extra,
            maxClock + 1,
            maxClock + extra,
            Number.MAX_SAFE_INTEGER + extra,
            extra + 0.5,
            Number.NaN,
            Infinity,
          ]) {
            yield* TestClock.setTime(now);

            const exit = yield* Effect.gen(function* () {
              const generator = yield* Id.Generator;

              return yield* generator.next(Specific);
            }).pipe(Effect.provide(layer), Effect.exit);

            expectIdFailure(exit, "clock");
          }
        }
      }),
    effectOptions,
  );
  it.effect.prop(
    "random-bit overflow at the last millisecond fails typed instead of wrapping",
    { count: Count },
    ({ count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");
        const generator = yield* Id.Generator;
        yield* TestClock.setTime(maxClock);
        expect(timestamp(yield* generator.next(Specific))).toBe(maxClock);

        for (let i = 1; i < count; i++) {
          const exit = yield* Effect.exit(generator.next(Specific));
          expectIdFailure(exit, "exhausted");
        }
        // T1067 T1: all-ones bytes from SecureRandom. Plant: draw from `crypto.getRandomValues` again.
      }).pipe(Effect.provide(generatorWith(bytes(255)))),
    effectOptions,
  );
  it.effect.prop(
    "independent layers and writer restarts do not collide on generated schedules",
    {
      at: Time,
      writers: Schema.Int.check(Schema.isBetween({ minimum: 8, maximum: 24 })),
      schedule: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: -100, maximum: 100 }))).check(
        Schema.isBetweenLength(4, 20),
      ),
    },
    ({ at, writers, schedule }) =>
      Effect.gen(function* () {
        const Specific = Id.make("letter");
        const start = Math.min(at, maxClock - 10_000);

        // A collision sample, not a proof. Fresh provide calls build independent layers, including
        // writers restarted on exactly the same schedule. Entropy is real, never stubbed here.
        const batches = yield* Effect.forEach(
          Array.from({ length: writers }),
          () =>
            Effect.gen(function* () {
              const generator = yield* Id.Generator;

              return yield* Effect.forEach(
                [0, 0, -1, ...schedule],
                (delta) =>
                  Effect.gen(function* () {
                    yield* TestClock.setTime(Math.max(0, start + delta));

                    return yield* generator.next(Specific);
                  }),
                { concurrency: 1 },
              );
            }).pipe(Effect.provide(Id.Generator.layer)),
          { concurrency: 1 },
        );

        const ids = batches.flat();
        expect(new Set(ids).size).toBe(ids.length);

        for (const batch of batches) {
          increasing(batch);

          for (const id of batch) {
            expect(accepts(id, "letter")).toBe(true);
          }
        }
      }),
    effectOptions,
  );
  it.effect.prop(
    "an entropy failure is a typed IdError, never a defect",
    { at: Time, marker: Schema.String },
    ({ at, marker }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(at);
        const generator = yield* Id.Generator;
        expectIdFailure(yield* Effect.exit(generator.next(Id.Input)), "entropy");
        // T1067 T2. Plant: drop the draw's `catchDefect`, and the throw is a defect.
      }).pipe(Effect.provide(generatorWith(refuses(marker)))),
    effectOptions,
  );
  it.effect.prop(
    "a fresh millisecond takes its random bits from entropy, and one writer orders ids across prefixes and long rollbacks",
    {
      at: Time,
      raw: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))).check(
        Schema.isBetweenLength(10, 10),
      ),
      rollback: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000_000 })),
      deltas: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: -1000, maximum: 1000 }))).check(
        Schema.isBetweenLength(1, 12),
      ),
    },
    ({ at, raw, rollback, deltas }) =>
      Effect.gen(function* () {
        const generator = yield* Id.Generator;

        const Input = Id.make("input"),
          Chaos = Id.make("chaos");

        // Leave room above the longest rollback, so all-ones entropy never reaches the last millisecond.
        const start = Math.min(at, maxClock - 1_000_010_000);
        const suffixes: Array<string> = [];
        let highest = 0;

        for (const now of [start, start, start + rollback, start, start - 1, ...deltas.map((n) => start + n)]) {
          yield* TestClock.setTime(Math.max(0, now));
          highest = Math.max(highest, Math.max(0, now));

          const input = yield* generator.next(Input),
            chaos = yield* generator.next(Chaos);

          if (suffixes.length === 0) {
            const expected = raw.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n) & ((1n << 74n) - 1n);
            const uuid = [...referenceDecode(split(input)[1])].reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
            const actual = (((uuid >> 64n) & 4095n) << 62n) | (uuid & ((1n << 62n) - 1n));
            expect(actual, "a fresh id uses the supplied entropy, not a count").toBe(expected);
          }

          expect(accepts(input, "input")).toBe(true);
          expect(accepts(chaos, "chaos")).toBe(true);
          expect(timestamp(input)).toBeGreaterThanOrEqual(highest);
          suffixes.push(split(input)[1], split(chaos)[1]);
        }

        // One state serves every prefix: the suffixes alone keep the writer's order.
        increasing(suffixes);
        // T1067 T1: the bytes are `raw`, from SecureRandom. Plant: draw from `crypto.getRandomValues` again.
      }).pipe(
        Effect.provide(generatorWith((size) => Uint8Array.from({ length: size }, (_, i) => raw[i % raw.length]!))),
      ),
    effectOptions,
  );
});

describe("T518 shared Id generator", () => {
  type Schedule = {
    readonly type: string;
    readonly entropy: number;
    readonly batches: ReadonlyArray<{
      readonly at: number;
      readonly work: ReadonlyArray<number>;
    }>;
  };

  /**
   * The ids the generator owes a schedule, in allocation order, written again from RFC 9562's
   * counter method: a fresh millisecond takes the 74 low bits of ten `entropy` bytes, a repeated or
   * rolled-back one counts up, and the all-ones field moves the clock on by one. Every fiber of a
   * batch reads the batch's millisecond, then one later call follows the burst.
   */
  const predicted = (schedule: Schedule): ReadonlyArray<string> => {
    const max = (1n << 74n) - 1n;
    const seed = BigInt(`0x${schedule.entropy.toString(16).padStart(2, "0").repeat(10)}`) & max;

    let at = -1,
      random = 0n;

    const ids: Array<string> = [];

    const one = (now: number) => {
      if (now > at) {
        at = now;
        random = seed;
      } else if (random === max) {
        at++;
        random = 0n;
      } else {
        random++;
      }

      ids.push(wire(schedule.type, layout(at, random)));
    };

    for (const batch of schedule.batches) {
      for (const _ of batch.work) {
        one(batch.at);
      }

      one(batch.at);
    }

    return ids;
  };

  /** What the generated schedules reached, so the law fails loudly when a required case is missing. */
  const reached = { fresh: 0, rollback: 0, overflow: 0 };
  let schedules = 0;

  const lower = Schema.String.check(Schema.isPattern(/^[a-z]$/));
  const middle = Schema.String.check(Schema.isPattern(/^[a-z_]$/));

  const typePrefix = Arbitrary.schema(
    Schema.Union([
      lower,
      Schema.Struct({
        first: lower,
        middle: Schema.Array(middle).check(Schema.isBetweenLength(0, 61)),
        last: lower,
      }),
    ]),
  ).pipe(
    Arbitrary.map((value) =>
      Predicate.isString(value) ? value : `${value.first}${Arr.join(value.middle, "")}${value.last}`,
    ),
  );

  const checkSchedule = (schedule: Schedule) =>
    Effect.gen(function* () {
      const validation = yield* Front.Validation;

      const { returned, recorded } = yield* Effect.gen(function* () {
        const Specific = Id.make(schedule.type);
        const generator = yield* Id.Generator;
        const ids: Array<string> = [];

        for (const batch of schedule.batches) {
          yield* TestClock.setTime(batch.at);
          ids.push(
            ...(yield* Effect.forEach(
              batch.work,
              (work) =>
                Effect.gen(function* () {
                  for (let i = 0; i < work; i++) {
                    yield* Effect.sync(() => {});
                  }

                  return yield* generator.next(Specific);
                }),
              { concurrency: batch.work.length },
            )),
          );
          // A later call must continue the state saved by the concurrent burst.
          ids.push(yield* generator.next(Specific));
        }

        const calls = yield* Recorder.calls(Front.Validation, "decode");

        return { returned: ids, recorded: calls.map(([, encoded]) => encoded) };
      }).pipe(
        Effect.provide(generatorWith(bytes(schedule.entropy))),
        Effect.provide(TestClock.layer()),
        Effect.provide(Recorder.layer(Front.Validation, validation)),
      );

      // The independent model checks the IDs themselves. The Recorder captures the live validation
      // arguments in order, including fibers that finish out of order.
      expect([...returned].sort(compare)).toEqual(predicted(schedule));
      expect([...recorded].sort(compare)).toEqual([...returned].sort(compare));
      increasing(recorded);
      const swapped = [...recorded];
      [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
      expect(() => increasing(swapped), "an adjacent ID swap breaks actual-order checking").toThrow();
      schedule.batches.forEach((batch, i) => {
        const before = schedule.batches[i - 1];
        reached.fresh += before === undefined || batch.at > before.at ? 1 : 0;
        reached.rollback += before !== undefined && batch.at < before.at ? 1 : 0;
      });
      reached.overflow += schedule.entropy === 255 ? 1 : 0;
    });

  // T1067 T4. Plant: in the generator's synchronous step, take a fresh draw whenever one is given,
  // without `now > at`, so fibers that drew for one millisecond each reseed it (T518 review 5 P1);
  // a second plant yields between reading and writing the state.
  it.effect.prop(
    "shared fibers allocate exactly the ids the generator's model owes, unique and increasing, over generated schedules",
    {
      type: typePrefix,
      entropy: Arbitrary.schema(
        Schema.Union([
          Schema.Literals([0]),
          Schema.Literals([255]),
          Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
        ]),
      ),
      batches: Arbitrary.array(
        Arbitrary.all({
          at: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxClock - 1000 }))),
          work: Arbitrary.array(
            Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 2000, maximum: 2070 }))),
            { minLength: 2, maxLength: 8 },
          ),
        }),
        { minLength: 2, maxLength: 6 },
      ),
    },
    (schedule) =>
      Effect.andThen(
        checkSchedule(schedule),
        Effect.sync(() => {
          schedules += 1;
          expect.hasAssertions();

          if (schedules === scheduleOptions.arbitrary.runs) {
            expect(reached.fresh, "a batch on a fresh millisecond").toBeGreaterThan(0);
            expect(reached.rollback, "a batch after the clock moved back").toBeGreaterThan(0);
            expect(reached.overflow, "a schedule on all-ones entropy").toBeGreaterThan(0);
          }
        }),
      ),
    scheduleOptions,
  );
  it.effect("pinned: T518 review 5 P1, four fibers reseed the same millisecond after a scheduler yield", () =>
    checkSchedule({
      type: "process",
      entropy: 0,
      batches: [{ at: 1000, work: [2035, 2035, 2035, 2035] }],
    }),
  );
});

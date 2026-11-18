// next/: TypeIDs with UUIDv7 suffixes. It draws random bits from Effect's SecureRandom;
// `Generator.layer` provides the WebCrypto one.
import type * as Brand from "effect/Brand";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ordering from "effect/Order";
import * as Result from "effect/Result";
import * as S from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

const low62 = (1n << 62n) - 1n;

const maxRandom = (1n << 74n) - 1n;

const maxTime = 2 ** 48 - 1;

export type IdValue<P extends string> = Brand.Branded<string, P>;

export type IdSchema<P extends string> = S.Codec<IdValue<P>, string>;

export class IdError extends S.TaggedError<IdError, { readonly brand: unique symbol }>()("IdError", {
  reason: S.Literals(["prefix", "clock", "entropy", "exhausted"]),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: S.optional(S.Defect()),
}) {}

/** The generator's real format check, which laws may record without replacing a method. */
export interface Validation {
  readonly decode: <P extends string>(schema: IdSchema<P>, encoded: string) => Effect.Effect<IdValue<P>, IdError>;
}

export const Validation = Context.Reference<Validation>("@kampus/libfabrika/Id.Validation", {
  defaultValue: () => ({
    decode: Effect.fnUntraced(function* <P extends string>(schema: IdSchema<P>, encoded: string) {
      const decoded = S.decodeResult(schema)(encoded);

      if (Result.isFailure(decoded)) {
        return yield* IdError.make({ reason: "prefix", cause: decoded.failure });
      }

      return decoded.success;
    }),
  }),
});

const prefixes = new WeakMap<S.Top, string>();

// Fabrika requires a nonempty prefix, with interior underscores and at most 63 characters.
const validPrefix = (prefix: string): boolean => /^[a-z](?:[a-z_]{0,61}[a-z])?$/.test(prefix);

const split = (id: string): readonly [string, string] => {
  const separator = id.lastIndexOf("_");

  return [id.slice(0, Math.max(0, separator)), id.slice(separator + 1)];
};

const valid = (id: string): boolean => {
  const [prefix, suffix] = split(id);

  if (!validPrefix(prefix)) {
    return false;
  }

  if (suffix.length !== 26 || /[^0-9a-hjkmnp-tv-z]/.test(suffix)) {
    return false;
  }

  // The first character has only three bits: the UUID must fit in 128 bits.
  if (alphabet.indexOf(suffix.charAt(0)) > 7) {
    return false;
  }

  const uuid = [...suffix].reduce((bits, char) => (bits << 5n) | BigInt(alphabet.indexOf(char)), 0n);

  return ((uuid >> 76n) & 15n) === 7n && ((uuid >> 62n) & 3n) === 2n;
};

/** Any canonical TypeID containing a UUIDv7. Validation never trims or repairs input. */
export const Schema = S.String.check(S.makeFilter(valid, { expected: "a UUIDv7 TypeID" }));

export type Schema = typeof Schema.Type;

const specific = <const P extends string>(prefix: P) => {
  const a = "[0-9a-hjkmnp-tv-z]";

  const schema = Object.assign(
    S.String.check(S.isPattern(new RegExp(`^${prefix}_[0-7]${a}{9}[ef]${a}{2}[89abrstv]${a}{12}$`))).pipe(
      // Prefixes may come from runtime input; make and makeEffect validate them first.
      S.brand<P>(prefix as Parameters<typeof S.brand<P>>[0]),
    ),
    { prefix } as const,
  );

  prefixes.set(schema, prefix);

  return schema;
};

type Specific<P extends string> = ReturnType<typeof specific<P>>;

/** A schema branded for one trusted prefix. An invalid prefix throws, as Schema.make does. */
export const make = <const P extends string>(prefix: P): Specific<P> => {
  if (!validPrefix(prefix)) {
    throw IdError.make({ reason: "prefix" });
  }

  return specific(prefix);
};

/** The factory for a supplied prefix: invalid prefixes fail with a typed IdError. */
export const makeEffect = Effect.fn("id.makeEffect")(function* <const P extends string>(prefix: P) {
  if (!validPrefix(prefix)) {
    return yield* IdError.make({ reason: "prefix" });
  }

  return specific(prefix);
});

/** Built-in types. Other programs can declare their own prefixes with make. */
export const Type = S.Literals([
  "ledger",
  "person",
  "process",
  "connection",
  "tab",
  "mailbox",
  "input",
  "letter",
  "cmd",
  "monitor",
  "entry",
  "grant",
  "revoke",
  "add",
  "deny",
]);

export type Type = typeof Type.Type;

export const Ledger = make("ledger");

export const Person = make("person");

export const Process = make("process");

export const Connection = make("connection");

export const Tab = make("tab");

export const Mailbox = make("mailbox");

export const Input = make("input");

export const InputId = Input;

export type InputId = typeof InputId.Type;

export const Letter = make("letter");

export const Cmd = make("cmd");

export const Monitor = make("monitor");

export const Entry = make("entry");

export const Grant = make("grant");

export const Revoke = make("revoke");

export const Add = make("add");

export const Deny = make("deny");

/** Compare UUID suffixes first, with the complete prefix breaking ties. */
export const Order = Ordering.make<Schema>((left, right) => {
  const [lp, ls] = split(left),
    [rp, rs] = split(right);

  return Ordering.String(ls, rs) || Ordering.String(lp, rp);
});

const toRandom = (bytes: Uint8Array): bigint => bytes.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n) & maxRandom;

const validClock = (now: number): boolean => Number.isSafeInteger(now) && now >= 0 && now <= maxTime;

// RFC 9562 5.7: 48 clock bits, version 7, 12 random bits, variant 10, 62 random bits.
const encode = (at: number, random: bigint): string => {
  let uuid = (BigInt(at) << 80n) | (7n << 76n) | ((random >> 62n) << 64n) | (2n << 62n) | (random & low62);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = alphabet.charAt(Number(uuid & 31n)) + suffix;
    uuid >>= 5n;
  }

  return suffix;
};

/** One writer's last clock and random bits. `at` only grows. */
interface Last {
  readonly at: number;
  readonly random: bigint;
}

// RFC 9562 6.2, method 2: a fresh millisecond takes `fresh`, a repeated one counts up, and the
// all-ones field moves the clock by one. `undefined` once the last millisecond is used up.
const advance = (last: Last, now: number, fresh: bigint | undefined): Last | undefined => {
  if (now > last.at && fresh !== undefined) {
    return { at: now, random: fresh };
  }

  if (last.random !== maxRandom) {
    return { at: last.at, random: last.random + 1n };
  }

  return last.at === maxTime ? undefined : { at: last.at + 1, random: 0n };
};

/** The generator's service, drawing its random bits from SecureRandom. */
export const makeGenerator: Effect.Effect<Generator["Service"], never, SecureRandom.SecureRandom> = Effect.gen(
  function* () {
    const secure = yield* SecureRandom.SecureRandom;
    const semaphore = yield* Semaphore.make(1);
    let last: Last = { at: -1, random: 0n };

    // A throw from the random source is a defect of SecureRandom; the generator translates it.
    const draw = secure.randomBytes(10).pipe(
      Effect.map(toRandom),
      Effect.catchDefect((cause) => Effect.fail(IdError.make({ reason: "entropy", cause }))),
    );

    return {
      next: Effect.fn("id.next")(function* <P extends string>(schema: IdSchema<P>) {
        const prefix = prefixes.get(schema);

        if (prefix === undefined) {
          return yield* IdError.make({ reason: "prefix" });
        }

        yield* Effect.annotateCurrentSpan({ type: prefix });
        const now = yield* Clock.currentTimeMillis;

        // The clock is checked before any draw, so a bad clock is `clock` even when entropy fails.
        if (!validClock(now)) {
          return yield* IdError.make({ reason: "clock" });
        }

        return yield* semaphore.withPermit(
          Effect.gen(function* () {
            // The permit owns the fresh-clock decision and draw. A queued fiber therefore never
            // consumes entropy for a value that its turn would not use.
            const fresh = now > last.at ? yield* draw : undefined;
            const moved = advance(last, now, fresh);

            if (moved === undefined) {
              return yield* IdError.make({ reason: "exhausted" });
            }

            last = moved;
            const validation = yield* Validation;
            return yield* validation.decode(schema, `${prefix}_${encode(last.at, last.random)}`);
          }),
        );
      }),
    };
  },
);

/** One writer's clock and random state, shared across all its ID types. */
export class Generator extends Context.Service<
  Generator,
  {
    readonly next: <P extends string>(schema: IdSchema<P>) => Effect.Effect<IdValue<P>, IdError>;
  }
>()("@kampus/libfabrika/Id.Generator") {
  // Callers keep one layer that needs nothing; makeGenerator is there for one that picks its source.
  static readonly layer: Layer.Layer<Generator> = Layer.effect(Generator, makeGenerator).pipe(
    Layer.provide(SecureRandom.layerWebCrypto),
  );
}

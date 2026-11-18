import * as Arbitrary from "effect/Arbitrary";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as fc from "fast-check";
import * as Id from "./Id.ts";

const maxClock = 2 ** 48 - 1;

export const processClocks = Arbitrary.schema(
  Schema.Union([Schema.Literals([0, maxClock]), Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxClock }))]),
);

// Encode independently of Id.Generator so these laws also catch an encoder or decoder mistake.
const encodeProcess = (at: number, random: ReadonlyArray<number>): string => {
  const bytes = Uint8Array.from([
    ...Array.from({ length: 6 }, (_, i) => Number((BigInt(at) >> BigInt((5 - i) * 8)) & 255n)),
    ...Arr.map(random, (byte, i) =>
      Match.value(i).pipe(
        Match.when(0, () => (byte & 15) | 0x70),
        Match.when(2, () => (byte & 63) | 0x80),
        Match.orElse(() => byte),
      ),
    ),
  ]);

  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

  const bits = `00${Arr.join(
    Arr.map([...bytes], (byte) => Str.padStart(8, "0")(byte.toString(2))),
    "",
  )}`;

  const suffix = Arr.join(
    Array.from({ length: 26 }, (_, i) => alphabet[Number.parseInt(Str.slice(i * 5, i * 5 + 5)(bits), 2)] ?? ""),
    "",
  );

  return `process_${suffix}`;
};

// Generate the remaining UUIDv7 bits even at both clock limits, where the suffix starts with 0 or 7.
export const processIds = Arbitrary.all({
  at: processClocks,
  random: Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))), {
    minLength: 10,
    maxLength: 10,
  }),
}).pipe(Arbitrary.map(({ at, random }) => encodeProcess(at, random)));

// The same exact UUIDv7 process ids for laws written with fast-check.
export const fcProcessIds: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(fc.constantFrom(0, maxClock), fc.integer({ min: 0, max: maxClock })),
    fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 10, maxLength: 10 }),
  )
  .map(([at, random]) => encodeProcess(at, random));

export const inputParents = Arbitrary.all({
  process: processIds,
  count: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))),
}).pipe(Arbitrary.map(({ process, count }) => `in-${process}-${count}`));

// Keep PR 1's fixtures unbranded, like data/trace.ts's ProcessId.
export const processId: Effect.Effect<string> = Id.Generator.use((ids) => ids.next(Id.Process)).pipe(
  Effect.orDie,
  Effect.provide(Id.Generator.layer),
);

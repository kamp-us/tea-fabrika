// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: law X1, the wrapping round trip, written before
// the build. Every value travels one way underneath, as items in chunk messages, and only the two
// runners see the wrapping (0553).
//
// The contract this law pins, from the plan's "The wrapping, which only the two runners see":
//   runtime/internal/pipeItems.ts: `listed(shape)`, whether a declared shape's top node is a list;
//     `wrap(shape, value)`, a list as its items and anything else as a list of one item; and
//     `unwrap(shape, items)`, by the writer's declared shape: a list comes back as the items, anything
//     else as its one item, and items that cannot be one value's (none, several, or one `null`) are
//     `Option.none()`. `shape` is the port's `Fit.Shape`, made by `Fit.shape(schema)`.
//   runtime/Chunk.ts (on main): `cut` and `join`, the only cutting (0553).
// A top-level `null` is never sent (0260: a selector's `null` is nothing to send), so no generated
// value is `null` at the top; a `null` inside a value is data and must come back.
//
// Plants, each run once after the build: (a) wrap by `Array.isArray` in place of the declared shape;
// (b) unwrap any list of one to its item; (c) join without the last chunk's items: X1 red.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Effect, Option, Result, Schema } from "effect";
import * as fc from "fast-check";
import * as Fit from "../../processes/Fit.ts";
import * as Chunk from "../Chunk.ts";
import * as PipeItems from "./pipeItems.ts";

const SEED = 119120;

type Built = Schema.Codec<unknown, unknown>;

const Row = Schema.Struct({ id: Schema.String, title: Schema.String, n: Schema.Int });
const Noted = Schema.Struct({ id: Schema.String, note: Schema.NullOr(Schema.String) });

/** X1's declared shapes, each with whether it is a list. */
const SHAPES: ReadonlyArray<readonly [string, Built, boolean]> = [
  ["a number", Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), false],
  ["a string", Schema.String, false],
  ["a struct", Row, false],
  ["a struct with a nullable field", Noted, false],
  ["a list", Schema.Array(Row), true],
  ["a list of nullable integers", Schema.Array(Schema.NullOr(Schema.Int)), true],
  ["a list of lists", Schema.Array(Schema.Array(Schema.Int)), true],
  ["anything", Schema.Unknown, false],
];

const copy = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

/** A value as a message carries it: its encoded side through JSON text. */
const encoded = (schema: Built, value: unknown): Option.Option<Schema.Json> => {
  const out = Schema.encodeUnknownResult(schema)(value);

  if (Result.isFailure(out)) {
    return Option.none();
  }

  const text = JSON.stringify(out.success);
  return text === undefined ? Option.none() : Option.some(copy(text));
};

// Effect Arbitrary has no fast-check adapter: one seed draws one value from the schema's own Arbitrary.
const drawn = (schema: Built, seed: number): Option.Option<Schema.Json> => {
  const [value] = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }));
  return encoded(schema, value);
};

/** Edges the plan names, each a value of one of the shapes above. */
const EDGES: ReadonlyArray<readonly [number, Schema.Json, string]> = [
  [4, [], "an empty list"],
  [4, [{ id: "a", title: "one", n: 1 }], "a list of one"],
  [5, [null], "a list of one null"],
  [5, [null, null], "a list of two nulls"],
  [6, [[1, 2], [], [3]], "a list of lists"],
  [7, [1, 2], "anything holding a list"],
  [7, [7], "anything holding a list of one"],
  [
    4,
    Array.from({ length: 120 }, (_, n) => ({ id: `row-${n}`, title: "x".repeat(100), n })),
    "a list that needs more than three chunks",
  ],
];

const Case = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({ at: fc.nat({ max: SHAPES.length - 1 }), seed: fc.nat() }).map(({ at, seed }) => {
      const [label, schema] = SHAPES[at] ?? expect.fail("a shape");
      return { at, value: drawn(schema, seed), label };
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(...EDGES).map(([at, value, label]) => ({ at, value: Option.some(value), label })),
  },
);

describe("Pipe slice 1: the runner's wrapping, next/", () => {
  it("X1: unwrap(shape, join(cut(wrap(shape, value)))) is the value, a list going as its items and anything else as one item", () => {
    // Plants: (a) wrap by Array.isArray; (b) unwrap any list of one to its item; (c) join without the
    // last chunk's items: X1 red.
    const reached = new Set<string>();
    fc.assert(
      fc.property(Case, fc.integer({ min: 1_024, max: 4_096 }), ({ at, value, label }, size) => {
        const [, schema, list] = SHAPES[at] ?? expect.fail("a shape");
        // A top-level null is never sent (0260).
        fc.pre(Option.isSome(value) && value.value !== null);
        const v = Option.getOrThrow(value);
        const shape = Fit.shape(schema);
        expect(PipeItems.listed(shape), `X1: ${label} is ${list ? "" : "not "}a list`).toBe(list);
        const items = PipeItems.wrap(shape, v);
        expect(items, `X1: ${label} goes as ${list ? "its items" : "one item"}`).toEqual(list ? v : [v]);
        const cut = Chunk.cut({ id: "process_T/12/out/rows", type: "rows", items }, size);
        // An item too big for the size is law B1's, not this one's.
        fc.pre(Result.isSuccess(cut));
        const chunks = Result.getOrThrow(cut);
        const joined = Chunk.join(chunks);
        expect(Option.isSome(joined), `X1: ${label}'s chunks join`).toBe(true);
        const back = PipeItems.unwrap(shape, Option.getOrThrow(joined));
        expect(back, `X1: ${label} comes back as it went`).toEqual(Option.some(v));
        reached.add(label);
        reached.add(chunks.length > 3 ? "chunks:many" : `chunks:${chunks.length}`);
      }),
      { seed: SEED, numRuns: runsFor({ fast: 150, full: 500 }) },
    );

    for (const required of [...SHAPES.map(([label]) => label), ...EDGES.map(([, , label]) => label), "chunks:many"]) {
      expect(reached, `X1 reached ${required}`).toContain(required);
    }
  });

  it("X1: items that cannot be one value are no value; a list's items are always its value", () => {
    // Plant (b) turns this red too: a list of one must stay a list.
    const single = Fit.shape(Schema.Int);
    const list = Fit.shape(Schema.Array(Schema.NullOr(Schema.Int)));
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.integer(), fc.constant(null)), { maxLength: 5 }), (items) => {
        expect(PipeItems.unwrap(list, items), "X1: a list's items are its value").toEqual(Option.some(items));
        const one = items.length === 1 && items[0] !== null;
        expect(PipeItems.unwrap(single, items), `X1: ${JSON.stringify(items)} as a single value`).toEqual(
          one ? Option.some(items[0]) : Option.none(),
        );
      }),
      {
        seed: SEED,
        numRuns: runsFor({ fast: 50, full: 200 }),
        examples: [[[]], [[null]], [[7]], [[7, 8]]],
      },
    );
  });
});

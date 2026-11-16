// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: laws F1 to F4 and F6 to F8, the check that a
// pipe fits, written before the build. A pipe is refused before any start when the writer's declared
// shape could send a value the reader's declared shape refuses (0550), and the check reads Effect's
// own persisted schema form (`SchemaRepresentation`), never the code.
//
// The contract these laws pin, from the plan's "The check that a pipe fits" and Amendment A-Fits:
//   processes/Fit.ts: `RULE`, `"fit/v1"`; `Fit`, `fits` or `Unfit`, where `Unfit` is
//     `does_not_fit {path, need, has}` or `cannot_tell {path, shape}` and a path is a list of field
//     names with "[]" for a list's item; `fits(writer, reader)`, pure, on two `Shape`s.
//   A `Shape` is what the loader writes for a port: `{doc, decodes}`, Effect's persisted form of the
//     schema's encoded side and the first path where it decodes through a transformation, or `null`
//     when the persisted form cannot be written (a custom filter with no id).
//   `shape(schema)`: the one function that makes a port's `Shape` from its schema. The plan puts
//     this in the loader (`runtime/Program.ts`'s `shapeOf`); `processes/` may not import `runtime/`,
//     so these laws read it from `Fit.ts`, and the loader calls the same function (law F5 holds the
//     two equal). That is the smallest public entry point an editor needs to check two schemas.
// The oracle of every soundness law is Effect itself: a value Effect's Arbitrary makes from the
// writer's schema, encoded and sent through JSON text as a message carries it, must decode with the
// reader's schema whenever `fits` answers `fits`. No law reads way `fits` walks the shapes.
//
// Each law names its plant. The plants break `processes/Fit.ts`, which the build writes, so each is
// run once after the build, at review.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Effect, Result, Schema, SchemaTransformation } from "effect";
import * as fc from "fast-check";
import * as Fit from "./Fit.ts";

const SEED = 119120;
/** Writer values drawn for each pair a soundness law judges. */
const VALUES = 12;

type Built = Schema.Codec<unknown, unknown>;
type Verdict = typeof Fit.Fit.Type;

// ---------------------------------------------------------------------------------------------
// v1's grammar, as data: a law builds both schemas from one description, so it knows what it made.

type Prim = "string" | "number" | "boolean" | "null";
type Field = { readonly name: string; readonly d: D; readonly optional: boolean };

type D =
  | { readonly k: "prim"; readonly p: Prim }
  | { readonly k: "unknown" }
  | { readonly k: "literal"; readonly v: string | number | boolean }
  | { readonly k: "literals"; readonly vs: ReadonlyArray<string> }
  | { readonly k: "array"; readonly item: D }
  | { readonly k: "struct"; readonly fields: ReadonlyArray<Field> }
  | { readonly k: "nullOr"; readonly d: D }
  | {
      readonly k: "tagged";
      readonly cases: ReadonlyArray<{ readonly tag: string; readonly fields: ReadonlyArray<Field> }>;
    }
  | { readonly k: "union"; readonly ds: ReadonlyArray<D> };

const PRIMS: Record<Prim, Built> = {
  string: Schema.String,
  number: Schema.Number,
  boolean: Schema.Boolean,
  null: Schema.Null,
};

const struct = (fields: ReadonlyArray<Field>): Built =>
  Schema.Struct(
    Object.fromEntries(fields.map((f) => [f.name, f.optional ? Schema.optionalKey(build(f.d)) : build(f.d)])),
  );

const build = (d: D): Built => {
  switch (d.k) {
    case "prim":
      return PRIMS[d.p];
    case "unknown":
      return Schema.Unknown;
    case "literal":
      return Schema.Literal(d.v);
    case "literals":
      return d.vs.length === 1 ? Schema.Literal(d.vs[0] ?? "") : Schema.Literals(d.vs);
    case "array":
      return Schema.Array(build(d.item));
    case "struct":
      return struct(d.fields);
    case "nullOr":
      return Schema.NullOr(build(d.d));
    case "tagged":
      return Schema.Union(
        d.cases.map((c) => struct([{ name: "_tag", d: { k: "literal", v: c.tag }, optional: false }, ...c.fields])),
      );
    case "union":
      return Schema.Union(d.ds.map(build));
  }
};

// Effect Arbitrary has no fast-check adapter: one seed draws values from the schema's own Arbitrary.
const sampled = (schema: Built, seed: number): ReadonlyArray<unknown> =>
  Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: VALUES }));

/** Whether a value survives JSON text unchanged: finite numbers, strings, booleans, null, lists and
 *  plain objects of them, and nothing else. */
const jsonSafe = (value: unknown): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every(jsonSafe)) ||
  (typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(jsonSafe));

/** The message a writer's value becomes: its encoded side, through JSON text. None when it is no JSON. */
const sent = (writer: Built, value: unknown): Result.Result<unknown, string> => {
  const encoded = Schema.encodeUnknownResult(writer)(value);

  if (Result.isFailure(encoded) || !jsonSafe(encoded.success)) {
    return Result.fail("no json");
  }

  return Result.succeed(JSON.parse(JSON.stringify(encoded.success)));
};

/**
 * The soundness property every passing pair must keep: each writer value Effect makes, encoded and
 * sent through JSON text, decodes with the reader. Answers way many values it checked.
 */
const sound = (writer: Built, reader: Built, seed: number, label: string): number => {
  let checked = 0;

  for (const value of sampled(writer, seed)) {
    const message = sent(writer, value);

    if (Result.isFailure(message)) {
      continue;
    }

    checked++;
    const read = Schema.decodeUnknownResult(reader)(message.success);
    expect(
      Result.isSuccess(read),
      `${label}: fits, yet the reader refuses ${JSON.stringify(message.success)}: ${Result.isFailure(read) ? String(read.failure) : ""}`,
    ).toBe(true);
  }

  return checked;
};

const judged = (writer: Built, reader: Built): Verdict => Fit.fits(Fit.shape(writer), Fit.shape(reader));

// ---------------------------------------------------------------------------------------------
// Generators.

const NAMES = ["id", "title", "state", "note", "n", "at", "rows", "kind"] as const;
const WORDS = ["open", "closed", "late", "draft", "done"] as const;

const prim = fc.constantFrom<Prim>("string", "number", "boolean", "null");
const literal = fc.oneof(fc.constantFrom(...WORDS), fc.integer({ min: -3, max: 9 }), fc.boolean());

/** Unique field names, each with a description from `inner`. */
const fieldList = (inner: fc.Arbitrary<D>, min = 1) =>
  fc.uniqueArray(fc.record({ name: fc.constantFrom(...NAMES), d: inner, optional: fc.boolean() }), {
    minLength: min,
    maxLength: 4,
    selector: (f) => f.name,
  });

/** v1's grammar (F1); `unions` adds A-Fits's NullOr, tagged and untagged unions (F6). */
const grammar = (unions: boolean): fc.Arbitrary<D> =>
  fc.letrec<{ d: D }>((tie) => ({
    d: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      prim.map((p): D => ({ k: "prim", p })),
      literal.map((v): D => ({ k: "literal", v })),
      fc.uniqueArray(fc.constantFrom(...WORDS), { minLength: 2, maxLength: 4 }).map((vs): D => ({ k: "literals", vs })),
      tie("d").map((item): D => ({ k: "array", item })),
      fieldList(tie("d")).map((fields): D => ({ k: "struct", fields })),
      ...(unions
        ? [
            tie("d").map((d): D => ({ k: "nullOr", d })),
            fc
              .uniqueArray(
                fc.record({ tag: fc.constantFrom("person", "agent", "bot"), fields: fieldList(tie("d"), 0) }),
                {
                  minLength: 1,
                  maxLength: 3,
                  selector: (c) => c.tag,
                },
              )
              .map((cases): D => ({ k: "tagged", cases })),
            fc
              .array(
                fieldList(tie("d")).map((fields): D => ({ k: "struct", fields })),
                { minLength: 2, maxLength: 3 },
              )
              .map((ds): D => ({ k: "union", ds })),
          ]
        : []),
    ),
  })).d;

/**
 * A reader derived from a writer. A `keep` move gives a reader the writer fits by v1's rules; a
 * `break` move gives one it may not fit. `pick` steers each choice, so one tape is one derivation.
 */
type Move = "keep" | "break";

const derive = (w: D, picks: ReadonlyArray<number>, move: Move, at = { n: 0 }): D => {
  const next = () => picks[at.n++ % Math.max(1, picks.length)] ?? 0;
  const roll = next();

  if (move === "keep" && roll % 9 === 0) {
    return { k: "unknown" };
  }

  switch (w.k) {
    case "prim":
      if (move === "break" && roll % 3 === 0) {
        return { k: "prim", p: w.p === "string" ? "number" : "string" };
      }

      return move === "keep" && roll % 4 === 1 ? { k: "nullOr", d: w } : w;
    case "unknown":
      return w;
    case "literal":
      // A literal fits its own primitive (A-Fits rule 3), and a set that holds it.
      if (move === "keep" && roll % 3 === 1) {
        return { k: "prim", p: typeof w.v === "string" ? "string" : typeof w.v === "number" ? "number" : "boolean" };
      }

      return move === "break" && roll % 3 === 0 ? { k: "literal", v: `${String(w.v)}x` } : w;
    case "literals":
      // Keep: a larger set. Break: drop one the writer can send.
      return move === "keep"
        ? { k: "literals", vs: [...new Set([...w.vs, ...WORDS.slice(roll % WORDS.length)])] }
        : roll % 2 === 0 && w.vs.length > 1
          ? { k: "literals", vs: w.vs.slice(1) }
          : w;
    case "array":
      return { k: "array", item: derive(w.item, picks, move, at) };
    case "nullOr":
      if (move === "break" && roll % 3 === 0) {
        return derive(w.d, picks, "keep", at);
      }

      return { k: "nullOr", d: derive(w.d, picks, move, at) };
    case "struct": {
      const fields = w.fields.flatMap((f): ReadonlyArray<Field> => {
        const r = next();

        // Keep: a reader may need fewer fields, and may make one optional. Break: it may need a
        // field the writer only maybe has.
        if (move === "keep" && r % 4 === 0) {
          return [];
        }

        const optional = move === "keep" ? f.optional || r % 4 === 1 : f.optional && r % 3 !== 0 ? false : f.optional;
        return [{ name: f.name, d: derive(f.d, picks, move, at), optional }];
      });
      const extra = NAMES.find((name) => !w.fields.some((f) => f.name === name));
      // Break: the reader needs a field the writer never has.
      return move === "break" && extra !== undefined && roll % 2 === 0
        ? { k: "struct", fields: [...fields, { name: extra, d: { k: "prim", p: "string" }, optional: false }] }
        : { k: "struct", fields };
    }
    case "tagged": {
      // Keep: every writer case, each derived, and maybe one more. Break: drop a writer case.
      const cases = w.cases.map((c) => ({
        tag: c.tag,
        fields: derive({ k: "struct", fields: c.fields }, picks, move, at),
      }));
      const kept = cases.map((c) => ({ tag: c.tag, fields: c.fields.k === "struct" ? c.fields.fields : [] }));
      const more = ["person", "agent", "bot"].find((tag) => !w.cases.some((c) => c.tag === tag));
      return move === "keep"
        ? { k: "tagged", cases: more !== undefined && roll % 2 === 0 ? [...kept, { tag: more, fields: [] }] : kept }
        : { k: "tagged", cases: kept.length > 1 && roll % 2 === 0 ? kept.slice(1) : kept };
    }
    case "union":
      return { k: "union", ds: w.ds.map((d) => derive(d, picks, move, at)) };
  }
};

const Pair = (unions: boolean) =>
  fc.record({
    writer: grammar(unions),
    move: fc.constantFrom<Move>("keep", "keep", "break"),
    picks: fc.array(fc.nat({ max: 1_000 }), { minLength: 1, maxLength: 24 }),
    seed: fc.nat(),
  });

/** Names the kinds a description holds, for the coverage a law requires. */
const kinds = (d: D, into = new Set<string>()): Set<string> => {
  into.add(d.k === "prim" ? d.p : d.k);

  switch (d.k) {
    case "array":
      kinds(d.item, into);
      break;
    case "struct":
      for (const f of d.fields) {
        if (f.optional) {
          into.add("optional");
        }

        kinds(f.d, into);
      }

      break;
    case "nullOr":
      kinds(d.d, into);
      break;
    case "tagged":
      for (const f of d.cases.flatMap((c) => c.fields)) {
        kinds(f.d, into);
      }

      break;
    case "union":
      for (const x of d.ds) {
        kinds(x, into);
      }

      break;
    default:
      break;
  }

  return into;
};

describe("Pipe slice 1: a pipe fits on the two declared shapes, next/", () => {
  it("F1: a pipe that fits is sound: every value the writer's schema makes, encoded and sent as JSON, decodes with the reader's schema", () => {
    // Plants: (a) let an extra reader field through as fine; (b) treat a literal set as fitting a
    // smaller set: F1 red.
    const reached = new Set<string>();
    fc.assert(
      fc.property(Pair(false), ({ writer, move, picks, seed }) => {
        const reader = derive(writer, picks, move);
        const verdict = judged(build(writer), build(reader));
        reached.add(verdict._tag);

        if (verdict._tag !== "fits") {
          return;
        }

        const checked = sound(build(writer), build(reader), seed, `F1 ${JSON.stringify({ writer, reader })}`);

        if (checked > 0) {
          for (const kind of kinds(writer)) {
            reached.add(`fits:${kind}`);
          }
        }
      }),
      { seed: SEED, numRuns: runsFor({ fast: 60, full: 200 }) },
    );

    // Coverage: passes and refusals both, and a passing value of each kind of v1's grammar.
    for (const required of [
      "fits",
      "does_not_fit",
      "fits:string",
      "fits:number",
      "fits:literal",
      "fits:literals",
      "fits:array",
      "fits:struct",
      "fits:optional",
    ]) {
      expect(reached, `F1 reached ${required}`).toContain(required);
    }
  });

  it("F1: the plan's vectors answer as the plan writes them", () => {
    // Plant: either plant of F1 turns one of these red as well.
    const Str = Schema.String;
    const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
    const cases: ReadonlyArray<readonly [Built, Built, Verdict["_tag"], ReadonlyArray<string>?]> = [
      // Extra `state` is fine.
      [
        Schema.Array(Schema.Struct({ id: Str, title: Str, state: Str })),
        Schema.Array(Schema.Struct({ id: Str, title: Str })),
        "fits",
      ],
      // A missing need.
      [
        Schema.Array(Schema.Struct({ id: Str, title: Str })),
        Schema.Array(Schema.Struct({ id: Str, column: Str })),
        "does_not_fit",
        ["[]", "column"],
      ],
      // A smaller literal set fits a larger one.
      [
        Schema.Array(Schema.Struct({ state: Schema.Literals(["open", "closed"]) })),
        Schema.Array(Schema.Struct({ state: Schema.Literals(["open", "closed", "late"]) })),
        "fits",
      ],
      // One value on both ends, no list anywhere.
      [TicketNumber, TicketNumber, "fits"],
      // A number is no list.
      [TicketNumber, Schema.Array(TicketNumber), "does_not_fit", []],
      // A reader of anything takes a list too.
      [Schema.Array(Schema.Struct({ id: Str })), Schema.Unknown, "fits"],
    ];

    fc.assert(
      fc.property(fc.constantFrom(...cases), ([writer, reader, tag, path]) => {
        const verdict = judged(writer, reader);
        expect(verdict._tag, `F1 vector ${String(writer.ast._tag)} into ${String(reader.ast._tag)}`).toBe(tag);

        if (path !== undefined && verdict._tag !== "fits") {
          expect(verdict.path).toEqual(path);
        }
      }),
      { seed: SEED, numRuns: cases.length * 4 },
    );
    expect(Fit.RULE).toBe("fit/v1");
  });

  it("F2: removing a field the reader needs answers does_not_fit at that field's path, has missing; making it optional answers has optional", () => {
    // Plants: (a) skip nested structs; (b) report the parent's path: F2 red.
    /** The required leaves a reader needs: each path, and way to drop or loosen it on the writer. */
    type Need = { readonly path: ReadonlyArray<string>; readonly edit: (way: "drop" | "optional") => D };
    const needs = (d: D, path: ReadonlyArray<string>, rebuild: (next: D) => D): ReadonlyArray<Need> => {
      switch (d.k) {
        case "array":
          return needs(d.item, [...path, "[]"], (item) => rebuild({ k: "array", item }));
        case "struct":
          return d.fields.flatMap((f, n) => {
            const replace = (next: ReadonlyArray<Field>) => rebuild({ k: "struct", fields: next });
            const own: ReadonlyArray<Need> = f.optional
              ? []
              : [
                  {
                    path: [...path, f.name],
                    edit: (way) =>
                      replace(
                        way === "drop"
                          ? d.fields.filter((_, m) => m !== n)
                          : d.fields.map((g, m) => (m === n ? { ...g, optional: true } : g)),
                      ),
                  },
                ];
            return [
              ...own,
              ...needs(f.d, [...path, f.name], (inner) =>
                replace(d.fields.map((g, m) => (m === n ? { ...g, d: inner } : g))),
              ),
            ];
          });
        default:
          return [];
      }
    };
    // Shapes with required fields at every depth: structs of structs, and lists of them.
    const Nested: fc.Arbitrary<D> = fc.letrec<{ d: D }>((tie) => ({
      d: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        prim.map((p): D => ({ k: "prim", p })),
        fieldList(tie("d")).map((fields): D => ({ k: "struct", fields })),
        fieldList(tie("d")).map((fields): D => ({ k: "array", item: { k: "struct", fields } })),
      ),
    })).d;
    const depths = new Set<number>();
    const hows = new Set<string>();
    fc.assert(
      fc.property(Nested, fc.nat(), fc.constantFrom<"drop" | "optional">("drop", "optional"), (writer, pick, way) => {
        const found = needs(writer, [], (d) => d);
        fc.pre(found.length > 0);
        const need = found[pick % found.length] ?? expect.fail("a need");
        expect(judged(build(writer), build(writer))._tag, "F2: a shape fits itself").toBe("fits");
        const verdict = judged(build(need.edit(way)), build(writer));
        expect(verdict, `F2 ${way} ${JSON.stringify(need.path)} of ${JSON.stringify(writer)}`).toMatchObject({
          _tag: "does_not_fit",
          path: need.path,
          has: way === "drop" ? "missing" : "optional",
        });
        depths.add(need.path.filter((p) => p !== "[]").length);
        hows.add(way);
      }),
      {
        seed: SEED,
        numRuns: runsFor({ fast: 60, full: 200 }),
        // The plan's own vector: board's row needs `column`, which tracker's has none of.
        examples: [
          [
            {
              k: "array",
              item: {
                k: "struct",
                fields: [
                  { name: "id", d: { k: "prim", p: "string" }, optional: false },
                  { name: "kind", d: { k: "prim", p: "string" }, optional: false },
                ],
              },
            },
            1,
            "drop",
          ],
        ],
      },
    );
    // Coverage: a need in the top struct (or the top list's item), one inside a nested struct, each way.
    expect(
      [...depths].some((d) => d >= 2),
      "F2 reached a need inside a nested struct",
    ).toBe(true);
    expect(depths, "F2 reached a top-level need").toContain(1);
    expect(hows).toEqual(new Set(["drop", "optional"]));
  });

  it("F3 scenario: one reader shape per construct v1 cannot compare, each answers cannot_tell at its path even when the writer's shape is the same", () => {
    // Plant: answer `fits` for two equal shapes: F3 red. A scenario, since each case is one named
    // construct of the plan's list (as amended by A-Fits), not a value drawn from a space.
    interface Tree {
      readonly kids: ReadonlyArray<Tree>;
    }
    const Tree: Schema.Codec<Tree> = Schema.Struct({
      kids: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree)),
    });
    const inRow = (x: Built): Built => Schema.Array(Schema.Struct({ id: Schema.String, x }));
    const foreign = Schema.String.check(
      Schema.makeFilter((s: string) => s.length > 0, { representation: { id: "pack/isTicket", payload: null } }),
    );
    const custom = Schema.String.check(Schema.makeFilter((s: string) => s.length > 0));
    const cases: ReadonlyArray<readonly [string, Built, ReadonlyArray<string>]> = [
      ["a Declaration (a date)", inRow(Schema.Date), ["[]", "x"]],
      ["recursion (Suspend)", Tree, []],
      ["a tuple", inRow(Schema.Tuple([Schema.String, Schema.Number])), ["[]", "x"]],
      ["a NonEmptyArray", inRow(Schema.NonEmptyArray(Schema.String)), ["[]", "x"]],
      ["a record", inRow(Schema.Record(Schema.String, Schema.Number)), ["[]", "x"]],
      ["a template literal", inRow(Schema.TemplateLiteral(["run-", Schema.Number])), ["[]", "x"]],
      ["an Enum", inRow(Schema.Enum({ A: "a", B: "b" })), ["[]", "x"]],
      ["a reader transformation", inRow(Schema.DateTimeUtcFromString), ["[]", "x"]],
      ["a check id that is not Effect's", inRow(foreign), ["[]", "x"]],
      // A custom filter has no persisted form at all, so the whole port cannot tell, at the top.
      ["a custom filter", inRow(custom), []],
    ];

    for (const [label, schema, path] of cases) {
      const verdict = judged(schema, schema);
      expect(verdict._tag, `F3: ${label} into itself`).toBe("cannot_tell");
      expect(verdict._tag === "cannot_tell" ? verdict.path : null, `F3: ${label}'s path`).toEqual(path);
    }

    expect(Fit.shape(custom), "F3: a custom filter's port has no persisted shape").toBeNull();
  });

  it("F4: a reader check the writer does not carry answers cannot_tell; a writer with more checks than the reader fits, and is sound", () => {
    // Plant: ignore checks: F4 red.
    type Check = "isInt" | "isGreaterThanOrEqualTo" | "isMinLength" | "isMaxLength" | "isPattern";
    const NUMBER: ReadonlyArray<Check> = ["isInt", "isGreaterThanOrEqualTo"];
    const STRING: ReadonlyArray<Check> = ["isMinLength", "isMaxLength", "isPattern"];
    const numberCheck = (check: Check) => (check === "isInt" ? Schema.isInt() : Schema.isGreaterThanOrEqualTo(1));
    const stringCheck = (check: Check) =>
      check === "isMinLength"
        ? Schema.isMinLength(1)
        : check === "isMaxLength"
          ? Schema.isMaxLength(64)
          : Schema.isPattern(/^[a-z]+$/);
    const checked = (base: "number" | "string", checks: ReadonlyArray<Check>): Built => {
      if (base === "number") {
        const [first, ...rest] = checks.map(numberCheck);
        return first === undefined ? Schema.Number : Schema.Number.check(first, ...rest);
      }

      const [first, ...rest] = checks.map(stringCheck);
      return first === undefined ? Schema.String : Schema.String.check(first, ...rest);
    };
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        fc.constantFrom<"number" | "string">("number", "string").chain((base) => {
          const set = base === "number" ? NUMBER : STRING;
          return fc.record({
            base: fc.constant(base),
            writer: fc.subarray([...set]),
            reader: fc.subarray([...set]),
            seed: fc.nat(),
          });
        }),
        ({ base, writer, reader, seed }) => {
          const verdict = judged(checked(base, writer), checked(base, reader));
          const carried = reader.every((c) => writer.includes(c));
          expect(verdict._tag, `F4 ${base} ${JSON.stringify(writer)} into ${JSON.stringify(reader)}`).toBe(
            carried ? "fits" : "cannot_tell",
          );

          if (carried) {
            sound(checked(base, writer), checked(base, reader), seed, "F4");
            reached.add(writer.length > reader.length ? "more" : "same");
          } else {
            reached.add("missing");
          }
        },
      ),
      { seed: SEED, numRuns: runsFor({ fast: 40, full: 100 }) },
    );
    expect(reached).toEqual(new Set(["more", "same", "missing"]));
  });

  it("F6: unions are sound: NullOr, tagged and untagged unions and literal sets on both ends; a writer case the reader takes nowhere is does_not_fit, and a oneOf reader union is cannot_tell", () => {
    // Plants: (a) pass a writer union when one case fits; (b) compare checks before the kind, so a
    // null case answers cannot_tell: F6 red.
    const reached = new Set<string>();
    fc.assert(
      fc.property(Pair(true), ({ writer, move, picks, seed }) => {
        const reader = derive(writer, picks, move);
        const verdict = judged(build(writer), build(reader));
        reached.add(verdict._tag);

        if (verdict._tag === "fits") {
          const checked = sound(build(writer), build(reader), seed, `F6 ${JSON.stringify({ writer, reader })}`);

          if (checked > 0) {
            for (const kind of kinds(writer)) {
              reached.add(`fits:${kind}`);
            }
          }
        }
      }),
      { seed: SEED, numRuns: runsFor({ fast: 60, full: 200 }) },
    );

    for (const required of ["fits", "does_not_fit", "fits:nullOr", "fits:tagged", "fits:union"]) {
      expect(reached, `F6 reached ${required}`).toContain(required);
    }

    // The plan's union vectors, each a pinned case of the rule above.
    const Str = Schema.String;
    const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
    const From = Schema.TaggedUnion({ person: { name: Str }, agent: { lane: Str } });
    const FromMore = Schema.TaggedUnion({ person: { name: Str }, agent: { lane: Str }, bot: {} });
    expect(
      judged(Schema.Struct({ input: Schema.NullOr(Count) }), Schema.Struct({ input: Schema.NullOr(Count) })),
    ).toEqual({
      _tag: "fits",
    });
    expect(judged(Schema.Struct({ input: Schema.NullOr(Count) }), Schema.Struct({ input: Count }))).toMatchObject({
      _tag: "does_not_fit",
      path: ["input"],
    });
    expect(judged(From, FromMore)).toEqual({ _tag: "fits" });
    expect(judged(FromMore, From)).toMatchObject({ _tag: "does_not_fit", path: ["_tag"] });
    expect(judged(Schema.Struct({ reason: Schema.Literal("out_of_range") }), Schema.Struct({ reason: Str }))).toEqual({
      _tag: "fits",
    });
    // A oneOf reader union is cannot_tell, even when the writer is one of its cases.
    expect(judged(Str, Schema.Union([Str, Schema.Number], { mode: "oneOf" }))).toMatchObject({
      _tag: "cannot_tell",
      path: [],
    });
  });

  it("F7: a reader field that decodes through a transformation answers cannot_tell at its path, while the same schema on the writer compares on its encoded side", () => {
    // Plant: read only the encoded document, with no `decodes`: a writer String into a reader
    // DateTimeUtcFromString passes, F7 red.
    const TRANSFORMS: ReadonlyArray<readonly [string, Built]> = [
      ["DateTimeUtcFromString", Schema.DateTimeUtcFromString],
      ["NumberFromString", Schema.NumberFromString],
      ["Trim", Schema.Trim],
      ["decodeTo", Schema.String.pipe(Schema.decodeTo(Schema.Finite, SchemaTransformation.numberFromString))],
    ];
    const nest = (path: ReadonlyArray<string>, leaf: Built): Built =>
      path.reduceRight<Built>((inner, name) => Schema.Struct({ [name]: inner, other: Schema.String }), leaf);
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        fc.constantFrom(...TRANSFORMS),
        fc.array(fc.constantFrom(...NAMES), { minLength: 1, maxLength: 4 }),
        fc.nat(),
        ([name, transform], path, seed) => {
          const reader = nest(path, transform);
          const verdict = judged(nest(path, Schema.String), reader);
          expect(verdict, `F7: a writer String into a reader ${name} at ${JSON.stringify(path)}`).toMatchObject({
            _tag: "cannot_tell",
            path,
          });
          // On the writer, the transformation is what it sends: a string.
          const writer = nest(path, transform);
          const back = judged(writer, nest(path, Schema.String));
          expect(back._tag, `F7: a writer ${name} into a reader String`).toBe("fits");
          sound(writer, nest(path, Schema.String), seed, `F7 ${name}`);
          reached.add(name);
          reached.add(`depth:${Math.min(path.length, 3)}`);
        },
      ),
      { seed: SEED, numRuns: runsFor({ fast: 40, full: 100 }) },
    );

    for (const required of [...TRANSFORMS.map(([name]) => name), "depth:1", "depth:3"]) {
      expect(reached, `F7 reached ${required}`).toContain(required);
    }
  });

  it("F8: Effect's own checks with equal payloads fit in any order; a differing payload or a foreign id answers cannot_tell, even on equal ends", () => {
    // Plants: (a) compare ids without payloads (isMaxLength 10 against 256); (b) trust any equal
    // id: F8 red.
    type Spec = { readonly id: "min" | "max" | "pattern"; readonly n: number };
    const one = (s: Spec) =>
      s.id === "min"
        ? Schema.isMinLength(s.n)
        : s.id === "max"
          ? Schema.isMaxLength(s.n)
          : Schema.isPattern(new RegExp(`^[a-z]{0,${s.n}}$`));
    const FOREIGN = Schema.makeFilter((s: string) => s !== "x", {
      representation: { id: "pack/isTicket", payload: null },
    });
    const checkedString = (specs: ReadonlyArray<Spec>, foreign: boolean): Built => {
      const checks = [...specs.map(one), ...(foreign ? [FOREIGN] : [])];
      const [first, ...rest] = checks;
      return first === undefined ? Schema.String : Schema.String.check(first, ...rest);
    };
    const Specs = fc.uniqueArray(
      fc.record({ id: fc.constantFrom<Spec["id"]>("min", "max", "pattern"), n: fc.constantFrom(1, 10, 256) }),
      { maxLength: 3, selector: (s) => s.id },
    );
    const reached = new Set<string>();
    fc.assert(
      fc.property(Specs, fc.boolean(), fc.nat(), fc.boolean(), fc.nat(), (reader, widen, shuffle, foreign, seed) => {
        // The writer carries every reader check, in another order, and maybe one more; or one
        // check's payload differs.
        const rotated = [
          ...reader.slice(shuffle % Math.max(1, reader.length)),
          ...reader.slice(0, shuffle % Math.max(1, reader.length)),
        ];
        const differ = !widen && reader.length > 0;
        const writer = differ
          ? rotated.map((s, n) => (n === 0 ? { ...s, n: s.n === 10 ? 256 : 10 } : s))
          : widen && !reader.some((s) => s.id === "min")
            ? [...rotated, { id: "min" as const, n: 1 }]
            : rotated;
        const verdict = judged(checkedString(writer, foreign), checkedString(reader, foreign));
        const expected = foreign || differ ? "cannot_tell" : "fits";
        expect(verdict._tag, `F8 ${JSON.stringify({ writer, reader, foreign })}`).toBe(expected);

        if (expected === "fits") {
          sound(checkedString(writer, false), checkedString(reader, false), seed, "F8");
        }

        reached.add(foreign ? "foreign" : differ ? "payload" : writer.length > reader.length ? "more" : "order");
      }),
      { seed: SEED, numRuns: runsFor({ fast: 60, full: 200 }) },
    );
    expect(reached).toEqual(new Set(["foreign", "payload", "more", "order"]));

    // The ticket number spelled two ways fits; spelled with another bound, it cannot tell.
    const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
    expect(judged(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)), TicketNumber)).toEqual({
      _tag: "fits",
    });
    expect(judged(Schema.Int.check(Schema.isGreaterThan(0)), TicketNumber)).toMatchObject({
      _tag: "cannot_tell",
      path: [],
    });
  });
});

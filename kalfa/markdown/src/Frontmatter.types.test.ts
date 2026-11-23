// Ticket 1926 T1 and ticket 1927 T2: Frontmatter's public types, checked by the lead's typecheck (a type law is red only in a typecheck).
// T1 plant: type `write`'s data as `unknown`, so the first `@ts-expect-error` below is unused and tsc says so.
// T2 plant: type `set`'s `values` as `Schema.JsonObject`, so the `@ts-expect-error` lines of `contractSet` are unused and tsc says so.
import { expectTypeOf, it } from "@effect/vitest";
import { type Effect, Schema } from "effect";
import type * as Option from "effect/Option";
import type * as Result from "effect/Result";
import * as Frontmatter from "./Frontmatter.ts";

const Shape = Schema.Struct({
  number: Schema.Int,
  status: Schema.Literals(["proposed", "accepted"]),
  id: Schema.String,
});

type Data = { readonly number: number; readonly status: "proposed" | "accepted"; readonly id: string };

// The contract takes a Schema that needs a service to decode, and one that needs a service to encode, as
// parameters: it is never called, so they only give the type checker a value of each type.
const contract = (
  DecodeNeeds: Schema.Codec<string, string, "Db", never>,
  EncodeNeeds: Schema.Codec<string, string, never, "Db">,
) => {
  expectTypeOf(Frontmatter.read("", Shape)).toEqualTypeOf<
    Effect.Effect<
      { readonly data: Data; readonly body: string },
      Frontmatter.NoFrontmatter | Frontmatter.BadFrontmatter,
      never
    >
  >();
  expectTypeOf(Frontmatter.read("", DecodeNeeds)).toEqualTypeOf<
    Effect.Effect<
      { readonly data: string; readonly body: string },
      Frontmatter.NoFrontmatter | Frontmatter.BadFrontmatter,
      "Db"
    >
  >();

  expectTypeOf(
    Frontmatter.write({ data: { number: 87, status: "accepted", id: "0146" }, body: "" }, Shape),
  ).toEqualTypeOf<Result.Result<string, Frontmatter.BadFrontmatter>>();

  // @ts-expect-error data of another type does not compile
  Frontmatter.write({ data: { number: "87", status: "accepted", id: "0146" }, body: "" }, Shape);
  // @ts-expect-error a status outside the Schema's literals does not compile
  Frontmatter.write({ data: { number: 87, status: "decided", id: "0146" }, body: "" }, Shape);
  // @ts-expect-error a Schema whose encode needs a service does not compile: write is a plain function
  Frontmatter.write({ data: "x", body: "" }, EncodeNeeds);

  expectTypeOf(Frontmatter.split("")).toEqualTypeOf<Frontmatter.Split>();
  expectTypeOf<Frontmatter.Split>().toEqualTypeOf<{
    readonly frontmatter: Option.Option<string>;
    readonly body: string;
  }>();
  // Neither `split` nor `write` answers an Effect.
  expectTypeOf(Frontmatter.split("")).not.toExtend<Effect.Effect<unknown, unknown, unknown>>();
  expectTypeOf(
    Frontmatter.write({ data: { number: 87, status: "accepted", id: "0146" }, body: "" }, Shape),
  ).not.toExtend<Effect.Effect<unknown, unknown, unknown>>();
};

it("T1 type: read, write and split have the types the plan gives, checked by the lead's typecheck", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(contract).toBeFunction();
});

const Optional = Schema.Struct({ id: Schema.String, note: Schema.optionalKey(Schema.String) });

// A Schema that needs a service to decode and another to encode, a parameter for the same reason.
const contractSet = (BothNeed: Schema.Codec<{ readonly id: string }, { readonly id: string }, "Decode", "Encode">) => {
  expectTypeOf(Frontmatter.set("", { status: "accepted" }, Shape)).toEqualTypeOf<
    Effect.Effect<string, Frontmatter.NoFrontmatter | Frontmatter.BadFrontmatter, never>
  >();
  // The Schema's services, to decode the old data and to encode the new, are the Effect's.
  expectTypeOf(Frontmatter.set("", { id: "x" }, BothNeed)).toEqualTypeOf<
    Effect.Effect<string, Frontmatter.NoFrontmatter | Frontmatter.BadFrontmatter, "Decode" | "Encode">
  >();

  // Each wrong call is an arrow that answers the Effect, so the only error on its line is the one that is expected.
  // @ts-expect-error a value of the wrong type does not compile
  const wrongType = () => Frontmatter.set("", { number: "87" }, Shape);
  // @ts-expect-error a status outside the Schema's literals does not compile
  const wrongStatus = () => Frontmatter.set("", { status: "decided" }, Shape);
  // @ts-expect-error a key outside a Struct's fields does not compile
  const wrongKey = () => Frontmatter.set("", { other: 1 }, Shape);
  // @ts-expect-error undefined for an optional field does not compile: `set` never removes a key
  const removed = () => Frontmatter.set("", { note: undefined }, Optional);

  expectTypeOf([wrongType, wrongStatus, wrongKey, removed]).toBeArray();
};

it("T2 type: set has the type the plan gives, checked by the lead's typecheck", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(contractSet).toBeFunction();
});

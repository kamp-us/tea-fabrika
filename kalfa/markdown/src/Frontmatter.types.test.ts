// Ticket 1926 T1: Frontmatter's public types, checked by the lead's typecheck (a type law is red only in a typecheck).
// Plant: type `write`'s data as `unknown`, so the first `@ts-expect-error` below is unused and tsc says so.
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

// A Schema that needs a service to decode, and one that needs a service to encode.
declare const DecodeNeeds: Schema.Codec<string, string, "Db", never>;

declare const EncodeNeeds: Schema.Codec<string, string, never, "Db">;

const contract = () => {
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

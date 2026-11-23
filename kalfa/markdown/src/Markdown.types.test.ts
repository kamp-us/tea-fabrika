// Ticket 1928 T3: Markdown's public types, checked by the lead's typecheck (a type law is red only in a typecheck).
// T3 plant: make `parse` an `Effect.fn`, so the first `toEqualTypeOf` below is false and tsc says so.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect } from "effect";
import type * as Result from "effect/Result";
import type { Root } from "mdast";
import * as Markdown from "./Markdown.ts";

const contract = () => {
  expectTypeOf(Markdown.parse).toEqualTypeOf<(body: string) => Markdown.Document>();
  // The document is mdast's Root, the standard tree, as it is.
  expectTypeOf<Markdown.Document>().toEqualTypeOf<Root>();
  // It cannot fail and needs no service, so the answer is the tree: no Effect and no Result.
  expectTypeOf(Markdown.parse("")).not.toExtend<Effect.Effect<unknown, unknown, unknown>>();
  expectTypeOf(Markdown.parse("")).not.toExtend<Result.Result<unknown, unknown>>();
};

it("T3 type: parse has the type the plan gives, checked by the lead's typecheck", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(contract).toBeFunction();
});

// Ticket 1053 slice 1, next/: L3 of the plan (docs/plan/quests/t1053-PLAN.md), written before the
// build. A view is JSON at every place the runner names it, so a view update can be a Schema's type
// and no hop has to call it `unknown`. The type checker reads the law; Vitest does not typecheck, so
// the lead and CI run it with `pnpm typecheck`.
// Plant: put `unknown` back on `diff`'s `before`.
import { expectTypeOf, it } from "@effect/vitest";
import type { Schema } from "effect";
import type { Update as EntryUpdate, View } from "./Entry.ts";
import type { Update } from "./News.ts";
import type { diff, Patch } from "./Patch.ts";
import type { Opened } from "./Runner.ts";

type Valued = Extract<Patch, { readonly value: unknown }>;

it("type: L3 a view is Schema.Json where the runner names it, in View, in Opened, in both sides of diff and in a patch's value, and Update is the Schema's type", () => {
  expectTypeOf<View>().toEqualTypeOf<Schema.Json>();
  expectTypeOf<Opened["view"]>().toEqualTypeOf<Schema.Json>();
  expectTypeOf<Parameters<typeof diff>[0]>().toEqualTypeOf<Schema.Json>();
  expectTypeOf<Parameters<typeof diff>[1]>().toEqualTypeOf<Schema.Json>();
  expectTypeOf<Parameters<typeof diff>>().toHaveProperty("length").toEqualTypeOf<2>();
  // The two operations that carry a value, `add` and `replace`, and no third.
  expectTypeOf<Valued["op"]>().toEqualTypeOf<"add" | "replace">();
  expectTypeOf<Valued["value"]>().toEqualTypeOf<Schema.Json>();
  expectTypeOf<ReturnType<typeof diff>>().toEqualTypeOf<ReadonlyArray<Patch>>();
  // The name the nine files import from Entry.ts is the Schema's own type, not a second one.
  expectTypeOf<EntryUpdate>().toEqualTypeOf<Update>();
  expectTypeOf<Extract<EntryUpdate, { readonly type: "whole" }>["view"]>().toEqualTypeOf<Schema.Json>();
});

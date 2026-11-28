// Law O3 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-context-tag` and `no-data-taggederror` refuse their forms in
// value and type positions, and pass `Context.Service`, a look-alike, a comment and a string. Both rules share one
// helper, so their lines sit in one file. Each is a `pinned:` law, the plan's reason: the two rules' lines are the
// ones the repo's own plants held and their type forms, each form once, so there is nothing to generate.
//
// Plants, each run once on the rule's file or on `internal/Syntax.ts` and undone:
// - stop visiting `TSQualifiedName` in `banNames`: the type lines stop firing;
// - drop the `isWritten` check: the planted `Data.TaggedError = f;` fires.
import { it } from "@effect/vitest";
import { noContextTag } from "./no-context-tag.ts";
import { noDataTaggederror } from "./no-data-taggederror.ts";
import { check, type Line } from "./Tester.test-support.ts";

const HEADER: Line = ['import { Context, Data, Effect } from "effect";', 0];

it("O3 pinned: no-context-tag refuses Context.Tag, Context.GenericTag and Effect.Service in values and types, and passes Context.Service and look-alikes", () => {
  check("no-context-tag", noContextTag, [
    HEADER,
    ['export const a = Context.Tag("a");', 1],
    ['export const b = Context.GenericTag("b");', 1],
    ['export const c = Effect.Service("c");', 1],
    // Type positions.
    ["export type T1 = Context.Tag<X, Y>;", 1],
    ["export interface I extends Context.Tag<X, Y> {}", 1],
    ["export type T2 = typeof Context.GenericTag;", 1],
    ["export type T3 = Effect.Service<A>;", 1],
    // What passes: the v4 form, a write, another module's `Tag`, a member two names deep, a comment and a string.
    ['export const d = Context.Service("d");', 0],
    ["Context.Tag = f;", 0],
    ['export const e = Other.Tag("e");', 0],
    ['export const f = other.Context.Tag("f");', 0],
    ["// Context.Tag in a comment", 0],
    ['export const g = "Context.Tag";', 0],
  ]);
});

it("O3 pinned: no-data-taggederror refuses Data.TaggedError in values and types, and passes other modules' TaggedError", () => {
  check("no-data-taggederror", noDataTaggederror, [
    HEADER,
    ['export class A extends Data.TaggedError("A") {}', 1],
    ["export const ref = Data.TaggedError;", 1],
    ['export const made = Data.TaggedError("C");', 1],
    // Type positions, which oxlint's own `no-restricted-properties` does not refuse.
    ["export type Made = typeof Data.TaggedError;", 1],
    ['export type Instance = InstanceType<ReturnType<typeof Data.TaggedError<"X">>>;', 1],
    // What passes: a write, another module's, the schema form, a comment and a string.
    ["Data.TaggedError = f;", 0],
    ['export class B extends Other.TaggedError("B") {}', 0],
    ['export class C extends Schema.TaggedError<C>()("C", {}) {}', 0],
    ["// Data.TaggedError in a comment", 0],
    ['export const text = "Data.TaggedError";', 0],
  ]);
});

// Law O3 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-context-tag` and `no-data-taggederror` refuse their forms in
// value and type positions, and pass `Context.Service`, a look-alike, a comment and a string. Both rules share one
// helper, so their lines sit in one file. Each is a `pinned:` law, the plan's reason: the two rules' lines are the
// ones the repo's own plants held and their type forms, each form once, so there is nothing to generate.
//
// Plants, each run once on the rule's file or on `internal/Syntax.ts` and undone:
// - stop visiting `TSQualifiedName` in `banNames`: the type lines stop firing;
// - drop the `isWritten` check: the planted `Data.TaggedError = f;` fires;
// - make `isWritten` answer `false` for an update, an array pattern or a rest element (`return true` into `return false`): the
//   writes `Context.Tag++`, `[Context.Tag] = f` and `[...Context.Tag] = f` fire;
// - drop the `ObjectPattern` check of `isWritten`'s `Property` case: the value `{ a: Context.Tag }` stops firing;
// - drop `dotted`'s `node.property.type !== "Identifier"` check: a private member `Data.#TaggedError` (and `Context.#Tag`)
//   reads as the plain member of the same name and fires.
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
    // A write in any other form: compound, update, a destructuring target, a loop target. A use as a value is not a write.
    ["Context.Tag += f;", 0],
    ["Context.Tag++;", 0],
    ["[Context.Tag] = f;", 0],
    ["[...Context.Tag] = f;", 0],
    ["[Context.Tag = 1] = f;", 0],
    ["({ a: Context.Tag } = f);", 0],
    ["({ ...Context.Tag } = f);", 0],
    ["for (Context.Tag of f) {}", 0],
    ["for (Context.Tag in f) {}", 0],
    ["export const o = { a: Context.Tag };", 1],
    ['export const e = Other.Tag("e");', 0],
    ['export const f = other.Context.Tag("f");', 0],
    ["// Context.Tag in a comment", 0],
    ['export const g = "Context.Tag";', 0],
    // A computed member and an optional one are not the plain member the rule reads.
    ["export const h = Context[Tag];", 0],
    ['export const i = Effect?.Service("i");', 0],
    // A private member is not the plain member of the same name: `#Tag` is a name of the class, not of `Context`.
    ["export class P { static #Tag = 1; static m(Context: P) { return Context.#Tag; } }", 0],
  ]);
});

it("O3 pinned: no-context-tag refuses the JSX member Context.Tag once, at the opening tag, and passes another module's", () => {
  check(
    "no-context-tag",
    noContextTag,
    [
      ['import { Context } from "effect";', 0],
      ["export const a = <Context.Tag />;", 1],
      ["export const b = <Context.Tag></Context.Tag>;", 1],
      ["export const c = <Other.Tag />;", 0],
    ],
    { filename: "src/a.tsx" },
  );
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
    // A private member of a value named `Data`: not `Data.TaggedError`.
    ["export class P { static #TaggedError = 1; static m(Data: P) { return Data.#TaggedError; } }", 0],
  ]);
});

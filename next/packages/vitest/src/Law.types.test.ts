// Decision 0580: a law's plant and its label are options of its declaration. The label is one of five
// keys, each with its required reason, and a pinned law names its bug's ticket. Only the compiler
// checks these: the lead's one `pnpm typecheck` reads them, and Vitest does not typecheck, so the body
// holds type checks only (0527). A plant that lets a refused shape compile fails its `not` check.
//
// Plant: make `Labeled` one plain record of the five optional keys, so two labels compile.
import { describe, expectTypeOf, it } from "@effect/vitest";
import type { TaskMeta } from "vitest";
import type { Label, LawOptions } from "./Law.ts";

describe("a law's options (0580)", () => {
  it("type: a law takes at most one label with its reason, a plant is a string, a pinned law names a ticket, and the plant and label ride in vitest's meta", () => {
    // Each label alone, beside a plant and vitest's own options.
    expectTypeOf<{ readonly plant: "drop the press row"; readonly scenario: "one deadline" }>().toExtend<LawOptions>();
    expectTypeOf<{ readonly vector: "the row in field/runs"; readonly timeout: 10 }>().toExtend<LawOptions>();
    expectTypeOf<{ readonly format: "the JSON line"; readonly retry: 2 }>().toExtend<LawOptions>();
    expectTypeOf<{ readonly type: "only the compiler checks it" }>().toExtend<LawOptions>();
    expectTypeOf<{ readonly pinned: 1497; readonly plant: "skip the last append" }>().toExtend<LawOptions>();
    expectTypeOf<{ readonly plant: "a break" }>().toExtend<LawOptions>();
    // Two labels, a pinned that is no ticket number, a plant that is no string.
    expectTypeOf<{ readonly vector: "a"; readonly format: "b" }>().not.toExtend<LawOptions>();
    expectTypeOf<{ readonly scenario: "a"; readonly pinned: 1497 }>().not.toExtend<LawOptions>();
    expectTypeOf<{ readonly type: "a"; readonly vector: "b"; readonly plant: "c" }>().not.toExtend<LawOptions>();
    expectTypeOf<{ readonly pinned: "1497" }>().not.toExtend<LawOptions>();
    expectTypeOf<{ readonly plant: 3 }>().not.toExtend<LawOptions>();
    // vitest's meta carries both, so a reporter reads them.
    expectTypeOf<TaskMeta["plant"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<TaskMeta["label"]>>().toEqualTypeOf<Label>();
    expectTypeOf<Label["_tag"]>().toEqualTypeOf<"vector" | "format" | "scenario" | "type" | "pinned">();
  });
});

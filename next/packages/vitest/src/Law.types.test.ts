// Decision 0580: a law's plant and its label are options of its declaration. The label is one of five
// keys, each with its required reason, and a pinned law names its bug's ticket. Only the compiler
// checks these: the lead's one `pnpm typecheck` reads them, and Vitest does not typecheck, so the body
// holds type checks only (0527). A plant that lets a refused shape compile fails its `not` check.
//
// Plant: make `Labeled` one plain record of the five optional keys, so two labels compile.
import { assertType, describe, expectTypeOf, it } from "@effect/vitest";
import type { TaskMeta } from "vitest";
import type { Label, Law, LawOptions } from "./Law.ts";

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

  // R3 (0591): `reads` names the files a law reads as text, globs from the top of the repo, and rides
  // in meta beside the plant and the label. Plant: type `reads` as `unknown` in `LawOptions` and
  // `TaskMeta`; the `@ts-expect-error` goes unused and the refused shapes compile.
  it("type: R3 reads is a key of LawOptions, typed as a list of strings, and lands in meta", () => {
    expectTypeOf<{ readonly reads: readonly ["next/packages/libfabrika/src/**"] }>().toExtend<LawOptions>();
    expectTypeOf<{
      readonly reads: ReadonlyArray<string>;
      readonly plant: "a break";
      readonly scenario: "one tree";
    }>().toExtend<LawOptions>();
    expectTypeOf<NonNullable<LawOptions["reads"]>>().toEqualTypeOf<ReadonlyArray<string>>();
    // A glob that is not a string, or one glob not in a list.
    expectTypeOf<{ readonly reads: readonly [3] }>().not.toExtend<LawOptions>();
    expectTypeOf<{ readonly reads: "next/**" }>().not.toExtend<LawOptions>();
    // @ts-expect-error one glob is written as a list of one
    assertType<LawOptions>({ reads: "next/**" });
    expectTypeOf<TaskMeta["reads"]>().toEqualTypeOf<ReadonlyArray<string> | undefined>();
  });

  // R8 (0591): the package's `it.each` takes a law's options in vitest's middle place, and types each
  // body's arguments from the cases. `Table` is one use of `each`: a case type, the options a law
  // writes, and the body it hands. Plant: type `each`'s options as `object`; the three refused
  // options compile, so their `not` checks fail.
  it("type: R8 it.each takes LawOptions, refusing a key LawOptions does not hold, a reads that is no list of strings and two labels, and types a body's arguments from the cases", () => {
    type Rows = ReadonlyArray<readonly [number, string]>;
    type Records = ReadonlyArray<{ readonly n: number }>;
    type Table<Cases, Options, Body> = (cases: Cases) => (name: string, options: Options, self: Body) => void;
    // A tuple case is spread into the body, a record case is handed whole, beside a law's options.
    expectTypeOf<Law["each"]>().toExtend<
      Table<
        Rows,
        { readonly plant: "a break"; readonly scenario: "one row"; readonly reads: readonly ["next/a/**"] },
        (n: number, word: string) => void
      >
    >();
    expectTypeOf<Law["each"]>().toExtend<
      Table<Records, { readonly vector: "a row" }, (row: { readonly n: number }) => void>
    >();
    expectTypeOf<Law["each"]>().toExtend<Table<Rows, { readonly timeout: 10 }, () => void>>();
    // The body's arguments come from the cases: a tuple case's type is the body's argument list, any
    // other case's type its one argument. TypeScript relates a generic overload to `Table` loosely,
    // accepting a body of any argument types, so the type itself is held: vitest's two `each` shapes.
    expectTypeOf<Law["each"]>().toEqualTypeOf<{
      <const T extends ReadonlyArray<unknown>>(
        cases: ReadonlyArray<T>,
      ): (name: string, options: LawOptions, self: (...values: T) => void) => void;
      <T>(cases: ReadonlyArray<T>): (name: string, options: LawOptions, self: (value: T) => void) => void;
    }>();
    // A key LawOptions does not hold, a reads that is no list of strings, two labels.
    expectTypeOf<Law["each"]>().not.toExtend<Table<Rows, { readonly seed: 1 }, () => void>>();
    expectTypeOf<Law["each"]>().not.toExtend<Table<Rows, { readonly reads: readonly [3] }, () => void>>();
    expectTypeOf<Law["each"]>().not.toExtend<Table<Rows, { readonly vector: "a"; readonly format: "b" }, () => void>>();
  });
});

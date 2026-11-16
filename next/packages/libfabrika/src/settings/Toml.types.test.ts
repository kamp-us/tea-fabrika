// T877, next/: L9's public contract is checked by the lead's typecheck.
import { expectTypeOf, it } from "@effect/vitest";
import type { Context, Effect } from "effect";
import type { Table } from "./internal/edit.ts";
import type * as TomlFront from "./Toml.ts";
import type { Toml, TomlDocument, TomlError } from "./Toml.ts";

const contract = () => {
  expectTypeOf<Context.Service.Shape<typeof Toml>>().toEqualTypeOf<{
    readonly parse: (text: string) => Effect.Effect<TomlDocument, TomlError>;
    readonly set: (text: string, path: ReadonlyArray<string>, value: unknown) => Effect.Effect<string, TomlError>;
    readonly remove: (text: string, path: ReadonlyArray<string>) => Effect.Effect<string, TomlError>;
  }>();
  expectTypeOf<TomlError["reason"]>().toEqualTypeOf<TomlFront.Syntax | TomlFront.Value | TomlFront.Conflict>();
  expectTypeOf<TomlError["reason"]["_tag"]>().toEqualTypeOf<"Syntax" | "Value" | "Conflict">();
  expectTypeOf<TomlError["reason"]["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<TomlFront.Conflict["path"]>().toExtend<ReadonlyArray<string>>();
  expectTypeOf<TomlError["line"]>().toEqualTypeOf<number>();
  expectTypeOf<TomlError["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<"layer" extends keyof typeof Toml ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof TomlFront ? true : false>().toEqualTypeOf<false>();
  // Existing parse consumers must not acquire a dependency on private edit offsets, and the values
  // are what TOML text holds: `Table`, whose values are strings, numbers, booleans, dates, arrays
  // and tables, never any value (anti-slop/no-unsafe-dictionary-type, ticket 1057).
  // Plant: put `value` back to `Readonly<Record<string, unknown>>` in Toml.ts, and this goes red.
  expectTypeOf<TomlDocument>().toEqualTypeOf<{
    readonly value: Table;
    readonly spans: ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly line: number }>;
  }>();
};

it("L9 type: Toml's complete contract and tagged reasons are typechecked", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(contract).toBeFunction();
});

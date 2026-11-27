// T1: a type law, so it lives in a test file beside `TestDatabase.ts` and only the compiler checks it.
// `make` opens a file the test owns, so it has no error channel and a caller needs no handler; `open`
// fails typed; neither the module nor the package root hands out an `Sql` service, which this folder
// may not import. It reads both entry points by the package's own name, as a repo's tests do. Plant:
// give `make` a `TestDatabaseError` (red: its return type is no longer `Effect<DatabaseSync, never,
// Scope>`).
import type { DatabaseSync } from "node:sqlite";
import { expectTypeOf, it } from "@effect/vitest";
import type * as Vitest from "@kalfa/quality/vitest";
import type * as TestDatabase from "@kalfa/quality/vitest/TestDatabase";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

it("type: make gives DatabaseSync with no error, open gives TestDatabaseError, and the package hands out no Sql", () => {
  expectTypeOf<Parameters<typeof TestDatabase.make>>().toEqualTypeOf<[file: string]>();
  expectTypeOf<ReturnType<typeof TestDatabase.make>>().toEqualTypeOf<Effect.Effect<DatabaseSync, never, Scope.Scope>>();
  expectTypeOf<Parameters<typeof TestDatabase.open>>().toEqualTypeOf<
    [file: string, options?: TestDatabase.Options | undefined]
  >();
  expectTypeOf<ReturnType<typeof TestDatabase.open>>().toEqualTypeOf<
    Effect.Effect<DatabaseSync, TestDatabase.TestDatabaseError, Scope.Scope>
  >();
  expectTypeOf<TestDatabase.Options>().toEqualTypeOf<{
    readonly readOnly?: boolean;
    readonly wait?: Duration.Input;
  }>();
  expectTypeOf<TestDatabase.TestDatabaseError["_tag"]>().toEqualTypeOf<"TestDatabaseError">();
  expectTypeOf<TestDatabase.TestDatabaseError["file"]>().toEqualTypeOf<string>();
  expectTypeOf<"Sql" extends keyof typeof TestDatabase ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"Sql" extends keyof typeof Vitest ? true : false>().toEqualTypeOf<false>();
});

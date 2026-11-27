// V2: the two entry points give what the package promises, read by the package's own name as a repo's tests read
// them. Only the compiler checks it: the one typecheck reads this file, and Vitest runs the body, which holds type
// checks only. `@kalfa/quality/vitest` gives the depth, `Recorder` and `Stub`, each the type its own module has, and
// nothing that loads a native database module; `@kalfa/quality/vitest/TestDatabase` gives the test database.
// Plants: drop `./vitest/TestDatabase` from `exports` (the import does not resolve); add
// `export * as TestDatabase from "./TestDatabase.ts"` to `index.ts` (the root has a name it must not have); point
// `./vitest` at `Depth.ts` (`Recorder` and `Stub` are missing).
import { expectTypeOf, it } from "@effect/vitest";
import type * as Vitest from "@kalfa/quality/vitest";
import type * as TestDatabase from "@kalfa/quality/vitest/TestDatabase";
import type * as Depth from "./Depth.ts";
import type * as Recorder from "./Recorder.ts";
import type * as Stub from "./Stub.ts";
import type * as OwnTestDatabase from "./TestDatabase.ts";

it("V2 type: the root gives runsFor, runsAt, decodeDepth, depth, LEAST, Runs, Recorder and Stub as their modules have them, and no test database; the subpath gives make, open, Options and TestDatabaseError", () => {
  expectTypeOf<keyof typeof Vitest>().toEqualTypeOf<
    "runsFor" | "runsAt" | "decodeDepth" | "depth" | "LEAST" | "Recorder" | "Stub"
  >();
  expectTypeOf<typeof Vitest.runsFor>().toEqualTypeOf<typeof Depth.runsFor>();
  expectTypeOf<typeof Vitest.runsAt>().toEqualTypeOf<typeof Depth.runsAt>();
  expectTypeOf<typeof Vitest.decodeDepth>().toEqualTypeOf<typeof Depth.decodeDepth>();
  expectTypeOf<typeof Vitest.depth>().toEqualTypeOf<typeof Depth.depth>();
  expectTypeOf<typeof Vitest.LEAST>().toEqualTypeOf<typeof Depth.LEAST>();
  expectTypeOf<Vitest.Runs>().toEqualTypeOf<Depth.Runs>();
  expectTypeOf<typeof Vitest.Recorder>().toEqualTypeOf<typeof Recorder>();
  expectTypeOf<typeof Vitest.Stub>().toEqualTypeOf<typeof Stub>();
  // No name of the test database, and no `Sql`, on the root.
  expectTypeOf<
    Extract<keyof typeof Vitest, "TestDatabase" | "TestDatabaseError" | "make" | "open" | "Options" | "Sql">
  >().toBeNever();

  expectTypeOf<keyof typeof TestDatabase>().toEqualTypeOf<"make" | "open" | "TestDatabaseError">();
  expectTypeOf<typeof TestDatabase.make>().toEqualTypeOf<typeof OwnTestDatabase.make>();
  expectTypeOf<typeof TestDatabase.open>().toEqualTypeOf<typeof OwnTestDatabase.open>();
  expectTypeOf<TestDatabase.Options>().toEqualTypeOf<OwnTestDatabase.Options>();
  expectTypeOf<typeof TestDatabase.TestDatabaseError>().toEqualTypeOf<typeof OwnTestDatabase.TestDatabaseError>();
});

// 0593, next/: laws L5 and L6 of the approved plan (docs/plan/quests/supervisor-writes-uncharged-PLAN.md).
// A store says who pays for each write it makes, and the supervisor's bookkeeping fields are fields of
// its own record and none of the program's. The lead and CI run the compiler; Vitest does not
// typecheck, so the bodies hold type assertions only (0527).
// Plants (after the build): make `change`'s fifth parameter optional, so the `@ts-expect-error` line
// is unused; add "seq" to `bookkeeping`, or rename `healthyAt` in the schema only: tsc red.
import { expectTypeOf, it } from "@effect/vitest";
import type { Accounting, Charge } from "../processes/Quotas.ts";
import type { bookkeeping, Supervision } from "./internal/supervisor.ts";

it("type: L5 Accounting.change takes its charge, so four arguments or the old flag do not compile", () => {
  type Change = Accounting["change"];

  expectTypeOf<Charge>().toEqualTypeOf<"program" | "recovery" | "supervisor">();
  expectTypeOf<Parameters<Change>[4]>().toEqualTypeOf<Charge>();
  // Every store says who pays: a call that names no charge is a type error.
  // @ts-expect-error the charge is required
  expectTypeOf<Change>().toBeCallableWith("journal", 1, 0, 0);
  // @ts-expect-error the old `recovery?: boolean` flag is not a charge
  expectTypeOf<Change>().toBeCallableWith("journal", 1, 0, 0, true);
  expectTypeOf<Change>().toBeCallableWith("journal", 1, 0, 0, "supervisor");
});

it("type: L6 every bookkeeping name is a field of Supervision, and the program's own fields are not", () => {
  type Field = (typeof bookkeeping)[number];

  expectTypeOf<Field>().toExtend<keyof Supervision>();
  expectTypeOf<Extract<Field, "seq" | "journal" | "receipts" | "name">>().toBeNever();
});

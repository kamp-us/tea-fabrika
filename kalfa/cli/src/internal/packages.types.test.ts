// K25: the type of the seam to Node's module system, checked by the compiler. A module that cannot be loaded is an
// `Unloaded`, which knows only its reason; the field and the subpath are put to it by `load.ts`, which turns it into a
// `Refused`. So the seam's `load` never fails with a `Refused`, since one would reach the run with a field and a subpath
// that nothing checked, and the law of the in-memory stand-in (which fails with `Unloaded`) would not meet that path.
// Real values, never `declare const`. The file also runs under vitest, and the compiler (`tsc`) reads every line.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect } from "effect";
import type { Refused } from "./failure.ts";
import { type Packages, Unloaded } from "./packages.ts";

type Seam = Packages["Service"];

const seamContract = () => {
  // K25 plant: put `Refused` back in the error of `load` in `packages.ts`, and this line fails.
  expectTypeOf<Effect.Error<ReturnType<Seam["load"]>>>().toEqualTypeOf<Unloaded>();

  // An `Unloaded` holds its reason and nothing else: no field and no subpath to take on trust.
  const unloaded = new Unloaded({ reason: "not-exported" });

  expectTypeOf(unloaded.reason).toEqualTypeOf<"not-exported" | "load">();
  expectTypeOf(unloaded).not.toHaveProperty("subpath");
  expectTypeOf(unloaded).not.toHaveProperty("field");

  // The other calls of the seam refuse with a `Refused`, as before.
  expectTypeOf<Effect.Error<ReturnType<Seam["manifest"]>>>().toEqualTypeOf<Refused>();
  expectTypeOf<Effect.Error<Seam["root"]>>().toEqualTypeOf<Refused>();
};

it("K25 type: the seam's load fails with an Unloaded and never with a Refused", () => {
  expectTypeOf(seamContract).toBeFunction();
});

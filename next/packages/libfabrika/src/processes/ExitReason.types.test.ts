// next/: law L1 of the approved plan (docs/plan/quests/effect-413-PLAN.md). From effect 4.1.3 on,
// `isAnyOf` on a tagged union takes only that union's own tags, so a misspelled tag is a compile
// error rather than a check that is false forever. The lead and CI run the compiler; Vitest does not
// typecheck, so the body holds type assertions only (0527).
//
// The plan's plant: run the typecheck on this file while effect is still 4.1.2. There `Keys` is
// `ReadonlyArray<unknown>`, so the first two assertions fail.
import { expectTypeOf, it } from "@effect/vitest";
import type { ExitReason } from "./ExitReason.ts";

it("type: isAnyOf takes only the union's own tags, so a misspelled tag does not compile", () => {
  // The tags come from the union itself, never a written list, so a new exit reason keeps this green.
  type Tag = ExitReason["_tag"];

  type Keys = Parameters<typeof ExitReason.isAnyOf>[0];

  expectTypeOf<Keys>().toEqualTypeOf<ReadonlyArray<Tag>>();
  expectTypeOf<readonly ["typo"]>().not.toExtend<Keys>();
  expectTypeOf<readonly ["normal", "kill"]>().toExtend<Keys>();
  // The guard still narrows to the cases asked for, and to nothing else.
  expectTypeOf<ReturnType<typeof ExitReason.isAnyOf<"normal" | "kill">>>().guards.toEqualTypeOf<
    Extract<ExitReason, { readonly _tag: "normal" | "kill" }>
  >();
});

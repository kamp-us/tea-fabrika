import { expectTypeOf, it } from "@effect/vitest";
// Ticket 1053 slice 1, next/: L6 of the plan (docs/plan/quests/t1053-PLAN.md), written before the
// build. The app's Project object class is the last hop that named a view update `unknown`: its
// `publish` takes the library's `Published`. The type checker reads the law; Vitest does not
// typecheck, so the lead and CI run it with `pnpm typecheck`.
// Plant: put `unknown` back on the class's `update`.
import type { Published } from "@kampus/libfabrika/runtime/News";
import type { Project } from "./brain.ts";

it("type: L6 the Project class's publish takes a client and a Published", () => {
  expectTypeOf<Parameters<Project["publish"]>>().toEqualTypeOf<[client: string, update: Published]>();
});
